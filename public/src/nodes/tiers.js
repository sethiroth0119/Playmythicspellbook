/* 🔌 PRN NODE TIERS — the generation rate a node pays, by tier.
   ═══════════════════════════════════════════════════════════════════════════
   ONE TABLE, TWO CONSUMERS:
     • Cinder    — the tier IS the per-collect slice of the global reward pool.
                   This replaces the flat NODE_POOL_MAX_SLICE = 5% that every
                   node shared, so the pool now distributes by standing rather
                   than first-come-first-served.
     • Resources — the tier is a BONUS on what a player's city operations
                   generate, applied at settle time (the moment yields land and
                   NPC wages are paid). It is added ON TOP of normal output; it
                   never taxes a player's existing yield.

   🔴 THE GLOBALS TRAP (CLAUDE.md). This module is an ES module and therefore
   CANNOT see `Profile`, `Corp`, `FoundationReserve` or any of index.html's
   top-level `const` bindings — they are lexical globals, not `window`
   properties. Everything it needs arrives through window.MythicNodeTierBridge,
   handed over explicitly by index.html. Nothing here reaches for a bare global.

   🔴 AND IT MUST DEGRADE TO NOTHING. index.html reads this module defensively,
   exactly as _opComputed reads window.MythicTerroir: if the module never loads,
   every caller falls back to the old flat behaviour. An absent module must
   never change a payout. That is why every export is pure and total — no
   throws, no async, no I/O.
   ═══════════════════════════════════════════════════════════════════════════ */

/* The rates, exactly as specified. `rate` is a PERCENT, not a fraction — it is
   what the UI prints, so storing it as 0.005 would mean every display site had
   to remember to multiply by 100. The fraction conversions live in the two
   share() helpers below and nowhere else. */
export const NODE_TIERS = [
  { id: 'free',       name: 'Free',                   rate: 0.5, accent: '#8fa0b8', owned: false },
  { id: 'starter',    name: 'Starter',                rate: 1,   accent: '#ffb344', owned: true  },
  { id: 'outpost',    name: 'Outpost Operator',       rate: 3,   accent: '#ff8855', owned: true  },
  { id: 'foundation', name: 'Foundation Contributor', rate: 5,   accent: '#b888ff', owned: true  },
  { id: 'dominion',   name: 'Dominion Founder',       rate: 8,   accent: '#ff88cc', owned: true  },
  { id: 'titan',      name: 'Titan Node Founder',     rate: 10,  accent: '#44d4ff', owned: true  },
  { id: 'eternal',    name: 'Eternal Founder',        rate: 20,  accent: '#ffd700', owned: true  },
];

/* 🆓 THE DEFAULT, AND IT IS LOAD-BEARING. "If a player does not have a node in
   the city node that would mean they have a free node" — so absence resolves to
   a real tier with a real rate, never to zero and never to null. Every helper
   below funnels through resolve(), so there is exactly one place that decides
   what "no node" means. */
export const FREE_TIER_ID = 'free';

/* ➕ The +1 the spec asks for on the RESOURCE side only ("then add 1 on top of
   that"). Cinder is the raw pool share; resources are rate + 1 percentage
   point, so a Free node generates 1.5% and an Eternal Founder 21%.
   Named rather than inlined because it is the one number most likely to be
   retuned, and it must move in exactly one place when it is. */
export const RESOURCE_BONUS_PCT = 1;

/* 🛒 Purchased package → node tier. Keys are PLEDGE_TIERS ids (index.html's
   founder store, which is also what pledge_purchases.tier_id records).
   ⚠ 'scavenger' and 'vault-key' are deliberately absent: they sit BELOW the
     Starter PRN License in the store and confer no node standing, so they fall
     through to Free rather than silently granting 1%. */
const PLEDGE_TO_TIER = {
  'node-starter': 'starter',
  'outpost':      'outpost',
  'foundation':   'foundation',
  'dominion':     'dominion',
  'titan':        'titan',
  'eternal':      'eternal',
};

const _byId = {};
for (const t of NODE_TIERS) _byId[t.id] = t;

export function tierById(id) {
  return _byId[String(id || '')] || null;
}
export function freeTier() { return _byId[FREE_TIER_ID]; }

/* Rank in the table, used only to pick the BEST of several signals — a player
   who bought Dominion and also holds an admin override of Titan gets Titan,
   and a player with two nodes is read from the one being asked about. */
function _rank(id) {
  const i = NODE_TIERS.findIndex((t) => t.id === id);
  return i < 0 ? -1 : i;
}

/* 🎯 THE ONE RESOLVER. Order, highest priority first:
     1. an explicit admin override stamped on the node (meta.tier)
     2. the tier the owner actually PAID for (pledge_purchases)
     3. Free
   `node` may be null — that is the "no node in the city" case and it is not an
   error, it is how most players start. */
export function resolveTier(node, ctx) {
  ctx = ctx || {};
  /* Two node shapes reach this, deliberately:
       • a Territory Wars CITY NODE  → `node.tier`      (Forge.territoryWars.nodes)
       • an economy_nodes row        → `node.meta.tier` (JSONB)
     The City Nodes admin panel edits the first — that is where an operator
     actually assigns a tier — while the second is what the PRN payout code
     already had in hand. Accepting both means one resolver serves both call
     sites instead of two that can disagree about a player's rate. */
  const override = (node && node.tier) || (node && node.meta && node.meta.tier);
  const ov = tierById(override);
  const paid = tierById(PLEDGE_TO_TIER[String(ctx.pledgeTierId || '')]);
  // Override wins outright when set — it is a deliberate admin act, and an
  // admin must be able to move a node DOWN as well as up (a refund, a
  // chargeback, a correction). Taking the max here would make demotion
  // impossible and would be the harder bug to find later.
  if (ov) return ov;
  if (paid) return paid;
  return freeTier();
}

/* 🔥 Cinder: the fraction of the REMAINING global reward pool one collect may
   take. Replaces the flat 5%. */
export function cinderPoolShare(node, ctx) {
  return Math.max(0, resolveTier(node, ctx).rate) / 100;
}

/* 📦 Resources: the fraction ADDED ON TOP of what an operation generated.
   Never negative, never a deduction — a tier is a perk, and a bug here that
   flipped the sign would quietly delete player output. */
export function resourceShare(node, ctx) {
  return Math.max(0, resolveTier(node, ctx).rate + RESOURCE_BONUS_PCT) / 100;
}

/* Apply the resource share to a {resourceId: qty} map and return the BONUS map
   (not the total). Callers add this to their payout, so returning the bonus
   alone keeps "what did the tier give me?" answerable in the UI and in a log
   line, which a merged total would not.
   Rounds DOWN and drops zeroes, so a tiny yield never fabricates a unit. */
export function resourceBonus(yields, node, ctx) {
  const out = {};
  if (!yields || typeof yields !== 'object') return out;
  const share = resourceShare(node, ctx);
  if (!(share > 0)) return out;
  for (const rid of Object.keys(yields)) {
    const q = Math.floor((Number(yields[rid]) || 0) * share);
    if (q > 0) out[rid] = q;
  }
  return out;
}

/* Label helpers so index.html and the city modal print the same string. */
export function tierLabel(node, ctx) {
  const t = resolveTier(node, ctx);
  return t.name + ' · ' + t.rate + '%';
}

/* 📡 PUBLISHED FOR THE LEGACY APP. index.html cannot `import` — it is a classic
   script — so the module hands itself over on `window`, mirroring
   window.MythicTerroir. Every index.html call site is `typeof`-guarded and
   falls back to the pre-tier behaviour, so a failed load costs the FEATURE and
   never a payout. */
try {
  if (typeof window !== 'undefined') {
    window.MythicNodeTiers = {
      TIERS: NODE_TIERS,
      FREE_TIER_ID,
      RESOURCE_BONUS_PCT,
      tierById,
      freeTier,
      resolveTier,
      cinderPoolShare,
      resourceShare,
      resourceBonus,
      tierLabel,
    };
  }
} catch (e) {}
