/* 🏭 OPERATIONS WIRING CHECK — an operation that exists must be BUYABLE.

   THIS FILE EXISTS BECAUSE IT HAS HAPPENED FIVE TIMES. The catalog a player
   buys from lives in public/corp/screens.jsx as a hardcoded array; the price,
   the label and the economics live in public/index.html. Adding an operation to
   one and not the other produces a business that is priced, labelled, staffed
   and impossible to buy — and nothing fails, so it ships.

   screens.jsx already carries two comments warning about exactly this:
     · warehouse — "this catalog is hardcoded here, so a type added to OPS_ECON
       in index.html is invisible until it is listed in this array too."
     · transport — "Fourth operation to hit that: Warehouse, Weapon Smith,
       Restaurant, and this one caught before it shipped rather than after."

   The Trash Crusher (v121u3) was the fifth and the first to reach players. It
   passed the economy gauntlet, five edge checks and a full deploy, because none
   of those look at this pairing. A comment is not a gate. This is the gate.

   🔴 AND THE SAME SHAPE RUNS THE OTHER WAY, INTO THE CITY. The Genetics Lab and
      the Weapon Smith were the sixth and seventh: priced in OPS_ECON, carded in
      screens.jsx, named in OP_LABELS (and the smith doored in COMPANY_PAGES) —
      rounds 1–5 all green — and absent from node-city's OP_BP, the table the city's
      Operations palette is actually built from (OPS_TYPES = Object.keys(OP_BP)).
      A comment on OP_BP.transport said the palette came from OPS_ECON, so a
      reader trusting it had no reason to look. Measured: OPS_ECON 22 ids, OP_BP
      20, diff ['genelab', 'weaponsmith'] — two businesses you could buy for
      550,000 and 600,000 🔥 and could not place in any city. Round 7 closes it.

   Run: node _opscheck.mjs        (exits non-zero on a mismatch)
*/
import { readFileSync } from 'fs';

let fails = 0;
const ok = (c, m, x) => { console.log((c ? '  PASS ' : '  FAIL ') + m + (c || x === undefined ? '' : '  ← ' + x)); if (!c) fails++; };

const IDX = readFileSync('./public/index.html', 'utf8');
const SCREENS = readFileSync('./public/corp/screens.jsx', 'utf8');
const SHELL = readFileSync('./public/corp/shell.jsx', 'utf8');
const NC = readFileSync('./public/node-city/index.html', 'utf8');

/* Keys of a top-level `const NAME = { ... }` object literal, read by brace
   depth so a nested object in a row cannot end the scan early. */
function objectKeys(src, decl) {
  const i = src.indexOf(decl);
  if (i < 0) throw new Error('cannot find ' + decl);
  const open = src.indexOf('{', i);
  let d = 0, end = -1;
  for (let j = open; j < src.length; j++) {
    const c = src[j];
    if (c === '{') d++;
    else if (c === '}') { d--; if (d === 0) { end = j; break; } }
  }
  if (end < 0) throw new Error('unbalanced ' + decl);
  /* ⚠ SEVERAL KEYS PER LINE IS NORMAL HERE, and a line-anchored regex misses
     every one after the first. OP_LABELS is written
        mining: 'Mining Company', oil: 'Oil Company', construction: '…',
     so the first draft of this parser reported 12 of 22 names and round 3 went
     red on ten operations that are perfectly fine. Walk the body character by
     character instead, tracking depth, and take every key at depth 0 — a
     key inside a nested object or array is a field, not an operation. */
  const body = src.slice(open + 1, end);
  const keys = [];
  let depth = 0, quote = null;
  for (let j = 0; j < body.length; j++) {
    const c = body[j];
    if (quote) { if (c === '\\') j++; else if (c === quote) quote = null; continue; }
    if (c === "'" || c === '"' || c === '`') { quote = c; continue; }
    if (c === '/' && body[j + 1] === '*') { const e = body.indexOf('*/', j + 2); j = e < 0 ? body.length : e + 1; continue; }
    if (c === '/' && body[j + 1] === '/') { const e = body.indexOf('\n', j + 2); j = e < 0 ? body.length : e; continue; }
    if (c === '{' || c === '[' || c === '(') { depth++; continue; }
    if (c === '}' || c === ']' || c === ')') { depth--; continue; }
    if (depth !== 0) continue;
    const m = /^([A-Za-z_][A-Za-z0-9_]*)\s*:/.exec(body.slice(j));
    if (m) {
      const before = body[j - 1];
      if (before === undefined || /[\s,{]/.test(before)) { keys.push(m[1]); j += m[0].length - 1; }
    }
  }
  return keys;
}

/* `id: 'x'` entries of a top-level array literal. */
function arrayIds(src, decl) {
  const i = src.indexOf(decl);
  if (i < 0) throw new Error('cannot find ' + decl);
  const open = src.indexOf('[', i);
  let d = 0, end = -1;
  for (let j = open; j < src.length; j++) {
    const c = src[j];
    if (c === '[') d++;
    else if (c === ']') { d--; if (d === 0) { end = j; break; } }
  }
  if (end < 0) throw new Error('unbalanced ' + decl);
  return [...src.slice(open, end).matchAll(/\{\s*id:\s*'([A-Za-z0-9_]+)'/g)].map((m) => m[1]);
}

const OPS_ECON   = objectKeys(IDX, 'const OPS_ECON = {');
const OP_LABELS  = objectKeys(IDX, 'const OP_LABELS = {');
const REGISTRY   = arrayIds(SCREENS, 'const OPERATIONS = [');
const COMPANY    = objectKeys(SHELL, 'const COMPANY_PAGES = {');
const OP_BP      = objectKeys(NC, 'const OP_BP = {');
const OP_ECO_MAP = objectKeys(NC, 'const OP_ECO_MAP = {');

console.log('\n=== 0. every table was actually read ===');
ok(OPS_ECON.length >= 15, 'OPS_ECON: ' + OPS_ECON.length + ' operations', OPS_ECON.length);
ok(REGISTRY.length >= 15, 'corp registry OPERATIONS: ' + REGISTRY.length + ' cards', REGISTRY.length);
ok(OP_LABELS.length >= 15, 'OP_LABELS: ' + OP_LABELS.length + ' names', OP_LABELS.length);
ok(OP_BP.length >= 15, 'node-city OP_BP: ' + OP_BP.length + ' blueprints', OP_BP.length);
ok(COMPANY.length >= 5, 'COMPANY_PAGES: ' + COMPANY.length + ' in-game doors', COMPANY.length);

console.log('\n=== 1. THE ONE THAT SHIPPED FIVE TIMES — priced but unbuyable ===');
const unbuyable = OPS_ECON.filter((id) => !REGISTRY.includes(id));
ok(unbuyable.length === 0,
   'every OPS_ECON operation has a card in the corp registry',
   'priced in index.html, absent from screens.jsx: [' + unbuyable.join(', ') + ']');

console.log('\n=== 2. …and the mirror of it — a card nobody can be charged for ===');
const unpriced = REGISTRY.filter((id) => !OPS_ECON.includes(id));
ok(unpriced.length === 0,
   'every registry card has an OPS_ECON row behind it',
   'on the shelf with no price: [' + unpriced.join(', ') + ']');

console.log('\n=== 3. the shop shows a NAME, not a raw key ===');
const unnamed = OPS_ECON.filter((id) => !OP_LABELS.includes(id));
ok(unnamed.length === 0,
   'every OPS_ECON operation has an OP_LABELS entry',
   'would render as its raw id: [' + unnamed.join(', ') + ']');

console.log('\n=== 4. a city blueprint implies a business ===');
/* OP_BP without OP_ECO_MAP is a building that employs nobody. Three of these
   are LICENCES and argued for in run.mjs — a licence's product is the right to
   build something else, so it has no firm. That set is named, not inferred, so
   widening it is a decision somebody has to make on purpose.
   🔴 THIS USED TO BE `noFirm.length <= 2`, WITH transport AND restaurant AS THE
      TWO. That is not a gate, it is a baseline with a hole the size of the bug:
      an allowance of two UNNAMED ops meant a third firm-less operation could
      take either one's place and this round would stay green. Measured before
      the fix (HEAD, 2026-09-04): OP_BP 22, OP_ECO_MAP 17, without a business
      [transport, restaurant, bank, bus, rail]. Both now have a row, so the
      firm-less set is asserted EXACTLY — same set, same shape as run.mjs
      round0b — and the check after it names the two by hand so a parser that
      returned [] for OP_ECO_MAP cannot pass this quietly. */
const LICENCE_OPS = ['bank', 'bus', 'rail'];
const noFirm = OP_BP.filter((id) => !OP_ECO_MAP.includes(id));
ok(noFirm.length === LICENCE_OPS.length && LICENCE_OPS.every((id) => noFirm.includes(id)),
   'the firm-less set is exactly the three licences [' + LICENCE_OPS.join(', ') + ']',
   'without a business: [' + noFirm.join(', ') + ']');
for (const id of ['transport', 'restaurant'])
  ok(OP_ECO_MAP.includes(id), '`' + id + '` has an OP_ECO_MAP row — the operation this round was tightened for');

console.log('\n=== 5. a My Companies door needs a business to open ===');
const orphanDoor = COMPANY.filter((id) => !OPS_ECON.includes(id));
ok(orphanDoor.length === 0,
   'every COMPANY_PAGES entry is keyed on a real OPS_ECON id',
   'door to nowhere: [' + orphanDoor.join(', ') + ']');

console.log('\n=== 6. ANTI-VACUITY — the checks can still fail ===');
/* If a parser silently returned [], rounds 1-3 would pass over empty sets.
   Assert a known operation is present in each table, by name. */
for (const [label, arr] of [['OPS_ECON', OPS_ECON], ['registry', REGISTRY], ['OP_LABELS', OP_LABELS]])
  ok(arr.includes('mining'), '`mining` is in ' + label + ' — the table really parsed');
ok(REGISTRY.includes('trashcrusher'),
   '`trashcrusher` is in the registry — the operation this check was written for');

console.log('\n=== 7. a business you can buy is a building you can place ===');
/* OPS_ECON ⊆ OP_BP. Round 1 is "priced but not on the shelf"; this is "bought
   but nowhere to stand". The city palette is OPS_TYPES = Object.keys(OP_BP),
   so an OPS_ECON id with no OP_BP row is a licence a player pays for at City
   Hall and then cannot find in the build shop of any city — and, exactly as
   with round 1, nothing fails: the buy succeeds, the row lands in
   corp_operations, and the Operations section simply does not list it.
   Every id, no allowlist: the three licences (bank, bus, rail) HAVE OP_BP rows
   — a licence is placed, it just founds no firm (round 4) — so there is no
   honest reason for any OPS_ECON id to be missing here. */
const unplaceable = OPS_ECON.filter((id) => !OP_BP.includes(id));
ok(unplaceable.length === 0,
   'every OPS_ECON operation has a node-city OP_BP blueprint',
   'buyable at City Hall, absent from the city palette: [' + unplaceable.join(', ') + ']');
/* Anti-vacuity for this round specifically: the two operations it was written
   for must be present by name, so a parser that returned [] for OP_BP (which
   would make `unplaceable` the whole of OPS_ECON, and round 0 would catch it)
   or one that returned OPS_ECON's own keys by mistake cannot pass it quietly. */
for (const id of ['genelab', 'weaponsmith'])
  ok(OP_BP.includes(id), '`' + id + '` is in OP_BP — the operation this round was written for');

console.log(fails ? '\n❌ ' + fails + ' FAILURES' : '\n✅ ALL CHECKS PASSED');
process.exit(fails ? 1 : 0);
