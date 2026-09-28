import { expandArrangement } from "./arrangement.ts";
import { record, validatePatch, validateSuggestRequest } from "./validation.ts";
import type { MusicParams, SuggestRequest, SuggestResponse } from "./types.ts";

export function audibleSignature(params: MusicParams): string {
  const backing = params.backingPreset !== "off" && params.backingGain > 0;
  return JSON.stringify([params.bpm, expandArrangement(params), params.sourceGain, params.sourceTone, backing ? [params.backingPreset, params.backingGain] : null]);
}

export function describeChanges(before: MusicParams, patch: Partial<MusicParams>): string {
  const after = { ...before, ...patch }; const changes: string[] = [];
  if (before.bpm !== after.bpm) changes.push(`速度 ${before.bpm} → ${after.bpm} BPM`);
  if (JSON.stringify(before.steps) !== JSON.stringify(after.steps)) changes.push(`重新摆放节奏，每小节 ${after.steps.filter(Boolean).length} 次触发`);
  if (before.structurePreset !== after.structurePreset) changes.push(after.structurePreset === "mini" ? "加入进入、轻重变化与结尾" : "四小节保持相同节奏");
  if (before.sourceGain !== after.sourceGain) changes.push(`原声音量 ${Math.round(before.sourceGain * 100)}% → ${Math.round(after.sourceGain * 100)}%`);
  if (before.sourceTone !== after.sourceTone) changes.push(after.sourceTone === "soft" ? "原声加入柔化滤波" : "恢复原声音色");
  if (before.backingPreset !== after.backingPreset) changes.push(after.backingPreset === "off" ? "关闭伴奏" : `使用${after.backingPreset === "p1" ? "明亮" : "温柔"}和弦方案`);
  if (before.backingGain !== after.backingGain && after.backingPreset !== "off") changes.push(`伴奏音量 ${before.backingGain.toFixed(2)} → ${after.backingGain.toFixed(2)}`);
  return changes.join("；") || "参数没有可听变化";
}

export function validateModelResponse(raw: unknown, request: SuggestRequest): SuggestResponse {
  validateSuggestRequest(request);
  const value = record(raw, ["status", "baseRevision", "source", "message", "proposals"], "模型响应");
  if (!Array.isArray(value.proposals)) throw new Error("模型未提供提案数组");
  const base = { baseRevision: request.project.revision, source: "ai" as const };
  if (request.mode === "edit" && value.status === "unsupported" && value.proposals.length === 0) {
    return { ...base, status: "unsupported", message: "这个要求暂不支持。可以调整节奏、速度、音量、柔化效果或已获允许的伴奏。", proposals: [] };
  }
  if (value.status !== "suggestions" || value.proposals.length !== (request.mode === "explore" ? 2 : 1)) throw new Error("模型提案数量不正确");
  const signatures = new Set<string>();
  const proposals = value.proposals.map((entry, index) => {
    const candidate = record(entry, ["id", "title", "explanation", "patch"], "候选");
    if (typeof candidate.title !== "string" || [...candidate.title].length > 40 || !candidate.title.trim()) throw new Error("候选标题不正确");
    const patch = validatePatch(candidate.patch, request.target, request.project, request.analysis);
    const params = { ...request.project.params, ...patch };
    const signature = audibleSignature(request.mode === "explore" ? { ...params, sourceGain: 1, sourceTone: "original" } : params);
    if (signatures.has(signature) || (request.mode === "edit" && signature === audibleSignature(request.project.params))) throw new Error("提案没有不同的可听变化");
    signatures.add(signature);
    return { id: `ai-${request.project.revision}-${index}-${crypto.randomUUID()}`, title: candidate.title.trim(), explanation: describeChanges(request.project.params, patch), patch };
  });
  return { ...base, status: "suggestions", message: "根据选区测量指标和你的描述提出建议，试听后再采纳。", proposals };
}
