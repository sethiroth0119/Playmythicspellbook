/* ════════════════════════════════════════════════════════════════════════════
   🏭 THE NINE PLANTS — availability, siting, and the pollution call.
   ----------------------------------------------------------------------------
   "add different levels of electricity that powers up the homes and buildings
    different … Wind Turbines, Coal Power Plants, Natural Gas Plants, Oil Power
    Plants, Solar Power Plants, Geothermal Plants, Nuclear Power Plants,
    Hydro-Electric Plants, and Garbage Incinerators."

   ── THE SPLIT OF OWNERSHIP, RESTATED BECAUSE THIS FILE IS WHERE IT IS EASIEST
      TO BREAK ────────────────────────────────────────────────────────────────
     THE HOST OWNS THE RATE. `def.gen.power * tileMult(...)` is node-city's
     central production multiplier — adjacency, level, staffing, weather, mayor,
     Kalon, sockets and the TILE_MULT_CAP its own comment calls "THE ECONOMY
     DIAL". Nothing here recomputes any of it.

     THIS FILE OWNS AVAILABILITY: what share of that rate the plant makes RIGHT
     NOW, because the wind dropped, the sun set, the channel ran low, the reactor
     scrammed or the city ran out of rubbish. It returns ONE MULTIPLIER PER TILE
     and the host applies it in exactly two places. Same one-multiplier,
     one-direction contract /src/water landed for the Purifier, and it is why
     neither side can drift: only one of them has ever seen the rate.

   ── 🔴 THE CONTRACT TRAP, AND WHY EVERY MAPPING IS WRITTEN OUT ─────────────
   node-city defines `game.power = { gen, demand, ratio, factor }`. The agreed
   cross-workflow contract is `{ capacity, load, factor, byPlant }`. `gen`→
   `capacity` and `demand`→`load` are RENAMES; `factor` is the only key that
   matches by name; `byPlant` has no existing source and `ratio` exists in the
   game and not in the contract. A module that returned `game.power` verbatim
   would satisfy every guarded read — because `factor` is present and truthy —
   while feeding `undefined` capacity and load to its consumers for ever. So
   nothing in /src/power spreads one shape into another. Every field is assigned
   by name, and a consumer that got a number from here got it because a line here
   put it there.

   ── ☁ WHERE THE POLLUTION CALLS ARE ────────────────────────────────────────
   `emitAll()`, near the bottom of this file. One function, one loop, one call to
   `window.MythicPollution.emit(x, z, { air, ground, water })` per running plant
   per tick. It is the ONLY place this module touches that global, and it is
   marked with a banner so the agent building /src/pollution can find it by
   searching for POLLUTION EMIT CALL SITE.
   ════════════════════════════════════════════════════════════════════════════ */

import { POWER } from './tuning.js';
import * as Geo from './geology.js';

/* ── THE PLANT TYPE IDS, AS node-city KNOWS THEM ────────────────────────────
   These are BUILDINGS keys, and they are the join between the host's rows and
   this module's behaviour. A key here with no BUILDINGS row is a plant nobody
   can build; a generator row with no key here is a plant with no weather, no
   siting and no emissions. `selfCheck()` reports both, out loud, at boot. */
export const TYPES = ['wind', 'solar', 'coal', 'gas', 'oil', 'geothermal', 'hydro', 'nuclear', 'incinerator'];
export const isPlantType = (t) => Object.prototype.hasOwnProperty.call(POWER.plants, t);

/* ── STATE THAT SURVIVES A TICK ─────────────────────────────────────────────
   Two things, and both are saved. Everything else about a plant is derived from
   the world every tick and is deliberately not stored.
     stress   per-tile reactor core stress, 0..1
     scrammed per-tile latch: once tripped it stays tripped until stress falls
              under restartAt, which is what makes a scram an EVENT rather than
              a flicker at the threshold. */
let S = { stress: Object.create(null), scrammed: Object.create(null) };
let lastCtx = null;      // the last availability() context, for siteReport()
let lastPlants = [];     // the last per-plant result, for plantsNear()/emissions()

export function reset() { S = { stress: Object.create(null), scrammed: Object.create(null) }; lastPlants = []; }

export function save() {
  const stress = {};
  for (const k in S.stress) if (S.stress[k] > 0.005) stress[k] = +S.stress[k].toFixed(4);
  return { stress, scrammed: Object.keys(S.scrammed).filter(k => S.scrammed[k]) };
}
/* Optional-with-default in the strongest sense: a blob from a save written
   before reactors existed leaves every core cold and every latch open, which is
   the correct reading of a city that has never had one. */
export function load(blob) {
  reset();
  if (!blob || typeof blob !== 'object') return;
  const st = blob.stress;
  if (st && typeof st === 'object') {
    for (const k in st) { const v = +st[k]; if (isFinite(v) && v > 0) S.stress[k] = Math.min(1, v); }
  }
  if (Array.isArray(blob.scrammed)) for (const k of blob.scrammed) S.scrammed[String(k)] = true;
}

/* ════════════════════════════════════════════════════════════════════════════
   🌬 WIND — from the weather node-city ALREADY simulates.
   ⚠ THE PRECEDENCE IS DELIBERATE AND IS THE WHOLE POINT OF THIS FUNCTION.
     If /src/pollution has landed and offers a real `wind()`, ITS speed wins:
     that module owns the wind for dispersion purposes and two wind speeds in one
     city is two truths about the same air. Only when it is absent do we read the
     weather — and reading the weather is not inventing a wind field, it is
     reading a signal the player can already see in the HUD.
   ════════════════════════════════════════════════════════════════════════════ */
export function windSpeed(ctx) {
  try {
    const P = (typeof window !== 'undefined' && window.MythicPollution) || null;
    if (P && typeof P.wind === 'function') {
      const w = P.wind(), v = w && Number(w.speed);
      if (isFinite(v)) return { speed: Math.max(0, Math.min(1, v)), src: 'pollution' };
    }
  } catch (e) {}
  const W = POWER.wind;
  const base = W.byWeather[(ctx && ctx.weather) || 'clear'];
  let v = isFinite(base) ? base : W.byWeather.clear;
  // A slow diurnal swing, so a clear day is a curve and not a flat line.
  const h = Number(ctx && ctx.hour);
  if (isFinite(h)) v += W.diurnal * Math.sin((h - 9) / 24 * Math.PI * 2);
  // …and a per-city offset, so two cities in the same storm are not identical.
  v += (hash01(String((ctx && ctx.cityId) || ''), 'wind') - 0.5) * 2 * W.cityVar;
  return { speed: Math.max(0, Math.min(1, v)), src: 'weather' };
}

/* ☀ SOLAR — node-city's own day arc. `hourOf()` is EST hours, the sun rises at
   06:00 and sets at 18:00 (see updateSky), and this is that same curve read as a
   number instead of as a light direction. Zero at night, and that IS the
   feature: a solar city browns out at the same hour every night until it builds
   storage or a second kind of plant. */
export function sunFactor(ctx) {
  const P = POWER.plants.solar;
  const h = Number(ctx && ctx.hour);
  if (!isFinite(h)) return { sun: 1, wx: 1, out: 1, night: false };   // no clock ⇒ never punish
  const t = (h - P.sunrise) / (P.sunset - P.sunrise);
  const night = t <= 0 || t >= 1;
  const sun = night ? P.nightFloor : Math.sin(Math.PI * t);
  const wxk = (ctx && ctx.weather) || 'clear';
  const wx = isFinite(P.wx[wxk]) ? P.wx[wxk] : 1;
  return { sun, wx, out: Math.max(0, sun * wx), night };
}

/* ── ♻ THE CITY'S GARBAGE, per minute ───────────────────────────────────────
   A flow derived from the city that exists, not a stockpile. See POWER.waste for
   why it is not a CITY_STOCK row.
   ⚠ Counted over the METERED buildings the host handed us, plus population. It
     is therefore an under-count in a city that has not opted into the demand
     ladder — which is the honest direction to be wrong in: an incinerator in an
     un-metered city produces slightly less, never more than the rubbish there
     is to burn. */
export function wasteSupply(ctx) {
  const W = POWER.waste;
  let v = W.perPop * Math.max(0, Number(ctx && ctx.pop) || 0);
  for (const l of ((ctx && ctx.loads) || [])) v += W.perBuilding[classOf(l.type)] || W.perBuilding.none;
  return v;
}

export function classOf(type) { return POWER.demand.classOf[type] || 'none'; }

/* ── 💧 WHAT /src/water SAYS ABOUT THIS TILE ────────────────────────────────
   Read through ONE function so the whole module has exactly one opinion about
   whether the water module is present, and so a future change to that contract
   lands in one place. Returns null when it is absent or refuses — and null is a
   COMPLETE answer, not a degraded one: it means "nobody can tell us there is a
   river here", and a dam may not be built on a river nobody can see.
   ⚠ `flow`, never `yield` or `level`. /src/water documents flow as "SURFACE
     presence at this tile whichever source won … it must never be handed an
     aquifer number under that name", and a hydro-electric dam sited on an
     aquifer's strength would be exactly that mistake. */
function waterAt(x, z) {
  try {
    const W = (typeof window !== 'undefined' && window.MythicWater) || null;
    if (!W || typeof W.sourceAt !== 'function') return null;
    const s = W.sourceAt(x, z);
    if (!s) return null;
    return { flow: Math.max(0, Math.min(1, Number(s.flow) || 0)), kind: s.kind,
             purity: Number(s.purity), name: s.name || '' };
  } catch (e) { return null; }
}

function heatField(ctx) { return Geo.fieldFor((ctx && ctx.cityId) || '', (ctx && ctx.grid) || 24); }

/* ════════════════════════════════════════════════════════════════════════════
   THE AVAILABILITY PASS
   ----------------------------------------------------------------------------
   Called ONCE per economy tick from node-city's power pre-pass, AFTER that loop
   has gathered the plants and BEFORE it sums generation.

   ctx = { cityId, grid, hour, weather, pop, dtMin, waterCov,
           plants: [{ k, x, z, type, out }],   // `out` is the host's UNADJUSTED rate
           loads:  [{ k, x, z, type, draw }],
           occupied(x, z) -> boolean }         // the host's own tileAt, handed over

   ⚠ `occupied` IS USED ONLY INSIDE THIS CALL and is never retained beyond it —
     it closes over the host's live tile map, and a module holding a reference
     into the host's mutable state is the shape of every stale-cache bug this
     repo has already paid for. `lastCtx` deliberately drops it.
   ════════════════════════════════════════════════════════════════════════════ */
export function availability(ctx) {
  if (!ctx) return null;
  const dt = Math.max(0, Math.min(240, Number(ctx.dtMin) || 0));
  const plants = Array.isArray(ctx.plants) ? ctx.plants : [];
  const wind = windSpeed(ctx);
  const sun = sunFactor(ctx);
  const heat = heatField(ctx);
  const wasteAvail = wasteSupply(ctx);

  /* ♻ THE INCINERATOR SPLIT. Every incinerator draws on the SAME flow, so their
     combined appetite is worked out first and the shortfall is shared pro rata.
     Two incinerators in a small city each run at half — which is the counter-play
     and the reason the second one is a decision rather than a repeat. */
  let wasteWant = 0;
  for (const p of plants) if (p.type === 'incinerator') wasteWant += p.out * POWER.plants.incinerator.wastePerUnit;
  const wasteShare = wasteWant > 0 ? Math.min(1, wasteAvail / wasteWant) : 1;

  const factor = Object.create(null);
  const out = [];
  for (const p of plants) {
    const spec = POWER.plants[p.type];
    /* The Power Station — and anything else that generates without a spec —
       keeps availability 1, byte-for-byte what it did before this file existed.
       That is not a fallback, it is the correct answer: a turbine hall burning
       fuel has no weather. */
    if (!spec) { factor[p.k] = 1; out.push({ k: p.k, x: p.x, z: p.z, type: p.type, label: p.name || p.type,
                                             avail: 1, out: p.out, model: 'none', why: '', detail: null }); continue; }
    const r = availOne(spec, p, { ctx, dt, wind, sun, heat, wasteShare, wasteAvail });
    factor[p.k] = r.avail;
    out.push({ k: p.k, x: p.x, z: p.z, type: p.type, label: spec.label, avail: r.avail,
               out: p.out * r.avail, model: spec.model, why: r.why, detail: r.detail || null });
  }

  lastCtx = { cityId: ctx.cityId, grid: ctx.grid, hour: ctx.hour, weather: ctx.weather,
              pop: ctx.pop, waterCov: ctx.waterCov, loads: ctx.loads };
  lastPlants = out;

  /* Mapped by name. See the contract-trap note in this file's header — every
     cross-boundary object in /src/power is written out rather than spread. */
  return {
    factor, plants: out,
    wind: { speed: wind.speed, src: wind.src },
    sun: { sun: sun.sun, wx: sun.wx, out: sun.out, night: sun.night },
    heat: { gradient: heat.gradient, province: heat.prov.key, provinceLabel: heat.prov.label,
            vents: heat.vents.length, best: heat.best, summary: heat.summary() },
    waste: { supply: wasteAvail, want: wasteWant, share: wasteShare },
  };
}

function availOne(spec, p, env) {
  switch (spec.model) {
    /* 🔥 CONSTANT — coal, gas, oil. They burn what they are fed; the BUILDINGS
       row's `use.fuel` is the real running cost and node-city's own input gate
       already stops them dead when the fuel runs out. */
    case 'constant':
      return { avail: spec.base, why: '' };

    /* 🌬 WIND. Speed first, then the wake penalty: every occupied tile inside
       wakeRadius steals a little, so a dense block of turbines shelters itself
       and a line along open ground does not. */
    case 'wind': {
      const raw = spec.base + spec.gust * env.wind.speed;
      const blocked = countBuiltAround(env.ctx.occupied, p.x, p.z, spec.wakeRadius);
      const wake = Math.max(spec.wakeFloor, 1 - blocked * spec.wakePerTile);
      return { avail: Math.max(0, raw * wake),
               detail: { speed: env.wind.speed, blocked, wake, src: env.wind.src },
               why: blocked ? blocked + ' sheltering tiles nearby' : '' };
    }

    /* ☀ SOLAR. */
    case 'solar':
      return { avail: env.sun.out, detail: { sun: env.sun.sun, wx: env.sun.wx, night: env.sun.night },
               why: env.sun.night ? 'night' : (env.sun.wx < 1 ? 'cloud' : '') };

    /* ♨ GEOTHERMAL. Scales from atMin at the licensing threshold to 1 at full
       heat, so a marginal vent is a marginal plant.
       ⚠ Below the threshold this still answers rather than throwing. The site
         gate is what stops a plant being built on cool rock, but a save that
         predates the gate — or a plant left standing after a retune moved the
         threshold — must behave sanely instead of dividing by a negative range. */
    case 'geothermal': {
      const h = env.heat.heatAt(p.x, p.z);
      if (h <= spec.minHeat) return { avail: spec.atMin * (h / Math.max(1e-6, spec.minHeat)),
                                      detail: { heat: h }, why: 'cool ground' };
      const t = (h - spec.minHeat) / Math.max(1e-6, 1 - spec.minHeat);
      return { avail: spec.atMin + (1 - spec.atMin) * t, detail: { heat: h }, why: '' };
    }

    /* 💧 HYDRO. Output scales with the flow actually available at the tile — and
       /src/water's flow moves with drawdown and with contamination, so a dam on a
       marginal channel really does fade when the city over-pumps upstream. */
    case 'hydro': {
      const w = waterAt(p.x, p.z);
      if (!w) return { avail: spec.atMin, detail: { flow: null }, why: 'no hydrology model' };
      if (w.flow <= spec.minFlow) return { avail: spec.atMin * (w.flow / Math.max(1e-6, spec.minFlow)),
                                           detail: { flow: w.flow, name: w.name }, why: 'low flow' };
      const t = (w.flow - spec.minFlow) / Math.max(1e-6, 1 - spec.minFlow);
      return { avail: spec.atMin + (1 - spec.atMin) * t, detail: { flow: w.flow, name: w.name }, why: '' };
    }

    /* ☢ NUCLEAR — the managed downside.
       Stress integrates the cooling deficit over time, so a brief dip costs
       almost nothing and a sustained one costs everything. The SCRAM is LATCHED
       so the reactor does not chatter across the threshold, and the restart
       point is lower than the trip so recovery is a real interval the player
       waits out rather than an instant flick back on. */
    case 'nuclear': {
      const cov = Number(env.ctx.waterCov);
      /* ⚠ NO COVERAGE FIGURE ⇒ FULLY COOLED. A host that has not computed
         coverage yet — the first tick of a session, or a build where the vitals
         never ran — must not be read as a city with no water; that would scram
         every reactor in the game on load. ABSENT IS NOT ZERO. */
      const cool = isFinite(cov) ? Math.max(0, Math.min(1, cov / spec.coolCoverage)) : 1;
      const cur = S.stress[p.k] || 0;
      const next = Math.max(0, Math.min(1,
        cur + (cool >= 1 ? -spec.stressFall : spec.stressRise * (1 - cool)) * env.dt));
      S.stress[p.k] = next;
      if (S.scrammed[p.k]) {
        if (next > spec.restartAt) return { avail: 0, detail: { stress: next, scram: true, cool },
                                            why: 'SCRAM — core at ' + Math.round(next * 100) + '%' };
        S.scrammed[p.k] = false;
      } else if (next >= spec.scramAt) {
        S.scrammed[p.k] = true;
        return { avail: 0, detail: { stress: next, scram: true, cool }, why: 'SCRAM — cooling lost' };
      }
      // The derate below the trip, so the meter warns instead of cliff-edging.
      const d = next <= spec.derateFrom ? 1
        : spec.derateTo + (1 - spec.derateTo) *
          (1 - (next - spec.derateFrom) / Math.max(1e-6, spec.scramAt - spec.derateFrom));
      return { avail: Math.max(0, d), detail: { stress: next, scram: false, cool },
               why: next > spec.derateFrom ? 'derated — core at ' + Math.round(next * 100) + '%' : '' };
    }

    /* ♻ INCINERATOR. */
    case 'waste':
      return { avail: Math.max(spec.floor, env.wasteShare),
               detail: { share: env.wasteShare, supply: env.wasteAvail },
               why: env.wasteShare < 0.999 ? 'not enough garbage' : '' };

    default:
      return { avail: 1, why: '' };
  }
}

/* How many tiles inside a Chebyshev radius are built on. Chebyshev because that
   is the neighbourhood shape node-city already uses everywhere else —
   lightRadius, concourse and cluster adjacency all measure this way, and a
   turbine that used a different one would feel like a different game. */
function countBuiltAround(occupied, x, z, R) {
  if (typeof occupied !== 'function') return 0;
  let n = 0;
  for (let dx = -R; dx <= R; dx++) for (let dz = -R; dz <= R; dz++) {
    if (!dx && !dz) continue;
    try { if (occupied(x + dx, z + dz)) n++; } catch (e) {}
  }
  return n;
}

/* ════════════════════════════════════════════════════════════════════════════
   🚧 SITING — the one gate, and the reason it says no.
   ----------------------------------------------------------------------------
   Returns null when the tile is fine, or a STRING the host toasts. A refusal
   with no reason reads as a bug — the same argument node-city's own concourse
   check makes when it names what is standing in the way.

   🔴 A 404 ON THIS MODULE MUST NOT MAKE ANYTHING UNBUILDABLE. The host's guard
      only calls this when window.MythicPower is present; with the module absent
      every plant may be built anywhere and runs at its rated output, which is
      exactly what node-city did before /src/power existed. That is the correct
      degrade: losing a restriction is a far smaller harm than a building the
      player paid for and cannot place because a script failed to load.
   ════════════════════════════════════════════════════════════════════════════ */
export function siteRefusal(type, x, z, ctx) {
  const spec = POWER.plants[type];
  if (!spec) return null;
  const c = ctx || lastCtx || {};
  if (spec.model === 'geothermal') {
    const f = heatField(c), h = f.heatAt(x, z);
    if (h >= spec.minHeat) return null;
    const b = f.best;
    return '♨ The rock here is too cool to drill — ' + Math.round(h * 100) + '% heat against the ' +
      Math.round(spec.minHeat * 100) + '% a well needs. This is a ' + f.prov.label + ' city; ' +
      (b.h >= spec.minHeat
        ? 'the hottest ground on the map is tile ' + b.x + ',' + b.z + ' at ' + Math.round(b.h * 100) + '%.'
        : 'nowhere on this map reaches it — the best ground is ' + Math.round(b.h * 100) + '%. Geothermal is not for every city.');
  }
  if (spec.model === 'hydro') {
    const w = waterAt(x, z);
    if (!w) return '💧 A dam needs surface water, and no hydrology model is loaded to find any.';
    if (w.flow >= spec.minFlow) return null;
    return '💧 Not enough flow here — ' + Math.round(w.flow * 100) + '% against the ' +
      Math.round(spec.minFlow * 100) + '% a dam needs. Open the ⚡ panel and turn on Surface Water Flow to see the channel.';
  }
  /* ☢ NUCLEAR wants cooling water and says so, but does NOT refuse. An air-cooled
     reactor is a real thing and a bad one; refusing here would make the Nuclear
     Plant unbuildable in a dry city rather than merely a bad idea in one. The
     consequence is charged through core stress every tick instead, which is the
     difference between a rule and a lesson. */
  return null;
}

/* The full, positive answer for a preview or an inspector row: how good is this
   tile for this plant, and why. `siteRefusal` is the subset of it that says no.
   `quality` is the SAME number availability() would produce, so a preview can
   never promise output the tick does not deliver. */
export function siteReport(type, x, z, ctx) {
  const spec = POWER.plants[type];
  if (!spec) return { ok: true, quality: 1, label: '', rows: [], refusal: null };
  const c = ctx || lastCtx || {};
  const rows = [];
  let q = 1, ok = true;
  switch (spec.model) {
    case 'geothermal': {
      const f = heatField(c), h = f.heatAt(x, z);
      ok = h >= spec.minHeat;
      q = ok ? spec.atMin + (1 - spec.atMin) * ((h - spec.minHeat) / Math.max(1e-6, 1 - spec.minHeat)) : 0;
      const near = f.vents.slice().sort((a, b) =>
        Math.hypot(a.cx - x, a.cz - z) - Math.hypot(b.cx - x, b.cz - z))[0];
      rows.push(['♨ Ground heat', Math.round(h * 100) + '%', ok ? 'up' : 'dn']);
      rows.push(['Province', f.prov.label, '']);
      if (near) rows.push(['Nearest vent', near.name + ' · ' + Math.hypot(near.cx - x, near.cz - z).toFixed(1) + ' tiles', '']);
      break;
    }
    case 'hydro': {
      const w = waterAt(x, z);
      ok = !!w && w.flow >= spec.minFlow;
      q = ok ? spec.atMin + (1 - spec.atMin) * ((w.flow - spec.minFlow) / Math.max(1e-6, 1 - spec.minFlow)) : 0;
      rows.push(['💧 Surface flow', w ? Math.round(w.flow * 100) + '%' : 'unknown', ok ? 'up' : 'dn']);
      if (w && w.name) rows.push(['Channel', w.name, '']);
      break;
    }
    case 'wind': {
      const blocked = countBuiltAround(c.occupied, x, z, spec.wakeRadius);
      const wake = Math.max(spec.wakeFloor, 1 - blocked * spec.wakePerTile);
      const w = windSpeed(c);
      q = (spec.base + spec.gust * w.speed) * wake;
      rows.push(['🌬 Wind now', Math.round(w.speed * 100) + '%', w.speed > 0.45 ? 'up' : '']);
      rows.push(['Shelter', blocked + ' tiles built up · ' + Math.round(wake * 100) + '%', blocked > 4 ? 'dn' : '']);
      break;
    }
    case 'solar': {
      const s = sunFactor(c);
      q = s.out;
      rows.push(['☀ Sun now', Math.round(s.sun * 100) + '%', s.night ? 'dn' : 'up']);
      rows.push(['Sky', Math.round(s.wx * 100) + '%', s.wx < 1 ? 'dn' : '']);
      break;
    }
    case 'nuclear': {
      const cov = Number(c.waterCov);
      rows.push(['💧 Water coverage', isFinite(cov) ? Math.round(cov * 100) + '%' : 'unknown',
                 isFinite(cov) && cov < spec.coolCoverage ? 'dn' : 'up']);
      rows.push(['Cooling floor', Math.round(spec.coolCoverage * 100) + '% — below it the core heats', '']);
      break;
    }
    case 'waste': {
      const supply = wasteSupply(c);
      rows.push(['♻ City garbage', supply.toFixed(2) + '/min', supply > 1 ? 'up' : 'dn']);
      break;
    }
    default: break;
  }
  return { ok, quality: Math.max(0, Math.min(1.4, q)), label: spec.label, rows,
           refusal: siteRefusal(type, x, z, c) };
}

/* ════════════════════════════════════════════════════════════════════════════
   ☁☁☁   POLLUTION EMIT CALL SITE   ☁☁☁
   ----------------------------------------------------------------------------
   THIS IS THE ONLY PLACE /src/power TOUCHES window.MythicPollution. If you are
   building that module, this is the loop that feeds it.

   PER RUNNING PLANT, PER TICK:
       MythicPollution.emit(x, z, { air, ground, water })

   WHAT THE THREE NUMBERS ARE:
       amount = POWER.plants[type].emit[channel]   // how dirty this plant is
              × plant.out                          // what it ACTUALLY made this
                                                   //   tick — already carrying
                                                   //   staffing, level, weather,
                                                   //   sockets AND availability
              × dtMin                              // tick length, in minutes
              × POWER.emit.scale                   // the one conversion knob

   WHY IT IS SHAPED THAT WAY: emission is proportional to FUEL BURNT and fuel
   burnt is proportional to power made. A coal plant that is unstaffed, half
   throttled or damaged is not putting a full plant's worth of smoke into the
   air, and `out` is the only quantity in this module that already carries every
   one of those effects. Anything derived from the plant's RATING instead would
   have a scrammed reactor and a dead solar farm poisoning the city at midnight.

   THE NUMBERS, AND WHY (POWER.plants[*].emit):
       coal        air 1.00  ground 0.42  water 0.10   the reference dirtiest
       incinerator air 0.68  ground 0.30  water 0.06   coal-like air, less ash
       oil         air 0.58  ground 0.30  water 0.14   between coal and gas
       gas         air 0.26  ground 0.05  water 0.02   the clean fossil option
       geothermal  air 0.05  ground 0.04  water 0.07   H₂S and brine — small, not 0
       nuclear     air 0.01  ground 0.02  water 0.20   thermal discharge, not smoke
       hydro       0    / 0    / 0.03                  silt
       wind, solar 0    / 0    / 0                     nothing at all
   Coal is pinned at exactly 1.00 on purpose: it is the unit the other eight are
   read against, so retuning POWER.emit.scale moves the whole fleet together and
   the RATIOS — which are the design — survive it.

   🔴 GUARDED, AND THAT IS NOT OPTIONAL. /src/pollution lands AFTER this module.
      With it absent this function does nothing at all, and the panel says so BY
      NAME rather than pretending — exactly as the terrain legend rows do.
   🚫 AND IT DOES NOT FALL BACK TO MythicWater.taint(). That call exists today
      and would work today, which is precisely the trap: /src/water documents its
      PULL from MythicPollution.groundAt as the primary path, so pushing here as
      well would DOUBLE-COUNT the moment the real module lands. A double-counted
      poison is the hardest kind of balance bug to find, because both halves are
      individually correct. The emissions are reported instead — see
      MythicPower.emissions() — so /src/pollution can seed itself from the fleet
      on its first tick and nothing is lost by waiting.
   ════════════════════════════════════════════════════════════════════════════ */
export function emitAll(plants, dtMin) {
  const P = (typeof window !== 'undefined' && window.MythicPollution) || null;
  const live = !!(P && typeof P.emit === 'function');
  const totals = { air: 0, ground: 0, water: 0, calls: 0, live };
  const dt = Math.max(0, Math.min(240, Number(dtMin) || 0));
  if (!dt) return totals;
  for (const p of (plants || [])) {
    const spec = POWER.plants[p.type];
    if (!spec || !spec.emit) continue;
    const made = Math.max(0, Number(p.out) || 0);
    if (made <= 0) continue;                       // a plant that is off emits nothing
    const q = made * dt * POWER.emit.scale;
    const air = spec.emit.air * q, ground = spec.emit.ground * q, water = spec.emit.water * q;
    if (air <= 0 && ground <= 0 && water <= 0) continue;
    totals.air += air; totals.ground += ground; totals.water += water;
    if (!live) continue;
    // ☁ THE CALL.
    try { P.emit(p.x, p.z, { air: air, ground: ground, water: water }); totals.calls++; } catch (e) {}
  }
  return totals;
}

/* The per-tile emission RATE of the plant standing here, so the overlay can
   paint a SOURCE map and /src/pollution can seed itself from the fleet without
   re-deriving the table. Rates, not accumulations: this module has no opinion
   about how long anything lingers or where the wind takes it. */
export function emissionsAt(x, z) {
  for (const p of lastPlants) {
    if (p.x !== x || p.z !== z) continue;
    const spec = POWER.plants[p.type]; if (!spec) return null;
    const made = Math.max(0, Number(p.out) || 0) * POWER.emit.scale;
    return { type: p.type, air: spec.emit.air * made, ground: spec.emit.ground * made,
             water: spec.emit.water * made };
  }
  return null;
}

/* ── plantsNear — the agreed cross-workflow call ────────────────────────────
   Chebyshev radius, for the same reason countBuiltAround uses it. Every field is
   written out by name; see the contract-trap note in the header. */
export function plantsNear(x, z, r) {
  const R = Math.max(0, Number(r) || 0);
  const out = [];
  for (const p of lastPlants) {
    const d = Math.max(Math.abs(p.x - x), Math.abs(p.z - z));
    if (d > R) continue;
    const spec = POWER.plants[p.type] || { emit: { air: 0, ground: 0, water: 0 }, label: '' };
    out.push({ k: p.k, x: p.x, z: p.z, type: p.type, label: spec.label || p.label || p.type,
               out: Number(p.out) || 0, avail: Number(p.avail) || 0, dist: d,
               emit: { air: spec.emit.air, ground: spec.emit.ground, water: spec.emit.water } });
  }
  out.sort((a, b) => a.dist - b.dist);
  return out;
}

/* Bind the tick's REAL outputs back onto the fleet list, so emissionsAt() and
   plantsNear() answer with what was actually produced rather than with the
   pre-availability rate. Called by grid.js once the host's numbers are in. */
export function bindOutputs(byPlant) {
  const m = new Map();
  for (const p of (byPlant || [])) m.set(p.k, p.out);
  for (const p of lastPlants) if (m.has(p.k)) p.out = m.get(p.k);
  return lastPlants;
}
export function fleet() { return lastPlants; }

/* ── 🔍 THE JOIN SELF-CHECK ─────────────────────────────────────────────────
   The one failure this module cannot see from the inside: a generator row in
   node-city with no spec here (no weather, no siting, no emissions — a silently
   perfect plant), or a spec here with no row there (a plant nobody can build).
   Both look completely fine in a diff. The host hands over the generator ids it
   actually has and this reports the symmetric difference, once, at boot.
   ⚠ `powerstation` is exempt by name: it is the LEGACY generator, it predates
     this table, and giving it a spec would change what every existing city's
     first plant does. */
export function selfCheck(hostGeneratorTypes) {
  const host = new Set(hostGeneratorTypes || []);
  const missingSpec = [...host].filter(t => t !== 'powerstation' && !POWER.plants[t]);
  const missingRow = TYPES.filter(t => !host.has(t));
  return { ok: !missingSpec.length && !missingRow.length, missingSpec, missingRow };
}

/* Local copy of the stable hash, so this file has no import cycle with
   geology.js for one line of arithmetic. Same FNV-1a, same guarantees. */
function hash01(id, salt) {
  const s = String(id == null ? '' : id) + ':' + salt;
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return (h >>> 8) / 0x01000000;
}
