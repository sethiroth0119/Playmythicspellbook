// ============================================================================
// 🔥 LOAD + DESYNC TEST — can the MP server hold a public launch, and do two
//    players actually end up looking at the same board?
// ----------------------------------------------------------------------------
// Run (server up locally with AUTH_DEV_BYPASS=true):
//
//   node test/loadtest.mjs                     # 100 pairs = 200 clients
//   node test/loadtest.mjs --pairs 250         # 500 clients
//   node test/loadtest.mjs --pairs 20 --verbose
//
// ⚠ POINT IT AT A LOCAL SERVER. It defaults to ws://127.0.0.1:2567 and needs
//   AUTH_DEV_BYPASS=true, which is NEVER on in production. Running this against
//   the live Fly app would both fail auth and load a server real players are on.
//
// ----------------------------------------------------------------------------
// WHY THIS MEASURES DESYNC AND NOT JUST THROUGHPUT
//
// BattleRoom has TWO sources of truth for one board:
//
//   1. AUTHORITATIVE — `handleAction` runs calculateDamage() server-side and
//      mutates the @type schema, which Colyseus delta-syncs to both clients.
//      Two clients reading `room.state` MUST agree; that is what the schema is.
//   2. RELAY — the `snapshot` handler takes a client's OWN view of the board and
//      rebroadcasts it verbatim to the opponent, unvalidated:
//         this.broadcast('snapshot', { from: me, kind, payload: body },
//                        { except: client });
//
// Whichever lands last wins, so a client's opinion can overwrite the server's
// own numbers. That is desync by construction, and it is why a stuck-turn
// watchdog and a `resync` recovery path already exist in this codebase — those
// are treatments for a live symptom.
//
// So this test asserts two DIFFERENT things:
//
//   A. SCHEMA AGREEMENT — both clients' `room.state` digests must be identical.
//      A failure here means the authoritative sync itself is breaking, which
//      would be the more serious of the two.
//   B. RELAY DIVERGENCE — the last relayed snapshot's unit HP vs the SAME units
//      in the authoritative state. Divergence here is the two-sources-of-truth
//      problem showing itself, and it is the number to watch while closing the
//      relay one message type at a time. Non-zero is EXPECTED today; the goal is
//      to drive it to zero.
//
// Neither assertion needs game rules — only that two views of one board match.
// ============================================================================
import { Client } from 'colyseus.js';

const arg = (k, d) => {
  const i = process.argv.indexOf('--' + k);
  return i >= 0 ? (process.argv[i + 1] ?? true) : d;
};
const URL      = process.env.MP_URL || 'ws://127.0.0.1:2567';
const PAIRS    = Math.max(1, parseInt(arg('pairs', 100), 10));
const RAMP_MS  = Math.max(0, parseInt(arg('ramp', 20), 10));      // stagger per pair
const ROUNDS   = Math.max(1, parseInt(arg('rounds', 6), 10));     // exchanges per pair
const VERBOSE  = process.argv.includes('--verbose');

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const pct = (a, p) => a.length ? +a.slice().sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(a.length * p))].toFixed(1) : 0;

const M = {
  joinOk: 0, joinFail: 0, matchStart: 0,
  joinMs: [], firstStateMs: [],
  schemaAgree: 0, schemaDisagree: 0, schemaUnknown: 0,
  relayChecked: 0, relayDiverged: 0,
  snapshotsSent: 0, snapshotsSeen: 0,
  errors: {},
};
const err = (e) => {
  const k = String((e && e.message) || e).slice(0, 90);
  M.errors[k] = (M.errors[k] || 0) + 1;
};

/* A stable digest of the AUTHORITATIVE board: what the server says is true.
   Only fields both clients must agree on — ids, hp, position, alive. */
function digest(state) {
  try {
    if (!state || !state.units) return null;
    const rows = [];
    state.units.forEach((u, k) => {
      rows.push([u.id || k, u.currentHp | 0, u.posX | 0, u.posY | 0, u.alive ? 1 : 0].join(':'));
    });
    if (!rows.length) return null;
    return rows.sort().join('|');
  } catch { return null; }
}
/* HP by unit id, from the authoritative state — compared against the relay. */
function hpMap(state) {
  const m = {};
  try { state.units.forEach((u, k) => { m[u.id || k] = u.currentHp | 0; }); } catch {}
  return m;
}

async function onePair(i) {
  const matchId = 'lt-' + process.pid + '-' + i;
  const cA = new Client(URL), cB = new Client(URL);
  let rA, rB;
  try {
    const t0 = Date.now();
    rA = await cA.joinOrCreate('battle', { matchId, authToken: 'dev', displayName: 'A' + i, heroId: 'h1' });
    rB = await cB.joinOrCreate('battle', { matchId, authToken: 'dev', displayName: 'B' + i, heroId: 'h2' });
    M.joinOk += 2;
    M.joinMs.push(Date.now() - t0);
  } catch (e) {
    M.joinFail += 2; err(e);
    try { rA && rA.leave(); } catch {} try { rB && rB.leave(); } catch {}
    return;
  }

  // Track what each side RECEIVES over the relay, per unit id.
  const relayHp = { A: null, B: null };
  const grab = (side) => (msg) => {
    M.snapshotsSeen++;
    try {
      const units = msg && msg.payload && msg.payload.state && msg.payload.state.units;
      if (Array.isArray(units)) {
        const m = {};
        for (const u of units) if (u && u.id != null) m[u.id] = u.currentHp | 0;
        relayHp[side] = m;
      }
    } catch {}
  };
  rA.onMessage('snapshot', grab('A'));
  rB.onMessage('snapshot', grab('B'));
  rA.onMessage('matchStart', () => { M.matchStart++; });
  rB.onMessage('matchStart', () => {});
  rA.onError && rA.onError(err); rB.onError && rB.onError(err);

  const tState = Date.now();
  try { rA.send('ready', {}); rB.send('ready', {}); } catch (e) { err(e); }
  await sleep(120);
  if (digest(rA.state)) M.firstStateMs.push(Date.now() - tState);

  /* Play real units so the AUTHORITATIVE schema actually populates. Without
     this the board stays empty, digest() returns null, and BOTH desync checks
     silently pass having compared nothing — a green result that means "I never
     looked". The first run of this test did exactly that (no-units 3). */
  const mkUnit = (who, n) => ({
    type: 'playUnit', cardId: 'lt_c' + n, name: 'LT' + who + n, icon: '🗿',
    posX: n % 8, posY: who === 'A' ? 1 : 6, energyCost: 0, isHero: false,
    stats: { hp: 30, atk: 7, def: 3, mag: 2, res: 2 },
    elements: [], passives: [],
  });
  for (const [who, room] of [['A', rA], ['B', rB]]) {
    for (let n = 0; n < 2; n++) {
      try { room.send('action', mkUnit(who, n)); } catch (e) { err(e); }
      await sleep(35);
    }
  }
  await sleep(150);

  // Then drive traffic: snapshots + pings, alternating like a real turn.
  for (let r = 0; r < ROUNDS; r++) {
    const sender = r % 2 ? rB : rA;
    /* The relayed snapshot deliberately reports a WRONG hp for a unit the
       server also owns. If the relay is authoritative-by-accident this shows up
       as divergence; if the server's schema wins, it does not. That is exactly
       the thing being measured. */
    const fake = [];
    try { rA.state.units.forEach(u => fake.push({ id: u.id, currentHp: (u.currentHp | 0) - 1 })); } catch {}
    try {
      sender.send('snapshot', { kind: 'full', payload: { turn: r, state: { units: fake } } });
      M.snapshotsSent++;
      sender.send('ping', {});
    } catch (e) { err(e); }
    await sleep(70);
  }
  await sleep(220);   // let the last deltas land

  // ── A. SCHEMA AGREEMENT — the authoritative sync ──────────────────────────
  const dA = digest(rA.state), dB = digest(rB.state);
  if (dA == null || dB == null) M.schemaUnknown++;
  else if (dA === dB) M.schemaAgree++;
  else {
    M.schemaDisagree++;
    if (VERBOSE) console.log('  ⚠ schema disagree pair', i, '\n    A=', dA.slice(0, 120), '\n    B=', dB.slice(0, 120));
  }

  // ── B. RELAY DIVERGENCE — client opinion vs server truth ──────────────────
  const auth = hpMap(rA.state);
  for (const side of ['A', 'B']) {
    const seen = relayHp[side];
    if (!seen) continue;
    const ids = Object.keys(seen).filter(id => id in auth);
    if (!ids.length) continue;
    M.relayChecked++;
    if (ids.some(id => seen[id] !== auth[id])) {
      M.relayDiverged++;
      if (VERBOSE) console.log('  ⚠ relay diverged pair', i, side);
    }
  }

  try { rA.leave(); rB.leave(); } catch {}
}

(async () => {
  console.log(`\n🔥 LOAD + DESYNC TEST  →  ${URL}`);
  console.log(`   ${PAIRS} pairs (${PAIRS * 2} clients), ${ROUNDS} rounds each, ${RAMP_MS}ms ramp\n`);
  const started = Date.now();
  const jobs = [];
  for (let i = 0; i < PAIRS; i++) { jobs.push(onePair(i)); await sleep(RAMP_MS); }
  await Promise.all(jobs);
  const secs = ((Date.now() - started) / 1000).toFixed(1);

  console.log(`\n── RESULT after ${secs}s ─────────────────────────────────────`);
  console.log(`  clients joined      : ${M.joinOk} ok / ${M.joinFail} failed`);
  console.log(`  matchStart received : ${M.matchStart}`);
  console.log(`  join latency        : p50 ${pct(M.joinMs, .5)}ms  p95 ${pct(M.joinMs, .95)}ms  max ${pct(M.joinMs, 1)}ms`);
  console.log(`  first state         : p50 ${pct(M.firstStateMs, .5)}ms  p95 ${pct(M.firstStateMs, .95)}ms`);
  console.log(`  snapshots sent/seen : ${M.snapshotsSent} / ${M.snapshotsSeen}`);
  console.log(`\n  A. SCHEMA AGREEMENT  (authoritative sync — MUST be clean)`);
  console.log(`     ⚠ These units were played by THIS TEST via room.send('action').`);
  console.log(`       The shipping client NEVER sends 'action' (0 call sites), so in`);
  console.log(`       production state.units is EMPTY and this check measures a path`);
  console.log(`       real matches do not use. Green here = "the server engine is`);
  console.log(`       correct when driven", NOT "the game drives it".`);
  console.log(`     agree ${M.schemaAgree}   disagree ${M.schemaDisagree}   no-units ${M.schemaUnknown}`);
  console.log(`\n  B. RELAY DIVERGENCE  (client opinion vs server truth)`);
  console.log(`     checked ${M.relayChecked}   diverged ${M.relayDiverged}`);
  if (Object.keys(M.errors).length) {
    console.log(`\n  errors:`);
    for (const [k, n] of Object.entries(M.errors).sort((a, b) => b[1] - a[1]).slice(0, 8)) console.log(`     ${n}x  ${k}`);
  }

  const hardFail = M.joinFail > 0 || M.schemaDisagree > 0;
  console.log('');
  if (M.schemaDisagree > 0) console.log('  ❌ AUTHORITATIVE SYNC DISAGREED — this is the serious one. Two clients');
  if (M.schemaDisagree > 0) console.log('     read different values from the SAME server-owned schema.');
  if (M.relayDiverged > 0)  console.log('  ⚠ RELAY DIVERGED — expected until the snapshot relay is retired. This is');
  if (M.relayDiverged > 0)  console.log('     the number to drive to zero while closing it, one message type at a time.');
  if (!hardFail && !M.relayDiverged) console.log('  ✅ no disagreement detected at this load.');
  console.log('');
  process.exit(hardFail ? 1 : 0);
})();
