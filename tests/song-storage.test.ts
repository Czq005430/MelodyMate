import assert from "node:assert/strict";
import test from "node:test";
import { analyzeRecording } from "../lib/recording-analysis.ts";
import { createSongPlan } from "../lib/song-plan.ts";
import { loadSongSnapshot, restoreSongSnapshot, saveSongSnapshot, serializeSongSnapshot } from "../lib/song-storage.ts";
import type { StoredSongSnapshot } from "../lib/song-storage.ts";

function bufferFactory({ length, sampleRate, numberOfChannels = 1 }: AudioBufferOptions): AudioBuffer {
  const channels = Array.from({ length: numberOfChannels }, () => new Float32Array(length));
  return { length, sampleRate, numberOfChannels, duration: length / sampleRate,
    getChannelData: (channel: number) => channels[channel] } as AudioBuffer;
}
function snapshot(): StoredSongSnapshot {
  const buffer = bufferFactory({ length: 24000, sampleRate: 48000, numberOfChannels: 2 });
  for (let channel = 0; channel < 2; channel++) for (let frame = 4800; frame < buffer.length; frame++) {
    const t = (frame - 4800) / buffer.sampleRate;
    buffer.getChannelData(channel)[frame] = .6 * Math.exp(-t / .03) * Math.sin(t * Math.PI * 1200) * (channel ? .5 : 1);
  }
  return { revision: 7, origin: "codex", plan: createSongPlan(), sources: [{ id: "source-1", role: "pulse", label: "我的杯子.wav",
    buffer, analysis: analyzeRecording(buffer, 96, "pulse"), example: false }] };
}

test("PCM、采样率、两个声道和工程元数据完整往返，存储只使用白名单", () => {
  const input = snapshot();
  const stored = serializeSongSnapshot(Object.assign(input, { apiKey: "不要保存", token: "演示口令" }));
  assert.equal(stored.version, 1);
  assert.deepEqual(Object.keys(stored).sort(), ["version", "revision", "origin", "plan", "sources"].sort());
  const restored = restoreSongSnapshot(structuredClone(stored), bufferFactory);
  assert.deepEqual({ ...restored, sources: [] }, { revision: 7, origin: "codex", plan: input.plan, sources: [] });
  const source = restored.sources[0];
  assert.equal(source.id, input.sources[0].id); assert.equal(source.label, input.sources[0].label);
  assert.equal(source.role, "pulse"); assert.equal(source.example, false);
  assert.deepEqual(source.analysis, input.sources[0].analysis);
  assert.equal(source.buffer.sampleRate, 48000); assert.equal(source.buffer.numberOfChannels, 2);
  for (let channel = 0; channel < 2; channel++) assert.deepEqual(source.buffer.getChannelData(channel), input.sources[0].buffer.getChannelData(channel));
});

test("入库和恢复都复制PCM与乐谱，后续编辑不会污染另一个快照", () => {
  const input = snapshot(); const stored = serializeSongSnapshot(input);
  input.sources[0].buffer.getChannelData(0).fill(0); input.plan.title = "后来修改";
  assert.ok(stored.sources[0].channels[0].some(value => value !== 0));
  assert.notEqual(stored.plan.title, input.plan.title);
  const restored = restoreSongSnapshot(stored, bufferFactory);
  restored.sources[0].buffer.getChannelData(0).fill(0); restored.plan.title = "恢复后修改";
  restored.sources[0].analysis.steps.fill(0);
  assert.ok(stored.sources[0].channels[0].some(value => value !== 0));
  assert.notEqual(stored.plan.title, restored.plan.title); assert.ok(stored.sources[0].analysis.steps.some(value => value > 0));
});

test("无原声的初始工程可保存，已对齐分析和合成示例身份不丢失", () => {
  const input = snapshot(); input.sources[0].example = true;
  Object.assign(input.sources[0].analysis, { mode: "aligned", offsetMs: 20, summary: "已对齐到目标节奏" });
  assert.deepEqual(restoreSongSnapshot(serializeSongSnapshot(input), bufferFactory).sources[0].analysis, input.sources[0].analysis);
  assert.equal(restoreSongSnapshot(serializeSongSnapshot(input), bufferFactory).sources[0].example, true);
  input.sources = [];
  assert.deepEqual(restoreSongSnapshot(serializeSongSnapshot(input), bufferFactory), input);
});

test("拒绝损坏版本、工程、身份、重复角色和超限来源数量，分配音频前校验", () => {
  const mutations: ((record: any) => void)[] = [
    p => { p.version = 2; }, p => { p.revision = -1; }, p => { p.revision = 1.5; }, p => { p.revision = Number.MAX_SAFE_INTEGER + 1; },
    p => { p.origin = "remote"; }, p => { p.plan.bpm = 200; }, p => { p.extra = "hidden"; },
    p => { p.sources[0].id = ""; }, p => { p.sources[0].label = " "; }, p => { p.sources[0].role = "__proto__"; },
    p => { p.sources[0].example = "true"; }, p => { p.sources[0].secret = "hidden"; },
    p => { p.sources.push({ ...p.sources[0], id: "other" }); }, p => { p.sources.push({ ...p.sources[0], role: "accent" }); },
    p => { p.sources = Array(4).fill(p.sources[0]); }, p => { p.sources = Array(1); },
  ];
  for (const mutate of mutations) {
    const stored = serializeSongSnapshot(snapshot()); mutate(stored);
    let created = false;
    assert.throws(() => restoreSongSnapshot(stored, options => { created = true; return bufferFactory(options); }), /本地工程/);
    assert.equal(created, false);
  }
});

test("拒绝不等长、超时长、过多声道、稀疏或非有限PCM与异常采样率", () => {
  const mutations: ((record: any) => void)[] = [
    p => { p.sources[0].sampleRate = 0; }, p => { p.sources[0].sampleRate = 192001; }, p => { p.sources[0].sampleRate = 44100.5; },
    p => { p.sources[0].channels = []; }, p => { p.sources[0].channels.push(new Float32Array(24000)); },
    p => { p.sources[0].channels[1] = new Float32Array(2); }, p => { p.sources[0].channels = [new Float32Array(48000 * 12 + 2)]; },
    p => { p.sources[0].channels[0] = Array(24000); }, p => { p.sources[0].channels[0][1] = NaN; },
    p => { p.sources[0].channels[0][1] = Infinity; },
  ];
  for (const mutate of mutations) { const stored = serializeSongSnapshot(snapshot()); mutate(stored); assert.throws(() => restoreSongSnapshot(stored, bufferFactory), /本地工程/); }
});

test("切片不得越界、重叠或超长，分析模式和十六步力度必须有效", () => {
  const mutations: ((analysis: any) => void)[] = [
    a => { a.hits = []; }, a => { a.hits[0].startSec = -.01; }, a => { a.hits[0].endSec = 1; },
    a => { a.hits[0].endSec = a.hits[0].startSec; }, a => { a.hits[0].peak = NaN; }, a => { a.hits.push({ ...a.hits[0] }); },
    a => { a.steps = Array(16); }, a => { a.steps = Array(16).fill(0); }, a => { a.steps[0] = 1.1; },
    a => { a.mode = "detected"; }, a => { a.offsetMs = 10; }, a => { a.summary = ""; },
    a => { a.mode = "aligned"; a.offsetMs = null; }, a => { a.mode = "aligned"; a.offsetMs = 1000; },
  ];
  for (const mutate of mutations) { const stored = serializeSongSnapshot(snapshot()); mutate(stored.sources[0].analysis); assert.throws(() => restoreSongSnapshot(stored, bufferFactory), /本地工程/); }
});

test("缺少IndexedDB明确报错，失败的保存不会阻塞后续保存", async () => {
  await assert.rejects(loadSongSnapshot(), /本地保存|IndexedDB/);
  await assert.rejects(saveSongSnapshot(snapshot()), /本地保存|IndexedDB/);
  await assert.rejects(saveSongSnapshot(snapshot()), /本地保存|IndexedDB/);
});

test("保存严格按调用顺序串行，事务中止后下一次仍可完成", async () => {
  // 只控制 open/事务完成边界，不模拟 IndexedDB 的存储或查询实现。
  const original = Object.getOwnPropertyDescriptor(globalThis, "indexedDB");
  const writes: ReturnType<typeof serializeSongSnapshot>[] = [];
  type Transaction = { oncomplete?: () => void; onabort?: () => void; error: Error | null; objectStore(): { put(value: unknown): { result: string } } };
  const transactions: Transaction[] = [];
  const requests: { onsuccess?: () => void; result: unknown }[] = [];
  Object.defineProperty(globalThis, "indexedDB", { configurable: true, value: { open(name: string, version: number) {
    assert.equal(name, "MelodyMate-song-v1"); assert.equal(version, 1);
    const request = { result: { close() {}, transaction(store: string, mode: string) {
      assert.equal(store, "snapshots"); assert.equal(mode, "readwrite");
      const transaction: Transaction = { error: null, objectStore: () => ({ put(value: unknown) {
        writes.push(value as ReturnType<typeof serializeSongSnapshot>); return { result: "current" };
      } }) };
      transactions.push(transaction); return transaction;
    } } };
    requests.push(request); return request;
  } } });
  const turn = () => new Promise(resolve => setImmediate(resolve));
  try {
    const first = saveSongSnapshot(snapshot()); const firstFailure = assert.rejects(first, /本地工程/);
    const next = snapshot(); next.revision = 8;
    const second = saveSongSnapshot(next); next.plan.title = "保存调用之后的修改";
    await turn(); assert.equal(requests.length, 1);
    requests[0].onsuccess!(); await turn();
    assert.equal(requests.length, 1); assert.equal(writes[0].revision, 7);
    transactions[0].error = new Error("quota"); transactions[0].onabort!();
    await firstFailure; await turn(); assert.equal(requests.length, 2);
    requests[1].onsuccess!(); await turn();
    assert.equal(writes[1].revision, 8); assert.notEqual(writes[1].plan.title, next.plan.title);
    transactions[1].oncomplete!(); await second;
  } finally {
    if (original) Object.defineProperty(globalThis, "indexedDB", original);
    else Reflect.deleteProperty(globalThis, "indexedDB");
  }
});
