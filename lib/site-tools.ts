import { SONG_PLAN_SCHEMA } from "./song-plan.ts";

export type SongToolInput = { baseRevision: number; title: string; explanation: string; plan: unknown };
export type SongToolAdapter = { read: () => unknown; propose: (input: SongToolInput) => unknown };
type ToolResult = { content: { type: "text"; text: string }[]; isError?: boolean };
type SiteTool = { name: string; description: string; inputSchema: object; annotations: { readOnlyHint: boolean }; execute: (input: unknown) => Promise<ToolResult> };
type ModelContext = { registerTool: (tool: SiteTool) => void | Promise<void>; unregisterTool?: (name: string) => void };
type ToolStatus = "ready" | "unavailable" | "error";
type RegistrationState = { pending: Promise<void> | null; owner: symbol | null };
const registrations = new WeakMap<ModelContext, RegistrationState>();
type PermanentOwner = { tools: SiteTool[]; onStatus: (status: ToolStatus) => void };
type PermanentRegistration = { active: PermanentOwner | null; status: "pending" | "ready" | "error"; pending: Promise<void> | null };
const permanentRegistrations = new WeakMap<ModelContext, PermanentRegistration>();

const result = (value: unknown, isError?: boolean): ToolResult => ({ content: [{ type: "text", text: JSON.stringify(value) }], ...(isError ? { isError } : {}) });
export function createSongTools(adapter: SongToolAdapter): SiteTool[] {
  return [
    { name: "melodymate_read_project", description: "读取当前音乐工程、版本、段落和用户原声的测量摘要；不包含音频。先读取再提案。原声应是主角，保持至少120秒；提交后由用户在页面试听和采纳。", inputSchema: { type: "object", properties: {}, additionalProperties: false }, annotations: { readOnlyHint: true }, execute: async () => result(adapter.read()) },
    { name: "melodymate_propose_song", description: "为当前工程提出可试听的完整编曲计划。必须基于刚读取的revision，保留用户未要求修改的内容。不会自动采纳、播放、录音或下载。音乐质量需用户试听；不得声称听过录音。", annotations: { readOnlyHint: false },
      inputSchema: { type: "object", properties: { baseRevision: { type: "integer", minimum: 0 }, title: { type: "string", minLength: 1, maxLength: 60 }, explanation: { type: "string", minLength: 1, maxLength: 500 }, plan: SONG_PLAN_SCHEMA }, required: ["baseRevision", "title", "explanation", "plan"], additionalProperties: false },
      execute: async input => {
        try {
          if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("提案格式无效");
          const value = input as Record<string, unknown>;
          if (Object.keys(value).some(key => !["baseRevision", "title", "explanation", "plan"].includes(key)) || !Number.isSafeInteger(value.baseRevision) || Number(value.baseRevision) < 0) throw new Error("提案字段或版本无效，请重新读取工程");
          if (typeof value.title !== "string" || !value.title.trim() || value.title.length > 60 || typeof value.explanation !== "string" || !value.explanation.trim() || value.explanation.length > 500) throw new Error("请提供简短标题与不超过500字的编曲说明");
          return result(adapter.propose(value as SongToolInput));
        } catch (error) { return result({ error: error instanceof Error ? error.message : "提案未完成，作品没有改变" }, true); }
      },
    },
  ];
}

function registerPermanentTools(context: ModelContext, adapter: SongToolAdapter, onStatus: (status: ToolStatus) => void): () => void {
  const existing = permanentRegistrations.get(context);
  const state: PermanentRegistration = existing ?? { active: null, status: "pending", pending: null };
  const owner: PermanentOwner = { tools: createSongTools(adapter), onStatus };
  state.active = owner;
  if (existing) {
    // 无卸载接口时复用已注册工具及同一轮未完成的注册，只切换当前页面。
    if (state.status !== "pending") onStatus(state.status);
  } else {
    permanentRegistrations.set(context, state);
    const tools = owner.tools.map((tool, index) => ({ ...tool, execute: async (input: unknown) => {
      if (!state.active) return result({ error: "当前页面已离开，请重新打开音乐工作台" }, true);
      if (state.status !== "ready") return result({ error: "页面工具尚未就绪，请使用兼容交接或重新打开页面" }, true);
      return state.active.tools[index].execute(input);
    } }));
    const finish = (status: "ready" | "error") => {
      state.status = status; state.pending = null;
      state.active?.onStatus(status);
    };
    const install = (start: number): void | Promise<void> => {
      try {
        for (let index = start; index < tools.length; index++) {
          const pending = context.registerTool(tools[index]);
          if (pending && typeof pending.then === "function") return Promise.resolve(pending).then(() => install(index + 1));
        }
        finish("ready");
      } catch { finish("error"); }
    };
    const pending = install(0);
    if (pending) state.pending = pending.catch(() => finish("error"));
  }
  return () => { if (state.active === owner) state.active = null; };
}

export function registerSongTools(adapter: SongToolAdapter, onStatus: (status: ToolStatus) => void): () => void {
  const context = (document as Document & { modelContext?: ModelContext }).modelContext
    ?? (navigator as Navigator & { modelContext?: ModelContext }).modelContext;
  if (typeof context?.registerTool !== "function") { onStatus("unavailable"); return () => {}; }
  if (typeof context.unregisterTool !== "function") return registerPermanentTools(context, adapter, onStatus);
  const unregister = context.unregisterTool.bind(context);
  const state: RegistrationState = registrations.get(context) ?? { pending: null, owner: null };
  registrations.set(context, state);
  const owner = Symbol("song-tools");
  let disposed = false;
  let inFlight = false;
  const registered: string[] = [];
  const tools = createSongTools(adapter).map(tool => ({ ...tool, execute: async (input: unknown) => {
    if (disposed || state.owner !== owner) return result({ error: "这个页面的工具已失效，请重新读取当前工程" }, true);
    return tool.execute(input);
  } }));
  const cleanup = () => {
    if (state.owner !== owner) return;
    for (const name of registered.splice(0)) {
      try { unregister(name); } catch { /* 一个清理失败不阻止其余工具释放；旧回调已失效。 */ }
    }
    // 未完成的注册仍属于旧实例；它落地并清理后，下一个实例才能接手。
    if (!inFlight) state.owner = null;
  };
  const fail = () => { cleanup(); if (!disposed) onStatus("error"); };
  const install = (start: number): void | Promise<void> => {
    try {
      for (let index = start; index < tools.length; index++) {
        const tool = tools[index];
        const pending = context.registerTool(tool);
        if (pending && typeof pending.then === "function") {
          inFlight = true;
          return Promise.resolve(pending).then(() => {
            inFlight = false; registered.push(tool.name);
            if (disposed) { cleanup(); return; }
            return install(index + 1);
          }, () => { inFlight = false; fail(); });
        }
        // 同步 API 不引入微任务空隙，卸载时能够立即找到并移除它。
        registered.push(tool.name);
      }
      onStatus("ready");
    } catch { fail(); }
  };
  const begin = (): void | Promise<void> => {
    if (disposed) return;
    if (state.owner !== null && state.owner !== owner) { onStatus("error"); return; }
    state.owner = owner;
    return install(0);
  };
  const pending = state.pending ? state.pending.then(begin) : begin();
  if (pending) {
    const settled = Promise.resolve(pending).then(() => {
      if (state.pending === settled) state.pending = null;
    }, () => {
      fail();
      if (state.pending === settled) state.pending = null;
    });
    state.pending = settled;
  }
  return () => { disposed = true; cleanup(); };
}
