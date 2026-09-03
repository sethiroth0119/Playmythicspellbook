/* ══════════════════════════════════════════════════════════════════════════
   💊 PHARMA — cure lines, compounding, pricing and the NPC counter. PURE.
   ──────────────────────────────────────────────────────────────────────────
   The Medical Corporation's product model. A cure that a haulier delivered
   and the ward opened leaves a CURE LINE in the containment vault: a handful
   of retained samples plus the numbers that describe what actually arrived.
   The compounding lab turns a line into one of five MEDICINES, and the
   clinics and med labs in the player's city sell those to NPCs for Cinder.

   🔴 EVERY INPUT HERE IS AN ID FROM index.html's live `RESOURCES` (the 14):
   food · ammo · water · medicine · energyDrink · supplies · metal · fuel ·
   corruptedEssence · memoryShards · dna · wood · stone · cloth. Never the
   258-entry chain catalogue — a recipe asking for a resource nobody produces
   sends the player nowhere (see the header of /src/plague/cures.js).

   🔴 NOT ONE CINDER FIGURE IS WRITTEN IN THIS FILE. Prices are SHARES of the
   medical operation's own `ratePerWorkerHr`, which arrives through
   `_opEcon('medical')` on the bridge (CLAUDE.md: all operation pricing goes
   through _opEcon). Retune the op and every product retunes with it; an
   admin override reaches the pharmacy counter without a code change.

   ⚠ NOTHING HERE SPENDS, SAVES OR TOUCHES THE DOM. state.js owns every write.
   That is what lets the compounding panel preview a run live and what lets
   the whole thing run headless in _hospital_smoke.mjs.
   ══════════════════════════════════════════════════════════════════════════ */

import { GRADES } from '../plague/cures.js';
import { familyOf } from '../plague/strains.js';

export const V = 1;

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/* Grade rank, worst to best, for the "needs at least" gates below. */
const GRADE_RANK = { iatrogenic: -1, inert: 0, palliative: 1, viable: 2, broad: 3 };

/* ── the product table ─────────────────────────────────────────────────────
   `priceMul`      share of the medical op's ratePerWorkerHr per UNIT
   `perSample`     units one vault sample yields — the cure is the scarce input
   `inputs`        resources per unit, from the live 14
   `minGrade`      the worst cure line that can make it
   `minStability`  vaccines need a cure that holds together
   `family`        only a line of this family can make it (tonic = neural)
   `band`          titration tolerance — narrower is harder, see titrate()
   `demand`        how often an NPC asks for it, relative
   `relief`        does it treat the current outbreak's family? (sells more)

   Salve is the floor: it can be made from an INERT line, sells for little, and
   exists so a delivery that turned out useless as a cure is not a total loss.
   Vaccine is the ceiling: it wants a stable viable cure, a narrow dial, and
   four resources a unit — and it is the one NPCs pay for during an outbreak. */
export const PRODUCTS = {
  salve: {
    id: 'salve', name: 'Field Salve', icon: '🩹',
    priceMul: 0.030, perSample: 10, inputs: { water: 1, cloth: 1 },
    minGrade: 'inert', minStability: 0, family: null, band: 0.30, demand: 1.2, relief: false,
    blurb: 'Topical. Made from almost anything. Sells to everyone, for almost nothing.',
  },
  antiviral: {
    id: 'antiviral', name: 'Antiviral Tablets', icon: '💊',
    priceMul: 0.055, perSample: 6, inputs: { medicine: 1, water: 1 },
    minGrade: 'palliative', minStability: 0, family: null, band: 0.22, demand: 1.0, relief: true,
    blurb: 'The everyday product. A palliative line is enough; a viable one makes them better.',
  },
  serum: {
    id: 'serum', name: 'Immune Serum', icon: '🧪',
    priceMul: 0.095, perSample: 4, inputs: { medicine: 2, dna: 1 },
    minGrade: 'viable', minStability: 35, family: null, band: 0.17, demand: 0.7, relief: true,
    blurb: 'Injectable. Needs a real cure and a unit of DNA per dose.',
  },
  tonic: {
    id: 'tonic', name: 'Nerve Tonic', icon: '🧠',
    priceMul: 0.110, perSample: 4, inputs: { medicine: 1, memoryShards: 1 },
    minGrade: 'viable', minStability: 30, family: 'neural', band: 0.16, demand: 0.45, relief: true,
    blurb: 'Only a neuroviral cure line makes it. Rare, and priced like it.',
  },
  vaccine: {
    id: 'vaccine', name: 'Vaccine Dose', icon: '💉',
    priceMul: 0.140, perSample: 3, inputs: { medicine: 2, water: 2, supplies: 1 },
    minGrade: 'viable', minStability: 55, family: null, band: 0.12, demand: 0.5, relief: true,
    blurb: 'Wants a stable cure and a steady hand. The one NPCs queue for in an outbreak.',
  },
};
export const PRODUCT_IDS = Object.keys(PRODUCTS);

/* ── the cure line ─────────────────────────────────────────────────────────
   Built from a DELIVERED-AND-ADMINISTERED shipment and its batch. The numbers
   are the ARRIVED ones (state.js stores them on ship.result), never the
   dispatch ones — what the ward opened is what the vault holds.

   🔴 AN IATROGENIC CRATE LEAVES NOTHING. Refusing it was the whole point of
   the ward, and a refused crate is incinerated (plague/state.js). A crate that
   was administered anyway and released a mutant still leaves no line — a
   product compounded from it would be a way to sell the mutant. */
export function lineFrom(ship, batch, strain) {
  if (!ship || !batch || ship.status !== 'administered') return null;
  const r = ship.result || {};
  const grade = GRADES[r.arrivedGrade] || GRADES[batch.f && batch.f.grade] || GRADES.inert;
  if (grade.key === 'iatrogenic') return null;
  const delivered = Math.max(0, r.dosesDelivered | 0);
  if (delivered <= 0) return null;
  const treated = Math.max(0, ship.treated | 0);
  /* Samples: whatever the ward did not put into people, plus a retained
     reference stock of a fifth of the crate — a ward keeps a shelf of every
     cure it has handled. Never fewer than two, so a fully-used crate still
     seeds a line. */
  const samples = Math.max(2, delivered - treated + Math.round(delivered * 0.2));
  const f = batch.f || {};
  return {
    v: V,
    id: 'cl_' + String(ship.id).replace(/^shp_/, ''),
    shipmentId: ship.id,
    batchId: batch.id,
    strainId: ship.strainId || batch.strainId || null,
    strainName: batch.strainName || 'Unknown isolate',
    isolate: batch.strainIsolate || '',
    family: (strain && strain.family) || null,
    grade: grade.key,
    efficacy: clamp(r.arrivedEfficacy != null ? +r.arrivedEfficacy : +f.efficacy || 0, 0, 1),
    purity: clamp(r.arrivedPurity != null ? r.arrivedPurity | 0 : f.purity | 0, 0, 100),
    stability: clamp(r.arrivedStability != null ? r.arrivedStability | 0 : f.stability | 0, 0, 100),
    samples,
    samplesTotal: samples,
    from: ship.shipperName || null,
    carrier: ship.carrierName || null,
    at: ship.administeredAt || Date.now(),
    status: 'open',            // open → spent | discarded
  };
}

export function familyLabel(line) {
  const f = line && line.family ? familyOf(line.family) : null;
  return f ? f.icon + ' ' + f.name : '❔ Unclassified';
}

/* Can this product be made from this line at all? A refusal string says why,
   because "greyed out" teaches nothing. */
export function canMake(product, line) {
  const p = typeof product === 'string' ? PRODUCTS[product] : product;
  if (!p) return { ok: false, why: 'No such product.' };
  if (!line || line.status !== 'open') return { ok: false, why: 'That line is spent.' };
  if ((line.samples | 0) <= 0) return { ok: false, why: 'No samples left on that line.' };
  const have = GRADE_RANK[line.grade] != null ? GRADE_RANK[line.grade] : 0;
  const need = GRADE_RANK[p.minGrade] || 0;
  if (have < need) return { ok: false, why: p.name + ' needs at least a ' + GRADES[p.minGrade].label + ' line; this one is ' + GRADES[line.grade].label + '.' };
  if ((line.stability | 0) < p.minStability) return { ok: false, why: p.name + ' needs ' + p.minStability + '% stability; this line holds ' + (line.stability | 0) + '%.' };
  if (p.family && line.family !== p.family) return { ok: false, why: p.name + ' can only be compounded from a ' + familyOf(p.family).name + ' cure.' };
  return { ok: true, why: 'Compoundable.' };
}

/* The most units a line can yield for a product, and what a run of `units`
   costs in samples and resources. */
export function maxUnits(product, line) {
  const p = typeof product === 'string' ? PRODUCTS[product] : product;
  if (!p || !line) return 0;
  return Math.max(0, (line.samples | 0) * p.perSample);
}
export function runCost(product, units) {
  const p = typeof product === 'string' ? PRODUCTS[product] : product;
  const n = Math.max(0, units | 0);
  const res = {};
  if (p) for (const id of Object.keys(p.inputs)) res[id] = n * p.inputs[id];
  return { res, samples: p ? Math.ceil(n / p.perSample) : 0, units: n };
}

/* ── the titration dial ────────────────────────────────────────────────────
   The compounding minigame's one skill input. A needle sweeps and the player
   stops it in the band; the band is the product's own tolerance, NARROWED by
   an unstable line — a shaky cure is physically harder to dose. Returns the
   dial's parameters; index.js runs the needle, hud.js draws it. */
export function dial(product, line, seed) {
  const p = typeof product === 'string' ? PRODUCTS[product] : product;
  const stab = clamp((line && line.stability | 0) / 100, 0, 1);
  const s = Math.abs(hash(String(seed || '') + (p ? p.id : '')));
  return {
    target: 0.22 + ((s % 1000) / 1000) * 0.56,
    width: Math.max(0.06, (p ? p.band : 0.2) * (0.6 + 0.4 * stab)),
    speed: 0.5 + (1 - stab) * 0.35,
  };
}
export function titrate(d, pos) {
  const dist = Math.abs((+pos || 0) - d.target);
  return +clamp(1 - dist / (d.width * 1.6), 0, 1).toFixed(2);
}

/* ── compounding ───────────────────────────────────────────────────────────
   What a run produces. `craft` is `{ titration, exposure, sealed }` — the same
   two hazmat numbers cures.js consumes, because the sterile rule is the
   hazmat rule: work the clean room unsuited and it is on the product.

     quality   0..1 — sets the unit price and what an NPC says about it
     made      units that actually come off the line (yield follows the dial)
     spoiled   the run is destroyed: nothing made, inputs and samples gone

   🔴 SPOILAGE IS REAL AND IT COSTS THE INPUTS. A contaminated run that quietly
   made worse product would teach players the suit is optional. */
export function compound(product, line, units, craft) {
  const p = typeof product === 'string' ? PRODUCTS[product] : product;
  const c = craft || {};
  const t = clamp(+c.titration || 0, 0, 1);
  const exposure = clamp(+c.exposure || 0, 0, 1);
  const sealed = c.sealed !== false;
  const n = Math.max(0, units | 0);
  const warnings = [];
  if (!p || !line || !n) return { ok: false, made: 0, quality: 0, spoiled: false, warnings: ['Nothing to compound.'] };

  let q = 0.38 * clamp(+line.efficacy || 0, 0, 1)
        + 0.22 * clamp((line.purity | 0) / 100, 0, 1)
        + 0.12 * clamp((line.stability | 0) / 100, 0, 1)
        + 0.28 * t;
  if (line.grade === 'broad') q += 0.05;
  if (t < 0.4) warnings.push('Dosed off the band — potency is uneven across the run.');

  let spoiled = false;
  let contaminated = false;
  if (!sealed || exposure > 0.12) {
    contaminated = true;
    q -= exposure * 0.9 + (sealed ? 0 : 0.15);
    warnings.push('☣️ Compounded outside sterile protocol. Whatever was on you is in the product.');
  }
  if (exposure > 0.35) {
    spoiled = true;
    warnings.push('☣️ The run failed sterility. Destroyed — inputs and samples are gone.');
  }
  q = +clamp(q, 0, 1).toFixed(3);
  const made = spoiled ? 0 : Math.max(1, Math.round(n * (0.72 + 0.28 * t)));
  if (!spoiled && made < n) warnings.push((n - made) + ' unit' + (n - made === 1 ? '' : 's') + ' lost to the dial.');
  return { ok: true, made, quality: q, spoiled, contaminated, titration: t, warnings };
}

/* ── pricing ───────────────────────────────────────────────────────────────
   A unit is worth a share of the medical op's hourly rate per worker, scaled
   by quality: 0.6× at nothing, 1.3× at perfect. Reads `econ`, never a
   number. With no econ row (the bridge absent) the price is 0, which is the
   honest answer — the counter cannot sell what the game will not price. */
export function unitPrice(product, quality, econ) {
  const p = typeof product === 'string' ? PRODUCTS[product] : product;
  const rate = Math.max(0, +(econ && econ.ratePerWorkerHr) || 0);
  if (!p || !rate) return 0;
  const q = clamp(+quality || 0, 0, 1);
  return Math.max(1, Math.round(rate * p.priceMul * (0.6 + 0.7 * q)));
}

/* ── the NPC counter ───────────────────────────────────────────────────────
   How many customers walk into the city's dispensaries per city minute.

     pop            the city's population (NPCs — the buyers)
     dispensaries   clinics and med labs that are up: [{ type, lvl }]
     cases          active outbreak cases in the city
     staffing       0..1, the city's crew ratio

   Every dispensary after the first adds less (a fourth clinic on the same
   block shares the same sick people), and an outbreak sends people to the
   counter — up to triple demand. A city with no clinic and no med lab sells
   nothing: the hospital makes medicine, the city's buildings retail it. */
export const TUNING = {
  CUSTOMERS_PER_POP_MIN: 0.0055,     // ~1.6/min at pop 300 with one clinic
  OUTBREAK_BOOST_PER_CASE: 0.12,
  OUTBREAK_BOOST_MAX: 2.0,
  RELIEF_FAMILY_BONUS: 0.5,          // the product that treats the current family
  DISPENSARY_EXP: 0.65,
  MEDLAB_WEIGHT: 0.6,                // a med lab is a smaller counter than a clinic
};

export function customersPerMin(ctx) {
  const c = ctx || {};
  const pop = Math.max(0, +c.pop || 0);
  let cap = 0;
  for (const d of (c.dispensaries || [])) {
    if (!d) continue;
    const w = d.type === 'medlab' ? TUNING.MEDLAB_WEIGHT : 1;
    cap += w * Math.max(1, d.lvl | 0);
  }
  if (cap <= 0 || pop <= 0) return 0;
  const boost = 1 + Math.min(TUNING.OUTBREAK_BOOST_MAX, Math.max(0, c.cases | 0) * TUNING.OUTBREAK_BOOST_PER_CASE);
  const staffing = clamp(c.staffing == null ? 1 : +c.staffing, 0.25, 1);
  return pop * TUNING.CUSTOMERS_PER_POP_MIN * Math.pow(cap, TUNING.DISPENSARY_EXP) * boost * staffing;
}

/* Which product the next customer asks for, from what is on the shelf.
   Weighted by product demand, by quality (word gets around) and by whether
   it treats the outbreak's family. `rng` is 0..1. Null if the shelf is bare. */
export function pickSale(stock, ctx, rng) {
  const c = ctx || {};
  const rows = [];
  let total = 0;
  for (const pid of PRODUCT_IDS) {
    const s = stock && stock[pid];
    if (!s || (s.units | 0) <= 0) continue;
    const p = PRODUCTS[pid];
    let w = p.demand * (0.5 + clamp(+s.quality || 0, 0, 1));
    if (p.relief && (c.cases | 0) > 0) w *= 1 + TUNING.RELIEF_FAMILY_BONUS * ((s.family && c.family && s.family === c.family) ? 2 : 1);
    rows.push({ pid, w }); total += w;
  }
  if (!rows.length || total <= 0) return null;
  let r = clamp(+rng || 0, 0, 0.999999) * total;
  for (const row of rows) { r -= row.w; if (r <= 0) return row.pid; }
  return rows[rows.length - 1].pid;
}

/* One tick of the counter. Mutates `stock` (units down) and returns what
   sold. `acc` carries the fractional customer between ticks so a 1-second
   tick at 0.03 customers still sells one every ~33 seconds rather than never.
   Deterministic given `rng`. */
export function sellTick(stock, dtMin, ctx, econ, acc, rng) {
  const a = acc || { customers: 0 };
  const rate = customersPerMin(ctx);
  a.customers += rate * Math.max(0, +dtMin || 0);
  const sold = {}; let cinder = 0, units = 0;
  let guard = 0;
  while (a.customers >= 1 && guard++ < 200) {
    a.customers -= 1;
    const pid = pickSale(stock, ctx, typeof rng === 'function' ? rng() : Math.random());
    if (!pid) { a.customers = Math.min(a.customers, 0.999); break; }   // shelf bare — the queue does not pile up
    const s = stock[pid];
    s.units = Math.max(0, (s.units | 0) - 1);
    const price = unitPrice(pid, s.quality, econ);
    sold[pid] = (sold[pid] | 0) + 1;
    cinder += price; units++;
  }
  return { sold, units, cinder, ratePerMin: +rate.toFixed(3), acc: a };
}

/* Merge a compounded run onto the shelf. Quality is unit-weighted so a great
   run lifts a mediocre shelf a little rather than replacing it. */
export function addToShelf(stock, pid, made, quality, line) {
  if (!stock || !pid || !(made > 0)) return stock;
  const s = stock[pid] || { units: 0, quality: 0, family: null, lineName: null };
  const total = (s.units | 0) + made;
  s.quality = +(((s.quality || 0) * (s.units | 0) + quality * made) / total).toFixed(3);
  s.units = total;
  if (line) { s.family = line.family || s.family || null; s.lineName = line.strainName || s.lineName; }
  stock[pid] = s;
  return stock;
}

export function shelfUnits(stock) {
  let n = 0; for (const pid of PRODUCT_IDS) n += ((stock && stock[pid] && stock[pid].units) | 0);
  return n;
}

function hash(s) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return h | 0;
}
