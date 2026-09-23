import { existsSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const descriptionsPath = join(fileURLToPath(new URL("../../data/skill-descriptions.json", import.meta.url)));
let cache;

function sourceHash(skill) {
  const source = skill.description_zh || skill.description || skill.purpose || "";
  return createHash("sha256")
    .update(String(source))
    .digest("hex");
}

export function readSkillDescriptions() {
  if (cache) return cache;
  if (!existsSync(descriptionsPath)) throw new Error(`缺少模型生成的 Skill 描述资产：${descriptionsPath}`);
  let data;
  try { data = JSON.parse(readFileSync(descriptionsPath, "utf8")); }
  catch (error) { throw new Error(`Skill 描述资产不是有效 JSON：${error.message}`); }
  if (!data || data.version !== 1 || !data.skills || typeof data.skills !== "object") {
    throw new Error("Skill 描述资产格式无效");
  }
  cache = data.skills;
  return cache;
}

export function modelSkillDescription(skill, max) {
  const row = readSkillDescriptions()[skill.name];
  if (!row || typeof row.description_zh !== "string" || !row.description_zh.trim()) {
    throw new Error(`缺少模型生成的 Skill 描述：${skill.name}`);
  }
  if (row.source_sha256 !== sourceHash(skill)) {
    throw new Error(`Skill 描述已过期，请重新生成：${skill.name}`);
  }
  const band = { "高": "high", "中": "medium", "低": "low" }[skill.frequencyLabel];
  const description = String((band && row[`description_zh_${band}`]) || row.description_zh).trim();
  if (Array.from(description).length > max) {
    throw new Error(`模型生成的 ${skill.frequencyLabel || "Skill"} 描述超过 ${max} 字：${skill.name}`);
  }
  return description;
}
