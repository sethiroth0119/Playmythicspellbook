import { abRun } from './_forge-harness.mjs';
const rep = await abRun('.gauntlet/_c3-mobile.mjs', {
  ref: 'refs/forge-width/before', baseRef: 'refs/forge-width/after',
  allowOneSided: ['public/assets'], timeout: 1800000 });
const grab = s => { const l = String((s && s.stdout) || '').split('\n').find(x => x.startsWith('__C3MOB__'));
  return l ? JSON.parse(l.slice(9)) : null; };
const A = grab(rep.base), B = grab(rep.head);
if (!A || !B) { console.log('missing'); console.log(JSON.stringify(rep.base).slice(0,2000)); console.log(JSON.stringify(rep.head).slice(0,2000)); process.exit(2); }
for (const w of Object.keys(A.w)) {
  const a = A.w[w], b = B.w[w];
  console.log('\n== ' + w + 'px viewport');
  const row = (n, f) => console.log('   ' + n.padEnd(24) + String(f(b)).padEnd(30) + '->  ' + String(f(a)));
  row('html zoom', x => x.htmlZoom);
  row('PAGE H-SCROLL', x => x.hScroll + ' (' + x.docScrollW + '/' + x.docClientW + ')');
  row('.fx-props w', x => x.propsW);
  row('.fx-props overflows X', x => x.propsOverflowsX + ' (' + x.propsScrollW + '/' + x.propsClientW + ')');
  row('min grid col', x => x.minCol);
  row('grids overflowing', x => x.gridsOverflowing);
  row('painted outside editor', x => x.outside + ' ' + JSON.stringify(x.outsideEg.slice(0,2)));
  row('.fx-props scrollH', x => x.propsScrollH);
  console.log('   sub-grids AFTER: ' + JSON.stringify(a.grids.filter(g=>g.sub).slice(0,4)));
  console.log('   sub-grids BEFORE: ' + JSON.stringify(b.grids.filter(g=>g.sub).slice(0,4)));
  console.log('   shots before=' + b.shot + '  after=' + a.shot);
}
console.log('\nerrors before=' + JSON.stringify(B.pageErrors) + ' after=' + JSON.stringify(A.pageErrors));
