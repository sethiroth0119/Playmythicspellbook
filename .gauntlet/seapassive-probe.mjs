/* ══════════════════════════════════════════════════════════════════════════
   🌊 SEA-TIDE PROBE — the four "standing in water" stat passives.

   Owner: "We need a passive for if a unit is under sea they gain a 50%, 25%,
   15%, 15 boost to a stat. Give me one for each."

     tidalFury   🌊 Tidal Fury    +50% ATK
     deepshell   🐚 Deepshell     +25% DEF
     currentSage 🌀 Current Sage  +15% MAG
     brinewarded 🧿 Brinewarded   +15% RES

   WHAT THIS DRIVES, AND WHY THAT WAY. The page sits on a sign-in gate, so
   there is no live battle to poke — and there does not need to be. The rule
   lives in getStatBonus, the effective-stat path calculateDamage reads on BOTH
   sides, and getStatBonus reads the board off App.state. So the probe builds a
   real App.state (a board with one painted Sea tile, two units) and calls the
   SHIPPED getStatBonus / calculateDamage directly. No rendering, no RAF — see
   CLAUDE.md on why anything that waits for a frame here is a coin flip.

   🔴 THE CONTROL IS THE WHOLE TEST. Each passive is measured twice with the
   SAME unit object and the same stats — once standing on the water tile and
   once on grass — because a bonus that is simply always on would sail through
   a water-only assertion. Every water reading is checked against its own dry
   reading, and a no-passive unit is checked in the water as the second control.

   Usage:  node .gauntlet/seapassive-probe.mjs [candidate.html]     (:8787 up)
   Expect: FAIL on HEAD (the passives do not exist), PASS on the candidate.
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
await p.goto('http://localhost:8787/index.html', { waitUntil: 'load', timeout: 90000 });
await p.waitForFunction(() => typeof getStatBonus === 'function' && typeof calculateDamage === 'function', null, { timeout: 60000 });

const out = await p.evaluate(() => {
  const R = [];
  const ok = (label, cond, detail) => R.push({ label, pass: !!cond, detail: detail == null ? '' : String(detail) });

  const SEA = { x: 2, y: 2 };     // the one water tile
  const DRY = { x: 5, y: 2 };     // the control tile — plain ground
  const STATS = { hp: 40, atk: 20, def: 20, mag: 20, res: 20, spd: 2 };

  /* A board the engine will accept. `surf: 'dirt'` on every tile is what makes
     the control honest: _terrainSurfAt's fast path tests `surf !== undefined`,
     so stamping every tile here stops it re-deriving the generated map (which
     could put water under the control tile and quietly delete the contrast). */
  function makeState() {
    const W = (typeof BOARD_W === 'number' ? BOARD_W : 14);
    const H = (typeof BOARD_H === 'number' ? BOARD_H : 12);
    const board = [];
    for (let y = 0; y < H; y++) {
      const row = [];
      for (let x = 0; x < W; x++) row.push({ x, y, location: null, trap: null, event: null, surf: 'dirt' });
      board.push(row);
    }
    return {
      turn: 'player', log: [], units: [], board,
      weather: null, persistentSpells: [], timeOfDay: 'day',
      player: { hand: [], deck: [], graveyard: [], void: [], energy: 9, maxEnergy: 9 },
      ai:     { hand: [], deck: [], graveyard: [], void: [], energy: 9, maxEnergy: 9 },
    };
  }
  function unit(id, owner, passives, pos) {
    return { id, name: id, owner, alive: true, isHero: false, hp: 40, currentHp: 40, maxHp: 40,
             pos: { x: pos.x, y: pos.y }, stats: Object.assign({}, STATS), passives: passives.slice(),
             statusEffects: [], stages: {}, elements: ['neutral'], factions: [] };
  }
  const prevState = App.state;
  const st = makeState();
  App.state = st;
  // A painted Sea on the one tile. _setSurface is the shipped writer; if it is
  // unavailable for any reason the ground key alone still makes the tile water.
  try { _setSurface(st, SEA.x, SEA.y, 'sea', 99); } catch (e) {}
  st.board[SEA.y][SEA.x].surf = 'water';

  // ── 0. the catalogue ──────────────────────────────────────────────────
  const WANT = [
    ['tidalFury',   'atk', 50],
    ['deepshell',   'def', 25],
    ['currentSage', 'mag', 15],
    ['brinewarded', 'res', 15],
  ];
  for (const [pid, stat, pct] of WANT) {
    const d = (typeof PASSIVES !== 'undefined' && PASSIVES) ? PASSIVES[pid] : null;
    ok('0 PASSIVES.' + pid + ' exists with a name', !!(d && d.name), d && d.name);
    ok('0 PASSIVES.' + pid + ' text states +' + pct + '% ' + stat.toUpperCase() + ' and water',
       !!(d && new RegExp('\\+' + pct + '%\\s*' + stat, 'i').test(d.desc || '') && /water/i.test(d.desc || '')),
       d && d.desc);
  }

  // ── 1. the tile question itself ───────────────────────────────────────
  try {
    ok('1a the sea tile reads as water', _terrainSurfAt(st, SEA.x, SEA.y) === 'water', _terrainSurfAt(st, SEA.x, SEA.y));
    ok('1b the control tile does NOT', _terrainSurfAt(st, DRY.x, DRY.y) !== 'water', _terrainSurfAt(st, DRY.x, DRY.y));
  } catch (e) { ok('1 tile read ran', false, e.message); }

  /* ── 2. each passive raises its OWN stat by the right amount, in water only.
         getStatBonus is the effective-stat path; measuring it directly is what
         proves the bonus lands in ONE place rather than four call sites. */
  const KEYS = ['atk', 'def', 'mag', 'res'];
  for (const [pid, stat, pct] of WANT) {
    try {
      const u = unit('u_' + pid, 'player', [pid], SEA);
      st.units = [u];
      const want = Math.round(STATS[stat] * pct / 100);

      const wet = {}, dry = {};
      for (const k of KEYS) { u.pos = { x: SEA.x, y: SEA.y }; wet[k] = getStatBonus(u, k); }
      for (const k of KEYS) { u.pos = { x: DRY.x, y: DRY.y }; dry[k] = getStatBonus(u, k); }

      ok('2 ' + pid + ': +' + pct + '% ' + stat.toUpperCase() + ' (=' + want + ') in water',
         wet[stat] - dry[stat] === want, 'wet ' + wet[stat] + ' dry ' + dry[stat]);
      ok('2 ' + pid + ': NOTHING on dry land',
         KEYS.every(k => dry[k] === 0), JSON.stringify(dry));
      ok('2 ' + pid + ': the other three stats are untouched in water',
         KEYS.filter(k => k !== stat).every(k => wet[k] === dry[k]), JSON.stringify(wet));
    } catch (e) { ok('2 ' + pid + ' ran', false, e.message); }
  }

  // ── 3. no effect for a unit WITHOUT the passive, standing in the same water
  try {
    const plain = unit('u_plain', 'player', [], SEA);
    st.units = [plain];
    ok('3 a unit with no passive gets nothing in water',
       KEYS.every(k => getStatBonus(plain, k) === 0),
       JSON.stringify(KEYS.map(k => getStatBonus(plain, k))));
  } catch (e) { ok('3 ran', false, e.message); }

  // ── 4. the four are INDEPENDENT — all on one unit, each stat once ──────
  try {
    const all = unit('u_all', 'player', WANT.map(w => w[0]), SEA);
    st.units = [all];
    for (const [pid, stat, pct] of WANT) {
      const want = Math.round(STATS[stat] * pct / 100);
      all.pos = { x: SEA.x, y: SEA.y }; const wet = getStatBonus(all, stat);
      all.pos = { x: DRY.x, y: DRY.y }; const dry = getStatBonus(all, stat);
      ok('4 all four on one unit: ' + stat.toUpperCase() + ' still exactly +' + want,
         wet - dry === want, 'wet ' + wet + ' dry ' + dry);
    }
  } catch (e) { ok('4 ran', false, e.message); }

  /* ── 5. it reaches the FIGHT. Attack damage (ATK), magic damage (MAG),
         and both mitigations (DEF / RES) measured through calculateDamage
         itself, water vs grass, with accuracy forced so no roll can miss. */
  /* `aiExpectedValue` is the engine's own DETERMINISTIC branch — it folds the
     hit chance and the crit chance into one expected number instead of rolling
     them (see `const _ev = !!(opts && opts.aiExpectedValue)`). That is exactly
     what an A/B needs: without it, a crit on one side of the pair and not the
     other would swamp a 15% stat change and the probe would flap. */
  function dmg(atkUnit, defUnit) {
    const move = { id: '_probe', name: 'Probe', kind: 'attack', type: 'physical', power: 40,
                   range: 9, cost: 0, element: 'neutral', accuracy: 100 };
    return calculateDamage(move, atkUnit, defUnit, null, { aiExpectedValue: true });
  }
  function magDmg(atkUnit, defUnit) {
    const move = { id: '_probeM', name: 'Probe M', kind: 'attack', type: 'magic', power: 40,
                   range: 9, cost: 0, element: 'neutral', accuracy: 100 };
    return calculateDamage(move, atkUnit, defUnit, null, { aiExpectedValue: true });
  }
  function num(r) { return (r && typeof r.damage === 'number') ? r.damage : (typeof r === 'number' ? r : NaN); }

  try {
    const atkr = unit('u_atk', 'player', ['tidalFury'], SEA);
    const targ = unit('u_targ', 'ai', [], DRY);
    st.units = [atkr, targ];
    atkr.pos = { x: SEA.x, y: SEA.y }; const wet = num(dmg(atkr, targ));
    atkr.pos = { x: DRY.x, y: DRY.y }; const dry = num(dmg(atkr, targ));
    ok('5a Tidal Fury: a physical hit does MORE damage from the water', wet > dry, 'wet ' + wet + ' dry ' + dry);
  } catch (e) { ok('5a ran', false, e.message); }

  try {
    const atkr = unit('u_mag', 'player', ['currentSage'], SEA);
    const targ = unit('u_targ2', 'ai', [], DRY);
    st.units = [atkr, targ];
    atkr.pos = { x: SEA.x, y: SEA.y }; const wet = num(magDmg(atkr, targ));
    atkr.pos = { x: DRY.x, y: DRY.y }; const dry = num(magDmg(atkr, targ));
    ok('5b Current Sage: a magic hit does MORE damage from the water', wet > dry, 'wet ' + wet + ' dry ' + dry);
  } catch (e) { ok('5b ran', false, e.message); }

  try {
    const atkr = unit('u_a3', 'player', [], DRY);
    const targ = unit('u_def', 'ai', ['deepshell'], SEA);
    st.units = [atkr, targ];
    targ.pos = { x: SEA.x, y: SEA.y }; const wet = num(dmg(atkr, targ));
    targ.pos = { x: DRY.x, y: DRY.y }; const dry = num(dmg(atkr, targ));
    ok('5c Deepshell: the same physical hit does LESS in the water', wet < dry, 'wet ' + wet + ' dry ' + dry);
  } catch (e) { ok('5c ran', false, e.message); }

  try {
    const atkr = unit('u_a4', 'player', [], DRY);
    const targ = unit('u_res', 'ai', ['brinewarded'], SEA);
    st.units = [atkr, targ];
    targ.pos = { x: SEA.x, y: SEA.y }; const wet = num(magDmg(atkr, targ));
    targ.pos = { x: DRY.x, y: DRY.y }; const dry = num(magDmg(atkr, targ));
    ok('5d Brinewarded: the same magic hit does LESS in the water', wet < dry, 'wet ' + wet + ' dry ' + dry);
  } catch (e) { ok('5d ran', false, e.message); }

  // ── 6. a painted Sea with NO water ground still counts ─────────────────
  try {
    const tx = 7, ty = 4;
    try { _setSurface(st, tx, ty, 'sea', 99); } catch (e) {}
    const u = unit('u_sea', 'player', ['tidalFury'], { x: tx, y: ty });
    st.units = [u];
    ok('6 a painted Sea tile counts even with dirt underneath',
       getStatBonus(u, 'atk') === Math.round(STATS.atk * 0.5), getStatBonus(u, 'atk'));
  } catch (e) { ok('6 ran', false, e.message); }

  /* ── 7. the Forge LISTS all four and SAVES each.
         buildPassiveOpts is a closure inside renderCardEditor, so the honest
         test of "the picker lists it" is the editor's own rendered markup.
         captureEditorIntoCard is the save half: it reads the live #ed-passive /
         #ed-passive2 <select> straight back onto the card object, which is what
         the Forge then persists. Driving both halves is what catches the case
         where an option renders but the id never survives a save. */
  const prevEditing = App.editingCardId, prevDraft = App._newCardDraft;
  try {
    const card = { id: 'probeCard', name: 'Probe Card', type: 'unit', cost: 2, rarity: 'common',
                   elements: ['water'], stats: { hp: 20, atk: 10, def: 10, mag: 10, res: 10, spd: 1 },
                   passive: 'none', passive2: 'none', moves: [], learnset: [] };
    App.editingCardId = 'NEW';
    App._newCardDraft = card;
    let html = '';
    try { html = renderCardEditor() || ''; } catch (e) { html = ''; ok('7 renderCardEditor ran', false, e.message); }

    for (const [pid] of WANT) {
      ok('7 Forge passive picker offers ' + pid, html.indexOf('value="' + pid + '"') >= 0);
    }

    // The ids must be live in the document for captureEditorIntoCard to see them.
    const host = document.createElement('div');
    host.style.cssText = 'position:absolute;left:-9999px;top:0;width:1200px;height:1px;overflow:hidden';
    host.innerHTML = html;
    document.body.appendChild(host);
    const sel = document.getElementById('ed-passive');
    if (!sel) {
      ok('7 the Forge passive <select> (#ed-passive) rendered', false, 'not found');
    } else {
      let savedAll = true, why = '';
      for (const [pid] of WANT) {
        sel.value = pid;
        if (sel.value !== pid) { savedAll = false; why = pid + ' is not an option on #ed-passive'; break; }
        try { captureEditorIntoCard(card); } catch (e) { savedAll = false; why = pid + ': ' + e.message; break; }
        if (card.passive !== pid) { savedAll = false; why = pid + ' did not survive the save (got ' + card.passive + ')'; break; }
      }
      ok('7 each of the four can be picked AND saved in the Forge editor', savedAll, why);
    }
    host.remove();
  } catch (e) { ok('7 ran', false, e.message); }
  App.editingCardId = prevEditing; App._newCardDraft = prevDraft;

  App.state = prevState;
  return R;
});
await b.close();
let fails = 0;
for (const r of out) { if (!r.pass) fails++; console.log((r.pass ? '  ok   ' : '  FAIL ') + r.label + (r.pass ? '' : '   ← ' + r.detail)); }
if (errs.length) console.log('page errors: ' + errs.slice(0, 3).join(' | '));
console.log('\n' + (fails ? fails + ' FAILED of ' + out.length : 'ALL ' + out.length + ' PASS'));
process.exit(fails ? 1 : 0);
