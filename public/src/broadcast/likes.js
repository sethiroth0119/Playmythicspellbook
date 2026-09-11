/* ══════════════════════════════════════════════════════════════════════════
   ❤ LIKES — the measurement. This is the mechanic, so read this file before
   changing a number in it.

   THE RULE, stated once and applied everywhere:

       A post's like count is HOW MANY CITIZENS THE POST IS TRUE FOR.

   That is one rule with two faces, and the second face is the interesting one:

     · a COMPLAINT is true for the people the problem actually touches. "I'm
       appalled at how #healthcare is run" scores the number of residents who
       are outside health coverage. 400 outranks 9, which is exactly the
       "gauge the scale or severity of a reported problem" the brief asks for.

     · a CONTENTED post is true for the people actually having that good day.
       "I just love this weather! #perfect — 4 ♡" is not filler: in a city
       where only four people are content enough to agree, four IS the reading.
       Alarms and small talk are measured on one scale, so the player can read
       the whole feed as one instrument instead of learning which rows count.

   🔴 WHY NOT "how many citizens can SEE the post". That was the first design
      and it is worthless: everybody can see everything, so every post scores
      the population and the number carries no information at all. The count
      has to be a claim about the CITY, not about the feed.

   THE CURVE lives in tuning.js (BCAST.likes) with its table and its
   justification. This file is the part that decides `affected` — the input —
   and that decision is where the honesty of the whole feature sits, so every
   branch below names the live reading it came from.

   🔴 THE MAYOR'S LIKE DOES NOT TOUCH THIS NUMBER. `post.likes` is the
      measurement and nothing the player does can move it; `post.mine` is a
      separate boolean and the UI prints `likes + (mine ? 1 : 0)`. An
      instrument whose reading changes when you touch it is not an instrument.
      What the mayor's like actually DOES is in feed.js — it follows the
      SUBJECT, not the post.
   ══════════════════════════════════════════════════════════════════════════ */
import { BCAST } from './tuning.js';
import { rngFrom, jitter } from './rng.js';

/* affected → likes. Monotonic, compressed, seeded-jittered. */
export function likesFor(affected, seedKey) {
  const n = Math.max(0, Math.floor(+affected || 0));
  if (n <= 0) return BCAST.likes.min;
  const raw = BCAST.likes.scale * Math.pow(n, BCAST.likes.exp);
  const j = jitter(rngFrom('bclike|' + String(seedKey)), BCAST.likes.jitter);
  return Math.max(BCAST.likes.min, Math.round(raw * j));
}

/* The inverse, so a panel (or a test, or a curious player) can go back the
   other way. Exposed on the API for exactly that reason: a reading nobody can
   check is a reading nobody should trust. */
export function affectedFor(likes) {
  const l = Math.max(BCAST.likes.min, +likes || 0);
  return Math.round(Math.pow(l / BCAST.likes.scale, 1 / BCAST.likes.exp));
}

/* ── HEADCOUNTS ────────────────────────────────────────────────────────────
   Each helper answers "how many citizens is this true for" from ONE live
   reading, and returns null when it cannot be answered — never 0, because 0
   is a real answer ("nobody") and null is "the module that knows is not
   mounted". A post whose headcount is null is DROPPED rather than published
   with a guessed number. */

/* Coverage shortfall: `pct` is game.cov.pct[need], supply ÷ demand. The people
   the gap represents is (1 − pct) of the population. Note this is the same
   quantity the vitals card prints as a percentage — one derivation, two
   presentations, so the feed and the panel can never disagree. */
export function fromCoverage(pop, pct) {
  if (!Number.isFinite(pop) || !Number.isFinite(pct)) return null;
  const short = Math.max(0, Math.min(1, 1 - pct));
  return Math.round(pop * short);
}

/* …and the other side of it: how many are WELL served, for a contented post. */
export function fromCoverageGood(pop, pct) {
  if (!Number.isFinite(pop) || !Number.isFinite(pct)) return null;
  const served = Math.max(0, Math.min(1, pct));
  return Math.round(pop * served);
}

/* The grid. /src/power's `factor` is its demand ladder's answer: 1 means every
   building got what it asked for. (1 − factor) of the city is running short. */
export function fromPowerFactor(pop, factor) {
  if (!Number.isFinite(pop) || !Number.isFinite(factor)) return null;
  return Math.round(pop * Math.max(0, Math.min(1, 1 - factor)));
}

/* /src/water reports capacity/draw/shortfall in its own per-minute ledger
   units. The FRACTION is what transfers to people; the absolute number does
   not, and printing it as a headcount would be a unit error that looks fine. */
export function fromWaterShortfall(pop, sup) {
  if (!sup || !Number.isFinite(pop)) return null;
  const draw = +sup.draw || 0;
  if (draw <= 0) return 0;
  return Math.round(pop * Math.max(0, Math.min(1, (+sup.shortfall || 0) / draw)));
}

/* A count that arrives already in people — demographics flows, roster counts.
   Kept as a named function anyway so every call site in sources.js reads the
   same way and a reviewer can see at a glance which numbers were derived and
   which were handed over whole. */
export function fromPeople(n) {
  return Number.isFinite(+n) ? Math.max(0, Math.round(+n)) : null;
}

/* A personal life event. The claim is about ONE life; the people it is
   additionally true for are the people who know them (their bonds). Capped by
   construction — there is no path from a graduation to a four-digit like
   count, and there must not be, or a happy story would outrank a famine. */
export function fromPerson(bonds) {
  const b = Math.max(0, Math.floor(+bonds || 0));
  return BCAST.personal.self + Math.round(b * BCAST.personal.bondMult);
}

/* A market move. Everyone who buys the thing is affected; nobody else is. So a
   basket good scores the population and an industrial input scores the crews
   of the firms that consume it. `inBasket` and `consumers` both come from the
   economy module — this function invents neither. */
export function fromMarket(pop, inBasket, consumerHeads) {
  if (inBasket) return Number.isFinite(pop) ? Math.round(pop) : null;
  return Number.isFinite(+consumerHeads) ? Math.max(0, Math.round(+consumerHeads)) : null;
}

/* 🔍 THE SELF-CHECK BEHIND THE GUARANTEE IN tuning.js. Sweeps every pair
   (a, round(a·ratio)) across several seed families and reports any inversion.
   Reported on demand rather than at boot — a check that logs on success is one
   everybody learns to scroll past, which is the rule /src/water and
   /src/pollution both state for theirs. */
export function selfCheck(ratio, maxN) {
  const r = +ratio || 1.4;
  const top = Math.max(10, maxN | 0 || 3000);
  for (let a = 1; a <= top; a++) {
    const b = Math.max(a + 1, Math.round(a * r));
    for (const s of ['s1', 's2', 's3', 's4', 's5']) {
      if (likesFor(b, s + b) < likesFor(a, s + a)) {
        return { ok: false, ratio: r, a, b, likesA: likesFor(a, s + a), likesB: likesFor(b, s + b) };
      }
    }
  }
  return { ok: true, ratio: r, tested: top };
}

export default {
  likesFor, selfCheck, affectedFor, fromCoverage, fromCoverageGood, fromPowerFactor,
  fromWaterShortfall, fromPeople, fromPerson, fromMarket,
};
