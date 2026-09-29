import assert from "node:assert/strict";
import test from "node:test";
import { pianoSampleFor, prepareHits, protectPcm, renderRecording, renderSong } from "../lib/song-render.ts";
import { createSongPlan, sectionTimings } from "../lib/song-plan.ts";
import type { SongPlan, SongSource } from "../lib/song-types.ts";

function source(samples: Float32Array, hits = [{ startSec: 0, endSec: 0.1, peak: 1 }]): SongSource {
  return {
    id: "cup", role: "pulse", label: "杯子", example: false,
    buffer: { sampleRate: 10000, length: samples.length, duration: samples.length / 10000,
      numberOfChannels: 1, getChannelData: () => samples } as unknown as AudioBuffer,
    analysis: { hits, steps: [1,0,0,0,1,0,0,0,1,0,0,0,1,0,0,0], mode: "rebuilt", offsetMs: null, summary: "测试" },
  };
}

test("钢琴选择最近的真实采样并以半音比率播放", () => {
  assert.deepEqual(pianoSampleFor(60), { rootMidi: 60, url: "/audio/piano/C4.mp3", rate: 1 });
  assert.equal(pianoSampleFor(47).rootMidi, 48);
  assert.equal(pianoSampleFor(72).url, "/audio/piano/C5.mp3");
  assert.ok(Math.abs(pianoSampleFor(64).rate - 2 ** (4 / 12)) < 1e-12);
  assert.throws(() => pianoSampleFor(NaN), /音高/);
});

test("有效击打去直流、最多六倍预增益且不修改原始录音", () => {
  const pcm = Float32Array.from({ length: 4000 }, (_, i) => (i % 2 ? -0.2 : 0.2) + 0.3);
  const original = pcm.slice();
  const hits = prepareHits(source(pcm, [{ startSec: 0.1, endSec: 0.2, peak: 1 }, { startSec: 0.25, endSec: 0.35, peak: 1 }]));
  assert.equal(hits.length, 2);
  assert.equal(hits[0].sampleRate, 10000);
  assert.ok(Math.abs(hits[0].gain - 3.5) < 1e-5);
  assert.ok(Math.abs(hits[0].data.reduce((sum, value) => sum + value, 0)) < 1e-5);
  assert.deepEqual(pcm, original);
  const quiet = prepareHits(source(Float32Array.from({ length: 1000 }, (_, i) => i % 2 ? -0.01 : 0.01)));
  assert.equal(quiet[0].gain, 6);
});

test("无效/过短击打被过滤，全部静音或无有效击打时清楚报错", () => {
  const pcm = Float32Array.from({ length: 4000 }, (_, i) => i % 2 ? -0.2 : 0.2);
  const hits = prepareHits(source(pcm, [
    { startSec: -1, endSec: 0, peak: 1 }, { startSec: 0, endSec: 0.001, peak: 1 },
    { startSec: 0.1, endSec: 0.2, peak: 1 }, { startSec: 1, endSec: 2, peak: 1 },
  ]));
  assert.equal(hits.length, 1);
  assert.throws(() => prepareHits(source(new Float32Array(1000))), /杯子.*有效/);
  assert.throws(() => prepareHits(source(pcm, [])), /有效/);
});

test("混音只降低过高峰值，尾部归零，不放大安静结果", async () => {
  const loud = new Float32Array(1000).fill(2);
  await protectPcm(loud, 10000);
  assert.ok(Math.max(...loud) <= 0.950001);
  assert.equal(loud.at(-1), 0);
  const quiet = new Float32Array(1000).fill(0.01);
  await protectPcm(quiet, 10000);
  assert.equal(quiet[0], Math.fround(0.01));
  await assert.rejects(protectPcm(new Float32Array([NaN]), 44100), /非有限/);
});

test("取消在任何音频上下文或网络请求之前生效", async () => {
  const abort = new AbortController();
  abort.abort();
  await assert.rejects(renderSong([], {} as SongPlan, { signal: abort.signal }), { name: "AbortError" });
  await assert.rejects(protectPcm(new Float32Array(1000), 44100, abort.signal), { name: "AbortError" });
});

class FakeOffline {
  static instances: FakeOffline[] = [];
  sampleRate: number;
  length: number;
  destination = {};
  started = false;
  nodes: Array<{ buffer: AudioBuffer; time: number; stopped: boolean }> = [];
  constructor(_channels: number, length: number, rate: number) {
    this.length = length; this.sampleRate = rate; FakeOffline.instances.push(this);
  }
  createBuffer(_channels: number, length: number, sampleRate: number) {
    const pcm = new Float32Array(length);
    return { sampleRate, length, duration: length / sampleRate, numberOfChannels: 1, getChannelData: () => pcm } as unknown as AudioBuffer;
  }
  async decodeAudioData() { const buffer = this.createBuffer(1, 44100, 44100); buffer.getChannelData(0).fill(.1); return buffer; }
  createGain() { return { gain: { setValueAtTime() {}, linearRampToValueAtTime() {} }, connect() {} }; }
  createBufferSource() {
    const event = { buffer: null as unknown as AudioBuffer, time: -1, stopped: false };
    this.nodes.push(event);
    return {
      set buffer(buffer: AudioBuffer) { event.buffer = buffer; }, playbackRate: { value: 1 }, connect() {}, disconnect() {},
      start(at: number) { event.time = at; }, stop(at?: number) { if (at === undefined) event.stopped = true; },
    };
  }
  async startRendering() { this.started = true; return this.createBuffer(1, this.length, this.sampleRate); }
}

async function fakeAudio<T>(run: () => Promise<T>): Promise<T> {
  const old = Object.getOwnPropertyDescriptor(globalThis, "OfflineAudioContext");
  Object.defineProperty(globalThis, "OfflineAudioContext", { value: FakeOffline, writable: true, configurable: true });
  FakeOffline.instances = [];
  try { return await run(); }
  finally { if (old) Object.defineProperty(globalThis, "OfflineAudioContext", old); else Reflect.deleteProperty(globalThis, "OfflineAudioContext"); }
}

test("只有一个录音也为缺失角色回退，整曲120秒且分段保留整曲切片轮替", async () => fakeAudio(async () => {
  const pcm = Float32Array.from({ length: 4000 }, (_, i) => (i % 2 ? -1 : 1) * (Math.floor(i / 1000) + 1) * .1);
  const recording = source(pcm, [0, .1, .2].map(startSec => ({ startSec, endSec: startSec + .1, peak: 1 })));
  const plan = createSongPlan(), theme = sectionTimings(plan).find(section => section.id === "theme")!;
  const whole = await renderSong([recording], plan, { sourceOnly: true });
  assert.equal(whole.duration, 120);
  assert.equal(whole.sampleRate, 44100);
  const full = FakeOffline.instances.at(-1)!;
  const excerpt = await renderSong([recording], plan, { sourceOnly: true, sectionId: "theme" });
  assert.equal(excerpt.duration, theme.durationSec);
  const partial = FakeOffline.instances.at(-1)!;
  const expected = full.nodes.filter(node => node.time >= theme.startSec && node.time < theme.startSec + theme.durationSec);
  assert.ok(expected.length > 0);
  assert.deepEqual(partial.nodes.map(node => [node.time, node.buffer.getChannelData(0)[0]]), expected.map(node => [node.time - theme.startSec, node.buffer.getChannelData(0)[0]]));
}));

test("原录音保留时长，整理后16格重复两次且轮替片段", async () => fakeAudio(async () => {
  const recording = source(Float32Array.from({ length: 4000 }, (_, i) => i % 2 ? -.2 : .2));
  assert.equal((await renderRecording(recording, "original", 96)).duration, .4);
  assert.equal((await renderRecording(recording, "arranged", 96)).duration, 5);
  assert.deepEqual(FakeOffline.instances.at(-1)!.nodes.map(node => node.time), [0, .625, 1.25, 1.875, 2.5, 3.125, 3.75, 4.375]);
}));

test("大批调度之间可取消，及时拒绝且停止已排节点", async () => fakeAudio(async () => {
  const controller = new AbortController();
  const recording = source(Float32Array.from({ length: 4000 }, (_, i) => i % 2 ? -.2 : .2));
  const timer = setTimeout(() => controller.abort(), 0);
  try {
    await assert.rejects(renderSong([recording], createSongPlan(), { sourceOnly: true, signal: controller.signal }), { name: "AbortError" });
    const context = FakeOffline.instances.at(-1)!;
    assert.ok(context.nodes.length > 0 && context.nodes.every(node => node.stopped));
    assert.equal(context.started, false);
  } finally { clearTimeout(timer); }
}));

test("钢琴加载失败明确报错，重试成功后复用资源 promise", async () => fakeAudio(async () => {
  const oldFetch = globalThis.fetch;
  let requests = 0, fail = true;
  globalThis.fetch = async () => { requests++; return fail ? new Response(null, { status: 503 }) : new Response(new Uint8Array([1])); };
  try {
    const recording = source(Float32Array.from({ length: 4000 }, (_, i) => i % 2 ? -.2 : .2));
    const plan = createSongPlan(); plan.sections.forEach(section => { section.bass = false; section.pad = false; });
    await assert.rejects(renderSong([recording], plan, { sectionId: "theme" }), /钢琴采样加载失败/);
    const failedRequests = requests; fail = false;
    await renderSong([recording], plan, { sectionId: "theme" });
    assert.ok(requests > failedRequests);
    const successfulRequests = requests;
    await renderSong([recording], plan, { sectionId: "theme" });
    assert.equal(requests, successfulRequests);
  } finally { globalThis.fetch = oldFetch; }
}));
