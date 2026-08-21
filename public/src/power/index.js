/* ════════════════════════════════════════════════════════════════════════════
   ⚡ CITY POWER — module entry point. Registers window.MythicPower.
   ----------------------------------------------------------------------------
   CLAUDE.md: "NEW features go in public/src/<feature>/ as ES modules. Never add
   a new top-level system to index.html." So the grid model, the info view and
   the overlay all live here, and node-city adds a handful of small hooks —
   listed exhaustively at the bottom of this header so the next reader does not
   have to grep for them.

   🔴 THE GLOBALS TRAP (CLAUDE.md, and it has cost this project real time twice).
      `game`, `BUILDINGS`, `THREE`, `scene` and the rest are top-level `const` in
      node-city's module script — global LEXICAL bindings, NOT properties of
      `window`. This module therefore reads NOTHING by itself: every fact about
      the city arrives in the host snapshot the host builds and hands over, the
      same seam `ecoHost()` already is for /src/economy.

   🔴 AND IT MUST DEGRADE TO NOTHING. A 404 on /src/power/* costs the player the
      electricity info view and nothing else. node-city keeps its own inline
      supply/demand maths as the fallback path and the panel badges which model
      answered, so a silently-degraded grid is visible rather than invisible.

   ── THE SINGLE-TRUTH RULE ───────────────────────────────────────────────────
   There must be exactly one answer to "what is the city's production right now".
     • THE HOST OWNS GENERATION. `def.gen.power * tileMult(...)` is node-city's
       central production multiplier and re-deriving it here would be a second
       economy. Plant outputs arrive already multiplied.
     • THIS MODULE OWNS TRANSMISSION AND STORAGE, which do not exist in the host
       at all.
     • `game.power` REMAINS THE ONLY FIELD the rest of node-city reads. solve()
       fills it; nothing here introduces a parallel `game.grid`. The dossier, the
       coverage panel, the away report and the vitals chip keep reading the field
       they always read, and they now read a number this module produced.

   ── WHAT IS DELIBERATELY NOT TOUCHED ────────────────────────────────────────
   Three other workflows are editing node-city this round. Nothing here touches
   the mesh builder functions, the material/texture/sky blocks, /src/outside,
   /streets, /zoning, /dossier, /palette, /transit or /naming. No BUILDINGS row
   is added or edited — the battery buffer rides on the existing Power Station
   rather than arriving as a new building type, for exactly that reason.

   ── EVERY HOOK THIS NEEDS IN node-city/index.html ───────────────────────────
     1. one <script type="module"> tag
     2. the power pre-pass in economyTick() delegates to solve() when ready
     3. one toolbar button + one keyboard shortcut to open the panel
     4. serialize()/loadState() carry `powerStore` (optional-with-default)
     5. `__nc.powerGrid()` on the diagnostics seam
   ════════════════════════════════════════════════════════════════════════════ */

import { POWER } from './tuning.js';
import * as Grid from './grid.js';
import * as Panel from './panel.js';
import * as Overlay from './overlay.js';
import * as Plants from './plants.js';
import * as Geo from './geology.js';
import * as Meshes from './meshes.js';
import * as Link from './link.js';
import * as Lines from './lines.js';

let host = null;          // the last host snapshot handed over
let state = null;         // the last solve
let store = 0;            // battery charge, in unit-minutes. Persisted.
let mounted = false;
let warned = false;
let cityId = '';          // latched — see setCityId()
let pinned = false;

/* 🔴 THE CITY'S IDENTITY IS LATCHED, AND THAT IS A CORRECTNESS RULE.
   The geothermal field is a pure function of this string, so the string had
   better not change. node-city derives it the way /src/economy and /src/water
   do — `game.anchors[0].node.id`, falling back to the save key — and BOTH of
   those can move under a live city: an anchor list can be re-linked during play
   and the fallback differs between a signed-in and a guest session. A city whose
   hot springs move because the player linked a second node is not a
   deterministic endowment, it is a re-roll with extra steps. So the FIRST
   non-empty id wins for the lifetime of the page and is written into the save.
   ⚠ THE SAME ARGUMENT AND THE SAME LATCH /src/water USES, deliberately: the two
     modules must agree on which ground they are describing, or geology's
     springfed lift would be reading another city's basins. */
function setCityId(id) {
  const s = String(id == null ? '' : id);
  if (!s || pinned) return false;
  cityId = s; pinned = true;
  Geo.invalidate(); Overlay.repaintNext();
  return true;
}

/* 🔌 THE METERING OPT-IN. See POWER.demand's header for the full argument: a
   city founded after this landed is metered from its first tick, a city loaded
   from an older save is not, and the player can turn it on from the panel.
   ⚠ ABSENT IN THE SAVE BLOB ⇒ NOT METERED, and that absence is exactly what
     identifies an older save — which is why no version number is written and
     none is needed. `load()` is what flips it; a session that never loads a blob
     is a new city and stays metered. */
let metered = true;

/* 🔌 THE CONNECTIVITY LATCH — the second opt-in, and it is the metering
   argument made a second time about a bigger number.
   ----------------------------------------------------------------------------
   POWER.transmission.enforce was false for this module's whole life and its own
   comment called that "the most important line in the file": turning topology
   into a production gate would "retroactively black out every building in every
   EXISTING SAVE that happens to sit off the powered road component". That is
   still true and it is still forbidden. What changed is that the rule now has
   somewhere to live that is not the flag.

   ⚠ ABSENT IN THE SAVE BLOB ⇒ NOT WIRED, and that absence is exactly what
     identifies an older save — which is why no version number is written and
     none is needed. `load()` is what flips it; a session that never loads a blob
     is a new city and stays wired from its first tick. A city built under this
     rule has a Grid Connector on its verge from the moment it exists and its
     player laid their roads knowing connection matters; a city built before it
     did not, and re-deciding that for them while they were away is the one
     thing the save-compatibility constraint actually forbids.
   🚫 REJECTED: enforcing on old saves after a warning toast. A toast is read by
      the player who is looking at the screen when it fires; the affected city
      may not be opened for a month, and by then the blackout is "a bug that
      appeared in an update". */
let wired = true;

function warnOnce(m) { if (warned) return; warned = true; try { console.warn('[power] ' + m); } catch (e) {} }

/* ── CAPABILITIES ───────────────────────────────────────────────────────────
   Which terrain layers can honestly be drawn right now. These are the agreed
   cross-workflow globals; a parallel workflow owns /src/water and
   /src/pollution and may land them at any time, including after this module has
   already mounted — so this is re-asked on every refresh rather than cached.

   🔴 NOTHING HERE INVENTS A FIELD. If MythicWater is absent there is no
      groundwater layer, the legend row greys out and names the global it is
      waiting for. Synthesising a plausible procedural aquifer would light the
      row up and would be indistinguishable from the real thing at a glance —
      "a guarded fallback that fires forever looks exactly like a working
      feature" is the specific failure this module was told to avoid, and a
      fake terrain layer is the most convincing possible instance of it. It
      would also be a SECOND TRUTH about water the moment /src/water lands. */
function caps() {
  const W = (typeof window !== 'undefined' && window.MythicWater) || null;
  const P = (typeof window !== 'undefined' && window.MythicPollution) || null;
  return {
    wind:    !!(P && typeof P.wind === 'function' && typeof P.airAt === 'function'),
    ground:  !!(W && typeof W.endowment === 'function'),
    surface: !!(W && typeof W.sourceAt === 'function'),
    /* ♨ THE ONE TERRAIN LAYER THAT IS NEVER GREY. geology.js is ours and is
       always answerable, so unlike the three rows above this one has no external
       dependency and no honest-empty-state to show. It is listed here anyway so
       the legend builder has a single uniform rule. */
    heat:    true,
    /* ☁ …and the emission SOURCE map, which is also ours: what our plants put
       out. Deliberately NOT a pollution map — where it goes is dispersion, which
       belongs to /src/pollution and is not drawn here. */
    emit:    true,
  };
}

/* Turn whichever of those exist into the `(x, z) -> 0..1` field overlay.js
   paints, and into a terrain signature so the overlay's repaint gate notices
   when the water module lands mid-session. */
function terrain() {
  const c = caps(), out = { terrainSig: '' };
  const W = (typeof window !== 'undefined' && window.MythicWater) || null;
  const P = (typeof window !== 'undefined' && window.MythicPollution) || null;
  if (c.wind) {
    const w = P.wind() || {};
    // `wind()` returns direction and speed for the city; the per-tile field is
    // the pollution module's own air field where it has one, and a flat city
    // speed otherwise. Both are ITS numbers, not ours.
    const speed = Math.max(0, Math.min(1, Number(w.speed) || 0));
    out.wind = { dir: w.dir, speed, field: (x, z) => {
      try { const v = P.airAt(x, z); return isFinite(v) ? Math.max(speed, Math.min(1, v)) : speed; }
      catch (e) { return speed; }
    } };
    out.terrainSig += 'w' + speed.toFixed(2) + ':' + (w.dir || '');
  }
  /* 💧 GROUNDWATER — the ENDOWMENT field, not the live reserve, and the two are
     different questions: /src/water's own header says `groundAt` is "the 0..1
     DEPOSIT field … it must stay stable while a player watches it", whereas
     what is left after pumping is `sourceAt().level`. A legend row labelled
     "Groundwater Deposits" is asking the first question, so it reads the first
     field. Cached because the endowment is deterministic and never drawn down —
     rebuilding it every refresh would re-derive the whole hydrology at 1 Hz for
     a picture that cannot change. */
  if (c.ground) {
    try {
      if (_endow.src !== W) { _endow.src = W; _endow.val = W.endowment(); }
      const e = _endow.val;
      if (e && typeof e.groundAt === 'function') {
        out.ground = (x, z) => { const v = e.groundAt(x, z); return isFinite(v) ? v : 0; };
        out.terrainSig += 'g' + (e.cityId || '1');
      }
    } catch (e) { _endow.src = null; }
  }
  /* 💧 SURFACE WATER — `sourceAt(x, z).flow`. Deliberately NOT `.yield` or
     `.level`: /src/water documents flow as "SURFACE presence at this tile
     whichever source won — this is the field /src/power/overlay.js reads for
     its Surface Water row, and it must never be handed an aquifer number under
     that name". An aquifer's strength painted under a "Surface Water Flow"
     legend would be a confidently wrong map. */
  if (c.surface) {
    out.surface = (x, z) => {
      try { const s = W.sourceAt(x, z); const v = s && s.flow; return isFinite(v) ? v : 0; }
      catch (e) { return 0; }
    };
    out.terrainSig += 's1';
  }
  /* ♨ GEOTHERMAL HEAT. The field the placement gate reads, painted exactly as
     the gate sees it — a player who can see where the hot ground is can plan a
     Geothermal Plant instead of discovering the refusal one click at a time.
     Deterministic and never drawn down, so the signature is just the city id and
     the springfed lift that geology.js already keys its own memo on. */
  {
    const f = Geo.fieldFor(cityId, (host && host.grid) || 24);
    out.heat = (x, z) => f.heatAt(x, z);
    out.heatMin = POWER.plants.geothermal.minHeat;
    out.terrainSig += 'h' + (f.cityId || '') + f.vents.length;
  }
  return out;
}
/* One-slot memo. Keyed on the module OBJECT so a remount — or /src/water
   arriving after this panel first opened — invalidates it without a listener. */
const _endow = { src: null, val: null };

/* ── 💸 THE BILL ─────────────────────────────────────────────────────────────
   The one place this module talks about money, and it does not move any.

   🔴 CINDER IS NEVER MINTED (CLAUDE.md, ECONOMY.md). Exported electricity that
      credited the player here would be the retired Cinder Forge with a new
      label on it — "~16,000,000 🔥/day for one player" — and it would look
      entirely correct in review, as all four leaks ECONOMY.md documents did.
      So this measures the energy that crossed the link, prices it with the ONE
      tariff in POWER.trade, and hands the value to /src/economy, which settles
      it INSIDE runDay's audit window: the import leg out of the treasury as an
      ordinary `flow.imports`, the export leg into the SAME capped export faucet
      goods revenue already uses. One faucet, one ceiling.

   ⚠ AND IT CANNOT SETTLE HERE EVEN IF IT WANTED TO. This runs at the host's
     tick cadence, which is nowhere near an economic day; money moved between
     two audit windows is invisible to `audit()`, which is the structural blind
     spot the founding mint lived in for its whole life. Accumulating a bill and
     letting the economy settle it is not politeness, it is the only shape that
     is auditable at all.

   ⚠ VALUE, NOT UNITS, IS WHAT CROSSES. /src/economy has no concept of a power
     unit/min and must not grow one; POWER.trade owns the tariff and this is its
     only call site. The unit-minute figures ride along purely as a readout so
     the panel can print what CLEARED rather than what was asked for. */
function bill(s, dtMin) {
  try {
    const t = s && s.trade; if (!t) return;
    /* ⚠ `isFinite`, NOT just `> 0`. `Number(Infinity) || 0` is Infinity and it
       survives a `> 0` test — that exact hole let a bad clock read run three
       economic days off garbage in /src/economy (gauntlet round 1). The
       economy's own `noteUtilityTrade` drops non-finite figures as well, so
       this is the second of two independent refusals rather than the only one:
       a bill is money, and money gets two. */
    const dt = Number(dtMin);
    if (!isFinite(dt) || !(dt > 0)) return;
    const impUM = t.importUnits * dt, expUM = t.exportUnits * dt;
    if (!(impUM > 0) && !(expUM > 0)) return;
    const E = (typeof window !== 'undefined' && window.MythicEconomy) || null;
    /* link.read() already refused when the economy was absent, so reaching here
       with no economy means it landed and left between two lines. Dropping the
       tick is the only honest move: the energy is not billed, so it must not
       have flowed either — and it did not, because `trade.ok` was false when
       grid.js decided. */
    if (!E || typeof E.utilityTrade !== 'function') return;
    const v = Link.value(impUM, expUM);
    E.utilityTrade({ importValue: v.importValue, exportValue: v.exportValue,
                     importUnitMin: impUM, exportUnitMin: expUM });
  } catch (e) { warnOnce('bill threw: ' + (e && e.message)); }
}

/* ── THE PUBLIC API ─────────────────────────────────────────────────────── */
const API = {
  ready: () => mounted,

  /* Called ONCE from boot, with THREE + the scene for the overlay and nothing
     else. Everything about the CITY arrives per-tick through solve(). */
  mount(h) {
    if (mounted) return true;
    try {
      if (h && h.cityId != null) setCityId(h.cityId);
      Panel.mount(h, { onLayers: () => { Overlay.repaintNext(); refresh(); },
                       close: () => API.closePanel(),
                       meter: (on) => { metered = !!on; Grid.invalidate(); refresh(); },
                       /* 🗼 …and the connection opt-in. ONE WAY: `on` is only
                          ever honoured as true. A city that could turn the rule
                          back off would get the power its lines bought without
                          keeping the lines, which is a refund faucet wearing a
                          setting's clothes. */
                       wired: (on) => { if (on) { wired = true; Grid.invalidate(); refresh(); } } });
      Overlay.mount(h);
      /* The mesh builders need THREE and nothing else. Mounted here rather than
         lazily on the first buildMesh() call, because the host asks for a mesh
         while it is restoring a saved city — see the rebuild sweep in boot(). */
      Meshes.mount(h);
      /* 🗼 THE CONDUCTOR THE PLAYER DRAWS. Mounted last of the four because it
         is the only one that binds document-level listeners and builds scene
         geometry of its own, so a throw inside it must not cost the panel, the
         overlay or the plant meshes — it is wrapped again inside its own mount
         for the same reason.
         ⚠ Its onChange is what keeps the topology cache honest. grid.js caches
           the walk behind a signature and its header records two versions of
           that signature that were silently wrong; a conductor set that changed
           without invalidating would be the third, and a stale network looks
           exactly like a correct one. */
      try {
        Lines.mount(h, { onChange: () => { Grid.invalidate(); refresh(); } });
      } catch (e) { warnOnce('lines mount failed: ' + (e && e.message)); }
      mounted = true;
      return true;
    } catch (e) { warnOnce('mount failed: ' + (e && e.message)); return false; }
  },

  /* ── 🏭 THE MESH DISPATCH. node-city's buildMesh() calls this for the nine
     plant types and falls back to its own Power Station recipe when it returns
     null — so a 404 on this module, or a call that arrives before mount(), costs
     the player the specific silhouette and never leaves a hole in the city. */
  mesh(type, lvl) {
    try { return Meshes.ready() ? Meshes.mesh(type, lvl) : null; }
    catch (e) { warnOnce('mesh(' + type + ') threw: ' + (e && e.message)); return null; }
  },
  meshTypes: () => Plants.TYPES.slice(),
  isPlant: (t) => Plants.isPlantType(t),

  /* ── 🌤 THE AVAILABILITY PASS. Called from node-city's power pre-pass AFTER
     it has gathered the plants and BEFORE it sums generation, and the host
     multiplies `def.gen.power * tileMult(...)` by `result.factor[tileKey]`.
     ONE multiplier, ONE direction — the host owns the rate, this owns how much
     of it the weather, the ground and the reactor are letting through.
     Returns null when it cannot answer, and the host then generates exactly as
     it did before this module existed. */
  availability(ctx) {
    if (!ctx) return null;
    try {
      if (ctx.cityId != null) setCityId(ctx.cityId);
      return Plants.availability({ cityId: cityId, grid: ctx.grid, hour: ctx.hour,
                                   weather: ctx.weather, pop: ctx.pop, dtMin: ctx.dtMin,
                                   waterCov: ctx.waterCov, plants: ctx.plants,
                                   loads: ctx.loads, occupied: ctx.occupied });
    } catch (e) { warnOnce('availability threw: ' + (e && e.message)); return null; }
  },

  /* ── 🚧 THE SITING GATE. node-city's tryPlace() asks this and toasts the
     string. null means "fine". See plants.js on why a 404 must never make a
     building unplaceable. */
  siteRefusal(type, x, z) {
    try { return Plants.siteRefusal(type, Number(x) || 0, Number(z) || 0, siteCtx()) || null; }
    catch (e) { return null; }
  },
  siteReport(type, x, z) {
    try { return Plants.siteReport(type, Number(x) || 0, Number(z) || 0, siteCtx()); }
    catch (e) { return { ok: true, quality: 1, label: '', rows: [], refusal: null }; }
  },

  /* ── THE TICK. The host's power pre-pass calls this and assigns the result
     straight into `game.power`. Returns null if it cannot answer, and the host
     then keeps its own inline maths — see the fallback badge in panel.js. */
  solve(snapshot) {
    if (!snapshot) return null;
    try {
      if (snapshot.cityId != null) setCityId(snapshot.cityId);
      /* `metered` is the module's, not the host's, so it is written in HERE
         rather than read off the snapshot — the host has no business knowing
         about an opt-in it does not own, and a field it forgot to send would
         silently un-meter a city that had opted in. */
      host = snapshot;
      /* 🔌 THE INTERCONNECTOR, ASKED BEFORE THE SOLVE. Same shape as the
         terrain capabilities above: `window.MythicOutside` and
         `window.MythicEconomy` are real window properties (module
         registrations), so unlike node-city's `game`/`BUILDINGS` they ARE
         visible from here — link.js reads them and nothing else. Asked every
         tick rather than cached, because either module can land or fail after
         this one has already mounted, and because /src/outside's own answer is
         already cached behind refreshRoadArea. */
      const link = Link.read();
      /* 🗼 THE CONDUCTOR SET, HANDED OVER RATHER THAN IMPORTED. grid.js does not
         import lines.js and does not know what a pole looks like — it is given
         a Set of cell keys, a list of injecting cells and one signature string,
         which is the same shape and the same direction as every other fact in
         its host snapshot. Cheap: both are memoised in lines.js and rebuilt only
         when the player draws.
         ⚠ AND IT IS RESOLVED HERE, NOT THERE. `enforce` is the feature flag AND
           the per-city latch, ANDed once, in one place. Two callers resolving it
           independently is how a flag comes to mean two different things. */
      const s = Grid.solve({ grid: snapshot.grid, tiles: snapshot.tiles, plants: snapshot.plants,
                             loads: snapshot.loads, pop: snapshot.pop, hasGrid: snapshot.hasGrid,
                             perPop: snapshot.perPop, floor: snapshot.floor, dtMin: snapshot.dtMin,
                             metered, link,
                             enforce: !!(POWER.transmission.enforce && wired),
                             lines: { cells: Lines.conductors(), seeds: Lines.seeds(),
                                      sig: Lines.signature() } }, store);
      if (!s.ok) { warnOnce(s.why || 'solve refused'); state = s; return null; }
      store = s.store.charge;
      state = s;
      bill(s, snapshot.dtMin);
      if (Panel.isOpen()) refresh();
      return s;
    } catch (e) { warnOnce('solve threw: ' + (e && e.message)); return null; }
  },

  /* ── THE AGREED CROSS-WORKFLOW SHAPE ──────────────────────────────────────
     A parallel workflow is building nine plant types against exactly this
     signature. `byPlant` is the per-plant breakdown; when that workflow lands,
     its plants arrive through the host snapshot like every other generator and
     this returns them with no change here. */
  supply() {
    if (!state || !state.ok) return { capacity: 0, load: 0, factor: 1, byPlant: [] };
    /* 🔴 FIELD BY FIELD, NO SPREAD. node-city's `game.power` is
       `{ gen, demand, ratio, factor }` and the contract is
       `{ capacity, load, factor, byPlant }`. `gen`→`capacity` and
       `demand`→`load` are RENAMES; `factor` is the only key that matches by
       name; `byPlant` has no existing source and `ratio` exists in the game and
       not in the contract. Returning the internal object verbatim would satisfy
       every guarded read — one truthy key matches — while feeding `undefined`
       capacity and load to every consumer for ever, and it would look like a
       working feature the whole time. So each line below is written out. */
    return {
      capacity: state.capacity,
      load: state.load,
      factor: state.factor,
      byPlant: state.byPlant.map(p => ({ k: p.k, x: p.x, z: p.z, type: p.type,
                                         name: p.name, ico: p.ico, out: p.out,
                                         avail: p.avail, why: p.why })),
    };
  },

  /* Every generator within a Chebyshev radius, with what it is currently making
     and how dirty it is. The pollution module's neighbourhood query. */
  plantsNear(x, z, r) {
    try { return Plants.plantsNear(Number(x) || 0, Number(z) || 0, Number(r) || 0); }
    catch (e) { return []; }
  },

  /* ☁ WHAT THE FLEET PUT OUT LAST TICK, and whether anything was listening.
     `live` false means window.MythicPollution.emit is absent — the totals are
     still true, they were simply not delivered. /src/pollution can read this on
     its first tick to seed itself from a city that has been burning coal for an
     hour before it loaded. */
  emissions() {
    const e = state && state.ok && state.emissions;
    if (!e) return { air: 0, ground: 0, water: 0, calls: 0, live: false };
    return { air: e.air, ground: e.ground, water: e.water, calls: e.calls, live: e.live };
  },
  emissionsAt(x, z) { try { return Plants.emissionsAt(Number(x) || 0, Number(z) || 0); } catch (e) { return null; } },

  /* ── 🌋 THE GEOTHERMAL ENDOWMENT, in the same shape /src/water publishes its
     hydrology: a deterministic description of the ground plus a 0..1 field.
     Mapped field by field for the reason supply() gives. */
  endowment(id) {
    const f = Geo.fieldFor(id == null ? cityId : String(id), (host && host.grid) || 24);
    return {
      cityId: f.cityId, grid: f.grid, gradient: f.gradient,
      className: f.prov.key, classLabel: f.prov.label, blurb: f.prov.blurb,
      vents: f.vents.map(v => ({ i: v.i, name: v.name, x: v.cx, z: v.cz, r: v.r,
                                 peak: v.peak, spring: !!v.spring })),
      best: { x: f.best.x, z: f.best.z, heat: f.best.h },
      minHeat: POWER.plants.geothermal.minHeat,
      heatAt: (x, z) => f.heatAt(x, z),
      summary: f.summary(),
    };
  },
  heatAt(x, z) {
    try { return Geo.fieldFor(cityId, (host && host.grid) || 24).heatAt(Number(x) || 0, Number(z) || 0); }
    catch (e) { return 0; }
  },

  /* The demand ladder's answer for one tile — what a building here is actually
     running at during a brownout, and which class decided that. */
  factorAt(x, z) {
    const k = (Number(x) || 0) + ',' + (Number(z) || 0);
    if (!state || !state.ok) return { factor: 1, cls: 'none', shed: false };
    const f = state.tileFactor[k];
    return { factor: isFinite(f) ? f : state.factor, cls: 'none', shed: isFinite(f) && f < 0.999 };
  },

  /* 🔌 The interconnector, for the panel, the driver and anything that wants to
     know why the meter is refusing. Field by field — the same rule supply()
     spells out at length: returning the internal object verbatim satisfies
     every guarded read while feeding `undefined` to every consumer forever. */
  trade() {
    const t = state && state.ok && state.trade;
    const L = Link.read();
    if (!t) {
      return { ok: false, importUnits: 0, exportUnits: 0,
               importCap: L.importCap, exportCap: L.exportCap, rating: L.rating,
               arrears: L.arrears, curtailed: L.curtailed,
               present: L.present, priced: L.priced, connected: L.connected,
               viaLabel: L.viaLabel,
               why: L.why || 'The grid model is not answering, so nothing is crossing the link.',
               fix: L.fix, tariff: Link.tariffs() };
    }
    return { ok: t.ok, importUnits: t.importUnits, exportUnits: t.exportUnits,
             importCap: t.importCap, exportCap: t.exportCap, rating: t.rating,
             arrears: t.arrears, curtailed: t.curtailed,
             present: t.present, priced: t.priced, connected: t.connected,
             viaLabel: t.viaLabel, why: t.why, fix: t.fix, tariff: Link.tariffs() };
  },

  metered: () => metered,
  setMetered(on) { metered = !!on; Grid.invalidate(); refresh(); return metered; },

  /* ── 🗼 POWER LINES ────────────────────────────────────────────────────────
     The tool, the network and the connector. Every entry is guarded and every
     one degrades to a truthful nothing rather than a plausible zero — the same
     rule trade() and supply() are written to. */
  lines: {
    ready: () => Lines.ready(),
    arm: (v) => Lines.setArmed(v == null ? true : v),
    armed: () => Lines.isArmed(),
    count: () => Lines.count(),
    has: (x, z) => Lines.has(Number(x) || 0, Number(z) || 0),
    connector: () => Lines.connector(),
    /* The drag, exposed so a driver can lay a run without a pointer. Same code
       path the tool uses — a test that calls a private twin of the shipped
       function is a test of the twin. */
    lay: (x0, z0, x1, z1, swap) => Lines.lay(Lines.runCells(x0, z0, x1, z1, !!swap)),
    lift: (x0, z0, x1, z1, swap) => Lines.lift(Lines.runCells(x0, z0, x1, z1, !!swap)),
    run: (x0, z0, x1, z1, swap) => Lines.runCells(x0, z0, x1, z1, !!swap),
    quote: (x0, z0, x1, z1, swap) => Lines.quote(Lines.runCells(x0, z0, x1, z1, !!swap), false),
    verify: () => Lines.verify(),
  },

  /* 🔌 IS CONNECTIVITY GATING PRODUCTION IN THIS CITY? Three answers, because
     "the feature is on" and "this city is under it" are different facts and a
     UI that can only ask the first cannot explain the second to the player
     whose old city is not enforcing. */
  enforcing: () => ({ inEffect: !!(POWER.transmission.enforce && wired),
                      flag: !!POWER.transmission.enforce, wired }),
  /* The opt-in, for the panel switch. Symmetric with setMetered, and it
     invalidates for the same reason: the walk's answer has not changed but what
     is done with it has, and the cached solve would keep the old one. */
  setWired(on) { wired = !!on; Grid.invalidate(); refresh(); return wired; },

  state: () => state,
  topology: () => Grid.topology(),
  layers: Panel.layers,

  openPanel() { if (!mounted) return false; Panel.show(state, caps()); refresh(); return true; },
  closePanel() { Panel.hide(); Overlay.hide(); return true; },
  togglePanel() { return Panel.isOpen() ? API.closePanel() : API.openPanel(); },
  panelOpen: () => Panel.isOpen(),

  /* ── SAVE. One number. Optional-with-default on load, so every existing save
     opens with an empty buffer and nothing else changes. */
  save: () => ({ store, cityId, metered: metered ? 1 : 0, plants: Plants.save(),
                 /* 🗼 The line network, and the latch that says this city was
                    played under the connection rule. BOTH are written every
                    time, including when the network is empty — `wired` is only
                    meaningful as a key that is PRESENT, and a city that has
                    drawn no cable yet is still a city that knows it has to. */
                 lines: Lines.save(), wired: wired ? 1 : 0 }),
  load(blob) {
    const v = blob && Number(blob.store);
    store = isFinite(v) && v >= 0 ? v : 0;
    Plants.load(blob && blob.plants);
    if (blob && blob.cityId) setCityId(blob.cityId);
    /* 🔴 THE OPT-IN LATCH, AND WHY IT READS THE WAY IT DOES.
       A blob that exists but carries no `metered` key was written by a session
       that predates the demand ladder, and that city's player laid out their
       buildings under the old draw. Metering it on load would be exactly the
       silent retroactive re-balance node-city's own powerNeed comment forbids —
       so an older save opens UN-metered and the panel offers the switch.
       A brand-new city never calls load() at all and stays metered from its
       first tick, which is the whole asymmetry. */
    if (blob && typeof blob === 'object') metered = !!blob.metered;
    /* 🔌 THE CONNECTIVITY LATCH, READ THE SAME WAY AND FOR THE SAME REASON. See
       `wired`'s header: a blob that exists but carries no `wired` key was
       written before connectivity gated production, and that city's player laid
       their roads under the old rule. This one line is the entire grandfather
       guarantee — with it false, grid.js takes the identical branch it took
       before this round and the city's numbers are bit-for-bit what they were.
       ⚠ The LINES are loaded either way. A save that somehow carries a network
         but no latch still gets its poles back; the network is the player's
         property and the latch is only about whether it is enforced. */
    Lines.load(blob && blob.lines);
    if (blob && typeof blob === 'object') wired = !!blob.wired;
    Grid.invalidate();
  },

  /* 🔍 The endowment self-check, so a tuning change can never silently make
     geothermal impossible or universal. Reported at boot ONLY on failure. */
  verify: (ids) => Geo.verify(ids, (host && host.grid) || 24),
  /* …and the JOIN check: a generator row in node-city with no spec here, or a
     spec here with no row there. Both look fine in a diff. */
  selfCheck: (types) => Plants.selfCheck(types),

  tuning: POWER,
};

/* The context every siting question needs, assembled from the last tick. The
   `occupied` predicate is the one thing that cannot come from a snapshot,
   because it must answer for the tile the player is hovering RIGHT NOW — so the
   host installs it once at mount and it is called, never stored elsewhere. */
let _occupied = null, _siteCtx = {};
function siteCtx() {
  return { cityId, grid: (host && host.grid) || 24,
           hour: _siteCtx.hour, weather: _siteCtx.weather,
           pop: _siteCtx.pop, waterCov: _siteCtx.waterCov,
           loads: (host && host.loads) || [], occupied: _occupied };
}
/* ⚠ ONE INSTALLED PREDICATE, NOT A CACHED TILE MAP. `occupied` closes over the
   host's live tiles, so it always answers for the city as it is at the instant
   the player hovers. A copy taken at tick time would be one tick stale, which is
   exactly long enough to tell a player a tile is free while they are looking at
   the building standing on it. */
API.setOccupied = function (fn) { _occupied = (typeof fn === 'function') ? fn : null; };
/* The cheap city facts a siting preview needs BETWEEN ticks — the clock and the
   weather move faster than the economy tick does, and a wind reading that only
   updated once a minute would make the turbine preview look broken. */
API.setSiteCtx = function (c) { _siteCtx = c || {}; };

/* The overlay is only ever painted while the panel is open. An info view is a
   MODE, not a permanent decoration: leaving cables painted across the city after
   the player closed the panel is the single fastest way to make an overlay feel
   like a bug. */
function refresh() {
  if (!Panel.isOpen()) { Overlay.hide(); return; }
  const t = terrain();
  Panel.render(state, caps());
  if (host) Overlay.sync(state && state.ok ? state : null, Panel.layers, { ...host, ...t });
}

try {
  if (typeof window !== 'undefined') {
    window.MythicPower = API;
    /* node-city may finish booting before or after this module evaluates —
       module scripts are deferred, and the host's boot() is inside another
       module script whose order is not guaranteed relative to this one. So the
       host calls mount() when IT is ready, and this line only announces that
       the API exists. Same handshake /src/economy uses. */
    if (typeof window.__ncPowerReady === 'function') window.__ncPowerReady(API);
  }
} catch (e) {}

export default API;
