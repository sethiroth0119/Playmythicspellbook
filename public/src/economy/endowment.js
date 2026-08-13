/* ════════════════════════════════════════════════════════════════════════════
   ⛏ ENDOWMENT — what is actually in the ground under THIS node.
   ----------------------------------------------------------------------------
   "Every Node will be missing important natural resources. If your Node doesn't
    contain Iron: You cannot simply build an Iron Mine."

   THIS FILE IS THE ENFORCEMENT POINT FOR THAT SENTENCE, and it is the only one.
   `canExtract(nodeId, resId)` is the single gate; the build menu, the firm
   founder and the bottleneck tracer all ask it. If a second place ever decides
   whether a mine may exist, the two will disagree and a player will be able to
   build a mine that produces nothing, which is the worst of both.

   ── 🔴 HOW THIS RELATES TO TERROIR, AND WHY IT IS NOT A SECOND TRUTH ────────
   /src/city/terroir.js already answers a similar-sounding question and the two
   MUST NOT contradict each other. They are deliberately different questions:

     TERROIR    — for the 14 LEDGER resources. A soft multiplier on yield with a
                  ceiling you cannot out-build. BARREN is 0.15×, never 0, and
                  terroir explicitly "never stops" a solo player (see §SOLO).
     ENDOWMENT  — for the ~51 tier-0 DEPOSITS in the resource chain. A HARD
                  gate: grade NONE means the extractor cannot be built at all.

   The hard gate is only acceptable because of the trade layer: a resource you
   cannot dig, you can BUY. terroir.js's §SOLO promise ("nobody is ever locked
   out") is preserved at the economy level rather than the tile level — the city
   can always obtain iron, it just cannot always mine it. That is the whole
   design of this update, and it is why `canExtract` returning false must NEVER
   be allowed to gate a *purchase* path. Grep before you add a caller.

   Where the two overlap (an id that is both a ledger resource and a deposit —
   `wood`, `stone`, `seeds`, `rareMinerals`), TERROIR WINS the yield number and
   endowment only decides presence, biased BY terroir so the two never tell the
   player opposite stories about the same ground. See `gradeFor()`.

   ── DETERMINISM ────────────────────────────────────────────────────────────
   The endowment is a pure function of the node id. No storage, no migration,
   no dice roll at claim time. Two players looking at the same node see the same
   ground, forever, and a save that predates this file gets the same answer as
   one written after it. This is the same reasoning NODE_EMPIRE_HANDOFF.md gives
   for deriving the capital from `capturedAt` instead of storing a flag.
   ════════════════════════════════════════════════════════════════════════════ */

import { DEPOSITS, industryOf } from './recipes.js';

/* ── GRADES ─────────────────────────────────────────────────────────────────
   `mul` multiplies the deposit's base yield. NONE is a hard 0 and is the only
   grade that blocks construction — every other grade is buildable, because a
   POOR seam that is slow is a decision and a POOR seam you cannot build is
   just a smaller version of NONE. */
export const GRADES = {
  EXCEPTIONAL: { key: 'EXCEPTIONAL', label: 'Exceptional', mul: 2.20, ico: '★★', color: '#ffd166', rank: 5 },
  RICH:        { key: 'RICH',        label: 'Rich',        mul: 1.60, ico: '★',  color: '#9ad17a', rank: 4 },
  ABUNDANT:    { key: 'ABUNDANT',    label: 'Abundant',    mul: 1.25, ico: '▲',  color: '#8fd0a0', rank: 3 },
  COMMON:      { key: 'COMMON',      label: 'Common',      mul: 1.00, ico: '·',  color: '#cfd6e4', rank: 2 },
  POOR:        { key: 'POOR',        label: 'Poor',        mul: 0.55, ico: '▽',  color: '#e0a060', rank: 1 },
  NONE:        { key: 'NONE',        label: 'None',        mul: 0,    ico: '✖',  color: '#e0556a', rank: 0 },
};

/* 📊 THE SHAPE OF EVERY NODE'S GROUND, as fractions of the deposit list.
   Same reasoning as terroir's `slots`, and the same warning applies: these are
   FRACTIONS so they survive the deposit list growing, but the two ABSOLUTES
   below do not scale and must not be made to.

   🔴 `minNone` IS AN ABSOLUTE AND IT IS THE FEATURE.
   "Every Node will be missing important natural resources" is a promise about a
   COUNT, not a ratio. If it scaled with the list, adding resources would make
   every city lonelier — a tax on adding content, which is the exact mistake
   terroir.js documents itself as having avoided. Twelve missing deposits, of
   which at least three are STRATEGIC (below), is the amount of dependency this
   was tuned against. */
const SHAPE = { EXCEPTIONAL: 0.04, RICH: 0.10, ABUNDANT: 0.16, COMMON: 0.30, POOR: 0.16 };
const MIN_NONE = 12;
const MIN_STRATEGIC_NONE = 3;

/* 🎯 STRATEGIC DEPOSITS — the ones whose absence actually forces trade.
   A node missing `herbs` is an inconvenience. A node missing `ironOre` cannot
   build a steel industry at all and has to find someone who can. At least
   MIN_STRATEGIC_NONE of these are guaranteed absent on every node, which is
   what makes the trade layer load-bearing instead of optional.

   ⚠ `rawWater` IS DELIBERATELY NOT IN THIS LIST AND MUST NEVER BE.
     Water is an input to a third of the graph — freshWater, industrialWater,
     every chemical, every food step. A node with no water is not "specialised",
     it is unplayable, and the player did not choose the node. Same reasoning
     keeps the food staples out: `guaranteed` below pins them. */
const STRATEGIC = [
  'ironOre', 'coal', 'crudeOil', 'naturalGas', 'copperOre', 'aluminumOre',
  'limestone', 'silica', 'timber', 'lithium', 'rareEarthMinerals', 'titanium',
  'cobalt', 'tungsten', 'nickelOre',
];

/* 🛟 GUARANTEED PRESENT — the floor under every node.
   Without this a player can roll a node with no water and no food and be dead
   before they can trade for either. Everything here is pinned to at least POOR:
   survivable alone, never comfortable, and never a reason to quit. */
const GUARANTEED = ['rawWater', 'stone', 'sand', 'clay', 'gravel'];
/* At least ONE food staple is guaranteed, but WHICH one varies by node — that
   is the difference between "every city farms wheat" and a real agricultural
   map where Greenhaven grows rice and its neighbour grows potatoes. */
const FOOD_STAPLES = ['wheat', 'corn', 'rice', 'potatoes', 'vegetables'];

/* 🌌 THE MYTHIC SEAM IS RARE BY CONSTRUCTION.
   Anomalous deposits are gated behind a separate, much harsher roll: most nodes
   have NONE of them, and a node with even one is genuinely notable. Rolling
   them through the normal SHAPE would put an Anomaly Site on ~70% of nodes and
   make the late game the default rather than an achievement. */
const MYTHIC = ['mythicEssence', 'mythicResidue', 'anomalousMatter', 'anomalousEnergy',
                'realityMatter', 'soulEnergy', 'dimensionalMaterial', 'arcaneCrystal', 'realityFragments'];
const MYTHIC_PRESENT_CHANCE = 0.16;   // per anomalous deposit, per node

/* ── 🎲 A STABLE HASH ───────────────────────────────────────────────────────
   FNV-1a over `nodeId + ':' + salt`. Not cryptographic and does not need to be:
   it needs to be STABLE across sessions, machines and JS engines, which
   `Math.random()` is not and which anything involving object key order is not
   either. Returns a float in [0,1). */
function hash01(nodeId, salt) {
  const s = String(nodeId == null ? '' : nodeId) + ':' + salt;
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    // >>> 0 after each step: without it this overflows into the float range and
    // stops being the 32-bit FNV everyone else's implementation agrees with.
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return (h >>> 0) / 4294967296;
}

/* 🗺 TERROIR BIAS. If /src/city/terroir.js has an opinion about this id, use it
   to shift the roll so the two systems agree about the same ground. RICH
   terroir pushes the endowment up, BARREN pushes it down. Absent module → no
   bias, which is the neutral, no-regression state terroir itself documents. */
function terroirBias(resId) {
  try {
    const T = (typeof window !== 'undefined') ? window.MythicTerroir : null;
    if (!T || typeof T.tierOf !== 'function') return 0;
    const tier = T.tierOf(resId);
    if (tier === 'RICH')   return  0.22;
    if (tier === 'SCARCE') return -0.16;
    if (tier === 'BARREN') return -0.30;
    return 0;
  } catch (e) { return 0; }
}

/* Roll → grade, using SHAPE as a cumulative band. */
function bandOf(roll) {
  let acc = 0;
  for (const k of ['EXCEPTIONAL', 'RICH', 'ABUNDANT', 'COMMON', 'POOR']) {
    acc += SHAPE[k];
    if (roll < acc) return k;
  }
  return 'NONE';
}

/* ════════════════════════════════════════════════════════════════════════════
   THE ENDOWMENT ITSELF
   ════════════════════════════════════════════════════════════════════════════ */

const DEPOSIT_IDS = Object.keys(DEPOSITS);
let _cache = { key: null, val: null };

/* Build the full grade map for a node. Pure, deterministic, cached on nodeId.
   The cache is a single slot because the city only ever looks at one node at a
   time; the trade layer asks about others through `profileFor` directly, which
   is uncached and cheap enough at ~51 hashes. */
export function profileFor(nodeId) {
  const grades = {};

  // 1. The base roll, biased by terroir where terroir has an opinion.
  for (const id of DEPOSIT_IDS) {
    if (MYTHIC.indexOf(id) >= 0) {
      // Anomalous seams roll on their own, much harsher, track.
      const present = hash01(nodeId, 'mythic:' + id) < MYTHIC_PRESENT_CHANCE;
      if (!present) { grades[id] = 'NONE'; continue; }
      const r = hash01(nodeId, 'mythicgrade:' + id);
      grades[id] = r < 0.15 ? 'RICH' : r < 0.45 ? 'ABUNDANT' : r < 0.80 ? 'COMMON' : 'POOR';
      continue;
    }
    const roll = Math.min(0.9999, Math.max(0, hash01(nodeId, 'dep:' + id) - terroirBias(id)));
    grades[id] = bandOf(roll);
  }

  // 2. The floor. Anything guaranteed present that rolled NONE is lifted to
  //    POOR — never higher, so a pinned resource is never a gift.
  for (const id of GUARANTEED) if (grades[id] === 'NONE') grades[id] = 'POOR';

  // 3. Exactly one food staple is guaranteed, chosen by the node's own hash.
  //    Checked FIRST for an existing one so a node that already grows three
  //    crops is not handed a fourth.
  if (!FOOD_STAPLES.some(id => grades[id] && grades[id] !== 'NONE')) {
    const pick = FOOD_STAPLES[Math.floor(hash01(nodeId, 'staple') * FOOD_STAPLES.length) % FOOD_STAPLES.length];
    grades[pick] = hash01(nodeId, 'staplegrade') < 0.3 ? 'ABUNDANT' : 'COMMON';
  }

  // 4. 🔴 THE SCARCITY GUARANTEE. Steps 2–3 can only ever ADD, so the promise
  //    "every node is missing something important" has to be re-imposed after
  //    them or a lucky roll plus the floors could hand someone everything.
  //    Deposits are demoted to NONE in ascending hash order — deterministic,
  //    and it never touches GUARANTEED or the pinned staple.
  const protectedIds = new Set(GUARANTEED.concat(
    FOOD_STAPLES.filter(id => grades[id] && grades[id] !== 'NONE').slice(0, 1)));

  const noneCount = () => DEPOSIT_IDS.filter(id => grades[id] === 'NONE').length;
  const strategicNoneCount = () => STRATEGIC.filter(id => grades[id] === 'NONE').length;

  if (strategicNoneCount() < MIN_STRATEGIC_NONE) {
    const cands = STRATEGIC
      .filter(id => grades[id] !== 'NONE' && !protectedIds.has(id))
      .sort((a, b) => hash01(nodeId, 'demote:' + a) - hash01(nodeId, 'demote:' + b));
    for (const id of cands) {
      if (strategicNoneCount() >= MIN_STRATEGIC_NONE) break;
      grades[id] = 'NONE';
    }
  }
  if (noneCount() < MIN_NONE) {
    const cands = DEPOSIT_IDS
      .filter(id => grades[id] !== 'NONE' && !protectedIds.has(id) && MYTHIC.indexOf(id) < 0)
      .sort((a, b) => hash01(nodeId, 'demote2:' + a) - hash01(nodeId, 'demote2:' + b));
    for (const id of cands) {
      if (noneCount() >= MIN_NONE) break;
      grades[id] = 'NONE';
    }
  }

  return { nodeId: nodeId == null ? null : String(nodeId), grades };
}

export function endowment(nodeId) {
  const key = String(nodeId == null ? '' : nodeId);
  if (_cache.key === key && _cache.val) return _cache.val;
  const v = profileFor(nodeId);
  _cache = { key, val: v };
  return v;
}

export function invalidate() { _cache = { key: null, val: null }; }

/* ── THE GATE ───────────────────────────────────────────────────────────────
   The one function that decides whether an extractor may exist.
   ⚠ Non-deposits return TRUE. This function answers "is the ground willing",
     not "can this be made" — a Steel Mill is not gated by the ground, it is
     gated by having iron, which is a supply question and belongs to the
     bottleneck tracer. A caller that uses this to gate a factory has misread it. */
export function canExtract(nodeId, resId) {
  if (!Object.prototype.hasOwnProperty.call(DEPOSITS, resId)) return true;
  return gradeOf(nodeId, resId) !== 'NONE';
}

export function gradeOf(nodeId, resId) {
  const e = endowment(nodeId);
  return e.grades[resId] || (Object.prototype.hasOwnProperty.call(DEPOSITS, resId) ? 'NONE' : 'COMMON');
}

export function gradeDef(key) { return GRADES[key] || GRADES.COMMON; }

/* The yield multiplier for an extractor working this deposit on this node. */
export function yieldMul(nodeId, resId) {
  const g = GRADES[gradeOf(nodeId, resId)];
  return g ? g.mul : 0;
}

/* Base extraction rate: units per labour-day, grade applied. */
export function extractRate(nodeId, resId) {
  const d = DEPOSITS[resId];
  if (!d) return 0;
  return (d.yield || 0) * yieldMul(nodeId, resId);
}

/* ── READOUTS FOR THE UI AND FOR TRADE ──────────────────────────────────────
   `have` / `lack` are what the survey panel prints and what trade.js matches
   cities on: a city's exports come from `have`, its imports from `lack`. */
export function have(nodeId) {
  const e = endowment(nodeId);
  return DEPOSIT_IDS.filter(id => e.grades[id] !== 'NONE')
    .sort((a, b) => GRADES[e.grades[b]].rank - GRADES[e.grades[a]].rank);
}
export function lack(nodeId) {
  const e = endowment(nodeId);
  return DEPOSIT_IDS.filter(id => e.grades[id] === 'NONE');
}
/* The absences that actually hurt — what this city must import or die. */
export function strategicGaps(nodeId) {
  const e = endowment(nodeId);
  return STRATEGIC.filter(id => e.grades[id] === 'NONE');
}
/* The seams worth building an identity around — what this city should export. */
export function strengths(nodeId) {
  const e = endowment(nodeId);
  return DEPOSIT_IDS
    .filter(id => GRADES[e.grades[id]].rank >= GRADES.RICH.rank)
    .sort((a, b) => GRADES[e.grades[b]].rank - GRADES[e.grades[a]].rank);
}

/* Group the survey by the extractor that would work it — the form the build
   menu wants ("you can put a Mine here, and it would work these five seams"). */
export function byIndustry(nodeId) {
  const e = endowment(nodeId), out = {};
  for (const id of DEPOSIT_IDS) {
    const ind = industryOf(id) || 'other';
    (out[ind] = out[ind] || []).push({ id, grade: e.grades[id], def: GRADES[e.grades[id]] });
  }
  for (const k in out) out[k].sort((a, b) => b.def.rank - a.def.rank);
  return out;
}

/* 🔍 SELF-CHECK — proves the guarantees hold for any node id, so a tuning
   change to SHAPE can never silently break "every node is missing something".
   Returns the violations rather than throwing; index.js logs them. */
export function verify(sampleIds) {
  const ids = sampleIds && sampleIds.length ? sampleIds
    : Array.from({ length: 200 }, (_, i) => 'verify-node-' + i);
  const bad = [];
  for (const id of ids) {
    const e = profileFor(id);
    const none = DEPOSIT_IDS.filter(x => e.grades[x] === 'NONE');
    const stratNone = STRATEGIC.filter(x => e.grades[x] === 'NONE');
    if (none.length < MIN_NONE) bad.push(id + ': only ' + none.length + ' absent (need ' + MIN_NONE + ')');
    if (stratNone.length < MIN_STRATEGIC_NONE) bad.push(id + ': only ' + stratNone.length + ' strategic gaps');
    for (const g of GUARANTEED) if (e.grades[g] === 'NONE') bad.push(id + ': guaranteed ' + g + ' is NONE');
    if (!FOOD_STAPLES.some(x => e.grades[x] !== 'NONE')) bad.push(id + ': no food staple');
  }
  return { ok: !bad.length, violations: bad, sampled: ids.length };
}

export default { GRADES, endowment, canExtract, gradeOf, yieldMul, extractRate, have, lack, strategicGaps, strengths, verify };
