/* THE CAREER ROUND. Same table run twice, in the two regimes that exist now:

     UNSTAMPED — the firm carries no `foundedDay` (a save written before
                 firms.js had one, or a host with no economy). The ceiling falls
                 back to the age of the BUILDING, which is exactly what this
                 round measured before the stamp existed. Row 7 is the defect:
                 same citizen, same firm, tile rebuilt ⇒ tenure 60.0 → 0.0 and
                 grade 5 → 1, with nobody's job having changed.
     STAMPED   — the firm was founded on an economic day and says so. The
                 ceiling is the age of the BUSINESS, so row 7 must hold.

   Both are printed, because "it survives now" is only a claim if the thing it
   survived is on the same page. */
import { makeWorld } from './critlife-harness.mjs';
const W = makeWorld();
const M = await import('../public/src/lifepath/model.js');
M.bind(W.ctx);
const clk = M.clock(); const SPY = clk.secPerYear, DPY = clk.daysPerYear;
/* An economy that has been running for 200 citizen-years, so a firm can be
   given any founding date up to that far back. Set ONCE, before any read — see
   the harness header on the day cache. */
W.day = Math.round(200 * DPY);
M.bind(W.ctx);

const table = (stamped) => {
  M.reset(); W.setRoster(40); M.seed();
  // pick the OLDEST citizen so worklife is long
  const ages = W.roster.map(c => ({ id: c.id, y: M.ageOf(c.id).years })).sort((a,b)=>b.y-a.y);
  const id = ages[0].id;
  // a firm on an OLD building
  W.firms['f1'] = { id:'f1', name:'Old Mill', level:1, rung:'HEALTHY' };
  W.firms['f2'] = { id:'f2', name:'New Shop', level:5, rung:'HEALTHY' };
  if (stamped) {
    // founded 60 years ago; the shop opened 0.2 years ago, like their buildings
    W.firms['f1'].foundedDay = Math.round(W.day - 60 * DPY);
    W.firms['f2'].foundedDay = Math.round(W.day - 0.2 * DPY);
  }
  W.tileBorn['3,3'] = W.now - 60*SPY;    // building 60 years old
  W.tileBorn['9,9'] = W.now - 0.2*SPY;   // building 0.2 years old
  W.employers[id] = { id:'f1', name:'Old Mill', ind:'mill', tile:'3,3' };
  const show = (label) => { const q = M.careerOf(id);
    return { label, ok:q.ok, grade:q.ok?q.grade:null, cap:q.ok?q.cap:null,
      rungs:q.ok?q.rungs:null, tenure:q.ok?+q.tenureYears.toFixed(2):null,
      worked:q.ok?+q.workedYears.toFixed(2):null, site:q.ok?+q.siteYears.toFixed(2):null,
      firmAge:q.ok&&q.firmYears!=null?+q.firmYears.toFixed(2):null,
      from:q.ok?q.tenureFrom:null, siteFrom:q.ok?q.siteFrom:null,
      sampled:q.ok?q.sampled:null, firm:q.ok?q.firm.name:null }; };
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
  rows.push(show('🔴 SAME job, building demolished+rebuilt'));
  delete W.tileBorn['3,3'];              // tile gone entirely
  rows.push(show('tile gone from under the firm'));
  /* A RE-FOUNDED tile is a NEW business and MUST start at zero — the stamp must
     not let a successor inherit its predecessor's age. syncBuildings founds a
     new record with today's day; that is what this row is. */
  W.tileBorn['3,3'] = W.now;
  W.employers[id] = { id:'f1', name:'Old Mill', ind:'mill', tile:'3,3' };
  if (stamped) W.firms['f1'].foundedDay = W.day;
  rows.push(show('tile RE-FOUNDED as a different business (new firm record)'));
  if (stamped) W.firms['f1'].foundedDay = Math.round(W.day - 60 * DPY);
  W.tileBorn['3,3'] = W.now - 60*SPY;
  return { id, rows };
};

console.log('\n══ UNSTAMPED: firm carries no foundedDay (pre-stamp save) ══');
console.table(table(false).rows);
console.log('\n══ STAMPED: firm founded on an economic day ══');
const st = table(true);
console.table(st.rows);

// The honesty attack: an OLD citizen in an OLD business — how many read as veterans?
let n=0, vet=0, capd=0, samp=0;
for (const c of W.roster) { W.employers[c.id] = { id:'f1', name:'Old Mill', ind:'mill', tile:'3,3' }; }
const t = [];
for (const c of W.roster) { const q=M.careerOf(c.id); if(!q.ok) continue; n++;
  if (q.tenureFrom==='worklife') vet++; if (q.capped) capd++; if (q.sampled) samp++;
  t.push({ age:+M.ageOf(c.id).years.toFixed(1), tenure:+q.tenureYears.toFixed(1), grade:q.grade, boundBy:q.tenureFrom }); }
console.log('with a 60-year-old BUSINESS, tenure bound by WORKLIFE for '+vet+'/'+n+
            ' — i.e. tenure == age-18 for that many; marked SAMPLED: '+samp+'/'+n);
console.log(JSON.stringify(t.slice(0,10)));

/* And the same roster through the rebuild, which is the defect this round
   exists to close: nobody may lose a grade to a bulldozer. */
const before = W.roster.map(c => M.careerOf(c.id)).filter(q=>q.ok).map(q=>q.grade);
W.tileBorn['3,3'] = W.now;
const after = W.roster.map(c => M.careerOf(c.id)).filter(q=>q.ok).map(q=>q.grade);
let moved = 0; for (let i=0;i<before.length;i++) if (before[i]!==after[i]) moved++;
console.log('WHOLE ROSTER through a demolish+rebuild of the workplace: '+moved+'/'+before.length+
            ' grades changed (must be 0). mean grade '+
            (before.reduce((a,b)=>a+b,0)/before.length).toFixed(2)+' -> '+
            (after.reduce((a,b)=>a+b,0)/after.length).toFixed(2));
