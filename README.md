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

- 验证版本：**DSH 0.2.0-rc.2（含 0.2 桌面端）**，并向下兼容 **DSH ≥ 0.1.1-rc.2**。
- 依赖的 API：`webServer.register`、`session/event`（`tool/call` / `tool/result`）、`sessions.list()`、客户端 `slots`（`shell.overlay` + `conversation.session.header.utilities`）—— 在 0.2 中均保持兼容。
- **0.2 插件兼容性预检**：0.2 会拒绝 `peerDependencies` 中 `@deepseek-ai/dsh-*` 不满足当前运行时版本、且未在 `profiles/<profile>/compatibility.json` 里逐条“接受风险”的插件。本插件不再声明 0.1 时代的 `@deepseek-ai/dsh-client-runtime` / `dsh-client-connection`（0.2 已不存在这两个包），因此**无需任何风险豁免即可加载**。

## 0.2 桌面端适配（v0.2.9 → v0.2.12）

- **面板形态：保持覆盖型浮层侧栏**（`shell.overlay`，浮在对话右缘、拖左缘调宽、✕ 关闭、`Ctrl+Alt+C` 开关）—— 与 0.1.x 完全一致。0.2 的 `sidebar.right.pane.tab` 会把面板变成右栏页签（桌面端上还会另开一个面板窗口），**已经试过并回退**（见 v0.2.12）。
- **变更引擎与 UI 解耦**：面板实例挂在 `shell.overlay`；SSE 变更流由 `startChangeFeed()` 引用计数共享，面板关闭时事件流照跑，头部胶囊照常计数。
- **工作区按会话解析 + 随盘适配**：`/root`、`/tree`、`/workspaces` 从当前会话的 `header.cwd` 解析（0.2 的项目目录绑定在会话上），并套用便携版的「同盘换盘符」规则（`launcher/fix-workspace-paths.mjs` 的 `mapPath()`），换盘符后工作区文件照样显示；会话目录彻底不存在时回退到最新存在的索引工作区并在界面说明。
- 0.2 桌面端是 `data-windows-titlebar` 布局，左侧栏入口仍用原有的 DOM 注入方式（与 Logcat / 嘉立创 EDA 一致，实测工作正常）。

## 使用

1. 打开 Code Studio：**对话头部**（会话标题右侧工具栏，和宿主的「打开方式」按钮同一排）常驻一枚变更胶囊 —— 显示当前会话 `N 个文件已变更 +A −D`，点主体开关右侧面板、点 `⌄` 展开变更文件清单并直接跳到某个文件的 Diff；也可用侧边栏入口或 `Ctrl+Alt+C`。面板可拖左缘调宽。
2. 让 Agent 修改代码 —— 面板**自动浮现**该文件的逐行 Diff：行号前 `+`（绿）/ `−`（红）/ `~`（黄），未改动大段自动折叠；面板关闭时侧边栏入口显示未查看变更数徽标。
3. 对不满意的修改点「还原」，一键回到 Agent 动手前；点「历史」回放该文件的每一次改动。
4. 「文件」页签：切换工作区、浏览文件树、打开文件直接编辑保存（`Ctrl+S`），或「发送到会话」让 Agent 接着改。
5. 变更多了？顶部搜索框 + 类型筛选快速定位；`Alt+↓/↑` 在变更间跳转。

## 技术说明

- **Host**（`lib/index.js`）：监听 `session/event` 工具事件（`tool/call` ↔ `tool/result` 配对），在 `tool/call` 阶段抓取还原点快照、在 `tool/result` 阶段即时读取并推送 before/after；递归文件监视 + mtime 轮询兜底；SSE 事件带自增 `id` 并保留 200 条环形缓冲用于 `Last-Event-ID` 断线补发；`/api/code-studio/*` REST + SSE（含 `/revert`、`/workspaces`、`/history`）。
- **Client**（`lib/client.js`）：浏览器 bundle，仅依赖 react；LCS 行级 Diff 引擎（大文件自动退化贪心算法）、窗口化虚拟滚动、语法高亮、按会话状态管理、未读徽标。UI 走宿主设计系统 —— 优先复用宿主暴露的 `@deepseek-ai/dsh-client-ui-primitives`（Button / Pill / Menu / Tooltip / 图标）并统一使用 `--dsw-alias-*`、`--dsh-scrollbar-*` 主题变量；该 UI 包不可用时自动降级为内置 token 化标记，功能不受影响。
- **自测**：`node scripts/selftest.mjs`（host 逻辑 26 项断言）、`node scripts/apply-toolargs.mjs`（工具参数回归）、`node scripts/smoke-client.mjs`（浏览器 bundle 冒烟 + 头部胶囊插槽断言）。

## 已知限制

- 单文件 > 512KB 不读取内容（防浏览器卡顿）；>100KB 的历史事件内容会截断保存（SSE 推送仍为全量）。
- 通过 bash/pwsh 等非文件工具写入的变更依赖文件监视兜底（仍会捕获，可能有少量延迟），且仅显示 Agent 声明过的文件。
- 还原点保存在内存中，服务重启后丢失（新会话的 Agent 修改会重新建立还原点）。


## v0.2.13 — 适配便携版「随盘」特性

- **同盘换盘符改写**：DSH 把工作区路径**绝对**存进会话头与 `storages/workspace.json`，而整个便携包可以换盘符。现在插件的 `/root`、`/tree`、`/workspaces` 与会话监听都走 `mapPortablePath()` —— 与 `launcher/fix-workspace-paths.mjs` **完全同一条规则**：路径存在就用原路径；否则把同样的路径（去掉盘符）重新锚到 **DSH 自己所在盘**（`DSH_HOME` 的盘符），且**只有那个目录真的存在时才改**。
- **工作区索引接入**：`/workspaces` 合并 DSH 自己的便携索引 `storages/workspace.json`（按 `updatedAt` 新的在前，含"目录不存在"标记），所以换盘后不会只剩一个空目录。
- **会话目录彻底不存在时兜底**：记录指向别的电脑/已删除目录的会话，不再给你一个空树 —— 自动回退到**最新的、真实存在的工作区**，并在界面上说明（`/root` 返回 `recorded` / `remapped` / `sessionMissing` / `exists`）。
- **界面提示**：「文件」页签顶部会显示「随盘：盘符已改变，路径按同盘规则改写到 …（记录的是 …）」，或「该会话记录的项目目录不存在，已回退到 …；换盘符后请运行「整理工作区分组.cmd」」，工作区下拉里不存在的目录也会标注。
- 实测（本机 130 份会话头 / 22 条工作区索引）：当前盘符已是 `F:`，改写成 no-op（正确）；9 份属于别的电脑的会话如实标注、绝不臆造路径。

## v0.2.12 — 回退：面板仍是覆盖型浮层侧栏

- **回退 v0.2.9~v0.2.11 的插槽改造**：面板重新挂回 `shell.overlay`（浮在对话右缘的覆盖型侧栏，拖左缘调宽、✕ 关闭），左侧栏入口恢复原有的 DOM 注入 —— 与 0.1.x 一致。
- 原因：0.2 的 `sidebar.right.pane.tab` / `main` 会把它变成右栏页签或中央面板（桌面端上还会另开一个面板窗口），都不是这个面板该有的形态。
- **保留**：包声明适配（去掉 0.2 已不存在的 peer / `dsh.client.inject`，无需风险豁免）、工作区按会话解析、`✕` 关闭按钮、引用计数共享的 SSE 变更流、窄宽度下自适应的状态栏、切会话重解析工作区。
- **修「关不掉」**：0.2 桌面端（Windows）把窗口标题栏画成页面里的固定层，而 `shell.overlay` 是 `inset:0` 的绝对层（连 `data-windows-titlebar` 那 40px 标题栏带一起覆盖）—— 面板顶行正好压在窗口控制按钮底下，`✕` 被挡住点不到（窗口越窄越明显，看起来甚至像"面板跑到独立窗口里了"）。现在面板在标题栏模式下按宿主自己的 `--dsh-windows-titlebar-height` 让到标题栏下方，`✕` 也提到上层；并且 **`Esc` 随时关闭面板**（✕ / `Ctrl+Alt+C` / 头部胶囊同样有效）。

## v0.2.11 — 右侧边栏页签（已回退，见 v0.2.12）

- **改成官方右侧边栏页签**（和「文件 / 终端 / 浏览器」同一种面板）：注册页签类型（`ctx.sidebarRightTabs.register({ id, kind, title })`）+ `sidebar.right.pane.tab` 主体 + `sidebar.right.pane.tab.title` 标题芯片；不再注册左侧 `sidebar.panellist` 入口，也不再占用中央 `main` 面板。
- 打开/隐藏走宿主自己的机制：头部胶囊 / `Ctrl+Alt+C` → `ctx.sidebarRight.openTab("code-studio")`（自动展开列），面板里的 **✕ 隐藏侧边栏** → `ctx.layout.closeRightbar()` —— 与对话头部那个右侧栏按钮同一条路径，另有宿主自带的收起按钮可用。
- 变更引擎与面板解耦：面板本体渲染在页签里，`shell.overlay` 只挂一个**无界面 feed 入口**（引用计数共享同一个 SSE 流）—— 页签关闭时头部胶囊照样计数，两者也不再有挂载顺序耦合。

## v0.2.10 — 工作区按会话解析 · 面板隐藏按钮

- **修 bug（0.2 桌面端）**：「文件」页签的工作区曾经取宿主进程的 cwd —— 在桌面端就是应用自己的 profile 目录（`…\profiles\desktop`，里面只有 compatibility.json / cordis.yml）。0.2 的项目目录是**按会话**（工作区）绑定的：现在 `/root`、`/tree`、`/workspaces` 都从**当前会话的 `header.cwd`** 解析（优先级 `config.root` → `DSH_WORKSPACE` → 当前会话目录 → 进程 cwd），客户端切会话时自动重解析，工作区下拉也会列出各活动会话的项目目录。
- **修 bug**：宿主面板形态下补回 **✕ 隐藏按钮**（点击 = `layout.selectPanel(null)` 回到对话；`Ctrl+Alt+C` 同效）。

## v0.2.9 — 0.2 桌面端适配（官方插槽 + 兼容性预检）

- 侧边栏入口从 DOM 注入改为官方 `sidebar.panellist` 插槽；新增 `main` 键位面板，点侧边栏行切到 Code Studio 中央面板（0.1.x 自动回退浮层模式）。
- 面板实例常驻 `shell.overlay`，UI 用 portal 进宿主容器 —— 未选中时变更流仍在跑。
- 包声明去掉 0.2 已不存在的 `@deepseek-ai/dsh-client-runtime` / `dsh-client-connection` peer 与 `dsh.client.inject`，0.2 无需风险豁免即可加载。
- 0.2 下不再自动抢占中央面板；未查看变更用头部胶囊圆点 + 侧边栏行圆点提示。

## v0.2.8 — 头部变更胶囊 · DSH 设计系统

- 变更提示从**右下角浮窗**（会压住输入框/发送工具条）迁移到**对话头部工具栏**：新增 `conversation.session.header.utilities` 插槽胶囊，`N 个文件已变更 +A −D`，主体开关面板、`⌄` 打开变更文件清单（点选直达该文件 Diff）。
- 面板关闭时不再渲染任何浮动元素；未读变更靠头部胶囊圆点 + 侧边栏徽标表达。
- UI 全面对齐 DSH 设计系统：复用宿主 UI 组件库、统一主题变量、宿主同款滚动条/焦点环/过渡。

##  v0.2.3 — 交互增强

- 行内单词级 Diff 高亮 + 变更上下文行 + 变更统计总览
- Diff 一键跳转到编辑器对应行；批量还原/清除；标记已审阅
- 编辑器撤销/重做、退出未保存提醒、查找替换
- 变更列表排序（最新/名称/改动量）、快捷键帮助弹层
