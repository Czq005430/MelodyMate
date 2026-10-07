import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { createMusicJobs } from "../lib/music-jobs.ts";
import type { MusicJobRequest } from "../lib/music-types.ts";

const request = (): MusicJobRequest => ({ requestId: randomUUID(), projectRevision: 0, sourceIds: ["source-a"], brief: { prompt: "安静钢琴", bpm: 100, durationSec: 150, sourceLabels: ["杯子"] } });
const env = { MUSIC_API_KEY: "private-key", MUSIC_MAX_JOBS_PER_DAY: "2" };
async function directory(t: { after: (fn: () => Promise<void>) => void }) {
  const path = await mkdtemp(join(tmpdir(), "melody-music-")); t.after(() => rm(path, { recursive: true, force: true })); return path;
}

test("simultaneous duplicate requests reserve before network, submit once and reject a changed snapshot", async (t) => {
  const dir = await directory(t); let calls = 0; let finish!: (response: Response) => void;
  const jobs = createMusicJobs({ env: { ...env, MUSIC_DATA_DIR: dir }, fetch: async () => {
    calls++; const stored = JSON.parse(await readFile(join(dir, "jobs.json"), "utf8"));
    assert.equal(stored.jobs[0].job.status, "submitting");
    return new Promise((resolve) => { finish = resolve; });
  } });
  const body = request(); const first = jobs.create(body);
  while (!finish) await new Promise((resolve) => setImmediate(resolve));
  const duplicate = await jobs.create(body); assert.equal(duplicate.status, "submitting");
  await assert.rejects(jobs.create({ ...body, projectRevision: 1 }), (error: unknown) => error instanceof Error && "status" in error && error.status === 409);
  await assert.rejects(jobs.create(request()), (error: unknown) => error instanceof Error && "status" in error && error.status === 429);
  finish(Response.json({ code: 200, data: { taskId: "remote-a" } }));
  assert.equal((await first).id, duplicate.id); assert.equal(calls, 1);
});

test("unknown submission survives restart without a second paid request", async (t) => {
  const dir = await directory(t); let calls = 0;
  const options = { env: { ...env, MUSIC_DATA_DIR: dir }, fetch: async () => { calls++; throw new Error("private network detail"); } };
  const body = request(); const job = await createMusicJobs(options).create(body);
  assert.equal(job.status, "unknown"); assert.doesNotMatch(job.message, /private/);
  const stored = JSON.parse(await readFile(join(dir, "jobs.json"), "utf8"));
  stored.jobs[0].job.status = "submitting";
  await writeFile(join(dir, "jobs.json"), JSON.stringify(stored));
  const restarted = createMusicJobs(options);
  assert.equal((await restarted.get(job.id)).status, "unknown");
  assert.equal((await restarted.create(body)).id, job.id); assert.equal(calls, 1);
});

test("failed polls and failed cache writes can be retried without generating again", async (t) => {
  const dir = await directory(t); let creates = 0; let polls = 0; let downloads = 0;
  const jobs = createMusicJobs({ env: { ...env, MUSIC_DATA_DIR: dir }, fetch: async (url) => {
    if (String(url).includes("createTask")) { creates++; return Response.json({ code: 200, data: { taskId: "task" } }); }
    if (String(url).includes("recordInfo")) {
      polls++; if (polls === 1) throw new Error("query interrupted");
      return Response.json({ code: 200, data: { state: "success", resultJson: JSON.stringify({ resultUrls: ["https://cdn1.suno.ai/a.mp3", "https://cdn2.suno.ai/b.mp3"] }) } });
    }
    downloads++; if (downloads === 1) throw new Error("download interrupted");
    return new Response(new Uint8Array([73, 68, 51, 4, 0, 0, 1]), { headers: { "content-type": "audio/mpeg" } });
  } });
  const initial = await jobs.create(request());
  const retryPoll = await jobs.get(initial.id); assert.equal(retryPoll.status, "pending"); assert.match(retryPoll.message, /重试/);
  assert.equal((await jobs.get(initial.id)).status, "generating");
  const ready = await jobs.get(initial.id); assert.equal(ready.status, "ready"); assert.equal(ready.candidates.length, 2);
  assert.equal(ready.candidates[0].audioUrl, `/api/music/jobs/${ready.id}/audio/0`);
  assert.equal(creates, 1); assert.equal(polls, 2);
  assert.ok((await jobs.audio(ready.id, 0)).bytes.byteLength > 0);
  await assert.rejects(jobs.audio("../../jobs.json", 0));
  await assert.rejects(jobs.audio(ready.id, 9));
  const disk = await readdir(dir); assert.ok(disk.includes("jobs.json"));
  assert.doesNotMatch(JSON.stringify(ready), /cdn1|private-key|remote-a/);
});

test("daily pre-reservations persist across restart and failed tasks still count", async (t) => {
  const dir = await directory(t); let now = Date.UTC(2026, 9, 7); let calls = 0;
  const options = { env: { ...env, MUSIC_DATA_DIR: dir }, clock: () => now, fetch: async () => { calls++; return Response.json({ code: 400, msg: "private error" }); } };
  assert.equal((await createMusicJobs(options).create(request())).status, "failed");
  assert.equal((await createMusicJobs(options).create(request())).status, "failed");
  const restarted = createMusicJobs(options);
  await assert.rejects(restarted.create(request()), (error: unknown) => error instanceof Error && "status" in error && error.status === 429);
  assert.equal(calls, 2); now += 86_400_000;
  assert.equal((await restarted.create(request())).status, "failed"); assert.equal(calls, 3);
});

test("invalid persisted budget cannot silently reset to an empty store", async (t) => {
  const dir = await directory(t); await writeFile(join(dir, "jobs.json"), "broken"); let calls = 0;
  const jobs = createMusicJobs({ env: { ...env, MUSIC_DATA_DIR: dir }, fetch: async () => { calls++; return Response.json({}); } });
  await assert.rejects(jobs.create(request())); assert.equal(calls, 0);
});

test("a real local audio rename failure is recoverable after restart without another create or remote poll", async (t) => {
  const dir = await directory(t); let creates = 0; let polls = 0;
  const options = { env: { ...env, MUSIC_DATA_DIR: dir }, fetch: async (url: string | URL | Request) => {
    if (String(url).includes("createTask")) { creates++; return Response.json({ code: 200, data: { taskId: "task" } }); }
    if (String(url).includes("recordInfo")) { polls++; return Response.json({ code: 200, data: { state: "success", resultJson: JSON.stringify({ resultUrls: ["https://cdn1.suno.ai/a.mp3"] }) } }); }
    return new Response(new Uint8Array([73, 68, 51, 4, 0, 0, 1]), { headers: { "content-type": "audio/mpeg" } });
  } };
  const jobs = createMusicJobs(options); const initial = await jobs.create(request());
  const destination = join(dir, `${initial.id}-0.audio`); await mkdir(destination);
  const incomplete = await jobs.get(initial.id); assert.equal(incomplete.status, "generating"); assert.match(incomplete.message, /重试保存/);
  await rm(destination, { recursive: true });
  assert.equal((await createMusicJobs(options).get(initial.id)).status, "ready");
  assert.equal(creates, 1); assert.equal(polls, 1);
});

test("expired URL A refreshes the same remote task to B and preserves an already cached matching asset", async (t) => {
  const dir = await directory(t); let creates = 0; let polls = 0; const downloaded: string[] = [];
  const firstBytes = new Uint8Array([73, 68, 51, 4, 0, 0, 10]); const secondBytes = new Uint8Array([73, 68, 51, 4, 0, 0, 20]);
  const jobs = createMusicJobs({ env: { ...env, MUSIC_DATA_DIR: dir }, fetch: async (url) => {
    if (String(url).includes("createTask")) { creates++; return Response.json({ code: 200, data: { taskId: "same-task" } }); }
    if (String(url).includes("recordInfo")) {
      polls++; assert.match(String(url), /taskId=same-task$/);
      return Response.json({ code: 200, data: { state: "success", resultJson: JSON.stringify({ data: [
        { id: "first", audio_url: `https://cdn1.suno.ai/first-${polls}.mp3` },
        { id: "second", audio_url: `https://cdn1.suno.ai/${polls === 1 ? "A" : "B"}.mp3` },
      ] }) } });
    }
    downloaded.push(String(url));
    if (String(url).endsWith("/A.mp3")) return new Response(null, { status: 403 });
    return new Response(String(url).includes("first-") ? firstBytes : secondBytes, { headers: { "content-type": "audio/mpeg" } });
  } });
  const initial = await jobs.create(request()); const ready = await jobs.get(initial.id);
  assert.equal(ready.status, "ready"); assert.equal(creates, 1); assert.equal(polls, 2);
  assert.deepEqual(downloaded, ["https://cdn1.suno.ai/first-1.mp3", "https://cdn1.suno.ai/A.mp3", "https://cdn1.suno.ai/B.mp3"]);
  assert.deepEqual((await jobs.audio(ready.id, 0)).bytes, firstBytes); assert.deepEqual((await jobs.audio(ready.id, 1)).bytes, secondBytes);
});

test("persistent expired URLs become terminal, retain the budget and release the active slot", async (t) => {
  const dir = await directory(t); let creates = 0; let polls = 0; let downloads = 0;
  const options = { env: { ...env, MUSIC_DATA_DIR: dir }, fetch: async (url: string | URL | Request) => {
    if (String(url).includes("createTask")) { creates++; return Response.json({ code: 200, data: { taskId: `task-${creates}` } }); }
    if (String(url).includes("recordInfo")) { polls++; return Response.json({ code: 200, data: { state: "success", resultJson: JSON.stringify({ resultUrls: ["https://cdn1.suno.ai/expired.mp3"] }) } }); }
    downloads++; return new Response(null, { status: 404 });
  } };
  const jobs = createMusicJobs(options); const initial = await jobs.create(request());
  const failed = await jobs.get(initial.id); assert.equal(failed.status, "failed"); assert.match(failed.message, /失效|过期/);
  assert.equal(creates, 1); assert.equal(polls, 2); assert.equal(downloads, 2);
  const restarted = createMusicJobs(options); assert.equal((await restarted.get(initial.id)).status, "failed");
  assert.equal(polls, 2); assert.equal(downloads, 2);
  const next = await restarted.create(request()); assert.equal(next.status, "pending");
  assert.equal((await restarted.get(next.id)).status, "failed");
  await assert.rejects(restarted.create(request()), (error: unknown) => error instanceof Error && "code" in error && error.code === "MUSIC_DAILY_LIMIT");
  assert.equal(creates, 2);
});

test("a refreshed list with different track identities cannot reuse old bytes by index", async (t) => {
  const dir = await directory(t); let polls = 0;
  const jobs = createMusicJobs({ env: { ...env, MUSIC_DATA_DIR: dir }, fetch: async (url) => {
    if (String(url).includes("createTask")) return Response.json({ code: 200, data: { taskId: "task" } });
    if (String(url).includes("recordInfo")) {
      polls++; return Response.json({ code: 200, data: { state: "success", resultJson: JSON.stringify({ resultUrls: polls === 1
        ? ["https://cdn1.suno.ai/old.mp3", "https://cdn1.suno.ai/expired.mp3"] : ["https://cdn1.suno.ai/new.mp3"] }) } });
    }
    if (String(url).endsWith("expired.mp3")) return new Response(null, { status: 410 });
    return new Response(new Uint8Array([73, 68, 51, 4, 0, 0, String(url).endsWith("new.mp3") ? 30 : 10]), { headers: { "content-type": "audio/mpeg" } });
  } });
  const initial = await jobs.create(request()); const ready = await jobs.get(initial.id);
  assert.equal(ready.status, "ready"); assert.equal(ready.candidates.length, 1);
  assert.equal((await jobs.audio(ready.id, 0)).bytes[6], 30);
});

test("a temporary refresh query failure survives restart and later saves the paid result without another create", async (t) => {
  const dir = await directory(t); let creates = 0; let polls = 0;
  const options = { env: { ...env, MUSIC_DATA_DIR: dir }, fetch: async (url: string | URL | Request) => {
    if (String(url).includes("createTask")) { creates++; return Response.json({ code: 200, data: { taskId: "paid-task" } }); }
    if (String(url).includes("recordInfo")) {
      polls++; assert.match(String(url), /taskId=paid-task$/);
      if (polls === 2) return new Response(null, { status: 500 });
      return Response.json({ code: 200, data: { state: "success", resultJson: JSON.stringify({ resultUrls: [`https://cdn1.suno.ai/${polls === 1 ? "A" : "B"}.mp3`] }) } });
    }
    if (String(url).endsWith("/A.mp3")) return new Response(null, { status: 403 });
    return new Response(new Uint8Array([73, 68, 51, 4, 0, 0, 40]), { headers: { "content-type": "audio/mpeg" } });
  } };
  const jobs = createMusicJobs(options); const initial = await jobs.create(request());
  const interrupted = await jobs.get(initial.id); assert.equal(interrupted.status, "generating"); assert.match(interrupted.message, /重试/);
  const persisted = JSON.parse(await readFile(join(dir, "jobs.json"), "utf8"));
  assert.notEqual(persisted.jobs[0].refreshedDownloadUrls, true);
  const restarted = createMusicJobs(options); const ready = await restarted.get(initial.id);
  assert.equal(ready.status, "ready"); assert.equal(creates, 1); assert.equal(polls, 3);
  assert.equal((await restarted.audio(initial.id, 0)).bytes[6], 40);
});
