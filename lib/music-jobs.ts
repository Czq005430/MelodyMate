import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { MusicJob, MusicJobRequest, MusicJobSummary } from "./music-types.ts";
import { createMusicProvider, MusicAudioExpiredError, MusicProviderError, musicSettings } from "./music-provider.ts";
import type { RemoteMusic } from "./music-provider.ts";
import { RequestError } from "./request-guard.ts";
import type { ServerEnv } from "./request-guard.ts";

type StoredJob = { job: MusicJob; fingerprint: string; taskId?: string; tracks?: RemoteMusic[]; contentTypes?: Array<string | null>; refreshedDownloadUrls?: boolean };
const active = new Set(["submitting", "pending", "generating", "unknown"]);
const statuses = new Set([...active, "ready", "failed"]);
const uuid = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i;
const missing = () => new RequestError(404, "MUSIC_NOT_FOUND", "找不到这份音乐任务或音频。");
const storageError = () => new RequestError(503, "MUSIC_STORAGE", "本地音乐记录无法保存或读取，已停止新提交，请检查私有数据目录。");
const snapshotKey = (request: MusicJobRequest) => JSON.stringify({
  projectRevision: request.projectRevision, sourceIds: request.sourceIds,
  brief: { prompt: request.brief.prompt, bpm: request.brief.bpm, durationSec: request.brief.durationSec, sourceLabels: request.brief.sourceLabels },
  clip: request.clip ? { url: request.clip.url, seconds: request.clip.seconds, continueAt: request.clip.continueAt } : null,
});
const publicJob = (record: StoredJob): MusicJob => structuredClone(record.job);

async function writeAtomic(filename: string, data: string | Uint8Array) {
  const temporary = `${filename}.${randomUUID()}.tmp`;
  try { await writeFile(temporary, data, { mode: 0o600 }); await rename(temporary, filename); }
  finally { await unlink(temporary).catch(() => undefined); }
}

// One local Node process owns this directory. This is not a cross-process/serverless lock.
export function createMusicJobs({ env, fetch, clock = Date.now }: { env: ServerEnv; fetch?: typeof globalThis.fetch; clock?: () => number }) {
  const dir = resolve(/* turbopackIgnore: true */ env.MUSIC_DATA_DIR || join(process.cwd(), ".music-data"));
  const provider = createMusicProvider({ env, fetch });
  let records: StoredJob[] = [];
  let initialized: Promise<void> | undefined;
  let queue: Promise<unknown> = Promise.resolve();
  let unhealthy = false;
  const polling = new Map<string, Promise<MusicJob>>();
  async function save() {
    try {
      await writeAtomic(join(dir, "jobs.json"), JSON.stringify({ version: 1, jobs: records }));
    } catch { unhealthy = true; throw storageError(); }
  }
  async function load() {
    try {
      await mkdir(dir, { recursive: true, mode: 0o700 });
      let text: string;
      try { text = await readFile(join(dir, "jobs.json"), "utf8"); }
      catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return; throw error; }
      const parsed = JSON.parse(text);
      if (parsed.version !== 1 || !Array.isArray(parsed.jobs)) throw storageError();
      for (const item of parsed.jobs) {
        if (!item?.job || !uuid.test(item.job.id) || !uuid.test(item.job.requestId) || !statuses.has(item.job.status)
          || !Number.isFinite(Date.parse(item.job.createdAt)) || typeof item.fingerprint !== "string"
          || snapshotKey(item.job) !== item.fingerprint || !Array.isArray(item.job.candidates)) throw storageError();
        if (item.job.status === "submitting") {
          item.job.status = "unknown";
          item.job.message = "服务重启前的提交结果无法确认，预算仍保留，请勿重复生成。";
        }
      }
      records = parsed.jobs;
      await save();
    } catch { unhealthy = true; throw storageError(); }
  }
  function locked<T>(work: () => Promise<T>): Promise<T> {
    const task = queue.then(async () => {
      if (unhealthy) throw storageError();
      await (initialized ??= load());
      return work();
    });
    queue = task.catch(() => undefined); return task;
  }
  function find(id: string) {
    const record = uuid.test(id) && records.find((item) => item.job.id === id);
    if (!record) throw missing(); return record;
  }
  async function cacheTracks(record: StoredJob) {
    for (const [index, track] of record.tracks!.entries()) {
      if (record.contentTypes?.[index]) continue;
      const audio = await provider.download(track.url);
      await writeAtomic(join(dir, `${record.job.id}-${index}.audio`), audio.bytes);
      await locked(async () => { (record.contentTypes ??= [])[index] = audio.contentType; await save(); });
    }
  }
  async function refreshDownloadUrls(record: StoredJob) {
    const result = await provider.query(record.taskId!);
    if (result.state === "failed") throw new MusicAudioExpiredError();
    if (result.state !== "ready" || !result.tracks) throw new MusicProviderError("音乐服务暂未提供新的下载地址，可以稍后重试查询。");
    const tracks = result.tracks;
    await locked(async () => {
      // A transient query failure does not consume the successful-refresh allowance.
      record.refreshedDownloadUrls = true;
      const previous = record.tracks!;
      record.contentTypes = tracks.map((track, index) => {
        const old = previous[index];
        // The parser's position-only fallback ID cannot identify a track after its URL changes.
        const sameAsset = old && (old.url === track.url || (old.id && old.id !== String(index) && old.id === track.id));
        return sameAsset ? record.contentTypes?.[index] ?? null : null;
      });
      record.tracks = tracks;
      await save();
    });
  }
  async function poll(id: string): Promise<MusicJob> {
    const record = await locked(async () => find(id));
    if (!record.taskId || record.job.status === "ready" || record.job.status === "failed") return publicJob(record);
    try {
      if (!record.tracks) {
        const result = await provider.query(record.taskId);
        await locked(async () => {
          record.job.status = result.state === "ready" ? "generating" : result.state;
          record.job.message = result.state === "failed" ? "音乐服务未能生成结果；这次提交仍计入每日预算。" : "音乐正在生成，可以稍后查询。";
          if (result.tracks) { record.tracks = result.tracks; record.job.message = "音乐已生成，正在保存音频。"; }
          await save();
        });
      }
      if (record.tracks) {
        try { await cacheTracks(record); }
        catch (error) {
          if (!(error instanceof MusicAudioExpiredError) || record.refreshedDownloadUrls) throw error;
          await refreshDownloadUrls(record);
          await cacheTracks(record);
        }
        await locked(async () => {
          record.job.candidates = record.tracks!.map((track, index) => ({ id: `${record.job.id}-${index}`, title: track.title,
            durationSec: track.durationSec, audioUrl: `/api/music/jobs/${record.job.id}/audio/${index}` }));
          record.job.status = "ready"; record.job.message = "音乐已缓存；请试听后再选择，时长与节拍仍需试听确认。";
          await save();
        });
      }
    } catch (error) {
      if (error instanceof RequestError) throw error;
      await locked(async () => {
        if (error instanceof MusicAudioExpiredError) {
          record.job.status = "failed";
          record.job.message = "音频地址已失效，刷新后仍无法保存，本次任务已结束且预算保留；没有重新生成。";
        } else record.job.message = record.tracks ? "音乐已生成但保存未完成，请重试保存；不会再次生成或重复提交费用。"
          : `${error instanceof MusicProviderError ? error.message : "音乐状态暂时查询失败。"} 可以重试查询，不会重新生成。`;
        await save();
      });
    }
    return publicJob(record);
  }
  return {
    async create(input: MusicJobRequest): Promise<MusicJob> {
      const request = structuredClone(input);
      const reserved = await locked(async () => {
        const existing = records.find((record) => record.job.requestId === request.requestId);
        if (existing) {
          if (existing.fingerprint !== snapshotKey(request)) throw new RequestError(409, "MUSIC_REQUEST_CONFLICT", "此请求编号已用于另一份工程，请重新开始这次生成。");
          return { record: existing, submit: false };
        }
        const settings = musicSettings(env);
        if (!settings.valid) throw new RequestError(503, "MUSIC_NOT_CONFIGURED", "音乐服务尚未正确配置，当前不会发起生成。");
        if (records.some((record) => active.has(record.job.status))) throw new RequestError(429, "MUSIC_BUSY", "已有音乐任务进行中或提交结果未确认，请先处理该任务。");
        const date = new Date(clock()).toISOString();
        if (records.filter((record) => record.job.createdAt.slice(0, 10) === date.slice(0, 10)).length >= settings.maxJobsPerDay) {
          throw new RequestError(429, "MUSIC_DAILY_LIMIT", "今日音乐提交预算已用完，明日（UTC）再试。");
        }
        const record: StoredJob = { fingerprint: snapshotKey(request), job: { ...request, id: randomUUID(), provider: "kie", createdAt: date,
          status: "submitting", message: request.clip ? "已保留本次预算，正在上传素材并提交续写任务。" : "已保留本次预算，正在提交音乐任务。", candidates: [] } };
        records.push(record); await save(); return { record, submit: true };
      });
      if (!reserved.submit) return publicJob(reserved.record);
      const record = reserved.record;
      try {
        const taskId = record.job.clip ? await provider.createExtend(record.job.clip, request.brief) : await provider.create(request.brief);
        await locked(async () => { record.taskId = taskId; record.job.status = "pending"; record.job.message = "音乐任务已提交，等待生成。"; await save(); });
      } catch (error) {
        if (error instanceof RequestError) throw error;
        await locked(async () => {
          record.job.status = error instanceof MusicProviderError && !error.uncertain ? "failed" : "unknown";
          record.job.message = record.job.status === "unknown" ? "提交结果无法确认，已保留预算，请勿重复生成；请在服务商后台核对。"
            : "音乐服务拒绝本次生成，请检查配置或额度；这次提交仍计入每日预算。";
          await save();
        });
      }
      return publicJob(record);
    },
    get(id: string): Promise<MusicJob> {
      const current = polling.get(id); if (current) return current;
      const pending = poll(id).finally(() => polling.delete(id)); polling.set(id, pending); return pending;
    },
    // 浏览器存储按标签页和地址隔离，任务台账只在服务端；列表是跨标签页找回结果的唯一入口。
    list(): Promise<MusicJobSummary[]> {
      return locked(async () => [...records].sort((left, right) => right.job.createdAt.localeCompare(left.job.createdAt)).slice(0, 8)
        .map(record => ({ id: record.job.id, status: record.job.status, createdAt: record.job.createdAt,
          continued: !!record.job.clip, candidates: record.job.candidates.length, prompt: record.job.brief.prompt })));
    },
    async audio(id: string, index: number): Promise<{ bytes: Uint8Array; contentType: string }> {
      const type = await locked(async () => {
        const record = find(id);
        if (record.job.status !== "ready" || !Number.isInteger(index) || index < 0 || index >= record.job.candidates.length || !record.contentTypes?.[index]) throw missing();
        return record.contentTypes[index];
      });
      try { return { bytes: new Uint8Array(await readFile(join(dir, `${id}-${index}.audio`))), contentType: type }; }
      catch { throw missing(); }
    },
    // 素材只转交给服务商的上传通道，本机不保存原始音频；未配置时绝不发起上传。
    async upload(bytes: Uint8Array): Promise<string> {
      if (!musicSettings(env).valid) throw new RequestError(503, "MUSIC_NOT_CONFIGURED", "音乐服务尚未正确配置，当前不会上传素材。");
      return provider.uploadClip(bytes);
    },
  };
}
