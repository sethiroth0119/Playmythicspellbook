/* ══════════════════════════════════════════════════════════════════════════
   💾 PLAGUE STATE — the ONE place that spends, credits, saves and talks to
   Supabase. Everything else in /src/plague is pure.
   ──────────────────────────────────────────────────────────────────────────
   🔴 THE GLOBALS TRAP (CLAUDE.md). `Profile`, `Cloud`, `Corp`, `RESOURCES`
   and every helper this file needs are top-level `const` in index.html —
   global LEXICAL bindings that are NOT on `window`. This module reads NOTHING
   by itself. index.html hands over `window.MythicPlagueBridge`; if it is
   absent every function here returns a refusal and the feature is inert.
   Do not reach for a bare global and do not assume `window.Profile` exists.

   🔴 LEDGERS ARE APPEND-ONLY (CLAUDE.md). `batches` and `shipments` are
   records of things that happened; a settled shipment is never edited back
   into "in transit" and a spent batch is marked, not deleted. Balance-shaped
   questions ("how many doses do I have") are answered by summing, never by
   maintaining a counter that can drift.

   🔴 EVERY SUPABASE CALL IS GUARDED AND FALLS BACK TO LOCAL. The tables not
   existing yet must be indistinguishable from being offline. A player who
   never signs in can still catch a virus, cure it, hire their own transport
   op and ship to their own lab — the multiplayer part is the market, not the
   mechanic.
   ══════════════════════════════════════════════════════════════════════════ */

import { makeStrain, describe } from './strains.js';
import { formulate, administer, mixCost, GRADES } from './cures.js';
import * as OB from './outbreak.js';
import * as LG from './logistics.js';

export const V = 1;

/* Corp operations have uuid ids; personally-funded ops on the profile do not
   ('local_1712…', 'company_medical'). The distinction decides what may be
   filed in the server payout ledger — see settleWaybill. */
const IS_UUID = /^[0-9a-fA-F-]{36}$/;

/* The null bridge. Same pattern as community.bridge.js: the module can be
   imported, rendered and unit-tested with no game at all, and every consumer
   is written against this exact shape. */
const NULL_BRIDGE = {
  signedIn: () => false,
  userId: () => null,
  displayName: () => 'Survivor',
  client: () => null,
  getRes: () => 0,
  spendRes: () => false,
  addRes: () => false,
  refundRes: () => false,
  resources: () => [],
  gems: () => 0,
  spendGems: () => false,
  addGems: () => {},
  opEcon: () => null,
  myOps: () => [],
  myCorp: () => null,
  plagueState: () => null,
  setPlagueState: () => false,
  save: () => false,
  toast: (m) => { try { console.log('[plague]', m); } catch (e) {} },
  confirm: async () => false,
  _null: true,
};

export function bridge() {
  try {
    const b = (typeof window !== 'undefined') && window.MythicPlagueBridge;
    return (b && typeof b.getRes === 'function') ? b : NULL_BRIDGE;
  } catch (e) { return NULL_BRIDGE; }
}
export function ready() { return !bridge()._null; }

/* ── the save blob ─────────────────────────────────────────────────────────
   One object on the profile. `outbreak` is the city-side model (outbreak.js
   owns its shape), `batches` and `shipments` are the two append-only ledgers,
   and `lab` is the 3D minigame's own progress. Version-stamped so a future
   migration has something to branch on. */
function emptyBlob() {
  return { v: V, outbreak: OB.emptyState(), batches: [], shipments: [], lab: { runs: 0, bestPurity: 0, suitOns: 0, breaches: 0 } };
}

let CACHE = null;

export function blob() {
  if (CACHE) return CACHE;
  const B = bridge();
  let raw = null;
  try { raw = B.plagueState(); } catch (e) { raw = null; }
  const b = emptyBlob();
  if (raw && typeof raw === 'object') {
    try {
      b.outbreak = OB.normalise(raw.outbreak);
      if (Array.isArray(raw.batches)) b.batches = raw.batches.filter((x) => x && x.id).slice(-120);
      if (Array.isArray(raw.shipments)) b.shipments = raw.shipments.filter((x) => x && x.id).slice(-120);
      if (raw.lab && typeof raw.lab === 'object') b.lab = Object.assign(b.lab, raw.lab);
    } catch (e) {}
  }
  CACHE = b;
  return b;
}

export function persist() {
  const B = bridge();
  try {
    if (B.setPlagueState(blob()) === false) return false;
    return B.save() !== false;
  } catch (e) { return false; }
}

export function resetCache() { CACHE = null; }

/* ══ THE CITY SIDE ═════════════════════════════════════════════════════════
   `cityTick` is what node-city's adapter calls. It is the only path that
   advances the outbreak, and it persists only when something actually
   happened — a tick that changes nothing must not churn the save. */
export function cityTick(host, dtMs) {
  const b = blob();
  const r = OB.tick(host, b.outbreak, dtMs);
  if (r.events && r.events.length) persist();
  return r;
}

export function cityReport(host) { return OB.report(host, blob().outbreak); }
export function outbreakState() { return blob().outbreak; }
export function strains() { return blob().outbreak.strains.slice(); }
export function activeStrains() { return OB.activeStrains(blob().outbreak); }

/* Seeding a strain by hand. Admin/testing seam and the door the Medical
   Corporation minigame will use to import a strain another player is fighting.
   It goes through the same introduce() the wild path does. */
export function seedStrain(host, opts) {
  const b = blob();
  const s = makeStrain((opts && opts.seed) || ('manual:' + Date.now()), opts || {});
  OB.introduce(host, b.outbreak, s, (opts && opts.cases) || 2, (opts && opts.why) || 'introduced');
  persist();
  return s;
}

/* ══ THE LAB SIDE ══════════════════════════════════════════════════════════
   `craftBatch` is the ONE function that turns lab work into a real object,
   and it is the only place in the feature that spends resources.

   🔴 THE ORDER IS SPEND → RECORD → REFUND-ON-FAILURE, and it is that way
   because this codebase has already shipped the other order and charged a
   player 50,000 Cinder for a building that never persisted (see the note in
   /src/city/index.js's host adapter). Every spend is tracked so a failure at
   the record step can put every unit back through refundRes — which is
   UNCAPPED precisely so an undo cannot be eaten by the stash cap. */
export function craftBatch(strainId, mix, craft) {
  const B = bridge();
  if (!ready()) return { ok: false, why: 'no-bridge', error: 'The lab is not connected to the game.' };

  const b = blob();
  const strain = OB.strainById(b.outbreak, strainId);
  if (!strain) return { ok: false, why: 'no-strain', error: 'That strain is not in the register.' };

  const cost = mixCost(mix);
  const ids = Object.keys(cost);
  if (!ids.length) return { ok: false, why: 'empty', error: 'The vessel is empty.' };

  // ── affordability, checked before a single unit moves.
  const short = {};
  for (const id of ids) {
    const have = B.getRes(id) | 0;
    if (have < cost[id]) short[id] = cost[id] - have;
  }
  if (Object.keys(short).length) return { ok: false, why: 'short', shortfall: short, error: 'Not enough reagents.' };

  const spent = [];
  try {
    for (const id of ids) {
      if (!B.spendRes(id, cost[id])) throw new Error('spend failed: ' + id);
      spent.push([id, cost[id]]);
    }
  } catch (e) {
    for (const [id, n] of spent) { try { B.refundRes(id, n); } catch (e2) {} }
    return { ok: false, why: 'spend', error: 'The reagent draw failed — nothing was taken.' };
  }

  const f = formulate(strain, mix, craft);
  const at = Date.now();
  const batch = {
    v: V,
    id: 'bch_' + (at.toString(36) + Math.abs(hashMix(mix)).toString(36)).slice(-10),
    strainId: strain.id,
    strainName: strain.name,
    strainIsolate: strain.isolate,
    mix: Object.assign({}, cost),
    at,
    // The formulation is stored WHOLE. Re-deriving it later would let a
    // reagent retune silently rewrite a batch the player already made.
    f: {
      efficacy: f.efficacy, potency: f.potency, purity: f.purity, stability: f.stability,
      doses: f.doses, risk: f.risk, contaminated: f.contaminated,
      grade: f.grade.key, lean: f.lean, blend: f.blend, warnings: f.warnings, craft: f.craft,
    },
    status: 'held',        // held → shipped → delivered → administered | destroyed
    shipmentId: null,
  };

  try {
    b.batches.push(batch);
    if (b.batches.length > 120) b.batches.splice(0, b.batches.length - 120);
    b.lab.runs = (b.lab.runs | 0) + 1;
    b.lab.bestPurity = Math.max(b.lab.bestPurity | 0, f.purity | 0);
    if (f.craft && f.craft.sealed) b.lab.suitOns = (b.lab.suitOns | 0) + 1;
    if (f.craft && f.craft.exposure > 0.12) b.lab.breaches = (b.lab.breaches | 0) + 1;
    if (!persist()) throw new Error('persist failed');
  } catch (e) {
    // 🔴 The refund path this ordering exists for. Put the batch back out of
    // the ledger too, so a half-written save cannot leave a phantom crate.
    try { const i = b.batches.indexOf(batch); if (i >= 0) b.batches.splice(i, 1); } catch (e2) {}
    for (const [id, n] of spent) { try { B.refundRes(id, n); } catch (e2) {} }
    return { ok: false, why: 'persist', error: 'The batch would not record — your reagents were returned.' };
  }

  return { ok: true, batch, formulation: f };
}

function hashMix(mix) {
  let h = 2166136261 >>> 0;
  const s = JSON.stringify(mix || {});
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return h | 0;
}

export function batches() { return blob().batches.slice().reverse(); }
export function batchById(id) { for (const x of blob().batches) if (x && x.id === id) return x; return null; }
export function heldBatches() { return blob().batches.filter((x) => x && x.status === 'held').reverse(); }

export function destroyBatch(id) {
  const b = batchById(id);
  if (!b || b.status !== 'held') return false;
  /* Append-only means a destroyed batch is MARKED, not spliced out. The
     player's mistakes are the record; deleting them would make the incident
     log lie about how a strain got loose. */
  b.status = 'destroyed';
  b.destroyedAt = Date.now();
  persist();
  return true;
}

/* ══ THE SHIPPING SIDE ═════════════════════════════════════════════════════
   Carriers and labs come from real operation rows. `fetchMarket` merges the
   player's own ops (always available, even offline) with other players' ops
   from Supabase (best effort, silently empty on any failure). */
export async function fetchMarket(opts) {
  const B = bridge();
  const mine = [];
  try {
    for (const o of (B.myOps() || [])) {
      if (!o || !o.op_type) continue;
      if (o.op_type !== 'transport' && o.op_type !== 'medical') continue;
      mine.push(Object.assign({}, o, {
        mine: true,
        owner_name: B.displayName(),
        corp_name: (B.myCorp() && B.myCorp().name) || null,
      }));
    }
  } catch (e) {}

  let remote = [];
  try {
    const c = B.client();
    if (c && B.signedIn()) {
      const uid = B.userId();
      const r = await c.from('plague_carriers')
        .select('op_id, corp_id, owner_id, owner_name, corp_name, op_type, level, workers, status, rating')
        .in('op_type', ['transport', 'medical'])
        .eq('status', 'active')
        .limit(80);
      if (r && !r.error && Array.isArray(r.data)) {
        remote = r.data
          .filter((x) => x && x.owner_id !== uid)      // own rows already merged above
          .map((x) => ({
            id: x.op_id, corp_id: x.corp_id, op_type: x.op_type,
            level: x.level | 0 || 1, workers: x.workers | 0, status: x.status || 'active',
            owner_name: x.owner_name || 'Survivor', corp_name: x.corp_name || null,
            rating: Number.isFinite(+x.rating) ? +x.rating : null, mine: false,
          }));
      }
    }
  } catch (e) { remote = []; }

  const all = mine.concat(remote);
  const o = opts || {};
  return {
    carriers: LG.rankCarriers(all, Object.assign({}, o, { econ: B.opEcon('transport') || {} })),
    labs: LG.rankLabs(all, Object.assign({}, o, { econ: B.opEcon('medical') || {} })),
    online: !!(B.signedIn() && B.client()),
  };
}

/* Hire a carrier and dispatch. Cinder leaves the shipper here; the carrier is
   credited on ARRIVAL (see collect) so a shipment in flight is real money at
   risk on both sides. */
export function dispatch(batchId, carrier, lab, opts) {
  const B = bridge();
  if (!ready()) return { ok: false, error: 'The dispatch bay is not connected to the game.' };
  const b = blob();
  const batch = batchById(batchId);
  if (!batch) return { ok: false, error: 'No such batch.' };
  if (batch.status !== 'held') return { ok: false, error: 'That batch has already left the bay.' };
  if (!carrier || !carrier.id) return { ok: false, error: 'No carrier chosen.' };
  if (!lab || !lab.id) return { ok: false, error: 'No receiving lab chosen.' };
  if (carrier.id === lab.id) return { ok: false, error: 'A carrier cannot also be the receiving lab.' };

  const o = opts || {};
  const q = LG.quote(carrier, {
    econ: B.opEcon('transport') || {},
    doses: batch.f.doses, distance: o.distance || (carrier.mine ? 1 : 2),
    stability: batch.f.stability, coldPack: !!o.coldPack,
  });
  if (q.fee > (B.gems() | 0)) return { ok: false, error: 'Not enough Cinder for the haul (' + q.fee.toLocaleString() + ' 🔥 needed).' };
  if (batch.f.doses > lab.capacity) {
    return { ok: false, error: lab.name + ' can only take ' + lab.capacity + ' doses this run — split the batch or find a bigger lab.' };
  }

  if (!B.spendGems(q.fee)) return { ok: false, error: 'The payment did not go through.' };

  const ship = LG.newShipment({
    batchId: batch.id, strainId: batch.strainId,
    carrierId: carrier.id, carrierName: carrier.name, carrierCorpId: carrier.corpId,
    labId: lab.id, labName: lab.name, labCorpId: lab.corpId,
    fee: q.fee, labShare: q.labShare, integrity: q.integrity, coldPack: q.coldPack,
    doses: batch.f.doses, distance: q.distance, etaMs: q.etaMs,
  });

  try {
    b.shipments.push(ship);
    if (b.shipments.length > 120) b.shipments.splice(0, b.shipments.length - 120);
    batch.status = 'shipped';
    batch.shipmentId = ship.id;
    if (!persist()) throw new Error('persist failed');
  } catch (e) {
    batch.status = 'held'; batch.shipmentId = null;
    try { const i = b.shipments.indexOf(ship); if (i >= 0) b.shipments.splice(i, 1); } catch (e2) {}
    try { B.addGems(q.fee); } catch (e2) {}          // undo the fee — the haul never happened
    return { ok: false, error: 'The waybill would not record — your Cinder was returned.' };
  }

  // Best-effort public record. A failure here costs the carrier their payout
  // notification and nothing else — the shipment is already real locally.
  pushWaybill(ship, batch).catch(() => {});
  return { ok: true, shipment: ship, quote: q };
}

async function pushWaybill(ship, batch) {
  const B = bridge();
  try {
    const c = B.client();
    if (!c || !B.signedIn()) return;
    await c.from('cure_shipments').insert({
      shipment_id: ship.id,
      shipper_id: B.userId(),
      shipper_name: B.displayName(),
      carrier_op_id: String(ship.carrierId),
      carrier_corp_id: ship.carrierCorpId,
      lab_op_id: String(ship.labId),
      lab_corp_id: ship.labCorpId,
      strain_id: ship.strainId,
      strain_name: batch.strainName,
      doses: ship.doses,
      fee: ship.fee,
      integrity: ship.integrity,
      grade: batch.f.grade,
      status: 'in_transit',
      arrives_at: new Date(ship.arrivesAt).toISOString(),
    });
  } catch (e) {}
}

export function shipments() { return blob().shipments.slice().reverse(); }
export function inTransit() { return blob().shipments.filter((s) => s && s.status === 'in_transit').reverse(); }
export function dueShipments() { return blob().shipments.filter(LG.isDue); }

/* ══ COLLECT — arrival, administration, and the moment a bad cure becomes a
   virus. This is the payoff of the whole chain and the one function that can
   introduce an iatrogenic strain into the city. ═══════════════════════════ */
export function collect(host, shipmentId) {
  const B = bridge();
  const b = blob();
  const ship = b.shipments.find((s) => s && s.id === shipmentId);
  if (!ship) return { ok: false, error: 'No such shipment.' };
  if (ship.status !== 'in_transit') return { ok: false, error: 'Already settled.' };
  if (!LG.isDue(ship)) return { ok: false, error: 'Still on the road — ' + LG.etaText(ship) + ' out.' };

  const batch = batchById(ship.batchId);
  if (!batch) { ship.status = 'lost'; persist(); return { ok: false, error: 'The manifest lost its batch.' }; }

  const res = LG.arrive(ship, Object.assign({}, batch.f, { grade: GRADES[batch.f.grade] || GRADES.inert }));
  const plan = LG.settle(ship, res);

  // The strain this batch was built for. It may already be retired by another
  // batch that landed first — administering into a cleared strain is inert,
  // never an error, and never spawns anything.
  const strain = OB.strainById(b.outbreak, ship.strainId);
  let outcome = null;
  const notes = [];

  if (!strain) {
    notes.push('The register no longer carries that isolate. The doses were logged and shelved.');
  } else if (strain.curedAt) {
    notes.push('💉 ' + strain.name + ' was already cleared before this crate arrived. The doses went to the archive.');
  } else if (!plan.dosesDelivered) {
    notes.push('📦 Nothing survived the drive. The crate arrived empty of anything usable.');
  } else {
    outcome = administer(strain, res.arrived, { seed: ship.id });
    if (outcome.cleared) {
      OB.retire(b.outbreak, strain.id, Date.now());
      notes.push(outcome.headline + ' — ' + outcome.detail);
    } else {
      if (outcome.relief > 0) {
        const n = OB.relieve(b.outbreak, strain.id, outcome.relief);
        notes.push(outcome.headline + ' — ' + n + ' case' + (n === 1 ? '' : 's') + ' eased.');
      } else {
        notes.push(outcome.headline + ' — ' + outcome.detail);
      }
      if (outcome.resistanceGain) {
        const r = OB.addResistance(b.outbreak, strain.id, outcome.resistanceGain);
        if (r > 0) notes.push('🧪 ' + strain.name + ' is now ' + Math.round(r * 100) + '% resistant to formulations like this one.');
      }
    }
    /* 🔴 THE MUTANT. A cure that was supposed to help has just introduced a
       NEW virus into the same city, through the same door a wild one uses.
       It is announced loudly because the player has to be able to connect it
       to the batch they shipped — a silent mutation would read as the game
       spawning a random outbreak. */
    if (outcome.mutant) {
      OB.introduce(host, b.outbreak, outcome.mutant, 3,
        'shed by ' + batch.id + ', a ' + (GRADES[batch.f.grade] || GRADES.inert).label.toLowerCase() + ' batch');
      notes.push('☣️ ' + outcome.mutant.name + ' (' + outcome.mutant.isolate + ') came out of your own crate. ' +
                 'It is a child of ' + strain.name + ' and it is now in the city.');
    }
  }

  ship.status = 'delivered';
  ship.settledAt = Date.now();
  ship.result = {
    lost: res.lost, dosesDelivered: plan.dosesDelivered, dosesLost: res.dosesLost,
    coldChainBroken: res.coldChainBroken, arrivedGrade: res.arrived.grade.key,
    dispatchedGrade: batch.f.grade,
    cleared: !!(outcome && outcome.cleared),
    mutantId: (outcome && outcome.mutant) ? outcome.mutant.id : null,
    ratingDelta: plan.ratingDelta,
  };
  batch.status = 'administered';

  /* 💊 The shipper's own return. A landed dose is Medicine on the ledger —
     the lab made something real out of it, and it is the resource the game
     already has for exactly this. Credited through addRes, which respects the
     stash cap; a clamp here is a smaller delivery, not a failure, because the
     doses were genuinely produced either way. */
  let medicine = 0;
  if (plan.dosesDelivered > 0 && res.arrived.grade.key !== 'iatrogenic') {
    medicine = Math.max(1, Math.round(plan.dosesDelivered * 0.25 * (0.5 + res.arrived.efficacy)));
    try { B.addRes('medicine', medicine); } catch (e) {}
  }

  persist();
  settleWaybill(ship, plan).catch(() => {});

  return {
    ok: true, shipment: ship, result: res, plan, outcome,
    notes, medicine,
    coldChainBroken: res.coldChainBroken,
    mutant: (outcome && outcome.mutant) || null,
  };
}

async function settleWaybill(ship, plan) {
  const B = bridge();
  try {
    const c = B.client();
    if (!c || !B.signedIn()) return;

    /* 🔴 A PLAYER NEVER PAYS THEMSELVES. Shipping with your own haulier to your
       own lab would otherwise be a wash trade: spend the fee at dispatch,
       claim the identical fee back on arrival, and the whole cost of moving a
       cure becomes zero for anyone who owns both ends. That is not a small
       exploit — it is the entire reason to hire another player, deleted.

       So a self-owned leg gets NO payout row. The fee is still spent, and it
       is spent honestly: OPS_ECON already prices `salaryPerWorkerHr` into the
       quote, so what the player paid is their own crew's wages and their own
       fuel. Running your own trucks costs less than hiring, which is the
       correct incentive — it does not cost nothing.

       ⚠ The RATING still has to land, or a self-shipper's carrier would never
         build (or lose) a reputation and the market would read them as
         untested forever. So a self-owned carrier files a zero-amount row that
         carries only the rating delta. */
    const mineIds = {};
    try { for (const o of (B.myOps() || [])) if (o && o.id != null) mineIds[String(o.id)] = 1; } catch (e) {}
    const selfCarrier = !!mineIds[String(ship.carrierId)];
    const selfLab = !!mineIds[String(ship.labId)];

    /* 🔴 APPEND-ONLY (CLAUDE.md). The carrier's and lab's earnings are ROWS in
       a payout ledger, never an UPDATE to a balance column. Their balance is
       sum(amount), the same contract corp_treasury runs on. */
    const rows = [];
    /* 🔴 A RATING-ONLY ROW IS ONLY FILED FOR A *CORP* OPERATION. Personally
       funded ops live on the profile with ids like 'local_1712…', they are not
       rows in corp_operations, and `owns_operation()` (sql/038) therefore
       cannot recognise them — which means the claim UPDATE is refused by RLS
       and the row can never be marked claimed. It would come back unclaimed on
       every poll for the life of the account. A local op is also invisible in
       `plague_carriers`, so its rating has no reader anyway. */
    if (!selfCarrier || IS_UUID.test(String(ship.carrierId))) {
      rows.push({ shipment_id: ship.id, op_id: String(ship.carrierId), corp_id: ship.carrierCorpId,
        role: 'carrier', amount: selfCarrier ? 0 : plan.payCarrier, rating_delta: plan.ratingDelta,
        payer_id: B.userId(), payer_name: B.displayName() });
    }
    if (!selfLab) {
      rows.push({ shipment_id: ship.id, op_id: String(ship.labId), corp_id: ship.labCorpId,
        role: 'lab', amount: plan.payLab, rating_delta: 0,
        payer_id: B.userId(), payer_name: B.displayName() });
    }
    if (rows.length) await c.from('cure_payouts').insert(rows);
    await c.from('cure_shipments').update({
      status: 'delivered',
      delivered_at: new Date().toISOString(),
      arrived_grade: ship.result.arrivedGrade,
      cold_chain_broken: ship.result.coldChainBroken,
    }).eq('shipment_id', ship.id);
  } catch (e) {}
}

/* Earnings addressed to THIS player's operations, claimed the same way the
   mayor stipend is: read the unclaimed rows, mark them, credit once. RLS keeps
   the read to rows that name an op this player owns (see sql/038). */
export async function claimPayouts() {
  const B = bridge();
  try {
    const c = B.client();
    if (!c || !B.signedIn()) return { ok: false, claimed: 0 };
    const mine = (B.myOps() || []).filter((o) => o && (o.op_type === 'transport' || o.op_type === 'medical'));
    if (!mine.length) return { ok: true, claimed: 0 };
    const ids = mine.map((o) => String(o.id));
    const r = await c.from('cure_payouts').select('id, amount, role, payer_name').in('op_id', ids).eq('claimed', false).limit(50);
    const rows = (r && !r.error && Array.isArray(r.data)) ? r.data : [];
    if (!rows.length) return { ok: true, claimed: 0 };
    const total = rows.reduce((a, x) => a + (x.amount | 0), 0);
    /* 🔴 MARK FIRST, THEN CREDIT — and mark ZERO-amount rows too. A self-owned
       carrier files a rating-only row worth nothing (see settleWaybill); if
       the sweep skipped those on `total <= 0` they would come back unclaimed
       on every poll forever, and a player with only self-shipped hauls would
       re-read the same rows for the life of the account.
       The order also matters the other way: crediting before the update would
       pay twice if the update then failed, and this ledger has no way to take
       Cinder back. A failed update simply leaves the rows for the next pass. */
    const upd = await c.from('cure_payouts').update({ claimed: true }).in('id', rows.map((x) => x.id));
    if (upd && upd.error) return { ok: false, claimed: 0 };
    if (total > 0) { B.addGems(total); B.save(); }
    return { ok: true, claimed: total, rows: rows.length };
  } catch (e) { return { ok: false, claimed: 0 }; }
}

export function labStats() { return Object.assign({}, blob().lab); }
export function describeStrain(s) { return describe(s); }
