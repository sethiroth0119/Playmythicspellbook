/* warpath/_selftest.js — property tests for the world generator.
   `node public/warpath/_selftest.js [seedCount]`

   The generator is a contract with two consumers (the browser and the plpgsql
   mirror in the Warpath migration), so the things worth testing are the
   INVARIANTS the rest of the mode assumes, not the exact output:
     • determinism
     • every pack biome actually exists in every world
     • every structure sits on passable ground
     • every structure is reachable from every spawn (the lattice claim)
     • node density and the rarity of extraction materials land in-band
   Exits non-zero on the first violated invariant, naming the seed.           */
const M = require('./warpath-mapgen.js').WarpathMap;

const N = parseInt(process.argv[2], 10) || 300;
let fails = 0;
const fail = (seed, msg) => { fails++; console.log('FAIL seed=' + seed + ' — ' + msg); };

// Flood fill over passable tiles from a start, 8-way.
function flood(w, sx, sy) {
  const seen = new Set([sx + ',' + sy]);
  const q = [[sx, sy]];
  while (q.length) {
    const [x, y] = q.pop();
    for (const [nx, ny] of M.neighbours(x, y)) {
      const k = nx + ',' + ny;
      if (seen.has(k)) continue;
      const t = w.at(nx, ny);
      if (!t || !t.passable) continue;
      seen.add(k); q.push([nx, ny]);
    }
  }
  return seen;
}

const agg = { water: [], nodes: [], extraction: [], biomeMin: [] };

for (let s = 0; s < N; s++) {
  const seed = (s * 2654435761) >>> 0;
  let w;
  try { w = M.generate(seed); } catch (e) { fail(seed, 'generate threw: ' + e.message); continue; }

  // 1 — determinism
  const w2 = M.generate(seed);
  if (JSON.stringify(w.tiles) !== JSON.stringify(w2.tiles)) fail(seed, 'non-deterministic tiles');
  if (JSON.stringify(w.spawns) !== JSON.stringify(w2.spawns)) fail(seed, 'non-deterministic spawns');

  // 2 — every pack biome present, and none vanishingly small
  const area = {};
  let water = 0, nodes = 0, extraction = 0;
  for (const t of w.tiles) {
    area[t.biome] = (area[t.biome] || 0) + 1;
    if (t.water) water++;
    if (t.node) { nodes++; if (t.node.tier === 'extraction') extraction++; }
  }
  for (const b of ['forest', 'graveyard', 'facility', 'mountain']) {
    if (!area[b]) { fail(seed, 'pack biome missing: ' + b); }
    else if (area[b] < 40) fail(seed, 'pack biome too small: ' + b + ' = ' + area[b] + ' tiles');
  }
  agg.biomeMin.push(Math.min(...['forest', 'graveyard', 'facility', 'mountain'].map(b => area[b] || 0)));

  // 3 — structures on passable ground (generate() already asserts; re-check
  //     here so a thrown assert vs a silent bad tile are distinguishable)
  const structures = [].concat(
    w.spawns.map(p => ['spawn' + p.slot, p]),
    w.gates.map(g => [g.id, g]),
    w.sites.map(r => [r.id, r]),
    [['landmark', w.landmark]]);
  for (const [name, p] of structures) {
    const t = w.at(p.x, p.y);
    if (!t) { fail(seed, name + ' out of bounds ' + p.x + ',' + p.y); continue; }
    if (!t.passable) fail(seed, name + ' on impassable tile');
    if (!t.lattice) fail(seed, name + ' off the land lattice — reachability is not guaranteed');
  }

  // 4 — no two structures share a tile
  const occ = new Map();
  for (const [name, p] of structures) {
    const k = p.x + ',' + p.y;
    if (occ.has(k)) fail(seed, 'structure collision at ' + k + ': ' + occ.get(k) + ' / ' + name);
    occ.set(k, name);
  }

  // 5 — THE LATTICE CLAIM. Everything is reachable from spawn 0.
  const reach = flood(w, w.spawns[0].x, w.spawns[0].y);
  for (const [name, p] of structures) {
    if (!reach.has(p.x + ',' + p.y)) fail(seed, name + ' unreachable from spawn 0');
  }

  // 6 — movement budget behaves: a fresh hero with 6 MP can go somewhere,
  //     and every reported destination is genuinely passable + in budget.
  const d = M.reachable(w, w.spawns[0].x, w.spawns[0].y, 6);
  const keys = Object.keys(d);
  if (keys.length < 12) fail(seed, 'spawn 0 has only ' + keys.length + ' destinations at 6 MP — boxed in');
  for (const k of keys) {
    const [x, y] = k.split(',').map(Number);
    if (!w.at(x, y).passable) fail(seed, 'reachable() returned impassable ' + k);
    if (d[k] > 6) fail(seed, 'reachable() returned over-budget ' + k + ' = ' + d[k]);
  }
  // path reconstruction terminates at the start
  const far = keys.sort((a, b) => d[b] - d[a])[0].split(',').map(Number);
  const path = M.pathTo(w, d, w.spawns[0].x, w.spawns[0].y, far[0], far[1]);
  if (path[0][0] !== w.spawns[0].x || path[0][1] !== w.spawns[0].y) fail(seed, 'pathTo did not start at the hero');
  if (path[path.length - 1][0] !== far[0]) fail(seed, 'pathTo did not end at the target');

  // 7 — hash mirror sanity: wpHash32 stays in uint32 range
  for (let i = 0; i < 50; i++) {
    const h = M.wpHash32(seed, i, i * 3, i % 14);
    if (!Number.isInteger(h) || h < 0 || h > 4294967295) fail(seed, 'wpHash32 out of uint32 range: ' + h);
  }

  agg.water.push(water / w.tiles.length);
  agg.nodes.push(nodes);
  agg.extraction.push(extraction);
}

/* ── CARD_META vs the real catalogs ───────────────────────────────────────
   ⚠ Re-derive from the ARRAYS, not with a regex. The original check pulled
   card ids out of public/index.html with `/\{\s*id:\s*.([a-zA-Z0-9_]+)./g`,
   which also matched nested objects — so `siphoned`, a STATUS EFFECT declared
   inside a card, was counted as a location card. `location:siphoned` sat in
   the facility discovery table declared valid, and a player who drafted it
   would have received a card that resolves to nothing: dropped from the
   battle deck, dropped again at extraction. Evaluating the array is the only
   check that actually agrees with resolveDeckCard(). */
{
  const fs = require('fs'), path = require('path');
  const idx = path.join(__dirname, '..', 'index.html');
  if (fs.existsSync(idx)) {
    const src = fs.readFileSync(idx, 'utf8');
    const block = (name) => {
      const i = src.indexOf('const ' + name + ' = [');
      if (i < 0) return null;
      let d = 0, j = src.indexOf('[', i), k = j;
      for (; k < src.length; k++) { if (src[k] === '[') d++; else if (src[k] === ']') { d--; if (!d) break; } }
      return src.slice(j, k + 1);
    };
    const kinds = { unit: 'UNIT_CARDS', spell: 'SPELL_CARDS', trap: 'TRAP_CARDS',
                    location: 'LOCATION_CARDS', weather: 'WEATHER_CARDS' };
    const cat = {};
    let ok = true;
    for (const k in kinds) {
      const b = block(kinds[k]);
      if (!b) { ok = false; break; }
      // eslint-disable-next-line no-eval
      cat[k] = new Map(eval(b).map(c => [c.id, c]));
    }
    if (!ok) {
      console.log('note: could not read the catalogs from index.html — skipping the CARD_META check');
    } else {
      const D = require('./warpath-data.js').WarpathData;
      const keys = new Set(D.STARTER_POOL);
      Object.values(D.RECRUIT_POOLS).forEach(p => p.offers.forEach(o => keys.add(o.key)));
      Object.values(D.DISCOVERY).forEach(b => b.cards.forEach(c => keys.add(c[0])));
      let bad = 0;
      for (const key of keys) {
        const kind = key.slice(0, key.indexOf(':')), id = key.slice(key.indexOf(':') + 1);
        const c = cat[kind] && cat[kind].get(id);
        if (!c) { console.log('FAIL unresolvable card key in warpath-data.js: ' + key); bad++; continue; }
        const m = D.CARD_META[key];
        if (!m) { console.log('FAIL CARD_META is missing ' + key); bad++; continue; }
        if (m.n !== c.name) { console.log('FAIL CARD_META name drift for ' + key + ': ' + m.n + ' vs ' + c.name); bad++; }
        if ((m.c != null ? m.c : null) !== (c.cost != null ? c.cost : null)) {
          console.log('FAIL CARD_META cost drift for ' + key); bad++;
        }
      }
      for (const key of Object.keys(D.CARD_META)) {
        if (!keys.has(key)) { console.log('FAIL CARD_META has a key the mode never offers: ' + key); bad++; }
      }
      fails += bad;
      console.log('CARD_META            ' + keys.size + ' keys checked against the live catalogs'
        + (bad ? ' — ' + bad + ' PROBLEMS' : ''));
    }
  }
}

const avg = a => a.reduce((x, y) => x + y, 0) / a.length;
const lo  = a => Math.min(...a), hi = a => Math.max(...a);

console.log('\nseeds tested: ' + N);
console.log('water fraction   avg ' + avg(agg.water).toFixed(3) + '  range ' + lo(agg.water).toFixed(3) + '..' + hi(agg.water).toFixed(3));
console.log('resource nodes   avg ' + avg(agg.nodes).toFixed(1) + '  range ' + lo(agg.nodes) + '..' + hi(agg.nodes));
console.log('extraction nodes avg ' + avg(agg.extraction).toFixed(1) + '  range ' + lo(agg.extraction) + '..' + hi(agg.extraction));
console.log('smallest pack biome avg ' + avg(agg.biomeMin).toFixed(1) + ' tiles, worst ' + lo(agg.biomeMin));

// Band checks on the aggregate — a generator that technically passes every
// per-seed invariant but produces 4 nodes or 900 nodes is still wrong.
if (avg(agg.water) < 0.02 || avg(agg.water) > 0.14) { console.log('FAIL water fraction out of band'); fails++; }
if (avg(agg.nodes) < 300 || avg(agg.nodes) > 700)   { console.log('FAIL node count out of band'); fails++; }
if (lo(agg.extraction) < 3)                          { console.log('FAIL a world generated with almost no extraction materials'); fails++; }
if (avg(agg.extraction) > 90)                        { console.log('FAIL extraction materials are not rare'); fails++; }

console.log(fails ? '\n' + fails + ' FAILURES' : '\nALL CLEAN');
process.exit(fails ? 1 : 0);
