/* ════════════════════════════════════════════════════════════════════════════
   ⚡ THE GRID — transmission, storage, and the one solve.
   ----------------------------------------------------------------------------
   SPLIT OF OWNERSHIP, stated once so there is exactly one answer to "what is
   the city's production right now":

     THE HOST OWNS GENERATION. A plant's output is `def.gen.power * tileMult(...)`
     and tileMult is node-city's central production multiplier — adjacency,
     level, staffing, weather, mayor, Kalon, sockets, and the TILE_MULT_CAP that
     the file's own comment calls "THE ECONOMY DIAL". Re-deriving any of that
     here would be a second economy. So the host hands each plant's ALREADY
     MULTIPLIED output in, through `host.plants[].out`, and this module never
     computes a generation number of its own.

     THIS MODULE OWNS TRANSMISSION AND STORAGE. Connectivity, flow, bottlenecks,
     step-down points and the battery buffer do not exist anywhere in the host
     and are wholly ours.

     THE PANEL READS BOTH, and reads them from the single object solve() returns.

   🔴 WHY THIS IS NOT bfsPath(). node-city has a road walk at index.html:23443 —
      `bfsPath(startK, goalK)`, single source, single goal, returns the path and
      throws the search tree away. A grid needs the opposite of all three: MANY
      sources (every plant injects at once), ALL destinations (every load must
      learn its distance), and the parent tree RETAINED, because flow is
      accumulated by walking each load's draw back up that tree to the source.
      Calling bfsPath once per load would also be O(loads x tiles) where this is
      O(tiles). So the FUNCTION is not reusable, but the IDEA is, and the two
      share their vocabulary deliberately: same `key`/`NEI` four-neighbour
      lattice, same "visited map doubles as the parent pointer" trick. If the
      host's road adjacency rule ever changes, both must change together.
   ════════════════════════════════════════════════════════════════════════════ */

import { POWER } from './tuning.js';

const NEI = [[0, -1], [1, 0], [0, 1], [-1, 0]];
const K = (x, z) => x + ',' + z;

/* ── TOPOLOGY CACHE ─────────────────────────────────────────────────────────
   solve() runs every economy tick (1 Hz). Supply and demand change every tick;
   the ROAD LAYOUT changes only when the player builds. Re-running the BFS and
   the flow accumulation 60 times a minute over an unchanged map is pure waste,
   so topology is keyed on a signature of what can affect it and reused.
   ⚠ The signature must include every input the walk reads. It was briefly just
     the tile COUNT, which meant demolishing one road and laying another in the
     same tick left a stale network on screen. */
let _topo = null, _topoSig = '';

function topoSignature(host) {
  let s = host.grid + '|';
  for (const t of host.tiles) s += t.k + ':' + (t.road ? 'r' : t.plant ? 'p' : t.need ? 'l' : 'x') + ';';
  return s;
}

/* ── THE WALK ───────────────────────────────────────────────────────────────
   Multi-source BFS over road tiles, seeded from every road tile orthogonally
   adjacent to a plant. Produces, per road tile: hop distance from the nearest
   plant, the parent pointer back toward that plant, and which plant it feeds
   from. Then every load attaches to an adjacent road tile and its draw is
   pushed back up the parent chain, so each segment ends up carrying the sum of
   everything downstream of it — which is what a bottleneck is.

   A load with no adjacent road, or whose road sits on a component no plant
   reaches, is UNSERVED. That is a real diagnostic the host has never had: today
   a building on an islanded road is powered exactly as well as one wired to the
   turbine hall. */
function buildTopology(host) {
  const road = new Map();      // k -> { x, z, hop, prev, src, flow }
  const isRoad = new Set();
  for (const t of host.tiles) if (t.road) isRoad.add(t.k);

  // Seed: road tiles touching a plant. The plant injects there.
  const q = [];
  for (const p of host.plants) {
    for (const [dx, dz] of NEI) {
      const nk = K(p.x + dx, p.z + dz);
      if (!isRoad.has(nk)) continue;
      if (road.has(nk)) continue;
      road.set(nk, { x: p.x + dx, z: p.z + dz, hop: 0, prev: null, src: p.k, flow: 0 });
      q.push(nk);
    }
  }

  for (let i = 0; i < q.length; i++) {
    const cur = road.get(q[i]);
    for (const [dx, dz] of NEI) {
      const nx = cur.x + dx, nz = cur.z + dz, nk = K(nx, nz);
      if (!isRoad.has(nk) || road.has(nk)) continue;
      road.set(nk, { x: nx, z: nz, hop: cur.hop + 1, prev: K(cur.x, cur.z), src: cur.src, flow: 0 });
      q.push(nk);
    }
  }

  /* ── FLOW ────────────────────────────────────────────────────────────────
     Each load's draw walks back to its source, adding itself to every segment
     it crosses. The `guard` is not paranoia: a parent chain is a tree by
     construction, but this loop is the one place a future change to the walk
     (a second seeding pass, a diagonal neighbour) could close a cycle, and an
     un-guarded while(prev) there hangs the tab rather than drawing badly. */
  const loads = [], unserved = [];
  for (const l of host.loads) {
    let at = null;
    for (const [dx, dz] of NEI) {
      const nk = K(l.x + dx, l.z + dz);
      const r = road.get(nk);
      if (r && (at === null || r.hop < road.get(at).hop)) at = nk;
    }
    if (at === null) { unserved.push(l); continue; }
    loads.push({ ...l, at, hop: road.get(at).hop });
    let cur = at, guard = 0;
    while (cur && guard++ < 4096) { const r = road.get(cur); if (!r) break; r.flow += l.draw; cur = r.prev; }
  }

  /* ── CLASSIFY ────────────────────────────────────────────────────────────
     High voltage is the part of the same network that has aggregated enough
     load to read as trunk, plus the first couple of hops out of every plant so
     that a plant always leaves on trunk even in a city too small to have
     aggregated anything yet. Everything else is low voltage.

     A TRANSFORMER is then a derived object, not a building: the point where an
     HV segment hands over to LV distribution. That is genuinely where a grid
     steps down, it needs no new BUILDINGS row, and it gives the reference's
     "Transformers" legend row something true to point at. */
  const T = POWER.transmission;
  const seg = [];
  for (const [k, r] of road) {
    const hv = r.flow >= T.hvThreshold || r.hop < T.trunkHops;
    const rating = hv ? T.hvRating : T.lvRating;
    seg.push({ k, x: r.x, z: r.z, hop: r.hop, prev: r.prev, src: r.src,
               flow: r.flow, hv, rating, choke: r.flow > rating,
               util: rating > 0 ? r.flow / rating : 0 });
  }
  const segByKey = new Map(seg.map(s => [s.k, s]));
  const transformers = [];
  for (const s of seg) {
    if (!s.hv) continue;
    for (const [dx, dz] of NEI) {
      const n = segByKey.get(K(s.x + dx, s.z + dz));
      if (n && !n.hv && n.prev === s.k) { transformers.push({ k: s.k, x: s.x, z: s.z }); break; }
    }
  }

  /* Resistive loss, as a single city-wide fraction: the draw-weighted mean hop
     count times the per-hop loss. Reported as a cause, never silently applied
     twice — solve() is the only place it is charged. */
  let wsum = 0, wtot = 0;
  for (const l of loads) { wsum += l.draw * l.hop; wtot += l.draw; }
  const meanHop = wtot > 0 ? wsum / wtot : 0;
  const loss = Math.min(T.lossMax, meanHop * T.lossPerHop);

  return { seg, segByKey, loads, unserved, transformers, meanHop, loss,
           chokes: seg.filter(s => s.choke) };
}

/* ── THE SOLVE ──────────────────────────────────────────────────────────────
   Returns ONE object. Everything downstream — the host's `game.power`, the
   panel, the overlay, `__nc.power()` — reads this and only this.

   ⚠ `host.floor` and `host.perPop` are the HOST's constants (POWER_FLOOR and
     DEMAND_PER_POP.power) and are deliberately not defaulted in tuning.js. If
     the host forgets to hand them over, the brownout curve here would silently
     stop matching the one the coverage panel draws, so we refuse rather than
     guess and the caller keeps its own inline model. */
export function solve(host, store) {
  if (typeof host.floor !== 'number' || typeof host.perPop !== 'number') {
    return { ok: false, why: 'host did not supply floor/perPop' };
  }

  const topoNow = topoSignature(host);
  if (!_topo || topoNow !== _topoSig) { _topo = buildTopology(host); _topoSig = topoNow; }
  const topo = _topo;

  // ── SUPPLY. Already multiplied by the host; we only sum. ──
  let capacity = 0, idlePlants = 0;
  for (const p of host.plants) if (!(p.out > 0)) idlePlants++;
  const byPlant = [];
  for (const p of host.plants) { capacity += p.out; byPlant.push({ ...p }); }

  // ── DEMAND. Buildings, then the per-capita household draw on the host's own
  //    "no grid, no brownout" rule: the per-capita term is only charged once
  //    the city has something electrical in it. Re-deriving that rule would be
  //    a second truth, so `host.hasGrid` is handed in already decided.
  let bldLoad = 0;
  for (const l of host.loads) bldLoad += l.draw;
  const popLoad = host.hasGrid ? host.perPop * host.pop : 0;
  /* Line loss is a DEMAND term and is only CHARGED when transmission is
     enforced — see POWER.transmission's header. Computed either way, because
     the panel prints what it would cost, and because a number that is only
     computed when it is charged is a number nobody can sanity-check before
     turning the flag on. */
  const lossWouldBe = bldLoad * topo.loss;
  const lossLoad = POWER.transmission.enforce ? lossWouldBe : 0;
  const load = bldLoad + popLoad + lossLoad;

  /* ── STORAGE ──────────────────────────────────────────────────────────────
     Capacity rides on plants (see tuning). Charge on genuine surplus, discharge
     to cover a deficit — capped per minute so a buffer smooths peaks and can
     never stand in for a missing turbine.
     ⚠ dtMin is the caller's tick length. Charging a per-minute rate without it
       made the buffer fill 60x too fast at the shipped 1 Hz cadence. */
  const cap = host.plants.length * POWER.storage.perPlantUnitMin;
  const dt = Math.max(0, Number(host.dtMin) || 0);
  let charge = Math.min(Math.max(0, Number(store) || 0), cap);
  let fromStore = 0, toStore = 0;

  const rawRatio = load > 0 ? capacity / load : 1;
  if (load > 0 && capacity < load && charge > 0 && dt > 0) {
    const want = (load - capacity) * dt;
    const capRate = POWER.storage.dischargePerMinPerPlant * host.plants.length * dt;
    fromStore = Math.min(charge, want, capRate);
    charge -= fromStore;
  } else if (dt > 0 && cap > 0 && rawRatio >= POWER.storage.chargeAboveRatio) {
    const spare = (capacity - load) * dt;
    toStore = Math.min(spare * POWER.storage.chargeEff, cap - charge);
    charge += toStore;
  }

  // Effective supply for the tick includes anything the buffer covered.
  const served = capacity + (dt > 0 ? fromStore / dt : 0);
  const ratio = load > 0 ? served / load : 1;
  const factor = ratio >= 1 ? 1 : host.floor + (1 - host.floor) * ratio;

  /* ── THE SIGNED CAUSAL LIST ───────────────────────────────────────────────
     BAR.md dimension 12 is won or lost here: the panel must express state "as a
     meter with a signed causal list, not a raw number". Supply terms are '+',
     demand terms are '-', and the list is grouped by BUILDING TYPE rather than
     printed per tile, because "Machine Shop x4  -2.8" is a sentence a player
     can act on and forty rows of "Machine Shop -0.7" is not.
     ⚠ THE TOTAL IS EXACT EVEN WHEN THE LIST IS ABBREVIATED. Anything under
       minShare is folded into one "…and N smaller" row carrying its real sum —
       the same rule node-city states for its away-report leaver list. A list
       that does not add up to the meter is worse than no list. */
  const causes = buildCauses({ byPlant, host, popLoad, lossLoad, fromStore, dt,
                               meanHop: topo.meanHop, loss: topo.loss });

  return {
    ok: true,
    // The four keys the agreed cross-workflow API promises.
    capacity, load, factor, byPlant,
    // …and everything the panel and overlay need on top of it.
    served, ratio, rawRatio, bldLoad, popLoad, lossLoad, lossWouldBe,
    store: { charge, cap, in: toStore, out: fromStore },
    net: capacity - load,
    reserve: capacity > 0 ? (capacity - load) / capacity : 0,
    topo: { seg: topo.seg, transformers: topo.transformers, chokes: topo.chokes,
            unserved: topo.unserved, meanHop: topo.meanHop, loss: topo.loss },
    causes, idlePlants,
    plantCount: host.plants.length,
    loadCount: host.loads.length,
    enforce: POWER.transmission.enforce,
  };
}

function buildCauses(a) {
  const sup = [], dem = [];

  // Supply, grouped by plant type.
  const byType = new Map();
  for (const p of a.byPlant) {
    const g = byType.get(p.type) || { label: p.name, ico: p.ico, n: 0, v: 0 };
    g.n++; g.v += p.out; byType.set(p.type, g);
  }
  for (const g of byType.values()) sup.push({ sign: '+', ico: g.ico, label: g.label + (g.n > 1 ? ' ×' + g.n : ''), v: g.v });
  if (a.dt > 0 && a.fromStore > 0) sup.push({ sign: '+', ico: '🔋', label: 'Battery discharge', v: a.fromStore / a.dt });

  // Demand, grouped by building type.
  const dByType = new Map();
  for (const l of a.host.loads) {
    const g = dByType.get(l.type) || { label: l.name, ico: l.ico, n: 0, v: 0 };
    g.n++; g.v += l.draw; dByType.set(l.type, g);
  }
  for (const g of dByType.values()) dem.push({ sign: '−', ico: g.ico, label: g.label + (g.n > 1 ? ' ×' + g.n : ''), v: g.v });
  if (a.popLoad > 0) dem.push({ sign: '−', ico: '🏠', label: 'Households (' + Math.round(a.host.pop) + ')', v: a.popLoad });
  if (a.lossLoad > 0) dem.push({ sign: '−', ico: '〰', label: 'Line loss (' + a.meanHop.toFixed(1) + ' hop avg)', v: a.lossLoad });

  return { supply: abbreviate(sup), demand: abbreviate(dem) };
}

/* Sort big-first, print at most maxRows, and fold the tail into one row whose
   value is the EXACT remainder. */
function abbreviate(rows) {
  rows.sort((p, q) => q.v - p.v);
  const total = rows.reduce((s, r) => s + r.v, 0);
  if (!total) return rows;
  const keep = [];
  let folded = 0, foldedN = 0;
  for (const r of rows) {
    if (keep.length < POWER.causes.maxRows && r.v / total >= POWER.causes.minShare) keep.push(r);
    else { folded += r.v; foldedN++; }
  }
  if (foldedN) keep.push({ sign: rows[0].sign, ico: '…', label: 'and ' + foldedN + ' smaller', v: folded, dim: true });
  return keep;
}

/* Exposed so a test — or a future round that flips `enforce` — can ask which
   tiles the walk believes are wired, without re-running the whole solve. */
export function topology() { return _topo; }
export function invalidate() { _topo = null; _topoSig = ''; }
