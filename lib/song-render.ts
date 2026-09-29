import { monoSamples } from "./source-analysis.ts";
import { expandSong, sectionTimings, songDuration, validateSongPlan } from "./song-plan.ts";
import type { SongPlan, SongRenderOptions, SongSource } from "./song-types.ts";

const RATE = 44100;
const pianoCache = new Map<number, Promise<AudioBuffer>>();
const pause = () => new Promise<void>(resolve => setTimeout(resolve, 0));
const abortError = () => new DOMException("渲染已取消", "AbortError");
function checkAbort(signal?: AbortSignal) { if (signal?.aborted) throw abortError(); }

function abortable<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(abortError());
  return new Promise((resolve, reject) => {
    const abort = () => reject(abortError());
    signal.addEventListener("abort", abort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}

export function pianoSampleFor(midi: number): { rootMidi: number; url: string; rate: number } {
  if (!Number.isInteger(midi) || midi < 0 || midi > 127) throw new Error("钢琴音高无效");
  const rootMidi = [48, 60, 72].sort((a, b) => Math.abs(a - midi) - Math.abs(b - midi))[0];
  return { rootMidi, url: `/audio/piano/C${rootMidi / 12 - 1}.mp3`, rate: 2 ** ((midi - rootMidi) / 12) };
}

function loadPiano(midi: number): Promise<AudioBuffer> {
  const sample = pianoSampleFor(midi);
  const cached = pianoCache.get(sample.rootMidi);
  if (cached) return cached;
  const pending = (async () => {
    const timeout = new AbortController(); const timer = setTimeout(() => timeout.abort(), 15000);
    try {
      const response = await fetch(sample.url, { signal: timeout.signal });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const bytes = await response.arrayBuffer();
      if (!bytes.byteLength || bytes.byteLength > 1024 * 1024) throw new Error("采样文件大小不正确");
      const decoder = new OfflineAudioContext(1, 1, RATE);
      const decoded = await decoder.decodeAudioData(bytes);
      const pcm = monoSamples(decoded);
      const buffer = decoder.createBuffer(1, pcm.length, decoded.sampleRate);
      buffer.getChannelData(0).set(pcm);
      return buffer;
    } catch {
      throw new Error("钢琴采样加载失败，请重试并确认本地采样文件可访问；不会替换为合成钢琴");
    } finally { clearTimeout(timer); }
  })();
  pianoCache.set(sample.rootMidi, pending);
  void pending.catch(() => { if (pianoCache.get(sample.rootMidi) === pending) pianoCache.delete(sample.rootMidi); });
  return pending;
}

export function prepareHits(source: SongSource): Array<{ data: Float32Array; sampleRate: number; gain: number }> {
  const pcm = monoSamples(source.buffer), rate = source.buffer.sampleRate;
  const prepared = source.analysis.hits.flatMap(hit => {
    const duration = hit.endSec - hit.startSec;
    if (!Number.isFinite(duration) || hit.startSec < 0 || hit.endSec > pcm.length / rate + 1e-9 || duration < .01 - 1e-9 || duration > .5 + 1e-9) return [];
    const data = pcm.slice(Math.round(hit.startSec * rate), Math.round(hit.endSec * rate));
    const mean = data.reduce((sum, value) => sum + value, 0) / data.length;
    let peak = 0;
    for (let i = 0; i < data.length; i++) { data[i] -= mean; peak = Math.max(peak, Math.abs(data[i])); }
    if (!Number.isFinite(peak)) throw new Error("原声 PCM 包含非有限数值");
    return peak < 1e-4 ? [] : [{ data, sampleRate: rate, gain: Math.min(6, .7 / peak) }];
  });
  if (!prepared.length) throw new Error(`${source.label}没有可用的有效击打，请重新录制`);
  return prepared;
}

export async function protectPcm(pcm: Float32Array, sampleRate: number, signal?: AbortSignal): Promise<void> {
  checkAbort(signal);
  if (!pcm.length || !Number.isFinite(sampleRate) || sampleRate <= 0) throw new Error("混音 PCM 或采样率无效");
  const fade = Math.min(pcm.length, Math.max(2, Math.round(sampleRate * .015)));
  let peak = 0;
  for (let i = 0; i < pcm.length; i++) {
    if (!Number.isFinite(pcm[i])) throw new Error("混音 PCM 包含非有限数值");
    if (i >= pcm.length - fade) pcm[i] *= (pcm.length - 1 - i) / Math.max(1, fade - 1);
    peak = Math.max(peak, Math.abs(pcm[i]));
    if (i > 0 && i % 262144 === 0) { await pause(); checkAbort(signal); }
  }
  if (peak > .95) for (let i = 0; i < pcm.length; i++) {
    pcm[i] *= .95 / peak;
    if (i > 0 && i % 262144 === 0) { await pause(); checkAbort(signal); }
  }
  checkAbort(signal);
}

function envelope(context: OfflineAudioContext, at: number, duration: number, level: number, attack: number, release: number): GainNode {
  const gain = context.createGain();
  gain.gain.setValueAtTime(0, at);
  gain.gain.linearRampToValueAtTime(level, at + Math.min(attack, duration / 2));
  gain.gain.setValueAtTime(level, at + duration - Math.min(release, duration / 2));
  gain.gain.linearRampToValueAtTime(0, at + duration);
  gain.connect(context.destination);
  return gain;
}

type Clip = { buffer: AudioBuffer; gain: number };
function clipsFor(context: OfflineAudioContext, source: SongSource): Clip[] {
  return prepareHits(source).map(hit => {
    const buffer = context.createBuffer(1, hit.data.length, hit.sampleRate);
    buffer.getChannelData(0).set(hit.data);
    return { buffer, gain: hit.gain };
  });
}
function sampleNode(context: OfflineAudioContext, buffer: AudioBuffer, at: number, duration: number, level: number, rate = 1, piano = false): AudioBufferSourceNode {
  const node = context.createBufferSource(); node.buffer = buffer; node.playbackRate.value = rate;
  duration = Math.min(duration, buffer.duration / rate);
  node.connect(envelope(context, at, duration, level, piano ? .005 : .003, piano ? .1 : .003));
  node.start(at, 0, duration * rate);
  node.stop(at + duration);
  return node;
}
function synthNode(context: OfflineAudioContext, midi: number, at: number, duration: number, level: number, pad: boolean): OscillatorNode {
  const node = context.createOscillator(); node.type = pad ? "triangle" : "sine";
  node.frequency.value = 440 * 2 ** ((midi - 69) / 12);
  node.connect(envelope(context, at, duration, level, pad ? .2 : .012, pad ? .3 : .06));
  node.start(at); node.stop(at + duration);
  return node;
}
async function finish(context: OfflineAudioContext, signal?: AbortSignal): Promise<AudioBuffer> {
  checkAbort(signal);
  const buffer = await abortable(context.startRendering(), signal);
  await protectPcm(buffer.getChannelData(0), RATE, signal);
  return buffer;
}

export async function renderSong(sources: SongSource[], plan: SongPlan, options: SongRenderOptions = {}): Promise<AudioBuffer> {
  const { signal } = options; checkAbort(signal);
  const valid = validateSongPlan(plan), events = expandSong(valid);
  if (!sources.length) throw new Error("请先提供至少一份生活声音");
  const section = options.sectionId ? sectionTimings(valid).find(item => item.id === options.sectionId) : undefined;
  if (options.sectionId && !section) throw new Error("找不到要试听的段落");
  const start = section?.startSec ?? 0, duration = section?.durationSec ?? songDuration(valid), end = start + duration;
  const samples = events.samples.filter(event => event.time >= start && event.time < end);
  const notes = options.sourceOnly ? [] : events.notes.filter(event => event.time >= start && event.time < end && valid.mix[event.instrument] > 0);
  const piano = new Map<number, AudioBuffer>();
  await abortable(Promise.all([...new Set(notes.filter(note => note.instrument === "piano").map(note => pianoSampleFor(note.midi).rootMidi))]
    .map(async midi => { piano.set(midi, await loadPiano(midi)); })), signal);
  checkAbort(signal);
  const context = new OfflineAudioContext(1, Math.ceil(duration * RATE), RATE);
  const clips = new Map(sources.map(source => [source.id, clipsFor(context, source)]));
  const positions = new Map<string, number>(), nodes: AudioScheduledSourceNode[] = [];
  const sourceFor = (role: SongSource["role"]) => sources.find(source => source.role === role) ?? sources[0];
  for (const event of events.samples) if (event.time < start) {
    const id = sourceFor(event.role).id; positions.set(id, (positions.get(id) ?? 0) + 1);
  }
  const abort = () => nodes.forEach(node => { try { node.stop(); node.disconnect(); } catch { /* 原生节点可能已结束。 */ } });
  signal?.addEventListener("abort", abort, { once: true });
  try {
    let count = 0;
    for (const event of samples) {
      const source = sourceFor(event.role);
      const available = clips.get(source.id)!, index = positions.get(source.id) ?? 0;
      const clip = available[index % available.length]; positions.set(source.id, index + 1);
      nodes.push(sampleNode(context, clip.buffer, event.time - start, Math.min(clip.buffer.duration, end - event.time), event.velocity * valid.mix.source * clip.gain));
      if (++count % 128 === 0) { await pause(); checkAbort(signal); }
    }
    for (const note of notes) {
      const at = note.time - start, length = Math.min(note.duration, end - note.time), level = note.velocity * valid.mix[note.instrument];
      if (note.instrument === "piano") {
        const choice = pianoSampleFor(note.midi);
        nodes.push(sampleNode(context, piano.get(choice.rootMidi)!, at, length, level, choice.rate, true));
      } else nodes.push(synthNode(context, note.midi, at, length, level * (note.instrument === "pad" ? .45 : .65), note.instrument === "pad"));
      if (++count % 128 === 0) { await pause(); checkAbort(signal); }
    }
    return await finish(context, signal);
  } finally { signal?.removeEventListener("abort", abort); }
}

export async function renderRecording(source: SongSource, mode: "original" | "arranged", bpm: number): Promise<AudioBuffer> {
  if (!["original", "arranged"].includes(mode) || !Number.isFinite(bpm) || bpm < 72 || bpm > 128) throw new Error("录音试听模式或速度无效");
  const duration = mode === "original" ? source.buffer.length / source.buffer.sampleRate : 480 / bpm;
  const context = new OfflineAudioContext(1, Math.ceil(duration * RATE), RATE);
  if (mode === "original") {
    const pcm = monoSamples(source.buffer), buffer = context.createBuffer(1, pcm.length, source.buffer.sampleRate);
    buffer.getChannelData(0).set(pcm);
    sampleNode(context, buffer, 0, duration, 1);
  } else {
    const clips = clipsFor(context, source), steps = source.analysis.steps;
    if (steps.length !== 16 || steps.some(value => !Number.isFinite(value) || value < 0 || value > 1) || !steps.some(value => value > 0)) throw new Error("录音节奏必须为含有效击打的16格力度");
    let index = 0;
    for (let step = 0; step < 32; step++) if (steps[step % 16] > 0) {
      const clip = clips[index++ % clips.length], at = step * 15 / bpm;
      sampleNode(context, clip.buffer, at, Math.min(clip.buffer.duration, duration - at), steps[step % 16] * clip.gain);
    }
  }
  return finish(context);
}
