<!--
  index Agent 指引
  供 Codex / Claude 等 agent 在本仓库中工作时读取。
  -->

  # AGENTS.md

  ## 项目定位

  - 项目名称：index（核心项目索引站点）
  - 项目类型：静态 HTML 站点，部署到 GitHub Pages
  - 核心用途：维护 https://simplyy.github.io/core-repos-index/ ，展示全部 AI 项目的概要卡片、详情弹窗和汇总表格
  - 主要调用方：飞书群 group index 中的 Codex 小助手、group-info 的 sync-site 脚本

  ## README 与 AGENTS 分工

  - 本仓库无 README.md，AGENTS.md 是唯一的 Codex 执行指引。
  - GROUP_INFO.md 由 group-info 脚本自动生成，包含群绑定信息和项目定位，不要手动编辑。
  - index.html 中 `<!-- group-info-*-start -->` 到 `<!-- group-info-*-end -->` 之间的区域由 sync-site 脚本管理，不要手动编辑。

  ## 当前 MVP / 工作边界

  - 当前目标：维护站点正常运行，保持项目卡片和表格与 group-info 注册表同步。
  - 本阶段只做：站点内容更新、样式微调、部署。
  - 暂不做：引入 JS 框架、后端、数据库、动态路由。

  ## 关键目录

  - `index.html`：站点唯一文件，含 HTML/CSS/JS，全部内联。
  - `GROUP_INFO.md`：群绑定信息，由 group-info 脚本自动生成。
  - `AGENTS.md`：本文件。
  - 无 `src/`、`scripts/`、`docs/`、`.agents/skills/` 目录。

  ## 常用命令

  ```bash
  # 同步项目表格到站点并部署（推荐）
  node /Users/yuwei/code/skills/group-info/scripts/group-info.mjs sync-site --apply

  # 预览同步结果（不写文件）
  node /Users/yuwei/code/skills/group-info/scripts/group-info.mjs sync-site --dry-run

  # 查看全量项目列表
  node /Users/yuwei/code/skills/group-info/scripts/group-info.mjs list --format table
  ```

  ## 核心任务入口

  - **更新站点**：运行 `sync-site --apply`，脚本自动替换表格、更新缓存 hash、git commit + push。
  - **手动编辑**：仅限非自动生成区域（关于我、道法术器、当前探索、页脚等）。自动生成区域（卡片、弹窗、表格）走 sync-site。
  - **部署**：推送到 GitHub main 分支，GitHub Pages 自动部署。缓存问题：修改 build hash（footer 中的 `#xxx`）。

  ## 数据与凭证安全边界

  - 本项目无 .env、无密钥、无数据库、无 API 调用。
  - index.html 是公开静态站点，不要在其中写入任何私密信息。
  - sync-site 脚本会 git commit + push，执行前确认工作区干净。

  ## Codex 默认执行流程

  1. 先读本文件了解项目定位和边界。
  2. 修改前查看 git status，避免覆盖用户手动改动。
  3. 站点内容更新优先走 sync-site 脚本，不要手动编辑自动生成区域。
  4. 样式或布局修改直接改 index.html 的非自动生成部分。
  5. 修改后本地预览：`open index.html` 即可（纯静态，无需 dev server）。
  6. 确认无误后提交推送。

  ## 强制中文输出

  所有飞书群对话输出必须使用中文。仅专有名词（GitHub、Codex、RTK、API、JSON、URL、token 等）保留原文。禁止在描述性文字中混用英文单词替代中文表达。

  ## 测试 / 检查 / 验证方式

  - 无自动测试、类型检查、lint、构建步骤。
  - 手工验证：`open index.html` 在浏览器中检查卡片、弹窗、表格是否正常显示。
  - sync-site 后的验证：打开 https://simplyy.github.io/core-repos-index/ 确认部署生效。

  ## 不要做什么

  - 不要手动编辑 `<!-- group-info-*-start -->` 到 `<!-- group-info-*-end -->` 之间的内容。
  - 不要手动编辑 GROUP_INFO.md。
  - 不要引入 npm 依赖、构建工具、JS 框架。
  - 不要修改 GitHub Pages 部署配置（保持 main 分支自动部署）。
  - 不要在这个仓库里创建子目录或复杂文件结构。

  ## 何时应沉淀为 Skill

  - 站点内容更新已稳定走 group-info 的 sync-site 命令，无需额外 Skill。
  - 如需新增站点功能（如搜索、筛选、多语言），先评估是否值得，再考虑是否沉淀。

  ## 完成标准

  - 改动仅涉及 index.html 非自动生成区域或本文件。
  - 自动生成内容通过 sync-site 脚本更新。
  - 未覆盖用户手动改动。
  - 本地浏览器预览通过，或 sync-site 已成功推送。
