/* ═══════════════════════════════════════════════════════════════════════════
   🛢 HIDN PETRO — demand, contracts, dispatch and getting paid
   ---------------------------------------------------------------------------
   THIS IS THE FILE THAT MAKES THE REFINERY PART OF THE GAME rather than a
   self-contained toy. Contracts are not rolled out of nowhere: they come from
   gas stations that actually exist.

     · The player's own Ethos Fuel Command station (Profile.fuelCommand) —
       its NPC traffic figure IS its demand, and fuel delivered there lands in
       its underground tanks instead of paying cash. Supplying yourself is a
       real strategy with a real trade-off (no Cinder today, no shortage
       tomorrow).
     · OTHER players' stations, from the public Gas Stations directory that
       Fuel Command already publishes (Forge.fuelCommand.directory.listings).
     · City nodes — population and vehicle count drive the NPC stations that
       fill out the board when the player-run chain is thin.

   Everything above is read through the bridge and every one of them is
   OPTIONAL. With no Fuel Command, no directory and no nodes, the board falls
   back to generated NPC stations and the feature plays identically — the same
   degrade-to-empty rule the rest of the app follows.
   ═════════════════════════════════════════════════════════════════════════ */

import { GRADES, GRADE_LIST, contractValue, priceIndex, COSTS } from './data.js';
import * as St from './state.js';

/* ── NPC station names, used only when the world has nothing real to offer.
      Deliberately regional so a generated board still reads like a place. */
const NPC_NAMES = [
  ['Ashfall Fuel Stop', 'Ashfall'], ['Kettle Road Pumps', 'Kettle Road'],
  ['Dry Creek Depot', 'Dry Creek'], ['Vantage Truck Plaza', 'Vantage'],
  ['Mercy Junction Gas', 'Mercy Junction'], ['Ninth Ward Filling', 'Ninth Ward'],
  ['Copper Line Services', 'Copper Line'], ['Salt Pan Fuel', 'Salt Pan'],
  ['Longhaul Terminal 4', 'Longhaul'], ['Rook Street Pumps', 'Rook Street'],
];
/* Fleet archetypes. A station's mix is what decides WHICH grade it asks for,
   so the board is not five copies of the same contract with different numbers. */
const FLEETS = [
  { id: 'commuter', name: 'Commuter traffic',  ico: '🚗', grades: ['regular', 'regular', 'midgrade'], sizeMul: 1.0 },
  { id: 'haulage',  name: 'Freight & haulage', ico: '🚛', grades: ['diesel', 'diesel', 'regular'],    sizeMul: 1.6 },
  { id: 'transit',  name: 'Buses & transit',   ico: '🚌', grades: ['diesel', 'regular'],              sizeMul: 1.4 },
  { id: 'gensets',  name: 'Generators & farm', ico: '🚜', grades: ['utility', 'utility', 'diesel'],   sizeMul: 0.8 },
  { id: 'military', name: 'Military contract', ico: '🎖️', grades: ['jet', 'premium', 'diesel'],       sizeMul: 1.3 },
  { id: 'premium',  name: 'Performance trade', ico: '🏎️', grades: ['premium', 'midgrade'],            sizeMul: 0.7 },
];

/* ── THE DEMAND BOARD ─────────────────────────────────────────────────────
   Returns stations with a demand figure in litres/day. Real ones first. */
export function stations() {
  const b = St.bridge();
  const out = [];

  // 1. The player's own station. Its shortfall is the most urgent demand on
  //    the board, because it is the only one that costs the player money when
  //    it goes dry.
  try {
    const own = b && b.ownStation && b.ownStation();
    if (own) {
      out.push({
        id: 'own', name: own.name || 'Your Station', place: own.place || 'Home lot',
        own: true, npc: Math.max(20, own.traffic | 0),
        fuel: own.fuel | 0, cap: own.cap | 0,
        fleet: FLEETS[0], km: 6, rep: 100,
      });
    }
  } catch (e) {}

  // 2. Other players' published stations.
  try {
    const dir = (b && b.directory && b.directory()) || [];
    for (const l of dir.slice(0, 14)) {
      if (!l || l.own) continue;
      out.push({
        id: 'p_' + (l.id || l.name || Math.random().toString(36).slice(2)),
        name: l.name || 'Player Station', place: l.place || 'Directory listing',
        player: true, npc: Math.max(30, (l.traffic | 0) || 70),
        fleet: pick(FLEETS), km: 20 + Math.round(Math.random() * 180),
        rep: Math.max(0, Math.min(100, l.rep == null ? 60 : l.rep | 0)),
      });
    }
  } catch (e) {}

  // 3. City nodes → NPC stations. A district with 20,000 vehicles is a
  //    district that burns fuel; that is the whole link the brief asks for.
  let nodeSeeded = 0;
  try {
    const nodes = (b && b.demandNodes && b.demandNodes()) || [];
    for (const n of nodes.slice(0, 8)) {
      const vehicles = Math.max(0, n.vehicles | 0);
      if (vehicles < 200) continue;
      const nm = NPC_NAMES[nodeSeeded % NPC_NAMES.length];
      out.push({
        id: 'n_' + (n.id || nodeSeeded), name: nm[0] + ' — ' + (n.name || 'District'),
        place: n.name || nm[1], npc: Math.round(vehicles / 22),
        fleet: pick(FLEETS), km: 30 + Math.round(Math.random() * 220), rep: 55,
      });
      nodeSeeded++;
    }
  } catch (e) {}

  // 4. Fill the board so a brand-new player, offline, still has customers.
  let i = nodeSeeded;
  while (out.length < 5 && i < NPC_NAMES.length + nodeSeeded) {
    const nm = NPC_NAMES[i % NPC_NAMES.length];
    out.push({ id: 'npc_' + i, name: nm[0], place: nm[1], npc: 55 + Math.round(Math.random() * 120),
               fleet: pick(FLEETS), km: 25 + Math.round(Math.random() * 200), rep: 50 });
    i++;
  }
  return out;
}
function pick(a) { return a[Math.floor(Math.random() * a.length)]; }

/* Aggregate market demand vs what refiners have poured in lately. The player's
   own deliveries push supply up, which is what makes flooding the market with
   cheap Utility fuel a self-defeating strategy. */
export function refreshMarket() {
  const s = St.S();
  const st = stations();
  const demand = st.reduce((a, x) => a + x.npc * (x.fleet ? x.fleet.sizeMul : 1) * 42, 0);
  // suppliedRecent decays so the market forgives you eventually.
  s.suppliedRecent = Math.max(0, s.suppliedRecent * 0.94);
  const baseline = Math.max(4000, demand * 0.92);
  s.marketIndex = +priceIndex(demand, baseline + s.suppliedRecent).toFixed(3);
  return s.marketIndex;
}

/* ── CONTRACT GENERATION ──────────────────────────────────────────────────
   Sizes are keyed to what the player can ACTUALLY make. A one-column yard
   asked for 40,000 L of Premium is not being offered a challenge, it is being
   shown a wall — so the ceiling walks up with the equipment. */
export function contractSize(equip) {
  const cracker = equip.cracker | 0, cdu = Math.max(1, equip.cdu | 0);
  const base = 5200 + cdu * 1400 + cracker * 3600 + (equip.pumps | 0) * 700;
  /* ⚠ CAP AT ONE BLENDING TANK, NOT AT ALL OF THEM. One batch is one tank, so
     a contract larger than a single tank can never be filled — and this used
     to multiply the cap by the tank COUNT, which produced 17,500 L jobs that
     a 16,000 L tank silently refused at the commit button.
     Extra tanks buy PARALLEL contracts, not bigger ones. That is exactly what
     the equipment blurb promises, and the two have to agree. */
  return Math.min(base, St.BLEND_TANK_L);
}

/* Which grades a yard can plausibly hit. Offering Premium to a player with no
   Reformer and no Alkylation unit is offering them a bill for spot components
   — so it appears, but rarely, and only once they have a lab good enough to
   see why they failed. */
function gradePool(equip) {
  /* ⚠ WEIGHTED TO WHAT THE YARD CAN ACTUALLY MAKE, NOT TO WHAT EXISTS.
     A bare yard has 68-RON straight-run naphtha and a 10% ethanol cap: about
     81 octane. Regular needs 87 and Highway Diesel needs 120 ppm sulfur, so
     the old flat pool showed a beginner a board that was three-quarters
     impossible. Utility now dominates early — it is the grade a bare column
     genuinely produces — and Regular is present because merchant blendstock
     puts it in reach, expensively, which is the lesson that sells the first
     Reformer. */
  const ref = (equip.reformer | 0) > 0, crk = (equip.cracker | 0) > 0;
  const trt = (equip.treater | 0) > 0, alk = (equip.alky | 0) > 0;
  const pool = ['utility', 'utility', 'regular'];
  if (ref || crk || alk) pool.push('regular', 'regular');       // now genuinely cheap to hit
  if (trt) pool.push('diesel', 'diesel');                        // sulfur spec needs the treater
  if (ref || alk) pool.push('midgrade', 'midgrade');
  else if (crk) pool.push('midgrade');
  if (ref && trt) pool.push('premium');
  if (alk) pool.push('premium', 'premium');
  if (trt && (ref || alk)) pool.push('jet');
  return pool;
}

export function rollOffers(n) {
  const s = St.S();
  refreshMarket();
  const st = stations();
  const cap = contractSize(s.equip);
  const wr = St.repWholesale();
  const offers = [];
  const want = n || 5;
  for (let i = 0; i < want; i++) {
    const station = st[i % st.length];
    const pool = gradePool(s.equip);
    // A station asks for what its fleet burns; the yard's capability only
    // filters the list, it does not invent demand that is not there.
    const fleetWants = (station.fleet && station.fleet.grades) || ['regular'];
    const candidates = fleetWants.filter(g => pool.includes(g));
    const gid = candidates.length ? pick(candidates) : pick(pool);
    const grade = GRADES[gid] || GRADES.regular;

    /* ⚠ contractSize() IS A CEILING, so the fleet weighting has to scale DOWN
       from it, never up. It used to multiply (fleet 0.7–1.6) × (0.62–1.28),
       reaching 2.05× — which showed a starter yard 13,000 L jobs against a
       6,600 L ceiling it could not physically fill. Freight still asks for the
       big loads and the performance trade for the small ones; the difference
       is that the largest offer on the board is now genuinely the largest job
       the yard can do. */
    const fleetWeight = (station.fleet ? station.fleet.sizeMul : 1) / 1.6;   // 0.44 … 1.0
    const sizeMul = Math.min(1, fleetWeight * (0.62 + Math.random() * 0.55));
    const litres = Math.max(1500, Math.min(St.BLEND_TANK_L, Math.round(cap * sizeMul / 500) * 500));

    /* Deadline is in real minutes and is the contract's real difficulty knob.
       A tight one on a high grade is the "do I take this" moment; a generous
       one on Utility is the batch you hand to the Automation Suite. */
    const tightness = grade.tier >= 2 ? 0.72 : 1.0;
    const minutes = Math.max(6, Math.round((10 + litres / 900 + Math.random() * 9) * tightness));

    const value = contractValue(litres, grade, s.marketIndex, wr);
    /* Penalty is a fraction of the value, not a flat number, so a big contract
       is a big risk. Missing a deadline should feel like a decision you got
       wrong, not a fee. */
    const penalty = Math.round(value * (0.14 + Math.random() * 0.14));

    offers.push({
      id: 'ctr_' + Date.now().toString(36) + '_' + i.toString(36) + Math.floor(Math.random() * 1e4).toString(36),
      stationId: station.id, station: station.name, place: station.place,
      own: !!station.own, player: !!station.player,
      fleet: station.fleet ? station.fleet.name : 'Mixed traffic',
      fleetIco: station.fleet ? station.fleet.ico : '⛽',
      km: station.km, grade: grade.id, litres, minutes, value, penalty,
      // Repeat customers pay a loyalty premium once you have a record with them.
      rush: Math.random() < 0.18,
    });
  }
  // A rush job pays more and gives you less time — the board should always
  // contain at least one thing that is a bad idea.
  for (const o of offers) if (o.rush) { o.value = Math.round(o.value * 1.26); o.minutes = Math.max(5, Math.round(o.minutes * 0.6)); o.penalty = Math.round(o.penalty * 1.5); }
  s.offers = offers;
  s.offersRolledAt = Date.now();
  St.save();
  return offers;
}

export function accept(offerId) {
  const s = St.S();
  const i = s.offers.findIndex(o => o.id === offerId);
  if (i < 0) return null;
  const o = s.offers[i];
  const openJobs = s.contracts.filter(c => c.status === 'open').length;
  const tanks = s.equip.blendTank | 0;
  if (openJobs >= tanks) {
    St.toast('⚗️ All ' + tanks + ' blending tank' + (tanks === 1 ? '' : 's') + ' committed. Finish a job or build another tank.', 4200);
    return null;
  }
  s.offers.splice(i, 1);
  const c = Object.assign({}, o, {
    status: 'open', acceptedAt: Date.now(), dueAt: Date.now() + o.minutes * 60000,
    delivered: 0, mix: {}, batchId: null,
  });
  s.contracts.push(c);
  St.log('info', 'Accepted ' + o.litres.toLocaleString() + ' L ' + GRADES[o.grade].name + ' for ' + o.station + ' — ' + o.value.toLocaleString() + ' 🔥.');
  St.save();
  return c;
}

export function abandon(contractId) {
  const s = St.S();
  const i = s.contracts.findIndex(c => c.id === contractId);
  if (i < 0) return false;
  const c = s.contracts[i];
  St.spend(c.penalty, 'Refinery: abandoned contract');
  St.charge('penalties', c.penalty);
  St.nudgeRep('completion', -7);
  St.nudgeRep('delivery', -4);
  s.contracts.splice(i, 1);
  St.log('bad', 'Abandoned ' + c.station + '’s contract. Penalty ' + c.penalty.toLocaleString() + ' 🔥.');
  St.save();
  return true;
}

export function timeLeft(c) { return Math.max(0, (c.dueAt || 0) - Date.now()); }
export function isLate(c) { return timeLeft(c) <= 0; }

/* ── DISPATCH ═════════════════════════════════════════════════════════════
   A truck occupies a BAY while loading and is gone for the round trip. Bays,
   not trucks, are the real constraint at low levels — which is why they are
   separate purchases. */
export function freeTrucks() {
  const s = St.S();
  return Math.max(0, (s.equip.truck | 0) - s.convoy.length);
}
export function haulCost(litres, km) {
  /* ⚠ Plain rounding. This was `Math.round(x * 1000) / 1000 * 1000`, which was
     meant to round to three decimals and instead multiplied the bill by a
     thousand: a 6,050 L run over 130 km was invoiced at 100,201 🔥 against a
     36,273 🔥 contract, so every delivery in the game lost money. */
  return Math.round(litres * km * COSTS.haulPerLPerKm);
}

export function dispatch(contract, batch, priority) {
  const s = St.S();
  if (freeTrucks() <= 0) { St.toast('🚛 Every truck is on the road. Buy another, or wait for one to come back.', 4000); return null; }
  const bays = s.equip.bay | 0;
  const loading = s.convoy.filter(t => t.loading).length;
  if (loading >= bays) { St.toast('🚏 All ' + bays + ' loading bay' + (bays === 1 ? '' : 's') + ' in use.', 3600); return null; }

  const TRUCK_L = St.TRUCK_L;
  const loads = Math.ceil(batch.litres / TRUCK_L);
  if (loads > freeTrucks()) {
    St.toast('🚛 That batch needs ' + loads + ' trucks and you have ' + freeTrucks() + ' free.', 4400);
    return null;
  }

  /* Priority is a genuine three-way trade, not a difficulty setting:
       standard — cheapest, slowest
       express  — 40% dearer, arrives in half the time
       convoy   — dearest, but a guarded run that cannot be interdicted
     Express is how you save a contract you mismanaged, and paying for that
     twice in a session is how you learn not to. */
  const P = { standard: { mul: 1.0, speed: 1.0 }, express: { mul: 1.4, speed: 0.5 }, convoy: { mul: 1.85, speed: 0.8 } };
  const p = P[priority] || P.standard;
  const cost = Math.round(haulCost(batch.litres, contract.km) * p.mul);
  if (!St.spend(cost, 'Refinery: haulage')) { St.toast('Haulage needs ' + cost.toLocaleString() + ' 🔥.', 3400); return null; }
  St.charge('transport', cost);

  const etaMs = Math.max(9000, contract.km * 620 * p.speed);
  const t = {
    id: 'trk_' + Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36),
    contractId: contract.id, batchId: batch.id, litres: batch.litres,
    dest: contract.station, km: contract.km, priority: priority || 'standard',
    leftAt: Date.now(), etaMs, loading: true, loads,
  };
  s.convoy.push(t);
  // Loading takes a bay for a moment; the visual truck in the 3D yard sits at
  // the bay for exactly this long, which is why it is modelled at all.
  setTimeout(() => { try { t.loading = false; } catch (e) {} }, 2600);
  St.log('info', '🚛 Dispatched ' + batch.litres.toLocaleString() + ' L to ' + contract.station + ' (' + (priority || 'standard') + ', ' + cost.toLocaleString() + ' 🔥 haulage).');
  St.save();
  return t;
}

export function convoyProgress(t) {
  return Math.max(0, Math.min(1, (Date.now() - t.leftAt) / Math.max(1, t.etaMs)));
}

/* Arrivals. Called from the session tick; returns the contracts settled so the
   UI can show a payout card rather than a silent number change. */
export function settleArrivals() {
  const s = St.S();
  const done = [];
  for (let i = s.convoy.length - 1; i >= 0; i--) {
    const t = s.convoy[i];
    if (convoyProgress(t) < 1) continue;
    s.convoy.splice(i, 1);
    const ci = s.contracts.findIndex(c => c.id === t.contractId);
    if (ci < 0) continue;
    const c = s.contracts[ci];
    c.delivered = (c.delivered || 0) + t.litres;
    if (c.delivered + 1 < c.litres) { St.save(); continue; }
    s.contracts.splice(ci, 1);
    done.push(payout(c, t));
  }
  if (done.length) St.save();
  return done;
}

function payout(c, truck) {
  const s = St.S();
  const grade = GRADES[c.grade] || GRADES.regular;
  const late = isLate(c);
  let paid = c.value;
  let penalty = 0;
  if (late) {
    penalty = c.penalty;
    paid = Math.max(0, paid - penalty);
    St.charge('penalties', penalty);
    St.nudgeRep('delivery', -6);
  } else {
    St.nudgeRep('delivery', +2.2);
  }
  St.nudgeRep('completion', +2.6);

  /* Supplying your OWN station: the litres land in its underground tanks AND
     you are paid the wholesale half of the contract. You give up the retail
     margin — your station books that at the pump instead — so this is a real
     trade rather than a discount.
     ⚠ It used to pay ZERO for anything the station absorbed, on the theory
     that "paid in fuel" was payment enough. In practice a player spent 30,000
     🔥 on blendstock, delivered, and watched the contract settle for nothing:
     the strategy only made sense to someone who already understood Fuel
     Command's pump economics, and it read as a bug to everyone else. */
  const OWN_WHOLESALE_SHARE = 0.55;
  let intoOwn = 0;
  if (c.own) {
    try {
      const b = St.bridge();
      if (b && b.fillOwnStation) intoOwn = b.fillOwnStation(c.delivered, grade.id) | 0;
    } catch (e) {}
    // Litres the station could not physically hold are sold on at full value —
    // they went to the wider market, so they earn the whole contract rate.
    const ownShare = Math.min(1, intoOwn / Math.max(1, c.delivered));
    paid = Math.round(paid * (ownShare * OWN_WHOLESALE_SHARE + (1 - ownShare)));
  }

  if (paid > 0) { St.earn(paid, 'Refinery: contract ' + c.station); St.charge('revenue', paid); }
  s.lifetimeRevenue = (s.lifetimeRevenue | 0) + paid;
  s.lifetimeL = (s.lifetimeL | 0) + (c.delivered | 0);
  s.suppliedRecent = (s.suppliedRecent || 0) + c.delivered;

  /* 📣 The rest of the game hears about this. Fuel actually arriving at a
     station is the point of the whole feature — if this hook is missing the
     contract still pays, it just does not move the world. */
  try {
    const b = St.bridge();
    if (b && b.onDelivered) b.onDelivered({ stationId: c.stationId, station: c.station, litres: c.delivered, grade: grade.id, own: !!c.own, player: !!c.player });
  } catch (e) {}

  St.log(late ? 'warn' : 'good',
    (late ? '⏰ LATE — ' : '✅ ') + c.delivered.toLocaleString() + ' L ' + grade.name + ' delivered to ' + c.station +
    ' · ' + paid.toLocaleString() + ' 🔥' + (penalty ? ' (−' + penalty.toLocaleString() + ' penalty)' : '') +
    (intoOwn ? ' · ' + intoOwn.toLocaleString() + ' L into your own tanks' : ''));
  return { contract: c, paid, penalty, late, intoOwn, grade };
}

/* Contracts that ran out of clock while sitting in the yard. Called on the
   session tick so a forgotten job produces a consequence rather than sitting
   on the board forever. */
export function sweepExpired() {
  const s = St.S();
  const out = [];
  for (let i = s.contracts.length - 1; i >= 0; i--) {
    const c = s.contracts[i];
    // Grace: a job with a truck already rolling is not expired, it is late.
    const rolling = s.convoy.some(t => t.contractId === c.id);
    if (rolling) continue;
    if (Date.now() - (c.dueAt || 0) < 90000) continue;   // 90s past due before it dies
    s.contracts.splice(i, 1);
    St.spend(c.penalty, 'Refinery: expired contract');
    St.charge('penalties', c.penalty);
    St.nudgeRep('completion', -8);
    St.nudgeRep('delivery', -7);
    St.log('bad', '⏰ ' + c.station + '’s contract expired. Penalty ' + c.penalty.toLocaleString() + ' 🔥, reputation hit.');
    out.push(c);
  }
  if (out.length) St.save();
  return out;
}

export { GRADE_LIST };
