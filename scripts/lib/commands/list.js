import { scanRepo } from "../scan.js";

export function listProjects(registry) {
  const rows = registry.groups
    .filter((g) => g.auto_update !== false)
    .sort((a, b) => (a.priority || 99) - (b.priority || 99))
    .map((g) => {
      const scan = scanRepo(g);
      const entry = (g.links && g.links.length > 0 && g.links[0].url) || (g.repo ? "https://github.com/SimplyY/" + g.name : "");
      return {
        priority: g.priority || 99,
        chat_id: g.chat_id || null,
        group_name: g.group_name || g.name,
        name: g.name,
        positioning: g.positioning || "",
        entry: entry,
        tags: scan.skills.slice(0, 3).map((s) => s.name_zh || s.name).join("、"),
        repo: g.repo || ""
      };
    });
  return rows;
}

export function renderList(registry, format, opts = {}) {
  const rows = listProjects(registry);
  if (opts.withMeta && format !== "json") {
    throw new Error("--with-meta 仅支持 --format json");
  }
  if (format === "json") {
    return JSON.stringify(opts.withMeta ? { items: rows, meta: registry.meta } : rows, null, 2);
  }
  if (format === "md") {
    const lines = ["| # | 项目 | 定位 | 入口 | 标签 |", "|---|------|------|------|------|"];
    rows.forEach((r) => {
      lines.push("| " + r.priority + " | " + r.name + " | " + r.positioning + " | " + (r.entry ? "[链接](" + r.entry + ")" : "") + " | " + r.tags + " |");
    });
    return lines.join("\n");
  }
  const lines = [];
  lines.push("序号 | 项目 | 定位 | 入口 | 标签");
  lines.push("-----|------|------|------|-----");
  rows.forEach((r) => lines.push(r.priority + " | " + r.name + " | " + r.positioning + " | " + (r.entry || "") + " | " + r.tags));
  return lines.join("\n");
}
