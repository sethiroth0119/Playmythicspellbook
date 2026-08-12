// ─────────────────────────────────────────────────────────────────────────────
// 🗺 WARPATH — four real players, real RPCs, real Postgres.
//
// Everything ever measured about this mode came from public/warpath/warpath-
// net.js, an offline single-player harness whose rivals are random-walk tokens
// that never challenge, never build, never extract and hardcode `camp: null`.
// Across 120+ scripted runs it produced zero battles — not because PvP is
// broken but because nothing in the fixture was ever playing. So the
// card-drop-on-defeat rule, injury/retreat, camp discovery, the Watchtower's
// reporting, waiting_for turn sync and the whole risk model were untested.
//
// This is the instrument that makes them observable. Four independent
// PostgreSQL sessions, four session-local identities, four different
// strategies, sixty turns, and a set of counters aimed at five questions:
//
//   1. do four players on a 44x30 map under 2-tile fog ever actually collide?
//   2. does camp discovery work end to end?
//   3. does waiting_for hold when players move at different speeds — or stall?
//   4. does a PvP defeat cost enough to make "bank now" a real decision?
//   5. what only breaks with four players?
//
//   tools/warpath-sim/pg.sh up          # scratch Postgres + migration
//   tools/warpath-sim/pg.sh test        # 66 assertions, must exit 0
//   node tools/warpath-sim/sim.mjs --runs 8
//   node tools/warpath-sim/sim.mjs --runs 1 --stall 12 --verbose
// ─────────────────────────────────────────────────────────────────────────────
import { Session, loadMap, cheb, W, H } from './warpath-client.mjs';
import { Bot, STRATEGIES } from './bots.mjs';

const argv = process.argv.slice(2);
const flag = (n, d) => { const i = argv.indexOf(`--${n}`); return i < 0 ? d : (argv[i + 1] ?? true); };
const has = n => argv.includes(`--${n}`);

const RUNS    = Number(flag('runs', 4));
const TURNS   = Number(flag('turns', 60));
const STALL   = Number(flag('stall', 0));   // RAKE walks away from the keyboard for N rounds
const VERBOSE = has('verbose');
const JSON_OUT = flag('json', null);

/* Two line-ups. `mixed` is the interesting one. `nohunter` is the CONTROL:
   nobody is trying to find anybody, which is roughly how the four of them would
   behave if PvP were just an option on the menu. The difference between the two
   collision rates is the honest answer to "does the risk model exist". */
const ROSTERS = {
  mixed: [
    { name: 'BOLT',  hero: 'hero_ashen', strategy: 'rusher'  },
    { name: 'ANVIL', hero: 'hero_vex',   strategy: 'builder' },
    { name: 'RAKE',  hero: 'hero_mire',  strategy: 'hunter'  },
    { name: 'DELVE', hero: 'hero_kell',  strategy: 'greedy'  },
  ],
  nohunter: [
    { name: 'BOLT',  hero: 'hero_ashen', strategy: 'rusher'  },
    { name: 'ANVIL', hero: 'hero_vex',   strategy: 'builder' },
    { name: 'QUARRY',hero: 'hero_mire',  strategy: 'builder' },
    { name: 'DELVE', hero: 'hero_kell',  strategy: 'greedy'  },
  ],
};
const ROSTER = ROSTERS[String(flag('roster', 'mixed'))] || ROSTERS.mixed;

const say = (...a) => console.log(...a);
const vsay = (...a) => { if (VERBOSE) console.log(...a); };

class Sim {
  constructor(idx) {
    this.idx = idx;
    this.waiting = [];        // {who, turn, waiting_for}
    this.advances = [];       // {who, turn}
    this.stalls = [];
    this.nodeRaces = [];
    this.pvpOpens = [];
    this.pvpResolved = [];
    this.stuckBattles = [];
    this.proximity = [];      // per turn: {turn, minDist, pairsWithin1, pairsWithinVision}
    this.campSightings = [];  // {turn, viewer, seen}
    this.riskSamples = [];    // {turn, who, carriedBulk, carriedMats, securedMats, unsecuredCards}
    this.errors = [];
    this.turnJumps = [];
  }
  noteWaiting(who, turn, n)   { this.waiting.push({ who, turn, waiting_for: n }); }
  noteAdvance(who, turn)      { this.advances.push({ who, turn }); }
  noteStall(who, turn)        { this.stalls.push({ who, turn }); }
  noteNodeRace(who, x, y, t)  { this.nodeRaces.push({ who, x, y, turn: t }); }
  notePvpOpen(who, target, turn, x, y) { this.pvpOpens.push({ who, target, turn, x, y }); }
  notePvpResolved(id, winner, spoils, by) { this.pvpResolved.push({ id, winner, spoils, by }); }
  noteStuckBattle(who, battle, ok)     { this.stuckBattles.push({ who, battle, ok }); }
  tierOf(kind) { return this.tiers[kind]; }
}

async function playOneRun(idx) {
  const sim = new Sim(idx);
  const obs = new Session('obs');
  await obs.open(null);

  sim.tiers = Object.fromEntries(
    (await obs.sql('select kind, tier from public.warpath_resources')).map(r => [r.kind, r.tier]));
  sim.recruitOffers = await obs.sql(
    'select site_id, idx, rank, card_key, cost from public.warpath_recruit_offers order by site_id, idx');

  // ── four identities, four connections ────────────────────────────────────
  const users = [];
  for (const r of ROSTER) {
    const u = (await obs.sql(
      'insert into auth.users (email) values ($1) returning id',
      [`${r.name.toLowerCase()}+r${idx}@warpath.sim`]))[0].id;
    users.push(u);
  }

  const bots = [];
  for (let i = 0; i < ROSTER.length; i++) {
    const s = new Session(ROSTER[i].name);
    await s.open(users[i]);
    const who = await s.whoami();
    if (who !== users[i]) throw new Error(`identity leak: ${ROSTER[i].name} is running as ${who}`);
    bots.push(new Bot({
      session: s, name: ROSTER[i].name, hero: ROSTER[i].hero,
      strategy: STRATEGIES[ROSTER[i].strategy], map: null, seed: 1000 + idx * 17 + i, sim,
    }));
  }

  // ⚠ Enter CONCURRENTLY. The advisory lock in warpath_enter (migration:1052)
  // is the whole lobby; entering one at a time would never test it.
  const entries = await Promise.all(bots.map(b => b.enter()));
  const runIds = new Set(entries.map(e => e.run_id));
  sim.lobbyOk = runIds.size === 1;
  sim.runId = entries[0].run_id;
  sim.seed = entries[0].seed;
  sim.spawns = entries.map((e, i) => ({ who: ROSTER[i].name, x: e.x, y: e.y, slot: e.slot }));
  if (!sim.lobbyOk) { sim.errors.push(`lobby forked into ${runIds.size} runs`); }

  const map = await loadMap(obs, sim.seed);
  for (const b of bots) b.map = map;
  sim.gate = map.gates.find(g => g.main);
  sim.spawnSpread = maxPairwise(sim.spawns);

  if (STALL > 0) bots[2].stallRounds = STALL;   // the third seat goes quiet

  // ── the run ──────────────────────────────────────────────────────────────
  let guard = 0;
  const seenTurns = new Set();
  for (;;) {
    if (++guard > TURNS * 4 + 40) { sim.errors.push('run did not terminate; aborted'); break; }
    const run = (await obs.sql('select turn, status from public.warpath_runs where id = $1', [sim.runId]))[0];
    if (run.status === 'closed') break;
    if (bots.every(b => b.done)) break;

    if (!seenTurns.has(run.turn)) { seenTurns.add(run.turn); await snapshot(obs, sim, run.turn, bots); }

    await Promise.all(bots.map(b => b.playTurn().catch(e => {
      sim.errors.push(`${b.name} threw on turn ${run.turn}: ${e.message}`);
      b.done = true;
    })));

    const after = (await obs.sql('select turn, status from public.warpath_runs where id = $1', [sim.runId]))[0];
    if (after.turn - run.turn > 1) sim.turnJumps.push({ from: run.turn, to: after.turn });
    if (after.turn === run.turn && bots.every(b => b.done || b.stallRounds > 0)) {
      // Nobody can advance the clock. Either everyone finished, or the stalling
      // bot is holding the world — record which and stop spinning.
      if (bots.every(b => b.done)) break;
      sim.deadlockTurn ??= run.turn;
      if (guard > TURNS * 2) { sim.errors.push(`world frozen at turn ${run.turn} by a stalled player`); break; }
    }
    vsay(`  turn ${run.turn} -> ${after.turn}`);
  }

  sim.finalTurn = (await obs.sql('select turn, status from public.warpath_runs where id = $1', [sim.runId]))[0];
  await collect(obs, sim, bots, map);
  for (const b of bots) await b.s.close();
  await obs.close();
  return { sim, bots };
}

function maxPairwise(pts) {
  let m = 0;
  for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++)
    m = Math.max(m, cheb(pts[i].x, pts[i].y, pts[j].x, pts[j].y));
  return m;
}

/** Per-turn measurement, taken from the owner connection. Read-only; the bots
 *  never see any of it. */
async function snapshot(obs, sim, turn, bots) {
  const rows = await obs.sql(
    `select e.id, e.slot, e.hero_name, e.x, e.y, e.status, e.hero_hp, e.injured_turns,
            (select coalesce(sum(i.carried),0) from public.warpath_inventory i
               join public.warpath_resources r on r.kind = i.kind
              where i.expedition_id = e.id and r.tier = 'expedition')  as carried_bulk,
            (select coalesce(sum(i.carried),0) from public.warpath_inventory i
               join public.warpath_resources r on r.kind = i.kind
              where i.expedition_id = e.id and r.tier = 'extraction')  as carried_mats,
            (select coalesce(sum(i.secured),0) from public.warpath_inventory i
               join public.warpath_resources r on r.kind = i.kind
              where i.expedition_id = e.id and r.tier = 'extraction')  as secured_mats,
            (select count(*) from public.warpath_cards c
              where c.expedition_id = e.id and c.secured = false)      as unsecured_cards
       from public.warpath_expeditions e where e.run_id = $1 order by e.slot`, [sim.runId]);

  const live = rows.filter(r => r.status === 'active' || r.status === 'extracting');
  let minDist = Infinity, within1 = 0, within2 = 0, within4 = 0;
  for (let i = 0; i < live.length; i++) for (let j = i + 1; j < live.length; j++) {
    const d = cheb(live[i].x, live[i].y, live[j].x, live[j].y);
    minDist = Math.min(minDist, d);
    if (d <= 1) within1++;
    if (d <= 2) within2++;
    if (d <= 4) within4++;
  }
  sim.proximity.push({ turn, live: live.length,
                       minDist: minDist === Infinity ? null : minDist, within1, within2, within4 });
  for (const r of rows) {
    sim.riskSamples.push({ turn, who: r.hero_name, status: r.status,
                           carriedBulk: +r.carried_bulk, carriedMats: +r.carried_mats,
                           securedMats: +r.secured_mats, unsecuredCards: +r.unsecured_cards });
  }
  // Camp discovery, asked the way a client asks it: through warpath_state().
  for (const b of bots) {
    if (b.done) continue;
    const st = await b.s.rpc('warpath_state', [sim.runId]);
    if (!st.in_run) continue;
    const seen = (st.others || []).filter(o => o.camp).length;
    const visible = (st.others || []).filter(o => o.visible).length;
    sim.campSightings.push({ turn, viewer: b.name, campsSeen: seen, heroesVisible: visible });
  }
}

async function collect(obs, sim, bots, map) {
  sim.battles = await obs.sql(
    `select b.id, b.kind, b.status, b.opened_turn, b.x, b.y, b.spoils,
            a.hero_name as attacker, d.hero_name as defender, w.hero_name as winner
       from public.warpath_battles b
       join public.warpath_expeditions a on a.id = b.attacker_id
       left join public.warpath_expeditions d on d.id = b.defender_id
       left join public.warpath_expeditions w on w.id = b.winner_id
      where b.run_id = $1 order by b.opened_turn, b.opened_at`, [sim.runId]);

  sim.finalExp = await obs.sql(
    `select e.slot, e.hero_name, e.status, e.hero_hp, e.stat_distance, e.stat_defeated,
            e.stat_raided, e.stat_bosses,
            (select count(*) from public.warpath_cards c where c.expedition_id = e.id and c.source <> 'starter') as found_cards,
            (select count(*) from public.warpath_cards c where c.expedition_id = e.id and c.source <> 'starter' and c.secured) as secured_cards,
            (select coalesce(jsonb_object_agg(i.kind, i.secured), '{}') from public.warpath_inventory i
               join public.warpath_resources r on r.kind = i.kind
              where i.expedition_id = e.id and r.tier = 'extraction' and i.secured > 0) as vault_mats,
            (select buildings from public.warpath_camps c where c.expedition_id = e.id) as buildings
       from public.warpath_expeditions e where e.run_id = $1 order by e.slot`, [sim.runId]);

  sim.grants = await obs.sql(
    `select u.email, g.card_keys, g.materials, g.summary from public.warpath_grants g
       join auth.users u on u.id = g.user_id where g.run_id = $1`, [sim.runId]);

  sim.claims = (await obs.sql(
    'select count(*)::int n from public.warpath_node_claims where run_id = $1', [sim.runId]))[0].n;
  sim.totalNodes = map.node.flat().filter(Boolean).length;

  sim.events = await obs.sql(
    `select turn, kind, count(*)::int n from public.warpath_events
      where run_id = $1 group by turn, kind order by turn`, [sim.runId]);
  sim.eventKinds = await obs.sql(
    `select kind, count(*)::int n from public.warpath_events where run_id = $1 group by kind order by n desc`,
    [sim.runId]);

  sim.botCounters = Object.fromEntries(bots.map(b => [b.name, b.counters]));
  sim.pgErrors = bots.flatMap(b => b.s.pgErrors.map(e => ({ who: b.name, ...e })));
  sim.rivalCampsKnown = Object.fromEntries(bots.map(b => [b.name, b.rivalCamps.size]));
}

// ── report ──────────────────────────────────────────────────────────────────
function pct(a, b) { return b ? `${(100 * a / b).toFixed(1)}%` : 'n/a'; }
const MATERIALS = new Set(['dragon_heart', 'void_crystal', 'celestial_ore',
                           'ancient_bone', 'ouroboros_core', 'kalon_fragment']);

function report(all) {
  const runs = all.length;
  say('\n══════════════════════════════════════════════════════════════════');
  say(`WARPATH four-player simulation — ${runs} run(s) x ${TURNS} turns`);
  say('══════════════════════════════════════════════════════════════════');

  // 1. collisions and battles
  let pvp = 0, guardian = 0, resolvedPvp = 0, turnsWithin1 = 0, turnsWithin2 = 0, turnsWithin4 = 0, turnsTotal = 0;
  let minDistAll = [];
  for (const { sim } of all) {
    pvp += sim.battles.filter(b => b.kind === 'pvp').length;
    resolvedPvp += sim.battles.filter(b => b.kind === 'pvp' && b.status === 'resolved').length;
    guardian += sim.battles.filter(b => b.kind === 'guardian').length;
    for (const p of sim.proximity) {
      turnsTotal++;
      if (p.within1) turnsWithin1++;
      if (p.within2) turnsWithin2++;
      if (p.within4) turnsWithin4++;
      if (p.minDist != null) minDistAll.push(p.minDist);
    }
  }
  minDistAll.sort((a, b) => a - b);
  const median = minDistAll.length ? minDistAll[minDistAll.length >> 1] : null;
  say('\n① COLLISIONS');
  say(`   PvP battles opened      ${pvp}  (${(pvp / runs).toFixed(2)} per run, ${resolvedPvp} resolved)`);
  say(`   Guardian battles        ${guardian}  (${(guardian / runs).toFixed(2)} per run)`);
  say(`   turns with 2 heroes adjacent (<=1)   ${turnsWithin1}/${turnsTotal}  ${pct(turnsWithin1, turnsTotal)}`);
  say(`   turns with 2 heroes in vision (<=2)  ${turnsWithin2}/${turnsTotal}  ${pct(turnsWithin2, turnsTotal)}`);
  say(`   turns with 2 heroes within 4         ${turnsWithin4}/${turnsTotal}  ${pct(turnsWithin4, turnsTotal)}`);
  say(`   median closest pair distance         ${median}`);
  const spread = all.map(a => a.sim.spawnSpread);
  say(`   spawn spread (max pairwise chebyshev) ${spread.join(', ')} on a ${W}x${H} map`);

  // 2. camp discovery
  let anyCamp = 0, sightRows = 0, firstSight = [];
  for (const { sim } of all) {
    const seenAt = new Map();
    for (const s of sim.campSightings) {
      sightRows++;
      if (s.campsSeen > 0) { anyCamp++; if (!seenAt.has(s.viewer)) seenAt.set(s.viewer, s.turn); }
    }
    firstSight.push(Object.fromEntries(seenAt));
  }
  say('\n② CAMP DISCOVERY');
  say(`   state() samples where a rival camp was visible: ${anyCamp}/${sightRows}  ${pct(anyCamp, sightRows)}`);
  for (let i = 0; i < all.length; i++) {
    const known = all[i].sim.rivalCampsKnown;
    say(`   run ${i}: rival camps ever seen  ${JSON.stringify(known)}   first seen on turn ${JSON.stringify(firstSight[i])}`);
  }

  // 3. turn sync
  say('\n③ TURN SYNC (waiting_for)');
  for (let i = 0; i < all.length; i++) {
    const sim = all[i].sim;
    const hist = {};
    for (const w of sim.waiting) hist[w.waiting_for] = (hist[w.waiting_for] || 0) + 1;
    say(`   run ${i}: end_turn replies by waiting_for ${JSON.stringify(hist)}; advances ${sim.advances.length}; final turn ${sim.finalTurn.turn} (${sim.finalTurn.status})`);
    if (sim.stalls.length) say(`           stalled end_turns skipped: ${sim.stalls.length}${sim.deadlockTurn ? `, world frozen from turn ${sim.deadlockTurn}` : ''}`);
    const bad = sim.advances.filter((a, j, arr) => j && a.turn <= arr[j - 1].turn);
    if (bad.length) say(`           ⚠ non-monotonic turn advance: ${JSON.stringify(bad)}`);
  }

  // 4. risk
  say('\n④ RISK MODEL');
  const defeats = [];
  for (const { sim } of all) for (const b of sim.battles) {
    if (b.kind !== 'pvp' || b.status !== 'resolved') continue;
    const s = b.spoils || {};
    let bulk = 0, mats = 0;
    for (const [k, v] of Object.entries(s)) {
      if (k === 'card_lost') continue;
      if (MATERIALS.has(k)) mats += v; else bulk += v;
    }
    defeats.push({ turn: b.opened_turn, winner: b.winner,
                   loser: b.winner === b.attacker ? b.defender : b.attacker,
                   bulk, mats, card: !!s.card_lost, spoils: s });
  }
  const nonEmpty = defeats.filter(r => r.bulk > 0 || r.mats > 0 || r.card);
  say(`   resolved PvP defeats                       ${defeats.length}`);
  say(`   ...that cost the loser anything at all     ${nonEmpty.length}  ${pct(nonEmpty.length, defeats.length)}`);
  if (defeats.length) {
    const mean = a => (a.reduce((n, x) => n + x, 0) / a.length).toFixed(2);
    say(`   mean expedition resources transferred      ${mean(defeats.map(d => d.bulk))}  (half the loser's carried stock)`);
    say(`   mean EXTRACTION MATERIALS transferred      ${mean(defeats.map(d => d.mats))}  (one of each kind carried)`);
    say(`   defeats that also destroyed an unsecured card ${defeats.filter(d => d.card).length}  ${pct(defeats.filter(d => d.card).length, defeats.length)}`);
    const big = defeats.slice().sort((a, b) => (b.mats * 100 + b.bulk) - (a.mats * 100 + a.bulk)).slice(0, 6);
    say('   the six most expensive defeats:');
    for (const r of big) say(`     t${r.turn} ${r.loser} -> ${r.winner}: ${JSON.stringify(r.spoils)}`);
    const empties = defeats.filter(d => !d.bulk && !d.mats && !d.card).length;
    say(`   defeats that cost the loser NOTHING        ${empties}  ${pct(empties, defeats.length)}  (already stripped, or carrying nothing)`);
  }
  // "push deeper or bank now": how much value was riding on the hero, on average?
  let atRisk = 0, banked = 0, n = 0, cardsAtRisk = 0;
  for (const { sim } of all) for (const s of sim.riskSamples) {
    if (s.status !== 'active') continue;
    atRisk += s.carriedMats; banked += s.securedMats; cardsAtRisk += s.unsecuredCards; n++;
  }
  say(`   mean extraction materials CARRIED (at risk) per active hero-turn ${(atRisk / n).toFixed(2)}`);
  say(`   mean extraction materials SECURED (safe)    per active hero-turn ${(banked / n).toFixed(2)}`);
  say(`   mean unsecured cards on the hero            per active hero-turn ${(cardsAtRisk / n).toFixed(2)}`);
  const meanMats = defeats.length ? defeats.reduce((t, d) => t + d.mats, 0) / defeats.length : 0;
  say(`   ...so an average defeat removes ${(100 * meanMats / Math.max(0.01, atRisk / n)).toFixed(0)}% of the materials a hero is`);
  say('      typically carrying, and nothing at all from the vault.');

  // 5. four-player-only defects
  say('\n⑤ FOUR-PLAYER EFFECTS');
  let races = 0, forks = 0, stuck = 0, errs = [];
  for (const { sim } of all) {
    races += sim.nodeRaces.length;
    if (!sim.lobbyOk) forks++;
    stuck += sim.stuckBattles.filter(s => !s.ok).length;
    errs.push(...sim.errors);
  }
  say(`   lobby forks (four entrants, >1 run)  ${forks}/${runs}`);
  say(`   node claim races lost (already_harvested) ${races}`);
  const claimTotals = all.map(a => `${a.sim.claims}/${a.sim.totalNodes}`);
  say(`   nodes claimed / nodes on map         ${claimTotals.join(', ')}`);
  say(`   battle_report refusals               ${stuck}`);
  const jumps = all.flatMap(a => a.sim.turnJumps);
  const pgerr = all.flatMap(a => a.sim.pgErrors || []);
  say(`   turn advanced by more than 1 in a round  ${jumps.length}${jumps.length ? ` ${JSON.stringify(jumps)}` : ''}`);
  const byCode = {};
  for (const e of pgerr) byCode[`${e.fn}/${e.code}`] = (byCode[`${e.fn}/${e.code}`] || 0) + 1;
  say(`   raw PostgreSQL errors returned to players ${pgerr.length} ${JSON.stringify(byCode)}`);
  const streaks = {};
  for (const { sim } of all) {
    const byPair = {};
    for (const b of sim.battles.filter(b => b.kind === 'pvp' && b.winner)) {
      const loser = b.winner === b.attacker ? b.defender : b.attacker;
      const k = `${b.winner}>${loser}`;
      byPair[k] ??= [];
      byPair[k].push(b.opened_turn);
    }
    for (const [k, turns] of Object.entries(byPair)) {
      turns.sort((a, b) => a - b);
      let best = 1, cur = 1;
      for (let i = 1; i < turns.length; i++) { cur = turns[i] === turns[i - 1] + 1 ? cur + 1 : 1; best = Math.max(best, cur); }
      if (best > (streaks[k] || 0)) streaks[k] = best;
    }
  }
  const worst = Object.entries(streaks).sort((a, b) => b[1] - a[1])[0];
  say(`   longest run of consecutive-turn defeats of the same hero  ${worst ? `${worst[1]} (${worst[0]})` : 0}`);
  if (errs.length) { say('   ⚠ errors:'); for (const e of errs) say(`     - ${e}`); }

  say('\n⑥ PER-BOT');
  for (let i = 0; i < all.length; i++) {
    say(`   run ${i} seed ${all[i].sim.seed}`);
    for (const e of all[i].sim.finalExp) {
      say(`     ${String(e.hero_name).padEnd(6)} ${String(e.status).padEnd(10)} hp${String(e.hero_hp).padStart(4)}` +
          ` dist${String(e.stat_distance).padStart(4)} defeated${e.stat_defeated} raided${e.stat_raided} boss${e.stat_bosses}` +
          ` cards ${e.secured_cards}/${e.found_cards} vault ${JSON.stringify(e.vault_mats)} camp ${JSON.stringify(e.buildings)}`);
    }
    for (const g of all[i].sim.grants)
      say(`     GRANT ${g.email.split('+')[0].padEnd(6)} cards ${g.card_keys.length} mats ${JSON.stringify(g.materials)} ${JSON.stringify(g.summary)}`);
    if (VERBOSE) for (const [k, v] of Object.entries(all[i].sim.botCounters))
      say(`     ${k} ${JSON.stringify(v)}`);
  }
}

// ── main ────────────────────────────────────────────────────────────────────
const all = [];
for (let i = 0; i < RUNS; i++) {
  say(`▶ run ${i + 1}/${RUNS}`);
  all.push(await playOneRun(i));
}
report(all);
if (JSON_OUT) {
  const fs = await import('node:fs');
  fs.writeFileSync(JSON_OUT, JSON.stringify(all.map(a => a.sim), null, 1));
  say(`\nwrote ${JSON_OUT}`);
}
