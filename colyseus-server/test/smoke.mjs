// ============================================================================
// 🔬 BattleRoom smoke test — "server owns match" guarantees
// ----------------------------------------------------------------------------
// Spins up TWO colyseus.js clients against a locally-running server and asserts
// the authoritative-lifecycle behaviour we rely on:
//   1. Both clients join the SAME room (filterBy matchId) and get a matchStart.
//   2. Turn authority: the off-turn client's endTurn is REJECTED; the on-turn
//      client's endTurn FLIPS state.currentTurnUserId to the opponent.
//   3. Snapshot relay: a client's 'snapshot' is forwarded verbatim to the
//      opponent (and not echoed back to the sender).
//   4. Single-writer result: two simultaneous, CONFLICTING claimResults yield
//      exactly ONE matchEnd, identical for both clients (first claim wins).
//   5. Disconnect → forfeit: a non-consented leave ends the match for the
//      surviving player after the (test-shortened) reconnect window.
//
// Run:  (server up with AUTH_DEV_BYPASS=true RECONNECT_WINDOW_S=2)
//       node test/smoke.mjs            # defaults to ws://127.0.0.1:2567
// ============================================================================
import { Client } from 'colyseus.js';

const URL = process.env.MP_URL || 'ws://127.0.0.1:2567';
let pass = 0, fail = 0;
const check = (name, cond, extra) => {
  if (cond) { pass++; console.log('  ✅ PASS', name); }
  else { fail++; console.log('  ❌ FAIL', name, extra != null ? JSON.stringify(extra) : ''); }
};
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// Attach a message/state recorder to a room with a waitFor(type) helper.
function attach(room) {
  const rec = { msgs: [], state: null, matchEnds: [] };
  const TYPES = ['welcome', 'matchStart', 'snapshot', 'matchEnd', 'reject', 'battleLog', 'unitPlayed', 'attackResult', 'emote'];
  rec._waiters = [];
  for (const t of TYPES) {
    room.onMessage(t, (payload) => {
      const m = { type: t, payload, at: Date.now() };
      rec.msgs.push(m);
      if (t === 'matchEnd') rec.matchEnds.push(payload);
      for (let i = rec._waiters.length - 1; i >= 0; i--) {
        if (rec._waiters[i].type === t) { rec._waiters[i].resolve(m); rec._waiters.splice(i, 1); }
      }
    });
  }
  room.onStateChange((s) => { rec.state = s; });
  rec.waitFor = (type, timeoutMs = 5000) => {
    const hit = rec.msgs.find(m => m.type === type && !m._c);
    if (hit) { hit._c = true; return Promise.resolve(hit); }
    return new Promise((resolve, reject) => {
      const w = { type, resolve: (m) => { m._c = true; resolve(m); } };
      rec._waiters.push(w);
      setTimeout(() => {
        const idx = rec._waiters.indexOf(w);
        if (idx >= 0) rec._waiters.splice(idx, 1);
        reject(new Error('timeout waiting for ' + type));
      }, timeoutMs);
    });
  };
  return rec;
}

async function joinPair(matchId) {
  const cA = new Client(URL), cB = new Client(URL);
  const rA = await cA.joinOrCreate('battle', { matchId, authToken: 'dev', displayName: 'A', heroId: 'h1' });
  const recA = attach(rA);
  const rB = await cB.joinOrCreate('battle', { matchId, authToken: 'dev', displayName: 'B', heroId: 'h2' });
  const recB = attach(rB);
  const idA = (await recA.waitFor('welcome')).payload.userId;
  const idB = (await recB.waitFor('welcome')).payload.userId;
  return { cA, cB, rA, rB, recA, recB, idA, idB };
}

// Poll a predicate against the latest state.
async function waitState(rec, pred, timeoutMs = 5000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    if (rec.state && pred(rec.state)) return true;
    await sleep(40);
  }
  return false;
}

async function scenarioTurnsAndRelay() {
  console.log('\n[1/3] turn authority + snapshot relay');
  const mid = 'smoke-turns-' + Date.now().toString(36);
  const { cA, cB, rA, rB, recA, recB, idA, idB } = await joinPair(mid);

  const ms = await recA.waitFor('matchStart');
  const first = ms.payload.first;
  check('matchStart has a valid first-turn participant', first === idA || first === idB, { first, idA, idB });
  check('both clients have distinct ids', idA && idB && idA !== idB, { idA, idB });
  // 🦸 matchStart must relay BOTH players' heroId so each client can build the
  // SAME opponent hero (fix for "NaN/NaN HP opponent + two different boards").
  const heroes = ms.payload.heroes || {};
  check('matchStart relays a heroes map for both players',
    heroes[idA] === 'h1' && heroes[idB] === 'h2', heroes);
  const names = ms.payload.names || {};
  check('matchStart relays a names map for both players',
    names[idA] === 'A' && names[idB] === 'B', names);
  await waitState(recA, s => s.currentTurnUserId === first);
  check('state.currentTurnUserId === matchStart.first', recA.state?.currentTurnUserId === first);

  const activeRoom = (first === idA) ? rA : rB;
  const passiveRoom = (first === idA) ? rB : rA;
  const passiveRec = (first === idA) ? recB : recA;
  const other = (first === idA) ? idB : idA;

  // Off-turn endTurn must be rejected.
  passiveRoom.send('endTurn', {});
  let rejected = false;
  try { const r = await passiveRec.waitFor('reject', 3000); rejected = r.payload?.reason === 'not-your-turn'; } catch {}
  check('off-turn endTurn is rejected (not-your-turn)', rejected);

  // On-turn endTurn flips the turn.
  activeRoom.send('endTurn', {});
  const flipped = await waitState(recA, s => s.currentTurnUserId === other, 4000);
  check('on-turn endTurn flips currentTurnUserId to opponent', flipped, { now: recA.state?.currentTurnUserId, want: other });

  // Snapshot relay: A sends a full snapshot → B receives it verbatim; A does not.
  const body = { hello: 'world', n: 7, units: [{ id: 'u1', hp: 12 }] };
  const beforeA = recA.msgs.filter(m => m.type === 'snapshot').length;
  rA.send('snapshot', { kind: 'full', payload: body });
  let relay = null;
  try { relay = (await recB.waitFor('snapshot', 4000)).payload; } catch {}
  check('opponent receives relayed snapshot', !!relay, relay);
  check('relayed snapshot.from === sender id', relay && relay.from === idA, relay && { from: relay.from, idA });
  check('relayed snapshot payload is verbatim', relay && JSON.stringify(relay.payload) === JSON.stringify(body), relay && relay.payload);
  await sleep(300);
  const afterA = recA.msgs.filter(m => m.type === 'snapshot').length;
  check('sender does NOT receive its own snapshot back', afterA === beforeA, { beforeA, afterA });

  try { rA.leave(true); rB.leave(true); } catch {}
}

async function scenarioSingleWriter() {
  console.log('\n[2/3] single-writer result (conflicting simultaneous claims)');
  const mid = 'smoke-result-' + Date.now().toString(36);
  const { rA, rB, recA, recB, idA, idB } = await joinPair(mid);
  await recA.waitFor('matchStart');

  // Both clients claim DIFFERENT winners at the same time.
  rA.send('claimResult', { winnerUserId: idA, reason: 'test-a' });
  rB.send('claimResult', { winnerUserId: idB, reason: 'test-b' });

  const endA = await recA.waitFor('matchEnd', 5000).catch(() => null);
  const endB = await recB.waitFor('matchEnd', 5000).catch(() => null);
  check('both clients receive a matchEnd', endA && endB, { endA: endA?.payload, endB: endB?.payload });
  check('both agree on the SAME winner', endA && endB && endA.payload.winnerUserId === endB.payload.winnerUserId,
    { a: endA?.payload?.winnerUserId, b: endB?.payload?.winnerUserId });
  check('winner is one of the two participants',
    endA && (endA.payload.winnerUserId === idA || endA.payload.winnerUserId === idB), endA?.payload);

  // Ensure no SECOND matchEnd is delivered (late conflicting claim ignored).
  await sleep(600);
  check('exactly one matchEnd per client (no late second result)',
    recA.matchEnds.length === 1 && recB.matchEnds.length === 1,
    { a: recA.matchEnds.length, b: recB.matchEnds.length });
}

async function scenarioDisconnect() {
  console.log('\n[3/3] disconnect → opponent wins');
  const mid = 'smoke-dc-' + Date.now().toString(36);
  const { rA, rB, recA, recB, idA, idB } = await joinPair(mid);
  await recA.waitFor('matchStart');

  // A drops without consent → after the (shortened) reconnect window, B wins.
  try { rA.leave(false); } catch {}
  const endB = await recB.waitFor('matchEnd', 12000).catch(() => null);
  check('surviving client receives matchEnd after DC', !!endB, endB?.payload);
  check('disconnected player loses (winner === survivor)', endB && endB.payload.winnerUserId === idB,
    { winner: endB?.payload?.winnerUserId, survivor: idB });
  check('end reason is disconnect', endB && endB.payload.reason === 'disconnect', endB?.payload);
}

(async () => {
  console.log('▶ BattleRoom smoke test →', URL);
  try {
    await scenarioTurnsAndRelay();
    await scenarioSingleWriter();
    await scenarioDisconnect();
  } catch (e) {
    fail++;
    console.error('\n💥 harness error:', e && e.message ? e.message : e);
  }
  console.log(`\n──────── ${pass} passed, ${fail} failed ────────`);
  process.exit(fail === 0 ? 0 : 1);
})();
