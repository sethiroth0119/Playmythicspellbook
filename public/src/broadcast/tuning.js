/* ══════════════════════════════════════════════════════════════════════════
   📣 EMERGENCY BROADCAST — TUNING. Every number this feature has lives here.

   The `_opEcon()` pattern (CLAUDE.md): no threshold, no cadence and no like
   coefficient is written down anywhere else in /src/broadcast. A retune is one
   file, and a reviewer can read the whole behaviour of the feed off this table
   without opening the composer.
   ══════════════════════════════════════════════════════════════════════════ */

export const BCAST = {
  version: 1,

  /* ── RETENTION ──────────────────────────────────────────────────────────
     `max` is what the feed holds in memory; `save` is what rides the city
     save. They are different numbers on purpose. A feed that resets on reload
     has no memory of your city, and a feed that grows for ever bloats the
     localStorage blob that ALREADY carries 576 tiles, three pollution fields
     and an economy — so the save keeps the tail a returning player would
     actually scroll, and the session keeps four times that.
     MEASURED on the standard 172-tile district: see stats().saveBytes. */
  feed: {
    max: 120,          // posts held in memory
    save: 40,          // posts written into the save
    bodyMax: 240,      // hard cap on a composed body, characters
    tagsMax: 2,        // hashtags per post — see the HASHTAGS note in phrases.js
  },

  /* ── OBSERVATION CADENCE ────────────────────────────────────────────────
     Driven off the economy tick, in SIMULATED city seconds, not wall clock —
     a tab left open overnight with no ticks running must not fill the feed
     with 900 posts about a city that did nothing. Same instinct as
     node-city's `cityAge`.
     `maxPerPass` is the flood valve: a city that loses power, water and food
     in the same tick has three things to say and says three, not eleven. */
  observe: {
    everySec: 40,          // simulated seconds between observation passes
    maxPerPass: 3,         // posts emitted by one pass, hard cap
    catchUpMaxPasses: 12,  // an offline catch-up can only run this many passes
  },

  /* ── COOLDOWNS, in simulated seconds ────────────────────────────────────
     Without these a brownout that lasts twenty minutes produces forty
     identical Electricity Department posts and the feed becomes a log with
     avatars on it. A subject may only speak again once its cooldown expires
     OR once its severity has moved by `escalateBy` — because a problem that
     gets materially worse IS news again. */
  cooldown: {
    perSubjectSec: 300,
    perPosterSec: 420,       // one citizen cannot dominate the feed
    escalateBy: 0.22,        // severity delta that overrides perSubjectSec
    /* 🔴 WHAT THE MAYOR'S LIKE ACTUALLY DOES. Liking a post follows its
       SUBJECT, and a followed subject reports at half the interval — you
       subscribed to a problem, so the city talks to you about it more often.
       It is the only thing a like changes, and note what it deliberately does
       NOT change: the like COUNT (likes.js owns that and the player cannot
       move it) and the city itself. A feed that got better outcomes when you
       tapped a heart would be a second, hidden policy lever. */
    followedMult: 0.5,
  },

  /* ══ 🔢 LIKES AS MEASUREMENT — THE MECHANIC ═══════════════════════════════
     A like count is a READING, not decoration. It answers exactly one
     question:

         HOW MANY CITIZENS IS THIS POST TRUE FOR?

     For a complaint that is how many people the problem actually touches; for
     a contented post it is how many people are actually having that good day.
     Both directions of the same rule, and the second one is why "I just love
     this weather! #perfect — 4 ♡" is informative rather than filler: in a
     city where only four people are content, four is the news.

     THE CURVE. likes = round( scale × affected^exp ) with a seeded ±jitter.

       affected      1      4      9     40    120    400   2,000
       likes         2      4      8     23     51    120     366

     Compressed (exp < 1) so the numbers stay legible at city scale while
     staying strictly monotonic — a bigger problem ALWAYS outranks a smaller
     one, which is the whole promise. It is invertible, so a player who wants
     the headcount back can read it: affected ≈ (likes / scale)^(1/exp).

     🔴 WHY NOT LINEAR. Linear was the first cut. A citywide food failure in a
        city of 2,000 scored 2,000 and a real, actionable one-block clinic gap
        scored 9, and the feed became one huge number and a column of noise —
        the player stopped reading anything but the top line. Compression is
        what keeps a two-digit and a three-digit reading distinguishable at a
        glance without making everything below the crisis invisible.

     🔴 JITTER IS SEEDED, AND IT IS DELIBERATELY SMALL. ±12% so consecutive
        posts about the same shortfall do not read as a formula, and small
        enough that it can never reorder two posts whose scales genuinely
        differ (the smallest gap the curve produces between adjacent integer
        headcounts is wider than 24% only below ~6 affected, where both
        readings mean "barely anyone"). Seeded on the post id, so a reload
        does not re-roll a number the player already read. */
  likes: {
    exp: 0.72,
    scale: 1.6,
    jitter: 0.12,
    min: 1,
  },

  /* ── SEVERITY BANDS. Which phrasing pool an event gets, and how loud it is.
     Composed posts pick their intensifiers from the band, so a 4% shortfall
     and a 60% shortfall do not use the same adjective. */
  severity: { mild: 0.34, notable: 0.67 },

  /* ══ THRESHOLDS — what counts as post-worthy at all ═══════════════════════
     Every one of these is a claim about the CITY, and the post that comes out
     of it must be true. Set them too low and the feed cries wolf; too high and
     the player learns about a problem from the population graph instead.  */
  thresholds: {
    /* A coverage need is a complaint below this, and a compliment above the
       good line. Between the two, nobody has an opinion worth posting. */
    covBad: 0.82,
    covGood: 1.02,
    /* The grid. `factor` is /src/power's demand ladder: 1 means everyone got
       what they asked for. */
    powerFactor: 0.985,
    /* /src/water reports shortfall in its own per-minute ledger units; this is
       shortfall / draw. */
    waterShortFrac: 0.04,
    /* /src/pollution's air index at a housing tile, 0..1. Above this the
       people living there can taste it. */
    airBad: 0.35,
    /* Demographics: people per economic day. Below −this the city is bleeding
       and the Housing Office says so. */
    netOutPerDay: 1.5,
    /* An economy price mover — |ln(mul)|. 0.18 ≈ a 20% move. */
    priceMove: 0.18,
    /* Unemployment fraction the Labour Exchange will speak about. */
    jobless: 0.12,
    /* Citizen mood bands. The SAME numbers node-city's own life-events layer
       speaks in (LIFE.SLUMP / LIFE.RALLY) — a second opinion about whether
       somebody is happy is two answers to one question. */
    moodLow: 35,
    moodHigh: 70,
  },

  /* How many citizens one post can plausibly speak for when the subject is a
     personal life event rather than a city condition. A graduation is true for
     the graduate and the people who know them; it is not a citywide reading,
     and inflating it would poison the instrument. */
  personal: { self: 1, bondMult: 1 },
};

export default BCAST;
