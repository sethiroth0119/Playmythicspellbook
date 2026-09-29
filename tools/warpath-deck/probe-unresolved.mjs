// ─────────────────────────────────────────────────────────────────────────────
// 🩺 Why do some matches never reach a verdict?
//
// The control block reported a slice of matches with no winner. A match that
// does not end is as much a finding as one that does, so this reproduces the
// worst case (a lopsided matchup) and prints what the engine was doing when the
// half-turn budget ran out.
//
//   node tools/warpath-deck/probe-unresolved.mjs [n]
// ─────────────────────────────────────────────────────────────────────────────
import { openEngine } from './engine.mjs';
import { Data } from './draft.mjs';

const N = Number(process.argv[2] || 60);
const E = await openEngine({ workers: 4 });
const tuned = await E.tunedDeck();
const junk = new Array(40).fill('unit:goblin');
const starter = await E.pad(Data.STARTER_POOL);

for (const [label, d1, d2] of [['tuned vs 40× goblin', tuned, junk],
                               ['tuned vs starter', tuned, starter],
                               ['starter mirror', starter, starter]]) {
  const cfgs = [];
  for (let i = 0; i < N; i++) {
    cfgs.push({ heroA: 'cedric', heroB: 'cedric', keysA: d1, keysB: d2,
                aFirst: i % 2 === 0, maxHalfTurns: 220, turnTimeoutMs: 12000 });
  }
  const rs = await E.playMany(cfgs);
  const unres = rs.filter(r => !r.winner);
  const halves = rs.map(r => r.halfTurns | 0).sort((a, b) => a - b);
  console.log(`\n${label}: ${rs.length - unres.length}/${rs.length} resolved; `
    + `half-turns median ${halves[halves.length >> 1]}, max ${halves.at(-1)}; `
    + `total AI-turn timeouts ${rs.reduce((a, r) => a + (r.timeouts | 0), 0)}; `
    + `harness errors ${rs.filter(r => r.error).length}`);
  unres.slice(0, 3).forEach(r => {
    console.log(`   unresolved: half-turns ${r.halfTurns}, timeouts ${r.timeouts}, err ${r.error || '—'}`);
    console.log(`     hero HP ${JSON.stringify(r.heroHp)}  piles ${JSON.stringify(r.piles)}`);
    console.log(`     log tail: ${(r.tail || []).slice(-4).join(' | ').slice(0, 300)}`);
  });
}
console.log('\npage errors:', [...new Set(E.pageErrors)].slice(0, 6));
await E.close();
