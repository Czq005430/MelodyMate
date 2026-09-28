import assert from "node:assert/strict";
import test from "node:test";
import { analyzeSource, monoSamples, suggestTrim } from "../lib/source-analysis.ts";
import type { AudioData } from "../lib/types.ts";

function audio(channels: Float32Array[], sampleRate = 48000): AudioData {
  return { sampleRate, length: channels[0].length, numberOfChannels: channels.length,
    getChannelData: (channel) => channels[channel] };
}

function alternating(length: number, amplitude: number, offset = 0): Float32Array {
  return Float32Array.from({ length }, (_, index) => offset + (index % 2 ? -amplitude : amplitude));
}

test("声道等权平均，选区去直流且不修改输入", () => {
  const left = alternating(12000, 0.2, 0.25);
  const right = alternating(12000, 0.4, 0.25);
  const source = audio([left, right]);
  const result = analyzeSource(source, "cup", { startSec: 0, endSec: 0.25 });
  assert.ok(Math.abs(result.analysis.features.peak - 0.3) < 1e-6);
  assert.ok(Math.abs(result.analysis.features.rms - 0.3) < 1e-6);
  assert.ok(Math.abs(result.samples.reduce((sum, value) => sum + value, 0)) < 1e-4);
  assert.equal(result.analysis.features.zeroCrossingRate, 1);
  assert.equal(left[0], Math.fround(0.45));
  assert.ok(Math.abs(monoSamples(source)[0] - 0.55) < 1e-6);
});

test("静音和纯直流不除零，六倍增益仍过轻时标记 tooQuiet", () => {
  for (const value of [0, 0.25]) {
    const result = analyzeSource(audio([new Float32Array(12000).fill(value)]), "quiet", { startSec: 0, endSec: 0.25 });
    assert.equal(result.analysis.quality, "nearSilent");
    assert.equal(result.analysis.normalizationGain, 1);
    assert.equal(result.analysis.features.transientScore, 0);
  }
  const quiet = analyzeSource(audio([alternating(12000, 0.01)]), "quiet", { startSec: 0, endSec: 0.25 });
  assert.equal(quiet.analysis.normalizationGain, 6);
  assert.equal(quiet.analysis.quality, "tooQuiet");
  const usable = analyzeSource(audio([alternating(12000, 0.25)]), "cup", { startSec: 0, endSec: 0.25 });
  assert.equal(usable.analysis.normalizationGain, 3);
  assert.equal(usable.analysis.quality, "usable");
});

test("48 kHz 选区按真实采样率量化，重复分析不漂移", () => {
  const source = audio([alternating(48000, 0.2)]);
  let result = analyzeSource(source, "cup", { startSec: 0.1234567, endSec: 0.3734567 });
  const original = result.analysis;
  assert.equal(original.startFrame, Math.floor(0.1234567 * 48000));
  assert.equal(original.endFrame, Math.ceil(0.3734567 * 48000));
  assert.equal(original.features.durationMs, (original.endFrame - original.startFrame) / 48);
  for (let repeat = 0; repeat < 20; repeat++) {
    result = analyzeSource(source, "cup", result.trim);
    assert.deepEqual(result.analysis, original);
  }
});

test("44.1 kHz 的半秒边界和整数采样点回写保持幂等", () => {
  const source = audio([alternating(66150, 0.2)], 44100);
  for (const startFrame of [1, 61, 4411, 30688]) {
    const result = analyzeSource(source, "cup", { startSec: startFrame / 44100, endSec: (startFrame + 22050) / 44100 });
    assert.equal(result.analysis.startFrame, startFrame);
    assert.equal(result.analysis.endFrame, startFrame + 22050);
    assert.equal(result.analysis.features.durationMs, 500);
    assert.deepEqual(analyzeSource(source, "cup", result.trim), result);
  }
});

test("持续幅度首帧不凭空产生瞬态，真实能量上升有瞬态", () => {
  const constant = analyzeSource(audio([alternating(12000, 0.2)]), "tone", { startSec: 0, endSec: 0.25 });
  assert.equal(constant.analysis.features.transientScore, 0);
  const pulse = new Float32Array(12000);
  pulse.set(alternating(480, 0.5), 4800);
  const result = analyzeSource(audio([pulse]), "hit", { startSec: 0, endSec: 0.25 });
  assert.equal(result.analysis.features.transientScore, 1);
});

test("默认选区定位能量上升，提前 20 ms 并保留约 250 ms", () => {
  const samples = new Float32Array(96000);
  samples.set(alternating(480, 0.5), 48000);
  const trim = suggestTrim(audio([samples]));
  assert.ok(Math.abs(trim.startSec - 0.98) < 1 / 48000);
  assert.ok(Math.abs(trim.endSec - trim.startSec - 0.25) < 1 / 48000);
  assert.deepEqual(suggestTrim(audio([new Float32Array(4800)])), { startSec: 0, endSec: 0.1 });
});

test("素材末尾的起音选区平移到合法边界", () => {
  const samples = new Float32Array(96000);
  samples.set(alternating(480, 0.5), 95520);
  const source = audio([samples]);
  const trim = suggestTrim(source);
  assert.deepEqual(trim, { startSec: 1.75, endSec: 2 });
  assert.equal(analyzeSource(source, "end", trim).analysis.features.durationMs, 250);
});

test("非法 PCM、过短素材和越界选区被拒绝", () => {
  const source = audio([alternating(48000, 0.2)]);
  for (const trim of [{ startSec: -1, endSec: 0.2 }, { startSec: 0, endSec: 1.1 },
    { startSec: 0.2, endSec: 0.1 }, { startSec: 0, endSec: 0.01 },
    { startSec: 0, endSec: 0.6 }, { startSec: NaN, endSec: 0.2 }]) {
    assert.throws(() => analyzeSource(source, "cup", trim), /选区/);
  }
  assert.throws(() => suggestTrim(audio([new Float32Array(100)])), /短/);
  assert.throws(() => suggestTrim({ ...source, sampleRate: 0 }), /采样率/);
  const bad = new Float32Array(12000);
  bad[100] = Infinity;
  assert.throws(() => analyzeSource(audio([bad]), "bad", { startSec: 0, endSec: 0.25 }), /PCM/);
});
