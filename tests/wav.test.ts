import assert from "node:assert/strict";
import test from "node:test";
import { encodeWav, encodeWavChannels } from "../lib/wav.ts";

test("输出标准单声道 PCM16 WAV 头和正确数据长度", () => {
  const wav = encodeWav(new Float32Array(44100), 44100);
  const view = new DataView(wav);
  const text = (offset: number, length: number) => String.fromCharCode(...new Uint8Array(wav, offset, length));
  assert.equal(wav.byteLength, 44 + 44100 * 2);
  assert.equal(text(0, 4), "RIFF");
  assert.equal(text(8, 4), "WAVE");
  assert.equal(text(12, 4), "fmt ");
  assert.equal(text(36, 4), "data");
  assert.equal(view.getUint32(4, true), wav.byteLength - 8);
  assert.equal(view.getUint32(16, true), 16);
  assert.equal(view.getUint16(20, true), 1);
  assert.equal(view.getUint16(22, true), 1);
  assert.equal(view.getUint32(24, true), 44100);
  assert.equal(view.getUint32(28, true), 88200);
  assert.equal(view.getUint16(32, true), 2);
  assert.equal(view.getUint16(34, true), 16);
  assert.equal(view.getUint32(40, true), 88200);
});

test("PCM16 对称输入正确量化并保护溢出边界，不修改原数据", () => {
  const samples = new Float32Array([-2, -1, -0.5, 0, 0.5, 1, 2]);
  const view = new DataView(encodeWav(samples, 48000));
  assert.deepEqual(Array.from({ length: samples.length }, (_, index) => view.getInt16(44 + index * 2, true)),
    [-32768, -32768, -16384, 0, 16384, 32767, 32767]);
  assert.equal(view.getUint32(24, true), 48000);
  assert.equal(samples[0], -2);
});

test("WAV 拒绝非有限 PCM、空音频和无效采样率", () => {
  assert.throws(() => encodeWav(new Float32Array([NaN]), 44100), /PCM/);
  assert.throws(() => encodeWav(new Float32Array([Infinity]), 44100), /PCM/);
  assert.throws(() => encodeWav(new Float32Array(0), 44100), /音频/);
  assert.throws(() => encodeWav(new Float32Array([0]), 0), /采样率/);
});

test("双声道PCM16按左右交错，头部反映双声道帧大小", () => {
  const left = new Float32Array([1, -.5, 0]), right = new Float32Array([-.25, .5, -1]);
  const wav = encodeWavChannels([left, right], 48000), view = new DataView(wav);
  assert.equal(wav.byteLength, 56);
  assert.equal(view.getUint16(22, true), 2);
  assert.equal(view.getUint32(28, true), 192000);
  assert.equal(view.getUint16(32, true), 4);
  assert.equal(view.getUint32(40, true), 12);
  assert.deepEqual(Array.from({ length: 6 }, (_, i) => view.getInt16(44 + 2 * i, true)), [32767, -8192, -16384, 16384, 0, -32768]);
  assert.deepEqual(encodeWavChannels([left], 48000), encodeWav(left, 48000));
  assert.deepEqual(right, new Float32Array([-.25, .5, -1]));
});

test("多声道导出拒绝缺失、长度不齐和非有限的声道", () => {
  assert.throws(() => encodeWavChannels([], 44100), /声道|音频/);
  assert.throws(() => encodeWavChannels([new Float32Array(1), new Float32Array(2)], 44100), /声道|长度/);
  assert.throws(() => encodeWavChannels([new Float32Array(1), new Float32Array([NaN])], 44100), /PCM/);
  assert.throws(() => encodeWavChannels([new Float32Array(1)], 0), /采样率/);
});
