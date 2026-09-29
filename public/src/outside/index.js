/* ============================================================================
   🛣 OUTSIDE CONNECTIONS — "your city must be connected to the highway."
   ============================================================================
   Registers `window.MythicOutside`. Mounted from node-city/index.html's boot(),
   after loadState() so the migration can see the tiles that came off disk.

   WHAT THIS OWNS
     • tuning.js — every number, once (the `_opEcon()` pattern)
     • mesh.js   — the highway that runs past the map, the rail mainline, the
                   ramps, and the tile mesh for the Highway Interchange
     • link.js   — the connection test (built on index.html's OWN bfsPath) and
                   the grandfather migration
     • hud.js    — the chip that says connected / cut off, and what to build
     • status.js — the localStorage record the MAIN APP reads, because the
                   Resource Exchange lives in a different document

   🔴 THE GLOBALS TRAP (CLAUDE.md). `game`, `BUILDINGS`, `scene`, `THREE`,
      `bfsPath`, `isRoad`, `key`, `NEI`, `toast`, `logEvent` are all top-level
      `const` in node-city's module script and are invisible from here. The ctx
      object handed to mount() IS the hand-over. There is no `window.game` and
      there never will be. Everything below reads C.* and nothing else.

   🔴 IT MUST DEGRADE. A 404 on any file in this folder costs the player the
      highway, the chip and the gate — and nothing else. index.html's mount is
      inside a try/catch, every hook is `window.MythicOutside && …`, and
      `buildMesh` falls through to the `mesh:` alias on the BUILDINGS entry so
      an interchange already standing in a save still renders as a building
      rather than as an empty group.
   ============================================================================ */

import { HW, RAIL, ICH, GATE, MODES } from './tuning.js';
import * as Mesh from './mesh.js';
import * as Link from './link.js';
import * as HUD from './hud.js';
import * as Status from './status.js';

let C = null;                 // the ctx handed over by index.html
let M = null;                 // materials
let G = null;                 // our scenery group (highway + rail + ramps)
let _ramps = null, _spur = null, _guard = null;
let _cache = null;            // the cached connection state
let _waivedUntil = 0;
let _gfStamp = 0;             // when the migration ran (rides the save as oc.gf)
let _nagAt = 0;
let _lastConnected = null;    // for the transition log

const log = (m) => { try { C && C.logEvent && C.logEvent('city', m); } catch (e) {} };
const say = (m, k) => { try { C && C.toast && C.toast(m, k); } catch (e) {} };

/* ── scenery ───────────────────────────────────────────────────────────────── */
function disposeGroup(g) {
  if (!g) return;
  try {
    g.traverse(o => { if (o.geometry) { try { o.geometry.dispose(); } catch (e) {} } });
    if (g.parent) g.parent.remove(g);
  } catch (e) {}
}

/* Rebuild the ramps and the rail spur to match the tiles as they stand.
   Called from the same place the cache is filled, so the geometry can never
   disagree with the state the HUD is printing. */
function syncScenery(st) {
  try {
    const T = C.THREE;
    /* Read the tile store, NOT st.modes[0].where — the ramps belong to the
       interchange BUILDING, not to the connection. A player who has built the
       interchange but not yet laid road to it must still see the slip roads
       standing there; that is the whole point of the feedback. */
    let wantR = null;
    for (const k in C.game.tiles) {
      if (C.game.tiles[k].type !== ICH.type) continue;
      if (+k.split(',')[1] === ICH.edgeZ) { wantR = k; break; }
    }
    if (_ramps && _ramps.__k !== wantR) { disposeGroup(_ramps); _ramps = null; }
    if (wantR && !_ramps) {
      const x = +wantR.split(',')[0];
      _ramps = Mesh.buildRamps(T, M, x - C.HALF + .5, ICH.edgeZ - C.HALF);
      _ramps.__k = wantR; G.add(_ramps);
    }
    /* The city-side guardrail is rebuilt with the ramps because it has to carry
       the gap they merge through — see buildNearGuard's header. Keyed on the
       same tile, so it is rebuilt exactly when the ramps are and never on a
       repaint. */
    if (!_guard || _guard.__k !== wantR) {
      disposeGroup(_guard);
      _guard = Mesh.buildNearGuard(T, M, wantR ? (+wantR.split(',')[0]) - C.HALF + .5 : null);
      _guard.__k = wantR; G.add(_guard);
    }
    const rail = Link.railSpurTile(C);
    const wantS = rail ? rail.k : null;
    if (_spur && _spur.__k !== wantS) { disposeGroup(_spur); _spur = null; }
    if (wantS && !_spur) {
      _spur = Mesh.buildRailSpur(C.THREE, M, rail.x - C.HALF + .5, rail.z - C.HALF + .5);
      _spur.__k = wantS; G.add(_spur);
    }
  } catch (e) { console.warn('[outside] scenery', e); }
}

/* ── state ─────────────────────────────────────────────────────────────────── */
function state() {
  if (_cache) return _cache;
  if (!C) return { connected: true, modes: [], fix: '', reason: '', waived: false, waivedUntil: 0, via: null, viaLabel: null, tiles: 0, real: true };
  let st;
  try { st = Link.compute(C, _waivedUntil); }
  catch (e) {
    /* A throw in the test must never brick trade. Fail OPEN and say so — the
       opposite choice turns one bad tile into a player who cannot trade and
       cannot find out why. */
    console.warn('[outside] link test failed — failing open', e);
    st = { connected: true, real: true, waived: false, waivedUntil: 0, via: 'error', viaLabel: 'Unknown',
           tiles: 0, modes: [], reason: 'The connection test could not run.', fix: '' };
  }
  _cache = st;
  syncScenery(st);
  try { Status.publish({ connected: st.connected, tiles: st.tiles, via: st.via, reason: st.reason, fix: st.fix }); } catch (e) {}
  // One line in the city log on each real transition, never on a repaint.
  if (_lastConnected !== null && _lastConnected !== st.connected) {
    if (st.connected) log('🛣 Outside connection RESTORED — ' + (st.viaLabel || 'the highway') + ' is linked. Trade with other cities is open again.');
    else log('⛔ Outside connection LOST — ' + st.reason + ' Nothing can leave the city until it is fixed.');
  }
  _lastConnected = st.connected;
  return st;
}

function invalidate() { _cache = null; }

/* ── the gate ──────────────────────────────────────────────────────────────────
   The refusal style is copied straight from tryPlace()'s road-cap message: say
   WHAT is refused, WHY, and exactly what raises the gate. "Cannot trade" on its
   own reads as a bug and gets reported as one. */
const SUBJECT = {
  caravan:  'No caravan can leave the city',
  shipment: 'Nothing can be shipped out of the city',
  trade:    'No cross-city deal can settle',
  lease:    'No plot can be leased to another player',
};
function gate(kind) {
  const st = state();
  if (st.connected) return { ok: true, msg: '' };
  const subj = SUBJECT[kind] || 'Cross-city business is stopped';
  return { ok: false, code: 'NO_OUTSIDE_LINK',
           msg: '⛔ ' + subj + ' — it has no outside connection. ' + st.reason + ' ' + st.fix };
}
/* The AUTOMATIC paths (the caravan tick) call this instead of toasting on every
   beat. A four-minute drum of the same refusal is noise, and noise is how a
   player learns to ignore the one message that mattered. */
function nag(kind) {
  const g = gate(kind);
  if (g.ok) return g;
  const now = Date.now();
  if (now - _nagAt >= GATE.nagEveryMs) {
    _nagAt = now;
    say(g.msg, 'bad');
    log(g.msg);
  }
  return g;
}

/* ── placement rule ────────────────────────────────────────────────────────── */
function placeCheck(x, z) {
  if (z !== ICH.edgeZ) {
    return { ok: false, msg: '🛣 The highway runs past the NORTH side of the map, so an interchange can only be built on the north edge — the top row of tiles (z = ' +
      ICH.edgeZ + '). This square is z = ' + z + '. Nothing else on the map can reach the carriageway.' };
  }
  if (x < ICH.margin || x >= C.GRID - ICH.margin) {
    return { ok: false, msg: '🛣 Too close to the corner. The on-ramp and the off-ramp each need about ' +
      Math.ceil(ICH.ramp.reach) + ' tiles of run along the embankment, so keep the interchange at least ' +
      ICH.margin + ' tile' + (ICH.margin > 1 ? 's' : '') + ' in from the ends of the north edge.' };
  }
  return { ok: true, msg: '' };
}

/* ── the grandfather migration ─────────────────────────────────────────────── */
function runMigration() {
  let rep;
  try { rep = Link.migrate(C); }
  catch (e) { console.warn('[outside] migration', e); return; }
  if (!rep.ran) return;

  _gfStamp = Date.now();
  invalidate();
  const st = state();

  if (rep.placed && st.real) {
    const r = rep.roads.filter(Boolean).length;
    log('🛣 Outside Connections is new. This city predates it, so a Highway Interchange was placed on the north edge for you'
      + (r ? ', with ' + r + ' road tile' + (r > 1 ? 's' : '') + ' laid to reach your network' : '')
      + ' — your caravans keep running. Move it if you would rather it sat somewhere else.');
    say('🛣 A Highway Interchange was placed for you on the north edge — your city keeps its trade routes.', 'good');
    /* ⚠ The migration can push an established city over its road maintenance
       cap. That is a warning, never a failure — the alternative is refusing to
       connect the city at all, which is the thing we are here to prevent. */
    try {
      if (r && C.roadUsed && C.roadCap && C.roadUsed() > C.roadCap())
        log('🛤️ …that put the road network over its maintenance cap (' + C.roadUsed() + '/' + C.roadCap() +
            '). Build a 📦 Supply Depot to raise it.');
    } catch (e) {}
  } else {
    /* Could not connect it. WAIVE, and say so out loud — a live trading city
       must not wake up cut off, and a waiver that expires is the honest middle
       between bricking them and letting them off forever. */
    _waivedUntil = _gfStamp + GATE.graceMs;
    invalidate();
    log('🛣 Outside Connections is new, and this city could not be linked automatically ('
      + (rep.blocked || 'no route from the north edge to your roads')
      + '). Trade stays OPEN until ' + new Date(_waivedUntil).toLocaleDateString()
      + ' — build a Highway Interchange on the north edge and run road to it before then.');
    say('🛣 Your city has no outside connection yet. Trade stays open for now — build a Highway Interchange on the north edge.', 'bad');
  }
  try { C.saveSoon && C.saveSoon(); } catch (e) {}
}

/* ── mount ─────────────────────────────────────────────────────────────────── */
export function mount(ctx) {
  C = ctx || {};
  for (const need of ['THREE', 'scene', 'game', 'BUILDINGS', 'GRID', 'HALF', 'key', 'isRoad', 'NEI', 'bfsPath', 'place'])
    if (!C[need]) throw new Error('[outside] ctx is missing ' + need);

  M = Mesh.makeMats(C.THREE);
  G = new C.THREE.Group(); G.name = 'outside-connections';
  C.scene.add(G);

  /* The highway exists whether or not the player ever joins it. That is the
     whole point of the reference frame: it is the thing you can SEE you are not
     connected to. Same for the rail line. */
  try { G.add(Mesh.buildHighway(C.THREE, M)); } catch (e) { console.warn('[outside] highway', e); }
  try { G.add(Mesh.buildRailLine(C.THREE, M)); } catch (e) { console.warn('[outside] rail', e); }

  /* The waiver stamp off the save. Absent on every save written before this
     feature and on every city that never needed one — 0 is the correct reading
     ("no waiver"), and a corrupted value cannot grant a permanent exemption
     because it is clamped to one grace period from when it was written. */
  try {
    const oc = C.game.oc;
    if (oc && typeof oc === 'object' && Number.isFinite(+oc.gf) && +oc.gf > 0) {
      _gfStamp = Math.min(+oc.gf, Date.now());
      if (oc.w) _waivedUntil = _gfStamp + GATE.graceMs;
    }
  } catch (e) {}

  runMigration();
  const st = state();
  HUD.render(st);

  const API = {
    version: 'outside-1',
    /* read */
    state, invalidate, gate, nag, placeCheck,
    connected: () => state().connected,
    /* the tile recipe, handed back to index.html's buildMesh */
    buildMesh: (lvl) => { try { return Mesh.buildTileMesh(C.THREE, M, lvl || 1); } catch (e) { return null; } },
    /* the HUD, driven from updateHUD() */
    hud: () => { try { HUD.render(state()); } catch (e) {} },
    panel: () => HUD.toggle(state()),
    /* the save field. `null` when there is nothing to remember, so a city that
       never needed a migration does not grow its save by a byte. */
    save: () => (_gfStamp ? { gf: Math.round(_gfStamp), w: _waivedUntil ? 1 : 0 } : null),
    /* seams for tests and for the main app */
    status: Status, tuning: { HW, RAIL, ICH, GATE, MODES },
    group: () => G,
    ctx: () => C,
  };
  try { window.MythicOutside = API; } catch (e) {}
  return API;
}

export default { mount };
