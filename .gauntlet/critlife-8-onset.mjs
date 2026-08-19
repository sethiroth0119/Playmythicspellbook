import { makeWorld } from './critlife-harness.mjs';
const W = makeWorld();
const M = await import('../public/src/lifepath/model.js');
M.bind(W.ctx);
const SPY = M.clock().secPerYear, HPY = M.clock().hoursPerYear;
M.reset(); W.setRoster(40); M.seed();
const t0 = W.now;
const rows=[];
for (let h=0; h<=24; h+=1) { W.now = t0 + (h/HPY)*SPY; const d=M.distribution();
  rows.push({ realHoursPlayed:h, cityYears:+(h/HPY).toFixed(2), dev_pct:+(d.maxShareDev*100).toFixed(2),
    bound_pct:+(d.bound*100).toFixed(2), within: d.maxShareDev<=d.bound+1e-9 }); }
console.table(rows.filter((r,i)=>i%2===0 || !r.within));
const first = rows.find(r=>!r.within);
console.log('FIRST breach of the one-person bound at', first ? first.realHoursPlayed+' real hours of play ('+first.cityYears+' citizen-years)' : 'never in 24h');
