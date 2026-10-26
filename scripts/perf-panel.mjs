// perf-panel.mjs - measures the panel's real render cost with the REAL components.
//
// The panel recomputes per-file line stats (a full O(n*m) DP diff) while rendering, so
// the number that matters is "ms for one render of an N-file session" -- and how much of
// it is repeated work when nothing changed. This harness boots the plugin through the
// same React shim as preview-ui.mjs, feeds it a synthetic session, and times renders.
//
//   node scripts/perf-panel.mjs [files] [lines]
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
// PERF_SRC lets the same harness run against another revision of the bundle (e.g.
// `git show HEAD:lib/client.js`), so before/after numbers come from identical code paths.
const SRC = process.env.PERF_SRC ?? path.join(ROOT, "lib", "client.js");
const source = await fs.promises.readFile(SRC, "utf8");
// Count real line diffs per render: the whole point is that a re-render must not re-diff
// files whose stats are already known.
globalThis.__diffCount = 0;
const code = source
  .replace("function fileStats(before, after) {", "function fileStats(before, after) { globalThis.__diffCount++;")
  .replace("exports.apply = apply;",
    "exports.__perf = { feed, panel, summary, publishSummary, applyPanelState, setSessionId, fileStats, lineDiff };\n\t\texports.apply = apply;");

const N_FILES = Number(process.argv[2] ?? 400);
const N_LINES = Number(process.argv[3] ?? 120);
// scatter = an edit on every 12th line (hostile to common prefix/suffix trimming);
// local   = one contiguous 8-line edit deep in the file (what an agent actually does).
const MODE = process.argv[4] ?? "scatter";

/* ------------------------------------------------------------------ shim ---- */
let component = "?", hookIndex = 0, seed = {};
const makeReact = () => {
  const noop = () => {};
  return {
    createElement: (type, props, ...children) => ({ __el: true, type, props: props ?? {},
      children: children.flat(Infinity).filter((c) => c !== null && c !== undefined && c !== false && c !== true) }),
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

/* ----------------------------------------------------------- serialize ---- */
let nodes = 0;
const els = (node) => {
  if (node === null || node === undefined || typeof node === "boolean") return;
  if (Array.isArray(node)) { for (const n of node) els(n); return; }
  if (typeof node !== "object" || node.__el !== true) return;
  nodes++;
  if (typeof node.type === "function") { const owner = component, i = hookIndex; component = node.type.name || "anon"; hookIndex = 0; try { els(node.type({ ...node.props, children: node.children.length === 1 ? node.children[0] : node.children })); } finally { component = owner; hookIndex = i; } return; }
  for (const c of node.children) els(c);
};

/* ------------------------------------------------------------------ boot ---- */
let loaded = null;
globalThis.window = { __ModuleLoader__: { load(spec) { loaded = spec; } } };
(0, eval)(code);
const mod = loaded.factory((name) => {
  if (name === "react") return makeReact();
  throw new Error("perf: host UI kit unavailable");
});
const P = mod.__perf;
if (P === undefined) throw new Error("perf handles missing (did exports.apply move?)");

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

/* ------------------------------------------------------------- workload ---- */
// A realistic session: many files, each a modest edit in the middle.
function makeFile(i) {
  const before = [];
  const after = [];
  for (let l = 0; l < N_LINES; l++) {
    const line = `  const value_${l} = compute(${l}) + ${i};`;
    before.push(line);
    const touched = MODE === "local" ? (l >= 40 && l < 48) : (l % 12 === 0);
    after.push(touched ? `  const value_${l} = compute(${l}) * ${i + 1}; // touched` : line);
  }
  for (let l = 0; l < 4; l++) after.push(`  // appended tail ${l}`);
  return {
    path: `F:\\proj\\src\\mod${String(i).padStart(3, "0")}\\file${i}.js`,
    name: `file${i}.js`,
    deleted: false,
    sessionId: "session-c2999106",
    ts: 1790000000000 - i * 1000,
    seq: i + 1,
    before: before.join("\n"),
    after: after.join("\n")
  };
}
const changeList = Array.from({ length: N_FILES }, (_, i) => makeFile(i));

const renderOnce = (states) => {
  seed = states;
  component = "CodeStudioPanel";
  hookIndex = 0;
  nodes = 0;
  globalThis.__diffCount = 0;
  const t0 = performance.now();
  els(captured["shell.overlay"].component());
  return { ms: performance.now() - t0, nodes, diffs: globalThis.__diffCount };
};

const BASE = { "CodeStudioPanel:0": true, "CodeStudioPanel:22": "session-c2999106" };
P.feed.changes = changeList;
P.feed.conn = "ok";
P.feed.connText = "已连接";

const fmt = (x) => String(Math.round(x * 100) / 100).padStart(9);
const report = [];
const run = (label, states) => {
  const r = renderOnce({ ...BASE, ...states });
  report.push(`  ${label.padEnd(34)} ${fmt(r.ms)} ms   ${String(r.nodes).padStart(6)} nodes   ${String(r.diffs).padStart(5)} diffs`);
  return r;
};

console.log(`perf-panel: ${N_FILES} files x ${N_LINES} lines, edits=${MODE} (session timeline sort)`);
const cold = run("render 1 (cold, JIT included)", {});
// Warm renders are repeated: a single number is mostly GC noise once the work is zero.
let warm = [];
for (let k = 0; k < 5; k++) warm.push(run("warm render " + (k + 2), {}));
console.log(`perf-panel: sort by delta (worst case for stats reuse)`);
const deltaFirst = run("delta sort (first)", { "CodeStudioPanel:20": "delta" });
const deltaWarm = run("delta sort (warm)", { "CodeStudioPanel:20": "delta" });
console.log(`perf-panel: filtered to ~1% of the list`);
const filtered = run("filter=file01", { "CodeStudioPanel:13": "file01" });
const warmMs = warm.map((r) => r.ms);
const sorted = warmMs.slice().sort((x, y) => x - y);
console.log(`perf-panel: warm render median ${sorted[Math.floor(sorted.length / 2)].toFixed(2)} ms (of 5)`);

// Raw diff throughput: one full pass over the session's files, which is the irreducible
// work behind the first (cold) render. Warm the JIT first so this measures the algorithm,
// not compilation.
const statsPass = () => {
  globalThis.__diffCount = 0;
  let adds = 0, dels = 0;
  const t0 = performance.now();
  for (const c of changeList) { const s = P.fileStats(c.before, c.after); adds += s.adds; dels += s.dels; }
  return { ms: performance.now() - t0, diffs: globalThis.__diffCount, adds, dels };
};
statsPass();
const pass = statsPass();
console.log(`perf-panel: raw stats pass over ${N_FILES} files: ${pass.ms.toFixed(1)} ms ` +
  `(${(pass.ms / N_FILES).toFixed(3)} ms/file, ${pass.diffs} diffs, +${pass.adds} -${pass.dels})`);

// Deterministic properties, safe to gate CI on (no timing): a full pass diffs each file
// exactly once, and no interaction re-renders the set. Timings above are informational.
const problems = [];
if (cold.diffs !== N_FILES) problems.push(`the cold render ran ${cold.diffs} diffs, expected exactly one per file (${N_FILES})`);
for (const [i, r] of warm.entries()) if (r.diffs !== 0) problems.push(`warm render ${i + 2} re-diffed ${r.diffs} files`);
if (deltaFirst.diffs !== 0) problems.push(`switching to sort=delta re-diffed ${deltaFirst.diffs} files`);
if (deltaWarm.diffs !== 0) problems.push(`the delta-sorted render re-diffed ${deltaWarm.diffs} files`);
if (filtered.diffs !== 0) problems.push(`filtering re-diffed ${filtered.diffs} files`);
if (pass.diffs !== N_FILES) problems.push(`the stats pass ran ${pass.diffs} diffs for ${N_FILES} files`);
if (problems.length > 0) {
  console.error("perf-panel FAILED:\n  - " + problems.join("\n  - "));
  process.exit(1);
}
console.log(`perf-panel OK: no redundant diffing across renders (${N_FILES} files, 0 diffs per re-render)`);
console.log(report.join("\n"));
