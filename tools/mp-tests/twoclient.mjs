#!/usr/bin/env node
/* 🔁 TWO-CLIENT MP GATE — the only check in this suite that runs two real
   clients against each other.
   ---------------------------------------------------------------------------
   Run:  node tools/mp-tests/twoclient.mjs        (or via tools/mp-tests/run.mjs)

   Every other file in this directory tests multiplayer by extracting a function
   out of index.html and feeding it a state somebody wrote by hand. That is a
   good way to test swapBattlePerspective and a bad way to find out whether two
   browsers can actually play a match. This one boots two Playwright contexts on
   the real page and relays the transport between them —
   .gauntlet/drive-mp-twoclient.mjs is the harness; this file is the gate entry
   that runs its DETERMINISTIC slice (`--gate`).

   ⚠ WHY ONLY A SLICE. The harness's full script is not gate-material and its
     own output says why: the shipped join handshake is a race (both clients
     answer each other's resync with a full turn-1 snapshot, and at turn 1
     nothing can order them), so a gate built on it is red on correct code a
     large fraction of the time. Measured on this tree with
     `--flake=20`. A gate that cries wolf gets ignored, so gate mode removes
     that ONE nondeterminism — deliberately and visibly, by dropping the resync
     exchange in both directions with the relay's own fault injection so no
     opening snapshot crosses — and gates on everything downstream: the oracle,
     the adopt path, the turn handoff, and the transcribed server's turn_number
     agreeing with both clients.
     The race itself is MEASURED by --flake, not asserted here.

   ⚠ THE OTHER NONDETERMINISM, AND HOW TO CHECK THE CLAIM RATHER THAN TRUST IT.
     The opening board spawns surfaces at random and the harness's F3 finding is
     that their countdowns drift a turn between the clients — including, at the
     end of the countdown, existing on one client and deleted on the other. That
     terminal shape once escaped the harness's pin and made THIS GATE red about
     one run in sixteen on an untouched tree, which is the exact "the whole MP
     gate goes red for reasons unrelated to the change under test" harm this
     file's own header argues against. Both shapes are pinned now (KNOWN_BAD),
     the pin's bounds are re-proved on every run by K4 and the PIN SELF-TEST, and
     gate mode additionally clears the opening board's surfaces on BOTH clients —
     because widening the pin and re-measuring turned up F4, the same double
     turn-start burning a unit a different number of times (hero HP differing by
     exactly SURFACE_FIRE_DMG), and that is a divergence no gate may ever pin.
     MEASURED on this tree, 24 fresh gate processes each time: 1/16 red before
     the widening, 1/24 after the widening (that red was F4), 0/24 with both.
     0/24 is not a proof of zero — re-measure rather than trust it:
         node .gauntlet/drive-mp-twoclient.mjs --gate --repeat=24
     Do not restate "deterministic" here from a handful of green runs — run that
     and quote the rate it prints.
     What that costs: this gate exercises neither the opening snapshot nor
     surface relay. The full run and --flake keep both and report them.

   ⚠ THIS ONE NEEDS A BROWSER. Playwright + a chromium download, unlike every
     other file here. It is in run.mjs's SLOW list for that reason: the real
     pass runs it, and the mutation sweep only runs it for the mutation that
     names it.
*/
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const DRIVER = join(HERE, '..', '..', '.gauntlet', 'drive-mp-twoclient.mjs');
const ROOT = join(HERE, '..', '..');

console.log('\n🔁 TWO-CLIENT MP GATE — ' + DRIVER + ' --gate');
/* MP_SRC is passed straight through: run.mjs sets it to a copy of index.html
   with one shipped fix reverted, and the harness serves that copy to BOTH
   contexts. That is what makes the mutation proof possible. */
const r = spawnSync(process.execPath, [DRIVER, '--gate'], {
  cwd: ROOT, encoding: 'utf8', env: process.env, maxBuffer: 32 * 1024 * 1024,
});
process.stdout.write(r.stdout || '');
process.stderr.write(r.stderr || '');
if (r.status !== 0) {
  console.log('❌ two-client gate FAILED (exit ' + r.status + ')');
  process.exit(r.status || 1);
}
console.log('✅ two-client gate passed');
process.exit(0);
