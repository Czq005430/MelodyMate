export function encodeWav(samples: Float32Array, sampleRate: number): ArrayBuffer {
  return encodeWavChannels([samples], sampleRate);
}

export function encodeWavChannels(channels: Float32Array[], sampleRate: number): ArrayBuffer {
  if (!Array.isArray(channels) || channels.length < 1 || channels.length > 2 || channels.some(channel => !(channel instanceof Float32Array) || !channel.length)) throw new Error("没有可导出的单声道或双声道音频");
  const length = channels[0].length, blockSize = channels.length * 2;
  if (channels.some(channel => channel.length !== length)) throw new Error("音频声道长度不一致");
  if (!Number.isInteger(sampleRate) || sampleRate <= 0 || sampleRate * blockSize > 0xffffffff) throw new Error("采样率无效");
  if (length * blockSize + 36 > 0xffffffff) throw new Error("音频超出 WAV 容量");
  const buffer = new ArrayBuffer(44 + length * blockSize);
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
  view.setUint16(22, channels.length, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockSize, true);
  view.setUint16(32, blockSize, true);
  view.setUint16(34, 16, true);
  writeText(36, "data");
  view.setUint32(40, length * blockSize, true);
  for (let index = 0; index < length; index++) for (let channel = 0; channel < channels.length; channel++) {
    if (!Number.isFinite(channels[channel][index])) throw new Error("音频 PCM 包含无效数值");
    const value = Math.max(-1, Math.min(1, channels[channel][index]));
    view.setInt16(44 + index * blockSize + channel * 2, Math.round(value * (value < 0 ? 32768 : 32767)), true);
  }
  return buffer;
}
