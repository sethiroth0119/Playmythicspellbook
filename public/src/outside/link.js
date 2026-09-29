/* ============================================================================
   🛣 OUTSIDE CONNECTIONS — the connection test, and the grandfather migration.
   ============================================================================
   THE TEST, in one sentence: a connection building has to stand in the right
   band of the map, be undamaged, have a road touching it, and that road has to
   reach the rest of the city's road network.

   🔴 THIS FILE WRITES NO BFS. index.html already owns the road graph —
      `bfsPath(startK, goalK)` and `isRoad(x,z)` — and a second traversal here
      would be a second definition of what "connected" means, guaranteed to
      drift the first time road tiles gain a property. Everything below is
      handed those functions and calls them.

   ⏱ AND IT IS NOT RUN PER FRAME. index.js caches the result and drops the
      cache from `refreshRoadArea`, which is the choke point every road
      placement, demolition and load already funnels through.
   ============================================================================ */

import { MODES, GATE, RAIL, ICH } from './tuning.js';
/* 🛣 The road resolver. ⚠ The migration below still PLACES the legacy 'road'
   type on purpose — it is a repair, not a design choice, and it must produce
   the same tile every existing city already has. What the resolver is for here
   is READING: a city reconnected through a Lane is still connected. */
import { isRoadTile } from '../roads/types.js';

/* Every tile that is a real, road-served part of the city — i.e. the thing an
   outside connection has to be able to reach. Anchors are world features, roads
   are the graph itself, and decoration is not a reason to keep trading. */
function isCityBuilding(C, t) {
  if (!t || isRoadTile(t) || t.type === 'anchor') return false;
  const def = C.BUILDINGS[t.type];
  if (!def || def.decor) return false;
  return true;
}

/** Road tiles that touch something worth connecting to, EXCLUDING the
    connection buildings themselves — otherwise an interchange sitting on its
    own in a field would prove itself connected to itself. */
function cityRoads(C) {
  const conn = new Set(MODES.map(m => m.building));
  const out = [];
  const seen = new Set();
  for (const k in C.game.tiles) {
    const t = C.game.tiles[k];
    if (!isCityBuilding(C, t) || conn.has(t.type)) continue;
    const p = k.split(','), x = +p[0], z = +p[1];
    for (const d of C.NEI) {
      const nx = x + d[0], nz = z + d[1];
      if (!C.isRoad(nx, nz)) continue;
      const nk = C.key(nx, nz);
      if (seen.has(nk)) continue;
      seen.add(nk); out.push({ k: nk, x: nx, z: nz });
    }
  }
  return out;
}

function adjacentRoads(C, x, z) {
  const out = [];
  for (const d of C.NEI) if (C.isRoad(x + d[0], z + d[1])) out.push(C.key(x + d[0], z + d[1]));
  return out;
}

function inBand(C, mode, z, x) {
  if (mode.band === 'n') return z <= (mode.bandTiles - 1);
  if (mode.band === 's') return z >= C.GRID - mode.bandTiles;
  return true;
}

/* How many bfsPath() calls one mode may spend proving itself. A connected city
   answers on the first or second try; only a genuinely severed one walks the
   whole list, and that is the case we are allowed to spend a little on. */
const MAX_PROBES = 48;

function testMode(C, mode, cityR) {
  const res = { id: mode.id, ico: mode.ico, label: mode.label, ok: false, why: '', fix: mode.fix, where: null };
  const all = [];
  for (const k in C.game.tiles) {
    const t = C.game.tiles[k];
    if (!t || t.type !== mode.building) continue;
    const p = k.split(','); all.push({ k, x: +p[0], z: +p[1], t });
  }
  if (!all.length) {
    res.why = 'No ' + mode.buildingName + ' has been built.';
    return res;
  }
  const banded = all.filter(b => inBand(C, mode, b.z, b.x));
  if (!banded.length) {
    const b = all[0];
    res.why = 'The ' + mode.buildingName + ' at ' + b.k + ' is too far inland to reach the '
            + (mode.band === 'n' ? 'highway' : 'mainline') + '.';
    return res;
  }
  const live = banded.filter(b => !b.t.damaged);
  if (!live.length) {
    res.where = banded[0].k;
    res.why = 'The ' + mode.buildingName + ' at ' + banded[0].k + ' is DAMAGED — repair it.';
    res.fix = 'Repair the ' + mode.buildingName + ' at ' + banded[0].k + '.';
    return res;
  }

  let sawRoad = false;
  for (const b of live) {
    const roads = adjacentRoads(C, b.x, b.z);
    if (!roads.length) continue;
    sawRoad = true;
    res.where = b.k;
    /* Nothing on the network yet ⇒ there is nothing the connection could fail
       to reach. Saying "cut off" here would be a refusal aimed at an empty
       city, and the first Caravan Post the player raises puts a real answer in
       cityR the moment it lands beside a road. */
    if (!cityR.length) { res.ok = true; res.why = 'Linked — the city has nothing else on the road network yet.'; return res; }
    // Nearest first: the answer is almost always one or two probes away.
    const cand = cityR.slice().sort((p, q) =>
      (Math.abs(p.x - b.x) + Math.abs(p.z - b.z)) - (Math.abs(q.x - b.x) + Math.abs(q.z - b.z)));
    let probes = 0;
    for (const r of roads) {
      for (const c of cand) {
        if (++probes > MAX_PROBES) break;
        if (C.bfsPath(r, c.k)) {
          res.ok = true;
          res.why = 'Linked at tile ' + b.k + '.';
          return res;
        }
      }
      if (probes > MAX_PROBES) break;
    }
  }
  if (!sawRoad) {
    res.where = live[0].k;
    res.why = 'The ' + mode.buildingName + ' at ' + live[0].k + ' has no road touching it.';
    res.fix = 'Lay a 🛤️ Road against the ' + mode.buildingName + ' at ' + live[0].k + ', and run it into your city.';
    return res;
  }
  res.why = 'The ' + mode.buildingName + ' at ' + res.where + ' sits on its own stretch of road — nothing joins it to the city.';
  res.fix = 'Join the ' + mode.buildingName + ' at ' + res.where + ' to your street grid with 🛤️ Road. The two stretches must actually touch.';
  return res;
}

/** Count the tiles a player has actually put down (anchors are ours, not
    theirs). Used by the empty-city rule in status.js. */
export function cityTileCount(C) {
  let n = 0;
  for (const k in C.game.tiles) if (C.game.tiles[k].type !== 'anchor') n++;
  return n;
}

/** THE STATE. Pure — no DOM, no scene, no side effects. */
export function compute(C, waivedUntil) {
  const cityR = cityRoads(C);
  const modes = MODES.map(m => testMode(C, m, cityR));
  const live = modes.find(m => m.ok) || null;
  const tiles = cityTileCount(C);
  const waived = !live && !!waivedUntil && Date.now() < waivedUntil;
  const first = modes[0];
  return {
    connected: !!live || waived,
    real: !!live,
    waived,
    waivedUntil: waivedUntil || 0,
    via: live ? live.id : (waived ? 'grandfathered' : null),
    viaLabel: live ? live.label : (waived ? 'Grandfathered' : null),
    tiles,
    modes,
    reason: live ? live.why : (first ? first.why : ''),
    fix: live ? '' : (first ? first.fix : ''),
  };
}

/* ══ THE GRANDFATHER MIGRATION ════════════════════════════════════════════════
   A city that was trading yesterday must not wake up cut off. On load, a save
   with tiles but no interchange gets one placed FOR it, plus the shortest run
   of road needed to reach the network.

   ⚠ IT NEVER DEMOLISHES ANYTHING. Only empty tiles are written. If the north
     edge is built up wall to wall, or the city has no roads at all, the
     migration reports what it could not do and index.js waives the gate for
     GATE.graceMs instead — a waiver that EXPIRES beats a city that is bricked.

   ⚠ IT IS IDEMPOTENT BY CONSTRUCTION. What it places is an ordinary tile, so
     the very next serialize() carries it and the migration never sees this city
     again. No version flag, no new required save field.
   ═══════════════════════════════════════════════════════════════════════════ */
export function migrate(C) {
  const rep = { ran: true, placed: null, roads: [], blocked: '', note: '' };
  const G = C.GRID;

  // Already has one? Nothing to do — this is the second-load path.
  for (const k in C.game.tiles) if (C.game.tiles[k].type === ICH.type) { rep.ran = false; return rep; }
  if (cityTileCount(C) === 0) { rep.ran = false; rep.note = 'new city'; return rep; }

  // Where is the city, roughly? Ties break toward it so the ramp lands near the
  // built-up part of the map rather than in a corner.
  let cx = 0, n = 0;
  for (const k in C.game.tiles) {
    const t = C.game.tiles[k]; if (t.type === 'anchor') continue;
    cx += +k.split(',')[0]; n++;
  }
  cx = n ? cx / n : G / 2;

  /* For every candidate column, walk south from z=1 and count the empty tiles
     before the first road. A building in the way disqualifies the column — we
     will not tunnel a road through somebody's factory. */
  let best = null;
  for (let x = ICH.margin; x < G - ICH.margin; x++) {
    if (C.game.tiles[C.key(x, ICH.edgeZ)]) continue;               // the edge tile must be free
    const run = [];
    let hit = false;
    for (let z = ICH.edgeZ + 1; z < G; z++) {
      const t = C.game.tiles[C.key(x, z)];
      if (isRoadTile(t)) { hit = true; break; }
      if (t) break;                                                 // blocked by a building
      run.push(z);
      if (run.length > GATE.migrateMaxRoads) break;
    }
    if (!hit || run.length > GATE.migrateMaxRoads) continue;
    const score = run.length * 100 + Math.abs(x - cx);
    if (!best || score < best.score) best = { x, run, score };
  }

  if (!best) {
    /* No column works. Place the interchange anyway on the freest north-edge
       tile so the player has something to run road TO, and let the caller
       waive. Placing it is strictly better than not: it is the thing they would
       otherwise have to find in the build menu. */
    for (let d = 0; d < G; d++) {
      for (const x of [Math.round(cx) - d, Math.round(cx) + d]) {
        if (x < ICH.margin || x >= G - ICH.margin) continue;
        if (C.game.tiles[C.key(x, ICH.edgeZ)]) continue;
        rep.placed = C.place(ICH.type, x, ICH.edgeZ);
        rep.blocked = 'no clear column from the north edge to your road network';
        return rep;
      }
    }
    rep.blocked = 'the whole north edge is built up';
    return rep;
  }

  rep.placed = C.place(ICH.type, best.x, ICH.edgeZ);
  for (const z of best.run) rep.roads.push(C.place('road', best.x, z));
  return rep;
}

/** Where a qualifying Rail Yard is, if any — the spur mesh needs its tile. */
export function railSpurTile(C) {
  for (const k in C.game.tiles) {
    const t = C.game.tiles[k];
    if (!t || t.type !== 'railyard' || t.damaged) continue;
    const p = k.split(','), x = +p[0], z = +p[1];
    if (z >= C.GRID - RAIL.band) return { k, x, z };
  }
  return null;
}
