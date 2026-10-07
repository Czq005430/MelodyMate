import { prepareHits } from "./song-render.ts";
import { validateSongPlan } from "./song-plan.ts";
import type { SongPlan, SongSource } from "./song-types.ts";

export type BackingMixOptions = { bpm: number; offsetSec: number; sourceGain: number; backingGain: number; mode: "mix" | "source" | "backing"; signal?: AbortSignal };
const RATE = 44100;
const pause = () => new Promise<void>(resolve => setTimeout(resolve, 0));
const aborted = () => new DOMException("混合已取消", "AbortError");
function check(signal?: AbortSignal) { if (signal?.aborted) throw aborted(); }
function metadata(buffer: AudioBuffer): number {
  if (!buffer || !Number.isInteger(buffer.sampleRate) || buffer.sampleRate <= 0 || !Number.isInteger(buffer.length) || buffer.length <= 0) throw new Error("伴奏音频元数据无效");
  if (![1, 2].includes(buffer.numberOfChannels)) throw new Error("伴奏最多支持双声道");
  const duration = buffer.length / buffer.sampleRate;
  if (duration < 10 || duration > 360) throw new Error("伴奏时长须在10～360秒之间");
  return duration;
}
async function peakOf(buffer: AudioBuffer, signal?: AbortSignal): Promise<number> {
  let peak = 0;
  for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
    const pcm = buffer.getChannelData(channel);
    if (!(pcm instanceof Float32Array) || pcm.length !== buffer.length) throw new Error("伴奏声道长度无效");
    for (let i = 0; i < pcm.length; i++) {
      if (!Number.isFinite(pcm[i])) throw new Error("伴奏 PCM 包含无效数值");
      peak = Math.max(peak, Math.abs(pcm[i]));
      if (i > 0 && i % 262144 === 0) { await pause(); check(signal); }
    }
  }
  check(signal); return peak;
}
async function protectStereo(buffer: AudioBuffer, signal?: AbortSignal) {
  const peak = await peakOf(buffer, signal);
  if (peak <= .95) return;
  const gain = .95 / peak;
  for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
    const pcm = buffer.getChannelData(channel);
    for (let i = 0; i < pcm.length; i++) {
      pcm[i] *= gain;
      if (i > 0 && i % 262144 === 0) { await pause(); check(signal); }
    }
  }
  check(signal);
}

export async function decodeBackingAudio(bytes: ArrayBuffer): Promise<AudioBuffer> {
  if (!(bytes instanceof ArrayBuffer) || !bytes.byteLength || bytes.byteLength > 50 * 1024 * 1024) throw new Error("请选择50 MiB以内的伴奏音频文件");
  let buffer: AudioBuffer;
  try { buffer = await new OfflineAudioContext(2, 1, RATE).decodeAudioData(bytes.slice(0)); }
  catch { throw new Error("无法解码伴奏音频，请更换支持的音频格式"); }
  metadata(buffer); await peakOf(buffer); return buffer;
}

export async function renderBackingMix(backing: AudioBuffer, sources: SongSource[], plan: SongPlan, options: BackingMixOptions): Promise<AudioBuffer> {
  const { signal, bpm, offsetSec, sourceGain, backingGain, mode } = options; check(signal);
  const duration = metadata(backing);
  if (!Number.isFinite(bpm) || bpm < 60 || bpm > 180) throw new Error("伴奏速度须在60～180 BPM之间");
  if (!Number.isFinite(offsetSec) || offsetSec < 0 || offsetSec > 30 || offsetSec >= duration) throw new Error("起拍位置须在伴奏时长内且不超过30秒");
  if (!Number.isFinite(sourceGain) || sourceGain < .2 || sourceGain > 1.5 || !Number.isFinite(backingGain) || backingGain < 0 || backingGain > 1) throw new Error("原声或伴奏音量超出范围");
  if (!["mix", "source", "backing"].includes(mode)) throw new Error("伴奏试听模式无效");
  if (mode !== "backing" && !sources.length) throw new Error("请先准备至少一种生活原声");
  const valid = validateSongPlan(plan);
  await peakOf(backing, signal); check(signal);
  const context = new OfflineAudioContext(2, Math.ceil(duration * RATE), RATE);
  const nodes: AudioBufferSourceNode[] = [];
  const cancel = () => { for (const node of nodes) { try { node.stop(); } catch { /* 可能已结束。 */ } node.disconnect(); } };
  signal?.addEventListener("abort", cancel, { once: true });
  try {
    if (mode !== "source") {
      const node = context.createBufferSource(), gain = context.createGain();
      node.buffer = backing; gain.gain.value = backingGain;
      node.connect(gain); gain.connect(context.destination); node.start(0); nodes.push(node);
    }
    if (mode !== "backing") {
      const bus = context.createGain();
      bus.gain.setValueAtTime(sourceGain, 0);
      bus.gain.setValueAtTime(sourceGain, Math.max(offsetSec, duration - 1));
      bus.gain.linearRampToValueAtTime(0, duration); bus.connect(context.destination);
      const clips = new Map(sources.map(source => [source.id, prepareHits(source).map(hit => {
        const buffer = context.createBuffer(1, hit.data.length, hit.sampleRate); buffer.getChannelData(0).set(hit.data);
        return { buffer, gain: hit.gain };
      })]));
      const used = new Map<string, number>();
      const stepSeconds = 15 / bpm, totalBars = Math.ceil((duration - offsetSec) / (stepSeconds * 16));
      const planBars = valid.sections.reduce((sum, section) => sum + section.bars, 0);
      let cumulative = 0;
      const ends = valid.sections.map(section => { cumulative += section.bars; return Math.round(cumulative / planBars * totalBars); });
      for (let step = 0; offsetSec + step * stepSeconds < duration; step++) {
        check(signal);
        const bar = Math.floor(step / 16), sectionIndex = ends.findIndex(end => bar < end);
        const section = valid.sections[Math.max(0, sectionIndex)];
        const at = offsetSec + step * stepSeconds;
        for (const role of section.sourceRoles) {
          const velocity = valid.patterns[role][step % 16] * section.energy;
          if (velocity <= 0) continue;
          const source = sources.find(source => source.role === role) ?? sources[0];
          const available = clips.get(source.id)!, index = used.get(source.id) ?? 0;
          const clip = available[index % available.length]; used.set(source.id, index + 1);
          const length = Math.min(clip.buffer.duration, duration - at), fade = Math.min(.003, length / 2);
          const node = context.createBufferSource(), gain = context.createGain(); node.buffer = clip.buffer;
          gain.gain.setValueAtTime(0, at); gain.gain.linearRampToValueAtTime(velocity * clip.gain, at + fade);
          gain.gain.setValueAtTime(velocity * clip.gain, at + length - fade); gain.gain.linearRampToValueAtTime(0, at + length);
          node.connect(gain); gain.connect(bus); node.start(at, 0, length); node.stop(at + length); nodes.push(node);
        }
        if (step > 0 && step % 128 === 0) { await pause(); check(signal); }
      }
    }
    check(signal);
    const rendering = context.startRendering();
    const buffer = await new Promise<AudioBuffer>((resolve, reject) => {
      const interrupt = () => reject(aborted());
      signal?.addEventListener("abort", interrupt, { once: true });
      rendering.then(resolve, reject).finally(() => signal?.removeEventListener("abort", interrupt));
      if (signal?.aborted) interrupt();
    });
    await protectStereo(buffer, signal); return buffer;
  } finally { signal?.removeEventListener("abort", cancel); }
}
