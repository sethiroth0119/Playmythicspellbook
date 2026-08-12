// Control experiment: mirror match. Same hero, same 40 cards, both sides.
// If the harness is unbiased this must land on 50% for both the A/B seat and
// the first/second seat. Anything else is a harness artifact or an engine
// asymmetry, and either way it has to be known before a single Warpath number
// is quoted.
import { openEngine } from './engine.mjs';

const N = Number(process.argv[2] || 40);
const STARTER = [
  'unit:goblin', 'unit:goblin', 'unit:wolf', 'unit:wolf', 'unit:archer',
  'unit:orc', 'unit:spider', 'unit:priest', 'unit:sprite', 'unit:golem',
  'trap:spikes', 'trap:snare', 'trap:caltrops', 'trap:bearTrap',
  'location:forest', 'location:forest', 'location:manaFont', 'location:manaFont',
  'location:altar', 'location:holySpring', 'location:watchtower', 'location:mire',
  'spell:mend', 'spell:bolt',
];

const E = await openEngine({});
const padded = await E.pad(STARTER);

async function block(label, heroA, heroB) {
  let aWins = 0, firstWins = 0, done = 0, unres = 0, tt = 0, turns = [];
  const t0 = Date.now();
  for (let i = 0; i < N; i++) {
    const aFirst = i % 2 === 0;
    const r = await E.playMatch({
      heroA, heroB, keysA: padded, keysB: padded, aFirst,
      maxHalfTurns: 220, turnTimeoutMs: 12000,
    });
    tt += r.timeouts;
    if (!r.winner) { unres++; continue; }
    done++;
    turns.push(r.halfTurns);
    if (r.winner === 'A') aWins++;
    const firstSide = aFirst ? 'A' : 'B';
    if (r.winner === firstSide) firstWins++;
  }
  const ms = Date.now() - t0;
  console.log(`${label}: n=${done} (unresolved ${unres})  A-seat ${aWins}/${done} = ${(100 * aWins / done).toFixed(1)}%  `
    + `first-seat ${firstWins}/${done} = ${(100 * firstWins / done).toFixed(1)}%  `
    + `median half-turns ${turns.sort((a, b) => a - b)[turns.length >> 1]}  `
    + `${(ms / Math.max(1, N)).toFixed(0)}ms/match  ai-timeouts ${tt}`);
}

await block('mirror cedric/cedric', 'cedric', 'cedric');
await block('mirror lyra/lyra    ', 'lyra', 'lyra');
console.log('page errors:', E.pageErrors.slice(0, 8));
await E.close();
