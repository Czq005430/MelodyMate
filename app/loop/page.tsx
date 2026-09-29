"use client";

import { useStudio } from "../../lib/use-studio.ts";
import SourcePanel from "../../components/SourcePanel";
import PatternEditor from "../../components/PatternEditor";
import SuggestionsPanel from "../../components/SuggestionsPanel";
import TransportBar from "../../components/TransportBar";
import CreationGuide from "../../components/CreationGuide";

export default function StudioPage() {
  const studio = useStudio();
  const quiet = studio.analysis?.quality === "nearSilent";
  return <div className="app-shell">
    <header className="app-header">
      <div className="brand"><div className="brand-mark" aria-hidden="true">m<span>m</span></div><div><h1>MelodyMate<span className="brand-dot">.</span></h1><p>把生活，做成音乐</p></div></div>
      <div className="header-meta"><span className="session-indicator" />声音实验室 <span className="header-divider">/</span><span className="mono">VOL. 001</span></div>
    </header>
    <div className="studio-intro"><div><span className="eyebrow">EVERY SOUND HAS A STORY</span><h2>你的生活，自带节奏。</h2></div><p>把一声轻敲、一点沙沙声，<br />编成你亲手参与的音乐小品。</p></div>
    <CreationGuide hasSource={Boolean(studio.project)} needsNewSelection={quiet} busy={studio.busy} onExample={() => studio.loadExample("glass")} />
    {studio.notice && <div className="app-notice" role="status">{studio.notice}</div>}
    <main className="workspace-grid">
      <SourcePanel asset={studio.asset} project={studio.project} analysis={studio.analysis} loading={studio.inputStatus === "decoding"} recording={studio.inputStatus === "recording"} disabled={studio.audioStatus === "exporting"} onFile={studio.loadFile} onRecord={studio.record} onExample={studio.loadExample} onTrim={studio.setTrim} onLabel={studio.setLabel} onOriginal={() => studio.play("original")} />
      <PatternEditor project={studio.project} analysis={studio.analysis} disabled={studio.busy || quiet} playhead={studio.audioStatus === "candidate" || studio.audioStatus === "original" ? 0 : studio.playhead} onPatch={studio.updateParams} onBackingAllowed={studio.allowBacking} />
      <SuggestionsPanel project={studio.project} analysis={studio.analysis} response={studio.response} pending={studio.pending} disabled={studio.busy || quiet} token={studio.token} onToken={studio.setToken} onExplore={() => studio.suggest("explore")} onLocalExplore={() => studio.suggest("explore", "", "global", true)} onEdit={(message, target) => studio.suggest("edit", message, target)} onPreview={proposal => studio.play("mix", proposal)} onAdopt={studio.adopt} />
    </main>
    <div className="studio-footnote"><span>原始声音留在你的浏览器里</span><span>工程仅保留在当前页面，刷新前请导出 WAV。</span></div>
    <TransportBar project={studio.project} status={studio.status} playhead={studio.playhead} playbackDuration={studio.playbackDuration} download={studio.download} canUndo={studio.canUndo} disabled={studio.busy} playable={!quiet} onPlay={() => studio.play()} onStop={studio.stop} onUndo={studio.undo} onExport={studio.exportWav} onSolo={mode => studio.play(mode)} />
  </div>;
}
