/* warpath/_sqlcheck.js — the JS generator vs. the plpgsql mirror.
   -----------------------------------------------------------------------------
   The Warpath stores no tiles. The browser derives the world from the seed with
   warpath-mapgen.js and the database derives it AGAIN with the wp_* functions in
   20260811000000_warpath_milestone_1.sql. If those two ever disagree by one
   tile, the symptom is not a crash — it is the server rejecting a harvest the
   player can see on their screen, intermittently, on some seeds only.

   So this diffs them for real. It shells out to psql, pulls every derived
   quantity for a sample of tiles across a sample of seeds, and compares:

       wp_hash32   wp_on_lattice   wp_snap      wp_shuffled_cells
       wp_cores    wp_biome_at     wp_is_water  wp_move_cost
       wp_node_at  wp_structures   wp_path_cost

   Usage:
     PGHOST=/tmp/wpg PGPORT=55432 PGUSER=warpath PGDATABASE=postgres \
       node public/warpath/_sqlcheck.js [seeds] [tilesPerSeed]

   Exits non-zero on the first class of mismatch, printing both sides.        */
const { execFileSync } = require('child_process');
const M = require('./warpath-mapgen.js').WarpathMap;

const SEEDS = parseInt(process.argv[2], 10) || 12;
const TILES = parseInt(process.argv[3], 10) || 200;

function psql(sql) {
  return execFileSync('psql', ['-qAt', '-v', 'ON_ERROR_STOP=1', '-c', sql], {
    encoding: 'utf8', maxBuffer: 1 << 28,
  }).trim();
}

let fails = 0;
const seen = new Set();
function bad(label, seed, where, mine, theirs) {
  const k = label;
  fails++;
  if (seen.has(k)) return;          // one example per class is enough to debug
  seen.add(k);
  console.log('MISMATCH [' + label + '] seed=' + seed + ' ' + where);
  console.log('   js  : ' + JSON.stringify(mine));
  console.log('   sql : ' + JSON.stringify(theirs));
}

const seeds = [];
for (let i = 0; i < SEEDS; i++) seeds.push(((i * 2654435761) ^ 0x51ed270b) >>> 0);
// a couple of deliberately awkward seeds
seeds.push(0, 1, 4294967295, 2147483648);

console.log('checking ' + seeds.length + ' seeds x ' + TILES + ' tiles ...\n');

// ── 1. wp_hash32 over a wide spread of inputs ─────────────────────────────
{
  const rows = [];
  for (const s of seeds) for (let i = 0; i < 40; i++) {
    const x = (i * 7) % M.WORLD_W, y = (i * 11) % M.WORLD_H, salt = i % 14;
    rows.push([s, x, y, salt]);
  }
  const values = rows.map(r => `(${r[0]},${r[1]},${r[2]},${r[3]})`).join(',');
  const out = psql(`select public.wp_hash32(s,x,y,t) from (values ${values}) v(s,x,y,t)`).split('\n');
  rows.forEach((r, i) => {
    const mine = M.wpHash32(r[0], r[1], r[2], r[3]);
    if (String(mine) !== out[i]) bad('wp_hash32', r[0], `(${r[1]},${r[2]},${r[3]})`, mine, out[i]);
  });
  console.log('wp_hash32           ' + rows.length + ' samples');
}

// ── 2. lattice + snap over the whole coordinate space ─────────────────────
{
  const rows = [];
  for (let y = 0; y < M.WORLD_H; y++) for (let x = 0; x < M.WORLD_W; x++) rows.push([x, y]);
  const values = rows.map(r => `(${r[0]},${r[1]})`).join(',');
  const lat = psql(`select public.wp_on_lattice(x,y) from (values ${values}) v(x,y)`).split('\n');
  const snap = psql(`select public.wp_snap(x,y)::text from (values ${values}) v(x,y)`).split('\n');
  rows.forEach((r, i) => {
    const ml = M.onLattice(r[0], r[1]);
    if (String(ml ? 't' : 'f') !== lat[i]) bad('wp_on_lattice', 0, `(${r[0]},${r[1]})`, ml, lat[i]);
    const ms = M.snapToLattice(r[0], r[1]);
    if (`{${ms.x},${ms.y}}` !== snap[i]) bad('wp_snap', 0, `(${r[0]},${r[1]})`, ms, snap[i]);
  });
  console.log('wp_on_lattice/snap  ' + rows.length + ' tiles (full grid)');
}

// ── 3. per-seed: cells, cores, structures ─────────────────────────────────
for (const s of seeds) {
  const cells = psql(`select public.wp_shuffled_cells(${s})::text`);
  const mineCells = '{' + M.shuffledCells(s).join(',') + '}';
  if (cells !== mineCells) bad('wp_shuffled_cells', s, '', mineCells, cells);

  const cores = JSON.parse(psql(`select public.wp_cores(${s})::text`));
  const mineCores = M.biomeCores(s);
  for (let i = 0; i < 12; i++) {
    const a = { x: mineCores[i].x, y: mineCores[i].y, b: mineCores[i].biome };
    const b = { x: cores[i].x, y: cores[i].y, b: cores[i].b };
    if (JSON.stringify(a) !== JSON.stringify(b)) bad('wp_cores', s, 'core ' + i, a, b);
  }

  const st = JSON.parse(psql(`select public.wp_structures(${s})::text`));
  const mine = M.placeStructures(s);
  const flat = [].concat(
    mine.gates.map(g => ({ k: 'gate', id: g.id, x: g.x, y: g.y })),
    mine.sites.map(r => ({ k: 'site', id: r.id, x: r.x, y: r.y })),
    [{ k: 'landmark', id: mine.landmark.id, x: mine.landmark.x, y: mine.landmark.y }],
    mine.spawns.map(p => ({ k: 'spawn', id: 'spawn_' + p.slot, x: p.x, y: p.y })));
  if (st.length !== flat.length) bad('wp_structures/len', s, '', flat.length, st.length);
  for (let i = 0; i < Math.min(st.length, flat.length); i++) {
    const b = { k: st[i].k, id: st[i].id, x: st[i].x, y: st[i].y };
    if (JSON.stringify(flat[i]) !== JSON.stringify(b)) bad('wp_structures', s, 'index ' + i, flat[i], b);
  }
}
console.log('wp_shuffled_cells   ' + seeds.length + ' seeds');
console.log('wp_cores            ' + (seeds.length * 12) + ' cores');
console.log('wp_structures       ' + (seeds.length * 11) + ' structures');

// ── 4. per-tile terrain, and the node table — the one that gates harvesting ─
let tileCount = 0;
for (const s of seeds) {
  const rows = [];
  for (let i = 0; i < TILES; i++) {
    // deterministic spread over the map, not a straight raster
    const x = (i * 17 + 3) % M.WORLD_W, y = (i * 13 + 5) % M.WORLD_H;
    rows.push([x, y]);
  }
  const values = rows.map(r => `(${r[0]},${r[1]})`).join(',');
  const res = psql(
    `select public.wp_biome_at(${s},x,y) || '|' ||
            public.wp_is_water(${s},x,y)::text || '|' ||
            public.wp_move_cost(${s},x,y) || '|' ||
            coalesce(public.wp_node_at(${s},x,y)::text,'-')
       from (values ${values}) v(x,y)`).split('\n');
  const world = M.generate(s);
  rows.forEach((r, i) => {
    tileCount++;
    const [sb, sw, smc, sn] = res[i].split('|');
    const t = world.at(r[0], r[1]);
    const jb = t.water ? M.biomeAt(s, world.cores, r[0], r[1]) : t.biome;
    const at = `(${r[0]},${r[1]})`;
    if (jb !== sb) bad('wp_biome_at', s, at, jb, sb);
    if (String(t.water) !== sw) bad('wp_is_water', s, at, t.water, sw);
    // move cost is only meaningful on land
    if (!t.water && String(t.moveCost) !== smc) bad('wp_move_cost', s, at, t.moveCost, smc);
    const jn = t.node ? { kind: t.node.kind, amount: t.node.amount, tier: t.node.tier } : null;
    const nn = sn === '-' ? null : JSON.parse(sn);
    const norm = o => o ? JSON.stringify({ amount: o.amount, kind: o.kind, tier: o.tier }) : 'null';
    if (norm(jn) !== norm(nn)) bad('wp_node_at', s, at, jn, nn);
  });
}
console.log('wp_biome_at/water/  ');
console.log('  movecost/node_at  ' + tileCount + ' tiles');

// ── 5. wp_path_cost vs the JS Dijkstra ────────────────────────────────────
{
  let n = 0;
  for (const s of seeds.slice(0, 6)) {
    const world = M.generate(s);
    const sp = world.spawns[0];
    const dist = M.reachable(world, sp.x, sp.y, 6);
    const targets = Object.keys(dist).slice(0, 25);
    for (const k of targets) {
      const [x, y] = k.split(',').map(Number);
      const sql = psql(`select coalesce(public.wp_path_cost(${s},${sp.x},${sp.y},${x},${y},6)::text,'null')`);
      if (String(dist[k]) !== sql) bad('wp_path_cost', s, `${sp.x},${sp.y} -> ${x},${y}`, dist[k], sql);
      n++;
    }
    // and a destination the JS says is NOT reachable must be null in SQL too
    for (let d = 0; d < 6; d++) {
      const x = Math.min(M.WORLD_W - 1, sp.x + 6), y = Math.min(M.WORLD_H - 1, sp.y + 6 - d);
      if (dist[x + ',' + y] == null) {
        const sql = psql(`select coalesce(public.wp_path_cost(${s},${sp.x},${sp.y},${x},${y},6)::text,'null')`);
        if (sql !== 'null') bad('wp_path_cost/unreachable', s, `${x},${y}`, null, sql);
        n++;
      }
    }
  }
  console.log('wp_path_cost        ' + n + ' paths');
}

/* ── 6. The content tables exist TWICE ────────────────────────────────────
   warpath-data.js has them because the client draws them; the migration has
   them because the server must never take the client's word for what a
   recruit costs. Duplication is the right call there, but only if the two
   copies cannot drift — so diff them. */
{
  const D = require('./warpath-data.js').WarpathData;

  // jsonb does not preserve key order, so both sides are canonicalised before
  // comparison — otherwise every cost object "differs".
  const canon = o => JSON.stringify(Object.keys(o).sort().reduce((a, k) => (a[k] = o[k], a), {}));

  const off = psql(`select site_id||'|'||idx||'|'||card_key||'|'||rank||'|'||cost::text
                      from public.warpath_recruit_offers order by site_id, idx`).split('\n');
  const mineOff = [];
  for (const site of Object.keys(D.RECRUIT_POOLS).sort()) {
    D.RECRUIT_POOLS[site].offers.forEach((o, i) => mineOff.push([site, i, o.key, o.rank, o.cost]));
  }
  if (off.length !== mineOff.length) bad('recruit_offers/len', 0, '', mineOff.length, off.length);
  mineOff.forEach((o, i) => {
    const [site, idx, key, rank, cost] = (off[i] || '').split('|');
    const same = site === o[0] && +idx === o[1] && key === o[2] && +rank === o[3] &&
                 canon(JSON.parse(cost || '{}')) === canon(o[4]);
    if (!same) bad('recruit_offers', 0, o[0] + '#' + o[1], o, off[i]);
  });
  console.log('recruit offers      ' + mineOff.length + ' rows');

  const disc = psql(`select biome||'|'||ord||'|'||card_key||'|'||weight
                       from public.warpath_discovery order by biome, ord`).split('\n');
  const mineDisc = [];
  for (const b of Object.keys(D.DISCOVERY).sort()) {
    D.DISCOVERY[b].cards.forEach((c, i) => mineDisc.push(b + '|' + i + '|' + c[0] + '|' + c[1]));
  }
  if (disc.length !== mineDisc.length) bad('discovery/len', 0, '', mineDisc.length, disc.length);
  mineDisc.forEach((row, i) => { if (row !== disc[i]) bad('discovery', 0, 'row ' + i, row, disc[i]); });
  console.log('discovery tables    ' + mineDisc.length + ' rows');

  const meta = psql(`select biome||'|'||chance from public.warpath_discovery_meta order by biome`).split('\n');
  const mineMeta = Object.keys(D.DISCOVERY).sort().map(b => b + '|' + D.DISCOVERY[b].encounterChance);
  mineMeta.forEach((row, i) => { if (row !== meta[i]) bad('discovery_meta', 0, row, row, meta[i]); });

  const bld = psql(`select building||'|'||level||'|'||cost::text
                      from public.warpath_building_costs order by building, level`).split('\n');
  const mineBld = [];
  for (const b of Object.keys(D.CAMP_BUILDINGS).sort()) {
    D.CAMP_BUILDINGS[b].levels.forEach((l, i) => mineBld.push([b, i + 1, l.cost]));
  }
  if (bld.length !== mineBld.length) bad('building_costs/len', 0, '', mineBld.length, bld.length);
  mineBld.forEach((o, i) => {
    const [b, lv, cost] = (bld[i] || '').split('|');
    if (b !== o[0] || +lv !== o[1] || canon(JSON.parse(cost || '{}')) !== canon(o[2])) {
      bad('building_costs', 0, o[0] + ' L' + o[1], o, bld[i]);
    }
  });
  console.log('building costs      ' + mineBld.length + ' rows');

  const star = psql(`select card_key from public.warpath_starter_pool order by ord`).split('\n');
  if (star.join(',') !== D.STARTER_POOL.join(',')) bad('starter_pool', 0, '', D.STARTER_POOL, star);
  console.log('starter pool        ' + star.length + ' cards');

  const stip = psql(`select kind||'|'||amount from public.warpath_starting_stipend order by kind`).split('\n');
  const mineStip = Object.keys(D.STARTING_STIPEND).sort().map(k => k + '|' + D.STARTING_STIPEND[k]);
  if (stip.join(',') !== mineStip.join(',')) bad('starting_stipend', 0, '', mineStip, stip);
  console.log('starting stipend    ' + mineStip.length + ' resources');

  // and the vault ladder the two sides both hard-code
  const slots = psql(`select public.wp_vault_slots(id) from public.warpath_expeditions limit 0`);
  if (JSON.stringify(D.VAULT_SLOTS) !== JSON.stringify([0, 5, 10, 20])) {
    bad('vault_slots', 0, '', D.VAULT_SLOTS, '[0,5,10,20] (hard-coded in wp_vault_slots)');
  }
}

console.log(fails ? '\n' + fails + ' MISMATCHES' : '\nJS AND SQL AGREE');
process.exit(fails ? 1 : 0);
