/* ════════════════════════════════════════════════════════════════════════════
   👨‍👩‍👧 HOUSEHOLD ARCHETYPES — the maths of "who is a household".
   ----------------------------------------------------------------------------
   Five archetypes: family, couple, single, student share, retired. Each one is
   a DISTRIBUTION rather than a number — a size distribution, an education draw,
   a wealth draw and an age split — because a street where every household is
   3.4 people is not a street, it is an average wearing a street's clothes.

   🔴 EVERY FIGURE COMES FROM ECON.demographics.archetypes. Nothing is written
   down here; this file only knows how to READ that table (expected size, the
   deterministic per-building draw, the age split). Same rule the rest of the
   economy follows — see tuning.js's header.

   ⚠ THIS IS NOT A SECOND CITIZEN ROSTER. /src/city/citizens.city.js owns the
     ~72 NAMED residents with moods and dialogue; households.js owns the
     economic aggregates. This file owns the middle layer neither had: the
     COMPOSITION of the citizenry. Nothing here has a name, and nothing here
     is added to any population count — see index.js `population()`.
   ════════════════════════════════════════════════════════════════════════════ */

import { ECON } from '../economy/tuning.js';

const D = () => ECON.demographics;

/* A 0..1 share read out of ECON. A mis-tuned or absent entry must degrade to a
   number, never to NaN — one NaN in `incomeOf` makes every burden comparison
   false, which reads as "everybody can afford everything" rather than as an
   error. households.js paid for the same shape with a population that silently
   became NaN from one bad byte in a save. */
function clampShare(v, dflt) {
  const n = Number(v);
  return isFinite(n) ? Math.max(0, Math.min(1, n)) : (dflt || 0);
}

export function archetypeIds() { return Object.keys(D().archetypes); }
export function archetype(id) { return D().archetypes[id] || null; }
export function eduOrder() { return D().education.order; }
export function eduDef(id) { return D().education.levels[id] || null; }

/* The band of jobs a resident with this education may hold. Anything below it
   they may also hold — see households.js `hire()` for the deduction that makes
   "overqualified" a real state instead of a rounding error. */
export function bandOf(edu) {
  const l = eduDef(edu);
  return l ? l.band : 'unskilled';
}
/* …and the inverse: the minimum education a band's jobs demand. */
export function eduRequiredFor(band) {
  return D().education.requires[band] || 'none';
}
/* Is `edu` good enough for `band`? Ladder comparison on ECON's own order, so a
   future fifth rung inserted in the middle needs no edit here. */
export function qualifies(edu, band) {
  const o = eduOrder();
  return o.indexOf(edu) >= o.indexOf(eduRequiredFor(band));
}

/* Expected household size, from the [people, weight] distribution. Used for
   headcount; the DRAW below is used for anything a player can look at. */
export function avgSize(id) {
  const a = archetype(id); if (!a) return 1;
  let n = 0, w = 0;
  for (const [size, weight] of a.size) { n += size * weight; w += weight; }
  return w > 0 ? n / w : 1;
}

/* Workers per household. Students are deliberately part-time: a student share
   of three is not three job-seekers, and pretending otherwise made the labour
   force of a student district read like a factory town's. */
export function workersPer(id) {
  const a = archetype(id); if (!a) return 0;
  if (a.inSchool) return (a.workers || 0) * D().income.studentWorkerPct;
  return a.workers || 0;
}

/* The age split of one household's heads, in PEOPLE. `ages` is a fraction of
   the household and must sum to 1; this multiplies it back up by the size so
   the city-wide age pyramid is a sum of real households rather than a second
   model of the same people. */
export function agesOf(id, size) {
  const a = archetype(id); if (!a) return {};
  const out = {};
  for (const k in D().ages) out[k] = (a.ages[k] || 0) * size;
  return out;
}

/* ── 🎲 THE DETERMINISTIC DRAW ───────────────────────────────────────────────
   A building's dossier has to say "three residents, a couple and a child" and
   say the SAME thing every time the player opens it, in every session, on every
   machine — while the model underneath is aggregate counts with no per-building
   objects in it at all. So the draw is seeded from the tile key: the variety is
   real and free, and simulating 4,000 household objects to get it would cost a
   tick what a hash costs a frame.

   ⚠ Same technique citizens.city.js uses for names ("citizen #7 is Ilva Vantree
     in every session"). The seed is the tile key and NOTHING ELSE that moves —
     seeding off the population or the day would re-roll every family in the
     city every time somebody moved in. */
export function seedOf(str) {
  let h = 2166136261 >>> 0;
  const s = String(str == null ? '' : str);
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return h >>> 0;
}
/* xorshift32. One number in, one number out, no global state — a shared PRNG
   would make one building's dossier depend on which other one was opened first. */
export function rnd(seed) {
  let x = (seed >>> 0) || 0x9e3779b9;
  x ^= x << 13; x >>>= 0;
  x ^= x >> 17;
  x ^= x << 5;  x >>>= 0;
  return x / 4294967296;
}
/* Pick from a {key: weight} bag with a 0..1 roll. Returns null for an empty or
   all-zero bag rather than a key nobody weighted — a zone whose bag is empty
   has no residents, which is a real answer. */
export function pickWeighted(bag, roll) {
  let total = 0;
  for (const k in bag) total += Math.max(0, bag[k] || 0);
  if (!(total > 0)) return null;
  let acc = 0;
  const r = Math.max(0, Math.min(0.999999, roll)) * total;
  for (const k in bag) {
    acc += Math.max(0, bag[k] || 0);
    if (r < acc) return k;
  }
  return Object.keys(bag)[0];
}
/* A size out of the archetype's own distribution, for the same seeded roll. */
export function drawSize(id, roll) {
  const a = archetype(id); if (!a) return 1;
  const bag = {};
  for (const [size, weight] of a.size) bag[String(size)] = weight;
  const k = pickWeighted(bag, roll);
  return k == null ? 1 : +k;
}

/* ── 💰 WEALTH ───────────────────────────────────────────────────────────────
   An archetype's wealth draw, tilted by education: schooling is how a household
   moves up, which is the whole reason the graduation rate exists.
   ⚠ THIS IS A DESCRIPTION, NOT A LEDGER. households.js's three wealth tiers
     hold real Cinder and are the only wealth that can be spent. This decides
     which tier an ARRIVING household joins (index.js hands it over as the
     arrival mix) and what a dossier calls them; it never sets a balance. */
export function wealthWeights(archId, edu) {
  const a = archetype(archId);
  const base = (a && a.wealth) || { low: 1, mid: 0, high: 0 };
  const i = eduOrder().indexOf(edu);
  const lift = i < 0 ? 0 : i;                 // 0..3, one per education rung
  const L = D().wealthLift;
  return {
    low:  Math.max(0, base.low  * (1 + L.low  * lift)),
    mid:  Math.max(0, base.mid  * (1 + L.mid  * lift)),
    high: Math.max(0, base.high * (1 + L.high * lift)),
  };
}
/* The single tier a household reads as, for a dossier line. The weights above
   are a distribution; this is its mode, which is what a one-line panel wants. */
export function wealthTier(archId, edu) {
  const w = wealthWeights(archId, edu);
  let best = 'low', bv = -1;
  for (const t of ['low', 'mid', 'high']) if (w[t] > bv) { bv = w[t]; best = t; }
  return best;
}
export const TIER_LABEL = { low: 'Struggling', mid: 'Comfortable', high: 'Well off' };
export const TIER_ICO   = { low: '🪫', mid: '💰', high: '💎' };

/* ── 💸 WHAT A HOUSEHOLD CAN OFFER FOR RENT, PER ECONOMIC DAY ────────────────
   Wages come from ECON.labor and nowhere else. Students and pensioners are the
   two groups with no wage of their own, and their share of the unskilled wage
   is in ECON.demographics.income for the same reason every other number is in
   ECON: a second copy is a copy that drifts.

   `jobFit` is the share of this band's seekers who actually find work — so a
   household's affordability falls when the labour market does, which is what
   makes a downturn show up as people not moving in rather than as a number. */
export function incomeOf(archId, edu, jobFit) {
  const a = archetype(archId); if (!a) return 0;
  const dm = D();
  const base = ECON.labor.bands.unskilled.wage;
  const fit = Math.max(dm.income.floorPct, Math.min(1, jobFit == null ? 1 : jobFit));
  if (a.inSchool) {
    /* 🎓 A SHARE POOLS ITS RENT — THAT IS WHY IT IS A SHARE, AND IT IS THE
       OTHER HALF OF WHY STUDENT DISTRICTS STOPPED BEING STUDENT DISTRICTS.
       This read `Math.max(1, workersPer(archId))`, and `workersPer` is 0.5 for
       a student household by design (see its header — a share of three is not
       three job-seekers, and pretending otherwise gave a student district the
       labour force of a factory town). So the max() pinned EVERY student
       household, from a bedsit to a four-person flat, at exactly ONE part-time
       income — while the rent it was tested against was the whole dwelling's.
       Measured: a student household offered 15.96/day against a low-rent
       dwelling at 9.19, a burden of 0.58 — over `rent.burdenMax` (0.55), so
       students were BLOCKED FROM THE CHEAPEST ZONE IN THE CITY at 78%
       occupancy, and blocked harder the fuller it got. A lone `single` on 43.16
       outbid four students sharing.
       ⚠ `studentPct` is "part-time work AND SUPPORT" per student — grants,
         parents, a bar shift — and every head in the share brings their own. So
         it scales with the SIZE of the share, which is the whole economic point
         of sharing. Deliberately NOT `workersPer`: how many of them are chasing
         a job and how many of them are paying the rent are different questions,
         and conflating them is what produced the bug. The labour ladder still
         counts them at the part-time weight and is untouched by this. */
    /* …and only the WORK half of it moves with the labour market. The support
       half — grants, loans, parents — arrives whatever the city's firms are
       doing, exactly as the pension below does. See ECON's studentSupportShare
       for the measurement that made this necessary. */
    const sup = clampShare(dm.income.studentSupportShare);
    return base * dm.income.studentPct * avgSize(archId) * (sup + (1 - sup) * fit);
  }
  let n = 0;
  const workers = workersPer(archId);
  if (workers > 0) {
    const band = ECON.labor.bands[bandOf(edu)] || ECON.labor.bands.unskilled;
    n += workers * band.wage * fit;
  }
  // Retired heads draw a pension whatever the labour market is doing.
  const seniors = (a.ages.senior || 0) * avgSize(archId);
  n += seniors * base * dm.income.pensionPct;
  return n;
}

/* ── 🎓 THE EDUCATION DRAW, TILTED BY THE ZONE ──────────────────────────────
   An archetype carries its own education weights; the ZONE tilts them. That
   second half is what makes zoning a decision rather than a look: without it a
   `single` was equally likely to be a graduate in a low-rent block and in a
   penthouse, so a city of nothing but low-rent housing still staffed its
   research labs (measured: 18 university-educated residents in a 10-tile
   all-low-rent city, every advanced vacancy filled).
   Returns a NORMALISED {edu: share}. A tilt of all-zero is treated as no tilt
   rather than as "nobody lives here" — a mis-tuned table must not empty a zone. */
export function eduDraw(archId, tilt) {
  const a = archetype(archId);
  const out = {};
  if (!a) return out;
  let sum = 0;
  for (const e of eduOrder()) {
    const w = Math.max(0, (a.edu[e] || 0)) * (tilt ? Math.max(0, tilt[e] == null ? 1 : tilt[e]) : 1);
    out[e] = w; sum += w;
  }
  if (!(sum > 0)) {
    for (const e of eduOrder()) { const w = Math.max(0, a.edu[e] || 0); out[e] = w; sum += w; }
  }
  if (!(sum > 0)) return {};
  for (const e in out) out[e] /= sum;
  return out;
}

/* A label for the panel and the dossier: "Family · College · Comfortable". */
export function describe(archId, edu) {
  const a = archetype(archId), e = eduDef(edu);
  if (!a) return '';
  return a.name + (e ? ' · ' + e.short : '');
}
