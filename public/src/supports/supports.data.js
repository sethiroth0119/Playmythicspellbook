/* ════════════════════════════════════════════════════════════════════════════
   💬 SUPPORTS — ranks, pair bookkeeping, and the combat bonus they buy.
   ----------------------------------------------------------------------------
   Fire Emblem's support system, on the bond data this game was already
   collecting and never spending.

   A SUPPORT is a relationship between TWO heroes, earned by fighting together:

       { a, b, points, rank, scenesSeen: [rank…], lastAt }

   Points come from shared battles — more for standing next to each other, more
   again for one saving the other. Ranks unlock a CONVERSATION (generated in
   supports.voice.js) and a standing COMBAT BONUS when the pair fight adjacent.

   🔴 THE PAIR KEY IS ORDER-INDEPENDENT.
   `pairKey('vex','mira')` and `pairKey('mira','vex')` MUST return the same
   string or the roster grows two half-built relationships that each look
   stalled. Sorting the ids is the entire trick and every read and write goes
   through `pairKey` for exactly that reason. This is the single most likely
   bug in this folder.

   ⚠ Ranks are gated on points AND on having watched the previous scene. You
   cannot skip from C to A by grinding — the conversation IS the unlock, which
   is what makes players seek them out rather than ignore them.
   ════════════════════════════════════════════════════════════════════════════ */

export const RANKS = [
  { key: 'none', label: '—',  at: 0,   icon: '',   color: '#6f7686', bonus: null },
  { key: 'C',    label: 'C',  at: 40,  icon: '🤝', color: '#8fb6e0', bonus: { hit: 3,  avoid: 3 } },
  { key: 'B',    label: 'B',  at: 110, icon: '🛡', color: '#8fe0a8', bonus: { hit: 5,  avoid: 5,  dmg: 1 } },
  { key: 'A',    label: 'A',  at: 220, icon: '⚔',  color: '#ffd166', bonus: { hit: 8,  avoid: 8,  dmg: 2, crit: 3 } },
  { key: 'S',    label: 'S',  at: 380, icon: '💗', color: '#ff9ecb', bonus: { hit: 12, avoid: 10, dmg: 3, crit: 5 } },
];

/* Points awarded per shared battle. Deliberately small: a support should take
   several fights, not one, or the conversations arrive before the player has
   any feeling about the pair and land as noise. */
export const POINTS = {
  bothDeployed: 3,      // fought in the same battle at all
  adjacentTurn: 1,      // per turn ended standing next to each other (capped)
  adjacentCap: 6,       // …the cap, per battle
  savedKill: 8,         // one finished an enemy that was about to kill the other
  revived: 14,          // one stabilised the other's bleed-out
  bothSurvived: 2,
};

export function pairKey(a, b) {
  // 🔴 See the header. Sorted, always.
  const x = String(a || ''), y = String(b || '');
  return x < y ? x + '|' + y : y + '|' + x;
}

export function splitKey(key) {
  const i = String(key).indexOf('|');
  return { a: String(key).slice(0, i), b: String(key).slice(i + 1) };
}

export function rankIndexFor(points) {
  let idx = 0;
  for (let i = 0; i < RANKS.length; i++) if (points >= RANKS[i].at) idx = i;
  return idx;
}

/* The rank a pair has EARNED (points), which may be ahead of the rank they have
   UNLOCKED (scenes watched). The gap between the two is the "you have a
   conversation waiting" state, and it is what the camp badge counts. */
export function earnedRank(pair) {
  return RANKS[rankIndexFor((pair && pair.points) | 0)];
}

export function unlockedRank(pair) {
  const seen = (pair && pair.scenesSeen) || [];
  let idx = 0;
  for (let i = 1; i < RANKS.length; i++) if (seen.includes(RANKS[i].key)) idx = i;
  return RANKS[idx];
}

/* Is there a scene ready to watch? Returns the RANK to play, or null.
   Only ever offers the NEXT rank — you watch C before B even if points are
   already past B, so the relationship reads as a story rather than a number. */
export function pendingScene(pair) {
  const earned = rankIndexFor((pair && pair.points) | 0);
  const seen = (pair && pair.scenesSeen) || [];
  for (let i = 1; i < RANKS.length; i++) {
    if (i > earned) break;
    if (!seen.includes(RANKS[i].key)) return RANKS[i];
  }
  return null;
}

export function newPair(a, b) {
  return { a, b, points: 0, scenesSeen: [], lastAt: 0, battles: 0 };
}

/* The combat bonus two adjacent heroes give each other. Returns a flat object
   the battle adds to its hit/avoid/damage rolls — never a multiplier, because
   multiplicative support bonuses stack into nonsense with the trait system
   already in CAMP_TRAITS. */
export function bonusFor(pair) {
  const r = unlockedRank(pair);
  return (r && r.bonus) ? { ...r.bonus, rank: r.key } : null;
}

/* Award points for a battle. `events` is what the battle observed:
     { adjacentTurns, savedKill, revived, bothSurvived }
   Returns the points added, so the caller can show "+12 with Mira". */
export function awardBattle(pair, events) {
  const e = events || {};
  let p = POINTS.bothDeployed;
  p += Math.min(POINTS.adjacentCap, Math.max(0, (e.adjacentTurns | 0) * POINTS.adjacentTurn));
  if (e.savedKill) p += POINTS.savedKill;
  if (e.revived) p += POINTS.revived;
  if (e.bothSurvived) p += POINTS.bothSurvived;
  pair.points = ((pair.points | 0) + p);
  pair.battles = (pair.battles | 0) + 1;
  pair.lastAt = Date.now();
  return p;
}
