import { makeWorld } from './critlife-harness.mjs';
const W = makeWorld();
const M = await import('../public/src/lifepath/model.js');
M.bind(W.ctx);
const clk0 = M.clock();
const SPY = clk0.secPerYear;
M.reset(); W.setRoster(40);
M.seed();
const rows = [];
const snap = (label, yrs) => {
  const d = M.distribution();
  const ages = d.ages;
  rows.push({ label, cityYears: yrs, realHours: +(yrs*clk0.hoursPerYear).toFixed(1),
    dev_pct: +(d.maxShareDev*100).toFixed(2), bound_pct: +((d.bound||0)*100).toFixed(2),
    within: d.maxShareDev <= (d.bound||0)+1e-9,
    young: d.rosterCount.young, adult: d.rosterCount.adult, senior: d.rosterCount.senior,
    minAge: ages[0], maxAge: ages[ages.length-1],
    pastLifeExp: ages.filter(a=>a>clk0.lifeExpectancy).length });
};
snap('t0', 0);
for (const y of [1, 5, 10, 25, 50, 100, 200]) {
  W.now = 100000 + y*SPY;
  snap('static roster, clock +'+y+'y', y);
}
console.table(rows);

// Now: does the deal SELF-CORRECT when new people arrive? add 40 fresh ids at +50y
W.now = 100000 + 50*SPY;
W.setRoster(80);   // c1..c80 : c41..c80 are new
const d2 = M.distribution();
console.log('after 40 NEW citizens arrive at +50y:', JSON.stringify({
  dev_pct:+(d2.maxShareDev*100).toFixed(2), bound_pct:+((d2.bound)*100).toFixed(2),
  within: d2.maxShareDev <= d2.bound+1e-9, roster: d2.rosterCount,
  frame_pct: Object.fromEntries(Object.entries(d2.frameShare).map(([k,v])=>[k,+(v*100).toFixed(2)])),
  oldest: d2.ages[d2.ages.length-1] }));
