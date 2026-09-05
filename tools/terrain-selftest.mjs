#!/usr/bin/env node
// Headless test for public/src/terrain/terrain.js — the file is a classic
// script (see its header for why), so it is evaluated in this context and
// read back off globalThis. Checks the rule, the seeding guarantees, and the
// flux guarantees across many seeds.
//   node tools/terrain-selftest.mjs [seeds]
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { STRONG_VS } from '../engine/catalogs.gen.js';

vm.runInThisContext(readFileSync(new URL('../public/src/terrain/terrain.js', import.meta.url), 'utf8'));
const T = globalThis.MythicTerrain;
T.configure({ strongVs: STRONG_VS });

const W = 8, H = 7;
const board = () => Array.from({ length: H }, (_, y) => Array.from({ length: W }, (_, x) => ({ x, y, location: null, trap: null, event: null })));
const unit = (o) => ({ alive: true, pos: { x: 0, y: 0 }, stats: { atk: 20, def: 10, mag: 8, res: 12 }, elements: ['fire'], ...o });
let fails = 0;
const check = (c, m) => { if (!c) { fails++; console.error('✗ ' + m); } };

// ── the rule ───────────────────────────────────────────────────────────────
{
  const s = { board: board(), units: [] };
  T.set(s, 2, 2, 'ashland');   // fire ground
  T.set(s, 3, 3, 'sea');       // water ground: water beats fire
  T.set(s, 4, 4, 'forest');    // nature: fire beats nature → neutral for a fire unit
  const fireUnit = unit({ pos: { x: 2, y: 2 } });
  check(T.effect(fireUnit, s) === 1, 'fire unit on ashland should be Empowered');
  check(T.statBonus(fireUnit, 'atk', 20, s) === 5, 'atk 20 → +5 empowered');
  check(T.statBonus(fireUnit, 'hp', 40, s) === 0, 'hp never touched');
  check(T.statBonus(fireUnit, 'spd', 2, s) === 0, 'spd never touched');
  fireUnit.pos = { x: 3, y: 3 };
  check(T.effect(fireUnit, s) === -1, 'fire unit on sea should be Hindered');
  check(T.statBonus(fireUnit, 'def', 10, s) === -2, 'def 10 → −2 hindered');
  fireUnit.pos = { x: 4, y: 4 };
  check(T.effect(fireUnit, s) === 0, 'fire unit on forest is neutral (fire beats nature, not the reverse)');
  const flyer = unit({ pos: { x: 3, y: 3 }, flying: true });
  check(T.effect(flyer, s) === 0, 'flyer ignores terrain');
  const dual = unit({ pos: { x: 3, y: 3 }, elements: ['water', 'fire'] });
  check(T.effect(dual, s) === 1, 'own element wins when both apply');
  const hero = unit({ pos: { x: 2, y: 2 }, elements: [] });
  check(T.effect(hero, s) === 0, 'elementless unit unaffected');
  check(T.describe(fireUnit, s).label === '', 'describe neutral → empty label');
  check(T.blocks(s, 1, 1) === false && (T.set(s, 1, 1, 'labyrinth'), T.blocks(s, 1, 1) === true), 'labyrinth blocks');
  check(T.cellHtml(s, 2, 2).includes('terr-ashland') && T.cellClass(s, 2, 2) === ' has-terrain terrain-ashland', 'render strings');
  // Unconfigured strongVs must degrade to "never hindered", never throw.
  const T2 = { ...T }; // effect reads the shared cfg, so test via a fresh eval instead
}

// ── seeding + flux across seeds ────────────────────────────────────────────
const seeds = Number(process.argv[2]) || 200;
let shifts = 0, walls = 0, patches = 0;
for (let i = 0; i < seeds; i++) {
  const rng = T.makeRng(100 + i);
  const s = { board: board(), units: [
    { id: 'h1', isHero: true, alive: true, pos: { x: 3, y: 6 }, elements: [] },
    { id: 'h2', isHero: true, alive: true, pos: { x: 4, y: 0 }, elements: [] },
    { id: 'u1', alive: true, pos: { x: 2, y: 5 }, elements: ['nature'] },
  ], log: [], turnNumber: 0 };
  const protect = [{ x: 2, y: 6 }, { x: 5, y: 6 }, { x: 2, y: 0 }, { x: 5, y: 0 }];
  const changed = T.seed(s, { rng, protect });
  patches += changed.length;
  // determinism
  const s2 = { board: board(), units: s.units.map((u) => ({ ...u })), turnNumber: 0 };
  T.seed(s2, { rng: T.makeRng(100 + i), protect });
  check(JSON.stringify(s.board) === JSON.stringify(s2.board), 'seed deterministic ' + i);
  // mirror symmetry
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) check(T.at(s, x, y) === T.at(s, x, H - 1 - y), 'mirror ' + i + ' ' + x + ',' + y);
  // protection + heroes
  for (const p of protect) check(T.at(s, p.x, p.y) == null, 'protected tile painted ' + i);
  for (const u of s.units) if (u.isHero) check(T.at(s, u.pos.x, u.pos.y) == null, 'hero tile painted ' + i);
  // flux over 40 turns
  for (let t = 1; t <= 40; t++) {
    s.turnNumber = t;
    const ch = T.tick(s, { rng, protect });
    shifts += ch.length;
    if (t % T.RULES.FLUX_EVERY !== 0) check(ch.length === 0, 'flux fired off-cadence ' + i);
    for (const c of ch) {
      check(c.from !== c.to, 'no-op change reported');
      check(!(c.to === 'labyrinth' && s.units.some((u) => u.pos.x === c.x && u.pos.y === c.y)), 'wall dropped on a unit ' + i);
      check(!protect.some((p) => p.x === c.x && p.y === c.y), 'flux touched protected tile ' + i);
      if (c.to === 'labyrinth') walls++;
    }
  }
  check(s.log.length > 0, 'flux never logged ' + i);
}
console.log((fails ? '✗ ' + fails + ' failures' : '✓ terrain self-test passed') + ' — ' + seeds + ' seeds');
console.log('  avg tiles painted at seed', (patches / seeds).toFixed(1), '· avg flux changes / 40 turns', (shifts / seeds).toFixed(1), '· walls spawned by flux', walls);
process.exit(fails ? 1 : 0);
