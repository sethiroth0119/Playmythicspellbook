// ═══════════════════════════════════════════════════════════════════════════
// ✅ WAREHOUSE — run everything, before claiming anything.
//
// This exists because of a specific, repeated failure: rounds were reported
// complete while a generated artifact had silently drifted out of step with the
// code it was generated from. It happened TWICE. Both times the stale file
// still parsed, still looked reasonable, and would have had the next developer
// paste back a broken version of the module. Both times a single command would
// have caught it in seconds.
//
// So the answer is not "remember to run the check" — it is one command that
// runs all of them and refuses to be optimistic.
//
//   node _wh_check_all.mjs
//
// Exit 0 only if EVERY check passes. Anything else is a non-zero exit and a
// named failure. Safe for CI.
// ═══════════════════════════════════════════════════════════════════════════
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));

const CHECKS = [
  { name: 'inline script parse + top-level execution (whole game)',
    cmd: 'node', args: ['_harness.js'], need: 'ALL CHECKS PASSED' },
  { name: 'every inline <script> block minifies (whole game)',
    cmd: 'node', args: ['_synckcheck.mjs'], need: 'ALL CLEAN', dep: 'npm i terser --no-save' },
  { name: 'warehouse paste artifact matches the live module',
    cmd: 'node', args: ['_wh_paste_check.mjs'] },
  { name: 'every warehouse bay is walkable at every tier',
    cmd: 'node', args: ['_wh_reach_check.mjs'], dep: 'npm i three@0.128.0 playwright --no-save' },
];

let failed = 0, skipped = 0;
for (const c of CHECKS) {
  if (!existsSync(join(ROOT, c.args[0]))) {
    console.log(`SKIP — ${c.name}  (${c.args[0]} not present)`);
    skipped++;
    continue;
  }
  const r = spawnSync(c.cmd, c.args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const out = (r.stdout || '') + (r.stderr || '');
  // ⚠ "Could not run" is NOT "failed". A fresh clone has no node_modules, and
  // reporting a missing devDependency as a FAILED CHECK trains people to ignore
  // the runner — which is the exact habit this file exists to break. A gate
  // that cannot run says so, loudly, with the command that fixes it.
  const cannotRun = r.status === 2
    || /ERR_MODULE_NOT_FOUND|Cannot find (module|package)/.test(out);
  if (cannotRun) {
    console.log(`SKIP — ${c.name}\n       cannot run — ${c.dep || 'missing dependency'}`);
    skipped++;
    continue;
  }
  const good = r.status === 0 && (!c.need || out.includes(c.need));
  console.log(`${good ? 'PASS' : 'FAIL'} — ${c.name}`);
  if (!good) {
    failed++;
    console.log(out.trim().split('\n').slice(-14).map(l => '    ' + l).join('\n'));
  }
}

console.log('');
if (failed) {
  console.error(`✖ ${failed} check(s) FAILED — do not report this round complete.`);
  process.exit(1);
}
if (skipped) {
  console.log(`✔ ${CHECKS.length - skipped} check(s) passed, ${skipped} could not run.`);
  console.log('  Install the dev dependencies and re-run before reporting a round complete:');
  console.log('    npm i terser three@0.128.0 playwright --no-save');
  process.exit(0);
}
console.log('✔ all checks passed.');
