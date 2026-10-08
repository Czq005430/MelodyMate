import { createHash, timingSafeEqual } from "node:crypto";
import type { MusicConfig, MusicJobRequest } from "./music-types.ts";
import { createMusicJobs } from "./music-jobs.ts";
import { musicSettings, validateClip, MusicProviderError } from "./music-provider.ts";
import { originMatches, readBinaryBody, readJsonBody, RequestError } from "./request-guard.ts";
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
function readRequest(value: unknown, withClip: boolean): MusicJobRequest {
  const request = obj(value);
  keys(request, withClip ? ["requestId", "projectRevision", "sourceIds", "brief", "clip"] : ["requestId", "projectRevision", "sourceIds", "brief"]);
  const brief = obj(request.brief); keys(brief, ["prompt", "bpm", "durationSec", "sourceLabels"]);
  if (typeof request.requestId !== "string" || !/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(request.requestId)
    || !Number.isSafeInteger(request.projectRevision) || (request.projectRevision as number) < 0
    || typeof brief.prompt !== "string" || !brief.prompt.trim() || [...brief.prompt].length > 600
    || typeof brief.bpm !== "number" || !Number.isFinite(brief.bpm) || brief.bpm < 60 || brief.bpm > 180
    || ![120, 150, 180].includes(brief.durationSec as number)) throw invalid();
  const sourceIds = strings(request.sourceIds, 120); const sourceLabels = strings(brief.sourceLabels, 60);
  if (new Set(sourceIds).size !== sourceIds.length || sourceIds.length !== sourceLabels.length) throw invalid();
  const base = { requestId: request.requestId, projectRevision: request.projectRevision as number, sourceIds,
    brief: { prompt: brief.prompt, bpm: brief.bpm, durationSec: brief.durationSec as 120 | 150 | 180, sourceLabels } };
  // 续写任务的 clip 校验失败要给出具体原因，不能笼统报"描述不符合要求"。
  if (!withClip) return base;
  try { return { ...base, clip: validateClip(request.clip) }; }
  catch (error) { throw error instanceof MusicProviderError ? new RequestError(400, "INVALID_MUSIC_CLIP", error.message) : error; }
}
export function validateMusicRequest(value: unknown): MusicJobRequest { return readRequest(value, false); }
export function validateExtendRequest(value: unknown): MusicJobRequest { return readRequest(value, true); }

const MAX_CLIP_BYTES = 20 * 1024 * 1024;
const clipTypes = ["audio/wav", "audio/x-wav", "audio/mpeg", "audio/mp3"];
function looksLikeAudio(bytes: Uint8Array): boolean {
  const head = new TextDecoder().decode(bytes.subarray(0, 12));
  const frame = bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0;
  return (head.startsWith("RIFF") && head.slice(8) === "WAVE") || head.startsWith("ID3") || frame;
}

function accessConfigured(env: ServerEnv): boolean {
  if (!env.APP_ORIGIN || !env.DEMO_ACCESS_TOKEN?.trim() || env.DEMO_ACCESS_TOKEN === "replace-with-a-private-demo-password") return false;
  try { return new URL(env.APP_ORIGIN).origin === env.APP_ORIGIN; } catch { return false; }
}
function guard(request: Request, env: ServerEnv) {
  if (!accessConfigured(env)) throw new RequestError(503, "MUSIC_ACCESS_NOT_CONFIGURED", "音乐服务尚未开放，请先配置服务端访问口令。");
  const origin = request.headers.get("origin"); const site = request.headers.get("sec-fetch-site");
  const sameOrigin = originMatches(origin, env.APP_ORIGIN) || (request.method === "GET" && origin === null && site === "same-origin" && originMatches(new URL(request.url).origin, env.APP_ORIGIN));
  const digest = (value: string) => createHash("sha256").update(value).digest();
  // 来源与口令分开报错：笼统的一句"无法验证"会让使用者无从下手。
  if (!sameOrigin || (site !== null && site !== "same-origin")) {
    throw new RequestError(403, "MUSIC_ACCESS_DENIED", `地址栏与服务端 APP_ORIGIN 不一致（期望 ${env.APP_ORIGIN}；localhost、127.0.0.1、::1 已视为等价）。请检查协议和端口是否一致。`);
  }
  if (!timingSafeEqual(digest(request.headers.get("x-demo-token") ?? ""), digest(env.DEMO_ACCESS_TOKEN!))) {
    throw new RequestError(403, "MUSIC_ACCESS_DENIED", "演示口令不正确。请粘贴 .env.local 中 DEMO_ACCESS_TOKEN 等号后面的完整值（12 位左右），不要带引号或空格，也不要填成 MUSIC_API_KEY。");
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
        message: configured ? "Kie 音乐服务已配置；生成伴奏只发送文字，续写会上传你导出的雏形片段。真实效果仍需联调验证。" : "音乐服务尚未配置，当前不会调用生成或产生费用。" };
      return json(value);
    },
    create(request: Request): Promise<Response> {
      return respond(async () => { guard(request, env); const body = validateMusicRequest(await readJsonBody(request)); return json(await jobs.create(body), 202); });
    },
    extend(request: Request): Promise<Response> {
      return respond(async () => { guard(request, env); const body = validateExtendRequest(await readJsonBody(request)); return json(await jobs.create(body), 202); });
    },
    upload(request: Request): Promise<Response> {
      return respond(async () => {
        guard(request, env);
        const bytes = await readBinaryBody(request, MAX_CLIP_BYTES, clipTypes);
        if (!looksLikeAudio(bytes)) throw new RequestError(400, "INVALID_CLIP", "素材不是可识别的 WAV 或 MP3 文件，未上传。");
        try { return json({ url: await jobs.upload(bytes) }); }
        catch (error) { if (error instanceof MusicProviderError) throw new RequestError(502, "MUSIC_CLIP_UPLOAD_FAILED", error.message); throw error; }
      });
    },
    get(request: Request, id: string): Promise<Response> {
      return respond(async () => { guard(request, env); return json(await jobs.get(id)); });
    },
    list(request: Request): Promise<Response> {
      return respond(async () => { guard(request, env); return json({ jobs: await jobs.list() }); });
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
