// difftest.mjs - property test for the line-diff optimization.
//
// `lineDiff` now trims the common head/tail before running the LCS DP (that is what makes
// a 2-line edit in a 1200-line file cheap). Two claims are tested against the PREVIOUS
// implementation (untrimmed DP):
//
//   1. counts are identical -- adds/dels are what the panel shows and what the header
//      digest sums, so they must never move. adds/dels are exactly (m-L) and (n-L) for
//      any maximal alignment, so this is the minimality guarantee.
//   2. every op list rebuilds both file versions exactly, with correct line numbers.
//
// It deliberately does NOT demand an identical op list: when the file repeats a line, two
// different alignments are equally minimal and trimming may legitimately pick the other
// one (the old code's choice was equally arbitrary). Those tie-break differences are
// counted and reported instead of failing.
//
//   node scripts/difftest.mjs [cases]
import { readFile } from "node:fs/promises";

const CASES = Number(process.argv[2] ?? 4000);
const source = await readFile(new URL("../lib/client.js", import.meta.url), "utf8");
const code = source.replace("exports.apply = apply;",
  "exports.__diff = { lineDiff, fileStats };\n\t\texports.apply = apply;");
let loaded = null;
globalThis.window = { __ModuleLoader__: { load(spec) { loaded = spec; } } };
(0, eval)(code);
// The module body requires react at load time; the diff engine itself needs nothing.
const reactStub = { createElement: () => null, useState: (v) => [v, () => {}], useEffect: () => {}, useRef: () => ({}), useMemo: (f) => f(), useCallback: (f) => f, useLayoutEffect: () => {} };
const { lineDiff, fileStats } = loaded.factory((name) => (name === "react" ? reactStub : void 0)).__diff;

/* ---------------------------------------------- the previous implementation, verbatim */
function oldLineDiff(before, after) {
  const a = before == null ? [] : String(before).split("\n");
  const b = after == null ? [] : String(after).split("\n");
  const n = a.length, m = b.length;
  if (n === 0) return b.map((text, j) => ({ type: "add", oldNo: null, newNo: j + 1, text }));
  if (m === 0) return a.map((text, i) => ({ type: "del", oldNo: i + 1, newNo: null, text }));
  if (n * m > 2500000) throw new Error("old greedy path: not comparable");
  const dp = new Uint32Array((n + 1) * (m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i * (m + 1) + j] = a[i] === b[j] ? dp[(i + 1) * (m + 1) + j + 1] + 1 : Math.max(dp[(i + 1) * (m + 1) + j], dp[i * (m + 1) + j + 1]);
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

const key = (ops) => ops.map((o) => o.type + ":" + o.oldNo + ":" + o.newNo + ":" + o.text).join("|");
const counts = (ops) => ops.reduce((acc, o) => { if (o.type === "same") acc.same++; else if (o.type === "del") acc.dels++; else acc.adds++; return acc; }, { same: 0, adds: 0, dels: 0 });
let tieBreaks = 0;

/** Every op list must rebuild both sides exactly, with correct 1-based numbering. */
function reconstructionOk(ops, a, b) {
  const oldSide = [], newSide = [];
  let oldMax = 0, newMax = 0;
  for (const o of ops) {
    if (o.type === "same") {
      oldSide.push(o.text); newSide.push(o.text);
      if (o.oldNo !== oldMax + 1 || o.newNo !== newMax + 1) return "numbering jumped at " + key([o]);
      oldMax = o.oldNo; newMax = o.newNo;
    } else if (o.type === "del") {
      oldSide.push(o.text);
      if (o.oldNo !== oldMax + 1 || o.newNo !== null) return "del numbering wrong at " + key([o]);
      oldMax = o.oldNo;
    } else if (o.type === "add") {
      newSide.push(o.text);
      if (o.newNo !== newMax + 1 || o.oldNo !== null) return "add numbering wrong at " + key([o]);
      newMax = o.newNo;
    } else return "unknown op type " + o.type;
  }
  if (oldSide.join("\n") !== a.join("\n")) return "old side does not rebuild";
  if (newSide.join("\n") !== b.join("\n")) return "new side does not rebuild";
  return null;
}

let rng = 12345;
const rnd = (n) => (rng = (rng * 1103515245 + 12345) & 0x7fffffff) % n;
const WORDS = ["alpha", "beta", "gamma", "delta", "epsilon", "return", "{", "}", "", "  x = 1;", "  y = 2;"];
const makeLines = (n) => Array.from({ length: n }, () => WORDS[rnd(WORDS.length)]);

let checked = 0, bigChecked = 0, failures = 0;
const fail = (msg, a, b, extra) => {
  failures++;
  console.error("FAIL: " + msg);
  console.error("  before=" + JSON.stringify(a.slice(0, 12)));
  console.error("  after =" + JSON.stringify(b.slice(0, 12)));
  if (extra) console.error("  " + extra);
};

/**
 * The invariants that actually matter: the op list rebuilds both versions, the adds/dels
 * counts are unchanged from the previous implementation (that is minimality), and
 * fileStats -- the number the UI prints -- agrees with those counts. A different
 * equally-minimal alignment is counted as a tie-break, not a failure.
 */
function compare(label, av, bv) {
  const a = av === "" ? [""] : av.split("\n");
  const b = bv === "" ? [""] : bv.split("\n");
  const got = lineDiff(av, bv);
  const want = oldLineDiff(av, bv);
  const bad = reconstructionOk(got, a, b);
  if (bad !== null) return fail("reconstruction (" + label + "): " + bad, a, b);
  const cg = counts(got), cw = counts(want);
  if (cg.adds !== cw.adds || cg.dels !== cw.dels) {
    return fail("counts moved (" + label + ")", a, b, "got +" + cg.adds + " -" + cg.dels + "   old +" + cw.adds + " -" + cw.dels);
  }
  const fs = fileStats(av, bv);
  if (fs.adds !== cw.adds || fs.dels !== cw.dels) {
    return fail("fileStats disagrees with the old op counts (" + label + ")", a, b, "fileStats +" + fs.adds + " -" + fs.dels + "   old +" + cw.adds + " -" + cw.dels);
  }
  if (key(got) !== key(want)) tieBreaks++;
  return null;
}

// 1) randomized small inputs
for (let t = 0; t < CASES; t++) {
  const a = makeLines(rnd(14));
  const b = makeLines(rnd(14));
  checked++;
  compare("small#" + t, a.join("\n"), b.join("\n"));
  if (failures > 3) break;
}

// 2) edge shapes
for (const [av, bv] of [["", ""], ["", "a"], ["a", ""], ["a", "a"], ["a\nb", "a\nb"], ["a\nb\nc", "c"], ["\n", ""], ["x\ny\nz", "x\nY\nz"], ["a\nb\nb\nc", "a\nb\nc"], ["a\nb\nc\nd", "b\nc"]]) {
  checked++;
  compare("edge " + JSON.stringify([av, bv]), av, bv);
}

// 3) large realistic edits: same output as the old code (both take the DP path), which is
//    the case where the trim actually has to be output-preserving.
const scenarios = [
  ["small edit in a big file", 1200, (a) => { for (let k = 0; k < 6; k++) a[500 + k] = "CHANGED " + k; }],
  ["append at the tail", 1200, (a) => { for (let k = 0; k < 30; k++) a.push("tail " + k); }],
  ["delete a chunk", 1200, (a) => a.splice(400, 25)],
  ["insert at the head", 900, (a) => a.unshift("header a", "header b")],
  ["rewrite the middle", 900, (a) => { for (let k = 400; k < 500; k++) a[k] = "R" + k; }],
  ["no common prefix/suffix at all", 600, (a) => a.map((l) => "X" + l)],
  ["whole file replaced", 500, () => makeLines(500).map((l) => "N" + l)]
];
for (const [label, n, mutate] of scenarios) {
  const a = makeLines(n);
  const b = a.slice();
  mutate(b);
  bigChecked++;
  compare(label, a.join("\n"), b.join("\n"));
}

// 4) the shape the optimization exists for: a localized edit deep inside a big file.
//    No reference comparison here -- the previous implementation refused this size
//    (n*m > 2.5M) and fell back to a greedy, non-minimal alignment, so "same as before"
//    would be the wrong goal. The right answer is known exactly instead: 12 replaced lines
//    are 12 deletions and 12 insertions, and the shipped implementation must find that.
const bigA = makeLines(3000);
const bigB = bigA.slice();
for (let k = 1500; k < 1512; k++) bigB[k] = "EDITED " + k;
{
  const av = bigA.join("\n"), bv = bigB.join("\n");
  const t0 = performance.now();
  const got = lineDiff(av, bv);
  const ms = performance.now() - t0;
  const bad = reconstructionOk(got, bigA, bigB);
  const c = counts(got);
  const fs = fileStats(av, bv);
  bigChecked++;
  if (bad !== null) fail("reconstruction (3000-line localized edit): " + bad, bigA, bigB);
  else if (c.adds !== 12 || c.dels !== 12) fail("3000-line localized edit is not minimal", bigA, bigB, "got +" + c.adds + " -" + c.dels + ", expected +12 -12");
  else if (fs.adds !== 12 || fs.dels !== 12) fail("fileStats wrong for the 3000-line localized edit", bigA, bigB, "got +" + fs.adds + " -" + fs.dels);
  else console.log(`  localized 12-line edit in 3000 lines: exact minimal diff in ${ms.toFixed(1)} ms (previous implementation took the greedy path at this size)`);
}

console.log("difftest: " + checked + " randomized/edge cases + " + bigChecked + " large edits, " +
  tieBreaks + " equally-minimal alignments picked differently (allowed), " + failures + " failures");
process.exit(failures === 0 ? 0 : 1);
