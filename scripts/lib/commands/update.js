import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { scanRepo } from "../scan.js";
import { parseGroupInfoV2, defaultDetail, defaultTags, defaultEntryUrl } from "../frontmatter.js";
import { stateFor, saveState } from "../state.js";
import {
  groupIcon, realpathMaybe, statusForPath, formatSkillLine,
  firstSentence, shortDesc, hasChinese
} from "../utils.js";
import { syncLinks, reverseSyncForGroup } from "../link-sync.js";

export function renderGroupInfo(group, scan, v2Fields, now) {
  const repoPath = realpathMaybe(group.repo_path || group.repo);
  const groupInfoPath = group.group_info_path || (repoPath ? join(repoPath, "GROUP_INFO.md") : null);
  const hasLinks = group.links && group.links.length > 0;
  const hasSkills = scan.skills.length > 0;
  const hasWorkflows = scan.workflows.length > 0;
  const nameZh = (v2Fields && v2Fields.name_zh) || group.name;

  const icon = groupIcon(group, v2Fields);
  const summary = group.positioning || (v2Fields && v2Fields.summary) || '';
  const detail = (v2Fields && v2Fields.detail) || group.notes || defaultDetail(group, scan);
  const tags = (v2Fields && v2Fields.tags) || defaultTags(scan);
  const rawEntryUrl = (v2Fields && v2Fields.entry_url) || "";
  const isGuessedGitHub = /github\.com\/SimplyY\/[\w-]+$/.test(rawEntryUrl);
  const entryUrl = (rawEntryUrl && !isGuessedGitHub) ? rawEntryUrl : defaultEntryUrl(group);
  const priority = group.priority || 99;
  const calibration = (v2Fields && v2Fields.calibration) || '';
  const todos = (v2Fields && v2Fields.todos) || group.todos || [];

  const lines = [];
  lines.push("---");
  lines.push("generated_by: group-info");
  lines.push("schema: group-info/v2");
  lines.push("chat_id: " + JSON.stringify(group.chat_id ?? null));
  lines.push("group_name: " + JSON.stringify(group.group_name || group.name));
  lines.push("repo_path: " + JSON.stringify(repoPath));
  lines.push("repo_url: " + JSON.stringify(group.repo_url || null));
  lines.push("group_info_path: " + JSON.stringify(groupInfoPath));
  lines.push("updated_at: " + JSON.stringify(now));
  lines.push("icon: " + JSON.stringify(icon));
  lines.push("name_zh: " + JSON.stringify(nameZh));
  lines.push("summary: " + JSON.stringify(summary));
  lines.push("detail: " + JSON.stringify(detail));
  lines.push("tags: " + JSON.stringify(tags.join("，")));
  lines.push("entry_url: " + JSON.stringify(entryUrl));
  lines.push("priority: " + priority);
  if (calibration) lines.push("calibration: " + JSON.stringify(calibration));
  if (todos.length > 0) lines.push("todos: " + JSON.stringify(todos));
  lines.push("---");
  lines.push("");
  lines.push("# Group Info: " + nameZh);
  lines.push("");
  lines.push("## 群定位");
  lines.push(group.positioning || "未在群注册表中记录");
  lines.push("");
  lines.push("## 绑定信息");
  lines.push("- 飞书群：" + (group.group_name || group.name));
  lines.push("- 工作目录：" + (group.repo || "未在群注册表中记录"));
  if (group.repo_url) lines.push("- 代码仓库：" + group.repo_url);
  if (hasLinks) { group.links.forEach(function(link) { lines.push("- 链接：" + (link.name || "") + " → " + (link.url || "")); }); }
  lines.push("- 默认机器人：" + (group.bot || "未在群注册表中记录"));

  if (calibration) {
    lines.push("");
    lines.push("## 定位校准（人工，脚本永不覆盖）");
    lines.push(calibration);
  }

  if (group.notes) {
    lines.push("");
    lines.push("## 备注");
    lines.push(group.notes);
  }

  if (hasSkills) {
    lines.push("");
    lines.push("## 可用 Skill");
    scan.skills.forEach((skill, i) => {
      const prefix = scan.skills.length > 1 ? (i + 1) + ". " : "";
      lines.push(prefix + formatSkillLine(skill));
    });
  }

  if (hasWorkflows) {
    lines.push("");
    lines.push("## 可用 Workflow");
    scan.workflows.forEach((item, i) => {
      const prefix = scan.workflows.length > 1 ? (i + 1) + ". " : "";
      lines.push(prefix + formatSkillLine(item));
    });
  }

  if (scan.dataSources.length > 0) {
    lines.push("");
    lines.push("## 数据源");
    const dsLines = [
      hasLinks ? group.links.map(function(l) { return "- " + (l.name || "链接") + "：" + (l.url || ""); }).join("\n") : null,
      ...scan.dataSources,
    ].filter(Boolean);
    if (dsLines.length > 0) lines.push(...[...new Set(dsLines)]);
  }

  if (todos.length > 0) {
    lines.push("");
    lines.push("## 待办");
    todos.forEach(function(t, i) { lines.push("- " + t); });
  }

  lines.push("");
  lines.push("## 状态");
  lines.push("- 工作目录：" + statusForPath(group.repo));
  if (hasLinks) lines.push("- 链接数：" + group.links.length);
  lines.push("- Skill 扫描：" + (scan.error ? "异常：" + scan.error : "正常"));
  lines.push("- 最近更新时间：" + now);
  lines.push("");

  return lines.join("\n");
}

export function renderPinSummary(group, scan, now, v2Fields) {
  const topSkills = scan.skills.map((skill, i) => {
    const n = skill.name_zh || skill.name;
    const d = skill.description_zh || firstSentence(skill.description_zh || skill.description);
    const s = shortDesc(d);
    const prefix = scan.skills.length > 1 ? (i + 1) + ". " : "";
    return prefix + (s ? n + "：" + s : n);
  }).join("\n");
  const skillWorkflowTarget = new Set(scan.skills.map(function(s) { return s.name_zh || s.name; }));
  const filteredWorkflows = scan.workflows.filter(function(w){return !skillWorkflowTarget.has(w.name_zh||w.name);}).slice(0,2);
  const topWorkflows = filteredWorkflows.map((item, i) => {
    const prefix = filteredWorkflows.length > 1 ? (i + 1) + ". " : "";
    const d = item.description_zh ? shortDesc(item.description_zh) : hasChinese(item.description) ? shortDesc(item.description) : item.description ? shortDesc(item.description) + "（需补充中文）" : "";
    return prefix + (d && d !== "未填写" ? (item.name_zh || item.name) + "：" + d : (item.name_zh || item.name));
  }).join("\n");

  const hasLinks = group.links && group.links.length > 0;
  const hasSkills = topSkills.length > 0;
  const hasWorkflows = topWorkflows.length > 0;
  const todos = (v2Fields && v2Fields.todos) || group.todos || [];
  const hasTodos = todos.length > 0;

  const groupName = group.group_name || group.name;
  const parts = [];
  parts.push("【" + groupName + " 群信息】\n📍 " + (group.positioning || "未在群注册表中记录") + "\n📁 " + (group.repo || "未在群注册表中记录"));
  if (hasLinks) parts.push(group.links.filter(function(l) { return l.url && l.url.trim(); }).map(function(l) { return "🔗 " + (l.name || "链接") + "：" + l.url; }).join("\n"));
  if (hasSkills) parts.push("🧩 " + topSkills);
  if (hasWorkflows) parts.push("⚙️ " + topWorkflows);
  if (hasTodos) parts.push("📋 " + todos.map(function(t, i) { return (i + 1) + ". " + t; }).join("\n"));
  return parts.join("\n");
}

export function processGroup(registry, state, group, mode) {
  const now = new Date().toISOString();
  const scan = scanRepo(group);
  const repoPath = realpathMaybe(group.repo_path || group.repo);

  // 从仓库 README 提取链接，同步到 Base 和群标签页
  const linkResult = syncAndRenderLinks(group, mode);
  if (linkResult.linksForRender) {
    group.links = linkResult.linksForRender;
  }

  const target = group.group_info_path || (repoPath ? join(repoPath, "GROUP_INFO.md") : null);
  let v2Fields = null;
  if (target && existsSync(target)) {
    try {
      const existing = readFileSync(target, "utf8");
      v2Fields = parseGroupInfoV2(existing);
    } catch (e) { /* ignore */ }
  }

  const markdown = renderGroupInfo(group, scan, v2Fields, now);
  const summary = renderPinSummary(group, scan, now, v2Fields);

  if (mode === "write" || mode === "apply") {
    if (!target) throw new Error("未在群注册表中记录 repo，无法写入 group-info.md");
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, markdown);
  }

  if (mode === "apply") {
    const runtime = stateFor(state, group);
    runtime.last_updated = now;
    runtime.last_updated_at = now;
    saveState(state);
  }

  return { group: group.name, mode, target, markdown, summary, linkSync: linkResult.summary };
}

/**
 * 从仓库 README 提取链接，同步到 Base「链接」字段和群标签页，
 * 然后用提取的链接替换 group.links 供后续渲染。
 */
export function syncAndRenderLinks(group, mode) {
  // 1. 反向同步：从 Base/标签页拉回 README，确保 README 是最全的链接集合
  const reverse = reverseSyncForGroup(group, mode);

  // 2. 正向同步：从 README（可能已更新）提取链接 → Base + 标签页
  const existingLinks = group.links || [];
  const result = syncLinks(group, group.record_id, existingLinks, mode);

  // 合并反向同步信息到结果中
  result.reverseSync = reverse;
  if (reverse.newLinks?.length > 0) {
    result.summary = (reverse.reason || "") + " → " + (result.summary || "");
  }

  if (result.links && result.links.length > 0) {
    // 使用 README 提取的链接渲染（保持 {name, url} 格式）
    const linksForRender = result.links.map(l => ({ name: l.name, url: l.url }));
    return { ...result, links: result.links, linksForRender };
  }
  return { ...result, links: result.links || [], linksForRender: null };
}
