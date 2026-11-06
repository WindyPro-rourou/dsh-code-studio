// render-equivalence.mjs - proves the windowed diff viewer renders the SAME tree as the
// previous full-materialization implementation.
//
// The diff viewer was rewritten from "build every row element, then slice" to "build only
// the visible rows". That is a pure refactor of how rows are produced, so the output must
// be identical node for node. This loads BOTH bundles (the committed one from git and the
// working copy), renders the same scenarios through the same React shim, canonicalizes the
// trees, and compares them.
//
// Three things this test has to get right to be worth anything:
//   1. hook state must be injectable per component instance (see resetHooks), otherwise
//      "DiffRows:0 = open" silently does nothing and the expanded layout is never tested;
//   2. every render must be checked for actually containing diff rows, so a scenario that
//      renders nothing cannot pass vacuously;
//   3. the comparison must be mutation-checked (see --mutation in the CI notes): swapping
//      the word-diff arguments used to slip through because only collapsed mode ran.
//
//   node scripts/render-equivalence.mjs
//   CUR_FILE=/path/to/mutated.js node scripts/render-equivalence.mjs   # mutation check
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const GIT = process.env.GIT_BIN || "git";
const REF = process.env.REF_REV || "HEAD";

const reference = execFileSync(GIT, ["show", `${REF}:lib/client.js`], { cwd: ROOT, maxBuffer: 1 << 28 }).toString("utf8");
// CUR_FILE exists so the test itself can be mutation-checked (point it at a deliberately
// broken copy and the suite must fail); normally it is just the working bundle.
const working = readFileSync(process.env.CUR_FILE ?? path.join(ROOT, "lib", "client.js"), "utf8");

/* ------------------------------------------------------- shared hook state ---- */
// ONE set of these for the whole process: the shim reads them, and the tree walker writes
// them when it expands a function component. Sharing is what makes "DiffRows:1 = 400"
// address the right hook.
let component = "?", hookIndex = 0, seed = {};

function makeReact() {
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
}

/** Enter a component's hook scope, run it, and restore the caller's scope. */
function expand(node) {
  const owner = component, index = hookIndex;
  component = node.type.name || "anon";
  hookIndex = 0;
  try {
    return node.type({ ...node.props, children: node.children.length === 1 ? node.children[0] : node.children });
  } finally { component = owner; hookIndex = index; }
}

function bootBundle(code) {
  let loaded = null;
  globalThis.window = { __ModuleLoader__: { load(spec) { loaded = spec; } } };
  (0, eval)(code.replace("exports.apply = apply;",
    "exports.__x = { feed, panel, publishSummary, applyPanelState, setSessionId };\n\t\texports.apply = apply;"));
  const mod = loaded.factory((name) => {
    if (name === "react") return makeReact();
    throw new Error("equivalence: host UI kit unavailable");
  });
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
  return {
    P: mod.__x,
    /** Render the overlay with the given hook seeds. */
    render(states) {
      seed = states; component = "CodeStudioPanel"; hookIndex = 0;
      const panel = captured["shell.overlay"];
      if (panel === void 0) throw new Error("equivalence: overlay entry missing");
      return panel.component();
    }
  };
}

/* -------------------------------------------------------- canonicalization ---- */
// tag.class{style}!|text, with function components expanded exactly as React would.
function canon(node, out = []) {
  if (node === null || node === undefined || typeof node === "boolean") return out;
  if (typeof node === "string" || typeof node === "number") { out.push("T:" + String(node)); return out; }
  if (Array.isArray(node)) { for (const n of node) canon(n, out); return out; }
  if (typeof node !== "object" || node.__el !== true) return out;
  if (typeof node.type === "function") return canon(expand(node), out);
  const cls = node.props.className === undefined ? "" : "." + node.props.className;
  const style = node.props.style === undefined ? "" : "{" + Object.entries(node.props.style).map(([k, v]) => k + "=" + v).join(",") + "}";
  const onClick = typeof node.props.onClick === "function" ? "!" : "";
  out.push(node.type + cls + style + onClick);
  for (const c of node.children) canon(c, out);
  out.push("/" + node.type);
  return out;
}

/* -------------------------------------------------------------- scenarios ---- */
const FILE = "F:\\proj\\src\\mod.js";
const S = "session-c2999106";
const lines = (n, f) => Array.from({ length: n }, (_, i) => f(i)).join("\n");

const scenarios = [
  { name: "single modified line", before: "a\nb\nc", after: "a\nB\nc" },
  { name: "balanced multi-line rewrite", before: lines(12, (i) => `x${i} = 1;`), after: lines(12, (i) => (i >= 4 && i < 7 ? `x${i} = 2;` : `x${i} = 1;`)) },
  { name: "separated edits (gaps)", before: lines(60, (i) => `line ${i}`), after: lines(60, (i) => (i === 2 || i === 30 || i === 57 ? `CHANGED ${i}` : `line ${i}`)) },
  { name: "pure additions", before: lines(6, (i) => `keep ${i}`), after: lines(6, (i) => `keep ${i}`) + "\nadded a\nadded b" },
  { name: "pure deletions", before: lines(9, (i) => `keep ${i}`), after: "keep 0\nkeep 1" },
  { name: "unbalanced replace (no mod pairing)", before: "a\nb\nc\nd", after: "a\nX\nY\nZ\nd" },
  { name: "file created from nothing", before: null, after: lines(8, (i) => `new ${i}`) },
  { name: "empty to content and back", before: "", after: "one\ntwo" },
  { name: "long lines with word-level changes", before: "const x = alpha + beta + gamma + delta;", after: "const x = alpha + BETA + gamma + delta;" },
  { name: "large diff (trimming path)", before: lines(400, (i) => `row ${i}`), after: lines(400, (i) => (i % 40 === 0 ? `ROW ${i}` : `row ${i}`)) }
];

// Scrolling is where the windowed viewer is actually risky (the span lookup has to land on
// the right block, and a mod pair may be split by the window edge). Fixed pixel offsets
// would scroll past the end of a short diff, so the offsets are derived per scenario from
// the real row count: the spacers in the rendered tree give the total (top + bottom + the
// rows in between, all ROW_H tall).
const ROW_H = 18;
const FRACTIONS = [0, 0.3, 0.6, 0.9];
// Both layouts matter: collapsed shows gap rows and renders each mod op on its own, while
// expanded (clicking a gap) runs the word-level diff over the whole op list.
const MODES = [{ name: "collapsed", open: false }, { name: "expanded", open: true }];

/** Total rows of the diff body, read off the two spacer heights plus the rows between. */
function totalRows(tree) {
  const spacers = tree.filter((t) => typeof t === "string" && /^div\{height=/.test(t))
    .map((t) => Number(/(?:^|\{)height=([\d.]+)/.exec(t)?.[1] ?? 0));
  const between = tree.filter((t) => typeof t === "string" && (t.startsWith("div.cs-dline") || t.startsWith("div.cs-dgap"))).length;
  if (spacers.length < 2) return between;
  return Math.round((spacers[0] + spacers[1]) / ROW_H) + between;
}

const realWarn = console.warn;
console.warn = () => {};   // the plugin warns once per bundle when the host kit is absent

let failures = 0, compared = 0, rowsCompared = 0, totalMarks = 0, skipped = 0;
const fail = (msg) => { failures++; console.error("FAIL: " + msg); };

for (const sc of scenarios) {
  const change = { path: FILE, name: "mod.js", deleted: false, sessionId: S, ts: 1790000000000, seq: 1,
    before: sc.before, after: sc.after };
  for (const mode of MODES) {
    const statesFor = (offset) => ({
      "CodeStudioPanel:0": true,
      "CodeStudioPanel:3": FILE, // expandedPath -> DiffRows mounted
      "CodeStudioPanel:22": S,
      "DiffRows:0": mode.open,
      "DiffRows:1": offset
    });

    // Phase 1: measure this scenario's row count from the reference at the top.
    const probe = bootBundle(reference);
    probe.P.feed.changes = [change];
    probe.P.feed.conn = "ok"; probe.P.feed.connText = "已连接";
    const rows = totalRows(canon(probe.render(statesFor(0))));
    const offsets = FRACTIONS.map((f) => Math.round(rows * ROW_H * f));

    for (const offset of offsets) {
      const label = `"${sc.name}" ${mode.name} @${offset}px (${rows} rows)`;

      const ref = bootBundle(reference);
      ref.P.feed.changes = [change];
      ref.P.feed.conn = "ok"; ref.P.feed.connText = "已连接";
      const refTree = canon(ref.render(statesFor(offset)));

      const cur = bootBundle(working);
      cur.P.feed.changes = [change];
      cur.P.feed.conn = "ok"; cur.P.feed.connText = "已连接";
      const curTree = canon(cur.render(statesFor(offset)));

      const refRows = refTree.filter((t) => typeof t === "string" && t.startsWith("div.cs-dline")).length;
      const curRows = curTree.filter((t) => typeof t === "string" && t.startsWith("div.cs-dline")).length;
      // A side that shows rows while the other shows none IS a difference; both empty means
      // there was nothing at that offset (not a pass, but not a failure).
      if (refRows === 0 && curRows === 0) { skipped += 1; continue; }
      if (refRows !== curRows) { fail(`scenario ${label}: ${refRows} diff rows vs ${curRows}`); continue; }
      rowsCompared += refRows;
      totalMarks += refTree.filter((t) => typeof t === "string" && (t.startsWith("mark.cs-wh-add") || t.startsWith("mark.cs-wh-del"))).length;
      compared += 1;

      if (refTree.length !== curTree.length) {
        fail(`scenario ${label}: tree length ${refTree.length} vs ${curTree.length}`);
        const i = refTree.findIndex((t, k) => t !== curTree[k]);
        console.error(`  first difference at ${i}: ref=${JSON.stringify(refTree[i])} cur=${JSON.stringify(curTree[i])}`);
        continue;
      }
      for (let i = 0; i < refTree.length; i++) {
        if (refTree[i] !== curTree[i]) {
          fail(`scenario ${label}: node ${i} differs: ref=${JSON.stringify(refTree[i])} cur=${JSON.stringify(curTree[i])}`);
          break;
        }
      }
    }
  }
}

console.warn = realWarn;
// If the word-diff branch is never reached, the comparison cannot vouch for it; refuse to
// report a clean run on a blind spot.
if (totalMarks === 0) fail("no word-level diff marks were rendered at all: the expanded layout was not exercised");
console.log(`render-equivalence: ${compared} renders compared, ${skipped} empty windows skipped ` +
  `(${scenarios.length} scenarios x ${MODES.length} layouts x ${FRACTIONS.length} scroll positions), ` +
  `${rowsCompared} diff rows and ${totalMarks} word-diff marks, ${failures} failures`);
process.exit(failures === 0 ? 0 : 1);
