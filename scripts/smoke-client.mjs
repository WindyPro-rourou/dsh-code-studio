// smoke-client.mjs - loads lib/client.js under a mocked browser env
import { readFile } from "node:fs/promises";
const code = await readFile(new URL("../lib/client.js", import.meta.url), "utf8");
let loaded = null;
globalThis.window = {
  __ModuleLoader__: { load(spec) { loaded = spec; } }
};
const react = { createElement: (t, p, ...c) => ({ t, p, c }) };
(0, eval)(code); // executes window.__ModuleLoader__.load({...})
if (loaded === null) throw new Error("module loader was not invoked");
const factory = loaded.factory;
const mod = factory((name) => {
  if (name === "react") return react;
  throw new Error("unexpected require: " + name);
});
if (typeof mod.apply !== "function") throw new Error("apply missing");
if (!Array.isArray(mod.inject)) throw new Error("inject missing");
console.log("smoke OK: apply=" + typeof mod.apply + " inject=" + JSON.stringify(mod.inject));
