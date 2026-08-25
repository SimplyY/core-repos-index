import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { DEFAULT_ICONS } from "./fields.js";

export function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

export function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

export function normalizeGroupName(name) {
  if (name === "invset-x") return "invest-x";
  return name;
}

export function groupKey(group) {
  return group.id || group.name;
}

export function projectDomId(group) {
  return groupKey(group).replace(/[^a-z0-9-]/gi, "-").toLowerCase();
}

export function groupIcon(group, v2Fields) {
  return (v2Fields && v2Fields.icon) || DEFAULT_ICONS[groupKey(group)] || DEFAULT_ICONS[group.name] || '📦';
}

export function groupIdFromName(name) {
  if (name === "Group Index") return "index";
  return String(name || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

export function splitLines(value) {
  return String(value || "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

export function parseLinks(value) {
  return splitLines(value).map((line) => {
    const namedMarkdown = line.match(/^(.+?)[：:]\s*\[(.+?)\]\((https?:\/\/[^)]+)\)$/);
    if (namedMarkdown) return { name: namedMarkdown[1].trim(), url: namedMarkdown[3].trim() };
    const markdown = line.match(/^\[(.+?)\]\((https?:\/\/[^)]+)\)$/);
    if (markdown) return { name: markdown[1].trim() || "链接", url: markdown[2].trim() };
    const match = line.match(/^(.+?)[：:]\s*(https?:\/\/\S+)$/);
    if (match) return { name: match[1].trim(), url: match[2].trim() };
    if (/^https?:\/\//.test(line)) return { name: "链接", url: line };
    return null;
  }).filter(Boolean);
}

export function parseTextItems(value) {
  return splitLines(value);
}

export function parseManualWorkflows(value) {
  return splitLines(value).map((line) => {
    const match = line.match(/^(.+?)[：:]\s*(.+)$/);
    return {
      name: match ? match[1].trim() : line,
      name_zh: match ? match[1].trim() : line,
      description: match ? match[2].trim() : "",
      description_zh: match ? match[2].trim() : ""
    };
  });
}

export function parsePriority(value) {
  const raw = Array.isArray(value) ? value[0] : value;
  if (raw === null || raw === undefined || raw === "") return 99;
  const text = String(raw).trim();
  const pLevel = text.match(/^P(\d+)$/i);
  if (pLevel) return Number(pLevel[1]) + 1;
  const numeric = Number(text);
  return Number.isFinite(numeric) ? numeric : 99;
}

export function firstSentence(text) {
  if (!text) return "";
  const m = text.match(/^([^。！？\n；;]+)/);
  return m ? m[1].trim() : text.trim();
}

export function shortDesc(text) {
  if (!text) return "";
  return firstSentence(text);
}

export function cleanSkillDesc(skill, max = 25) {
  const raw = (skill.description_zh || skill.description || "").trim();
  if (!raw) return "";
  const segs = raw.match(/[\u4e00-\u9fa5][\u4e00-\u9fa5，。！？、·：:；;（）()\-\w ]*/g) || [];
  let best = "";
  for (const s of segs) {
    const cut = s.replace(/[^\u4e00-\u9fa5]+$/, "");
    if (cut.length > best.length) best = cut;
  }
  const cnCount = (best.match(/[\u4e00-\u9fa5]/g) || []).length;
  if (cnCount < 6) return "";
  return best.length > max ? best.slice(0, max) : best;
}

export function realpathMaybe(value) {
  if (!value) return null;
  try {
    return realpathSync(value);
  } catch {
    return value;
  }
}

export function hasChinese(text) {
  return /[\u4e00-\u9fa5]/.test(text || "");
}

export function statusForPath(path) {
  if (!path) return "未在群注册表中记录";
  return existsSync(path) ? "可访问" : "绑定存在，但当前不可访问";
}

export function baseStatus(base) {
  if (!base) return "未记录";
  return "已记录但未验证";
}

export function baseLabel(base) {
  if (!base) return "未在群注册表中记录";
  return base.url || base.id || base.name || "已记录但未验证";
}

export function formatSkillLine(skill) {
  const n = skill.name_zh || skill.name;
  const d = cleanSkillDesc(skill);
  if (!d) return n;
  return n + "：" + d;
}
