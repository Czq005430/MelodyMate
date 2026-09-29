import type { AudioData } from "./types.ts";

export type SoundRole = "pulse" | "accent" | "texture";
export type RecordedHit = { startSec: number; endSec: number; peak: number };
export type RecordingAnalysis = {
  hits: RecordedHit[];
  steps: number[];
  mode: "aligned" | "rebuilt";
  offsetMs: number | null;
  summary: string;
};
export type SongSource = { id: string; role: SoundRole; label: string; buffer: AudioBuffer; analysis: RecordingAnalysis; example: boolean };
export type SongSection = {
  id: string; title: string; bars: number; energy: number;
  chords: number[]; piano: "off" | "chords" | "arpeggio";
  bass: boolean; pad: boolean; sourceRoles: SoundRole[];
};
export type SongPlan = {
  version: 1; title: string; bpm: number; key: number; scale: "major" | "minor";
  patterns: Record<SoundRole, number[]>;
  mix: { source: number; piano: number; bass: number; pad: number };
  sections: SongSection[];
};
export type SongProposal = { baseRevision: number; title: string; explanation: string; plan: SongPlan; origin: "codex" | "local" };
export type SongRenderOptions = { sectionId?: string; sourceOnly?: boolean; signal?: AbortSignal };
export type AnalysisInput = AudioData;
