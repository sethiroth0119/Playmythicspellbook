/* HIGHWAY HAUL — lifted verbatim from the branch test-drive bundle (HighwayHaulTestDrive.html, 2026-09-09).
   Seven source files concatenated in dependency order: haul.bridge, haul.map, haul.economy, haul.game,
   haul.api, haul.render, index. Kept as ONE module on purpose: the bundle is the only copy of this code
   that reached this repo, and re-deriving seven files worth of imports from it is a place to introduce a
   bug the original never had. The sandbox's two test-page lines were removed; nothing else changed.
   Server side: haul_* tables and RPCs (that branch's sql/038-039) are NOT installed here, so the module
   runs in its own practice mode — real city map, no Cinder moves — until they are. */

/* ───── haul.bridge.js ───── */
/* ═══════════════════════════════════════════════════════════════════════════
   haul.bridge.js — THE SEAM between /src/haul and the legacy app.

   🔴 WHY THIS FILE EXISTS. index.html declares Profile, Cloud, Corp, Forge and
   Operations as top-level `const`. Those are global LEXICAL bindings — NOT
   properties of `window` — so an ES module cannot see them and `window.Profile`
   is undefined however global it looks. It has cost real time twice already
   (CLAUDE.md). index.html therefore hands this module exactly what it needs as
   `window.MythicHaulBridge`, every entry an accessor. Nothing in /src/haul reads
   a bare global. Need something new? Add it to the bridge on BOTH sides.

   ⚠ NULL_BRIDGE is what a test page (or a broken load) gets. Every consumer is
   written against this shape, so the module renders — in practice mode, with
   the built-in map — with no game around it at all.
   ═══════════════════════════════════════════════════════════════════════════ */

const NULL_BRIDGE = {
  cloud: null,
  signedIn: () => false,
  userId: () => null,
  displayName: () => 'Survivor',
  gems: () => 0,
  refreshWallet: async () => {},
  resources: () => [],
  meta: (id) => ({ id, name: id, icon: '📦' }),
  getRes: () => 0,
  spendRes: () => false,
  addRes: () => false,
  refundRes: () => false,
  cities: () => [],
  econ: () => null,
  myCorp: () => null,
  amCorpFounder: () => false,
  corpRoster: () => [],
  corpEnsure: async () => {},
  transportOp: async () => null,
  corpTreasuryRefresh: async () => 0,
  corpTreasury: () => 0,
  nodeOwnersRefresh: async () => {},
  rigs: () => [{ id: 'issued_hauler', name: 'Scrap Hauler', kind: 'issued' }],
  toast: (m) => { try { console.log('[haul]', m); } catch (e) {} },
  confirm: async () => false,
  saveProfile: () => {},
  isAdmin: () => false,
  _null: true,
};

function bridge() {
  try {
    const b = (typeof window !== 'undefined') && window.MythicHaulBridge;
    return (b && typeof b.signedIn === 'function') ? b : NULL_BRIDGE;
  } catch (e) { return NULL_BRIDGE; }
}
function bridgeReady() { return !bridge()._null; }

/* The Supabase client, or null. Every API call checks this first and degrades
   to practice mode — the app MUST work offline / before sql/038 exists. */
function client() {
  try { const c = bridge().cloud; return (c && c.client) ? c.client : null; } catch (e) { return null; }
}

function esc(t) {
  return String(t == null ? '' : t).replace(/[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function fmtNum(n) {
  const v = Number(n) || 0;
  return v >= 1000000 ? (v / 1000000).toFixed(1) + 'M'
       : v >= 10000 ? (v / 1000).toFixed(1) + 'k'
       : Math.round(v).toLocaleString();
}
function fmtKm(km) { return (Math.round((Number(km) || 0) * 10) / 10).toFixed(1) + ' km'; }
function fmtTime(s) {
  s = Math.max(0, Math.round(Number(s) || 0));
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
}

/* ───── haul.map.js ───── */
/* ═══════════════════════════════════════════════════════════════════════════
   haul.map.js — ROUTES ON THE CITY NODE MAP.

   A haul's length is not a number somebody typed on the job; it is the road
   distance between two cities on the same map City Nodes draws. Cities are the
   Territory-War nodes (position + supply-line connections), handed over by the
   bridge. The route is the SHORTEST PATH along connections (Dijkstra), so a
   haul between two cities with no road between them goes the long way round —
   and if the graph is disconnected at all we fall back to straight-line so a
   job can always be priced.

   ⚠ Pure module: no I/O, no globals. Positions are map percentages (0..100)
     and MAP_KM is the one scale that turns them into kilometres. It is the
     only place that decides how long "across the map" is, and the 3D run and
     the fare both read the same km, so neither can drift from the other.
   ═══════════════════════════════════════════════════════════════════════════ */

/* One map percentage-unit = this many km. The starter map is ~75 units wide,
   but routes follow SUPPLY LINES and the seed graph is sparse, so the longest
   road route (KILN-7 → LAST WICK, eight hops) is ~330 units against a shortest
   neighbour hop of ~26. At 1 km per unit that reads as 26 km … 330 km, which
   is the spread the fare and the run length are tuned around below. */
const MAP_KM = 1.0;

/* 🗺 THE BUILT-IN MAP — a copy of _twSeedStarterData's 16 cities and 16 supply
   lines, used ONLY when the bridge hands us nothing (a test page, or a map
   an admin has emptied). It must stay in step with index.html's seed: a route
   priced against this map and driven against the game's would be two lengths. */
const FALLBACK_CITIES = (() => {
  const names = ['KILN-7', 'EMBERFALL', 'SALTGATE', 'BREAKWATER', 'BLACKHARROW', 'IRONLUNG',
                 'HOLLOW SEPT', 'ROOKSWAY', 'GREYMARSH', 'CINDER FORK', 'LATHE-9', 'MIRRORWELL',
                 'DUSTHAVEN', 'CARRION GAP', 'VEINSHEAR', 'LAST WICK'];
  const pos = [
    { x: 12, y: 22 }, { x: 38, y: 18 }, { x: 66, y: 20 }, { x: 16, y: 54 }, { x: 42, y: 52 }, { x: 70, y: 56 },
    { x: 22, y: 34 }, { x: 50, y: 26 }, { x: 78, y: 24 }, { x: 26, y: 66 }, { x: 56, y: 66 }, { x: 82, y: 64 },
    { x: 30, y: 42 }, { x: 44, y: 36 }, { x: 86, y: 35 }, { x: 18, y: 76 },
  ];
  const routes = [
    ['N-01', 'N-02'], ['N-02', 'N-03'], ['N-03', 'N-04'], ['N-04', 'N-12'],
    ['N-01', 'N-05'], ['N-05', 'N-06'], ['N-06', 'N-15'], ['N-07', 'N-08'],
    ['N-07', 'N-09'], ['N-09', 'N-13'], ['N-10', 'N-11'], ['N-11', 'N-14'],
    ['N-13', 'N-16'], ['N-14', 'N-15'], ['N-08', 'N-10'], ['N-02', 'N-11'],
  ];
  const cities = names.map((n, i) => ({ id: 'N-' + String(i + 1).padStart(2, '0'), name: n, x: pos[i].x, y: pos[i].y, connections: [], sector: '', region: '', owned: false, mine: false }));
  const byId = {}; cities.forEach((c) => { byId[c.id] = c; });
  for (const [a, b] of routes) { if (byId[a] && byId[b]) { byId[a].connections.push(b); byId[b].connections.push(a); } }
  return cities;
})();

function normalizeCities(list) {
  const out = (Array.isArray(list) ? list : []).filter((c) => c && c.id).map((c) => ({
    id: String(c.id), name: String(c.name || c.id), x: Number(c.x) || 0, y: Number(c.y) || 0,
    connections: Array.isArray(c.connections) ? c.connections.map(String) : [],
    sector: c.sector || '', region: c.region || '', owned: !!c.owned, mine: !!c.mine,
  }));
  return out.length >= 2 ? out : FALLBACK_CITIES;
}

function segKm(a, b) {
  const dx = a.x - b.x, dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy) * MAP_KM;
}

/** Shortest road route between two city ids.
    Returns { km, path:[ids], legs:[{from,to,km}], direct:boolean } — `direct`
    is true when no road path existed and the straight line was used. */
function route(cities, fromId, toId) {
  const list = normalizeCities(cities);
  const byId = {}; list.forEach((c) => { byId[c.id] = c; });
  const A = byId[fromId], B = byId[toId];
  if (!A || !B) return null;
  if (A.id === B.id) return { km: 0, path: [A.id], legs: [], direct: false };
  // Dijkstra over the supply lines. Small graph; a plain O(n²) scan is fine
  // and has no heap to get wrong.
  const dist = {}, prev = {}, done = {};
  list.forEach((c) => { dist[c.id] = Infinity; });
  dist[A.id] = 0;
  for (let i = 0; i < list.length; i++) {
    let u = null, best = Infinity;
    for (const id in dist) if (!done[id] && dist[id] < best) { best = dist[id]; u = id; }
    if (u == null || u === B.id) break;
    done[u] = true;
    for (const v of byId[u].connections) {
      if (!byId[v] || done[v]) continue;
      const d = dist[u] + segKm(byId[u], byId[v]);
      if (d < dist[v]) { dist[v] = d; prev[v] = u; }
    }
  }
  if (dist[B.id] < Infinity) {
    const path = []; let cur = B.id;
    while (cur) { path.unshift(cur); cur = prev[cur]; }
    const legs = [];
    for (let i = 1; i < path.length; i++) legs.push({ from: path[i - 1], to: path[i], km: segKm(byId[path[i - 1]], byId[path[i]]) });
    return { km: round1(dist[B.id]), path, legs, direct: false };
  }
  // Disconnected: straight line, flagged so the UI can say "no supply line".
  return { km: round1(segKm(A, B)), path: [A.id, B.id], legs: [{ from: A.id, to: B.id, km: segKm(A, B) }], direct: true };
}

function round1(n) { return Math.round(n * 10) / 10; }

/* The runs must be playable: a 330 km haul at highway speed is minutes, not
   an afternoon, so the 3D run compresses the world. One game unit = 1 metre
   and a km on the map becomes ROAD_M_PER_KM metres of road: the shortest hop
   is ~1 km of road (about 30 s flat out) and the longest ~13 km (about 6 min),
   which is the "different lengths" the map is for. Par time (what a clean run
   at cruising speed should take) is derived from the same figure so the
   rank's "on pace" measure and the road length can never disagree. */
const ROAD_M_PER_KM = 40;
const CRUISE_MPS = 42;          // ~150 km/h in game units
function roadLength(km) { return Math.max(400, Math.round((Number(km) || 0) * ROAD_M_PER_KM)); }
function parSeconds(km) { return Math.max(20, Math.round(roadLength(km) / CRUISE_MPS * 1.15)); }

/* ───── haul.economy.js ───── */
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

const DEFAULT_ECON = { fareBase: 240, farePerKm: 14, farePerUnit: 2.5, wagePct: 35, carPenaltyPct: 6, railPenaltyPct: 3, maxPenaltyPct: 80,
  insurePct: 12, guardFee: 350, tollPct: 3, upgradeBase: 4000, bonusMinCargo: 0.9, cargoRisk: { standard: 1, fragile: 1.5, flammable: 1.8, heavy: 1.2 } };

function econOf(raw) { return Object.assign({}, DEFAULT_ECON, raw && typeof raw === 'object' ? raw : {}); }

/** The MINIMUM fare for a job: flat call-out + distance + load. A shipper may
    offer more (a tip pulls drivers to an unpopular route), never less. */
function minFare(econ, km, qty, resource) {
  const e = econOf(econ);
  const base = (Number(e.fareBase) || 0) + (Number(e.farePerKm) || 0) * (Number(km) || 0) + (Number(e.farePerUnit) || 0) * (Number(qty) || 0);
  return Math.max(1, Math.round(base * (resource ? cargoRisk(econ, resource) : 1)));
}

/** Company terms as stored in haul_companies, seeded from econ for a new one. */
function defaultTerms(econ) {
  const e = econOf(econ);
  return { wage_pct: +e.wagePct, car_penalty_pct: +e.carPenaltyPct, rail_penalty_pct: +e.railPenaltyPct, max_penalty_pct: +e.maxPenaltyPct };
}

/** Settlement preview — the SAME arithmetic as haul_complete().
    terms = { wage_pct, car_penalty_pct, rail_penalty_pct, max_penalty_pct } or
    null for a freelance run (100% to the driver, penalty burned). */
function settle({ fare, cargoPct, crashesCar, crashesRail, terms }) {
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
const RANKS = [
  { id: 'rookie',  name: 'Rookie',          icon: '🪪', min: 0,  accent: '#a8b0c0' },
  { id: 'hauler',  name: 'Hauler',          icon: '🚚', min: 40, accent: '#9ad17a' },
  { id: 'captain', name: 'Road Captain',    icon: '🛣', min: 60, accent: '#6cd4ff' },
  { id: 'ace',     name: 'Convoy Ace',      icon: '⭐', min: 78, accent: '#ffd166' },
  { id: 'legend',  name: 'Highway Legend',  icon: '👑', min: 90, accent: '#ff8ac8' },
];

function rating(stats) {
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

function rankFor(score) {
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
function worth(stats, terms, econ) {
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
function verdict(currentPct, worthPct) {
  const d = Math.round(Number(currentPct) - Number(worthPct));
  if (Math.abs(d) <= 3) return { delta: d, verdict: 'fair', label: 'Fairly paid', color: '#9ad17a' };
  if (d < 0) return { delta: d, verdict: 'under', label: 'Underpaid by ' + (-d) + ' pts — raise or lose them', color: '#ffd166' };
  return { delta: d, verdict: 'over', label: 'Overpaid by ' + d + ' pts', color: '#ff8aa0' };
}

/* ── CARGO CLASSES ───────────────────────────────────────────────────────────
   What you carry changes how you drive. Gameplay multipliers live here; the
   FARE multiplier per class comes from econ.cargoRisk so Pricing Admin can
   retune what risky freight pays. */
const CARGO_CLASSES = {
  standard:  { id: 'standard',  label: '',            accel: 1,    brake: 1,    speed: 1,    carMul: 1,   railMul: 1,   fire: false },
  fragile:   { id: 'fragile',   label: '· fragile',   accel: 1,    brake: 1,    speed: 1,    carMul: 1.2, railMul: 1.7, fire: false },
  flammable: { id: 'flammable', label: '· flammable', accel: 1,    brake: 1,    speed: 1,    carMul: 1.6, railMul: 1,   fire: true },
  heavy:     { id: 'heavy',     label: '· heavy',     accel: 0.78, brake: 0.85, speed: 0.92, carMul: 0.85, railMul: 0.85, fire: false },
};
/* 🌾 Bulk feed rides heavy and livestock rides fragile — the two cargo classes the
   Truck Yard already sells rigs for (v121v82). */
const CLASS_OF = { animalFeed: 'heavy', livestock: 'fragile', fuel: 'flammable', gas: 'flammable', medicine: 'fragile', energyDrink: 'fragile', water: 'fragile', dna: 'fragile', memoryShards: 'fragile', corruptedEssence: 'fragile', metal: 'heavy', stone: 'heavy', wood: 'heavy' };
function cargoClass(resource) { return CLASS_OF[String(resource || '')] || 'standard'; }
function cargoRisk(econ, resource) { const e = econOf(econ); const r = (e.cargoRisk && e.cargoRisk[cargoClass(resource)]); return Number(r) > 0 ? Number(r) : 1; }

/* ── RIG UPGRADES ─────────────────────────────────────────────────────────────
   Per driver, three lines, three levels each. Prices scale from econ.upgradeBase. */
const UPGRADES = [
  { id: 'engine', name: 'Engine',        icon: '⚙️', desc: '+7% acceleration and top speed per level' },
  { id: 'brakes', name: 'Brakes',        icon: '🛑', desc: '+14% braking per level' },
  { id: 'bed',    name: 'Reinforced bed', icon: '🧱', desc: '−12% cargo damage per level' },
];
const UPGRADE_MAX = 3;
function upgradePrice(econ, id, nextLevel) { const e = econOf(econ); return Math.round((Number(e.upgradeBase) || 4000) * nextLevel * (id === 'bed' ? 1.25 : 1)); }
function upgradeEffects(levels) {
  const L = levels || {}; const g = (k) => Math.max(0, Math.min(UPGRADE_MAX, L[k] | 0));
  return { accel: 1 + 0.07 * g('engine'), speed: 1 + 0.07 * g('engine'), brake: 1 + 0.14 * g('brakes'), bed: 1 - 0.12 * g('bed') };
}

/* ── WEATHER ─────────────────────────────────────────────────────────────────
   Keyed to the destination's region and a seeded roll, so a route has weather
   you can expect (coastal sectors rain more) without being identical every time
   the map is redrawn. */
function weatherFor(city, rnd) {
  const region = String((city && city.region) || '').toLowerCase();
  const roll = rnd ? rnd() : Math.random();
  const wet = /tide|coast|marsh|water|glas/.test(region) ? 0.45 : 0.22;
  if (roll < wet) return { id: 'rain', icon: '🌧', label: 'Rain — less grip', grip: 0.78, skyH: 0.6, skyS: 0.2, skyL: 0.22, fogNear: 60, fogFar: 380, light: 0.7, rain: true, night: false };
  if (roll < wet + 0.25) return { id: 'night', icon: '🌙', label: 'Night — short sight', grip: 1, skyH: 0.66, skyS: 0.4, skyL: 0.08, fogNear: 50, fogFar: 300, light: 0.45, rain: false, night: true };
  return { id: 'clear', icon: '🌤', label: 'Clear', grip: 1, skyH: 0.62, skyS: 0.38, skyL: 0.30, fogNear: 140, fogFar: 560, light: 1, rain: false, night: false };
}

/* ── THE EXTRAS A SHIPPER CAN BUY, AND WHAT THEY COST ────────────────────── */
function insurancePremium(econ, fare) { return Math.max(1, Math.round((Number(fare) || 0) * (Number(econOf(econ).insurePct) || 12) / 100)); }
function guardFee(econ) { return Math.max(1, Math.round(Number(econOf(econ).guardFee) || 350)); }
function tollPct(econ) { return Number(econOf(econ).tollPct) || 3; }
/** The on-time bonus is earned by arriving within par with ≥ 90% cargo. */
function bonusEarned(out, econ) { const minCargo = Number(econOf(econ).bonusMinCargo) || 0.9; return !!(out && out.completed && out.timeS <= out.parS && out.cargoPct >= minCargo); }

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
const RIG_TYPES = {
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
function isHaulVehicleType(ppType) { return !!PP_TYPE_TO_RIG[String(ppType || '')]; }
/** A rig profile from any owned vehicle record the bridge hands over:
    { id, name, kind: 'garage'|'lot'|'issued', type?, condition?, sku? } */
function rigProfile(v) {
  v = v || {};
  let t = RIG_TYPES.hauler;
  if (v.kind === 'garage') t = RIG_TYPES[{ rig_ironback: 'ironback', rig_ashconvoy: 'ashconvoy', rig_warden: 'warden' }[v.sku]] || RIG_TYPES.ironback;
  else if (v.kind === 'lot') t = RIG_TYPES[PP_TYPE_TO_RIG[v.type]] || RIG_TYPES.truck;
  const c = COND_MULT[v.condition] || 1;
  return { id: v.id || t.id, name: v.name || t.label, kind: v.kind || 'issued', typeLabel: t.label, condition: v.condition || '', model: (v.model && typeof v.model.url === 'string' && v.model.url) ? { url: v.model.url, scale: +v.model.scale || 1, rotY: +v.model.rotY || 0, wrecked: (typeof v.model.wrecked === 'string') ? v.model.wrecked : '' } : null,
           accel: t.accel * c, brake: t.brake * c, top: t.top * (0.85 + 0.15 * c), steer: t.steer, armor: t.armor * (v.condition === 'Salvage' || v.condition === 'Wrecked' ? 1.15 : 1),
           capacity: Math.round(t.capacity * (c < 0.7 ? 0.7 : 1)) };
}
const ISSUED_RIG = { id: 'issued_hauler', name: 'Scrap Hauler', kind: 'issued' };

/* ═══ 🚛 GLB rigs and containers (v121v110) ══════════════════════════════════
   The run is built from boxes first — cab, bed, three cargo crates, wheels —
   and stays that way if a model never arrives. When the chosen rig carries a
   model (the bridge copies rigs.data.js's `model` onto the lot row it hands
   over), the file is loaded with the GLTFLoader that matches the run's own
   three.js build, fitted over the procedural rig, and the deck it finds in the
   mesh takes the two shipping containers. The cargo animation (each container
   shrinks and tilts with the cargo %) and the collision box are unchanged:
   the containers are still the rig's `userData.cargo` children, only their
   geometry is a model now. */
const HAUL_CONTAINERS = [
  { url: '/models/trucks/container_red.glb',  rotY: 90, frac: 0.58 },   // the 40-footer, rear
  { url: '/models/trucks/container_blue.glb', rotY: 90, frac: 0.42 },   // the 20-footer, front
];
const HAUL_THREE_ADDONS = 'https://cdn.jsdelivr.net/npm/three@0.171.0/examples/jsm/loaders/GLTFLoader.js';
const _glbCache = new Map();
let _gltfLoaderP = null;
let HAUL_ANISO = 8;   // the run sets this from the renderer before any model loads
function haulGLTFLoader(THREE) {
  if (!_gltfLoaderP) _gltfLoaderP = (async () => {
    if (THREE.GLTFLoader) return new THREE.GLTFLoader();
    const m = await import(/* @vite-ignore */ HAUL_THREE_ADDONS);
    return new m.GLTFLoader();
  })().catch((e) => { _gltfLoaderP = null; throw e; });
  return _gltfLoaderP;
}
/* A fresh clone per call. v121v120: the material keeps the scan's NORMAL map
   (Lambert threw it away, and a photogrammetry truck with no normal map reads
   as a crumpled smudge — the owner's "fix the resolution"), and both textures
   are sampled with anisotropy so the box sides and the deck stay sharp at the
   chase camera's grazing angle. Metalness 0: there is no environment map on
   the road, and a metal truck with nothing to reflect renders black. */
async function haulLoadGLB(THREE, url) {
  if (!_glbCache.has(url)) _glbCache.set(url, (async () => {
    const loader = await haulGLTFLoader(THREE);
    const g = await new Promise((res, rej) => loader.load(url, res, undefined, rej));
    const sc = g.scene || (g.scenes && g.scenes[0]);
    if (!sc) throw new Error('empty glb ' + url);
    sc.traverse((o) => { if (o.isMesh && o.material) { const m = o.material; for (const t of [m.map, m.normalMap]) if (t) { t.anisotropy = HAUL_ANISO; t.needsUpdate = true; } o.material = new THREE.MeshStandardMaterial({ map: m.map || null, normalMap: m.normalMap || null, color: m.color ? m.color.clone() : 0xffffff, metalness: 0, roughness: 0.78, side: m.side }); } });
    return sc;
  })().catch((e) => { _glbCache.delete(url); throw e; }));
  return (await _glbCache.get(url)).clone(true);
}
/* Which way round is this truck? (v121v120)
   1. A truck file this game ships is looked up. Every one was checked by eye
      in tools/athena-harness (pw-truckview.mjs renders each from both ends and
      the side): all are long along X with the cab at −X, which 90° sends to
      +Z — the nose, inside `rig`.
   2. Anything else (an admin's upload) is measured. The old rule, "the tall
      end is the cab", is right for a flatbed and BACKWARDS for a box truck, a
      stock truck or a tanker, whose body stands taller than the cab — the
      owner's HidnEx feed truck drove tail-first. The cab end is the one with
      (a) a STEP in the roofline a short way in (the back of the cab against a
      low deck, or the gap between cab and box) and (b) a TAPERED tip (bumper
      and bonnet below the cab roof), where a deck, a box or a tank ends
      square. The roofline is read along the centre strip, so mirrors and the
      sides of the body stay out of it; the tall-end rule only breaks a tie.
   Returns the rotation in degrees that haulFit should apply. */
const HAUL_KNOWN_ROT = { 'freight_semi.glb': 90, 'freight_semi_wrecked.glb': 90, 'feed_truck.glb': 90, 'livestock_truck.glb': 90, 'tanker.glb': 90 };
function haulKnownRot(url) {
  const u = String(url || '').split('?')[0], f = u.split('/').pop();
  return (/(^|\/)models\/trucks\/[^/]+$/.test(u) && Object.prototype.hasOwnProperty.call(HAUL_KNOWN_ROT, f)) ? HAUL_KNOWN_ROT[f] : null;
}
function haulRooflineScore(h) {   // h runs from one end inward, heights 0..1
  const N = h.length; let step = 0;
  for (let i = Math.floor(N * 0.1); i < Math.floor(N * 0.45); i++) step = Math.max(step, Math.abs(h[i + 2] - h[i]));
  /* the RAMP: how far the first sixth of the roofline sits below the roof of
     its end. A median, so a tow hitch or a tail-lift two bins long at the back
     of a box cannot pass for a bonnet. */
  const near = Math.max(...h.slice(0, Math.ceil(N * 0.25)));
  const first = h.slice(0, Math.ceil(N * 0.15)).sort((a, b) => a - b), med = first[Math.floor(first.length / 2)];
  const taper = near > 0 ? Math.max(0, 1 - med / near) : 0;
  return { step, taper, score: step + taper };
}
function haulAutoOrient(THREE, obj, url) {
  const known = haulKnownRot(url);
  if (known != null) return known;
  const wrap = new THREE.Group(); wrap.add(obj); wrap.updateMatrixWorld(true);
  const b = new THREE.Box3().setFromObject(obj), sz = new THREE.Vector3(); b.getSize(sz);
  const axis = sz.x > sz.z ? 'x' : 'z', across = axis === 'x' ? 'z' : 'x';
  const lo = b.min[axis], len = Math.max(1e-6, sz[axis]), tall = Math.max(1e-6, sz.y);
  const mid = (b.min[across] + b.max[across]) / 2, strip = Math.max(1e-6, sz[across] * 0.3);
  const N = 40, top = new Array(N).fill(-Infinity), topAll = new Array(N).fill(-Infinity); const v = new THREE.Vector3();
  /* Sampled along every triangle EDGE, not at the vertices: a decimated scan
     has roof triangles several bins long with no vertex in between, and the
     vertex-only profile read those bins as dips in the roof. */
  const p = new THREE.Vector3(), q = new THREE.Vector3(), binW = len / N;
  const put = (pt) => {
    const k = Math.max(0, Math.min(N - 1, Math.floor((pt[axis] - lo) / len * N))), hn = (pt.y - b.min.y) / tall;
    if (hn > topAll[k]) topAll[k] = hn;
    if (Math.abs(pt[across] - mid) <= strip && hn > top[k]) top[k] = hn;
  };
  obj.traverse((o) => {
    if (!o.isMesh || !o.geometry || !o.geometry.attributes || !o.geometry.attributes.position) return;
    const pos = o.geometry.attributes.position, idx = o.geometry.index;
    const tris = Math.floor((idx ? idx.count : pos.count) / 3), every = Math.max(1, Math.floor(tris / 60000));
    const corner = (t, c, out) => out.fromBufferAttribute(pos, idx ? idx.getX(t * 3 + c) : t * 3 + c).applyMatrix4(o.matrixWorld);
    for (let t = 0; t < tris; t += every) {
      for (let c = 0; c < 3; c++) {
        corner(t, c, p); corner(t, (c + 1) % 3, q);
        const n = Math.min(48, Math.ceil(Math.abs(q[axis] - p[axis]) / binW * 2));
        for (let j = 0; j <= n; j++) put(v.lerpVectors(p, q, n ? j / n : 0));
      }
    }
  });
  wrap.remove(obj);
  // a bin the centre strip missed takes the full width's height; a bin nothing reached takes its neighbour's
  for (let i = 0; i < N; i++) if (!isFinite(top[i])) top[i] = topAll[i];
  for (let i = 1; i < N; i++) if (!isFinite(top[i])) top[i] = top[i - 1];
  for (let i = N - 2; i >= 0; i--) if (!isFinite(top[i])) top[i] = top[i + 1];
  for (let i = 0; i < N; i++) if (!isFinite(top[i])) top[i] = 0;
  const sLo = haulRooflineScore(top), sHi = haulRooflineScore(top.slice().reverse());
  let cabAtHi;
  if (Math.abs(sLo.score - sHi.score) > 0.08) cabAtHi = sHi.score > sLo.score;
  else { let tLo = -Infinity, tHi = -Infinity; for (let i = 0; i < N; i++) { if (i < N * 0.3) tLo = Math.max(tLo, top[i]); else if (i >= N * 0.7) tHi = Math.max(tHi, top[i]); } cabAtHi = tHi >= tLo; }
  /* rot 0 keeps +z as the nose; rot 90 sends −x to +z. The cab must end at +Z:
     for axis z the cab must be the HIGH end (else +180); for axis x the cab
     must be the LOW end (else +180). */
  let rot = axis === 'x' ? 90 : 0;
  if (axis === 'z' ? !cabAtHi : cabAtHi) rot += 180;
  return rot;
}
/* Fit a loaded model into a box. rotY (degrees) is applied FIRST so the
   model's long axis reads along the rig's Z (nose at +Z inside `rig`).
   dims: { w, l, h } — with `uniform` the largest scale that fits every
   given dimension is used; without it each axis is scaled to its own target
   (a 40-foot container squashed to a deck is still a container). The model
   is turned INSIDE a holder and the holder is what gets scaled, so each scale
   axis is a rig axis — scaling the turned model itself put the length scale
   on the width. The holder is centred on x and z with its floor at y 0.
   Returns { node, w, h, l }: add `node` to the rig. */
function haulFit(THREE, obj, dims, rotY, uniform) {
  const wrap = new THREE.Group(), node = new THREE.Group();
  obj.rotation.y = (rotY || 0) * Math.PI / 180;
  node.add(obj); wrap.add(node); wrap.updateMatrixWorld(true);
  const b = new THREE.Box3().setFromObject(node), sz = new THREE.Vector3(); b.getSize(sz);
  const sx = dims.w ? dims.w / (sz.x || 1) : Infinity, sy = dims.h ? dims.h / (sz.y || 1) : Infinity, sz2 = dims.l ? dims.l / (sz.z || 1) : Infinity;
  if (uniform) { const k = Math.min(sx, sy, sz2); node.scale.setScalar(isFinite(k) && k > 0 ? k : 1); }
  else node.scale.set(isFinite(sx) ? sx : 1, isFinite(sy) ? sy : 1, isFinite(sz2) ? sz2 : 1);
  wrap.updateMatrixWorld(true);
  const b2 = new THREE.Box3().setFromObject(node), c = b2.getCenter(new THREE.Vector3()), s2 = new THREE.Vector3(); b2.getSize(s2);
  node.position.x -= c.x; node.position.z -= c.z; node.position.y -= b2.min.y;
  wrap.remove(node);
  return { node, w: s2.x, h: s2.y, l: s2.z };
}
/* Where the deck is. Sampling the centre strip of the fitted semi (|x| below
   a third of its half-width, so the wheels stay out of it), the height of the
   mesh is binned along Z; the cab is the tall run at the nose, the deck is
   the low run behind it. Returns the deck's top and its Z span, or a guess
   (a 40 % deck at 45 % of the height) when the mesh gives nothing usable. */
function haulDeckOf(THREE, obj, size, frame) {
  const N = 24, top = new Array(N).fill(-Infinity); const zMin = -size.l / 2, xLim = Math.max(0.2, size.w / 6);
  (frame || obj).updateMatrixWorld(true);
  // vertices in the FRAME's space (the rig group: nose +Z, floor y 0), not the world's
  const inv = frame ? new THREE.Matrix4().copy(frame.matrixWorld).invert() : new THREE.Matrix4();
  const v = new THREE.Vector3(), mm = new THREE.Matrix4();
  obj.traverse((o) => {
    if (!o.isMesh || !o.geometry || !o.geometry.attributes || !o.geometry.attributes.position) return;
    const pos = o.geometry.attributes.position, step = Math.max(1, Math.floor(pos.count / 6000));
    mm.multiplyMatrices(inv, o.matrixWorld);
    for (let i = 0; i < pos.count; i += step) {
      v.fromBufferAttribute(pos, i).applyMatrix4(mm);
      if (Math.abs(v.x) > xLim) continue;
      const bi = Math.max(0, Math.min(N - 1, Math.floor((v.z - zMin) / size.l * N)));
      if (v.y > top[bi]) top[bi] = v.y;
    }
  });
  // a coarse mesh leaves empty bins between its vertices: carry the last height forward
  for (let i = 1; i < N; i++) if (!isFinite(top[i]) && isFinite(top[i - 1])) top[i] = top[i - 1];
  const hMax = Math.max(...top.filter(isFinite), 0);
  const low = top.map((t) => isFinite(t) && t < hMax * 0.55);
  // the deck: the longest run of low bins that starts at the rear (bin 0)
  let end = 0; while (end < N && low[end]) end++;
  if (end < 3 || hMax <= 0) return { top: size.h * 0.45, z0: zMin + size.l * 0.04, z1: zMin + size.l * 0.44, guessed: true };
  const tops = top.slice(0, end).filter(isFinite).sort((a, b) => a - b);
  const deckTop = tops[Math.floor(tops.length / 2)];
  return { top: deckTop, z0: zMin + size.l * 0.03, z1: zMin + (end / N) * size.l - size.l * 0.02, guessed: false };
}

/* ═══ 🚨 raiders vs traffic (v121v110) ═══════════════════════════════════════
   A raider used to be a homing point — it slid through every car between it
   and the rig. Now it is a vehicle: the nearest car ahead of it in its own
   width is its lead, it brakes behind that lead and tries to swing round it,
   and a raider held off long enough gives up. Traffic is cover. */
const RAIDER_GIVE_UP_S = 6;
function raiderLead(R, S, traffic) {
  let best = null, bestD = Infinity;
  for (const o of traffic) {
    if (o.z <= R.z || o.z - o.halfL > S.z) continue;   // behind the raider, or already past the rig
    if (Math.abs(o.x - R.x) >= o.halfW + R.halfW) continue;
    const d = o.z - R.z; if (d < bestD) { bestD = d; best = o; }
  }
  return best;
}
/* Where the raider wants to be this tick: at the rig when the way is clear;
   beside the lead — on the rig's side of it when that is still on the road —
   when it is not. Returns { x, speed, blocked }. */
function raiderSteer(R, S, lead, roadHalf, dt) {
  if (!lead) return { x: S.x, speed: Math.min(72, S.speed + 12), blocked: false };
  const gap = lead.z - R.z - lead.halfL - R.halfL;
  const safe = 3 + R.speed * 0.35;
  const side = (S.x >= lead.x ? 1 : -1);
  let tx = lead.x + side * (lead.halfW + R.halfW + 0.7);
  if (Math.abs(tx) > roadHalf - R.halfW) tx = lead.x - side * (lead.halfW + R.halfW + 0.7);
  if (Math.abs(tx) > roadHalf - R.halfW) tx = Math.sign(tx || 1) * (roadHalf - R.halfW);
  const beside = Math.abs(R.x - tx) < 0.6;
  if (gap < safe && !beside) return { x: tx, speed: Math.max(0, Math.min(lead.speed - (safe - gap) * 0.5, lead.speed)), blocked: true, gap };
  return { x: beside ? tx : S.x, speed: Math.min(72, S.speed + 12), blocked: false, gap };
}

/* ───── haul.game.js ───── */
const routeOf = route;
/* ═══════════════════════════════════════════════════════════════════════════
   haul.game.js — THE HIGHWAY RUN. A Crazy-Taxi-style 3D drive, built on the
   three@0.171 import map index.html already declares (WebGPU, with the WebGL
   backend as fallback on browsers without navigator.gpu).

   WHAT IT IS
     One highway, four lanes one way, guardrails, a road that bends, traffic
     that follows and signals like traffic, and a ROUTE: the shortest path on
     the city node map, city by city. Every city on the way is a JUNCTION with
     a real exit ramp and real signs naming the nodes each road leads to; the
     GPS in the corner says which one to take. Miss it and you are rerouted —
     more road, more clock. Hazards, weather, raiders and toll gates come from
     the route too, so no two hauls are the same road.

   WHAT IT IS NOT
     A money path. play() resolves a plain outcome object; the caller decides
     what it is worth (sql/038–039 do, server-side). Nothing here touches the
     bridge, the wallet or Supabase. That is what lets a test page drive it.

   ⚠ Everything created here is torn down in destroy(): renderer, listeners,
     DOM, the RAF loop. A leaked renderer is a leaked GPU context and the
     second run would fail to init.
   ═══════════════════════════════════════════════════════════════════════════ */



// The lanes. 4 × 3.6 m + a 1.4 m shoulder each side; the rail sits at ±HALF.
const LANE_W = 3.6, LANES = 4, ROAD_W = LANE_W * LANES, HALF = ROAD_W / 2 + 1.4;
const SEG_LEN = 40, SEGS = 16;
const PLAYER_HALF_W = 1.15, BASE_PLAYER_HALF_L = 4.2;   // the half-length grows to the model's when a rig model loads
const BASE_MAX_SPEED = 62;                      // m/s (≈ 220 km/h) flat out
const CAR_HIT_DMG = 9, RAIL_HIT_DMG = 4, HAZARD_DMG = 3, RAIDER_DMG = 8;
// Exit ramps: the extra lane opens RAMP_IN metres before the junction and the
// decision is read RAMP_OUT metres after it.
const RAMP_IN = 60, RAMP_OUT = 100;
const TOLL_BACK = 150;                          // the plaza sits this far before the junction
const TOLL_PAY_S = 1.6;                         // the pause at the booth

function centreX(z) { return 6 * Math.sin(z / 260) + 3.5 * Math.sin(z / 97 + 1.3); }
function laneX(i) { return -ROAD_W / 2 + LANE_W * (i + 0.5); }
function hash(str) { let h = 2166136261; for (const c of String(str)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }
function mulberry(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

/* ── THE ROUTE PLAN ──────────────────────────────────────────────────────────
   Turns a map route into the run's timeline: where each city sits on the road,
   whether the route continues on the mainline or down the exit there, what
   the signs say, where the hazards and raiders are, and the weather. Seeded
   from the route so the same haul is the same road every time — a driver can
   learn a route, which is what makes taking the right exit a skill. */
function planRun(cities, fromId, toId, opts) {
  opts = opts || {};
  const C = normalizeCities(cities); const byId = {}; C.forEach((c) => { byId[c.id] = c; });
  const r = routeOf(C, fromId, toId);
  if (!r) return null;
  const rnd = mulberry(hash(fromId + '>' + toId));
  const total = roadLength(r.km);
  const mPerKm = total / Math.max(0.1, r.km);
  const junctions = []; let z = 0;
  for (let i = 1; i < r.path.length; i++) {
    z += r.legs[i - 1].km * mPerKm;
    const node = byId[r.path[i]]; const last = i === r.path.length - 1;
    const next = last ? null : byId[r.path[i + 1]];
    const others = (node.connections || []).filter((id) => id !== r.path[i - 1] && (!next || id !== next.id)).map((id) => byId[id]).filter(Boolean);
    // The destination is always an exit. In between, the route leaves the
    // mainline about a third of the time — enough that "always stay on" is
    // never a safe habit.
    const viaExit = last || rnd() < 0.36;
    const exitTo = viaExit ? [last ? node : next].concat(others.slice(0, 1)) : others.slice(0, 2);
    const thruTo = viaExit ? others.slice(0, 2) : [next].concat(others.slice(2, 3));
    // A two-road town has no "other" destination: its exit is the town itself
    // and the mainline runs on. The sign must never be blank.
    const exitNames = exitTo.length ? exitTo.map((n) => n.name) : [node.name + ' (TOWN)'];
    junctions.push({ z: Math.round(z), node, nextName: last ? node.name : next.name, viaExit, last,
                     exitNames, thruNames: thruTo.length ? thruTo.map((n) => n.name) : ['OPEN HIGHWAY'],
                     toll: !!(node.ownerId && opts.driverId && node.ownerId !== opts.driverId && !last) || !!(opts.forceToll && !last),
                     tollOwner: node.ownerName || '' });
  }
  const hazards = [];
  for (let hz = 500 + rnd() * 400; hz < total - 250; hz += 650 + rnd() * 500) {
    // Keep hazards off the ramps, where the driver is already busy.
    if (junctions.some((j) => Math.abs(j.z - hz) < 260)) continue;
    const kind = ['debris', 'breakdown', 'cones'][Math.floor(rnd() * 3)];
    hazards.push({ z: Math.round(hz), kind, lane: Math.floor(rnd() * LANES) });
  }
  const raiders = [];
  if (r.km > 40) for (let rz = 900 + rnd() * 600; rz < total - 400 && raiders.length < 3; rz += 2000 + rnd() * 1500) raiders.push({ z: Math.round(rz) });
  const weather = weatherFor(byId[toId], rnd);
  return { route: r, total, par: parSeconds(r.km), junctions, hazards, raiders, weather, cities: C, fromId, toId };
}

async function play(opts) {
  opts = opts || {};
  const plan = opts.plan || planRun(opts.cities || [], opts.fromId, opts.toId, opts);
  if (!plan) throw new Error('No route between those cities.');
  const { total, par, junctions, hazards, weather } = plan;
  const km = plan.route.km;
  const cls = CARGO_CLASSES[cargoClass(opts.resource)] || CARGO_CLASSES.standard;
  const up = upgradeEffects(opts.upgrades);
  const RIG = rigProfile(opts.rig);
  let PLAYER_HALF_L = BASE_PLAYER_HALF_L;
  const MAX_SPEED = BASE_MAX_SPEED * cls.speed * up.speed * RIG.top;
  const WHEELBASE = 6.5;                        // bicycle model: yaw rate = v · tan(δ) / L
  let THREE;
  try { THREE = await import('three'); }
  catch (e) { throw new Error('three.js failed to load — the run needs the 3D engine. ' + ((e && e.message) || '')); }

  // ── DOM ───────────────────────────────────────────────────────────────────
  const root = document.createElement('div');
  root.id = 'haul-run';
  root.innerHTML = `
    <canvas id="haul-canvas"></canvas>
    <div class="haul-hud">
      <div class="haul-hud-row haul-hud-top">
        <div class="haul-pill"><span class="haul-k">ROUTE</span> ${_gEsc(plan.route.path[0] && plan.cities.find((c) => c.id === plan.fromId).name)} → ${_gEsc(plan.cities.find((c) => c.id === plan.toId).name)} · ${km.toFixed(1)} km</div>
        <div class="haul-pill"><span class="haul-k">CARGO</span> <span id="haul-cargo">100%</span> · ${_gEsc(opts.cargoLabel || 'freight')} <span class="haul-dim">${cls.label}</span></div>
        <div class="haul-pill"><span class="haul-k">TIME</span> <span id="haul-time">0:00</span> <span class="haul-dim">/ par ${fmtT(par)}</span></div>
        <div class="haul-pill haul-dim">🚛 ${_gEsc(RIG.name)}${RIG.condition ? ' · ' + _gEsc(RIG.condition) : ''} · ${weather.icon} ${_gEsc(weather.label)}${opts.guard ? ' · <span id="haul-guard">🛡 GUARD READY</span>' : ''}</div>
        <div class="haul-pill haul-turn" id="haul-turn" hidden></div>
      </div>
      <div class="haul-progress"><div id="haul-prog-bar"></div><div id="haul-prog-txt"></div></div>
      <div class="haul-hud-spacer"></div>
      <div class="haul-gps"><canvas id="haul-gps" width="240" height="170"></canvas><div class="haul-gps-txt" id="haul-gps-txt"></div></div>
      <div class="haul-hud-row haul-hud-bottom">
        <div class="haul-pill haul-speed"><span id="haul-speed">0</span><span class="haul-dim"> km/h</span></div>
        <div class="haul-pill">🚗 <span id="haul-cc">0</span> &nbsp; 🛤 <span id="haul-cr">0</span> &nbsp; ⚠ <span id="haul-hz">0</span></div>
        <div class="haul-pill haul-dim" id="haul-hint">↑/W gas · ↓/S brake · ←/→ steer · Esc pause</div>
      </div>
      <div class="haul-touch">
        <button class="haul-tbtn" data-t="left">◀</button>
        <button class="haul-tbtn" data-t="brake">BRAKE</button>
        <button class="haul-tbtn" data-t="right">▶</button>
      </div>
      <div class="haul-flash" id="haul-flash"></div>
      <div class="haul-merge" id="haul-merge"><div class="haul-merge-txt"></div><div class="haul-merge-sub">merging onto the new highway</div></div>
      <div class="haul-pause" id="haul-pause" hidden>
        <div class="haul-pause-card">
          <h3>Paused</h3>
          <p>Abandon the run and the shipment goes back on the board. The failure stays on your record.</p>
          <button class="haul-btn" id="haul-resume">Resume</button>
          <button class="haul-btn haul-btn-danger" id="haul-abandon">Abandon run</button>
        </div>
      </div>
      <div class="haul-countdown" id="haul-count">3</div>
    </div>`;
  document.body.appendChild(root);
  const $ = (id) => root.querySelector('#' + id);
  const canvas = $('haul-canvas');

  // ── Renderer & world ──────────────────────────────────────────────────────
  const hasGPU = !!(typeof navigator !== 'undefined' && navigator.gpu);
  const renderer = new THREE.WebGPURenderer({ canvas, antialias: true, forceWebGL: !hasGPU });
  try { await renderer.init(); }
  catch (e) { root.remove(); throw new Error('The 3D renderer could not start on this device. ' + ((e && e.message) || '')); }
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  try { const mx = typeof renderer.getMaxAnisotropy === 'function' ? renderer.getMaxAnisotropy() : 8; HAUL_ANISO = Math.max(1, Math.min(16, +mx || 8)); } catch (e) {}
  const scene = new THREE.Scene();
  const sky = new THREE.Color().setHSL(weather.skyH, weather.skyS, weather.skyL);
  scene.background = sky;
  scene.fog = new THREE.Fog(sky, weather.fogNear, weather.fogFar);
  const cam = new THREE.PerspectiveCamera(62, 1, 0.5, 900);
  // r155+ lights are physically scaled, so these read high: the first cut at
  // 0.9 / 1.4 rendered the skyline as black slabs in a driven screenshot.
  scene.add(new THREE.HemisphereLight(0xcfd8ff, 0x5a4636, 2.2 * weather.light));
  const sun = new THREE.DirectionalLight(0xffd9a8, 2.6 * weather.light); sun.position.set(-60, 120, -80); scene.add(sun);

  const M = {
    road: new THREE.MeshLambertMaterial({ color: 0x2b2d33 }),
    shoulder: new THREE.MeshLambertMaterial({ color: 0x3a3630 }),
    stripe: new THREE.MeshBasicMaterial({ color: 0xd8d0a0 }),
    edge: new THREE.MeshBasicMaterial({ color: 0xffffff }),
    rail: new THREE.MeshLambertMaterial({ color: 0x9aa4b0 }),
    post: new THREE.MeshLambertMaterial({ color: 0x555a60 }),
    ground: new THREE.MeshLambertMaterial({ color: 0x2a2620 }),
    /* 🛣 One palette per HIGHWAY. Taking an exit moves the rig onto the next
       road, and a new road has its own buildings — the palette index steps
       with every exit taken (see the merge below). */
    bldSets: [
      [0x4a5068, 0x5a4848, 0x445a50, 0x605840],
      [0x6a4a3a, 0x7a5a48, 0x5a4a40, 0x8a6a50],
      [0x3a4a5a, 0x4a5a6a, 0x2a3a4a, 0x5a6a7a],
      [0x4a5a3a, 0x5a6a4a, 0x3a4a2a, 0x6a7a5a],
    ].map((set) => set.map((c) => new THREE.MeshLambertMaterial({ color: c }))),
    get bld() { return this.bldSets[legPal % this.bldSets.length]; },
    win: new THREE.MeshBasicMaterial({ color: 0xffc070 }),
    wheel: new THREE.MeshLambertMaterial({ color: 0x151515 }),
    glass: new THREE.MeshLambertMaterial({ color: 0x8fd0ff }),
    cargo: new THREE.MeshLambertMaterial({ color: opts.cargoColor ? new THREE.Color(opts.cargoColor) : 0xd4af37 }),
    player: new THREE.MeshLambertMaterial({ color: 0xff7a2b }),
    blink: new THREE.MeshBasicMaterial({ color: 0xffa000 }),
    blinkOff: new THREE.MeshBasicMaterial({ color: 0x4a2a00 }),
    cone: new THREE.MeshLambertMaterial({ color: 0xff6a1a }),
    debris: new THREE.MeshLambertMaterial({ color: 0x6a6258 }),
    raider: new THREE.MeshLambertMaterial({ color: 0xc02020 }),
    signGreen: new THREE.MeshLambertMaterial({ color: 0x1f6b3a }),
    signBlue: new THREE.MeshLambertMaterial({ color: 0x1f3d8a }),
    signWarn: new THREE.MeshLambertMaterial({ color: 0xd9a400 }),
    toll: new THREE.MeshLambertMaterial({ color: 0x8a2a2a }),
    tracer: new THREE.MeshBasicMaterial({ color: 0xffee88 }),
  };
  const G = {
    road: new THREE.PlaneGeometry(ROAD_W, SEG_LEN), ramp: new THREE.PlaneGeometry(LANE_W, SEG_LEN),
    shoulder: new THREE.PlaneGeometry(1.4, SEG_LEN), ground: new THREE.PlaneGeometry(260, SEG_LEN),
    stripe: new THREE.PlaneGeometry(0.16, 3), edge: new THREE.PlaneGeometry(0.2, SEG_LEN),
    rail: new THREE.BoxGeometry(0.16, 0.36, SEG_LEN), post: new THREE.BoxGeometry(0.14, 0.9, 0.14),
    wheel: new THREE.CylinderGeometry(0.42, 0.42, 0.3, 10), cone: new THREE.ConeGeometry(0.35, 0.9, 8), blinkG: new THREE.BoxGeometry(0.22, 0.16, 0.12),
  };

  /* 🚗 v121v120: every car used to build its own boxes and its own paint, and a
     despawned car was dropped with its GPU buffers still held — ten to twenty
     new vehicles a minute for the whole run, which a phone pays for in hitches
     (the flicker) and, on a long haul, in a road that stops filling. Boxes and
     paints are shared now, and a car that leaves the road goes back in a pool. */
  const CAR_G = {};
  const carGeo = (k, w, h, d) => CAR_G[k] || (CAR_G[k] = new THREE.BoxGeometry(w, h, d));
  const CAR_M = new Map();
  const carMat = (c) => { if (!CAR_M.has(c)) CAR_M.set(c, new THREE.MeshLambertMaterial({ color: c })); return CAR_M.get(c); };
  const BOX_M = new THREE.MeshLambertMaterial({ color: 0xc8c8c8 });
  /* Text on a sign: a 2D canvas painted once, used as a texture. */
  function textPanel(lines, w, h, bg, fg, fontPx) {
    const c = document.createElement('canvas'); c.width = 512; c.height = Math.round(512 * h / w);
    const g = c.getContext('2d'); g.fillStyle = bg; g.fillRect(0, 0, c.width, c.height);
    g.strokeStyle = '#ffffff'; g.lineWidth = 8; g.strokeRect(6, 6, c.width - 12, c.height - 12);
    g.fillStyle = fg; g.textAlign = 'center'; g.textBaseline = 'middle';
    const lh = c.height / (lines.length + 0.4);
    lines.forEach((t, i) => { g.font = 'bold ' + Math.min(fontPx || 64, lh * 0.7) + 'px sans-serif'; g.fillText(String(t).slice(0, 26), c.width / 2, lh * (i + 0.7)); });
    const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: tex }));
    return m;
  }
  function placeAt(obj, z, x, y) { obj.position.set(centreX(z) + x, y, -z); obj.rotation.y = -Math.atan2((centreX(z + 1) - centreX(z - 1)) / 2, 1); scene.add(obj); return obj; }
  function roadsideSign(z, lines, mat, side, big) {
    const g = new THREE.Group();
    const w = big ? 7 : 5, h = big ? 3 : 2;
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.25, 4, 0.25), M.post); post.position.set(0, 2, 0); g.add(post);
    const panel = textPanel(lines, w, h, mat === M.signGreen ? '#1f6b3a' : mat === M.signBlue ? '#1f3d8a' : mat === M.toll ? '#8a2a2a' : '#d9a400', '#ffffff'); panel.position.set(0, 4 + h / 2, 0); panel.rotation.y = Math.PI; g.add(panel);
    return placeAt(g, z, side * (HALF + 2.2 + (big ? 1.5 : 0)), 0);
  }
  /* The gantry: two panels over the road, THRU on the left, EXIT on the right. */
  function gantry(z, thru, exit, dist) {
    const g = new THREE.Group();
    for (const s of [-1, 1]) { const p = new THREE.Mesh(new THREE.BoxGeometry(0.5, 8, 0.5), M.post); p.position.set(s * (HALF + LANE_W * 0.5), 4, 0); g.add(p); }
    const bar = new THREE.Mesh(new THREE.BoxGeometry(HALF * 2 + LANE_W + 1, 0.5, 0.5), M.post); bar.position.set(0, 8, 0); g.add(bar);
    const L = textPanel(['↑ ' + (dist ? dist + ' m' : 'THRU')].concat(thru), 8, 3.2, '#1f6b3a', '#ffffff'); L.position.set(-4.6, 6.4, 0); L.rotation.y = Math.PI; g.add(L);
    const R = textPanel(['EXIT ↗ ' + (dist ? dist + ' m' : '')].concat(exit), 8, 3.2, '#1f3d8a', '#ffffff'); R.position.set(4.6, 6.4, 0); R.rotation.y = Math.PI; g.add(R);
    return placeAt(g, z, 0, 0);
  }

  // ── Road chunks, recycled as the rig advances ─────────────────────────────
  const segs = [];
  function makeSegment(z0) {
    const g = new THREE.Group();
    const road = new THREE.Mesh(G.road, M.road); road.rotation.x = -Math.PI / 2; g.add(road);
    const gr = new THREE.Mesh(G.ground, M.ground); gr.rotation.x = -Math.PI / 2; gr.position.y = -0.05; g.add(gr);
    const parts = { railR: new THREE.Group(), ramp: new THREE.Group() };
    for (const s of [-1, 1]) {
      const sh = new THREE.Mesh(G.shoulder, M.shoulder); sh.rotation.x = -Math.PI / 2; sh.position.set(s * (ROAD_W / 2 + 0.7), 0.005, 0); (s > 0 ? parts.railR : g).add(sh);
      const ed = new THREE.Mesh(G.edge, M.edge); ed.rotation.x = -Math.PI / 2; ed.position.set(s * (ROAD_W / 2 - 0.1), 0.01, 0); (s > 0 ? parts.railR : g).add(ed);
      const r = new THREE.Mesh(G.rail, M.rail); r.position.set(s * HALF, 0.75, 0); (s > 0 ? parts.railR : g).add(r);
      for (let k = -SEG_LEN / 2 + 2; k < SEG_LEN / 2; k += 4) { const p = new THREE.Mesh(G.post, M.post); p.position.set(s * HALF, 0.45, k); (s > 0 ? parts.railR : g).add(p); }
    }
    for (let l = 1; l < LANES; l++) for (let k = -SEG_LEN / 2 + 1.5; k < SEG_LEN / 2; k += 6) {
      const st = new THREE.Mesh(G.stripe, M.stripe); st.rotation.x = -Math.PI / 2; st.position.set(-ROAD_W / 2 + l * LANE_W, 0.01, k); g.add(st);
    }
    // The exit ramp lane: hidden unless this chunk sits in a ramp window. When
    // shown, the right rail assembly is shifted out a lane.
    const rp = new THREE.Mesh(G.ramp, M.road); rp.rotation.x = -Math.PI / 2; rp.position.set(ROAD_W / 2 + LANE_W / 2, 0.002, 0); parts.ramp.add(rp);
    for (let k = -SEG_LEN / 2 + 1.5; k < SEG_LEN / 2; k += 3) { const st = new THREE.Mesh(G.stripe, M.edge); st.rotation.x = -Math.PI / 2; st.position.set(ROAD_W / 2, 0.012, k); parts.ramp.add(st); }
    parts.ramp.visible = false;
    g.add(parts.railR); g.add(parts.ramp);
    g.userData.parts = parts; g.userData.props = new THREE.Group(); g.add(g.userData.props);
    scene.add(g);
    const seg = { g, z0 }; placeSegment(seg, z0); return seg;
  }
  /* 🛣 The highway the rig is on: a seed that reshuffles every segment's props
     and a palette index. Both step when a correct exit is taken. */
  let legSeed = 0, legPal = 0;
  function rampAt(z) { return junctions.some((j) => z > j.z - RAMP_IN && z < j.z + RAMP_OUT); }
  function placeSegment(seg, z0) {
    seg.z0 = z0;
    seg.g.position.set(centreX(z0 + SEG_LEN / 2), 0, -(z0 + SEG_LEN / 2));
    // Travel is toward −Z, so a bend toward +x is a NEGATIVE yaw about Y
    // (rotation.y = θ sends the −Z nose to (−sin θ, 0, −cos θ)). Same sign
    // rule for every vehicle below.
    const dx = centreX(z0 + SEG_LEN) - centreX(z0);
    seg.g.rotation.y = -Math.atan2(dx, SEG_LEN);
    const ramp = rampAt(z0 + SEG_LEN / 2);
    seg.g.userData.parts.ramp.visible = ramp;
    seg.g.userData.parts.railR.position.x = ramp ? LANE_W : 0;
    const P = seg.g.userData.props;
    while (P.children.length) { const c = P.children.pop(); P.remove(c); c.geometry.dispose(); }
    const rnd = mulberry(Math.floor(z0 / SEG_LEN) * 7919 + Math.floor(km * 13) + (legSeed | 0));
    const n = 3 + Math.floor(rnd() * 4);
    for (let i = 0; i < n; i++) {
      const side = rnd() < 0.5 ? -1 : 1;
      const w = 6 + rnd() * 16, h = 4 + rnd() * 26, d = 6 + rnd() * 12;
      const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), M.bld[Math.floor(rnd() * M.bld.length)]);
      b.position.set(side * (HALF + 8 + rnd() * 40 + w / 2), h / 2 - 0.05, -SEG_LEN / 2 + rnd() * SEG_LEN);
      P.add(b);
      if (rnd() < (weather.night ? 0.9 : 0.5)) { const wnd = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 1.6), M.win); wnd.position.set(b.position.x - side * (w / 2 + 0.02), 2 + rnd() * (h - 3), b.position.z); wnd.rotation.y = side < 0 ? Math.PI / 2 : -Math.PI / 2; P.add(wnd); }
    }
    if (rnd() < 0.35) { const py = new THREE.Mesh(new THREE.BoxGeometry(0.6, 28, 0.6), M.post); const side = rnd() < 0.5 ? -1 : 1; py.position.set(side * (HALF + 5), 14, 0); P.add(py); }
  }
  for (let i = 0; i < SEGS; i++) segs.push(makeSegment(i * SEG_LEN));

  // ── Signs, gates, hazards: absolute objects placed once ───────────────────
  for (const j of junctions) {
    roadsideSign(j.z - 480, ['◆ ' + j.node.name, (j.node.sector || 'SETTLEMENT').toUpperCase()], M.signGreen, 1, true);
    gantry(j.z - 300, j.thruNames, j.exitNames, 300);
    gantry(j.z - 90, j.thruNames, j.exitNames, 0);
    /* 💰 TOLL PLAZA. Booths between the lanes under a canopy, one barrier arm
       per lane, all DOWN. The rig has to come to a full stop at the booth;
       the toll is paid over a short pause, the arms lift, and only then can
       it roll. Running the arm is a wall — the run does not continue until
       the toll is paid, whatever speed you arrived at. */
    if (j.toll) {
      roadsideSign(j.z - 260, ['TOLL PLAZA · STOP', j.tollOwner ? 'OWNER: ' + j.tollOwner : 'PRIVATE NODE', 'STOP AT THE BOOTH'], M.toll, 1, true);
      const plaza = new THREE.Group(); const zArm = j.z - TOLL_BACK;
      const canopy = new THREE.Mesh(new THREE.BoxGeometry(HALF * 2 + 2, 0.6, 9), M.toll); canopy.position.set(0, 6.2, 0); plaza.add(canopy);
      const title = textPanel(['TOLL · STOP', j.tollOwner ? j.tollOwner : j.node.name], HALF * 2, 2.4, '#8a2a2a', '#ffffff'); title.position.set(0, 7.7, 4.5); title.rotation.y = Math.PI; plaza.add(title);
      for (let l = 0; l <= LANES; l++) { const x = -ROAD_W / 2 + l * LANE_W; const booth = new THREE.Mesh(new THREE.BoxGeometry(0.9, 3.2, 4.5), M.post); booth.position.set(x, 1.6, 0); plaza.add(booth);
        const win = new THREE.Mesh(new THREE.BoxGeometry(0.95, 1, 2.2), M.win); win.position.set(x, 2.2, 0); plaza.add(win);
        for (const s2 of [-1, 1]) { const pl = new THREE.Mesh(new THREE.BoxGeometry(0.9, 6.5, 0.9), M.post); pl.position.set(x, 3, s2 * 4.2); plaza.add(pl); } }
      j.arms = [];
      for (let l = 0; l < LANES; l++) { const pivot = new THREE.Group(); pivot.position.set(-ROAD_W / 2 + l * LANE_W + 0.5, 1.4, -2.6); const arm = new THREE.Mesh(new THREE.BoxGeometry(LANE_W - 1, 0.18, 0.18), M.signWarn); arm.position.set((LANE_W - 1) / 2, 0, 0); pivot.add(arm); const tip = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, 0.3), M.blink); tip.position.set(LANE_W - 1.2, 0, 0); pivot.add(tip); plaza.add(pivot); j.arms.push(pivot); }
      // Stop line + rumble strips on the approach.
      for (let k = 0; k < 6; k++) { const st = new THREE.Mesh(new THREE.PlaneGeometry(ROAD_W, 0.35), M.edge); st.rotation.x = -Math.PI / 2; st.position.set(0, 0.012, 10 + k * 6); plaza.add(st); }
      placeAt(plaza, zArm, 0, 0); j.plaza = plaza; j.zArm = zArm; j.tollState = 'closed'; j.payT = 0; j.armAngle = 0;
    }
  }
  for (const hz of hazards) {
    roadsideSign(hz.z - 260, ['⚠ ' + ({ debris: 'DEBRIS', breakdown: 'BREAKDOWN', cones: 'LANES CLOSED' })[hz.kind], 'AHEAD 250 m'], M.signWarn, 1, false);
    hz.objs = [];
    if (hz.kind === 'debris') for (let i = 0; i < 3; i++) { const d = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.7, 1.2), M.debris); const lane = (hz.lane + i) % LANES; placeAt(d, hz.z + i * 9, laneX(lane) + (i % 2 ? 0.8 : -0.6), 0.35); hz.objs.push({ mesh: d, z: hz.z + i * 9, x: laneX(lane) + (i % 2 ? 0.8 : -0.6), hw: 0.6, hl: 0.6, dmg: HAZARD_DMG, live: true }); }
    if (hz.kind === 'breakdown') { const lane = Math.min(hz.lane, LANES - 2); const t = makeCar(true, 0x777777); placeAt(t, hz.z, laneX(lane) + LANE_W / 2, 0); t.rotation.y += 0.5; hz.objs.push({ mesh: t, z: hz.z, x: laneX(lane) + LANE_W / 2, hw: 3.2, hl: 5.2, dmg: CAR_HIT_DMG, live: true, car: true, blink: true }); }
    if (hz.kind === 'cones') for (let i = 0; i < 14; i++) { const c = new THREE.Mesh(G.cone, M.cone); const zz = hz.z + i * 9; const x = i < 4 ? ROAD_W / 2 - LANE_W * (i / 4) * 2 : ROAD_W / 2 - LANE_W * 2; placeAt(c, zz, x, 0.45); hz.objs.push({ mesh: c, z: zz, x, hw: 0.4, hl: 0.4, dmg: 1.5, live: true }); }
  }
  const gate = new THREE.Group();
  { const m = new THREE.MeshLambertMaterial({ color: 0xffd166 });
    for (const s of [-1, 1]) { const p = new THREE.Mesh(new THREE.BoxGeometry(1, 9, 1), m); p.position.set(s * (HALF + LANE_W + 0.5), 4.5, 0); gate.add(p); }
    const bar = new THREE.Mesh(new THREE.BoxGeometry(HALF * 2 + LANE_W * 2 + 2, 1.2, 1), m); bar.position.set(0, 9, 0); gate.add(bar);
    const t = textPanel(['◆ ' + plan.cities.find((c) => c.id === plan.toId).name], 12, 2, '#1f6b3a', '#ffffff'); t.position.set(0, 11, 0); t.rotation.y = Math.PI; gate.add(t);
    placeAt(gate, total, 0, 0); }

  // ── Vehicles ──────────────────────────────────────────────────────────────
  function addBlinkers(g, halfW, frontZ, rearZ, y) {
    g.userData.blink = { L: [], R: [] };
    /* ⚠ Every vehicle is turned 180° (see makeCar), so the model's local −x
       ends up on the driver's RIGHT. [[-1,'L'],[1,'R']] lit the wrong side
       for the rig and for traffic alike (owner, v121v111). */
    for (const [side, key] of [[1, 'L'], [-1, 'R']]) for (const z of [frontZ, rearZ]) { const m = new THREE.Mesh(G.blinkG, M.blinkOff); m.position.set(side * (halfW - 0.05), y, z); g.add(m); g.userData.blink[key].push(m); }
  }
  function setBlink(g, dir, on) {
    const b = g.userData.blink; if (!b) return;
    b.L.forEach((m) => { m.material = ((dir < 0 || dir === 2) && on) ? M.blink : M.blinkOff; });
    b.R.forEach((m) => { m.material = ((dir > 0) && on) ? M.blink : M.blinkOff; });
  }
  /* Vehicles travel toward −Z, so every model is built nose-at-+Z for
     readability and turned 180° here. */
  function makeCar(truck, color, mat) {
    const outer = new THREE.Group(); const g = new THREE.Group(); g.rotation.y = Math.PI; outer.add(g);
    const body = mat || carMat(color);
    if (truck) {
      const cab = new THREE.Mesh(carGeo('cab', 2.4, 2.4, 2.6), body); cab.position.set(0, 1.5, 3.2); cab.userData.body = true; g.add(cab);
      const box = new THREE.Mesh(carGeo('box', 2.5, 2.8, 8.5), BOX_M); box.position.set(0, 1.7, -2.4); g.add(box);
      const gl = new THREE.Mesh(carGeo('tgl', 2.2, 0.8, 0.1), M.glass); gl.position.set(0, 2.1, 4.52); g.add(gl);
      for (const [x, z] of [[-1.1, 3.2], [1.1, 3.2], [-1.1, -1], [1.1, -1], [-1.1, -5], [1.1, -5]]) { const w = new THREE.Mesh(G.wheel, M.wheel); w.rotation.z = Math.PI / 2; w.position.set(x, 0.42, z); g.add(w); }
      addBlinkers(g, 1.25, 4.45, -6.6, 1.1);
      outer.userData.halfL = 6.6; outer.userData.halfW = 1.3;
    } else {
      const b = new THREE.Mesh(carGeo('car', 1.9, 0.8, 4.3), body); b.position.y = 0.7; b.userData.body = true; g.add(b);
      const top = new THREE.Mesh(carGeo('roof', 1.6, 0.6, 2.2), body); top.position.set(0, 1.4, -0.2); top.userData.body = true; g.add(top);
      const gl = new THREE.Mesh(carGeo('cgl', 1.5, 0.5, 0.1), M.glass); gl.position.set(0, 1.4, 0.95); g.add(gl);
      for (const [x, z] of [[-0.9, 1.4], [0.9, 1.4], [-0.9, -1.4], [0.9, -1.4]]) { const w = new THREE.Mesh(G.wheel, M.wheel); w.rotation.z = Math.PI / 2; w.position.set(x, 0.42, z); g.add(w); }
      addBlinkers(g, 0.95, 2.1, -2.1, 0.75);
      outer.userData.halfL = 2.2; outer.userData.halfW = 1.0;
    }
    return outer;
  }
  const carPool = { t: [], c: [] };
  function takeCar(truck, color) {
    const m = carPool[truck ? 't' : 'c'].pop();
    if (!m) return makeCar(truck, color);
    const paint = carMat(color);
    m.children[0].children.forEach((c) => { if (c.userData.body) c.material = paint; });
    m.rotation.set(0, 0, 0); setBlink(m.children[0], 0, false);
    return m;
  }
  function dropCar(v) { scene.remove(v.mesh); carPool[v.truck ? 't' : 'c'].push(v.mesh); }
  const rigOuter = new THREE.Group(); const rig = new THREE.Group(); rig.rotation.y = Math.PI; rigOuter.add(rig);
  let alive = true;
  const proc = [];   // the procedural rig — hidden, not removed, when a model takes over
  { const cab = new THREE.Mesh(new THREE.BoxGeometry(2.3, 2.3, 2.4), M.player); cab.position.set(0, 1.45, 2.9); rig.add(cab); proc.push(cab);
    const gl = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.8, 0.1), M.glass); gl.position.set(0, 2.0, 4.12); rig.add(gl); proc.push(gl);
    const bed = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.5, 6), new THREE.MeshLambertMaterial({ color: 0x333 })); bed.position.set(0, 0.85, -1.4); rig.add(bed); proc.push(bed);
    /* Cargo: a GROUP per slot with the crate as its child, so a container model
       can replace the crate and the cargo animation in draw() (scale + tilt on
       every `userData.cargo` child of the rig) never has to know. The group's
       origin is the slot's floor, so a shrinking container sinks onto the deck. */
    for (let i = 0; i < 3; i++) { const slot = new THREE.Group(); slot.position.set(0, 1.1, 0.4 - i * 1.9); slot.userData.cargo = true; const c = new THREE.Mesh(new THREE.BoxGeometry(2.0, 1.4, 1.6), M.cargo); c.position.y = 0.7; slot.add(c); rig.add(slot); }
    for (const [x, z] of [[-1.05, 2.9], [1.05, 2.9], [-1.05, -0.8], [1.05, -0.8], [-1.05, -3.4], [1.05, -3.4]]) { const w = new THREE.Mesh(G.wheel, M.wheel); w.rotation.z = Math.PI / 2; w.position.set(x, 0.42, z); rig.add(w); proc.push(w); }
    if (opts.guard) { const gd = new THREE.Mesh(new THREE.BoxGeometry(0.7, 1.2, 0.7), new THREE.MeshLambertMaterial({ color: 0x2f5d3a })); gd.position.set(0.6, 3.1, 2.9); rig.add(gd); const gun = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.15, 1.6), M.wheel); gun.position.set(0.6, 3.4, 1.8); rig.add(gun); rig.userData.guard = [gd, gun]; }
    addBlinkers(rig, 1.2, 4.05, -4.35, 1.0);
    scene.add(rigOuter); }
  /* 🚛 The chosen truck's model, when it has one. Fitted to the traffic
     trucks' width (2.4 m) and capped at their length; the collision box and
     the chase camera follow the fitted length; the containers go on the deck. */
  (async () => {
    if (!RIG.model || !RIG.model.url) return;
    let truck, size;
    /* 🚧 A Wrecked or Salvage rig drives the SAME full-resolution model with its
       paint dimmed. v121v120: the 1.1k-tri "wrecked" pack it used to swap in
       fell apart to a handful of triangles — the owner asked for resolution. */
    const wrecked = /^(Wrecked|Salvage)$/.test(String(RIG.condition || ''));
    try { const raw = await haulLoadGLB(THREE, RIG.model.url); if (wrecked) raw.traverse((o) => { if (o.isMesh && o.material && o.material.color) { o.material = o.material.clone(); o.material.color.multiplyScalar(0.6); } }); const fit = haulFit(THREE, raw, { w: 2.6, l: 15.0 }, haulAutoOrient(THREE, raw, RIG.model.url), true); truck = fit.node; size = fit; }
    catch (e) { try { console.warn('[haul] rig model', RIG.model.url, e && e.message); } catch (e2) {} return; }
    if (!alive) return;
    truck.userData.rigModel = true; rig.add(truck);
    proc.forEach((o) => { o.visible = false; });
    /* 🟧 The blinkers move onto the model's own four corners. They stayed where
       the old box rig's corners were — inside a 15 m truck, halfway along it,
       where a player could not tell which side was lit. */
    { const bl = rig.userData.blink, hw = size.w / 2 + 0.02, fz = size.l / 2 - 0.3, rz = -size.l / 2 + 0.3, by = Math.min(1.3, Math.max(0.8, size.h * 0.3));
      if (bl) for (const [key, sx] of [['L', 1], ['R', -1]]) bl[key].forEach((m, i) => { m.position.set(sx * hw, by, i === 0 ? fz : rz); m.scale.setScalar(1.8); }); }
    PLAYER_HALF_L = Math.max(BASE_PLAYER_HALF_L, Math.min(7.6, size.l / 2));
    S.camExtra = Math.max(0, (PLAYER_HALF_L - BASE_PLAYER_HALF_L) * 1.15);
    if (rig.userData.guard) { const y = size.h + 0.6; rig.userData.guard[0].position.set(0.6, y, size.l / 2 - 2.2); rig.userData.guard[1].position.set(0.6, y + 0.3, size.l / 2 - 3.3); }
    const deck = haulDeckOf(THREE, truck, size, rig);
    S._deck = deck;
    const slots = rig.children.filter((c) => c.userData.cargo);
    /* A truck with no deck in its mesh (a box body, a tanker) carries its own
       load: no containers stacked on its roof. The crates go too — the cargo
       % still shows on the HUD, and damage still counts. */
    if (deck.guessed) { slots.forEach((slot) => { slot.visible = false; slot.userData.cargo = false; }); return; }
    // re-lay the cargo slots along the deck: one slot per container, rear first
    const span = Math.max(2.5, deck.z1 - deck.z0), gapZ = 0.25;
    const usable = span - gapZ * (HAUL_CONTAINERS.length + 1);
    let z = deck.z0 + gapZ;
    slots.forEach((slot, i) => {
      const spec = HAUL_CONTAINERS[i];
      if (!spec) { slot.visible = false; slot.userData.cargo = false; return; }
      const L = usable * spec.frac;
      slot.position.set(0, deck.top, z + L / 2); z += L + gapZ;
      slot.children.forEach((c) => { c.scale.set(1, 1, L / 1.6); c.position.y = 0.7; });   // the crate stretches to the slot until the model lands
      haulLoadGLB(THREE, spec.url).then((box) => {
        if (!alive) return;
        const fit = haulFit(THREE, box, { w: Math.max(1.6, size.w - 0.15), l: L, h: 2.1 }, spec.rotY, false);
        slot.children.slice().forEach((c) => { c.visible = false; });
        slot.add(fit.node);
      }).catch((e) => { try { console.warn('[haul] container', spec.url, e && e.message); } catch (e2) {} });
    });
  })();
  const tracer = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 30), M.tracer); tracer.visible = false; scene.add(tracer);

  // Rain: a cloud of short streaks that rides along with the camera.
  let rain = null;
  if (weather.rain) {
    const N = 500; const pos = new Float32Array(N * 6);
    for (let i = 0; i < N; i++) { const x = (Math.random() - 0.5) * 60, y = Math.random() * 25, z = (Math.random() - 0.5) * 80; pos.set([x, y, z, x + 0.2, y - 1.4, z], i * 6); }
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    rain = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: 0x9fb4d8, transparent: true, opacity: 0.45 })); scene.add(rain);
  }

  const traffic = [];
  const TRAFFIC_COLORS = [0x7a8aa0, 0xa04040, 0x4060a0, 0x9a9a70, 0x507050, 0xc0c0c0, 0x604080];
  function spawnTraffic(zAhead, behind) {
    const truck = Math.random() < 0.3;
    const lane = Math.floor(Math.random() * LANES);
    if (hazards.some((h) => Math.abs(h.z - zAhead) < 120)) return;
    // Nothing spawns inside a toll plaza: the rig has to pull away from the
    // booth into clear road, not into a car crawling through the arms.
    if (junctions.some((j) => j.toll && Math.abs(j.zArm - zAhead) < 260)) return;
    if (traffic.some((t) => t.lane === lane && Math.abs(t.z - zAhead) < 24)) return;   // checked BEFORE a car is taken
    // a car coming up from behind must actually be faster than the rig it is joining
    const cruise = Math.max((truck ? 17 : 22) + Math.random() * (truck ? 5 : 11), behind ? S.speed + 6 + Math.random() * 6 : 0);
    const mesh = takeCar(truck, TRAFFIC_COLORS[Math.floor(Math.random() * TRAFFIC_COLORS.length)]);
    const v = { mesh, lane, x: laneX(lane), z: zAhead, speed: cruise, cruise, truck, halfL: mesh.userData.halfL, halfW: mesh.userData.halfW, hitCd: 0,
                phase: 'cruise', toLane: lane, sigDir: 0, sigT: 0, decideCd: 1 + Math.random() * 3 };
    scene.add(mesh); traffic.push(v);
  }

  // ── State ─────────────────────────────────────────────────────────────────
  const S = {
    z: 0, x: 0, speed: 0, heading: 0, t: 0, cargo: 100, cc: 0, cr: 0, hz: 0, wrongExits: 0, detourM: 0, total, merge: null, camExtra: 0,
    railCd: 0, steer: 0, done: false, paused: false, abandoned: false, started: false, jIdx: 0, tollsHit: 0, tollsPaid: [],
    raider: null, raiderIdx: 0, raidersBeaten: 0, raiderHits: 0, guardUsed: false, tracerT: 0,
    keys: {}, touch: { left: false, right: false, brake: false },
  };
  // 🧪 Read-only peek for driven tests (window.__haulRun.t vs wall time tells
  //    you the sim is running at speed). Nothing reads it in the game.
  try { window.__haulRun = S; S._traffic = traffic; S._plan = plan; } catch (e) {}
  const isTouch = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);
  if (isTouch) { root.classList.add('haul-is-touch'); $('haul-hint').textContent = 'Auto throttle · tap ◀ ▶ to steer · hold BRAKE'; }
  const rightLimit = () => HALF + (rampAt(S.z) ? LANE_W : 0);

  // ── Input ─────────────────────────────────────────────────────────────────
  const onKey = (e) => {
    if (e.type === 'keydown' && e.key === 'Escape') { e.preventDefault(); togglePause(); return; }
    const k = e.key.toLowerCase();
    if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'w', 'a', 's', 'd', ' '].includes(k)) { S.keys[k] = (e.type === 'keydown'); e.preventDefault(); }
  };
  window.addEventListener('keydown', onKey); window.addEventListener('keyup', onKey);
  /* a read-only window for the test harness (tools/athena-harness/pw-haul.mjs); off unless a page sets window.__HAUL_DEBUG */
  try { if (window.__HAUL_DEBUG) window.__HAUL_DEBUG.run = { S, traffic, rig, rigOuter, cam, scene, get halfL() { return PLAYER_HALF_L; } }; } catch (e) {}
  root.querySelectorAll('.haul-tbtn').forEach((b) => {
    const t = b.dataset.t;
    const on = (ev) => { ev.preventDefault(); S.touch[t] = true; };
    const off = (ev) => { ev.preventDefault(); S.touch[t] = false; };
    b.addEventListener('pointerdown', on); b.addEventListener('pointerup', off); b.addEventListener('pointercancel', off); b.addEventListener('pointerleave', off);
  });
  function togglePause() { if (S.done || !S.started) return; S.paused = !S.paused; $('haul-pause').hidden = !S.paused; }
  $('haul-resume').onclick = () => { S.paused = false; $('haul-pause').hidden = true; };
  $('haul-abandon').onclick = () => { S.abandoned = true; finish(); };
  const onResize = () => {
    const w = root.clientWidth || window.innerWidth, h = root.clientHeight || window.innerHeight;
    renderer.setSize(w, h, false); cam.aspect = w / h; cam.updateProjectionMatrix();
  };
  window.addEventListener('resize', onResize); onResize();

  // ── GPS minimap ───────────────────────────────────────────────────────────
  const gps = $('haul-gps').getContext('2d');
  const gpsBox = (() => {
    const ids = new Set(plan.route.path); plan.route.path.forEach((id) => { const c = plan.cities.find((x) => x.id === id); (c.connections || []).forEach((n) => ids.add(n)); });
    const pts = [...ids].map((id) => plan.cities.find((c) => c.id === id)).filter(Boolean);
    const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
    return { x0: Math.min(...xs) - 4, y0: Math.min(...ys) - 4, x1: Math.max(...xs) + 4, y1: Math.max(...ys) + 4, ids };
  })();
  function gpsPt(c) { const W = 240, H = 170; const sx = W / (gpsBox.x1 - gpsBox.x0), sy = H / (gpsBox.y1 - gpsBox.y0); const s = Math.min(sx, sy); return [(c.x - gpsBox.x0) * s + (W - (gpsBox.x1 - gpsBox.x0) * s) / 2, (c.y - gpsBox.y0) * s + (H - (gpsBox.y1 - gpsBox.y0) * s) / 2]; }
  function drawGps() {
    const W = 240, H = 170; gps.clearRect(0, 0, W, H);
    gps.fillStyle = 'rgba(8,10,16,.85)'; gps.fillRect(0, 0, W, H);
    const byId = {}; plan.cities.forEach((c) => { byId[c.id] = c; });
    gps.strokeStyle = 'rgba(255,255,255,.18)'; gps.lineWidth = 1;
    for (const id of gpsBox.ids) { const c = byId[id]; if (!c) continue; for (const n of c.connections) { if (!gpsBox.ids.has(n) || !byId[n]) continue; const a = gpsPt(c), b = gpsPt(byId[n]); gps.beginPath(); gps.moveTo(a[0], a[1]); gps.lineTo(b[0], b[1]); gps.stroke(); } }
    gps.strokeStyle = '#ffb060'; gps.lineWidth = 3; gps.beginPath();
    plan.route.path.forEach((id, i) => { const p = gpsPt(byId[id]); if (i === 0) gps.moveTo(p[0], p[1]); else gps.lineTo(p[0], p[1]); }); gps.stroke();
    for (const id of gpsBox.ids) { const c = byId[id]; if (!c) continue; const p = gpsPt(c); const onRoute = plan.route.path.includes(id); gps.fillStyle = onRoute ? '#ffd166' : '#8090a8'; gps.beginPath(); gps.arc(p[0], p[1], onRoute ? 4 : 2.5, 0, Math.PI * 2); gps.fill();
      if (onRoute) { gps.fillStyle = '#e8e0d0'; gps.font = 'bold 9px sans-serif'; gps.fillText(c.name.slice(0, 12), p[0] + 6, p[1] + 3); } }
    // The rig: interpolated along the current leg.
    let z0 = 0, legI = 0; for (let i = 0; i < junctions.length; i++) { if (S.z >= junctions[i].z) { z0 = junctions[i].z; legI = i + 1; } else break; }
    const a = byId[plan.route.path[Math.min(legI, plan.route.path.length - 1)]], b = byId[plan.route.path[Math.min(legI + 1, plan.route.path.length - 1)]];
    const z1 = junctions[legI] ? junctions[legI].z : total; const f = Math.max(0, Math.min(1, (S.z - z0) / Math.max(1, z1 - z0)));
    const pa = gpsPt(a), pb = gpsPt(b); const px = pa[0] + (pb[0] - pa[0]) * f, py = pa[1] + (pb[1] - pa[1]) * f;
    gps.fillStyle = '#6cd4ff'; gps.beginPath(); gps.arc(px, py, 5, 0, Math.PI * 2); gps.fill(); gps.strokeStyle = '#fff'; gps.lineWidth = 1.5; gps.stroke();
    const j = junctions[S.jIdx];
    let txt = '🏁 Arrived';
    if (j) { const d = Math.max(0, Math.round(j.z + RAMP_OUT - S.z)); txt = (j.viaExit ? '↗ TAKE THE EXIT' : '↑ STAY ON') + ' in ' + (d >= 1000 ? (d / 1000).toFixed(1) + ' km' : d + ' m') + ' → ' + j.nextName + (j.toll && j.tollState !== 'open' ? ' · 🛑 toll booth first' : ''); }
    $('haul-gps-txt').textContent = txt;
  }

  // ── The loop ──────────────────────────────────────────────────────────────
  let raf = 0, last = performance.now(), flashT = 0, resolveDone;
  const done = new Promise((res) => { resolveDone = res; });
  let count = 3; const cEl = $('haul-count');
  const countTimer = setInterval(() => { count--; if (count > 0) cEl.textContent = String(count); else { cEl.textContent = 'GO'; setTimeout(() => { cEl.hidden = true; }, 500); S.started = true; clearInterval(countTimer); } }, 800);

  function step(now) {
    raf = requestAnimationFrame(step);
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    if (S.done) return;
    if (S.started && !S.paused) simulate(dt);
    draw();
  }
  function simulate(dt) {
    S.t += dt;
    const K = S.keys, T = S.touch;
    const gas = isTouch ? !T.brake : (K.arrowup || K.w);
    const brake = isTouch ? T.brake : (K.arrowdown || K.s || K[' ']);
    const left = K.arrowleft || K.a || T.left, right = K.arrowright || K.d || T.right;
    const grip = weather.grip;
    if (brake) S.speed = Math.max(0, S.speed - 34 * cls.brake * up.brake * RIG.brake * grip * dt);
    else if (gas) S.speed = Math.min(MAX_SPEED, S.speed + (S.speed < 20 ? 16 : 9) * cls.accel * up.accel * RIG.accel * (1 - 0.5 * S.speed / MAX_SPEED) * dt);
    else S.speed = Math.max(0, S.speed - (3 + S.speed * 0.04) * dt);   // rolling + air drag
    const steer = (right ? 1 : 0) - (left ? 1 : 0);
    /* 🚛 HANDLING — a bicycle model rather than "x moves sideways". The wheel
       turns toward the input at a finite rate, its maximum angle shrinks with
       speed (you cannot crank a rig over at 200 km/h), yaw comes from
       v·tan(δ)/wheelbase, and the nose drifts back to straight when you let
       go. So a lane change at speed needs an early, gentle input and a
       counter-steer, a heavy Construction rig turns late, and a Utility 4x4
       flicks. Rain scales grip, the rig's steer figure scales authority. */
    const maxSteer = (0.42 - 0.34 * Math.min(1, S.speed / MAX_SPEED)) * RIG.steer;
    const target = steer * maxSteer;
    S.steer += Math.max(-2.2 * dt, Math.min(2.2 * dt, target - S.steer));
    if (!steer) S.steer *= Math.pow(0.05, dt);
    // Tyres, not geometry, limit the turn at speed: lateral acceleration is
    // capped (~7 m/s² for a loaded rig, less in rain), so at 150 km/h a lane
    // change takes a second and a half however hard you crank the wheel.
    const geo = S.speed * Math.tan(S.steer) / WHEELBASE;
    const cap = (7 * grip * (0.85 + 0.3 * RIG.steer)) / Math.max(3, S.speed);
    const yawRate = Math.max(-cap, Math.min(cap, geo)) * grip;
    S.heading += yawRate * dt;
    // Self-centring: a rig tracks straight down a lane when the wheel is free.
    if (!steer) S.heading *= Math.pow(0.35, dt);
    S.heading = Math.max(-0.6, Math.min(0.6, S.heading));
    S.x += Math.sin(S.heading) * S.speed * dt;
    S.z += Math.cos(S.heading) * S.speed * dt;
    // Blinkers: your own input, or the ramp is open at YOUR exit.
    const jNow = junctions[S.jIdx];
    const rampOpen = !!(jNow && jNow.viaExit && S.z > jNow.z - RAMP_IN && S.z < jNow.z + RAMP_OUT);
    setBlink(rig, steer || (rampOpen ? 1 : 0), (steer !== 0 || rampOpen) && (Math.floor(S.t * 3) % 2 === 0));
    // 🛣 Merging onto the next highway: ease the rig from the ramp into the
    //    slow lane over the merge, and hold the rails off while it does.
    if (S.merge) {
      S.merge.t += dt;
      const k = Math.min(1, S.merge.t / S.merge.dur), e = k * k * (3 - 2 * k);
      S.x = S.merge.fromX + (laneX(LANES - 1) - S.merge.fromX) * e;
      S.heading *= 0.8;
      if (k >= 1) { S.merge = null; hideMerge(); flash('🛣 ' + String(j0Name()).toUpperCase() + ' HIGHWAY'); }
    }
    // Rails. The right rail moves out a lane inside a ramp window.
    S.railCd = Math.max(0, S.railCd - dt);
    const rl = rightLimit();
    if (!S.merge && (S.x + PLAYER_HALF_W > rl || -S.x + PLAYER_HALF_W > HALF)) {
      S.x = S.x > 0 ? rl - PLAYER_HALF_W : -(HALF - PLAYER_HALF_W);
      S.heading *= 0.3; S.steer *= 0.5;   // the rail straightens you out
      if (S.railCd <= 0) { S.cr++; S.railCd = 0.7; damage(RAIL_HIT_DMG * (0.5 + S.speed / MAX_SPEED) * cls.railMul); flash('🛤 RAIL'); }
      // Per-SECOND decay via pow(dt): a per-frame multiplier stopped the rig
      // dead on fast screens and barely slowed it on slow ones.
      S.speed *= Math.pow(0.55, dt);
    }
    // ── Exit callouts: "your exit is coming up" 500 m out, and a turn sign
    //    while the ramp is open at an exit that is yours.
    const j = junctions[S.jIdx];
    if (j && j.viaExit && !j.calledUp && S.z > j.z - 520) { j.calledUp = true; flash('↗ YOUR EXIT IS COMING UP → ' + j.nextName); }
    const turnEl = $('haul-turn');
    if (rampOpen) { turnEl.hidden = false; turnEl.textContent = (Math.floor(S.t * 3) % 2 === 0 ? '↗ ' : '  ') + 'EXIT OPEN — TURN NOW → ' + j.nextName; }
    else if (j && !j.viaExit && S.z > j.z - RAMP_IN && S.z < j.z + RAMP_OUT) { turnEl.hidden = false; turnEl.textContent = '↑ STAY ON — not your exit'; }
    else turnEl.hidden = true;
    if (j && S.z >= j.z + RAMP_OUT) {
      const tookExit = S.x > ROAD_W / 2 + 0.3;
      if (tookExit === j.viaExit) { flash(j.last ? '🏁 ' + j.node.name : '✓ ' + (tookExit ? 'EXIT' : 'THRU') + ' → ' + j.nextName); }
      else {
        // Wrong road. The reroute is a real detour: more road on the clock.
        const legLen = (junctions[S.jIdx + 1] ? junctions[S.jIdx + 1].z : total) - j.z;
        const detour = Math.max(150, Math.round(legLen * 0.18));
        S.wrongExits++; S.detourM += detour; S.total += detour;
        for (let k = S.jIdx + 1; k < junctions.length; k++) junctions[k].z += detour;
        for (const h of hazards) if (h.z > S.z) { h.z += detour; h.objs.forEach((o) => { o.z += detour; placeAt(o.mesh, o.z, o.x, o.mesh.position.y); }); }
        gate.position.set(centreX(S.total), 0, -S.total);
        flash('✖ WRONG ' + (tookExit ? 'EXIT' : 'TURN') + ' — REROUTING +' + detour + ' m');
      }
      if (tookExit) {
        if (j.viaExit && !j.last) {
          /* 🛣 A REAL EXIT (owner, 2026-09-11): the ramp leaves this highway for
             the next one. New scenery seed and palette on every segment, a
             merge overlay naming the road, and the rig eased into the slow
             lane over the merge instead of being clamped back where it was. */
          legSeed = hash(j.nextName + '|' + S.jIdx); legPal = legPal + 1;
          for (const sg of segs) placeSegment(sg, sg.z0);
          S.merge = { t: 0, dur: 2.4, fromX: S.x, name: j.nextName };
          showMerge('↗ EXIT → ' + String(j.nextName).toUpperCase() + ' HIGHWAY');
        } else { S.x = Math.min(S.x, ROAD_W / 2 - PLAYER_HALF_W - 0.2); }
      }
      S.jIdx++;
    }
    // ── Toll plazas: a full stop at the booth, then the arms lift.
    for (const jj of junctions) {
      if (!jj.toll || jj.tollState === 'open') continue;
      const nose = S.z + PLAYER_HALF_L;
      if (jj.tollState === 'closed' && S.z > jj.zArm - 220 && !jj.warned) { jj.warned = true; flash('🛑 TOLL BOOTH AHEAD — STOP'); }
      if (nose >= jj.zArm - 0.3) {
        // The arm is a wall. Rolling into it under ~45 km/h is a bump and a
        // stop; faster than that is a hit. Either way you are stopped here.
        if (S.speed > 12.5) { S.cr++; damage(RAIL_HIT_DMG * 2); flash('🚧 RAN THE TOLL ARM'); }
        else if (S.speed > 1) flash('🛑 STOPPED AT THE BOOTH');
        S.z = jj.zArm - PLAYER_HALF_L - 0.3; S.speed = 0;
      }
      if (S.speed < 0.6 && nose > jj.zArm - 9) {
        if (jj.tollState === 'closed') { jj.tollState = 'paying'; flash('💰 PAYING TOLL · ' + (jj.tollOwner || jj.node.name)); }
        jj.payT += dt;
        // Paid — but the arm only lifts once the lane ahead is clear, so you
        // are never waved into the back of the car that just paid.
        if (jj.payT >= TOLL_PAY_S) {
          const myLane = Math.max(0, Math.min(LANES - 1, Math.floor((S.x + ROAD_W / 2) / LANE_W)));
          const blocked = traffic.some((o) => o.lane === myLane && o.z > S.z && o.z - S.z < 30);
          if (!blocked) { jj.tollState = 'open'; S.tollsHit++; flash('✓ TOLL PAID — CLEAR AHEAD, GO'); }
          else if (!jj.waitFlash) { jj.waitFlash = true; flash('💰 TOLL PAID — WAIT FOR THE CAR AHEAD'); }
        }
      }
    }
    // ── Hazards.
    for (const h of hazards) for (const o of h.objs) {
      if (!o.live || Math.abs(o.z - S.z) > 12) continue;
      if (Math.abs(o.z - S.z) < o.hl + PLAYER_HALF_L && Math.abs(o.x - S.x) < o.hw + PLAYER_HALF_W) {
        o.live = false; if (o.car) { S.cc++; damage(o.dmg * (0.5 + S.speed / MAX_SPEED)); S.speed *= 0.45; flash('🚗 CRASH'); }
        else { S.hz++; damage(o.dmg * cls.railMul * (0.5 + S.speed / MAX_SPEED)); S.speed *= 0.82; flash('⚠ ' + (h.kind === 'cones' ? 'CONE' : 'DEBRIS')); if (!o.car) { o.mesh.position.y = -2; } }
      }
    }
    // ── Traffic AI. Every vehicle keeps a headway to whatever is ahead in
    //    its lane — another vehicle OR the rig — so nothing drives through
    //    anything. Blocked (or restless) vehicles signal, wait, re-check the
    //    target lane both ways, then drift across.
    const aheadOf = (v, lane) => {
      let best = null, bestD = Infinity;
      for (const o of traffic) { if (o === v || o.lane !== lane && o.toLane !== lane) continue; const d = o.z - v.z; if (d > 0 && d < bestD) { bestD = d; best = { z: o.z, speed: o.speed, halfL: o.halfL }; } }
      if (Math.abs(S.x - laneX(lane)) < LANE_W * 0.75) { const d = S.z - v.z; if (d > 0 && d < bestD) { bestD = d; best = { z: S.z, speed: S.speed, halfL: PLAYER_HALF_L, rig: true }; } }
      return best;
    };
    // Hazards are the DRIVER's problem. Traffic only slows and tries to get
    // out of the lane; it never stops for one — a wall of stopped cars behind
    // one debris pile gridlocked the whole road in a driven test.
    const hazardAhead = (v) => { for (const h of hazards) for (const o of h.objs) { if (!o.live || Math.abs(o.x - laneX(v.lane)) > LANE_W * 0.8) continue; const d = o.z - v.z; if (d > 0 && d < 70) return true; } return false; };
    const laneClear = (v, lane, relaxed) => {
      const margin = relaxed ? 2 : 22;   // a stalled car only needs to not overlap
      for (const o of traffic) { if (o === v) continue; if ((o.lane === lane || o.toLane === lane) && Math.abs(o.z - v.z) < margin + v.halfL + o.halfL) return false; }
      if (Math.abs(S.x - laneX(lane)) < LANE_W * 0.75 && Math.abs(S.z - v.z) < 26 + v.halfL + PLAYER_HALF_L) return false;
      return true;
    };
    const density = 1 / (30 - Math.min(10, (S.z / total) * 10));
    const want = Math.floor(320 * density * Math.min(1.25, (110 + weather.fogFar) / 490));   // the road is as long as you can see down it
    for (let i = traffic.length - 1; i >= 0; i--) {
      const v = traffic[i];
      v.hitCd = Math.max(0, v.hitCd - dt);
      const lead = aheadOf(v, v.lane);
      const hz = hazardAhead(v);
      let wantS = hz ? v.cruise * 0.6 : v.cruise;
      // Toll plazas: traffic slows on the approach and stops at the booth (below).
      for (const jj of junctions) if (jj.toll && v.tolled !== jj) { const d = jj.zArm - v.z; if (d > -6 && d < 90) wantS = Math.min(wantS, Math.max(0, d * 0.35)); }
      if (lead) {
        const gap = lead.z - v.z - lead.halfL - v.halfL;
        const safe = 4 + v.speed * 0.9;
        if (gap < safe) wantS = Math.min(wantS, Math.max(0, lead.speed - (safe - gap) * 0.6));
        // only ever move a car BACK behind its lead (and never past the rig)
        if (gap < 0.3 && !lead.rig && lead.z > v.z) v.z = Math.max(v.z - 6 * dt, lead.z - lead.halfL - v.halfL - 0.3);
      }
      v.speed += Math.max(-9 * dt, Math.min(4 * dt, wantS - v.speed));
      v.z += v.speed * dt;
      v.decideCd -= dt;
      if (v.phase === 'cruise') {
        v.x += (laneX(v.lane) - v.x) * Math.min(1, dt * 1.5);
        const blocked = hz || (lead && lead.speed < v.cruise - 3 && (lead.z - v.z) < 40);
        const stalled = v.speed < 2 && lead && !lead.rig;
        if ((v.decideCd <= 0 && (blocked || Math.random() < dt * 0.04)) || stalled) {
          const dirs = [v.lane - 1, v.lane + 1].filter((l) => l >= 0 && l < LANES && laneClear(v, l, stalled));
          if (dirs.length) { v.toLane = dirs[Math.floor(Math.random() * dirs.length)]; v.sigDir = Math.sign(v.toLane - v.lane); v.phase = 'signal'; v.sigT = 0; }
          v.decideCd = 2 + Math.random() * 4;
        }
      } else if (v.phase === 'signal') {
        v.sigT += dt;
        if (!laneClear(v, v.toLane)) { v.phase = 'cruise'; v.toLane = v.lane; }
        else if (v.sigT > 1.2) { v.phase = 'move'; v.lane = v.toLane; }
      } else if (v.phase === 'move') {
        const tx = laneX(v.lane); v.x += (tx - v.x) * Math.min(1, dt * 2.2);
        if (Math.abs(tx - v.x) < 0.08) { v.x = tx; v.phase = 'cruise'; }
      }
      setBlink(v.mesh.children[0], v.sigDir || 0, v.phase !== 'cruise' && (Math.floor(S.t * 3) % 2 === 0));
      if (v.z < S.z - 70 || v.z > S.z + weather.fogFar + 40) { dropCar(v); traffic.splice(i, 1); continue; }
      // Toll booths: every car stops at the arm in its lane, pays (1.2 s),
      // and rolls on. They queue behind each other like anyone else, and
      // the rig queues behind them — nothing vanishes.
      for (const jj of junctions) if (jj.toll) {
        if (v.tolled === jj) continue;
        const stopAt = jj.zArm - v.halfL - 0.6;
        if (v.z >= stopAt) { v.z = stopAt; v.speed = 0; v.tollT = (v.tollT || 0) + dt; if (v.tollT >= 1.2) { v.tolled = jj; v.tollT = 0; v.speed = 2; jj.laneLift = jj.laneLift || {}; jj.laneLift[v.lane] = 1.6; } }
      }
      collideVehicle(v, dt);
    }
    // Bounded: spawnTraffic can decline (hazard or toll plaza in the window),
    // and an unbounded while spun forever beside a plaza and froze the page.
    /* 🚗 v121v120: a car used to appear 140–400 m ahead — inside clear weather's
       sight line, so it popped into view (the flicker). It comes in at the fog
       line now. And a rig slower than traffic used to watch every car pull away
       and nothing replace them ("does not appear after a while"): below
       20 m/s half the new cars come up from behind the camera instead. */
    const sightZ = weather.fogFar * 0.85;
    // the first tick lays the whole visible road with traffic, so a run never opens on an empty highway
    if (!S.trafficSeeded) { S.trafficSeeded = true; for (let tries = 0; traffic.length < want && tries < want * 4; tries++) spawnTraffic(S.z + 60 + Math.random() * (sightZ - 60), false); }
    for (let tries = 0; traffic.length < want && tries < 6; tries++) {
      const behind = S.speed < 20 && Math.random() < 0.5;
      spawnTraffic(behind ? S.z - 45 - Math.random() * 20 : S.z + sightZ + Math.random() * 30, behind);
    }
    // ── Raiders: one event at a time, from behind, fast, aimed at the rig.
    const nextRaid = plan.raiders[S.raiderIdx];
    if (!S.raider && nextRaid && S.z > nextRaid.z) {
      S.raiderIdx++;
      const mesh = makeCar(false, 0, M.raider); scene.add(mesh);
      S.raider = { mesh, x: S.x, z: S.z - 90, speed: S.speed + 8, halfL: 2.2, halfW: 1.0, hitCd: 0, t: 0, hits: 0, lane: 0, toLane: 0, sigDir: 0, phase: 'raid', blockedT: 0 };
      flash('🚨 RAIDERS BEHIND'); setBlink(mesh.children[0], 2, true);
    }
    if (S.raider) {
      const R = S.raider; R.t += dt; R.hitCd = Math.max(0, R.hitCd - dt);
      // A shot raider coasts and spins; only a live one pursues. (The pursuit
      // update used to run first and re-accelerated the wreck for the rest of
      // the run, which also blocked every later raider event.)
      if (!R.dead) {
        /* 🚗 Traffic is cover. The raider brakes behind whatever car is between
           it and the rig, swings round it when there is room, and gives up
           after RAIDER_GIVE_UP_S seconds held off — that counts as beaten. */
        const lead = raiderLead(R, S, traffic);
        const want = raiderSteer(R, S, lead, ROAD_W / 2, dt);
        R.speed += Math.max(-20 * dt, Math.min(14 * dt, want.speed - R.speed)); R.z += R.speed * dt;
        R.x += (want.x - R.x) * Math.min(1, dt * (want.blocked ? 2.2 : 1.6));
        if (lead && want.gap < 0.3 && lead.z - R.z > 0) R.z = lead.z - lead.halfL - R.halfL - 0.3;
        R.blockedT = want.blocked ? R.blockedT + dt : Math.max(0, R.blockedT - dt * 0.5);
        if (R.blockedT >= RAIDER_GIVE_UP_S) { S.raidersBeaten++; scene.remove(R.mesh); S.raider = null; flash('🚗 TRAFFIC HELD THE RAIDERS OFF'); }
      }
      if (!S.raider) { /* gave up */ } else {
      setBlink(R.mesh.children[0], 2, Math.floor(S.t * 6) % 2 === 0);
      const dist = S.z - R.z;
      // The guard: one engagement per run, fired when the raider closes in.
      if (opts.guard && !S.guardUsed && dist < 28 && dist > -6) {
        S.guardUsed = true; S.tracerT = 1.2; S.raidersBeaten++;
        R.dead = true; R.speed = 0; flash('🛡 GUARD OPENED FIRE'); const el = $('haul-guard'); if (el) el.textContent = '🛡 GUARD SPENT';
      }
      if (R.dead) { R.z -= 4 * dt; R.mesh.rotation.z += 3 * dt; if (S.z - R.z > 90) { scene.remove(R.mesh); S.raider = null; } }
      else {
        if (Math.abs(dist) < R.halfL + PLAYER_HALF_L && Math.abs(R.x - S.x) < R.halfW + PLAYER_HALF_W && R.hitCd <= 0) {
          R.hitCd = 1.4; R.hits++; S.raiderHits++; damage(RAIDER_DMG * cls.carMul); S.x += (S.x >= 0 ? 1 : -1) * 1.4; S.speed *= 0.9; flash('💥 RAMMED');
          R.z = S.z - R.halfL - PLAYER_HALF_L - 1;
        }
        if (R.t > 14 || R.hits >= 2 || R.z < S.z - 160) { if (R.hits < 2) S.raidersBeaten++; scene.remove(R.mesh); S.raider = null; flash(R.hits >= 2 ? '🚨 RAIDERS GOT WHAT THEY CAME FOR' : '✓ RAIDERS FELL BACK'); }
      }
      }
    }
    if (S.tracerT > 0) S.tracerT -= dt;
    for (const seg of segs) if (seg.z0 + SEG_LEN < S.z - 60) placeSegment(seg, seg.z0 + SEGS * SEG_LEN);
    if (S.z >= S.total) finish();
  }
  function collideVehicle(v, dt) {
    const dz = v.z - S.z, dx = v.x - S.x;
    if (Math.abs(dz) < v.halfL + PLAYER_HALF_L && Math.abs(dx) < v.halfW + PLAYER_HALF_W) {
      const rel = Math.abs(S.speed - v.speed);
      const closing = S.speed - v.speed;
      const rearEnd = Math.abs(dz) > Math.abs(dx) * 2.2 && dz > 0;
      /* A CRASH needs ~30 km/h of CLOSING speed. Sitting on somebody's bumper
         at their speed is tailgating, not an impact — a driven test showed
         "any contact counts" re-crashing every cooldown behind one slow truck
         until the cargo was gone. After a real hit the rig is dropped to 80%
         of their speed and re-closes at ~5 m/s, and a lower bar counted that
         re-contact as a second crash. Side swipes always count: you moved
         into them. */
      if (v.hitCd <= 0 && (!rearEnd || closing > 8)) {
        v.hitCd = 0.9; S.cc++;
        let d = CAR_HIT_DMG * (0.4 + rel / 30) * cls.carMul;
        if (cls.fire && closing > 25) { d += 25; flash('🔥 CARGO FIRE'); } else flash('🚗 CRASH');
        damage(d);
      }
      if (rearEnd) { S.speed = Math.min(S.speed, closing > 8 ? v.speed * 0.8 : v.speed); S.z = v.z - (v.halfL + PLAYER_HALF_L) - 0.05; }
      else { const push = Math.sign(dx || 1); S.x -= push * 1.6 * dt * 20; v.x = Math.max(-ROAD_W / 2 + v.halfW, Math.min(ROAD_W / 2 - v.halfW, v.x + push * 0.8 * dt * 20)); S.speed *= 0.93; }
    }
  }
  function damage(pct) { S.cargo = Math.max(0, S.cargo - pct * up.bed * RIG.armor); if (S.cargo <= 0) { flash('💥 CARGO LOST'); setTimeout(finish, 600); } }
  function flash(txt) { const f = $('haul-flash'); f.textContent = txt; f.classList.add('on'); flashT = 0.7; }
  /* 🛣 the merge overlay: a short dark wash with the new highway's name */
  function showMerge(txt) { const m = $('haul-merge'); if (!m) return; m.querySelector('.haul-merge-txt').textContent = txt; m.classList.add('on'); }
  function hideMerge() { const m = $('haul-merge'); if (m) m.classList.remove('on'); }
  function j0Name() { try { const jj = junctions[S.jIdx - 1]; return (jj && jj.nextName) || 'OPEN'; } catch (e) { return 'OPEN'; } }
  function draw() {
    const cx = centreX(S.z);
    const yaw = -Math.atan2((centreX(S.z + 1) - centreX(S.z - 1)) / 2, 1);
    rigOuter.position.set(cx + S.x, 0, -S.z); rigOuter.rotation.y = yaw - S.heading;
    rig.children.forEach((c) => { if (c.userData.cargo) { const k = 0.5 + 0.5 * (S.cargo / 100); c.scale.set(k, k, k); c.rotation.z = (1 - k) * 0.6; } });
    for (const v of traffic) { v.mesh.position.set(centreX(v.z) + v.x, 0, -v.z); v.mesh.rotation.y = -Math.atan2((centreX(v.z + 1) - centreX(v.z - 1)) / 2, 1); }
    if (S.raider) { const R = S.raider; R.mesh.position.set(centreX(R.z) + R.x, R.dead ? 0.3 : 0, -R.z); if (!R.dead) R.mesh.rotation.y = -Math.atan2((centreX(R.z + 1) - centreX(R.z - 1)) / 2, 1); }
    tracer.visible = S.tracerT > 0 && Math.floor(S.tracerT * 12) % 2 === 0;
    if (tracer.visible && S.raider) { tracer.position.set(cx + S.x + 0.6, 3.4, -(S.z - 12)); }
    for (const h of hazards) for (const o of h.objs) if (o.blink) setBlink(o.mesh.children[0], 2, Math.floor(S.t * 2) % 2 === 0);
    for (const jj of junctions) if (jj.arms) {
      jj.laneLift = jj.laneLift || {};
      jj.arms.forEach((a, l) => { const t = jj.laneLift[l]; if (t > 0) jj.laneLift[l] = t - 1 / 60; const target = (jj.tollState === 'open' || jj.laneLift[l] > 0) ? -1.35 : 0; a.rotation.z += (target - a.rotation.z) * 0.12; });
    }
    const camBack = 13 + (S.camExtra || 0) + S.speed * 0.08;
    cam.position.set(centreX(S.z - camBack) + S.x * 0.6, 6.2 + (S.camExtra || 0) * 0.4 + S.speed * 0.02, -(S.z - camBack));
    cam.lookAt(cx + S.x * 0.8, 1.6, -(S.z + 18));
    cam.fov = 62 + (S.speed / MAX_SPEED) * 12; cam.updateProjectionMatrix();
    if (rain) { rain.position.set(cam.position.x, 0, cam.position.z - 30); rain.position.y = -((S.t * 18) % 4); }
    $('haul-speed').textContent = String(Math.round(S.speed * 3.6));
    $('haul-cargo').textContent = Math.round(S.cargo) + '%';
    $('haul-cargo').style.color = S.cargo > 70 ? '#9ad17a' : S.cargo > 35 ? '#ffd166' : '#ff8aa0';
    $('haul-time').textContent = fmtT(S.t); $('haul-time').style.color = S.t > par ? '#ff8aa0' : '';
    $('haul-cc').textContent = String(S.cc); $('haul-cr').textContent = String(S.cr); $('haul-hz').textContent = String(S.hz);
    const p = Math.min(1, S.z / S.total);
    $('haul-prog-bar').style.width = (p * 100).toFixed(1) + '%';
    $('haul-prog-txt').textContent = ((S.total - S.z) / (total / km)).toFixed(1) + ' km to go' + (S.detourM ? ' · +' + S.detourM + ' m detour' : '');
    if (flashT > 0) { flashT -= 1 / 60; if (flashT <= 0) $('haul-flash').classList.remove('on'); }
    drawGps();
    renderer.render(scene, cam);
  }
  function finish() {
    if (S.done) return; S.done = true;
    const completed = !S.abandoned && S.z >= S.total && S.cargo > 0;
    destroy();
    resolveDone({
      completed, abandoned: S.abandoned, timeS: Math.round(S.t), parS: par, km,
      crashesCar: S.cc, crashesRail: S.cr + S.hz, hazards: S.hz, cargoPct: completed ? Math.round(S.cargo) / 100 : 0,
      wrongExits: S.wrongExits, detourM: S.detourM, tolls: S.tollsHit, raiders: S.raiderIdx, raidersBeaten: S.raidersBeaten, raiderHits: S.raiderHits,
      guardUsed: S.guardUsed, weather: weather.id, cargoClass: cls.id, rig: RIG.name, distanceM: Math.round(S.z), totalM: S.total,
    });
  }
  function destroy() {
    alive = false;
    cancelAnimationFrame(raf); clearInterval(countTimer);
    window.removeEventListener('keydown', onKey); window.removeEventListener('keyup', onKey); window.removeEventListener('resize', onResize);
    try { scene.traverse((o) => { if (o.geometry && !Object.values(G).includes(o.geometry)) o.geometry.dispose(); if (o.material && o.material.map) o.material.map.dispose(); }); } catch (e) {}
    try { Object.values(G).forEach((g) => g.dispose()); } catch (e) {}
    try { renderer.dispose(); } catch (e) {}
    root.remove();
  }
  raf = requestAnimationFrame(step);
  return done;
}

function fmtT(s) { s = Math.max(0, Math.round(s)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); }
function _gEsc(t) { return String(t == null ? '' : t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

const GAME_CSS = `
#haul-run{position:fixed;inset:0;z-index:100050;background:#0b0c10;font-family:inherit;color:#f0e6d0;user-select:none}
#haul-canvas{position:absolute;inset:0;width:100%;height:100%;display:block}
.haul-hud{position:absolute;inset:0;pointer-events:none;display:flex;flex-direction:column;justify-content:space-between;gap:8px;padding:max(10px,env(safe-area-inset-top)) 12px max(10px,env(safe-area-inset-bottom))}
.haul-hud-top{flex-direction:column;align-items:flex-start;gap:6px}
.haul-hud-top .haul-pill{max-width:min(60vw,520px);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.haul-hud-row{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
.haul-hud-bottom{justify-content:space-between}
.haul-pill{background:rgba(8,10,16,.72);border:1px solid rgba(255,255,255,.12);border-radius:10px;padding:6px 11px;font-size:.86rem;font-weight:700;letter-spacing:.02em;backdrop-filter:blur(4px)}
.haul-k{color:#ffb060;font-size:.68rem;letter-spacing:.12em;margin-right:6px}
.haul-dim{color:#a89880;font-weight:500}
.haul-speed{font-size:1.5rem;min-width:7rem;text-align:center}
.haul-turn{background:rgba(31,61,138,.85);border-color:#6cd4ff;color:#fff;font-size:1rem}
.haul-progress{position:relative;height:8px;background:rgba(255,255,255,.1);border-radius:6px;overflow:visible;margin-top:4px;flex:none}
.haul-hud-spacer{flex:1}
#haul-prog-bar{height:100%;background:linear-gradient(90deg,#ffb060,#ffd166);border-radius:6px;width:0}
#haul-prog-txt{position:absolute;top:10px;left:0;font-size:.74rem;color:#d8c8a8;white-space:nowrap}
.haul-gps{position:absolute;right:12px;bottom:64px;width:240px;border:1px solid rgba(255,255,255,.18);border-radius:10px;overflow:hidden;background:rgba(8,10,16,.85)}
.haul-gps canvas{display:block;width:240px;height:170px}
.haul-gps-txt{padding:6px 8px;font-size:.8rem;font-weight:800;color:#ffd166;border-top:1px solid rgba(255,255,255,.12);background:rgba(20,22,30,.9)}
.haul-touch{display:none;position:absolute;left:0;right:0;bottom:64px;justify-content:space-between;padding:0 14px;pointer-events:none}
.haul-is-touch .haul-touch{display:flex}
.haul-tbtn{pointer-events:auto;width:88px;height:88px;border-radius:50%;border:2px solid rgba(255,255,255,.25);background:rgba(20,22,30,.7);color:#fff;font-size:1.6rem;font-weight:800;touch-action:none}
.haul-tbtn[data-t=brake]{width:120px;border-radius:20px;font-size:1rem;background:rgba(120,30,30,.7)}
.haul-merge{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:.4rem;background:radial-gradient(ellipse at center,rgba(0,0,0,.35),rgba(0,0,0,.85));opacity:0;transition:opacity .35s;pointer-events:none;z-index:6}
.haul-merge.on{opacity:1}
.haul-merge-txt{font-size:2.2rem;font-weight:900;color:#ffd166;text-shadow:0 0 22px #000;letter-spacing:.06em;text-align:center}
.haul-merge-sub{font-size:.9rem;color:#cfd6e4;letter-spacing:.2em;text-transform:uppercase}
.haul-flash{position:absolute;left:50%;top:38%;transform:translate(-50%,-50%);font-size:2rem;font-weight:900;color:#ff6a4a;text-shadow:0 0 18px #000;opacity:0;transition:opacity .15s;text-align:center;max-width:90vw}
.haul-flash.on{opacity:1}
.haul-countdown{position:absolute;left:50%;top:45%;transform:translate(-50%,-50%);font-size:6rem;font-weight:900;color:#ffd166;text-shadow:0 0 30px #000}
.haul-pause{position:absolute;inset:0;background:rgba(0,0,0,.6);display:flex;align-items:center;justify-content:center;pointer-events:auto}
.haul-pause[hidden]{display:none}
.haul-pause-card{background:#1a1c24;border:1px solid rgba(255,255,255,.14);border-radius:14px;padding:22px;max-width:360px;text-align:center}
.haul-pause-card h3{margin:0 0 8px}
.haul-pause-card p{color:#a89880;font-size:.9rem}
.haul-btn{display:inline-block;margin:6px 4px 0;padding:10px 16px;border-radius:10px;border:1px solid rgba(255,255,255,.18);background:#2a2d38;color:#fff;font-weight:700;cursor:pointer}
.haul-btn-danger{background:#6a2020}
.haul-is-touch .haul-gps{bottom:auto;top:120px}
@media (max-width:700px){.haul-gps{width:170px}.haul-gps canvas{width:170px;height:120px}}
`;

/* ───── haul.api.js ───── */
/* ═══════════════════════════════════════════════════════════════════════════
   haul.api.js — everything that talks to Supabase, and the state it fills.

   🔒 EVERY call is guarded. No client, no sign-in, no table, no RPC → the
   module drops to PRACTICE mode: the board is empty, the run still plays, no
   Cinder moves, and the UI says exactly why. Follow the Corp.* pattern.

   💰 No money is moved here either. The RPCs in sql/038 debit the shipper,
   credit the driver, refund the shipper and pay the treasury; this file only
   calls them and then asks the bridge to re-read the wallet. The one thing it
   DOES move client-side is GOODS: the shipper's resources leave their stash
   before the job row is written (escrow first, exactly as the exchange does)
   and are refunded through refundRes — never addRes, which respects the stash
   cap and would silently destroy an unwind — if the post fails.
   ═══════════════════════════════════════════════════════════════════════════ */


const Haul = {
  jobs: [],          // the open board
  mine: [],          // jobs I posted, am driving, or am receiving
  board: [],         // haul_driver_board rows
  company: null,     // haul_companies row for my corp (or null)
  wages: {},         // user_id -> wage_pct overrides for my corp
  transportOp: null, // my corp's transport operation, if it has one
  runs: [],          // my recent runs
  upgrades: {},      // my rig: { engine, brakes, bed } levels
  records: [],       // haul_route_records rows
  missing: false,    // sql/038 not applied
  offline: false,    // no client / not signed in
  error: null,
  loading: false,
  lastLoad: 0,
};

const MISSING_RE = /haul_jobs|haul_runs|haul_companies|haul_wages|haul_driver_board|haul_post_job|haul_claim_job|haul_complete|haul_claim_goods|haul_cancel_job|relation .* does not exist|schema cache|PGRST20[12]|42P01|42883/i;

function fail(e) {
  const msg = String((e && (e.message || e.code)) || e || 'error');
  if (MISSING_RE.test(msg)) Haul.missing = true;
  Haul.error = msg;
  return null;
}
function ready() {
  const c = client();
  Haul.offline = !(c && bridge().signedIn());
  return Haul.offline ? null : c;
}
/** Human-readable reason for an RPC exception name. */
const WHY = {
  NOT_SIGNED_IN: 'Sign in first.', BAD_ROUTE: 'Pick two different cities.', BAD_RESOURCE: 'Pick a resource.',
  BAD_QTY: 'Quantity must be 1–99,999.', BAD_FARE: 'That fare is out of range.', TOO_MANY_JOBS: 'You already have 10 shipments waiting.',
  TOO_FAST: 'Slow down — one post every few seconds.', INSUFFICIENT: 'Not enough Cinder for that fare.',
  NO_SUCH_JOB: 'That shipment is gone.', OWN_JOB: 'You cannot drive your own shipment.', ALREADY_CLAIMED: 'Another driver already took it.',
  HOLDING_A_JOB: 'Finish the run you already claimed first.', NOT_YOUR_RUN: 'That run is not yours.',
  PAYOUT_EXCEEDS_ESCROW: 'Settlement refused — payout exceeds escrow.',
};
function why(code) {
  const m = String(code || '');
  const k = Object.keys(WHY).find((x) => m.includes(x));
  return k ? WHY[k] : (MISSING_RE.test(m) ? 'The haul tables are not set up yet (sql/038).' : m.slice(0, 120));
}

async function loadAll() {
  if (Haul.loading) return;
  const c = ready();
  if (!c) { Haul.loading = true; try { await loadCompany(); } catch (e) {} Haul.loading = false; return; }
  Haul.loading = true; Haul.error = null;
  try {
    const me = bridge().userId();
    const [open, mine, board] = await Promise.all([
      c.from('haul_jobs').select('*').eq('status', 'open').order('created_at', { ascending: false }).limit(60),
      c.from('haul_jobs').select('*').or('shipper_id.eq.' + me + ',driver_id.eq.' + me + ',recipient_id.eq.' + me).order('created_at', { ascending: false }).limit(40),
      c.from('haul_driver_board').select('*').limit(200),
    ]);
    if (open.error) fail(open.error); else Haul.jobs = open.data || [];
    if (mine.error) fail(mine.error); else Haul.mine = mine.data || [];
    if (board.error) fail(board.error); else Haul.board = board.data || [];
    if (!Haul.missing) { Haul.missing = false; }
    const runs = await c.from('haul_runs').select('*').eq('driver_id', me).order('created_at', { ascending: false }).limit(30);
    if (!runs.error) Haul.runs = runs.data || [];
    // sql/039 extras — absent-tolerant: a 038-only database simply leaves these empty.
    try { const u = await c.from('haul_upgrades').select('upgrade,level').eq('user_id', me); if (!u.error) { Haul.upgrades = {}; (u.data || []).forEach((x) => { Haul.upgrades[x.upgrade] = x.level | 0; }); } } catch (e) {}
    try { const rr = await c.from('haul_route_records').select('*').limit(300); if (!rr.error) Haul.records = rr.data || []; } catch (e) {}
    await loadCompany();
  } catch (e) { fail(e); }
  Haul.loading = false; Haul.lastLoad = Date.now();
}

async function loadCompany() {
  // The corp half comes from the bridge and works offline; only the terms and
  // the wage overrides need the server.
  Haul.company = null; Haul.wages = {}; Haul.transportOp = null;
  try {
    const b = bridge(); await b.corpEnsure();
    const corp = b.myCorp();
    if (!corp) return;
    Haul.transportOp = await b.transportOp();
    const c = ready(); if (!c) return;
    const r = await c.from('haul_companies').select('*').eq('corp_id', corp.id).maybeSingle();
    if (r.error) { fail(r.error); return; }
    Haul.company = r.data || null;
    const w = await c.from('haul_wages').select('user_id,wage_pct').eq('corp_id', corp.id).limit(200);
    if (!w.error) (w.data || []).forEach((x) => { Haul.wages[x.user_id] = Number(x.wage_pct); });
  } catch (e) { fail(e); }
}

/** Post a shipment. Escrows the goods locally FIRST; the fare is debited by
    the RPC. Returns { ok, job | why }. */
async function postJob(j) {
  const b = bridge();
  const c = ready(); if (!c) return { ok: false, why: 'Sign in to post a shipment.' };
  const qty = Math.max(1, j.qty | 0);
  if (b.getRes(j.resource) < qty) return { ok: false, why: 'You do not hold ' + qty + ' of that.' };
  if (!b.spendRes(j.resource, qty)) return { ok: false, why: 'Could not take the goods from your stash.' };
  b.saveProfile();
  try {
    const r = await c.rpc('haul_post_job', {
      p_from_node: j.fromId, p_from_name: j.fromName, p_to_node: j.toId, p_to_name: j.toName,
      p_resource: j.resource, p_qty: qty, p_distance_km: j.km, p_fare: Math.floor(j.fare),
      p_recipient: j.recipientId || null, p_shipper_name: b.displayName(),
      p_path: Array.isArray(j.path) ? j.path : null, p_insured: !!j.insured, p_bonus: Math.max(0, Math.floor(j.bonus || 0)),
    });
    if (r.error) throw r.error;
    await b.refreshWallet();
    return { ok: true, job: r.data };
  } catch (e) {
    fail(e);
    b.refundRes(j.resource, qty); b.saveProfile();
    return { ok: false, why: why(e && e.message) };
  }
}

async function cancelJob(job) {
  const b = bridge(); const c = ready(); if (!c) return false;
  try {
    const r = await c.rpc('haul_cancel_job', { p_job_id: job.id });
    if (r.error) throw r.error;
    if (r.data === true) { b.refundRes(job.resource, job.qty | 0); b.saveProfile(); await b.refreshWallet(); return true; }
    return false;
  } catch (e) { fail(e); return false; }
}

async function claimJob(job) {
  const c = ready(); if (!c) return { ok: false, why: 'Sign in to take a job.' };
  try {
    const r = await c.rpc('haul_claim_job', { p_job_id: job.id, p_driver_name: bridge().displayName() });
    if (r.error) throw r.error;
    return { ok: true, job: r.data };
  } catch (e) { fail(e); return { ok: false, why: why(e && e.message) }; }
}

async function completeRun(job, out) {
  const b = bridge(); const c = ready(); if (!c) return { ok: false, why: 'Offline — the run could not be settled.' };
  try {
    const r = await c.rpc('haul_complete', {
      p_job_id: job.id, p_crashes_car: out.crashesCar | 0, p_crashes_rail: out.crashesRail | 0,
      p_time_s: out.timeS | 0, p_par_s: out.parS | 0, p_cargo_pct: out.completed ? out.cargoPct : 0,
      p_wrong_exits: out.wrongExits | 0, p_weather: out.weather || null,
    });
    if (r.error) throw r.error;
    await b.refreshWallet();
    try { await b.corpTreasuryRefresh(); } catch (e) {}
    return { ok: true, run: r.data };
  } catch (e) { fail(e); return { ok: false, why: why(e && e.message) }; }
}

async function claimGoods(job) {
  const b = bridge(); const c = ready(); if (!c) return { ok: false, why: 'Sign in.' };
  try {
    const r = await c.rpc('haul_claim_goods', { p_job_id: job.id });
    if (r.error) throw r.error;
    const row = Array.isArray(r.data) ? r.data[0] : r.data;
    if (!row) return { ok: false, why: 'Already collected.' };
    const n = row.units | 0;
    if (n > 0) { b.addRes(row.resource, n); b.saveProfile(); }
    return { ok: true, resource: row.resource, units: n };
  } catch (e) { fail(e); return { ok: false, why: why(e && e.message) }; }
}

/** Hire the one guard a run may carry. Company treasury pays when the driver
    drives for one; the freelancer's wallet otherwise (sql/039). */
async function hireGuard(job) {
  const b = bridge(); const c = ready(); if (!c) return { ok: false, why: 'Sign in.' };
  try {
    const r = await c.rpc('haul_hire_guard', { p_job_id: job.id });
    if (r.error) throw r.error;
    await b.refreshWallet(); try { await b.corpTreasuryRefresh(); } catch (e) {}
    return { ok: !!r.data };
  } catch (e) { fail(e); return { ok: false, why: String(e && e.message || '').includes('TREASURY_SHORT') ? 'The company treasury cannot cover the guard fee.' : why(e && e.message) }; }
}
async function buyUpgrade(id) {
  const b = bridge(); const c = ready(); if (!c) return { ok: false, why: 'Sign in to buy upgrades.' };
  try {
    const r = await c.rpc('haul_buy_upgrade', { p_upgrade: id });
    if (r.error) throw r.error;
    Haul.upgrades[id] = r.data | 0; await b.refreshWallet();
    return { ok: true, level: r.data | 0 };
  } catch (e) { fail(e); return { ok: false, why: why(e && e.message) }; }
}

async function saveCompany(terms) {
  const b = bridge(); const c = ready(); if (!c) return false;
  const corp = b.myCorp(); if (!corp || !b.amCorpFounder()) return false;
  try {
    const row = { corp_id: corp.id, wage_pct: +terms.wage_pct, car_penalty_pct: +terms.car_penalty_pct, rail_penalty_pct: +terms.rail_penalty_pct, max_penalty_pct: +terms.max_penalty_pct, updated_by: b.userId(), updated_at: new Date().toISOString() };
    const r = await c.from('haul_companies').upsert(row, { onConflict: 'corp_id' }).select().maybeSingle();
    if (r.error) throw r.error;
    Haul.company = r.data || row;
    return true;
  } catch (e) { fail(e); return false; }
}

async function setWage(userId, pct) {
  const b = bridge(); const c = ready(); if (!c) return false;
  const corp = b.myCorp(); if (!corp || !b.amCorpFounder()) return false;
  try {
    if (pct == null) {
      const r = await c.from('haul_wages').delete().eq('corp_id', corp.id).eq('user_id', userId);
      if (r.error) throw r.error; delete Haul.wages[userId]; return true;
    }
    const r = await c.from('haul_wages').upsert({ corp_id: corp.id, user_id: userId, wage_pct: +pct, set_by: b.userId(), updated_at: new Date().toISOString() }, { onConflict: 'corp_id,user_id' });
    if (r.error) throw r.error;
    Haul.wages[userId] = +pct; return true;
  } catch (e) { fail(e); return false; }
}

/* ── Practice log — local only, so the rank preview works before sign-in and
   so a run against nothing still teaches the road. Never money. */
const PRACTICE_KEY = 'haul_practice_v1';
function practiceLog() { try { return JSON.parse(localStorage.getItem(PRACTICE_KEY) || '[]'); } catch (e) { return []; } }
function practiceAdd(out) {
  try {
    const L = practiceLog();
    L.unshift({ at: Date.now(), km: out.km, timeS: out.timeS, parS: out.parS, crashesCar: out.crashesCar, crashesRail: out.crashesRail, cargoPct: out.cargoPct, completed: !!out.completed });
    localStorage.setItem(PRACTICE_KEY, JSON.stringify(L.slice(0, 30)));
  } catch (e) {}
}
/** Practice runs folded into the same stats shape as haul_driver_board. */
function practiceStats() {
  const L = practiceLog(); if (!L.length) return null;
  const d = L.filter((r) => r.completed);
  const s = { runs: L.length, delivered: d.length, km: 0, crashes_car: 0, crashes_rail: 0, cargo_avg: 0, time_ratio: 1, earned: 0, company_net: 0, fare_paid: 0 };
  L.forEach((r) => { s.km += r.km; s.crashes_car += r.crashesCar; s.crashes_rail += r.crashesRail; });
  if (d.length) { s.cargo_avg = d.reduce((a, r) => a + r.cargoPct, 0) / d.length; s.time_ratio = d.reduce((a, r) => a + Math.min(2, r.parS ? r.timeS / r.parS : 1), 0) / d.length; }
  return s;
}

/* ───── haul.render.js ───── */
/* ═══════════════════════════════════════════════════════════════════════════
   haul.render.js — every pixel of the Highway Haul hub, and the run flow.

   Four tabs: DISPATCH (the board + my shipments + my runs), SHIP (post a
   job), COMPANY (the transport business: terms, drivers, worth vs wage) and
   RANK (my driver record). The overlay is one element, repainted whole from
   state — the same paint() discipline as /src/community, so there is never a
   stale button.

   The run flow lives here too (startRun / practiceRun): claim → play →
   settle → result card. play() is the 3D game and knows nothing about money;
   settle is the sql/038 RPC and knows nothing about the road.
   ═══════════════════════════════════════════════════════════════════════════ */






const OV = 'haul-ov';
let tab = 'dispatch';
let form = { fromId: '', toId: '', resource: '', qty: 10, fare: 0, recipientId: '', insured: false, bonus: 0 };
let practice = { fromId: '', toId: '', guard: false };
let busy = false;
/* 🚛 The rig the player drives: any owned truck the bridge lists (Garage rigs,
   Prince Portfolios trucks, the issued hauler). The choice is per browser. */
function myRigs() { const b = bridge(); let list = []; try { list = b.rigs ? b.rigs() : []; } catch (e) {} return list.length ? list : [ISSUED_RIG]; }
function chosenRig() {
  const list = myRigs(); let id = ''; try { id = localStorage.getItem('haul_rig') || ''; } catch (e) {}
  return list.find((r) => r.id === id) || list[list.length - 1];
}

/* ── Terms the CURRENT player drives under. Company terms if their corp runs a
   transport op, else freelance (null). Mirrors _haul_company_of in sql/038. */
function myTerms() {
  const b = bridge(); const corp = b.myCorp();
  if (!corp || !Haul.transportOp) return null;
  const t = Haul.company || defaultTerms(b.econ());
  const me = b.userId();
  const override = me && Haul.wages[me];
  return Object.assign({}, t, override != null ? { wage_pct: override } : {});
}
function cities() { return normalizeCities(bridge().cities()); }
function cityName(id) { const c = cities().find((x) => x.id === id); return c ? c.name : id; }
function myStats() {
  const me = bridge().userId();
  const row = me && Haul.board.find((r) => r.driver_id === me);
  return row || practiceStats();
}

/* ── Paint ───────────────────────────────────────────────────────────────── */
function paint() {
  const ov = document.getElementById(OV); if (!ov) return;
  const b = bridge();
  const mode = Haul.offline ? '📴 Practice · sign in for live freight' : Haul.missing ? '🔌 Practice · sql/038 not applied' : '🟢 Live freight';
  ov.innerHTML = `
    <div class="hl-panel">
      <div class="hl-head">
        <div><div class="hl-title">🚚 Highway Haul</div><div class="hl-sub">${esc(mode)}${Haul.error && !Haul.missing ? ' · <span class="hl-err">' + esc(Haul.error.slice(0, 90)) + '</span>' : ''}</div></div>
        <div class="hl-head-r"><span class="hl-pill">🔥 ${fmtNum(b.gems())}</span><button class="hl-x" data-h="close">✕</button></div>
      </div>
      <div class="hl-tabs">
        ${[['dispatch', '📋 Haulage Board'], ['ship', '📦 Ship goods'], ['company', '🏢 Company'], ['garage', '🔧 Garage'], ['rank', '🪪 Driver rank']].map(([id, n]) => `<button class="hl-tab${tab === id ? ' on' : ''}" data-h="tab" data-tab="${id}">${n}</button>`).join('')}
      </div>
      <div class="hl-body">${busy ? '<div class="hl-busy">Working…</div>' : ''}${({ dispatch: paintDispatch, ship: paintShip, company: paintCompany, garage: paintGarage, rank: paintRank })[tab]()}</div>
    </div>`;
}

function jobCard(j, opts) {
  opts = opts || {};
  const b = bridge(); const m = b.meta(j.resource);
  const terms = myTerms();
  const prev = settle({ fare: j.fare, cargoPct: 1, crashesCar: 0, crashesRail: 0, terms });
  const par = parSeconds(Number(j.distance_km));
  const st = j.status;
  const me = b.userId();
  const mineAsShipper = j.shipper_id === me, mineAsDriver = j.driver_id === me, mineAsRecipient = j.recipient_id === me;
  let actions = '';
  const cap = rigProfile(chosenRig()).capacity;
  if (opts.board && !mineAsShipper) actions = (j.qty | 0) > cap
    ? `<span class="hl-dim hl-small">Needs a rig with ${j.qty}+ capacity — yours carries ${cap}. Change rig in 🔧 Garage.</span>`
    : `<button class="hl-btn hl-btn-go" data-h="claim" data-id="${j.id}">🛣 Take the wheel</button>`;
  if (mineAsDriver && st === 'claimed') actions = `<button class="hl-btn hl-btn-go" data-h="drive" data-id="${j.id}">🚚 Drive now</button>`;
  if (mineAsShipper && st === 'open') actions += `<button class="hl-btn" data-h="cancel" data-id="${j.id}">Cancel · refund</button>`;
  if (mineAsRecipient && st === 'delivered' && !j.goods_claimed_at) actions += `<button class="hl-btn hl-btn-go" data-h="collect" data-id="${j.id}">📦 Collect ${Math.floor(j.qty * Number(j.cargo_pct || 0))} ${esc(m.name)}</button>`;
  const statusTxt = { open: 'On the board', claimed: 'Driver: ' + (j.driver_name || '—'), delivered: 'Delivered · ' + Math.round(Number(j.cargo_pct || 0) * 100) + '% intact' + (j.goods_claimed_at ? ' · collected' : ''), cancelled: 'Cancelled' }[st] || st;
  return `<div class="hl-job hl-${st}">
    <div class="hl-job-route"><b>${esc(j.from_name)}</b> → <b>${esc(j.to_name)}</b> <span class="hl-dim">· ${fmtKm(j.distance_km)} · par ${fmtTime(par)}</span></div>
    <div class="hl-job-meta">${m.icon || '📦'} ${j.qty}× ${esc(m.name)} <span class="hl-dim">${CARGO_CLASSES[cargoClass(j.resource)].label}</span> · fare <b>🔥 ${fmtNum(j.fare)}</b>${j.bonus > 0 ? ' · 🎁 bonus 🔥 ' + fmtNum(j.bonus) + ' if on time' : ''}${j.insured ? ' · 🛡 insured' : ''}${j.guard_hired ? ' · 🪖 guard' : ''} · by ${esc(j.shipper_name || 'Survivor')}</div>
    <div class="hl-job-meta hl-dim">${esc(statusTxt)}${opts.board && !mineAsShipper ? ' · your cut at 100% cargo: <b>🔥 ' + fmtNum(prev.driverPay) + '</b>' + (terms ? ' (' + prev.wagePct + '% wage)' : ' (freelance)') : ''}</div>
    ${actions ? '<div class="hl-job-act">' + actions + '</div>' : ''}
  </div>`;
}

function citySelect(name, val, exclude) {
  return `<select class="hl-in" data-f="${name}">` + cities().filter((c) => c.id !== exclude).map((c) => `<option value="${esc(c.id)}"${c.id === val ? ' selected' : ''}>${esc(c.name)}${c.mine ? ' ★' : c.owned ? ' ·' : ''}</option>`).join('') + '</select>';
}

function paintDispatch() {
  const b = bridge(); const me = b.userId();
  const C = cities();
  if (!practice.fromId) { const mine = C.find((c) => c.mine) || C[0]; practice.fromId = mine.id; practice.toId = (C.find((c) => c.id !== mine.id) || C[1]).id; }
  const r = route(C, practice.fromId, practice.toId);
  const open = Haul.jobs.filter((j) => j.status === 'open');
  const myRuns = Haul.mine.filter((j) => j.driver_id === me && j.status === 'claimed');
  const myShip = Haul.mine.filter((j) => j.shipper_id === me || (j.recipient_id === me && j.status === 'delivered'));
  return `
    <div class="hl-card hl-practice">
      <div class="hl-card-t">🏁 Practice run <span class="hl-dim">— no cargo, no Cinder, but it counts toward your feel for the road</span></div>
      <div class="hl-row">${citySelect('pfrom', practice.fromId, '')} <span>→</span> ${citySelect('pto', practice.toId, '')}
        <span class="hl-pill">${r ? fmtKm(r.km) + ' · ' + (r.path.length - 1) + ' junction' + (r.path.length > 2 ? 's' : '') + ' · par ' + fmtTime(parSeconds(r.km)) : '—'}</span>
        <label class="hl-chk"><input type="checkbox" data-f="pguard"${practice.guard ? ' checked' : ''}> 🪖 bring a guard (free in practice)</label>
        <button class="hl-btn hl-btn-go" data-h="practice">Drive</button></div>
      ${r && r.direct ? '<div class="hl-dim hl-small">⚠ No supply line links these cities — straight-line distance used.</div>' : ''}
    </div>
    ${myRuns.length ? '<div class="hl-card-t">🚚 Your claimed run</div>' + myRuns.map((j) => jobCard(j)).join('') : ''}
    ${paintHowItWorks()}
    <div class="hl-card-t">📋 Open shipments <span class="hl-dim">(${open.length})</span> <button class="hl-btn hl-btn-sm" data-h="refresh">↻</button></div>
    ${open.length ? open.map((j) => jobCard(j, { board: true })).join('')
      : `<div class="hl-empty">${Haul.offline ? 'Sign in to see live shipments.' : Haul.missing ? 'The freight board is not set up on the server yet.' : 'Nobody is shipping right now. Post one under 📦 Ship goods.'}</div>`}
    ${myShip.length ? '<div class="hl-card-t">📦 Your shipments</div>' + myShip.slice(0, 12).map((j) => jobCard(j)).join('') : ''}
  `;
}

/* The board's briefing: everything a shipper or driver needs to know before
   they post or take a load, with the LIVE rates from _opEcon('transport') so
   the numbers here are the numbers the server settles with. Collapsible and
   remembered per browser, because a regular reads it once. */
let howOpen = (() => { try { return localStorage.getItem('haul_how_open') !== '0'; } catch (e) { return true; } })();
function paintHowItWorks() {
  const b = bridge(); const e = econOf(b.econ()); const terms = Haul.transportOp ? (Haul.company || defaultTerms(e)) : null;
  const row = (icon, t, d) => `<div class="hl-how"><span class="hl-how-i">${icon}</span><div><b>${t}</b><div class="hl-dim hl-small">${d}</div></div></div>`;
  return `<div class="hl-card hl-howcard">
    <div class="hl-card-t" style="cursor:pointer" data-h="how-toggle">📖 How hauling works <span class="hl-dim hl-small">${howOpen ? '▾ hide' : '▸ show'}</span></div>
    ${howOpen ? `<div class="hl-howgrid">
      ${row('📦', 'Posting a shipment', 'You pick two cities on the node map, the goods and a fare. Minimum fare = 🔥 ' + e.fareBase + ' + ' + e.farePerKm + '/km + ' + e.farePerUnit + '/unit, × the cargo class. The fare is escrowed and your goods leave your stash. Cancel an unclaimed job for a full refund of fare and bonus.')}
      ${row('🛣', 'The route', 'Distance is the shortest supply-line road between the two cities. Every city on the way is a junction with an exit ramp and signs naming the real nodes each road leads to. The GPS in the corner tells you whether to stay on or take the exit; a wrong road is a real detour on the clock.')}
      ${row('💰', 'Paying the driver', (terms ? 'Company drivers get ' + terms.wage_pct + '% of the fare that arrived, minus ' + terms.car_penalty_pct + '% of that per car hit and ' + terms.rail_penalty_pct + '% per rail hit (capped at ' + terms.max_penalty_pct + '%); the rest goes to the company treasury.' : 'A company driver gets their wage % of the fare that arrived, minus crash penalties; the rest goes to the treasury.') + ' Freelancers keep the whole fare and their penalties are burned. Damaged cargo is refunded to the shipper pro rata; a failed run puts the shipment back on the board.')}
      ${row('🎁', 'On-time bonus', 'Optional, escrowed with the fare. The driver earns it by arriving within par with at least ' + Math.round((e.bonusMinCargo || 0.9) * 100) + '% cargo. Missed, it comes back to the shipper.')}
      ${row('🛡', 'Insurance', 'Shippers can insure a load for ' + e.insurePct + '% of the fare. The recipient then collects the FULL quantity whatever arrived. The premium is a sink and is not refunded on cancel.')}
      ${row('🛑', 'Toll plazas', 'A city owned by another player is a toll plaza: booths across the road, arms down. Stop at the booth, the toll pays in a moment, the arms lift. Running the arm stops you anyway and damages the cargo. ' + e.tollPct + '% of the fare per plaza goes to the node owner, out of the carrier\'s side — never the driver\'s wage.')}
      ${row('🚨', 'Raiders and guards', 'Routes over 40 km draw raiders who come from behind and ram. Before a run the carrier can hire ONE guard for 🔥 ' + e.guardFee + ' (company treasury, or the freelancer\'s wallet); the guard opens fire once, the first time raiders close in. Raiders cannot drive through traffic: a car between you and them holds them off, and raiders held off long enough give up — use the traffic.')}
      ${row('⚠', 'Hazards and weather', 'Debris, breakdowns and closed lanes are signposted 250 m ahead. Rain cuts grip; night cuts how far you can see. Weather follows the destination region.')}
      ${row('🧱', 'Cargo classes', 'Fragile (medicine, water, DNA): rail scrapes hurt more, fare × ' + (e.cargoRisk && e.cargoRisk.fragile || 1.5) + '. Flammable (fuel): car hits hurt more and a hard hit starts a fire, fare × ' + (e.cargoRisk && e.cargoRisk.flammable || 1.8) + '. Heavy (metal, stone, wood): slower to speed up and stop, fare × ' + (e.cargoRisk && e.cargoRisk.heavy || 1.2) + '.')}
      ${row('🪪', 'Driver rank', 'Every run feeds a 0–100 rating from cargo integrity, clean driving per km, pace against par and reliability. Company owners see each driver\'s rank and what their record is worth against the wage they pay. Rig upgrades in the Garage are yours whoever you drive for.')}
    </div>` : ''}
  </div>`;
}

function paintShip() {
  const b = bridge(); const C = cities();
  const res = b.resources().filter((x) => x && x.id);
  if (!form.fromId) { const mine = C.find((c) => c.mine) || C[0]; form.fromId = mine.id; }
  if (!form.toId || form.toId === form.fromId) form.toId = (C.find((c) => c.id !== form.fromId) || C[1]).id;
  if (!form.resource) { const held = res.find((x) => b.getRes(x.id) > 0); form.resource = (held || res[0] || {}).id || ''; }
  const r = route(C, form.fromId, form.toId);
  const econ = econOf(b.econ());
  const min = r ? minFare(econ, r.km, form.qty, form.resource) : 0;
  if (!(form.fare >= min)) form.fare = min;
  const cc = CARGO_CLASSES[cargoClass(form.resource)]; const risk = cargoRisk(econ, form.resource);
  const premium = insurancePremium(econ, form.fare);
  const tollNodes = r ? r.path.slice(1, -1).map((id) => C.find((c) => c.id === id)).filter((c) => c && c.ownerId && c.ownerId !== b.userId()) : [];
  const have = b.getRes(form.resource);
  const roster = b.corpRoster().filter((m) => m.userId && m.userId !== b.userId());
  const terms = Haul.transportOp ? (Haul.company || defaultTerms(econ)) : null;
  return `
    <div class="hl-card">
      <div class="hl-card-t">📦 Post a shipment</div>
      <div class="hl-grid">
        <label>From city ${citySelect('fromId', form.fromId, '')}</label>
        <label>To city ${citySelect('toId', form.toId, form.fromId)}</label>
        <label>Goods <select class="hl-in" data-f="resource">${res.map((x) => `<option value="${esc(x.id)}"${x.id === form.resource ? ' selected' : ''}>${x.icon || '📦'} ${esc(x.name)} (${fmtNum(b.getRes(x.id))})</option>`).join('')}</select></label>
        <label>Quantity <input class="hl-in" type="number" min="1" max="${Math.max(1, have)}" data-f="qty" value="${form.qty}"></label>
        <label>Fare in Cinder <input class="hl-in" type="number" min="${min}" data-f="fare" value="${form.fare}"><span class="hl-small hl-dim">minimum 🔥 ${fmtNum(min)} — base ${econ.fareBase} + ${econ.farePerKm}/km + ${econ.farePerUnit}/unit${risk !== 1 ? ' × ' + risk + ' (' + cc.label.replace('· ', '') + ' cargo)' : ''}. Pay more to pull drivers.</span></label>
        <label>On-time bonus 🎁 <input class="hl-in" type="number" min="0" data-f="bonus" value="${form.bonus}"><span class="hl-small hl-dim">Escrowed with the fare. The driver earns it by arriving within par with ≥ 90% cargo; otherwise it comes back to you.</span></label>
        <label class="hl-chk-lab"><span>Insurance 🛡</span><span class="hl-chk"><input type="checkbox" data-f="insured"${form.insured ? ' checked' : ''}> Insure for 🔥 ${fmtNum(premium)} (${econ.insurePct}% of fare)</span><span class="hl-small hl-dim">The recipient collects the FULL ${form.qty} units whatever arrives. The premium is not refunded on cancel.</span></label>
        <label>Deliver to <select class="hl-in" data-f="recipientId"><option value="">Myself (goods wait for me at the destination)</option>${roster.map((m) => `<option value="${esc(m.userId)}"${m.userId === form.recipientId ? ' selected' : ''}>${esc(m.name)} (corp)</option>`).join('')}</select></label>
      </div>
      <div class="hl-route">${r ? `Route: ${r.path.map(cityName).map(esc).join(' → ')} · <b>${fmtKm(r.km)}</b> · par ${fmtTime(parSeconds(r.km))}${r.direct ? ' · ⚠ no supply line, straight-line distance' : ''}${tollNodes.length ? ' · 💰 ' + tollNodes.length + ' toll gate' + (tollNodes.length > 1 ? 's' : '') + ' (' + tollNodes.map((c) => esc(c.name)).join(', ') + ') — ' + tollPct(econ) + '% of the fare each, paid to the node owner out of the carrier\'s side' : ''}` : 'Pick two cities.'}</div>
      <div class="hl-dim hl-small">The fare is escrowed now and paid out on delivery. Damaged cargo is refunded to you pro rata; a failed run puts the shipment back on the board with your escrow intact. Your ${form.qty} units leave your stash when you post.</div>
      <div class="hl-job-act"><button class="hl-btn hl-btn-go" data-h="post" ${Haul.offline || Haul.missing || have < form.qty ? 'disabled' : ''}>Post for 🔥 ${fmtNum(form.fare + (form.bonus | 0) + (form.insured ? premium : 0))}${(form.bonus | 0) || form.insured ? ' <span class="hl-small">(fare' + ((form.bonus | 0) ? ' + bonus' : '') + (form.insured ? ' + insurance' : '') + ')</span>' : ''}</button>
        ${have < form.qty ? '<span class="hl-err">You hold ' + fmtNum(have) + '.</span>' : ''}
        ${Haul.offline ? '<span class="hl-dim">Sign in to post.</span>' : Haul.missing ? '<span class="hl-dim">Server tables missing (sql/038).</span>' : ''}</div>
    </div>
    <div class="hl-card hl-dim hl-small">How the money splits on delivery (server-settled): a company driver gets their wage % of the fare that arrived, minus ${terms ? terms.car_penalty_pct : econ.carPenaltyPct}% of that per car hit and ${terms ? terms.rail_penalty_pct : econ.railPenaltyPct}% per rail hit (capped at ${terms ? terms.max_penalty_pct : econ.maxPenaltyPct}%); the rest goes to the company treasury. A freelancer keeps the whole fare, and their crash penalties are burned.</div>`;
}

function paintCompany() {
  const b = bridge(); const corp = b.myCorp();
  if (!corp) return '<div class="hl-empty">Join or found a corporation in Just Business. A transport company IS a corporation that owns a <b>Transport Company</b> operation.</div>';
  const econ = econOf(b.econ());
  const founder = b.amCorpFounder();
  const terms = Haul.company || defaultTerms(econ);
  if (!Haul.transportOp) {
    return `<div class="hl-card"><div class="hl-card-t">🏢 ${esc(corp.name)}</div>
      <div>${esc(corp.name)} does not run a Transport Company yet. ${founder ? 'Found one in <b>Just Business → Operations</b> (startup 🔥 ' + fmtNum(econ.startup || 0) + '). Until then your members drive as freelancers and keep their whole fare.' : 'Ask your founder to open one in Just Business. Until then you drive freelance and keep the whole fare.'}</div></div>`;
  }
  const roster = b.corpRoster();
  const rows = roster.map((m) => {
    const st = Haul.board.find((r) => r.driver_id === m.userId) || null;
    const W = worth(st, terms, econ);
    const cur = Haul.wages[m.userId] != null ? Haul.wages[m.userId] : Number(terms.wage_pct);
    const V = verdict(cur, W.worthPct);
    return `<tr>
      <td><b>${esc(m.name)}</b><div class="hl-small hl-dim">${esc(m.role || 'member')}</div></td>
      <td><span style="color:${W.rank.accent}">${W.rank.icon} ${W.rank.name}</span><div class="hl-small hl-dim">rating ${W.rating.score}${W.rating.provisional ? ' (provisional)' : ''}</div></td>
      <td>${st ? (st.runs | 0) + ' runs · ' + fmtKm(st.km) : '<span class="hl-dim">no runs</span>'}<div class="hl-small hl-dim">${st ? 'crashes ' + ((st.crashes_car | 0) + (st.crashes_rail | 0)) + ' · cargo ' + Math.round(Number(st.cargo_avg) * 100) + '%' : ''}</div></td>
      <td>🔥 ${fmtNum(W.companyNetPerRun)}<div class="hl-small hl-dim">to treasury / run</div></td>
      <td><b>${W.worthPct}%</b><div class="hl-small hl-dim">worth</div></td>
      <td>${founder ? `<input class="hl-in hl-in-sm" type="number" min="0" max="100" value="${cur}" data-wage="${esc(m.userId)}">` : cur + '%'}<div class="hl-small" style="color:${V.color}">${esc(V.label)}</div></td>
    </tr>`;
  }).join('');
  return `
    <div class="hl-card">
      <div class="hl-card-t">🏢 ${esc(corp.name)} Transport Company <span class="hl-dim">· treasury 🔥 ${fmtNum(b.corpTreasury())}</span></div>
      <div class="hl-grid hl-grid-4">
        <label>Default driver wage % <input class="hl-in" type="number" min="0" max="100" data-t="wage_pct" value="${terms.wage_pct}" ${founder ? '' : 'disabled'}></label>
        <label>Car hit penalty % <input class="hl-in" type="number" min="0" max="100" data-t="car_penalty_pct" value="${terms.car_penalty_pct}" ${founder ? '' : 'disabled'}></label>
        <label>Rail hit penalty % <input class="hl-in" type="number" min="0" max="100" data-t="rail_penalty_pct" value="${terms.rail_penalty_pct}" ${founder ? '' : 'disabled'}></label>
        <label>Max penalty % <input class="hl-in" type="number" min="0" max="100" data-t="max_penalty_pct" value="${terms.max_penalty_pct}" ${founder ? '' : 'disabled'}></label>
      </div>
      <div class="hl-dim hl-small">Penalties come out of the DRIVER's wage on each run, never out of the fare the company keeps. ${Haul.company ? '' : 'These are the game defaults — save to write your own.'}</div>
      ${founder ? '<div class="hl-job-act"><button class="hl-btn hl-btn-go" data-h="save-terms">Save terms</button></div>' : ''}
    </div>
    <div class="hl-card">
      <div class="hl-card-t">👥 Drivers <span class="hl-dim">— what each is worth vs what they are paid</span></div>
      <div class="hl-tblwrap"><table class="hl-tbl"><thead><tr><th>Driver</th><th>Rank</th><th>Record</th><th>Company net</th><th>Worth</th><th>Wage</th></tr></thead><tbody>${rows || '<tr><td colspan="6" class="hl-dim">No members yet.</td></tr>'}</tbody></table></div>
      ${founder ? '<div class="hl-job-act"><button class="hl-btn hl-btn-go" data-h="save-wages">Save driver wages</button> <span class="hl-dim hl-small">Blank a box to fall back to the default.</span></div>' : ''}
      <div class="hl-dim hl-small">Worth is the wage share a driver's record justifies: rating 50 = your default, a perfect record ≈ 1.6× it, a wrecker ≈ half. Company net is the average Cinder their runs have actually put in the treasury.</div>
    </div>`;
}

function paintGarage() {
  const b = bridge(); const econ = econOf(b.econ()); const U = Haul.upgrades || {};
  const rigs = myRigs(); const cur = chosenRig();
  const bar = (v, max) => `<i class="hl-stat"><b style="width:${Math.round(Math.max(0, Math.min(1, v / max)) * 100)}%"></b></i>`;
  return `<div class="hl-card"><div class="hl-card-t">🚛 Choose your rig <span class="hl-dim">— Garage rigs, trucks on your Prince Portfolios lot, or the issued hauler</span></div>
    <div class="hl-tblwrap"><table class="hl-tbl"><thead><tr><th></th><th>Rig</th><th>Engine</th><th>Brakes</th><th>Handling</th><th>Armour</th><th>Capacity</th></tr></thead><tbody>
    ${rigs.map((r) => { const P = rigProfile(r); return `<tr class="${r.id === cur.id ? 'hl-row-on' : ''}"><td><button class="hl-btn hl-btn-sm${r.id === cur.id ? ' hl-btn-go' : ''}" data-h="rig" data-id="${esc(r.id)}">${r.id === cur.id ? 'Driving' : 'Drive'}</button></td>
      <td><b>${esc(P.name)}</b><div class="hl-small hl-dim">${esc(P.typeLabel)}${P.condition ? ' · ' + esc(P.condition) : ''}${r.kind === 'lot' ? ' · from your lot' : r.kind === 'garage' ? ' · Garage' : ' · issued'}</div></td>
      <td>${bar(P.accel, 1.2)}</td><td>${bar(P.brake, 1.2)}</td><td>${bar(P.steer, 1.2)}</td><td>${bar(2 - P.armor, 1.5)}</td><td><b>${P.capacity}</b> <span class="hl-dim hl-small">units</span></td></tr>`; }).join('')}
    </tbody></table></div>
    <div class="hl-dim hl-small">A job's units must fit the rig. Dealership condition scales engine and brakes — a Salvage-grade truck drives like one. Armoured rigs take less cargo damage; Construction rigs carry the most and turn the slowest.</div>
  </div>
  <div class="hl-card"><div class="hl-card-t">🔧 Upgrades <span class="hl-dim">— yours, whoever you drive for</span></div>
    ${UPGRADES.map((u) => { const lvl = U[u.id] | 0; const next = lvl + 1; const price = upgradePrice(econ, u.id, next);
      return `<div class="hl-run"><span>${u.icon} <b>${u.name}</b> <span class="hl-dim">L${lvl}/${UPGRADE_MAX} · ${esc(u.desc)}</span></span>
        <span>${lvl >= UPGRADE_MAX ? '<span class="hl-dim">maxed</span>' : `<button class="hl-btn hl-btn-sm hl-btn-go" data-h="buy" data-id="${u.id}" ${Haul.offline || Haul.missing ? 'disabled' : ''}>Buy L${next} · 🔥 ${fmtNum(price)}</button>`}</span></div>`; }).join('')}
    <div class="hl-dim hl-small">${Haul.offline ? 'Sign in to buy upgrades.' : Haul.missing ? 'Server tables missing (sql/039).' : 'Charged to your wallet by the server; the level applies on your next run.'}</div>
  </div>
  <div class="hl-card"><div class="hl-card-t">📦 Cargo handling</div>
    ${Object.values(CARGO_CLASSES).map((c) => `<div class="hl-run"><span><b>${c.id}</b> <span class="hl-dim">${c.id === 'standard' ? 'drives normally' : c.id === 'fragile' ? 'rail scrapes and hazards hurt 1.7×' : c.id === 'flammable' ? 'car hits hurt 1.6×; a hard hit starts a fire' : 'slower to accelerate and stop, tougher cargo'}</span></span><span class="hl-dim">fare × ${cargoRisk(econ, { fragile: 'medicine', flammable: 'fuel', heavy: 'metal', standard: 'food' }[c.id])}</span></div>`).join('')}
  </div>`;
}

function paintRank() {
  const b = bridge(); const st = myStats();
  const R = rating(st); const rk = rankFor(R.score);
  const next = RANKS.find((x) => x.min > R.score);
  const terms = myTerms();
  const W = worth(st, terms, b.econ());
  const runs = Haul.runs.length ? Haul.runs : [];
  const top = Haul.board.map((r) => ({ r, s: rating(r).score })).sort((a, b2) => b2.s - a.s).slice(0, 10);
  return `
    <div class="hl-card hl-rankcard" style="--acc:${rk.accent}">
      <div class="hl-rank-big">${rk.icon}</div>
      <div><div class="hl-rank-name">${esc(rk.name)}</div>
        <div class="hl-dim">${esc(b.displayName())} · rating <b>${R.score}</b>/100${R.provisional ? ' · provisional until 3 runs' : ''}${next ? ' · ' + (next.min - R.score) + ' to ' + next.name : ''}</div>
        <div class="hl-bars">${[['Cargo integrity', R.parts.cargo], ['Clean driving', R.parts.clean], ['Pace', R.parts.pace], ['Reliability', R.parts.reliability]].map(([n, v]) => `<div class="hl-bar"><span>${n}</span><i><b style="width:${v}%"></b></i><em>${v}</em></div>`).join('')}</div>
        <div class="hl-dim hl-small">${st ? (st.runs | 0) + ' runs · ' + fmtKm(st.km) + ' · earned 🔥 ' + fmtNum(st.earned || 0) : 'No runs on record yet — practice runs count toward this preview.'}${terms ? ' · your wage ' + terms.wage_pct + '% · a record like yours is worth ' + W.worthPct + '%' : ' · driving freelance'}</div>
      </div>
    </div>
    <div class="hl-card"><div class="hl-card-t">🧾 Recent runs</div>
      ${runs.length ? runs.slice(0, 12).map((r) => `<div class="hl-run"><span>${r.outcome === 'delivered' ? '✅' : '❌'} ${fmtKm(r.distance_km)} · ${fmtTime(r.time_s)}/${fmtTime(r.par_s)} · 🚗${r.crashes_car} 🛤${r.crashes_rail} · cargo ${Math.round(Number(r.cargo_pct) * 100)}%</span><span>🔥 ${fmtNum(r.driver_pay)}${r.penalty > 0 ? ' <span class="hl-err">−' + fmtNum(r.penalty) + '</span>' : ''}${r.corp_id ? '' : ' <span class="hl-dim">freelance</span>'}</span></div>`).join('') : '<div class="hl-dim">Nothing settled yet.</div>'}
    </div>
    ${Haul.records.length ? '<div class="hl-card"><div class="hl-card-t">⏱ Route records</div>' + Haul.records.slice(0, 15).map((x) => `<div class="hl-run"><span>${esc(cityName(x.from_node))} → ${esc(cityName(x.to_node))}</span><span><b>${fmtTime(x.time_s)}</b> · ${esc(x.driver_name || 'Driver')}</span></div>`).join('') + '</div>' : ''}
    <div class="hl-card"><div class="hl-card-t">🏆 Top drivers</div>
      ${top.length ? top.map((x, i) => { const k = rankFor(x.s); return `<div class="hl-run"><span>${i + 1}. ${k.icon} <b>${esc(x.r.driver_name || 'Driver')}</b> <span class="hl-dim">${k.name}</span></span><span>${x.s} · ${x.r.runs} runs · ${fmtKm(x.r.km)}</span></div>`; }).join('') : '<div class="hl-dim">No drivers on the board yet.</div>'}
    </div>`;
}

/* ── Run flow ────────────────────────────────────────────────────────────── */
function ensureGameCss() { if (!document.getElementById('haul-game-css')) { const s = document.createElement('style'); s.id = 'haul-game-css'; s.textContent = GAME_CSS; document.head.appendChild(s); } }

async function runGame(params) {
  ensureGameCss();
  const ov = document.getElementById(OV); if (ov) ov.style.display = 'none';
  try { return await play(params); }
  finally { if (ov) ov.style.display = ''; }
}

async function practiceRun() {
  const C = cities(); const r = route(C, practice.fromId, practice.toId);
  if (!r || r.km <= 0) return bridge().toast('Pick two different cities.');
  let out;
  try { out = await runGame({ cities: C, fromId: practice.fromId, toId: practice.toId, cargoLabel: 'practice load', guard: practice.guard, upgrades: Haul.upgrades, driverId: bridge().userId(), forceToll: true, rig: chosenRig() }); }
  catch (e) { return bridge().toast('⚠ ' + (e && e.message), 6000); }
  practiceAdd(out);
  const fare = minFare(bridge().econ(), r.km, 10);
  const prev = settle({ fare, cargoPct: out.cargoPct, crashesCar: out.crashesCar, crashesRail: out.crashesRail, terms: myTerms() });
  // Paint FIRST: paint() rebuilds the overlay's innerHTML and would wipe the
  // card if it came after. (Driven test: the result never appeared.)
  paint();
  resultCard(out, prev, { practice: true, fare });
}

async function startRun(job) {
  const b = bridge();
  if (job.driver_id !== b.userId() || job.status !== 'claimed') {
    const c = await claimJob(job);
    if (!c.ok) return b.toast('⚠ ' + c.why, 4200);
    job = c.job || job;
  }
  const m = b.meta(job.resource);
  if ((job.qty | 0) > rigProfile(chosenRig()).capacity) return b.toast('⚠ That load does not fit your rig. Pick a bigger one in the Garage.', 4200);
  // 🪖 One guard per run, offered before the wheel turns. Paid by the company
  //    treasury (or the freelancer) through sql/039; the job row remembers it.
  if (!job.guard_hired && !Haul.missing) {
    const fee = guardFee(b.econ()); const corp = Haul.transportOp ? b.myCorp() : null;
    const yes = await b.confirm('Hire a guard for this run? 🔥 ' + fmtNum(fee) + (corp ? ' from the ' + corp.name + ' treasury' : ' from your wallet') + '.\n\nRaiders on long routes try to ram you off the road. A guard opens fire once per run, the first time they close in.');
    if (yes) { const g = await hireGuard(job); if (g.ok) { job.guard_hired = true; b.toast('🪖 Guard hired for this run.', 3000); } else b.toast('⚠ ' + g.why, 4200); }
  }
  let out;
  try { out = await runGame({ cities: cities(), fromId: job.from_node, toId: job.to_node, resource: job.resource, cargoLabel: job.qty + '× ' + m.name, cargoColor: m.color, guard: !!job.guard_hired, upgrades: Haul.upgrades, driverId: b.userId(), rig: chosenRig() }); }
  catch (e) { b.toast('⚠ ' + (e && e.message), 6000); await loadAll(); paint(); return; }
  busy = true; paint();
  const s = await completeRun(job, out);
  busy = false;
  if (!s.ok) { b.toast('⚠ Run not settled: ' + s.why, 6000); await loadAll(); paint(); return; }
  const run = s.run || {};
  await loadAll(); paint();   // repaint before the card, see practiceRun()
  resultCard(out, {
    failed: run.outcome === 'failed', farePaid: run.fare_paid | 0, refund: (run.fare | 0) - (run.fare_paid | 0), wagePct: Number(run.wage_pct), wageGross: run.wage_gross | 0,
    penalty: run.penalty | 0, driverPay: run.driver_pay | 0, companyNet: run.company_net | 0, burned: run.corp_id ? 0 : (run.penalty | 0),
    bonusPaid: run.bonus_paid | 0, tollPaid: run.toll_paid | 0,
  }, { fare: job.fare, corp: !!run.corp_id, bonus: job.bonus | 0 });
}

function resultCard(out, s, o) {
  const ov = document.getElementById(OV); if (!ov) return;
  const ok = out.completed && !s.failed;
  const d = document.createElement('div'); d.className = 'hl-result';
  d.innerHTML = `<div class="hl-result-card">
    <div class="hl-result-t">${ok ? '🏁 Delivered' : out.abandoned ? '🚫 Run abandoned' : '💥 Cargo lost'}</div>
    <div class="hl-result-grid">
      <div><span>Time</span><b>${fmtTime(out.timeS)} <i class="hl-dim">/ par ${fmtTime(out.parS)}</i></b></div>
      <div><span>Cargo intact</span><b>${Math.round(out.cargoPct * 100)}%</b></div>
      <div><span>Car hits</span><b>${out.crashesCar}</b></div>
      <div><span>Rail hits</span><b>${out.crashesRail}</b></div>
      <div><span>Rig</span><b>${esc(out.rig || '')}</b></div>
      <div><span>Exits</span><b>${out.wrongExits ? '<span class="hl-err">' + out.wrongExits + ' wrong · +' + out.detourM + ' m</span>' : 'all correct'}</b></div>
      <div><span>Raiders</span><b>${out.raiders ? out.raidersBeaten + '/' + out.raiders + ' beaten' + (out.guardUsed ? ' · 🪖 guard fired' : '') : 'none'}</b></div>
    </div>
    ${o.practice ? `<div class="hl-dim hl-small">Practice — nothing was paid. On a real 🔥 ${fmtNum(o.fare)} fare this run would have paid you <b>🔥 ${fmtNum(s.driverPay)}</b>${s.penalty ? ' after a 🔥 ' + fmtNum(s.penalty) + ' crash penalty' : ''}${bonusEarned(out, bridge().econ()) ? ', and you would have earned any on-time bonus' : ', and missed any on-time bonus'}.</div>`
      : ok ? `<div class="hl-settle">
          <div><span>Fare escrowed</span><b>🔥 ${fmtNum(o.fare)}</b></div>
          <div><span>Shipper charged (${Math.round(out.cargoPct * 100)}% arrived)</span><b>🔥 ${fmtNum(s.farePaid)}</b>${s.refund ? '<i class="hl-dim"> · 🔥 ' + fmtNum(s.refund) + ' refunded</i>' : ''}</div>
          <div><span>Your wage (${s.wagePct}%)</span><b>🔥 ${fmtNum(s.wageGross)}</b></div>
          <div><span>Crash penalty</span><b class="hl-err">− 🔥 ${fmtNum(s.penalty)}</b></div>
          ${o.bonus ? `<div><span>On-time bonus 🎁</span><b>${s.bonusPaid ? '🔥 ' + fmtNum(s.bonusPaid) : '<span class="hl-dim">missed — refunded to the shipper</span>'}</b></div>` : ''}
          ${s.tollPaid ? `<div><span>Tolls to node owners</span><b class="hl-err">− 🔥 ${fmtNum(s.tollPaid)}</b></div>` : ''}
          <div class="hl-settle-big"><span>Paid to you</span><b>🔥 ${fmtNum(s.driverPay + (s.bonusPaid | 0))}</b></div>
          ${o.corp ? `<div><span>To the company treasury</span><b>🔥 ${fmtNum(s.companyNet)}</b></div>` : `<div class="hl-dim hl-small">Freelance run — the penalty was burned, not paid to anyone.</div>`}
        </div>`
      : '<div class="hl-dim hl-small">Nothing was paid. The shipment is back on the board and the failed run is on your record.</div>'}
    <div class="hl-job-act"><button class="hl-btn hl-btn-go" data-h="result-close">Done</button></div>
  </div>`;
  ov.appendChild(d);
}

/* ── Events ──────────────────────────────────────────────────────────────── */
async function onClick(ev) {
  const t = ev.target.closest('[data-h]'); if (!t) return;
  const b = bridge(); const h = t.dataset.h;
  const byId = (id) => Haul.jobs.concat(Haul.mine).find((j) => j.id === id);
  if (h === 'close') return close();
  if (h === 'result-close') { const r = t.closest('.hl-result'); if (r) r.remove(); return; }
  if (h === 'tab') { tab = t.dataset.tab; if (tab === 'company') { busy = true; paint(); await loadCompany(); busy = false; } paint(); return; }
  if (h === 'refresh') { busy = true; paint(); await loadAll(); busy = false; paint(); return; }
  if (h === 'practice') return practiceRun();
  if (h === 'how-toggle') { howOpen = !howOpen; try { localStorage.setItem('haul_how_open', howOpen ? '1' : '0'); } catch (e) {} paint(); return; }
  if (h === 'rig') { try { localStorage.setItem('haul_rig', t.dataset.id); } catch (e) {} paint(); return; }
  if (h === 'buy') {
    const u = UPGRADES.find((x) => x.id === t.dataset.id); if (!u) return;
    const price = upgradePrice(b.econ(), u.id, (Haul.upgrades[u.id] | 0) + 1);
    if (!(await b.confirm('Buy ' + u.name + ' L' + ((Haul.upgrades[u.id] | 0) + 1) + ' for 🔥 ' + fmtNum(price) + '?'))) return;
    busy = true; paint(); const r = await buyUpgrade(u.id); busy = false;
    b.toast(r.ok ? '🔧 ' + u.name + ' is now L' + r.level + '.' : '⚠ ' + r.why, 4000); paint(); return;
  }
  if (h === 'claim' || h === 'drive') { const j = byId(t.dataset.id); if (j) return startRun(j); }
  if (h === 'cancel') {
    const j = byId(t.dataset.id); if (!j) return;
    if (!(await b.confirm('Cancel this shipment? The fare is refunded and the goods return to your stash.'))) return;
    busy = true; paint(); const ok = await cancelJob(j); busy = false;
    b.toast(ok ? '↩ Shipment cancelled — fare and goods returned.' : '⚠ Could not cancel (a driver may have just taken it).', 4200);
    await loadAll(); paint(); return;
  }
  if (h === 'collect') {
    const j = byId(t.dataset.id); if (!j) return;
    busy = true; paint(); const r = await claimGoods(j); busy = false;
    b.toast(r.ok ? '📦 Collected ' + r.units + ' ' + b.meta(r.resource).name + '.' : '⚠ ' + r.why, 4200);
    await loadAll(); paint(); return;
  }
  if (h === 'post') {
    const C = cities(); const r = route(C, form.fromId, form.toId);
    if (!r) return b.toast('Pick two cities.');
    const min = minFare(b.econ(), r.km, form.qty, form.resource);
    const fare = Math.max(min, Math.floor(form.fare));
    const bonus = Math.max(0, Math.floor(form.bonus || 0)); const prem = form.insured ? insurancePremium(b.econ(), fare) : 0;
    if (!(await b.confirm('Post ' + form.qty + '× ' + b.meta(form.resource).name + ' from ' + cityName(form.fromId) + ' to ' + cityName(form.toId) + ' (' + fmtKm(r.km) + ') for 🔥 ' + fmtNum(fare) + (bonus ? ' + 🔥 ' + fmtNum(bonus) + ' bonus escrow' : '') + (prem ? ' + 🔥 ' + fmtNum(prem) + ' insurance' : '') + '?\n\nThe Cinder is escrowed now and the goods leave your stash.'))) return;
    busy = true; paint();
    const res = await postJob({ fromId: form.fromId, fromName: cityName(form.fromId), toId: form.toId, toName: cityName(form.toId), resource: form.resource, qty: form.qty, km: r.km, fare, recipientId: form.recipientId || null, path: r.path, insured: form.insured, bonus });
    busy = false;
    if (res.ok) { b.toast('📦 Shipment posted. Drivers can see it now.', 4200); tab = 'dispatch'; await loadAll(); }
    else b.toast('⚠ ' + res.why, 5200);
    paint(); return;
  }
  if (h === 'save-terms') {
    const ov = document.getElementById(OV); const terms = {};
    ov.querySelectorAll('[data-t]').forEach((i) => { terms[i.dataset.t] = Math.max(0, Math.min(100, Number(i.value) || 0)); });
    busy = true; paint(); const ok = await saveCompany(terms); busy = false;
    b.toast(ok ? '🏢 Company terms saved.' : '⚠ Could not save terms.', 3600); paint(); return;
  }
  if (h === 'save-wages') {
    const ov = document.getElementById(OV); let n = 0, bad = 0;
    busy = true; paint();
    for (const i of ov.querySelectorAll('[data-wage]')) {
      const uid = i.dataset.wage; const v = i.value === '' ? null : Math.max(0, Math.min(100, Number(i.value) || 0));
      const cur = Haul.wages[uid];
      if ((v == null && cur == null) || (v != null && cur === v)) continue;
      if (await setWage(uid, v)) n++; else bad++;
    }
    busy = false;
    b.toast(bad ? '⚠ ' + bad + ' wage(s) failed to save.' : n ? '💼 ' + n + ' driver wage(s) saved.' : 'No wage changes.', 3600); paint(); return;
  }
}
function onInput(ev) {
  const f = ev.target.dataset.f; if (!f) return;
  const v = ev.target.value;
  if (f === 'pguard') { practice.guard = !!ev.target.checked; return; }
  if (f === 'insured') { form.insured = !!ev.target.checked; paint(); return; }
  if (f === 'bonus') { form.bonus = Math.max(0, parseInt(v, 10) || 0); if (ev.type === 'change') paint(); return; }
  if (f === 'pfrom' || f === 'pto') { practice[f === 'pfrom' ? 'fromId' : 'toId'] = v; if (practice.fromId === practice.toId) { const C = cities(); practice.toId = (C.find((c) => c.id !== practice.fromId) || C[0]).id; } paint(); return; }
  if (f === 'qty') form.qty = Math.max(1, parseInt(v, 10) || 1);
  else if (f === 'fare') form.fare = Math.max(0, parseInt(v, 10) || 0);
  else form[f] = v;
  if (f === 'fromId' && form.toId === form.fromId) form.toId = '';
  if (f !== 'fare') { form.fare = 0; }   // re-derive the minimum for the new route/load
  if (ev.type === 'change' || f !== 'fare') paint();
}

/* ── Open / close ────────────────────────────────────────────────────────── */
function open() {
  injectStyle();
  let ov = document.getElementById(OV);
  if (!ov) {
    ov = document.createElement('div'); ov.id = OV;
    ov.addEventListener('click', (ev) => { if (ev.target === ov) close(); });
    ov.addEventListener('click', onClick);
    ov.addEventListener('change', onInput);
    ov.addEventListener('input', (ev) => { if (['fare', 'qty', 'bonus'].includes(ev.target.dataset.f)) onInput(ev); });
    document.body.appendChild(ov);
  }
  tab = 'dispatch'; busy = true; paint();
  Promise.all([loadAll(), bridge().nodeOwnersRefresh ? bridge().nodeOwnersRefresh() : null]).then(() => { busy = false; paint(); });
}
function close() { const ov = document.getElementById(OV); if (ov) ov.remove(); }

function injectStyle() {
  if (document.getElementById('haul-css')) return;
  const s = document.createElement('style'); s.id = 'haul-css';
  s.textContent = `
#haul-ov{position:fixed;inset:0;z-index:100040;background:rgba(4,6,12,.78);backdrop-filter:blur(3px);display:flex;align-items:center;justify-content:center;padding:12px;font-family:inherit;color:#e8e0d0}
.hl-panel{width:min(980px,100%);max-height:96vh;display:flex;flex-direction:column;background:linear-gradient(180deg,#171a24,#0f1118);border:1px solid rgba(255,176,96,.35);border-radius:16px;box-shadow:0 30px 80px rgba(0,0,0,.7);overflow:hidden}
.hl-head{display:flex;justify-content:space-between;align-items:center;padding:14px 18px;border-bottom:1px solid rgba(255,255,255,.08)}
.hl-title{font-size:1.35rem;font-weight:900;color:#ffb060;letter-spacing:.02em}
.hl-sub{font-size:.78rem;color:#a89880}
.hl-head-r{display:flex;gap:10px;align-items:center}
.hl-x{background:none;border:1px solid rgba(255,255,255,.2);color:#fff;border-radius:8px;width:34px;height:34px;cursor:pointer;font-size:1rem}
.hl-pill{background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.12);border-radius:999px;padding:4px 10px;font-size:.82rem;font-weight:700}
.hl-tabs{display:flex;gap:4px;padding:8px 12px 0;overflow-x:auto}
.hl-tab{flex:1;min-width:120px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.1);border-bottom:none;border-radius:10px 10px 0 0;color:#c8bca8;padding:9px 8px;font-weight:700;cursor:pointer;white-space:nowrap}
.hl-tab.on{background:rgba(255,176,96,.16);color:#ffd9a8;border-color:rgba(255,176,96,.4)}
.hl-body{overflow:auto;padding:14px;position:relative;flex:1}
.hl-busy{position:sticky;top:0;z-index:2;background:rgba(255,176,96,.18);color:#ffd9a8;text-align:center;padding:4px;border-radius:8px;margin-bottom:8px;font-size:.8rem}
.hl-card{background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);border-radius:12px;padding:12px 14px;margin-bottom:12px}
.hl-card-t{font-weight:800;color:#f0e6d0;margin:10px 0 8px;display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.hl-card .hl-card-t{margin-top:0}
.hl-dim{color:#a89880}.hl-small{font-size:.78rem}.hl-err{color:#ff8aa0}
.hl-row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.hl-row .hl-in{width:auto;flex:1;min-width:150px}
.hl-job{background:rgba(0,0,0,.25);border:1px solid rgba(255,255,255,.08);border-left:4px solid #6cd4ff;border-radius:10px;padding:10px 12px;margin-bottom:8px}
.hl-job.hl-claimed{border-left-color:#ffd166}.hl-job.hl-delivered{border-left-color:#9ad17a}.hl-job.hl-cancelled{border-left-color:#666;opacity:.7}
.hl-job-route{font-size:1rem}.hl-job-meta{font-size:.84rem;margin-top:3px}
.hl-job-act{margin-top:8px;display:flex;gap:8px;flex-wrap:wrap;align-items:center}
.hl-btn{background:#2a2d38;border:1px solid rgba(255,255,255,.18);color:#fff;border-radius:9px;padding:8px 14px;font-weight:700;cursor:pointer}
.hl-btn:disabled{opacity:.45;cursor:default}
.hl-btn-go{background:linear-gradient(180deg,#ff9a40,#e06a1a);border-color:#ffb060;color:#1a0d00}
.hl-btn-sm{padding:3px 9px;font-size:.8rem}
.hl-empty{padding:18px;text-align:center;color:#a89880;border:1px dashed rgba(255,255,255,.12);border-radius:10px}
.hl-in{background:#0c0e14;border:1px solid rgba(255,255,255,.18);color:#fff;border-radius:8px;padding:7px 9px;width:100%;box-sizing:border-box;font:inherit}
.hl-in-sm{width:76px;padding:4px 6px}
.hl-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:10px}
.hl-grid-4{grid-template-columns:repeat(auto-fit,minmax(160px,1fr))}
.hl-grid label{display:flex;flex-direction:column;gap:4px;font-size:.8rem;color:#c8bca8}
.hl-howgrid{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:10px 16px;margin-top:4px}
.hl-how{display:flex;gap:10px;align-items:flex-start;font-size:.88rem}
.hl-how-i{font-size:1.3rem;line-height:1.2;width:1.6rem;text-align:center;flex:none}
.hl-howcard .hl-card-t{margin-bottom:4px}
.hl-stat{display:block;width:64px;height:8px;background:rgba(255,255,255,.1);border-radius:4px;overflow:hidden}.hl-stat b{display:block;height:100%;background:#ffb060}
.hl-row-on td{background:rgba(255,176,96,.08)}
.hl-chk{display:inline-flex;align-items:center;gap:6px;font-size:.84rem;color:#e8e0d0;cursor:pointer}
.hl-chk input{width:auto}
.hl-route{margin-top:10px;padding:8px 10px;background:rgba(108,212,255,.08);border-radius:8px;font-size:.86rem}
.hl-tblwrap{overflow-x:auto}
.hl-tbl{width:100%;border-collapse:collapse;font-size:.84rem}
.hl-tbl th{text-align:left;color:#a89880;font-weight:600;padding:6px 8px;border-bottom:1px solid rgba(255,255,255,.1);white-space:nowrap}
.hl-tbl td{padding:8px;border-bottom:1px solid rgba(255,255,255,.06);vertical-align:top}
.hl-rankcard{display:flex;gap:16px;align-items:flex-start;border-color:var(--acc)}
.hl-rank-big{font-size:3.4rem;line-height:1;filter:drop-shadow(0 0 12px var(--acc))}
.hl-rank-name{font-size:1.3rem;font-weight:900;color:var(--acc)}
.hl-bars{display:grid;gap:5px;margin:10px 0;max-width:420px}
.hl-bar{display:grid;grid-template-columns:120px 1fr 32px;gap:8px;align-items:center;font-size:.78rem}
.hl-bar i{display:block;height:8px;background:rgba(255,255,255,.08);border-radius:5px;overflow:hidden}
.hl-bar b{display:block;height:100%;background:var(--acc)}
.hl-bar em{font-style:normal;text-align:right}
.hl-run{display:flex;justify-content:space-between;gap:10px;padding:6px 0;border-bottom:1px solid rgba(255,255,255,.06);font-size:.84rem;flex-wrap:wrap}
.hl-result{position:absolute;inset:0;background:rgba(0,0,0,.6);display:flex;align-items:center;justify-content:center;padding:14px}
.hl-result-card{background:#171a24;border:1px solid rgba(255,176,96,.4);border-radius:14px;padding:18px;width:min(460px,100%)}
.hl-result-t{font-size:1.4rem;font-weight:900;color:#ffb060;margin-bottom:10px}
.hl-result-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:10px}
.hl-result-grid div{background:rgba(255,255,255,.05);border-radius:8px;padding:8px}
.hl-result-grid span,.hl-settle span{display:block;font-size:.72rem;color:#a89880}
.hl-settle div{display:flex;justify-content:space-between;align-items:baseline;padding:4px 0;border-bottom:1px solid rgba(255,255,255,.06);gap:8px;flex-wrap:wrap}
.hl-settle-big b{font-size:1.25rem;color:#9ad17a}
@media (max-width:640px){.hl-tab{min-width:100px;font-size:.8rem}.hl-rankcard{flex-direction:column}}
`;
  document.head.appendChild(s);
}

/* ───── index.js ───── */
const map = { MAP_KM, FALLBACK_CITIES, normalizeCities, route, ROAD_M_PER_KM, CRUISE_MPS, roadLength, parSeconds };
const economy = { DEFAULT_ECON, econOf, minFare, defaultTerms, settle, RANKS, rating, rankFor, worth, verdict, CARGO_CLASSES, cargoClass, UPGRADES, upgradeEffects, weatherFor };
/* ═══════════════════════════════════════════════════════════════════════════
   /src/haul/index.js — the module entry point for HIGHWAY HAUL.

   index.html loads exactly this file. It publishes `window.MythicHaul` so the
   legacy app has one tile to draw and one function to call, and stays
   completely inert until open().

   WHAT THE FEATURE IS
     Crazy-Taxi-style freight. A shipper posts goods to move from one city
     node to another and escrows a Cinder fare. A driver takes the wheel in a
     3D highway run whose LENGTH comes from the city node map. Every car or
     rail they hit damages the cargo and — if they drive for a transport
     company — comes out of their wage, not the company's take. Every run
     builds a driver rank the company owner can read against the wage they
     pay. Files: haul.map (routes), haul.economy (fares/wages/rank),
     haul.game (the 3D run), haul.api (Supabase, guarded), haul.render (UI).

   ⚠ This module must never throw at import time. It loads on every page
     load; a failure here would take a 215k-line app down with it, so the
     registration is wrapped and the tile simply does not appear.
   ═══════════════════════════════════════════════════════════════════════════ */






const MythicHaul = {
  version: 'v1',
  open, close, paint,
  state: Haul, loadAll,
  map, economy, play, planRun,          // pure pieces, exposed for the console and tests
  bridgeReady,
  /* The portal tile's badge. Cheap and synchronous — it is called on every
     hub repaint, so it must never fetch. */
  badge() {
    try {
      const n = Haul.jobs.filter((j) => j.status === 'open').length;
      return n ? n + ' shipments waiting' : 'Freight · drive for Cinder';
    } catch (e) { return 'Freight'; }
  },
  debug() {
    return { bridgeReady: bridgeReady(), signedIn: bridge().signedIn(), cities: bridge().cities().length, econ: bridge().econ(), jobs: Haul.jobs.length, missing: Haul.missing, offline: Haul.offline, error: Haul.error };
  },
};

try {
  if (typeof window !== 'undefined') {
    window.MythicHaul = MythicHaul;
    window.__haul = MythicHaul;
    if (!bridgeReady()) { try { console.warn('[haul] MythicHaulBridge missing — practice mode with the built-in map.'); } catch (e) {} }
    try { window.dispatchEvent(new CustomEvent('mythic:haul-ready')); } catch (e) {}
  }
} catch (e) {
  try { console.warn('[haul] registration failed —', e); } catch (e2) {}
}
