/* ══════════════════════════════════════════════════════════════════════════
   📒 PROMOTE-DERIVE — what the ledger is MISSING, computed the gate's own way.

   round0p of tools/economy-tests/run.mjs owns the promotion rule:

     PROMOTED_CHAIN_IDS = { every `out` of node-city's ECO_BUILDING_MAP, with
                            the OP_ECO_MAP ops join applied under OPS_PREFIX }
                          INTERSECT chain.NEW_IDS

   production.data.js says "DO NOT EDIT BY HAND — change the map and let the
   gate tell you", and the materials tier did change the map: the derivation
   now yields 92 ids while the file still lists 71 and index.html's RESOURCES
   holds 87 of an expected 106. So the city makes 21 materials a player cannot
   see or hold.

   ⚠ THIS FILE ONLY READS AND REPORTS. It writes nothing. The derivation is
     re-implemented here to MATCH round0p line for line — if the two ever
     disagree, round0p is the authority and this file is the bug.

   Run:  node .gauntlet/promote-derive.mjs
   ══════════════════════════════════════════════════════════════════════════ */
import { readFileSync } from 'fs';
import path from 'path';

const NCP = path.resolve(process.cwd(), 'public/node-city/index.html');
const IDXP = path.resolve(process.cwd(), 'public/index.html');
const NC = readFileSync(NCP, 'utf8');
const IDX = readFileSync(IDXP, 'utf8');

if (!global.window) global.window = { MythicCityBridge: { addCinders: async () => {} } };
const chain = await import('../public/src/resources/chain.js');
const PD = await import('../public/src/city/production.data.js');

/* ── the two maps and the ops prefix, scraped as round0p scrapes them ────── */
function objLit(src, decl) {
  const s0 = src.indexOf(decl);
  if (s0 < 0) return null;
  const open = src.indexOf('{', s0);
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (!depth) return src.slice(open, i + 1); }
  }
  return null;
}
const parseMap = (lit) => {
  const m = {};
  if (!lit) return m;
  for (const r of lit.matchAll(/(\w+):\s*\{\s*out:\s*\[([^\]]*)\]/g)) {
    m[r[1]] = { out: [...r[2].matchAll(/'([^']+)'/g)].map((q) => q[1]) };
  }
  return m;
};
const STATIC = parseMap(objLit(NC, 'const ECO_BUILDING_MAP = {'));
const OPMAP = parseMap(objLit(NC, 'const OP_ECO_MAP = {'));
const PREFIX = (NC.match(/const OPS_PREFIX\s*=\s*'([^']*)'/) || [])[1] || '';

const MAP = { ...STATIC };
for (const t of Object.keys(OPMAP)) MAP[PREFIX + t] = OPMAP[t];

const outs = new Set();
for (const k of Object.keys(MAP)) for (const o of (MAP[k].out || [])) outs.add(o);
const NEWSET = new Set(chain.NEW_IDS);
const DERIVED = Array.from(outs).filter((id) => NEWSET.has(id)).sort();

console.log('the derivation');
console.log('  ECO_BUILDING_MAP ' + Object.keys(STATIC).length + ' + OP_ECO_MAP ' +
            Object.keys(OPMAP).length + ' (prefix "' + PREFIX + '") = ' + Object.keys(MAP).length + ' buildings');
console.log('  distinct outputs ' + outs.size + ' | catalogue NEW_IDS ' + chain.NEW_IDS.length);
console.log('  → PROMOTED_CHAIN_IDS should be ' + DERIVED.length + ' ids\n');

/* ── 1. production.data.js ───────────────────────────────────────────────── */
const PROMOTED = PD.PROMOTED_CHAIN_IDS.slice().sort();
const addPD = DERIVED.filter((x) => !PROMOTED.includes(x));
const dropPD = PROMOTED.filter((x) => !DERIVED.includes(x));
console.log('1. production.data.js PROMOTED_CHAIN_IDS — has ' + PROMOTED.length + ', needs ' + DERIVED.length);
console.log('   ADD (' + addPD.length + '): ' + (addPD.join(', ') || '- none -'));
console.log('   DROP (' + dropPD.length + '): ' + (dropPD.join(', ') || '- none -'));

/* ── 2. index.html RESOURCES ─────────────────────────────────────────────── */
/* 🔴 RESOURCES IS AN ARRAY — BALANCE BRACKETS, NOT BRACES. objLit() above
   walks {...} and, pointed at `const RESOURCES = [`, stopped at the close of
   the FIRST ROW: it reported a 1-id ledger and therefore "92 missing", which
   would have been read as the whole ledger being empty. Exactly the class of
   instrument error the drive-bootstrap post-mortem is about, so it is fixed
   here rather than worked around at the call site. */
function arrLit(src, decl) {
  const s0 = src.indexOf(decl);
  if (s0 < 0) return null;
  const open = src.indexOf('[', s0);
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '[') depth++;
    else if (src[i] === ']') { depth--; if (!depth) return src.slice(open, i + 1); }
  }
  return null;
}
const resLit = arrLit(IDX, 'const RESOURCES = [');
if (!resLit) throw new Error('could not read the RESOURCES array');
const RIDS = [...String(resLit).matchAll(/\{\s*id:\s*'([^']+)'/g)].map((m) => m[1]);
if (RIDS.length < 10) throw new Error('RESOURCES scrape returned only ' + RIDS.length + ' ids — the scrape is broken, not the ledger');
const missingRes = DERIVED.filter((id) => !RIDS.includes(id));
const unjustified = RIDS.filter((id) => !NEWSET.has(id) === false && !DERIVED.includes(id));
console.log('\n2. index.html RESOURCES — has ' + RIDS.length + ', needs 14 legacy + ' + DERIVED.length +
            ' = ' + (14 + DERIVED.length));
console.log('   MISSING (' + missingRes.length + '): ' + (missingRes.join(', ') || '- none -'));
console.log('   in RESOURCES, is a chain id, but NOT derived (' + unjustified.length + '): ' +
            (unjustified.join(', ') || '- none -'));

/* ── 3. the rows themselves, straight out of the catalogue ───────────────── */
const ALL = chain.RESOURCE_CHAIN || {};
const rowOf = (id) => {
  const c = Array.isArray(ALL) ? ALL.find((r) => r && r.id === id) : ALL[id];
  return c || null;
};
console.log('\n3. the rows to write — name/icon/colour must match chain.js VERBATIM');
const noRow = [];
for (const id of missingRes) {
  const c = rowOf(id);
  if (!c) { noRow.push(id); continue; }
  const pad = (s, n) => (String(s) + "',").padEnd(n);
  console.log("   { id: '" + pad(id, 26) + " name: '" + pad(c.name || id, 26) +
              " icon: '" + (c.icon || '?') + "', color: '" + (c.color || c.colour || '#888') + "' },");
}
if (noRow.length) console.log('   🔴 NO CATALOGUE ROW for: ' + noRow.join(', '));

/* ── 4. the pre-existing pair, kept separate on purpose ──────────────────── */
console.log('\n4. SEPARATE, PRE-EXISTING — not part of this promotion');
const producers = new Set();
for (const k of Object.keys(MAP)) for (const o of (MAP[k].out || [])) producers.add(o);
for (const id of ['weaponParts', 'gunOil']) {
  console.log('   ' + id.padEnd(14) + 'in RESOURCES: ' + (RIDS.includes(id) ? 'yes' : 'no') +
              ' | a building yields it: ' + (producers.has(id) ? 'yes' : 'NO') +
              ' | in the chain catalogue: ' + (rowOf(id) ? 'yes' : 'no'));
}
console.log('\n   These two are in the ledger with no producer and no price. They predate the\n' +
            '   materials tier and need a DECISION (give them a producer, or move them to\n' +
            '   LOOT_RES_IDS) — promoting the 21 above will not clear them.');
