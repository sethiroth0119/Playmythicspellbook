/* ══════════════════════════════════════════════════════════════════════════
   TARGET-CLICK PROBE — does clicking a unit resolve a pending effect target?

   Owner: "Targeting is not working when clicking the target it do not do the
   effect it just click the details of the unit/hero".

   Drives the REAL flow in the loaded page: a targeted Destroy Target resolves
   through applyOnPlayEffect (which defers it into _pendingTargets),
   _startTargetingIfPending arms App.ui.targeting, and then the click is made
   exactly the way the 3D board makes it — board:tileClick carries the unit, so
   the host calls onUnitClick(unitId).
     PASS = the enemy is destroyed and no details panel opened.
   Also: with NO targeting pending, the same click still opens details.

   Usage: node .gauntlet/targetclick-probe.mjs [candidate.html]   (:8787 up)
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
await p.waitForFunction(() => typeof window.onUnitClick === 'function' && typeof window._startTargetingIfPending === 'function');

const out = await p.evaluate(() => {
  const R = [];
  const ok = (label, cond, detail) => R.push({ label, pass: !!cond, detail: detail == null ? '' : String(detail) });
  const unit = (o) => Object.assign({ alive: true, currentHp: 20, maxHp: 20, level: 1, statusEffects: [],
    stats: { hp: 20, atk: 5, def: 5, mag: 5, res: 5, spd: 1 }, atk: 5, def: 5, mag: 5, res: 5, spd: 1,
    hasMoved: false, hasAttacked: false }, o);
  const side = () => ({ hand: [], deck: [], graveyard: [], void: [], energy: 5, maxEnergy: 5 });
  const fresh = () => ({
    turn: 'player', turnNumber: 2, phase: 'setup', log: [], timeOfDay: 'day', player: side(), ai: side(),
    units: [
      unit({ id: 'PH', name: 'Hero', owner: 'player', isHero: true, heroId: 'h1', pos: { x: 2, y: 2 } }),
      unit({ id: 'EH', name: 'Foe Hero', owner: 'ai', isHero: true, heroId: 'h2', pos: { x: 9, y: 9 } }),
      unit({ id: 'G1', name: 'Goblin', owner: 'ai', cardId: 'goblin', pos: { x: 4, y: 3 } }),
      unit({ id: 'G2', name: 'Orc', owner: 'ai', cardId: 'orc', pos: { x: 6, y: 5 } }),
    ],
  });
  const reset = () => {
    App.ui = App.ui || {};
    App.ui.targeting = null; App.ui.fusionPlace = null; App.ui.skillTargeting = null;
    App.ui.consumableTargeting = null; App.ui.sacrificeTargeting = null;
    App.ui.selectedCardId = null; App.ui.selectedUnitId = null; App.ui.selectedMoveId = null;
    App.ui.modalUnitId = null; App.ui.actionMode = null; App.ui.aiBusy = false;
  };
  const alive = (id) => { const u = (App.state.units || []).find(x => x && x.id === id); return !!(u && u.alive); };

  // ── 1. a targeted Destroy, picked by clicking the unit ──────────────────
  try {
    reset();
    App.state = fresh();
    const hero = App.state.units.find(u => u.id === 'PH');
    const card = { id: 'c_cull', name: 'Culling', type: 'spell', onPlay: { type: 'destroyTarget', radius: 99, targeted: true } };
    App.state = applyOnPlayEffect(App.state, hero, card);
    ok('1a the targeted effect deferred for a pick', Array.isArray(App.state._pendingTargets) && App.state._pendingTargets.length === 1,
       JSON.stringify((App.state._pendingTargets || []).length));
    _startTargetingIfPending();
    ok('1b targeting is armed', !!(App.ui.targeting && App.ui.targeting.queue && App.ui.targeting.queue.length));
    ok('1c both enemies still alive before the click', alive('G1') && alive('G2'));
    onUnitClick('G2');                         // exactly what board:tileClick with a unitId does
    ok('1d 🎯 clicking the Orc DESTROYED it', !alive('G2'), 'Orc alive: ' + alive('G2'));
    ok('1e …and not the other enemy', alive('G1'));
    ok('1f …and did NOT open its details panel', App.ui.modalUnitId !== 'G2', 'modalUnitId=' + App.ui.modalUnitId);
    ok('1g targeting is finished', !App.ui.targeting);
  } catch (e) { ok('1 ran', false, e.message); }

  // ── 2. with nothing pending, a click still means "show me this unit" ────
  try {
    reset();
    App.state = fresh();
    onUnitClick('G1');
    ok('2a no pending choice → the click opens details, as before', App.ui.modalUnitId === 'G1', 'modalUnitId=' + App.ui.modalUnitId);
    ok('2b …and destroys nothing', alive('G1'));
  } catch (e) { ok('2 ran', false, e.message); }

  // ── 3. every choice mode is forwarded (a spy on onTileClick) ────────────
  try {
    const real = window.onTileClick;
    for (const mode of ['targeting', 'fusionPlace', 'skillTargeting', 'consumableTargeting', 'sacrificeTargeting']) {
      reset();
      App.state = fresh();
      let got = null;
      window.onTileClick = (x, y) => { got = [x, y]; };
      App.ui[mode] = { probe: true, queue: [], idx: 0 };
      try { onUnitClick('G1'); } finally { window.onTileClick = real; }
      ok('3 ' + mode + ' → the click goes to the tile the unit stands on', got && got[0] === 4 && got[1] === 3, JSON.stringify(got));
    }
  } catch (e) { ok('3 ran', false, e.message); }

  // ── 4. range still means range when the effect is NOT global ────────────
  try {
    reset();
    App.state = fresh();
    App.state.units.push(unit({ id: 'FAR', name: 'Far Imp', owner: 'ai', cardId: 'imp', pos: { x: 12, y: 12 } }));
    const hero = App.state.units.find(u => u.id === 'PH');
    App.state = applyOnPlayEffect(App.state, hero, { id: 'c_near', name: 'Short Reach', type: 'spell',
      onPlay: { type: 'destroyTarget', radius: 2, targeted: true } });
    _startTargetingIfPending();
    onUnitClick('FAR');
    ok('4a a radius-2 effect cannot destroy a unit 10 tiles away', alive('FAR'));
    ok('4b …and does not redirect onto a nearer enemy either', alive('G1') && alive('G2'));
  } catch (e) { ok('4 ran', false, e.message); }

  // ── 5. a pin that is not a legal target fizzles — it never becomes another unit
  try {
    reset();
    App.state = fresh();
    const hero = App.state.units.find(u => u.id === 'PH');
    const s2 = applyOnPlayEffect(App.state, hero, { id: 'c_pin', name: 'Pinned', type: 'spell',
      onPlay: { type: 'destroyTarget', radius: 99, _targetId: 'EH' } });   // the enemy HERO — never destroyable here
    const live = (id) => { const u = (s2.units || []).find(x => x && x.id === id); return !!(u && u.alive); };
    ok('5a a pin on an illegal unit destroys NOTHING', live('G1') && live('G2') && live('EH'));
    ok('5b …and says so in the log', /no longer in reach/.test(JSON.stringify(s2.log || [])));
    const s3 = applyOnPlayEffect(App.state, hero, { id: 'c_auto', name: 'Auto', type: 'spell',
      onPlay: { type: 'destroyTarget', radius: 99 } });
    const dead3 = (s3.units || []).filter(u => u && !u.alive).map(u => u.id);
    ok('5c with NO pin the effect still auto-picks one enemy unit', dead3.length === 1 && dead3[0] !== 'EH', JSON.stringify(dead3));
  } catch (e) { ok('5 ran', false, e.message); }

  reset();
  return R;
});
await b.close();
let fails = 0;
for (const r of out) { if (!r.pass) fails++; console.log((r.pass ? '  ok   ' : '  FAIL ') + r.label + (r.pass ? '' : '   ← ' + r.detail)); }
if (errs.length) console.log('page errors: ' + errs.slice(0, 3).join(' | '));
console.log('\n' + (fails ? fails + ' FAILED' : 'ALL ' + out.length + ' PASS'));
process.exit(fails ? 1 : 0);
