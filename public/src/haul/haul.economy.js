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

export const DEFAULT_ECON = { fareBase: 240, farePerKm: 14, farePerUnit: 2.5, wagePct: 35, carPenaltyPct: 6, railPenaltyPct: 3, maxPenaltyPct: 80 };

export function econOf(raw) { return Object.assign({}, DEFAULT_ECON, raw && typeof raw === 'object' ? raw : {}); }

/** The MINIMUM fare for a job: flat call-out + distance + load. A shipper may
    offer more (a tip pulls drivers to an unpopular route), never less. */
export function minFare(econ, km, qty) {
  const e = econOf(econ);
  return Math.max(1, Math.round((Number(e.fareBase) || 0) + (Number(e.farePerKm) || 0) * (Number(km) || 0) + (Number(e.farePerUnit) || 0) * (Number(qty) || 0)));
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
