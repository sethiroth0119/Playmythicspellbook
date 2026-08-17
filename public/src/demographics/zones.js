/* ════════════════════════════════════════════════════════════════════════════
   🏘 ZONES → DWELLINGS. The half of this feature that makes zoning a decision.
   ----------------------------------------------------------------------------
   A tile does not hold "population". It holds DWELLINGS, and how many depends
   entirely on what it was zoned as: one detached house, three terraces, six
   apartments, fourteen flats in a tower. The households that then want those
   dwellings are drawn from that zone's own bag. That is the whole mechanism —
   the same 20 tiles are a village or a district depending on one choice, and
   the people in them are different people.

   ── 🔴 THE ZONING MODULE MAY NOT EXIST, AND THIS MUST NOT CARE ──────────────
   /src/zoning is being built alongside this one and owns THE ZONE TYPE PER
   TILE. It is read here through a guarded window lookup with three accepted
   shapes and a keyword normaliser, because a sibling module's exact API is not
   a thing to hard-code against before it lands — and if it never lands, or
   404s, `deriveFromBuilding()` reads a zone off the building the player already
   placed and the feature works alone. Same contract node-city itself uses for
   /src/economy (index.html ~line 30520): a missing module costs its own
   feature and nothing else.

   🔴 AND THE FALLBACK NEVER RAISES THE CITY'S POPULATION CAP. `capacityDelta()`
   counts EXPLICITLY ZONED parcels only. A derived zone is derived from a
   Housing tile that ALREADY grants node-city its `popCap` — counting it again
   would hand every existing save a silent population increase from a module
   that is supposed to be describing it, not changing it. Zoning proper is new
   capacity and is added; a guess about an existing building is not.
   ════════════════════════════════════════════════════════════════════════════ */

import { ECON } from '../economy/tuning.js';
import * as A from './archetypes.js';

const D = () => ECON.demographics;

export function zoneIds() { return Object.keys(D().zones); }
export function zoneDef(id) { return D().zones[id] || null; }
export function isResidential(id) { return !!zoneDef(id); }

/* 🔁 HOW FAST THIS ZONE'S TENANCIES END — the share of its occupied dwellings
   that change hands per economic day. A cheap flat turns over most of a year; a
   detached house people bought turns over once a generation. It is a property of
   the HOUSING, which is why it is per zone and not one city-wide number.
   ⚠ It reads ECON.demographics.turnover rather than the zone def so that a zone
     added by a retune cannot silently arrive with NO turnover — a zone that
     never turns over is a zone whose `bag` stops meaning anything the moment it
     fills, which is exactly the ratchet this table was added to retire (see the
     table's own header for the 80 → 9 student measurement). Missing means the
     default, never zero. */
export function turnoverOf(zoneId) {
  const t = D().turnover || {};
  const raw = t[zoneId] != null ? t[zoneId] : t.dflt;
  const v = Number(raw);
  return isFinite(v) && v > 0 ? v : 0;
}

/* ── THE NORMALISER ─────────────────────────────────────────────────────────
   /src/zoning is free to call its zones anything: 'res_low', 'residential-low',
   'lowDensity', 'RES_LOW_DETACHED'. This maps whatever arrives onto the six ids
   in ECON.demographics.zones by KEYWORD, not by table, so a name we never
   anticipated still lands somewhere sensible instead of being dropped.
   Returns null for anything that is not residential — commercial, office,
   industrial and warehouse zones hold jobs, not homes, and this module has an
   opinion about neither. */
export function normalizeZone(raw) {
  if (raw == null) return null;
  const exact = String(raw);
  if (D().zones[exact]) return exact;
  const s = exact.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (!s) return null;
  // Non-residential first: 'commercialLow' contains 'low' and must not become
  // low-density housing.
  if (/(commerc|office|industr|warehouse|manufact|farm|park|utility|service)/.test(s)) return null;
  if (/(lowrent|cheap|social|affordable)/.test(s)) return 'resLowRent';
  if (/mixed/.test(s)) return 'resMixed';
  if (/(row|terrace|townhouse|walltowall)/.test(s)) return 'resRow';
  if (/(high|tower|skyscraper)/.test(s)) return 'resHigh';
  if (/(apart|flat|medium|mid)/.test(s)) return 'resApt';
  if (/(low|detached|suburb|single)/.test(s)) return 'resLow';
  if (/res/.test(s)) return 'resApt';           // "residential", unqualified
  return null;
}

/* ── THE GUARDED READ ───────────────────────────────────────────────────────
   Three shapes accepted, in order of how likely a zoning module is to offer
   them, and every one of them inside the same try: a sibling that throws is a
   sibling that is absent.
     1. zoneOf(key) / zoneAt(x, z)  → an id (or {zone} / {type})
     2. zones() / list() / all()    → array of rows, or a key→id map
     3. state().zones               → the same map one level down
   ⚠ THE RESULT IS CACHED FOR ONE TICK, keyed on nothing: `beginTick()` clears
     it. A per-tile call into another module for 200 tiles on every beat is the
     kind of cost that only shows up on the machine of the player with the
     biggest city. */
let ZCACHE = null;
export function beginTick() { ZCACHE = null; }

function zoningApi() {
  try {
    if (typeof window === 'undefined') return null;
    const z = window.MythicZoning || (window.__nc && window.__nc.zoning) || null;
    return (z && typeof z === 'object') ? z : null;
  } catch (e) { return null; }
}
export function zoningPresent() { return !!zoningApi(); }

function zoneMap() {
  if (ZCACHE) return ZCACHE;
  ZCACHE = { byKey: null, fn: null, fnXZ: null };
  const z = zoningApi();
  if (!z) return ZCACHE;
  try {
    if (typeof z.zoneOf === 'function') ZCACHE.fn = z.zoneOf.bind(z);
    if (typeof z.zoneAt === 'function') ZCACHE.fnXZ = z.zoneAt.bind(z);
    let rows = null;
    for (const name of ['zones', 'list', 'all', 'tiles']) {
      if (typeof z[name] === 'function') { rows = z[name](); break; }
      if (z[name] && typeof z[name] === 'object') { rows = z[name]; break; }
    }
    if (!rows && typeof z.state === 'function') {
      const st = z.state();
      rows = (st && (st.zones || st.tiles)) || null;
    }
    if (rows) {
      const byKey = new Map();
      if (Array.isArray(rows)) {
        for (const r of rows) {
          if (!r) continue;
          const key = r.key != null ? String(r.key) : (r.x != null && r.z != null ? r.x + ',' + r.z : null);
          if (key == null) continue;
          byKey.set(key, r.zone != null ? r.zone : (r.type != null ? r.type : r.id));
        }
      } else {
        for (const k in rows) {
          const r = rows[k];
          byKey.set(String(k), (r && typeof r === 'object') ? (r.zone != null ? r.zone : r.type) : r);
        }
      }
      ZCACHE.byKey = byKey;
    }
  } catch (e) { /* a sibling that throws is a sibling that is absent */ }
  return ZCACHE;
}

/* The zone /src/zoning says this parcel is, or null. Never throws. */
export function explicitZone(parcel) {
  if (!parcel) return null;
  // The host may already carry the zone on the tile (it owns game.tiles, and a
  // zoning module that writes there is the cheapest possible integration).
  const own = normalizeZone(parcel.zone);
  if (own) return own;
  const m = zoneMap();
  try {
    if (m.byKey && parcel.key != null) {
      const hit = m.byKey.get(String(parcel.key));
      const n = normalizeZone(hit);
      if (n) return n;
    }
    if (m.byKey && parcel.x != null && parcel.z != null) {
      const n = normalizeZone(m.byKey.get(parcel.x + ',' + parcel.z));
      if (n) return n;
    }
    if (m.fn && parcel.key != null) {
      const n = normalizeZone(m.fn(parcel.key));
      if (n) return n;
    }
    if (m.fnXZ && parcel.x != null && parcel.z != null) {
      const n = normalizeZone(m.fnXZ(parcel.x, parcel.z));
      if (n) return n;
    }
  } catch (e) { /* see above */ }
  return null;
}

/* ── THE FALLBACK ───────────────────────────────────────────────────────────
   No zoning module: read the zone off what the player built. node-city has one
   residential building type (`housing`, +6 popCap per level), so LEVEL is the
   only density signal there is — and it is a real one: a level-5 Housing is
   already, visually and mechanically, a block of flats rather than a cottage.
   `lot` (Lease Plot) is literally described in BUILDINGS as "zoned land" and
   leases to somebody else, which is the closest thing this city has to low-rent
   housing today.
   ⚠ Derived zones are DESCRIPTIVE ONLY — see capacityDelta(). */
export function deriveFromBuilding(parcel) {
  if (!parcel) return null;
  const t = String(parcel.type || '');
  const lvl = Math.max(1, parcel.lvl | 0 || 1);
  if (t === 'lot') return 'resLowRent';
  if (t !== 'housing') return null;
  if (lvl <= 1) return 'resLow';
  if (lvl === 2) return 'resRow';
  if (lvl === 3) return 'resApt';
  if (lvl === 4) return 'resMixed';
  return 'resHigh';
}

/* The zone of a parcel and where the answer came from. `src` is surfaced in the
   panel because "the city is guessing" and "the city was told" are different
   states and the player is entitled to know which one they are looking at. */
export function zoneOf(parcel) {
  const e = explicitZone(parcel);
  if (e) return { id: e, src: 'zoned' };
  const d = deriveFromBuilding(parcel);
  if (d) return { id: d, src: 'derived' };
  return { id: null, src: 'none' };
}

/* Dwellings on one parcel. Level scales it, because upgrading a building is the
   existing city's only density control and it should mean the same thing here
   as it means everywhere else. */
export function homesOn(zoneId, lvl) {
  const z = zoneDef(zoneId); if (!z) return 0;
  const n = Math.max(1, lvl | 0 || 1);
  return Math.max(0, Math.round(z.homes + z.perLevel * (n - 1)));
}

/* People a zone's dwellings hold when full, using each zone's own bag —
   fourteen single-person flats and one six-person family are the same tile. */
export function headsPerHome(zoneId) {
  const z = zoneDef(zoneId); if (!z) return 1;
  let n = 0, w = 0;
  for (const a in z.bag) {
    const weight = Math.max(0, z.bag[a] || 0);
    if (!weight) continue;
    n += A.avgSize(a) * weight; w += weight;
  }
  return w > 0 ? n / w : 1;
}
export function capacityOf(zoneId, lvl) {
  return homesOn(zoneId, lvl) * headsPerHome(zoneId);
}

/* ── SURVEY ─────────────────────────────────────────────────────────────────
   The host hands over its tiles once per tick; this turns them into the only
   two things the pipeline needs: dwellings per zone, and how much of that the
   city's own population cap has already accounted for.

   `parcels` rows: { key, x, z, type, lvl, popCap, site }
     · popCap — what THIS tile already contributes to node-city's popCap(). The
       host is the only thing that can know it (BUILDINGS is a top-level const
       over there — the globals trap), and without it capacityDelta() would
       double-count every Housing tile in the city.
     · site   — under construction. A hole in the ground houses nobody, exactly
       as it produces nothing (node-city's bldSite invariant). */
export function survey(parcels) {
  const out = {
    homes: {}, capacity: {}, tiles: {}, zoned: {}, byKey: new Map(),
    totalHomes: 0, totalCapacity: 0, zonedCapacity: 0, zonedPopCap: 0,
    zonedTiles: 0, derivedTiles: 0,
  };
  for (const id of zoneIds()) { out.homes[id] = 0; out.capacity[id] = 0; out.tiles[id] = 0; out.zoned[id] = 0; }
  if (!Array.isArray(parcels)) return out;
  for (const p of parcels) {
    if (!p || p.site) continue;
    const z = zoneOf(p);
    if (!z.id) continue;
    const lvl = Math.max(1, p.lvl | 0 || 1);
    let homes = homesOn(z.id, lvl);
    if (homes <= 0) continue;
    const heads = headsPerHome(z.id);
    let cap = homes * heads;
    /* 🔴 THE HOST'S OWN OPINION WINS WHEN IT IS HIGHER, AND THIS IS NOT
       DEFENSIVE PADDING — it is the difference between describing a city and
       silently shrinking one. node-city's Housing grants +6 popCap per level;
       a level-1 Housing read as one detached family house holds about three.
       Without this line, every EXISTING save would hand the economy roughly
       half the residents it had the day this module shipped — a population cut
       delivered by a feature whose whole job is to explain the population.
       ECONOMY.md records the same trap from the other end: a labour sweep that
       ignored the host's real housing cap "confidently pointed the wrong way".
       So capacity is the GREATER of the two, and the zone then decides who
       fills it — which is the half this module is actually entitled to. */
    const hostCap = Math.max(0, +p.popCap || 0);
    if (hostCap > cap) { cap = hostCap; homes = Math.max(homes, Math.round(cap / Math.max(0.1, heads))); }
    out.homes[z.id] += homes;
    out.capacity[z.id] += cap;
    out.tiles[z.id] += 1;
    out.totalHomes += homes;
    out.totalCapacity += cap;
    if (z.src === 'zoned') {
      out.zonedTiles++;
      out.zoned[z.id] += 1;          // per zone, so the panel can label ITS row
      out.zonedCapacity += cap;
      out.zonedPopCap += Math.max(0, +p.popCap || 0);
    } else out.derivedTiles++;
    out.byKey.set(String(p.key), { zone: z.id, src: z.src, homes, lvl, capacity: cap });
  }
  return out;
}

/* 🏙 WHAT ZONING ADDS TO THE CITY'S POPULATION CEILING, and nothing else.
   node-city's popCap() is 4 + each building's own popCap; a zoned parcel that
   is ALSO a Housing tile has already been counted there, so only the excess is
   new. Derived zones contribute ZERO by construction (see the file header):
   describing an existing building must not change the city that already has it.
   Never negative — this may raise a ceiling, never lower one, because lowering
   it would evict people the host has already placed. */
export function capacityDelta(sv) {
  if (!sv) return 0;
  return Math.max(0, Math.round(sv.zonedCapacity - sv.zonedPopCap));
}
