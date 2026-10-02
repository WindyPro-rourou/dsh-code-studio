// preview-ui.mjs - renders the Code Studio panel with the REAL components (via a
// tiny React shim) into static HTML, so the stylesheet can be reviewed and
// screenshotted offline. Dev-only helper; it never touches the running GUI.
//
//   node scripts/preview-ui.mjs --record   # dump component/hook order
//   node scripts/preview-ui.mjs            # write preview/*.html
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const OUT = path.join(ROOT, "preview");
const source = await fs.promises.readFile(path.join(ROOT, "lib", "client.js"), "utf8");

const css = (/const CSS = `([\s\S]*?)`;/.exec(source) ?? [])[1];
if (css === undefined) throw new Error("stylesheet block not found in lib/client.js");
const code = source.replace("exports.apply = apply;",
  "exports.__preview = { feed, panel, summary, publishSummary, applyPanelState, setSessionId, bumpUnseen, badgeKey };\n\t\texports.apply = apply;");

/* ---------------------------------------------------------------- React shim */
let component = "?", hookIndex = 0, seed = {}, record = null;
const makeReact = () => {
  const noop = () => {};
  return {
    createElement: (type, props, ...children) => ({ __el: true, type, props: props ?? {},
      children: children.flat(Infinity).filter((c) => c !== null && c !== undefined && c !== false && c !== true) }),
    useState: (init) => {
      const initial = typeof init === "function" ? init() : init;
      const key = component + ":" + hookIndex++;
      if (record !== null) record.push(key + " = " + String(JSON.stringify(initial)).slice(0, 70));
      return [Object.prototype.hasOwnProperty.call(seed, key) ? seed[key] : initial, noop];
    },
    useEffect: () => {}, useLayoutEffect: () => {},
    useRef: (v) => ({ current: v }), useMemo: (f) => f(), useCallback: (f) => f, memo: (f) => f,
    Fragment: "Fragment"
  };
};

/* --------------------------------------------------------------- serializer */
const escapeHtml = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const UNITLESS = new Set(["zIndex", "opacity", "flex", "flexGrow", "flexShrink", "order", "lineHeight", "fontWeight", "zoom"]);
const styleToCss = (style) => style === undefined || style === null ? ""
  : Object.entries(style).map(([k, v]) => {
      const name = k.replace(/[A-Z]/g, (c) => "-" + c.toLowerCase());
      if (typeof v === "number" && v !== 0 && !UNITLESS.has(k)) return name + ":" + v + "px";
      return name + ":" + String(v);
    }).join(";");
const VOID_TAGS = new Set(["input", "br", "hr", "img"]);
function toHtml(node) {
  if (node === null || node === undefined || node === false || node === true) return "";
  if (typeof node === "string" || typeof node === "number") return escapeHtml(String(node));
  if (Array.isArray(node)) return node.map(toHtml).join("");
  if (node.__el !== true) return "";
  if (typeof node.type === "function") {
    const owner = component, index = hookIndex;
    component = node.type.name || "anon"; hookIndex = 0;
    try { return toHtml(node.type({ ...node.props, children: node.children.length === 1 ? node.children[0] : node.children })); }
    finally { component = owner; hookIndex = index; }
  }
  if (typeof node.type !== "string") return node.children.map(toHtml).join("");
  const attrs = [];
  for (const [k, v] of Object.entries(node.props)) {
    if (k === "children" || k === "key" || v === null || v === undefined || typeof v === "function") continue;
    if (k === "dangerouslySetInnerHTML") continue;
    if (k === "className") { attrs.push('class="' + escapeHtml(String(v)) + '"'); continue; }
    if (k === "style") { const s = styleToCss(v); if (s !== "") attrs.push('style="' + escapeHtml(s) + '"'); continue; }
    if (k === "value") { attrs.push('value="' + escapeHtml(String(v)) + '"'); continue; }
    if (k === "checked") { if (v) attrs.push("checked"); continue; }
    if (v === true) { attrs.push(escapeHtml(k)); continue; }
    attrs.push(escapeHtml(k) + '="' + escapeHtml(String(v)) + '"');
  }
  const inner = node.props.dangerouslySetInnerHTML?.__html ?? node.children.map(toHtml).join("");
  const head = "<" + node.type + (attrs.length ? " " + attrs.join(" ") : "") + ">";
  return VOID_TAGS.has(node.type) ? head : head + inner + "</" + node.type + ">";
}

/* --------------------------------------------------------------- load plugin */
let loaded = null;
globalThis.window = { __ModuleLoader__: { load(spec) { loaded = spec; } } };
(0, eval)(code);
const mod = loaded.factory((name) => {
  if (name === "react") return makeReact();
  throw new Error("preview: host UI kit unavailable"); // exercise the built-in markup
});
const P = mod.__preview;
if (P === undefined) throw new Error("preview handles missing");

/** Boot the plugin and capture the components it registers into given slots. */
function boot() {
  const captured = {};
  const slots = {
    inject(name, run) { run(); return () => {}; },
    register(spec, comp) { captured[spec.name] = { spec, component: comp }; return () => {}; },
    entriesOfSlot() { return []; }, entries() { return []; }
  };
  seed = {}; component = "?"; hookIndex = 0;
  mod.apply({
    effect(fn) { fn(); return () => {}; },
    on() { return () => {}; },
    get(name) {
      if (name === "sessions") return { list: { getSnapshot: () => ({ current: "s1" }), subscribe: () => () => {} } };
      if (name === "slots") return slots;
      return void 0;
    },
    webServer: { register() { return () => {}; } }
  });
  return captured;
}
const captured = boot();
const render = (entry, states) => { seed = states ?? {}; component = entry.component.name || "anon"; hookIndex = 0; return toHtml(entry.component()); };

/* ----------------------------------------------------------------- scenarios */
const FILE_A = "F:\\dsh-code-studio\\lib\\client.js";
const now = 1790000000000;
const changeList = [
  { path: FILE_A, name: "client.js", deleted: false, sessionId: "session-c2999106", ts: now - 9000, seq: 7,
    before: "const API = \"/api/code-studio\";\nfunction api(path, init) {\n  return fetch(API + path, init);\n}\n",
    after: "const API = \"/api/code-studio\";\nfunction api(path, init) {\n  const res = await fetch(API + path, init);\n  if (!res.ok) throw new Error(\"request failed\");\n  return res.json();\n}\n" },
  { path: "F:\\dsh-code-studio\\lib\\index.js", name: "index.js", deleted: false, sessionId: "session-c2999106", ts: now - 4000, seq: 8,
    before: "const root = process.cwd();\n", after: "const root = mapPortablePath(session.header.cwd);\n" },
  { path: "F:\\dsh-code-studio\\README.md", name: "README.md", deleted: false, sessionId: "session-4f21ab", ts: now - 1000, seq: 9,
    before: "# Code Studio\n", after: "# Code Studio 0.3\n" }
];
const scenarios = [
  { id: "panel-empty", title: "变更 · 空态", entry: "shell.overlay",
    setup(v) { v.feed.changes = []; v.feed.conn = "ok"; v.feed.connText = "已连接"; },
    states: { "CodeStudioPanel:0": true, "CodeStudioPanel:22": "session-c2999106" } },
  { id: "panel-changes", title: "变更 · 列表 + 展开 Diff", entry: "shell.overlay",
    setup(v) { v.feed.changes = changeList; v.feed.conn = "ok"; v.feed.connText = "已连接"; },
    states: { "CodeStudioPanel:0": true, "CodeStudioPanel:3": FILE_A, "CodeStudioPanel:22": "session-c2999106" } },
  { id: "panel-editor", title: "文件 · 编辑器", entry: "shell.overlay",
    setup(v) { v.feed.changes = changeList; v.feed.conn = "busy"; v.feed.connText = "已保存 21:04"; },
    states: {
      "CodeStudioPanel:0": true, "CodeStudioPanel:1": "files", "CodeStudioPanel:4": "F:\\dsh-code-studio",
      "CodeStudioPanel:5": { root: "F:\\dsh-code-studio", recorded: "F:\\dsh-code-studio", remapped: false, sessionMissing: false, exists: true },
      "CodeStudioPanel:6": { path: FILE_A, loading: false, error: null, dirty: true,
        content: "const API = \"/api/code-studio\";\nexport async function api(path, init) {\n  const res = await fetch(API + path, init);\n  if (!res.ok) throw new Error(\"failed: \" + res.status);\n  return res.json();\n}\n",
        baseline: "const API = \"/api/code-studio\";\n" },
      "CodeStudioPanel:15": [{ path: "F:\\dsh-code-studio", label: "dsh-code-studio", sessionCount: 3, exists: true },
        { path: "F:\\华为watchgt5", label: "华为watchgt5", sessionCount: 1, exists: true }],
      "CodeStudioPanel:16": "F:\\dsh-code-studio", "CodeStudioPanel:22": "session-c2999106"
    } },
  { id: "panel-help", title: "快捷键浮层", entry: "shell.overlay",
    setup(v) { v.feed.changes = changeList; v.feed.conn = "ok"; v.feed.connText = "已连接"; },
    states: { "CodeStudioPanel:0": true, "CodeStudioPanel:21": true, "CodeStudioPanel:22": "session-c2999106" } },
  { id: "pill", title: "对话头部胶囊", entry: "conversation.session.header.utilities",
    setup(v) { v.publishSummary({ count: 3, adds: 48, dels: 12, sessionId: "s1",
      files: [{ path: FILE_A, adds: 40, dels: 9 }, { path: "F:\\dsh-code-studio\\lib\\index.js", adds: 8, dels: 3 }] }); },
    states: {}, stage: "pill" }
];

if (process.argv.includes("--record")) {
  record = [];
  render(captured["shell.overlay"], {});
  console.log("hook order:\n" + record.join("\n"));
  process.exit(0);
}

// The stage is exactly the panel's width so a headless capture (which may scale)
// still shows the whole panel instead of cropping its right side.
const page = (body, stageClass) => {
  const width = stageClass === "pill" ? 320 : 400;
  return `<!doctype html><html lang="zh"><head><meta charset="utf-8"><title>Code Studio preview</title>
<style>
  :root{color-scheme:dark}
  html,body{margin:0;width:${width}px;height:100%;background:#0b0e14;overflow:hidden}
  body{display:flex;align-items:stretch;font:13px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif;color:#d7dde6}
  .stage{position:relative;width:${width}px;height:100%;display:flex}
  .stage.pill{align-items:flex-start;padding:14px;height:60px;background:#12151c}
  ${css}
</style></head><body><div class="stage ${stageClass ?? ""}">${body}</div></body></html>`;
};

await fs.promises.mkdir(OUT, { recursive: true });
const written = [];
for (const sc of scenarios) {
  seed = {}; component = "?"; hookIndex = 0;
  sc.setup(P);
  const entry = captured[sc.entry];
  if (entry === undefined) throw new Error("no component registered for " + sc.entry);
  const html = render(entry, sc.states);
  const file = path.join(OUT, sc.id + ".html");
  await fs.promises.writeFile(file, page(html, sc.stage), "utf8");
  written.push("  " + path.relative(ROOT, file) + "  (" + sc.title + ")");
}
console.log("preview written:\n" + written.join("\n"));
