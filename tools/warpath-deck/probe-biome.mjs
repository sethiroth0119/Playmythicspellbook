/* probe-biome.mjs — what does a biome actually PAY?
 * ---------------------------------------------------------------------------
 * q3 measures one half of the answer: how strong the deck you end up with is,
 * head to head. That is not the payoff on its own. A biome also decides HOW
 * MANY cards you get and what else you can carry home, and a biome that hands
 * you a slightly better card every other turn is not comparable to one that
 * hands you a slightly worse card every turn.
 *
 * This measures the half q3 cannot: yield and cost, from the real draft, over
 * enough seeds to be a number rather than an anecdote.
 *
 *   node tools/warpath-deck/probe-biome.mjs [seeds]
 */
import fs from 'node:fs';
import { runExpedition, Data, Map_ } from './draft.mjs';
import { describe } from './stats.mjs';

const N = Number(process.argv[2] || 120);
const BIOMES = Object.keys(Data.DISCOVERY);
const META = Data.CARD_META;

// Stats-per-energy for a unit, the flat tier for everything else — the same
// shape the bridge now ranks a deck by, so "quality" here means what it means
// to warpathPadDeck.
function value(key) {
  const m = META[key];
  if (!m) return 0;
  if (m.t === 'unit') {
    const s = m.s || [0, 0, 0, 0, 0, 0];
    return (s[0] + Math.max(s[1], s[3]) * 1.5 + (s[2] + s[4]) * 0.5) / Math.max(1, m.c);
  }
  return { trap: 6, spell: 6, location: 5, weather: 4 }[m.t] || 3;
}

console.log(`${N} seeds × 4 slots per biome, real 60-turn runs targeting that biome\n`);
console.log('biome      move nodeDens encCh   gained   matls  tblQuality  drafted  cost  ratio');
const rows = [];
for (const b of BIOMES) {
  const gained = [], matls = [], drafted = [];
  for (let i = 0; i < N; i++) {
    const seed = ((3300017 + i * 7919) >>> 0);
    for (let slot = 0; slot < 4; slot++) {
      const r = runExpedition({ seed, slot, turns: 60, pick: 'value', style: 'explore', target: b });
      gained.push(r.gains.length);
      matls.push(r.materials.length);
      if (r.gains.length) drafted.push(r.gains.reduce((a, k) => a + value(k), 0) / r.gains.length);
    }
  }
  // Quality of the OFFER TABLE itself, weight-averaged — what the biome is
  // willing to hand you, before any drafting policy touches it.
  const t = Data.DISCOVERY[b];
  const tot = t.cards.reduce((a, c) => a + c[1], 0);
  const tblQ = t.cards.reduce((a, [k, w]) => a + w * value(k), 0) / tot;
  const cost = t.cards.reduce((a, [k, w]) => a + w * ((META[k] || {}).c | 0), 0) / tot;
  const B = Map_.BIOMES[b] || {};
  const g = describe(gained), d = describe(drafted), mm = describe(matls);
  const row = { biome: b, moveBase: B.moveBase, nodeDensity: B.nodeDensity, encounterChance: t.encounterChance,
                gained: +g.mean.toFixed(1), materials: +mm.mean.toFixed(1),
                tableQuality: +tblQ.toFixed(2), draftedQuality: +d.mean.toFixed(2),
                avgCost: +cost.toFixed(2), yieldTimesQuality: +(g.mean * d.mean).toFixed(0) };
  rows.push(row);
  console.log('  ' + b.padEnd(9) + String(row.moveBase).padStart(4) + String(row.nodeDensity).padStart(9)
    + String(row.encounterChance).padStart(6) + String(row.gained).padStart(9)
    + String(row.materials).padStart(8) + String(row.tableQuality).padStart(12)
    + String(row.draftedQuality).padStart(9) + String(row.avgCost).padStart(6)
    + String(row.yieldTimesQuality).padStart(7));
}

console.log('\nreading it:');
console.log('  gained  — cards a 60-turn run drafts while living in that biome');
console.log('  tblQuality — value of the offer table itself, weighted by its own odds');
console.log('  drafted — value of what a competent drafter actually took');
console.log('  ratio   — gained × drafted, the closest single number to "what the biome pays"');
fs.writeFileSync(new URL('./out/biome.json', import.meta.url), JSON.stringify(rows, null, 1));
