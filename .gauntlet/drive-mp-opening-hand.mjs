/* ══════════════════════════════════════════════════════════════════════════
   🃏 DRIVE-MP-OPENING-HAND — two real clients, started the way PRODUCTION
   starts them, and a real tab reload in the middle of the match.

   THE REPORTS (both iOS, both before v121v175):
     bug-mtzfzejp  "cards for one did not show and would not draw when you
                   touched them … I refreshed and was able to play"
     bug-mu2wufcq  "as you start the battle the cards were wrong, then during
                   play cards at bottom would not show and I could not place
                   the card.. only could move my hero … issues re-synching"

   WHY ANOTHER TWO-CLIENT FILE. Every existing MP harness (drive-mp-twoclient,
   drive-mp-authority-gate, drive-mp-resync-stale, mp-sync-audit-probe) builds
   the board with initGame FIRST and joins the channel SECOND, and models a
   reload by nulling App.state in a page that keeps its App.battlePrep. The
   shipped order is the reverse, and the gap is up to 50 s wide:
     · renderVsScreen joins the channel (resync asks at 0 / 1.5 / 4 s) while
       App.state is still null — nothing has been dealt yet;
     · each player then clicks the dice reveal INDEPENDENTLY (or waits out the
       50 s auto-start), so one client can be in battle, heart-beating its board
       every 4 s, while the other still stands on the coin screen;
     · a real reload (iOS evicts a heavy tab and reloads it) comes back through
       attemptMatchReconnect with a FRESH App.battlePrep that has no hero, no
       opponent and no opponent name.
   This file drives exactly that, then judges what the player SEES: the hand
   strip in the DOM (a card with no `type` renders as .hand-card-broken, which
   has no data-card and therefore ignores a tap), and whether a tap on a real
   card selects it at phone size.

   ARMS
     O   opening, opener clicks first, the peer 9 s later (peer on the coin
         screen receives the opener's heartbeats with App.state === null)
     H   the first hand-off: the opener must not fire a stuck-turn resync the
         moment it ends turn 1, and must keep the hand the peer thinks it has
     R1  the waiting player's tab is really reloaded mid-match
     R2  the turn-holder's tab is really reloaded mid-match, then plays a card
     M   B runs at 375×812 with touch: the hand strip is on screen and a TAP
         selects a card (checked in O, and again after R1/R2)
     N   NEGATIVE CONTROL — the oracle must go red on a hand of wire stubs:
         B's hand is replaced by {instanceId,cardId,name} stubs (what a pre-
         v175 reload adopted) and the same DOM/tap checks must FAIL.

   Usage:  node .gauntlet/drive-mp-opening-hand.mjs [candidate.html] [--gate]
           (http://localhost:8787 must be serving public/)
   --gate prints a machine line "OPENHAND pass=<n> fail=<m>" and exits 1 on
   any failure. OH_TRACE=1 prints every state/resync packet with its turn,
   currentTurn and _resync flag (that trace is how H was found: the opener's
   `stuck-turn` ask left 30 ms AHEAD of its own hand-off packet, and the peer's
   RESYNC answer came back at turn 1 with the turn still the opener's).

   MEASURED (2026-09-17): working tree 41/41 (twice); committed v175 blob 40/41
   (H red, every run); pre-v175 blob 33/41 (H + the six reload checks). Nothing here touches Supabase: Cloud.client is an in-page stub
   and the realtime channel is a relay in this Node process.
   ══════════════════════════════════════════════════════════════════════════ */
import { chromium } from 'playwright';
import fs from 'node:fs';

const CAND = process.argv.slice(2).find(a => !a.startsWith('--'));
const GATE = process.argv.includes('--gate');
const html = CAND ? fs.readFileSync(CAND, 'utf8') : null;
const BASE = 'http://localhost:8787/index.html';
const MATCH = { id: 'm-openhand-0001', status: 'active', player1_id: 'uid-aaaa', player2_id: 'uid-bbbb' };

const results = [];
const ok = (label, pass, detail) => {
  results.push({ label, pass: !!pass });
  console.log((pass ? '  ok   ' : '  FAIL ') + label + (detail == null ? '' : '   [' + detail + ']'));
};
const note = (s) => console.log('       ' + s);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/* ── relay ─────────────────────────────────────────────────────────────── */
const relay = { q: [], sent: {}, delivered: {}, lost: 0, trace: [], log: [] };
const T0 = Date.now();
const mark = (s) => { if (process.env.OH_TRACE) relay.trace.push(((Date.now() - T0) / 1000).toFixed(1) + 's ── ' + s); };
const OTHER = (t) => (t === 'A' ? 'B' : 'A');
let clients = {};
async function pump() {
  let n = 0;
  while (relay.q.length) {
    const p = relay.q.shift();
    const c = clients[OTHER(p.from)];
    if (!c || c.down) { relay.lost++; continue; }
    let landed = 0;
    try { landed = await c.page.evaluate(([e, pl]) => (window.__oh ? window.__oh.deliver(e, pl) : 0), [p.event, p.payload]); }
    catch (e) { landed = 0; }
    if (!landed) { relay.lost++; continue; }
    relay.delivered[p.event] = (relay.delivered[p.event] | 0) + 1;
    if (process.env.OH_TRACE && /state|resync/.test(p.event)) relay.trace.push(((Date.now() - T0) / 1000).toFixed(1) + 's ' + p.from + '→' + OTHER(p.from) + ' ' + p.event + (p.payload ? ' turn=' + p.payload.turn + (p.payload._resync ? ' RESYNC' : '') + (p.payload.state ? ' cur=' + p.payload.state.currentTurn + ' tn=' + p.payload.state.turnNumber : '') + (p.payload.reason ? ' reason=' + p.payload.reason + ' stuck=' + p.payload.stuck : '') : ''));
    n++;
  }
  return n;
}
async function settle(ms) { const end = Date.now() + ms; while (Date.now() < end) { await sleep(100); await pump(); } }
async function settleQuiet(minMs, quietMs, maxMs) {
  const t0 = Date.now(); let last = t0;
  while (Date.now() - t0 < maxMs) {
    await sleep(100);
    if (await pump()) last = Date.now();
    if (Date.now() - t0 >= minMs && Date.now() - last >= quietMs) break;
  }
}

/* ── in-page kit ───────────────────────────────────────────────────────── */
const KIT = (o) => {
  const oh = window.__oh = { chans: [], errs: [] };
  const mkChannel = (name) => {
    const hs = [];
    const ch = {
      on(type, filt, cb) { hs.push({ type, event: filt && filt.event, cb }); return ch; },
      send(m) { try { window.__ohSend(JSON.stringify({ event: m.event, payload: m.payload })); } catch (e) { oh.errs.push('send ' + e); } return Promise.resolve('ok'); },
      // SUBSCRIBED must be asynchronous — see drive-mp-twoclient.mjs §3.
      subscribe(cb) { if (cb) setTimeout(() => { try { cb('SUBSCRIBED'); } catch (e) {} }, 0); return ch; },
      track: () => Promise.resolve('ok'), untrack: () => Promise.resolve('ok'),
      unsubscribe: () => Promise.resolve('ok'), presenceState: () => ({}),
      _deliver(event, payload) {
        let n = 0;
        for (const h of hs) if (h.type === 'broadcast' && h.event === event) { n++; try { h.cb({ payload }); } catch (e) { oh.errs.push(event + ': ' + (e && e.message)); } }
        return n;
      },
    };
    ch._name = String(name || '');
    oh.chans.push(ch);
    return ch;
  };
  // Only the LATEST match channel is live (joinMatchChannel tears the old one down);
  // other features open their own channels (lobby, chat) and must not receive these.
  oh.deliver = (event, payload) => { const m = oh.chans.filter(c => c._name.indexOf('match:') === 0); const ch = m[m.length - 1]; return ch ? ch._deliver(event, payload) : 0; };
  const q = (table) => {
    let single = false;
    const b = {
      select() { return b; }, eq() { return b; }, order() { return b; }, limit() { return b; }, update() { return b; },
      insert() { return b; }, upsert() { return b; }, delete() { return b; }, in() { return b; }, neq() { return b; },
      maybeSingle() { single = true; return b; }, single() { single = true; return b; },
      then(res, rej) { const data = table === 'matches' ? (single ? o.match : [o.match]) : (single ? null : []); return Promise.resolve({ data, error: null }).then(res, rej); },
    };
    return b;
  };
  Cloud.ready = true;
  Cloud.client = {
    channel: (n) => mkChannel(n), removeChannel: () => {}, from: q,
    rpc: () => Promise.resolve({ data: null, error: null }),
    functions: { invoke: () => Promise.resolve({ data: null, error: null }) },
    auth: { getSession: () => Promise.resolve({ data: { session: null } }) },
  };
  Profile.cloud = Profile.cloud || {};
  Profile.cloud.signedIn = true; Profile.cloud.userId = o.uid; Profile.cloud.autoSync = false;
  Profile.cloud.displayName = o.name;

  oh.handView = () => {
    const s = App.state;
    const hand = (s && s.player && s.player.hand) || [];
    const strip = document.querySelector('.hand-strip');
    const cards = Array.from(document.querySelectorAll('.hand-strip .hand-card'));
    const live = cards.filter(el => el.hasAttribute('data-card'));
    const r = strip ? strip.getBoundingClientRect() : null;
    const first = live[0] ? live[0].getBoundingClientRect() : null;
    return {
      screen: App.screen, gameOver: (s && s.gameOver) || null, myTurn: !!MatchBroadcast.myTurn, aiBusy: !!(App.ui && App.ui.aiBusy),
      tn: s && s.turnNumber, cur: s && s.currentTurn,
      hand: hand.map(c => ({ iid: c && c.instanceId, name: c && c.name, type: (c && c.type) || null, cost: c ? c.cost : null })),
      domCards: cards.length, domLive: live.length, domBroken: document.querySelectorAll('.hand-strip .hand-card-broken').length,
      strip: r && { top: Math.round(r.top), bottom: Math.round(r.bottom), h: Math.round(r.height), vh: innerHeight, vw: innerWidth },
      firstCard: first && { x: Math.round(first.left + first.width / 2), y: Math.round(first.top + Math.min(first.height / 2, 30)), w: Math.round(first.width), h: Math.round(first.height), bottom: Math.round(first.bottom) },
      ids: ((s && s.units) || []).filter(u => u && u.alive !== false).map(u => u.id).sort().join(','),
      heroDown: ((s && s.units) || []).filter(u => u && u.isHero && (u.alive === false || (u.currentHp != null && u.currentHp <= 0))).map(u => u.owner),
      units: ((s && s.units) || []).length,
    };
  };
  // The renderer is RAF-batched; call the immediate painter where it exists.
  oh.paint = () => { try { if (typeof renderBattle === 'function' && App.screen === 'battle') renderBattle(); } catch (e) { oh.errs.push('paint ' + e.message); } };
  return true;
};

/* Stand a fresh page where the VS screen stands it: battlePrep filled by
   onMultiplayerMatchFound, App.state still null, channel joined. */
const PREP = (o) => {
  const me = findHeroById(STARTER_HEROES[o.myHero].id);
  const foe = findHeroById(STARTER_HEROES[o.oppHero].id);
  App.battlePrep = { hero: me, heroId: me.id, opponent: foe, opponentName: o.oppName,
    multiplayer: true, multiplayerMatchId: o.match.id, rankedMode: true };
  MultiplayerMatch.matchId = o.match.id; MultiplayerMatch.amIPlayer1 = o.p1; MultiplayerMatch.opponentId = o.opp;
  App.state = null;
  App.screen = 'vsScreen';
  joinMatchChannel(o.match.id, o.p1, o.opp);      // exactly what renderVsScreen does
  App.screen = 'coinFlip';                         // the dice screen: no battle yet
  return { channel: !!MatchBroadcast.channel };
};
const START = (first) => {
  App.battlePrep.playerWonFlip = !!first;
  startBattleWithPrep(!!first);
  App.screen = 'battle';
  try { renderBattle(); } catch (e) {}
  return (App.state.player.hand || []).map(c => c.instanceId);
};

const browser = await chromium.launch();
async function boot(tag, o, mobile) {
  const ctx = await browser.newContext(mobile
    ? { viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, serviceWorkers: 'block' }
    : { viewport: { width: 1280, height: 800 }, serviceWorkers: 'block' });
  /* 🔴 serviceWorkers:'block' IS LOAD-BEARING. public/sw.js caches index.html on the first
     load, and page.route() does NOT see requests a service worker answers — so the
     RELOAD in R1/R2 silently came back as the SHIPPED file, not the candidate, and a
     pre-v175 candidate passed every reload check. load() fingerprints the build to
     prove the reloaded page is the page under test. */
  const page = await ctx.newPage();
  const c = { tag, ctx, page, o, mobile, errs: [] };
  page.on('pageerror', e => c.errs.push(String(e.message || e).slice(0, 160)));
  await page.exposeFunction('__ohSend', (json) => {
    try { const m = JSON.parse(json); if (m.event === 'unitviz') return; relay.sent[m.event] = (relay.sent[m.event] | 0) + 1; relay.log.push({ at: Date.now(), from: tag, event: m.event, reason: m.payload && m.payload.reason }); relay.q.push({ from: tag, event: m.event, payload: m.payload }); } catch (e) {}
  });
  await page.route('**/*', (r) => {
    const u = r.request().url();
    if (html && /\/index\.html(\?|$)/.test(u)) return r.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html });
    return (u.includes('localhost') || u.includes('127.0.0.1')) ? r.continue() : r.abort();
  });
  await load(c);
  return c;
}
async function load(c) {
  await c.page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 180000 });
  await c.page.waitForFunction(() => typeof initGame === 'function' && typeof joinMatchChannel === 'function'
    && typeof startBattleWithPrep === 'function' && typeof attemptMatchReconnect === 'function'
    && typeof _onRemoteStateArrived === 'function' && typeof renderBattle === 'function', null, { timeout: 240000 });
  await c.page.evaluate(KIT, c.o);
  const fp = await c.page.evaluate(() => String(_onRemoteStateArrived).length + ':' + String(startBattleWithPrep).length);
  if (c.fp && c.fp !== fp) throw new Error(c.tag + ' reloaded into a DIFFERENT build (' + c.fp + ' → ' + fp + ') — a service worker answered the reload');
  c.fp = fp;
}
const view = async (c) => { await c.page.evaluate(() => window.__oh.paint()); return c.page.evaluate(() => window.__oh.handView()); };

/* Tap (touch) or click the first live hand card, report whether it selected. */
async function tapFirstCard(c) {
  // A tap while a cinematic or choice modal owns the screen is refused BY DESIGN
  // (_battleInputBlocked, with a "Hold" toast). Wait that out — but a block that
  // never clears is itself the reported bug ("would not draw when you touched
  // them"), so it is reported, not hidden.
  let blocked = true;
  for (let i = 0; i < 50 && blocked; i++) {
    blocked = await c.page.evaluate(() => { try { return !!((typeof _playerChoiceModalOpen === 'function' && _playerChoiceModalOpen()) || (typeof _anyCinematicActive === 'function' && _anyCinematicActive())); } catch (e) { return false; } });
    if (blocked) await sleep(200);
  }
  if (blocked) return { selected: false, why: 'input blocked by a cinematic/modal for 10 s' };
  const v = await view(c);
  if (!v.firstCard) return { selected: false, why: 'no live card in the DOM' };
  // A tap on a hand card opens the play/inspect flow: openCardInspect is the only
  // writer of App.ui.cardDetailId (see bindBattleEvents). Clear it, tap, read it.
  await c.page.evaluate(() => { App.ui.selectedCardId = null; App.ui.cardDetailId = null; });
  if (c.mobile) await c.page.touchscreen.tap(v.firstCard.x, v.firstCard.y);
  else await c.page.mouse.click(v.firstCard.x, v.firstCard.y);
  await sleep(250);
  const sel = await c.page.evaluate(() => { const r = { detail: App.ui.cardDetailId || null, sel: App.ui.selectedCardId || null }; App.ui.cardDetailId = null; try { renderBattle(); } catch (e) {} return r; });
  return { selected: !!(sel.detail || sel.sel), detail: sel.detail, sel: sel.sel, at: v.firstCard };
}

/* Judge one client's hand as the player sees it. */
function judgeHand(tag, v, expectIids, label) {
  ok(label + ' ' + tag + ' is on the battle screen, no game over', v.screen === 'battle' && !v.gameOver, 'screen=' + v.screen + ' gameOver=' + v.gameOver + ' heroDown=' + JSON.stringify(v.heroDown));
  ok(label + ' ' + tag + ' every hand card is a real card (type + cost)', v.hand.length > 0 && v.hand.every(h => h.type && h.cost != null),
    v.hand.filter(h => !h.type).length + '/' + v.hand.length + ' without a type');
  ok(label + ' ' + tag + ' the hand strip paints every card as a live card', v.domLive === v.hand.length && v.domBroken === 0,
    'state=' + v.hand.length + ' dom=' + v.domCards + ' live=' + v.domLive + ' broken=' + v.domBroken);
  if (expectIids) {
    const got = v.hand.map(h => h.iid);
    const kept = expectIids.filter(i => got.includes(i)).length;
    ok(label + ' ' + tag + ' holds ITS OWN dealt hand', kept === expectIids.length,
      kept + '/' + expectIids.length + ' of the dealt instanceIds; now=' + v.hand.map(h => h.name).join('|'));
  }
  if (v.strip) {
    ok(label + ' ' + tag + ' the hand strip is inside the viewport', v.strip.h > 20 && v.strip.top < v.strip.vh && v.strip.bottom <= v.strip.vh + 2,
      JSON.stringify(v.strip));
  } else ok(label + ' ' + tag + ' the hand strip is inside the viewport', false, 'no .hand-strip');
}

try {
  const oA = { uid: 'uid-aaaa', opp: 'uid-bbbb', name: 'Ava', oppName: 'Bex', myHero: 0, oppHero: 1, p1: true, match: MATCH };
  const oB = { uid: 'uid-bbbb', opp: 'uid-aaaa', name: 'Bex', oppName: 'Ava', myHero: 1, oppHero: 0, p1: false, match: MATCH };
  const [A, B] = await Promise.all([boot('A', oA, false), boot('B', oB, true)]);
  clients = { A, B };
  const ev = (c, fn, arg) => c.page.evaluate(fn, arg);

  // ── O opening: the opener clicks first, the peer 9 s later ─────────────
  console.log('\n── O opening — A (opener) starts, B still on the dice screen for 9 s');
  await ev(A, PREP, oA); await ev(B, PREP, oB);
  await settle(5000);                                     // the VS-screen resync asks, both boardless
  mark('A START'); const dealtA = await ev(A, START, true);
  await settle(9000);                                     // A heart-beats at B, who has App.state === null
  const bOnCoin = await ev(B, () => ({ screen: App.screen, adopted: !!App.state, hand: App.state && App.state.player ? App.state.player.hand.length : 0 }));
  note('B while on the dice screen: ' + JSON.stringify(bOnCoin));
  mark('B START'); const dealtB = await ev(B, START, false);
  await settleQuiet(5000, 1200, 20000);
  let vA = await view(A), vB = await view(B);
  judgeHand('A', vA, dealtA, 'O'); judgeHand('B', vB, dealtB, 'O');
  ok('O exactly one client holds the turn (A)', vA.myTurn && !vB.myTurn, 'A=' + vA.myTurn + ' B=' + vB.myTurn);
  const diag = () => ({ lastSeen: MatchBroadcast.lastSeenTurn, recv: !!MatchBroadcast.lastRecvSnapshot, sent: !!MatchBroadcast.lastSentSnapshot,
    drops: MatchBroadcast._authorityDrops | 0, awaiting: !!MatchBroadcast.awaitingResync, asked: MatchBroadcast._resyncAskedAt | 0,
    lastSnapAt: MatchBroadcast._lastSnapAt | 0, tn: App.state && App.state.turnNumber, cur: App.state && App.state.currentTurn, chans: window.__oh.chans.length, errs: window.__oh.errs.slice(0, 4) });
  note('diag A ' + JSON.stringify(await ev(A, diag)) + ' errs=' + JSON.stringify(A.errs.slice(0, 3)));
  note('diag B ' + JSON.stringify(await ev(B, diag)) + ' errs=' + JSON.stringify(B.errs.slice(0, 3)));
  note('relay sent=' + JSON.stringify(relay.sent) + ' delivered=' + JSON.stringify(relay.delivered) + ' lost=' + relay.lost);
  ok('O both clients stand on the same board', vA.ids === vB.ids, vA.ids === vB.ids ? vA.units + ' units' : 'A=' + vA.ids.slice(0, 60) + ' B=' + vB.ids.slice(0, 60));
  const tA = await tapFirstCard(A);
  ok('O A (turn-holder, desktop) click selects a hand card', tA.selected, JSON.stringify(tA));

  // hand-off to B, then B taps at phone size
  const handA0 = (await view(A)).hand.map(h => h.iid).join(',');
  const tEnd = Date.now();
  mark('A onEndTurn'); await ev(A, () => { App.ui.selectedCardId = null; onEndTurn(); });
  await settleQuiet(3000, 1200, 15000);
  vA = await view(A); vB = await view(B);
  // H — the hand-off itself. bug-mu2wufcq: the opener, having received nothing all
  // turn, fired a STUCK resync on the tick after End Turn and could adopt the peer's
  // pre-hand-off board, re-running its own turn 1 (an extra, unshared draw).
  const stuckAsks = relay.log.filter(r => r.from === 'A' && r.event === 'resync' && r.at >= tEnd).map(r => r.reason);
  ok('H the opener does not cry "stuck" right after handing the turn off', stuckAsks.length === 0, 'A resync asks since End Turn: ' + JSON.stringify(stuckAsks));
  const bModelA = await ev(B, () => (App.state.ai.hand || []).map(c => c.instanceId).join(','));
  ok('H the opener keeps exactly the hand it ended the turn with, and the peer agrees', vA.hand.map(h => h.iid).join(',') === handA0 && bModelA === handA0,
    'A before=' + handA0.split(',').length + ' A after=' + vA.hand.length + ' B model=' + bModelA.split(',').length + ' A.tn=' + vA.tn);
  ok('O after the hand-off B holds the turn', vB.myTurn && !vA.myTurn && !vB.aiBusy, 'A=' + vA.myTurn + ' B=' + vB.myTurn + ' B.aiBusy=' + vB.aiBusy);
  judgeHand('B', vB, dealtB, 'O+1');
  const tB = await tapFirstCard(B);
  ok('M B (375×812, touch) a TAP selects a hand card', tB.selected, JSON.stringify(tB));

  // ── R1 the WAITING player's tab really reloads ──────────────────────────
  console.log('\n── R1 A (waiting) reloads its tab mid-match');
  const handA = (await view(A)).hand.map(h => h.iid);
  note('A hand before reload: ' + (await view(A)).hand.map(h => h.name).join('|'));
  if (process.env.OH_TRACE) note('TRACE\n         ' + relay.trace.join('\n         '));
  note('B model of A hand:    ' + (await ev(B, () => (App.state.ai.hand || []).map(c => c.name).join('|'))));
  note('A log tail: ' + JSON.stringify(await ev(A, () => (App.state.log || []).slice(-12).map(l => (l && l.msg) || l))));
  A.down = true; await load(A); A.down = false;           // sessionStorage survives the reload
  note('fresh page before reconnect: ' + JSON.stringify(await ev(A, () => ({ state: !!App.state, hand: App.state && App.state.player ? (App.state.player.hand || []).map(c => (c && c.type) || '∅').join('|') : null, screen: App.screen, bp: Object.keys(App.battlePrep || {}).join('/') }))));
  await ev(A, () => attemptMatchReconnect());
  await settleQuiet(3000, 1500, 25000);
  vA = await view(A); vB = await view(B);
  note('A after reload: screen=' + vA.screen + ' awaiting=' + (await ev(A, () => !!MatchBroadcast.awaitingResync)) + ' hand=' + vA.hand.map(h => h.name + ':' + (h.type || '∅')).join('|'));
  judgeHand('A', vA, handA, 'R1');
  ok('R1 B still holds the turn, A waits', vB.myTurn && !vA.myTurn, 'A=' + vA.myTurn + ' B=' + vB.myTurn);

  // B plays through to A
  await ev(B, () => { App.ui.selectedCardId = null; onEndTurn(); });
  await settleQuiet(1500, 1200, 15000);
  vA = await view(A);
  ok('R1 A gets the turn back after the reload', vA.myTurn && !vA.aiBusy, 'myTurn=' + vA.myTurn + ' aiBusy=' + vA.aiBusy);
  const tA2 = await tapFirstCard(A);
  ok('R1 A (reloaded) click selects a hand card on its turn', tA2.selected, JSON.stringify(tA2));

  // ── R2 the TURN-HOLDER's tab reloads (phone) ───────────────────────────
  console.log('\n── R2 A hands off, B (turn-holder, phone) reloads its tab');
  await ev(A, () => { App.ui.selectedCardId = null; onEndTurn(); });
  await settleQuiet(1500, 1200, 15000);
  const handB = (await view(B)).hand.map(h => h.iid);
  B.down = true; await load(B); B.down = false;
  note('fresh page before reconnect: ' + JSON.stringify(await ev(B, () => ({ state: !!App.state, hand: App.state && App.state.player ? (App.state.player.hand || []).map(c => (c && c.type) || '∅').join('|') : null, screen: App.screen, bp: Object.keys(App.battlePrep || {}).join('/') }))));
  await ev(B, () => attemptMatchReconnect());
  await settleQuiet(3000, 1500, 25000);
  vB = await view(B);
  note('B after reload: ' + vB.hand.map(h => h.name + ':' + (h.type || '∅')).join('|'));
  judgeHand('B', vB, handB, 'R2');
  ok('R2 B holds the turn again', vB.myTurn && !vB.aiBusy, 'myTurn=' + vB.myTurn + ' aiBusy=' + vB.aiBusy);
  const tB2 = await tapFirstCard(B);
  ok('R2/M B (reloaded, phone) a TAP selects a hand card', tB2.selected, JSON.stringify(tB2));
  // …and a unit card actually goes down on the board
  const played = await ev(B, () => {
    const s = App.state; const hero = s.units.find(u => u.owner === 'player' && u.isHero);
    const c = (s.player.hand || []).find(x => x && x.type === 'unit');
    if (!c) return { skip: 'no unit in hand' };
    App.state = { ...s, player: { ...s.player, energy: 99 } };
    const tiles = getValidPlacementTiles(c, hero, App.state) || [];
    if (!tiles.length) return { err: 'no tile' };
    const n0 = App.state.units.length; placeUnit(c, tiles[0]);
    return { placed: App.state.units.length === n0 + 1, name: c.name };
  });
  ok('R2 B (reloaded) can place a unit card from its hand', played.placed || (played.skip && vB.hand.every(h => h.type)), JSON.stringify(played));
  await settleQuiet(800, 1000, 8000);

  // ── N negative control: a hand of wire stubs must go RED ──────────────
  console.log('\n── N negative control — B holds wire stubs (the pre-v175 reload hand)');
  await ev(B, () => {
    const s = App.state;
    App.state = { ...s, player: { ...s.player, hand: s.player.hand.map(c => ({ instanceId: c.instanceId, cardId: c.id, name: c.name })) } };
  });
  const vN = await view(B);
  const nReal = vN.hand.every(h => h.type && h.cost != null);
  const nDom = vN.domLive === vN.hand.length && vN.domBroken === 0;
  const tN = await tapFirstCard(B);
  ok('N (control) the oracle calls a stub hand broken — type check', !nReal, 'real=' + nReal);
  ok('N (control) the oracle calls a stub hand broken — DOM check', !nDom, 'live=' + vN.domLive + ' broken=' + vN.domBroken);
  ok('N (control) the oracle calls a stub hand broken — tap check', !tN.selected, JSON.stringify(tN));

  const errs = { A: A.errs.slice(0, 5), B: B.errs.slice(0, 5) };
  note('page errors: ' + JSON.stringify(errs));
  note('relay: sent=' + JSON.stringify(relay.sent) + ' delivered=' + JSON.stringify(relay.delivered) + ' lost=' + relay.lost);
} catch (e) {
  console.error(e);
  ok('harness ran to completion', false, String(e && e.message).slice(0, 200));
} finally {
  await browser.close();
}
const fail = results.filter(r => !r.pass).length;
console.log('\n' + (fail ? fail + ' of ' + results.length + ' FAILED' : 'all ' + results.length + ' passed'));
if (GATE) console.log('OPENHAND pass=' + (results.length - fail) + ' fail=' + fail);
process.exit(fail ? 1 : 0);
