export type MusicBrief = { prompt: string; bpm: number; durationSec: 120 | 150 | 180; sourceLabels: string[] };
export type MusicJobRequest = { requestId: string; projectRevision: number; sourceIds: string[]; brief: MusicBrief };
export type MusicStatus = "submitting" | "pending" | "generating" | "ready" | "failed" | "unknown";
export type MusicCandidate = { id: string; title: string; durationSec: number | null; audioUrl: string };
export type MusicJob = MusicJobRequest & {
  id: string; provider: "kie"; createdAt: string; status: MusicStatus;
  message: string; candidates: MusicCandidate[];
};
export type MusicConfig = { configured: boolean; provider: "kie"; message: string; maxJobsPerDay: number };
