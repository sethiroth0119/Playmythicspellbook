/* ════════════════════════════════════════════════════════════════════════════
   🛏 REST — state, affordability and the actual recovery.
   ----------------------------------------------------------------------------
   Save blob: `Profile.rest`, one field, absent on every existing profile.

       { charges, lastLongAt, lastShortAt, longCount, shortCount }

   Absent reads as "full charges, never rested", so no migration is needed and
   a player who has never opened this feature loses nothing.

   🔴 SPEND BEFORE APPLYING, AND NEVER PARTIALLY.
   The resource spend goes through the bridge's audited `spendRes` — the one
   path that can REFUSE — and if it refuses, nothing else happens. The opposite
   order (recover, then charge) is how this codebase has previously charged a
   player for a building that never persisted; see the note in
   /src/plague/state.js craftBatch. One refusal point, checked first.

   🔴 REFUND IS UNCAPPED. If anything after the spend throws, the refund must
   return the full amount even if it pushes the player over a storage ceiling —
   losing part of a refund to the cap means a failed rest cost real food.
   ════════════════════════════════════════════════════════════════════════════ */

import { REST, priceOf } from './rest.tuning.js';

function b() { try { return window.MythicRestBridge || null; } catch (e) { return null; } }

export function state() {
  const br = b();
  const s = (br && br.restState && br.restState()) || null;
  const out = {
    charges: (s && typeof s.charges === 'number') ? s.charges : REST.short.charges,
    lastLongAt: (s && s.lastLongAt) | 0,
    lastShortAt: (s && s.lastShortAt) | 0,
    longCount: (s && s.longCount) | 0,
    shortCount: (s && s.shortCount) | 0,
  };
  return out;
}

function write(next) {
  const br = b();
  try { br && br.setRestState && br.setRestState(next); } catch (e) {}
  try { br && br.save && br.save(); } catch (e) {}
}

/* Who would this rest affect? The owned, non-dead roster the camp panel lists.
   Heroes already at full everything are still included — they are part of the
   camp and they still talk (see supportScene) — but they do not inflate the
   per-hero cost, because charging food to rest someone who does not need it is
   the kind of detail that reads as a bug. */
export function resters() {
  const br = b();
  let list = [];
  try { list = (br && br.roster && br.roster()) || []; } catch (e) { list = []; }
  return list.filter(h => h && !h.dead);
}

function needsRest(h) {
  return (h.energy | 0) < (h.energyMax | 0)
      || (h.fatigue | 0) > 0
      || (h.stress | 0) > 0
      || ((h.hp != null && h.hpMax != null) && h.hp < h.hpMax);
}

/* Full picture for the UI: what it costs, whether it can be paid, and why not. */
export function quote(mode) {
  const spec = REST[mode] || REST.short;
  const br = b();
  const all = resters();
  const paying = all.filter(needsRest);
  const facilities = (() => { try { return (br && br.facilities && br.facilities()) || {}; } catch (e) { return {}; } })();
  const cost = priceOf(mode, paying.length, facilities);
  const st = state();

  const have = {};
  for (const k of Object.keys(cost)) {
    try { have[k] = (br && br.getRes) ? (br.getRes(k) | 0) : 0; } catch (e) { have[k] = 0; }
  }
  const short = Object.keys(cost).filter(k => have[k] < cost[k]);

  let blocked = null;
  if (mode === 'short' && st.charges <= 0) {
    blocked = 'No short rests left — take a long rest to recover them.';
  } else if (short.length) {
    blocked = 'Not enough ' + short.map(k => `${k} (${have[k]}/${cost[k]})`).join(', ') + '.';
  } else if (!all.length) {
    blocked = 'Nobody in camp to rest.';
  }

  return {
    mode, spec, cost, have,
    charges: st.charges,
    maxCharges: REST.short.charges,
    resting: all.length,
    needing: paying.length,
    canRest: !blocked,
    blocked,
    discount: facilities,
  };
}

/* Do it. Returns { ok, why, healed, recovered, rested:[heroId…] }.
   The caller (index.js) is responsible for the dream roll and the support
   scene — this function does resources and bodies only, so the recovery maths
   stays testable without a DOM. */
export function apply(mode) {
  const q = quote(mode);
  if (!q.canRest) return { ok: false, why: q.blocked };

  const br = b();
  const spec = q.spec;

  // 1️⃣ PAY FIRST. The one refusal point. See the header.
  let paid = true;
  if (Object.keys(q.cost).length) {
    try { paid = !!(br && br.spendRes && br.spendRes(q.cost)); } catch (e) { paid = false; }
  }
  if (!paid) return { ok: false, why: 'Could not pay for the rest.' };

  try {
    // 2️⃣ Recover. Per-hero, through the bridge so the numbers land on the same
    //    fields the hero panels read.
    const rested = [];
    let energyBack = 0, hpBack = 0;
    for (const h of resters()) {
      const eMax = h.energyMax | 0;
      const eNow = h.energy | 0;
      const gain = Math.min(eMax - eNow, Math.ceil(eMax * spec.energyPct));
      const hpMax = h.hpMax | 0, hpNow = h.hp | 0;
      const heal = hpMax ? Math.min(hpMax - hpNow, Math.ceil((hpMax - hpNow) * spec.healPct)) : 0;
      const patch = {
        energy: eNow + Math.max(0, gain),
        fatigue: Math.max(0, Math.round((h.fatigue | 0) * (1 - spec.fatigueClear))),
        stress: Math.max(0, Math.round((h.stress | 0) * (1 - spec.stressClear))),
      };
      if (hpMax) patch.hp = hpNow + Math.max(0, heal);
      if (spec.bondGain) patch.bond = (h.bond | 0) + spec.bondGain;
      try { br && br.patchHero && br.patchHero(h.id, patch); } catch (e) {}
      energyBack += Math.max(0, gain);
      hpBack += Math.max(0, heal);
      rested.push(h.id);
    }

    // 3️⃣ Book the rest.
    const st = state();
    const now = Date.now();
    write({
      charges: spec.refillsShortCharges ? REST.short.charges : Math.max(0, st.charges - 1),
      lastLongAt: mode === 'long' ? now : st.lastLongAt,
      lastShortAt: mode === 'short' ? now : st.lastShortAt,
      longCount: st.longCount + (mode === 'long' ? 1 : 0),
      shortCount: st.shortCount + (mode === 'short' ? 1 : 0),
    });

    return { ok: true, mode, rested, energyBack, hpBack, cost: q.cost, spec };
  } catch (e) {
    // 🔴 UNCAPPED REFUND — see the header. A failure after the spend must not
    // cost the player food.
    try { br && br.refundRes && br.refundRes(q.cost); } catch (e2) {}
    return { ok: false, why: 'Rest failed — resources refunded.' };
  }
}
