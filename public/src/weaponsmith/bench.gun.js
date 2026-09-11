/* ═══════════════════════════════════════════════════════════════════════════
   🔧 THE ASSEMBLY BENCH — strip → clean → assemble → proof → keep.

   Three sources of difficulty, all faithful to the reference and all cheap in
   DOM (§6a):
     1. ORDER   — a dependency graph per blueprint. Refused WITH the reason.
     2. FITMENT — mount tags, including the cross-part rail rule. Same.
     3. TORQUE  — a per-fastening timing bar, modelled on the WF3 reel
                  (progress vs tension, hold-to-fill, overshoot fails).

   Those three plus part condition produce ONE number, `qualityFactor`, and
   that number is the only thing the mint consumes. Keeping the scoring here
   and the budget maths in mint.js means the balance rule (§3) stays provable
   on its own: whatever the bench reports, the mint cannot exceed the pool.

   🔴 THE BENCH STATE IS PERSISTED AND THE PARTS ARE ALREADY SPENT.
   Seating a part removes it from the inventory immediately. That is what makes
   a half-built weapon a real commitment rather than a preview — and it is why
   __weaponSmith__ restores LOCAL-WINS, and why every failure path below puts
   the part back rather than dropping it.
   ═══════════════════════════════════════════════════════════════════════════ */

import { ensureWeaponSmith, wsLog, wsSave } from './state.js';
import { bridge, ready, itemCount, moveItem } from './ws.bridge.js';
import { partDef, tierOf } from './parts.js';
import { blueprint, canSeat, checkFit, requiredSlots, stepFor } from './blueprints.js';
import { mintFromBench } from './mint.js';

/* ── Torque ───────────────────────────────────────────────────────────────
   One fastening. The player holds to drive the fastener and releases to let it
   settle; the green band is the correct torque. Under-torque and over-torque
   both cost quality, and going far past strips the fastener — which costs a
   weaponParts and the step has to be redone.

   Difficulty narrows the band rather than speeding the bar: a narrower window
   reads as "this tolerance is mean", where a faster bar just reads as unfair. */
export const TORQUE_BAND = { 1: [0.62, 0.86], 2: [0.68, 0.84], 3: [0.72, 0.82] };
export const TORQUE_STRIP = 0.97;          // past this, the fastener is stripped

export function torqueScore(value, difficulty) {
  const band = TORQUE_BAND[difficulty] || TORQUE_BAND[1];
  const v = Math.max(0, Math.min(1, Number(value) || 0));
  if (v >= TORQUE_STRIP) return { score: 0, stripped: true, note: 'Stripped the fastener.' };
  if (v >= band[0] && v <= band[1]) return { score: 1, stripped: false, note: 'Torqued to spec.' };
  // Outside the band, fall off with distance rather than to zero — a near miss
  // should be a worse weapon, not a failed one.
  const d = v < band[0] ? (band[0] - v) / band[0] : (v - band[1]) / (1 - band[1]);
  return { score: Math.max(0, 1 - d * 1.6), stripped: false, note: v < band[0] ? 'Under-torqued — it will rattle.' : 'Over-torqued — the threads complained.' };
}

/* ── The build ────────────────────────────────────────────────────────────*/

export function startBuild(blueprintId) {
  if (!ready()) return null;
  const bp = blueprint(blueprintId);
  if (!bp) return null;
  const s = ensureWeaponSmith();
  if (s.bench) return null;                  // one bench, one build — pull the old one first
  s.bench = {
    blueprintId: bp.id,
    seated: {},        // slot -> { partId, torque, order }
    order: [],         // slots in the order they were actually seated
    misfits: 0,        // refused attempts — they cost quality, not progress
    stripped: 0,       // fasteners stripped
    startedAt: Date.now(),
  };
  wsLog('build', 'Started a ' + bp.name + ' build.');
  wsSave();
  return s.bench;
}

/* Put everything back and clear the bench. The parts return to the inventory
   because they were really taken — abandoning a build must cost time and
   torque, never materials the player can no longer account for. */
export function abandonBuild() {
  if (!ready()) return false;
  const s = ensureWeaponSmith();
  if (!s.bench) return false;
  for (const slot in s.bench.seated) {
    const seat = s.bench.seated[slot];
    if (seat && seat.partId) { try { moveItem(seat.partId, +1); } catch (e) {} }
  }
  wsLog('build', 'Abandoned the build — parts returned to the vault.');
  s.bench = null;
  wsSave();
  return true;
}

/* Hydrate the seated map into part DEFS, which is what the order and fitment
   checks actually reason about. */
function seatedDefs(bench) {
  const out = {};
  for (const slot in (bench.seated || {})) {
    const seat = bench.seated[slot];
    const d = seat && partDef(seat.partId);
    if (d) out[slot] = d;
  }
  return out;
}

/* Dry-run: may this part go on right now? Pure, so the UI can grey out a
   station and show the reason without touching anything. */
export function tryFit(partIdStr) {
  const s = ensureWeaponSmith();
  if (!s.bench) return { ok: false, reason: 'No build on the bench.' };
  const bp = blueprint(s.bench.blueprintId);
  const d = partDef(partIdStr);
  if (!d) return { ok: false, reason: 'That is not a weapon part.' };
  const slot = d.part.slot;
  const order = canSeat(bp, slot, s.bench.seated);
  if (!order.ok) return order;
  return checkFit(bp, slot, d, seatedDefs(s.bench));
}

/* Seat a part. `torqueValue` is where the player released the bar, 0..1.

   Order of operations matters and is deliberate: validate, THEN take the part,
   THEN record. Taking first would mean a refused fit had to give the part
   back, and every give-back is a chance to lose one. */
export function seatPart(partIdStr, torqueValue) {
  if (!ready()) return { ok: false, reason: 'Bench unavailable.' };
  const s = ensureWeaponSmith();
  if (!s.bench) return { ok: false, reason: 'No build on the bench.' };

  const d = partDef(partIdStr);
  if (!d) return { ok: false, reason: 'That is not a weapon part.' };
  if (itemCount(partIdStr) < 1) return { ok: false, reason: 'You do not have a ' + d.name + '.' };

  const check = tryFit(partIdStr);
  if (!check.ok) {
    /* A refusal is a MISFIT, and misfits cost quality. Without that the
       optimal play is to brute-force every part into every station until one
       sticks, which turns a knowledge game into a clicking game. The part is
       NOT consumed — you learn, you do not lose. */
    s.bench.misfits = (s.bench.misfits | 0) + 1;
    wsSave();
    return { ok: false, reason: check.reason, misfit: true };
  }

  const bp = blueprint(s.bench.blueprintId);
  const st = stepFor(bp, d.part.slot);
  const tq = torqueScore(torqueValue == null ? 0.74 : torqueValue, st.torque);

  if (tq.stripped) {
    /* Stripping costs a weaponParts and the step is not seated. The part
       survives — it is the FASTENER that is ruined, which is also why the cost
       is weaponParts (the fastener bucket) and not the part itself. */
    s.bench.stripped = (s.bench.stripped | 0) + 1;
    try { bridge().addRes('weaponParts', -1); } catch (e) {}
    wsSave();
    return { ok: false, reason: tq.note + ' Try that fastening again.', stripped: true };
  }

  if (!moveItem(partIdStr, -1)) return { ok: false, reason: 'Could not take the part from your vault.' };

  s.bench.seated[d.part.slot] = { partId: partIdStr, torque: tq.score, order: s.bench.order.length };
  s.bench.order.push(d.part.slot);
  wsSave();
  return { ok: true, note: tq.note, slot: d.part.slot, torque: tq.score };
}

/* Pull a seated part back off. Returns it to the vault — see the header. */
export function pullPart(slot) {
  if (!ready()) return false;
  const s = ensureWeaponSmith();
  if (!s.bench || !s.bench.seated[slot]) return false;
  /* Anything that depends on this station has to come off first. Letting a
     player pull the barrel out from under a seated handguard would leave the
     dependency graph describing a state the bench is not in. */
  const bp = blueprint(s.bench.blueprintId);
  const dependents = (bp.steps || []).filter((st) => st.requires.indexOf(slot) >= 0 && s.bench.seated[st.slot]);
  if (dependents.length) return { ok: false, reason: 'Pull the ' + dependents.map((x) => x.slot).join(' and ') + ' first.' };

  const seat = s.bench.seated[slot];
  moveItem(seat.partId, +1);
  delete s.bench.seated[slot];
  s.bench.order = s.bench.order.filter((x) => x !== slot);
  wsSave();
  return { ok: true };
}

/* ── Scoring ──────────────────────────────────────────────────────────────
   Every input the bench has, folded into one 0..1 number. Deliberately pure
   and exported so the UI can show a live estimate that cannot disagree with
   what the mint will actually do. */
export function scoreBuild(bench) {
  if (!bench) return null;
  const bp = blueprint(bench.blueprintId);
  const slots = Object.keys(bench.seated || {});
  if (!slots.length) return { quality: 0, cap: 1, torque: 0, condition: 0, complete: false };

  let torqueSum = 0, condSum = 0, cap = 1;
  for (const slot of slots) {
    const seat = bench.seated[slot];
    const d = partDef(seat.partId);
    const t = d ? tierOf(d.part.tier) : { mult: 0.7, qualityCap: 0.75 };
    torqueSum += seat.torque;
    condSum += t.mult;
    // 🔴 The worst part sets the ceiling. A shot barrel cannot produce a
    // perfect weapon however well the rest is assembled — that is what makes
    // cleaning worth doing rather than optional.
    if (t.qualityCap < cap) cap = t.qualityCap;
  }
  const torque = torqueSum / slots.length;
  const condition = condSum / slots.length;

  // Misfits and stripped fasteners are workmanship, and they are recoverable —
  // a small, bounded penalty, so a learning player is never locked out of a
  // usable weapon by early mistakes.
  const sloppy = Math.min(0.20, (bench.misfits | 0) * 0.02 + (bench.stripped | 0) * 0.04);

  const missing = requiredSlots(bp).filter((sl) => !bench.seated[sl]);
  const raw = (torque * 0.45 + condition * 0.55) - sloppy;
  const quality = Math.max(0, Math.min(cap, raw));

  return { quality, cap, torque, condition, sloppy, complete: missing.length === 0, missing };
}

/* Finish. The bench hands the mint a quality number and an allocation built
   from the parts; the mint applies the budget rule and can refuse. */
export async function finishBuild() {
  if (!ready()) return { ok: false, reason: 'Bench unavailable.' };
  const s = ensureWeaponSmith();
  if (!s.bench) return { ok: false, reason: 'No build on the bench.' };

  const sc = scoreBuild(s.bench);
  if (!sc.complete) {
    return { ok: false, reason: 'Still missing the ' + sc.missing.join(', the ') + '.' };
  }

  /* Allocation is the SUM of the seated parts' weights. Parts decide where the
     blueprint's pool lands; they never enlarge it (§3). Negative weights are
     kept — a heavy barrel really does cost you speed. */
  const alloc = {};
  for (const slot in s.bench.seated) {
    const d = partDef(s.bench.seated[slot].partId);
    if (!d) continue;
    for (const k in d.part.alloc) alloc[k] = (alloc[k] || 0) + d.part.alloc[k];
  }
  for (const k in alloc) if (alloc[k] <= 0) delete alloc[k];

  const parts = Object.keys(s.bench.seated).map((sl) => s.bench.seated[sl].partId);
  const def = await mintFromBench(s.bench.blueprintId, alloc, sc.quality, parts);
  if (!def) return { ok: false, reason: 'The build did not pass proof.' };

  s.bench = null;
  wsSave();
  return { ok: true, item: def, quality: Math.round(sc.quality * 100) };
}
