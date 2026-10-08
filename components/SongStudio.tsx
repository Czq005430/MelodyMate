"use client";

import { useRef, useState } from "react";
import GuidedRecorder from "./GuidedRecorder";
import HelpCard from "./HelpCard";
import CodexHandoff from "./CodexHandoff";
import CloudMusicPanel from "./CloudMusicPanel";
import { useSongStudio } from "../lib/use-song-studio.ts";
import { HARMONY_PRESETS, sectionTimings, songDuration } from "../lib/song-plan.ts";
import { roleLabels } from "../lib/recording-analysis.ts";
import type { SoundRole } from "../lib/song-types.ts";

const roles: SoundRole[] = ["pulse", "accent", "texture"];
const roleIdeas = { pulse: ["01", "敲桌面 / 木块", "稳稳托住整首歌"], accent: ["02", "拍手 / 指响", "让节奏有轻重起伏"], texture: ["03", "摇米粒 / 纸盒", "填入细小的律动"] };
const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
const noteNames = ["C", "D♭", "D", "E♭", "E", "F", "G♭", "G", "A♭", "A", "B♭", "B"];

export default function SongStudio() {
  const studio = useSongStudio();
  const [role, setRole] = useState<SoundRole>("pulse");
  const [copied, setCopied] = useState(false);
  const [worksOpen, setWorksOpen] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const source = studio.sources.find(item => item.role === role);
  const total = songDuration(studio.plan);
  const sections = sectionTimings(studio.plan);
  const hasSource = studio.sources.length > 0;
  const prompt = "请读取 MelodyMate 当前工程，保留我的生活声音作为主角，提出一个至少两分钟的编曲方案：开头留白，第二段加入温柔钢琴，中间更有节奏，结尾回到原声。请通过页面工具提交提案让我试听，不直接采纳；工具不可用时，请展开“Codex 兼容交接”读取工程并提交提案。";
  const copyPrompt = async () => { try { await navigator.clipboard.writeText(prompt); setCopied(true); } catch { studio.report("复制未完成，可以直接选中下方文字复制。"); } };
  const playing = studio.status === "playing" || studio.status === "preview";
  const stateLabel = studio.recording ? "录音中" : studio.status === "rendering" ? "正在准备音频…" : studio.status === "exporting" ? "正在导出整曲…" : studio.status === "loading" ? "正在导入…" : studio.status === "preview" ? "试听提案 · 尚未采纳" : playing ? "正在播放" : "准备就绪";

  return <div className="song-shell">
    <header className="app-header"><div className="brand"><div className="brand-mark" aria-hidden="true">m<span>m</span></div><div><h1>MelodyMate<span className="brand-dot">.</span></h1><p>把生活，做成音乐</p></div></div><div className="song-header-meta"><span className="song-live-dot" /> 本机创作室 <a href="/loop" target="_blank" rel="noreferrer">四小节实验台 ↗</a></div></header>
    <div className="song-hero"><div><span className="eyebrow">FOUND SOUNDS / YOUR FIRST SONG</span><h2>一声日常，<br />一首属于你的音乐。</h2><p>录下身边的声音，把节奏交给我们整理，<br />和 Codex 一起编成至少两分钟的器乐作品。</p></div><div className="song-first-step"><span className="song-small-label">第一次来？从这里开始</span><p>先用示例听听能做成什么，<br />再把其中一种换成你的声音。</p><button className="button button-primary" disabled={studio.busy} onClick={studio.loadExamples}>载入三种示例声音 <span aria-hidden="true">↗</span></button><small>示例为合成敲击声 · 不需要打开麦克风</small></div></div>
    <nav className="song-route" aria-label="创作步骤"><a href="#song-sounds"><b>01</b><span>收集声音<small>先录一种就可以开始</small></span></a><a href="#song-arrangement"><b>02</b><span>听见雏形<small>本地节奏与分段变化</small></span></a><a href="#song-codex"><b>03</b><span>一起改编<small>向 Codex 描述你的想法</small></span></a><a href="#song-cloud"><b>04</b><span>Suno 伴奏<small>生成或导入，再加入原声</small></span></a></nav>
    {studio.notice && <div className="song-notice" role="status">{studio.notice}</div>}
    <main className="song-workspace">
      <section className="song-panel song-sounds" id="song-sounds" aria-labelledby="song-sounds-title"><div className="song-section-heading"><span>01 / COLLECT</span><h2 id="song-sounds-title">声音是你的主角</h2><p>为身边的声音找一个位置。录一种即可，其余可以慢慢补。</p></div>
        <div className="song-role-grid">{roles.map(item => { const existing = studio.sources.find(sound => sound.role === item); return <button key={item} className={`song-role${role === item ? " is-selected" : ""}`} aria-pressed={role === item} disabled={studio.busy} onClick={() => setRole(item)}><span className="song-role-index">{roleIdeas[item][0]} <span>{existing ? existing.example ? "示例" : "已收集" : "待收集"}</span></span><strong>{roleLabels[item]}</strong><span>{roleIdeas[item][1]}</span><small>{roleIdeas[item][2]}</small></button>; })}</div>
        <HelpCard title="这三种声音，在音乐里负责什么？" role="它们一起组成节奏层"><p>骨架像脚步，稳定地带着音乐往前；重音像拍手，突出节奏的起伏；细节像沙沙声，填在拍子之间。它们都是你亲手录入的声音，不需要懂乐理。</p><p>先选短而清楚的一次敲击，别把一整段歌曲当作素材。没有准确跟上也没关系：我们会对齐可靠的敲击，或用清楚的单次声音重新编排。</p></HelpCard>
        <GuidedRecorder role={role} bpm={studio.plan.bpm} disabled={studio.busy} onRecorded={(buffer, analysis) => studio.addSource(role, buffer, analysis)} onBusy={studio.recordingBusy} onError={studio.report} />
        <div className="song-import"><input ref={input} type="file" accept="audio/*" className="sr-only" tabIndex={-1} aria-label="选择短音频" onChange={event => { const file = event.target.files?.[0]; if (file) void studio.loadFile(role, file); event.target.value = ""; }} /><button className="text-button" disabled={studio.busy} onClick={() => input.current?.click()}>或导入一段{roleLabels[role]}音频 ↗</button><span>0.1～12 秒 / 最多 10 MiB</span></div>
        {source && <div className="song-source-result"><div><span className="song-small-label">已准备好 / {source.example ? "合成示例" : "你的声音"}</span><strong>{source.label}</strong><p>{source.analysis.summary}</p></div><div className="song-button-row"><button className="button button-secondary" disabled={studio.busy} onClick={() => studio.play({ recordingRole: role, original: true })}>听原录音</button><button className="button button-secondary" disabled={studio.busy} onClick={() => studio.play({ recordingRole: role })}>听整理后的节奏</button></div></div>}
        {!!studio.takes.length && <div className="song-takes"><span className="song-small-label">录音历史 · 只存在本机浏览器</span>
          <ul>{studio.takes.map(take => <li key={take.id}><div><strong>{take.label}</strong><span>{roleLabels[take.role]}{take.example ? " · 示例" : ""} · {new Date(take.recordedAt).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}</span></div><div className="song-button-row"><button className="text-button" disabled={studio.busy} onClick={() => void studio.playTake(take.id)}>试听</button><button className="text-button" disabled={studio.busy} onClick={() => studio.applyTake(take.id)}>用这条</button><button className="text-button" disabled={studio.busy} onClick={() => studio.dropTake(take.id)}>删除</button></div></li>)}</ul>
          <small>重录或载入示例不会删除历史，随时可以把旧的一条放回对应位置；最多保留 12 条，更早的自动清理。</small>
        </div>}
      </section>
      <section className="song-panel song-arrangement" id="song-arrangement" aria-labelledby="song-arrangement-title"><div className="song-section-heading"><span>02 / ARRANGE</span><h2 id="song-arrangement-title">让声音长成一首歌</h2><p>先听一个方向。每段的乐器、力度和节奏都会变化。</p></div>
        <div className="song-moods">{([['warm', '温暖松弛', '轻敲 · 钢琴'], ['bright', '轻快出发', '明亮 · 律动'], ['dreamy', '夜色漂浮', '留白 · 铺底']] as const).map(([mood, title, detail]) => <button key={mood} disabled={studio.busy} onClick={() => studio.changeMood(mood)}><strong>{title}</strong><span>{detail}</span></button>)}</div>
        <div className="song-harmony"><span className="song-small-label">和声感觉</span><div className="song-harmony-grid" role="group" aria-label="选择和声感觉">{HARMONY_PRESETS.map(item => <button key={item.id} aria-pressed={studio.harmony === item.id} title={item.hint} disabled={studio.busy} onClick={() => studio.changeHarmony(item.id)}>{item.label}</button>)}</div><small className="song-harmony-hint">{HARMONY_PRESETS.find(item => item.id === studio.harmony)?.hint ?? "选一种感觉：只换和弦，你的节奏、段落和配器都不动。"}</small></div>
        <p className="song-note">三个方向是本地编曲初稿；Codex 可以继续修改调性、和弦、节奏和各段配器。</p>
        <div className="song-piece-heading"><div><span className="song-small-label">{studio.origin === "codex" ? "已采纳 Codex 编曲" : studio.origin === "manual" ? "当前编曲" : "本地规则初稿"}</span><h3>{studio.plan.title}</h3></div><div className="song-piece-meta"><strong>{clock(total)}</strong><span>{studio.plan.bpm} BPM · {noteNames[studio.plan.key]} {studio.plan.scale === "major" ? "大调" : "小调"}</span></div></div>
        <div className="song-timeline" aria-label="作品段落时长">{sections.map((section, index) => <span key={section.id} style={{ flex: section.durationSec, opacity: .42 + index * .1 }} title={`${section.title} ${clock(section.durationSec)}`} />)}</div>
        <ol className="song-section-list">{sections.map((timing, index) => { const section = studio.plan.sections[index]; return <li key={section.id}><span className="song-section-time">{clock(timing.startSec)}</span><div><strong>{section.title}</strong><span>{section.sourceRoles.length ? "生活原声" : "伴奏过渡"}{section.piano !== "off" ? section.piano === "arpeggio" ? " + 钢琴分解" : " + 钢琴和弦" : ""}{section.bass ? " + 低音" : ""}{section.pad ? " + 铺底" : ""}</span></div><span className="song-section-bars">{section.bars} 小节</span><button className="song-preview" disabled={!hasSource || studio.busy} onClick={() => studio.play({ sectionId: section.id })} aria-label={`试听${section.title}`}>▷</button></li>; })}</ol>
        <HelpCard title="钢琴、低音和铺底，分别带来什么？" role="它们组成伴奏层，围绕你的声音演奏"><p>钢琴和弦像几种颜色同时出现，决定温暖或忧伤的感觉；分解和弦把这些音一个个弹出，让音乐更流动。低音负责厚度，铺底是背后轻轻延续的长音。</p><p>伴奏使用同一个调式。第一版适合短敲击素材；杯子等带明确音高的声音可能与伴奏冲突，可以降低伴奏或让 Codex 改调后试听。</p></HelpCard>
        <div className="song-mixer">{([['piano', '钢琴', .5], ['bass', '低音', .3], ['pad', '铺底', .25]] as const).map(([key, label, max]) => <label key={key}><span>{label}<small>{Math.round(studio.plan.mix[key] / max * 100)}%</small></span><input aria-label={`${label}伴奏音量`} type="range" min="0" max={max} step="0.01" value={studio.plan.mix[key]} disabled={studio.busy} onChange={event => studio.changePlan({ ...studio.plan, mix: { ...studio.plan.mix, [key]: Number(event.target.value) } })} /></label>)}</div>
      </section>
      <aside className="song-panel song-codex" id="song-codex" aria-labelledby="song-codex-title"><div className="song-section-heading"><span>03 / CO-CREATE</span><h2 id="song-codex-title">说说你想听见什么</h2><p>在当前 Codex 对话里描述感觉，让它把想法变成编曲提案。</p></div>
        <div className={`song-connection ${studio.bridge === "ready" ? "is-ready" : ""}`} role="status"><i />{studio.bridge === "ready" ? "页面工具就绪 · 等待 Codex 提案" : studio.bridge === "checking" ? "正在检查本机连接…" : "页面工具不可用 · 可让 Codex 使用下方兼容交接"}</div>
        <div className="song-codex-instruction"><span className="song-small-label">可以这样对 Codex 说</span><p>{prompt}</p><button className="button button-secondary" onClick={copyPrompt}>{copied ? "已复制，可粘贴到 Codex" : "复制这段创作想法"}</button></div>
        <div className="song-codex-ideas"><strong>不用说专业术语</strong><p>“钢琴少一点，保留桌面声。”</p><p>“中间像走进热闹的街道，结尾安静下来。”</p><p>“我喜欢第二段，让它的旋律更流动。”</p></div>
        <CodexHandoff project={studio.projectText} disabled={studio.busy} onSubmit={studio.submitProposal} />
        {studio.proposal ? <div className="song-proposal"><span className="song-small-label">CODEX 提案 / 等你试听</span><h3>{studio.proposal.title}</h3><p>{studio.proposal.explanation}</p><span className="song-proposal-duration">{clock(songDuration(studio.proposal.plan))} · {studio.proposal.plan.sections.length} 个段落 · 原版本仍保留</span><div className="song-button-row"><button className="button button-secondary" disabled={studio.busy} onClick={() => studio.play({ proposal: true })}>试听提案</button><button className="button button-primary" disabled={studio.busy} onClick={studio.adopt}>采纳编曲</button><button className="text-button" disabled={studio.busy} onClick={studio.clearProposal}>放弃</button></div></div> : <div className="song-proposal-empty"><span aria-hidden="true">✳</span><p>{studio.lastCodex ? "上次提案已处理。继续聊聊，试试另一种感觉。" : "你的下一种可能，\n会在这里成为提案。"}</p></div>}
        <HelpCard title="这次的 AI 到底做了什么？" role="本机 Codex 负责理解想法和编曲，不直接生成音频"><p>Codex 读取段落、节奏和录音分析摘要，提出新的和弦、配器及结构；浏览器用你的声音和钢琴采样把它演奏出来。原始录音不通过页面工具上传，Codex 也没有直接听见录音。</p><p>这里复用当前 Codex 对话；页面本身不自动调用模型。每次修改先成为提案，由你试听和采纳。本地初稿随时可用。</p></HelpCard>
      </aside>
    </main>
    <CloudMusicPanel plan={studio.plan} sources={studio.sources} revision={studio.revision} busy={studio.busy} localPlaying={playing} onBeforePlay={studio.stop} onWork={(kind, bytes, seconds, id) => studio.recordWork(kind, bytes, seconds, id)} />
    <div className="song-footnote"><span>原录音不上传 · {studio.storageNotice}。</span><a href="/audio/piano/SOURCES.md" target="_blank" rel="noreferrer">钢琴采样：Alexander Holm / CC BY 3.0 ↗</a></div>
    <footer className="song-player">{worksOpen && <div className="song-works" role="region" aria-label="本机导出的作品">
      <div className="song-works-head"><span className="song-small-label">本机作品 · {studio.works.length} 份</span><small>只存在本机浏览器，最多保留 6 份；要长期保存请下载。</small></div>
      {studio.works.length ? <ul>{studio.works.map(work => <li key={work.id}><div><strong>{work.label}</strong><span>{work.kind === "song" ? "整曲 · 单声道" : "原声融合 · 立体声"} · {clock(work.seconds)}</span></div><div className="song-button-row"><button className="text-button" disabled={studio.busy} onClick={() => void studio.playWork(work.id)}>播放</button><a className="text-button" href={studio.workUrl(work.id)} download={`${work.label.replace(/[^\p{L}\p{N}_-]/gu, "-")}.wav`}>下载</a><button className="text-button" disabled={studio.busy} onClick={() => studio.dropWork(work.id)}>删除</button></div></li>)}</ul> : <p className="song-note">还没有导出记录。点“导出整曲”或“导出原声融合版”之后，成品会列在这里，可以随时回放或下载。</p>}
    </div>}<div className="song-player-info"><span className="song-small-label">{stateLabel}</span><strong>{studio.plan.title}</strong><div className="song-progress"><progress max={studio.duration || total} value={studio.progress} aria-label="播放进度" /><span>{clock(studio.progress)} / {clock(studio.duration || total)}</span></div></div><div className="song-player-actions"><button className="button button-primary" disabled={!hasSource || studio.busy} onClick={() => studio.play()}>▶ 播放整曲</button><button className="button button-secondary" disabled={studio.recording || studio.status === "idle"} onClick={studio.stop}>停止</button><button className="text-button" disabled={!hasSource || studio.busy} onClick={() => studio.play({ sourceOnly: true })}>只听生活声音</button><button className="text-button" disabled={!studio.canUndo || studio.busy} onClick={studio.undo}>撤销</button><button className="button button-secondary" disabled={!hasSource || studio.busy} onClick={studio.exportSong}>导出整曲</button>{studio.download && <a className="song-save" href={studio.download.url} download={studio.download.name}>保存 WAV ↓</a>}<button className="text-button" aria-expanded={worksOpen} onClick={() => setWorksOpen(open => !open)}>{worksOpen ? "收起作品列表" : `作品 ${studio.works.length}`}</button></div></footer>
  </div>;
}
