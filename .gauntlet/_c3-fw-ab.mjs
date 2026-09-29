/* 🔎 _C3-FW-AB — third critic's A/B judge. Two git worktrees, never git stash.
     node .gauntlet/_c3-fw-ab.mjs <AFTER-ref> <BEFORE-ref>                  */
import { abRun } from './_forge-harness.mjs';

const AFTER_REF = process.argv[2] || null;
const BEFORE_REF = process.argv[3] || 'HEAD';

const rep = await abRun('.gauntlet/_c3-fw.mjs', {
  ref: BEFORE_REF, baseRef: AFTER_REF || undefined,
  allowOneSided: ['public/assets'], timeout: 1800000,
});
const grab = (s) => {
  const txt = (s && s.stdout) || (s && s.out) || '';
  const l = String(txt).split('\n').find(x => x.startsWith('__C3FW__'));
  if (!l) return null;
  try { return JSON.parse(l.slice(8)); } catch (e) { return null; }
};
const A = grab(rep.base), B = grab(rep.head);
if (!A || !B) {
  console.log('missing __C3FW__ line');
  console.log('BASE:', JSON.stringify(rep.base).slice(0, 3000));
  console.log('HEAD:', JSON.stringify(rep.head).slice(0, 3000));
  process.exit(2);
}
const W = [1600, 1280, 1080, 720];
const pct = (a, b) => (100 * (a - b) / b).toFixed(1) + '%';
const fails = [];
const ok = (c, m) => { if (!c) fails.push(m); return c ? 'PASS' : 'FAIL'; };

console.log('\n==== C3 A/B  BEFORE=' + BEFORE_REF + '  AFTER=' + (AFTER_REF || 'tree') + ' ====');
console.log('worktrees created: ' + rep.worktrees.created.join(' ') + ' | removed ' + rep.worktrees.removed.length);
console.log('asymmetric: ' + JSON.stringify(rep.asymmetric));
console.log('cwds: before=' + B.cwd + '  after=' + A.cwd);

for (const w of W) {
  const b = B.widths[w], a = A.widths[w];
  console.log('\n-- ' + w + 'x1000 ------------------------------------------');
  const row = (k, f) => console.log('   ' + k.padEnd(26) + String(f(b)).padEnd(34) + '->  ' + String(f(a)));
  row('open-set', x => x.openApplied.join(' ') + ' +' + x.closedN + ' shut / ' + x.detailsN);
  row('editor width', x => x.edW + ' (max ' + x.edMaxW + ')');
  row('editor template', x => x.edTpl);
  row('.fx-props scrollH', x => x.propsScrollH);
  console.log('   ' + 'DENSITY DELTA'.padEnd(26) + pct(a.propsScrollH, b.propsScrollH));
  row('innerText len / hash', x => x.txtLen + ' / ' + x.txtHash);
  row('fields all/vis, ctl, lab', x => x.fieldsAll + '/' + x.fieldsVis + ', ' + x.ctlsVis + ', ' + x.labelsVis + ', opts ' + x.optionsN);
  row('grid cols / minCol', x => JSON.stringify(x.colCounts) + ' min ' + x.minCol);
  row('min input/select h', x => x.minCtlH + ' under28=' + x.under28N + ' ' + JSON.stringify(x.under28.slice(0, 2)));
  row('box/nonbox min h', x => x.boxMinH + ' / ' + x.nonBoxMinH);
  row('min font lab/ctl', x => x.minLabFont + ' / ' + x.minCtlFont);
  row('lab font hist', x => JSON.stringify(x.labFonts));
  row('ctl font hist', x => JSON.stringify(x.ctlFonts));
  row('labels truncated', x => x.truncN + ' ' + JSON.stringify(x.trunc.slice(0, 2)));
  row('labels >2 rect/adj/raw', x => x.overRect + ' / ' + x.overAdj + ' / ' + x.overRaw + ' of ' + x.labelsVis);
  row('labels clipped vert', x => x.clippedY);
  row('sticking out of props', x => x.stickOutN + ' ' + JSON.stringify(x.stickOut.slice(0, 2)));
  row('zero-width fields', x => x.zeroWN + ' ' + JSON.stringify(x.zeroW.slice(0, 2)));
  row('h-scroll doc', x => x.hScroll + ' (' + x.docScrollW + '/' + x.docClientW + ')');
  row('.fx-props top / vh', x => x.propsTop + ' / ' + x.vh);
  row('rail pos/maxH/h/reach', x => x.railPos + ' ' + x.railMaxH + ' h=' + x.railH + ' ovfY=' + x.railOvfY
    + ' reach=' + x.railReachable + ' belowFold=' + x.railCtlBelowFold + '/' + x.railCtlN);
  row('.full n / min / max w', x => x.fullN + ' ' + x.fullMinW + ' ' + x.fullMaxW);
  row('move editor', x => JSON.stringify(x.others.move));
  row('event editor', x => JSON.stringify(x.others.event));
  row('modal', x => 'parent=' + x.modal.parentTag + ' isBody=' + x.modal.parentIsBody
    + ' offsetParent=' + x.modal.offsetParent + ' pos=' + x.modal.position
    + ' inVp=' + x.modal.inViewport + ' panelInVp=' + x.modal.panelInVp + ' rect=' + JSON.stringify(x.modal.rect));
  row('modal traps', x => JSON.stringify(x.modal.trapAncestors));
  console.log('   chrome BEFORE: ' + JSON.stringify(b.chrome));
  console.log('   chrome AFTER : ' + JSON.stringify(a.chrome));
  if (a.overRectList.length) console.log('   AFTER labels >2 real lines: ' + JSON.stringify(a.overRectList));
  if (a.disagree.length) console.log('   AFTER raw-vs-rect disagreements: ' + JSON.stringify(a.disagree.slice(0, 4)));
  let reg = [];
  if (a.labels.length === b.labels.length) {
    for (let i = 0; i < a.labels.length; i++) {
      if (a.labels[i][1] <= b.labels[i][1]) continue;
      reg.push('[' + i + '] "' + b.labels[i][0] + '" ' + b.labels[i][1] + '->' + a.labels[i][1]
        + (a.labels[i][0] === b.labels[i][0] ? '' : ' TEXT-DRIFT "' + a.labels[i][0] + '"'));
    }
  } else reg = ['label count differs ' + b.labels.length + ' vs ' + a.labels.length];
  console.log('   labels that gained a REAL line: ' + reg.length + (reg.length ? '\n     ' + reg.slice(0, 12).join('\n     ') : ''));
}

console.log('\n==== THE BAR ====');
const b16 = B.widths[1600], a16 = A.widths[1600];
console.log('D1  editor width @1600 ' + b16.edW + ' -> ' + a16.edW + '  (AFTER>1300, BEFORE==900)  '
  + ok(a16.edW > 1300 && b16.edW === 900, 'D1 width'));
console.log('D2  .fx-props scrollH @1600 ' + b16.propsScrollH + ' -> ' + a16.propsScrollH + ' ' + pct(a16.propsScrollH, b16.propsScrollH)
  + '  (need <= -30%)  ' + ok(a16.propsScrollH <= b16.propsScrollH * 0.7, 'D2 density'));
console.log('D3  content preserved @1600 txt ' + b16.txtLen + '->' + a16.txtLen + ' hash '
  + (b16.txtHash === a16.txtHash ? 'SAME' : 'DIFFERENT') + ' fieldsVis ' + b16.fieldsVis + '->' + a16.fieldsVis + ' '
  + ok(a16.txtHash === b16.txtHash && a16.fieldsVis >= b16.fieldsVis, 'D3 content'));
for (const w of W) {
  const b = B.widths[w], a = A.widths[w];
  console.log('L' + String(w).padEnd(5) + 'minCol ' + a.minCol + ' ' + ok(a.minCol >= 260, 'minCol@' + w)
    + ' | trunc ' + a.truncN + ' ' + ok(a.truncN === 0, 'trunc@' + w)
    + ' | >2 real lines ' + a.overRect + ' ' + ok(a.overRect === 0, 'wrap2@' + w)
    + ' | ctlH ' + a.minCtlH + ' ' + ok(a.minCtlH >= 28, 'ctlH@' + w)
    + ' | labFont ' + a.minLabFont + '>=' + b.minLabFont + ' ' + ok(a.minLabFont >= b.minLabFont, 'labF@' + w)
    + ' | ctlFont ' + a.minCtlFont + '>=' + b.minCtlFont + ' ' + ok(a.minCtlFont >= b.minCtlFont, 'ctlF@' + w));
}
for (const w of W) {
  const b = B.widths[w], a = A.widths[w];
  console.log('C' + String(w).padEnd(5) + 'move ' + a.others.move.w + '/' + a.others.move.maxW
    + ' event ' + a.others.event.w + '/' + a.others.event.maxW + ' '
    + ok(a.others.move.maxW === '900px' && a.others.event.maxW === '900px'
      && a.others.move.w === b.others.move.w && a.others.event.w === b.others.event.w, 'others@' + w)
    + ' | grids same ' + ok(JSON.stringify(a.others.move.grids) === JSON.stringify(b.others.move.grids)
      && JSON.stringify(a.others.event.grids) === JSON.stringify(b.others.event.grids), 'otherGrids@' + w)
    + ' | boxH ' + a.others.move.boxH + ' ' + ok(a.others.move.boxH === b.others.move.boxH, 'otherBox@' + w)
    + ' | hScroll ' + a.hScroll + ' ' + ok(a.hScroll === false, 'hscroll@' + w)
    + ' | modal body ' + a.modal.parentIsBody + ' inVp ' + a.modal.inViewport + ' '
    + ok(a.modal.parentIsBody && a.modal.inViewport, 'modal@' + w)
    + ' | traps ' + a.modal.trapAncestors.length + '<=' + b.modal.trapAncestors.length + ' '
    + ok(a.modal.trapAncestors.length <= b.modal.trapAncestors.length, 'trap@' + w)
    + ' | stickOut ' + a.stickOutN + ' (was ' + b.stickOutN + ') ' + ok(a.stickOutN <= b.stickOutN, 'stickOut@' + w)
    + ' | railReach ' + a.railReachable + ' ' + ok(a.railReachable !== false, 'railReach@' + w));
}
for (const w of [1080, 720]) {
  const b = B.widths[w], a = A.widths[w];
  console.log('R' + String(w).padEnd(5) + '.fx-props top ' + b.propsTop + ' -> ' + a.propsTop + ' (< vh ' + a.vh + ') '
    + ok(a.propsTop < a.vh, 'railFold@' + w));
}
console.log('\nBEFORE shots: ' + W.map(w => B.widths[w].shot).join(' '));
console.log('AFTER  shots: ' + W.map(w => A.widths[w].shot).join(' '));
console.log('BEFORE props: ' + W.map(w => B.widths[w].shotProps).join(' '));
console.log('AFTER  props: ' + W.map(w => A.widths[w].shotProps).join(' '));
console.log('AFTER  deep : ' + W.map(w => A.widths[w].shotDeep).join(' '));
console.log('page errors before=' + JSON.stringify(B.pageErrors) + ' after=' + JSON.stringify(A.pageErrors));
console.log(fails.length ? '\nFAILED (' + fails.length + '): ' + fails.join(', ') : '\nALL CLAUSES PASSED');
process.exit(fails.length ? 1 : 0);
