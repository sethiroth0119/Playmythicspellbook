/* ══════════════════════════════════════════════════════════════════════════
   🧨 DEADCODE-SCAN — a SHORTLIST of functions that destroy player data and
   look uncalled. Not a verdict. Read the warning below before deleting.

       DESTRUCTIVE  the body wipes or deletes something belonging to the
                    player — a Profile key, a save, a server row.
       LOOKS DEAD   the identifier appears nowhere else in the tree.

   Dead-and-harmless is clutter. Live-and-destructive is a feature. DEAD AND
   DESTRUCTIVE is the dangerous shape: it reads as reviewed and intentional,
   and is one careless call away from deleting an account.

   🔴 THIS TOOL REPORTED A LIVE FUNCTION AS DEAD, AND THE DELETION WENT IN
      BEFORE A PLAIN GREP CAUGHT IT. tw_cloudClearNodeOwner has two real
      callers. The cause: references were counted on a copy with comments AND
      string interiors blanked, and that blanking pass has no regex-literal
      handling — so a literal like /["']/ opens a phantom string and every
      reference after it disappears.
      The fix is an asymmetry, not cleverness: OVERCOUNTING references only
      ever KEEPS code; undercounting DELETES LIVE CODE. References are counted
      on RAW source, comments included. A function mentioned only in a comment
      therefore scores 1 and stays on the near-miss list instead of the kill
      list, which is the safe direction to be wrong in.

   ⚠ IT REPORTS, IT DOES NOT DELETE — and it prints every mention it found, so
     no candidate can be acted on without its call sites in view.

   Run:  node .gauntlet/deadcode-scan.mjs [--near]
   ══════════════════════════════════════════════════════════════════════════ */
import { readFileSync, readdirSync, statSync } from 'fs';
import path from 'path';

const ROOT = path.resolve(process.cwd());
const NEAR = process.argv.includes('--near');
const EXTS = new Set(['.html', '.js', '.mjs', '.jsx']);

/* 🔴 SNAPSHOT DIRECTORIES ARE EXCLUDED, and leaving them in broke both halves
   of the answer. .cityloop/ alone holds six historical copies of index.html, so
   every function appeared seven times and every dead one scored six phantom
   references from its own old copies — nothing could ever read as dead.
   Measured with them in: 1,751 destructive functions and 0 dead, from a tree
   that has both. All of these are git-ignored working dirs, not the game. */
const SKIP_DIR = new Set(['node_modules', '.git', 'dist', 'build',
  '.cityloop', '.battleloop', '.spriteloop', '.wrangler',
  '_legacy_vfx_backup', '_pending_audio', '_wh_shots']);
const SKIP_REL = ['.gauntlet/', 'tmp/', 'tools/', 'migration/', 'docs/'];

function walk(dir, out) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIR.has(name)) continue;
    const full = path.join(dir, name);
    let st; try { st = statSync(full); } catch (e) { continue; }
    if (st.isDirectory()) walk(full, out);
    else if (EXTS.has(path.extname(name))) out.push(full);
  }
  return out;
}

/* Comments and string interiors blanked, offsets preserved. Used ONLY to find
   function bodies and match patterns inside them — never to count references.
   A false positive here merely adds a candidate to review. */
function blank(s) {
  const out = s.split('');
  let i = 0; const n = s.length;
  while (i < n) {
    const c = s[i], d = s[i + 1];
    if (c === '/' && d === '*') {
      let j = s.indexOf('*/', i + 2); j = j < 0 ? n : j + 2;
      for (let k = i; k < j; k++) if (out[k] !== '\n') out[k] = ' ';
      i = j; continue;
    }
    if (c === '/' && d === '/') {
      let j = i; while (j < n && s[j] !== '\n') j++;
      for (let k = i; k < j; k++) out[k] = ' ';
      i = j; continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      let j = i + 1;
      while (j < n) {
        if (s[j] === '\\') {
          if (out[j] !== '\n') out[j] = ' ';
          if (j + 1 < n && out[j + 1] !== '\n') out[j + 1] = ' ';
          j += 2; continue;
        }
        if (s[j] === c) { j++; break; }
        if (out[j] !== '\n') out[j] = ' ';
        j++;
      }
      i = j; continue;
    }
    i++;
  }
  return out.join('');
}

const raw = new Map(), body = new Map();
for (const f of walk(ROOT, [])) {
  const rel = path.relative(ROOT, f).replace(/\\/g, '/');
  if (SKIP_REL.some((p) => rel.startsWith(p))) continue;
  try { const t = readFileSync(f, 'utf8'); raw.set(rel, t); body.set(rel, blank(t)); } catch (e) {}
}

/* Narrow on purpose. Lazy init (`if (!Profile.x) Profile.x = {}`) CREATES a
   collection and is excluded by the `not` guard — treating it as destruction
   made four of the first eight hits false positives. A dynamic-key delete
   (`delete Profile.essence[id]`) is ledger bookkeeping, not a wipe. */
const DESTRUCTIVE = [
  { re: /(?:Profile|Forge|BankEthos)\s*\.\s*[A-Za-z_$][\w$]*\s*=\s*(?:\{\}|\[\])\s*[;,]/,
    not: /\bif\s*\(\s*!/, why: 'blanks a Profile/Forge collection (unguarded)' },
  { re: /\.\s*sites\s*=\s*\{\}/, why: 'wipes the reclaim board' },
  { re: /\bdelete\s+(?:Profile|Forge)\s*\.\s*[A-Za-z_$][\w$]*\s*[;,]/, why: 'deletes a Profile/Forge key outright' },
  { re: /localStorage\s*\.\s*clear\s*\(/, why: 'clears ALL local storage' },
  { re: /indexedDB\s*\.\s*deleteDatabase\s*\(/, why: 'drops the IndexedDB store' },
  { re: /\.\s*from\s*\([^)]*\)\s*\.\s*delete\s*\(/, why: 'deletes rows server-side' },
];

const DECL = /(?:^|\n)\s*(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/g;
const NL = String.fromCharCode(10);

const found = [];
for (const [rel, src] of body) {
  DECL.lastIndex = 0;
  let m;
  while ((m = DECL.exec(src)) !== null) {
    const name = m[1];
    const i = src.indexOf('{', m.index);
    if (i < 0) continue;
    let depth = 0, j = i;
    for (; j < src.length; j++) {
      if (src[j] === '{') depth++;
      else if (src[j] === '}') { depth--; if (depth === 0) break; }
    }
    const fnBody = src.slice(i, j + 1);
    const bl = fnBody.split(NL);
    const why = DESTRUCTIVE
      .filter((p) => bl.some((L) => p.re.test(L) && !(p.not && p.not.test(L))))
      .map((p) => p.why);
    if (!why.length) continue;

    const word = new RegExp('\\b' + name.replace(/\$/g, '\\$') + '\\b');
    let uses = 0;
    const mentions = [];
    for (const [r2, s2] of raw) {
      const ls = s2.split(NL);
      for (let li = 0; li < ls.length; li++) {
        if (!word.test(ls[li])) continue;
        uses++;
        if (mentions.length < 10) mentions.push(r2 + ':' + (li + 1) + '  ' + ls[li].trim().slice(0, 100));
      }
    }
    uses -= 1;                                  // its own declaration
    found.push({ name, rel, uses, why, mentions, line: src.slice(0, m.index).split(NL).length });
  }
}

found.sort((a, b) => a.uses - b.uses || a.name.localeCompare(b.name));
const dead = found.filter((f) => f.uses === 0);
const near = found.filter((f) => f.uses > 0 && f.uses <= 2);

console.log('scanned ' + raw.size + ' files');
console.log('functions that destroy player data: ' + found.length);
console.log('  looks dead (0 references, comments included): ' + dead.length + '\n');

if (!dead.length) console.log('  — none —');
for (const d of dead) {
  console.log('🧨 ' + d.name + '()   ' + d.rel + ':' + d.line);
  for (const w of d.why) console.log('     · ' + w);
  console.log('     every mention found:');
  for (const mm of d.mentions) console.log('       ' + mm);
}

if (NEAR && near.length) {
  console.log('\n── near-misses: 1-2 mentions, often a comment or a single caller ──');
  for (const f of near) {
    console.log('   ' + f.name + '  (' + f.uses + ')  ' + f.rel + ':' + f.line);
    for (const mm of f.mentions) console.log('       ' + mm);
  }
}

console.log('\n⚠ SHORTLIST, NOT A VERDICT. Confirm every one by hand before deleting:');
console.log('    grep -n "<name>" public/index.html');
console.log('  This tool has reported a live function as dead before. See the header.');
process.exit(0);
