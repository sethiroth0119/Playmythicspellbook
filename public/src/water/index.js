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
import * as Net from './network.js';
import * as NetUI from './netui.js';

let mounted = false;
let grid = 24;
let state = null;          // the last solve
let net = null;            // the last mains solve (network.js)
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

/* ════════════════════════════════════════════════════════════════════════════
   🌊 WHAT COUNTS AS OPEN WATER — the ONE resolver, and every consumer asks it.
   ----------------------------------------------------------------------------
   The Sewer Outfall has to discharge somewhere. Three answers, in order, and the
   order is the point:

     ① THE SEA, which endowment.js now puts on EVERY map (the coastline round —
        `buildSea`, `seaAt`, `shoreAt`; the side is a constant so that the sea is
        a fact about the GAME and only its shape is a fact about the city). It is
        asked FIRST because it is the body that is always there, and it is asked
        through `shoreAt(z)` — the coast's own centreline — rather than through a
        coordinate rule of our own, so a retune of the coast moves this gate with
        it.
        🐞 IT IS A DISTANCE, NOT A STRENGTH, AND THE FIRST VERSION WAS A
           STRENGTH. `WATER.sea.inset` holds the waterline 2.05 tiles east of the
           plate so it cannot run over perimeterScenery's ring road, which means
           the strongest sea any tile IN the city reads is ~3% of full — a gate
           of "≥70% of sea strength" matched no tile in any city and fell through
           to ③ every single time, silently. See WATER.sewer.shoreTiles.
     ② A RIVER OR A LAKE at `WATER.sewer.minFlow` or better. The damp bank is
        not open water.
     ③ THE MAP EDGE — the channel off the plate. Belt to ① 's braces: if a
        future coast were ever made conditional, or `seaAt` unavailable on an
        older endowment, a rule that can be UNSATISFIABLE is a rule that bricks a
        city, and the edge row is where node-city already sends everything that
        has to meet something off the map (/src/outside's `edgeOnly` interchange,
        same rule in the same gate).

   ⚠ WHY THIS IS NOT A LIST OF TILES. node-city's own `roadsAdjacentTo(match)`
     takes a RESOLVER rather than a list precisely because a list comparison in a
     second file is how a case quietly stops matching. Everything downstream —
     the placement refusal, the sewer solve, the overlay, the driven test — asks
     THIS function, so there is one answer to "where can waste leave". */
function seaHere(x, z) {
  const h = H();
  if (typeof h.shoreAt !== 'function' || !h.surface || !h.surface.sea) return false;
  const d = Number(h.shoreAt(z)) - x;      // tiles inland of the waterline; ≤0 is in it
  return isFinite(d) && d <= WATER.sewer.shoreTiles;
}

/* The westernmost column of this row that still counts as coast — i.e. the
   answer to "where should I have clicked", clamped onto the plate. Derived from
   the same expression seaHere() tests, so the refusal cannot name a tile the
   gate would then reject. */
function shoreColumn(z) {
  const h = H();
  if (typeof h.shoreAt !== 'function' || !h.surface || !h.surface.sea) return -1;
  const first = Math.ceil(Number(h.shoreAt(z)) - WATER.sewer.shoreTiles);
  const g = grid | 0;
  if (!isFinite(first) || first > g - 1) return -1;
  return Math.max(0, Math.min(g - 1, first));
}

function openWaterAt(x, z) {
  try { if (seaHere(x, z)) return true; } catch (e) { /* fall through */ }
  try { if (H().surfaceAt(x, z) >= WATER.sewer.minFlow) return true; } catch (e) {}
  const g = grid | 0;
  return x <= 0 || z <= 0 || x >= g - 1 || z >= g - 1;
}

/* One sentence naming WHY a tile is open water, for the refusal and the panel.
   Written beside the rule, so the two cannot drift apart. */
function openWaterKind(x, z) {
  try { if (seaHere(x, z)) return 'the sea'; } catch (e) {}
  try {
    if (H().surfaceAt(x, z) >= WATER.sewer.minFlow) {
      return Endow.riverPosition(H().surface, x, z, grid) != null ? 'the river' : 'the lake';
    }
  } catch (e) {}
  const g = grid | 0;
  if (x <= 0 || z <= 0 || x >= g - 1 || z >= g - 1) return 'the outfall channel off the plate';
  return '';
}

/* The nearest legal Water Station site, named — so the refusal can point at a
   basin the player can then go and SEE on the 💧 panel's aquifer layer rather
   than hunting the map by clicking. */
function nearestBasin(x, z) {
  const h = H();
  let best = null, bd = Infinity;
  for (const b of h.basins) {
    const d = Math.hypot(x - b.cx, z - b.cz);
    if (d < bd) { bd = d; best = b; }
  }
  return best ? { name: best.name, x: Math.round(best.cx), z: Math.round(best.cz), dist: bd } : null;
}

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
      Net.setCity(cityId);
      Panel.mount(h, { onLayers: () => { Overlay.repaintNext(); NetUI.repaintNext(); refresh(); }, close: () => API.closePanel() });
      Overlay.mount(h);
      /* 🚰 THE PIPE TOOL. Everything DOM- and THREE-shaped about the mains lives
         in netui.js; network.js stays importable from node, which is the only
         reason the mains can be tested at all. Absent host handles (an older
         node-city that mounts this module with the original four-key ctx) ⇒ the
         tool does not appear and the simulation still runs, because the pipe set
         is data and the toolbar is only one way to edit it. */
      NetUI.mount(h, {
        Net,
        grid: () => grid,
        state: () => state,
        netState: () => net,
        onEdit: () => { NetUI.repaintNext(); refresh(); },
      });
      /* 💾 THE SAVE SLICE RIDES THE SHELF, so node-city's serialize() literal is
         not touched — the whole point of window.MythicCitySave (see
         /src/naming/save.js: "every one of those edits is a merge conflict and a
         chance to drop a field"). The shelf replays a stashed payload to a late
         registrant, which matters here because /src/water mounts AFTER
         loadState. */
      try {
        const shelf = (typeof window !== 'undefined') && window.MythicCitySave;
        if (shelf && shelf.register) {
          shelf.register('waterMains', { save: () => Net.save(), load: (b) => { Net.load(b); NetUI.repaintNext(); } });
        } else {
          warnOnce('no MythicCitySave — the pipe network will not persist this session');
        }
      } catch (e) { warnOnce('save shelf: ' + (e && e.message)); }
      mounted = true;
      return true;
    } catch (e) { warnOnce('mount failed: ' + (e && e.message)); return false; }
  },

  /* ════════════════════════════════════════════════════════════════════════
     🚧 THE SITING GATE. Called from node-city's tryPlace() — the ONE placement
     chokepoint, which already carries three module refusals in exactly this
     shape (MythicOutside.placeCheck, MythicPower.siteRefusal, ecoGroundRefusal).
     Returns the refusal STRING so the reason is written where the rule is.

     ⚠ THE REQUIREMENT COMES FROM THE BUILDINGS ROW, NOT FROM A LIST HERE. The
       host hands over `{ aquifer, openWater, name }` read off `def`, so adding a
       second aquifer-sited building is one flag on one row and this file does
       not change. A list of type strings in a second file is the shape node-city
       has now had to fix three times.
     ⚠ ABSENCE MEANS YES, in both directions: a build with no /src/water places
       these buildings anywhere (the host's own guard), and a type with neither
       flag is refused nothing.
     🔴 THE REFUSAL MUST NAME A LEGAL SITE. "Cannot place here" is
       indistinguishable from a bug. The aquifer refusal names the basin AND the
       layer that draws it, so the player can find a site from the panel alone
       rather than by clicking the map until it stops complaining.
     ════════════════════════════════════════════════════════════════════════ */
  siteRefusal(type, x, z, req) {
    try {
      if (!req) return null;
      const name = (req && req.name) || 'This building';
      if (req.aquifer) {
        const at = H().basinAt(Number(x) || 0, Number(z) || 0);
        if (!at) {
          const b = nearestBasin(Number(x) || 0, Number(z) || 0);
          return '🕳 ' + name + ' pumps groundwater and there is none under this tile. ' +
            (b ? 'The nearest is the ' + b.name + ' basin, centred near ' + b.x + ',' + b.z + ' — '
               : '') +
            'open 💧 Water and switch on “Groundwater Deposits”: every tile the layer paints is a legal site.';
        }
      }
      if (req.openWater) {
        const xx = Number(x) || 0, zz = Number(z) || 0;
        if (!openWaterAt(xx, zz)) {
          /* 🔴 THE REFUSAL POINTS AT A TILE, not at a rule. The coast is on
             every map and its position at THIS row is already computed, so the
             message can name the exact column the player should have clicked —
             which is the difference between a gate and a wall. */
          const h = H();
          let where = '';
          try {
            const col = shoreColumn(zz);
            if (col >= 0) where = 'The coast at this row starts at x=' + col +
              ' — anywhere from there east is on the water. ';
          } catch (e) {}
          const river = h.surface && (h.surface.river || (h.surface.lakes && h.surface.lakes.length));
          return '🌊 ' + name + ' has to discharge into open water, and this tile is dry land. ' + where +
            (river ? 'A river or lake bank works too — switch on “Surface Water” in 💧 Water to see them. '
                   : '') +
            'Failing both, the outermost row of tiles discharges off the plate.';
        }
      }
      return null;
    } catch (e) { return null; }   // a gate that throws must not block a build
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
      Net.setCity(cityId);
      /* 🚰 THE MAINS ARE SOLVED FIRST AND ONCE, and the result is handed DOWN
         into the hydrology rather than being applied over the top of it. If the
         network were multiplied onto hydro's answer afterwards, `capacity` and
         `pumped` would still be the ground-only figures while `factor` was the
         real one — a state object that is internally inconsistent and satisfies
         every guarded read, which is the exact trap this module's header names.
         ⚠ THE HOMES/OUTFALLS LEGS ARE OPTIONAL. An older node-city hands over
           only `wells` and `users`; the network then sees no demand to reach and
           no outfall, `plumbed` is false, and every factor is 1. */
      const dk = Hydro.drinkOf(snapshot.pop, snapshot.drinkPerMin);
      net = Net.solve({
        wells: snapshot.wells, users: snapshot.users,
        homes: snapshot.homes, outfalls: snapshot.outfalls,
        drink: dk.drink,
        openWater: openWaterAt,
      });
      const s = Hydro.solve({ ...snapshot, cityId, grid, net });
      if (!s || !s.ok) { warnOnce((s && s.why) || 'solve refused'); state = s || null; return null; }
      state = s;
      NetUI.onSolve(s);
      if (Panel.isOpen()) refresh();
      return s;
    } catch (e) { warnOnce('solve threw: ' + (e && e.message)); net = null; return null; }
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
      /* 🌊 `sea` is an OBJECT and river/lakes are still a bool and a count,
         because the sea is the only body another module has to draw. /src/ocean
         reads `side`, `shoreAt` and `reach` from here and holds no opinion of
         its own about where the waterline is — see WATER.sea's header for why a
         second opinion would be visible to the player as a contradiction. */
      sea: h.surface.sea ? {
        side: h.surface.sea.side,
        reach: h.surface.sea.reach,
        /* Buildable columns that actually read the sea — see WATER.sea.reach's
           🐞 for why this is not `reach` and why the two are not the same kind
           of number. */
        inland: h.seaInland,
        strength: h.surface.sea.strength,
        purity: h.surface.sea.purity,
        name: h.surface.sea.name,
        /* Tile-x of the waterline at tile-z `z`. Defined past the grid too. */
        shoreAt: (z) => h.shoreAt(z),
      } : null,
      surface: { river: !!h.surface.river, lakes: h.surface.lakes.length, sea: !!h.surface.sea },
      groundAt: (x, z) => h.groundAt(x, z),
      surfaceAt: (x, z) => h.surfaceAt(x, z),
      seaAt: (x, z) => h.seaAt(x, z),
      summary: h.summary(),
    };
  },

  /* What a building on this tile would actually draw from, RIGHT NOW —
     drawdown and contamination included.
       kind   'aquifer' | 'surface' | 'sea' | 'none'
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
               level: s.level, strength: s.strength, basin: s.basin, name: s.name,
               /* 🧂 Written out like every other field (see the NO SPREAD note
                  above). `salt` is true only for the sea, and it exists so a
                  consumer can refuse salt water BY NAME rather than by inferring
                  it from `flow === 0`, which is also true of an aquifer. */
               salt: !!s.salt };
    } catch (e) {
      warnOnce('sourceAt threw: ' + (e && e.message));
      return { kind: 'none', yield: 0, purity: 1, flow: 0, level: 0, strength: 0, basin: -1, name: '', salt: false };
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

  /* ════════════════════════════════════════════════════════════════════════
     🚰 THE MAINS, mapped FIELD BY FIELD off network.js's own last answer for
     the same reason every other cross-module shape in this file is: a spread
     satisfies every guarded read while feeding `undefined` to its consumers
     forever, and it looks like a working feature.
       plumbed   has this city ever touched the mains? false ⇒ every factor is
                 1 and the city behaves exactly as it did before this round
       pipes     tiles of main laid
       parts     connected components — two runs that never touch are two
       reach     0..1, the share of city demand a waterworks actually REACHES
       backup    0..1, the share of sewage with nowhere to go
       sewer     the multiplier the WORST main's backup costs the waterworks
                 standing on it — a headline, not the number the tick applies
       treated   what the outfalls actually clear, against `load`
       capacity  outfall nameplate that is live (wet AND on a main)

     🔴 `reach` IS reached/total AND WAS attached/total, WHICH IS THE BUG THE
        PANEL WORE ON ITS FACE. Demand can be attached to a run that has no
        waterworks on it — a main is not a supply — so the old expression called
        those buildings covered, printed "every building reached" and left the
        contradicting warning ("one waterworks is at 65%") three lines below it.
        One walk, one reading: `demand.reached` is set by the same pass that
        sets `served`, in network.js, and both the panel and this API read it. */
  mains() {
    if (!net) return { plumbed: false, pipes: Net.count(), parts: 0, reach: 1,
                       backup: 0, sewer: 1, load: 0, treated: 0, capacity: 0,
                       unserved: 0, unservedTiles: 0, governed: 0 };
    const d = net.demand;
    return {
      plumbed: net.plumbed,
      pipes: net.pipes,
      parts: net.components,
      reach: d.total > 0 ? d.reached / d.total : 1,
      backup: net.backup,
      sewer: net.sewerFactor,
      load: net.sewage.load,
      treated: net.sewage.treated,
      capacity: net.sewage.capacity,
      unserved: d.unserved,
      unservedTiles: d.unservedTiles,
      governed: net.governed,
    };
  },

  /* The delivery multiplier a governed waterworks on this tile key is getting
     from the network RIGHT NOW — 1 when it is not governed, when the city is
     unplumbed, or when there is no answer yet. */
  mainsAt(k) {
    const f = net && net.mainsFactor[k];
    return Number.isFinite(f) && f > 0 ? f : 1;
  },

  /* The SEWER multiplier this waterworks is carrying — its own main's backup,
     not the city's. Exposed beside mainsAt for the same reason: a caller that
     wants the number the tick applied must be able to get it without composing
     `mains().sewer`, which is the worst main in the city and belongs to a
     headline, not to a building. */
  sewerAtKey(k) {
    const f = net && net.sewerAt && net.sewerAt[k];
    return Number.isFinite(f) && f > 0 ? f : 1;
  },

  /* Is this demand tile (a water consumer or a home) actually reached by a main
     that has a waterworks on it? The SAME connectivity that set the factor
     above — one walk, two readings, so a consumer the panel calls unserved is
     one the tick has already charged the city for. */
  servedAt(k) {
    if (!net || !net.plumbed) return true;
    const v = net.demand.served[k];
    return v === undefined ? true : !!v;
  },

  /* Could a Sewer Outfall discharge here? The same resolver the siting gate
     uses, exposed so a build preview or a test can ask without placing. */
  openWaterAt: (x, z) => openWaterAt(Number(x) || 0, Number(z) || 0),
  openWaterKind: (x, z) => openWaterKind(Number(x) || 0, Number(z) || 0),

  /* The pipe set itself, for the toolbar, the diagnostics seam and the driven
     test. Edits go through here so the overlay and the save can never be told
     about a change the graph did not make. */
  pipes: {
    count: () => Net.count(),
    keys: () => Net.keys(),
    has: (k) => Net.has(k),
    path: (x0, z0, x1, z1) => Net.pathBetween(x0, z0, x1, z1, grid),
    add(list) { const n = Net.add(list); if (n) { NetUI.repaintNext(); refresh(); } return n; },
    remove(list) { const n = Net.remove(list); if (n) { NetUI.repaintNext(); refresh(); } return n; },
    components: () => Net.components(),
    tool: (v) => NetUI.arm(v),
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
  /* 🚰 THE PIPE LAYER IS NOT GATED ON THE PANEL, and that is the one deliberate
     difference. The other layers are an INFO VIEW — a mode the player enters and
     leaves. The mains are an EDITING SURFACE: a player dragging a run has to see
     the run they are dragging it onto, and closing the panel to get the pipes
     back would make the tool unusable. netui.js decides for itself (armed, or
     the panel's `pipes` layer switched on). */
  NetUI.sync(state, Panel.layers.pipes);
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
