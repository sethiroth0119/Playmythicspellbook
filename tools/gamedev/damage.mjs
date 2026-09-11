#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// damage.mjs — deterministic damage tables straight from the client's own
// `calculateDamage`, run headless. Use it to sanity-check a new move's numbers
// before it ships ("does Riptide one-shot a 1-cost unit? what does it do into
// fire?"), or to see how a stat change moves the curve.
//
//   node tools/gamedev/damage.mjs riptide                 # matrix: defender element × DEF
//   node tools/gamedev/damage.mjs riptide --atk 30 --def 8,12,20
//   node tools/gamedev/damage.mjs --power 40 --type physical --element fire   # ad-hoc move
//   node tools/gamedev/damage.mjs riptide --vs troll      # against a real unit card's stats
//   node tools/gamedev/damage.mjs --compare riptide,fireball,iceShard --def 10
//   --json for machine output.
//
// Weather: --weather sun (client shape: weatherType lowercase).
// Rolls are removed (accuracy 100, crit 0, no dodge statuses), so the number is
// the pure formula — the same convention colyseus-server/test/damage-golden.mjs
// uses. Real fights add the ±crit/miss layer on top.
// ─────────────────────────────────────────────────────────────────────────────
import { loadEngine, argFlag, argValue, positional } from './headless.mjs';

const eng = loadEngine();
const ids = positional(['atk', 'def', 'mag', 'res', 'power', 'type', 'element', 'vs', 'compare', 'weather']);
const nums = (s, d) => (s == null ? d : String(s).split(',').map((x) => parseInt(x, 10)).filter((n) => !isNaN(n)));

function unit(over) {
  const s = { atk: 20, def: 10, mag: 20, res: 10, spd: 1, ...over.stats };
  return { id: over.id || 'u', name: over.name || 'Unit', owner: over.owner || 'player', alive: true, isHero: false,
    hp: 100, maxHp: 100, currentHp: 100, ...s, stats: s, statusEffects: [], passives: over.passives || [],
    elements: over.elements || [], factions: over.factions || [], pos: over.pos || { x: 1, y: 1 },
    stageAtk: 0, stageDef: 0, stageMag: 0, stageRes: 0, stageSpd: 0, hasAttacked: false, hasMoved: false };
}
function deterministic(move) { return { ...move, accuracy: 100, crit: 0 }; }
function roll(move, atk, def, weather) {
  try { const r = eng.calculateDamage(deterministic(move), atk, def, weather || null); return r && !r.missed ? r.damage : (r ? 'miss' : '?'); }
  catch (e) { return 'ERR:' + e.message.slice(0, 30); }
}

// --golden: the same seven deterministic cases colyseus-server/test/damage-golden.mjs
// locks the SERVER to, run here against the CLIENT formula. If this fails, the
// client formula changed — update BOTH goldens deliberately, or revert.
if (argFlag('golden')) {
  const u = (o) => unit({ id: o.id || 'u', owner: o.owner || 'player', stats: { atk: 20, def: 10, mag: 20, res: 10, ...o }, elements: o.elements || [], pos: o.pos });
  const mv = (o) => ({ id: 'm', name: 'M', kind: 'attack', power: 40, accuracy: 100, type: 'physical', element: 'neutral', crit: 0, range: 1, cost: 1, ...o });
  const A = (o = {}) => u({ ...o, id: 'a', owner: 'player', pos: { x: 1, y: 1 } });
  const D = (o = {}) => u({ ...o, id: 'd', owner: 'ai', pos: { x: 2, y: 1 } });
  const cases = [
    { name: 'base neutral',                mv: mv({}),                     at: A({ atk: 20 }),                    df: D({ def: 10 }),                        expect: 22 },
    { name: 'super-effective fire>nature', mv: mv({ element: 'fire' }),    at: A({ atk: 20 }),                    df: D({ def: 10, elements: ['nature'] }),  expect: 44 },
    { name: 'resisted fire>water',         mv: mv({ element: 'fire' }),    at: A({ atk: 20 }),                    df: D({ def: 10, elements: ['water'] }),   expect: 11 },
    { name: 'STAB fire vs nature',         mv: mv({ element: 'fire' }),    at: A({ atk: 20, elements: ['fire'] }), df: D({ def: 10, elements: ['nature'] }),  expect: 66 },
    { name: 'pierce halves defense',       mv: mv({ effect: 'pierce' }),   at: A({ atk: 20 }),                    df: D({ def: 20 }),                        expect: 22 },
    { name: 'sun boosts fire',             mv: mv({ element: 'fire' }),    at: A({ atk: 20 }),                    df: D({ def: 10 }), weather: { weatherType: 'sun', turnsLeft: 1 }, expect: 33 },
    { name: 'tanky defender',              mv: mv({}),                     at: A({ atk: 20 }),                    df: D({ def: 40 }),                        expect: 7 },
  ];
  let fails = 0;
  for (const c of cases) {
    let r; try { r = eng.calculateDamage(c.mv, c.at, c.df, c.weather || null); } catch (e) { r = { damage: 'THREW ' + e.message }; }
    const ok = r && r.damage === c.expect && !r.missed;
    if (!ok) fails++;
    console.log('  ' + (ok ? '✓' : '✗') + ' ' + c.name.padEnd(30) + ' → ' + (r && r.damage) + (ok ? '' : '   (expected ' + c.expect + ')'));
  }
  console.log(fails ? '\n✗ ' + fails + ' golden case(s) FAILED — the client damage formula changed.' : '\n✓ client damage formula matches all ' + cases.length + ' golden cases.');
  process.exit(fails ? 1 : 0);
}

let moves = [];
if (argValue('compare')) moves = argValue('compare').split(',').map((id) => eng.MOVES[id]).filter(Boolean);
else if (ids.length) moves = ids.map((id) => eng.MOVES[id]).filter(Boolean);
if (!moves.length && argValue('power')) {
  moves = [{ id: 'adhoc', name: 'Ad-hoc', kind: 'attack', type: argValue('type', 'physical'), power: parseInt(argValue('power'), 10), element: argValue('element', 'neutral'), range: 1, cost: 1 }];
}
if (!moves.length) { console.error('Give a move id (see: node tools/gamedev/catalog.mjs moves) or --power N.'); process.exit(1); }

const atkStat = parseInt(argValue('atk', '20'), 10), magStat = parseInt(argValue('mag', String(atkStat)), 10);
const attacker = unit({ id: 'atk', owner: 'player', stats: { atk: atkStat, mag: magStat, def: 10, res: 10 }, elements: argValue('stab') ? [argValue('stab')] : [] });
// The client reads `weather.weatherType` (lowercase id: sun|rain|mist|sand|eclipse|…) and
// `turnsLeft > 0`. The server's damage.ts reads `weather.type` — a known shape gap.
const weather = argValue('weather') ? { weatherType: argValue('weather').toLowerCase(), turnsLeft: 3 } : null;

let defenders;
if (argValue('vs')) {
  const card = eng.UNIT_CARDS.find((c) => c.id === argValue('vs')) || eng.STARTER_HEROES.find((c) => c.id === argValue('vs'));
  if (!card) { console.error('No unit/hero card "' + argValue('vs') + '"'); process.exit(1); }
  defenders = [{ label: card.name + ' (' + (card.elements || []).join('/') + ' def' + card.stats.def + ' res' + card.stats.res + ' hp' + (card.stats.hp || card.hp) + ')', u: unit({ id: 'def', owner: 'ai', stats: card.stats, elements: card.elements, pos: { x: 2, y: 1 } }), hp: card.stats.hp || card.hp }];
} else {
  const defs = nums(argValue('def'), [5, 10, 15, 20]);
  const els = ['neutral', ...eng.ELEMENTS];
  defenders = els.flatMap((el) => defs.map((d) => ({ el, d, u: unit({ id: 'def', owner: 'ai', stats: { def: d, res: d, atk: 10, mag: 10 }, elements: el === 'neutral' ? [] : [el], pos: { x: 2, y: 1 } }) })));
}

const out = [];
for (const mv of moves) {
  const head = mv.name + ' [' + mv.id + '] ' + (mv.type || 'no-type') + ' ' + (mv.element || '') + ' power ' + (mv.power | 0) + ' range ' + mv.range + ' cost ' + mv.cost + (mv.effect ? ' effect=' + mv.effect : '') + '   attacker ' + (mv.type === 'magic' ? 'MAG ' + magStat : 'ATK ' + atkStat);
  if (argValue('vs')) {
    const d = defenders[0]; const dmg = roll(mv, attacker, d.u, weather);
    out.push({ move: mv.id, vs: d.label, damage: dmg, hitsToKill: typeof dmg === 'number' && dmg > 0 ? Math.ceil(d.hp / dmg) : null });
    if (!argFlag('json')) console.log(head + '\n  vs ' + d.label + ' → ' + dmg + (typeof dmg === 'number' && dmg > 0 ? '  (' + Math.ceil(d.hp / dmg) + ' hit(s) to kill)' : '') + '\n');
    continue;
  }
  const defs = nums(argValue('def'), [5, 10, 15, 20]);
  const grid = {};
  defenders.forEach((d) => { (grid[d.el] = grid[d.el] || {})[d.d] = roll(mv, attacker, d.u, weather); });
  out.push({ move: mv.id, defs, grid });
  if (!argFlag('json')) {
    console.log(head);
    console.log('  defender'.padEnd(14) + defs.map((d) => ('DEF ' + d).padStart(8)).join(''));
    Object.entries(grid).forEach(([el, row]) => {
      const base = grid.neutral[defs[0]]; const first = row[defs[0]];
      const tag = typeof base === 'number' && typeof first === 'number' && base ? (first > base ? '  ▲ super' : first < base ? '  ▼ resist' : '') : '';
      console.log('  ' + el.padEnd(12) + defs.map((d) => String(row[d]).padStart(8)).join('') + tag);
    });
    console.log('');
  }
}
if (argFlag('json')) console.log(JSON.stringify(out, null, 1));
