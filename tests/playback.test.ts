import assert from "node:assert/strict";
import test from "node:test";
import { AudioPlayer } from "../lib/audio-playback.ts";
import type { PlaybackContext } from "../lib/audio-playback.ts";

class FakeSource {
  buffer: AudioBuffer | null = null;
  onended: (() => void) | null = null;
  starts = 0;
  stops = 0;
  disconnects = 0;
  connect() {}
  disconnect() { this.disconnects++; }
  start() { this.starts++; }
  stop() { this.stops++; }
  finish() { this.onended?.(); }
}

class FakeContext {
  currentTime = 0;
  state: AudioContextState = "suspended";
  destination = {} as AudioDestinationNode;
  sources: FakeSource[] = [];
  resumes = 0;
  closes = 0;
  resume() { this.resumes++; this.state = "running"; return Promise.resolve(); }
  close() { this.closes++; this.state = "closed"; return Promise.resolve(); }
  createBufferSource() {
    const source = new FakeSource();
    this.sources.push(source);
    return source as unknown as AudioBufferSourceNode;
  }
}

const buffer = { duration: 2 } as AudioBuffer;

test("播放前必须解锁，unlock 立即创建并恢复上下文", async () => {
  const context = new FakeContext();
  let creations = 0;
  const player = new AudioPlayer(() => { creations++; return context; });
  assert.throws(() => player.play(buffer), /播放/);
  const ready = player.unlock();
  assert.equal(creations, 1);
  assert.equal(context.resumes, 1);
  await ready;
  await player.unlock();
  assert.equal(creations, 1);
  assert.equal(context.resumes, 1);
  player.play(buffer);
  assert.equal(context.sources[0].starts, 1);
});

test("新播放停止旧音源，旧结束回调不能影响当前播放", async () => {
  const context = new FakeContext();
  const player = new AudioPlayer(() => context);
  await player.unlock();
  let oldEnded = 0, newEnded = 0;
  player.play(buffer, () => oldEnded++);
  const first = context.sources[0];
  const queuedOldCallback = first.onended;
  player.play(buffer, () => newEnded++);
  assert.equal(first.stops, 1);
  assert.equal(first.disconnects, 1);
  assert.equal(context.sources.length, 2);
  queuedOldCallback?.();
  assert.equal(oldEnded, 0);
  context.sources[1].finish();
  assert.equal(newEnded, 1);
});

test("stop 幂等且不触发完成回调，elapsed 重置", async () => {
  const context = new FakeContext();
  const player = new AudioPlayer(() => context);
  await player.unlock();
  let ended = 0;
  player.play(buffer, () => ended++);
  context.currentTime = 0.75;
  assert.equal(player.elapsed, 0.75);
  const queued = context.sources[0].onended;
  player.stop();
  player.stop();
  queued?.();
  assert.equal(context.sources[0].stops, 1);
  assert.equal(ended, 0);
  assert.equal(player.elapsed, 0);
});

test("自然完成保留终点进度，close 释放上下文且可重新解锁", async () => {
  const contexts: FakeContext[] = [];
  const player = new AudioPlayer(() => { const context = new FakeContext(); contexts.push(context); return context; });
  await player.unlock();
  player.play(buffer);
  contexts[0].currentTime = 5;
  assert.equal(player.elapsed, 2);
  contexts[0].sources[0].finish();
  assert.equal(player.elapsed, 2);
  player.close();
  player.close();
  assert.equal(contexts[0].closes, 1);
  assert.throws(() => player.play(buffer), /播放/);
  await player.unlock();
  assert.equal(contexts.length, 2);
});

test("恢复被拒绝或仍 suspended 时不能显示成功播放", async () => {
  const context = new FakeContext();
  context.resume = () => Promise.reject(new Error("blocked"));
  const player = new AudioPlayer(() => context);
  await assert.rejects(player.unlock(), /播放/);
  assert.throws(() => player.play(buffer), /播放/);
  context.resume = () => Promise.resolve();
  await assert.rejects(player.unlock(), /播放/);
});

test("异步解锁期间关闭播放器，旧恢复结果失效", async () => {
  const context = new FakeContext();
  let finishResume!: () => void;
  context.resume = () => new Promise<void>((resolve) => { finishResume = resolve; });
  const player = new AudioPlayer(() => context as PlaybackContext);
  const pending = player.unlock();
  player.close();
  finishResume();
  await assert.rejects(pending, /播放/);
  assert.equal(context.closes, 1);
});
