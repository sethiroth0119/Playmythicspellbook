/* ══════════════════════════════════════════════════════════════════════════
   🦠 THE NAMED VIRUSES — the ones that are a WORLD EVENT, not weather.

   Asked for: "create a few virus that can cause a world event in the game and
   in each player city builder."

   ── WHAT MAKES THESE DIFFERENT FROM A WILD STRAIN ─────────────────────────
   outbreak.js already grows strains out of one city's own neglect: bad water,
   no clinics, overcrowding. Those are private weather. THESE five are the
   other kind — the whole server is inside the same one at the same time, they
   are announced, and they end. Concretely, a world virus:

     · is the SAME strain for every player. Its signature is derived from the
       window index, not from a per-player roll, so two players comparing
       notes see identical numbers and a cure recipe that works for one is
       worth telling the other about. That is the entire point of it being a
       world event rather than five unrelated ones.
     · lands in EVERY player's city builder through the ordinary
       outbreak.introduce() path — no second infection engine, no bypass of
       the model that already decides who gets sick and how fast.
     · is visible from the game side (the Research Facility card, the camp
       banner) even for a player who never opens the city builder.

   ── THE WINDOW ────────────────────────────────────────────────────────────
   Derived from the clock exactly the way the Foundation Reserve's economy
   events are (`frActiveEvent` in index.html): one hash of the window index
   picks whether an event is running and which one. So there is NO table to
   write, no cron, no server authority to add — every client computes the same
   answer from the same clock, which is what makes it agree across players
   without anything being synchronised.

   🔴 IT PAYS NOTHING BY ITSELF, and that is deliberate. This file names a
   virus and says when it is loose. Everything the player earns for fighting
   it goes through the audited paths that already exist: cure batches through
   craftBatch, shipment payouts through the Operations ledger, city relief
   through the outbreak model. A world event that minted Cinder from a clock
   every client can read would be a faucet keyed to the wall time.
   ══════════════════════════════════════════════════════════════════════════ */

import { makeStrain } from './strains.js';

/* One window is six real hours, and the same length for everyone. Matches the
   cadence the Reserve's economy events already run at, so a player is not
   learning two different clocks. */
export const WINDOW_MS = 6 * 3600 * 1000;

/* 🦠 THE FIVE. Each leans its signature along the axes in strains.js:
   vector (how it spreads), envelope (how hard it is to reach with a cure),
   replication (how fast it copies), resilience (how well it survives
   treatment). `lean` is what the cure has to answer, and the blurb is what the
   player is told before they have sequenced anything.

   ⚠ `cityFx` is the CITY BUILDER's half — a modifier the city applies while
     the event runs, on top of the infections themselves. Read by
     /src/city and node-city through worldEventCityFx(); each field is a
     multiplier or a flat nudge on an existing city number, never a new
     resource and never Cinder. */
export const WORLD_STRAINS = [
  {
    id: 'ashlung',
    name: 'Ashlung',
    icon: '🌫',
    family: 'respiratory',
    lean: { vector: 88, envelope: 45, replication: 70, resilience: 35 },
    severityBias: 0.18,
    seedCases: 3,
    blurb: 'It rides the ash. Wherever people are packed in together it is already everywhere — but it is thin-walled, and a plain broad-spectrum base reaches it.',
    line: 'Ashlung is moving through every settlement on the wind. Crowded districts are lighting up first.',
    cityFx: { health: -0.14, labour: 0.92, unrest: +0.06 },
  },
  {
    id: 'vaultrot',
    name: 'Vault Rot',
    icon: '🟣',
    family: 'anomalous',
    lean: { vector: 40, envelope: 90, replication: 45, resilience: 78 },
    severityBias: 0.30,
    seedCases: 2,
    blurb: 'Came up out of a breached Foundation vault. Slow, and almost impossible to reach: the envelope shrugs off anything that is not cut with Corrupted Essence.',
    line: 'A Foundation vault let something out. Vault Rot spreads slowly and does not respond to ordinary medicine.',
    cityFx: { health: -0.10, research: 0.85, unrest: +0.12 },
  },
  {
    id: 'quickblight',
    name: 'Quickblight',
    icon: '⚡',
    family: 'bloodborne',
    lean: { vector: 62, envelope: 38, replication: 95, resilience: 30 },
    severityBias: 0.22,
    seedCases: 4,
    blurb: 'Doubles overnight. A city that waits a day to respond is treating four times the caseload — but it burns out fast if you hit the replication axis hard.',
    line: 'Quickblight is doubling by the day. Whatever you are going to do about it, do it now.',
    cityFx: { health: -0.20, labour: 0.86, food: 0.94 },
  },
  {
    id: 'greyfever',
    name: 'Grey Fever',
    icon: '🩶',
    family: 'neural',
    lean: { vector: 55, envelope: 62, replication: 40, resilience: 88 },
    severityBias: 0.26,
    seedCases: 2,
    blurb: 'Sits in the nervous system and will not leave. Survivable, treatable, and it comes back — resilience this high means half-doses buy weeks, not cures.',
    line: 'Grey Fever is in the wards again. It relapses; a half-measure only postpones it.',
    cityFx: { health: -0.12, research: 0.90, labour: 0.94 },
  },
  {
    id: 'hollowtide',
    name: 'Hollowtide',
    icon: '🌑',
    family: 'anomalous',
    lean: { vector: 75, envelope: 80, replication: 72, resilience: 70 },
    severityBias: 0.42,
    seedCases: 3,
    /* The hard one. Deliberately rare — see pickIndex(). */
    blurb: 'Every axis high at once. Nothing in one bottle answers it; a cure for Hollowtide is a compromise, and the assay is the only way to know which one you made.',
    line: 'Hollowtide is here. It is fast, it is armoured, and it is everywhere at once.',
    cityFx: { health: -0.26, labour: 0.82, food: 0.90, unrest: +0.16 },
  },
];

export const WORLD_STRAIN_BY_ID = {};
WORLD_STRAINS.forEach((s) => { WORLD_STRAIN_BY_ID[s.id] = s; });

/* Same hash the Reserve's economy window uses. Kept local rather than imported
   because index.html's copy is a top-level const a module cannot see. */
function hash32(n) {
  n = (n | 0) ^ 0x9e3779b9;
  n = Math.imul(n ^ (n >>> 15), 0x85ebca6b);
  n = Math.imul(n ^ (n >>> 13), 0xc2b2ae35);
  return (n ^ (n >>> 16)) >>> 0;
}

export function windowIndex(now) {
  return Math.floor((Number.isFinite(+now) ? +now : Date.now()) / WINDOW_MS);
}

/* Which virus is loose in a given window, or null for a calm one.
   🔴 CALM IS THE COMMON CASE. Three windows in five are quiet, and Hollowtide
      is gated behind a second test so the hardest one is not simply one in
      five — a permanent pandemic is just a difficulty setting with extra
      steps, and the city is supposed to get to recover. */
function pickIndex(w) {
  const h = hash32(w);
  if (h % 5 < 3) return -1;                        // calm
  const i = (h >>> 8) % WORLD_STRAINS.length;
  if (WORLD_STRAINS[i].id === 'hollowtide' && ((h >>> 16) % 3) !== 0) {
    return ((h >>> 20) % (WORLD_STRAINS.length - 1));   // re-roll off the hard one
  }
  return i;
}

/* The event running right now: the definition, its window, and the STRAIN
   itself — built through makeStrain from a seed derived only from the id and
   the window, so it is byte-identical for every player in that window. */
export function activeWorldEvent(now) {
  const t = Number.isFinite(+now) ? +now : Date.now();
  const w = windowIndex(t);
  const i = pickIndex(w);
  if (i < 0) return null;
  const def = WORLD_STRAINS[i];
  const endsAt = (w + 1) * WINDOW_MS;
  return {
    def,
    id: def.id,
    window: w,
    startsAt: w * WINDOW_MS,
    endsAt,
    endsInMs: Math.max(0, endsAt - t),
    strainId: worldStrainId(def.id, w),
  };
}

/* The strain id every player's city files this event under. Carrying the
   window means a second outing of the same virus is a NEW strain rather than
   a resumption of the old one — so immunity earned in a previous window does
   not silently cover this one, and the register reads as history. */
export function worldStrainId(defId, w) {
  return 'world:' + defId + ':' + w;
}

/* Build the strain object for an event. Same seed everywhere.

   🔴 THE SIGNATURE IS WRITTEN, NOT ROLLED. makeStrain() gives a well-formed
      strain with every field the rest of the feature expects (contagion,
      mutability, stages, the register shape) and that is what it is used for
      here — but its axes come out of its own rng, and a NAMED virus has to be
      the thing its blurb promises. Ashlung that rolled low vector would be a
      different disease wearing the name, and the player was told what to
      expect before they sequenced it. So the four axes and the severity are
      overwritten from the definition afterwards; everything else stays as
      makeStrain built it. */
export function worldStrain(ev) {
  if (!ev || !ev.def) return null;
  return strainFromDef(ev.def, ev.strainId, 'world:' + ev.def.id + ':' + ev.window);
}

/* The same build, addressable without an event. The lab's register uses it to
   put a named virus on the bench as a REFERENCE SAMPLE — a strain a player can
   study and formulate against without waiting six hours for that virus to come
   round on the world clock.
   ⚠ One builder, deliberately. Two places writing Ashlung's four axes is two
     places for Ashlung to stop being what its blurb promised. */
export function strainFromDef(def, id, seed) {
  if (!def) return null;
  const d = def;
  const s = makeStrain(seed || ('world:' + d.id + ':0'), { family: d.family });
  s.id = id || ('world:' + d.id + ':0');
  s.name = d.name;
  s.icon = d.icon;
  const clamp100 = (n) => Math.max(1, Math.min(99, Math.round(n)));
  s.sig = {
    vector: clamp100(d.lean.vector),
    envelope: clamp100(d.lean.envelope),
    replication: clamp100(d.lean.replication),
    resilience: clamp100(d.lean.resilience),
  };
  s.severity = Math.max(1, Math.min(5, 1 + Math.round((d.severityBias || 0) * 10)));
  s.contagion = +Math.max(0.05, Math.min(0.95, d.lean.vector / 110)).toFixed(3);
  s.world = true;
  s.worldDef = d.id;
  s.origin = 'world-event';
  return s;
}

/* The city builder's half. Null when nothing is running, so a caller can
   apply it unconditionally. Multipliers default to 1 and nudges to 0, which
   is what makes a missing field safe to multiply or add. */
export function worldEventCityFx(now) {
  const ev = activeWorldEvent(now);
  if (!ev) return null;
  const fx = ev.def.cityFx || {};
  return {
    id: ev.def.id,
    name: ev.def.name,
    icon: ev.def.icon,
    line: ev.def.line,
    endsAt: ev.endsAt,
    health: Number.isFinite(+fx.health) ? +fx.health : 0,
    labour: Number.isFinite(+fx.labour) ? +fx.labour : 1,
    food: Number.isFinite(+fx.food) ? +fx.food : 1,
    research: Number.isFinite(+fx.research) ? +fx.research : 1,
    unrest: Number.isFinite(+fx.unrest) ? +fx.unrest : 0,
  };
}

/* A short line for a banner, wherever one is wanted. */
export function worldEventBanner(now) {
  const ev = activeWorldEvent(now);
  if (!ev) return null;
  const mins = Math.max(0, Math.round(ev.endsInMs / 60000));
  const left = mins >= 60 ? Math.floor(mins / 60) + 'h ' + (mins % 60) + 'm' : mins + 'm';
  return {
    id: ev.def.id,
    text: ev.def.icon + ' ' + ev.def.name + ' — ' + ev.def.line,
    short: ev.def.icon + ' ' + ev.def.name,
    left,
    endsAt: ev.endsAt,
  };
}

export default {
  WINDOW_MS, WORLD_STRAINS, WORLD_STRAIN_BY_ID,
  windowIndex, activeWorldEvent, worldStrain, worldStrainId,
  worldEventCityFx, worldEventBanner,
};
