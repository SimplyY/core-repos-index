import { parseFrontmatter, parseGroupInfoV2 } from "../frontmatter.js";
import { buildRegistryMeta, normalizeBaseRow } from "../base.js";
import { parseLinks } from "../utils.js";
import { renderGroupInfo, renderPinSummary, groupInfoChanged } from "./update.js";
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
