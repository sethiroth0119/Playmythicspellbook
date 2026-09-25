// ============================================================================
// 💓 Heartbeat-survival test — proves the client keepalive mechanism is sound.
// ----------------------------------------------------------------------------
// The real bug: Fly's EDGE PROXY closes an idle WebSocket at ~20s — exactly the
// silent VS-screen → coin-flip window — dropping the HOST before the coin flip.
// The fix: the client sends a no-op 'ping' every 5s and the server acks 'pong',
// so the socket is never idle. The proxy itself only exists on the deployed Fly
// app (localhost has none), so this test CANNOT reproduce the proxy drop — but it
// CAN prove the mechanism that defeats it:
//   1. Every client 'ping' gets a 'pong' back (round-trip wired correctly).
//   2. Two clients stay joined through a 30s window with NO activity except the
//      5s heartbeat — i.e. the keepalive cadence (5s) safely beats the ~20s
//      idle budget, and the heartbeat traffic doesn't trip any disconnect.
//   3. Neither client receives an unexpected onLeave during the idle window.
//
// Run:  (server up with AUTH_DEV_BYPASS=true)
//       node test/heartbeat.mjs            # defaults to ws://127.0.0.1:2567
// ============================================================================
import { Client } from 'colyseus.js';

const URL = process.env.MP_URL || 'ws://127.0.0.1:2567';
const IDLE_MS = Number(process.env.IDLE_MS || 30000);  // stay idle (heartbeat only) this long
const PING_MS = 5000;                                   // matches the client cadence
let pass = 0, fail = 0;
const check = (name, cond, extra) => {
  if (cond) { pass++; console.log('  ✅ PASS', name); }
  else { fail++; console.log('  ❌ FAIL', name, extra != null ? JSON.stringify(extra) : ''); }
};
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

(async () => {
  console.log('▶ Heartbeat-survival test →', URL, `(idle ${Math.round(IDLE_MS / 1000)}s, ping every ${PING_MS / 1000}s)`);
  const mid = 'hb-' + Date.now().toString(36);
  const cA = new Client(URL), cB = new Client(URL);

  const rA = await cA.joinOrCreate('battle', { matchId: mid, authToken: 'dev', displayName: 'A', heroId: 'h1' });
  const rB = await cB.joinOrCreate('battle', { matchId: mid, authToken: 'dev', displayName: 'B', heroId: 'h2' });

  // Track pongs + unexpected leaves on each side.
  const st = (room, tag) => {
    const s = { pongs: 0, leftCode: null, tag };
    room.onMessage('pong', () => { s.pongs++; });
    room.onLeave((code) => { s.leftCode = code; });
    return s;
  };
  const sA = st(rA, 'A'), sB = st(rB, 'B');

  check('both clients joined the same room', rA.roomId === rB.roomId, { a: rA.roomId, b: rB.roomId });

  // Drive the heartbeat exactly like the client does: ping every 5s, nothing else.
  const beat = (room) => { try { room.send('ping', {}); } catch (e) {} };
  const expectedPings = Math.floor(IDLE_MS / PING_MS);
  const tA = setInterval(() => beat(rA), PING_MS);
  const tB = setInterval(() => beat(rB), PING_MS);
  // Fire one immediately so the first interval isn't a full 5s away.
  beat(rA); beat(rB);

  await sleep(IDLE_MS);
  clearInterval(tA); clearInterval(tB);
  // Give the last pong a moment to arrive.
  await sleep(400);

  check('host (A) stayed connected through the idle window', sA.leftCode === null, { code: sA.leftCode });
  check('guest (B) stayed connected through the idle window', sB.leftCode === null, { code: sB.leftCode });
  check('host (A) received a pong for its pings', sA.pongs >= expectedPings - 1, { pongs: sA.pongs, expected: expectedPings });
  check('guest (B) received a pong for its pings', sB.pongs >= expectedPings - 1, { pongs: sB.pongs, expected: expectedPings });

  try { rA.leave(true); rB.leave(true); } catch (e) {}
  await sleep(200);
  console.log(`\n──────── ${pass} passed, ${fail} failed ────────`);
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => { console.error('💥 harness error:', e && e.message ? e.message : e); process.exit(1); });
