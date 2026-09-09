/* ═══════════════════════════════════════════════════════════════════════════
   haul.economy.js — FARES, WAGES, PENALTIES AND THE DRIVER RANK. Pure math.

   Nothing here moves money. It exists so the UI can show the shipper what a
   job will cost, show the driver what a run will pay, and show the company
   owner what a driver is WORTH against what they are paid — all from the same
   formulas the server settles with (sql/038 haul_complete). If the two ever
   disagree the server wins; this file is the preview.

   💰 Every economy number comes in through `econ`, which is
   _opEcon('transport') — OPS_ECON.transport with Pricing Admin overrides. The
   DEFAULTS object below is only the shape used when the bridge is absent, and
   it mirrors OPS_ECON.transport on purpose.
   ═══════════════════════════════════════════════════════════════════════════ */

export const DEFAULT_ECON = { fareBase: 240, farePerKm: 14, farePerUnit: 2.5, wagePct: 35, carPenaltyPct: 6, railPenaltyPct: 3, maxPenaltyPct: 80,
  insurePct: 12, guardFee: 350, tollPct: 3, upgradeBase: 4000, bonusMinCargo: 0.9, cargoRisk: { standard: 1, fragile: 1.5, flammable: 1.8, heavy: 1.2 } };

export function econOf(raw) { return Object.assign({}, DEFAULT_ECON, raw && typeof raw === 'object' ? raw : {}); }

/** The MINIMUM fare for a job: flat call-out + distance + load. A shipper may
    offer more (a tip pulls drivers to an unpopular route), never less. */
export function minFare(econ, km, qty, resource) {
  const e = econOf(econ);
  const base = (Number(e.fareBase) || 0) + (Number(e.farePerKm) || 0) * (Number(km) || 0) + (Number(e.farePerUnit) || 0) * (Number(qty) || 0);
  return Math.max(1, Math.round(base * (resource ? cargoRisk(econ, resource) : 1)));
}

/** Company terms as stored in haul_companies, seeded from econ for a new one. */
export function defaultTerms(econ) {
  const e = econOf(econ);
  return { wage_pct: +e.wagePct, car_penalty_pct: +e.carPenaltyPct, rail_penalty_pct: +e.railPenaltyPct, max_penalty_pct: +e.maxPenaltyPct };
}

/** Settlement preview — the SAME arithmetic as haul_complete().
    terms = { wage_pct, car_penalty_pct, rail_penalty_pct, max_penalty_pct } or
    null for a freelance run (100% to the driver, penalty burned). */
export function settle({ fare, cargoPct, crashesCar, crashesRail, terms }) {
  fare = Math.max(0, Math.floor(Number(fare) || 0));
  const cargo = Math.max(0, Math.min(1, Number(cargoPct) || 0));
  const car = Math.max(0, crashesCar | 0), rail = Math.max(0, crashesRail | 0);
  if (cargo <= 0) return { failed: true, farePaid: 0, refund: fare, wagePct: 0, wageGross: 0, penaltyPct: 0, penalty: 0, driverPay: 0, companyNet: 0, burned: 0 };
  const freelance = !terms;
  const wagePct = freelance ? 100 : Number(terms.wage_pct);
  const penPct = Math.min(freelance ? 80 : Number(terms.max_penalty_pct),
                          car * (freelance ? 6 : Number(terms.car_penalty_pct)) + rail * (freelance ? 3 : Number(terms.rail_penalty_pct)));
  const farePaid = Math.floor(fare * cargo);
  const refund = fare - farePaid;
  const wageGross = Math.floor(farePaid * wagePct / 100);
  const penalty = Math.floor(wageGross * penPct / 100);
  const driverPay = Math.max(0, wageGross - penalty);
  const companyNet = freelance ? 0 : Math.max(0, farePaid - driverPay);
  return { failed: false, farePaid, refund, wagePct, wageGross, penaltyPct: penPct, penalty, driverPay, companyNet, burned: freelance ? penalty : 0 };
}

/* ── THE DRIVER RANK ──────────────────────────────────────────────────────────
   A 0–100 RATING from the driver's record, then a named rank from the rating.
   Three things a transport owner actually cares about, weighted:
     • cargo integrity  (45%) — did the goods arrive whole
     • clean driving    (35%) — crashes per 100 km, cars and rails
     • pace             (20%) — time against par
   A brand-new driver has no record and sits at a provisional 50 until three
   runs are in — an owner should not read one lucky run as a Legend. */
export const RANKS = [
  { id: 'rookie',  name: 'Rookie',          icon: '🪪', min: 0,  accent: '#a8b0c0' },
  { id: 'hauler',  name: 'Hauler',          icon: '🚚', min: 40, accent: '#9ad17a' },
  { id: 'captain', name: 'Road Captain',    icon: '🛣', min: 60, accent: '#6cd4ff' },
  { id: 'ace',     name: 'Convoy Ace',      icon: '⭐', min: 78, accent: '#ffd166' },
  { id: 'legend',  name: 'Highway Legend',  icon: '👑', min: 90, accent: '#ff8ac8' },
];

export function rating(stats) {
  const s = stats || {};
  const runs = s.runs | 0, delivered = s.delivered | 0;
  if (runs === 0) return { score: 50, provisional: true, parts: { cargo: 50, clean: 50, pace: 50, reliability: 50 } };
  const km = Math.max(1, Number(s.km) || 0);
  const cargo = Math.max(0, Math.min(1, Number(s.cargo_avg) || 0)) * 100;
  const crashPer100 = ((s.crashes_car | 0) * 1 + (s.crashes_rail | 0) * 0.5) / km * 100;
  const clean = Math.max(0, 100 - crashPer100 * 10);           // 10 crashes/100km → 0
  const tr = Math.max(0.5, Number(s.time_ratio) || 1);          // 1.0 = on par
  const pace = Math.max(0, Math.min(100, 100 - (tr - 1) * 120)); // 1.83× par → 0
  const reliability = runs ? (delivered / runs) * 100 : 0;
  // Reliability is a multiplier, not a fourth slice: a driver who abandons
  // half their loads is not "60% good", they are a liability.
  let score = (cargo * 0.45 + clean * 0.35 + pace * 0.20) * (0.5 + 0.5 * reliability / 100);
  score = Math.max(0, Math.min(100, score));
  const provisional = runs < 3;
  if (provisional) score = (score + 50) / 2;
  return { score: Math.round(score), provisional, parts: { cargo: Math.round(cargo), clean: Math.round(clean), pace: Math.round(pace), reliability: Math.round(reliability) } };
}

export function rankFor(score) {
  let r = RANKS[0];
  for (const x of RANKS) if (score >= x.min) r = x;
  return r;
}

/* 💼 WHAT IS THIS DRIVER WORTH? The question the owner's roster answers.
   Worth is a WAGE SHARE the record justifies. A driver who lands every load
   whole, on pace, without touching a rail earns the company far more per fare
   than one who arrives with 60% cargo and a dented truck — so the share they
   can command scales with the rating, between a floor and a ceiling around
   the company's default. The verdict compares it with what they are paid. */
export function worth(stats, terms, econ) {
  const base = Number((terms && terms.wage_pct) != null ? terms.wage_pct : econOf(econ).wagePct) || 35;
  const r = rating(stats);
  // 0 → 55% of base, 50 → base, 100 → 160% of base (clamped 5..90).
  const mult = r.score <= 50 ? 0.55 + 0.45 * (r.score / 50) : 1 + 0.6 * ((r.score - 50) / 50);
  const worthPct = Math.max(5, Math.min(90, Math.round(base * mult)));
  const runs = stats ? (stats.runs | 0) : 0;
  const perRun = runs ? Math.round((Number(stats.company_net) || 0) / runs) : 0;
  const perKm = (stats && Number(stats.km) > 0) ? Math.round((Number(stats.fare_paid) || 0) / Number(stats.km)) : 0;
  return { worthPct, rating: r, rank: rankFor(r.score), companyNetPerRun: perRun, farePerKm: perKm };
}

/** Compare a driver's current wage with their worth. `delta` in percentage
    points; `verdict` is the plain-language reading the owner sees. */
export function verdict(currentPct, worthPct) {
  const d = Math.round(Number(currentPct) - Number(worthPct));
  if (Math.abs(d) <= 3) return { delta: d, verdict: 'fair', label: 'Fairly paid', color: '#9ad17a' };
  if (d < 0) return { delta: d, verdict: 'under', label: 'Underpaid by ' + (-d) + ' pts — raise or lose them', color: '#ffd166' };
  return { delta: d, verdict: 'over', label: 'Overpaid by ' + d + ' pts', color: '#ff8aa0' };
}

/* ── CARGO CLASSES ───────────────────────────────────────────────────────────
   What you carry changes how you drive. Gameplay multipliers live here; the
   FARE multiplier per class comes from econ.cargoRisk so Pricing Admin can
   retune what risky freight pays. */
export const CARGO_CLASSES = {
  standard:  { id: 'standard',  label: '',            accel: 1,    brake: 1,    speed: 1,    carMul: 1,   railMul: 1,   fire: false },
  fragile:   { id: 'fragile',   label: '· fragile',   accel: 1,    brake: 1,    speed: 1,    carMul: 1.2, railMul: 1.7, fire: false },
  flammable: { id: 'flammable', label: '· flammable', accel: 1,    brake: 1,    speed: 1,    carMul: 1.6, railMul: 1,   fire: true },
  heavy:     { id: 'heavy',     label: '· heavy',     accel: 0.78, brake: 0.85, speed: 0.92, carMul: 0.85, railMul: 0.85, fire: false },
};
const CLASS_OF = { fuel: 'flammable', gas: 'flammable', medicine: 'fragile', energyDrink: 'fragile', water: 'fragile', dna: 'fragile', memoryShards: 'fragile', corruptedEssence: 'fragile', metal: 'heavy', stone: 'heavy', wood: 'heavy' };
export function cargoClass(resource) { return CLASS_OF[String(resource || '')] || 'standard'; }
export function cargoRisk(econ, resource) { const e = econOf(econ); const r = (e.cargoRisk && e.cargoRisk[cargoClass(resource)]); return Number(r) > 0 ? Number(r) : 1; }

/* ── RIG UPGRADES ─────────────────────────────────────────────────────────────
   Per driver, three lines, three levels each. Prices scale from econ.upgradeBase. */
export const UPGRADES = [
  { id: 'engine', name: 'Engine',        icon: '⚙️', desc: '+7% acceleration and top speed per level' },
  { id: 'brakes', name: 'Brakes',        icon: '🛑', desc: '+14% braking per level' },
  { id: 'bed',    name: 'Reinforced bed', icon: '🧱', desc: '−12% cargo damage per level' },
];
export const UPGRADE_MAX = 3;
export function upgradePrice(econ, id, nextLevel) { const e = econOf(econ); return Math.round((Number(e.upgradeBase) || 4000) * nextLevel * (id === 'bed' ? 1.25 : 1)); }
export function upgradeEffects(levels) {
  const L = levels || {}; const g = (k) => Math.max(0, Math.min(UPGRADE_MAX, L[k] | 0));
  return { accel: 1 + 0.07 * g('engine'), speed: 1 + 0.07 * g('engine'), brake: 1 + 0.14 * g('brakes'), bed: 1 - 0.12 * g('bed') };
}

/* ── WEATHER ─────────────────────────────────────────────────────────────────
   Keyed to the destination's region and a seeded roll, so a route has weather
   you can expect (coastal sectors rain more) without being identical every time
   the map is redrawn. */
export function weatherFor(city, rnd) {
  const region = String((city && city.region) || '').toLowerCase();
  const roll = rnd ? rnd() : Math.random();
  const wet = /tide|coast|marsh|water|glas/.test(region) ? 0.45 : 0.22;
  if (roll < wet) return { id: 'rain', icon: '🌧', label: 'Rain — less grip', grip: 0.78, skyH: 0.6, skyS: 0.2, skyL: 0.22, fogNear: 60, fogFar: 380, light: 0.7, rain: true, night: false };
  if (roll < wet + 0.25) return { id: 'night', icon: '🌙', label: 'Night — short sight', grip: 1, skyH: 0.66, skyS: 0.4, skyL: 0.08, fogNear: 50, fogFar: 300, light: 0.45, rain: false, night: true };
  return { id: 'clear', icon: '🌤', label: 'Clear', grip: 1, skyH: 0.62, skyS: 0.38, skyL: 0.30, fogNear: 140, fogFar: 560, light: 1, rain: false, night: false };
}

/* ── THE EXTRAS A SHIPPER CAN BUY, AND WHAT THEY COST ────────────────────── */
export function insurancePremium(econ, fare) { return Math.max(1, Math.round((Number(fare) || 0) * (Number(econOf(econ).insurePct) || 12) / 100)); }
export function guardFee(econ) { return Math.max(1, Math.round(Number(econOf(econ).guardFee) || 350)); }
export function tollPct(econ) { return Number(econOf(econ).tollPct) || 3; }
/** The on-time bonus is earned by arriving within par with ≥ 90% cargo. */
export function bonusEarned(out, econ) { const minCargo = Number(econOf(econ).bonusMinCargo) || 0.9; return !!(out && out.completed && out.timeS <= out.parS && out.cargoPct >= minCargo); }

/* ── RIGS: WHAT YOU DRIVE ─────────────────────────────────────────────────────
   The truck comes from the rest of the game, not from here: a Garage rig
   (Ironback / Ash Convoy / Warden, bought for cash), a truck-class vehicle
   sitting on the player's Prince Portfolios lot, or the free issued Scrap
   Hauler. Each maps to a HANDLING PROFILE, so a dealership stat line finally
   means something on the road: an Armored Vehicle shrugs off hits but is slow
   to stop, a Utility 4x4 is nimble and small, a Construction Vehicle carries
   the most and turns like a barge. Condition (dealership) scales the engine
   and brakes: a Salvage-grade truck is a Salvage-grade truck.
     accel / brake / top  — multipliers on the base rig physics
     steer               — steering authority (1 = base)
     armor               — cargo-damage multiplier (lower is tougher)
     capacity            — the most units it can carry on one job */
export const RIG_TYPES = {
  hauler:     { id: 'hauler',     label: 'Scrap Hauler',        accel: 0.85, brake: 0.9,  top: 0.82, steer: 1.05, armor: 1.15, capacity: 40 },
  ironback:   { id: 'ironback',   label: 'Ironback Runner',     accel: 0.95, brake: 1.0,  top: 0.92, steer: 1.0,  armor: 1.0,  capacity: 80 },
  ashconvoy:  { id: 'ashconvoy',  label: 'Ash Convoy Rig',      accel: 1.0,  brake: 1.05, top: 1.0,  steer: 0.95, armor: 0.9,  capacity: 140 },
  warden:     { id: 'warden',     label: 'Warden Longhaul',     accel: 1.05, brake: 1.1,  top: 1.06, steer: 0.9,  armor: 0.7,  capacity: 220 },
  truck:      { id: 'truck',      label: 'Truck',               accel: 1.0,  brake: 1.0,  top: 0.98, steer: 1.0,  armor: 1.0,  capacity: 120 },
  utility:    { id: 'utility',    label: 'Utility Vehicle',     accel: 1.1,  brake: 1.1,  top: 0.95, steer: 1.15, armor: 1.1,  capacity: 60 },
  construction: { id: 'construction', label: 'Construction Vehicle', accel: 0.75, brake: 0.85, top: 0.78, steer: 0.75, armor: 0.8, capacity: 260 },
  armored:    { id: 'armored',    label: 'Armored Vehicle',     accel: 0.85, brake: 0.8,  top: 0.9,  steer: 0.85, armor: 0.55, capacity: 150 },
  van:        { id: 'van',        label: 'Smuggler Van',        accel: 1.15, brake: 1.05, top: 1.08, steer: 1.1,  armor: 1.05, capacity: 70 },
};
const PP_TYPE_TO_RIG = { 'Truck': 'truck', 'Utility Vehicle': 'utility', 'Construction Vehicle': 'construction', 'Armored Vehicle': 'armored', 'Smuggler Van': 'van' };
const COND_MULT = { Pristine: 1.05, Clean: 1, Worn: 0.9, Battered: 0.78, Wrecked: 0.6, Salvage: 0.45 };
export function isHaulVehicleType(ppType) { return !!PP_TYPE_TO_RIG[String(ppType || '')]; }
/** A rig profile from any owned vehicle record the bridge hands over:
    { id, name, kind: 'garage'|'lot'|'issued', type?, condition?, sku? } */
export function rigProfile(v) {
  v = v || {};
  let t = RIG_TYPES.hauler;
  if (v.kind === 'garage') t = RIG_TYPES[{ rig_ironback: 'ironback', rig_ashconvoy: 'ashconvoy', rig_warden: 'warden' }[v.sku]] || RIG_TYPES.ironback;
  else if (v.kind === 'lot') t = RIG_TYPES[PP_TYPE_TO_RIG[v.type]] || RIG_TYPES.truck;
  const c = COND_MULT[v.condition] || 1;
  return { id: v.id || t.id, name: v.name || t.label, kind: v.kind || 'issued', typeLabel: t.label, condition: v.condition || '',
           accel: t.accel * c, brake: t.brake * c, top: t.top * (0.85 + 0.15 * c), steer: t.steer, armor: t.armor * (v.condition === 'Salvage' || v.condition === 'Wrecked' ? 1.15 : 1),
           capacity: Math.round(t.capacity * (c < 0.7 ? 0.7 : 1)) };
}
export const ISSUED_RIG = { id: 'issued_hauler', name: 'Scrap Hauler', kind: 'issued' };
