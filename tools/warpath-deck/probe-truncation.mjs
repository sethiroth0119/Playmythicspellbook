/* probe-truncation.mjs — WHY does a 35-card draft play like a 13-card one?
 * ---------------------------------------------------------------------------
 * Two candidates were on the table: recruitment being a rounding error, or
 * warpathPadDeck diluting a good pool with duplicates. This measures which, by
 * asking the only question that separates them — of the cards a player actually
 * DREW OUT OF THE WORLD, how many survive into the 40 the engine is handed?
 *
 * Dilution would keep every drafted card and add duplicates around it.
 * Truncation would throw drafted cards away. The shapes are completely
 * different and one probe tells them apart.
 */
import { openEngine } from './engine.mjs';
import { draftPools, poolWithGains } from './pools.mjs';
import { Data } from './draft.mjs';

const STARTER = new Set(Data.STARTER_POOL);
/* Every row must describe the SAME runs, or a row is a different population and
   the column stops being a curve. Only runs that drafted at least 40 cards can
   appear in the +40 row, so only those runs appear in any row. */
const MAXN = 35;
const runs = draftPools(40, { seed0: 20250812 }).filter(r => r.gains.length >= MAXN);
console.log(`${runs.length} of 40 drafted runs reached +${MAXN}; every row below is those same runs.`);

const eng = await openEngine({ workers: 1 });
console.log('pool → what the engine is handed (via the shipped warpathPadDeck)\n');
console.log('  gained  poolSize   deckSize  draftedSLOTS  starterInDeck  draftedInDeck  draftedLOST  dupPairs  overLimit');

const rows = [];
for (const n of [0, 8, 13, 16, 20, 25, 30, 35]) {
  let poolSize = 0, deckSize = 0, slots = 0, starterIn = 0, draftedIn = 0, lost = 0, dup = 0, over = 0, samples = 0;
  for (const run of runs) {
    const pool = poolWithGains(run, n);
    const gained = pool.slice(Data.STARTER_POOL.length);
    if (gained.length < n) continue;                 // this run did not draft that many
    const deck = await eng.pad(pool, 'cedric');
    // A drafted card counts as "in the deck" if at least one copy of it is.
    const inDeck = new Map();
    for (const k of deck) inDeck.set(k, (inDeck.get(k) || 0) + 1);
    const gainedDistinct = new Set(gained);
    let gIn = 0;
    for (const k of gainedDistinct) if (inDeck.has(k)) gIn++;
    let sIn = 0;
    for (const k of new Set(Data.STARTER_POOL)) if (inDeck.has(k)) sIn++;
    // The number that actually decides a match: how many of the 40 slots the
    // engine deals from hold a key the starter could never have given you.
    let sl = 0;
    for (const k of deck) if (!STARTER.has(k)) sl++;
    poolSize += pool.length; deckSize += deck.length; slots += sl;
    starterIn += sIn; draftedIn += gIn; lost += (gainedDistinct.size - gIn);
    for (const [, v] of inDeck) { if (v > 1) dup += v - 1; if (v > 3) over++; }
    samples++;
  }
  if (!samples) continue;
  const r = {
    gained: n, poolSize: +(poolSize / samples).toFixed(1), deckSize: +(deckSize / samples).toFixed(1),
    draftedSlots: +(slots / samples).toFixed(1),
    starterInDeck: +(starterIn / samples).toFixed(1), draftedInDeck: +(draftedIn / samples).toFixed(1),
    draftedLost: +(lost / samples).toFixed(1), dupPairs: +(dup / samples).toFixed(1),
    overLimit: +(over / samples).toFixed(1),
  };
  rows.push(r);
  console.log('  ' + String(r.gained).padStart(6) + String(r.poolSize).padStart(10)
    + String(r.deckSize).padStart(11) + String(r.draftedSlots).padStart(14)
    + String(r.starterInDeck).padStart(15)
    + String(r.draftedInDeck).padStart(15) + String(r.draftedLost).padStart(13)
    + String(r.dupPairs).padStart(10) + String(r.overLimit).padStart(11));
}
console.log('\nreading it:');
console.log('  draftedLOST > 0  → TRUNCATION: the deck discards cards the player earned.');
console.log('  dupPairs high    → DILUTION: the deck is padded with copies.');
console.log('  draftedSLOTS flat → the reward curve is flat no matter what the pool holds.');
await eng.close();
import fs from 'node:fs';
fs.writeFileSync(new URL('./out/truncation.json', import.meta.url), JSON.stringify(rows, null, 1));
