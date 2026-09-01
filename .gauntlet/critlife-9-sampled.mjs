/* CLOSES D1 / D5 / D7 / D12 at the model level, in plain node.
   The claim under test: careerOf().sampled is true EXACTLY when the term that
   binds the tenure ceiling is (age − workAge), i.e. when the printed grade is a
   restatement of the one draw in the module. */
import { makeWorld } from './critlife-harness.mjs';
const W = makeWorld();
const M = await import('../public/src/lifepath/model.js');
M.bind(W.ctx);
const clk = M.clock(); const SPY = clk.secPerYear;

/* ⏱ THE SWEEP NOW HAS A SECOND AXIS, because the ceiling has a second
   source. `firmYears` is the age of the BUSINESS (firms.js foundedDay); it is
   null for a firm restored from a save written before that stamp existed, and
   then the ceiling falls back to the building exactly as it used to. Both
   columns of the sweep have to stay honest, and the claim under test is the
   same in both: `sampled` is true EXACTLY when the worklife binds. */
const DPY = clk.daysPerYear;
W.day = Math.round(500 * DPY);
M.bind(W.ctx);   // the day cache is keyed on now(), which is frozen here

const regime = (ceilingYears, stamped, label) => {
  M.reset(); W.setRoster(40); M.seed();
  W.firms['f1'] = { id: 'f1', name: 'Old Mill', level: 5, rung: 'HEALTHY' };
  if (stamped) W.firms['f1'].foundedDay = Math.round(W.day - ceilingYears * DPY);
  /* The building is given the SAME age as the business, so the two regimes
     differ only in WHICH stamp the ceiling reads and never in its value —
     otherwise the sweep would be comparing two different cities. */
  W.tileBorn['3,3'] = W.now - ceilingYears * SPY;
  for (const c of W.roster) W.employers[c.id] = { id: 'f1', name: 'Old Mill', ind: 'mill', tile: '3,3' };
  let n = 0, worklife = 0, sampled = 0, mismatch = 0, from = {};
  for (const c of W.roster) {
    const q = M.careerOf(c.id); if (!q.ok) continue;
    n++;
    from[q.tenureFrom] = (from[q.tenureFrom] || 0) + 1;
    if (q.tenureFrom === 'worklife') worklife++;
    if (q.sampled) sampled++;
    if (q.sampled !== (q.tenureFrom === 'worklife')) mismatch++;
  }
  return { label, ceilingYears, stamp: stamped ? 'firm' : 'none (old save)', n,
           boundByWorklife: worklife, sampledTrue: sampled,
           flagMismatches: mismatch, pctSampled: +(100 * sampled / n).toFixed(1),
           boundBy: JSON.stringify(from) };
};
console.table([
  regime(0.5, false, 'young city (the round-9 driver)'),
  regime(5,   false, 'five-year-old buildings'),
  regime(60,  false, 'mature city (the critic’s regime)'),
  regime(0.5, true,  'young city, firm stamped'),
  regime(5,   true,  'five-year-old business'),
  regime(60,  true,  'mature city, firm stamped'),
]);

/* 🔴 THE REBUILD REGIME — the one the stamp exists for. Same 60-year-old
   business, but the building under it was raised THIS INSTANT. Unstamped, every
   citizen falls out of `worklife` into a site-bound 0.0 years and the row prints
   grade 1 under the word DERIVED: a wrong number wearing the stronger label.
   Stamped, they stay worklife-bound and stay marked SAMPLED. The mark must move
   toward MORE honesty here, never less. */
const rebuilt = (stamped) => {
  M.reset(); W.setRoster(40); M.seed();
  W.firms['f1'] = { id: 'f1', name: 'Old Mill', level: 5, rung: 'HEALTHY' };
  if (stamped) W.firms['f1'].foundedDay = Math.round(W.day - 60 * DPY);
  W.tileBorn['3,3'] = W.now;                       // rebuilt this instant
  for (const c of W.roster) W.employers[c.id] = { id: 'f1', name: 'Old Mill', ind: 'mill', tile: '3,3' };
  let n = 0, sampled = 0, mismatch = 0, gsum = 0, from = {};
  for (const c of W.roster) {
    const q = M.careerOf(c.id); if (!q.ok) continue;
    n++; gsum += q.grade;
    from[q.tenureFrom] = (from[q.tenureFrom] || 0) + 1;
    if (q.sampled) sampled++;
    if (q.sampled !== (q.tenureFrom === 'worklife')) mismatch++;
  }
  return { stamp: stamped ? 'firm' : 'none (old save)', n, sampledTrue: sampled,
           flagMismatches: mismatch, meanGrade: +(gsum / n).toFixed(2),
           boundBy: JSON.stringify(from) };
};
console.table([rebuilt(false), rebuilt(true)]);

/* D5 — the third site provenance. */
M.reset(); W.setRoster(40); M.seed();
W.firms['f1'] = { id: 'f1', name: 'Old Mill', level: 5, rung: 'HEALTHY' };
const id = W.roster[0].id;
W.tileBorn['3,3'] = W.now - 60 * SPY;
W.employers[id] = { id: 'f1', name: 'Old Mill', ind: 'mill', tile: '3,3' };
const a = M.careerOf(id);
delete W.tileBorn['3,3'];                       // tile demolished out from under the firm
const b = M.careerOf(id);
W.employers[id] = { id: 'f1', name: 'Old Mill', ind: 'mill', tile: null };
const c = M.careerOf(id);
console.log('D5 siteFrom: tile with a stamp =', a.siteFrom,
            '| tile named but no stamp =', b.siteFrom, '(was "tile", the lie)',
            '| firm holds no tile =', c.siteFrom);

/* D7 — the stamp guard. A citizen drawn at exactly the bottom of the young band
   must never read as a child. Sweep the whole roster and the exact boundary. */
M.reset(); W.setRoster(200); M.seed();
const st = M.stamps();
let below = 0, minAge = Infinity;
for (const k in st) { const y = (W.now - st[k]) / SPY; minAge = Math.min(minAge, y);
                      if (y < clk.workAge) below++; }
console.log('D7 stamps floored: citizens reading below workAge =', below,
            '| youngest read =', minAge.toFixed(9), '(workAge =', clk.workAge + ')');

/* D12 — the sanity floor on a read age. */
M.reset(); W.setRoster(1); M.seed();
const one = W.roster[0].id;
const probe = (years) => { M.load({ v: 1, b: { [one]: Math.floor(W.now - years * SPY) } });
                           const r = M.ageOf(one);
                           return { years, ok: r.ok, band: r.ok ? r.band : null,
                                    why: r.ok ? null : r.why.slice(0, 64) + '…' }; };
console.table([probe(-6), probe(0), probe(17.9), probe(18), probe(40), probe(150), probe(1000)]);

/* D8 — the seam now reports its own claim failing, in its own words. */
M.reset(); W.setRoster(40); M.seed();
const t0 = W.now;
const atHours = (h) => { W.now = t0 + (h / clk.hoursPerYear) * clk.secPerYear;
                         const d = M.distribution();
                         return { realHours: h, dev_pct: +(d.maxShareDev * 100).toFixed(2),
                                  bound_pct: +(d.bound * 100).toFixed(2),
                                  withinBound: d.withinBound, saysWhy: !!d.drift }; };
console.table([atHours(0), atHours(2), atHours(3), atHours(24), atHours(400)]);
W.now = t0 + (3 / clk.hoursPerYear) * clk.secPerYear;
console.log('D8 drift sentence at 3 real hours:\n  ' + M.distribution().drift);
