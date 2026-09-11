/* ============================================================================
   🎖 INFLUENCE — the pure model. No I/O, no globals, no DOM.
   ============================================================================
   Everything in this file is a total function of its arguments. That is not
   tidiness for its own sake: the payout numbers the envoy modal shows are the
   numbers the player is actually paid, so they have to be reproducible in a
   test harness without a Profile, a Supabase session or a browser.

   🔴 THE GLOBALS TRAP (CLAUDE.md). This is an ES module. `Profile`, `Forge`,
   `FoundationReserve` and friends are top-level `const` in index.html —
   LEXICAL globals, not properties of `window` — so nothing here can see them
   and nothing here tries. Everything arrives as an argument.

   WHAT DRIVES A ROLL. The three inputs the feature was specified around:
     • node level  — the PRN/city node tier the player operates (Free … Eternal)
     • influence   — this system's own ladder, earned by hosting envoys
     • reserve rep — lifetime Foundation Reserve contribution points
   They are blended into ONE number, `standing` (0..1), and standing is the only
   thing the rarity table and the sweeteners read. One blend means retuning the
   feature is a single edit, and it means the modal can print "why did I get
   this?" honestly by showing the three parts it was built from.
   ============================================================================ */

/* ── The ladder ─────────────────────────────────────────────────────────────
   Ten levels. The thresholds are XP earned by RESOLVING ENCOUNTERS (see
   XP_FOR below).

   🔴 THESE THRESHOLDS ARE A FUNCTION OF THE ENVOY CADENCE AND MUST MOVE WITH
   IT. They were first written for a 4h clock (~6 visits/day, ~240 XP/day) and
   were rescaled when the clock became 48h. At ~33 XP a visit and one visit
   every two days that is ~16.5 XP/day, so the same numbers left alone would
   have put the top of the ladder 475 days out and quietly turned a progression
   track into a wall. Anyone retuning ENVOY_INTERVAL_MS has to come back here;
   the pacing note on each row below is what to check the new cadence against.

   Current pacing at the 48h clock: Influential (6) at roughly two months,
   Mythic Authority (10) at roughly seven. Long on purpose — the top rank is a
   title, not a milestone — and the Reserve-rank floor below means an
   established contributor does not start at the bottom of it. */
export const INFLUENCE_LEVELS = [
  { lv: 1,  min: 0,    name: 'Unknown',          icon: '🕯' },   //   —
  { lv: 2,  min: 80,   name: 'Noted',            icon: '📜' },   //  ~5 days
  { lv: 3,  min: 220,  name: 'Regarded',         icon: '🎗' },   // ~13 days
  { lv: 4,  min: 430,  name: 'Respected',        icon: '🎖' },   // ~26 days
  { lv: 5,  min: 720,  name: 'Renowned',         icon: '🏵' },   // ~44 days
  { lv: 6,  min: 1100, name: 'Influential',      icon: '⚜️' },   // ~67 days
  { lv: 7,  min: 1580, name: 'Power Broker',     icon: '🗝' },   // ~96 days
  { lv: 8,  min: 2180, name: 'Kingmaker',        icon: '👑' },   // ~132 days
  { lv: 9,  min: 2900, name: 'Sovereign Voice',  icon: '🜲' },   // ~176 days
  { lv: 10, min: 3800, name: 'Mythic Authority', icon: '🏛' },   // ~230 days
];
export const MAX_LEVEL = INFLUENCE_LEVELS[INFLUENCE_LEVELS.length - 1].lv;

/* 🔴 REP NO LONGER SETS A FLOOR ON THE LEVEL, AND THAT IS A SECURITY FIX.
   It used to: a Civilization Builder started at Influence 6 rather than 1, so
   the system did not ignore what they had already done. It had to go.

   `reserve_contributions` carries `rc_upd: for update to authenticated using
   (user_id = auth.uid())` — a player can set their own `points` to any number
   straight through PostgREST. Rep is therefore FORGEABLE, and the level sets
   the Cinder band directly, so a forged rep bought roughly a 19x jump in the
   per-envoy cap. A forgeable input must never drive money multiplicatively.

   Rep still counts, exactly as the feature was specified — it keeps its 0.25
   weight in `standing` (below), where the worst a maxed forgery can buy is
   +7.5% Cinder and some rarity drift. Bounded, not multiplicative.

   ⚠ THE LEVEL NOW COMES FROM XP ALONE, and xp is written only by
     influence_resolve server-side (sql/038), which makes it the one input with
     no forgery path. Keep it that way: never let a client-writable table feed
     the level again.
   ⚠ sql/038 is canonical and does the same thing. If you change one, change
     both, or display and payout will disagree. */

export function levelFromXp(xp) {
  xp = Math.max(0, Number(xp) || 0);
  let lv = 1;
  for (const t of INFLUENCE_LEVELS) if (xp >= t.min) lv = t.lv;
  return lv;
}

/* The level used everywhere. One resolver, so no caller can reintroduce a
   second opinion about what a player's level is.
   ⚠ The second argument is gone on purpose — see the note above. */
export function effectiveLevel(xp) {
  return levelFromXp(xp);
}

export function levelMeta(lv) {
  lv = Math.max(1, Math.min(MAX_LEVEL, lv | 0));
  return INFLUENCE_LEVELS[lv - 1];
}

/* Progress toward the next level. Returns pct 100 at the cap.
   (`floored` is retained as always-false so any older caller reading it keeps
   working; nothing floors a level any more.) */
export function levelProgress(xp) {
  xp = Math.max(0, Number(xp) || 0);
  const earned = levelFromXp(xp);
  const next = INFLUENCE_LEVELS.find((t) => t.min > xp) || null;
  if (!next) return { pct: 100, xp, need: 0, next: null, floored: false };
  const cur = levelMeta(earned).min;
  const span = Math.max(1, next.min - cur);
  return {
    pct: Math.max(0, Math.min(100, Math.round(((xp - cur) / span) * 100))),
    xp, need: Math.max(0, next.min - xp), next, floored: false,
  };
}

/* ── Standing ───────────────────────────────────────────────────────────────
   The single 0..1 dial the whole feature reads.

   ⚠ Every part is normalised INDEPENDENTLY and then weighted, so a player who
     is strong on one axis and absent on another lands in the middle rather
     than at either extreme. Influence carries the most weight because it is
     the axis this feature actually pays out for; node and rep are standing the
     player brings with them. */
export const STANDING_WEIGHTS = { node: 0.30, influence: 0.45, rep: 0.25 };
export const REP_SOFT_CAP = 50000;   // the top Reserve rank; rep saturates here

export function standingParts(input) {
  input = input || {};
  const nodeRank = Math.max(0, input.nodeRankIndex | 0);
  const nodeMax = Math.max(1, (input.nodeRankCount | 0) - 1 || 6);
  const lv = Math.max(1, Math.min(MAX_LEVEL, input.level | 0 || 1));
  const rep = Math.max(0, Number(input.repPoints) || 0);
  return {
    // A tier rank, not the payout rate — Free→Eternal is 0.5%..20%, and using
    // the raw rate would make every tier below Titan indistinguishable.
    node: Math.max(0, Math.min(1, nodeRank / nodeMax)),
    influence: (lv - 1) / (MAX_LEVEL - 1),
    // Log, not linear: the gap between 0 and 5,000 rep matters far more to a
    // player than the gap between 200,000 and 205,000, and a linear scale would
    // leave everyone below the top contributor pinned at ~0.
    rep: Math.max(0, Math.min(1, Math.log10(1 + rep) / Math.log10(1 + REP_SOFT_CAP))),
  };
}

export function standing(input) {
  const p = standingParts(input);
  const s = p.node * STANDING_WEIGHTS.node
          + p.influence * STANDING_WEIGHTS.influence
          + p.rep * STANDING_WEIGHTS.rep;
  return Math.max(0, Math.min(1, s));
}

/* ── Rarity ─────────────────────────────────────────────────────────────────
   Standing does not shift the table by adding a flat bonus to the top end —
   it stretches the TAIL. A common stays the most likely outcome at every
   standing (which is what keeps a mythic feeling like an event), but a Mythic
   Authority with a Titan node sees the far end of the table often enough for
   it to be a real reason to climb. */
export const RARITY_ORDER = ['common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic'];
const RARITY_BASE = [620, 240, 95, 32, 10, 3];
const RARITY_LIFT = 5.0;      // how hard standing pushes the tail
const RARITY_CURVE = 0.5;     // per-step exponent — higher rarities lift faster

export function rarityWeights(s) {
  s = Math.max(0, Math.min(1, Number(s) || 0));
  const lift = 1 + RARITY_LIFT * s;
  const out = {};
  RARITY_ORDER.forEach((id, i) => { out[id] = RARITY_BASE[i] * Math.pow(lift, i * RARITY_CURVE); });
  return out;
}

/* rng is injected so a test can pin every roll. Defaults to Math.random, which
   is the only place in this module that touches it. */
export function rollRarity(s, rng) {
  const r = (typeof rng === 'function') ? rng : Math.random;
  const w = rarityWeights(s);
  let total = 0;
  for (const id of RARITY_ORDER) total += w[id];
  let pick = r() * total;
  for (const id of RARITY_ORDER) { pick -= w[id]; if (pick <= 0) return id; }
  return 'common';
}

export function randInt(lo, hi, rng) {
  const r = (typeof rng === 'function') ? rng : Math.random;
  lo = Math.round(lo); hi = Math.round(hi);
  if (hi < lo) { const t = lo; lo = hi; hi = t; }
  return lo + Math.floor(r() * (hi - lo + 1));
}

/* ── Cinder ─────────────────────────────────────────────────────────────────
   🔴 50,000 IS A HARD CEILING, not a target. It is applied AFTER the standing
   sweetener, so no combination of level, node and rep can produce 50,001 — a
   payout that clears the wallet_credit single-credit bound (sql/034) would be
   refused server-side and the player would see Cinder that never banked.

   The band is driven by LEVEL, as specified. Standing then adds up to +30%,
   which is what keeps node and rep meaningful without letting them substitute
   for the ladder. */
export const CINDER_CEILING = 50000;
const CINDER_CURVE = 1.7;          // level→cap curve; >1 keeps early levels modest
const CINDER_FLOOR_FRAC = 0.18;    // the worst roll is still ~a fifth of the cap
const CINDER_STANDING_BONUS = 0.30;

export function cinderBand(level) {
  const lv = Math.max(1, Math.min(MAX_LEVEL, level | 0 || 1));
  const t = (lv - 1) / (MAX_LEVEL - 1);
  const cap = Math.max(200, Math.round(CINDER_CEILING * (0.02 + 0.98 * Math.pow(t, CINDER_CURVE))));
  return { lo: Math.max(50, Math.round(cap * CINDER_FLOOR_FRAC)), hi: cap };
}

export function rollCinder(level, s, rng) {
  const band = cinderBand(level);
  const raw = randInt(band.lo, band.hi, rng);
  const bumped = Math.round(raw * (1 + CINDER_STANDING_BONUS * Math.max(0, Math.min(1, s || 0))));
  return Math.max(1, Math.min(CINDER_CEILING, bumped));
}

/* ── Resources ──────────────────────────────────────────────────────────────
   Quantity scales with level (as specified) and, mildly, with standing. The
   NUMBER of kinds also grows, because one 400-unit pile of Food is a worse
   prize than three assorted piles the player can actually use — and because a
   wide drop is far likelier to hit the stash ceiling, which is the refusal
   path this feature was asked to handle honestly. */
const RES_PER_LEVEL = 26;
const RES_BASE = 18;
const RES_SPREAD = 0.55;           // worst roll is 55% of the best
const RES_STANDING_BONUS = 0.50;

export function resourceKindCount(level) {
  const lv = Math.max(1, level | 0 || 1);
  return 1 + (lv >= 4 ? 1 : 0) + (lv >= 8 ? 1 : 0);
}

export function rollResourceQty(level, s, rng) {
  const lv = Math.max(1, Math.min(MAX_LEVEL, level | 0 || 1));
  const hi = Math.round((RES_BASE + RES_PER_LEVEL * lv) * (1 + RES_STANDING_BONUS * Math.max(0, Math.min(1, s || 0))));
  return Math.max(1, randInt(Math.round(hi * RES_SPREAD), hi, rng));
}

/* ── Envoy arrival ──────────────────────────────────────────────────────────
   Envoys accrue on a clock and BANK up to a cap, so a player who cannot log in
   for a day loses the overflow but not the day. Accrual is computed from
   `lastAt` rather than ticked, so it is identical online and offline and needs
   no timer.

   ⚠ Consuming one advances `lastAt` by exactly ONE interval, never to now —
     advancing to now would silently destroy the partial progress toward the
     next envoy every single time the player opened the modal. */
/* 🔴 ONE ENVOY PER 48 HOURS, AND THE NUMBER IS AN ANTI-ABUSE DECISION, NOT A
   PACING ONE. A single envoy can pay up to 50,000 Cinder, so the clock IS the
   faucet's rate limit: at the 4h cadence this shipped with, a level-10 camp
   averaged roughly 45,000 Cinder a day out of thin air, which is a scale of
   free income the rest of the economy has no answer to. At 48h the same camp
   averages under 4,000.

   ⚠ CHANGING THIS RESCALES THE LADDER. INFLUENCE_LEVELS above is denominated
     in visits; see the note there before touching this number.

   ⚠ THE CLOCK IS THE CLIENT'S, AND THAT IS A KNOWN LIMIT, NOT AN OVERSIGHT.
     Everything here reads Date.now(), so a player who moves their system clock
     forward can bank the cap early. Three things bound the damage and none of
     them is a client-side check (a client check is defeated by the same player
     who moved the clock): the bank cap below limits any single burst to 3
     envoys, `lastAt` is persisted and merges to the LATER stamp across devices
     so the jump cannot be replayed, and wallet_credit (sql/034) refuses more
     than 10,000,000 Cinder an hour and records every refusal. The durable fix
     is the one sql/034's own header names — a server RPC that computes the
     payout from state the server owns — and it is not built here. */
export const ENVOY_INTERVAL_MS = 48 * 3600 * 1000;
/* Absence forgiveness, NOT extra income: banking cannot raise the long-run rate,
   it only lets a player who was away for up to 6 days collect what the clock
   already granted them. It does bound the worst single sitting, which is why it
   stays small — 3 envoys is the largest burst this feature can ever produce. */
export const ENVOY_BANK_CAP = 3;

export function envoysReady(lastAt, now, intervalMs, cap) {
  const iv = Math.max(1, intervalMs || ENVOY_INTERVAL_MS);
  const c = Math.max(1, cap || ENVOY_BANK_CAP);
  now = now || Date.now();
  // No stamp yet = a brand-new camp. Hand them one immediately; making a first-
  // time player wait four hours to find out what the feature is would be a
  // worse introduction than any tuning gain is worth.
  if (!lastAt) return c >= 1 ? 1 : 0;
  return Math.max(0, Math.min(c, Math.floor((now - lastAt) / iv)));
}

/* ⏱ "when does the next one turn up" as a human string. ONE definition, used
   by the modal AND — through window.MythicInfluence.formatEta — by the camp
   status bar in index.html, which cannot import a module and would otherwise
   grow a second copy that drifts. At a 48h clock the old hours-only form read
   "in about 47h", which is precise and nearly unreadable. */
export function formatEta(ms) {
  ms = Math.max(0, Number(ms) || 0);
  if (ms < 60000) return 'any moment';
  /* Floored past the minute mark, deliberately and consistently. Rounding
     crossed the boundaries the wrong way — 23h30m rendered as "1d", which
     overstates the wait and reads as the feature being further away than it
     is. Understating by under an hour is the harmless direction. */
  const mins = Math.ceil(ms / 60000);
  if (mins < 60) return mins + 'm';
  const hours = Math.floor(mins / 60);
  if (hours < 24) return hours + 'h';
  const days = Math.floor(hours / 24);
  const rem = hours % 24;
  return rem ? days + 'd ' + rem + 'h' : days + 'd';
}

export function msToNextEnvoy(lastAt, now, intervalMs) {
  const iv = Math.max(1, intervalMs || ENVOY_INTERVAL_MS);
  now = now || Date.now();
  if (!lastAt) return 0;
  const elapsed = now - lastAt;
  if (elapsed < 0) return iv;
  return Math.max(0, iv - (elapsed % iv));
}

/* The new `lastAt` after spending one envoy. Clamped so a player who banked to
   the cap and then spent one does not keep credit for envoys beyond the cap
   they never actually banked. */
export function consumeStamp(lastAt, now, intervalMs, cap) {
  const iv = Math.max(1, intervalMs || ENVOY_INTERVAL_MS);
  const c = Math.max(1, cap || ENVOY_BANK_CAP);
  now = now || Date.now();
  if (!lastAt) return now;
  const next = lastAt + iv;
  const oldest = now - c * iv;   // anything earlier than this was over the cap
  return Math.max(next, oldest);
}

/* ── XP ─────────────────────────────────────────────────────────────────────
   What a resolved encounter is worth. A REFUSED supply drop still pays a
   little: the envoy came, the player was seen, and paying nothing for the one
   outcome the player cannot control would make a full stash feel like a
   punishment on top of a punishment. */
export const XP_FOR = {
  cinder: 22,
  gift: 35,
  recruitAccept: 60,
  recruitSell: 40,
  supply: 30,
  supplyRefused: 8,
  dismissed: 5,
};
