/* ══════════════════════════════════════════════════════════════════════════
   MP SYNC AUDIT PROBE — two real clients, one looped-back relay, and the
   turn-boundary / private-zone / counter paths nobody had driven in PvP.

   Owner: "make sure players are synced ... cards and movement is correct with
   players where at all time match data is correct on both ends."

   HOW IT DRIVES THE GAME. Two browser contexts load the real index.html. Each
   gets a fake MatchBroadcast.channel whose send() only records the packet in
   the page. This file pulls the packets out and hands them to the OTHER page's
   real receive handlers (_onRemoteStateArrived / _onRemoteStateDeltaArrived —
   exactly what joinMatchChannel's .on('broadcast') callbacks call). Nothing is
   delivered unless this file delivers it, so every step is deterministic.
   joinMatchChannel itself is NOT run (its join handshake race is measured by
   drive-mp-twoclient.mjs; this file is about what happens after convergence).
   USE_COLYSEUS_MP is false in the shipped file, so this is the live transport.

   ARMS
     C0  convergence control — B adopts A's opening board (same unit ids).
     T2  one hand-off ticks a global countdown ONCE on both clients.
     T3  a unit killed on the OPPONENT's turn reaches its owner's graveyard pile.
     T4  an enemy unit hit by vanishTemp still exists somewhere after sync, and
         comes back.
     T5  day/night flips in PvP (it flips every DAY_NIGHT_PERIOD turns solo).
     T6  hidden info: what the opponent's hand looks like on the wire / screen.
     T7  an opponent's summonGrave trap sprung on the mover's engine can see the
         opponent's graveyard (control: the same trap on full card data).
     T8  a reloaded client gets its own hand back as real cards.
     T9  a turn-holder that reloads mid-turn gets no second turn start.
     T10 a ley hex one side flipped reads as the enemy's on the other.
     T1  a spell cast in PvP resolves promptly (control: the same cast solo).

   Patches that turn it green (all but T6a): .gauntlet/mp-sync-audit-patches.mjs
     node .gauntlet/mp-sync-audit-patches.mjs public/index.html <out.html>

   Usage: node .gauntlet/mp-sync-audit-probe.mjs [candidate.html]   (:8787 up)
          --skip-spell   skip T1 (it waits out a 20 s timer)
   ══════════════════════════════════════════════════════════════════════════ */
import { chromium } from 'playwright';
import fs from 'node:fs';

const CAND = process.argv.slice(2).find(a => !a.startsWith('--'));
const SKIP_SPELL = process.argv.includes('--skip-spell');
const html = CAND ? fs.readFileSync(CAND, 'utf8') : null;

const results = [];
const ok = (label, pass, detail) => {
  results.push({ label, pass: !!pass });
  console.log((pass ? '  ok   ' : '  FAIL ') + label + (detail == null ? '' : '   [' + detail + ']'));
};
const note = (s) => console.log('       ' + s);

const browser = await chromium.launch();
async function boot(tag) {
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 800 } });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(String(e.message || e).slice(0, 160)));
  await page.route('**/*', (r) => {
    const u = r.request().url();
    if (html && /\/index\.html(\?|$)/.test(u)) {
      return r.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html });
    }
    return (u.includes('localhost') || u.includes('127.0.0.1')) ? r.continue() : r.abort();
  });
  await page.goto('http://localhost:8787/index.html', { waitUntil: 'domcontentloaded', timeout: 180000 });
  await page.waitForFunction(() => typeof initGame === 'function' && typeof _onRemoteStateArrived === 'function'
    && typeof broadcastMyState === 'function' && typeof placeUnit === 'function' && typeof onEndTurn === 'function'
    && typeof _applyOnPlayOneRaw === 'function' && typeof applyTrapToUnit === 'function' && typeof playSpell === 'function',
    null, { timeout: 240000 });
  return { tag, page, errs };
}

/* Everything in-page lives on window.__mp. */
const PAGE_KIT = () => {
  window.__mp = { out: [], errs: [], dropped: {} };
  window.__mp.setup = (o) => {
    Cloud.ready = true;
    Cloud.client = {
      channel: () => ({ on() { return this; }, subscribe() { return this; }, send() { return Promise.resolve('ok'); } }),
      removeChannel: () => {},
      from: () => ({ select() { return this; }, eq() { return this; }, order() { return this; }, limit() { return this; },
        maybeSingle() { return this; }, single() { return this; }, update() { return this; }, insert() { return this; },
        then: (r) => Promise.resolve({ data: [], error: null }).then(r) }),
      rpc: () => Promise.resolve({ data: null, error: null }),
      functions: { invoke: () => Promise.resolve({ data: null, error: null }) },
      auth: { getSession: () => Promise.resolve({ data: { session: null } }) },
    };
    Profile.cloud = Profile.cloud || {};
    Profile.cloud.signedIn = true;
    Profile.cloud.userId = o.uid;
    Profile.cloud.autoSync = false;
    MatchBroadcast.channel = {
      send(m) {
        try { window.__mp.out.push(JSON.parse(JSON.stringify({ event: m.event, payload: m.payload }))); }
        catch (e) { window.__mp.errs.push('send ' + e); }
        return Promise.resolve('ok');
      },
      track() { return Promise.resolve('ok'); }, untrack() { return Promise.resolve('ok'); },
      unsubscribe() { return Promise.resolve('ok'); }, presenceState() { return {}; },
    };
    MatchBroadcast.myUserId = o.uid;
    MatchBroadcast.opponentId = o.opp;
    MatchBroadcast.matchId = null;          // keeps onEndTurn from invoking mp_end_turn
    MatchBroadcast.awaitingResync = false;
    MatchBroadcast.lastSeenTurn = 0;
    const me = findHeroById(STARTER_HEROES[o.myHero].id);
    const foe = findHeroById(STARTER_HEROES[o.oppHero].id);
    App.battlePrep = { hero: me, heroId: me.id, multiplayer: true, opponentName: o.oppName };
    App.state = initGame(me, foe, [], !!o.first, null);
    App.state.currentTurn = o.first ? 'player' : 'ai';
    MatchBroadcast.myTurn = !!o.first;
    App.ui.aiBusy = !o.first;
    App.screen = 'battle';
    try { render(); } catch (e) { window.__mp.errs.push('render ' + e); }
    return { units: App.state.units.length, tn: App.state.turnNumber };
  };
  window.__mp.recv = (m) => {
    if (m.event === 'state') { _onRemoteStateArrived(m.payload); return 1; }
    if (m.event === 'state-delta') { _onRemoteStateDeltaArrived(m.payload); return 1; }
    window.__mp.dropped[m.event] = (window.__mp.dropped[m.event] | 0) + 1;
    return 0;
  };
  window.__mp.marks = () => ({
    tn: App.state.turnNumber, turn: App.state.turn, cur: App.state.currentTurn, myTurn: !!MatchBroadcast.myTurn,
    ids: (App.state.units || []).filter(u => u && u.alive !== false).map(u => u.id).sort().join(','),
  });
  window.__mp.placeProbe = (n) => {
    const out = [];
    for (let i = 0; i < n; i++) {
      const s = App.state;
      const hand = (s.player.hand || []).slice();
      const card = { id: 'mp_probe_unit', name: 'Sync Probe ' + (i + 1), type: 'unit', cost: 0, level: 1,
        atk: 2, def: 1, hp: 8, stats: { hp: 8, atk: 2, def: 1, mag: 0, res: 0, spd: 2 },
        instanceId: 'probe_' + MatchBroadcast.myUserId + '_' + i, onPlay: null };
      if (hand.length > i) hand[i] = card; else hand.push(card);
      App.state = { ...s, player: { ...s.player, hand } };
      const ph = App.state.units.find(u => u.owner === 'player' && u.isHero);
      const tiles = getValidPlacementTiles(card, ph, App.state) || [];
      if (!tiles.length) { out.push({ err: 'no tile' }); continue; }
      const before = App.state.units.length;
      placeUnit(card, tiles[0]);
      const u = App.state.units.find(x => x && x._card && x._card.instanceId === card.instanceId);
      out.push({ placed: App.state.units.length === before + 1, id: u && u.id, hasCard: !!(u && u._card) });
    }
    return out;
  };
};

async function drain(from, to) {
  await from.page.waitForTimeout(120);          // broadcastMyState debounces 30 ms
  const msgs = await from.page.evaluate(() => window.__mp.out.splice(0));
  let n = 0;
  for (const m of msgs) n += await to.page.evaluate((mm) => window.__mp.recv(mm), m);
  return { sent: msgs.length, delivered: n, events: msgs.map(m => m.event).join(',') };
}
const ev = (c, fn, arg) => c.page.evaluate(fn, arg);

try {
  const [A, B] = await Promise.all([boot('A'), boot('B')]);
  await ev(A, PAGE_KIT); await ev(B, PAGE_KIT);
  await ev(A, (o) => window.__mp.setup(o), { uid: 'uid-aaaa', opp: 'uid-bbbb', myHero: 0, oppHero: 1, first: true, oppName: 'Bex' });
  await ev(B, (o) => window.__mp.setup(o), { uid: 'uid-bbbb', opp: 'uid-aaaa', myHero: 1, oppHero: 0, first: false, oppName: 'Ava' });
  // Drop whatever the setup render queued; convergence starts from a clean outbox.
  await ev(A, () => { window.__mp.out.length = 0; }); await ev(B, () => { window.__mp.out.length = 0; });

  // ── C0 convergence ────────────────────────────────────────────────────
  console.log('\n── C0 convergence control');
  // The shipped join: the waiting client asks, the turn-holder answers with a full
  // board through _sendFullSnapshot (the function the 'resync' handler calls).
  await ev(A, () => { App.state = { ...App.state, sealedTiles: [{ x: 0, y: 0, turnsLeft: 6 }] }; MatchBroadcast.lastSentSnapshot = null; _sendFullSnapshot({ reason: 'join', stuck: false }); });
  await ev(B, () => { MatchBroadcast._resyncAskedAt = Date.now(); });
  const d0 = await drain(A, B);
  note('C0 relay: ' + JSON.stringify(d0) + '  A outbox errors: ' + JSON.stringify(await ev(A, () => window.__mp.errs)));
  const mA0 = await ev(A, () => window.__mp.marks()), mB0 = await ev(B, () => window.__mp.marks());
  ok('C0 B adopted A\'s opening board (same live unit ids)', d0.delivered > 0 && mA0.ids === mB0.ids, 'delivered=' + d0.delivered);

  // ── T2 double turn-start ──────────────────────────────────────────────
  console.log('\n── T2 turn hand-off ticks global timers once');
  const tl = () => ((App.state.sealedTiles || [])[0] || {}).turnsLeft;
  const b4A = await ev(A, tl), b4B = await ev(B, tl);
  await ev(A, () => onEndTurn());
  const aAfterEnd = await ev(A, tl);
  await drain(A, B);
  const bAfterAdopt = await ev(B, tl);
  const mB1 = await ev(B, () => window.__mp.marks());
  note('sealedTiles.turnsLeft: before A=' + b4A + ' B=' + b4B + ' | A after its onEndTurn=' + aAfterEnd + ' | B after adopting=' + bAfterAdopt);
  ok('T2a B now holds the turn (handoff works)', mB1.myTurn && mB1.cur === 'player', JSON.stringify(mB1).slice(0, 80));
  ok('T2b ONE hand-off costs the countdown ONE tick on the receiver', bAfterAdopt === b4A - 1,
     'expected ' + (b4A - 1) + ', B shows ' + bAfterAdopt + ' (sender ran startTurn(ai), receiver ran startTurn(player) again)');
  // The sender is one packet behind until the new turn-holder speaks (its 4 s
  // heartbeat does exactly this call) — so agreement is judged after that packet.
  await ev(B, () => broadcastMyState());
  await drain(B, A);
  const aConv = await ev(A, tl);
  ok('T2c (control) sender converges on the receiver\'s countdown after its next packet', aConv === bAfterAdopt, 'A=' + aConv + ' B=' + bAfterAdopt);

  // ── B's turn: place two probe units ───────────────────────────────────
  const placed = await ev(B, () => window.__mp.placeProbe(2));
  note('B placed: ' + JSON.stringify(placed));
  const dP = await drain(B, A);
  note('B->A after placing: ' + JSON.stringify(dP) + '  A=' + JSON.stringify(await ev(A, () => ({ ...window.__mp.marks(), ids: undefined, lastSeen: MatchBroadcast.lastSeenTurn, base: !!MatchBroadcast.lastRecvSnapshot, drops: MatchBroadcast._authorityDrops | 0, out: window.__mp.out.map(m => m.event) }))));
  const probeIds = placed.map(p => p.id).filter(Boolean);
  const aSees = await ev(A, (ids) => ids.map(id => { const u = App.state.units.find(x => x.id === id); return u ? u.owner : null; }), probeIds);
  ok('B\'s two probe units reached A as enemy units', aSees.length === 2 && aSees.every(o => o === 'ai'), JSON.stringify(aSees));

  // ── T6 hidden info ────────────────────────────────────────────────────
  console.log('\n── T6 hidden information');
  const bHand = await ev(B, () => (App.state.player.hand || []).map(c => ({ n: c.name, id: c.id })));
  const aView = await ev(A, () => ({
    hand: (App.state.ai.hand || []).map(c => ({ n: c.name, id: c.cardId || c.id })),
    deckTop: (App.state.ai.deck || []).slice(0, 3).map(c => c.name),
  }));
  const namesMatch = bHand.length && aView.hand.length === bHand.length && aView.hand.every((c, i) => c.n === bHand[i].n);
  note('B hand: ' + bHand.map(c => c.n).join(' | '));
  note('A holds for enemy hand: ' + aView.hand.map(c => c.n).join(' | ') + '   enemy deck top: ' + aView.deckTop.join(' | '));
  ok('T6a the wire does NOT carry the opponent\'s hand card names (A can read B\'s exact hand)', !namesMatch,
     namesMatch ? 'leaked ' + aView.hand.length + ' names, in order, plus deck order' : 'no leak');
  const shown = await ev(A, (names) => {
    try { if (typeof renderBattle === 'function') renderBattle(); } catch (e) {}
    const own = new Set([...(App.state.player.hand || []).map(c => c.name), ...(App.state.units || []).map(u => u.name)]);
    const txt = (document.getElementById('root') || document.body).innerText || '';
    return names.filter(n => n && !own.has(n) && txt.indexOf(n) >= 0);
  }, bHand.map(c => c.n));
  ok('T6b none of B\'s (non-public) hand names are rendered on A\'s screen', shown.length === 0, JSON.stringify(shown));

  // ── B gets a unit card into its graveyard for T7, then ends turn ──────
  await ev(B, () => {
    const G = { id: 'probe_ghoul', name: 'Probe Ghoul', type: 'unit', cost: 2, icon: '🧟', instanceId: 'b_ghoul_1',
      stats: { hp: 20, atk: 10, def: 4, mag: 0, res: 2, spd: 2 }, hp: 20, elements: ['shadow'], factions: [],
      learnset: [{ lvl: 1, m: 'slash' }], passive: 'none' };
    App.state = _cardToGrave(App.state, 'player', G);
  });
  await ev(B, () => onEndTurn());
  await drain(B, A);
  const mA2 = await ev(A, () => window.__mp.marks());
  ok('A holds the turn again', mA2.myTurn, JSON.stringify(mA2).slice(0, 80));
  const tAfterRound = await ev(A, tl), tAfterRoundB = await ev(B, tl);
  note('after ONE full round (2 hand-offs) sealedTiles.turnsLeft A=' + tAfterRound + ' B=' + tAfterRoundB + ' (started at 6; 2 ticks expected => 4)');

  // ── T3 kill on the opponent's turn ────────────────────────────────────
  console.log('\n── T3 a unit killed on the opponent\'s turn reaches its owner\'s graveyard');
  const killId = probeIds[0];
  const kA = await ev(A, (id) => {
    const u0 = App.state.units.find(x => x.id === id);
    App.state = { ...App.state, units: App.state.units.map(u => u.id === id ? { ...u, alive: false, currentHp: 0 } : u) };
    const u = App.state.units.find(x => x.id === id);
    const iid = u && u._card && u._card.instanceId;
    const r = { iid, filed: u && u._cardFiled, inAiGrave: (App.state.ai.graveyard || []).some(c => c && c.instanceId === iid), hadCard: !!(u0 && u0._card) };
    checkPostAction();
    return r;
  }, killId);
  await drain(A, B);
  const kB = await ev(B, (o) => {
    const u = App.state.units.find(x => x.id === o.id);
    return {
      dead: !!u && u.alive === false,
      filed: u && u._cardFiled,
      inPile: (App.state.player.graveyard || []).some(c => c && c.instanceId === o.iid),
      inView: (typeof _graveViewCards === 'function') && _graveViewCards(App.state, 'player').some(c => c && (c.instanceId === o.iid || c._summonedUnitId === o.id || /Sync Probe/.test(c.name || ''))),
      pile: (App.state.player.graveyard || []).map(c => c.name),
    };
  }, { id: killId, iid: kA.iid });
  note('attacker A: unit._cardFiled=' + kA.filed + ', filed into A.state.ai.graveyard=' + kA.inAiGrave);
  note('victim   B: sees it dead=' + kB.dead + ', unit._cardFiled=' + kB.filed + ', B.player.graveyard=' + JSON.stringify(kB.pile) + ', graveyard VIEW shows it=' + kB.inView);
  ok('T3a (control) the attacker filed the card', kA.inAiGrave && kA.filed === 'grave');
  ok('T3b the victim sees its unit dead', kB.dead);
  ok('T3c the victim\'s OWN graveyard pile holds the card (salvage / raise / grave counts read this)', kB.inPile,
     'missing — _cardFiled rode the snapshot, so B\'s reconciler treats it as already filed');

  // ── T10 ley ownership crosses the mirror ──────────────────────────────
  console.log('\n── T10 a ley hex A flipped reads as the ENEMY\'s on B');
  {
    await ev(A, () => {
      const b = App.state.board.map(r => r.map(t => ({ ...t })));
      b[0][0] = { ...b[0][0], ley: { elem: 'fire', power: 2, owner: 'player', held: 1, idle: 0 } };
      App.state = { ...App.state, board: b };
      checkPostAction();
    });
    await drain(A, B);
    const lo = await ev(B, () => { const p = _mirrorPos({ x: 0, y: 0 }); const t = App.state.board[p.y][p.x]; return t && t.ley ? t.ley.owner : null; });
    ok('T10 A\'s ley hex arrives on B owned by the enemy', lo === 'ai', 'B reads owner=' + lo);
  }

  // ── T4 vanishTemp on an enemy unit ────────────────────────────────────
  console.log('\n── T4 vanishTemp on an enemy unit survives the sync');
  const vanId = probeIds[1];
  const vA = await ev(A, (id) => {
    const hero = App.state.units.find(u => u.owner === 'player' && u.isHero);
    const card = { id: 'probe_vanisher', name: 'Probe Vanisher', type: 'spell', onPlay: { type: 'vanishTemp', statusDuration: 1, tSide: 'enemy', aoeAll: true } };
    App.state = _applyOnPlayOneRaw(App.state, hero, card);
    const r = { onBoard: App.state.units.some(u => u.id === id), inBay: ((App.state.ai && App.state.ai._vanished) || []).some(v => v && v.unit && v.unit.id === id), returnOn: (((App.state.ai && App.state.ai._vanished) || [])[0] || {}).returnOn, tn: App.state.turnNumber };
    checkPostAction();
    return r;
  }, vanId);
  await drain(A, B);
  const where = (id) => ({
    onBoard: App.state.units.some(u => u.id === id && u.alive !== false),
    inBay: ['player', 'ai'].some(s => ((App.state[s] && App.state[s]._vanished) || []).some(v => v && v.unit && v.unit.id === id))
      || (App.state._vanished || []).some(v => v && v.unit && v.unit.id === id),
  });
  const vB = await ev(B, where, vanId);
  note('A after cast: onBoard=' + vA.onBoard + ' parked in A.state.ai._vanished=' + vA.inBay + ' returnOn=' + vA.returnOn + ' (turn ' + vA.tn + ')');
  note('B after adopt: onBoard=' + vB.onBoard + ' parked anywhere on B=' + vB.inBay);
  ok('T4a (control) A parked the unit', !vA.onBoard && vA.inBay);
  ok('T4b the owner (B) still has the unit somewhere after the sync', vB.onBoard || vB.inBay, 'the record lives in a private side block the receiver discards');

  // ── T5 + T4 continued: run several hand-offs ──────────────────────────
  console.log('\n── T5 day/night + vanish return over 12 hand-offs');
  const tod0 = await ev(A, () => App.state.timeOfDay);
  let cur = A, oth = B;
  for (let i = 0; i < 12; i++) {
    const r = await ev(cur, () => { try { onEndTurn(); } catch (e) { return String(e); } return App.ui && App.ui.discardPrompt ? 'discard' : 'ok'; });
    if (r !== 'ok') {
      // hand limit: pitch the extras through the real timer path
      await ev(cur, () => { App._turnTimerFired = true; try { onEndTurn(); } finally { App._turnTimerFired = false; } });
    }
    await drain(cur, oth);
    [cur, oth] = [oth, cur];
  }
  const endA = await ev(A, () => ({ tn: App.state.turnNumber, tod: App.state.timeOfDay, my: !!MatchBroadcast.myTurn }));
  const endB = await ev(B, () => ({ tn: App.state.turnNumber, tod: App.state.timeOfDay, my: !!MatchBroadcast.myTurn }));
  note('timeOfDay at start=' + tod0 + '; after 12 hand-offs A=' + JSON.stringify(endA) + ' B=' + JSON.stringify(endB) + ' (DAY_NIGHT_PERIOD=' + (await ev(A, () => DAY_NIGHT_PERIOD)) + ')');
  ok('T5 day/night flipped at least once in ' + endA.tn + ' turns of PvP', endA.tod !== tod0 || endB.tod !== tod0, 'never flipped: the flip lives only in endAITurn');
  const vA2 = await ev(A, where, vanId), vB2 = await ev(B, where, vanId);
  ok('T4c the vanished unit came back (returnOn was turn ' + vA.returnOn + ')', vA2.onBoard || vB2.onBoard,
     'A=' + JSON.stringify(vA2) + ' B=' + JSON.stringify(vB2));
  const tFinalA = await ev(A, tl), tFinalB = await ev(B, tl);
  note('sealed tile (6 turns) after 14 hand-offs: A=' + tFinalA + ' B=' + tFinalB + ' (undefined = expired)');

  // ── T7 opponent's summonGrave trap on stub zones ──────────────────────
  console.log('\n── T7 opponent-side zones are stubs on the mover\'s engine');
  // Make sure A holds the turn and has B's latest block.
  const holder = (await ev(A, () => !!MatchBroadcast.myTurn)) ? A : B;
  const other = holder === A ? B : A;
  await ev(other, () => { App.state = _cardToGrave(App.state, 'player', { id: 'probe_ghoul', name: 'Probe Ghoul', type: 'unit', cost: 2, icon: '🧟', instanceId: 'x_ghoul_' + Date.now(), stats: { hp: 20, atk: 10, def: 4, mag: 0, res: 2, spd: 2 }, hp: 20, learnset: [{ lvl: 1, m: 'slash' }], passive: 'none' }); window.__mp.out.length = 0; });
  // The holder learns the other side's zones only from the other side's packets;
  // re-send the other side's full block as the other side's own (real) resync answer would.
  await ev(other, () => { const req = { stuck: true }; _sendFullSnapshot(req); });
  // Deliver as a resync answer the holder asked for.
  await ev(holder, () => { MatchBroadcast._resyncAskedAt = Date.now(); });
  await drain(other, holder);
  const t7 = await ev(holder, () => {
    const GHOUL = { id: 'probe_ghoul', name: 'Probe Ghoul', type: 'unit', cost: 2, icon: '🧟',
      stats: { hp: 20, atk: 10, def: 4, mag: 0, res: 2, spd: 2 }, hp: 20, elements: ['shadow'], factions: [],
      learnset: [{ lvl: 1, m: 'slash' }], passive: 'none' };
    try { Forge.customCards = (Forge.customCards || []).filter(c => c && c.id !== GHOUL.id).concat([GHOUL]); } catch (e) {}
    const grave = (App.state.ai.graveyard || []);
    const ghoulStub = grave.find(c => c && (c.cardId === 'probe_ghoul' || c.id === 'probe_ghoul'));
    const TRAP = { id: 'probe_brain_eater', name: 'Probe Brain Eater', type: 'trap', cost: 1, icon: '🧠', trapMode: 'flip', effect: { type: 'summonGrave', amount: 1 }, instanceId: 'i_trap_x' };
    const mover = App.state.units.find(u => u.owner === 'player' && u.isHero);
    const rec = { card: TRAP, owner: 'ai', setTurn: 1 };
    const count = (st) => (st.units || []).filter(u => u && u.owner === 'ai' && !u.isHero && /Ghoul/.test(u.name || '')).length;
    const saveUi = App.ui.deckSearch;
    const live = applyTrapToUnit({ ...App.state, board: App.state.board.map(r => r.map(t => ({ ...t }))) }, mover, rec);
    const full = { ...App.state, ai: { ...App.state.ai, graveyard: grave.map(c => (c && (c.cardId === 'probe_ghoul' || c.id === 'probe_ghoul')) ? { ...GHOUL, instanceId: c.instanceId } : c) } };
    const ctrl = applyTrapToUnit({ ...full, board: full.board.map(r => r.map(t => ({ ...t }))) }, mover, rec);
    App.ui.deckSearch = saveUi;
    return { stub: ghoulStub || null, graveLen: grave.length, withIdField: grave.filter(c => c && c.id).length,
      raisedLive: count(live), raisedCtrl: count(ctrl), lastLog: ((live.log || []).slice(-1)[0] || {}).msg };
  });
  note('holder sees enemy graveyard of ' + t7.graveLen + ' cards, ' + t7.withIdField + ' with an `id` field; the ghoul arrives as ' + JSON.stringify(t7.stub));
  note('live trap log: ' + t7.lastLog);
  ok('T7a (control) the trap raises the ghoul when the grave holds full card data', t7.raisedCtrl === 1, 'raised ' + t7.raisedCtrl);
  ok('T7b the opponent\'s summonGrave trap raises its ghoul on the mover\'s engine (real wire data)', t7.raisedLive === 1,
     'raised ' + t7.raisedLive + ' — enemy piles are {instanceId,cardId,name} stubs, legalG needs c.id');

  // ── T8 reload mid-match ───────────────────────────────────────────────
  console.log('\n── T8 a reloaded client gets its own hand back as real cards');
  {
    const h = (await ev(A, () => !!MatchBroadcast.myTurn)) ? A : B;
    const o = h === A ? B : A;
    const before = await ev(o, () => (App.state.player.hand || []).map(c => ({ name: c.name, type: c.type, cost: c.cost })));
    // What attemptMatchReconnect leaves behind after a tab reload: no App.state,
    // awaitingResync, a fresh MatchBroadcast (joinMatchChannel's reset), an ask out.
    await ev(o, () => {
      App.state = null;
      MatchBroadcast.awaitingResync = true; MatchBroadcast.lastSeenTurn = 0;
      MatchBroadcast.lastRecvSnapshot = null; MatchBroadcast.lastSentSnapshot = null;
      MatchBroadcast._resyncAskedAt = Date.now(); MatchBroadcast.myTurn = false;
      window.__mp.out.length = 0;
    });
    await ev(h, () => { _sendFullSnapshot({ reason: 'join', stuck: true }); });
    const dR = await drain(h, o);
    const after = await ev(o, () => App.state ? {
      hand: (App.state.player.hand || []).map(c => ({ name: c.name, type: c.type, cost: c.cost, keys: Object.keys(c).join('/') })),
      deckTyped: (App.state.player.deck || []).filter(c => c && c.type).length,
      deckLen: (App.state.player.deck || []).length,
      units: (App.state.units || []).length,
    } : null);
    note('relay ' + JSON.stringify(dR));
    note('hand before reload: ' + JSON.stringify(before.slice(0, 3)));
    note('hand after resync:  ' + JSON.stringify(after && after.hand.slice(0, 3)) + '  deck cards with a type: ' + (after && after.deckTyped) + '/' + (after && after.deckLen));
    ok('T8a (control) the reloaded client is standing on a board again', after && after.units > 0);
    ok('T8b its hand cards are real cards (type + cost), not wire stubs', after && after.hand.length && after.hand.every(c => c.type && c.cost != null),
       after && ('keys of hand[0]: ' + (after.hand[0] && after.hand[0].keys)));
  }

  // ── T9 the TURN-HOLDER reloads mid-turn ───────────────────────────────
  console.log('\n── T9 a turn-holder that reloads mid-turn does not get a second turn start');
  {
    const h = (await ev(A, () => !!MatchBroadcast.myTurn)) ? A : B;
    const o = h === A ? B : A;
    // The holder spends its turn: hero acted, energy gone. Its (heartbeat) packet reaches the peer.
    const spent = await ev(h, () => {
      App.state = { ...App.state,
        player: { ...App.state.player, energy: 0 },
        units: App.state.units.map(u => (u && u.owner === 'player' && u.isHero) ? { ...u, hasMoved: true, hasAttacked: true } : u) };
      broadcastMyState();
      const hero = App.state.units.find(u => u.owner === 'player' && u.isHero);
      return { tn: App.state.turnNumber, energy: App.state.player.energy, moved: hero.hasMoved, atk: hero.hasAttacked };
    });
    await drain(h, o);
    // Tab reload: page state gone (MatchBroadcast is rebuilt from scratch, so
    // _mpLastTurnStarted is gone too), then attemptMatchReconnect's resync.
    await ev(h, () => {
      App.state = null;
      MatchBroadcast.awaitingResync = true; MatchBroadcast.lastSeenTurn = 0;
      MatchBroadcast.lastRecvSnapshot = null; MatchBroadcast.lastSentSnapshot = null;
      MatchBroadcast._resyncAskedAt = Date.now(); MatchBroadcast.myTurn = false;
      MatchBroadcast._mpLastTurnStarted = undefined;
      window.__mp.out.length = 0;
    });
    note("peer stamp before answer: " + await ev(o, () => App.state._mpTurnStartedTn + "/" + App.state.turnNumber));
    await ev(o, () => { window.__mp.out.length = 0; _sendFullSnapshot({ reason: 'join', stuck: true }); });
    await drain(o, h);
    const back = await ev(h, () => {
      const hero = App.state && App.state.units.find(u => u.owner === 'player' && u.isHero);
      return App.state ? { tn: App.state.turnNumber, stamp: App.state._mpTurnStartedTn, myTurn: !!MatchBroadcast.myTurn, energy: App.state.player.energy,
        moved: hero && hero.hasMoved, atk: hero && hero.hasAttacked } : null;
    });
    note('holder before reload: ' + JSON.stringify(spent) + '   after reload+resync: ' + JSON.stringify(back));
    ok('T9a (control) the reloaded holder holds the turn again, same turn number', back && back.myTurn && back.tn === spent.tn);
    ok('T9b its hero is still spent (no free second action round)', back && back.moved && back.atk, back && ('hasMoved=' + back.moved + ' hasAttacked=' + back.atk));
  }

  // ── T1 spell counter window ───────────────────────────────────────────
  if (!SKIP_SPELL) {
    console.log('\n── T1 a spell cast in PvP resolves promptly');
    const castOn = (await ev(A, () => !!MatchBroadcast.myTurn)) ? A : B;
    const cast = async (mp) => ev(castOn, async (mpFlag) => {
      App.battlePrep.multiplayer = mpFlag;
      const card = { id: 'probe_spark', name: 'Probe Spark ' + (mpFlag ? 'MP' : 'solo'), type: 'spell', cost: 0,
        instanceId: 'spark_' + (mpFlag ? 'mp' : 'solo') + '_' + Date.now(), effect: { type: 'draw', amount: 1 } };
      const s = App.state;
      App.state = { ...s, turn: 'player', phase: 'setup', player: { ...s.player, energy: 9, hand: [...(s.player.hand || []).slice(0, 5), card] } };
      App._spellInFlight = 0;
      const t0 = Date.now();
      try { playSpell(card); } catch (e) { return { err: String(e) }; }
      const inHand = () => (App.state.player.hand || []).some(c => c && c.instanceId === card.instanceId);
      await new Promise(r => setTimeout(r, 1500));
      const at1500 = { inFlight: !!App._spellInFlight, inHand: inHand(), pending: !!MatchBroadcast._counterReqPending,
        outbound: window.__mp.out.map(m => m.event).filter(e => /counter/i.test(e)) };
      while ((App._spellInFlight || inHand()) && Date.now() - t0 < 25000) await new Promise(r => setTimeout(r, 250));
      const res = { at1500, resolvedMs: Date.now() - t0, stillInHand: inHand() };
      App.battlePrep.multiplayer = true;
      return res;
    }, mp);
    const solo = await cast(false);
    note('solo control: ' + JSON.stringify(solo));
    const mp = await cast(true);
    note('PvP cast:     ' + JSON.stringify(mp));
    ok('T1a (control) the same spell resolves at once outside PvP', solo && !solo.err && solo.resolvedMs < 2000, solo && solo.resolvedMs + ' ms');
    ok('T1b in PvP the spell is not held on a counter request that is never sent', mp && !mp.err && mp.resolvedMs < 2000,
       mp && (mp.resolvedMs + ' ms; pending counterReq at 1.5 s=' + (mp.at1500 && mp.at1500.pending) + ', packets sent for it=' + JSON.stringify(mp.at1500 && mp.at1500.outbound)));
  }

  const perr = [...A.errs, ...B.errs];
  if (perr.length) console.log('\npage errors: ' + perr.slice(0, 4).join(' | '));
  const kitErr = [...(await ev(A, () => window.__mp.errs)), ...(await ev(B, () => window.__mp.errs))];
  if (kitErr.length) console.log('kit errors: ' + kitErr.slice(0, 4).join(' | '));
} catch (e) {
  console.log('PROBE THREW: ' + (e && e.stack || e));
  results.push({ label: 'probe ran', pass: false });
}
await browser.close();
const fails = results.filter(r => !r.pass).length;
console.log('\n' + (fails ? fails + ' of ' + results.length + ' FAILED' : 'ALL ' + results.length + ' PASS'));
process.exit(fails ? 1 : 0);
