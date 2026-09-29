#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// damage-golden.mjs — locks the server's calculateDamage to the CLIENT's damage
// formula. Each case is fully DETERMINISTIC (accuracy 100 → no miss roll, crit 0
// → no crit roll, no dodge statuses), so the result is pure formula math with no
// RNG. Expected values are derived step-by-step from the formula in
// public/index.html:
//
//   dmg = max(1, floor((power * atkStat) / (max(1, defStat) * 4)) + 2)
//   then × typeMul (element chart) × weather × STAB(1.5)
//
// If the server's formula ever diverges from the client's, a case fails.
//   npm run build && node test/damage-golden.mjs
// ─────────────────────────────────────────────────────────────────────────────
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const { calculateDamage } = require(join(__dirname, '..', 'dist', 'engine', 'damage.js'));

const unit = (over) => ({
  id: 'u', currentHp: 100, maxHp: 100,
  atk: 10, def: 10, mag: 10, res: 10, spd: 10,
  isHero: false, alive: true, hasAttacked: false, statusEffects: [],
  stageAtk: 0, stageDef: 0, stageMag: 0, stageRes: 0, stageSpd: 0,
  elements: [], passives: [], ...over,
});
const move = (over) => ({ id: 'm', name: 'M', power: 40, accuracy: 100, type: 'physical', element: 'neutral', crit: 0, ...over });

const cases = [
  // power40 atk20 def10 → floor(800/40)+2 = 22
  { name: 'base neutral',              mv: move({}),                       at: unit({ atk: 20 }),                 df: unit({ def: 10 }),                    expect: 22 },
  // 22 × 2.0 (fire > nature) = 44
  { name: 'super-effective fire>nature', mv: move({ element: 'fire' }),     at: unit({ atk: 20 }),                 df: unit({ def: 10, elements: ['nature'] }), expect: 44 },
  // 22 × 0.5 (fire resisted by water) = 11
  { name: 'resisted fire>water',       mv: move({ element: 'fire' }),       at: unit({ atk: 20 }),                 df: unit({ def: 10, elements: ['water'] }),  expect: 11 },
  // 22 × 2.0 × 1.5 STAB = 66
  { name: 'STAB fire vs nature',       mv: move({ element: 'fire' }),       at: unit({ atk: 20, elements: ['fire'] }), df: unit({ def: 10, elements: ['nature'] }), expect: 66 },
  // pierce halves def 20→10: floor(800/40)+2 = 22 (vs 12 unpierced)
  { name: 'pierce halves defense',     mv: move({ effect: 'pierce' }),      at: unit({ atk: 20 }),                 df: unit({ def: 20 }),                    expect: 22 },
  // sun boosts fire ×1.5: 22 → 33
  { name: 'sun boosts fire',           mv: move({ element: 'fire' }),       at: unit({ atk: 20 }),                 df: unit({ def: 10 }), weather: { type: 'sun', turnsLeft: 1 }, expect: 33 },
  // higher def reduces: power40 atk20 def40 → floor(800/160)+2 = 7
  { name: 'tanky defender',            mv: move({}),                        at: unit({ atk: 20 }),                 df: unit({ def: 40 }),                    expect: 7 },
];

console.log('═══ Damage golden test — server calculateDamage vs the client formula ═══\n');
let fails = 0;
for (const c of cases) {
  let r;
  try { r = calculateDamage(c.mv, c.at, c.df, c.weather); } catch (e) { r = { damage: 'THREW: ' + e.message, missed: false }; }
  const ok = r && r.damage === c.expect && !r.missed;
  console.log('  ' + (ok ? '✓' : '✗') + ' ' + c.name.padEnd(28) + ' → damage=' + r.damage + (ok ? '' : '   (expected ' + c.expect + ')'));
  if (!ok) fails++;
}
console.log('\n' + (fails ? '✗ ' + fails + ' golden damage case(s) FAILED — server formula has drifted from the client.' : '✓ ALL golden damage cases pass — server formula matches the client formula.'));
process.exit(fails ? 1 : 0);
