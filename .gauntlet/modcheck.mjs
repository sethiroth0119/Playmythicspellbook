#!/usr/bin/env node
/* ══════════════════════════════════════════════════════════════════════════
   MODCHECK — parse every ES module under public/src/.

   🔴 WHY THIS EXISTS. `_synckcheck.mjs` checks the <script> blocks inside
   public/node-city/index.html and public/index.html. It does NOT look at
   public/src/**/*.js. Nothing did.

   That gap shipped a dark feature. public/src/power/panel.js carried a
   backtick-quoted `pwwhy` inside a `const CSS = \`…\`` template literal; the
   backtick closed the string and the file stopped parsing. The module then
   failed at import, node-city logged "[Power] not mounted (non-fatal)" exactly
   as its guard promises, and the whole electricity panel, overlay and grid
   silently reverted to the inline fallback — while `_synckcheck.mjs` reported
   ALL CLEAN and every reviewer, human and agent, believed it.

   The guarded-import pattern is correct and must stay: a 404 on one module
   costs the player that feature and nothing else. But it means a BROKEN module
   is indistinguishable from an ABSENT one at runtime, so a parse error never
   surfaces as a crash. It has to be caught before the commit or not at all.

   Usage: node .gauntlet/modcheck.mjs [dir]     (default: public/src)
   Exits non-zero on the first parse failure, listing every one it found.
   ══════════════════════════════════════════════════════════════════════════ */
import { readdirSync, statSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { execFileSync } from 'node:child_process';

const ROOT = process.argv[2] || 'public/src';

function walk(dir, out = []) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (e.endsWith('.js') || e.endsWith('.mjs')) out.push(p);
  }
  return out;
}

const files = walk(ROOT);
const bad = [];

for (const f of files) {
  try {
    /* --check parses without executing, so a module with top-level side
       effects (every index.js here registers on window) is safe to test. */
    execFileSync(process.execPath, ['--input-type=module', '--check'],
                 { input: readFileSync(f), stdio: ['pipe', 'pipe', 'pipe'] });
  } catch (e) {
    const msg = String(e.stderr || e.message).split('\n')
      .filter(l => /SyntaxError|\^|^\s*\d+ \|/.test(l)).slice(0, 3).join('\n      ');
    bad.push({ f: relative(process.cwd(), f), msg });
  }
}

if (bad.length) {
  console.error(`\n🔴 ${bad.length} module${bad.length === 1 ? '' : 's'} failed to parse:\n`);
  for (const b of bad) console.error(`  ${b.f}\n      ${b.msg}\n`);
  console.error('A module that does not parse fails at import, and node-city\'s guard');
  console.error('reports that as "not mounted (non-fatal)" — identical to the module');
  console.error('being absent. The feature is simply gone, with no error anywhere.\n');
  process.exit(1);
}

console.log(`ALL ${files.length} MODULES PARSE  (${ROOT})`);
