export type MusicBrief = { prompt: string; bpm: number; durationSec: 120 | 150 | 180; sourceLabels: string[] };
// clip 存在即表示这是"续写"任务：把用户自己的雏形音频交给模型往后接，而不是只要一条独立伴奏。
export type MusicClip = { url: string; seconds: number; continueAt: number };
export type MusicRoute = "accompaniment" | "continued";
export type MusicJobRequest = { requestId: string; projectRevision: number; sourceIds: string[]; brief: MusicBrief; clip?: MusicClip };
export type MusicStatus = "submitting" | "pending" | "generating" | "ready" | "failed" | "unknown";
export type MusicCandidate = { id: string; title: string; durationSec: number | null; audioUrl: string };
export type MusicJob = MusicJobRequest & {
  id: string; provider: "kie"; createdAt: string; status: MusicStatus;
  message: string; candidates: MusicCandidate[];
};
// 任务摘要只给"最近任务"列表用：换标签页或换地址后，凭它把服务端已有结果载回页面，不重复提交。
export type MusicJobSummary = { id: string; status: MusicStatus; createdAt: string; continued: boolean; candidates: number; prompt: string };
// 续写产物已经含用户原声，不能当独立伴奏再叠一层；从 clip 是否存在派生，避免给本机旧任务加字段。
export const musicRoute = (value: { clip?: MusicClip }): MusicRoute => value.clip ? "continued" : "accompaniment";
export type MusicConfig = { configured: boolean; provider: "kie"; message: string; maxJobsPerDay: number };
