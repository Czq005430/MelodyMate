import type { Project, Trim } from "./types.ts";
import { validateProject } from "./validation.ts";

export type ProjectState = { project: Project | null; history: Project[]; revision: number };
export type ProjectAction = { type: "load" | "commit"; project: Project } | { type: "undo" };
export const initialProjectState: ProjectState = { project: null, history: [], revision: 0 };

export function createProject(sourceId: string, label: string, duration: number, trim: Trim, revision = 1): Project {
  return validateProject({
    schemaVersion: 2, revision, sourceId, sourceLabel: [...label.trim()].slice(0, 40).join("") || "声音 1",
    sourceDurationSec: duration, trim, bars: 4, backingAllowed: false,
    params: { bpm: 100, steps: [1,0,0,0,1,0,0,0,1,0,0,0,1,0,0,0], structurePreset: "mini", sourceGain: 1, sourceTone: "original", backingPreset: "off", backingGain: 0.08 },
  });
}

export function projectReducer(state: ProjectState, action: ProjectAction): ProjectState {
  const revision = state.revision + 1;
  if (action.type === "undo") {
    const previous = state.history.at(-1);
    return previous ? { project: { ...structuredClone(previous), revision }, history: state.history.slice(0, -1), revision } : state;
  }
  if (action.type === "commit" && action.project.revision !== state.project?.revision) throw new Error("工程版本已过期，请基于当前版本修改");
  const project = structuredClone(validateProject(action.project));
  project.revision = revision;
  if (action.type === "load") return { project, revision, history: [] };
  if (!state.project || project.sourceId !== state.project.sourceId || project.sourceDurationSec !== state.project.sourceDurationSec) throw new Error("请通过导入操作替换素材");
  if (JSON.stringify({ ...project, revision: 0 }) === JSON.stringify({ ...state.project, revision: 0 })) return state;
  if (project.trim.startSec !== state.project.trim.startSec || project.trim.endSec !== state.project.trim.endSec) {
    project.backingAllowed = false; project.params.backingPreset = "off";
  }
  return { project, revision, history: [...state.history, structuredClone(state.project)].slice(-5) };
}
