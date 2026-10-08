import type { SongPlan, SongSection, SoundRole } from "./song-types.ts";

const ROLES: SoundRole[] = ["pulse", "accent", "texture"];
const numberSchema = (minimum: number, maximum: number, integer = false) => ({ type: integer ? "integer" : "number", minimum, maximum });
const objectSchema = (properties: Record<string, unknown>) => ({ type: "object", properties, required: Object.keys(properties), additionalProperties: false as const });
const titleSchema = { type: "string", minLength: 1, maxLength: 60, pattern: "\\S" };
const patternSchema = { type: "array", minItems: 16, maxItems: 16, items: numberSchema(0, 1), contains: { type: "number", exclusiveMinimum: 0 } };
export const SONG_PLAN_SCHEMA = {
  ...objectSchema({ version: { const: 1 }, title: titleSchema, bpm: numberSchema(72, 128), key: numberSchema(0, 11, true), scale: { enum: ["major", "minor"] },
    patterns: objectSchema({ pulse: patternSchema, accent: patternSchema, texture: patternSchema }),
    mix: objectSchema({ source: numberSchema(.5, 1), piano: numberSchema(0, .5), bass: numberSchema(0, .3), pad: numberSchema(0, .25) }),
    sections: { type: "array", minItems: 4, maxItems: 8, items: objectSchema({
      id: { type: "string", minLength: 1, maxLength: 40, pattern: "^\\S+$" }, title: titleSchema,
      bars: { ...numberSchema(4, 32, true), multipleOf: 4 }, energy: numberSchema(.15, 1),
      chords: { type: "array", minItems: 1, maxItems: 8, items: numberSchema(1, 7, true) },
      piano: { enum: ["off", "chords", "arpeggio"] }, bass: { type: "boolean" }, pad: { type: "boolean" },
      sourceRoles: { type: "array", maxItems: 3, uniqueItems: true, items: { enum: ROLES } },
    }) },
  }),
  description: "完整乐谱。额外跨字段规则：总时长120至180秒；段落id唯一；首末段保留原声；每段至少有一个音量非零的声部。和弦为调式内1至7级，每个级数通常保持两小节，末段最后一小节采用最后一个级数收尾。",
};

function object(value: unknown, keys: string[], label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value)) ||
    Reflect.ownKeys(value).length !== keys.length || !keys.every(key => Object.hasOwn(value, key))) throw new Error(`${label}字段不完整或包含未知字段`);
  return value as Record<string, unknown>;
}
function numeric(value: unknown, min: number, max: number, label: string, integer = false): asserts value is number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value))) throw new Error(`${label}超出范围`);
}
function text(value: unknown, max: number, label: string): asserts value is string {
  if (typeof value !== "string" || !value.trim() || [...value].length > max) throw new Error(`${label}长度不正确`);
}
function list(value: unknown, min: number, max: number, label: string): asserts value is unknown[] {
  if (!Array.isArray(value) || value.length < min || value.length > max || Reflect.ownKeys(value).length !== value.length + 1 ||
    !Array.from({ length: value.length }, (_, i) => Object.hasOwn(value, i)).every(Boolean)) throw new Error(`${label}数组大小或内容不正确`);
}
const durationOf = (plan: SongPlan) => plan.sections.reduce((sum, section) => sum + section.bars, 0) * 240 / plan.bpm;

export function validateSongPlan(value: unknown): SongPlan {
  const p = object(value, ["version", "title", "bpm", "key", "scale", "patterns", "mix", "sections"], "乐谱");
  if (p.version !== 1 || !["major", "minor"].includes(p.scale as string)) throw new Error("乐谱版本或调式不正确");
  text(p.title, 60, "作品名称"); numeric(p.bpm, 72, 128, "速度"); numeric(p.key, 0, 11, "调性", true);
  const patterns = object(p.patterns, ROLES, "原声动机");
  for (const role of ROLES) {
    const values = patterns[role]; list(values, 16, 16, "原声动机");
    values.forEach(value => numeric(value, 0, 1, "节奏力度"));
    if (!values.some(value => Number(value) > 0)) throw new Error("每个原声动机至少保留一个声音");
  }
  const mix = object(p.mix, ["source", "piano", "bass", "pad"], "混音");
  numeric(mix.source, .5, 1, "原声音量"); numeric(mix.piano, 0, .5, "钢琴音量"); numeric(mix.bass, 0, .3, "低音音量"); numeric(mix.pad, 0, .25, "铺底音量");
  list(p.sections, 4, 8, "段落"); const ids = new Set<string>();
  p.sections.forEach((value, index) => {
    const section = object(value, ["id", "title", "bars", "energy", "chords", "piano", "bass", "pad", "sourceRoles"], "段落");
    text(section.id, 40, "段落标识"); text(section.title, 60, "段落名称");
    if (/\s/u.test(section.id) || ids.has(section.id)) throw new Error("段落标识须唯一且不能包含空白"); ids.add(section.id);
    numeric(section.bars, 4, 32, "小节数", true); if (section.bars % 4) throw new Error("小节数必须为4的倍数");
    numeric(section.energy, .15, 1, "段落强度"); list(section.chords, 1, 8, "和弦级数"); section.chords.forEach(degree => numeric(degree, 1, 7, "和弦级数", true));
    if (!["off", "chords", "arpeggio"].includes(section.piano as string) || typeof section.bass !== "boolean" || typeof section.pad !== "boolean") throw new Error("段落配器不正确");
    list(section.sourceRoles, 0, 3, "原声角色");
    if (new Set(section.sourceRoles).size !== section.sourceRoles.length || section.sourceRoles.some(role => !ROLES.includes(role as SoundRole))) throw new Error("原声角色不正确或重复");
    if ((index === 0 || index === (p.sections as unknown[]).length - 1) && !section.sourceRoles.length) throw new Error("首末段必须保留原声");
    if (!section.sourceRoles.length && !(section.piano !== "off" && Number(mix.piano) > 0) && !(section.bass && Number(mix.bass) > 0) && !(section.pad && Number(mix.pad) > 0)) throw new Error("每段至少保留一个可发声声部，不能整段静音");
  });
  const plan = p as unknown as SongPlan; const seconds = durationOf(plan);
  if (seconds < 120 - 1e-8 || seconds > 180 + 1e-8) throw new Error("整曲时长必须为120至180秒");
  return structuredClone(plan);
}

export function createSongPlan(mood: "warm" | "bright" | "dreamy" = "warm"): SongPlan {
  if (!["warm", "bright", "dreamy"].includes(mood)) throw new Error("初稿风格不正确");
  const bright = mood === "bright", dreamy = mood === "dreamy";
  const pattern = (hits: number[], strength: number) => Array.from({ length: 16 }, (_, i) => hits.includes(i) ? i % 4 === 0 ? strength : strength * .75 : 0);
  const section = (id: string, title: string, bars: number, energy: number, chords: number[], piano: SongSection["piano"], bass: boolean, pad: boolean, sourceRoles: SoundRole[]): SongSection => ({ id, title, bars, energy, chords, piano, bass, pad, sourceRoles });
  return validateSongPlan({ version: 1, title: bright ? "生活里的小跃动" : dreamy ? "声音慢慢发光" : "一声生活的温度", bpm: bright ? 112 : dreamy ? 80 : 96, key: bright ? 2 : dreamy ? 9 : 0, scale: dreamy ? "minor" : "major",
    patterns: { pulse: pattern(dreamy ? [0,8] : [0,4,8,12], 1), accent: pattern(bright ? [3,6,11,14] : [4,12], .82), texture: pattern(bright ? [0,2,4,6,8,10,12,14] : [2,6,10,14], .42) },
    mix: { source: .9, piano: .24, bass: .15, pad: .09 }, sections: [
      section("intro", "先听见生活", 4, .38, [1], "off", false, false, ["pulse"]),
      section("theme", "节奏慢慢成形", 8, .6, [1,6,4,5], "chords", true, false, ["pulse", "accent"]),
      section("lift", "让声音展开", bright ? 12 : 8, .78, [4,5,3,6], "arpeggio", true, true, ROLES.slice()),
      section("space", "留一点呼吸", dreamy ? 4 : 8, .42, [6,4,1,5], "chords", false, true, ["pulse", "texture"]),
      section("return", "带着变化回来", bright ? 16 : dreamy ? 8 : 12, .9, [1,4,6,5], "arpeggio", true, true, ROLES.slice()),
      section("outro", "留下最后一声", 8, .32, [4,5,1,1], "chords", false, true, ["pulse", "texture"]),
    ] });
}

export type HarmonyPreset = { id: string; label: string; hint: string; degrees: number[]; cadence: number; dip: number };

// 级数均为统一调式内的 1～7 级；cadence 决定末段最后一格落在哪一级，dip 是低能量段的进入级数。
export const HARMONY_PRESETS: HarmonyPreset[] = [
  { id: "warm", label: "温暖安心", hint: "最常见的流行走向，怎么听都不会错", degrees: [1, 5, 6, 4], cadence: 1, dip: 6 },
  { id: "nost", label: "怀旧微酸", hint: "老唱片、傍晚的感觉", degrees: [1, 6, 4, 5], cadence: 1, dip: 4 },
  { id: "night", label: "夜色悬着", hint: "不落回主音，留一点没说完的感觉", degrees: [6, 4, 1, 5], cadence: 6, dip: 4 },
  { id: "city", label: "都市夜行", hint: "二五一的爵士收束，稍微聪明一点", degrees: [2, 5, 1, 6], cadence: 1, dip: 6 },
  { id: "canon", label: "想哭一点", hint: "卡农式下行，情绪一层层推上去", degrees: [1, 5, 6, 3, 4, 1, 4, 5], cadence: 1, dip: 4 },
  { id: "open", label: "开阔向前", hint: "干净、往前走的四个和弦", degrees: [1, 4, 5, 6], cadence: 1, dip: 4 },
  { id: "breathe", label: "呼吸留白", hint: "从四级开始，进入时更软", degrees: [4, 1, 5, 6], cadence: 1, dip: 5 },
  { id: "sway", label: "来回摇摆", hint: "有点不安分，适合轻快的敲击", degrees: [1, 4, 6, 5], cadence: 1, dip: 6 },
];

export function harmonyPreset(id: string): HarmonyPreset {
  const preset = HARMONY_PRESETS.find(item => item.id === id);
  if (!preset) throw new Error("没有这套和声感觉，请从可选列表中选择");
  return preset;
}

// 一套进行贯穿全曲是流行写法；段落对比落在能量最低的中段——换进入口，其余段保持同一进行。
function harmonySections(preset: HarmonyPreset, sections: SongSection[]): number[][] {
  const last = sections.length - 1;
  const middles = sections.map((_, index) => index).filter(index => index > 0 && index < last);
  const dipIndex = middles.length ? middles.reduce((best, index) => sections[index].energy < sections[best].energy ? index : best, middles[0]) : -1;
  const dipOffset = preset.degrees.indexOf(preset.dip);
  return sections.map((section, index) => {
    const offset = index === dipIndex && dipOffset >= 0 ? dipOffset : 0;
    const chords = section.chords.map((_, step) => preset.degrees[(offset + step) % preset.degrees.length]);
    if (index === last) chords[chords.length - 1] = preset.cadence;
    return chords;
  });
}

// 只替换和弦级数，保留每段原有的和弦数量、配器、能量与结构。
export function applyHarmony(plan: SongPlan, id: string): SongPlan {
  const preset = harmonyPreset(id), valid = validateSongPlan(plan);
  const chords = harmonySections(preset, valid.sections);
  return validateSongPlan({ ...valid, sections: valid.sections.map((section, index) => ({ ...section, chords: chords[index] })) });
}

export function matchHarmony(plan: SongPlan): string | null {
  const valid = validateSongPlan(plan);
  return HARMONY_PRESETS.find(preset => {
    const chords = harmonySections(preset, valid.sections);
    return valid.sections.every((section, index) => section.chords.every((degree, position) => degree === chords[index][position]));
  })?.id ?? null;
}

export function songDuration(plan: SongPlan): number { return durationOf(validateSongPlan(plan)); }
export function sectionTimings(plan: SongPlan): Array<{ id: string; title: string; startSec: number; durationSec: number }> {
  const valid = validateSongPlan(plan); let startSec = 0;
  return valid.sections.map(section => {
    const durationSec = section.bars * 240 / valid.bpm;
    const timing = { id: section.id, title: section.title, startSec, durationSec }; startSec += durationSec; return timing;
  });
}

function voiceChord(chord: number[], previous: number[]): number[] {
  const choices: number[][] = [];
  for (let inversion = 0; inversion < 3; inversion++) for (const octave of [-12, 0, 12]) {
    const notes = chord.map((note, i) => note + (i < inversion ? 12 : 0) + octave).sort((a,b) => a-b);
    if (notes[0] >= 48 && notes[2] <= 84) choices.push(notes);
  }
  const cost = (notes: number[]) => notes.reduce((sum, note, i) => sum + Math.abs(note - (previous[i] ?? [60,64,67][i])), 0);
  return choices.sort((a,b) => cost(a) - cost(b) || a[0] - b[0])[0];
}

export function expandSong(plan: SongPlan): {
  samples: Array<{ role: SoundRole; time: number; velocity: number }>;
  notes: Array<{ instrument: "piano" | "bass" | "pad"; midi: number; time: number; duration: number; velocity: number }>;
} {
  const valid = validateSongPlan(plan); const timings = sectionTimings(valid); const beat = 60 / valid.bpm;
  const samples: ReturnType<typeof expandSong>["samples"] = [], notes: ReturnType<typeof expandSong>["notes"] = [];
  const scale = valid.scale === "major" ? [0,2,4,5,7,9,11] : [0,2,3,5,7,8,10];
  const degreeNote = (degree: number) => 48 + valid.key + scale[degree % 7] + Math.floor(degree / 7) * 12;
  let previous: number[] = [];
  valid.sections.forEach((section, sectionIndex) => {
    const timing = timings[sectionIndex]; const ending = sectionIndex === valid.sections.length - 1;
    const emit = (instrument: "piano" | "bass" | "pad", midi: number, time: number, duration: number, velocity: number) => {
      const length = Math.min(duration, timing.startSec + timing.durationSec - time);
      if (length > 1e-8) notes.push({ instrument, midi, time, duration: length, velocity });
    };
    for (let bar = 0; bar < section.bars; bar++) {
      const start = timing.startSec + bar * 4 * beat; const finalBar = ending && bar === section.bars - 1;
      const energy = section.energy * (ending ? 1 - .45 * bar / (section.bars - 1) : 1);
      for (const role of section.sourceRoles) {
        const hits = valid.patterns[role].flatMap((velocity, step) => velocity ? [{ step, velocity }] : []);
        const shift = role !== "pulse" && sectionIndex % 3 === 2 ? 2 : 0;
        let active = hits.filter((_, index) => energy >= .5 || index % 2 === bar % 2).map(hit => ({ ...hit, step: (hit.step + shift) % 16 }));
        if (finalBar) active = active.filter(hit => hit.step < 8);
        if (!active.length) active = [{ step: 0, velocity: Math.max(...valid.patterns[role]) }];
        if (energy > .7 && bar % 4 === 3 && role !== "pulse" && !active.some(hit => hit.step === 14)) active.push({ step: 14, velocity: .5 });
        if (((sectionIndex === 0 && bar === 0) || finalBar) && role === section.sourceRoles[0] && !active.some(hit => hit.step === 0)) active.push({ step: 0, velocity: Math.max(...valid.patterns[role]) });
        active.forEach(hit => samples.push({ role, time: start + hit.step * beat / 4, velocity: hit.velocity * energy * (.92 + (bar + hit.step + sectionIndex) % 4 * .025) }));
      }
      const degree = (finalBar ? section.chords.at(-1)! : section.chords[Math.floor(bar / 2) % section.chords.length]) - 1;
      const chord = [degreeNote(degree), degreeNote(degree + 2), degreeNote(degree + 4)];
      const voiced = voiceChord(chord, previous); previous = voiced;
      if (section.piano === "chords") {
        voiced.forEach(midi => emit("piano", midi, start, beat * (energy < .5 ? 3.7 : 1.7), energy * .7));
        if (energy >= .5) voiced.forEach(midi => emit("piano", midi, start + 2 * beat, beat * 1.7, energy * .5));
      } else if (section.piano === "arpeggio") {
        const order = [0,1,2,1,0,2,1,2];
        order.forEach((voice, index) => emit("piano", voiced[(voice + sectionIndex % 2) % 3], start + index * beat / 2, beat * .44, energy * (index % 2 ? .48 : .68)));
      }
      if (section.bass) {
        let root = chord[0] - 12; if (root > 52) root -= 12;
        emit("bass", root, start, beat * (energy < .5 ? 3.7 : 1.8), energy * .85);
        if (energy >= .5) emit("bass", bar % 2 ? root + chord[2] - chord[0] : root, start + 2 * beat, beat * 1.75, energy * .65);
      }
      if (section.pad) voiced.forEach(midi => emit("pad", midi - 12, start, beat * 3.9, energy * .35));
    }
  });
  samples.sort((a,b) => a.time - b.time || ROLES.indexOf(a.role) - ROLES.indexOf(b.role));
  notes.sort((a,b) => a.time - b.time || a.midi - b.midi);
  return { samples, notes };
}
