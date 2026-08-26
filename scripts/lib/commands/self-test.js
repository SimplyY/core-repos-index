import { parseFrontmatter, parseGroupInfoV2 } from "../frontmatter.js";
import { buildRegistryMeta, normalizeBaseRow } from "../base.js";
import { parseLinks, cleanSkillDesc, cleanSkillDescCompleteSentence } from "../utils.js";
import { renderGroupInfo, renderPinSummary, groupInfoChanged } from "./update.js";
import { normalizeSkillUsage, rankSkills, scopeSkillUsage } from "./top.js";
import { renderList } from "./list.js";

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(label + "\nexpected: " + expected + "\nactual: " + actual);
  }
}

function assertIncludes(actual, expected, label) {
  if (!actual.includes(expected)) {
    throw new Error(label + "\nmissing: " + expected + "\nactual: " + actual);
  }
}

function assertNotEqual(actual, expected, label) {
  if (actual === expected) {
    throw new Error(label + "\nshould not be: " + expected);
  }
}

function assertThrows(fn, label) {
  try {
    fn();
  } catch {
    return;
  }
  throw new Error(label + "\nexpected an error");
}

export function selfTest() {
  const fm = parseFrontmatter("---\nname: demo\ndescription_zh: >-\n  第一行\n  第二行\n---\n", "fallback");
  assertEqual(fm.name, "demo", "frontmatter name");
  assertEqual(fm.description_zh, "第一行 第二行", "frontmatter block");

  const baseGroup = normalizeBaseRow({
    "项目": "learn-x",
    "群 ID": "oc_demo",
    "仓库路径": "/tmp/learn-x",
    "仓库链接": "[https://github.com/SimplyY/learn-x](https://github.com/SimplyY/learn-x)",
    "定位": "认知系统",
    "优先级": ["P1"],
    "链接": "入口：https://example.com",
    "工作流": "周报：每周处理",
    "待办": "检查输入",
    "备注": "人工备注"
  });
  assertEqual(baseGroup.links[0].url, "https://example.com", "base links");
  assertEqual(baseGroup.group_name, "learn-x", "group name from project");
  assertEqual(baseGroup.repo_url, "https://github.com/SimplyY/learn-x", "repo url");
  assertEqual(baseGroup.priority, 2, "base priority");
  assertEqual(baseGroup.manual_workflows[0].description_zh, "每周处理", "base workflows");
  assertEqual(parseLinks("[入口](https://example.com/x)")[0].url, "https://example.com/x", "markdown links");

  const cacheMeta = buildRegistryMeta("cache", 100000, 1023456);
  assertEqual(cacheMeta.source, "cache", "cache metadata source");
  assertEqual(cacheMeta.fetched_at, "1970-01-01T00:01:40.000Z", "cache metadata fetched_at");
  assertEqual(cacheMeta.age, 923, "cache metadata age");
  assertEqual(cacheMeta.degraded, false, "cache metadata degraded");

  const liveMeta = buildRegistryMeta("live", 100000, 100000);
  assertEqual(liveMeta.source, "live", "live metadata source");
  assertEqual(liveMeta.age, 0, "live metadata age");
  assertEqual(liveMeta.degraded, false, "live metadata degraded");
  assertEqual(buildRegistryMeta("cache", 200000, 100000).age, 0, "future metadata age clamps to zero");

  const staleMeta = buildRegistryMeta("stale-cache", 100000, 1023456);
  assertEqual(staleMeta.degraded, true, "stale cache metadata degraded");
  const listRegistry = { groups: [], meta: staleMeta };
  assertEqual(Array.isArray(JSON.parse(renderList(listRegistry, "json"))), true, "legacy list json array");
  const listWithMeta = JSON.parse(renderList(listRegistry, "json", { withMeta: true }));
  assertEqual(Array.isArray(listWithMeta.items), true, "list with metadata items");
  assertEqual(listWithMeta.meta.source, "stale-cache", "list with metadata source");
  assertThrows(() => renderList(listRegistry, "table", { withMeta: true }), "metadata requires json format");

  const oldMarkdown = 'updated_at: "2026-08-20T00:00:00.000Z"\n正文\n- 最近更新时间：2026-08-20T00:00:00.000Z\n';
  const newMarkdown = 'updated_at: "2026-08-21T00:00:00.000Z"\n正文\n- 最近更新时间：2026-08-21T00:00:00.000Z\n';
  assertEqual(groupInfoChanged(null, newMarkdown), true, "missing GROUP_INFO requires write");
  assertEqual(groupInfoChanged(oldMarkdown, newMarkdown), false, "timestamp-only GROUP_INFO change");
  assertEqual(groupInfoChanged(oldMarkdown, newMarkdown.replace("正文", "正文已变更")), true, "semantic GROUP_INFO change");

  const summary = renderPinSummary(
    { name: "demo", group_name: "Demo 群", positioning: "测试定位", repo: "/tmp/demo", links: [] },
    { skills: [], workflows: [], dataSources: [], error: null },
    "now",
    {}
  );
  assertIncludes(summary, "【Demo 群 群信息】", "top summary title");
  assertIncludes(summary, "📍 测试定位", "top summary positioning");
  const legacySummary = renderPinSummary(
    { name: "demo", group_name: "Demo 群", positioning: "测试定位", repo: "/tmp/demo", links: [] },
    { skills: [
      { name: "legacy-a", description_zh: "旧顺序第一项" },
      { name: "legacy-b", description_zh: "旧顺序第二项" }
    ], workflows: [], dataSources: [], error: null },
    "now",
    {}
  );
  assertIncludes(legacySummary, "1. legacy-a：旧顺序第一项", "legacy skill order");
  assertNotEqual(legacySummary.includes("(高)"), true, "legacy summary has no frequency suffix");

  const usage = normalizeSkillUsage({
    windows: [30],
    profiles: [
      { profile: "desktop", available: true },
      { profile: "deep", available: true }
    ],
    skills: [
      { name: "high", activeDays: 8, calls_by_window: { "30": 10 } },
      { name: "high-two", activeDays: 7, calls_by_window: { "30": 9 } },
      { name: "medium", activeDays: 3, calls_by_window: { "30": 8 } },
      { name: "border", activeDays: 2, calls_by_window: { "30": 3 } },
      { name: "low", activeDays: 1, calls_by_window: { "30": 2 } },
      { name: "outside-group", activeDays: 10, calls_by_window: { "30": 100 } }
    ]
  });
  const scopedUsage = scopeSkillUsage(usage, ["high", "high-two", "medium", "border", "low"]);
  assertEqual(scopedUsage.frequencyByName.get("high-two").label, "高", "top-30 uses group scope");
  assertEqual(scopedUsage.frequencyByName.has("outside-group"), false, "outside skill excluded from scope");
  const rankedSkills = rankSkills([
    { name: "low", name_zh: "低频", description_zh: "低频用途描述超过十个字" },
    { name: "high", name_zh: "高频", description_zh: "高频用途描述用于验证三十字限制和排序。第二句不应显示" },
    { name: "medium", name_zh: "中频", description_zh: "中频用途描述超过二十个字时应截断" },
    { name: "border", name_zh: "边界", description_zh: "三次调用仍属于中频" }
  ], scopedUsage);
  assertEqual(rankedSkills.map((skill) => skill.name).join(","), "high,medium,border,low", "skill usage ranking");
  assertEqual(rankedSkills[0].frequencyLabel, "高", "high frequency band");
  assertEqual(rankedSkills[1].frequencyLabel, "中", "non-top-30 frequency band");
  assertEqual(rankedSkills[2].frequencyLabel, "中", "three-call medium boundary");
  assertEqual(rankedSkills[3].frequencyLabel, "低", "two-call low boundary");
  assertEqual(rankedSkills[3].frequencyDescriptionMax, 10, "low description limit");
  assertEqual(cleanSkillDesc(rankedSkills[3], rankedSkills[3].frequencyDescriptionMax), "低频用途描述超过十个", "low description truncation");
  assertEqual(cleanSkillDesc({ description: "demo（触发词）：这是用途说明。" }), "这是用途说明", "description body extraction");
  assertEqual(cleanSkillDesc({ description: "定时触发：每周执行" }), "定时触发：每周执行", "pure Chinese description preservation");
  assertEqual(cleanSkillDesc({ description: "基于日常记录 Base，生成建议" }), "基于日常记录 Base，生成建议", "technical name preservation");
  assertEqual(cleanSkillDesc({ description: "用模糊短名切换到 `path` 下已注册的仓库" }, 10), "用模糊短名切换到", "truncation ends at Chinese character");
  assertEqual(cleanSkillDescCompleteSentence({ description: "这是完整短句。第二句不应出现" }, 10), "这是完整短句。", "complete sentence within limit");
  assertEqual(cleanSkillDescCompleteSentence({ description: "基于候选清单和记录，生成明确建议" }, 10), "生成明确建议。", "complete clause fallback");
  assertEqual(cleanSkillDescCompleteSentence({ description: "记录核心用途，以及补充说明" }, 10), "记录核心用途。", "reject dangling conjunction clause");
  assertEqual(cleanSkillDescCompleteSentence({ description: "为仓库生成简洁、可执行的 AGENTS.md" }, 20), "生成 AGENTS.md。", "compress modifiers without truncation");
  assertEqual(cleanSkillDescCompleteSentence({ description: "将口语或文本灵感自动匹配到 Write-X 正在记录的主题" }, 10), "匹配主题。", "compress to action and object");
  assertEqual(cleanSkillDescCompleteSentence({ description: "将用户提供的图片解析为结构化的读书会思考记录" }, 20), "解析为读书会思考记录。", "prefer direct action over supporting verb");
  assertEqual(cleanSkillDescCompleteSentence({ description: "按年缓存、按月切片：仓位/操作/偏离/品种" }, 20), "缓存仓位/操作/偏离/品种。", "carry action across label boundary");
  assertEqual(cleanSkillDescCompleteSentence({ description: "这是一段没有任何边界而且长度超过限制的描述" }, 10), "", "no unsafe truncation");
  assertEqual(cleanSkillDescCompleteSentence({ description: "简短用途说明" }, 10), "简短用途说明。", "short sentence completion");
  const rankedSummary = renderPinSummary(
    { name: "demo", group_name: "Demo 群", positioning: "测试定位", repo: "/tmp/demo", links: [] },
    { skills: rankedSkills, workflows: [], dataSources: [], error: null },
    "now",
    {},
    rankedSkills
  );
  assertIncludes(rankedSummary, "1. 高频 (高)", "ranked skill summary");
  assertEqual(cleanSkillDescCompleteSentence(rankedSkills[0], 30), "高频用途描述用于验证三十字限制和排序。", "high first sentence");
  assertNotEqual(rankedSummary.includes("第二句不应显示"), true, "high description should stop at first sentence");
  const tieUsage = normalizeSkillUsage({
    windows: [30],
    profiles: [
      { profile: "desktop", available: true },
      { profile: "deep", available: true }
    ],
    skills: [
      { name: "zeta", activeDays: 1, calls_by_window: { "30": 2 } },
      { name: "alpha", activeDays: 1, calls_by_window: { "30": 2 } }
    ]
  });
  const scopedTieUsage = scopeSkillUsage(tieUsage, ["zeta", "alpha"]);
  assertEqual(rankSkills([{ name: "zeta" }, { name: "alpha" }], scopedTieUsage).map((skill) => skill.name).join(","), "alpha,zeta", "stable tie sorting");
  assertThrows(() => normalizeSkillUsage({ windows: [90], profiles: [], skills: [] }), "invalid skill usage report");
  assertThrows(() => normalizeSkillUsage({
    windows: [30],
    profiles: [{ profile: "desktop", available: true }, { profile: "deep", available: true }],
    skills: [{ name: "bad", calls_by_window: { "30": null }, activeDays: 0 }]
  }), "invalid skill usage number");
  assertThrows(() => normalizeSkillUsage({
    windows: [30],
    profiles: [{ profile: "desktop", available: false }, { profile: "deep", available: true }],
    skills: []
  }), "incomplete profile coverage");
  assertThrows(() => normalizeSkillUsage({
    windows: [30],
    profiles: [{ profile: "desktop", available: true }, { profile: "deep", available: true }],
    skills: [{ name: " bad", calls_by_window: { "30": 1 }, activeDays: 1 }]
  }), "invalid skill name");
  assertThrows(() => normalizeSkillUsage({
    windows: [30],
    profiles: [{ profile: "desktop", available: true }, { profile: "deep", available: true }],
    skills: [
      { name: "dup", calls_by_window: { "30": 1 }, activeDays: 1 },
      { name: "dup", calls_by_window: { "30": 1 }, activeDays: 1 }
    ]
  }), "duplicate skill name");
  assertThrows(() => scopeSkillUsage(usage, ["missing"]), "uncovered skill usage");

  const markdown = renderGroupInfo(
    { ...baseGroup, repo_url: "https://github.com/SimplyY/learn-x" },
    { skills: [], workflows: [], dataSources: [], error: null },
    {},
    "now"
  );
  assertIncludes(markdown, 'repo_url: "https://github.com/SimplyY/learn-x"', "repo url frontmatter");
  assertIncludes(markdown, "- 代码仓库：https://github.com/SimplyY/learn-x", "repo url binding");

  // 对抗性自测：repo_url 为空时不应渲染"代码仓库"
  const noRepoUrl = renderGroupInfo(
    { ...baseGroup, repo_url: "" },
    { skills: [], workflows: [], dataSources: [], error: null },
    {},
    "now"
  );
  assertNotEqual(noRepoUrl.includes("代码仓库"), true, "empty repo_url should not render 代码仓库");

  // 对抗性自测：缺失仓库链接字段时 repo_url 为空串
  const missingRepoUrl = normalizeBaseRow({
    "项目": "test-proj",
    "群 ID": "oc_test",
    "仓库路径": "/tmp/test",
    "定位": "测试",
    "优先级": ["P3"],
    "链接": "",
    "工作流": "",
    "待办": "",
    "备注": ""
  });
  assertEqual(missingRepoUrl.repo_url, "", "missing repo_url should be empty string");
  assertEqual(missingRepoUrl.links.length, 0, "empty links should stay empty");
  assertEqual(missingRepoUrl.group_name, "test-proj", "group_name from project");

  // 对抗性自测：group_name 始终跟随项目名
  const renamedGroup = normalizeBaseRow({
    "项目": "new-name",
    "群 ID": "oc_renamed",
    "仓库路径": "/tmp/renamed",
    "定位": "测试",
    "优先级": ["P2"],
    "链接": "",
    "工作流": "",
    "待办": "",
    "备注": ""
  });
  assertEqual(renamedGroup.group_name, "new-name", "group_name follows project");

  // 对抗性自测：parseGroupInfoV2 解析 repo_url
  const v2 = parseGroupInfoV2('---\nrepo_url: "https://github.com/SimplyY/learn-x"\nrepo_path: "/tmp/x"\n---');
  assertEqual(v2 && v2.repo_url, "https://github.com/SimplyY/learn-x", "parseGroupInfoV2 repo_url");

  console.log("self-test 通过");
}
