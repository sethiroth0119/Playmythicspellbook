/* ═══════════════════════════════════════════════════════════════════════════
   ⚔️ THE FORGE BENCH — heat → hammer → quench → temper → grind → sharpen.

   Deliberately a DIFFERENT GAME from the assembly bench, because a blade is
   not assembled from parts, it is made from a billet. There is no dependency
   graph to learn and no fitment to get wrong; instead the sequence is FIXED
   and the difficulty is entirely in the execution — every step has a narrow
   correct band and a point past which the steel is ruined.

   The shared skeleton is deliberate too: a finished blade goes through the
   same budget rule (§3), the same ws_mint, and lands in the same crafted item
   book as a finished gun. Only the bench that produces it differs.

   🔴 WHAT MAKES THIS DIFFERENT FROM THE GUN BENCH, mechanically:
     · The gun bench forgives — a misfit costs a little quality and you retry.
       The forge does not: a burnt or cracked billet is GONE, along with the
       metal that went into it. That is what makes a blade feel like an act
       rather than an assembly.
     · Quality comes from the WORST step, not the average. One bad quench
       ruins a blade no matter how well it was drawn out — which is true of
       forging and is the reason the tightest band is on the quench.
   ═══════════════════════════════════════════════════════════════════════════ */

import { ensureWeaponSmith, wsLog, wsSave } from './state.js';
import { ready, spendRes, refundRes, getRes } from './ws.bridge.js';
import { blueprint, isBlade, FORGE } from './blueprints.js';
import { mintFromBench } from './mint.js';

/* Score one action. Same shape as the gun bench's torqueScore so the UI can
   share a bar, but the failure is harsher: past `burn` the billet is ruined
   rather than the step simply being redone. */
export function stepScore(value, step) {
  const band = (step && step.band) || [0.6, 0.85];
  const burn = (step && step.burn) != null ? step.burn : 0.95;
  const v = Math.max(0, Math.min(1, Number(value) || 0));
  if (v >= burn) return { score: 0, ruined: true, note: _ruinNote(step) };
  if (v >= band[0] && v <= band[1]) return { score: 1, ruined: false, note: 'Good.' };
  const d = v < band[0] ? (band[0] - v) / band[0] : (v - band[1]) / (burn - band[1]);
  return { score: Math.max(0, 1 - d * 1.5), ruined: false,
           note: v < band[0] ? _shortNote(step) : _longNote(step) };
}

const _ruinNote = (s) => ({
  heat: 'Burnt the steel — it is scrap now.',
  hammer: 'Struck it cold and it cracked.',
  quench: 'Quenched too hard — it split down the spine.',
  temper: 'Cooked the temper out of it.',
  grind: 'Ground straight through the edge.',
  sharpen: 'Took the edge past the steel.',
}[s && s.id] || 'Ruined it.');

const _shortNote = (s) => ({
  heat: 'Too cold to move.', hammer: 'Light taps — it barely drew.',
  quench: 'Pulled it early; it stayed soft.', temper: 'Under-tempered — brittle.',
  grind: 'Barely touched the wheel.', sharpen: 'Edge is still dull.',
}[s && s.id] || 'Under-done.');

const _longNote = (s) => ({
  heat: 'Ran it hot — grain is coarse.', hammer: 'Over-worked the steel.',
  quench: 'Held it in too long.', temper: 'Drew the temper too far — soft.',
  grind: 'Took off more than the profile wanted.', sharpen: 'Over-honed — the edge will roll.',
}[s && s.id] || 'Over-done.');

/* Start a blade. The BILLET IS CHARGED UP FRONT, all of it, because that is
   what makes ruining one hurt. spendRes is all-or-nothing so a short player
   cannot start half a blade. */
export function startForge(blueprintId) {
  if (!ready()) return { ok: false, reason: 'Forge unavailable.' };
  const bp = blueprint(blueprintId);
  if (!bp || !isBlade(bp)) return { ok: false, reason: 'That is not a blade.' };
  const s = ensureWeaponSmith();
  if (s.bench || s.forge) return { ok: false, reason: 'Clear the bench first.' };

  const missing = [];
  for (const r in bp.billet) if (getRes(r) < bp.billet[r]) missing.push((bp.billet[r] - getRes(r)) + ' more ' + r);
  if (missing.length) return { ok: false, reason: 'Need ' + missing.join(', ') + '.' };
  if (!spendRes(bp.billet)) return { ok: false, reason: 'Could not draw the billet.' };

  s.forge = {
    blueprintId: bp.id,
    step: 0,            // index into bp.forge
    rep: 0,             // hammer repetitions done at the current step
    scores: [],         // one score per completed step
    startedAt: Date.now(),
  };
  wsLog('forge', 'Drew a billet for a ' + bp.name + '.');
  wsSave();
  return { ok: true, forge: s.forge };
}

export function currentStep() {
  const s = ensureWeaponSmith();
  if (!s.forge) return null;
  const bp = blueprint(s.forge.blueprintId);
  return (bp && bp.forge[s.forge.step]) || null;
}

/* Work the current step. `value` is where the player released, 0..1.

   Per-step resources are charged HERE rather than up front, because a blade
   abandoned at the quench should not have cost grinding stone. */
export function workStep(value) {
  if (!ready()) return { ok: false, reason: 'Forge unavailable.' };
  const s = ensureWeaponSmith();
  if (!s.forge) return { ok: false, reason: 'Nothing on the forge.' };
  const bp = blueprint(s.forge.blueprintId);
  const step = bp.forge[s.forge.step];
  if (!step) return { ok: false, reason: 'This blade is finished.' };

  // Charge the step's consumables on its FIRST repetition only.
  if (s.forge.rep === 0 && Object.keys(step.res || {}).length) {
    const short = [];
    for (const r in step.res) if (getRes(r) < step.res[r]) short.push((step.res[r] - getRes(r)) + ' more ' + r);
    if (short.length) return { ok: false, reason: step.name + ' needs ' + short.join(', ') + '.' };
    if (!spendRes(step.res)) return { ok: false, reason: 'Could not spend for the ' + step.name.toLowerCase() + '.' };
  }

  const sc = stepScore(value, step);

  if (sc.ruined) {
    /* 🔴 THE BILLET IS GONE. Not refunded — this is the whole weight of the
       forge, and softening it into "try again" would make the harsher bands
       meaningless. What IS returned is nothing: the metal went into a blade
       that no longer exists, which is exactly what happens at a real forge. */
    const s2 = ensureWeaponSmith();
    s2.forge = null;
    s2.ruined = (s2.ruined | 0) + 1;
    wsLog('forge', sc.note + ' The billet is lost.');
    wsSave();
    return { ok: false, ruined: true, reason: sc.note };
  }

  const reps = step.reps || 1;
  s.forge.rep += 1;
  s.forge.scores.push(sc.score);

  if (s.forge.rep >= reps) {
    s.forge.step += 1;
    s.forge.rep = 0;
  }

  const done = s.forge.step >= bp.forge.length;
  wsSave();
  return { ok: true, note: sc.note, score: sc.score, done: done,
           next: done ? null : bp.forge[s.forge.step] };
}

/* 🔴 QUALITY IS THE WORST STEP, NOT THE AVERAGE. One bad quench ruins a blade
   however well it was drawn out. Averaging would let a smith fumble the single
   hardest step and hide it behind five easy ones, which is both wrong about
   forging and removes the reason the quench band is the tightest. */
export function scoreForge(forge) {
  if (!forge || !forge.scores.length) return { quality: 0, worst: 0, steps: 0 };
  let worst = 1, sum = 0;
  for (const v of forge.scores) { if (v < worst) worst = v; sum += v; }
  const avg = sum / forge.scores.length;
  // Worst dominates, average softens it slightly — a single fumble should
  // cost dearly without erasing five good steps entirely.
  const quality = Math.max(0, Math.min(1, worst * 0.7 + avg * 0.3));
  return { quality, worst, avg, steps: forge.scores.length };
}

export function abandonForge() {
  if (!ready()) return false;
  const s = ensureWeaponSmith();
  if (!s.forge) return false;
  // The billet is NOT returned — see workStep. Walking away from hot steel
  // costs the same as ruining it, which is what stops abandoning being a free
  // reroll on a bad first step.
  wsLog('forge', 'Left the billet to go cold. It is scrap.');
  s.forge = null;
  wsSave();
  return true;
}

/* Finish. Allocation comes from the BLADE ITSELF rather than from parts —
   there are none — so it is fixed per blueprint and the player's expression is
   entirely in how well they forged it. That is the trade the forge makes
   against the gun bench: less choice, more craft. */
const BLADE_ALLOC = {
  ws_bp_knife:      { atk: 2, spd: 1, crit: 1 },
  ws_bp_sword:      { atk: 3, spd: 1 },
  ws_bp_greatsword: { atk: 5, def: 1 },
};

export async function finishForge() {
  if (!ready()) return { ok: false, reason: 'Forge unavailable.' };
  const s = ensureWeaponSmith();
  if (!s.forge) return { ok: false, reason: 'Nothing on the forge.' };
  const bp = blueprint(s.forge.blueprintId);
  if (s.forge.step < bp.forge.length) {
    return { ok: false, reason: 'Still to do: ' + bp.forge.slice(s.forge.step).map((x) => x.name).join(', ') + '.' };
  }

  const sc = scoreForge(s.forge);
  const alloc = BLADE_ALLOC[bp.id] || { atk: 1 };
  const def = await mintFromBench(bp.id, alloc, sc.quality, []);
  if (!def) return { ok: false, reason: 'The blade did not pass proof.' };

  s.forge = null;
  s.forged = (s.forged | 0) + 1;
  wsSave();
  return { ok: true, item: def, quality: Math.round(sc.quality * 100), worst: Math.round(sc.worst * 100) };
}
