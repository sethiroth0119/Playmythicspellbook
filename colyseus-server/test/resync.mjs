// ============================================================================
// 🔁 resync recovery test — the server-side fix for the dead stuck-turn watchdog
// ----------------------------------------------------------------------------
// Before the fix, a client's `room.send('resync')` was silently dropped (no
// handler), so a client stranded on "waiting for opponent" never recovered.
// Asserts the new handler:
//   1. A sends a FULL snapshot → server caches it as A's last board.
//   2. B sends 'resync' → B receives a 'snapshot' (resync:true) answered from
//      the server's cache of A's board (instant, no round-trip).
//   3. A (the opponent) receives a relayed 'resync' request so it can also push
//      a fresh board.
//
// Run:  (server up with AUTH_DEV_BYPASS=true)  node test/resync.mjs
// ============================================================================
import { Client } from 'colyseus.js';

const URL = process.env.MP_URL || 'ws://127.0.0.1:2567';
let pass = 0, fail = 0;
const check = (name, cond, extra) => {
  if (cond) { pass++; console.log('  ✅ PASS', name); }
  else { fail++; console.log('  ❌ FAIL', name, extra != null ? JSON.stringify(extra) : ''); }
};
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function attach(room) {
  const rec = { msgs: [], _waiters: [] };
  const TYPES = ['welcome', 'matchStart', 'snapshot', 'resync', 'matchEnd', 'reject'];
  for (const t of TYPES) {
    room.onMessage(t, (payload) => {
      const m = { type: t, payload, at: Date.now() };
      rec.msgs.push(m);
      for (let i = rec._waiters.length - 1; i >= 0; i--) {
        if (rec._waiters[i].type === t) { rec._waiters[i].resolve(m); rec._waiters.splice(i, 1); }
      }
    });
  }
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

(async () => {
  console.log('▶ resync recovery test →', URL);
  try {
    const mid = 'resync-' + Date.now().toString(36);
    const cA = new Client(URL), cB = new Client(URL);
    const rA = await cA.joinOrCreate('battle', { matchId: mid, authToken: 'dev', displayName: 'A', heroId: 'h1' });
    const recA = attach(rA);
    const rB = await cB.joinOrCreate('battle', { matchId: mid, authToken: 'dev', displayName: 'B', heroId: 'h2' });
    const recB = attach(rB);
    const idA = (await recA.waitFor('welcome')).payload.userId;
    await recB.waitFor('welcome');
    await recA.waitFor('matchStart');

    // 1. A pushes a FULL snapshot → cached by the server as A's last board.
    const board = { hello: 'A-board', turn: 3, units: [{ id: 'uA', hp: 9 }] };
    rA.send('snapshot', { kind: 'full', payload: board });
    await recB.waitFor('snapshot', 4000).catch(() => null); // let the relay + cache settle
    await sleep(200);

    // 2. B asks to resync → should get an INSTANT cache answer of A's board.
    rB.send('resync', { reason: 'stuck-turn' });
    let answer = null;
    try { answer = (await recB.waitFor('snapshot', 4000)).payload; } catch {}
    check('requester receives a resync snapshot answer', !!answer, answer);
    check('resync answer is flagged resync:true', answer && answer.resync === true, answer && { resync: answer.resync });
    check('resync answer carries the opponent board from cache (from === A)', answer && answer.from === idA, answer && { from: answer.from, idA });
    check('resync answer payload is A\'s cached board verbatim',
      answer && JSON.stringify(answer.payload) === JSON.stringify(board), answer && answer.payload);

    // 3. The opponent (A) receives the relayed resync REQUEST so it re-pushes too.
    let relayed = null;
    try { relayed = (await recA.waitFor('resync', 4000)).payload; } catch {}
    check('opponent receives the relayed resync request', !!relayed, relayed);
    check('relayed resync names the requester', relayed && relayed.from && relayed.from !== idA, relayed);

    try { rA.leave(true); rB.leave(true); } catch {}
  } catch (e) {
    fail++;
    console.error('\n💥 harness error:', e && e.message ? e.message : e);
  }
  console.log(`\n──────── ${pass} passed, ${fail} failed ────────`);
  process.exit(fail === 0 ? 0 : 1);
})();
