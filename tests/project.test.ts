import test from "node:test";
import assert from "node:assert/strict";
import { projectReducer, initialProjectState, createProject } from "../lib/project.ts";
import { project } from "./fixtures.ts";

test("一次提交一条历史，撤销恢复内容而版本持续递增", () => {
  let state = projectReducer(initialProjectState, { type: "load", project: project() });
  const original = state.project!;
  state = projectReducer(state, { type: "commit", project: { ...original, params: { ...original.params, bpm: 120 } } });
  assert.equal(state.history.length, 1);
  const editedRevision = state.project!.revision;
  state = projectReducer(state, { type: "undo" });
  assert.equal(state.project!.params.bpm, 100);
  assert.ok(state.project!.revision > editedRevision);
});
test("历史最多五条，载入新素材清空历史但不重置版本", () => {
  let state = projectReducer(initialProjectState, { type: "load", project: project() });
  for (let i = 0; i < 8; i++) state = projectReducer(state, { type: "commit", project: { ...state.project!, sourceLabel: String(i) } });
  assert.equal(state.history.length, 5);
  const revision = state.project!.revision;
  state = projectReducer(state, { type: "load", project: createProject("other", "木头", 2, { startSec: 0, endSec: 0.25 }) });
  assert.equal(state.history.length, 0);
  assert.ok(state.project!.revision > revision);
  assert.equal(state.project!.backingAllowed, false);
});
test("无差异不增加历史，不能借 commit 替换素材", () => {
  let state = projectReducer(initialProjectState, { type: "load", project: project() });
  const same = projectReducer(state, { type: "commit", project: structuredClone(state.project!) });
  assert.equal(same, state);
  assert.throws(() => projectReducer(state, { type: "commit", project: { ...state.project!, sourceId: "other" } }));
});

test("过期工程不能覆盖已经完成的新修改", () => {
  let state = projectReducer(initialProjectState, { type: "load", project: project() });
  const old = structuredClone(state.project!);
  state = projectReducer(state, { type: "commit", project: { ...old, params: { ...old.params, bpm: 120 } } });
  assert.throws(() => projectReducer(state, { type: "commit", project: { ...old, params: { ...old.params, sourceTone: "soft" } } }), /过期/);
});
