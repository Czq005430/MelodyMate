export type Step = 0 | 1;
export type Trim = { startSec: number; endSec: number };
export type MusicParams = {
  bpm: 80 | 100 | 120;
  steps: Step[];
  structurePreset: "repeat" | "mini";
  sourceGain: number;
  sourceTone: "original" | "soft";
  backingPreset: "off" | "p1" | "p2";
  backingGain: number;
};
export type Project = {
  schemaVersion: 2;
  revision: number;
  sourceId: string;
  sourceLabel: string;
  sourceDurationSec: number;
  trim: Trim;
  bars: 4;
  backingAllowed: boolean;
  params: MusicParams;
};
export type SourceFeatures = {
  peak: number;
  rms: number;
  durationMs: number;
  zeroCrossingRate: number;
  transientScore: number;
};
export type SourceAnalysis = {
  analysisVersion: 1;
  sourceId: string;
  startFrame: number;
  endFrame: number;
  sampleRate: number;
  features: SourceFeatures;
  normalizationGain: number;
  quality: "usable" | "tooQuiet" | "nearSilent";
};
export type Proposal = {
  id: string;
  title: string;
  explanation: string;
  patch: Partial<MusicParams>;
};
export type SuggestTarget = "source" | "backing" | "global";
export type SuggestRequest = {
  mode: "explore" | "edit";
  target: SuggestTarget;
  project: Project;
  analysis: SourceAnalysis;
  message: string;
};
export type SuggestResponse = {
  status: "suggestions" | "unsupported";
  baseRevision: number;
  source: "ai" | "preset";
  message: string;
  proposals: Proposal[];
};
export type AudioData = {
  sampleRate: number;
  length: number;
  numberOfChannels: number;
  getChannelData(channel: number): Float32Array;
};
export type SourceAsset = { id: string; name: string; buffer: AudioBuffer };
export type ArrangementEvent = { bar: number; step: number; time: number; velocity: number };
