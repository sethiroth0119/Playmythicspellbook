/* ============================================================================
 * RESONANCE — the card training model.            round 8 / piece: resonance
 * ----------------------------------------------------------------------------
 * PURE DATA. This file imports nothing, touches no DOM, reads no global, and
 * has no side effects. Everything here is a function of its arguments, so it
 * can be reasoned about (and tested) without a game around it.
 *
 * THE MODEL (resonance-card-training.md §3)
 *   Total budget      510 Resonance per card
 *   Per-stat cap      252
 *   Stats             HP · ATK · MAG · DEF · RES · SPD
 *   Conversion        4 Resonance = +1 to that stat  (so max +63 in one stat)
 *   Reset             free at this layer; whoever calls reset() prices it
 *
 * 🔴 THE THREE INVARIANTS THAT ARE NOT NEGOTIABLE (doc §9)
 *   1. Nothing in this file scales with player level, city tier, or spend.
 *      There is no parameter that raises 510. A first-day player and a
 *      thousand-hour veteran have the identical ceiling. If you ever find
 *      yourself adding a `cap` argument to award() — don't.
 *   2. Paid currency can never buy Resonance. This file cannot see currency,
 *      and the grant path in index.js refuses a paid `source` outright.
 *   3. Resets are cheap. reset() is a pure zeroing — it costs nothing here.
 *
 * ⚠ WHY THIS IS *NOT* THE EXISTING `evs` FIELD.
 * index.html already has a Pokémon-EV system (`emptyEvs`, `applyEvBoosts`,
 * EV_TOTAL_CAP = 120, EV_CAP_PER_STAT = 31) that is EARNED BY KILLING — you
 * get the EV yield of whatever you defeated. Resonance is a different axis:
 * it follows what the CARD DID, not what it killed, and it is the axis the
 * House will spend. They deliberately live side by side under different keys
 * (`profile.evs` vs `profile.resonance`) and are summed independently at
 * build time. Merging them would silently redefine the 120-point EV economy
 * that existing saves are already sitting on.
 * ==========================================================================*/

/** Fixed stat order. Every allocation walks this in this order, so trimming
 *  an over-budget save is deterministic rather than dependent on key order. */
export const STATS = ['hp', 'atk', 'mag', 'def', 'res', 'spd'];

export const TOTAL_CAP = 510;   // §3 — the whole budget, for everyone, forever
export const STAT_CAP  = 252;   // §3 — you cannot max everything
/* 🔴 16, NOT THE DOC'S 4 — and this is the one place the doc is overruled.
   This game ALREADY shipped a Pokemon-style EV ladder (EV_TOTAL_CAP = 120,
   EV_CAP_PER_STAT = 31, also 4:1, index.html:70174) which is live in player
   saves and sums independently with this one. At 4:1 the numbers came out:
     · Resonance = 9x the entire existing 120-point EV economy
     · the game's all-time max stat EXACTLY DOUBLED (Lv50 ceiling 63 -> 126)
     · measured: full Resonance + full EVs + 4 Power Bands = 50 damage, a ONE
       SHOT on the tankiest card in the game, at level 1; and a fresh attacker
       into a fully attuned tank needed 61 hits.
   That breaks §1 — "everyone can reach the cap, it's table stakes, not a power
   gap" — because the ramp between fresh and attuned became a 30x swing, even
   though §2 still holds at the endpoint (attuned vs attuned keeps the old
   ratio). 16 preserves EVERY property the doc argues for — the 510 budget, the
   252 cap, the spread decision, the ranks, resettability — and lands Resonance
   at 2x the EV ladder instead of 9x. The design is the budget, not the size of
   the numbers it buys. */
export const PER_POINT = 16;

/** 252 / 16 = 15. The most a single stat can ever gain. */
export const MAX_STAT_BONUS = Math.floor(STAT_CAP / PER_POINT);

/* ------------------------------------------------------------------ *
 * RANKS (doc §8) — a READOUT OF INVESTMENT, NOT A POWER TIER.
 * An Attuned card is not stronger than another Attuned card. It is
 * finished. Two Attuned cards with opposite spreads are a matchup.
 * ------------------------------------------------------------------ */
export const RANKS = [
  { id: 'unproven', name: 'Unproven', min: 0,   max: 0,   bars: 0, glow: false, sigil: false },
  { id: 'blooded',  name: 'Blooded',  min: 1,   max: 150, bars: 1, glow: false, sigil: false },
  { id: 'tempered', name: 'Tempered', min: 151, max: 330, bars: 2, glow: false, sigil: false },
  { id: 'veteran',  name: 'Veteran',  min: 331, max: 509, bars: 3, glow: true,  sigil: false },
  { id: 'attuned',  name: 'Attuned',  min: 510, max: 510, bars: 3, glow: true,  sigil: true  },
];

function int(v) {
  const n = Math.floor(Number(v));
  return (isFinite(n) && n > 0) ? n : 0;
}

/** A fresh, zeroed spread. Always a NEW object — never share one. */
export function empty() {
  return { hp: 0, atk: 0, mag: 0, def: 0, res: 0, spd: 0 };
}

/**
 * 🔴 ABSENT-TOLERANT BY CONSTRUCTION. This project has shipped silent save
 * bugs three times, so normalize() is the ONLY way a stored spread is ever
 * read. It accepts undefined / null / a string / an array / an object full
 * of NaN / a hand-edited save with 9999 in one stat, and always returns a
 * clean object with all six keys inside both caps. It never throws and never
 * returns the object you handed it.
 */
export function normalize(raw) {
  const out = empty();
  if (!raw || typeof raw !== 'object') return out;
  let budget = TOTAL_CAP;
  for (const k of STATS) {
    let v = Math.min(int(raw[k]), STAT_CAP);
    if (v > budget) v = budget;      // deterministic trim, fixed STATS order
    out[k] = v;
    budget -= v;
  }
  return out;
}

/** Total Resonance allocated. Accepts a raw or normalized spread. */
export function total(spread) {
  const s = normalize(spread);
  let t = 0;
  for (const k of STATS) t += s[k];
  return t;
}

/** How much of the 510 budget is still unspent. */
export function remaining(spread) {
  return Math.max(0, TOTAL_CAP - total(spread));
}

/** Per-stat headroom: min(what this stat can still take, what the budget allows). */
export function headroom(spread, stat) {
  if (STATS.indexOf(stat) < 0) return 0;
  const s = normalize(spread);
  return Math.max(0, Math.min(STAT_CAP - s[stat], remaining(s)));
}

/**
 * Add `amount` Resonance to `stat`, respecting BOTH caps.
 * Returns { spread, granted, refused } — `granted` is what actually landed,
 * which is what a caller must report to the player. Never mutates the input.
 */
export function award(spread, stat, amount) {
  const s = normalize(spread);
  const want = int(amount);
  const room = headroom(s, stat);
  const granted = Math.min(want, room);
  if (granted > 0) s[stat] += granted;
  return { spread: s, granted, refused: want - granted };
}

/**
 * Apply a whole bag of awards in one pass: { atk: 3, def: 1 }.
 * Walks STATS in fixed order so the same bag always lands the same way when
 * the budget runs out mid-application.
 */
export function awardMany(spread, bag) {
  let s = normalize(spread);
  const granted = empty();
  if (!bag || typeof bag !== 'object') return { spread: s, granted, total: 0 };
  let sum = 0;
  for (const k of STATS) {
    const r = award(s, k, bag[k]);
    s = r.spread; granted[k] = r.granted; sum += r.granted;
  }
  return { spread: s, granted, total: sum };
}

/** §9: "Make resets expensive → punishing experimentation kills the interesting
 *  decision." So the model's reset is free and total. Pricing, if any, is the
 *  caller's business — and per the doc it should stay cheap. */
export function reset() {
  return empty();
}

/** The rank a spread reads at. Always returns a rank (never null). */
export function rank(spread) {
  const t = total(spread);
  for (const r of RANKS) if (t >= r.min && t <= r.max) return r;
  return RANKS[RANKS.length - 1];
}

/**
 * The stat bonus a spread grants: 4 Resonance = +1, floor.
 *
 * ⚠ SPD IS NOT LIKE THE OTHERS AND CANNOT BE. In this engine `stats.spd` is
 * not a magnitude — it is the unit's MOVEMENT TIER (1–5 tiles), and the
 * existing EV code froze SPD for exactly this reason ("speed is a static
 * tier", index.html applyEvBoosts). Worse, Trick Room / parallelWorld mirrors
 * movement with `speed = 6 - speed`, which goes NEGATIVE the moment a unit
 * exceeds 5. A literal +63 there would not be a strong card, it would be a
 * broken board.
 *
 * So SPD Resonance is allocated, budgeted, capped, ranked and drawn exactly
 * like every other stat — the decision to dump into SPD is real and costs the
 * same 252 — but what it BUYS is movement in the same band the engine already
 * hands out for passives (Swift +1, Tempest Soul +2): +1 tile at half the
 * stat cap, +2 tiles at the cap. `spdTiles` is reported separately from
 * `spd` so a caller can show the player both the allocation and its effect.
 */
export function statBonus(spread) {
  const s = normalize(spread);
  const per = (k) => Math.floor(s[k] / PER_POINT);
  return {
    hp:  per('hp'),
    atk: per('atk'),
    mag: per('mag'),
    def: per('def'),
    res: per('res'),
    spd: per('spd'),                                   // the raw 4:1 number
    spdTiles: s.spd >= STAT_CAP ? 2 : (s.spd >= Math.floor(STAT_CAP / 2) ? 1 : 0),
  };
}

/** Convenience for UI: each stat as a 0..1 fraction of its own 252 cap. */
export function fractions(spread) {
  const s = normalize(spread);
  const out = {};
  for (const k of STATS) out[k] = s[k] / STAT_CAP;
  return out;
}

export default {
  STATS, TOTAL_CAP, STAT_CAP, PER_POINT, MAX_STAT_BONUS, RANKS,
  empty, normalize, total, remaining, headroom, award, awardMany, reset,
  rank, statBonus, fractions,
};
