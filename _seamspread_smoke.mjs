/* ⛏ bug-mu2tq6op — "Gas Station needs Crude Oil (Nobody makes it), but my
   thirteen Fuel Rigs make crude". Every tile of a multi-seam extractor used to
   work the ONE best seam of the node, so on a gas-graded node no Fuel Rig firm
   ever made crudeOil. ecoBuildings() now spreads further tiles over the seams
   the ground supports, stamping the choice on the tile (t.eco, saved).

   This drives the SHIPPED ecoBuildings / _ecoSeamRank / _ecoIsSeamRow, lifted
   out of node-city, against the real /src/economy module.
   Run: node _seamspread_smoke.mjs */
import { readFileSync } from 'fs';
import vm from 'vm';

let fails = 0;
const ok = (c, m, x) => { console.log((c ? '  PASS ' : '  FAIL ') + m + (c || x === undefined ? '' : '  ← ' + x)); if (!c) fails++; };
const NC = readFileSync('./public/node-city/index.html', 'utf8');

// Brace-match a block starting at `head`, stepping over comments and strings.
function block(src, head) {
  const at = src.indexOf(head); if (at < 0) return null;
  let i = src.indexOf('{', at + head.length - 1); const st = at; let d = 0;
  for (; i < src.length; i++) {
    const c = src[i], e = src[i + 1];
    if (c === '/' && e === '*') { i = src.indexOf('*/', i + 2) + 1; continue; }
    if (c === '/' && e === '/') { i = src.indexOf('\n', i + 2); continue; }
    if (c === '"' || c === "'" || c === '`') { const q = c; i++; for (; i < src.length; i++) { if (src[i] === '\\') { i++; continue; } if (src[i] === q) break; } continue; }
    if (c === '{') d++; else if (c === '}') { d--; if (d === 0) return src.slice(st, i + 1); }
  }
  return null;
}
const MAPTXT = block(NC, 'const ECO_BUILDING_MAP = {');
const FNS = ['function _ecoSeamRank(E, list)', 'function _ecoIsSeamRow(E, m)', 'function ecoBuildings()'].map((h) => block(NC, h));
ok(!!MAPTXT && FNS.every(Boolean), 'lifted ECO_BUILDING_MAP and the three seam functions from node-city');
ok(/\.\.\.\(\(typeof t\.eco === 'string' && t\.eco\) \? \{ eco: t\.eco \} : \{\}\)/.test(NC), 'serialize() writes the stamp');
ok(/eco: \(typeof td\.eco === 'string' && td\.eco\) \? td\.eco : null,/.test(NC), 'loadState() reads it back');

globalThis.window = { MythicCityBridge: { addCinders: async () => {} }, MythicResourceChain: null };
const chain = await import('./public/src/resources/chain.js');
window.MythicResourceChain = { ALL: chain.RESOURCE_CHAIN };
const E = (await import('./public/src/economy/index.js')).default;
const Endow = await import('./public/src/economy/endowment.js');
console.warn = () => {}; console.info = () => {};

// A node where BOTH oil seams exist and natural gas grades higher — the report's ground.
let NODE = null;
for (let i = 0; i < 2000 && !NODE; i++) {
  const n = 'seam-' + i;
  if (!Endow.canExtract(n, 'crudeOil') || !Endow.canExtract(n, 'naturalGas')) continue;
  const g = (id) => (Endow.gradeDef(Endow.gradeOf(n, id)) || {}).rank || 0;
  if (g('naturalGas') > g('crudeOil')) NODE = n;
}
ok(!!NODE, 'found a node whose best oil seam is natural gas', NODE);
E.mount({ nodeId: NODE, population: 200, established: 'new' });
ok(E.pickAvailable(['crudeOil', 'naturalGas']) === 'naturalGas', 'pickAvailable still answers the best seam (gas) — the per-node question is unchanged');

const game = { tiles: {} };
const ctx = { window, game, BUILDINGS: {}, bldSite: () => false, Object, Array, String };
vm.createContext(ctx);
vm.runInContext('const ECO_BUILDING_MAP = ' + MAPTXT.slice(MAPTXT.indexOf('{')) + ';\n' + FNS.join('\n') + '\nthis.ecoBuildings = ecoBuildings;', ctx);
const outs = () => ctx.ecoBuildings().filter((b) => b.ind === 'oilfield').map((b) => b.key + '=' + b.out);

game.tiles['0,0'] = { type: 'fuelrig', lvl: 1 };
ok(outs().join() === '0,0=naturalGas', 'a lone Fuel Rig works the best seam, exactly as before', outs().join());
for (const k of ['1,0', '2,0', '3,0']) game.tiles[k] = { type: 'fuelrig', lvl: 1 };
const four = outs();
const nCrude = four.filter((s) => s.endsWith('crudeOil')).length;
ok(nCrude === 2 && four.length === 4, 'four rigs split 2 crude / 2 gas (was 0 crude / 4 gas)', four.join(' '));
ok(four[0] === '0,0=naturalGas', 'the first rig kept its seam — adding rigs re-founds nothing', four[0]);
const before = Object.fromEntries(four.map((s) => s.split('=')));
delete game.tiles['1,0'];
game.tiles['9,9'] = { type: 'fuelrig', lvl: 1 };
const after = Object.fromEntries(outs().map((s) => s.split('=')));
ok(['0,0', '2,0', '3,0'].every((k) => after[k] === before[k]), 'demolishing one rig and building another moves no surviving rig', JSON.stringify(after));
// a save round trip: the stamp is what comes back
const saved = JSON.parse(JSON.stringify(Object.fromEntries(Object.entries(game.tiles).map(([k, t]) => [k, { type: t.type, ...(t.eco ? { eco: t.eco } : {}) }]))));
game.tiles = {}; ctx.game = game;
for (const k of Object.keys(saved).reverse()) game.tiles[k] = { type: saved[k].type, lvl: 1, eco: saved[k].eco || null };
const reloaded = Object.fromEntries(ctx.ecoBuildings().filter((b) => b.ind === 'oilfield').map((b) => [b.key, b.out]));
ok(Object.keys(after).every((k) => reloaded[k] === after[k]), 'a reload in a different tile order works the same seams');
// a stamp the ground does not support is re-chosen, never trusted
game.tiles['0,0'].eco = 'unobtainium';
ok(ctx.ecoBuildings().some((b) => b.key === '0,0' && (b.out === 'crudeOil' || b.out === 'naturalGas')), 'a stale stamp is dropped and re-chosen from the ground');
// manufactured rows are untouched
game.tiles['5,5'] = { type: 'gasstation', lvl: 1 };
ok(ctx.ecoBuildings().some((b) => b.key === '5,5' && b.out === 'gasoline') && !game.tiles['5,5'].eco, 'a manufactured row (Gas Station) is not stamped and still makes gasoline');

// …and the report's symptom, driven: the Gas Station now has a local crude supplier.
E.syncBuildings(ctx.ecoBuildings());
const Firms = await import('./public/src/economy/firms.js');
ok(Firms.byOutput('crudeOil').length > 0, 'the city has a crudeOil firm — the Gas Station is no longer "Nobody makes it"');

console.log(fails ? '\n' + fails + ' FAILED' : '\nALL PASS');
process.exit(fails ? 1 : 0);
