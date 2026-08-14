/* ════════════════════════════════════════════════════════════════════════════
   🏙 CITY ECONOMY — module entry point. Registers window.MythicEconomy.
   ----------------------------------------------------------------------------
   CLAUDE.md: "NEW features go in public/src/<feature>/ as ES modules. Never add
   a new top-level system to index.html." So the whole economy — data, model,
   tick and diagnosis — lives here, and the host adds ONE script tag and calls
   ONE function per tick.

   🔴 THE GLOBALS TRAP (CLAUDE.md, and it has cost this project real time twice).
   `Profile`, `Cloud`, `App`, `Corp`, `Forge`, `RESOURCES` are top-level `const`
   in index.html — global LEXICAL bindings, NOT properties of `window`. An ES
   module cannot see them, and `window.Profile` is undefined however global
   `const Profile` looks. So this module reads NOTHING by itself. Everything
   arrives through `window.MythicCityBridge`, which node-city already owns and
   already mounts, and if the bridge is missing the module registers, stays
   inert, and says so exactly once.

   🔴 AND IT MUST DEGRADE TO NOTHING. node-city reads this defensively — every
   call site checks `window.MythicEconomy` first. A 404 on /src/economy/* costs
   the player the economy panel and nothing else: the city ticks, the buildings
   produce, and the game is unchanged. Same contract /src/nodes/tiers.js and
   /src/city/terroir.js already document for themselves.

   ── WHAT THIS TOUCHES, AND WHAT IT MUST NEVER TOUCH ─────────────────────────
   TOUCHES:
     • its own simulation state, persisted inside the city save blob
     • `MythicCityBridge.addCinders` — ONCE per tick, for the audited payout
   NEVER TOUCHES:
     • `addRes` / `spendRes` for any chain resource. The 258 ids in
       /src/resources/chain.js are NOT in index.html's `RESOURCES`, and writing
       one through the bridge invents a ledger key the camp UI cannot show and
       the cloud whitelist never syncs — node-city documents this trap at
       CITY_STOCK §2b. Economy goods live in the economy's own inventory.
     • battle, card or combat code (CLAUDE.md: out of scope).
     • `player_banks` and anything else holding real player Cinder. See bank.js.
   ════════════════════════════════════════════════════════════════════════════ */

import { ECON, econ } from './tuning.js';
import * as Recipes from './recipes.js';
import * as Endow from './endowment.js';
import * as Prices from './prices.js';
import * as HH from './households.js';
import * as Firms from './firms.js';
import * as Logistics from './logistics.js';
import * as Bank from './bank.js';
import * as Trade from './trade.js';
import * as Sim from './sim.js';
import * as Bottleneck from './bottleneck.js';
import * as Construction from './construction.js';
import * as Render from './render.js';

const B = () => (typeof window !== 'undefined' ? window.MythicCityBridge : null) || null;

let warned = false;
function warnOnce(msg) {
  if (warned) return; warned = true;
  try { console.warn('[economy] ' + msg); } catch (e) {}
}

let mounted = false;
let lastPayoutAt = 0;

/* ── MOUNT ──────────────────────────────────────────────────────────────────
   Called by the host once the bridge exists. `nodeId` decides the ground the
   city stands on and therefore everything else. */
function mount(opts) {
  opts = opts || {};
  const nodeId = opts.nodeId != null ? opts.nodeId : null;
  Sim.setNode(nodeId);

  if (opts.state) {
    Sim.load(opts.state);
    Sim.setNode(nodeId);            // a save from another node must not move the ground
  } else {
    Sim.reset(nodeId);
  }
  if (typeof opts.population === 'number') HH.setPopulation(opts.population);
  Sim.bootstrap();
  mounted = true;

  /* 🔍 SELF-CHECKS. These are cheap, run once, and report rather than throw —
     a broken recipe must show up in the console with the offending id, not
     take the city down on load. */
  try {
    const chainIds = (window.MythicResourceChain && window.MythicResourceChain.ALL || []).map(r => r.id);
    const a = Recipes.audit(chainIds);
    if (!a.ok) {
      console.warn('[economy] recipe audit FAILED', a);
    } else if (a.orphans.length) {
      console.info('[economy] ' + a.orphans.length + ' catalogued resources have no producer yet (expected — see RESOURCES_NEXT.md).');
    }
    const resid = Prices.convergence();
    if (resid > 1e-3) console.warn('[economy] price relaxation did not converge (residual ' + resid + '). Check for a new recipe cycle.');
    const v = Endow.verify([String(nodeId || 'node')]);
    if (!v.ok) console.warn('[economy] endowment guarantees violated', v.violations);
  } catch (e) { /* diagnostics must never break the mount */ }

  return true;
}

/* ── THE TICK ───────────────────────────────────────────────────────────────
   Called from node-city's existing economyTick. `dtMin` is real minutes, the
   same figure the rest of the city runs on — a second clock would drift and
   two panels would disagree about how long a day is.

   Everything the simulation needs about the city arrives in `host`, gathered by
   the caller. This module never reaches out for it. */
function tick(dtMin, host) {
  if (!mounted) return null;
  try {
    const h = host || {};
    if (typeof h.population === 'number') HH.setPopulation(h.population);
    const snap = Sim.advance(dtMin, h);

    /* 💰 THE ONE WRITE TO THE REAL LEDGER, and it is audited on the way out.
       `claimPayout` returns 0 whenever the closed-loop audit has failed, so a
       simulation that cannot account for its own money pays nothing. */
    const owed = Sim.claimPayout();
    if (owed > 0) {
      const bridge = B();
      if (bridge && typeof bridge.addCinders === 'function') {
        Promise.resolve(bridge.addCinders(owed)).catch(() => {});
        lastPayoutAt = Date.now();
      }
    }
    return snap;
  } catch (e) {
    /* A failure inside the economy must never take the city down. The city is
       a feature; the game is the product. */
    try { console.error('[economy] tick failed', e); } catch (e2) {}
    return null;
  }
}

/* ── FIRM ⇄ BUILDING SYNC ───────────────────────────────────────────────────
   The host owns the tiles; this owns the businesses. `syncBuildings` reconciles
   the two: a production building the player has placed becomes a firm, and a
   firm whose building is gone is closed.

   `list` is [{key, out, ind, capacity}] — the host maps its own tile types to
   resource ids, because only the host knows what its tiles mean.

   ⚠ THE GROUND STILL GATES IT. A building placed over a deposit this node does
     not have produces nothing (sim.js enforces it too), so the host should ask
     `canBuild()` BEFORE offering the blueprint — a building you can pay for and
     that then does nothing is worse than one you were never offered. */
function syncBuildings(list) {
  if (!mounted || !Array.isArray(list)) return { added: 0, removed: 0 };
  let added = 0, removed = 0;
  const wanted = new Map();
  for (const b of list) {
    if (!b || !b.out) continue;
    if (!Recipes.producible(b.out)) continue;
    wanted.set(String(b.key), b);
  }
  for (const f of Firms.all()) {
    if (!f.tileKey) continue;              // bootstrap firms are not tile-owned
    const b = wanted.get(String(f.tileKey));
    /* Gone, OR the tile was demolished and something else built on the same
       square. A key that now names a different business is not the same
       business — without this check a Sawmill rebuilt as a Clinic would keep
       the sawmill's balance sheet, payroll and supplier history. */
    if (!b || b.out !== f.out || b.ind !== f.ind) {
      f.rung = 'BANKRUPT'; f.reported = true; removed++;
    }
  }
  Firms.reap();
  const have = new Set(Firms.alive().map(f => String(f.tileKey)).filter(Boolean));
  for (const [key, b] of wanted) {
    if (have.has(key)) continue;
    /* 📈 LEVEL SCALES CAPACITY, so upgrading a building means something
       economically rather than only visually. Explicit capacity wins if the
       host supplied one. */
    const lvl = Math.max(1, b.lvl | 0 || 1);
    const cap = b.capacity != null ? b.capacity : Firms.defaultCapacity(b.out) * lvl;
    Firms.found(b.out, { ind: b.ind, capacity: cap, tileKey: key, name: b.name });
    added++;
  }
  return { added, removed };
}

/* Can the player put an extractor for `resId` on this node at all?
   THE one gate — see endowment.js. Non-deposits always return true. */
function canBuild(resId) {
  return Endow.canExtract(Sim.state().nodeId, resId);
}

/* 🎯 Pick the best id this node can actually produce from a candidate list.
   ----------------------------------------------------------------------------
   The host maps a BUILDING to a set of plausible outputs — a Farm could grow
   wheat, corn, rice or potatoes — and this answers which one THIS ground
   supports, best seam first. Returns null when the node supports none of them,
   which is the host's cue not to offer the blueprint at all.

   🔴 THIS IS WHY A FARM IS NOT HARD-WIRED TO WHEAT. Pinning each building to a
   single resource would mean a node without wheat could not have a farm, and a
   player would pay for a building that then produced nothing — which is worse
   than never being offered it. It is also what makes one city a wheat town and
   its neighbour a rice town without either of them choosing. */
function pickAvailable(ids) {
  if (!Array.isArray(ids) || !ids.length) return null;
  const nodeId = Sim.state().nodeId;
  let best = null, bestRank = -1;
  for (const id of ids) {
    if (!Recipes.producible(id)) continue;
    // A non-deposit is always makeable; a deposit has to be in the ground.
    if (!Recipes.isDeposit(id)) return id;
    if (!Endow.canExtract(nodeId, id)) continue;
    const rank = (Endow.gradeDef(Endow.gradeOf(nodeId, id)) || {}).rank || 0;
    if (rank > bestRank) { bestRank = rank; best = id; }
  }
  return best;
}

/* ── 🃏 THE FOUNDATION RESERVE SEAM ─────────────────────────────────────────
   "NPCs buying cards puts Cinder back into that entire supply chain. This will
    connect to the foundation reserve."

   🔴 THIS REPORTS. IT DOES NOT MINT, AND IT MUST NOT.
   It tells the host how much Ouroboros product this city actually printed and
   sold — real units, out of a real chain that consumed real paper, ink and
   holographic foil. What the host chooses to do with that figure (a Foundation
   Reserve contribution, a leaderboard, a season metric) is the host's decision
   and belongs on the host's side of the bridge, where `FoundationReserve` and
   `Profile` actually live. Paying out from in here would be a second, unaudited
   faucet, which is the one thing this whole design exists to prevent. */
function cardOutput() {
  const ids = ['printedCards', 'boosterPacks', 'starterDecks', 'collectorPacks',
               'cardBoxes', 'tournamentProducts'];
  const out = { units: {}, totalUnits: 0, value: 0, exported: 0 };
  const st = Sim.state();
  const exported = (Trade.state().lastExported) || {};
  for (const id of ids) {
    const made = (st.observed[id] || {}).supply || 0;
    if (made <= 0 && !exported[id]) continue;
    out.units[id] = made;
    out.totalUnits += made;
    out.value += made * Prices.priceOf(id);
    out.exported += exported[id] || 0;
  }
  return out;
}

/* ════════════════════════════════════════════════════════════════════════════
   🌐 REAL CITY-TO-CITY TRADE — publish, discover, settle.
   ----------------------------------------------------------------------------
   🔴 NOT ONE SUPABASE CALL LIVES IN /src/economy, AND NONE MAY BE ADDED.
   `Cloud` and `Profile` are top-level `const` in index.html — invisible to an
   ES module (the globals trap, at the top of this file). The three network
   operations therefore live over there, next to the client that can actually
   make them, and reach this module through `MythicCityBridge.cityTrade`:

       publish(payload) -> bool      upsert city_profiles + city_trade_offers
       discover()       -> rows[]    other players' city_profiles
       fill(offerId, n) -> row       the city_trade_fill(offer_id, units) RPC

   This is the seam /src/trading/index.js already documents for the player
   market ("The Supabase calls stay in index.html next to ResMarket, because
   that is where Cloud, Profile and the realtime channel live"), and the shape
   is identical: primitives across the bridge, decisions on the side that owns
   the data.

   🔴 AND IT MUST DEGRADE TO NOTHING AT ALL. sql/038 is NOT APPLIED. There is no
      city_profiles table today, the client cannot know that, and it must not
      care: every step below is independently guarded, and any failure — no
      bridge, no network, no tables, an RLS refusal, a hostile row, a timeout —
      ends with `Trade.ensureSimulated()` and a city that keeps trading against
      the simulated neighbours it has always had. The migration upgrades the
      partners; it does not enable the feature. */

/* What this city publishes about itself. All primitives, freshly built — never
   a reference into Trade's own state (the past live bug on the card seam was a
   host object stored BY REFERENCE that leaked NaN into a panel). */
function tradePublishPayload() {
  const st = Sim.state();
  const tr = Trade.state();
  const sells = {}, buys = {};
  for (const o of tr.offers) if (o && o.res) sells[o.res] = o.units;
  /* The gaps this city structurally CANNOT make. A want gives the real
     quantity; a gap with no want yet still advertises the smallest quantity
     worth trading, so a neighbour can see the standing interest before this
     city has run short — which is the whole mechanism behind exportInterest(). */
  const wantUnits = {};
  for (const w of tr.wants) if (w && w.res) wantUnits[w.res] = w.units;
  for (const g of Bottleneck.structuralGaps()) {
    if (!g || !g.res) continue;
    buys[g.res] = wantUnits[g.res] || ECON.trade.minOffer;
  }
  const rows = [];
  for (const o of tr.offers) {
    rows.push({ side: 'sell', res: o.res, units: o.units, unitPrice: o.price, urgent: false });
  }
  for (const w of tr.wants) {
    if (rows.length >= ECON.trade.maxOpenOffers * 2) break;
    rows.push({ side: 'buy', res: w.res, units: w.units, unitPrice: w.maxPrice, urgent: !!w.urgent });
  }
  return {
    nodeId: st.nodeId != null ? String(st.nodeId) : null,
    specs: tr.active.slice(),
    sells, buys, offers: rows,
    day: st.day | 0,
    population: Math.round(HH.population()),
  };
}

/* One economic day's network round trip. Async, and the host must NOT await it
   inside a tick — nothing here may touch the treasury or the inventory, and
   nothing does: a confirmed fill is queued in trade.js and booked by match()
   inside the next audited day. See the settlement block in trade.js. */
async function tradeSync() {
  const out = { published: false, discovered: 0, real: 0, requested: 0,
                filled: 0, credited: 0, degraded: false, errors: [] };
  if (!mounted) { out.degraded = true; out.errors.push('not-mounted'); return out; }
  const nodeId = Sim.state().nodeId;
  const net = (() => { try { const b = B(); return (b && b.cityTrade) || null; } catch (e) { return null; } })();
  if (!net) {
    /* The overwhelmingly common case: standalone, offline, signed out, or an
       older host with no trade seam. Not an error and not logged as one. */
    out.degraded = true;
    Trade.ensureSimulated(nodeId);
    return out;
  }

  // ── 1. PUBLISH. A failure here costs this city visibility, nothing else.
  try {
    if (typeof net.publish === 'function') out.published = !!(await net.publish(tradePublishPayload()));
  } catch (e) { out.errors.push('publish'); }

  // ── 2. DISCOVER.
  let rows = null;
  try {
    if (typeof net.discover === 'function') rows = await net.discover();
  } catch (e) { out.errors.push('discover'); rows = null; }
  if (Array.isArray(rows) && rows.length) {
    /* THE ONLY CALL THE NETWORK PATH NEEDS. Matching, freight and pricing work
       against a real partner exactly as they do against a simulated one. */
    out.discovered = Trade.setPartners(rows);
  } else {
    /* No rows is the offline answer AND the "nobody else has published yet"
       answer, and they are indistinguishable from here. Both keep the partners
       already on the books rather than emptying a market on a transient read —
       a non-empty discovery replaces the real ones, this does not. */
    out.degraded = true;
  }
  Trade.ensureSimulated(nodeId);
  const partners = Trade.state().partners;
  out.real = partners.filter(p => !p.simulated).length;

  // ── 3. SETTLE. One RPC per planned line, and each one is caught alone.
  if (out.real && typeof net.fill === 'function') {
    const plan = Trade.planFills(Sim.state().treasury, Sim.state().day);
    out.requested = plan.length;
    for (const req of plan) {
      let row = null;
      try {
        row = await net.fill(req.offerId, req.units);
      } catch (e) {
        /* A throw or a timeout credits NOTHING, by not calling recordFill at
           all. That is the same outcome as a rejected row, reached without a
           second code path that could disagree with the first. */
        out.errors.push('fill');
        continue;
      }
      const r = Trade.recordFill(req, row);
      out.filled += r.filled; out.credited += r.credited;
    }
  }
  return out;
}

/* ── PERSISTENCE ────────────────────────────────────────────────────────────
   The host stores this blob inside its own city save. Absent-tolerant on load,
   like everything else in this codebase that loads. */
function serialize() { return mounted ? Sim.serialize() : null; }
function load(raw) { const ok = Sim.load(raw); mounted = true; return ok; }

/* ════════════════════════════════════════════════════════════════════════════
   THE PUBLIC SURFACE
   ════════════════════════════════════════════════════════════════════════════ */
const api = {
  // lifecycle
  mount, tick, serialize, load,
  ready: () => mounted,

  // the city ⇄ economy seam
  syncBuildings, canBuild, pickAvailable, cardOutput,
  setPopulation: (n) => HH.setPopulation(n),

  /* 🌐 THE TRADE NETWORK SEAM. `tradeSync()` is the whole of it for the host —
     one call per economic day. The rest is exposed so a driver can exercise
     each step alone, because the live path cannot be tested at all until
     sql/038 is applied and a second player exists.
     ⚠ `settle()` is `Trade.recordFill` itself, not a copy. A seam that
       re-implemented the credit rule would be testing itself, and the rule it
       enforces (credit `filled`, never the request) is the one that stops a
       seller shipping the same 40 units twice. */
  tradeSync,
  tradePayload: tradePublishPayload,
  tradePartners: (rows) => Trade.setPartners(rows),
  tradePlan: (cash) => Trade.planFills(cash != null ? cash : Sim.state().treasury, Sim.state().day),
  settle: (req, row) => Trade.recordFill(req, row),
  tradePending: () => Trade.pendingSettlements(),
  tradeStats: () => Trade.settleStats(),

  // reads for the UI
  snapshot: () => (mounted ? Sim.snapshot() : null),
  log: () => Sim.log(),
  firms: () => Firms.alive(),
  firm: (id) => Firms.byId(id),
  inventory: () => Sim.inventory(),
  price: (id) => Prices.priceOf(id),
  movers: (n) => Prices.movers(n),
  survey: () => ({
    nodeId: Sim.state().nodeId,
    have: Endow.have(Sim.state().nodeId),
    lack: Endow.lack(Sim.state().nodeId),
    gaps: Endow.strategicGaps(Sim.state().nodeId),
    strengths: Endow.strengths(Sim.state().nodeId),
    byIndustry: Endow.byIndustry(Sim.state().nodeId),
    grade: (id) => Endow.gradeOf(Sim.state().nodeId, id),
  }),

  // diagnosis
  diagnose: (firmId) => Bottleneck.diagnose(Firms.byId(firmId)),
  bottlenecks: (n) => Bottleneck.cityReport(n),
  primaryBottleneck: () => Bottleneck.primary(),
  trace: (resId) => Bottleneck.trace(resId),
  structuralGaps: () => Bottleneck.structuralGaps(),

  // firm actions the UI can offer
  levelCheck: (firmId) => Firms.levelCheck(Firms.byId(firmId)),
  borrow: (firmId, amount) => Bank.borrow(Firms.byId(firmId), amount, Sim.state().day),

  // rendering (markup only — the host owns the DOM)
  css: Render.ECONOMY_CSS,
  render: Render.renderPanel,
  renderFirm: Render.renderFirm,
  renderSurvey: Render.renderSurvey,
  renderChain: Render.renderChain,

  /* 🏗 CONSTRUCTION TIMERS — how long a building takes to go up.
     The host computes a PROFILE from `BUILDINGS` (which only it can see, and
     which no module can reach — the globals trap above) and hands it here. The
     curve and every number in it live in ECON.construction and NOWHERE else,
     so index.html carries not one literal from this feature.
     ⚠ THE ABSENCE OF THIS FUNCTION IS A DEFINED STATE, NOT A BUG. The host
       tests `typeof E.buildSeconds === 'function'` and, finding nothing,
       writes no timer and places instantly — and completes every job already
       on disk rather than parking it behind a module that never arrived. */
  buildSeconds: (profile) => Construction.seconds(profile),

  // the tuning table and the catalogues, for tools and tests
  ECON, econ,
  recipes: Recipes,
  endowment: Endow,
  specializations: Trade.SPECIALIZATIONS,
  basket: HH.BASKET,
  industries: Recipes.INDUSTRIES,

  // audit surface — deliberately public so a tester can prove the invariant
  audit: () => Sim.state().lastAudit,
  totalCinder: () => Sim.totalCinder(),
};

/* 🔌 THE BRIDGE. module → window is the direction that works; window → a
   top-level `const` in index.html is the direction that does not. Same pattern
   /src/resources/chain.js and /src/nodes/tiers.js already use. */
try {
  if (typeof window !== 'undefined') {
    window.MythicEconomy = api;
    if (!B()) warnOnce('window.MythicCityBridge is not mounted yet — the economy is registered but inert until mount() is called.');
  }
} catch (e) {}

export default api;
