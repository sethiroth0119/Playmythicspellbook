#!/usr/bin/env node
// Headless smoke test for the Duel of Roses prototype: plays AI-vs-AI duels
// across many seeds through the SAME rules module the browser runs, and
// asserts the invariants a rules engine must never break. Runs in CI-time:
//   node tools/duel-selftest.mjs [games]
import * as R from '../public/src/duel/rules.js';
import { takeTurn } from '../public/src/duel/ai.js';

const games = Number(process.argv[2]) || 40;
const results = { p1: 0, p2: 0, draw: 0 };
const reasons = {};
let turnsTotal = 0, hits = 0, misses = 0, crits = 0, superHits = 0, terrainHits = 0;

function check(cond, msg, state) {
  if (!cond) { console.error('✗ ' + msg + ' (seed ' + state.seed + ', turn ' + state.turn + ')'); process.exit(1); }
}

for (let g = 0; g < games; g++) {
  const seed = 1000 + g * 7919;
  const state = R.newDuel({ seed, p1Name: 'Alpha', p2Name: 'Beta' });
  // Determinism: the same seed must produce the same board and hands.
  const twin = R.newDuel({ seed });
  check(JSON.stringify(twin.board) === JSON.stringify(state.board), 'board not deterministic', state);
  check(JSON.stringify(twin.players.p1.deck) === JSON.stringify(state.players.p1.deck), 'deck not deterministic', state);

  let guard = 0;
  while (!state.gameOver && guard++ < 400) {
    const ev = takeTurn(state, state.active);
    for (const e of ev) {
      if (e.t === 'hit') { if (e.missed) misses++; else { hits++; if (e.crit) crits++; if (e.effectiveness === 'super') superHits++; if (e.terrainA || e.terrainD) terrainHits++; } }
    }
    for (const u of state.units) {
      check(u.currentHp >= 0 && u.currentHp <= u.maxHp, 'hp out of range on ' + u.name, state);
      check(!u.alive || !R.TERRAINS[state.board[u.pos.y][u.pos.x].terrain].blocked, 'unit standing in a labyrinth wall', state);
      check(u.alive || u.currentHp === 0, 'dead unit with hp', state);
    }
    const occupied = new Set();
    for (const u of state.units.filter((u) => u.alive)) {
      const k = R.key(u.pos.x, u.pos.y);
      check(!occupied.has(k), 'two units on one tile', state);
      occupied.add(k);
    }
    for (const side of ['p1', 'p2']) {
      const p = state.players[side];
      check(p.hand.length <= R.RULES.HAND_MAX, 'hand overflow', state);
      check(p.energy >= 0, 'negative energy', state);
      const total = p.hand.length + p.deck.length + p.graveyard.length + state.units.filter((u) => u.alive && u.owner === side && !u.isLeader).length;
      check(total === R.RULES.DECK_SIZE, 'card conservation broken: ' + total, state);
    }
  }
  check(state.gameOver, 'game did not finish in 400 turns', state);
  results[state.winner || 'draw']++;
  reasons[state.reason] = (reasons[state.reason] || 0) + 1;
  turnsTotal += state.turn;
}

console.log('✓ ' + games + ' duels completed');
console.log('  winners  ', results, ' reasons', reasons);
console.log('  avg turns', (turnsTotal / games).toFixed(1));
console.log('  attacks  ', { hits, misses, crits, superHits, terrainHits });
