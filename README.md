# Code Studio — DSH Web UI 文件修改监视器 · 代码工作台

> A **file-change monitor & code editor** inside the DeepSeek Harness Web UI.
> Watch agent edits land as line-by-line diffs in real time, right beside your
> conversation — then open, edit and save any workspace file without leaving
> the browser.

在 DeepSeek Harness 的 Web 界面里，实时监视 Agent 对文件的每一次修改：**改动落盘的瞬间**，逐行 Diff（`+` 新增 / `−` 删除 / `~` 修改）自动浮现在你的会话旁；内置语法高亮编辑器，随时查看和修改工作区文件。**不用离开 DSH，Agent 改了哪里、改了什么、想还原就还原。**

## 核心价值

- 🔭 **实时文件修改监视**：基于会话工具事件直推，Agent 每次 write / edit 完成立即推送 Diff —— 不依赖文件系统轮询，不漏报、不延迟。
- 🗂 **多工作区覆盖 + 切换器**：自动监视所有会话的工作区目录，「文件」页签顶部可随时切换工作区根目录（按会话记忆）。
- 🔒 **按会话隔离**：每个 Code Studio 只响应当前会话的修改，切换会话互不干扰；未查看变更数徽标按会话分别计数。
- 🧠 **会话状态记忆**：变更列表、打开的标签、面板宽度、过滤条件、工作区选择按会话分别保留（本地持久化）。
- ↩️ **一键还原（Revert）**：每个变更条目带「还原」按钮 —— 撤销 Agent 在本会话内对该文件的全部修改（还原点取自 Agent 首次写入前的内容快照；新建文件还原为删除；检测到外部修改会提示冲突）。
- 🕘 **修改历史时间线**：每个文件的 Agent / 用户 / 还原事件按时间倒序回放，任意版本可展开查看 Diff。
- 💬 **发送到会话**：把当前打开的文件内容一键发给当前会话的 Agent（不可用时自动退化为复制到剪贴板）。
- 📝 **语法高亮编辑器**：类编辑器体验，行号、光标、滚动同步；`Ctrl+S` 保存，`Ctrl+D` 查看 Diff。
- ⚡ **大文件虚拟滚动**：Diff 视图窗口化渲染 + 差异过大截断提示，万行级文件流畅滚动。
- 🔁 **SSE 断线自愈**：事件带序号 + 服务端环形缓冲，断线重连自动补发丢失的变更（Last-Event-ID）。
- 🔍 **变更过滤搜索**：按路径关键词 + 文件类型（代码/文档/配置/其他）过滤变更列表。
- ⌨️ **键盘快捷键**：`Ctrl+Alt+C` 开关面板，`Alt+↓/↑` 在变更之间跳转。
- 📐 **可拖拽面板**：宽度自由调整并记住；UI 与 DSH 主题完全一致（`--dsw-alias-*` 令牌）。

## 安装

```sh
dsh plugin --profile web add @windypro-rourou/dsh-code-studio
# 或使用 GitHub 源
dsh plugin --profile web add github:WindyPro-rourou/dsh-code-studio
```

重启 `dsh web` 后，左侧边栏出现 **Code Studio** 入口。

## 兼容性

- 验证版本：**DSH ≥ 0.1.1-rc.2**（`@deepseek-ai/dsh`、`dsh-web-app`、`dsh-base`、`dsh-client-runtime`）。
- 依赖的 API：`webServer.register`、`session/event`（`tool/call` / `tool/result`）、`sessions.list()`、客户端 `slots` 服务 —— 在 0.1.1-rc.2 中均保持兼容。

## 使用

1. 打开 Code Studio（右侧面板，可拖左缘调宽；`Ctrl+Alt+C` 快捷开关）。
2. 让 Agent 修改代码 —— 面板**自动浮现**该文件的逐行 Diff：行号前 `+`（绿）/ `−`（红）/ `~`（黄），未改动大段自动折叠；面板关闭时侧边栏入口显示未查看变更数徽标。
3. 对不满意的修改点「还原」，一键回到 Agent 动手前；点「历史」回放该文件的每一次改动。
4. 「文件」页签：切换工作区、浏览文件树、打开文件直接编辑保存（`Ctrl+S`），或「发送到会话」让 Agent 接着改。
5. 变更多了？顶部搜索框 + 类型筛选快速定位；`Alt+↓/↑` 在变更间跳转。

## 技术说明

- **Host**（`lib/index.js`）：监听 `session/event` 工具事件（`tool/call` ↔ `tool/result` 配对），在 `tool/call` 阶段抓取还原点快照、在 `tool/result` 阶段即时读取并推送 before/after；递归文件监视 + mtime 轮询兜底；SSE 事件带自增 `id` 并保留 200 条环形缓冲用于 `Last-Event-ID` 断线补发；`/api/code-studio/*` REST + SSE（含 `/revert`、`/workspaces`、`/history`）。
- **Client**（`lib/client.js`）：浏览器 bundle，仅依赖 react；LCS 行级 Diff 引擎（大文件自动退化贪心算法）、窗口化虚拟滚动、语法高亮、按会话状态管理、未读徽标。
- **自测**：`node scripts/selftest.mjs`（host 逻辑 21 项断言）、`node scripts/smoke-client.mjs`（浏览器 bundle 冒烟）。

## 已知限制

- 单文件 > 512KB 不读取内容（防浏览器卡顿）；>100KB 的历史事件内容会截断保存（SSE 推送仍为全量）。
- 通过 bash/pwsh 等非文件工具写入的变更依赖文件监视兜底（仍会捕获，可能有少量延迟），且仅显示 Agent 声明过的文件。
- 还原点保存在内存中，服务重启后丢失（新会话的 Agent 修改会重新建立还原点）。
