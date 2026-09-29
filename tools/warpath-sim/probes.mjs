// ─────────────────────────────────────────────────────────────────────────────
// 🔬 WARPATH four-player probes.
//
// sim.mjs answers "what happens when four people play". This answers "what
// happens when four people do the specific awkward thing", which a free-running
// simulation will not reliably reach: simultaneous end_turn, two heroes racing
// for one node in the same millisecond, a battle nobody reports, a defeat
// landing in the middle of somebody's extraction countdown, a player who walks
// away from the keyboard.
//
// Each probe sets up its own run and prints PASS / FAIL / NOTE. NOTE is for
// "this is what the server does, and somebody should decide whether it is what
// was meant" — most of the interesting output is NOTE.
//
//   tools/warpath-sim/pg.sh reset && node tools/warpath-sim/probes.mjs
// ─────────────────────────────────────────────────────────────────────────────
import { Session, loadMap, cheb } from './warpath-client.mjs';

let PASS = 0, FAIL = 0, NOTES = [];
const pass = m => { PASS++; console.log(`  ✔ ${m}`); };
const fail = m => { FAIL++; console.log(`  ✘ FAIL ${m}`); };
const note = m => { NOTES.push(m); console.log(`  • ${m}`); };
const head = m => console.log(`\n── ${m} ${'─'.repeat(Math.max(0, 66 - m.length))}`);

const obs = new Session('obs');
await obs.open(null);

let uidSeq = 0;
async function freshRun(n = 4, tag = 'p') {
  // Close every open lobby first, or these four matchmake into leftovers from
  // the previous probe and quietly end up in different worlds.
  await obs.sql("update public.warpath_runs set status = 'closed' where status = 'open'");
  const players = [];
  for (let i = 0; i < n; i++) {
    const uid = (await obs.sql('insert into auth.users (email) values ($1) returning id',
                               [`${tag}${uidSeq++}@probe.sim`]))[0].id;
    const s = new Session(`P${i}`);
    await s.open(uid);
    players.push({ s, uid, i });
  }
  const entries = await Promise.all(players.map((p, i) =>
    (async () => { await p.s.rpc('warpath_claim_free_ticket');
                   return p.s.rpc('warpath_enter', [`hero_${i}`, `P${i}`, 'ticket']); })()));
  players.forEach((p, i) => { p.exp = entries[i].expedition_id; p.run = entries[i].run_id; });
  const runId = entries[0].run_id;
  if (new Set(entries.map(e => e.run_id)).size !== 1) throw new Error('probe fixture: players landed in different runs');
  const map = await loadMap(obs, entries[0].seed);
  return { players, runId, seed: entries[0].seed, map, entries };
}

/** Teleport for probe setup only. The bots never do this; it is the equivalent
 *  of a fixture, and it writes the same columns warpath_move would. */
async function place(exp, x, y) {
  await obs.sql('update public.warpath_expeditions set x=$2, y=$3 where id=$1', [exp, x, y]);
  await obs.sql('select public.wp_reveal($1, $2, $3, public.wp_vision($1))', [exp, x, y]);
}
const setMoves = (exp, n) => obs.sql('update public.warpath_expeditions set moves_left=$2 where id=$1', [exp, n]);
const closeAll = ps => Promise.all(ps.map(p => p.s.close()));

// ═══════════════════════════════════════════════════════════════════════════
head('P1  acting after end_turn');
{
  const { players } = await freshRun(4, 'p1_');
  const [a] = players;
  const before = await a.s.rpc('warpath_state', []);
  const r = await a.s.rpc('warpath_end_turn', [a.exp]);
  note(`end_turn -> ${JSON.stringify(r)}`);
  const st = await a.s.rpc('warpath_state', []);
  note(`turn_ended=${st.me.turn_ended}, moves_left still ${st.me.moves_left}`);
  // Can this hero still act while the other three are "waiting for" it?
  const camp = await a.s.rpc('warpath_camp_place', [a.exp]);
  const mv = await a.s.rpc('warpath_move', [a.exp, before.me.x + 1, before.me.y]);
  if (mv.ok || camp.ok) {
    note('⚠ a hero that has ENDED ITS TURN can still move, pitch camp and harvest — '
       + 'turn_ended is a readiness flag, not a lock. `warpath_move` (migration:1222) '
       + 'never looks at it.');
  } else pass('ending a turn locks the hero out of further actions');
  const bat = await a.s.rpc('warpath_battle_open', [a.exp, players[1].exp]);
  note(`battle_open after end_turn -> ${bat.reason ?? 'ok'} (out_of_reach here just means nobody is adjacent)`);
  await closeAll(players);
}

// ═══════════════════════════════════════════════════════════════════════════
head('P2  simultaneous end_turn from all four');
{
  const { players, runId } = await freshRun(4, 'p2_');
  const rounds = Number(process.env.WP_SYNC_ROUNDS || 30);
  let noAdvance = 0, multiAdvance = 0, deadlocks = 0, jumps = [];
  for (let t = 0; t < rounds; t++) {
    const before = (await obs.sql('select turn from public.warpath_runs where id=$1', [runId]))[0].turn;
    const rs = await Promise.all(players.map(p => p.s.rpc('warpath_end_turn', [p.exp])));
    const after = (await obs.sql('select turn from public.warpath_runs where id=$1', [runId]))[0].turn;
    const advanced = rs.filter(r => r.advanced).length;
    deadlocks += rs.filter(r => r.pg_code === '40P01').length;
    if (advanced === 0) noAdvance++;
    if (advanced > 1) multiAdvance++;
    jumps.push(after - before);
    if (after - before !== 1 || deadlocks)
      note(`round ${t}: waiting_for=${JSON.stringify(rs.map(r => r.waiting_for ?? (r.advanced ? 'ADV' : r.pg_code || r.reason)))}`
         + `  turn ${before} -> ${after}`);
  }
  const tally = {};
  for (const j of jumps) tally[j] = (tally[j] || 0) + 1;
  note(`turn deltas across ${rounds} synchronised rounds: ${JSON.stringify(tally)} (every round should be exactly 1)`);
  if (noAdvance || multiAdvance || deadlocks || jumps.some(j => j !== 1)) {
    fail('four simultaneous end_turns do not advance the world exactly once');
    note('⚠ warpath_end_turn (migration:1568) sets its own turn_ended and then COUNTS the '
       + 'others in the same READ COMMITTED transaction. Four concurrent callers each see '
       + 'only their own write, so all four report waiting_for=3 and NOBODY advances the '
       + 'clock. On the retry all four see pending=0 and all four run the advance block, so '
       + 'the turn jumps by up to 4 — or deadlocks, because each caller locks its own '
       + 'expedition row first and warpath_runs second, while the advance block locks '
       + 'warpath_runs first and every expedition row second (classic ABBA).');
    note(`observed: ${noAdvance} rounds with no advance, ${multiAdvance} rounds with more than one, `
       + `${deadlocks} deadlock (40P01) errors returned to callers`);
    note('warpath_enter already fixes exactly this class of bug one function earlier with '
       + 'pg_advisory_xact_lock(hashtext(\'warpath_lobby\')) (migration:1052). end_turn has no '
       + 'equivalent.');
  } else {
    pass(`${rounds} rounds of four simultaneous end_turns advanced the clock exactly once each`);
  }
  await closeAll(players);
}

// ═══════════════════════════════════════════════════════════════════════════
head('P3  one stalled player holds the world');
{
  const { players, runId, map: map3 } = await freshRun(4, 'p3_');
  const [stallers, movers] = [players.slice(0, 1), players.slice(1)];
  const seen = [];
  for (let t = 0; t < 5; t++) {
    const rs = await Promise.all(movers.map(p => p.s.rpc('warpath_end_turn', [p.exp])));
    seen.push(rs.map(r => r.waiting_for ?? `adv:${r.turn}`).join(','));
  }
  const turn = (await obs.sql('select turn from public.warpath_runs where id=$1', [runId]))[0].turn;
  note(`three of four ended their turn five times; waiting_for replies: ${seen.join(' | ')}`);
  if (turn === 1) pass(`run.turn stayed at ${turn} — waiting_for held, no phantom advance`);
  else fail(`run.turn advanced to ${turn} while a player had not ended their turn`);
  note('⚠ there is no turn timer anywhere in the migration: one player who closes '
     + 'the tab freezes the other three for the rest of the run. The only escape is '
     + 'warpath_abandon(), which the stalled player is by definition not calling.');
  // ...and the three who are waiting are not actually blocked from acting:
  const st = await movers[0].s.rpc('warpath_state', []);
  const step = [[1,0],[0,1],[-1,0],[0,-1],[1,1],[-1,-1]]
    .map(([dx,dy]) => [st.me.x+dx, st.me.y+dy])
    .find(([x,y]) => x>=0 && y>=0 && x<44 && y<30 && !map3.water[y][x]);
  const mv = await movers[0].s.rpc('warpath_move', [movers[0].exp, step[0], step[1]]);
  if (mv.ok) note('⚠ a player whose turn is already ended keeps its full movement and keeps '
                + 'playing while the other three sit in "WAITING FOR". The turn is a barrier '
                + 'on the CLOCK, not on the players.');
  else note(`a waiting player's move while the world is frozen -> ${mv.reason}`);
  const r = await stallers[0].s.rpc('warpath_end_turn', [stallers[0].exp]);
  if (r.advanced) pass('the stalled player ending its turn released the world immediately');
  else fail(`releasing the stall did not advance: ${JSON.stringify(r)}`);
  await closeAll(players);
}

// ═══════════════════════════════════════════════════════════════════════════
head('P4  two heroes race for one node');
{
  const { players, map } = await freshRun(4, 'p4_');
  // find a node tile and stand both players on it
  let target = null;
  for (let y = 0; y < 30 && !target; y++) for (let x = 0; x < 44; x++)
    if (map.node[y][x] && map.node[y][x].tier === 'expedition') { target = { x, y, ...map.node[y][x] }; break; }
  await place(players[0].exp, target.x, target.y);
  await place(players[1].exp, target.x, target.y);
  const [r0, r1] = await Promise.all([
    players[0].s.rpc('warpath_harvest', [players[0].exp]),
    players[1].s.rpc('warpath_harvest', [players[1].exp]),
  ]);
  const winners = [r0, r1].filter(r => r.ok).length;
  if (winners === 1) pass(`exactly one hero claimed ${target.kind} x${target.amount} at ${target.x},${target.y}`);
  else fail(`${winners} heroes claimed the same node: ${JSON.stringify([r0, r1])}`);
  note(`loser got: ${JSON.stringify(r0.ok ? r1 : r0)}`);
  await closeAll(players);
}

// ═══════════════════════════════════════════════════════════════════════════
head('P5  a battle nobody reports');
{
  const { players } = await freshRun(4, 'p5_');
  const [a, b] = players;
  await place(a.exp, 20, 15); await place(b.exp, 21, 15);
  await setMoves(a.exp, 6);
  const open = await a.s.rpc('warpath_battle_open', [a.exp, b.exp]);
  if (!open.ok) { fail(`could not open a battle: ${JSON.stringify(open)}`); }
  else {
    const mvA = await a.s.rpc('warpath_move', [a.exp, 20, 16]);
    const mvB = await b.s.rpc('warpath_move', [b.exp, 22, 15]);
    note(`with the battle open: attacker move -> ${mvA.reason ?? 'ok'}, defender move -> ${mvB.reason ?? 'ok'}`);
    if (!mvB.ok) note('⚠ the DEFENDER is frozen by a battle it did not start and cannot decline. '
                    + 'If the attacker closes the tab, the defender cannot move again — '
                    + 'unless it reports the battle itself, which it is allowed to do:');
    /* B5 changed this deliberately. A unilateral self-declared WIN no longer
       takes the opponent's goods — it is recorded as a claim and waits. */
    const selfReport = await b.s.rpc('warpath_battle_report', [open.battle_id, b.exp]);
    if (selfReport.ok && selfReport.we_won_race) {
      fail("the DEFENDER unilaterally declared ITSELF the winner and took the attacker's goods");
    } else if (selfReport.pending_confirmation) {
      pass('a unilateral self-declared win takes nothing — it waits for the opponent');
    } else fail(`unexpected self-report: ${JSON.stringify(selfReport)}`);

    const late = await a.s.rpc('warpath_battle_report', [open.battle_id, a.exp]);
    if (late.pending_confirmation || late.we_won_race === false)
      pass('the contradictory second claim does not overwrite anything either');
    else fail(`double report was not gated: ${JSON.stringify(late)}`);

    /* The defender always has an immediate way out of a battle it did not
       start and cannot decline: concede. Nobody lies to lose, so it resolves
       at once and unfreezes the map for both. */
    const concede = await b.s.rpc('warpath_battle_report', [open.battle_id, a.exp]);
    if (concede.ok && concede.we_won_race) {
      pass('the defender can concede to unfreeze itself immediately');
      const mv = await b.s.rpc('warpath_move', [b.exp, 22, 15]);
      if (mv.ok || mv.reason !== 'battle_pending')
        pass('and it can move again once the battle is settled');
      else fail(`still frozen after conceding: ${JSON.stringify(mv)}`);
    } else fail(`conceding did not resolve: ${JSON.stringify(concede)}`);
  }
  await closeAll(players);
}

// ═══════════════════════════════════════════════════════════════════════════
head('P6  simultaneous contradictory battle reports');
{
  const { players } = await freshRun(4, 'p6_');
  const [a, b] = players;
  await place(a.exp, 20, 15); await place(b.exp, 21, 15);
  await setMoves(a.exp, 6);
  const open = await a.s.rpc('warpath_battle_open', [a.exp, b.exp]);
  const [ra, rb] = await Promise.all([
    a.s.rpc('warpath_battle_report', [open.battle_id, a.exp]),
    b.s.rpc('warpath_battle_report', [open.battle_id, b.exp]),
  ]);
  /* The contract changed deliberately (B5). A bare self-declared WIN is no
     longer believed on its own, so two heroes both claiming victory must now
     settle NEITHER — being first is worth nothing. This is a stronger
     assertion than the one it replaces, which only required that exactly one
     of two contradictory claims stuck. */
  const won = [ra, rb].filter(r => r.we_won_race).length;
  const pending = [ra, rb].filter(r => r.pending_confirmation).length;
  if (won === 0 && pending === 2)
    pass('two contradictory win claims settle neither — posting first buys nothing');
  else fail(`contradictory claims: ${won} claimed the race, ${pending} pending: ${JSON.stringify([ra, rb])}`);

  let row = (await obs.sql('select winner_id, status from public.warpath_battles where id=$1', [open.battle_id]))[0];
  if (row.status === 'open' && row.winner_id === null)
    pass('the battle stays open while the two accounts disagree');
  else fail(`a contested battle resolved anyway: ${JSON.stringify(row)}`);

  // ...and it must not stay open forever, or both heroes are pinned.
  for (const p of players) await p.s.rpc('warpath_end_turn', [p.exp]);
  row = (await obs.sql('select winner_id, status from public.warpath_battles where id=$1', [open.battle_id]))[0];
  if (row.status === 'resolved' && row.winner_id)
    pass('the turn boundary settles a contested battle, so nobody is pinned by a silent opponent');
  else fail(`a contested battle survived the turn sweep: ${JSON.stringify(row)}`);
  note(`the sweep awarded it to ${row.winner_id === a.exp ? 'the attacker' : 'the defender'}`);
  note('a self-declared WIN is now recorded as a claim and needs the opponent to agree; '
     + 'a CONCESSION is believed at once, because nobody lies to lose. Whichever client '
     + 'posts first no longer decides the fight.');
  await closeAll(players);
}

// ═══════════════════════════════════════════════════════════════════════════
head('P7  defeat during the extraction countdown');
{
  const { players, map } = await freshRun(4, 'p7_');
  const [victim, raider] = players;
  const gate = map.gates.find(g => g.main);
  await place(victim.exp, gate.x, gate.y);
  // give the victim a camp somewhere else and something worth taking
  await place(victim.exp, gate.x, gate.y);
  await victim.s.rpc('warpath_camp_place', [victim.exp]);
  await obs.sql('update public.warpath_camps set x=$2, y=$3 where expedition_id=$1', [victim.exp, 5, 5]);
  await obs.sql(`insert into public.warpath_inventory (expedition_id, kind, carried) values ($1,'dragon_heart',1)
                 on conflict (expedition_id, kind) do update set carried = 1`, [victim.exp]);

  const beg = await victim.s.rpc('warpath_extract_begin', [victim.exp]);
  if (!beg.ok) { fail(`extract_begin refused at the main gate: ${JSON.stringify(beg)}`); }
  else {
    note(`extraction started, ${beg.turns} turns to wait, at gate "${beg.gate}"`);
    const ev = await obs.sql(
      `select payload from public.warpath_events where kind='extraction_started' order by id desc limit 1`);
    note(`the run-wide broadcast carries: ${JSON.stringify(ev[0].payload)}`);
    if (ev[0].payload.x != null)
      note('⚠ the "A HERO IS PREPARING TO LEAVE" event publishes the extracting '
         + "hero's exact coordinates to every other player, through warpath_state().events, "
         + 'regardless of fog (migration:1828).');

    await place(raider.exp, gate.x + 1, gate.y);
    await setMoves(raider.exp, 6);
    const open = await raider.s.rpc('warpath_battle_open', [raider.exp, victim.exp]);
    if (!open.ok) { note(`an extracting hero could not be attacked: ${open.reason}`); }
    else {
      /* Both clients report — which is what the shipped bridge does: each side
         calls warpath_battle_report from warpathAfterBattle, so the loser's
         report is a concession and resolves immediately. Reporting from only
         the winner leaves it awaiting corroboration (see P6). */
      await raider.s.rpc('warpath_battle_report', [open.battle_id, raider.exp]);
      await victim.s.rpc('warpath_battle_report', [open.battle_id, raider.exp]);
      const after = (await obs.sql(
        'select x, y, status, extract_left, injured_turns from public.warpath_expeditions where id=$1',
        [victim.exp]))[0];
      note(`after losing mid-extraction: status=${after.status} extract_left=${after.extract_left} `
         + `position=${after.x},${after.y} (camp is 5,5; the gate is ${gate.x},${gate.y}) injured=${after.injured_turns}`);
      if (after.status !== 'extracting' && after.extract_left === 0) {
        pass('losing mid-extraction cancels the countdown and puts the hero back on the map');
      }
      if (after.status === 'extracting') {
        note('⚠ THE EXTRACTION SURVIVES THE DEFEAT. warpath_battle_report (migration:1770) '
           + 'retreats the loser to their camp and injures them but never touches `status` or '
           + '`extract_left`, so the hero finishes extracting from the middle of the map, '
           + 'nowhere near a gate. Losing during the countdown costs only what you were carrying.');
      }
      // Finish the countdown and see whether it completes off-gate.
      for (const p of players) await p.s.rpc('warpath_end_turn', [p.exp]);
      for (const p of players) await p.s.rpc('warpath_end_turn', [p.exp]);
      const st = await victim.s.rpc('warpath_state', []);
      note(`two turns later: status=${st.me.status} at ${st.me.x},${st.me.y}`);
      if (st.me.status === 'ready') {
        const fin = await victim.s.rpc('warpath_extract_finish', [victim.exp]);
        if (fin.ok) note('⚠ and warpath_extract_finish() completed away from any gate.');
      }
    }
  }
  await closeAll(players);
}

// ═══════════════════════════════════════════════════════════════════════════
head('P8  a hero pinned at its own camp');
{
  const { players } = await freshRun(4, 'p8_');
  const [bully, victim] = players;
  await victim.s.rpc('warpath_camp_place', [victim.exp]);
  const camp = (await obs.sql('select x, y from public.warpath_camps where expedition_id=$1', [victim.exp]))[0];
  let streak = 0, escaped = false;
  for (let t = 0; t < 8; t++) {
    await place(bully.exp, camp.x + 1, camp.y);
    await setMoves(bully.exp, 6);
    const open = await bully.s.rpc('warpath_battle_open', [bully.exp, victim.exp]);
    if (!open.ok) { note(`turn ${t}: attack refused (${open.reason})`); break; }
    await bully.s.rpc('warpath_battle_report', [open.battle_id, bully.exp]);
    streak++;
    const v = (await obs.sql(
      'select x, y, moves_left, injured_turns, hero_hp from public.warpath_expeditions where id=$1',
      [victim.exp]))[0];
    if (v.x !== camp.x || v.y !== camp.y) escaped = true;
    for (const p of players) await p.s.rpc('warpath_end_turn', [p.exp]);
  }
  const v = (await obs.sql('select hero_hp, injured_turns from public.warpath_expeditions where id=$1',
                           [victim.exp]))[0];
  note(`the same hero was defeated ${streak} turns running at its own camp; hp ${v.hero_hp}, injured ${v.injured_turns}`);
  if (streak >= 5) {
    note('⚠ the once-per-turn-per-pairing rule (migration:1673) caps the RATE of a raid '
       + 'but not its TOTAL. Defeat teleports the loser to their camp with moves_left=0 and '
       + 'injured_turns=2 (4 moves next turn), so an attacker who simply stands next to that '
       + 'camp can re-take the victim every single turn for the rest of the run. hero_hp never '
       + 'reaches 0 (greatest(1, hp-30)) so there is no death, no respawn and no way out.');
  }
  await closeAll(players);
}

// ═══════════════════════════════════════════════════════════════════════════
head('P9  camp discovery, end to end');
{
  const { players } = await freshRun(4, 'p9_');
  const [owner, scout] = players;
  await owner.s.rpc('warpath_camp_place', [owner.exp]);
  const camp = (await obs.sql('select x, y from public.warpath_camps where expedition_id=$1', [owner.exp]))[0];
  await obs.sql(`update public.warpath_inventory set secured = 40 where expedition_id = $1`, [owner.exp]);
  await owner.s.rpc('warpath_camp_build', [owner.exp, 'supply']);
  await owner.s.rpc('warpath_camp_build', [owner.exp, 'watchtower']);

  const before = await scout.s.rpc('warpath_state', []);
  const seenBefore = (before.others || []).find(o => o.expedition_id === owner.exp);
  if (seenBefore && seenBefore.camp === null) pass('an unexplored rival camp is not in the payload at all');
  else fail(`camp leaked before exploration: ${JSON.stringify(seenBefore)}`);

  // Walk the scout onto the camp tile — the only thing that reveals it.
  await place(scout.exp, camp.x, camp.y);
  const after = await scout.s.rpc('warpath_state', []);
  const seenAfter = (after.others || []).find(o => o.expedition_id === owner.exp);
  if (seenAfter && seenAfter.camp && seenAfter.camp.x === camp.x) {
    pass(`the rival camp is now reported at ${seenAfter.camp.x},${seenAfter.camp.y} `
       + `with buildings ${JSON.stringify(seenAfter.camp.buildings)}`);
    note('the camp payload includes the rival\'s BUILDING LEVELS, so a scout learns '
       + 'exactly how big their vault and their recruitment tent are.');
  } else fail(`camp not reported after exploring its tile: ${JSON.stringify(seenAfter)}`);

  // Persistence: does the camp stay visible once the scout walks away?
  await place(scout.exp, camp.x + 8, camp.y + 6);
  const later = await scout.s.rpc('warpath_state', []);
  const seenLater = (later.others || []).find(o => o.expedition_id === owner.exp);
  if (seenLater?.camp) pass('and it stays visible after the scout leaves (fog is explored-once)');
  else fail('the camp vanished when the scout walked away');
  if (seenLater && seenLater.x == null) pass('the camp OWNER, though, is hidden again outside vision');
  else fail(`the owner's position leaked at range: ${JSON.stringify(seenLater)}`);

  // A rival's camp MOVES. Does the stale position follow?
  await place(owner.exp, camp.x + 10, camp.y);
  await setMoves(owner.exp, 6);
  const moved = await owner.s.rpc('warpath_camp_place', [owner.exp]);
  const post = await scout.s.rpc('warpath_state', []);
  const seenPost = (post.others || []).find(o => o.expedition_id === owner.exp);
  note(`after the owner packed camp to ${camp.x + 10},${camp.y} (${moved.ok ? 'moved' : moved.reason}), `
     + `the scout sees camp = ${JSON.stringify(seenPost?.camp)}`);
  if (moved.ok && seenPost?.camp == null)
    note('a packed camp disappears from the scout\'s map — correct, but the scout gets no '
       + 'event telling them it moved, so it reads as a bug from the client side.');
  await closeAll(players);
}

// ═══════════════════════════════════════════════════════════════════════════
head('P10  the fifth player, and the closed run');
{
  const { players, runId } = await freshRun(4, 'pA_');
  const uid = (await obs.sql('insert into auth.users (email) values ($1) returning id',
                             ['fifth@probe.sim']))[0].id;
  const s = new Session('P4'); await s.open(uid);
  await s.rpc('warpath_claim_free_ticket');
  const r = await s.rpc('warpath_enter', ['hero_x', 'Fifth', 'ticket']);
  const runs = await obs.sql('select id, status, (select count(*) from public.warpath_expeditions e where e.run_id = warpath_runs.id) n from public.warpath_runs order by created_at');
  if (r.ok && r.run_id !== runId) pass(`a fifth entrant opened a NEW run (${runs.length} runs now)`);
  else fail(`fifth entrant: ${JSON.stringify(r)}`);
  const full = (await obs.sql('select status from public.warpath_runs where id=$1', [runId]))[0];
  if (full.status === 'active') pass('the full run flipped open -> active and stopped accepting joiners');
  else fail(`full run status is ${full.status}`);
  await s.close(); await closeAll(players);
}

// ═══════════════════════════════════════════════════════════════════════════
head('P11  the EXPEDITION COMPLETE summary of an empty run');
{
  const { players, map } = await freshRun(4, 'pB_');
  const [a] = players;
  const gate = map.gates.find(g => g.main);
  await place(a.exp, gate.x, gate.y);
  await a.s.rpc('warpath_extract_begin', [a.exp]);
  for (let i = 0; i < 3; i++) for (const p of players) await p.s.rpc('warpath_end_turn', [p.exp]);
  const fin = await a.s.rpc('warpath_extract_finish', [a.exp]);
  if (!fin.ok) fail(`extract_finish: ${JSON.stringify(fin)}`);
  else {
    note(`summary: ${JSON.stringify(fin.summary)}`);
    if (fin.summary.cards_secured === null)
      note('⚠ `cards_secured` is NULL, not 0, when nothing was found — '
         + 'array_length(keys,1) on an empty array (migration:1878). The EXPEDITION COMPLETE '
         + 'screen renders whatever "null" turns into.');
    if (fin.summary.resources_extracted > 0 && Object.keys(fin.materials).length === 0)
      note(`⚠ the same summary reports resources_extracted=${fin.summary.resources_extracted} for a hero `
         + 'that harvested nothing — it is counting the 70-unit STARTING STIPEND, which is '
         + 'secured on turn 1 and is not carried home by warpath_grants at all.');
  }
  await closeAll(players);
}

// ═══════════════════════════════════════════════════════════════════════════
head('P12  the argument list the shipping client actually sends');
{
  /* Every entry below is a call site in public/warpath/warpath-app.js, with the
     EXACT args object that file passes. PostgREST resolves an RPC by matching
     those keys against parameter names, so this is the whole contract between
     the client and the migration — and it can be checked without a browser. */
  const CALLS = [
    ['warpath_state',          {},                                            140],
    ['warpath_camp_build',     { p_building: 'supply' },                      814],
    ['warpath_secure',         {},                                            818],
    ['warpath_abandon',        {},                                            850],
    ['warpath_move',           { p_x: 1, p_y: 1 },                            903],
    ['warpath_harvest',        {},                                            908],
    ['warpath_camp_place',     {},                                            920],
    ['warpath_battle_open',    { p_target: null },                            944],
    ['warpath_extract_begin',  {},                                            956],
    ['warpath_end_turn',       {},                                            981],
    ['warpath_encounter_pick', { p_enc: null, p_idx: 0 },                    1049],
    ['warpath_recruit',        { p_site: 'forest_hollow', p_idx: 0 },        1105],
    ['warpath_battle_open',    {},                                           1130],
    ['warpath_battle_report',  { p_battle: null, p_winner: null },           1141],
    ['warpath_extract_finish', { p_keep: null },                             1288],
    ['warpath_enter',          { p_hero_id: 'h', p_hero_name: 'H', p_pay: 'ticket' }, 1461],
  ];
  const sigs = Object.fromEntries((await obs.sql(
    `select p.proname fn, p.pronargs nargs, p.pronargdefaults nd,
            array(select unnest(p.proargnames)) names
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname like 'warpath\\_%'`))
    .map(r => [r.fn, { names: r.names, required: r.names.slice(0, r.nargs - r.nd) }]));

  const unresolvable = [];
  for (const [fn, args, line] of CALLS) {
    const missing = sigs[fn].required.filter(n => !(n in args));
    if (missing.length) unresolvable.push({ fn, line, missing });
  }
  if (unresolvable.length === 0) {
    pass('every RPC the client makes resolves against the migration');
  } else {
    fail(`${unresolvable.length} of ${CALLS.length} client call sites cannot resolve to any function`);
    for (const u of unresolvable)
      note(`warpath-app.js:${u.line}  ${u.fn}  missing ${u.missing.join(', ')}`);
    note('⚠ every one of them is missing p_exp, which the migration declares as the FIRST '
       + 'parameter with no default and which nothing in public/ ever sends '
       + '(`grep -rn p_exp public/` returns one unrelated dojo call). PostgREST answers '
       + 'PGRST202, and public/index.html:215536 rewrites that into "The Warpath is not '
       + 'installed on this server yet".');
    note('⚠ AND THERE IS NO WAY OUT. warpath_enter and warpath_state are the only two calls '
       + "that DO resolve, so a player can pay a ticket (or 3 AZA), enter, and then find "
       + 'every button broken — including End turn and Abandon. warpath_enter then refuses '
       + "with already_in_a_warpath forever (migration:1011), and the run can never close "
       + 'because closing it happens inside warpath_end_turn (migration:1613). One entry '
       + 'locks the account out of the mode permanently.');
  }
}

console.log(`\n════════ probes: ${PASS} passed, ${FAIL} failed, ${NOTES.length} notes ════════`);
await obs.close();
process.exit(FAIL ? 1 : 0);
