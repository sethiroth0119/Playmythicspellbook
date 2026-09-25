/* Raise from Grave / deploy-from-zone must land on a FREE tile, and honour a
   "cost at most 4" filter. Both call sites passed (state, hero) to
   getValidPlacementTiles(card, hero, state), so occupied tiles were never
   excluded. Drives the real _applyOnPlayOneRaw(reviveGrave) and
   _deploySelfFromZone with every tile around the hero but one occupied.
   Usage: node .gauntlet/raise-tile-probe.mjs [candidate.html]   (:8787 up) */
import { chromium } from 'playwright';
import fs from 'node:fs';
const b = await chromium.launch();
const p = await b.newPage();
if (process.argv[2]) {
  const html = fs.readFileSync(process.argv[2], 'utf8');
  await p.route('**/index.html', (r) => r.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html }));
}
await p.goto('http://localhost:8787/index.html', { waitUntil: 'load', timeout: 60000 });
await p.waitForFunction(() => typeof window._applyOnPlayOneRaw === 'function' && typeof window._deploySelfFromZone === 'function');
const out = await p.evaluate(() => {
  const R = []; const ok = (l, c, d) => R.push({ l, c: !!c, d: String(d) });
  const board = () => Array.from({ length: 10 }, () => Array.from({ length: 10 }, () => ({ terrain: 'grass' })));
  const hero = { id: 'h', name: 'Hero', owner: 'player', isHero: true, alive: true, currentHp: 50, maxHp: 50, pos: { x: 5, y: 5 }, statusEffects: [] };
  const mk = (id, x, y) => ({ id, name: id, owner: 'player', alive: true, currentHp: 10, maxHp: 10, pos: { x, y }, statusEffects: [] });
  // occupy every tile within 1 of the hero except (6,6)
  const blockers = [];
  for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
    if (!dx && !dy) continue; if (dx === 1 && dy === 1) continue;
    blockers.push(mk('b' + dx + dy, 5 + dx, 5 + dy));
  }
  const unitCard = (id, cost) => ({ id, name: id, type: 'unit', cost, instanceId: 'i_' + id, stats: { hp: 10, atk: 1, def: 1, mag: 0, res: 0, spd: 1 }, hp: 10 });
  const side = (o) => Object.assign({ hand: [], deck: [], graveyard: [], void: [], energy: 5 }, o);
  const st = (grave) => ({ turn: 'player', log: [], units: [hero, ...blockers], board: board(), player: side({ graveyard: grave }), ai: side() });
  const occupiedBy = (s, u) => (s.units || []).filter(x => x !== u && x.alive && x.pos && u.pos && x.pos.x === u.pos.x && x.pos.y === u.pos.y);
  // 1. reviveGrave with cost <= 4
  try {
    const s0 = st([unitCard('big6', 6), unitCard('small3', 3)]);
    const eff = { type: 'reviveGrave', filter: { costMode: 'max', cost: 4 } };
    const s1 = _applyOnPlayOneRaw(s0, hero, { id: 'rv', name: 'Raiser', type: 'spell', onPlay: eff });
    const nu = (s1.units || []).find(u => u && !u.isHero && !blockers.some(bb => bb.id === u.id));
    ok('R1 raise: a unit came back', !!nu, JSON.stringify((s1.log || []).slice(-2).map(l => l.msg)));
    ok('R2 …the cost-3 one, not the cost-6 one (filter at most 4)', nu && /small3/.test(nu.name + nu.cardId), nu && nu.name);
    ok('R3 …on the one free tile, not on top of a unit', nu && occupiedBy(s1, nu).length === 0, nu && JSON.stringify(nu.pos));
  } catch (e) { ok('R ran', false, e.message); }
  // 2. deploy-from-zone
  try {
    const card = unitCard('dz', 2);
    const s0 = st([card]);
    const s1 = _deploySelfFromZone(s0, 'player', card);
    const nu = s1 && (s1.units || []).find(u => u && !u.isHero && !blockers.some(bb => bb.id === u.id));
    ok('D1 deploy-from-grave placed the unit', !!nu);
    ok('D2 …on a free tile', nu && occupiedBy(s1, nu).length === 0, nu && JSON.stringify(nu.pos));
  } catch (e) { ok('D ran', false, e.message); }
  return R;
});
await b.close();
let f = 0;
for (const r of out) { if (!r.c) f++; console.log((r.c ? '  ok   ' : '  FAIL ') + r.l + (r.c ? '' : '  ← ' + r.d)); }
console.log(f ? f + ' FAILED' : 'ALL ' + out.length + ' PASS');
process.exit(f ? 1 : 0);
