import { abRun } from './_forge-harness.mjs';
const rep = await abRun('.gauntlet/_c3-dead.mjs', {
  ref: process.argv[3] || 'refs/forge-width/before',
  baseRef: process.argv[2] || 'refs/forge-width/after',
  allowOneSided: ['public/assets'], timeout: 1800000,
});
const grab = (s) => {
  const l = String((s && s.stdout) || '').split('\n').find(x => x.startsWith('__C3DEAD__'));
  return l ? JSON.parse(l.slice(10)) : null;
};
const A = grab(rep.base), B = grab(rep.head);
if (!A || !B) { console.log('missing line'); console.log(JSON.stringify(rep.base).slice(0, 2500));
  console.log(JSON.stringify(rep.head).slice(0, 2500)); process.exit(2); }
console.log('worktrees ' + rep.worktrees.created.join(' ') + ' removed ' + rep.worktrees.removed.length
  + ' asym ' + JSON.stringify(rep.asymmetric));
for (const k of Object.keys(A.r)) {
  const a = A.r[k], b = B.r[k] || {};
  console.log('\n== ' + k);
  const row = (n, f) => console.log('   ' + n.padEnd(22) + String(f(b)).padEnd(26) + '->  ' + String(f(a)));
  row('.fx-props scrollH', x => x.propsScrollH);
  row('.full n / total h', x => x.fullN + ' / ' + x.fullH);
  row('DEAD px in .full', x => x.deadTotal);
  row('DEAD px all fields', x => x.deadAll);
  row('min grid col', x => x.minCol);
  row('min visible field w', x => x.minFieldW);
  row('labels trunc / >2 real', x => x.truncN + ' / ' + x.overRect + ' of ' + x.labelsVis);
  row('stickOut / zeroW', x => x.stickOut + ' / ' + x.zeroW);
  row('min input/select h', x => x.minCtlH);
  console.log('   worst dead BEFORE: ' + JSON.stringify((b.worst || []).slice(0, 4)));
  console.log('   worst dead AFTER : ' + JSON.stringify((a.worst || []).slice(0, 4)));
}
console.log('\npage errors before=' + JSON.stringify(B.pageErrors) + ' after=' + JSON.stringify(A.pageErrors));
