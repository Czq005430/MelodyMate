"use client";

import { useEffect, useRef, useState } from "react";
import type { Project, SourceAnalysis, SourceAsset, Trim } from "../lib/types";
import Icon, { type IconName } from "./Icons";
import Waveform from "./Waveform";
import HelpCard from "./HelpCard";

type Props = {
  asset: SourceAsset | null; project: Project | null; analysis: SourceAnalysis | null;
  loading: boolean; recording: boolean; disabled: boolean;
  onFile: (file: File) => void; onRecord: () => void;
  onExample: (kind: "glass" | "wood" | "shaker") => void;
  onTrim: (trim: Trim) => void; onLabel: (value: string) => void; onOriginal: () => void;
};

const examples: { kind: "glass" | "wood" | "shaker"; name: string; detail: string; icon: IconName }[] = [
  { kind: "glass", name: "轻敲玻璃", detail: "清脆", icon: "glass" },
  { kind: "wood", name: "敲击木块", detail: "温暖", icon: "wood" },
  { kind: "shaker", name: "沙沙摇响", detail: "细碎", icon: "shaker" },
];

export default function SourcePanel({ asset, project, analysis, loading, recording, disabled, onFile, onRecord, onExample, onTrim, onLabel, onOriginal }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [label, setLabel] = useState(project?.sourceLabel ?? "");
  const busy = disabled || loading;
  useEffect(() => setLabel(project?.sourceLabel ?? ""), [project?.sourceLabel, project?.sourceId]);
  const saveLabel = () => { if (!project) return; if (!label.trim()) { setLabel(project.sourceLabel); return; } if (label.trim() !== project.sourceLabel) onLabel(label.trim()); };
  return <section className="panel source-panel" aria-labelledby="source-heading">
    <div className="panel-heading"><span className="section-index mono">01</span><div><h2 id="source-heading">一段生活里的声音</h2><p>录一声，再选取其中 50—500 毫秒。</p></div></div>
    <HelpCard title="这一声怎样变成音乐？" role="声音素材 · 你的小乐器"><p>选出 50—500 毫秒的一小段声音，每个亮起的节奏格都会重复播放它。你提供的是一个发声瞬间，四小节作品会在后面的编排中形成，无需准备一首完整歌曲。</p><p>「听原始片段」保留原始音量，方便确认选区。播放编排作品时，系统会在有限范围内自动调整原声幅度。</p><p className="help-example">试试看：载入「轻敲玻璃」，拖动波形选区，再点「听原始片段」确认这一声。</p></HelpCard>
    <input ref={inputRef} type="file" className="sr-only" tabIndex={-1} aria-label="选择声音文件" accept=".wav,.mp3,audio/wav,audio/x-wav,audio/mpeg" disabled={busy || recording} onChange={(event) => { const file = event.target.files?.[0]; if (file) onFile(file); event.target.value = ""; }} />
    <div className={`source-drop ${asset ? "has-source" : ""} ${dragOver ? "is-dragging" : ""}`} onDragOver={(event) => { event.preventDefault(); if (!busy && !recording) setDragOver(true); }} onDragLeave={() => setDragOver(false)} onDrop={(event) => { event.preventDefault(); setDragOver(false); const file = event.dataTransfer.files[0]; if (file && !busy && !recording) onFile(file); }}>
      {!asset && <><div className="source-glyph"><Icon name="mic" size={30} /></div><h3>先录下一声轻敲</h3><p>靠近麦克风，点录音后轻敲一次。<br />也可以先试下面的合成示例。</p></>}
      {asset && <div className="source-file"><span className="source-file-dot" /><span title={asset.name}>{asset.name}</span><span className="mono">{(asset.buffer.length / asset.buffer.sampleRate).toFixed(1)} 秒</span></div>}
      <div className="source-actions"><button type="button" className={`button ${recording ? "button-recording" : "button-primary"}`} disabled={busy && !recording} onClick={onRecord}><Icon name={recording ? "stop" : "mic"} />{recording ? "结束录音" : "录一段声音"}</button><button type="button" className="button button-secondary" disabled={busy || recording} onClick={() => inputRef.current?.click()}><Icon name="upload" />{asset ? "替换文件" : "上传文件"}</button></div>
      <p className="fine-print">{recording ? "正在录音，约 2 秒后自动结束，也可手动提前结束。" : loading ? "正在准备你的声音……" : "可拖入 WAV / MP3 音频 · ≤10 秒 / 10 MiB"}</p>
      {!recording && !loading && <p className="fine-print">录音约 2 秒自动结束，可手动提前结束。</p>}
    </div>
    {asset && project && <div className="source-detail">
      <div className="label-row"><label htmlFor="source-label">给这个声音一个名字</label><button type="button" className="text-button" onClick={onOriginal} disabled={busy || recording}><Icon name="headphones" size={14} />听原始片段</button></div>
      <input id="source-label" className="source-name-input" value={label} maxLength={40} disabled={busy || recording} onChange={(event) => setLabel(event.target.value)} onBlur={saveLabel} onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }} placeholder="例如：午后的一声杯响" />
      <Waveform source={asset.buffer} trim={project.trim} onTrim={onTrim} disabled={busy || recording} />
      {analysis && <div className={`source-quality ${analysis.quality === "usable" ? "is-usable" : ""}`} role="status"><span className="status-dot" /><span>{analysis.quality === "nearSilent" ? "这段几乎没有声音，试着移动选区或重新录制。" : analysis.quality === "tooQuiet" ? "声音比较轻，可以编排；换个更清晰的片段会更好。" : "声音已就绪，可以开始编排。"}</span></div>}
      {analysis && <><div className="source-gain-summary"><span>选区 <strong className="mono">{analysis.features.durationMs.toFixed(1)} ms</strong></span><span>{analysis.normalizationGain > 1.000001 ? `编排幅度提升 ${analysis.normalizationGain.toFixed(1)} 倍` : analysis.normalizationGain < .999999 ? `编排幅度调整为 ${Math.round(analysis.normalizationGain * 100)}%` : "编排幅度未提升"}</span></div><details className="source-measurements"><summary>声音测量信息<span>＋</span></summary><p className="fine-print">测量选区的幅度与变化，不识别声音物体或判断音高。编排时幅度提升上限为 6 倍；「听原始片段」保留原始音量。</p><dl><div><dt>峰值幅度</dt><dd>{analysis.features.peak.toFixed(4)}</dd></div><div><dt>均方根幅度</dt><dd>{analysis.features.rms.toFixed(4)}</dd></div><div><dt>选区时长</dt><dd>{analysis.features.durationMs.toFixed(1)} ms</dd></div><div><dt>过零率</dt><dd>{(analysis.features.zeroCrossingRate * 100).toFixed(2)}%</dd></div><div><dt>瞬态分数</dt><dd>{analysis.features.transientScore.toFixed(3)}</dd></div></dl></details></>}
    </div>}
    <div className="example-section"><div className="label-row"><span>先用一段声音试试</span><span className="fine-print">合成示例</span></div><div className="example-list">{examples.map((example) => <button type="button" key={example.kind} aria-label={`合成示例：${example.name}`} disabled={busy || recording} onClick={() => onExample(example.kind)}><Icon name={example.icon} size={19} /><span>{example.name}</span><small>{example.detail}</small><Icon name="arrow" size={14} /></button>)}</div></div>
    <p className="panel-footnote">声音是作品的主角。<br />保留一点熟悉，发现一点不同。</p>
  </section>;
}
