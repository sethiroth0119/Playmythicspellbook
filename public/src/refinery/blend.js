/* ═══════════════════════════════════════════════════════════════════════════
   🛢 HIDN PETRO — the blending bench and the quality lab
   ---------------------------------------------------------------------------
   THE MAIN EVENT. Everything upstream exists to hand this stage interesting
   inputs, and everything downstream exists to make the decision here matter.

   The design rule the whole stage is built on: a failed batch is never
   deleted. Every off-spec tank has four honest exits —
       fix it   (buy the expensive component, land the spec, keep the margin)
       reprocess (feed it back as Reprocessed Slop, lose 14% and some purity)
       downgrade (sell it as the grade it DOES pass, for less)
       dump it   (pay disposal, take the reputation hit, move on)
   — and which one is right changes with the deadline, the market and how much
   Cinder is left. That is the decision the brief asked for, and it only exists
   because nothing here throws work away.
   ═════════════════════════════════════════════════════════════════════════ */

import { COMPONENTS, COMPONENT_LIST, GRADES, STREAMS, RACK, rackPrice, assayMix, specCheck,
         bestGradeFor, spotBuyPrice, spotSellPrice, CONVERSIONS, COSTS } from './data.js';
import * as St from './state.js';
import { streamQuality } from './sim.js';

/* ── Which components this yard can actually put in a tank right now.
      A component whose unit you do not own is shown but flagged: the player
      should be able to SEE that Alkylate is the answer long before they can
      make it, because that is what makes the Alkylation unit worth wanting. */
export function availableComponents() {
  const s = St.S();
  return COMPONENT_LIST.map(c0 => {
    /* Show what is ACTUALLY in the tank, not what the table says a pristine
       stream would be. Naphtha refined from a sour barrel really is sour, and
       a player who cannot see that before they blend it finds out only when a
       finished 8,500 L batch fails on sulfur — at which point nothing can save
       it. The number has to be on the slider. */
    const c = effectiveComponent(c0.id) || c0;
    const unlocked = !c.unit || (s.equip[c.unit] | 0) > 0;
    const have = St.stock(c.id);
    const merchant = !!(c.unit && (s.equip[c.unit] | 0) <= 0) && !SPOT_ALWAYS.includes(c.id);
    const buyable = NEVER_FOR_SALE.includes(c.id) ? (!!c.unit && unlocked) : true;
    const price = spotBuyPrice(c.id, s.marketIndex, merchant);
    /* ⚠ REACH, NOT STOCK. The bench slider used to cap at what was in the
       tanks, which permanently disabled ethanol and butane — nobody ever
       HOLDS an additive, you buy it for the batch you are blending. That
       quietly removed the most important lever on the bench and with it the
       decision the whole stage is built around ("do I pay for the octane?").
       Reach is what you hold PLUS what you could buy right now. */
    const affordable = buyable ? Math.floor(St.cinder() / Math.max(0.01, price)) : 0;
    return {
      ...c,
      unlocked,
      buyable,
      merchant,
      have,
      reach: Math.min(St.BLEND_TANK_L, have + affordable),
      spot: price,
      lockedBy: c.unit ? (c.unit === 'reformer' ? 'Catalytic Reformer'
                        : c.unit === 'cracker'  ? 'Cracking Unit'
                        : c.unit === 'treater'  ? 'Hydrotreater'
                        : c.unit === 'alky'     ? 'Alkylation Unit' : c.unit) : null,
    };
  });
}

/* ── EFFECTIVE PROPERTIES ─────────────────────────────────────────────────
   Stock is not abstract. Naphtha refined from a sour barrel on a sloppy run
   really is worse than the table says, and the blend has to see that or the
   whole crude-selection and run-quality layer stops mattering at the only
   point where the player would notice. streamQuality() carries that forward. */
export function effectiveComponent(id) {
  const c = COMPONENTS[id];
  if (!c) return null;
  // Only the straight-run streams inherit the barrel's sins. Reformate,
  // alkylate and hydro come off units that clean up their own feed, which is
  // exactly what the player is paying those units for.
  if (id !== 'naphtha' && id !== 'slopcut') return c;
  const q = streamQuality('naphtha');
  const sulfurPpm = id === 'naphtha' ? Math.max(20, q.sulfur * 10000 * 0.055) : c.sulfur;
  return { ...c, sulfur: sulfurPpm, purity: Math.max(80, c.purity - q.dirt * 0.55) };
}

/* assayMix() in data.js reads the STATIC table. This wraps it so the bench
   shows the player the truth about the stock in their own tanks. */
export function assayBench(mix) {
  const patched = {};
  const saved = {};
  for (const k in mix) {
    const eff = effectiveComponent(k);
    if (eff && COMPONENTS[k]) { saved[k] = { ...COMPONENTS[k] }; Object.assign(COMPONENTS[k], eff); }
    patched[k] = mix[k];
  }
  const a = assayMix(patched);
  for (const k in saved) Object.assign(COMPONENTS[k], saved[k]);
  return a;
}

/* ── THE LAB READING ──────────────────────────────────────────────────────
   The player does not see the assay. They see what their lab can measure.
   Noise is stable per (batch, property) so re-reading is not free precision —
   a bad lab is imprecise, it is not random.

   `live` labs update as the sliders move. Tier 0–1 do NOT: you commit a blend
   and then pay to find out, which is a genuinely different and much tenser
   game. That difference alone is worth more than any percentage bonus. */
export function labRead(assay, seedKey) {
  const t = St.lab();
  if (t.err <= 0) return { ...assay, exact: true, tier: t, shown: ['octane', 'sulfur', 'purity', 'rvp'] };
  const h = hash(String(seedKey || 'x'));
  const n = (i, scale) => (((h >> (i * 6)) & 63) / 63 * 2 - 1) * t.err * scale;
  const shown = ['octane', 'sulfur', 'purity', 'rvp'].slice(0, t.props);
  return {
    exact: false, tier: t, shown,
    volume: assay.volume,
    cost: assay.cost,
    octane: assay.octane + n(1, 1.0),
    sulfur: Math.max(0, assay.sulfur * (1 + n(2, 0.055))),
    purity: Math.max(0, Math.min(100, assay.purity + n(3, 0.42))),
    rvp:    Math.max(0, assay.rvp + n(4, 0.30)),
    err: t.err,
  };
}
function hash(str) { let h = 2166136261; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }

/* Paying for a test. Tier 4 is free and instant; below that a test is a real
   line on the P&L, which is why "just test after every slider nudge" is not a
   strategy until you have bought your way out of it. */
export function runTest(batchOrMix, seedKey) {
  const t = St.lab();
  if (t.fee > 0) {
    if (!St.spend(t.fee, 'Refinery: lab test')) { St.toast('Lab test costs ' + t.fee.toLocaleString() + ' 🔥.', 3000); return null; }
    St.charge('additives', t.fee);
  }
  const a = batchOrMix && batchOrMix.assay ? batchOrMix.assay : assayBench(batchOrMix);
  return labRead(a, seedKey);
}

/* What committing this mix would cost in CASH — i.e. only the litres that are
   not already in the tanks. Shown live on the bench so raising a slider past
   what you hold is visibly a spend, not a free lever. */
export function spotShortfall(mix) {
  const s = St.S();
  let cost = 0; const items = [];
  for (const k in mix) {
    const short = (mix[k] || 0) - St.stock(k);
    if (short <= 1e-6) continue;
    const c = Math.round(short * spotBuyPrice(k, s.marketIndex, isMerchant(k)));
    cost += c;
    items.push({ id: k, litres: Math.ceil(short), cost: c, ok: canSpotBuy(k) });
  }
  return { cost, items };
}

/* ── SPOT PURCHASES ═══════════════════════════════════════════════════════
   The escape hatch, priced so it is an escape and not a habit. */
export function buySpot(id, litres) {
  const s = St.S();
  const c = COMPONENTS[id]; if (!c) return false;
  litres = Math.max(0, Math.round(litres));
  if (litres <= 0) return false;
  if (!canSpotBuy(id)) {
    St.toast('Nobody sells ' + c.name + ' — ' + (GATE_REASON[id] || 'you need the unit that makes it') + '.', 5000);
    return false;
  }
  if (St.storeHeld(s) + litres > St.storeCap(s)) {
    St.toast('🏗️ No product-tank space — build a Product Tank.', 3800); return false;
  }
  const merchant = isMerchant(id);
  const cost = Math.round(spotBuyPrice(id, s.marketIndex, merchant) * litres);
  if (!St.spend(cost, 'Refinery: spot ' + c.name)) { St.toast('That would cost ' + cost.toLocaleString() + ' 🔥.', 3400); return false; }
  St.charge('additives', cost);
  St.addStock(id, litres);
  St.log('info', 'Bought ' + litres.toLocaleString() + ' L ' + c.name + (merchant ? ' from a MERCHANT (no unit of your own) — ' : ' on the spot market — ') + cost.toLocaleString() + ' 🔥.');
  St.save();
  return true;
}
/* Butane and ethanol are commodities anybody will sell you. The rest are
   refinery-gate streams — you can only buy them if you could have made them. */
export const SPOT_ALWAYS = ['butane', 'ethanol', 'naphtha'];
/* ⚠ THE HARD GATES. These are NOT on the merchant market at any price, and the
   reason each one is off it is the reason the matching unit is worth buying.
   Without them the merchant market handed a starting yard a passing blend for
   Jet-Type Kerosene, which made every process unit in the game optional.
     alkylate — an alkylation plant has no spare product. Build the unit.
     hydro    — this is YOUR naphtha with the sulfur taken out. Nobody can sell
                you that; the Hydrotreater is the only route to it, which is
                what makes Diesel, Jet and Premium capability gates rather than
                price gates.
     slopcut  — it is your own failed batch, run back through. Nobody sells
                their failures, and as a purchasable 0.76/L filler it was
                sitting at its 25% cap in nearly every optimal blend.
   Octane, by contrast, IS buyable (reformate, cat gasoline) — expensively.
   That is the deliberate difference: you can pay your way to octane, you
   cannot pay your way out of sulfur. */
export const NEVER_FOR_SALE = ['alkylate', 'hydro', 'slopcut'];
export const GATE_REASON = {
  alkylate: 'an alkylation plant has no spare product — build the unit',
  hydro:    'this is your own naphtha with the sulfur stripped out — only a Hydrotreater makes it',
  slopcut:  'this is your own failed batch reprocessed — nobody sells you theirs',
};
export function canSpotBuy(id) {
  const c = COMPONENTS[id]; if (!c) return false;
  if (NEVER_FOR_SALE.includes(id)) return !!c.unit && (St.S().equip[c.unit] | 0) > 0;
  return true;                       // octane can be bought in, at merchant price
}
/* Are we buying at the refinery gate (we could have made it) or off a merchant
   (we could not)? The difference is 1.38× versus 2.15×, and it is the whole
   economic argument for owning a unit. */
export function isMerchant(id) {
  const c = COMPONENTS[id]; if (!c) return false;
  if (SPOT_ALWAYS.includes(id)) return false;
  return !!(c.unit && (St.S().equip[c.unit] | 0) <= 0);
}
export function priceFor(id) {
  return spotBuyPrice(id, St.S().marketIndex, isMerchant(id));
}

/* Sell ANY stream, not just blend components. The non-gasoline cuts go out at
   the rack; blendstock goes out on the spot market at a haircut. */
export function sellSpot(id, litres) {
  const s = St.S();
  litres = Math.min(St.stock(id), Math.max(0, Math.round(litres)));
  if (litres <= 0) return false;
  const unit = COMPONENTS[id] ? spotSellPrice(id, s.marketIndex) : rackPrice(id, s.marketIndex);
  if (!(unit > 0)) { St.toast('Nobody buys that.', 2600); return false; }
  const gross = Math.round(unit * litres);
  St.takeStock(id, litres);
  St.earn(gross, 'Refinery: spot sale');
  St.charge('revenue', gross);
  const nm = (COMPONENTS[id] || STREAMS[id] || { name: id }).name;
  St.log('info', 'Sold ' + litres.toLocaleString() + ' L ' + nm + ' — ' + gross.toLocaleString() + ' 🔥.');
  // Rack sales are still supply hitting the market, and the price index has to
  // feel them or a player could dump forever with no consequence.
  s.suppliedRecent = (s.suppliedRecent || 0) + litres;
  St.save();
  return true;
}

/* ── CONVERSIONS ══════════════════════════════════════════════════════════
   Running a secondary unit. This is where a Reformer stops being a line on a
   receipt and starts being a thing the player operates. */
export function convert(convId, litres) {
  const s = St.S();
  const cv = CONVERSIONS[convId]; if (!cv) return false;
  if (cv.unit && (s.equip[cv.unit] | 0) <= 0) { St.toast('You do not own the ' + cv.name + ' unit.', 3200); return false; }
  litres = Math.max(0, Math.round(litres));
  const have = St.stock(cv.in);
  if (have + 1e-6 < litres || litres <= 0) { St.toast('Not enough ' + cv.in + ' — you have ' + Math.round(have).toLocaleString() + ' L.', 3400); return false; }

  const kwh = (litres / 1000) * cv.kwh;
  const cost = Math.round(kwh * COSTS.powerPerKwh);
  if (!St.spend(cost, 'Refinery: ' + cv.name)) { St.toast(cv.name + ' needs ' + cost.toLocaleString() + ' 🔥 of power.', 3400); return false; }
  St.charge('power', cost);

  const out = Math.round(litres * cv.yield);
  St.takeStock(cv.in, litres);
  St.addStock(cv.out, out);
  /* Every unit ages when it runs. This is the quiet reason a big yard costs
     more to keep than a small one, and why "buy everything" is not free. */
  if (cv.unit) St.wear(cv.unit, litres / 4200);
  St.log('info', cv.ico + ' ' + cv.name + ': ' + litres.toLocaleString() + ' L → ' + out.toLocaleString() + ' L ' +
    (COMPONENTS[cv.out] ? COMPONENTS[cv.out].name : cv.out) + ' (' + cost.toLocaleString() + ' 🔥 power).');
  St.save();
  return true;
}

/* ── COMMITTING A BATCH ═══════════════════════════════════════════════════
   Draws the mix out of the tanks and writes a numbered batch. From here the
   litres are committed: the only way back is reprocessing. */
export function commitBatch(mix, contract) {
  const s = St.S();
  const vol = Object.values(mix).reduce((a, v) => a + Math.max(0, v || 0), 0);
  if (vol < 100) { St.toast('Nothing in the blend tank.', 2600); return null; }
  if (vol > St.BLEND_TANK_L) { St.toast('⚗️ A blending tank holds ' + St.BLEND_TANK_L.toLocaleString() + ' L.', 3600); return null; }

  /* Anything the tanks cannot cover is BOUGHT, not refused. This is the whole
     escape hatch: a player one component short at the deadline can always
     reach for the spot market, and pay for it. The cost lands on the P&L as an
     additive spend, which is where they will read it back afterwards. */
  const toBuy = [];
  for (const k in mix) {
    const short = mix[k] - St.stock(k);
    if (short > 1e-6) {
      if (!canSpotBuy(k)) {
        St.toast('Nobody will sell you ' + (COMPONENTS[k] ? COMPONENTS[k].name : k) + ' — you need the unit that makes it.', 4200);
        return null;
      }
      toBuy.push([k, Math.ceil(short)]);
    }
  }
  for (const [k, n] of toBuy) if (!buySpot(k, n)) return null;
  for (const k in mix) {
    if (St.stock(k) + 1e-6 < mix[k]) { St.toast('Short on ' + (COMPONENTS[k] ? COMPONENTS[k].name : k) + '.', 3200); return null; }
  }
  for (const k in mix) St.takeStock(k, mix[k]);

  s.batchSeq = (s.batchSeq | 0) + 1;
  const assay = assayBench(mix);
  const batch = {
    id: 'b' + s.batchSeq,
    n: s.batchSeq,
    litres: Math.round(vol),
    mix: { ...mix },
    assay,
    contractId: contract ? contract.id : null,
    targetGrade: contract ? contract.grade : null,
    createdAt: Date.now(),
    tested: false,
  };
  s.batches.push(batch);
  if (contract) contract.batchId = batch.id;
  St.log('info', 'Batch #' + batch.n + ' blended — ' + batch.litres.toLocaleString() + ' L.');
  St.save();
  return batch;
}

/* The four exits. Each one is a real function with a real cost — none of them
   is the "you lose" branch. */

export function grades(batch) {
  // Both sides checked, because a gasoline batch that fails every gasoline
  // grade may still be a legal Utility fuel, and a diesel-side blend has its
  // own ladder. The player is told the best genuine home for the tank.
  return bestGradeFor(batch.assay, false) || bestGradeFor(batch.assay, true);
}

export function verdict(batch, gradeId) {
  const g = GRADES[gradeId || batch.targetGrade] || GRADES.regular;
  const chk = specCheck(batch.assay, g);
  const pass = Object.values(chk).every(x => x.ok);
  const alt = grades(batch);
  return { grade: g, check: chk, pass, alternative: pass ? null : alt };
}

/* FIX — top the tank up with more of something. Returns the new assay so the
   panel can show the effect BEFORE the player commits the Cinder. */
export function previewTopUp(batch, componentId, litres) {
  const mix = { ...batch.mix };
  mix[componentId] = (mix[componentId] || 0) + Math.max(0, litres);
  return { assay: assayBench(mix), mix };
}
export function topUp(batch, componentId, litres) {
  litres = Math.max(0, Math.round(litres));
  if (litres <= 0) return false;
  if (batch.litres + litres > St.BLEND_TANK_L) {
    St.toast('⚗️ That would overflow the blending tank (' + St.BLEND_TANK_L.toLocaleString() + ' L).', 3800); return false;
  }
  if (St.stock(componentId) + 1e-6 < litres) {
    // Offer the spot market rather than a dead end — this is the "add
    // expensive high-octane blendstock" branch of the decision.
    const short = Math.ceil(litres - St.stock(componentId));
    if (!buySpot(componentId, short)) return false;
  }
  St.takeStock(componentId, litres);
  batch.mix[componentId] = (batch.mix[componentId] || 0) + litres;
  batch.litres = Math.round(Object.values(batch.mix).reduce((a, v) => a + v, 0));
  batch.assay = assayBench(batch.mix);
  batch.tested = false;                     // the tank changed — the old test is void
  St.log('info', 'Batch #' + batch.n + ' corrected with ' + litres.toLocaleString() + ' L ' + COMPONENTS[componentId].name + '.');
  St.save();
  return true;
}

/* REPROCESS — the batch goes back through as Reprocessed Slop. You lose 14%
   and some purity but keep most of the volume, which is what stops a failure
   from being a wipe. */
export function reprocess(batch) {
  const s = St.S();
  const cv = CONVERSIONS.reproc;
  const kwh = (batch.litres / 1000) * cv.kwh;
  const cost = Math.round(kwh * COSTS.powerPerKwh);
  if (!St.spend(cost, 'Refinery: reprocessing')) { St.toast('Reprocessing needs ' + cost.toLocaleString() + ' 🔥.', 3400); return false; }
  St.charge('power', cost);
  const out = Math.round(batch.litres * cv.yield);
  St.addStock('slopcut', out);
  removeBatch(batch.id);
  St.log('warn', '🥣 Batch #' + batch.n + ' reprocessed — ' + out.toLocaleString() + ' L recovered as Reprocessed Slop.');
  St.save();
  return true;
}

/* DOWNGRADE — sell the tank as whatever it genuinely IS. No lying to the
   customer; the grade is the grade the assay passes. */
export function downgradeSell(batch) {
  const s = St.S();
  const g = grades(batch);
  if (!g) { St.toast('This will not pass as any grade. It is slop.', 3600); return false; }
  const gross = Math.round(batch.litres * g.pricePerL * s.marketIndex * 0.78);   // spot, not contract
  St.earn(gross, 'Refinery: downgraded batch');
  St.charge('revenue', gross);
  s.suppliedRecent = (s.suppliedRecent || 0) + batch.litres;
  removeBatch(batch.id);
  St.log('warn', '↘ Batch #' + batch.n + ' sold down as ' + g.name + ' — ' + gross.toLocaleString() + ' 🔥.');
  St.save();
  return true;
}

/* DUMP — the expensive exit. Disposal costs money, and pouring bad product
   away is the one thing that dents the QUALITY axis, because that is the
   axis that is really about what leaves your gate. */
export function scrap(batch) {
  const cost = Math.round(batch.litres * COSTS.slopDisposalPerL);
  St.spend(cost, 'Refinery: disposal');
  St.charge('disposal', cost);
  St.nudgeRep('quality', -2.5);
  removeBatch(batch.id);
  St.log('bad', '🗑 Batch #' + batch.n + ' dumped to slop — ' + cost.toLocaleString() + ' 🔥 disposal.');
  St.save();
  return true;
}

export function removeBatch(id) {
  const s = St.S();
  const i = s.batches.findIndex(b => b.id === id);
  if (i >= 0) s.batches.splice(i, 1);
  for (const c of s.contracts) if (c.batchId === id) c.batchId = null;
}

/* ── APPROVAL ═════════════════════════════════════════════════════════════
   Signing off a batch against a contract. This is the ONLY place quality
   reputation moves upward, and it moves on the MARGIN by which the batch beat
   the spec — scraping a 87.0 past an 87 minimum is a pass, not a triumph. */
export function approve(batch, contract) {
  const g = GRADES[contract.grade] || GRADES.regular;
  const v = verdict(batch, contract.grade);
  if (!v.pass) {
    St.toast('❌ Batch #' + batch.n + ' is off-spec for ' + g.name + '. Correct it, reprocess it, or sell it down.', 5200);
    return false;
  }
  if (batch.litres + 1 < contract.litres) {
    St.toast('Contract needs ' + contract.litres.toLocaleString() + ' L — the tank holds ' + batch.litres.toLocaleString() + ' L.', 4400);
    return false;
  }
  batch.approved = true;
  batch.approvedGrade = g.id;

  /* Margin over spec, 0..1, averaged across the properties that apply. A
     comfortable beat earns quality reputation; a knife-edge pass earns almost
     nothing, which is the incentive to actually be good at this rather than
     merely legal. */
  const m = [];
  if (g.octaneMin > 0) m.push(clamp01((batch.assay.octane - g.octaneMin) / 5));
  m.push(clamp01((g.sulfurMax - batch.assay.sulfur) / Math.max(1, g.sulfurMax * 0.6)));
  m.push(clamp01((batch.assay.purity - g.purityMin) / 3));
  if (g.rvpMax < 90) m.push(clamp01((g.rvpMax - batch.assay.rvp) / 3));
  const margin = m.reduce((a, x) => a + x, 0) / Math.max(1, m.length);
  St.nudgeRep('quality', -0.6 + margin * 5.2);

  St.log('good', '✅ Batch #' + batch.n + ' approved for ' + g.name + ' (' + Math.round(margin * 100) + '% over spec).');
  St.save();
  return true;
}
function clamp01(v) { return Math.max(0, Math.min(1, v)); }

/* ── THE HELPER THE BENCH ACTUALLY NEEDS ══════════════════════════════════
   "What is the cheapest thing I can add to make this pass?" — computed, not
   guessed, and shown as a HINT the player can ignore. It exists because the
   alternative is a player who bounces off the blend stage never learning that
   reformate and ethanol solve different problems.

   Deliberately NOT an auto-solve button: it names one component and the
   litres, and it does not tell you whether you can afford the consequence. */
export function suggestFix(batch, gradeId) {
  const g = GRADES[gradeId || batch.targetGrade] || GRADES.regular;
  const v = verdict(batch, g.id);
  if (v.pass) return null;
  const s = St.S();
  const room = St.BLEND_TANK_L - batch.litres;
  if (room < 50) return { text: 'The tank is full. Reprocess or sell this down — there is no room to correct it.' };

  /* Search every component, INCLUDING ones this yard cannot make. A locked
     answer is still an answer: telling a player "1,900 L of Reformate would
     land this, and a Catalytic Reformer is what makes Reformate" is how the
     upgrade tree teaches itself. Reachable fixes always outrank locked ones. */
  const buyable = (id) => COMPONENTS[id].unit == null || (s.equip[COMPONENTS[id].unit] | 0) > 0 || SPOT_ALWAYS.includes(id);
  let best = null, locked = null;

  for (const c of availableComponents()) {
    // Integer steps: a float accumulator drifts and silently clipped the top
    // of this range, which is what hid a perfectly good reformate fix.
    for (let step = 1; step <= 40; step++) {
      const frac = step * 0.02;                    // 2% … 80% of the current tank
      const add = Math.min(room, batch.litres * frac);
      if (add < 40) continue;
      const cand = { ...batch.mix };
      cand[c.id] = (cand[c.id] || 0) + add;
      const total = Object.values(cand).reduce((a, x) => a + x, 0);
      // Respect the legal blend caps — suggesting 30% ethanol would be a trap.
      if (COMPONENTS[c.id].cap && cand[c.id] / total > COMPONENTS[c.id].cap) break;
      const a = assayBench(cand);
      if (!Object.values(specCheck(a, g)).every(x => x.ok)) continue;

      const reachable = c.buyable;
      const shortfall = Math.max(0, add - c.have);
      const cost = Math.round(shortfall * spotBuyPrice(c.id, s.marketIndex, c.merchant));
      const hit = { id: c.id, name: c.name, ico: c.ico, litres: Math.round(add), cost,
                    fromStock: Math.round(add - shortfall), reachable, lockedBy: c.lockedBy };
      if (reachable) { if (!best || cost < best.cost) best = hit; }
      else if (!locked || cost < locked.cost) locked = hit;
      break;   // smallest passing dose of THIS component; no point going bigger
    }
  }
  if (best) return best;
  if (locked) {
    return { ...locked, text: locked.litres.toLocaleString() + ' L of ' + locked.name + ' would land this batch — but ' +
             locked.name + ' only exists if you own a ' + (locked.lockedBy || 'secondary unit') + '.' };
  }
  /* No top-up works. That is usually not bad luck — it is a decision made
     upstream, and saying WHICH one is the difference between a lesson and a
     mystery. Dilution cannot rescue a badly sour tank (the arithmetic below
     is the same one the loop above just failed), so name the route that
     would have: treat the stream before it goes in the tank. */
  const g2 = specCheck(batch.assay, g);
  const alt = grades(batch);
  const tail = ' Reprocess it, or sell it down as ' + (alt ? alt.name : 'slop') + '.';
  if (!g2.sulfur.ok) {
    const owns = (St.S().equip.treater | 0) > 0;
    return { text: 'Nothing in reach fixes this batch — at ' + Math.round(batch.assay.sulfur) +
      ' ppm you would need more clean stock than the tank can hold. Sulfur is carried in by the CRUDE, so it has to come out before blending: ' +
      (owns ? 'hydrotreat your naphtha on the Stock tab, then blend.' : 'a Hydrotreater is the unit that does it.') + tail };
  }
  if (!g2.stability.ok) {
    return { text: 'Nothing in reach fixes this batch — vapour pressure is ' + batch.assay.rvp.toFixed(1) +
      ' psi against a ' + g.rvpMax + ' psi limit. Butane is almost always the cause; it blends on an index, not by volume, so a small slug of it dominates.' + tail };
  }
  return { text: 'Nothing in reach fixes this batch.' + tail };
}
function clamp01_unused() {}


/* Per-litre sale price for anything in the tank farm — components at the spot
   haircut, streams at the rack. One function so the Stock tab and sellSpot()
   can never quote the player two different numbers. */
export function sellUnitPrice(id) {
  const s = St.S();
  return COMPONENTS[id] ? spotSellPrice(id, s.marketIndex) : rackPrice(id, s.marketIndex);
}
