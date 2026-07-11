#!/usr/bin/env node
// update-all --apply 完成后自动衔接 top-all
import { readState, attachState } from "./lib/state.js";
import { fetchGroupIndexGroups } from "./lib/base.js";
import { normalizeGroupName } from "./lib/utils.js";
import { processGroup } from "./lib/commands/update.js";
import { topGroup } from "./lib/commands/top.js";
import { renderList } from "./lib/commands/list.js";
import { selfTest } from "./lib/commands/self-test.js";
import { sortChatTabs } from "./lib/link-sync.js";

function usage() {
  console.log("Usage: group-info.mjs update --group <id|name> [--dry-run|--write|--apply] [--skip-if-recent] | update-all [--dry-run|--write|--apply] [--skip-if-recent] [--refresh] | top --group <id|name> --dry-run|--apply | top-all [--dry-run|--apply] [--refresh] | list [--format json|md|table] [--refresh] | sort-tabs --group <id|name> [--dry-run|--apply] | sort-tabs-all [--dry-run|--apply] [--refresh] | list [--format json|md|table] [--refresh] | self-test");
}

function parseArgs(argv) {
  const args = { command: argv[2], mode: "dry-run", group: null };
  for (let i = 3; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--dry-run" || arg === "--write" || arg === "--apply") args.mode = arg.slice(2);
    else if (arg === "--group") args.group = argv[++i];
    else if (arg === "--skip-if-recent") args.skipIfRecent = true;
    else if (arg === "--refresh") args.refresh = true;
    else if (arg === "--format") args.format = argv[++i];
  }
  return args;
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

const state = readState();
const registry = attachState({ groups: fetchGroupIndexGroups({ refresh: args.refresh }) }, state);
const wantedGroup = normalizeGroupName(args.group);
const THREE_DAYS_MS = 72 * 60 * 60 * 1000;

let groups;
if (args.command === "update-all" || args.command === "top-all" || args.command === "sort-tabs-all") {
  groups = registry.groups.filter((group) => group.auto_update !== false);
} else {
  groups = registry.groups.filter((group) =>
    group.id === wantedGroup || group.name === wantedGroup || group.group_name === wantedGroup
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

if (args.command === "list") {
  console.log(renderList(registry, args.format));
} else if (args.command === "top" || args.command === "top-all") {
  for (const group of groups) {
    try {
      topGroup(registry, state, group, args.mode);
    } catch (e) {
      console.error('群 ' + group.name + ' 置顶失败：' + e.message);
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
      console.log(`${group.name}: 排序中…`);
      sortChatTabs(chatId);
      console.log(`${group.name}: 完成`);
    }
  }
} else {
  if (!groups.length) {
    console.error("未在群注册表中记录");
    process.exit(2);
  }
  for (const group of groups) {
    const result = processGroup(registry, state, group, args.mode);
    console.log(`\n${result.group} :: ${result.mode} :: ${result.target || "no target"} ===\n`);
    console.log("----- GROUP_INFO.md -----");
    console.log(result.markdown);
    console.log("----- Lark Pin Summary -----");
    console.log(result.summary);
  }
  // update-all --apply 完成后自动执行置顶
  if (args.command === 'update-all' && args.mode === 'apply') {
    console.log('\n=== update-all 完成，自动执行 top-all ===\n');
    for (const group of groups) {
      try {
        topGroup(registry, state, group, args.mode);
      } catch (e) {
        console.error('群 ' + group.name + ' 置顶失败：' + e.message);
        // 继续处理下一个群，不中断整个流程
      }
    }
  }
}
