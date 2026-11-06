// worddiff-test.mjs - verifies WHERE the inline word-diff marks land.
//
// The signature-based render test checks rows, numbers and text, so it cannot see a mark
// placed on the wrong word (the row text is taken from the op itself). This asserts the
// marks themselves: which characters are highlighted on the old and the new side of a
// "modified" line.
//
//   node scripts/worddiff-test.mjs
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const source = readFileSync(process.env.CUR_FILE ?? path.join(ROOT, "lib", "client.js"), "utf8");

let component = "?", hookIndex = 0, seed = {};
const noop = () => {};
const react = {
  createElement: (type, props, ...children) => ({ __el: true, type, props: props ?? {},
    children: children.flat(Infinity).filter((c) => c !== null && c !== undefined && c !== false && c !== true) }),
  useState: (init) => {
    const initial = typeof init === "function" ? init() : init;
    const key = component + ":" + hookIndex++;
    return [Object.prototype.hasOwnProperty.call(seed, key) ? seed[key] : initial, noop];
  },
  useEffect: () => {}, useLayoutEffect: () => {},
  useRef: (v) => ({ current: v }), useMemo: (f) => f(), useCallback: (f) => f, memo: (f) => f,
  Fragment: "Fragment"
};
const expand = (node) => {
  const owner = component, index = hookIndex;
  component = node.type.name || "anon"; hookIndex = 0;
  try { return node.type({ ...node.props, children: node.children.length === 1 ? node.children[0] : node.children }); }
  finally { component = owner; hookIndex = index; }
};

let loaded = null;
globalThis.window = { __ModuleLoader__: { load(spec) { loaded = spec; } } };
const realWarn = console.warn;
console.warn = () => {};
(0, eval)(source.replace("exports.apply = apply;", "exports.__w = { DiffRows };\n\t\texports.apply = apply;"));
const DiffRows = loaded.factory((name) => (name === "react" ? react : void 0)).__w.DiffRows;

/** Rows of a rendered diff: kind, full text, and the highlighted substrings. */
function rows(tree) {
  const out = [];
  const text = (n) => {
    if (n === null || n === undefined || typeof n === "boolean") return "";
    if (typeof n === "string" || typeof n === "number") return String(n);
    if (Array.isArray(n)) return n.map(text).join("");
    if (typeof n !== "object" || n.__el !== true) return "";
    if (typeof n.type === "function") return text(expand(n));
    return text(n.children);
  };
  const marks = (n, acc) => {
    if (n === null || n === undefined || typeof n === "boolean") return acc;
    if (typeof n === "string" || typeof n === "number") return acc;
    if (Array.isArray(n)) { for (const c of n) marks(c, acc); return acc; }
    if (typeof n !== "object" || n.__el !== true) return acc;
    if (typeof n.type === "function") { marks(expand(n), acc); return acc; }
    if (n.type === "mark") { acc.push(text(n.children)); return acc; }
    for (const c of n.children) marks(c, acc);
    return acc;
  };
  const walk = (n) => {
    if (n === null || n === undefined || typeof n === "boolean") return;
    if (typeof n === "string" || typeof n === "number") return;
    if (Array.isArray(n)) { for (const c of n) walk(c); return; }
    if (typeof n !== "object" || n.__el !== true) return;
    if (typeof n.type === "function") { walk(expand(n)); return; }
    const cls = typeof n.props.className === "string" ? n.props.className : "";
    if (cls.includes("cs-dline")) {
      // Compare the code text only (.cs-dtxt), not the "~" symbol and line number.
      const body = n.children.find((c) => c && c.__el === true && (typeof c.props.className === "string" && c.props.className === "cs-dtxt"));
      out.push({ cls: cls.replace("cs-dline", "").trim(), text: body === void 0 ? "" : text(body), marks: body === void 0 ? [] : marks(body, []) });
      return;
    }
    for (const c of n.children) walk(c);
  };
  walk(tree);
  return out;
}

const render = (before, after) => rows(DiffRows({ before, after, path: "x.js", expanded: true }));

let failures = 0;
const check = (cond, name, detail) => {
  if (cond) { console.log("  ok   " + name); return; }
  failures += 1;
  console.error("  FAIL " + name + (detail === void 0 ? "" : ": " + detail));
};

console.log("== one word replaced ==");
{
  const r = render("alpha beta gamma", "alpha BETA gamma");
  check(r.length === 2, "a replaced line produces an old row and a new row", "rows=" + r.length);
  const [oldRow, newRow] = r;
  check(oldRow.text === "alpha beta gamma", "old row keeps the original text", JSON.stringify(oldRow.text));
  check(newRow.text === "alpha BETA gamma", "new row shows the NEW text", JSON.stringify(newRow.text));
  check(JSON.stringify(oldRow.marks) === '["beta"]', "old row marks exactly the removed word", JSON.stringify(oldRow.marks));
  check(JSON.stringify(newRow.marks) === '["BETA"]', "new row marks exactly the added word", JSON.stringify(newRow.marks));
}

console.log("== word inserted in the middle ==");
{
  const r = render("keep one two", "keep one extra two");
  check(JSON.stringify(r[1]?.marks) === '["extra"]', "the inserted word is the only mark", JSON.stringify(r[1]?.marks));
}

console.log("== two separate words changed ==");
{
  const r = render("a bb c dd e", "a XX c YY e");
  const joined = (r[1]?.marks ?? []).join("|");
  check(joined === "XX|YY", "both changed words are marked, and the untouched word between them is not", joined);
  check(JSON.stringify(r[0]?.marks) === '["bb","dd"]', "the old side marks only the removed words", JSON.stringify(r[0]?.marks));
}

console.log("== marks never escape the row text ==");
{
  const r = render("const value = compute(1);", "const value = compute(2);");
  for (const row of r) {
    for (const m of row.marks) {
      check(row.text.includes(m), `mark ${JSON.stringify(m)} is part of the row`, JSON.stringify(row.text));
    }
  }
}

console.log("== whitespace is never highlighted ==");
{
  const r = render("one two three", "one  two three");
  for (const row of r) {
    for (const m of row.marks) check(m.trim() !== "", `mark ${JSON.stringify(m)} is not pure whitespace`, JSON.stringify(row.marks));
  }
}

console.log("== a pure addition carries no marks ==");
{
  const r = render("keep", "keep\nadded line");
  const added = r.find((x) => x.cls === "cs-add");
  check(added !== void 0, "the added row exists");
  check(added !== void 0 && added.marks.length === 0, "an added line has no word marks", JSON.stringify(added?.marks));
}

console.log("== identical lines are not marked ==");
{
  const r = render("same", "same");
  check(r.every((x) => x.marks.length === 0), "unchanged rows have no marks");
}

console.warn = realWarn;
console.log(failures === 0 ? "\nworddiff OK" : "\nworddiff: " + failures + " failures");
process.exit(failures === 0 ? 0 : 1);
