/* 🤝 PVP SYNC + CRASH BANNER — headless reproductions of four player reports,
   kept as checks. Each clause FAILS on the pre-fix index.html.

     · bug-mtzfzejp / bug-mu2wufcq — a reconnect after a refresh boots with
       App.state === null, so the first adopted packet used to hand the player
       the opponent's SLIMMED wire stubs ({instanceId, cardId, name}) as their
       hand/deck — undrawable, unplayable. _mpRehydratePrivateBlock restores
       real cards, keeping instanceIds.
     · same bugs — the turn-start-on-flip latch (_mpLastTurnStarted) survived
       startBattleWithPrep, so a handoff adopted on the dice screen (or last
       match's latch) skipped the real turn-start: no draw, energy stuck at 1.
     · bug-mtylr070 — a PvP concede / two-missed-timers forfeit called a
       MatchBroadcast.send that never existed and was then refused (and its
       gameOver CLEARED) by _mpResultIsLegitimate, so the match could not end.
     · bug-mtyl7vad — "Last session ended in a crash" on every launch: a mobile
       session ends by backgrounding, which never fires pagehide/beforeunload.

   Run: node _pvpsync_smoke.mjs */
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { loadEngine, EXPORTS } from './tools/gamedev/headless.mjs';

let fails = 0;
const ok = (c, m, x) => { console.log((c ? '  PASS ' : '  FAIL ') + m + (c || x === undefined ? '' : '  ← ' + x)); if (!c) fails++; };

EXPORTS.push('MatchBroadcast', 'initGame', '_onRemoteStateArrived', '_serializeBattleStateForBroadcast',
  'startBattleWithPrep', 'submitMatchResult', '_forfeitByTurnTimeout');
const eng = loadEngine();
const App = eng.App, MB = eng.MatchBroadcast, H = eng.STARTER_HEROES;
const reset = () => {
  for (const k of ['_mpLastTurnStarted', '_resyncAskedAt', 'awaitingResync', 'gameOverResolved', '_matchEndSubmitted']) MB[k] = undefined;
  MB.lastSeenTurn = 0; MB.myTurn = false; App.ui = {}; App.state = null;
};

// ── 1. reconnect adopt must not leave wire stubs in my hand ─────────────────
{
  reset();
  const opp = eng.initGame(H[0], H[1], [], true, null);
  opp.ai.hand = [...eng.UNIT_CARDS.slice(0, 3), ...eng.SPELL_CARDS.slice(0, 2)].map((c, i) => ({ ...c, instanceId: 'mine_' + i }));
  opp.ai.deck = eng.UNIT_CARDS.slice(3, 8).map((c, i) => ({ ...c, instanceId: 'mdeck_' + i }));
  const wire = eng._serializeBattleStateForBroadcast(opp);
  ok(wire.ai.hand[0] && !wire.ai.hand[0].type, 'the wire really does carry stubs (precondition)');
  App.battlePrep = { multiplayer: true };
  MB.myUserId = 'me'; MB.opponentId = 'opp'; MB.awaitingResync = true;
  eng._onRemoteStateArrived({ from: 'opp', turn: 1, state: wire });
  const p = App.state && App.state.player;
  ok(p && p.hand.length === 5 && p.hand.every(c => c && c.id && c.type), 'reconnect: every hand card is a real card', p && JSON.stringify(p.hand[0]));
  ok(p && p.deck.every(c => c && c.type), 'reconnect: every deck card is a real card');
  ok(p && p.hand[0].instanceId === 'mine_0', 'reconnect: instanceIds survive rehydration');
}

// ── 2. a pre-battle handoff must not eat my real turn-start ─────────────────
{
  reset();
  const p1 = eng.initGame(H[0], H[1], [], true, null);
  p1.turnNumber = 2; p1.currentTurn = 'ai'; p1.turn = 'ai';
  const wire = eng._serializeBattleStateForBroadcast(p1);
  MB.myUserId = 'p2'; MB.opponentId = 'p1';
  App.battlePrep = { multiplayer: true, hero: H[1], opponent: H[0] };
  App.screen = 'coinFlip';
  eng._onRemoteStateArrived({ from: 'p1', turn: 2, state: wire });
  eng.startBattleWithPrep(false);
  App.screen = 'battle';
  const h0 = App.state.player.hand.length, e0 = App.state.player.maxEnergy;
  MB._resyncAskedAt = Date.now();
  eng._onRemoteStateArrived({ from: 'p1', turn: 2, state: wire, _resync: true });
  ok(MB.myTurn === true, 'resync hands me the turn');
  ok(App.state.player.hand.length === h0 + 1, 'my turn-start drew a card', h0 + ' → ' + App.state.player.hand.length);
  ok(App.state.player.maxEnergy > e0, 'my turn-start refreshed energy', e0 + ' → ' + App.state.player.maxEnergy);
}

// ── 3. a PvP forfeit reaches the server and stays ended ─────────────────────
{
  reset();
  const calls = [];
  eng.Cloud.client = { functions: { invoke: async (name, o) => { calls.push({ name, body: o.body }); return { data: { ok: true, winnerId: o.body.winnerId, weWonRace: true }, error: null }; } } };
  App.battlePrep = { multiplayer: true };
  MB.matchId = 'm1'; MB.myUserId = 'me'; MB.opponentId = 'opp'; MB.channel = { send() {} };
  App.screen = 'battle';
  App.state = eng.initGame(H[0], H[1], [], true, null);
  eng._forfeitByTurnTimeout();
  await eng.submitMatchResult('opp', App.state);           // the post-action path runs next
  await new Promise(r => setImmediate(r));
  ok(calls.length === 1 && calls[0].body.winnerId === 'opp', 'forfeit is recorded with mp_resolve_match, opponent as winner', JSON.stringify(calls));
  ok(calls[0] && calls[0].body.endReason === 'concede', 'end_reason is concede');
  ok(App.state.gameOver === 'ai', 'the match stays ended (gameOver not cleared)', App.state.gameOver);
  ok(MB.gameOverResolved === true, 'the conceder is not held on "Confirming result…"');
  // the concession rule only ever concedes a LOSS
  const fake = { ...App.state, gameOver: 'player', concededByPlayer: true };
  MB._matchEndSubmitted = false; calls.length = 0;
  await eng.submitMatchResult('me', fake);
  ok(calls.length === 0, 'concededByPlayer cannot be used to claim a win');
  App.battlePrep = null; MB.channel = null; MB.matchId = null;
}

// ── 4. crash banner: backgrounding is a clean exit, a foreground crash is not ─
{
  const html = readFileSync('./public/index.html', 'utf8');
  const a = html.indexOf("  // A clean exit (reload/close) sets hg_clean_exit='1'.");
  const b = html.indexOf('  let _crumbT = 0;', a);
  ok(a > 0 && b > a, 'found the crash-sentinel block');
  const src = 'try {\n' + html.slice(a, b) + '} catch (e) { throw e; }';
  const boot = (store) => {
    const dl = {};
    const doc = { visibilityState: 'visible', addEventListener: (t, f) => { (dl[t] = dl[t] || []).push(f); } };
    const ctx = { localStorage: { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); } },
      window: { addEventListener() {} }, document: doc, console: { warn() {} }, JSON, shown: false };
    ctx._showCrashTrailBanner = () => { ctx.shown = true; };
    vm.runInNewContext(src, ctx);
    return { ctx, doc, fire: (t) => (dl[t] || []).forEach(f => f({})) };
  };
  const crumbs = JSON.stringify([{ t: 3, scr: 'battle' }]);
  const store = { hg_crumbs: crumbs };
  let s = boot(store);
  s.doc.visibilityState = 'hidden'; s.fire('visibilitychange');     // swiped away; OS reaps it later
  store.hg_crumbs = crumbs;
  s = boot(store);
  ok(!s.ctx.shown, 'no crash banner after a session that ended in the background');
  store.hg_crumbs = crumbs;                                          // this one dies on screen
  s = boot(store);
  ok(s.ctx.shown, 'a crash while the game is on screen still shows the banner');
}

console.log(fails ? `\n${fails} FAIL` : '\nALL PASS');
process.exit(fails ? 1 : 0);
