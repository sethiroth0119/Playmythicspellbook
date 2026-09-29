/* ══════════════════════════════════════════════════════════════════════════
   🚌 BUS COMPANIES, TRAIN STATIONS AND PLAYER-BUILT ROUTES — the mount.
   ──────────────────────────────────────────────────────────────────────────
   Registered as `window.MythicTransit`, exactly the way /src/economy,
   /src/city/stadium.city.js and /src/resonance/house.city.js are. node-city
   hooks it in a handful of small places and every one of those hooks is
   guarded: if this module 404s the player loses transit and NOTHING ELSE.

   ══ HOW THE FEATURE FITS TOGETHER ═════════════════════════════════════════
   1. TWO PURCHASES, through the mechanism that already sells a company. A BUS
      COMPANY (2,000,000 🔥) and a RAIL OPERATOR (10,000,000 🔥) are rows in
      `OPS_ECON` in public/index.html — the one place operation pricing lives —
      bought at City Hall / Just Business like a Construction Co., read through
      `_opEcon()`, retunable from the admin Operations Economy editor, and
      carrying their own worker salaries (the upkeep every other operation
      pays). node-city receives the price over the existing ops bridge.
   2. THE LICENCE IS THE GATE. Owning the row is what lets you place stops,
      stations and track, and what lets a line run. Lose it and the lines halt
      and say so; the buildings stay standing.
   3. STOPS, STATIONS AND TRACK are ordinary city buildings bought with city
      Cinder, with real meshes (see mesh.js).
   4. ROUTES are drawn by the player: pick a line, click stops in order, close
      the loop or leave it open, name it, colour it. A bus line follows the
      ROAD graph between its stops; a rail line follows TRACK the player lays.
      Both use node-city's own bfsPath.
   5. VEHICLES are entries in node-city's own `agents[]`, moved by its own
      `agentTick`. This module supplies only the next leg and the dwell.
   6. IT CHANGES THE SIMULATION, and the citizen half of that is the point:
      a job nobody can reach goes UNFILLED, and a line that reaches both ends
      of the commute is what makes it fillable (routes.jobAccess() →
      /src/demographics → households.hire()). On top of that a served commute
      is made by transit, so the private cars come off the streets and the
      pedestrians walk to stops.
   7. UPKEEP: stops, stations, track and every running vehicle cost city Cinder
      every tick, and fares can only ever reduce that bill, never reverse it.

   🔴 THE GLOBALS TRAP (CLAUDE.md), for the sixth module to hit it: `game`,
   `BUILDINGS`, `agents`, `bfsPath`, `box`, `cyl`, `MAT`, `cityPop` and
   `MythicCityBridge` are top-level `const` in node-city's module script and
   are invisible here. The ctx object node-city builds by hand IS the
   hand-over. There is no `window.game` and there never will be.
   ══════════════════════════════════════════════════════════════════════════ */

import { TRANSIT_ECON, LINE_COLORS, MODE_IDS } from './tuning.js';
import * as MESH from './mesh.js';
import * as R from './routes.js';
import * as PANEL from './panel.js';

let C = null;

/* Which of the four neighbours this track tile should throw a rail towards.
   A STATION counts as a connection: a platform with the rails stopping one
   tile short of it looks like a bug, and it is the join a player will make
   most often. */
function trackCon(x, z) {
  const at = (dx, dz) => {
    const t = C.game.tiles[(x + dx) + ',' + (z + dz)];
    return !!t && (t.type === 'railtrack' || t.type === 'trainstation');
  };
  return { n: at(0, -1), s: at(0, 1), e: at(1, 0), w: at(-1, 0) };
}

/* The mesh delegate. node-city's buildMesh wrapper calls this FIRST and falls
   through to its own switch when we return null, so an unknown type can never
   become an invisible group here. */
function meshFor(type, lvl, tx, tz) {
  const L = Math.max(1, lvl | 0);
  switch (type) {
    case 'busstop':      return MESH.makeBusstop(L);
    case 'trainstation': return MESH.makeTrainstation(L);
    case 'railtrack':    return MESH.makeRailtrack(L, trackCon(tx | 0, tz | 0));
    case 'op_bus': case 'busdepot':  return MESH.makeBusdepot(L);
    case 'op_rail': case 'railops':  return MESH.makeRailops(L);
    default: return null;
  }
}

/* Rebuild a track tile and its four neighbours so a newly-laid piece joins up.
   Same shape as node-city's refreshRoadArea, and for the same reason: the
   recipe reads its neighbours, so a neighbour changing means the recipe is
   stale. Kept here rather than hooked into refreshRoadArea because rail is not
   road and must not ride the road refresh. */
function refreshTrackAt(x, z) {
  const k = x + ',' + z;
  const t = C.game.tiles[k];
  if (!t || t.type !== 'railtrack') return;
  try { C.dropTileMesh(t); } catch (e) {}
  t.mesh = MESH.makeRailtrack(Math.max(1, t.lvl | 0), trackCon(x, z));
  try { C.placeMeshAt(t.mesh, x, z, t.rot | 0); } catch (e) {}
}
function refreshTrackArea(x, z) {
  refreshTrackAt(x, z);
  for (const [dx, dz] of C.NEI) refreshTrackAt(x + dx, z + dz);
}

/* ── the dossier button ───────────────────────────────────────────────────
   Returned to node-city's openInspect wrapper. Every transit building opens
   the same authority panel — a stop's dossier that cannot reach the line it
   is on would be a dead end. */
function inspectAction(k) {
  const t = C.game.tiles[k]; if (!t) return null;
  const TY = { busstop: 1, trainstation: 1, railtrack: 1, op_bus: 1, op_rail: 1 };
  if (!TY[t.type]) return null;
  const on = R.state.lines.filter(L => (L.stops || []).indexOf(k) >= 0);
  let note;
  if (t.type === 'railtrack') {
    note = R.state.lines.filter(L => L.mode === 'rail').length
      ? 'Track. Lay a continuous run between your stations and the trains will follow it.'
      : 'Track. It carries nothing until a rail line calls at stations either end of it.';
  } else if (t.type === 'op_bus' || t.type === 'op_rail') {
    note = 'Your ' + (t.type === 'op_bus' ? 'bus depot' : 'rail control') +
      '. The fleet is dispatched from the routes you draw.';
  } else if (on.length) {
    note = 'Served by ' + on.map(L => L.name).join(', ') + '.';
  } else {
    note = 'Not on any line yet — open the Transit Authority and add it to a route.';
  }
  return { label: '🚌 Transit Authority', note, run: () => PANEL.open() };
}

/* ══ MOUNT ════════════════════════════════════════════════════════════════ */
export function mount(ctx) {
  C = ctx || {};
  if (typeof C.now !== 'function') C.now = () => Date.now();
  MESH.init(C); R.init(C); PANEL.init(C);

  const API = {
    ECON: TRANSIT_ECON, COLORS: LINE_COLORS, MODES: MODE_IDS,
    state: R.state,

    /* — hooks node-city calls — */
    mesh: meshFor,
    isTrack: R.isTrack,
    advance: (a) => R.advance(a),
    manage: () => { try { R.manage(); } catch (e) { console.warn('[transit] manage', e); } },
    adjustAgentCounts: (w) => { try { R.adjustAgentCounts(w); } catch (e) {} },
    endpoints: (kind, agent, base) => { try { return R.endpoints(kind, agent, base); } catch (e) { return null; } },
    onTileClick: (k) => { try { return PANEL.onTileClick(k); } catch (e) { return false; } },
    inspectAction,
    /* Called after a successful placement or a demolish of one of our types. */
    onPlaced: (type, x, z) => {
      try {
        if (type === 'railtrack' || type === 'trainstation') refreshTrackArea(x | 0, z | 0);
        R.markDirty(); R.rebuildOverlay(); R.manage(); R.recompute(true);
        if (PANEL.isOpen()) PANEL.render();
      } catch (e) { console.warn('[transit] onPlaced', e); }
    },
    /* The economy beat: charge the subsidy, keep the panel honest. */
    tick: async (dtMin) => {
      try { await R.moneyTick(dtMin); } catch (e) { console.warn('[transit] tick', e); }
      try { PANEL.tick(); } catch (e) {}
    },

    /* — persistence. Absent-tolerant by construction; see routes.load(). — */
    save: () => { try { return R.save(); } catch (e) { return null; } },
    load: (raw) => {
      try { R.load(raw); R.rebuildOverlay(); R.manage(); }
      catch (e) { console.warn('[transit] load', e); }
    },

    /* — player-facing / diagnostics — */
    open: () => PANEL.open(),
    close: () => PANEL.close(),
    picking: () => PANEL.picking(),
    report: (force) => R.recompute(!!force),
    /* 🚶 THE CITIZEN WIRE. /src/demographics reads this every time the economy
       hires, and it is guarded on BOTH sides: a 404 on transit leaves
       `window.MythicTransit` undefined and demographics reads full access, so
       hiring behaves exactly as it did before this existed. See
       TRANSIT_ECON.commute and routes.jobAccess(). */
    jobAccess: (force) => { try { return R.jobAccess(!!force); } catch (e) { return null; } },
    ledger: () => { R.recompute(true); return R.ledger(); },
    lines: () => R.state.lines,
    newLine: (mode) => { const L = R.newLine(mode); R.markDirty(); R.rebuildOverlay(); R.manage(); return L; },
    addStop: (id, k) => { const r = R.toggleStop(id, k); R.markDirty(); R.rebuildOverlay(); R.manage(); R.recompute(true); return r; },
    removeLine: (id) => R.removeLine(id),
    setShow: (on) => R.setShow(on),
    hasLicence: R.hasLicence,
    vehicles: () => C.agents.filter(a => a && a.line),
  };

  try { window.MythicTransit = API; } catch (e) {}
  try { PANEL.mountButton(); } catch (e) {}
  return API;
}
