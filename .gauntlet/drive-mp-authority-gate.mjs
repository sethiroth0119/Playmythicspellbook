/* ══════════════════════════════════════════════════════════════════════════
   🛑 DRIVE-MP-AUTHORITY-GATE — does a client that does NOT hold the turn get
   to overwrite the one that does?

   THE BUG. _onRemoteStateArrived never asked whether THIS client holds the
   turn. MatchBroadcast.myTurn was only ever DERIVED from an incoming packet,
   never used to reject one. _sendFullSnapshot answered every inbound 'resync'
   with no myTurn gate of its own, and joinMatchChannel fired three
   unconditional resync requests per join (0 / 1.5 / 4 s) — from BOTH clients.
   The out-of-order dedup is strict `<`, and every packet inside one turn
   carries the same turn number, so an EQUAL-turn snapshot from the waiting
   player sailed through it and was adopted wholesale: the active player's
   freshly-placed unit vanished and turnNumber went BACKWARDS.

   WHAT THIS FILE IS. Two real browser contexts running the real
   public/index.html, with the Supabase Realtime channel replaced by a relay
   living in this Node process, so client A's .send() reaches client B's real
   .on('broadcast') handler. The stub is lifted from
   .gauntlet/drive-mp-twoclient.mjs — read that file's header before changing
   anything here, in particular the two fidelity notes it paid for:
     · SUBSCRIBED MUST BE ASYNCHRONOUS. joinMatchChannel is written as
       `MatchBroadcast.channel = Cloud.client.channel(…).subscribe(cb)`, so a
       synchronous callback sees MatchBroadcast.channel still null and silently
       skips the presence track AND the opening resync — i.e. skips the exact
       handshake this file is about.
     · THE MATCH MUST BE STARTED THE WAY startBattleWithPrep STARTS IT,
       currentTurn included. Leaving currentTurn undefined makes
       swapBattlePerspective read `swapOwner(state.currentTurn || 'player')` and
       manufactures a completely convincing fake desync.

   ── THE FIVE ARMS, RUN IN THIS ORDER, EVERY RUN ───────────────────────────
   R  ROLLBACK — the scenario under judgement. A holds the turn and deploys a
      unit through the real placeUnit(). A's outbound packets are HELD (an
      ordinary dropped/late frame), so B is still on the older board. B — which
      does not hold the turn — emits a full snapshot at the SAME turnNumber,
      built by the shipped _serializeBattleStateForBroadcast and pushed through
      the real channel. The assertion is on the EFFECT, on A, after the packet
      has provably reached A's handler: A's unit count must not drop, A's
      turnNumber must not decrease, A's myTurn must not go false.
      ⚠ The arm deliberately puts the packet on the wire itself rather than
        calling _sendFullSnapshot, because _sendFullSnapshot now has a gate of
        its own and a silent refusal there would make this arm pass by sending
        NOTHING — a green that proves nothing. The delivery count is asserted.
   L  LEGITIMACY CONTROL — the counterweight to R. A ends its turn for real
      (onEndTurn → the real broadcast + the real mp_end_turn invoke), B adopts
      and takes the turn, B deploys a unit and broadcasts. A must ADOPT that:
      its unit count must rise and its myTurn must go false on the handoff. A
      guard that made R green by never adopting anything fails here.
   H1 RECONNECT HEAL, non-holder stuck — B (not the turn-holder) is put in the
      state a reconnected client is in: awaitingResync true, zero units. It asks
      through the shipped _mpRequestResync. Within ONE relayed packet it must be
      standing on the authority's board.
   H2 RECONNECT HEAL, HOLDER stuck — the same, but the stuck client is the one
      that HOLDS the turn, so the only peer who can answer is a non-holder. This
      is the arm that says why _sendFullSnapshot's gate is `!myTurn && !req.stuck`
      and not a plain `!myTurn`: a heal only the authority can give strands
      exactly the client that most needs it.
   W  ANTI-DEADLOCK CONTROL — the guard leans on local myTurn as one of its
      conditions, and local myTurn is exactly the flag this class of bug gets
      wrong. So A is forced into a WRONG myTurn=true (both local signals lying)
      while B genuinely holds the turn, and B's play must still be adopted and
      the turn given back. If a client that is wrong about myTurn can no longer
      be corrected, the guard is a way to get permanently stuck and is worse
      than the rollback it prevents. This is why the guard reads the PACKET's
      own currentTurn rather than trusting the local flag alone.

   Plus, every run: NO PAGE ERRORS on either client, and the join handshake's
   own outcome recorded (which of the two original boards each client ended up
   standing on).

   ── HOW TO GET A RATE, WHICH IS THE ONLY HONEST OUTPUT ────────────────────
   One green run proves nothing about a race. --runs=N repeats the whole script
   N times in fresh browser contexts and prints per-arm failure RATES.
     node .gauntlet/drive-mp-authority-gate.mjs                    1 run, verbose
     node .gauntlet/drive-mp-authority-gate.mjs --runs=20          the rate
     node .gauntlet/drive-mp-authority-gate.mjs --runs=20 --quiet
     MP_SRC=<path-to-another-index.html> node … --runs=20          the CONTROL:
         point it at a copy of the tree with the fix absent and it must go RED.
     --trace   print every relayed packet and what it did to the receiver

   ── WHAT A GREEN RUN DOES NOT PROVE ───────────────────────────────────────
   · THE RELAY IS NOT THE NETWORK. Lossless, in-order, ~0 ms, single process.
   · THE SERVER IS A TRANSCRIPTION of mp_edge_functions.sql + the Edge Function
     wrapper, by hand. Nobody in this working copy can run a migration or reach
     the live database. A green run proves the CLIENT handles a verdict; it
     never proves the server produces one.
   · --runs=N reuses ONE browser process and one Node process. Contexts are
     fresh; the browser's warm caches and this process's timers are not. A rate
     from N fresh processes would be stricter.
   · Two contexts on one machine share one clock and one CPU. That is not two
     players' timing.
   · 'unitviz' is dropped by the relay (it is the chunked sprite/art stream, it
     carries no board state, and it dominates the runtime). Nothing here tests it.
   ══════════════════════════════════════════════════════════════════════════ */
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(process.cwd(), 'public');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.txt': 'text/plain', '.webp': 'image/webp', '.glb': 'model/gltf-binary' };
const PORT   = 8960 + (process.pid % 30);
const HEADED = process.argv.includes('--headed');
const TRACE  = process.argv.includes('--trace');
const QUIET  = process.argv.includes('--quiet');
const RUNS = (() => {
  const a = process.argv.find(s => s.startsWith('--runs'));
  if (!a) return 1;
  const n = parseInt(a.split('=')[1], 10);
  return Number.isFinite(n) && n > 0 ? n : 20;
})();
/* MP_SRC points the run at a DIFFERENT copy of index.html — the lever that makes
   the CONTROL possible: run this suite against a pre-fix tree and it must go red
   on R, or the suite is not measuring the fix. */
const SRC = process.env.MP_SRC || path.join(ROOT, 'index.html');

const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p.endsWith('/')) p += 'index.html';
  const f = (p === '/index.html') ? SRC : path.join(ROOT, p);
  if ((f !== SRC && !f.startsWith(ROOT)) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end('nf'); }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
});
await new Promise(r => server.listen(PORT, '127.0.0.1', r));

const say  = (s) => { if (!QUIET) console.log(s); };
const loud = (s) => console.log(s);

/* ════════════════════════════════════════════════════════════════════════
   1 · THE SERVER MODEL — transcribed from mp_edge_functions.sql (public.
   mp_end_turn / mp_init_match) as supabase/functions/mp_end_turn/index.ts
   wraps it: expectedTurn clamped with Math.max(1, Math.floor(…)) and the
   columns renamed to the camelCase the client actually reads.
   ⚠ auth.uid() has no analogue: the caller is simply whoever called. Nothing
     here tests authorisation.
   ════════════════════════════════════════════════════════════════════════ */
function makeMatchRow(p1, p2) {
  return { id: 'match-authgate', player1_id: p1, player2_id: p2,
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
   2 · THE RELAY — pumped, not raced, and DIRECTIONAL.
   ════════════════════════════════════════════════════════════════════════
   A client's .send() only queues here; nothing reaches the peer until pump()
   runs. `hold` freezes one sender's packets in the queue — that is how arm R
   keeps B on the older board while A plays, which is what an ordinary dropped
   or late frame does in production.
   ════════════════════════════════════════════════════════════════════════ */
function makeRelay() {
  return { pending: [], seq: 0, hold: {}, vizDropped: 0, lost: 0,
    counts: { queued: {}, delivered: {} }, log: [] };
}
const OTHER = (s) => (s === 'A' ? 'B' : 'A');
function relayEnqueue(relay, from, event, payload) {
  if (event === 'unitviz') { relay.vizDropped++; return; }   // sprite chunks: no board state, dominates runtime
  relay.counts.queued[event] = (relay.counts.queued[event] || 0) + 1;
  relay.pending.push({ id: ++relay.seq, from, event, payload });
}
/* Deliver everything queued that is not held. Returns how many REAL handlers
   were reached, per sender — the number arm R asserts on, because a packet that
   never reached _onRemoteStateArrived cannot prove the handler rejected it. */
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
      const m = await target.page.evaluate(() => window.__ag.marks());
      const carried = (p.event === 'state' && p.payload && p.payload.state)
        ? ' [tn=' + p.payload.state.turnNumber + ' cur=' + p.payload.state.currentTurn + ' units=' + (p.payload.state.units || []).length + ']'
        : (p.event === 'resync' ? ' [reason=' + (p.payload && p.payload.reason) + ' stuck=' + !!(p.payload && p.payload.stuck) + ']' : '');
      loud('        #' + p.id + ' ' + p.from + '→' + OTHER(p.from) + ' ' + p.event + carried
        + '  ⇒ ' + OTHER(p.from) + ' tn=' + m.turnNumber + ' myTurn=' + m.myTurn + ' units=' + m.units + ' drops=' + m.authorityDrops);
    }
  }
  return landedBy;
}
/* Let the page's own timers run (broadcastMyState debounces 30 ms; the join
   handshake re-requests at 1500 ms and 4000 ms) and keep pumping. */
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
  window.__ag = { chans: {}, errs: [], probeN: 0 };

  window.__ag.mkChannel = (name) => {
    const hs = [];
    const ch = {
      on(type, filt, cb) { hs.push({ type, event: filt && filt.event, cb }); return ch; },
      send(msg) {
        try { window.__mpSend(JSON.stringify({ event: msg.event, payload: msg.payload })); }
        catch (e) { window.__ag.errs.push('send: ' + e); }
        return Promise.resolve('ok');
      },
      /* 🔴 ASYNCHRONOUS ON PURPOSE — see the header. A synchronous SUBSCRIBED
         makes joinMatchChannel's callback see MatchBroadcast.channel === null
         and skip both the presence track and the opening resync request, which
         is precisely the handshake under test. */
      subscribe(cb) {
        if (cb) setTimeout(() => { try { cb('SUBSCRIBED'); } catch (e) { window.__ag.errs.push('sub: ' + e); } }, 0);
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
          try { h.cb(arg); } catch (e) { window.__ag.errs.push('handler ' + event + ': ' + e); }
        }
        return n;
      },
    };
    window.__ag.chans[name] = ch;
    return ch;
  };
  window.__mpDeliver = (type, event, arg) => {
    let n = 0;
    for (const k of Object.keys(window.__ag.chans)) n += window.__ag.chans[k]._deliver(type, event, arg);
    return n;
  };

  window.__ag.setup = (o) => {
    /* Cloud.ready short-circuits initCloud() before it can build a real
       supabase client (the CDN is blocked here anyway) and stomp the stub. */
    Cloud.ready = true;
    Cloud.client = {
      channel: (n) => window.__ag.mkChannel(n),
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
    /* 🔴 MIRRORS startBattleWithPrep's multiplayer block EXACTLY — initGame,
       then currentTurn / MatchBroadcast.myTurn / App.ui.aiBusy. Omitting
       currentTurn manufactures a fake desync; see the header. Each client
       builds its OWN board from its OWN initGame, exactly as the shipped code
       does — which is why the join handshake exists at all. */
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

  window.__ag.marks = () => ({
    turnNumber:     App.state && App.state.turnNumber,
    turn:           App.state && App.state.turn,
    currentTurn:    App.state && App.state.currentTurn,
    myTurn:         !!MatchBroadcast.myTurn,
    units:          (App.state && App.state.units || []).length,
    hand:           (App.state && App.state.player && App.state.player.hand || []).length,
    gameOver:       (App.state && App.state.gameOver) || null,
    awaitingResync: !!MatchBroadcast.awaitingResync,
    authorityDrops: MatchBroadcast._authorityDrops | 0,   // 0 on a pre-fix tree — the field doesn't exist there
    unitIds:        (App.state && App.state.units || []).map(u => u.id).sort().join(','),
  });

  /* Arm R's ACTION for the turn-holder: swap a vanilla cost-0 no-onPlay unit
     into a hand slot and deploy it through the REAL placeUnit(), so the thing
     that must survive the adversarial packet is a real board mutation made by
     the real engine. Swapping (not appending) keeps the hand at its natural
     size so a later onEndTurn can't hit the HAND_LIMIT discard prompt. */
  window.__ag.playProbe = () => {
    const s = App.state;
    const hand = (s.player.hand || []).slice();
    if (!hand.length) return { err: 'empty hand' };
    window.__ag.probeN++;
    const card = { id: '_ag_probe', name: 'Gate Probe ' + window.__ag.probeN, type: 'unit',
      cost: 0, level: 1, atk: 2, def: 1, hp: 8, stats: { atk: 2, def: 1, hp: 8 },
      instanceId: 'probe_' + Profile.cloud.userId + '_' + window.__ag.probeN, onPlay: null };
    hand[0] = card;
    App.state = { ...s, player: { ...s.player, hand } };
    const ph = App.state.units.find(u => u.owner === 'player' && u.isHero);
    const tiles = getValidPlacementTiles(card, ph, App.state);
    if (!tiles || !tiles.length) return { err: 'no legal tile' };
    const before = App.state.units.length;
    placeUnit(card, tiles[0]);
    return { ok: App.state.units.length === before + 1, units: App.state.units.length, name: card.name };
  };
  window.__ag.endTurn = () => {
    const before = App.state.turnNumber;
    try { onEndTurn(); } catch (e) { return { err: String(e) }; }
    return { ok: App.state.turnNumber === before + 1, from: before, to: App.state.turnNumber,
      myTurn: !!MatchBroadcast.myTurn, discardPrompt: !!(App.ui && App.ui.discardPrompt) };
  };

  /* ── ARM R's ADVERSARIAL PACKET ────────────────────────────────────────
     The wire packet a non-holder used to be able to put on the channel: built
     by the SHIPPED _serializeBattleStateForBroadcast, shaped exactly the way
     _sendFullSnapshot shapes its payload, and sent through the REAL channel so
     it lands in the peer's REAL _onRemoteStateArrived.
     ⚠ It deliberately does NOT call _sendFullSnapshot. That function now has a
       gate of its own, and if this arm went through it a silent refusal would
       make the arm pass by sending nothing at all — a green that proves
       nothing. Arm R is about the RECEIVER's guard; the sender's gate is
       measured separately by armResyncAnswer(). */
  window.__ag.emitFullSnapshotRaw = () => {
    if (!MatchBroadcast.channel) return { err: 'no channel' };
    const snap = _serializeBattleStateForBroadcast(App.state);
    if (!snap) return { err: 'no snapshot' };
    MatchBroadcast.channel.send({ type: 'broadcast', event: 'state',
      payload: { from: MatchBroadcast.myUserId, turn: snap.turnNumber || 0, state: snap, newLog: [] } });
    return { sentTurn: snap.turnNumber || 0, sentUnits: (snap.units || []).length,
      sentCurrentTurn: snap.currentTurn, senderMyTurn: !!MatchBroadcast.myTurn };
  };
  /* The SHIPPED answer path, so the sender-side gate is exercised too: a bare
     'resync' arrives and _sendFullSnapshot decides whether to answer it. */
  window.__ag.answerResync = (req) => {
    const before = window.__ag.sentCount();
    try { _sendFullSnapshot(req); } catch (e) { return { err: String(e) }; }
    return { sent: window.__ag.sentCount() - before, myTurn: !!MatchBroadcast.myTurn };
  };
  window.__ag.sentCount = () => window.__ag._sent | 0;

  /* ── H1 / H2's STUCK CLIENT ────────────────────────────────────────────
     The state a client is in after a reconnect: it has asked for truth and has
     no board to stand on. Exactly the two conditions the receiver-side gate
     names as escape hatches, so if either is mis-wired the heal arms go red. */
  window.__ag.forceStuck = () => {
    MatchBroadcast.awaitingResync = true;
    App.state = { ...App.state, units: [] };
    try { if (App.screen === 'battle' && typeof renderBattle === 'function') renderBattle(); } catch (e) { window.__ag.errs.push('stuck-render: ' + e); }
    return { units: (App.state.units || []).length, awaitingResync: !!MatchBroadcast.awaitingResync };
  };
  window.__ag.requestResync = (reason) => {
    try { _mpRequestResync(reason || 'stuck-turn'); return 'sent'; } catch (e) { return String(e); }
  };

  /* ── ARM W's FABRICATED DESYNC ─────────────────────────────────────────
     Make this client WRONGLY believe it holds the turn — both local signals
     lying at once, which is the strongest form of the flag that goes wrong.
     Arm W then requires the real holder's packet to be adopted anyway. This is
     the anti-deadlock proof: the guard leans on local myTurn as one of its
     conditions, so it has to be shown that a client which is wrong about
     myTurn can still be corrected, or the guard is a way to get permanently
     stuck. */
  window.__ag.fakeHoldTurn = () => {
    MatchBroadcast.myTurn = true;
    App.state = { ...App.state, currentTurn: 'player', turn: 'player' };
    return { myTurn: true, currentTurn: App.state.currentTurn, units: (App.state.units || []).length };
  };
  window.__ag.errors = () => window.__ag.errs.slice(0, 6);
};

/* ════════════════════════════════════════════════════════════════════════
   4 · BOOT
   ════════════════════════════════════════════════════════════════════════ */
const UID = { A: 'uid-aaaa-1111', B: 'uid-bbbb-2222' };
const SETUP = {
  A: { userId: UID.A, oppId: UID.B, amIPlayer1: true,  myHero: 0, oppHero: 1, myTurn: true,  myName: 'Ava', oppName: 'Bex' },
  B: { userId: UID.B, oppId: UID.A, amIPlayer1: false, myHero: 1, oppHero: 0, myTurn: false, myName: 'Bex', oppName: 'Ava' },
};
async function bootClient(browser, relay, row, side) {
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
       `matches` to the publication; joinMatchChannel listens on postgres_changes).
       Modelled as relay traffic so it is subject to the same pump. */
    if (res.data && res.data.ok) {
      relayEnqueue(relay, 'A', 'matches.UPDATE', { ...row });
      relayEnqueue(relay, 'B', 'matches.UPDATE', { ...row });
    }
    return JSON.stringify(res);
  });
  await page.goto('http://127.0.0.1:' + PORT + '/index.html', { waitUntil: 'domcontentloaded', timeout: 180000 });
  await page.waitForFunction('typeof initGame === "function" && typeof joinMatchChannel === "function" && typeof swapBattlePerspective === "function" && typeof placeUnit === "function" && typeof _sendFullSnapshot === "function" && typeof _mpRequestResync === "function"',
    null, { timeout: 240000 });
  await page.evaluate(PAGE_STUB);
  /* Count outbound sends in-page so answerResync can say whether
     _sendFullSnapshot actually put anything on the wire. */
  await page.evaluate(() => {
    window.__ag._sent = 0;
    const orig = window.__mpSend;
    window.__mpSend = (json) => { window.__ag._sent++; return orig(json); };
  });
  return { side, page, context, pageErrors, uid: UID[side] };
}

/* Name the board a client is standing on. Unit ids are minted by initGame, so
   they identify which of the two ORIGINAL boards survived the handshake. */
function whoseBoard(ids, origin) {
  const inA = origin.A.split(',').filter(Boolean);
  const inB = origin.B.split(',').filter(Boolean);
  const now = String(ids || '').split(',').filter(Boolean);
  const fromA = now.filter(i => inA.includes(i)).length;
  const fromB = now.filter(i => inB.includes(i)).length;
  if (!now.length) return 'EMPTY';
  if (fromA && !fromB) return "A's original";
  if (fromB && !fromA) return "B's original";
  if (fromA && fromB) return 'MIXED(' + fromA + 'A/' + fromB + 'B)';
  return 'neither';
}

/* ════════════════════════════════════════════════════════════════════════
   5 · ONE RUN — the four arms.
   ════════════════════════════════════════════════════════════════════════ */
async function oneRun(browser, n) {
  const relay = makeRelay();
  const row = makeMatchRow(UID.A, UID.B);
  const clients = {};
  const [a, b] = await Promise.all([bootClient(browser, relay, row, 'A'), bootClient(browser, relay, row, 'B')]);
  clients.A = a; clients.B = b;
  const M = async (s) => clients[s].page.evaluate(() => window.__ag.marks());
  const res = { run: n, R: null, L: null, W: null, H1: null, H2: null, handshake: null, notes: [] };

  try {
    /* ── SETUP: both clients start a match, tightest join (both inside one
       delivery window — the corner that reproduces). ──────────────────── */
    const s0A = await clients.A.page.evaluate(o => window.__ag.setup(o), { ...SETUP.A, matchId: row.id });
    const s0B = await clients.B.page.evaluate(o => window.__ag.setup(o), { ...SETUP.B, matchId: row.id });
    const origin = { A: (await M('A')).unitIds, B: (await M('B')).unitIds };
    say('    setup   A units=' + s0A.units + ' myTurn=' + s0A.myTurn + ' cur=' + s0A.currentTurn
      + '  |  B units=' + s0B.units + ' myTurn=' + s0B.myTurn + ' cur=' + s0B.currentTurn);

    /* Run the whole join handshake: the requests at 0 / 1500 / 4000 ms and
       every answer to them. This is where the three unconditional resyncs live. */
    await settle(relay, clients, 5200);
    const h = { A: await M('A'), B: await M('B') };
    res.handshake = {
      A: whoseBoard(h.A.unitIds, origin), B: whoseBoard(h.B.unitIds, origin),
      converged: h.A.unitIds !== '' && h.B.unitIds !== '' && whoseBoard(h.A.unitIds, origin) === whoseBoard(h.B.unitIds, origin),
      AmyTurn: h.A.myTurn, BmyTurn: h.B.myTurn,
      resyncsQueued: relay.counts.queued.resync | 0, statesDelivered: relay.counts.delivered.state | 0,
    };
    say('    join    A on ' + res.handshake.A + ' (myTurn=' + h.A.myTurn + ')  |  B on ' + res.handshake.B
      + ' (myTurn=' + h.B.myTurn + ')   resync-requests=' + res.handshake.resyncsQueued
      + ' state-packets-delivered=' + res.handshake.statesDelivered);

    /* ══ ARM R — THE SCENARIO UNDER JUDGEMENT ══════════════════════════ */
    /* A holds the turn and deploys. Hold A's outbound packets so B stays on the
       older board — an ordinary dropped/late frame, which is the only reason B
       would have a stale board to push in the first place. */
    relay.hold.A = true;
    const played = await clients.A.page.evaluate(() => window.__ag.playProbe());
    await new Promise(r => setTimeout(r, 150));   // broadcastMyState debounces 30 ms
    const preR = await M('A');
    const bPre = await M('B');
    const emitted = await clients.B.page.evaluate(() => window.__ag.emitFullSnapshotRaw());
    const landed = { A: 0, B: 0 };
    for (let i = 0; i < 6; i++) {
      const l = await pump(relay, clients);
      landed.A += l.A; landed.B += l.B;
      await new Promise(r => setTimeout(r, 60));
    }
    const postR = await M('A');
    res.R = {
      played: played, aUnitsBefore: preR.units, aUnitsAfter: postR.units,
      aTurnBefore: preR.turnNumber, aTurnAfter: postR.turnNumber,
      aMyTurnBefore: preR.myTurn, aMyTurnAfter: postR.myTurn,
      bUnits: bPre.units, bHeldTurn: bPre.myTurn, emitted,
      packetsFromBDelivered: landed.B, authorityDrops: postR.authorityDrops,
      /* The three BAR conditions, verbatim. */
      failUnits:  postR.units < preR.units,
      failTurn:   postR.turnNumber < preR.turnNumber,
      failMyTurn: preR.myTurn === true && postR.myTurn === false,
      /* A vacuous arm: if B's packet never reached A's handler, this arm is not
         evidence of anything and must be treated as a failure of the run. */
      vacuous: landed.B === 0,
    };
    res.R.fail = res.R.failUnits || res.R.failTurn || res.R.failMyTurn || res.R.vacuous;
    say('    ARM R   A: units ' + preR.units + '→' + postR.units + '  tn ' + preR.turnNumber + '→' + postR.turnNumber
      + '  myTurn ' + preR.myTurn + '→' + postR.myTurn
      + '   (B sent tn=' + emitted.sentTurn + ' cur=' + emitted.sentCurrentTurn + ' units=' + emitted.sentUnits
      + ' senderMyTurn=' + emitted.senderMyTurn + ', ' + landed.B + ' packet(s) reached A, drops=' + postR.authorityDrops + ')'
      + '   ' + (res.R.fail ? '❌ FAIL' : '✅ pass'));

    /* ══ ARM L — THE LEGITIMACY CONTROL ═══════════════════════════════ */
    /* Everything flows again. A ends its turn for real; B must take the turn,
       deploy, and have that adopted by A. If the guard over-blocks, this is
       where it shows. */
    relay.hold.A = false;
    const et = await clients.A.page.evaluate(() => window.__ag.endTurn());
    await settle(relay, clients, 1400);
    const lB = await M('B');
    const aAfterHandoff = await M('A');
    const bPlayed = await clients.B.page.evaluate(() => window.__ag.playProbe());
    await settle(relay, clients, 1200);
    const lA = await M('A');
    res.L = {
      endTurn: et, bTookTurn: lB.myTurn === true, aReleasedTurn: aAfterHandoff.myTurn === false,
      aUnitsBeforeBPlay: aAfterHandoff.units, aUnitsAfterBPlay: lA.units, bPlayed,
      aAdoptedBPlay: lA.units > aAfterHandoff.units,
    };
    res.L.fail = !(res.L.bTookTurn && res.L.aReleasedTurn && res.L.aAdoptedBPlay);
    say('    ARM L   A end-turn ' + (et.ok ? 'ok' : JSON.stringify(et)) + ' → B myTurn=' + lB.myTurn
      + ', A myTurn=' + aAfterHandoff.myTurn + '; B deploys → A units ' + aAfterHandoff.units + '→' + lA.units
      + '   ' + (res.L.fail ? '❌ FAIL' : '✅ pass'));

    /* ══ ARM H1 — RECONNECT HEAL, non-holder stuck ════════════════════ */
    /* B currently holds the turn after arm L, so hand it back to A first: the
       arm is about a NON-holder being healed. */
    await clients.B.page.evaluate(() => window.__ag.endTurn());
    await settle(relay, clients, 1200);
    const preH1 = { A: await M('A'), B: await M('B') };
    const stuck1 = await clients.B.page.evaluate(() => window.__ag.forceStuck());
    await clients.B.page.evaluate(() => window.__ag.requestResync('stuck-turn'));
    /* ONE round of delivery: B's request out, A's answer back. */
    await pump(relay, clients);
    await new Promise(r => setTimeout(r, 120));
    const l1 = await pump(relay, clients);
    const postH1 = await M('B');
    res.H1 = {
      holderWasA: preH1.A.myTurn === true, stuck: stuck1,
      bUnitsAfter: postH1.units, bAwaitingAfter: postH1.awaitingResync,
      packetsToB: l1.A, healed: postH1.units > 0 && postH1.awaitingResync === false,
    };
    res.H1.fail = !res.H1.healed;
    say('    ARM H1  B stuck (awaitingResync=true, units=0) → asked → units=' + postH1.units
      + ' awaitingResync=' + postH1.awaitingResync + ' (holder was ' + (preH1.A.myTurn ? 'A' : preH1.B.myTurn ? 'B' : 'NEITHER') + ')'
      + '   ' + (res.H1.fail ? '❌ FAIL' : '✅ pass'));

    /* ══ ARM H2 — RECONNECT HEAL, the TURN-HOLDER is the stuck one ════ */
    /* The hard direction: only a NON-holder can answer. This is the arm that
       justifies `!myTurn && !req.stuck` rather than a plain `!myTurn` in
       _sendFullSnapshot. Runs last because it corrupts A. */
    await settle(relay, clients, 500);
    const preH2 = { A: await M('A'), B: await M('B') };
    const stuck2 = await clients.A.page.evaluate(() => window.__ag.forceStuck());
    await clients.A.page.evaluate(() => window.__ag.requestResync('stuck-turn'));
    await pump(relay, clients);
    await new Promise(r => setTimeout(r, 120));
    const l2 = await pump(relay, clients);
    const postH2 = await M('A');
    res.H2 = {
      aHeldTurn: preH2.A.myTurn === true, bHeldTurn: preH2.B.myTurn === true, stuck: stuck2,
      aUnitsAfter: postH2.units, aAwaitingAfter: postH2.awaitingResync,
      packetsToA: l2.B, healed: postH2.units > 0 && postH2.awaitingResync === false,
    };
    /* Only meaningful when A really was the holder and B really was not — say
       so rather than scoring a fail on an arm that never set itself up. */
    res.H2.applicable = res.H2.aHeldTurn && !res.H2.bHeldTurn;
    res.H2.fail = res.H2.applicable && !res.H2.healed;
    say('    ARM H2  A (holder=' + res.H2.aHeldTurn + ') stuck → asked its NON-holder peer → units=' + postH2.units
      + ' awaitingResync=' + postH2.awaitingResync
      + (res.H2.applicable ? '' : '  [not applicable this run: A held=' + res.H2.aHeldTurn + ' B held=' + res.H2.bHeldTurn + ']')
      + '   ' + (res.H2.fail ? '❌ FAIL' : res.H2.applicable ? '✅ pass' : '— skipped'));

    /* ══ ARM W — THE ANTI-DEADLOCK CONTROL ════════════════════════════ */
    /* Runs LAST because it deliberately corrupts A. First hand the turn to B
       for real, so B is the genuine authority; then make A WRONGLY believe it
       holds the turn — BOTH of A's local signals lying at once. The guard uses
       local myTurn as one of its conditions, and local myTurn is exactly the
       flag this class of bug gets wrong, so if a client that is wrong about it
       can no longer be corrected the guard is a way to get permanently stuck
       and is worse than the rollback it prevents. B (the REAL holder) deploys
       and broadcasts; A must adopt that and hand the turn back. */
    await clients.A.page.evaluate(() => window.__ag.endTurn());
    await settle(relay, clients, 1400);
    const preFakeW = { A: await M('A'), B: await M('B') };
    const fake = await clients.A.page.evaluate(() => window.__ag.fakeHoldTurn());
    const preW = await M('A');
    const bPlayed2 = await clients.B.page.evaluate(() => window.__ag.playProbe());
    await settle(relay, clients, 1400);
    const postW = await M('A');
    res.W = {
      faked: fake, aUnitsBefore: preW.units, aUnitsAfter: postW.units,
      aMyTurnBefore: preW.myTurn, aMyTurnAfter: postW.myTurn, bPlayed: bPlayed2,
      corrected: postW.units > preW.units && postW.myTurn === false,
      /* Only meaningful if B really is the authority and really did deploy —
         say so rather than scoring a fail on an arm that never set itself up. */
      applicable: preFakeW.B.myTurn === true && !!(bPlayed2 && bPlayed2.ok),
    };
    res.W.fail = res.W.applicable && !res.W.corrected;
    say('    ARM W   A forced to a WRONG myTurn=true → real holder B deploys → A units '
      + preW.units + '→' + postW.units + ', A myTurn ' + preW.myTurn + '→' + postW.myTurn
      + (res.W.applicable ? '' : '  [not applicable this run: B held=' + preFakeW.B.myTurn + ' bPlayed=' + JSON.stringify(bPlayed2) + ']')
      + '   ' + (res.W.fail ? '❌ FAIL' : res.W.applicable ? '✅ pass' : '— skipped'));

    const errA = await clients.A.page.evaluate(() => window.__ag.errors());
    const errB = await clients.B.page.evaluate(() => window.__ag.errors());
    res.pageErrors = { A: clients.A.pageErrors.slice(0, 3), B: clients.B.pageErrors.slice(0, 3) };
    res.inPageErrors = { A: errA, B: errB };
    if (clients.A.pageErrors.length || clients.B.pageErrors.length) {
      res.notes.push('page errors: A=' + clients.A.pageErrors.length + ' B=' + clients.B.pageErrors.length);
    }
  } catch (e) {
    res.threw = String(e).slice(0, 300);
  } finally {
    await clients.A.context.close().catch(() => {});
    await clients.B.context.close().catch(() => {});
  }
  return res;
}

/* ════════════════════════════════════════════════════════════════════════
   6 · MAIN
   ════════════════════════════════════════════════════════════════════════ */
loud('\n🛑 MP AUTHORITY GATE — two real clients, one relayed transport');
loud('   source: ' + SRC);
loud('   runs:   ' + RUNS + (RUNS === 1 ? '   (a single run is not a rate — use --runs=20)' : ''));

const browser = await chromium.launch({ headless: !HEADED, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const results = [];
const t0 = Date.now();
for (let i = 1; i <= RUNS; i++) {
  const t = Date.now();
  if (!QUIET) loud('\n  ── run ' + i + '/' + RUNS + ' ──────────────────────────────');
  const r = await oneRun(browser, i);
  results.push(r);
  const bad = r.threw || (r.R && r.R.fail) || (r.L && r.L.fail) || (r.W && r.W.fail) || (r.H1 && r.H1.fail) || (r.H2 && r.H2.fail);
  if (QUIET) loud('    run ' + String(i).padStart(2) + '/' + RUNS + '  ' + (bad ? 'RED  ' : 'green')
    + '  ' + ((Date.now() - t) / 1000).toFixed(1) + 's'
    + (r.threw ? '  threw: ' + r.threw : ''));
  else if (r.threw) loud('    ⚠ THREW: ' + r.threw);
}
await browser.close();
server.close();

/* ── THE RATES. A rate, not a boolean. ──────────────────────────────────── */
const n = results.length;
const cnt = (f) => results.filter(f).length;
const rollbackUnits  = cnt(r => r.R && r.R.failUnits);
const rollbackTurn   = cnt(r => r.R && r.R.failTurn);
const rollbackMyTurn = cnt(r => r.R && r.R.failMyTurn);
const rVacuous       = cnt(r => r.R && r.R.vacuous);
const rBad           = cnt(r => r.R && r.R.fail);
const lBad           = cnt(r => r.L && r.L.fail);
const wApp           = cnt(r => r.W && r.W.applicable);
const wBad           = cnt(r => r.W && r.W.fail);
const h1Bad          = cnt(r => r.H1 && r.H1.fail);
const h2App          = cnt(r => r.H2 && r.H2.applicable);
const h2Bad          = cnt(r => r.H2 && r.H2.fail);
const threw          = cnt(r => r.threw);
const diverged       = cnt(r => r.handshake && !r.handshake.converged);
const pageErr        = cnt(r => r.pageErrors && (r.pageErrors.A.length || r.pageErrors.B.length));
const pct = (k) => (k / n * 100).toFixed(1) + '%';

loud('\n══════════════════════════════════════════════════════════════════');
loud('  RESULTS over ' + n + ' run(s)   (' + ((Date.now() - t0) / 1000).toFixed(0) + 's)');
loud('══════════════════════════════════════════════════════════════════');
loud('  ARM R — non-holder full snapshot at an EQUAL turnNumber, against the holder');
loud('     A lost a unit ............... ' + rollbackUnits + '/' + n + '  = ' + pct(rollbackUnits));
loud('     A turnNumber went BACKWARDS . ' + rollbackTurn + '/' + n + '  = ' + pct(rollbackTurn));
loud('     A myTurn went false ......... ' + rollbackMyTurn + '/' + n + '  = ' + pct(rollbackMyTurn));
loud('     arm was VACUOUS (no packet) . ' + rVacuous + '/' + n + '  = ' + pct(rVacuous) + '   ← counts as a failure');
loud('     ARM R RED ................... ' + rBad + '/' + n + '  = ' + pct(rBad));
loud('  ARM L — legitimate handoff + the peer\'s play must still be ADOPTED');
loud('     ARM L RED ................... ' + lBad + '/' + n + '  = ' + pct(lBad) + '   ← the counterweight: a guard that never adopts fails here');
loud('  ARM H1 — non-holder stuck (awaitingResync, 0 units) healed in one packet');
loud('     ARM H1 RED .................. ' + h1Bad + '/' + n + '  = ' + pct(h1Bad));
loud('  ARM H2 — the TURN-HOLDER stuck, healed by a NON-holder peer');
loud('     applicable .................. ' + h2App + '/' + n);
loud('     ARM H2 RED .................. ' + h2Bad + '/' + n + '  = ' + pct(h2Bad));
loud('  ARM W — a client WRONGLY holding myTurn must still adopt the real holder');
loud('     applicable .................. ' + wApp + '/' + n);
loud('     ARM W RED ................... ' + wBad + '/' + n + '  = ' + pct(wBad) + '   ← the anti-deadlock control');
loud('  join handshake ended DIVERGED .. ' + diverged + '/' + n + '  = ' + pct(diverged) + '   (recorded, not gated)');
loud('  runs with page errors .......... ' + pageErr + '/' + n);
loud('  runs that THREW ................ ' + threw + '/' + n);

if (rBad || lBad || wBad || h1Bad || h2Bad || threw) {
  loud('\n  Failing runs:');
  for (const r of results) {
    const why = [];
    if (r.threw) why.push('threw: ' + r.threw);
    if (r.R && r.R.failUnits)  why.push('R: units ' + r.R.aUnitsBefore + '→' + r.R.aUnitsAfter);
    if (r.R && r.R.failTurn)   why.push('R: turnNumber ' + r.R.aTurnBefore + '→' + r.R.aTurnAfter);
    if (r.R && r.R.failMyTurn) why.push('R: myTurn true→false');
    if (r.R && r.R.vacuous)    why.push('R: VACUOUS — B\'s packet never reached A');
    if (r.L && r.L.fail)       why.push('L: bTookTurn=' + r.L.bTookTurn + ' aReleased=' + r.L.aReleasedTurn + ' aAdopted=' + r.L.aAdoptedBPlay);
    if (r.W && r.W.fail)       why.push('W: units ' + r.W.aUnitsBefore + '→' + r.W.aUnitsAfter + ' myTurn ' + r.W.aMyTurnBefore + '→' + r.W.aMyTurnAfter);
    if (r.H1 && r.H1.fail)     why.push('H1: units=' + r.H1.bUnitsAfter + ' awaiting=' + r.H1.bAwaitingAfter);
    if (r.H2 && r.H2.fail)     why.push('H2: units=' + r.H2.aUnitsAfter + ' awaiting=' + r.H2.aAwaitingAfter);
    if (why.length) loud('    run ' + r.run + ': ' + why.join(' | '));
  }
}
const red = rBad || lBad || wBad || h1Bad || h2Bad || threw;
loud('\n  ' + (red ? '❌ RED' : '✅ GREEN') + '  —  ' + (red ? 'see the rates above' : 'all arms clean across ' + n + ' run(s)') + '\n');
process.exit(red ? 1 : 0);
