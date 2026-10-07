import type { MusicJobRequest } from "./music-types.ts";

export type MusicSession = { request: MusicJobRequest; jobId?: string };
type SessionStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;
const KEY = "melodymate.music-task.v1";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function readMusicSession(storage?: SessionStorage): MusicSession | null {
  try {
    const value = JSON.parse((storage ?? globalThis.localStorage).getItem(KEY) ?? "null") as MusicSession | null;
    const request = value?.request, brief = request?.brief;
    if (!request || !uuid.test(request.requestId) || !Number.isSafeInteger(request.projectRevision) || request.projectRevision < 0 ||
      !Array.isArray(request.sourceIds) || request.sourceIds.length > 3 || request.sourceIds.some(id => typeof id !== "string" || !id || id.length > 100) ||
      !brief || typeof brief.prompt !== "string" || !brief.prompt.trim() || brief.prompt.length > 600 ||
      !Number.isFinite(brief.bpm) || brief.bpm < 60 || brief.bpm > 180 || ![120, 150, 180].includes(brief.durationSec) ||
      !Array.isArray(brief.sourceLabels) || brief.sourceLabels.length > 3 || brief.sourceLabels.some(label => typeof label !== "string" || label.length > 60) ||
      (value?.jobId !== undefined && !uuid.test(value.jobId))) return null;
    return value;
  } catch { return null; }
}
export function saveMusicSession(session: MusicSession, storage?: SessionStorage): void {
  try { (storage ?? globalThis.localStorage).setItem(KEY, JSON.stringify(session)); }
  catch { throw new Error("无法保存生成任务，请允许浏览器存储后再提交，避免重复计费。"); }
}
export function sameMusicProject(request: MusicJobRequest, revision: number, sourceIds: string[]): boolean {
  return request.projectRevision === revision && request.sourceIds.length === sourceIds.length && request.sourceIds.every(id => sourceIds.includes(id));
}
