/* ══════════════════════════════════════════════════════════════════════════
   AURA "ANOTHER X" PROBE (2026-09-19). Owner: "if the x unit(s) isn't on the
   field the aura protection ability do not work — For example If you control
   another x unit this unit cannot be destroyed, or damaged."
   The aura's own unit must never satisfy its own named-card condition. Drives
   the REAL _unitProtectedFrom and applyDamageTriggers:
     alone → not protected, takes damage;  with another copy → protected;
     the other copy dead → off;  an enemy copy (presenceSide ally) → off.
   Fails on the pre-fix page (the lone Bee was always protected).
   Usage: node .gauntlet/aura-another-probe.mjs <candidate.html>  (needs :8787)
   ══════════════════════════════════════════════════════════════════════════ */
import { chromium } from 'playwright';
import fs from 'node:fs';
const file = process.argv[2];
if (!file || !fs.existsSync(file)) { console.error('usage: aura-another-probe.mjs <candidate.html>'); process.exit(2); }
const html = fs.readFileSync(file, 'utf8');
const b = await chromium.launch(); const p = await b.newPage();
await p.route(/\/(index\.html)?(\?.*)?$/, r => { const u = new URL(r.request().url()); if (u.pathname === '/' || u.pathname === '/index.html') return r.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html }); return r.continue(); });
await p.goto('http://localhost:8787/index.html', { waitUntil: 'load', timeout: 60000 });
await p.waitForFunction(() => typeof _unitProtectedFrom === 'function', null, { timeout: 30000 });
const r = await p.evaluate(() => {
  const W = BOARD_W, H = BOARD_H, side = () => ({ deck: [], hand: [], graveyard: [], void: [] });
  const BEE = { id: 'au_bee', name: 'Bee Warrior', type: 'unit', cost: 2, stats: { hp: 20, atk: 5, def: 3, mag: 1, res: 1, spd: 2 }, learnset: [{ lvl: 1, m: 'slash' }],
    auras: [{ enabled: true, amount: 0, tSide: 'allies', radius: 0, protect: { damage: true, destroy: true }, cardIds: ['au_bee'], presenceSide: 'ally' }] };
  Forge.customCards = (Forge.customCards || []).filter(c => !/^au_/.test(c.id)).concat([BEE]);
  const U = (id, owner, x, y, extra) => Object.assign({ id, name: 'Bee Warrior', owner, alive: true, pos: { x, y }, currentHp: 20, maxHp: 20, stats: BEE.stats, cardId: 'au_bee', originalCardId: 'au_bee', statusEffects: [] }, extra || {});
  const mk = (units) => ({ player: side(), ai: side(), board: Array.from({ length: H }, (_, y) => Array.from({ length: W }, (_, x) => ({ x, y }))), units, turn: 'player', log: [] });
  const out = {};
  App.state = mk([U('b1', 'player', 3, 3)]);
  out.alone = _unitProtectedFrom(App.state.units[0], 'damage') || _unitProtectedFrom(App.state.units[0], 'destroy');
  App.state = mk([U('b1', 'player', 3, 3), U('b2', 'player', 5, 3)]);
  out.pair = _unitProtectedFrom(App.state.units[0], 'destroy') && _unitProtectedFrom(App.state.units[1], 'damage');
  App.state = mk([U('b1', 'player', 3, 3), U('b2', 'player', 5, 3, { alive: false })]);
  out.otherDead = _unitProtectedFrom(App.state.units[0], 'destroy');
  App.state = mk([U('b1', 'player', 3, 3), U('e1', 'ai', 5, 1)]);
  out.enemyCopy = _unitProtectedFrom(App.state.units[0], 'destroy');
  const hit = (units) => { App.state = mk(units); return applyDamageTriggers(App.state.units[0], 7, 'physical').unit.currentHp; };
  out.dmgAlone = hit([U('b1', 'player', 3, 3)]);
  out.dmgPaired = hit([U('b1', 'player', 3, 3), U('b2', 'player', 5, 3)]);
  App.state = null;
  return out;
});
await b.close();
const fails = [];
if (r.alone) fails.push('a lone unit is protected by its own aura');
if (!r.pair) fails.push('two copies do not protect each other');
if (r.otherDead) fails.push('protection stays on after the other copy dies');
if (r.enemyCopy) fails.push('an enemy copy satisfies "you control"');
if (r.dmgAlone !== 13 || r.dmgPaired !== 20) fails.push('damage path: alone ' + r.dmgAlone + ' (want 13), paired ' + r.dmgPaired + ' (want 20)');
console.log(JSON.stringify({ ok: !fails.length, fails, result: r }, null, 1));
process.exit(fails.length ? 1 : 0);
