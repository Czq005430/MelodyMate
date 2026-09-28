"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { expandArrangement } from "../lib/arrangement";
import type { MusicParams, Project, SourceAnalysis, Step } from "../lib/types";
import HelpCard from "./HelpCard";

type Props = { project: Project | null; analysis: SourceAnalysis | null; disabled: boolean; playhead: number; onPatch: (patch: Partial<MusicParams>) => void; onBackingAllowed: (allowed: boolean) => void };

function Slider({ label, value, min, max, step, disabled, onCommit }: { label: string; value: number; min: number; max: number; step: number; disabled: boolean; onCommit: (value: number) => void }) {
  const [draft, setDraft] = useState(value);
  const valueRef = useRef(value);
  const committed = useRef(value);
  useEffect(() => { valueRef.current = value; committed.current = value; setDraft(value); }, [value]);
  const commit = () => { if (!disabled && Math.abs(valueRef.current - committed.current) > 1e-8) { committed.current = valueRef.current; onCommit(valueRef.current); } };
  return <label className="slider-control"><span>{label}<output className="mono">{Math.round(draft * 100)}%</output></span><input type="range" min={min} max={max} step={step} value={draft} disabled={disabled} onChange={(event) => { valueRef.current = Number(event.target.value); setDraft(valueRef.current); }} onPointerUp={commit} onKeyUp={commit} onBlur={commit} /></label>;
}

export default function PatternEditor({ project, analysis, disabled, playhead, onPatch, onBackingAllowed }: Props) {
  const params = project?.params;
  const unavailable = disabled || !project || !analysis || analysis.quality === "nearSilent";
  const events = useMemo(() => params ? expandArrangement(params) : [], [params]);
  const steps = params?.steps ?? Array<Step>(16).fill(0);
  const selectedCount = steps.filter(Boolean).length;
  const activeStep = playhead > 0 && playhead < 1 ? Math.floor(playhead * 64) : -1;
  const toggleStep = (index: number) => {
    if (unavailable || !params || (params.steps[index] === 1 && selectedCount === 1)) return;
    onPatch({ steps: params.steps.map((value, i): Step => i === index ? value === 1 ? 0 : 1 : value) });
  };
  return <section className="panel pattern-panel" aria-labelledby="pattern-heading">
    <div className="panel-heading"><span className="section-index mono">02</span><div><h2 id="pattern-heading">给声音一点节奏</h2><p>点亮方格安排原声，先从每拍一声开始。</p></div><span className="small-tag mono">4 小节</span></div>
    <HelpCard title="这 16 格怎么看？" role="节奏 · 决定声音何时出现"><p>每 4 格是一拍：亮格会响，暗格留空。每次响起的都是你选中的那一小段原声，格子之间的空白也属于节奏。</p><p className="help-example">试试看：在下方选择「循环铺开」，只亮起第 1、5、9、13 格，听每拍一声；再加入或关掉一格，听听区别。</p></HelpCard>
    <div className="pattern-intro"><div><span className="eyebrow">你的节奏种子</span><h3>{project?.sourceLabel || "等待第一段声音"}</h3></div><span className="pattern-meter mono">4<span>/</span>4</span></div>
    <div className="beat-counts mono" aria-hidden="true">{[1, 2, 3, 4].map((beat) => <span key={beat}>{beat}<small>拍</small></span>)}</div>
    <div className="step-grid">{steps.map((value, index) => <button type="button" key={index} className={`step ${value ? "is-on" : ""} ${activeStep % 16 === index ? "is-playing" : ""} ${index % 4 === 0 ? "beat-start" : ""}`} aria-label={`第 ${index + 1} 格${value ? "，已启用" : "，未启用"}${value && selectedCount === 1 ? "，至少保留一格" : ""}`} aria-pressed={Boolean(value)} disabled={unavailable || Boolean(value && selectedCount === 1)} onClick={() => toggleStep(index)}><span className="step-light" /><span className="mono">{String(index + 1).padStart(2, "0")}</span></button>)}</div>
    <div className="pattern-caption"><span>每一格，都是你选中的那段原声。</span><span className="mono">{selectedCount} / 16</span></div>
    <div className="editor-controls">
      <div className="control-row"><span className="control-label">速度</span><div className="segmented">{([80, 100, 120] as const).map((bpm) => <button type="button" key={bpm} className={params?.bpm === bpm ? "is-selected" : ""} aria-pressed={params?.bpm === bpm} disabled={unavailable} onClick={() => onPatch({ bpm })}><span className="mono">{bpm}</span><small>{bpm === 80 ? "松弛" : bpm === 100 ? "轻快" : "跃动"}</small></button>)}</div></div>
      <div className="control-row"><span className="control-label">原声音色</span><div className="segmented compact">{(["original", "soft"] as const).map((tone) => <button type="button" key={tone} className={params?.sourceTone === tone ? "is-selected" : ""} aria-pressed={params?.sourceTone === tone} disabled={unavailable} onClick={() => onPatch({ sourceTone: tone })}>{tone === "original" ? "保留原味" : "柔和一点"}</button>)}</div></div>
      <Slider label="原声音量" value={params?.sourceGain ?? .8} min={.5} max={1} step={.01} disabled={unavailable} onCommit={(sourceGain) => onPatch({ sourceGain })} />
      <HelpCard title="怎样让声音更慢、更柔和？" role="速度与音色 · 调整听起来的感觉"><p>速度决定拍子走得多快：80 比较慢，120 比较快。「柔和一点」会减弱尖锐感，不改变音高；原声音量控制这段声音的轻重。</p><p className="help-example">试试看：把速度从 100 改成 80，播放一次；再切换「柔和一点」，比较同一段原声。</p></HelpCard>
    </div>
    <div className="arrangement-section"><div className="label-row"><span>四小节小作品</span><div className="segmented compact tiny">{(["repeat", "mini"] as const).map((structure) => <button type="button" key={structure} className={params?.structurePreset === structure ? "is-selected" : ""} aria-pressed={params?.structurePreset === structure} disabled={unavailable} onClick={() => onPatch({ structurePreset: structure })}>{structure === "repeat" ? "循环铺开" : "有起有落"}</button>)}</div></div>
      <HelpCard title="四小节是一段多长的音乐？" role="结构 · 安排开头、变化与结尾"><p>一个小节有 4 拍，上面的 16 格组成一个小节。这里把它展开为四小节，随速度不同约有 8—12 秒。「循环铺开」重复这套节奏；「有起有落」会安排进入、变化和结尾。</p><p className="help-example">试试看：保持节奏不变，分别播放两种结构，听听第一小节和最后一小节的不同。</p></HelpCard>
      <div className="arrangement-grid" role="img" aria-label={`四小节编排预览，${params?.structurePreset === "mini" ? "有起有落" : "循环铺开"}，${events.length} 次原声触发`}>{Array.from({ length: 4 }, (_, bar) => <div className="arrangement-row" key={bar}><span className="mono">0{bar + 1}</span><div>{Array.from({ length: 16 }, (_, step) => <i key={step} className={`${events.some((event) => event.bar === bar && event.step === step) ? "is-filled" : ""} ${activeStep === bar * 16 + step ? "is-playing" : ""}`} />)}</div></div>)}</div>
      <div className="arrangement-progress"><span style={{ width: `${Math.max(0, Math.min(1, playhead)) * 100}%` }} /></div><p className="fine-print">编排会跟随上面的节奏变化。</p>
    </div>
    <div className="backing-section"><HelpCard title="伴奏会加进什么声音？" role="和弦背景 · 轻轻衬托原声"><p>和弦是铺在后面的背景声音，原声节奏仍是主角。原声足够清晰时，先勾选下面的许可，再选择一套和声预置；只勾选许可不会自动加入伴奏。</p><p className="help-example">试试看：选「暖色和声」并播放，再切回「暂不加入」。如果不搭，随时关掉伴奏。</p></HelpCard><label className="backing-permission"><input type="checkbox" checked={project?.backingAllowed ?? false} disabled={unavailable} onChange={(event) => onBackingAllowed(event.target.checked)} /><span>为原声加一点和声<small>轻轻托住声音，由你决定是否加入。</small></span><span className="permission-mark">可选</span></label>
      {project?.backingAllowed && analysis?.quality === "usable" && <div className="backing-options"><div className="segmented compact">{(["off", "p1", "p2"] as const).map((preset) => <button type="button" key={preset} className={params?.backingPreset === preset ? "is-selected" : ""} aria-pressed={params?.backingPreset === preset} disabled={unavailable} onClick={() => onPatch({ backingPreset: preset })}>{preset === "off" ? "暂不加入" : preset === "p1" ? "暖色和声" : "轻盈和声"}</button>)}</div><Slider label="伴奏音量" value={params?.backingGain ?? .06} min={0} max={.12} step={.01} disabled={unavailable || params?.backingPreset === "off"} onCommit={(backingGain) => onPatch({ backingGain })} /></div>}
      {project?.backingAllowed && analysis?.quality !== "usable" && <p className="fine-print">先选择一段更清晰的原声，再加入伴奏。</p>}
    </div>
  </section>;
}
