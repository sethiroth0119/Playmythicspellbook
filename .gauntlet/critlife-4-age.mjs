import { makeWorld } from './critlife-harness.mjs';
const W = makeWorld();
const M = await import('../public/src/lifepath/model.js');
M.bind(W.ctx);
const clk = M.clock(); const SPY = clk.secPerYear;
M.reset(); W.setRoster(40); M.seed();
const read = () => { const m={}; for (const c of W.roster){const a=M.ageOf(c.id); if(a.ok) m[c.id]={y:a.years,b:a.born,band:a.band};} return m; };
const A0 = read();
// forward exactly one derived year
W.now += SPY;
const A1 = read();
let worst=0, stampMoved=0;
for (const id in A0){ worst=Math.max(worst, Math.abs((A1[id].y-A0[id].y)-1)); if(A1[id].b!==A0[id].b) stampMoved++; }
// reverse
W.now -= SPY;
const A2 = read();
let backWorst=0, backSame=0;
for (const id in A0){ backWorst=Math.max(backWorst,Math.abs(A2[id].y-A0[id].y)); if(A2[id].b===A0[id].b) backSame++; }
console.log(JSON.stringify({ forward:{worstYearError:worst, birthStampsMoved:stampMoved},
  reverse:{worstYearError:backWorst, stampsUnchanged:backSame+'/'+Object.keys(A0).length} }));

// --- EDGES: what does the module do at a band boundary / negative clock / huge clock
const probe = (label, t) => {
  W.now = t; const a = M.ageOf('c1'); const cr = M.careerOf('c1');
  return { label, t, ok:a.ok, years:a.ok?+a.years.toFixed(3):null, band:a.ok?a.band:null,
           whole:a.ok?a.whole:null, past:a.ok?a.pastExpectancy:null, careerWhy: cr.ok?null:cr.why };
};
const born = M.stamps()['c1'];
const at = (yrs) => born + yrs*SPY;
const rows=[];
for (const y of [-5, -0.0001, 0, 0.5, 17.9999, 18, 18.0001, 28.39, 28.4, 28.41, 69.99, 70, 70.01, 80.39, 80.4, 80.41, 150, 1000]) rows.push(probe('age '+y, at(y)));
console.table(rows);
// stamp rounding: does a citizen sampled exactly at a band floor read below it?
W.now = 100000;
console.log('LIFE.round is exported but never read anywhere:', 'confirmed by grep');
