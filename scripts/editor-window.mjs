// editor-window.mjs - verifies the editor's windowed gutter/highlight layers.
//
// The editor used to render one node per line (a 5000-line file: ~15k DOM nodes, rebuilt on
// every keystroke). It now materializes only the visible window and stands in for the rest
// with spacers. Three things can silently break there, so each is asserted:
//   1. the visible window starts at line 1 and the numbers are contiguous (no gaps/dupes);
//   2. the spacer heights add up to the full document height, so the scrollbar and the
//      textarea stay in agreement;
//   3. the rendered line TEXT matches the content at that offset (window misaligned).
//
//   node scripts/editor-window.mjs
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const source = readFileSync(process.env.CUR_FILE ?? path.join(ROOT, "lib", "client.js"), "utf8");

const EDIT_LINE_H = Number(/const EDIT_LINE_H = ([\d.]+);/.exec(source)?.[1]);
if (!Number.isFinite(EDIT_LINE_H)) throw new Error("EDIT_LINE_H not found in the bundle");

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
const expand = (node) => {
  const owner = component, index = hookIndex;
  component = node.type.name || "anon"; hookIndex = 0;
  try { return node.type({ ...node.props, children: node.children.length === 1 ? node.children[0] : node.children }); }
  finally { component = owner; hookIndex = index; }
};

let loaded = null;
globalThis.window = { __ModuleLoader__: { load(spec) { loaded = spec; } } };
const realWarn = console.warn;
console.warn = () => {};
(0, eval)(source.replace("exports.apply = apply;",
  "exports.__x = { feed, panel, publishSummary, applyPanelState, setSessionId };\n\t\texports.apply = apply;"));
const mod = loaded.factory((name) => (name === "react" ? makeReact() : void 0));
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

/* ---------------------------------------------------------------- collect ---- */
// Walk the tree and collect per LAYER (the gutter and the highlight pre each keep their own
// spacers, so they must be measured separately): line numbers, line texts, spacer heights,
// and the total host-element count (the number that must stay bounded).
function inspect(node, acc = { nums: [], texts: [], layers: {}, nodes: 0, layer: null }) {
  if (node === null || node === undefined || typeof node === "boolean") return acc;
  if (typeof node === "string" || typeof node === "number") return acc;
  if (Array.isArray(node)) { for (const n of node) inspect(n, acc); return acc; }
  if (typeof node !== "object" || node.__el !== true) return acc;
  if (typeof node.type === "function") { inspect(expand(node), acc); return acc; }
  acc.nodes += 1;
  const cls = node.props.className;
  const isGutter = cls === "cs-edit-g";
  const isHl = cls === "cs-hl" || (node.type === "pre" && cls === "cs-hl");
  if (isGutter) acc.layer = "gutter";
  if (isHl) acc.layer = "hl";
  if (acc.layer !== null) {
    const layer = (acc.layers[acc.layer] ??= { spacers: [], lines: 0 });
    if (node.props.style && typeof node.props.style.height === "number") layer.spacers.push(node.props.style.height);
    // a line row is the div carrying minHeight:1.55em; the spacers are plain height divs
    if (node.props.style && node.props.style.minHeight === "1.55em") {
      layer.lines += 1;
      if (acc.layer === "hl") acc.texts.push(plainText(node));
    }
    // the gutter's rows are the .cs-gn numbers (they carry no inline style)
    if (acc.layer === "gutter" && cls === "cs-gn") layer.lines += 1;
  }
  if (cls === "cs-gn") acc.nums.push(Number(node.children.join("")));
  for (const c of node.children) inspect(c, acc);
  if (isGutter || isHl) acc.layer = null;
  return acc;
}
function plainText(node) {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(plainText).join("");
  if (node && node.__el === true) return typeof node.type === "function" ? plainText(expand(node)) : plainText(node.children);
  return "";
}

/* --------------------------------------------------------------- scenario ---- */
const N_LINES = 5000;
const content = Array.from({ length: N_LINES }, (_, i) => `  const value_${i} = compute(${i});`).join("\n");
const FILE = "F:\\proj\\src\\big.js";
mod.__x.feed.changes = [];

const states = {
  "CodeStudioPanel:0": true,
  "CodeStudioPanel:1": "files",
  "CodeStudioPanel:4": "F:\\proj",
  "CodeStudioPanel:5": { root: "F:\\proj", recorded: "F:\\proj", remapped: false, sessionMissing: false, exists: true },
  "CodeStudioPanel:6": { path: FILE, loading: false, error: null, dirty: false, content, baseline: content },
  "CodeStudioPanel:22": "session-c9106"
};
seed = states; component = "CodeStudioPanel"; hookIndex = 0;
const tree = captured["shell.overlay"].component();
const acc = inspect(tree);

let failures = 0;
const fail = (msg) => { failures++; console.error("FAIL: " + msg); };

// 1) windowed, not full materialization
if (acc.nodes > 1200) fail(`rendered ${acc.nodes} host nodes for ${N_LINES} lines: the editor is not windowed`);
if (acc.nums.length === 0) fail("no gutter line numbers rendered");
if (acc.nums.length >= N_LINES) fail(`gutter rendered ${acc.nums.length} of ${N_LINES} lines: not windowed`);
const windowRows = acc.nums.length;

// 2) gutter numbering contiguous from 1 (the harness has no scrollable element, so the
//    window starts at the top; that is exactly the default state a real mount hits first)
for (let i = 0; i < acc.nums.length; i++) {
  if (acc.nums[i] !== i + 1) { fail(`gutter numbering broken at index ${i}: ${acc.nums[i]} (expected ${i + 1})`); break; }
}

// 3) spacer arithmetic per layer: top + window + bottom must equal the document height
const layers = acc.layers;
for (const name of ["gutter", "hl"]) {
  const layer = layers[name];
  if (layer === void 0) { fail(`layer "${name}" was not rendered`); continue; }
  if (layer.lines !== windowRows) fail(`layer "${name}" rendered ${layer.lines} rows vs ${windowRows} gutter numbers`);
  const total = layer.spacers.reduce((a, b) => a + b, 0) + layer.lines * EDIT_LINE_H;
  const expected = N_LINES * EDIT_LINE_H;
  if (Math.abs(total - expected) > 0.5) fail(`layer "${name}" spacer height ${total.toFixed(1)}px does not match ${expected.toFixed(1)}px for ${N_LINES} lines`);
}

// 4) the rendered text must be the content at that offset
const contentLines = content.split("\n");
if (acc.texts.length !== windowRows) fail(`highlight layer rendered ${acc.texts.length} line texts vs ${windowRows} rows`);
for (let i = 0; i < Math.min(acc.texts.length, 40); i++) {
  if (acc.texts[i] !== contentLines[i]) { fail(`line ${i + 1} text mismatch: ${JSON.stringify(acc.texts[i])}`); break; }
}

console.warn = realWarn;
if (failures === 0) {
  const spacerSummary = ["gutter", "hl"].map((n) => n + ":" + layers[n].spacers.map((h) => h.toFixed(1)).join("+")).join(" ");
  console.log(`editor-window OK: ${N_LINES} lines -> ${windowRows} rendered rows, ${acc.nodes} host nodes, ` +
    `spacers ${spacerSummary} px, numbering and text aligned`);
}
process.exit(failures === 0 ? 0 : 1);
