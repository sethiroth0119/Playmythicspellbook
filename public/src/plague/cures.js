
/* ══════════════════════════════════════════════════════════════════════════
   🧪 CURES — reagent chemistry over the game's REAL resource ledger.
   ──────────────────────────────────────────────────────────────────────────
   🔴 EVERY REAGENT HERE IS AN ID FROM index.html's `RESOURCES` (142 entries).
   Not SALVAGE_RES, not the 258-entry /src/resources/chain.js catalogue. The
   NOTES the chain file quotes are exactly why: an id a player can hold but
   cannot spend or make is "worse than missing, because their pile of it is
   real and inert". A cure recipe that asked for `antiviralSerum` would send
   the player looking for a resource no producer in this game makes. So the
   whole of medicine is built out of things the city, the ops and the loot
   tables already hand out. If you want a new reagent, PROMOTE it first
   (RESOURCES_NEXT.md lists the five sites) — do not add an id here.

   ⚠ THAT SENTENCE ONCE READ "14 entries" AND IT COST THE FEATURE ITS RANGE.
     RESOURCES has grown to 142 and this table was still built against the
     original fourteen, so medicine was being made out of wood, stone and cloth
     while the player's warehouse held acids, solvents, silica, herbs and
     medical chemicals. Reported as: "it is simply impossible to create
     something that will work against the existing viruses… some markers are so
     far apart it's impossible to get remotely close… we have many resources
     that fit in this system, add them." They were right, and the reason is
     geometric — see the note on the second block of reagents below.

   ── HOW A CURE WORKS ──────────────────────────────────────────────────────
   Each reagent carries a profile over strains.js's four axes. Mixing units
   produces a weighted BLEND vector; the blend is compared to the strain's
   signature and the distance is the efficacy. That is the whole model.

     efficacy  ← how close the blend sits to the strain's signature
     potency   ← how much of it there is, times how well the lab work went
     purity    ← centrifuge + filtration, minus anything the hot zone got on it
     stability ← whether the thing holds together once it leaves the bench

   🔴 STABILITY IS THE FAILURE AXIS AND IT IS SEPARATE FROM EFFICACY ON
   PURPOSE. A batch can be BOTH the right shape and unstable, and that is the
   genuinely interesting mistake: it works, it cures people, and it also
   sheds a mutant. If instability merely made a cure not work, no player would
   ever fear it — they would just try again. Fear is the design.

   ⚠ NOTHING IN THIS FILE SPENDS ANYTHING. It is pure math over a mix that a
   caller has already validated and paid for. state.js owns the ledger writes,
   which is what lets the 3D lab preview a formulation live, on every slider
   drag, without charging the player forty times.
   ══════════════════════════════════════════════════════════════════════════ */

import { AXES, sigDistance, mutate, rngFrom, hash32 } from './strains.js';

export const V = 1;

/* ── the reagent table ─────────────────────────────────────────────────────
   `axis`  where this reagent pushes the blend (0..100 per axis)
   `weight` how loudly it argues in the blend. Water is deliberately quiet.
   `stab`  stability delta per unit share — the safety/danger dial
   `pure`  purity delta per unit share
   `pot`   potency multiplier contribution

   🔴 THE TWO TRAPS ARE INTENTIONAL AND THEY ARE THE CONTENT OF THIS FEATURE:
     · corruptedEssence is the strongest reagent in the game AND the only one
       with a large negative stability. It is how you beat a Catastrophic
       strain and it is how you breed the next one. Players WILL reach for it
       under pressure. That is the trap working.
     · memoryShards look harmless and are mildly destabilising, so a neural
       cure quietly needs more buffering than it looks like it does.
   Retuning either of these retunes the whole difficulty of the feature. */
export const REAGENTS = {
  medicine: {
    id: 'medicine', name: 'Medicine', icon: '💊',
    axis: { vector: 50, envelope: 55, replication: 50, resilience: 45 },
    weight: 1.00, stab: +10, pure: +6, pot: 1.00,
    blurb: 'Broad-spectrum base. Aims at the middle of everything, excels at nothing.',
  },
  dna: {
    id: 'dna', name: 'DNA', icon: '🧬',
    axis: { vector: 35, envelope: 40, replication: 92, resilience: 40 },
    weight: 1.25, stab: -4, pure: +2, pot: 1.20,
    blurb: 'Replication targeting. The only reagent that reaches a fast copier.',
  },
  memoryShards: {
    id: 'memoryShards', name: 'Memory Shards', icon: '🧠',
    axis: { vector: 20, envelope: 60, replication: 30, resilience: 88 },
    weight: 1.20, stab: -8, pure: 0, pot: 1.15,
    blurb: 'Neural affinity, and it lasts. Quietly destabilising — buffer it.',
  },
  corruptedEssence: {
    id: 'corruptedEssence', name: 'Corrupted Essence', icon: '🟣',
    axis: { vector: 85, envelope: 90, replication: 85, resilience: 90 },
    weight: 1.80, stab: -34, pure: -14, pot: 1.75,
    blurb: '⚠ Reaches anything. Holds together almost nothing. This is how mutants are born.',
  },
  water: {
    id: 'water', name: 'Water', icon: '💧',
    axis: { vector: 45, envelope: 20, replication: 40, resilience: 20 },
    weight: 0.45, stab: +16, pure: +10, pot: 0.55,
    blurb: 'Solvent and buffer. Dilutes potency, and is the cheapest way to survive an essence mix.',
  },
  cloth: {
    id: 'cloth', name: 'Cloth', icon: '🧵',
    axis: { vector: 55, envelope: 25, replication: 25, resilience: 35 },
    weight: 0.55, stab: +6, pure: +18, pot: 0.70,
    blurb: 'Filtration substrate. Purity you can buy with almost nothing.',
  },
  metal: {
    id: 'metal', name: 'Metal', icon: '⛓️',
    axis: { vector: 30, envelope: 75, replication: 30, resilience: 78 },
    weight: 1.00, stab: +4, pure: -4, pot: 1.05,
    blurb: 'Chelation. Cracks a heavy envelope and drags surviving strains down.',
  },
  food: {
    id: 'food', name: 'Food', icon: '🥫',
    axis: { vector: 40, envelope: 45, replication: 65, resilience: 30 },
    weight: 0.70, stab: +8, pure: -6, pot: 0.85,
    blurb: 'Culture medium. Keeps a batch alive; keeps contaminants alive too.',
  },
  stone: {
    id: 'stone', name: 'Stone', icon: '🪨',
    axis: { vector: 25, envelope: 60, replication: 20, resilience: 70 },
    weight: 0.60, stab: +14, pure: +4, pot: 0.65,
    blurb: 'Mineral buffer. Slow, dull, and the reason an essence batch survives the drive.',
  },
  fuel: {
    id: 'fuel', name: 'Fuel', icon: '⛽',
    axis: { vector: 70, envelope: 70, replication: 45, resilience: 55 },
    weight: 0.95, stab: -6, pure: +12, pot: 1.10,
    blurb: 'Sterilisation heat. Burns contamination out and stresses everything else.',
  },
  supplies: {
    id: 'supplies', name: 'Supplies', icon: '📦',
    axis: { vector: 50, envelope: 50, replication: 50, resilience: 50 },
    weight: 0.60, stab: +12, pure: +8, pot: 0.80,
    blurb: 'Lab consumables. No opinion about the virus; makes everything else go better.',
  },
  energyDrink: {
    id: 'energyDrink', name: 'Energy Drink', icon: '🥤',
    axis: { vector: 60, envelope: 35, replication: 75, resilience: 25 },
    weight: 0.75, stab: -10, pure: -8, pot: 1.25,
    blurb: 'Nobody sanctioned this. It does raise potency. It also raises the coroner\'s eyebrows.',
  },
  wood: {
    id: 'wood', name: 'Wood', icon: '🪵',
    axis: { vector: 35, envelope: 40, replication: 35, resilience: 55 },
    weight: 0.50, stab: +10, pure: +2, pot: 0.60,
    blurb: 'Cellulose scaffold. Cheap bulk that stops a mix falling apart.',
  },

  /* ══ THE SECOND BENCH ════════════════════════════════════════════════════
     🔴 WHY THESE EXIST, AND WHY THE SHAPES ARE NOT ARBITRARY.

     blendOf() is a WEIGHTED AVERAGE, so every mix a player can physically make
     lands somewhere inside the CONVEX HULL of the reagent points in 4-space.
     That is a much smaller region than "0..100 on each axis", and a strain
     signature outside it cannot be matched by any mix at all — no slider, no
     amount of resources, no skill. It is not a hard puzzle, it is an
     unsolvable one, and the player cannot see why.

     Measured against the thirteen reagents above (400 generated strains, each
     given the mathematically optimal mix by Frank-Wolfe rather than a human
     guess): 7.8% could never reach BROAD-SPECTRUM however well they were
     played, and the failures were all the same shape — a hull with no vertex
     in that corner. The four corners that were missing:

       · high envelope with LOW resilience — a haemic strain at envelope 92 /
         resilience 31 dragged resilience to 63 no matter what, because every
         high-envelope reagent (essence 90/90, metal 75/78, fuel 70/55) also
         carried high resilience. → acids, ethanol, solvents.
       · very low replication — fungal strains ask for 11 and the floor was
         stone at 20, which also pins envelope and resilience. → silica.
       · very low vector — asked for as low as 2, and the only reagent under 30
         was memoryShards at 20, which forces resilience to 88. → limestone.
       · very high vector with low resilience — respiratory at 90/13 against a
         ceiling of essence at 85/90. → anomalousEnergy.

     ⚠ AND THE SECOND COMPLAINT IS ANSWERED BY WEIGHT, NOT BY POSITION. "If you
       get to one suitable marker, adjusting anything else moves it from that
       marker" is what a weighted average does: every reagent moves all four
       axes at once. The cure is a reagent quiet enough to trim with — a low
       `weight` moves the blend a little without dragging it — which is what
       herbs, limestone and plantFiber are for. They are deliberately weak
       rather than weak by accident.

     Every id below is a real RESOURCES id that the city, the refinery or the
     loot tables already produce, per the rule at the top of this file. */

  medicalChemicals: {
    id: 'medicalChemicals', name: 'Medical Chemicals', icon: '⚗️',
    axis: { vector: 58, envelope: 62, replication: 58, resilience: 52 },
    weight: 1.30, stab: +16, pure: +14, pot: 1.40,
    blurb: 'Refined pharmaceutical base. Everything Medicine does, done properly — and it is not cheap.',
  },
  herbs: {
    id: 'herbs', name: 'Herbs', icon: '🌿',
    axis: { vector: 46, envelope: 34, replication: 58, resilience: 32 },
    weight: 0.50, stab: +14, pure: +4, pot: 0.85,
    blurb: 'Mild, forgiving, and quiet enough to trim a blend with instead of shoving it.',
  },
  acids: {
    id: 'acids', name: 'Acids', icon: '🧪',
    axis: { vector: 55, envelope: 96, replication: 22, resilience: 8 },
    weight: 1.35, stab: -14, pure: +6, pot: 1.25,
    blurb: 'Digests a heavy coat and leaves nothing tough behind. Hard on the batch as well as the virus.',
  },
  solvents: {
    id: 'solvents', name: 'Solvents', icon: '🧴',
    axis: { vector: 72, envelope: 84, replication: 30, resilience: 18 },
    weight: 1.05, stab: -5, pure: +16, pot: 1.05,
    blurb: 'Strips the shell and washes the vessel at the same time. Reaches far, holds little.',
  },
  ethanol: {
    id: 'ethanol', name: 'Ethanol', icon: '🧫',
    axis: { vector: 38, envelope: 88, replication: 40, resilience: 10 },
    weight: 0.90, stab: +2, pure: +20, pot: 0.95,
    blurb: 'Fixative. Cracks an envelope, ruins resilience, and comes out of the vial clean.',
  },
  silica: {
    id: 'silica', name: 'Silica', icon: '🔬',
    axis: { vector: 28, envelope: 72, replication: 4, resilience: 62 },
    weight: 0.85, stab: +14, pure: +18, pot: 0.75,
    blurb: 'Inert lattice. The one thing on the bench that stops a fast copier dead.',
  },
  arcaneCrystal: {
    id: 'arcaneCrystal', name: 'Arcane Crystal', icon: '💎',
    axis: { vector: 52, envelope: 18, replication: 16, resilience: 96 },
    weight: 1.10, stab: +6, pure: +8, pot: 1.15,
    blurb: 'Endurance without armour. For the strain that will not die rather than the one you cannot reach.',
  },
  anomalousEnergy: {
    id: 'anomalousEnergy', name: 'Anomalous Energy', icon: '⚡',
    axis: { vector: 97, envelope: 44, replication: 62, resilience: 26 },
    weight: 1.15, stab: -16, pure: -6, pot: 1.45,
    blurb: '⚠ Goes anywhere and stays nowhere. The only thing that reaches a strain built to travel.',
  },
  limestone: {
    id: 'limestone', name: 'Limestone', icon: '🪨',
    axis: { vector: 6, envelope: 52, replication: 14, resilience: 60 },
    weight: 0.55, stab: +18, pure: +6, pot: 0.60,
    blurb: 'Chalk buffer. Pulls a blend down off the far end of the scale, gently and cheaply.',
  },
  mythicResidue: {
    id: 'mythicResidue', name: 'Mythic Residue', icon: '🌫',
    axis: { vector: 5, envelope: 88, replication: 70, resilience: 78 },
    weight: 1.20, stab: -8, pure: -4, pot: 1.30,
    blurb: 'It does not travel; it stays, and it copies. For the strain that sits in one place and will not leave.',
  },
  quartz: {
    id: 'quartz', name: 'Quartz', icon: '💠',
    axis: { vector: 74, envelope: 93, replication: 6, resilience: 74 },
    weight: 1.00, stab: +10, pure: +14, pot: 0.90,
    blurb: 'Cracks a hard shell and halts the copy at the same time — the answer to a slow, armoured strain.',
  },
  plantFiber: {
    id: 'plantFiber', name: 'Plant Fiber', icon: '🌾',
    axis: { vector: 30, envelope: 28, replication: 30, resilience: 30 },
    weight: 0.35, stab: +12, pure: +8, pot: 0.60,
    blurb: 'The quietest thing on the bench. Nudges every axis down a hair without picking a fight.',
  },
};

export const REAGENT_IDS = Object.keys(REAGENTS);

/* Batch verdicts, worst to best. `grade()` is the ONE place these thresholds
   live — the 3D lab's HUD, the dispatch board and the shipment settlement all
   read this function rather than re-deriving the bands, so a retune moves all
   three at once and they can never disagree about what the player is holding. */
export const GRADES = {
  iatrogenic: { key: 'iatrogenic', label: 'IATROGENIC', icon: '☣️', color: '#ff5b6e',
    blurb: 'This is not a cure. It will make a new strain in whoever takes it.' },
  inert:      { key: 'inert', label: 'INERT', icon: '⚪', color: '#8b93a3',
    blurb: 'Chemically fine, therapeutically nothing. Wasted reagents.' },
  palliative: { key: 'palliative', label: 'PALLIATIVE', icon: '🩹', color: '#e0b060',
    blurb: 'Eases the strain without clearing it — and teaches it to resist.' },
  viable:     { key: 'viable', label: 'VIABLE CURE', icon: '💉', color: '#86e08a',
    blurb: 'Clears the strain it was built for.' },
  broad:      { key: 'broad', label: 'BROAD-SPECTRUM', icon: '🌟', color: '#7fd6ff',
    blurb: 'Clears the strain and its close relatives.' },
};

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/* ── the lab-work inputs ───────────────────────────────────────────────────
   `craft` is what the 3D minigame produces. Every field is 0..1 and every one
   defaults to a NEUTRAL value that is deliberately mediocre rather than zero:
   a caller with no minigame result (a headless test, a player on a device
   that could not start WebGL) still gets a workable batch, just never a great
   one. Failing open to "impossible" would make the 3D layer load-bearing for
   a feature that has to work without it. */
function normCraft(craft) {
  const c = craft || {};
  const n = (v, d) => (Number.isFinite(+v) ? clamp(+v, 0, 1) : d);
  return {
    sequenced: !!c.sequenced,       // did they read the strain at the Sequencer?
    centrifuge: n(c.centrifuge, 0.5),
    synthesis: n(c.synthesis, 0.5),
    assayed: !!c.assayed,           // did they run QC before dispatch?
    // 🔴 EXPOSURE is the hazmat rule made numeric. Time spent in the hot zone
    // without a sealed suit contaminates the BATCH, not just the player — the
    // suit is a rule about the product, which is the only way a safety rule in
    // a game about money can ever matter.
    exposure: n(c.exposure, 0),
    sealed: c.sealed !== false,     // was the suit sealed for the hot-zone work?
  };
}

/* Total units in a mix, and the mix normalised to shares that sum to 1. */
export function mixTotal(mix) {
  let t = 0;
  for (const k of REAGENT_IDS) t += Math.max(0, (mix && mix[k]) | 0);
  return t;
}

export function blendOf(mix) {
  const blend = {}; for (const ax of AXES) blend[ax] = 0;
  let wsum = 0;
  for (const k of REAGENT_IDS) {
    const units = Math.max(0, (mix && mix[k]) | 0);
    if (!units) continue;
    const R = REAGENTS[k];
    const w = units * R.weight;
    wsum += w;
    for (const ax of AXES) blend[ax] += (R.axis[ax] || 0) * w;
  }
  if (wsum > 0) for (const ax of AXES) blend[ax] = blend[ax] / wsum;
  return blend;
}

/* Which axes the mix LEANS on, as a signed push relative to the middle. This
   is what mutate() uses to move a mutant in the direction of the player's own
   mistake instead of somewhere random. */
function leanOf(blend) {
  const lean = {};
  for (const ax of AXES) lean[ax] = (+blend[ax] || 50) - 50;
  return lean;
}

/* ══ formulate ═════════════════════════════════════════════════════════════
   PURE. Give it a strain, a mix and the lab work; get back everything the UI
   needs to describe the batch BEFORE the player commits to it. The 3D lab
   calls this on every change; state.js calls it once more at dispatch. Same
   function, so what the player was shown is what they get. */
export function formulate(strain, mix, craft) {
  const c = normCraft(craft);
  const total = mixTotal(mix);
  const blend = blendOf(mix);

  if (total <= 0) {
    return { ok: false, why: 'empty', total: 0, blend: blend,
             efficacy: 0, potency: 0, purity: 0, stability: 0, doses: 0,
             grade: GRADES.inert, contaminated: false, risk: 0, warnings: ['Nothing in the vessel.'] };
  }

  // ── shares, and the three per-unit accumulators
  let stab = 40, pure = 30, pot = 0;
  for (const k of REAGENT_IDS) {
    const units = Math.max(0, (mix && mix[k]) | 0);
    if (!units) continue;
    const share = units / total;
    const R = REAGENTS[k];
    stab += R.stab * share * 2.2;
    pure += R.pure * share * 2.4;
    pot += R.pot * share;
  }

  /* ── efficacy. Distance → match, then the two lab gates.
     🔴 SEQUENCING IS NOT COSMETIC. Without a Sequencer read the player is
     formulating against a signature they have not seen, and the game must not
     silently hand them the answer anyway. The 0.72 ceiling is what "guessing
     well" is worth: a blind batch can be a decent palliative and can never be
     broad-spectrum. */
  const dist = sigDistance((strain && strain.sig) || {}, blend);
  let efficacy = clamp(1 - dist * 1.85, 0, 1);
  if (!c.sequenced) efficacy = Math.min(efficacy, 0.72) * 0.88;
  efficacy *= 0.72 + c.synthesis * 0.38;          // bench work, 0.72 … 1.10
  // Resistance the strain has already learned, capped in strains.js at 0.6.
  efficacy *= 1 - clamp((strain && +strain.resistance) || 0, 0, 0.6);
  efficacy = clamp(efficacy, 0, 1);

  // ── purity: filtration reagents + the centrifuge, minus hot-zone exposure.
  let purity = clamp(pure + c.centrifuge * 45 - c.exposure * 60 - (c.sealed ? 0 : 18), 0, 100);

  /* ── stability: the reagents, plus the assay catching what the reagents did
     not. QC does not MAKE a batch stable — it lets the player see the number
     and decide, and the +8 is only the practical benefit of having actually
     looked. The real value of the Assay station is the warning it prints. */
  let stability = clamp(stab + (c.assayed ? 8 : 0) + c.centrifuge * 12 - c.exposure * 25, 0, 100);

  // ── potency: reagent strength × volume (with diminishing returns) × bench.
  const volume = Math.min(1, Math.log10(1 + total) / Math.log10(1 + 60));
  const potency = clamp(pot * volume * (0.7 + c.synthesis * 0.5), 0, 2);

  /* 🔴 CONTAMINATION IS THE HAZMAT RULE'S TEETH. Working the hot zone unsuited
     does not merely scold the player — it puts something in the vial. A
     contaminated batch can still be efficacious, and that is precisely the
     batch that turns into an iatrogenic strain downstream. */
  const contaminated = (c.exposure > 0.12) || (!c.sealed && c.exposure > 0) || purity < 25;

  // Doses scale with volume and potency; a weak batch of 60 units is still a
  // lot of vials, it just does not do much per vial.
  const doses = Math.max(1, Math.round(total * 0.8 * (0.4 + potency * 0.6)));

  /* ── risk: the probability this batch spawns a strain when administered.
     Reads instability first, contamination second, and raw essence third. */
  let risk = 0;
  risk += clamp((45 - stability) / 45, 0, 1) * 0.62;
  if (contaminated) risk += 0.28;
  const essenceShare = Math.max(0, ((mix && mix.corruptedEssence) | 0)) / total;
  risk += essenceShare * 0.35;
  if (!c.assayed) risk += 0.10;                  // shipping unread is its own gamble
  risk = clamp(risk, 0, 0.97);

  const grade = gradeOf({ efficacy, stability, purity, risk, contaminated });

  const warnings = [];
  if (!c.sequenced) warnings.push('🧭 Formulated blind — the Sequencer was never run on this strain.');
  if (!c.assayed) warnings.push('🔬 No assay. You are shipping a number nobody has read.');
  if (!c.sealed && c.exposure > 0) warnings.push('☣️ Hot-zone work done without a sealed suit.');
  else if (c.exposure > 0.12) warnings.push('☣️ Suit breach during hot-zone work — the batch caught it.');
  if (stability < 35) warnings.push('⚠ Unstable. This will not survive its own dose.');
  if (essenceShare > 0.25) warnings.push('🟣 Heavy Corrupted Essence. Buffer it or bury it.');
  if (purity < 40) warnings.push('💧 Low purity — run it through the centrifuge again.');

  return {
    ok: true,
    total, blend, lean: leanOf(blend),
    efficacy: +efficacy.toFixed(3),
    potency: +potency.toFixed(3),
    purity: Math.round(purity),
    stability: Math.round(stability),
    doses, risk: +risk.toFixed(3),
    contaminated, grade, warnings,
    craft: c,
  };
}

/* The band table. Order matters — first match wins, and iatrogenic is checked
   FIRST so a high-efficacy unstable batch is never sold to the player as a
   cure. That ordering is the whole "you can make it worse" promise. */
export function gradeOf(f) {
  if (f.stability < 35 || (f.contaminated && f.risk > 0.45)) return GRADES.iatrogenic;
  if (f.efficacy < 0.30) return GRADES.inert;
  if (f.efficacy < 0.62) return GRADES.palliative;
  if (f.efficacy >= 0.86 && f.purity >= 70 && f.stability >= 65) return GRADES.broad;
  return GRADES.viable;
}

/* ══ administer ════════════════════════════════════════════════════════════
   What the batch DOES when it reaches people. Pure: returns the outcome and
   the mutant (if any) and mutates nothing — the caller commits it.

   🔴 THE MUTANT IS PRODUCED HERE, NOT AT FORMULATION, because a bad batch
   sitting in a warehouse has never hurt anybody. The virus is created by
   ADMINISTERING it, which is why the shipping leg matters: a batch that was
   fine on the bench and broke its cold chain in a truck becomes iatrogenic in
   transit, and the player who hired the cheap carrier finds out at the far
   end. See logistics.js.

   `roll` is a deterministic 0..1 supplied by the caller (seeded from the batch
   id), NOT Math.random(). A player who reloads must not be able to reroll the
   outcome of a shipment they already sent. */
export function administer(strain, f, opts) {
  const o = opts || {};
  const seed = String(o.seed || (strain && strain.id) || 'batch');
  const roll = Number.isFinite(+o.roll) ? clamp(+o.roll, 0, 1) : rngFrom('adm:' + seed)();

  const out = {
    seed,
    grade: f.grade.key,
    cleared: false,          // did the strain get retired?
    relief: 0,               // 0..1 severity relief applied to the infected
    resistanceGain: 0,
    mutant: null,
    headline: '',
    detail: '',
  };

  const spawned = roll < f.risk;
  if (spawned) {
    /* Drift from instability: a 34-stability batch drifts a little, a
       5-stability batch produces something genuinely new. Squared so the
       truly reckless batches are the ones that make monsters. */
    const drift = clamp(Math.pow((60 - f.stability) / 60, 1.6) + (f.contaminated ? 0.18 : 0), 0.08, 1);
    out.mutant = mutate(strain, 'mut:' + seed + ':' + hash32(seed + ':' + f.stability), drift, f.lean);
  }

  if (f.grade.key === 'iatrogenic') {
    out.headline = '☣️ THE BATCH WAS THE OUTBREAK';
    out.detail = spawned
      ? 'It did not clear anything. It shed — and what came off it is now its own strain.'
      : 'It did not clear anything, and by luck alone nothing came off it. Destroy the rest.';
    // An iatrogenic batch still teaches the parent strain to resist. The
    // player got no benefit and paid a real cost; that asymmetry is the point.
    out.resistanceGain = 0.04;
    return out;
  }
  if (f.grade.key === 'inert') {
    out.headline = '⚪ NOTHING HAPPENED';
    out.detail = 'The dose was chemically sound and therapeutically empty.';
    return out;
  }
  if (f.grade.key === 'palliative') {
    out.relief = 0.35 + f.efficacy * 0.25;
    /* 🧪 THE RESISTANCE PENALTY, and the reason "ship the 50% cure, it is
       better than nothing" is a trap. A partial dose leaves survivors, and
       survivors are a selection event. */
    out.resistanceGain = 0.06 + (0.62 - f.efficacy) * 0.10;
    out.headline = '🩹 SYMPTOMS EASED, STRAIN INTACT';
    out.detail = 'People feel better. The strain now knows what you tried.';
    return out;
  }

  out.cleared = true;
  out.relief = 1;
  if (f.grade.key === 'broad') {
    out.headline = '🌟 BROAD-SPECTRUM CLEARANCE';
    out.detail = 'The strain is retired, and its close relatives will not take hold here.';
  } else {
    out.headline = '💉 STRAIN CLEARED';
    out.detail = 'The isolate is retired. Keep the formulation — its children will not match it.';
  }
  return out;
}

/* Cost of a mix in raw resource units, for the caller to spend through the
   sanctioned helpers. Returned as a plain {resId: units} map so it can go
   straight into the game's existing cost renderers. */
export function mixCost(mix) {
  const cost = {};
  for (const k of REAGENT_IDS) {
    const u = Math.max(0, (mix && mix[k]) | 0);
    if (u > 0) cost[k] = u;
  }
  return cost;
}

/* A SUGGESTED mix for a strain — the "auto-formulate" the lab offers once the
   Sequencer has run. Deliberately imperfect: it solves the axes greedily and
   does NOT balance stability, so a player who blindly ships the suggestion
   gets a viable cure with a real risk number attached. Learning to add the
   buffer yourself is the skill the feature teaches. */
/* Grade ranked worst→best, so a suggestion can prefer "a worse cure that is
   not iatrogenic" over "a better one that breeds a mutant". Kept beside
   gradeOf() rather than in the UI: the ordering IS a rule about medicine. */
const GRADE_RANK = { iatrogenic: 0, inert: 1, palliative: 2, viable: 3, broad: 4 };

/* What "better" means to the solver, in one place so it can be argued with.
   Grade dominates — the bands are the whole design — then efficacy, then the
   two axes that decide whether a batch survives contact with a patient, then a
   mild preference for actually using the budget, so the suggestion comes back
   as a usable number of doses rather than a perfect thimbleful. */
function mixScore(f, cap) {
  if (!f || !f.ok) return -Infinity;
  return (GRADE_RANK[(f.grade && f.grade.key) || 'inert'] || 0) * 10
    + f.efficacy * 4
    + (f.stability / 100)
    + (f.purity / 200)
    + Math.min(1, (f.total || 0) / Math.max(1, cap)) * 0.5;
}

/* ══ suggestMix ════════════════════════════════════════════════════════════
   🔴 THIS WAS A PER-AXIS GREEDY, AND THAT IS THE ONE THING IT MUST NOT BE.
   The old version picked, for each axis independently, the single reagent
   sitting closest to that axis's target — then put all four in the vessel
   together. But blendOf() is a WEIGHTED AVERAGE: the four choices do not
   compose, they average, so the result lands in the middle of the four rather
   than at any of them. It was advice that could not be followed, handed to a
   player who had just been told the button would help.

   That is also the reported experience — "if you get to one suitable marker,
   adjusting anything else moves it from that marker". The axes are coupled;
   any honest helper has to optimise the mix as a WHOLE.

   So: add one unit at a time, of whichever reagent most improves the batch as
   formulate() actually scores it, and return the best mix seen ALONG THE WAY
   rather than the last one — so the suggestion stops at the peak instead of
   walking past it into instability.

   ⚠ IT RESPECTS THE SHELF. `have` is the player's real stock; a suggestion
     built out of reagents they do not hold is worse than no suggestion,
     because it reads as the game telling them the answer is unaffordable.
     Omitted (a test, an old caller) and it plans without limits, as before.
   ⚠ IT OPTIMISES THE SHAPE, NOT THE SCORE THE PLAYER WILL SEE. It assumes a
     sequenced strain, because efficacy is CAPPED at 0.72 without one (see
     formulate) and a cap flattens the ranking — every good mix would score the
     same and the greedy would pick among them arbitrarily. The batch the
     player then mixes is graded on their real lab work, unchanged.
   ⚠ PURE, like everything else in this file. It spends nothing and commits
     nothing; the caller applies the mix. */
export function suggestMix(strain, budget, have, craft) {
  const cap = Math.max(6, Math.min(60, (budget | 0) || 24));
  const c = Object.assign({}, craft || {}, { sequenced: true });
  const stock = (have && typeof have === 'object') ? have : null;
  const mix = {};
  let bestMix = {}, bestScore = -Infinity;

  for (let n = 0; n < cap; n++) {
    let pick = null, pickScore = -Infinity;
    for (const k of REAGENT_IDS) {
      const held = stock ? (stock[k] | 0) : Infinity;
      if (((mix[k] | 0) + 1) > held) continue;
      mix[k] = (mix[k] | 0) + 1;
      const sc = mixScore(formulate(strain, mix, c), cap);
      if (sc > pickScore) { pickScore = sc; pick = k; }
      mix[k] -= 1;
      if (!mix[k]) delete mix[k];
    }
    if (!pick) break;                       // nothing affordable left on the shelf
    mix[pick] = (mix[pick] | 0) + 1;
    if (pickScore > bestScore) { bestScore = pickScore; bestMix = Object.assign({}, mix); }
  }
  return bestMix;
}

/* 🔎 WHAT ONE MORE UNIT WOULD DO, for every reagent, against the mix in the
   vessel RIGHT NOW. This is the number the bench was missing: the player could
   see four gaps and twenty-odd reagents and had no way to connect them, which
   is what "it feels like I am missing a lot of what needs to be shown on the
   UI" is describing.

   Returns, per reagent id, the signed movement of the blend on each axis and
   the change in the three numbers that decide the grade — so the list can be
   sorted by what actually helps NOW instead of by a fixed order that is wrong
   for three strains out of four.

   ⚠ It answers for +1 UNIT, not for a share, because +1 is the move the button
     makes. A reagent's own axis profile is a statement about a PURE vessel;
     what it does to THIS vessel depends on what is already in it, and that
     difference is the whole of the coupling the player was fighting blind. */
export function marginalOf(strain, mix, craft) {
  const base = formulate(strain, mix, craft);
  const out = {};
  for (const k of REAGENT_IDS) {
    const m = Object.assign({}, mix || {});
    m[k] = (m[k] | 0) + 1;
    const f = formulate(strain, m, craft);
    const d = {};
    for (const ax of AXES) d[ax] = (f.blend[ax] || 0) - (base.blend[ax] || 0);
    out[k] = {
      axis: d,
      dEfficacy: f.efficacy - base.efficacy,
      dStability: f.stability - base.stability,
      dPurity: f.purity - base.purity,
    };
  }
  return out;
}
