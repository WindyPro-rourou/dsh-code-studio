// smoke-client.mjs - loads lib/client.js under a mocked browser env and
// asserts the UI wiring (header digest pill) plus the host-slot registrations.
import { readFile } from "node:fs/promises";
const code = await readFile(new URL("../lib/client.js", import.meta.url), "utf8");
let loaded = null;
globalThis.window = {
  __ModuleLoader__: { load(spec) { loaded = spec; } }
};
const react = { createElement: (t, p, ...c) => ({ t, p, c }), useState: (v) => [typeof v === "function" ? v() : v, () => {}], useEffect: () => {}, useRef: (v) => ({ current: v }), useMemo: (f) => f(), useCallback: (f) => f };
(0, eval)(code); // executes window.__ModuleLoader__.load({...})
if (loaded === null) throw new Error("module loader was not invoked");
const factory = loaded.factory;

// 1) fallback path: the UI kit is missing -> the plugin still loads
const modFallback = factory((name) => {
  if (name === "react") return react;
  throw new Error("unexpected require: " + name);
});
if (typeof modFallback.apply !== "function") throw new Error("apply missing");
if (!Array.isArray(modFallback.inject)) throw new Error("inject missing");

// 2) primitives path + slot registrations
const primitives = {
  Pill: () => null, Button: () => null, Menu: () => null, Tooltip: () => null,
  IconCodeOutline16: () => null, IconChevronDownOutline14: () => null, IconCloseOutline16: () => null
};
const mod = factory((name) => {
  if (name === "react") return react;
  if (name === "@deepseek-ai/dsh-client-ui-primitives") return primitives;
  throw new Error("unexpected require: " + name);
});
const injected = [];
const registered = [];
const ctx = {
  effect(fn) { const dispose = fn(); return () => { if (typeof dispose === "function") dispose(); }; },
  get(name) {
    if (name === "slots") return {
      inject(slot, run) { injected.push(slot); run(); return () => {}; },
      register(spec, component) { registered.push({ spec, component }); return () => {}; }
    };
    if (name === "sessions") return { list: { getSnapshot: () => ({ current: "s1" }), subscribe: () => () => {} } };
    return void 0;
  }
};
mod.apply(ctx);

const need = [
  "shell.overlay",
  "conversation.session.header.utilities"
];
for (const slot of need) if (!injected.includes(slot)) throw new Error("slot not injected: " + slot + " (got " + injected.join(",") + ")");
const header = registered.find((r) => r.spec.id === "code-studio-changes");
if (!header) throw new Error("header digest pill was not registered");
if (typeof header.component !== "function") throw new Error("header digest pill component missing");
if (header.spec.name !== "conversation.session.header.utilities") throw new Error("header pill registered in the wrong slot");

// 3) Even on a 0.2-shaped slots service (which also offers entriesOfSlot/entries,
// ctx.sidebarRightTabs, ctx.sidebarRight and ctx.layout) the panel must stay the
// shell-overlay floating sidebar: it must NOT register a right-sidebar tab, a
// left-sidebar `sidebar.panellist` row, or the central `main` panel.
const injected2 = [];
const registered2 = [];
const tabTypes = [];
let openTabCalls = 0;
let closeRightbarCalls = 0;
const mod2 = factory((name) => {
  if (name === "react") return react;
  if (name === "@deepseek-ai/dsh-client-ui-primitives") return primitives;
  throw new Error("unexpected require: " + name);
});
const ctx2 = {
  effect(fn) { const dispose = fn(); return () => { if (typeof dispose === "function") dispose(); }; },
  get(name) {
    if (name === "slots") return {
      inject(slot, run) { injected2.push(slot); run(); return () => {}; },
      register(spec, component) { registered2.push({ spec, component }); return () => {}; },
      entriesOfSlot() { return []; },
      entries() { return []; }
    };
    if (name === "sidebarRightTabs") return { register(definition) { tabTypes.push(definition); return () => {}; } };
    if (name === "sidebarRight") return { openTab() { openTabCalls += 1; } };
    if (name === "layout") return { selectPanel() {}, closeRightbar() { closeRightbarCalls += 1; } };
    if (name === "sessions") return { list: { getSnapshot: () => ({ current: "s1" }), subscribe: () => () => {} } };
    return void 0;
  }
};
mod2.apply(ctx2);
for (const slot of ["shell.overlay", "conversation.session.header.utilities"]) {
  if (!injected2.includes(slot)) throw new Error("slot not injected: " + slot + " (got " + injected2.join(",") + ")");
}
if (injected2.includes("sidebar.right.pane.tab") || injected2.includes("sidebar.right.pane.tab.title")) {
  throw new Error("the panel must NOT be a right-sidebar tab (it belongs to shell.overlay)");
}
if (injected2.includes("main") || injected2.includes("sidebar.panellist")) {
  throw new Error("the panel must not take the central main panel or a left-sidebar row");
}
if (tabTypes.length !== 0) throw new Error("no right-sidebar tab type may be registered");
const overlayPanel = registered2.find((r) => r.spec.name === "shell.overlay");
if (overlayPanel === void 0) throw new Error("overlay panel entry missing");
if (typeof overlayPanel.component !== "function") throw new Error("overlay panel component missing");

// 4) source-level guarantees: the floating bottom badge (composer collision) is gone
for (const [label, needle] of [
  ["header pill styles", ".cs-hpill{"],
  ["digest publisher", "publishSummary("],
  ["deep link bus", "function focusChange"],
  ["primitives guard", "DSH UI primitives unavailable"],
  ["single shared change feed", "function startChangeFeed"]
]) if (!code.includes(needle)) throw new Error("missing " + label + ": " + needle);
for (const forbidden of ["sidebar.right.pane.tab", "sidebar.panellist", "sidebarRightTabs"]) {
  if (code.includes(forbidden)) throw new Error("the panel must stay a shell-overlay sidebar; found " + forbidden);
}
if (/\.cs-badge-f\{position:fixed/.test(code)) throw new Error("floating fixed bottom badge is still present (it fought the composer toolbar)");
if (!code.includes(".cs-badge-n{")) throw new Error("sidebar unread badge styles were lost");
// the v0.3 redesign keeps one stylesheet block (template literal) and its tokens
if (!code.includes("const CSS = `")) throw new Error("stylesheet block is missing");
for (const needle of ["--cs-accent", "--cs-row", "prefers-reduced-motion", "container-type:inline-size", ".cs-empty-ico{", ".cs-kbd{"]) {
  if (!code.includes(needle)) throw new Error("stylesheet lost a design-system hook: " + needle);
}
// no em-dash or pictographic emoji in shipped UI strings (taste skill pre-flight);
// typographic dingbats used as icons (check, close, arrows) are intentional
const uiStrings = code.match(/"[^"\n]*(?:[\u2014]|[\u{1F000}-\u{1FAFF}])[^"\n]*"/gu) ?? [];
if (uiStrings.length > 0) throw new Error("visible copy still carries em-dash/emoji: " + uiStrings.slice(0, 3).join(" | "));

// v0.2.15 minimalist pass, structural guarantees (one chrome bar, flat surfaces):
// - the head bar carries title + tabs + close, so the separate tabs bar is gone
if (!/el\("div", \{ className: "cs-head" \},[\s\S]{0,400}el\("div", \{ className: "cs-tabs"/.test(code)) throw new Error("the segmented tabs must live inside the single chrome bar");
if (!code.includes('el("span", { className: "cs-title" }, "Code Studio")')) throw new Error("the head title lost its plain single-line form");
if (code.includes('className: "cs-summary"') || code.includes(".cs-summary{")) throw new Error("the summary bar was removed on purpose (deltas live in the filter row meta)");
if (code.includes('className: "cs-dot"')) throw new Error("the accent dot in the head was removed on purpose");
if (code.includes('className: "cs-count"') || code.includes(".cs-count{")) throw new Error("the head count chip was removed on purpose");
if (code.includes("cs-sesstag") || code.includes("cs-headhint")) throw new Error("the status bar was slimmed on purpose (dot + conn + shortcuts + ?)");
if (/\.cs-root\{[^}]*box-shadow/.test(code)) throw new Error("the panel is flat: no box-shadow on .cs-root");
if (!/\.cs-btn\{[^}]*border:none/.test(code)) throw new Error("buttons must be ghost-flat (border:none) with one solid primary");
if (!code.includes("--cs-r1:4px") || !code.includes("--cs-r2:8px")) throw new Error("radius lock 4/8 is part of the design system");
if (!code.includes("cubic-bezier(0.16,1,0.3,1)")) throw new Error("motion curve was lost");


// 5) v0.2.16 performance + interaction guarantees. These are the fixes for renders that
// used to re-diff the whole change set: losing any of them silently brings the jank back.
for (const [label, needle] of [
  ["diff head/tail trim", "const aMid = a.slice(s, n0 - e);"],
  ["per-change stats cache", "const STATS_CACHE = new Map();"],
  ["stats keyed by the event seq", "hit.seq === c.seq"],
  ["sort-by-delta decorated once", "const weight = new Map();"],
  ["one stats lookup per shown file", "const shownStats = React.useMemo("],
  ["resize coalesced to one frame", "const nextFrame = (fn) =>"],
  ["large-file plain mode", "const HL_MAX_LINES = 3000;"],
  ["list scroll containment", "overscroll-behavior:contain"],
  ["open-row rail", ".cs-chg-row.cs-open{background:var(--cs-mask);box-shadow:inset 2px 0 0 0 var(--cs-accent)}"],
  ["row stats width lock", "min-width:62px;font-variant-numeric:tabular-nums"]
]) if (!code.includes(needle)) throw new Error("lost a v0.2.16 performance/UI hook: " + label + " (expected " + needle + ")");
// and the removed hot paths must not come back
if (/\.cs-dline:hover\{background:var\(--cs-hover\)\}/.test(code)) throw new Error("diff-line hover erases the semantic tint again");
if (/const d = \(c\) => \(c\.deleted \? 0 : fileStats\(c\.before, c\.after\)\.adds \+ fileStats\(c\.before, c\.after\)\.dels\)/.test(code)) throw new Error("the sort comparator diffs twice per comparison again");
if (/shownChanges\.reduce\(\(acc, c\) => \{ const s = c\.deleted/.test(code)) throw new Error("rows diff themselves again instead of using the cached stats");

// 6) hook order: Highlighted must run its hook before any early return, otherwise flipping
// the large-file `plain` flag changes the hook count mid-mount and React throws.
{
  let hl = null;
  globalThis.window = { __ModuleLoader__: { load(spec) { hl = spec; } } };
  let hookCalls = 0;
  const react2 = { createElement: react.createElement, useState: react.useState, useEffect: () => {}, useRef: react.useRef,
    useMemo: (f) => { hookCalls += 1; return f(); }, useCallback: (f) => f, useLayoutEffect: () => {} };
  (0, eval)(code.replace("exports.apply = apply;", "exports.__hl = { Highlighted };\n\t\texports.apply = apply;"));
  const { Highlighted } = hl.factory((name) => (name === "react" ? react2 : void 0)).__hl;
  hookCalls = 0; Highlighted({ text: "const a = 1;", path: "a.js", plain: false });
  const withTokens = hookCalls;
  hookCalls = 0; const out = Highlighted({ text: "const a = 1;", path: "a.js", plain: true });
  if (withTokens !== hookCalls) throw new Error("Highlighted's hook count depends on `plain` (" + withTokens + " vs " + hookCalls + "): React would throw on a large file that shrinks below the cap");
  if (withTokens !== 1) throw new Error("Highlighted should run exactly one hook, saw " + withTokens);
  if (out.c.length !== 1 || out.c[0] !== "const a = 1;") throw new Error("plain mode must emit the raw text without token spans");
}

console.log("smoke OK: apply=" + typeof mod.apply + " inject=" + JSON.stringify(mod.inject) + " slots=" + injected.join(",") + " overlayOnly=" + injected2.join(",") + " headerPill=" + header.spec.id);
