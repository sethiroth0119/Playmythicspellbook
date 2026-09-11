/* ════════════════════════════════════════════════════════════════════════════
   🏗 CONSTRUCTION TIMERS — the duration curve, and NOTHING else.
   ----------------------------------------------------------------------------
   How long a building takes to go up. One pure function over a PROFILE.

   🔴 WHY THE MATH IS HERE AND NOT IN node-city/index.html.
   Rule 4: every economy number lives in ECON. A duration curve written in
   index.html would need `gamma`, `costExp`, four weights, four full-scale
   divisors and a 24-hour ceiling sitting as literals next to the code that
   uses them, and the first retune would leave the shop card printing one
   number while the tick counted down another. Putting the curve in the module
   also makes it node-testable — tools/economy-tests/run.mjs pins the whole
   shelf (farm → holdco) against the table in SPEC_CONSTRUCTION.md §2.3, so a
   retune that quietly moves the starter shelf above the free Municipal Works
   ceiling fails the gate instead of shipping.

   🔴 WHY THIS FILE READS NOTHING BUT ECON — THE GLOBALS TRAP.
   `game`, `BUILDINGS`, `Profile`, `Corp` are top-level `const` in index.html:
   global LEXICAL bindings, NOT properties of `window`. An ES module cannot see
   them and there is no `window.game`. So this module never asks what a
   building IS. The host — the only code that can read `BUILDINGS`, `genOf` and
   `LEGACY_SERVICE` — builds a plain profile object and hands it over. The
   profile is the entire seam.

   🔴 AND IT MUST DEGRADE TO NOTHING. If /src/economy/* 404s, the host's
   `bldDuration()` finds no `MythicEconomy.buildSeconds`, returns 0, writes no
   timer, and the city places buildings instantly exactly as it did before this
   feature — while `bldNormalize()` COMPLETES every job already on disk rather
   than parking it. A paid-for tile is never held hostage to a CDN hiccup.
   That degrade path is only honest because there is no fallback literal on the
   host side to disagree with this file.

   THE PROFILE (all optional; absent ⇒ 0):
     { cost, cinderPerHr, res, svc, kind, lvl, speedMul, fixedSec }
   `cost` is the RAW `def.cost` / `def.tierCost` dict flattened to one number
   by the host — ⚠ NEVER `costOf()`, which returns tierCost UNSCALED while
   everything else is multiplied by BUILD_CINDER_MULT = 100, so a costOf-derived
   time builds a Stadium (600) faster than a starter Farm (1400). Two of the
   three competing designs shipped that bug off a stale code comment.
   ════════════════════════════════════════════════════════════════════════════ */

import { ECON } from './tuning.js';

/* Local, because the two call sites below are the only ones and a shared
   utils module for three lines is not worth the import. */
function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }

/* ── THE CURVE ──────────────────────────────────────────────────────────────
   Time scales with what a building is WORTH: 65% of the signal is what it
   PRODUCES (cinder/hr, tier-weighted resources, service supply), 35% is what
   it cost. Each channel is normalised against a `full` divisor, the weighted
   sum is clamped to [0,1], and `gamma` bends the result so the starter shelf
   lands in minutes while the top of the game lands at the 24-hour ceiling.

   ⚠ ORDER IS LOAD-BEARING AND IS NOT AN ACCIDENT OF WRITING:
     • the score is clamped AFTER summing, never per channel — clamping each
       channel first would let a Holding Company (nCost 4.53) and an Index Fund
       (nCost 2.16) both saturate at 1.0 and finish in the same 24 hours. The
       top of the shelf has to SEPARATE (indexfund 14h57 vs holdco 24h00) or
       the ceiling stops being a ceiling and becomes the whole late game.
     • the upgrade multiplier applies to the BASE duration, before speed.
     • `speedMul` DIVIDES, and it divides before the cap — a crew makes a job
       shorter, and a 2.0 crew on a 24-hour job still lands at 12 hours rather
       than being clamped to 24 first and then halved to a different number.
     • the maxSec cap is applied LAST, so nothing on any path — upgrade
       multiplier, a hostile profile, a retune — can produce a job longer than
       the 24 hours the feature was asked for.
   ⚠ `speedMul` is floored at 1: a profile that arrives with 0, NaN or a
     negative can only ever fail toward the slower, honest duration, never
     toward a divide-by-zero Infinity.

   `fixedSec` short-circuits everything. Every `op_*` is registered with
   `cost: {}` (index.html:21491), so no cost-derived formula works for them at
   all; they get a flat `ECON.construction.opSec`. Reading the host's
   OPS_MOCK_PRICE literal into a duration would be a Rule-4 breach. */
export function seconds(p) {
  const C = ECON.construction;
  if (!C || !C.on) return 0;
  if (p && p.fixedSec > 0) return clamp(Math.round(p.fixedSec), C.minSec, C.maxSec);
  const w = C.weight, f = C.full;
  const nCin  = (+p.cinderPerHr || 0) / f.cinderPerHr;
  const nRes  = (+p.res         || 0) / f.resource;
  const nSvc  = (+p.svc         || 0) / f.service;
  const nCost = Math.pow(Math.max(0, +p.cost || 0) / f.cost, C.costExp);
  let score = w.cinder*nCin + w.resource*nRes + w.service*nSvc + w.cost*nCost;
  score = Math.min(1, Math.max(0, score));            // clamp AFTER summing
  let sec = C.minSec + (C.maxSec - C.minSec) * Math.pow(score, C.gamma);
  if (p.kind === 1) sec *= C.upgrade.base * Math.pow(C.upgrade.mulPerLevel, (p.lvl|0) - 1);
  sec = sec / Math.max(1, +p.speedMul || 1);          // crew speed, then the cap
  if (!Number.isFinite(sec)) return C.minSec;
  return Math.min(C.maxSec, Math.max(C.minSec, Math.round(sec)));
}

export default { seconds };
