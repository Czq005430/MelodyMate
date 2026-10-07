"use client";

import { useEffect, useRef, useState } from "react";
import { readMusicSession, saveMusicSession, type MusicSession } from "./music-session.ts";
import type { MusicConfig, MusicJob, MusicJobRequest, MusicCandidate } from "./music-types.ts";

const active = (job: MusicJob | null) => !!job && ["submitting", "pending", "generating"].includes(job.status);
const errorText = (error: unknown) => error instanceof Error ? error.message : "请求未完成，请恢复本次任务查询，不要重复提交。";

export function useMusicGeneration() {
  const [config, setConfig] = useState<MusicConfig | null>(null);
  const [token, setToken] = useState("");
  const [session, setSession] = useState<MusicSession | null>(null);
  const [job, setJob] = useState<MusicJob | null>(null);
  const [busy, setBusy] = useState(false);
  const [paused, setPaused] = useState(false);
  const [error, setError] = useState("");
  const alive = useRef(false), submitting = useRef(false), latestSession = useRef<MusicSession | null>(null);

  async function refreshConfig() {
    try {
      const response = await fetch("/api/music/config", { cache: "no-store", signal: AbortSignal.timeout(10000) });
      if (!response.ok) throw new Error("无法读取音乐服务配置，请确认本地服务正在运行。");
      const data = await response.json() as MusicConfig;
      if (alive.current) setConfig(data);
    } catch (cause) { if (alive.current) setError(errorText(cause)); }
  }
  useEffect(() => {
    alive.current = true;
    const saved = readMusicSession(); latestSession.current = saved; setSession(saved);
    void refreshConfig();
    return () => { alive.current = false; };
  }, []);

  async function requestJob(url: string, body?: MusicJobRequest): Promise<MusicJob> {
    const response = await fetch(url, { method: body ? "POST" : "GET", cache: "no-store",
      headers: { "x-demo-token": token, ...(body ? { "Content-Type": "application/json" } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(60000) });
    const value = await response.json();
    if (!response.ok) throw new Error(typeof value.error === "string" ? value.error : value.error?.message || value.message || "请求未完成，请稍后恢复任务。");
    if (!value.id || !["submitting", "pending", "generating", "ready", "failed", "unknown"].includes(value.status) || !Array.isArray(value.candidates)) {
      throw new Error("音乐服务返回格式不匹配，请保留本次任务并检查服务日志。");
    }
    return value as MusicJob;
  }
  async function send(saved: MusicSession) {
    if (submitting.current) return;
    if (!token.trim()) { setError("请填写本机演示口令，API Key 只在服务端配置。"); return; }
    submitting.current = true; setBusy(true); setError(""); setPaused(true);
    try {
      const result = await requestJob(saved.jobId ? `/api/music/jobs/${saved.jobId}` : "/api/music/jobs", saved.jobId ? undefined : saved.request);
      if (!alive.current || latestSession.current?.request.requestId !== saved.request.requestId) return;
      const next = { ...saved, jobId: result.id }; saveMusicSession(next);
      latestSession.current = next; setSession(next); setJob(result); setPaused(false);
    } catch (cause) { if (alive.current) setError(errorText(cause)); }
    finally { submitting.current = false; if (alive.current) setBusy(false); }
  }
  async function submit(input: Omit<MusicJobRequest, "requestId">) {
    if (submitting.current || active(job) || job?.status === "unknown") return;
    if (latestSession.current && !job) { setError("有尚未确认的任务，请先恢复查询，避免重复计费。"); return; }
    try {
      const saved = { request: { ...input, requestId: crypto.randomUUID() } };
      saveMusicSession(saved); latestSession.current = saved; setSession(saved); setJob(null);
      await send(saved);
    } catch (cause) { setError(errorText(cause)); }
  }
  useEffect(() => {
    if (!job || !active(job) || paused || !token) return;
    let stopped = false, timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const result = await requestJob(`/api/music/jobs/${job.id}`);
        if (!stopped && alive.current) { setJob(result); setError(""); }
      } catch (cause) { if (!stopped && alive.current) { setError(errorText(cause)); setPaused(true); } }
      if (!stopped) timer = setTimeout(poll, 8000);
    };
    timer = setTimeout(poll, 8000);
    return () => { stopped = true; clearTimeout(timer); };
  }, [job?.id, job?.status, token, paused]);

  async function fetchAudio(candidate: MusicCandidate): Promise<ArrayBuffer> {
    if (!job || !job.candidates.some(item => item.id === candidate.id && item.audioUrl === candidate.audioUrl) ||
      !candidate.audioUrl.startsWith(`/api/music/jobs/${job.id}/audio/`)) throw new Error("候选音频地址不匹配。");
    const response = await fetch(candidate.audioUrl, { headers: { "x-demo-token": token }, cache: "no-store", signal: AbortSignal.timeout(60000) });
    if (!response.ok) throw new Error("候选音频读取失败，请检查演示口令，或恢复任务重试。");
    const bytes = await response.arrayBuffer();
    if (bytes.byteLength > 50 * 1024 * 1024) throw new Error("伴奏音频超过 50 MiB。");
    return bytes;
  }
  return { config, token, setToken, session, job, busy, paused, error, refreshConfig, submit, fetchAudio,
    resume: () => { const saved = latestSession.current; if (saved) void send(saved); },
    pause: () => setPaused(true), pending: active(job) || job?.status === "unknown" || (!!session && !job) };
}
