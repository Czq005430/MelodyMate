import { analyzeSource } from "./source-analysis.ts";
import { expandArrangement } from "./arrangement.ts";
import { assertPlayable } from "./validation.ts";
import type { Project } from "./types.ts";

const CHORDS = {
  p1: [[60, 64, 67], [57, 60, 64], [53, 57, 60], [55, 59, 62]],
  p2: [[57, 60, 64], [53, 57, 60], [60, 64, 67], [55, 59, 62]],
};

export async function renderProject(source: AudioBuffer, project: Project,
  mode: "mix" | "source" | "backing" = "mix"): Promise<AudioBuffer> {
  if (!["mix", "source", "backing"].includes(mode)) throw new Error("试听模式无效");
  if (Math.abs(source.duration - project.sourceDurationSec) > 1 / source.sampleRate) {
    throw new Error("素材与当前工程不匹配，请重新载入声音");
  }
  const { analysis, samples } = analyzeSource(source, project.sourceId, project.trim);
  assertPlayable(project, analysis);
  if (mode === "backing" && (project.params.backingPreset === "off" || project.params.backingGain === 0)) {
    throw new Error("请先开启一个伴奏方案，再单独试听伴奏");
  }
  const sampleRate = 44100;
  const duration = 16 * 60 / project.params.bpm;
  const context = new OfflineAudioContext(1, Math.ceil(duration * sampleRate), sampleRate);
  if (mode !== "backing") {
    const clip = context.createBuffer(1, samples.length, source.sampleRate);
    clip.getChannelData(0).set(samples);
    let output: AudioNode = context.destination;
    if (project.params.sourceTone === "soft") {
      const filter = context.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.value = 2200;
      filter.Q.value = 0.707;
      filter.connect(context.destination);
      output = filter;
    }
    for (const event of expandArrangement(project.params)) {
      const sound = context.createBufferSource();
      const gain = context.createGain();
      const length = Math.min(clip.duration, duration - event.time);
      const end = event.time + length;
      const fade = Math.min(0.003, length / 2);
      const amplitude = analysis.normalizationGain * project.params.sourceGain * event.velocity;
      sound.buffer = clip;
      gain.gain.setValueAtTime(0, event.time);
      gain.gain.linearRampToValueAtTime(amplitude, event.time + fade);
      gain.gain.setValueAtTime(amplitude, end - fade);
      gain.gain.linearRampToValueAtTime(0, end);
      sound.connect(gain);
      gain.connect(output);
      sound.start(event.time, 0, length);
      sound.stop(end);
    }
  }
  const { backingPreset, backingGain } = project.params;
  if (mode !== "source" && backingPreset !== "off" && backingGain > 0) {
    const barLength = 4 * 60 / project.params.bpm;
    CHORDS[backingPreset].forEach((notes, bar) => {
      const start = bar * barLength;
      const end = (bar + 1) * barLength - 0.02;
      notes.forEach((note) => {
        const oscillator = context.createOscillator();
        const gain = context.createGain();
        oscillator.type = "triangle";
        oscillator.frequency.value = 440 * 2 ** ((note - 69) / 12);
        gain.gain.setValueAtTime(0, start);
        gain.gain.linearRampToValueAtTime(backingGain / 3, start + 0.04);
        gain.gain.setValueAtTime(backingGain / 3, end - 0.08);
        gain.gain.linearRampToValueAtTime(0, end);
        oscillator.connect(gain);
        gain.connect(context.destination);
        oscillator.start(start);
        oscillator.stop(end);
      });
    });
  }
  const rendered = await context.startRendering();
  const pcm = rendered.getChannelData(0);
  const fadeLength = Math.min(pcm.length, Math.round(0.005 * sampleRate));
  let peak = 0;
  for (let index = 0; index < pcm.length; index++) {
    if (!Number.isFinite(pcm[index])) throw new Error("音频渲染失败，请换一个声音重试");
    if (index >= pcm.length - fadeLength) pcm[index] *= (pcm.length - 1 - index) / (fadeLength - 1);
    peak = Math.max(peak, Math.abs(pcm[index]));
  }
  if (peak > 0.95) {
    const gain = 0.95 / peak;
    for (let index = 0; index < pcm.length; index++) pcm[index] *= gain;
  }
  return rendered;
}
