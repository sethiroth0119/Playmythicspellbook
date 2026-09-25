/* ══════════════════════════════════════════════════════════════════════════
   FOUR OWNER ASKS, ONE PROBE (all driven against the REAL page functions).
   A. "This unit attacks all count as X Element (make one for all of our
      elements)" — PASSIVES.strikeAs_<e>, applied in calculateDamage.
   B. "a Move that makes units/Hero Element into the element the move chooses,
      for each element, with cool names (Target or Global)" — MOVES.shift* /
      shiftAll*, resolved by executeMove.
   C. "Polycreation using materials from the graveyard … can also be a choice to
      not vanish the material", with a ONE-material fusion — _polyFuseFromSources.
   D. "deck size up to 80, minimum 40" — isPlayableDeckSize / addToDeck /
      _legalizeDeck.
   Usage: node .gauntlet/v177-features-probe.mjs <candidate.html> [--url base]
   Needs the `public` preview server (8787). Exit 0 / 1 / 2 (2 = not in file).
   ══════════════════════════════════════════════════════════════════════════ */
import { chromium } from 'playwright';
import fs from 'node:fs';
const file = process.argv[2];
if (!file || !fs.existsSync(file)) { console.error('usage: v177-features-probe.mjs <candidate.html>'); process.exit(2); }
const arg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : null; };
const BASE = arg('--url') || 'http://localhost:8787';
const html = fs.readFileSync(file, 'utf8');
if (!html.includes('STRIKE_AS_PREFIX') || !html.includes('const DECK_MAX = 80;') || !html.includes('POLY-KEEP')) {
  console.log(JSON.stringify({ ok: false, missing: 'one or more of the four features is not in this file' })); process.exit(2);
}
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(String(e && e.message || e)));
await page.route(/\/(index\.html)?(\?.*)?$/, (route) => {
  const u = new URL(route.request().url());
  if (u.pathname === '/' || u.pathname === '/index.html') return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html });
  return route.continue();
});
let R;
try {
  await page.goto(BASE + '/index.html', { waitUntil: 'load', timeout: 60000 });
  await page.waitForFunction(() => typeof calculateDamage === 'function' && typeof executeMove === 'function', null, { timeout: 30000 });
  R = await page.evaluate(() => {
    const out = {};
    try { renderBattle = () => {}; } catch (e) {}
    try { playAbilityCinematic = () => {}; } catch (e) {}
    const W = BOARD_W, H = BOARD_H;
    const board = () => Array.from({ length: H }, (_, y) => Array.from({ length: W }, (_, x) => ({ x, y, terrain: 'plain' })));
    const side = () => ({ deck: [], hand: [], graveyard: [], void: [], energy: 9, maxEnergy: 9, hp: 30 });

    /* ── A ── */
    out.A_count = ELEMENTS.filter(e => PASSIVES['strikeAs_' + e]).length;
    out.A_elems = ELEMENTS.length;
    const stats = { atk: 20, def: 10, mag: 20, res: 10, spd: 1, hp: 100 };
    const atkBase = { id: 'pa', name: 'Striker', owner: 'player', alive: true, pos: { x: 1, y: 1 }, currentHp: 100, maxHp: 100, stats, level: 10, elements: ['earth'], passive: 'none' };
    const def = { id: 'pd', name: 'Sapling', owner: 'ai', alive: true, pos: { x: 2, y: 1 }, currentHp: 500, maxHp: 500, stats, level: 10, elements: ['nature'], passive: 'none' };
    const move = { id: 'probeHit', name: 'Hit', kind: 'attack', type: 'physical', power: 40, range: 1, element: 'neutral', accuracy: 100 };
    const rnd = Math.random; Math.random = () => 0.5;
    let plain = null, forged = null;
    try {
      const r1 = calculateDamage(move, atkBase, def, null, {});
      const r2 = calculateDamage(move, { ...atkBase, passive: 'strikeAs_fire' }, def, null, {});
      plain = (r1 && (r1.damage != null ? r1.damage : r1.dmg)) ?? r1;
      forged = (r2 && (r2.damage != null ? r2.damage : r2.dmg)) ?? r2;
    } catch (e) { out.A_err = String(e); }
    Math.random = rnd;
    out.A_dmg = { plain, forged };
    out.A_resolver = typeof _strikeAsElement === 'function' ? _strikeAsElement({ passive: 'strikeAs_fire' }) : null;

    /* ── B ── */
    out.B_count = Object.keys(MOVES).filter(k => /^shift(All)?[A-Z]/.test(k) && MOVES[k].setElement).length;
    out.B_names = [MOVES.shiftFire && MOVES.shiftFire.name, MOVES.shiftAllFire && MOVES.shiftAllFire.name];
    const mkS = () => ({ player: side(), ai: side(), board: board(), turn: 'player', turnNumber: 2, round: 1, gameOver: false, log: [],
      units: [ { id: 'h_p', name: 'Hero', owner: 'player', isHero: true, alive: true, pos: { x: 3, y: 8 }, currentHp: 300, maxHp: 300, stats, elements: ['light'] },
               { id: 'u_me', name: 'Caster', owner: 'player', alive: true, pos: { x: 3, y: 6 }, currentHp: 50, maxHp: 50, stats, elements: ['earth'] },
               { id: 'u_foe', name: 'Target', owner: 'ai', alive: true, pos: { x: 3, y: 4 }, currentHp: 50, maxHp: 50, stats, elements: ['water'] },
               { id: 'h_a', name: 'AI Hero', owner: 'ai', isHero: true, alive: true, pos: { x: 3, y: 0 }, currentHp: 300, maxHp: 300, stats, elements: ['shadow'] } ] });
    let st = mkS();
    try {
      st = executeMove(st, st.units[1], st.units[2], MOVES.shiftFire);
      out.B_target = { foe: getElementsOf(st.units.find(u => u.id === 'u_foe')), me: getElementsOf(st.units.find(u => u.id === 'u_me')) };
    } catch (e) { out.B_err1 = String(e); }
    st = mkS();
    try {
      st = executeMove(st, st.units[1], null, MOVES.shiftAllStorm);
      out.B_global = st.units.map(u => getElementsOf(u)[0]);
    } catch (e) { out.B_err2 = String(e); }

    /* ── C ── one-material Kalon from the graveyard */
    const KAL = { id: 'pk_kalon', name: 'Lightning Paragon', type: 'unit', summonMethod: 'fusion', isKalon: true,
      stats: { hp: 60, atk: 20, def: 10, mag: 10, res: 10, spd: 1 }, fusionRequirements: [{ cardId: 'pk_sword' }], learnset: [{ lvl: 1, m: 'slash' }] };
    const SWORD = { id: 'pk_sword', name: 'Lightning Swordsman', type: 'unit', stats: { hp: 20, atk: 8, def: 4, mag: 2, res: 2, spd: 1 }, learnset: [{ lvl: 1, m: 'slash' }] };
    Forge.customCards = (Forge.customCards || []).filter(c => !/^pk_/.test(c.id)).concat([KAL, SWORD]);
    /* the Realm Deck rule is real game behaviour and not what C tests */
    try { _realmDeckAllows = () => true; } catch (e) {}
    const runPoly = (vanish) => {
      const s0 = mkS();
      s0.player.graveyard = [{ ...SWORD, instanceId: 'iid_sw' }];
      App.state = s0;
      const eff = { type: 'polycreate', summonCardId: 'pk_kalon', matSources: ['grave'], ...(vanish === false ? { vanishMaterials: false } : {}) };
      let r;
      try { r = _polyFuseFromSources(s0, s0.units[1], eff, 'player', []); } catch (e) { return { err: String(e) }; }
      return { kalon: (r.units || []).some(u => u.alive && /Paragon/.test(u.name || '')),
               grave: (r.player.graveyard || []).map(c => c.name), void: (r.player.void || []).map(c => c.name) };
    };
    out.C_vanish = runPoly(undefined);
    out.C_keep = runPoly(false);

    /* ── D ── */
    out.D_range = [39, 40, 60, 80, 81].map(n => isPlayableDeckSize(n));
    /* 40 distinct owned cards (the builder only takes cards you own, 3 copies each) */
    const DK = Array.from({ length: 40 }, (_, i) => ({ id: 'pd_' + i, name: 'Deck Card ' + i, type: 'unit', cost: 1,
      stats: { hp: 10, atk: 5, def: 5, mag: 1, res: 1, spd: 1 }, learnset: [{ lvl: 1, m: 'slash' }] }));
    Forge.customCards = (Forge.customCards || []).filter(c => !/^pd_/.test(c.id)).concat(DK);
    Profile.cardCollection = Profile.cardCollection || {};
    DK.forEach(c => { Profile.cardCollection[c.id] = 3; });
    let keys = []; const ids = DK.map(c => 'custom:' + c.id);
    for (let i = 0; i < 120; i++) keys = addToDeck(keys, ids[i % ids.length]);
    out.D_addStops = keys.length;
    const cards60 = Array.from({ length: 60 }, (_, i) => ({ ...DK[i % 40], instanceId: 'x' + i }));
    out.D_opp60 = _legalizeDeck(cards60, { opponentDeck: true }).length;
    out.D_ai60 = _legalizeDeck(cards60).length;
    return out;
  });
} catch (e) {
  console.error(JSON.stringify({ ok: false, error: String(e), pageErrors }));
  await browser.close(); process.exit(2);
}
await browser.close();
const f = [];
if (R.A_count !== R.A_elems || R.A_elems < 21) f.push('A one strikeAs passive per element');
if (R.A_resolver !== 'fire') f.push('A _strikeAsElement resolves the passive');
if (!(typeof R.A_dmg.forged === 'number' && typeof R.A_dmg.plain === 'number' && R.A_dmg.forged > R.A_dmg.plain)) f.push('A a fire-forged neutral hit on nature beats the plain hit');
if (R.B_count !== 2 * R.A_elems) f.push('B a targeted and a global move per element');
if (!(R.B_target && R.B_target.foe[0] === 'fire' && R.B_target.me[0] === 'earth')) f.push('B targeted: only the target becomes fire');
if (!(Array.isArray(R.B_global) && R.B_global.every(e => e === 'storm'))) f.push('B global: every unit and hero becomes storm');
if (!(R.C_vanish && R.C_vanish.kalon && R.C_vanish.void.includes('Lightning Swordsman') && !R.C_vanish.grave.includes('Lightning Swordsman'))) f.push('C default: one-material fusion from the grave, material vanished to the Void');
if (!(R.C_keep && R.C_keep.kalon && R.C_keep.grave.includes('Lightning Swordsman') && !R.C_keep.void.includes('Lightning Swordsman'))) f.push('C keep: the material stays in the graveyard');
if (JSON.stringify(R.D_range) !== JSON.stringify([false, true, true, true, false])) f.push('D 40–80 is playable, 39 and 81 are not');
if (R.D_addStops !== 80) f.push('D the builder stops at 80');
if (R.D_opp60 !== 60) f.push('D an opponent\'s 60-card deck keeps 60');
if (R.D_ai60 !== 40) f.push('D an AI deck is still 40');
console.log(JSON.stringify({ ok: !f.length, fails: f, result: R, pageErrors: pageErrors.slice(0, 5) }, null, 1));
process.exit(f.length ? 1 : 0);
