import { readFileSync } from 'node:fs';
const s = readFileSync('public/node-city/index.html', 'utf8').replace(/\r\n/g, '\n');
const a = s.indexOf('const WX_SHIELD = {');
const b = s.indexOf('/* True when the strike is absorbed');
if (a < 0 || b < 0) { console.log('could not extract'); process.exit(1); }
const body = s.slice(a, b);
const F = (game) => new Function('game', body + '; return { WX_SHIELD, _wxShieldStrength };')(game);
const mk = (type, n, o = {}) => {
  const t = {};
  for (let i = 0; i < n; i++) t['k' + i] = { type, lvl: o.lvl || 1, damaged: !!o.damaged };
  return { tiles: t };
};
const pct = (g, h) => Math.round(100 * F(g)._wxShieldStrength(h));
const B = { fire: 'firestation', tornado: 'stormshelter', anomaly: 'containment' };

let pass = 0, fail = 0;
const ok = (n, c) => { if (c) { pass++; console.log('  ✅ ' + n); } else { fail++; console.log('  ❌ ' + n); } };

console.log('\n── shield cover by count ──');
for (const h of ['fire', 'tornado', 'anomaly']) {
  console.log('  ' + h.padEnd(8) + ' ' + [1, 2, 3, 5, 8].map((n) => n + '→' + pct(mk(B[h], n), h) + '%').join('  '));
}
console.log('\n── the properties that matter ──');
ok('no buildings → 0% cover', pct({ tiles: {} }, 'fire') === 0);
ok('DAMAGED protectors give 0% cover', pct(mk('firestation', 3, { damaged: true }), 'fire') === 0);
ok('a level-3 station counts as three', pct(mk('firestation', 1, { lvl: 3 }), 'fire') === pct(mk('firestation', 3), 'fire'));
ok('cover is capped, not unbounded', pct(mk('firestation', 50), 'fire') === 75);
ok('tornado cap 65', pct(mk('stormshelter', 50), 'tornado') === 65);
ok('anomaly cap 70', pct(mk('containment', 50), 'anomaly') === 70);
ok('a fire station does NOT stop a tornado', pct(mk('firestation', 5), 'tornado') === 0);
ok('a shelter does NOT stop an anomaly', pct(mk('stormshelter', 5), 'anomaly') === 0);
ok('no city is ever immune (fire)', pct(mk('firestation', 999), 'fire') < 100);

/* The research + building wiring, read from the shipped files. */
/* ⚠ A module mutation runs in a MIRROR holding only tools/mp-tests plus the
   one mutated file, so tree.js is absent there. Skipping is correct; throwing
   would redden the run for a missing file and score the mutation 'proven'
   while proving nothing — the false proof this runner documents twice. */
let tree = null;
try { tree = readFileSync('public/src/progression/tree.js', 'utf8'); } catch (e) {}
console.log('\n── wiring ──');
if (tree) ok('Storm Shelters node exists', /id: 'civ_shelter'[\s\S]{0,400}?buildings: \['stormshelter'\]/.test(tree));
if (tree) ok('Rift Containment node exists', /id: 'sci_containment'[\s\S]{0,400}?buildings: \['containment'\]/.test(tree));
ok('stormshelter is a real building', s.includes("stormshelter:{name:'Storm Shelter'"));
ok('containment is a real building', s.includes("containment:{name:'Containment Field'"));
ok('stormshelter has a mesh arm', s.includes("case 'stormshelter':"));
ok('containment has a mesh arm', s.includes("case 'containment':"));
ok('all four hazards call the shield', (s.match(/_wxShield\('/g) || []).length === 4);

/* No two nodes may share a grid slot, or they draw on top of each other. */
const slots = !tree ? [] : [...tree.matchAll(/cat: '(\w+)', row: (\d+), col: (\d+)/g)].map((m) => m[1] + ':' + m[2] + ',' + m[3]);
if (tree) ok('no two research nodes share a slot', new Set(slots).size === slots.length);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
