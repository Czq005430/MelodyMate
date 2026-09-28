"use client";

import { useEffect, useReducer, useRef, useState } from "react";
import { createProject, initialProjectState, projectReducer } from "./project.ts";
import type { ProjectAction } from "./project.ts";
import type { MusicParams, Project, Proposal, SourceAnalysis, SourceAsset, SuggestRequest, SuggestResponse, SuggestTarget, Trim } from "./types.ts";
import { analyzeSource, suggestTrim } from "./source-analysis.ts";
import { assertPlayable, validatePatch, validateProject } from "./validation.ts";
import { createPresetSuggestions } from "./presets.ts";
import { fetchSuggestions } from "./suggestion-client.ts";
import { decodeAudio, startRecording } from "./audio-input.ts";
import { AudioPlayer } from "./audio-playback.ts";
import { renderProject } from "./audio-render.ts";
import { createDemoSample } from "./demo-samples.ts";
import { encodeWav } from "./wav.ts";

type Mode = "mix" | "source" | "backing";
const exampleNames = { glass: "合成示例 · 玻璃轻敲", wood: "合成示例 · 木头敲击", shaker: "合成示例 · 沙沙声" };

export function useStudio() {
  const [state, dispatch] = useReducer(projectReducer, initialProjectState);
  const [asset, setAsset] = useState<SourceAsset | null>(null);
  const [analysis, setAnalysis] = useState<SourceAnalysis | null>(null);
  const [response, setResponse] = useState<SuggestResponse | null>(null);
  const [pending, setPending] = useState(false);
  const [token, setToken] = useState("");
  const [inputStatus, setInputStatus] = useState("idle");
  const [audioStatus, setAudioStatus] = useState("idle");
  const [playhead, setPlayhead] = useState(0);
  const [playbackDuration, setPlaybackDuration] = useState<number | null>(null);
  const [notice, setNotice] = useState("");
  const [download, setDownload] = useState<{ url: string; name: string } | null>(null);
  const downloadUrl = useRef<string | null>(null);
  const current = useRef(state);
  const source = useRef<SourceAsset | null>(null);
  const sourceAnalysis = useRef<SourceAnalysis | null>(null);
  const player = useRef<AudioPlayer | null>(null);
  const mounted = useRef(false);
  const loadSerial = useRef(0);
  const playSerial = useRef(0);
  const suggestSerial = useRef(0);
  const requestAbort = useRef<AbortController | null>(null);
  const recording = useRef<Awaited<ReturnType<typeof startRecording>> | null>(null);
  const exporting = useRef(false);
  const frame = useRef(0);
  const cache = useRef(new Map<string, Promise<AudioBuffer>>());

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false; loadSerial.current++; playSerial.current++; suggestSerial.current++;
      requestAbort.current?.abort(); recording.current?.stop(); player.current?.close();
      cancelAnimationFrame(frame.current); cache.current.clear();
      if (downloadUrl.current) URL.revokeObjectURL(downloadUrl.current);
    };
  }, []);

  function stop() {
    playSerial.current++; player.current?.stop(); cancelAnimationFrame(frame.current);
    setPlayhead(0); setPlaybackDuration(null);
    if (!exporting.current) setAudioStatus("idle");
  }
  function invalidate() {
    stop(); suggestSerial.current++; requestAbort.current?.abort(); requestAbort.current = null;
    setPending(false); setResponse(null); cache.current.clear();
  }
  function fail(error: unknown) {
    if (mounted.current) setNotice(error instanceof Error ? error.message : "操作没有完成，请再试一次。");
  }
  function transition(action: ProjectAction) {
    const next = projectReducer(current.current, action);
    if (next === current.current || !next.project || !source.current) return;
    const computed = analyzeSource(source.current.buffer, source.current.id, next.project.trim);
    validateProject(next.project, computed.analysis);
    invalidate(); current.current = next; sourceAnalysis.current = computed.analysis;
    dispatch(action); setAnalysis(computed.analysis); setNotice("");
  }
  function acceptSource(buffer: AudioBuffer, name: string) {
    const id = crypto.randomUUID();
    const computed = analyzeSource(buffer, id, suggestTrim(buffer));
    const project = createProject(id, name, buffer.duration, computed.trim);
    const nextAsset = { id, name, buffer };
    source.current = nextAsset; setAsset(nextAsset);
    transition({ type: "load", project });
  }
  function beginLoad() {
    if (exporting.current) throw new Error("正在导出，请稍候");
    recording.current?.stop(); recording.current = null; invalidate();
    const serial = ++loadSerial.current; setInputStatus("decoding"); setNotice(""); return serial;
  }
  async function loadFile(file: File) {
    let serial = 0;
    try {
      serial = beginLoad(); const buffer = await decodeAudio(file);
      if (serial === loadSerial.current && mounted.current) acceptSource(buffer, file.name.replace(/\.[^.]+$/, ""));
    } catch (error) { if (!serial || serial === loadSerial.current) fail(error); }
    finally { if (serial === loadSerial.current && mounted.current) setInputStatus("idle"); }
  }
  function loadExample(kind: keyof typeof exampleNames) {
    try { beginLoad(); acceptSource(createDemoSample(kind), exampleNames[kind]); }
    catch (error) { fail(error); }
    finally { setInputStatus("idle"); }
  }
  async function record() {
    if (exporting.current) return;
    if (inputStatus === "recording") {
      if (recording.current) recording.current.stop();
      else { loadSerial.current++; setInputStatus("idle"); }
      return;
    }
    const serial = beginLoad(); setInputStatus("recording");
    try {
      const session = await startRecording();
      if (serial !== loadSerial.current || !mounted.current) { session.stop(); await session.result.catch(() => {}); return; }
      recording.current = session;
      const blob = await session.result;
      if (serial !== loadSerial.current || !mounted.current) return;
      recording.current = null; setInputStatus("decoding");
      const buffer = await decodeAudio(blob, true);
      if (serial === loadSerial.current && mounted.current) acceptSource(buffer, "我的生活声音");
    } catch (error) { if (serial === loadSerial.current) fail(error); }
    finally { if (serial === loadSerial.current && mounted.current) { recording.current = null; setInputStatus("idle"); } }
  }
  function updateParams(patch: Partial<MusicParams>) {
    try {
      if (exporting.current || !current.current.project || !sourceAnalysis.current) return;
      const project = current.current.project;
      const valid = validatePatch(patch, "global", project, sourceAnalysis.current);
      transition({ type: "commit", project: { ...project, params: { ...project.params, ...valid } } });
    } catch (error) { fail(error); }
  }
  function setTrim(trim: Trim) {
    try {
      if (exporting.current || !current.current.project || !source.current) return;
      const computed = analyzeSource(source.current.buffer, source.current.id, trim);
      const project = current.current.project;
      transition({ type: "commit", project: { ...project, trim: computed.trim, backingAllowed: false, params: { ...project.params, backingPreset: "off" } } });
    } catch (error) { fail(error); }
  }
  function setLabel(label: string) {
    try { if (!exporting.current && current.current.project) transition({ type: "commit", project: { ...current.current.project, sourceLabel: label.trim() || "声音 1" } }); }
    catch (error) { fail(error); }
  }
  function allowBacking(allowed: boolean) {
    try {
      const project = current.current.project;
      if (!project || exporting.current) return;
      if (allowed && sourceAnalysis.current?.quality !== "usable") throw new Error("原声太轻，请先重新录制或选择更清楚的片段");
      transition({ type: "commit", project: { ...project, backingAllowed: allowed, params: { ...project.params, backingPreset: allowed ? project.params.backingPreset : "off" } } });
    } catch (error) { fail(error); }
  }
  function undo() { try { if (!exporting.current) transition({ type: "undo" }); } catch (error) { fail(error); } }

  function render(project: Project, mode: Mode): Promise<AudioBuffer> {
    const asset = source.current;
    if (!asset || asset.id !== project.sourceId) return Promise.reject(new Error("素材已改变，请重新试听"));
    if (mode !== "mix") return renderProject(asset.buffer, project, mode);
    const key = JSON.stringify([project.sourceId, project.revision, project.trim, project.params]);
    let result = cache.current.get(key);
    if (!result) {
      result = renderProject(asset.buffer, project); cache.current.set(key, result);
      while (cache.current.size > 3) cache.current.delete(cache.current.keys().next().value!);
      void result.catch(() => { if (cache.current.get(key) === result) cache.current.delete(key); });
    }
    return result;
  }
  async function play(mode: Mode | "original" = "mix", proposal?: Proposal) {
    if (exporting.current) return;
    const project = current.current.project; const asset = source.current;
    if (!project || !asset || !sourceAnalysis.current) return;
    stop(); const serial = playSerial.current;
    player.current ??= new AudioPlayer();
    const audioPlayer = player.current;
    try {
      let preview = project;
      if (proposal) {
        if (response?.baseRevision !== project.revision) throw new Error("这个建议已过期，请重新探索");
        const patch = validatePatch(proposal.patch, "global", project, sourceAnalysis.current);
        preview = { ...project, params: { ...project.params, ...patch } };
      }
      const unlocked = audioPlayer.unlock(); // 在任何异步渲染之前解除浏览器播放限制。
      setAudioStatus("rendering"); setNotice(""); await unlocked;
      if (serial !== playSerial.current || !mounted.current) return;
      let buffer: AudioBuffer;
      if (mode === "original") {
        const { startFrame, endFrame, sampleRate } = sourceAnalysis.current;
        buffer = new AudioBuffer({ length: endFrame - startFrame, numberOfChannels: asset.buffer.numberOfChannels, sampleRate });
        for (let c = 0; c < buffer.numberOfChannels; c++) buffer.copyToChannel(asset.buffer.getChannelData(c).slice(startFrame, endFrame), c);
      } else buffer = await render(preview, mode);
      if (serial !== playSerial.current || !mounted.current || current.current.project?.revision !== project.revision) return;
      audioPlayer.play(buffer, () => { if (serial === playSerial.current && mounted.current) stop(); });
      setAudioStatus(proposal ? "candidate" : mode === "original" ? "original" : "playing");
      setPlaybackDuration(buffer.duration);
      const tick = () => {
        if (serial !== playSerial.current || !mounted.current) return;
        setPlayhead(Math.min(1, audioPlayer.elapsed / buffer.duration)); frame.current = requestAnimationFrame(tick);
      };
      tick();
    } catch (error) { if (serial === playSerial.current) { stop(); fail(error); } }
  }
  async function exportWav() {
    const project = current.current.project;
    if (!project || !sourceAnalysis.current || exporting.current) return;
    try {
      assertPlayable(project, sourceAnalysis.current); stop(); exporting.current = true;
      setAudioStatus("exporting"); setNotice("");
      const buffer = await render(structuredClone(project), "mix");
      if (!mounted.current) return;
      const bytes = encodeWav(buffer.getChannelData(0), buffer.sampleRate);
      const url = URL.createObjectURL(new Blob([bytes], { type: "audio/wav" }));
      const name = `${project.sourceLabel.replace(/[^\p{L}\p{N}_-]/gu, "-")}-MelodyMate.wav`;
      if (downloadUrl.current) URL.revokeObjectURL(downloadUrl.current);
      downloadUrl.current = url; setDownload({ url, name });
      const link = document.createElement("a"); link.href = url;
      link.download = name;
      document.body.appendChild(link); link.click(); link.remove();
      setNotice("WAV 已就绪。如下载没有开始，可点击播放器右侧的“保存上次导出”。");
    } catch (error) { fail(error); }
    finally { exporting.current = false; if (mounted.current) setAudioStatus("idle"); }
  }
  async function suggest(mode: "explore" | "edit", message = "", target: SuggestTarget = "global", local = false) {
    const project = current.current.project; const analysis = sourceAnalysis.current;
    if (!project || !analysis || pending || exporting.current) return;
    let serial = 0; let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      assertPlayable(project, analysis);
      const snapshot: SuggestRequest = structuredClone({ mode, target, project, analysis, message });
      if (mode === "edit" && !token) throw new Error("请先在 AI 连接设置中填写演示口令。也可以直接修改节奏和音量。");
      stop(); serial = ++suggestSerial.current; setPending(true); setResponse(null); setNotice("");
      let result: SuggestResponse;
      if (local || !token) result = createPresetSuggestions(snapshot);
      else {
        const abort = new AbortController(); requestAbort.current = abort;
        timeout = setTimeout(() => abort.abort(), 13000);
        result = await fetchSuggestions(snapshot, token, abort.signal);
      }
      if (serial === suggestSerial.current && mounted.current && current.current.project?.revision === project.revision) setResponse(result);
    } catch (error) { if (!serial || serial === suggestSerial.current) fail(error); }
    finally {
      clearTimeout(timeout);
      if (serial === suggestSerial.current && mounted.current) { setPending(false); requestAbort.current = null; }
    }
  }
  function adopt(proposal: Proposal) {
    const project = current.current.project;
    if (!project || response?.baseRevision !== project.revision) { setNotice("这个建议已过期，请重新探索。"); return; }
    updateParams(proposal.patch);
  }

  const busy = inputStatus !== "idle" || audioStatus === "exporting";
  const status = inputStatus === "recording" ? "录音中 · 约 2 秒" : inputStatus === "decoding" ? "正在读取声音" : ({ idle: asset ? "准备好了，听听你的作品" : "先收集一个有趣的声音", rendering: "正在编排声音…", playing: "正在播放作品", candidate: "试听建议 · 尚未采纳", original: "试听原始片段", exporting: "正在导出 WAV…" }[audioStatus] || "准备就绪");
  return { project: state.project, asset, analysis, response, pending, token, setToken, inputStatus, audioStatus, playhead, playbackDuration, notice, download, status, busy, canUndo: state.history.length > 0,
    loadFile, loadExample, record, setTrim, setLabel, updateParams, allowBacking, undo, stop, play, exportWav, suggest, adopt };
}
