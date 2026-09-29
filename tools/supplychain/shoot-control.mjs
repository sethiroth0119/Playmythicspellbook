/* ═══════════════════════════════════════════════════════════════════════════
   🎛 shoot-control — the NEGATIVE CONTROL for the camera's exit code.

   WHY THIS EXISTS. Every other piece in this gauntlet gets its verdict through
   `shoot.mjs`. In round 1 that camera printed `"errors": [...]` and still
   exited 0, so a photograph of a 404 — a black PNG of nothing — read as a pass
   to any script or agent that checked the status code. Round 2 fixed it. The
   fix is one `if` at the bottom of shoot.mjs, and nothing in this repo would
   notice if it were deleted: the selftest PNG is byte-identical before and
   after, because the gain is entirely behavioural.

   A test that only checks the good path cannot see a guard disappear. So this
   file checks the BAD paths, and then — the actual control — re-runs them
   against a MUTANT of shoot.mjs with the guard removed, and fails if the
   mutant passes them too. That is the difference between "the camera exits 0
   on a healthy page" (true of a camera with no guard at all) and "the guard is
   what is doing the work".

   THE MUTANT never touches the repo. shoot.mjs is read, the exit block is cut,
   and the copy is written to the OS temp dir — with `playwright` and
   `./serve.mjs` rewritten to absolute file: URLs, because a copy outside the
   repo cannot resolve node_modules or its sibling. Other sessions are editing
   this tree; a test that writes a mutant into it would be a landmine.

     node tools/supplychain/shoot-control.mjs          ~6 Chromium launches, ~25 s
     node tools/supplychain/shoot-control.mjs --quick  the real camera only, no mutant

   Exit 0 = the camera's verdict can be trusted by the other 17 pieces.
   ═══════════════════════════════════════════════════════════════════════════ */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');
const SHOOT = path.join(HERE, 'shoot.mjs');
const fails = [];
const check = (ok, msg) => { console.log((ok ? '  ok   ' : '  FAIL ') + msg); if (!ok) fails.push(msg); };

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-shoot-control-'));
const out = (n) => path.join(TMP, n + '.png');

/* Run a camera (real or mutant) as the CLI, exactly as a critic or a shell
   script would. cwd is the repo so a relative out path behaves the same way. */
function run(cam, args) {
  const r = spawnSync(process.execPath, [cam, ...args], { cwd: REPO, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, timeout: 180000 });
  return { status: r.status, out: r.stdout || '', err: r.stderr || '' };
}

/* ── the mutant: shoot.mjs with the exit-on-errors block removed ────────── */
function makeMutant() {
  const src = fs.readFileSync(SHOOT, 'utf8').replace(/\r\n/g, '\n');
  const req = createRequire(import.meta.url);
  let pw;
  try { pw = pathToFileURL(req.resolve('playwright')).href; } catch (e) { throw new Error('shoot-control: playwright is not resolvable from the repo — ' + e.message); }
  /* `playwright` is CommonJS. Imported by its BARE name Node's resolver gives
     it named exports; imported by a file: URL it does not ("Named export
     'chromium' not found"), so the copy takes the default and destructures.
     Same module, same object — only the specifier changes. */
  let m = src
    .replace(/import \{ chromium \} from 'playwright';/, `import _pw from '${pw}';\nconst { chromium } = _pw;`)
    .replace(/from '\.\/serve\.mjs'/, `from '${pathToFileURL(path.join(HERE, 'serve.mjs')).href}'`);
  if (/from 'playwright'/.test(m)) throw new Error('shoot-control: could not rewrite the playwright import in shoot.mjs');
  /* Cut the guard, anchored on its own text rather than a line number (this
     file must keep working while shoot.mjs is edited above it). Both the CLI's
     exit block and assertClean's throw go, because either one alone would
     still catch a 404 and the control would be measuring the wrong half. */
  const before = m.length;
  m = m.replace(/\n\s*if \(!res\.allowErrors && \(res\.errors\.length \|\| \(res\.status !== null && res\.status >= 400\)\)\) \{[\s\S]*?process\.exit\(1\);\n\s*\}/, '\n      // [mutant] exit guard removed');
  m = m.replace(/if \(t\.navStatus !== null && t\.navStatus >= 400\) throw new Error\([^\n]*\n/, '// [mutant] assertClean nav check removed\n');
  m = m.replace(/if \(errors\.length\) throw new Error\('shoot: the page reported[^\n]*\n/, '// [mutant] assertClean error check removed\n');
  if (m.length >= before) throw new Error('shoot-control: the exit guard was not found in shoot.mjs — it was renamed or removed; update this control (that is the point of it)');
  const f = path.join(TMP, 'shoot-mutant-' + crypto.randomBytes(3).toString('hex') + '.mjs');
  fs.writeFileSync(f, m);
  return f;
}

console.log('the real camera');
{
  // 1. a page that is FINE → 0, and a PNG that is really on disk.
  const good = run(SHOOT, ['__sc/selftest.html?owns=mining', out('good'), '--w', '640', '--h', '480', '--wait', '300']);
  check(good.status === 0, `a healthy page exits 0${good.status === 0 ? '' : ' — ' + good.err.slice(0, 300)}`);
  check(fs.existsSync(out('good')) && fs.statSync(out('good')).size > 2000, 'and writes a real PNG');

  // 2. a 404 → 1. The round-1 hole: this photographed a black page and passed.
  const miss = run(SHOOT, ['__sc/no-such-harness.html', out('404'), '--w', '640', '--h', '480', '--wait', '100']);
  check(miss.status === 1, `a 404 exits 1 (was 0 in round 1) — got ${miss.status}`);
  check(/HTTP 404/.test(miss.err), 'and says HTTP 404 on stderr, not only inside the JSON');

  // 3. --allow-errors is the documented opt-out and must still work, or a
  //    critic photographing a deliberate error state has nowhere to go.
  const allow = run(SHOOT, ['__sc/no-such-harness.html', out('404b'), '--w', '640', '--h', '480', '--wait', '100', '--allow-errors']);
  check(allow.status === 0, `--allow-errors exits 0 on the same 404 — got ${allow.status}`);

  // 4. the Git-Bash mangled form: repaired, photographed for real, exit 0.
  const gitRoot = ['C:/Program Files/Git', 'C:/Program Files (x86)/Git'].find((d) => { try { return fs.statSync(d).isDirectory(); } catch (e) { return false; } });
  if (gitRoot) {
    const man = run(SHOOT, ['/' + gitRoot + '/__sc/selftest.html', out('mangled'), '--w', '640', '--h', '480', '--wait', '300']);
    check(man.status === 0 && /repaired a Git-Bash-mangled path/.test(man.err), `a mangled leading-slash path is repaired and exits 0 — got ${man.status}`);
  } else check(true, 'no Git install to build the mangled form from (skipped)');
}

if (!process.argv.includes('--quick')) {
  console.log('the mutant (the guard removed) — these MUST behave worse');
  const mut = makeMutant();
  const mGood = run(mut, ['__sc/selftest.html?owns=mining', out('m-good'), '--w', '640', '--h', '480', '--wait', '300']);
  check(mGood.status === 0, `the mutant still exits 0 on a healthy page (so the control is comparing like with like) — got ${mGood.status}`);
  const mMiss = run(mut, ['__sc/no-such-harness.html', out('m-404'), '--w', '640', '--h', '480', '--wait', '100']);
  /* THE CONTROL. If this is 1, the mutation did not remove the thing under
     test and every "ok" above is meaningless. A control that cannot fail is
     not a control. */
  check(mMiss.status === 0, `the mutant exits 0 on a 404 — i.e. the guard in shoot.mjs is what makes the real camera exit 1, not luck — got ${mMiss.status}`);
  check(/"errors"/.test(mMiss.out), 'the mutant still PRINTS the errors it ignores — exactly the round-1 confident wrong green');
}

try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) {}
console.log(fails.length ? `\nshoot-control: ${fails.length} FAILED\n  ` + fails.join('\n  ') : '\nshoot-control: all passed — the camera\'s exit code is a verdict');
process.exit(fails.length ? 1 : 0);
