/* 🔎 _CRIT-FW-AB — abRun wrapper for the critic's own measurement driver.
   Two git worktrees, never git stash.
     node .gauntlet/_crit-fw-ab.mjs <AFTER-ref> <BEFORE-ref>          */
import { abRun } from './_forge-harness.mjs';

const AFTER_REF = process.argv[2] || null;
const BEFORE_REF = process.argv[3] || 'HEAD';

const rep = await abRun('.gauntlet/_crit-fw.mjs', {
  ref: BEFORE_REF,
  baseRef: AFTER_REF || undefined,
  allowOneSided: ['public/assets'],
  timeout: 1800000,
});
const grab = (s) => {
  const txt = (s && s.stdout) || (s && s.out) || '';
  const l = String(txt).split('\n').find(x => x.startsWith('__CFW__'));
  if (!l) return null;
  try { return JSON.parse(l.slice(7)); } catch (e) { return null; }
};
const A = grab(rep.base), B = grab(rep.head);
if (!A || !B) {
  console.log('missing __CFW__ line');
  console.log('BASE:', JSON.stringify(rep.base).slice(0, 4000));
  console.log('HEAD:', JSON.stringify(rep.head).slice(0, 4000));
  process.exit(2);
}
const W = [1600, 1280, 1080, 720];
const pct = (a, b) => (100 * (a - b) / b).toFixed(1) + '%';
const fails = [];
const ok = (c, m) => { if (!c) fails.push(m); return c ? 'PASS' : 'FAIL'; };

console.log('\n==== CRITIC A/B  BEFORE=' + BEFORE_REF + '  AFTER=' + (AFTER_REF || 'working tree') + ' ====');
console.log('worktrees:', rep.worktrees.created.join(' '), '| removed', rep.worktrees.removed.length);
console.log('asymmetric paths watched:', JSON.stringify(rep.asymmetric));
for (const w of W) {
  const b = B.widths[w], a = A.widths[w];
  console.log('\n-- ' + w + 'x1000 --------------------------------');
  const row = (k, f) => console.log('   ' + k.padEnd(24) + String(f(b)).padEnd(30) + '->  ' + String(f(a)));
  row('editor width', x => x.editorW + ' (max ' + x.editorMaxW + ')');
  row('editor template', x => x.editorTpl);
  row('.fx-props scrollH', x => x.propsScrollH);
  console.log('   ' + 'density delta'.padEnd(24) + pct(a.propsScrollH, b.propsScrollH));
  row('.fx-props innerText len', x => x.propsTextLen + ' hash ' + x.propsTextHash);
  row('fields all/vis', x => x.fieldsAll + '/' + x.fieldsVis);
  row('ctls/labels visible', x => x.ctlsVis + '/' + x.labelsVis);
  row('open-set applied', x => x.openedDisplay.join(',') + ' +' + x.closed + ' closed');
  row('grid cols', x => JSON.stringify(x.colCounts) + ' min ' + x.minCol);
  row('RAW min input/select h', x => x.rawMinCtlCssH + ' under28=' + x.rawUnder28N + ' ' + JSON.stringify(x.rawUnder28.slice(0, 3)));
  row('nonbox/box min h', x => x.nonBoxMinCssH + ' / ' + x.boxMinCssH);
  row('min font lab/ctl', x => x.minLabFont + ' / ' + x.minCtlFont);
  row('label font histogram', x => JSON.stringify(x.labFonts));
  row('ctl font histogram', x => JSON.stringify(x.ctlFonts));
  row('labels truncated', x => x.truncN + ' ' + JSON.stringify(x.trunc.slice(0, 3)));
  row('labels >2 lines min/h/r', x => x.minLinesOver2 + '/' + x.hLinesOver2 + '/' + x.rLinesOver2 + ' of ' + x.labelsVis);
  row('h-scroll', x => x.hScroll + ' (' + x.docScrollW + '/' + x.docClientW + ')');
  row('.fx-props top', x => x.propsTop + ' (vh ' + x.vh + ')');
  row('.fx-assets pos/maxH/h', x => x.assetsPos + ' ' + x.assetsMaxH + ' ' + x.assetsH);
  row('.full max width', x => x.fullN + ' blocks, widest ' + x.fullMaxW);
  row('move editor', x => JSON.stringify(x.others.move));
  row('event editor', x => JSON.stringify(x.others.event));
  row('modal', x => 'parent=' + x.modal.parentTag + ' offsetParent=' + x.modal.offsetParent
    + ' pos=' + x.modal.position + ' inVp=' + x.modal.inViewport + ' rect=' + JSON.stringify(x.modal.rect));
  row('modal trap ancestors', x => JSON.stringify(x.modal.trapAncestors));
  console.log('   scale BEFORE: ' + JSON.stringify(b.scale));
  console.log('   scale AFTER : ' + JSON.stringify(a.scale));
  /* per-label line regression, index-wise */
  let reg = [];
  if (a.labels.length === b.labels.length) {
    for (let i = 0; i < a.labels.length; i++) {
      if (a.labels[i][1] <= b.labels[i][1]) continue;
      reg.push('[' + i + '] "' + b.labels[i][0] + '" ' + b.labels[i][1] + '->' + a.labels[i][1]
        + (a.labels[i][0] === b.labels[i][0] ? '' : ' TEXT-DRIFT after="' + a.labels[i][0] + '"'));
    }
  } else reg = ['label count differs ' + b.labels.length + ' vs ' + a.labels.length];
  console.log('   labels that gained a line: ' + reg.length + (reg.length ? '\n     ' + reg.join('\n     ') : ''));
  a._reg = reg;
}

console.log('\n==== THE BAR, JUDGED ====');
const b16 = B.widths[1600], a16 = A.widths[1600];
console.log('D1 editor width @1600  ' + b16.editorW + ' -> ' + a16.editorW
  + '  (need AFTER>1300 and BEFORE==900)  ' + ok(a16.editorW > 1300 && b16.editorW === 900, 'D1 width@1600'));
console.log('D2 .fx-props scrollH @1600  ' + b16.propsScrollH + ' -> ' + a16.propsScrollH + '  ' + pct(a16.propsScrollH, b16.propsScrollH)
  + '  (need <= -30%)  ' + ok(a16.propsScrollH <= b16.propsScrollH * 0.7, 'D2 density@1600'));
console.log('D3 content preserved @1600 (innerText len / visible fields must not fall)  '
  + b16.propsTextLen + '->' + a16.propsTextLen + ', ' + b16.fieldsVis + '->' + a16.fieldsVis + '  '
  + ok(a16.propsTextLen >= b16.propsTextLen * 0.995 && a16.fieldsVis >= b16.fieldsVis, 'D3 content@1600'));
for (const w of W) {
  const b = B.widths[w], a = A.widths[w];
  console.log('L' + w + '  minCol ' + a.minCol + ' ' + ok(a.minCol >= 260, 'minCol@' + w)
    + ' | trunc ' + a.truncN + ' ' + ok(a.truncN === 0, 'trunc@' + w)
    + ' | RAW input/select h>=28 ' + a.rawMinCtlCssH + ' ' + ok(a.rawMinCtlCssH >= 28, 'RAW ctlH@' + w)
    + ' | nonbox h ' + a.nonBoxMinCssH + ' ' + ok(a.nonBoxMinCssH >= 28, 'nonbox ctlH@' + w)
    + ' | labelFont ' + a.minLabFont + '>=' + b.minLabFont + ' ' + ok(a.minLabFont >= b.minLabFont, 'labFont@' + w)
    + ' | ctlFont ' + a.minCtlFont + '>=' + b.minCtlFont + ' ' + ok(a.minCtlFont >= b.minCtlFont, 'ctlFont@' + w)
    + ' | RAW labels>2ln ' + a.minLinesOver2 + ' ' + ok(a.minLinesOver2 === 0, 'RAW wrap<=2@' + w));
}
for (const w of W) {
  const b = B.widths[w], a = A.widths[w];
  console.log('C' + w + '  move ' + a.others.move.w + '/' + a.others.move.maxW + ' event ' + a.others.event.w + '/' + a.others.event.maxW
    + ' ' + ok(a.others.move.maxW === '900px' && a.others.event.maxW === '900px'
      && a.others.move.w === b.others.move.w && a.others.event.w === b.others.event.w, 'other editors@' + w)
    + ' | hScroll ' + a.hScroll + ' ' + ok(a.hScroll === false, 'hscroll@' + w)
    + ' | modal body ' + a.modal.parentIsBody + ' inVp ' + a.modal.inViewport + ' '
    + ok(a.modal.parentIsBody && a.modal.inViewport, 'modal@' + w)
    + ' | traps ' + a.modal.trapAncestors.length + ' vs before ' + b.modal.trapAncestors.length + ' '
    + ok(a.modal.trapAncestors.length <= b.modal.trapAncestors.length, 'no new trap@' + w));
}
for (const w of [1080, 720]) {
  const b = B.widths[w], a = A.widths[w];
  console.log('C' + w + '  .fx-props top ' + b.propsTop + ' -> ' + a.propsTop + ' (< vh ' + a.vh + ') '
    + ok(a.propsTop < a.vh, 'rail not full height@' + w));
}
console.log('\nBEFORE shots: ' + W.map(w => B.widths[w].shot).join('  '));
console.log('AFTER  shots: ' + W.map(w => A.widths[w].shot).join('  '));
console.log('BEFORE prop shots: ' + W.map(w => B.widths[w].shotProps).join('  '));
console.log('AFTER  prop shots: ' + W.map(w => A.widths[w].shotProps).join('  '));
console.log('page errors before=' + JSON.stringify(B.pageErrors) + ' after=' + JSON.stringify(A.pageErrors));
console.log(fails.length ? '\nFAILED CLAUSES (' + fails.length + '): ' + fails.join(', ')
  : '\nALL CLAUSES AS WRITTEN PASSED');
process.exit(fails.length ? 1 : 0);
