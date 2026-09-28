import type { AudioData, SourceAnalysis, Trim } from "./types.ts";

export function monoSamples(source: AudioData): Float32Array {
  if (!source || !Number.isInteger(source.sampleRate) || source.sampleRate <= 0 ||
    !Number.isInteger(source.length) || source.length <= 0 ||
    !Number.isInteger(source.numberOfChannels) || source.numberOfChannels <= 0) {
    throw new Error("音频采样率或声道数据无效");
  }
  const channels = Array.from({ length: source.numberOfChannels }, (_, channel) => source.getChannelData(channel));
  if (channels.some((channel) => !(channel instanceof Float32Array) || channel.length !== source.length)) {
    throw new Error("音频 PCM 声道长度不一致");
  }
  const samples = new Float32Array(source.length);
  for (let index = 0; index < samples.length; index++) {
    let sum = 0;
    for (const channel of channels) {
      if (!Number.isFinite(channel[index])) throw new Error("音频 PCM 包含无效数值");
      sum += channel[index];
    }
    samples[index] = sum / channels.length;
  }
  return samples;
}

function frameLevels(samples: Float32Array, sampleRate: number): number[] {
  const size = Math.max(1, Math.round(sampleRate * 0.01));
  const levels: number[] = [];
  for (let start = 0; start < samples.length; start += size) {
    const end = Math.min(start + size, samples.length);
    let squares = 0;
    for (let index = start; index < end; index++) squares += samples[index] ** 2;
    levels.push(Math.sqrt(squares / (end - start)));
  }
  return levels;
}

function framePosition(seconds: number, rate: number, round: (value: number) => number): number {
  const position = seconds * rate;
  const nearest = Math.round(position);
  // 回写秒数后乘采样率可能偏离整数几个浮点尾数，不能因此多取一个样本。
  return Math.abs(position - nearest) < 1e-7 ? nearest : round(position);
}

export function analyzeSource(source: AudioData, sourceId: string, trim: Trim): {
  analysis: SourceAnalysis; samples: Float32Array; trim: Trim;
} {
  const mono = monoSamples(source);
  const rate = source.sampleRate;
  if (typeof sourceId !== "string" || !sourceId.trim()) throw new Error("素材标识无效");
  if (!trim || !Number.isFinite(trim.startSec) || !Number.isFinite(trim.endSec) ||
    trim.startSec < 0 || trim.endSec > source.length / rate ||
    trim.endSec - trim.startSec < 0.05 - 1e-9 || trim.endSec - trim.startSec > 0.5 + 2 / rate) {
    throw new Error("选区须位于素材内，长度为 50～500 毫秒");
  }
  const startFrame = framePosition(trim.startSec, rate, Math.floor);
  const endFrame = framePosition(trim.endSec, rate, Math.ceil);
  const samples = mono.slice(startFrame, endFrame);
  const mean = samples.reduce((sum, sample) => sum + sample, 0) / samples.length;
  let peak = 0, squares = 0, crossings = 0;
  for (let index = 0; index < samples.length; index++) {
    samples[index] -= mean;
    const value = samples[index];
    if (!Number.isFinite(value)) throw new Error("音频 PCM 超出可处理范围");
    peak = Math.max(peak, Math.abs(value));
    squares += value * value;
    if (index > 0 && (value >= 0) !== (samples[index - 1] >= 0)) crossings++;
  }
  const levels = frameLevels(samples, rate);
  let maximum = 0, rise = 0;
  for (let index = 0; index < levels.length; index++) {
    maximum = Math.max(maximum, levels[index]);
    if (index > 0) rise = Math.max(rise, levels[index] - levels[index - 1]);
  }
  const normalizationGain = peak < 1e-4 ? 1 : Math.min(6, 0.75 / peak);
  const quality = peak < 1e-4 ? "nearSilent" : peak * normalizationGain < 0.1 ? "tooQuiet" : "usable";
  return {
    samples,
    trim: { startSec: startFrame / rate, endSec: endFrame / rate },
    analysis: {
      analysisVersion: 1, sourceId, startFrame, endFrame, sampleRate: rate,
      normalizationGain, quality,
      features: {
        peak, rms: Math.sqrt(squares / samples.length), durationMs: 1000 * samples.length / rate,
        zeroCrossingRate: crossings / Math.max(1, samples.length - 1),
        transientScore: rise / Math.max(maximum, 1e-8),
      },
    },
  };
}

export function suggestTrim(source: AudioData): Trim {
  const samples = monoSamples(source);
  if (samples.length / source.sampleRate < 0.05) throw new Error("素材太短，请提供至少 50 毫秒的声音");
  const levels = frameLevels(samples, source.sampleRate);
  let peakIndex = 0, riseIndex = 0, rise = 0;
  for (let index = 1; index < levels.length; index++) {
    if (levels[index] > levels[peakIndex]) peakIndex = index;
    const difference = levels[index] - levels[index - 1];
    if (difference > rise) { rise = difference; riseIndex = index; }
  }
  const selected = rise / Math.max(levels[peakIndex], 1e-8) >= 0.2 ? riseIndex : peakIndex;
  const rate = source.sampleRate;
  const length = Math.min(samples.length, Math.round(rate * 0.25));
  const candidateStart = selected * Math.max(1, Math.round(rate * 0.01)) - Math.round(rate * 0.02);
  const startFrame = Math.max(0, Math.min(samples.length - length, candidateStart));
  return { startSec: startFrame / rate, endSec: (startFrame + length) / rate };
}
