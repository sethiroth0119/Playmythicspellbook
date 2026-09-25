/* 🔎 FIND-THE-EFFECT — the before/after, headless, off two index.html files.
     1. lift ONPLAY_TYPES + ONPLAY_TYPE_GROUPS with _duel_smoke's own literal()
        slicer on both sides and diff {ungrouped, duplicated, groupSizes,
        labels}. The labels must be BYTE-identical.
     2. the counterScope boolean matrix: every card carrying a counterScope ×
        every ONPLAY_TYPES id, before vs after. Nothing may go true → false —
        that direction is a Counter card silently refusing something it used to
        answer, which is the failure mode with no error message anywhere.
   The "before" side is read, never checked out: no `git stash` (other agents
   write this tree and deploy.mjs minifies index.html in place) and no worktree
   left behind if this process is killed. Read the 🔴 note below on WHY it is not
   git HEAD.
   Run: node .gauntlet/_fxfind-ab.mjs */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';

const REPO = process.cwd();
const WT = path.join(os.tmpdir(), 'fxfind-head-' + process.pid);
let fails = 0;
const ok = (c, m, x) => { console.log((c ? '  PASS ' : '  FAIL ') + m + (c || x === undefined ? '' : '  ← ' + x)); if (!c) fails++; };
const git = (...a) => execFileSync('git', a, { cwd: REPO, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

/* 🔴 THE BASELINE IS NOT `git HEAD`, AND ANYONE WHO USES HEAD WILL MISREAD THIS
   CHANGE. git HEAD (bf8eb2d514) holds 110 effects in 9 groups with 2 ungrouped
   ids; the tree this piece was written on holds 118 in 10 with 6, because other
   agents have landed uncommitted work in public/index.html during this run. A
   worktree checked out at HEAD is a different registry, and an A/B against it
   reports eight effects and a whole group ("⛽🔵 Fuel & Counters") appearing out
   of nowhere and blames them on this piece. Both are printed below; the
   assertions run against the reconstructed pre-change tree, which
   _fxfind-baseline.mjs proves byte-exact by round-tripping it. */
const BASE_FILE = path.join(REPO, '.gauntlet', '_fxfind-baseline.html');
if (!fs.existsSync(BASE_FILE)) {
  execFileSync(process.execPath, ['.gauntlet/_fxfind-baseline.mjs'], { cwd: REPO, stdio: 'inherit' });
}
fs.mkdirSync(WT, { recursive: true });
const GIT_HEAD_FILE = path.join(WT, 'index.githead.html');
{
  const out = fs.openSync(GIT_HEAD_FILE, 'w');
  execFileSync('git', ['show', 'HEAD:public/index.html'], { cwd: REPO, stdio: ['ignore', out, 'pipe'] });
  fs.closeSync(out);
}
const HEAD_FILE = BASE_FILE;

/* the SAME slicer _duel_smoke.mjs:24-32 uses, so a reformatted literal throws
   here for the same reason it throws there */
function lift(file) {
  const SRC = fs.readFileSync(file, 'utf8');
  const literal = (name, open, close) => {
    const i = SRC.indexOf('const ' + name + ' = ' + open);
    if (i < 0) throw new Error('no ' + name + ' in ' + file);
    const j = SRC.indexOf('\n' + close, i);
    return SRC.slice(i + ('const ' + name + ' = ').length, j + 1 + close.length);
  };
  const types = new Function('return ' + literal('ONPLAY_TYPES', '[', '];').replace(/;$/, ''))();
  const groups = new Function('return ' + literal('ONPLAY_TYPE_GROUPS', '[', '];').replace(/;$/, ''))();
  return { types, groups };
}

function stats(m) {
  const all = m.types.map(t => t.id);
  const seen = {};
  m.groups.forEach(g => g.ids.forEach(id => { seen[id] = (seen[id] || 0) + 1; }));
  return {
    total: all.length,
    labels: m.groups.map(g => g.label),
    groupSizes: m.groups.map(g => g.ids.filter(id => all.includes(id)).length),
    ungrouped: all.filter(id => !seen[id]),
    duplicated: Object.keys(seen).filter(k => seen[k] > 1),
    phantom: Object.keys(seen).filter(k => !all.includes(k)),
  };
}

const HEAD = lift(HEAD_FILE);
const NOW = lift(path.join(REPO, 'public', 'index.html'));
const h = stats(HEAD), n = stats(NOW);

const G = stats(lift(GIT_HEAD_FILE));
console.log('\n=== 1. registry ===');
console.log('  git HEAD (bf8eb251, NOT the baseline — see the 🔴 note in this file)');
console.log('           total=' + G.total + ' groups=' + G.labels.length + ' ungrouped=' + G.ungrouped.length
  + ' [' + G.ungrouped.join(', ') + '] sizes=' + G.groupSizes.join(','));
console.log('  BEFORE total=' + h.total + ' groups=' + h.labels.length + ' ungrouped=' + h.ungrouped.length
  + ' [' + h.ungrouped.join(', ') + '] dup=' + h.duplicated.length + ' sizes=' + h.groupSizes.join(','));
console.log('  CHANGE total=' + n.total + ' groups=' + n.labels.length + ' ungrouped=' + n.ungrouped.length
  + ' [' + n.ungrouped.join(', ') + '] dup=' + n.duplicated.length + ' sizes=' + n.groupSizes.join(','));

/* 🔴 BYTE equality, not "looks the same". These strings are persisted
   counterScope data matched with indexOf; an invisible variation-selector
   difference in "⚰️" would empty every scope that names it. */
const hb = Buffer.from(JSON.stringify(h.labels), 'utf8');
const nb = Buffer.from(JSON.stringify(n.labels), 'utf8');
ok(hb.equals(nb), 'the ' + h.labels.length + ' group labels are BYTE-identical to the pre-change tree ('
  + hb.length + ' bytes both sides)', hb.toString() + '  vs  ' + nb.toString());
ok(h.total === n.total, 'the effect count is unchanged (' + h.total + ')');
ok(h.ungrouped.length === 6, 'CONTROL — the pre-change tree really did have 6 ungrouped ids', String(h.ungrouped.length));
ok(n.ungrouped.length === 0, 'zero ungrouped ids after the change', n.ungrouped.join(', '));
ok(h.duplicated.length === 0 && n.duplicated.length === 0,
  'CONTROL — no id in two groups, before ' + h.duplicated.length + ' / change ' + n.duplicated.length);
ok(n.phantom.length === 0, 'no group names an id that is not in the registry', n.phantom.join(', '));
ok(h.ungrouped.every(id => !n.ungrouped.includes(id)),
  'every one of the tree\'s 6 orphans now has a home',
  h.ungrouped.filter(id => n.ungrouped.includes(id)).join(', '));
const moved = [];
h.labels.forEach((lab, i) => {
  const was = HEAD.groups[i].ids, is = NOW.groups[i].ids;
  const gone = was.filter(x => !is.includes(x));
  const gained = is.filter(x => !was.includes(x));
  if (gone.length || gained.length) moved.push(lab + '  +[' + gained.join(', ') + ']' + (gone.length ? '  -[' + gone.join(', ') + ']' : ''));
});
moved.forEach(m => console.log('    ' + m));
ok(h.labels.every((lab, i) => HEAD.groups[i].ids.every(x => NOW.groups[i].ids.includes(x))),
  'no id was REMOVED from any group — every change is an addition');

/* 🔴 and _counterScopeOk must resolve a group for every id, which is the thing
   "🔧 Other" only pretended to do: "Other" lives in the rendered <optgroup> and
   never in ONPLAY_TYPE_GROUPS, so a scoped counter could not see those ids. */
const groupOf = (m, id) => m.groups.filter(g => g.ids.includes(id)).map(g => g.label);
ok(NOW.types.every(t => groupOf(NOW, t.id).length === 1),
  '_counterScopeOk resolves exactly one group for all ' + n.total + ' ids',
  NOW.types.filter(t => groupOf(NOW, t.id).length !== 1).map(t => t.id).join(', '));

console.log('\n=== 2. the counterScope boolean matrix ===');
/* _counterScopeOk transliterated from index.html:160025. The matrix is
   card × effect id, on both sides, for every card that carries a counterScope —
   both the ones the tree ships and a synthetic card per group label, so a
   registry with no authored counters is still exercised at full width. */
function scopeOk(groups, scope, effType) {
  if (!Array.isArray(scope) || !scope.length) return true;
  if (!effType) return false;
  for (const g of groups) {
    if (!g || scope.indexOf(g.label) < 0) continue;
    if ((g.ids || []).indexOf(effType) >= 0) return true;
  }
  return false;
}
const scopes = [];
h.labels.forEach(l => scopes.push({ name: 'scope:' + l, scope: [l] }));
for (let i = 0; i + 1 < h.labels.length; i += 2) {
  scopes.push({ name: 'scope:' + h.labels[i] + ' + ' + h.labels[i + 1], scope: [h.labels[i], h.labels[i + 1]] });
}
scopes.push({ name: 'scope:ALL TEN', scope: h.labels.slice() });
// whatever the tree actually ships with a counterScope, if anything
let shipped = 0;
try {
  const SRC = fs.readFileSync(path.join(REPO, 'public', 'index.html'), 'utf8');
  const re = /counterScope\s*:\s*(\[[^\]]*\])/g;
  let mm;
  while ((mm = re.exec(SRC))) {
    try { const arr = new Function('return ' + mm[1])(); if (Array.isArray(arr) && arr.length) { scopes.push({ name: 'shipped#' + (++shipped), scope: arr }); } } catch (e) {}
  }
} catch (e) {}
console.log('  ' + scopes.length + ' scoped cards (' + h.labels.length + ' single + '
  + Math.floor(h.labels.length / 2) + ' paired + 1 all-ten + ' + shipped + ' shipped in-source) × '
  + n.total + ' effect ids = ' + (scopes.length * n.total) + ' booleans');
let same = 0, gained = 0, lost = [];
const gainedBy = {};
for (const s of scopes) {
  for (const t of NOW.types) {
    const a = scopeOk(HEAD.groups, s.scope, t.id);
    const b = scopeOk(NOW.groups, s.scope, t.id);
    if (a === b) same++;
    else if (!a && b) { gained++; (gainedBy[t.id] = gainedBy[t.id] || 0); gainedBy[t.id]++; }
    else lost.push(s.name + ' × ' + t.id);
  }
}
console.log('  identical=' + same + '  false→true=' + gained + '  true→false=' + lost.length);
console.log('  newly answerable: ' + Object.keys(gainedBy).map(k => k + '(' + gainedBy[k] + ')').join(' '));
ok(lost.length === 0, 'NOTHING went true → false — no counter refuses anything it used to answer', lost.slice(0, 5).join(' | '));
ok(gained > 0 && Object.keys(gainedBy).length === 6
   && h.ungrouped.every(id => gainedBy[id]),
  'the only movement is false → true, and only for the tree\'s 6 orphans',
  Object.keys(gainedBy).join(', '));
// the control: an unscoped counter is unchanged and unrestricted
ok(NOW.types.every(t => scopeOk(NOW.groups, [], t.id) === true && scopeOk(HEAD.groups, [], t.id) === true),
  'CONTROL — an UNSCOPED counter still answers all ' + n.total + ' ids on both sides');

try { fs.rmSync(WT, { recursive: true, force: true }); } catch (e) {}
console.log('\n' + (fails ? fails + ' FAILURE(S)' : 'ALL PASS'));
process.exit(fails ? 1 : 0);
