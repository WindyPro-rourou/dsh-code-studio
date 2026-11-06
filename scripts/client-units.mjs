// client-units.mjs - focused unit tests for behaviour that a render comparison cannot see:
// the syntax tokenizer, the localStorage snapshot policy, and the keyboard layer
// (Escape precedence + which shortcuts are allowed while the panel is closed).
//
//   node scripts/client-units.mjs
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const source = readFileSync(process.env.CUR_FILE ?? path.join(ROOT, "lib", "client.js"), "utf8");

let failures = 0;
const check = (cond, name, detail) => {
  if (cond) { console.log("  ok   " + name); return; }
  failures += 1;
  console.error("  FAIL " + name + (detail === void 0 ? "" : ": " + detail));
};

/* ------------------------------------------------------------------ shim ---- */
let component = "?", hookIndex = 0, seed = {};
const setCalls = new Map();
const makeReact = () => ({
  createElement: (type, props, ...children) => ({ __el: true, type, props: props ?? {},
    children: children.flat(Infinity).filter((c) => c !== null && c !== undefined && c !== false && c !== true) }),
  useState: (init) => {
    const initial = typeof init === "function" ? init() : init;
    const key = component + ":" + hookIndex++;
    const value = Object.prototype.hasOwnProperty.call(seed, key) ? seed[key] : initial;
    return [value, (next) => {
      let calls = setCalls.get(key);
      if (calls === void 0) { calls = []; setCalls.set(key, calls); }
      calls.push(next);
    }];
  },
  useEffect: (fn) => { try { fn(); } catch { /* DOM-dependent effects are out of scope */ } },
  useLayoutEffect: (fn) => { try { fn(); } catch { /* ditto */ } },
  useRef: (v) => ({ current: v }), useMemo: (f) => f(), useCallback: (f) => f, memo: (f) => f,
  Fragment: "Fragment"
});

// A fake window that records global key handlers.
const keyHandlers = [];
const fakeWindow = {
  __ModuleLoader__: { load(spec) { loaded = spec; } },
  addEventListener(type, fn) { if (type === "keydown") keyHandlers.push(fn); },
  removeEventListener(type, fn) {
    if (type !== "keydown") return;
    const i = keyHandlers.indexOf(fn);
    if (i >= 0) keyHandlers.splice(i, 1);
  }
};
globalThis.window = fakeWindow;
globalThis.EventSource = class { constructor() { this.readyState = 0; } close() {} };
globalThis.localStorage = { getItem: () => null, setItem: () => {} };

let loaded = null;
const realWarn = console.warn;
console.warn = () => {};
(0, eval)(source.replace("exports.apply = apply;",
  "exports.__u = { tokenizeLine, persistableSnapshot, panel, subscribePanel, feed, publishSummary, applyPanelState, setSessionId };\n\t\texports.apply = apply;"));
const mod = loaded.factory((name) => (name === "react" ? makeReact() : void 0));
const U = mod.__u;

/* ------------------------------------------------------------- tokenizer ---- */
console.log("== syntax tokenizer ==");
const clsOf = (toks, text) => (toks.find((t) => t.text === text) ?? {}).cls;
{
  const css = U.tokenizeLine("color: #fff;", false);
  check(clsOf(css, "#fff") === "cs-tok-num", "a CSS hex colour is a colour, not a comment", JSON.stringify(css));
  check(!css.some((t) => t.cls === "cs-tok-cmt"), "the rest of a CSS line is not swallowed as a comment");
  check(clsOf(css, ";") === "", "code after the colour is still code");
}
{
  const py = U.tokenizeLine("x = 1  # note here", true);
  check(py.some((t) => t.cls === "cs-tok-cmt" && t.text.startsWith("#")), "a Python # comment is a comment", JSON.stringify(py));
}
{
  const js = U.tokenizeLine("a # b", false);
  check(!js.some((t) => t.cls === "cs-tok-cmt"), "JS has no # comments, so nothing is swallowed");
}
{
  const call = U.tokenizeLine("compute(1)", false);
  check(clsOf(call, "compute") === "cs-tok-fn", "an identifier followed by ( is highlighted as a call", JSON.stringify(call));
  const spaced = U.tokenizeLine("compute (1)", false);
  check(clsOf(spaced, "compute") === "cs-tok-fn", "a space before the paren still counts", JSON.stringify(spaced));
  const plain = U.tokenizeLine("value + 1", false);
  check(clsOf(plain, "value") === "", "a bare identifier is not a call");
}
{
  const kw = U.tokenizeLine("const x = 1;", false);
  check(clsOf(kw, "const") === "cs-tok-kw", "keywords keep their class");
  check(clsOf(kw, "1") === "cs-tok-num", "numbers keep their class");
  const str = U.tokenizeLine('const s = "hi";', false);
  check(str.some((t) => t.cls === "cs-tok-str" && t.text === '"hi"'), "strings keep their class");
}

/* -------------------------------------------------------- snapshot policy ---- */
console.log("== localStorage snapshot policy ==");
{
  const small = { editor: { path: "a.js", content: "x".repeat(1000), dirty: true } };
  check(U.persistableSnapshot(small) === small, "a small editor buffer is persisted unchanged");
  const big = { editor: { path: "a.js", content: "x".repeat(100 * 1024), dirty: true }, tab: "files" };
  const out = U.persistableSnapshot(big);
  check(out !== big, "a large buffer produces a different snapshot");
  check(out.editor.content === null && out.editor.reload === true, "the buffer is dropped and marked for reload", JSON.stringify(out.editor));
  check(out.editor.path === "a.js" && out.tab === "files", "the location and the rest of the state survive");
  const none = { editor: null, tab: "changes" };
  check(U.persistableSnapshot(none) === none, "no editor means nothing to strip");
}

/* ------------------------------------------------------------- keyboard ---- */
console.log("== keyboard: Escape precedence ==");
const captured = {};
const slots = {
  inject(name, run) { run(); return () => {}; },
  register(spec, comp) { captured[spec.name] = { spec, component: comp }; return () => {}; },
  entriesOfSlot() { return []; }, entries() { return []; }
};
mod.apply({
  effect(fn) { try { fn(); } catch { /* ignore */ } return () => {}; },
  on() { return () => {}; },
  get(name) {
    if (name === "sessions") return { list: { getSnapshot: () => ({ current: "s1" }), subscribe: () => () => {} } };
    if (name === "slots") return slots;
    return void 0;
  },
  webServer: { register() { return () => {}; } }
});

const mountPanel = (states) => {
  setCalls.clear();
  // The shim does not run effect cleanups, so unmount by hand: otherwise every mount adds
  // another window keydown handler and a single key press toggles the panel N times.
  keyHandlers.length = 0;
  seed = { "CodeStudioPanel:0": true, "CodeStudioPanel:1": "changes", "CodeStudioPanel:22": "s1", ...states };
  component = "CodeStudioPanel"; hookIndex = 0;
  captured["shell.overlay"].component();
};
const ev = (key, extra) => ({
  key,
  target: { tagName: "DIV", isContentEditable: false },
  preventDefault() {}, stopPropagation() {},
  ctrlKey: false, metaKey: false, altKey: false, shiftKey: false,
  ...(extra ?? {})
});
const fire = (e) => { for (const fn of keyHandlers.slice()) fn(e); };
const callsFor = (key) => setCalls.get(key) ?? [];

// Help open: Escape closes the help, not the panel.
U.applyPanelState(true);
mountPanel({ "CodeStudioPanel:21": true });   // showHelp = true
fire(ev("Escape"));
check(callsFor("CodeStudioPanel:21").length === 1 && callsFor("CodeStudioPanel:21")[0] === false,
  "Escape closes the help sheet first", JSON.stringify(callsFor("CodeStudioPanel:21")));
check(U.panel.open === true, "the panel stays open when help was the open layer");

// Nothing open: Escape closes the panel.
U.applyPanelState(true);
mountPanel({});
fire(ev("Escape"));
check(U.panel.open === false, "Escape closes the panel when nothing else is open");

// Focused field: Escape is left to the field.
U.applyPanelState(true);
mountPanel({});
fire(ev("Escape", { target: { tagName: "TEXTAREA", isContentEditable: false } }));
check(U.panel.open === true, "Escape inside a text field does not close the panel");

console.log("== keyboard: shortcuts are scoped to an open panel ==");
U.applyPanelState(false);
mountPanel({ "CodeStudioPanel:0": false });
fire(ev("?", {}));
check(callsFor("CodeStudioPanel:21").length === 0, "? does nothing while the panel is closed");
const beforeToggle = U.panel.open;
fire(ev("c", { ctrlKey: true, altKey: true }));
check(U.panel.open === !beforeToggle, "Ctrl+Alt+C still toggles while the panel is closed");

console.warn = realWarn;
console.log(failures === 0 ? "\nclient-units OK" : "\nclient-units: " + failures + " failures");
process.exit(failures === 0 ? 0 : 1);
