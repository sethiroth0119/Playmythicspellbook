/* ══════════════════════════════════════════════════════════════════════════
   🚌 TRANSIT — THE NETWORK: lines, pathing, ridership, vehicles and money.
   ──────────────────────────────────────────────────────────────────────────
   🔴 THE GLOBALS TRAP (CLAUDE.md). Everything this file touches — `game`,
   `BUILDINGS`, `agents`, `bfsPath`, `cityPop`, `MythicCityBridge` — is a
   top-level `const`/`function` in node-city's module script and is invisible
   to an ES module. The ctx object node-city hands over at mount IS the
   hand-over. There is no `window.game`.

   ⚠ TWO THINGS THIS FILE DELIBERATELY DOES NOT DO, because node-city already
     does them and a second copy is how the two drift apart:
     · IT DOES NOT PATHFIND. `bfsPath(from, to, passable)` is node-city's own
       breadth-first walk of the tile graph, handed over. The only change made
       to it upstream was an OPTIONAL third argument so a train can walk track
       instead of road; with the argument omitted it is byte-for-byte the walk
       every civilian, truck and patrol car already uses.
     · IT DOES NOT MOVE VEHICLES. A bus is an ordinary entry in node-city's
       `agents[]` with the same record shape as a truck, and `agentTick` drives
       it down the path — interpolation, rotation, lane offset and all. All
       this file supplies is the NEXT LEG and the DWELL, from `advance()`.

   🔴 AND ONE THING IT ENFORCES: transit never nets positive Cinder. See
      moneyTick(). A bus company that pays you is a faucet, and this codebase
      has a retired Cinder Forge in its history to show how that ends.
   ══════════════════════════════════════════════════════════════════════════ */

import { TRANSIT_ECON as ECON, LINE_COLORS } from './tuning.js';
import * as MESH from './mesh.js';

let C = null;                    // ctx
export const state = {
  lines: [],                     // see newLine()
  seq: 0,                        // id counter, monotonic within a save
  show: true,                    // map overlay on/off
  /* Cached ridership report, recomputed on a throttle. The panel, the agent
     mixer and the money tick all read THIS — recomputing per caller would let
     three consumers disagree about the same second. */
  report: { lines: {}, riders: 0, modeShare: 0, at: 0 },
  /* 💸 Fractional Cinder owed. Whole units are charged through the bridge; the
     remainder rides here between ticks exactly like economyTick's own _spendFrac. */
  owed: 0,
  _overlay: null,
  _dirty: true,
};

export function init(ctx) {
  C = ctx;
  state._overlay = new C.THREE.Group();
  state._overlay.name = 'transit-overlay';
  try { C.scene.add(state._overlay); } catch (e) {}
}

/* ── small helpers ───────────────────────────────────────────────────────── */
const K = (x, z) => x + ',' + z;
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
/* 🚶 The job-access cache. Declared UP HERE with the rest of the module state
   rather than beside jobAccess(), because `removeLine` and `toggleStop` — both
   several hundred lines above it — clear it, and a `let` read from above its
   own declaration is a temporal-dead-zone throw waiting for the first hand to
   reorder this file. */
let _access = null, _accessAt = 0;
const XZ = (k) => { const p = String(k).split(','); return [p[0] | 0, p[1] | 0]; };
export const modeOf = (line) => ECON.modes[(line && line.mode) || 'bus'] || ECON.modes.bus;
export const byId = (id) => state.lines.find(l => l && l.id === id) || null;

/* Does the player own the licence this mode needs? Ownership is a row in the
   parent's corp_operations — node-city already knows how to ask (opsRowsOf),
   and that is handed over rather than re-derived, so the answer here is the
   same one the build shop's padlock uses. */
export function hasLicence(modeId) {
  try { return !!C.opsOwned(ECON.modes[modeId] ? ECON.modes[modeId].licence : modeId); }
  catch (e) { return false; }
}

/* ── the line model ──────────────────────────────────────────────────────── */
export function newLine(modeId) {
  const m = ECON.modes[modeId] ? modeId : 'bus';
  const used = state.lines.map(l => l.color);
  const col = (LINE_COLORS.find(c => !used.includes(c.hex)) || LINE_COLORS[state.lines.length % LINE_COLORS.length]).hex;
  const n = state.lines.filter(l => l.mode === m).length + 1;
  const line = {
    id: 'ln' + (++state.seq),
    name: (m === 'rail' ? 'Line ' : 'Route ') + n,
    mode: m, color: col, stops: [], closed: false, active: true,
  };
  state.lines.push(line);
  state._dirty = true;
  return line;
}
export function removeLine(id) {
  const i = state.lines.findIndex(l => l && l.id === id);
  if (i < 0) return false;
  const [gone] = state.lines.splice(i, 1);
  despawnFor(gone.id);
  state._dirty = true; _accessAt = 0;
  return true;
}

/* Is this tile a stop of the right kind for the mode? A line may only ever
   contain stops of its own mode — a train cannot call at a bus shelter, and
   mixing them would make legPath ask the track graph to reach a road tile. */
export function isStopFor(k, modeId) {
  const t = C.game.tiles[k];
  const m = ECON.modes[modeId]; if (!t || !m) return false;
  return t.type === m.stopType;
}
export function isTrack(k) {
  const t = C.game.tiles[k];
  return !!t && t.type === 'railtrack';
}

/* Add / remove / reorder a stop. Returns a short reason string on refusal so
   the caller can say WHY rather than doing nothing (a click that silently
   fails reads as a broken tool). */
export function toggleStop(lineId, k) {
  const L = byId(lineId); if (!L) return 'no-line';
  if (!isStopFor(k, L.mode)) return 'wrong-type';
  const i = L.stops.indexOf(k);
  _accessAt = 0;
  if (i >= 0) { L.stops.splice(i, 1); state._dirty = true; return 'removed'; }
  L.stops.push(k); state._dirty = true; return 'added';
}

/* Drop stops whose building is gone (demolished, raided away, or never in the
   save). Called on every recompute rather than hooked into demolish: a hook has
   to be in the right place forever, and this is simply always true. */
function usableStops(L) {
  const out = [];
  for (const k of (L.stops || [])) if (isStopFor(k, L.mode) && out.indexOf(k) < 0) out.push(k);
  if (out.length !== (L.stops || []).length) { L.stops = out; state._dirty = true; }
  return out;
}

/* ── pathing ─────────────────────────────────────────────────────────────
   A stop is a BUILDING; vehicles run on the road (or track) beside it. The
   "node" for a stop is therefore its first adjacent runnable tile, picked in a
   fixed NEI order so the answer is stable between calls — an unstable node
   would make the route ribbon flicker between two lanes on every recompute. */
export function stopNode(k, modeId) {
  const [x, z] = XZ(k);
  const rail = ECON.modes[modeId] && ECON.modes[modeId].runsOn === 'track';
  for (const [dx, dz] of C.NEI) {
    const nk = K(x + dx, z + dz);
    if (rail ? isTrack(nk) : C.isRoad(x + dx, z + dz)) return nk;
  }
  return null;
}
const railPass = (x, z) => isTrack(K(x, z));

/* One leg, stop → stop, as a list of tile keys. Reuses node-city's bfsPath. */
export function legPath(fromK, toK, modeId) {
  const a = stopNode(fromK, modeId), b = stopNode(toK, modeId);
  if (!a || !b) return null;
  if (a === b) return null;                       // two stops sharing one node
  const rail = ECON.modes[modeId] && ECON.modes[modeId].runsOn === 'track';
  try { return C.bfsPath(a, b, rail ? railPass : null); } catch (e) { return null; }
}

/* Why can this line not run? One string, or null when it can. The panel prints
   it verbatim: "this line is broken" with no reason is the thing players file
   bug reports about. */
export function faultOf(L) {
  const m = modeOf(L);
  if (!L.active) return 'Suspended by you.';
  if (!hasLicence(L.mode)) return 'You no longer hold the ' + (L.mode === 'rail' ? 'Rail Operator' : 'Bus Company') + ' licence.';
  const stops = usableStops(L);
  if (stops.length < m.minStops) return 'Needs at least ' + m.minStops + ' stops — it has ' + stops.length + '.';
  for (const k of stops) if (!stopNode(k, L.mode)) {
    return 'The stop at ' + k + ' has no ' + (m.runsOn === 'track' ? 'track' : 'road') + ' beside it.';
  }
  const legs = allLegs(L);
  if (!legs) {
    return 'No ' + (m.runsOn === 'track' ? 'track' : 'road') + ' route connects every stop in order.';
  }
  return null;
}

/* Every leg of the line in order, or null if any of them cannot be walked.
   A closed line gets the return leg from the last stop back to the first. */
export function allLegs(L) {
  const stops = usableStops(L);
  if (stops.length < 2) return null;
  const legs = [];
  for (let i = 0; i < stops.length - 1; i++) {
    const p = legPath(stops[i], stops[i + 1], L.mode);
    if (!p) return null;
    legs.push(p);
  }
  if (L.closed) {
    const p = legPath(stops[stops.length - 1], stops[0], L.mode);
    if (!p) return null;
    legs.push(p);
  }
  return legs;
}
export const runnable = (L) => faultOf(L) === null;

/* ── ridership ───────────────────────────────────────────────────────────
   Read the header in tuning.js before changing any of this. In one sentence:
   a line carries min(the citizens whose BOTH ends it reaches, the seats it is
   actually running), and the city's mode share is the sum, capped. */
let _jobSet = null, _jobSetAt = 0;
function jobTypes() {
  const now = C.now();
  if (_jobSet && now - _jobSetAt < 30000) return _jobSet;
  /* 🔴 A FUNCTION, NOT A LIST — and this is the eighth instance of node-city's
     own load-order bug class, met from the other side. The host used to expose
     a top-level `const WORKPLACES` snapshot that froze BUILDINGS before the
     `op_*` rows were registered, so no operation could ever be a commute
     destination; it is a `workplaceTypes()` getter now. Taking a callable here
     is what keeps this module correct against BOTH shapes, and the 30s cache
     below is what stops a getter being called per line per tick. */
  const src = (typeof C.WORKPLACES === 'function') ? C.WORKPLACES() : C.WORKPLACES;
  _jobSet = new Set(src || []); _jobSetAt = now;
  return _jobSet;
}
function cityWeights() {
  const jobs = jobTypes();
  const home = {}, work = {};
  let homeTotal = 0, workTotal = 0;
  for (const k in C.game.tiles) {
    const t = C.game.tiles[k];
    if (!t || t.damaged || t.type === 'anchor') continue;
    const def = C.BUILDINGS[t.type]; if (!def) continue;
    if (t.type === 'housing') { const w = Math.max(1, t.lvl | 0); home[k] = w; homeTotal += w; }
    else if (jobs.has(t.type)) { const w = Math.max(1, def.crew | 0); work[k] = w; workTotal += w; }
  }
  return { home, work, homeTotal, workTotal };
}
/* The tiles a line's stops draw from: a Chebyshev square of `walkRadius`
   around each stop. Deliberately NOT a road-distance walk — a citizen crossing
   a car park to reach a shelter is not doing anything unreasonable, and a
   road-distance version would make a stop's catchment depend on the street
   layout in a way no player could predict from looking at it. */
function servedKeys(L) {
  const R = ECON.walkRadius, out = new Set();
  for (const s of usableStops(L)) {
    const [x, z] = XZ(s);
    for (let dx = -R; dx <= R; dx++) for (let dz = -R; dz <= R; dz++) out.add(K(x + dx, z + dz));
  }
  return out;
}
export function recompute(force) {
  const now = C.now();
  if (!force && now - state.report.at < 1500) return state.report;
  const W = cityWeights();
  const pop = Math.max(0, C.cityPop());
  const lines = {};
  let riders = 0;
  for (const L of state.lines) {
    const m = modeOf(L);
    const veh = vehiclesOf(L.id).length;
    const fault = faultOf(L);
    const served = servedKeys(L);
    let hw = 0, ww = 0;
    served.forEach(k => { hw += W.home[k] || 0; ww += W.work[k] || 0; });
    const homeReach = W.homeTotal > 0 ? hw / W.homeTotal : 0;
    const workReach = W.workTotal > 0 ? ww / W.workTotal : 0;
    const pair = Math.min(homeReach, workReach);
    const demand = pop * ECON.tripsPerCitizen * pair;
    const capacity = veh * m.seats;
    const r = fault ? 0 : Math.min(demand, capacity);
    lines[L.id] = { fault, vehicles: veh, homeReach, workReach, demand, capacity, riders: r,
                    stops: usableStops(L).length,
                    tiles: fault ? 0 : (allLegs(L) || []).reduce((s, p) => s + p.length, 0) };
    riders += r;
  }
  const ceiling = pop * ECON.tripsPerCitizen * ECON.maxModeShare;
  if (riders > ceiling) {
    /* Overlapping lines double-count the same commuter. Scale every line back
       proportionally rather than truncating the last one — the panel has to be
       able to say "this line carries N" and have the N's add up to the total. */
    const f = ceiling / riders;
    for (const id in lines) lines[id].riders *= f;
    riders = ceiling;
  }
  state.report = { lines, riders, modeShare: pop > 0 ? Math.min(ECON.maxModeShare, riders / (pop * ECON.tripsPerCitizen)) : 0, at: now };
  return state.report;
}

/* ── 🚶 JOB ACCESS — THE ONE THING THIS MODULE DOES TO THE CITIZEN SIM ────
   Read TRANSIT_ECON.commute in tuning.js first; the WHY, and the measurement
   that forced it, are written out there.

   Scores every job in the city, crew-weighted, into walkable / driveable /
   stranded, and answers ONE number: `access`, the share of the city's jobs its
   residents can actually turn up to. /src/demographics multiplies the labour
   ladder it hands `households.hire()` by it, so a stranded job goes unfilled
   even with idle residents standing about — which is the whole point.

   🔴 MONOTONIC IN MODE SHARE, BY CONSTRUCTION. `access` rises with `served` and
      nothing else in it moves, so building a line can only ever raise it and
      deleting one puts the city back exactly where it started. An employment
      gate that could be made WORSE by transit would be a trap rather than a
      feature, and this is the line that stops it being one.
   ⚠ IT IS A CITY AGGREGATE, NOT A PER-JOB ANSWER. `served` is the network's
     mode share, applied to the stranded pool as a whole — the model does not
     ask whether THIS line reaches THAT particular estate. Said plainly here
     rather than implied by the code, because the ridership model above makes
     the same admission and for the same reason.
   ⚠ AND IT COSTS A FULL TILE SWEEP, so it rides the same throttle the
     ridership report does. `hire()` runs on the economy beat — once a second
     in the live loop — and an unthrottled sweep of a 576-tile city there would
     be the most expensive thing in the tick. */
export function jobAccess(force) {
  const now = C.now();
  if (!force && _access && now - _accessAt < 1500) return _access;
  const W = cityWeights();
  const car = clamp01(+ECON.commute.carAccess);
  if (!(W.workTotal > 0)) {
    /* No jobs is not "no access" — it is no question. Answering 1 keeps a city
       with nothing built behaving exactly as it did before this existed. */
    _access = { walk: 1, car, served: 0, access: 1, jobs: 0, walkable: 0, stranded: 0 };
    _accessAt = now; return _access;
  }
  /* Dilate the HOUSING map by walkRadius and ask which jobs fall inside it.
     Dilating the homes rather than testing each job against every home is what
     keeps this O(homes·R²+jobs) instead of O(homes·jobs). */
  const R = ECON.walkRadius, covered = new Set();
  for (const k in W.home) {
    const [x, z] = XZ(k);
    for (let dx = -R; dx <= R; dx++) for (let dz = -R; dz <= R; dz++) covered.add(K(x + dx, z + dz));
  }
  let walkJobs = 0;
  for (const k in W.work) if (covered.has(k)) walkJobs += W.work[k];
  const walk = clamp01(walkJobs / W.workTotal);
  /* ⚠ FORCE PROPAGATES. `recompute()` has its own 1.5 s throttle, and a forced
     jobAccess() that read a stale report answered with the mode share of a line
     the player had ALREADY DELETED — caught by the "deleting the line puts the
     city back exactly where it was" probe in verify-transit-access.js, which is
     the only thing in this feature that could have caught it. */
  const served = clamp01(recompute(force).modeShare);
  const access = clamp01(walk + (1 - walk) * (car + (1 - car) * served));
  _access = { walk, car, served, access, jobs: W.workTotal, walkable: walkJobs,
              stranded: W.workTotal - walkJobs };
  _accessAt = now;
  return _access;
}

/* What the network is standing on, for upkeep. Counted from the CITY, not from
   the lines: a bus stop you built and never put on a route still costs money to
   keep, which is what stops "build 40 shelters, use 3" being free. */
export function infrastructure() {
  let busstop = 0, trainstation = 0, railtrack = 0;
  for (const k in C.game.tiles) {
    const t = C.game.tiles[k]; if (!t) continue;
    if (t.type === 'busstop') busstop++;
    else if (t.type === 'trainstation') trainstation++;
    else if (t.type === 'railtrack') railtrack++;
  }
  return { busstop, trainstation, railtrack };
}
/* The full bill, in the per-minute units every gen:{cinder} figure uses. */
export function ledger() {
  const inf = infrastructure();
  const U = ECON.upkeep;
  let upkeep = inf.busstop * U.busstop + inf.trainstation * U.trainstation + inf.railtrack * U.railtrack;
  let buses = 0, trains = 0;
  for (const a of C.agents) {
    if (!a || !a.line) continue;
    if (a.kind === 'train') trains++; else buses++;
  }
  upkeep += buses * U.busVehicle + trains * U.trainVehicle;
  const rep = state.report;
  const fares = rep.riders * ECON.farePerRider;
  /* 🔴 NEVER POSITIVE. Fares reduce the subsidy; they can never become income.
     See the tuning header — this one clamp is the whole anti-faucet guard. */
  const net = Math.min(0, fares - upkeep);
  return { inf, buses, trains, upkeep, fares, net, riders: rep.riders };
}

/* ── money ───────────────────────────────────────────────────────────────
   Charged on the economy's own beat, in whole Cinder, through the same bridge
   call every other spend in the city uses. Fractions ride `state.owed` between
   ticks exactly like economyTick's own _spendFrac. */
export async function moneyTick(dtMin) {
  if (!state.lines.length) {
    const inf = infrastructure();
    if (!inf.busstop && !inf.trainstation && !inf.railtrack) return;   // nothing built: free
  }
  recompute();
  const L = ledger();
  state.owed += -L.net * dtMin / 60;          // per-minute units → per-hour (CINDER_PERIOD_DIV)
  if (state.owed >= 1) {
    const whole = Math.floor(state.owed);
    state.owed -= whole;
    try { await C.spendCinders(whole); } catch (e) {}
  }
}

/* ── vehicles ────────────────────────────────────────────────────────────
   Spawned INTO node-city's own agents[] with the same record shape a truck
   has, so agentTick drives them. `line` is the only extra field, and it is
   also the flag agentTick's transit hook tests. */
export const vehiclesOf = (lineId) => C.agents.filter(a => a && a.line === lineId);

function despawnFor(lineId) {
  for (const a of vehiclesOf(lineId).slice()) { try { C.despawnAgent(a); } catch (e) {} }
}
/* `at` is the stop this vehicle starts from. manage() spreads it around the
   line rather than starting every bus at stop 0 — identical speeds on an
   identical path means vehicles that start together NEVER separate, and three
   buses nose-to-tail for the rest of the session is the single most obvious
   way a transit sim looks fake. */
function spawnVehicle(L, at) {
  const m = modeOf(L);
  const stops = usableStops(L);
  const idx = Math.max(0, Math.min(stops.length - 1, at | 0));
  const startNode = stopNode(stops[idx], L.mode);
  if (!startNode) return false;
  const fwd = idx + 1 < stops.length;
  const nextIdx = L.closed ? (idx + 1) % stops.length : (fwd ? idx + 1 : idx - 1);
  if (nextIdx === idx) return false;
  const path = legPath(stops[idx], stops[nextIdx], L.mode);
  if (!path || path.length < 2) return false;
  const mesh = (L.mode === 'rail') ? MESH.makeTrain(L.color) : MESH.makeBus(L.color);
  const [x, z] = XZ(startNode);
  mesh.position.set(x - C.HALF + .5, 0, z - C.HALF + .5);
  try { C.agentGroup.add(mesh); } catch (e) { return false; }
  C.agents.push({
    kind: L.mode === 'rail' ? 'train' : 'bus',
    mesh, path, i: 0, t: 0, speed: m.speed, dwell: 0, state: 'travel',
    /* A train sits on its track centreline; a bus keeps to the near lane like
       every other road vehicle. Same field agentTick already reads. */
    lateral: L.mode === 'rail' ? 0 : .10,
    line: L.id, stopIdx: nextIdx, dir: (L.closed || fwd) ? 1 : -1, fails: 0,
  });
  return true;
}
export function manage() {
  const live = new Set(state.lines.map(l => l.id));
  for (const a of C.agents.slice()) {
    if (a && a.line && !live.has(a.line)) { try { C.despawnAgent(a); } catch (e) {} }
  }
  for (const L of state.lines) {
    const m = modeOf(L);
    const ok = runnable(L);
    const want = ok ? Math.max(1, Math.min(m.maxVehicles,
      Math.round(usableStops(L).length / m.stopsPerVehicle))) : 0;
    let have = vehiclesOf(L.id).length;
    let guard = 8;
    const n = usableStops(L).length;
    while (have < want && guard-- > 0) {
      if (!spawnVehicle(L, Math.floor(have * n / Math.max(1, want)))) break;
      have++;
    }
    while (have > want) {
      const a = vehiclesOf(L.id)[0]; if (!a) break;
      try { C.despawnAgent(a); } catch (e) {}
      have--;
    }
  }
  if (state._dirty) rebuildOverlay();
}

/* THE ONE THING agentTick ASKS US. The vehicle has reached the end of its
   path — i.e. it is standing at a stop. Give it the next leg and the dwell.
   Returns true always for a transit agent: this function OWNS the decision,
   including the decision to despawn, and falling through to the wander logic
   would have a bus walk into somebody's house. */
export function advance(a) {
  const L = byId(a.line);
  if (!L) { try { C.despawnAgent(a); } catch (e) {} return true; }
  const stops = usableStops(L);
  const m = modeOf(L);
  if (stops.length < 2 || !runnable(L)) { try { C.despawnAgent(a); } catch (e) {} return true; }

  let idx = Math.max(0, Math.min(stops.length - 1, a.stopIdx | 0));
  let next;
  if (L.closed) next = (idx + 1) % stops.length;
  else {
    next = idx + (a.dir || 1);
    if (next < 0 || next >= stops.length) { a.dir = -(a.dir || 1); next = idx + a.dir; }
    if (next < 0 || next >= stops.length) { try { C.despawnAgent(a); } catch (e) {} return true; }
  }
  const p = legPath(stops[idx], stops[next], L.mode);
  if (!p || p.length < 2) {
    /* The network changed under a moving vehicle (a road demolished mid-run is
       the common case). Hold at the stop and try again rather than vanishing —
       a bus that disappears the instant a player edits a street reads as a
       crash. Three strikes and it goes back to the depot. */
    a.dwell = 3; a.fails = (a.fails | 0) + 1;
    if (a.fails > 3) { try { C.despawnAgent(a); } catch (e) {} }
    return true;
  }
  a.fails = 0;
  a.stopIdx = next;
  a.path = p; a.i = 0; a.t = 0;
  a.dwell = m.dwellSec;
  return true;
}

/* ── the map overlay ─────────────────────────────────────────────────────── */
export function rebuildOverlay() {
  state._dirty = false;
  const g = state._overlay; if (!g) return;
  for (const ch of g.children.slice()) g.remove(ch);
  try { C.disposeOwnedGeo(g); } catch (e) {}
  g.visible = !!state.show;
  if (!state.show) return;
  let budget = ECON.overlay.maxSegments;
  for (const L of state.lines) {
    const legs = allLegs(L); if (!legs) continue;
    for (const p of legs) {
      for (let i = 0; i < p.length - 1 && budget > 0; i++, budget--) {
        const [ax, az] = XZ(p[i]), [bx, bz] = XZ(p[i + 1]);
        g.add(MESH.overlaySegment(L.color, ax - C.HALF + .5, az - C.HALF + .5,
                                  bx - C.HALF + .5, bz - C.HALF + .5,
                                  ECON.overlay.y, ECON.overlay.width));
      }
    }
    /* A pip on each stop, so a stop that is ON a line is distinguishable from
       one the player built and forgot to add. */
    for (const s of usableStops(L)) {
      if (budget-- <= 0) break;
      const [x, z] = XZ(s);
      g.add(MESH.overlaySegment(L.color, x - C.HALF + .5, z - C.HALF + .5,
                                x - C.HALF + .5, z - C.HALF + .5,
                                ECON.overlay.y + .004, ECON.overlay.width * 2.6));
    }
  }
}
export function setShow(on) { state.show = !!on; state._dirty = true; rebuildOverlay(); }
/* 🚶 …and it drops the JOB-ACCESS cache too. The network changing is exactly
   when the commute answer stops being true, and a 1.5 s stale reading of it is
   a stale reading of somebody's employment. */
export const markDirty = () => { state._dirty = true; _accessAt = 0; };

/* ── the effect on the simulation ────────────────────────────────────────
   Two wires, and they are the honest half of "the NPCs use it":
     1. a served commute is made by bus, so it is not made by car;
     2. the citizens making it walk to a STOP, not to an arbitrary road.
   What is NOT modelled: an individual civilian is not carried inside a bus
   mesh. Mode share is statistical, computed from how much of the city's
   housing and how many of its jobs each line's stops actually reach. Said
   plainly in the panel, because a claim the code does not back is worse than
   an admitted limitation. */
export function adjustAgentCounts(want) {
  if (!want) return;
  const share = (recompute().modeShare) || 0;
  if (share <= 0) return;
  want.car = Math.max(0, Math.round((want.car | 0) * (1 - share)));
}
let _stopRoads = null, _stopRoadsAt = 0;
function stopRoads() {
  const now = C.now();
  if (_stopRoads && now - _stopRoadsAt < 4000) return _stopRoads;
  const out = [];
  for (const L of state.lines) {
    if (!runnable(L)) continue;
    for (const s of usableStops(L)) {
      const n = stopNode(s, L.mode);
      /* A TRAIN's node is a track tile, and a pedestrian cannot walk down the
         railway. Send them to the road beside the STATION instead. */
      if (L.mode === 'rail') {
        const [x, z] = XZ(s);
        for (const [dx, dz] of C.NEI) if (C.isRoad(x + dx, z + dz)) { out.push(K(x + dx, z + dz)); break; }
      } else if (n) out.push(n);
    }
  }
  _stopRoads = [...new Set(out)]; _stopRoadsAt = now;
  return _stopRoads;
}
export function endpoints(kind, agent, base) {
  if (kind !== 'civilian') return null;
  const share = (state.report.modeShare) || 0;
  if (share <= 0) return null;
  if (Math.random() > share * ECON.walkToStopShare) return null;
  const roads = stopRoads();
  if (roads.length < 2) return null;
  return { from: base && base.from && base.from.length ? base.from : roads, to: roads };
}

/* ── save / load ─────────────────────────────────────────────────────────
   Absent-tolerant by construction: a save written before transit existed has
   no `transit` key, load(undefined) produces an empty network, and nothing
   else in the city changes. Sanitising happens HERE and not in loadState, the
   same division the House and the Stadium already use. */
export function save() {
  return {
    v: 1, seq: state.seq | 0, show: !!state.show,
    lines: state.lines.slice(0, 24).map(L => ({
      id: String(L.id), name: String(L.name || '').slice(0, 40),
      mode: L.mode === 'rail' ? 'rail' : 'bus',
      color: L.color >>> 0, closed: !!L.closed, active: L.active !== false,
      stops: (L.stops || []).slice(0, 60).map(String),
    })),
  };
}
export function load(raw) {
  state.lines = []; state.seq = 0; state.show = true; state.owed = 0; _accessAt = 0;
  if (!raw || typeof raw !== 'object') { state._dirty = true; return; }
  if (typeof raw.show === 'boolean') state.show = raw.show;
  const seen = new Set();
  for (const r of (Array.isArray(raw.lines) ? raw.lines : []).slice(0, 24)) {
    if (!r || typeof r !== 'object') continue;
    const id = String(r.id || '').slice(0, 24) || ('ln' + (state.lines.length + 1));
    if (seen.has(id)) continue; seen.add(id);
    const mode = r.mode === 'rail' ? 'rail' : 'bus';
    const known = LINE_COLORS.some(c => c.hex === (r.color >>> 0));
    state.lines.push({
      id,
      name: String(r.name || 'Route').slice(0, 40) || 'Route',
      mode,
      color: known ? (r.color >>> 0) : LINE_COLORS[state.lines.length % LINE_COLORS.length].hex,
      closed: !!r.closed, active: r.active !== false,
      stops: (Array.isArray(r.stops) ? r.stops : []).slice(0, 60)
        .map(String).filter(k => /^-?\d+,-?\d+$/.test(k)),
    });
    const n = parseInt(id.replace(/\D/g, ''), 10);
    if (Number.isFinite(n) && n > state.seq) state.seq = n;
  }
  if (Number.isFinite(+raw.seq) && +raw.seq > state.seq) state.seq = +raw.seq | 0;
  state._dirty = true;
}
