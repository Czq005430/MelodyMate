import type { MusicParams, SuggestRequest, SuggestResponse, Step } from "./types.ts";
import { validatePatch, validateSuggestRequest } from "./validation.ts";
import { describeChanges } from "./proposals.ts";

export function createPresetSuggestions(request: SuggestRequest): SuggestResponse {
  validateSuggestRequest(request);
  if (request.mode !== "explore") throw new Error("本地预置只用于探索方向");
  const transient = request.analysis.features.transientScore >= 0.35;
  const rhythm = (hits: number[]): Step[] => Array.from({ length: 16 }, (_, i) => hits.includes(i) ? 1 : 0);
  const patches: Partial<MusicParams>[] = [
    { bpm: 80, steps: rhythm(transient ? [0, 6, 10] : [0, 8]), structurePreset: "mini", sourceTone: "original", sourceGain: 1, backingPreset: "off" },
    { bpm: 120, steps: rhythm(transient ? [0, 3, 4, 6, 8, 11, 12, 14] : [0, 4, 8, 10, 12, 14]), structurePreset: "repeat", sourceTone: "original", sourceGain: 1, backingPreset: request.project.backingAllowed && request.analysis.quality === "usable" ? "p1" : "off", backingGain: 0.08 },
  ];
  return { status: "suggestions", baseRevision: request.project.revision, source: "preset", message: "这两个方向由本地规则编排，不是 AI 生成结果。", proposals: patches.map((patch, index) => ({
    id: `preset-${request.project.revision}-${index}`, title: index === 0 ? "留一点空白" : "让它跳起来",
    explanation: describeChanges(request.project.params, patch), patch: validatePatch(patch, "global", request.project, request.analysis),
  })) };
}
