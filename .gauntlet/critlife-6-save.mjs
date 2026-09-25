import { makeWorld } from './critlife-harness.mjs';
const W = makeWorld();
const M = await import('../public/src/lifepath/model.js');
M.bind(W.ctx);
const clk = M.clock(); const SPY = clk.secPerYear;
M.reset(); W.setRoster(40); M.seed();
const before = M.stamps();
const slice = M.save();
const bytes = JSON.stringify(slice).length;
// advance a year, then wipe and re-deal (THE CONTROL)
W.now += SPY;
M.load(null);
const wiped = Object.keys(M.stamps()).length;
M.seed();
const reDealt = M.stamps();
let differ=0; for (const id in before) if (reDealt[id] !== before[id]) differ++;
// restore
M.load(slice);
const restored = M.stamps();
let same=0; for (const id in before) if (restored[id] === before[id]) same++;
// hostile input
M.load({ v:1, b:{ 'c1': 'NaN', 'c2': 1e308*10, 'notanid': 5, 'c3': 12.7 }, futureKey: {x:1} });
const h = M.stamps();
const round2 = M.save();
console.log(JSON.stringify({
  sliceKeys: Object.keys(slice), stampsInSlice: Object.keys(slice.b).length,
  bytes, bytesPerCitizen: +(bytes/40).toFixed(1),
  wipedTo: wiped,
  CONTROL_reDealtDiffer: differ+'/'+Object.keys(before).length,
  restoredIdentical: same+'/'+Object.keys(before).length,
  hostile_kept: h, hostile_foreignRoundTripped: !!round2.futureKey,
}, null, 1));
// Does a re-deal at the SAME clock differ? (is the control measuring the clock, or the roster state?)
M.load(null); W.now -= SPY; M.seed();
const sameClock = M.stamps();
let d2=0; for (const id in before) if (sameClock[id]!==before[id]) d2++;
console.log('re-deal at the SAME clock differs:', d2+'/40  <-- if 0, the control above measures only the clock shift');
