import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { createMusicHandlers } from "../lib/music-handler.ts";

const origin = "http://127.0.0.1:3000";
const env = { APP_ORIGIN: origin, DEMO_ACCESS_TOKEN: "test-demo", MUSIC_API_KEY: "private-key" };
const body = () => ({ requestId: randomUUID(), projectRevision: 0, sourceIds: ["s-a"], brief: { prompt: "轻柔钢琴", bpm: 100, durationSec: 150, sourceLabels: ["杯子"] } });
function request(value: unknown = body(), headers: Record<string, string> = {}) {
  return new Request(`${origin}/api/music/jobs`, { method: "POST", headers: { origin, "x-demo-token": "test-demo", "content-type": "application/json", ...headers }, body: JSON.stringify(value) });
}
async function setup(t: { after: (fn: () => Promise<void>) => void }) {
  const dir = await mkdtemp(join(tmpdir(), "music-handler-")); t.after(() => rm(dir, { recursive: true, force: true })); return dir;
}

test("music configuration is public, honest without a key and never exposes secrets or paths", async () => {
  for (const config of [{}, env, { ...env, MUSIC_MODEL: "V5" }, { ...env, DEMO_ACCESS_TOKEN: "replace-with-a-private-demo-password" }]) {
    const handlers = createMusicHandlers({ env: config });
    const response = await handlers.config(new Request(`${origin}/api/music/config`));
    const result = await response.json(); assert.equal(result.configured, config === env);
    assert.equal(result.provider, "kie"); assert.equal(result.maxJobsPerDay, 12);
    assert.doesNotMatch(JSON.stringify(result), /private-key|test-demo|\.music-data/);
    assert.equal(response.headers.get("cache-control"), "no-store");
  }
});

test("create rejects missing origin, wrong token, malformed and oversized bodies before provider calls", async (t) => {
  let calls = 0; const handlers = createMusicHandlers({ env: { ...env, MUSIC_DATA_DIR: await setup(t) }, fetch: async () => { calls++; throw new Error("unexpected"); } });
  const missing = request(); missing.headers.delete("origin");
  assert.equal((await handlers.create(missing)).status, 403);
  assert.equal((await handlers.create(request(body(), { "x-demo-token": "wrong" }))).status, 403);
  assert.equal((await handlers.create(request({ ...body(), rawAudio: "forbidden" }))).status, 400);
  assert.equal((await handlers.create(request({ ...body(), brief: { ...body().brief, prompt: "声".repeat(6000) } }, { "content-length": "1" }))).status, 413);
  for (const value of [
    { ...body(), requestId: "not-a-uuid" }, { ...body(), projectRevision: -1 },
    { ...body(), sourceIds: ["a", "b", "c", "d"] },
    { ...body(), brief: { ...body().brief, bpm: 59 } },
    { ...body(), brief: { ...body().brief, durationSec: 121 } },
    { ...body(), brief: { ...body().brief, prompt: "声".repeat(601) } },
    { ...body(), brief: { ...body().brief, sourceLabels: ["声".repeat(61)] } },
  ]) assert.equal((await handlers.create(request(value))).status, 400);
  assert.equal(calls, 0);
});

test("403 分别说明地址不一致与口令不正确，便于用户自查", async (t) => {
  const handlers = createMusicHandlers({ env: { ...env, MUSIC_DATA_DIR: await setup(t) } });
  const denied = async (headers: Record<string, string>) => (await (await handlers.create(request(body(), headers))).json()).error;
  const wrongHost = await denied({ origin: "http://192.168.1.20:3000" });
  assert.equal(wrongHost.code, "MUSIC_ACCESS_DENIED");
  assert.match(wrongHost.message, /APP_ORIGIN 不一致/); assert.match(wrongHost.message, /127\.0\.0\.1:3000/);
  const wrongToken = await denied({ "x-demo-token": "wrong" });
  assert.equal(wrongToken.code, "MUSIC_ACCESS_DENIED");
  assert.match(wrongToken.message, /演示口令不正确/); assert.match(wrongToken.message, /DEMO_ACCESS_TOKEN/);
  assert.doesNotMatch(`${wrongHost.message}${wrongToken.message}`, /private-key|test-demo/);
});

test("回环地址互为等价来源，localhost 打开的页面不再被 403", async (t) => {
  const fetcher = async () => Response.json({ code: 200, data: { taskId: "upstream-private-id" } });
  for (const host of ["localhost", "127.0.0.1", "[::1]"]) {
    const handlers = createMusicHandlers({ env: { ...env, MUSIC_DATA_DIR: await setup(t) }, fetch: fetcher });
    assert.equal((await handlers.create(request(body(), { origin: `http://${host}:3000` }))).status, 202);
  }
  const blocked = createMusicHandlers({ env: { ...env, MUSIC_DATA_DIR: await setup(t) }, fetch: fetcher });
  assert.equal((await blocked.create(request(body(), { origin: "http://127.0.0.1:3001" }))).status, 403);
  assert.equal((await blocked.create(request(body(), { origin: "https://127.0.0.1:3000" }))).status, 403);
});

test("jobs 列表需要口令，返回最近任务摘要且不含敏感信息", async (t) => {
  const dir = await setup(t);
  const fetcher = async () => Response.json({ code: 200, data: { taskId: "upstream-private-id" } });
  const handlers = createMusicHandlers({ env: { ...env, MUSIC_DATA_DIR: dir }, fetch: fetcher });
  const bare = new Request(`${origin}/api/music/jobs`, { headers: { origin } });
  assert.equal((await handlers.list(bare)).status, 403);
  const listed = new Request(`${origin}/api/music/jobs`, { headers: { origin, "x-demo-token": "test-demo", "sec-fetch-site": "same-origin" } });
  assert.deepEqual((await (await handlers.list(listed)).json()).jobs, []);
  assert.equal((await handlers.create(request(body()))).status, 202);
  const after = (await (await handlers.list(listed)).json()).jobs;
  assert.equal(after.length, 1);
  assert.equal(after[0].continued, false); assert.equal(after[0].candidates, 0);
  assert.match(after[0].prompt, /轻柔钢琴/);
  assert.doesNotMatch(JSON.stringify(after), /private-key|test-demo|upstream-private-id/);
});

test("GET without Origin requires same-origin Fetch Metadata plus matching request URL and token", async (t) => {
  const handlers = createMusicHandlers({ env: { ...env, MUSIC_DATA_DIR: await setup(t) } });
  const id = randomUUID();
  const get = (url: string, headers: Record<string, string>) => handlers.get(new Request(url, { headers }), id);
  assert.equal((await get(`${origin}/api/music/jobs/${id}`, { "x-demo-token": "test-demo", "sec-fetch-site": "same-origin" })).status, 404);
  for (const site of ["cross-site", "same-site", "none", ""]) {
    assert.equal((await get(`${origin}/api/music/jobs/${id}`, { "x-demo-token": "test-demo", "sec-fetch-site": site })).status, 403);
  }
  assert.equal((await get(`https://wrong.example/api/music/jobs/${id}`, { "x-demo-token": "test-demo", "sec-fetch-site": "same-origin" })).status, 403);
  assert.equal((await get(`${origin}/api/music/jobs/${id}`, { origin, "sec-fetch-site": "cross-site", "x-demo-token": "test-demo" })).status, 403);
});

test("202 response preserves the snapshot; repeat returns same job and conflict returns 409", async (t) => {
  let calls = 0; const handlers = createMusicHandlers({ env: { ...env, MUSIC_DATA_DIR: await setup(t) }, fetch: async () => {
    calls++; return Response.json({ code: 200, data: { taskId: "upstream-private-id" } });
  } });
  const snapshot = body(); const first = await handlers.create(request(snapshot)); assert.equal(first.status, 202);
  const job = await first.json(); assert.equal(job.projectRevision, 0); assert.deepEqual(job.sourceIds, snapshot.sourceIds);
  assert.equal((await (await handlers.create(request(snapshot))).json()).id, job.id);
  assert.equal((await handlers.create(request({ ...snapshot, brief: { ...snapshot.brief, bpm: 120 } }))).status, 409);
  assert.equal(calls, 1); assert.doesNotMatch(JSON.stringify(job), /private-key|upstream-private-id/);
});

test("audio route applies authorization before accessing private cache", async (t) => {
  const handlers = createMusicHandlers({ env: { ...env, MUSIC_DATA_DIR: await setup(t) } });
  assert.equal((await handlers.audio(new Request(`${origin}/api/music/jobs/x/audio/0`), "x", "0")).status, 403);
  assert.equal((await handlers.audio(new Request(`${origin}/api/music/jobs/x/audio/0`, { headers: { origin, "x-demo-token": "test-demo" } }), "../../jobs.json", "0")).status, 404);
});

test("a generated audio file is served only through the authenticated local candidate URL", async (t) => {
  const audio = new Uint8Array([73, 68, 51, 4, 0, 0, 1]);
  const handlers = createMusicHandlers({ env: { ...env, MUSIC_DATA_DIR: await setup(t) }, fetch: async (url) => {
    if (String(url).includes("createTask")) return Response.json({ code: 200, data: { taskId: "task" } });
    if (String(url).includes("recordInfo")) return Response.json({ code: 200, data: { state: "success", resultJson: JSON.stringify({ resultUrls: ["https://cdn1.suno.ai/a.mp3"] }) } });
    return new Response(audio, { headers: { "content-type": "audio/mpeg" } });
  } });
  const created = await (await handlers.create(request())).json();
  const auth = { "x-demo-token": "test-demo", "sec-fetch-site": "same-origin" };
  const ready = await (await handlers.get(new Request(`${origin}/api/music/jobs/${created.id}`, { headers: auth }), created.id)).json();
  const response = await handlers.audio(new Request(`${origin}${ready.candidates[0].audioUrl}`, { headers: auth }), created.id, "0");
  assert.equal(response.status, 200); assert.equal(response.headers.get("content-type"), "audio/mpeg");
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()), audio);
});

const clip = { url: "https://tempfile.redpandaai.co/kie-ai/melodymate/clip.wav", seconds: 120, continueAt: 30 };
const extendBody = (over: Record<string, unknown> = {}) => ({ ...body(), clip: { ...clip, ...over } });

test("extend 拒绝起点超出素材时长、外部域名、缺字段与多余字段，且一次都不调用服务商", async (t) => {
  let calls = 0;
  const handlers = createMusicHandlers({ env: { ...env, MUSIC_DATA_DIR: await setup(t) }, fetch: async () => { calls++; throw new Error("unexpected"); } });
  const post = (value: unknown) => handlers.extend(request(value));
  assert.equal((await post({ ...body() })).status, 400);
  assert.equal((await post(extendBody({ seconds: 9.6, continueAt: 6 }))).status, 400);
  assert.equal((await post(extendBody({ seconds: 120, continueAt: 200 }))).status, 400);
  assert.equal((await post(extendBody({ seconds: 120, continueAt: 120 }))).status, 400);
  assert.equal((await post(extendBody({ seconds: 120, continueAt: 0 }))).status, 400);
  assert.match(((await (await post(extendBody({ seconds: 120, continueAt: 200 }))).json()).error).message, /续写起点/);
  assert.equal((await post(extendBody({ url: "https://evil.example/a.wav" }))).status, 400);
  assert.equal((await post(extendBody({ url: "http://tempfile.redpandaai.co/a.wav" }))).status, 400);
  assert.equal((await post(extendBody({ seconds: 600 }))).status, 400);
  const noToken = request(extendBody()); noToken.headers.delete("x-demo-token");
  assert.equal((await handlers.extend(noToken)).status, 403);
  assert.equal((await post({ ...extendBody(), clip: { ...clip, extra: 1 } })).status, 400);
  assert.equal((await post({ ...extendBody(), rawAudio: "forbidden" })).status, 400);
  assert.equal(calls, 0);
});

test("extend 提交素材地址与续写起点，不提交时长；换起点即视为另一份请求", async (t) => {
  const sent: string[] = [];
  const handlers = createMusicHandlers({ env: { ...env, MUSIC_DATA_DIR: await setup(t) }, fetch: async (url, init) => {
    sent.push(`${url}|${(init as { body?: string } | undefined)?.body ?? ""}`);
    return Response.json({ code: 200, data: { taskId: "upstream-task" } });
  } });
  const snapshot = extendBody();
  const created = await (await handlers.extend(request(snapshot))).json();
  assert.equal(created.status, "pending");
  assert.equal(created.clip.continueAt, 30);
  assert.match(sent[0], /upload-and-extend-audio/);
  assert.match(sent[0], /continue_at/);
  assert.match(sent[0], /upload_url/);
  assert.doesNotMatch(sent[0], /"duration"/);
  assert.doesNotMatch(JSON.stringify(created), /private-key|upstream-task/);
  assert.equal((await handlers.extend(request({ ...snapshot, clip: { ...clip, continueAt: 45 } }))).status, 409);
  assert.equal(sent.length, 1);
});

test("uploads 要求口令、音频类型与真实音频字节，未配置时绝不上传", async (t) => {
  let calls = 0;
  const handlers = createMusicHandlers({ env: { ...env, MUSIC_DATA_DIR: await setup(t) }, fetch: async () => { calls++; throw new Error("unexpected"); } });
  const text = new TextEncoder();
  const wav = new Uint8Array([...text.encode("RIFF"), 44, 0, 0, 0, ...text.encode("WAVEfmt ")]);
  const upload = (bodyInit: BodyInit, type: string) => handlers.upload(new Request(`${origin}/api/music/uploads`, {
    method: "POST", headers: { origin, "x-demo-token": "test-demo", "content-type": type }, body: bodyInit,
  }));
  assert.equal((await handlers.upload(new Request(`${origin}/api/music/uploads`, { method: "POST", body: wav }))).status, 403);
  assert.equal((await upload(wav, "text/plain")).status, 415);
  assert.equal((await upload(new Uint8Array([1, 2, 3, 4]), "audio/wav")).status, 400);
  assert.equal((await upload(new Uint8Array([]), "audio/wav")).status, 400);
  assert.equal(calls, 0);
});
