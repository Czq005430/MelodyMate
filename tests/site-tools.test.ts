import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { createSongTools, registerSongTools } from "../lib/site-tools.ts";
import { createSongPlan } from "../lib/song-plan.ts";

test("页面工具只返回可见工程摘要，不自动播放或采纳", async () => {
  const proposals: unknown[] = [];
  const tools = createSongTools({ read: () => ({ revision: 7, plan: createSongPlan(), sources: [], pendingProposal: null }), propose: input => { proposals.push(input); return { status: "proposal_ready" }; } });
  assert.deepEqual(tools.map(tool => tool.name), ["melodymate_read_project", "melodymate_propose_song"]);
  const read = await tools[0].execute({});
  assert.equal(JSON.parse(read.content[0].text).revision, 7);
  assert.equal(proposals.length, 0);
  assert.equal(tools[0].annotations.readOnlyHint, true);
});

test("编曲提案需要明确版本与理由，错误返回可理解的信息", async () => {
  let calls = 0;
  const tools = createSongTools({ read: () => ({}), propose: input => { calls++; if (input.baseRevision !== 3) throw new Error("作品已改变，请重新读取工程"); return { status: "proposal_ready" }; } });
  const invalid = await tools[1].execute({ baseRevision: -1, title: "a", explanation: "b", plan: createSongPlan() });
  assert.equal(invalid.isError, true);
  assert.equal(calls, 0);
  const stale = await tools[1].execute({ baseRevision: 2, title: "温暖的开头", explanation: "保留原声，加入钢琴", plan: createSongPlan() });
  assert.equal(stale.isError, true);
  assert.match(stale.content[0].text, /重新读取/);
  const valid = await tools[1].execute({ baseRevision: 3, title: "温暖的开头", explanation: "保留原声，加入钢琴", plan: createSongPlan() });
  assert.equal(valid.isError, undefined);
  assert.equal(calls, 2);
});

test("提案拒绝额外字段、空说明和超过限制的文字", async () => {
  const tools = createSongTools({ read: () => ({}), propose: () => { throw new Error("不应到达执行器"); } });
  for (const change of [{ code: "arbitrary code" }, { title: "" }, { explanation: "x".repeat(501) }]) {
    const result = await tools[1].execute({ baseRevision: 1, title: "方向", explanation: "说明", plan: createSongPlan(), ...change });
    assert.equal(result.isError, true);
    assert.doesNotMatch(result.content[0].text, /不应到达/);
  }
});

type RegisteredTool = ReturnType<typeof createSongTools>[number];
function useContext(t: TestContext, context: { registerTool: (tool: RegisteredTool) => void | Promise<void>; unregisterTool?: (name: string) => void }) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "document");
  Object.defineProperty(globalThis, "document", { configurable: true, value: { modelContext: context } });
  t.after(() => { if (previous) Object.defineProperty(globalThis, "document", previous); else Reflect.deleteProperty(globalThis, "document"); });
}
const settle = () => new Promise<void>(resolve => setImmediate(resolve));

test("同步工具立即记账，快速卸载重挂载后旧清理不会删除新工具", async t => {
  const active = new Map<string, RegisteredTool>();
  useContext(t, {
    registerTool(tool) { if (active.has(tool.name)) throw new Error("重复注册"); active.set(tool.name, tool); },
    unregisterTool(name) { active.delete(name); },
  });
  let oldCalls = 0;
  const firstStatus: string[] = [], secondStatus: string[] = [];
  const first = registerSongTools({ read: () => { oldCalls++; return { revision: 1 }; }, propose: () => ({}) }, status => firstStatus.push(status));
  assert.equal(active.size, 2);
  assert.deepEqual(firstStatus, ["ready"]);
  const staleRead = active.get("melodymate_read_project")!;
  first();
  assert.equal(active.size, 0);
  const second = registerSongTools({ read: () => ({ revision: 2 }), propose: () => ({}) }, status => secondStatus.push(status));
  try {
    first();
    await settle();
    assert.equal(active.size, 2);
    assert.deepEqual(secondStatus, ["ready"]);
    const read = await active.get("melodymate_read_project")!.execute({});
    assert.equal(JSON.parse(read.content[0].text).revision, 2);
    assert.equal((await staleRead.execute({})).isError, true);
    assert.equal(oldCalls, 0);
  } finally { second(); }
  assert.equal(active.size, 0);
});

test("异步注册未完成时先卸载，新挂载等待旧注册清理后再进入", async t => {
  const active = new Map<string, RegisteredTool>();
  const waiting: { tool: RegisteredTool; finish: () => void }[] = [];
  useContext(t, {
    registerTool(tool) { return new Promise<void>(resolve => waiting.push({ tool, finish: () => { assert.equal(active.has(tool.name), false); active.set(tool.name, tool); resolve(); } })); },
    unregisterTool(name) { active.delete(name); },
  });
  const firstStatus: string[] = [], secondStatus: string[] = [];
  const first = registerSongTools({ read: () => ({ revision: 1 }), propose: () => ({}) }, status => firstStatus.push(status));
  assert.equal(waiting.length, 1);
  first();
  const second = registerSongTools({ read: () => ({ revision: 2 }), propose: () => ({}) }, status => secondStatus.push(status));
  try {
    assert.equal(waiting.length, 1, "新实例不能与旧的同名注册并行");
    waiting.shift()!.finish(); await settle();
    assert.equal(active.size, 0, "旧注册晚到后必须撤销");
    assert.equal(waiting.length, 1);
    waiting.shift()!.finish(); await settle();
    assert.equal(waiting.length, 1);
    waiting.shift()!.finish(); await settle();
    assert.deepEqual(firstStatus, []);
    assert.deepEqual(secondStatus, ["ready"]);
    first();
    assert.equal(active.size, 2);
    assert.equal(JSON.parse((await active.get("melodymate_read_project")!.execute({})).content[0].text).revision, 2);
  } finally { second(); }
  assert.equal(active.size, 0);
});

test("卸载立即移除已完成的工具，剩余异步注册失败不阻塞下一实例", async t => {
  const active = new Map<string, RegisteredTool>();
  let rejectRegistration!: (error: Error) => void;
  let fail = true;
  useContext(t, {
    registerTool(tool) {
      if (tool.name === "melodymate_propose_song" && fail) return new Promise<void>((_, reject) => { rejectRegistration = reject; });
      if (active.has(tool.name)) throw new Error("重复注册");
      active.set(tool.name, tool);
    },
    unregisterTool(name) { active.delete(name); },
  });
  const first = registerSongTools({ read: () => ({}), propose: () => ({}) }, () => {});
  assert.equal(active.size, 1);
  first();
  assert.equal(active.size, 0);
  const statuses: string[] = [];
  const second = registerSongTools({ read: () => ({ revision: 9 }), propose: () => ({}) }, status => statuses.push(status));
  try {
    fail = false;
    rejectRegistration(new Error("注册失败")); await settle();
    assert.equal(active.size, 2);
    assert.deepEqual(statuses, ["ready"]);
    first();
    assert.equal(active.size, 2);
  } finally { second(); }
});

test("无卸载API时只注册一次，离开后拒绝调用，重挂载转发到当前工程", async t => {
  const tools = new Map<string, RegisteredTool>();
  let calls = 0, oldProposals = 0, newProposals = 0;
  useContext(t, { registerTool(tool) { calls++; assert.equal(tools.has(tool.name), false); tools.set(tool.name, tool); } });
  const firstStatus: string[] = [], secondStatus: string[] = [];
  const first = registerSongTools({ read: () => ({ revision: 1 }), propose: () => { oldProposals++; return {}; } }, status => firstStatus.push(status));
  assert.deepEqual(firstStatus, ["ready"]);
  assert.equal(calls, 2);
  const read = tools.get("melodymate_read_project")!;
  const propose = tools.get("melodymate_propose_song")!;
  assert.equal(JSON.parse((await read.execute({})).content[0].text).revision, 1);
  first();
  assert.equal((await read.execute({})).isError, true);
  assert.equal((await propose.execute({})).isError, true);
  const second = registerSongTools({ read: () => ({ revision: 2 }), propose: () => { newProposals++; return { status: "proposal_ready" }; } }, status => secondStatus.push(status));
  try {
    first();
    assert.equal(calls, 2);
    assert.deepEqual(secondStatus, ["ready"]);
    assert.equal(JSON.parse((await read.execute({})).content[0].text).revision, 2);
    const accepted = await propose.execute({ baseRevision: 2, title: "当前提案", explanation: "保留原声", plan: createSongPlan() });
    assert.equal(accepted.isError, undefined);
    assert.equal(oldProposals, 0);
    assert.equal(newProposals, 1);
  } finally { second(); }
  assert.equal((await read.execute({})).isError, true);
});

test("无卸载API的异步注册复用同一轮，完成时只通知最新页面实例", async t => {
  const tools = new Map<string, RegisteredTool>();
  const waiting: (() => void)[] = [];
  let calls = 0;
  useContext(t, { registerTool(tool) { calls++; return new Promise<void>(resolve => waiting.push(() => { assert.equal(tools.has(tool.name), false); tools.set(tool.name, tool); resolve(); })); } });
  const firstStatus: string[] = [], secondStatus: string[] = [], thirdStatus: string[] = [];
  const first = registerSongTools({ read: () => ({ revision: 1 }), propose: () => ({}) }, status => firstStatus.push(status));
  assert.equal(calls, 1);
  first();
  const second = registerSongTools({ read: () => ({ revision: 2 }), propose: () => ({}) }, status => secondStatus.push(status));
  assert.equal(calls, 1);
  waiting.shift()!(); await settle();
  assert.equal(calls, 2);
  second();
  const third = registerSongTools({ read: () => ({ revision: 3 }), propose: () => ({}) }, status => thirdStatus.push(status));
  try {
    assert.equal(calls, 2);
    waiting.shift()!(); await settle();
    assert.deepEqual(firstStatus, []);
    assert.deepEqual(secondStatus, []);
    assert.deepEqual(thirdStatus, ["ready"]);
    first(); second();
    assert.equal(JSON.parse((await tools.get("melodymate_read_project")!.execute({})).content[0].text).revision, 3);
  } finally { third(); }
});

test("无卸载API的部分注册失败明确报错，重挂载不冒险重名注册", async t => {
  const tools = new Map<string, RegisteredTool>();
  let calls = 0;
  let rejectRegistration!: (error: Error) => void;
  useContext(t, { registerTool(tool) {
    calls++;
    if (tool.name === "melodymate_propose_song") return new Promise<void>((_, reject) => { rejectRegistration = reject; });
    tools.set(tool.name, tool);
  } });
  const firstStatus: string[] = [], secondStatus: string[] = [];
  const first = registerSongTools({ read: () => ({}), propose: () => ({}) }, status => firstStatus.push(status));
  first();
  const second = registerSongTools({ read: () => ({}), propose: () => ({}) }, status => secondStatus.push(status));
  rejectRegistration(new Error("平台拒绝注册")); await settle();
  assert.deepEqual(firstStatus, []);
  assert.deepEqual(secondStatus, ["error"]);
  assert.equal((await tools.get("melodymate_read_project")!.execute({})).isError, true);
  second();
  const statuses: string[] = [];
  const third = registerSongTools({ read: () => ({}), propose: () => ({}) }, status => statuses.push(status));
  try { assert.deepEqual(statuses, ["error"]); assert.equal(calls, 2); }
  finally { third(); }
});
