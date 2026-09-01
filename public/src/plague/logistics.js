/* ══════════════════════════════════════════════════════════════════════════
   🚚 LOGISTICS — a cure is worthless in the room it was made in.
   ──────────────────────────────────────────────────────────────────────────
   A finished batch cannot be administered from the bench. It has to be moved,
   by a PLAYER-OWNED Transportation Company (the `transport` operation), to a
   PLAYER-OWNED Medical Corporation (the `medical` operation) that can actually
   put it into people. Two other players get paid on every dose that works.

   🔴 WHY THE MIDDLEMAN IS NOT A TAX. A shipping step that only subtracts
   Cinder is a toll booth, and players route around toll booths. This one can
   CHANGE THE CARGO: a cure is a cold chain, and a cheap carrier breaks it.
   Integrity lost in transit lands on the same `stability` number the bench
   work produced, which means a batch that was a VIABLE CURE at dispatch can
   arrive IATROGENIC and spawn a strain at the far end. The carrier you hire is
   a real decision about the product, so the transport player is a supplier,
   not a fee.

   🔴 ALL PRICING GOES THROUGH `_opEcon()` (CLAUDE.md). Not one Cinder figure
   is written here. The host hands over `opEcon(type)` and every rate is
   derived from the live table, so an admin retune of `transport` reaches the
   shipping quotes the same tick it reaches the operation itself.

   ⚠ OFFLINE IS A FIRST-CLASS STATE. Every Supabase call is guarded and every
   one of them has a local fallback: an unsigned-in player ships to their OWN
   labs through the local mirror and the feature is whole, just solitary. The
   tables not existing yet must look exactly like nobody being online.
   ══════════════════════════════════════════════════════════════════════════ */

import { rngFrom, hash32 } from './strains.js';
import { gradeOf, GRADES } from './cures.js';

export const V = 1;

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/* ── the cold chain ────────────────────────────────────────────────────────
   How much INTEGRITY a shipment keeps, 0..1. Everything here is a ratio
   against the operation's own econ row, never an absolute number.

     staffing   workers / maxWorkers — an unstaffed carrier has no night driver
     level      the operation's level, the owner's investment
     distance   how far the cargo has to go (set by the caller; 1 = across town)
     volatility the batch's own fragility — an unstable batch travels badly

   🔴 A FULLY-STAFFED CARRIER IS NOT PERFECT, and must not be. If integrity
   could reach 1.0 the whole cold chain becomes a solved problem the moment one
   player maxes an op, and every shipment after that is a formality. The
   ceiling is 0.97 so packaging (see `coldPack`) always has something to buy. */
export function integrityOf(carrier, opts) {
  const o = opts || {};
  const econ = o.econ || {};
  const maxW = Math.max(1, econ.maxWorkers | 0 || 1);
  const staffing = clamp((carrier && carrier.workers | 0) / maxW, 0, 1);
  const level = clamp(((carrier && carrier.level | 0) || 1), 1, 10);
  const distance = clamp(+o.distance || 1, 0.5, 4);
  const volatility = clamp(1 - (+o.stability || 50) / 100, 0, 1);

  let i = 0.42                       // an unstaffed level-1 carrier is genuinely bad
    + staffing * 0.34
    + (level - 1) * 0.035
    + (o.coldPack ? 0.10 : 0);
  i -= (distance - 1) * 0.09;
  i -= volatility * 0.16;
  return +clamp(i, 0.05, 0.97).toFixed(3);
}

/* Quote a shipment. Cinder only, all of it derived from the carrier's econ row.

   The fee is the carrier's hourly revenue rate for the crew the job needs,
   over the hours the job takes — i.e. what the operation would have earned
   doing something else. That is the honest price of the truck, and it means a
   better carrier costs more without a single hardcoded multiplier. */
export function quote(carrier, opts) {
  const o = opts || {};
  const econ = o.econ || {};
  const rate = Math.max(0, +econ.ratePerWorkerHr || 0);
  const salary = Math.max(0, +econ.salaryPerWorkerHr || 0);
  const distance = clamp(+o.distance || 1, 0.5, 4);
  const doses = Math.max(1, o.doses | 0);

  // Crew: one driver per 40 doses, at least two, never more than the op holds.
  const maxW = Math.max(1, econ.maxWorkers | 0 || 1);
  const crew = clamp(Math.ceil(doses / 40) + 1, 2, maxW);
  const hours = +clamp(2 * distance, 1, 12).toFixed(2);

  const gross = Math.round((rate + salary) * crew * hours);
  const coldPackFee = o.coldPack ? Math.round(gross * 0.35) : 0;
  return {
    crew, hours, distance, doses,
    coldPack: !!o.coldPack,
    fee: Math.max(0, gross + coldPackFee),
    baseFee: gross,
    coldPackFee,
    etaMs: Math.round(hours * 3600000),
    integrity: integrityOf(carrier, { econ, distance, stability: o.stability, coldPack: o.coldPack }),
    /* 💊 The lab's cut of every dose that lands, as a SHARE not a number — the
       medical op's own rate decides what that is worth. Payable to the lab
       owner on arrival; see settle(). */
    labShare: 0.18,
  };
}

/* ── arrival ═══════════════════════════════════════════════════════════════
   Re-grade the batch AFTER the drive. This is the whole point of the middle
   leg: `stability` is reduced by whatever the cold chain lost, and gradeOf()
   is the SAME function the bench used, so a batch that crosses the iatrogenic
   threshold in a truck is described identically to one that was born there.

   `roll` is deterministic from the shipment id — a player who reloads mid-
   shipment must not be able to reroll their carrier's competence. */
export function arrive(shipment, formulation) {
  const f = formulation || {};
  const integ = clamp(+shipment.integrity || 0.5, 0, 1);
  const r = rngFrom('ship:' + (shipment.id || 'x'))();

  /* Loss is the integrity shortfall, dramatised by one seeded roll. The roll
     spans 0.5..1.5 of the expected loss so a good carrier is reliably good and
     a bad one is unreliably bad — variance where it belongs. */
  const expected = (1 - integ) * 55;
  const lost = Math.round(expected * (0.5 + r));
  const stability = clamp((+f.stability || 0) - lost, 0, 100);
  const purity = clamp((+f.purity || 0) - Math.round(lost * 0.4), 0, 100);

  // Doses spoil in proportion to what the chain lost.
  const doses = Math.max(0, Math.round((+f.doses || 0) * clamp(integ + 0.1, 0, 1)));

  const contaminated = !!f.contaminated || stability < 30;
  let risk = clamp((+f.risk || 0) + (1 - integ) * 0.35, 0, 0.98);
  const arrived = Object.assign({}, f, { stability, purity, doses, contaminated, risk });
  arrived.grade = gradeOf(arrived);

  const broke = arrived.grade.key === 'iatrogenic' && (f.grade && f.grade.key !== 'iatrogenic');
  return {
    arrived,
    lost, dosesLost: Math.max(0, (+f.doses || 0) - doses),
    coldChainBroken: broke,
    note: broke
      ? '🧊 THE COLD CHAIN BROKE. What left the lab was a cure. What arrived is not.'
      : lost > 18 ? '🧊 The chain slipped — the batch arrived weaker than it left.'
      : '🧊 Chain held. The batch arrived as dispatched.',
  };
}

/* ── settlement ────────────────────────────────────────────────────────────
   Who gets paid, and out of what. Returned as a PLAN the caller executes, so
   this file never touches a balance — the same discipline /src/trading uses,
   and the reason a failed leg can be unwound.

   🔴 THE CARRIER IS PAID FOR THE DRIVE, NOT FOR THE RESULT. A carrier who
   breaks the cold chain still gets their fee; what they lose is reputation
   (`rating`), which is what the shipper reads next time. Paying carriers on
   outcome would make hauling an unstable batch uninsurable and nobody would
   ever take the interesting job. */
export function settle(shipment, result) {
  const fee = Math.max(0, shipment.fee | 0);
  const doses = Math.max(0, (result.arrived && result.arrived.doses) | 0);
  const labCut = Math.round(fee * clamp(+shipment.labShare || 0.18, 0, 0.5));
  return {
    payCarrier: fee,
    payLab: labCut,
    // What the shipper is left holding. Never negative; a total loss is 0.
    dosesDelivered: doses,
    ratingDelta: result.coldChainBroken ? -2 : result.lost > 18 ? -1 : +1,
  };
}

/* ── carrier discovery ─────────────────────────────────────────────────────
   Player-owned `transport` operations, ranked. The host supplies both halves:
   `remoteCarriers()` (other players', from Supabase) and `localOps()` (the
   player's own rows from BOTH corp_operations and the Profile mirror — the
   same pair _warehouseCapacity walks).

   🔴 IT NEVER INVENTS A CARRIER. If nothing comes back, the caller says "no
   carriers are running" and offers the player the door to found one. A
   synthetic NPC haulier would quietly kill the market this feature exists to
   create — the whole ask was that a PLAYER owns the trucks. */
export function rankCarriers(list, opts) {
  const o = opts || {};
  const econ = o.econ || {};
  return (list || [])
    .filter((c) => c && c.op_type === 'transport' && (c.status || 'active') === 'active')
    .map((c) => {
      const q = quote(c, Object.assign({}, o, { econ }));
      return {
        id: c.id,
        corpId: c.corp_id || null,
        ownerName: c.owner_name || c.corp_name || 'Independent',
        name: c.name || (c.corp_name ? c.corp_name + ' Haulage' : 'Unnamed Haulage'),
        workers: c.workers | 0,
        level: c.level | 0 || 1,
        mine: !!c.mine,
        rating: Number.isFinite(+c.rating) ? +c.rating : null,
        quote: q,
      };
    })
    .sort((a, b) => b.quote.integrity - a.quote.integrity || a.quote.fee - b.quote.fee);
}

/* Player-owned Medical Corporations that can receive a batch. Same rules:
   real rows only, never a fabricated destination. A lab's `capacity` is
   derived from its econ row so a bigger lab genuinely takes bigger shipments. */
export function rankLabs(list, opts) {
  const o = opts || {};
  const econ = o.econ || {};
  const maxW = Math.max(1, econ.maxWorkers | 0 || 1);
  return (list || [])
    .filter((l) => l && l.op_type === 'medical' && (l.status || 'active') === 'active')
    .map((l) => {
      const staffing = clamp((l.workers | 0) / maxW, 0, 1);
      return {
        id: l.id,
        corpId: l.corp_id || null,
        ownerName: l.owner_name || l.corp_name || 'Independent',
        name: l.name || (l.corp_name ? l.corp_name + ' Medical' : 'Unnamed Medical'),
        workers: l.workers | 0,
        level: l.level | 0 || 1,
        mine: !!l.mine,
        // Doses a lab can put into people per shipment. Staffing is the gate:
        // an empty lab receives the crate and cannot open it.
        capacity: Math.max(20, Math.round(40 * (l.level | 0 || 1) * (0.4 + staffing))),
        staffing: +staffing.toFixed(2),
        /* 🏥 A lab with nobody in it does not administer. The batch sits.
           This is the medical player's job, and it is the hook the Medical
           Corporation minigame will hang on. */
        canAdminister: staffing > 0.05,
      };
    })
    .sort((a, b) => b.capacity - a.capacity);
}

export function newShipment(o) {
  const at = Date.now();
  const id = 'shp_' + hash32(String(o.batchId) + ':' + at + ':' + String(o.carrierId)).toString(36) + at.toString(36).slice(-4);
  return {
    v: V,
    id,
    batchId: o.batchId,
    strainId: o.strainId || null,
    carrierId: o.carrierId, carrierName: o.carrierName || 'Unnamed Haulage', carrierCorpId: o.carrierCorpId || null,
    labId: o.labId, labName: o.labName || 'Unnamed Medical', labCorpId: o.labCorpId || null,
    fee: o.fee | 0, labShare: +o.labShare || 0.18,
    integrity: +o.integrity || 0.5,
    coldPack: !!o.coldPack,
    doses: o.doses | 0,
    distance: +o.distance || 1,
    status: 'in_transit',
    dispatchedAt: at,
    arrivesAt: at + (o.etaMs | 0),
    settledAt: null,
    result: null,
  };
}

export function isDue(s) { return !!s && s.status === 'in_transit' && Date.now() >= (s.arrivesAt || 0); }

export function etaText(s) {
  if (!s) return '';
  if (s.status !== 'in_transit') return s.status === 'delivered' ? 'delivered' : String(s.status);
  const ms = Math.max(0, (s.arrivesAt || 0) - Date.now());
  if (ms <= 0) return 'arriving';
  const m = Math.round(ms / 60000);
  return m >= 60 ? Math.floor(m / 60) + 'h ' + (m % 60) + 'm' : m + 'm';
}
