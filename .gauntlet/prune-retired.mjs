/* ══════════════════════════════════════════════════════════════════════════
   ✂ PRUNE-RETIRED — delete the two retired subsystems, safely.

   Camp Heights (the walkable 3D camp) and the Campaign screens were RETIRED:
   the router bounces both to the title screen (index.html:116409 and :116427),
   and a comment at :119693 says the renderers were "left intact for later".
   "Later" has been decided: they go.

   🔴 NEVER BY NAME PREFIX. `_camp*` is shared between the RETIRED walkable
      camp and the LIVE Camp Console — _campWorkforce, _campContrib,
      _campRegName and the reconstruction board are all in daily use and were
      bug-fixed this same session. Deleting by prefix would take the settlement
      out with the scenery. Membership is decided ONLY by reachability.

   🔴 THE SET MUST BE CLOSED. A function may be deleted only if every reference
      to it comes from inside the set. If ANYTHING outside references a member,
      the prune is refused whole — no partial deletes, because a half-removed
      subsystem is a syntax error at best and a silent break at worst.

   Run:  node .gauntlet/prune-retired.mjs            (dry run — prints the plan)
         node .gauntlet/prune-retired.mjs --apply    (writes)
   ══════════════════════════════════════════════════════════════════════════ */
import { readFileSync, writeFileSync } from 'fs';

const FILE = 'public/index.html';
const APPLY = process.argv.includes('--apply');
const NL = String.fromCharCode(10);
const raw = readFileSync(FILE, 'utf8');
const lines = raw.split(NL);

/* ── 1. every top-level function and its span ──────────────────────────── */
const DECL = /^\s*(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/;
const fns = [];
for (let i = 0; i < lines.length; i++) {
  const m = DECL.exec(lines[i]);
  if (!m) continue;
  let depth = 0, started = false, j = i;
  for (; j < lines.length; j++) {
    for (const ch of lines[j]) {
      if (ch === '{') { depth++; started = true; }
      else if (ch === '}') depth--;
    }
    if (started && depth === 0) break;
  }
  if (j >= lines.length) continue;
  fns.push({ name: m[1], from: i, to: j });
  i = j;
}
const byName = new Map();
for (const f of fns) if (!byName.has(f.name)) byName.set(f.name, f);
const names = [...byName.keys()];
const word = new Map();
for (const n of names) word.set(n, new RegExp('\\b' + n.replace(/\$/g, '\\$') + '\\b'));

const inBody = new Uint8Array(lines.length);
for (const f of fns) for (let k = f.from; k <= f.to; k++) inBody[k] = 1;

/* ── 2. reachability, same rules as unreachable-scan ───────────────────── */
const edges = new Map();
for (const f of fns) {
  const set = new Set();
  for (let k = f.from; k <= f.to; k++) {
    for (const n of names) {
      if (n === f.name) continue;
      if (word.get(n).test(lines[k])) set.add(n);
    }
  }
  edges.set(f.name, set);
}
const roots = new Set();
for (let k = 0; k < lines.length; k++) {
  if (inBody[k]) continue;
  const L = lines[k];
  if (!L || L.length < 3) continue;
  for (const n of names) {
    if (!word.get(n).test(L)) continue;
    if (DECL.test(L) && DECL.exec(L)[1] === n) continue;
    roots.add(n);
  }
}
const reach = new Set();
const q = [...roots];
while (q.length) {
  const n = q.pop();
  if (reach.has(n)) continue;
  reach.add(n);
  for (const nb of (edges.get(n) || [])) if (!reach.has(nb)) q.push(nb);
}
const unreachable = names.filter((n) => !reach.has(n));

/* ── 3. SEED, then GROW TO CLOSURE ─────────────────────────────────────────
   The seed is a name pattern; the SET is not. Anything unreachable that
   references a member is absorbed, because deleting a member while leaving its
   caller behind is how a prune becomes a syntax error. Anything REACHABLE that
   references a member aborts the whole run. */
const SEED = (n) => /^_camp|^camp(Voice|Chat)|^joinCampChannel$|^leaveCampChannel$|^_startCamp|^renderCampaign/.test(n);
const unreachSet = new Set(unreachable);
const inSet = new Set(unreachable.filter(SEED));

/* Which function owns a given line? */
const owner = new Array(lines.length).fill(null);
for (const fn of fns) for (let k = fn.from; k <= fn.to; k++) owner[k] = fn.name;

const absorbed = [];
let live = null;
for (let pass = 0; pass < 40; pass++) {
  const covered = new Uint8Array(lines.length);
  for (const n of inSet) { const s2 = byName.get(n); for (let k = s2.from; k <= s2.to; k++) covered[k] = 1; }
  let grew = false;
  for (let k = 0; k < lines.length && !live; k++) {
    if (covered[k]) continue;
    const L = lines[k];
    if (!L) continue;
    const t = L.trim();
    if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) continue;
    for (const n of inSet) {
      if (!word.get(n).test(L)) continue;
      const own = owner[k];
      if (own && unreachSet.has(own) && !inSet.has(own)) {
        inSet.add(own); absorbed.push(own + '  (references ' + n + ' at :' + (k + 1) + ')');
        grew = true;
      } else if (!own || reach.has(own)) {
        live = { name: n, line: k + 1, owner: own || '(top level)', text: t.slice(0, 110) };
        break;
      }
    }
  }
  if (live || !grew) break;
}

if (live) {
  console.log('🔴 REFUSED — a LIVE reference to a member:');
  console.log('   ' + live.name + '  <- ' + live.owner + '  ' + FILE + ':' + live.line);
  console.log('   ' + live.text);
  console.log('\nThis subsystem is not retired. Nothing was written.');
  process.exit(1);
}

const target = [...inSet];
const CAMP = (n) => !/^renderCampaign/.test(n);
const CAMPAIGN = (n) => /^renderCampaign/.test(n);
const spans = target.map((n) => byName.get(n)).sort((a, b) => a.from - b.from);
if (absorbed.length) {
  console.log('absorbed into the set (unreachable callers the seed missed):');
  for (const a of absorbed) console.log('   + ' + a);
  console.log('');
}

console.log('unreachable functions: ' + unreachable.length);
console.log('selected for removal:  ' + target.length +
            '   (camp ' + target.filter(CAMP).length + ', campaign ' + target.filter(CAMPAIGN).length + ')');
let total = 0;
for (const s of spans) total += s.to - s.from + 1;
console.log('lines they occupy:     ' + total + NL);

console.log('✅ the set is CLOSED — every reference to a member comes from inside it.' + NL);
for (const s of spans) console.log('   ' + String(s.to - s.from + 1).padStart(5) + ' lines  ' +
                                   String(s.from + 1).padStart(7) + '  ' + s.name);

if (!APPLY) { console.log(NL + 'dry run — pass --apply to write'); process.exit(0); }

/* ── 5. cut from the bottom up so earlier spans keep their indices ─────── */
const out = lines.slice();
for (let i = spans.length - 1; i >= 0; i--) {
  const s = spans[i];
  out.splice(s.from, s.to - s.from + 1);
}
const cr = /\r$/.test(lines[spans[0].from]) ? '\r' : '';
out.splice(spans[0].from, 0,
  '/* 🪦 REMOVED — the retired WALK CAMP HEIGHTS subsystem and the CAMPAIGN' + cr,
  '   screens. ' + target.length + ' functions, ' + total + ' lines.' + cr,
  '' + cr,
  '   Both were already switched off at the router: App.screen === \'campView\'' + cr,
  '   and \'campaign\'/\'campaignChapter\' bounce to the title screen, with a note' + cr,
  '   saying the renderers were "left intact for later". Later was decided.' + cr,
  '' + cr,
  '   ⚠ THE LIVE CAMP IS A DIFFERENT SYSTEM AND IS UNTOUCHED. The Camp Console' + cr,
  '     (Rebuild from the Rubble, the workforce, the vitals, _campWorkforce /' + cr,
  '     _campContrib / _campRegName / Profile.recon) shares the `_camp` prefix' + cr,
  '     and nothing else. Membership here was decided by REACHABILITY, never by' + cr,
  '     name, and the removal was refused unless the set was closed — no live' + cr,
  '     line referenced any member. See .gauntlet/prune-retired.mjs. */' + cr);
writeFileSync(FILE, out.join(NL), 'utf8');
console.log(NL + '✂ removed ' + target.length + ' functions / ' + total + ' lines from ' + FILE);
