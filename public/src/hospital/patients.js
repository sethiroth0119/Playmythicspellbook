/* ══════════════════════════════════════════════════════════════════════════
   🤕 PATIENTS — who walks in, what is wrong with them, what fixes it. PURE.
   ──────────────────────────────────────────────────────────────────────────
   NPCs walk into the Medical Corporation on their own: the wounded from the
   wasteland, and the sick from the city's outbreak. Each one waits in the
   lobby for a BED. The player gives them one and treats them — bandages for
   a wound, medicine off the shelf for a sickness — and when the treatment
   runs its course the patient pays and leaves. A patient nobody beds walks
   out again, untreated, and the desk counts it.

   🔴 NOTHING HERE SPENDS, SAVES OR TOUCHES THE DOM. state.js owns every
   write. This file decides who arrives, what they need and what they pay.

   ⚠ THE ONE CINDER FIGURE IN THIS BUILDING: the patient fee band (TUNING
   FEE_MIN..FEE_MAX), an explicit owner's call — see the note on it.

   ⚠ The patient models rotate at random from PATIENT_MODELS (patients.models
   .js); a patient's `look` is fixed at arrival so a reload cannot reroll it.
   ══════════════════════════════════════════════════════════════════════════ */

import { PRODUCTS } from './pharma.js';

export const V = 1;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export const TUNING = {
  /* Walk-ins per real minute: a floor of wasteland wounds, plus the city.
     `cases` are the outbreak's active cases (the sick), `pop` the city. */
  BASE_PER_MIN: 0.12,
  PER_CASE_PER_MIN: 0.035,
  PER_POP_PER_MIN: 0.0003,
  QUEUE_OVER_BEDS: 4,               // lobby holds this many beyond the beds
  PATIENCE_MS: 12 * 60000,          // a patient waits this long for a bed
  WOUND_MS_PER_SEV: 80000,          // treatment time in bed, wall time
  SICK_MS_PER_SEV: 130000,
  OFFLINE_ARRIVALS_MAX: 6,          // a night away fills the lobby, not the street
  /* 💰 THE FEE. A healed patient pays a RANDOM amount of Cinder in this band,
     rolled once per patient (from their id, so a reload cannot reroll it) and
     paid the moment they are discharged, after which they walk out. The band
     is the owner's explicit design call (requested 2026-09-03: "make 5000
     cinder, make it rng") and is the ONE Cinder figure in this building that
     does not derive from _opEcon — kept here, named, so it is a knob and not
     a buried constant. Severity nudges the roll upward, never past the cap. */
  FEE_MIN: 500,
  FEE_MAX: 5000,
  // Bandages: cloth and water in, dressings out. Live resource ids only.
  BANDAGE_RECIPE: { cloth: 2, water: 1 },
  BANDAGE_YIELD: 3,
};

const FIRST = ['Ada', 'Bram', 'Cass', 'Dov', 'Eira', 'Fenn', 'Gil', 'Hesper', 'Idris', 'Juno', 'Kel', 'Lior', 'Mara', 'Nils', 'Orla', 'Pim', 'Quil', 'Rook', 'Sunn', 'Tam', 'Ursa', 'Vex', 'Wren', 'Yara', 'Zed'];
const LAST = ['Ashby', 'Brenner', 'Calder', 'Dray', 'Ekwe', 'Farrow', 'Grale', 'Holt', 'Ingram', 'Joss', 'Kettle', 'Lund', 'Moss', 'Nakamura', 'Oyelaran', 'Pike', 'Quist', 'Reyes', 'Sato', 'Tully', 'Vance', 'Wilde'];
const WOUNDS = ['a raider\'s knife', 'a fall off the scaffolds', 'shrapnel from the rigs', 'a dog bite', 'a burn from the smelter', 'a crushed hand at the depot', 'an arrow, old and infected', 'road rash off a convoy'];

function hash(s) { let h = 2166136261 >>> 0; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; } return h >>> 0; }
function rng(seed) { let x = hash(String(seed)) || 1; return () => { x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0; return x / 4294967296; }; }

/* How many patients walk in over `dtMs`, as a fractional accumulator the
   caller carries between ticks. `ctx`: { pop, cases, beds, waiting }. */
export function arrivalsPerMin(ctx) {
  const c = ctx || {};
  return TUNING.BASE_PER_MIN + Math.max(0, c.cases | 0) * TUNING.PER_CASE_PER_MIN + Math.max(0, +c.pop || 0) * TUNING.PER_POP_PER_MIN;
}
export function lobbyCap(beds) { return Math.max(0, beds | 0) + TUNING.QUEUE_OVER_BEDS; }

/* One new patient. `seed` fixes name, look and ailment so a reload cannot
   reroll them. `roster` (optional) lends real citizen names from the city;
   `strain` (optional) makes a sick patient carry the outbreak's strain. */
export function makePatient(seed, opts) {
  const o = opts || {};
  const r = rng('pt:' + seed);
  const models = Math.max(1, o.models | 0);
  const sickShare = clamp(+o.sickShare, 0, 1);   // share of arrivals that are sick, from the outbreak
  const sick = r() < sickShare;
  const roster = Array.isArray(o.roster) ? o.roster.filter((c) => c && c.name) : [];
  const citizen = (!sick || !roster.length) ? null : roster[Math.floor(r() * roster.length)];
  const name = citizen ? citizen.name : FIRST[Math.floor(r() * FIRST.length)] + ' ' + LAST[Math.floor(r() * LAST.length)];
  const severity = 1 + Math.floor(r() * 3);       // 1..3
  return {
    v: V,
    id: 'pt_' + hash('id:' + seed).toString(36),
    name,
    citizenId: citizen ? citizen.id : null,
    look: Math.floor(r() * models),               // index into PATIENT_MODELS
    ailment: sick ? 'sickness' : 'wound',
    detail: sick ? ((o.strain && o.strain.name) ? o.strain.name : 'a fever nobody can name') : WOUNDS[Math.floor(r() * WOUNDS.length)],
    strainId: sick && o.strain ? o.strain.id : null,
    family: sick && o.strain ? (o.strain.family || null) : null,
    severity,
    arrivedAt: +o.now || Date.now(),
    bedSlot: null,          // slot index once admitted
    treatedAt: null,        // when treatment started
    doneAt: null,           // when treatment completes
    status: 'waiting',      // waiting → inbed → treating → done | left
  };
}

/* What a patient needs, in the units the hospital actually holds. */
export function needsOf(p) {
  if (!p) return null;
  if (p.ailment === 'wound') return { kind: 'bandages', bandages: p.severity, product: null, medicine: 0 };
  return { kind: 'medicine', bandages: 0, product: 1, medicine: 2 };   // one shelf unit of a relief product, or 2 raw medicine
}

/* Pick the shelf product that treats this patient, best first: the family
   match, then anything with `relief`. Null if the shelf has none. */
export function reliefProduct(p, stock) {
  const s = stock || {};
  const has = (pid) => s[pid] && (s[pid].units | 0) > 0;
  const ranked = Object.keys(PRODUCTS).filter((pid) => PRODUCTS[pid].relief).sort((a, b) => {
    const fa = (s[a] && s[a].family === p.family && p.family) ? 1 : 0;
    const fb = (s[b] && s[b].family === p.family && p.family) ? 1 : 0;
    return (fb - fa) || (PRODUCTS[b].priceMul - PRODUCTS[a].priceMul);
  });
  for (const pid of ranked) if (has(pid)) return pid;
  return null;
}

export function treatmentMs(p, quality) {
  const q = clamp(+quality || 0.5, 0, 1);
  const base = (p.ailment === 'wound' ? TUNING.WOUND_MS_PER_SEV : TUNING.SICK_MS_PER_SEV) * p.severity;
  // Better medicine heals faster: perfect quality is a third quicker.
  return Math.round(base * (1.1 - 0.35 * q));
}

export function feeOf(p) {
  if (!p) return 0;
  const r = rng('fee:' + p.id)();
  // Severity leans the roll upward: a critical case rolls in the upper half.
  const floor = clamp((p.severity - 1) / 4, 0, 0.5);
  const t = floor + (1 - floor) * r;
  return Math.round(TUNING.FEE_MIN + (TUNING.FEE_MAX - TUNING.FEE_MIN) * t);
}

export function patienceLeft(p, now) {
  if (!p || p.status !== 'waiting') return 1;
  return clamp(1 - ((+now || Date.now()) - p.arrivedAt) / TUNING.PATIENCE_MS, 0, 1);
}

export function ailmentLabel(p) {
  if (!p) return '';
  const sev = ['', 'minor', 'serious', 'critical'][p.severity] || 'serious';
  return p.ailment === 'wound' ? '🩸 ' + sev + ' wound — ' + p.detail : '🤒 ' + sev + ' sickness — ' + p.detail;
}

/* Bandage crafting: batches of the recipe. */
export function bandageCost(batches) {
  const n = Math.max(0, batches | 0);
  const res = {};
  for (const id of Object.keys(TUNING.BANDAGE_RECIPE)) res[id] = TUNING.BANDAGE_RECIPE[id] * n;
  return { res, made: n * TUNING.BANDAGE_YIELD, batches: n };
}
