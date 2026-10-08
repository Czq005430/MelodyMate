import { createHash, timingSafeEqual } from "node:crypto";
import { isIP } from "node:net";

export type ServerEnv = Record<string, string | undefined>;
export class RequestError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const MAX_BODY_BYTES = 16 * 1024;
const rateError = () => new RequestError(429, "RATE_LIMITED", "请求较多，请稍后再试。");
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

// 开发服务只监听回环地址，localhost 与 127.0.0.1 指向同一个服务，不该互相判死；协议和端口仍必须一致。
export function originMatches(actual: string | null, expected: string | undefined): boolean {
  if (!actual || !expected) return false;
  if (actual === expected) return true;
  let got: URL; let want: URL;
  try { got = new URL(actual); want = new URL(expected); } catch { return false; }
  return got.protocol === want.protocol && got.port === want.port
    && LOOPBACK_HOSTS.has(got.hostname) && LOOPBACK_HOSTS.has(want.hostname);
}

// This state belongs to one Node.js process, never to all serverless instances.
export function createRequestGuard({ env, clock = Date.now }: { env: ServerEnv; clock?: () => number }) {
  const windows = new Map<string, { count: number; expiresAt: number }>();
  let active = 0;
  return {
    check(request: Request): void {
      if (!env.APP_ORIGIN || !env.DEMO_ACCESS_TOKEN) {
        throw new RequestError(503, "ACCESS_NOT_CONFIGURED", "云端建议尚未开放，请使用本地预置。");
      }
      if (!originMatches(request.headers.get("origin"), env.APP_ORIGIN)) {
        throw new RequestError(403, "ACCESS_DENIED", "无法验证请求来源或演示口令。");
      }
      const now = clock();
      for (const [key, window] of windows) if (window.expiresAt <= now) windows.delete(key);
      // Enable only when the deployment proxy overwrites X-Real-IP on every request.
      const ip = env.TRUST_PROXY === "true" ? request.headers.get("x-real-ip") : null;
      const key = ip && isIP(ip) ? ip : "all";
      const window = windows.get(key) ?? { count: 0, expiresAt: now + 60_000 };
      if (window.count >= 10) throw rateError();
      window.count++;
      windows.set(key, window);
      const digest = (value: string) => createHash("sha256").update(value).digest();
      if (!timingSafeEqual(digest(request.headers.get("x-demo-token") ?? ""), digest(env.DEMO_ACCESS_TOKEN))) {
        throw new RequestError(403, "ACCESS_DENIED", "无法验证请求来源或演示口令。");
      }
    },
    acquire(): () => void {
      if (active >= 2) throw rateError();
      active++;
      let released = false;
      return () => {
        if (!released) { active--; released = true; }
      };
    },
  };
}

export async function readJsonBody(request: Request): Promise<unknown> {
  const tooLarge = () => new RequestError(413, "BODY_TOO_LARGE", "请求内容不能超过 16 KiB。");
  const invalid = () => new RequestError(400, "INVALID_REQUEST", "请求内容不是有效的 JSON。");
  if (Number(request.headers.get("content-length")) > MAX_BODY_BYTES) throw tooLarge();
  if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json" || !request.body) {
    throw invalid();
  }
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY_BYTES) {
        await reader.cancel().catch(() => undefined);
        throw tooLarge();
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch (error) {
    if (error instanceof RequestError) throw error;
    throw invalid();
  } finally {
    reader.releaseLock();
  }
}

// 素材上传是二进制通道，不复用 16 KiB 的 JSON 读取器；上限由调用方给出。
export async function readBinaryBody(request: Request, maximum: number, allowedTypes: string[]): Promise<Uint8Array> {
  const type = request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() ?? "";
  if (!allowedTypes.includes(type)) throw new RequestError(415, "MEDIA_TYPE_UNSUPPORTED", "素材只接受 WAV 或 MP3。");
  if (Number(request.headers.get("content-length")) > maximum) throw new RequestError(413, "BODY_TOO_LARGE", "素材文件超过允许大小。");
  if (!request.body) throw new RequestError(400, "INVALID_REQUEST", "请求里没有音频内容。");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maximum) {
        await reader.cancel().catch(() => undefined);
        throw new RequestError(413, "BODY_TOO_LARGE", "素材文件超过允许大小。");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  if (!size) throw new RequestError(400, "INVALID_REQUEST", "素材文件是空的。");
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}
