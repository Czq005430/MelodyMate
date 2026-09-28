"use client";

import type { Project } from "../lib/types";
import Icon from "./Icons";

type Props = { project: Project | null; status: string; playhead: number; playbackDuration?: number | null; download?: { url: string; name: string } | null; canUndo: boolean; disabled: boolean; playable?: boolean; onPlay: () => void; onStop: () => void; onUndo: () => void; onExport: () => void; onSolo: (mode: "source" | "backing") => void };
const clock = (seconds: number) => `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${(seconds % 60).toFixed(1).padStart(4, "0")}`;

export default function TransportBar({ project, status, playhead, playbackDuration, download, canUndo, disabled, playable = true, onPlay, onStop, onUndo, onExport, onSolo }: Props) {
  const duration = playbackDuration ?? (project ? 16 * 60 / project.params.bpm : 0);
  const progress = Math.max(0, Math.min(1, playhead));
  const unavailable = disabled || !project || !playable;
  return <footer className="transport-bar" id="work-player" tabIndex={-1} aria-label="作品播放器">
    <div className="transport-identity"><span className="transport-disc"><Icon name="headphones" size={21} /></span><div><strong>{project?.sourceLabel || "你的第一首声音小品"}</strong><span role="status">{status}</span></div></div>
    <div className="transport-main"><div className="playback-actions"><button type="button" className="icon-button undo-button" aria-label="撤销上一步" title="撤销上一步" disabled={disabled || !canUndo} onClick={onUndo}><Icon name="undo" /></button><button type="button" className="play-button" aria-label="播放作品" title="播放作品" disabled={unavailable} onClick={onPlay}><Icon name="play" size={20} /><span className="play-action-label">播放作品</span></button><button type="button" className="icon-button stop-button" aria-label="停止播放" title="停止播放" onClick={onStop}><Icon name="stop" size={14} /></button></div><div className="transport-timeline"><span className="mono">{clock(progress * duration)}</span><div className="transport-track" role="progressbar" aria-label="播放进度" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress * 100)}><span style={{ width: `${progress * 100}%` }} /></div><span className="mono">{clock(duration)}</span></div></div>
    <div className="transport-tools"><div className="solo-actions"><button type="button" className="text-button" disabled={unavailable} onClick={() => onSolo("source")}>单听原声</button><button type="button" className="text-button" disabled={unavailable || !project?.backingAllowed || project?.params.backingPreset === "off" || project?.params.backingGain === 0} onClick={() => onSolo("backing")}>单听伴奏</button></div><div className="export-actions"><button type="button" className="button button-export" disabled={unavailable} onClick={onExport}><Icon name="download" size={17} /><span>导出作品<small>WAV</small></span></button>{download && <a className="saved-download" href={download.url} download={download.name} title={download.name}>保存上次导出</a>}</div></div>
  </footer>;
}
