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

let host = null;          // the last host snapshot handed over
let state = null;         // the last solve
let store = 0;            // battery charge, in unit-minutes. Persisted.
let mounted = false;
let warned = false;

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
  return out;
}
/* One-slot memo. Keyed on the module OBJECT so a remount — or /src/water
   arriving after this panel first opened — invalidates it without a listener. */
const _endow = { src: null, val: null };

/* ── THE PUBLIC API ─────────────────────────────────────────────────────── */
const API = {
  ready: () => mounted,

  /* Called ONCE from boot, with THREE + the scene for the overlay and nothing
     else. Everything about the CITY arrives per-tick through solve(). */
  mount(h) {
    if (mounted) return true;
    try {
      Panel.mount(h, { onLayers: () => { Overlay.repaintNext(); refresh(); }, close: () => API.closePanel() });
      Overlay.mount(h);
      mounted = true;
      return true;
    } catch (e) { warnOnce('mount failed: ' + (e && e.message)); return false; }
  },

  /* ── THE TICK. The host's power pre-pass calls this and assigns the result
     straight into `game.power`. Returns null if it cannot answer, and the host
     then keeps its own inline maths — see the fallback badge in panel.js. */
  solve(snapshot) {
    if (!snapshot) return null;
    try {
      host = snapshot;
      const s = Grid.solve(snapshot, store);
      if (!s.ok) { warnOnce(s.why || 'solve refused'); state = s; return null; }
      store = s.store.charge;
      state = s;
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
    return { capacity: state.capacity, load: state.load, factor: state.factor,
             byPlant: state.byPlant.map(p => ({ ...p })) };
  },

  state: () => state,
  topology: () => Grid.topology(),
  layers: Panel.layers,

  openPanel() { if (!mounted) return false; Panel.show(state, caps()); refresh(); return true; },
  closePanel() { Panel.hide(); Overlay.hide(); return true; },
  togglePanel() { return Panel.isOpen() ? API.closePanel() : API.openPanel(); },
  panelOpen: () => Panel.isOpen(),

  /* ── SAVE. One number. Optional-with-default on load, so every existing save
     opens with an empty buffer and nothing else changes. */
  save: () => ({ store }),
  load(blob) {
    const v = blob && Number(blob.store);
    store = isFinite(v) && v >= 0 ? v : 0;
    Grid.invalidate();
  },

  tuning: POWER,
};

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
