/* ═══════════════════════════════════════════════════════════════════════════
   haul.map.js — ROUTES ON THE CITY NODE MAP.

   A haul's length is not a number somebody typed on the job; it is the road
   distance between two cities on the same map City Nodes draws. Cities are the
   Territory-War nodes (position + supply-line connections), handed over by the
   bridge. The route is the SHORTEST PATH along connections (Dijkstra), so a
   haul between two cities with no road between them goes the long way round —
   and if the graph is disconnected at all we fall back to straight-line so a
   job can always be priced.

   ⚠ Pure module: no I/O, no globals. Positions are map percentages (0..100)
     and MAP_KM is the one scale that turns them into kilometres. It is the
     only place that decides how long "across the map" is, and the 3D run and
     the fare both read the same km, so neither can drift from the other.
   ═══════════════════════════════════════════════════════════════════════════ */

/* One map percentage-unit = this many km. The starter map is ~75 units wide,
   but routes follow SUPPLY LINES and the seed graph is sparse, so the longest
   road route (KILN-7 → LAST WICK, eight hops) is ~330 units against a shortest
   neighbour hop of ~26. At 1 km per unit that reads as 26 km … 330 km, which
   is the spread the fare and the run length are tuned around below. */
export const MAP_KM = 1.0;

/* 🗺 THE BUILT-IN MAP — a copy of _twSeedStarterData's 16 cities and 16 supply
   lines, used ONLY when the bridge hands us nothing (a test page, or a map
   an admin has emptied). It must stay in step with index.html's seed: a route
   priced against this map and driven against the game's would be two lengths. */
export const FALLBACK_CITIES = (() => {
  const names = ['KILN-7', 'EMBERFALL', 'SALTGATE', 'BREAKWATER', 'BLACKHARROW', 'IRONLUNG',
                 'HOLLOW SEPT', 'ROOKSWAY', 'GREYMARSH', 'CINDER FORK', 'LATHE-9', 'MIRRORWELL',
                 'DUSTHAVEN', 'CARRION GAP', 'VEINSHEAR', 'LAST WICK'];
  const pos = [
    { x: 12, y: 22 }, { x: 38, y: 18 }, { x: 66, y: 20 }, { x: 16, y: 54 }, { x: 42, y: 52 }, { x: 70, y: 56 },
    { x: 22, y: 34 }, { x: 50, y: 26 }, { x: 78, y: 24 }, { x: 26, y: 66 }, { x: 56, y: 66 }, { x: 82, y: 64 },
    { x: 30, y: 42 }, { x: 44, y: 36 }, { x: 86, y: 35 }, { x: 18, y: 76 },
  ];
  const routes = [
    ['N-01', 'N-02'], ['N-02', 'N-03'], ['N-03', 'N-04'], ['N-04', 'N-12'],
    ['N-01', 'N-05'], ['N-05', 'N-06'], ['N-06', 'N-15'], ['N-07', 'N-08'],
    ['N-07', 'N-09'], ['N-09', 'N-13'], ['N-10', 'N-11'], ['N-11', 'N-14'],
    ['N-13', 'N-16'], ['N-14', 'N-15'], ['N-08', 'N-10'], ['N-02', 'N-11'],
  ];
  const cities = names.map((n, i) => ({ id: 'N-' + String(i + 1).padStart(2, '0'), name: n, x: pos[i].x, y: pos[i].y, connections: [], sector: '', region: '', owned: false, mine: false }));
  const byId = {}; cities.forEach((c) => { byId[c.id] = c; });
  for (const [a, b] of routes) { if (byId[a] && byId[b]) { byId[a].connections.push(b); byId[b].connections.push(a); } }
  return cities;
})();

export function normalizeCities(list) {
  const out = (Array.isArray(list) ? list : []).filter((c) => c && c.id).map((c) => ({
    id: String(c.id), name: String(c.name || c.id), x: Number(c.x) || 0, y: Number(c.y) || 0,
    connections: Array.isArray(c.connections) ? c.connections.map(String) : [],
    sector: c.sector || '', region: c.region || '', owned: !!c.owned, mine: !!c.mine,
  }));
  return out.length >= 2 ? out : FALLBACK_CITIES;
}

function segKm(a, b) {
  const dx = a.x - b.x, dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy) * MAP_KM;
}

/** Shortest road route between two city ids.
    Returns { km, path:[ids], legs:[{from,to,km}], direct:boolean } — `direct`
    is true when no road path existed and the straight line was used. */
export function route(cities, fromId, toId) {
  const list = normalizeCities(cities);
  const byId = {}; list.forEach((c) => { byId[c.id] = c; });
  const A = byId[fromId], B = byId[toId];
  if (!A || !B) return null;
  if (A.id === B.id) return { km: 0, path: [A.id], legs: [], direct: false };
  // Dijkstra over the supply lines. Small graph; a plain O(n²) scan is fine
  // and has no heap to get wrong.
  const dist = {}, prev = {}, done = {};
  list.forEach((c) => { dist[c.id] = Infinity; });
  dist[A.id] = 0;
  for (let i = 0; i < list.length; i++) {
    let u = null, best = Infinity;
    for (const id in dist) if (!done[id] && dist[id] < best) { best = dist[id]; u = id; }
    if (u == null || u === B.id) break;
    done[u] = true;
    for (const v of byId[u].connections) {
      if (!byId[v] || done[v]) continue;
      const d = dist[u] + segKm(byId[u], byId[v]);
      if (d < dist[v]) { dist[v] = d; prev[v] = u; }
    }
  }
  if (dist[B.id] < Infinity) {
    const path = []; let cur = B.id;
    while (cur) { path.unshift(cur); cur = prev[cur]; }
    const legs = [];
    for (let i = 1; i < path.length; i++) legs.push({ from: path[i - 1], to: path[i], km: segKm(byId[path[i - 1]], byId[path[i]]) });
    return { km: round1(dist[B.id]), path, legs, direct: false };
  }
  // Disconnected: straight line, flagged so the UI can say "no supply line".
  return { km: round1(segKm(A, B)), path: [A.id, B.id], legs: [{ from: A.id, to: B.id, km: segKm(A, B) }], direct: true };
}

function round1(n) { return Math.round(n * 10) / 10; }

/* The runs must be playable: a 330 km haul at highway speed is minutes, not
   an afternoon, so the 3D run compresses the world. One game unit = 1 metre
   and a km on the map becomes ROAD_M_PER_KM metres of road: the shortest hop
   is ~1 km of road (about 30 s flat out) and the longest ~13 km (about 6 min),
   which is the "different lengths" the map is for. Par time (what a clean run
   at cruising speed should take) is derived from the same figure so the
   rank's "on pace" measure and the road length can never disagree. */
export const ROAD_M_PER_KM = 40;
export const CRUISE_MPS = 42;          // ~150 km/h in game units
export function roadLength(km) { return Math.max(400, Math.round((Number(km) || 0) * ROAD_M_PER_KM)); }
export function parSeconds(km) { return Math.max(20, Math.round(roadLength(km) / CRUISE_MPS * 1.15)); }
