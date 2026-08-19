import { makeWorld } from './critlife-harness.mjs';
const W = makeWorld();
const M = await import('../public/src/lifepath/model.js');
M.bind(W.ctx);
const SPY = M.clock().secPerYear;
M.reset(); W.setRoster(40); M.seed();
const A = M.stamps();
// (a) re-deal one year later
W.now += SPY; M.load(null); M.seed();
const B = M.stamps();
let exact=0, bandSame=0;
for (const id in A) { if (Math.abs((B[id]-A[id]) - SPY) <= 1) exact++; }
console.log('stamps that moved by EXACTLY one year (±1s):', exact+'/40  -> the "40/40 differ" control is just the clock');
// (b) now change the PYRAMID and re-deal at the ORIGINAL clock
W.now -= SPY; M.load(null);
W.ages = { child: 12, young: 20, adult: 40, senior: 55 };   // a very different city
M.seed();
const C = M.stamps();
let diff=0; for (const id in A) if (C[id]!==A[id]) diff++;
console.log('re-deal at the SAME clock with a DIFFERENT pyramid differs:', diff+'/40  <-- this is the control the claim needed');
// (c) age advance is exact for a stamp that is an integer of seconds
console.log('sample stamp deltas:', Object.keys(A).slice(0,5).map(id=>B[id]-A[id]), 'SPY=', SPY);
