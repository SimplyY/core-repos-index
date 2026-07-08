<!--
  core-repos-index Agent 指引
  供 Codex / Claude 等 agent 在本仓库中工作时读取。
-->

# core-repos-index Agent 指引

## 强制中文输出

所有飞书群对话输出必须使用中文。仅专有名词（GitHub、Codex、RTK、API、JSON、URL、token 等）保留原文。禁止在描述性文字中混用英文单词替代中文表达（如「Group Info」→「群信息」、「Base」→「多维表格」、「pin」→「置顶」、「summary」→「摘要」、「link」→「链接」、「deploy」→「部署」）。

## 项目定位

个人 AI 项目总览站点，手机端优先的静态页面，展示所有项目的概要介绍和详细信息。

## 关键文件

- `index.html`：站点首页，10 个项目卡片，平铺概要 + 点击弹窗详情
- `GROUP_INFO.md`：飞书群绑定信息

## 站点结构

- 静态 HTML，部署到 GitHub Pages：`https://simplyy.github.io/core-repos-index/`
- 构建哈希嵌入 footer，用于缓存失效
- 手机端优先，最大宽度 640px

## 部署

推送 `main` 分支后 GitHub Pages 自动部署。如有缓存问题，修改 build hash（footer 中的 `#xxx`）强制刷新。
