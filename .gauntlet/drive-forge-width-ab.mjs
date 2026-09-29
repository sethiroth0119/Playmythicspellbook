/* ══════════════════════════════════════════════════════════════════════════
   📐 DRIVE-FORGE-WIDTH-AB — the same driver, run twice: once on this working
   tree and once on HEAD in a git worktree (abRun; NEVER git stash — other
   agents write to this tree and deploy.mjs minifies index.html in place).

   Prints both metric sets side by side and then judges every clause of the
   bar. Screenshots land in %TEMP%\forge-width-shots\ as forge-<side>-<w>.png.

   THE RUN THAT PRODUCED THE NUMBERS IN index.html's comments — two refs that
   differ by this piece's diff and nothing else (133 insertions, 2 deletions,
   all of it CSS under .fx-two), kept alive under refs/forge-width/ so it can
   be re-run months later:

       node .gauntlet/drive-forge-width-ab.mjs refs/forge-width/after refs/forge-width/before

   refs/forge-width/after is byte-identical to public/index.html as this piece
   left it. To rebuild the pair by hand from a working tree (no git stash — this
   tree is shared and deploy.mjs minifies index.html in place):

       GIT_INDEX_FILE=/tmp/i git read-tree HEAD
       GIT_INDEX_FILE=/tmp/i git update-index --add --cacheinfo 100644,$(git hash-object -w public/index.html),public/index.html
       GIT_INDEX_FILE=/tmp/i git write-tree | xargs -I{} git commit-tree {} -p HEAD -m after

   Run (working tree vs HEAD, only in a tree nothing else is writing to):
       node .gauntlet/drive-forge-width-ab.mjs
   ══════════════════════════════════════════════════════════════════════════ */
import { abRun } from './_forge-harness.mjs';

/* ⚠ NOT `ref: HEAD` AGAINST THE WORKING TREE, and the reason is measured: this
   tree is shared, and at the time of writing it carried 64 modified tracked
   files and four whole untracked module directories from other agents' work —
   public/index.html alone is 5,783 lines ahead of HEAD. abRun REFUSED that A/B
   by name (AbAsymmetricPathError, 17 one-sided reads under public/src), and it
   was right to: a difference measured across it is not attributable to this
   change.
   So both sides are git refs built from ONE tree — HEAD's, with only
   public/index.html swapped — and they differ by exactly the 98 added and 3
   removed lines of this piece's diff (git diff --stat between them). Pass them
   in, newest first:
     node .gauntlet/drive-forge-width-ab.mjs <AFTER-ref> <BEFORE-ref>
   With no arguments it falls back to comparing the working tree against HEAD,
   which is the right call in a tree only this piece is writing to. */
const AFTER_REF = process.argv[2] || null;
const BEFORE_REF = process.argv[3] || 'HEAD';

const rep = await abRun('.gauntlet/drive-forge-width.mjs', {
  ref: BEFORE_REF,                   // → report.head = BEFORE
  baseRef: AFTER_REF || undefined,   // → report.base = AFTER (omitted: the working tree)
  allowOneSided: ['public/assets'],  // served from the main tree on both sides
  timeout: 1800000,
});

const grab = (side) => {
  const txt = (side && side.stdout) || (side && side.out) || '';
  const m = String(txt).split('\n').find(l => l.startsWith('__FW__'));
  if (!m) return null;
  try { return JSON.parse(m.slice(6)); } catch (e) { return null; }
};
const AFTER = grab(rep.base), BEFORE = grab(rep.head);
if (!AFTER || !BEFORE) {
  console.log('driver stdout missing __FW__ line.');
  console.log('base keys', Object.keys(rep.base || {}), 'head keys', Object.keys(rep.head || {}));
  console.log('BASE:', JSON.stringify(rep.base).slice(0, 3000));
  console.log('HEAD:', JSON.stringify(rep.head).slice(0, 3000));
  process.exit(1);
}

const W = [1600, 1280, 1080, 720];
const pct = (a, b) => (100 * (a - b) / b).toFixed(1) + '%';
const fails = [];
const ok = (cond, msg) => { if (!cond) fails.push(msg); return cond ? 'PASS' : 'FAIL'; };
/* ⚠ A SECOND LIST, AND IT IS NOT A LOOPHOLE. "no individual label wraps to
   more lines than it did" is a check this driver invented — it is stricter
   than the bar, which asks for nothing truncated and no CAPTION past two
   lines. It is kept, printed in full, and it fails: at 1080 the stacked
   properties column trades 2 x 379px for 3 x 288px and 16 sentence labels gain
   a line. Folding it into the bar's own exit code would let the next reader
   think the bar failed; dropping it would hide the one number this change
   moves the wrong way. So it is judged separately and printed second. */
const beyond = [];
const okBeyond = (cond, msg) => { if (!cond) beyond.push(msg); return cond ? 'PASS' : 'FAIL'; };

console.log('\n════ FORGE EDITOR WIDTH — HEAD (before) vs working tree (after) ════');
console.log('worktrees created:', rep.worktrees.created.join(' '), '| removed:', rep.worktrees.removed.length,
  '| one-sided allowed:', JSON.stringify(rep.oneSidedAllowed));
for (const w of W) {
  const b = BEFORE.widths[w], a = AFTER.widths[w];
  console.log(`\n── ${w}x1000 ─────────────────────────────────────────────`);
  const row = (k, f) => console.log('   ' + k.padEnd(22) + String(f(b)).padEnd(26) + '→  ' + String(f(a)));
  row('.card-editor width', x => x.editorW + 'px (max-width ' + x.editorMaxW + ')');
  row('.fx-props scrollH', x => x.propsScrollH);
  console.log('   ' + 'density Δ'.padEnd(22) + pct(a.propsScrollH, b.propsScrollH));
  row('document scrollH', x => x.docScrollH);
  row('grid columns', x => JSON.stringify(x.colCounts) + ' min ' + x.minCol + 'px');
  row('min ctl h (css/dev)', x => x.minCtlHCss + ' / ' + x.minCtlH);
  row('min checkbox h', x => x.minBoxHCss);
  row('min font lab/ctl', x => x.minLabFont + ' / ' + x.minCtlFont);
  row('labels truncated', x => x.truncated.length + (x.truncated.length ? ' ' + JSON.stringify(x.truncated.slice(0, 3)) : ''));
  row('captions >2 lines', x => x.capWrappedN + ' of ' + x.capN);
  row('any label >2 lines', x => x.wrappedN + ' of ' + x.labN);
  row('h-scrollbar', x => x.hScroll + ' (' + x.docScrollW + '/' + x.docClientW + ')');
  row('.fx-props top', x => x.propsTop + ' (viewport ' + x.h + ', above fold ' + x.propsAboveFold + ')');
  row('.full block width', x => x.fullMaxW + 'px, prose ' + x.fullProseMaxW + 'px');
  row('move editor', x => x.others.move.w + 'px max-width ' + x.others.move.maxW);
  row('event editor', x => x.others.event.w + 'px max-width ' + x.others.event.maxW);
  row('trait modal', x => 'parent=' + x.modal.parentTag + ' offsetParent=' + x.modal.offsetParent
    + ' pos=' + x.modal.position + ' inViewport=' + x.modal.inViewport);
  row('modal trap ancestors', x => JSON.stringify(x.modal.trapAncestors));
  row('open-set applied', x => x.openApplied.join(',') + ' +' + x.closedApplied + ' closed');
  row('.editor-field count', x => x.fields);
  /* per-label regression: same DOM order, same open-set, so index-wise. */
  let reg = [];
  if (a.labels && b.labels && a.labels.length === b.labels.length) {
    for (let i = 0; i < a.labels.length; i++) {
      if (a.labels[i][1] <= b.labels[i][1]) continue;
      /* print BOTH texts: if they differ the two runs are not comparing the
         same label and the "regression" is index drift, not a wrap. */
      reg.push('[' + i + '] ' + b.labels[i][0] + ' ' + b.labels[i][1] + '→' + a.labels[i][1]
        + (a.labels[i][0] === b.labels[i][0] ? '' : '  ⚠ AFTER text is ' + JSON.stringify(a.labels[i][0])));
    }
  } else reg = ['label count differs: ' + (b.labels || []).length + ' vs ' + (a.labels || []).length];
  console.log('   ' + 'labels that got worse'.padEnd(22) + reg.length + (reg.length ? ' ' + JSON.stringify(reg.slice(0, 6)) : ''));
  a._reg = reg;
}

console.log('\n════ THE BAR ════');
const b16 = BEFORE.widths[1600], a16 = AFTER.widths[1600];
console.log('DENSITY  1600 editor width  HEAD ' + b16.editorW + ' → ' + a16.editorW + '  (need >1300, HEAD exactly 900)  '
  + ok(a16.editorW > 1300 && b16.editorW === 900, 'editor width at 1600'));
console.log('DENSITY  1600 .fx-props scrollHeight ' + b16.propsScrollH + ' → ' + a16.propsScrollH + '  ('
  + pct(a16.propsScrollH, b16.propsScrollH) + ', need <= -30%)  '
  + ok(a16.propsScrollH <= b16.propsScrollH * 0.7, 'density at 1600'));
for (const w of W) {
  const b = BEFORE.widths[w], a = AFTER.widths[w];
  console.log('FLOOR    ' + w + '  minCol ' + a.minCol + 'px (>=260) ' + ok(a.minCol >= 260, 'minCol@' + w)
    + ' | truncated ' + a.truncated.length + ' (=0) ' + ok(a.truncated.length === 0, 'truncated@' + w)
    + ' | captions>2ln ' + a.capWrappedN + ' (=0) ' + ok(a.capWrappedN === 0, 'caption wrap@' + w)
    + ' | ctl h ' + a.minCtlHCss + ' (>=28) ' + ok(a.minCtlHCss >= 28, 'ctl height@' + w)
    + ' | fonts ' + a.minLabFont + '/' + a.minCtlFont + ' (>= ' + b.minLabFont + '/' + b.minCtlFont + ') '
    + ok(a.minLabFont >= b.minLabFont && a.minCtlFont >= b.minCtlFont, 'font floor@' + w));
}
for (const w of W) {
  const b = BEFORE.widths[w], a = AFTER.widths[w];
  console.log('CONTROL  ' + w + '  move ' + a.others.move.w + '/' + a.others.move.maxW + ' event ' + a.others.event.w + '/'
    + a.others.event.maxW + ' (900px cap kept) ' + ok(a.others.move.maxW === '900px' && a.others.event.maxW === '900px'
      && a.others.move.w === b.others.move.w && a.others.event.w === b.others.event.w, 'other editors@' + w)
    + ' | h-scroll ' + a.hScroll + ' ' + ok(a.hScroll === false, 'hscroll@' + w)
    + ' | modal body/inViewport ' + a.modal.parentIsBody + '/' + a.modal.inViewport + ' '
    + ok(a.modal.parentIsBody && a.modal.inViewport, 'modal@' + w));
}
for (const w of [1080, 720]) {
  const b = BEFORE.widths[w], a = AFTER.widths[w];
  console.log('CONTROL  ' + w + '  .fx-props top ' + b.propsTop + ' → ' + a.propsTop + ' (< viewport ' + a.h + ') '
    + ok(a.propsTop < a.h, 'rail not full-height@' + w));
}
console.log('\n════ BEYOND THE BAR — this driver\'s own stricter check ════');
for (const w of W) {
  const a = AFTER.widths[w], b = BEFORE.widths[w];
  console.log('  ' + w + '  labels wrapping past 2 lines ' + b.wrappedN + ' → ' + a.wrappedN
    + ' of ' + a.labN + ' | individual labels that gained a line ' + a._reg.length + ' '
    + okBeyond(a._reg.length === 0, 'label regression@' + w)
    + (a._reg.length ? '\n       ' + a._reg.join('\n       ') : ''));
}
console.log(beyond.length
  ? '  ⚠ ' + beyond.length + ' stricter-than-the-bar check(s) failed: ' + beyond.join(', ')
    + '\n    (the bar asks for nothing truncated and no CAPTION past two lines; both hold at every width)'
  : '  ✅ no individual label wraps to more lines than it did');

console.log('\nBEFORE shots:', W.map(w => BEFORE.widths[w].shot).join('\n              '));
console.log('AFTER  shots:', W.map(w => AFTER.widths[w].shot).join('\n              '));
console.log('\npage errors  before=' + JSON.stringify(BEFORE.pageErrors) + ' after=' + JSON.stringify(AFTER.pageErrors));
console.log(fails.length ? '\n❌ ' + fails.length + ' clause(s) failed: ' + fails.join(', ') : '\n✅ every clause of the bar passed');
process.exit(fails.length ? 1 : 0);
