import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { sensitiveName } from "./fields.js";
import { parseFrontmatter } from "./frontmatter.js";
import { hasChinese } from "./utils.js";
import { isPlaceholderUrl } from "./link-sync.js";

export function listSkillFiles(repo) {
  const files = [];
  let foundAny = false;
  for (const base of [".agents/skills", ".codex/skills", "skills"]) {
    const dir = join(repo, base);
    if (!existsSync(dir)) continue;
    foundAny = true;
    const found = spawnSync("find", [dir, "-maxdepth", "2", "-name", "SKILL.md", "-print"], { encoding: "utf8" });
    if (found.status === 0) files.push(...found.stdout.trim().split("\n").filter(Boolean));
  }
  if (!foundAny) {
    const found = spawnSync("find", [repo, "-maxdepth", "2", "-name", "SKILL.md", "-print"], { encoding: "utf8" });
    if (found.status === 0) files.push(...found.stdout.trim().split("\n").filter(Boolean));
  }
  return files.filter((file) => !sensitiveName.test(file)).sort();
}

export function scanSkills(repo) {
  return listSkillFiles(repo).map((file) => {
    const text = readFileSync(file, "utf8");
    const folder = file.split("/").slice(-2, -1)[0];
    return { ...parseFrontmatter(text, folder), file };
  }).filter((skill) => !/(群信息|group.info)/i.test(skill.name + (skill.name_zh || "")));
}

export function detectWorkflows(skills, repo) {
  const fromSkills = skills
    .filter((skill) => /(workflow|automation|自动化|工作流)/i.test(skill.name))
    .map((skill) => ({
      name: skill.name,
      name_zh: skill.name_zh || skill.name,
      description: skill.description || "Skill-backed workflow",
      description_zh: skill.description_zh || skill.description || ""
    }));

  const fromWkf = [];
  const wkfPath = join(repo, 'wkf_update.json');
  if (existsSync(wkfPath)) {
    try {
      const wkf = JSON.parse(readFileSync(wkfPath, 'utf8'));
      if (wkf.title && wkf.status === 'enabled') {
        const timer = wkf.steps?.find(s => s.type === 'TimerTrigger');
        fromWkf.push({
          name: wkf.title,
          name_zh: wkf.title,
          description: `定时触发：${timer?.data?.rule || '未知'}`,
          description_zh: `定时触发：${timer?.data?.rule || '未知'}`
        });
      }
    } catch (e) { /* ignore */ }
  }
  return [...fromSkills, ...fromWkf];
}

export function mergeWorkflows(scanned, manual) {
  const seen = new Set();
  const result = [];
  for (const item of [...(scanned || []), ...(manual || [])]) {
    const key = item.name_zh || item.name;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result;
}

export function scanDocDataSources(repo) {
  const files = ["README.md", "docs/TECH.md", "03_input/README.md"]
    .map((file) => join(repo, file))
    .filter((file) => existsSync(file) && !sensitiveName.test(file));
  const lines = [];
  for (const file of files) {
    const rel = file.slice(repo.length + 1);
    const text = readFileSync(file, "utf8");
    for (const line of text.split("\n")) {
      if (/(export\s|TOKEN|SECRET|PASSWORD|APP_SECRET)/i.test(line)) continue;
      if (/(多维表格|Base|bitable|飞书|Lark|Feishu)/i.test(line)) {
        // 跳过含占位符链接的行
        const urlMatch = line.match(/https?:\/\/[^\s)]+/);
        if (urlMatch && isPlaceholderUrl(urlMatch[0])) continue;
        lines.push(`- ${rel}：${line.trim().replace(/^[-#\s]+/, "")}`);
      }
    }
  }
  return lines.slice(0, 8);
}

export function scanRepo(group) {
  const repo = group.repo_path || group.repo;
  if (!repo || !existsSync(repo)) return { skills: [], workflows: [], dataSources: [], error: "绑定存在，但当前不可访问" };
  try {
    const skills = scanSkills(repo);
    return { skills, workflows: mergeWorkflows(detectWorkflows(skills, repo), group.manual_workflows), dataSources: scanDocDataSources(repo), error: null };
  } catch (error) {
    return { skills: [], workflows: group.manual_workflows || [], dataSources: [], error: error.message };
  }
}
