/* 🪵 bug-mttyizit — "Lumber Supply 0%" on every business that needs it,
   beside a Sawmill whose card says it is making lumber.

   Real cause (sim.js): firm upkeep and municipal procurement run AFTER
   production and both list lumber (and metalComponents, constructionComponents,
   electricity, freshWater). They bought every unit left in stock, so the
   next morning availabilityMap() found 0 lumber and every landlord firm
   (constructionComponents ← lumber + metalComponents + steel) was throttled to
   nothing — for ever, while the Sawmill kept producing. The fix: those two
   sinks may only take stock above one day of committed B2B demand.

   This drives the SHIPPED ecoBuildings() (lifted out of node-city) against the
   real /src/economy module on a node that has timber, iron ore and coal.
   Run: node _lumberreserve_smoke.mjs */
import { readFileSync } from 'fs';
import vm from 'vm';

let fails = 0;
const ok = (c, m, x) => { console.log((c ? '  PASS ' : '  FAIL ') + m + (c || x === undefined ? '' : '  ← ' + x)); if (!c) fails++; };
const NC = readFileSync('./public/node-city/index.html', 'utf8');
const SIM = readFileSync('./public/src/economy/sim.js', 'utf8');

function block(src, head, open = '{') {
  const at = src.indexOf(head); if (at < 0) return null;
  const close = open === '[' ? ']' : '}';
  let i = src.indexOf(open, at + head.length - 1); const st = at; let d = 0;
  for (; i < src.length; i++) {
    const c = src[i], e = src[i + 1];
    if (c === '/' && e === '*') { i = src.indexOf('*/', i + 2) + 1; continue; }
    if (c === '/' && e === '/') { i = src.indexOf('\n', i + 2); continue; }
    if (c === '"' || c === "'" || c === '`') { const q = c; i++; for (; i < src.length; i++) { if (src[i] === '\\') { i++; continue; } if (src[i] === q) break; } continue; }
    if (c === open) d++; else if (c === close) { d--; if (d === 0) return src.slice(st, i + 1); }
  }
  return null;
}
const lit = (h) => { const b = block(NC, h); return b && b.slice(b.indexOf('{')); };

/* ── 1. The two sinks go through the reservation (source pins) ─────────── */
const upkeep = block(SIM, 'function runFirmUpkeep(days)');
const procure = block(SIM, 'function runMunicipalSpending(days)');
ok(!!upkeep && /takeInv\(id, Math\.min\(affordable, spareInv\(id, \w+\)\)\)/.test(upkeep), 'runFirmUpkeep takes only stock above the B2B reservation');
ok(!!procure && /takeInv\(id, Math\.min\(affordable, spareInv\(id, \w+\)\)\)/.test(procure), 'runMunicipalSpending takes only stock above the B2B reservation');

/* ── 2. Driven ──────────────────────────────────────────────────────────── */
const ECO = vm.runInNewContext('(' + lit('const ECO_BUILDING_MAP = {') + ')');
const OP = vm.runInNewContext('(' + lit('const OP_ECO_MAP = {') + ')');
globalThis.window = { MythicCityBridge: { addCinders: async () => {} }, MythicResourceChain: null };
const chain = await import('./public/src/resources/chain.js');
window.MythicResourceChain = { ALL: chain.RESOURCE_CHAIN };
const E = (await import('./public/src/economy/index.js')).default;
const Endow = await import('./public/src/economy/endowment.js');
const Firms = await import('./public/src/economy/firms.js');
console.warn = () => {}; console.info = () => {};

const NEED = ['timber', 'ironOre', 'coal', 'rawWater'];
let NODE = null;
for (let i = 0; i < 3000 && !NODE; i++) { const n = 'lum-' + i; if (NEED.every((id) => Endow.canExtract(n, id))) NODE = n; }
ok(!!NODE, 'found a node carrying ' + NEED.join(', '), NODE);

const FNS = ['function _ecoSeamRank(E, list)', 'function _ecoIsSeamRow(E, m)', 'function ecoBuildings()'].map((h) => block(NC, h));
const game = { tiles: {} };
const map = Object.assign({}, ECO); for (const t of Object.keys(OP)) map['op_' + t] = OP[t];
const ctx = { window, game, BUILDINGS: {}, bldSite: () => false, Object, Array, String };
vm.createContext(ctx);
vm.runInContext('const ECO_BUILDING_MAP = ' + JSON.stringify(map) + ';\n' + FNS.join('\n') + '\nthis.ecoBuildings = ecoBuildings;', ctx);
let n = 0; const put = (type, c = 1) => { for (let i = 0; i < c; i++) game.tiles[(n++) + ',0'] = { type, lvl: 1 }; };
// The reporter's shape: Lumber Camps feeding a Sawmill, housing (landlord firms
// make constructionComponents), a Munitions works for metalComponents, steel.
put('lumbercamp', 2); put('sawmill'); put('scrapmine', 3); put('smelter'); put('steelmill'); put('munitions');
put('powerstation', 2); put('waterintake', 2); put('purifier', 2); put('housing', 6); put('op_construction');

E.mount({ nodeId: NODE, population: 200, established: false });
const H = { powerFactor: 1, waterFactor: 1, hasBank: true, infrastructure: 0.8, logisticsCounts: { warehouse: 3, depot: 3 }, population: 200 };
const rows = {}; let auditBad = 0, lumberMade = 0;
for (let d = 0; d < 60; d++) {
  E.syncBuildings(ctx.ecoBuildings()); E.tick(24 * 60, H);
  const a = E.audit(); if (a && a.ok === false) auditBad++;
  if (d < 40) continue;
  lumberMade += Firms.byOutput('lumber').reduce((s, f) => s + (f.lastProduced || 0), 0);
  for (const f of Firms.alive()) for (const c of (f.lastConstraints || [])) if (c.key === 'lumber' || c.key === 'metalComponents') {
    const r = rows[c.key] || (rows[c.key] = { n: 0, sum: 0 }); r.n++; r.sum += c.pct;
  }
}
const avg = (k) => (rows[k] ? rows[k].sum / rows[k].n : null);
console.log('     last 20 days: lumber made ' + lumberMade.toFixed(0) + ', Lumber Supply avg ' + avg('lumber') +
            ', Metal Components Supply avg ' + avg('metalComponents') + ', INV.lumber ' + (E.inventory().lumber || 0).toFixed(1));
ok(lumberMade > 0, 'the Sawmill firm makes lumber', lumberMade.toFixed(1));
ok(avg('lumber') != null && avg('lumber') > 0.5, 'businesses that need lumber see it (Lumber Supply > 50%, was 0%)', String(avg('lumber')));
/* ⚠ Metal Components Supply stays 0% in THIS city and that is correct: nothing
   here makes sheet metal, so the Munitions works is "Nobody makes it" upstream.
   The reservation covers metalComponents too once it is made; it is printed
   above for the record, not asserted. */
ok((E.inventory().lumber || 0) > 0, 'lumber survives the night in the city stock', String(E.inventory().lumber));
ok(auditBad === 0, 'the closed-loop Cinder audit stayed clean every day', auditBad + ' bad days');

console.log(fails ? '\n' + fails + ' FAILED' : '\nALL PASS');
process.exit(fails ? 1 : 0);
