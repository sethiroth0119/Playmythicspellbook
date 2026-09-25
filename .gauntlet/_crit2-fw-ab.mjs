/* 🔎 _CRIT2-FW-AB — second critic's own A/B wrapper. Two git worktrees via
   abRun (never git stash).
     node .gauntlet/_crit2-fw-ab.mjs <AFTER-ref> <BEFORE-ref>                */
import { abRun } from './_forge-harness.mjs';

const AFTER_REF = process.argv[2];
const BEFORE_REF = process.argv[3] || 'HEAD';

const rep = await abRun('.gauntlet/_crit2-fw.mjs', {
  ref: BEFORE_REF,
  baseRef: AFTER_REF,
  allowOneSided: ['public/assets'],
  timeout: 2400000,
});
const grab = (s) => {
  const txt = (s && s.stdout) || (s && s.out) || '';
  const l = String(txt).split('\n').find(x => x.startsWith('__C2FW__'));
  if (!l) return null;
  try { return JSON.parse(l.slice(8)); } catch (e) { return null; }
};
const A = grab(rep.base), B = grab(rep.head);   // base worktree = AFTER, head = BEFORE
if (!A || !B) {
  console.log('MISSING __C2FW__');
  console.log('AFTER:', JSON.stringify(rep.base).slice(0, 5000));
  console.log('BEFORE:', JSON.stringify(rep.head).slice(0, 5000));
  process.exit(2);
}
const W = [1600, 1280, 1080, 720];
const pct = (a, b) => (100 * (a - b) / b).toFixed(1) + '%';
const fails = [];
const ok = (c, m) => { if (!c) fails.push(m); return c ? 'PASS' : 'FAIL'; };

console.log('\n==== CRITIC-2 A/B   BEFORE=' + BEFORE_REF + '   AFTER=' + AFTER_REF + ' ====');
console.log('worktrees created:', rep.worktrees.created.join(' '), '| removed', rep.worktrees.removed.length);
console.log('asymmetric:', JSON.stringify(rep.asymmetric));
console.log('seed BEFORE', JSON.stringify(B.seed), ' AFTER', JSON.stringify(A.seed));

for (const w of W) {
  const b = B.widths[w], a = A.widths[w];
  console.log('\n---- ' + w + 'x1000 ----------------------------------------');
  const row = (k, f) => console.log('  ' + k.padEnd(22) + String(f(b)).padEnd(34) + '->  ' + String(f(a)));
  row('open-set', x => x.openApplied.join(',') + ' +' + x.closedN + ' shut');
  row('open sections', x => x.openVisFields.join(' '));
  row('editor w', x => x.editorW + ' (max ' + x.editorMaxW + ')');
  row('editor tpl', x => x.editorTpl);
  row('fx-props scrollH', x => x.propsScrollH);
  console.log('  ' + 'DENSITY'.padEnd(22) + pct(a.propsScrollH, b.propsScrollH));
  row('props text len/hash', x => x.txtLen + ' / ' + x.txtHash);
  row('fields all/vis', x => x.fieldsAll + '/' + x.fieldsVis);
  row('labels/ctls vis', x => x.labelsVis + '/' + x.ctlsVis);
  row('grid cols', x => JSON.stringify(x.colCounts) + ' MIN ' + x.minCol);
  row('min col where', x => String(x.minColWhere).slice(0, 70));
  row('min field width', x => x.minFieldW);
  row('min input/select h', x => x.minCtlH + ' under28=' + x.under28N + ' ' + JSON.stringify(x.under28.slice(0, 2)));
  row('min box / nonbox h', x => x.minBoxH + ' / ' + x.minNonBoxH);
  row('min font lab/ctl', x => x.minLabFont + ' / ' + x.minCtlFont);
  row('label fonts', x => JSON.stringify(x.labFonts));
  row('ctl fonts', x => JSON.stringify(x.ctlFonts));
  row('labels truncated', x => x.truncN + ' ' + JSON.stringify(x.trunc.slice(0, 2)));
  row('over2 rect/box/clone', x => x.rectOver2 + '/' + x.boxOver2 + '/' + x.cloneOver2 + ' both=' + x.bothOver2 + ' of ' + x.labelsVis);
  row('h-scroll', x => x.hScroll + ' (' + x.docScrollW + '/' + x.docClientW + ')');
  row('fx-props top', x => x.propsTop + ' of vh ' + x.vh);
  row('fx-assets pos/max/h', x => x.assetsPos + ' ' + x.assetsMaxH + ' ' + x.assetsH);
  row('.full n/min/max w', x => x.fullN + ' ' + x.fullMinW + '..' + x.fullMaxW);
  row('move editor', x => JSON.stringify(x.others.move));
  row('event editor', x => JSON.stringify(x.others.event));
  row('modal', x => 'parent=' + x.modal.parentTag + ' offsetParent=' + x.modal.offsetParent + ' pos=' + x.modal.position
    + ' inVp=' + x.modal.inViewport + ' rect=' + JSON.stringify(x.modal.rect) + ' traps=' + x.modal.traps.length);
  row('hit-test painted', x => x.hit.painted + '/' + x.hit.sampled + ' ' + JSON.stringify(x.hit.blockers));
  row('ink colors[0]', x => x.inkColors[0]);
  row('shot bytes', x => x.shotTopBytes + ' / ' + x.shotPropsBytes);
  console.log('  chain BEFORE ' + JSON.stringify(b.chain));
  console.log('  chain AFTER  ' + JSON.stringify(a.chain));
  if (a.overRect.length) console.log('  AFTER rect>2 sample: ' + JSON.stringify(a.overRect.slice(0, 6)));
  if (a.overClone.length) console.log('  AFTER clone>2 sample: ' + JSON.stringify(a.overClone.slice(0, 6)));
  let reg = [];
  if (a.labels.length === b.labels.length) {
    for (let i = 0; i < a.labels.length; i++) {
      if (a.labels[i][1] <= b.labels[i][1]) continue;
      reg.push('"' + b.labels[i][0] + '" rect ' + b.labels[i][1] + '->' + a.labels[i][1] + (a.labels[i][0] === b.labels[i][0] ? '' : ' DRIFT'));
    }
  } else reg = ['LABEL COUNT DIFFERS ' + b.labels.length + ' vs ' + a.labels.length];
  console.log('  labels that gained a rect-line: ' + reg.length + (reg.length ? '\n    ' + reg.slice(0, 12).join('\n    ') : ''));
}

console.log('\n==== THE BAR ====');
const b16 = B.widths[1600], a16 = A.widths[1600];
console.log('D1 width@1600 ' + b16.editorW + ' -> ' + a16.editorW + ' (AFTER>1300, BEFORE==900) '
  + ok(a16.editorW > 1300 && b16.editorW === 900, 'D1'));
console.log('D2 propsH@1600 ' + b16.propsScrollH + ' -> ' + a16.propsScrollH + ' = ' + pct(a16.propsScrollH, b16.propsScrollH)
  + ' (need <=-30%) ' + ok(a16.propsScrollH <= b16.propsScrollH * 0.7, 'D2'));
console.log('D3 same open-set both sides ' + ok(JSON.stringify(a16.openApplied) === JSON.stringify(b16.openApplied)
  && a16.closedN === b16.closedN, 'D3 open-set'));
console.log('D4 content preserved@1600 txt ' + b16.txtLen + '->' + a16.txtLen + ' hash '
  + (b16.txtHash === a16.txtHash ? 'IDENTICAL' : 'DIFFERS') + ' fieldsVis ' + b16.fieldsVis + '->' + a16.fieldsVis + ' '
  + ok(a16.txtLen >= b16.txtLen && a16.fieldsVis >= b16.fieldsVis, 'D4 content'));
for (const w of W) {
  const b = B.widths[w], a = A.widths[w];
  console.log('L' + String(w).padEnd(5) + ' minCol ' + a.minCol + ' ' + ok(a.minCol >= 260, 'minCol@' + w)
    + ' | trunc ' + a.truncN + ' ' + ok(a.truncN === 0, 'trunc@' + w)
    + ' | ctlH ' + a.minCtlH + ' (u28 ' + a.under28N + ') ' + ok(a.minCtlH >= 28 && a.under28N === 0, 'ctlH@' + w)
    + ' | labFont ' + a.minLabFont + '>=' + b.minLabFont + ' ' + ok(a.minLabFont >= b.minLabFont, 'labFont@' + w)
    + ' | ctlFont ' + a.minCtlFont + '>=' + b.minCtlFont + ' ' + ok(a.minCtlFont >= b.minCtlFont, 'ctlFont@' + w)
    + ' | over2 rect ' + a.rectOver2 + ' ' + ok(a.rectOver2 === 0, 'wrap-rect@' + w)
    + ' | clone ' + a.cloneOver2 + ' ' + ok(a.cloneOver2 === 0, 'wrap-clone@' + w));
}
for (const w of W) {
  const b = B.widths[w], a = A.widths[w];
  console.log('C' + String(w).padEnd(5) + ' move ' + a.others.move.w + '/' + a.others.move.maxW
    + ' event ' + a.others.event.w + '/' + a.others.event.maxW + ' '
    + ok(a.others.move.maxW === '900px' && a.others.event.maxW === '900px'
      && a.others.move.w === b.others.move.w && a.others.event.w === b.others.event.w, 'others@' + w)
    + ' | hScroll ' + a.hScroll + ' ' + ok(a.hScroll === false, 'hscroll@' + w)
    + ' | modal body ' + a.modal.parentIsBody + ' inVp ' + a.modal.inViewport + ' '
    + ok(a.modal.parentIsBody && a.modal.inViewport, 'modal@' + w)
    + ' | traps ' + a.modal.traps.length + ' vs ' + b.modal.traps.length + ' ' + ok(a.modal.traps.length <= b.modal.traps.length, 'traps@' + w));
}
for (const w of [1080, 720]) {
  const b = B.widths[w], a = A.widths[w];
  console.log('R' + w + ' fx-props top ' + b.propsTop + ' -> ' + a.propsTop + ' (< vh ' + a.vh + ') ' + ok(a.propsTop < a.vh, 'rail@' + w));
}
console.log('page errors BEFORE ' + JSON.stringify(B.pageErrors) + ' AFTER ' + JSON.stringify(A.pageErrors));
console.log('\nBEFORE shots: ' + W.map(w => B.widths[w].shotTop).join(' '));
console.log('AFTER  shots: ' + W.map(w => A.widths[w].shotTop).join(' '));
console.log('AFTER  props shots: ' + W.map(w => A.widths[w].shotProps).join(' '));
console.log(fails.length ? '\nFAILED (' + fails.length + '): ' + fails.join(', ') : '\nALL CLAUSES PASSED');
process.exit(fails.length ? 1 : 0);
