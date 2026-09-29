/* ════════════════════════════════════════════════════════════════════════════
   ☁ CITY POLLUTION — module entry point. Registers window.MythicPollution.
   ----------------------------------------------------------------------------
   "Add a pollution feature that affects the npcs and city", against CS2's
   "Coal Plant Pollution" tutorial: a coal plant emits air pollution the WIND
   carries downwind, and ground pollution that seeps into the GROUNDWATER
   DEPOSIT beneath it; a polluted aquifer poisons the water drawn from it; bad
   water and dirty air make citizens sick, drop land value and make people
   leave. Placing the plant away from the water is the counter-play, and the
   overlays are how a player sees it coming.

   THE LOOP, END TO END, AND WHICH FILE OWNS EACH LINK:

     a Coal Plant runs               node-city (it owns every production rate)
     → emit(x, z, {air, ground, …})  /src/power/plants.js `emitAll()`
     → the three fields              field.js — advection, diffusion, decay
     → groundAt(x, z)                THIS module's contract call
     → basin taint, then purity      /src/water/hydro.js `pollutionSample()`
     → citizen exposure              effects.js, weighted by where people live
     → health demand ↑               node-city computeCoverage(), one hook
     → cov.health ↓ → Health vital ↓ → the population gate → PEOPLE LEAVE
                                     node-city vitalsTick(), unchanged

   Only two of those eight links are new code in node-city, and neither of them
   invents a failure mode: an existing one became reachable a new way.

   🔴 THE GLOBALS TRAP (CLAUDE.md, and it has cost this project real time twice).
      `game`, `BUILDINGS`, `THREE`, `scene`, `GRID`, `wx` and `hourOf` are
      top-level `const` in node-city's module script — global LEXICAL bindings,
      NOT properties of `window`. This module therefore reads NOTHING of the
      host by itself: THREE and the scene arrive once in mount(), and every fact
      about the city arrives per tick in the tick() snapshot, the same seam
      `ecoHost()` already is for /src/economy.

   🔴 AND IT MUST DEGRADE TO NOTHING. A 404 on /src/pollution/* costs the player
      this info view, the overlays and the three consequences, and nothing else:
      every host hook is a guarded read that falls back to the number node-city
      computed before this module existed.

   ════════════════════════════════════════════════════════════════════════════
   🔴 THE CONTRACT, AND THE TRAP IT CARRIES.
   ----------------------------------------------------------------------------
   The agreed cross-workflow shape is:

       MythicPollution.airAt/groundAt/waterAt(x, z) -> 0..1
       MythicPollution.emit(x, z, {air, ground, water})
       MythicPollution.wind()  -> { dir, speed }

   ⚠ `wind()` RETURNS `dir`. This module's own wind.js calls that quantity `deg`,
     because inside the module it is unambiguously a bearing in degrees and
     `dir` could be a vector, a compass point or a string. The mapping between
     the two names happens ONCE, below, written out field by field.

     That is not fussiness. The whole batch was warned about exactly this shape:
     node-city's `game.power` is `{gen, demand, ratio, factor}` while the
     contract is `{capacity, load, factor, byPlant}`, and a module that returned
     the internal object verbatim would satisfy every guarded read — one key
     matches by name and is truthy — while feeding `undefined` to every consumer
     for ever, looking like a working feature the whole time. Both neighbouring
     modules state the same rule in their own headers. So there is NO SPREAD in
     any contract call in this file. Every field is a line, and a consumer that
     got a number from here got it because a line put it there.

     Verified against the real consumer rather than against the sketch:
     /src/power/plants.js `windSpeed()` reads `w.speed` and takes it in
     preference to its own weather reading; /src/power/index.js `terrain()` reads
     `w.dir` and `w.speed` and builds a repaint signature from them. Both are
     satisfied, and `speed` is clamped 0..1 because that is what the consumer
     assumes.

   ── THE OTHER SIDE OF THE CONTRACT, WHICH WAS ALREADY LIVE ─────────────────
   /src/power has been calling `MythicPollution.emit()` since before this module
   existed, guarded, from ONE loop marked `POLLUTION EMIT CALL SITE`. Its
   signature was read off the real code, not off the sketch:

       P.emit(p.x, p.z, { air: air, ground: ground, water: water })

   — three named channels, amounts ALREADY multiplied by the tick's dtMin, and a
   plant with `out <= 0` skipped entirely. `field.js emit()` takes exactly that
   and banks it. THE SIGNATURES AGREE AND NOTHING NEEDED FIXING; the one thing
   that had to change was on this side, and it is that `emit()` must never
   multiply by dt a second time. See field.js's `emit` for what that would cost.

   ⚠ AND THE ONE REAL GAP THAT DID NEED CLOSING. `POWER.plants` has no
     `powerstation` row, so /src/power's `emitAll()` skips node-city's LEGACY
     Power Station entirely — the one generator that existed before this batch,
     burns `use.fuel 0.55`, and would otherwise have been the only fuel-burning
     building in the game with no exhaust. It is in POLLUTE.sources instead, and
     `selfCheck()` asserts the two tables never overlap so it can never be
     counted twice.

   ── EVERY HOOK THIS NEEDS IN node-city/index.html ──────────────────────────
     1. one dynamic import + mount() in boot()
     2. one pollution pre-pass in economyTick() — gathers the emitting tiles and
        the inhabited ones, and calls tick()
     3. computeCoverage(): ONE line multiplying `dem.health` by the sickness load
     4. vitalsTick(): ONE line subtracting the morale hit from the Hope target
     5. the Lease Plot rent line: ONE guarded land-value multiplier
     6. insContribution(): ONE row, so a clicked building explains itself
     7. one launcher — the ☁ chip in the vitals card, and the `P` key
     8. serialize()/loadState() carry `pollution` (optional-with-default)
     9. `__nc.pollution()` / `__nc.pollutionPanel()` on the diagnostics seam
   ════════════════════════════════════════════════════════════════════════════ */

import { POLLUTE } from './tuning.js';
import * as F from './field.js';
import * as Wind from './wind.js';
import * as FX from './effects.js';
import * as Panel from './panel.js';
import * as Overlay from './overlay.js';

let mounted = false;
let state = null;          // the last tick
let warned = false;
let lastCtx = { hour: 12, day: 0, weather: 'clear' };
let lastSources = [];      // for attribution and the overlay markers
let lastPlaces = [];

/* ── 🔴 THE CITY'S IDENTITY IS LATCHED, AND THAT IS A CORRECTNESS RULE ──────
   The prevailing wind is a pure function of this string, so the string had
   better not change. The host derives it the way /src/economy, /src/water and
   /src/power all do — `game.anchors[0].node.id`, falling back to the save key —
   and BOTH of those can move under a live city: an anchor list can be re-linked
   during play and the fallback differs between a signed-in and a guest session.
   A city whose prevailing wind reverses because the player linked a second node
   is not a deterministic endowment, it is a re-roll with extra steps — and it
   would silently invert every siting decision the player had already made.

   So the FIRST non-empty id this module is ever given wins for the lifetime of
   the page, and it is written into the save. The same latch, for the same
   reason, as both neighbours. */
let cityId = '';
let pinned = false;
function setCityId(id) {
  const s = String(id == null ? '' : id);
  if (!s || pinned) return false;
  cityId = s; pinned = true;
  Overlay.repaintNext();
  return true;
}

function warnOnce(m) { if (warned) return; warned = true; try { console.warn('[pollution] ' + m); } catch (e) {} }

/* ── THE NEIGHBOURS, RE-ASKED EVERY TICK ────────────────────────────────────
   /src/water and /src/power may mount before or after this module — node-city
   imports them in that order today, but import order is not a contract and a
   404 on either is a supported state. So the globals are re-read rather than
   cached, exactly as /src/water re-reads `window.MythicPollution` every tick
   for its own pull. */
function W() { try { return (typeof window !== 'undefined' && window.MythicWater) || null; } catch (e) { return null; } }
function P() { try { return (typeof window !== 'undefined' && window.MythicPower) || null; } catch (e) { return null; } }
function D() { try { return (typeof window !== 'undefined' && window.MythicDemographics) || null; } catch (e) { return null; } }

/* One-slot memo on /src/water's endowment, keyed on the module OBJECT so a
   remount — or /src/water arriving after this module first ticked — invalidates
   it without a listener. The endowment is deterministic and never drawn down;
   rebuilding it every tick would re-derive the whole hydrology at 1 Hz for a
   surface map that cannot change. Same memo /src/power/index.js keeps. */
const _endow = { src: null, val: null };
function waterSurface() {
  const w = W();
  if (!w || typeof w.endowment !== 'function') { _endow.src = null; return null; }
  try {
    if (_endow.src !== w) { _endow.src = w; _endow.val = w.endowment(); }
    const e = _endow.val;
    if (!e || typeof e.surfaceAt !== 'function') return null;
    return (x, z) => { const v = e.surfaceAt(x, z); return Number.isFinite(v) ? v : 0; };
  } catch (e) { _endow.src = null; return null; }
}

/* ── WHAT THE CITIZENS ACTUALLY DRINK ───────────────────────────────────────
   A different question from what is in the channel outside the door.
   /src/water computes delivered purity from the basin taint this module's
   `groundAt` feeds, so reading it here CLOSES the loop rather than duplicating
   it. `null` when /src/water is absent, and effects.js then falls back to the
   local surface field and the panel says which.

   🔴 IT RETURNS HARM, NOT PURITY, AND THE DIFFERENCE IS A REAL BUG THAT WAS
      MEASURED RATHER THAN REASONED ABOUT. The obvious reading is
      `harm = 1 − purity`. On the harness's standard city, a completely PRISTINE
      hydrology reported purity 0.9035 — because a basin's base purity is a
      property of the ground and is not 1.00; nobody's aquifer is distilled
      water. That reading put a permanent 0.032 of exposure on every city in the
      game before anything had been built, which is a third of the dead band
      spent on a fact about geology.
      So harm is measured against what THIS ground would give you clean:
      `1 − purity / basePurity`. A pristine city reads exactly 0, and a poisoned
      one reads the fraction of its water quality that pollution took — which is
      the only part this module has any business charging for. */
function waterHarm() {
  const w = W();
  if (!w || typeof w.supply !== 'function') return null;
  try {
    const s = w.supply();
    if (!s || s.model !== 'hydro') return null;
    const p = Number(s.purity);
    if (!Number.isFinite(p)) return null;
    // The clean baseline: each basin's own untainted purity, plus the surface
    // channel's if this city has one. Read off /src/water's state and tuning —
    // both published — rather than assumed.
    let base = 0, n = 0;
    const st = typeof w.state === 'function' ? w.state() : null;
    if (st && st.ok) {
      for (const b of (st.basins || [])) { const v = Number(b.basePurity); if (Number.isFinite(v)) { base += v; n++; } }
      const sp = w.tuning && w.tuning.surface && Number(w.tuning.surface.purity);
      if ((st.surface.river || st.surface.lakes) && Number.isFinite(sp)) { base += sp; n++; }
    }
    const clean = n > 0 ? base / n : 1;
    const harm = clean > 0 ? 1 - p / clean : 1 - p;
    return Math.max(0, Math.min(1, harm));
  } catch (e) { return null; }
}

/* Which of this panel's layers can honestly be drawn. Every field layer is
   answerable from inside this module, so the map is empty today — the shape is
   kept because the Water layer's AQUIFER half depends on /src/water, and
   overlay.js already degrades that half by itself and says which. */
function caps() { return {}; }

/* ════════════════════════════════════════════════════════════════════════════
   THE PUBLIC API
   ════════════════════════════════════════════════════════════════════════════ */
const API = {
  ready: () => mounted,

  /* Called ONCE from boot with THREE + the scene for the overlay, the grid size
     and the city's id. Everything about the city's BUILDINGS arrives per tick
     through tick(). */
  mount(h) {
    if (mounted) return true;
    try {
      const g = (h && h.grid) ? (h.grid | 0) : 24;
      F.mount(g);
      if (h && h.cityId != null) setCityId(h.cityId);
      Panel.mount(h, { onLayers: () => { Overlay.repaintNext(); refresh(); }, close: () => API.closePanel() });
      Overlay.mount(h);
      mounted = true;
      return true;
    } catch (e) { warnOnce('mount failed: ' + (e && e.message)); return false; }
  },

  /* ════════════════════════════════════════════════════════════════════════
     THE THREE CONTRACT CALLS. Each mapped field by field, no spread.
     ════════════════════════════════════════════════════════════════════════ */

  /* 0..1 at a tile. Fractional coordinates are supported and are not optional:
     /src/water/hydro.js samples `groundAt` at eight angles and three radii
     around every basin centre, all of them fractional. See field.js `sample`. */
  airAt(x, z)    { try { return F.airAt(x, z); } catch (e) { return 0; } },
  groundAt(x, z) { try { return F.groundAt(x, z); } catch (e) { return 0; } },
  waterAt(x, z)  { try { return F.waterAt(x, z); } catch (e) { return 0; } },

  /* THE PUSH FROM /src/power, and from this module's own industry pass. Amounts
     already carry the caller's dtMin. Banked, not injected — see field.js. */
  emit(x, z, e) { try { return F.emit(x, z, e); } catch (err) { return false; } },

  /* 🌬 THE WIND. `dir` is the contract's name for the bearing; `deg` is this
     module's. Mapped here and only here — see this file's contract header for
     why every field below is a line of its own.

     `dir` and `deg` are the same number, in degrees CLOCKWISE FROM NORTH, and
     they are the direction the wind BLOWS TOWARD. `from` is the opposite
     compass point, for readers who know the meteorological convention.
     `speed` is 0..1 and is clamped, because /src/power's `windSpeed()` takes it
     in preference to its own reading and assumes that range. */
  wind() {
    const w = Wind.read(cityId, lastCtx);
    return {
      dir: w.deg,
      speed: Math.max(0, Math.min(1, w.speed)),
      deg: w.deg,
      point: w.point,
      from: w.from,
      dx: w.dx,
      dz: w.dz,
      steadiness: w.steadiness,
      prevailing: w.prevailing,
      tilesPerMin: w.tilesPerMin,
    };
  },

  /* ── 🧭 THE ENDOWMENT, in the same shape both neighbours publish theirs: a
     deterministic description of the place, derived from the city id and never
     stored. /src/economy/endowment.js's pattern, applied to the air. */
  endowment(id) {
    const e = Wind.endowmentFor(id == null ? cityId : String(id));
    return {
      cityId: e.cityId,
      grid: F.mounted() ? F.grid() : 24,
      deg: e.deg,
      point: e.point,
      from: e.from,
      dx: e.dx,
      dz: e.dz,
      steadiness: e.steadiness,
      blurb: e.blurb,
      summary: 'Prevailing ' + e.point + ' (' + e.deg + '°), ' +
               (e.steadiness > 0.75 ? 'steady' : e.steadiness < 0.5 ? 'fickle' : 'variable'),
    };
  },

  /* ════════════════════════════════════════════════════════════════════════
     THE TICK. Called from node-city's pollution pre-pass, AFTER the power
     pre-pass — so /src/power's emit() calls for this tick are already banked
     and the two feeds are diffused together rather than one tick apart.

       snapshot = { cityId, grid, hour, day, weather, pop, dtMin,
                    works:  [{ k, x, z, type, name, ico, mult }],
                    places: [{ k, x, z, home, name, ico }] }

     `mult` is node-city's own `tileMult(x, z, t, staff, powered)` — the same
     central production multiplier the building's OUTPUT is computed from. See
     tuning.js `sources` for why emission is keyed on what a building is doing
     rather than on what it is.
     ════════════════════════════════════════════════════════════════════════ */
  tick(dtMin, snap) {
    if (!mounted || !snap) return null;
    try {
      if (snap.cityId != null) setCityId(snap.cityId);
      lastCtx = { hour: Number.isFinite(snap.hour) ? snap.hour : lastCtx.hour,
                  day: Number.isFinite(snap.day) ? snap.day : lastCtx.day,
                  weather: snap.weather || 'clear' };

      /* ── 1. THE INDUSTRY PASS. One emit() per emitting building, in exactly
         the units and the shape /src/power already uses, so the two feeds are
         indistinguishable downstream. */
      let dt = Number(dtMin);
      if (!(dt > 0) || !Number.isFinite(dt)) dt = 0;
      const srcs = [];
      for (const t of (snap.works || [])) {
        const spec = POLLUTE.sources[t.type];
        if (!spec) continue;
        const mult = Math.max(0, Number(t.mult) || 0);
        if (mult <= 0) continue;             // an idle works has a cold chimney
        const air = spec.air * mult * dt, ground = spec.ground * mult * dt, water = spec.water * mult * dt;
        if (air > 0 || ground > 0 || water > 0) F.emit(t.x, t.z, { air, ground, water });
        srcs.push({ x: t.x, z: t.z, type: t.type, name: t.name, ico: t.ico, why: spec.why,
                    air: spec.air * mult, ground: spec.ground * mult, water: spec.water * mult });
      }
      /* …and the PLANTS, for the attribution list only. They have already
         emitted through /src/power's own call site; this reads their reported
         rates so the panel can name the Coal Plant that is doing it.
         🔴 NOTHING IS EMITTED HERE. `emissionsAt` is documented by /src/power as
            "rates, not accumulations", and calling emit() from this loop would
            double every plant in the city while looking perfectly reasonable. */
      const pw = P();
      if (pw && typeof pw.plantsNear === 'function') {
        try {
          const g = F.grid();
          /* ⚠ `plantsNear().emit` IS THE SPEC FACTOR, NOT THE RATE — read off
             that function rather than off the API sketch: it returns
             `spec.emit.air` verbatim, so a Coal Plant reports 1.00 whether it is
             running flat out or scrammed. The RATE is `factor × out × scale`,
             which is the same arithmetic /src/power's own `emitAll()` does, and
             `scale` is read from its published tuning so there is one copy of it
             in the repo. Listing the raw factor here would have put a dead solar
             farm at the top of the blame list at midnight. */
          const scale = (pw.tuning && pw.tuning.emit && Number(pw.tuning.emit.scale)) || 0;
          for (const p of pw.plantsNear(g / 2, g / 2, g)) {
            const e = p.emit || {};
            const q = Math.max(0, Number(p.out) || 0) * scale;
            const air = (e.air || 0) * q, ground = (e.ground || 0) * q, water = (e.water || 0) * q;
            if (air + ground + water <= 0) continue;
            srcs.push({ x: p.x, z: p.z, type: p.type, name: p.label || p.type, ico: '⚡',
                        why: 'burning to make electricity', air, ground, water });
          }
        } catch (e) {}
      }
      lastSources = srcs;
      lastPlaces = snap.places || [];

      /* ── 2. THE FIELDS. */
      const w = Wind.read(cityId, lastCtx);
      const surfaceAt = waterSurface();
      const end = Wind.endowmentFor(cityId);
      const diag = F.step(dt, {
        wind: w, weather: lastCtx.weather, surfaceAt,
        /* The channel's drift direction. Deliberately the city's PREVAILING
           bearing rather than the live wind: a river does not change direction
           when the weather does, and a downstream that reversed twice a day
           would make "upstream of the intake" meaningless. */
        flowDx: end.dx, flowDz: end.dz,
      });

      /* ── 3. THE CONSEQUENCES. */
      const wharm = waterHarm();
      const sv = FX.survey(lastPlaces, wharm);

      state = { ok: true, cityId, wind: w, endow: end, diag, wharm,
                exposure: sv.exposure, airAtPeople: sv.air, healthLoad: sv.healthLoad, moraleHit: sv.moraleHit,
                landValue: sv.landValue, homes: sv.homes, exposedHomes: sv.exposedHomes,
                tiles: sv.tiles, sources: srcs,
                blame: blameFor(sv.tiles, srcs, w),
                water: waterReport(), demog: demogReport() };
      if (Panel.isOpen()) refresh();
      return state;
    } catch (e) { warnOnce('tick threw: ' + (e && e.message)); return null; }
  },

  /* ════════════════════════════════════════════════════════════════════════
     THE THREE CONSEQUENCE CALLS THE HOST READS.
     Each is safe to call BETWEEN ticks — computeCoverage() and vitalsTick() run
     on node-city's render clock, not on the economy tick — and each returns the
     neutral value when this module has nothing to say, so the host's guarded
     line falls back to exactly the number it computed before this existed.
     ════════════════════════════════════════════════════════════════════════ */

  /* ① `dem.health *= 1 + healthLoad()`. Extra ILLNESS, not less clinic. */
  healthLoad() { return (state && state.ok) ? state.healthLoad : 0; },
  /* ② Points off the Hope vital's 0–100 target. */
  moraleHit()  { return (state && state.ok) ? state.moraleHit : 0; },
  /* ③ What a plot here is worth, as a multiple of clean. 1 when nothing is
     known, so a guarded `rent * landValueAt()` is the identity. */
  landValueAt(x, z) {
    if (!mounted) return 1;
    try { return FX.landValueAt(x, z, state && state.ok ? state.wharm : null); }
    catch (e) { return 1; }
  },

  /* The city-level reading, for a HUD chip or another module. */
  exposure()   { return (state && state.ok) ? state.exposure : 0; },
  landValue()  { return (state && state.ok) ? state.landValue : 1; },

  /* 🔎 "Why is this block unhappy?" — the meter and the signed causal list for
     ONE tile, in the shape an inspector row can print directly. */
  explainAt(x, z) {
    if (!mounted) return null;
    try {
      return FX.explainAt(Number(x) || 0, Number(z) || 0, {
        harm: state && state.ok ? state.wharm : null,
        sources: lastSources, wind: Wind.read(cityId, lastCtx),
      });
    } catch (e) { return null; }
  },
  /* Does this building type emit at all? The host's pre-pass asks, so the
     emission table stays in this module and node-city's BUILDINGS rows are not
     touched — three other workflows are editing that file this round. */
  emits: (type) => Object.prototype.hasOwnProperty.call(POLLUTE.sources, String(type)),
  sourceSpec: (type) => {
    const s = POLLUTE.sources[String(type)];
    return s ? { air: s.air, ground: s.ground, water: s.water, why: s.why } : null;
  },

  state: () => state,
  stats: () => F.stats(),
  layers: Panel.layers,

  openPanel() { if (!mounted) return false; Panel.show(state, caps()); refresh(); return true; },
  closePanel() { Panel.hide(); Overlay.hide(); return true; },
  togglePanel() { return Panel.isOpen() ? API.closePanel() : API.openPanel(); },
  panelOpen: () => Panel.isOpen(),

  /* ── SAVE. Three sparse arrays and the id the wind was derived from.
     Optional-with-default on load: absent ⇒ a clean city, which is the correct
     reading of a save written before anything could measure the air, and is
     also the deliberate answer to the retro-fit question (tuning.js `sources`).
     A blob belonging to a DIFFERENT city, or a different grid, is refused. */
  save: () => (mounted ? F.save(cityId) : null),
  load(blob) {
    try {
      if (blob && blob.cityId) setCityId(blob.cityId);
      const ok = F.load(blob, cityId);
      Overlay.repaintNext();
      return ok;
    } catch (e) { F.reset(); return false; }
  },

  /* ════════════════════════════════════════════════════════════════════════
     🔍 THE SELF-CHECKS. Reported at boot ONLY when they fail — a check that
     logs on success is one everybody learns to scroll past.

     ① THE DOUBLE-COUNT GUARD. `POLLUTE.sources` and `POWER.plants` must be
        disjoint. A type in both is emitted twice a tick, by two modules that are
        each individually correct, and the only symptom is "pollution feels a bit
        strong" — which is exactly the class of bug /src/water's header calls out
        for the push/pull path and /src/power's for the taint fallback.
     ② THE WIND TABLE. /src/power/plants.js takes this module's `wind().speed`
        in preference to its own, so if the two weather tables ever drift apart,
        every wind turbine in every city changes output on the day one of them is
        retuned — with no player-visible cause. See tuning.js's wind header.
     ③ THE JOIN. A type in `POLLUTE.sources` that node-city has no BUILDINGS row
        for is a source nobody can build; the host passes its own key list in.
     ════════════════════════════════════════════════════════════════════════ */
  selfCheck(hostTypes) {
    const out = { ok: true, doubleCounted: [], windDrift: [], unknownTypes: [] };
    const p = P();
    try {
      if (p && typeof p.meshTypes === 'function') {
        for (const t of p.meshTypes()) if (POLLUTE.sources[t]) { out.doubleCounted.push(t); out.ok = false; }
      }
      if (p && p.tuning && p.tuning.wind) {
        const theirs = p.tuning.wind.byWeather || {}, mine = POLLUTE.wind.byWeather;
        for (const k in mine) if (Math.abs((theirs[k] == null ? mine[k] : theirs[k]) - mine[k]) > 1e-6) {
          out.windDrift.push(k + ': power ' + theirs[k] + ' vs pollution ' + mine[k]); out.ok = false;
        }
        if (Math.abs((p.tuning.wind.diurnal == null ? POLLUTE.wind.diurnal : p.tuning.wind.diurnal) - POLLUTE.wind.diurnal) > 1e-6) {
          out.windDrift.push('diurnal'); out.ok = false;
        }
      }
    } catch (e) {}
    if (Array.isArray(hostTypes) && hostTypes.length) {
      const have = new Set(hostTypes);
      for (const t in POLLUTE.sources) if (!have.has(t)) { out.unknownTypes.push(t); out.ok = false; }
    }
    return out;
  },

  tuning: POLLUTE,
};

/* ── THE PER-TILE BLAME MAP, built once per tick for the panel's hotspot list.
   Only for the tiles the panel will actually print, because attribution is
   O(sources) per tile and running it over all 576 would be work nobody reads. */
function blameFor(tiles, sources, wind) {
  const out = {};
  for (const t of (tiles || []).slice(0, 6)) {
    out[t.x + ',' + t.z] = FX.attribute(t.x, t.z, sources, wind, 3);
  }
  return out;
}

/* /src/water's own account of what this module did to it, read rather than
   re-derived. `live` false means the module is absent and the panel says so by
   name instead of drawing a plausible aquifer. */
function waterReport() {
  const w = W();
  if (!w || typeof w.supply !== 'function') return { live: false, purity: 1, basins: 0, taintedBasins: 0, worstTaint: 0 };
  try {
    const s = w.supply();
    if (!s || s.model !== 'hydro') return { live: false, purity: 1, basins: 0, taintedBasins: 0, worstTaint: 0 };
    const st = typeof w.state === 'function' ? w.state() : null;
    const bs = (st && st.ok && st.basins) ? st.basins : [];
    /* ⚠ COUNTED ON `taint`, NOT ON `status`. /src/water's status word flips at
       its own warning threshold, which is a threshold about whether the WATER is
       still fit to pump — a perfectly reasonable thing for that panel to say and
       the wrong question here. Photographed with `status`, this panel printed
       "all 2 groundwater deposits clean" directly under a purity meter reading
       70%, which is the flat false HUD claim node-city has had to close twice
       before. A basin carrying any measurable taint is a basin this module has
       poisoned, and that is what it says. */
    let bad = 0, worst = 0;
    for (const b of bs) { const t = Number(b.taint) || 0; if (t > 0.02) bad++; if (t > worst) worst = t; }
    return { live: true, purity: Number(s.purity) || 1, basins: bs.length,
             taintedBasins: bad, worstTaint: worst };
  } catch (e) { return { live: false, purity: 1, basins: 0, taintedBasins: 0, worstTaint: 0 }; }
}

/* 👥 /src/demographics, READ ONLY. It owns who arrives and who leaves; this
   module makes people sick and lets node-city's own population gate do the
   rest. A second hand on that wheel would be two truths about who lives here,
   which is the trap /src/power documents for `MythicWater.taint()`. */
function demogReport() {
  const d = D();
  if (!d || typeof d.ready !== 'function' || !d.ready()) return null;
  try {
    const r = d.report();
    if (!r || !r.ok) return null;
    return { net: Number(r.netPerDay) || 0, leaving: (Number(r.netPerDay) || 0) < -0.05 };
  } catch (e) { return null; }
}

/* The overlay is only painted while the panel is open. An info view is a MODE,
   not a permanent decoration: leaving a pollution plume painted across the city
   after the player closed the panel is the fastest way to make an overlay feel
   like a bug — and this one is the loudest of the three. */
function refresh() {
  if (!Panel.isOpen()) { Overlay.hide(); return; }
  Panel.render(state, caps());
  const w = W();
  Overlay.sync(Panel.layers, {
    wind: state && state.ok ? state.wind : Wind.read(cityId, lastCtx),
    diag: state && state.ok ? state.diag : null,
    sources: lastSources,
    homes: lastPlaces,
    landValueAt: (x, z) => API.landValueAt(x, z),
    waterLive: (w && typeof w.sourceAt === 'function') ? ((x, z) => w.sourceAt(x, z)) : null,
  });
}

try {
  if (typeof window !== 'undefined') {
    window.MythicPollution = API;
    /* node-city may finish booting before or after this module evaluates —
       module scripts are deferred and import order is not guaranteed — so the
       host calls mount() when IT is ready and this line only announces that the
       API exists. Same handshake /src/economy, /src/water and /src/power use. */
    if (typeof window.__ncPollutionReady === 'function') window.__ncPollutionReady(API);
  }
} catch (e) {}

export default API;
