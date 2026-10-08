import type { MusicBrief, MusicClip } from "./music-types.ts";
import type { ServerEnv } from "./request-guard.ts";

export type RemoteMusic = { id: string; title: string; url: string; durationSec: number | null };
export type MusicQuery = { state: "pending" | "generating" | "ready" | "failed"; tracks?: RemoteMusic[] };
export class MusicProviderError extends Error {
  uncertain: boolean;
  constructor(message: string, uncertain = false) { super(message); this.uncertain = uncertain; }
}
export class MusicAudioExpiredError extends MusicProviderError {
  constructor() { super("音频下载地址已失效或无法访问。"); }
}
const hosts = new Set(["file.aiquickdraw.com", "tempfile.aiquickdraw.com", "cdn1.suno.ai", "cdn2.suno.ai"]);
// 素材上传走 Kie 的另一套服务，域名与音乐接口不同；上传直链只允许回给音乐接口，不从本机下载。
const fileApi = "https://kieai.redpandaai.co";
const uploadHosts = new Set(["tempfile.redpandaai.co", "file.redpandaai.co", "tempfileb.aiquickdraw.com", "tempfile.aiquickdraw.com"]);
const models = new Set(["V6", "V6_MINI", "V6_WILD"]);
const rejected = new Set([400, 401, 402, 403, 404, 422, 429]);
const protocol = () => new MusicProviderError("音乐服务返回的协议不匹配，请核对服务商文档。");
const object = (value: unknown): Record<string, unknown> | null => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;

export function musicSettings(env: ServerEnv) {
  const model = env.MUSIC_MODEL || "V6";
  const maxJobsPerDay = env.MUSIC_MAX_JOBS_PER_DAY === undefined ? 12 : Number(env.MUSIC_MAX_JOBS_PER_DAY);
  return { model, maxJobsPerDay, valid: models.has(model) && Number.isSafeInteger(maxJobsPerDay) && maxJobsPerDay > 0 && Boolean(env.MUSIC_API_KEY?.trim()) };
}

function audioUrl(value: unknown): string {
  if (typeof value !== "string" || value.length > 4096) throw protocol();
  let url: URL;
  try { url = new URL(value); } catch { throw protocol(); }
  if (url.protocol !== "https:" || !hosts.has(url.hostname) || url.username || url.password || url.port || url.hash) {
    throw new MusicProviderError("音频地址不在允许的提供商范围，未下载文件。");
  }
  return url.href;
}

// Only these explicit response shapes are accepted; cover/image URLs are never recursively collected.
// resultObject.data[] 带 duration 与来源字段，优先于只有地址字符串的 resultUrls。
export function parseMusicResult(raw: unknown): RemoteMusic[] {
  let value: unknown;
  try { value = typeof raw === "string" ? JSON.parse(raw) : raw; } catch { throw protocol(); }
  const result = object(value);
  const nested = object(result?.data);
  const inner = object(result?.resultObject);
  const list = (Array.isArray(inner?.data) ? inner.data : undefined)
    ?? (Array.isArray(value) ? value : undefined)
    ?? (Array.isArray(result?.resultUrls) ? result.resultUrls : undefined)
    ?? (Array.isArray(result?.tracks) ? result.tracks : undefined)
    ?? (Array.isArray(nested?.data) ? nested.data : undefined)
    ?? (Array.isArray(result?.data) ? result.data : undefined);
  if (!list || list.length < 1 || list.length > 4) throw protocol();
  return list.map((entry, index) => {
    const track = object(entry);
    const url = audioUrl(typeof entry === "string" ? entry : track?.audio_url ?? track?.audioUrl);
    const duration = track?.duration;
    return {
      id: typeof track?.id === "string" ? track.id.slice(0, 120) : String(index),
      title: typeof track?.title === "string" && track.title.trim() ? [...track.title.trim()].slice(0, 80).join("") : `方向 ${index + 1}`,
      url, durationSec: typeof duration === "number" && Number.isFinite(duration) && duration > 0 && duration <= 3600 ? duration : null,
    };
  });
}

// 素材直链只允许交给音乐接口，本机不下载；域名与生成结果白名单分开维护。
export function clipUrl(value: unknown): string {
  if (typeof value !== "string" || value.length > 4096) throw protocol();
  let url: URL;
  try { url = new URL(value); } catch { throw protocol(); }
  if (url.protocol !== "https:" || !uploadHosts.has(url.hostname) || url.username || url.password || url.port || url.hash) {
    throw new MusicProviderError("素材地址不在允许的上传服务范围，未提交续写。");
  }
  return url.href;
}

// continue_at 必须落在素材时长之内：超出时上游不一定报错，但结果语义未定义（实测 60 秒起点配 9.6 秒素材仍"成功"）。
export function validateClip(value: unknown): MusicClip {
  const clip = object(value);
  if (!clip || Object.keys(clip).join(",") !== "url,seconds,continueAt") throw new MusicProviderError("续写素材信息不完整，请重新导出雏形。");
  const { seconds, continueAt } = clip;
  if (typeof seconds !== "number" || !Number.isFinite(seconds) || seconds < 10 || seconds > 480) throw new MusicProviderError("续写素材须在 10～480 秒之间。");
  if (typeof continueAt !== "number" || !Number.isFinite(continueAt) || continueAt <= 0 || continueAt >= seconds) {
    throw new MusicProviderError("续写起点必须落在素材时长之内，否则模型行为不可预期。");
  }
  return { url: clipUrl(clip.url), seconds, continueAt };
}

async function readBytes(response: Response, maximum: number): Promise<Uint8Array> {
  if (!response.body) throw protocol();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    if (Number(response.headers.get("content-length")) > maximum) throw new MusicProviderError("音乐服务返回文件过大，已停止下载。");
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maximum) throw new MusicProviderError("音乐服务返回文件过大，已停止下载。");
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    return bytes;
  } catch (error) {
    await reader.cancel().catch(() => undefined); throw error;
  } finally { reader.releaseLock(); }
}

function audioType(bytes: Uint8Array): string {
  const head = new TextDecoder().decode(bytes.subarray(0, 12));
  if (head.startsWith("ID3") || (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0)) return "audio/mpeg";
  if (head.startsWith("RIFF") && head.slice(8) === "WAVE") return "audio/wav";
  if (head.startsWith("OggS")) return "audio/ogg";
  if (head.startsWith("fLaC")) return "audio/flac";
  if (head.slice(4, 8) === "ftyp") return "audio/mp4";
  if (bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) return "audio/webm";
  throw new MusicProviderError("返回文件不是受支持的音频，未保存。");
}

export function createMusicProvider({ env, fetch: fetcher = globalThis.fetch }: { env: ServerEnv; fetch?: typeof fetch }) {
  async function api(path: string, body?: unknown): Promise<Record<string, unknown>> {
    if (!musicSettings(env).valid) throw new MusicProviderError("音乐服务尚未正确配置。");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20_000);
    try {
      const response = await fetcher(`https://api.kie.ai/api/v1/jobs/${path}`, {
        method: body ? "POST" : "GET", redirect: "error", signal: controller.signal,
        headers: { authorization: `Bearer ${env.MUSIC_API_KEY}`, ...(body ? { "content-type": "application/json" } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      if (!response.ok) throw new MusicProviderError("音乐服务拒绝或未能完成请求，请检查额度及配置。", Boolean(body) && !rejected.has(response.status));
      let parsed: unknown;
      try { parsed = JSON.parse(new TextDecoder().decode(await readBytes(response, 1024 * 1024))); } catch { throw new MusicProviderError("音乐服务返回的协议不匹配。", Boolean(body)); }
      const result = object(parsed);
      if (!result || typeof result.code !== "number") throw new MusicProviderError("音乐服务返回的协议不匹配。", Boolean(body));
      if (result.code !== 200) throw new MusicProviderError("音乐服务拒绝或未能完成请求，请检查额度及配置。", Boolean(body) && !rejected.has(result.code));
      const data = object(result.data);
      if (!data) throw new MusicProviderError("音乐服务返回的协议不匹配。", Boolean(body));
      return data;
    } catch (error) {
      if (error instanceof MusicProviderError) throw error;
      throw new MusicProviderError(body ? "提交结果暂时无法确认，已保留预算，请勿重复生成。" : "音乐状态暂时查询失败，可以重试查询。", Boolean(body));
    } finally { clearTimeout(timer); controller.abort(); }
  }
  return {
    async create(brief: MusicBrief): Promise<string> {
      const style = `纯器乐伴奏，无人声、无鼓、无打击乐。稳定 ${brief.bpm} BPM，为用户的日常敲击声留出空间。${brief.prompt}`;
      if ([...style].length > 1000) throw new MusicProviderError("音乐描述超过服务商长度限制。");
      const data = await api("createTask", { model: "ai-music-api/generate", input: {
        custom_mode: true, instrumental: true, model: musicSettings(env).model,
        title: "MelodyMate 器乐伴奏", style, duration: brief.durationSec,
      } });
      if (typeof data.taskId !== "string" || !data.taskId || data.taskId.length > 200) throw new MusicProviderError("提交结果缺少任务编号，请勿重复生成。", true);
      return data.taskId;
    },
    async createExtend(clip: MusicClip, brief: MusicBrief): Promise<string> {
      const style = `纯器乐续写，无人声、无歌词。稳定 ${brief.bpm} BPM，前段是用户的真实生活敲击声，请保留它的音色与节奏感继续发展。${brief.prompt}`;
      if ([...style].length > 1000) throw new MusicProviderError("续写描述超过服务商长度限制。");
      const data = await api("createTask", { model: "ai-music-api/upload-and-extend-audio", input: {
        upload_url: clip.url, instrumental: true, model: musicSettings(env).model,
        continue_at: clip.continueAt, style, title: "MelodyMate 雏形续写",
        negative_tags: "vocals, lyrics, humming, sudden tempo change, key change",
      } });
      if (typeof data.taskId !== "string" || !data.taskId || data.taskId.length > 200) throw new MusicProviderError("提交结果缺少任务编号，请勿重复生成。", true);
      return data.taskId;
    },
    async uploadClip(bytes: Uint8Array): Promise<string> {
      if (!musicSettings(env).valid) throw new MusicProviderError("音乐服务尚未正确配置。");
      const form = new FormData();
      form.append("file", new Blob([bytes as BlobPart], { type: "audio/wav" }), "melodymate-clip.wav");
      form.append("uploadPath", "melodymate");
      const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 45_000);
      try {
        const response = await fetcher(`${fileApi}/api/file-stream-upload`, { method: "POST", redirect: "error", signal: controller.signal,
          headers: { authorization: `Bearer ${env.MUSIC_API_KEY}` }, body: form });
        let parsed: unknown;
        try { parsed = JSON.parse(await response.text()); } catch { throw new MusicProviderError("素材上传结果无法确认，请先在服务商后台核对，不要重复上传。", true); }
        const result = object(parsed);
        if (!result || typeof result.code !== "number") throw protocol();
        const data = object(result.data);
        if (result.code !== 200 || typeof data?.downloadUrl !== "string") throw new MusicProviderError("素材上传被拒绝，未提交续写。", !rejected.has(result.code));
        return clipUrl(data.downloadUrl);
      } catch (error) {
        if (error instanceof MusicProviderError) throw error;
        throw new MusicProviderError("素材上传结果无法确认，请检查本机网络后重试，不要重复上传。", true);
      } finally { clearTimeout(timer); controller.abort(); }
    },
    async query(taskId: string): Promise<MusicQuery> {
      const data = await api(`recordInfo?taskId=${encodeURIComponent(taskId)}`);
      if (data.state === "waiting" || data.state === "queuing") return { state: "pending" };
      if (data.state === "generating") return { state: "generating" };
      if (data.state === "fail") return { state: "failed" };
      if (data.state === "success") return { state: "ready", tracks: parseMusicResult(data.resultJson) };
      throw protocol();
    },
    async download(value: string): Promise<{ bytes: Uint8Array; contentType: string }> {
      const url = audioUrl(value);
      const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 45_000);
      try {
        const response = await fetcher(url, { redirect: "error", signal: controller.signal });
        if ([403, 404, 410].includes(response.status)) throw new MusicAudioExpiredError();
        if (!response.ok || response.redirected) throw new MusicProviderError("音频下载未完成，可以重试保存。");
        const type = response.headers.get("content-type")?.split(";")[0].trim().toLowerCase();
        if (type && !type.startsWith("audio/") && type !== "application/octet-stream") throw new MusicProviderError("返回文件不是音频，未保存。");
        const bytes = await readBytes(response, 50 * 1024 * 1024);
        return { bytes, contentType: audioType(bytes) };
      } catch (error) {
        if (error instanceof MusicProviderError) throw error;
        throw new MusicProviderError("音频下载未完成，可以重试保存。");
      } finally { clearTimeout(timer); controller.abort(); }
    },
  };
}
