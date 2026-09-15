#!/usr/bin/env node
// update-all --apply 完成后自动衔接 top-all
import { spawnSync } from "node:child_process";
import { readState, attachState } from "./lib/state.js";
import { fetchGroupIndexGroups } from "./lib/base.js";
import { normalizeGroupName, readJson } from "./lib/utils.js";
import { scanRepo } from "./lib/scan.js";
import { processGroup } from "./lib/commands/update.js";
import { assertSkillUsageForApply, attachModelSkillDescriptions, normalizeSkillUsage, rankSkills, scopeSkillUsage, topGroup } from "./lib/commands/top.js";
import { renderList } from "./lib/commands/list.js";
import { selfTest } from "./lib/commands/self-test.js";
import { sortChatTabs } from "./lib/link-sync.js";

function usage() {
  console.log("Usage: group-info.mjs update --group <id|name> [--dry-run|--write|--apply] [--skip-if-recent] [--require-fresh] | update-all [--dry-run|--write|--apply] [--skip-if-recent] [--refresh] [--require-fresh] [--skill-usage-file <json>] | top --group <id|name> --dry-run|--apply [--skill-usage-file <json>] [--exclude-group <id|name>] [--require-fresh] | top-all --dry-run|--apply [--skill-usage-file <json>] [--exclude-group <id|name>] [--refresh] [--require-fresh] | list [--format json|md|table] [--refresh] [--with-meta] [--require-fresh] | sort-tabs --group <id|name> [--dry-run|--apply] [--require-fresh] | sort-tabs-all [--dry-run|--apply] [--refresh] [--require-fresh] | self-test");
}

function parseArgs(argv) {
  const args = { command: argv[2], mode: "dry-run", group: null };
  for (let i = 3; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--dry-run" || arg === "--write" || arg === "--apply") args.mode = arg.slice(2);
    else if (arg === "--group") args.group = argv[++i];
    else if (arg === "--skip-if-recent") args.skipIfRecent = true;
    else if (arg === "--refresh") args.refresh = true;
    else if (arg === "--with-meta") args.withMeta = true;
    else if (arg === "--require-fresh") args.requireFresh = true;
    else if (arg === "--format") args.format = argv[++i];
    else if (arg === "--exclude-group") {
      const value = argv[i + 1];
      if (!value || value.startsWith("--")) args.invalidExcludeGroup = true;
      else { (args.excludeGroups ||= []).push(value); i += 1; }
    }
    else if (arg === "--skill-usage-file") {
      const value = argv[i + 1];
      if (!value || value.startsWith("--")) args.invalidSkillUsageFile = true;
      else { args.skillUsageFile = value; i += 1; }
    }
  }
  return args;
}

function assertMixedIdentityPolicy(mode) {
  if (mode !== "apply") return;
  const readConfig = (command) => spawnSync("lark-cli", ["config", command], {
    encoding: "utf8",
    env: {
      ...process.env,
      LARKSUITE_CLI_NO_UPDATE_NOTIFIER: "1",
      LARKSUITE_CLI_NO_SKILLS_NOTIFIER: "1",
    },
  });
  const strict = readConfig("strict-mode");
  const defaultAs = readConfig("default-as");
  if (strict.status !== 0 || defaultAs.status !== 0) {
    const detail = [
      ["strict-mode", strict],
      ["default-as", defaultAs],
    ]
      .filter(([, result]) => result.status !== 0)
      .map(([command, result]) => `${command}: ${result.stderr?.trim() || result.stdout?.trim() || result.error?.message || `exit ${result.status}`}`)
      .join("; ");
    throw new Error(
      "无法读取当前 lark-cli 身份策略（" + detail + "）；未执行任何群信息写入。请先将当前 bridge Profile 配为 user-default。"
    );
  }
  const strictMode = strict.stdout.match(/strict-mode:\s*(\w+)/)?.[1];
  const defaultIdentity = defaultAs.stdout.match(/default-as:\s*(\w+)/)?.[1];
  if (strictMode !== "off" || defaultIdentity !== "auto") {
    throw new Error(
      `当前 lark-cli 身份策略为 strict-mode=${strictMode || "unknown"}, default-as=${defaultIdentity || "unknown"}；` +
      "group-info 同时需要 user（Base）和 bot（群消息），请一次性将当前 bridge Profile 配为 user-default，任务内不会切换身份。"
    );
  }
}

const args = parseArgs(process.argv);
if (!args.command) {
  usage();
  process.exit(1);
}
if (args.command === "self-test") {
  selfTest();
  process.exit(0);
}

if (args.withMeta && (args.command !== "list" || args.format !== "json")) {
  console.error("--with-meta 仅支持 list --format json");
  process.exit(2);
}

if (args.skillUsageFile && !["top", "top-all", "update-all"].includes(args.command)) {
  console.error("--skill-usage-file 仅支持 top/top-all/update-all");
  process.exit(2);
}
if (args.excludeGroups?.length && args.command !== "top" && args.command !== "top-all") {
  console.error("--exclude-group 仅支持 top/top-all");
  process.exit(2);
}
if (args.invalidSkillUsageFile) {
  console.error("--skill-usage-file 必须提供 JSON 文件路径");
  process.exit(2);
}
if (args.invalidExcludeGroup) {
  console.error("--exclude-group 必须提供群组 ID 或名称");
  process.exit(2);
}
if (args.mode === "apply" && ["top", "top-all", "update-all"].includes(args.command)) {
  try {
    assertSkillUsageForApply(args.mode, args.skillUsageFile);
  } catch (e) {
    console.error("[group-info] " + e.message);
    process.exit(2);
  }
}

try {
  assertMixedIdentityPolicy(args.mode);
} catch (e) {
  console.error("身份策略预检失败：" + e.message);
  process.exit(13);
}

const state = readState();
const requireFresh = args.requireFresh || args.mode === "write" || args.mode === "apply";
let registryData;
try {
  registryData = fetchGroupIndexGroups({
    refresh: args.refresh || requireFresh,
    requireFresh,
  });
} catch (error) {
  console.error("[group-info] " + error.message);
  process.exit(error.exitCode || 11);
}
const registry = attachState({ groups: registryData.groups, meta: registryData.meta }, state);
const wantedGroup = normalizeGroupName(args.group);
const excludedGroups = new Set((args.excludeGroups || []).map(normalizeGroupName));
const isExcluded = (group) => [group.id, group.name, group.group_name]
  .some((value) => excludedGroups.has(normalizeGroupName(value)));
const hasRepoBinding = (group) => Boolean(group.repo_path || group.repo);
const THREE_DAYS_MS = 72 * 60 * 60 * 1000;

let groups;
if (args.command === "update-all" || args.command === "top-all" || args.command === "sort-tabs-all") {
  groups = registry.groups.filter((group) => group.auto_update !== false && !isExcluded(group) && hasRepoBinding(group));
} else {
  groups = registry.groups.filter((group) =>
    group.auto_update !== false && !isExcluded(group) &&
    (group.id === wantedGroup || group.name === wantedGroup || group.group_name === wantedGroup)
  );
}

if (args.skipIfRecent) {
  const now = Date.now();
  const filtered = groups.filter((group) => {
    const last = group.last_updated || group.last_updated_at;
    if (!last) return true;
    return (now - new Date(last).getTime()) >= THREE_DAYS_MS;
  });
  console.log("skip-if-recent: 过滤 " + (groups.length - filtered.length) + " 个群，剩余 " + filtered.length + " 个");
  groups = filtered;
}

const failures = [];
const updateSucceeded = new Set();

let skillUsage = null;
if (args.skillUsageFile) {
  try {
    const usage = normalizeSkillUsage(readJson(args.skillUsageFile));
    const scopeNames = new Set();
    for (const group of registry.groups.filter((item) => item.auto_update !== false && !isExcluded(item) && hasRepoBinding(item))) {
      const scan = scanRepo(group);
      if (scan.error) throw new Error(`群 ${group.name} 无法扫描，不能计算完整群置顶 Skill 分母：${scan.error}`);
      for (const skill of scan.skills) scopeNames.add(skill.name);
    }
    skillUsage = scopeSkillUsage(usage, scopeNames);
    for (const group of groups) {
      const scan = scanRepo(group);
      if (scan.error) throw new Error(`群 ${group.name} 无法扫描，不能生成群置顶：${scan.error}`);
      attachModelSkillDescriptions(scan.skills, skillUsage);
    }
  } catch (error) {
    console.error("[group-info] Skill 使用统计预检失败：" + error.message);
    process.exit(12);
  }
}

if (args.command === "list") {
  console.log(renderList(registry, args.format, args));
} else if (args.command === "top" || args.command === "top-all") {
  for (const group of groups) {
    try {
      topGroup(registry, state, group, args.mode, skillUsage);
    } catch (e) {
      console.error('群 ' + group.name + ' 置顶失败：' + e.message);
      failures.push({ group: group.name, command: 'top', error: e.message });
    }
  }
} else if (args.command === "sort-tabs" || args.command === "sort-tabs-all") {
  if (!groups.length) {
    console.error("未在群注册表中记录");
    process.exit(2);
  }
  for (const group of groups) {
    const chatId = group.chat_id;
    if (!chatId) { console.log(`${group.name}: 无 chat_id，跳过`); continue; }
    if (args.mode === "dry-run") {
      console.log(`${group.name}: dry-run — 将排序标签页（消息 → 链接 → 系统标签 → GitHub）`);
    } else {
      try {
        console.log(`${group.name}: 排序中…`);
        if (!sortChatTabs(chatId)) throw new Error("标签页排序未确认成功");
        console.log(`${group.name}: 完成`);
      } catch (e) {
        console.error(`${group.name}: 标签页排序失败：${e.message}`);
        failures.push({ group: group.name, command: "sort-tabs", error: e.message });
      }
    }
  }
} else {
  if (!groups.length) {
    console.error("未在群注册表中记录");
    process.exit(2);
  }
  for (const group of groups) {
    try {
      const result = processGroup(registry, state, group, args.mode);
      if (args.command === "update-all" && args.mode === "apply") updateSucceeded.add(group.id || group.name);
      console.log(`\n${result.group} :: ${result.mode} :: ${result.target || "no target"} ===\n`);
      console.log("----- GROUP_INFO.md -----");
      console.log(result.markdown);
      console.log("----- Lark Pin Summary -----");
      console.log(result.summary);
    } catch (e) {
      console.error('群 ' + group.name + ' 更新失败：' + e.message);
      failures.push({ group: group.name, command: 'update', error: e.message });
    }
  }
  // update-all --apply 完成后自动执行置顶
  if (args.command === 'update-all' && args.mode === 'apply') {
    console.log('\n=== update-all 完成，自动执行 top-all ===\n');
    for (const group of groups) {
      if (!updateSucceeded.has(group.id || group.name)) continue;
      try {
        topGroup(registry, state, group, args.mode, skillUsage);
      } catch (e) {
        console.error('群 ' + group.name + ' 置顶失败：' + e.message);
        failures.push({ group: group.name, command: 'top', error: e.message });
      }
    }
  }
}

// 批量命令失败汇总：有失败时以非零退出码结束，让自动化调用方可感知
if (failures.length > 0) {
  console.error(`\n=== 失败汇总（${failures.length} 个）===`);
  for (const f of failures) {
    console.error(`  ✗ ${f.group} (${f.command}): ${f.error}`);
  }
  process.exit(1);
}
