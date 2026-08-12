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
// EXIT CODES — all three are distinct, on purpose:
//   0  every check RAN and PASSED. This is the only safe-to-report outcome.
//   1  at least one check RAN and FAILED.
//   2  at least one check COULD NOT RUN (missing dev dependency). Not a pass.
//
// ⚠ A SKIPPED CHECK IS NOT A PASS. An earlier version exited 0 when checks were
// skipped and inferred "cannot run" from the child's exit code and output text.
// Both were wrong, and together they were catastrophic:
//   • _harness.js exits 2 for a GENUINE top-level TDZ — the single most
//     important failure it exists to catch — and the runner relabelled that
//     "cannot run — missing dependency" and exited 0.
//   • the reach check exits 2 when the warehouse page does not boot; a real
//     syntax error in public/warehouse/index.html printed "✔ 3 check(s)
//     passed" and exited 0.
//   • any failure whose text happened to contain "Cannot find module" was
//     swallowed the same way.
// A gate that turns red into green is far worse than one that cries wolf. So:
// dependencies are resolved HERE, BEFORE the child runs, and nothing about a
// child's failure is ever reinterpreted as "could not run".
// ═══════════════════════════════════════════════════════════════════════════
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));

const CHECKS = [
  // _harness.js and _wh_paste_check.mjs use only node builtins — they can
  // ALWAYS run, so they can never be skipped, so a failure is always real.
  { name: 'inline script parse + top-level execution (whole game)',
    cmd: 'node', args: ['_harness.js'], need: 'ALL CHECKS PASSED' },
  { name: 'every inline <script> block minifies (whole game)',
    cmd: 'node', args: ['_synckcheck.mjs'], need: 'ALL CLEAN',
    requires: ['terser'], dep: 'npm i terser --no-save' },
  { name: 'warehouse paste artifact matches the live module',
    cmd: 'node', args: ['_wh_paste_check.mjs'] },
  { name: 'every warehouse bay is walkable at every tier',
    cmd: 'node', args: ['_wh_reach_check.mjs'],
    requires: ['playwright'], dep: 'npm i playwright --no-save  (three ships in public/assets/vfx/)' },
];

// Can this process resolve a module by name? This is the ONLY thing allowed to
// decide that a check cannot run, and it is decided BEFORE the child starts —
// a narrow, specific question asked in advance, never a guess made afterwards
// from whatever the child happened to print while failing.
const require_ = createRequire(import.meta.url);
function haveModule(name) {
  try { require_.resolve(name); return true; } catch (e) {}
  // The check itself falls back to a global install, so the runner must look
  // in the same place — otherwise it reports "cannot run" for a gate that runs.
  try { require_.resolve('/opt/node22/lib/node_modules/' + name + '/index.mjs'); return true; } catch (e) {}
  return existsSync('/opt/node22/lib/node_modules/' + name);
}

let failed = 0, skipped = 0, passed = 0;
for (const c of CHECKS) {
  if (!existsSync(join(ROOT, c.args[0]))) {
    console.log(`SKIP — ${c.name}  (${c.args[0]} not present)`);
    skipped++;
    continue;
  }
  const missing = (c.requires || []).filter(m => !haveModule(m));
  if (missing.length) {
    console.log(`SKIP — ${c.name}`);
    console.log(`       cannot run — missing ${missing.join(', ')}`);
    if (c.dep) console.log(`       fix: ${c.dep}`);
    skipped++;
    continue;
  }
  const r = spawnSync(c.cmd, c.args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const out = (r.stdout || '') + (r.stderr || '');
  // Everything from here is the thing under test. Its dependencies were proven
  // present a moment ago, so ANY non-zero exit is a real failure — including
  // exit 2, which _harness.js uses for a genuine runtime error.
  const good = r.status === 0 && (!c.need || out.includes(c.need));
  console.log(`${good ? 'PASS' : 'FAIL'} — ${c.name}`);
  if (good) passed++;
  else {
    failed++;
    console.log(`    (exit ${r.status})`);
    console.log(out.trim().split('\n').slice(-14).map(l => '    ' + l).join('\n'));
  }
}

console.log('');
if (failed) {
  console.error(`✖ ${failed} check(s) FAILED — do not report this round complete.`);
  process.exit(1);
}
if (skipped) {
  // ⚠ NOT exit 0. "I did not look" is not "I looked and it was fine", and a
  // fresh clone with no node_modules used to print a tick and exit 0 while
  // silently skipping the two heaviest gates.
  console.error(`✖ ${passed} check(s) passed but ${skipped} COULD NOT RUN — this is not a pass.`);
  console.error('  Install the dev dependencies and re-run before reporting a round complete:');
  console.error('    npm i terser playwright --no-save     (three is already in the repo)');
  process.exit(2);
}
console.log(`✔ all ${passed} checks passed.`);
