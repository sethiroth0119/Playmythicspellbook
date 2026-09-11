/* ════════════════════════════════════════════════════════════════════════════
   🧍 CITIZEN INFLUENCE — what the people of each district think of you.

   Asked for: "connect the influence system to the Ethos Heights Mission Map
   where players can gain influence of the citizens of the location. What they
   do can gain influence… connect it where it makes sense and do not add the
   simulation sliders, make it a real feature for the players."

   Ethos Heights already had a STANDING with the Heights as a whole (the Dilemma
   system) and an INFLUENCE ladder for the camp (/src/influence). Neither is
   about a PLACE. This is: every district on the map keeps its own opinion of
   you, and it moves because of things you actually did there.

   ── 🔴 THE ONE RULE THIS FILE EXISTS TO KEEP ──────────────────────────────
   CITIZEN INFLUENCE IS NOT A CURRENCY AND MUST NEVER PAY CINDER.
   /src/influence is server-authoritative for exactly one reason, written down
   in its own handoff: the first version of it put the rate limit in the browser
   and sql/038 was the fix — "per-faucet RPCs where the SERVER computes the
   amount from state it owns". Its xp is written by `influence_resolve` and by
   nothing else, which is what makes the level the one input with no forgery
   path.
   This track is the opposite: it lives in the player's own profile and the
   client moves it. That is FINE, and only fine, because what it buys is
   gameplay — fuel for your own train, and a line on your own panel. The moment
   it is wired to Cinder, a card, or anything that leaves this player's save, it
   becomes the exploit sql/038 was written to close. It reads the influence
   level; it must never write one.

   ── WHAT MOVES IT ─────────────────────────────────────────────────────────
   Only things the player did IN that district, and only things that already
   happened for other reasons — no new actions, no busywork:
     · surviving a raid there              (more for driving the faction out)
     · fortifying it
   Both are existing events with existing call sites; this hangs off them.

   ── WHAT IT BUYS, TODAY ───────────────────────────────────────────────────
   The train comes home with more fuel from a district whose people back you.
   Chosen deliberately over the two more obvious rewards:
     🚫 raid grip cut — the SERVER owns that in the shared city (creditShared),
        so a client-side bonus would be overwritten on the next sync and the
        player would watch their reward evaporate.
     🚫 slowing the faction push — same reason: state.tick() returns early when
        CLOUD is on because the server runs the push for everybody.
   Fuel is per-player, client-owned and immediately felt, so it is honest to
   pay it here. More can hang off `of()` later without touching any of this.
   ════════════════════════════════════════════════════════════════════════════ */

import { SITE_BY_ID } from './poi.js';

/* 0-100. A band, not a slider: the player is told where they stand in words. */
export const CIT_MAX = 100;
export const CIT_BANDS = [
  { at:  0, key: 'wary',     name: 'Wary',      icon: '👤', blurb: 'They watch you and say nothing.' },
  { at: 20, key: 'known',    name: 'Known',     icon: '🧍', blurb: 'They know your face now.' },
  { at: 45, key: 'trusted',  name: 'Trusted',   icon: '🤝', blurb: 'Doors open when you walk the street.' },
  { at: 70, key: 'backed',   name: 'Backed',    icon: '🎖', blurb: 'They put their own fuel in your tank.' },
  { at: 90, key: 'devoted',  name: 'Devoted',   icon: '🔥', blurb: 'This district is yours in all but name.' },
];

/* What each thing is worth. One table, so a retune is one edit and the panel,
   the log line and the payout can never disagree about the numbers. */
export const CIT_GAIN = {
  raidSurvived: 6,     // you got out alive, and they saw it
  raidCleared: 10,     // …and the faction went with you (paid ON TOP of the above)
  fortified: 4,        // you dug in for them rather than passing through
};

/* 🚂 The fuel a backed district adds to what a raid already brings home. Capped
   low on purpose: this is a thank-you, not an income. At Devoted it is +2 on
   top of the train's own RAID_FUEL, which is a meaningful tank and not a
   replacement for going out. */
export const CIT_FUEL_MAX = 2;

export function bandOf(v) {
  const n = Math.max(0, Math.min(CIT_MAX, v | 0));
  let b = CIT_BANDS[0];
  for (const x of CIT_BANDS) if (n >= x.at) b = x;
  return b;
}

/* The store hangs off the mission-map state, which already rides the profile
   save. `mm` is passed in rather than imported to keep this file free of a
   circular import — state.js imports THIS, so it cannot also be its parent. */
function bag(mmState) {
  if (!mmState.cit || typeof mmState.cit !== 'object') mmState.cit = {};
  return mmState.cit;
}

export function of(mmState, siteId) {
  if (!mmState || !siteId) return 0;
  return Math.max(0, Math.min(CIT_MAX, bag(mmState)[siteId] | 0));
}

/* Every district, for a summary line. */
export function total(mmState) {
  if (!mmState) return 0;
  const b = bag(mmState);
  return Object.keys(b).reduce((n, k) => n + (b[k] | 0), 0);
}

/* 🎖 THE ONE READ FROM /src/influence, AND IT IS READ-ONLY.
   A player whose camp carries weight is listened to faster. The level is the
   server-owned figure (influence_state.xp, written only by influence_resolve),
   so leaning on it here cannot be forged — and nothing here writes back.
   ⚠ Absent module ⇒ multiplier 1. /src/influence 404ing must cost its own
     feature and nothing else, which is the same contract the camp button keeps. */
export function influenceMultiplier() {
  try {
    const MI = (typeof window !== 'undefined') && window.MythicInfluence;
    if (!MI || typeof MI.status !== 'function') return 1;
    const lv = Math.max(1, MI.status().level | 0);
    /* Level 1 → ×1.00, and +6% a level, capped at ×1.5 so a high ladder is a
       help and never the whole story. */
    return Math.min(1.5, 1 + (lv - 1) * 0.06);
  } catch (e) { return 1; }
}

/* Move it. Returns the line to log, or '' when nothing changed — the caller
   decides whether that is worth telling the player about. */
export function gain(mmState, siteId, base, why) {
  if (!mmState || !siteId || !(base > 0)) return '';
  const b = bag(mmState);
  const before = Math.max(0, Math.min(CIT_MAX, b[siteId] | 0));
  if (before >= CIT_MAX) return '';
  const add = Math.max(1, Math.round(base * influenceMultiplier()));
  const after = Math.min(CIT_MAX, before + add);
  b[siteId] = after;
  const site = SITE_BY_ID[siteId];
  const name = (site && site.name) || 'the district';
  const bandBefore = bandOf(before), bandAfter = bandOf(after);
  if (bandAfter.key !== bandBefore.key) {
    return bandAfter.icon + ' ' + name + ' — the people call you ' + bandAfter.name + '. ' + bandAfter.blurb;
  }
  return '🧍 ' + name + ' — ' + (why || 'the people take note') + ' (+' + (after - before) + ').';
}

/* 🚂 The reward, in fuel. Whole numbers only: half a fuel is not a thing the
   train can hold, and rounding it up would pay Wary districts. */
export function fuelBonus(mmState, siteId) {
  const v = of(mmState, siteId);
  if (v <= 0) return 0;
  return Math.floor((v / CIT_MAX) * CIT_FUEL_MAX);
}
