/* CRITIC driver 2 — what the GROUND GATE refuses, over a 500-node census.
   ----------------------------------------------------------------------------
   🔴 THIS USED TO RE-IMPLEMENT THE GATE AND THAT MADE IT BLIND.
   The first version carried its own copy of the all-deposit rows, its own copy
   of `pickAvailable`, and its own hardcoded `gen:` column — and applied the rule
   "refuse when no output is in the ground" itself. It measured the rule the
   critic had in mind rather than the rule node-city ships, so when the gate was
   FIXED to wave `gen:` tiles through, this driver printed byte-identical
   numbers and would have reported the regression as unfixed for ever.

   So it now lifts the shipped `ecoGroundRefusal()` body straight out of
   node-city/index.html and calls it, with ECO_BUILDING_MAP and BUILDINGS
   scraped from the same file. It cannot disagree with the game, because it IS
   the game's function. Same technique run.mjs round0h uses on weatherMult().

   endowment.js and recipes.js are imported as themselves — pure node, no
   browser, no server. */
import { readFileSync } from 'fs';
import { pathToFileURL } from 'url';
const ROOT = '/home/user/Playmythicspellbook';
/* CRIT_SEAM_HTML points the scrape at a doctored copy, so "can this driver
   still go red" is answerable without ever editing the shipped file. */
const HTML = readFileSync(process.env.CRIT_SEAM_HTML || (ROOT + '/public/node-city/index.html'), 'utf8');
const R = await import(pathToFileURL(ROOT + '/public/src/economy/recipes.js').href);
const E = await import(pathToFileURL(ROOT + '/public/src/economy/endowment.js').href);

/* Brace-matcher that steps over comments and strings — the same one every other
   driver in this folder carries, and for the same reason: the literals live
   inside a 25,000-line HTML file full of prose containing braces. */
const srcBlockAfter = (src, decl, open) => {
  open = open || '{'; const close = open === '[' ? ']' : '}';
  const at = src.indexOf(decl); if (at < 0) return null;
  let i = src.indexOf(open, at + decl.length - 1); if (i < 0) return null;
  const start = i; let depth = 0;
  for (; i < src.length; i++) {
    const c = src[i], d = src[i + 1];
    if (c === '/' && d === '*') { const e = src.indexOf('*/', i + 2); if (e < 0) return null; i = e + 1; continue; }
    if (c === '/' && d === '/') { const e = src.indexOf('\n', i + 2); if (e < 0) return null; i = e; continue; }
    if (c === '"' || c === "'" || c === '`') { const q = c; i++; for (; i < src.length; i++) { if (src[i] === '\\') { i++; continue; } if (src[i] === q) break; } continue; }
    if (c === open) depth++; else if (c === close) { depth--; if (depth === 0) return src.slice(start, i + 1); }
  }
  return null;
};
/* BUILDINGS cites module-scope constants (STOCK_CAP_PER_WAREHOUSE and friends),
   so it is evaluated inside a `with` over a Proxy that answers 1 to anything —
   round0b does the identical thing for the identical reason. Nothing this
   driver reads off BUILDINGS is one of those values. */
const scope = new Proxy({}, { has: () => true, get: (o, k) => k === Symbol.unscopables ? undefined : 1 });
const lit = (decl) => { const t = srcBlockAfter(HTML, decl); if (!t) return null;
  try { return (new Function('S', 'with(S){return (' + t + ');}'))(scope); } catch (e) { return null; } };

const ECO = lit('const ECO_BUILDING_MAP = {');
const BUILDINGS = lit('const BUILDINGS = {');
const GATE_BODY = srcBlockAfter(HTML, 'function ecoGroundRefusal(type)');
const LABEL_BODY = srcBlockAfter(HTML, 'function _ecoResLabel(id)');
if (!ECO || !BUILDINGS || !GATE_BODY || !LABEL_BODY) {
  console.log('🔴 COULD NOT READ THE SHIPPED GATE — nothing below would mean anything.');
  console.log('   ECO_BUILDING_MAP=' + !!ECO + ' BUILDINGS=' + !!BUILDINGS +
              ' ecoGroundRefusal=' + !!GATE_BODY + ' _ecoResLabel=' + !!LABEL_BODY);
  process.exit(1);
}

/* pickAvailable, as economy/index.js defines it, against one node at a time. */
let NODE = null;
const pick = (out) => {
  let best = null, bestRank = -1;
  for (const id of out) {
    if (!R.producible(id)) continue;
    if (!R.isDeposit(id)) return id;
    if (!E.canExtract(NODE, id)) continue;
    const rank = (E.gradeDef(E.gradeOf(NODE, id)) || {}).rank || 0;
    if (rank > bestRank) { bestRank = rank; best = id; }
  }
  return best;
};
/* The seams this driver drives. `opsTypeOf` answers null because no op tile is
   under test here — the gate's §1 exemption for licensed operations is proved
   by crit-seam-4 against the live page. */
const gate = (new Function('window', 'ECO_BUILDING_MAP', 'BUILDINGS', 'opsTypeOf',
  'function _ecoResLabel(id) ' + LABEL_BODY + '\n' +
  'function ecoGroundRefusal(type) ' + GATE_BODY + '\n' +
  'return ecoGroundRefusal;'))(
    { MythicEconomy: { ready: () => true, pickAvailable: pick, recipes: { isDeposit: R.isDeposit } } },
    ECO, BUILDINGS, () => null);

// every all-deposit row in the shipped map — derived, never listed here again
const ROWS = {};
for (const [k, m] of Object.entries(ECO))
  if (m && Array.isArray(m.out) && m.out.length && m.out.every(id => R.isDeposit(id))) ROWS[k] = m.out;

const N = Number(process.argv[2] || 500);
const ids = Array.from({ length: N }, (_, i) => 'crit-node-' + i);
const refused = {}, groundless = {};
for (const k in ROWS) { refused[k] = 0; groundless[k] = 0; }
for (const id of ids) {
  NODE = id;
  for (const k in ROWS) {
    if (gate(k)) refused[k]++;
    if (!pick(ROWS[k])) groundless[k]++;      // the node truly carries none of its seams
  }
}

const genOf = (k) => { const g = (BUILDINGS[k] || {}).gen;
  return g ? Object.keys(g).map(r => r + ' ' + g[r]).join(', ') : '—'; };
console.log('Nodes sampled: ' + N + '   (gate lifted from public/node-city/index.html)\n');
console.log('BUILDING        city gen:              no seams here   REFUSED by the gate');
for (const k of Object.keys(ROWS)) {
  console.log(k.padEnd(15) + genOf(k).padEnd(23) +
    String(groundless[k]).padStart(9) + '  ' + (100 * groundless[k] / N).toFixed(1).padStart(5) + '%' +
    String(refused[k]).padStart(9) + '  ' + (100 * refused[k] / N).toFixed(1).padStart(5) + '%');
}

/* ── THE TWO HALVES OF THE RULE, EACH ASSERTED ─────────────────────────────
   Fixing one and breaking the other is not a fix, so both are printed with a
   verdict rather than left for a reader to eyeball off the table above. */
let bad = 0;
const say = (ok, msg) => { if (!ok) bad++; console.log((ok ? '✅ ' : '❌ ') + msg); };
console.log('');
const withGen = Object.keys(ROWS).filter(k => (BUILDINGS[k] || {}).gen);
const noGen   = Object.keys(ROWS).filter(k => !(BUILDINGS[k] || {}).gen);
say(withGen.every(k => refused[k] === 0),
    'every `gen:` tile is refused on ZERO nodes — it feeds the city ledger whatever the ' +
    'ground holds  [' + withGen.join(', ') + ']  ' +
    withGen.map(k => k + '=' + refused[k]).filter(x => !/=0$/.test(x)).join(' ') );
say(noGen.every(k => refused[k] === groundless[k]),
    'every chain-only tile is refused on EXACTLY the nodes that carry none of its seams  [' +
    noGen.join(', ') + ']  ' +
    noGen.filter(k => refused[k] !== groundless[k]).map(k => k + ' ' + refused[k] + '≠' + groundless[k]).join(' '));
say(noGen.some(k => refused[k] > 0),
    'the gate still bites at all — at least one chain-only tile is refused somewhere');
console.log(bad ? '\n=== ' + bad + ' FAILED ===' : '\n=== BOTH HALVES HOLD ===');
process.exit(bad ? 1 : 0);
