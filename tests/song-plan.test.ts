import assert from "node:assert/strict";
import test from "node:test";
import { createSongPlan, expandSong, sectionTimings, SONG_PLAN_SCHEMA, songDuration, validateSongPlan } from "../lib/song-plan.ts";
import type { SongPlan, SoundRole } from "../lib/song-types.ts";

function fixture(): SongPlan {
  return { version: 1, title: "生活声音练习", bpm: 96, key: 0, scale: "major",
    patterns: { pulse: [1,0,0,0,.8,0,0,0,1,0,0,0,.8,0,0,0], accent: [0,0,0,0,.7,0,0,0,0,0,0,0,.9,0,0,0], texture: [.2,0,.3,0,.2,0,.4,0,.2,0,.3,0,.2,0,.4,0] },
    mix: { source: .9, piano: .25, bass: .15, pad: .1 },
    sections: [
      { id: "intro", title: "第一声", bars: 4, energy: .35, chords: [1], piano: "off", bass: false, pad: false, sourceRoles: ["pulse"] },
      { id: "theme", title: "主题", bars: 8, energy: .6, chords: [1,6,4,5], piano: "chords", bass: true, pad: false, sourceRoles: ["pulse", "accent"] },
      { id: "lift", title: "展开", bars: 8, energy: .8, chords: [4,5,3,6], piano: "arpeggio", bass: true, pad: true, sourceRoles: ["pulse", "accent", "texture"] },
      { id: "space", title: "留白", bars: 8, energy: .4, chords: [6,4,1,5], piano: "chords", bass: false, pad: true, sourceRoles: ["pulse", "texture"] },
      { id: "return", title: "再出发", bars: 12, energy: .9, chords: [1,4,6,5], piano: "arpeggio", bass: true, pad: true, sourceRoles: ["pulse", "accent", "texture"] },
      { id: "outro", title: "最后一声", bars: 8, energy: .3, chords: [4,5,1,1], piano: "chords", bass: false, pad: true, sourceRoles: ["pulse", "texture"] },
    ] };
}

test("三种初稿均为120至180秒，默认96 BPM四十八小节且开头原声独奏", () => {
  for (const mood of ["warm", "bright", "dreamy"] as const) {
    const plan = createSongPlan(mood);
    assert.deepEqual(validateSongPlan(plan), plan);
    assert.ok(songDuration(plan) >= 120 && songDuration(plan) <= 180);
    assert.deepEqual(expandSong(plan), expandSong(plan));
    assert.equal(plan.sections[0].piano, "off");
    assert.equal(plan.sections[0].bass, false);
    assert.equal(plan.sections[0].pad, false);
    assert.ok(!expandSong(plan).notes.some(note => note.time < sectionTimings(plan)[0].durationSec));
  }
  assert.equal(createSongPlan().bpm, 96);
  assert.equal(songDuration(createSongPlan()), 120);
  const mutated = createSongPlan(); mutated.patterns.pulse[0] = 0;
  assert.notDeepEqual(mutated, createSongPlan());
  assert.notDeepEqual(createSongPlan("bright").patterns, createSongPlan("dreamy").patterns);
});

test("分段起止连续，累计时长与整曲一致，验证返回独立快照", () => {
  const input = fixture();
  const valid = validateSongPlan(input);
  const timings = sectionTimings(valid);
  assert.equal(timings[0].startSec, 0);
  timings.forEach((section, index) => {
    assert.equal(section.id, input.sections[index].id);
    assert.equal(section.title, input.sections[index].title);
    assert.equal(section.durationSec, input.sections[index].bars * 240 / input.bpm);
    if (index) assert.equal(section.startSec, timings[index - 1].startSec + timings[index - 1].durationSec);
  });
  assert.equal(timings.at(-1)!.startSec + timings.at(-1)!.durationSec, songDuration(input));
  valid.patterns.pulse[0] = .2;
  assert.equal(input.patterns.pulse[0], 1);
});

test("完整白名单和大小约束拒绝未知字段、错误类型、稀疏数组及非法参数", () => {
  const invalid: ((plan: SongPlan) => unknown)[] = [
    p => ({ ...p, hidden: true }), p => ({ ...p, version: 2 }), p => ({ ...p, title: " " }), p => ({ ...p, title: "声".repeat(61) }),
    p => ({ ...p, bpm: 71 }), p => ({ ...p, bpm: 129 }), p => ({ ...p, bpm: NaN }),
    p => ({ ...p, key: 12 }), p => ({ ...p, key: -1 }), p => ({ ...p, key: 1.5 }), p => ({ ...p, scale: "chromatic" }),
    p => ({ ...p, mix: { ...p.mix, source: .49 } }), p => ({ ...p, mix: { ...p.mix, piano: .51 } }),
    p => ({ ...p, mix: { ...p.mix, bass: .31 } }), p => ({ ...p, mix: { ...p.mix, pad: .26 } }), p => ({ ...p, mix: { ...p.mix, extra: 0 } }),
    p => ({ ...p, patterns: { ...p.patterns, pulse: Array(16).fill(0) } }), p => ({ ...p, patterns: { ...p.patterns, pulse: Array(16) } }),
    p => ({ ...p, patterns: { ...p.patterns, texture: [1] } }), p => ({ ...p, patterns: { ...p.patterns, accent: Array(16).fill(Infinity) } }),
    p => ({ ...p, patterns: { ...p.patterns, accent: Array(16).fill(1.1) } }), p => ({ ...p, patterns: { ...p.patterns, extra: [1] } }),
    p => ({ ...p, sections: p.sections.slice(0, 3) }), p => ({ ...p, sections: Array(9).fill(p.sections[0]) }),
    p => { p.sections[0].id = p.sections[1].id; return p; }, p => { p.sections[0].id = "x".repeat(41); return p; },
    p => { p.sections[0].bars = 6; return p; }, p => { p.sections[0].bars = 36; return p; },
    p => { p.sections[1].chords = []; return p; }, p => { p.sections[1].chords = [0,8]; return p; },
    p => { p.sections[1].chords = Array(9).fill(1); return p; }, p => { p.sections[1].energy = 0; return p; },
    p => { p.sections[1].energy = 1.01; return p; }, p => { (p.sections[1] as unknown as Record<string, unknown>).extra = true; return p; },
    p => { p.sections[1].piano = "organ" as "chords"; return p; }, p => { p.sections[1].bass = 1 as unknown as boolean; return p; },
    p => { p.sections[1].sourceRoles = ["pulse", "pulse"]; return p; }, p => { p.sections[1].sourceRoles = ["voice" as SoundRole]; return p; },
  ];
  for (const value of [null, [], "plan", ...invalid.map(change => change(fixture()))]) assert.throws(() => validateSongPlan(value));
  assert.equal(SONG_PLAN_SCHEMA.additionalProperties, false);
  assert.ok(SONG_PLAN_SCHEMA.required.includes("sections"));
});

test("时长严格保持120至180秒，合法边界速度仍可生成完整乐谱", () => {
  const short = fixture(); short.bpm = 96.01; assert.throws(() => validateSongPlan(short), /120|时长/);
  const long = fixture(); long.sections.forEach(section => section.bars = 16); assert.throws(() => validateSongPlan(long), /180|时长/);
  const maximum = fixture(); maximum.sections.forEach(section => section.bars = 12); assert.equal(songDuration(validateSongPlan(maximum)), 180);
  const slow = fixture(); slow.bpm = 72; slow.sections = slow.sections.slice(0, 5); slow.sections[4].bars = 8;
  assert.equal(songDuration(validateSongPlan(slow)), 120);
  const fast = fixture(); fast.bpm = 128; fast.sections.forEach((section, i) => section.bars = i ? 12 : 4);
  assert.equal(songDuration(validateSongPlan(fast)), 120);
});

test("首末必须保留原声，所有段落均有可发声声部", () => {
  for (const index of [0, 5]) { const p = fixture(); p.sections[index].sourceRoles = []; assert.throws(() => validateSongPlan(p), /原声/); }
  const silent = fixture(); Object.assign(silent.sections[2], { sourceRoles: [], piano: "off", bass: false, pad: false });
  assert.throws(() => validateSongPlan(silent), /静音|发声/);
  const muted = fixture(); Object.assign(muted.sections[2], { sourceRoles: [], piano: "chords", bass: false, pad: false }); muted.mix.piano = 0;
  assert.throws(() => validateSongPlan(muted), /静音|发声/);
  const instrumental = fixture(); instrumental.sections[2].sourceRoles = []; assert.doesNotThrow(() => validateSongPlan(instrumental));
});

test("展开事件确定且不改输入，时间有序、音符完整落在所属段落、符合调式", () => {
  const plan = fixture(); plan.key = 11; plan.scale = "minor";
  const before = structuredClone(plan); const result = expandSong(plan); const timings = sectionTimings(plan);
  assert.deepEqual(result, expandSong(plan)); assert.deepEqual(plan, before);
  assert.ok(result.samples.length > 0 && result.notes.length > 0 && result.samples.length + result.notes.length < 20000);
  assert.deepEqual(result.samples.map(x => x.time), result.samples.map(x => x.time).sort((a,b) => a-b));
  assert.deepEqual(result.notes.map(x => x.time), result.notes.map(x => x.time).sort((a,b) => a-b));
  const pitchClasses = [0,2,3,5,7,8,10].map(n => (n + plan.key) % 12);
  for (const event of [...result.samples, ...result.notes]) assert.ok(event.time >= 0 && event.time < songDuration(plan) && event.velocity > 0 && event.velocity <= 1);
  for (const note of result.notes) {
    assert.ok(Number.isInteger(note.midi) && note.midi >= 24 && note.midi <= 96);
    assert.ok(pitchClasses.includes(note.midi % 12));
    const section = timings.find(x => note.time >= x.startSec - 1e-9 && note.time < x.startSec + x.durationSec - 1e-9)!;
    assert.ok(note.duration > 0 && note.time + note.duration <= section.startSec + section.durationSec + 1e-8);
  }
});

test("稀疏动机也保留首尾落点，段落有节奏发展及平滑和声转位", () => {
  const sparse = fixture(); for (const role of ["pulse", "accent", "texture"] as const) sparse.patterns[role] = Array.from({ length: 16 }, (_, i) => i === 15 ? .7 : 0);
  const sparseEvents = expandSong(sparse).samples; const barSeconds = 240 / sparse.bpm;
  assert.ok(sparseEvents.some(x => x.time === 0));
  assert.ok(sparseEvents.some(x => Math.abs(x.time - (songDuration(sparse) - barSeconds)) < 1e-8));
  const plan = fixture(); const events = expandSong(plan); const timings = sectionTimings(plan);
  const signature = (section: number) => events.samples.filter(x => x.time >= timings[section].startSec && x.time < timings[section].startSec + barSeconds).map(x => [x.role, Math.round((x.time - timings[section].startSec) / barSeconds * 16)]);
  assert.notDeepEqual(signature(2), signature(4));
  const starts = Array.from({ length: 8 }, (_, bar) => timings[1].startSec + bar * barSeconds);
  const voicings = starts.map(start => events.notes.filter(x => x.instrument === "piano" && Math.abs(x.time - start) < 1e-8).map(x => x.midi).sort((a,b) => a-b));
  assert.ok(voicings.every(notes => notes.length === 3));
  for (let i = 1; i < voicings.length; i++) assert.ok(voicings[i].every((note, voice) => Math.abs(note - voicings[i - 1][voice]) <= 12));
  assert.ok(new Set(voicings.map(notes => notes.join(","))).size > 1);
});

test("所有调性和七级和弦均有合法声部，最高密度乐谱的事件数量有界", () => {
  for (const scale of ["major", "minor"] as const) for (let key = 0; key < 12; key++) {
    const plan = fixture(); plan.key = key; plan.scale = scale; plan.bpm = 128;
    for (const role of ["pulse", "accent", "texture"] as const) plan.patterns[role] = Array(16).fill(1);
    plan.sections.forEach(section => Object.assign(section, {
      bars: 16, energy: 1, chords: [1,2,3,4,5,6,7],
      piano: "arpeggio", bass: true, pad: true, sourceRoles: ["pulse", "accent", "texture"],
    }));
    const events = expandSong(plan);
    assert.equal(songDuration(plan), 180);
    assert.ok(events.samples.length + events.notes.length < 20000);
    assert.ok(events.samples.every(event => event.time < 180 && event.velocity > 0 && event.velocity <= 1));
    assert.ok(events.notes.every(note => Number.isInteger(note.midi) && note.midi >= 24 && note.midi <= 96 && note.time + note.duration <= 180));
  }
});
