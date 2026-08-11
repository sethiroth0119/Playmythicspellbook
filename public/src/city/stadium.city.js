/* ══════════════════════════════════════════════════════════════════════════
   🏟 THE STADIUM — city mount, readiness panel and settlement.
   ──────────────────────────────────────────────────────────────────────────
   The half that touches the city. It owns:
     · the per-tile stadium state (rides the tile's own save object, `t.stad`)
     · the node/world SNAPSHOTS handed to the pure economy module
     · the prep-phase readiness panel and the post-event results screen
     · the mutation SINK and the orchestration that keeps settlement atomic
   It owns NO rules. Every number is stadium.economy.js's STADIUM_ECON.

   🔴 THE GLOBALS TRAP (CLAUDE.md). `game`, `BUILDINGS`, `vitals`, `wellbeing`,
   `MythicCityBridge` and friends are top-level `const` inside node-city's
   module script — lexical bindings, NOT window properties. Every one of them
   arrives here in the `ctx` object node-city builds by hand. Nothing in this
   file reaches for a bare global, and a missing ctx field degrades rather
   than throws.

   🔴 WHY SETTLEMENT IS SPLIT ASYNC-THEN-SYNC.
   Other players are being paid. The only operations that can fail for reasons
   outside this page are the two that cross the bridge: taking the event's
   water out of the game ledger, and crediting the host's Cinder. Both are done
   FIRST, each is individually all-or-nothing, and each has exactly one
   inverse. Everything after that is in-memory city state mutated by
   `commitSettlement`, which is synchronous and journalled — so it cannot
   half-happen, and if it somehow does, it unwinds itself and this function
   then reverses the two bridge calls. There is no ordering in which a shop is
   credited from a pot that was never debited.

   🌐 CROSS-PLAYER PAYOUTS ARE THE SERVER'S JOB, AND THE SERVER IS NOT WIRED.
   A payout to somebody else's building cannot be written from this client — it
   would be an unauthenticated credit to another user. Those rows go to
   `stadium_settle_event` (sql/015_stadium_events.sql), one Postgres
   transaction — which HAS NEVER BEEN APPLIED. Read `postToServer`'s header
   below for the four wires that are still missing before a single Cinder can
   reach another player.
   ⚠ Until then the rows go to the LOCAL append-only ledger flagged
     `posted:false`, and — new at r10 — the SPILLOVER REPORT SAYS SO, per row
     and in a warning line naming the total that has not moved. r9 printed
     "Mira +8🔥" for money Mira could never see. A UI that claims a payout which
     never arrives is worse than one that admits the feature is half-built.
   CLAUDE.md: the app must work before the tables exist. It does; it just must
   not lie about what it can do while they do not.
   ══════════════════════════════════════════════════════════════════════════ */
import * as E from './stadium.economy.js';

const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = n => Math.round(Number(n) || 0).toLocaleString('en-US');

export const STADIUM_TYPE = 'stadium';
const ECON = E.STADIUM_ECON;
/* One definition of the four concession labels, shared with the readiness panel
   — see the export in stadium.economy.js. */
const DRAIN_ICO = E.CONC_ICO;

let CTX = null;
let OPEN_KEY = null;
let LAST_RESULT = null;         // the most recent settlement, for the results screen

/* ── per-tile state ────────────────────────────────────────────────────── */
export function stadiumOf(t) {
  if (!t) return null;
  if (!t.stad) {
    t.stad = {
      eventsCompleted: 0, satSum: 0, avgSatisfaction: 0, lastEventAt: 0,
      bestPrizePool: 0, bestEntrantRR: 0,
      /* 📈 THE COMPOUNDING PAYOFF, MADE VISIBLE.
         The pack's migration rate is per-visitor at real-city scale: a well-run
         event settles roughly ten new residents into a node whose population is
         200,000. That is the right number and it is invisible on a single
         results screen — so the stadium keeps the RUNNING TOTAL, which is what
         "a stadium run well for a season measurably grows the city" actually
         means. Cumulative, never reset. */
      migrantsTotal: 0, migrantsTurnedAway: 0,
      vendorFeePct: ECON.vendorFee.defaultPct,
      pricing: E.clampTicketPricing(null),
      markupPct: ECON.concession.defaultMarkupPct,
      lengthCycles: 1,
      ledger: [],               // append-only. Balance = sum(amount).
    };
  }
  return t.stad;
}
/* Absent-tolerant on load — this project has shipped silent save bugs three
   times (_BAR9.md). Every field is defaulted, and an unknown field survives. */
export function saveTile(t) { return t && t.stad ? JSON.parse(JSON.stringify(t.stad)) : null; }
export function loadTile(t, raw) {
  if (!t) return;
  const s = stadiumOf(t);
  if (!raw || typeof raw !== 'object') return;
  for (const k of Object.keys(s)) if (raw[k] != null) s[k] = raw[k];
  if (!Array.isArray(s.ledger)) s.ledger = [];
  s.pricing = E.clampTicketPricing(s.pricing);
}

/* ── SNAPSHOTS: the whole of what the pure module is allowed to see ─────── */

/** Every stadium tile, with its key and level. */
export function stadiumTiles() {
  const out = [];
  const tiles = (CTX && CTX.game && CTX.game.tiles) || {};
  for (const k in tiles) {
    if (tiles[k] && tiles[k].type === STADIUM_TYPE) {
      const [x, z] = k.split(',').map(Number);
      out.push({ key: k, x, z, tile: tiles[k] });
    }
  }
  return out;
}

export function stadiumInput(k) {
  const tiles = (CTX && CTX.game && CTX.game.tiles) || {};
  const t = tiles[k]; if (!t) return null;
  const s = stadiumOf(t);
  const [x, z] = k.split(',').map(Number);
  return {
    key: k, x, z, lvl: t.lvl || 1,
    eventsCompleted: s.eventsCompleted, avgSatisfaction: s.avgSatisfaction,
    lastEventAt: s.lastEventAt, bestPrizePool: s.bestPrizePool, bestEntrantRR: s.bestEntrantRR,
    vendorFeePct: s.vendorFeePct,
    ownerId: (CTX && CTX.identity && CTX.identity().userId) || null,
    ownerName: (CTX && CTX.identity && CTX.identity().name) || null,
  };
}

/**
 * The node snapshot. Everything here is READ from the live city — nothing is
 * invented, and where the city has no such concept the field is simply absent
 * and the economy module treats it as zero.
 */
export function nodeSnapshot() {
  const g = (CTX && CTX.game) || {};
  const V = (CTX && CTX.vitals) || {};
  const W = (CTX && CTX.wellbeing) || {};
  const cov = (g.cov && g.cov.pct) || {};
  const B = (CTX && CTX.BUILDINGS) || {};
  const tiles = g.tiles || {};

  let motorPoolCapacity = 0, railYardCapacity = 0, roadsTotal = 0, roadsRepaired = 0;
  const buildings = [];
  for (const k in tiles) {
    const t = tiles[k]; if (!t) continue;
    const [x, z] = k.split(',').map(Number);
    if (t.type === 'road') { roadsTotal++; if (!t.damaged) roadsRepaired++; continue; }
    if (t.damaged) continue;                       // a burnt-out building moves nobody
    if (t.type === 'motorpool') motorPoolCapacity += (t.lvl || 1);
    if (t.type === 'railyard') railYardCapacity += (t.lvl || 1);
    const def = B[t.type];
    if (def) {
      /* Base revenue for one CYCLE, in the design pack's raw 🔥 (the economy
         module divides once, at the payout boundary). Read from the catalog's
         own `gen.cinder` per-minute rate and node-city's own RATE_MULT-per-
         level curve — never guessed. A building with no cinder yield has
         nothing to spill over onto, and spilloverTargets skips it anyway. */
      const lvlMult = Math.pow(CTX.rateMult || ECON.rateMultPerLevel, (t.lvl || 1) - 1);
      const perMin = (def.gen && def.gen.cinder) || 0;
      /* A service building has no `gen.cinder` — see STADIUM_ECON.spillover's
         note on servicePricePerUnit for why its takings come from svc.rate. */
      const svcRate = (def.svc && def.svc.rate) || 0;
      const perCycle = perMin > 0
        ? perMin * lvlMult * ECON.cycleMinutes
        : svcRate * lvlMult * ECON.cycleMinutes * ECON.spillover.servicePricePerUnit / ECON.cinderDivisor;
      buildings.push({
        key: k, x, z, type: t.type, lvl: t.lvl || 1, tenant: t.tenant || null,
        baseRevenue: perCycle * ECON.cinderDivisor,
        ownerId: t.tenantId || null,
        ownerName: t.tenant || (CTX && CTX.identity && CTX.identity().name) || null,
      });
    }
  }

  const pop = (CTX && CTX.pop && CTX.pop()) || 0;
  const capPop = (CTX && CTX.popCap && CTX.popCap()) || 0;
  /* 👥 THE REAL POPULATION, IF IT IS REACHABLE. Every world node carries
     `recon.population` (index.html `_twNodeReconDefaults`, default 200,000) —
     that is the figure the design pack's attendance formulas mean. It arrives
     here only if the parent hands the anchor's node object over with its recon
     blob attached; it is read defensively and, when it is absent, the economy
     module falls back to `population × catchment` and says so. Nothing is
     invented either way. */
  let residents = 0;
  try {
    for (const a of (g.anchors || [])) {
      const p = a && a.node && a.node.recon && Number(a.node.recon.population);
      if (p > 0) { residents = Math.max(residents, p); }
    }
  } catch (e) {}
  return {
    population: pop, residents,
    morale: Number(W.morale) || 0,
    hope: Number(V.hope) || 0,
    security: Number(V.security) || 0,
    health: Number(V.health) || 0,
    powerGen: Number((g.power || {}).gen) || 0,
    powerDemand: Number((g.power || {}).demand) || 0,
    powerRatio: Number((g.power || {}).ratio != null ? g.power.ratio : 1),
    foodCoverage: Number(cov.food) || 0,
    waterCoverage: Number(cov.water) || 0,
    housingHeadroom: Math.max(0, capPop - pop),
    stock: { ...(g.stock || {}) },
    res: { ...(g.res || {}) },
    buildings,
    motorPoolCapacity, railYardCapacity, roadsTotal, roadsRepaired,
    ownerId: (CTX && CTX.identity && CTX.identity().userId) || null,
  };
}

export function worldSnapshot() {
  const V = (CTX && CTX.vitals) || {};
  const g = (CTX && CTX.game) || {};
  /* Neighbour cities come from MythicCityBridge.fetchNeighborCities() — real
     rows, already fetched by boot(). `route` is whether a caravan route is
     live between us; the city has Caravan Posts, so "we have a post and they
     are a known neighbour" is the closest thing that exists to an active trade
     route. It is NOT invented: no post, no route, and the tourist flow drops
     to routeUnlinked. */
  const hasPost = Object.values(g.tiles || {}).some(t => t && t.type === 'caravanpost' && !t.damaged);
  const neighbours = ((CTX && CTX.neighbours && CTX.neighbours()) || []).map(n => ({
    name: n.name, owner: n.owner,
    population: Number(n.population) || (CTX.pop ? CTX.pop() : 0),
    route: !!hasPost,
  }));
  return {
    neighbours,
    anchors: ((g.anchors) || []).map(a => ({
      level: (a.node && a.node.level) || 1, link: a.link || 0,
    })),
    tradeStability: Number(V.trade) || 0,
  };
}

/** The event object the economy module reads. Player-set fields live on the tile. */
export function eventInput(k, over) {
  const tiles = (CTX && CTX.game && CTX.game.tiles) || {};
  const t = tiles[k]; if (!t) return null;
  const s = stadiumOf(t);
  const card = t.card && CTX && CTX.cardById ? CTX.cardById(t.card) : null;
  return Object.assign({
    id: (s.lastEventId || null),
    stadium: stadiumInput(k),
    pricing: s.pricing, markupPct: s.markupPct, lengthCycles: s.lengthCycles,
    vendorFeePct: s.vendorFeePct,
    prizePool: 0, topEntrantRR: 0,
    headlinerName: card ? card.name : null,
    headlinerPower: card ? (Number(card.power) || 0) : null,
  }, over || {});
}

/* ── the read-only computations the panel prints ───────────────────────── */
export function readinessNow(k) {
  const ev = eventInput(k); if (!ev) return null;
  const r = E.eventReadiness(ev, nodeSnapshot(), worldSnapshot(), Date.now());
  const bad = E.assertReadinessContract(r);
  if (bad.length) { try { console.warn('[Stadium] check with no fix:', bad); } catch (e) {} }
  return r;
}
export function planNow(k, over) {
  const ev = eventInput(k, over); if (!ev) return null;
  return E.settleEvent(ev, nodeSnapshot(), worldSnapshot(), Date.now());
}

/* ══ THE SINK — the only thing that mutates the city ════════════════════
   Synchronous by construction. Every method has an inverse; commitSettlement
   journals what it applied and unwinds in reverse on any failure.
   `fail` is a TEST SEAM: a driver sets it to the name of a sink method to
   force a mid-settlement failure and prove nothing partial survives. It is
   never set in play — see `_forceFail` at the bottom.               ── */
let FORCE_FAIL = null;
function tripwire(name) { if (FORCE_FAIL === name) throw new Error('forced failure at sink.' + name); }

export function makeSink(k) {
  const g = (CTX && CTX.game) || {};
  const t = (g.tiles || {})[k];
  const s = t ? stadiumOf(t) : null;
  const hostId = (CTX && CTX.identity && CTX.identity().userId) || null;
  /* Prior values, captured as each op runs, so every inverse restores exactly
     what was there rather than re-deriving it. See the note on the morale
     inverse below. One sink per settlement, so this cannot leak between runs. */
  const prev = {};
  return {
    drain(consumed) {
      tripwire('drain');
      /* Water was already reserved out of the game LEDGER before commit (see
         settleAndCommit); here we only mirror it so the HUD and coverage read
         the truth on the very next tick. Everything else is city stock. */
      for (const r in consumed) {
        const n = Number(consumed[r]) || 0; if (n <= 0) continue;
        if (r === 'water') { g.res.water = Math.max(0, (g.res.water | 0) - Math.ceil(n)); continue; }
        g.stock[r] = Math.max(0, (Number(g.stock[r]) || 0) - n);
      }
      return true;
    },
    undrain(consumed) {
      for (const r in consumed) {
        const n = Number(consumed[r]) || 0; if (n <= 0) continue;
        if (r === 'water') { g.res.water = (g.res.water | 0) + Math.ceil(n); continue; }
        g.stock[r] = (Number(g.stock[r]) || 0) + n;
      }
      return true;
    },
    credit(row) {
      tripwire('credit');
      /* 🔴 APPEND ONLY. Never an UPDATE to a balance — balance is sum(amount).
         `posted` means "this money has actually reached its recipient". Rows
         addressed to the host have (settleAndCommit's addCinders call, one step
         earlier). Rows addressed to somebody else have NOT, and cannot be from
         here: the local client has no authority to credit another player's
         wallet and must not pretend it does.
         ⚠ The `&& hostId != null` clause was dropped r10. It made a signed-out
           player's OWN rows read `posted:false` even though their Cinder had
           moved, and it disagreed with economy.js's `toId === hostId` host
           filter — the asymmetry the r9 critic found. Signed out, hostId is
           null and every building in the city is the player's, so null === null
           is the right answer on both sides. */
      s.ledger.push(Object.assign({}, row, { posted: row.toId === hostId }));
      return true;
    },
    uncredit(row) {
      for (let i = s.ledger.length - 1; i >= 0; i--) {
        const r = s.ledger[i];
        if (r.eventId === row.eventId && r.kind === row.kind && r.toId === row.toId && r.amount === row.amount) {
          s.ledger.splice(i, 1); return true;
        }
      }
      return true;
    },
    /* ⚠ EXACT-RESTORE INVERSES, not negation. node-city clamps morale and hope
       to 0-100, so a +18 that saturated at 100 does NOT come back to 82 when
       you subtract 18 — the fallback inverse would silently INVENT morale on
       every rolled-back settlement. Each of these snapshots the prior value
       and puts it back byte for byte. */
    morale(d) {
      tripwire('morale');
      if (CTX && CTX.wellbeing) {
        prev.morale = CTX.wellbeing.morale;
        CTX.wellbeing.morale = Math.max(0, Math.min(100, (CTX.wellbeing.morale || 0) + d));
      }
      return true;
    },
    unmorale() { if (CTX && CTX.wellbeing && prev.morale !== undefined) CTX.wellbeing.morale = prev.morale; return true; },
    hope(d) {
      tripwire('hope');
      if (CTX && CTX.vitals) {
        prev.hope = CTX.vitals.hope;
        CTX.vitals.hope = Math.max(0, Math.min(100, (CTX.vitals.hope || 0) + d));
      }
      return true;
    },
    unhope() { if (CTX && CTX.vitals && prev.hope !== undefined) CTX.vitals.hope = prev.hope; return true; },
    migrate(citizens) {
      tripwire('migrate');
      if (g.pop) { prev.npc = g.pop.npc; g.pop.npc = Math.max(0, (g.pop.npc || 0) + citizens); }
      return true;
    },
    unmigrate() { if (g.pop && prev.npc !== undefined) g.pop.npc = prev.npc; return true; },
    unprestige() {
      if (!s || !prev.hist) return true;
      s.eventsCompleted = prev.hist.eventsCompleted; s.satSum = prev.hist.satSum;
      s.avgSatisfaction = prev.hist.avgSatisfaction; s.lastEventAt = prev.hist.lastEventAt;
      s.bestPrizePool = prev.hist.bestPrizePool;
      s.migrantsTotal = prev.hist.migrantsTotal; s.migrantsTurnedAway = prev.hist.migrantsTurnedAway;
      return true;
    },
    unmarkSettled() {
      if (!s || !prev.mark) return true;
      s.lastEventId = prev.mark.lastEventId; s.lastResult = prev.mark.lastResult;
      return true;
    },
    prestige(value, plan) {
      tripwire('prestige');
      if (!s) return true;
      prev.hist = { eventsCompleted: s.eventsCompleted, satSum: s.satSum,
                    avgSatisfaction: s.avgSatisfaction, lastEventAt: s.lastEventAt,
                    bestPrizePool: s.bestPrizePool,
                    migrantsTotal: s.migrantsTotal, migrantsTurnedAway: s.migrantsTurnedAway };
      s.migrantsTotal = (s.migrantsTotal || 0) + (plan.migration.housed || 0);
      s.migrantsTurnedAway = (s.migrantsTurnedAway || 0) + (plan.migration.turnedAway || 0);
      /* Prestige is DERIVED from history, so what is stored is the history —
         storing the score itself would let it desync from the events that
         earned it. `value` is carried only so the report can print it. */
      s.eventsCompleted += 1;
      s.satSum += plan.satisfaction.score;
      s.avgSatisfaction = +(s.satSum / s.eventsCompleted).toFixed(2);
      s.lastEventAt = plan.at;
      s.bestPrizePool = Math.max(s.bestPrizePool || 0, Number(plan.prizePool) || 0);
      return true;
    },
    markSettled(eventId, plan) {
      tripwire('markSettled');
      if (!s) return true;
      prev.mark = { lastEventId: s.lastEventId, lastResult: s.lastResult };
      s.lastEventId = eventId;
      s.lastResult = { at: plan.at, score: plan.satisfaction.score, attendance: plan.attendance.total };
      return true;
    },
  };
}

/* ══ ORCHESTRATION ═════════════════════════════════════════════════════ */

/**
 * 🆔 A REAL UUID, because the server column is one.
 * ⚠ r9 minted `ev_msjxt9gf_abc123`. `stadium_settle_event(p_event_id uuid, …)`
 *   would have rejected that at the parameter cast, before the function body —
 *   one of the four independent reasons the server half was unreachable. The
 *   id is generated here and not by Postgres because it has to exist before
 *   settlement, offline, to stamp every local ledger row (CLAUDE.md: the app
 *   must work before the tables exist).
 * `crypto.randomUUID` is unavailable on http:// origins in some browsers, so
 * there is a getRandomValues path and then a Math.random path. All three
 * produce a v4-shaped uuid the column will accept.
 */
export function newEventId() {
  try { if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID(); } catch (e) {}
  let b;
  try {
    if (typeof crypto !== 'undefined' && crypto.getRandomValues) { b = new Uint8Array(16); crypto.getRandomValues(b); }
  } catch (e) { b = null; }
  if (!b) { b = new Uint8Array(16); for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256); }
  b[6] = (b[6] & 0x0f) | 0x40;      // version 4
  b[8] = (b[8] & 0x3f) | 0x80;      // variant 10x
  const h = Array.from(b, x => x.toString(16).padStart(2, '0')).join('');
  return h.slice(0, 8) + '-' + h.slice(8, 12) + '-' + h.slice(12, 16) + '-' + h.slice(16, 20) + '-' + h.slice(20);
}
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function settleAndCommit(k, over) {
  const g = (CTX && CTX.game) || {};
  const t = (g.tiles || {})[k];
  if (!t || t.type !== STADIUM_TYPE) return { ok: false, error: 'no stadium' };

  const eventId = (over && over.id) || newEventId();
  const plan = planNow(k, Object.assign({ id: eventId }, over || {}));
  if (!plan) return { ok: false, error: 'no plan' };

  /* ── STEP 1: the ledger water, out of the game ledger, all or nothing. ── */
  const waterWant = Math.ceil(Number(plan.drain.water) || 0);
  let waterTaken = 0;
  if (waterWant > 0 && CTX && CTX.spendRes) {
    let ok = false;
    try { ok = await CTX.spendRes({ water: waterWant }); } catch (e) { ok = false; }
    if (!ok) return { ok: false, error: 'ledger refused the water draw — nothing was settled', plan };
    waterTaken = waterWant;
  }

  /* ── STEP 2: the host's own Cinder. One call, one inverse. ── */
  const hostCinder = plan.totals.hostCinder;
  let cinderPaid = 0;
  if (hostCinder > 0 && CTX && CTX.addCinders) {
    let ok = false;
    try { ok = (await CTX.addCinders(hostCinder)) !== false; } catch (e) { ok = false; }
    if (!ok) {
      if (waterTaken && CTX.addRes) { try { await CTX.addRes('water', waterTaken); } catch (e) {} }
      return { ok: false, error: 'could not credit Cinder — nothing was settled', plan };
    }
    cinderPaid = hostCinder;
  }

  /* ── STEP 3: in-memory city state. Synchronous, journalled, atomic. ── */
  const res = E.commitSettlement(plan, makeSink(k));
  if (!res.ok) {
    if (cinderPaid && CTX.spendCinders) { try { await CTX.spendCinders(cinderPaid); } catch (e) {} }
    if (waterTaken && CTX.addRes) { try { await CTX.addRes('water', waterTaken); } catch (e) {} }
    return { ok: false, error: res.error, rolledBack: res.rolledBack, applied: 0, plan };
  }

  /* ── STEP 4: post the cross-player rows, if there is a server to post to.
        Guarded: offline the rows stay `posted:false` and the report says so. ── */
  let posted = null;
  try { posted = await postToServer(plan); } catch (e) { posted = { ok: false, error: String(e && e.message || e) }; }

  plan.migrantsTotal = (stadiumOf(t).migrantsTotal) || 0;
  /* Carried onto the plan so the results screen can say what did and did not
     move, instead of printing a Cinder figure beside another player's name and
     letting the host assume it arrived. */
  plan.posted = posted;
  LAST_RESULT = plan;
  try { if (CTX.recompute) CTX.recompute(); } catch (e) {}
  try { if (CTX.saveSoon) CTX.saveSoon(); } catch (e) {}
  try { if (CTX.updateHUD) CTX.updateHUD(); } catch (e) {}
  try {
    if (CTX.logEvent) CTX.logEvent('city' + (plan.satisfaction.score >= ECON.satisfaction.goodEventAt ? ' good' : ''),
      '🏟 Event settled — ' + fmt(plan.attendance.total) + ' attended, satisfaction ' +
      plan.satisfaction.score + ', morale ' + (plan.deltas.morale >= 0 ? '+' : '') + plan.deltas.morale);
    /* 📉 THE DRAIN, SAID OUT LOUD — and here is WHY it is a log line and not
       just the Vital Signs bars moving.
       ⚠ MEASURED, r9: the bars do NOT move, and it is not a wiring bug. City
         coverage is a FLOW ratio — `relief()` in node-city's computeCoverage
         adds `min(gap, stock / STOCK_RELIEF_MIN)`, so a stockpile can only ever
         FILL the per-minute gap, never exceed it. At a real node-city
         population (8 citizens, water demand 0.60/min) anything above ~6 units
         of stock pins Water at 100%. Driven: an event drained water 300 → 149
         and rations 300 → 59 with Food and Water coverage both unchanged to
         0.1pp; the bars only broke (100% → 95.5%) once the larder hit ZERO.
         The drain is enormous next to the stockpile and invisible next to the
         city's own 8-citizen appetite — that is a scale mismatch between the
         design pack's city and this one, not something this module can fix by
         recomputing harder (CTX.recompute already runs computeCoverage,
         vitalsTick and renderVitals synchronously, one line above).
       So the drain is stated in units, where it is always true and always
       visible. "Do not hide this" (spec §3) is honoured by naming the numbers,
       not by claiming a bar moved when it measurably did not. */
    const dr = plan.drain || {};
    const short = (plan.fulfilment && plan.fulfilment.short) || [];
    const parts = ['rations', 'water', 'goods', 'remedies']
      .filter(r => (Number(dr[r]) || 0) > 0)
      .map(r => DRAIN_ICO[r] + ' −' + fmt(Math.ceil(dr[r])));
    /* ⚠ `parts.length` ALONE was the bug, caught on the r9 drive. Fulfilment is
       the MINIMUM across the four lines, so one empty cistern takes the ratio to
       0 — and at ratio 0 nothing is consumed, `parts` is empty, and the message
       vanished at exactly the moment the player most needed it. A total failure
       to serve is the loudest thing that can happen at an event; it now logs the
       shortfall even though no stock moved.
       r10 narrowed the empty-`parts` case but did NOT remove it: the draw is now
       `min(demand, stock)` per line, so one empty cistern still eats the rations
       that were there and `parts` is usually non-empty. `parts` is empty only
       when ALL FOUR larders are bare — which is precisely the loudest case, so
       the `|| short.length` guard still has to stay. */
    if ((parts.length || short.length) && CTX.logEvent) {
      CTX.logEvent(short.length ? 'city bad' : 'city',
        (parts.length ? '🏟 The crowd ate: ' + parts.join('  ') : '🏟 The crowd was served nothing') +
        (short.length ? '  · RAN OUT OF ' + short.join(', ').toUpperCase() : ''));
    }
  } catch (e) {}
  return { ok: true, applied: res.applied, plan, posted };
}

/* ══ 🌐 THE SERVER HALF — AND EXACTLY HOW FAR IT REACHES TODAY ══════════
   🔴 READ THIS BEFORE BELIEVING ANY PAYOUT ROW ADDRESSED TO ANOTHER PLAYER.
   `sql/015_stadium_events.sql` exists and has NEVER BEEN APPLIED to the
   project. It is reviewed, not executed. Cross-player spillover therefore does
   NOT arrive, and this module says so in the UI rather than showing a number
   next to another player's name and letting the host assume it moved.

   FOUR things must ALL be true before a payout can reach another player, and
   r10 fixed the two that were this module's to fix:
     1. ✅ the event id is a real uuid          — newEventId(), above (was not)
     2. ❌ `sql/015` applied to project ktsiasyjusesawtrwrjc, BY HAND in the SQL
           editor (CLAUDE.md: no CLI login in this repo)
     3. ❌ a planned `stadium_events` row INSERTed before settlement. Nothing
           anywhere writes that table today; the RPC's `if not found then raise`
           would fire on every call
     4. ❌ a CLAIM PATH that reads `stadium_payouts` and credits the payee's
           Cinder. `spo_sel` lets a payee read their rows and nothing ever does
     …and the mount must hand over a real cloud handle (node-city passes
     `cloud: () => null` deliberately — see the comment there).
   Until 2-4 exist, handing this a live Supabase client would only produce a
   failing RPC on every event. `reason` names which wire is missing so the next
   person does not re-derive it from a bare "offline".
   ══════════════════════════════════════════════════════════════════════ */
export async function postToServer(plan) {
  const cloud = CTX && CTX.cloud && CTX.cloud();
  if (!cloud || !cloud.client) {
    return { ok: false, reason: 'server half not wired — sql/015 is not applied and no stadium_events row exists',
             wired: false };
  }
  if (!UUID_RE.test(String(plan && plan.eventId || ''))) {
    /* Fail before the round trip: p_event_id is `uuid` and a non-uuid is
       rejected at the parameter cast with an opaque 22P02. */
    return { ok: false, reason: 'event id is not a uuid', wired: false };
  }
  try {
    const { error } = await cloud.client.rpc('stadium_settle_event', {
      p_event_id: plan.eventId,
      p_attendance: plan.attendance.total,
      p_satisfaction: plan.satisfaction.score,
      p_fulfilment: plan.fulfilment.ratio,
      p_payload: plan.ledger,
    });
    if (error) return { ok: false, reason: error.message, wired: true };
    return { ok: true, rows: plan.ledger.length, wired: true };
  } catch (e) { return { ok: false, reason: String(e && e.message || e), wired: true }; }
}

/* ══ RENDER ════════════════════════════════════════════════════════════ */
const CSS = `
#stadmod{position:fixed;inset:0;z-index:1200;display:flex;align-items:center;justify-content:center;background:rgba(4,5,9,.72);backdrop-filter:blur(3px)}
#stadmod .sbox{width:min(760px,94vw);max-height:88vh;overflow:auto;background:linear-gradient(180deg,#12151f,#0b0d14);border:1px solid #2c3346;border-radius:14px;box-shadow:0 22px 60px rgba(0,0,0,.6);color:#dfe5f2;font:13px/1.45 system-ui,sans-serif}
#stadmod .shead{display:flex;justify-content:space-between;align-items:center;gap:10px;padding:14px 16px;border-bottom:1px solid #232a3a;position:sticky;top:0;background:#12151f;z-index:2}
#stadmod h3{margin:0;font-size:16px;color:#e9c96a;letter-spacing:.3px}
#stadmod .sub{color:#8c96ad;font-size:11.5px;margin-top:2px}
#stadmod .sbody{padding:14px 16px}
#stadmod .sect{margin:0 0 16px}
#stadmod .sect>h4{margin:0 0 8px;font-size:11.5px;letter-spacing:1.1px;text-transform:uppercase;color:#8c96ad}
#stadmod .chk{display:flex;gap:9px;align-items:flex-start;padding:7px 9px;border-radius:8px;border:1px solid #232a3a;margin-bottom:5px;background:#0e1119}
#stadmod .chk.ok{border-color:#25563a}#stadmod .chk.warn{border-color:#6b5620}#stadmod .chk.fail{border-color:#6d2b2b;background:#170f11}
#stadmod .chk .ci{width:20px;text-align:center;flex:0 0 20px}
#stadmod .chk .cl{flex:1;min-width:0}
#stadmod .chk .cn{font-weight:600}
#stadmod .chk .cd{color:#9aa4bb;font-size:12px}
#stadmod .chk .cf{color:#e9c96a;font-size:12px;margin-top:2px}
#stadmod .chk .cs{font-size:10.5px;letter-spacing:1px;font-weight:700;padding:2px 6px;border-radius:5px;align-self:center}
#stadmod .chk.ok .cs{color:#7ddba0;background:#123120}#stadmod .chk.warn .cs{color:#e5c25a;background:#332a12}#stadmod .chk.fail .cs{color:#ff8f8f;background:#3a1618}
#stadmod .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px}
#stadmod .kv{background:#0e1119;border:1px solid #232a3a;border-radius:8px;padding:8px 10px}
#stadmod .kv b{display:block;font-size:17px;color:#e9c96a;font-weight:700}
#stadmod .kv span{color:#8c96ad;font-size:11px;letter-spacing:.4px;text-transform:uppercase}
#stadmod table{width:100%;border-collapse:collapse;font-size:12.5px}
#stadmod th{text-align:left;color:#8c96ad;font-weight:600;font-size:11px;text-transform:uppercase;letter-spacing:.6px;padding:4px 6px;border-bottom:1px solid #232a3a}
#stadmod td{padding:4px 6px;border-bottom:1px solid #191e2b}
#stadmod td.n{text-align:right;font-variant-numeric:tabular-nums}
#stadmod .pos{color:#7ddba0}#stadmod .neg{color:#ff8f8f}
#stadmod .sbtn{background:#1a2030;border:1px solid #38415a;color:#dfe5f2;border-radius:8px;padding:7px 13px;cursor:pointer;font:inherit}
#stadmod .sbtn.go{background:#3b2f10;border-color:#7a6320;color:#e9c96a;font-weight:600}
#stadmod .sbtn:disabled{opacity:.45;cursor:not-allowed}
#stadmod input[type=range]{width:100%}
#stadmod .row{display:flex;gap:10px;align-items:center;margin-bottom:6px}
#stadmod .row label{flex:0 0 96px;color:#9aa4bb}
#stadmod .row .v{flex:0 0 108px;text-align:right;font-variant-numeric:tabular-nums;color:#e9c96a}
#stadmod .warnline{color:#e5c25a;font-size:12px;margin-top:6px}
`;
let cssDone = false;
function ensureCss() {
  if (cssDone) return; cssDone = true;
  try { const s = document.createElement('style'); s.id = 'stadium-css'; s.textContent = CSS; document.head.appendChild(s); } catch (e) {}
}

/** ⭐ The prep checklist. Every failing row carries its fix. */
export function renderEventReadiness(readiness) {
  if (!readiness) return '';
  return '<div class="sect"><h4>Readiness — ' + fmt(readiness.projectedAttendance) + ' projected attendance</h4>' +
    readiness.checks.map(c =>
      '<div class="chk ' + c.status + '"><div class="ci">' + c.ico + '</div><div class="cl">' +
      '<div class="cn">' + esc(c.label) + '</div><div class="cd">' + esc(c.detail) + '</div>' +
      (c.fix ? '<div class="cf">' + esc(c.fix) + '</div>' : '') +
      '</div><div class="cs">' + c.status.toUpperCase() + '</div></div>').join('') +
    '</div>';
}

/** Three sliders + the projected gross they produce. */
export function renderTicketPricing(k) {
  const t = (CTX.game.tiles || {})[k]; const s = stadiumOf(t);
  const plan = planNow(k);
  const rows = Object.keys(ECON.tiers).map(id => {
    const T = ECON.tiers[id];
    const price = s.pricing[id];
    const ratio = price / T.basePrice;
    const dm = E.ticketDemandMultiplier(ratio, plan ? plan.attendance.prestige : ECON.prestige.start);
    return '<div class="row"><label>' + id + '</label>' +
      '<input type="range" data-sprice="' + id + '" min="' + Math.round(T.basePrice * ECON.ticket.minRatio) +
      '" max="' + Math.round(T.basePrice * ECON.ticket.maxRatio) + '" step="1" value="' + price + '">' +
      '<span class="v">' + fmt(price) + '🔥 · ×' + dm.toFixed(2) + '</span></div>';
  }).join('');
  return '<div class="sect"><h4>Ticket pricing — elasticity ×' +
    E.ticketDemandMultiplier(1, plan ? plan.attendance.prestige : ECON.prestige.start).toFixed(2) + ' at list price</h4>' +
    rows +
    '<div class="row"><label>markup</label><input type="range" data-smarkup="1" min="' + ECON.concession.markupMin +
    '" max="' + ECON.concession.markupMax + '" step="5" value="' + s.markupPct + '"><span class="v">' + s.markupPct + '%</span></div>' +
    '<div class="row"><label>vendor fee</label><input type="range" data-sfee="1" min="' + ECON.vendorFee.minPct +
    '" max="' + ECON.vendorFee.maxPct + '" step="1" value="' + s.vendorFeePct + '"><span class="v">' + s.vendorFeePct + '% of gain</span></div>' +
    (plan ? '<div class="grid" style="margin-top:8px">' +
      kv('Tickets', fmt(plan.tickets.netCinder) + '🔥') +
      kv('Concessions', fmt(plan.concessions.netCinder) + '🔥') +
      kv('Vendor fees', fmt(plan.vendorFee.cinder) + '🔥') +
      kv('Projected total', fmt(plan.totals.hostCinder) + '🔥') + '</div>' : '') +
    '</div>';
}
function kv(label, value) { return '<div class="kv"><b>' + value + '</b><span>' + esc(label) + '</span></div>'; }

/** ⭐ The payoff screen. Never a bare score. */
export function renderEventSettlement(plan) {
  if (!plan) return '';
  const s = plan.satisfaction, a = plan.attendance;
  return '<div class="sect"><h4>Attendance</h4><div class="grid">' +
      kv('Local', fmt(a.local)) + kv('Visitors', fmt(a.visitors)) + kv('Regional', fmt(a.regional)) +
      kv('Seated', fmt(a.total) + ' / ' + fmt(a.cap.seats)) +
      kv('Turned away', fmt(a.turnedAway)) +
      kv('Capped by', a.cap.limitedBy + ' (' + fmt(a.cap.effective) + ')') +
    '</div></div>' +
    '<div class="sect"><h4>Satisfaction — ' + s.score + ' / 100</h4><table><tbody>' +
      s.factors.map(f => '<tr><td>' + esc(f.label) + '</td><td>' + esc(f.detail) + '</td>' +
        '<td class="n ' + (f.delta < 0 ? 'neg' : 'pos') + '">' + (f.delta > 0 ? '+' : '') + f.delta +
        (f.weight ? ' / ' + f.weight : '') + '</td></tr>').join('') +
    '</tbody></table></div>' +
    '<div class="sect"><h4>Revenue</h4><table><tbody>' +
      '<tr><td>Tickets (gross)</td><td class="n">' + fmt(E.toCinder(plan.tickets.gross)) + '🔥</td></tr>' +
      (plan.tickets.refund ? '<tr><td>Refunds (' + Math.round(plan.effects.refundPct * 100) + '%)</td><td class="n neg">−' + fmt(plan.tickets.refundCinder) + '🔥</td></tr>' : '') +
      '<tr><td>Satisfaction ×' + plan.effects.revenueMult + '</td><td class="n">' + fmt(plan.tickets.netCinder) + '🔥</td></tr>' +
      '<tr><td>Concessions (' + Math.round(plan.fulfilment.ratio * 100) + '% served)</td><td class="n">' + fmt(plan.concessions.netCinder) + '🔥</td></tr>' +
      '<tr><td>Vendor fees (' + plan.vendorFee.pct + '% of gain)</td><td class="n">' + fmt(plan.vendorFee.cinder) + '🔥</td></tr>' +
      '<tr><td><b>Host total</b></td><td class="n"><b>' + fmt(plan.totals.hostCinder) + '🔥</b></td></tr>' +
    '</tbody></table></div>' +
    renderSpilloverReport(plan) +
    '<div class="sect"><h4>Aftermath</h4><div class="grid">' +
      kv('Morale', (plan.deltas.morale > 0 ? '+' : '') + plan.deltas.morale) +
      kv('Hope', (plan.deltas.hope > 0 ? '+' : '') + plan.deltas.hope) +
      kv('Migration', fmt(plan.migration.housed) + ' housed') +
      kv('Turned away', fmt(plan.migration.turnedAway)) +
      kv('Settled all-time', fmt(plan.migrantsTotal)) +
      kv('Prestige', plan.prestige.before + ' → ' + plan.prestige.after) +
      kv('Incidents', fmt(plan.effects.incidents)) +
    '</div>' +
    (plan.deltas.morale < 0 ? '<div class="warnline">⚠ Morale FELL. A badly supplied event is worse than no event at all.</div>' : '') +
    '</div>';
}

/**
 * ⭐ Who else made money — names every player whose shop profited.
 * 🔴 …AND WHETHER THE MONEY ACTUALLY MOVED. r9 printed "Mira +8🔥" beside
 *    another player's name for a row that was written to the HOST'S OWN tile
 *    save flagged `posted:false`, that Mira could never see or spend, and that
 *    nothing would ever retry. That is a UI claiming a payout that never
 *    arrives, which is the failure this project keeps getting bitten by. The
 *    status column and the footnote below are the honest version: the host's
 *    own shops are PAID (their Cinder moved one step earlier in
 *    settleAndCommit), everybody else's are QUEUED until the server half exists
 *    — see postToServer's header for the four wires that are missing.
 */
export function renderSpilloverReport(plan) {
  if (!plan || !plan.spillover.length) {
    return '<div class="sect"><h4>Spillover</h4><div class="cd" style="color:#8c96ad">No eligible business within radius ' +
      ECON.spillover.radius + '. Restaurants, Clubs, Groceries, Player Shops, Food Trucks and leased plots all catch the overflow.</div></div>';
  }
  const hostId = (CTX && CTX.identity && CTX.identity().userId) || null;
  const isMine = p => (p.ownerId || hostId) === hostId;
  const others = plan.spillover.filter(p => !isMine(p));
  const landed = plan.posted && plan.posted.ok;
  return '<div class="sect"><h4>Spillover — ' + plan.spillover.length + ' business' +
    (plan.spillover.length === 1 ? '' : 'es') + '</h4><table>' +
    '<thead><tr><th>Business</th><th>Owner</th><th>Range</th><th>Multiplier</th><th class="n">Amount</th><th class="n">Fee</th><th>Status</th></tr></thead><tbody>' +
    plan.spillover.map(p => {
      const mine = isMine(p), ok = mine || landed;
      return '<tr><td>' + esc(p.type) + ' @ ' + esc(p.buildingKey) + '</td>' +
        '<td>' + esc(p.ownerName || (mine ? 'you' : 'unclaimed')) + '</td><td>' + p.distance + '</td>' +
        '<td>×' + p.mult.toFixed(2) + '</td>' +
        '<td class="n ' + (ok ? 'pos' : '') + '">' + (ok ? '+' : '') + fmt(p.netCinder) + '🔥</td>' +
        '<td class="n">' + fmt(E.toCinder(p.vendorFee)) + '🔥</td>' +
        '<td>' + (ok ? 'paid' : '<span style="color:#e5c25a">queued</span>') + '</td></tr>';
    }).join('') +
    '</tbody></table>' +
    (others.length && !landed
      ? '<div class="warnline">⚠ ' + fmt(plan.totals.spilloverToOthers) + '🔥 to ' + others.length +
        ' business' + (others.length === 1 ? '' : 'es') + ' owned by other players has <b>NOT</b> been paid. ' +
        'Crediting another player\'s wallet needs the server (sql/015_stadium_events.sql), which is not live yet' +
        (plan.posted && plan.posted.reason ? ' — ' + esc(plan.posted.reason) : '') +
        '. The rows are in this stadium\'s ledger marked unposted so nothing is lost when it is.</div>'
      : '') +
    '</div>';
}

function render(k) {
  const t = (CTX.game.tiles || {})[k]; if (!t) return close();
  const s = stadiumOf(t);
  const r = readinessNow(k);
  let box = document.getElementById('stadmod');
  if (!box) {
    box = document.createElement('div'); box.id = 'stadmod';
    box.addEventListener('click', onClick);
    box.addEventListener('input', onInput);
    document.body.appendChild(box);
  }
  const showing = LAST_RESULT && LAST_RESULT.stadiumKey === k;
  box.innerHTML = '<div class="sbox"><div class="shead"><div>' +
    '<h3>🏟 Stadium — Level ' + (t.lvl || 1) + ' · ' + fmt(E.stadiumSeats({ lvl: t.lvl || 1 })) + ' seats</h3>' +
    '<div class="sub">Prestige ' + E.stadiumPrestige(stadiumInput(k), null, Date.now()).toFixed(2) +
      ' · ' + s.eventsCompleted + ' events · avg satisfaction ' + s.avgSatisfaction +
      ' · ' + fmt(s.migrantsTotal) + ' residents settled all-time</div></div>' +
    '<div><button class="sbtn" id="stad-head">' + (t.card ? '🃏 Remove headliner' : '🃏 Slot headliner') + '</button> ' +
    '<button class="sbtn go" id="stad-run">▶ Run event</button> ' +
    '<button class="sbtn" id="stad-close">Close</button></div></div><div class="sbody">' +
    renderEventReadiness(r) + renderTicketPricing(k) +
    (showing ? renderEventSettlement(LAST_RESULT) : '') +
    '</div></div>';
}

function onInput(ev) {
  const el = ev.target; const k = OPEN_KEY; if (!k) return;
  const t = (CTX.game.tiles || {})[k]; if (!t) return;
  const s = stadiumOf(t);
  if (el.dataset.sprice) { s.pricing[el.dataset.sprice] = Number(el.value); s.pricing = E.clampTicketPricing(s.pricing); }
  else if (el.dataset.smarkup) s.markupPct = Number(el.value);
  else if (el.dataset.sfee) s.vendorFeePct = Number(el.value);
  else return;
  try { if (CTX.saveSoon) CTX.saveSoon(); } catch (e) {}
  render(k);
}

async function onClick(ev) {
  if (ev.target.id === 'stadmod') return close();
  if (ev.target.id === 'stad-close') return close();
  if (ev.target.id === 'stad-head') {
    /* 🃏 The headliner is the Match Quality factor, and it is real card data —
       `power` off the player's own collection, not a number this module made
       up. No card slotted scores the deliberately mediocre baseline. */
    const k = OPEN_KEY; const t = (CTX.game.tiles || {})[k]; if (!t) return;
    if (t.card) {
      try { CTX.assignCard && CTX.assignCard(t.card, false); } catch (e) {}
      t.card = null; try { CTX.saveSoon && CTX.saveSoon(); } catch (e) {}
      return render(k);
    }
    if (!CTX.openCardPicker) return;
    CTX.openCardPicker('Headline the event', c => c.type !== 'Structure', (c) => {
      t.card = c.id;
      try { CTX.assignCard && CTX.assignCard(c.id, true); } catch (e) {}
      try { CTX.saveSoon && CTX.saveSoon(); } catch (e) {}
      render(k);
    });
    return;
  }
  if (ev.target.id === 'stad-run') {
    const k = OPEN_KEY; if (!k) return;
    const r = readinessNow(k);
    const failing = r.checks.filter(c => c.status === 'fail');
    if (failing.length && CTX.confirm) {
      const ok = await CTX.confirm('⚠ ' + failing.length + ' check' + (failing.length === 1 ? '' : 's') +
        ' failing (' + failing.map(c => c.label).join(', ') + '). A badly supplied event LOWERS morale. Run it anyway?');
      if (!ok) return;
    }
    const res = await settleAndCommit(k);
    if (!res.ok) { try { CTX.toast('🏟 ' + res.error, 'bad'); } catch (e) {} render(k); return; }
    LAST_RESULT.stadiumKey = k;
    try {
      CTX.toast('🏟 Event settled — satisfaction ' + res.plan.satisfaction.score + ', ' +
        (res.plan.deltas.morale >= 0 ? '+' : '') + res.plan.deltas.morale + ' morale.',
        res.plan.satisfaction.score >= ECON.satisfaction.goodEventAt ? 'good' : 'bad');
    } catch (e) {}
    render(k);
  }
}

export function close() { const b = document.getElementById('stadmod'); if (b) b.remove(); OPEN_KEY = null; }
export function open(k) {
  if (!CTX) return;
  const t = CTX.game.tiles[k]; if (!t || t.type !== STADIUM_TYPE) return;
  ensureCss(); OPEN_KEY = k; render(k);
}
export function refresh() { if (OPEN_KEY) render(OPEN_KEY); }

/** One line for the tile hover tip. */
export function tipLine(t) {
  if (!t || t.type !== STADIUM_TYPE) return '';
  const s = stadiumOf(t);
  return '<br>🏟 ' + fmt(E.stadiumSeats({ lvl: t.lvl || 1 })) + ' seats · prestige ' +
    E.stadiumPrestige({ lvl: t.lvl || 1, eventsCompleted: s.eventsCompleted, avgSatisfaction: s.avgSatisfaction,
                        lastEventAt: s.lastEventAt }, null, Date.now()).toFixed(2) +
    ' · ' + s.eventsCompleted + ' events run';
}

/* ── mount ─────────────────────────────────────────────────────────────── */
export function mount(ctx) {
  CTX = ctx || {};
  ensureCss();
  /* 🔁 REHYDRATE SWEEP. loadState() runs BEFORE this mount (it has to — the
     sweep needs the tiles), so a stadium coming off disk carries raw JSON in
     `t.stad` that has never been through loadTile: no defaults filled, pricing
     unclamped, `ledger` possibly not an array. Normalising it here is what
     stops a save written by an older build from reaching the economy module as
     whatever shape it happened to be. */
  try {
    for (const s of stadiumTiles()) {
      const raw = s.tile.stad;
      if (raw && typeof raw === 'object') { s.tile.stad = null; loadTile(s.tile, raw); }
      else stadiumOf(s.tile);
    }
  } catch (e) { try { console.warn('[Stadium] rehydrate', e); } catch (e2) {} }
  const api = {
    econ: E, ECON, STADIUM_TYPE,
    open, close, refresh, tipLine, saveTile, loadTile, stadiumOf, stadiumTiles,
    nodeSnapshot, worldSnapshot, eventInput, stadiumInput,
    readinessNow, planNow, settleAndCommit, makeSink,
    renderEventReadiness, renderTicketPricing, renderEventSettlement, renderSpilloverReport,
    lastResult: () => LAST_RESULT,
    /* 🔬 TEST SEAMS. `_forceFail(name)` makes the named sink method throw so a
       driver can prove settlement is atomic; `_ctx()` exposes the hand-over. */
    _forceFail: (name) => { FORCE_FAIL = name || null; },
    _ctx: () => CTX,
  };
  try { window.MythicStadium = api; } catch (e) {}
  return api;
}

export default { mount, STADIUM_TYPE };
