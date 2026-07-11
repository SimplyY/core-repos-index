#!/usr/bin/env node
import { existsSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
import { fetchGroupIndexGroups } from "./lib/base.js";
import { reverseSyncForGroup } from "./lib/link-sync.js";

// 主流程
async function main() {
  const mode = process.argv[2] || "dry-run";
  const apply = mode === "apply";

  console.error("[reverse-link-sync] 拉取群列表...");
  const groups = fetchGroupIndexGroups({ refresh: true });

  const results = [];

  for (const g of groups) {
    const repoPath = g.repo_path || g.repo;
    if (!repoPath || !existsSync(repoPath)) {
      results.push({ name: g.name, status: "skip", reason: "无仓库路径" });
      continue;
    }

    // 复用 link-sync.js 的反向同步逻辑
    const r = reverseSyncForGroup(g, apply ? "apply" : "dry-run");

    results.push({
      name: g.name,
      status: r.ok ? (r.newLinks.length > 0 ? "ok" : "unchanged") : "fail",
      newCount: r.newLinks.length,
      reason: r.reason,
    });

    console.error(`\n=== ${g.name} ===`);
    console.error(`  ${r.reason}`);
  }

  console.error("\n\n=== 汇总 ===");
  for (const r of results) {
    const icon = r.status === "ok" ? "✅" : r.status === "unchanged" ? "🔍" : "⚠️";
    console.error(`${icon} ${r.name}: ${r.status} | 新增=${r.newCount}${r.reason ? " | " + r.reason : ""}`);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
