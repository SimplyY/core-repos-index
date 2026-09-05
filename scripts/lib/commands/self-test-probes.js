import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

function assertEqual(actual, expected, label) {
  if (actual !== expected) throw new Error(label + "\nexpected: " + expected + "\nactual: " + actual);
}

function assertIncludes(actual, expected, label) {
  if (!actual.includes(expected)) throw new Error(label + "\nmissing: " + expected + "\nactual: " + actual);
}

export function runTopRecoveryProbe() {
  const temp = mkdtempSync(join(tmpdir(), "group-index-top-recovery-"));
  const fakeCli = join(temp, "lark-cli");
  const statePath = join(temp, "state.json");
  const logPath = join(temp, "calls.log");
  const tabsCounterPath = join(temp, "tabs-counter");
  const modulePath = join(process.cwd(), "scripts/lib/commands/top.js");
  writeFileSync(fakeCli, `#!/bin/sh
if [ -n "$FAKE_LOG" ]; then
  if [ "$1" = "api" ]; then printf 'api %s %s\\n' "$2" "$3" >> "$FAKE_LOG";
  else printf '%s %s\\n' "$1" "$2" >> "$FAKE_LOG"; fi
fi
if [ "$1" = "im" ] && [ "$2" = "+messages-send" ]; then
  printf '%s\\n' '{"ok":true,"data":{"message_id":"om_probe"}}'
  exit 0
fi
if [ "$1" = "im" ] && [ "$2" = "+messages-mget" ]; then
  if [ "$FAKE_MESSAGE_READBACK_MODE" = "missing" ]; then
    printf '%s\\n' '{"ok":true,"data":{"messages":[]}}'
  elif [ "$FAKE_MESSAGE_READBACK_MODE" = "wrong-chat" ]; then
    printf '%s\\n' '{"ok":true,"data":{"messages":[{"message_id":"om_probe","chat_id":"oc_other","deleted":false,"msg_type":"interactive"}]}}'
  else
    printf '%s\\n' '{"ok":true,"data":{"messages":[{"message_id":"om_probe","chat_id":"oc_probe","deleted":false,"msg_type":"interactive"}]}}'
  fi
  exit 0
fi
if [ "$1" = "base" ] && [ "$2" = "+record-upsert" ]; then
  if [ "$FAKE_BASE_MODE" = "fail" ]; then
    printf '%s\\n' '{"ok":false,"error":{"message":"probe-base-failure"}}'
    exit 0
  fi
  printf '%s\\n' '{"ok":true,"data":{}}'
  exit 0
fi
if [ "$1" = "base" ] && [ "$2" = "+record-get" ]; then
  if [ "$FAKE_READBACK_MODE" = "wrong-record" ]; then
    printf '%s\\n' '{"ok":true,"data":{"record_id_list":["rec_other"],"fields":["链接"],"data":{"0":["probe：https://example.com"]}}}'
  elif [ "$FAKE_READBACK_MODE" = "wrong" ]; then
    printf '%s\\n' '{"ok":true,"data":{"record_id_list":["rec_probe"],"fields":["链接"],"data":{"0":["probe：https://wrong.example"]}}}'
  else
    printf '%s\\n' '{"ok":true,"data":{"record_id_list":["rec_probe"],"fields":["链接"],"data":{"0":["probe：https://example.com"]}}}'
  fi
  exit 0
fi
if [ "$1" = "api" ] && [ "$2" = "POST" ]; then
  if [ "$FAKE_TOP_MODE" = "fail" ]; then
    printf '%s\\n' '{"ok":false,"error":{"message":"probe-top-failure"}}'
  else
    printf '%s\\n' '{"ok":true,"data":{}}'
  fi
  exit 0
fi
if [ "$1" = "api" ] && [ "$2" = "GET" ]; then
  if [ "$FAKE_TABS_MODE" = "success" ]; then
    count=$(cat "$FAKE_TABS_COUNTER" 2>/dev/null || printf '0')
    count=$((count + 1))
    printf '%s' "$count" > "$FAKE_TABS_COUNTER"
    if [ "$count" -ge 2 ]; then
      printf '%s\\n' '{"ok":true,"data":{"chat_tabs":[{"tab_id":"tab-1","tab_name":"probe","tab_type":"doc","tab_content":{"doc":"https://example.com/wiki/probe"}},{"tab_id":"msg-1","tab_type":"message"}]}}'
    else
      printf '%s\\n' '{"ok":true,"data":{"chat_tabs":[{"tab_id":"tab-1","tab_name":"probe","tab_type":"url","tab_content":{"url":"https://example.com/wiki/probe"}},{"tab_id":"msg-1","tab_type":"message"}]}}'
    fi
  else
    printf '%s\\n' '{"ok":true,"data":{"chat_tabs":[]}}'
  fi
  exit 0
fi
printf '%s\\n' '{"ok":true,"data":{}}'
`);
  chmodSync(fakeCli, 0o755);
  const groupJson = JSON.stringify({
    id: "probe", name: "probe", group_name: "probe", repo_path: ".", repo: ".",
    chat_id: "oc_probe", positioning: "probe", links: [],
  });
  const probeUsage = "{ byName: new Map(), frequencyByName: new Map() }";
  const run = (mode, stateSource) => {
    const code = mode === "fail"
      ? `import { topGroup } from ${JSON.stringify(modulePath)}; try { topGroup({}, {}, ${groupJson}, "apply", ${probeUsage}); } catch {}`
      : `import { readFileSync } from "node:fs"; import { topGroup } from ${JSON.stringify(modulePath)}; const state = JSON.parse(readFileSync(process.env.GROUP_INFO_STATE, "utf8")); topGroup({}, state, ${groupJson}, "apply", ${probeUsage});`;
    return spawnSync(process.execPath, ["--input-type=module", "-e", code], {
      cwd: process.cwd(), encoding: "utf8", maxBuffer: 4 * 1024 * 1024,
      env: { ...process.env, GROUP_INFO_STATE: stateSource, FAKE_TOP_MODE: mode, FAKE_LOG: logPath, PATH: temp + ":" + (process.env.PATH || "") },
    });
  };
  try {
    const first = run("fail", statePath);
    assertEqual(first.status, 0, "top recovery first attempt completes with captured failure");
    const pending = JSON.parse(readFileSync(statePath, "utf8")).groups.probe;
    assertEqual(pending.top_notice_pending_message_id, "om_probe", "top failure persists pending message");
    const mismatchState = JSON.parse(readFileSync(statePath, "utf8"));
    mismatchState.groups.probe.top_notice_pending_summary = "changed-summary";
    writeFileSync(statePath, JSON.stringify(mismatchState));
    const mismatchCode = `import { readFileSync } from "node:fs"; import { topGroup } from ${JSON.stringify(modulePath)}; try { topGroup({}, JSON.parse(readFileSync(process.env.GROUP_INFO_STATE, "utf8")), ${groupJson}, "apply", ${probeUsage}); process.exit(1); } catch (error) { if (!String(error.message).includes("摘要或群已变化")) process.exit(2); }`;
    const mismatch = spawnSync(process.execPath, ["--input-type=module", "-e", mismatchCode], { cwd: process.cwd(), encoding: "utf8", maxBuffer: 4 * 1024 * 1024, env: { ...process.env, GROUP_INFO_STATE: statePath, FAKE_TOP_MODE: "success", FAKE_LOG: logPath, PATH: temp + ":" + (process.env.PATH || "") } });
    assertEqual(mismatch.status, 0, "top recovery stops when pending summary changes");
    assertEqual(readFileSync(logPath, "utf8").trim().split("\n").filter((call) => call.startsWith("im +messages-send")).length, 1, "summary mismatch does not resend card");
    writeFileSync(statePath, JSON.stringify({ groups: { probe: pending } }));
    const second = run("success", statePath);
    assertEqual(second.status, 0, "top recovery retry succeeds");
    const recovered = JSON.parse(readFileSync(statePath, "utf8")).groups.probe;
    assertEqual(recovered.top_notice_message_id, "om_probe", "top recovery records pinned message");
    assertEqual(recovered.top_notice_verification, "message-readback", "top recovery records message readback evidence");
    assertEqual(Boolean(recovered.top_notice_pending_message_id), false, "top recovery clears pending message");
    const calls = readFileSync(logPath, "utf8").trim().split("\n").filter(Boolean);
    assertEqual(calls.filter((call) => call.startsWith("im +messages-send")).length, 1, "top recovery does not resend card");
    assertEqual(calls.filter((call) => call.includes("top_notice/put_top_notice")).length, 2, "top recovery retries pin once");
    assertEqual(calls.filter((call) => call.startsWith("im +messages-mget")).length, 1, "top recovery reads back message once");
    const readbackFailureState = JSON.parse(readFileSync(statePath, "utf8"));
    readbackFailureState.groups.probe.last_top_summary = "old-summary";
    writeFileSync(statePath, JSON.stringify(readbackFailureState));
    const readbackFailureCode = `import { readFileSync } from "node:fs"; import { topGroup } from ${JSON.stringify(modulePath)}; try { topGroup({}, JSON.parse(readFileSync(process.env.GROUP_INFO_STATE, "utf8")), ${groupJson}, "apply", ${probeUsage}); process.exit(1); } catch (error) { if (!String(error.message).includes("消息读回未确认")) process.exit(2); }`;
    const readbackFailure = spawnSync(process.execPath, ["--input-type=module", "-e", readbackFailureCode], { cwd: process.cwd(), encoding: "utf8", maxBuffer: 4 * 1024 * 1024, env: { ...process.env, GROUP_INFO_STATE: statePath, FAKE_TOP_MODE: "success", FAKE_MESSAGE_READBACK_MODE: "missing", FAKE_LOG: logPath, PATH: temp + ":" + (process.env.PATH || "") } });
    assertEqual(readbackFailure.status, 0, "message readback failure stops final state");
    const afterReadbackFailure = JSON.parse(readFileSync(statePath, "utf8")).groups.probe;
    assertEqual(afterReadbackFailure.top_notice_pending_message_id, "om_probe", "message readback failure preserves pending receipt");
    const wrongChatReadback = spawnSync(process.execPath, ["--input-type=module", "-e", readbackFailureCode], { cwd: process.cwd(), encoding: "utf8", maxBuffer: 4 * 1024 * 1024, env: { ...process.env, GROUP_INFO_STATE: statePath, FAKE_TOP_MODE: "success", FAKE_MESSAGE_READBACK_MODE: "wrong-chat", FAKE_LOG: logPath, PATH: temp + ":" + (process.env.PATH || "") } });
    assertEqual(wrongChatReadback.status, 0, "message readback rejects a different chat");
    const baseCode = `import { syncLinksToBase } from ${JSON.stringify(join(process.cwd(), "scripts/lib/link-sync.js"))}; const result = syncLinksToBase("rec_probe", [{ name: "probe", url: "https://example.com" }], "apply"); if (!result.ok) { console.error(result.error); process.exit(1); }`;
    const base = spawnSync(process.execPath, ["--input-type=module", "-e", baseCode], { cwd: process.cwd(), encoding: "utf8", maxBuffer: 2 * 1024 * 1024, env: { ...process.env, GROUP_INFO_STATE: statePath, FAKE_LOG: logPath, PATH: temp + ":" + (process.env.PATH || "") } });
    assertEqual(base.status, 0, "Base write readback accepts matching persisted value");
    const badBase = spawnSync(process.execPath, ["--input-type=module", "-e", baseCode], { cwd: process.cwd(), encoding: "utf8", maxBuffer: 2 * 1024 * 1024, env: { ...process.env, GROUP_INFO_STATE: statePath, FAKE_LOG: logPath, FAKE_READBACK_MODE: "wrong", PATH: temp + ":" + (process.env.PATH || "") } });
    assertEqual(badBase.status, 1, "Base write readback rejects mismatched persisted value");
    assertIncludes(badBase.stderr, "读回链接内容不一致", "Base readback mismatch preserves failure reason");
    const wrongRecord = spawnSync(process.execPath, ["--input-type=module", "-e", baseCode], { cwd: process.cwd(), encoding: "utf8", maxBuffer: 2 * 1024 * 1024, env: { ...process.env, GROUP_INFO_STATE: statePath, FAKE_LOG: logPath, FAKE_READBACK_MODE: "wrong-record", PATH: temp + ":" + (process.env.PATH || "") } });
    assertEqual(wrongRecord.status, 1, "Base write readback rejects a different record");
    assertIncludes(wrongRecord.stderr, "读回记录 ID 不匹配", "Base readback record mismatch preserves failure reason");
    const baseFailureCode = `import { syncLinks } from ${JSON.stringify(join(process.cwd(), "scripts/lib/link-sync.js"))}; const result = syncLinks({ repo_path: process.cwd(), repo: process.cwd(), chat_id: "oc_probe" }, "rec_probe", [], "apply"); if (result.ok || !String(result.error).includes("probe-base-failure")) process.exit(1);`;
    const baseFailure = spawnSync(process.execPath, ["--input-type=module", "-e", baseFailureCode], { cwd: process.cwd(), encoding: "utf8", maxBuffer: 2 * 1024 * 1024, env: { ...process.env, GROUP_INFO_STATE: statePath, FAKE_LOG: logPath, FAKE_BASE_MODE: "fail", PATH: temp + ":" + (process.env.PATH || "") } });
    assertEqual(baseFailure.status, 0, "Base failure returns fail-closed sync result");
    const tabPostsAfterBaseFailure = readFileSync(logPath, "utf8").trim().split("\n").filter((call) => call.startsWith("api POST /open-apis/im/v1/chats/oc_probe/chat_tabs"));
    assertEqual(tabPostsAfterBaseFailure.length, 0, "Base failure does not write chat tabs");
    const chatSuccessCode = `import { syncLinksToChatTabs } from ${JSON.stringify(join(process.cwd(), "scripts/lib/link-sync.js"))}; const result = syncLinksToChatTabs({ chat_id: "oc_probe" }, [{ name: "probe", url: "https://example.com/wiki/probe", type: "doc" }], "apply"); if (!result.ok || result.updated !== 0) process.exit(1);`;
    const chatSuccess = spawnSync(process.execPath, ["--input-type=module", "-e", chatSuccessCode], { cwd: process.cwd(), encoding: "utf8", maxBuffer: 2 * 1024 * 1024, env: { ...process.env, FAKE_LOG: logPath, FAKE_TABS_MODE: "success", FAKE_TABS_COUNTER: tabsCounterPath, PATH: temp + ":" + (process.env.PATH || "") } });
    assertEqual(chatSuccess.status, 0, "chat tab type mismatch keeps existing tab and readback passes");
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}
