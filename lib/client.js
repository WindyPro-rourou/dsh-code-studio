window.__ModuleLoader__.load({
	id: "@windypro-rourou/dsh-code-studio",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let React = require("react");

		const el = (type, props, ...children) => React.createElement(type, props ?? null, ...children);
		const inject = ["slots"];

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
		const getRoot = () => api("/root");

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
		function buildBlocks(ops, gapThreshold = 5) {
			const blocks = [];
			let same = [];
			const flushSame = (keepTail) => {
				if (same.length === 0) return;
				if (same.length <= gapThreshold) { blocks.push({ kind: "lines", ops: same }); same = []; return; }
				const head = same.slice(0, 2);
				const tail = keepTail ? same.slice(-2) : [];
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
		function Highlighted({ text, path }) {
			const toks = React.useMemo(() => tokenizeLine(text), [text]);
			return el("span", null,
				toks.map((t, i) => t.cls ? el("span", { className: t.cls, key: i }, t.text) : t.text)
			);
		}

		// ============================ panel controller ============================
		const panel = { open: false, listeners: new Set() };
		function setPanelOpen(v) {
			panel.open = !!v;
			for (const fn of panel.listeners) fn(panel.open);
		}
		function subscribePanel(fn) { panel.listeners.add(fn); return () => panel.listeners.delete(fn); }

		// current session id (per-session change isolation)
		let currentSessionId = null;
		const sessListeners = new Set();
		function setSessionId(v) {
			currentSessionId = v;
			for (const fn of sessListeners) fn(v);
		}
		function subscribeSession(fn) { sessListeners.add(fn); return () => sessListeners.delete(fn); }

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
		const CSS = [
			".cs-root{position:absolute;top:0;right:0;bottom:0;display:flex;flex-direction:column;background:var(--dsw-alias-bg-layer-1,#151922);color:var(--dsw-alias-label-primary,#d7dde6);border-left:1px solid var(--dsw-alias-border-l1,#262a33);font:13px/1.55 -apple-system,BlinkMacSystemFont,\"Segoe UI\",Roboto,sans-serif;z-index:30;box-shadow:-12px 0 32px rgba(0,0,0,.18);animation:csSlideIn .18s ease-out;--cs-mono:ui-monospace,SFMono-Regular,Menlo,Consolas,\"Liberation Mono\",monospace}",
			"@keyframes csSlideIn{from{transform:translateX(24px);opacity:.4}to{transform:none;opacity:1}}",
			".cs-root *{box-sizing:border-box}",
			".cs-resize{position:absolute;left:-3px;top:0;bottom:0;width:7px;cursor:col-resize;z-index:6}",
			".cs-resize:hover,.cs-resize.cs-drag{background:var(--dsw-alias-state-business-primary,#2f6fed);opacity:.35}",
			".cs-head{display:flex;align-items:center;gap:8px;padding:0 10px 0 14px;height:42px;flex:none;border-bottom:1px solid var(--dsw-alias-border-l1,#262a33);background:var(--dsw-alias-bg-layer-2,#1a1f2b)}",
			".cs-title{font-weight:600;font-size:13px;display:flex;align-items:center;gap:7px;white-space:nowrap;min-width:0}",
			".cs-title .cs-dot{width:8px;height:8px;border-radius:50%;background:var(--dsw-alias-state-business-primary,#2f6fed);flex:none}",
			".cs-count{margin-left:auto;font-size:11px;font-family:var(--cs-mono);color:var(--dsw-alias-label-tertiary,#8b93a3);background:var(--dsw-alias-bg-mask-1,rgba(255,255,255,.05));border:1px solid var(--dsw-alias-border-l1,#262a33);border-radius:10px;padding:1px 8px;white-space:nowrap}",
			".cs-close{flex:none;width:26px;height:26px;border-radius:7px;border:1px solid transparent;background:transparent;color:var(--dsw-alias-label-tertiary,#8b93a3);cursor:pointer;font-size:13px;line-height:1}",
			".cs-close:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.08));color:var(--dsw-alias-label-primary,#d7dde6)}",
			".cs-tabs{display:flex;gap:2px;padding:6px 10px 0;flex:none;border-bottom:1px solid var(--dsw-alias-border-l1,#262a33);background:var(--dsw-alias-bg-layer-2,#1a1f2b)}",
			".cs-tab{flex:none;padding:5px 12px;border-radius:7px 7px 0 0;font-size:12px;color:var(--dsw-alias-label-tertiary,#8b93a3);cursor:pointer;border:1px solid transparent;border-bottom:none}",
			".cs-tab:hover{color:var(--dsw-alias-label-primary,#d7dde6)}",
			".cs-tab.cs-on{color:var(--dsw-alias-label-primary,#d7dde6);background:var(--dsw-alias-bg-layer-1,#151922);border-color:var(--dsw-alias-border-l1,#262a33)}",
			".cs-body{flex:1;min-height:0;overflow:hidden;display:flex;flex-direction:column}",
			".cs-chg-list{flex:1;overflow:auto;padding:6px}",
			".cs-chg{flex:none;border:1px solid var(--dsw-alias-border-l1,#262a33);border-radius:9px;margin:0 2px 6px;overflow:hidden;background:var(--dsw-alias-bg-base,#0f1115)}",
			".cs-chg-row{display:flex;align-items:center;gap:6px;padding:6px 8px;cursor:pointer;font-family:var(--cs-mono);font-size:11.5px}",
			".cs-chg-row:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.05))}",
			".cs-caret{width:12px;flex:none;color:var(--dsw-alias-label-quaternary,#565e6e);font-size:9px;text-align:center}",
			".cs-chg-path{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-secondary,#b6bdc9)}",
			".cs-chg-path .cs-bad{font-size:9.5px;border-radius:4px;padding:0 4px;margin-left:6px;flex:none}",
			".cs-bad-add{background:var(--dsw-alias-state-success-secondary,rgba(34,197,94,.16));color:var(--dsw-alias-state-success-primary,#22c55e)}",
			".cs-bad-del{background:var(--dsw-alias-state-error-secondary,rgba(239,68,68,.14));color:var(--dsw-alias-state-error-primary,#ef4444)}",
			".cs-plus{color:var(--dsw-alias-state-success-primary,#22c55e);flex:none;font-size:11px}",
			".cs-minus{color:var(--dsw-alias-state-error-primary,#ef4444);flex:none;font-size:11px}",
			".cs-chg-body{border-top:1px solid var(--dsw-alias-border-l1,#262a33)}",
			".cs-dline{display:flex;font-family:var(--cs-mono);font-size:11.5px;line-height:1.5;min-width:max-content}",
			".cs-dg{flex:none;display:flex;user-select:none}",
			".cs-dsym{width:16px;flex:none;text-align:center;font-weight:700}",
			".cs-dnum{min-width:34px;flex:none;text-align:right;padding-right:8px;color:var(--dsw-alias-label-quaternary,#565e6e);font-size:10.5px}",
			".cs-dtxt{flex:1;white-space:pre;padding-right:10px;color:var(--dsw-alias-label-secondary,#b6bdc9)}",
			".cs-dline.cs-add{background:var(--dsw-alias-state-success-secondary,rgba(34,197,94,.14))}.cs-dline.cs-add .cs-dsym{color:var(--dsw-alias-state-success-primary,#22c55e)}",
			".cs-dline.cs-del{background:var(--dsw-alias-state-error-secondary,rgba(239,68,68,.13))}.cs-dline.cs-del .cs-dsym{color:var(--dsw-alias-state-error-primary,#ef4444)}.cs-dline.cs-del .cs-dtxt{text-decoration:line-through;text-decoration-color:rgba(239,68,68,.45)}",
			".cs-dline.cs-mod{background:var(--dsw-alias-state-warn-secondary,rgba(234,179,8,.12))}.cs-dline.cs-mod .cs-dsym{color:var(--dsw-alias-state-warn-primary,#eab308)}",
			".cs-dgap{display:flex;align-items:center;gap:8px;padding:0 10px;height:22px;cursor:pointer;color:var(--dsw-alias-label-tertiary,#8b93a3);font-size:10.5px;user-select:none}",
			".cs-dgap:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.05))}",
			".cs-dgap .cs-dgbar{flex:1;height:1px;background:var(--dsw-alias-border-l1,#262a33)}",
			".cs-empty{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;color:var(--dsw-alias-label-tertiary,#8b93a3);font-size:12px;padding:24px}",
			".cs-empty .cs-hint{font-size:11px;color:var(--dsw-alias-label-quaternary,#565e6e);max-width:280px;text-align:center;line-height:1.6}",
			".cs-files{flex:1;display:flex;flex-direction:column;min-height:0}",
			".cs-tree{flex:none;max-height:34%;overflow:auto;border-bottom:1px solid var(--dsw-alias-border-l1,#262a33);padding:4px 0;font-size:11.5px;background:var(--dsw-alias-bg-base,#0f1115)}",
			".cs-node{display:flex;align-items:center;gap:5px;padding:2px 8px;cursor:pointer;white-space:nowrap;color:var(--dsw-alias-label-secondary,#b6bdc9);border-radius:5px}",
			".cs-node:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.06))}",
			".cs-node.cs-sel{background:var(--dsw-alias-interactive-bg-active,rgba(47,111,237,.16));color:var(--dsw-alias-label-primary,#d7dde6)}",
			".cs-node .cs-caret{width:11px;flex:none;color:var(--dsw-alias-label-quaternary,#565e6e);font-size:9px;text-align:center}",
			".cs-node .cs-nm{overflow:hidden;text-overflow:ellipsis}",
			".cs-node .cs-ico{flex:none;font-size:11px;opacity:.75}",
			".cs-node .cs-badge{margin-left:auto;font-size:9.5px;color:var(--dsw-alias-state-warn-primary,#eab308);flex:none}",
			".cs-editor{flex:1;display:flex;flex-direction:column;min-height:0}",
			".cs-filebar{display:flex;align-items:center;gap:8px;padding:5px 10px;border-bottom:1px solid var(--dsw-alias-border-l1,#262a33);flex:none;font-family:var(--cs-mono);font-size:11px;color:var(--dsw-alias-label-tertiary,#8b93a3);background:var(--dsw-alias-bg-layer-2,#1a1f2b)}",
			".cs-filebar .cs-fp{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
			".cs-btn{flex:none;background:transparent;border:1px solid var(--dsw-alias-border-l1,#262a33);color:var(--dsw-alias-label-secondary,#b6bdc9);border-radius:6px;padding:3px 8px;font-size:11px;cursor:pointer}",
			".cs-btn:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.08))}",
			".cs-btn.cs-pri{background:var(--dsw-alias-button-primary-fill,#2f6fed);border-color:var(--dsw-alias-button-primary-fill,#2f6fed);color:#fff}",
			".cs-btn:disabled{opacity:.45;cursor:default}",
			".cs-edit-wrap{flex:1;display:flex;min-height:0}",
			".cs-edit-g{flex:none;overflow:hidden;text-align:right;padding-left:10px;user-select:none}",
			".cs-edit-g .cs-gn{min-width:30px;padding:0 8px 0 0;color:var(--dsw-alias-label-quaternary,#565e6e);font-family:var(--cs-mono);font-size:12px;line-height:1.55;text-align:right}",
			".cs-edit-overlay{position:relative;flex:1;min-width:0;overflow:hidden;background:var(--dsw-alias-markdown-code-block,transparent)}",
			".cs-edit-overlay .cs-hl{position:absolute;top:0;left:0;right:0;bottom:0;height:100%;margin:0;padding:0 10px 0 8px;white-space:pre;overflow:hidden;pointer-events:none;font-family:var(--cs-mono);font-size:12px;line-height:1.55;color:var(--dsw-alias-label-primary,#d7dde6)}",
			".cs-edit-overlay .cs-ta{position:absolute;inset:0;width:100%;height:100%;background:transparent;border:none;outline:none;color:transparent;caret-color:var(--dsw-alias-label-primary,#d7dde6);font-family:var(--cs-mono);font-size:12px;line-height:1.55;padding:0 10px 0 8px;resize:none;white-space:pre;overflow:auto;tab-size:2}",
			".cs-edit-overlay .cs-ta::selection{background:rgba(47,111,237,.35)}",
			".cs-tok-kw{color:#c678dd}.cs-tok-str{color:#98c379}.cs-tok-cmt{color:#7f848e;font-style:italic}.cs-tok-num{color:#d19a66}.cs-tok-fn{color:#61afef}.cs-tok-ty{color:#e5c07b}.cs-tok-cn{color:#56b6c2}.cs-tok-ann{color:#61afef;font-style:italic}",
			".cs-status{display:flex;align-items:center;gap:10px;padding:4px 12px;border-top:1px solid var(--dsw-alias-border-l1,#262a33);flex:none;font-size:10.5px;color:var(--dsw-alias-label-tertiary,#8b93a3);font-family:var(--cs-mono);background:var(--dsw-alias-bg-layer-2,#1a1f2b)}",
			".cs-status .cs-sdot{width:7px;height:7px;border-radius:50%;flex:none}",
			".cs-status .cs-ok{background:var(--dsw-alias-state-success-primary,#22c55e)}",
			".cs-status .cs-busy{background:var(--dsw-alias-state-warn-primary,#eab308)}",
			".cs-status .cs-err{background:var(--dsw-alias-state-error-primary,#ef4444)}",
			".cs-badge-f{position:fixed;right:16px;bottom:16px;z-index:40;display:flex;align-items:center;gap:8px;padding:8px 14px;border-radius:10px;background:var(--dsw-alias-bg-overlay,#1b2130);color:var(--dsw-alias-label-primary,#d7dde6);border:1px solid var(--dsw-alias-border-l1,#262a33);font-size:12px;cursor:pointer;box-shadow:0 8px 24px rgba(0,0,0,.3);animation:csSlideIn .2s ease-out}",
			".cs-badge-f:hover{background:var(--dsw-alias-bg-layer-3,#222836)}",
			".cs-badge-f .cs-bd{width:8px;height:8px;border-radius:50%;background:var(--dsw-alias-state-business-primary,#2f6fed);flex:none}"
		].join("\n");

		// ============================ diff view ============================
		function DiffRows({ before, after, path, expanded }) {
			const ops = React.useMemo(() => mergeModified(lineDiff(before, after)), [before, after]);
			const [open, setOpen] = React.useState(false);
			const showAll = expanded === true || open;
			const blocks = React.useMemo(() => buildBlocks(ops), [ops]);
			const rows = [];
			const rowOf = (op, key) => {
				const type = op.type;
				const sym = type === "add" ? "+" : type === "del" ? "−" : type === "mod" ? "~" : " ";
				const num = type === "del" ? op.oldNo : op.newNo;
				return el("div", { className: "cs-dline cs-" + type, key },
					el("span", { className: "cs-dsym" }, sym),
					el("span", { className: "cs-dnum" }, num ?? ""),
					el("span", { className: "cs-dtxt" }, el(Highlighted, { text: op.text, path }))
				);
			};
			for (const block of blocks) {
				if (block.kind === "gap") {
					rows.push(el("div", { className: "cs-dgap", key: "g" + rows.length, onClick: () => setOpen(true) },
						el("span", null, "⋯ " + block.count + " 行未改动"),
						el("span", { className: "cs-dgbar" })
					));
				} else {
					for (const op of block.ops) rows.push(rowOf(op, "r" + rows.length));
				}
			}
			if (showAll) {
				const all = ops.map((op, i) => rowOf(op, "e" + i));
				return el("div", null, all);
			}
			return el("div", null, rows);
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
					el("span", { className: "cs-ico" }, "📁"),
					el("span", { className: "cs-nm" }, name)
				));
				if (isOpen) {
					if (entries === null) rows.push(el("div", { key: "l" + path, className: "cs-node", style: { paddingLeft: 8 + (depth + 1) * 13, color: "var(--dsw-alias-label-quaternary)" } }, "加载中…"));
					else if (entries === void 0) rows.push(el("div", { key: "l" + path, className: "cs-node", style: { paddingLeft: 8 + (depth + 1) * 13, color: "var(--dsw-alias-label-quaternary)" } }, "点击展开"));
					else for (const entry of entries) {
						if (entry.type === "dir" && SKIP_DIRS.has(entry.name)) continue;
						if (entry.type === "dir") rows.push(el(React.Fragment, { key: entry.path }, renderDir(entry.path, depth + 1)));
						else rows.push(el("div", {
							key: entry.path, className: "cs-node cs-file" + (entry.path === selected ? " cs-sel" : ""),
							style: { paddingLeft: 8 + (depth + 1) * 13 },
							onClick: () => onOpen(entry.path)
						},
							el("span", { className: "cs-caret" }, ""),
							el("span", { className: "cs-ico" }, "•"),
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
		function Editor({ file, onEdit, onSave, onDiff }) {
			const gutterRef = React.useRef(null);
			const hlRef = React.useRef(null);
			const taRef = React.useRef(null);
			const sync = (e) => {
				const el2 = e ? e.currentTarget : taRef.current;
				if (gutterRef.current) gutterRef.current.scrollTop = el2.scrollTop;
				if (hlRef.current) hlRef.current.scrollTop = el2.scrollTop;
			};
			React.useEffect(() => { sync(null); }, [file.content]);
			const lineCount = file.content == null ? 1 : file.content.split("\n").length;
			const gutter = [];
			for (let i = 1; i <= lineCount; i++) gutter.push(el("div", { className: "cs-gn", key: i }, String(i)));
			const stats = file.baseline != null && file.content != null ? fileStats(file.baseline, file.content) : null;
			const lines = (file.content ?? "").split("\n").map((line, i) =>
				el("div", { key: i, style: { minHeight: "1.55em" } }, el(Highlighted, { text: line, path: file.path }))
			);
			return el("div", { className: "cs-editor" },
				el("div", { className: "cs-filebar" },
					el("span", { className: "cs-fp" }, file.path),
					stats && (stats.adds > 0 || stats.dels > 0) ? el("span", null,
						el("b", { style: { color: "var(--dsw-alias-state-success-primary)" } }, "+" + stats.adds),
						"  ",
						el("b", { style: { color: "var(--dsw-alias-state-error-primary)" } }, "−" + stats.dels)
					) : null,
					el("button", { className: "cs-btn", onClick: onDiff, title: "查看该文件的 Diff" }, "Diff"),
					el("button", { className: "cs-btn cs-pri", onClick: onSave, disabled: !file.dirty || file.content == null }, "保存")
				),
				el("div", { className: "cs-edit-wrap" },
					el("div", { className: "cs-edit-g", ref: gutterRef }, gutter),
					el("div", { className: "cs-edit-overlay" },
						el("pre", { className: "cs-hl", ref: hlRef, "aria-hidden": "true" }, lines),
						el("textarea", {
							ref: taRef, className: "cs-ta",
							value: file.content ?? "",
							onChange: (e) => onEdit(e.target.value),
							onScroll: sync,
							spellCheck: false,
							autoCapitalize: "off",
							autoCorrect: "off",
							placeholder: ""
						})
					)
				)
			);
		}

		// ============================ panel ============================
		function CodeStudioPanel() {
			const [open, setOpen] = React.useState(panel.open);
			const [tab, setTab] = React.useState("changes");
			const [changes, setChanges] = React.useState([]);
			const [expandedPath, setExpandedPath] = React.useState(null);
			const [root, setRoot] = React.useState(null);
			const [editor, setEditor] = React.useState(null);
			const [conn, setConn] = React.useState("connecting");
			const [connText, setConnText] = React.useState("连接中…");
			const [width, setWidth] = React.useState(() => {
				try {
					const saved = Number(globalThis.localStorage?.getItem("cs.panelWidth"));
					if (saved >= 280 && saved <= 900) return saved;
				} catch { /* ignore */ }
				return 400;
			});
			const dragRef = React.useRef(null);
			const changedSet = React.useMemo(() => new Set(changes.map((c) => c.path)), [changes]);
			// current session for per-session isolation
			const [sessId, setSessId] = React.useState(currentSessionId);
			const sessIdRef = React.useRef(currentSessionId);
			// per-session UI memory: save current snapshot on switch, restore target's
			const sessStatesRef = React.useRef(loadSessionStates());
			const snapRef = React.useRef({ changes, expandedPath, editor, tab, width });
			snapRef.current = { changes, expandedPath, editor, tab, width };
			React.useEffect(() => subscribeSession((v) => {
				const cur = sessIdRef.current;
				if (cur && cur !== v) {
					sessStatesRef.current[cur] = snapRef.current;
					persistSessionStates(sessStatesRef.current);
				}
				sessIdRef.current = v;
				setSessId(v);
				const st = sessStatesRef.current[v];
				if (st) {
					setChanges(st.changes ?? []);
					setExpandedPath(st.expandedPath ?? null);
					setEditor(st.editor ?? null);
					setTab(st.tab ?? "changes");
					setWidth(st.width ?? 400);
				} else {
					setChanges([]); setExpandedPath(null); setEditor(null); setTab("changes");
				}
			}), []);

			React.useEffect(() => subscribePanel(setOpen), []);
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
				getRoot().then((d) => setRoot(d.root)).catch((e) => { setConn("err"); setConnText(String(e.message)); });
			}, []);

			// SSE change feed + auto-appear
			React.useEffect(() => {
				let source;
				const openSse = () => {
					source = new EventSource(API + "/events");
					source.onopen = () => { setConn("ok"); setConnText("已连接"); };
					source.onerror = () => { setConn("err"); setConnText("事件流断开，重连中…"); };
					source.onmessage = (msg) => {
						try {
							const ev = JSON.parse(msg.data);
							if (!ev || typeof ev.path !== "string") return;
							// per-session isolation: only react to changes owned by the active session
							// (or unattributed ones, treated as the current session's/user's own edits)
							// per-session isolation: only filter when we KNOW the active session.
							// If current is null, do not filter - otherwise edits would never appear.
							if (ev.sessionId && sessIdRef.current && ev.sessionId !== sessIdRef.current) return;
							setConn("ok"); setConnText("已连接");
							const name = ev.path.split(/[\\/]/).pop() || ev.path;
							setChanges((prev) => {
								const next = prev.filter((c) => c.path !== ev.path);
								next.unshift({ path: ev.path, name, before: ev.before, after: ev.after, deleted: !!ev.deleted, ts: ev.ts, sessionId: ev.sessionId });
								return next.slice(0, 50);
							});
							setPanelOpen(true);
							setExpandedPath(ev.path);
						} catch { /* ignore */ }
					};
				};
				openSse();
				return () => { if (source) source.close(); };
			}, []);

			// Ctrl+S / Ctrl+D
			React.useEffect(() => {
				const onKey = (e) => {
					if (!editor) return;
					if ((e.ctrlKey || e.metaKey) && e.key === "s") { e.preventDefault(); void saveCurrent(); }
					if ((e.ctrlKey || e.metaKey) && e.key === "d") { e.preventDefault(); viewDiff(editor.path); }
				};
				window.addEventListener("keydown", onKey);
				return () => window.removeEventListener("keydown", onKey);
			});

			const openFile = (path) => {
				setEditor({ path, content: null, baseline: null, dirty: false, loading: true });
				setTab("files");
				readFile(path).then((data) => {
					setEditor((prev) => prev && prev.path === path ? { path, content: data.content, baseline: data.content, dirty: false, loading: false } : prev);
				}).catch((e) => {
					setEditor((prev) => prev && prev.path === path ? { path, content: null, baseline: null, dirty: false, loading: false, error: String(e.message) } : prev);
				});
			};
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

			if (!open) {
				if (changes.length > 0) {
					return el("div", { className: "cs-badge-f", onClick: () => setPanelOpen(true) },
						el("span", { className: "cs-bd" }),
						el("span", null, changes.length + " 个文件已变更"),
						el("span", { style: { color: "var(--dsw-alias-label-tertiary)", fontSize: 11 } }, "查看 →")
					);
				}
				return null;
			}

			return el("div", { className: "cs-root", style: { width } },
				el("div", {
					className: "cs-resize", onPointerDown: onResizeDown, onPointerMove: onResizeMove, onPointerUp: onResizeUp,
					title: "拖拽调整宽度"
				}),
				el("div", { className: "cs-head" },
					el("span", { className: "cs-title" },
						el("span", { className: "cs-dot" }),
						"Code Studio"
					),
					el("span", { className: "cs-count" }, changes.length > 0 ? changes.length + " 变更" : "就绪"),
					el("button", { className: "cs-close", onClick: () => setPanelOpen(false), title: "关闭" }, "✕")
				),
				el("div", { className: "cs-tabs" },
					el("div", { className: "cs-tab" + (tab === "changes" ? " cs-on" : ""), onClick: () => setTab("changes") }, "变更"),
					el("div", { className: "cs-tab" + (tab === "files" ? " cs-on" : ""), onClick: () => setTab("files") }, "文件")
				),
				el("div", { className: "cs-body" },
					tab === "changes" ? (
						changes.length === 0
							? el("div", { className: "cs-empty" },
								el("div", null, "暂无文件变更"),
								el("span", { className: "cs-hint" }, "Agent 修改文件时，这里会自动浮现逐行 Diff（+ 新增  − 删除  ~ 修改）")
							)
							: el("div", { className: "cs-chg-list" },
								changes.map((c) => {
									const stats = c.deleted ? { adds: 0, dels: 0 } : fileStats(c.before, c.after);
									const isOpen = expandedPath === c.path;
									return el("div", { className: "cs-chg", key: c.path },
										el("div", { className: "cs-chg-row", onClick: () => setExpandedPath(isOpen ? null : c.path) },
											el("span", { className: "cs-caret" }, isOpen ? "▾" : "▸"),
											el("span", { className: "cs-chg-path" }, c.name,
												c.deleted ? el("span", { className: "cs-bad cs-bad-del" }, "删除")
													: c.before == null ? el("span", { className: "cs-bad cs-bad-add" }, "新建")
													: null
											),
											el("span", { className: "cs-plus" }, "+" + stats.adds),
											el("span", { className: "cs-minus" }, "−" + stats.dels)
										),
										isOpen ? el("div", { className: "cs-chg-body" },
											c.deleted
												? el("div", { className: "cs-empty" }, "文件已删除")
												: el(DiffRows, { before: c.before, after: c.after, path: c.path })
										) : null
									);
								}),
								el("div", { style: { display: "flex", gap: 6, padding: "4px 2px" } },
									el("button", { className: "cs-btn", onClick: clearChanges }, "清空列表")
								)
							)
					) : (
						el("div", { className: "cs-files" },
							root ? el(FileTree, { root, selected: editor?.path, changed: changedSet, onOpen: openFile })
								: el("div", { className: "cs-empty" }, "加载工作区…"),
							editor ? (
								editor.loading ? el("div", { className: "cs-empty" }, "加载中…")
								: editor.error ? el("div", { className: "cs-empty" }, editor.error)
								: el(Editor, { file: editor, onEdit: editContent, onSave: () => void saveCurrent(), onDiff: () => viewDiff(editor.path) })
							) : el("div", { className: "cs-empty" },
								el("div", null, "点击上方文件开始编辑"),
								el("span", { className: "cs-hint" }, "打开文件后可编辑，Ctrl+S 保存，Ctrl+D 查看 Diff")
							)
						)
					)
				),
				el("div", { className: "cs-status" },
					el("span", { className: "cs-sdot cs-" + conn }),
					el("span", null, connText),
					el("span", { style: { marginLeft: "auto" } }, "变更 " + changes.length + " 文件"),
					sessId ? el("span", { title: "仅显示当前会话的变更" }, "会话 " + String(sessId).slice(-6)) : null,
					el("span", null, editor && editor.dirty ? "未保存" : "就绪")
				)
			);
		}

		// ============================ sidebar entry ============================
		const ENTRY_SELECTOR = "[data-cs-entry]";
		const ENTRY_VERSION = "4";
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
			entry.title = "Code Studio — 代码编辑与 Diff（拖拽面板左缘可调宽）";
			entry.innerHTML = "<span>" + ENTRY_ICON + "</span><span>Code Studio</span>";
			entry.style.cssText = "display:flex;align-items:center;gap:8px;width:100%;padding:8px 12px;background:transparent;border:none;color:inherit;cursor:pointer;font-size:13px;border-radius:8px;";
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
			return () => { observer.disconnect(); entry.remove(); };
		}

		// ============================ apply ============================
		let mounted = false;
		function apply(ctx) {
			if (mounted) return;
			mounted = true;
			ctx.effect(() => {
				const disposers = [];
				try {
					disposers.push(mountSidebarEntry());
				} catch (error) {
					console.error("[code-studio] sidebar entry failed", error);
				}
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
					if (slots !== void 0) {
						disposers.push(slots.inject("shell.overlay", () => slots.register(
							{ name: "shell.overlay", id: "code-studio", order: 100 },
							CodeStudioPanel
						)));
					} else {
						console.error("[code-studio] slots service unavailable");
					}
				} catch (error) {
					console.error("[code-studio] overlay slot failed", error);
				}
				return () => {
					for (const dispose of disposers.splice(0)) dispose();
				};
			}, "code-studio: browser UI");
		}

		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
