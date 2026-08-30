import { existsSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { statePath } from "./fields.js";
import { readJson } from "./utils.js";

export function readState() {
  if (!existsSync(statePath)) return { groups: {} };
  return readJson(statePath);
}

export function stateFor(state, group) {
  if (!state.groups) state.groups = {};
  if (!state.groups[group.id]) state.groups[group.id] = {};
  return state.groups[group.id];
}

export function attachState(registry, state) {
  for (const group of registry.groups) {
    Object.assign(group, state.groups?.[group.id] || {});
  }
  return registry;
}

export function saveState(state) {
  const tmpPath = `${statePath}.${process.pid}.tmp`;
  try {
    writeFileSync(tmpPath, `${JSON.stringify(state, null, 2)}\n`);
    renameSync(tmpPath, statePath);
  } catch (error) {
    try { unlinkSync(tmpPath); } catch { /* preserve the original write error */ }
    throw error;
  }
}
