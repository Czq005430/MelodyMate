export function createDemoSample(kind: "glass" | "wood" | "shaker"): AudioBuffer {
  if (!["glass", "wood", "shaker"].includes(kind)) throw new Error("示例声音不存在");
  const sampleRate = 44100;
  const buffer = new AudioBuffer({ numberOfChannels: 1, length: Math.round(sampleRate * 1.5), sampleRate });
  const samples = buffer.getChannelData(0);
  const start = Math.round(sampleRate * 0.25);
  for (let index = start; index < samples.length; index++) {
    const time = (index - start) / sampleRate;
    const attack = Math.min(1, time / 0.001);
    let value: number;
    if (kind === "glass") {
      value = Math.sin(2 * Math.PI * 523.25 * time) * Math.exp(-12 * time)
        + 0.35 * Math.sin(2 * Math.PI * 1391 * time) * Math.exp(-25 * time);
    } else if (kind === "wood") {
      value = Math.sin(2 * Math.PI * 170 * time) * Math.exp(-40 * time)
        + 0.4 * Math.sin(2 * Math.PI * 420 * time) * Math.exp(-70 * time);
    } else {
      value = [1733, 2903, 4709, 7307, 10193].reduce((sum, frequency) =>
        sum + Math.sin(2 * Math.PI * (frequency * time + 500 * time * time)), 0) / 3;
      value *= Math.exp(-18 * time);
    }
    samples[index] = 0.5 * attack * value;
  }
  return buffer;
}
