// perf-host.mjs - measures what the host half costs per session event.
//
// `apply()` subscribes to session/event, which fires for every streamed token/message, and it
// used to resolve + stat every session's project folder on each one (synchronous filesystem
// calls in the middle of token streaming). This boots the plugin against a fake ctx and
// pushes events through it, so the number is the real per-event overhead.
//
//   node scripts/perf-host.mjs [events]
//   REF_REV=HEAD node scripts/perf-host.mjs      # compare against another revision
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const EVENTS = Number(process.argv[2] ?? 2000);
const REF = process.env.REF_REV ?? null;

/** Load the host half, optionally from another revision. */
async function loadBundle() {
  if (REF === null) return import(pathToFileURL(path.join(ROOT, "lib", "index.js")).href);
  const dir = await mkdtemp(path.join(tmpdir(), "cs-refhost-"));
  const src = execFileSync(process.env.GIT_BIN || "git", ["show", `${REF}:lib/index.js`], { cwd: ROOT, maxBuffer: 1 << 28 }).toString("utf8");
  const file = path.join(dir, "index.mjs");
  await writeFile(file, src, "utf8");
  return import(pathToFileURL(file).href);
}

const project = await mkdtemp(path.join(tmpdir(), "cs-perfhost-proj-"));
await mkdir(path.join(project, "src"), { recursive: true });

const bundle = await loadBundle();
const routes = [];
let handler = null;
const ctx = {
  effect(fn) { const d = fn(); return () => { if (typeof d === "function") d(); }; },
  on(type, fn) { if (type === "session/event") handler = fn; return () => {}; },
  get(name) { if (name === "sessions") return { list: () => [{ id: "s1", header: { cwd: project } }] }; return void 0; },
  webServer: { register(route) { routes.push(route); return () => {}; } }
};

const t0 = performance.now();
bundle.apply(ctx, { pollIntervalMs: 10 ** 7 });
const bootMs = performance.now() - t0;
if (handler === null) throw new Error("apply() did not subscribe to session/event");

// Warm up (first event resolves the root for real), then measure the steady state.
handler({ id: "s1", header: { cwd: project } }, { type: "session/event", data: { delta: "warm" } });

const t1 = performance.now();
for (let i = 0; i < EVENTS; i++) {
  handler({ id: "s1", header: { cwd: project } }, { type: "session/event", data: { delta: "chunk " + i } });
}
const total = performance.now() - t1;

console.log(`${REF === null ? "working copy" : REF}: ${EVENTS} session events in ${total.toFixed(1)} ms ` +
  `(${(total / EVENTS * 1000).toFixed(2)} us/event), boot ${bootMs.toFixed(1)} ms`);

await rm(project, { recursive: true, force: true });
process.exit(0);
