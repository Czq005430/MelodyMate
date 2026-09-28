export function encodeWav(samples: Float32Array, sampleRate: number): ArrayBuffer {
  if (!(samples instanceof Float32Array) || !samples.length) throw new Error("没有可导出的音频");
  if (!Number.isInteger(sampleRate) || sampleRate <= 0 || sampleRate * 2 > 0xffffffff) throw new Error("采样率无效");
  if (samples.length * 2 + 36 > 0xffffffff) throw new Error("音频超出 WAV 容量");
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const writeText = (offset: number, text: string) => {
    for (let index = 0; index < text.length; index++) view.setUint8(offset + index, text.charCodeAt(index));
  };
  writeText(0, "RIFF");
  view.setUint32(4, buffer.byteLength - 8, true);
  writeText(8, "WAVE");
  writeText(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeText(36, "data");
  view.setUint32(40, samples.length * 2, true);
  for (let index = 0; index < samples.length; index++) {
    if (!Number.isFinite(samples[index])) throw new Error("音频 PCM 包含无效数值");
    const value = Math.max(-1, Math.min(1, samples[index]));
    view.setInt16(44 + index * 2, Math.round(value * (value < 0 ? 32768 : 32767)), true);
  }
  return buffer;
}
