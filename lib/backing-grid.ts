export type BackingGrid = { bpm: number; offsetSec: number; confidence: number };
type GridAudio = Pick<AudioBuffer, "sampleRate" | "numberOfChannels" | "length" | "getChannelData">;

// 只建议稳定速度的起拍网格；不识别小节重拍、调性或变速。confidence 不是正确概率。
export function estimateBackingGrid(buffer: GridAudio, preferredBpm: number): BackingGrid | null {
  if (!Number.isFinite(preferredBpm) || preferredBpm < 60 || preferredBpm > 180) throw new Error("建议速度须在60～180 BPM之间");
  if (!buffer || !Number.isInteger(buffer.sampleRate) || buffer.sampleRate <= 0 || !Number.isInteger(buffer.length) || buffer.length <= 0 || ![1, 2].includes(buffer.numberOfChannels)) throw new Error("伴奏采样率、长度或声道无效");
  const channels = Array.from({ length: buffer.numberOfChannels }, (_, channel) => buffer.getChannelData(channel));
  if (channels.some(channel => !(channel instanceof Float32Array) || channel.length !== buffer.length)) throw new Error("伴奏声道长度无效");
  // 同步建议限定前60秒、每声道约4k个采样/秒；完整PCM验证由异步解码/混合完成。
  const rate = buffer.sampleRate, hop = Math.max(1, Math.round(rate * .01));
  const stride = Math.max(1, Math.floor(rate / 4000)), length = Math.min(buffer.length, rate * 60);
  const levels: number[] = [], onset: number[] = [];
  let maximum = 0;
  for (let start = 0; start < length; start += hop) {
    let sum = 0, count = 0;
    for (let i = start; i < Math.min(start + hop, length); i += stride) for (const channel of channels) {
      if (!Number.isFinite(channel[i])) throw new Error("伴奏 PCM 包含无效数值");
      sum += channel[i] ** 2; count++;
    }
    const level = Math.sqrt(sum / count), index = levels.length;
    const previous = ((levels[index - 1] ?? 0) + (levels[index - 2] ?? 0) + (levels[index - 3] ?? 0)) / 3;
    levels.push(level); onset.push(Math.max(0, level - previous)); maximum = Math.max(maximum, onset[index]);
  }
  if (maximum < .003) return null;
  const peaks: number[] = [];
  for (let i = 0; i < onset.length; i++) if (onset[i] >= Math.max(.003, maximum * .2) && onset[i] >= (onset[i - 1] ?? 0) && onset[i] > (onset[i + 1] ?? 0)) {
    if (!peaks.length || (i - peaks.at(-1)!) * hop / rate >= .12) peaks.push(i);
  }
  if (peaks.length < 4 || peaks[0] * hop / rate > 30) return null;
  let bestLag = 0, bestScore = 0, bestCorrelation = 0;
  for (let lag = Math.floor(rate / hop / 3); lag <= Math.ceil(rate / hop); lag++) {
    let cross = 0, first = 0, second = 0;
    for (let i = lag; i < onset.length; i++) { cross += onset[i] * onset[i - lag]; first += onset[i] ** 2; second += onset[i - lag] ** 2; }
    const correlation = cross / Math.max(1e-12, Math.sqrt(first * second));
    const bpm = 60 * rate / (lag * hop);
    const score = correlation * (1 - .2 * Math.abs(Math.log2(bpm / preferredBpm)));
    if (score > bestScore) { bestScore = score; bestLag = lag; bestCorrelation = correlation; }
  }
  if (bestCorrelation < .2) return null;
  let seconds = 0, beats = 0;
  const period = bestLag * hop / rate;
  for (let i = 1; i < peaks.length; i++) {
    const gap = (peaks[i] - peaks[i - 1]) * hop / rate, count = Math.round(gap / period);
    if (count > 0 && count <= 8 && Math.abs(gap / count - period) < period * .12) { seconds += gap; beats += count; }
  }
  if (beats < 3) return null;
  const refined = seconds / beats, bpm = 60 / refined;
  if (bpm < 59.5 || bpm > 180.5) return null;
  let x = 0, y = 0;
  for (const peak of peaks) { const angle = peak * hop / rate / refined * 2 * Math.PI; x += Math.cos(angle); y += Math.sin(angle); }
  const alignment = Math.hypot(x, y) / peaks.length;
  if (alignment < .35) return null;
  const phase = Math.atan2(y, x) / (2 * Math.PI);
  const firstBeat = peaks.find(peak => {
    const difference = peak * hop / rate / refined - phase;
    return Math.abs(difference - Math.round(difference)) <= .12;
  });
  if (firstBeat === undefined || firstBeat * hop / rate > 30) return null;
  return { bpm: Math.round(Math.max(60, Math.min(180, bpm)) * 100) / 100, offsetSec: firstBeat * hop / rate, confidence: Math.min(1, Math.round((bestCorrelation + alignment) * 50) / 100) };
}
