/* ══════════════════════════════════════════════════════════════════════════
   TRAP GRAVE-SUMMON PROBE — a set trap whose classic Effect Type is
   'summonGrave' (e.g. the owner's "Brain Eater") must raise a UNIT the player
   picks when they flip it themselves.

   Owner: "I just used a trap card that I flipped over myself to summon a unit
   from the graveyard it did not work it did not let me pick the unit I wanted
   to summon."

   Real reducers in the loaded page:
     A. _trapManualFlipAt (own turn, confirm stubbed yes) opens the grave picker
        (App.ui.deckSearch: source grave, dest field) offering the unit, never
        the trap itself; picking through _deckSearchSelect puts the unit on the
        board and takes it out of the graveyard.
     B. applyTrapToUnit off-turn (AI's turn) stays deterministic, opens no
        modal, and raises the newest UNIT — not the trap that was just buried.
     C. a graveyard holding nothing but the spent trap raises nothing.

   Usage: node .gauntlet/trap-gravesummon-probe.mjs [candidate.html]   (:8787 up)
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
await p.waitForFunction(() => typeof window._trapManualFlipAt === 'function' && typeof window.applyTrapToUnit === 'function');

const out = await p.evaluate(async () => {
  const R = [];
  const ok = (label, cond, detail) => R.push({ label, pass: !!cond, detail: detail == null ? '' : String(detail) });
  const ids = (arr) => (arr || []).map(c => c && c.id);

  const GHOUL = { id: 'probe_ghoul', name: 'Probe Ghoul', type: 'unit', cost: 2, icon: '🧟',
    stats: { hp: 20, atk: 10, def: 4, mag: 0, res: 2, spd: 2 }, hp: 20, elements: ['shadow'], factions: [],
    learnset: [{ lvl: 1, m: 'slash' }], passive: 'none' };
  const TRAP = { id: 'probe_brain_eater', name: 'Probe Brain Eater', type: 'trap', cost: 1, icon: '🧠',
    trapMode: 'flip', effect: { type: 'summonGrave', amount: 1 } };
  try { Forge.customCards = (Forge.customCards || []).filter(c => c && c.id !== GHOUL.id && c.id !== TRAP.id).concat([GHOUL, TRAP]); } catch (e) {}

  // Keep the UI side effects of the real click path inert: this page sits on a
  // sign-in gate, and the probe is about state, not pixels.
  window.showGameConfirm = async () => true;
  window.renderBattle = () => {};
  window.checkPostAction = () => {};
  window.playSfx = () => {};

  const side = (o) => Object.assign({ hand: [], deck: [], graveyard: [], void: [], energy: 5, maxEnergy: 5 }, o);
  const board = () => Array.from({ length: 8 }, () => Array.from({ length: 8 }, () => ({ terrain: 'grass' })));
  const hero = (owner, x, y) => ({ id: 'hero_' + owner, name: owner + ' hero', owner, isHero: true, alive: true,
    currentHp: 50, maxHp: 50, pos: { x, y }, statusEffects: [], stats: { atk: 5, def: 5, mag: 0, res: 0, spd: 2 } });
  const foe = () => ({ id: 'foe1', name: 'Foe', owner: 'ai', alive: true, currentHp: 20, maxHp: 20, pos: { x: 6, y: 6 },
    statusEffects: [], stats: { atk: 5, def: 5, mag: 0, res: 0, spd: 2 } });
  const mkState = (turn, grave) => {
    const bd = board();
    const rec = { card: Object.assign({ instanceId: 'i_trap' }, TRAP), owner: 'player', setTurn: 1 };
    bd[3][3] = Object.assign({}, bd[3][3], { trap: rec });
    return { turn, turnNumber: 3, log: [], units: [hero('player', 1, 1), hero('ai', 7, 7), foe()], board: bd,
      player: side({ graveyard: grave }), ai: side() };
  };

  // ── A. own-turn manual flip ─────────────────────────────────────────────
  try {
    App.ui = App.ui || {}; App.ui.deckSearch = null; App.ui.deckSearchQueue = [];
    App.state = mkState('player', [Object.assign({ instanceId: 'i_ghoul' }, GHOUL)]);
    const handled = await _trapManualFlipAt(3, 3);
    ok('A0 the flip was handled', handled === true, handled);
    ok('A1 the trap left the board', !(App.state.board[3][3] && App.state.board[3][3].trap));
    const ds = App.ui.deckSearch;
    ok('A2 a picker opened for the player', !!ds, JSON.stringify((App.state.log || []).slice(-3).map(l => l.msg)));
    ok('A3 …browsing the GRAVEYARD, summoning to the FIELD', ds && ds.source === 'grave' && ds.dest === 'field', ds && (ds.source + '/' + ds.dest));
    ok('A4 …offering the Ghoul and NOT the trap', ds && Array.isArray(ds.cardIds) && ds.cardIds.indexOf(GHOUL.id) >= 0 && ds.cardIds.indexOf(TRAP.id) < 0,
       ds && JSON.stringify(ds.cardIds));
    ok('A5 nothing was auto-summoned before the pick', !(App.state.units || []).some(u => u && !u.isHero && u.owner === 'player'),
       JSON.stringify((App.state.units || []).filter(u => !u.isHero && u.owner === 'player').map(u => u.name)));
    if (ds) {
      _deckSearchSelect('i_ghoul');
      const raised = (App.state.units || []).find(u => u && u.owner === 'player' && !u.isHero && u.alive);
      ok('A6 picking the Ghoul puts it on the board', raised && /Ghoul/.test(raised.name || ''), raised && raised.name);
      ok('A7 …and takes it out of the graveyard (the spent trap stays)', JSON.stringify(ids(App.state.player.graveyard)) === JSON.stringify([TRAP.id]),
         JSON.stringify(ids(App.state.player.graveyard)));
      ok('A8 the picker closed', !App.ui.deckSearch);
    }
  } catch (e) { ok('A ran', false, e.message); }

  // ── B. off-turn spring stays deterministic ──────────────────────────────
  try {
    App.ui.deckSearch = null; App.ui.deckSearchQueue = [];
    const st = mkState('ai', [Object.assign({ instanceId: 'i_ghoul' }, GHOUL)]);
    const ns = applyTrapToUnit(st, st.units.find(u => u.id === 'foe1'), st.board[3][3].trap);
    const raised = (ns.units || []).filter(u => u && u.owner === 'player' && !u.isHero);
    ok('B1 no modal opened off-turn', !App.ui.deckSearch);
    ok('B2 the Ghoul was raised (not the trap)', raised.length === 1 && /Ghoul/.test(raised[0].name || ''), JSON.stringify(raised.map(u => u.name)));
    ok('B3 graveyard now holds only the spent trap', JSON.stringify(ids(ns.player.graveyard)) === JSON.stringify([TRAP.id]), JSON.stringify(ids(ns.player.graveyard)));
  } catch (e) { ok('B ran', false, e.message); }

  // ── D. a raised card that stood for a corpse does not reappear in the grave view
  try {
    App.ui.deckSearch = null; App.ui.deckSearchQueue = [];
    const gc = Object.assign({ instanceId: 'i_ghoul2', _summonedUnitId: 'deadghoul' }, GHOUL);
    const st = mkState('player', [gc]);
    st.units.push({ id: 'deadghoul', name: GHOUL.name, owner: 'player', alive: false, currentHp: 0, cardId: GHOUL.id, pos: { x: 5, y: 5 } });
    App.state = st;
    await _trapManualFlipAt(3, 3);
    if (App.ui.deckSearch) _deckSearchSelect('i_ghoul2');
    const view = (typeof _graveViewCards === 'function') ? _graveViewCards(App.state, 'player') : null;
    ok('D1 the raised Ghoul is not shown in the graveyard view through its old corpse',
       Array.isArray(view) && !view.some(c => c && c.id === GHOUL.id), JSON.stringify((view || []).map(c => c && c.id)) + ' units=' + JSON.stringify((App.state.units || []).filter(u => u && !u.isHero).map(u => [u.id, u.alive, u.currentHp, u._graveCardTaken, u.owner])) + ' grave=' + JSON.stringify(ids(App.state.player.graveyard)));
  } catch (e) { ok('D ran', false, e.message); }

  // ── C. only the trap in the grave ───────────────────────────────────────
  try {
    App.ui.deckSearch = null; App.ui.deckSearchQueue = [];
    const st = mkState('ai', []);
    const ns = applyTrapToUnit(st, st.units.find(u => u.id === 'foe1'), st.board[3][3].trap);
    const raised = (ns.units || []).filter(u => u && u.owner === 'player' && !u.isHero);
    ok('C1 nothing is raised when the grave has no unit', raised.length === 0, JSON.stringify(raised.map(u => u.name)));
    ok('C2 the spent trap stays in the graveyard', JSON.stringify(ids(ns.player.graveyard)) === JSON.stringify([TRAP.id]), JSON.stringify(ids(ns.player.graveyard)));
  } catch (e) { ok('C ran', false, e.message); }
  return R;
});
await b.close();
let fails = 0;
for (const r of out) { if (!r.pass) fails++; console.log((r.pass ? '  ok   ' : '  FAIL ') + r.label + (r.pass ? '' : '   <- ' + r.detail)); }
if (errs.length) console.log('page errors: ' + errs.slice(0, 3).join(' | '));
console.log('\n' + (fails ? fails + ' FAILED' : 'ALL ' + out.length + ' PASS'));
process.exit(fails ? 1 : 0);
