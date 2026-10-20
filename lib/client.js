window.__ModuleLoader__.load({
	id: "@windypro-rourou/dsh-code-studio",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let React = require("react");

		const el = (type, props, ...children) => React.createElement(type, props ?? null, ...children);
		// ---------------------------------------------------------------------------
		// Icon set. The panel ships without a build step and without icon packages, so
		// these few glyphs are drawn by hand on ONE grid: 16x16 viewBox, 1.5px stroke,
		// round caps/joins, currentColor. (The taste skill bans hand-rolled icons when
		// an icon library is installable; here there is no bundler, so this is the
		// honest downgrade - consistency is kept by the single stroke/geometry rule.)
		// ---------------------------------------------------------------------------
		const svgIcon = (body) => "<svg viewBox=\"0 0 16 16\" width=\"16\" height=\"16\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.5\" stroke-linecap=\"round\" stroke-linejoin=\"round\" aria-hidden=\"true\">" + body + "</svg>";
		const ICON_SPARK = svgIcon("<path d=\"M8 2.2 9.6 6l3.8 1.6L9.6 9.2 8 13 6.4 9.2 2.6 7.6 6.4 6z\"/>");
		const ICON_FILTER = svgIcon("<path d=\"M2.5 3.5h11L9.4 8.2v4.3L6.6 11V8.2z\"/>");
		const ICON_TRASH = svgIcon("<path d=\"M3.5 5h9M6.5 5V3.6h3V5M4.8 5l.5 8h5.4l.5-8\"/>");
		const ICON_FOLDER = svgIcon("<path d=\"M2.5 4.6c0-.6.4-1 1-1h2.3l1.2 1.3h5.5c.6 0 1 .4 1 1v5.5c0 .6-.4 1-1 1h-9c-.6 0-1-.4-1-1z\"/>");
		const ICON_FILE = svgIcon("<path d=\"M4 2.5h4.8L12 5.7v7.8H4zM8.6 2.6v3.2h3.2\"/>");
		const ICON_WARN = svgIcon("<path d=\"M8 2.8 14 13H2zM8 6.6v3.2M8 11.6h.01\"/>");
		const inject = ["slots"];

		// ============================ DSH design system ============================
		// The shell exposes its own UI kit (same components the native chrome uses) to
		// every client plugin. We use it when present so the panel and the session
		// header pill are visually indistinguishable from the host, and degrade to our
		// own token-based markup when a build does not ship it.
		let P = null;
		try {
			P = require("@deepseek-ai/dsh-client-ui-primitives");
		} catch (error) {
			console.warn("[code-studio] DSH UI primitives unavailable, using local markup", error);
		}
		const dsPill = P && P.Pill ? P.Pill : null;
		const dsTooltip = P && P.Tooltip ? P.Tooltip : null;
		const dsMenu = P && P.Menu ? P.Menu : null;
		const dsButton = P && P.Button ? P.Button : null;
		const dsIcon = (name) => (P && P[name] ? P[name] : null);
		const ICON_CODE = dsIcon("IconCodeOutline16");
		const ICON_CHEVRON = dsIcon("IconChevronDownOutline14");
		const ICON_CLOSE = dsIcon("IconCloseOutline16");

		// ============================ API ============================
		const API = "/api/code-studio";
		async function api(path, init) {
			const res = await fetch(API + path, init);
			const body = await res.json().catch(() => ({}));
			if (!res.ok) throw new Error(body.error ?? ("request failed: " + res.status));
			return body;
		}
		const enc = encodeURIComponent;
		const listDir = (path) => api("/tree?path=" + enc(path));
		const readFile = (path) => api("/read?path=" + enc(path));
		const historyApi = (path) => api("/history?path=" + enc(path));
		const writeFile = (path, content) => api("/write", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ path, content })
		});
		/**
		 * Default workspace root for the file browser. DSH 0.2 binds a project
		 * directory to the SESSION (workspaces group sessions), so the host resolves
		 * the root from the active session; 0.1.x passes no session and the host
		 * falls back to its own cwd/DSH_WORKSPACE.
		 */
		const getRoot = () => api("/root" + (currentSessionId ? "?session=" + enc(currentSessionId) : ""));

		// ============================ diff engine ============================
		function lineDiff(before, after) {
			const a = before == null ? [] : String(before).split("\n");
			const b = after == null ? [] : String(after).split("\n");
			const n = a.length, m = b.length;
			if (n === 0) return b.map((text, j) => ({ type: "add", oldNo: null, newNo: j + 1, text }));
			if (m === 0) return a.map((text, i) => ({ type: "del", oldNo: i + 1, newNo: null, text }));
			if (n * m > 2500000) return greedyDiff(a, b);
			const dp = new Uint32Array((n + 1) * (m + 1));
			for (let i = n - 1; i >= 0; i--) {
				for (let j = m - 1; j >= 0; j--) {
					dp[i * (m + 1) + j] = a[i] === b[j]
						? dp[(i + 1) * (m + 1) + j + 1] + 1
						: Math.max(dp[(i + 1) * (m + 1) + j], dp[i * (m + 1) + j + 1]);
				}
			}
			const ops = [];
			let i = 0, j = 0;
			while (i < n && j < m) {
				if (a[i] === b[j]) { ops.push({ type: "same", oldNo: i + 1, newNo: j + 1, text: a[i] }); i++; j++; }
				else if (dp[(i + 1) * (m + 1) + j] >= dp[i * (m + 1) + j + 1]) { ops.push({ type: "del", oldNo: i + 1, newNo: null, text: a[i] }); i++; }
				else { ops.push({ type: "add", oldNo: null, newNo: j + 1, text: b[j] }); j++; }
			}
			while (i < n) { ops.push({ type: "del", oldNo: i + 1, newNo: null, text: a[i] }); i++; }
			while (j < m) { ops.push({ type: "add", oldNo: null, newNo: j + 1, text: b[j] }); j++; }
			return ops;
		}
		function greedyDiff(a, b) {
			let s = 0;
			while (s < a.length && s < b.length && a[s] === b[s]) s++;
			let e = 0;
			while (e < a.length - s && e < b.length - s && a[a.length - 1 - e] === b[b.length - 1 - e]) e++;
			const ops = [];
			for (let k = 0; k < s; k++) ops.push({ type: "same", oldNo: k + 1, newNo: k + 1, text: a[k] });
			for (let k = s; k < a.length - e; k++) ops.push({ type: "del", oldNo: k + 1, newNo: null, text: a[k] });
			for (let k = s; k < b.length - e; k++) ops.push({ type: "add", oldNo: null, newNo: k + 1, text: b[k] });
			for (let k = a.length - e; k < a.length; k++) ops.push({ type: "same", oldNo: k + 1, newNo: b.length - (a.length - k) + 1, text: a[k] });
			return ops;
		}
		function mergeModified(ops) {
			const out = [];
			let i = 0;
			while (i < ops.length) {
				if (ops[i].type === "del") {
					let di = i;
					while (di < ops.length && ops[di].type === "del") di++;
					let ai = di;
					while (ai < ops.length && ops[ai].type === "add") ai++;
					if (di - i === ai - di) {
						for (let k = 0; k < di - i; k++) {
							const oldNo = ops[i + k].oldNo, newNo = ops[di + k].newNo;
							out.push({ type: "mod", oldNo, newNo, text: ops[i + k].text, side: "old" });
							out.push({ type: "mod", oldNo, newNo, text: ops[di + k].text, side: "new" });
						}
						i = ai;
						continue;
					}
				}
				out.push(ops[i]);
				i++;
			}
			return out;
		}
		function wordSeg(a, b) {
			const ta = String(a).split(/(\s+)/);
			const tb = String(b).split(/(\s+)/);
			let s = 0;
			while (s < ta.length && s < tb.length && ta[s] === tb[s]) s++;
			let e = 0;
			while (e < ta.length - s && e < tb.length - s && ta[ta.length - 1 - e] === tb[tb.length - 1 - e]) e++;
			const oldSeg = [];
			for (let k = 0; k < s; k++) oldSeg.push({ t: ta[k], hit: false });
			for (let k = s; k < ta.length - e; k++) oldSeg.push({ t: ta[k], hit: true });
			for (let k = ta.length - e; k < ta.length; k++) oldSeg.push({ t: ta[k], hit: false });
			const newSeg = [];
			for (let k = 0; k < s; k++) newSeg.push({ t: tb[k], hit: false });
			for (let k = s; k < tb.length - e; k++) newSeg.push({ t: tb[k], hit: true });
			for (let k = tb.length - e; k < tb.length; k++) newSeg.push({ t: tb[k], hit: false });
			return { oldSeg, newSeg };
		}
		function buildBlocks(ops, gapThreshold = 7) {
			const blocks = [];
			let same = [];
			const flushSame = (keepTail) => {
				if (same.length === 0) return;
				if (same.length <= gapThreshold) { blocks.push({ kind: "lines", ops: same }); same = []; return; }
				const head = same.slice(0, 4);
				const tail = keepTail ? same.slice(-4) : [];
				blocks.push({ kind: "lines", ops: head });
				blocks.push({ kind: "gap", count: same.length - head.length - tail.length });
				if (tail.length) blocks.push({ kind: "lines", ops: tail });
				same = [];
			};
			for (const op of ops) {
				if (op.type === "same") { same.push(op); continue; }
				flushSame(true);
				blocks.push({ kind: "lines", ops: [op] });
			}
			flushSame(false);
			return blocks;
		}
		function fileStats(before, after) {
			const diff = lineDiff(before, after);
			let adds = 0, dels = 0;
			for (const op of diff) { if (op.type === "add") adds++; else if (op.type === "del") dels++; }
			return { adds, dels };
		}

		// ============================ syntax highlighting ============================
		const KEYWORDS = new Set(["if","else","for","while","do","return","function","const","let","var","class","extends","new","import","export","from","default","async","await","try","catch","finally","throw","switch","case","break","continue","typeof","instanceof","in","of","this","super","static","get","set","public","private","protected","interface","implements","enum","package","void","yield","delegate","is","as","def","elif","lambda","pass","and","or","not","with","raise","global","nonlocal","assert","del","fun","val","data","object","when","override","open","internal","abstract","companion","lateinit","by","init","constructor","suspend","sealed","expect","actual","typealias","annotation","select","where","join","group","order","limit","offset","having","create","insert","update","delete","table","values","primary","foreign","key","index","unique","not","null","like","between","left","right","inner","outer","on","using","distinct","exists","union","all","grant","revoke","begin","commit","rollback","pragma","default","references"]);
		const TYPES = new Set(["int","float","double","long","short","byte","boolean","char","String","List","Map","Set","Object","Array","Number","Boolean","Date","Promise","any","unknown","never","number","string","boolean","object","symbol","bigint","uint8","int8","int16","uint16","int32","uint32","int64","uint64","void","Unit","Any","Nothing","Byte","Short","Long","Char","Float","Double","Boolean","ArrayList","HashMap","HashSet","Integer","Runnable","Throwable","Exception","Error","Context","Activity","View","ViewGroup","Fragment","Intent","Bundle","Bitmap","RecyclerView","Adapter","ViewHolder","Handler","Thread","Task","TaskInfo"]);
		const CONSTS = new Set(["true","false","null","undefined","NaN","Infinity","self","cls","it"]);
		const TOKEN_RE = /(\/\/[^\n]*|\/\*[\s\S]*?\*\/|#[^\n]*|<!--[\s\S]*?-->|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|\b\d[\d_]*(?:\.\d+)?(?:[eE][+-]?\d+)?\b|#[0-9a-fA-F]{3,8}\b|@[A-Za-z_][\w]*|\b[A-Za-z_$][\w$]*(?=\s*\()|\b[A-Za-z_$][\w$]*\b)/g;
		function tokenizeLine(line) {
			const out = [];
			let last = 0;
			let m;
			TOKEN_RE.lastIndex = 0;
			while ((m = TOKEN_RE.exec(line)) !== null) {
				if (m.index > last) out.push({ text: line.slice(last, m.index), cls: "" });
				const tok = m[0];
				let cls = "";
				if (tok.startsWith("//") || tok.startsWith("/*") || tok.startsWith("#") || tok.startsWith("<!--")) cls = "cs-tok-cmt";
				else if (tok[0] === "\"" || tok[0] === "'") cls = "cs-tok-str";
				else if (/^[\d#@]/.test(tok)) cls = tok[0] === "@" ? "cs-tok-ann" : "cs-tok-num";
				else if (tok.endsWith("(")) { const name = tok.slice(0, -1).trim(); cls = "cs-tok-fn"; }
				else if (KEYWORDS.has(tok)) cls = "cs-tok-kw";
				else if (TYPES.has(tok)) cls = "cs-tok-ty";
				else if (CONSTS.has(tok)) cls = "cs-tok-cn";
				out.push({ text: tok, cls });
				last = m.index + tok.length;
			}
			if (last < line.length) out.push({ text: line.slice(last), cls: "" });
			return out;
		}
		function extOf(path) {
			const name = path.split(/[\\/]/).pop() || "";
			const i = name.lastIndexOf(".");
			return i >= 0 ? name.slice(i + 1).toLowerCase() : "";
		}
		const CODE_EXTS = new Set(["js","jsx","ts","tsx","mjs","cjs","py","go","rs","java","kt","kts","swift","c","h","cpp","hpp","cc","cs","php","rb","sh","ps1","lua","pl","vue","svelte","html","css","scss","less","sql","proto","dart","ex","exs","ml","fs","scala","zig","asm"]);
		const DOC_EXTS = new Set(["md","mdx","txt","rst","adoc"]);
		const CONF_EXTS = new Set(["json","jsonc","yml","yaml","toml","ini","conf","cfg","xml","env"]);
		function extType(ext) { return CODE_EXTS.has(ext) ? "code" : DOC_EXTS.has(ext) ? "doc" : CONF_EXTS.has(ext) ? "conf" : "other"; }
		function Highlighted({ text, path }) {
			const toks = React.useMemo(() => tokenizeLine(text), [text]);
			return el("span", null,
				toks.map((t, i) => t.cls ? el("span", { className: t.cls, key: i }, t.text) : t.text)
			);
		}

		// ============================ panel controller ============================
		/**
		 * The panel is the shell's own overlay surface (`shell.overlay`): it floats over
		 * the right edge of the conversation, drag its left edge to resize, ✕ to hide,
		 * `Ctrl+Alt+C` to toggle. Same surface in 0.1.x and 0.2 — 0.2's slot-owned right
		 * sidebar would put it in a separate pane/window instead, which is not what this
		 * panel is.
		 */
		const panel = { open: false, listeners: new Set() };
		function applyPanelState(v) {
			const next = !!v;
			if (next === panel.open) return;
			panel.open = next;
			for (const fn of panel.listeners) fn(panel.open);
		}
		function setPanelOpen(v) {
			applyPanelState(v);
		}
		function subscribePanel(fn) { panel.listeners.add(fn); return () => panel.listeners.delete(fn); }

		// Live digest of THIS session's changes. The panel publishes it on every change
		// and the session-header pill (which lives in the chat header, outside the panel)
		// reads it, so the header stays informative while the panel is closed.
		const summary = { count: 0, adds: 0, dels: 0, files: [], sessionId: null, listeners: new Set() };
		function publishSummary(next) {
			const same = summary.count === next.count
				&& summary.adds === next.adds
				&& summary.dels === next.dels
				&& summary.sessionId === next.sessionId
				&& summary.files.length === next.files.length
				&& summary.files.every((f, i) => f.path === next.files[i].path && f.adds === next.files[i].adds && f.dels === next.files[i].dels);
			summary.count = next.count;
			summary.adds = next.adds;
			summary.dels = next.dels;
			summary.files = next.files;
			summary.sessionId = next.sessionId;
			if (!same) for (const fn of summary.listeners) fn();
		}
		function subscribeSummary(fn) { summary.listeners.add(fn); return () => summary.listeners.delete(fn); }

		// Deep link from the header menu into the panel: open it on one changed file.
		const focusListeners = new Set();
		function focusChange(path) {
			setPanelOpen(true);
			for (const fn of focusListeners) fn(path);
		}
		function subscribeFocus(fn) { focusListeners.add(fn); return () => focusListeners.delete(fn); }

		// current session id (per-session change isolation)
		let currentSessionId = null;
		const sessListeners = new Set();
		function setSessionId(v) {
			currentSessionId = v;
			for (const fn of sessListeners) fn(v);
		}
		function subscribeSession(fn) { sessListeners.add(fn); return () => sessListeners.delete(fn); }

		// ============================ module state ============================
		let ctxRef = null;            // plugin ctx (set in apply) for send-to-chat
		let lastSeq = 0;              // last SSE seq seen (dedupe + replay recovery)
		let lastAutoOpen = 0;          // last time the panel auto-opened (cooldown, ms)
		const AUTO_OPEN_COOLDOWN = 5 * 60 * 1000; // auto-open at most once per 5 min
		const unseen = new Map();     // sessionKey -> unseen change count (sidebar badge)
		const badgeListeners = new Set();
		function bumpUnseen(key, by) { unseen.set(key, (unseen.get(key) ?? 0) + by); for (const fn of badgeListeners) fn(); }
		function clearUnseen(key) { if (key != null && unseen.delete(key)) for (const fn of badgeListeners) fn(); }
		function unseenCount(key) { return unseen.get(key) ?? 0; }
		function subscribeBadge(fn) { badgeListeners.add(fn); return () => badgeListeners.delete(fn); }
		function badgeKey(sessionId) { return sessionId ?? "__unknown"; }

		// ---- shared change/connection state + the one SSE feed ----
		// In 0.2 the change feed and the panel UI are two components: the UI lives in
		// the right sidebar's tab (mounted only while that tab is open) and a headless
		// feed entry stays mounted so the header pill keeps counting. Sharing the state
		// here — instead of portalling one instance into the other — keeps both honest
		// and removes any mount-order coupling.
		const feed = { changes: [], conn: "connecting", connText: "连接中…", listeners: new Set() };
		function emitFeed() { for (const fn of feed.listeners) fn(); }
		function subscribeFeed(fn) { feed.listeners.add(fn); return () => feed.listeners.delete(fn); }
		function setChanges(next) {
			feed.changes = typeof next === "function" ? next(feed.changes) : next;
			emitFeed();
		}
		function setConn(state, text) {
			feed.conn = state;
			if (typeof text === "string") feed.connText = text;
			emitFeed();
		}
		const setConnText = (text) => setConn(feed.conn, text);

		/** Reference-counted SSE subscription: one stream however many views exist. */
		let feedUsers = 0;
		let feedSource = null;
		function openFeed() {
			if (typeof EventSource !== "function" || feedSource !== null) return;
			feedSource = new EventSource(API + "/events");
			feedSource.onopen = () => {
				// server restart resets seq to 1; dropping the old watermark lets the
				// replayed ring through again (the change list dedupes by path)
				lastSeq = 0;
				setConn("ok", "已连接");
			};
			feedSource.onerror = () => setConn("err", "事件流断开，重连中…");
			feedSource.onmessage = (msg) => {
				try {
					const ev = JSON.parse(msg.data);
					if (!ev || typeof ev.path !== "string") return;
					// dedupe across EventSource reconnect replays (Last-Event-ID)
					if (typeof ev.seq === "number") {
						if (ev.seq <= lastSeq) return;
						lastSeq = ev.seq;
					}
					// Strict per-session isolation: only surface changes of the selected
					// session, so each conversation keeps its own change list.
					if (ev.sessionId && currentSessionId && ev.sessionId !== currentSessionId) return;
					setConn("ok", "已连接");
					const name = ev.path.split(/[\\/]/).pop() || ev.path;
					setChanges((prev) => {
						const existing = prev.find((c) => c.path === ev.path);
						const before = existing && existing.before !== null ? existing.before : ev.before;
						const next = prev.filter((c) => c.path !== ev.path);
						next.unshift({ path: ev.path, name, before, after: ev.after, deleted: !!ev.deleted && !existing, ts: ev.ts, seq: ev.seq, sessionId: ev.sessionId });
						return next.slice(0, 50);
					});
					if (ev.source !== "revert" && !panel.open) bumpUnseen(badgeKey(ev.sessionId ?? currentSessionId), 1);
					// Auto-open polite: first change opens the panel, then a cooldown so
					// closing it isn't fought by every later edit. In 0.2 the panel is a
					// right-sidebar tab the user opened: never yank them out of the
					// conversation — the header pill and the unseen dot carry the signal.
					if (!panel.open && Date.now() - lastAutoOpen >= AUTO_OPEN_COOLDOWN) { lastAutoOpen = Date.now(); setPanelOpen(true); }
					// reveal the newest change (the panel subscribes to this bus)
					for (const fn of focusListeners) fn(ev.path);
				} catch { /* ignore malformed frames */ }
			};
		}
		function closeFeed() {
			if (feedSource !== null) { try { feedSource.close(); } catch { /* ignore */ } feedSource = null; }
		}
		/** Called by every mounted view; the stream lives while at least one is alive. */
		function startChangeFeed() {
			feedUsers += 1;
			openFeed();
			let stopped = false;
			return () => {
				if (stopped) return;
				stopped = true;
				feedUsers -= 1;
				if (feedUsers <= 0) { feedUsers = 0; closeFeed(); }
			};
		}

		// per-session UI state memory (changes, tabs, width), persisted locally
		const SESS_STATE_KEY = "cs.sessionStates.v1";
		function loadSessionStates() {
			try {
				const raw = globalThis.localStorage?.getItem(SESS_STATE_KEY);
				if (raw) return JSON.parse(raw);
			} catch { /* ignore */ }
			return {};
		}
		function persistSessionStates(map) {
			try { globalThis.localStorage?.setItem(SESS_STATE_KEY, JSON.stringify(map)); } catch { /* ignore */ }
		}

		// ============================ CSS ============================
		const CSS = `/* ============================================================================
   Code Studio - panel stylesheet (v0.2.15, minimalist pass)
   Design read: premium utilitarian minimalism translated into a dark tool shell.
   The minimalist-ui protocol natively targets light document UIs, so only its
   transferable rules are applied here: near-zero shadows (a 1px hairline does the
   separating), colour as a scarce semantic resource, one solid CTA with everything
   else ghost-flat, crisp 4/8px radii (pills reserved for tiny semantic dots),
   kbd micro-UI, generous-but-compact padding, invisible motion.
   Every host token keeps a fallback so the sheet renders standalone.
   Icons: one hand-drawn 16px / 1.5px-stroke grid (no bundler, no icon dependency -
   documented honest downgrade).
   ========================================================================== */
.cs-root{
  --cs-mono:ui-monospace,"JetBrains Mono","Cascadia Code","SF Mono",Consolas,"Liberation Mono",monospace;
  --cs-r1:4px;--cs-r2:8px;--cs-rf:999px;
  --cs-ease:cubic-bezier(0.16,1,0.3,1);
  --cs-row:18px;
  --cs-line:var(--dsw-alias-border-l1,rgba(255,255,255,.07));
  --cs-line2:var(--dsw-alias-border-l2,rgba(255,255,255,.12));
  --cs-s1:var(--dsw-alias-bg-layer-1,#151922);
  --cs-s2:var(--dsw-alias-bg-layer-2,#1a1f2b);
  --cs-recess:var(--dsw-alias-bg-base,#0f1115);
  --cs-ink:var(--dsw-alias-label-primary,#d7dde6);
  --cs-ink2:var(--dsw-alias-label-secondary,#b6bdc9);
  --cs-ink3:var(--dsw-alias-label-tertiary,#8b93a3);
  --cs-ink4:var(--dsw-alias-label-quaternary,#565e6e);
  --cs-accent:var(--dsw-alias-brand-primary,#4c8dff);
  --cs-hover:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.055));
  --cs-press:var(--dsw-alias-interactive-bg-active,rgba(255,255,255,.1));
  --cs-mask:var(--dsw-alias-bg-mask-1,rgba(255,255,255,.045));
  --cs-ok:var(--dsw-alias-state-success-primary,#4ec38a);
  --cs-warn:var(--dsw-alias-state-warn-primary,#e0b341);
  --cs-err:var(--dsw-alias-state-error-primary,#e5726c);
  position:absolute;top:0;right:0;bottom:0;z-index:30;
  display:flex;flex-direction:column;min-width:280px;max-width:100%;
  background:var(--cs-s1);color:var(--cs-ink);
  border-left:1px solid var(--cs-line);
  font:13px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI Variable Text","Segoe UI",system-ui,sans-serif;
  animation:cs-in .24s var(--cs-ease) both;
  container-type:inline-size;
}
@keyframes cs-in{from{opacity:0;transform:translateX(8px)}to{opacity:1;transform:none}}
/* DSH desktop (Windows) draws its window caption as a fixed page layer and
   'shell.overlay' is inset:0 over it - keep the panel below that band so the
   close button never hides under the window controls. */
[data-windows-titlebar] .cs-root{top:var(--dsh-windows-titlebar-height,40px)}
.cs-root *{box-sizing:border-box}

/* ---------------------------------------------------------------- scrollbar */
.cs-root ::-webkit-scrollbar{width:var(--dsh-scrollbar-width,8px);height:var(--dsh-scrollbar-width,8px)}
.cs-root ::-webkit-scrollbar-track{background:transparent}
.cs-root ::-webkit-scrollbar-thumb{background:var(--dsh-scrollbar-thumb,rgba(255,255,255,.12));border-radius:var(--cs-rf);border:2px solid transparent;background-clip:padding-box}
.cs-root ::-webkit-scrollbar-thumb:hover{background:var(--dsh-scrollbar-thumb-hover,rgba(255,255,255,.22));border:2px solid transparent;background-clip:padding-box}
.cs-root ::-webkit-scrollbar-corner{background:transparent}

/* ------------------------------------------------------------------- resize */
.cs-resize{position:absolute;left:-3px;top:0;bottom:0;width:7px;cursor:col-resize;z-index:6}
.cs-resize::after{content:"";position:absolute;left:3px;top:0;bottom:0;width:1px;background:transparent;transition:background .16s var(--cs-ease)}
.cs-resize:hover::after,.cs-resize.cs-drag::after{background:var(--cs-accent);opacity:.5}

/* -------------------------------------------------------------------- chrome */
/* one bar: title, segmented tabs, close */
.cs-head{display:flex;align-items:center;gap:10px;flex:none;height:42px;padding:0 8px 0 14px;border-bottom:1px solid var(--cs-line);background:var(--cs-s2)}
.cs-title{flex:1;min-width:0;font-size:12.5px;font-weight:600;letter-spacing:-.01em;white-space:nowrap;color:var(--cs-ink2)}
.cs-tabs{display:flex;flex:none;gap:2px;padding:2px;border-radius:6px;background:var(--cs-mask)}
.cs-tab{flex:none;padding:3px 11px;border:none;border-radius:var(--cs-r1);background:transparent;color:var(--cs-ink3);font-size:12px;font-weight:500;cursor:pointer;transition:background .16s var(--cs-ease),color .16s var(--cs-ease)}
.cs-tab:hover{color:var(--cs-ink)}
.cs-tab.cs-on{background:var(--cs-press);color:var(--cs-ink)}
.cs-close{flex:none;display:grid;place-items:center;width:26px;height:26px;border:none;border-radius:var(--cs-r1);background:transparent;color:var(--cs-ink3);font-size:12.5px;line-height:1;cursor:pointer;transition:background .16s var(--cs-ease),color .16s var(--cs-ease)}
.cs-close:hover{background:var(--cs-hover);color:var(--cs-ink)}
.cs-close:active{transform:scale(.96)}
.cs-body{display:flex;flex-direction:column;flex:1;min-height:0;overflow:hidden}
.cs-files{display:flex;flex-direction:column;flex:1;min-height:0}

/* -------------------------------------------------------------- filter row */
.cs-filter{display:flex;align-items:center;gap:8px;flex:none;padding:8px 12px;border-bottom:1px solid var(--cs-line)}
.cs-filter input,.cs-filter select{min-width:0;border:1px solid var(--cs-line);border-radius:var(--cs-r1);background:var(--cs-recess);color:var(--cs-ink);font-size:11.5px;padding:4px 9px;outline:none;transition:border-color .16s var(--cs-ease)}
.cs-filter input{flex:1}
.cs-filter select{flex:none;color:var(--cs-ink2)}
.cs-filter input:focus,.cs-filter select:focus{border-color:color-mix(in srgb,var(--cs-accent) 55%,transparent)}
.cs-filter input::placeholder{color:var(--cs-ink4)}
.cs-meta{display:flex;align-items:center;gap:8px;flex:none;font-family:var(--cs-mono);font-size:10.5px;font-variant-numeric:tabular-nums;white-space:nowrap}
.cs-meta-n{color:var(--cs-ink4)}
.cs-plus{flex:none;color:var(--cs-ok);font-family:var(--cs-mono);font-size:11px;font-variant-numeric:tabular-nums}
.cs-minus{flex:none;color:var(--cs-err);font-family:var(--cs-mono);font-size:11px;font-variant-numeric:tabular-nums}
.cs-zero{flex:none;color:var(--cs-ink4);font-family:var(--cs-mono);font-size:11px}

/* -------------------------------------------------------------- change rows */
.cs-chg-list{flex:1;overflow:auto;padding:0}
.cs-chg{flex:none;border-bottom:1px solid var(--cs-line)}
.cs-chg-row{display:flex;align-items:center;gap:8px;padding:8px 12px 8px 10px;cursor:pointer;transition:background .16s var(--cs-ease)}
.cs-chg-row:hover{background:var(--cs-hover)}
.cs-caret{flex:none;display:grid;place-items:center;width:13px;height:13px;color:var(--cs-ink4);font-size:9px}
.cs-sel{flex:none;width:13px;height:13px;margin:0;accent-color:var(--cs-accent);cursor:pointer;opacity:0;transition:opacity .14s var(--cs-ease)}
.cs-chg-row:hover .cs-sel,.cs-chg-row .cs-sel:checked,.cs-chg-row .cs-sel:focus-visible{opacity:1}
.cs-chg-path{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--cs-ink);font-family:var(--cs-mono);font-size:11.5px;letter-spacing:-.01em}
.cs-chg-path .cs-bad{display:inline-block;margin-left:6px;padding:0 4px;border-radius:var(--cs-r1);font-family:var(--cs-mono);font-size:9.5px;vertical-align:1px}
.cs-bad-add{background:color-mix(in srgb,var(--cs-ok) 14%,transparent);color:var(--cs-ok)}
.cs-bad-del{background:color-mix(in srgb,var(--cs-err) 13%,transparent);color:var(--cs-err)}
.cs-bad-rev{background:var(--cs-mask);color:var(--cs-ink3)}
.cs-sess-tag{margin-left:6px;padding:0 4px;border-radius:var(--cs-r1);background:var(--cs-mask);color:var(--cs-ink4);font-size:9.5px}
.cs-fstat{display:flex;align-items:center;gap:6px;flex:none}
.cs-acts{display:flex;align-items:center;gap:2px;flex:none;opacity:0;transition:opacity .16s var(--cs-ease)}
.cs-chg-row:hover .cs-acts,.cs-chg-row:focus-within .cs-acts,.cs-chg-row.cs-open .cs-acts{opacity:1}
.cs-ibtn{flex:none;display:grid;place-items:center;width:24px;height:24px;border:none;border-radius:var(--cs-r1);background:transparent;color:var(--cs-ink3);font-size:12px;line-height:1;cursor:pointer;transition:background .16s var(--cs-ease),color .16s var(--cs-ease),transform .1s var(--cs-ease)}
.cs-ibtn:hover{background:var(--cs-hover);color:var(--cs-ink)}
.cs-ibtn:active{transform:scale(.94)}
.cs-ibtn:disabled{opacity:.35;cursor:default;transform:none}
.cs-ibtn.cs-on{background:var(--cs-press);color:var(--cs-accent)}
.cs-chg-body{border-top:1px solid var(--cs-line);max-height:58vh;overflow:auto;background:var(--cs-recess)}

/* -------------------------------------------------------------- diff viewer */
.cs-dline{display:flex;align-items:baseline;height:var(--cs-row);min-width:max-content;overflow:hidden;font-family:var(--cs-mono);font-size:11.5px;line-height:var(--cs-row)}
.cs-dg{flex:none;display:flex;user-select:none}
.cs-dsym{flex:none;width:14px;text-align:center;font-weight:700;opacity:.7}
.cs-dnum{flex:none;min-width:34px;padding-right:10px;text-align:right;color:var(--cs-ink4);font-size:10.5px;font-variant-numeric:tabular-nums}
.cs-dtxt{flex:1;padding-right:12px;white-space:pre;color:var(--cs-ink2)}
.cs-dline.cs-add{background:color-mix(in srgb,var(--cs-ok) 9%,transparent);box-shadow:inset 2px 0 0 0 color-mix(in srgb,var(--cs-ok) 70%,transparent)}
.cs-dline.cs-add .cs-dsym{color:var(--cs-ok)}
.cs-dline.cs-del{background:color-mix(in srgb,var(--cs-err) 8%,transparent);box-shadow:inset 2px 0 0 0 color-mix(in srgb,var(--cs-err) 70%,transparent)}
.cs-dline.cs-del .cs-dsym{color:var(--cs-err)}
.cs-dline.cs-del .cs-dtxt{color:var(--cs-ink3)}
.cs-dline.cs-mod{background:color-mix(in srgb,var(--cs-warn) 8%,transparent);box-shadow:inset 2px 0 0 0 color-mix(in srgb,var(--cs-warn) 70%,transparent)}
.cs-dline.cs-mod .cs-dsym{color:var(--cs-warn)}
.cs-dline:hover{background:var(--cs-hover)}
.cs-dgap{display:flex;align-items:center;gap:10px;height:var(--cs-row);padding:0 12px;color:var(--cs-ink4);font-family:var(--cs-mono);font-size:10.5px;cursor:pointer;user-select:none;transition:color .16s var(--cs-ease)}
.cs-dgap:hover{color:var(--cs-ink2)}
.cs-dgap .cs-dgbar{flex:1;height:1px;background:var(--cs-line)}
.cs-wh-add{background:color-mix(in srgb,var(--cs-ok) 20%,transparent);border-radius:2px;padding:0 1px}
.cs-wh-del{background:color-mix(in srgb,var(--cs-err) 18%,transparent);border-radius:2px;padding:0 1px;opacity:.85}
.cs-wh-same{background:none}

/* ------------------------------------------------------------------ history */
.cs-hist-back{display:flex;align-items:center;gap:8px;flex:none;padding:8px 12px;border-bottom:1px solid var(--cs-line)}
.cs-hist-back .cs-fp{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--cs-ink3);font-family:var(--cs-mono);font-size:11px}
.cs-hist-item{border-bottom:1px solid var(--cs-line)}
.cs-hist-row{display:flex;align-items:center;gap:8px;padding:7px 12px;cursor:pointer;transition:background .16s var(--cs-ease)}
.cs-hist-row:hover{background:var(--cs-hover)}
.cs-hist-row .cs-fp{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--cs-ink2);font-family:var(--cs-mono);font-size:11px}
.cs-hist-tag{flex:none;padding:0 5px;border-radius:var(--cs-r1);font-family:var(--cs-mono);font-size:9.5px;background:var(--cs-mask);color:var(--cs-ink3)}
.cs-hist-tag.cs-src{color:var(--cs-accent)}
.cs-hist-tag.cs-usr{color:var(--cs-ok)}
.cs-hist-tag.cs-rev2{color:var(--cs-warn)}

/* ------------------------------------------------------------ workspace bar */
.cs-ws-bar{display:flex;align-items:center;gap:8px;flex:none;padding:8px 12px;border-bottom:1px solid var(--cs-line)}
.cs-ws-bar>span{flex:none;color:var(--cs-ink4);font-size:10px;font-weight:500;letter-spacing:.06em;text-transform:uppercase}
.cs-ws-bar select{flex:1;min-width:0;border:1px solid var(--cs-line);border-radius:var(--cs-r1);background:var(--cs-recess);color:var(--cs-ink2);font-size:11.5px;padding:4px 9px;outline:none;transition:border-color .16s var(--cs-ease)}
.cs-ws-bar select:focus{border-color:color-mix(in srgb,var(--cs-accent) 55%,transparent)}

/* portable-drive notices */
.cs-note{flex:none;padding:8px 12px;border-bottom:1px solid var(--cs-line);background:color-mix(in srgb,var(--cs-accent) 6%,transparent);color:var(--cs-ink2);font-size:11px;line-height:1.6;text-wrap:pretty}
.cs-note-warn{background:color-mix(in srgb,var(--cs-warn) 7%,transparent);color:var(--cs-warn)}
.cs-note-sub{display:block;margin-top:2px;color:var(--cs-ink4);font-family:var(--cs-mono);font-size:10.5px;word-break:break-all}

/* ---------------------------------------------------------------- file tree */
.cs-tree{flex:none;max-height:38%;overflow:auto;padding:4px 0;border-bottom:1px solid var(--cs-line);background:var(--cs-recess);font-size:11.5px}
.cs-node{display:flex;align-items:center;gap:6px;padding:3px 12px;color:var(--cs-ink2);white-space:nowrap;cursor:pointer;transition:background .16s var(--cs-ease),color .16s var(--cs-ease)}
.cs-node:hover{background:var(--cs-hover);color:var(--cs-ink)}
.cs-node.cs-sel{background:var(--cs-press);color:var(--cs-ink);box-shadow:inset 2px 0 0 0 var(--cs-accent)}
.cs-node.cs-file{cursor:pointer}
.cs-node .cs-caret{width:11px;font-size:9px}
.cs-node .cs-ico{flex:none;display:grid;place-items:center;width:13px;color:var(--cs-ink4);font-size:10px}
.cs-node .cs-nm{overflow:hidden;text-overflow:ellipsis;font-family:var(--cs-mono);font-size:11px;letter-spacing:-.01em}
.cs-node .cs-badge{margin-left:auto;color:var(--cs-warn);font-size:10px}

/* ------------------------------------------------------------------- editor */
.cs-editor{display:flex;flex-direction:column;flex:1;min-height:0}
.cs-filebar{display:flex;align-items:center;gap:8px;flex:none;padding:8px 12px;border-bottom:1px solid var(--cs-line);font-family:var(--cs-mono);font-size:11px;color:var(--cs-ink3)}
.cs-filebar .cs-fp{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;letter-spacing:-.01em}
.cs-dirty{flex:none;color:var(--cs-warn);font-size:10px}
/* buttons: ghost by default, one solid primary - colour stays scarce */
.cs-btn{flex:none;padding:3px 10px;border:none;border-radius:var(--cs-r1);background:transparent;color:var(--cs-ink2);font-size:11px;font-family:inherit;cursor:pointer;transition:background .16s var(--cs-ease),color .16s var(--cs-ease),transform .1s var(--cs-ease)}
.cs-btn:hover{background:var(--cs-hover);color:var(--cs-ink)}
.cs-btn:active{transform:scale(.98)}
.cs-btn.cs-pri{background:var(--dsw-alias-button-primary-fill,#2f6fed);color:#fff}
.cs-btn.cs-pri:hover{filter:brightness(1.07);background:var(--dsw-alias-button-primary-fill,#2f6fed)}
.cs-btn:disabled{opacity:.35;cursor:default;transform:none}
.cs-edittools{display:flex;align-items:center;gap:2px;flex:none;padding:6px 12px;border-bottom:1px solid var(--cs-line);overflow-x:auto;scrollbar-width:none}
.cs-edittools::-webkit-scrollbar{display:none}
.cs-edittools .cs-btn{margin-left:auto}
.cs-edittools .cs-btn ~ .cs-btn{margin-left:0}
.cs-findbar{display:flex;align-items:center;gap:6px;flex:none;padding:6px 12px;border-bottom:1px solid var(--cs-line)}
.cs-findbar input{flex:1;min-width:0;padding:3px 9px;border:1px solid var(--cs-line);border-radius:var(--cs-r1);background:var(--cs-recess);color:var(--cs-ink);font-size:11px;outline:none}
.cs-findbar input:focus{border-color:color-mix(in srgb,var(--cs-accent) 55%,transparent)}
.cs-findcnt{flex:none;color:var(--cs-ink4);font-family:var(--cs-mono);font-size:10px;font-variant-numeric:tabular-nums}
.cs-edit-wrap{display:flex;flex:1;min-height:0}
.cs-edit-g{flex:none;overflow:hidden;padding-left:12px;text-align:right;user-select:none;background:var(--cs-recess)}
.cs-edit-g .cs-gn{min-width:32px;padding:0 9px 0 0;color:var(--cs-ink4);font-family:var(--cs-mono);font-size:12px;line-height:1.55;text-align:right;font-variant-numeric:tabular-nums}
.cs-edit-overlay{position:relative;flex:1;min-width:0;overflow:hidden;background:var(--cs-recess)}
.cs-edit-overlay .cs-hl{position:absolute;inset:0;height:100%;margin:0;padding:0 12px 0 8px;overflow:hidden;white-space:pre;pointer-events:none;color:var(--cs-ink);font-family:var(--cs-mono);font-size:12px;line-height:1.55}
.cs-edit-overlay .cs-ta{position:absolute;inset:0;width:100%;height:100%;padding:0 12px 0 8px;border:none;outline:none;background:transparent;color:transparent;caret-color:var(--cs-ink);font-family:var(--cs-mono);font-size:12px;line-height:1.55;white-space:pre;overflow:auto;resize:none;tab-size:2}
.cs-edit-overlay .cs-ta::selection{background:color-mix(in srgb,var(--cs-accent) 32%,transparent)}
.cs-tok-kw{color:#bd93c9}.cs-tok-str{color:#9dc58a}.cs-tok-cmt{color:#6f7683;font-style:italic}.cs-tok-num{color:#d0a27a}.cs-tok-fn{color:#84b3ee}.cs-tok-ty{color:#d8c68a}.cs-tok-cn{color:#83c1bd}.cs-tok-ann{color:#84b3ee;font-style:italic}

/* -------------------------------------------------- empty / loading states */
.cs-empty{display:flex;flex:1;flex-direction:column;align-items:center;justify-content:center;gap:7px;padding:32px 24px;color:var(--cs-ink3);font-size:12px;text-align:center}
.cs-empty-ico{display:grid;place-items:center;color:var(--cs-ink4)}
.cs-empty-title{color:var(--cs-ink);font-size:12.5px;font-weight:600;letter-spacing:-.01em}
.cs-empty .cs-hint{max-width:300px;color:var(--cs-ink4);font-size:11px;line-height:1.7;text-wrap:pretty}
.cs-empty .cs-kbd{margin:0 2px}
.cs-skel{display:flex;flex-direction:column;gap:7px;padding:14px;opacity:.6}
.cs-skel-row{height:9px;border-radius:var(--cs-r1);background:linear-gradient(90deg,var(--cs-s2) 0%,var(--cs-mask) 50%,var(--cs-s2) 100%);background-size:200% 100%;animation:cs-skel 1.6s var(--cs-ease) infinite}
@keyframes cs-skel{from{background-position:200% 0}to{background-position:-200% 0}}

/* --------------------------------------------------------------- status bar */
.cs-status{display:flex;align-items:center;gap:10px;flex:none;padding:6px 12px;border-top:1px solid var(--cs-line);color:var(--cs-ink3);font-size:10.5px;font-variant-numeric:tabular-nums;flex-wrap:nowrap;overflow:hidden}
.cs-status>span{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.cs-status .cs-sdot{flex:none;width:6px;height:6px;border-radius:var(--cs-rf);background:var(--cs-ink4)}
.cs-status .cs-ok{background:var(--cs-ok)}
.cs-status .cs-busy{background:var(--cs-warn);animation:cs-pulse 2s var(--cs-ease) infinite}
.cs-status .cs-err{background:var(--cs-err)}
@keyframes cs-pulse{0%,100%{opacity:1}50%{opacity:.45}}
.cs-hintkeys{display:flex;align-items:center;gap:4px;margin-left:auto;color:var(--cs-ink4)}
.cs-kbd{display:inline-block;padding:1px 5px;border:1px solid var(--cs-line);border-radius:var(--cs-r1);background:var(--cs-recess);color:var(--cs-ink3);font-family:var(--cs-mono);font-size:9.5px;line-height:1.5;white-space:nowrap}

/* -------------------------------------------------------------- list footer */
.cs-footbar{display:flex;align-items:center;gap:8px;flex:none;padding:7px 12px;border-top:1px solid var(--cs-line)}
.cs-foot-note{flex:none;color:var(--cs-ink4);font-size:10.5px;font-variant-numeric:tabular-nums}
.cs-foot-acts{display:flex;align-items:center;gap:2px;margin-left:auto;flex-wrap:wrap;justify-content:flex-end}

/* -------------------------------------------------------------- help sheet */
.cs-help{position:absolute;inset:0;z-index:9;display:grid;place-items:center;padding:18px;background:rgba(6,10,18,.5);animation:cs-in .18s var(--cs-ease) both}
.cs-help-card{width:100%;max-width:300px;padding:16px;border:1px solid var(--cs-line2);border-radius:var(--cs-r2);background:var(--cs-s2)}
.cs-help-title{margin-bottom:10px;color:var(--cs-ink);font-size:11px;font-weight:600;letter-spacing:.05em;text-transform:uppercase}
.cs-help-row{display:flex;align-items:center;gap:10px;padding:5px 0;border-top:1px solid var(--cs-line);color:var(--cs-ink2);font-size:11.5px}
.cs-help-row .cs-kbd{flex:none;min-width:64px;text-align:center}

/* ------------------------------------------------ conversation header pill */
.cs-hpill{display:flex;align-items:center;height:26px;overflow:hidden;border:1px solid var(--cs-line2);border-radius:var(--cs-r1);background:var(--dsw-alias-button-tool-bar-fill,rgba(255,255,255,.04));color:var(--cs-ink2);font-size:12px;line-height:1;transition:background .16s var(--cs-ease),border-color .16s var(--cs-ease),color .16s var(--cs-ease)}
.cs-hpill:hover{background:var(--dsw-alias-button-tool-bar-hover,rgba(255,255,255,.08));color:var(--cs-ink)}
.cs-hpill-main{display:flex;align-items:center;gap:6px;height:100%;padding:0 9px;border:none;background:transparent;color:inherit;font:inherit;white-space:nowrap;cursor:pointer}
.cs-hpill-more{display:flex;align-items:center;height:100%;padding:0 6px;border:none;border-left:1px solid var(--cs-line);background:transparent;color:var(--cs-ink3);cursor:pointer;transition:color .16s var(--cs-ease)}
.cs-hpill-more:hover{color:var(--cs-ink)}
.cs-hpill-main:focus-visible,.cs-hpill-more:focus-visible{outline:1.5px solid var(--cs-accent);outline-offset:-2px}
.cs-hico{display:flex;align-items:center;justify-content:center;flex:none}
.cs-hico-svg{display:flex;align-items:center}
.cs-hlabel{font-variant-numeric:tabular-nums;letter-spacing:-.01em}
.cs-hlabel.cs-hidle{color:var(--cs-ink3)}
.cs-hdelta{display:flex;align-items:center;gap:5px;flex:none;font-family:var(--cs-mono);font-size:11px}
.cs-hdot{flex:none;width:6px;height:6px;margin-left:2px;border-radius:var(--cs-rf);background:var(--cs-accent)}
.cs-hchev{color:var(--cs-ink3);font-size:10px}
.cs-hpill.cs-has{border-color:color-mix(in srgb,var(--cs-accent) 40%,transparent);color:var(--cs-ink)}
.cs-hpill.cs-has .cs-hico{color:var(--cs-accent)}
.cs-hpill.cs-on{background:var(--cs-press)}

/* -------------------------------------------------- sidebar entry + badge */
[data-cs-entry]{display:flex;align-items:center;gap:8px;width:100%;margin:0;padding:7px 10px;border:none;border-radius:var(--cs-r2);background:transparent;color:inherit;font:inherit;font-size:13px;text-align:left;cursor:pointer;transition:background .16s var(--cs-ease)}
[data-cs-entry]:hover{background:var(--cs-hover,rgba(255,255,255,.055))}
[data-cs-entry]:active{background:var(--cs-press,rgba(255,255,255,.1))}
[data-cs-entry]:focus-visible{outline:1.5px solid var(--cs-accent,#4c8dff);outline-offset:-2px}
.cs-entry-ico{display:grid;place-items:center;flex:none;width:16px;height:16px;color:currentColor;opacity:.75}
.cs-entry-nm{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.cs-badge-n{display:flex;align-items:center;justify-content:center;flex:none;min-width:16px;height:16px;margin-left:auto;padding:0 4px;border-radius:var(--cs-rf);background:var(--cs-err);color:#fff;font-size:9.5px;font-weight:600;line-height:1;font-variant-numeric:tabular-nums}
/* icon scaling: one 16px drawing grid, rendered at the box the row gives it */
.cs-ico svg{width:12px;height:12px}
.cs-empty-ico svg{width:20px;height:20px}
.cs-entry-ico svg{width:15px;height:15px}

/* ------------------------------------------------------------- interaction */
.cs-btn:focus-visible,.cs-close:focus-visible,.cs-tab:focus-visible,.cs-ibtn:focus-visible,.cs-node:focus-visible,.cs-dgap:focus-visible{outline:1.5px solid var(--cs-accent);outline-offset:-1px}

/* --------------------------------------------------------- narrow columns */
@container (max-width:520px){
  .cs-hintkeys{display:none}
}
@container (max-width:400px){
  .cs-meta-n{display:none}
  .cs-acts{opacity:1}
  .cs-chg-path{font-size:11px}
}
@media (prefers-reduced-motion:reduce){
  .cs-root{animation:none}
  .cs-help{animation:none}
  .cs-status .cs-busy{animation:none}
  .cs-skel-row{animation:none}
  .cs-root *{transition-duration:.01ms !important}
}`;

		// ============================ diff view ============================
		const ROW_H = 18; // must match --cs-row in the stylesheet
		const MAX_DIFF_ROWS = 30000;
		function renderDiffRows(ops, start, path, onLineClick) {
			const out = [];
			const line = (no) => () => { if (onLineClick && no != null) onLineClick(no); };
			for (let i = 0; i < ops.length; i++) {
				const op = ops[i];
				const type = op.type;
				const sym = type === "add" ? "+" : type === "del" ? "−" : type === "mod" ? "~" : " ";
				const num = type === "del" ? op.oldNo : op.newNo;
				if (type === "mod" && op.side === "old" && ops[i + 1] && ops[i + 1].type === "mod" && ops[i + 1].side === "new") {
					const { oldSeg, newSeg } = wordSeg(op.text, ops[i + 1].text);
					const seg = (arr, cls) => el("span", null, arr.map((x, k2) => x.hit ? el("mark", { className: cls, key: k2 }, x.t) : x.t));
					out.push(el("div", { className: "cs-dline cs-mod", key: "a" + (start + i), onClick: line(ops[i + 1].newNo) },
						el("span", { className: "cs-dsym" }, "~"),
						el("span", { className: "cs-dnum" }, op.oldNo ?? ""),
						el("span", { className: "cs-dtxt" }, seg(oldSeg, "cs-wh-del"))
					));
					out.push(el("div", { className: "cs-dline cs-mod", key: "b" + (start + i), onClick: line(ops[i + 1].newNo) },
						el("span", { className: "cs-dsym" }, "~"),
						el("span", { className: "cs-dnum" }, ops[i + 1].newNo ?? ""),
						el("span", { className: "cs-dtxt" }, seg(newSeg, "cs-wh-add"))
					));
					i++;
					continue;
				}
				out.push(el("div", { className: "cs-dline cs-" + type, key: "r" + (start + i), onClick: line(num) },
					el("span", { className: "cs-dsym" }, sym),
					el("span", { className: "cs-dnum" }, num ?? ""),
					el("span", { className: "cs-dtxt" }, el(Highlighted, { text: op.text, path }))
				));
			}
			return out;
		}
		function DiffRows({ before, after, path, expanded, onLineClick }) {
			const ops = React.useMemo(() => mergeModified(lineDiff(before, after)), [before, after]);
			const [open, setOpen] = React.useState(false);
			const showAll = expanded === true || open;
			const blocks = React.useMemo(() => buildBlocks(ops), [ops]);
			const [scrollTop, setScrollTop] = React.useState(0);
			const [viewH, setViewH] = React.useState(420);
			const boxRef = React.useRef(null);
			React.useLayoutEffect(() => {
				const el2 = boxRef.current;
				if (el2) setViewH(el2.clientHeight || 420);
			}, [ops, open, showAll]);
			const rows = React.useMemo(() => {
				if (showAll) return renderDiffRows(ops, 0, path, onLineClick);
				const out = [];
				for (const block of blocks) {
					if (block.kind === "gap") {
						out.push(el("div", { className: "cs-dgap", key: "g" + out.length, onClick: () => setOpen(true) },
							el("span", null, "⋯ " + block.count + " 行未改动"),
							el("span", { className: "cs-dgbar" })
						));
					} else {
						out.push(...renderDiffRows(block.ops, out.length, path, onLineClick));
					}
				}
				return out;
			}, [blocks, ops, showAll, path, onLineClick]);
			const total = Math.min(rows.length, MAX_DIFF_ROWS);
			const onScroll = (e) => setScrollTop(e.currentTarget.scrollTop);
			const start = Math.max(0, Math.floor(scrollTop / ROW_H) - 12);
			const end = Math.min(total, Math.ceil((scrollTop + viewH) / ROW_H) + 12);
			return el("div", { className: "cs-chg-body", ref: boxRef, onScroll },
				total < rows.length ? el("div", { className: "cs-dgap", key: "limit" }, "⋯ 差异过大，仅显示前 " + total + " 行") : null,
				el("div", { key: "top", style: { height: start * ROW_H } }),
				rows.slice(start, end),
				el("div", { key: "bot", style: { height: (total - end) * ROW_H } })
			);
		}

		// ============================ file tree ============================
		const SKIP_DIRS = new Set(["node_modules", ".git", "build", "dist", ".gradle", ".idea", ".kotlin", "out", "target", "__pycache__", ".venv", "venv", ".cxx", ".gitlab"]);
		function FileTree({ root, selected, changed, onOpen }) {
			const [dirs, setDirs] = React.useState({});
			const [expanded, setExpanded] = React.useState({});
			React.useEffect(() => {
				setDirs({}); setExpanded({ [root]: true });
				// auto-load the root so it is immediately usable (no "click to expand" stall)
				if (root != null) {
					setDirs((prev) => ({ ...prev, [root]: null }));
					listDir(root).then((data) => setDirs((prev) => ({ ...prev, [root]: data.entries })))
						.catch(() => setDirs((prev) => ({ ...prev, [root]: [] })));
				}
			}, [root]);
			const loadDir = (path) => {
				setDirs((prev) => (path in prev ? prev : { ...prev, [path]: null }));
				listDir(path).then((data) => setDirs((prev) => ({ ...prev, [path]: data.entries })))
					.catch(() => setDirs((prev) => ({ ...prev, [path]: [] })));
			};
			const toggle = (path, isDir) => {
				if (!isDir) { onOpen(path); return; }
				const nextOpen = !expanded[path];
				setExpanded((prev) => ({ ...prev, [path]: nextOpen }));
				if (nextOpen && !(path in dirs)) loadDir(path);
			};
			const renderDir = (path, depth) => {
				if (path == null) return null;
				const base = String(path);
				const isOpen = !!expanded[path];
				const entries = dirs[path];
				const name = path === root ? (base.split(/[\\/]/).pop() || base) : base.split(/[\\/]/).pop();
				const rows = [];
				rows.push(el("div", {
					key: "d" + path, className: "cs-node" + (path === selected ? " cs-sel" : ""),
					style: { paddingLeft: 8 + depth * 13 },
					onClick: () => toggle(path, true)
				},
					el("span", { className: "cs-caret" }, isOpen ? "▾" : "▸"),
					el("span", { className: "cs-ico", dangerouslySetInnerHTML: { __html: ICON_FOLDER } }),
					el("span", { className: "cs-nm" }, name)
				));
				if (isOpen) {
					if (entries === null) rows.push(el("div", { key: "l" + path, className: "cs-node", style: { paddingLeft: 8 + (depth + 1) * 13, color: "var(--cs-ink4)" } }, "读取中"));
					else if (entries === void 0) rows.push(el("div", { key: "l" + path, className: "cs-node", style: { paddingLeft: 8 + (depth + 1) * 13, color: "var(--cs-ink4)" } }, "点开这一层"));
					else for (const entry of entries) {
						if (entry.type === "dir" && SKIP_DIRS.has(entry.name)) continue;
						if (entry.type === "dir") rows.push(el(React.Fragment, { key: entry.path }, renderDir(entry.path, depth + 1)));
						else rows.push(el("div", {
							key: entry.path, className: "cs-node cs-file" + (entry.path === selected ? " cs-sel" : ""),
							style: { paddingLeft: 8 + (depth + 1) * 13 },
							onClick: () => onOpen(entry.path)
						},
							el("span", { className: "cs-caret" }, ""),
							el("span", { className: "cs-ico", dangerouslySetInnerHTML: { __html: ICON_FILE } }),
							el("span", { className: "cs-nm" }, entry.name),
							changed.has(entry.path) ? el("span", { className: "cs-badge" }, "●") : null
						));
					}
				}
				return rows;
			};
			return el("div", { className: "cs-tree" }, renderDir(root, 0));
		}

		// ============================ editor (syntax highlighted overlay) ============================
		function Editor({ file, onEdit, onSave, onDiff, onSend, onHistory, scrollToLine }) {
			const scrollRef = React.useRef(null);
			const gutterRef = React.useRef(null);
			const hlRef = React.useRef(null);
			const taRef = React.useRef(null);
			const undoStack = React.useRef([]);
			const redoStack = React.useRef([]);
			const editingRef = React.useRef(false);
			const matchIdxRef = React.useRef(0);
			const [showFind, setShowFind] = React.useState(false);
			const [q, setQ] = React.useState("");
			const [r, setR] = React.useState("");
			const [matchCount, setMatchCount] = React.useState(0);
			const sync = (e) => {
				const el2 = e ? e.currentTarget : taRef.current;
				if (gutterRef.current) gutterRef.current.scrollTop = el2.scrollTop;
				if (hlRef.current) hlRef.current.scrollTop = el2.scrollTop;
			};
			React.useEffect(() => { sync(null); }, [file.content]);
			React.useEffect(() => {
				if (scrollToLine && file.content != null && scrollToLine.ts !== scrollRef.current) {
					const ta = taRef.current;
					if (ta) { ta.scrollTop = Math.max(0, (scrollToLine.line - 1) * 18.6); scrollRef.current = scrollToLine.ts; sync(null); }
				}
			}, [scrollToLine && scrollToLine.ts, file.content]);
			const handleEdit = (val) => {
				if (!editingRef.current && file.content != null) {
					undoStack.current.push(file.content);
					if (undoStack.current.length > 200) undoStack.current.shift();
					redoStack.current = [];
				}
				onEdit(val);
			};
			const undo = () => { const top = undoStack.current.pop(); if (top === undefined) return; redoStack.current.push(file.content); editingRef.current = true; onEdit(top); editingRef.current = false; };
			const redo = () => { const top = redoStack.current.pop(); if (top === undefined) return; undoStack.current.push(file.content); editingRef.current = true; onEdit(top); editingRef.current = false; };
			React.useEffect(() => {
				if (!showFind) return;
				const c = (file.content ?? "").toLowerCase(); const qu = q.toLowerCase();
				let n = 0, p = c.indexOf(qu);
				while (p !== -1) { n++; p = c.indexOf(qu, p + 1); }
				setMatchCount(n);
			}, [q, file.content, showFind]);
			const findJump = (dir) => {
				if (!q || file.content == null) return;
				const c = file.content.toLowerCase(); const qu = q.toLowerCase();
				const pos = [];
				let p = c.indexOf(qu);
				while (p !== -1) { pos.push(p); p = c.indexOf(qu, p + 1); }
				if (pos.length === 0) return;
				matchIdxRef.current = (matchIdxRef.current + dir + pos.length) % pos.length;
				const line = file.content.slice(0, pos[matchIdxRef.current]).split("\n").length;
				const ta = taRef.current;
				if (ta) { ta.scrollTop = Math.max(0, (line - 1) * 18.6); sync(null); }
			};
			const replaceAll = () => { if (!q || file.content == null) return; editingRef.current = true; onEdit(file.content.split(q).join(r)); editingRef.current = false; };
			React.useEffect(() => {
				const onKey = (e) => {
					if (e.target !== taRef.current) return;
					if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z" && !e.shiftKey) { e.preventDefault(); undo(); }
					else if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === "y" || (e.key.toLowerCase() === "z" && e.shiftKey))) { e.preventDefault(); redo(); }
					else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "f") { e.preventDefault(); setShowFind(true); }
				};
				window.addEventListener("keydown", onKey);
				return () => window.removeEventListener("keydown", onKey);
			});
			const lineCount = file.content == null ? 1 : file.content.split("\n").length;
			const gutter = [];
			for (let i = 1; i <= lineCount; i++) gutter.push(el("div", { className: "cs-gn", key: i }, String(i)));
			const stats = file.baseline != null && file.content != null ? fileStats(file.baseline, file.content) : null;
			const lines = (file.content ?? "").split("\n").map((line, i) =>
				el("div", { key: i, style: { minHeight: "1.55em" } }, el(Highlighted, { text: line, path: file.path }))
			);
			return el("div", { className: "cs-editor" },
				el("div", { className: "cs-filebar" },
					el("span", { className: "cs-fp", title: file.path }, file.path),
					file.dirty ? el("span", { className: "cs-dirty", title: "有未保存的修改" }, "未保存") : null,
					stats && (stats.adds > 0 || stats.dels > 0) ? el("span", { className: "cs-fstat" },
						stats.adds > 0 ? el("span", { className: "cs-plus" }, "+" + stats.adds) : null,
						stats.dels > 0 ? el("span", { className: "cs-minus" }, "−" + stats.dels) : null
					) : null
				),
				el("div", { className: "cs-edittools" },
					el("button", { className: "cs-ibtn", onClick: undo, disabled: undoStack.current.length === 0, title: "撤销 (Ctrl+Z)", "aria-label": "撤销" }, "↶"),
					el("button", { className: "cs-ibtn", onClick: redo, disabled: redoStack.current.length === 0, title: "重做 (Ctrl+Y)", "aria-label": "重做" }, "↷"),
					el("button", { className: "cs-btn", onClick: () => setShowFind(!showFind), title: "查找替换 (Ctrl+F)" }, "查找"),
					el("button", { className: "cs-btn", onClick: onDiff, title: "查看该文件的 Diff (Ctrl+D)" }, "Diff"),
					el("button", { className: "cs-btn", onClick: onHistory, title: "该文件的修改历史" }, "历史"),
					el("button", { className: "cs-btn", onClick: onSend, disabled: file.content == null, title: "把文件内容发送给当前会话的 Agent" }, "发送到会话"),
					el("button", { className: "cs-btn cs-pri", onClick: onSave, disabled: !file.dirty || file.content == null, title: "保存 (Ctrl+S)" }, "保存")
				),
				showFind ? el("div", { className: "cs-findbar" },
					el("input", { placeholder: "查找…", value: q, onChange: (e) => { setQ(e.target.value); matchIdxRef.current = 0; }, onKeyDown: (e) => { if (e.key === "Enter") findJump(e.shiftKey ? -1 : 1); }, spellCheck: false }),
					el("span", { className: "cs-findcnt" }, q ? String(matchCount) : ""),
					el("button", { className: "cs-btn", onClick: () => findJump(-1) }, "↑"),
					el("button", { className: "cs-btn", onClick: () => findJump(1) }, "↓"),
					el("input", { placeholder: "替换为…", value: r, onChange: (e) => setR(e.target.value), spellCheck: false }),
					el("button", { className: "cs-btn", onClick: replaceAll, disabled: !q || !r }, "全部替换")
				) : null,
				el("div", { className: "cs-edit-wrap" },
					el("div", { className: "cs-edit-g", ref: gutterRef }, gutter),
					el("div", { className: "cs-edit-overlay" },
						el("pre", { className: "cs-hl", ref: hlRef, "aria-hidden": "true" }, lines),
						el("textarea", { ref: taRef, className: "cs-ta", value: file.content ?? "", onChange: (e) => handleEdit(e.target.value), onScroll: sync, spellCheck: false, autoCapitalize: "off", autoCorrect: "off", placeholder: "" })
					)
				)
			);
		}
		// ============================ panel ============================
		function CodeStudioPanel() {
			const [open, setOpen] = React.useState(panel.open);
			const [tab, setTab] = React.useState("changes");
			// The change list and the connection state live in the shared `feed` store,
			// so the header pill and the panel always agree.
			const [changes, setChangesLocal] = React.useState(feed.changes);
			React.useEffect(() => subscribeFeed(() => setChangesLocal(feed.changes)), []);
			const [expandedPath, setExpandedPath] = React.useState(null);
			const [root, setRoot] = React.useState(null);
			// What the host resolved for the file browser: the recorded (stored) path and
			// whether it had to be re-anchored onto DSH's own drive (portable 随盘).
			const [rootInfo, setRootInfo] = React.useState(null);
			const [editor, setEditor] = React.useState(null);
			// connection state lives in the shared feed store (setConn/setConnText)
			const [, forceFeedRender] = React.useState(0);
			React.useEffect(() => subscribeFeed(() => forceFeedRender((n) => n + 1)), []);
			const conn = feed.conn;
			const connText = feed.connText;
			const [width, setWidth] = React.useState(() => {
				try {
					const saved = Number(globalThis.localStorage?.getItem("cs.panelWidth"));
					if (saved >= 280 && saved <= 900) return saved;
				} catch { /* ignore */ }
				return 400;
			});
			const [reverting, setReverting] = React.useState(null);
			const [histPath, setHistPath] = React.useState(null);
			const [histData, setHistData] = React.useState([]);
			const [histOpen, setHistOpen] = React.useState(null);
			const [filter, setFilter] = React.useState("");
			const [ftype, setFtype] = React.useState("all");
			const [workspaces, setWorkspaces] = React.useState([]);
			const [activeRoot, setActiveRoot] = React.useState(null);
			const [scrollTo, setScrollTo] = React.useState(null);
			const [selected, setSelected] = React.useState(new Set());
			const [reviewed, setReviewed] = React.useState(new Set());
			const [sort, setSort] = React.useState("ts");
			const [showHelp, setShowHelp] = React.useState(false);
			const dragRef = React.useRef(null);
			const changedSet = React.useMemo(() => new Set(changes.map((c) => c.path)), [changes]);
			// current session for per-session isolation
			const [sessId, setSessId] = React.useState(currentSessionId);
			const sessIdRef = React.useRef(currentSessionId);
			// per-session UI memory: save current snapshot on switch, restore target's
			const sessStatesRef = React.useRef(loadSessionStates());
			const snapRef = React.useRef({ changes, expandedPath, editor, tab, width, filter, ftype, activeRoot, reviewed });
			snapRef.current = { changes, expandedPath, editor, tab, width, filter, ftype, activeRoot, reviewed };
			React.useEffect(() => subscribeSession((v) => {
				const cur = sessIdRef.current;
				const switched = cur !== void 0 && cur !== null && cur !== v;
				if (switched) {
					sessStatesRef.current[cur] = snapRef.current;
					persistSessionStates(sessStatesRef.current);
					const sst = sessStatesRef.current[v];
					setChanges(sst ? (sst.changes ?? []) : []);
				}
				sessIdRef.current = v;
				setSessId(v);
				const st = sessStatesRef.current[v];
				// Strict isolation: per-session change lists. The list switches ONLY on a
				// real session switch; the first binding keeps the current list intact
				// (fixes "flashes then vanishes").
				if (st) {
					setExpandedPath(st.expandedPath ?? null);
					setEditor(st.editor ?? null);
					setTab(st.tab ?? "changes");
					setWidth(st.width ?? 400);
					setFilter(st.filter ?? "");
					setFtype(st.ftype ?? "all");
					setActiveRoot(st.activeRoot ?? null);
					setReviewed(st.reviewed ? new Set(st.reviewed) : new Set());
				} else {
					setExpandedPath(null); setEditor(null); setTab("changes");
					setFilter(""); setFtype("all"); setActiveRoot(null);
				}
			}), []);

			React.useEffect(() => subscribePanel((open) => {
				setOpen(open);
				if (open) { clearUnseen(badgeKey(sessIdRef.current)); }
			}), []);
			React.useEffect(() => {
				if (!sessIdRef.current) return;
				const t = setTimeout(() => {
					sessStatesRef.current[sessIdRef.current] = { ...snapRef.current };
					persistSessionStates(sessStatesRef.current);
				}, 900);
				return () => clearTimeout(t);
			}, [changes, reviewed, expandedPath, histPath]);
			React.useEffect(() => {
				const tagId = "@windypro-rourou/dsh-code-studio/styles";
				if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=\"" + tagId + "\"]") === null) {
					const tag = document.createElement("style");
					tag.dataset.plugin = "@windypro-rourou/dsh-code-studio";
					tag.dataset.pluginCss = tagId;
					tag.textContent = CSS;
					document.head.appendChild(tag);
				}
			}, []);
			React.useEffect(() => {
				const applyRoot = (d) => {
					setRoot(d.root);
					setRootInfo({ root: d.root, recorded: d.recorded ?? d.root, remapped: d.remapped === true, sessionMissing: d.sessionMissing === true, exists: d.exists !== false });
					setActiveRoot((prev) => prev ?? d.root);
				};
				getRoot().then(applyRoot).catch((e) => { setConn("err"); setConnText(String(e.message)); });
				api("/workspaces").then((d) => setWorkspaces(d.workspaces ?? [])).catch(() => {});
			}, []);
			// 0.2: the project directory follows the session. Re-resolve on every
			// session switch so the file browser never shows the previous project
			// (or, worse, the desktop profile folder the host process runs in).
			React.useEffect(() => subscribeSession(() => {
				getRoot().then((d) => {
					setRoot(d.root);
					setRootInfo({ root: d.root, recorded: d.recorded ?? d.root, remapped: d.remapped === true, sessionMissing: d.sessionMissing === true, exists: d.exists !== false });
					setActiveRoot((prev) => prev ?? d.root);
				}).catch(() => {});
				api("/workspaces").then((d) => setWorkspaces(d.workspaces ?? [])).catch(() => {});
			}), []);

			// SSE change feed (shared: a headless feed entry keeps it alive while the
			// right-sidebar tab is closed, so the header pill keeps counting).
			React.useEffect(() => startChangeFeed(), []);

			// keyboard: Ctrl+Alt+C toggle panel, Alt+↓/↑ jump changes, Ctrl+S save, Ctrl+D diff
			React.useEffect(() => {
				const onKey = (e) => {
					// Esc always closes the panel: the reliable way out when the ✕ sits
					// under the desktop window's caption band or the window is narrow.
					if (e.key === "Escape" && panel.open) {
						e.preventDefault();
						setPanelOpen(false);
						return;
					}
					if (e.key === "?" && !(e.target && (e.target.tagName === "TEXTAREA" || e.target.tagName === "INPUT" || e.target.isContentEditable))) {
						e.preventDefault();
						setShowHelp(!showHelp);
						return;
					}
					if ((e.ctrlKey || e.metaKey) && e.altKey && (e.key === "c" || e.key === "C")) {
						e.preventDefault();
						setPanelOpen(!panel.open);
						return;
					}
					if (e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
						const t = e.target;
						if (t && (t.tagName === "TEXTAREA" || t.tagName === "INPUT" || t.isContentEditable)) return;
						e.preventDefault();
						stepChange(e.key === "ArrowDown" ? 1 : -1);
						return;
					}
					if (!editor) return;
					if ((e.ctrlKey || e.metaKey) && e.key === "s") { e.preventDefault(); void saveCurrent(); }
					if ((e.ctrlKey || e.metaKey) && e.key === "d") { e.preventDefault(); viewDiff(editor.path); }
				};
				window.addEventListener("keydown", onKey);
				return () => window.removeEventListener("keydown", onKey);
			});

			const openFile = (path) => {
				if (editor && editor.dirty && editor.path !== path && typeof globalThis.confirm === "function" && !globalThis.confirm("当前文件有未保存的修改，放弃修改并打开其他文件？")) return;
				setEditor({ path, content: null, baseline: null, dirty: false, loading: true });
				setTab("files");
				readFile(path).then((data) => {
					setEditor((prev) => prev && prev.path === path ? { path, content: data.content, baseline: data.content, dirty: false, loading: false } : prev);
				}).catch((e) => {
					setEditor((prev) => prev && prev.path === path ? { path, content: null, baseline: null, dirty: false, loading: false, error: String(e.message) } : prev);
				});
			};
			const openEditorAt = (path, line) => { setTab("files"); openFile(path); setScrollTo({ path, line, ts: Date.now() }); };
			const editContent = (content) => setEditor((prev) => prev ? { ...prev, content, dirty: true } : prev);
			const saveCurrent = async () => {
				if (!editor || editor.content == null) return;
				setConn("busy"); setConnText("保存中…");
				try {
					await writeFile(editor.path, editor.content);
					setEditor((prev) => prev ? { ...prev, baseline: prev.content, dirty: false } : prev);
					setConn("ok"); setConnText("已保存 " + new Date().toLocaleTimeString());
				} catch (e) {
					setConn("err"); setConnText("保存失败: " + e.message);
				}
			};
			const viewDiff = (path) => {
				setTab("changes");
				setExpandedPath(path);
				historyApi(path).then((data) => {
					const events = data.events && data.events.length > 0 ? data.events : [];
					if (events.length === 0) return;
					// prefer the latest event owned by the active session; fall back to the latest overall
					let last = events[events.length - 1];
					for (let i = events.length - 1; i >= 0; i--) {
						if (events[i].sessionId && events[i].sessionId === sessIdRef.current) { last = events[i]; break; }
					}
					const name = path.split(/[\\/]/).pop() || path;
					setChanges((prev) => {
						if (prev.some((c) => c.path === path)) return prev;
						return [{ path, name, before: last.before, after: last.after, deleted: !!last.deleted, ts: last.ts, sessionId: last.sessionId }, ...prev];
					});
				}).catch(() => {});
			};
			const clearChanges = () => setChanges([]);
			const revertChange = async (path, quiet) => {
				if (!quiet && (typeof globalThis.confirm !== "function" || !globalThis.confirm("还原将撤销 Agent 在本会话内对该文件的全部修改（若期间有外部改动会被覆盖）。确定还原？"))) return;
				setReverting(path);
				setConn("busy"); setConnText("还原中…");
				try {
					const r = await api("/revert", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ path }) });
					setConn("ok"); setConnText(r.conflict ? "已还原（检测到外部修改，已覆盖）" : "已还原 " + new Date().toLocaleTimeString());
				} catch (e) {
					setConn("err"); setConnText("还原失败: " + e.message);
				} finally { setReverting(null); }
			};
			const openHistory = (path) => {
				setHistPath(path); setHistData([]); setHistOpen(null);
				historyApi(path).then((d) => setHistData(d.events ?? [])).catch(() => setHistData([]));
			};
			const toggleSel = (p) => setSelected((prev) => { const n = new Set(prev); if (n.has(p)) n.delete(p); else n.add(p); return n; });
			const toggleReviewed = (p) => setReviewed((prev) => { const n = new Set(prev); if (n.has(p)) n.delete(p); else n.add(p); return n; });
			const batchRevert = async () => { for (const p of [...selected]) await revertChange(p, true); setSelected(new Set()); };
			const batchClear = () => { setChanges((prev) => prev.filter((c) => !selected.has(c.path))); setSelected(new Set()); };
			const sendToChat = async (path, content) => {
				if (content == null) return;
				const text = "我在 Code Studio 中打开了文件 " + path + "，内容如下：\n\n```\n" + content + "\n```";
				try {
					const sessions = ctxRef && typeof ctxRef.get === "function" ? ctxRef.get("sessions") : void 0;
					const face = sessions && typeof sessions.binding === "function" ? sessions.binding(sessIdRef.current)?.session : void 0;
					if (face && typeof face.prompt === "function") {
						setConn("busy"); setConnText("发送到会话…");
						await face.prompt([{ type: "text", text }], "queue");
						setConn("ok"); setConnText("已发送到会话");
						return;
					}
				} catch (e) {
					setConn("err"); setConnText("发送失败: " + e.message);
					return;
				}
				try {
					await navigator.clipboard.writeText(text);
					setConn("ok"); setConnText("已复制到剪贴板（自动发送不可用）");
				} catch {
					setConn("err"); setConnText("无法发送");
				}
			};
			const stepChange = (dir) => {
				if (changes.length === 0) return;
				const idx = changes.findIndex((c) => c.path === expandedPath);
				const from = idx < 0 ? (dir > 0 ? -1 : 0) : idx;
				const next = changes[Math.max(0, Math.min(changes.length - 1, from + dir))];
				if (!next) return;
				setExpandedPath(next.path);
				const node = document.querySelector('[data-cs-chg="' + (globalThis.CSS && globalThis.CSS.escape ? globalThis.CSS.escape(next.path) : next.path) + '"]');
				if (node) node.scrollIntoView({ block: "center", behavior: "smooth" });
			};
			const shownChanges = React.useMemo(() => {
				const q = filter.trim().toLowerCase();
				const list = changes.filter((c) => {
					if (q && !c.path.toLowerCase().includes(q) && !c.name.toLowerCase().includes(q)) return false;
					if (ftype !== "all" && extType(extOf(c.path)) !== ftype) return false;
					return true;
				});
				if (sort === "name") list.sort((a, b) => a.name.localeCompare(b.name));
				else if (sort === "delta") { const d = (c) => (c.deleted ? 0 : fileStats(c.before, c.after).adds + fileStats(c.before, c.after).dels); list.sort((a, b) => d(b) - d(a)); }
				else list.sort((a, b) => (b.ts ?? 0) - (a.ts ?? 0));
				return list;
			}, [changes, filter, ftype, sort]);

			// Publish this session's digest for the header pill (works while the panel is closed).
			React.useEffect(() => {
				const files = changes.map((c) => {
					const s = c.deleted ? { adds: 0, dels: 0 } : fileStats(c.before, c.after);
					return { path: c.path, adds: s.adds, dels: s.dels };
				});
				publishSummary({
					count: changes.length,
					adds: files.reduce((a, x) => a + x.adds, 0),
					dels: files.reduce((a, x) => a + x.dels, 0),
					files,
					sessionId: sessId ?? null
				});
			}, [changes, sessId]);

			// Header menu picked one file: reveal it in the changes list.
			React.useEffect(() => subscribeFocus((path) => {
				setTab("changes");
				setExpandedPath(path);
			}), []);

			// drag to resize
			const onResizeDown = (e) => {
				dragRef.current = { x: e.clientX, w: width };
				e.currentTarget.setPointerCapture(e.pointerId);
				e.currentTarget.classList.add("cs-drag");
			};
			const onResizeMove = (e) => {
				if (!dragRef.current) return;
				const next = Math.min(900, Math.max(280, dragRef.current.w + (dragRef.current.x - e.clientX)));
				setWidth(next);
			};
			const onResizeUp = (e) => {
				if (!dragRef.current) return;
				dragRef.current = null;
				e.currentTarget.classList.remove("cs-drag");
				if (sessIdRef.current) {
					sessStatesRef.current[sessIdRef.current] = { ...snapRef.current, width };
					persistSessionStates(sessStatesRef.current);
				}
			};

			const renderChangesTab = () => {
				if (histPath) {
					return el("div", { className: "cs-files" },
						el("div", { className: "cs-hist-back" },
							el("button", { className: "cs-btn", onClick: () => setHistPath(null) }, "← 返回变更"),
							el("span", { className: "cs-fp" }, histPath)
						),
						el("div", { className: "cs-chg-list" },
							histData.length === 0
								? el("div", { className: "cs-empty" }, "暂无历史记录")
								: histData.map((ev, i) => {
									const stats = ev.deleted ? { adds: 0, dels: 0 } : fileStats(ev.before, ev.after);
									const tag = ev.source === "revert"
										? el("span", { className: "cs-hist-tag cs-rev2" }, "还原")
										: ev.source === "user"
											? el("span", { className: "cs-hist-tag cs-usr" }, "用户")
											: el("span", { className: "cs-hist-tag cs-src" }, "Agent");
									const isOpen = histOpen === i;
									return el("div", { className: "cs-hist-item", key: i },
										el("div", { className: "cs-hist-row", onClick: () => setHistOpen(isOpen ? null : i) },
											el("span", { className: "cs-caret" }, isOpen ? "▾" : "▸"),
											tag,
											el("span", { style: { color: "var(--dsw-alias-label-tertiary)" } }, new Date(ev.ts).toLocaleTimeString()),
											el("span", { className: "cs-plus" }, "+" + stats.adds),
											el("span", { className: "cs-minus" }, "−" + stats.dels)
										),
										isOpen ? el(DiffRows, { before: ev.before, after: ev.after, path: histPath }) : null
									);
								})
						)
					);
				}
				if (changes.length === 0) {
					return el("div", { className: "cs-empty" },
						el("div", { className: "cs-empty-ico", dangerouslySetInnerHTML: { __html: ICON_SPARK } }),
						el("div", { className: "cs-empty-title" }, "暂无文件变更"),
						el("span", { className: "cs-hint" },
							"Agent 改动文件时，这里会立刻浮现逐行 Diff：",
							el("span", { className: "cs-plus" }, " + 新增"),
							el("span", { className: "cs-minus" }, " − 删除"),
							el("span", { style: { color: "var(--cs-warn)" } }, " ~ 修改")
						),
						el("div", { className: "cs-hintkeys", style: { marginLeft: 0, marginTop: 2 } },
							el("span", { className: "cs-kbd" }, "Ctrl+Alt+C"), "开关面板",
							el("span", { className: "cs-kbd" }, "Alt+↓/↑"), "跳转变更"
						)
					);
				}
				const summary = shownChanges.reduce((acc, c) => { const s = c.deleted ? { adds: 0, dels: 0 } : fileStats(c.before, c.after); return { adds: acc.adds + s.adds, dels: acc.dels + s.dels }; }, { adds: 0, dels: 0 });
				return el("div", { className: "cs-files" },
					el("div", { className: "cs-filter" },
						el("input", { placeholder: "搜索路径…", value: filter, onChange: (e) => setFilter(e.target.value), spellCheck: false }),
						el("select", { value: ftype, onChange: (e) => setFtype(e.target.value) },
							el("option", { value: "all" }, "全部"),
							el("option", { value: "code" }, "代码"),
							el("option", { value: "doc" }, "文档"),
							el("option", { value: "conf" }, "配置"),
							el("option", { value: "other" }, "其他")
						),
						el("span", { className: "cs-meta", title: "当前筛选下的行增删与文件数" },
							summary.adds > 0 ? el("span", { className: "cs-plus" }, "+" + summary.adds) : null,
							summary.dels > 0 ? el("span", { className: "cs-minus" }, "−" + summary.dels) : null,
							el("span", { className: "cs-meta-n" }, shownChanges.length + " 个文件")
						)
					),
					el("div", { className: "cs-chg-list" },
						shownChanges.length === 0
							? el("div", { className: "cs-empty" },
								el("div", { className: "cs-empty-ico", dangerouslySetInnerHTML: { __html: ICON_FILTER } }),
								el("div", { className: "cs-empty-title" }, "没有匹配的变更"),
								el("span", { className: "cs-hint" }, "换个关键词，或把类型筛选切回「全部」")
							)
							: shownChanges.map((c) => {
								const stats = c.deleted ? { adds: 0, dels: 0 } : fileStats(c.before, c.after);
								const isOpen = expandedPath === c.path;
								const isSel = selected.has(c.path);
								const isRev = reviewed.has(c.path);
								return el("div", { className: "cs-chg", key: c.path, "data-cs-chg": c.path },
									el("div", {
										className: "cs-chg-row" + (isOpen ? " cs-open" : ""),
										onClick: () => setExpandedPath(isOpen ? null : c.path)
									},
										el("input", { type: "checkbox", className: "cs-sel", checked: isSel, onClick: (e) => e.stopPropagation(), onChange: () => toggleSel(c.path), title: "选中以批量操作" }),
										el("span", { className: "cs-caret" }, isOpen ? "▾" : "▸"),
										el("span", { className: "cs-chg-path" }, c.name,
											c.deleted ? el("span", { className: "cs-bad cs-bad-del" }, "删除")
												: c.before == null ? el("span", { className: "cs-bad cs-bad-add" }, "新建")
												: null, isRev ? el("span", { className: "cs-bad cs-bad-rev" }, "已审") : null,
											c.sessionId && c.sessionId !== sessIdRef.current ? el("span", { className: "cs-sess-tag" }, String(c.sessionId).slice(-6)) : null
										),
										el("span", { className: "cs-fstat" },
											stats.adds > 0 ? el("span", { className: "cs-plus", title: stats.adds + " 行新增" }, "+" + stats.adds) : null,
											stats.dels > 0 ? el("span", { className: "cs-minus", title: stats.dels + " 行删除" }, "−" + stats.dels) : null,
											stats.adds === 0 && stats.dels === 0 ? el("span", { className: "cs-zero" }, "0") : null
										),
										el("span", { className: "cs-acts" },
											el("button", { className: "cs-ibtn" + (isRev ? " cs-on" : ""), title: isRev ? "取消「已审阅」标记" : "标记为已审阅", "aria-label": "标记为已审阅", onClick: (e) => { e.stopPropagation(); toggleReviewed(c.path); } }, "✓"),
											el("button", { className: "cs-ibtn", title: "还原为该会话 Agent 修改前的版本", "aria-label": "还原", disabled: reverting === c.path, onClick: (e) => { e.stopPropagation(); void revertChange(c.path); } }, "↩"),
											el("button", { className: "cs-ibtn", title: "该文件的修改历史", "aria-label": "历史", onClick: (e) => { e.stopPropagation(); openHistory(c.path); } }, "◷")
										)
									),
									isOpen ? (c.deleted
										? el("div", { className: "cs-chg-body" },
											el("div", { className: "cs-empty" },
												el("div", { className: "cs-empty-ico", dangerouslySetInnerHTML: { __html: ICON_TRASH } }),
												el("div", { className: "cs-empty-title" }, "文件已被删除"),
												el("span", { className: "cs-hint" }, "点「还原」可把它恢复成 Agent 动手前的版本")
											))
										: el(DiffRows, { before: c.before, after: c.after, path: c.path, onLineClick: (line) => openEditorAt(c.path, line) })
									) : null
								);
							})),
						el("div", { className: "cs-footbar" },
							el("span", { className: "cs-foot-note" }, "已审阅 " + reviewed.size + " / " + changes.length),
							el("span", { className: "cs-foot-acts" },
								selected.size > 0 ? el("button", { className: "cs-btn", onClick: () => void batchRevert() }, "还原所选 " + selected.size) : null,
								selected.size > 0 ? el("button", { className: "cs-btn", onClick: batchClear }, "移除所选") : null,
								el("button", { className: "cs-btn", onClick: clearChanges, title: "只清空面板列表，不动磁盘文件" }, "清空列表")
							)
						)
				);
			};
			const renderFilesTab = () => {
				const info = rootInfo;
				const activeExists = workspaces.find((w) => w.path === (activeRoot ?? root))?.exists !== false;
				return el("div", { className: "cs-files" },
					el("div", { className: "cs-ws-bar" },
						el("span", null, "工作区"),
						el("select", { value: activeRoot ?? "", onChange: (e) => setActiveRoot(e.target.value) },
							(workspaces.length === 0 ? [{ path: root, label: root ?? "…", sessionCount: 0, exists: true }] : workspaces).map((w) =>
								el("option", { value: w.path, key: w.path },
									w.label + (w.sessionCount ? " (" + w.sessionCount + " 会话)" : "") + (w.exists === false ? "（目录不存在）" : ""))
							)
						)
					),
					info !== null && info.remapped ? el("div", { className: "cs-note" },
						"随盘：盘符已改变，路径按同盘规则改写到 " + info.root,
						el("span", { className: "cs-note-sub" }, "（记录的是 " + info.recorded + "）")
					) : null,
					info !== null && info.sessionMissing ? el("div", { className: "cs-note cs-note-warn" },
						"该会话记录的项目目录不存在，已回退到 " + info.root,
						el("span", { className: "cs-note-sub" }, "记录的是 " + info.recorded + "；换盘符后请运行「整理工作区分组.cmd」")
					) : null,
					info !== null && info.exists === false ? el("div", { className: "cs-note cs-note-warn" },
						"目录不存在：" + info.root,
						el("span", { className: "cs-note-sub" }, "换盘符后请先运行「整理工作区分组.cmd」，或在上方切换到其它工作区")
					) : null,
					(activeRoot ?? root) && activeExists ? el(FileTree, { root: activeRoot ?? root, selected: editor?.path, changed: changedSet, onOpen: openFile })
						: el("div", { className: "cs-empty" },
							el("div", { className: "cs-empty-ico", dangerouslySetInnerHTML: { __html: (activeRoot ?? root) ? ICON_WARN : ICON_FOLDER } }),
							el("div", { className: "cs-empty-title" }, (activeRoot ?? root) ? "工作区目录不存在" : "正在读取工作区"),
							el("span", { className: "cs-hint" }, (activeRoot ?? root) ? "见上方提示；换盘符后请先运行「整理工作区分组.cmd」" : "会话的项目目录就绪后会自动列出文件")),
					editor ? (
						editor.loading ? el("div", { className: "cs-skel" },
							el("div", { className: "cs-skel-row", style: { width: "92%" } }),
							el("div", { className: "cs-skel-row", style: { width: "78%" } }),
							el("div", { className: "cs-skel-row", style: { width: "86%" } }),
							el("div", { className: "cs-skel-row", style: { width: "64%" } }))
						: editor.error ? el("div", { className: "cs-empty" },
							el("div", { className: "cs-empty-ico", dangerouslySetInnerHTML: { __html: ICON_WARN } }),
							el("div", { className: "cs-empty-title" }, "打开文件失败"),
							el("span", { className: "cs-hint" }, String(editor.error)))
						: el(Editor, { file: editor, onEdit: editContent, onSave: () => void saveCurrent(), onDiff: () => viewDiff(editor.path), onSend: () => void sendToChat(editor.path, editor.content), onHistory: () => { viewDiff(editor.path); openHistory(editor.path); }, scrollToLine: scrollTo && scrollTo.path === editor.path ? scrollTo : null })
					) : el("div", { className: "cs-empty" },
						el("div", { className: "cs-empty-ico", dangerouslySetInnerHTML: { __html: ICON_FILE } }),
						el("div", { className: "cs-empty-title" }, "选一个文件开始编辑"),
						el("span", { className: "cs-hint" }, "在上方文件树里点开文件即可编辑"),
						el("div", { className: "cs-hintkeys", style: { marginLeft: 0, marginTop: 2 } },
							el("span", { className: "cs-kbd" }, "Ctrl+S"), "保存",
							el("span", { className: "cs-kbd" }, "Ctrl+D"), "看 Diff")
					)
				);
			};
			// The panel renders nothing while closed: the session-header pill is its entry
			// point (the old floating bottom-right badge collided with the composer bar).
			if (!open) return null;

			const body = el("div", { className: "cs-root", style: { width } },
				el("div", {
					className: "cs-resize", onPointerDown: onResizeDown, onPointerMove: onResizeMove, onPointerUp: onResizeUp,
					title: "拖拽调整宽度"
				}),
				// one chrome bar: title, the segmented tabs, close. Every extra bar
				// here is vertical space the diff list never gets back.
				el("div", { className: "cs-head" },
					el("span", { className: "cs-title" }, "Code Studio"),
					el("div", { className: "cs-tabs" },
						el("div", { className: "cs-tab" + (tab === "changes" ? " cs-on" : ""), onClick: () => setTab("changes") }, "变更"),
						el("div", { className: "cs-tab" + (tab === "files" ? " cs-on" : ""), onClick: () => setTab("files") }, "文件")
					),
					el("button", {
						className: "cs-close",
						onClick: () => setPanelOpen(false),
						title: "关闭面板 · Esc",
						"aria-label": "关闭 Code Studio 面板"
					}, "✕")
				),
				el("div", { className: "cs-body" },
					tab === "changes" ? renderChangesTab() : renderFilesTab()
				),
				el("div", { className: "cs-status" },
					el("span", { className: "cs-sdot cs-" + conn, title: connText }),
					el("span", null, connText),
					el("span", { className: "cs-hintkeys" },
						el("span", { className: "cs-kbd" }, "Ctrl+Alt+C"), "面板",
						el("span", { className: "cs-kbd" }, "Alt+↓/↑"), "跳转"),
					el("button", { className: "cs-btn", onClick: () => setShowHelp(!showHelp), title: "快捷键帮助 (?)" }, "?")
				),
				showHelp ? el("div", { className: "cs-help", onClick: () => setShowHelp(false) },
					el("div", { className: "cs-help-card", onClick: (e) => e.stopPropagation() },
						el("div", { className: "cs-help-title" }, "快捷键"),
						el("div", { className: "cs-help-row" }, el("span", { className: "cs-kbd" }, "Ctrl+Alt+C"), "开关面板"),
						el("div", { className: "cs-help-row" }, el("span", { className: "cs-kbd" }, "Esc"), "关闭面板"),
						el("div", { className: "cs-help-row" }, el("span", { className: "cs-kbd" }, "Alt+↓/↑"), "在变更间跳转"),
						el("div", { className: "cs-help-row" }, el("span", { className: "cs-kbd" }, "Ctrl+S"), "保存当前文件"),
						el("div", { className: "cs-help-row" }, el("span", { className: "cs-kbd" }, "Ctrl+D"), "查看当前文件 Diff"),
						el("div", { className: "cs-help-row" }, el("span", { className: "cs-kbd" }, "Ctrl+F"), "查找替换"),
						el("div", { className: "cs-help-row" }, el("span", { className: "cs-kbd" }, "Ctrl+Z / Ctrl+Y"), "撤销 / 重做"),
						el("div", { className: "cs-help-row" }, el("span", { className: "cs-kbd" }, "?"), "打开此帮助")
					)
				) : null
			);
			return body;
		}

		// ============================ DSH 0.2 right-sidebar tab ============================
		// ============================ session header pill ============================
		// The change feed lives in the conversation header (right next to the host's own
		// utilities, above the chat) instead of floating over the composer.
		const HEAD_ICON = "<svg viewBox=\"0 0 16 16\" width=\"14\" height=\"14\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.3\" stroke-linecap=\"round\" stroke-linejoin=\"round\" aria-hidden=\"true\"><path d=\"M5.5 4.5 3 7l2.5 2.5M10.5 4.5 13 7l-2.5 2.5M9 3l-2 8\"/></svg>";
		function shortChangePath(path, max) {
			const parts = String(path).split(/[\\/]/).filter(Boolean);
			const name = parts.pop() ?? String(path);
			const parent = parts.pop();
			const label = parent ? parent + "/" + name : name;
			const cap = max ?? 44;
			return label.length > cap ? "…" + label.slice(-cap) : label;
		}
		function HeaderChanges() {
			const [snap, setSnap] = React.useState(() => ({ count: summary.count, adds: summary.adds, dels: summary.dels, files: summary.files }));
			const [open, setOpen] = React.useState(panel.open);
			const [menuOpen, setMenuOpen] = React.useState(false);
			const [unseenN, setUnseenN] = React.useState(() => unseenCount(badgeKey(currentSessionId)));
			React.useEffect(() => {
				const sync = () => {
					setSnap({ count: summary.count, adds: summary.adds, dels: summary.dels, files: summary.files });
					setUnseenN(unseenCount(badgeKey(currentSessionId)));
				};
				const un1 = subscribeSummary(sync);
				const un2 = subscribePanel((v) => { setOpen(v); sync(); });
				const un3 = subscribeSession(sync);
				const un4 = subscribeBadge(sync);
				sync();
				return () => { un1(); un2(); un3(); un4(); };
			}, []);
			const has = snap.count > 0;
			const files = snap.files.slice(0, 12);
			const tip = has
				? "Code Studio · 本会话有 " + snap.count + " 个文件变更（点击开关面板）"
				: "Code Studio · 本会话暂无文件变更（点击打开面板）";
			const glyph = ICON_CODE !== null
				? el(ICON_CODE, { size: 14 })
				: el("span", { className: "cs-hico-svg", dangerouslySetInnerHTML: { __html: HEAD_ICON } });
			const pill = el("div", {
				className: "cs-hpill" + (has ? " cs-has" : "") + (open ? " cs-on" : ""),
				"data-dsh-plugin": "code-studio",
				"data-dsh-part": "header-changes"
			},
				el("button", {
					type: "button",
					className: "cs-hpill-main",
					title: tip,
					"aria-label": tip,
					onClick: () => setPanelOpen(!panel.open)
				},
					el("span", { className: "cs-hico" }, glyph),
					has
						? el("span", { className: "cs-hlabel" }, snap.count + " 个文件已变更")
						: el("span", { className: "cs-hlabel cs-hidle" }, "Code Studio"),
					has ? el("span", { className: "cs-hdelta" },
						el("span", { className: "cs-plus" }, "+" + snap.adds),
						el("span", { className: "cs-minus" }, "−" + snap.dels)
					) : null,
					unseenN > 0 && !open ? el("span", { className: "cs-hdot" }) : null
				),
				el("button", {
					type: "button",
					className: "cs-hpill-more",
					title: "变更文件列表",
					"aria-haspopup": "menu",
					"aria-expanded": menuOpen,
					onClick: () => { if (dsMenu !== null) setMenuOpen((v) => !v); else setPanelOpen(true); }
				}, ICON_CHEVRON !== null ? el(ICON_CHEVRON, { size: 11 }) : el("span", { className: "cs-hchev" }, "⌄"))
			);
			if (dsMenu === null) return pill;
			const items = files.length === 0
				? [{ id: "__none", label: "本会话暂无文件变更" }]
				: files.map((x) => ({ id: x.path, label: shortChangePath(x.path) + "   +" + x.adds + " −" + x.dels }));
			items.push({ type: "separator" }, { id: "__panel", label: open ? "关闭 Code Studio 面板" : "打开 Code Studio 面板" });
			return el(dsMenu, {
				open: menuOpen,
				anchor: pill,
				align: "end",
				dense: true,
				onClose: () => setMenuOpen(false),
				items,
				onSelect: (id) => {
					setMenuOpen(false);
					if (id === "__none") return;
					if (id === "__panel") { setPanelOpen(!panel.open); return; }
					focusChange(id);
				}
			});
		}

		// ============================ sidebar entry ============================
		const ENTRY_SELECTOR = "[data-cs-entry]";
		const ENTRY_VERSION = "6";
		let badgeEl = null;
		function updateBadge() {
			if (badgeEl === null) return;
			const n = panel.open ? 0 : unseenCount(badgeKey(currentSessionId));
			if (n > 0) {
				badgeEl.textContent = n > 99 ? "99+" : String(n);
				badgeEl.style.display = "flex";
			} else {
				badgeEl.style.display = "none";
			}
		}
		const ENTRY_ICON = "<svg viewBox=\"0 0 16 16\" width=\"15\" height=\"15\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.3\" stroke-linecap=\"round\" stroke-linejoin=\"round\" aria-hidden=\"true\"><path d=\"M4 1.5h6l2.5 2.5v10.5a.5.5 0 0 1-.5.5H4a.5.5 0 0 1-.5-.5V2a.5.5 0 0 1 .5-.5z\"/><path d=\"M4 6h8M4 9h8M4 12h5\"/></svg>";
		function sidebarRoot() {
			const column = document.querySelector("[data-pane=\"sidebar\"], [class*=\"sidebarCol\"]");
			if (column === null) return void 0;
			return column.querySelector("[class*=\"logoRow\"]")?.parentElement ?? column.firstElementChild;
		}
		function newSessionButton(root) {
			const nested = root.querySelector("button[class*=\"newSession\"]");
			if (nested !== null) return nested;
			for (const child of root.children) if (child.tagName === "BUTTON") return child;
		}
		function mountSidebarEntry() {
			if (typeof document === "undefined") return () => {};
			const existing = document.querySelector(ENTRY_SELECTOR);
			if (existing !== null) {
				if (existing.getAttribute("data-cs-ver") === ENTRY_VERSION) return () => {};
				existing.remove();
			}
			const entry = document.createElement("button");
			entry.type = "button";
			entry.setAttribute("data-cs-entry", "");
			entry.setAttribute("data-cs-ver", ENTRY_VERSION);
			entry.setAttribute("data-dsh-plugin", "code-studio");
			entry.setAttribute("data-dsh-part", "sidebar-entry");
			entry.title = "Code Studio · 代码编辑与 Diff（拖拽面板左缘可调宽）";
			entry.innerHTML = "<span class=\"cs-entry-ico\">" + ENTRY_ICON + "</span><span class=\"cs-entry-nm\">Code Studio</span><span data-cs-badge class=\"cs-badge-n\" style=\"display:none\"></span>";
			entry.style.cssText = "";
			entry.addEventListener("click", () => setPanelOpen(!panel.open));
			let root;
			let placed = false;
			const place = () => {
				if (root !== void 0 && !root.isConnected) { root = void 0; placed = false; }
				if (placed && document.body.contains(entry)) return;
				root ??= sidebarRoot();
				if (root === void 0) return;
				const button = newSessionButton(root);
				if (button === void 0) return;
				root.insertBefore(entry, button.nextElementSibling);
				placed = true;
			};
			const observer = new MutationObserver(place);
			observer.observe(document.body, { childList: true, subtree: true });
			place();
			badgeEl = entry.querySelector("[data-cs-badge]");
			const unBadge = subscribeBadge(updateBadge);
			const unPanel = subscribePanel(updateBadge);
			const unSess = subscribeSession(updateBadge);
			updateBadge();
			return () => {
				observer.disconnect();
				entry.remove();
				unBadge(); unPanel(); unSess();
				badgeEl = null;
			};
		}

		// ============================ apply ============================
		let mounted = false;
		function apply(ctx) {
			if (mounted) return;
			mounted = true;
			ctxRef = ctx;
			ctx.effect(() => {
				const disposers = [];
				let legacySidebar = true;
				// track the active session so the panel only reacts to this session's edits
				try {
					const sessions = ctx.get("sessions");
					if (sessions && typeof sessions.list?.getSnapshot === "function" && typeof sessions.list.subscribe === "function") {
						const sync = () => { try { setSessionId(sessions.list.getSnapshot()?.current ?? null); } catch { /* ignore */ } };
						disposers.push(sessions.list.subscribe(sync));
						sync();
					}
				} catch (error) {
					console.error("[code-studio] session tracking failed", error);
				}
				try {
					const slots = ctx.get("slots");
					if (slots === void 0) {
						console.error("[code-studio] slots service unavailable");
					} else {
						// Digest pill in the conversation header, next to the host utilities
						// (same slot id in 0.1.x and 0.2).
						try {
							disposers.push(slots.inject("conversation.session.header.utilities", () => slots.register(
								{ name: "conversation.session.header.utilities", id: "code-studio-changes", order: 20 },
								HeaderChanges
							)));
						} catch (error) {
							console.error("[code-studio] header pill slot failed", error);
						}
						// The panel itself: the shell's overlay layer, so it floats over the
						// right edge of the conversation (drag the left edge to resize, ✕ to
						// hide) — the same surface in 0.1.x and 0.2. `shell.overlay` is a list
						// slot and always rendered, so the change feed keeps running while the
						// panel is closed.
						try {
							disposers.push(slots.inject("shell.overlay", () => slots.register(
								{ name: "shell.overlay", id: "code-studio", order: 100 },
								CodeStudioPanel
							)));
						} catch (error) {
							console.error("[code-studio] overlay slot failed", error);
						}
					}
				} catch (error) {
					console.error("[code-studio] slot registration failed", error);
				}
				// 0.1.x sidebar entry (DOM injection). 0.2's left sidebar is slot-owned, so
				// the header pill is the entry point there.
				try {
					disposers.push(mountSidebarEntry());
				} catch (error) {
					console.error("[code-studio] sidebar entry failed", error);
				}
				return () => {
					applyPanelState(false);
					for (const dispose of disposers.splice(0)) dispose();
				};
			}, "code-studio: browser UI");
		}

		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
