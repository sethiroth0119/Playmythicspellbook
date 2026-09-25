/* probe-draft.mjs — what does the pick-1-of-3 actually ask the player?
 * ---------------------------------------------------------------------------
 * The encounter is the mode's product: it fires 6-9 times a run and the brief
 * sells the whole thing as "MTG Limited by another route". It is also the one
 * decision the client currently asks a player to make BLIND — the draft modal
 * shows three card faces and nothing about the pile those cards are joining,
 * and the Pool tab is behind the modal veil while the pick is open.
 *
 * This measures the size of that blindness, so a proposal about it aims at a
 * number rather than at a feeling. It answers the two things a harness CAN
 * answer, and is explicit that it cannot answer the third:
 *
 *   1. how often an offer is a card the player already holds, and how many
 *   2. how often an offer is DEAD — already at the 3-copy limit the deck
 *      builder enforces, so taking it can never change a battle deck
 *   3. how interesting the choice feels — it cannot, and neither can any
 *      instrument in this repo. That needs players.
 *
 *   node tools/warpath-deck/probe-draft.mjs [runs]
 */
import fs from 'node:fs';
import { runExpedition, Data } from './draft.mjs';
import { describe } from './stats.mjs';

const N = Number(process.argv[2] || 300);
const MAX_COPIES = 3;
const META = Data.CARD_META;
const STARTER = Data.STARTER_POOL;

const draftRuns = (pick) => {
  const out = [];
  for (let i = 0; i < N; i++) {
    out.push(runExpedition({ seed: (4100003 + i * 7919) >>> 0, slot: i % 4, turns: 60,
                             pick, style: 'explore' }));
  }
  return out;
};
const runs = draftRuns('value');

let offers = 0, dupOffers = 0, deadOffers = 0, encounters = 0;
let chosenDup = 0, chosenDead = 0;
const dupPerEncounter = [], perRunEncounters = [];
const heldHist = {};
for (const r of runs) {
  perRunEncounters.push(r.offersLog.length);
  for (const e of r.offersLog) {
    encounters++;
    let d = 0;
    e.offers.forEach((k, i) => {
      offers++;
      const held = e.held[i] | 0;
      heldHist[held] = (heldHist[held] || 0) + 1;
      if (held > 0) { dupOffers++; d++; }
      if (held >= MAX_COPIES) deadOffers++;
    });
    dupPerEncounter.push(d);
    if ((e.chosenHeld | 0) > 0) chosenDup++;
    if ((e.chosenHeld | 0) >= MAX_COPIES) chosenDead++;
  }
}

const pct = (a, b) => b ? (100 * a / b).toFixed(1) + '%' : '—';
const enc = describe(perRunEncounters), dpe = describe(dupPerEncounter);

console.log(`${N} full 60-turn runs, real draft, real offer tables\n`);
console.log(`  encounters per run        mean ${enc.mean.toFixed(1)}  p10 ${enc.p10}  median ${enc.p50}  p90 ${enc.p90}`);
console.log(`  offers made               ${offers} across ${encounters} encounters`);
console.log('');
console.log(`  offers of a card ALREADY HELD          ${dupOffers}  (${pct(dupOffers, offers)})`);
console.log(`  ...per encounter                       mean ${dpe.mean.toFixed(2)} of 3  (p90 ${dpe.p90})`);
console.log(`  offers already AT the 3-copy limit     ${deadOffers}  (${pct(deadOffers, offers)})`);
console.log('');
console.log(`  picks that took a card already held    ${chosenDup}  (${pct(chosenDup, encounters)})`);
console.log(`  picks that took a DEAD card            ${chosenDead}  (${pct(chosenDead, encounters)})`);
console.log('');
console.log('  copies already held, per offer:');
for (const k of Object.keys(heldHist).sort((a, b) => a - b)) {
  console.log(`    ${k} ${k === '1' ? 'copy ' : 'copies'}  ${String(heldHist[k]).padStart(6)}  ${pct(heldHist[k], offers)}`);
}

/* Pool composition at extraction. If the draft is a real decision, two runs
   should end up with meaningfully different piles; if it is noise, they should
   not. Measured as the mean pairwise overlap of what came home. */
const extracted = runs.map(r => r.extracted);
let sum = 0, pairs = 0;
for (let i = 0; i < Math.min(120, extracted.length); i++) {
  for (let j = i + 1; j < Math.min(120, extracted.length); j++) {
    const a = new Set(extracted[i]), b = new Set(extracted[j]);
    let inter = 0;
    for (const k of a) if (b.has(k)) inter++;
    const uni = new Set([...a, ...b]).size;
    if (uni) { sum += inter / uni; pairs++; }
  }
}
console.log('');
console.log(`  what comes home: mean pairwise overlap between two runs' extracted cards ${pct(sum, pairs)}`);
console.log(`  distinct cards extracted, per run: mean ${describe(extracted.map(e => new Set(e).size)).mean.toFixed(1)}`);


/* ⭐ THE COST OF THE BLINDNESS, MEASURED.
   `value` and `greedy` in draft.mjs share one value function and differ in
   exactly one thing: `value` knows how many copies it already holds and `greedy`
   does not. That is precisely the information the shipped draft modal withholds.
   So the gap between them is not a modelling curiosity — it is the price of the
   missing copy counter, in the mode's own currency. */
const STARTER_SET = new Set(STARTER);
function score(rs) {
  let enc = 0, dead = 0, dup = 0, starterDup = 0, wasted = 0;
  for (const r of rs) for (const e of r.offersLog) {
    enc++;
    const h = e.chosenHeld | 0;
    if (h > 0) dup++;
    if (h >= MAX_COPIES) { dead++; wasted++; }
    if (STARTER_SET.has(e.chosen)) starterDup++;
  }
  const distinct = describe(rs.map(r => new Set(r.pool).size));
  return { enc, dead, dup, starterDup, wasted, distinct: distinct.mean,
           gained: describe(rs.map(r => r.gains.length)).mean };
}
const informed = score(runs);
const blind = score(draftRuns('greedy'));
console.log('');
console.log('  ── the price of the missing copy counter ──────────────────────────');
console.log('  a drafter that CAN see its pool vs one that cannot, same value function:');
console.log('                                   informed      blind');
console.log('    picks of a DEAD card (>=3 held)'
  + pct(informed.dead, informed.enc).padStart(11) + pct(blind.dead, blind.enc).padStart(11));
console.log('    picks of a card already held   '
  + pct(informed.dup, informed.enc).padStart(11) + pct(blind.dup, blind.enc).padStart(11));
console.log('    distinct cards in the pool     '
  + informed.distinct.toFixed(1).padStart(11) + blind.distinct.toFixed(1).padStart(11));
console.log('    cards drafted per run          '
  + informed.gained.toFixed(1).padStart(11) + blind.gained.toFixed(1).padStart(11));
console.log('');
console.log('  Same number of cards, same walk, same offers. The blind drafter simply');
console.log('  spends ' + pct(blind.dead - informed.dead, blind.enc) + ' more of its picks on cards that cannot reach a');
console.log('  battle deck, and comes home with a narrower pool.');

/* Where the duplication comes from. The coordinator counted offers against the
   24-card loaner deck; this counts against EVERYTHING the player holds at the
   moment of the offer, which is the number the player would actually see. Both
   are reported so the two can be reconciled. */
let vsStarter = 0;
for (const r of runs) for (const e of r.offersLog) {
  for (const k of e.offers) if (STARTER_SET.has(k)) vsStarter++;
}
console.log('');
console.log('  offers that duplicate the 24-card LOANER DECK alone   '
  + vsStarter + '  (' + pct(vsStarter, offers) + ', ' + (3 * vsStarter / offers).toFixed(2) + ' of every 3)');
console.log('  offers that duplicate ANYTHING already held           '
  + dupOffers + '  (' + pct(dupOffers, offers) + ', ' + (3 * dupOffers / offers).toFixed(2) + ' of every 3)');

console.log('\nreading it:');
console.log('  A high "already held" share is not itself a bug — a second Wolf is a real');
console.log('  choice. It is a bug that the player cannot SEE it is a second Wolf. The');
console.log('  dead-offer share is the harder number: those picks cannot change a battle');
console.log('  deck at all, and nothing on screen says so.');

fs.writeFileSync(new URL('./out/draft.json', import.meta.url), JSON.stringify({
  runs: N, offers, encounters, dupOffers, deadOffers, chosenDup, chosenDead,
  dupPerEncounter: dpe, encountersPerRun: enc, heldHist,
  extractOverlap: pairs ? sum / pairs : null,
}, null, 1));
