// Control experiment: mirror match. Same hero, same 40 cards, both sides.
// If the harness is unbiased this must land on 50% for both the A/B seat and
// the first/second seat. Anything else is a harness artifact or an engine
// asymmetry, and either way it has to be known before a single Warpath number
// is quoted.
import { openEngine } from './engine.mjs';
import { wilson } from './stats.mjs';

const N = Number(process.argv[2] || 40);
const W = Number(process.argv[3] || 4);
const STARTER = [
  'unit:goblin', 'unit:goblin', 'unit:wolf', 'unit:wolf', 'unit:archer',
  'unit:orc', 'unit:spider', 'unit:priest', 'unit:sprite', 'unit:golem',
  'trap:spikes', 'trap:snare', 'trap:caltrops', 'trap:bearTrap',
  'location:forest', 'location:forest', 'location:manaFont', 'location:manaFont',
  'location:altar', 'location:holySpring', 'location:watchtower', 'location:mire',
  'spell:mend', 'spell:bolt',
];

const E = await openEngine({ workers: W });
const padded = await E.pad(STARTER);

async function block(label, heroA, heroB) {
  const cfgs = [];
  for (let i = 0; i < N; i++) {
    cfgs.push({ heroA, heroB, keysA: padded, keysB: padded, aFirst: i % 2 === 0,
                maxHalfTurns: 220, turnTimeoutMs: 12000 });
  }
  const t0 = Date.now();
  const rs = await E.playMany(cfgs);
  const ms = Date.now() - t0;
  let aWins = 0, firstWins = 0, done = 0, unres = 0, tt = 0; const turns = [];
  rs.forEach((r, i) => {
    tt += r.timeouts | 0;
    if (!r.winner) { unres++; return; }
    done++; turns.push(r.halfTurns);
    if (r.winner === 'A') aWins++;
    if (r.winner === (cfgs[i].aFirst ? 'A' : 'B')) firstWins++;
  });
  const a = wilson(aWins, done), f = wilson(firstWins, done);
  turns.sort((x, y) => x - y);
  console.log(`${label}: n=${done} (unres ${unres})  A-seat ${(100 * a.p).toFixed(1)}% [${(100 * a.lo).toFixed(1)}–${(100 * a.hi).toFixed(1)}]  `
    + `first-seat ${(100 * f.p).toFixed(1)}% [${(100 * f.lo).toFixed(1)}–${(100 * f.hi).toFixed(1)}]  `
    + `median half-turns ${turns[turns.length >> 1]}  ${(ms / Math.max(1, N)).toFixed(0)}ms/match  timeouts ${tt}`);
}

await block('mirror cedric', 'cedric', 'cedric');
await block('mirror lyra  ', 'lyra', 'lyra');
await block('mirror thane ', 'thane', 'thane');
console.log('page errors:', [...new Set(E.pageErrors)].slice(0, 8));
await E.close();
