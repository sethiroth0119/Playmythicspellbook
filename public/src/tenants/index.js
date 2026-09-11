/* ════════════════════════════════════════════════════════════════════════════
   🏢 TENANTS — Layer 3. NPC companies compete for the lots a player zones.
   Registers window.MythicTenants.
   ----------------------------------------------------------------------------
   THE BRIEF, in the user's own words:

     "Don't let players directly place every business. Zoning = private economy.
      The player paints Commercial — Mythic Retail. Then NPC COMPANIES COMPETE
      for those lots. Maybe Dragon Vault Cards opens. Then another company opens
      nearby. Eventually one FAILS because rent gets too expensive. Another
      becomes a national chain. That creates organic cities."

   ── WHERE THIS SITS ────────────────────────────────────────────────────────
   LAYER 1 /src/zoning       land use — eleven zone ids
   LAYER 2 /src/districts    specialisation — WHICH SET of businesses want here
           /src/landvalue    the band ladder — which of that set this GROUND takes
   LAYER 3 THIS              WHICH COMPANY, out of the ones that want it, gets it

   All three meet at ONE function: /src/zoning's `typeFor()`, the single point in
   the game where "what goes on this plot" is decided. Layer 2 replaces the bag.
   /src/landvalue filters the bag. This module PICKS OUT OF the filtered bag —
   by auction instead of by hash. That is the entire mechanism.

   🔴 IT REPLACES A HASH, NOT A SYSTEM. `typeFor()` used to finish with
      `bag[h % bag.length]` — a deterministic hash of the tile. This module is
      asked first and the hash is still there underneath it: no module, no
      bidders, or a pool that has nothing to say ⇒ the hash answers exactly as
      it always did. A 404 on /src/tenants costs the player the market and not
      one tile of anything else.

   🔴 IT MOVES NO MONEY. There is no addCinders, no spendGems, no addRes, no
      payCost and no ledger call of any kind in this package — grep it. Rent,
      wages and failure all move Cinder, and every one of those movements
      happens inside /src/economy's audited day where it already happened. This
      module READS `MythicEconomy.firms()` and writes nothing back. ECONOMY.md
      documents four historical leaks that all looked correct in review and one
      of them DESTROYED Cinder rather than minting it; the way a new seam avoids
      being the fifth is by having nothing to leak.

   🔴 IT DOES NOT RUN A SECOND BUSINESS LIFECYCLE. /src/economy/firms.js already
      has a balance sheet, a distress ladder (HEALTHY → REDUCED → LAYOFFS →
      DEBT → DEFAULT → BANKRUPT) and levels 1–5 behind seven measured gates.
      This module OBSERVES that ladder and joins it to a lot and a company name.
      Every word this module says about how a business is doing is a word
      firms.js said first. See `observe()`.

   🔴 THE GLOBALS TRAP (CLAUDE.md). `game`, `BUILDINGS`, `key`, `toast`,
      `logEvent`, `saveSoon` and `ECO_BUILDING_MAP` are top-level `const` in
      node-city's module script and invisible here. `mount(ctx)` IS the
      hand-over, and `ctx.outFor` is the one thing only the host can answer:
      which resource a building type's firm would sell.
   ════════════════════════════════════════════════════════════════════════════ */

import { TEN, OMITTED, FICTION } from './tuning.js';
import { makePool, SIZE_BY_ID } from './pool.js';
import { makeStore } from './store.js';
import { makeField, bidFor, radiusOf } from './bid.js';
import * as Overlay from './overlay.js';
import * as Panel from './ui.js';

const W = () => (typeof window !== 'undefined' ? window : {});
const ECO = () => { try { const m = W().MythicEconomy; return (m && m.ready && m.ready()) ? m : null; } catch (e) { return null; } };
const NAM = () => { try { return W().MythicNaming || null; } catch (e) { return null; } };
const ZON = () => { try { return W().MythicZoning || null; } catch (e) { return null; } };
const DIS = () => { try { return W().MythicDistricts || null; } catch (e) { return null; } };

let mounted = false;
let _ctx = {};
let store = null, pool = null, F = null;
let BUILDINGS = {};
let GRID = 24;
/* `_firmAtDay` used to sit here, written by nothing and read by nothing.
   Removed: a field that is declared and never used reads, to the next person,
   like a cache key somebody forgot to compare. */
let _firmAt = null, _firmAtStamp = 0;
let _lastObserve = null;
let _events = [];                 // the session's opening/closing lines, newest last
/* 📜 The city-log throttle (TEN.log). `_logAt` is the economic day each PITCH
   last had a closure printed to the city feed; `_held` is how many have been
   held back since the last rollup line. Neither rides the save — they are about
   a session's feed, not about the record, and the record is FAIL + COUNT. */
let _logAt = Object.create(null), _held = 0, _lastLogDay = -1e9;
/* Two derived board reads, cached because `plan()` in /src/zoning re-derives
   itself on every permit and asks for a bid on every vacant plot. `_openSig` is
   a SIGNATURE of the board (see openLots — a timestamp was wrong by 100×);
   `_refusedAt` is a timestamp, which is safe there because that scan is only
   ever read by a panel and a diagnostic. `_scanning` is the reentrancy guard:
   the refusal scan runs the auction, the auction asks `openLots()`, and an
   open-lot count that ran the auction would have recursed. */
let _openLots = 0, _openSig = null, _refused = null, _refusedAt = 0, _refusedSig = null, _scanning = false;
/* How many times `award()` was asked while the market was dormant. The evidence
   for "this city's buildings were placed by the hash, not by a market" — see
   `dormant()`. */
let _dormantAwards = 0;

const keyOf = (x, z) => (_ctx.key ? _ctx.key(x, z) : x + ',' + z);
const nameOfType = (t) => (BUILDINGS[t] && BUILDINGS[t].name) || t;
const tiles = () => { try { return (_ctx.game && _ctx.game.tiles) || {}; } catch (e) { return {}; } };
const log = (msg) => { try { _ctx.logEvent && _ctx.logEvent('city', msg); } catch (e) {} };

/* ── THE ECONOMY, JOINED BY TILE ────────────────────────────────────────────
   `MythicEconomy.firms()` returns live firms, each carrying the `tileKey` the
   host founded it against. That key is the join, and it is the ONLY thing this
   module needs from the economy. Cached for a second because `plan()` in
   /src/zoning re-derives itself on every permit. */
function firmAt(force) {
  const E = ECO();
  if (!E) { _firmAt = null; return null; }
  const now = Date.now();
  if (!force && _firmAt && now - _firmAtStamp < 1000) return _firmAt;
  const m = new Map();
  try {
    for (const f of (E.firms() || [])) if (f && f.tileKey) m.set(String(f.tileKey), f);
  } catch (e) { return _firmAt; }
  _firmAt = m; _firmAtStamp = now;
  return m;
}
/* ⚰ HOW A BUSINESS DIED, FROM THE ECONOMY'S OWN CLOSURE RECORD.
   🔴 THIS IS THE THIRD THING DRIVING THIS FEATURE FOUND, and the first two
      attempts at it were both wrong for reasons worth keeping:
        1. `MythicEconomy.firms()` is `Firms.alive()`, which FILTERS OUT the
           BANKRUPT rung — the one rung this whole feature exists to show. So
           every real bankruptcy read as "the firm is simply not there".
        2. Asking `firm(id)` instead does search all firms, but `Firms.reap()`
           is called INSIDE `sim.js runDay` (line ~1511), so the record is
           deleted in the same economic day it dies. There is no moment, from
           any host tick, at which an observer can read it.
      Measured before the fix: five businesses that the economy's own log
      recorded as "🏚 … went bankrupt" were all filed by this ledger as "wound
      up — last seen HEALTHY, 0 bad days". Every one of those words was true and
      the whole sentence was wrong.
   The fix is a read-only closure ring in sim.js — `reap()` has always RETURNED
   its dead and every caller has always discarded them — exposed as
   `MythicEconomy.closures()`. Absent (an older /src/economy) ⇒ null, and the
   ledger says "wound up" without naming a rung it cannot know. */
function closureFor(k, fid) {
  const E = ECO();
  if (!E || typeof E.closures !== 'function') return null;
  let list = [];
  try { list = E.closures(80) || []; } catch (e) { return null; }
  for (let i = list.length - 1; i >= 0; i--) {
    const c = list[i];
    if (String(c.tileKey) !== k) continue;
    if (fid != null && c.id !== fid) continue;
    return c;
  }
  return null;
}

function econDay() {
  const E = ECO(); if (!E) return 0;
  try { const s = E.snapshot(); return s ? (s.day | 0) : 0; } catch (e) { return 0; }
}
/* The resource a firm on this building type would sell. ONLY the host knows —
   `ECO_BUILDING_MAP` is a top-level const in node-city and `pickAvailable()`
   picks the one THIS node's ground supports. Absent ⇒ null ⇒ the saturation
   term scores 0 and says why, rather than guessing. */
function outFor(type) {
  try { return _ctx.outFor ? (_ctx.outFor(type) || null) : null; } catch (e) { return null; }
}

/* How many undeveloped zoned lots the city has. The pool is sized off this, so
   a player who paints a bigger district faces a bigger field of bidders. Asked
   of /src/zoning rather than recounted — one zone map, one count. */
function openLots() {
  /* ⚠ LOTS ALREADY LET COUNT. Sizing the pool off vacant land alone made it
     SHRINK as a district built out — six candidates for a trade with twenty
     shops in it — and the pool would then have been smaller than the market it
     is supposed to be bigger than. What the ratio is about is how many pitches
     of this kind exist in the city, built or not.

     🔴 …AND ONLY LOTS A COMPANY COULD ACTUALLY BID FOR. This read `Z.stats().empty`,
        which is EVERY undeveloped zoned tile in the city regardless of category —
        so painting a housing estate grew the field of bidders for a card shop on
        the other side of town. The pool is per TRADE and a household does not
        bid (see `wants`), so residential land is not a pitch and must not be
        counted as one. Measured: 24 r_low tiles moved the commercial pool by 3
        candidates per lot, which is the whole `perLot` ratio's worth of
        candidates arriving because somebody zoned houses. */
  /* ⚠ CACHED ON A SIGNATURE OF THE BOARD, NOT ON A CLOCK — and the clock was
     tried first and was WRONG BY A FACTOR OF A HUNDRED. A 1-second TTL looks
     harmless until something changes the board a hundred times inside one tick:
     painting 114 commercial tiles calls /src/zoning's `sync()` 114 times, the
     first of those re-derived a plan while ONE tile was zoned, and every read
     for the next second — including the very first permits of the Develop
     button pressed straight afterwards — sized the whole city's candidate pool
     off `lots: 1`. Measured exactly that: 114 zoned lots, `stats().pool` saying
     1, on the same board my own scan counted correctly.
     The signature is what /src/zoning already publishes (`stats()` — the same
     call this function made before, so the per-call cost is unchanged) plus the
     tenancy count, and it moves on every paint, every build and every let. No
     timing, so two runs of the same board also give the same pool. */
  let sig = '', st = null;
  try { const Z = ZON(); if (Z && Z.stats) st = Z.stats(); } catch (e) { st = null; }
  const held = store ? store.size() : 0;
  if (st) {
    sig = (st.zoned | 0) + ':' + (st.empty | 0) + ':' + held;
    const per = st.per || {};
    for (const zid of Object.keys(per).sort()) sig += '|' + zid + per[zid];
  } else sig = 'nozoning:' + held;
  if (sig === _openSig) return _openLots;
  let empty = 0;
  try {
    const Z = ZON();
    if (Z && Z.zoneAt) {
      const g = tiles();
      for (let x = 0; x < GRID; x++) for (let z = 0; z < GRID; z++) {
        const k = keyOf(x, z);
        if (g[k]) continue;
        if (!marketCat(catAt(x, z))) continue;
        empty++;
      }
    }
  } catch (e) { empty = 0; }
  _openLots = empty + held;
  _openSig = sig;
  return _openLots;
}

/* ════════════════════════════════════════════════════════════════════════════
   🚧 THE GATE — asked by BOTH seams, because that is the whole defect
   ----------------------------------------------------------------------------
   🔴 THIS IS THE /src/districts BUG, EXACTLY, AND IT COST THIS MODULE THE SAME
      WAY. `wants()` refused residential — "a household is not a company and does
      not bid" — and `award()`, a different seam into the same store, had no such
      check. `permitOne` calls it for every zoned build. Measured: 24 r_low lots,
      all built as housing, `wants()` returned null on every one, and TWELVE got
      a tenancy, each joined to a live landlord firm through
      `ECO_BUILDING_MAP.housing`. `levelFor` was live on them, so the first
      landlord to reach level 2 would have had this module raising the height of
      a house through a seam that says it never touches residential.

   HOW IT IS CLOSED, and why not the other way. /src/districts was fixed by
   asking the gate at every READ. That shape is right when the store is a cache
   of something derivable; it is wrong here, because this store is the DURABLE
   RECORD — a lease on a house would still be written, still ride the save,
   still make its company `housed()` and unavailable to bid elsewhere, and every
   read would have to remember to filter. So the gate goes at both WRITE seams,
   as ONE predicate they share, and it is re-asserted at read time by `verify()`
   rather than re-implemented there. One rule, two callers, one checker.

   TWO INDEPENDENT TESTS, deliberately:
     · the ZONE's category — what the player declared this land is for. This is
       the test `wants()` already had.
     · the BUILDING's own `popCap` — the HOST's definition of a dwelling, not a
       list of type ids invented here. It catches a home that arrives through a
       caller that does not know the zone, and it is why `r_mixed`'s housing is
       refused while its grocery would not be on the type test alone.
   ⚠ A category we cannot read is OPEN, not closed — /src/landvalue's rule, and
     this module is held to it. An unzoned tile, or a build with no /src/zoning
     at all, is judged on the dwelling test only.

   ⚠ REJECTED: gating on the building type alone. It would let `r_mixed` — a
     RESIDENTIAL zone whose mix is 5 housing : 1 grocery : 1 restaurant : 1 shop
     — hand its retail to the market while `wants()` refused to bid on the same
     tiles, which is the two-seams-two-rules defect again wearing the opposite
     coat. If mixed-use retail should be marketable, the change belongs in the
     predicate below and both seams get it at once. That is the point of it. */
const MARKET_CATS = ['com', 'off', 'ind'];
const marketCat = (c) => (c ? MARKET_CATS.indexOf(c) >= 0 : false);

function catAt(x, z) {
  try {
    const Z = ZON(); if (!Z || !Z.zoneAt) return null;
    const id = Z.zoneAt(x, z);
    const zd = (id && Z.ZONE_BY_ID) ? Z.ZONE_BY_ID[id] : null;
    return zd ? (zd.cat || null) : null;
  } catch (e) { return null; }
}
/* A DWELLING, by the host's own table. `popCap` is what node-city itself uses
   to mean "people live here" (`places.push({ home: !!def.popCap })`), so a new
   residential building type is covered the day it is added and no id list here
   can go stale. */
function isDwelling(type) {
  try { const d = BUILDINGS[type]; return !!(d && (d.popCap | 0) > 0); } catch (e) { return false; }
}
function marketable(x, z, type, cat) {
  const c = (cat != null && cat !== '') ? cat : catAt(x, z);
  if (c && !marketCat(c)) return false;
  if (type && isDwelling(type)) return false;
  return true;
}

/* ════════════════════════════════════════════════════════════════════════════
   THE AUCTION
   ----------------------------------------------------------------------------
   🔴 THE BID DEPENDS ON THE CANDIDATE ONLY THROUGH ITS SIZE. Every other term
      is a fact about the LOT and the TRADE. So a pool of sixty companies is
      three distinct bids, not sixty — which is what makes it affordable to run
      an auction inside `plan()`, a function /src/zoning re-derives on every
      single permit. Getting this wrong would have been ~25,000 bids per permit
      on a 100-plot district.
   ⚠ TIES BREAK ON THE LOWEST CANDIDATE INDEX, deterministically. A random or
     insertion-ordered tie-break would let the same board award the same lot to
     a different company after a reload, which is the /src/naming failure
     ("a business that renames itself across a reload") wearing a different hat.
   ══════════════════════════════════════════════════════════════════════════ */
function bestBidFor(x, z, type, housed, lots) {
  const cands = pool.bidders(type, housed, lots);
  if (!cands.length) return null;
  const firstOfSize = new Map();
  for (const c of cands) if (!firstOfSize.has(c.size.id)) firstOfSize.set(c.size.id, c);
  let best = null;
  for (const c of firstOfSize.values()) {
    const b = bidFor(F, c, x, z, outFor);
    if (b.total <= TEN.bid.reserve) continue;
    if (!best || b.total > best.bid.total ||
        (b.total === best.bid.total && c.i < best.cand.i)) best = { cand: c, bid: b, type };
  }
  return best;
}

/* ── 🔇 WHEN THE MARKET HAS NO OPINION AT ALL ───────────────────────────────
   🔴 "ABSENT ⇒ OPEN, NEVER CLOSED" — /src/landvalue's rule, and this module is
      held to it too. There are two completely different situations that both
      look like "no bid", and treating them the same would have been the worst
      bug this feature could ship:

        · NOBODY WILL TAKE THIS PITCH. A real verdict. The trade is saturated,
          or the ground costs more than the catchment is worth. The lot should
          stay VACANT and the player should be told why. This is the user's
          "vacancies increase, buildings become abandoned".
        · THE MARKET CANNOT TELL ONE LOT FROM ANOTHER. A city with nobody living
          in it has no catchment anywhere, so `customers` and `income` are zero
          on every square and the only term left is rent, which is negative on
          every square. Every bid fails, everywhere, forever — and a fresh city
          would develop NOTHING, which is not a consequence, it is a dead game.

   `silent()` is the second case, and it is checked before any refusal is
   returned. The test is the one that actually matters: is there a best
   catchment on this board at all? If not, this module says nothing and
   /src/zoning's own hash answers exactly as it did before the market existed.
   ⚠ It deliberately does NOT test "is /src/demographics mounted". A mounted
     module reporting an empty city is the same fact as an absent one, and the
     failure mode this guards is about the DATA, not the wiring. */
function silent() {
  try { return !(F.field().maxNear > 0); } catch (e) { return true; }
}

/* ── 🌙 …AND THE MODULE HAS TO BE ABLE TO SAY SO ────────────────────────────
   🔴 A DORMANT MARKET AND A WORKING ONE WERE INDISTINGUISHABLE FROM OUTSIDE,
      AND THAT IS WORSE THAN EITHER. Driven on this box: four boots of the SAME
      commit, same scene, returned `maxNear` 155, 155, 0 and 0, and one stayed
      at 0 through 225 economic days with 89 residents in the city — every
      housing tile reporting `occupied: 0` at /src/demographics' own
      `residents()` seam. On such a boot 100% of `typeFor` answers come from the
      hash, `wants()` correctly says nothing, and — before this — the panel said
      "Nobody has taken a zoned lot yet", which is the same sentence it shows
      when the market is running and nobody has bid yet.

   The upstream cause is demographics occupancy and is NOT this module's to fix.
   What IS this module's is never letting "I have no information" look like "I
   looked and there is nothing". So: one seam, published, printed in the panel,
   and counted — `_dormantAwards` is how many buildings landed while this was
   true, i.e. how many of the city's lots the hash placed with no market behind
   them. A number a driver can assert on beats a sentence a reader can miss. */
function dormant() {
  if (!mounted) return { mounted: false, dormant: false, why: 'The tenant market is not mounted.' };
  let f = null;
  try { f = F.field(); } catch (e) { f = null; }
  const near = f ? (f.maxNear | 0) : 0;
  const on = !(near > 0);
  return {
    mounted: true, dormant: on, maxNear: near,
    homes: f ? f.homes.length : 0, residents: f ? (f.cityPop | 0) : 0,
    has: f ? { ...f.has } : null,
    awardsWhileDormant: _dormantAwards,
    why: on
      ? 'Nobody lives within reach of any lot yet, so every pitch in the city has the same (empty) catchment and every bid is negative everywhere. This module has no way to tell one lot from another, so it says nothing at all and /src/zoning\u2019s hash decides what develops — exactly as it did before the market existed. It wakes on its own as housing fills.'
      : null,
  };
}

/* THE WINNER over a whole bag. `bag` is what /src/zoning has left after the
   specialisation and the band filter — this never widens it. */
function winnerFor(x, z, bag) {
  if (!mounted || !Array.isArray(bag) || !bag.length) return null;
  const uniq = [];
  /* ⚠ A DWELLING IN THE BAG IS SKIPPED, NOT BID FOR. `r_mixed` is a residential
     zone with retail in its mix, so the two halves of the gate are not the same
     test; this is the type half, applied where the bag is read. */
  for (const t of bag) if (uniq.indexOf(t) < 0 && !isDwelling(t)) uniq.push(t);
  const housed = store.housed(), lots = openLots();
  let best = null;
  for (const t of uniq) {
    const b = bestBidFor(x, z, t, housed, lots);
    if (!b) continue;
    if (!best || b.bid.total > best.bid.total ||
        (b.bid.total === best.bid.total && b.cand.i < best.cand.i)) best = b;
  }
  return best;
}

/* ── SEAM 1: /src/zoning's `typeFor()` ──────────────────────────────────────
   PURE. Asked for every vacant zoned plot on every permit, so it must not have
   a side effect — the tenancy is only recorded when a building actually LANDS
   (`award`, below). Returns null for "nobody will take this pitch", and null is
   a REAL ANSWER: /src/zoning falls back to its own hash, which is the shipped
   behaviour and never a worse one.
   ⚠ It is `null` rather than "refuse" on purpose. A lot nobody bids for is
     reported by `explain()` and by the panel; making the develop pass refuse it
     would be a second refusal path beside /src/landvalue's, which owns that
     sentence. */
function wants(x, z, bag, cat) {
  try {
    /* 🏠 RESIDENTIAL IS NOT A MARKET. A household is not a company and does not
       bid; /src/demographics already decides who moves into a zoned home and
       node-city already gates that on service coverage. Running an auction over
       `housing` would have put a second, competing gate in front of the city's
       oldest one. Same call /src/districts made — its FAMILIES table has no
       residential row either, for the same reason.
       ⚠ THROUGH `marketable()`, which `award()` also calls. This line used to be
         an inline category test that existed HERE and nowhere else, and the
         other seam into the store had no equivalent — see the gate's header. */
    if (!marketable(x, z, null, cat)) return null;
    const w = winnerFor(x, z, bag);
    if (w) return w.type;
    /* `false` is the REFUSAL — a real verdict that the lot stays vacant.
       `null` is "no opinion", and /src/zoning falls back to its hash. */
    return silent() ? null : false;
  } catch (e) { return null; }
}

/* THE SENTENCE A MARKET REFUSAL HAS TO SAY. Owned here rather than written into
   /src/zoning, so the model and its explanation cannot drift — the same rule
   /src/landvalue and /src/districts both state about their own refusals.
   Returns null when the refusal is NOT this module's to explain: an empty bag
   is /src/landvalue's or /src/districts' sentence, and a market with no opinion
   has nothing to say at all. */
function refusal(x, z) {
  if (!mounted || silent()) return null;
  /* A lot that was ALREADY refused carries the sentence it was refused with —
     one refusal, one wording, whether the caller is /src/zoning's develop
     report or the panel's vacancy list. */
  const v = store.vacancy(keyOf(x, z));
  if (v && v.never && v.why) return v.why;
  if (!marketable(x, z, null, null)) return null;  // not a market: not our sentence
  const bag = bagFromZoning(x, z);
  if (!bag.length) return null;                    // not our refusal
  const w = winnerFor(x, z, bag);
  if (w) return null;                              // not refused
  return sinkLine(x, z, bag);
}

/* THE SENTENCE ITSELF, given the bag that was refused. Split out of `refusal()`
   because `award()` needs the identical wording for a lot that was BUILT and
   found no tenant — two paths to one refusal must not be two sentences. */
function sinkLine(x, z, bag) {
  const e = explain(x, z, bag);
  const top = (e.ok && e.rows.length) ? e.rows[0] : null;
  if (!top) return '🏢 No company is looking for premises of this kind — the pool has nobody left to bid.';
  const worst = top.terms.slice().sort((a, b) => a.v - b.v)[0];
  return '🏢 NO COMPANY WILL TAKE THIS PITCH. The best bid on it is ' +
    (top.cand.sizeName || 'a company') + ' ' + top.cand.name + ' at ' + top.total +
    ', under the reserve of ' + TEN.bid.reserve + '. What sinks it: ' +
    worst.label.toLowerCase() + ' — ' + worst.note + '.';
}

/* ── SEAM 2: the building landed ────────────────────────────────────────────
   Called by /src/zoning after `place()` has actually produced a tile. THIS is
   where a candidate stops being a candidate. */
function award(x, z, type) {
  if (!mounted || !type) return null;
  const k = keyOf(x, z);
  if (store.tenancy(k)) return store.tenancy(k);
  /* ── GUARD 1: THE GATE `wants()` ALREADY HAD (see `marketable`) ───────────
     Without it this seam signed leases on houses — twelve of them on a driven
     board, every one joined to a live landlord firm. It is the same predicate
     `wants()` asks, not a copy of it. */
  if (!marketable(x, z, type, null)) return null;
  /* ── GUARD 2: A DORMANT MARKET REFUSES NOTHING ───────────────────────────
     "ABSENT ⇒ OPEN, NEVER CLOSED" is stated for `wants()` twenty lines above
     and was not applied here. On a boot where demographics never fills the
     housing, every bid is negative everywhere; `wants()` correctly says nothing
     and the hash builds the district — and this seam then found no bid either
     and recorded NOTHING. Measured: 81 commercial buildings developed, 0
     tenancies, 0 vacancies, `verify(): ok:true`, panel reading "Nobody has
     taken a zoned lot yet". A module that is asleep looked exactly like a
     module that is working.
     So a dormant market records no tenancy AND no refusal — it has no opinion
     to record — and counts the lot instead, which is what `dormant()` publishes
     and the panel prints. */
  if (silent()) { _dormantAwards++; store.pendAdd(k); return null; }
  const w = bestBidFor(x, z, type, store.housed(), openLots());
  /* ── THE REFUSAL IS A RESULT, AND IT IS WRITTEN DOWN ─────────────────────
     The market ran on a real board and every bid came in under the reserve.
     That is the user's "vacancies increase, buildings become abandoned", and
     before this it was a `return null` — no tenancy, no vacancy, nothing for
     the panel to count and nothing for `vacancies()` to explain. */
  if (!w) {
    if (store.refuse(k, sinkLine(x, z, [type]))) {
      note('refuse', k, '🏢 Nobody took the ' + nameOfType(type) + ' at ' + k + ' — every bid was under the reserve.');
      try { _ctx.saveSoon && _ctx.saveSoon(); } catch (e) {}
      syncOverlay();
    }
    return null;
  }
  const day = econDay();
  const rec = store.open(k, w.cand, type, day);
  if (!rec) return null;
  rec.bid = Math.round(w.bid.total * 10) / 10;
  /* 🏷 ONE NAME IN THE CITY, NOT TWO. The company arrived with a name it had as
     a candidate; `pinName` makes that the name on the sign, through /src/naming's
     own register and its own de-duplicator. It is deliberately not `setName`:
     that marks a name CUSTOM, which means "the player typed this" and offers a
     reset that would throw the business's own name away. */
  try { const N = NAM(); if (N && N.pinName) { const n = N.pinName(k, w.cand.name); if (n) rec.n = n; } } catch (e) {}
  note('open', k, rec.n + ' (' + w.cand.size.name + ') took the ' + nameOfType(type) +
       ' pitch at ' + k + ' — winning bid ' + rec.bid + '.');
  try { _ctx.saveSoon && _ctx.saveSoon(); } catch (e) {}
  return rec;
}

/* ── SEAM 3: the level target ───────────────────────────────────────────────
   "Zoning density progression — Small Card Shop → Popular Card Store →
    Regional Mythic Center → Collector Superstore → Ouroboros Mega Store.
    The building upgrades because THE BUSINESS ITSELF SUCCEEDED."

   🔴 THE LEVEL IS THE FIRM'S OWN. `f.level` is what /src/economy/firms.js
      `levelCheck()` granted, and that is seven gates — customers/day, revenue/
      day, profitable days, employees, suppliers, cash reserve, infrastructure —
      every one of them a measured rolling average of a real balance sheet. This
      module does not decide it, soften it or shortcut it; it carries it out to
      the world so a thriving business is TALLER than a struggling one.
   ⚠ CLAMPED BY THE TENANT'S AMBITION and then, immediately after this returns,
     by the building's own `maxLvl` inside /src/zoning's `targetLvl`. A national
     chain will push a plot to 5; a one-shop independent stops at 2 even if its
     books would carry more, which is what stops every corner shop in a rich
     district becoming a tower.
   ⚠ 0 means "nothing to say" — the same contract /src/districts' `levelFor`
     ships under, and /src/zoning reads it as "use the zone's own target". */
function levelFor(x, z) {
  if (!mounted) return 0;
  const k = keyOf(x, z);
  const rec = store.tenancy(k);
  if (!rec) return 0;
  const m = firmAt();
  const f = m ? m.get(k) : null;
  if (!f) return 0;
  const sz = SIZE_BY_ID[rec.size] || TEN.sizes[0];
  return Math.max(0, Math.min(f.level | 0, sz.ambition | 0));
}

/* ════════════════════════════════════════════════════════════════════════════
   👁 OBSERVE — the join, and the only place a failure is ever recorded.
   ----------------------------------------------------------------------------
   Runs on the host's slow timer. For every tenancy:

     · the premises went (demolished, or rebuilt as something else)  ⇒ EVICT.
       Not a failure. Nothing died; the building did.
     · no firm on the tile at all, while the building still stands   ⇒ FAILED.
       `syncBuildings` marks a firm whose tile is gone BANKRUPT and `reap()`
       deletes it, so a standing mapped building with no firm means exactly one
       thing: this one went bankrupt and was wound up.
     · a DIFFERENT firm id on the tile                               ⇒ FAILED.
       This is the case nothing in the game could see before. A bankrupt
       tile-owned firm is RE-FOUNDED at the next 4-second sync — ECON's own
       charter-fund header calls it "a pump, not a one-off" — so the shop
       silently became a different shop with the same blueprint name. Binding
       the tenancy to `f.id` is what makes that observable, and it is why the
       firm id rides the save.
     · rung BANKRUPT                                                 ⇒ FAILED,
       caught on the tick it happens rather than one sync later.
     · anything else ⇒ carry the firm's level and rung onto the tenancy.

   🔴 NOT ONE OF THOSE FIVE IS A RULE THIS MODULE INVENTED. Every one is a
      reading of firms.js state. There is no second lifecycle here — there is a
      join and a ledger.
   ══════════════════════════════════════════════════════════════════════════ */
function observe(force) {
  if (!mounted) return null;
  const g = tiles();
  /* 🔴 ALWAYS `true`, AND THE ARGUMENT IS DELIBERATELY IGNORED HERE. node-city
     calls `observe(true)`, then `syncBuildings`, then `observe()` — and the
     comment on that second call says it exists to catch the re-founded firm
     "right after the set of firms changed". It could not: all three happen in
     one synchronous tick and `firmAt()` caches for 1000 ms, so the call whose
     whole purpose is to see the NEW set of firms was reading the map built
     before `syncBuildings` ran. The cost was a delay rather than a loss — the
     next 4-second beat caught it — but a documented mechanism that does not
     work is worse than an undocumented one, because the next reader trusts it.
     Fixed HERE rather than at the call site so that ANY caller gets it right:
     an observer whose job is to notice a change must never be served a
     snapshot. The TTL still serves `levelFor()` / `tenantAt()`, which are asked
     per plot on every permit and do not care about a 1-second-old level. */
  const m = firmAt(true);
  const day = econDay();
  const out = { day, checked: 0, evicted: 0, failed: [], grown: [], struggling: 0,
                relet: [], noBidder: 0, waiting: 0, damaged: 0, woke: 0, econ: !!m };
  const S = TEN.mark.struggling;

  for (const k of Object.keys(store.lets())) {
    const rec = store.tenancy(k); if (!rec) continue;
    out.checked++;
    const t = g[k];
    if (!t || t.type !== rec.want) { store.evict(k); out.evicted++; continue; }
    /* 🔧 A DAMAGED BUILDING IS NOT A FAILED BUSINESS, and this one was mislabelled
       on a driven board before it was caught. node-city's `ecoBuildings()` skips
       `t.damaged` — "a burnt-out factory keeps hiring" is the bug that line
       prevents — so a damaged shop's firm is reaped by the very next
       `syncBuildings`, the tenancy loses the firm it was bound to, and the
       observer below would file a perfectly solvent business as wound up. The
       premises are offline; the tenancy is not over. It resumes on the same
       firm when the repair lands, or fails honestly later on its own books. */
    if (t.damaged) { out.damaged = (out.damaged | 0) + 1; continue; }
    if (!m) continue;                       // no economy ⇒ nothing to say, ever
    let f = m.get(k);
    /* 🔴 `MythicEconomy.firms()` IS `Firms.alive()`, AND alive() FILTERS OUT THE
       BANKRUPT — which is the whole rung this feature exists to show. Driven,
       every real bankruptcy in the city was therefore filed by the ledger as
       "wound up ... last seen HEALTHY, 0 bad days" while the economy's own log
       said "🏚 Food Truck (preparedMeals) went bankrupt" on the same tick. The
       tenancy is bound to a firm ID, so ask for THAT firm by id: `firm(id)`
       goes through `Firms.byId`, which searches ALL firms, and the record
       survives until `reap()` — which runs on the first line of syncBuildings,
       i.e. immediately after this observer (node-city calls us first for
       exactly this reason). So the dead firm is still readable here, with its
       real rung and its real badDays, for exactly one call. */
    if (!f && rec.f != null) {
      try { const E = ECO(); const d = E && E.firm ? E.firm(rec.f) : null; if (d && String(d.tileKey) === k) f = d; }
      catch (e) {}
    }
    if (!f) {
      /* 🔴 ABSENT IS NOT DEAD, AND THIS WAS A REAL MEASURED BUG. A lease is
         signed the instant the building lands; the FIRM is founded by
         `syncBuildings`, which runs on the host's 4-second beat. So there is a
         window — always, on every single let — in which the tenancy exists and
         its firm does not. Without the `rec.f == null` guard the observer read
         that window as "wound up", closed the tenancy, re-let it, and closed it
         again. Driven, that reported FOUR failures and EIGHT lets on four
         freshly-built shops that were all perfectly healthy, on day 40, before
         a single economic day had passed under any of them.
         So: a tenancy that has NEVER seen a firm is simply waiting. Only a
         tenancy that once had one and now has none has actually lost it. */
      if (rec.f == null) { out.waiting = (out.waiting | 0) + 1; continue; }
      const c = closureFor(k, rec.f);
      const row = c
        ? store.close(k, day, c.rung, rungWhy(c))
        : store.close(k, day, rec.rung, 'wound up — the building stands, the business does not (the economy kept no closure record)');
      if (row) { out.failed.push(row); note('fail', k, closingLine(row)); }
      continue;
    }
    if (rec.f == null) { rec.f = f.id; }
    else if (rec.f !== f.id) {
      const c = closureFor(k, rec.f);
      const row = c
        ? store.close(k, day, c.rung, rungWhy(c))
        : store.close(k, day, rec.rung, 'closed and the pitch changed hands (the economy kept no closure record)');
      if (row) { out.failed.push(row); note('fail', k, closingLine(row)); }
      continue;
    }
    if (f.rung === 'BANKRUPT') {
      const row = store.close(k, day, 'BANKRUPT', 'bankrupt after ' + (f.badDays | 0) + ' days with no cash');
      if (row) { out.failed.push(row); note('fail', k, closingLine(row)); }
      continue;
    }
    const wasLvl = rec.lvl | 0;
    /* The distress COUNTER, not just the rung. `badDays` is what firms.js
       actually walks the ladder on, and a ledger row that can say "14 bad days"
       is a different quality of evidence from one that can only name a rung it
       may have observed a day late. Kept off the save deliberately: it is a
       live reading, and firms.js already serialises the authoritative copy. */
    rec.bad = f.badDays | 0;
    rec.cash = Math.round(f.cash);
    store.observe(k, f.level, f.rung);
    if ((f.level | 0) > wasLvl) {
      out.grown.push({ k, n: rec.n, from: wasLvl, to: f.level | 0 });
      note('grow', k, rec.n + ' passed its level ' + (f.level | 0) + ' gates — the ' +
           nameOfType(rec.want) + ' at ' + k + ' can grow.');
    }
    if (S.indexOf(f.rung) >= 0) out.struggling++;
  }

  /* ── RE-LETTING. A lot whose business failed is offered again immediately —
     there is no cooldown and tuning.js says why. If nobody bids, it STAYS
     empty of a tenant and that is the honest, driven consequence of
     over-zoning: the trade is over-supplied, the saturation term buries every
     bid under the reserve, and no company will take the pitch. */
  for (const k of Object.keys(store.vacs())) {
    const t = g[k];
    if (!t) { store.clearVacancy(k); continue; }
    const p = k.split(',');
    /* The same gate both write seams ask. A vacancy can outlive the zone it was
       recorded under — a player re-paints a strip residential and the lots
       under it stop being a market — and re-letting one would put a company
       back into a category the market does not serve. */
    if (!marketable(+p[0], +p[1], t.type, null)) { store.clearVacancy(k); continue; }
    /* A dormant market re-lets nothing, for the same reason `award()` refuses
       nothing while it is asleep. */
    if (silent()) { out.noBidder++; continue; }
    const w = bestBidFor(+p[0], +p[1], t.type, store.housed(), openLots());
    if (!w) { out.noBidder++; continue; }
    const rec = store.open(k, w.cand, t.type, day);
    if (!rec) continue;
    rec.bid = Math.round(w.bid.total * 10) / 10;
    rec.f = (m && m.get(k)) ? m.get(k).id : null;
    try { const N = NAM(); if (N && N.pinName) { const n = N.pinName(k, w.cand.name); if (n) rec.n = n; } } catch (e) {}
    out.relet.push({ k, n: rec.n, bid: rec.bid });
    note('open', k, rec.n + ' took over the ' + nameOfType(t.type) + ' at ' + k + '.');
  }

  /* ── 🌙 THE WAKE-UP QUEUE ─────────────────────────────────────────────────
     Lots that developed while the market was dormant. `award()` is called ONCE,
     when the building lands, so without this a city that built itself out
     before anybody moved in would have no company in it EVER — which is the
     second half of what made a dormant market indistinguishable from a working
     one. Measured on such a board: 81 commercial buildings, 0 tenancies, and
     nothing that would ever change either number.
     ⚠ ONLY LOTS THIS MODULE WAS ASKED ABOUT. The queue is written by `award()`
       and by nothing else, so a hand-placed farm standing on zoned land is not
       in it and is never adopted — the overlay's rule ("a building with no
       tenancy is not part of the private market") still holds. A general sweep
       over standing buildings would have broken it. */
  if (!silent()) {
    let budget = TEN.wake.perPass | 0 || 24;
    for (const k of Object.keys(store.pends())) {
      if (budget-- <= 0) break;
      const t = g[k];
      const p = k.split(','), x = +p[0], z = +p[1];
      if (!isFinite(x) || !isFinite(z)) { store.pendDrop(k); continue; }
      /* The premises went while the market slept ⇒ there is nothing to let.
         A DAMAGED building stays queued: the repair is coming and the tenancy
         belongs to the pitch, not to the wreck (see the observer's own note). */
      if (!t) { store.pendDrop(k); continue; }
      if (t.damaged) continue;
      if (store.tenancy(k) || store.vacancy(k) || !marketable(x, z, t.type, null)) { store.pendDrop(k); continue; }
      const w = bestBidFor(x, z, t.type, store.housed(), openLots());
      if (!w) {
        store.refuse(k, sinkLine(x, z, [t.type]));
        store.pendDrop(k);                          // belt: refuse() drops it too
        out.noBidder++;
        continue;
      }
      const rec = store.open(k, w.cand, t.type, day);
      if (!rec) { store.pendDrop(k); continue; }
      rec.bid = Math.round(w.bid.total * 10) / 10;
      rec.f = (m && m.get(k)) ? m.get(k).id : null;
      try { const N = NAM(); if (N && N.pinName) { const n = N.pinName(k, w.cand.name); if (n) rec.n = n; } } catch (e) {}
      out.woke = (out.woke | 0) + 1;
      note('open', k, rec.n + ' took the ' + nameOfType(t.type) + ' at ' + k +
           ' — the market woke up and this pitch was still empty.');
    }
  }

  _lastObserve = out;
  if (out.failed.length || out.relet.length || out.grown.length || (out.woke | 0)) {
    try { _ctx.saveSoon && _ctx.saveSoon(); } catch (e) {}
  }
  syncOverlay();
  return out;
}

/* The economy's own verdict, turned into one sentence. Nothing here is
   computed — `rung`, `badDays` and `lifetimeProfit` are all firms.js's. */
function rungWhy(c) {
  if (c.rung === 'BANKRUPT') {
    return 'bankrupt — ' + (c.badDays | 0) + ' day' + ((c.badDays | 0) === 1 ? '' : 's') +
           ' with no cash, lifetime profit ' + (c.lifetimeProfit | 0) + ' 🔥';
  }
  return 'wound up on the ' + String(c.rung || '?').toLowerCase() + ' rung after ' +
         (c.badDays | 0) + ' bad day' + ((c.badDays | 0) === 1 ? '' : 's');
}

function closingLine(row) {
  const sz = SIZE_BY_ID[row.size];
  return '🏚 ' + row.n + (sz ? ' (' + sz.name + ')' : '') + ' has closed at ' + row.k +
         ' after ' + row.days + ' day' + (row.days === 1 ? '' : 's') + ' — ' + row.why + '.';
}
/* 📜 THE PANEL FEED TAKES EVERYTHING; THE CITY LOG TAKES THE NEWS.
   🔴 MEASURED: 345 `logEvent('city', …)` calls in 600 days on the driven board,
      one per closure, every one the same shape. The closures are real and every
      one of them is still in `failures()`, in `COUNT.failed` and in `_events`.
      What was wrong is the CHANNEL: the city feed also carries raids, research
      and trade, and a module that writes to it twice a day owns it.
   TWO CONDITIONS, and the first one alone was measured and was not enough.
   PER PITCH, because of what the noise actually is — a bankrupt tile-owned firm
   is re-founded by `syncBuildings` and the same lot fails again; the first death
   at a pitch is news, the fifth is the charter-fund treadmill, which
   /src/economy owns. AND PER INTERVAL, because on a 225-day run the repeats at a
   pitch were spaced further apart than the quiet window and 144 closures still
   came out as 140 individual lines — the whole 140-line feed. With both:
   **9 individual lines + 11 rollups = 14.3% of the feed**, same board, same 144
   closures, ledger unchanged. Suppressed lines are counted and released as ONE
   rollup naming the running total, so the feed can never claim fewer closures
   than the ledger holds. See TEN.log. */
function note(kind, k, msg) {
  _events.push({ kind, k, msg, t: Date.now() });
  while (_events.length > 80) _events.shift();
  if (kind !== 'fail') return;
  const day = econDay();
  const last = _logAt[k];
  const freshPitch = (last == null || day < last || day - last >= (TEN.log.quietDays | 0));
  /* THE INTERVAL FLOOR. Without it a city that fails one business every day and
     a half fills a 140-line feed with nothing else — measured, and the per-pitch
     rule alone did not touch it. */
  const dueAgain = (day < _lastLogDay || day - _lastLogDay >= (TEN.log.everyDays | 0));
  if (freshPitch && dueAgain) {
    _logAt[k] = day; _lastLogDay = day; log(msg); return;
  }
  _held++;
  if (_held >= (TEN.log.rollupEvery | 0 || 12)) {
    const n = _held; _held = 0;
    log('🏚 ' + n + ' more businesses have closed on pitches that have failed before — ' +
        store.counts().failed + ' closures in this city so far. The tenant market panel has the ledger.');
  }
}

/* ════════════════════════════════════════════════════════════════════════════
   READS
   ══════════════════════════════════════════════════════════════════════════ */
function tenantAt(x, z) {
  if (!mounted) return null;
  const k = keyOf(x, z);
  const rec = store.tenancy(k);
  if (!rec) {
    const v = store.vacancy(k);
    return v ? { k, vacant: true, last: v.n, rung: v.rung, why: v.why } : null;
  }
  const m = firmAt();
  const f = m ? m.get(k) : null;
  const sz = SIZE_BY_ID[rec.size] || TEN.sizes[0];
  return {
    k, vacant: false, name: rec.n, want: rec.want, typeName: nameOfType(rec.want),
    size: { id: sz.id, name: sz.name, ico: sz.ico, ambition: sz.ambition },
    since: rec.day | 0, bid: rec.bid != null ? rec.bid : null,
    level: rec.lvl | 0, rung: rec.rung,
    firm: f ? { id: f.id, level: f.level, rung: f.rung, cash: Math.round(f.cash),
                out: f.out, idle: f.idleForDemand != null ? Math.round(f.idleForDemand * 100) : null } : null,
  };
}

/* THE FULL BID TABLE for one lot — every bidder, every signed row, and the
   sum. This is the feature's own falsifiability: a ranking nobody can inspect
   is a ranking nobody can check. */
function explain(x, z, bag) {
  if (!mounted) return { ok: false, why: 'The tenant market is not mounted.' };
  let list = bag;
  if (!Array.isArray(list)) {
    const t = tiles()[keyOf(x, z)];
    list = t ? [t.type] : bagFromZoning(x, z);
  }
  const uniq = [];
  for (const t of (list || [])) if (uniq.indexOf(t) < 0) uniq.push(t);
  if (!uniq.length) return { ok: false, why: 'Nothing can develop on this plot — /src/landvalue owns that sentence.' };
  const housed = store.housed(), lots = openLots(), rows = [];
  for (const t of uniq) {
    const cands = pool.bidders(t, housed, lots);
    const seen = new Set();
    for (const c of cands) {
      if (seen.has(c.size.id)) continue;
      seen.add(c.size.id);
      const b = bidFor(F, c, x, z, outFor);
      rows.push({ cand: { id: c.id, name: c.name, size: c.size.id, sizeName: c.size.name, ico: c.size.ico },
                  type: t, typeName: nameOfType(t), total: b.total, terms: b.terms,
                  out: b.out, bids: b.total > TEN.bid.reserve });
    }
  }
  rows.sort((a, b) => b.total - a.total);
  return { ok: true, k: keyOf(x, z), radius: radiusOf(), rows,
           winner: rows.find(r => r.bids) || null,
           reserve: TEN.bid.reserve, pool: { lots, housed: housed.size } };
}

/* The bag /src/zoning would offer here, re-derived through the SHIPPED modules
   rather than mirrored — so `explain()` on an undeveloped plot cannot disagree
   with what would actually be built there. */
function bagFromZoning(x, z) {
  try {
    const Z = ZON(); if (!Z) return [];
    const zone = Z.zoneAt(x, z);
    const zd = zone && Z.ZONE_BY_ID ? Z.ZONE_BY_ID[zone] : null;
    if (!zd) return [];
    let bag = [];
    for (const [t, w] of (zd.mix || [])) { if (BUILDINGS[t]) for (let i = 0; i < w; i++) bag.push(t); }
    const D = DIS(); if (D && D.mixFor) bag = D.mixFor(x, z, zone, bag) || [];
    const L = W().MythicLandValue;
    if (L && L.ready()) bag = L.filterMix(x, z, bag) || [];
    return bag;
  } catch (e) { return []; }
}

/* ════════════════════════════════════════════════════════════════════════════
   🚫 THE LOTS NOBODY WILL TAKE — all of them, not just the ones that were let
   once and lost their tenant.
   ----------------------------------------------------------------------------
   🔴 THE PANEL ROW "Lots nobody will take" READ `store.vacantCount()`, WHICH IS
      POPULATED ONLY BY `close()`. A lot the market refused BEFORE anything was
      built on it never entered VAC at all, so on exactly the board that row
      exists to describe — 83 lots zoned, 31 built, 52 refused — it printed 0.
      `vacancies()`, the "WHY EVERY EMPTY LOT IS EMPTY" seam, had the same blind
      spot and returned an empty array.

   There are THREE kinds of empty lot and only the first two are records:
     1. CLOSED   — a business traded here and died.        VAC, `never:false`
     2. REFUSED  — a building stands, nobody will run it.  VAC, `never:true`
     3. UNBUILT  — the lot is zoned, the market refused it, so /src/zoning never
                   raised anything. There is no tile and there is no record,
                   because there is nothing to record: it is a live property of
                   the zone map and the land, and it changes the moment either
                   moves. So it is DERIVED, here, on demand — the same "ask the
                   gate at every read" shape /src/districts was fixed into.
   ⚠ ONLY THIS MODULE'S REFUSALS. A lot whose bag is empty was refused by
     /src/landvalue or /src/districts and belongs in their count, not this one —
     the same rule `refusal()` states.
   ⚠ Cached for a beat and guarded against reentrancy: the scan runs the auction
     and the auction asks `openLots()`. */
function refusedLots() {
  if (!mounted || _scanning) return _refused || [];
  /* Invalidated by the board signature AND by a short clock — the signature
     catches a paint or a build (the openLots lesson), the clock catches a land
     value that moved under a board nobody touched. */
  const now = Date.now();
  const sigNow = (openLots() + ':' + _openSig);
  if (_refused && sigNow === _refusedSig && now - _refusedAt < 1500) return _refused;
  const out = [];
  if (silent()) { _refused = out; _refusedAt = now; _refusedSig = sigNow; return out; }   // dormant refuses nothing
  _scanning = true;
  try {
    const Z = ZON(), g = tiles();
    if (Z && Z.zoneAt) {
      for (let x = 0; x < GRID; x++) for (let z = 0; z < GRID; z++) {
        const k = keyOf(x, z);
        if (g[k]) continue;                       // built: kinds 1 and 2 cover it
        if (!marketCat(catAt(x, z))) continue;
        const bag = bagFromZoning(x, z);
        if (!bag.length) continue;                // not our refusal
        if (winnerFor(x, z, bag)) continue;
        out.push({ k, x, z, bag });
      }
    }
  } catch (e) { /* a partial scan is reported as what it found */ }
  _scanning = false;
  _refused = out; _refusedAt = now; _refusedSig = sigNow;
  return out;
}

function stats() {
  if (!mounted) return { mounted: false };
  const lets = store.lets(), c = store.counts();
  const per = {}, bySize = {}, byRung = {};
  for (const k in lets) {
    const r = lets[k];
    per[r.want] = (per[r.want] || 0) + 1;
    bySize[r.size] = (bySize[r.size] || 0) + 1;
    byRung[r.rung] = (byRung[r.rung] || 0) + 1;
  }
  const wants = Object.keys(per);
  const housed = store.housed();
  const unbuilt = refusedLots().length;
  const d = dormant();
  return {
    mounted: true, salt: store.salt(),
    tenancies: store.size(),
    /* `vacant` keeps its old meaning — lots IN THE STORE with no tenant — so
       nothing that already reads it changes under it. `refused` is the whole
       answer to "lots nobody will take", and its three parts are printed
       separately because they are three different facts. */
    vacant: store.vacantCount(),
    refused: store.neverCount() + unbuilt,
    /* The panel's row, computed ONCE and here rather than in the markup: every
       lot in the city that has no tenant and would not get one — a business
       that closed and found no successor, a building nobody would take, and a
       zoned plot the market refused before anything was built. */
    emptyLots: store.vacantCount() + unbuilt,
    refusedParts: { closed: store.closedCount(), standing: store.neverCount(), unbuilt },
    per, bySize, byRung,
    lifetime: c,
    /* 345 failures on 34 pitches is a treadmill; the panel must be able to say
       which it is. Derived from the retained ledger, so it is exact for the
       newest rows and says so. */
    failedLots: store.failedLots(), ledgerRows: store.failures().length,
    dormant: d.dormant, dormantWhy: d.why, awardsWhileDormant: d.awardsWhileDormant,
    waking: store.pendCount(),
    counterRepairs: store.repairs(),
    pool: pool.stats(wants.length ? wants : ['shop'], housed, () => openLots()),
    lastObserve: _lastObserve,
    overlay: Overlay.visible(),
  };
}

/* 🔍 THE SELF-CHECK. Reports only what is wrong — a self-check that logs on
   success is one everybody learns to scroll past.
   The one thing that can silently invalidate the whole feature is a bid whose
   ROWS DO NOT SUM TO ITS TOTAL, because then the explanation in the panel and
   the ranking on the board are two different models. It is re-added here for
   every tenanted lot rather than asserted. */
function verify() {
  if (!mounted) return { ok: false, why: 'not mounted' };
  const problems = [];
  const g = tiles();
  let checked = 0, worst = 0;
  const housed = store.housed(), lots = openLots();
  for (const k of Object.keys(store.lets()).slice(0, 40)) {
    const t = g[k]; if (!t) continue;
    const p = k.split(',');
    const cands = pool.bidders(t.type, housed, lots);
    const c = cands[0]; if (!c) continue;
    const b = bidFor(F, c, +p[0], +p[1], outFor);
    let sum = 0; for (const r of b.terms) sum += r.v;
    const err = Math.abs(sum - b.total);
    if (err > worst) worst = err;
    if (err > 1e-6) problems.push('bid rows at ' + k + ' sum to ' + sum + ' but the total is ' + b.total);
    checked++;
  }
  /* A tenancy whose lot no longer carries its building type is a stale record
     the observer should have evicted. */
  for (const k in store.lets()) {
    const t = g[k];
    if (!t || t.type !== store.lets()[k].want) problems.push('stale tenancy at ' + k + ' — the premises are not a ' + store.lets()[k].want);
  }
  /* Two lots cannot hold the same company. */
  const seen = new Map();
  for (const k in store.lets()) {
    const c = store.lets()[k].c;
    if (seen.has(c)) problems.push('company ' + c + ' holds both ' + seen.get(c) + ' and ' + k);
    seen.set(c, k);
  }
  /* 🚧 THE GATE, RE-ASKED AT READ TIME. Both write seams call `marketable()`,
     and this is what makes that a rule rather than a habit: a tenancy on a
     dwelling or on land that is not a market is reported here whatever wrote
     it — a third seam somebody adds later, or a save from a build that had the
     defect. It found 12 leases on houses the first time it was run. */
  for (const k in store.lets()) {
    const p = k.split(','), rec = store.lets()[k];
    if (!marketable(+p[0], +p[1], rec.want, null)) {
      problems.push('tenancy at ' + k + ' is on a ' + (isDwelling(rec.want) ? 'dwelling' : 'lot outside any market category') +
                    ' — ' + rec.n + ' holds a ' + rec.want + ' the market must never have signed');
    }
  }
  /* 🔢 THE BOOK CLOSES. `let === failed + evicted + standing`, re-added by the
     store. A save whose counters were taken verbatim reported
     `failures: 999999` on a city with an empty ledger and still said ok:true. */
  for (const m of store.check()) problems.push(m);
  return { ok: !problems.length, problems, checkedBids: checked, worstRowError: worst,
           tenancies: store.size(), failures: store.counts().failed,
           refused: store.neverCount(), counterRepairs: store.repairs() };
}

function syncOverlay() {
  try {
    if (!Overlay.mounted()) return;
    Overlay.sync({ lets: store.lets(), vacs: store.vacs(), tiles: tiles() });
  } catch (e) {}
}

/* ════════════════════════════════════════════════════════════════════════════
   MOUNT
   ══════════════════════════════════════════════════════════════════════════ */
export function mount(ctx) {
  if (mounted) return true;
  _ctx = ctx || {};
  BUILDINGS = _ctx.BUILDINGS || {};
  GRID = _ctx.GRID || 24;
  store = makeStore();
  pool = makePool();
  F = makeField({ game: _ctx.game, key: _ctx.key, GRID });
  store.shelfRegister(_ctx.saveSoon);
  pool.setSalt(store.ensureSalt());
  try { Overlay.mount({ THREE: _ctx.THREE, scene: _ctx.scene, grid: GRID }); }
  catch (e) { console.warn('[Tenants] overlay unavailable (non-fatal):', e); }
  try { Panel.mount({ api: () => API, close: () => API.closePanel() }); }
  catch (e) { console.warn('[Tenants] panel unavailable (non-fatal):', e); }
  mounted = true;
  return true;
}

/* Called by the host after loadState, the same place /src/districts reconciles.
   A save carrying a tenancy whose premises are no longer that building type is
   dropped — it could never be acted on again. */
function afterLoad() {
  if (!mounted) return { dropped: 0 };
  pool.setSalt(store.ensureSalt());
  const g = tiles();
  const dropped = store.reconcile((k) => (g[k] ? g[k].type : null));
  /* 🚧 …AND THE GATE IS ASKED ON THE LOAD PATH TOO. A save written by a build
     that had the `award()` defect carries leases on houses, and dropping them
     is not optional: `levelFor` is live on a tenancy, so one of them would go on
     raising the height of a house. Counted apart from `dropped` because it is a
     different fact — the premises are fine, the LEASE was never legal. */
  let ungated = 0;
  for (const k of Object.keys(store.lets())) {
    const p = k.split(','), rec = store.lets()[k];
    if (!marketable(+p[0], +p[1], rec.want, null)) { store.evict(k); ungated++; }
  }
  F.invalidate();
  observe(true);
  return { dropped, ungated, tenancies: store.size(), counterRepairs: store.repairs() };
}

const API = {
  ready: () => mounted,
  mount, afterLoad,

  /* the /src/zoning seams */
  wants, award, levelFor, refusal,

  /* the market */
  observe, explain, tenantAt,
  nameFor: (k) => { const r = store && store.tenancy(k); return r ? r.n : null; },
  bidders: (x, z, bag) => explain(x, z, bag),
  winner: (x, z, bag) => { const w = winnerFor(x, z, bag); return w ? { type: w.type, cand: w.cand, total: w.bid.total } : null; },

  /* WHY EVERY EMPTY LOT IS EMPTY. A building standing with no company willing
     to run it is the user's "buildings become abandoned", and it is only a
     claim if the reason can be read off it. One sentence per vacant lot, from
     the same model that refused it. */
  vacancies: () => {
    if (!mounted) return [];
    const out = [], g = tiles();
    for (const k of Object.keys(store.vacs())) {
      const v = store.vacs()[k], t = g[k], c = k.split(',');
      const x = +c[0], z = +c[1];
      const w = t ? bestBidFor(x, z, t.type, store.housed(), openLots()) : null;
      const e = t ? explain(x, z, [t.type]) : { ok: false };
      const top = (e.ok && e.rows.length) ? e.rows[0] : null;
      out.push({ k, kind: v.never ? 'refused' : 'closed', was: v.n || null,
                 rung: v.rung, why: v.why,
                 type: t ? t.type : null, typeName: t ? nameOfType(t.type) : null,
                 relet: !!w, bestBid: top ? top.total : null,
                 sinks: top ? top.terms.slice().sort((a, b) => a.v - b.v)[0] : null });
    }
    /* …AND THE ZONED LOTS THAT NEVER GOT A BUILDING, which is where most of a
       badly-zoned district's empty land actually is. Derived (see
       `refusedLots`), never stored: there is no tile to hang a record on. */
    for (const r of refusedLots()) {
      const e = explain(r.x, r.z, r.bag);
      const top = (e.ok && e.rows.length) ? e.rows[0] : null;
      out.push({ k: r.k, kind: 'unbuilt', was: null, rung: null,
                 why: sinkLine(r.x, r.z, r.bag),
                 type: null, typeName: null, relet: false,
                 bestBid: top ? top.total : null,
                 sinks: top ? top.terms.slice().sort((a, b) => a.v - b.v)[0] : null });
    }
    return out;
  },

  /* 🌙 IS THE MARKET AWAKE? Published because a module that cannot say it is
     asleep is a module that looks broken and a module that looks working,
     depending on nothing the reader can see. */
  dormant,
  /* Every lot nobody will take, by kind. The count the panel prints. */
  refused: () => (mounted ? { standing: store.neverCount(), unbuilt: refusedLots().length,
                              closed: store.closedCount() } : null),

  /* the record */
  failures: () => (store ? store.failures() : []),
  events: () => _events.slice(),
  stats, verify,
  /* what is scored, what is deliberately not, and what is invented. pool.js and
     tuning.js both claimed the third list was "labelled as fiction HERE and in
     the panel"; it was in neither place the player can see until this seam and
     ui.js's section for it existed. */
  sources: () => ({ ...TEN.bid.sources }),
  omitted: () => OMITTED.map(o => ({ ...o })),
  fiction: () => FICTION.map(o => ({ ...o })),
  radius: radiusOf,

  overlay: (v) => Overlay.toggle(v, { lets: store ? store.lets() : {}, vacs: store ? store.vacs() : {}, tiles: tiles() }),
  /* What the overlay actually PAINTED. A layer is only demonstrated by a count;
     a screenshot of a map cannot distinguish "drew nothing" from "drew nothing
     visible at this camera" — the lesson round 8's crowd diff paid for. */
  overlayPainted: () => Overlay.count(),
  overlayOn: () => Overlay.visible(),
  openPanel: () => { if (!mounted) return false; Panel.show(); return true; },
  closePanel: () => { Panel.hide(); return true; },
  togglePanel: () => (Panel.isOpen() ? API.closePanel() : API.openPanel()),
  panelOpen: () => Panel.isOpen(),

  TEN, SIZES: TEN.sizes,
  _store: () => store, _pool: () => pool, _field: () => F,
};

try {
  if (typeof window !== 'undefined') {
    window.MythicTenants = API;
    if (typeof window.__ncTenantsReady === 'function') window.__ncTenantsReady(API);
  }
} catch (e) {}

export default API;
