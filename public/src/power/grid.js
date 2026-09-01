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
import * as Plants from './plants.js';

const NEI = [[0, -1], [1, 0], [0, 1], [-1, 0]];
const K = (x, z) => x + ',' + z;

/* ════════════════════════════════════════════════════════════════════════════
   🔌 THE METERED 33 — the demand side of "powers homes and buildings different"
   ----------------------------------------------------------------------------
   node-city declares `powerNeed` on 21 of its 54 building rows, and its own
   comment says why the other 33 were left alone: retro-fitting them "would brown
   out every save made before this layer existed". That comment is CORRECT and is
   still load-bearing — it is a statement about SAVES, not about whether a Scrap
   Mine runs on electricity. POWER.demand's header splits the 33 three ways; this
   function is the only place the third group is charged, and it is charged ONLY
   in a city that has opted in.

   ⚠ AND ONLY IN A CITY THAT ALREADY HAS A GRID. `host.hasGrid` is node-city's
     own "no grid, no brownout" rule — the per-capita household term is not
     charged until the city has a generator or something that draws. Metering a
     farm in a city with no power station at all would invent demand with no
     supply and pin a settlement of tents at the brownout floor, which is the
     exact failure that rule exists to prevent. So metering RIDES that flag
     rather than second-guessing it.
   ════════════════════════════════════════════════════════════════════════════ */
function mergeLoads(host) {
  const base = [];
  for (const l of host.loads) base.push({ k: l.k, x: l.x, z: l.z, type: l.type, name: l.name,
                                          ico: l.ico, draw: l.draw, metered: false });
  if (!host.metered || !host.hasGrid) return { loads: base, extra: [] };
  const have = new Set(base.map(l => l.k));
  const extra = [];
  for (const t of (host.tiles || [])) {
    if (!t.type || have.has(t.k)) continue;
    const rate = POWER.demand.extra[t.type];
    if (!rate) continue;
    /* × level, exactly as node-city charges its own `def.powerNeed * t.lvl`. A
       metered building that scaled differently from a declared one would be two
       rules for one question. */
    const l = { k: t.k, x: t.x, z: t.z, type: t.type, name: t.name || t.type,
                ico: t.ico || '⚡', draw: rate * Math.max(1, t.lvl | 0), metered: true };
    base.push(l); extra.push(l);
  }
  return { loads: base, extra };
}

/* ════════════════════════════════════════════════════════════════════════════
   🪜 THE SHED LADDER — a brownout that does not hit everything equally.
   ----------------------------------------------------------------------------
   "a hospital or a water pump cannot fail the way a nightclub does."

   🔴 THE INVARIANT THAT MAKES THIS SAFE FOR EVERY EXISTING SAVE, AND THE AUDIT
      THAT ENFORCES IT.
      The energy handed out here is EXACTLY the energy the flat model hands out:
      `served`, no more and no less. Shedding REDISTRIBUTES; it never creates or
      destroys. The consequence is that the draw-weighted mean of the per-tile
      factors equals node-city's own flat factor to the last bit, so no city is
      globally worse off than it was before this ladder existed — the lights
      simply go out in the right order.

      That identity is asserted every tick. If it ever fails, `ok` comes back
      false and solve() falls back to the flat factor for every tile — the same
      reasoning /src/economy's sim.js uses when its closed loop breaks. A
      redistribution bug that quietly LOSES energy would look exactly like a
      slightly worse grid, and would be believed.

   TWO PHASES, in POWER.demand.order:
     1. RESERVE. Each class takes its `floorAt` share first, in priority order.
        This is what stops a clinic going fully dark while a stadium is lit — a
        dark hospital is not a difficulty setting.
     2. PRIORITY. Whatever is left tops each class up toward full, again in
        order. Leisure is last and is therefore the first thing to go.
   ════════════════════════════════════════════════════════════════════════════ */
function shedLadder(loads, popLoad, lossLoad, served, floor) {
  const D = Object.create(null);          // draw per class
  const order = POWER.demand.order.slice();
  for (const c of order) D[c] = 0;
  /* Line loss is not sheddable — you cannot decide to stop heating a cable — so
     it sits at the head of the queue as its own class with a floor of 1. It is
     ZERO today (POWER.transmission.enforce is false), but writing it as a class
     rather than subtracting it off the top is what keeps the audit below an
     energy identity instead of an approximation. */
  if (lossLoad > 0) { order.unshift('network'); D.network = lossLoad; }
  for (const l of loads) { const c = Plants.classOf(l.type); if (D[c] == null) D[c] = 0; D[c] += l.draw; }
  if (popLoad > 0) D.households = (D.households || 0) + popLoad;

  let total = 0; for (const c of order) total += D[c] || 0;
  const budget = Math.max(0, Math.min(served, total));
  const a = Object.create(null); for (const c of order) a[c] = 0;

  // ── phase 1: the reserved floors ──
  let left = budget;
  for (const c of order) {
    const d = D[c] || 0; if (d <= 0) continue;
    const fl = c === 'network' ? 1 : ((POWER.demand.meta[c] && POWER.demand.meta[c].floorAt) || 0);
    const take = Math.min(d * fl, left);
    a[c] += take; left -= take;
    if (left <= 0) break;
  }
  // ── phase 2: top up in priority order ──
  for (const c of order) {
    if (left <= 0) break;
    const d = D[c] || 0; if (d <= 0) continue;
    const take = Math.min(d - a[c], left);
    a[c] += take; left -= take;
  }

  const share = Object.create(null);
  let handed = 0;
  for (const c of order) { const d = D[c] || 0; share[c] = d > 0 ? a[c] / d : 1; handed += a[c]; }

  /* 🔍 THE AUDIT. Energy in, energy out, to within floating-point noise. */
  const ok = Math.abs(handed - budget) < 1e-6;

  const tileFactor = Object.create(null);
  for (const l of loads) tileFactor[l.k] = floor + (1 - floor) * share[Plants.classOf(l.type)];

  const rows = [];
  for (const c of order) {
    if (c === 'network' || !(D[c] > 0)) continue;
    const m = POWER.demand.meta[c] || { label: c, ico: '·' };
    rows.push({ cls: c, label: m.label, ico: m.ico, draw: D[c], served: a[c],
                share: share[c], factor: floor + (1 - floor) * share[c], desc: m.desc || '' });
  }
  return { ok, tileFactor, rows, share, handed, budget };
}

/* ── TOPOLOGY CACHE ─────────────────────────────────────────────────────────
   solve() runs every economy tick (1 Hz). Supply and demand change every tick;
   the ROAD LAYOUT changes only when the player builds. Re-running the BFS and
   the flow accumulation 60 times a minute over an unchanged map is pure waste,
   so topology is keyed on a signature of what can affect it and reused.

   🔴 THE SIGNATURE MUST INCLUDE EVERY INPUT THE WALK READS, and getting that
      wrong is silent — a stale network looks exactly like a correct one.
      Two versions of this were wrong before the third:
        1. the tile COUNT alone, so demolishing one road and laying another in
           the same tick left the old network on screen;
        2. the tile ROLES only (`road / plant / load / empty`), which looks
           complete and is not: flow is driven by DRAW MAGNITUDE, and a Machine
           Shop upgraded from level 1 to 2 doubles its draw without changing its
           role. Its feeder could go from comfortable to choking with the
           overlay still painting it healthy, which is precisely the diagnostic
           this module exists to provide.
      Draw is therefore quantised into the key, and so are the tuning numbers
      that decide the HV/LV split and the ratings — those are live-editable from
      the console and from any future in-game tuning UI, and a cache that
      ignores them makes the model unfalsifiable. */
let _topo = null, _topoSig = '';

function topoSignature(host, loads) {
  const T = POWER.transmission;
  let s = host.grid + '|' + T.lvRating + ',' + T.hvRating + ',' + T.hvThreshold + ',' +
          T.trunkHops + ',' + T.lossPerHop + ',' + T.lossMax + '|';
  /* ⚠ THE DRAW MAP IS BUILT FROM THE MERGED LOAD LIST, not from `t.need`.
     Metering the 33 changes what a tile draws without changing anything the
     host reports on the tile itself, so a signature that read `t.need` would
     miss the entire opt-in: the player would press "meter them", every feeder
     in the city would gain load, and the overlay would keep painting the old
     flow. That is the same stale-topology failure the header records twice
     already, arriving through a third door. */
  const need = Object.create(null);
  for (const l of loads) need[l.k] = (need[l.k] || 0) + l.draw;
  for (const t of host.tiles) {
    const d = need[t.k] || 0;
    s += t.k + ':' + (t.road ? 'r' : t.plant ? 'p' : d ? 'l' : 'x');
    // Quantised, not raw: draw is a float that jitters in the last places every
    // tick, and a signature that changes every tick is a cache that never hits.
    if (d) s += (Math.round(d * 100) / 100);
    s += ';';
  }
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
function buildTopology(host, allLoads) {
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
  for (const l of allLoads) {
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

  const merged = mergeLoads(host);
  const allLoads = merged.loads;

  const topoNow = topoSignature(host, allLoads);
  if (!_topo || topoNow !== _topoSig) { _topo = buildTopology(host, allLoads); _topoSig = topoNow; }
  const topo = _topo;

  /* ── SUPPLY. Already multiplied by the host — including by the availability
     multiplier /src/power/plants.js handed it in the same pre-pass — so we only
     sum. Every field of every plant row is copied by NAME rather than spread,
     for the reason plants.js's header gives at length. */
  let capacity = 0, idlePlants = 0;
  const byPlant = [];
  for (const p of host.plants) {
    if (!(p.out > 0)) idlePlants++;
    capacity += p.out;
    byPlant.push({ k: p.k, x: p.x, z: p.z, type: p.type, name: p.name, ico: p.ico,
                   out: p.out, avail: (typeof p.avail === 'number' ? p.avail : 1),
                   why: p.why || '' });
  }
  /* ☁ …and the fleet is told what it actually produced, so the emissions this
     tick are proportional to power MADE rather than to power rated. That is the
     only input the pollution call takes from outside plants.js. */
  const fleet = Plants.bindOutputs(byPlant);

  // ── DEMAND. Buildings, then the per-capita household draw on the host's own
  //    "no grid, no brownout" rule: the per-capita term is only charged once
  //    the city has something electrical in it. Re-deriving that rule would be
  //    a second truth, so `host.hasGrid` is handed in already decided.
  let bldLoad = 0, meterLoad = 0;
  for (const l of allLoads) { bldLoad += l.draw; if (l.metered) meterLoad += l.draw; }
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

  /* ── 🔌 THE INTERCONNECTOR ────────────────────────────────────────────────
     Import and export over the outside connection, gated on the SAME rule the
     caravan is gated on. `host.link` is what /src/power/link.js answered this
     tick; a refused link arrives with both caps at 0 and carries the reason,
     which the panel prints instead of drawing a zero.

     🔴 THE ORDER OF MERIT IS THE WHOLE DESIGN, and it is what keeps the battery
        worth having after this feature exists:
          deficit -> BATTERY FIRST, then import.   Stored energy is already paid
                     for; imported energy is billed at tariff*(1+spread).
          surplus -> CHARGE FIRST, then export.    Banking costs nothing;
                     exporting sells at tariff*(1-spread).
        So a round trip — import, store, export — loses the spread twice and
        can never be a business. That is the same job ECON.trade.spreadPct does
        for goods, and it is why there is a spread at all.

     ⚠ IMPORTED POWER BEHAVES EXACTLY LIKE BATTERY DISCHARGE, not like a plant.
       It raises `served` (and therefore `ratio` and `factor`) and it does NOT
       raise `capacity`. That is deliberate and it is the ESTABLISHED shape here:
       `fromStore` has always worked this way, the causal list has always summed
       to `served` rather than to `capacity`, and RESERVE MARGIN must keep asking
       about the city's OWN generation or it stops meaning anything — a city on
       imported power has no reserve, and the meter has to be able to say so.
       It is also what lets node-city read `game.power` unchanged: it already
       assigns `ratio` and `factor` from this solve, so the brownout lifts with
       no edit to the host at all. */
  const link = (host && host.link) || null;
  const dead = POWER.trade.deadbandUnitMin;
  let importUnits = 0, exportUnits = 0;
  const balance = capacity + (dt > 0 ? fromStore / dt : 0) - load;
  if (link && link.ok) {
    if (balance < -dead) {
      importUnits = Math.min(-balance, Math.max(0, link.importCap));
    } else if (balance > dead) {
      /* What is left AFTER the buffer has taken its share this tick. `toStore`
         is a per-tick quantity, so it is divided back out to the per-minute
         rate everything else in this function is in. */
      const spare = balance - (dt > 0 ? toStore / dt : 0);
      if (spare > dead) exportUnits = Math.min(spare, Math.max(0, link.exportCap));
    }
  }

  // Effective supply for the tick includes anything the buffer covered — and
  // anything that came in over the link.
  const served = capacity + (dt > 0 ? fromStore / dt : 0) + importUnits;
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
  const causes = buildCauses({ byPlant, host, loads: allLoads, popLoad, lossLoad, fromStore, dt,
                               importUnits, exportUnits,
                               meanHop: topo.meanHop, loss: topo.loss });

  /* ── 🪜 THE LADDER. Same energy, distributed by priority. See shedLadder's
     header for the identity it maintains and the audit that enforces it. */
  const ladder = shedLadder(allLoads, popLoad, lossLoad, served, host.floor);
  /* 🔴 THE FALLBACK IS FLAT, AND IT IS OBSERVABLE. If the audit fails, every
     tile gets the same factor node-city would have computed on its own — no
     redistribution, nothing lost — and `shedOk` goes false so the panel can say
     so. A silent revert here would be indistinguishable from a working ladder
     that happens to be shedding nothing. */
  let tileFactor = ladder.tileFactor;
  if (!ladder.ok) { tileFactor = Object.create(null); for (const l of allLoads) tileFactor[l.k] = factor; }

  /* ☁ THE POLLUTION TICK. One call, immediately after the tick's real outputs
     are known and before anything else can change them. See plants.js →
     POLLUTION EMIT CALL SITE. */
  const emissions = Plants.emitAll(fleet, dt);

  return {
    ok: true,
    // The four keys the agreed cross-workflow API promises.
    capacity, load, factor, byPlant,
    // …and everything the panel and overlay need on top of it.
    served, ratio, rawRatio, bldLoad, popLoad, lossLoad, lossWouldBe, meterLoad,
    store: { charge, cap, in: toStore, out: fromStore },
    net: capacity - load,
    reserve: capacity > 0 ? (capacity - load) / capacity : 0,
    topo: { seg: topo.seg, transformers: topo.transformers, chokes: topo.chokes,
            unserved: topo.unserved, meanHop: topo.meanHop, loss: topo.loss },
    causes, idlePlants,
    /* 🔌 THE LINK, REPORTED WHETHER OR NOT IT MOVED ANYTHING. `ok` false always
       carries a `why`, so the panel can print a refusal where a lesser meter
       would print "0 kW / 0 kW" and claim a working connection. */
    trade: { ok: !!(link && link.ok),
             importUnits, exportUnits,
             importCap: link ? link.importCap : 0,
             exportCap: link ? link.exportCap : 0,
             rating: link ? link.rating : 0,
             arrears: link ? link.arrears : 0,
             curtailed: !!(link && link.curtailed),
             present: !!(link && link.present), priced: !!(link && link.priced),
             connected: !!(link && link.connected),
             viaLabel: link ? link.viaLabel : '',
             why: link ? link.why : 'The interconnector was not consulted this tick.',
             fix: link ? link.fix : '' },
    // 🪜 The demand ladder: the per-tile answer, the per-class rows, and the audit.
    tileFactor, classes: ladder.rows, shedOk: ladder.ok,
    /* `meteredOn` is the SETTING — what the player chose, and what the panel's
       switch reflects. `metered` is whether it is IN EFFECT this tick, which
       additionally requires the city to have a grid at all (see mergeLoads).
       They are reported separately because a settlement with no generator would
       otherwise show "Legacy demand" and offer a switch it had already thrown. */
    meteredOn: !!host.metered, metered: !!(host.metered && host.hasGrid),
    meteredCount: merged.extra.length,
    emissions,
    plantCount: host.plants.length,
    loadCount: allLoads.length,
    enforce: POWER.transmission.enforce,
  };
}

function buildCauses(a) {
  const sup = [], dem = [];

  /* Supply, grouped by plant type — and the group carries the mean AVAILABILITY
     as well as the output, because "Wind Turbine ×4  1.2 MW" and "Wind Turbine
     ×4  1.2 MW (31% — calm)" are the same number and completely different
     sentences. The second one tells the player what to do about it. */
  const byType = new Map();
  for (const p of a.byPlant) {
    const g = byType.get(p.type) || { label: p.name, ico: p.ico, n: 0, v: 0, av: 0, why: '' };
    g.n++; g.v += p.out; g.av += (typeof p.avail === 'number' ? p.avail : 1);
    if (p.why && !g.why) g.why = p.why;
    byType.set(p.type, g);
  }
  for (const g of byType.values()) {
    const mean = g.n ? g.av / g.n : 1;
    const note = (mean < 0.985 || g.why)
      ? '  ' + Math.round(mean * 100) + '%' + (g.why ? ' · ' + g.why : '') : '';
    sup.push({ sign: '+', ico: g.ico, label: g.label + (g.n > 1 ? ' ×' + g.n : '') + note, v: g.v });
  }
  if (a.dt > 0 && a.fromStore > 0) sup.push({ sign: '+', ico: '🔋', label: 'Battery discharge', v: a.fromStore / a.dt });
  /* 🔌 …and the import, which is a supply term for the same reason the battery
     is: it is energy the city is running on that no plant of its own made. The
     list has always summed to `served` rather than to `capacity` (see the
     battery row above it), so adding it here keeps the total exact — "a list
     that does not add up to the meter is worse than no list". The EXPORT does
     not appear: it is surplus leaving, not demand, and printing it as a minus
     against consumption would make the causal list stop summing to the load. */
  if (a.importUnits > 0) sup.push({ sign: '+', ico: '🔌', label: 'Imported over the outside connection', v: a.importUnits });

  // Demand, grouped by building type. A METERED row is marked, so the opt-in
  // is visible in the same list that shows what it cost.
  const dByType = new Map();
  for (const l of a.loads) {
    const g = dByType.get(l.type) || { label: l.name, ico: l.ico, n: 0, v: 0, m: false };
    g.n++; g.v += l.draw; if (l.metered) g.m = true; dByType.set(l.type, g);
  }
  for (const g of dByType.values())
    dem.push({ sign: '−', ico: g.ico, label: g.label + (g.n > 1 ? ' ×' + g.n : '') + (g.m ? '  ⊕' : ''), v: g.v });
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
