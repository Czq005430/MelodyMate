import test from "node:test";
import assert from "node:assert/strict";
import { validateProject, validatePatch, validateSuggestRequest } from "../lib/validation.ts";
import { analysis, project, request } from "./fixtures.ts";
import { createPresetSuggestions } from "../lib/presets.ts";
import { audibleSignature, validateModelResponse } from "../lib/proposals.ts";

test("工程约束拒绝静音原声、空节奏和未知字段", () => {
  for (const patch of [{ sourceGain: 0 }, { steps: Array(16).fill(0) }, { sourceGain: NaN }, { bpm: 90 }]) {
    assert.throws(() => validateProject({ ...project(), params: { ...project().params, ...patch } }));
  }
  assert.throws(() => validateProject({ ...project(), arbitrary: true }));
});
test("伴奏必须获准，过轻录音仍不能加伴奏", () => {
  const p = project(); p.params.backingPreset = "p1";
  assert.throws(() => validateProject(p, analysis()));
  p.backingAllowed = true;
  assert.doesNotThrow(() => validateProject(p, analysis()));
  const a = analysis(); a.features.peak = 0.01; a.features.rms = 0.005; a.quality = "tooQuiet"; a.normalizationGain = 6;
  assert.throws(() => validateProject(p, a));
});
test("局部 patch 不得修改整体速度或声音来源", () => {
  assert.throws(() => validatePatch({ bpm: 120 }, "source", project(), analysis()));
  assert.throws(() => validatePatch({ sourceId: "other" }, "global", project(), analysis()));
  assert.deepEqual(validatePatch({ sourceTone: "soft" }, "source", project(), analysis()), { sourceTone: "soft" });
});
test("声音分析必须匹配选区且近静音不能请求 AI", () => {
  const req = request(); assert.doesNotThrow(() => validateSuggestRequest(req));
  req.analysis.endFrame -= 1; assert.throws(() => validateSuggestRequest(req));
  const silent = request(); silent.analysis.features.peak = 0; silent.analysis.features.rms = 0;
  silent.analysis.normalizationGain = 1; silent.analysis.quality = "nearSilent";
  assert.throws(() => validateSuggestRequest(silent), /声音太轻/);
});
test("伪造增益、超长描述、错误 mode 与空编辑都被拒绝", () => {
  const req = request(); req.analysis.normalizationGain = 6;
  assert.throws(() => validateSuggestRequest(req));
  assert.throws(() => validateSuggestRequest({ ...request(), message: "声".repeat(301) }));
  assert.throws(() => validateSuggestRequest({ ...request(), mode: "edit", message: "" }));
  assert.throws(() => validateSuggestRequest({ ...request(), mode: "unknown" }));
});

test("离线候选明确标注预置，两个方向不同且不私自打开伴奏", () => {
  const req = request(); const response = createPresetSuggestions(req);
  assert.equal(response.source, "preset"); assert.equal(response.proposals.length, 2);
  const signatures = response.proposals.map(p => audibleSignature({ ...req.project.params, ...p.patch }));
  assert.notEqual(signatures[0], signatures[1]);
  response.proposals.forEach(p => assert.notEqual(p.patch.backingPreset, "p1"));
});
test("模型身份和版本由服务端覆盖，解释来自实际差异", () => {
  const req = { ...request(), mode: "edit" as const, target: "source" as const, message: "柔和一点" };
  const raw = { status: "suggestions", source: "preset", baseRevision: 999, message: "乱说", proposals: [{ id: "fake", title: "柔和", explanation: "已把原声变为人声", patch: { sourceTone: "soft" } }] };
  const result = validateModelResponse(raw, req);
  assert.equal(result.source, "ai"); assert.equal(result.baseRevision, 1);
  assert.notEqual(result.proposals[0].id, "fake");
  assert.doesNotMatch(result.proposals[0].explanation, /人声/);
  assert.match(result.proposals[0].explanation, /柔化/);
});
test("重复、无声差异或越权模型响应均拒绝", () => {
  const req = request();
  const candidate = { id: "a", title: "a", explanation: "a", patch: { backingGain: 0.01 } };
  const raw = { status: "suggestions", source: "ai", baseRevision: 1, message: "", proposals: [candidate, candidate] };
  assert.throws(() => validateModelResponse(raw, req));
  assert.throws(() => validateModelResponse({ ...raw, proposals: [{ ...candidate, patch: { sourceGain: 0 } }, { ...candidate, patch: { bpm: 120 } }] }, req));
});

test("初次探索不能返回 unsupported 或只有音量不同的两个方向", () => {
  const req = request();
  assert.throws(() => validateModelResponse({ status: "unsupported", proposals: [] }, req));
  const raw = { status: "suggestions", proposals: [0.5, 1].map(sourceGain => ({ title: "音量", patch: { sourceGain } })) };
  assert.throws(() => validateModelResponse(raw, req));
});
