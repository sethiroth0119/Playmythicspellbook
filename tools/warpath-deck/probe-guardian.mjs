/* probe-guardian.mjs — how hard are the authored Guardians?
 * ---------------------------------------------------------------------------
 * The two guarded landmarks are the mode's only authored PvE encounter. They
 * used to be fought with enemyDeckOverride: null, which on an install with no
 * admin AI deck means an EMPTY opponent deck (probe-emptyfoe.mjs: 20/20, median
 * two half-turns). This plays real Warpath pools against the authored decks in
 * the real engine and reports the win rate.
 *
 * ⚠ WHAT THIS DOES NOT MEASURE. warpathStartBattle sets enemyLevel 6 for a
 * Guardian; the harness plays both sides at the same level, so these numbers
 * are the DECK's strength alone. The real fight is harder than this by whatever
 * six levels are worth.
 *
 *   node tools/warpath-deck/probe-guardian.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openEngine } from './engine.mjs';
import { draftPools, poolWithGains } from './pools.mjs';
import { Data } from './draft.mjs';
import { wilson, fmtRate, describe } from './stats.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '../..');
const HERO = 'cedric';
const N = Number(process.argv[2] || 80);

/* Read the authored recipes straight out of index.html rather than restating
   them, so this probe cannot drift away from what the game ships. */
function guardianDecks() {
  const src = fs.readFileSync(path.join(REPO, 'public/index.html'), 'utf8');
  const i = src.indexOf('const WARPATH_GUARDIANS = {');
  if (i < 0) throw new Error('WARPATH_GUARDIANS not found in index.html');
  let d = 0, j = src.indexOf('{', i), k = j;
  for (; k < src.length; k++) { if (src[k] === '{') d++; else if (src[k] === '}') { d--; if (!d) break; } }
  const G = eval('(' + src.slice(j, k + 1) + ')');
  const out = {};
  for (const lm of Object.keys(G)) {
    const keys = [];
    for (const [key, copies] of G[lm].deck) for (let c = 0; c < copies; c++) keys.push(key);
    out[lm] = { heroId: G[lm].heroId, keys };
  }
  return out;
}

const G = guardianDecks();
const E = await openEngine({ workers: 5 });

console.log('the authored Guardians, straight from index.html:\n');
for (const lm of Object.keys(G)) console.log(`  ${lm.padEnd(16)} ${G[lm].keys.length} cards, hero ${G[lm].heroId}`);

/* The Guardian sits in seat B with its own hero; the run pool sits in seat A
   with the player's. Seats and first-move are balanced 2×2 exactly as duel()
   does, so neither the seat bias nor the first-move bias can be read as
   Guardian difficulty. */
async function fight(poolKeys, gd, n) {
  const cfgs = [];
  for (let i = 0; i < n; i++) {
    const meIsA = (i % 2) === 0;
    cfgs.push({ heroA: meIsA ? HERO : gd.heroId, heroB: meIsA ? gd.heroId : HERO,
                keysA: meIsA ? poolKeys : gd.keys, keysB: meIsA ? gd.keys : poolKeys,
                aFirst: (i % 4) < 2, maxHalfTurns: 220, turnTimeoutMs: 12000, _meIsA: meIsA });
  }
  const rs = await E.playMany(cfgs);
  let w = 0, done = 0, unres = 0; const turns = [];
  rs.forEach((r, i) => {
    if (!r.winner) { unres++; return; }
    done++; turns.push(r.halfTurns);
    if (r.winner === (cfgs[i]._meIsA ? 'A' : 'B')) w++;
  });
  return { w, done, unres, rate: wilson(w, done), turns: describe(turns) };
}

const runs = draftPools(6, { turns: 60, seed0: 555001 });
const best = runs.slice().sort((a, b) => b.gains.length - a.gains.length)[0];
const cands = [
  ['starter pool only (24)', Data.STARTER_POOL],
  ['typical run (+13)', poolWithGains(runs[0], 13)],
  ['good run (+' + best.gains.length + ')', best.pool],
];

console.log('\n  the player wins:');
const rows = [];
for (const [name, pool] of cands) {
  const wp = await E.pad(pool, HERO);
  for (const lm of Object.keys(G)) {
    const r = await fight(wp, G[lm], N);
    console.log(`  ${name.padEnd(22)} vs ${lm.padEnd(16)} ${fmtRate(r.w, r.done)}   median ${r.turns.p50} half-turns`);
    rows.push({ pool: name, guardian: lm, ...r.rate, medianTurns: r.turns.p50, unresolved: r.unres });
  }
}

console.log('\n  for scale, the same pools against the OLD Guardian (an empty deck):');
for (const [name, pool] of cands) {
  const wp = await E.pad(pool, HERO);
  const r = await fight(wp, { heroId: 'lyra', keys: [] }, 20);
  console.log(`  ${name.padEnd(22)} vs ${'(no deck)'.padEnd(16)} ${fmtRate(r.w, r.done)}   median ${r.turns.p50} half-turns`);
  rows.push({ pool: name, guardian: '(empty, the old behaviour)', ...r.rate, medianTurns: r.turns.p50, unresolved: r.unres });
}

fs.writeFileSync(path.join(HERE, 'out', 'guardian.json'), JSON.stringify(rows, null, 1));
console.log('\npage errors:', [...new Set(E.pageErrors)].slice(0, 5));
await E.close();
