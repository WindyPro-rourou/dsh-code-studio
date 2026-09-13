// smoke-client.mjs - loads lib/client.js under a mocked browser env and
// asserts the UI wiring (header digest pill) plus the host-slot registrations.
import { readFile } from "node:fs/promises";
const code = await readFile(new URL("../lib/client.js", import.meta.url), "utf8");
let loaded = null;
globalThis.window = {
  __ModuleLoader__: { load(spec) { loaded = spec; } }
};
const react = { createElement: (t, p, ...c) => ({ t, p, c }), useState: (v) => [typeof v === "function" ? v() : v, () => {}], useEffect: () => {}, useRef: (v) => ({ current: v }), useMemo: (f) => f() };
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

// 3) source-level guarantees: the floating bottom badge (composer collision) is gone
for (const [label, needle] of [
  ["header pill styles", ".cs-hpill{"],
  ["digest publisher", "publishSummary("],
  ["deep link bus", "function focusChange"],
  ["primitives guard", "DSH UI primitives unavailable"]
]) if (!code.includes(needle)) throw new Error("missing " + label + ": " + needle);
if (/\.cs-badge-f\{position:fixed/.test(code)) throw new Error("floating fixed bottom badge is still present (it fought the composer toolbar)");
if (!code.includes('".cs-badge-n{')) throw new Error("sidebar unread badge styles were lost");

console.log("smoke OK: apply=" + typeof mod.apply + " inject=" + JSON.stringify(mod.inject) + " slots=" + injected.join(",") + " headerPill=" + header.spec.id);
