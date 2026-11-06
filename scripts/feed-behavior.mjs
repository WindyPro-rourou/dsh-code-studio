// feed-behavior.mjs - regression tests for the change-feed behaviours that are easy to get
// wrong and invisible in a static check:
//
//   1. A file CREATED in this session must keep `before: null` on later writes. Falling back
//      to the event's own `before` silently turned it into a modification (no "new file"
//      badge, and revert restored intermediate content instead of deleting the file).
//   2. An agent edit must not take the tab away from the user. Automatic reveals used to
//      call setTab("changes") on every event, throwing the user out of the editor.
//   3. setConn must not notify when nothing changed: every SSE frame re-asserts "ok", which
//      used to re-render the panel for every single event.
//
//   node scripts/feed-behavior.mjs
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
// Effects run for real (that is how the panel registers its subscriptions) and every state
// setter records its calls, so "did this switch the tab?" is observable.
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
  useEffect: (fn) => { try { fn(); } catch { /* effects that need a live DOM are out of scope */ } },
  useLayoutEffect: (fn) => { try { fn(); } catch { /* ditto */ } },
  useRef: (v) => ({ current: v }), useMemo: (f) => f(), useCallback: (f) => f, memo: (f) => f,
  Fragment: "Fragment"
});
const expand = (node) => {
  const owner = component, index = hookIndex;
  component = node.type.name || "anon"; hookIndex = 0;
  try { return node.type({ ...node.props, children: node.children.length === 1 ? node.children[0] : node.children }); }
  finally { component = owner; hookIndex = index; }
};

/* -------------------------------------------------------------- EventSource ---- */
const sources = [];
class FakeEventSource {
  constructor(url) { this.url = url; this.readyState = 0; sources.push(this); }
  close() { this.readyState = 2; }
}

let loaded = null;
globalThis.window = { __ModuleLoader__: { load(spec) { loaded = spec; } } };
globalThis.EventSource = FakeEventSource;
globalThis.localStorage = { getItem: () => null, setItem: () => {} };
const realWarn = console.warn;
console.warn = () => {};
(0, eval)(source.replace("exports.apply = apply;",
  "exports.__x = { feed, setConn, subscribeFeed, focusChange, subscribeFocus, startChangeFeed, panel };\n\t\texports.apply = apply;"));
const mod = loaded.factory((name) => (name === "react" ? makeReact() : void 0));
const P = mod.__x;

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

// Mount the panel once: that is what registers the feed, the focus subscription and the
// session wiring. "CodeStudioPanel:0" is the open flag, ":1" is the active tab.
seed = { "CodeStudioPanel:0": true, "CodeStudioPanel:1": "files", "CodeStudioPanel:22": "s1" };
component = "CodeStudioPanel"; hookIndex = 0;
P.panel.open = true;
captured["shell.overlay"].component();

console.log("== change feed: created-file baseline ==");
check(sources.length === 1, "the panel opened exactly one SSE stream", "got " + sources.length);
const es = sources[0];

const send = (ev) => es.onmessage({ data: JSON.stringify(ev) });
const FILE = "F:\\proj\\src\\created.js";
send({ path: FILE, before: null, after: "line 1\n", ts: 1, seq: 1, sessionId: "s1" });
check(P.feed.changes.length === 1 && P.feed.changes[0].before === null, "first write records before:null (file created)");
send({ path: FILE, before: "line 1\n", after: "line 1\nline 2\n", ts: 2, seq: 2, sessionId: "s1" });
check(P.feed.changes.length === 1 && P.feed.changes[0].before === null,
  "second write keeps the created-file baseline (before stays null)",
  "before=" + JSON.stringify(P.feed.changes[0]?.before));
check(P.feed.changes[0].after === "line 1\nline 2\n", "second write still updates the content");

console.log("== focus: an agent edit must not steal the tab ==");
const callsBefore = (setCalls.get("CodeStudioPanel:1") ?? []).length;
send({ path: "F:\\proj\\src\\other.js", before: "a\n", after: "b\n", ts: 3, seq: 3, sessionId: "s1" });
const autoCalls = (setCalls.get("CodeStudioPanel:1") ?? []).length - callsBefore;
check(autoCalls === 0, "automatic reveal leaves the tab alone while the user is on the files tab", "setTab calls: " + autoCalls);

console.log("== focus: an explicit deep link still switches ==");
const beforeUser = (setCalls.get("CodeStudioPanel:1") ?? []).length;
P.focusChange("F:\\proj\\src\\other.js");
const userCalls = (setCalls.get("CodeStudioPanel:1") ?? []).length - beforeUser;
check(userCalls >= 1 && (setCalls.get("CodeStudioPanel:1") ?? [])[(setCalls.get("CodeStudioPanel:1") ?? []).length - 1] === "changes",
  "user deep link switches to the changes tab", "setTab calls: " + userCalls);

console.log("== connection state: no notification when nothing changed ==");
let emitted = 0;
P.subscribeFeed(() => { emitted += 1; });
// The feed has already reported "ok" by now (the SSE frames above), so re-asserting it is
// the exact no-op that used to cost a full re-render per event.
const current = P.feed.conn;
const currentText = P.feed.connText;
P.setConn(current, currentText);
P.setConn(current, currentText);
check(emitted === 0, "re-asserting the current state notifies nobody", "emitted " + emitted);
P.setConn("err", "事件流断开，重连中…");
check(emitted === 1, "a real state change still notifies once", "emitted " + emitted);
P.setConn("err", "事件流断开，重连中…");
check(emitted === 1, "the new state is not re-notified", "emitted " + emitted);

console.warn = realWarn;
console.log(failures === 0 ? "\nfeed-behavior OK" : "\nfeed-behavior: " + failures + " failures");
process.exit(failures === 0 ? 0 : 1);
