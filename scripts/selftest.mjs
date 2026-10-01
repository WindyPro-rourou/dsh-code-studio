// selftest.mjs - zero-dependency sanity checks for the code-studio host half.
// Run: node scripts/selftest.mjs  (needs a writable temp dir; cleans up after)
import { mkdtemp, writeFile, readFile, rm, stat, unlink } from "node:fs/promises";
import * as fs2 from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname, parse as parsePath } from "node:path";
import { fileURLToPath } from "node:url";
import { FileLedger, makeRoutes, apply, mapPortablePath, indexedWorkspaces, dshDrive } from "../lib/index.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = await mkdtemp(join(tmpdir(), "cs-selftest-"));
const PREFIX = "/api/code-studio";
let passed = 0, failed = 0;
const ok = (cond, name) => { if (cond) { passed++; console.log("  ✓ " + name); } else { failed++; console.log("  ✗ FAIL: " + name); } };

function mockReq(method, url, body) {
  const req = { method, url, headers: {}, socket: { remoteAddress: "127.0.0.1" },
    on(ev, fn) {
      if (ev === "data" && body !== undefined) queueMicrotask(() => fn(Buffer.from(JSON.stringify(body))));
      if (ev === "end") queueMicrotask(() => fn());
      return req;
    } };
  return req;
}
function mockRes() {
  return { status: 0, body: "", writeHead(s) { this.status = s; }, end(b) { if (typeof b === "string") this.body = b; }, write(b) { this.body += b; }, destroy() {} };
}
const route = (routes, p) => routes.find((r) => r.path === PREFIX + p);

console.log("== FileLedger basics ==");
const ledger = new FileLedger(ROOT);
ok(ledger.roots.has(ROOT), "root added");

// SSE seq + ring
const received = [];
ledger.subscribers.add({ write: (chunk) => received.push(chunk) });
ledger.push({ path: "a", ts: 1 });
ledger.push({ path: "b", ts: 2 });
ok(received[0].startsWith("id: 1\ndata:"), "first event carries id:1");
ok(received[1].includes("id: 2"), "second event carries id:2");
ok(ledger.ring.length === 2 && ledger.ring[0].seq === 1 && ledger.ring[1].seq === 2, "ring keeps ordered seq");
ledger.subscribers.clear();

// claim + handleChange produces before/after event
const f1 = join(ROOT, "alpha.txt");
await writeFile(f1, "line1\nline2\n", "utf8");
ledger.claim(f1, "s1");
await ledger.handleChange(f1);
let hist = ledger.history.get(f1) ?? [];
ok(hist.length === 1 && hist[0].before === null && hist[0].after === "line1\nline2\n" && hist[0].sessionId === "s1", "first change: before=null after=content, session s1");
await writeFile(f1, "line1\nCHANGED\n", "utf8");
await ledger.handleChange(f1);
hist = ledger.history.get(f1) ?? [];
ok(hist.length === 2 && hist[1].before === "line1\nline2\n" && hist[1].after === "line1\nCHANGED\n", "second change carries before/after");

// history trim
const big = "x".repeat(150 * 1024);
await writeFile(f1, big, "utf8");
await ledger.handleChange(f1);
hist = ledger.history.get(f1) ?? [];
const last = hist[hist.length - 1];
ok(typeof last.after === "string" && last.after.length <= 100 * 1024 + 40 && last.after.includes("[history 截断]"), "history content trimmed");
ok(ledger.ring[ledger.ring.length - 1].after.length === big.length, "SSE ring keeps FULL content");

console.log("== revert ==");
const f2 = join(ROOT, "beta.js");
await writeFile(f2, "v1\n", "utf8");
await ledger.captureRevertPoint(f2, "s1");
await writeFile(f2, "v2\n", "utf8");
ledger.claim(f2, "s1");
await ledger.handleChange(f2);
// capture again same session -> must NOT overwrite
await ledger.captureRevertPoint(f2, "s1");
ok(ledger.revertPoints.get(f2).content === "v1\n", "revert point keeps pre-write content");
// new session -> overwrite with current
await ledger.captureRevertPoint(f2, "s2");
ok(ledger.revertPoints.get(f2).content === "v2\n", "new session re-baselines revert point");
await ledger.captureRevertPoint(f2, "s1");
ok(ledger.revertPoints.get(f2).content === "v2\n", "old session does not clobber");

const routes = makeRoutes(ledger, ROOT, ROOT);
const rev = route(routes, "/revert");
ok(rev !== void 0, "/revert route exists");
let res = mockRes();
await rev.handler(mockReq("POST", "/revert", { path: f2 }), res);
const r1 = JSON.parse(res.body);
ok(res.status === 200 && r1.ok && r1.reverted, "revert succeeds");
ok((await readFile(f2, "utf8")) === "v2\n", "file restored to revert point (v2)");

// conflict detection: external edit not seen by ledger
await writeFile(f2, "EXTERNAL\n", "utf8"); // bypass handleChange on purpose
res = mockRes();
await rev.handler(mockReq("POST", "/revert", { path: f2 }), res);
const r2 = JSON.parse(res.body);
ok(res.status === 200 && r2.conflict === true, "conflict flagged when file changed outside agent writes");

// revert of a file that did not exist pre-agent
const f3 = join(ROOT, "newfile.ts");
await ledger.captureRevertPoint(f3, "s1"); // ENOENT -> existed=false
await writeFile(f3, "created by agent\n", "utf8");
ledger.claim(f3, "s1");
await ledger.handleChange(f3);
res = mockRes();
await rev.handler(mockReq("POST", "/revert", { path: f3 }), res);
const r3 = JSON.parse(res.body);
ok(res.status === 200 && r3.ok, "revert of created file ok");
ok((await stat(f3).catch(() => null)) === null, "created file removed on revert");
ok((await ledger.history.get(f3) ?? []).some((e) => e.source === "revert"), "revert recorded in history");

// no-revert-point 404
res = mockRes();
await rev.handler(mockReq("POST", "/revert", { path: join(ROOT, "never.txt") }), res);
ok(res.status === 404, "no-revert-point -> 404");

// Bug A regression: captureRevertPoint seeds the baseline so the first diff
// after the agent's write shows the real before-content, not "all new"
const f4 = join(ROOT, "seed.txt");
await writeFile(f4, "original\n", "utf8");
await ledger.captureRevertPoint(f4, "s9");
ok(ledger.snapshot(f4)?.content === "original\n", "revert point seeds baseline");
await writeFile(f4, "changed\n", "utf8");
ledger.claim(f4, "s9");
await ledger.handleChange(f4);
const h4 = ledger.history.get(f4) ?? [];
ok(h4.length === 1 && h4[0].before === "original\n" && h4[0].after === "changed\n", "first diff carries real before (not all-new)");
// same-session second capture must NOT re-seed (keeps the original)
await ledger.captureRevertPoint(f4, "s9");
ok(ledger.snapshot(f4)?.content === "changed\n", "second capture same session keeps current baseline");
// oversize file: no baseline seed, no revert content
const bigF = join(ROOT, "big.bin");
const bigBuf = Buffer.alloc(600 * 1024, 65);
await fs2.writeFile(bigF, bigBuf);
await ledger.captureRevertPoint(bigF, "s9");
ok(ledger.revertPoints.get(bigF)?.existed === true && ledger.revertPoints.get(bigF)?.content === null, "oversize file: revert point exists but no content");
ok(ledger.snapshot(bigF) === void 0, "oversize file: no baseline seed");

console.log("== workspaces ==");
ledger.noteSessionRoot(ROOT, "s1");
ledger.noteSessionRoot(ROOT, "s2");
const ws = route(routes, "/workspaces");
res = mockRes();
await ws.handler(mockReq("GET", "/workspaces"), res);
const w = JSON.parse(res.body);
ok(w.ok && w.workspaces.length === 1 && w.workspaces[0].path === ROOT && w.workspaces[0].sessionCount === 2, "workspaces lists root with session count");

// Portable drive (随盘): DSH stores workspace paths absolutely, so a drive-letter
// change must be repaired with exactly the launcher's own rule — keep the path when
// it exists, otherwise re-anchor the same path on DSH's drive, and only when that
// folder is really there. Without this a workspace shows an empty file tree.
console.log("== portable drive rewrite (随盘) ==");
const PORT_HOME = await mkdtemp(join(tmpdir(), "cs-home-"));
process.env.DSH_HOME = PORT_HOME;
const homeDrive = parsePath(PORT_HOME).root.slice(0, 2).toUpperCase();
ok(dshDrive() === homeDrive, "dshDrive() reads the drive of DSH_HOME");
const realProj = await mkdtemp(join(PORT_HOME, "proj-"));
const ghostDrive = homeDrive === "Z:" ? "Y:" : "Z:";
const ghostPath = ghostDrive + realProj.slice(homeDrive.length);
ok(mapPortablePath(realProj) === realProj, "an existing workspace path is kept as-is");
ok(mapPortablePath(ghostPath) === realProj, "a path on a vanished drive re-anchors onto DSH's drive when the folder exists there");
ok(mapPortablePath(ghostDrive + "\\definitely\\not\\here") === ghostDrive + "\\definitely\\not\\here", "a path that exists nowhere is reported unchanged, never invented");
// workspace index (storages/workspace.json) is the portable registry: both a
// drive-corrected row and a dead row must come through honestly
await fs2.mkdir(join(PORT_HOME, "storages"), { recursive: true });
await writeFile(join(PORT_HOME, "storages", "workspace.json"), JSON.stringify({
  tables: { workspaces: {
    w1: { path: ghostPath, title: "moved project" },
    w2: { path: ghostDrive + "\\gone", title: "dead project" }
  } }
}), "utf8");
const indexed = indexedWorkspaces();
const row1 = indexed.find((x) => x.id === "w1");
const row2 = indexed.find((x) => x.id === "w2");
ok(row1 !== void 0 && row1.path === realProj && row1.recorded === ghostPath && row1.exists === true, "indexed workspace is re-anchored and marked existing");
ok(row2 !== void 0 && row2.exists === false && row2.path === ghostDrive + "\\gone", "a missing indexed workspace keeps its recorded path and is marked missing");
// /root must report the rewrite so the UI can explain it
const portRoutes = makeRoutes(ledger, (id) => mapPortablePath(ghostPath), ROOT, () => indexed, (id) => ({ path: mapPortablePath(ghostPath), recorded: ghostPath, sessionId: id }));
res = mockRes();
await route(portRoutes, "/root").handler(mockReq("GET", "/root?session=sP"), res);
const pr = JSON.parse(res.body);
ok(pr.ok && pr.root === realProj && pr.recorded === ghostPath && pr.remapped === true && pr.exists === true, "/root reports the drive rewrite (root/recorded/remapped/exists)");

console.log("== guard ==");
res = mockRes();
const evil = mockReq("POST", "/revert", { path: f2 }); evil.socket.remoteAddress = "8.8.8.8"; await rev.handler(evil, res);
ok(res.status === 403, "non-loopback rejected");

// DSH 0.2: the workspace root follows the SESSION, not the host's cwd. The desktop
// app used to report its own profile folder as the workspace because it resolved
// process.cwd() once at startup.
console.log("== session-scoped root (0.2) ==");
const ROOT_B = await mkdtemp(join(tmpdir(), "cs-ws-b-"));
const calls = [];
const resolver = (sessionId) => { calls.push(sessionId); const r = sessionId === "sB" ? ROOT_B : ROOT; ledger.addRoot(r); return r; };
const routes2 = makeRoutes(ledger, resolver, ROOT, () => [
  { path: ROOT, label: "a", sessionCount: 1 },
  { path: ROOT_B, label: "b", sessionCount: 1 }
]);
const rootRoute = route(routes2, "/root");
res = mockRes();
await rootRoute.handler(mockReq("GET", "/root?session=sB"), res);
const rb = JSON.parse(res.body);
ok(rb.ok && rb.root === ROOT_B && calls.includes("sB"), "/root?session=<id> resolves that session's project dir");
ok(ledger.roots.has(ROOT_B), "resolved session root gets watched");
res = mockRes();
await rootRoute.handler(mockReq("GET", "/root"), res);
ok(JSON.parse(res.body).root === ROOT, "/root without a session falls back to the configured root");
res = mockRes();
await route(routes2, "/workspaces").handler(mockReq("GET", "/workspaces"), res);
const w2 = JSON.parse(res.body);
ok(w2.workspaces.some((x) => x.path === ROOT_B), "/workspaces lists live session project dirs");
await rm(ROOT_B, { recursive: true, force: true });

// End-to-end: the real apply() must resolve the workspace from the ACTIVE SESSION.
// Regression for the desktop bug where the file browser opened the app's own
// profile folder (the host's process.cwd()) instead of the project directory.
console.log("== apply(): session-scoped workspace (desktop bug) ==");
const PROJ_A = await mkdtemp(join(tmpdir(), "cs-proj-a-"));
const PROJ_B = await mkdtemp(join(tmpdir(), "cs-proj-b-"));
await writeFile(join(PROJ_B, "main.js"), "// project file\n", "utf8");
const registeredRoutes = [];
const toolEvents = [];
const applyCtx = {
  effect(fn) { const d = fn(); return () => { if (typeof d === "function") d(); }; },
  on(ev, fn) { toolEvents.push(ev); return () => {}; },
  get(name) {
    if (name === "sessions") return { list: () => ([
      { id: "sA", header: { cwd: PROJ_A } },
      { id: "sB", header: { cwd: PROJ_B } }
    ]) };
    return void 0;
  },
  webServer: { register(route) { registeredRoutes.push(route); return () => {}; } }
};
apply(applyCtx, { pollIntervalMs: 10 ** 7 });
const appliedRoot = registeredRoutes.find((r) => r.path === PREFIX + "/root");
ok(appliedRoot !== void 0, "apply() registers /root");
res = mockRes();
await appliedRoot.handler(mockReq("GET", "/root?session=sB"), res);
const appliedBody = JSON.parse(res.body);
ok(appliedBody.root === PROJ_B, "apply(): /root?session=sB returns that session's project dir");
res = mockRes();
await appliedRoot.handler(mockReq("GET", "/root?session=sA"), res);
ok(JSON.parse(res.body).root === PROJ_A, "apply(): /root?session=sA returns the other session's project dir");
res = mockRes();
await registeredRoutes.find((r) => r.path === PREFIX + "/tree").handler(mockReq("GET", "/tree"), res);
const treeBody = JSON.parse(res.body);
ok(treeBody.ok && treeBody.path === PROJ_B, "apply(): /tree defaults to the newest live session's dir, not the host cwd");
ok(treeBody.entries.length >= 1, "apply(): tree lists that directory's entries");
ok(toolEvents.includes("session/event"), "apply(): subscribes to session/event");
await rm(PROJ_A, { recursive: true, force: true });
await rm(PROJ_B, { recursive: true, force: true });

// The same apply(), but the active session's recorded folder is gone for good
// (another machine / deleted): the browser must fall back to a workspace that really
// exists instead of showing an empty tree, and must say so.
console.log("== apply(): missing session folder falls back (随盘) ==");
const LIVE = await mkdtemp(join(tmpdir(), "cs-live-"));
await writeFile(join(LIVE, "keep.js"), "// still here\n", "utf8");
const goneProj = join(tmpdir(), "cs-gone-" + Date.now() + "-" + Math.random().toString(16).slice(2));
const routes3 = [];
const ctx3 = {
  effect(fn) { const d = fn(); return () => { if (typeof d === "function") d(); }; },
  on() { return () => {}; },
  get(name) {
    if (name === "sessions") return { list: () => ([{ id: "sDead", header: { cwd: goneProj } }]) };
    return void 0;
  },
  webServer: { register(route) { routes3.push(route); return () => {}; } }
};
process.env.DSH_HOME = PORT_HOME; // an indexed workspace that exists is the fallback
await writeFile(join(PORT_HOME, "storages", "workspace.json"), JSON.stringify({
  tables: { workspaces: {
    newestButGone: { path: ghostDrive + "\\also\\gone", title: "newest but missing", updatedAt: "2030-01-01T00:00:00.000Z" },
    live: { path: LIVE, title: "live project", updatedAt: "2026-01-01T00:00:00.000Z" }
  } }
}), "utf8");
apply(ctx3, { pollIntervalMs: 10 ** 7 });
res = mockRes();
await routes3.find((r) => r.path === PREFIX + "/root").handler(mockReq("GET", "/root?session=sDead"), res);
const dead = JSON.parse(res.body);
ok(dead.root === LIVE, "apply(): a session whose folder is gone falls back to the newest EXISTING workspace");
ok(dead.recorded === goneProj && dead.sessionMissing === true && dead.exists === true, "apply(): /root reports the missing session folder and the fallback");
res = mockRes();
await routes3.find((r) => r.path === PREFIX + "/tree").handler(mockReq("GET", "/tree"), res);
ok(JSON.parse(res.body).entries.some((e) => e.name === "keep.js"), "apply(): the fallback tree really lists files");
await rm(LIVE, { recursive: true, force: true });

await rm(ROOT, { recursive: true, force: true });
console.log("\n" + passed + " passed, " + failed + " failed");
process.exit(failed === 0 ? 0 : 1);
