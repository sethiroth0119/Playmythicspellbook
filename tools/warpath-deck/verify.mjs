// ─────────────────────────────────────────────────────────────────────────────
// ✅ Cross-check the draft mirror against the REAL Postgres.
//
// draft.mjs re-implements the server's draft in JS so a thousand runs can be
// simulated in a second. That is only trustworthy if the JS agrees with the
// SQL, so this walks a grid of tiles on several seeds and compares:
//
//   wp_is_water / wp_biome_at / wp_move_cost   vs the mapgen mirror
//   warpath_encounter_open (the REAL RPC, on a REAL expedition row)
//                                              vs draft.mjs rollEncounter
//   warpath_discovery / _meta table contents   vs warpath-data.js DISCOVERY
//
//   tools/warpath-sim/pg.sh up      # once — starts the scratch cluster
//   node tools/warpath-deck/verify.mjs
// ─────────────────────────────────────────────────────────────────────────────
import pg from 'pg';
import { Map_, Data, rollEncounter } from './draft.mjs';

const CONN = { host: process.env.PGSOCK || '/var/tmp/wpsim', port: Number(process.env.PGPORT || 55432),
               database: process.env.PGDATABASE || 'warpath', user: 'postgres' };

let PASS = 0, FAIL = 0;
const ok = m => { PASS++; console.log('  ✔ ' + m); };
const bad = m => { FAIL++; console.log('  ✘ ' + m); };

const c = new pg.Client(CONN);
await c.connect();
const q = async (s, a) => (await c.query(s, a)).rows;

// ── 0. The content tables ──────────────────────────────────────────────────
{
  const meta = await q('select biome, chance, title from public.warpath_discovery_meta order by biome');
  let drift = 0;
  for (const m of meta) {
    const js = Data.DISCOVERY[m.biome];
    if (!js) { drift++; console.log(`    biome ${m.biome} is in SQL but not warpath-data.js`); continue; }
    if (js.encounterChance !== m.chance) { drift++; console.log(`    ${m.biome}: chance SQL ${m.chance} vs JS ${js.encounterChance}`); }
    if (js.title !== m.title) { drift++; console.log(`    ${m.biome}: title differs`); }
  }
  for (const b of Object.keys(Data.DISCOVERY)) {
    if (!meta.some(m => m.biome === b)) { drift++; console.log(`    biome ${b} is in warpath-data.js but not SQL`); }
  }
  const rows = await q('select biome, ord, card_key, weight from public.warpath_discovery order by biome, ord');
  const byBiome = {};
  for (const r of rows) (byBiome[r.biome] = byBiome[r.biome] || []).push([r.card_key, r.weight, r.ord]);
  for (const b of Object.keys(Data.DISCOVERY)) {
    const js = Data.DISCOVERY[b].cards, sql = byBiome[b] || [];
    if (js.length !== sql.length) { drift++; console.log(`    ${b}: ${js.length} JS rows vs ${sql.length} SQL rows`); continue; }
    for (let i = 0; i < js.length; i++) {
      if (js[i][0] !== sql[i][0] || js[i][1] !== sql[i][1]) {
        drift++; console.log(`    ${b} ord ${sql[i][2]}: SQL ${sql[i][0]}/${sql[i][1]} vs JS ${js[i][0]}/${js[i][1]}`);
      }
    }
  }
  drift ? bad(`discovery tables drifted in ${drift} place(s)`) : ok('discovery tables identical in SQL and warpath-data.js');
}

// ── 1. Terrain primitives ──────────────────────────────────────────────────
const SEEDS = [7919, 424242, 1, 987654321];
{
  let n = 0, wrong = 0;
  for (const seed of SEEDS) {
    const cores = Map_.biomeCores(seed);
    for (let y = 0; y < Map_.WORLD_H; y += 3) {
      const xs = [];
      for (let x = 0; x < Map_.WORLD_W; x += 3) xs.push(x);
      const rows = await q(
        `select x, public.wp_is_water($1, x, $2) w, public.wp_biome_at($1, x, $2) b,
                public.wp_move_cost($1, x, $2) m, public.wp_roll($1, x, $2, 20, 100) r
           from unnest($3::int[]) x`, [seed, y, xs]);
      for (const row of rows) {
        n++;
        const jw = Map_.isWater(seed, row.x, y);
        const jb = Map_.biomeAt(seed, cores, row.x, y);
        const jm = Map_.moveCostAt(seed, jb, row.x, y);
        const jr = Map_.wpRoll(seed, row.x, y, 20, 100);
        if (jw !== row.w || jb !== row.b || (!jw && jm !== row.m) || jr !== row.r) {
          if (wrong < 5) console.log(`    seed ${seed} (${row.x},${y}) SQL w=${row.w} b=${row.b} m=${row.m} r=${row.r} | JS w=${jw} b=${jb} m=${jm} r=${jr}`);
          wrong++;
        }
      }
    }
  }
  wrong ? bad(`terrain mirror wrong on ${wrong}/${n} tiles`) : ok(`terrain mirror exact on ${n} tiles across ${SEEDS.length} seeds`);
}

// ── 2. The real encounter RPC vs rollEncounter ─────────────────────────────
{
  await q(`insert into auth.users (id, email) values ('00000000-0000-4000-8000-0000000000aa','wpdeck@x')
             on conflict (id) do nothing`);
  let n = 0, wrong = 0, fired = 0;
  for (const seed of SEEDS) {
    const cores = Map_.biomeCores(seed);
    const run = (await q(`insert into public.warpath_runs (seed, status, turn) values ($1,'active',1) returning id`, [seed]))[0].id;
    const exp = (await q(
      `insert into public.warpath_expeditions (run_id, user_id, slot, hero_id, x, y)
       values ($1,'00000000-0000-4000-8000-0000000000aa',0,'cedric',0,0) returning id`, [run]))[0].id;
    await q(`select public.set_uid('00000000-0000-4000-8000-0000000000aa')`);
    for (let y = 1; y < Map_.WORLD_H; y += 4) {
      for (let x = 1; x < Map_.WORLD_W; x += 4) {
        if (Map_.isWater(seed, x, y)) continue;
        await q(`update public.warpath_expeditions set x=$2, y=$3 where id=$1`, [exp, x, y]);
        const r = (await q(`select public.warpath_encounter_open($1) j`, [exp]))[0].j;
        const biome = Map_.biomeAt(seed, cores, x, y);
        const js = rollEncounter(seed, x, y, biome);
        const sql = (r && r.ok && r.encounter) ? r.encounter.offers.map(o => o.key) : null;
        n++;
        if (sql) fired++;
        const same = (!sql && !js) || (sql && js && sql.join('|') === js.join('|'));
        if (!same) {
          if (wrong < 6) console.log(`    seed ${seed} (${x},${y}) ${biome}: SQL ${JSON.stringify(sql)} vs JS ${JSON.stringify(js)}`);
          wrong++;
        }
      }
    }
  }
  wrong ? bad(`encounter mirror wrong on ${wrong}/${n} tiles`)
        : ok(`warpath_encounter_open matched rollEncounter on all ${n} tiles (${fired} fired an encounter)`);
}

await c.end();
console.log(`\n${PASS} passed, ${FAIL} failed`);
process.exit(FAIL ? 1 : 0);
