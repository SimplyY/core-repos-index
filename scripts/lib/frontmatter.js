export function parseFrontmatter(text, fallbackName) {
  const match = text.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return { name: fallbackName, name_zh: fallbackName, description: "", description_zh: "" };
  const fields = {};
  const lines = match[1].split("\n");
  let lastKey = null;
  let blockLines = [];
  for (const line of lines) {
    if (lastKey && /^\s{2,}/.test(line)) {
      blockLines.push(line.trim());
      continue;
    }
    if (lastKey && blockLines.length) {
      fields[lastKey] = blockLines.join(" ");
      blockLines = [];
      lastKey = null;
    }
    const item = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!item) continue;
    const key = item[1];
    const raw = item[2].replace(/^["']|["']$/g, "");
    if (/^[>|]-?$/.test(raw)) {
      lastKey = key;
      continue;
    }
    fields[key] = raw;
  }
  if (lastKey && blockLines.length) {
    fields[lastKey] = blockLines.join(" ");
  }
  return {
    name: fields.name || fallbackName,
    name_zh: fields.name_zh || fields.name || fallbackName,
    description: fields.description || "",
    description_zh: fields.description_zh || fields.description || ""
  };
}

export function parseGroupInfoV2(text) {
  if (!text) return null;
  const match = text.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return null;
  const fields = {};
  const lines = match[1].split("\n");
  let lastKey = null, blockLines = [];
  for (const line of lines) {
    const newKeyMatch = line.match(/^(\w+):\s*(.*)$/);
    if (newKeyMatch) {
      if (lastKey && blockLines.length) setField(fields, lastKey, blockLines.join(" "));
      lastKey = newKeyMatch[1];
      blockLines = [];
      let val = newKeyMatch[2].trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'")))
        val = val.slice(1, -1);
      if (val === ">-" || val === "|" || val === ">") continue;
      blockLines.push(val);
    } else if (lastKey && line.trim()) {
      blockLines.push(line.trim());
    }
  }
  if (lastKey && blockLines.length) setField(fields, lastKey, blockLines.join(" "));
  return Object.keys(fields).length > 0 ? fields : null;
}

export function setField(fields, key, val) {
  if (key === 'tags') {
    fields[key] = val.split(/[,，]\s*/).filter(Boolean);
  } else if (key === 'todos') {
    try { fields[key] = JSON.parse(val); } catch (e) { fields[key] = []; }
  } else if (key === 'priority') {
    fields[key] = parseInt(val, 10) || undefined;
  } else {
    fields[key] = val;
  }
}

export function defaultDetail(group, scan) {
  const parts = [group.positioning || ''];
  if (scan.skills.length > 0) {
    const skillDescs = scan.skills
      .map((s) => (s.description_zh || s.description || ''))
      .filter(Boolean)
      .slice(0, 2);
    if (skillDescs.length > 0) parts.push(skillDescs.join('；'));
  }
  return parts.filter(Boolean).join('。').replace(/。{2,}/g, '。');
}

export function defaultTags(scan) {
  return scan.skills.slice(0, 4).map((s) => s.name_zh || s.name);
}

export function defaultEntryUrl(group) {
  if (group.links && group.links.length > 0 && group.links[0].url) return group.links[0].url;
  return "";
}
