/* ══════════════════════════════════════════════════════════════════════════
   ZERO-COST PROBE — an admin can set a move's (and a card's) cost to 0, the 0
   survives save -> reload -> publish, and the engine treats it as free.

   Owner: "Make it where we can set the cost of cards, moves etc. to 0 — right
   now I cannot." (Forge move list showed Quick Jab at "cost 1" — the shipped
   Quick Jab is cost 0; opening it in the move editor and saving raised it.)

   Driven against the REAL page functions (the page sits on a sign-in gate):
     E. move editor  renderMoveEditor + bindMoveEditor + the real Save click,
        for a NEW forged move, an untouched 0-cost built-in (quickJab), a
        cost-2 built-in lowered to 0, and range/crit 0 on the same form.
     P. persistence  reload the page; Forge.customMoves comes back from local
        storage with the 0s intact.
     C. publish      a player (empty Forge.customMoves) receives an OVERRIDE of
        a built-in through _applyCatalogRow — lookupMove must return the
        published override, not the shipped MOVES entry.
     G. engine       getEffectiveMoveCost / executeMove with a 0-cost move at 0
        energy; the Overwatch quick action (renderActionPanel gate + label and
        the bindBattleEvents click handler).
     K. card editor  captureEditorIntoCard keeps cost 0 (regression guard).

   Usage: node .gauntlet/zerocost-probe.mjs [candidate.html]   (:8787 up)
   Exit 0 all pass, 1 any fail.
   ══════════════════════════════════════════════════════════════════════════ */
import { chromium } from 'playwright';
import fs from 'node:fs';

const b = await chromium.launch();
/* serviceWorkers:'block' — REQUIRED. The probe reloads the page (phase P), and on
   the second navigation sw.js controls it and answers index.html from its own
   cache, which page.route never sees: every phase after the reload silently ran
   the SERVED file, not the candidate. */
const ctx = await b.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block' });
const p = await ctx.newPage();
const errs = []; p.on('pageerror', e => errs.push(String(e.message || e)));
if (process.argv[2]) {
  const html = fs.readFileSync(process.argv[2], 'utf8');
  await p.route('**/index.html', (r) => r.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html }));
}
const boot = async () => {
  await p.goto('http://localhost:8787/index.html', { waitUntil: 'load', timeout: 60000 });
  await p.waitForFunction(() => typeof renderMoveEditor === 'function' && typeof bindMoveEditor === 'function'
    && typeof executeMove === 'function' && typeof saveForge === 'function', null, { timeout: 60000 });
  // let the boot-time forge load (localStorage + IDB merge) settle
  await p.waitForTimeout(2500);
};
await boot();

/* ── E. the move editor, driven through its real Save button ─────────────── */
const E = await p.evaluate(() => {
  const R = [];
  const ok = (label, cond, detail) => R.push({ label, pass: !!cond, detail: detail == null ? '' : String(detail) });
  try { render = () => {}; } catch (e) {}
  try { addAccountXp = () => {}; } catch (e) {}
  // local save only: no cloud push from a probe
  try { _persistForgeNow = () => saveForge(); } catch (e) {}
  const host = document.createElement('div'); host.id = 'zc-host'; document.body.appendChild(host);
  const $ = (id) => document.getElementById(id);
  const edit = (id, fields) => {
    App.editingMoveId = id;
    host.innerHTML = renderMoveEditor();
    bindMoveEditor();
    const inp = $('mv-cost');
    const info = { min: inp && inp.getAttribute('min'), label: inp && inp.parentElement ? inp.parentElement.textContent.trim() : '' };
    for (const k in fields) { const el = $(k); if (el) el.value = String(fields[k]); }
    let newId = null;
    if (id === 'NEW') {
      const before = new Set(Object.keys(Forge.customMoves || {}));
      $('btn-save-move').click();
      newId = Object.keys(Forge.customMoves || {}).find(k => !before.has(k)) || null;
    } else $('btn-save-move').click();
    host.innerHTML = '';
    return { info, saved: (Forge.customMoves || {})[newId || id] || null, id: newId || id };
  };

  Forge.customMoves = Forge.customMoves || {};
  // E1 — a NEW forged move typed to cost 0
  try {
    const r = edit('NEW', { 'mv-name': 'ZC Free Jab', 'mv-cost': 0 });
    ok('E1a the Energy Cost input allows 0 (min attribute)', r.info.min === '0', 'min=' + r.info.min + ' label="' + r.info.label + '"');
    ok('E1b a NEW move saved at cost 0 is stored as 0', r.saved && r.saved.cost === 0, r.saved && r.saved.cost);
    localStorage.setItem('zc_new_id', r.id);
  } catch (e) { ok('E1 ran', false, e.message); }

  // E2 — open the shipped 0-cost Quick Jab and save it untouched
  try {
    delete Forge.customMoves.quickJab;
    ok('E2a precondition: built-in quickJab ships at cost 0', MOVES.quickJab && MOVES.quickJab.cost === 0, MOVES.quickJab && MOVES.quickJab.cost);
    const r = edit('quickJab', {});
    ok('E2b opening built-in Quick Jab and saving (no edits) keeps cost 0', r.saved && r.saved.cost === 0, r.saved && r.saved.cost);
  } catch (e) { ok('E2 ran', false, e.message); }

  // E3 — a cost-2 built-in lowered to 0 (an OVERRIDE)
  try {
    const bid = Object.keys(MOVES).find(k => MOVES[k] && MOVES[k].kind === 'attack' && MOVES[k].cost === 2 && k !== 'quickJab');
    delete Forge.customMoves[bid];
    const r = edit(bid, { 'mv-cost': 0 });
    ok('E3 overriding built-in "' + bid + '" (cost 2) down to cost 0 saves 0', r.saved && r.saved.cost === 0, r.saved && r.saved.cost);
    localStorage.setItem('zc_override_id', bid);
  } catch (e) { ok('E3 ran', false, e.message); }

  // E4 — range 0 and crit 0 are both inside the form's own min/max
  try {
    const sid = Object.keys(MOVES).find(k => MOVES[k] && MOVES[k].range === 0 && MOVES[k].kind === 'ability');
    delete Forge.customMoves[sid];
    const r = edit(sid, {});
    ok('E4a re-saving range-0 built-in "' + sid + '" keeps range 0', r.saved && r.saved.range === 0, r.saved && r.saved.range);
    delete Forge.customMoves[sid];
    const r2 = edit('NEW', { 'mv-name': 'ZC NoCrit', 'mv-kind': 'attack', 'mv-crit': 0, 'mv-cost': 0 });
    ok('E4b an attack saved with Crit % = 0 keeps crit 0', r2.saved && r2.saved.crit === 0, r2.saved && r2.saved.crit);
    if (r2.id) delete Forge.customMoves[r2.id];
  } catch (e) { ok('E4 ran', false, e.message); }

  // E5 — the list row shows the real number
  try {
    const html = renderForgeMoves();
    ok('E5 Forge move list shows Quick Jab as "cost 0"', /Quick Jab[\s\S]{0,900}?cost 0 ·/.test(html));
  } catch (e) { ok('E5 ran', false, e.message); }
  try { saveForge(); } catch (e) {}
  return R;
});

/* ── P. reload: the 0s come back from local storage ──────────────────────── */
await boot();
const P = await p.evaluate(() => {
  const R = [];
  const ok = (label, cond, detail) => R.push({ label, pass: !!cond, detail: detail == null ? '' : String(detail) });
  const nid = localStorage.getItem('zc_new_id'), oid = localStorage.getItem('zc_override_id');
  const cm = Forge.customMoves || {};
  ok('P1 after reload the forged move is still cost 0', cm[nid] && cm[nid].cost === 0, cm[nid] && cm[nid].cost);
  ok('P2 after reload the Quick Jab override is still cost 0', cm.quickJab && cm.quickJab.cost === 0, cm.quickJab && cm.quickJab.cost);
  ok('P3 after reload the ' + oid + ' override is still cost 0', cm[oid] && cm[oid].cost === 0, cm[oid] && cm[oid].cost);
  ok('P4 lookupMove(' + oid + ') resolves the override (cost 0)', lookupMove(oid) && lookupMove(oid).cost === 0, lookupMove(oid) && lookupMove(oid).cost);
  return R;
});

/* ── C, G, K ─────────────────────────────────────────────────────────────── */
const G = await p.evaluate(() => {
  const R = [];
  const ok = (label, cond, detail) => R.push({ label, pass: !!cond, detail: detail == null ? '' : String(detail) });
  try { render = () => {}; } catch (e) {}
  try { renderBattle = () => {}; } catch (e) {}
  try { checkPostAction = () => {}; } catch (e) {}
  try { playAbilityCinematic = () => {}; } catch (e) {}
  const oid = localStorage.getItem('zc_override_id');

  // C — the publish path, seen from a PLAYER (no local Forge moves)
  try {
    const published = JSON.parse(JSON.stringify(Forge.customMoves || {}));
    Forge.customMoves = {};
    let how = '_applyCatalogRow';
    try { _applyCatalogRow({ cards: (Catalog.cards || []), moves: published, items: [], packs: [] }); }
    catch (e) { how = 'direct (apply threw: ' + e.message + ')'; Catalog.moves = published; }
    ok('C1 the published row carries the override at cost 0', Catalog.moves[oid] && Catalog.moves[oid].cost === 0, how);
    const m = lookupMove(oid);
    const src = !m ? 'null' : m === (Forge.customMoves || {})[oid] ? 'Forge.customMoves' : m === Catalog.moves[oid] ? 'Catalog.moves' : m === MOVES[oid] ? 'MOVES' : 'other';
    ok('C2 a player\'s lookupMove(' + oid + ') gets the PUBLISHED override (cost 0), not the shipped cost ' + MOVES[oid].cost, m && m.cost === 0, (m && m.cost) + ' from ' + src + ' (Forge keys ' + Object.keys(Forge.customMoves || {}).length + ')');
    const all = allMovesArray().find(x => x.id === oid);
    ok('C3 lookupMove and allMovesArray agree for a player', all && m && all.cost === m.cost, (all && all.cost) + ' vs ' + (m && m.cost));
    Forge.customMoves = published;
  } catch (e) { ok('C ran', false, e.message); }

  // G — engine
  const W = BOARD_W, H = BOARD_H;
  const board = () => Array.from({ length: H }, (_, y) => Array.from({ length: W }, (_, x) => ({ x, y, terrain: 'plain' })));
  const side = (en) => ({ deck: [], hand: [], graveyard: [], void: [], energy: en, maxEnergy: 9, hp: 30 });
  const stats = { atk: 20, def: 10, mag: 20, res: 10, spd: 1, hp: 100 };
  const mkS = (en, known) => ({ player: side(en), ai: side(5), board: board(), turn: 'player', turnNumber: 3, round: 2, gameOver: false, log: [],
    units: [ { id: 'h_p', name: 'Hero', owner: 'player', isHero: true, alive: true, pos: { x: 3, y: 8 }, currentHp: 300, maxHp: 300, stats, elements: ['light'] },
             { id: 'u_me', name: 'Watcher', owner: 'player', alive: true, pos: { x: 3, y: 5 }, currentHp: 50, maxHp: 50, stats, elements: ['earth'], statusEffects: [], knownMoves: known || ['ambushGuardShort'], hasMoved: false, hasAttacked: false, level: 5, passive: 'none' },
             { id: 'u_foe', name: 'Target', owner: 'ai', alive: true, pos: { x: 3, y: 4 }, currentHp: 500, maxHp: 500, stats, elements: ['water'], statusEffects: [], level: 5, passive: 'none' },
             { id: 'h_a', name: 'AI Hero', owner: 'ai', isHero: true, alive: true, pos: { x: 3, y: 0 }, currentHp: 300, maxHp: 300, stats, elements: ['shadow'] } ] });
  try {
    ok('G1 getEffectiveMoveCost of a cost-0 move is 0', getEffectiveMoveCost({ cost: 0, kind: 'attack' }, null, null) === 0);
    const free = { id: 'zcFree', name: 'Free Hit', kind: 'attack', type: 'physical', power: 30, range: 1, cost: 0, element: 'neutral', accuracy: 100, crit: 0 };
    const rnd = Math.random; Math.random = () => 0.5;
    let st = mkS(0);
    st = executeMove(st, st.units[1], st.units[2], free);
    Math.random = rnd;
    const foe = st.units.find(u => u.id === 'u_foe');
    ok('G2 executeMove: a cost-0 attack at 0 energy leaves energy at 0', st.player.energy === 0, st.player.energy);
    ok('G3 …and it resolved (the target took damage)', foe && foe.currentHp < 500, foe && foe.currentHp);
  } catch (e) { ok('G2 ran', false, e.message); }

  // G4 — Overwatch: executeMove already pays; the quick action must not pay again,
  // and must never charge 1 for a 0-cost Ambush Guard.
  const owRun = (moveCost, energy) => {
    const saved = Forge.customMoves.ambushGuardShort;
    Forge.customMoves.ambushGuardShort = Object.assign(JSON.parse(JSON.stringify(MOVES.ambushGuardShort)), { cost: moveCost });
    try {
      App.state = mkS(energy);
      App.ui = App.ui || {};
      App.ui.selectedUnitId = 'u_me'; App.ui.actionMode = null; App.ui.selectedMoveId = null;
      let panel = '';
      try { panel = renderActionPanel() || ''; } catch (e) { panel = 'ERR ' + e.message; }
      const m = /OVERWATCH \((\d+)/.exec(panel);
      const shown = m ? +m[1] : null;
      // drive the real click handler
      const btn = document.createElement('button'); btn.id = 'btn-quick-overwatch'; btn.dataset.ambushId = 'ambushGuardShort';
      document.body.appendChild(btn);
      let bindErr = '';
      try { bindBattleEvents(); } catch (e) { bindErr = e.message; }
      let after = null, stance = false;
      if (typeof btn.onclick === 'function') {
        btn.onclick();
        after = App.state && App.state.player ? App.state.player.energy : null;
        const me = App.state && (App.state.units || []).find(u => u.id === 'u_me');
        stance = !!(me && (me.statusEffects || []).some(e => e && e.type === 'ambushGuard1'));
      }
      btn.remove();
      return { shown, after, stance, bindErr, panelErr: panel.indexOf('ERR ') === 0 ? panel : '' };
    } finally {
      if (saved) Forge.customMoves.ambushGuardShort = saved; else delete Forge.customMoves.ambushGuardShort;
    }
  };
  try {
    const z = owRun(0, 0);
    ok('G4a Overwatch button is offered at 0 energy for a 0-cost Ambush Guard, labelled (0)', z.shown === 0, JSON.stringify(z));
    ok('G4b …and clicking it at 0 energy enters the watch stance, energy stays 0', z.stance && z.after === 0, JSON.stringify(z));
    const one = owRun(1, 3);
    ok('G5 a cost-1 Ambush Guard via the Overwatch button costs 1, not 2 (3 -> 2)', one.stance && one.after === 2, JSON.stringify(one));
  } catch (e) { ok('G4 ran', false, e.message); }

  // K — card editor keeps cost 0 (fixed earlier; regression guard)
  try {
    const host = document.createElement('div'); host.innerHTML = '<input id="ed-cost" value="0">'; document.body.appendChild(host);
    const card = { id: 'zc_card', name: 'ZC', type: 'spell', cost: 3 };
    try { captureEditorIntoCard(card); } catch (e) {}
    host.remove();
    ok('K1 captureEditorIntoCard stores card cost 0', card.cost === 0, card.cost);
    ok('K2 getEffectiveCardCost of a 0-cost card is 0', getEffectiveCardCost({ id: 'x', type: 'spell', cost: 0 }, mkS(0), 'player') === 0);
  } catch (e) { ok('K ran', false, e.message); }
  return R;
});

await b.close();
const out = [...E, ...P, ...G];
let fails = 0;
for (const r of out) { if (!r.pass) fails++; console.log((r.pass ? '  ok   ' : '  FAIL ') + r.label + (r.pass ? '' : '   <- ' + r.detail)); }
if (errs.length) console.log('page errors (' + errs.length + '): ' + errs.slice(0, 3).join(' | '));
console.log('\n' + (fails ? fails + ' FAILED of ' + out.length : 'ALL ' + out.length + ' PASS'));
process.exit(fails ? 1 : 0);
