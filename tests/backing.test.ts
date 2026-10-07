import assert from "node:assert/strict";
import test from "node:test";
import { estimateBackingGrid } from "../lib/backing-grid.ts";
import { decodeBackingAudio, renderBackingMix } from "../lib/backing-audio.ts";
import { createSongPlan } from "../lib/song-plan.ts";
import type { SongSource } from "../lib/song-types.ts";

function audio(duration: number, rate = 44100, channels = 1): AudioBuffer {
  const data = Array.from({ length: channels }, () => new Float32Array(Math.round(duration * rate)));
  return { length: data[0].length, duration: data[0].length / rate, sampleRate: rate, numberOfChannels: channels, getChannelData: (channel: number) => data[channel] } as AudioBuffer;
}
function pulses(bpm: number, rate = 44100, offset = .25, channels = 1) {
  const buffer = audio(20, rate, channels);
  for (let at = offset; at < buffer.duration - .1; at += 60 / bpm) {
    for (let i = 0; i < rate * .04; i++) for (let channel = 0; channel < channels; channel++) {
      buffer.getChannelData(channel)[Math.round(at * rate) + i] = (channel ? -1 : 1) * .5 * Math.exp(-i / (rate * .008)) * Math.sin(i * 2 * Math.PI * 700 / rate);
    }
  }
  return buffer;
}
const options = { bpm: 120, offsetSec: .5, sourceGain: .8, backingGain: .6, mode: "mix" as const };
function source(): SongSource {
  const buffer = audio(.2);
  for (let i = 0; i < buffer.length; i++) buffer.getChannelData(0)[i] = (i % 2 ? -1 : 1) * (i < buffer.length / 2 ? .2 : .3);
  return { id: "wood", role: "pulse", label: "木头", buffer, example: false, analysis: { hits: [{ startSec: 0, endSec: .1, peak: .2 }, { startSec: .1, endSec: .2, peak: .3 }], steps: [1,0,0,0,1,0,0,0,1,0,0,0,1,0,0,0], mode: "rebuilt", offsetMs: null, summary: "测试" } };
}

test("节拍建议识别44.1/48kHz稳定脉冲，保留非负起拍候选", () => {
  for (const rate of [44100, 48000]) for (const bpm of [60, 96, 120, 180]) {
    const estimate = estimateBackingGrid(pulses(bpm, rate), bpm);
    assert.ok(estimate, `${rate}/${bpm}`);
    assert.ok(Math.abs(estimate.bpm - bpm) < 1, `${rate}/${bpm}: ${estimate.bpm}`);
    assert.ok(Math.abs(estimate.offsetSec - .25) < .025);
    assert.ok(estimate.confidence >= .5 && estimate.confidence <= 1);
  }
});

test("静音与没有重复拍点的持续音不给出网格，反相立体声不误判静音", () => {
  assert.equal(estimateBackingGrid(audio(10), 100), null);
  const sustained = audio(10, 48000);
  for (let i = 0; i < sustained.length; i++) sustained.getChannelData(0)[i] = .2 * Math.sin(i * Math.PI / 120);
  assert.equal(estimateBackingGrid(sustained, 100), null);
  assert.ok(estimateBackingGrid(pulses(120, 48000, .25, 2), 120));
  assert.throws(() => estimateBackingGrid(audio(10), NaN), /速度|BPM/);
});

test("孤立片头音效不能把后续稳定拍点的起拍相位整体带偏", () => {
  const buffer = pulses(120, 48000, 1);
  for (let i = 0; i < 48000 * .04; i++) buffer.getChannelData(0)[9600 + i] = .5 * Math.exp(-i / (48000 * .008)) * Math.sin(i * 2 * Math.PI * 700 / 48000);
  const estimate = estimateBackingGrid(buffer, 120);
  assert.ok(estimate);
  assert.ok(Math.abs(estimate.bpm - 120) < 1);
  assert.ok(Math.abs(estimate.offsetSec - 1) < .025);
});

type Event = { buffer: AudioBuffer; time: number; rate: number; stopTime?: number; cancelled: boolean };
class FakeOffline {
  static instances: FakeOffline[] = [];
  static decoded: AudioBuffer = audio(12, 44100, 2);
  static output = [0, 0];
  static onRendering: (() => void) | undefined;
  static finishRendering: (() => void) | undefined;
  sampleRate: number; length: number; numberOfChannels: number;
  destination = {}; events: Event[] = []; automation: number[][] = [];
  constructor(channels: number, length: number, rate: number) { this.numberOfChannels = channels; this.length = length; this.sampleRate = rate; FakeOffline.instances.push(this); }
  createBuffer(channels: number, length: number, rate: number) { return audio(length / rate, rate, channels); }
  async decodeAudioData() { return FakeOffline.decoded; }
  createGain() {
    const values: number[] = []; this.automation.push(values);
    return { gain: { value: 1, setValueAtTime(value: number, time: number) { values.push(value, time); }, linearRampToValueAtTime(value: number, time: number) { values.push(value, time); } }, connect() {}, disconnect() {} };
  }
  createBufferSource() {
    const event: Event = { buffer: null as unknown as AudioBuffer, time: -1, rate: 1, cancelled: false }; this.events.push(event);
    return { set buffer(value: AudioBuffer) { event.buffer = value; }, playbackRate: { get value() { return event.rate; }, set value(value: number) { event.rate = value; } }, connect() {}, disconnect() {}, start(time: number) { event.time = time; }, stop(time?: number) { if (time === undefined) event.cancelled = true; else event.stopTime = time; } };
  }
  async startRendering() {
    const buffer = this.createBuffer(this.numberOfChannels, this.length, this.sampleRate);
    for (let channel = 0; channel < this.numberOfChannels; channel++) buffer.getChannelData(channel).fill(FakeOffline.output[channel] ?? 0);
    if (FakeOffline.onRendering) {
      const pending = new Promise<AudioBuffer>(resolve => { FakeOffline.finishRendering = () => resolve(buffer); });
      FakeOffline.onRendering(); return pending;
    }
    return buffer;
  }
}
async function withAudio(run: () => Promise<void>) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "OfflineAudioContext");
  Object.defineProperty(globalThis, "OfflineAudioContext", { value: FakeOffline, configurable: true, writable: true });
  FakeOffline.instances = []; FakeOffline.output = [0, 0]; FakeOffline.decoded = audio(12, 44100, 2);
  FakeOffline.onRendering = undefined; FakeOffline.finishRendering = undefined;
  try { await run(); }
  finally { if (descriptor) Object.defineProperty(globalThis, "OfflineAudioContext", descriptor); else Reflect.deleteProperty(globalThis, "OfflineAudioContext"); }
}

test("伴奏只播放一次原速，原声按校准网格轮替，输出真实时长的44100双声道", async () => withAudio(async () => {
  const backing = audio(12.25, 48000, 2), plan = createSongPlan();
  plan.sections.forEach(section => { section.sourceRoles = ["pulse"]; section.energy = .5; });
  const rendered = await renderBackingMix(backing, [source()], plan, options);
  assert.equal(rendered.sampleRate, 44100); assert.equal(rendered.numberOfChannels, 2); assert.equal(rendered.duration, 12.25);
  const context = FakeOffline.instances.at(-1)!;
  assert.equal(context.events.filter(event => event.buffer === backing).length, 1);
  assert.deepEqual(context.events.filter(event => event.buffer === backing).map(event => [event.time, event.rate]), [[0, 1]]);
  const events = context.events.filter(event => event.buffer !== backing);
  assert.deepEqual(events.slice(0, 4).map(event => event.time), [.5, 1, 1.5, 2]);
  assert.notEqual(events[0].buffer.getChannelData(0)[0], events[1].buffer.getChannelData(0)[0]);
  assert.ok(events.every(event => event.time < backing.duration && event.stopTime! <= backing.duration));
  assert.ok(context.automation.some(values => values.at(-2) === 0 && values.at(-1) === backing.duration));
}));

test("共同峰值保护保留左右比例，纯伴奏无需原声，纯原声不排背景轨", async () => withAudio(async () => {
  FakeOffline.output = [2, 1];
  const rendered = await renderBackingMix(audio(10, 44100, 2), [], createSongPlan(), { ...options, mode: "backing" });
  assert.ok(Math.abs(rendered.getChannelData(0)[100] - .95) < 1e-6);
  assert.ok(Math.abs(rendered.getChannelData(1)[100] - .475) < 1e-6);
  assert.equal(FakeOffline.instances.at(-1)!.events.length, 1);
  const backing = audio(10);
  await renderBackingMix(backing, [source()], createSongPlan(), { ...options, mode: "source" });
  assert.ok(FakeOffline.instances.at(-1)!.events.every(event => event.buffer !== backing));
}));

test("非法范围和空原声在渲染前拒绝，已取消及长PCM处理中取消及时生效", async () => withAudio(async () => {
  for (const patch of [{ bpm: 59 }, { bpm: 181 }, { offsetSec: -1 }, { offsetSec: 11 }, { sourceGain: .1 }, { backingGain: 1.1 }]) {
    await assert.rejects(renderBackingMix(audio(10), [source()], createSongPlan(), { ...options, ...patch }), /速度|起拍|音量|范围/);
  }
  await assert.rejects(renderBackingMix(audio(9), [], createSongPlan(), { ...options, mode: "backing" }), /10|时长/);
  await assert.rejects(renderBackingMix(audio(10), [], createSongPlan(), options), /原声|声音/);
  const aborted = new AbortController(); aborted.abort();
  await assert.rejects(renderBackingMix(audio(10), [], createSongPlan(), { ...options, signal: aborted.signal }), { name: "AbortError" });
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 0);
  try { await assert.rejects(renderBackingMix(audio(120, 48000, 2), [source()], createSongPlan(), { ...options, signal: controller.signal }), { name: "AbortError" }); }
  finally { clearTimeout(timer); }
}));

test("独立解码限制50MiB、10～360秒和最多双声道，不沿用12秒原声入口", async () => withAudio(async () => {
  assert.equal((await decodeBackingAudio(new ArrayBuffer(8))).duration, 12);
  assert.equal(FakeOffline.instances.at(-1)!.sampleRate, 44100);
  await assert.rejects(decodeBackingAudio(new ArrayBuffer(0)), /文件|音频|大小/);
  await assert.rejects(decodeBackingAudio(new ArrayBuffer(50 * 1024 * 1024 + 1)), /50|大小/);
  for (const buffer of [audio(9), audio(360.1), audio(10, 44100, 3)]) {
    FakeOffline.decoded = buffer;
    await assert.rejects(decodeBackingAudio(new ArrayBuffer(8)), /时长|声道|10|360/);
  }
}));

test("原生离线计算未完成也能取消调用，已排音源停止且不等待结果", async () => withAudio(async () => {
  const controller = new AbortController();
  FakeOffline.onRendering = () => controller.abort();
  try {
    await assert.rejects(renderBackingMix(audio(10), [source()], createSongPlan(), { ...options, signal: controller.signal }), { name: "AbortError" });
    const events = FakeOffline.instances.at(-1)!.events;
    assert.ok(events.length > 1 && events.every(event => event.cancelled));
  } finally { FakeOffline.finishRendering?.(); }
}));
