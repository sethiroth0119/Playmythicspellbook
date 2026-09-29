/* CRITIC PROBE — M2. Does the now-live `_resync` flag let a STALE resync answer
   leapfrog a NEWER legitimate board?

   The builder's driver states plainly that its relay is "lossless, in-order".
   The dedup it bypasses exists for exactly the opposite case — the comment
   above it says "out-of-order delivery", and onEndTurn:165690 says the
   turnNumber bump is there because "a reordered stale packet would overwrite
   newer state and desync the board".

   SCENARIO (same for both trees, one packet reordered):
     1. A and B converge through the shipped handshake.
     2. Real play until A holds the turn at turnNumber N with B caught up.
     3. A's outbound wire is FROZEN.
     4. B presses the shipped manual Re-sync button path (_mpRequestResync).
        A's shipped 'resync' handler answers with _sendFullSnapshot → P1,
        carrying turn = N. P1 is pulled OUT of the queue and set aside.
     5. A plays a unit and ends its turn → turnNumber N+1, broadcastMyState → P2.
     6. P2 is delivered first (B adopts the N+1 board), THEN the set-aside P1.

   ASSERTION, on the RECEIVER B only:
     after P1, B.lastRecvSnapshot / B's board must still be the N+1 board.
     If B rolls back to the N board, the resync flag has re-opened the exact
     rollback the dedup exists to stop.

   CONTROL: the identical run on a pre-fix tree (`, _resync: true` deleted,
   1 site asserted) must DROP P1. If both trees drop it, the probe found
   nothing and says so.

   Stub / server model / relay lifted from .gauntlet/drive-mp-authority-gate.mjs
   and .gauntlet/drive-mp-resync-stale.mjs so the fidelity notes carry over.
*/
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ROOT = path.resolve(process.cwd(), 'public');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.txt': 'text/plain', '.webp': 'image/webp', '.glb': 'model/gltf-binary' };
const PORT = 8790 + (process.pid % 40);
const RUNS = (() => { const a = process.argv.find(s => s.startsWith('--runs')); if (!a) return 1;
  const n = parseInt(a.split('=')[1], 10); return Number.isFinite(n) && n > 0 ? n : 3; })();
const SRC = path.join(ROOT, 'index.html');

const FIX = ', _resync: true }';
const srcText = fs.readFileSync(SRC, 'utf8');
const sites = srcText.split(FIX).length - 1;
if (sites !== 1) { console.log('cannot build control: ' + sites + ' sites'); process.exit(2); }
const PREFIX_SRC = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'crit-m2-')), 'prefix.html');
fs.writeFileSync(PREFIX_SRC, srcText.replace(FIX, ' }'));

const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p.endsWith('/')) p += 'index.html';
  let f;
  if (p === '/index.html') f = SRC; else if (p === '/prefix.html') f = PREFIX_SRC;
  else f = path.join(ROOT, p);
  if ((f !== SRC && f !== PREFIX_SRC && !f.startsWith(ROOT)) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end('nf'); }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
});
await new Promise(r => server.listen(PORT, '127.0.0.1', r));
const log = console.log;

function makeMatchRow(p1, p2) {
  return { id: 'match-crit', player1_id: p1, player2_id: p2,
    current_player_id: null, turn_number: 1, winner_id: null, status: 'active' };
}
function srv_init(row, uid, args) { if (row.current_player_id == null) row.current_player_id = (args && args.p_opener_id) || uid; return { data: true, error: null }; }
function srv_end(row, uid, body) {
  const b = body || {};
  if (row.current_player_id == null) row.current_player_id = uid;
  if (row.current_player_id !== uid) return { data: { ok: false, currentPlayerId: row.current_player_id, turnNumber: row.turn_number, winnerId: null, reason: 'not_your_turn' }, error: null };
  const exp = Math.max(1, Math.floor(Number(b.expectedTurn || 0)));
  if (exp < (row.turn_number || 1)) return { data: { ok: false, currentPlayerId: row.current_player_id, turnNumber: row.turn_number, winnerId: null, reason: 'turn_out_of_sync' }, error: null };
  if (exp > (row.turn_number || 1)) row.turn_number = exp;
  row.current_player_id = (uid === row.player1_id) ? row.player2_id : row.player1_id;
  row.turn_number = row.turn_number + 1;
  return { data: { ok: true, currentPlayerId: row.current_player_id, turnNumber: row.turn_number, winnerId: row.winner_id, reason: '' }, error: null };
}

function makeRelay() { return { pending: [], seq: 0, hold: {}, vizDropped: 0, lost: 0 }; }
const OTHER = (s) => (s === 'A' ? 'B' : 'A');
function relayEnqueue(relay, from, event, payload) {
  if (event === 'unitviz') { relay.vizDropped++; return; }
  relay.pending.push({ id: ++relay.seq, from, event, payload });
}
async function deliverOne(clients, p) {
  const target = clients[OTHER(p.from)];
  if (p.event === 'matches.UPDATE') return target.page.evaluate(row => window.__mpDeliver('postgres_changes', 'UPDATE', { new: row }), p.payload);
  return target.page.evaluate(([e, pl]) => window.__mpDeliver('broadcast', e, { payload: pl }), [p.event, p.payload]);
}
async function pump(relay, clients) {
  let n = 0;
  for (;;) {
    const ix = relay.pending.findIndex(p => !relay.hold[p.from]);
    if (ix < 0) break;
    const p = relay.pending.splice(ix, 1)[0];
    const landed = await deliverOne(clients, p);
    if (!landed) { relay.lost++; continue; }
    n += landed;
  }
  return n;
}
async function settle(relay, clients, ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) { await new Promise(r => setTimeout(r, 90)); await pump(relay, clients); }
}

const PAGE_STUB = () => {
  window.__rs = { chans: {}, errs: [], probeN: 0, _sent: 0, wire: [] };
  window.__rs.mkChannel = (name) => {
    const hs = [];
    const ch = {
      on(type, filt, cb) { hs.push({ type, event: filt && filt.event, cb }); return ch; },
      send(msg) {
        try {
          window.__rs.wire.push({ event: msg.event, turn: msg.payload && msg.payload.turn, resync: !!(msg.payload && msg.payload._resync) });
          if (window.__rs.wire.length > 60) window.__rs.wire.shift();
          window.__rs._sent++;
          window.__mpSend(JSON.stringify({ event: msg.event, payload: msg.payload }));
        } catch (e) { window.__rs.errs.push('send: ' + e); }
        return Promise.resolve('ok');
      },
      subscribe(cb) { if (cb) setTimeout(() => { try { cb('SUBSCRIBED'); } catch (e) { window.__rs.errs.push('sub: ' + e); } }, 0); return ch; },
      track: () => Promise.resolve('ok'), untrack: () => Promise.resolve('ok'),
      unsubscribe: () => Promise.resolve('ok'), presenceState: () => ({}),
      _deliver(type, event, arg) { let n = 0; for (const h of hs) if (h.type === type && h.event === event) { n++; try { h.cb(arg); } catch (e) { window.__rs.errs.push('handler ' + event + ': ' + e); } } return n; },
    };
    window.__rs.chans[name] = ch; return ch;
  };
  window.__mpDeliver = (type, event, arg) => { let n = 0; for (const k of Object.keys(window.__rs.chans)) n += window.__rs.chans[k]._deliver(type, event, arg); return n; };
  window.__rs.setup = (o) => {
    Cloud.ready = true;
    Cloud.client = {
      channel: (n) => window.__rs.mkChannel(n), removeChannel: () => {},
      from: () => ({ select: function () { return this; }, eq: function () { return this; }, order: function () { return this; }, limit: function () { return this; }, maybeSingle: function () { return this; }, single: function () { return this; }, then: (r) => Promise.resolve({ data: [], error: null }).then(r) }),
      rpc: (fn, args) => window.__mpRpc(JSON.stringify({ fn, args })).then(s => JSON.parse(s)),
      functions: { invoke: (fn, opts) => window.__mpInvoke(JSON.stringify({ fn, body: opts && opts.body })).then(s => JSON.parse(s)) },
      auth: { getSession: () => Promise.resolve({ data: { session: null } }) },
    };
    Profile.cloud = Profile.cloud || {};
    Profile.cloud.signedIn = true; Profile.cloud.userId = o.userId;
    Profile.cloud.displayName = o.myName; Profile.cloud.autoSync = false;
    App.battlePrep = App.battlePrep || {};
    const me = findHeroById(STARTER_HEROES[o.myHero].id);
    const foe = findHeroById(STARTER_HEROES[o.oppHero].id);
    App.battlePrep.hero = me; App.battlePrep.heroId = me.id;
    App.battlePrep.multiplayer = true; App.battlePrep.opponentName = o.oppName;
    const goesFirst = !!o.myTurn;
    App.state = initGame(me, foe, [], goesFirst, null);
    App.state.currentTurn = goesFirst ? 'player' : 'ai';
    App.screen = 'battle'; render();
    joinMatchChannel(o.matchId, o.amIPlayer1, o.oppId);
    MatchBroadcast.myTurn = goesFirst; App.ui.aiBusy = !goesFirst;
    return { units: (App.state.units || []).length, channel: !!MatchBroadcast.channel, turnNumber: App.state.turnNumber };
  };
  const fp = (st) => { if (!st) return 'NONE'; return 'tn' + (st.turnNumber == null ? '?' : st.turnNumber) + '/' + (st.units || []).length + 'u:' + (st.units || []).map(u => u.id).sort().join(','); };
  window.__rs.marks = () => ({
    turnNumber: App.state && App.state.turnNumber, currentTurn: App.state && App.state.currentTurn,
    myTurn: !!MatchBroadcast.myTurn, units: (App.state && App.state.units || []).length,
    awaitingResync: !!MatchBroadcast.awaitingResync, lastSeenTurn: MatchBroadcast.lastSeenTurn | 0,
    recvFp: fp(MatchBroadcast.lastRecvSnapshot), boardFp: fp(App.state),
    authorityDrops: MatchBroadcast._authorityDrops | 0,
    unitIds: (App.state && App.state.units || []).map(u => u.id).sort().join(','),
  });
  window.__rs.playProbe = () => {
    const s = App.state; const hand = (s.player.hand || []).slice();
    if (!hand.length) return { err: 'empty hand' };
    window.__rs.probeN++;
    const card = { id: '_c_probe', name: 'Crit Probe ' + window.__rs.probeN, type: 'unit', cost: 0, level: 1,
      atk: 2, def: 1, hp: 8, stats: { atk: 2, def: 1, hp: 8 },
      instanceId: 'cprobe_' + Profile.cloud.userId + '_' + window.__rs.probeN, onPlay: null };
    hand[0] = card;
    App.state = { ...s, player: { ...s.player, hand } };
    const ph = App.state.units.find(u => u.owner === 'player' && u.isHero);
    const tiles = getValidPlacementTiles(card, ph, App.state);
    if (!tiles || !tiles.length) return { err: 'no legal tile' };
    const before = App.state.units.length;
    placeUnit(card, tiles[0]);
    return { ok: App.state.units.length === before + 1, units: App.state.units.length };
  };
  window.__rs.endTurn = () => {
    const before = App.state.turnNumber;
    try { onEndTurn(); } catch (e) { return { err: String(e) }; }
    return { ok: App.state.turnNumber === before + 1, from: before, to: App.state.turnNumber };
  };
  window.__rs.manualResync = () => {
    const before = window.__rs._sent;
    try { _mpRequestResync('manual'); } catch (e) { return { err: String(e) }; }
    return { sent: window.__rs._sent - before };
  };
  window.__rs.errors = () => window.__rs.errs.slice(0, 6);
};

const UID = { A: 'uid-aaaa-1111', B: 'uid-bbbb-2222' };
const SETUP = {
  A: { userId: UID.A, oppId: UID.B, amIPlayer1: true, myHero: 0, oppHero: 1, myTurn: true, myName: 'Ava', oppName: 'Bex' },
  B: { userId: UID.B, oppId: UID.A, amIPlayer1: false, myHero: 1, oppHero: 0, myTurn: false, myName: 'Bex', oppName: 'Ava' },
};
async function bootClient(browser, relay, row, side, srcPath) {
  const context = await browser.newContext({ viewport: { width: 1100, height: 760 } });
  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', e => pageErrors.push(String(e).slice(0, 180)));
  await page.route('**/*', r => { const u = r.request().url(); return (u.includes('127.0.0.1') || u.includes('localhost')) ? r.continue() : r.abort(); });
  await page.exposeFunction('__mpSend', (json) => { const m = JSON.parse(json); relayEnqueue(relay, side, m.event, m.payload); });
  await page.exposeFunction('__mpRpc', (json) => { const m = JSON.parse(json); if (m.fn === 'mp_init_match') return JSON.stringify(srv_init(row, UID[side], m.args)); return JSON.stringify({ data: null, error: null }); });
  await page.exposeFunction('__mpInvoke', (json) => {
    const m = JSON.parse(json);
    if (m.fn !== 'mp_end_turn') return JSON.stringify({ data: null, error: null });
    const res = srv_end(row, UID[side], m.body);
    if (res.data && res.data.ok) { relayEnqueue(relay, 'A', 'matches.UPDATE', { ...row }); relayEnqueue(relay, 'B', 'matches.UPDATE', { ...row }); }
    return JSON.stringify(res);
  });
  await page.goto('http://127.0.0.1:' + PORT + srcPath, { waitUntil: 'domcontentloaded', timeout: 180000 });
  await page.waitForFunction('typeof initGame === "function" && typeof joinMatchChannel === "function" && typeof placeUnit === "function" && typeof _sendFullSnapshot === "function" && typeof _mpRequestResync === "function"', null, { timeout: 240000 });
  await page.evaluate(PAGE_STUB);
  return { side, page, context, pageErrors, uid: UID[side] };
}

async function runArm(browser, srcPath, label) {
  const relay = makeRelay();
  const row = makeMatchRow(UID.A, UID.B);
  const clients = {};
  const [a, b] = await Promise.all([bootClient(browser, relay, row, 'A', srcPath), bootClient(browser, relay, row, 'B', srcPath)]);
  clients.A = a; clients.B = b;
  const M = async (s) => clients[s].page.evaluate(() => window.__rs.marks());
  const out = { label, src: srcPath, applicable: false, why: [] };
  try {
    await clients.A.page.evaluate(o => window.__rs.setup(o), { ...SETUP.A, matchId: row.id });
    await clients.B.page.evaluate(o => window.__rs.setup(o), { ...SETUP.B, matchId: row.id });
    await settle(relay, clients, 5200);

    // real play, so both sides have a genuine history; A ends up holding again
    await clients.A.page.evaluate(() => window.__rs.playProbe());
    await settle(relay, clients, 600);
    await clients.A.page.evaluate(() => window.__rs.endTurn());
    await settle(relay, clients, 1400);
    await clients.B.page.evaluate(() => window.__rs.playProbe());
    await settle(relay, clients, 600);
    await clients.B.page.evaluate(() => window.__rs.endTurn());
    await settle(relay, clients, 1600);

    const preA = await M('A'), preB = await M('B');
    out.pre = { A: preA, B: preB };
    if (!preA.myTurn) { out.why.push('A does not hold the turn after the handoff (A.myTurn=' + preA.myTurn + ')'); return out; }

    // FREEZE A's wire, let the 30ms broadcastMyState debounce drain, then CLEAR
    // A's queue so the only A 'state' packet left afterwards is the resync
    // answer itself. (Without this the probe can pick up an ordinary debounced
    // action broadcast and measure the wrong packet.)
    relay.hold.A = true;
    await new Promise(r => setTimeout(r, 400));
    relay.pending = relay.pending.filter(p => p.from !== 'A');
    const asked = await clients.B.page.evaluate(() => window.__rs.manualResync());
    if (!asked || !asked.sent) { out.why.push('B put no resync on the wire: ' + JSON.stringify(asked)); return out; }
    await pump(relay, clients);   // B's ask lands on A; A's answer is HELD
    await new Promise(r => setTimeout(r, 200));
    await pump(relay, clients);

    // pull A's resync answer (P1) out of the queue and set it aside
    const ix = relay.pending.findIndex(p => p.from === 'A' && p.event === 'state');
    if (ix < 0) { out.why.push('A produced no state answer (pending: ' + relay.pending.map(p => p.from + '/' + p.event).join(',') + ')'); return out; }
    const P1 = relay.pending.splice(ix, 1)[0];
    // On the FIXED tree the answer must carry _resync; on the PRE-FIX tree it
    // must not. Anything else means we grabbed the wrong packet.
    const wantFlag = (srcPath === '/index.html');
    if (!!P1.payload._resync !== wantFlag) {
      out.why.push('grabbed the wrong packet: _resync=' + !!P1.payload._resync + ' but this tree should emit ' + wantFlag);
      return out;
    }
    out.P1 = { turn: P1.payload.turn, resync: !!P1.payload._resync, units: (P1.payload.state.units || []).length,
      tn: P1.payload.state.turnNumber, currentTurn: P1.payload.state.currentTurn };

    // A plays and ends its turn → turnNumber N+1, broadcastMyState → P2
    await clients.A.page.evaluate(() => window.__rs.playProbe());
    await clients.A.page.evaluate(() => window.__rs.endTurn());
    relay.hold.A = false;
    await settle(relay, clients, 1800);

    const mid = await M('B');
    out.mid = mid;
    // PRECONDITION: P1 must now be strictly stale at B, and B must actually
    // have moved on. Otherwise the probe measures nothing.
    out.applicable = (P1.payload.turn | 0) >= 1 && (P1.payload.turn | 0) < (mid.lastSeenTurn | 0) && mid.units > 0;
    if (!out.applicable) {
      out.why.push('precondition not met: P1.turn=' + P1.payload.turn + ' vs B.lastSeenTurn=' + mid.lastSeenTurn + ' units=' + mid.units);
      return out;
    }

    // NOW deliver the reordered stale resync answer, last.
    const landed = await deliverOne(clients, P1);
    out.landed = landed;
    if (!landed) { out.why.push('VACUOUS — P1 reached no handler'); out.applicable = false; return out; }
    await new Promise(r => setTimeout(r, 250));
    const after = await M('B');
    out.after = after;
    out.rolledBack = (after.recvFp !== mid.recvFp) || (after.boardFp !== mid.boardFp)
      || (after.turnNumber < mid.turnNumber) || (after.units < mid.units);
    out.pageErrors = { A: clients.A.pageErrors.slice(0, 3), B: clients.B.pageErrors.slice(0, 3) };
  } catch (e) { out.why.push('threw: ' + String(e).slice(0, 300)); }
  finally { await clients.A.context.close().catch(() => {}); await clients.B.context.close().catch(() => {}); }
  return out;
}

log('\n🧪 CRITIC M2 — does a REORDERED stale _resync answer roll the receiver back?');
log('   fixed:   ' + SRC);
log('   pre-fix: ' + PREFIX_SRC + '  (", _resync: true" removed, 1 site asserted)');
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const res = { fixed: [], prefix: [] };
for (let i = 1; i <= RUNS; i++) {
  log('\n  ── run ' + i + '/' + RUNS + ' ─────────────────────────────');
  for (const [k, p] of [['fixed', '/index.html'], ['prefix', '/prefix.html']]) {
    const r = await runArm(browser, p, k);
    res[k].push(r);
    if (!r.applicable) { log('    ' + k.padEnd(7) + ' INAPPLICABLE: ' + r.why.join('; ')); continue; }
    log('    ' + k.padEnd(7) + ' P1 turn=' + r.P1.turn + ' _resync=' + r.P1.resync + ' (' + r.P1.units + ' units, tn' + r.P1.tn + ')');
    log('            B before P1: lastSeenTurn=' + r.mid.lastSeenTurn + ' tn=' + r.mid.turnNumber + ' units=' + r.mid.units + ' board=' + r.mid.boardFp.slice(0, 60));
    log('            B after  P1: lastSeenTurn=' + r.after.lastSeenTurn + ' tn=' + r.after.turnNumber + ' units=' + r.after.units + ' board=' + r.after.boardFp.slice(0, 60));
    log('            → ' + (r.rolledBack ? '🔴 ROLLED BACK (stale board adopted)' : '🟢 held its ground (stale packet dropped)'));
  }
}
await browser.close(); server.close();
const cnt = (k) => res[k].filter(r => r.applicable && r.rolledBack).length;
const app = (k) => res[k].filter(r => r.applicable).length;
log('\n══════════════════════════════════════════════════════════');
log('  fixed tree   rolled back ' + cnt('fixed') + '/' + app('fixed') + ' applicable run(s)');
log('  pre-fix tree rolled back ' + cnt('prefix') + '/' + app('prefix') + ' applicable run(s)');
const regressed = app('fixed') > 0 && cnt('fixed') === app('fixed') && app('prefix') > 0 && cnt('prefix') === 0;
log('  ' + (regressed ? '🔴 REGRESSION INTRODUCED BY THIS CHANGE' : (cnt('fixed') === 0 ? '🟢 no reorder rollback on either tree' : '⚠ inconclusive — read the rows')));
process.exit(0);
