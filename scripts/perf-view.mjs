// perf-view.mjs - measures the two heavy VIEWS (not the change list): the editor's
// highlight layer and the diff viewer. Both are driven by a plain React shim so the
// numbers are the panel's own work (element creation + reconciliation of one render).
//
//   node scripts/perf-view.mjs [lines] [changedLines]
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const N_LINES = Number(process.argv[2] ?? 5000);
const N_CHANGED = Number(process.argv[3] ?? 4000);
const SRC = process.env.PERF_SRC ?? path.join(ROOT, "lib", "client.js");
const source = await fs.promises.readFile(SRC, "utf8");
const code = source.replace("exports.apply = apply;",
  "exports.__perf = { feed, panel, publishSummary, applyPanelState, setSessionId };\n\t\texports.apply = apply;");

/* ------------------------------------------------------------------ shim ---- */
let component = "?", hookIndex = 0, seed = {};
let elements = 0;
const makeReact = () => {
  const noop = () => {};
  return {
    createElement: (type, props, ...children) => {
      elements += 1;
      return { __el: true, type, props: props ?? {},
        children: children.flat(Infinity).filter((c) => c !== null && c !== undefined && c !== false && c !== true) };
    },
    useState: (init) => {
      const initial = typeof init === "function" ? init() : init;
      const key = component + ":" + hookIndex++;
      return [Object.prototype.hasOwnProperty.call(seed, key) ? seed[key] : initial, noop];
    },
    useEffect: () => {}, useLayoutEffect: () => {},
    useRef: (v) => ({ current: v }), useMemo: (f) => f(), useCallback: (f) => f, memo: (f) => f,
    Fragment: "Fragment"
  };
};

/* Walk the tree the way React would: function components get called, host elements
   count as DOM nodes. Element CREATION is counted separately in createElement above,
   which is exactly the cost a full-materialization bug shows up as. */
let domNodes = 0;
const walk = (node) => {
  if (node === null || node === undefined || typeof node === "boolean") return;
  if (Array.isArray(node)) { for (const n of node) walk(n); return; }
  if (typeof node !== "object" || node.__el !== true) return;
  if (typeof node.type === "function") {
    const owner = component, i = hookIndex;
    component = node.type.name || "anon"; hookIndex = 0;
    try { walk(node.type({ ...node.props, children: node.children.length === 1 ? node.children[0] : node.children })); }
    finally { component = owner; hookIndex = i; }
    return;
  }
  domNodes += 1;
  for (const c of node.children) walk(c);
};

/* ------------------------------------------------------------------ boot ---- */
let loaded = null;
globalThis.window = { __ModuleLoader__: { load(spec) { loaded = spec; } } };
(0, eval)(code);
const mod = loaded.factory((name) => {
  if (name === "react") return makeReact();
  throw new Error("perf-view: host UI kit unavailable");
});
const P = mod.__perf;

const captured = {};
const slots = {
  inject(name, run) { run(); return () => {}; },
  register(spec, comp) { captured[spec.name] = { spec, component: comp }; return () => {}; },
  entriesOfSlot() { return []; }, entries() { return []; }
};
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

const renderPanel = (states) => {
  seed = states; component = "CodeStudioPanel"; hookIndex = 0;
  elements = 0; domNodes = 0;
  const t0 = performance.now();
  walk(captured["shell.overlay"].component());
  return { ms: performance.now() - t0, elements, domNodes };
};

const fmt = (x) => String(Math.round(x * 100) / 100).padStart(8);
const report = [];

/* ------------------------------------------------------------- 1. editor ---- */
const fileLines = [];
for (let i = 0; i < N_LINES; i++) fileLines.push(`  const value_${i} = compute(${i}) + offset;`);
const fileContent = fileLines.join("\n");
const FILE = "F:\\proj\\src\\big.js";
const editorStates = {
  "CodeStudioPanel:0": true,
  "CodeStudioPanel:1": "files",
  "CodeStudioPanel:4": "F:\\proj",
  "CodeStudioPanel:5": { root: "F:\\proj", recorded: "F:\\proj", remapped: false, sessionMissing: false, exists: true },
  "CodeStudioPanel:6": { path: FILE, loading: false, error: null, dirty: true, content: fileContent, baseline: fileContent },
  "CodeStudioPanel:22": "session-c2999106"
};
const ed1 = renderPanel(editorStates);
report.push(`  editor ${String(N_LINES).padStart(5)} lines (first)   ${fmt(ed1.ms)} ms  ${String(ed1.elements).padStart(7)} elements  ${String(ed1.domNodes).padStart(7)} DOM nodes`);
const ed2 = renderPanel(editorStates);
report.push(`  editor ${String(N_LINES).padStart(5)} lines (re-render) ${fmt(ed2.ms)} ms  ${String(ed2.elements).padStart(7)} elements  ${String(ed2.domNodes).padStart(7)} DOM nodes`);

/* --------------------------------------------------------------- 2. diff ---- */
const before = [];
const after = [];
for (let i = 0; i < N_CHANGED; i++) {
  before.push(`  const a_${i} = original(${i});`);
  after.push(`  const a_${i} = rewritten(${i});`);
}
const change = {
  path: FILE, name: "big.js", deleted: false, sessionId: "session-c2999106",
  ts: 1790000000000, seq: 1,
  before: before.join("\n"), after: after.join("\n")
};
const diffStates = {
  "CodeStudioPanel:0": true,
  "CodeStudioPanel:3": FILE,   // expandedPath -> DiffRows open
  "CodeStudioPanel:22": "session-c2999106"
};
P.feed.changes = [change];
P.feed.conn = "ok"; P.feed.connText = "已连接";
const d1 = renderPanel(diffStates);
report.push(`  diff   ${String(N_CHANGED).padStart(5)} changed lines (first)    ${fmt(d1.ms)} ms  ${String(d1.elements).padStart(7)} elements  ${String(d1.domNodes).padStart(7)} DOM nodes`);
const d2 = renderPanel(diffStates);
report.push(`  diff   ${String(N_CHANGED).padStart(5)} changed lines (re-render)  ${fmt(d2.ms)} ms  ${String(d2.elements).padStart(7)} elements  ${String(d2.domNodes).padStart(7)} DOM nodes`);

console.log(report.join("\n"));
