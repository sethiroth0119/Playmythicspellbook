/* ════════════════════════════════════════════════════════════════════════════
   SUPPLY CHAIN · partners.js — "what are the best businesses to work with?"

   bestPartners(nodeId, data) answers that for all 27 tiles, the 4 systems and the
   2 channels, as a ranked list whose every line NAMES THE CARGO ("Fashion Brand
   ships you cloth and fabric — bandages, gowns and bedding are cloth").

   WHY THE RANKING IS TIERS FIRST AND WEIGHTS SECOND
   The owner drew a map. A player opening Medical Corporation expects to be told
   what the page shows: Fashion Brand, Research Facility, the truck. A pure
   weighted sum cannot promise that — coverage.js gives every tile dozens of
   proposed needs, so a non-neighbour sharing eight proposed resources out-scores
   a drawn neighbour sharing one, and the advice stops matching the map. So the
   sort key is (tier, raw weight) and the tiers are about WHERE THE FACT IS DRAWN:
     0  a needs-icon: on this tile, or on the other tile when the reading is not
        in doubt (Research shows Medical back; Car Factory shows Car Dealer and
        p3's prose confirms the direction)
     1  one of the four legend icons on THIS tile (truck, Marketplace, tow truck,
        battler card), or — seen from Transport / a channel / a system — the tile
        that carries that icon
     2  a needs-icon drawn on the OTHER tile whose direction the map leaves open
        (Transport and Salvage both show a Car Dealer; ambiguity C). Still the
        owner's ink, so still above everything undrawn — but a reader looking at
        the Car Dealer tile does not see it.
     3  nothing drawn: shared cargo from recipes/coverage, the written-goal truck
        the PDF omits, services (Bank, Warehouse), system-level buyers.
   Inside a tier the SC.partners weights decide. `score` is then made monotone
   down the list (each row at least a hair above the one under it) so a consumer
   that sorts or thresholds on `score` alone gets the same order; the untouched
   weight sum is kept as `rawScore`. Rejected: adding a big per-tier constant —
   it would be a magic number living outside tuning.js.

   WHY "HIGH STARTUP" AND "BULKY" HAVE NO THRESHOLD
   The contract forbids an economy literal outside the game's own table and a
   knob outside tuning.js, and tuning.js has neither. Both are therefore judged
   RELATIVE to the rest of the map, from data the caller passes in:
     Bank      — the tile's live `startup` (opEcon) is above the MEDIAN of every
                 tile that has one. No opEcon passed in, no Bank advice: a guess
                 about money is worse than silence.
     Warehouse — the tile makes cargo that shipping.js classes as something other
                 than general freight (tanker, hopper, stock wagon), or it makes
                 more distinct products than the median producer.
   A retune of OPS_ECON moves both with it and nothing here goes stale.

   LIVE vs PROPOSED (contract rule 3) rides on every row: `live` is true only
   when the relationship exists in the shipped game for BOTH ends. Transport is
   `live` (you can hire a carrier today) but `enforcedToday` only where
   shipping.js LIVE_LANES says the server refuses a sale without one.

   WHO READS WHICH FIELD (round 2 — the round-1 critic's biggest gap)
   Round one wrote every reason as one 250-500 character blob: player sentence,
   then a LIVE/PLANNED paragraph, then the audit trail (page numbers, decision
   ids, source-table names). 47% of them leaked that trail into what the modal
   prints under "Best partners", and a view had no way to cut it off. A player
   has never seen the design PDF and does not know what an ops table is. So:
     reasons[]   PLAYER copy only. One short sentence per relationship, cargo
                 first, then why ("Fashion Brand ships you cloth and fabric —
                 bandages, gowns and bedding are cloth."). Capped in length and
                 checked by auditReasons() against REASON_LEAK.
     lines[]     the same sentences with their role, so a partner that is two
                 things (Transport is Car Dealer's carrier AND buys its trucks)
                 reads as two lines instead of one merged paragraph.
     statusNote  PLAYER copy, and it always names its subject: "Works today for
                 metal" / "Planned — Fashion Brand is not in the game yet" /
                 "Works today for metal — bought on the Marketplace; direct
                 delivery is planned". Never a bare "Planned" (round 3: see
                 NOTE), never "Works today" on a row whose `live` is false, and
                 (round 4: see ONE RULE) a green chip vouches only for cargo that
                 is both yielded and spent in the shipped game — it is scoped
                 ("Works today for fuel and ethanol") whenever its sentence also
                 names cargo that is not. lines[].worksCargo carries those ids.
     caveat      PLAYER copy, only when the map leaves the reading open — and it
                 says WHAT is open ("Transport may buy its trucks here, or only
                 haul for you").
     devNote     everything for the auditor: which page, which ambiguity, which
                 owner decision, which source table. Never shown to a player.
     cite        where the fact comes from (unchanged).
   Rejected: keeping the blob and letting views split on the first full stop —
   the first sentence still named source tables for every undrawn row, and a
   string convention between files breaks silently.

   WHY A LIVE LANE CAN NO LONGER OUTRANK THE OWNER'S OWN EXAMPLE
   The owner's goal names exactly one lane in words (fashion, cloth, Transport,
   medical) and p3 names one more (car factory to car dealer). Round one let
   liveBonus push Research above Fashion on Medical because the shards lane is
   live and the Fashion Brand is not. Inside the needs-icon tier a lane listed in
   OWNER_NAMED_LANES now sorts first. It is a sort key, not a weight, so no new
   number exists; SC.partners.ownerNamedLanes overrides the table if the seam
   piece adopts it.

   WHY THE TRUCK IS JUDGED LEG BY LEG (round 5 — the critic's biggest gap)
   Round 4's one rule stopped at goods trades; a hauling line took its green
   cargo from "somebody yields this", so a card could call a lane Planned in
   rows 1-2 and hauling the same cargo from the same supplier green in row 3,
   and Transport's card disagreed with the tile's on 15 of 21 pairs. haulLegs()
   now builds ONE set of legs per tile from the drawn suppliers, judges each by
   tradeState() (in) or "yielded today and taken today" (out), and BOTH cards
   read it; auditReasons() asserts same-card agreement and card-to-card
   equality. A Planned line no longer leads a row over a line that works, except
   that a drawn lane keeps the lead over an undrawn side trade (the owner's ink
   is not demoted) and a pinned lane always leads.

   Pure: no window, no DOM. Wave-1 data files are imported only as DEFAULTS so
   `bestPartners('medical')` works from a Node one-liner; whatever the caller
   puts in `data` wins (the running game's catalogue, the live opEcon). graph.js
   is a same-wave sibling and is never imported — `data.graph` is not needed.
   ════════════════════════════════════════════════════════════════════════════ */

import { SC as SC_DEFAULT } from './tuning.js';
import * as BIZ_DEFAULT from './businesses.js';
import * as REC_DEFAULT from './recipes.js';
import * as COV_DEFAULT from './coverage.js';
import * as SHIP_DEFAULT from './shipping.js';
import * as CAT_DEFAULT from './catalog.js';

export const ROLES = Object.freeze(['supplier', 'customer', 'carrier', 'channel', 'financier', 'storage']);
export const TIER = Object.freeze({ needsIcon: 0, legendIcon: 1, farSideOpen: 2, undrawn: 3 });
/* Player words: a view may print these as a chip. The audit wording lives in
   TIER_DEV and reaches a row only through devNote. */
export const TIER_LABEL = Object.freeze([
  'Direct link on the map',
  'Marked on the map',
  'Linked from their side',
  'Shares cargo with you',
]);
const TIER_DEV = Object.freeze([
  'tier 0: needs-icon on the PDF',
  'tier 1: legend icon or caption on the PDF',
  'tier 2: needs-icon on the OTHER tile, direction left open by the PDF',
  'tier 3: not drawn, derived from shared cargo or a service rule',
]);

/* The lanes the owner put into WORDS: the goal's fashion-cloth-medical sentence
   and p3's "a car dealership purchases vehicles from a car factory". Ids, not
   numbers — tuning may override the list, never needs to. */
export const OWNER_NAMED_LANES = Object.freeze([
  Object.freeze({ from: 'fashion', to: 'medical' }),
  Object.freeze({ from: 'carfactory', to: 'cars' }),
]);

/* Feature knobs that tuning.js does not carry yet. partners owns only this file,
   so each is read from SC.partners first and falls back here; decisions/partners.md
   asks the seam piece to adopt them. None is an economy number. */
const FALLBACK = Object.freeze({ reasonMaxChars: 140, foldReasonMaxChars: 180, maxUndrawnPerCargo: 2, worstFitShown: 3, worstFitMinHops: 3, digestRows: 2 });

/* What must never reach a player. The first alternation block is the critic's
   list verbatim; the second is the same idea widened (constant names, file
   names, table names) so a sibling's new cite cannot slip through either. */
export const REASON_LEAK = /OPS_ECON|decision D\d|ambiguity [A-Z]|\bp[1-9]\b|public\/|cost row|\bres\)|RECIPE|the owner|\bPDF\b|\.m?js\b|[A-Z]{3,}_[A-Z]|[a-z]_[a-z]|\bLIVE\b|\bPLANNED\b|\bPHASE\b/;

const TRANSPORT = 'transport', BANK = 'bank', WAREHOUSE = 'warehouse';
const MARKET = 'ch:market', CARMARKET = 'ch:carmarket';
const BATTLE = 'sys:battle', BUSINESS = 'sys:business', CITY = 'sys:city', CAMP = 'sys:camp';

/* ── context ───────────────────────────────────────────────────────────────── */
/* One resolved view of `data` per call family. Cached on the data object so the
   modal asking for 33 lists does not rebuild the need index 33 times; a caller
   that mutates `data` between calls passes a fresh object (they are cheap). */
const CTX_CACHE = new WeakMap();
const NO_DATA = Object.freeze({});

function arr(x) { return Array.isArray(x) ? x : []; }
function pick(ns, key, fallbackNs) { return ns && ns[key] !== undefined ? ns[key] : fallbackNs[key]; }

function context(data) {
  const d = data && typeof data === 'object' ? data : NO_DATA;
  const hit = CTX_CACHE.get(d);
  if (hit) return hit;

  const SC = d.SC || SC_DEFAULT;
  const bz = Array.isArray(d.businesses) ? { BUSINESSES: d.businesses } : (d.businesses || {});
  const rc = d.recipes && d.recipes.RECIPES ? d.recipes : (d.recipes && !d.recipes.RECIPES && Object.keys(d.recipes).length ? { RECIPES: d.recipes } : {});
  const cv = d.coverage || {};
  const sh = d.shipping || {};
  const ct = d.catalog || CAT_DEFAULT;

  const tiles = arr(pick(bz, 'BUSINESSES', BIZ_DEFAULT));
  const systems = arr(pick(bz, 'SYSTEMS', BIZ_DEFAULT));
  const channels = arr(pick(bz, 'CHANNELS', BIZ_DEFAULT));
  const flows = arr(pick(bz, 'SYSTEM_FLOW', BIZ_DEFAULT));
  const p9 = pick(bz, 'P9_RULE', BIZ_DEFAULT) || null;
  const legend = arr(pick(bz, 'LEGEND', BIZ_DEFAULT));
  const RECIPES = pick(rc, 'RECIPES', REC_DEFAULT) || {};
  const needsOfFn = typeof cv.needsOf === 'function' ? cv.needsOf : COV_DEFAULT.needsOf;
  const lootNeedsOfFn = typeof cv.lootNeedsOf === 'function' ? cv.lootNeedsOf : COV_DEFAULT.lootNeedsOf;
  const ship = {
    pdfTruckDrawn: typeof sh.pdfTruckDrawn === 'function' ? sh.pdfTruckDrawn : SHIP_DEFAULT.pdfTruckDrawn,
    cargoClassDetail: typeof sh.cargoClassDetail === 'function' ? sh.cargoClassDetail : SHIP_DEFAULT.cargoClassDetail,
    LIVE_LANES: arr(sh.LIVE_LANES || SHIP_DEFAULT.LIVE_LANES),
    RULE: sh.RULE || SHIP_DEFAULT.RULE,
    NOT_DRAWN_LABEL: sh.NOT_DRAWN_LABEL || SHIP_DEFAULT.NOT_DRAWN_LABEL,
    SERVICES: sh.SERVICES || SHIP_DEFAULT.SERVICES,
  };

  const byId = new Map();
  for (const t of tiles) byId.set(t.id, { ...t, nodeKind: 'tile' });
  for (const s of systems) byId.set(s.id, { ...s, nodeKind: 'system' });
  for (const c of channels) byId.set(c.id, { ...c, nodeKind: 'channel' });

  /* Catalogue row lookup that accepts the module namespace, a makeCatalog()
     object, a bare row array or an id-keyed map — views assemble `data`
     differently and a name lookup must never be the thing that throws. */
  const catRow = (id) => {
    try {
      if (typeof ct.byId === 'function') return ct.byId(id) || null;
      const rows = Array.isArray(ct) ? ct : (Array.isArray(ct.CATALOG) ? ct.CATALOG : null);
      if (rows) return rows.find((r) => r && r.id === id) || null;
      return ct[id] || null;
    } catch (_) { return null; }
  };
  /* Catalogue names are Title Case ("Memory Shards"); inside a sentence that
     reads as shouting. Lower-case them unless the name is an acronym (DNA). */
  const resName = (id) => {
    const row = catRow(id);
    const n = row && row.name ? String(row.name) : String(id);
    return n === n.toUpperCase() ? n : n.toLowerCase();
  };
  const label = (id) => {
    if (typeof d.labelOf === 'function') { try { const l = d.labelOf(id); if (l) return String(l); } catch (_) { /* fall through */ } }
    const n = byId.get(id);
    return n ? n.label : String(id);
  };

  /* opEcon may arrive as the bridge function, a plain {id:row} map, or the
     generated fixture ({opsEcon:{...}}). Absent = no money advice at all. */
  const oe = d.opEcon;
  const econ = (id) => {
    try {
      if (typeof oe === 'function') return oe(id) || null;
      if (oe && oe.opsEcon) return oe.opsEcon[id] || null;
      if (oe && typeof oe === 'object') return oe[id] || null;
    } catch (_) { /* total */ }
    return null;
  };
  /* "Battle loot" here means the HAND-AUTHORED drops (catalogue handLoot), which
     is what coverage.lootNeedsOf picks when handed catalogue rows. loot.js
     lootableWith() was tried first and rejected: the uniform salvage roll can
     hand out 409 of the 420 ids, so it called cardboard and reinforced concrete
     "won in a fight" and every tile came out 100% lootable — true, and useless
     as advice about who to work with. */
  const lootable = (() => {
    try { if (typeof ct.all === 'function') return ct.all(); } catch (_) { /* fall through */ }
    try { if (Array.isArray(ct)) return ct; if (Array.isArray(ct.CATALOG)) return ct.CATALOG; } catch (_) { /* fall through */ }
    return undefined;   // coverage.js falls back to its own hand-loot list
  })();

  const family = (id) => { try { return typeof ct.family === 'function' ? ct.family(id) : CAT_DEFAULT.family(id); } catch (_) { return null; } };
  const recipe = (id) => RECIPES[id] || { makes: [], buys: [], upkeep: [], sellsTo: [], service: null };
  const makes = (id) => arr(recipe(id).makes);
  /* A cityFirm product never leaves the simulated city (CLAUDE.md: never
     addRes a chain resource), so it is never something a partner can buy. */
  const tradeMakes = (id) => makes(id).filter((m) => m.via !== 'cityFirm');
  const needs = (id) => { try { return arr(needsOfFn(id)); } catch (_) { return []; } };
  const lootNeeds = (id) => { try { return arr(lootNeedsOfFn(id, lootable)); } catch (_) { return []; } };

  /* resId -> tiles that need it (first row per tile; needsOf sorts live first). */
  const neededBy = new Map();
  for (const n of byId.values()) {
    const seen = new Set();
    for (const row of needs(n.id)) {
      if (seen.has(row.id)) continue;
      seen.add(row.id);
      if (!neededBy.has(row.id)) neededBy.set(row.id, []);
      neededBy.get(row.id).push({ by: n.id, row });
    }
  }

  const ctx = {
    SC, P: SC.partners, tiles, systems, channels, flows, p9, legend, byId, RECIPES, ship,
    resName, label, econ, family, recipe, makes, tradeMakes, needs, lootNeeds, neededBy,
    isLive: (id) => { const n = byId.get(id); return !!n && (n.nodeKind !== 'tile' || n.status === 'live'); },
    /* "somebody yields this in the shipped game" as a good a player can hold.
       City-only yields do not count: they never leave the simulated city, so no
       truck hauls them and no shelf stores them. */
    madeAnywhere: (id) => {
      if (!ctx._madeAny) {
        ctx._madeAny = new Set();
        for (const t of tiles) if (t.status === 'live') for (const m of tradeMakes(t.id)) if (m.live) ctx._madeAny.add(m.id);
      }
      return ctx._madeAny.has(id);
    },
    maxNames: SC.hover.maxMakes,
    maxChars: (SC.partners && SC.partners.reasonMaxChars) || FALLBACK.reasonMaxChars,
    /* The folded tow-truck aside is ONE sentence standing in for four rows a
       view cannot open, so it has to name the tiles AND say what the mark
       means AND why — at the ordinary reason length one of the three always
       fell off (round 13). It is still bounded, and auditReasons() still
       enforces the bound; it is simply a longer one for the single line on a
       card that is about the LIST rather than about one partner. */
    foldMaxChars: (SC.partners && SC.partners.foldReasonMaxChars) || FALLBACK.foldReasonMaxChars,
    perCargo: (SC.partners && SC.partners.maxUndrawnPerCargo) || FALLBACK.maxUndrawnPerCargo,
    namedLanes: arr((SC.partners && SC.partners.ownerNamedLanes) || OWNER_NAMED_LANES),
  };
  CTX_CACHE.set(d, ctx);
  return ctx;
}

/* ── words ─────────────────────────────────────────────────────────────────── */
function uniq(list) { return Array.from(new Set(list)); }

/* "cloth and fabric", "a, b, c and 3 more". The cap is the hover card's own
   glance size (SC.hover.maxMakes) so a reason never outgrows the card; `max`
   lets fit() name fewer when a sentence runs long. */
function shownIds(ctx, ids, max) {
  const u = uniq(ids);
  let k = Math.max(1, Math.min(max || ctx.maxNames, ctx.maxNames));
  /* "a, b and 1 more" spends three words hiding one name; give up a name instead
     so the remainder reads as a real remainder ("a and 2 more") */
  if (u.length - k === 1 && k > 1) k -= 1;
  return u.slice(0, k);
}
function nameList(ctx, ids, max) {
  const u = uniq(ids);
  const shown = shownIds(ctx, u, max).map(ctx.resName);
  const rest = u.length - shown.length;
  if (rest > 0) return shown.join(', ') + ' and ' + rest + ' more';
  if (shown.length <= 1) return shown.join('');
  return shown.slice(0, -1).join(', ') + ' and ' + shown[shown.length - 1];
}
function median(nums) {
  const s = nums.filter((n) => typeof n === 'number' && isFinite(n)).sort((a, b) => a - b);
  if (!s.length) return null;
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}
function ordinal(n) {
  const v = n % 100;
  if (v >= 11 && v <= 13) return n + 'th';
  return n + (['th', 'st', 'nd', 'rd'][n % 10] || 'th');
}
const cap = (t) => (t ? t.charAt(0).toUpperCase() + t.slice(1) : t);
const liveFirst = (rows) => rows.slice().sort((a, b) => (a.live === b.live ? 0 : a.live ? -1 : 1));

/* A sibling's `why` is written for whoever reads that file. Before any of it
   reaches a player: split into sentences, throw away every sentence that leaks
   (a source table, a page number, the word "owner"), keep the first survivor.
   Dropping a sentence is always safe — the lead clause already names the cargo. */
/* No lookbehind: an older Safari fails to PARSE one, and a module that fails to
   parse is reported as "not mounted", indistinguishable from absent. */
function sentences(text) {
  return String(text || '').replace(/^Live today:\s*/i, '').replace(/^The owner'?s own example:\s*/i, '')
    .replace(/([.!?])\s+(?=[A-Z"“])/g, '$1').split('').map((x) => x.trim()).filter(Boolean);
}
function playerClause(text) {
  /* A sibling writes its source into the prose as a trailing parenthetical
     ("… its tellers underwrite loans (player_banks)"). That parenthesis is a
     cite, not player copy, and REASON_LEAK rightly refuses the whole sentence
     over it — which cost the Bank the one sentence on its card that says what
     it does. Drop a LEAKY parenthesis and keep the sentence; an ordinary one
     ("(p9)" is leaky, "(and its camps)" is not) is untouched. */
  const decited = sentences(text).map((x) => x.replace(/\s*\([^)]*\)/g, (m) => (REASON_LEAK.test(m) ? '' : m)).trim());
  const ok = decited.filter((x) => x && !REASON_LEAK.test(x));
  if (!ok.length) return '';
  let t = ok[0].replace(/[.!?]+$/, '');
  /* Mid-sentence after a dash: lower the capital unless the word is an acronym
     ("AI chips", "DNA") — the second character tells them apart. */
  if (/^[A-Z]([a-z]|\s)/.test(t)) t = t.charAt(0).toLowerCase() + t.slice(1);
  return t;
}
/* A service blurb or a map caption starts with its verb ("Trains units", "Funds
   businesses and players"). After a dash that needs a subject. */
function serviceClause(text) {
  const c = playerClause(text);
  return /^[a-z]+s /.test(c) ? 'it ' + c : c;
}
/* The half of a service blurb AFTER its colon — what the business actually does
   ("unlocks bus stops and routes …") rather than the category it belongs to
   ("works only for the city"). fit() takes it as a second why, so a row whose
   full blurb is too long keeps the useful half instead of the label: round 6
   left Bus Company and Airport on the Business System card saying only "it works
   only for the city", which names neither cargo nor service. */
function detailClause(text) {
  const c = playerClause(text);
  const m = /^(.*?): (.+)$/.exec(c);
  if (!m || m[2].length < 12) return '';
  return /^[a-z]+s /.test(m[2]) ? 'it ' + m[2] : m[2];
}
/* Shorter versions of a clause, longest first: whole, then up to its first
   strong break, then — last resort — up to its first comma, but only when what
   is left is a clause and not a list item ("produce, potatoes for the fries"
   must never become "produce"). Four words is the shortest thing that reads as
   a statement; it is a grammar guard, not a tuning knob. */
function clauseCuts(t) {
  const out = [t];
  const m = /^(.*?)(?: — |; |: )/.exec(t);
  if (m && m[1].length > 12) out.push(m[1]);
  const c = /^(.*?), /.exec(t);
  if (c && c[1].split(' ').length >= 4) out.push(c[1]);
  return out;
}
/* One player sentence under the length cap. `lead(n)` builds the cargo clause
   naming at most n resources; `why` is the optional second half. Tries the
   richest version first and gives up detail in the order a player would miss it
   least: the tail of the why, then the why, then the fourth, third, second name.
   The hard cut at the end is a guard, not a path — auditReasons() counts '…'. */
/* fit() takes the FIRST tail that fits, which favours the shortest clause — and
   the shortest clause is often the one with no actor in it. The Warehouse's row
   on the Battle System card came out "…buy your drops: gravity stones, ice
   crystals and 7 more — supply crates are received", the thinnest why on any
   card: it says nothing a battler can picture. A clause that opens in the
   passive, or names nobody, is therefore tried last; it is still tried, because
   a weak why beats no why. Deliberately not a rewrite of the sibling's sentence:
   coverage.js owns the wording, this only chooses between the ones it wrote. */
const PASSIVE_LEAD = /\b(?:is|are|was|were|be|been|being)\s+\w+(?:ed|en)\b/i;
function activeFirst(clauses) {
  const c = arr(clauses).filter(Boolean);
  return [...c.filter((s) => !PASSIVE_LEAD.test(s)), ...c.filter((s) => PASSIVE_LEAD.test(s))];
}

/* ── one why-clause, once per card (round 9) ────────────────────────────────
   The round-8 critic counted 42 lines on which a card repeats a why-clause it
   has already written: the City Builder's card said "city buildings like Fuel
   Refinery and Munitions Bench run on metal" FOUR times (once for each tile
   that sells metal), the Marketplace said "open to every player who needs it"
   five times. Every one of those lines still names its own cargo, so none of
   them is filler — but a player reading four identical sentences in a row
   learns nothing from the last three and stops reading the card.

   The clause cannot be deduplicated where it is written, because a row that is
   built is not always a row that survives (undrawn rows are capped per cargo,
   and rank() drops nothing but shortlist() does): a clause "spent" by a row
   that is then dropped would leave the row a player DOES see with no why at
   all. So fit() only records what ELSE it could have said, in `_fit`, and the
   de-duplication runs in rank() over the rows in the order they are read.
   dedupeWhy() then re-fits a repeat from the same lead with a fresh tail, and
   falls back to the lead alone — which always names the cargo — when the row
   has nothing else to say. No sentence is invented here; coverage.js and the
   lane still own every word. */
let LAST_FIT = null;
function fit(ctx, lead, why) {
  /* `why` may be a list, best first: the lane's own sentence, then what the
     cargo is for on the consuming tile. Round two dropped the why as soon as
     the four-name head was too long for it, which left 21 lines saying only
     "ships you research data and memory shards." A fourth name is worth less
     to a player than the reason, so names give way first (pass one) and the
     why is only given up when even one name cannot carry it (pass two). */
  const tails = [];
  for (const w of (Array.isArray(why) ? why : [why])) if (w) for (const c of clauseCuts(w)) if (!tails.includes(c)) tails.push(c);
  const out = fitWith(ctx, lead, tails);
  LAST_FIT = { result: out, lead, tails };
  return out;
}
/* The body of fit(), with the tail list already built, so a re-fit can run it
   again over a SUBSET of the tails without rebuilding the clause cuts. */
function fitWith(ctx, lead, tails) {
  for (let n = ctx.maxNames; n >= 1; n--) {
    /* "Agricultural Op." ends in its own full stop */
    const head = lead(n).replace(/[.]$/, '');
    for (const t of tails) {
      const s = head + ' — ' + t.replace(/[.]$/, '') + '.';
      if (s.length <= ctx.maxChars && !REASON_LEAK.test(s)) return s;
    }
  }
  for (let n = ctx.maxNames; n >= 1; n--) {
    const s = lead(n).replace(/[.]$/, '') + '.';
    if (s.length <= ctx.maxChars) return s;
  }
  const s = lead(1);
  return s.slice(0, ctx.maxChars - 1).replace(/\s+\S*$/, '') + '…';
}

/* How a business uses a resource, in a player's words. coverage.js writes a
   PROPOSED need as a plain sentence about the resource (kept), but a LIVE need
   as the place it was read from ("Live today: Mythic Kitchen cost.", "city
   building input: Sawmill, Glassworks").
   Round two turned those into a sentence from the need's ROLE alone ("you use
   DNA in your recipes", "it spends cloth on building and upgrades"); the critic
   counted 58 of them and called them templated, rightly — they say nothing a
   player could not guess. The live why does carry one real fact: WHERE in the
   game the resource is spent (the Mythic Kitchen, the Hospital, the Foundry,
   named city buildings). liveUse() lifts that venue out, so the line reads
   "DNA goes into recipes at the Mythic Kitchen". When no venue can be read the
   answer is '' and the caller DROPS the undrawn row: a partner we cannot give a
   reason for is not advice. Reading a sibling's prose is a seam that can rot —
   decisions/partners.md asks coverage.js for a `venue` field; until then every
   pattern below fails closed (to ''), never to a wrong sentence. */
/* "supplies go", "DNA goes": catalogue names are mass nouns unless they end in
   a plural s ("glass" and "DNA" do not). */
const VENUE_COPY = Object.freeze({
  craft: [
    /* round 6: "cooks with DNA" read like filler; calling it a recipe ingredient
       tells the player where the odd ones (DNA, cloth, fuel) actually go */
    [/^Mythic Kitchen/i, (r) => r + ' is a recipe ingredient at the Mythic Kitchen'],
    [/^(The )?Hospital.*BANDAGE/, (r) => 'the Hospital sews bandages from ' + r],
    [/^(The )?Hospital/i, (r) => 'the Hospital pharmacy turns ' + r + ' into medicine'],
    [/^Foundry/i, (r) => 'Foundry machines take ' + r + ' as feedstock'],
    [/^Weapon Smith/i, (r) => 'weapons are forged from ' + r + ' at the Weapon Smith bench'],
    [/^Homestead Farm/i, (r) => 'the Homestead Farm uses up ' + r + ' raising animals and crops'],
  ],
  build: [
    [/^Foundry/i, (r) => 'new Foundry machines are built from ' + r],
    [/^Homestead Farm/i, (r) => 'Homestead Farm buildings are built from ' + r],
    [/^(The )?Cracking Yard/i, (r) => 'new Cracking Yard units are built from ' + r],
  ],
});
/* The named place a live need is spent at ("the Hospital", "the Weapon Smith
   bench"), lifted from coverage.js prose; null when the why names none. */
function venueOf(row) {
  const t = String(row.why || '').replace(/^Live today:\s*/i, '').replace(/[.]\s*$/, '');
  if (/^(Just Business|city|node-city|plague|camp)\b/i.test(t) || /household basket/i.test(t)) return null;
  const m = /^((?:The )?[A-Z][A-Za-z']*(?: [A-Z][A-Za-z']*)*)\b\s*(.*)$/.exec(t);
  if (!m) return null;
  return { m, name: 'the ' + m[1].replace(/^The /, '') + (/^bench/i.test(m[2]) ? ' bench' : '') };
}
function isPlural(name) { return /[^s]s$/.test(name) && name !== name.toUpperCase(); }
function sellVerb(ctx, ids) { return ids.length > 1 || isPlural(ctx.resName(ids[0])) ? ' sell ' : ' sells '; }
function liveUse(ctx, row, tileId) {
  const r = ctx.resName(row.id);
  const pl = isPlural(r);
  const t = String(row.why || '').replace(/^Live today:\s*/i, '').replace(/[.]\s*$/, '');
  const listed = (s) => s.replace(/\s*\(\+\d+ more\)\s*$/, '').split(/,\s*/).filter(Boolean).slice(0, 2).join(' and ');
  let m;
  if (/^Just Business op input/i.test(t)) {
    /* Round 3 said "every Car Factory production run uses up metal" sixteen
       times: true, and it names neither a purpose nor a product. The run's own
       output is the purpose, and recipes.js has it (city-only products count:
       a Restaurant's run makes prepared meals). */
    const node = ctx.byId.get(tileId) || {};
    const out = liveFirst(ctx.makes(tileId)).map((m) => m.id).filter((x) => x !== row.id)[0];
    if (node.kind === 'cityTransit') return 'every route ' + ctx.label(tileId) + ' runs burns ' + r;
    if (tileId === TRANSPORT) return 'every haul a Transport truck makes burns ' + r;
    return out ? 'each batch of ' + ctx.resName(out) + ' at ' + ctx.label(tileId) + ' uses up ' + r : 'each working shift at ' + ctx.label(tileId) + ' uses up ' + r;
  }
  if ((m = /^city-builder build cost:\s*(.+)$/i.exec(t))) return 'city buildings like ' + listed(m[1]) + ' cost ' + r + ' to build';
  if ((m = /^(?:city building input|node-city tile running input):\s*(.+)$/i.exec(t))) return 'city buildings like ' + listed(m[1]) + ' run on ' + r;
  if (/^plague cure reagent/i.test(t)) return r + (pl ? ' are' : ' is') + ' a reagent in plague cures';
  if (/^camp daily consumption/i.test(t)) return 'camps eat through ' + r + ' every day';
  if (/^camp consumable/i.test(t)) return r + (pl ? ' are' : ' is') + ' used up straight from the camp screen';
  if (/^city workerHire/i.test(t)) return 'hiring city workers costs ' + r;
  if (/^city soldierHire/i.test(t)) return 'hiring city soldiers costs ' + r;
  if (/^city services/i.test(t)) return 'city services use up ' + r;
  if (/household basket/i.test(t)) return 'city households buy ' + r;
  const v = venueOf(row);
  if (v) {
    const m = v.m, venue = v.name;
    /* Round 5: 51 reasons were one of two templates ("X goes into recipes at…",
       "X is a build cost at…"). The game has only a handful of such venues, and
       each does one recognisable thing with what it is given — say that. Keyed on
       the venue name lifted from coverage.js; an unknown venue falls through to
       the old sentence, never to a wrong one. */
    const copy = (VENUE_COPY[row.role] || []).find((c) => c[0].test(t));
    if (copy) return copy[1](r, pl);
    if (row.role === 'craft') return r + (pl ? ' go' : ' goes') + ' into recipes at ' + venue;
    if (row.role === 'build') return r + (pl ? ' are' : ' is') + ' a build cost at ' + venue;
    if (row.role === 'upkeep') return /repair/i.test(m[2]) ? 'repairs at ' + venue + ' cost ' + r : r + (pl ? ' keep ' : ' keeps ') + venue + (/^fleet/i.test(m[2]) ? ' fleet' : '') + ' running';
    if (row.role === 'input') return venue + ' machines burn ' + r + ' as they run';
  }
  return '';
}
/* Every need row a tile has for one resource, the most TELLING first: a live
   row that names a venue, then a proposed row (a plain sentence), then the bare
   per-run input. */
function useFor(ctx, tileId, ids) {
  for (const id of arr(ids)) {
    const rows = ctx.needs(tileId).filter((n) => n.id === id);
    const isLiveRow = (n) => n.live || /^Live today/i.test(String(n.why || ''));
    const generic = (n) => /Just Business op input/i.test(String(n.why || ''));
    const order = [...rows.filter((n) => isLiveRow(n) && !generic(n)), ...rows.filter((n) => !isLiveRow(n)), ...rows.filter((n) => isLiveRow(n) && generic(n))];
    for (const n of order) {
      const c = isLiveRow(n) ? liveUse(ctx, n, tileId) : playerClause(n.why);
      if (c && !REASON_LEAK.test(c)) return c;
    }
  }
  return '';
}
/* What ANYONE on the map does with a resource — for the battler-card rows,
   where the buyer is a player rather than a tile with a needs list. */
function anyUse(ctx, ids) {
  /* Recipes first, and up to two venues in one clause: "memory shards go into
     recipes at the Hospital and the Weapon Smith bench" tells a battler where
     the thing is spent. The first version took whichever tile came first and
     told battlers their shards were "a build cost at the Cracking Yard". */
  /* Round 5: that was built by splicing two liveUse() sentences on the words
     "into recipes at", and read "memory shards — memory shards go into recipes
     at the Weapon Smith bench and the Hospital". It is now said directly, from
     the venues themselves. */
  for (const id of arr(ids)) {
    const found = [];
    for (const { by } of (ctx.neededBy.get(id) || [])) {
      for (const n of ctx.needs(by).filter((x) => x.id === id && x.live && x.role === 'craft')) {
        const v = venueOf(n);
        if (v && !found.includes(v.name)) found.push(v.name);
      }
    }
    if (found.length) return 'players spend ' + ctx.resName(id) + ' at ' + found.slice(0, 2).join(' and ');
  }
  for (const id of arr(ids)) for (const { by } of (ctx.neededBy.get(id) || [])) {
    const c = useFor(ctx, by, [id]);
    if (c && !/^(each batch|each working shift|every route|every haul)/.test(c)) return c;
  }
  return '';
}

/* The short status a player reads next to a reason. */
const NOTE = Object.freeze({
  live: 'Works today',
  optional: 'Works today — hiring a carrier is optional',
  p2p: 'Works today — traded player to player',
  notBuilt: (label) => 'Planned — ' + label + ' is not in the game yet',
  liveFor: (names) => 'Works today for ' + names,
});
/* WHY THERE IS NO BARE "PLANNED" CHIP ANY MORE (round 3 — the critic's biggest gap)
   Round two printed "Planned — not in the game yet" on 56 of 416 rows where BOTH
   businesses exist and only the delivery between them does not. Next to the
   Fashion chip ("Planned — Fashion Brand is not in the game yet") a player reads
   the bare one the same way: Mining's card said Oil Company, Construction and
   the Genetics Lab "are not in the game". So a planned chip must always name
   its SUBJECT — which business, which cargo — and, where something does work
   today, say what. Two honest planned cases when both ends exist (round 3 had a
   third, "Planned delivery", for cargo made and spent today but not as the
   buyer's run input; round 4 made that GREEN — see ONE RULE below):
     made today, the buyer has no use for it yet       -> sell it on the Marketplace
     not made today                                    -> say who does not make it
   auditReasons() refuses a planned chip without a subject. */
function fitNote(ctx, build, count) {
  /* A chip's job is to NAME its subject, so it names every cargo when that fits
     (round 3 printed "naphtha, diesel and 1 more" for a list of three). */
  for (let n = Math.min(count || 2, ctx.maxNames); n >= 1; n--) { const t = build(n); if (t.length <= ctx.maxChars) return t; }
  return build(1);
}
/* nameList for a chip: never "and 1 more" — a remainder of one is either named
   or, when only one name fits, left off: the chip then speaks for the cargo
   closest to working, which is the one listed first. */
function chipList(ctx, ids, max) {
  const u = uniq(ids);
  let k = Math.max(1, Math.min(max || ctx.maxNames, ctx.maxNames, u.length));
  if (u.length - k === 1) { if (k > 1) k -= 1; else return ctx.resName(u[0]); }
  return nameList(ctx, u, k);
}

/* ── ONE RULE FOR "WORKS TODAY" (round 4 — the critic's biggest gap) ───────────
   Round three had two. A DRAWN lane was green only when the buyer's production
   run consumes the cargo (recipes.js lane.live); an UNDRAWN row was green when
   the buyer spends it on anything at all — a build cost, a kitchen recipe. So
   the Cars card said "Oil Company buys your metal {Works today}" and the Mining
   card, about the very same trade, said "Planned delivery". Six of the owner's
   drawn lanes looked worse than incidental ones.
   The rule now, for every (supplier, buyer, cargo), drawn or not:
     works   the supplier yields it in the shipped game AND the buyer spends it
             in the shipped game (run input, upkeep, build cost or recipe)
     unused  made today, the buyer has no use for it yet
     unmade  the supplier does not yield it today
   and a green chip only ever vouches for the cargo in state "works": either
   every id on the line works, or the chip is scoped ("Works today for metal").
   What a drawn lane adds is HOW the trade happens, never WHETHER: a lane whose
   run input is live is a direct purchase; any other working lane says "bought
   on the Marketplace; direct delivery is planned".
   Rejected: holding undrawn rows to the stricter run-input rule instead. It is
   consistent too, but it would turn "Medical buys your ethanol" orange although
   a player can sell ethanol to a hospital owner this minute — the modal's
   "what works" would under-report the game. */
function madeLive(ctx, sup, id) { return ctx.isLive(sup) && ctx.tradeMakes(sup).some((m) => m.id === id && m.live); }
function usedLive(ctx, cons, id) {
  if (!ctx.isLive(cons)) return false;
  /* Battle has no needs list of its own; a battler's units eat what a camp eats */
  const rows = ctx.needs(cons).length || cons !== BATTLE ? ctx.needs(cons) : ctx.needs(CAMP);
  return rows.some((n) => n.id === id && n.live) || arr(ctx.recipe(cons).upkeep).some((u) => u.id === id);
}
function tradeState(ctx, sup, cons, id) { return !madeLive(ctx, sup, id) ? 'unmade' : usedLive(ctx, cons, id) ? 'works' : 'unused'; }
const HOW_TAIL = Object.freeze({ direct: '', drawn: ' — bought on the Marketplace; direct delivery is planned', undrawn: ' — traded player to player' });
function tradeStatus(ctx, selfId, sup, cons, ids, how) {
  const list = uniq(arr(ids));
  const works = ctx.isLive(sup) && ctx.isLive(cons) ? list.filter((id) => tradeState(ctx, sup, cons, id) === 'works') : [];
  if (!works.length) return { live: false, works, note: plannedNote(ctx, selfId, sup, cons, list) };
  const tail = HOW_TAIL[how] === undefined ? HOW_TAIL.undrawn : HOW_TAIL[how];
  /* the Marketplace wording always names its cargo: "Works today — bought on
     the Marketplace" beside a three-cargo sentence would claim all three */
  const scoped = works.length < list.length || how === 'drawn';
  return { live: true, works, note: scoped ? fitNote(ctx, (n) => NOTE.liveFor(chipList(ctx, works, n)) + tail, works.length) : NOTE.live + tail };
}
function plannedNote(ctx, selfId, supplierId, consumerId, ids) {
  if (!ctx.isLive(supplierId)) return NOTE.notBuilt(ctx.label(supplierId));
  if (!ctx.isLive(consumerId)) return NOTE.notBuilt(ctx.label(consumerId));
  const S = ctx.label(supplierId), C = ctx.label(consumerId);
  const iSell = supplierId === selfId;
  const list = uniq(arr(ids));
  if (!list.length) return 'Planned — nothing is traded between ' + S + ' and ' + C + ' yet';
  const state = (id) => tradeState(ctx, supplierId, consumerId, id);
  /* One lane can carry cargo in all three states (Oil to Gas Station: crude oil
     is not pumped yet, but naphtha and diesel are). The chip speaks for the
     cargo closest to working, because that is the part a player can act on. */
  /* Round 5: Oil to the farm carries fertilizer AND diesel; the chip said only
     "doesn't use diesel yet" and never stated fertilizer's status (Oil does not
     make it today). When a lane is planned for two different reasons the chip
     gives both, each with its own cargo; if that cannot fit it falls back to the
     cargo closest to working. */
  const unusedIds = list.filter((id) => state(id) === 'unused'), unmadeIds = list.filter((id) => state(id) === 'unmade');
  if (unusedIds.length && unmadeIds.length) {
    for (let n = ctx.maxNames; n >= 1; n--) {
      const t = 'Planned — ' + C + " doesn't use " + chipList(ctx, unusedIds, n) + ' yet, and ' + S + " doesn't produce " + chipList(ctx, unmadeIds, n) + ' yet';
      if (t.length <= ctx.maxChars) return t;
    }
  }
  const st = ['unused', 'unmade'].find((x) => list.some((id) => state(id) === x)) || 'unmade';
  const same = list.filter((id) => state(id) === st);
  return fitNote(ctx, (n) => {
    const names = chipList(ctx, same, n);
    const it = same.length > 1 || isPlural(ctx.resName(same[0])) ? 'them' : 'it';
    if (st === 'unused') return 'Planned — ' + C + ' doesn\'t use ' + names + ' yet; ' + (iSell ? 'sell yours' : S + ' sells ' + it) + ' on the Marketplace today';
    return 'Planned — ' + S + ' doesn\'t produce ' + names + ' yet' + (iSell ? ', so ' + C + ' can\'t buy ' + it : '');
  }, same.length);
}
/* ── WHAT RIDES THE TRUCK, LEG BY LEG (round 5 — the critic's biggest gap) ─────
   Round 4's one rule stopped at goods trades. A hauling line (the carrier row on
   a tile's card, the "pays you to haul" row on Transport's) took its green cargo
   from "somebody, somewhere, yields this", so Construction's card said of
   recycled metal from the Trash Crusher "Planned — doesn't use it yet" in rows
   1-2 and "Works today" for hauling that same metal from that same supplier in
   row 3; and Transport's card disagreed with the tile's own on 15 of 21 pairs,
   because each side built its own inbound list (Restaurant's named only the
   farm, Transport's named all four suppliers).
   A truck cannot make a trade work that does not work. So a haul is judged leg
   by leg with the SAME rule as the trade it serves:
     in   cargo c from drawn supplier S: green only when tradeState(S, tile, c)
          is 'works' (any one drawn supplier is enough); a vehicle lane never —
          vehicles are garage items, not hauled cargo. A tile with no drawn
          supplier falls back to what it burns / spends today, green when it is
          spent here AND some business yields it.
     out  green only when the tile yields it today AND someone takes it today: a
          Marketplace row on its own card, or any node that spends it.
   ONE function builds the legs and BOTH cards read it, so the cargo, the green
   subset, the live flag and the chip cannot drift apart again. auditReasons()
   asserts both halves (same-card agreement, and card-to-card equality). */
function haulLegs(ctx, tileId) {
  if (!ctx._legs) ctx._legs = new Map();
  if (ctx._legs.has(tileId)) return ctx._legs.get(tileId);
  const self = ctx.byId.get(tileId) || {};
  const rec = ctx.recipe(tileId);
  const inn = new Map();
  liveFirst(arr(rec.buys)).forEach((l, li) => arr(l.ids).forEach((id, ii) => {
    const works = !l.cargoIsItem && tradeState(ctx, l.from, tileId, id) === 'works';
    const leg = inn.get(id);
    if (!leg) inn.set(id, { id, dir: 'in', from: [l.from], works, at: li * ctx.byId.size + ii });
    /* a second drawn supplier of the same cargo: the working one is named first */
    else { if (works && !leg.works) leg.from.unshift(l.from); else leg.from.push(l.from); leg.works = leg.works || works; }
  }));
  const makes = liveFirst(ctx.tradeMakes(tileId));
  if (!inn.size) {
    /* What rides IN when the owner drew no supplier, most certain first: what the
       shipped op burns, else its live needs. The PROPOSED needs are the last
       resort and only for a tile with nothing going out (Dojo, Bank) — and then
       only what it would use up day to day. Round 4 named build materials there
       ("Transport would haul reinforced concrete in to Bank"), which no player
       recognises as that business. */
    const upkeep = arr(rec.upkeep).map((u) => u.id);
    const liveNeed = uniq(ctx.needs(tileId).filter((n) => n.live).map((n) => n.id));
    const running = uniq(ctx.needs(tileId).filter((n) => n.role === 'input' || n.role === 'upkeep').map((n) => n.id));
    const ids = upkeep.length ? upkeep : liveNeed.length ? liveNeed : makes.length ? [] : (running.length ? running : uniq(ctx.needs(tileId).map((n) => n.id)));
    ids.forEach((id, i) => inn.set(id, { id, dir: 'in', from: [], works: usedLive(ctx, tileId, id) && ctx.madeAnywhere(id), at: i }));
  }
  const hasMarketRow = !!(self.icons && self.icons.market) || arr(rec.sellsTo).includes(MARKET);
  const taken = (id) => hasMarketRow || Array.from(ctx.byId.keys()).some((n) => n !== tileId && usedLive(ctx, n, id));
  const out = makes.map((m, i) => ({ id: m.id, dir: 'out', from: [tileId], works: madeLive(ctx, tileId, m.id) && taken(m.id), at: i }));
  const order = (legs) => legs.sort((a, b) => Number(b.works) - Number(a.works) || a.at - b.at);
  const res = { inn: order(Array.from(inn.values())), out: order(out) };
  res.legs = [...res.inn, ...res.out];
  res.cargo = uniq(res.legs.map((l) => l.id));
  res.works = uniq(res.legs.filter((l) => l.works).map((l) => l.id));
  res.live = ctx.isLive(tileId) && res.works.length > 0;
  res.idle = !res.live && !res.out.length;
  res.forced = ctx.ship.LIVE_LANES.filter((l) => l.from === tileId || l.to === tileId);
  /* one chip for both cards (round 4: Medical's own card said "a carrier is
     required for some of its sales", Transport's card said "optional") */
  res.note = !res.live ? (ctx.isLive(tileId) ? 'Planned — nothing ' + ctx.label(tileId) + ' makes or uses rides a truck yet' : NOTE.notBuilt(ctx.label(tileId)))
    : res.forced.length ? 'Works today — a carrier is required for some of its sales' : NOTE.optional;
  ctx._legs.set(tileId, res);
  return res;
}
/* "in from Research Facility and Fashion Brand": EVERY tile that puts an inbound
   leg on the truck, working suppliers first (haulLegs' leg order), so the truck
   line always says who ships to you. Round 5 named only the suppliers of the
   cargo the sentence had room for, and the critic caught the owner's own
   headline on Medical's card: "hauls memory shards, research chemicals and 2
   more in from Research Facility" — the 2 more were Fashion Brand's cloth and
   fabric, so the one sentence that should have read "Fashion ships cloth via
   Transport to Medical" never named Fashion. Supplier names are fixed now and
   fit() gives up CARGO names first; auditReasons() asserts every inbound
   supplier is named on both cards. */
/* Every inbound supplier is NAMED, never elided. Round 8 tried capping this at
   two names plus "and 2 more yards" to buy the cargo half of the sentence more
   room (the four-supplier tiles spend their budget on names and read "haul fuel
   and 5 more in from …"). auditReasons() rejected it on the spot, and correctly:
   the rule this module already holds itself to is that a truck line names every
   yard the load starts at, because a dispatcher cannot derive the yards from
   anywhere else on the card, whereas the full cargo list is carried in the row's
   own `cargo` and `haulLegs` for a view to open. The cargo/name squeeze inside
   140 characters is real and is a tuning question (SC.partners.reasonMaxChars),
   not something to pay for by dropping a supplier's name. */
function haulFrom(ctx, legs) {
  const from = uniq(legs.filter((l) => l.dir === 'in').flatMap((l) => l.from));
  if (!from.length) return '';
  const names = from.map(ctx.label);
  return ' from ' + (names.length > 1 ? names.slice(0, -1).join(', ') + ' and ' + names[names.length - 1] : names[0]);
}
/* REJECTED (round 6, removed in round 7): a rung ladder that gave up cargo
   names to keep supplier names inside one 140-character truck sentence —
   "fuel and 5 more", then "fuel and more", then plain "loads". It bottomed out
   on the four-supplier tiles and produced a freight line with no freight in it
   ("Smuggling Network pays you to haul contraband out and loads in from …").
   Splitting the sentence by direction (haulDirs) removed the need for it: two
   sentences have room for both halves. Kept as a comment because the tempting
   fix — a longer cap — is the one the hover card cannot take. */

/* ── ONE TRUCK LINE PER DIRECTION (round 7 — the critic's gap) ────────────────
   Round 6 wrote inbound and outbound as ONE sentence, so a tile with four
   suppliers spent its whole 140 characters on names and the ladder in tersest()
   started eating the cargo: Smuggling's row on Transport's card read "pays you
   to haul contraband out and LOADS in from Gas Station, Research Facility,
   Fishing Company and Agricultural Op." — a truck line with no freight in it —
   and Genetics Lab / Car Factory read "memory shards and more" / "fuel and
   more". A dispatcher cannot act on that.
   Two entries instead of one give each direction its own sentence and its own
   140 characters, so every line names BOTH its cargo and its suppliers with no
   ladder at all. Rejected: raising the character cap (the hover card is a
   glance and the cap is the card's own width, not a tuning dial), and dropping
   supplier names (round 6 proved that loses the owner's headline lane, Fashion
   -> Medical). The split is computed HERE, from haulLegs, so the tile's card and
   Transport's card cut the legs the same way and auditReasons can compare them
   direction by direction.
   Each direction carries its OWN chip: a tile can buy nothing from its drawn
   suppliers today and still sell its output (or the other way round), and one
   chip over both halves was exactly the unscoped green the round-4 rule bans. */
function haulDirs(ctx, H, tileId) {
  const me = ctx.label(tileId);
  const dirs = [];
  if (H.inn.length) dirs.push({ dir: 'in', legs: H.inn });
  if (H.out.length) dirs.push({ dir: 'out', legs: H.out });
  return dirs.map((d) => {
    const ids = uniq(d.legs.map((l) => l.id));
    const works = ids.filter((id) => d.legs.some((l) => l.id === id && l.works));
    /* H.live is the pair's flag (is this tile hauling anything real at all); a
       single direction is only live when something in THAT direction works. */
    const live = H.live && works.length > 0;
    const note = live ? H.note
      : !ctx.isLive(tileId) ? NOTE.notBuilt(me)
        : d.dir === 'in' ? 'Planned — nothing ' + me + ' takes in is bought straight from those businesses yet; it comes off the Marketplace today'
          : 'Planned — nothing ' + me + ' makes has a buyer who takes delivery by truck yet';
    return { ...d, ids, works, live, note };
  })
    /* A WORKING direction is written first, on BOTH cards. Two reasons, and they
       agree: a row is led by the half that works today (round 5's rule — a
       Planned line never stands over a working one), and rows() picks the lead
       from the first entry added, so a fixed in-then-out order made Construction
       lead with its planned inbound on the tile's card and with its green
       outbound on Transport's — the same partnership reading Planned on one card
       and Works today on the other, which is the contradiction round 4 closed. */
    .sort((a, b) => Number(b.live) - Number(a.live));
}

/* "The map is unclear about this link" gave a player nothing to do. A caveat now
   says WHAT is unclear, in terms of the two readings the player could act on. */
const CAVEAT = Object.freeze({
  direction: (ctx, selfId, otherId, asSupplier, ids) => {
    const cargo = ids.length ? nameList(ctx, ids, 2) : 'goods';
    if (selfId === TRANSPORT) return ctx.label(otherId) + ' may sell you your ' + cargo + ', or only be a hauling client — the map doesn\'t say which.';
    if (otherId === TRANSPORT) return 'Transport may buy its ' + cargo + ' here, or only haul for you — the map doesn\'t say which.';
    return asSupplier
      ? ctx.label(otherId) + ' may ship you ' + cargo + ', or buy from you instead — the map shows the link, not its direction.'
      : ctx.label(otherId) + ' may buy your ' + cargo + ', or supply you instead — the map shows the link, not its direction.';
  },
  leftover: (ctx, chId, tileId) => 'The ' + ctx.label(chId) + ' mark beside ' + ctx.label(tileId) + ' may be a leftover from another page of the map — treat it as a maybe.',
  card: (ctx, tileId, sharedWith) => 'The battler card sits between ' + ctx.label(tileId) + ' and ' + (sharedWith && ctx.byId.has(sharedWith) ? ctx.label(sharedWith) : 'its neighbour') + ' on the map, so it may belong to either.',
  noArrow: 'No arrow is drawn for this on the map — camp units bring resources back, but where they sell them is left open.',
  noCargo: 'The map links these two but does not show what is traded.',
  fallback: 'The map shows this link but not which way it runs.',
});

/* ── accumulating candidates ───────────────────────────────────────────────── */
/* One partner can relate to a tile several ways (Gas Station sells Transport
   its fuel AND rides its trucks). Each way is an ENTRY; one row per partner
   comes out, led by its strongest entry, the others kept as their own lines. */
/* Shared cargo counts only up to what a reason can NAME (SC.hover.maxMakes).
   Uncapped, Battle System "supplying" seventeen loot ids out-weighed every real
   lane on the map, and oil's fourteen refinery cuts made it everyone's best
   friend. Past the fourth shared resource the advice does not get any better. */
function makeBag(ctx, selfId) {
  const map = new Map();
  let seq = 0;
  return {
    /* entry: { role, tier, reason (player), note (player status), dev (audit),
                cite, cargo, live, pdfDrawn, ambiguous, ambiguity, order,
                pinned, enforcedToday, rankOnly } */
    add(id, e) {
      if (!id || id === selfId || !ctx.byId.has(id) || !e.reason) return;
      const P = ctx.P;
      const cargo = uniq(arr(e.cargo));
      const live = !!e.live && ctx.isLive(id) && ctx.isLive(selfId);
      /* A row is never live when one end is unbuilt, so its chip cannot start
         "Works today" either (round two: Transport's card said hauling for the
         Fashion Brand "works today"). Fixed here once, for every add site. */
      let note = e.note || '';
      if (!live && (!note || /^Works today/.test(note))) {
        note = !ctx.isLive(id) ? NOTE.notBuilt(ctx.label(id)) : !ctx.isLive(selfId) ? NOTE.notBuilt(ctx.label(selfId))
          : (note || 'Planned — ' + ctx.label(id) + ' and ' + ctx.label(selfId) + ' do not trade this yet');
      }
      /* WHICH cargo the green chip vouches for (round 4). A site that ran
         tradeStatus() passes `works`; everywhere else it is derived here, once:
         a trade line by the one rule, any other line by "somebody yields it in
         the shipped game". An unscoped green chip over a line that also names
         planned cargo is then scoped HERE, so no add site can forget to. */
      const isTrade = !e.service && (e.role === 'supplier' || e.role === 'customer');
      const sup = e.sup !== undefined ? e.sup : (isTrade ? (e.role === 'supplier' ? id : selfId) : null);
      const cons = e.cons !== undefined ? e.cons : (isTrade ? (e.role === 'supplier' ? selfId : id) : null);
      const supTile = sup && ctx.byId.get(sup) && ctx.byId.get(sup).nodeKind === 'tile';
      const works = !live ? [] : e.works ? uniq(e.works).filter((c) => cargo.includes(c))
        : cargo.filter((c) => (supTile ? (cons ? tradeState(ctx, sup, cons, c) === 'works' : madeLive(ctx, sup, c)) : ctx.madeAnywhere(c)));
      if (live && works.length && works.length < cargo.length && /^Works today(?! for )/.test(note || NOTE.live)) {
        const tail = (note || NOTE.live).slice(NOTE.live.length);
        note = fitNote(ctx, (n) => NOTE.liveFor(chipList(ctx, works, n)) + tail, works.length);
      }
      /* rankOnly: the entry's place in its own list IS the advice (Bank's
         borrowers, dearest licence first), so cargo count must not reorder it. */
      /* noWeight: a second line that must not move the row (the Marketplace
         orphan line; a drawn neighbour's extra undrawn trade). It weighs nothing
         on its own so a row is never led, in rank, by its footnote. */
      const raw = e.noWeight ? 0 : (P.weight[e.role] || 0)
        + (e.pdfDrawn ? P.pdfDrawnBonus : 0)
        /* directLive: a drawn lane that works only through the Marketplace is green
           (the one rule) but earns no live bonus, so the lanes whose own production
           run buys the cargo still lead the card exactly as they did in round 3 */
        + ((e.directLive !== undefined ? (live && e.directLive) : live) ? P.liveBonus : 0)
        + (e.rankOnly ? 0 : P.perSharedResource * Math.min(cargo.length, ctx.maxNames))
        - (e.ambiguous ? P.ambiguousPenalty : 0);
      if (!map.has(id)) map.set(id, []);
      /* what else fit() could have said on this line, for dedupeWhy(); null when
         the reason was written by hand rather than fitted */
      const alt = LAST_FIT && LAST_FIT.result === e.reason ? LAST_FIT : null;
      map.get(id).push({ ...e, _fit: alt, note: note || NOTE.live, cargo, live, raw, works, hauling: !!e.hauling, legs: e.hauling ? arr(e.legs) : null, sup: isTrade ? sup : null, cons: isTrade ? cons : null, seq: e.order !== undefined ? e.order : Number.MAX_SAFE_INTEGER - ctx.byId.size + (seq++) });
    },
    rows() {
      const out = [];
      for (const [id, entries] of map) {
        entries.sort((a, b) => a.tier - b.tier || b.raw - a.raw);
        let lead = entries[0];
        /* The contract's bar: Transport is the CARRIER for every tile that ships,
           even where it is also a customer (it buys Gas Station's fuel). */
        const asCarrier = entries.find((x) => x.role === 'carrier');
        if (asCarrier && !(asCarrier.idle && entries.length > 1)) lead = asCarrier;
        const ranked = entries.find((x) => x.rankOnly);
        if (ranked && (!asCarrier || (asCarrier.idle && entries.length > 1))) lead = ranked;
        /* Round 5: the Car Dealer / Transport pair led with a different relationship
           on each card — hauling (green) on the dealer's, the dealer's planned trucks
           on Transport's — so one partnership read "Works today" here and "Planned"
           there. A Planned line no longer stands over a line that works today: the
           working one leads the row, the planned one follows as its own line. The
           carrier lead is the contract's and stays. RANK is untouched: tier, weight
           and the ambiguity sort key still come from the entry the map ranks by. */
        const sortLead = lead;
        /* an owner-named lane (pinned: fashion to medical, car factory to dealer) keeps
           the lead even while planned — it IS the point of the row */
        if (!lead.live && lead.role !== 'carrier' && !lead.rankOnly && !lead.pinned) {
          /* ...but the owner's ink is not demoted by a side trade: a DRAWN lane keeps
             the lead over an undrawn green line (Trash Crusher stays Construction's
             supplier of recycled metal, with "buys your metal" as its second line, on
             both cards). Only the truck outranks a drawn lane: hauling leads on the
             tile's card by contract, so it leads on Transport's card too. */
          const green = entries.find((x) => x.live && !x.idle && (lead.tier === TIER.undrawn || x.hauling));
          if (green) lead = green;
        }
        const others = entries.filter((x) => x !== lead);
        const tier = Math.min(...entries.map((x) => x.tier));
        const raw = ranked ? ranked.raw : Math.max(...entries.map((x) => x.raw))
          + others.reduce((s, x) => s + (x.noWeight ? 0 : ctx.P.perSharedResource * Math.min(x.cargo.length, ctx.maxNames)), 0);
        const ordered = [lead, ...others];
        /* Round one took `ambiguous` from whichever entry had the lowest tier.
           On Car Dealer that was Transport's open-direction "buys your trucks"
           icon, so the CARRIER row was sorted as doubtful and its two roles read
           as one paragraph. A row is only as doubtful as the entry that leads it. */
        const doubt = ordered.find((x) => x.ambiguous);
        out.push({
          id, label: ctx.label(id), role: lead.role, roles: uniq(ordered.map((x) => x.role)),
          score: raw, rawScore: raw, tier, tierLabel: TIER_LABEL[tier],
          reasons: uniq(ordered.map((x) => x.reason)),
          lines: ordered.map((x) => ({ role: x.role, text: x.reason, _fit: x._fit, statusNote: x.note, live: x.live, cargo: x.cargo,
            /* worksCargo: the ids the green chip vouches for; supplier/consumer are
               set on goods trades only (null on hauling, loans, storage, membership) */
            worksCargo: x.works, supplier: x.sup, consumer: x.cons, itemTrade: !!x.itemTrade,
            /* hauling lines only: every leg the truck runs, { id, dir:'in'|'out', from:[supplier ids], works } */
            hauling: x.hauling, haulLegs: x.legs ? x.legs.map((g) => ({ id: g.id, dir: g.dir, from: g.from.slice(), works: g.works })) : null, caveat: x.ambiguous ? (x.caveat || CAVEAT.fallback) : null })),
          cargo: uniq(ordered.flatMap((x) => x.cargo)),
          live: lead.live, status: lead.live ? 'live' : 'proposed', anyLive: entries.some((x) => x.live),
          statusNote: lead.note,
          caveat: doubt ? (doubt.caveat || CAVEAT.fallback) : null,
          pdfDrawn: entries.some((x) => x.pdfDrawn),
          pinned: entries.some((x) => x.pinned),
          /* markOnly only survives to the row when EVERY entry is a bare icon
             correction and the merged row still names no cargo — a tile that
             also has a real lane with this partner keeps its normal rank. */
          markOnly: entries.every((x) => !!x.markOnly) && !ordered.some((x) => x.cargo.length),
          last: entries.every((x) => x.last),
          ambiguous: !!sortLead.ambiguous, ambiguity: (entries.find((x) => x.ambiguity) || {}).ambiguity || null,
          enforcedToday: entries.some((x) => x.enforcedToday),
          devNote: uniq([TIER_DEV[tier], ...ordered.map((x) => x.dev).filter(Boolean)]).join(' | '),
          cite: uniq(ordered.map((x) => x.cite).filter(Boolean)).join(' | ') || null,
          _seq: Math.min(...entries.map((x) => x.seq)),
        });
      }
      return out;
    },
  };
}

/* ── two markets on one tile ────────────────────────────────────────────────
   Round 7 shipped a Car Dealer card whose #3 was the ordinary Marketplace (it
   carries the dealer's metal and scrap metal) and whose #4 was the Car
   Marketplace — the market that carries the dealer's CARS. The gap was 0.021 of
   rawScore, on a page where the tow truck is the TOPMOST icon the owner drew on
   that tile and the legend captions it "Best to make money". Shared-cargo weight
   is simply the wrong judge between two channels: the general Marketplace always
   shares more ids with any tile, because it takes everything.

   So between two channel rows in the same tier on the same card:
     1. a market this tile can actually sell into (the row carries cargo) beats
        one it cannot. This is what keeps Oil, Gas, Agricultural Op. and Home
        Feed — drawn with a tow truck but making nothing the catalogue calls a
        vehicle — with the Marketplace on top: their Car Marketplace row takes
        the `noVehicle` branch above and carries no cargo at all.
     2. otherwise the drawn order decides, so the icon the owner placed highest
        on the tile is the market the card names first.

   Rejected: a special case naming ch:carmarket, or the `cars` tile, or a
   weight bump in tuning. The rule has to read off the drawn icons and the
   catalogue's own vehicle family, or the next tile the owner draws a tow truck
   beside gets the same wrong answer. Rejected too: moving `order` ahead of
   rawScore for every row — it would let a drawn supplier icon outrank a richer
   drawn supplier on the same tier for no reason a player could see. */
function channelLine(r) { return arr(r.lines).find((l) => l.role === 'channel') || null; }
function channelCmp(a, b) {
  const la = channelLine(a), lb = channelLine(b);
  if (!la || !lb) return 0;
  const sellable = (l) => (arr(l.cargo).length ? 1 : 0);
  return sellable(lb) - sellable(la) || a._seq - b._seq;
}

/* The clause after the em dash, normalised for comparison only. */
function whyTail(text) {
  const i = String(text || '').indexOf(' — ');
  return i < 0 ? '' : String(text).slice(i + 3).replace(/[.]\s*$/, '').toLowerCase();
}
/* Write a why-clause at most once per card — see the note above fit(). Runs in
   RANK order, so the row a player reads first keeps the sentence and the ones
   under it re-fit from their own remaining clauses, or fall back to the lead
   (which always names the cargo). A repeat is only allowed to stand when the
   line has nothing else at all to say, which happens on hand-written reasons
   with no `_fit` record. */
function dedupeWhy(ctx, rows) {
  const used = new Set();
  for (const r of rows) {
    for (const l of arr(r.lines)) {
      const tail = whyTail(l.text);
      const f = l._fit;
      delete l._fit;
      if (!tail) continue;
      if (!used.has(tail)) { used.add(tail); continue; }
      if (!f) continue;
      let next = '';
      /* A clauseCuts() shortening of a clause the card has already written is
         the SAME sentence with its end chopped off ("a city needs a bus, train
         or airport before it can hire from its camps" -> "a city needs a bus"),
         which reads worse than the repeat it replaces. Anything that is a
         prefix of a used clause, or has one as its prefix, is not fresh. */
      const stale = (k) => [...used].some((u) => u.startsWith(k) || k.startsWith(u));
      const fresh = arr(f.tails).filter((t) => { const k = whyTail(' — ' + t); return k && !stale(k); });
      if (fresh.length) {
        const s = fitWith(ctx, f.lead, fresh);
        if (s && whyTail(s) && !used.has(whyTail(s))) next = s;
      }
      if (!next) next = fitWith(ctx, f.lead, []);   /* lead alone: still names the cargo */
      if (next && next !== l.text) {
        l.text = next;
        const k = whyTail(next);
        if (k) used.add(k);
      }
    }
    r.reasons = uniq(arr(r.lines).map((l) => l.text));
  }
  return rows;
}

/* The sunk corrections as ONE sentence — and, more importantly, ON SCREEN.
   `foldLine` from the first of them (the rest point at it with `foldedInto`)
   is the summary; the rows keep their own ids so a reader can still click
   through to the tile. Deliberately worded WITHOUT "only … trade here" /
   "sells on the Marketplace instead": it is a summary, not a repeat of the
   rows it stands for.

   🔴 ROUND 11 — the sentence has to be DRAWN, not merely derived. Round 10
   sank the four "marked for this market, but only vehicles trade here" rows
   below modal.js's cut at MODAL.maxPartners and set `foldLine` for a view to
   print. No view prints it: paintPartners() paints `rows[]` and nothing else —
   no expand control, no "show all 10", no footer hook. So ranks 7-10 were not
   below a fold, they were gone, while section 7 of the same card still told
   the player to "use the tow-truck icon as your guide" and named the very
   tiles section 6 had stopped mentioning. A fact only the data carries is a
   deleted fact. The summary therefore also rides the LAST row the card will
   actually show, through `lines`/`reasons` — the fields every view already
   prints — and is worded as a list-level aside ("Not in the list above: …")
   so it cannot be misread as a claim about that partner.
   Rejected: a synthetic row (modal.js labels a row from its id and navigates
   to it, so it would masquerade as a tile); the host row's `caveat` (it
   renders glued to that row's status note, which makes it that row's caveat);
   and waiting for modal.js to grow a footer — modal.js is not this piece's
   file and the card has to be honest in the build that ships.
   🔴 ROUND 12 closed the question this note left open. "Only vehicles trade on
   the Car Marketplace" is NOT true of anything the data says: sections 1 and 5
   of these same cards list oil, gas, food and feed against this market, from
   recipes.js sellsTo, and the legend calls an icon a dependency, not a listing.
   Every sentence on both sides now states the dependency and claims nothing
   about where goods list. Whether the market should be vehicles-only is a map
   question for the owner — it would change recipes.js/graph.js, not the wording.
   See sc/decisions/carmarket-partners.md. */
function foldMarkOnly(ctx, rows, selfId) {
  const sunk = rows.filter((r) => r.markOnly);
  const kept = rows.filter((r) => !r.markOnly);
  /* rank() only sinks when a substantive row exists; if none does the
     corrections ARE the card's visible content and there is nothing to fold */
  if (!sunk.length || !kept.some((r) => arr(r.cargo).length)) return null;
  const names = sunk.map((r) => ctx.label(r.id));
  const list = names.length > 1 ? names.slice(0, -1).join(', ') + ' and ' + names[names.length - 1] : names[0];
  /* nameList() for LABELS: same shape ("A, B and 2 more"), same refusal to
     spend three words hiding one name, but labels are not catalogue ids so
     resName() must not touch them. */
  const listNames = (want) => {
    let k = Math.max(1, Math.min(want, names.length));
    if (names.length - k === 1 && k > 1) k -= 1;
    const shown = names.slice(0, k), rest = names.length - k;
    if (rest > 0) return shown.join(', ') + ' and ' + rest + ' more';
    if (shown.length <= 1) return shown[0];
    return shown.slice(0, -1).join(', ') + ' and ' + shown[shown.length - 1];
  };
  /* On a CHANNEL card the sunk rows are the tiles whose tow truck points here.
     On a TILE card there is one sunk row and it IS the market this tile's own
     truck points at — so the goods to name are the tile's, not the market's.
     Both come from tradeMakes(); never a typed product name. */
  const tileSide = sunk.every((r) => String(r.id).indexOf('ch:') === 0);
  const goodsOf = (id) => liveFirst(ctx.tradeMakes(id)).filter((m) => m.live).map((m) => m.id);
  /* 🔴 ROUND 14 — the channel-voice clause was FALSE for half the tiles it
     named. `goods` used to be a flat UNION of every sunk tile's output, and on
     ch:carmarket that union is headed by the Oil Company's twenty fuel ids, so
     every rung of the why-ladder below (which names the FIRST n) could only
     ever say "vehicles keep their fuel selling" about a list that also names
     Agricultural Op. and Home Feed — who make food and animal feed and, under
     CHANNEL_SCOPE(['vehicle','energy']), list nothing on this market at all.
     The tile-voice side was always right (it names the tile's OWN goods), and
     is untouched; only the plural side was ever able to mis-attribute.
     The fix is that on the channel side a named clause must be true of EVERY
     tile in the same sentence, so the names come from one lead good per sunk
     tile (`spread`) and are only ever printed in full — never truncated, since
     dropping a name silently re-creates the mis-attribution. If any sunk tile
     has no live good to contribute, or the full list will not fit, the ladder
     falls through to a goods-neutral clause rather than naming a subset.
     Rejected: naming only the ids common to every sunk tile (here the
     intersection is empty, so the card would lose the clause round 13 exists
     to keep); and a per-tile "Oil fuel, Agri food" clause (it doubles the
     sentence and the same information is already on each tile's own row). */
  const spreadRaw = tileSide ? [] : sunk.map((r) => goodsOf(r.id)[0]);
  const spread = spreadRaw.every(Boolean) ? uniq(spreadRaw) : [];
  const goods = tileSide ? uniq(goodsOf(selfId)) : spread;
  /* The aside is bounded like every other sentence on the card, but by its OWN
     cap (ctx.foldMaxChars, not ctx.maxChars): it is one line standing in for
     four rows no view can open, so it has to carry three things a per-partner
     reason never has to carry at once — WHICH tiles, what the mark MEANS and
     WHY. auditReasons() enforces that cap on it, so it is a longer bound, not
     an exemption. Richest version first; what is given up, and in what order,
     is the round-13 note below. Hand-rolled rather than fit(), because fit()'s
     last resort is a hard '…' cut and the audit counts those as a failure;
     here the last rung is a complete short sentence instead. */
  const many = names.length > 1;
  const poss = tileSide ? 'your ' : 'their ';
  /* 🔴 ROUND 12 — the summary said the four tiles "make no vehicle", which is
     the same false rebuttal the rows themselves used to carry: the legend never
     claimed they made one, and section 1 of this very card lists their products
     against this market. The aside now says only what the legend says — the mark
     is a dependency — and asserts nothing about where the goods list, so it
     cannot contradict the sections above it. The verb-agreement helper and the
     "sells on the Marketplace" clause went with it. */
  /* 🔴 ROUND 13 — the ladder gave up the WHY-clause before it gave up one word
     of the NAMES, so on the three cards whose names run longest (ch:carmarket,
     Oil Company, Home Feed) the sentence a player actually read named the mark
     and never said what it is for: "… a market they need to earn", which reads
     as "a market they must unlock" — the inverse of the legend, which says the
     icon means the tile DEPENDS on that market to earn. Two fixes, both here:
     the meaning clause now says "depend(s) on … to earn", and the ladder is a
     product of two ladders walked WHO-outermost, with every why-bearing rung
     tried before any rung that has no why at all. So detail is given up in the
     order a reader would miss it least (how many goods are named, then how many
     tiles are named) and the why-clause is the LAST thing to go, not the first.
     Rejected: dropping the tile names first — the four rows that name every
     product one by one sit below a fold no view can open, so these names are
     the only place a player learns WHICH tiles carry the mark. */
  const who = [];
  if (tileSide) {
    /* player voice on a tile card: the reader IS the tile, and every other
       sentence on that card already says "your fuel" */
    who.push('the tow-truck mark on this tile points at the ' + list + ', a market you depend on to earn');
    who.push(poss + 'tow-truck mark points at the ' + list + ', a market you depend on to earn');
    who.push(poss + 'tow truck points at the ' + list + ', a market you depend on to earn');
  } else {
    /* "the tow-truck mark: markets they need to earn" pluralised a single
       market. The colon form keeps the market singular and the subject plural. */
    const carries = (n) => (n ? ' carry' : ' carries') + ' the tow-truck mark: ' + (n ? 'they depend' : 'it depends') + ' on this market to earn';
    who.push(listNames(names.length) + carries(many));
    /* fewer names, same sentence — the remainder is a real remainder, never
       "and 1 more" (the rule shownIds() already follows for cargo) */
    if (names.length > 2) who.push(listNames(2) + carries(many));
    who.push((many ? names.length + ' tiles' : names[0]) + carries(many));
  }
  /* The why-clause, richest first. A tile that yields fourteen goods makes
     "fuel and 13 more" longer than the sentence can hold, so the last rung
     names the leading good alone and speaks for the line — the same call
     chipList() already makes for a status chip. */
  const whyNamed = [], whyNeutral = [];
  {
    const sep = tileSide ? ' — ' : '; ';
    /* names EVERY id it is given, ignoring ctx.maxNames: used only on the
       channel side, where "and 1 more" would hide exactly the tile whose
       product differs and put the round-14 lie back on the card. */
    const allNames = (ids) => {
      const s = ids.map(ctx.resName);
      return s.length > 1 ? s.slice(0, -1).join(', ') + ' and ' + s[s.length - 1] : s[0];
    };
    for (const stem of ['vehicles on the road are what keep ', 'vehicles keep ']) {
      if (goods.length) {
        if (tileSide) {
          /* one tile, one voice: truncating its own list mis-states nothing.
             The last rung names the leading good ALONE rather than letting
             nameList() spend the line on "fuel and 13 more", which is a longer
             way to say less. */
          for (let n = 3; n >= 2; n--) whyNamed.push(sep + stem + poss + nameList(ctx, goods, n) + ' selling');
          whyNamed.push(sep + stem + poss + ctx.resName(goods[0]) + ' selling');
        } else {
          whyNamed.push(sep + stem + poss + allNames(goods) + ' selling');
        }
      }
      /* the goods-neutral rung is always available and is always true: it is
         the floor the channel side falls to rather than name a subset */
      whyNeutral.push(sep + stem + poss + 'goods selling');
    }
  }
  /* Ladder order is still round 13's: WHO-outermost, so the tile names are the
     LAST detail given up. What changed is that the goods-neutral rung now sits
     inside the same why-list, at its end — so a who-rung is only shortened
     once neither a named nor a neutral goods clause fits beside it. On
     ch:carmarket the four names plus any named-goods clause is ~188 chars
     against a 180 cap; without the neutral rung the ladder would drop to
     "4 tiles carry the tow-truck mark …" and lose the only place a player
     learns WHICH tiles carry the mark. Naming the four and saying "their
     goods" loses less — each tile's own row lists its products.
     The bare who-rungs (no why at all) are still the last resort. */
  const rungs = [];
  for (const w of who) for (const y of whyNamed.concat(whyNeutral)) rungs.push(w + y);
  /* only once NO why-bearing rung fits does the card fall back to naming the
     mark and nothing else */
  for (const w of who) rungs.push(w);
  /* The head used to read "Not in the list above:". The aside is hosted on the
     last VISIBLE row that still has room for a paragraph, and on the Oil
     Company card that walk-up lands on rank 5 because rank 6 already carries
     four lines — so a player read "above" with more list underneath it, and
     the sentence looked like the rank-5 partner's own. The host cannot always
     be the last row (modal.js keeps three paragraphs per row and dropping one
     of that row's own reasons to make space is worse), so the WORDING stops
     being positional instead: "Not ranked here" is true from any position. */
  const head = 'Not ranked here: ';
  const line = (rungs.map((b) => head + b + '.').find((x) => x.length <= ctx.foldMaxChars && !REASON_LEAK.test(x))
    || head + rungs[rungs.length - 1] + '.');
  sunk.forEach((r, i) => { if (i) r.foldedInto = sunk[0].id; });
  sunk[0].foldIds = sunk.map((r) => r.id);
  sunk[0].foldLine = line;
  /* The host is the last row inside the cut every view shares (P.maxShown).
     modal.js keeps only three paragraphs per row, so a row already carrying
     three would swallow the aside — walk up until one has room rather than
     drop one of that row's own reasons. */
  const cut = Math.max(1, (ctx.P && ctx.P.maxShown) || kept.length);
  /* 🔴 …BUT THE LAST VISIBLE ROW IS THE ONE A VIEW TRADES AWAY. modal.js's
     pinLegendPartners() pays for every row it lifts out of the fold with the
     LOWEST visible row that is not itself a badge target, so hosting the aside
     on the bottom row hands it to the view's change purse. Measured: on the Gas
     Station the host landed on Smuggling at rank 6, the card lifted the
     Marketplace row in over it, and the combined sentence — the only place that
     card explains its own 🚗 badge now that the correction is folded out — was
     not drawn at all. Found by the new DOM sweep, not by any module-data pin.
     So the walk-up starts above the rows a lift can spend: one row per
     below-the-fold LIFTABLE id. A liftable row is never itself displaced (the
     view will not trade one badge target for another), so it is a safe host at
     any rank and the reserve is only taken off the others.
     LIFTABLE_IDS duplicates modal.js's LEGEND_NODE. That is a real coupling and
     it is deliberate: this file cannot see the header badges, the aside exists
     precisely because a badge must be answered in words, and a stale copy makes
     the aside land one row too low — visible in the DOM sweep — rather than
     making it wrong. Rejected: hosting on rank 1 (the aside is a list-level
     note and the top row is the most-read advice on the card). */
  const liftable = new Set(['transport', 'ch:market', 'ch:carmarket', 'sys:battle']);
  const reserve = kept.slice(cut).filter((r) => liftable.has(String(r.id))).length;
  const safe = Math.max(1, Math.min(kept.length, cut) - reserve);
  let host = null;
  for (let i = safe - 1; i >= 0; i--) {
    /* still only a row with ROOM: modal.js keeps three paragraphs, so a fourth
       on a full row is the aside being swallowed, which is the same invisible
       failure by another route. */
    if (arr(kept[i].lines).length < 3) { host = kept[i]; break; }
  }
  /* a card whose whole safe range is full keeps the old bottom-up walk: a note
     that MIGHT be traded away still beats no note at all */
  if (!host) for (let i = Math.min(kept.length, cut) - 1; i >= 0; i--) {
    if (arr(kept[i].lines).length < 3) { host = kept[i]; break; }
  }
  if (!host) return null;
  host.foldLineShown = line;
  host.foldIds = sunk.map((r) => r.id);
  host.lines = arr(host.lines).concat([{
    /* foldNote marks it as belonging to the LIST, not to this partner: a view
       that grows its own footer should print it there and skip it here.
       It carries the HOST row's status flags, not its own: the aside makes no
       claim about whether anything works today, and a line whose `live` flag
       disagreed with the chip printed beside it is exactly what the
       cross-card audit exists to catch. */
    foldNote: true, role: host.role, text: line, statusNote: host.statusNote || '',
    live: !!host.live, cargo: [], worksCargo: [], supplier: null, consumer: null,
    itemTrade: false, hauling: false, haulLegs: null, caveat: null,
  }]);
  host.reasons = uniq(arr(host.reasons).concat([line]));
  return { sunk, kept, host, line, tileSide };
}

/* ── 🔴 ROUND 16: SINKING A CORRECTION IS NOT ENOUGH — A VIEW LIFTS IT BACK ──
   Round 10 sank the bare "this tile carries the mark" rows under every row
   that names cargo, and every pin since has measured bestPartners()' RAW
   return value and reported the card clean. The player does not read that
   list. modal.js paints `pinLegendPartners(all, node.badges, MODAL.maxPartners)`,
   which takes any row BELOW the fold whose id is a badge in the card's header
   (transport / ch:market / ch:carmarket / sys:battle) and lifts it back INTO
   the visible six, trading away the lowest visible row to make room. Measured
   on the shipped data: on oil, gas, agri and feed the row lifted back is the
   sunk ch:carmarket correction — cargo list EMPTY — and what it displaces is
   real cargo (agri loses genelab and smuggling; feed loses the Battle System,
   its richest partner at 15 ids). The card then says so in its own footer:
   "2 higher-ranked partners were pushed off the list to make room". So the
   demotion this whole thread exists to make was undone in the one place a
   player can see, and the sweep could not tell, because the sweep read us.

   modal.js is another piece's file and its lift is RIGHT for what it was
   written for: a card that badges an icon in its header and then cannot name
   it anywhere below contradicts its own header. The defect is that it has
   only one currency to pay with — a visible row — and on these four tiles it
   pays a cargo-bearing partner for a row with nothing to act on.

   The fix is on THIS side and it is the second option the piece goal already
   allows ("or fold all four into a single footer line"): when the aside
   foldMarkOnly() built is actually PRINTED on a visible row, a sunk row whose
   only content is that same aside is not merely ranked last, it is off the
   list. Nothing is deleted — `foldIds` names every folded id, `foldLine` is
   the sentence, both ride the visible host row, and modal.js's lift then finds
   nothing below the fold to lift, so no cargo-bearing partner is traded away
   and the header badge is still answered in words on the same screen.

   ⚠ ONLY THE TILE SIDE. `tileSide` means every sunk row is a CHANNEL the
   tile's own icon points at — one market, already badged in this card's
   header, and the aside says which market and what the mark means, so the row
   carries not one fact the aside lacks. On the CHANNEL card the sunk rows are
   four different TILES (Oil, Gas, Agricultural Op., Home Feed); each is a
   business with a card of its own that a player may well ask about, the header
   badges none of them, and no view lifts them — so they stay below the fold,
   exactly as round 10 left them. Dropping those would delete a fact.
   REJECTED: dropping sunk rows unconditionally (deletes four real tiles from
   ch:carmarket's list and blinds `pw-carmarket`'s "the ink is kept" pins);
   and waiting for modal.js to make its lift conditional (right fix in the
   right file, but the card has to be honest in the build that ships, and this
   file is the one that knows the row is redundant). */
function dropFoldedBadgeRows(rows, fold) {
  if (!fold || !fold.host || !fold.tileSide || !fold.sunk.length) return rows;
  /* the fold aside is the row's whole content now, so it must be reachable
     from the list even though no row carries it: the host keeps foldIds (set
     by foldMarkOnly) and takes over foldLine, the field every view and gate
     looks for when it asks "what stands in for the rows that are not here". */
  fold.host.foldLine = fold.line;
  const gone = new Set(fold.sunk);
  return rows.filter((r) => !gone.has(r));
}

function rank(ctx, rows, opts) {
  /* SC: "AMBIGUITIES rows are shown, but never ranked first". Inside a tier an
     ambiguous row therefore sorts after every unambiguous one, whatever it
     weighs. If a whole top tier is ambiguous it drops under the legend icons. */
  const t0 = rows.filter((r) => r.tier === TIER.needsIcon);
  if (t0.length && t0.every((r) => r.ambiguous) && rows.some((r) => !r.ambiguous)) {
    for (const r of t0) { r.tier = TIER.farSideOpen; r.tierLabel = TIER_LABEL[r.tier]; }
  }
  /* ── Round 10: an anti-partner is never advice ────────────────────────────
     The Car Marketplace's card opened Car Dealer, then Oil Company, Gas
     Station, Agricultural Op. and Home Feed — four rows that said only "X is
     marked for this market, but only vehicles trade here; its fuel sells on
     the Marketplace instead", with an empty cargo list. The tiles a player
     could actually deal with (Car Factory, the Battle System, the City
     Builder, Salvage) were ranks 7-10, under the fold modal.js cuts at
     MODAL.maxPartners. Those corrections are the owner's own ink — the tow
     truck IS drawn on those four tiles — so they are NOT deleted; they are
     simply the last thing a reader needs, and they sink below every row that
     names real cargo. `markOnly` is set at the two add sites that write that
     sentence (the channel's card and the tile's own section 3).
     Rejected: dropping the rows (a player who sees the tow truck on the Oil
     Company tile will ask, and the card must answer); and moving the
     correction into another row's note (it belongs to those four tiles, not
     to the dealer's). The sunk rows keep their true rank and carry `foldLine`,
     the combined sentence foldMarkOnly() also puts on the last VISIBLE row so
     a player actually reads it.
     Round 10 also exempted tier 0 (`r.tier > TIER.needsIcon`) "on principle",
     because selfTest keeps every drawn needs-icon in the short list. That
     branch has never run: `markOnly` is set at exactly two add sites and both
     write TIER.legendIcon or TIER.undrawn, so a tier-0 correction cannot
     exist (pw-carmarket asserts the count is 0 across all 33 cards). An
     exemption that is only ever dead code is not a safeguard, it is the
     round-1 defect waiting for the first needs-icon correction someone adds —
     so it is gone, and sinking is now unconditional. If a drawn needs-icon
     ever DOES produce a bare correction, the honest answer is still that a
     row with nothing to act on is not the first advice on the card. */
  const substantive = rows.filter((r) => !r.markOnly && arr(r.cargo).length).length;
  for (const r of rows) r._sink = (r.markOnly && substantive) ? 1 : 0;
  /* `pinned` (a lane the owner put into words) sorts ahead of weight, but only
     inside its own tier and never ahead of the ambiguity rule. */
  rows.sort((a, b) => a._sink - b._sink || a.tier - b.tier || Number(!!a.last) - Number(!!b.last) || Number(a.ambiguous) - Number(b.ambiguous) || Number(b.pinned) - Number(a.pinned)
    || channelCmp(a, b) || b.rawScore - a.rawScore || a._seq - b._seq || (a.id < b.id ? -1 : 1));
  /* Monotone envelope, bottom up: the step is the smallest weight the tuning
     table knows, so it can never leapfrog a real difference. */
  const step = ctx.P.perSharedResource / Math.max(rows.length, 1);
  for (let i = rows.length - 2; i >= 0; i--) {
    if (rows[i].score < rows[i + 1].score + step) rows[i].score = rows[i + 1].score + step;
  }
  const places = Math.pow(10, ctx.SC.proposal.decimals + 1);
  rows.forEach((r, i) => { r.rank = i + 1; r.score = Math.round(r.score * places) / places; r.rawScore = Math.round(r.rawScore * places) / places; delete r._seq; delete r._sink; });
  dedupeWhy(ctx, rows);
  const fold = foldMarkOnly(ctx, rows, opts && opts.selfId);
  return shortlist(ctx, opts && opts.selfId, dropFoldedBadgeRows(rows, fold), opts && opts.limit);
}

/* ── lane status: one short note for the player, one paragraph for the audit ── */
/* Returns { note, live, works } — the ONE RULE above decides green or not; the
   lane only decides the wording (direct purchase vs bought on the Marketplace). */
function laneStatus(ctx, lane, consumerId, supplierId, selfId) {
  if (!ctx.isLive(supplierId)) return { live: false, works: [], note: NOTE.notBuilt(ctx.label(supplierId)) };
  if (!ctx.isLive(consumerId)) return { live: false, works: [], note: NOTE.notBuilt(ctx.label(consumerId)) };
  if (lane.cargoIsItem) return { live: false, works: [], note: 'Planned — vehicles are not hauled as cargo yet' };
  return tradeStatus(ctx, selfId, supplierId, consumerId, lane.ids, lane.live ? 'direct' : 'drawn');
}
function laneDev(ctx, lane, consumerId, supplierId) {
  const names = nameList(ctx, lane.ids);
  if (!ctx.isLive(supplierId)) {
    const today = arr(lane.sourceToday).filter((s) => ctx.byId.has(s));
    return 'PLANNED: ' + ctx.label(supplierId) + ' is on the owner\'s map but is not an operation in the game yet.'
      + (lane.consumerCite ? ' Consumer half is live: ' + lane.consumerCite + '.' : '')
      + (today.length ? ' Until it exists, ' + today.map(ctx.label).join(' and ') + ' is who makes ' + nameList(ctx, lane.ids.slice(0, 1)) + '.' : '');
  }
  if (!ctx.isLive(consumerId)) return 'PLANNED: ' + ctx.label(consumerId) + ' is on the owner\'s map but is not an operation in the game yet.';
  if (lane.cargoIsItem) return 'PLANNED: vehicles are items in the game today, not a resource that rides a truck, so this lane is the map speaking.';
  if (lane.live) {
    const restIds = lane.ids.filter((i) => !lane.liveIds.includes(i));
    return 'LIVE (' + (lane.liveVia || 'opsInput') + '): ' + ctx.label(consumerId) + ' consumes ' + nameList(ctx, lane.liveIds) + '.'
      + (restIds.length ? ' ' + cap(nameList(ctx, restIds)) + ' on the same lane is the owner\'s map, not yet the game.' : '')
      + (lane.cite ? ' ' + lane.cite : '');
  }
  return 'PLANNED: the owner drew this lane; the game does not make ' + ctx.label(consumerId) + ' buy ' + names + ' yet.';
}

function needIcon(ctx, tile, otherId) { return arr(tile.needs).find((n) => n.biz === otherId) || null; }
function laneBetween(ctx, from, to) { return arr(ctx.recipe(to).buys).find((l) => l.from === from) || null; }
function isNamedLane(ctx, from, to) { return ctx.namedLanes.some((l) => l && l.from === from && l.to === to); }
/* Every PDF lane on the map as [from, to, ids] — used to find the NATURAL maker
   or buyer of a cargo when the owner drew no lane between two tiles. */
function allLanes(ctx) {
  if (ctx._lanes) return ctx._lanes;
  const out = [];
  for (const t of ctx.tiles) for (const l of arr(ctx.recipe(t.id).buys)) out.push({ from: l.from, to: t.id, ids: arr(l.ids) });
  ctx._lanes = out;
  return out;
}

/* What battlers and camp trainers DO with a card-marked tile's goods. Round two
   gave the mark itself as the reason ("Genetics Lab is marked good for camp
   trainers") — that is why the row exists, not why a player should care. In
   order: the tile's own service line when it has one (Genetics Lab: "the camp
   DNA Lab, where battlers clone units"), then what a camp spends the product on,
   then what anyone in the game spends it on. '' when the data has no answer —
   the lead clause still names the cargo. */
function cardWhy(ctx, tileId, ownCard) {
  const service = serviceClause(ctx.recipe(tileId).service);
  /* On the tile's own card the reader IS the business: "you hold the licence",
     not "it holds". Only a plain -s verb is turned; anything else keeps "it". */
  if (service) return ownCard && !/^it \w*(ie|ss|sh|ch|x)s /.test(service) ? service.replace(/^it (\w+?)s /, 'you $1 ') : service;
  /* live products only when there are any: Weapon Smith's row was scoped to
     weapon parts and then explained itself with ammo, which nobody makes yet */
  const all = liveFirst(ctx.tradeMakes(tileId));
  const ids = (all.some((m) => m.live) ? all.filter((m) => m.live) : all).map((m) => m.id);
  return useFor(ctx, CAMP, ids) || useFor(ctx, BATTLE, ids) || anyUse(ctx, ids);
}
/* Does this tile put cargo on a truck? shipping.js owns the answer, narrowed to
   tiles with the truck drawn beside them or goods of their own to send: for the
   Bank, shipping.js counts proposed build materials arriving, and a guaranteed
   "nothing Bank makes or uses rides a truck yet" slot is not advice. */
function shipsCargo(ctx, tileId) {
  const n = ctx.byId.get(tileId);
  if (!n || n.nodeKind !== 'tile' || tileId === TRANSPORT) return false;
  try {
    const truck = ctx.ship.pdfTruckDrawn(tileId, ctx.tiles, { businesses: ctx.tiles, recipes: ctx.RECIPES });
    return !!truck.shipsCargo && (truck.drawn === true || ctx.tradeMakes(tileId).length > 0);
  } catch (_) { return false; }
}
/* The short list a view prints (SC.partners.maxShown). Round two's top six left
   the truck off Mining, Trash Crusher and Car Factory (ranks 7, 7, 9) — on a map
   whose one rule is that every business ships through Transport. The carrier
   row therefore always holds a slot on a cargo tile: it takes the LAST place,
   keeps its true `rank`, and is flagged `guaranteed` so a view can say why a
   7 follows a 5. Rejected: lifting the truck above drawn customers 4-6 in the
   ranking itself — the full list would then stop matching the map's tiers. */
/* Round 4: that REPLACED the sixth row, so Mining's list lost Oil Company — a
   direct link the owner drew — and read 1,2,3,4,5,7, which looks like a bug.
   Now (a) a tile with more direct links than maxShown shows all of them (the
   map's own ink is never cut: Mining and Trash Crusher have six), and (b) when
   the truck still falls outside, it is APPENDED as a footer row (`footer: true`,
   true `rank`, a `footerNote` saying why it is there). The numbered part of the
   list is always contiguous from 1; a view draws the footer under a rule. */
function shortlist(ctx, selfId, rows, limit) {
  if (!(typeof limit === 'number' && limit > 0) || rows.length <= limit) return rows;
  const direct = rows.filter((r) => r.tier === TIER.needsIcon).length;
  /* Round 5: Transport is the hub the whole map hangs on, and its short list
     showed 6 of its 15+ truck-marked clients. The same rule as above — the map's
     own ink is never cut — applied to the hub: every tile the truck is drawn
     beside stays on Transport's list. partnerReport().haulingClients names them
     so a view can draw them as one group under the suppliers. */
  const marked = selfId === TRANSPORT ? rows.filter((r) => r.tier <= TIER.legendIcon).length : 0;
  const top = rows.slice(0, Math.max(limit, direct, marked));
  if (shipsCargo(ctx, selfId) && !top.some((r) => r.id === TRANSPORT)) {
    const carrier = rows.find((r) => r.id === TRANSPORT && r.roles.includes('carrier'));
    /* when the truck is simply the next row (Mining: six direct links, truck 7th)
       the list just runs one longer and needs no footer */
    const next = carrier && carrier.rank === top.length + 1;
    if (carrier) top.push(next ? { ...carrier, guaranteed: true } : { ...carrier, guaranteed: true, footer: true, footerNote: 'Always listed: every business ships through Transport.' });
  }
  return top;
}

/* ════════════════════════════ TILES ══════════════════════════════════════════ */
function tilePartners(ctx, self) {
  const bag = makeBag(ctx, self.id);
  const me = ctx.label(self.id);
  const myMakes = liveFirst(ctx.tradeMakes(self.id)).map((m) => m.id);
  const pdfPeers = new Set();
  /* cargo already spoken for by a drawn lane, per direction — section 5 must
     not offer a second "makes food" supplier when the owner drew the first. */
  const laneIn = new Set(), laneOut = new Set();

  /* 1 ── PDF lanes, both directions. recipes.js buys[] IS the PDF lane set (its
        validator rejects a lane the owner did not draw), so walking it never
        invents an edge; businesses.js says on WHICH tile the icon sits. */
  const lanes = [];
  for (const l of arr(ctx.recipe(self.id).buys)) lanes.push({ lane: l, supplier: l.from, consumer: self.id });
  for (const t of ctx.tiles) {
    if (t.id === self.id) continue;
    const l = laneBetween(ctx, self.id, t.id);
    if (l) lanes.push({ lane: l, supplier: self.id, consumer: t.id });
  }
  lanes.forEach(({ lane, supplier, consumer }) => {
    const other = supplier === self.id ? consumer : supplier;
    const otherTile = ctx.byId.get(other);
    if (!otherTile) return;
    const mine = needIcon(ctx, self, other);
    const theirs = needIcon(ctx, otherTile, self.id);
    const icon = mine || theirs;
    const ambiguous = lane.pdf === 'needs-ambiguous' || !!(icon && (icon.confidence === 'ambiguous' || icon.direction === 'ambiguous'));
    const tier = (mine || !ambiguous) ? TIER.needsIcon : TIER.farSideOpen;
    const order = mine ? arr(self.needs).indexOf(mine) : undefined;
    const where = mine ? 'drawn beside ' + me + ' on p' + self.page : 'drawn beside ' + ctx.label(other) + ' on p' + otherTile.page;
    const doubt = ambiguous ? ' The map leaves the direction of this icon open (owner ambiguity ' + ((icon && icon.ambiguity) || 'C') + '), so it is shown but never ranked first.'
      : (lane.confidence === 'likely' || (icon && icon.confidence === 'likely')) ? ' Icon ' + where + '; attribution is likely, not certain.' : '';
    const asSupplier = supplier === other;
    for (const id of lane.ids) (asSupplier ? laneIn : laneOut).add(id);
    /* the lane's own sentence first; if it cannot fit, what the cargo is for on
       the tile that consumes it */
    const why = [playerClause(lane.why), ...lane.ids.map((id) => useFor(ctx, consumer, [id]))];
    const st = laneStatus(ctx, lane, consumer, supplier, self.id);
    bag.add(other, {
      role: asSupplier ? 'supplier' : 'customer', tier, pdfDrawn: true, ambiguous, order,
      ambiguity: icon && icon.ambiguity ? icon.ambiguity : null,
      pinned: isNamedLane(ctx, supplier, consumer),
      live: st.live, works: st.works, directLive: !!lane.live, cargo: lane.ids,
      reason: fit(ctx, (n) => ctx.label(other) + (asSupplier ? ' ships you ' : ' buys your ') + nameList(ctx, lane.ids, n), why),
      note: st.note,
      caveat: ambiguous ? CAVEAT.direction(ctx, self.id, other, asSupplier, lane.ids) : null,
      dev: laneDev(ctx, lane, consumer, supplier) + doubt + (isNamedLane(ctx, supplier, consumer) ? ' Pinned: a lane the owner named in words.' : ''),
      cite: 'PDF p' + (mine ? self.page : otherTile.page) + ' needs-icon, ' + where,
    });
    pdfPeers.add(other);
  });
  /* A needs-icon with no lane behind it would be a hole in recipes.js. Show the
     neighbour anyway (the owner drew it) and say the cargo is undecided, rather
     than silently dropping a drawn partner. */
  for (const n of arr(self.needs)) {
    if (pdfPeers.has(n.biz) || !ctx.byId.has(n.biz)) continue;
    bag.add(n.biz, { role: n.direction === 'buyer' ? 'customer' : 'supplier', tier: TIER.needsIcon, pdfDrawn: true, ambiguous: n.confidence === 'ambiguous',
      live: false, cargo: [], caveat: CAVEAT.noCargo,
      reason: ctx.label(n.biz) + ' is linked to ' + me + ' on the map, but what rides between you has not been chosen yet.',
      note: plannedNote(ctx, self.id, n.biz, self.id, []),
      dev: 'Needs-icon drawn beside ' + me + ' on p' + self.page + ' with no recipes.js lane behind it (owner ambiguity M).' });
    pdfPeers.add(n.biz);
  }

  /* 2 ── Transport. */
  if (self.id !== TRANSPORT) {
    const truck = ctx.ship.pdfTruckDrawn(self.id, ctx.tiles, { businesses: ctx.tiles, recipes: ctx.RECIPES });
    if (truck.shipsCargo) {
      /* haulLegs() is the single source for what rides, which of it works today,
         the live flag and the chip — Transport's card reads the same object. */
      const H = haulLegs(ctx, self.id);
      const inIds = H.inn.map((l) => l.id), outIds = H.out.map((l) => l.id);
      const drawn = truck.drawn === true;
      /* Dojo's row read "Transport hauls booster packs, clothing, printed cards,
         sporting goods and 14 more in" under a chip saying none of it rides a
         truck, ranked above its real suppliers. With nothing live to haul the row
         names two or three inputs, says the hauling is planned, and sorts under
         the named suppliers of its tier. */
      const idle = H.idle;
      const dev = (drawn ? 'The owner drew the truck beside this tile.' : 'No truck is drawn beside this tile; it is here ' + ctx.ship.NOT_DRAWN_LABEL + '.')
        + (!H.live ? ' PLANNED: nothing ' + me + ' makes or consumes in the shipped game rides a truck yet; this lane is the owner\'s rule that every business ships through Transport (decision ' + ctx.ship.RULE.decision + ').'
          : H.forced.length ? ' LIVE and ENFORCED for part of this business: the server refuses ' + H.forced.map((l) => l.short || l.label).join(' and ') + ' without a carrier. Every other lane is optional today.'
            : ' LIVE but OPTIONAL today: hiring a carrier is a bonus, never a requirement. Making it mandatory is the owner\'s rule, switched off (decision ' + ctx.ship.RULE.decision + ').');
      const base = {
        role: 'carrier', hauling: true, tier: drawn ? TIER.legendIcon : TIER.undrawn, pdfDrawn: drawn,
        order: drawn ? arr(self.drawn).findIndex((x) => x.icon === 'transport') : undefined,
        enforcedToday: H.forced.length > 0, dev, cite: truck.cite,
      };
      if (idle) {
        /* Dojo's row read "Transport hauls booster packs, printed cards and 14
           more in" under a chip saying none of it rides a truck. With nothing
           live to haul the row names two or three inputs, says the hauling is
           planned, and sorts under the named suppliers of its tier. It stays ONE
           line: there is no outbound half to split off. */
        const idleWhy = [useFor(ctx, self.id, inIds.slice(0, 1)), 'planned: ' + me + ' uses none of it yet'].filter(Boolean);
        bag.add(TRANSPORT, { ...base, legs: H.legs, last: !drawn, idle: true, live: H.live, works: H.works, cargo: H.cargo, note: H.note,
          /* An idle tile names two or three of its inputs and no remainder: a
             count of things that do not ride a truck yet is noise. shownIds cuts
             the list BEFORE nameList so what is left still reads as a list
             ("cardboard, packaging material and wood panels"); round 6 stripped
             the " and 3 more" tail afterwards and left a comma run with no and. */
          reason: fit(ctx, (n) => 'Transport would haul ' + (inIds.length ? nameList(ctx, shownIds(ctx, inIds, Math.min(n, ctx.maxNames - 1))) : 'supplies') + ' in to ' + me, idleWhy) });
      } else if (!H.legs.length) {
        bag.add(TRANSPORT, { ...base, legs: [], live: H.live, works: H.works, cargo: H.cargo, note: H.note,
          reason: fit(ctx, () => 'Transport moves whatever ' + me + ' has at its gate', '') });
      } else {
        /* One line per direction (haulDirs): "hauls A, B and C in from X and Y"
           then "carries your D and E out to your buyers". Transport's own card
           reads the same split. */
        haulDirs(ctx, H, self.id).forEach((d, i) => bag.add(TRANSPORT, { ...base,
          legs: d.legs, live: d.live, works: d.works, cargo: d.ids, note: d.note,
          /* the second direction must not move the row: the rank a tile gives its
             carrier is the one round 6 measured, and splitting a sentence in two
             is a wording change, not a new partnership */
          noWeight: i > 0,
          reason: d.dir === 'in'
            /* a tile with nothing going out still gets a why, or the line is just "hauls fuel in" */
            ? fit(ctx, (n) => 'Transport hauls ' + nameList(ctx, d.ids, n) + ' in' + haulFrom(ctx, d.legs),
              outIds.length ? '' : (self.kind === 'cityTransit' ? 'you move people, not freight, so your own supplies still arrive by truck' : 'you ship nothing out, but your supplies still arrive by truck'))
            : fit(ctx, (n) => 'Transport carries your ' + nameList(ctx, d.ids, n) + ' out to your buyers', ''),
        }));
      }
    }
  } else {
    /* Seen FROM Transport: every tile that puts cargo on a truck is a hauling
       client. Same legs, same green subset, same chip as that tile's own carrier
       row (haulLegs). An idle tile (Bank, Dojo: nothing to haul today and nothing
       going out) is left off this card — a planned client with planned cargo is
       not a partner worth a row on the hub's list. */
    for (const t of ctx.tiles) {
      if (t.id === TRANSPORT) continue;
      const truck = ctx.ship.pdfTruckDrawn(t.id, ctx.tiles, { businesses: ctx.tiles, recipes: ctx.RECIPES });
      if (!truck.shipsCargo) continue;
      const H = haulLegs(ctx, t.id);
      if (!H.cargo.length || H.idle) continue;
      const drawn = truck.drawn === true;
      const dev = (drawn ? 'The owner drew the truck beside it on p' + t.page + '.' : 'No truck is drawn beside it; the lane is here ' + ctx.ship.NOT_DRAWN_LABEL + '.')
        + (H.forced.length ? ' LIVE and ENFORCED for part of this business; every other lane is optional today.' : ' LIVE but OPTIONAL today: nobody is made to hire a carrier for this freight yet.');
      /* Same split, same legs, same per-direction chip as the tile's own carrier
         row — and the same suppliers named, so a dispatcher reading Transport's
         card knows whose gate each inbound load starts at. */
      haulDirs(ctx, H, t.id).forEach((d, i) => bag.add(t.id, {
        role: 'customer', service: true, hauling: true, tier: drawn ? TIER.legendIcon : TIER.undrawn, pdfDrawn: drawn,
        legs: d.legs, live: d.live, works: d.works, cargo: d.ids, note: d.note, noWeight: i > 0,
        enforcedToday: H.forced.length > 0, dev, cite: truck.cite,
        reason: d.dir === 'in'
          ? fit(ctx, (n) => ctx.label(t.id) + ' pays you to haul ' + nameList(ctx, d.ids, n) + ' in' + haulFrom(ctx, d.legs), '')
          : fit(ctx, (n) => ctx.label(t.id) + ' pays you to haul its ' + nameList(ctx, d.ids, n) + ' out', ''),
      }));
    }
  }

  /* 3 ── channels: the Marketplace and tow-truck icons on this tile. */
  const chan = [[MARKET, 'market'], [CARMARKET, 'carMarket']];
  for (const [chId, key] of chan) {
    const drawn = !!(self.icons && self.icons[key]);
    const sells = arr(ctx.recipe(self.id).sellsTo).includes(chId);
    if (!drawn && !sells) continue;
    const icon = arr(self.drawn).find((x) => x.icon === key);
    /* The Car Marketplace trades VEHICLES. Which of this tile's products are
       vehicles is the catalogue's call (family 'vehicle'), never an id list
       here. cityFirm rows count for this one question: the dealer's cars are
       items in a player's garage today, and the catalogue id only stands in. */
    const vehicles = chId === CARMARKET ? uniq(ctx.makes(self.id).map((m) => m.id).filter((id) => ctx.family(id) === 'vehicle')) : [];
    const cargo = chId === CARMARKET && vehicles.length ? vehicles : myMakes;
    const liveCargo = ctx.tradeMakes(self.id).filter((m) => m.live).map((m) => m.id);
    const isLive = chId === MARKET ? liveCargo.length > 0 : vehicles.length > 0;
    /* Round two told Oil "Car Marketplace is where you list your fuel" while the
       Car Marketplace's own card said of Oil "none of it is a vehicle yet".
       Round 11 settled on "the mark is there, only vehicles trade there, and the
       goods sell on the Marketplace instead" — and that was FALSE twice over.
       (a) Section 1 of the same card lists fifteen live rows of Oil's and Gas
       Station's products against this market, because recipes.js derives a
       sellsTo edge from the drawn icon and graph.js errors if one is missing. A
       card cannot list a product here and then say the product does not trade
       here. (b) The legend (businesses.js PDF.iconRule) says an icon means the
       tile NEEDS that market to earn — it never said the tile MAKES that
       market's goods. So "but only vehicles trade here" rebutted a claim the map
       never made, and the rebuttal contradicted this card's own section 1.
       Both sides now say what the legend says: the mark is a DEPENDENCY. Nothing
       is asserted about where the goods do or do not list, so neither sentence
       can collide with section 1. The row still carries no cargo and is still
       sunk by rank(), because "you depend on this market" is not a trade a
       player can act on — but it is no longer a correction, it is the legend.
       Rejected: deleting the row (the mark is drawn, a reader will ask); and
       making recipes.js/graph.js drop the fuel edges so "vehicles only" becomes
       true — that is a map question for the owner, not a wording fix, and those
       are not this piece's files. See sc/decisions/carmarket-partners.md. */
    const noVehicle = chId === CARMARKET && !vehicles.length;
    bag.add(chId, {
      /* markOnly: this entry's ONLY content is the legend's reading of a drawn
         icon ("you need this market to earn"). It names no cargo and no trade
         to act on, so rank() sinks it under every row that names goods. See the
         round-10 note in rank(). */
      markOnly: noVehicle,
      role: 'channel', tier: drawn ? TIER.legendIcon : TIER.undrawn, pdfDrawn: drawn, ambiguous: !!(icon && icon.ambiguity === 'D'),
      caveat: icon && icon.ambiguity === 'D' ? CAVEAT.leftover(ctx, chId, self.id) : null,
      ambiguity: icon && icon.ambiguity ? icon.ambiguity : null,
      order: drawn ? arr(self.drawn).indexOf(icon) : undefined,
      live: isLive, cargo: noVehicle ? [] : cargo,
      /* itemTrade: the catalogue id only stands in for a garage item, so "is the
         resource yielded today" is the wrong question and the audit skips it */
      itemTrade: chId === CARMARKET && vehicles.length > 0,
      /* a vehicle the tile does not turn out yet (the dealer's trucks) is not vouched for */
      works: chId === CARMARKET ? vehicles.filter((v) => ctx.makes(self.id).some((m) => m.id === v && m.live)) : liveCargo,
      reason: noVehicle
        ? fit(ctx, () => ctx.label(chId) + ' is your tow-truck mark, and the legend reads a mark as a market you depend on to earn', liveCargo.length ? [2, 1].map((k) => 'vehicles on the road are what keep your ' + nameList(ctx, liveCargo, k) + ' selling') : '')
        : cargo.length
        ? fit(ctx, (n) => ctx.label(chId) + ' is where you list your ' + nameList(ctx, cargo, n) + ' for Cinder', chId === CARMARKET ? 'vehicles sell there as items, on the player vehicle market and the auction floor' : '')
        : ctx.label(chId) + ' is where ' + me + ' finds paying players — it sells a service, not a resource.',
      note: chId === MARKET
        ? (liveCargo.length ? (liveCargo.length < cargo.length ? NOTE.liveFor(nameList(ctx, liveCargo)) : NOTE.live) : (ctx.isLive(self.id) ? 'Planned — nothing ' + me + ' makes can be listed yet' : NOTE.notBuilt(me)))
        : (vehicles.length ? 'Works today — vehicles trade as items, not as hauled cargo' : 'Planned — the tow truck is drawn, but no lane behind it is built yet'),
      dev: (drawn ? 'The owner drew its icon beside this tile ("Best to make money").' : 'Not drawn beside this tile; recipes.js sellsTo.')
        + (icon && icon.ambiguity ? ' The owner may not have meant this icon (ambiguity ' + icon.ambiguity + ': it sits where another page\'s column sat).' : '')
        + (chId === CARMARKET ? ' The player vehicle market and the auction floor exist today for vehicle ITEMS; vehicles as hauled resources are the owner\'s map.' : ''),
      cite: 'PDF legend p6: ' + ctx.label(chId),
    });
  }

  /* 4 ── systems: the battler card, sellsTo, and battle loot coming IN. */
  const card = self.icons && self.icons.card;
  if (card) {
    const icon = arr(self.drawn).find((x) => x.icon === 'card');
    const amb = card === '?';
    const liveMakes = ctx.tradeMakes(self.id).filter((m) => m.live).map((m) => m.id);
    const service = serviceClause(ctx.recipe(self.id).service);
    const cardUse = cardWhy(ctx, self.id, true);
    const cardIcon = icon;
    /* Card Shop's two top rows said "Battlers buy your printed cards {Works today
       — as a service}" while Dojo's card said printed cards are not produced yet.
       Goods are named only when some are made today; otherwise the row is about
       the service. And the two audiences get two different sentences when the
       data has two (Dojo: it trains units / it holds the Camp Dojo Shop licence). */
    const said = liveMakes.length ? myMakes : (ctx.recipe(self.id).service ? [] : myMakes);
    const svcAll = sentences(ctx.recipe(self.id).service).filter((x) => !REASON_LEAK.test(x)).map((x) => serviceClause(x)).filter(Boolean);
    const youSay = (c) => (c && !/^it \w*(ie|ss|sh|ch|x)s /.test(c) ? c.replace(/^it (\w+?)s /, 'you $1 ') : c);
    /* The legend reads "Good For Battlers and camp training": two audiences, so
       two rows. Round one only listed Battle and the Dojo list came out 4 long. */
    [[BATTLE, 'Battlers', 'battlers'], [CAMP, 'Camp trainers', 'camp trainers']].forEach(([sysId, Who, who], i) => {
      if (!ctx.byId.has(sysId)) return;
      bag.add(sysId, {
        role: 'customer', tier: TIER.legendIcon, pdfDrawn: true, ambiguous: amb, ambiguity: icon && icon.ambiguity ? icon.ambiguity : null,
        caveat: amb ? CAVEAT.card(ctx, self.id, cardIcon && cardIcon.sharedWith) : null,
        order: arr(self.drawn).indexOf(icon) + i / 2, live: liveMakes.length > 0 || !!ctx.recipe(self.id).service, cargo: said, works: liveMakes, service: !said.length,
        reason: said.length
          ? fit(ctx, (n) => Who + ' buy your ' + nameList(ctx, said, n), i && svcAll[1] ? [youSay(svcAll[1]), cardUse] : [cardUse, useFor(ctx, sysId, said)])
          : fit(ctx, () => Who + ' are who ' + me + ' is for', i && svcAll[1] ? [svcAll[1], service] : service),
        note: liveMakes.length ? (liveMakes.length < myMakes.length ? NOTE.liveFor(nameList(ctx, liveMakes)) : NOTE.live)
          : (ctx.recipe(self.id).service && ctx.isLive(self.id) ? 'Works today — as a service' : (ctx.isLive(self.id) ? plannedNote(ctx, self.id, self.id, sysId, myMakes) : NOTE.notBuilt(me))),
        dev: 'Legend card "Good For Battlers and camp training".' + (amb ? ' The card sits between two tiles on p8 (ambiguity A), so it may belong to the neighbour.' : ''),
        cite: 'PDF legend: Good For Battlers and camp training',
      });
    });
  }
  for (const sysId of [CITY, CAMP, BATTLE, BUSINESS]) {
    if (self.kind === 'service' || !arr(ctx.recipe(self.id).sellsTo).includes(sysId)) continue;
    const wants = new Map(ctx.needs(sysId).map((n) => [n.id, n]));
    const hit = ctx.tradeMakes(self.id).filter((m) => wants.has(m.id));
    if (!hit.length && sysId !== BUSINESS) continue;
    if (sysId === BUSINESS && !ctx.recipe(self.id).service) continue;
    const first = hit[0] ? wants.get(hit[0].id) : null;
    const st = hit.length ? tradeStatus(ctx, self.id, self.id, sysId, hit.map((m) => m.id), 'undrawn') : null;
    /* cargo that works today leads the sentence, so the chip and the first name agree */
    if (st) hit.sort((a, b) => Number(st.works.includes(b.id)) - Number(st.works.includes(a.id)));
    const isLive = st ? st.live : ctx.isLive(self.id);
    bag.add(sysId, {
      role: 'customer', tier: TIER.undrawn, pdfDrawn: false, live: isLive, works: st ? st.works : undefined, service: !st, cargo: hit.map((m) => m.id),
      reason: hit.length
        ? fit(ctx, (n) => ctx.label(sysId) + ' players buy your ' + nameList(ctx, hit.map((m) => m.id), n), useFor(ctx, sysId, hit.map((m) => m.id)))
        : fit(ctx, () => ctx.label(sysId) + ' players pay for what ' + me + ' does', serviceClause(ctx.recipe(self.id).service)),
      note: st ? st.note : (ctx.isLive(self.id) ? NOTE.live : NOTE.notBuilt(me)),
      dev: 'recipes.js sellsTo; not an icon the owner drew.' + (first && first.why ? ' Need: ' + first.why : ''),
    });
  }
  const loot = ctx.lootNeeds(self.id);
  if (loot.length) {
    const all = uniq(ctx.needs(self.id).map((n) => n.id)).length;
    const liveLoot = loot.filter((n) => n.live);
    const ids = liveFirst(loot).map((n) => n.id);
    bag.add(BATTLE, {
      /* A service tile (Bank, Warehouse) consumes no goods: its loot list is build
         materials only, and round two ranked "Battle System drops reinforced
         concrete" as the Bank's third-best partner, above every borrower. With
         nothing live in it, cargo count no longer lifts it past a live service. */
      rankOnly: self.kind === 'service' && !liveLoot.length,
      role: 'supplier', tier: TIER.undrawn, pdfDrawn: false, live: liveLoot.length > 0, cargo: ids, works: liveLoot.map((n) => n.id),
      reason: fit(ctx, (n) => 'Battle System drops ' + nameList(ctx, ids, n), /* round 5: eighteen rows led with "N of the M things X uses can be won in
           fights" — a formula. What the first drop is FOR leads now; the count
           survives only where the data has no use sentence */
        [...ids.slice(0, ctx.maxNames).map((x) => useFor(ctx, self.id, [x])), 'battlers win ' + (loot.length === all ? 'everything' : loot.length + ' of the ' + all + ' things') + ' ' + me + ' uses in fights']),
      note: liveLoot.length ? NOTE.liveFor(nameList(ctx, liveLoot.map((n) => n.id))) : 'Planned — ' + me + ' does not consume loot yet',
      dev: 'Hand-placed battle and camp loot (catalogue handLoot). ' + (liveLoot.length ? 'The rest is the owner\'s "every business needs loot" rule, switched off.' : 'PLANNED: none of these is consumed by the shipped operation yet.'),
      cite: 'PDF p2: Best Buyers: Business Players',
    });
  }

  /* 5 ── shared cargo with tiles the owner did NOT connect. Counted, never
        ranked above ink: this is what tier 3 is for.
        Round one listed EVERY maker of every wanted id: Restaurant got five
        separate "makes metal" suppliers (one of them the Car Dealer) and three
        "makes food", Car Dealer got eight "uses your metal" customers. Now, per
        cargo id: nothing at all if a drawn lane already carries it that way;
        otherwise the NATURAL partner — a tile the owner's lanes already show
        shipping (or buying) that id to someone — and only when the map has no
        such tile, the best few by live-first then by how central the product is
        to the maker. */
  const wanted = new Map();
  for (const n of ctx.needs(self.id)) if (!wanted.has(n.id)) wanted.set(n.id, n);
  for (const u of arr(ctx.recipe(self.id).upkeep)) if (!wanted.has(u.id)) wanted.set(u.id, { id: u.id, live: true, role: 'input', why: '' });
  const supply = new Map(), demand = new Map();
  const put = (map, tileId, row) => { if (!map.has(tileId)) map.set(tileId, []); map.get(tileId).push(row); };
  const lanesAll = allLanes(ctx);
  for (const [resId, need] of wanted) {
    if (laneIn.has(resId)) continue;
    const makers = [];
    for (const t of ctx.tiles) {
      if (t.id === self.id || pdfPeers.has(t.id)) continue;
      const at = ctx.tradeMakes(t.id).findIndex((m) => m.id === resId);
      if (at < 0) continue;
      const m = ctx.tradeMakes(t.id)[at];
      makers.push({ tile: t.id, at, live: !!(m.live && need.live), natural: lanesAll.some((l) => l.from === t.id && l.ids.includes(resId)) });
    }
    /* a drawn peer that makes it counts as the natural maker too, and then
       nobody undrawn is offered for this id */
    if (Array.from(pdfPeers).some((p) => ctx.tradeMakes(p).some((m) => m.id === resId) && lanesAll.some((l) => l.from === p && l.ids.includes(resId)))) continue;
    const natural = makers.filter((x) => x.natural);
    const pool = (natural.length ? natural : makers).sort((a, b) => Number(b.live) - Number(a.live) || a.at - b.at || (a.tile < b.tile ? -1 : 1));
    for (const x of pool.slice(0, natural.length ? 1 : ctx.perCargo)) put(supply, x.tile, { id: resId, live: x.live, need });
  }
  for (const m of ctx.tradeMakes(self.id)) {
    if (laneOut.has(m.id)) continue;
    const buyers = [];
    for (const { by, row } of (ctx.neededBy.get(m.id) || [])) {
      const n = ctx.byId.get(by);
      if (!n || n.nodeKind !== 'tile' || by === self.id || pdfPeers.has(by)) continue;
      buyers.push({ tile: by, row, live: !!(m.live && row.live), natural: lanesAll.some((l) => l.to === by && l.ids.includes(m.id)) });
    }
    buyers.sort((a, b) => Number(b.live) - Number(a.live) || Number(b.natural) - Number(a.natural) || (a.tile < b.tile ? -1 : 1));
    for (const x of buyers.slice(0, ctx.perCargo)) put(demand, x.tile, { id: m.id, live: x.live, need: x.row });
  }
  /* Dojo, Card Shop and the Airport had five rows and no answer to "where do my
     inputs come from": most of what they use is made by no business on the map.
     That is worth saying once, on the Marketplace row, naming the inputs — live
     ones first, since those are bought there today (battlers sell their loot).
     noWeight: a second line must not lift the Marketplace over the truck. */
  if (ctx.byId.has(MARKET)) {
    const orphans = liveFirst(Array.from(wanted.values()).filter((n) => !laneIn.has(n.id) && !ctx.tiles.some((t) => ctx.tradeMakes(t.id).some((m) => m.id === n.id))));
    const lootIds = new Set(ctx.lootNeeds(self.id).map((n) => n.id));
    const liveIds = orphans.filter((n) => n.live).map((n) => n.id).sort((a, b) => Number(lootIds.has(b)) - Number(lootIds.has(a)));
    const ids = (liveIds.length ? liveIds : orphans.map((n) => n.id));
    /* the planned version is only worth a row where the card has no Marketplace
       row at all; on a tile that already lists goods there it would be noise */
    const hasMarketRow = !!(self.icons && self.icons.market) || arr(ctx.recipe(self.id).sellsTo).includes(MARKET);
    if (ids.length && (liveIds.length || !hasMarketRow)) {
      const isLive = liveIds.length > 0 && ctx.isLive(self.id);
      bag.add(MARKET, { role: 'channel', tier: TIER.undrawn, pdfDrawn: false, noWeight: true, last: true, live: isLive, cargo: ids, works: isLive ? ids : [],
        reason: isLive
          ? fit(ctx, (n) => 'Marketplace is where you buy ' + nameList(ctx, ids, n), [...(ids.slice(0, ctx.maxNames).every((x) => lootIds.has(x)) ? ['no business on the map makes ' + (ids.length > 1 ? 'them' : 'it') + ', so battlers selling loot are your source'] : []), 'no business on the map makes ' + (ids.length > 1 ? 'them' : 'it')])
          : fit(ctx, (n) => 'Marketplace is where you would buy ' + nameList(ctx, ids, Math.min(n, ctx.maxNames - 1)), 'planned inputs that no business on the map makes yet'),
        note: isLive ? 'Works today — the resource market settles instantly'
          : ctx.isLive(self.id) ? fitNote(ctx, (n) => 'Planned — ' + me + ' doesn\'t use ' + chipList(ctx, ids, n) + ' yet', 2) : NOTE.notBuilt(me),
        dev: 'Needs with no maker among the 27 tiles (coverage.js needs vs recipes.js makes); not an icon the owner drew.' });
    }
  }
  for (const [id, rows] of supply) {
    const r = liveFirst(rows);
    /* no reason to give = no row (see liveUse) */
    if (!useFor(ctx, self.id, r.map((x) => x.id))) continue;
    const st = tradeStatus(ctx, self.id, id, self.id, r.map((x) => x.id), 'undrawn');
    bag.add(id, { role: 'supplier', tier: TIER.undrawn, pdfDrawn: false, live: st.live, works: st.works, cargo: r.map((x) => x.id),
      reason: fit(ctx, (n) => ctx.label(id) + ' sells ' + nameList(ctx, r.map((x) => x.id), n), r.map((x) => useFor(ctx, self.id, [x.id]))),
      note: st.note,
      dev: 'Not a lane the owner drew. ' + ctx.resName(r[0].id) + ': ' + String(r[0].need.why || 'recipes.js upkeep') });
  }
  for (const [id, rows] of demand) {
    const r = liveFirst(rows);
    if (!useFor(ctx, id, r.map((x) => x.id))) continue;
    const st = tradeStatus(ctx, self.id, self.id, id, r.map((x) => x.id), 'undrawn');
    bag.add(id, { role: 'customer', tier: TIER.undrawn, pdfDrawn: false, live: st.live, works: st.works, cargo: r.map((x) => x.id),
      reason: fit(ctx, (n) => ctx.label(id) + ' buys your ' + nameList(ctx, r.map((x) => x.id), n), r.map((x) => useFor(ctx, id, [x.id]))),
      note: st.note,
      dev: 'Not a lane the owner drew. ' + ctx.resName(r[0].id) + ': ' + String(r[0].need.why || '') });
  }

  /* Round 5: a partner already on the card can ALSO trade something undrawn with
     you that works today. Construction's card said "Oil Company buys your metal {Works
     today}" (undrawn, green) while Oil's card led its Construction row with the
     drawn asphalt lane (Planned) and never mentioned the metal, because a drawn
     peer was skipped by the undrawn pass and the cargo was already "spoken for"
     by the Mining lane. The pair therefore led with different relationships. Every
     partner already on the card (drawn, or an undrawn supplier/customer) now
     gets its other working trades as extra weightless lines, and the bag lets
     the working line lead the row on both cards. */
  for (const p of uniq([...pdfPeers, ...supply.keys(), ...demand.keys()])) {
    const pt = ctx.byId.get(p);
    if (!pt || pt.nodeKind !== 'tile' || !ctx.isLive(p) || !ctx.isLive(self.id)) continue;
    const laneIds = new Set([...arr((laneBetween(ctx, p, self.id) || {}).ids), ...arr((laneBetween(ctx, self.id, p) || {}).ids), ...arr(supply.get(p)).map((x) => x.id), ...arr(demand.get(p)).map((x) => x.id)]);
    const sup = Array.from(wanted.keys()).filter((resId) => !laneIds.has(resId) && tradeState(ctx, p, self.id, resId) === 'works');
    const dem = ctx.tradeMakes(self.id).map((m) => m.id).filter((id) => !laneIds.has(id) && tradeState(ctx, self.id, p, id) === 'works');
    if (sup.length && useFor(ctx, self.id, sup)) {
      const st = tradeStatus(ctx, self.id, p, self.id, sup, 'undrawn');
      bag.add(p, { role: 'supplier', tier: TIER.undrawn, pdfDrawn: false, noWeight: true, live: st.live, works: st.works, cargo: sup,
        reason: fit(ctx, (n) => ctx.label(p) + ' sells ' + nameList(ctx, sup, n), sup.map((x) => useFor(ctx, self.id, [x]))),
        note: st.note, dev: 'Not a lane the owner drew; a working trade beside the drawn one.' });
    }
    if (dem.length && useFor(ctx, p, dem)) {
      const st = tradeStatus(ctx, self.id, self.id, p, dem, 'undrawn');
      bag.add(p, { role: 'customer', tier: TIER.undrawn, pdfDrawn: false, noWeight: true, live: st.live, works: st.works, cargo: dem,
        reason: fit(ctx, (n) => ctx.label(p) + ' buys your ' + nameList(ctx, dem, n), dem.map((x) => useFor(ctx, p, [x]))),
        note: st.note, dev: 'Not a lane the owner drew; a working trade beside the drawn one.' });
    }
  }
  /* 6 ── services. */
  financier(ctx, bag, self);
  storage(ctx, bag, self, myMakes);
  if (self.id === BANK) bankBorrowers(ctx, bag);
  if (self.id === WAREHOUSE) warehouseTenants(ctx, bag);
  if (self.kind === 'cityTransit') transitPartners(ctx, bag, self);
  if (self.kind === 'service' || self.kind === 'cityTransit') {
    for (const sysId of arr(ctx.recipe(self.id).sellsTo)) {
      if (!ctx.byId.has(sysId) || self.kind === 'cityTransit') continue;
      /* The caption is printed on the map, so it ranks as the owner's ink. */
      bag.add(sysId, { role: 'customer', tier: self.caption ? TIER.legendIcon : TIER.undrawn, pdfDrawn: !!self.caption, live: ctx.isLive(self.id), cargo: [],
        /* Round 9: the Bank sells to two systems and both rows came out
           "… are who Bank serves — it funds businesses and players", byte for
           byte, naming neither cargo nor anything a player could act on — the
           thinnest card in the set. The map caption stays first (it is the
           owner's ink), with the blurb's detail half behind it, so dedupeWhy()
           gives the second row what the business actually DOES ("a chartered
           player bank takes deposits and its tellers underwrite loans"). */
        reason: fit(ctx, () => ctx.label(sysId) + ' players are who ' + me + ' serves',
          [serviceClause(self.caption), detailClause(ctx.recipe(self.id).service), serviceClause(ctx.recipe(self.id).service)]),
        note: ctx.isLive(self.id) ? 'Works today — as a service' : NOTE.notBuilt(me),
        dev: (self.caption ? 'Owner\'s caption: "' + self.caption + '". ' : '') + (ctx.ship.SERVICES[self.id] || '') });
    }
  }
  return bag;
}

/* Startup standing among every tile the caller's opEcon knows. */
function startupTable(ctx) {
  const rows = [];
  for (const t of ctx.tiles) {
    /* The Bank is left out of its own league table: it never borrows from itself,
       and counting it made a tile "6th dearest" on its own card and "5th" on the Bank's. */
    const e = t.opId && t.id !== BANK ? ctx.econ(t.opId) : null;
    if (e && typeof e.startup === 'number' && isFinite(e.startup)) rows.push({ id: t.id, startup: e.startup });
  }
  rows.sort((a, b) => b.startup - a.startup);
  const med = median(rows.map((r) => r.startup));
  return { rows, median: med, upperMedian: median(rows.filter((r) => r.startup > med).map((r) => r.startup)) };
}
function financier(ctx, bag, self) {
  if (self.id === BANK || !ctx.byId.has(BANK)) return;
  const tab = startupTable(ctx);
  const at = tab.rows.findIndex((r) => r.id === self.id);
  if (at < 0 || tab.median === null || !(tab.rows[at].startup > tab.median)) return;
  bag.add(BANK, { role: 'financier', tier: TIER.undrawn, live: true, cargo: [],
    reason: 'Bank lends the Cinder to open ' + ctx.label(self.id) + ' — ' + (at === 0 ? 'it is the most expensive licence on the map'
      /* "pricier than most (12th of 24)" was wrong: 12th of 24 is the middle.
         No new number: the split is the median of the dearer half. */
      : tab.rows[at].startup > tab.upperMedian ? 'its licence is pricier than most (' + ordinal(at + 1) + ' of ' + tab.rows.length + ')'
        : 'its licence is mid-priced (' + ordinal(at + 1) + ' of ' + tab.rows.length + ') but still dearer than half the map') + '.',
    note: 'Works today — player banks write loans',
    dev: 'opEcon startup above the median of all priced tiles, read live; it lends Cinder, not cargo, so nothing rides a truck.',
    cite: 'opEcon(' + self.id + ').startup against the median of all tiles, read live' });
}
function bankBorrowers(ctx, bag) {
  const tab = startupTable(ctx);
  /* Bank is priced too; numbering it left a hole ("3rd, 5th") in its own list. */
  tab.rows.filter((r) => r.id !== BANK && r.startup > tab.median).forEach((r, i) => {
    /* only what the borrower sells TODAY can repay a loan today */
    const makes = ctx.tradeMakes(r.id).filter((m) => m.live).map((m) => m.id);
    /* rankOnly + order: round one let cargo count and a second shared-cargo
       entry reorder these, so the list read "9th, 10th, 11th dearest ... 1st
       dearest at rank 12". The licence rank the sentence cites IS the order. */
    bag.add(r.id, { role: 'customer', service: true, tier: TIER.undrawn, live: true, cargo: makes.slice(0, ctx.maxNames), order: i, rankOnly: true,
      reason: fit(ctx, (n) => ctx.label(r.id) + ' founders borrow from you — ' + (i === 0 ? 'the most expensive licence on the map' : 'the ' + ordinal(i + 1) + ' most expensive licence') + (makes.length ? ', repaid from ' + nameList(ctx, makes, Math.min(n, 2)) + ' sales' : ''), ''),
      note: 'Works today — player banks write loans',
      dev: 'Borrowers = tiles whose live opEcon startup is above the map median, dearest first.' });
  });
}

/* "Bulky": cargo that shipping.js puts in a tanker, hopper or stock wagon, or a
   product list longer than the median producer's. */
function bulkOf(ctx, tileId) {
  /* a shelf holds what exists: planned products are named only by a tile that
     makes nothing yet (its chip then says so) */
  const allMakes = liveFirst(ctx.tradeMakes(tileId));
  const makes = allMakes.some((m) => m.live) ? allMakes.filter((m) => m.live) : allMakes;
  const bulk = makes.map((m) => ({ id: m.id, d: ctx.ship.cargoClassDetail(m.id) })).filter((x) => x.d.cargoClass !== 'freight');
  return { makes: makes.map((m) => m.id), bulk };
}
function makesMedian(ctx) {
  return median(ctx.tiles.map((t) => ctx.tradeMakes(t.id).length).filter((n) => n > 0));
}
/* Two true reasons to rent a shelf, best first. Both are given because the
   Warehouse's card lists every tenant, and round 8 had it say "bulk loads pile
   up faster than a truck clears them" three times and "it makes 3 different
   products and each needs a shelf" three more: dedupeWhy() now takes the second
   reason for the repeats instead of the same sentence again. The product-count
   sentence is true of any tile with more than one product, bulky or not. */
function bulkWhy(ctx, bulk, count, who) {
  const many = count > 1 ? (who === 'you' ? 'you make ' : 'it makes ') + count + ' different products and each needs a shelf' : '';
  return bulk.length ? ['bulk loads pile up faster than a truck clears them', many].filter(Boolean) : [many].filter(Boolean);
}
function storage(ctx, bag, self, myMakes) {
  if (self.id === WAREHOUSE || !ctx.byId.has(WAREHOUSE) || !myMakes.length) return;
  const { bulk, makes: held } = bulkOf(ctx, self.id);
  const many = held.length > makesMedian(ctx);
  if (!bulk.length && !many) return;
  const ids = bulk.length ? bulk.map((x) => x.id) : held;
  bag.add(WAREHOUSE, { role: 'storage', tier: TIER.undrawn, live: true, cargo: ids,
    reason: fit(ctx, (n) => 'Warehouse holds your ' + nameList(ctx, ids, n) + ' between hauls', bulkWhy(ctx, bulk, held.length, 'you')),
    note: 'Works today — storage is rented player to player',
    dev: bulk.length ? 'shipping.js cargoClass ' + bulk[0].d.cargoClass + ': ' + bulk[0].d.why : 'Makes more distinct products than the median producer.',
    cite: 'shipping.js cargoClass; PDF p8 Warehouse caption' });
}
function warehouseTenants(ctx, bag) {
  const med = makesMedian(ctx);
  for (const t of ctx.tiles) {
    if (t.id === WAREHOUSE) continue;
    const { makes, bulk } = bulkOf(ctx, t.id);
    if (!bulk.length && !(makes.length > med)) continue;
    const ids = bulk.length ? bulk.map((x) => x.id) : makes;
    bag.add(t.id, { role: 'customer', service: true, tier: TIER.undrawn, live: true, cargo: ids,
      reason: fit(ctx, (n) => ctx.label(t.id) + ' rents your space for ' + nameList(ctx, ids, n), bulkWhy(ctx, bulk, makes.length, 'it')),
      note: 'Works today — storage is rented player to player',
      dev: bulk.length ? 'shipping.js cargoClass ' + bulk[0].d.cargoClass : 'Makes more distinct products than the median producer.' });
  }
}
function transitPartners(ctx, bag, self) {
  const rule = ctx.p9;
  const upkeep = arr(ctx.recipe(self.id).upkeep).map((u) => u.id);
  /* A planned transit tile has no shipped upkeep; of its proposed needs only the
     running ones are "burned to run the route" — build materials are not. */
  const running = ctx.needs(self.id).filter((n) => n.role === 'input' || n.role === 'upkeep').map((n) => n.id);
  const needIds = upkeep.length ? upkeep : (running.length ? running : ctx.needs(self.id).map((n) => n.id));
  for (const sysId of [CITY, CAMP]) {
    /* service: the cargo here is what the route BURNS, not goods sold to the city */
    bag.add(sysId, { role: 'customer', service: true, tier: TIER.legendIcon, pdfDrawn: true, live: sysId === CITY && ctx.isLive(self.id), cargo: sysId === CITY ? needIds : [], order: sysId === CITY ? 0 : 1,
      reason: sysId === CITY
        ? fit(ctx, (n) => 'City Builder is your only customer — it pays for the route and you burn ' + (needIds.length ? nameList(ctx, needIds, Math.min(n, 2)) : 'fuel') + ' to run it', '')
        : 'Camp is where your passengers come from — a city needs a bus, train or airport before it can hire from its camps.',
      note: sysId === CITY ? (ctx.isLive(self.id) ? 'Works today — unlocks stops and routes' : NOTE.notBuilt(ctx.label(self.id))) : 'Planned — the rule that a city needs transit to hire from camps is not enforced yet',
      dev: sysId === CITY ? '"These companies work only for the city" (p9).' : 'Owner\'s p9 hiring rule; not enforced (decision ' + ((rule && rule.ownerDecision) || 'D5') + ').',
      cite: 'PDF p9 rule text' });
  }
}

/* ════════════════════════ SYSTEMS AND CHANNELS ═══════════════════════════════ */
/* What one system hands the next. No id is typed here: each set is derived from
   the sibling data, so a recipes/coverage/loot change moves it. */
/* Round 3 let these lists name cloth, ammo and stone under a green chip. The
   list is now built from what is made AND spent in the shipped game whenever
   that is non-empty (`.allLive` tells the caller which list it got). */
function systemCargo(ctx, from, to) {
  const live = systemCargoPass(ctx, from, to, true);
  if (live.length) { live.allLive = true; return live; }
  const any = systemCargoPass(ctx, from, to, false);
  any.allLive = false;
  return any;
}
function systemCargoPass(ctx, from, to, liveOnly) {
  const count = new Map();
  const bump = (id) => count.set(id, (count.get(id) || 0) + 1);
  if (from === BATTLE || from === CAMP) {
    /* loot the businesses need, most-wanted first */
    for (const t of ctx.tiles) for (const n of ctx.lootNeeds(t.id)) if (!liveOnly || (n.live && ctx.isLive(t.id))) bump(n.id);
    if (from === CAMP && to !== BUSINESS) count.clear();
  }
  if (!count.size) {
    /* p4 prints "Trainers/Battlers" as one buyer; Battle has no needs list of its
       own in coverage.js, so it borrows the Camp's (what a battler's units eat). */
    const wantRows = ctx.needs(to).length ? ctx.needs(to) : (to === BATTLE ? ctx.needs(CAMP) : []);
    const wants = new Set(wantRows.filter((n) => !liveOnly || n.live).map((n) => n.id));
    for (const t of ctx.tiles) for (const m of (from === CITY ? ctx.makes(t.id).filter((x) => x.via === 'cityFirm') : ctx.tradeMakes(t.id))) if (wants.has(m.id) && (!liveOnly || (m.live && ctx.isLive(t.id)))) bump(m.id);
    if (!count.size && !liveOnly) for (const id of wants) bump(id);
  }
  return Array.from(count.entries()).sort((a, b) => b[1] - a[1]).map((e) => e[0]).slice(0, ctx.SC.hover.maxNeeds * 2);
}

/* How many drawn lanes touch a tile — "how central is it", from the map alone. */
function laneDegree(ctx, tileId) { return allLanes(ctx).filter((l) => l.from === tileId || l.to === tileId).length; }

function systemPartners(ctx, self) {
  const bag = makeBag(ctx, self.id);
  const me = ctx.label(self.id);
  arr(self.bestBuyersNodes).forEach((to, i) => {
    const cargo = systemCargo(ctx, self.id, to);
    bag.add(to, { role: 'customer', service: true, works: cargo.allLive ? cargo : [], tier: TIER.needsIcon, pdfDrawn: true, live: true, cargo: cargo.allLive ? cargo : [], order: i,
      reason: fit(ctx, (n) => ctx.label(to) + ' players are your best buyers — they buy ' + (cargo.allLive ? nameList(ctx, cargo, n) : 'what ' + me + ' produces'), ''),
      note: NOTE.p2p,
      dev: 'p' + self.page + ': "Best Buyers: ' + self.bestBuyers + '". Player-to-player on the Marketplace; nothing forces it.',
      cite: 'PDF p' + self.page + ' Best Buyers' });
  });
  for (const f of ctx.flows) {
    if (f.to !== self.id) continue;
    const cargo = systemCargo(ctx, f.from, self.id);
    bag.add(f.from, { role: 'supplier', service: true, works: cargo.allLive ? cargo : [], tier: f.drawn ? TIER.needsIcon : TIER.farSideOpen, pdfDrawn: !!f.drawn, ambiguous: !f.drawn, caveat: f.drawn ? null : CAVEAT.noArrow, ambiguity: f.ambiguity || null, live: true, cargo: cargo.allLive ? cargo : [],
      reason: fit(ctx, (n) => ctx.label(f.from) + ' feeds ' + me + ' with ' + (cargo.allLive ? nameList(ctx, cargo, n) : 'resources'), 'sold for Cinder on the Marketplace'),
      note: NOTE.p2p,
      dev: f.drawn ? 'Arrow drawn on p1 with "Market Place Resources" and a Cinder flame over it.' : 'No arrow is drawn for this on p1; the Camp page only says units "bring back resources" (ambiguity J).',
      cite: 'PDF p1 arrow' });
  }
  const out = arr(self.bestBuyersNodes)[0];
  const outCargo = out ? systemCargo(ctx, self.id, out) : Object.assign([], { allLive: false });
  bag.add(MARKET, { role: 'channel', tier: TIER.legendIcon, pdfDrawn: true, live: true, cargo: outCargo.allLive ? outCargo : [], works: outCargo.allLive ? outCargo : [],
    reason: fit(ctx, (n) => 'Marketplace is where ' + me + ' players sell ' + (outCargo.allLive ? nameList(ctx, outCargo, n) : 'their output') + ' for Cinder', ''),
    note: 'Works today — the resource market settles instantly',
    dev: 'Marketplace trio is drawn over every arrow on p1.',
    cite: 'PDF p1 trio over each arrow' });

  for (const t of ctx.tiles) {
    const rec = ctx.recipe(t.id);
    const makes = liveFirst(ctx.tradeMakes(t.id));
    const makeIds = makes.map((m) => m.id);
    if (self.id === BATTLE || self.id === CAMP) {
      if (t.icons && t.icons.card) {
        const whom = self.id === BATTLE ? 'battlers ' : 'camps ';
        const liveIds = makes.filter((m) => m.live).map((m) => m.id);
        const cardIcon = arr(t.drawn).find((x) => x.icon === 'card');
        bag.add(t.id, { role: 'supplier', tier: TIER.legendIcon, pdfDrawn: true, ambiguous: t.icons.card === '?', ambiguity: t.icons.card === '?' ? 'A' : null,
          caveat: t.icons.card === '?' ? CAVEAT.card(ctx, t.id, cardIcon && cardIcon.sharedWith) : null,
          /* same rule as the tile's own card: goods are named only when some are
             made today, otherwise the row is about the service */
          live: ctx.isLive(t.id), cargo: (liveIds.length || !rec.service) ? makeIds : [], works: liveIds, service: !(liveIds.length || !rec.service),
          reason: makeIds.length && (liveIds.length || !rec.service)
            ? fit(ctx, (n) => ctx.label(t.id) + ' sells ' + whom + nameList(ctx, makeIds, n), cardWhy(ctx, t.id))
            : fit(ctx, () => ctx.label(t.id) + ' is built for ' + whom.trim(), serviceClause(rec.service)),
          note: !ctx.isLive(t.id) ? NOTE.notBuilt(ctx.label(t.id)) : liveIds.length ? (liveIds.length < makeIds.length ? NOTE.liveFor(nameList(ctx, liveIds)) : NOTE.live) : 'Works today — as a service',
          dev: 'Carries the legend card "Good For Battlers and camp training".' + (t.icons.card === '?' ? ' The card sits between two tiles on p8 (ambiguity A).' : '') });
      }
      const loot = self.id === BATTLE ? liveFirst(ctx.lootNeeds(t.id)) : [];
      if (loot.length) {
        const liveLoot = loot.filter((n) => n.live).map((n) => n.id);
        bag.add(t.id, { role: 'customer', tier: TIER.undrawn, live: liveLoot.length > 0, works: liveLoot, cargo: loot.map((n) => n.id),
          reason: fit(ctx, (n) => ctx.label(t.id) + ' owners buy your drops: ' + nameList(ctx, loot.map((x) => x.id), n), activeFirst(loot.map((x) => useFor(ctx, t.id, [x.id])))),
          note: liveLoot.length && ctx.isLive(t.id) ? NOTE.liveFor(nameList(ctx, liveLoot)) : (ctx.isLive(t.id) ? 'Planned — ' + ctx.label(t.id) + ' does not consume loot yet' : NOTE.notBuilt(ctx.label(t.id))),
          dev: 'coverage.js lootNeedsOf over catalogue handLoot. ' + String(loot[0].why || '') });
      }
    }
    if (self.id !== BATTLE && self.id !== BUSINESS && arr(rec.sellsTo).includes(self.id)) {
      const wants = new Map(ctx.needs(self.id).map((n) => [n.id, n]));
      const hit = makes.filter((m) => wants.has(m.id));
      if (t.kind === 'cityTransit') {
        bag.add(t.id, { role: 'carrier', tier: TIER.legendIcon, pdfDrawn: true, live: ctx.isLive(t.id), cargo: [],
          /* Round 9: the p9 rule is ONE rule about three companies, so writing it
             out on all three rows told a player the same thing three times. It
             stays first (it is the map's own rule, and the row a player reads
             first should carry it); the transit company's own blurb follows, so
             dedupeWhy() gives the second and third rows what THAT company does
             ("it unlocks bus stops and routes …") instead of the rule again. */
          reason: fit(ctx, () => ctx.label(t.id) + ' moves people, not cargo',
            ['a city needs a bus, train or airport before it can hire from its camps', detailClause(rec.service), serviceClause(rec.service)]),
          note: ctx.isLive(t.id) ? 'Works today — the hiring rule itself is planned' : NOTE.notBuilt(ctx.label(t.id)),
          dev: 'p9 rule text; hiring rule not enforced.' });
      } else if (hit.length) {
        const st = tradeStatus(ctx, self.id, t.id, self.id, hit.map((m) => m.id), 'undrawn');
        hit.sort((a, b) => Number(st.works.includes(b.id)) - Number(st.works.includes(a.id)));
        const w = wants.get(hit[0].id);
        bag.add(t.id, { role: 'supplier', tier: TIER.undrawn, live: st.live, works: st.works, cargo: hit.map((m) => m.id),
          reason: fit(ctx, (n) => ctx.label(t.id) + ' supplies ' + me + ' with ' + nameList(ctx, hit.map((m) => m.id), n), useFor(ctx, self.id, hit.map((m) => m.id))),
          note: st.note,
          dev: 'recipes.js sellsTo + coverage.js need. ' + String(w.why || '') });
      }
    }
    if (self.id === BUSINESS && t.id !== TRANSPORT && t.id !== BANK && t.id !== WAREHOUSE) {
      /* Round one's Business System list was six rows and named none of its own
         27 tiles. They are its members rather than its trading partners, so they
         sit in the undrawn tier, most-connected first, each saying what it adds. */
      const buyers = uniq(allLanes(ctx).filter((l) => l.from === t.id).map((l) => ctx.label(l.to)));
      const svc = t.caption || rec.service;
      /* what it DOES first, the category it belongs to second (round 7) */
      const caption = [detailClause(svc), serviceClause(t.caption) || serviceClause(rec.service)].filter(Boolean);
      /* Ten of these rows were green over ammo, concrete, contraband, trucks —
         things the member does not make yet. A live member is described by what
         it makes TODAY; if that is nothing, by its service or what it buys. */
      const liveIds = makes.filter((m) => m.live).map((m) => m.id);
      const named = ctx.isLive(t.id) ? liveIds : makeIds;
      const buyersOf = uniq(allLanes(ctx).filter((l) => l.from === t.id && l.ids.some((x) => named.includes(x))).map((l) => ctx.label(l.to)));
      bag.add(t.id, { role: 'supplier', service: true, works: liveIds, tier: TIER.undrawn, live: ctx.isLive(t.id), cargo: named, order: -laneDegree(ctx, t.id), rankOnly: true,
        reason: named.length
          ? fit(ctx, (n) => ctx.label(t.id) + ' is one of its businesses — it makes ' + nameList(ctx, named, n) + ((buyersOf.length ? buyersOf : buyers).length ? ' for ' + (buyersOf.length ? buyersOf : buyers).slice(0, 2).join(' and ') : ''), '')
          : fit(ctx, (n) => ctx.label(t.id) + ' is one of its businesses', caption.length ? caption : (arr(rec.buys).length ? 'it buys ' + nameList(ctx, arr(rec.buys).flatMap((l) => l.ids), 2) + ' from ' + uniq(arr(rec.buys).map((l) => ctx.label(l.from))).slice(0, 2).join(' and ') : '')),
        note: ctx.isLive(t.id) ? NOTE.live : NOTE.notBuilt(ctx.label(t.id)),
        dev: 'Member tile of the Business System (p6-p9); ordered by drawn-lane count ' + laneDegree(ctx, t.id) + '.' });
    }
  }
  if (self.id === BUSINESS) {
    bag.add(TRANSPORT, { role: 'carrier', tier: TIER.legendIcon, pdfDrawn: true, live: true, cargo: [],
      reason: 'Transport carries every business\'s cargo — pickup, haul, depot, deliver; no business ships straight to another.',
      note: NOTE.optional,
      dev: 'Transport sits top-centre on p6, p7 and p8. ' + ctx.ship.RULE.text + ' LIVE but OPTIONAL today, except hospital pharma wholesale and plague-cure waybills.' });
    for (const id of [BANK, WAREHOUSE]) {
      const n = ctx.byId.get(id); if (!n) continue;
      bag.add(id, { role: id === BANK ? 'financier' : 'storage', tier: TIER.undrawn, live: true, cargo: [],
        reason: fit(ctx, () => ctx.label(id) + (id === BANK ? ' lends the Cinder that opens new businesses' : ' stores what businesses make between hauls'), serviceClause(n.caption)),
        note: id === BANK ? 'Works today — player banks write loans' : 'Works today — storage is rented player to player',
        dev: 'Owner\'s caption: "' + n.caption + '". ' + (ctx.ship.SERVICES[id] || '') });
    }
  }
  return bag;
}

function channelPartners(ctx, self) {
  const bag = makeBag(ctx, self.id);
  const key = self.iconKey;
  for (const t of ctx.tiles) {
    if (!(t.icons && t.icons[key])) continue;
    const icon = arr(t.drawn).find((x) => x.icon === key);
    const makes = liveFirst(ctx.tradeMakes(t.id));
    const liveIds = makes.filter((m) => m.live).map((m) => m.id);
    const amb = !!(icon && icon.ambiguity === 'D');
    /* Same rule as the tile side: the Car Marketplace trades vehicles, and the
       catalogue (family 'vehicle') says which products those are. */
    const vehicles = self.id === CARMARKET ? uniq(ctx.makes(t.id).map((m) => m.id).filter((id) => ctx.family(id) === 'vehicle')) : [];
    const listed = vehicles.length ? vehicles : makes.map((m) => m.id);
    const noVehicle = self.id === CARMARKET && !vehicles.length;
    /* who the listing is FOR, from the drawn lanes — a bare "lists fuel here" told a
       player nothing they could act on */
    const buyers = uniq(allLanes(ctx).filter((l) => l.from === t.id && l.ids.some((i) => listed.includes(i))).map((l) => ctx.label(l.to)));
    bag.add(t.id, { markOnly: noVehicle, role: 'supplier', tier: TIER.legendIcon, pdfDrawn: true, ambiguous: amb, ambiguity: amb ? 'D' : null, caveat: amb ? CAVEAT.leftover(ctx, self.id, t.id) : null,
      live: ctx.isLive(t.id) && (self.id === MARKET ? liveIds.length > 0 : vehicles.length > 0), cargo: noVehicle ? [] : listed,
      service: true, itemTrade: self.id === CARMARKET && vehicles.length > 0, works: self.id === CARMARKET ? vehicles.filter((v) => ctx.makes(t.id).some((m) => m.id === v && m.live)) : liveIds,
      /* word for word the tile's own card (section 3 of tilePartners), including
         the legend reading — see the long note at the tile-side `noVehicle`. The
         two sides used to disagree in voice ("makes no vehicle" here vs "takes
         vehicles, not your fuel" there), which is how the false claim survived a
         round: each side read as a different fact. */
      reason: noVehicle
        ? fit(ctx, () => ctx.label(t.id) + ' carries the tow-truck mark, and the legend reads a mark as a market that tile depends on to earn', liveIds.length ? [2, 1].map((k) => 'vehicles on the road are what keep its ' + nameList(ctx, liveIds, k) + ' selling') : '')
        : fit(ctx, (n) => ctx.label(t.id) + ' lists ' + (listed.length ? nameList(ctx, listed, n) : 'its service') + ' here', buyers.length ? 'bought by ' + buyers.slice(0, 2).join(' and ') : 'open to every player who needs it'),
      note: self.id === MARKET ? (liveIds.length ? (liveIds.length < listed.length ? NOTE.liveFor(nameList(ctx, liveIds)) : NOTE.live) : (ctx.isLive(t.id) ? 'Planned — nothing ' + ctx.label(t.id) + ' makes can be listed yet' : NOTE.notBuilt(ctx.label(t.id))))
        : (vehicles.length ? 'Works today — vehicles trade as items, not as hauled cargo' : 'Planned — the tow truck is drawn, but no lane behind it is built yet'),
      dev: 'The ' + self.label + ' icon is drawn beside it on p' + t.page + '.' + (amb ? ' That icon may be a copy-paste leftover (ambiguity D), so it is shown but never ranked first.' : '') });
  }
  if (self.id === MARKET) {
    for (const s of ctx.systems) {
      /* only what is both spent and made today: "ammo" led Camp's list and no
         business makes ammo yet */
      const wants = uniq(ctx.needs(s.id).filter((n) => n.live && ctx.madeAnywhere(n.id)).map((n) => n.id));
      /* The Battle System and Just Business have no need list of their own, and
         round 7 gave both of them the same empty sentence — "players buy here
         with the Cinder they earn", the only two reasons on any card that named
         neither a cargo nor a service. A system with nothing to BUY still has
         something to SELL, and that is the side of the counter a player reading
         the Marketplace's card cares about: battlers bring their drops in,
         operators bring their yields in. Both lists are derived, live-first, and
         are the same ids the tiles' own cards already name. */
      const sells = wants.length ? [] : (s.id === BUSINESS
        ? uniq(ctx.tiles.flatMap((t) => (ctx.isLive(t.id) ? ctx.tradeMakes(t.id).filter((m) => m.live).map((m) => m.id) : [])))
        : uniq(liveFirst(ctx.tiles.flatMap((t) => ctx.lootNeeds(t.id))).map((n) => n.id)));
      const sellVerbClause = s.id === BUSINESS ? ' players list what their operations turn out here' : ' players sell the drops they carry out of a fight here';
      bag.add(s.id, { role: sells.length ? 'supplier' : 'customer', service: true, tier: TIER.legendIcon, pdfDrawn: true, live: true,
        cargo: (wants.length ? wants : sells).slice(0, ctx.SC.hover.maxNeeds),
        reason: wants.length
          ? fit(ctx, (n) => ctx.label(s.id) + ' players buy here — ' + nameList(ctx, wants, n) + ' among the things they use', '')
          : sells.length
          ? fit(ctx, (n) => ctx.label(s.id) + sellVerbClause + ' — ' + nameList(ctx, sells, n), 'the Cinder they take away is what they spend on everyone else\'s goods')
          : ctx.label(s.id) + ' players trade here for Cinder',
        note: 'Works today — the resource market settles instantly',
        dev: 'Every arrow between systems on p1 carries the Marketplace icon and a Cinder flame.' });
    }
  }
  if (self.id === CARMARKET) {
    /* Round one stopped at the sellers (6 rows). The BUYERS are on the map too:
       every lane whose cargo is a vehicle item ends at a tile that shops here,
       and p3's prose names who the dealer sells to. All derived, no id typed. */
    const isVehicle = (id) => ctx.family(id) === 'vehicle';
    for (const l of allLanes(ctx)) {
      const v = l.ids.filter(isVehicle);
      if (!v.length || !ctx.byId.has(l.to)) continue;
      const lane = laneBetween(ctx, l.from, l.to);
      bag.add(l.to, { role: 'customer', tier: TIER.undrawn, live: false, cargo: v,
        reason: fit(ctx, (n) => ctx.label(l.to) + ' shops here for ' + nameList(ctx, v, n), lane ? playerClause(lane.why) : ''),
        note: 'Planned — vehicles are not hauled as cargo yet',
        dev: 'Derived from the vehicle-cargo lane ' + l.from + ' to ' + l.to + ' in recipes.js; not a Car Marketplace icon on that tile.' });
    }
    /* Round 9: rank 1 on this card read "Car Dealer shops here for cars and
       vehicle parts — the Car Factory builds vehicles", and the Car Factory was
       on none of the card's rows. The PDF's own worked example (p1/p3: "a car
       dealership purchases vehicles from a car factory") names the supplier
       behind this market, so a player reading it should see who that is. The
       row is derived, not typed: the maker at the other end of any vehicle lane
       whose buyer IS drawn on this market, and only when the maker is not drawn
       here itself. It is PLANNED — the factory's shipped operation yields no
       vehicle yet, and the dealer is the one with the tow truck. */
    for (const l of allLanes(ctx)) {
      const v = l.ids.filter(isVehicle);
      const to = ctx.byId.get(l.to), from = ctx.byId.get(l.from);
      if (!v.length || !to || !from || from.nodeKind !== 'tile') continue;
      if (!(to.icons && to.icons[key]) || (from.icons && from.icons[key])) continue;
      bag.add(l.from, { role: 'supplier', tier: TIER.undrawn, live: false, cargo: v,
        reason: fit(ctx, (n) => ctx.label(l.from) + ' builds the ' + nameList(ctx, v, n) + ' ' + ctx.label(l.to) + ' lists here',
          ['it sells to ' + ctx.label(l.to) + ', who is the one drawn on this market', playerClause((laneBetween(ctx, l.from, l.to) || {}).why)]),
        note: 'Planned — ' + ctx.label(l.from) + ' doesn\'t produce ' + nameList(ctx, v, 2) + ' yet',
        dev: 'Derived: the vehicle lane ' + l.from + ' to ' + l.to + ' in recipes.js, where only ' + l.to + ' carries the Car Marketplace icon. PDF worked example p1/p3.' });
    }
    const sold = uniq(ctx.tiles.flatMap((t) => (t.icons && t.icons[key] ? ctx.makes(t.id).map((m) => m.id).filter(isVehicle) : [])));
    if (sold.length) {
      for (const [sysId, why] of [[BATTLE, 'battlers buy vehicles for battles and delivery missions'], [CITY, 'a growing city keeps buying fleet vehicles']]) {
        if (!ctx.byId.has(sysId)) continue;
        bag.add(sysId, { role: 'customer', service: true, itemTrade: true, works: sold.filter((v) => ctx.tiles.some((t) => ctx.makes(t.id).some((m) => m.id === v && m.live))), tier: TIER.undrawn, live: sysId === BATTLE, cargo: sold,
          reason: fit(ctx, (n) => ctx.label(sysId) + ' players buy ' + nameList(ctx, sold, n) + ' here', why),
          note: sysId === BATTLE ? 'Works today — vehicles trade as items, not as hauled cargo' : 'Planned — ' + ctx.label(sysId) + ' has no way to buy vehicles yet',
          dev: sysId === BATTLE ? 'p3 prose: the dealership "sells them to players for battles and delivery missions".' : 'Derived: City Builder is the Business System\'s Best Buyer (p3); no vehicle purchase exists in the city builder today.' });
      }
    }
  }
  bag.add(TRANSPORT, { role: 'carrier', tier: TIER.undrawn, live: true, cargo: [],
    reason: 'Transport delivers what is sold here — the last leg of pickup, haul, depot, deliver for buyers with no depot of their own.',
    note: NOTE.optional,
    dev: 'shipping.js route legs; LIVE but OPTIONAL today.' });
  return bag;
}

/* ════════════════════════════ PUBLIC API ═════════════════════════════════════ */
/**
 * Ranked partners for a tile, system or channel. Never throws; an unknown id
 * returns []. `opts.limit` trims the list (views use SC.partners.maxShown); on a
 * tile that ships cargo the trimmed list always carries the Transport carrier row:
 * in place when it ranks inside the list, otherwise APPENDED as a footer
 * (`footer: true`, `guaranteed: true`, true `rank`, `footerNote`). The list is
 * longer than the limit when a tile has more direct links than that, so a drawn
 * neighbour is never cut and the numbered part never skips — see shortlist().
 * Row: { id, label, role, roles, score, rawScore, rank, tier, tierLabel,
 *        reasons[]   player sentences, one per relationship, length-capped,
 *        lines[]     { role, text, statusNote, live, cargo, worksCargo, supplier, consumer,
 *                      itemTrade, hauling, haulLegs, caveat } — reasons with roles. worksCargo =
 *                      the ids the green chip vouches for; supplier/consumer are node ids on a
 *                      goods trade and null on hauling, loans, storage and membership lines;
 *                      hauling lines carry haulLegs[{ id, dir:'in'|'out', from:[ids], works }],
 *        statusNote  player status ("Works today" / "Planned — ..."),
 *        caveat      player note when the map leaves the link open, else null,
 *        devNote     audit trail (pages, ambiguities, decisions) — never shown,
 *        cargo[], live, status, pdfDrawn, pinned, ambiguous, ambiguity,
 *        enforcedToday, cite }
 */
export function bestPartners(nodeId, data, opts) {
  try {
    const ctx = context(data);
    const self = ctx.byId.get(String(nodeId));
    if (!self) return [];
    const bag = self.nodeKind === 'tile' ? tilePartners(ctx, self)
      : self.nodeKind === 'system' ? systemPartners(ctx, self)
        : channelPartners(ctx, self);
    return rank(ctx, bag.rows(), { limit: opts && opts.limit, selfId: self.id });
  } catch (err) { return [degradedRow(nodeId, data, err)]; }
}

/* An empty list is not an honest answer to "who should I work with". modal.js
   paints [] as "No partner ranked: this tile trades with nobody on the map yet"
   — a confident sentence about the MAP for what is in fact a sibling module
   that failed to load, and this is not hypothetical: graph.js was broken for a
   whole round while every card kept saying it. One row instead, which says the
   true thing and is obviously not a partner: role 'channel' (a valid role, so
   no view has to learn a new one), never live, no cargo to act on, and
   `degraded: true` + `error` for a view or a gate that wants to say more. */
function degradedRow(nodeId, data, err) {
  let label = '';
  try { const n = context(data).byId.get(String(nodeId)); if (n && n.label) label = n.label; } catch (_) { /* the map is what failed */ }
  /* With the map unreadable the id is usually all there is, and an id is not a
     name a player knows — say "this business" rather than print "medical". */
  const text = 'The map could not be read just now, so no partner can be ranked for ' + (label || 'this business') + ' — try again in a moment.';
  return {
    id: '', label: 'Partners unavailable', role: 'channel', roles: ['channel'],
    score: 0, rawScore: 0, rank: 1, tier: TIER.undrawn, tierLabel: TIER_LABEL[TIER.undrawn],
    reasons: [text],
    lines: [{ role: 'channel', text, statusNote: 'Not a verdict about this business — the supply-chain data failed to load', live: false, cargo: [], worksCargo: [], supplier: null, consumer: null, itemTrade: false, hauling: false, haulLegs: null, caveat: null }],
    cargo: [], live: false, status: 'proposed', anyLive: false,
    statusNote: 'Not a verdict about this business — the supply-chain data failed to load',
    caveat: null, pdfDrawn: false, pinned: false, ambiguous: false, ambiguity: null, enforcedToday: false,
    degraded: true, error: String((err && err.message) || err || 'unknown'),
    devNote: 'DEGRADED: bestPartners threw. ' + String((err && err.stack) || err || ''), cite: null,
  };
}

/**
 * The top rows of the same ranking, already fitted, for a HOVER card — the one
 * the owner asked for ("hovering over businesses shows a modal"). It exists
 * because a hover card that derives its own order of businesses is a SECOND
 * answer to the question the click modal already answers: round 8 measured the
 * two disagreeing on 10 of 22 cards (hovering Medical said line up Research
 * first, clicking it said Fashion Brand — the owner's own cloth lane). A view
 * that renders this cannot disagree with the modal, because it is the same
 * list, cut to `SC.partners.digestRows`.
 * Returns { id, label, rows[{ id, label, role, text, statusNote, live, cargo }],
 *           total, more, degraded }. Never throws.
 */
export function partnersDigest(nodeId, data, opts) {
  const o = opts || {};
  let all = [];
  try { all = arr(bestPartners(nodeId, data)); } catch (err) { all = [degradedRow(nodeId, data, err)]; }
  let label = String(nodeId), n = FALLBACK.digestRows;
  try {
    const ctx = context(data);
    const self = ctx.byId.get(String(nodeId));
    if (self) label = ctx.label(self.id);
    n = o.limit || (ctx.P && ctx.P.digestRows) || FALLBACK.digestRows;
  } catch (_) { /* fall through on the fallback count */ }
  /* the footer carrier row is the modal's device for not cutting the truck out
     of a long list; on two rows it would just take a slot from a real partner */
  const rows = all.filter((r) => !r.footer).slice(0, Math.max(1, n));
  return {
    id: String(nodeId), label,
    rows: rows.map((r) => ({
      id: r.id, label: r.label, role: r.role,
      /* the line the row LEADS with, already inside the length cap */
      text: arr(r.reasons)[0] || (arr(r.lines)[0] || {}).text || '',
      statusNote: r.statusNote || '', live: !!r.live, cargo: arr(r.cargo).slice(),
    })),
    total: all.length, more: Math.max(0, all.length - rows.length),
    degraded: !!(all[0] && all[0].degraded),
  };
}

/**
 * "Competes with": tiles that make the same product. A shared product that only
 * exists inside the simulated city on BOTH sides is not competition for a
 * player and is left out. City-only transit companies compete on the p9 rule
 * instead (any ONE of them satisfies it).
 */
export function competesWith(nodeId, data, opts) {
  try {
    const ctx = context(data);
    const self = ctx.byId.get(String(nodeId));
    if (!self || self.nodeKind !== 'tile') return [];
    const mine = new Map(ctx.tradeMakes(self.id).map((m) => [m.id, m]));
    const out = [];
    for (const t of ctx.tiles) {
      if (t.id === self.id) continue;
      const shared = liveFirst(ctx.tradeMakes(t.id).filter((m) => mine.has(m.id)));
      if (shared.length) {
        const both = shared.filter((m) => m.live && mine.get(m.id).live).map((m) => m.id);
        const ids = shared.map((m) => m.id);
        out.push({ id: t.id, label: ctx.label(t.id), shared: ids, live: both.length > 0,
          reason: fit(ctx, (n) => ctx.label(t.id) + ' also makes ' + nameList(ctx, ids, n), 'you sell to the same buyers'),
          statusNote: both.length ? (both.length < ids.length ? NOTE.liveFor(nameList(ctx, both)) : NOTE.live)
            : !ctx.isLive(t.id) ? NOTE.notBuilt(ctx.label(t.id)) : !ctx.isLive(self.id) ? NOTE.notBuilt(ctx.label(self.id))
              : fitNote(ctx, (n) => 'Planned — ' + (mine.get(ids[0]).live ? ctx.label(t.id) : ctx.label(self.id)) + ' doesn\'t produce ' + nameList(ctx, ids, n) + ' yet'),
          devNote: both.length ? 'Both sides yield it in the shipped game.' : 'PLANNED on at least one side.' });
      } else if (self.kind === 'cityTransit' && t.kind === 'cityTransit') {
        out.push({ id: t.id, label: ctx.label(t.id), shared: [], live: false,
          reason: ctx.label(t.id) + ' does the same job — a city needs only one of bus, train or airport to hire from its camps.',
          statusNote: 'Planned — the rule that a city needs transit to hire from camps is not enforced yet', devNote: 'p9 rule text.' });
      }
    }
    out.sort((a, b) => Number(b.live) - Number(a.live) || b.shared.length - a.shared.length || (a.id < b.id ? -1 : 1));
    const limit = (opts && opts.limit) || ctx.P.maxShown;
    return out.slice(0, limit);
  } catch (_) { return []; }
}

/**
 * Worst fit: goods tiles with which this one shares NOTHING — no link on the
 * map, no product either needs. Round one sorted these alphabetically, so Card
 * Shop, Car Dealer and Construction turned up for every tile: a list, not a
 * ranking. Now the distance is measured: how many resource FAMILIES (the
 * catalogue's own grouping) the two tiles' makes-and-needs have in common. The
 * fewest shared families first, and only the few a player would find telling.
 */
export function worstFit(nodeId, data, opts) {
  try {
    const ctx = context(data);
    const self = ctx.byId.get(String(nodeId));
    if (!self || self.nodeKind !== 'tile' || self.kind !== 'producer') return [];
    const linked = new Set(bestPartners(nodeId, data).map((p) => p.id));
    /* bestPartners caps undrawn rows per cargo, so "not listed" no longer means
       "nothing to trade": the Cannery makes food Medical burns even though the
       farm is the one listed. Any shared cargo at all disqualifies a worst fit. */
    const iNeed = new Set([...ctx.needs(self.id).map((n) => n.id), ...arr(ctx.recipe(self.id).upkeep).map((u) => u.id)]);
    const iMake = new Set(ctx.tradeMakes(self.id).map((m) => m.id));
    const trades = (t) => ctx.tradeMakes(t).some((m) => iNeed.has(m.id)) || ctx.needs(t).some((n) => iMake.has(n.id));
    const rivals = new Set(competesWith(nodeId, data, { limit: ctx.tiles.length }).map((p) => p.id));
    const fams = (id) => new Set([...ctx.tradeMakes(id).map((m) => m.id), ...ctx.needs(id).map((n) => n.id)].map(ctx.family).filter(Boolean));
    const myFams = fams(self.id);
    /* How many deals apart two tiles sit on the owner's drawn lanes. Round 3
       ranked by shared resource families alone and one sentence template, so
       Mining was told Gas Station is a poor fit — two deals away through the Oil
       Company. Distance comes first now, a tile two deals away or closer is never
       a poor fit, and the sentence states the measured distance and who the other
       tile really sells to. */
    const dist = new Map([[self.id, 0]]);
    for (let frontier = [self.id]; frontier.length;) {
      const next = [];
      for (const a of frontier) for (const l of allLanes(ctx)) {
        const b = l.from === a ? l.to : l.to === a ? l.from : null;
        if (b && !dist.has(b)) { dist.set(b, dist.get(a) + 1); next.push(b); }
      }
      frontier = next;
    }
    const me = ctx.label(self.id);
    const out = [];
    for (const t of ctx.tiles) {
      /* Only goods producers: Bank, Warehouse and city transit sit outside the
         goods chain for EVERY tile, so listing them says nothing about this one. */
      if (t.id === self.id || linked.has(t.id) || rivals.has(t.id) || t.kind !== 'producer' || trades(t.id)) continue;
      const hops = dist.has(t.id) ? dist.get(t.id) : Infinity;
      /* a neighbour's neighbour is one introduction away, not a poor fit */
      if (hops < ((ctx.SC.partners && ctx.SC.partners.worstFitMinHops) || FALLBACK.worstFitMinHops)) continue;
      /* Round 5: "Card Shop sells printed cards" stood here while Card Shop's own
         card says it does not produce them yet. "sells" is for what is made
         today; a tile that makes nothing yet is described by its service, else
         by what it PLANS to sell. */
      const liveMakes = ctx.tradeMakes(t.id).filter((m) => m.live).map((m) => m.id);
      const theirMakes = liveMakes.length ? liveMakes : liveFirst(ctx.tradeMakes(t.id)).map((m) => m.id);
      const overlap = Array.from(fams(t.id)).filter((f) => myFams.has(f));
      const buyers = uniq(allLanes(ctx).filter((l) => l.from === t.id && l.ids.some((x) => theirMakes.includes(x))).map((l) => ctx.label(l.to))).slice(0, 2);
      const service = serviceClause(ctx.recipe(t.id).service).replace(/^it /, '');
      /* Round 6: a long service blurb ("holds the Card Shop licence: your own
         storefront selling cards to battlers") filled the line on its own, so
         fit() dropped the distance clause on all 19 producer tiles and a licence
         blurb sat under "Poor fit" with no why. The blurb now shortens with n
         (its clause cuts), so the reason a tile is a poor fit always survives. */
      const svcCuts = service ? clauseCuts(service) : [];
      const svcAt = (n) => svcCuts[Math.min(svcCuts.length - 1, Math.max(0, ctx.maxNames - n))];
      const lead = (n) => ctx.label(t.id) + ' ' + (liveMakes.length
        ? 'sells ' + nameList(ctx, theirMakes, Math.min(n, 2)) + (buyers.length ? ' to ' + buyers.join(' and ') : '')
        : service ? svcAt(n)
          : theirMakes.length ? 'plans to sell ' + nameList(ctx, theirMakes, Math.min(n, 2)) + (buyers.length ? ' to ' + buyers.join(' and ') : '')
            : 'sells a service, not cargo');
      const gap = hops === Infinity ? 'no chain of deals on the map connects it to ' + me
        : 'it sits ' + hops + ' deals away from ' + me + ' on the map';
      const why = [gap + ', and neither of you makes what the other uses', gap];
      out.push({ id: t.id, label: ctx.label(t.id), live: ctx.isLive(t.id), sharedFamilies: overlap, hops: hops === Infinity ? null : hops, distance: -overlap.length,
        reason: fit(ctx, lead, why),
        devNote: 'No drawn icon, no shared cargo; ' + (hops === Infinity ? 'unreachable' : hops + ' lanes away') + '; ' + overlap.length + ' shared resource families' + (overlap.length ? ' (' + overlap.join(', ') + ')' : '') + '.' });
    }
    out.sort((a, b) => (b.hops === null ? Infinity : b.hops) - (a.hops === null ? Infinity : a.hops) || a.sharedFamilies.length - b.sharedFamilies.length || Number(b.live) - Number(a.live) || (a.id < b.id ? -1 : 1));
    const limit = (opts && opts.limit) || (ctx.SC.partners && ctx.SC.partners.worstFitShown) || FALLBACK.worstFitShown;
    return out.slice(0, limit);
  } catch (_) { return []; }
}

/** Everything the modal's "Best partners" section needs, in one call. */
export function partnerReport(nodeId, data, opts) {
  const o = opts || {};
  /* Same reason as bestPartners' degraded row: a view calling this must get a
     shape it can render, not an exception, when the map fails to load. */
  let ctx;
  try { ctx = context(data); } catch (err) {
    const row = degradedRow(nodeId, data, err);
    return { id: String(nodeId), best: [row], all: [row], competesWith: [], worstFit: [], isCargoTile: false,
      haulingClients: [], hasMoneyAdvice: false, opEconSeen: false, moneyAdvice: null, degraded: true };
  }
  const all = bestPartners(nodeId, data);
  if (all.length === 1 && all[0].degraded) {
    return { id: String(nodeId), best: all, all, competesWith: [], worstFit: [], isCargoTile: false,
      haulingClients: [], hasMoneyAdvice: false, opEconSeen: false, moneyAdvice: null, degraded: true };
  }
  const bankRow = all.find((p) => p.role === 'financier') || null;
  return {
    id: String(nodeId),
    best: shortlist(ctx, String(nodeId), all, o.limit || ctx.P.maxShown),
    all,
    competesWith: competesWith(nodeId, data, o),
    worstFit: worstFit(nodeId, data, o),
    isCargoTile: shipsCargo(ctx, String(nodeId)),
    /* Transport only: ids of every row that carries a "pays you to haul" line, in rank order */
    haulingClients: all.filter((p) => p.lines.some((l) => l.hauling && l.role !== 'carrier')).map((p) => p.id),
    /* Round two's hasMoneyAdvice meant "the caller passed an opEcon" and was true
       beside a null moneyAdvice on 20 of 33 nodes — a view guarding on it and
       reading .text throws. It now means exactly what it says. opEconSeen carries
       the old meaning: with it true, no Bank row MEANS "no loan needed" rather
       than "nobody could tell". */
    hasMoneyAdvice: !!bankRow,
    opEconSeen: typeof (data && data.opEcon) !== 'undefined' && data.opEcon !== null,
    moneyAdvice: bankRow ? { text: bankRow.reasons[0], statusNote: bankRow.statusNote } : null,
  };
}

/**
 * The assertion the round-1 critic asked for, shipped with the module so the
 * audit piece and any view test can call it: every player-facing string on every
 * node is free of audit vocabulary (REASON_LEAK), within the length cap, not
 * hard-truncated, and non-empty. Returns [] when clean.
 */
export function auditReasons(data) {
  /* Round 9: this used to throw straight out at its caller, so the gate that
     runs it DIED instead of reporting — the one thing an audit must not do. A
     sibling module was broken for a whole round and that surfaced as a stack
     trace rather than as a finding. A throw is now a finding like any other,
     and a card that came back DEGRADED (bestPartners caught something) is a
     finding too, so no gate passes on a map that failed to load. */
  try { return auditReasonsInner(data); } catch (err) {
    return ['auditReasons could not run: ' + String((err && err.message) || err) + ' — the supply-chain data failed to load'];
  }
}
function auditReasonsInner(data) {
  const ctx = context(data);
  const fails = [];
  const check = (where, text, isNote, max) => {
    if (typeof text !== 'string' || !text.trim()) { fails.push(where + ': empty'); return; }
    if (REASON_LEAK.test(text)) fails.push(where + ': leaks audit wording: ' + text);
    const cap = max || ctx.maxChars;
    if (!isNote && text.length > cap) fails.push(where + ': ' + text.length + ' chars > ' + cap);
    if (text.includes('…')) fails.push(where + ': hard-truncated: ' + text);
    if (/undefined|null|NaN|\[object/.test(text)) fails.push(where + ': junk: ' + text);
  };
  /* Round 3: a status chip must agree with its live flag and must name what it
     is about. "Subject" = one of the two labels, a cargo name from the row, or
     one of the few things a chip can be about that is neither. */
  const chip = (w, selfId, r, note, live) => {
    if (typeof note !== 'string') return;
    if (note.length > ctx.maxChars) fails.push(w + ': chip ' + note.length + ' chars > ' + ctx.maxChars);
    if (!live && /^Works today/.test(note)) fails.push(w + ': not live but the chip says: ' + note);
    if (live && /^Planned/.test(note)) fails.push(w + ': live but the chip says: ' + note);
    if (/^Planned/.test(note)) {
      const subjects = [ctx.label(selfId), ctx.label(r.id), ...arr(r.cargo).map(ctx.resName)].filter(Boolean);
      if (!subjects.some((x) => note.includes(x)) && !/vehicles|loot|transit|truck/.test(note)) fails.push(w + ': planned chip names no subject: ' + note);
    }
  };
  /* Round 4: ONE RULE, asserted ACROSS cards. Every goods trade line on every
     card is filed under (supplier, buyer, cargo) and under (supplier, cargo);
     after the walk, no key may be vouched for by a green chip on one card and
     called planned, unused or unmade on another. Filed from the structured
     fields (worksCargo / cargo), and — independently — from the chip's own
     words, so a chip that SAYS "doesn't produce diesel" is caught even if the
     fields beside it are right. */
  const triples = new Map(), pairs = new Map();
  const file = (map, key, colour, where) => { if (!map.has(key)) map.set(key, { green: [], planned: [] }); map.get(key)[colour].push(where); };
  /* "recycled metal" contains "metal": blank the longer names before looking */
  const says = (note, c, cargo) => {
    const name = ctx.resName(c);
    let t = String(note);
    for (const o of cargo) { const on = ctx.resName(o); if (on !== name && on.includes(name)) t = t.split(on).join(' '); }
    return t.includes(name);
  };
  const green = (w, selfId, r, l) => {
    const isGreen = l.live && /^Works today/.test(l.statusNote);
    const works = arr(l.worksCargo), cargo = arr(l.cargo);
    if (isGreen && cargo.length) {
      if (!works.length) fails.push(w + ': green chip vouches for none of its cargo: ' + l.text);
      const scoped = /^Works today for /.test(l.statusNote);
      if (!scoped && works.length < cargo.length) fails.push(w + ': unscoped green chip over cargo that does not work today (' + cargo.filter((c) => !works.includes(c)).map(ctx.resName).join(', ') + '): ' + l.text);
      if (scoped && !works.some((c) => says(l.statusNote, c, cargo))) fails.push(w + ': scoped chip names none of the cargo it vouches for: ' + l.statusNote);
      if (!l.itemTrade) for (const c of works) {
        /* no green over a yield recipes.js marks live:false */
        const okMaker = l.supplier && ctx.byId.get(l.supplier).nodeKind === 'tile' ? madeLive(ctx, l.supplier, c)
          /* not a business's yield (battle loot, a system's flow): then it must at
             least be something a business spends in the shipped game */
          : (ctx.madeAnywhere(c) || (ctx.neededBy.get(c) || []).some((x) => x.row.live));
        if (!okMaker) fails.push(w + ': green chip over ' + ctx.resName(c) + ', which ' + (l.supplier ? ctx.label(l.supplier) : 'nobody') + ' does not yield today');
      }
    }
    if (!l.supplier || !l.consumer || l.itemTrade) return;
    for (const c of cargo) {
      const colour = isGreen && works.includes(c) ? 'green' : 'planned';
      file(triples, l.supplier + ' > ' + l.consumer + ' : ' + c, colour, w);
      if (colour === 'green') file(pairs, l.supplier + ' : ' + c, 'green', w);
      else if (ctx.byId.get(l.supplier).nodeKind === 'tile' && !madeLive(ctx, l.supplier, c)) file(pairs, l.supplier + ' : ' + c, 'planned', w);
      /* the chip's own words */
/* only the words AFTER "doesn't produce": a two-part chip also names cargo the buyer merely doesn't use */
      if (/doesn't produce/.test(l.statusNote) && says(l.statusNote.split("doesn't produce")[1], c, cargo)) file(pairs, l.supplier + ' : ' + c, 'planned', w + ' (chip text)');
    }
  };
  /* Round 5: the one rule reaches the truck.
     (a) SAME CARD — a leg the carrier line vouches for must not be called
         Planned by every goods row about that same cargo in that same direction
         on the card, and the other way round: a leg it does not vouch for must
         not be green on the drawn supplier's own row.
     (b) CARD TO CARD — Transport's "pays you to haul" line for tile X carries
         exactly the cargo, the green subset, the live flag and the chip of X's
         own carrier line; and a green carrier line always has its twin. */
  const sameSet = (a, b) => a.length === b.length && a.slice().sort().join('|') === b.slice().sort().join('|');
  /* Round 7: a tile's hauling is TWO lines (inbound, outbound), so the twin on
     Transport's card is matched direction by direction. A direction is the key
     because that is the unit haulDirs() gives its own chip to. */
  const dirOf = (l) => (arr(l.haulLegs)[0] || {}).dir || 'in';
  const onTransport = new Map();
  const dirOrder = new Map();
  for (const r of bestPartners(TRANSPORT, data)) {
    const hs = r.lines.filter((l) => l.hauling && l.role !== 'carrier');
    for (const l of hs) onTransport.set(r.id + '/' + dirOf(l), l);
    if (hs.length) dirOrder.set(r.id, hs.map(dirOf).join(','));
  }
  const haulCheck = (id, rows) => {
    const node = ctx.byId.get(id);
    if (!node || node.nodeKind !== 'tile' || id === TRANSPORT) return;
    const row = rows.find((r) => r.id === TRANSPORT);
    const mine = row ? row.lines.filter((l) => l.hauling && l.role === 'carrier') : [];
    /* The two directions are written in the same ORDER on both cards, so the
       half that leads the partnership here leads it there too. Without this a
       tile could open with its planned inbound while Transport's card opens with
       the green outbound, and one partnership would read Planned on one card and
       Works today on the other — the round-4 contradiction, one level up. */
    if (mine.length && dirOrder.has(id) && mine.map(dirOf).join(',') !== dirOrder.get(id)) {
      fails.push(id + ': hauling directions are written ' + mine.map(dirOf).join(',') + ' here and ' + dirOrder.get(id) + ' on the Transport card');
    }
    for (const line of mine) haulLine(id, rows, line);
  };
  const haulLine = (id, rows, line) => {
    const isGreen = line.live && /^Works today/.test(line.statusNote);
    const goods = rows.flatMap((r) => r.lines.filter((l) => !l.hauling && !l.itemTrade).map((l) => ({ l, partner: r.id })));
    for (const g of arr(line.haulLegs)) {
      const vouched = isGreen && g.works && arr(line.worksCargo).includes(g.id);
      /* one id can ride both ways (Gas Station buys fuel in and sells fuel out):
         the chip vouches for the id when EITHER leg works; each leg is still
         held to its own direction's rows below */
      if (arr(line.haulLegs).some((x) => x.id === g.id && x.works) !== arr(line.worksCargo).includes(g.id)) fails.push(id + ' carrier: leg ' + g.id + ' and worksCargo disagree');
      const about = goods.filter(({ l, partner }) => arr(l.cargo).includes(g.id) && (g.dir === 'in'
        ? l.consumer === id && (!g.from.length || g.from.includes(l.supplier))
        : (l.supplier === id || (l.role === 'channel' && partner !== TRANSPORT))));
      if (!about.length) continue;
      const anyGreen = about.some(({ l }) => l.live && /^Works today/.test(l.statusNote) && arr(l.worksCargo).includes(g.id));
      if (vouched && !anyGreen) fails.push(id + ' carrier: green for hauling ' + ctx.resName(g.id) + ' ' + g.dir + ', but every goods row about it on the same card is Planned (' + about[0].partner + ')');
      if (!vouched && g.dir === 'in' && g.from.length && anyGreen) fails.push(id + ' carrier: hauling ' + ctx.resName(g.id) + ' in is not vouched for, but the supplier row on the same card is green (' + about[0].partner + ')');
    }
    /* (c) EVERY SUPPLIER NAMED — round 6: the truck line must name each tile an
           inbound leg starts at, on this card and on Transport's. */
    const suppliers = uniq(arr(line.haulLegs).filter((g) => g.dir === 'in').flatMap((g) => g.from));
    const named = (text, where) => { for (const sId of suppliers) { const lab = ctx.label(sId); if (!text.includes(lab)) fails.push(id + ' ' + where + ': hauls cargo in from ' + lab + ' but the line never names it: ' + text); } };
    named(line.text, 'carrier');
    const twin = onTransport.get(id + '/' + dirOf(line));
    if (twin) named(twin.text, 'on Transport card');
    if (!twin) { if (isGreen) fails.push(id + ': green carrier line has no hauling row on the Transport card'); return; }
    if (!sameSet(arr(twin.cargo), arr(line.cargo))) fails.push(id + ': Transport card hauls [' + twin.cargo.join(',') + '], own carrier row hauls [' + line.cargo.join(',') + ']');
    if (!sameSet(arr(twin.worksCargo), arr(line.worksCargo))) fails.push(id + ': Transport card is green for [' + twin.worksCargo.join(',') + '], own carrier row for [' + line.worksCargo.join(',') + ']');
    if (twin.live !== line.live || twin.statusNote !== line.statusNote) fails.push(id + ': hauling chip differs between the two cards: ' + twin.statusNote + ' / ' + line.statusNote);
  };
  for (const id of ctx.byId.keys()) {
    const rows = bestPartners(id, data);
    if (!rows.length) fails.push(id + ': no partners');
    const rep = partnerReport(id, data);
    /* the short list is numbered 1..n with no hole; only a flagged footer may follow */
    rep.best.filter((r) => !r.footer).forEach((r, i) => { if (r.rank !== i + 1) fails.push(id + ': best list jumps to rank ' + r.rank + ' at place ' + (i + 1)); });
    for (const r of rows) if (r.tier === TIER.needsIcon && !rep.best.some((b) => b.id === r.id)) fails.push(id + ': direct link ' + r.id + ' is cut from best');
    for (const r of rows) r.lines.forEach((l) => green(id + ' > ' + r.id, id, r, l));
    haulCheck(id, rows);
    if (rep.isCargoTile && !rep.best.some((r) => r.id === TRANSPORT && r.roles.includes('carrier'))) fails.push(id + ': ships cargo but Transport is not in best');
    if (rep.hasMoneyAdvice !== !!rep.moneyAdvice) fails.push(id + ': hasMoneyAdvice disagrees with moneyAdvice');
    for (const r of rows) {
      const w = id + ' > ' + r.id;
      chip(w, id, r, r.statusNote, r.live);
      r.lines.forEach((l) => chip(w + ' line', id, r, l.statusNote, l.live));
      if (!r.reasons.length) fails.push(w + ': no reasons');
      r.reasons.forEach((t) => check(w + ' reason', t, false, t === r.foldLineShown || t === r.foldLine ? ctx.foldMaxChars : 0));
      r.lines.forEach((l) => { check(w + ' line', l.text, false, l.foldNote ? ctx.foldMaxChars : 0); check(w + ' line.statusNote', l.statusNote, true); });
      check(w + ' statusNote', r.statusNote, true);
      check(w + ' tierLabel', r.tierLabel, true);
      if (r.caveat !== null) check(w + ' caveat', r.caveat, true);
    }
    for (const r of competesWith(id, data)) { check(id + ' competes ' + r.id, r.reason, false); check(id + ' competes note ' + r.id, r.statusNote, true); }
    /* round 6: a Poor-fit row is advice only while it says how far the tile sits
       (the r5 Card Shop rows were bare licence blurbs with no why) */
    for (const r of worstFit(id, data)) { check(id + ' worst ' + r.id, r.reason, false); if (!/deals away|no chain of deals/.test(r.reason)) fails.push(id + ' worst ' + r.id + ': no distance clause: ' + r.reason); }
    if (rows.some((r) => r.degraded)) fails.push(id + ': DEGRADED — bestPartners could not build this card: ' + String((rows.find((r) => r.degraded) || {}).error));
  }
  for (const [map, what] of [[triples, 'trade'], [pairs, 'supplier and cargo']]) for (const [key, v] of map) {
    if (v.green.length && v.planned.length) fails.push('contradiction on ' + what + ' ' + key + ': green on [' + v.green[0] + '], planned on [' + v.planned[0] + ']');
  }
  return fails;
}

export default bestPartners;
