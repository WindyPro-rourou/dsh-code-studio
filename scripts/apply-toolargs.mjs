// apply-toolargs.mjs - regression: DSH >= 0.1.1-rc.2 sends tool arguments as a JSON
// string on tool/call; the host must parse it and still claim+push the change.
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
const mod = await import("file:///F:/CycleMaster/dsh-code-studio/lib/index.js");
const ROOT = await mkdtemp(join(tmpdir(), "cs-app-"));
let sessionListener = null;
const routes = [];
const sessions = { list: () => [{ id: "s0", header: { cwd: ROOT } }] };
let dispose = null;
process.on("unhandledRejection", (e) => { console.log("UNHANDLED:", e.message); });
const ctx = {
  webServer: { register: (r) => { routes.push(r); return () => {}; } },
  get: (k) => (k === "sessions" ? sessions : undefined),
  on: (ev, fn) => { if (ev === "session/event") { sessionListener = fn; return () => {}; } return () => {}; },
  effect: (fn) => { dispose = fn(); return dispose; }
};
mod.apply(ctx, {});
console.log("sessionListener set:", typeof sessionListener === "function", "| routes:", routes.map((r) => r.path).join(","));
const eventsRoute = routes.find((r) => r.path === "/api/code-studio/events");
if (!eventsRoute) { console.log("FAIL: events route not registered"); process.exit(1); }
const frames = [];
const res = { write: (c) => frames.push(c), writeHead: () => {}, destroy: () => {}, once: () => {}, end: () => {} };
const req = { method: "GET", headers: {}, socket: { remoteAddress: "127.0.0.1" }, url: "/api/code-studio/events", once: () => {} };
eventsRoute.handler(req, res);
const f = join(ROOT, "t.txt");
await writeFile(f, "v1\n", "utf8");
// string-arguments tool/call (the rc.2 wire shape)
console.log("before tool/call, sessionListener:", typeof sessionListener === "function");
sessionListener({ id: "s0", header: { cwd: ROOT } }, { type: "tool/call", data: { callId: "c1", name: "write", arguments: JSON.stringify({ file_path: "t.txt" }), turn: 1, step: 1 } });
await writeFile(f, "v2\n", "utf8");
sessionListener({ id: "s0", header: { cwd: ROOT } }, { type: "tool/result", data: { message: { source: { callId: "c1" } } } });
await new Promise((r) => setTimeout(r, 400));
const historyRoute = routes.find((r) => r.path === "/api/code-studio/history");
const hres = { writeHead: () => {}, end: (b) => { try { const j = JSON.parse(b); console.log("history events:", (j.events||[]).length, JSON.stringify(j.events||[]).slice(0,200)); } catch {} }, write: () => {} };
historyRoute.handler({ method: "GET", headers: {}, socket: { remoteAddress: "127.0.0.1" }, url: "/api/code-studio/history?path=" + encodeURIComponent(f) }, hres);
const blob = frames.join("");
console.log("SSE frames:", JSON.stringify(blob.slice(0, 300)));
const ok = blob.includes("t.txt") && blob.includes('"before"');
console.log(ok ? "PASS: change pushed for string-arguments tool/call" : "FAIL: no change event pushed");
dispose();
process.exit(ok ? 0 : 1);
