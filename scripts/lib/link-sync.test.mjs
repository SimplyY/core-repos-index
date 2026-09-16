import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { syncManagedChatTab } from "./link-sync.js";

test("managed chat tab is idempotent and stays after message", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "group-index-tabs-"));
  const state = path.join(dir, "state.json");
  const cli = path.join(dir, "lark-cli");
  fs.writeFileSync(state, JSON.stringify([
    { tab_id: "message", tab_type: "message", tab_name: "消息" },
    { tab_id: "learn", tab_type: "url", tab_name: "learn-x", tab_content: { url: "https://example.com" } },
    { tab_id: "system", tab_type: "files_resources", tab_name: "文件" },
  ]));
  fs.writeFileSync(cli, `#!/usr/bin/env node
const fs = require("node:fs");
const state = process.env.FAKE_TABS_STATE;
let tabs = JSON.parse(fs.readFileSync(state, "utf8"));
const pathArg = process.argv.find((value) => value.startsWith("/open-apis/")) || "";
const dataIndex = process.argv.indexOf("--data");
const body = dataIndex >= 0 ? JSON.parse(process.argv[dataIndex + 1]) : null;
if (pathArg.endsWith("/list_tabs")) console.log(JSON.stringify({ ok: true, data: { chat_tabs: tabs } }));
else if (pathArg.endsWith("/chat_tabs")) { const item = body.chat_tabs[0]; tabs.push({ ...item, tab_id: "managed" }); fs.writeFileSync(state, JSON.stringify(tabs)); console.log(JSON.stringify({ ok: true })); }
else if (pathArg.endsWith("/update_tabs")) { const item = body.chat_tabs[0]; tabs = tabs.map((tab) => tab.tab_id === item.tab_id ? item : tab); fs.writeFileSync(state, JSON.stringify(tabs)); console.log(JSON.stringify({ ok: true })); }
else if (pathArg.endsWith("/sort_tabs")) { const byId = new Map(tabs.map((tab) => [tab.tab_id, tab])); tabs = body.tab_ids.map((id) => byId.get(id)).filter(Boolean); fs.writeFileSync(state, JSON.stringify(tabs)); console.log(JSON.stringify({ ok: true })); }
else console.log(JSON.stringify({ ok: true }));
`);
  fs.chmodSync(cli, 0o755);
  const originalPath = process.env.PATH;
  const originalState = process.env.FAKE_TABS_STATE;
  process.env.PATH = `${dir}:${originalPath}`;
  process.env.FAKE_TABS_STATE = state;
  try {
    const first = syncManagedChatTab({ chatId: "chat", name: "人生核心议题", url: "https://wiki.example/q3", type: "doc", mode: "apply" });
    assert.equal(first.tabId, "managed");
    let tabs = JSON.parse(fs.readFileSync(state, "utf8"));
    assert.deepEqual(tabs.map((tab) => tab.tab_id), ["message", "managed", "learn", "system"]);
    const second = syncManagedChatTab({ chatId: "chat", name: "人生核心议题", url: "https://wiki.example/q4", type: "doc", mode: "apply" });
    assert.equal(second.tabId, "managed");
    tabs = JSON.parse(fs.readFileSync(state, "utf8"));
    assert.equal(tabs.filter((tab) => tab.tab_name === "人生核心议题").length, 1);
    assert.equal(tabs.find((tab) => tab.tab_id === "managed").tab_content.doc, "https://wiki.example/q4");
    tabs.push({ tab_id: "duplicate", tab_type: "doc", tab_name: "人生核心议题", tab_content: { doc: "https://wiki.example/duplicate" } });
    fs.writeFileSync(state, JSON.stringify(tabs));
    assert.throws(() => syncManagedChatTab({ chatId: "chat", name: "人生核心议题", url: "https://wiki.example/q4", type: "doc", mode: "apply" }), /标签名称重复/);
  } finally {
    process.env.PATH = originalPath;
    if (originalState === undefined) delete process.env.FAKE_TABS_STATE; else process.env.FAKE_TABS_STATE = originalState;
  }
});
