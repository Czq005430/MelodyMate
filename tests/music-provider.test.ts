import assert from "node:assert/strict";
import test from "node:test";
import { createMusicProvider, parseMusicResult } from "../lib/music-provider.ts";

const brief = { prompt: "温柔的钢琴", bpm: 100, durationSec: 150 as const, sourceLabels: ["玻璃轻敲"] };
const env = { MUSIC_API_KEY: "private-key" };

test("music submission uses the documented custom instrumental contract without audio or lyrics", async () => {
  const provider = createMusicProvider({ env, fetch: async (url, init) => {
    assert.equal(url, "https://api.kie.ai/api/v1/jobs/createTask");
    assert.equal(new Headers(init?.headers).get("authorization"), "Bearer private-key");
    assert.equal(init?.redirect, "error");
    const body = JSON.parse(String(init?.body));
    assert.equal(body.model, "ai-music-api/generate");
    assert.deepEqual(Object.keys(body.input).sort(), ["custom_mode", "duration", "instrumental", "model", "style", "title"].sort());
    assert.equal(body.input.model, "V6"); assert.equal(body.input.instrumental, true);
    assert.equal(body.input.duration, 150); assert.match(body.input.style, /100 BPM/);
    assert.match(body.input.style, /温柔的钢琴/); assert.match(body.input.style, /鼓/);
    assert.ok([...body.input.style].length <= 1000);
    return Response.json({ code: 200, data: { taskId: "remote-task" } });
  } });
  assert.equal(await provider.create(brief), "remote-task");
});

test("music result parsing accepts only explicit URL or track arrays, bounds count, and rejects unknown structures", () => {
  assert.equal(parseMusicResult(JSON.stringify({ resultUrls: ["https://cdn1.suno.ai/a.mp3", "https://cdn2.suno.ai/b.mp3"] })).length, 2);
  assert.deepEqual(parseMusicResult(JSON.stringify({ data: [{ id: "a", audio_url: "https://file.aiquickdraw.com/a.mp3", duration: 150 }] })),
    [{ id: "a", title: "方向 1", url: "https://file.aiquickdraw.com/a.mp3", durationSec: 150 }]);
  assert.equal(parseMusicResult(JSON.stringify([{ audioUrl: "https://cdn1.suno.ai/a.mp3" }])).length, 1);
  for (const value of [{ nested: { cover: "https://cdn1.suno.ai/a.mp3" } }, { resultUrls: [] }, { resultUrls: Array(5).fill("https://cdn1.suno.ai/a.mp3") }]) {
    assert.throws(() => parseMusicResult(JSON.stringify(value)), /协议/);
  }
});

test("music query maps documented async states and preserves failed versus retryable transport errors", async () => {
  for (const state of ["waiting", "queuing", "generating", "fail", "success"]) {
    const provider = createMusicProvider({ env, fetch: async (url) => {
      assert.equal(String(url), "https://api.kie.ai/api/v1/jobs/recordInfo?taskId=task%2Fid");
      return Response.json({ code: 200, data: { state, resultJson: JSON.stringify({ resultUrls: ["https://cdn1.suno.ai/a.mp3"] }) } });
    } });
    const result = await provider.query("task/id");
    assert.equal(result.state, state === "waiting" || state === "queuing" ? "pending" : state === "success" ? "ready" : state === "fail" ? "failed" : "generating");
  }
});

test("audio download blocks arbitrary hosts, credentials, ports, redirects and non-audio payloads", async () => {
  let calls = 0;
  const provider = createMusicProvider({ env, fetch: async (_url, init) => {
    calls++; assert.equal(init?.redirect, "error");
    assert.equal(new Headers(init?.headers).has("authorization"), false);
    return new Response("<html>not music</html>", { headers: { "content-type": "text/html" } });
  } });
  for (const url of ["http://cdn1.suno.ai/a", "https://cdn1.suno.ai.attacker.test/a", "https://user@cdn1.suno.ai/a", "https://cdn1.suno.ai:444/a", "https://127.0.0.1/a"]) {
    await assert.rejects(provider.download(url));
  }
  assert.equal(calls, 0);
  await assert.rejects(provider.download("https://cdn1.suno.ai/a.mp3"));
  const redirect = createMusicProvider({ env, fetch: async () => new Response(null, { status: 302, headers: { location: "https://127.0.0.1" } }) });
  await assert.rejects(redirect.download("https://cdn1.suno.ai/a.mp3"));
});

test("audio download enforces the actual 50 MiB stream limit despite false Content-Length", async () => {
  let cancelled = false;
  const provider = createMusicProvider({ env, fetch: async () => new Response(new ReadableStream({
    pull(controller) { controller.enqueue(new Uint8Array(26 * 1024 * 1024)); },
    cancel() { cancelled = true; },
  }), { headers: { "content-type": "audio/mpeg", "content-length": "1" } }) });
  await assert.rejects(provider.download("https://cdn1.suno.ai/a.mp3"), /过大/);
  assert.equal(cancelled, true);
});

test("submission timeout is ambiguous and never retries or leaks upstream details", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let calls = 0;
  const provider = createMusicProvider({ env, fetch: (_url, init) => new Promise((_resolve, reject) => {
    calls++; init?.signal?.addEventListener("abort", () => reject(new Error("private-key")), { once: true });
  }) });
  const pending = provider.create(brief);
  const assertion = assert.rejects(pending, (error: unknown) => error instanceof Error && "uncertain" in error && error.uncertain === true && !error.message.includes("private-key"));
  t.mock.timers.tick(20_000);
  await assertion; assert.equal(calls, 1);
});

test("only configured V6 models may issue requests", async () => {
  let calls = 0;
  const provider = createMusicProvider({ env: { ...env, MUSIC_MODEL: "V5" }, fetch: async () => { calls++; return Response.json({}); } });
  await assert.rejects(provider.create(brief)); assert.equal(calls, 0);
});

test("HTTP timeout or malformed submission receipt stays uncertain rather than inviting a new paid submission", async () => {
  for (const response of [new Response(null, { status: 408 }), new Response("broken", { status: 200 }), Response.json({ code: 200, data: {} })]) {
    const provider = createMusicProvider({ env, fetch: async () => response });
    await assert.rejects(provider.create(brief), (error: unknown) => error instanceof Error && "uncertain" in error && error.uncertain === true);
  }
});
