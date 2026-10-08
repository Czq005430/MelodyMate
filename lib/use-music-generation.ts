"use client";

import { useEffect, useRef, useState } from "react";
import { readDemoToken, readMusicSession, saveDemoToken, saveMusicSession, type MusicSession } from "./music-session.ts";
import type { MusicConfig, MusicJob, MusicJobRequest, MusicCandidate, MusicJobSummary } from "./music-types.ts";

const active = (job: MusicJob | null) => !!job && ["submitting", "pending", "generating"].includes(job.status);
const errorText = (error: unknown) => error instanceof Error ? error.message : "请求未完成，请恢复本次任务查询，不要重复提交。";

export function useMusicGeneration() {
  const [config, setConfig] = useState<MusicConfig | null>(null);
  const [token, setTokenValue] = useState("");
  const setToken = (value: string) => { setTokenValue(value); saveDemoToken(value); };
  const [session, setSession] = useState<MusicSession | null>(null);
  const [job, setJob] = useState<MusicJob | null>(null);
  const [busy, setBusy] = useState(false);
  const [paused, setPaused] = useState(false);
  const [error, setError] = useState("");
  const [recent, setRecent] = useState<MusicJobSummary[]>([]);
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
    setTokenValue(readDemoToken());
    void refreshConfig();
    return () => { alive.current = false; };
  }, []);

  // 浏览器存储按标签页隔离；服务端任务台账是跨标签页找回结果的唯一入口。
  async function refreshRecent() {
    if (!token.trim()) { setRecent([]); return; }
    try {
      const response = await fetch("/api/music/jobs", { cache: "no-store", headers: { "x-demo-token": token }, signal: AbortSignal.timeout(10000) });
      const value = await response.json();
      if (!response.ok || !Array.isArray(value.jobs)) throw new Error(typeof value.error === "string" ? value.error : "任务台账读取失败。");
      if (alive.current) setRecent(value.jobs as MusicJobSummary[]);
    } catch (cause) { if (alive.current) setRecent([]); }
  }
  useEffect(() => { if (token) void refreshRecent(); else setRecent([]); }, [token]);
  async function restore(id: string) {
    if (submitting.current || !/^[0-9a-f-]{36}$/i.test(id)) return;
    setBusy(true); setError(""); setPaused(true);
    try {
      const result = await requestJob(`/api/music/jobs/${id}`);
      const request: MusicJobRequest = { requestId: result.requestId, projectRevision: result.projectRevision,
        sourceIds: result.sourceIds, brief: result.brief, ...(result.clip ? { clip: result.clip } : {}) };
      const saved = { request, jobId: id };
      saveMusicSession(saved); latestSession.current = saved; setSession(saved); setJob(result); setPaused(false);
      void refreshRecent();
    } catch (cause) { if (alive.current) setError(errorText(cause)); }
    finally { if (alive.current) setBusy(false); }
  }

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
      const created = saved.request.clip ? "/api/music/extend" : "/api/music/jobs";
      const result = await requestJob(saved.jobId ? `/api/music/jobs/${saved.jobId}` : created, saved.jobId ? undefined : saved.request);
      if (!alive.current || latestSession.current?.request.requestId !== saved.request.requestId) return;
      const next = { ...saved, jobId: result.id }; saveMusicSession(next);
      latestSession.current = next; setSession(next); setJob(result); setPaused(false);
      void refreshRecent();
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
  // 素材经服务端转传给服务商的上传通道；API Key 始终不下发浏览器。
  async function uploadClip(bytes: Uint8Array): Promise<string> {
    if (!token.trim()) throw new Error("请先填写本机演示口令，再上传雏形素材。");
    const response = await fetch("/api/music/uploads", { method: "POST", cache: "no-store",
      headers: { "x-demo-token": token, "content-type": "audio/wav" }, body: bytes as BodyInit, signal: AbortSignal.timeout(120_000) });
    const value = await response.json().catch(() => null);
    if (!response.ok) throw new Error(typeof value?.error === "string" ? value.error : value?.error?.message || value?.message || "素材上传未完成。");
    if (typeof value?.url !== "string" || !value.url.startsWith("https://")) throw new Error("素材上传返回格式不匹配，请先在服务商后台核对，不要重复上传。");
    return value.url;
  }
  return { config, token, setToken, session, job, recent, busy, paused, error, refreshConfig, refreshRecent, restore, submit, uploadClip, fetchAudio,
    resume: () => { const saved = latestSession.current; if (saved) void send(saved); },
    pause: () => setPaused(true), pending: active(job) || job?.status === "unknown" || (!!session && !job) };
}
