#!/usr/bin/env node
/* ══════════════════════════════════════════════════════════════════════════
   PRECOMMIT SCAN — refuse to snapshot a deliberately-broken intermediate.

   🔴 WHY THIS EXISTS. A stop hook requires a clean working tree every turn,
   and several agents write to that tree continuously. "Commit everything that
   is dirty" therefore samples other people's work at an arbitrary instant —
   and an arbitrary instant inside a debugging session is frequently a state
   that is INTENTIONALLY WRONG.

   It has now happened twice, and the second time shipped:

     47e230f  public/src/districts/index.js:478
              inert: false,  followed by a comment reading
              "TEMPORARY REGRESSION - pre-fix behaviour, reverted below"

   (Quoted without its comment delimiters on purpose: a close-comment inside a
    block comment ends the block, which is the same class of trap this repo has
    already paid for three times with backticks inside template literals. The
    scan below matches the TEXT, so it still catches the real thing.)

   That line was injected on purpose so an agent could photograph the pre-fix
   behaviour, and was reverted minutes later. Checked out, that commit is a
   build where the fix is DISABLED WHILE APPEARING PRESENT.

   ⚠ BOTH SYNTAX GATES PASSED ON IT, and always would have — the injected line
     is valid JavaScript. _synckcheck.mjs and modcheck.mjs answer "does this
     parse", which is a different question from "did anyone mean this".
     Nothing in this repo could see it. This can.

   It is a GREP, and it is honest about that: it finds the marker an agent left
   for itself, not the breakage. An agent that regresses a line silently defeats
   it completely. That is why the convention below is stated in the message it
   prints — the scan is only as good as the habit it reinforces.

   Usage:  node .gauntlet/precommit-scan.mjs          # scan unstaged + staged
           node .gauntlet/precommit-scan.mjs --staged # staged only
   Exit 1 if anything is found, listing file:line.
   ══════════════════════════════════════════════════════════════════════════ */
import { execFileSync } from 'node:child_process';

/* Markers an agent plausibly leaves on a line it intends to take back out.
   Deliberately NOT including bare TODO/FIXME: those are normal, permanent, and
   a scan that cries wolf on them is a scan everyone learns to pass with --no.
   The bar for inclusion is "nobody writes this about code they mean to keep". */
const MARKERS = [
  'TEMPORARY REGRESSION', 'TEMP REGRESSION', 'DO NOT COMMIT', 'DO-NOT-COMMIT',
  'DONOTCOMMIT', 'REVERT BEFORE', 'REVERTED BELOW', 'REVERT ME', 'HACK REMOVE',
  'DEBUG ONLY', 'DEBUGGING ONLY', 'FOR THE BEFORE SHOT', 'PRE-FIX BEHAVIOUR',
  'PRE-FIX BEHAVIOR', 'NO-SNAPSHOT', 'WIP DO NOT',
];

const stagedOnly = process.argv.includes('--staged');
const args = stagedOnly ? ['diff', '--cached', '-U0'] : ['diff', 'HEAD', '-U0'];

let diff = '';
try {
  diff = execFileSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
} catch (e) {
  console.error('precommit-scan: git diff failed:', e.message);
  process.exit(0);          // never block on a tooling failure — fail OPEN
}

/* 🔴 ONLY CODE THAT RUNS, AND NOT THIS FILE.
   The first run of this scan blocked a commit to .gauntlet/rounds.json — the
   round record, whose whole job that turn was to DESCRIBE the incident. A scan
   that fires on the write-up of the thing it prevents is a scan that gets
   disabled within the hour, and it would have been right to disable it.

   So: executable sources only. A marker in a .md or a .json cannot disable a
   fix, because nothing executes them — the entire harm this exists to stop is
   "shipped code that is broken on purpose and parses clean". Documentation is
   where that harm gets EXPLAINED, which is the opposite thing.

   ⚠ THE COST IS REAL AND IS ACCEPTED: a genuinely broken .json fixture — a save
     file, a tuning table — is now invisible here. That is the right trade only
     because the alternative was a gate nobody runs. If fixtures ever start
     carrying deliberate regressions, this list is where to add them back. */
const CODE = /\.(m?js|cjs|ts|html)$/i;
const SELF = 'precommit-scan.mjs';

const hits = [];
let file = null, line = 0, skip = false;
for (const raw of diff.split('\n')) {
  if (raw.startsWith('+++ b/')) {
    file = raw.slice(6);
    skip = !CODE.test(file) || file.endsWith(SELF);
    continue;
  }
  if (skip) continue;
  const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)/.exec(raw);
  if (hunk) { line = +hunk[1]; continue; }
  if (!raw.startsWith('+') || raw.startsWith('+++')) continue;
  const body = raw.slice(1);
  const up = body.toUpperCase();
  for (const m of MARKERS) {
    if (up.includes(m)) { hits.push({ file, line, m, body: body.trim().slice(0, 120) }); break; }
  }
  line++;
}

if (!hits.length) process.exit(0);

console.error('\n🔴 REFUSING TO SNAPSHOT: ' + hits.length +
              ' line' + (hits.length === 1 ? '' : 's') + ' marked as deliberately broken.\n');
for (const h of hits) console.error(`  ${h.file}:${h.line}  [${h.m}]\n      ${h.body}\n`);
console.error('An agent is mid-A/B and has injected a regression to photograph the');
console.error('"before" state. Committing now captures a build that is broken on');
console.error('purpose, while both syntax gates report it clean — that is exactly');
console.error('what 47e230f did. Wait for the agent, or ask it to revert first.\n');
console.error('THE CONVENTION, for anyone writing one of these: put the marker ON');
console.error('THE LINE you are about to take back out, not in a comment three lines');
console.error('away. This scan can only see what you tell it.\n');
process.exit(1);
