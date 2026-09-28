import type { Project, SourceAnalysis, SuggestRequest } from "../lib/types.ts";

export function project(): Project {
  return {
    schemaVersion: 2, revision: 1, sourceId: "sound-1", sourceLabel: "杯子",
    sourceDurationSec: 2, trim: { startSec: 0, endSec: 0.25 }, bars: 4,
    backingAllowed: false,
    params: { bpm: 100, steps: [1,0,0,0,1,0,0,0,1,0,0,0,1,0,0,0], structurePreset: "mini", sourceGain: 1, sourceTone: "original", backingPreset: "off", backingGain: 0.08 },
  };
}
export function analysis(): SourceAnalysis {
  return { analysisVersion: 1, sourceId: "sound-1", startFrame: 0, endFrame: 12000, sampleRate: 48000,
    features: { peak: 0.5, rms: 0.1, durationMs: 250, zeroCrossingRate: 0.12, transientScore: 0.6 },
    normalizationGain: 1.5, quality: "usable" };
}
export function request(): SuggestRequest {
  return { mode: "explore", target: "global", project: project(), analysis: analysis(), message: "" };
}
