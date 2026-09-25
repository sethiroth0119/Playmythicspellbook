/* ══════════════════════════════════════════════════════════════════════════
   VOID + FLASH PROBE — banished-as-a-cost cards reach the Vanish zone, and the
   "— COUNTERED" flash stays up four seconds.

   Owner: "I vanished a card from my graveyard for a cost and it still did not
   appear in the vanish zone" / "when I used spell counters a quick notification
   flash acrossed the screen make it last 4 seconds".

   Real reducers in the loaded page:
     V. _applyCostPayment (the activation-cost picker) and _applyAltPlayCost (the
        banishGraveCost play requirement — grave, hand and field) put what they
        banish into side.void, the pile hud.js draws as the Vanish zone; the
        graveyard loses it; a corpse the card stood in for stops showing in the
        graveyard view.
     F. the flash overlay's animation is 4 s and resumes on re-render.

   Usage: node .gauntlet/voidflash-probe.mjs [candidate.html]   (:8787 up)
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
await p.waitForFunction(() => typeof window._applyCostPayment === 'function' && typeof window._applyAltPlayCost === 'function');

const out = await p.evaluate(() => {
  const R = [];
  const ok = (label, cond, detail) => R.push({ label, pass: !!cond, detail: detail == null ? '' : String(detail) });
  const card = (id, name, extra) => Object.assign({ id, name, type: 'spell', cost: 1, instanceId: 'i_' + id }, extra || {});
  const side = (o) => Object.assign({ hand: [], deck: [], graveyard: [], void: [], energy: 5, maxEnergy: 5 }, o);
  const ids = (arr) => (arr || []).map(c => c && c.id);

  // ── V1. the activation-cost picker ────────────────────────────────────
  try {
    const st = { turn: 'player', log: [], units: [], player: side({ graveyard: [card('a', 'Ash'), card('b', 'Bone')] }), ai: side() };
    const ns = _applyCostPayment(st, 'player', null, { banish: 1 }, { banishIdxs: [1] }).state;   // returns { state, log }
    ok('V1a cost picker: the banished card left the graveyard', JSON.stringify(ids(ns.player.graveyard)) === '["a"]', JSON.stringify(ids(ns.player.graveyard)));
    ok('V1b …and is IN THE VOID (the Vanish zone reads this)', JSON.stringify(ids(ns.player.void)) === '["b"]', JSON.stringify(ids(ns.player.void)));
    ok('V1c the input state was not mutated', (st.player.void || []).length === 0);
  } catch (e) { ok('V1 ran', false, e.message); }

  // ── V2. banishGraveCost from the graveyard ────────────────────────────
  try {
    const st = { turn: 'player', log: [], units: [], player: side({ graveyard: [card('g1', 'Grave One'), card('g2', 'Grave Two')] }), ai: side() };
    const play = card('bx', 'Banisher', { playRequirement: { type: 'banishGraveCost', count: 2, fromZone: 'grave' } });
    const ns = { ...st };
    const ap = _applyAltPlayCost(ns, 'player', play);
    ok('V2a alt cost: both grave cards left the graveyard', (ns.player.graveyard || []).length === 0, JSON.stringify(ids(ns.player.graveyard)));
    ok('V2b …and both are IN THE VOID', JSON.stringify(ids(ns.player.void).sort()) === '["g1","g2"]', JSON.stringify(ids(ns.player.void)));
  } catch (e) { ok('V2 ran', false, e.message); }

  // ── V3. banishGraveCost from the hand ─────────────────────────────────
  try {
    const play = card('bh', 'Hand Banisher', { playRequirement: { type: 'banishGraveCost', count: 1, fromZone: 'hand' } });
    const st = { turn: 'player', log: [], units: [], player: side({ hand: [play, card('h1', 'Hand One')] }), ai: side() };
    const ns = { ...st };
    const ap = _applyAltPlayCost(ns, 'player', play);
    ok('V3a alt cost: the hand card is gone from the hand it returns', JSON.stringify(ids(ap.hand)) === '["bh"]', JSON.stringify(ids(ap.hand)));
    ok('V3b …and is IN THE VOID', JSON.stringify(ids(ns.player.void)) === '["h1"]', JSON.stringify(ids(ns.player.void)));
  } catch (e) { ok('V3 ran', false, e.message); }

  // ── V4. banishGraveCost from the field ────────────────────────────────
  try {
    const u = { id: 'u9', name: 'Offering', owner: 'player', alive: true, pos: { x: 1, y: 1 }, cardId: 'offering',
      _card: card('offering', 'Offering', { type: 'unit', instanceId: 'iid_off' }) };
    const st = { turn: 'player', log: [], units: [u], player: side(), ai: side() };
    const play = card('bf', 'Field Banisher', { playRequirement: { type: 'banishGraveCost', count: 1, fromZone: 'field' } });
    const ns = { ...st };
    const ap = _applyAltPlayCost(ns, 'player', play);
    ok('V4a alt cost: the unit left the board', !(ap.units || []).some(x => x.id === 'u9'));
    ok('V4b …and its card is IN THE VOID, not lost', JSON.stringify(ids(ns.player.void)) === '["offering"]', JSON.stringify(ids(ns.player.void)));
  } catch (e) { ok('V4 ran', false, e.message); }

  // ── V5. a corpse the banished card stood for stops showing ────────────
  try {
    const gc = card('gob', 'Goblin', { type: 'unit', _summonedUnitId: 'dead1' });
    const corpse = { id: 'dead1', name: 'Goblin', owner: 'player', alive: false, currentHp: 0, cardId: 'gob' };
    const st = { turn: 'player', log: [], units: [corpse], player: side({ graveyard: [gc] }), ai: side() };
    const ns = _applyCostPayment(st, 'player', null, { banish: 1 }, { banishIdxs: [0] }).state;
    const view = (typeof _graveViewCards === 'function') ? _graveViewCards(ns, 'player') : null;
    ok('V5a the banished Goblin is in the Void', JSON.stringify(ids(ns.player.void)) === '["gob"]');
    ok('V5b …and does NOT reappear in the graveyard view via its corpse', Array.isArray(view) && view.length === 0,
       JSON.stringify((view || []).map(c => c && (c.name || c.id))));
  } catch (e) { ok('V5 ran', false, e.message); }

  // ── F. the counter flash ───────────────────────────────────────────────
  try {
    ok('F1 COUNTER_FLASH_MS is 4000', typeof COUNTER_FLASH_MS !== 'undefined' && COUNTER_FLASH_MS === 4000);
    App.ui = App.ui || {};
    App.ui.counterPrompt = null;
    App.ui.counterFlash = { name: 'Negate', icon: '🔵', cardId: null, at: Date.now() - 1500 };
    const html = (typeof renderCounterPrompt === 'function') ? renderCounterPrompt() : null;
    App.ui.counterFlash = null;
    ok('F2 the flash renders', typeof html === 'string' && html.indexOf('counter-flash') >= 0, html && html.slice(0, 80));
    ok('F3 …with a 4 s animation', /animation-duration:4000ms/.test(html || ''));
    ok('F4 …resumed at its elapsed time on re-render (not restarted)', /animation-delay:-1[45]\d\dms/.test(html || ''), (html || '').slice(0, 140));
  } catch (e) { ok('F ran', false, e.message); }
  return R;
});
await b.close();
let fails = 0;
for (const r of out) { if (!r.pass) fails++; console.log((r.pass ? '  ok   ' : '  FAIL ') + r.label + (r.pass ? '' : '   ← ' + r.detail)); }
if (errs.length) console.log('page errors: ' + errs.slice(0, 3).join(' | '));
console.log('\n' + (fails ? fails + ' FAILED' : 'ALL ' + out.length + ' PASS'));
process.exit(fails ? 1 : 0);
