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

function descriptionBody(text) {
  const raw = String(text || "").trim();
  const colon = raw.search(/[：:]/);
  if (colon < 0) return raw;
  const prefix = raw.slice(0, colon);
  return /[A-Za-z0-9/]/.test(prefix) ? raw.slice(colon + 1).trim() : raw;
}

export function cleanSkillDesc(skill, max = 25) {
  const raw = descriptionBody(skill.description_zh || skill.description || "");
  if (!raw) return "";
  const firstChinese = raw.search(/[\u4e00-\u9fa5]/);
  if (firstChinese < 0) return "";
  const body = raw.slice(firstChinese);
  let lastChinese = -1;
  for (let i = body.length - 1; i >= 0; i -= 1) {
    if (/[\u4e00-\u9fa5]/.test(body[i])) {
      lastChinese = i;
      break;
    }
  }
  const best = lastChinese >= 0 ? body.slice(0, lastChinese + 1) : "";
  const cnCount = (best.match(/[\u4e00-\u9fa5]/g) || []).length;
  if (cnCount < 6) return "";
  const limited = best.length > max ? best.slice(0, max) : best;
  return limited.replace(/[^\u4e00-\u9fa5]+$/, "");
}

function completeWithin(text, max) {
  const candidate = text.trim();
  if (!candidate) return "";
  const completed = /[。！？；;]$/.test(candidate) ? candidate : candidate + "。";
  return Array.from(completed).length <= max ? completed : "";
}

function isUsefulDescription(text) {
  const chinese = (text.match(/[\u4e00-\u9fa5]/g) || []).length;
  const meaningful = text.replace(/[\s。！？；;,，:：]/g, "");
  return chinese >= 2 && Array.from(meaningful).length >= 4;
}

const DESCRIPTION_ACTIONS = [
  "生成", "创建", "记录", "查看", "检查", "统计", "处理", "执行", "管理", "维护",
  "读取", "分析", "同步", "审查", "转换", "推送", "评估", "提供", "获取", "整理",
  "筛选", "研究", "解析", "更新", "发送", "切换", "启动", "重置", "复制", "汇总", "缓存", "匹配",
  "推理", "提醒", "评分", "编排", "治理", "调用", "判断", "监控", "部署", "搜索", "输出",
  "导入", "导出", "采集"
];

function isStandaloneClause(text) {
  const candidate = text.trim();
  return !/^(以及|并且|并|且|和|或|而|但|及)/.test(candidate)
    && !/[、，,：:]$/.test(candidate)
    && !/(的|以及|并且|并|且|和|或|简洁|完整|可执行|主要|稳定|自动|深度|系统性)$/.test(candidate);
}

function findActions(text) {
  const searchable = text.replace(/[“「《\"].*?[”」》\"]/g, (quoted) => " ".repeat(quoted.length));
  return DESCRIPTION_ACTIONS
    .map((word) => ({ word, index: searchable.indexOf(word) }))
    .filter((item) => item.index >= 0)
    .filter((item) => !/[不未无非]$/.test(searchable.slice(0, item.index).trim()))
    .sort((a, b) => a.index - b.index || b.word.length - a.word.length);
}

function removeParenthetical(text) {
  let depth = 0;
  let result = "";
  for (const char of text) {
    if (/[（(【\[]/.test(char)) { depth += 1; continue; }
    if (/[）)】\]]/.test(char)) { depth = Math.max(0, depth - 1); continue; }
    if (!depth) result += char;
  }
  return result;
}

function compactObject(text) {
  return text.replace(/^(简洁|完整|正式|安全|可追溯|结构化|个性化|近期|当前|真实|本地|日常|本周|长期稳定的?|固定的?)\s*/g, "");
}

function actionCore(part, action) {
  const suffix = part.slice(action.index + action.word.length).trim();
  if (/^的/.test(suffix) && DESCRIPTION_ACTIONS.some((word) => suffix.slice(1).includes(word))) return "";
  const afterDe = suffix.match(/的(.+)/)?.[1]?.trim();
  const object = compactObject(afterDe || suffix);
  const separator = /^[A-Za-z0-9`]/.test(object) ? " " : "";
  return (action.word + separator + object).trim().replace(/([\u4e00-\u9fa5])(?=[A-Za-z0-9`])/g, "$1 ");
}

function compressedClauses(text) {
  const normalized = removeParenthetical(text)
    .replace(/[“「《\"].*?[”」》\"]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  const compact = normalized
    .replace(/简洁、可执行的\s*/g, "")
    .replace(/完整的\s*/g, "")
    .replace(/正式的\s*/g, "")
    .replace(/安全的\s*/g, "")
    .replace(/可追溯的\s*/g, "")
    .replace(/结构化的\s*/g, "")
    .replace(/个性化的\s*/g, "");
  const candidates = [];
  const hasColon = /[：:]/.test(normalized);
  const parts = compact.split(/[，,：:；;]/).map((clause) => clause.trim()).filter(Boolean);
  let previousActions = [];
  for (const part of parts) {
    const standalonePart = part.replace(/^(以及|并且|并|且|和|或|而|但)\s*/, "").trim();
    candidates.push(standalonePart, compactObject(standalonePart));
    const actions = findActions(part);
    for (const action of actions) {
      const suffix = part.slice(action.index + action.word.length).trim();
      if (/^的/.test(suffix) && DESCRIPTION_ACTIONS.some((word) => suffix.slice(1).includes(word))) continue;
      candidates.push(actionCore(part, action));
      const afterDe = suffix.match(/的(.+)/)?.[1]?.trim() || suffix;
      const latinIndex = suffix.search(/[A-Za-z][A-Za-z0-9_-]*/);
      if (latinIndex >= 0) {
        candidates.push((action.word + " " + suffix.slice(latinIndex)).replace(/([\u4e00-\u9fa5])(?=[A-Za-z0-9`])/g, "$1 "));
      }
      const objectSources = /^(的|为)/.test(suffix) ? [afterDe] : [suffix, afterDe];
      const objects = [...new Set(objectSources.map(compactObject).filter(Boolean))];
      for (const objectText of objects) {
        const items = objectText.split("、").map((item) => item.trim()).filter(Boolean);
        for (let i = 0; i < items.length; i += 1) {
          const object = items.slice(0, i + 1).join("、");
          const separator = /^[A-Za-z0-9`]/.test(object) ? " " : "";
          candidates.push((action.word + separator + object).replace(/([\u4e00-\u9fa5])(?=[A-Za-z0-9`])/g, "$1 "));
        }
      }
    }
    if (hasColon && !actions.length && previousActions.length) candidates.push(previousActions[0].word + part);
    previousActions = actions;
  }
  candidates.push(compact);
  if (hasColon && parts[0]) candidates.push(parts[0]);
  return candidates;
}

function descriptionScore(text) {
  const chinese = (text.match(/[\u4e00-\u9fa5]/g) || []).length;
  const startsWithAction = DESCRIPTION_ACTIONS.some((word) => text.startsWith(word));
  return (startsWithAction ? 1000 : 0) + chinese * 10 + Array.from(text).length;
}

function descriptionMinimum(max) {
  return max === 40 ? 21 : max === 30 ? 11 : max === 20 ? 6 : 0;
}

// 频率置顶专用：只输出完整句子或动作 + 对象语义单元，不按字符硬切。
export function cleanSkillDescCompleteSentence(skill, max = 25) {
  const raw = String(skill.description_zh || skill.description || "").trim();
  const colon = raw.search(/[：:]/);
  const firstBoundary = raw.search(/[。！？；;]/);
  const prefix = colon >= 0 ? raw.slice(0, colon) : "";
  const source = colon >= 0 && (firstBoundary < 0 || colon < firstBoundary) && /[A-Za-z0-9/]/.test(prefix)
    ? raw.slice(colon + 1).trim()
    : raw;
  const firstChinese = source.search(/[\u4e00-\u9fa5]/);
  const body = firstChinese >= 0 ? source.slice(firstChinese).trim() : "";
  if (!body) return "";

  const first = body.match(/^([\s\S]*?)([。！？\n；;]|$)/);
  const terminator = first && first[2] && first[2] !== "\n" ? first[2] : "";
  const firstSentence = ((first && first[1]) || body).trim() + terminator;
  const exact = completeWithin(firstSentence, max);
  const minimum = descriptionMinimum(max);
  if (exact && isUsefulDescription(exact) && Array.from(exact).length >= minimum) return exact;

  const contents = [firstSentence.replace(/[。！？；;]$/, ""), ...body.split(/[。！？；;]/).slice(1)];
  const candidates = [];
  for (const content of contents) {
    candidates.push(...compressedClauses(content)
      .filter(isStandaloneClause)
      .map((clause) => completeWithin(clause, max))
      .filter((candidate) => candidate && isUsefulDescription(candidate)));
  }
  const best = candidates
    .sort((a, b) => {
      const aMeets = Array.from(a).length >= minimum;
      const bMeets = Array.from(b).length >= minimum;
      if (aMeets || bMeets) return Number(bMeets) - Number(aMeets) || descriptionScore(b) - descriptionScore(a);
      return Array.from(b).length - Array.from(a).length || descriptionScore(b) - descriptionScore(a);
    })[0];
  return best || (exact && isUsefulDescription(exact) ? exact : "");
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
