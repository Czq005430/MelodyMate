"use client";

import { useEffect, useRef, useState } from "react";
import type { AudioData, Trim } from "../lib/types";

type Props = { source: AudioData; trim: Trim; onTrim: (trim: Trim) => void; disabled?: boolean };
type Edge = "startSec" | "endSec";

function AudioCanvas({ source, start, end, zoom = false }: { source: AudioData; start: number; end: number; zoom?: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const draw = () => {
      const width = Math.max(1, Math.round(canvas.getBoundingClientRect().width));
      const height = zoom ? 76 : 100;
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.scale(dpr, dpr);
      ctx.clearRect(0, 0, width, height);
      ctx.strokeStyle = "#34312d";
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let x = 0; x < width; x += width / 8) { ctx.moveTo(x + .5, 0); ctx.lineTo(x + .5, height); }
      ctx.moveTo(0, height / 2 + .5); ctx.lineTo(width, height / 2 + .5); ctx.stroke();
      const first = Math.max(0, Math.floor(start * source.sampleRate));
      const last = Math.min(source.length, Math.ceil(end * source.sampleRate));
      const channels = Array.from({ length: source.numberOfChannels }, (_, c) => source.getChannelData(c));
      ctx.strokeStyle = zoom ? "#f1b58c" : "#c98f69";
      ctx.beginPath();
      for (let x = 0; x < width; x++) {
        const from = Math.floor(first + (last - first) * x / width);
        const to = Math.min(last, Math.max(from + 1, Math.floor(first + (last - first) * (x + 1) / width)));
        let low = Infinity, high = -Infinity;
        for (const data of channels) for (let i = from; i < to; i++) { low = Math.min(low, data[i]); high = Math.max(high, data[i]); }
        if (!Number.isFinite(low)) continue;
        ctx.moveTo(x + .5, height / 2 - high * height * .43);
        ctx.lineTo(x + .5, height / 2 - low * height * .43 + .6);
      }
      ctx.stroke();
    };
    draw();
    const observer = new ResizeObserver(draw);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [source, start, end, zoom]);
  return <canvas ref={canvasRef} className={zoom ? "wave-canvas wave-canvas-zoom" : "wave-canvas"} aria-hidden="true" />;
}

export default function Waveform({ source, trim, onTrim, disabled = false }: Props) {
  const duration = source.length / source.sampleRate;
  const [draft, setDraft] = useState(trim);
  const draftRef = useRef(trim);
  const overviewRef = useRef<HTMLDivElement>(null);
  const dragging = useRef<Edge | "range" | null>(null);
  const grabOffset = useRef(0);
  const minLength = Math.min(.05, duration);
  const maxLength = Math.min(.5, duration);
  const updateDraft = (next: Trim) => { draftRef.current = next; setDraft(next); };
  useEffect(() => { draftRef.current = trim; setDraft(trim); }, [trim.startSec, trim.endSec, source]);
  const clamp = (edge: Edge, value: number, current = draftRef.current): Trim => {
    if (edge === "startSec") return { ...current, startSec: Math.max(0, current.endSec - maxLength, Math.min(current.endSec - minLength, value)) };
    return { ...current, endSec: Math.min(duration, current.startSec + maxLength, Math.max(current.startSec + minLength, value)) };
  };
  const commit = (next: Trim) => {
    updateDraft(next);
    if (Math.abs(next.startSec - trim.startSec) > 1e-8 || Math.abs(next.endSec - trim.endSec) > 1e-8) onTrim(next);
  };
  const nudge = (edge: Edge, amount: number) => commit(clamp(edge, draftRef.current[edge] + amount));
  const moveRange = (position: number) => {
    const length = draftRef.current.endSec - draftRef.current.startSec;
    const startSec = Math.max(0, Math.min(duration - length, position - grabOffset.current));
    updateDraft({ startSec, endSec: startSec + length });
  };
  const left = duration ? draft.startSec / duration * 100 : 0;
  const right = duration ? draft.endSec / duration * 100 : 100;
  const bounds = (edge: Edge) => edge === "startSec"
    ? { min: Math.max(0, draft.endSec - maxLength), max: Math.max(0, draft.endSec - minLength) }
    : { min: draft.startSec + minLength, max: Math.min(duration, draft.startSec + maxLength) };

  return <div className="waveform-editor">
    <div className="label-row"><span>找到声音最有趣的一瞬</span><span className="mono">{duration.toFixed(2)} 秒</span></div>
    <div className="wave-overview" ref={overviewRef}
      onPointerDown={(event) => { if (disabled) return; const rect = event.currentTarget.getBoundingClientRect(); const position = (event.clientX - rect.left) / rect.width * duration; const current = draftRef.current; grabOffset.current = position >= current.startSec && position <= current.endSec ? position - current.startSec : (current.endSec - current.startSec) / 2; dragging.current = "range"; event.currentTarget.setPointerCapture(event.pointerId); moveRange(position); }}
      onPointerMove={(event) => { if (disabled || dragging.current !== "range") return; const rect = event.currentTarget.getBoundingClientRect(); moveRange((event.clientX - rect.left) / rect.width * duration); }}
      onPointerUp={(event) => { if (dragging.current !== "range") return; dragging.current = null; event.currentTarget.releasePointerCapture(event.pointerId); commit(draftRef.current); }}
      onPointerCancel={() => { dragging.current = null; updateDraft(trim); }}>
      <AudioCanvas source={source} start={0} end={duration} />
      <div className="wave-selection" style={{ left: `${left}%`, width: `${right - left}%` }} />
      {(["startSec", "endSec"] as const).map((edge) => <button key={edge} type="button" className={`wave-handle ${edge === "endSec" ? "wave-handle-end" : ""}`} style={{ left: `${edge === "startSec" ? left : right}%` }} disabled={disabled} role="slider" aria-label={edge === "startSec" ? "选区起点" : "选区终点"} aria-valuemin={bounds(edge).min} aria-valuemax={bounds(edge).max} aria-valuenow={draft[edge]} aria-valuetext={`${draft[edge].toFixed(3)} 秒`}
        onPointerDown={(event) => { event.stopPropagation(); if (disabled) return; event.preventDefault(); dragging.current = edge; event.currentTarget.setPointerCapture(event.pointerId); }}
        onPointerMove={(event) => { if (dragging.current !== edge || disabled) return; const rect = overviewRef.current?.getBoundingClientRect(); if (rect) updateDraft(clamp(edge, (event.clientX - rect.left) / rect.width * duration)); }}
        onPointerUp={(event) => { if (dragging.current !== edge) return; dragging.current = null; event.currentTarget.releasePointerCapture(event.pointerId); commit(draftRef.current); }}
        onPointerCancel={() => { dragging.current = null; updateDraft(trim); }}
        onKeyDown={(event) => { if (event.key === "ArrowLeft" || event.key === "ArrowRight") { event.preventDefault(); nudge(edge, event.key === "ArrowLeft" ? -.01 : .01); } }}
      ><span /></button>)}
    </div>
    <div className="wave-ruler mono"><span>0.00</span><span>{(duration / 2).toFixed(2)}</span><span>{duration.toFixed(2)} 秒</span></div>
    <div className="wave-zoom"><div className="label-row"><span>选区放大</span><span className="mono accent-text">{Math.round((draft.endSec - draft.startSec) * 1000)} 毫秒</span></div><AudioCanvas source={source} start={draft.startSec} end={draft.endSec} zoom /></div>
    <div className="trim-controls">{(["startSec", "endSec"] as const).map((edge) => <div key={edge} className="trim-control"><span>{edge === "startSec" ? "起点" : "终点"}</span><div><button type="button" aria-label={`${edge === "startSec" ? "起点" : "终点"}提前 10 毫秒`} disabled={disabled || draft[edge] <= bounds(edge).min + 1e-8} onClick={() => nudge(edge, -.01)}>−</button><output className="mono">{draft[edge].toFixed(3)}<small> 秒</small></output><button type="button" aria-label={`${edge === "startSec" ? "起点" : "终点"}延后 10 毫秒`} disabled={disabled || draft[edge] >= bounds(edge).max - 1e-8} onClick={() => nudge(edge, .01)}>＋</button></div></div>)}</div>
    <p className="fine-print">点击波形移动选区，拖动两端选取 50—500 毫秒；用 ＋ / − 微调 10 毫秒。</p>
  </div>;
}
