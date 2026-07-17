import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { scanRepo } from "../scan.js";
import { parseGroupInfoV2 } from "../frontmatter.js";
import { stateFor, saveState } from "../state.js";
import {
  groupIcon, realpathMaybe, shortDesc, hasChinese, firstSentence
} from "../utils.js";
import { renderPinSummary } from "./update.js";

function renderTopNoticeCard(group, scan, now, v2Fields) {
  const icon = groupIcon(group, v2Fields);
  const nameZh = (v2Fields && v2Fields.name_zh) || group.name;
  const positioning = group.positioning || '';
  const repo = group.repo || '';

  const skillLines = scan.skills.map((s, i) => {
    const n = s.name_zh || s.name;
    const d = shortDesc(s.description_zh || s.description);
    return (i + 1) + '. ' + (d ? n + '：' + d : n);
  });

  const skillWorkflowTarget = new Set(scan.skills.map(s => s.name_zh || s.name));
  const filteredWorkflows = scan.workflows.filter(w => !skillWorkflowTarget.has(w.name_zh || w.name)).slice(0, 3);
  const workflowLines = filteredWorkflows.map((w, i) => {
    const d = w.description_zh ? shortDesc(w.description_zh) : shortDesc(w.description);
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

export function topGroup(registry, state, group, mode) {
  const now = new Date().toISOString();
  const scan = scanRepo(group);
  const repoPath = realpathMaybe(group.repo_path || group.repo);
  const target = group.group_info_path || (repoPath ? join(repoPath, "GROUP_INFO.md") : null);
  let v2Fields = null;
  if (target && existsSync(target)) {
    try {
      v2Fields = parseGroupInfoV2(readFileSync(target, "utf8"));
    } catch (e) { /* ignore */ }
  }
  const summary = renderPinSummary(group, scan, now, v2Fields);
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
    const card = renderTopNoticeCard(group, scan, now, v2Fields);
    console.log("\n----- 将发送到飞书群的卡片 JSON -----");
    console.log(JSON.stringify(card, null, 2));
    console.log("\n----- 群置顶摘要（用于变更对比）-----");
    console.log(summary);
    console.log("\n（dry-run 模式，未实际发送）");
    return;
  }

  console.log("\n=== " + group.name + " :: top-notice-apply ===\n");

  const card = renderTopNoticeCard(group, scan, now, v2Fields);
  const cardJson = JSON.stringify(card);

  console.log("发送卡片到群 " + chatId + " ...");
  const sendResult = spawnSync("lark-cli", [
    "im", "+messages-send",
    "--as", "bot",
    "--chat-id", chatId,
    "--content", cardJson,
    "--msg-type", "interactive",
    "--format", "json"
  ], { encoding: "utf8", maxBuffer: 10 * 1024 * 1024 });

  if (sendResult.status !== 0) {
    const err4 = "发送卡片失败：" + (sendResult.stderr || sendResult.stdout);
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

  if (topResult.status !== 0) {
    const err7 = "群置顶失败：" + (topResult.stderr || topResult.stdout);
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
