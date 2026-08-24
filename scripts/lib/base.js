import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
import { groupIndexBaseToken, groupIndexTableId, groupIndexFields } from "./fields.js";
import { groupIdFromName, parseLinks, parseManualWorkflows, parseTextItems, parsePriority } from "./utils.js";

export function normalizeBaseRow(row, recordId) {
  const project = String(row["项目"] || "").trim();
  const repo = String(row["仓库路径"] || "").trim();
  const repoUrl = parseLinks(row["仓库链接"])[0]?.url || "";
  const links = parseLinks(row["链接"]);
  return {
    id: groupIdFromName(project),
    name: project,
    chat_id: String(row["群 ID"] || "").trim(),
    group_name: project,
    repo,
    repo_path: repo,
    repo_url: repoUrl,
    group_info_path: repo ? join(repo, "GROUP_INFO.md") : "",
    positioning: String(row["定位"] || "").trim(),
    bot: "Codex / Code X bot",
    auto_update: true,
    priority: parsePriority(row["优先级"]),
    links,
    manual_workflows: parseManualWorkflows(row["工作流"]),
    todos: parseTextItems(row["待办"] || row["TODO"]),
    notes: String(row["备注"] || "").trim()
    ,
    record_id: recordId || "",
  };
}

const CACHE_PATH = join(__dirname, "..", "..", "group_cache.json");
const CACHE_TTL_MS = 2 * 60 * 60 * 1000; // 2 小时

function readCache() {
  if (!existsSync(CACHE_PATH)) return null;
  try {
    const raw = JSON.parse(readFileSync(CACHE_PATH, "utf8"));
    if (!raw || !raw.ts || !Array.isArray(raw.groups)) return null;
    return raw;
  } catch {
    return null;
  }
}

function writeCache(groups, ts = Date.now()) {
  try {
    writeFileSync(CACHE_PATH, JSON.stringify({ ts, groups }, null, 2));
  } catch {
    // 写缓存失败不阻塞主流程
  }
}

function getFromCache() {
  const cache = readCache();
  if (!cache) return null;
  const age = Date.now() - cache.ts;
  if (age > CACHE_TTL_MS) return null;
  return { groups: cache.groups, ts: cache.ts };
}

export function buildRegistryMeta(source, fetchedAt, now = Date.now()) {
  const age = Math.max(0, Math.floor((now - fetchedAt) / 1000));
  return {
    source,
    fetched_at: new Date(fetchedAt).toISOString(),
    age,
    degraded: source === "stale-cache",
  };
}

export function fetchGroupIndexGroups(opts = {}) {
  const { refresh = false, requireFresh = false } = opts;

  const fallbackOrThrow = (code, message) => {
    if (!requireFresh) {
      const cache = readCache();
      if (cache) {
        return { groups: cache.groups, meta: buildRegistryMeta("stale-cache", cache.ts) };
      }
    }
    const error = new Error(message);
    error.exitCode = code;
    throw error;
  };

  if (!refresh && !requireFresh) {
    const result = getFromCache();
    if (result) {
      console.error("[group-info] 使用缓存群列表（" + Math.round((Date.now() - result.ts) / 1000) + " 秒前）");
      return { groups: result.groups, meta: buildRegistryMeta("cache", result.ts) };
    }
  }

  console.error("[group-info] 从多维表格拉取群列表...");
  const rows = [];
  let offset = 0;
  while (true) {
    const args = [
      "base", "+record-list",
      "--base-token", groupIndexBaseToken,
      "--table-id", groupIndexTableId,
      "--limit", "200",
      "--offset", String(offset),
      "--as", "user",
      "--format", "json"
    ];
    for (const field of groupIndexFields) args.push("--field-id", field);
    const result = spawnSync("lark-cli", args, {
      encoding: "utf8",
      maxBuffer: 10 * 1024 * 1024,
      env: {
        ...process.env,
        LARKSUITE_CLI_NO_UPDATE_NOTIFIER: "1",
        LARKSUITE_CLI_NO_SKILLS_NOTIFIER: "1"
      }
    });
    if (result.status !== 0) {
      const detail = result.stderr || result.stdout || result.error?.message || "未知错误";
      return fallbackOrThrow(11, "读取 group index 多维表格失败：" + detail);
    }
    let data;
    try {
      data = JSON.parse(result.stdout);
    } catch (error) {
      return fallbackOrThrow(11, "解析 group index 多维表格响应失败：" + error.message);
    }
    const fields = data?.data?.fields || groupIndexFields;
    for (const row of data?.data?.data || []) {
      const item = {};
      fields.forEach((field, index) => { item[field] = row[index]; });
      const rid = (data?.data?.record_id_list || [])[rows.length] || "";
      rows.push({ item, rid });
    }
    if (!data?.data?.has_more) break;
    offset += 200;
  }
  const groups = rows.map(({ item, rid }) => normalizeBaseRow(item, rid)).filter((group) => group.name);
  if (!groups.length) {
    return fallbackOrThrow(12, "group index 多维表格没有项目记录");
  }
  const fetchedAt = Date.now();
  writeCache(groups, fetchedAt);
  return { groups, meta: buildRegistryMeta("live", fetchedAt) };
}
