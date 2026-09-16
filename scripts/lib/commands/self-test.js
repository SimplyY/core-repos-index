import { parseFrontmatter, parseGroupInfoV2 } from "../frontmatter.js";
import { buildRegistryMeta, normalizeBaseRow, normalizeBasePage, parseRegistryCache } from "../base.js";
import { parseLinks, cleanSkillDesc, cleanSkillDescCompleteSentence } from "../utils.js";
import { renderGroupInfo, renderPinSummary, groupInfoChanged, syncAndRenderLinks } from "./update.js";
import { assertSkillUsageForApply, normalizeSkillUsage, rankSkills, scopeSkillUsage, renderTopNoticeCard, topGroup, topNoticeIdempotencyKey } from "./top.js";
import { renderList } from "./list.js";
import { orderChatTabIds, parseChatTabsResponse, syncLinks, syncLinksToBase, syncLinksToChatTabs, verifyChatTabs } from "../link-sync.js";
import { runTopRecoveryProbe } from "./self-test-probes.js";
import { modelSkillDescription, readSkillDescriptions } from "../skill-descriptions.js";

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
  const metadataFm = parseFrontmatter("---\nname: demo\ndescription: English\nmetadata:\n  short-description: short\n  description_zh: 中文描述\n---\n", "fallback");
  assertEqual(metadataFm.description_zh, "中文描述", "metadata description_zh");

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
  assertEqual(normalizeBaseRow({ "项目": "paused", "备注": "【暂时停用】以后恢复" }).auto_update, false, "disabled group marker");
  assertEqual(parseLinks("[入口](https://example.com/x)")[0].url, "https://example.com/x", "markdown links");
  const pageRows = normalizeBasePage({ ok: true, data: {
    fields: ["项目"],
    data: [["first"], ["second"]],
    record_id_list: ["rec_first", "rec_second"],
  }});
  assertEqual(pageRows[1].rid, "rec_second", "base page record id uses page-local index");
  assertThrows(() => normalizeBasePage({ ok: "false", data: { data: [], record_id_list: [] } }), "base response requires boolean ok");
  assertThrows(() => normalizeBasePage({ ok: true, data: { fields: ["项目"], data: [["missing-id"]], record_id_list: [] } }), "base response requires record ids");

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
  assertEqual(parseRegistryCache({ ts: "100000", groups: [] }).ts, 100000, "cache timestamp normalization");
  assertEqual(parseRegistryCache({ ts: "not-a-time", groups: [] }), null, "invalid cache timestamp rejected");
  assertEqual(parseRegistryCache({ ts: true, groups: [] }), null, "non-numeric cache timestamp rejected");
  assertThrows(() => buildRegistryMeta("stale-cache", "not-a-time"), "invalid metadata timestamp rejected");
  assertEqual(parseChatTabsResponse(JSON.stringify({ ok: true, data: { chat_tabs: [] } }), "demo").length, 0, "chat tabs response parse");
  assertThrows(() => parseChatTabsResponse(JSON.stringify({ ok: true, data: {} }), "demo"), "chat tabs response must include tabs");
  assertThrows(() => parseChatTabsResponse(JSON.stringify({ ok: "false", data: { chat_tabs: [] } }), "demo"), "chat tabs response requires boolean ok");
  const orderedProbeTabs = [
    { tab_id: "doc", tab_type: "doc" },
    { tab_id: "message", tab_type: "message" },
    { tab_id: "system", tab_type: "files_resources" },
  ];
  assertEqual(orderChatTabIds(orderedProbeTabs, "doc").join(","), "message,doc,system", "priority tab follows message");
  assertEqual(orderChatTabIds(orderedProbeTabs).join(","), "message,doc,system", "message remains first");
  assertEqual(verifyChatTabs([{ tab_type: "url", tab_name: "probe", tab_content: { url: "https://example.com" } }], [{ name: "probe", url: "https://example.com" }]).ok, true, "chat tab readback accepts matching tab");
  assertEqual(verifyChatTabs([], [{ name: "probe", url: "https://example.com" }]).ok, false, "chat tab readback rejects missing tab");
  const topKey = topNoticeIdempotencyKey({ id: "group-index", chat_id: "oc_demo" }, "summary");
  assertEqual(topKey, topNoticeIdempotencyKey({ id: "group-index", chat_id: "oc_demo" }, "summary"), "top notice idempotency stable");
  assertNotEqual(topKey, topNoticeIdempotencyKey({ id: "group-index", chat_id: "oc_demo" }, "changed"), "top notice idempotency changes with summary");
  assertEqual(topKey.length <= 50, true, "top notice idempotency length");
  assertThrows(() => topGroup({}, {}, { name: "unbound", repo_path: null, chat_id: null }, "dry-run"), "top without chat id fails closed");
  assertThrows(() => topGroup({}, {}, { name: "unavailable", repo_path: null, chat_id: "oc_demo" }, "dry-run"), "top with incomplete scan fails closed");
  runTopRecoveryProbe();
  const missingRecord = syncAndRenderLinks({ repo_path: ".", record_id: "", links: [] }, "apply");
  assertEqual(missingRecord.ok, false, "missing record id stops before reverse sync");
  assertEqual(missingRecord.summary, "缺少 Base record_id，已停止所有写入", "missing record id summary");
  const noReadmeLinks = syncLinks("", "", [{ name: "existing", url: "https://example.com" }], "apply");
  assertEqual(noReadmeLinks.ok, true, "no README links is a confirmed no-op");
  const originalPath = process.env.PATH;
  const originalError = console.error;
  const originalWarn = console.warn;
  let processFailure;
  try {
    process.env.PATH = "/nonexistent";
    console.error = () => {};
    processFailure = syncLinksToBase("rec_probe", [{ name: "probe", url: "https://example.com" }], "apply");
  } finally {
    process.env.PATH = originalPath;
    console.error = originalError;
  }
  assertEqual(processFailure.ok, false, "Base process failure stops write");
  assertIncludes(processFailure.error, "ENOENT", "Base process failure preserves error");
  const missingBaseId = syncLinksToBase("", [{ name: "probe", url: "https://example.com" }], "apply");
  assertEqual(missingBaseId.ok, false, "direct Base writer rejects missing record id");
  assertEqual(missingBaseId.error, "缺少 Base record_id", "direct Base writer missing id error");
  let preflightFailure;
  try {
    process.env.PATH = "/nonexistent";
    console.error = () => {};
    syncLinks({ repo_path: ".", chat_id: "oc_probe" }, "rec_probe", [], "apply");
  } catch (error) {
    preflightFailure = error;
  } finally {
    process.env.PATH = originalPath;
    console.error = originalError;
  }
  assertIncludes(preflightFailure?.message || "", "标签页失败", "chat tab preflight runs before Base write");
  let tabFailure;
  try {
    process.env.PATH = "/nonexistent";
    console.error = () => {};
    console.warn = () => {};
    tabFailure = syncLinksToChatTabs({ chat_id: "oc_probe" }, [
      { name: "first-renamed", url: "https://first.example", type: "url" },
      { name: "second", url: "https://second.example", type: "url" },
    ], "apply", [
      { tab_id: "tab-1", tab_name: "first", tab_type: "url", tab_content: { url: "https://first.example" } },
      { tab_id: "tab-2", tab_name: "second", tab_type: "url", tab_content: { url: "https://second.example" } },
    ]);
  } finally {
    process.env.PATH = originalPath;
    console.error = originalError;
    console.warn = originalWarn;
  }
  assertEqual(tabFailure.updated, 0, "tab update failure reports no successful updates");
  assertEqual(tabFailure.error, "更新标签页失败：first-renamed", "tab update failure stops later writes");
  let addFailure;
  try {
    process.env.PATH = "/nonexistent";
    console.error = () => {};
    console.warn = () => {};
    addFailure = syncLinksToChatTabs({ chat_id: "oc_probe" }, [
      { name: "first", url: "https://first.example" },
      { name: "second", url: "https://second.example" },
    ], "apply", []);
  } finally {
    process.env.PATH = originalPath;
    console.error = originalError;
    console.warn = originalWarn;
  }
  assertEqual(addFailure.added, 0, "tab add failure reports no successful additions");
  assertEqual(addFailure.error, "添加标签页失败：first", "tab add failure stops later writes");

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

  const registryMeta = {
    source: "live",
    fetched_at: "2026-08-21T00:00:00.000Z",
    age: 42,
    degraded: false,
  };
  const metadataMarkdown = renderGroupInfo(
    { ...baseGroup, repo_url: "https://github.com/SimplyY/learn-x" },
    { skills: [], workflows: [], dataSources: [], error: null },
    {},
    "2026-08-21T00:01:00.000Z",
    registryMeta
  );
  assertIncludes(metadataMarkdown, 'registry_source: "live"', "registry source frontmatter");
  assertIncludes(metadataMarkdown, 'registry_fetched_at: "2026-08-21T00:00:00.000Z"', "registry fetched_at frontmatter");
  assertIncludes(metadataMarkdown, "registry_age_seconds: 42", "registry age frontmatter");
  assertIncludes(metadataMarkdown, "- 注册表新鲜度：可用", "registry freshness status");
  const metadataAgeChanged = metadataMarkdown
    .replace("registry_age_seconds: 42", "registry_age_seconds: 99")
    .replace("约 42 秒前读取", "约 99 秒前读取");
  assertEqual(groupInfoChanged(metadataMarkdown, metadataAgeChanged), false, "registry age-only change");
  const degradedMarkdown = renderGroupInfo(
    { ...baseGroup, repo_url: "https://github.com/SimplyY/learn-x" },
    { skills: [], workflows: [], dataSources: [], error: null },
    {},
    "2026-08-21T00:01:00.000Z",
    { ...registryMeta, source: "stale-cache", degraded: true }
  );
  assertIncludes(degradedMarkdown, "- 注册表新鲜度：降级，禁止据此执行高风险写入", "degraded registry status");
  assertEqual(groupInfoChanged(metadataMarkdown, degradedMarkdown), true, "registry source change");

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
  assertThrows(() => assertSkillUsageForApply("apply", null), "apply requires skill usage");
  const descriptionAsset = readSkillDescriptions();
  assertEqual(Object.keys(descriptionAsset).length >= 60, true, "model description asset covers current skill set");
  for (const [name, row] of Object.entries(descriptionAsset)) {
    for (const [band, max] of [["low", 20], ["medium", 30], ["high", 40]]) {
      const description = row[`description_zh_${band}`] || row.description_zh;
      if (typeof description !== "string" || !description.trim() || Array.from(description.trim()).length > max) {
        throw new Error(`模型描述资产的 ${band} 档位无效：${name}`);
      }
    }
  }
  assertThrows(() => modelSkillDescription({ name: "missing-skill", description_zh: "不存在" }, 20), "missing model description fails closed");
  assertThrows(() => modelSkillDescription({ name: "quick-cd", description_zh: "已变化" }, 20), "stale model description fails closed");
  const legacyLongScan = {
    skills: [{ name: "legacy-long", description_zh: "在资产更新同步成功后生成正式飞书资产报告。用于生成人类可读结果" }],
    workflows: [], dataSources: [], error: null
  };
  const legacyLongSummary = renderPinSummary(
    { name: "demo", group_name: "Demo 群", positioning: "测试定位", repo: "/tmp/demo", links: [] },
    legacyLongScan, "now", {}
  );
  assertIncludes(legacyLongSummary, "在资产更新同步成功后生成正式飞书资产报告。", "legacy summary keeps complete sentence");
  assertNotEqual(legacyLongSummary.includes("用于生成人类可读结果"), true, "legacy summary stops at sentence boundary");
  const legacyLongCard = renderTopNoticeCard(
    { name: "demo", positioning: "测试定位", repo: "/tmp/demo", links: [] },
    legacyLongScan, "now", {}
  );
  const legacyLongCardText = legacyLongCard.body.elements.map((element) => element.content || "").join("\n");
  assertIncludes(legacyLongCardText, "在资产更新同步成功后生成正式飞书资产报告。", "legacy card keeps complete sentence");
  assertNotEqual(legacyLongCardText.includes("用于生成人类可读结果"), true, "legacy card stops at sentence boundary");

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
  assertEqual(rankedSkills[0].frequencyDescriptionMax, 40, "high description limit");
  assertEqual(rankedSkills[1].frequencyDescriptionMax, 30, "medium description limit");
  assertEqual(rankedSkills[3].frequencyDescriptionMax, 20, "low description limit");
  const lowDescription = cleanSkillDescCompleteSentence({ description: "生成每周飞书机器人 Build 复盘报告" }, rankedSkills[3].frequencyDescriptionMax);
  assertEqual(lowDescription, "生成 Build 复盘报告。", "low description keeps useful complete sentence");
  assertEqual(Array.from(lowDescription).length > 5, true, "low description exceeds minimum length");
  assertEqual(cleanSkillDesc(rankedSkills[3], 10), "低频用途描述超过十个", "legacy hard truncation helper remains explicit");
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
  assertEqual(cleanSkillDescCompleteSentence({ description: "生成投资复盘事实底稿，并按“机器草案→对话确认→对象感知的一手证据→八席审查”两阶段维护独立的飞鱼投资委员会附录。" }, 40), "生成投资复盘事实底稿，并按两阶段维护独立的飞鱼投资委员会附录。", "ignore quoted action when compressing");
  assertEqual(cleanSkillDescCompleteSentence({ description: "链接自动抓取、内容质量判断、卡片回复" }, 40), "链接自动抓取、内容质量判断、卡片回复。", "prefer full useful clause when no frequency minimum is met");
  assertNotEqual(cleanSkillDescCompleteSentence({ description: "查询投资资产和操作记录，任何涉及投资资产的问题都走这个 skill，不生成买卖建议。" }, 40).includes("生成买卖建议"), true, "ignore negated actions");
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
  assertThrows(() => normalizeSkillUsage({
    windows: [30],
    profiles: [{ profile: "desktop", available: true }, { profile: "deep", available: true }],
    skills: [],
    warnings: ["source incomplete"]
  }), "warnings fail closed");
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
