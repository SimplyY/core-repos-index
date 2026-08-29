import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { scanRepo } from "../scan.js";
import { parseGroupInfoV2 } from "../frontmatter.js";
import { stateFor, saveState } from "../state.js";
import {
  groupIcon, realpathMaybe, cleanSkillDesc, cleanSkillDescCompleteSentence
} from "../utils.js";
import { renderPinSummary } from "./update.js";

const USAGE_WINDOW_DAYS = 30;
const LOW_FREQUENCY_CALLS = 3;
const HIGH_FREQUENCY_SHARE = 0.3;

function commandError(result) {
  return result?.stderr || result?.stdout || result?.error?.message || "未知错误";
}

function usageNumber(value, label) {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new Error(`Skill 使用统计 ${label} 无效`);
  }
  return value;
}

export function normalizeSkillUsage(report) {
  if (!report || !Array.isArray(report.windows) || !report.windows.includes(USAGE_WINDOW_DAYS)) {
    throw new Error("Skill 使用统计缺少 30 天窗口");
  }
  const profiles = Array.isArray(report.profiles) ? report.profiles : [];
  for (const name of ["desktop", "deep"]) {
    const profile = profiles.find((item) => item && item.profile === name);
    if (!profile || profile.available !== true) throw new Error(`Skill 使用统计缺少完整 ${name} 来源`);
  }
  if (!Array.isArray(report.skills)) throw new Error("Skill 使用统计缺少 skills");

  const byName = new Map();
  for (const row of report.skills) {
    if (!row || typeof row.name !== "string" || !row.name.trim() || row.name !== row.name.trim()) throw new Error("Skill 使用统计包含无效名称");
    if (byName.has(row.name)) throw new Error(`Skill 使用统计包含重复名称：${row.name}`);
    if (!row.calls_by_window || typeof row.calls_by_window !== "object" || Array.isArray(row.calls_by_window)
      || !Object.prototype.hasOwnProperty.call(row.calls_by_window, String(USAGE_WINDOW_DAYS))) {
      throw new Error(`Skill 使用统计缺少 ${row.name} 的 30 天次数`);
    }
    byName.set(row.name, {
      calls: usageNumber(row.calls_by_window[String(USAGE_WINDOW_DAYS)], `${row.name}.calls_by_window[30]`),
      activeDays: usageNumber(row.activeDays, `${row.name}.activeDays`),
    });
  }

  return { byName };
}

function compareUsage(a, b) {
  return b.calls - a.calls || b.activeDays - a.activeDays || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
}

export function scopeSkillUsage(usage, skillNames) {
  if (!usage || !(usage.byName instanceof Map)) throw new Error("缺少 Skill 使用统计");
  const names = [...new Set(skillNames)];
  const scoped = names.map((name) => {
    const row = usage.byName.get(name);
    if (!row) throw new Error(`Skill 使用统计未覆盖：${name}`);
    return { name, ...row };
  }).sort(compareUsage);
  const active = scoped.filter((row) => row.calls >= LOW_FREQUENCY_CALLS);
  const highCount = Math.ceil(active.length * HIGH_FREQUENCY_SHARE);
  const highNames = new Set(active.slice(0, highCount).map((row) => row.name));
  const frequencyByName = new Map(scoped.map((row) => [
    row.name,
    row.calls < LOW_FREQUENCY_CALLS
      ? { label: "低", descriptionMax: 10 }
      : highNames.has(row.name)
        ? { label: "高", descriptionMax: 30 }
        : { label: "中", descriptionMax: 20 },
  ]));
  return { ...usage, frequencyByName, scopedNames: new Set(names) };
}

export function rankSkills(skills, usage) {
  if (!usage || !(usage.byName instanceof Map) || !(usage.frequencyByName instanceof Map)) throw new Error("缺少 Skill 使用统计");
  return skills.map((skill) => {
    const row = usage.byName.get(skill.name);
    if (!row) throw new Error(`Skill 使用统计未覆盖：${skill.name}`);
    const frequency = usage.frequencyByName.get(skill.name);
    if (!frequency) throw new Error(`Skill 未纳入群置顶分档范围：${skill.name}`);
    return { ...skill, frequencyLabel: frequency.label, frequencyDescriptionMax: frequency.descriptionMax, usageCalls: row.calls, usageActiveDays: row.activeDays };
  }).sort((a, b) => b.usageCalls - a.usageCalls || b.usageActiveDays - a.usageActiveDays || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

function orderedSkillsFor(scan, skillUsage) {
  if (scan.error) throw new Error(`Skill 扫描失败：${scan.error}`);
  if (!skillUsage) return scan.skills;
  return rankSkills(scan.skills, skillUsage);
}

function renderTopNoticeCard(group, scan, now, v2Fields, orderedSkills = scan.skills) {
  const icon = groupIcon(group, v2Fields);
  const nameZh = (v2Fields && v2Fields.name_zh) || group.name;
  const positioning = group.positioning || '';
  const repo = group.repo || '';

  const skillLines = orderedSkills.map((s, i) => {
    const n = s.name_zh || s.name;
    const label = s.frequencyLabel ? `${n} (${s.frequencyLabel})` : n;
    const d = s.frequencyLabel
      ? cleanSkillDescCompleteSentence(s, s.frequencyDescriptionMax || 25)
      : cleanSkillDesc(s, s.frequencyDescriptionMax || 25);
    return (i + 1) + '. ' + (d ? label + '：' + d : label);
  });

  const skillWorkflowTarget = new Set(scan.skills.map(s => s.name_zh || s.name));
  const filteredWorkflows = scan.workflows.filter(w => !skillWorkflowTarget.has(w.name_zh || w.name)).slice(0, 3);
  const workflowLines = filteredWorkflows.map((w, i) => {
    const d = cleanSkillDesc(w);
    return (i + 1) + '. ' + (d ? (w.name_zh || w.name) + '：' + d : (w.name_zh || w.name));
  });

  const todos = (v2Fields && v2Fields.todos) || group.todos || [];
  const todoLines = todos.map((t, i) => (i + 1) + '. ' + t);

  const hasLinks = group.links && group.links.some(l => l.url && l.url.trim());

  const elements = [];
  const header = icon + ' **' + nameZh + ' 群信息**';
  elements.push({ tag: 'markdown', content: header });
  elements.push({ tag: 'hr' });

  const infoParts = [];
  infoParts.push('📍 定位：' + (positioning || '未在群注册表中记录'));
  infoParts.push('📁 工作目录：' + (repo || '未在群注册表中记录'));
  if (hasLinks) {
    const linkText = group.links.filter(l => l.url && l.url.trim()).map(l => '🔗 [' + (l.name || '链接') + '](' + l.url + ')').join('  ');
    infoParts.push(linkText);
  }
  elements.push({ tag: 'markdown', content: infoParts.join('\n') });

  if (skillLines.length > 0) {
    elements.push({ tag: 'hr' });
    elements.push({ tag: 'markdown', content: '🧩 **Skill**\n' + skillLines.join('\n') });
  }
  if (workflowLines.length > 0) {
    elements.push({ tag: 'markdown', content: '⚙️ **主要 Workflow**\n' + workflowLines.join('\n') });
  }
  if (todoLines.length > 0) {
    elements.push({ tag: 'hr' });
    elements.push({ tag: 'markdown', content: '📋 **待办**\n' + todoLines.join('\n') });
  }

  return {
    schema: "2.0",
    config: { update_multi: true },
    body: {
      direction: "vertical",
      elements: elements
    }
  };
}

function topSummaryUnchanged(group, summary) {
  const oldSummary = group.last_top_summary || "";
  return oldSummary === summary;
}

export function topNoticeIdempotencyKey(group, summary) {
  const digest = createHash("sha256")
    .update(String(group.chat_id || group.id || group.name || ""))
    .update("\0")
    .update(String(summary || ""))
    .digest("hex");
  return `gi-${digest.slice(0, 47)}`;
}

export function topGroup(registry, state, group, mode, skillUsage = null) {
  const now = new Date().toISOString();
  const scan = scanRepo(group);
  const orderedSkills = orderedSkillsFor(scan, skillUsage);
  const repoPath = realpathMaybe(group.repo_path || group.repo);
  const target = group.group_info_path || (repoPath ? join(repoPath, "GROUP_INFO.md") : null);
  let v2Fields = null;
  if (target && existsSync(target)) {
    try {
      v2Fields = parseGroupInfoV2(readFileSync(target, "utf8"));
    } catch (e) { /* ignore */ }
  }
  const summary = renderPinSummary(group, scan, now, v2Fields, orderedSkills);
  const chatId = group.chat_id;

  if (!chatId) {
    const err3 = "错误：群 " + group.name + " 未绑定 chat_id（registry.chat_id 为 null），无法发送群置顶。";
    console.error(err3);
    throw new Error(err3);
  }

  if (topSummaryUnchanged(group, summary)) {
    console.log("\n=== " + group.name + " :: top-notice-skip ===");
    console.log("群置顶摘要内容无变化，跳过置顶");
    return;
  }

  if (mode !== "apply") {
    console.log("\n=== " + group.name + " :: top-notice-dry-run ===\n");
    console.log("chat_id: " + chatId);
    const card = renderTopNoticeCard(group, scan, now, v2Fields, orderedSkills);
    console.log("\n----- 将发送到飞书群的卡片 JSON -----");
    console.log(JSON.stringify(card, null, 2));
    console.log("\n----- 群置顶摘要（用于变更对比）-----");
    console.log(summary);
    console.log("\n（dry-run 模式，未实际发送）");
    return;
  }

  console.log("\n=== " + group.name + " :: top-notice-apply ===\n");

  const card = renderTopNoticeCard(group, scan, now, v2Fields, orderedSkills);
  const cardJson = JSON.stringify(card);
  const idempotencyKey = topNoticeIdempotencyKey(group, summary);

  console.log("发送卡片到群 " + chatId + " ...");
  const sendResult = spawnSync("lark-cli", [
    "im", "+messages-send",
    "--as", "bot",
    "--chat-id", chatId,
    "--content", cardJson,
    "--msg-type", "interactive",
    "--idempotency-key", idempotencyKey,
    "--format", "json"
  ], { encoding: "utf8", maxBuffer: 10 * 1024 * 1024 });

  if (sendResult.status !== 0) {
    const err4 = "发送卡片失败：" + commandError(sendResult);
    console.error(err4);
    throw new Error(err4);
  }

  let sendData;
  try {
    sendData = JSON.parse(sendResult.stdout);
  } catch (e) {
    const err5 = "解析发送响应失败：" + sendResult.stdout;
    console.error(err5);
    throw new Error(err5);
  }
  if (sendData?.ok !== true) {
    const err5b = "发送卡片响应未确认成功：" + sendResult.stdout;
    console.error(err5b);
    throw new Error(err5b);
  }

  const messageId = sendData?.data?.message_id || sendData?.message_id;
  if (!messageId) {
    const err6 = "发送卡片成功但未获取到 message_id：" + sendResult.stdout;
    console.error(err6);
    throw new Error(err6);
  }
  console.log("卡片已发送，message_id: " + messageId);

  console.log("群置顶消息 ...");
  const topNoticeData = JSON.stringify({
    chat_top_notice: [{ action_type: "1", message_id: messageId }]
  });
  const topResult = spawnSync("lark-cli", [
    "api", "POST",
    "/open-apis/im/v1/chats/" + chatId + "/top_notice/put_top_notice",
    "--as", "bot",
    "--data", topNoticeData,
    "--format", "json"
  ], { encoding: "utf8", maxBuffer: 10 * 1024 * 1024 });

  let topData;
  try { topData = JSON.parse(topResult.stdout); } catch { topData = null; }
  if (topResult.status !== 0 || topData?.ok !== true) {
    const err7 = "群置顶失败：" + commandError(topResult);
    console.error(err7);
    throw new Error(err7);
  }

  console.log("消息已群置顶");

  const oldSummary = group.last_top_summary || "";
  const newSummary = summary;
  if (oldSummary !== newSummary) {
    const oldSections = (oldSummary || "").split("\n");
    const newSections = newSummary.split("\n");
    const diffLines = [];
    const maxLen = Math.max(oldSections.length, newSections.length);
    for (let i = 0; i < maxLen; i++) {
      const oldLine = oldSections[i];
      const newLine = newSections[i];
      if (oldLine !== newLine) {
        if (oldLine !== undefined) diffLines.push("- " + oldLine);
        if (newLine !== undefined) diffLines.push("+ " + newLine);
      }
    }
    if (diffLines.length > 0 && oldSummary) {
      console.log("\n--- AGENT_DIFF ---");
      console.log("group_name=" + (group.group_name || group.name));
      console.log("old=" + Buffer.from(oldSummary).toString("base64"));
      console.log("new=" + Buffer.from(newSummary).toString("base64"));
      console.log("--- END_AGENT_DIFF ---");
    }
  }
  const runtime = stateFor(state, group);
  runtime.top_notice_message_id = messageId;
  runtime.last_topped_at = now;
  runtime.last_top_summary = summary;
  saveState(state);
  console.log("state 已更新：top_notice_message_id=" + messageId);
}
