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

// This state belongs to one Node.js process, never to all serverless instances.
export function createRequestGuard({ env, clock = Date.now }: { env: ServerEnv; clock?: () => number }) {
  const windows = new Map<string, { count: number; expiresAt: number }>();
  let active = 0;
  return {
    check(request: Request): void {
      if (!env.APP_ORIGIN || !env.DEMO_ACCESS_TOKEN) {
        throw new RequestError(503, "ACCESS_NOT_CONFIGURED", "云端建议尚未开放，请使用本地预置。");
      }
      if (request.headers.get("origin") !== env.APP_ORIGIN) {
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
