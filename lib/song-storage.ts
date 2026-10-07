import { validateSongPlan } from "./song-plan.ts";
import type { RecordingAnalysis, SongPlan, SongSource, SoundRole } from "./song-types.ts";

export type StoredSongSnapshot = { revision: number; plan: SongPlan; sources: SongSource[]; origin: "local" | "manual" | "codex" };
type StoredSource = Omit<SongSource, "buffer"> & { sampleRate: number; channels: Float32Array[] };
export type SerializedSongSnapshot = Omit<StoredSongSnapshot, "sources"> & { version: 1; sources: StoredSource[] };
type BufferFactory = (options: AudioBufferOptions) => AudioBuffer;
const ROLES: SoundRole[] = ["pulse", "accent", "texture"];

function invalid(message: string): never { throw new Error(`本地工程数据损坏：${message}`); }
function object(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || ![Object.prototype, null].includes(Object.getPrototypeOf(value)) ||
    Reflect.ownKeys(value).length !== keys.length || !keys.every(key => Object.hasOwn(value, key))) invalid("字段不完整或包含未知内容");
  return value as Record<string, unknown>;
}
function list(value: unknown, min: number, max: number): asserts value is unknown[] {
  if (!Array.isArray(value) || value.length < min || value.length > max || Reflect.ownKeys(value).length !== value.length + 1 ||
    !Array.from({ length: value.length }, (_, index) => Object.hasOwn(value, index)).every(Boolean)) invalid("数组大小或内容不正确");
}
function numeric(value: unknown, min: number, max: number, integer = false): asserts value is number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max || (integer && !Number.isSafeInteger(value))) invalid("数值超出范围");
}
function text(value: unknown, max: number): asserts value is string {
  if (typeof value !== "string" || !value.trim() || value.length > max) invalid("名称或标识无效");
}
function audioSize(sampleRate: unknown, length: unknown, channels: unknown) {
  numeric(sampleRate, 8000, 192000, true); numeric(channels, 1, 2, true);
  numeric(length, Math.ceil(sampleRate * .05), sampleRate * 12 + 1, true);
}
function analysis(value: unknown, duration: number, rate: number): asserts value is RecordingAnalysis {
  const a = object(value, ["hits", "steps", "mode", "offsetMs", "summary"]);
  list(a.hits, 1, 16); list(a.steps, 16, 16); text(a.summary, 1000);
  a.steps.forEach(step => numeric(step, 0, 1));
  if (!a.steps.some(step => Number(step) > 0)) invalid("原声节奏为空");
  if (a.mode === "aligned") numeric(a.offsetMs, -75, 75, true);
  else if (a.mode !== "rebuilt" || a.offsetMs !== null) invalid("原声对齐信息无效");
  let previousEnd = 0;
  for (const value of a.hits) {
    const hit = object(value, ["startSec", "endSec", "peak"]);
    numeric(hit.startSec, previousEnd, duration); numeric(hit.endSec, hit.startSec + .01 - 1 / rate, duration);
    numeric(hit.peak, Number.MIN_VALUE, 32);
    if (hit.endSec - hit.startSec > .5 + 2 / rate) invalid("原声切片过长");
    previousEnd = hit.endSec;
  }
}
function validateRecord(value: unknown): SerializedSongSnapshot {
  const record = object(value, ["version", "revision", "plan", "sources", "origin"]);
  if (record.version !== 1) invalid("不支持此保存版本");
  numeric(record.revision, 0, Number.MAX_SAFE_INTEGER, true);
  if (!["local", "manual", "codex"].includes(record.origin as string)) invalid("工程来源无效");
  let plan: SongPlan;
  try { plan = validateSongPlan(record.plan); } catch { invalid("乐谱未通过校验"); }
  list(record.sources, 0, 3);
  const ids = new Set<string>(), roles = new Set<unknown>();
  for (const value of record.sources) {
    const source = object(value, ["id", "role", "label", "sampleRate", "channels", "analysis", "example"]);
    text(source.id, 128); text(source.label, 512);
    if (!ROLES.includes(source.role as SoundRole) || ids.has(source.id) || roles.has(source.role) || typeof source.example !== "boolean") invalid("原声身份无效或重复");
    ids.add(source.id); roles.add(source.role); list(source.channels, 1, 2);
    const first = source.channels[0];
    if (!(first instanceof Float32Array)) invalid("PCM 必须为 Float32Array");
    audioSize(source.sampleRate, first.length, source.channels.length);
    for (const channel of source.channels) {
      if (!(channel instanceof Float32Array) || channel.length !== first.length) invalid("PCM 声道长度不一致");
      // 允许解码音频超过满幅；拒绝非有限值和不可能用于正常录音的极端幅度。
      for (const sample of channel) if (!Number.isFinite(sample) || Math.abs(sample) > 16) invalid("PCM 包含无效幅度");
    }
    analysis(source.analysis, first.length / Number(source.sampleRate), Number(source.sampleRate));
  }
  return { ...(record as unknown as SerializedSongSnapshot), plan };
}

export function serializeSongSnapshot(snapshot: StoredSongSnapshot): SerializedSongSnapshot {
  list(snapshot.sources, 0, 3);
  const sources = snapshot.sources.map(source => {
    audioSize(source.buffer.sampleRate, source.buffer.length, source.buffer.numberOfChannels);
    return { id: source.id, role: source.role, label: source.label, example: source.example, analysis: source.analysis,
      sampleRate: source.buffer.sampleRate,
      channels: Array.from({ length: source.buffer.numberOfChannels }, (_, channel) => source.buffer.getChannelData(channel)) };
  });
  const record = validateRecord({ version: 1, revision: snapshot.revision, origin: snapshot.origin, plan: snapshot.plan, sources });
  return { ...record, sources: record.sources.map(source => ({ ...source, analysis: structuredClone(source.analysis), channels: source.channels.map(channel => channel.slice()) })) };
}

function browserBuffer(options: AudioBufferOptions): AudioBuffer {
  if (typeof AudioBuffer !== "undefined") return new AudioBuffer(options);
  if (typeof OfflineAudioContext !== "undefined") return new OfflineAudioContext(1, 1, options.sampleRate).createBuffer(options.numberOfChannels ?? 1, options.length, options.sampleRate);
  throw new Error("当前浏览器无法恢复本地工程的音频");
}
export function restoreSongSnapshot(value: unknown, createBuffer: BufferFactory = browserBuffer): StoredSongSnapshot {
  const record = validateRecord(value);
  return { revision: record.revision, origin: record.origin, plan: record.plan, sources: record.sources.map(source => {
    const buffer = createBuffer({ sampleRate: source.sampleRate, length: source.channels[0].length, numberOfChannels: source.channels.length });
    source.channels.forEach((channel, index) => buffer.getChannelData(index).set(channel));
    return { id: source.id, role: source.role, label: source.label, example: source.example, analysis: structuredClone(source.analysis), buffer };
  }) };
}

function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") { reject(new Error("当前浏览器不支持 IndexedDB 本地保存")); return; }
    const request = indexedDB.open("MelodyMate-song-v1", 1);
    let blocked = false;
    request.onupgradeneeded = () => { if (!request.result.objectStoreNames.contains("snapshots")) request.result.createObjectStore("snapshots"); };
    request.onerror = () => reject(new Error("无法打开本地工程存储，请检查浏览器存储权限", { cause: request.error }));
    request.onblocked = () => { blocked = true; reject(new Error("本地工程存储被其他页面占用，请关闭其他工作台后重试")); };
    request.onsuccess = () => {
      if (blocked) { request.result.close(); return; }
      request.result.onversionchange = () => request.result.close(); resolve(request.result);
    };
  });
}
async function transact(mode: IDBTransactionMode, record?: SerializedSongSnapshot): Promise<unknown> {
  const db = await database();
  try {
    return await new Promise((resolve, reject) => {
      const transaction = db.transaction("snapshots", mode), store = transaction.objectStore("snapshots");
      const request = record ? store.put(record, "current") : store.get("current");
      transaction.oncomplete = () => resolve(request.result);
      transaction.onabort = () => reject(new Error("本地工程保存或读取失败，原有保存不会被部分覆盖", { cause: transaction.error }));
      transaction.onerror = () => { /* 默认行为会中止事务，由 onabort 报告最终失败。 */ };
    });
  } finally { db.close(); }
}
let saves: Promise<unknown> = Promise.resolve();
export async function saveSongSnapshot(snapshot: StoredSongSnapshot): Promise<void> {
  // 在入队时复制，保证后续编辑不能改变等待写入的版本。
  const record = serializeSongSnapshot(snapshot);
  const operation = saves.catch(() => undefined).then(() => transact("readwrite", record));
  saves = operation;
  await operation;
}
export async function loadSongSnapshot(): Promise<StoredSongSnapshot | null> {
  await saves.catch(() => undefined);
  const value = await transact("readonly");
  return value === undefined ? null : restoreSongSnapshot(value);
}
