"use client";

import { useEffect, useRef, useState } from "react";
import HelpCard from "./HelpCard";
import BackingMixer from "./BackingMixer";
import { useMusicGeneration } from "../lib/use-music-generation.ts";
import { sameMusicProject } from "../lib/music-session.ts";
import { decodeBackingAudio } from "../lib/backing-audio.ts";
import { renderSong } from "../lib/song-render.ts";
import { songDuration } from "../lib/song-plan.ts";
import { encodeWav } from "../lib/wav.ts";
import { AudioPlayer } from "../lib/audio-playback.ts";
import { musicRoute } from "../lib/music-types.ts";
import type { SongPlan, SongSource } from "../lib/song-types.ts";
import type { MusicCandidate } from "../lib/music-types.ts";

type Props = { plan: SongPlan; sources: SongSource[]; revision: number; busy: boolean; localPlaying: boolean; onBeforePlay: () => void; onWork?: (kind: "song" | "mix" | "cloud", bytes: ArrayBuffer, seconds: number, id?: string) => void };
const labels = { submitting: "正在提交", pending: "等待生成", generating: "正在生成与保存", ready: "伴奏已准备好", failed: "生成未完成", unknown: "提交结果待确认" };
const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;

export default function CloudMusicPanel(props: Props) {
  const music = useMusicGeneration();
  const [mode, setMode] = useState<"accompaniment" | "continued">("accompaniment");
  const [prompt, setPrompt] = useState("温暖、松弛的钢琴伴奏，稳定四拍，给我的生活敲击声留出空间。中段有发展，结尾自然收住。不要人声，避免密集鼓组。");
  const [duration, setDuration] = useState<120 | 150 | 180>(150);
  const [continueAt, setContinueAt] = useState(30);
  const [consent, setConsent] = useState(false);
  const [selected, setSelected] = useState<{ id: string; label: string; buffer: AudioBuffer } | null>(null);
  const [finished, setFinished] = useState<{ label: string; url: string } | null>(null);
  const [loading, setLoading] = useState(false), [notice, setNotice] = useState("");
  const input = useRef<HTMLInputElement>(null), serial = useRef(0);
  const player = useRef<AudioPlayer | null>(null), finishUrl = useRef<string | null>(null);
  const total = songDuration(props.plan);
  const continued = musicRoute({ clip: music.job?.clip }) === "continued";
  useEffect(() => () => { serial.current++; player.current?.close(); if (finishUrl.current) URL.revokeObjectURL(finishUrl.current); }, []);
  async function load(read: () => Promise<ArrayBuffer>, label: string, record?: (bytes: ArrayBuffer, seconds: number) => void) {
    const ticket = ++serial.current; setLoading(true); setNotice(""); props.onBeforePlay();
    try {
      const bytes = await read();
      const buffer = await decodeBackingAudio(bytes);
      if (serial.current === ticket) { record?.(bytes, buffer.duration); setSelected({ id: crypto.randomUUID(), label, buffer }); }
    } catch (error) { if (serial.current === ticket) setNotice(error instanceof Error ? error.message : "伴奏导入失败，请换一种音频格式。"); }
    finally { if (serial.current === ticket) setLoading(false); }
  }
  const choose = (candidate: MusicCandidate) => load(() => music.fetchAudio(candidate), candidate.title || "生成伴奏",
    (bytes, seconds) => props.onWork?.("cloud", bytes, seconds, `cloud-${candidate.id}`));
  // 续写成品里已经含用户原声，必须绕开叠加原声的混音器，否则敲击会响两遍。
  async function playFinished(candidate: MusicCandidate) {
    const ticket = ++serial.current; setLoading(true); setNotice(""); props.onBeforePlay();
    try {
      const bytes = await music.fetchAudio(candidate);
      const buffer = await decodeBackingAudio(bytes);
      if (serial.current !== ticket) return;
      props.onWork?.("cloud", bytes, buffer.duration, `cloud-${candidate.id}`);
      player.current ??= new AudioPlayer();
      await player.current.unlock();
      if (serial.current !== ticket) return;
      player.current.play(buffer, () => undefined);
      if (finishUrl.current) URL.revokeObjectURL(finishUrl.current);
      const url = URL.createObjectURL(new Blob([bytes], { type: "audio/mpeg" }));
      finishUrl.current = url; setFinished({ label: candidate.title || "续写成品", url });
    } catch (error) { if (serial.current === ticket) setNotice(error instanceof Error ? error.message : "续写成品读取失败。"); }
    finally { if (serial.current === ticket) setLoading(false); }
  }
  async function submitExtend() {
    const ticket = ++serial.current; setLoading(true); setNotice(""); props.onBeforePlay();
    try {
      const buffer = await renderSong(props.sources, props.plan);
      if (serial.current !== ticket) return;
      const url = await music.uploadClip(new Uint8Array(encodeWav(buffer.getChannelData(0), buffer.sampleRate)));
      if (serial.current !== ticket) return;
      setSelected(null); setFinished(null);
      await music.submit({ projectRevision: props.revision, sourceIds: props.sources.map(source => source.id),
        brief: { prompt: prompt.trim(), bpm: props.plan.bpm, durationSec: duration, sourceLabels: props.sources.map(source => source.label) },
        clip: { url, seconds: buffer.duration, continueAt } });
    } catch (error) { if (serial.current === ticket) setNotice(error instanceof Error ? error.message : "雏形续写未完成，请勿重复提交。"); }
    finally { if (serial.current === ticket) setLoading(false); }
  }
  const stale = music.job && !sameMusicProject(music.job, props.revision, props.sources.map(source => source.id));
  const ready = music.config?.configured && music.token.trim() && props.sources.length && prompt.trim();
  return <section className="song-panel cloud-music" id="song-cloud" aria-labelledby="song-cloud-title">
    <div className="cloud-heading"><div className="song-section-heading"><span>04 / MAKE IT MUSICAL</span><h2 id="song-cloud-title">让专业模型来伴奏</h2><p>让 Suno 生成器乐，再把你的真实声音放进音乐里。</p></div><span className={`cloud-badge${music.config?.configured ? " is-ready" : ""}`}>{music.config?.configured ? "Kie 接入已配置" : "先导入伴奏，也能试"}</span></div>
    <div className="cloud-modes" role="group" aria-label="选择外部模型用法">
      <button type="button" aria-pressed={mode === "accompaniment"} disabled={music.pending || loading} onClick={() => setMode("accompaniment")}><strong>生成独立伴奏</strong><span>只发送文字，原声留在本机</span></button>
      <button type="button" aria-pressed={mode === "continued"} disabled={music.pending || loading} onClick={() => setMode("continued")}><strong>把雏形交给它续写</strong><span>会上传你导出的这段音频</span></button>
    </div>
    <div className="cloud-columns"><form onSubmit={event => { event.preventDefault(); if (mode === "continued") void submitExtend(); else void music.submit({ projectRevision: props.revision, sourceIds: props.sources.map(source => source.id), brief: { prompt: prompt.trim(), bpm: props.plan.bpm, durationSec: duration, sourceLabels: props.sources.map(source => source.label) } }); }}>
      <label className="cloud-label" htmlFor="music-prompt">{mode === "continued" ? "希望它怎样接着写？" : "你想听见怎样的伴奏？"}</label><textarea id="music-prompt" value={prompt} maxLength={600} rows={4} onChange={event => setPrompt(event.target.value)} placeholder="例如：有轻盈钢琴的夏日午后，给杯子声留出空间" />
      {mode === "continued"
        ? <div className="cloud-form-row"><label>续写起点<input type="range" min={5} max={Math.max(5, Math.floor(total) - 1)} step={1} value={Math.min(continueAt, Math.max(5, Math.floor(total) - 1))} onChange={event => setContinueAt(Number(event.target.value))} aria-label="续写起点秒数" /><output>{clock(Math.min(continueAt, Math.max(5, Math.floor(total) - 1)))} / {clock(total)}</output></label><span>起点之前原样保留你的雏形<br /><small>模型从这一秒往后接写</small></span></div>
        : <div className="cloud-form-row"><label>目标时长<select aria-label="生成伴奏目标时长" value={duration} onChange={event => setDuration(Number(event.target.value) as 120 | 150 | 180)}><option value={120}>约 2 分钟</option><option value={150}>约 2 分 30 秒</option><option value={180}>约 3 分钟</option></select></label><span>{props.plan.bpm} BPM 作为生成要求<br /><small>生成后还会检查实际节拍</small></span></div>}
      {mode === "continued"
        ? <><p className="song-note">这会把你当前工程的整段渲染结果（约 {clock(total)}、单声道 WAV）上传到 Kie 的素材通道，直链约 24 小时后失效。原始录音文件本身不上传，上传的是这段混音。续写成品会包含你的原声，不再作为可独立调整的伴奏轨。</p>
          <label className="cloud-consent"><input type="checkbox" checked={consent} onChange={event => setConsent(event.target.checked)} /><span>我确认把这段雏形上传给第三方服务商，并接受它可能重演我的声音。</span></label></>
        : <p className="song-note">只发送这段文字、速度和声音名称，原录音留在本机。每次新生成会消耗服务商账号额度。</p>}
      <button className="button button-primary" type="submit" disabled={!ready || (mode === "continued" && (!consent || music.busy || music.pending || props.busy))}>{mode === "continued" ? "上传雏形并续写一版 ↗" : "生成一版伴奏 ↗"}</button>
      {!ready && <p className="song-note">还不能提交：{[!music.config?.configured && "服务端还没读到 MUSIC_API_KEY", !music.token.trim() && "未填本机演示口令", !props.sources.length && "上方还没有声音素材", !prompt.trim() && "未填写要求文字", mode === "continued" && !consent && "未勾选上传确认"].filter(Boolean).join("；")}。</p>}
      {!props.sources.length && <p className="song-note">先在上方录一种声音，或载入示例，再让模型围绕它工作。</p>}
      <details className="cloud-setup" open={!music.config?.configured || !music.token.trim()}><summary>连接与开通指引</summary><p>{music.config?.message || "正在读取本机服务配置…"}</p><p>Kie.ai 是第三方接入服务，首页提供新用户试用额度说明；是否可用于 Suno，以你的账号显示为准。</p><a href="https://kie.ai/api-key" target="_blank" rel="noreferrer">前往 Kie 创建 API Key ↗</a><p>先将 <code>.env.example</code> 复制为 <code>.env.local</code>（已有配置时只补充），填写 <code>MUSIC_API_KEY</code>、<code>DEMO_ACCESS_TOKEN</code>，并将 <code>APP_ORIGIN</code> 设为地址栏中的网站地址，例如 http://127.0.0.1:3000。重启开发服务。不要把 API Key 填在页面里。</p><label className="cloud-label" htmlFor="music-token">本机演示口令</label><input id="music-token" type="password" autoComplete="off" value={music.token} onChange={event => music.setToken(event.target.value)} placeholder="填写 DEMO_ACCESS_TOKEN 的值" /><small>同一标签页只需填一次，刷新不会丢；关闭标签页即清除。API Key 只在服务端，不经过浏览器。</small><button type="button" className="text-button" onClick={() => void music.refreshConfig()}>重新检查配置</button></details>
    </form><div className="cloud-import"><span className="song-small-label">没有 API KEY？先试声音效果</span><h3>带一段伴奏进来</h3><p>在 Suno 网页生成并通过允许的方式下载，或选择你有权使用的伴奏。导入后，在这里加入你的生活声音。</p><input ref={input} type="file" accept="audio/*" className="sr-only" tabIndex={-1} aria-label="导入独立伴奏文件" onChange={event => { const file = event.target.files?.[0]; if (file) { if (file.size > 50 * 1024 * 1024) setNotice("请选择 50 MiB 以内的伴奏音频。"); else void load(() => file.arrayBuffer(), file.name); } event.target.value = ""; }} /><button type="button" className="button button-secondary" disabled={props.busy || loading} onClick={() => input.current?.click()}>{loading ? "正在解码伴奏…" : "导入伴奏音频 ↑"}</button><small>10 秒～6 分钟 / 50 MiB 以内<br />短于两分钟可试听，不算完整两分钟作品</small><a href="https://suno.com/create" target="_blank" rel="noreferrer">打开 Suno 网页 ↗</a></div></div>
    {(music.error || notice) && <p className="song-notice" role="alert">{notice || music.error}</p>}
    {music.session && <div className="cloud-task" role="status"><div><strong>{music.job ? labels[music.job.status] : "找到尚未确认的任务"}</strong><p>{music.job?.message || "输入本机演示口令，再恢复本次任务；会沿用原请求编号，避免重复提交。"}{stale ? " 这是旧工程版本的候选，选用后需要重新确认节拍。" : ""}</p>{music.paused && music.pending && <small>当前暂停查询，云端任务可能仍在运行和计费。</small>}</div><div className="song-button-row"><button className="button button-secondary" disabled={music.busy || !music.token.trim()} onClick={music.resume}>{music.session.jobId ? "恢复 / 刷新任务" : "重新提交上次未成功的请求（会再计一次费）"}</button>{music.pending && !music.paused && <button className="text-button" onClick={music.pause}>暂停等待</button>}</div></div>}
    {!music.job && music.recent.length > 0 && <div className="cloud-recent"><span className="song-small-label">本机服务里的最近任务（换标签页或换地址后从这里载入）</span>{music.recent.map(item => <div key={item.id}><strong>{item.continued ? "续写" : "伴奏"} · {labels[item.status]}{item.candidates ? ` · ${item.candidates} 个候选` : ""}</strong><small>{new Date(item.createdAt).toLocaleString()}　{item.prompt.slice(0, 18)}</small><button type="button" className="text-button" disabled={music.busy || !music.token.trim()} onClick={() => void music.restore(item.id)}>载入这份结果</button></div>)}<button type="button" className="text-button" onClick={() => void music.refreshRecent()}>刷新任务列表</button></div>}
    {!!music.job?.candidates.length && <div className="cloud-candidates">{music.job.candidates.map((candidate, index) => <article key={candidate.id}><span className="song-small-label">{continued ? `续写成品 ${index + 1}` : `候选 ${index + 1}`}</span><strong>{candidate.title || (continued ? "雏形续写" : "器乐伴奏")}</strong><small>{candidate.durationSec ? `${Math.round(candidate.durationSec)} 秒` : "导入后读取实际时长"}</small>{continued ? <><p className="cloud-kind">已含你的生活原声，不再叠加一遍；试听后可直接下载这份成品。</p><button className="button button-secondary" disabled={props.busy || loading} onClick={() => void playFinished(candidate)}>试听这份成品</button></> : <button className="button button-secondary" disabled={props.busy || loading} onClick={() => void choose(candidate)}>选用并试听</button>}</article>)}</div>}
    {finished && <div className="cloud-finished" role="status"><span className="song-small-label">外部续写成品</span><strong>{finished.label}</strong><p>这份音频由模型生成，前段来自你上传的雏形；它不是本地乐谱，不能撤销，也不提供独立音轨。</p><a className="button button-secondary" href={finished.url} download={`${finished.label.replace(/[^\p{L}\p{N}_-]/gu, "-")}-MelodyMate续写.mp3`}>下载这份成品 ↓</a></div>}
    {selected && !continued && <BackingMixer key={selected.id} backing={selected.buffer} label={selected.label} plan={props.plan} sources={props.sources} revision={props.revision} blocked={props.busy || loading} interrupted={props.localPlaying || props.busy || loading} onBeforePlay={props.onBeforePlay} onWork={(bytes, seconds) => props.onWork?.("mix", bytes, seconds)} />}
    <HelpCard title="为什么还要检查节拍？" role="伴奏由模型演奏，生活声音始终是独立原声轨"><p>生成时要求的速度不一定等于实际速度。我们先估测拍点，再让你试听开头、中段和结尾；轻微偏移可在校准中调整。自由速度或不断变速的伴奏暂不适合这个实验。</p><p>这里能分别调整“原声”和“整条伴奏”的音量。上方钢琴、低音、铺底滑块只影响本地编曲，不会拆开 Suno 生成的声音。导入伴奏留在浏览器，刷新后需重新选择；云端候选可恢复任务后重新载入。</p></HelpCard>
    <HelpCard title="两种用法有什么区别？" role="一种是外挂伴奏，一种会把你的声音一起交出去"><p><strong>生成独立伴奏</strong>只发送文字要求，返回一条纯器乐音轨；你的原声仍在浏览器里单独演奏、单独调音量，可以校准节拍后融合导出。</p><p><strong>把雏形交给它续写</strong>会先在本机渲染当前工程，再把这段混音上传，让模型从你指定的起点往后接写。返回的是一整条成品：前段仍是你自己的声音，但它不再能被拆开调整，也不能撤销。服务商对续写成品没有提供可核对的来源字段，所以“前段是否原样保留”需要你自己试听确认。</p></HelpCard>
  </section>;
}
