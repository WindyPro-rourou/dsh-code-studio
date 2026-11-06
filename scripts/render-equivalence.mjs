// render-equivalence.mjs - proves the windowed diff viewer still renders what the previous
// full-materialization implementation rendered.
//
// The diff viewer was rewritten from "build every row element, then slice" to "build only
// the visible rows". What the user sees must not change: same rows, in the same order, with
// the same row kind, the same line numbers and the same text. That is what this compares --
// a per-row SIGNATURE (kind, number, text) plus the gap rows and the spacer heights that
// hold the scroll height -- rather than raw tag sequences, so intentional markup
// improvements (inline word-diff marks, syntax colours on changed lines) do not fail it
// while any real regression in content or layout does.
//
// Guards against a useless pass:
//   * a render with no diff rows on either side is skipped, not counted;
//   * a side that shows rows while the other shows none fails;
//   * if no word-diff marks exist anywhere, the expanded layout was not exercised -> fail.
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
const working = readFileSync(process.env.CUR_FILE ?? path.join(ROOT, "lib", "client.js"), "utf8");

/* ------------------------------------------------------- shared hook state ---- */
// ONE set of these for the whole process: the shim reads them and the walker writes them
// when it expands a component, so "DiffRows:1 = 400" addresses the right hook. Without the
// reset, every seeded state is silently ignored and only the default layout ever runs.
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
    render(states) {
      seed = states; component = "CodeStudioPanel"; hookIndex = 0;
      const panel = captured["shell.overlay"];
      if (panel === void 0) throw new Error("equivalence: overlay entry missing");
      return panel.component();
    }
  };
}

/* ------------------------------------------------------------- inspection ---- */
/** Concatenated text of a node, expanding components and ignoring markup. */
function textOf(node) {
  if (node === null || node === undefined || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (typeof node !== "object" || node.__el !== true) return "";
  if (typeof node.type === "function") return textOf(expand(node));
  return textOf(node.children);
}

/**
 * What the user sees: one entry per diff row (kind + line number + text, in order), the gap
 * rows, and the spacer heights that keep the scrollbar honest.
 */
function signature(tree) {
  const rows = [], gaps = [], spacers = [];
  const classOf = (n) => (typeof n.props.className === "string" ? n.props.className : "");
  const walk = (node) => {
    if (node === null || node === undefined || typeof node === "boolean") return;
    if (typeof node === "string" || typeof node === "number") return;
    if (Array.isArray(node)) { for (const n of node) walk(n); return; }
    if (typeof node !== "object" || node.__el !== true) return;
    if (typeof node.type === "function") { walk(expand(node)); return; }
    const cls = classOf(node);
    if (cls.includes("cs-dline")) {
      const num = node.children.find((c) => c && c.__el === true && classOf(c) === "cs-dnum");
      rows.push({ cls: cls.replace("cs-dline", "").trim(), num: num === void 0 ? "" : textOf(num), text: textOf(node) });
      return;
    }
    if (cls.includes("cs-dgap")) { gaps.push(textOf(node)); return; }
    if (node.props.style && typeof node.props.style.height === "number") spacers.push(node.props.style.height);
    for (const c of node.children) walk(c);
  };
  walk(tree);
  return { rows, gaps, spacers };
}

/** Count real word-diff marks (the signature deliberately ignores them). */
function countMarks(tree) {
  let n = 0;
  const walk = (node) => {
    if (node === null || node === undefined || typeof node === "boolean") return;
    if (typeof node === "string" || typeof node === "number") return;
    if (Array.isArray(node)) { for (const c of node) walk(c); return; }
    if (typeof node !== "object" || node.__el !== true) return;
    if (typeof node.type === "function") { walk(expand(node)); return; }
    if (node.type === "mark") n += 1;
    for (const c of node.children) walk(c);
  };
  walk(tree);
  return n;
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

const ROW_H = 18;
const FRACTIONS = [0, 0.3, 0.6, 0.9];
const MODES = [{ name: "collapsed", open: false }, { name: "expanded", open: true }];

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

    // Phase 1: this scenario's row count, read off the reference at the top.
    const probe = bootBundle(reference);
    probe.P.feed.changes = [change];
    probe.P.feed.conn = "ok"; probe.P.feed.connText = "已连接";
    const probeSig = signature(probe.render(statesFor(0)));
    const rows = probeSig.rows.length + Math.round(probeSig.spacers.reduce((a, b) => a + b, 0) / ROW_H);
    const offsets = FRACTIONS.map((f) => Math.round(rows * ROW_H * f));

    for (const offset of offsets) {
      const label = `"${sc.name}" ${mode.name} @${offset}px (${rows} rows)`;

      const ref = bootBundle(reference);
      ref.P.feed.changes = [change];
      ref.P.feed.conn = "ok"; ref.P.feed.connText = "已连接";
      const refTree = ref.render(statesFor(offset));

      const cur = bootBundle(working);
      cur.P.feed.changes = [change];
      cur.P.feed.conn = "ok"; cur.P.feed.connText = "已连接";
      const curTree = cur.render(statesFor(offset));

      const refSig = signature(refTree);
      const curSig = signature(curTree);

      if (refSig.rows.length === 0 && curSig.rows.length === 0) { skipped += 1; continue; }
      if (refSig.rows.length !== curSig.rows.length) {
        fail(`${label}: ${refSig.rows.length} rows vs ${curSig.rows.length}`);
        continue;
      }
      compared += 1;
      rowsCompared += refSig.rows.length;
      totalMarks += countMarks(curTree);

      if (refSig.rows.length !== 0) {
        for (let i = 0; i < refSig.rows.length; i++) {
          const a = refSig.rows[i], b = curSig.rows[i];
          if (a.cls !== b.cls || a.num !== b.num || a.text !== b.text) {
            fail(`${label}: row ${i} differs\n    ref=${JSON.stringify(a)}\n    cur=${JSON.stringify(b)}`);
            break;
          }
        }
      }
      if (JSON.stringify(refSig.gaps) !== JSON.stringify(curSig.gaps)) {
        fail(`${label}: gap rows differ\n    ref=${JSON.stringify(refSig.gaps)}\n    cur=${JSON.stringify(curSig.gaps)}`);
      }
      // Spacer heights must be identical: they are the scroll geometry.
      const refSpacers = refSig.spacers.filter((h) => h > 0);
      const curSpacers = curSig.spacers.filter((h) => h > 0);
      if (JSON.stringify(refSpacers) !== JSON.stringify(curSpacers)) {
        fail(`${label}: spacer heights differ (scroll geometry)\n    ref=${JSON.stringify(refSpacers)}\n    cur=${JSON.stringify(curSpacers)}`);
      }
    }
  }
}

console.warn = realWarn;
if (totalMarks === 0) fail("no word-level diff marks were rendered at all: the word-diff path was not exercised");
console.log(`render-equivalence: ${compared} renders compared, ${skipped} empty windows skipped ` +
  `(${scenarios.length} scenarios x ${MODES.length} layouts x ${FRACTIONS.length} scroll positions), ` +
  `${rowsCompared} diff rows and ${totalMarks} word-diff marks, ${failures} failures`);
process.exit(failures === 0 ? 0 : 1);
