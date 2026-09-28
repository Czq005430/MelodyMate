import type { MusicParams, Project, SourceAnalysis, SuggestRequest, SuggestTarget } from "./types.ts";

export function record(value: unknown, keys: string[], label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some(k => !keys.includes(k))) throw new Error(`${label}包含不支持的字段`);
  return value as Record<string, unknown>;
}
function number(value: unknown, min: number, max: number, label: string): asserts value is number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) throw new Error(`${label}超出范围`);
}
function text(value: unknown, min: number, max: number, label: string): asserts value is string {
  if (typeof value !== "string" || [...value].length < min || [...value].length > max) throw new Error(`${label}长度不正确`);
}
const parameterKeys = ["bpm", "steps", "structurePreset", "sourceGain", "sourceTone", "backingPreset", "backingGain"];

export function validateProject(value: unknown, analysis?: SourceAnalysis): Project {
  const p = record(value, ["schemaVersion", "revision", "sourceId", "sourceLabel", "sourceDurationSec", "trim", "bars", "backingAllowed", "params"], "工程");
  if (p.schemaVersion !== 2 || p.bars !== 4 || typeof p.backingAllowed !== "boolean") throw new Error("工程版本或结构不正确");
  number(p.revision, 0, Number.MAX_SAFE_INTEGER, "版本号");
  if (!Number.isInteger(p.revision)) throw new Error("版本号必须是整数");
  text(p.sourceId, 1, 128, "素材标识"); text(p.sourceLabel, 1, 40, "声音名称");
  number(p.sourceDurationSec, 0.05, 10, "素材时长");
  const trim = record(p.trim, ["startSec", "endSec"], "选区");
  number(trim.startSec, 0, p.sourceDurationSec, "选区起点");
  number(trim.endSec, 0, p.sourceDurationSec, "选区终点");
  const tolerance = 2 / (analysis?.sampleRate || 8000) + 1e-9;
  number(trim.endSec - trim.startSec, 0.05 - tolerance, 0.5 + tolerance, "选区时长");
  const params = record(p.params, parameterKeys, "音乐参数");
  if (![80, 100, 120].includes(params.bpm as number)) throw new Error("速度仅支持 80、100 或 120 BPM");
  if (!Array.isArray(params.steps) || params.steps.length !== 16 || params.steps.some(x => x !== 0 && x !== 1) || !params.steps.includes(1)) throw new Error("节奏须为 16 格，至少保留一格");
  if (!["repeat", "mini"].includes(params.structurePreset as string)) throw new Error("结构方案不正确");
  if (!["original", "soft"].includes(params.sourceTone as string)) throw new Error("原声效果不正确");
  if (!["off", "p1", "p2"].includes(params.backingPreset as string)) throw new Error("伴奏方案不正确");
  number(params.sourceGain, 0.5, 1, "原声音量"); number(params.backingGain, 0, 0.12, "伴奏音量");
  if (!p.backingAllowed && params.backingPreset !== "off") throw new Error("请先允许和弦伴奏");
  const result = p as unknown as Project;
  if (analysis) {
    validateAnalysis(analysis, result);
    if (analysis.quality !== "usable" && result.params.backingPreset !== "off") throw new Error("原声太轻，暂时保持伴奏关闭");
  }
  return result;
}

export function validateAnalysis(value: unknown, project: Project): SourceAnalysis {
  const a = record(value, ["analysisVersion", "sourceId", "startFrame", "endFrame", "sampleRate", "features", "normalizationGain", "quality"], "声音分析");
  if (a.analysisVersion !== 1 || a.sourceId !== project.sourceId) throw new Error("分析与当前素材不匹配");
  number(a.sampleRate, 8000, 192000, "采样率");
  number(a.startFrame, 0, project.sourceDurationSec * a.sampleRate, "起点帧");
  number(a.endFrame, 1, Math.ceil(project.sourceDurationSec * a.sampleRate), "终点帧");
  if (!Number.isInteger(a.sampleRate) || !Number.isInteger(a.startFrame) || !Number.isInteger(a.endFrame) || a.endFrame <= a.startFrame) throw new Error("分析帧范围不正确");
  if (Math.abs(project.trim.startSec * a.sampleRate - a.startFrame) > 1e-5 || Math.abs(project.trim.endSec * a.sampleRate - a.endFrame) > 1e-5) throw new Error("声音分析已过期，请重新选择片段");
  const f = record(a.features, ["peak", "rms", "durationMs", "zeroCrossingRate", "transientScore"], "声学指标");
  number(f.peak, 0, 1e6, "峰值"); number(f.rms, 0, f.peak + 1e-7, "平均幅度");
  number(f.durationMs, 0, 501, "片段时长");
  number(f.zeroCrossingRate, 0, 1, "过零率"); number(f.transientScore, 0, 1, "瞬态强度");
  if (Math.abs(f.durationMs - (a.endFrame - a.startFrame) / a.sampleRate * 1000) > 1e-5) throw new Error("分析时长不匹配");
  const gain = f.peak < 1e-4 ? 1 : Math.min(6, 0.75 / f.peak);
  const quality = f.peak < 1e-4 ? "nearSilent" : f.peak * gain < 0.1 ? "tooQuiet" : "usable";
  number(a.normalizationGain, 0, 6, "预增益");
  if (Math.abs(a.normalizationGain - gain) > 1e-6 || a.quality !== quality) throw new Error("预增益与声音质量不一致");
  return a as unknown as SourceAnalysis;
}

export function assertPlayable(project: Project, analysis: SourceAnalysis): void {
  validateProject(project, analysis);
  if (analysis.quality === "nearSilent") {
    throw Object.assign(new Error("声音太轻，请重新录制或调整选区"), { code: "SOURCE_TOO_QUIET" });
  }
}

export function validateSuggestRequest(value: unknown): SuggestRequest {
  const r = record(value, ["mode", "target", "project", "analysis", "message"], "建议请求");
  if (r.mode !== "explore" && r.mode !== "edit") throw new Error("建议模式不正确");
  if (!["source", "backing", "global"].includes(r.target as string) || (r.mode === "explore" && r.target !== "global")) throw new Error("修改对象不正确");
  text(r.message, 0, 300, "描述");
  if (r.mode === "edit" && !r.message.trim()) throw new Error("请描述想要的变化");
  const project = validateProject(r.project);
  const analysis = validateAnalysis(r.analysis, project);
  assertPlayable(project, analysis);
  return { mode: r.mode, target: r.target as SuggestTarget, project, analysis, message: r.message };
}

export function validatePatch(value: unknown, target: SuggestTarget, project: Project, analysis: SourceAnalysis): Partial<MusicParams> {
  const keys = target === "source" ? ["steps", "structurePreset", "sourceGain", "sourceTone"] : target === "backing" ? ["backingPreset", "backingGain"] : parameterKeys;
  const patch = record(value, keys, "修改提案");
  if (!Object.keys(patch).length) throw new Error("提案没有实际修改");
  assertPlayable({ ...project, params: { ...project.params, ...patch } }, analysis);
  return structuredClone(patch) as Partial<MusicParams>;
}
