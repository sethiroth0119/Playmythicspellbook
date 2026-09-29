/* ══════════════════════════════════════════════════════════════════════════
   🔁 DRIVE-MP-RESYNC-STALE — does a resync ANSWER that carries an older turn
   actually reach the stuck client on the LIVE (Supabase) transport?

   THE BUG. _onRemoteStateArrived's out-of-order dedup is

       if (!payload._resync && payload.turn && payload.turn < lastSeenTurn) return;

   and the comment above it says a resync re-push must bypass it, "it IS the
   board we asked for". The authority gate a few lines up exempts the same flag.
   But `_resync` was SET in exactly one place in the file — _onColyseusSnapshot —
   which is dead while USE_COLYSEUS_MP is false. _sendFullSnapshot, the function
   that answers every 'resync' on the live transport, did not set it. So the
   exemption never engaged in production: a stuck client asked for the board,
   the answer carried a strictly-older cached turn, the dedup dropped it in
   silence, and the requester stayed stuck — re-asking every 2 s, forever.

   The fix is one key on one payload in _sendFullSnapshot. This file is the
   evidence that it is the RIGHT key and that nothing else moved.

   WHAT THIS FILE IS. Two real browser contexts running the real
   public/index.html, with the Supabase Realtime channel replaced by a relay
   living in this Node process, so client A's .send() reaches client B's real
   .on('broadcast') handler. The stub, the server model and the relay are lifted
   from .gauntlet/drive-mp-authority-gate.mjs — read THAT file's header before
   changing anything here, in particular the two fidelity notes it paid for
   (SUBSCRIBED must be asynchronous; the match must be started the way
   startBattleWithPrep starts it, currentTurn included).

   ── THE SCENARIO, IDENTICAL FOR EVERY ARM ─────────────────────────────────
   1. A and B join and converge through the shipped handshake.
   2. Real play: A deploys and ends its turn, B adopts and ends its turn back,
      A deploys again. B's MatchBroadcast.lastSeenTurn climbs to N (≥2) purely
      from A's own real broadcasts — nothing synthetic about the high-water mark.
   3. A REGRESSES: its board is rebuilt by the shipped initGame at turnNumber 1
      and MatchBroadcast.lastSeenTurn is reset to 0, i.e. exactly the state a
      page RELOAD leaves a client in (startBattleWithPrep → initGame, then
      joinMatchChannel → `MatchBroadcast.lastSeenTurn = 0`). A regressed peer is
      the only way an answer can be OLDER than the requester's high-water mark,
      and a mid-match reload is how it happens in production.
      ⚠ MODELLED, NOT DRIVEN: the harness calls initGame directly instead of
        reloading the tab, because re-running joinMatchChannel in-page would
        register a SECOND stub channel and every packet would be delivered
        twice. The regression is the arms' PRECONDITION, not the thing under
        test; the thing under test is entirely shipped code.
   4. B goes stuck the way a reconnected / server-rejected client goes stuck:
      awaitingResync = true, zero units, and it asks through the SHIPPED
      _mpRequestResync('turn_out_of_sync') — the same call site mp_end_turn's
      not_your_turn / turn_out_of_sync recovery uses.
   5. One packet is delivered to B. The arms differ ONLY in that packet.

   Because B is awaitingResync with an empty board, BOTH of the authority gate's
   escape hatches are open, so the gate is inert and the out-of-order dedup is
   the only guard in play. That is deliberate: it isolates the guard this piece
   is about.

   ── THE ARMS ──────────────────────────────────────────────────────────────
   A1  THE FIX. The answer is produced by the SHIPPED _sendFullSnapshot — the
       real function, reached by the real 'resync' event. Its payload.turn (1)
       is strictly less than B's lastSeenTurn (N). B must ADOPT:
       MatchBroadcast.lastRecvSnapshot must become that payload's state, units
       must go above zero, awaitingResync must clear.
   A1c THE BEFORE. The identical arm run against a PRE-FIX copy of the tree
       (generated here by deleting `, _resync: true` from that one payload) —
       must be DROPPED: lastRecvSnapshot unchanged, still zero units, still
       awaitingResync. Without this arm A1 proves only that adoption is
       possible, not that the fix caused it.
   A2  THE GUARD IS STILL A GUARD. Same board, same turn numbers, same stuck
       receiver — but an ORDINARY packet, shaped exactly as broadcastMyState /
       _sendFullSnapshot shape theirs and WITHOUT _resync. It must still be
       DROPPED. Adopting both A1 and A2 would mean the guard was deleted rather
       than the exemption engaged, and that is a FAIL.
   A2L LIVENESS CONTROL for A2. The byte-identical packet with payload.turn
       raised to N (no longer stale, still no _resync) must be ADOPTED. Without
       it, A2's green could just mean the receiver was dead.
   A4  THE OTHER STUCK CLIENT. Same shipped answer as A1, but the receiver asked
       the way the stuck-turn WATCHDOG and the manual Re-sync button ask:
       through _mpRequestResync, which never sets awaitingResync. Only
       MatchBroadcast._resyncAskedAt marks the request. Must ADOPT. This arm is
       why the bypass is not gated on awaitingResync alone — three of the five
       ask sites (watchdog, manual button, delta-without-a-baseline) never set
       it, and gating on it would leave exactly those clients stuck, which is
       the bug this piece exists to fix.
   A5  THE BYPASS, ISOLATED. An authored packet carrying _resync and a stale
       turn, delivered to a receiver that HAS an outstanding ask. Must ADOPT.
   A5c THE OBSOLETE ANSWER. The byte-identical packet delivered to a receiver
       that is NOT waiting on one — it already got a board and cleared the ask.
       Must be DROPPED. A5/A5c pin the drop on ONE variable: whether the
       receiver still wants an answer. Before this round the exemption asked
       only "is this a resync answer?", so A5c adopted — and that is a board
       ROLLBACK, reproduced end-to-end from two shipped packets, no authoring at
       all, in .gauntlet/_crit-m2-reorder.mjs. Every adopt arm additionally
       asserts the ask is DISARMED by adoption, because that is the mechanism
       A5c depends on.
   A3  SCOPE. A static scan of the served source: `_resync` set true must appear
       in exactly TWO places — _onColyseusSnapshot and _sendFullSnapshot. A
       third setter means the flag has crept, and is a FAIL. Reported with the
       line numbers it found.

   A2 and A2L together pin the drop on ONE variable (payload.turn); A1 and A2
   pin the adoption on ONE variable (_resync). Neither pair changes anything
   else about the packet, the sender or the receiver.

   ── HOW TO RUN ────────────────────────────────────────────────────────────
     node .gauntlet/drive-mp-resync-stale.mjs                 1 run, verbose
     node .gauntlet/drive-mp-resync-stale.mjs --runs=10       the rate
     node .gauntlet/drive-mp-resync-stale.mjs --runs=10 --quiet
     --trace   print every relayed packet and what it did to the receiver
     --headed  watch it

   ── WHAT A GREEN RUN DOES NOT PROVE ───────────────────────────────────────
   · THE RELAY IS NOT THE NETWORK. Lossless, in-order, ~0 ms, single process.
   · THE SERVER IS A TRANSCRIPTION of mp_edge_functions.sql, by hand. Nobody in
     this working copy can run a migration or reach the live database. A green
     run proves the CLIENT handles a packet; it never proves the server or
     Supabase Realtime produces one.
   · The stuck-turn WATCHDOG (the 2 s re-ask loop at ~:196933) is not driven
     here; the arms call _mpRequestResync directly. What is proven is that its
     answer lands, not the timer that fires it.
   · Two contexts on one machine share one clock and one CPU. That is not two
     players' timing. 'unitviz' is dropped by the relay (sprite chunks, no board
     state, dominates runtime) — nothing here tests it.
   ══════════════════════════════════════════════════════════════════════════ */
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ROOT = path.resolve(process.cwd(), 'public');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.txt': 'text/plain', '.webp': 'image/webp', '.glb': 'model/gltf-binary' };
const PORT   = 8890 + (process.pid % 40);
const HEADED = process.argv.includes('--headed');
const TRACE  = process.argv.includes('--trace');
const QUIET  = process.argv.includes('--quiet');
const RUNS = (() => {
  const a = process.argv.find(s => s.startsWith('--runs'));
  if (!a) return 1;
  const n = parseInt(a.split('=')[1], 10);
  return Number.isFinite(n) && n > 0 ? n : 10;
})();
const SRC = process.env.MP_SRC || path.join(ROOT, 'index.html');

/* ════════════════════════════════════════════════════════════════════════
   0 · THE PRE-FIX TREE — built here, not checked in.
   ════════════════════════════════════════════════════════════════════════
   Arm A1c needs the WITHOUT-fix behaviour to compare against, and a control
   that has to be produced by hand is a control nobody runs. So we mint it: a
   byte-for-byte copy of the served source with `, _resync: true` deleted from
   _sendFullSnapshot's payload and NOTHING else touched. The replacement count
   is asserted — if it is not exactly 1 the control is not the control we
   think it is and the run refuses to start.
   ════════════════════════════════════════════════════════════════════════ */
const FIX_FRAGMENT = ', _resync: true }';
const srcText = fs.readFileSync(SRC, 'utf8');
const fixSites = srcText.split(FIX_FRAGMENT).length - 1;
if (fixSites !== 1) {
  console.log('\n❌ cannot build the pre-fix control: found ' + fixSites + ' occurrence(s) of "'
    + FIX_FRAGMENT + '" in ' + SRC + ', expected exactly 1.');
  process.exit(2);
}
const TMPDIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mp-resync-'));
const PREFIX_SRC = path.join(TMPDIR, 'prefix.html');
fs.writeFileSync(PREFIX_SRC, srcText.replace(FIX_FRAGMENT, ' }'));

/* Two more controls, minted the same way, for the two arms added this round.
   Without them A4 and A5c are just green lights with nothing behind them.
     round1.html    the bypass as it shipped in round 1 — UNCONDITIONAL. A5c
                    must ADOPT here, i.e. roll the board back. That is the
                    regression, shown rather than asserted.
     awaitonly.html the bypass gated on awaitingResync ALONE. A4 must be DROPPED
                    here — the watchdog and the manual Re-sync button never set
                    that flag, so gating on it strands exactly the clients this
                    piece is about. */
const WANT_EXPR = 'const _wantResyncAnswer = !!(MatchBroadcast.awaitingResync || MatchBroadcast._resyncAskedAt);';
const wantSites = srcText.split(WANT_EXPR).length - 1;
if (wantSites !== 1) {
  console.log('\n❌ cannot build the conditionality controls: found ' + wantSites
    + ' occurrence(s) of the _wantResyncAnswer declaration, expected exactly 1.');
  process.exit(2);
}
const ROUND1_SRC = path.join(TMPDIR, 'round1.html');
fs.writeFileSync(ROUND1_SRC, srcText.replace(WANT_EXPR, 'const _wantResyncAnswer = true;'));
const AWAITONLY_SRC = path.join(TMPDIR, 'awaitonly.html');
fs.writeFileSync(AWAITONLY_SRC, srcText.replace(WANT_EXPR, 'const _wantResyncAnswer = !!MatchBroadcast.awaitingResync;'));

/* ── ARM A3, the scope scan. Static, on the SERVED source. ──────────────── */
function scanResyncSetters(text) {
  const hits = [];
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    if (/_resync\s*(?::|=)\s*true/.test(lines[i])) {
      hits.push({ line: i + 1, text: lines[i].trim().slice(0, 120) });
    }
  }
  return hits;
}

const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p.endsWith('/')) p += 'index.html';
  let f;
  if (p === '/index.html') f = SRC;
  else if (p === '/prefix.html') f = PREFIX_SRC;
  else if (p === '/round1.html') f = ROUND1_SRC;
  else if (p === '/awaitonly.html') f = AWAITONLY_SRC;
  else f = path.join(ROOT, p);
  const GENERATED = [SRC, PREFIX_SRC, ROUND1_SRC, AWAITONLY_SRC];
  if ((!GENERATED.includes(f) && !f.startsWith(ROOT)) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end('nf'); }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
});
await new Promise(r => server.listen(PORT, '127.0.0.1', r));

const say  = (s) => { if (!QUIET) console.log(s); };
const loud = (s) => console.log(s);

/* ════════════════════════════════════════════════════════════════════════
   1 · THE SERVER MODEL — transcribed from mp_edge_functions.sql (public.
   mp_end_turn / mp_init_match) as supabase/functions/mp_end_turn/index.ts
   wraps it. Same transcription as drive-mp-authority-gate.mjs.
   ⚠ auth.uid() has no analogue: the caller is simply whoever called. Nothing
     here tests authorisation.
   ════════════════════════════════════════════════════════════════════════ */
function makeMatchRow(p1, p2) {
  return { id: 'match-resync', player1_id: p1, player2_id: p2,
    current_player_id: null, turn_number: 1, winner_id: null, status: 'active' };
}
function srv_mp_init_match(row, uid, args) {
  if (row.current_player_id == null) row.current_player_id = (args && args.p_opener_id) || uid;
  return { data: true, error: null };
}
function srv_mp_end_turn(row, uid, body) {
  const b = body || {};
  if (row.current_player_id == null) row.current_player_id = uid;
  if (row.current_player_id !== uid) {
    return { data: { ok: false, currentPlayerId: row.current_player_id, turnNumber: row.turn_number, winnerId: null, reason: 'not_your_turn' }, error: null };
  }
  const exp = Math.max(1, Math.floor(Number(b.expectedTurn || 0)));
  if (exp < (row.turn_number || 1)) {
    return { data: { ok: false, currentPlayerId: row.current_player_id, turnNumber: row.turn_number, winnerId: null, reason: 'turn_out_of_sync' }, error: null };
  }
  if (exp > (row.turn_number || 1)) row.turn_number = exp;
  row.current_player_id = (uid === row.player1_id) ? row.player2_id : row.player1_id;
  row.turn_number = row.turn_number + 1;
  if (b.gameoverWinner) { row.winner_id = b.gameoverWinner; row.status = 'complete'; }
  return { data: { ok: true, currentPlayerId: row.current_player_id, turnNumber: row.turn_number, winnerId: row.winner_id, reason: '' }, error: null };
}

/* ════════════════════════════════════════════════════════════════════════
   2 · THE RELAY — pumped, not raced, and DIRECTIONAL. `hold` freezes one
   sender's packets in the queue, which is what an ordinary dropped or late
   frame does in production.
   ════════════════════════════════════════════════════════════════════════ */
function makeRelay() {
  return { pending: [], seq: 0, hold: {}, block: {}, vizDropped: 0, lost: 0, blocked: 0,
    counts: { queued: {}, delivered: {} } };
}
const OTHER = (s) => (s === 'A' ? 'B' : 'A');
function relayEnqueue(relay, from, event, payload) {
  if (event === 'unitviz') { relay.vizDropped++; return; }
  /* `block` cuts one event type from one sender. Arms A2 / A2L use it on B's
     'resync': a stuck B that manages to ASK would be answered by A's shipped
     _sendFullSnapshot — which now carries _resync — and that answer, not the
     packet under test, would be what B adopted. Blocking it keeps the arm a
     measurement of exactly one authored packet. Arm A1 blocks nothing. */
  if (relay.block[from] && relay.block[from].includes(event)) { relay.blocked++; return; }
  relay.counts.queued[event] = (relay.counts.queued[event] || 0) + 1;
  relay.pending.push({ id: ++relay.seq, from, event, payload });
}
/* Deliver everything queued that is not held. Returns how many REAL handlers
   were reached, per sender — the number every arm asserts on, because a packet
   that never reached _onRemoteStateArrived cannot prove anything about it. */
async function pump(relay, clients) {
  const landedBy = { A: 0, B: 0 };
  for (;;) {
    const ix = relay.pending.findIndex(p => !relay.hold[p.from]);
    if (ix < 0) break;
    const p = relay.pending.splice(ix, 1)[0];
    const target = clients[OTHER(p.from)];
    let landed;
    if (p.event === 'matches.UPDATE') {
      landed = await target.page.evaluate(row => window.__mpDeliver('postgres_changes', 'UPDATE', { new: row }), p.payload);
    } else {
      landed = await target.page.evaluate(([e, pl]) => window.__mpDeliver('broadcast', e, { payload: pl }), [p.event, p.payload]);
    }
    /* Zero handlers reached is not a harness failure: Supabase broadcast has no
       replay, so a message sent before the peer subscribes is genuinely gone. */
    if (!landed) { relay.lost++; continue; }
    landedBy[p.from] += landed;
    relay.counts.delivered[p.event] = (relay.counts.delivered[p.event] || 0) + 1;
    if (TRACE) {
      const m = await target.page.evaluate(() => window.__rs.marks());
      const carried = (p.event === 'state' && p.payload && p.payload.state)
        ? ' [turn=' + p.payload.turn + ' tn=' + p.payload.state.turnNumber + ' units='
          + (p.payload.state.units || []).length + ' _resync=' + !!p.payload._resync + ']'
        : (p.event === 'resync' ? ' [reason=' + (p.payload && p.payload.reason) + ' stuck=' + !!(p.payload && p.payload.stuck) + ']' : '');
      loud('        #' + p.id + ' ' + p.from + '→' + OTHER(p.from) + ' ' + p.event + carried
        + '  ⇒ ' + OTHER(p.from) + ' seen=' + m.lastSeenTurn + ' units=' + m.units
        + ' awaiting=' + m.awaitingResync + ' recv=' + m.recvFp);
    }
  }
  return landedBy;
}
async function settle(relay, clients, ms) {
  const end = Date.now() + ms;
  const tot = { A: 0, B: 0 };
  while (Date.now() < end) {
    await new Promise(r => setTimeout(r, 90));
    const l = await pump(relay, clients);
    tot.A += l.A; tot.B += l.B;
  }
  return tot;
}

/* ════════════════════════════════════════════════════════════════════════
   3 · THE PAGE STUB — Cloud.client, replaced in-page.
   ════════════════════════════════════════════════════════════════════════ */
const PAGE_STUB = () => {
  window.__rs = { chans: {}, errs: [], probeN: 0, _sent: 0, wire: [] };

  window.__rs.mkChannel = (name) => {
    const hs = [];
    const ch = {
      on(type, filt, cb) { hs.push({ type, event: filt && filt.event, cb }); return ch; },
      send(msg) {
        try {
          /* Record what actually went ON THE WIRE, so an arm can REPORT whether
             the shipped sender set _resync — diagnostic only. Every assertion in
             this file is made on the RECEIVER, where the effect happens. */
          window.__rs.wire.push({ event: msg.event, turn: msg.payload && msg.payload.turn,
            resync: !!(msg.payload && msg.payload._resync) });
          if (window.__rs.wire.length > 60) window.__rs.wire.shift();
          window.__rs._sent++;
          window.__mpSend(JSON.stringify({ event: msg.event, payload: msg.payload }));
        } catch (e) { window.__rs.errs.push('send: ' + e); }
        return Promise.resolve('ok');
      },
      /* 🔴 ASYNCHRONOUS ON PURPOSE — see drive-mp-authority-gate.mjs's header.
         A synchronous SUBSCRIBED makes joinMatchChannel's callback see
         MatchBroadcast.channel === null and skip the opening resync. */
      subscribe(cb) {
        if (cb) setTimeout(() => { try { cb('SUBSCRIBED'); } catch (e) { window.__rs.errs.push('sub: ' + e); } }, 0);
        return ch;
      },
      track: () => Promise.resolve('ok'),
      untrack: () => Promise.resolve('ok'),
      unsubscribe: () => Promise.resolve('ok'),
      presenceState: () => ({}),
      _deliver(type, event, arg) {
        let n = 0;
        for (const h of hs) if (h.type === type && h.event === event) {
          n++;
          try { h.cb(arg); } catch (e) { window.__rs.errs.push('handler ' + event + ': ' + e); }
        }
        return n;
      },
    };
    window.__rs.chans[name] = ch;
    return ch;
  };
  window.__mpDeliver = (type, event, arg) => {
    let n = 0;
    for (const k of Object.keys(window.__rs.chans)) n += window.__rs.chans[k]._deliver(type, event, arg);
    return n;
  };

  window.__rs.setup = (o) => {
    Cloud.ready = true;   // short-circuit initCloud() before it can stomp the stub
    Cloud.client = {
      channel: (n) => window.__rs.mkChannel(n),
      removeChannel: () => {},
      from: () => ({ select: function () { return this; }, eq: function () { return this; },
        order: function () { return this; }, limit: function () { return this; },
        maybeSingle: function () { return this; }, single: function () { return this; },
        then: (r) => Promise.resolve({ data: [], error: null }).then(r) }),
      rpc: (fn, args) => window.__mpRpc(JSON.stringify({ fn, args })).then(s => JSON.parse(s)),
      functions: { invoke: (fn, opts) => window.__mpInvoke(JSON.stringify({ fn, body: opts && opts.body })).then(s => JSON.parse(s)) },
      auth: { getSession: () => Promise.resolve({ data: { session: null } }) },
    };
    Profile.cloud = Profile.cloud || {};
    Profile.cloud.signedIn = true;
    Profile.cloud.userId = o.userId;
    Profile.cloud.displayName = o.myName;
    Profile.cloud.autoSync = false;
    App.battlePrep = App.battlePrep || {};
    const me  = findHeroById(STARTER_HEROES[o.myHero].id);
    const foe = findHeroById(STARTER_HEROES[o.oppHero].id);
    App.battlePrep.hero = me;
    App.battlePrep.heroId = me.id;
    App.battlePrep.multiplayer = true;
    App.battlePrep.opponentName = o.oppName;
    window.__rs.heroes = { me, foe };   // kept for the regression in step 3
    /* 🔴 MIRRORS startBattleWithPrep's multiplayer block EXACTLY — initGame,
       then currentTurn / MatchBroadcast.myTurn / App.ui.aiBusy. Omitting
       currentTurn manufactures a fake desync. */
    const goesFirst = !!o.myTurn;
    App.state = initGame(me, foe, [], goesFirst, null);
    App.state.currentTurn = goesFirst ? 'player' : 'ai';
    App.screen = 'battle';
    render();
    joinMatchChannel(o.matchId, o.amIPlayer1, o.oppId);
    MatchBroadcast.myTurn = goesFirst;
    App.ui.aiBusy = !goesFirst;
    return { units: (App.state.units || []).length, channel: !!MatchBroadcast.channel,
      turnNumber: App.state.turnNumber, currentTurn: App.state.currentTurn, myTurn: MatchBroadcast.myTurn };
  };

  /* THE ASSERTION SURFACE. `recvFp` fingerprints MatchBroadcast.lastRecvSnapshot
     — the field the BAR names — as turnNumber + unit ids, so "unchanged" and
     "is the new payload" are both decidable without shipping the whole object
     across the bridge. */
  const fp = (st) => {
    if (!st) return 'NONE';
    return 'tn' + (st.turnNumber == null ? '?' : st.turnNumber)
      + '/' + (st.units || []).length + 'u:' + (st.units || []).map(u => u.id).sort().join(',');
  };
  window.__rs.marks = () => ({
    turnNumber:     App.state && App.state.turnNumber,
    currentTurn:    App.state && App.state.currentTurn,
    myTurn:         !!MatchBroadcast.myTurn,
    units:          (App.state && App.state.units || []).length,
    awaitingResync: !!MatchBroadcast.awaitingResync,
    resyncAskedAt:  MatchBroadcast._resyncAskedAt | 0,
    lastSeenTurn:   MatchBroadcast.lastSeenTurn | 0,
    recvFp:         fp(MatchBroadcast.lastRecvSnapshot),
    recvNull:       MatchBroadcast.lastRecvSnapshot == null,
    authorityDrops: MatchBroadcast._authorityDrops | 0,
    unitIds:        (App.state && App.state.units || []).map(u => u.id).sort().join(','),
  });
  window.__rs.boardFp = () => fp(App.state);

  /* A real board mutation by the real engine — a vanilla cost-0 no-onPlay unit
     swapped into a hand slot and deployed through the shipped placeUnit().
     Swapping (not appending) keeps the hand at its natural size so a later
     onEndTurn can't hit the HAND_LIMIT discard prompt. */
  window.__rs.playProbe = () => {
    const s = App.state;
    const hand = (s.player.hand || []).slice();
    if (!hand.length) return { err: 'empty hand' };
    window.__rs.probeN++;
    const card = { id: '_rs_probe', name: 'Resync Probe ' + window.__rs.probeN, type: 'unit',
      cost: 0, level: 1, atk: 2, def: 1, hp: 8, stats: { atk: 2, def: 1, hp: 8 },
      instanceId: 'probe_' + Profile.cloud.userId + '_' + window.__rs.probeN, onPlay: null };
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
    return { ok: App.state.turnNumber === before + 1, from: before, to: App.state.turnNumber,
      myTurn: !!MatchBroadcast.myTurn, discardPrompt: !!(App.ui && App.ui.discardPrompt) };
  };

  /* ── STEP 3: THE ANSWERER REGRESSES ────────────────────────────────────
     Models a mid-match page RELOAD: startBattleWithPrep rebuilds the board with
     initGame (turnNumber back to 1) and joinMatchChannel resets lastSeenTurn to
     0. We call those two effects directly rather than reloading the tab —
     re-running joinMatchChannel in-page would register a SECOND stub channel
     and every packet would then be delivered twice. myTurn is left FALSE, which
     is the harder case: the only thing that lets _sendFullSnapshot answer at
     all is the requester's `stuck` flag. */
  window.__rs.regressBoard = () => {
    const h = window.__rs.heroes;
    if (!h) return { err: 'no heroes captured' };
    App.state = initGame(h.me, h.foe, [], false, null);
    App.state.currentTurn = 'ai';
    MatchBroadcast.lastSeenTurn = 0;
    MatchBroadcast.myTurn = false;
    MatchBroadcast.awaitingResync = false;   // a reloaded client has not asked yet
    try { if (App.screen === 'battle' && typeof renderBattle === 'function') renderBattle(); } catch (e) { window.__rs.errs.push('regress-render: ' + e); }
    return { turnNumber: App.state.turnNumber, units: (App.state.units || []).length,
      unitIds: (App.state.units || []).map(u => u.id).sort().join(','), fp: window.__rs.boardFp() };
  };

  /* ── STEP 4: THE STUCK REQUESTER ───────────────────────────────────────
     The state a client is in after a reconnect or after mp_end_turn came back
     not_your_turn / turn_out_of_sync: it has asked for truth and has no board.
     Both of the authority gate's escape hatches are therefore open, which is
     what leaves the out-of-order dedup as the only guard in play. */
  /* `awaiting:false` is the OTHER stuck client, and it is not a hypothetical:
     only two of the five resync ask sites set awaitingResync (the reconnect and
     mp_end_turn's not_your_turn recovery). The stuck-turn watchdog, the manual
     Re-sync button and the delta-without-a-baseline path all ask WITHOUT it, so
     for them the only thing that says "we are waiting on an answer" is
     _resyncAskedAt. Zeroed here so arms A5/A5c start from a receiver that
     provably is not waiting, rather than from whatever the join handshake left
     behind. */
  window.__rs.forceStuck = (opt) => {
    const awaiting = !opt || opt.awaiting !== false;
    MatchBroadcast.awaitingResync = awaiting;
    if (!awaiting) MatchBroadcast._resyncAskedAt = 0;
    App.state = { ...App.state, units: [] };
    try { if (App.screen === 'battle' && typeof renderBattle === 'function') renderBattle(); } catch (e) { window.__rs.errs.push('stuck-render: ' + e); }
    return { units: (App.state.units || []).length, awaitingResync: !!MatchBroadcast.awaitingResync,
      resyncAskedAt: MatchBroadcast._resyncAskedAt | 0,
      lastSeenTurn: MatchBroadcast.lastSeenTurn | 0, recvFp: window.__rs.marks().recvFp };
  };
  window.__rs.requestResync = (reason) => {
    const before = window.__rs._sent;
    try { _mpRequestResync(reason || 'turn_out_of_sync'); } catch (e) { return { err: String(e) }; }
    return { sent: window.__rs._sent - before };
  };

  /* ── STEP 5, ARM A1: nothing is authored. B's shipped _mpRequestResync puts a
     'resync' on the wire, the relay hands it to A's shipped
     .on('broadcast', {event:'resync'}) handler, and THAT calls the shipped
     _sendFullSnapshot. This only reads back what the shipped sender emitted, as
     a diagnostic — the assertion is made on B. */
  /* Every early-return condition in _sendFullSnapshot, read back verbatim, so a
     silent refusal names itself instead of showing up as a mystery. */
  window.__rs.senderGate = () => ({
    channel: !!MatchBroadcast.channel,
    awaitingResync: !!MatchBroadcast.awaitingResync,
    units: (App.state && App.state.units || []).length,
    myTurn: !!MatchBroadcast.myTurn,
    turnNumber: App.state && App.state.turnNumber,
  });
  window.__rs.wireTail = (event) => {
    const w = window.__rs.wire.filter(x => !event || x.event === event);
    return { count: w.length, last: w.length ? w[w.length - 1] : null };
  };

  /* ── STEP 5, ARMS A2 / A2L: the SAME snapshot, put on the wire by hand with
     NO _resync, and with payload.turn set explicitly. Shaped exactly as
     _sendFullSnapshot and broadcastMyState shape theirs. `turn` is the single
     variable between A2 (stale) and A2L (fresh); `_resync` is the single
     variable between A2 and A1. Nothing else differs. */
  window.__rs.emitPlain = (turn) => {
    if (!MatchBroadcast.channel) return { err: 'no channel' };
    const snap = _serializeBattleStateForBroadcast(App.state);
    if (!snap) return { err: 'no snapshot' };
    MatchBroadcast.channel.send({ type: 'broadcast', event: 'state',
      payload: { from: MatchBroadcast.myUserId, turn: turn, state: snap, newLog: [] } });
    return { sentTurn: turn, sentBoardTurn: snap.turnNumber, sentUnits: (snap.units || []).length,
      resyncFlag: false };
  };

  /* ── STEP 5, ARMS A5 / A5c: the same packet _sendFullSnapshot now emits —
     `_resync: true` included — authored here so the RECEIVER's outstanding-ask
     state is the only variable between the two arms. A5's receiver asked; A5c's
     did not, because it already got a board and cleared the ask. A5c is the
     obsolete answer: the packet is a genuine answer to a question that has since
     been answered, and adopting it is the rollback .gauntlet/_crit-m2-reorder.mjs
     reproduces end-to-end with two shipped packets and no authoring at all. */
  window.__rs.emitResyncAnswer = (turn) => {
    if (!MatchBroadcast.channel) return { err: 'no channel' };
    const snap = _serializeBattleStateForBroadcast(App.state);
    if (!snap) return { err: 'no snapshot' };
    MatchBroadcast.channel.send({ type: 'broadcast', event: 'state',
      payload: { from: MatchBroadcast.myUserId, turn: turn, state: snap, newLog: [], _resync: true } });
    return { sentTurn: turn, sentBoardTurn: snap.turnNumber, sentUnits: (snap.units || []).length,
      resyncFlag: true };
  };
  window.__rs.errors = () => window.__rs.errs.slice(0, 6);
};

/* ════════════════════════════════════════════════════════════════════════
   4 · BOOT
   ════════════════════════════════════════════════════════════════════════ */
const UID = { A: 'uid-aaaa-1111', B: 'uid-bbbb-2222' };
const SETUP = {
  A: { userId: UID.A, oppId: UID.B, amIPlayer1: true,  myHero: 0, oppHero: 1, myTurn: true,  myName: 'Ava', oppName: 'Bex' },
  B: { userId: UID.B, oppId: UID.A, amIPlayer1: false, myHero: 1, oppHero: 0, myTurn: false, myName: 'Bex', oppName: 'Ava' },
};
async function bootClient(browser, relay, row, side, srcPath) {
  const context = await browser.newContext({ viewport: { width: 1100, height: 760 } });
  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', e => pageErrors.push(String(e).slice(0, 180)));
  /* Everything off-box is refused. If a socket to the real service were ever
     opened this would break the run instead of quietly making it a one-client
     test again. */
  await page.route('**/*', r => {
    const u = r.request().url();
    return (u.includes('127.0.0.1') || u.includes('localhost')) ? r.continue() : r.abort();
  });
  await page.exposeFunction('__mpSend', (json) => {
    const m = JSON.parse(json);
    relayEnqueue(relay, side, m.event, m.payload);
  });
  await page.exposeFunction('__mpRpc', (json) => {
    const m = JSON.parse(json);
    if (m.fn === 'mp_init_match') return JSON.stringify(srv_mp_init_match(row, UID[side], m.args));
    return JSON.stringify({ data: null, error: null });
  });
  await page.exposeFunction('__mpInvoke', (json) => {
    const m = JSON.parse(json);
    if (m.fn !== 'mp_end_turn') return JSON.stringify({ data: null, error: null });
    const res = srv_mp_end_turn(row, UID[side], m.body);
    /* Realtime echoes the row UPDATE to both clients (mp_edge_functions.sql adds
       `matches` to the publication; joinMatchChannel listens on postgres_changes). */
    if (res.data && res.data.ok) {
      relayEnqueue(relay, 'A', 'matches.UPDATE', { ...row });
      relayEnqueue(relay, 'B', 'matches.UPDATE', { ...row });
    }
    return JSON.stringify(res);
  });
  await page.goto('http://127.0.0.1:' + PORT + srcPath, { waitUntil: 'domcontentloaded', timeout: 180000 });
  await page.waitForFunction('typeof initGame === "function" && typeof joinMatchChannel === "function" && typeof placeUnit === "function" && typeof _sendFullSnapshot === "function" && typeof _mpRequestResync === "function" && typeof _serializeBattleStateForBroadcast === "function"',
    null, { timeout: 240000 });
  await page.evaluate(PAGE_STUB);
  return { side, page, context, pageErrors, uid: UID[side] };
}

/* ════════════════════════════════════════════════════════════════════════
   5 · ONE ARM — identical scenario, one differing packet.
   ════════════════════════════════════════════════════════════════════════
   mode: 'shipped'           → the answer comes from the real _sendFullSnapshot,
                               receiver stuck WITH awaitingResync
         'shippedNoAwait'    → the same shipped answer, but the receiver asked
                               the way the stuck-turn watchdog and the manual
                               Re-sync button ask: awaitingResync stays FALSE and
                               only _resyncAskedAt marks the outstanding request
         'resyncStaleAsked'  → an authored packet carrying _resync, receiver IS
                               waiting on an answer
         'resyncStaleNoAsk'  → the same authored packet, receiver is NOT waiting
                               (the obsolete answer)
         'plain'             → an ordinary packet, stale turn, no _resync
         'plainFresh'        → an ordinary packet, NON-stale turn, no _resync
   expect: 'adopt' | 'drop'
   ════════════════════════════════════════════════════════════════════════ */
const SHIPPED_MODES  = ['shipped', 'shippedNoAwait'];
const RESYNC_MODES   = ['resyncStaleAsked', 'resyncStaleNoAsk'];
/* Receivers that must NOT have awaitingResync set — the three ask sites that
   never set it, plus the obsolete-answer receiver that has already cleared it. */
const NO_AWAIT_MODES = ['shippedNoAwait', 'resyncStaleAsked', 'resyncStaleNoAsk'];
async function runArm(browser, srcPath, mode, expect, label) {
  const relay = makeRelay();
  const row = makeMatchRow(UID.A, UID.B);
  const clients = {};
  const [a, b] = await Promise.all([
    bootClient(browser, relay, row, 'A', srcPath),
    bootClient(browser, relay, row, 'B', srcPath),
  ]);
  clients.A = a; clients.B = b;
  const M = async (s) => clients[s].page.evaluate(() => window.__rs.marks());
  const out = { label, mode, expect, src: srcPath, applicable: false, fail: true, why: [] };

  try {
    /* ── 1 · join and converge ─────────────────────────────────────────── */
    await clients.A.page.evaluate(o => window.__rs.setup(o), { ...SETUP.A, matchId: row.id });
    await clients.B.page.evaluate(o => window.__rs.setup(o), { ...SETUP.B, matchId: row.id });
    await settle(relay, clients, 5200);   // the 0 / 1500 / 4000 ms handshake

    /* ── 2 · real play, so B's lastSeenTurn climbs from A's real packets ── */
    await clients.A.page.evaluate(() => window.__rs.playProbe());
    await settle(relay, clients, 600);
    await clients.A.page.evaluate(() => window.__rs.endTurn());
    await settle(relay, clients, 1400);
    await clients.B.page.evaluate(() => window.__rs.endTurn());
    await settle(relay, clients, 1400);
    await clients.A.page.evaluate(() => window.__rs.playProbe());
    await settle(relay, clients, 1000);

    const preplay = { A: await M('A'), B: await M('B') };
    out.bLastSeenTurn = preplay.B.lastSeenTurn;
    out.aTurnNumber = preplay.A.turnNumber;

    /* ── 3 · the answerer regresses (models a mid-match reload) ─────────── */
    relay.hold.A = true; relay.hold.B = true;      // freeze the wire while we set up
    /* From here on, arms A2 / A2L must be a measurement of ONE authored packet.
       A stuck B that manages to ASK would be answered by A's shipped
       _sendFullSnapshot — which now carries _resync — and THAT answer, not the
       packet under test, is what B would adopt. See relayEnqueue. Arm A1 blocks
       nothing: asking is the whole point of it. */
    if (!SHIPPED_MODES.includes(mode)) relay.block.B = ['resync'];
    const regressed = await clients.A.page.evaluate(() => window.__rs.regressBoard());
    out.regressed = regressed;

    /* ── 4 · the requester goes stuck and asks through the SHIPPED path ── */
    const stuck = await clients.B.page.evaluate(
      o => window.__rs.forceStuck(o), { awaiting: !NO_AWAIT_MODES.includes(mode) });
    out.stuck = stuck;
    /* A5 asks the way the watchdog and the manual button ask — awaitingResync
       stays false, only _resyncAskedAt is stamped. Its 'resync' is blocked at
       the relay, so the packet B eventually sees is the authored one and not
       A's shipped answer to this ask. */
    if (mode === 'resyncStaleAsked') {
      const askedQuietly = await clients.B.page.evaluate(() => window.__rs.requestResync('stuck-turn'));
      out.askedQuietly = askedQuietly;
    }
    out.wantedAnswer = (await M('B')).resyncAskedAt > 0 || (await M('B')).awaitingResync;
    /* THE PRECONDITION THE WHOLE FILE RESTS ON: the answer that is about to be
       produced carries a turn STRICTLY LESS than the requester's high-water
       mark. If that is not true the arm proves nothing and is reported as
       inapplicable rather than quietly scored green. */
    out.applicable = (regressed.turnNumber | 0) >= 1
                  && (regressed.turnNumber | 0) < (stuck.lastSeenTurn | 0)
                  && stuck.units === 0;
    out.staleBy = (stuck.lastSeenTurn | 0) - (regressed.turnNumber | 0);
    if (!out.applicable) {
      out.why.push('precondition not met: answer turn=' + regressed.turnNumber
        + ' vs requester lastSeenTurn=' + stuck.lastSeenTurn + ' units=' + stuck.units);
      return out;
    }

    const before = await M('B');
    out.before = { recvFp: before.recvFp, units: before.units, awaiting: before.awaitingResync,
      asked: (before.resyncAskedAt | 0) > 0, lastSeenTurn: before.lastSeenTurn };

    /* ── 5 · ONE packet, the only thing that differs between arms ───────── */
    relay.hold.A = false; relay.hold.B = false;
    let sent;
    /* Packets from A that the relay delivered. In 'shipped' mode A's answer is
       enqueued from INSIDE the pump that delivers B's request, so that same pump
       can drain it — counting only the later pumps made the arm look VACUOUS
       when the answer had in fact already landed. */
    let landed = 0;
    if (SHIPPED_MODES.includes(mode)) {
      /* B asks with the shipped _mpRequestResync; the relay delivers that to A's
         shipped 'resync' handler, which calls the shipped _sendFullSnapshot.
         Nothing about the answer packet is authored by this harness. */
      const wireBefore = await clients.A.page.evaluate(() => window.__rs.wireTail('state'));
      const asked = await clients.B.page.evaluate(() => window.__rs.requestResync('turn_out_of_sync'));
      if (!asked || !asked.sent) { out.why.push('requester put no resync on the wire: ' + JSON.stringify(asked)); return out; }
      const askLanded = await pump(relay, clients);     // request lands on A → A answers
      landed += askLanded.A;
      out.resyncReachedA = askLanded.B;
      const tail = await clients.A.page.evaluate(() => window.__rs.wireTail('state'));
      sent = tail.last;
      out.sent = sent;
      /* The answer must be a NEW packet, not an older broadcast still sitting in
         the wire log — otherwise a silent refusal inside _sendFullSnapshot would
         be read as an answer. */
      if (tail.count <= wireBefore.count) {
        out.why.push('A did not answer: resync packets that reached A=' + askLanded.B
          + ', A state-sends ' + wireBefore.count + '→' + tail.count
          + ', A gate=' + JSON.stringify(await clients.A.page.evaluate(() => window.__rs.senderGate())));
        return out;
      }
      out.wireCarriedResync = !!sent.resync;
      out.wireTurn = sent.turn;
    } else if (RESYNC_MODES.includes(mode)) {
      const t = (regressed.turnNumber | 0);
      sent = await clients.A.page.evaluate(tt => window.__rs.emitResyncAnswer(tt), t);
      out.sent = sent;
      if (!sent || sent.err) { out.why.push('emit failed: ' + JSON.stringify(sent)); return out; }
      out.wireCarriedResync = true;
      out.wireTurn = t;
    } else {
      const t = (mode === 'plainFresh') ? before.lastSeenTurn : (regressed.turnNumber | 0);
      sent = await clients.A.page.evaluate(tt => window.__rs.emitPlain(tt), t);
      out.sent = sent;
      if (!sent || sent.err) { out.why.push('emit failed: ' + JSON.stringify(sent)); return out; }
      out.wireCarriedResync = false;
      out.wireTurn = t;
    }

    /* The staleness this whole file is about, asserted on the packet that is
       actually going to be delivered rather than on the setup we intended.
       A2L is the one arm where the packet is deliberately NOT stale. */
    const wantStale = (mode !== 'plainFresh');
    const isStale = (out.wireTurn | 0) >= 1 && (out.wireTurn | 0) < (before.lastSeenTurn | 0);
    if (isStale !== wantStale) {
      out.applicable = false;
      out.why.push('packet staleness is not what the arm needs: turn=' + out.wireTurn
        + ' vs receiver lastSeenTurn=' + before.lastSeenTurn + ' (wanted stale=' + wantStale + ')');
      return out;
    }

    for (let i = 0; i < 5; i++) {
      const l = await pump(relay, clients);
      landed += l.A;
      await new Promise(r => setTimeout(r, 70));
    }
    out.packetsFromADelivered = landed;
    /* A packet that never reached B's handler cannot prove B accepted or
       rejected it. Vacuous ⇒ failure, in both directions. */
    if (!landed) { out.why.push('VACUOUS — no packet from A reached B\'s handler'); return out; }

    const after = await M('B');
    out.after = { recvFp: after.recvFp, units: after.units, awaiting: after.awaitingResync,
      asked: (after.resyncAskedAt | 0) > 0, lastSeenTurn: after.lastSeenTurn };

    /* ── THE ASSERTIONS, on the RECEIVER, where the effect happens ─────── */
    const adopted = after.recvFp !== before.recvFp && after.recvFp === regressed.fp;
    const unstuck = after.units > 0 && after.awaitingResync === false;
    out.adopted = adopted; out.unstuck = unstuck;
    if (expect === 'adopt') {
      if (!adopted) out.why.push('lastRecvSnapshot did NOT become the answer (' + before.recvFp + ' → ' + after.recvFp + ')');
      if (!unstuck) out.why.push('board did NOT un-stick (units=' + after.units + ' awaitingResync=' + after.awaitingResync + ')');
      /* Adopting a board must DISARM the outstanding ask — that is the whole
         mechanism that keeps a later, obsolete answer (A5c) from rolling this
         board back. If it survives adoption the bypass is effectively
         unconditional again and A5c is passing by luck. */
      if (out.before.asked && out.after.asked) out.why.push('outstanding ask survived adoption — the bypass never disarms');
      out.fail = !(adopted && unstuck) || (out.before.asked && out.after.asked);
    } else {
      if (adopted) out.why.push('lastRecvSnapshot CHANGED to the stale packet — the guard is gone');
      if (after.units > 0) out.why.push('receiver adopted a board it should have dropped (units=' + after.units + ')');
      out.fail = adopted || after.units > 0;
    }

    out.pageErrors = { A: clients.A.pageErrors.slice(0, 3), B: clients.B.pageErrors.slice(0, 3) };
    out.inPageErrors = { A: await clients.A.page.evaluate(() => window.__rs.errors()),
                         B: await clients.B.page.evaluate(() => window.__rs.errors()) };
  } catch (e) {
    out.threw = String(e).slice(0, 300);
    out.why.push('threw: ' + out.threw);
  } finally {
    await clients.A.context.close().catch(() => {});
    await clients.B.context.close().catch(() => {});
  }
  return out;
}

function reportArm(r) {
  const head = '    ' + r.label.padEnd(46);
  if (!r.applicable || !r.before || !r.after) {
    say(head + '— INCOMPLETE (counts RED): ' + (r.why.join('; ') || 'unknown'));
    return;
  }
  /* Staleness OF THE DELIVERED PACKET, not of the setup — A2L's packet is
     deliberately not stale, and saying otherwise would misreport the one
     variable that arm changes. */
  const behind = (r.before.lastSeenTurn | 0) - (r.wireTurn | 0);
  say(head + (behind > 0 ? 'stale by ' + behind + ' turn(s)' : 'NOT stale')
    + ' (packet turn=' + r.wireTurn + ' vs receiver lastSeenTurn=' + r.before.lastSeenTurn
    + ', _resync on wire=' + r.wireCarriedResync + ')');
  say('      '.padEnd(6) + '  recvFp ' + r.before.recvFp.slice(0, 46) + ' → ' + r.after.recvFp.slice(0, 46));
  say('      '.padEnd(6) + '  units ' + r.before.units + '→' + r.after.units
    + '  awaitingResync ' + r.before.awaiting + '→' + r.after.awaiting
    + '  outstandingAsk ' + (r.before.asked ? 'yes' : 'no') + '→' + (r.after.asked ? 'yes' : 'no')
    + '  (' + r.packetsFromADelivered + ' packet(s) reached B)'
    + '   expected ' + r.expect.toUpperCase() + '  ' + (r.fail ? '❌ FAIL' : '✅ pass'));
  if (r.fail && r.why.length) say('      '.padEnd(6) + '  ' + r.why.join(' | '));
}

/* ════════════════════════════════════════════════════════════════════════
   6 · MAIN
   ════════════════════════════════════════════════════════════════════════ */
loud('\n🔁 MP RESYNC STALE-BYPASS — two real clients, one relayed transport');
loud('   source:  ' + SRC);
loud('   pre-fix: ' + PREFIX_SRC + '   (generated: "' + FIX_FRAGMENT + '" removed, 1 site)');
loud('   round1:  ' + ROUND1_SRC + '   (generated: bypass made unconditional)');
loud('   awaitOnly: ' + AWAITONLY_SRC + '   (generated: bypass gated on awaitingResync alone)');
loud('   runs:    ' + RUNS + (RUNS === 1 ? '   (a single run is not a rate — use --runs=10)' : ''));

/* ── ARM A3 — SCOPE. Static, cheap, and it runs even if the browser dies. ── */
const setters = scanResyncSetters(srcText);
const a3fail = setters.length !== 2;
loud('\n  ARM A3 — scope: `_resync` set true must appear in exactly TWO places');
for (const s of setters) loud('     :' + s.line + '  ' + s.text);
loud('     ' + setters.length + ' setter(s)  ' + (a3fail ? '❌ FAIL — the flag has crept' : '✅ pass'));

const browser = await chromium.launch({ headless: !HEADED, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const runs = [];
const t0 = Date.now();
for (let i = 1; i <= RUNS; i++) {
  if (!QUIET) loud('\n  ── run ' + i + '/' + RUNS + ' ──────────────────────────────');
  const r = {};
  r.A1  = await runArm(browser, '/index.html',  'shipped',    'adopt', 'A1  shipped resync answer, stale turn');
  if (!QUIET) reportArm(r.A1);
  r.A1c = await runArm(browser, '/prefix.html', 'shipped',    'drop',  'A1c THE BEFORE — same, pre-fix tree');
  if (!QUIET) reportArm(r.A1c);
  r.A2  = await runArm(browser, '/index.html',  'plain',      'drop',  'A2  ORDINARY packet, stale turn');
  if (!QUIET) reportArm(r.A2);
  r.A2L = await runArm(browser, '/index.html',  'plainFresh', 'adopt', 'A2L liveness — ordinary, NON-stale turn');
  if (!QUIET) reportArm(r.A2L);
  r.A4  = await runArm(browser, '/index.html',  'shippedNoAwait',   'adopt', 'A4  watchdog/button ask (no awaitingResync)');
  if (!QUIET) reportArm(r.A4);
  r.A5  = await runArm(browser, '/index.html',  'resyncStaleAsked', 'adopt', 'A5  _resync packet, receiver IS waiting');
  if (!QUIET) reportArm(r.A5);
  r.A5c = await runArm(browser, '/index.html',  'resyncStaleNoAsk', 'drop',  'A5c OBSOLETE — same packet, not waiting');
  if (!QUIET) reportArm(r.A5c);
  r.A4c = await runArm(browser, '/awaitonly.html', 'shippedNoAwait',   'drop',  'A4c CONTROL — A4 on an awaitingResync-only tree');
  if (!QUIET) reportArm(r.A4c);
  r.A5r = await runArm(browser, '/round1.html',    'resyncStaleNoAsk', 'adopt', 'A5r CONTROL — A5c on the round-1 tree');
  if (!QUIET) reportArm(r.A5r);
  runs.push(r);
  if (QUIET) {
    const bad = ['A1', 'A1c', 'A2', 'A2L', 'A4', 'A4c', 'A5', 'A5c', 'A5r'].filter(k => r[k].fail || !r[k].applicable);
    loud('    run ' + String(i).padStart(2) + '/' + RUNS + '  ' + (bad.length ? 'RED  ' + bad.join(',') : 'green'));
  }
}
await browser.close();
server.close();

const n = runs.length;
const bad = (k) => runs.filter(r => r[k].fail || !r[k].applicable).length;
const inapp = (k) => runs.filter(r => !r[k].applicable).length;
const pct = (x) => (x / n * 100).toFixed(1) + '%';

loud('\n══════════════════════════════════════════════════════════════════');
loud('  RESULTS over ' + n + ' run(s)   (' + ((Date.now() - t0) / 1000).toFixed(0) + 's)');
loud('══════════════════════════════════════════════════════════════════');
const rows = [
  ['A1  shipped resync answer, stale turn → must ADOPT', 'A1'],
  ['A1c same arm on the PRE-FIX tree      → must DROP ', 'A1c'],
  ['A2  ordinary packet, stale turn       → must DROP ', 'A2'],
  ['A2L ordinary packet, NON-stale turn   → must ADOPT', 'A2L'],
  ['A4  shipped answer, ask w/o awaiting  → must ADOPT', 'A4'],
  ['A5  _resync + outstanding ask         → must ADOPT', 'A5'],
  ['A5c _resync, OBSOLETE (no ask)        → must DROP ', 'A5c'],
  ['A4c A4 on an awaitingResync-only tree → must DROP ', 'A4c'],
  ['A5r A5c on the round-1 tree           → must ADOPT', 'A5r'],
];
for (const [name, k] of rows) {
  loud('  ' + name + '  RED ' + bad(k) + '/' + n + ' = ' + pct(bad(k))
    + (inapp(k) ? '   (' + inapp(k) + ' inapplicable — counted RED)' : ''));
}
loud('  ARM A3 scope (' + setters.length + ' setters) ................... ' + (a3fail ? '❌ FAIL' : '✅ pass'));

const anyFail = a3fail || rows.some(([, k]) => bad(k) > 0);
if (anyFail) {
  loud('\n  Failing arms:');
  for (let i = 0; i < runs.length; i++) {
    for (const [, k] of rows) {
      const r = runs[i][k];
      if (r.fail || !r.applicable) loud('    run ' + (i + 1) + ' ' + k + ': ' + (r.why.join(' | ') || 'unknown'));
    }
  }
}
loud('\n  ' + (anyFail ? '❌ RED' : '✅ GREEN')
  + '  —  ' + (anyFail ? 'see above' : 'the exemption engages on the live path, the guard still guards, the flag has not crept') + '\n');
process.exit(anyFail ? 1 : 0);
