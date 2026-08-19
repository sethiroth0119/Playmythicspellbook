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

import { TEN, OMITTED } from './tuning.js';
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
let _firmAt = null, _firmAtDay = -1, _firmAtStamp = 0;
let _lastObserve = null;
let _events = [];                 // the session's opening/closing lines, newest last

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
     of this kind exist in the city, built or not. */
  let empty = 0;
  try {
    const Z = ZON();
    if (Z && Z.stats) empty = Math.max(0, Z.stats().empty | 0);
  } catch (e) {}
  return empty + (store ? store.size() : 0);
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

/* THE WINNER over a whole bag. `bag` is what /src/zoning has left after the
   specialisation and the band filter — this never widens it. */
function winnerFor(x, z, bag) {
  if (!mounted || !Array.isArray(bag) || !bag.length) return null;
  const uniq = [];
  for (const t of bag) if (uniq.indexOf(t) < 0) uniq.push(t);
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
       residential row either, for the same reason. */
    if (cat && cat !== 'com' && cat !== 'off' && cat !== 'ind') return null;
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
  const bag = bagFromZoning(x, z);
  if (!bag.length) return null;                    // not our refusal
  const w = winnerFor(x, z, bag);
  if (w) return null;                              // not refused
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
  const w = bestBidFor(x, z, type, store.housed(), openLots());
  if (!w) return null;
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
  const m = firmAt(force);
  const day = econDay();
  const out = { day, checked: 0, evicted: 0, failed: [], grown: [], struggling: 0,
                relet: [], noBidder: 0, waiting: 0, damaged: 0, econ: !!m };
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

  _lastObserve = out;
  if (out.failed.length || out.relet.length || out.grown.length) {
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
function note(kind, k, msg) {
  _events.push({ kind, k, msg, t: Date.now() });
  while (_events.length > 80) _events.shift();
  if (kind === 'fail') log(msg);
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
  return {
    mounted: true, salt: store.salt(),
    tenancies: store.size(), vacant: store.vacantCount(),
    per, bySize, byRung,
    lifetime: c,
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
  return { ok: !problems.length, problems, checkedBids: checked, worstRowError: worst,
           tenancies: store.size(), failures: store.counts().failed };
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
  F.invalidate();
  observe(true);
  return { dropped, tenancies: store.size() };
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
      out.push({ k, was: v.n, rung: v.rung, why: v.why,
                 type: t ? t.type : null, typeName: t ? nameOfType(t.type) : null,
                 relet: !!w, bestBid: top ? top.total : null,
                 sinks: top ? top.terms.slice().sort((a, b) => a.v - b.v)[0] : null });
    }
    return out;
  },

  /* the record */
  failures: () => (store ? store.failures() : []),
  events: () => _events.slice(),
  stats, verify,
  /* what is scored, and what is deliberately not */
  sources: () => ({ ...TEN.bid.sources }),
  omitted: () => OMITTED.map(o => ({ ...o })),
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
