import type { ArrangementEvent, MusicParams } from "./types.ts";

export function expandArrangement(params: MusicParams): ArrangementEvent[] {
  if (!params || ![80, 100, 120].includes(params.bpm)) throw new Error("速度仅支持 80、100 或 120 BPM");
  if (!Array.isArray(params.steps) || params.steps.length !== 16 ||
    !params.steps.every((step) => step === 0 || step === 1) || !params.steps.includes(1)) {
    throw new Error("节奏须包含 16 格且至少有一个声音");
  }
  if (!["repeat", "mini"].includes(params.structurePreset)) throw new Error("音乐结构无效");
  const active = params.steps.flatMap((value, step) => value ? [step] : []);
  const events: ArrangementEvent[] = [];
  for (let bar = 0; bar < 4; bar++) {
    let selected = active;
    if (params.structurePreset === "mini" && bar === 0) selected = active.filter((_, index) => index % 2 === 0);
    if (params.structurePreset === "mini" && bar === 3) {
      selected = active.filter((step) => step < 12);
      if (!selected.length) selected = [0];
    }
    selected.forEach((step, index) => {
      const velocity = params.structurePreset === "repeat" ? 1 : bar === 0 ? 0.8 : bar === 2 && index % 2 === 0 ? 0.7 : 1;
      events.push({ bar, step, time: (bar * 4 + step / 4) * 60 / params.bpm, velocity });
    });
  }
  return events;
}
