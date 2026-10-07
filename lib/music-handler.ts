import { createHash, timingSafeEqual } from "node:crypto";
import type { MusicConfig, MusicJobRequest } from "./music-types.ts";
import { createMusicJobs } from "./music-jobs.ts";
import { musicSettings } from "./music-provider.ts";
import { readJsonBody, RequestError } from "./request-guard.ts";
import type { ServerEnv } from "./request-guard.ts";

const invalid = () => new RequestError(400, "INVALID_MUSIC_REQUEST", "音乐描述或工程信息不符合要求，请重新选择后再试。");
const obj = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw invalid();
  return value as Record<string, unknown>;
};
function keys(value: Record<string, unknown>, expected: string[]) {
  if (Object.keys(value).length !== expected.length || Object.keys(value).some((key) => !expected.includes(key))) throw invalid();
}
function strings(value: unknown, maximum: number): string[] {
  if (!Array.isArray(value) || value.length > 3 || value.some((item) => typeof item !== "string" || !item.trim() || [...item].length > maximum)) throw invalid();
  return value as string[];
}
export function validateMusicRequest(value: unknown): MusicJobRequest {
  const request = obj(value); keys(request, ["requestId", "projectRevision", "sourceIds", "brief"]);
  const brief = obj(request.brief); keys(brief, ["prompt", "bpm", "durationSec", "sourceLabels"]);
  if (typeof request.requestId !== "string" || !/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(request.requestId)
    || !Number.isSafeInteger(request.projectRevision) || (request.projectRevision as number) < 0
    || typeof brief.prompt !== "string" || !brief.prompt.trim() || [...brief.prompt].length > 600
    || typeof brief.bpm !== "number" || !Number.isFinite(brief.bpm) || brief.bpm < 60 || brief.bpm > 180
    || ![120, 150, 180].includes(brief.durationSec as number)) throw invalid();
  const sourceIds = strings(request.sourceIds, 120); const sourceLabels = strings(brief.sourceLabels, 60);
  if (new Set(sourceIds).size !== sourceIds.length || sourceIds.length !== sourceLabels.length) throw invalid();
  return { requestId: request.requestId, projectRevision: request.projectRevision as number, sourceIds,
    brief: { prompt: brief.prompt, bpm: brief.bpm, durationSec: brief.durationSec as 120 | 150 | 180, sourceLabels } };
}

function accessConfigured(env: ServerEnv): boolean {
  if (!env.APP_ORIGIN || !env.DEMO_ACCESS_TOKEN?.trim() || env.DEMO_ACCESS_TOKEN === "replace-with-a-private-demo-password") return false;
  try { return new URL(env.APP_ORIGIN).origin === env.APP_ORIGIN; } catch { return false; }
}
function guard(request: Request, env: ServerEnv) {
  if (!accessConfigured(env)) throw new RequestError(503, "MUSIC_ACCESS_NOT_CONFIGURED", "音乐服务尚未开放，请先配置服务端访问口令。");
  const origin = request.headers.get("origin"); const site = request.headers.get("sec-fetch-site");
  const sameOrigin = origin === env.APP_ORIGIN || (request.method === "GET" && origin === null && site === "same-origin" && new URL(request.url).origin === env.APP_ORIGIN);
  const digest = (value: string) => createHash("sha256").update(value).digest();
  if (!sameOrigin || (site !== null && site !== "same-origin")
    || !timingSafeEqual(digest(request.headers.get("x-demo-token") ?? ""), digest(env.DEMO_ACCESS_TOKEN!))) {
    throw new RequestError(403, "MUSIC_ACCESS_DENIED", "无法验证请求来源或演示口令。");
  }
}
const headers = { "cache-control": "no-store", "x-content-type-options": "nosniff" };
function json(value: unknown, status = 200) { return Response.json(value, { status, headers }); }
async function respond(work: () => Promise<Response>): Promise<Response> {
  try { return await work(); }
  catch (error) {
    return error instanceof RequestError ? json({ error: { code: error.code, message: error.message } }, error.status)
      : json({ error: { code: "MUSIC_UNAVAILABLE", message: "音乐服务暂时不可用，请保留当前任务并稍后查询。" } }, 503);
  }
}

export function createMusicHandlers({ env, fetch, clock }: { env: ServerEnv; fetch?: typeof globalThis.fetch; clock?: () => number }) {
  const jobs = createMusicJobs({ env, fetch, clock });
  return {
    async config(_request: Request): Promise<Response> {
      const settings = musicSettings(env); const configured = settings.valid && accessConfigured(env);
      const value: MusicConfig = { configured, provider: "kie", maxJobsPerDay: Number.isSafeInteger(settings.maxJobsPerDay) && settings.maxJobsPerDay > 0 ? settings.maxJobsPerDay : 12,
        message: configured ? "Kie 音乐服务已配置；仅发送文字描述，真实生成效果仍需联调验证。" : "音乐服务尚未配置，当前不会调用生成或产生费用。" };
      return json(value);
    },
    create(request: Request): Promise<Response> {
      return respond(async () => { guard(request, env); const body = validateMusicRequest(await readJsonBody(request)); return json(await jobs.create(body), 202); });
    },
    get(request: Request, id: string): Promise<Response> {
      return respond(async () => { guard(request, env); return json(await jobs.get(id)); });
    },
    audio(request: Request, id: string, index: string): Promise<Response> {
      return respond(async () => {
        guard(request, env);
        if (!/^[0-3]$/.test(index)) throw new RequestError(404, "MUSIC_NOT_FOUND", "找不到这份音频。");
        const result = await jobs.audio(id, Number(index));
        return new Response(result.bytes as BodyInit, { headers: { ...headers, "content-type": result.contentType, "content-length": String(result.bytes.byteLength) } });
      });
    },
  };
}

const local = globalThis as typeof globalThis & { melodyMusicHandlers?: ReturnType<typeof createMusicHandlers> };
export const musicHandlers = local.melodyMusicHandlers ??= createMusicHandlers({ env: process.env });
