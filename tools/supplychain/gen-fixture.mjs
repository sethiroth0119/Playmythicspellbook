/* ═══════════════════════════════════════════════════════════════════════════
   🧾 gen-fixture — the Node-side stand-in for the bridge's `opEcon()`.

   WHY THIS EXISTS. The Supply Chain feature is not allowed to write an economy
   number down (CLAUDE.md: everything goes through `_opEcon()`). In the browser
   that is easy — sc.bridge.js asks the game. In `node` there is no game, so the
   pure data files' tests need the SAME table from somewhere. Retyping it into a
   test is exactly the hardcoding the rule forbids, and it would rot silently
   the first time someone retunes a wage. So the fixture is GENERATED from
   public/index.html and carries a hash of the source it was cut from:
   `--check` fails the moment index.html and the fixture disagree.

   HOW IT FINDS THINGS. By SYMBOL, never by line number — four other sessions are
   editing index.html while this runs and every line number in the briefs is
   already stale. Each block is cut from `const NAME = {` to the first closing
   line that closes it into a statement that evaluates on its own (see slice()).
   A real tokenizer was considered and rejected: it has to understand regex
   literals, template strings and emoji-bearing comments to be right, and a
   wrong one fails silently. If the rule ever stops holding the slice will not
   evaluate and this script exits loudly instead of guessing.

   The slice is EVALUATED (not regex-scraped), because the tables are JS, not
   JSON: comments between rows, trailing commas, unquoted keys. It is evaluated
   with no scope at all, so a row that starts referencing another constant also
   fails loudly — which is what we want to hear about.

   CRLF. `git` on this box checks .html out with CRLF (memory: "Git CRLF trap").
   Everything is normalised to LF before slicing AND before hashing, so the same
   tree produces the same fixture whichever way it was checked out.

   USAGE
     node tools/supplychain/gen-fixture.mjs           write (no-op if unchanged)
     node tools/supplychain/gen-fixture.mjs --check   exit 1 on drift, write nothing
     node tools/supplychain/gen-fixture.mjs --print   print the JSON, write nothing
   ═══════════════════════════════════════════════════════════════════════════ */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');
const INDEX = path.join(REPO, 'public', 'index.html');
const ROUTES = path.join(REPO, 'public', 'src', 'transport', 'routes.js');
export const FIXTURE = path.join(HERE, 'fixture.opsecon.json');

const lf = (s) => s.replace(/\r\n?/g, '\n');
const sha = (s) => crypto.createHash('sha256').update(s, 'utf8').digest('hex');

/* Cut `const NAME = {…}` / `[…]` out of the source. Anchored on the declaration
   at column zero so a mention of the name inside a comment can never match.
   The END is the first line that ends in the closing bracket AND leaves a slice
   that evaluates on its own — a balanced, complete statement. Round 1 used
   "first closing bracket at column zero"; that silently swallowed forty lines
   of unrelated functions after LOOT_RES_IDS (whose `];` is indented) and only
   worked because `return […];` made the rest dead code. Trying each candidate
   is a few hundred cheap parses and cannot over-read. */
function slice(src, name) {
  const m = new RegExp('^const ' + name + ' = ([{\\[])', 'm').exec(src);
  if (!m) throw new Error(`gen-fixture: "const ${name} =" not found at column 0 in public/index.html`);
  const ends = m[1] === '{' ? /\};?[ \t]*$/ : /\];?[ \t]*$/;
  let at = m.index, lines = 0;
  while (at < src.length && lines < 5000) {
    let nl = src.indexOf('\n', at); if (nl < 0) nl = src.length;
    if (ends.test(src.slice(at, nl))) {
      const code = src.slice(m.index, nl);
      try { evaluate(name, code); return code; } catch (e) { /* not balanced yet */ }
    }
    at = nl + 1; lines++;
  }
  throw new Error(`gen-fixture: ${name} never closes into an evaluable table (looked ${lines} lines)`);
}

function evaluate(name, code) {
  // `new Function` with no arguments: the table sees no scope but the globals,
  // so a row that reaches for another index.html constant throws here.
  const body = code.replace(new RegExp('^const ' + name + ' ='), 'return ');
  const v = new Function('"use strict";' + body)();
  if (!v || typeof v !== 'object') throw new Error(`gen-fixture: ${name} did not evaluate to an object`);
  return JSON.parse(JSON.stringify(v));          // plain data only; drops functions/undefined
}

export function build() {
  const src = lf(fs.readFileSync(INDEX, 'utf8'));
  const names = ['OPS_ECON', 'OP_LABELS', 'RESOURCES', 'SALVAGE_RES', 'LOOT_RES_IDS', 'STRUCTURE_SALVAGE'];
  const cut = {}, val = {};
  for (const n of names) { cut[n] = slice(src, n); val[n] = evaluate(n, cut[n]); }

  /* Key order is kept EXACTLY as index.html writes it, rows and nested maps
     alike. Round 1 sorted the keys inside a row for a "stable" file and that
     quietly reordered yields — trashcrusher's first-listed stream stopped
     being first, and a view that shows "the main product" reads the first
     key. JS object order is already deterministic from the source, so sorting
     bought nothing and cost fidelity. */
  const opsEcon = val.OPS_ECON;

  /* 🚛 Transport's gating phase lives in a module, not in index.html. It is a
     RULE, not a price, but it is still the game's to state — the fake bridge
     must not invent "phase 1" any more than it may invent a wage. */
  let transportPhase = 0;
  try {
    const m = /^export const PHASE = (\d+);/m.exec(lf(fs.readFileSync(ROUTES, 'utf8')));
    if (m) transportPhase = +m[1];
  } catch (e) {}

  const data = {
    opsEcon,
    opLabels: val.OP_LABELS,
    resources: val.RESOURCES,
    salvageRes: val.SALVAGE_RES,
    lootResIds: val.LOOT_RES_IDS,
    structureSalvage: val.STRUCTURE_SALVAGE,
    transportPhase,
  };
  return {
    _readme: 'GENERATED by tools/supplychain/gen-fixture.mjs from public/index.html. Never hand-edit; re-run the generator. `--check` detects drift.',
    source: {
      file: 'public/index.html',
      symbols: names,
      // Hash of the exact source text the tables were cut from (LF-normalised).
      // A comment edit inside OPS_ECON changes this and not dataHash — that is
      // deliberate: --check only fails on dataHash, the thing tests depend on.
      sourceHash: sha(names.map((n) => cut[n]).join('\n')),
      dataHash: sha(JSON.stringify(data)),
    },
    counts: {
      ops: Object.keys(opsEcon).length,
      labels: Object.keys(val.OP_LABELS).length,
      resources: val.RESOURCES.length,
      salvageRes: val.SALVAGE_RES.length,
      lootResIds: val.LOOT_RES_IDS.length,
      structureKinds: Object.keys(val.STRUCTURE_SALVAGE).length,
    },
    ...data,
  };
}

const text = (fx) => JSON.stringify(fx, null, 1) + '\n';

/* Drift = the DATA differs. Returns a list of human-readable differences so a
   failing gate says WHICH wage moved, not just "hash mismatch". */
export function drift(a, b) {
  const out = [];
  const walk = (x, y, p) => {
    if (JSON.stringify(x) === JSON.stringify(y)) return;
    const ox = x && typeof x === 'object', oy = y && typeof y === 'object';
    if (ox && oy && Array.isArray(x) === Array.isArray(y)) {
      const before = out.length;
      for (const k of new Set([...Object.keys(x), ...Object.keys(y)])) walk(x[k], y[k], p ? p + '.' + k : k);
      /* Same keys, same values, different ORDER. The strings differed (that is
         why we are here) yet no child did, so without this line a reordered
         `yields` was reported as zero drift — while build() above keeps the
         order precisely because views read the first yield as the main
         product. Order is data here, so it is drift here. */
      if (out.length === before) out.push(`${p}: key order — fixture [${Object.keys(x).join(', ')}] → index.html [${Object.keys(y).join(', ')}]`);
    } else out.push(`${p}: fixture ${JSON.stringify(x)} → index.html ${JSON.stringify(y)}`);
  };
  for (const k of ['opsEcon', 'opLabels', 'resources', 'salvageRes', 'lootResIds', 'structureSalvage', 'transportPhase']) walk(a[k], b[k], k);
  return out;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const mode = process.argv[2] || '';
  const fresh = build();
  if (mode === '--print') { process.stdout.write(text(fresh)); process.exit(0); }
  let old = null;
  try { old = JSON.parse(fs.readFileSync(FIXTURE, 'utf8')); } catch (e) {}
  if (mode === '--check') {
    if (!old) { console.error('gen-fixture --check: fixture.opsecon.json is missing or unreadable'); process.exit(1); }
    const d = drift(old, fresh);
    if (d.length) {
      console.error(`gen-fixture --check: DRIFT — ${d.length} difference(s) between the fixture and public/index.html:`);
      for (const l of d.slice(0, 40)) console.error('  ' + l);
      console.error('Re-run: node tools/supplychain/gen-fixture.mjs');
      process.exit(1);
    }
    console.log(`gen-fixture --check: ok — ${fresh.counts.ops} ops, dataHash ${fresh.source.dataHash.slice(0, 12)}`);
    process.exit(0);
  }
  const next = text(fresh);
  let prev = null;
  try { prev = lf(fs.readFileSync(FIXTURE, 'utf8')); } catch (e) {}
  if (prev === next) { console.log(`gen-fixture: unchanged (${fresh.counts.ops} ops, dataHash ${fresh.source.dataHash.slice(0, 12)})`); process.exit(0); }
  fs.writeFileSync(FIXTURE, next);
  console.log(`gen-fixture: wrote ${path.relative(REPO, FIXTURE)} — ${JSON.stringify(fresh.counts)}`);
}
