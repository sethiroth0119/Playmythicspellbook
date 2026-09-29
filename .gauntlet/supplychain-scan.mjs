#!/usr/bin/env node
/* supplychain-scan.mjs — the ONE command that proves the supply-chain proposal overlay is
   still honest against the game as it is on disk right now.

   WHY THIS FILE EXISTS
   The proposal overlay (public/src/supplychain/proposal.js) sizes every "this business
   needs battle loot" line from drop rates MEASURED by rolling the game's own salvage code
   (flux.snapshot.js, generated). Other sessions edit that salvage code in public/index.html.
   For two rounds the owner-facing memo said "a check fails the day the loot tables change"
   while nothing actually ran that check — a stale measurement was only caught if somebody
   remembered `gen-flux --check`. The browser-side guard (tableSignature at copy time) is
   real but partial: it sees the ruin tables and the loot id list, not the roll counts, the
   body-salvage roll, the per-unit staple tables or FARM_ECON. This file is the guard that
   sees all of it, and it exits non-zero, so a runner cannot mistake red for green.

   It is a NEW file rather than a line in _checkall.mjs because _checkall.mjs is being
   edited by another session in this working tree; the lead can add one row there that
   runs this file (see tools/supplychain/README.md).

   WHAT RUNS, in order, each in its own process (a crash in one is a failure, not a skip):
     1. node tools/supplychain/gen-fixture.mjs --check   OPS_ECON etc. == fixture.opsecon.json
     2. node tools/supplychain/gen-flux.mjs --check      loot tables + roll code + FARM_ECON == flux.snapshot.js
     3. node tools/supplychain/proposal-gate.mjs         negative controls first, then the real overlay through
                                                         a sliced copy of the real _opEcon, default-OFF scan,
                                                         settings-in-tuning-only scan, throttle, stage 4
     4. node tools/supplychain/seam-smoke.mjs            the 16 bridge accessors are total (2,600 hostile calls),
                                                         confirm has a ceiling, phase stays in 0..3, one file
                                                         touches window, no economy number in tuning.js
     5. node tools/supplychain/real-page-probe.mjs       the live _opEcon in the REAL index.html == the fixture,
                                                         for all 25 ops (Chromium, read-only, ~8 s)
     6. node tools/supplychain/shoot-control.mjs         the camera exits 1 on a 404 — and a mutant with the
                                                         guard removed exits 0, so the test can fail (~25 s)
   Usage:  node .gauntlet/supplychain-scan.mjs          exit 0 only when all of them pass
           node .gauntlet/supplychain-scan.mjs --quiet   print only the verdict lines
           node .gauntlet/supplychain-scan.mjs --no-browser   steps 1-4 only, and says so in the verdict
   NOT run here: proposal-browser.mjs — run it by hand after a change to the copy / remove path. */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const quiet = process.argv.includes('--quiet');
/* ⚠ --no-browser exists for a runner with no Chromium, NOT for a hurry. The
   last three steps are the only ones that see the seam and the camera, and two
   of them are the only ones that see the GAME RUNNING rather than its source
   text. Skipping them is announced in the verdict line so a green cannot be
   mistaken for a full green. */
const noBrowser = process.argv.includes('--no-browser');
const STEPS = [
  ['fixture is current', ['tools/supplychain/gen-fixture.mjs', '--check']],
  ['drop-rate snapshot is current', ['tools/supplychain/gen-flux.mjs', '--check']],
  ['proposal gate (controls fail first, then the real overlay)', ['tools/supplychain/proposal-gate.mjs']],
  /* 4. The seam. Its guarantee — 16 total accessors, a confirm with a ceiling,
     a phase that stays in its printed range, one file touching window, no
     economy number in tuning.js — survived two rounds only as a command
     somebody had to remember to type. Delete the thenable defuse in
     sc.bridge.js and this step goes red (126 unhandled rejections). */
  ['seam is total (sc.bridge.js + tuning.js)', ['tools/supplychain/seam-smoke.mjs']],
  /* 5. The fixture against the GAME AS IT RUNS, not against index.html's
     source text — the only step that can see an admin override,
     OPS_FREE_LICENCE or OPS_PINNED_PRICE make the live row differ from the
     table. Read-only: it opens the page and evaluates getters. */
  ...(noBrowser ? [] : [['live _opEcon == fixture (real index.html in Chromium)', ['tools/supplychain/real-page-probe.mjs']]]),
  /* 6. The camera's exit code, with its negative control. Every other piece's
     verdict in this gauntlet is a shoot.mjs screenshot, and the guard that
     stops a photograph of a 404 reading as a pass is one `if` that nothing
     else in the repo would miss. */
  ...(noBrowser ? [] : [['camera exit code + mutant control', ['tools/supplychain/shoot-control.mjs']]]),
];
for (const [, [script]] of STEPS) if (!fs.existsSync(path.join(REPO, script))) { console.error('supplychain-scan: missing ' + script); process.exit(2); }

let failed = 0;
const t0 = Date.now();
for (const [label, args] of STEPS) {
  const r = spawnSync(process.execPath, args, { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const ok = r.status === 0;
  if (!ok) failed++;
  const tail = (s) => (s || '').trim().split('\n').slice(-3).join(' | ');
  console.log((ok ? 'PASS ' : 'FAIL ') + label + '  [node ' + args.join(' ') + ']' + (ok ? '' : '  exit ' + r.status + ' :: ' + tail(r.stderr) + (r.stdout ? ' :: ' + tail(r.stdout) : '')));
  if (!quiet && !ok) { process.stdout.write(r.stdout || ''); process.stderr.write(r.stderr || ''); }
}
console.log((failed ? 'supplychain-scan: FAIL (' + failed + ' of ' + STEPS.length + ')' : 'supplychain-scan: ALL GREEN') + (noBrowser ? ' — ⚠ --no-browser: the live-page probe and the camera control did NOT run' : '') + '  ' + ((Date.now() - t0) / 1000).toFixed(1) + 's');
process.exit(failed ? 1 : 0);
