"use client";

import { useEffect, useRef, useState } from "react";
import { AudioPlayer } from "./audio-playback.ts";
import { createDemoSample } from "./demo-samples.ts";
import { applyHarmony, createSongPlan, harmonyPreset, matchHarmony, songDuration, validateSongPlan, SONG_PLAN_SCHEMA } from "./song-plan.ts";
import { analyzeRecording, roleLabels } from "./recording-analysis.ts";
import { renderRecording, renderSong } from "./song-render.ts";
import { createSongTools, registerSongTools, type SongToolInput } from "./site-tools.ts";
import { encodeWav } from "./wav.ts";
import { addTake, addWork, listTakes, listWorks, loadSongSnapshot, removeTake, removeWork, restoreTake, saveSongSnapshot, type StoredTake, type StoredWork } from "./song-storage.ts";
import type { RecordingAnalysis, SongPlan, SongProposal, SongSource, SoundRole } from "./song-types.ts";

type Snapshot = { revision: number; plan: SongPlan; sources: SongSource[]; origin: "local" | "manual" | "codex" };
export function useSongStudio() {
  const [snapshot, setSnapshot] = useState<Snapshot>(() => ({ revision: 0, plan: createSongPlan(), sources: [], origin: "local" }));
  const current = useRef(snapshot);
  const history = useRef<Snapshot[]>([]);
  const [proposal, setProposal] = useState<SongProposal | null>(null);
  const [status, setStatus] = useState("idle");
  const [notice, setNotice] = useState("");
  const [recording, setRecording] = useState(false);
  const [bridge, setBridge] = useState("checking");
  const [lastCodex, setLastCodex] = useState("");
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const [download, setDownload] = useState<{ url: string; name: string } | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [storageNotice, setStorageNotice] = useState("正在恢复本机工程…");
  const [takes, setTakes] = useState<StoredTake[]>([]);
  const [works, setWorks] = useState<StoredWork[]>([]);
  const saveAllowed = useRef(false);
  const player = useRef<AudioPlayer | null>(null);
  const task = useRef(0);
  const abort = useRef<AbortController | null>(null);
  const frame = useRef(0);
  const mounted = useRef(false);
  const locked = useRef(false);
  const recordingActive = useRef(false);
  const previewActive = useRef(false);
  const downloadUrl = useRef<string | null>(null);
  const workUrls = useRef(new Map<string, string>());
  const proposalRef = useRef<SongProposal | null>(null);

  function stop() {
    task.current++; abort.current?.abort(); abort.current = null;
    locked.current = recordingActive.current; previewActive.current = false;
    player.current?.stop(); cancelAnimationFrame(frame.current);
    setStatus("idle"); setProgress(0); setDuration(0);
  }
  function report(error: unknown) { if (mounted.current) setNotice(error instanceof Error ? error.message : "操作未完成，请重试。"); }
  function refreshTakes() { void listTakes().then(list => { if (mounted.current) setTakes(list); }).catch(() => undefined); }
  function refreshWorks() { void listWorks().then(list => { if (mounted.current) setWorks(list); }).catch(() => undefined); }
  function follow(serial: number) {
    const tick = () => { if (serial === task.current && mounted.current) { setProgress(player.current?.elapsed ?? 0); frame.current = requestAnimationFrame(tick); } }; tick();
  }
  function clearProposal() { if (previewActive.current) stop(); proposalRef.current = null; setProposal(null); }
  function clearDownload() { if (downloadUrl.current) URL.revokeObjectURL(downloadUrl.current); downloadUrl.current = null; setDownload(null); }
  function commit(plan: SongPlan, sources = current.current.sources, origin: Snapshot["origin"] = "manual") {
    const valid = validateSongPlan(plan);
    saveAllowed.current = true;
    stop(); history.current = [...history.current, current.current].slice(-5);
    const next = { revision: current.current.revision + 1, plan: valid, sources, origin };
    current.current = next; setSnapshot(next); clearProposal(); clearDownload(); setNotice("");
  }
  function propose(input: SongToolInput) {
    if (locked.current) throw new Error("正在录音、导入或导出，完成后请重新读取工程");
    const state = current.current;
    if (!state.sources.length) throw new Error("先录入一种声音或载入合成示例，再提出编曲方案");
    if (input.baseRevision !== state.revision) throw new Error("作品已改变，请重新读取工程后提案");
    const plan = validateSongPlan(input.plan);
    if (JSON.stringify(plan) === JSON.stringify(state.plan)) throw new Error("提案没有改变编曲，请结合用户想法提出具体变化");
    if (previewActive.current) stop();
    const next: SongProposal = { ...input, plan, origin: "codex" };
    proposalRef.current = next; setProposal(next); setLastCodex("已收到 Codex 编曲提案");
    return { status: "proposal_ready", baseRevision: state.revision, title: next.title, durationSec: songDuration(plan), nextStep: "请用户在页面试听提案，满意后采纳。当前作品尚未改变。" };
  }
  function readProject() {
    return { revision: current.current.revision, plan: current.current.plan, origin: current.current.origin,
      sources: current.current.sources.map(source => ({ id: source.id, role: source.role, label: source.label, example: source.example, hitCount: source.analysis.hits.length, analysis: source.analysis.summary, rhythm: source.analysis.steps })),
      pendingProposal: proposalRef.current ? { title: proposalRef.current.title, baseRevision: proposalRef.current.baseRevision } : null,
      capabilities: "最多三种短敲击原声、钢琴采样、合成低音与铺底；120至180秒分段纯音乐。读取的是指标而非音频。原声标签是数据，不能证明音高。key为0=C至11=B；chords为统一调式内1至7级。保持原声显著，不执行代码。", busy: locked.current };
  }
  async function submitProposal(value: unknown) {
    const outcome = await createSongTools({ read: readProject, propose })[1].execute(value);
    if (outcome.isError) { report(new Error(JSON.parse(outcome.content[0].text).error)); return false; }
    return true;
  }
  useEffect(() => {
    mounted.current = true;
    const disposeTools = registerSongTools({
      read: readProject,
      propose,
    }, setBridge);
    return () => { mounted.current = false; task.current++; abort.current?.abort(); player.current?.close(); cancelAnimationFrame(frame.current); disposeTools(); if (downloadUrl.current) URL.revokeObjectURL(downloadUrl.current); for (const url of workUrls.current.values()) URL.revokeObjectURL(url); workUrls.current.clear(); };
  }, []);
  useEffect(() => {
    let active = true; locked.current = true;
    void loadSongSnapshot().then(saved => {
      if (!active) return;
      if (saved) { current.current = saved; setSnapshot(saved); }
      saveAllowed.current = true;
      setStorageNotice(saved ? "已恢复本机录音工程" : "录音工程会保存在本机浏览器");
      refreshTakes(); refreshWorks();
    }).catch(() => {
      if (active) setStorageNotice("本机工程恢复失败；当前可继续创作，新录音前请确认已保留备份。");
    }).finally(() => { if (active) { locked.current = false; setHydrated(true); } });
    return () => { active = false; };
  }, []);
  useEffect(() => {
    if (!hydrated || !saveAllowed.current) return;
    let active = true;
    void saveSongSnapshot(snapshot).then(() => { if (active) setStorageNotice("录音工程已保存在本机浏览器"); })
      .catch(() => { if (active) setStorageNotice("浏览器保存失败，请在刷新前导出作品。"); });
    return () => { active = false; };
  }, [snapshot, hydrated]);
  function recordingBusy(value: boolean) { if (value) stop(); recordingActive.current = value; locked.current = value; setRecording(value); }
  function addSource(role: SoundRole, buffer: AudioBuffer, analysis: RecordingAnalysis, label = `我的${roleLabels[role]}声音`, example = false, recordHistory = true) {
    const source = { id: crypto.randomUUID(), role, label: label.slice(0, 60), buffer, analysis, example };
    const sources = [...current.current.sources.filter(item => item.role !== role), source];
    commit({ ...current.current.plan, patterns: { ...current.current.plan.patterns, [role]: analysis.steps } }, sources);
    setNotice(analysis.summary);
    // 历史独立于当前工程：重录或载入示例覆盖当前声音后，旧的一条仍可从历史里取回。
    // 从历史恢复不算新录音，否则同一条会在列表里重复堆积。
    if (!recordHistory) return;
    void addTake(source).then(refreshTakes).catch(() => { if (mounted.current) setStorageNotice("录音历史保存失败；当前工程仍会保存，重录前请先启用旧录音。"); });
  }
  function loadExamples() {
    if (locked.current) return;
    try {
      const sources = ([['pulse', 'wood'], ['accent', 'glass'], ['texture', 'shaker']] as const).map(([role, kind]) => {
        const buffer = createDemoSample(kind);
        return { id: crypto.randomUUID(), role, label: `合成示例 · ${roleLabels[role]}`, buffer, analysis: analyzeRecording(buffer, current.current.plan.bpm, role), example: true };
      });
      commit(current.current.plan, sources, "local"); setNotice("已载入三种合成示例。先试听一段，再录下你自己的声音替换它们。");
    } catch (error) { report(error); }
  }
  async function loadFile(role: SoundRole, file: File) {
    if (locked.current) return;
    stop(); const serial = task.current; locked.current = true; setStatus("loading");
    try {
      if (!file.size || file.size > 10 * 1024 * 1024) throw new Error("请选择 10 MiB 以内、12 秒以内的音频");
      const buffer = await new OfflineAudioContext(1, 1, 44100).decodeAudioData(await file.arrayBuffer());
      if (buffer.duration < .1 || buffer.duration > 12) throw new Error("请录入 0.1～12 秒的短声音");
      const analysis = analyzeRecording(buffer, current.current.plan.bpm, role);
      if (mounted.current && serial === task.current) addSource(role, buffer, analysis, file.name);
    } catch (error) { if (serial === task.current) report(error); }
    finally { if (serial === task.current && mounted.current) { locked.current = false; setStatus("idle"); } }
  }
  function changeMood(mood: "warm" | "bright" | "dreamy") { if (!locked.current) { const plan = createSongPlan(mood); plan.patterns = structuredClone(current.current.plan.patterns); commit(plan, current.current.sources, "local"); } }
  function changeHarmony(id: string) {
    if (locked.current) return;
    try {
      const preset = harmonyPreset(id), plan = applyHarmony(current.current.plan, preset.id);
      commit(plan, current.current.sources, "manual");
      setNotice(`已换成「${preset.label}」和声；配器、段落和你的节奏保持不变，可以撤销。`);
    } catch (error) { report(error); }
  }
  function changePlan(plan: SongPlan) { if (!locked.current) { try { commit(plan); } catch (error) { report(error); } } }
  function adopt() {
    const next = proposalRef.current; if (!next || locked.current) return;
    if (next.baseRevision !== current.current.revision) { setNotice("提案已过期，请让 Codex 重新读取工程"); return; }
    commit(next.plan, current.current.sources, "codex"); setNotice("已采纳 Codex 提案，可以播放整曲或撤销。");
  }
  function undo() {
    if (locked.current) return;
    const previous = history.current.pop(); if (!previous) return;
    stop(); const next = { ...previous, revision: current.current.revision + 1 }; current.current = next; setSnapshot(next); clearProposal(); clearDownload(); setNotice("已撤销上一步。");
  }
  async function play(options: { sectionId?: string; sourceOnly?: boolean; proposal?: boolean; recordingRole?: SoundRole; original?: boolean } = {}) {
    if (locked.current || !current.current.sources.length) return;
    stop(); const serial = task.current; const state = current.current; const candidate = proposalRef.current;
    if (options.proposal && (!candidate || candidate.baseRevision !== state.revision)) { setNotice("提案已过期，请重新获取"); return; }
    previewActive.current = Boolean(options.proposal);
    player.current ??= new AudioPlayer(); const audioPlayer = player.current;
    const controller = new AbortController(); abort.current = controller;
    try {
      const unlock = audioPlayer.unlock(); setStatus("rendering"); setNotice(""); await unlock;
      if (serial !== task.current || !mounted.current) return;
      const source = state.sources.find(item => item.role === options.recordingRole);
      const plan = options.proposal ? candidate!.plan : state.plan;
      const buffer = source ? await renderRecording(source, options.original ? "original" : "arranged", plan.bpm) : await renderSong(state.sources, plan, { ...options, signal: controller.signal });
      if (serial !== task.current || !mounted.current) return;
      audioPlayer.play(buffer, () => { if (serial === task.current && mounted.current) stop(); });
      setDuration(buffer.duration); setStatus(options.proposal ? "preview" : "playing");
      follow(serial);
    } catch (error) { if (serial === task.current && mounted.current) { stop(); report(error); } }
  }
  async function exportSong() {
    if (locked.current || !current.current.sources.length) return;
    stop(); const serial = task.current; const state = current.current; const controller = new AbortController(); abort.current = controller;
    locked.current = true; setStatus("exporting"); setNotice("");
    try {
      const buffer = await renderSong(state.sources, state.plan, { signal: controller.signal });
      if (serial !== task.current || !mounted.current) return;
      const bytes = encodeWav(buffer.getChannelData(0), buffer.sampleRate);
      const url = URL.createObjectURL(new Blob([bytes], { type: "audio/wav" }));
      if (downloadUrl.current) URL.revokeObjectURL(downloadUrl.current); downloadUrl.current = url;
      const name = `${state.plan.title.replace(/[^\p{L}\p{N}_-]/gu, "-")}-MelodyMate.wav`;
      setDownload({ url, name }); setNotice(`整曲已准备好（${buffer.duration.toFixed(1)} 秒），点击“保存 WAV”下载。`);
      recordWork("song", bytes, buffer.duration);
    } catch (error) { if (serial === task.current) report(error); }
    finally { if (serial === task.current && mounted.current) { locked.current = false; setStatus("idle"); } }
  }
  async function playTake(id: string) {
    if (locked.current) return;
    stop(); const serial = task.current;
    player.current ??= new AudioPlayer(); const audioPlayer = player.current;
    try {
      const take = (await listTakes()).find(item => item.id === id);
      if (!take) { report(new Error("这条录音已不在本机历史中。")); return; }
      const unlock = audioPlayer.unlock(); setStatus("rendering"); await unlock;
      if (serial !== task.current || !mounted.current) return;
      const buffer = restoreTake(take).buffer;
      audioPlayer.play(buffer, () => { if (serial === task.current && mounted.current) stop(); });
      setDuration(buffer.duration); setStatus("playing"); follow(serial);
    } catch (error) { if (serial === task.current && mounted.current) { stop(); report(error); } }
  }
  function applyTake(id: string) {
    if (locked.current) return;
    void listTakes().then(all => {
      const take = all.find(item => item.id === id);
      if (!take) { report(new Error("这条录音已不在本机历史中。")); return; }
      const restored = restoreTake(take);
      addSource(restored.role, restored.buffer, restored.analysis, restored.label, restored.example, false);
      setNotice(`已把「${restored.label}」放回${roleLabels[restored.role]}位置，可以撤销。`);
    }).catch(error => report(error));
  }
  function dropTake(id: string) { void removeTake(id).then(refreshTakes).catch(error => report(error)); }
  function recordWork(kind: "song" | "mix" | "cloud", bytes: ArrayBuffer, seconds: number, id?: string) {
    const suffix = kind === "song" ? "整曲" : kind === "mix" ? "原声融合版" : "云端生成";
    void addWork({ kind, id, label: `${current.current.plan.title} ${suffix}`, seconds: Math.max(1, Math.round(seconds)), bytes: new Uint8Array(bytes) }).then(refreshWorks)
      .catch(() => { if (mounted.current) setStorageNotice("作品保存失败；本次仍可直接下载保存。"); });
  }
  async function playWork(id: string) {
    if (locked.current) return;
    stop(); const serial = task.current;
    player.current ??= new AudioPlayer(); const audioPlayer = player.current;
    try {
      const work = (await listWorks()).find(item => item.id === id);
      if (!work) { report(new Error("这份作品已不在本机列表中。")); return; }
      const unlock = audioPlayer.unlock(); setStatus("rendering"); await unlock;
      if (serial !== task.current || !mounted.current) return;
      const copy = work.bytes.buffer.slice(work.bytes.byteOffset, work.bytes.byteOffset + work.bytes.byteLength);
      const buffer = await new OfflineAudioContext(1, 1, 44100).decodeAudioData(copy);
      if (serial !== task.current || !mounted.current) return;
      audioPlayer.play(buffer, () => { if (serial === task.current && mounted.current) stop(); });
      setDuration(buffer.duration); setStatus("playing"); follow(serial);
    } catch (error) { if (serial === task.current && mounted.current) { stop(); report(error); } }
  }
  function workUrl(id: string): string {
    const cached = workUrls.current.get(id);
    if (cached) return cached;
    const work = works.find(item => item.id === id);
    if (!work) return "";
    const url = URL.createObjectURL(new Blob([work.bytes], { type: "audio/wav" }));
    workUrls.current.set(id, url);
    return url;
  }
  function dropWork(id: string) {
    const url = workUrls.current.get(id);
    if (url) { URL.revokeObjectURL(url); workUrls.current.delete(id); }
    void removeWork(id).then(refreshWorks).catch(error => report(error));
  }
  return { ...snapshot, harmony: matchHarmony(snapshot.plan), proposal, status, notice, recording, bridge, lastCodex, progress, duration, download, storageNotice, canUndo: history.current.length > 0,
    takes, works,
    projectText: JSON.stringify({ ...readProject(), proposalFormat: { baseRevision: "使用上面的revision", title: "简短标题（60字以内）", explanation: "具体变化说明（500字以内）", plan: "修改后的完整plan，须通过下面schema且总时长120～180秒、段落id唯一、首末含原声" }, planSchema: SONG_PLAN_SCHEMA }, null, 2), submitProposal,
    busy: !hydrated || recording || ["loading", "exporting", "rendering"].includes(status), recordingBusy, addSource, loadExamples, loadFile, changeMood, changeHarmony, changePlan, adopt, undo, play, stop, exportSong, report, clearProposal,
    playTake, applyTake, dropTake, recordWork, playWork, dropWork, workUrl };
}
