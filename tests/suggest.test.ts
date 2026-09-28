import assert from "node:assert/strict";
import test from "node:test";
import { createRequestGuard, readJsonBody, RequestError } from "../lib/request-guard.ts";
import { createSuggestHandler } from "../lib/suggest-handler.ts";
import { request as suggestRequest } from "./fixtures.ts";
import { fetchSuggestions } from "../lib/suggestion-client.ts";

const accessEnv = { APP_ORIGIN: "http://localhost:3000", DEMO_ACCESS_TOKEN: "demo-only" };
function request(body: string = "{}", extra: Record<string, string> = {}): Request {
  return new Request("http://localhost:3000/api/suggest", {
    method: "POST",
    headers: { origin: accessEnv.APP_ORIGIN, "x-demo-token": "demo-only", "content-type": "application/json", ...extra },
    body,
  });
}
function hasStatus(status: number) {
  return (error: unknown) => error instanceof RequestError && error.status === status;
}

test("access guard fails closed without configuration or with missing/wrong origin and token", () => {
  assert.throws(() => createRequestGuard({ env: {} }).check(request()), hasStatus(503));
  assert.throws(() => createRequestGuard({ env: { APP_ORIGIN: accessEnv.APP_ORIGIN } }).check(request()), hasStatus(503));
  for (const header of ["origin", "x-demo-token"]) {
    const missing = request();
    missing.headers.delete(header);
    assert.throws(() => createRequestGuard({ env: accessEnv }).check(missing), hasStatus(403));
    assert.throws(() => createRequestGuard({ env: accessEnv }).check(request("{}", { [header]: "wrong" })), hasStatus(403));
  }
});

test("untrusted proxy headers cannot bypass the shared 10 per minute limit", () => {
  let now = 0;
  const guard = createRequestGuard({ env: accessEnv, clock: () => now });
  for (let index = 0; index < 10; index++) {
    guard.check(request("{}", { "x-real-ip": `192.0.2.${index + 1}`, "x-forwarded-for": `192.0.2.${index + 1}` }));
  }
  assert.throws(() => guard.check(request()), hasStatus(429));
  now = 60_000;
  assert.doesNotThrow(() => guard.check(request()));
});

test("trusted deployment uses only one valid X-Real-IP, not forwarded chains", () => {
  const guard = createRequestGuard({ env: { ...accessEnv, TRUST_PROXY: "true" } });
  for (let index = 0; index < 10; index++) guard.check(request("{}", { "x-real-ip": "192.0.2.1" }));
  assert.throws(() => guard.check(request("{}", { "x-real-ip": "192.0.2.1", "x-forwarded-for": "192.0.2.2" })), hasStatus(429));
  assert.doesNotThrow(() => guard.check(request("{}", { "x-real-ip": "192.0.2.2" })));
  const invalid = createRequestGuard({ env: { ...accessEnv, TRUST_PROXY: "true" } });
  for (let index = 0; index < 10; index++) invalid.check(request("{}", { "x-real-ip": `fake-${index}` }));
  assert.throws(() => invalid.check(request()), hasStatus(429));
});

test("only two model calls may be in flight and release is idempotent", () => {
  const guard = createRequestGuard({ env: accessEnv });
  const first = guard.acquire();
  const second = guard.acquire();
  assert.throws(() => guard.acquire(), hasStatus(429));
  first();
  first();
  const third = guard.acquire();
  assert.throws(() => guard.acquire(), hasStatus(429));
  second();
  third();
  assert.doesNotThrow(() => guard.acquire()());
});

test("body parsing measures actual UTF-8 bytes despite forged Content-Length", async () => {
  await assert.rejects(readJsonBody(request(JSON.stringify({ text: "声".repeat(6000) }), { "content-length": "1" })), hasStatus(413));
  const exact = JSON.stringify({ text: "a".repeat(16 * 1024 - 11) });
  assert.equal(new TextEncoder().encode(exact).byteLength, 16 * 1024);
  assert.deepEqual(await readJsonBody(request(exact)), { text: "a".repeat(16 * 1024 - 11) });
  await assert.rejects(readJsonBody(request("{")), hasStatus(400));
});

test("oversized streaming body is cancelled before reading further chunks", async () => {
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) { controller.enqueue(new Uint8Array(9000)); },
    cancel() { cancelled = true; },
  });
  const streamed = new Request("http://localhost:3000/api/suggest", {
    method: "POST", headers: { "content-type": "application/json" }, body: stream, duplex: "half",
  } as RequestInit & { duplex: "half" });
  await assert.rejects(readJsonBody(streamed), hasStatus(413));
  assert.equal(cancelled, true);
});

const modelEnv = {
  ...accessEnv, MODEL_API_URL: "https://model.example/v1/chat/completions",
  MODEL_API_KEY: "private-model-key", MODEL_NAME: "demo-model",
};

test("upstream failure cancels remaining transport after returning an error", async () => {
  let signal: AbortSignal | null | undefined;
  const handler = createSuggestHandler({ env: modelEnv, fetch: async (_url, init) => {
    signal = init?.signal;
    return new Response(new ReadableStream({ start() {} }), { status: 500 });
  } });
  assert.equal((await handler(request(JSON.stringify(editBody())))).status, 503);
  assert.equal(signal?.aborted, true);
});

test("client exploration falls back when a successful response body is interrupted", async () => {
  const broken = async () => new Response(new ReadableStream({ start(controller) { controller.error(new Error("connection interrupted")); } }));
  const response = await fetchSuggestions(suggestRequest(), "demo", new AbortController().signal, broken);
  assert.equal(response.source, "preset"); assert.equal(response.proposals.length, 2);
  await assert.rejects(fetchSuggestions(editBody(), "demo", new AbortController().signal, broken), /没有改变/);
});

test("client never disguises an explicit access rejection as successful exploration", async () => {
  await assert.rejects(fetchSuggestions(suggestRequest(), "bad", new AbortController().signal,
    async () => Response.json({ error: { message: "口令错误" } }, { status: 403 })), /口令错误/);
});
function editBody() {
  return { ...suggestRequest(), mode: "edit" as const, target: "source" as const, message: "柔和一点" };
}
function modelResult() {
  return {
    status: "suggestions", source: "ai", baseRevision: 999, message: "请试听",
    proposals: [{ id: "untrusted-id", title: "更柔和", explanation: "未验证的模型解释", patch: { sourceTone: "soft" } }],
  };
}
function upstream(raw: unknown = modelResult()): Response {
  return Response.json({ choices: [{ message: { content: JSON.stringify(raw) } }] });
}
const nextTurn = () => new Promise<void>((resolve) => setImmediate(resolve));

test("unconfigured model labels exploration presets and cannot invent an edit", async () => {
  let calls = 0;
  const handler = createSuggestHandler({ env: accessEnv, fetch: async () => { calls++; return upstream(); } });
  const explore = await handler(request(JSON.stringify(suggestRequest())));
  assert.equal(explore.status, 200);
  const result = await explore.json();
  assert.equal(result.source, "preset");
  assert.equal(result.proposals.length, 2);
  assert.equal(result.baseRevision, 1);
  assert.equal((await handler(request(JSON.stringify(editBody())))).status, 503);
  assert.equal(calls, 0);
});

test("403, 400, 413 and rate limit responses never call the model", async () => {
  let calls = 0;
  const handler = createSuggestHandler({ env: modelEnv, fetch: async () => { calls++; return upstream(); } });
  assert.equal((await handler(request("{}", { origin: "https://other.example" }))).status, 403);
  assert.equal((await handler(request("{}", { "x-demo-token": "wrong" }))).status, 403);
  assert.equal((await handler(request("{"))).status, 400);
  assert.equal((await handler(request(JSON.stringify({ ...suggestRequest(), rawAudio: "forbidden" })))).status, 400);
  assert.equal((await handler(request("声".repeat(6000), { "content-length": "1" }))).status, 413);
  const silent = suggestRequest();
  silent.analysis.features.peak = 0; silent.analysis.features.rms = 0;
  silent.analysis.normalizationGain = 1; silent.analysis.quality = "nearSilent";
  assert.equal((await handler(request(JSON.stringify(silent)))).status, 400);
  for (let index = 0; index < 5; index++) assert.equal((await handler(request("{"))).status, 400);
  assert.equal((await handler(request(JSON.stringify(editBody())))).status, 429);
  assert.equal(calls, 0);
});

test("model receives bounded text context and the response is strictly validated", async () => {
  let calls = 0;
  const handler = createSuggestHandler({ env: modelEnv, fetch: async (url, init) => {
    calls++;
    assert.equal(url, modelEnv.MODEL_API_URL);
    assert.equal(new Headers(init?.headers).get("authorization"), `Bearer ${modelEnv.MODEL_API_KEY}`);
    const payload = JSON.parse(String(init?.body));
    assert.equal(payload.model, modelEnv.MODEL_NAME);
    assert.equal(payload.stream, false);
    assert.equal(payload.max_tokens, 1024);
    assert.match(payload.messages[0].content, /没有直接听/);
    const context = JSON.parse(payload.messages[1].content);
    assert.deepEqual(context.project, editBody().project);
    assert.deepEqual(context.features, editBody().analysis.features);
    assert.equal(context.message, "柔和一点");
    assert.equal("analysis" in context, false);
    assert.ok(init?.signal instanceof AbortSignal);
    return upstream();
  } });
  const response = await handler(request(JSON.stringify(editBody())));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  const result = await response.json();
  assert.equal(result.source, "ai");
  assert.equal(result.baseRevision, 1);
  assert.notEqual(result.proposals[0].id, "untrusted-id");
  assert.deepEqual(result.proposals[0].patch, { sourceTone: "soft" });
  assert.equal(calls, 1);
});

test("invalid upstream JSON or unauthorized patches cannot become accepted edits", async () => {
  for (const response of [
    new Response("not json"),
    Response.json({ choices: [{ message: { content: "not json" } }] }),
    upstream({ ...modelResult(), proposals: [{ ...modelResult().proposals[0], patch: { bpm: 120 } }] }),
  ]) {
    const handler = createSuggestHandler({ env: modelEnv, fetch: async () => response });
    assert.equal((await handler(request(JSON.stringify(editBody())))).status, 503);
  }
  const handler = createSuggestHandler({ env: modelEnv, fetch: async () => upstream({ invalid: true }) });
  assert.equal((await (await handler(request(JSON.stringify(suggestRequest())))).json()).source, "preset");
});

test("upstream quota rejection is 429 without retries or a fake successful preset", async () => {
  for (const status of [402, 429]) {
    let calls = 0;
    const handler = createSuggestHandler({ env: modelEnv, fetch: async () => { calls++; return new Response("private quota details", { status }); } });
    const response = await handler(request(JSON.stringify(suggestRequest())));
    assert.equal(response.status, 429);
    assert.equal(calls, 1);
    assert.doesNotMatch(await response.text(), /private quota details/);
  }
});

test("network errors do not reveal credentials or the user's request", async () => {
  const body = { ...editBody(), message: "private-user-message" };
  const handler = createSuggestHandler({ env: modelEnv, fetch: async () => { throw new Error(`${modelEnv.MODEL_API_KEY} ${body.message}`); } });
  const response = await handler(request(JSON.stringify(body)));
  assert.equal(response.status, 503);
  assert.doesNotMatch(await response.text(), /private-model-key|private-user-message/);
});

test("a failed in-flight call releases its slot in finally", async () => {
  const pending: Array<(response: Response) => void> = [];
  const handler = createSuggestHandler({ env: modelEnv, fetch: () => new Promise((resolve) => pending.push(resolve)) });
  const first = handler(request(JSON.stringify(editBody())));
  const second = handler(request(JSON.stringify(editBody())));
  await nextTurn();
  assert.equal(pending.length, 2);
  assert.equal((await handler(request(JSON.stringify(editBody())))).status, 429);
  pending[0](new Response("upstream failed", { status: 500 }));
  assert.equal((await first).status, 503);
  const third = handler(request(JSON.stringify(editBody())));
  await nextTurn();
  assert.equal(pending.length, 3);
  pending[1](upstream()); pending[2](upstream());
  assert.equal((await second).status, 200);
  assert.equal((await third).status, 200);
});

test("model timeout aborts at ten seconds and exploration falls back honestly", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let signal: AbortSignal | undefined;
  const handler = createSuggestHandler({ env: modelEnv, fetch: (_url, init) => new Promise((_resolve, reject) => {
    signal = init?.signal ?? undefined;
    signal?.addEventListener("abort", () => reject(new Error("upstream aborted")), { once: true });
  }) });
  const pending = handler(request(JSON.stringify(suggestRequest())));
  await nextTurn();
  assert.ok(signal);
  t.mock.timers.tick(9_999);
  assert.equal(signal.aborted, false);
  t.mock.timers.tick(1);
  const response = await pending;
  assert.equal(signal.aborted, true);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).source, "preset");
});
