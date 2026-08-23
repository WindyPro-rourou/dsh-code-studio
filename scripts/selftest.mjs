// selftest.mjs - zero-dependency sanity checks for the code-studio host half.
// Run: node scripts/selftest.mjs  (needs a writable temp dir; cleans up after)
import { mkdtemp, writeFile, readFile, rm, stat, unlink } from "node:fs/promises";
import * as fs2 from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { FileLedger, makeRoutes } from "../lib/index.js";

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

console.log("== guard ==");
res = mockRes();
const evil = mockReq("POST", "/revert", { path: f2 }); evil.socket.remoteAddress = "8.8.8.8"; await rev.handler(evil, res);
ok(res.status === 403, "non-loopback rejected");

await rm(ROOT, { recursive: true, force: true });
console.log("\n" + passed + " passed, " + failed + " failed");
process.exit(failed === 0 ? 0 : 1);
