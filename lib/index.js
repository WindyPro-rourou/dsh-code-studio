import { readFile, readdir, stat, writeFile } from "node:fs/promises";
import { watch as fsWatch, statSync, realpathSync } from "node:fs";
import { join, dirname, basename, resolve, isAbsolute } from "node:path";

/**
 * @local/dsh-code-studio - host half.
 * Serves the /api/code-studio/* REST + SSE surface: file tree/read/write,
 * a recursive workspace watcher, and per-file change history (before/after
 * content pairs) so the browser half can render Cline-style line diffs.
 */

const name = "code-studio";
const inject = ["webServer"];
const PREFIX = "/api/code-studio";
const HEARTBEAT_MS = 25000;
const DEBOUNCE_MS = 120;
const MAX_READ_BYTES = 512 * 1024; // protect the browser from huge files
const HISTORY_LIMIT = 30;

/* ---------- helpers ---------- */

function json(res, status, body) {
  const text = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(text);
}

function readBody(req, limit = 4 * 1024 * 1024) {
  return new Promise((resolvePromise, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > limit) { reject(new Error("body-too-large")); req.destroy(); return; }
      chunks.push(chunk);
    });
    req.on("end", () => {
      try { resolvePromise(JSON.parse(Buffer.concat(chunks).toString("utf8"))); }
      catch (error) { reject(new Error("invalid-json")); }
    });
    req.on("error", reject);
  });
}

/** Loopback + same-origin tripwire; this is a localhost dev surface. */
function isTrusted(req) {
  const addr = req.socket?.remoteAddress ?? "";
  if (addr !== "127.0.0.1" && addr !== "::1" && addr !== "::ffff:127.0.0.1") return false;
  const sec = req.headers["sec-fetch-site"];
  if (typeof sec === "string" && sec !== "same-origin" && sec !== "none") return false;
  return true;
}

function safePath(raw) {
  if (typeof raw !== "string" || raw === "") return void 0;
  const path = resolve(raw);
  return path;
}

/* ---------- watcher / history ---------- */

class FileLedger {
  constructor(root) {
    /** watched workspace roots (one recursive watcher each) */
    this.roots = new Set();
    this.watchers = new Map();
    /** baseline cache: absolute path -> { content, mtimeMs, size } */
    this.baseline = new Map();
    /** change history: absolute path -> [{ ts, before, after, deleted }] */
    this.history = new Map();
    /** SSE subscribers */
    this.subscribers = new Set();
    this.debounce = new Map();
    /** file path -> owning session { sessionId, ts } (learnt from tool/call events) */
    this.owners = new Map();
    if (root) this.addRoot(root);
  }

  /** Add one workspace root (recursive watcher). Idempotent. */
  addRoot(root) {
    if (typeof root !== "string" || root === "") return;
    let resolved;
    try { resolved = realpathSync(root); } catch { return; }
    if (this.roots.has(resolved)) return;
    this.roots.add(resolved);
    try {
      const watcher = fsWatch(resolved, { recursive: true }, (_eventType, filename) => {
        if (typeof filename !== "string") return;
        this.schedule(join(resolved, filename));
      });
      watcher.on?.("error", () => { /* poll covers us */ });
      this.watchers.set(resolved, watcher);
    } catch { /* poll covers us */ }
  }

  /** Attribute a file to a session (from a session tool/call event). */
  claim(path, sessionId) {
    if (typeof path !== "string" || path === "" || typeof sessionId !== "string") return;
    this.owners.set(path, { sessionId, ts: Date.now() });
    if (this.owners.size > 2000) {
      const oldest = [...this.owners.entries()].sort((a, b) => a[1].ts - b[1].ts)[0];
      if (oldest) this.owners.delete(oldest[0]);
    }
  }

  /** Owning session for a path, if known. */
  ownerOf(path) {
    return this.owners.get(path)?.sessionId ?? null;
  }

  snapshot(path) {
    return this.baseline.get(path);
  }

  recordBaseline(path, content, mtimeMs, size) {
    this.baseline.set(path, { content, mtimeMs, size });
  }

  async readCurrent(path) {
    const st = await stat(path);
    let content = null;
    let tooLarge = false;
    if (st.size <= MAX_READ_BYTES) {
      content = await readFile(path, "utf8");
    } else {
      tooLarge = true;
    }
    return { content, mtimeMs: st.mtimeMs, size: st.size, tooLarge };
  }

  /** Directory names whose contents are not interesting for the change feed. */
  static IGNORED = new Set(["node_modules", ".git", ".idea", "build", "dist", ".gradle", ".kotlin", ".cxx", "out", "target", "__pycache__", ".venv", "venv", ".gitlab", ".gitlab-ci", ".DS_Store", ".cache", ".cs-"]);
  /** Whether a path lives under one of the ignored directories (any segment). */
  static isNoise(path) {
    const parts = String(path).split(/[\\/]/);
    for (const part of parts) if (FileLedger.IGNORED.has(part)) return true;
    return false;
  }

  /** Called when a file may have changed on disk. */
  async handleChange(path) {
    if (FileLedger.isNoise(path)) return;
    let current;
    try {
      current = await this.readCurrent(path);
    } catch (error) {
      if (error.code === "ENOENT") {
        const before = this.baseline.get(path);
        this.baseline.delete(path);
        const ev = { path, ts: Date.now(), before: before?.content ?? null, after: null, deleted: true, sessionId: this.ownerOf(path) };
        this.push(ev);
        this.addHistory(path, ev);
        return;
      }
      return;
    }
    const prior = this.baseline.get(path);
    const before = prior && !prior.tooLarge ? prior.content : null;
    this.baseline.set(path, { ...current });
    if (prior && prior.mtimeMs === current.mtimeMs && prior.size === current.size && prior.content === current.content) return;
    const event = { path, ts: Date.now(), before, after: current.tooLarge ? null : current.content, deleted: false, tooLarge: current.tooLarge, sessionId: this.ownerOf(path) };
    this.push(event);
    this.addHistory(path, event);
  }

  addHistory(path, event) {
    const list = this.history.get(path) ?? [];
    list.push(event);
    if (list.length > HISTORY_LIMIT) list.shift();
    this.history.set(path, list);
  }

  push(event) {
    for (const res of this.subscribers) {
      try { res.write(`data: ${JSON.stringify(event)}\n\n`); } catch { /* ignore */ }
    }
  }

  schedule(path) {
    if (FileLedger.isNoise(path)) return;
    const timer = this.debounce.get(path);
    if (timer) clearTimeout(timer);
    this.debounce.set(path, setTimeout(() => {
      this.debounce.delete(path);
      void this.handleChange(path);
    }, DEBOUNCE_MS));
  }

  /** Cheap mtime poll of everything we know about; catches missed watch events. */
  poll() {
    for (const [path, prior] of this.baseline) {
      try {
        const st = statSync(path);
        if (st.mtimeMs === prior.mtimeMs && st.size === prior.size) continue;
        this.schedule(path);
      } catch (error) {
        if (error.code === "ENOENT") this.schedule(path);
      }
    }
  }

  start() {
    for (const root of this.roots) this.addRoot(root);
  }

  stop() {
    for (const timer of this.debounce.values()) clearTimeout(timer);
    this.debounce.clear();
    for (const watcher of this.watchers.values()) { try { watcher.close(); } catch { /* ignore */ } }
    this.watchers.clear();
    for (const res of this.subscribers) { try { res.destroy(); } catch { /* ignore */ } }
    this.subscribers.clear();
  }
}

/* ---------- routes ---------- */

function makeRoutes(ledger, root, cwd) {
  const guard = (req, res) => {
    if (isTrusted(req)) return true;
    json(res, 403, { ok: false, error: "forbidden" });
    return false;
  };
  const queryPath = (req) => {
    const path = new URL(req.url ?? "/", "http://x").searchParams.get("path");
    return safePath(path);
  };
  return [
    {
      kind: "exact",
      path: `${PREFIX}/root`,
      handler: (req, res) => {
        if (req.method !== "GET") return json(res, 405, { ok: false, error: "method-not-allowed" });
        if (!guard(req, res)) return;
        json(res, 200, { ok: true, root, cwd, platform: process.platform });
      }
    },
    {
      kind: "exact",
      path: `${PREFIX}/tree`,
      handler: async (req, res) => {
        if (req.method !== "GET") return json(res, 405, { ok: false, error: "method-not-allowed" });
        if (!guard(req, res)) return;
        const path = queryPath(req) ?? root;
        let entries;
        try {
          const names = await readdir(path, { withFileTypes: true });
          entries = await Promise.all(names.map(async (entry) => {
            const full = join(path, entry.name);
            let size = 0, mtimeMs = 0;
            try {
              const st = await stat(full);
              size = st.size;
              mtimeMs = st.mtimeMs;
            } catch { /* broken link etc. */ }
            return { name: entry.name, path: full, type: entry.isDirectory() ? "dir" : "file", size, mtimeMs };
          }));
        } catch (error) {
          return json(res, 400, { ok: false, error: error.code === "ENOENT" ? "not-found" : String(error.message ?? error) });
        }
        entries.sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === "dir" ? -1 : 1));
        json(res, 200, { ok: true, path, entries });
      }
    },
    {
      kind: "exact",
      path: `${PREFIX}/read`,
      handler: async (req, res) => {
        if (req.method !== "GET") return json(res, 405, { ok: false, error: "method-not-allowed" });
        if (!guard(req, res)) return;
        const path = queryPath(req);
        if (path === void 0) return json(res, 400, { ok: false, error: "path-required" });
        let current;
        try {
          current = await ledger.readCurrent(path);
        } catch (error) {
          return json(res, 400, { ok: false, error: error.code === "ENOENT" ? "not-found" : String(error.message ?? error) });
        }
        if (current.tooLarge) return json(res, 413, { ok: false, error: "file-too-large" });
        // First time we see this file: seed the baseline so a later agent edit
        // produces a real before/after diff.
        if (!ledger.snapshot(path)) ledger.recordBaseline(path, current.content, current.mtimeMs, current.size);
        json(res, 200, { ok: true, path, content: current.content, mtimeMs: current.mtimeMs, size: current.size });
      }
    },
    {
      kind: "exact",
      path: `${PREFIX}/write`,
      handler: async (req, res) => {
        if (req.method !== "POST") return json(res, 405, { ok: false, error: "method-not-allowed" });
        if (!guard(req, res)) return;
        let body;
        try { body = await readBody(req); }
        catch { return json(res, 400, { ok: false, error: "invalid-body" }); }
        const path = safePath(body?.path);
        if (path === void 0 || typeof body?.content !== "string") return json(res, 400, { ok: false, error: "path-and-content-required" });
        try {
          await writeFile(path, body.content, "utf8");
        } catch (error) {
          return json(res, 400, { ok: false, error: String(error.message ?? error) });
        }
        const st = await stat(path).catch(() => void 0);
        const mtimeMs = st?.mtimeMs ?? Date.now();
        const event = {
          path,
          ts: Date.now(),
          before: ledger.snapshot(path)?.content ?? null,
          after: body.content,
          deleted: false,
          source: "user",
          sessionId: ledger.ownerOf(path)
        };
        ledger.recordBaseline(path, body.content, mtimeMs, body.content.length);
        ledger.push(event);
        ledger.addHistory(path, event);
        json(res, 200, { ok: true, path, mtimeMs });
      }
    },
    {
      kind: "exact",
      path: `${PREFIX}/history`,
      handler: (req, res) => {
        if (req.method !== "GET") return json(res, 405, { ok: false, error: "method-not-allowed" });
        if (!guard(req, res)) return;
        const path = queryPath(req);
        json(res, 200, { ok: true, path, events: path === void 0 ? [] : (ledger.history.get(path) ?? []) });
      }
    },
    {
      kind: "exact",
      path: `${PREFIX}/events`,
      handler: (req, res) => {
        if (req.method !== "GET" && req.method !== "HEAD") { res.writeHead(405); res.end(); return; }
        if (!guard(req, res)) return;
        res.writeHead(200, {
          "content-type": "text/event-stream; charset=utf-8",
          "cache-control": "no-cache",
          connection: "keep-alive"
        });
        res.write(": connected\n\n");
        ledger.subscribers.add(res);
        const heartbeat = setInterval(() => { try { res.write(": ping\n\n"); } catch { /* ignore */ } }, HEARTBEAT_MS);
        const close = () => {
          clearInterval(heartbeat);
          ledger.subscribers.delete(res);
        };
        req.once("close", close);
        res.once("close", close);
      }
    }
  ];
}

/* ---------- plugin ---------- */

/** Tool names whose arguments carry a file path we can attribute to a session. */
const PATH_TOOLS = new Set(["write", "edit", "str-replace", "apply-patch", "fs-write", "write-file"]);
const PATH_ARGS = ["file_path", "path", "filePath", "target", "file"];

/** Resolve a tool argument to an absolute path, anchoring relative paths at the session cwd. */
function toolPath(args, sessionCwd) {
  for (const key of PATH_ARGS) {
    const p = args?.[key];
    if (typeof p === "string" && p !== "") {
      return isAbsolute(p) ? resolve(p) : resolve(sessionCwd ?? process.cwd(), p);
    }
  }
  return void 0;
}

function apply(ctx, config) {
  const root = realpathSync((config?.root && config.root !== "" ? config.root : process.env.DSH_WORKSPACE ?? process.cwd()));
  const cwd = process.cwd();
  const ledger = new FileLedger(root);
  const pollIntervalMs = config?.pollIntervalMs ?? 1500;
  ctx.effect(() => {
    const disposers = [];
    try {
      for (const route of makeRoutes(ledger, root, cwd)) disposers.push(ctx.webServer.register(route));
      ledger.start();
      const timer = setInterval(() => ledger.poll(), pollIntervalMs);
      timer.unref();
      disposers.push(() => clearInterval(timer));
      // Watch every session's workspace, not just our cwd: agents edit files
      // in whichever directory their session was started in.
      const addSessionRoot = (session) => {
        if (session?.header?.cwd) ledger.addRoot(session.header.cwd);
      };
      try {
        const sessions = ctx.get("sessions");
        if (sessions && typeof sessions.list === "function") {
          for (const session of sessions.list()) addSessionRoot(session);
        }
      } catch { /* ignore */ }
      // ---- reliable real-time change detection from tool events ----
      // tool/call records { name, arguments, callId } per session; tool/result
      // pairs by callId. On a file-writing tool completing, read the file NOW
      // and push the change immediately (fs.watch on atomic writes/renames is
      // unreliable and late), attributing it to the owning session.
      const pendingCalls = new Map(); // callId -> { name, args, sessionId, cwd }
      const offSession = ctx.on("session/event", (session, event) => {
        addSessionRoot(session);
        const data = event?.data;
        if (!data || typeof data !== "object") return;
        if (event.type === "tool/call") {
          if (typeof data.name === "string" && data.arguments && typeof data.arguments === "object") {
            pendingCalls.set(String(data.callId), {
              name: data.name,
              args: data.arguments,
              sessionId: session?.id,
              cwd: session?.header?.cwd
            });
            if (pendingCalls.size > 500) {
              const oldest = pendingCalls.keys().next().value;
              if (oldest !== void 0) pendingCalls.delete(oldest);
            }
          }
          return;
        }
        if (event.type === "tool/result") {
          const callId = data.message?.source?.callId ?? data.callId ?? data.call_id;
          const call = callId !== void 0 ? pendingCalls.get(String(callId)) : void 0;
          if (call === void 0) return;
          pendingCalls.delete(String(callId));
          if (!PATH_TOOLS.has(call.name)) return;
          const abs = toolPath(call.args, call.cwd);
          if (abs === void 0) return;
          ledger.claim(abs, call.sessionId);
          // proactive immediate read+push; fs.watch remains a fallback for
          // writes that bypass tools (bash, user edits)
          void ledger.handleChange(abs);
          return;
        }
      });
      disposers.push(offSession);
    } catch (error) {
      for (const dispose of disposers) dispose();
      ledger.stop();
      throw error;
    }
    return () => {
      for (const dispose of disposers.splice(0)) dispose();
      ledger.stop();
    };
  }, "code-studio: routes and watcher");
}

export { apply, inject, name };
