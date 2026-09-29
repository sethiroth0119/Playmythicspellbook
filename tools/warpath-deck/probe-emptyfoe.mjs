// ─────────────────────────────────────────────────────────────────────────────
// 🕳 What happens when the Warpath opponent has no deck?
//
// probe-bridge showed that warpathStartBattle leaves enemyDeckOverride null, so
// the opponent's deck is whatever buildAIDeck() returns — and on an install with
// no published admin AI decks and no custom cards that is an EMPTY array. This
// plays that match in the real engine and reports who wins.
//
//   node tools/warpath-deck/probe-emptyfoe.mjs
// ─────────────────────────────────────────────────────────────────────────────
import { openEngine } from './engine.mjs';
import { Data } from './draft.mjs';

const E = await openEngine({ workers: 2 });
const starter = await E.pad(Data.STARTER_POOL);

const cfgs = [];
for (let i = 0; i < 20; i++) {
  cfgs.push({ heroA: 'cedric', heroB: 'lyra', keysA: starter, keysB: [],
              aFirst: i % 2 === 0, maxHalfTurns: 220, turnTimeoutMs: 12000 });
}
const rs = await E.playMany(cfgs);
const a = rs.filter(r => r.winner === 'A').length;
const b = rs.filter(r => r.winner === 'B').length;
const un = rs.filter(r => !r.winner).length;
console.log(`Warpath pool vs an EMPTY opponent deck, 20 matches: `
  + `warpath ${a}, opponent ${b}, unresolved ${un}`);
console.log('median half-turns', rs.map(r => r.halfTurns).sort((x, y) => x - y)[10]);
console.log('deck-out reported in', rs.filter(r => r.deckOut).length, 'of them');
console.log('one log tail:', (rs[0].tail || []).slice(-5).join(' | ').slice(0, 400));
console.log('page errors:', [...new Set(E.pageErrors)].slice(0, 5));
await E.close();
