// Throwaway probe: can the real engine play itself, and how fast?
import { openEngine } from './engine.mjs';

const STARTER = [
  'unit:goblin', 'unit:goblin', 'unit:wolf', 'unit:wolf', 'unit:archer',
  'unit:orc', 'unit:spider', 'unit:priest', 'unit:sprite', 'unit:golem',
  'trap:spikes', 'trap:snare', 'trap:caltrops', 'trap:bearTrap',
  'location:forest', 'location:forest', 'location:manaFont', 'location:manaFont',
  'location:altar', 'location:holySpring', 'location:watchtower', 'location:mire',
  'spell:mend', 'spell:bolt',
];

const E = await openEngine({});
const cat = await E.catalog();
console.log('deckSize', cat.deckSize, 'maxCopies', cat.maxCopies, 'hand', cat.handSize);
console.log('heroes', cat.heroes.map(h => h.id).join(','));

const padded = await E.pad(STARTER);
console.log('starter pool 24 ->', padded.length, 'padded');
console.log('inspect padded:', JSON.stringify(await E.inspect(padded), null, 1));

for (let i = 0; i < 3; i++) {
  const t0 = Date.now();
  const r = await E.playMatch({
    heroA: 'cedric', heroB: 'lyra', keysA: padded, keysB: padded,
    aFirst: i % 2 === 0, maxHalfTurns: 200, turnTimeoutMs: 20000,
  });
  console.log(`match ${i}: ${Date.now() - t0}ms`, JSON.stringify({
    winner: r.winner, halfTurns: r.halfTurns, turnNumber: r.turnNumber,
    deckOut: r.deckOut, timeouts: r.timeouts, error: r.error, heroHp: r.heroHp,
  }));
  console.log('   tail:', (r.tail || []).slice(-4).join(' | ').slice(0, 400));
}
console.log('page errors:', E.pageErrors.slice(0, 10));
await E.close();
