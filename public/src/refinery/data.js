/* ═══════════════════════════════════════════════════════════════════════════
   🛢 HIDN PETRO — THE CRACKING YARD · static tables
   ---------------------------------------------------------------------------
   Pure data + pure functions. No I/O, no globals, no bridge. Everything here
   is deterministic so the sim, the blender and the UI can all agree on what a
   barrel of anything is worth without a round trip.

   WHY the numbers look like real refining: the whole point of this mini-game
   is that the blend stage rewards understanding rather than clicking. Real
   blending has two properties that make it a GAME rather than a slider puzzle:
     1. Octane does not blend linearly — ethanol gives a big synergy bonus at
        low volume that saturates hard, so "just pour ethanol" stops working.
     2. Vapour pressure blends on an INDEX (RVP^1.25), so butane — the cheapest
        octane on the yard — quietly destroys a batch's stability long before
        it shows up anywhere else on the panel.
   Those two facts are what turn "I'm 0.6 octane short" into a real decision
   instead of an arithmetic problem. Do not "simplify" them to linear mixes.
   ═════════════════════════════════════════════════════════════════════════ */

export const REF_VERSION = 'r1';

/* ── CRUDE GRADES ─────────────────────────────────────────────────────────
   api      — API gravity. HIGH = light = more naphtha/gasoline, less residue.
   sulfur   — weight %. <0.5 sweet, >1.5 sour. Sour crude needs the Treater or
              every product carries the sulfur straight into the contract spec.
   bsw      — basic sediment & water, %. Removed by the desalter; whatever is
              left fouls the column and shows up as lost purity.
   price    — Cinder per 1000 L at market index 1.0.
   Heavier + sourer is CHEAPER. That is the whole trade: a player with a
   Cracker and a Treater can buy the crude nobody else can use. */
export const CRUDES = [
  { id: 'brent',   name: 'Black River Light',  api: 38, sulfur: 0.28, bsw: 0.6, price: 1420, blurb: 'Sweet and light. Forgiving, expensive, and everyone wants it.' },
  { id: 'midcon',  name: 'Midcontinent Blend', api: 33, sulfur: 0.62, bsw: 1.4, price: 1180,  blurb: 'The workhorse. Balanced cuts, mild sulfur.' },
  { id: 'sour',    name: 'Vasquez Sour',       api: 29, sulfur: 1.85, bsw: 2.2, price: 900,  blurb: 'Cheap because it is nasty. Needs a Hydrotreater to be worth anything.' },
  { id: 'heavy',   name: 'Tar Flats Heavy',    api: 22, sulfur: 2.60, bsw: 3.1, price: 700,  blurb: 'Mostly residue. A Cracker turns it into money; without one it is sludge.' },
  { id: 'salvage', name: 'Salvaged Slate',     api: 26, sulfur: 3.20, bsw: 5.4, price: 500,  blurb: 'Pulled from a ruptured field. Filthy, contaminated, almost free.' },
  { id: 'condens', name: 'Anomaly Condensate', api: 46, sulfur: 0.12, bsw: 0.4, price: 1790, blurb: 'Ultra-light. Enormous naphtha yield, almost no diesel. Rare.' },
];
export const CRUDE_BY_ID = Object.fromEntries(CRUDES.map(c => [c.id, c]));

/* ── DISTILLATION CUTS ────────────────────────────────────────────────────
   Straight-run yield is a function of API gravity, which is the honest
   version of "light crude makes gasoline". Fractions always sum to 1. */
export function cutYield(api) {
  // Normalised lightness 0 (22 API tar) → 1 (46 API condensate).
  const L = Math.max(0, Math.min(1, (api - 20) / 26));
  const naphtha = 0.10 + 0.34 * L;          // gasoline blendstock
  const kero    = 0.09 + 0.09 * L;          // jet / kerosene
  const diesel  = 0.17 + 0.11 * L;          // middle distillate
  const gasoil  = 0.16 - 0.02 * L;          // cat feed → the Cracker's meal
  const heavy   = Math.max(0.02, 1 - (naphtha + kero + diesel + gasoil));
  return { naphtha, kero, diesel, gasoil, heavy };
}

/* ── BLEND COMPONENTS ─────────────────────────────────────────────────────
   ron    — research octane of the neat component.
   sulfur — ppm carried into the blend (blends linearly by volume; close
            enough at these densities and far more legible than mass).
   purity — % of the stream that is on-spec hydrocarbon.
   rvp    — Reid vapour pressure, psi. THIS is the trap. See rvpBlend().
   cost   — Cinder per litre to make/buy. Straight-run streams you already own
            are priced at their opportunity cost (you could have sold them).
   unit   — the equipment that produces it. null = always available.
   cap    — hard volume-fraction ceiling for a legal road fuel, or null. */
export const COMPONENTS = {
  naphtha:   { id: 'naphtha',   name: 'Straight-Run Naphtha', ico: '🧪', ron: 68,  sulfur: 340, purity: 96, rvp: 11.0, cost: 2.10, unit: null,      cap: null, color: '#c8b98a', blurb: 'Cheap volume with no octane. The floor of every blend.' },
  reformate: { id: 'reformate', name: 'Reformate',            ico: '♻️', ron: 98,  sulfur: 35,  purity: 98, rvp: 3.4,  cost: 4.50, unit: 'reformer',cap: null, color: '#e8a13a', blurb: 'High octane, low vapour. The clean way to fix a short batch.' },
  alkylate:  { id: 'alkylate',  name: 'Alkylate',             ico: '💎', ron: 95,  sulfur: 8,   purity: 99, rvp: 5.0,  cost: 6.30, unit: 'alky',    cap: null, color: '#9fe6e6', blurb: 'The premium blendstock. Octane AND stability AND purity. Priced like it.' },
  catgas:    { id: 'catgas',    name: 'Cat Gasoline',         ico: '🔥', ron: 91,  sulfur: 690, purity: 94, rvp: 8.2,  cost: 2.80, unit: 'cracker', cap: null, color: '#c2452d', blurb: 'Cracker output. Good octane, filthy sulfur — pair it with the Treater.' },
  butane:    { id: 'butane',    name: 'Butane',               ico: '💨', ron: 93,  sulfur: 4,   purity: 99, rvp: 60.0, cost: 0.95, unit: null,      cap: 0.08, color: '#7bc043', blurb: 'The cheapest octane on the yard. It will also fail your stability test.' },
  ethanol:   { id: 'ethanol',   name: 'Ethanol',              ico: '🌾', ron: 113, sulfur: 0,   purity: 99, rvp: 18.0, cost: 3.75, unit: null,      cap: 0.10, color: '#a0e070', blurb: 'Big octane synergy at low dose. The bonus saturates — pouring more stops helping.' },
  hydro:     { id: 'hydro',     name: 'Hydrotreated Cut',     ico: '🧼', ron: 74,  sulfur: 6,   purity: 99, rvp: 6.5,  cost: 3.10, unit: 'treater', cap: null, color: '#7fb0ff', blurb: 'Sulfur scrubbed out. Dilutes a sour blend back under the limit.' },
  slopcut:   { id: 'slopcut',   name: 'Reprocessed Slop',     ico: '🥣', ron: 79,  sulfur: 520, purity: 88, rvp: 9.4,  cost: 0.55, unit: null,      cap: 0.25, color: '#8d959e', blurb: 'A failed batch, run back through. Nearly free, drags purity down.' },
};
export const COMPONENT_LIST = Object.values(COMPONENTS);

/* ── BLENDING MATH ────────────────────────────────────────────────────────
   mix: { componentId: litres }. Everything below is volume-fraction based. */

export function mixVolume(mix) {
  let v = 0; for (const k in mix) v += Math.max(0, mix[k] || 0);
  return v;
}

/* Octane. Linear volumetric base + the ethanol synergy term.
   The synergy is real chemistry made legible: ethanol lifts the octane of the
   hydrocarbons around it, strongly at first, then not at all. Modelled as a
   saturating curve on ethanol's volume fraction so the FIRST 3% is worth far
   more than the next 7%. This is the single most important line in the file —
   it is why the blend stage has a skill ceiling. */
export function octaneBlend(mix) {
  const V = mixVolume(mix); if (V <= 0) return 0;
  let base = 0;
  for (const k in mix) {
    const c = COMPONENTS[k]; if (!c) continue;
    base += (mix[k] / V) * c.ron;
  }
  const ef = (mix.ethanol || 0) / V;
  // Saturating synergy: ≈ +5.6 RON at 3% ethanol, ≈ +7.3 at 10%, flat after.
  const synergy = ef > 0 ? 9.2 * (1 - Math.exp(-ef / 0.028)) : 0;
  return base + synergy;
}

/* Reid vapour pressure. Blends on the Chevron index, NOT on volume.
   rvp_blend = ( Σ v_i · rvp_i^1.25 ) ^ (1/1.25)
   With the exponent above 1, a small slug of a very high-RVP component
   (butane at 60 psi) dominates the result. A player who fixes octane with
   butane watches Stability collapse for reasons the octane readout never
   showed them — which is exactly the lesson. */
export function rvpBlend(mix) {
  const V = mixVolume(mix); if (V <= 0) return 0;
  let idx = 0;
  for (const k in mix) {
    const c = COMPONENTS[k]; if (!c) continue;
    idx += (mix[k] / V) * Math.pow(c.rvp, 1.25);
  }
  return Math.pow(Math.max(0, idx), 1 / 1.25);
}

/* Sulfur, ppm — linear by volume. */
export function sulfurBlend(mix) {
  const V = mixVolume(mix); if (V <= 0) return 0;
  let s = 0;
  for (const k in mix) { const c = COMPONENTS[k]; if (c) s += (mix[k] / V) * c.sulfur; }
  return s;
}

/* Purity, %. Linear on the CONTAMINANT (100 - purity), which is the physically
   honest direction: dirt dilutes, it does not average away. */
export function purityBlend(mix) {
  const V = mixVolume(mix); if (V <= 0) return 0;
  let dirt = 0;
  for (const k in mix) { const c = COMPONENTS[k]; if (c) dirt += (mix[k] / V) * (100 - c.purity); }
  return 100 - dirt;
}

export function mixCost(mix) {
  let c = 0;
  for (const k in mix) { const cm = COMPONENTS[k]; if (cm) c += Math.max(0, mix[k] || 0) * cm.cost; }
  return c;
}

/* Everything the panel shows about a batch, in one pass. */
export function assayMix(mix) {
  const volume = mixVolume(mix);
  return {
    volume,
    octane: octaneBlend(mix),
    rvp:    rvpBlend(mix),
    sulfur: sulfurBlend(mix),
    purity: purityBlend(mix),
    cost:   mixCost(mix),
  };
}

/* ── FUEL GRADES / CONTRACT SPECS ─────────────────────────────────────────
   Each grade is a target ZONE, not a number. `rvpMax` is the stability gate;
   it is deliberately never mentioned in the contract headline, the same way a
   real spec sheet buries it — the player learns it by failing once. */
export const GRADES = {
  utility:  { id: 'utility',  name: 'Utility / Off-Road', ico: '🚜', octaneMin: 80, sulfurMax: 900, purityMin: 90, rvpMax: 14.5, pricePerL: 4.30, tier: 0, blurb: 'Generators, farm rigs, anything that does not ask questions.' },
  regular:  { id: 'regular',  name: 'Regular Fuel',       ico: '⛽', octaneMin: 87, sulfurMax: 300, purityMin: 95, rvpMax: 11.5, pricePerL: 6.20, tier: 1, blurb: 'The volume grade. Every station wants it, nobody pays a premium.' },
  midgrade: { id: 'midgrade', name: 'Mid-Grade',          ico: '🔷', octaneMin: 89, sulfurMax: 150, purityMin: 96, rvpMax: 10.5, pricePerL: 7.65, tier: 2, blurb: 'Half a point of octane, a real jump in margin.' },
  premium:  { id: 'premium',  name: 'Premium',            ico: '👑', octaneMin: 93, sulfurMax: 60,  purityMin: 97, rvpMax: 9.5,  pricePerL: 10.25, tier: 3, blurb: 'Needs a Reformer or an Alkylation unit. Straight-run alone cannot reach it.' },
  diesel:   { id: 'diesel',   name: 'Highway Diesel',     ico: '🚛', octaneMin: 0,  sulfurMax: 120, purityMin: 96, rvpMax: 99,   pricePerL: 6.65, tier: 2, blurb: 'Cetane, not octane — sulfur and purity are the whole fight.', diesel: true },
  jet:      { id: 'jet',      name: 'Jet-Type Kerosene',  ico: '✈️', octaneMin: 0,  sulfurMax: 45,  purityMin: 98, rvpMax: 99,   pricePerL: 9.30, tier: 3, blurb: 'Brutal purity spec. Military and air freight only.', diesel: true },
};
export const GRADE_LIST = Object.values(GRADES);

/* Which grade a finished batch actually qualifies for — the "downgrade" path.
   Returns the BEST grade the assay legitimately passes, or null for slop.
   This is what makes a failed premium batch worth something instead of a
   write-off, and it is checked against the same numbers the contract uses so
   a player can never be told two different things about one tank. */
export function bestGradeFor(assay, dieselSide) {
  let best = null;
  for (const g of GRADE_LIST) {
    if (!!g.diesel !== !!dieselSide) continue;
    if (assay.octane + 1e-9 < g.octaneMin) continue;
    if (assay.sulfur - 1e-9 > g.sulfurMax) continue;
    if (assay.purity + 1e-9 < g.purityMin) continue;
    if (assay.rvp - 1e-9 > g.rvpMax) continue;
    if (!best || g.pricePerL > best.pricePerL) best = g;
  }
  return best;
}

/* Per-property pass/fail, for the test card. */
export function specCheck(assay, grade) {
  return {
    octane:    { ok: assay.octane + 1e-9 >= grade.octaneMin, have: assay.octane, need: grade.octaneMin, label: 'Octane',    fmt: v => v.toFixed(1) },
    sulfur:    { ok: assay.sulfur - 1e-9 <= grade.sulfurMax, have: assay.sulfur, need: grade.sulfurMax, label: 'Sulfur',    fmt: v => Math.round(v) + ' ppm', inverted: true },
    purity:    { ok: assay.purity + 1e-9 >= grade.purityMin, have: assay.purity, need: grade.purityMin, label: 'Purity',    fmt: v => v.toFixed(1) + '%' },
    stability: { ok: assay.rvp - 1e-9 <= grade.rvpMax,       have: assay.rvp,    need: grade.rvpMax,    label: 'Stability', fmt: v => v.toFixed(1) + ' psi RVP', inverted: true },
  };
}

/* ── EQUIPMENT ────────────────────────────────────────────────────────────
   ⚠ READ THIS BEFORE ADDING AN UPGRADE.
   Nothing in this table may be a flat percentage bonus. Every entry either
   unlocks a STREAM the player could not make, widens the SAFE ENVELOPE they
   can operate in, or adds a SLOT that lets them run something in parallel.
   "+20% fuel" upgrades were explicitly rejected for this feature: they make
   the numbers bigger without ever changing what the player does on the panel.
   If a proposed upgrade can be expressed as a single multiplier on output,
   it does not belong here — find the capability it is standing in for. */
export const EQUIPMENT = {
  crudeTank:  { id: 'crudeTank',  name: 'Crude Tank',          ico: '🛢️', base: 14000, growth: 1.75, max: 6,  cat: 'storage', desc: 'Holds 30,000 L of crude each. Cannot take a shipment you have nowhere to put.' },
  storeTank:  { id: 'storeTank',  name: 'Product Tank',        ico: '🏗️', base: 11000, growth: 1.70, max: 10, cat: 'storage', desc: 'One product per tank. A tank holding diesel will not take gasoline until it is cleaned.' },
  blendTank:  { id: 'blendTank',  name: 'Blending Tank',       ico: '⚗️', base: 26000, growth: 2.10, max: 4,  cat: 'process', desc: 'Each tank is one contract you can have in progress. One tank = one job at a time.' },
  bay:        { id: 'bay',        name: 'Loading Bay',         ico: '🚏', base: 19000, growth: 1.90, max: 4,  cat: 'logistics', desc: 'A truck can only load at a free bay. Bays, not trucks, are what cap your dispatch rate.' },
  truck:      { id: 'truck',      name: 'Tanker Truck',        ico: '🚛', base: 22000, growth: 1.55, max: 8,  cat: 'logistics', desc: 'Carries 9,000 L. More trucks means more deliveries in flight, not faster ones.' },
  cdu:        { id: 'cdu',        name: 'Distillation Column', ico: '🏭', base: 47000, growth: 2.40, max: 3,  cat: 'process', desc: 'Raises the throughput ceiling and the pressure the yard can safely hold.' },
  cracker:    { id: 'cracker',    name: 'Cracking Unit',       ico: '💥', base: 92000, growth: 2.20, max: 2,  cat: 'process', desc: 'UNLOCKS Cat Gasoline. Converts heavy residue into light ends — the only way heavy crude pays.' },
  reformer:   { id: 'reformer',   name: 'Catalytic Reformer',  ico: '♻️', base: 118000,growth: 2.20, max: 2,  cat: 'process', desc: 'UNLOCKS Reformate. Without it, Premium grade is mathematically out of reach.' },
  treater:    { id: 'treater',    name: 'Hydrotreater',        ico: '🧼', base: 78000, growth: 2.00, max: 2,  cat: 'process', desc: 'UNLOCKS the Hydrotreated Cut and lets you buy sour crude nobody else can run.' },
  alky:       { id: 'alky',       name: 'Alkylation Unit',     ico: '💎', base: 164000,growth: 2.30, max: 1,  cat: 'process', desc: 'UNLOCKS Alkylate — octane, stability and purity in one stream. The endgame blendstock.' },
  lab:        { id: 'lab',        name: 'Laboratory',          ico: '🔬', base: 31000, growth: 2.05, max: 4,  cat: 'process', desc: 'Shrinks measurement error. A bad lab does not lie to you — it refuses to be precise.' },
  pumps:      { id: 'pumps',      name: 'Pump & Valve Train',  ico: '🔧', base: 24000, growth: 1.80, max: 5,  cat: 'process', desc: 'Raises the SAFE flow rate. Not the maximum — the point past which the yard starts hurting itself.' },
  automation: { id: 'automation', name: 'Automation Suite',    ico: '🤖', base: 68000, growth: 2.15, max: 3,  cat: 'process', desc: 'Holds a setpoint while you look away. It will not chase the drift, so it never runs a great batch.' },
};
export const EQUIP_LIST = Object.values(EQUIPMENT);

export function equipCost(id, owned) {
  const e = EQUIPMENT[id]; if (!e) return Infinity;
  return Math.round(e.base * Math.pow(e.growth, Math.max(0, owned | 0)));
}

/* ── LABORATORY ───────────────────────────────────────────────────────────
   The lab does NOT change the batch. It changes how much of the batch the
   player can SEE. Tier 0 (no lab) is deliberately playable but miserable:
   you get one property, ±2.4 octane, and you pay per test.
   err   — ± noise applied to every reading
   props — how many properties one test reveals
   fee   — Cinder per test
   live  — does the blend panel update continuously, or only when you test? */
export const LAB_TIERS = [
  { t: 0, name: 'Dip Stick & Guesswork', err: 2.4,  props: 1, fee: 900, live: false },
  { t: 1, name: 'Field Test Kit',        err: 1.35, props: 2, fee: 620, live: false },
  { t: 2, name: 'Bench Laboratory',      err: 0.70, props: 4, fee: 380, live: true  },
  { t: 3, name: 'Analytical Lab',        err: 0.28, props: 4, fee: 190, live: true  },
  { t: 4, name: 'Spectrometry Suite',    err: 0.00, props: 4, fee: 0,   live: true  },
];
export function labTier(labs) { return LAB_TIERS[Math.max(0, Math.min(LAB_TIERS.length - 1, labs | 0))]; }

/* ── OPERATING ENVELOPE ───────────────────────────────────────────────────
   The sweet spot is a function of the crude in the column: heavier feed needs
   a hotter, harder run. The player is not memorising one number, they are
   reading the feed. */
export function envelope(api, equip) {
  const cdu = Math.max(1, equip.cdu | 0);
  const pumps = equip.pumps | 0;
  return {
    // Heavy crude (low API) boils higher.
    tempIdeal: 396 - (api - 20) * 2.6,
    tempBand: 11,                          // ± this is "green"
    tempMin: 280, tempMax: 470,
    presIdeal: 2.1 + (34 - api) * 0.035,
    presBand: 0.34,
    presMin: 0.8, presMax: 6.0,
    // The safe flow is what the PUMPS allow. The max is what the column allows.
    flowSafe: 620 + pumps * 210 + (cdu - 1) * 300,
    flowMax:  1100 + pumps * 260 + (cdu - 1) * 700,
    flowMin: 120,
  };
}

/* ── INCIDENTS ────────────────────────────────────────────────────────────
   sev drives the Cinder cost and the safety-rating hit. Every one of these is
   survivable — none of them delete a save or a tank. The Fire is the only one
   that destroys the run, and it is the rarest. */
export const INCIDENTS = [
  { id: 'seal',   ico: '💧', name: 'Seal Leak',          sev: 1, msg: 'A pump seal lets go. Volume bleeding to the sump.' },
  { id: 'foul',   ico: '🧱', name: 'Column Fouling',     sev: 1, msg: 'Coke laying down on the trays. Separation is going soft.' },
  { id: 'trip',   ico: '⚡', name: 'Power Trip',         sev: 2, msg: 'Substation kicked out. Feed pumps coasting down.' },
  { id: 'surge',  ico: '📛', name: 'Pressure Surge',     sev: 2, msg: 'Relief valve lifted. That one was close.' },
  { id: 'spill',  ico: '🛢️', name: 'Containment Spill',  sev: 3, msg: 'Bund overflow. Cleanup crew and a very unhappy inspector.' },
  { id: 'fire',   ico: '🔥', name: 'Unit Fire',          sev: 4, msg: 'FIRE ON THE COLUMN. Batch is gone. Get the flare up.' },
];

/* ── REPUTATION ───────────────────────────────────────────────────────────
   Five axes, each earned by a different behaviour, so a player cannot grind
   one number. Quality comes off the assay, reliability off deadlines, safety
   off incidents, completion off contracts, and wholesale is the weighted
   headline the stations actually read. */
export const REP_AXES = [
  { id: 'quality',  name: 'Fuel Quality',        ico: '⭐', kind: 'stars' },
  { id: 'delivery', name: 'Delivery Reliability',ico: '🚛', kind: 'pct'   },
  { id: 'safety',   name: 'Safety Rating',       ico: '🦺', kind: 'letter'},
  { id: 'completion', name: 'Contract Completion',ico: '📋', kind: 'pct'  },
  { id: 'wholesale',name: 'Wholesale Reputation',ico: '🏦', kind: 'score' },
];
export function safetyLetter(v) {
  const t = [[95,'A+'],[88,'A'],[80,'B+'],[71,'B'],[62,'C+'],[52,'C'],[40,'D'],[0,'F']];
  for (const [n, l] of t) if (v >= n) return l;
  return 'F';
}

/* ── COST BASIS ───────────────────────────────────────────────────────────
   Every one of these lands on the session P&L. The player should be able to
   read the statement and say "the electricity is what killed me" — which only
   works if power is genuinely a function of how hard they ran. */
export const COSTS = {
  powerPerKwh: 3.0,
  labourPerMin: 60,          // crew wage per SIMULATED minute a run is live
  maintPerWear: 34,          // Cinder per point of condition restored
  haulPerLPerKm: 0.0021,     // ≈4–8% of a contract's value at typical distances
  slopDisposalPerL: 0.06,
  tankCleanPerL: 0.021,      // switching a tank's product
  desalterPerPass: 640,
};

/* ── SECONDARY UNITS: what each one actually DOES to a stream ─────────────
   These are conversions, not multipliers. Owning a Reformer does not make you
   richer — it lets naphtha become reformate, which is the only route to
   Premium. A player without one is not "slower", they are locked out of a
   product, and that is the distinction the whole upgrade tree is built on.

   in/out are component ids; yield is volumetric (some of the feed leaves as
   fuel gas, which is why none of these are 1.0). kwh is per 1000 L of feed. */
export const CONVERSIONS = {
  reform:  { id: 'reform',  unit: 'reformer', name: 'Reforming',   ico: '♻️', in: 'naphtha', out: 'reformate', yield: 0.82, kwh: 240, blurb: 'Naphtha → Reformate. Octane out of thin air, at the cost of 18% of your volume.' },
  crack:   { id: 'crack',   unit: 'cracker',  name: 'Cat Cracking',ico: '💥', in: 'gasoil',  out: 'catgas',    yield: 0.74, kwh: 310, blurb: 'Gas oil & residue → Cat Gasoline. The only thing that makes heavy crude worth buying.' },
  treat:   { id: 'treat',   unit: 'treater',  name: 'Hydrotreating',ico:'🧼', in: 'naphtha', out: 'hydro',     yield: 0.95, kwh: 190, blurb: 'Strips sulfur out. Turns unsellable sour cuts into blendable stock.' },
  alkylate:{ id: 'alkylate',unit: 'alky',     name: 'Alkylation',  ico: '💎', in: 'butane',  out: 'alkylate',  yield: 1.12, kwh: 420, blurb: 'Butane → Alkylate. The cheapest thing on the yard becomes the most valuable.' },
  reproc:  { id: 'reproc',  unit: null,       name: 'Reprocessing',ico: '🥣', in: 'slop',    out: 'slopcut',   yield: 0.86, kwh: 150, blurb: 'A failed batch, run back through. You lose 14% and some purity, not the whole tank.' },
};
export const CONVERSION_LIST = Object.values(CONVERSIONS);

/* Streams that come off the column but are not blend components in their own
   right. gasoil is cracker feed; slop is where failed batches go. */
export const STREAMS = {
  naphtha: { name: 'Naphtha',  ico: '🧪', color: '#c8b98a', blend: true },
  kero:    { name: 'Kerosene', ico: '✈️', color: '#9fe6e6', blend: false, product: 'jet' },
  diesel:  { name: 'Diesel',   ico: '🚛', color: '#7fb0ff', blend: false, product: 'diesel' },
  gasoil:  { name: 'Gas Oil',  ico: '🫗', color: '#a08050', blend: false },
  heavy:   { name: 'Heavy Oil',ico: '⬛', color: '#4a4550', blend: false },
  slop:    { name: 'Slop',     ico: '🥣', color: '#6b6470', blend: false },
};

/* ── RACK PRICES for the streams a gasoline blend does not use.
   ⚠ THESE EXIST BECAUSE ~40% OF EVERY BARREL IS NOT GASOLINE. Distillation
   gives back diesel, kerosene, gas oil and residue whether the player wants
   them or not, and until this table existed there was NO way to turn any of
   them into money without the specific unit and contract for them. A starting
   yard was therefore throwing away nearly half of every barrel it paid for,
   which is why it could not break even.
   Untreated rack fuel sells well below a blended contract — that is the whole
   argument for blending — but it is never worthless. Heavy and gas oil are
   priced as CRACKER FEED: cheap unless you own the unit that eats them. */
export const RACK = {
  diesel: 3.05,   // untreated, high-sulfur — an off-road buyer, not a highway one
  kero:   3.40,
  gasoil: 1.15,
  heavy:  0.62,
  slop:   0.18,
};
export function rackPrice(id, marketIndex) {
  return (RACK[id] || 0) * (marketIndex || 1);
}

/* ── SPOT MARKET ──────────────────────────────────────────────────────────
   Any blend component can be BOUGHT rather than made, at a markup. This is
   what keeps the blend panel honest when the player is one stream short at
   11pm on a deadline: the option always exists, it is just expensive enough
   that using it every time eats the margin. It is also the only way a player
   with no Reformer can touch Premium — badly, at a loss, but they can see it.

   Selling back is at a DISCOUNT, so shuffling stock is never free money. */
export const SPOT_BUY_MARKUP = 1.38;
/* MERCHANT price — what a refiner pays for a stream they cannot make
   themselves. It exists because the alternative was a wall: a starting yard
   has only 68-RON straight-run naphtha, ethanol is capped at 10% of the blend,
   and that combination tops out around 81 octane. Regular Fuel needs 87. A new
   player could therefore complete NOTHING but Utility contracts and would
   bounce straight off the feature.
   Buying blendstock in is what real small refiners do, and at 2.15× it is
   deliberately a bad deal: it gets a contract out of the door on a thin margin
   and makes the case for the unit that would have made it. Owning a Reformer
   turns the same litres from 9.68/L into 3.44/L, and THAT is the upgrade the
   player is being sold — not a percentage.
   ⚠ ALKYLATE IS NOT ON THE MERCHANT MARKET (see canSpotBuy in blend.js). It is
   the one genuinely gated stream, so the Alkylation unit stays a capability
   rather than a discount. */
export const MERCHANT_MARKUP = 2.15;
export const SPOT_SELL_HAIRCUT = 0.72;
export function spotBuyPrice(id, marketIndex, merchant) {
  const c = COMPONENTS[id]; if (!c) return Infinity;
  return c.cost * (merchant ? MERCHANT_MARKUP : SPOT_BUY_MARKUP) * (marketIndex || 1);
}
export function spotSellPrice(id, marketIndex) {
  const c = COMPONENTS[id]; if (!c) return 0;
  return c.cost * SPOT_SELL_HAIRCUT * (marketIndex || 1);
}

/* ── WHOLESALE PRICE INDEX ────────────────────────────────────────────────
   Demand comes from real vehicles: the station directory, the player's own
   Fuel Command NPC traffic, and city population. Supply is what refineries
   (including this one) have poured into the market recently.

   The curve is deliberately gentle — a factor of 2 across the whole range —
   because a price index that swings wildly makes contract pricing feel
   arbitrary rather than economic. Shortage rewards you; a glut punishes you;
   neither ends your session. */
export function priceIndex(demandUnits, supplyUnits) {
  const d = Math.max(1, demandUnits || 1);
  const s = Math.max(1, supplyUnits || 1);
  const ratio = d / s;
  // 0.5 → 0.74 · 1.0 → 1.00 · 2.0 → 1.35 · 4.0 → 1.83
  return Math.max(0.62, Math.min(1.95, Math.pow(ratio, 0.44)));
}

/* Contract value. Reputation is a real price signal — a station pays more to
   a refiner it trusts, which is the whole point of tracking five axes. */
export function contractValue(litres, grade, marketIndex, wholesaleRep) {
  const rep = Math.max(0, Math.min(100, wholesaleRep == null ? 50 : wholesaleRep));
  const repMul = 0.88 + (rep / 100) * 0.28;          // 0.88 … 1.16
  return Math.round(litres * grade.pricePerL * (marketIndex || 1) * repMul);
}
