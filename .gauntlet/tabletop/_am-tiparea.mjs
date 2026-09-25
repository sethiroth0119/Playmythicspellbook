/* arena-markings r1 — the hypothesis, tested as geometry before it is built.
   ══════════════════════════════════════════════════════════════════════════
   CLAIM: a band centred on a ROW BOUNDARY of a pointy-top lattice paints only
   the TAPERING TIPS of the two rows it lies between, until its half-width
   reaches (hexV - hexSize)/2. Below that threshold the band has NO full-width
   ground anywhere along it and reads as a row of slivers, not a line — which is
   the defect MARKS.lineW's header already diagnosed for the CENTRE line and
   fixed by widening it. The deployment line is the same construction at the
   same kind of position and was left at 0.62x of that width.

   This computes the painted AREA per row-pair as a function of half-width,
   using the real pointy-top profile, and reports where the curve bends.
   🔴 NEGATIVE CONTROL: it also runs the identical computation for a band on a
   row CENTRE, where no threshold should exist and the curve must be a straight
   line. If BOTH curves bend the same way the model is wrong and so is the fix.
   Numbers are the page's own: hexV 0.866, hexSize 0.577 (from _am-geom.mjs). */
const HV = 0.866, R = 0.5774, HW = Math.sqrt(3) * R;   /* pointy-top */
/* half-extent in x of one hex at a distance dz from its centre */
const halfX = dz => {
  const a = Math.abs(dz);
  if (a >= R) return 0;
  if (a <= R/2) return HW/2;
  return (HW/2) * (R - a) / (R/2);
};
/* painted area of a band [c-h, c+h] over one row whose centre is at rc */
const area = (c, h, rc) => {
  const N = 4000; let s = 0;
  for (let i = 0; i < N; i++){
    const z = c - h + (i + 0.5) * (2*h/N);
    s += 2 * halfX(z - rc) * (2*h/N);
  }
  return s;
};
const THRESH = (HV - R) / 2;
console.log('full-width threshold  h >= (hexV - hexSize)/2 = ' + THRESH.toFixed(4) + ' world  (' + (THRESH/HV).toFixed(4) + ' hexV)');
console.log('shipped centre line   h = 0.26 hexV = ' + (0.26*HV).toFixed(4) + '   -> ' + (0.26*HV >= THRESH ? 'CLEARS it' : 'BELOW it'));
console.log('shipped deploy line   h = 0.26*0.62 hexV = ' + (0.26*0.62*HV).toFixed(4) + ' -> ' + (0.26*0.62*HV >= THRESH ? 'CLEARS it' : 'BELOW it — the claim'));
console.log('');
const hs = [0.05,0.08,0.10,0.12,0.1395,0.16,0.18,0.1945,0.21,0.225,0.25,0.28];
console.log('  h      ON A ROW BOUNDARY            ON A ROW CENTRE (control)');
console.log('  world  area   area/h  d(area)/dh    area   area/h  d(area)/dh');
let pb = 0, pc = 0, ph = 0;
for (const h of hs){
  /* boundary: the two rows sit at -HV/2 and +HV/2 */
  const ab = area(0, h, -HV/2) + area(0, h, HV/2);
  /* control: one row centred on the band */
  const ac = area(0, h, 0);
  const db = ph ? (ab-pb)/(h-ph) : NaN, dc = ph ? (ac-pc)/(h-ph) : NaN;
  console.log('  ' + h.toFixed(4) + ' ' + ab.toFixed(4).padStart(6) + ' ' + (ab/h).toFixed(3).padStart(7) + ' ' +
              (isNaN(db)?'   —  ':db.toFixed(3).padStart(6)) + '        ' +
              ac.toFixed(4).padStart(6) + ' ' + (ac/h).toFixed(3).padStart(7) + ' ' +
              (isNaN(dc)?'   —  ':dc.toFixed(3).padStart(6)) +
              (Math.abs(h - THRESH) < 0.006 ? '   <= THRESHOLD' : ''));
  pb = ab; pc = ac; ph = h;
}
console.log('');
console.log('read: on a row CENTRE d(area)/dh is flat (a straight line — the control behaves).');
console.log('      on a row BOUNDARY d(area)/dh is near zero below the threshold and climbs');
console.log('      steeply past it: paint added below the threshold lands on hex POINTS.');
