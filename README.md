# Code Studio — DSH Web UI 文件修改监视器 · 代码工作台

> A **file-change monitor & code editor** inside the DeepSeek Harness Web UI.
> Watch agent edits land as line-by-line diffs in real time, right beside your
> conversation — then open, edit and save any workspace file without leaving
> the browser.

在 DeepSeek Harness 的 Web 界面里，实时监视 Agent 对文件的每一次修改：**改动落盘的瞬间**，逐行 Diff（`+` 新增 / `−` 删除 / `~` 修改）自动浮现在你的会话旁；内置语法高亮编辑器，随时查看和修改工作区文件。**不用离开 DSH，Agent 改了哪里、改了什么，一目了然。**

## 核心价值

- 🔭 **实时文件修改监视**：基于会话工具事件直推，Agent 每次 write / edit 完成立即推送 Diff —— 不依赖文件系统轮询，不漏报、不延迟。
- 🗂 **多工作区覆盖**：自动监视所有会话的工作区目录，Agent 在任意目录改文件都能捕获。
- 🔒 **按会话隔离**：每个 Code Studio 只响应当前会话的修改，切换会话互不干扰。
- 🧠 **会话状态记忆**：变更列表、打开的标签、面板宽度按会话分别保留（本地持久化）。
- 📝 **语法高亮编辑器**：类编辑器体验，行号、光标、滚动同步；`Ctrl+S` 保存，`Ctrl+D` 查看 Diff。
- 📐 **可拖拽面板**：宽度自由调整并记住；UI 与 DSH 主题完全一致（`--dsw-alias-*` 令牌）。

## 安装

```sh
dsh plugin --profile web add @windypro-rourou/dsh-code-studio
# 或使用 GitHub 源
dsh plugin --profile web add github:WindyPro-rourou/dsh-code-studio
```

重启 `dsh web` 后，左侧边栏出现 **Code Studio** 入口。

## 使用

1. 打开 Code Studio（右侧面板，可拖左缘调宽）。
2. 让 Agent 修改代码 —— 面板**自动浮现**该文件的逐行 Diff：行号前 `+`（绿）/ `−`（红）/ `~`（黄），未改动大段自动折叠。
3. 「文件」页签：浏览工作区、打开文件、直接编辑保存（`Ctrl+S`）。

## 技术说明

- **Host**（`lib/index.js`）：监听 `session/event` 工具事件（`tool/call` ↔ `tool/result` 配对），对写文件工具即时读取并推送 before/after；递归文件监视 + mtime 轮询兜底；`/api/code-studio/*` REST + SSE。
- **Client**（`lib/client.js`）：浏览器 bundle，仅依赖 react；LCS 行级 Diff 引擎、语法高亮、按会话状态管理。

## 已知限制

- 单文件 > 512KB 不读取内容（防浏览器卡顿）。
- 通过 bash/pwsh 等非文件工具写入的变更依赖文件监视兜底（仍会捕获，可能有少量延迟）。
