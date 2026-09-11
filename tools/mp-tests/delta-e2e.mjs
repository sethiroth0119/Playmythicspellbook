#!/usr/bin/env node
/* 📦 DELTA FIDELITY, END TO END — two real clients, one relayed transport.
   ---------------------------------------------------------------------------
   Run:  node tools/mp-tests/delta-e2e.mjs        (or via tools/mp-tests/run.mjs)

   tools/mp-tests/delta-roundtrip.mjs tests the delta codec as a codec: it
   extracts _computeStateDelta / _applyStateDelta out of index.html and feeds
   them a state somebody wrote by hand. That is the right way to prove the pair
   is lossless and the wrong way to find out whether a lit surface reaches the
   other player's screen. This file runs the scenario in two browsers:

     A lights a fire and walks a unit onto a control-point truck, summoning and
     killing nothing, and ends its turn. Because units.length never changes,
     _computeStateDelta does not bail to a full snapshot — the handoff is a
     DELTA, which is exactly the packet that used to arrive with the board and
     cpScore missing. Then B must have both, and the convergence oracle must be
     green.

   ⚠ AND THE MEASUREMENT'S OWN CONTROL, which is the part that makes it mean
     anything: A's FULL snapshots are dropped by the relay for the duration of
     the scenario. Without that, the turn-holder heartbeat re-pushes the whole
     board every 4000 ms and both clients end up agreeing no matter how lossy
     the delta path is — measured, on the first run of this scenario, as a
     window carrying `state, state-delta`. The driver also asserts on the
     CONTENTS of the handoff packet, not only on the two boards agreeing.

   .gauntlet/drive-mp-twoclient.mjs --delta is the harness; this file is the
   gate entry, the same split tools/mp-tests/twoclient.mjs uses.

   ⚠ THIS ONE NEEDS A BROWSER (Playwright + a chromium download), like
     twoclient.mjs and unlike everything else in this directory. It is in
     run.mjs's SLOW list for that reason: the real pass runs it, and the
     mutation sweep runs it only for the mutation that names it.

   📊 MEASURED STABILITY on this tree, a fresh process each time:
        · 14/14 green on this driver as it stands
        · 10/10 green on an earlier variant that pinned truck #0 instead of
          walking to the NEAREST one — the index was pinned precisely because
          the trucks are seeded per match, and a scenario that needs one
          particular truck to be within a single move's reach is a gate that
          reddens on the seed rather than on the code
        · 4/4 RED on the tree before the fix, on the assertions it is for
      14 runs cannot establish a low flake rate — a 10% fault has a ~23% chance
      of surviving 14 runs unseen. If this goes red on a change that cannot
      plausibly have caused it, re-measure before blaming the change:
          for i in $(seq 1 20); do node .gauntlet/drive-mp-twoclient.mjs --delta \
            | grep -E 'FAILURE|all checks'; done
      and replace the number above with what you get.
*/
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const DRIVER = join(HERE, '..', '..', '.gauntlet', 'drive-mp-twoclient.mjs');
const ROOT = join(HERE, '..', '..');

console.log('\n📦 DELTA E2E GATE — ' + DRIVER + ' --delta');
/* MP_SRC is passed straight through: run.mjs sets it to a copy of index.html
   with one shipped fix reverted, and the harness serves that copy to BOTH
   contexts. That is what makes the mutation proof possible. */
const r = spawnSync(process.execPath, [DRIVER, '--delta'], {
  cwd: ROOT, encoding: 'utf8', env: process.env, maxBuffer: 32 * 1024 * 1024,
});
process.stdout.write(r.stdout || '');
process.stderr.write(r.stderr || '');
if (r.status !== 0) {
  console.log('❌ delta e2e gate FAILED (exit ' + r.status + ')');
  process.exit(r.status || 1);
}
console.log('✅ delta e2e gate passed');
process.exit(0);
