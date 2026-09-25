/* ══════════════════════════════════════════════════════════════════════════
   🧬 LINEAGE — what an heir carries out of its parents.
   ──────────────────────────────────────────────────────────────────────────
   PURE LOGIC. No DOM, no globals, no imports. The host hands in two parent
   snapshots and gets back a seed for the offspring's profile entry; the host
   writes it. (CLAUDE.md's globals trap: `Profile`, `BOND_NEW`, `BOND_TIERS`
   and `UNIT_MEMORY_KINDS` are top-level `const` in index.html and invisible
   to an ES module.)

   🔴 WHAT THIS FIXES
   `breedParents()` already does a genuinely good job of inheritance — stats
   lean between the parents, elements come one from each, the movepool is
   everything they knew, passives and values carry over. And then it throws
   away the entire relationship. Bond, temperament, memories: none of it
   crosses. The child of two Sworn veterans hatches as a stranger at Neutral
   with a temperament hashed off its brand-new random id.

   That is the exact thing Monster Rancher's Combining is FOR. A monster's
   death is bearable because the next one has its blood in it; the lineage is
   the emotional payoff that makes the loss mean something instead of just
   costing something. The stats already crossed. The reason to care did not.

   ⚖ WHAT AN HEIR MUST STILL EARN
   Inheritance here is a HEAD START, never a finished relationship:
     · bond is capped at Trusted no matter how devoted the parents were, so
       Devoted and Sworn remain things you reach WITH a specific companion;
     · exactly ONE memory crosses, rewritten as a story the heir was told
       rather than something it did — an heir that inherited a parent's whole
       history would be able to claim battles it was not at;
     · nothing about power crosses that breedParents did not already carry.
   Without those caps, breeding two veterans would be strictly better than
   raising a companion, and the entire camp loop this feature exists to
   deepen becomes a thing you skip.
   ══════════════════════════════════════════════════════════════════════════ */

/* Bond the heir opens at, by the better parent's tier index.
   BOND_NEW (100, Neutral) is the floor and the default — a bred unit from two
   strangers is exactly as much a stranger as any other new card. */
export const HEIR_BOND = {
  bothDevoted: 350,   // Trusted — the ceiling on inheritance, see the header
  oneDevoted:  150,   // Steady
};
export const HEIR_BOND_CAP = 350;
export const DEVOTED_TIER_IDX = 4;

/* Which parent memory is worth passing on, best first, and what the heir's
   version of it says. The heir's line is always "carries a story" — it did
   not do the thing, it grew up hearing about it. Getting that wrong would let
   a day-old card display "Fifty battles together." */
export const HEIR_MEMORIES = [
  { from: 'battles100', k: 'heirLegend',  icon: '🎖', text: 'Carries a story: a hundred battles at your side, before it was born.' },
  { from: 'laststand',  k: 'heirStand',   icon: '🛡', text: 'Carries a story: its blood refused to fall at one hit point.' },
  { from: 'survivedAll',k: 'heirSurvive', icon: '🌟', text: 'Carries a story: its blood came through what others did not.' },
  { from: 'battles50',  k: 'heirVeteran', icon: '⚔', text: 'Carries a story: fifty battles fought before it drew breath.' },
  { from: 'firstKill',  k: 'heirBlood',   icon: '🩸', text: 'Carries a story: its blood took a life in your service.' },
  { from: 'kills25',    k: 'heirBlood',   icon: '🩸', text: 'Carries a story: its blood took a life in your service.' },
  { from: 'battles25',  k: 'heirVeteran', icon: '⚔', text: 'Carries a story: fifty battles fought before it drew breath.' },
  { from: 'tierUp',     k: 'heirTrust',   icon: '💗', text: 'Carries a story: its blood learned to trust you.' },
  { from: 'battles10',  k: 'heirVeteran', icon: '⚔', text: 'Carries a story: fifty battles fought before it drew breath.' },
  { from: 'first',      k: 'heirFirst',   icon: '🤝', text: 'Carries a story: its blood stood with you from the first day.' },
];

/* The memory kinds this file introduces, in the shape UNIT_MEMORY_KINDS uses,
   so the host can merge them into that table and every existing renderer
   (the Table, the card-detail modal) picks them up with no changes. */
export function memoryKinds() {
  const out = {};
  for (const m of HEIR_MEMORIES) out[m.k] = { icon: m.icon, text: m.text };
  return out;
}

const num = v => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

/** The parent an heir takes after: the one that trusted you more.
 *  Ties go to A, deterministically, rather than to a coin flip — a breeding
 *  preview that showed a different temperament each time it repainted would
 *  read as a bug. */
export function dominant(pa, pb) {
  const a = num(pa && pa.bond), b = num(pb && pb.bond);
  return (b > a) ? pb : pa;
}

/**
 * Seed for the heir's profile entry + card.
 * @param {object} pa parent A snapshot { name, temper, bond, tierIdx, memories }
 * @param {object} pb parent B snapshot
 * @param {number} bondNew the game's BOND_NEW floor
 * @returns {{temper, bond, memories, from, note}}
 */
export function inherit(pa, pb, bondNew) {
  const floor = num(bondNew) || 100;
  const A = pa || {}, B = pb || {};
  const dom = dominant(A, B);

  // ── bond ───────────────────────────────────────────────────────────────
  const ta = num(A.tierIdx), tb = num(B.tierIdx);
  let bond = floor;
  if (ta >= DEVOTED_TIER_IDX && tb >= DEVOTED_TIER_IDX) bond = HEIR_BOND.bothDevoted;
  else if (ta >= DEVOTED_TIER_IDX || tb >= DEVOTED_TIER_IDX) bond = HEIR_BOND.oneDevoted;
  // Never BELOW the floor (a bred unit is not penalised for humble parents)
  // and never above the inheritance cap, whatever a future tier table says.
  bond = Math.max(floor, Math.min(HEIR_BOND_CAP, bond));

  // ── temperament ────────────────────────────────────────────────────────
  // Inherited from the dominant parent, and only if that parent HAS one
  // resolved. Absent, we return null and the host's own derivation runs —
  // which is the pre-lineage behaviour, not a broken card.
  const temper = (dom && dom.temper) ? String(dom.temper) : null;

  // ── the one memory ─────────────────────────────────────────────────────
  // Searched across BOTH parents so an heir of a quiet veteran and a storied
  // one still gets the story; ranked by HEIR_MEMORIES order, not by which
  // parent it came from.
  const have = new Set();
  for (const p of [A, B]) {
    for (const m of (Array.isArray(p.memories) ? p.memories : [])) if (m && m.k) have.add(m.k);
  }
  let memories = [], from = null;
  for (const h of HEIR_MEMORIES) {
    if (!have.has(h.from)) continue;
    // Attribute it to whichever parent actually holds it, not to the dominant
    // one — crediting the wrong forebear in a lineage feature is the one lie
    // this file must not tell.
    const owner = [A, B].find(p => (Array.isArray(p.memories) ? p.memories : []).some(m => m && m.k === h.from));
    memories = [{ k: h.k, d: (owner && owner.name) || undefined }];
    from = h.from;
    break;
  }

  return {
    temper, bond, memories, from,
    note: describe({ temper, bond, memories, from }, A, B, floor),
  };
}

/** One sentence for the hatch toast. Silent when nothing was inherited, so a
 *  breeding of two strangers does not announce an empty legacy. */
export function describe(seed, A, B, bondNew) {
  const bits = [];
  if (seed.bond > (num(bondNew) || 100)) bits.push('opens at ' + seed.bond + ' loyalty');
  if (seed.temper) {
    const d = dominant(A, B);
    bits.push('takes after ' + ((d && d.name) || 'its forebear'));
  }
  if (seed.memories && seed.memories.length) bits.push('and carries a story');
  return bits.length ? bits.join(', ') : '';
}
