import assert from "node:assert/strict";
import test from "node:test";
import { expandArrangement } from "../lib/arrangement.ts";
import type { MusicParams, Step } from "../lib/types.ts";

function params(active: number[], structurePreset: "repeat" | "mini" = "mini"): MusicParams {
  return { bpm: 120, steps: Array.from({ length: 16 }, (_, i): Step => active.includes(i) ? 1 : 0),
    structurePreset, sourceGain: 1, sourceTone: "original", backingPreset: "off", backingGain: 0.08 };
}

test("repeat 在四小节重复底稿，时间使用十六分音符网格", () => {
  const events = expandArrangement(params([0, 4, 15], "repeat"));
  assert.equal(events.length, 12);
  assert.deepEqual(events.filter((event) => event.bar === 3), [
    { bar: 3, step: 0, time: 6, velocity: 1 },
    { bar: 3, step: 4, time: 6.5, velocity: 1 },
    { bar: 3, step: 15, time: 7.875, velocity: 1 },
  ]);
});

test("mini 确定性派生进入、完整、轻重与收尾，不修改底稿", () => {
  const input = params([1, 5, 9, 13]);
  const before = structuredClone(input);
  const events = expandArrangement(input);
  assert.deepEqual(events, expandArrangement(input));
  assert.deepEqual(input, before);
  assert.deepEqual(events.filter((event) => event.bar === 0).map(({ step, velocity }) => [step, velocity]), [[1, 0.8], [9, 0.8]]);
  assert.deepEqual(events.filter((event) => event.bar === 1).map(({ step }) => step), [1, 5, 9, 13]);
  assert.deepEqual(events.filter((event) => event.bar === 2).map(({ velocity }) => velocity), [0.7, 1, 0.7, 1]);
  assert.deepEqual(events.filter((event) => event.bar === 3).map(({ step }) => step), [1, 5, 9]);
});

test("仅最后一拍有声音时，末小节明确派生 step 0 收尾", () => {
  const events = expandArrangement(params([15]));
  assert.deepEqual(events.filter((event) => event.bar === 3), [{ bar: 3, step: 0, time: 6, velocity: 1 }]);
  assert.ok([0, 1, 2, 3].every((bar) => events.some((event) => event.bar === bar)));
});

test("拒绝空节奏、错误网格和不支持速度", () => {
  assert.throws(() => expandArrangement(params([])), /节奏/);
  assert.throws(() => expandArrangement({ ...params([0]), steps: [1] }), /节奏/);
  assert.throws(() => expandArrangement({ ...params([0]), bpm: 0 as 120 }), /速度/);
});
