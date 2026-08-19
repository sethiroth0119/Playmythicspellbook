import { makeWorld } from './critlife-harness.mjs';
const W = makeWorld();
const M = await import('../public/src/lifepath/model.js');
M.bind(W.ctx);
const clk = M.clock(); const SPY = clk.secPerYear;
M.reset(); W.setRoster(40); M.seed();
// pick the OLDEST citizen so worklife is long
const ages = W.roster.map(c => ({ id: c.id, y: M.ageOf(c.id).years })).sort((a,b)=>b.y-a.y);
const id = ages[0].id;
// a firm on an OLD building
W.firms['f1'] = { id:'f1', name:'Old Mill', level:1, rung:'HEALTHY' };
W.firms['f2'] = { id:'f2', name:'New Shop', level:5, rung:'HEALTHY' };
W.tileBorn['3,3'] = W.now - 60*SPY;    // building 60 years old
W.tileBorn['9,9'] = W.now - 0.2*SPY;   // building 0.2 years old
W.employers[id] = { id:'f1', name:'Old Mill', ind:'mill', tile:'3,3' };
const show = (label) => { const q = M.careerOf(id);
  return { label, ok:q.ok, why:q.why||null, grade:q.ok?q.grade:null, cap:q.ok?q.cap:null,
    rungs:q.ok?q.rungs:null, tenure:q.ok?+q.tenureYears.toFixed(2):null,
    worked:q.ok?+q.workedYears.toFixed(2):null, site:q.ok?+q.siteYears.toFixed(2):null,
    from:q.ok?q.tenureFrom:null, siteFrom:q.ok?q.siteFrom:null, firm:q.ok?q.firm.name:null }; };
const rows=[];
rows.push(show('baseline: age '+ages[0].y.toFixed(1)+', firm lvl 1, 60y building'));
W.firms['f1'].level = 2; rows.push(show('firm level 1->2'));
W.firms['f1'].level = 1; rows.push(show('firm level 2->1'));
W.firms['f1'].level = 5; rows.push(show('firm level ->5 (uncapped)'));
// BANKRUPT firm — byId still returns it
W.firms['f1'].rung = 'BANKRUPT'; rows.push(show('firm now BANKRUPT (byId still returns it)'));
W.firms['f1'].rung = 'HEALTHY';
// EMPLOYER CHANGE — moves to the brand-new shop
W.employers[id] = { id:'f2', name:'New Shop', ind:'shop', tile:'9,9' };
rows.push(show('changed employer to a 0.2y-old level-5 shop'));
// DEMOLISH + REBUILD the old mill's tile
W.employers[id] = { id:'f1', name:'Old Mill', ind:'mill', tile:'3,3' };
W.firms['f1'].level = 5;
rows.push(show('back at Old Mill, level 5'));
W.tileBorn['3,3'] = W.now;             // demolished and rebuilt this instant
rows.push(show('SAME job, building demolished+rebuilt'));
delete W.tileBorn['3,3'];              // tile gone entirely -> falls back to city age
rows.push(show('tile gone: ceiling = age of the CITY'));
console.table(rows);
// The honesty attack: an OLD citizen in an OLD building — how many read as veterans?
W.tileBorn['3,3'] = W.now - 60*SPY;
let n=0, vet=0, capd=0;
for (const c of W.roster) { W.employers[c.id] = { id:'f1', name:'Old Mill', ind:'mill', tile:'3,3' }; }
const t = [];
for (const c of W.roster) { const q=M.careerOf(c.id); if(!q.ok) continue; n++;
  if (q.tenureFrom==='worklife') vet++; if (q.capped) capd++;
  t.push({ age:+M.ageOf(c.id).years.toFixed(1), tenure:+q.tenureYears.toFixed(1), grade:q.grade, boundBy:q.tenureFrom }); }
console.log('with a 60-year-old building, tenure bound by WORKLIFE for '+vet+'/'+n+' — i.e. tenure == age-18 for that many');
console.log(JSON.stringify(t.slice(0,10)));
