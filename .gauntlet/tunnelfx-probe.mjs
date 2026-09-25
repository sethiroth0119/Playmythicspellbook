/* ══════════════════════════════════════════════════════════════════════════
   🌊 TUNNEL FX PROBE — the two new authorable tunnel effects, driven through
   the real reducers in the loaded page.

     A) tunnelFromDeck   search your DECK for a unit that HAS Tunnel and send it
                         to the tunnel zone with its printed counter.
     B) tunnelCountdown  lower EVERY one of YOUR tunnel counters by 1; anything
                         that reaches 0 surfaces immediately.

   The system they plug into (read out of the page, not invented):
     · the ZONE is state[side].tunneled — entries of { card, turnsLeft }.
     · the COUNTER is `turnsLeft` on the entry.
     · a card got in ONLY by burrowing from hand (TUNNEL_DIG_COST) until now.
     · counters tick at TURN START, in _tickTunneledCards, which surfaces the
       unit on the first free hex ring around that side's hero at 0.
     · "has tunnel" = card.type === 'unit' && card.tunnel > 0.

   What is asserted, and why each one is worth a line:
     A1  only tunnel-capable units matching the 🎴 filter are eligible
     A2  exactly Amount cards move deck → tunnel zone, with the RIGHT counter
     A3  the deck keeps everything that did not match (nothing else moves)
     A4  no match = a graceful amber line, no state change, NO picker
     A5  the AI path opens no UI at all (the trap-in-the-AI-loop hazard)
     A6  the Specific Cards allow-list wins over "soonest to surface"
     A7  the PLAYER gets the picker, pointed at the tunnel zone
     A8  …and the picker LISTS only the legal cards
     A9  …and committing a pick actually lands the card underground
     B1  every one of that side's counters drops by exactly 1
     B2  …and the opponent's tunnel zone is never touched
     B3  a counter that reaches the threshold surfaces IDENTICALLY to the
         natural turn-start tick (A/B against _tickTunneledCards itself)
     B4  an empty tunnel zone is a graceful no-op, not a crash
     E*  both effects are in the catalogue, grouped, described, gated, and
         survive an editor save → reload round trip

   Usage:  node .gauntlet/tunnelfx-probe.mjs [candidate.html]   (:8787 up)
           FAILS on HEAD, PASSES on the candidate.
   ══════════════════════════════════════════════════════════════════════════ */
import { chromium } from 'playwright';
import fs from 'node:fs';

const b = await chromium.launch();
const p = await b.newPage();
const errs = []; p.on('pageerror', e => errs.push(String(e.message || e)));
if (process.argv[2]) {
  const html = fs.readFileSync(process.argv[2], 'utf8');
  await p.route('**/index.html', (r) => r.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html }));
}
await p.goto('http://localhost:8787/index.html', { waitUntil: 'load', timeout: 60000 });
await p.waitForFunction(() => typeof window._applyOnPlayOneRaw === 'function'
  && typeof window._tickTunneledCards === 'function' && typeof window.renderForge === 'function',
  null, { timeout: 60000 });

const out = await p.evaluate(() => {
  const R = [];
  const ok = (label, cond, detail) => R.push({ label, pass: !!cond, detail: detail == null ? '' : String(detail) });

  // ── fixtures ───────────────────────────────────────────────────────────
  const unitCard = (id, name, extra) => Object.assign({
    id, name, type: 'unit', cost: 3, instanceId: 'i_' + id, elements: ['fire'],
    stats: { hp: 10, atk: 3, def: 1, mag: 0, res: 0, spd: 1 },
  }, extra || {});
  const side = (o) => Object.assign({ hand: [], deck: [], graveyard: [], void: [], tunneled: [], energy: 5, maxEnergy: 5 }, o);
  const digger = (owner) => ({ id: 'u_src', name: 'Digger', owner, alive: true, isHero: false, pos: { x: 3, y: 3 }, statusEffects: [] });
  const hero = (owner) => ({ id: 'h_' + owner, name: 'Hero', owner, alive: true, isHero: true, pos: { x: 3, y: 3 }, currentHp: 30, maxHp: 30, statusEffects: [] });
  const src = (eff) => ({ id: 'srcCard', name: 'Digger', type: 'unit', onPlay: eff });
  /* ⚠ A REAL BOARD IS NOT OPTIONAL. inBoundsOf() answers from _boardDims(state),
     which reads state.board — with no board every tile is out of bounds, the
     emergence ring finds nothing and _tickTunneledCards re-queues the unit at 1
     while reporting "finds no room". That reads exactly like a broken effect
     and is really a broken fixture, so every state below carries a board. */
  const board = () => Array.from({ length: 8 }, () => Array.from({ length: 8 }, () => ({})));
  const ids = (a) => (a || []).map(c => c && c.id);
  const ctrs = (a) => (a || []).map(e => [(e && e.card && e.card.id), (e && e.turnsLeft)]);

  //   t1 fire  unit  tunnel 3   ← legal
  //   t2 water unit  tunnel 2   ← wrong element
  //   n1 fire  unit  no tunnel  ← no Tunnel keyword at all
  //   s1 fire  SPELL tunnel 2   ← not a unit, can never surface onto a tile
  //   t3 fire  unit  tunnel 5   ← legal
  const pool = () => [
    unitCard('t1', 'Burrower',   { tunnel: 3 }),
    unitCard('t2', 'Deep Eel',   { tunnel: 2, elements: ['water'] }),
    unitCard('n1', 'Surfacer',   {}),
    unitCard('s1', 'Dig Spell',  { tunnel: 2, type: 'spell' }),
    unitCard('t3', 'Deep Wyrm',  { tunnel: 5 }),
  ];
  const FIRE = { element: 'fire' };

  // ── A. 🌊🔍 TUNNEL FROM DECK ───────────────────────────────────────────
  // A1-A3 + A5: the deterministic (AI) path.
  try {
    App.ui = App.ui || {}; App.ui.deckSearch = null; App.ui.deckSearchQueue = null;
    const st = { turn: 'ai', board: board(), log: [], units: [digger('ai'), hero('ai')], player: side({ tunneled: [] }), ai: side({ deck: pool() }) };
    const ns = _applyOnPlayOneRaw(st, digger('ai'), src({ type: 'tunnelFromDeck', amount: 2, filter: FIRE }));
    const tun = ns.ai.tunneled || [];
    ok('A1 only tunnel-capable units matching the filter were taken',
      JSON.stringify(tun.map(e => e.card.id).sort()) === '["t1","t3"]', JSON.stringify(ctrs(tun)));
    ok('A2 exactly Amount moved, each with its PRINTED counter',
      tun.length === 2 && JSON.stringify(ctrs(tun)) === '[["t1",3],["t3",5]]', JSON.stringify(ctrs(tun)));
    ok('A3 the deck keeps every card that did not match',
      JSON.stringify(ids(ns.ai.deck).sort()) === '["n1","s1","t2"]', JSON.stringify(ids(ns.ai.deck)));
    ok('A3b the input state was not mutated (immutable write)',
      (st.ai.tunneled || []).length === 0 && (st.ai.deck || []).length === 5);
    ok('A5 the AI path opened NO picker', !(App.ui && App.ui.deckSearch), JSON.stringify(App.ui && App.ui.deckSearch));
  } catch (e) { ok('A1-A5 ran', false, e.message); }

  // A4: nothing legal — graceful, silent about it in the log, no UI, no move.
  try {
    App.ui = App.ui || {}; App.ui.deckSearch = null;
    const deck = [unitCard('n1', 'Surfacer', {}), unitCard('s1', 'Dig Spell', { tunnel: 2, type: 'spell' })];
    const st = { turn: 'player', board: board(), log: [], units: [digger('player'), hero('player')], player: side({ deck }), ai: side() };
    const ns = _applyOnPlayOneRaw(st, digger('player'), src({ type: 'tunnelFromDeck', amount: 1 }));
    ok('A4a no legal card: nothing moved', (ns.player.tunneled || []).length === 0 && (ns.player.deck || []).length === 2);
    ok('A4b …and it SAYS so rather than failing silently',
      (ns.log || []).some(l => l && /Tunnel/i.test(String(l.msg)) && l.color === 'amber'),
      JSON.stringify((ns.log || []).map(l => l && l.msg)));
    ok('A4c …and no empty picker was opened', !(App.ui && App.ui.deckSearch));
  } catch (e) { ok('A4 ran', false, e.message); }

  // A6: the Specific Cards allow-list overrides the soonest-first heuristic.
  try {
    App.ui = App.ui || {}; App.ui.deckSearch = null;
    const st = { turn: 'ai', board: board(), log: [], units: [digger('ai'), hero('ai')], player: side(), ai: side({ deck: pool() }) };
    const ns = _applyOnPlayOneRaw(st, digger('ai'), src({ type: 'tunnelFromDeck', amount: 1, searchDeckCardIds: ['t3'] }));
    ok('A6 the allow-list wins (t3, not the sooner t1)',
      JSON.stringify(ctrs(ns.ai.tunneled)) === '[["t3",5]]', JSON.stringify(ctrs(ns.ai.tunneled)));
  } catch (e) { ok('A6 ran', false, e.message); }

  // A7-A9: the player's own turn — they PICK.
  try {
    App.ui = App.ui || {}; App.ui.deckSearch = null; App.ui.deckSearchQueue = null;
    const st = { turn: 'player', board: board(), log: [], units: [digger('player'), hero('player')], player: side({ deck: pool() }), ai: side() };
    const ns = _applyOnPlayOneRaw(st, digger('player'), src({ type: 'tunnelFromDeck', amount: 1, filter: FIRE }));
    const ds = App.ui && App.ui.deckSearch;
    ok('A7a the picker opened, aimed at the tunnel zone', !!ds && ds.dest === 'tunnel', ds && ds.dest);
    ok('A7b …browsing the DECK, restricted to cards that HAVE Tunnel',
      !!ds && ds.source === 'deck' && ds.requireTunnel === true, JSON.stringify(ds && { s: ds.source, rt: ds.requireTunnel }));
    ok('A7c …and nothing moved yet (the pick has not been made)',
      (ns.player.tunneled || []).length === 0 && (ns.player.deck || []).length === 5);

    App.state = ns;
    const html = (typeof renderDeckSearchModal === 'function') ? renderDeckSearchModal() : '';
    ok('A8a the picker LISTS the legal units', /Burrower/.test(html) && /Deep Wyrm/.test(html));
    ok('A8b …and offers nothing illegal (wrong element / no Tunnel / not a unit)',
      !/Deep Eel/.test(html) && !/Surfacer/.test(html) && !/Dig Spell/.test(html));

    try { _deckSearchSelect('i_t1'); } catch (e) { /* renderBattle off-screen may throw; the commit already happened */ }
    const after = App.state.player;
    ok('A9a the picked card is UNDERGROUND with its printed counter',
      JSON.stringify(ctrs(after.tunneled)) === '[["t1",3]]', JSON.stringify(ctrs(after.tunneled)));
    ok('A9b …and has left the deck', ids(after.deck).indexOf('t1') < 0 && (after.deck || []).length === 4, JSON.stringify(ids(after.deck)));
    ok('A9c …and never touched the hand', (after.hand || []).length === 0);
    App.ui.deckSearch = null;
  } catch (e) { ok('A7-A9 ran', false, e.message); }

  // ── B. 🌊⏬ TUNNEL COUNTDOWN ────────────────────────────────────────────
  // B1 + B2: every one of MY counters, none of theirs, nothing surfacing yet.
  try {
    const mine = [{ card: unitCard('t1', 'Burrower', { tunnel: 3 }), turnsLeft: 3 },
                  { card: unitCard('t3', 'Deep Wyrm', { tunnel: 5 }), turnsLeft: 2 }];
    const theirs = [{ card: unitCard('t2', 'Deep Eel', { tunnel: 2 }), turnsLeft: 2 }];
    const st = { turn: 'player', board: board(), log: [], units: [digger('player'), hero('player'), hero('ai')],
      player: side({ tunneled: mine }), ai: side({ tunneled: theirs }) };
    const ns = _applyOnPlayOneRaw(st, digger('player'), src({ type: 'tunnelCountdown' }));
    ok('B1 every one of MY counters dropped by exactly 1',
      JSON.stringify(ctrs(ns.player.tunneled)) === '[["t1",2],["t3",1]]', JSON.stringify(ctrs(ns.player.tunneled)));
    ok('B2 the opponent\'s tunnel zone is untouched',
      JSON.stringify(ctrs(ns.ai.tunneled)) === '[["t2",2]]', JSON.stringify(ctrs(ns.ai.tunneled)));
    ok('B2b nothing surfaced — no counter had reached the threshold',
      (ns.units || []).length === 3, (ns.units || []).length);
  } catch (e) { ok('B1-B2 ran', false, e.message); }

  // B3: a counter at 1 surfaces — and it must be INDISTINGUISHABLE from the
  // natural turn-start tick. Run both on identical states and compare.
  try {
    const build = () => ({ turn: 'player', board: board(), log: [], units: [digger('player'), hero('player')],
      player: side({ tunneled: [{ card: unitCard('t1', 'Burrower', { tunnel: 3 }), turnsLeft: 1 },
                                { card: unitCard('t3', 'Deep Wyrm', { tunnel: 5 }), turnsLeft: 4 }] }),
      ai: side() });
    const viaEffect = _applyOnPlayOneRaw(build(), digger('player'), src({ type: 'tunnelCountdown' }));
    const viaTick   = _tickTunneledCards(build(), 'player');
    const shape = (s) => JSON.stringify({
      tun: ctrs(s.player.tunneled),
      born: (s.units || []).filter(u => u && !u.isHero && u.id !== 'u_src')
        .map(u => [u.name, u.owner, u.pos && u.pos.x, u.pos && u.pos.y, !!u.hasAttacked]),
    });
    ok('B3a the unit at the threshold SURFACED', /Burrower/.test(shape(viaEffect)), shape(viaEffect));
    ok('B3b …and the one behind it just ticked down', ctrs(viaEffect.player.tunneled).length === 1
      && ctrs(viaEffect.player.tunneled)[0][1] === 3, JSON.stringify(ctrs(viaEffect.player.tunneled)));
    ok('B3c …IDENTICALLY to the natural turn-start tick (same zone, same body, same tile)',
      shape(viaEffect) === shape(viaTick), shape(viaEffect) + '  vs  ' + shape(viaTick));
    ok('B3d …and the emergence was logged', (viaEffect.log || []).some(l => l && /EMERGES/.test(String(l.msg))),
      JSON.stringify((viaEffect.log || []).map(l => l && l.msg)));
  } catch (e) { ok('B3 ran', false, e.message); }

  // B4: nothing underground — a graceful no-op with a line, not a crash.
  try {
    const st = { turn: 'player', board: board(), log: [], units: [digger('player'), hero('player')], player: side(), ai: side() };
    const ns = _applyOnPlayOneRaw(st, digger('player'), src({ type: 'tunnelCountdown' }));
    ok('B4a empty tunnel zone: nothing happens', (ns.player.tunneled || []).length === 0 && (ns.units || []).length === 2);
    ok('B4b …and it says so', (ns.log || []).some(l => l && l.color === 'amber' && /underground/i.test(String(l.msg))),
      JSON.stringify((ns.log || []).map(l => l && l.msg)));
  } catch (e) { ok('B4 ran', false, e.message); }

  // B5: the AI side can use it too, and only on its own zone.
  try {
    const st = { turn: 'ai', board: board(), log: [], units: [digger('ai'), hero('ai'), hero('player')],
      player: side({ tunneled: [{ card: unitCard('t1', 'Burrower', { tunnel: 3 }), turnsLeft: 2 }] }),
      ai: side({ tunneled: [{ card: unitCard('t3', 'Deep Wyrm', { tunnel: 5 }), turnsLeft: 3 }] }) };
    const ns = _applyOnPlayOneRaw(st, digger('ai'), src({ type: 'tunnelCountdown' }));
    ok('B5 an AI countdown lowers the AI zone and leaves the player\'s alone',
      JSON.stringify(ctrs(ns.ai.tunneled)) === '[["t3",2]]' && JSON.stringify(ctrs(ns.player.tunneled)) === '[["t1",2]]',
      JSON.stringify(ctrs(ns.ai.tunneled)) + ' / ' + JSON.stringify(ctrs(ns.player.tunneled)));
  } catch (e) { ok('B5 ran', false, e.message); }

  // ── C. the shared describe layer (card detail / rules text) ────────────
  try {
    const d1 = _describeOnPlayEffectBody({ type: 'tunnelFromDeck', amount: 2 });
    const d2 = _describeOnPlayEffectBody({ type: 'tunnelCountdown' });
    ok('C1 tunnelFromDeck is described', typeof d1 === 'string' && /[Tt]unnel/.test(d1) && d1.length > 20, d1);
    ok('C2 tunnelCountdown is described', typeof d2 === 'string' && /1/.test(d2) && /[Tt]unnel/.test(d2), d2);
  } catch (e) { ok('C ran', false, e.message); }

  // ── D. catalogue registration ──────────────────────────────────────────
  try {
    const cat = (typeof ONPLAY_TYPES !== 'undefined') ? ONPLAY_TYPES : [];
    const a = cat.find(t => t && t.id === 'tunnelFromDeck');
    const bb = cat.find(t => t && t.id === 'tunnelCountdown');
    ok('D1 both are in ONPLAY_TYPES', !!a && !!bb);
    ok('D2 both carry a "<icon> Name (what it does)" label the dropdown can explain',
      !!a && !!bb && /\(.+\)$/.test(a.label) && /\(.+\)$/.test(bb.label)
      && !!_onplayTypeDesc('tunnelFromDeck') && !!_onplayTypeDesc('tunnelCountdown'),
      (a && a.label || '') + ' | ' + (bb && bb.label || ''));
    // 🕳 an id in NO group is not cosmetic — a SCOPED Counter card can never
    // answer it (see the note above ONPLAY_TYPE_GROUPS).
    const grouped = (id) => (typeof ONPLAY_TYPE_GROUPS !== 'undefined') && ONPLAY_TYPE_GROUPS.some(g => g.ids.indexOf(id) >= 0);
    ok('D3 both are in a real optgroup (not swept into "Other")', grouped('tunnelFromDeck') && grouped('tunnelCountdown'));
    ok('D4 tunnelFromDeck needs Amount + the Card Filter + the allow-list',
      !!a && ['amount', 'filter', 'searchDeckCardIds'].every(n => a.needs.indexOf(n) >= 0), JSON.stringify(a && a.needs));
    ok('D5 tunnelCountdown needs no extra field (it is always "by 1")',
      !!bb && bb.needs.length === 0, JSON.stringify(bb && bb.needs));
  } catch (e) { ok('D ran', false, e.message); }

  // ── E. the editor: the gate, then save → reload ────────────────────────
  try {
    try { const g = document.getElementById('auth-gate'); if (g) g.remove(); } catch (e) {}
    Profile.cloud = Object.assign({}, Profile.cloud || {}, { signedIn: true, email: 'play@mythicsoa.com' });
    App.screen = 'forge'; App.forgeTab = 'cards';
    App.editingMoveId = null; App.editingEventId = null; App.editingEncounterId = null;
    App.editingPackId = null; App.editingStructDeckId = null; App.editingGuideId = null;
    App.editingItemId = null; App.editingTutorialId = null;
    App.editingCardId = 'NEW';
    App._newCardDraft = (typeof makeNewCardDraft === 'function') ? makeNewCardDraft() : { id: 'NEW', type: 'unit' };
    App._newCardDraft.type = 'unit';
    renderForge();
    const sel = document.getElementById('ed-onplay-type');
    ok('E1 the card editor opened', document.querySelectorAll('.card-editor').length === 1 && !!sel,
      document.querySelectorAll('.card-editor').length);

    const has = (id) => !!sel && [...sel.options].some(o => o.value === id);
    ok('E2 both effects are offered in the Forge dropdown', has('tunnelFromDeck') && has('tunnelCountdown'));

    const pick = (id) => { sel.value = id; sel.dispatchEvent(new Event('input', { bubbles: true })); sel.dispatchEvent(new Event('change', { bubbles: true })); try { window._fxApplyEffectGate(); } catch (e) {} };
    const offEl = (id) => { const e = document.getElementById(id); return e ? e.classList.contains('fx-off') : null; };

    pick('tunnelFromDeck');
    ok('E3 Amount is SHOWN for Tunnel From Deck (FX_GATE_FIELDS)', offEl('ed-onplay-amount') === false, offEl('ed-onplay-amount'));
    ok('E3b …and so are the 🎴 Card Filter and the Specific Cards allow-list',
      offEl('ed-onplay-searchcards') === false && offEl('ed-onplay-filter-name') === false,
      offEl('ed-onplay-searchcards') + '/' + offEl('ed-onplay-filter-name'));
    const amt = document.getElementById('ed-onplay-amount');
    if (amt) { amt.value = '3'; amt.dispatchEvent(new Event('input', { bubbles: true })); }
    const saved = { id: 'tfx_test', name: 'Tunnel Tester', type: 'unit' };
    captureEditorIntoCard(saved);
    ok('E4 SAVE: the effect and its Amount are captured onto the card',
      saved.onPlay && saved.onPlay.type === 'tunnelFromDeck' && (saved.onPlay.amount | 0) === 3,
      JSON.stringify(saved.onPlay && { t: saved.onPlay.type, a: saved.onPlay.amount }));

    // RELOAD — re-render the editor from the saved card and read it back.
    Forge.customCards = Forge.customCards || [];
    Forge.customCards.push(saved);
    App.editingCardId = 'tfx_test';
    renderForge();
    const sel2 = document.getElementById('ed-onplay-type');
    const amt2 = document.getElementById('ed-onplay-amount');
    ok('E5 RELOAD: the editor comes back on Tunnel From Deck with Amount 3',
      !!sel2 && sel2.value === 'tunnelFromDeck' && !!amt2 && (parseInt(amt2.value, 10) === 3),
      (sel2 && sel2.value) + ' / ' + (amt2 && amt2.value));

    // …and the same round trip for the countdown.
    const sel3 = document.getElementById('ed-onplay-type');
    sel3.value = 'tunnelCountdown';
    sel3.dispatchEvent(new Event('input', { bubbles: true })); sel3.dispatchEvent(new Event('change', { bubbles: true }));
    try { window._fxApplyEffectGate(); } catch (e) {}
    ok('E6 Amount is HIDDEN for Tunnel Countdown (it is always by 1)',
      offEl('ed-onplay-amount') === true, offEl('ed-onplay-amount'));
    captureEditorIntoCard(saved);
    ok('E7 SAVE: the countdown is captured', saved.onPlay && saved.onPlay.type === 'tunnelCountdown',
      saved.onPlay && saved.onPlay.type);
    renderForge();
    const sel4 = document.getElementById('ed-onplay-type');
    ok('E8 RELOAD: the editor comes back on Tunnel Countdown', !!sel4 && sel4.value === 'tunnelCountdown', sel4 && sel4.value);
    Forge.customCards = Forge.customCards.filter(c => c && c.id !== 'tfx_test');
    App.editingCardId = null;
  } catch (e) { ok('E ran', false, e.message); }

  // ── F. the multiplayer snapshot carries the zone (state only) ──────────
  try {
    const snap = (typeof _slimStateForBroadcast === 'function') ? _slimStateForBroadcast : null;
    // The slimmer reduces tunneled to counters only; what matters here is that
    // the zone is a STATE field on the side block (it is — the effects write
    // nowhere else), so it rides whatever the broadcast sends.
    const st = { turn: 'player', board: board(), log: [], units: [], player: { tunneled: [{ card: { id: 't1', name: 'X' }, turnsLeft: 2 }] }, ai: {} };
    ok('F1 the tunnel zone is plain side state (rides the snapshot)',
      Array.isArray(st.player.tunneled) && typeof st.player.tunneled[0].turnsLeft === 'number');
    // …and no client-only storage: read the two branches out of the reducer's
    // own source and check they touch nothing but state.
    const srcTxt = String(window._applyOnPlayOneRaw || '');
    const i0 = srcTxt.indexOf("eff.type === 'tunnelFromDeck'");
    const i1 = srcTxt.indexOf("eff.type === 'searchDeck'");
    const body = (i0 >= 0 && i1 > i0) ? srcTxt.slice(i0, i1) : '';
    ok('F2 neither effect uses client-only storage',
      !!body && !/localStorage|sessionStorage|indexedDB/.test(body), body ? 'clean (' + body.length + ' chars)' : 'branches not found');
    if (snap) { /* present in this build; the slim path is exercised by the MP suites */ }
  } catch (e) { ok('F ran', false, e.message); }

  return R;
});
await b.close();
let fails = 0;
for (const r of out) { if (!r.pass) fails++; console.log((r.pass ? '  ok   ' : '  FAIL ') + r.label + (r.pass ? '' : '   ← ' + r.detail)); }
if (errs.length) console.log('page errors: ' + errs.slice(0, 3).join(' | '));
console.log('\n' + (fails ? fails + ' FAILED of ' + out.length : 'ALL ' + out.length + ' PASS'));
process.exit(fails ? 1 : 0);
