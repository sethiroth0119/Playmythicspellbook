/* ════════════════════════════════════════════════════════════════════════════
   🤒 WHAT THE FIELDS DO TO THE NPCs AND THE CITY.
   ----------------------------------------------------------------------------
   "A field nobody feels is a heatmap, not a feature."

   Four consequences, and every one of them runs through machinery node-city
   ALREADY has. That is not laziness: a NEW failure mode has to be taught to the
   player from scratch, while an existing one that has become reachable a new
   way is understood the moment they see it. /src/water makes the same argument
   for its own shortfall ("no new failure mode was invented; an existing one
   became reachable by pumping an aquifer dry").

     ① HEALTH. Exposure raises the city's health DEMAND. It does NOT lower the
        Clinic's supply, and the direction matters: the Clinic is not working
        worse, there is simply more illness to treat. One guarded multiplier on
        `dem.health` in computeCoverage() and the whole existing chain follows —
        cov.health ↓ → the Health vital ↓ → the medical demand the city already
        models is visibly unmet.
     ② MORALE. A straight subtraction from the Hope vital's target. Nobody is
        happy living in smoke, and Hope is where node-city keeps happiness.
     ③ LAND VALUE. A multiplier on what a Lease Plot earns. Poisoned land is
        cheap land, and the lot rent is the one place node-city already prices a
        tile per minute.
     ④ THEY LEAVE — and this needs no new code at all, which is the point.
        `cov.health` is one of the three legs of node-city's population gate
        (`min(cov.food, cov.water, cov.health)` in vitalsTick), so ① already
        makes people move out of a poisoned city through the exact mechanism the
        player has already learned to read. /src/demographics is READ for the
        panel's causal list and never written to — it owns arrivals and
        departures and a second hand on that wheel would be two truths about who
        lives here.

   🔴 EVERY EFFECT IS CAPPED AND THE CAPS ARE THE SAFETY RAIL FOR OLD SAVES.
      See tuning.js `effects`. A city cannot be killed outright by a field it
      can watch arrive and act on.

   ── WHERE THE CITY IS MEASURED ──────────────────────────────────────────────
   Exposure is weighted by WHERE THE PEOPLE ARE, never averaged over 576 tiles.
   A coal plant in an empty corner is a local mess; the same plant beside the
   housing is a public health crisis; and a field averaged over the whole map
   cannot tell those two apart, which would delete the entire siting decision
   this feature exists to create.
   ════════════════════════════════════════════════════════════════════════════ */

import { POLLUTE } from './tuning.js';
import * as F from './field.js';

const E = POLLUTE.effects;

/* ── THE RESPONSE CURVE ─────────────────────────────────────────────────────
   Dead band, then a curve. The dead band is not cosmetic: without it a single
   Farm's fertiliser run-off puts a permanent fraction of a point on every city
   in the game, and a permanent tiny penalty that no action can clear is
   indistinguishable from a bug. Above it the response is super-linear, so a
   little pollution is genuinely tolerable and a lot is not — which is what makes
   "keep it away from the houses" a strategy rather than an evenly-spread tax. */
export function response(exposure) {
  const e = Math.max(0, Math.min(1, Number(exposure) || 0));
  if (e <= E.deadband) return 0;
  const span = Math.max(1e-6, E.satAt - E.deadband);
  return Math.min(1, Math.pow((e - E.deadband) / span, E.curve));
}

/* ── EXPOSURE AT ONE TILE ───────────────────────────────────────────────────
   Air is what you breathe all day, water is what you drink, ground is what your
   children play in. The weights sum to 1 so this is comparable with everything
   else in the module.

   ⚠ THE WATER TERM PREFERS /src/water's OWN DELIVERED WATER, and that is the
     end-to-end loop this batch exists to build: a coal plant's GROUND pollution
     is pulled by /src/water/hydro.js over the basin footprint, becomes basin
     taint, becomes the purity of what the waterworks delivers — and THAT is what
     the citizens actually drink, wherever in the city they live. The local
     surface field is the fallback for a city with no /src/water, where it is the
     only honest answer available. Reading the local field when the real figure
     is available would call a household safe because there is no river outside
     its door, while the tap it drinks from runs off a poisoned aquifer.
     `harm` is a DEGRADATION, not `1 − purity` — see index.js `waterHarm()` for
     the measured reason that distinction exists. */
export function exposureAt(x, z, harm) {
  const a = F.airAt(x, z), g = F.groundAt(x, z);
  const w = (harm == null) ? F.waterAt(x, z) : Math.max(0, Math.min(1, harm));
  return Math.max(0, Math.min(1, E.weight.air * a + E.weight.water * w + E.weight.ground * g));
}

/* ── THE CITY READING ───────────────────────────────────────────────────────
   `places` is the host's tile list: `{ x, z, home }`. A home counts full, any
   other built tile counts `workWeight` (you breathe at work too), bare ground
   counts nothing. `minWeight` floors the denominator so a city with one
   building does not read 100% exposed because that building is the smelter. */
export function survey(places, harm) {
  let wsum = 0, esum = 0, rsum = 0, asum = 0, worstE = 0, worst = null, homes = 0, exposedHomes = 0;
  const rows = [];
  for (const p of (places || [])) {
    const w = p.home ? E.homeWeight : E.workWeight;
    const e = exposureAt(p.x, p.z, harm);
    wsum += w; esum += e * w; rsum += response(e) * w;
    /* …and the AIR the citizens are breathing, separately, because the panel's
       air meter has to be a reading of the city and not of the map. The mean of
       the raw field over all 576 cells is a number about acreage: photographed
       on a city with a Coal Plant three tiles upwind of its housing and sixteen
       blocks badly polluted, it read 98% CLEAN, because most of a 24×24 grid is
       empty ground and empty ground breathes nothing. */
    asum += F.airAt(p.x, p.z) * w;
    if (p.home) { homes++; if (response(e) > 0) exposedHomes++; }
    if (e > worstE) { worstE = e; worst = p; }
    rows.push({ x: p.x, z: p.z, home: !!p.home, name: p.name, ico: p.ico, e });
  }
  const denom = Math.max(E.minWeight, wsum);
  const exposure = wsum > 0 ? esum / denom : 0;
  /* 🔴 THE MEAN OF THE RESPONSES, NOT THE RESPONSE OF THE MEAN, AND THE TWO ARE
     NOT THE SAME NUMBER. A plume is a streak: it covers a few blocks hard and
     leaves the rest alone. Averaging the EXPOSURE first and then curving it
     hands the whole city one small number, and the dead band then erases it —
     measured on the harness's standard city, five homes sitting in a Coal
     Plant's plume produced a city exposure of 0.054, which is under the dead
     band, so a plant three tiles upwind of the housing cost exactly nothing.
     Curving each place FIRST and averaging afterwards says what is actually
     true: those five households are ill and the other forty-nine are not, and
     the city's bill is the sum of theirs. (Jensen, in the direction that
     matters: the curve is convex, so this is never smaller.) */
  const r = wsum > 0 ? rsum / denom : 0;
  rows.sort((a, b) => b.e - a.e);
  return {
    exposure, response: r,
    /* ① Extra health demand, as a fraction. The host multiplies `dem.health` by
       `1 + healthLoad`. */
    healthLoad: r * E.maxHealthLoad,
    /* ② Points off the Hope target, on its own 0–100 scale. */
    moraleHit: r * E.maxMoraleHit,
    /* ③ The city's mean land value, 1 down to minLandValue. Per tile it is
       `landValueAt`; this is the figure the panel meters. */
    landValue: 1 - r * (1 - E.minLandValue),
    air: wsum > 0 ? asum / denom : 0,
    homes, exposedHomes, worst, worstExposure: worstE,
    tiles: rows.slice(0, 24),
    places: (places || []).length,
  };
}

/* ── ③ PER TILE ─────────────────────────────────────────────────────────────
   What a plot here is worth, as a multiple of what it would be worth clean.
   node-city's leased plots read this and nothing else does yet; it is exported
   as an API call so /src/demographics can price a district by it later without
   this module needing to know that it did. */
export function landValueAt(x, z, harm) {
  return 1 - response(exposureAt(x, z, harm)) * (1 - E.minLandValue);
}

/* ════════════════════════════════════════════════════════════════════════════
   🔎 THE ATTRIBUTION — "why is this block unhappy?"
   ----------------------------------------------------------------------------
   BAR.md rubric 12: state is "a METER WITH A SIGNED CAUSAL LIST, not a raw
   number". The brief goes further and names the sentence this has to be able to
   produce: "the air here is 62% polluted, from the coal plant two tiles
   upwind."

   ⚠ IT IS AN ATTRIBUTION, NOT A RE-SIMULATION, AND IT SAYS SO. The honest way
     to answer "which source put this here" is to run the diffusion again per
     source, which is 576 cells times every chimney in the city, every time a
     player clicks a building. What this does instead is score each known source
     by how far away it is and how far downwind, and present the ranking. The
     TOTAL always comes from the field — the number in the meter is the one the
     tick computed — and only the BLAME is apportioned. A decomposition that
     silently disagreed with its own total is the failure node-city's own
     `insFactors` header warns about, and this avoids it by never claiming the
     parts add up.
   ════════════════════════════════════════════════════════════════════════════ */
export function attribute(x, z, sources, wind, limit) {
  const out = [];
  const wx = wind && Number.isFinite(wind.dx) ? wind.dx : 0;
  const wz = wind && Number.isFinite(wind.dz) ? wind.dz : 0;
  for (const s of (sources || [])) {
    const dx = x - s.x, dz = z - s.z;
    const dist = Math.sqrt(dx * dx + dz * dz);
    const strength = (s.air || 0) + (s.ground || 0) + (s.water || 0);
    if (strength <= 0) continue;
    /* Downwind alignment: +1 directly downwind of the source, −1 directly
       upwind, 0 abreast. A source ON the tile (dist 0) is neither and scores
       full — you are standing in it. */
    const align = dist > 0.001 ? (dx * wx + dz * wz) / dist : 1;
    /* The plume is a streak: being downwind reaches much further than being
       beside. `1.15 + align` keeps a modest contribution abreast and upwind
       (air does diffuse, and ground does not care about wind at all) while
       making downwind dominate, which is the read the arrows promise. */
    const reach = (1.15 + align) / (1 + dist * 0.75);
    const score = strength * Math.max(0, reach);
    if (score <= 1e-4) continue;
    out.push({ x: s.x, z: s.z, type: s.type, name: s.name, ico: s.ico, why: s.why,
               dist, align, score,
               where: dist < 0.6 ? 'on this tile'
                    : (align > 0.5 ? Math.round(dist) + ' tile' + (Math.round(dist) === 1 ? '' : 's') + ' upwind'
                    :  align < -0.5 ? Math.round(dist) + ' tile' + (Math.round(dist) === 1 ? '' : 's') + ' downwind'
                    :  Math.round(dist) + ' tile' + (Math.round(dist) === 1 ? '' : 's') + ' away') });
  }
  out.sort((a, b) => b.score - a.score);
  const top = out.slice(0, limit || POLLUTE.causes.maxRows);
  const tot = top.reduce((n, r) => n + r.score, 0);
  for (const r of top) r.share = tot > 0 ? r.score / tot : 0;
  return top;
}

/* Which field is doing the damage here, so the reader knows which overlay to
   turn on rather than having to try all three. Compared AFTER weighting,
   because 0.9 of ground under weight 0.15 is less of the problem than 0.4 of
   air under weight 0.52. */
function dominantOf(air, ground, water) {
  const a = E.weight.air * air, g = E.weight.ground * ground, w = E.weight.water * water;
  return (a >= g && a >= w) ? 'air' : (g >= w ? 'ground' : 'water');
}

/* The whole answer for one tile, in the shape a panel row or an inspector line
   can print directly. `sources` and `wind` come from the last tick. */
export function explainAt(x, z, ctx) {
  const c = ctx || {};
  const air = F.airAt(x, z), ground = F.groundAt(x, z), water = F.waterAt(x, z);
  const e = exposureAt(x, z, c.harm);
  return {
    x, z, air, ground, water,
    exposure: e, response: response(e),
    landValue: 1 - response(e) * (1 - E.minLandValue),
    healthLoad: response(e) * E.maxHealthLoad,
    moraleHit: response(e) * E.maxMoraleHit,
    blame: attribute(x, z, c.sources, c.wind, 4),
    // Which field is doing the damage here, so the reader knows which overlay to
    // turn on rather than having to try all three.
    dominant: dominantOf(air, ground, c.harm == null ? water : c.harm),
  };
}
