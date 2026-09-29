"use client";

import { useEffect, useRef, useState } from "react";
import { analyzeRecording, roleLabels, rolePatterns } from "../lib/recording-analysis";
import type { RecordingAnalysis, SoundRole } from "../lib/song-types";

type Props = {
  role: SoundRole; bpm: number; disabled: boolean;
  onRecorded: (buffer: AudioBuffer, analysis: RecordingAnalysis) => void;
  onBusy: (busy: boolean) => void; onError: (message: string) => void;
};
type Stage = "idle" | "requesting" | "counting" | "recording" | "decoding";
type Session = {
  role: SoundRole; bpm: number; stream?: MediaStream; recorder?: MediaRecorder;
  timer?: ReturnType<typeof setTimeout>; ticker?: ReturnType<typeof setInterval>;
  startedAt: number; guideStartSec: number;
};
const roleHints: Record<SoundRole, string> = {
  pulse: "用指节敲桌面或木块，每拍敲一下，为作品打底。",
  accent: "用拍手或指响，在第 2、4 拍发声，让节奏更有起伏。",
  texture: "短短摇一下米粒瓶或纸盒，每拍两下，给节奏加些细节。",
};

function release(session: Session, discard = false) {
  clearTimeout(session.timer);
  clearInterval(session.ticker);
  if (discard && session.recorder) {
    session.recorder.ondataavailable = null;
    session.recorder.onstop = null;
    session.recorder.onerror = null;
    session.recorder.onstart = null;
    if (session.recorder.state !== "inactive") { try { session.recorder.stop(); } catch { /* 轨道仍会关闭。 */ } }
  }
  session.stream?.getTracks().forEach((track) => track.stop());
}

export default function GuidedRecorder({ role, bpm, disabled, onRecorded, onBusy, onError }: Props) {
  const [stage, setStage] = useState<Stage>("idle");
  const [elapsed, setElapsed] = useState(0);
  const [summary, setSummary] = useState("");
  const current = useRef<Session | null>(null);
  const callbacks = useRef({ onRecorded, onBusy, onError });
  callbacks.current = { onRecorded, onBusy, onError };

  const finish = (session: Session, message?: string) => {
    if (current.current !== session) return;
    current.current = null;
    release(session, true);
    setStage("idle");
    callbacks.current.onBusy(false);
    if (message) callbacks.current.onError(message);
  };
  const cancel = () => { if (current.current) finish(current.current); };
  const stop = (session = current.current) => {
    if (!session || current.current !== session || session.recorder?.state !== "recording") return;
    clearTimeout(session.timer);
    clearInterval(session.ticker);
    setStage("decoding");
    try { session.recorder.stop(); release(session); }
    catch { finish(session, "录音结束失败，请重新录制。"); }
  };

  useEffect(() => {
    const hidden = () => {
      if (document.hidden && current.current) finish(current.current, "页面已切到后台，录音已取消，请回来后重新录制。");
    };
    document.addEventListener("visibilitychange", hidden);
    return () => {
      document.removeEventListener("visibilitychange", hidden);
      const session = current.current;
      current.current = null;
      if (session) { release(session, true); callbacks.current.onBusy(false); }
    };
  }, []);
  useEffect(() => {
    const session = current.current;
    if (session && (session.role !== role || session.bpm !== bpm)) finish(session, "声音角色或速度已改变，请按新的提示重新录制。");
    setSummary("");
  }, [role, bpm]);

  const start = async () => {
    if (disabled || current.current) return;
    if (!Number.isFinite(bpm) || bpm < 72 || bpm > 128) { callbacks.current.onError("请先选择 72～128 BPM 的速度。"); return; }
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      callbacks.current.onError("当前浏览器无法录音，请在 HTTPS 或本机地址下使用支持录音的浏览器。"); return;
    }
    const session: Session = { role, bpm, startedAt: 0, guideStartSec: 240 / bpm };
    current.current = session;
    setSummary(""); setElapsed(0); setStage("requesting"); callbacks.current.onBusy(true);
    try {
      session.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
      if (current.current !== session) { release(session, true); return; }
      const mimeType = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus", "audio/mp4"].find((type) => MediaRecorder.isTypeSupported(type));
      const recorder = new MediaRecorder(session.stream, mimeType ? { mimeType } : undefined);
      session.recorder = recorder;
      const chunks: Blob[] = [];
      let bytes = 0;
      recorder.ondataavailable = (event) => {
        if (current.current !== session || !event.data.size) return;
        bytes += event.data.size;
        if (bytes > 10 * 1024 * 1024) { finish(session, "录音数据过大，请重新录制较短的声音。"); return; }
        chunks.push(event.data);
      };
      recorder.onerror = () => finish(session, "录音中断，请检查麦克风后重试。");
      recorder.onstart = () => {
        if (current.current !== session) return;
        session.startedAt = performance.now();
        setStage("counting");
        session.ticker = setInterval(() => {
          if (current.current !== session) return;
          const seconds = (performance.now() - session.startedAt) / 1000;
          setElapsed(seconds);
          setStage(seconds < session.guideStartSec ? "counting" : "recording");
          if (seconds >= session.guideStartSec * 3 + 0.1) stop(session);
        }, 25);
        session.timer = setTimeout(() => stop(session), Math.min(12000, session.guideStartSec * 3000 + 100));
      };
      recorder.onstop = async () => {
        release(session);
        if (current.current !== session) return;
        setStage("decoding");
        try {
          if (!chunks.length) throw new Error("没有录到声音，请重录。");
          const blob = new Blob(chunks, { type: recorder.mimeType || chunks[0].type });
          const decoder = new OfflineAudioContext(1, 1, 44100);
          let buffer: AudioBuffer;
          try { buffer = await decoder.decodeAudioData(await blob.arrayBuffer()); }
          catch { throw new Error("无法读取这次录音，请重新录制或更换浏览器。"); }
          if (current.current !== session) return;
          // 不沿用旧版两秒裁切；后台计时或编码尾部超限时只保留前十二秒。
          if (buffer.duration > 12) {
            const trimmed = decoder.createBuffer(buffer.numberOfChannels, Math.floor(12 * buffer.sampleRate), buffer.sampleRate);
            for (let channel = 0; channel < buffer.numberOfChannels; channel++) trimmed.getChannelData(channel).set(buffer.getChannelData(channel).subarray(0, trimmed.length));
            buffer = trimmed;
          }
          const analysis = analyzeRecording(buffer, session.bpm, session.role, session.guideStartSec);
          setSummary(analysis.summary);
          callbacks.current.onRecorded(buffer, analysis);
          finish(session);
        } catch (error) { finish(session, error instanceof Error ? error.message : "这次录音无法分析，请重新录制。"); }
      };
      recorder.start(250);
    } catch (error) {
      finish(session, error instanceof DOMException && error.name === "NotAllowedError" ? "未获得麦克风权限；你可以允许后重试，或先使用示例声音。" : "无法启动录音，请检查麦克风后重试。");
    }
  };

  const beatSeconds = 60 / bpm;
  const activeStep = stage === "recording" ? Math.min(31, Math.max(0, Math.floor((elapsed - 4 * beatSeconds) / (beatSeconds / 4)))) : -1;
  const count = Math.max(1, 4 - Math.floor(elapsed / beatSeconds));
  const status = stage === "requesting" ? "请在浏览器提示中选择是否允许麦克风" : stage === "counting" ? `准备，倒数 ${count} 拍` : stage === "recording" ? `正在录第 ${Math.floor(activeStep / 16) + 1} 小节，共 2 小节` : stage === "decoding" ? "正在整理这段声音…" : "准备好后点击开始；先倒数一小节，再录两小节。";
  return <div className="gr-recorder">
    <div className="gr-heading"><strong>录下你的{roleLabels[role]}声音</strong><span>{bpm} BPM · 两小节</span></div>
    <p className="gr-instruction">{roleHints[role]}亮格是发声位置，暗格先停一停。</p>
    <div className="gr-pattern" role="img" aria-label={`${roleLabels[role]}节奏示意，每四格一拍，亮格发声`}>{rolePatterns[role].map((hit, step) => <span key={step} className={`gr-step${hit ? " gr-hit" : ""}${activeStep >= 0 && activeStep % 16 === step ? " gr-current" : ""}`}><small>{step % 4 === 0 ? `${step / 4 + 1} 拍` : ""}</small><i /></span>)}</div>
    <p className="gr-status" role="status">{status}</p>
    <div className="gr-actions">
      {stage === "idle" ? <button type="button" className="button button-primary gr-start" disabled={disabled} onClick={start}>开始引导录音</button> : <><button type="button" className="button button-primary gr-stop" disabled={stage !== "recording"} onClick={() => stop()}>结束并整理</button><button type="button" className="button button-secondary gr-cancel" onClick={cancel}>取消录音</button></>}
    </div>
    <p className="gr-note">只用视觉引导，不外放节拍声。稍早稍晚没关系；匹配可靠时对齐，不可靠时用清楚的单次声音重新编排，不修复音高或噪声。</p>
    {summary && <p className="gr-result" role="status">{summary}</p>}
  </div>;
}
