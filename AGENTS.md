# AGENTS.md

## 项目定位

- 项目名称：Group Index
- 项目类型：飞书多维表格驱动的项目索引与群信息管理仓库
- 核心用途：用一张飞书多维表格 `group index` 管理项目的人脑字段，并派生 `GROUP_INFO.md` 和群置顶内容。
- 主要调用方：飞书群 Group Index 中的 Codex 小助手、`scripts/group-info.mjs`

## 核心数据源

- 飞书多维表格：`group index`
- 链接：https://ywhome.feishu.cn/base/AxMAbMTKOahp74sDuhqcERnrnph
- 表：`group index`
- 人工维护字段：项目、定位、优先级、链接、工作流、待办、备注；系统回填群 ID、仓库路径、仓库链接和初始化状态。
- 机器扫描字段：Skill、仓库数据源、可从代码或文档稳定读取的信息。

原则：

- 扫描不出来、只在用户脑子里的字段，放多维表格。
- 扫描得出来的字段，以仓库扫描为准。
- `state.json` 只保存运行状态，不保存人工判断字段。
- 不再维护静态网站；多维表格截图或链接就是分享入口。
- 新项目表单必须登录；Workflow 只允许指定创建者，并只把 `record_id` 送入 Agent，不传用户填写文本。
- `初始化状态`是 new-repo 的持久队列：`待处理`可认领、`处理中`防并发、`成功`和`需处理`不可自动重跑。

## 关键文件

- `scripts/group-info.mjs`：唯一执行入口。
- `scripts/lib/`：核心模块目录（`state.js`、`base.js`、`utils.js`、`fields.js`、`frontmatter.js`、`scan.js`）及 `commands/`（`update.js`、`top.js`、`list.js`、`self-test.js`）。
- `state.json`：机器运行状态，只记录更新时间、置顶消息和上次摘要。
- `GROUP_INFO.md`：本群 Agent 上下文，由脚本生成。
- `AGENTS.md`：本文件。

## 常用命令

```bash
# 查看全量项目
node scripts/group-info.mjs list --format table

# 预览单个 GROUP_INFO.md，不写文件
node scripts/group-info.mjs update --group index --dry-run

# 更新单个 GROUP_INFO.md
node scripts/group-info.mjs update --group index --apply

# 更新全部 GROUP_INFO.md
node scripts/group-info.mjs update-all --apply

# 发卡片 + 置顶
node scripts/group-info.mjs top --group index --apply

# 全量群发卡片 + 置顶
node scripts/group-info.mjs top-all --apply

# 自检
node scripts/group-info.mjs self-test
```

## 群置顶边界

- 群置顶走 `top` 子命令：发卡片 + 置顶。
- 每个群都需要群置顶，不由多维表格字段控制。
- 是否更新置顶，继续由原有摘要对比逻辑决定。
- 不新增“群置顶展示”之类字段。

## Codex 默认执行流程

1. 修改前运行 `rtk git status --short`。
2. 人工字段先查多维表格，不要从脚本里发明定位、优先级、工作流或待办。
3. 只改与任务直接相关的文件，不顺手重构群置顶逻辑。
4. 修改后至少运行 `node scripts/group-info.mjs self-test`。
5. 涉及飞书写入、群消息发送、批量更新时，先跑 dry-run。

## neatall / neat-freak 执行规则

- `neatall` 对所有仓库执行 `neat-freak` 是 skill 内置约定，无脑照跑，不许 agent 自作主张裁剪。
- 大改动仓库（>20 行）必须完整跑 `neat-freak`（`/Users/yuwei/code/skills/neat-freak/SKILL.md`），不许用「diff 安全审查」之类简化替代。
- 多个大改动仓库要**并行**触发 `neat-freak`（不是串行），每个仓库独立完成 ls 盘点 → 变更识别 → 文档/记忆同步 → 自检 → 摘要。
- 这件事由飞书 bot 自己完成，不推给桌面 Codex；「批量场景不适合、token 不现实」不是理由。

## 不要做什么

- 不要恢复静态网站或 `sync-site`。
- 不要新增项目宪章、评审记录、多张表或复杂流程。
- 不要把人工字段重新放回 JSON 注册表。
- 不要手动编辑其他仓库的 `GROUP_INFO.md`，走脚本更新。
- 不要引入 npm 依赖、构建工具、JS 框架或后端服务。

## 完成标准

- 人工判断字段来自 `group index` 多维表格。
- `GROUP_INFO.md` 保留原有增量生成逻辑。
- 群置顶逻辑保持原样。
- `self-test` 通过。

## 链接维护机制

链接数据源是仓库 README.md（以及 AGENTS.md、docs/TECH.md 等核心文档）。`group-info update` 执行时自动：

1. 从仓库核心文档提取 Markdown 链接（`[name](url)` 格式）和飞书链接。
2. 按重要性排序：飞书文档/多维表格 > 外部网站；README 靠前 > 靠后；关键段落（核心资产、入口、数据源等）> 普通段落。
3. 同步到 Base「链接」字段（Markdown 格式，`group-info` 可读）。
4. 同步到群标签页（doc/url 类型，飞书客户端可见）。

### 维护流转

- **用户**：在仓库 README.md 中维护核心链接，重要链接放前面。
- **Agent**：`group-info update` 时自动提取 → 同步到 Base + 群标签页 → 渲染到 GROUP_INFO.md。
- **AGENTS.md**：如果某链接需要长期维护但不在 README 中，Agent 应提示用户将其写入 README（或 README 的「核心资产」段落）。
- **不自动删除**：Base 和群标签页中手动添加的链接不会被自动删除，只做增量添加和名称更新。

### 链接格式约定

在 README.md 中推荐使用 Markdown 链接格式：
```
核心资产：[多维表格](https://xxx.feishu.cn/base/xxx)
```

这样 `group-info` 能提取到链接名称（「核心资产」）和 URL，自动同步到 Base 和群标签页。
