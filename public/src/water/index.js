/* ════════════════════════════════════════════════════════════════════════════
   💧 CITY WATER — module entry point. Registers window.MythicWater.
   ----------------------------------------------------------------------------
   "Make it where each player city have different water sources, where some
    cities have more water than others."

   Every city's hydrology is a PURE FUNCTION OF ITS ID (endowment.js), the water
   in it is a finite, located, pollutable body that can be pumped dry and can
   recover (hydro.js), and both are drawn on the terrain as one canvas texture
   (overlay.js) behind an info view with meters and a named source table
   (panel.js). Numbers all live in tuning.js.

   🔴 THE GLOBALS TRAP (CLAUDE.md, and it has cost this project real time twice).
      `game`, `BUILDINGS`, `THREE`, `scene`, `GRID`, `MORALE` are top-level
      `const` in node-city's module script — global LEXICAL bindings, NOT
      properties of `window`. This module therefore reads NOTHING of the host by
      itself: THREE and the scene arrive once in mount(), and every fact about
      the city arrives per tick in the solve() snapshot, the same seam
      `ecoHost()` already is for /src/economy.

   🔴 AND IT MUST DEGRADE TO NOTHING. A 404 on /src/water/* costs the player the
      water info view and the terrain variation, and nothing else: node-city's
      water production falls back to exactly what it was before this module
      existed, because the host multiplies by a factor that defaults to 1.

   ── HOW THIS RECONCILES WITH THE GAME'S EXISTING WATER ─────────────────────
   node-city already has a `water` LEDGER resource that citizens drink and a
   Purifier that makes it. The brief was to wire to those rather than invent a
   parallel resource, and that is exactly what happens:

     • NO NEW RESOURCE. Nothing here produces, holds or spends anything. The
       ledger `water` is still the only water in the game.
     • NO NEW BUILDING. The Purifier IS the waterworks. Over an aquifer it is a
       well, beside a river it is an intake, and on dry ground it is what its own
       description already says — an atmospheric condenser. That reading cost one
       multiplier and no BUILDINGS row, in a file three other workflows are
       editing this round.
     • ONE MULTIPLIER, ONE DIRECTION. `solve()` returns `factor[tileKey]`, the
       host multiplies its own `def.gen.water * tileMult(...)` by it. The host
       owns the rate; this module owns the ground. Neither can drift because only
       one of them has ever seen the rate.
     • THE FLOOR IS 0.80×, NOT 0. Every existing save has its purifiers placed by
       a player who could not see groundwater when they placed them, so a
       retroactive halving of a lived city's water would be the silent balance
       break the save rules forbid. Good siting is worth up to 1.80×; bad siting
       costs at most 20%. See WATER.extract for the full argument.

   ── THE SHORTFALL CONSEQUENCE IS AN EXISTING ONE, NOT A NEW ONE ────────────
   Less water per minute → less `supply.water` → the host's own coverage system
   registers thirst → vitals → labour and morale → output and population. No new
   failure mode was invented; an existing one became reachable by pumping an
   aquifer dry or by letting a coal plant sit on it. That is the traceable
   consequence the brief asked for, and it is traceable precisely because it runs
   through machinery the player already learned.

   ── EVERY HOOK THIS NEEDS IN node-city/index.html ──────────────────────────
     1. one dynamic import + mount() in boot()
     2. a water pre-pass in economyTick() that calls solve(), and one factor
        applied where `def.gen.water` is banked
     3. one launcher — the 💧 chip in the vitals card, and the `G` key
     4. serialize()/loadState() carry `water` (optional-with-default)
     5. `__nc.water()` / `__nc.waterPanel()` on the diagnostics seam
   ════════════════════════════════════════════════════════════════════════════ */

import { WATER } from './tuning.js';
import * as Endow from './endowment.js';
import * as Hydro from './hydro.js';
import * as Panel from './panel.js';
import * as Overlay from './overlay.js';

let mounted = false;
let grid = 24;
let state = null;          // the last solve
let warned = false;

/* ── 🔴 THE CITY'S IDENTITY IS LATCHED, AND THAT IS A CORRECTNESS RULE ──────
   The hydrology is a pure function of this string, so the string had better not
   change. The host derives it the way /src/economy derives its node id —
   `game.anchors[0].node.id`, falling back to the save key — and BOTH of those
   can move under a live city: an anchor list can be reordered or re-linked
   during play, and the fallback differs between a signed-in and a guest
   session. A city whose aquifers move because the player linked a second node
   is not a deterministic endowment, it is a re-roll with extra steps.

   So the FIRST non-empty id this module is ever given wins for the lifetime of
   the page, and it is written into the save — which means a loaded city keeps
   the ground it was founded on for ever, whatever the host derives today. This
   is the same argument NODE_EMPIRE_HANDOFF.md makes for deriving the capital
   from `capturedAt` rather than storing a flag, run in the other direction:
   when the derivation is not stable, the value must be. */
let cityId = '';
let pinned = false;
function setCityId(id) {
  const s = String(id == null ? '' : id);
  if (!s || pinned) return false;
  cityId = s; pinned = true;
  Endow.invalidate(); Overlay.repaintNext();
  return true;
}

function warnOnce(m) { if (warned) return; warned = true; try { console.warn('[water] ' + m); } catch (e) {} }

function H() { return Endow.hydrologyFor(cityId, grid); }

/* Which of this panel's layers can honestly be drawn. Today every water layer
   is answerable from inside this module, so the map is empty — but the shape is
   kept because /src/pollution may add a layer that is NOT (a contamination
   plume, for instance), and the honest-empty-state machinery in panel.js is
   already wired for it. */
function caps() { return {}; }

const API = {
  ready: () => mounted,

  /* Called ONCE from boot with THREE + the scene for the overlay, the grid size
     and the city's id. Everything about the city's BUILDINGS arrives per tick
     through solve(). */
  mount(h) {
    if (mounted) return true;
    try {
      if (h && h.grid) grid = h.grid | 0;
      if (h && h.cityId != null) setCityId(h.cityId);
      Panel.mount(h, { onLayers: () => { Overlay.repaintNext(); refresh(); }, close: () => API.closePanel() });
      Overlay.mount(h);
      mounted = true;
      return true;
    } catch (e) { warnOnce('mount failed: ' + (e && e.message)); return false; }
  },

  /* ── THE TICK. node-city's water pre-pass calls this and applies
     `result.factor[tileKey]` to its own water generation. Returns null if it
     cannot answer, and the host then produces water exactly as it did before
     this module existed. */
  solve(snapshot) {
    if (!snapshot) return null;
    try {
      // Latched: only the FIRST id is adopted. See setCityId().
      if (snapshot.cityId != null) setCityId(snapshot.cityId);
      if (snapshot.grid) grid = snapshot.grid | 0;
      const s = Hydro.solve({ ...snapshot, cityId, grid });
      if (!s || !s.ok) { warnOnce((s && s.why) || 'solve refused'); state = s || null; return null; }
      state = s;
      if (Panel.isOpen()) refresh();
      return s;
    } catch (e) { warnOnce('solve threw: ' + (e && e.message)); return null; }
  },

  /* ════════════════════════════════════════════════════════════════════════
     THE AGREED CROSS-WORKFLOW SHAPE. Three calls, and every one of them is
     mapped FIELD BY FIELD from this module's own state.

     🔴 NO SPREAD, NO PASS-THROUGH, DELIBERATELY. The trap this batch was warned
        about is real and was found in the failed run: node-city's `game.power`
        is `{ gen, demand, ratio, factor }` while the shared contract is
        `{ capacity, load, factor, byPlant }`. Returning the internal object
        verbatim satisfies every guarded read — one key matches by name and is
        truthy — while feeding `undefined` to every consumer, and it looks like a
        working feature forever. So each field below is written out, and a
        consumer that gets a number from here got it because this line put it
        there.
     ════════════════════════════════════════════════════════════════════════ */

  /* The city's hydrology as it was made: pure, deterministic, never drawn down.
     ⚠ `groundAt(x, z)` is the 0..1 DEPOSIT field — /src/power/overlay.js paints
       exactly this through `endowment().groundAt` for its "Groundwater Deposits"
       row, and it must stay stable while a player watches it. What is LEFT in
       the ground after pumping is `sourceAt().level`, which is a different
       question and lives on the live call. */
  endowment(id) {
    const h = (id == null || String(id) === cityId) ? H() : Endow.hydrologyFor(String(id), grid);
    return {
      cityId: h.cityId,
      grid: h.grid,
      wetness: h.wetness,
      className: h.cls.key,
      classLabel: h.cls.label,
      blurb: h.cls.blurb,
      basins: h.basins.map(b => ({ i: b.i, name: b.name, x: b.cx, z: b.cz, r: b.r,
                                   strength: b.strength, purity: b.purity,
                                   volume: b.volume, recharge: b.recharge, springfed: b.springfed })),
      surface: { river: !!h.surface.river, lakes: h.surface.lakes.length },
      groundAt: (x, z) => h.groundAt(x, z),
      surfaceAt: (x, z) => h.surfaceAt(x, z),
      summary: h.summary(),
    };
  },

  /* What a building on this tile would actually draw from, RIGHT NOW —
     drawdown and contamination included.
       kind   'aquifer' | 'surface' | 'none'
       yield  0..1, the source's strength here after drawdown
       purity 0..1, after contamination
       flow   0..1, SURFACE presence at this tile whichever source won — this is
              the field /src/power/overlay.js reads for its Surface Water row,
              and it must never be handed an aquifer number under that name.
       level  0..1 reserve remaining (1 for surface water)
       basin  index into endowment().basins, or -1 for surface/none
       name   the basin's name, or 'River'/'Lake' */
  sourceAt(x, z) {
    try {
      const s = Hydro.sourceAt(H(), Number(x) || 0, Number(z) || 0);
      return { kind: s.kind, yield: s.yield, purity: s.purity, flow: s.flow,
               level: s.level, strength: s.strength, basin: s.basin, name: s.name };
    } catch (e) {
      warnOnce('sourceAt threw: ' + (e && e.message));
      return { kind: 'none', yield: 0, purity: 1, flow: 0, level: 0, strength: 0, basin: -1, name: '' };
    }
  },

  /* The city's water balance for the last solved tick, in the host's own
     per-minute ledger units.
       capacity  what the city's waterworks can deliver
       draw      what the city wants (buildings + citizens drinking)
       shortfall max(0, draw - capacity)
     …plus the four extras a consumer asked for by name gets honestly, and never
     as a side effect of a spread. */
  supply() {
    if (!state || !state.ok) return { capacity: 0, draw: 0, shortfall: 0,
                                      pumped: 0, recharge: 0, purity: 1, reserve: 1, model: 'none' };
    return {
      capacity: state.capacity,
      draw: state.draw,
      shortfall: state.shortfall,
      pumped: state.pumped,
      recharge: state.recharge,
      purity: state.meanPurity,
      reserve: state.meanLevel,
      model: state.model,
    };
  },

  /* The extraction multiplier a waterworks on this tile would get, with its
     decomposition — for an inspector line, a build-time preview, or a test. */
  factorAt(x, z) {
    try {
      const f = Hydro.factorAt(H(), Number(x) || 0, Number(z) || 0);
      return { factor: f.factor, atmos: f.atmos, fromSource: f.gain, capped: f.capped,
               kind: f.src.kind, purity: f.src.purity, usable: f.usable };
    } catch (e) { return { factor: 1, atmos: 1, fromSource: 0, capped: false, kind: 'none', purity: 1, usable: 1 }; }
  },

  /* The optional PUSH path for /src/pollution. The primary path is a pull —
     hydro.js samples `MythicPollution.groundAt` every tick — and a module that
     never calls this is not penalised. */
  taint(x, z, amount) {
    try { return Hydro.taint(H(), Number(x) || 0, Number(z) || 0, amount); }
    catch (e) { return false; }
  },

  state: () => state,
  layers: Panel.layers,

  openPanel() { if (!mounted) return false; Panel.show(state, caps()); refresh(); return true; },
  closePanel() { Panel.hide(); Overlay.hide(); return true; },
  togglePanel() { return Panel.isOpen() ? API.closePanel() : API.openPanel(); },
  panelOpen: () => Panel.isOpen(),

  /* ── SAVE. Two small arrays and a scalar: how much is left in each basin and
     how poisoned each one is. Optional-with-default on load, so every existing
     save opens with full, clean basins — which is the correct reading of a save
     written before anything could pump or poison them. A blob belonging to a
     DIFFERENT city is refused on the next tick rather than applied. */
  save: () => Hydro.save(),
  load(blob) {
    try {
      Hydro.load(blob);
      /* 🔴 THE SAVED ID WINS, AND IT IS LOADED BEFORE THE FIRST SOLVE. This is
         the other half of the latch: a city that was founded on one id keeps its
         ground even if the host would derive a different one today. Only
         meaningful because loadState() stashes the blob and boot() hands it over
         before the first economyTick — the same ordering /src/power depends on
         for its battery charge. */
      if (blob && blob.cityId) setCityId(blob.cityId);
      Overlay.repaintNext();
    } catch (e) { Hydro.reset(); }
  },

  /* 🔍 The endowment self-check, so a tuning change can never silently produce a
     city with no water in it. Reported at boot only when it FAILS — a
     self-check that logs on success trains everyone to ignore the console. */
  verify: (ids) => Endow.verify(ids, grid),
  tuning: WATER,
};

/* The overlay is only painted while the panel is open. An info view is a MODE,
   not a permanent decoration: leaving the aquifers painted across the city after
   the player closed the panel is the fastest way to make an overlay feel like a
   bug. */
function refresh() {
  if (!Panel.isOpen()) { Overlay.hide(); return; }
  Panel.render(state, caps());
  Overlay.sync(state, Panel.layers, { H: H(), grid });
}

try {
  if (typeof window !== 'undefined') {
    window.MythicWater = API;
    /* node-city may finish booting before or after this module evaluates —
       module scripts are deferred and import order is not guaranteed — so the
       host calls mount() when IT is ready and this line only announces that the
       API exists. Same handshake /src/economy and /src/power use. */
    if (typeof window.__ncWaterReady === 'function') window.__ncWaterReady(API);
  }
} catch (e) {}

export default API;
