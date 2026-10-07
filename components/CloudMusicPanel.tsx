"use client";

import { useEffect, useRef, useState } from "react";
import HelpCard from "./HelpCard";
import BackingMixer from "./BackingMixer";
import { useMusicGeneration } from "../lib/use-music-generation.ts";
import { sameMusicProject } from "../lib/music-session.ts";
import { decodeBackingAudio } from "../lib/backing-audio.ts";
import type { SongPlan, SongSource } from "../lib/song-types.ts";
import type { MusicCandidate } from "../lib/music-types.ts";

type Props = { plan: SongPlan; sources: SongSource[]; revision: number; busy: boolean; localPlaying: boolean; onBeforePlay: () => void };
const labels = { submitting: "正在提交", pending: "等待生成", generating: "正在生成与保存", ready: "伴奏已准备好", failed: "生成未完成", unknown: "提交结果待确认" };

export default function CloudMusicPanel(props: Props) {
  const music = useMusicGeneration();
  const [prompt, setPrompt] = useState("温暖、松弛的钢琴伴奏，稳定四拍，给我的生活敲击声留出空间。中段有发展，结尾自然收住。不要人声，避免密集鼓组。");
  const [duration, setDuration] = useState<120 | 150 | 180>(150);
  const [selected, setSelected] = useState<{ id: string; label: string; buffer: AudioBuffer } | null>(null);
  const [loading, setLoading] = useState(false), [notice, setNotice] = useState("");
  const input = useRef<HTMLInputElement>(null), serial = useRef(0);
  useEffect(() => () => { serial.current++; }, []);
  async function load(read: () => Promise<ArrayBuffer>, label: string) {
    const ticket = ++serial.current; setLoading(true); setNotice(""); props.onBeforePlay();
    try {
      const buffer = await decodeBackingAudio(await read());
      if (serial.current === ticket) setSelected({ id: crypto.randomUUID(), label, buffer });
    } catch (error) { if (serial.current === ticket) setNotice(error instanceof Error ? error.message : "伴奏导入失败，请换一种音频格式。"); }
    finally { if (serial.current === ticket) setLoading(false); }
  }
  const choose = (candidate: MusicCandidate) => load(() => music.fetchAudio(candidate), candidate.title || "生成伴奏");
  const stale = music.job && !sameMusicProject(music.job, props.revision, props.sources.map(source => source.id));
  return <section className="song-panel cloud-music" id="song-cloud" aria-labelledby="song-cloud-title">
    <div className="cloud-heading"><div className="song-section-heading"><span>04 / MAKE IT MUSICAL</span><h2 id="song-cloud-title">让专业模型来伴奏</h2><p>让 Suno 生成器乐，再把你的真实声音放进音乐里。</p></div><span className={`cloud-badge${music.config?.configured ? " is-ready" : ""}`}>{music.config?.configured ? "Kie 接入已配置" : "先导入伴奏，也能试"}</span></div>
    <div className="cloud-columns"><form onSubmit={event => { event.preventDefault(); void music.submit({ projectRevision: props.revision, sourceIds: props.sources.map(source => source.id), brief: { prompt: prompt.trim(), bpm: props.plan.bpm, durationSec: duration, sourceLabels: props.sources.map(source => source.label) } }); }}>
      <label className="cloud-label" htmlFor="music-prompt">你想听见怎样的伴奏？</label><textarea id="music-prompt" value={prompt} maxLength={600} rows={4} onChange={event => setPrompt(event.target.value)} placeholder="例如：有轻盈钢琴的夏日午后，给杯子声留出空间" />
      <div className="cloud-form-row"><label>目标时长<select aria-label="生成伴奏目标时长" value={duration} onChange={event => setDuration(Number(event.target.value) as 120 | 150 | 180)}><option value={120}>约 2 分钟</option><option value={150}>约 2 分 30 秒</option><option value={180}>约 3 分钟</option></select></label><span>{props.plan.bpm} BPM 作为生成要求<br /><small>生成后还会检查实际节拍</small></span></div>
      <p className="song-note">只发送这段文字、速度和声音名称，原录音留在本机。每次新生成会消耗服务商账号额度。</p>
      <button className="button button-primary" type="submit" disabled={!music.config?.configured || !music.token.trim() || music.busy || music.pending || props.busy || !props.sources.length || !prompt.trim()}>生成一版伴奏 ↗</button>
      {!props.sources.length && <p className="song-note">先在上方录一种声音，或载入示例，再生成围绕它的伴奏。</p>}
      <details className="cloud-setup" open={!music.config?.configured}><summary>连接与开通指引</summary><p>{music.config?.message || "正在读取本机服务配置…"}</p><p>Kie.ai 是第三方接入服务，首页提供新用户试用额度说明；是否可用于 Suno，以你的账号显示为准。</p><a href="https://kie.ai/api-key" target="_blank" rel="noreferrer">前往 Kie 创建 API Key ↗</a><p>先将 <code>.env.example</code> 复制为 <code>.env.local</code>（已有配置时只补充），填写 <code>MUSIC_API_KEY</code>、<code>DEMO_ACCESS_TOKEN</code>，并将 <code>APP_ORIGIN</code> 设为地址栏中的网站地址，例如 http://127.0.0.1:3000。重启开发服务。不要把 API Key 填在页面里。</p><label className="cloud-label" htmlFor="music-token">本机演示口令</label><input id="music-token" type="password" autoComplete="off" value={music.token} onChange={event => music.setToken(event.target.value)} placeholder="填写 DEMO_ACCESS_TOKEN 的值" /><button type="button" className="text-button" onClick={() => void music.refreshConfig()}>重新检查配置</button></details>
    </form><div className="cloud-import"><span className="song-small-label">没有 API KEY？先试声音效果</span><h3>带一段伴奏进来</h3><p>在 Suno 网页生成并通过允许的方式下载，或选择你有权使用的伴奏。导入后，在这里加入你的生活声音。</p><input ref={input} type="file" accept="audio/*" className="sr-only" tabIndex={-1} aria-label="导入独立伴奏文件" onChange={event => { const file = event.target.files?.[0]; if (file) { if (file.size > 50 * 1024 * 1024) setNotice("请选择 50 MiB 以内的伴奏音频。"); else void load(() => file.arrayBuffer(), file.name); } event.target.value = ""; }} /><button type="button" className="button button-secondary" disabled={props.busy || loading} onClick={() => input.current?.click()}>{loading ? "正在解码伴奏…" : "导入伴奏音频 ↑"}</button><small>10 秒～6 分钟 / 50 MiB 以内<br />短于两分钟可试听，不算完整两分钟作品</small><a href="https://suno.com/create" target="_blank" rel="noreferrer">打开 Suno 网页 ↗</a></div></div>
    {(music.error || notice) && <p className="song-notice" role="alert">{notice || music.error}</p>}
    {music.session && <div className="cloud-task" role="status"><div><strong>{music.job ? labels[music.job.status] : "找到尚未确认的生成任务"}</strong><p>{music.job?.message || "输入本机演示口令，再恢复本次任务；会沿用原请求编号，避免重复提交。"}{stale ? " 这是旧工程版本的候选，选用后需要重新确认节拍。" : ""}</p>{music.paused && music.pending && <small>当前暂停查询，云端任务可能仍在运行和计费。</small>}</div><div className="song-button-row"><button className="button button-secondary" disabled={music.busy || !music.token.trim()} onClick={music.resume}>恢复 / 刷新任务</button>{music.pending && !music.paused && <button className="text-button" onClick={music.pause}>暂停等待</button>}</div></div>}
    {!!music.job?.candidates.length && <div className="cloud-candidates">{music.job.candidates.map((candidate, index) => <article key={candidate.id}><span className="song-small-label">候选 {index + 1}</span><strong>{candidate.title || "器乐伴奏"}</strong><small>{candidate.durationSec ? `${Math.round(candidate.durationSec)} 秒` : "导入后读取实际时长"}</small><button className="button button-secondary" disabled={props.busy || loading} onClick={() => void choose(candidate)}>选用并试听</button></article>)}</div>}
    {selected && <BackingMixer key={selected.id} backing={selected.buffer} label={selected.label} plan={props.plan} sources={props.sources} revision={props.revision} blocked={props.busy || loading} interrupted={props.localPlaying || props.busy || loading} onBeforePlay={props.onBeforePlay} />}
    <HelpCard title="为什么还要检查节拍？" role="伴奏由模型演奏，生活声音始终是独立原声轨"><p>生成时要求的速度不一定等于实际速度。我们先估测拍点，再让你试听开头、中段和结尾；轻微偏移可在校准中调整。自由速度或不断变速的伴奏暂不适合这个实验。</p><p>这里能分别调整“原声”和“整条伴奏”的音量。上方钢琴、低音、铺底滑块只影响本地编曲，不会拆开 Suno 生成的声音。导入伴奏留在浏览器，刷新后需重新选择；云端候选可恢复任务后重新载入。</p></HelpCard>
  </section>;
}
