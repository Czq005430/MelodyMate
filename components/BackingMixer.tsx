"use client";

import { useEffect, useRef, useState } from "react";
import { AudioPlayer } from "../lib/audio-playback.ts";
import { estimateBackingGrid } from "../lib/backing-grid.ts";
import { renderBackingMix } from "../lib/backing-audio.ts";
import { encodeWavChannels } from "../lib/wav.ts";
import type { SongPlan, SongSource } from "../lib/song-types.ts";

type Props = { backing: AudioBuffer; label: string; plan: SongPlan; sources: SongSource[]; revision: number; blocked: boolean; interrupted: boolean; onBeforePlay: () => void };
type Mode = "mix" | "source" | "backing";
type Part = "start" | "middle" | "end" | "full";
const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;

export default function BackingMixer(props: Props) {
  const [estimate] = useState(() => estimateBackingGrid(props.backing, props.plan.bpm));
  const [bpm, setBpm] = useState(estimate?.bpm ?? props.plan.bpm), [offset, setOffset] = useState(estimate?.offsetSec ?? 0);
  const [sourceGain, setSourceGain] = useState(.8), [backingGain, setBackingGain] = useState(.45);
  const [confirmed, setConfirmed] = useState(false), [part, setPart] = useState<Part>("start");
  const [status, setStatus] = useState("idle"), [notice, setNotice] = useState("");
  const [progress, setProgress] = useState(0), [playDuration, setPlayDuration] = useState(0);
  const [download, setDownload] = useState<{ url: string; name: string } | null>(null);
  const player = useRef<AudioPlayer | null>(null), serial = useRef(0), frame = useRef(0);
  const abort = useRef<AbortController | null>(null), url = useRef<string | null>(null), alive = useRef(false);
  const rendering = status === "rendering" || status === "exporting";
  function clearDownload() { if (url.current) URL.revokeObjectURL(url.current); url.current = null; setDownload(null); }
  function stop() { serial.current++; abort.current?.abort(); player.current?.stop(); cancelAnimationFrame(frame.current); setStatus("idle"); setProgress(0); }
  function change(update: () => void) { stop(); clearDownload(); setConfirmed(false); setNotice(""); update(); }
  useEffect(() => { alive.current = true; return () => { alive.current = false; serial.current++; abort.current?.abort(); player.current?.close(); cancelAnimationFrame(frame.current); if (url.current) URL.revokeObjectURL(url.current); }; }, []);
  useEffect(() => { stop(); clearDownload(); setConfirmed(false); setNotice(""); }, [props.revision]);
  useEffect(() => { if (props.interrupted) stop(); }, [props.interrupted]);

  async function run(mode: Mode, exporting = false) {
    if (props.blocked || rendering || (mode !== "backing" && !props.sources.length)) return;
    if (exporting && (!confirmed || props.backing.duration < 120)) return;
    stop(); props.onBeforePlay(); const ticket = serial.current;
    const controller = new AbortController(); abort.current = controller;
    setNotice(""); setStatus(exporting ? "exporting" : "rendering");
    try {
      if (!exporting) { player.current ??= new AudioPlayer(); await player.current.unlock(); }
      if (ticket !== serial.current || !alive.current) return;
      const buffer = await renderBackingMix(props.backing, props.sources, props.plan, { bpm, offsetSec: offset, sourceGain, backingGain, mode, signal: controller.signal });
      if (ticket !== serial.current || !alive.current) return;
      if (exporting) {
        const bytes = encodeWavChannels(Array.from({ length: buffer.numberOfChannels }, (_, channel) => buffer.getChannelData(channel)), buffer.sampleRate);
        clearDownload(); url.current = URL.createObjectURL(new Blob([bytes], { type: "audio/wav" }));
        setDownload({ url: url.current, name: `${props.plan.title.replace(/[^\p{L}\p{N}_-]/gu, "-")}-原声融合.wav` });
        setNotice(`已准备好 ${clock(buffer.duration)} 立体声 WAV。原声保留为真实录音切片，伴奏没有变速。`); setStatus("idle");
      } else {
        const length = part === "full" ? buffer.duration : Math.min(15, buffer.duration);
        const start = part === "middle" ? Math.max(0, (buffer.duration - length) / 2) : part === "end" ? buffer.duration - length : 0;
        const excerpt = new AudioBuffer({ numberOfChannels: buffer.numberOfChannels, length: Math.round(length * buffer.sampleRate), sampleRate: buffer.sampleRate });
        for (let channel = 0; channel < buffer.numberOfChannels; channel++) excerpt.copyToChannel(buffer.getChannelData(channel).subarray(Math.round(start * buffer.sampleRate), Math.round((start + length) * buffer.sampleRate)), channel);
        player.current!.play(excerpt, () => { if (ticket === serial.current && alive.current) { setStatus("idle"); cancelAnimationFrame(frame.current); setProgress(excerpt.duration); } });
        setStatus("playing"); setPlayDuration(excerpt.duration);
        const tick = () => { if (ticket === serial.current && alive.current) { setProgress(player.current!.elapsed); frame.current = requestAnimationFrame(tick); } }; tick();
      }
    } catch (error) { if (ticket === serial.current && alive.current) { setStatus("idle"); setNotice(error instanceof Error ? error.message : "试听失败，请重新选择伴奏。"); } }
  }
  return <div className="backing-mixer">
    <div className="backing-title"><div><span className="song-small-label">你的声音 + 独立伴奏</span><h3>{props.label}</h3></div><strong>{clock(props.backing.duration)}<small>{props.backing.duration >= 120 ? "实际音频时长" : "短片段 · 仅供试听"}</small></strong></div>
    <p className="song-note">{estimate ? `节拍估测约 ${estimate.bpm.toFixed(1)} BPM，仅作试听起点。` : "没有检测到可靠的周期，请在校准里填写伴奏速度。"}先分别听，再一起听，确认你的声音没有被盖住。</p>
    <div className="backing-controls"><label>试听位置<select aria-label="伴奏试听位置" value={part} onChange={event => { stop(); setPart(event.target.value as Part); }}><option value="start">开头 15 秒</option><option value="middle">中段 15 秒</option><option value="end">结尾 15 秒</option><option value="full">完整作品</option></select></label><div className="song-button-row"><button className="button button-secondary" disabled={props.blocked || rendering} onClick={() => void run("backing")}>只听伴奏</button><button className="button button-secondary" disabled={props.blocked || rendering || !props.sources.length} onClick={() => void run("source")}>只听原声轨</button><button className="button button-primary" disabled={props.blocked || rendering || !props.sources.length} onClick={() => void run("mix")}>一起试听 ▷</button><button className="text-button" disabled={status === "idle"} onClick={stop}>停止试听</button></div></div>
    {status !== "idle" && <p className="backing-progress" role="status">{status === "exporting" ? "正在准备立体声导出…" : status === "rendering" ? "正在混合原声与伴奏…" : `正在试听 ${clock(progress)} / ${clock(playDuration)}`}</p>}
    <div className="song-mixer backing-levels"><label><span>我的原声<small>{Math.round(sourceGain * 100)}%</small></span><input aria-label="融合原声音量" type="range" min="0.2" max="1.5" step="0.05" value={sourceGain} onChange={event => change(() => setSourceGain(Number(event.target.value)))} /></label><label><span>整条伴奏<small>{Math.round(backingGain * 100)}%</small></span><input aria-label="融合伴奏音量" type="range" min="0" max="1" step="0.05" value={backingGain} onChange={event => change(() => setBackingGain(Number(event.target.value)))} /></label></div>
    <details className="backing-calibration"><summary>听起来没踩准？展开校准</summary><p>原声总是早一点或晚一点，调整“首拍位置”；越往后越错开，微调“实际速度”。若伴奏持续变速，请换一版节拍稳定的伴奏。</p><div className="cloud-form-row"><label>实际速度（BPM）<input aria-label="伴奏实际速度" type="number" min="60" max="180" step="0.1" value={bpm} onChange={event => change(() => setBpm(Number(event.target.value)))} /></label><label>首拍位置（秒）<input aria-label="伴奏首拍位置" type="number" min="0" max={Math.min(30, props.backing.duration - 1)} step="0.01" value={offset} onChange={event => change(() => setOffset(Number(event.target.value)))} /></label></div></details>
    <label className="backing-confirm"><input type="checkbox" checked={confirmed} disabled={!props.sources.length} onChange={event => setConfirmed(event.target.checked)} /><span>我已对比开头、中段和结尾：原声清楚可辨，节拍没有明显错开。</span></label>
    <div className="song-button-row"><button className="button button-primary" disabled={!confirmed || props.backing.duration < 120 || !props.sources.length || props.blocked || rendering} onClick={() => void run("mix", true)}>导出原声融合版</button>{download && <a className="song-save" href={download.url} download={download.name}>保存立体声 WAV ↓</a>}</div>
    {props.backing.duration < 120 && <p className="song-note">这段伴奏不足两分钟。请生成或导入更长的完整作品，再导出融合版。</p>}
    {notice && <p className="song-notice" role="status">{notice}</p>}
  </div>;
}
