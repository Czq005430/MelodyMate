import assert from "node:assert/strict";
import test from "node:test";
import { readMusicSession, saveMusicSession, sameMusicProject } from "../lib/music-session.ts";
import type { MusicJobRequest } from "../lib/music-types.ts";

const request: MusicJobRequest = { requestId: "3e80acb4-fca1-4c7a-bcc5-214294a3e063", projectRevision: 2, sourceIds: ["cup"], brief: { prompt: "温暖的钢琴", bpm: 96, durationSec: 150, sourceLabels: ["杯子"] } };
function storage() {
  let value: string | null = null;
  return { getItem: () => value, setItem: (_key: string, next: string) => { value = next; }, removeItem: () => { value = null; } };
}
test("提交前保存请求，刷新后可用同一个幂等键恢复", () => {
  const store = storage(); saveMusicSession({ request }, store);
  assert.deepEqual(readMusicSession(store), { request });
  saveMusicSession({ request, jobId: request.requestId }, store);
  assert.equal(readMusicSession(store)?.jobId, request.requestId);
  assert.ok(!store.getItem()!.includes("token"));
});
test("损坏或无效的本地任务不会被重新提交", () => {
  const store = storage(); store.setItem("", "{broken"); assert.equal(readMusicSession(store), null);
  for (const invalid of [{}, { request: { ...request, requestId: "../escape" } }, { request: { ...request, brief: { ...request.brief, durationSec: 20 } } }]) {
    store.setItem("", JSON.stringify(invalid)); assert.equal(readMusicSession(store), null);
  }
});
test("保存失败向提交者报告，不能静默失去幂等键", () => {
  const store = { ...storage(), setItem() { throw new Error("quota"); } };
  assert.throws(() => saveMusicSession({ request }, store), /保存.*任务/);
});
test("浏览器禁止访问 localStorage 时读取不使页面崩溃，提交仍明确拒绝", () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  Object.defineProperty(globalThis, "localStorage", { configurable: true, get() { throw new Error("SecurityError"); } });
  try {
    assert.equal(readMusicSession(), null);
    assert.throws(() => saveMusicSession({ request }), /保存.*任务/);
  } finally {
    if (previous) Object.defineProperty(globalThis, "localStorage", previous);
    else Reflect.deleteProperty(globalThis, "localStorage");
  }
});
test("旧版本或替换了原声的候选不被当作当前工程", () => {
  assert.equal(sameMusicProject(request, 2, ["cup"]), true);
  assert.equal(sameMusicProject(request, 3, ["cup"]), false);
  assert.equal(sameMusicProject(request, 2, ["wood"]), false);
  assert.equal(sameMusicProject(request, 2, ["cup", "wood"]), false);
});
