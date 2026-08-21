/* ════════════════════════════════════════════════════════════════════════════
   🚰 THE MAINS — the pipe network, its components, and what each one serves.
   ----------------------------------------------------------------------------
   endowment.js is the ground as it was made. hydro.js is the ground as it is
   now. THIS file is the only part of /src/water the player builds: a set of
   pipe tiles, the connected components they fall into, and the two questions
   every tick asks of them —

       · can this waterworks reach the city?      → the mains factor
       · has this city anywhere to put its waste? → the sewer factor

   ── 🔴 A PIPE IS NOT A TILE ────────────────────────────────────────────────
   Pipes are underground and live in the Set below, keyed "x,z". They are never
   written into `game.tiles` and they are not a BUILDINGS type. That is not
   tidiness; it is the one decision that keeps this feature out of the bug class
   node-city has already named three times (`TRUCK_STOPS` — "seventh instance";
   a load-order snapshot — "eighth"). `isRoad` is a bare `t.type === 'road'`
   string compare re-derived independently in a dozen files, and a new tile type
   silently falls out of every one of them: the road maintenance cap, the
   buildMesh switch (an invisible building on a tile the player paid for),
   agentTick (which reads a type change on an occupied tile as a demolition and
   despawns everyone on it), zoning's fill bound, the power grid's `t.road`
   projection, /src/parking's and /src/crowd's own re-derived neighbour masks.
   A pipe under a road costs that road NONE of that, because as far as
   node-city is concerned the tile did not change.

   ── 🔴 AND IT IS WHY GRANDFATHERING IS FREE ────────────────────────────────
   `plumbed` is DERIVED, never stored: a city with no pipe, no governed
   waterworks and no outfall is unplumbed, and an unplumbed city gets 1.00×
   everywhere — exactly what node-city produced before this file existed. Every
   save written before this round is in that state by construction. There is no
   version number to read, no migration to run and nothing that can drift,
   which is the same instinct /src/power's `metered` flag uses (absent-in-blob
   ⇒ not metered) with the stored half removed.

   ── WHAT THIS FILE MAY NOT DO ──────────────────────────────────────────────
   No DOM, no `window`, no THREE. netui.js owns every one of those. This file is
   importable and drivable from node, which is how the mains are tested at all:
   see .gauntlet/drive-water-mains.mjs.
   ════════════════════════════════════════════════════════════════════════════ */

import { WATER } from './tuning.js';

/* ── STATE ──────────────────────────────────────────────────────────────────
   One Set of tile keys and the city it belongs to. Persisted through
   window.MythicCitySave — see save()/load() and index.js's register() call —
   so node-city's serialize() literal is not touched at all. */
let pipes = new Set();
let cityId = '';

/* ── 🌊 THE SEA DRAINS ──────────────────────────────────────────────────────
   A second Set, in the same file, deliberately: a drain is an ENDPOINT ON THIS
   GRAPH and nothing else. It is not a BUILDINGS row, it is not in `game.tiles`,
   and it is not a second pipe model — it rides `components()` and `attachOf()`
   unchanged, and solve() folds it into the SAME outfall rows the host's
   `outfall` buildings produce, so the per-component pooling that this file's
   §5 exists to protect is written once and serves both.

   🔴 WHY A DRAIN IS NOT A `game.tiles` BUILDING, IN ONE SENTENCE: it stands in
      the OCEAN, and the ocean is off the plate. tryPlace() opens with
      `if (!inGrid(x, z) || tileAt(x, z)) return;` — the plate is the city and
      the whole file's invariants (the ~200 `for x in 0..GRID` walks, zoning's
      fill bounds, agentTick, the road cap, dropTileMesh, serialize) are written
      against it. Putting a tile OUTSIDE that domain is strictly worse than
      minting a new tile TYPE inside it, which is the bug class node-city has
      already numbered twice. /src/power's Grid Connector is the shipped
      precedent for the honest shape: an off-plate terminal that a dragged
      network reaches, owned by the module that drew it, with its own mesh and
      its own save. This is that, for water.
   ⚠ AND IT IS A SIBLING OF `outfall`, NOT A RELOCATION OF IT. The Sewer Outfall
     stays exactly as it shipped — it stands ON the plate and discharges into
     the sea, a river, a lake or the channel off the map edge. Narrowing it to
     sea-only would invalidate outfalls standing on river banks in saves already
     written, which is the one thing the save rules forbid. The drain is the
     STRICTLY STRONGER rule on a NEW endpoint: it may stand nowhere but in open
     water, so no existing city can be broken by a rule it has never met. */
let drains = new Set();

/* ── THE DOMAIN ─────────────────────────────────────────────────────────────
   The buildable plate (0 … grid-1) PLUS an apron of columns to the EAST, which
   is where the sea is on every map (WATER.sea's side is a constant). Pipe runs
   have to cross the shoreline or a land district could never reach a drain as
   ONE component, which is the whole assertion this round is making.

   ⚠ THE APRON IS EAST ONLY, AND `apronE` IS A COUNT OF COLUMNS, NOT A REACH. It
     is set by index.js from WATER.sewer.drain.apron; this file holds no opinion
     about where the water starts — `sea(x,z)` arrives in the solve snapshot and
     is MythicOcean's answer, never a coastline re-derived here. */
let apronE = 0;
export function setDomain(a) { apronE = Math.max(0, a | 0); }
export function domain(grid) { const g = (grid | 0) || 24; return { x0: 0, x1: g - 1 + apronE, z0: 0, z1: g - 1 }; }
function inDomain(x, z, grid) {
  const d = domain(grid);
  return x >= d.x0 && x <= d.x1 && z >= d.z0 && z <= d.z1;
}

export function reset() { pipes = new Set(); drains = new Set(); cityId = ''; }
export function count() { return pipes.size; }
export function keys() { return Array.from(pipes); }
export function has(k) { return pipes.has(k); }
export function setCity(id) { cityId = String(id == null ? '' : id); }

/* Drains, in the same verbs as the pipes above so a caller does not have to
   learn a second vocabulary. addDrain/removeDrain return what ACTUALLY changed,
   for the same reason add/remove do: the caller charges for that number. */
export function drainCount() { return drains.size; }
export function drainKeys() { return Array.from(drains); }
export function hasDrain(k) { return drains.has(k); }
export function addDrain(list) {
  let n = 0;
  for (const k of list) if (!drains.has(k)) { drains.add(k); n++; }
  return n;
}
export function removeDrain(list) {
  let n = 0;
  for (const k of list) if (drains.delete(k)) n++;
  return n;
}

const K = (x, z) => (x | 0) + ',' + (z | 0);
export const pipeKey = K;

function parse(k) { const p = String(k).split(','); return { x: +p[0], z: +p[1] }; }

/* ── EDITS ──────────────────────────────────────────────────────────────────
   add/remove return the number of tiles that ACTUALLY changed, so the caller
   can charge for exactly what it laid. A drag over eight tiles where five
   already carry a pipe must bill for three. */
export function add(list) {
  let n = 0;
  for (const k of list) if (!pipes.has(k)) { pipes.add(k); n++; }
  return n;
}
export function remove(list) {
  let n = 0;
  for (const k of list) if (pipes.delete(k)) n++;
  return n;
}

/* ── THE PATH A DRAG LAYS ───────────────────────────────────────────────────
   An L: the dominant axis first, then the other. Straight drags are the common
   case and fall out of this for free, and the elbow means a player can put a
   spur round a corner in ONE gesture rather than two.

   ⚠ THE RUN IS CAPPED (`WATER.mains.maxRun`) AND THE CAP IS NOT COSMETIC. Every
     tile is charged, and a drag that slips across the map is the one mistake a
     player cannot undo by releasing the button. The toolbar prints the count
     and the price before the commit, and the path is truncated here so the
     number the player was shown is the number they are billed. */
export function pathBetween(x0, z0, x1, z1, grid) {
  const G = grid || 24;
  const out = [];
  /* 🌊 CLAMPED TO THE DOMAIN, NOT TO THE PLATE. x runs one apron further east
     than z does, because that is where the water is — a run that stopped at the
     plate edge could never reach a drain, and the player would be told to
     connect to something they cannot connect to. */
  const d = domain(G);
  const cx = (v) => Math.max(d.x0, Math.min(d.x1, v | 0));
  const cz = (v) => Math.max(d.z0, Math.min(d.z1, v | 0));
  x0 = cx(x0); z0 = cz(z0); x1 = cx(x1); z1 = cz(z1);
  const dx = Math.abs(x1 - x0), dz = Math.abs(z1 - z0);
  const sx = x1 >= x0 ? 1 : -1, sz = z1 >= z0 ? 1 : -1;
  const max = WATER.mains.maxRun;
  if (dx >= dz) {
    for (let x = x0; x !== x1 + sx; x += sx) { out.push(K(x, z0)); if (out.length >= max) return out; }
    for (let z = z0 + sz; z !== z1 + sz; z += sz) { out.push(K(x1, z)); if (out.length >= max) return out; }
  } else {
    for (let z = z0; z !== z1 + sz; z += sz) { out.push(K(x0, z)); if (out.length >= max) return out; }
    for (let x = x0 + sx; x !== x1 + sx; x += sx) { out.push(K(x, z1)); if (out.length >= max) return out; }
  }
  return out;
}

/* ── COMPONENTS ─────────────────────────────────────────────────────────────
   4-neighbour flood, iterated with an index cursor rather than shift() — the
   same note /src/power/grid.js's buildTopology leaves, and for the same reason:
   shift() on a large array is O(n) and the walk becomes quadratic on exactly
   the network a player who likes pipes will build.

   Returns `{ id[key] -> componentIndex, sizes[] }`. TWO DISCONNECTED RUNS ARE
   TWO COMPONENTS — that is the whole assertion behind calling this a network
   rather than a paint layer, and .gauntlet/drive-water-mains.mjs checks it. */
export function components() {
  const id = Object.create(null);
  const sizes = [];
  let c = 0;
  for (const start of pipes) {
    if (id[start] !== undefined) continue;
    const q = [start];
    id[start] = c;
    let n = 0;
    for (let i = 0; i < q.length; i++) {
      const k = q[i]; n++;
      const { x, z } = parse(k);
      const nb = [K(x + 1, z), K(x - 1, z), K(x, z + 1), K(x, z - 1)];
      for (const m of nb) {
        if (pipes.has(m) && id[m] === undefined) { id[m] = c; q.push(m); }
      }
    }
    sizes.push(n);
    c++;
  }
  return { id, sizes, count: c };
}

/* Which component (if any) a BUILDING at x,z is attached to.
   A building is on the mains if a pipe lies on its own tile or within
   `WATER.mains.reach` orthogonal tiles — the pipe under the street serves the
   plots either side of it, which is why a main follows a road.

   ⚠ A building straddling two components takes the FIRST it finds and the fact
     is recorded (`multi`), because a building bridging two runs does NOT join
     them: pipes join pipes. A player who wants one network lays one. */
export function attachOf(comp, x, z) {
  const R = WATER.mains.reach;
  let first = -1, multi = false;
  for (let dx = -R; dx <= R; dx++) {
    for (let dz = -R; dz <= R; dz++) {
      if (Math.abs(dx) + Math.abs(dz) > R) continue;       // orthogonal reach, not Chebyshev
      const k = K(x + dx, z + dz);
      const c = comp.id[k];
      if (c === undefined) continue;
      if (first < 0) first = c;
      else if (c !== first) multi = true;
    }
  }
  return { comp: first, multi };
}

/* ════════════════════════════════════════════════════════════════════════════
   THE SOLVE — one pass, called from index.js before Hydro.solve so the two can
   never disagree about who is connected to what.

   INPUT (all of it from the host's own per-tick snapshot; nothing is read from
   a global and no rate is invented):
     wells     [{k,x,z,want,mains}]   waterworks. `mains` is the BUILDINGS row's
                                      own flag, handed over per tile — see
                                      WATER.mains's note on why this is not a
                                      list in this file.
     users     [{k,x,z,draw}]         buildings with `use.water`
     homes     [{k,x,z,share}]        buildings with `popCap`; `share` is that
                                      home's share of the city's beds, computed
                                      by the host, so the drink figure is SPLIT
                                      rather than re-derived
     outfalls  [{k,x,z,cap}]          buildings with a `sewer` block
     drink                            pop × drinkPerMin, computed ONCE by
                                      hydro.js's drinkOf() and handed to both
                                      callers — there is no second expression
                                      for it anywhere
     openWater (x,z) -> boolean       is this tile discharging into open water

   OUTPUT: the two factors, plus everything the panel and the overlay need to
   explain them. The panel NEVER re-derives any of this.
   ════════════════════════════════════════════════════════════════════════════ */
export function solve(snap) {
  const M = WATER.mains, SW = WATER.sewer;
  const wells = Array.isArray(snap.wells) ? snap.wells : [];
  const users = Array.isArray(snap.users) ? snap.users : [];
  const homes = Array.isArray(snap.homes) ? snap.homes : [];
  const hostOutfalls = Array.isArray(snap.outfalls) ? snap.outfalls : [];
  const drink = Math.max(0, Number(snap.drink) || 0);
  const openWater = typeof snap.openWater === 'function' ? snap.openWater : () => false;
  /* 🌊 IS THIS CELL IN THE OCEAN? Handed in, never derived. index.js delegates
     it to window.MythicOcean.isSea — the ONE exported coastline predicate that
     /src/wild and node-city's perimeterScenery already consult. A second answer
     computed here would render perfectly and disagree with the water the player
     is looking at, which is this project's most-repeated failure. Absent ⇒ no
     drain is ever live, which is the safe direction: a drain that cannot prove
     it is in the water treats nothing. */
  const sea = typeof snap.sea === 'function' ? snap.sea : () => false;

  /* THE ONE OUTFALL LIST. A Sewer Outfall (a BUILDINGS row on the plate, wet by
     `openWater`) and a Sea Drain (a module-owned structure, wet by `sea`) are
     two ways to buy the same nameplate, so they are two ROWS in one list rather
     than two code paths — §5's per-component pooling and the `min` that caps it
     once are then written exactly once and cannot drift.
     ⚠ `cap` for a drain comes from the tuning table (SW.drainCap) because there
       is no BUILDINGS row to carry it. That is the only asymmetry, and it is
       stated here rather than buried in the loop. */
  const outfalls = hostOutfalls.map(o => ({ ...o, kind: 'outfall', wet: !!openWater(o.x, o.z) }));
  for (const k of drains) {
    const p = parse(k);
    outfalls.push({ k, x: p.x, z: p.z, kind: 'drain', cap: SW.drain.cap, wet: !!sea(p.x, p.z) });
  }

  const comp = components();

  /* 🔴 THE GRANDFATHER LATCH, DERIVED. No pipe, no governed waterworks and no
     outfall ⇒ this city has never touched the mains, and every number below
     collapses to the identity. A save written before this round is in this
     state by construction, so no city is retroactively dried out and there is
     no stored flag that can disagree with the city it describes. */
  const governedWells = wells.filter(w => w.mains);
  const plumbed = pipes.size > 0 || governedWells.length > 0 || outfalls.length > 0;
  /* ⚠ `outfalls` above is the MERGED list, so a city whose only sewer endpoint
     is a Sea Drain is plumbed too. Still derived, still no stored flag, still
     nothing to migrate — the latch grew a third term and not a version number. */

  // ── 1. DEMAND, PER TILE, WITH ITS COMPONENT.
  /* Two kinds of demand and both weights come from the HOST: a consumer brings
     the draw the host is already charging it, and a home brings its share of
     the drink figure the host already publishes. This module still has not seen
     a rate — see tuning.js's note on the three numbers that are not ours. */
  const demand = [];
  for (const u of users) {
    const a = attachOf(comp, u.x, u.z);
    demand.push({ k: u.k, x: u.x, z: u.z, w: Math.max(0, Number(u.draw) || 0), comp: a.comp, kind: 'use' });
  }
  for (const h of homes) {
    const w = drink * Math.max(0, Math.min(1, Number(h.share) || 0));
    if (w <= 0) continue;
    const a = attachOf(comp, h.x, h.z);
    demand.push({ k: h.k, x: h.x, z: h.z, w, comp: a.comp, kind: 'home' });
  }

  let totalDemand = 0, attachedDemand = 0;
  const demandByComp = new Array(comp.count).fill(0);
  for (const d of demand) {
    totalDemand += d.w;
    if (d.comp >= 0) { attachedDemand += d.w; demandByComp[d.comp] += d.w; }
  }

  // ── 2. WHICH COMPONENTS HAVE A WATERWORKS ON THEM.
  const wellsByComp = new Array(comp.count).fill(0);
  const wellAttach = Object.create(null);
  for (const w of wells) {
    const a = attachOf(comp, w.x, w.z);
    wellAttach[w.k] = a.comp;
    if (a.comp >= 0) wellsByComp[a.comp]++;
  }

  /* ── 3. WHAT THE MAINS REACH, AND WHAT NOTHING REACHES.
     A demand tile is REACHED when it is attached to a component that has a
     waterworks standing on it. Everything else — a building with no pipe near
     it, and a building on a run whose only neighbour is another building — is
     unreached, and unreached is the ONE thing a player fixes with a drag.

     🔴 THIS IS COMPUTED BEFORE THE FACTOR, NOT AFTER, and that ordering is the
        whole correction this round makes. The first version of this file
        divided each station's reach by the CITY's demand, so a second properly
        plumbed district — its own station, its own pipes, its own outfall —
        took 35% off the first district's station for the crime of existing,
        while `served` in the very same object said every building was reached.
        The panel then printed "100% of demand · every building reached" three
        lines above "the worst is at 65%, a run of pipe is the whole fix" —
        advice that could not work, because nothing the player laid in the
        second district would ever raise a ratio whose denominator was the city.
        The unit of this arithmetic is the COMPONENT. */
  const served = Object.create(null);      // demand tile key -> reached by a waterworks?
  const orphans = [];
  let unservedDemand = 0, unservedTiles = 0, reachedDemand = 0;
  for (const d of demand) {
    const hit = d.comp >= 0 && wellsByComp[d.comp] > 0;
    served[d.k] = hit;
    if (hit) reachedDemand += d.w;
    else { unservedDemand += d.w; unservedTiles++; if (d.w > 0) orphans.push(d); }
  }

  /* ── 4. THE ORPHANS, CHARGED TO THE NEAREST WATERWORKS.
     Unreached demand has to land on somebody or the mains factor loses its
     gradient entirely and becomes "are you touching a pipe, yes or no". It
     lands on the governed waterworks NEAREST it, orthogonally — the one whose
     district that building plainly belongs to, and therefore the one the player
     will drag a run from. Ties go to the first well the host handed over, which
     is stable within a tick because the host walks `game.tiles` in key order.

     ⚠ AN UNGOVERNED WELL IS NEVER CHARGED AN ORPHAN. The Purifier is an
       atmospheric condenser and owes the mains nothing — the same exemption the
       factor below makes, made in one more place so a city of Purifiers cannot
       be blamed for a building it was never able to serve. */
  const orphanOf = Object.create(null);    // well key -> unreached demand it is nearest to
  if (orphans.length) {
    for (const d of orphans) {
      let bestK = null, bestD = Infinity;
      for (const w of wells) {
        if (!w.mains) continue;
        const dist = Math.abs(w.x - d.x) + Math.abs(w.z - d.z);
        if (dist < bestD) { bestD = dist; bestK = w.k; }
      }
      if (bestK != null) orphanOf[bestK] = (orphanOf[bestK] || 0) + d.w;
    }
  }

  /* ── 5. THE SEWER, PER COMPONENT.
     Waste travels down the same pipes the water came up, so the unit here is
     the component too: the load on a main is the demand attached to THAT main,
     and the only outfalls that can treat it are the ones standing on it.

     🔴 CAPACITY IS POOLED PER COMPONENT AND CAPPED ONCE. The first version
        capped each outfall individually against the full component load, so two
        outfalls on one main each "treated" the whole city's waste and the sum
        covered a DISCONNECTED main's sewage as well — backup 0.000, factor
        1.000, bit-identical to the correct one-outfall-per-run layout and below
        `warnAbove`, so the panel said nothing at all. Nameplate is added up
        first, then `min`ned against the load once.

     An outfall counts only if it is BOTH on open water AND attached to a
     component — a plant with no inlet treats nothing, and a plant with no
     outlet is a refusal at placement time (see index.js siteRefusal), so a
     standing one that fails this test is one whose river dried up under it. */
  const outRows = [];
  const nameplateByComp = new Array(comp.count).fill(0);
  for (const o of outfalls) {
    const a = attachOf(comp, o.x, o.z);
    const wet = !!o.wet;                       // decided ONCE, above, by the right predicate for the row's kind
    const cap = Number(o.cap) > 0 ? Number(o.cap) : SW.capFallback;
    const live = wet && a.comp >= 0;
    if (live) nameplateByComp[a.comp] += cap;
    outRows.push({ k: o.k, x: o.x, z: o.z, kind: o.kind || 'outfall', comp: a.comp,
                   openWater: wet, cap, live, effective: 0,
                   why: !wet ? (o.kind === 'drain' ? 'not in the sea' : 'no open water')
                             : a.comp < 0 ? 'no pipe reaches it' : '' });
  }

  /* One row per component: what it draws, what it owes, what it treats and what
     that costs the waterworks standing on it. The panel and the overlay read
     THIS — there is no second place where a per-main number is worked out. */
  const compRows = [];
  let load = 0, treated = 0, nameplate = 0;
  for (let i = 0; i < comp.count; i++) {
    const L = SW.returnFrac * demandByComp[i];
    const t = Math.min(nameplateByComp[i], L);
    const bu = L > 0 ? Math.max(0, Math.min(1, 1 - t / L)) : 0;
    load += L; treated += t; nameplate += nameplateByComp[i];
    compRows.push({ i, size: comp.sizes[i], demand: demandByComp[i], wells: wellsByComp[i],
                    load: L, nameplate: nameplateByComp[i], treated: t,
                    backup: bu, sewer: 1 - bu * SW.bite });
  }
  /* Each outfall's share of what its own main actually treats — pro rata on
     nameplate, so two equal outfalls on one main read half each rather than
     both claiming the lot. Display only; the arithmetic above is the truth. */
  for (const r of outRows) {
    if (!r.live) continue;
    const cr = compRows[r.comp];
    r.effective = cr && cr.nameplate > 0 ? (r.cap / cr.nameplate) * cr.treated : 0;
    if (r.effective <= 0 && !r.why) r.why = 'no sewage on this main yet';
  }

  /* ── 6. THE TWO FACTORS, PER WATERWORKS.
       reach  = (demand its own main reaches) / (that + the unreached demand
                nearest to it)
       mains  = unpiped + (1 - unpiped) × reach
       sewer  = its own component's, never the city's

     ⚠ THE DEGENERATE CITY IS NOT PUNISHED. A city with no water consumer and no
       housing has `totalDemand === 0`; there is nothing to reach and a ratio of
       0/0 would read as "serves nobody" and quietly halve a brand-new city's
       only waterworks. Attached ⇒ 1, unattached ⇒ the floor.
     ⚠ BUT A MAIN THAT GOES NOWHERE IN A CITY THAT HAS DEMAND IS AT THE FLOOR.
       Zero on its own main and zero orphans nearest it means every building in
       the city is already served by somebody else: this station is pumping into
       a pipe that reaches nobody, and paying it in full would make a second
       station free capacity for the price of one tile of pipe.
     ⚠ AND AN UNGOVERNED WATERWORKS IS EXACTLY 1 ON BOTH LEGS. The Purifier is an
       atmospheric condenser — its own description has said so since long before
       this file — and it is the only water building that can be standing in an
       old save. */
  const mainsFactor = Object.create(null);
  const sewerAt = Object.create(null);
  const wellRows = [];
  for (const w of wells) {
    const c = wellAttach[w.k];
    const onMain = c >= 0 ? demandByComp[c] : 0;
    const missed = orphanOf[w.k] || 0;
    let f = 1, reach = 1, sew = 1;
    if (plumbed && w.mains) {
      if (c < 0) { reach = 0; f = M.unpiped; }
      else if (totalDemand <= 0) { reach = 1; f = 1; }
      else {
        const denom = onMain + missed;
        reach = denom > 0 ? onMain / denom : 0;
        f = M.unpiped + (1 - M.unpiped) * Math.max(0, Math.min(1, reach));
      }
      if (c >= 0) sew = compRows[c].sewer;
    }
    mainsFactor[w.k] = f;
    sewerAt[w.k] = sew;
    wellRows.push({ k: w.k, x: w.x, z: w.z, comp: c, governed: !!w.mains,
                    reach, factor: f, sewer: sew, onMain, missed });
  }

  /* ── 7. THE CITY SUMMARY. Sums, and they are labelled as sums — every one of
     them is an aggregate OVER the per-component answers above, never an input
     to them. `sewerFactor` is the WORST main that has a waterworks on it,
     because once the arithmetic is per-component "every waterworks in the city
     is at X" has stopped being a true sentence and the panel must not say it. */
  const backup = load > 0 ? Math.max(0, Math.min(1, 1 - treated / load)) : 0;
  let worst = -1;
  for (const r of compRows) if (r.wells > 0 && (worst < 0 || r.sewer < compRows[worst].sewer)) worst = r.i;
  const sewerFactor = worst >= 0 ? compRows[worst].sewer : 1;

  return {
    ok: true,
    plumbed,
    pipes: pipes.size,
    drains: drains.size,
    /* Drains that are BOTH in the water and on a main. The panel and the drag
       strip print this rather than counting `drains`, because "you have three
       drains" and "three of your drains are doing anything" are different
       sentences and only the second one is advice. */
    drainsLive: outRows.filter(r => r.kind === 'drain' && r.live).length,
    components: comp.count,
    comp,                       // { id, sizes, count } — netui.js paints from this
    mainsFactor,
    sewerAt,                    // 🔴 the per-waterworks sewer leg — hydro.js reads THIS
    sewerFactor,                // the worst main's, for a headline only
    worstComp: worst,
    backup,
    sewage: { load, treated, capacity: nameplate, backup, byComp: compRows, outfalls: outRows },
    demand: { total: totalDemand, attached: attachedDemand, reached: reachedDemand,
              unserved: unservedDemand, unservedTiles, tiles: demand, served },
    wells: wellRows,
    governed: governedWells.length,
  };
}

/* The identity the whole file collapses to when it cannot answer. Handed to
   hydro.js so the tick has exactly one shape to read rather than a null check
   at every use — a guarded fallback that fires forever is this project's most
   repeated failure, and the cure is that the fallback is the IDENTITY and says
   so (`plumbed: false`). */
export function idle() {
  return {
    ok: true, plumbed: false, pipes: pipes.size, drains: drains.size, drainsLive: 0, components: 0,
    comp: { id: Object.create(null), sizes: [], count: 0 },
    mainsFactor: Object.create(null), sewerAt: Object.create(null),
    sewerFactor: 1, worstComp: -1, backup: 0,
    sewage: { load: 0, treated: 0, capacity: 0, backup: 0, byComp: [], outfalls: [] },
    demand: { total: 0, attached: 0, reached: 0, unserved: 0, unservedTiles: 0,
              tiles: [], served: Object.create(null) },
    wells: [], governed: 0,
  };
}

/* ── SAVE ───────────────────────────────────────────────────────────────────
   One string. "7,5 7,6 7,7" is 4 bytes a pipe against ~14 for a JSON array of
   two-element arrays, and a big network is the only thing here that can grow.
   Optional-with-default in both directions: `undefined` (every save written
   before this round) loads as an empty network, which is the correct reading of
   a city that had no pipes because pipes did not exist.

   ⚠ THE CITY ID IS CARRIED AND CHECKED. /src/water latches its hydrology to the
     first id it is ever given precisely because both of the host's derivations
     can move under a live city; a pipe network restored into a DIFFERENT city
     would put mains through buildings that are not there. Refused, not merged. */
export function save() {
  const b = { v: 1, cityId, p: pipes.size ? Array.from(pipes).join(' ') : '' };
  /* 🌊 `d` IS WRITTEN ONLY WHEN THERE IS ONE, AND ITS ABSENCE IS ITS VERSION
     STAMP. Every save written before this round has no `d`, which loads as "no
     drains" — the correct reading of a city that had none because they did not
     exist. Same move /src/power's line save makes ("presence of the key IS the
     version stamp"), and the same reason /src/water's `plumbed` is derived: a
     version number is a second thing that can be wrong about the city it
     describes. */
  if (drains.size) b.d = Array.from(drains).join(' ');
  return b;
}

function readCells(s, into, grid) {
  for (const k of String(s || '').split(' ')) {
    if (!k) continue;
    const p = k.split(',');
    const x = +p[0], z = +p[1];
    if (!isFinite(x) || !isFinite(z)) continue;
    /* OUT-OF-DOMAIN CELLS ARE DROPPED, NOT CLAMPED. If the apron ever shrinks,
       clamping would silently move a player's drain to a cell that is not in the
       water and then report it as broken; dropping it is the answer they can
       see and fix. /src/power/lines.js load() makes the same choice. */
    if (!inDomain(x | 0, z | 0, grid)) continue;
    into.add(K(x, z));
  }
}

export function load(blob, grid) {
  pipes = new Set();
  drains = new Set();
  if (!blob || typeof blob !== 'object') return;
  if (blob.cityId && cityId && String(blob.cityId) !== cityId) {
    try { console.warn('[water/mains] pipe network belongs to ' + blob.cityId + ', not ' + cityId + ' — ignored'); } catch (e) {}
    return;
  }
  if (blob.cityId && !cityId) cityId = String(blob.cityId);
  readCells(blob.p, pipes, grid);
  readCells(blob.d, drains, grid);
}

export default { solve, idle, components, attachOf, pathBetween, add, remove, has, keys,
                 count, reset, save, load, setCity, pipeKey, setDomain, domain,
                 addDrain, removeDrain, hasDrain, drainKeys, drainCount };
