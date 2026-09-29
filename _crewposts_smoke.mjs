/* 👷 bug-mu4mc2c8 — "Post a worker doesn't work": card posts vs the bed cap.

   The report: a Nuclear Plant offered ~200 posts, a Purifier ~50, the crew was
   capped at 20 cards however much Housing there was, so no building could ever
   read as staffed. Measured before the fix over the 98 crewable buildings:
   7,522 posts at Lv 1 against a cap of 20.

   What is pinned here, all against the REAL BUILDINGS table lifted out of
   node-city (the _citybuilder_smoke trick) and the real crew module mounted
   on a stub city:
     1. card posts are a handful per building: def.crew + one per level
     2. a mid city's bed cap can staff at least HALF its card posts
     3. residents keep the 10–200 seat scale (seatsAt), split from card posts
     4. at the hard cap the message stops telling the player to build Housing
     5. NEGATIVE CONTROL: the old rule (postCapacity as card posts, cap 20)
        run through the SAME mid-city measure fails check 2 — so check 2 is
        a real test and not a tautology.

   Run: node _crewposts_smoke.mjs */
import { readFileSync } from 'fs';

let fails = 0, passes = 0;
const ok = (c, m, x) => { console.log((c ? '  PASS ' : '  FAIL ') + m + (c || x === undefined ? '' : '  ← ' + x)); if (c) passes++; else fails++; };

globalThis.document = globalThis.document || {
  getElementById: () => null, createElement: () => ({ style: {}, setAttribute() {}, appendChild() {} }),
  head: { appendChild() {} }, body: { appendChild() {} }, addEventListener() {},
};
globalThis.window = globalThis.window || {};
console.warn = () => {};   // mount()'s work-table audit is noise here, and unrelated

const SRC = readFileSync('./public/node-city/index.html', 'utf8');
function liftBuildings() {
  const i = SRC.indexOf('const BUILDINGS = {');
  if (i < 0) throw new Error('no BUILDINGS');
  let d = 0, j = i + 18;
  for (; j < SRC.length; j++) { const c = SRC[j]; if (c === '{') d++; else if (c === '}') { d--; if (d === 0) break; } }
  // Unknown identifiers (STOCK_CAP_PER_WAREHOUSE …) read as 1 — only cost/crew/gen/svc matter here.
  const P = new Proxy({}, { has: (t, k) => k !== 'undefined' && !(k in globalThis), get: (t, k) => (k === Symbol.unscopables ? undefined : 1) });
  return new Function('P', 'with(P){return ' + SRC.slice(i + 18, j + 1) + '}')(P);
}
const BUILDINGS = liftBuildings();
const C = await import('./public/src/work/crew.city.js');
const W = C.work;
const crewable = Object.keys(BUILDINGS).filter((t) => W.workNeeds(t).length && (BUILDINGS[t].gen || BUILDINGS[t].svc));

console.log('\n=== 1. card posts are a handful per building ===');
{
  ok(crewable.length >= 60, 'the table lifted: ' + crewable.length + ' crewable buildings');
  const at = (t, lvl) => C.cardPostCapacity({ type: t, lvl }, BUILDINGS[t]);
  ok(at('nuclear', 1) === 6, 'Nuclear Plant: 6 posts (was 159)', at('nuclear', 1));
  ok(at('purifier', 1) === 2, 'Purifier: 2 posts (was 34)', at('purifier', 1));
  ok(at('farm', 1) === 2 && at('farm', 3) === 4, 'Farm: 2 at Lv 1, 4 at Lv 3', at('farm', 3));
  ok(at('gasstation', 1) === 1, 'the smallest business still takes one');
  const sum = crewable.reduce((a, t) => a + at(t, 1), 0);
  const old = crewable.reduce((a, t) => a + C.postCapacity({ type: t, lvl: 1 }, BUILDINGS[t], '5,5'), 0);
  ok(sum < 400 && old > 5000, 'sum over every crewable building: ' + sum + ' (old scale ' + old + ')');
  ok(crewable.every((t) => at(t, 3) <= C.CARD_POSTS.MAX && at(t, 1) >= C.CARD_POSTS.MIN), 'every building stays inside CARD_POSTS.MIN..MAX');
}

/* A mid-game city: the buildings a player a week in actually has. */
const MID = ['farm', 'farm', 'purifier', 'waterintake', 'lumbercamp', 'scrapmine', 'quarry', 'sawmill', 'smelter',
  'cannery', 'grocery', 'restaurant', 'retail', 'clinic', 'powerstation', 'wind', 'wind', 'refinery', 'gym',
  'club', 'medlab', 'fastfood', 'alloyworks', 'depot', 'waterstation'];
function midCity(lvl) {
  const tiles = {};
  MID.forEach((t, i) => { tiles[i + ',0'] = { type: t, lvl }; });
  for (let i = 0; i < 10; i++) tiles[i + ',9'] = { type: 'housing', lvl: 2 };
  tiles['0,8'] = { type: 'resthouse', lvl: 2 };
  return tiles;
}
function mountOn(tiles) {
  return C.mount({ game: { tiles, crew: [] }, BUILDINGS, key: (x, z) => x + ',' + z, salt: () => 's', earnsFromCustomers: () => false, toast() {} });
}

console.log('\n=== 2. a mid city can staff what it builds ===');
let midRatio = 0;
{
  const api = mountOn(midCity(2));
  const posts = Object.keys(api._ctx().game.tiles).reduce((a, k) => a + api.slotsAt(k), 0);
  const cap = api.crewCap();
  midRatio = cap / posts;
  console.log('    mid city (25 workplaces at Lv 2, 10 Housing Lv 2, Resting House Lv 2): ' + posts + ' card posts, bed cap ' + cap);
  ok(posts >= 25 && posts <= 150, 'card posts are at a human scale (' + posts + ')');
  ok(midRatio >= 0.5, 'the bed cap covers at least half of them (' + Math.round(midRatio * 100) + '%)');
  const p = api.capParts();
  ok(p.rest === 10 && p.housing === 40 && p.base === 3, 'Resting House Lv 2 = +10 beds, 10 Housing Lv 2 = +40', JSON.stringify(p));
  ok(C.CREW_MAX >= 40, 'the hard cap is no longer the binding wall at 20 (' + C.CREW_MAX + ')');
}

console.log('\n=== 3. residents keep the 10–200 seat scale ===');
{
  const api = mountOn({ '1,1': { type: 'nuclear', lvl: 1 }, '2,2': { type: 'farm', lvl: 1 }, '3,3': { type: 'housing', lvl: 1 } });
  ok(api.seatsAt('1,1') >= 100 && api.slotsAt('1,1') === 6, 'Nuclear Plant: ' + api.seatsAt('1,1') + ' resident seats, 6 card posts');
  ok(api.seatsAt('2,2') >= 10 && api.slotsAt('2,2') === 2, 'Farm: ' + api.seatsAt('2,2') + ' resident seats, 2 card posts');
  ok(api.seatsAt('3,3') === 0 && api.slotsAt('3,3') === 0, 'Housing takes neither');
  ok(/CREW\.seatsAt\(k\)/.test(SRC) && !/CREW\.slotsAt\(k\) \| 0/.test(SRC), 'node-city npcSeatsAt reads seatsAt, not slotsAt');
}

console.log('\n=== 4. the cap message says which wall was hit ===');
{
  const t = {}; for (let i = 0; i < 40; i++) t[i + ',9'] = { type: 'housing', lvl: 3 };
  const api = mountOn(t);
  ok(api.crewCap() === C.CREW_MAX && /city maximum/.test(C.bedsFullMsg()) && !/build Housing/.test(C.bedsFullMsg()), 'capped: "' + C.bedsFullMsg() + '"');
  mountOn({ '0,9': { type: 'housing', lvl: 1 } });
  ok(/build Housing/.test(C.bedsFullMsg()), 'not capped: still points at Housing');
}

console.log('\n=== 5. NEGATIVE CONTROL: the old rule fails check 2 ===');
{
  // The pre-fix rule: card posts = postCapacity (10–200), cap = 3 + 2/Housing lvl + 2/Resting lvl, max 20.
  const tiles = midCity(2);
  let posts = 0, cap = 3;
  for (const [k, t] of Object.entries(tiles)) {
    const d = BUILDINGS[t.type];
    if (W.workNeeds(t.type).length && (d.gen || d.svc)) posts += C.postCapacity(t, d, k);
    if (t.type === 'housing') cap += 2 * t.lvl;
    if (t.type === 'resthouse') cap += 2 * t.lvl;
  }
  cap = Math.min(20, cap);
  const r = cap / posts;
  console.log('    old rule, same city: ' + posts + ' posts, cap ' + cap + ' → ' + (r * 100).toFixed(1) + '%');
  ok(r < 0.5, 'the old rule would FAIL the half-staffed check (' + (r * 100).toFixed(1) + '%)');
  ok(midRatio / r > 20, 'the fix moved the ratio by more than ×20 (×' + (midRatio / r).toFixed(0) + ')');
}

console.log('\n' + (fails ? '❌ ' + fails + ' failed, ' + passes + ' passed' : '✅ all clear (' + passes + ' passed)'));
process.exit(fails ? 1 : 0);
