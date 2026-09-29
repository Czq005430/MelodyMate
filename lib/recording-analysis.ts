import { monoSamples } from "./source-analysis.ts";
import type { AnalysisInput, RecordedHit, RecordingAnalysis, SoundRole } from "./song-types.ts";

export const roleLabels: Record<SoundRole, string> = { pulse: "骨架", accent: "重音", texture: "细节" };
export const rolePatterns: Record<SoundRole, number[]> = {
  pulse: Array.from({ length: 16 }, (_, step) => [0, 4, 8, 12].includes(step) ? 1 : 0),
  accent: Array.from({ length: 16 }, (_, step) => [4, 12].includes(step) ? 1 : 0),
  texture: Array.from({ length: 16 }, (_, step) => step % 2 === 0 ? 1 : 0),
};

export function analyzeRecording(source: AnalysisInput, bpm: number, role: SoundRole, guideStartSec?: number): RecordingAnalysis {
  if (!Number.isFinite(bpm) || bpm < 72 || bpm > 128) throw new Error("速度须在 72～128 BPM 之间");
  if (!Object.hasOwn(rolePatterns, role)) throw new Error("请选择有效的声音角色");
  const duration = source?.length / source?.sampleRate;
  if (!Number.isFinite(duration) || duration < 0.05 || duration > 12 + 1 / source.sampleRate) {
    throw new Error("请录制 0.05～12 秒的短声音");
  }
  if (guideStartSec !== undefined && (!Number.isFinite(guideStartSec) || guideStartSec < 0 || guideStartSec >= duration)) {
    throw new Error("录音未到引导开始位置，请完成倒数后再录制");
  }
  const samples = monoSamples(source);
  const mean = samples.reduce((sum, value) => sum + value, 0) / samples.length;
  for (let index = 0; index < samples.length; index++) samples[index] -= mean;
  const rate = source.sampleRate;
  const frameSize = Math.max(1, Math.round(rate * 0.005));
  const levels: number[] = [];
  for (let start = 0; start < samples.length; start += frameSize) {
    const end = Math.min(start + frameSize, samples.length);
    let squares = 0;
    for (let index = start; index < end; index++) squares += samples[index] ** 2;
    levels.push(Math.sqrt(squares / (end - start)));
  }
  const earliest = Math.max(0, (guideStartSec ?? 0) - 0.12);
  const latest = Math.min(duration, (guideStartSec ?? duration) + 480 / bpm);
  const firstFrame = Math.floor(earliest * rate / frameSize);
  const lastFrame = Math.min(levels.length, Math.ceil(latest * rate / frameSize));
  let maximum = 0;
  for (let index = firstFrame; index < lastFrame; index++) maximum = Math.max(maximum, levels[index]);
  if (maximum < 0.003) throw new Error("没有找到清楚的声音，请靠近一点重录");
  const threshold = Math.max(0.003, maximum * 0.12);
  const onsets: number[] = [];
  let lastOnset = -1;
  for (let frame = firstFrame; frame < lastFrame; frame++) {
    const time = frame * frameSize / rate;
    const previous = ((levels[frame - 1] ?? 0) + (levels[frame - 2] ?? 0) + (levels[frame - 3] ?? 0)) / 3;
    if (time - lastOnset < 0.04 || levels[frame] < threshold || levels[frame] < previous * 1.7 ||
      levels[frame] - previous < Math.max(0.002, maximum * 0.08)) continue;
    // 稳定持续音不作为短敲击；衰减尾音靠上升阈值和不应期避免重复计数。
    const later = Math.min(lastFrame - 1, frame + Math.round(0.45 * rate / frameSize));
    if (later < frame + 4) continue;
    let valley = Infinity;
    for (let index = frame + 4; index <= later; index++) valley = Math.min(valley, levels[index]);
    if (valley > levels[frame] * 0.65) continue;
    const start = frame * frameSize;
    const end = Math.min(start + frameSize, samples.length);
    let peak = 0;
    for (let index = start; index < end; index++) peak = Math.max(peak, Math.abs(samples[index]));
    let onset = start;
    while (onset < end - 1 && Math.abs(samples[onset]) < Math.max(0.002, peak * 0.2)) onset++;
    lastOnset = onset / rate;
    onsets.push(lastOnset);
  }
  if (!onsets.length) throw new Error("没有找到分开的短声音，请跟随提示一下一下地录制，保留声音尾部后重录");
  const detected = onsets.map((time, index) => {
    const startFrame = Math.max(0, Math.floor((time - 0.003) * rate));
    const nextFrame = index + 1 < onsets.length ? Math.max(startFrame + 1, Math.floor((onsets[index + 1] - 0.003) * rate)) : samples.length;
    const endFrame = Math.min(samples.length, startFrame + Math.floor(0.5 * rate), nextFrame);
    let peak = 0;
    for (let frame = startFrame; frame < endFrame; frame++) peak = Math.max(peak, Math.abs(samples[frame]));
    return { time, hit: { startSec: startFrame / rate, endSec: endFrame / rate, peak } };
  }).filter(({ hit }) => hit.endSec - hit.startSec >= 0.01);
  if (!detected.length) throw new Error("声音片段太短，请留出声音的尾部后重录");
  const allHits: RecordedHit[] = detected.map(({ hit }) => hit);
  if (Math.max(...allHits.map(hit => hit.peak)) * 6 < 0.12) throw new Error("录到的声音太轻，请靠近麦克风后重录");
  // 最多保留十六个清晰单音供轮替，仍按录制顺序排列。
  const hits = allHits.length <= 16 ? allHits : allHits.slice().sort((a, b) => b.peak - a.peak).slice(0, 16).sort((a, b) => a.startSec - b.startSec);
  const activeSteps = rolePatterns[role].flatMap((value, step) => value ? [step] : []);
  const expected = [0, 1].flatMap((bar) => activeSteps.map((step) => (guideStartSec ?? 0) + (bar * 4 + step / 4) * 60 / bpm));
  const differences = expected.map((time, index) => (detected[index]?.time ?? Infinity) - time);
  const average = differences.reduce((sum, value) => sum + value, 0) / differences.length;
  const reliable = guideStartSec !== undefined && detected.length === expected.length &&
    Math.abs(average) <= 0.075 && differences.every((difference) => Math.abs(difference) <= 0.1 && Math.abs(difference - average) <= 0.05);
  if (reliable) {
    const peak = Math.max(...allHits.map((hit) => hit.peak));
    const steps = Array<number>(16).fill(0);
    activeSteps.forEach((step, index) => {
      const velocity = (allHits[index].peak + allHits[index + activeSteps.length].peak) / (2 * peak);
      steps[step] = Math.round(Math.max(0.35, Math.min(1, velocity)) * 100) / 100;
    });
    const offsetMs = Math.round(average * 1000);
    return { hits, steps, mode: "aligned", offsetMs,
      summary: `识别到 ${hits.length} 次敲击，已对齐到目标节奏并保留力度变化；录制时平均${offsetMs >= 0 ? "晚" : "早"}约 ${Math.abs(offsetMs)} 毫秒。` };
  }
  return { hits, steps: [...rolePatterns[role]], mode: "rebuilt", offsetMs: null,
    summary: `选出 ${hits.length} 个单次声音，按“${roleLabels[role]}”目标节奏重新编排。保留你的音色，不代表保留了原来的演奏节奏；不修复音高或背景噪声。` };
}
