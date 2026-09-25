/* probe-progression.mjs — does a bigger pool make a better deck? Every time?
 * ---------------------------------------------------------------------------
 * q5 asks this, but with ONE donor run and 80 matches a rung, so a single
 * unlucky eight cards reads as a broken curve. This asks the same question
 * across several independent donors against a common opponent (the 24-card
 * start), which is the shape you want when you are iterating on the answer.
 *
 * The claim under test is strong and worth stating plainly: with a bridge that
 * SELECTS a deck rather than truncating a pool, adding cards to the pool must
 * never make the deck worse. A rung below the one under it is a bug in the
 * selection, not variance in the draft.
 *
 * ⚠ An instrument for iteration. q5 is the table of record.
 *
 *   node tools/warpath-deck/probe-progression.mjs [matches-per-rung]
 */
import fs from 'node:fs';
import { openEngine } from './engine.mjs';
import { draftPools, poolWithGains } from './pools.mjs';
import { Data } from './draft.mjs';
import { wilson, pct, describe } from './stats.mjs';

const HERO = 'cedric';
const N = Number(process.argv[2] || 160);          // matches per rung, summed over donors
const STARTER_N = Data.STARTER_POOL.length;        // 24
const RUNGS = Data.DECK_MILESTONES;                // 25 31 38 46 52 60

const E = await openEngine({ workers: 5 });
const ref = await E.pad(Data.STARTER_POOL, HERO);

async function duel(deck1, deck2, n) {
  const cfgs = [];
  for (let i = 0; i < n; i++) {
    const oneIsA = (i % 2) === 0;
    cfgs.push({ heroA: HERO, heroB: HERO,
                keysA: oneIsA ? deck1 : deck2, keysB: oneIsA ? deck2 : deck1,
                aFirst: (i % 4) < 2, maxHalfTurns: 220, turnTimeoutMs: 12000, _oneIsA: oneIsA });
  }
  const rs = await E.playMany(cfgs);
  let a = 0, done = 0;
  rs.forEach((r, i) => { if (!r.winner) return; done++; if (r.winner === (cfgs[i]._oneIsA ? 'A' : 'B')) a++; });
  return { a, done };
}

// Several independent runs that each reached a 60-card pool, so every rung is
// the SAME draft stream truncated — the only variable is how much of it.
const donors = draftPools(60, { turns: 60, seed0: 770001 })
  .filter(r => STARTER_N + r.gains.length >= 60).slice(0, 4);
console.log(`${donors.length} donor runs reached a 60-card pool; ${N} matches a rung, split across them\n`);
console.log('  pool   deck distinct avgCost   vs the 24-card start');

const per = Math.max(8, Math.round(N / donors.length));
const rows = [];
for (const m of RUNGS) {
  let a = 0, done = 0; const dis = [], cost = [];
  for (const d of donors) {
    const pool = poolWithGains(d, Math.max(0, m - STARTER_N)).slice(0, m);
    const keys = await E.pad(pool, HERO);
    const c = new Map();
    for (const k of keys) c.set(k, (c.get(k) || 0) + 1);
    dis.push(c.size);
    cost.push(keys.reduce((s, k) => s + ((Data.CARD_META[k] || {}).c | 0), 0) / keys.length);
    const r = await duel(keys, ref, per);
    a += r.a; done += r.done;
  }
  const w = wilson(a, done);
  rows.push({ pool: m, ...w, distinct: +describe(dis).mean.toFixed(1), avgCost: +describe(cost).mean.toFixed(2) });
  console.log('  ' + String(m).padStart(5) + String(40).padStart(7)
    + String(describe(dis).mean.toFixed(1)).padStart(9) + String(describe(cost).mean.toFixed(2)).padStart(9)
    + ('   ' + pct(w.p) + ' [' + pct(w.lo) + '–' + pct(w.hi) + ']  ' + a + '/' + done).padStart(30));
}

let breaks = 0;
console.log('\n  rungs that go BACKWARDS (a bigger pool making a worse deck):');
for (let i = 1; i < rows.length; i++) {
  if (rows[i].p < rows[i - 1].p) {
    breaks++;
    console.log(`    ${rows[i - 1].pool} → ${rows[i].pool}: ${pct(rows[i - 1].p)} → ${pct(rows[i].p)}`);
  }
}
if (!breaks) console.log('    none — the curve is monotone');
console.log(`\n  first rung ${pct(rows[0].p)} → last rung ${pct(rows.at(-1).p)}  `
  + `(the whole draft is worth ${pct(rows.at(-1).p - rows[0].p)})`);

fs.writeFileSync(new URL('./out/progression.json', import.meta.url), JSON.stringify({ rows, breaks }, null, 1));
console.log('page errors:', [...new Set(E.pageErrors)].slice(0, 4));
await E.close();
