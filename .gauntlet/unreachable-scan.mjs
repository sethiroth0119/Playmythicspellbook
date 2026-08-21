/* ══════════════════════════════════════════════════════════════════════════
   🚪 UNREACHABLE-SCAN — features that exist and have no door.

   This project's most-repeated defect is not a bug, it is a MISSING DOOR: the
   weapon-smith bench, the warehouse yard, /src/resmap's togglePanel() with
   zero call sites, the electricity and hydrology info views reachable only
   from a 12px chip inside another panel, and eight shops whose demand had
   existed for months. Every one of them was finished code nobody could reach.

   So: which functions are UNREACHABLE from any entry point a player can touch?

   HOW IT DECIDES
     · every top-level `function name(…)` is a node;
     · an edge A→B exists if A's body names B;
     · ROOTS are names mentioned OUTSIDE every function body — top-level
       statements, `window.x = fn`, and inline HTML handlers, which is where a
       click actually enters the program;
     · reachable = BFS from roots. Everything else is unreachable, and so is
       anything only its unreachable callers name (transitive — a dead function
       calling a dead function does not make either alive).

   🔴 THE DIRECTION IT IS ALLOWED TO BE WRONG IN. Names are matched on RAW text,
      comments included, so a function merely DISCUSSED in a comment counts as
      referenced and stays "reachable". That over-approximates reachability,
      which means this UNDER-reports. Missing a dead feature costs a follow-up;
      calling a live one dead is how .gauntlet/deadcode-scan.mjs got a live
      function deleted. Same asymmetry, same reason.

   ⚠ IT CANNOT SEE DYNAMIC DISPATCH. `window[name]()`, a handler looked up from
     a data-attribute, or a name built by concatenation are invisible to it.
     That is the one way it can call something dead that is not. Every finding
     therefore ships with its mentions so it can be checked in one grep.

   Run:  node .gauntlet/unreachable-scan.mjs [--all]
   ══════════════════════════════════════════════════════════════════════════ */
import { readFileSync } from 'fs';

const FILE = 'public/index.html';
const ALL = process.argv.includes('--all');
const raw = readFileSync(FILE, 'utf8');
const NL = String.fromCharCode(10);
const lines = raw.split(NL);

/* ── 1. every top-level function, and the span of its body ─────────────── */
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
  i = j;                       // do not descend into the body for more decls
}
const byName = new Map();
for (const f of fns) if (!byName.has(f.name)) byName.set(f.name, f);

/* Which lines belong to SOME function body — everything else is top level. */
const inBody = new Uint8Array(lines.length);
for (const f of fns) for (let k = f.from; k <= f.to; k++) inBody[k] = 1;

/* ── 2. edges, and the roots ───────────────────────────────────────────── */
const names = [...byName.keys()];
const word = new Map();
for (const n of names) word.set(n, new RegExp('\\b' + n.replace(/\$/g, '\\$') + '\\b'));

const edges = new Map();        // fn -> Set(fn it names)
for (const f of fns) {
  const set = new Set();
  for (let k = f.from; k <= f.to; k++) {
    const L = lines[k];
    for (const n of names) {
      if (n === f.name) continue;
      if (word.get(n).test(L)) set.add(n);
    }
  }
  edges.set(f.name, set);
}

/* A root is a name that appears on a line belonging to NO function body: a
   top-level call, a window.* assignment, an inline onclick=, a table literal. */
const roots = new Set();
const rootWhere = new Map();
for (let k = 0; k < lines.length; k++) {
  if (inBody[k]) continue;
  const L = lines[k];
  if (!L || L.length < 3) continue;
  for (const n of names) {
    if (word.get(n).test(L)) {
      if (DECL.test(L) && DECL.exec(L)[1] === n) continue;   // its own declaration
      roots.add(n);
      if (!rootWhere.has(n)) rootWhere.set(n, (k + 1) + ':  ' + L.trim().slice(0, 100));
    }
  }
}

/* ── 3. BFS ────────────────────────────────────────────────────────────── */
const reach = new Set();
const q = [...roots];
while (q.length) {
  const n = q.pop();
  if (reach.has(n)) continue;
  reach.add(n);
  for (const nb of (edges.get(n) || [])) if (!reach.has(nb)) q.push(nb);
}
const dead = names.filter((n) => !reach.has(n));

/* ── 4. which of them look like FEATURES rather than helpers ───────────── */
const FEATURE = [
  { re: /\bshowToast\s*\(/, tag: 'talks to the player' },
  { re: /\b(?:spendGems|addGems|spendCinders|spendResources|addRes)\s*\(/, tag: 'moves currency or resources' },
  { re: /\bProfile\s*\.\s*[A-Za-z_$][\w$]*\s*=/, tag: 'writes to the save' },
  { re: /\bCloud\s*\.\s*client\b/, tag: 'talks to the server' },
  { re: /\binnerHTML\s*=/, tag: 'renders UI' },
  { re: /\bsaveProfile\s*\(/, tag: 'persists' },
];
const findings = [];
for (const n of dead) {
  const f = byName.get(n);
  const body = lines.slice(f.from, f.to + 1).join(NL);
  const tags = FEATURE.filter((p) => p.re.test(body)).map((p) => p.tag);
  if (!tags.length && !ALL) continue;
  const mentions = [];
  for (let k = 0; k < lines.length; k++) {
    if (k >= f.from && k <= f.to) continue;
    if (word.get(n).test(lines[k])) mentions.push((k + 1) + ':  ' + lines[k].trim().slice(0, 96));
    if (mentions.length >= 4) break;
  }
  findings.push({ name: n, line: f.from + 1, len: f.to - f.from + 1, tags, mentions });
}
findings.sort((a, b) => b.len - a.len);

console.log(FILE + ' — ' + fns.length + ' top-level functions');
console.log('  reachable from a player-facing entry point: ' + reach.size);
console.log('  UNREACHABLE: ' + dead.length + '  (of those, feature-shaped: ' + findings.length + ')\n');

for (const f of findings) {
  console.log('🚪 ' + f.name + '()   line ' + f.line + '  · ' + f.len + ' lines');
  console.log('     ' + f.tags.join(' · '));
  if (f.mentions.length) {
    console.log('     mentioned at:');
    for (const m of f.mentions) console.log('       ' + m);
  } else {
    console.log('     mentioned NOWHERE else in the file');
  }
}
console.log('\n⚠ Cannot see dynamic dispatch (window[name](), data-attribute handlers).');
console.log('  Confirm with:  grep -n "<name>" public/index.html');
process.exit(0);
