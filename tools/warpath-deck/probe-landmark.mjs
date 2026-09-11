/* probe-landmark.mjs — is the one authored PvE encounter findable at all?
 * ---------------------------------------------------------------------------
 * There is exactly ONE landmark per world and the only way to learn what it is
 * — or to fight its Guardian — is to stand on its tile. The four-player sim saw
 * zero Guardian battles in sixteen runs, which is either bad luck or a mode
 * whose only authored PvE content is unreachable. This settles it by walking
 * the real draft policy over many seeds and asking how often the tile is ever
 * stepped on.
 *
 *   node tools/warpath-deck/probe-landmark.mjs
 */
import { runExpedition, Map_ } from './draft.mjs';

const { WORLD_W, WORLD_H, placeStructures, chebyshev } = Map_;
const N = Number(process.argv[2] || 240);
const TURNS = [20, 40, 60];

console.log(`${N} seeds × 4 spawn slots, real draft policy, world ${WORLD_W}×${WORLD_H} = ${WORLD_W * WORLD_H} tiles\n`);

// How far is the landmark from the spawn it is measured against?
const dists = [];
for (let i = 0; i < N; i++) {
  const seed = ((7000019 + i * 7919) >>> 0);
  const s = placeStructures(seed);
  for (let slot = 0; slot < 4; slot++) {
    const sp = s.spawns[slot];
    dists.push(chebyshev(sp.x, sp.y, s.landmark.x, s.landmark.y));
  }
}
dists.sort((a, b) => a - b);
const q = p => dists[Math.min(dists.length - 1, Math.floor(p * dists.length))];
console.log(`  spawn → landmark distance (chebyshev): min ${dists[0]}  p10 ${q(0.1)}  median ${q(0.5)}  p90 ${q(0.9)}  max ${dists.at(-1)}`);
console.log(`  a hero covers ~1 tile per move and gets a few moves a turn, so a 60-turn`);
console.log(`  run walks on the order of 100–200 tiles out of ${WORLD_W * WORLD_H}.\n`);

/* Two different questions, and they have very different answers.
   SEEN   — the tile fell inside the fog reveal (wp_reveal paints a square of
            radius wp_vision = 2 around every tile moved onto), so the painted
            structure came out from under the cloud and the player was TOLD
            something is there.
   STOOD  — the hero actually stepped on it, which is the only thing that opens
            the "??? Unidentified Structure" modal and the only way to fight
            the Guardian. */
const VISION = 2;
console.log('  turns   runs        SEEN (fog)       STOOD ON IT   guarded: stood   tiles walked (median)');
const rows = [];
for (const turns of TURNS) {
  let seen = 0, stood = 0, guardedStood = 0, guarded = 0, runs = 0;
  const walked = [];
  for (let i = 0; i < N; i++) {
    const seed = ((7000019 + i * 7919) >>> 0);
    const st = placeStructures(seed);
    const L = st.landmark;
    const lmKey = L.y * WORLD_W + L.x;
    const isGuarded = L.id !== 'the_garden';
    for (let slot = 0; slot < 4; slot++) {
      const r = runExpedition({ seed, slot, turns, pick: 'value', style: 'explore' });
      runs++;
      walked.push(r.log.tilesWalked);
      if (isGuarded) guarded++;
      let sawIt = false;
      for (const k of r.visited) {
        const vy = (k / WORLD_W) | 0, vx = k % WORLD_W;
        if (Math.abs(vx - L.x) <= VISION && Math.abs(vy - L.y) <= VISION) { sawIt = true; break; }
      }
      if (sawIt) seen++;
      if (r.visited.has(lmKey)) { stood++; if (isGuarded) guardedStood++; }
    }
  }
  walked.sort((a, b) => a - b);
  const pc = (k, n) => (k + ' (' + (100 * k / n).toFixed(1) + '%)');
  const row = { turns, runs, seen, seenRate: seen / runs, stood, stoodRate: stood / runs,
                guarded, guardedStood, guardedStoodRate: guarded ? guardedStood / guarded : 0,
                medianWalked: walked[walked.length >> 1] };
  rows.push(row);
  console.log('  ' + String(turns).padStart(5) + String(runs).padStart(7)
    + pc(seen, runs).padStart(18) + pc(stood, runs).padStart(18)
    + pc(guardedStood, guarded).padStart(17) + String(row.medianWalked).padStart(23));
}

console.log('\nreading it:');
console.log('  SEEN near STOOD means finding it and engaging it are the same act, so the');
console.log('  encounter is simply rare. A big gap would mean players walk past it.');
console.log('  Either way a low STOOD is the mode shipping one authored PvE encounter');
console.log('  that almost nobody ever sees.');

import fs from 'node:fs';
fs.writeFileSync(new URL('./out/landmark.json', import.meta.url), JSON.stringify({ dists: { min: dists[0], p50: q(0.5), p90: q(0.9), max: dists.at(-1) }, vision: VISION, rows }, null, 1));
