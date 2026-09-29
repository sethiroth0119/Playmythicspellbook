import { makeWorld } from './critlife-harness.mjs';
const W = makeWorld();
const M = await import('../public/src/lifepath/model.js');
M.bind(W.ctx);
const pct = (o) => Object.fromEntries(Object.entries(o||{}).map(([k,v])=>[k,+(v*100).toFixed(2)]));
const rows = [];
// realistic-ish pyramid from the archetype table proportions
const pyramids = {
  gauntletish: { child: 30, young: 25, adult: 60, senior: 12 },
  fewSeniors:  { child: 40, young: 10, adult: 90, senior: 3  },
  seniorheavy: { child: 12, young: 20, adult: 40, senior: 55 },
};
for (const [pname, ages] of Object.entries(pyramids)) {
  W.ages = ages;
  for (const n of [1,2,3,5,8,13,40,72,80,200]) {
    M.reset();
    W.setRoster(n);
    const d = M.distribution();
    rows.push({ pyramid: pname, n,
      dev_pct: +(d.maxShareDev*100).toFixed(3),
      bound_pct: +((d.bound||0)*100).toFixed(3),
      within: d.maxShareDev <= (d.bound||0)+1e-9,
      roster: d.rosterCount, frame_pct: pct(d.frameShare) });
  }
}
console.table(rows.map(r=>({p:r.pyramid,n:r.n,dev:r.dev_pct,bound:r.bound_pct,ok:r.within,
  young:r.roster.young,adult:r.roster.adult,senior:r.roster.senior,child:r.roster.child})));
console.log('frame shares:', JSON.stringify(rows.filter(r=>r.n===40).map(r=>({p:r.pyramid,f:r.frame_pct}))));
