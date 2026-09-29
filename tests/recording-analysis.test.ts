import assert from "node:assert/strict";
import test from "node:test";
import { analyzeRecording, roleLabels, rolePatterns } from "../lib/recording-analysis.ts";
import type { AnalysisInput, SoundRole } from "../lib/song-types.ts";

function recording(times: number[], sampleRate = 48000, duration = 8, amplitudes: number[] = [], decay = 0.045): AnalysisInput {
  const samples = new Float32Array(Math.round(sampleRate * duration));
  times.forEach((time, hit) => {
    const start = Math.round(time * sampleRate);
    for (let frame = 0; frame < Math.min(sampleRate * 0.65, samples.length - start); frame++) {
      const seconds = frame / sampleRate;
      samples[start + frame] += (amplitudes[hit] ?? 0.65) * Math.exp(-seconds / decay) * Math.sin(2 * Math.PI * 731 * seconds);
    }
  });
  return { sampleRate, length: samples.length, numberOfChannels: 1, getChannelData: () => samples };
}

function targets(role: SoundRole, bpm: number, guideStartSec: number): number[] {
  const positions = { pulse: [0, 4, 8, 12], accent: [4, 12], texture: [0, 2, 4, 6, 8, 10, 12, 14] }[role];
  return [0, 1].flatMap((bar) => positions.map((step) => guideStartSec + (bar * 4 + step / 4) * 60 / bpm));
}

test("三种角色公开十六格目标节奏与可读标签", () => {
  for (const role of ["pulse", "accent", "texture"] as const) {
    assert.equal(rolePatterns[role].length, 16);
    assert.ok(rolePatterns[role].every((step) => step === 0 || step === 1));
    assert.ok(roleLabels[role].length > 0);
  }
  assert.deepEqual(rolePatterns.accent.flatMap((step, index) => step ? [index] : []), [4, 12]);
});

test("带倒数时间与小偏差的两小节敲击对齐并保留力度变化", () => {
  const guide = 2.4;
  const times = targets("pulse", 100, guide).map((time, index) => time + 0.03 + (index % 2 ? 0.008 : -0.008));
  const source = recording(times, 48000, 7.3, [0.8, 0.3, 0.6, 0.4, 0.7, 0.35, 0.65, 0.45]);
  const before = source.getChannelData(0).slice();
  const result = analyzeRecording(source, 100, "pulse", guide);
  assert.equal(result.mode, "aligned");
  assert.equal(result.hits.length, 8);
  assert.ok(result.offsetMs !== null && result.offsetMs >= 20 && result.offsetMs <= 40);
  assert.deepEqual(result.steps.flatMap((step, index) => step > 0 ? [index] : []), [0, 4, 8, 12]);
  assert.ok(result.steps[0] > result.steps[4]);
  assert.match(result.summary, /对齐/);
  assert.deepEqual(source.getChannelData(0), before);
});

test("44.1和48kHz的重音与密集细节均可可靠切出，两次采样不重叠", () => {
  for (const sampleRate of [44100, 48000]) for (const role of ["accent", "texture"] as const) {
    const guide = 240 / 128;
    const times = targets(role, 128, guide).map((time) => time + 0.018);
    const result = analyzeRecording(recording(times, sampleRate, 5.8), 128, role, guide);
    assert.equal(result.mode, "aligned", `${sampleRate}/${role}`);
    assert.equal(result.hits.length, times.length);
    result.hits.forEach((hit, index) => {
      assert.ok(hit.startSec >= 0 && hit.endSec > hit.startSec);
      assert.ok(hit.endSec - hit.startSec <= 0.5 + 1 / sampleRate);
      assert.ok(hit.peak > 0.1 && hit.peak <= 1);
      if (index) assert.ok(result.hits[index - 1].endSec <= hit.startSec);
    });
  }
});

test("慢速细节的下一次敲击不能被误当成前一次的持续尾音", () => {
  const guide = 240 / 72;
  const result = analyzeRecording(recording(targets("texture", 72, guide), 48000, 10.2, [], 0.09), 72, "texture", guide);
  assert.equal(result.hits.length, 16);
  assert.equal(result.mode, "aligned");
});

test("漏拍或明显不稳定的偏拍只承诺重新编排", () => {
  const intended = targets("pulse", 100, 2.4);
  for (const times of [intended.filter((_, index) => index !== 3), intended.map((time, index) => time + (index % 2 ? 0.2 : -0.15))]) {
    const result = analyzeRecording(recording(times), 100, "pulse", 2.4);
    assert.equal(result.mode, "rebuilt");
    assert.equal(result.offsetMs, null);
    assert.deepEqual(result.steps, rolePatterns.pulse);
    assert.match(result.summary, /重新编排/);
  }
});

test("无引导时点的上传录音使用清楚单音重新编排，不假称节奏校正", () => {
  const result = analyzeRecording(recording([0.2, 0.95, 1.7], 44100, 2.5), 100, "accent");
  assert.equal(result.mode, "rebuilt");
  assert.equal(result.offsetMs, null);
  assert.equal(result.hits.length, 3);
  assert.deepEqual(result.steps, rolePatterns.accent);
});

test("衰减尾音不被重复判为多次敲击，倒数中的声音不进入正式素材", () => {
  const result = analyzeRecording(recording([0.5, 2.5], 48000, 4, [], 0.16), 100, "pulse", 2.4);
  assert.equal(result.hits.length, 1);
  assert.ok(Math.abs(result.hits[0].startSec - 2.5) < 0.02);
  assert.equal(result.mode, "rebuilt");
});

test("明显的80ms双击不能伪称可靠对齐，轮替切片不暗含第二击", () => {
  const intended = targets("pulse", 100, 2.4);
  const doubled = intended.flatMap(time => [time, time + .08]);
  const result = analyzeRecording(recording(doubled), 100, "pulse", 2.4);
  assert.equal(result.mode, "rebuilt");
  assert.equal(result.hits.length, 16);
  assert.ok(result.hits[0].endSec <= doubled[1] + .002);
  result.hits.forEach((hit, index) => {
    if (index) assert.ok(result.hits[index - 1].endSec <= hit.startSec);
  });
});

test("不足450ms的尾窗也检查衰减，持续正弦不能被宣称为清晰击打", () => {
  for (const duration of [.2, .4]) {
    const source = recording([], 48000, duration);
    const pcm = source.getChannelData(0);
    for (let i = 4800; i < pcm.length; i++) pcm[i] = .2 * Math.sin(2 * Math.PI * 200 * (i - 4800) / 48000);
    assert.throws(() => analyzeRecording(source, 100, "pulse"), /声音|尾部|重录/);
  }
});

test("近静音与纯直流不伪造可用采样", () => {
  for (const value of [0, 0.3]) {
    const source = recording([], 44100, 2);
    source.getChannelData(0).fill(value);
    assert.throws(() => analyzeRecording(source, 100, "pulse"), /声音|重录/);
  }
  assert.throws(() => analyzeRecording(recording([0.4], 48000, 2, [0.0001]), 100, "pulse"), /声音|重录/);
});

test("有限六倍增益后仍太轻的清晰击打提示重录，可用响度才成功", () => {
  for (const amplitude of [0.005, 0.015, 0.019]) {
    assert.throws(() => analyzeRecording(recording([0.4], 48000, 2, [amplitude]), 100, "pulse"), /太轻.*靠近.*重录/);
  }
  const usable = analyzeRecording(recording([0.4], 48000, 2, [0.022]), 100, "pulse");
  assert.equal(usable.hits.length, 1);
  assert.equal(usable.mode, "rebuilt");
});

test("末尾不足10ms的片段不当作可用敲击，其余清楚声音仍可重排", () => {
  assert.throws(() => analyzeRecording(recording([1.999], 48000, 2), 100, "pulse"), /声音|重录/);
  const result = analyzeRecording(recording([0.3, 1.999], 48000, 2), 100, "pulse");
  assert.equal(result.hits.length, 1);
  assert.ok(result.hits[0].endSec - result.hits[0].startSec >= 0.01);
});

test("拒绝超长录音、无效速度、角色、引导位置及非有限PCM", () => {
  const source = recording([0.5], 48000, 2);
  assert.throws(() => analyzeRecording(recording([0.5], 48000, 12.1), 100, "pulse"), /12/);
  for (const bpm of [0, NaN, 71, 129]) assert.throws(() => analyzeRecording(source, bpm, "pulse"), /速度/);
  assert.throws(() => analyzeRecording(source, 100, "other" as SoundRole), /角色/);
  for (const guide of [-1, NaN, 3]) assert.throws(() => analyzeRecording(source, 100, "pulse", guide), /引导/);
  source.getChannelData(0)[1] = Infinity;
  assert.throws(() => analyzeRecording(source, 100, "pulse"), /PCM/);
});
