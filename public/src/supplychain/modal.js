/* ═══════════════════════════════════════════════════════════════════════════
   🗂 SUPPLY CHAIN · modal.js — the CLICK modal for one tile.

   Two halves, on purpose:
     modalVM(id, data, opts)   PURE. Turns the graph + plan + partners into a
                               view-model with the owner's seven sections in
                               the owner's order. No DOM, no window; Node can
                               import it and a test can diff two VMs built from
                               two opEcon tables to prove the numbers move.
     openModal(root, vm, cb)   DOM. Paints the VM into ONE host inside `root`,
     closeModal()              wires Esc / backdrop / close / focus trap, and
                               routes every click to `cb` — the modal never
                               reaches the bridge or the scene itself.

   WHY THE VM CARRIES SENTENCES AND NOT JUST IDS. The bar is "a first-time
   player can answer, from the modal alone: what does it make, what do I need
   to start, who should I work with, is it for me". Those answers are prose
   with numbers in them, and the numbers are the game's (opEcon over the
   bridge, the fixture in Node). plan.js already does that arithmetic and
   words it; partners.js already ranks; this file must not re-derive either
   (a second copy of the payback formula is how two screens end up disagreeing
   about one business). The modal's own job is the honest LIVE / PLANNED
   ledger, the "where to find it" for every loot need, the route legs, and a
   layout a phone can scroll.

   WHY ONE HOST, RE-PAINTED. A partner click re-targets the modal
   (cb.onNavigate → the shell builds a new VM → openModal again). Stacking a
   second modal over the first was rejected: three clicks deep the player has
   three backdrops, three Esc presses, and the scene highlight underneath no
   longer matches the top card. openModal on an open host replaces its content
   and scrolls to the top; the backdrop, the trap and the restore-focus target
   are kept.

   WHAT THIS FILE NEVER DOES: spend, open a business, or write a number down.
   `SC.modal` (tuning.js) holds the only knobs (max width, list caps). Every
   figure printed here was read from the opEcon row that was INJECTED, and a
   tile with no row (fashion, airport, systems, channels, or no bridge) prints
   "not set" / "not a licence" — never 0 and never blank.

   Contract rule 3 in this file: every ledger row carries `live` and the
   painter prints the tag beside the words, not only in colour, so the split
   survives greyscale and a screen reader.
   ═══════════════════════════════════════════════════════════════════════════ */

import { SC } from './tuning.js';
import { planFor } from './plan.js';
import * as partnersMod from './partners.js';

/* ─────────────────────────────────────────────────────────────────────────
   tiny total helpers — every input may be hostile (no bridge, junk bridge)
   ───────────────────────────────────────────────────────────────────────── */
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const arr = (v) => (Array.isArray(v) ? v : []);
const str = (v, d = '') => (typeof v === 'string' && v ? v : d);
const safe = (f, d) => { try { const r = f(); return r === undefined ? d : r; } catch (e) { return d; } };
const fn = (v) => (typeof v === 'function' ? v : null);
const num = (v) => { const n = +v; return Number.isFinite(n) ? n : null; };
const uniq = (a) => Array.from(new Set(arr(a).filter(Boolean)));
const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
const MODAL = (SC && SC.modal) || {};
const MAX_RES = MODAL.maxResourcesShown || 24;
const MAX_PARTNERS = MODAL.maxPartners || 6;
const MAX_WIDTH = MODAL.maxWidth || 760;   // SC.modal.maxWidth; the fallback is the .cf-modal width, not a tuning of our own

/* 🔴 THE OWNER'S LEGEND, AS NODE IDS. Each of the four icons in the PDF legend
   (p6) names exactly ONE node on this map: the truck is the carrier, the two
   shop icons are the two counters, the card is the Battle System. The card's
   second audience (the Camp) is a row of its own in partners.js and rides the
   same icon, so pinning the battler row alone already answers the badge.
   WHY THIS EXISTS: see pinLegendPartners(). */
const LEGEND_NODE = Object.freeze({ transport: 'transport', market: 'ch:market', carMarket: 'ch:carmarket', card: 'sys:battle' });

/* WHY AN EMPTY COUNTER GETS A SENTENCE AND NOT A PRODUCT.
   The reason is the CHANNEL'S OWN (edge.scope.why, which data.js quotes from
   the PDF legend), so two tiles carrying the identical drawn icon — Agri and
   Home Feed both have CM(..., 'sure', {ambiguity:'D'}) — read identically.
   Nothing tile-specific goes in this string for exactly that reason: a count
   of the tile's out-of-scope products would make one icon read two ways.
   The closing clause is derived, not assumed: it is only true while the tile
   also carries the Marketplace icon, which is a fact of its own sellsTo. */
function counterScopeReason(edge, node) {
  const scope = isObj(edge) && isObj(edge.scope) ? edge.scope : null;
  const why = str(scope && scope.why);
  const alsoMarket = arr(node && node.sellsTo).indexOf('ch:market') >= 0;
  return (why ? why + ' ' : '') + 'Nothing this tile makes falls in that scope, so it has nothing of its own to list at that counter'
    + (alsoMarket ? ' — its goods sell on the Marketplace instead.' : '.');
}

/* The one sentence a COUNTER row in section 6 is allowed to say about itself.
   It is built from the same lane section 5 prints, so the two halves of the
   card cannot drift: live lane → the counter takes these goods; empty cargo →
   the counter's own scope sentence, word for word (that is why agri and feed,
   which carry the identical drawn icon, read identically in both sections).
   ⚠ THE "WORKS TODAY" CLAUSE. Two rows (Car Dealer's cars, Weapon Smith's
   weapon parts) really do trade at a counter today while the map records no
   live LANE to it — items change hands, they are not hauled — so partners.js
   is right and the lane flag is right at the same time. Printing "Works today"
   under a PLANNED mark made the row argue with its own badge, so the mark is
   explained instead. No cause is invented for it: this says only what the mark
   means, because a reason the map does not record would be a guess. */
function counterNote(p, lane, laneLive, label) {
  /* the counter is NAMED: a card can carry two of these rows (the Marketplace
     and the Car Marketplace), and two identical sentences on one screen read
     as a copy-paste rather than as two answers to two questions. */
  if (laneLive) return 'Works today — ' + (str(label) || 'this counter') + ' takes the goods on this row now; they are the cargo your lane to it carries.';
  const own = str(lane.counterReason) || str(p.statusNote);
  if (!own) return 'Planned';
  return /^works\b/i.test(own) ? own + ' — the map records no live lane to that counter, which is what the PLANNED mark on this row means.' : own;
}

/* 🔴 A BADGE IN THE HEADER IS A ROW IN SECTION 6.
   partners.js ranks a drawn BUSINESS icon (tier 0, "it needs that business")
   above a drawn LEGEND icon (tier 1), which is the right order — a named
   supplier is better advice than "you sell on the Marketplace". But the card
   only prints MODAL.maxPartners rows, and on 8 of the 21 icon-bearing tiles
   that cut fell through the legend: Mining Company wore a TRUCK and a
   MARKETPLACE badge in its header and then listed six partners containing
   neither, while "Best to make money" is the only advice the owner wrote
   against those icons. A card that badges an icon and then cannot say who it
   is contradicts the owner's own legend on one screen.
   The fix reserves a slot instead of raising the cap: the lowest-ranked
   visible row that is NOT itself a drawn legend icon steps out — an UNDRAWN
   row (nothing of the owner's ink on it) first.
   ⚠ WHAT THAT PREFERENCE ACTUALLY BUYS, MEASURED. On 7 of the 8 tiles this
   fires on there IS no undrawn row inside the cut — the top six are all
   business icons the owner drew — so a DRAWN row is what steps out (oil loses
   Mining Company, gas loses Car Factory, research loses Salvage Operation …).
   That is a real cost and it is written down here rather than implied away.
   It is still the lesser one: the tile's header badges the icon either way, so
   refusing to displace would leave the card badging a legend icon it cannot
   name anywhere below — the exact contradiction this function exists for —
   while the displaced supplier is still reachable (the card says how many
   partners exist, and every one of them has a card of its own). The rows that
   step out are reported as `displaced` so the view can say so.
   REJECTED: raising MODAL.maxPartners (every card grows, and the tiles that
   were already right pay for the tiles that were wrong); and re-ranking in
   partners.js (another piece owns that file, and sinking a named supplier
   under a counter would be worse advice everywhere else).
   The ranking the reader sees is the original one — a lifted row keeps its
   true rank number and is re-sorted back into place, so the numbers still
   read 1,2,3,5,9 rather than pretending the lift did not happen. */
function pinLegendPartners(all, badges, max) {
  const rows = arr(all);
  if (rows.length <= max) return { rows: rows.slice(), pinned: [], displaced: [] };
  const want = [];
  for (const k of Object.keys(LEGEND_NODE)) if (badges && badges[k]) want.push(LEGEND_NODE[k]);
  const wanted = (r) => !!r && want.indexOf(str(r.id)) >= 0;
  const out = rows.slice(0, max);
  const pinned = [];
  const displaced = [];
  for (const r of rows.slice(max)) {
    if (!wanted(r)) continue;
    let vi = -1;
    for (let i = out.length - 1; i >= 0; i--) if (!wanted(out[i]) && out[i] && out[i].pdfDrawn !== true) { vi = i; break; }
    if (vi < 0) for (let i = out.length - 1; i >= 0; i--) if (!wanted(out[i])) { vi = i; break; }
    if (vi < 0) break;   // every visible row is itself a drawn legend icon: nothing to trade away
    displaced.push(str(out[vi] && out[vi].id));
    out.splice(vi, 1);
    out.push(r);
    pinned.push(str(r.id));
  }
  const at = new Map(rows.map((r, i) => [r, i]));
  out.sort((a, b) => at.get(a) - at.get(b));
  return { rows: out, pinned, displaced };
}

/* 🔴 A BADGE THE RANKER NEVER EMITS IS STILL A BADGE — SO ANSWER IT FROM THE MAP.
   pinLegendPartners() above can only LIFT a row that bestPartners() happened to
   emit. It therefore had exactly one failure mode and round 3 walked straight
   into it: partners.js grew dropFoldedBadgeRows(), which removes a counter row
   whose whole content is an aside it has already printed elsewhere, and the
   four tow-truck tiles (oil, gas, agri, feed) went back to wearing a
   🚗 CAR MARKETPLACE badge in the header with zero Car Marketplace rows below
   it — the exact contradiction the lift exists to close, reopened by a
   neighbouring file with no gate noticing.
   The cure is to stop depending on the ranker for the four ids the owner's own
   legend names. When a drawn badge maps to a LEGEND_NODE that is absent from
   the ranked list, the row is SYNTHESISED here from the same
   `channel:<biz>><ch>` graph edge section 5 already reads — so the answer is
   the map's, not a fallback sentence invented in the view, and the two halves
   of the card cannot drift apart. Everything downstream (the lane override,
   counterNote, counterScopeReason for an empty counter, the chips) then runs
   on this row unchanged, which is why the synthesised row carries `cargo: []`
   and no statusNote of its own: EMPTY IS THE SIGNAL, not a hole to fill.
   The rows partners.js DOES emit keep coming from partners.js and are lifted
   by pinLegendPartners as before — this only fills a silence.
   Rank: the ranker gave it none, so it is not given a borrowed one. It sits
   one past the last ranked row and says in its own words why it is on the
   card, rather than claiming a place it did not earn.
   REJECTED: asking partners.js not to drop it (another piece's file, and its
   drop is right for the list it is ranking — the defect was this file having
   no answer of its own); and printing a bare header-only note instead of a row
   (a note cannot carry the lane's cargo, its live flag, or the counter's scope
   sentence, which is everything the reader actually asked the badge). */
const LEGEND_MARK = Object.freeze({ transport: 'truck', market: 'shop', carMarket: 'tow-truck', card: 'card' });
function synthLegendRows(all, node, nid, g, laneOf, labelOf) {
  const rows = arr(all);
  const badges = (node && node.badges) || {};
  const have = new Set(rows.map((r) => str(r && r.id)));
  /* 🔴 A BADGE ALREADY ANSWERED BY THE FOLD ASIDE IS NOT A SILENCE.
     partners.js does not merely drop a counter row it has folded: it hands the
     combined sentence to a VISIBLE row as `foldLine`, naming the folded ids in
     `foldIds`. Synthesising a row for one of those ids answered the badge
     twice, and the second answer was the worse one — a chipless "it has
     nothing of its own to list at that counter" row that also tripped the
     staleness test below (every folded id was now visible), so the GOOD
     sentence was suppressed and the bad row kept. Measured on the four
     tow-truck tiles: agri lost Genetics Lab and Smuggling, feed lost the
     Battle System (15 chips), and none of the four printed the aside.
     So: synthesise only where the list says NOTHING. */
  const foldCovered = new Set();
  for (const r of rows) {
    if (!r || !(str(r.foldLineShown) || str(r.foldLine))) continue;
    for (const x of arr(r.foldIds)) foldCovered.add(str(x));
  }
  const extra = [];
  for (const k of Object.keys(LEGEND_NODE)) {
    const id = LEGEND_NODE[k];
    if (!badges[k] || have.has(id) || foldCovered.has(id) || id === str(nid)) continue;
    have.add(id);
    const lane = laneOf.get(id) || null;
    /* A channel the tile does not even sell to has no edge at all; say only
       that, because a reason the map does not record would be a guess. */
    const noLane = !lane && id.indexOf('ch:') === 0;
    const why = `The owner drew the ${LEGEND_MARK[k]} mark beside this tile, so this card answers for ${labelOf(id) || id} here — the ranker does not list it.`;
    extra.push({
      id, label: labelOf(id) || id, role: id.indexOf('ch:') === 0 ? 'channel' : id === 'transport' ? 'carrier' : 'customer',
      roles: [id.indexOf('ch:') === 0 ? 'channel' : id === 'transport' ? 'carrier' : 'customer'],
      tierLabel: 'Drawn on the map', pdfDrawn: true, ambiguous: false, cargo: [],
      rank: rows.length + extra.length + 1, synthesised: true,
      live: lane ? lane.live !== false : false, anyLive: lane ? lane.live !== false : false,
      statusNote: noLane ? 'The map records no lane from this tile to that counter.' : '',
      reasons: [why],
    });
  }
  return extra.length ? rows.concat(extra) : rows;
}

/* Numbers are printed one way everywhere: thousands separators, up to two
   decimals for a rate, none for Cinder. A rate under 0.005 is shown as "<0.01"
   rather than "0" — a zero here would read as "burns nothing". */
export function fmtInt(n) { const v = num(n); return v === null ? '—' : Math.round(v).toLocaleString('en-US'); }
export function fmtRate(n) {
  const v = num(n); if (v === null) return '—';
  if (v !== 0 && Math.abs(v) < 0.005) return (v < 0 ? '>-0.01' : '<0.01');
  return v.toLocaleString('en-US', { maximumFractionDigits: 2 });
}
export function fmtHrs(h) {
  const v = num(h); if (v === null || v <= 0) return '—';
  if (v < 1) return Math.round(v * 60) + ' min';
  if (v < 48) return v.toLocaleString('en-US', { maximumFractionDigits: 1 }) + ' h';
  return (v / 24).toLocaleString('en-US', { maximumFractionDigits: 1 }) + ' days';
}

const TAG = (live) => (live ? 'LIVE' : 'PLANNED');

/* Section 1's title is the ONLY one that moves, and it moves because the tile
   type changes what the section is reporting. "What it makes" over the Car
   Marketplace is the heading half of the contradiction fixed in the channel
   branch below — a marketplace makes nothing, it lists what other tiles make —
   and over the Battle System it calls 409 drops "products". The order, the
   keys and the numbers never move: the jump bar, the tests and the anchors all
   key on `key`, never on the words. */
function sectionsFor(type, isDrops) {
  return SECTIONS.map((s) => {
    if (s.key !== 'makes') return { n: s.n, key: s.key, title: s.title };
    if (type === 'channel') return { n: s.n, key: s.key, title: 'What trades here', jump: 'Trades' };
    if (isDrops) return { n: s.n, key: s.key, title: 'What drops here', jump: 'Drops' };
    return { n: s.n, key: s.key, title: s.title };
  });
}
/* The seven sections, in the owner's order. `key` is what the painter and the
   tests look up; `n` is printed. Never reorder — the bar is "in order". */
export const SECTIONS = Object.freeze([
  Object.freeze({ n: 1, key: 'makes', title: 'What it makes' }),
  Object.freeze({ n: 2, key: 'works', title: 'What works today vs planned' }),
  Object.freeze({ n: 3, key: 'start', title: 'What you need to start' }),
  Object.freeze({ n: 4, key: 'run', title: 'What it needs to run' }),
  Object.freeze({ n: 5, key: 'ships', title: 'Ships via Transport' }),
  Object.freeze({ n: 6, key: 'partners', title: 'Best businesses to work with' }),
  Object.freeze({ n: 7, key: 'plan', title: 'Is this for me' }),
]);

/* Plain words for the provenance codes the truth files use. A player never
   sees `opsYield`; they see where the thing comes from. Unknown codes print as
   "in the game" rather than the raw token. */
const VIA_WORDS = Object.freeze({
  opsYield: 'the hourly operation', opsInput: 'the hourly operation', cityFirm: 'the city simulation (a city firm, not your stash)',
  minigame: 'its own screen', upkeep: 'another business’s upkeep', systemFacility: 'a city building', proposed: 'the owner’s map',
  drop: 'battle loot', always: 'every time', drops: 'a common drop', staples: 'the staple pool', all: 'the salvage pool', lane: 'a supply lane',
});
const via = (v) => VIA_WORDS[v] || 'in the game';

/* ─────────────────────────────────────────────────────────────────────────
   🔴 WHO WANTS THIS DROP — the owner's headline clause, said per row.
   "make sure that all of the businesses needs what can be found in the loot
   system in the battle system". Round 6 shipped the Battle System card with
   409 product rows every one of which read, word for word, "a drop, not a
   rate · from battle loot · you hold 0", and the Camp card with 414 rows
   reading the same sentence with two words swapped. A player scrolling that
   learns one fact (things drop) repeated 409 times, and the owner's clause —
   which coverage.js ANSWERS, 409 of 409 — was nowhere on the card.

   coverage.USES already holds the answer, keyed by resource id, so nothing is
   written down here: empty a USES row and the row below loses its name and the
   coverage count falls by one. The same read is what hover.js does for its
   one-line version of this fact (`wantedBy`); it is duplicated rather than
   imported because hover.js is a VIEW and views must not depend on each other
   — but the RULE it encodes (only a BUSINESS counts, not a system or a
   channel) is the owner's sentence and both views must apply it identically.

   Rejected: printing the raw role code, or the `why` string from USES. The
   why is a developer cite ("Live today: Just Business op input (OPS_ECON
   inputs)") and scrubVM strips those from a player card anyway.
   ───────────────────────────────────────────────────────────────────────── */
const USE_VERB = Object.freeze({
  input: ['burns it by the hour', 'burn it by the hour'],
  craft: ['crafts with it', 'craft with it'],
  build: ['builds with it', 'build with it'],
  upkeep: ['pays its upkeep in it', 'pay their upkeep in it'],
  trade: ['trades in it', 'trade in it'],
  sim: ['feeds it to its city firm', 'feed it to their city firms'],
});
const useVerb = (role, plural) => (USE_VERB[role] || ['wants it', 'want it'])[plural ? 1 : 0];

/* The business tiles that want `rid`, best first. A live use outranks a
   planned one for the SAME business: the row is badged LIVE (the drop really
   falls today) and "would burn it" beside that badge reads as a hedge on the
   drop rather than on the need. */
function wantersOf(d, rid, bizSet) {
  const U = d && d.coverage && d.coverage.USES;
  if (!U || !bizSet || !bizSet.size) return [];
  const rows = arr(typeof U.get === 'function' ? safe(() => U.get(rid), null) : U[rid]);
  const best = new Map();
  for (const u of rows) {
    if (!isObj(u) || !bizSet.has(u.by)) continue;
    const prev = best.get(u.by);
    if (!prev || (u.live !== false && prev.live === false)) best.set(u.by, { id: u.by, role: str(u.role, 'input'), live: u.live !== false });
  }
  const out = Array.from(best.values());
  out.sort((a, b) => (b.live ? 1 : 0) - (a.live ? 1 : 0));
  return out;
}

const LEG_WORDS = Object.freeze({
  pickup: 'Pickup', haul: 'Haul', depot: 'Depot', deliver: 'Deliver',
});

/* One glyph vocabulary for a NODE (a business, a system, a channel) — used by
   the header and by every chip that names another node, so the same thing
   always wears the same face.
   WHY IT LIVES IN THE VIEW AND NOT IN businesses.js: a glyph is decoration,
   and businesses.js is the owner's map reproduced exactly (pdfmap's bar is
   "0 invented icons"). Inventing a per-tile emoji THERE would put a fact on
   the map the PDF never drew. The two CHANNEL glyphs are deliberately the
   same ones hover.js prints for the PDF legend badges (🏪 Marketplace,
   🚗 Car Marketplace) — a player who learned the badge on the hover card must
   not meet a different symbol for the same place one click later.
   Round-1 critic finding this answers: the "who buys it" chips carried the
   resource class and NO icon, so an automated sweep counted 11 "resource chips
   without a catalogue icon" on Mining. They were never resources.
   ROUND-4 CRITIC: every one of the 21 producer tiles fell through to
   KIND_GLYPH.producer, which was '▣'. Beside the colour emoji the systems and
   channels already wore, '▣' reads as a missing-glyph box — "▣ Research
   Facility" next to "🏙 City Builder" on the same row of the medical card,
   228 times across 522 cards. So every one of the 33 canonical ids now has a
   face of its own here. These say WHAT THE TILE DOES and nothing more; none
   of them adds a fact (a lane, a product, a dependency) the owner's map does
   not already draw, which is the line that keeps them out of businesses.js. */
const NODE_GLYPH = Object.freeze({
  'ch:market': '🏪', 'ch:carmarket': '🚗',
  'sys:battle': '⚔', 'sys:business': '💼', 'sys:city': '🏙', 'sys:camp': '🏕',
  transport: '🚚', mining: '⛏', oil: '🛢', gas: '⛽', cars: '🚙', construction: '🏗',
  trashcrusher: '♻', weaponsmith: '⚒', restaurant: '🍽', agri: '🌾', feed: '🌽',
  dojo: '🥋', cardshop: '🃏', fishing: '🎣', cannery: '🥫', bank: '🏦', genelab: '🧬',
  medical: '🏥', fashion: '🧵', research: '🔬', carfactory: '🏭', smuggling: '🕵',
  salvage: '🔧', warehouse: '📦', bus: '🚌', rail: '🚆', airport: '✈',
});
const KIND_GLYPH = Object.freeze({ hub: '🚚', service: '🏛', cityTransit: '🚌', producer: '🏭' });
export function nodeGlyph(node) {
  if (!isObj(node)) return '▣';
  const byId = NODE_GLYPH[str(node.id)];
  if (byId) return byId;
  const t = str(node.type, 'business');
  if (t === 'system') return '◈';
  if (t === 'channel') return '⇄';
  return KIND_GLYPH[str(node.kind)] || '▣';
}

/* ═════════════════════════════════════════════════════════════════════════
   PLAYER WORDS — no source identifier ever reaches a non-admin reader.

   WHY THIS EXISTS. The truth files cite their source inside the prose on
   purpose: `note`, `why`, `cite` and `service` carry things like
   "(resMarketTake -> _resSettleEntry)" or "(PHASE in
   public/src/transport/routes.js)" so an auditor can check the claim against
   the running game. The painter already hides the dedicated `cite` field
   behind vm.admin — but those same identifiers also ride INSIDE the
   sentences, where no gate sees them. A round-4 sweep of all 33 tiles as a
   non-admin found them printed to a normal player on 15 tiles; on 7 of them
   section 5 read "…settles INSTANTLY into the buyer's stash (resMarketTake ->
   _resSettleEntry) … is owner decision D3", which is half crash dump and half
   internal decision log, on the one feature whose whole job is explaining the
   economy to a first-time player.

   WHY HERE AND NOT IN THE DATA. Six sibling modules own those strings, the
   auditor needs them intact, and they are the same strings the admin should
   still see. The modal is the only place that knows WHO IS READING, so the
   scrub happens once, at the end of modalVM, and only when o.admin is false.

   THE ORDER MATTERS. Whole known phrases first, so the reader gets real
   player words instead of a hole. Then any bracketed aside whose inside is
   jargon is deleted entire — a cite in brackets is always an aside, never the
   sentence. Only then is a surviving identifier humanised, because some of
   them are REAL RESOURCE IDS with no catalogue name (`gunOil`, `aluminumOre`
   print as the resource's own `name`), and those must become "Gun Oil" and
   "Aluminum Ore", not vanish. Anything left that cannot be placed is removed:
   a shorter sentence beats a leftover token.
   ═════════════════════════════════════════════════════════════════════════ */

/* Source-identifier shapes. Ordered longest-first so a path is matched as a
   path before its `.js` tail is. */
const JARGON_SRC = [
  '[\\w.-]*(?:\\/[\\w.-]+)+\\.(?:js|mjs|cjs|html|sql|json|ts)',   // public/src/foo/bar.js
  '[\\w-]+\\.(?:js|mjs|cjs|html|sql|json)',                        // routes.js
  '[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+',                                 // OPS_ECON, WF_BENCH
  '(?<![\\w$])_[A-Za-z][A-Za-z0-9_]*',                             // _opEcon, _resSettleEntry
  '[a-z][a-z0-9]*(?:_[a-z0-9]+)+',                                 // player_banks, cf_mint
  '(?<![\\w$])[a-z]+[A-Z][A-Za-z0-9]*',                            // gunOil, resMarketTake
];
const jarg = (flags) => new RegExp('(?:' + JARGON_SRC.join('|') + ')', flags);
const JARGON_ONE = jarg('');
const JARGON_ALL = jarg('g');

/* Whole sentences the scrub must REPLACE rather than prune, because pruning
   them leaves prose that says nothing. Each right-hand side is the same fact
   in words a player already knows. */
const PHRASES = Object.freeze([
  [/Today the Marketplace settles INSTANTLY into the buyer[’']s stash \([^)]*\): no haul, no carrier, no delay\.\s*Routing a sale through a haul is owner decision D\d+\./g,
    'Today a Marketplace sale drops straight into the buyer’s stash — no truck, no carrier, no delay. Making a sale travel by road instead is a change the game has not made yet.'],
  [/\bowner decision D\d+\b/gi, 'a change the game has not made yet'],
  [/\bdecision D\d+\b/gi, 'a change the game has not made yet'],
  [/OPS_ECON \(public\/index\.html\), read through _opEcon\(\)/g, 'the game’s own business table'],
  [/OP_ECO_MAP \(public\/node-city\/index\.html\) — simulated city firm, never a player stash/g,
    'a firm inside the city simulation — never a player’s stash'],
  [/OP_ECO_MAP \(public\/node-city\/index\.html\)/g, 'the city simulation’s own table'],
  [/FARM_ECON \(public\/src\/farm\/index\.js\)/g, 'the farm’s own table'],
  [/STASH_IDS \(public\/src\/refinery\/state\.js\)/g, 'the Cracking Yard’s own table'],
  [/PHARMA lines \(public\/src\/hospital\/pharma\.js\)/g, 'the Hospital’s pharmacy recipes'],
  [/\bflagged [a-z]+[A-Z][A-Za-z0-9]*\b/g, ''],
]);

/* Generic replacements for an identifier no phrase caught. A path is an
   address and simply goes; a table name becomes "the game's own table"; a
   camelCase token is a name someone forgot to give a display name, so it is
   title-cased into one. */
function humanise(tok) {
  return tok.replace(/[_.]+/g, ' ').replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/\s+/).filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
}
function placeJargon(tok) {
  if (tok.includes('/') || /\.(js|mjs|cjs|html|sql|json|ts)$/.test(tok)) return '';
  if (/^[A-Z][A-Z0-9_]*$/.test(tok)) return 'the game’s own table';
  if (tok.includes('_')) return 'the game’s own records';
  return humanise(tok);
}
/* Punctuation left behind by a deletion. Kept deliberately small: it repairs
   a hole, it does not rewrite the author's sentence. */
function tidyProse(t) {
  return t
    .replace(/[ \t]+/g, ' ')
    .replace(/\(\s*\)|\[\s*\]/g, '')
    .replace(/ +([,.;:!?)])/g, '$1')
    .replace(/([(]) +/g, '$1')
    .replace(/([,;:]) *([,;:.])/g, '$2')
    .replace(/—\s*—/g, '—')
    .replace(/^[\s—:;,.]+/, '')
    .replace(/\s+$/g, '')
    .trim();
}
export function scrubProse(s) {
  let t = str(s); if (!t) return t;
  if (!JARGON_ONE.test(t)) return t;               // the common case: leave it exactly alone
  for (const [re, to] of PHRASES) t = t.replace(re, to);
  // a bracketed aside that is nothing but provenance is dropped whole
  t = t.replace(/\s*\(([^()]*)\)/g, (m, inner) => (JARGON_ONE.test(inner) ? '' : m));
  t = t.replace(JARGON_ALL, placeJargon);
  return tidyProse(t);
}

/* The fields that hold SENTENCES. Everything else in the VM (`id`, `opId`,
   `kind`, `style`, `icon`) is a token the code matches on and must survive
   byte-for-byte — scrubbing `gunOil` in an `id` would break every lookup that
   uses it. `name` and `label` ARE scrubbed: a resource with no catalogue
   entry prints its raw id as its name, which is exactly the leak. */
const PROSE_KEYS = new Set(['note', 'why', 'counterNote', 'marketNote', 'text', 'detail', 'title',
  'blurb', 'empty', 'headline', 'effortWhy', 'should', 'first', 'costs', 'keeps', 'sentence',
  'phaseText', 'rule', 'whatHappensToday', 'where', 'whereFull', 'how', 'service', 'firstAction',
  'basis', 'cite', 'label', 'name', 'openLabel', 'caveats', 'reasons', 'readings', 'pdfCite']);
function scrubTree(v, key, seen) {
  if (typeof v === 'string') return PROSE_KEYS.has(key) ? scrubProse(v) : v;
  if (Array.isArray(v)) return v.map((x) => scrubTree(x, key, seen));
  if (isObj(v)) {
    if (seen.has(v)) return v; seen.add(v);
    for (const k of Object.keys(v)) v[k] = scrubTree(v[k], k, seen);
    return v;
  }
  return v;
}
export function scrubVM(vm) { return isObj(vm) ? scrubTree(vm, '', new WeakSet()) : vm; }

/* ─────────────────────────────────────────────────────────────────────────
   modalVM — PURE
   opts: { opEcon(id), opLabel(id), held(id), owns(id), gems, transportPhase,
           admin, signedIn, proposal (true when the shell can copy an overlay) }
   ───────────────────────────────────────────────────────────────────────── */
export function modalVM(id, data, opts) {
  const o = isObj(opts) ? opts : {};
  const nid = str(id);
  const d = isObj(data) ? data : {};
  const g = isObj(d.graph) ? d.graph : { nodes: [], edges: [], lanes: [] };
  const nodes = arr(g.nodes);
  const node = nodes.find((n) => n && n.id === nid) || null;
  const heldOf = (rid) => { const f = fn(o.held); const v = f ? num(safe(() => f(rid), null)) : null; return v === null ? null : Math.max(0, Math.floor(v)); };
  const ownsOf = (bid) => { const f = fn(o.owns); return f ? safe(() => f(bid), false) === true : false; };
  const opEconOf = (bid) => { const f = fn(o.opEcon); const r = f ? safe(() => f(bid), null) : null; return isObj(r) ? r : null; };
  const labelOf = (bid) => {
    const n = nodes.find((x) => x && x.id === bid);
    const f = fn(o.opLabel);
    // sc.bridge.opLabel answers the ID when there is no bridge; that is not a
    // name, so it falls through to the map's own label (round 1 printed "agri").
    const live = (n && n.opId && f) ? str(safe(() => f(n.opId), ''), '') : '';
    return (live && live !== n.opId ? live : '') || (n && str(n.label, bid)) || bid;
  };
  const cat = isObj(d.catalog) ? d.catalog : null;
  const res = (rid) => {
    const r = cat && fn(cat.byId) ? safe(() => cat.byId(rid), null) : null;
    /* Every one of the 424 catalogue rows HAS an icon (checked: 0 without),
       so a missing one here means the id is NOT a resource in this game — the
       gunOil phantom, or a bridge row the snapshot has not met. '⚠' says that
       out loud; round 1 printed '▫', which reads as "we forgot the icon". */
    /* The four catalogue flags travel with the row because chipTitle() has to
       compose a TRUE sentence for a chip whose section passes no prose. A
       fallback written without them said "the game does not make it yet" over
       Coal on the very card that says Mining makes Coal — an invented claim is
       worse than the raw id it replaced. Whitelisted, not spread: a bare `...r`
       would drop a `live` key onto rows that are badged elsewhere. */
    return { id: rid, name: r ? str(r.name, rid) : rid, icon: r ? str(r.icon, '⚠') : '⚠', known: !!r, held: heldOf(rid),
      inLedger: !!(r && r.inLedger), inLoot: !!(r && r.inLoot), inChain: !!(r && r.inChain),
      inShipyard: !!(r && r.inShipyard), chainCat: r ? str(r.chainCat) : '' };
  };

  if (!node) {
    return unknownVM(nid);
  }

  const type = str(node.type, 'business');
  const live = node.status !== 'planned';
  const eco = node.opId ? opEconOf(node.opId) : null;
  const label = labelOf(nid);
  const owned = !!node.opId && ownsOf(node.opId);
  const nb = safe(() => (fn(g.neighbours) ? g.neighbours(nid) : null), null) || {};
  const sysLabel = (sid) => labelOf(sid);
  const gems = num(typeof o.gems === 'function' ? safe(() => o.gems(), null) : o.gems);

  /* plan.js takes partners.js through data.partners (its step-4 path). Passing
     it here rather than importing inside plan.js is that file's rule; this is
     the caller. */
  const dataP = Object.assign({}, d, { partners: d.partners || partnersMod });
  const plan = safe(() => planFor(nid, { opEcon: opEconOf, held: heldOf, owns: ownsOf, gems, data: dataP, transportPhase: o.transportPhase }), null) || {};
  const partnersAll = safe(() => arr(partnersMod.bestPartners(nid, dataP)), []);
  const verdict = gems !== null && fn(plan.verdictFor) ? safe(() => plan.verdictFor({ gems }), null) : null;

  /* ── 1 · What it makes ─────────────────────────────────────────────── */
  const makesRows = [];
  /* Only a BUSINESS answers the owner's "all the businesses needs what can be
     found in the loot system" — a system or a channel "using" an id is not
     what that sentence is about. Same rule as hover.js's `wantedBy`. */
  const bizSet = new Set(nodes.filter((n) => n && n.type === 'business').map((n) => n.id));
  /* Two names at most, and only when the second one wants it for the SAME
     reason: "Home Feed and Restaurant craft with it" is one true sentence,
     while "Home Feed and Restaurant burn it by the hour" would be false the
     moment their roles differ. Beyond two it is a count, never a third name —
     a product tile is ~220px wide and the third name never fits. */
  const wantText = (w) => {
    if (!w.length) return 'nothing on this map wants it yet';
    const named = (w[1] && w[1].role === w[0].role && w[1].live === w[0].live) ? w.slice(0, 2) : w.slice(0, 1);
    const extra = w.length - named.length;
    const who = named.map((x) => labelOf(x.id)).join(' and ');
    const verb = w[0].live ? useVerb(w[0].role, named.length > 1) : 'would ' + useVerb(w[0].role, true);
    /* WHY THE PLANNED HALF NAMES ITS SUBJECT. The row's own badge says LIVE —
       the drop really falls today — and the need may still be the owner's map
       rather than the game's. "…— on the owner's map" alone is the exact
       phrase makesMeta prints for a PLANNED ROW, so beside a LIVE badge it
       reads as a second, contradicting tag. Saying "that need is" makes the
       subject of the qualifier impossible to mistake. */
    return who + ' ' + verb + (w[0].live ? '' : ' — that need is on the owner’s map') + (extra ? `, +${extra} more want it` : '');
  };
  let dropCover = null;          // {covered,total} for a drops system; null elsewhere
  /* the ids a CHANNEL row promoted from PLANNED to LIVE because they change
     hands as items (vehicles). The counter's out-edges may be promoted over
     exactly these and nothing else — see the buyer chips below. */
  const itemTradeIds = new Set();
  const yieldPerHr = {};
  for (const y of arr(plan.earn && plan.earn.yieldsPerHr)) if (y && y.id) yieldPerHr[y.id] = y;
  const maxWorkers = eco ? num(eco.maxWorkers) : null;
  if (type === 'business') {
    for (const m of arr(node.makes)) {
      if (!m || !m.id) continue;
      const r = res(m.id);
      const y = yieldPerHr[m.id];
      const perWorker = eco && isObj(eco.yields) ? num(eco.yields[m.id]) : null;
      makesRows.push({
        ...r, live: m.live !== false, via: str(m.via), viaText: via(m.via),
        note: str(m.note),
        rate: y ? { perHr: y.perHr, netPerHr: y.netPerHr, perWorkerHr: perWorker, workers: maxWorkers } : (perWorker !== null ? { perHr: maxWorkers ? perWorker * maxWorkers : null, perWorkerHr: perWorker, workers: maxWorkers } : null),
        rateText: y ? `${fmtRate(y.perHr)} an hour at full crew` : (perWorker !== null ? `${fmtRate(perWorker)} per worker-hour` : (m.live === false ? 'rate not set — not in the game yet' : m.via === 'cityFirm' ? 'a city firm’s product — it never reaches your stash' : m.via === 'minigame' ? 'made on its own screen, not by the hour' : m.via === 'opsYield' && !eco ? 'rate unavailable — the economy table did not answer' : 'made in the game, no hourly rate')),
      });
    }
    /* A yield the game's table names but the catalogue does not know (the
       gunOil phantom, OWNER_DECISIONS). recipes.js keeps it out of `makes`
       because nothing can hold it; the modal still SHOWS it, flagged, because
       "the table says X and the map hides X" is exactly the kind of gap the
       owner asked this screen to expose. */
    if (eco && isObj(eco.yields)) for (const rid of Object.keys(eco.yields)) {
      if (makesRows.find((x) => x.id === rid)) continue;
      const r = res(rid);
      const perW = num(eco.yields[rid]);
      makesRows.push({ ...r, live: true, phantom: !r.known, via: 'opsYield', viaText: 'the hourly operation',
        note: r.known ? '' : `The operation’s table yields "${rid}", but no resource with that id exists in the game — it never reaches a stash.`,
        rate: { perWorkerHr: perW, perHr: maxWorkers && perW !== null ? perW * maxWorkers : null, workers: maxWorkers },
        rateText: r.known ? `${fmtRate(maxWorkers && perW !== null ? perW * maxWorkers : perW)} an hour at full crew` : 'yielded on paper only — no such resource exists' });
    }
  } else if (type === 'system') {
    const made = nid === 'sys:city' ? arr(node.makes) : [];
    for (const m of made) if (m && m.id) makesRows.push({ ...res(m.id), live: m.live !== false, via: 'systemFacility', viaText: (m.by ? m.by : 'a city building'), note: '', rate: null, rateText: m.by ? `built by the ${m.by}` : 'built in the city' });
    const drops = arr(node.produces && node.produces.drops);
    if (drops.length) {
      let covered = 0;
      /* The same count restricted to a need the GAME already has. The headline
         claim "409 of 409 drops are wanted by a business" was flat present
         tense while the rows under it mostly said "that need is on the owner's
         map" — the sentence and its own rows disagreed about tense. Counted
         here, off the same wanters, so neither number can be typed by hand. */
      let liveCovered = 0;
      for (const rid of drops) {
        const w = wantersOf(d, rid, bizSet);
        if (w.length) covered++;
        if (w.some((x) => x.live)) liveCovered++;
        if (makesRows.find((x) => x.id === rid)) continue;
        makesRows.push({ ...res(rid), live: true, via: 'drop', viaText: nid === 'sys:camp' ? 'camp missions and containers' : 'battle loot', note: '', rate: null,
          /* WHY THE BUSINESS NAME IS THE RATE SLOT AND NOT A NEW FIELD: the
             product tile prints "<rate> · from <via> · you hold N", and a drop
             HAS no rate. The slot was filled with the one sentence that is
             both true and different on every row — who the drop is FOR.
             "a drop, not a rate" is not lost: "from battle loot" in the same
             line already says it is a drop, which is why the old row said one
             thing twice. */
          /* 🔴 THE BADGE AND THE BODY MUST ANSWER THE SAME QUESTION.
             355 of the 409 drop tiles badged LIVE over a body reading
             "Trash Crusher would craft with it — that need is on the
             owner's map". Both halves are true of DIFFERENT facts (the
             drop is live, the need is planned) and the reader has no way
             to know the badge is only about the fall. So a drop row does
             not wear the bare word LIVE: it says what is live ("DROPS
             TODAY") and, when no business burns it yet, carries a second
             dim tag naming the half that is not ("NEED PLANNED"). The row
             stays live:true — dimming 355 tiles would claim the drop
             itself is planned, which is the opposite lie. */
          badgeWord: 'DROPS TODAY', wantLive: w.some((x) => x.live),
          rateText: wantText(w), wantedBy: w.map((x) => ({ id: x.id, label: labelOf(x.id), role: x.role, live: x.live })) });
      }
      dropCover = { covered, total: drops.length, liveCovered };
    }
    if (nid === 'sys:business') {
      /* The same defect on the third system card: 93 rows all reading "made by
         one of the businesses below", with the businesses three screens down.
         The graph knows the maker of every id — say it here. */
      const makers = new Map();
      for (const n2 of nodes) {
        if (!n2 || n2.type !== 'business') continue;
        for (const mk of arr(n2.makes)) {
          if (!mk || !mk.id) continue;
          if (!makers.has(mk.id)) makers.set(mk.id, []);
          const a = makers.get(mk.id); if (a.indexOf(n2.id) < 0) a.push(n2.id);
        }
      }
      for (const rid of arr(node.produces && node.produces.made)) {
        if (makesRows.find((x) => x.id === rid)) continue;
        const who = makers.get(rid) || [];
        const names = who.slice(0, 2).map((b) => labelOf(b));
        const extra = who.length - names.length;
        makesRows.push({ ...res(rid), live: true, via: 'opsYield',
          // the maker's name IS the source, so the "from a business operation"
          // half would only repeat it — the stutter guard's rule, applied up front
          viaText: '', note: '', rate: null, madeBy: who.map((b) => ({ id: b, label: labelOf(b) })),
          rateText: names.length ? `made by ${names.join(' and ')}${extra ? `, +${extra} more` : ''}` : 'made by one of the businesses below' });
      }
    }
  } else if (type === 'channel') {
    /* 🔴 A COUNTER MAY NOT BADGE A LISTING PLANNED WHILE THE SAME CARD SAYS IT
       TRADES TODAY. On ch:carmarket, section 1 badged Cars and Trucks PLANNED
       ("listed by Car Dealer") while section 6, four sections down the SAME
       card, badged the Car Dealer row LIVE with "Works today for cars —
       vehicles trade as items, not as hauled cargo". One card, two opposite
       claims about a Car.
       The two are answering two different questions and section 1's is the
       ITEM one: "what changes hands at this counter". The edge is live:false
       because recipes.js marks a vehicle lane `cargoIsItem` — a vehicle is not
       a resource that rides a truck yet — which is the right answer to "is
       there a freight lane" and the wrong answer to "can you buy one here".
       So a vehicle the seller really makes is badged LIVE and says WHY in the
       same breath, which is partners.js's rule and partners.js's words, read
       off the catalogue (`family(id) === 'vehicle'`) rather than retyped, so
       the next vehicle the owner adds behaves the same with no edit.

       ⚠ REJECTED, AND NOT TO BE RE-PROPOSED: filtering this list down to
       vehicles so the fuel rows disappear. That looks like the fix (round 11
       of partners.js shipped it as words) and it is FALSE twice over —
       businesses.js PDF.iconRule, verbatim from p6, says an icon marks a
       market the tile NEEDS to earn, never one whose goods it makes; and
       recipes.js derives the sellsTo edge from that drawn icon, with graph.js
       erroring ('icon-without-lane') when one is missing. partners.js round 3
       removed the claim for exactly these reasons. Whether the Car Marketplace
       should be vehicles-only is a MAP question for the owner (OWNER_DECISIONS
       D12), settled in recipes.js if ever, never by hiding rows here. */
    const famOf = (rid) => (cat && fn(cat.family) ? str(safe(() => cat.family(rid), '')) : '');
    const makesLive = (bid, rid) => {
      const n2 = nodes.find((x) => x && x.id === bid);
      return !!(n2 && arr(n2.makes).find((m) => m && m.id === rid && m.live !== false));
    };
    const seen = new Set();
    for (const e of arr(nb.channels)) {
      if (!e || e.dir !== 'in') continue;
      for (const rid of arr(e.cargo)) {
        if (seen.has(rid)) continue;
        seen.add(rid);
        const who = labelOf(e.node);
        const itemTrade = e.live === false && famOf(rid) === 'vehicle' && makesLive(e.node, rid);
        if (itemTrade) itemTradeIds.add(rid);
        /* WHO IS ON THE OTHER SIDE OF THE COUNTER. Twenty rows reading "listed
           by Oil Company" tell a reader one fact twenty times and never answer
           the question they came to a marketplace with — who wants it. Same
           coverage.USES read as the drop rows above, same rule (a BUSINESS,
           not a system), so nothing is written down and an emptied USES row
           costs this line its name. */
        const w = wantersOf(d, rid, bizSet);
        /* "listed by Oil Company — wanted by Oil Company" is a true row and a
           useless one: a counter row exists to point at the OTHER side. The
           seller is dropped unless it is the only tile that wants the id, in
           which case saying so is the honest answer. */
        /* …and "listed by Oil Company — wanted by Oil Company" printed nine
           times across ch:market and ch:carmarket when the seller was the ONLY
           wanter: a listing whose only named buyer is its own seller reads as
           a bug, not as a fact. The fallback is now silence about the buyer
           plus the reason for it (below), never the seller's own name. */
        const notSelf = w.filter((x) => x.id !== e.node);
        const use = notSelf;
        const selfOnly = !notSelf.length && w.length > 0;
        const rowLive = e.live !== false || itemTrade;
        /* The "on the owner's map" qualifier is SKIPPED on a row makesMeta
           already marks that way — the Trucks row printed it twice in one
           line ("…on the owner's map · the owner's map · you hold 35"). */
        const wantTail = use.length
          ? ` — wanted by ${labelOf(use[0].id)}${use.length > 1 ? ` +${use.length - 1}` : ''}${use[0].live || !rowLive ? '' : ', on the owner’s map'}`
          /* the seller is already named at the head of this same line, so the
             tail says WHAT it means instead of repeating the name */
          : selfOnly ? ' — no other tile on the map wants it yet; only its own maker uses it'
          : '';
        makesRows.push({ ...res(rid), live: e.live !== false || itemTrade, itemTrade, via: 'trade',
          viaText: `listed by ${who}`, note: '', rate: null,
          wantedBy: w.map((x) => ({ id: x.id, label: labelOf(x.id), role: x.role, live: x.live })),
          rateText: itemTrade ? `listed by ${who} — it changes hands as an item, not as hauled cargo` : `listed by ${who}${wantTail}` });
      }
    }
  }
  /* 🔴 THE STUTTER GUARD. A product row prints "<rate> · from <via>", which
     reads well for an operation ("9 an hour at full crew · from the hourly
     operation") and is nonsense for a listing, where BOTH halves are the same
     sentence: round-2 shipped 62 rows across ch:market, ch:carmarket and
     sys:city reading "listed by Mining Company · from listed by Mining
     Company" and "built by the Hydroponics Bay · from Hydroponics Bay".
     Rejected fix: invent a filler rate for channel rows ("no hourly rate — a
     listing"). That trades a stutter for a sentence that says nothing, and it
     would not have caught the city rows, where one string merely CONTAINS the
     other. This collapses the pair wherever one half already carries the
     other, so the painter has nothing left to repeat — and it is done here,
     in the VM, so a Node test can assert it without a browser. */
  for (const r of makesRows) {
    /* The de-stutter is a RENDERING decision for section 1, where the rate and
       the source are painted side by side. Section 2 paints the source on its
       own, with no rate beside it, so it needs the word back — blanking the
       only copy composed "Makes Naphtha through ." nine times across the Oil
       and Feed cards. Keep the original here rather than re-deriving it there,
       so the two sections can never disagree about what the source IS. */
    r.viaFull = str(r.viaText);
    const a = str(r.rateText).toLowerCase().trim();
    const b = str(r.viaText).toLowerCase().trim();
    if (!a || !b) continue;
    if (a.includes(b)) r.viaText = '';          // the rate line already names the source
    else if (b.includes(a)) r.rateText = '';    // the source line already carries the rate
  }

  /* Every chip that names another node carries that node's glyph (nodeGlyph),
     so the header face and the chip face agree. */
  const glyphOf = (bid) => nodeGlyph(nodes.find((x) => x && x.id === bid) || { id: bid });
  /* ⚠ A LIVE BUYER CHIP MUST NOT NAME A PRODUCT THE SAME CARD CALLS PLANNED.
     A supply lane is LIVE when ONE of its ids really ships (Fuel); printing the
     whole cargo under that badge made the Gas Station card read "Diesel PLANNED
     · not in the game yet" in its top row and "Transportation Company — Fuel,
     Diesel, Gasoline LIVE" 150 px lower, on one screen with no scrolling. Six
     such rows over four cards (gas, cars, construction, mining).
     ⚠ THE OBVIOUS ONE-LINER (`b.liveIds` instead of `b.cargo`) IS WRONG.
     graph.js computes an edge's liveIds with `m.via !== 'cityFirm'`, so a city
     firm's product is missing from it even when this card badges that product
     LIVE — switching blindly deletes Gasoline from the gas chip and
     Construction Components from the construction chip, trading a
     contradiction for an omission that no check would catch. The honest set is
     the UNION: the lane's own live ids plus this seller's own LIVE products.
     A PLANNED chip keeps its whole cargo — nothing on it claims to work.
     ⚠ ROUND NINE — TWO THINGS WERE STILL WRONG HERE, BOTH ON ch:market.
     (1) `liveHere` read `node.makes`, which is EMPTY on a channel and on most
     systems: a channel makes nothing, it prints what its sellers list, and
     those rows are built above from the INBOUND edges. So the union degraded to
     the lane's liveIds — and a channel edge carries none — which emptied every
     chip and dropped it straight into the fallback below. It now reads the rows
     the card ACTUALLY PRINTS (`makesRows`), which is the only set the
     contradiction is ever measured against and is identical to `node.makes` for
     a business, so no business chip moves.
     (2) The fallback "an empty filter keeps the whole cargo" was itself the lie
     on that card: the Marketplace printed Packaging Material, Cardboard, Ammo,
     Weapon Parts and four more as PLANNED in section 1 and re-listed all eight
     inside LIVE chips (Battle System, Just Business) on the same screen, because
     the counter's OUT edge is live while the seller who lists the goods is not.
     Keeping the cargo is still right — an empty chip is a worse lie than a loose
     one — but asserting LIVE over it is not, so the chip keeps every name and
     LOSES the badge. That can only fire when the card itself calls every name on
     the chip planned, which is exactly the case where LIVE was false. A chip with
     no cargo at all (a bare `sellsTo` counter) is untouched: it claims nothing. */
  const liveHere = new Set(makesRows.filter((r) => r && r.live !== false).map((r) => r.id));
  /* its mirror, read by the partner rows in section 6 (see there for why) */
  const plannedHere = new Set(makesRows.filter((r) => r && r.live === false).map((r) => r.id));
  const chipCargo = (b) => {
    const all = arr(b.cargo);
    if (b.live === false) return { cargo: all, live: false };
    const kept = all.filter((id) => arr(b.liveIds).includes(id) || liveHere.has(id));
    if (kept.length) return { cargo: kept, live: true };
    return { cargo: all, live: all.length === 0 };
  };
  const buyers = [];
  for (const b of arr(node.buyers)) if (b && b.biz) { const c = chipCargo(b); buyers.push({ id: b.biz, glyph: glyphOf(b.biz), label: labelOf(b.biz), cargo: c.cargo.map(res), live: b.live !== false && c.live, pdf: !!b.pdf }); }
  /* 🔴 A COUNTER'S OWN EDGE DECIDES WHETHER IT IS LIVE — NOT THIS LINE.
     Round 1 pushed every `sellsTo` channel with a hard-coded `live:true`, and
     graph.js emits agri->ch:carmarket and feed->ch:carmarket with cargo:[] and
     live:false, because data.js CHANNEL_SCOPE scopes the Car Marketplace to
     the families the tow-truck icon draws (vehicle, energy). The card printed
     "LIVE · To Car Marketplace: Food" on Agricultural Op. while its own
     partners row said the counter lists nothing of its. Two opposite facts,
     one card.
     `cargo` stays EMPTY on the chip on purpose — the chip names the counter,
     not a shopping list — but the lane in section 5 needs the edge's real
     cargo (counterCargo) and, when there is none, the edge's REASON: an empty
     channel cargo is a verdict ("nothing it makes is in that counter's
     scope"), never a gap to be filled in with a guess.
     Only channels are read this way. A sellsTo that names a SYSTEM is a
     cargo-less service edge (the battler card) whose live flag answers a
     different question, and re-reading it here would change what every card
     says about battlers to fix a counter bug. */
  for (const sid of arr(node.sellsTo)) {
    if (buyers.find((x) => x.id === sid)) continue;
    const ce = sid.indexOf('ch:') === 0 ? arr(g.edges).find((e) => e && e.kind === 'channel' && e.from === nid && e.to === sid) : null;
    const ccargo = ce ? arr(ce.cargo) : [];
    buyers.push({ id: sid, glyph: glyphOf(sid), label: labelOf(sid), cargo: [], live: ce ? ce.live !== false : true, pdf: true, channel: true,
      /* counterEdge marks the rows whose live flag and cargo came from a REAL
         channel edge. Section 6 re-reads exactly those and nothing else: a
         sellsTo that names a system takes this same branch with ce === null,
         and copying a made-up `live:true` onto a partner row would be the
         round-1 bug again, one section further down. */
      counterEdge: !!ce, counterCargo: ccargo.map(res), counterReason: ce && !ccargo.length ? counterScopeReason(ce, node) : '' });
  }
  /* the counter's own out-edges go through chipCargo() too (round nine): this
     branch bypassed it for eight rounds, which is where every remaining
     contradiction on the map lived. */
  if (type === 'channel') for (const e of arr(nb.channels)) {
    if (!e || e.dir !== 'out' || buyers.find((x) => x.id === e.node)) continue;
    const c = chipCargo(e);
    let bLive = e.live !== false && c.live;
    let bCargo = c.cargo.map(res);
    /* The mirror of the item rule above. The counter's OUT edge to the Battle
       System is live:false for the same reason the IN edge was — a vehicle is
       not hauled cargo — so the card said "Battle System would buy Cars,
       Trucks — planned" while section 6 said "Battle System · Works today for
       cars". The chip is promoted ONLY over `itemTradeIds`, and narrows to
       them, so Trucks stays out of the LIVE claim.
       ⚠ NOT over every live listing. That wider rule was written first and it
       turned five PLANNED chips on the Marketplace card LIVE (Transport ·
       Rubber, Car Dealer · Leather …): the out-edge's live flag is about
       whether that BUYER buys there yet, and "the Marketplace lists Rubber" is
       not an answer to it. One item rule, one set of ids. */
    if (!bLive && itemTradeIds.size) {
      const kept = arr(e.cargo).filter((id) => itemTradeIds.has(id));
      if (kept.length) { bLive = true; bCargo = kept.map(res); }
    }
    buyers.push({ id: e.node, glyph: glyphOf(e.node), label: labelOf(e.node), cargo: bCargo, live: bLive, pdf: !!e.pdf });
  }
  if (type === 'system') for (const sid of arr(node.bestBuyersNodes)) if (!buyers.find((x) => x.id === sid)) buyers.push({ id: sid, glyph: glyphOf(sid), label: labelOf(sid), cargo: [], live: true, pdf: true, best: true });
  /* THE COVERAGE FACT, SAID OUT LOUD ON THE CARD THAT RAISES IT. The owner's
     clause is "make sure that all of the businesses needs what can be found in
     the loot system", and coverage.js answers it — but round 6 printed only a
     count of drops, which is not an answer to "does anybody want them".
     The two drop cards word it DIFFERENTLY on purpose: they ask two different
     questions (what falls in a fight vs what a unit carries home) and a critic
     who saw them side by side could not tell them apart. Nothing here is a
     literal: empty a USES row and `covered` falls by one. */
  let coverLine = '';
  if (dropCover) {
    const short = dropCover.total - dropCover.covered;
    /* The tense clause, in each card's own voice. Without it the headline read
       as a promise the rows immediately broke. */
    const now = ` ${fmtInt(dropCover.liveCovered)} of them are burnt or crafted with by a business TODAY; the rest are needs the owner drew on the map.`;
    if (nid === 'sys:camp') {
      coverLine = (short
        ? `A unit carries home ${dropCover.total} different resources; ${dropCover.covered} of them are wanted by a business on this map, ${short} by nobody yet.`
        : `Nothing a unit carries home is junk: all ${dropCover.covered} of the ${dropCover.total} resources found out here are wanted by a business on this map.`) + now;
    } else {
      coverLine = (short
        ? `${dropCover.covered} of the ${dropCover.total} resources that drop here are wanted by a business on this map; ${short} have no buyer yet.`
        : `Every resource that drops in a fight has a buyer: ${dropCover.covered} of ${dropCover.total} drops are wanted by a business on this map.`) + now + ' Each row below names the one that wants it.';
    }
  }
  /* "17 PRODUCTS" over a marketplace was the heading half of the same
     contradiction: a counter makes nothing and a battlefield makes nothing —
     they list and they drop. One word, and the count stops being a claim. */
  const countWord = type === 'channel' ? 'listing' : dropCover ? 'drop' : 'product';
  /* 🔴 TWO BUYER LISTS ON ONE CARD HAD TO BE MADE TO AGREE.
     ch:carmarket's section 1 names a wanter on every row ("Gas Oil — wanted by
     Bus Company +5") and then prints "WHO BUYS AT THIS COUNTER: Battle System
     (Cars)". 16 of the 17 listed ids had no chip at all, so the card offered a
     reader two lists that contradicted each other about who is on the other
     side of the counter.
     The two are built from different facts — the chips are the counter's DRAWN
     out-edges (the owner's map), the row tails are coverage.USES (who consumes
     the id anywhere) — and BOTH are true, so neither list may be deleted:
     dropping the row tails puts the 20-identical-rows defect back, and
     promoting every wanter to a live counter chip would invent lanes the map
     does not draw (the round-9 bug, one section further down).
     They are reconciled instead: every wanter the rows name and the map does
     not draw at this counter is printed, as its own strip, saying exactly that.
     After this the reader can place each name in section 1 in one of the two
     strips, and there is no name in the rows that the buyer area does not
     account for. Derived from the same rows, so an emptied USES row removes a
     chip here with no edit. */
  let offCounterBuyers = [];
  let offCounterNote = '';
  if (type === 'channel') {
    const seenB = new Set(buyers.map((b) => b.id));
    const acc = new Map();
    for (const r of makesRows) for (const w of arr(r.wantedBy)) {
      if (!w || !w.id || seenB.has(w.id)) continue;
      const e = acc.get(w.id) || { id: w.id, glyph: glyphOf(w.id), label: labelOf(w.id), live: false, ids: [] };
      if (w.live) e.live = true;
      if (e.ids.indexOf(r.id) < 0) e.ids.push(r.id);
      acc.set(w.id, e);
    }
    offCounterBuyers = [...acc.values()].sort((a, b) => b.ids.length - a.ids.length);
    /* NOT CAPPED. A cap of six left 16 of ch:carmarket's row-named wanters
       with no chip anywhere, which is the same hole this strip exists to
       close, only smaller. The map has 27 tiles, so the list cannot run
       away. */
    if (acc.size) offCounterNote = `The rows above also name ${fmtInt(acc.size)} business${acc.size === 1 ? '' : 'es'} that want what is listed here but that the owner’s map does not draw at this counter. They are not buying here today — they get it from the maker, or the need is still only on the map.`;
  }
  const makes = {
    rows: makesRows, shown: Math.min(makesRows.length, MAX_RES), total: makesRows.length,
    countWord, coverLine,
    /* The label has to say WHICH question it answers. Once every listing row
       above names the business that wants the goods, a flat "Who buys it"
       under them reads as a contradiction ("wanted by Bus Company +13" then
       "Battle System") instead of a second, narrower question. */
    buyersLabel: type === 'channel' ? 'Who buys at this counter' : 'Who buys it',
    cover: dropCover ? { covered: dropCover.covered, total: dropCover.total } : null,
    buyers, offCounterBuyers, offCounterNote, bestBuyers: str(node.bestBuyers),
    service: str(node.service),
    empty: makesRows.length ? null : (type === 'channel' ? 'Nothing is listed here yet — no seller on the map names this counter.' : node.service ? 'It sells a service, not goods: ' + node.service : 'The map names no product for this tile yet.'),
  };

  /* ── 2 · What works today vs planned ──────────────────────────────── */
  const ledger = [];
  const push = (text, isLive, cite, kind) => { if (text) ledger.push({ text, live: !!isLive, tag: TAG(!!isLive), cite: str(cite), kind: str(kind, 'fact') }); };
  const pdfWords = isObj(node.pdfCite) && (num(node.pdfCite.page) || num(node.page)) ? `owner’s map, page ${num(node.pdfCite.page) || num(node.page)}` : '';
  if (node.plannedNote) push(node.plannedNote, false, pdfWords, 'tile');
  else if (type === 'business') push(`${label} is a business you can found today.`, true, pdfWords, 'tile');
  else push(`${label} is part of the shipped game.`, true, pdfWords, 'tile');
  /* ⚠ THIS USED TO BE `makesRows.slice(0, 6)` AND MUST NEVER BE A slice AGAIN.
     Mining's OP_ECO_MAP out-list is six ore ids on a tile with ten product
     rows, so a flat six-row cap printed five ores and silently dropped Zinc
     Ore — whose only appearance in the section headed "what works today vs
     planned" was then inside a PLANNED sentence about a buyer. Agri did it to
     Soybeans, Oil to Crude Oil and Natural Gas, and the cap also swallowed
     every one of Mining's planned products, so the "planned" half of that
     heading printed nothing at all. Two ids out of ONE out-list must never
     read differently on the same card; that is this piece's bar.

     The cap is replaced by GROUPING rather than by twenty one-line rows: rows
     that are the same thing in the code (same live flag, same source clause)
     are the same thing on screen, named together in one sentence. That makes
     the uniformity structural — ids in one sentence cannot contradict each
     other — and it keeps the section short (Oil: 4 lines, not 20). The cite
     is admin-only for `makes` rows, so merging the notes costs a player
     nothing. Row order is first-appearance, so the ledger still reads
     top-down in the same order as the grid above it. */
  if (type === 'business') {
    const andList = (xs) => (xs.length > 1 ? xs.slice(0, -1).join(', ') + ' and ' + xs[xs.length - 1] : xs[0] || '');
    const groups = new Map();
    for (const m of makesRows) {
      /* `viaFull`, not `viaText`: section 1's de-stutter blanks the latter
         whenever the rate line already carries the source, which composed
         "Makes Naphtha through ." — a non-sentence under a LIVE badge. */
      const src = str(m.viaFull || m.viaText);
      /* 🔴 THE PHANTOM FLAG IS PART OF THE KEY. A phantom (gunOil) is yielded by
         the same op, with the same `live` flag and the same source clause as a
         real product, so keying on (live, src) alone merged it with Fuel and
         printed "Makes Fuel and Gun Oil through the hourly operation." under a
         LIVE badge — while section 1 of the SAME card said no such resource
         exists. The per-id note that says so is admin-only in THIS section, so
         a player saw only the false half. Grouping may only merge rows the
         reader would read identically; a phantom is not one of them. */
      const key = (m.live ? 'L' : 'P') + (m.phantom ? 'X' : '-') + '|' + src;
      const g = groups.get(key) || { live: !!m.live, phantom: !!m.phantom, src, names: [], notes: [] };
      g.names.push(m.name);
      if (str(m.note) && g.notes.indexOf(str(m.note)) < 0) g.notes.push(str(m.note));
      groups.set(key, g);
    }
    for (const g of groups.values()) {
      const names = andList(g.names);
      /* The phantom group gets its OWN sentence, and that sentence keeps the
         "no such resource exists" clause, because this is the only copy of it
         a player reads in this section. */
      push(g.phantom
        ? `The operation’s table also yields ${names}, but no such resource exists in the game — it never reaches a stash.`
        : g.live
          ? `Makes ${names}${g.src ? ` through ${g.src}` : ''}.`
          : `Would make ${names} — on the owner’s map only.`, g.live, g.notes.join(' · '), 'makes');
    }
  }
  if (eco && isObj(eco.inputs)) for (const rid of Object.keys(eco.inputs)) { const r = res(rid); const per = num(eco.inputs[rid]); push(`Burns ${per !== null && maxWorkers ? fmtRate(per * maxWorkers) + ' ' : ''}${r.name} an hour at full crew — the operation slows when the stock room is empty.`, true, `opEcon('${node.opId}').inputs.${rid}`, 'burns'); }
  /* Live supplier rows are MERGED by cargo: Food comes from Agri, Cannery and
     Feed alike, and three near-identical lines taught the reader nothing the
     first one had not. Drawn-on-the-map lanes keep their own row because the
     owner's icon is the fact being reported. */
  const merged = new Map();
  for (const b of arr(node.bizNeeds)) {
    if (!b || !b.biz) continue;
    const cargo = arr(b.cargo).map((x) => res(x).name).join(', ');
    const liveIds = arr(b.liveIds).map((x) => res(x).name);
    const drawn = b.pdf ? 'drawn on the owner’s map' : 'not drawn on the map';
    if (!b.live) { push(`Would buy ${cargo} from ${labelOf(b.biz)} (${drawn}) — nothing in the game makes you yet.`, false, b.why, 'lane'); continue; }
    const what = liveIds.length ? liveIds.join(', ') : cargo;
    if (!b.pdf) { const m = merged.get(what) || { what, from: [], why: b.why }; m.from.push(labelOf(b.biz)); merged.set(what, m); continue; }
    push(`Uses ${what} from ${labelOf(b.biz)} today (${drawn}).${liveIds.length && liveIds.length < arr(b.cargo).length ? ' The rest of that lane is planned.' : ''}`, true, b.why, 'lane');
  }
  for (const m of merged.values()) push(`Uses ${m.what} today — from ${m.from.length > 1 ? m.from.slice(0, -1).join(', ') + ' or ' + m.from[m.from.length - 1] : m.from[0]} (not drawn on the map; listed for what they make).`, true, m.why, 'lane');
  /* The ledger shows the first six buyers, and a counter is always LAST in
     `buyers` (the business lanes are pushed first), so on a tile with six
     business buyers the owner's own shop icons fell off this list entirely —
     Agricultural Op. printed neither counter while its header badged both.
     Same rule as section 6: a drawn icon displaces the weakest row that is
     not one, and the original order is kept so the ledger still reads
     top-down. */
  const saleShown = buyers.slice(0, 6);
  for (const b of buyers) {
    if (saleShown.indexOf(b) >= 0 || !b.channel) continue;
    let vi = -1;
    for (let i = saleShown.length - 1; i >= 0; i--) if (!saleShown[i].channel) { vi = i; break; }
    if (vi < 0) break;
    saleShown.splice(vi, 1);
    saleShown.push(b);
  }
  saleShown.sort((a, b) => buyers.indexOf(a) - buyers.indexOf(b));
  for (const b of saleShown) {
    /* `channel` on a buyer only means "it came from sellsTo", and sellsTo also
       carries the two SYSTEMS (battlers, campers). "Sells on Battle System"
       reads as if the battle screen had a shop counter; it does not. */
    /* A counter whose edge carries no cargo is NOT a live sale: the same
       verdict section 5 prints is the one this ledger row has to carry, or
       the two halves of the card disagree again. */
    if (b.channel) push(!str(b.id).startsWith('ch:') ? `Sells to ${b.label} — players buy it to use there.`
      : str(b.counterReason) ? `Drawn for ${b.label}, but it lists nothing there today. ${b.counterReason}`
      : `Sells on ${b.label}.`, b.live, '', 'sale');
    /* "buys what it makes today" is a sentence about a TILE, and a counter
       makes nothing — on a channel card the same row has to name the goods
       that actually change hands, which is now the chip's own narrowed cargo. */
    else if (type === 'channel') push(b.live ? `${b.label} buys ${b.cargo.map((x) => x.name).join(', ') || 'here'} at this counter today.` : `${b.label} would buy ${b.cargo.map((x) => x.name).join(', ') || 'here'} — planned.`, b.live, '', 'sale');
    else push(b.live ? `${b.label} buys what it makes today.` : `${b.label} would buy ${b.cargo.map((x) => x.name).join(', ') || 'from it'} — planned.`, b.live, '', 'sale');
  }
  // the transport row — always present, because the owner's rule is the point of the map
  const carrier = isObj(nb.carrier) ? nb.carrier : null;
  const rule = isObj(plan.rule) ? plan.rule : null;
  const liveLane = firstLiveLane(d, nid);
  let transportText, transportLive;
  /* 🔴 THIS LINE AND THE TRANSPORT PARTNER ROW ANSWER TWO DIFFERENT QUESTIONS.
     Round 1 printed, badged LIVE, "Transport is not involved: a marketplace
     sale hands goods over the counter." — and four sections down the SAME card
     printed partners.js's Transportation Company row, also badged LIVE, "Works
     today", "Transport delivers what is sold here — the last leg of pickup,
     haul, depot, deliver". Section 5 sided with the first one. A player was
     told twice that no carrier touches a marketplace sale and once, with equal
     authority, that a carrier runs its last leg.
     Both sentences are true of DIFFERENT events: the sale is a hand-over at a
     counter, and the haul afterwards is freight a buyer may book. So this line
     is narrowed to the sale instead of denying the carrier, in section 5's own
     existing words ("only run when a business buys it and the seller books a
     freight haul") rather than a third phrasing — and the carrier partner row
     gets the matching qualifier in section 6 below. Deleting either half was
     rejected: partners.js owns that row (another piece), and the carrier fact
     is true.
     🔴 AND A SYSTEM'S DENIAL IS PER-SYSTEM, NOT ONE STRING FOR ALL FOUR.
     Round 2 printed the same flat "Transport is not involved: loot and city
     goods land in your own stash, nothing is hauled." on all four system
     cards. On sys:battle and sys:camp that is true and section 5 says the
     same thing (a squad carries loot home). On sys:business it is FALSE
     twice over: Just Business makes 93 crafted products, not "loot and city
     goods", and section 5, section 6's Transportation Company row and
     section 7 all say the opposite — "no business ships straight to
     another". That is the owner's rule verbatim, so the denial is the wrong
     sentence, not the partner row. sys:city is the same shape: a city banks
     its own output, but a city depot is where somebody else's haul ENDS, so
     a flat "not involved" misreads the tile.
     Each system therefore gets the sentence section 5 already gives it. The
     wording is kept close to shipsVM's `out.empty` on purpose: two sections
     of the same card must not paraphrase one fact into two facts. */
  if (type === 'channel') { transportText = 'The sale itself needs no haul: a marketplace listing is handed over the counter. Transport only runs afterwards, when a business buys it and the seller books a freight haul.'; transportLive = true; }
  else if (type === 'system') {
    transportText = nid === 'sys:battle' ? 'You haul nothing in a fight: loot is carried home by your own squad, and a squad is never freight.'
      : nid === 'sys:camp' ? 'You haul nothing out here: a camp is fed from your own stash and its missions bring goods straight back.'
      : nid === 'sys:city' ? 'The city itself hauls nothing — buildings bank straight into your ledger. A city truck depot is the other end of a lane: it is where a business’s haul ENDS (see section 5).'
      /* ⚠ THE ROUTING HALF IS NOT IN THIS SENTENCE, AND THAT IS DELIBERATE.
         The first draft read "…Every business on it ships through a Transport
         company: pickup, haul, depot, deliver, and no business ships straight
         to another" and badged the whole thing LIVE — while section 5 of the
         same card prints that same rule badged PLANNED. Fixing one
         contradiction by writing a second one. The clause that is true TODAY
         stays here; the owner's routing rule is pushed as its own row below,
         in shipping.js's exact words and with section 5's exact badge. */
      : 'Just Business hauls nothing itself — it is the roster, not a tile: each business you own does its own shipping (section 5).';
    transportLive = true;
  }
  else if (liveLane) { transportText = `Transport required — enforced today for ${liveLane}.`; transportLive = true; }
  else if (node.service && !(carrier && carrier.lanes && carrier.lanes.length)) { transportText = `Ships nothing: ${node.service}`; transportLive = true; }
  else { transportText = 'Transport required — planned. ' + (rule && rule.sentence ? stripTag(rule.sentence) : 'Today a carrier is optional on this lane.'); transportLive = false; }
  push(transportText, transportLive, 'public/src/transport/routes.js PHASE', 'transport');
  if (liveLane && type === 'business') push('Transport required for everything else it ships — planned. ' + (rule && rule.sentence ? stripTag(rule.sentence) : ''), false, '', 'transport');
  /* The owner's routing rule on the roster card, read from shipping.js so it
     is the SAME STRING section 5 paints, with the same PLANNED badge. Typing a
     paraphrase here is what made section 2 and section 5 disagree twice. */
  if (nid === 'sys:business') { const rt = str(isObj(d.shipping) && isObj(d.shipping.RULE) ? d.shipping.RULE.text : ''); if (rt) push(rt, false, 'public/src/supplychain/shipping.js RULE', 'transport'); }
  const summ = isObj(node.needsSummary) ? node.needsSummary : {};
  const ambig = arr(node.ambiguities).map((code) => safe(() => (fn(d.businesses && d.businesses.ambiguityById) ? d.businesses.ambiguityById(code) : null), null)).filter(isObj).map((a) => ({ code: a.id, title: str(a.title), readings: arr(a.readings).map((x) => str(x)) }));
  const works = {
    rows: ledger,
    counts: { live: ledger.filter((r) => r.live).length, planned: ledger.filter((r) => !r.live).length, needs: num(summ.needs) || 0, needsLive: num(summ.live) || 0, needsPlanned: num(summ.proposed) || 0 },
    ambiguities: ambig,
    empty: ledger.length ? null : 'No facts recorded for this tile.',
  };

  /* ── 3 · What you need to start ───────────────────────────────────── */
  const ns = isObj(plan.needToStart) ? plan.needToStart : {};
  const cinder = isObj(ns.cinder) ? ns.cinder : {};
  const aza = isObj(ns.aza) ? ns.aza : {};
  const startupAmt = eco ? num(eco.startup) : null;
  const afford = gems !== null && startupAmt ? (gems >= startupAmt ? 'ready' : gems >= startupAmt * ((SC.plan && SC.plan.afford && SC.plan.afford.close) || 0.5) ? 'close' : 'far') : str(cinder.afford, 'unknown');
  const startRes = arr(ns.resources).map((r) => ({
    ...res(r.id), live: r.live !== false, when: str(r.when), screen: str(r.screen),
    where: str(r.whereShort) || str(r.whereToFind) || 'no source recorded', whereFull: str(r.whereFull) || str(r.whereToFind),
    perHrFullCrew: num(r.perHrFullCrew), why: str(r.why), lootable: r.lootable !== false, madeBy: arr(r.madeBy).map((b) => ({ id: b, label: labelOf(b) })),
    held: heldOf(r.id), tier: num(r.tier),
  }));
  const start = {
    cinder: { amount: startupAmt, text: (startupAmt !== null ? (str(cinder.text) || `${fmtInt(startupAmt)} Cinder for the licence.`) : type !== 'business' ? (str(cinder.text) || 'Nothing to buy — this is a part of the game, not a licence.') : live ? 'Figure unavailable — the game’s economy table did not answer (offline, or no bridge). Nothing here is priced.' : (str(cinder.text) || 'Not set — this business is not in the game yet.')), unavailable: live && type === 'business' && startupAmt === null, afford, held: gems, live: cinder.live !== false },
    aza: { amount: eco ? num(eco.azaStartup) : null, text: str(aza.text) || 'No Aza price.', live: aza.live !== false },
    figures: eco ? {
      workers: maxWorkers, ratePerWorkerHr: num(eco.ratePerWorkerHr), salaryPerWorkerHr: num(eco.salaryPerWorkerHr),
      source: `the game’s own table for ${label}`,
    } : null,
    businesses: arr(ns.businesses).map((b) => ({ id: b.id, glyph: glyphOf(b.id), label: labelOf(b.id) || str(b.label), role: str(b.role, 'supplier'), live: b.live !== false, exists: b.exists !== false, owned: b.owned === true || ownsOf(b.id), drawn: b.drawn !== false, cargo: arr(b.cargo).map(res), how: str(b.how), why: str(b.why) })),
    resources: startRes.filter((r) => r.live), planned: startRes.filter((r) => !r.live),
    notes: arr(ns.notes).map((n) => ({ appliesTo: arr(n && n.appliesTo), text: str(n && n.text) })).filter((n) => n.text),
    screenMore: arr(ns.screenMore).map((x) => (typeof x === 'string' ? x : str(x && x.name) || str(x && x.id))).filter(Boolean),
    door: str(plan.effortWhy),
    empty: null,
  };
  if (!start.resources.length && !start.businesses.length) {
    start.empty = type !== 'business' ? 'Nothing to gather first — you are already in it.'
      : start.planned.length ? `Nothing to stock today: it burns no resource and the map hangs no supplier on it. The owner’s plan would add ${start.planned.length} need${start.planned.length === 1 ? '' : 's'} (below), switched off for now.`
      : 'Nothing but the licence: it burns no stock and the map hangs no supplier on it.';
  }

  /* ── 4 · What it needs to run ─────────────────────────────────────── */
  const perHrOf = (rid) => (eco && isObj(eco.inputs) && num(eco.inputs[rid]) !== null && maxWorkers ? num(eco.inputs[rid]) * maxWorkers : null);
  const lootRows = arr(node.lootNeeds).map((l) => ({
    ...res(l.id), live: l.live !== false, roles: arr(l.roles).map((x) => str(x)), why: str(l.why),
    where: arr(l.where).map((w) => ({ id: str(w.id), label: str(w.label), system: str(w.system), via: str(w.via), viaText: via(w.via) })),
    lootable: l.lootable !== false, madeBy: arr(l.madeBy).map((b) => ({ id: b, label: labelOf(b) })), perHr: perHrOf(l.id),
    buyable: l.buyable === true, madeIn: str(l.madeIn),
  }));
  const otherRows = arr(node.otherNeeds).map((l) => ({
    ...res(l.id), live: l.live !== false, roles: arr(l.roles).map((x) => str(x)), why: str(l.why), where: [],
    lootable: false, madeBy: arr(l.madeBy).map((b) => ({ id: b, label: labelOf(b) })), perHr: perHrOf(l.id),
  }));
  const bizRows = arr(node.bizNeeds).map((b) => ({
    id: b.biz, glyph: glyphOf(b.biz), label: labelOf(b.biz), cargo: arr(b.cargo).map(res), liveIds: arr(b.liveIds), live: b.live !== false, pdf: !!b.pdf,
    direction: str(b.direction, 'supplier'), confidence: str(b.confidence), why: str(b.why), owned: ownsOf(b.biz),
  }));
  const run = {
    loot: lootRows.filter((r) => r.live), lootPlanned: lootRows.filter((r) => !r.live),
    other: otherRows, businesses: bizRows,
    empty: (lootRows.length || otherRows.length || bizRows.length) ? null
      : (type === 'channel' ? 'A marketplace needs nothing to run: sellers bring stock, buyers bring Cinder.' : type === 'system' ? 'A system needs players, not stock.' : node.service ? 'It runs on staff, not stock: ' + node.service : 'The map records no input for it.'),
  };

  /* ── 5 · Ships via Transport ──────────────────────────────────────── */
  const ships = shipsVM(d, node, nid, type, label, labelOf, res, buyers, bizRows, carrier, rule, liveLane);

  /* ── 6 · Best businesses to work with ─────────────────────────────── */
  /* The counter lanes section 5 prints, keyed by channel id. Section 6 reads
     the SAME map (see the note under it) and so does the synthesiser below, so
     a counter can never answer one way at the top of the card and another way
     at the bottom. */
  const laneOf = new Map();
  for (const b of buyers) if (b && b.counterEdge && str(b.id).indexOf('ch:') === 0) laneOf.set(str(b.id), b);
  const partnersFull = synthLegendRows(partnersAll, node, nid, g, laneOf, labelOf);
  const partnersPick = pinLegendPartners(partnersFull, node.badges, MAX_PARTNERS);
  /* 🔴 A COUNTER ROW MAY NOT DISAGREE WITH ITS OWN LANE.
     Lifting the Car Marketplace row onto the Oil Company card put two opposite
     facts on ONE screen for the first time: section 5 read "LIVE · To Car
     Marketplace: Fuel, Naphtha, Kerosene, Diesel +10" (it takes the edge) and
     section 6 read "Car Marketplace · PLANNED · no lane behind it is built
     yet" with no chips (it takes partners.js's own tier-1 verdict). Gas
     Station was the same at row 11. Neither row was VISIBLE before the lift,
     so the piece that lifted them owns the contradiction.
     The fix is to answer a counter question once: a partner row that names a
     CHANNEL takes its live flag, its status sentence and its chips from the
     same `channel:<biz>><ch>` edge section 5 reads (`counterEdge` rows only —
     a sellsTo that names a system has no such edge and keeps partners.js's
     answer, which is about a different question).
     It also settles the halves of the agri/feed answer: when the counter's
     cargo is empty, section 6 now prints the counter's OWN scope sentence —
     the identical one section 5 prints — instead of a line that reads as an
     endorsement of a counter the card has just emptied.
     REJECTED: overriding only when the two disagree. The agreement would then
     be accidental on every other tile, and nothing would notice when it
     stopped. One source of truth per fact, always read.
     (`laneOf` itself is built a few lines ABOVE section 6's slice, because the
     synthesiser below needs the same map — see synthLegendRows().) */
  /* 🔴 "NOT IN THE LIST ABOVE" IS ONLY TRUE WHILE IT IS NOT IN THE LIST.
     partners.js composes that aside precisely BECAUSE the legend rows sank
     below this cut (its own comment says so). The lift falsifies the premise
     and partners.js cannot know: it runs before the lift and owns another
     piece's file. So the sentence is dropped HERE, on the row that hosts it,
     as soon as any of the rows it speaks for is on screen — it was printed on
     Oil Company's row 5 with the Car Marketplace itself sitting at row 17.
     Only the aside goes; the host row's own reasons are untouched, and a fold
     whose rows are all still below the cut (the ch:carmarket card summarising
     oil/gas/agri/feed — none of them a legend node, so none of them lifted)
     keeps its line exactly as before.
     The test is EVERY id, not any: a sentence that still speaks for a row the
     reader cannot see is doing its job for that row, and half a composed
     sentence cannot be re-written from here (partners.js composes it). Measured
     on the real page: all five folds are all-or-nothing today (oil, gas, agri,
     feed lift their single folded id; the ch:carmarket card lifts none), so the
     stricter test costs nothing and cannot silently swallow a live aside later.
     ⚠ KNOWN PIN: tools/supplychain/pw-carmarket.mjs asserts Oil Company's card
     DRAWS this aside — a pin written when the Car Marketplace row was rank 17
     of 17 and unreachable. The row is on the card now, so the pin's premise is
     gone; its intent (the tow truck is explained on the tile's own card) is met
     by the row itself. That file belongs to another piece and is not touched
     here. */
  const visibleIds = new Set(partnersPick.rows.map((r) => str(r && r.id)));
  const partners = partnersPick.rows.map((p) => {
    const lane = laneOf.get(str(p.id)) || null;
    const laneLive = lane ? lane.live !== false : false;
    const foldText = str(p.foldLineShown) || str(p.foldLine);
    const foldStale = !!foldText && arr(p.foldIds).length > 0 && arr(p.foldIds).every((x) => visibleIds.has(str(x)));
    const reasons = uniq(arr(p.lines).map((l) => str(l && l.text)).concat(arr(p.reasons).map((x) => str(x))))
      .filter((t) => t && !(foldStale && t === foldText)).slice(0, 3);
    /* ⚠ A PARTNER CHIP MAY NOT LOOK LIVE OVER AN ID SECTION 1 CALLS PLANNED.
       resChip dims only on `live === false`, and a partner's cargo carries no
       live flag at all, so the dimming was structurally unreachable: 57 chips
       over 16 cards (ch:carmarket · Trucks, mining · Stone, fashion · Cloth …)
       rendered undimmed, 40 of them inside a row badged LIVE, while the TOP of
       the same card badged the very same id PLANNED. `plannedHere` is
       deliberately card-local — the rows this card actually prints — because
       that is the only place a reader can see the two claims together. */
    /* ⚠ A SILENT TRUNCATION READS AS A SHORTER LIST, NOT AS A LONGER ONE.
       Section 5 prints Oil Company's counter lane as "Fuel, Naphtha, Kerosene,
       Diesel +10" (14 ids, with the overflow said out loud); section 6 capped
       the same lane at 8 chips and said nothing, so one card carried two
       different counts of ONE lane and the lower one looked authoritative.
       The cap stays (8 chips is the row's width), the REMAINDER is counted and
       printed in the same "+N" form section 5 already uses. */
    const cargoSrc = lane ? arr(lane.counterCargo) : uniq(arr(p.cargo)).map(res);
    const cargo0 = cargoSrc.slice(0, 8);
    const cargoMore = Math.max(0, cargoSrc.length - cargo0.length);
    const cargo = cargo0.map((c) => (c && plannedHere.has(c.id) ? { ...c, live: false } : c));
    /* Dimming a chip is not enough on a row whose own sentence says the goods
       trade today ("Transport shops here for trucks and cars", badged LIVE,
       over a Trucks chip section 1 calls PLANNED). The row says which half is
       which, in the same words section 1 uses. */
    const plannedNames = cargo.filter((c) => c && c.live === false).map((c) => c.name).filter(Boolean);
    const caveats = [str(p.caveat)];
    if (plannedNames.length && (lane ? laneLive : (p.live === true || p.anyLive === true))) {
      caveats.push(`${plannedNames.slice(0, 3).join(', ')}${plannedNames.length > 3 ? ` +${plannedNames.length - 3}` : ''} ${plannedNames.length > 1 ? 'are' : 'is'} on the owner’s map only; the rest of this row works today`);
    }
    /* The other half of the section-2 fix: this row is the one that says a
       carrier runs the last leg of a counter sale, and section 2 now says the
       sale itself needs no haul. Neither is wrong; the row has to say WHEN. */
    if (type === 'channel' && arr(p.roles).concat([str(p.role)]).some((r) => /carrier/i.test(str(r)))) {
      caveats.push('a carrier runs only after the sale, when the buyer books a freight haul; the listing itself is handed over the counter');
    }
    return {
      id: str(p.id), glyph: glyphOf(p.id), label: labelOf(p.id) || str(p.label), rank: num(p.rank) || partnersFull.indexOf(p) + 1,
      legendPinned: partnersPick.pinned.indexOf(str(p.id)) >= 0,
      role: str(p.role), roles: uniq(arr(p.roles).map((x) => str(x))), tierLabel: str(p.tierLabel),
      live: lane ? laneLive : p.live === true, anyLive: lane ? laneLive : p.anyLive === true,
      statusNote: lane ? counterNote(p, lane, laneLive, labelOf(p.id) || str(p.label)) : (str(p.statusNote) || (p.live ? 'Works today' : 'Planned')),
      reasons,
      cargo, cargoMore,
      pdfDrawn: p.pdfDrawn === true, ambiguous: p.ambiguous === true, caveat: caveats.filter(Boolean).join(' · '),
      owned: ownsOf(p.id), exists: !!nodes.find((n) => n && n.id === p.id && n.status !== 'planned'),
    };
  });
  const partnersVM = {
    rows: partners, total: partnersFull.length, pinned: partnersPick.pinned.length,
    /* Said out loud, because the rank numbers jump when it happens and a
       reader is owed the reason: the row is here because the owner drew it. */
    pinnedNote: partnersPick.pinned.length
      ? `${partnersPick.pinned.length === 1 ? 'One partner is' : partnersPick.pinned.length + ' partners are'} listed out of rank order: the owner drew that icon beside this tile, so it belongs on this card whatever it scores.`
        /* The trade is said out loud rather than hidden: a legend row only
           gets on a full list by pushing a higher-ranked one off it, and on
           most tiles the row it pushes off is a named supplier. The reader is
           told how to reach it (the count of partners is printed above). */
        + (arr(partnersPick.displaced).length ? ` ${arr(partnersPick.displaced).length === 1 ? 'One higher-ranked partner was' : arr(partnersPick.displaced).length + ' higher-ranked partners were'} pushed off the list to make room — open the map to see all ${partnersFull.length}.` : '')
      : '',
    empty: partners.length ? null : 'No partner ranked: this tile trades with nobody on the map yet.',
  };

  /* ── 7 · Is this for me ───────────────────────────────────────────── */
  const earn = isObj(plan.earn) ? plan.earn : {};
  const earnRows = [];
  if (earn.known) {
    earnRows.push({ label: `Brings in (all ${fmtInt(earn.workers)} workers)`, value: fmtInt(earn.grossPerHr) + ' Cinder/h', tone: 'gold' });
    earnRows.push({ label: 'Pays in wages', value: '−' + fmtInt(earn.salaryPerHr) + ' Cinder/h', tone: 'ember' });
    earnRows.push({ label: earn.losing ? 'Under water' : 'Keeps', value: (earn.losing ? '−' + fmtInt(earn.shortfallPerHr) : fmtInt(earn.netPerHr)) + ' Cinder/h', tone: earn.losing ? 'blood' : 'green' });
    if (num(earn.paybackHrs) !== null && earn.paybackHrs > 0 && Number.isFinite(earn.paybackHrs)) earnRows.push({ label: 'Licence paid back in', value: fmtHrs(earn.paybackHrs) + (isObj(earn.paybackRank) && earn.paybackRank.place ? ` (${earn.paybackRank.place} of ${earn.paybackRank.of} for speed)` : ''), tone: 'ink' });
    if (isObj(earn.startSmall) && num(earn.startSmall.workers)) earnRows.push({ label: `Starting small (${fmtInt(earn.startSmall.workers)} workers) keeps`, value: fmtInt(earn.startSmall.netPerHr) + ' Cinder/h', tone: 'ink' });
    for (const b of arr(earn.burnsPerHr)) earnRows.push({ label: `Burns ${res(b.id).icon} ${res(b.id).name}`, value: fmtRate(b.perHr) + ' /h', tone: 'ember' });
    for (const y of arr(earn.yieldsPerHr)) earnRows.push({ label: `Makes ${res(y.id).icon} ${res(y.id).name}`, value: fmtRate(y.perHr) + ' /h', tone: 'gold' });
  }
  const planVM = {
    headline: str(plan.headline), basis: str(plan.basis), effort: str(plan.effort), effortWhy: str(plan.effortWhy),
    summary: isObj(plan.summary) ? { should: str(plan.summary.should), first: str(plan.summary.first), costs: str(plan.summary.costs), keeps: str(plan.summary.keeps) } : null,
    fitFor: arr(plan.fitFor).map((f) => ({ style: str(f.style), label: str(f.label), why: str(f.why), planned: f.planned === true })),
    notFor: arr(plan.notFor).map((f) => ({ style: str(f.style), label: str(f.label), why: str(f.why) })),
    steps: arr(plan.steps).map((s) => ({ n: num(s.n), title: str(s.title), detail: str(s.detail), live: s.live !== false })),
    earn: { known: earn.known === true, rows: earnRows, text: str(earn.text), caveats: arr(earn.caveats).map((x) => str(x)).filter(Boolean), basis: str(earn.basis), source: str(earn.source) },
    risks: arr(plan.risks).map((r) => ({ title: str(r.title), detail: str(r.detail), live: r.live !== false })),
    verdict: isObj(verdict) ? { verdict: str(verdict.verdict), label: str(verdict.label), reasons: arr(verdict.reasons).map((x) => str(x)), firstAction: str(verdict.firstAction) } : null,
    empty: (arr(plan.steps).length || arr(plan.fitFor).length) ? null : 'No plan could be built for this tile — its facts are not on the map yet.',
  };

  const pdf = isObj(node.pdfCite) ? node.pdfCite : {};
  const vm = {
    id: nid, type, label, status: live ? 'live' : 'planned', tag: TAG(live), owned,
    opId: str(node.opId) || null, kind: str(node.kind), kindWord: kindWord(node, type, makes), page: num(node.page), pdfCite: str(pdf.jpg) ? `owner’s map, page ${num(pdf.page) || num(node.page) || '?'}` : '',
    blurb: str(node.blurb) || str(node.caption) || str(node.service) || str(plan.headline),
    glyph: nodeGlyph(node),
    badges: { transport: !!(node.badges && node.badges.transport), market: !!(node.badges && node.badges.market), carMarket: !!(node.badges && node.badges.carMarket), card: !!(node.badges && node.badges.card) },
    hasEcon: !!eco, unknown: false,
    sections: sectionsFor(type, !!dropCover),
    makes, works, start, run, ships, partners: partnersVM, plan: planVM,
    buttons: {
      highlight: true,
      open: type === 'business' && live && (owned || !!eco), openLabel: owned ? 'Open yours in Just Business' : 'Open in Just Business',
      copyProposal: o.admin === true && !!o.proposal,
    },
    admin: o.admin === true,
  };
  /* The admin keeps every cite; a player keeps every fact and none of the
     identifiers. See PLAYER WORDS above. */
  return vm.admin ? vm : scrubVM(vm);
}

/* The word under the tile's name. The graph's `kind` is an INTERNAL bucket and
   was printed raw, so the Dojo — which sells training and also makes one
   product — announced itself as "PRODUCER" while the rest of the card talked
   about a service. Rewriting the graph was rejected: `kind` drives the scene's
   layout and several siblings match on it, and the Dojo really is filed as a
   producer there. The honest fix is in the view: say what the player will
   actually do with it, from what the tile has. */
function kindWord(node, type, makes) {
  if (type !== 'business') return type;
  const k = str(node.kind);
  if (k === 'hub') return 'carrier';
  if (k === 'cityTransit') return 'city transit';
  const sells = !!str(node.service);
  const products = isObj(makes) ? (num(makes.total) || arr(makes.rows).length) : 0;
  if (k === 'service' || !products) return 'service';
  return sells ? 'producer & service' : 'producer';
}

/* Transport's "enforced today" is a per-lane fact the shipping module owns
   (LIVE_LANES). Ask it, do not retype the two lanes here. */
function firstLiveLane(d, nid) {
  const ll = d.shipping && d.shipping.LIVE_LANES;
  const rows = Array.isArray(ll) ? ll : (isObj(ll) ? Object.values(ll) : []);
  for (const l of rows) {
    if (!isObj(l)) continue;
    const from = str(l.from) || str(l.seller) || str(l.biz);
    if (from === nid || arr(l.tiles).includes(nid) || l.bizId === nid) return str(l.label) || str(l.name) || str(l.what) || 'a live lane';
  }
  return null;
}
const stripTag = (s) => cap(str(s).replace(/^(LIVE|PLANNED):\s*/i, ''));

function shipsVM(d, node, nid, type, label, labelOf, res, buyers, bizRows, carrier, rule, liveLane) {
  const sh = isObj(d.shipping) ? d.shipping : {};
  const RULE = isObj(sh.RULE) ? sh.RULE : {};
  const out = { rule: str(RULE.text), ruleLive: false, phaseText: rule && rule.sentence ? stripTag(rule.sentence) : '', phase: rule ? num(rule.phase) : null, legs: [], cargoClass: '', lanes: [], enforcedToday: !!(carrier && carrier.enforcedToday), liveLane, empty: null, service: str(node.service), inbound: [] };
  if (type !== 'business') {
    out.empty = type === 'system' ? `${label} ships nothing by truck: ${nid === 'sys:battle' ? 'loot is carried home by your own squad, and a squad is never freight' : nid === 'sys:camp' ? 'a camp is fed from your own stash and its missions bring goods straight back' : nid === 'sys:city' ? 'city buildings bank straight into your ledger; a city truck depot is where hauls END' : 'businesses ship to each other — open one to see its lanes'}.` : 'A marketplace is a counter, not a route: a listing is picked up by the buyer. The owner drew the truck on the seller’s tile, so the haul is theirs — a carrier only runs afterwards, when a business buys it and the seller books a freight haul.';
    return out;
  }
  const isService = fn(sh.isServiceTile) ? safe(() => sh.isServiceTile(nid), false) === true : false;
  // representative cargo: the first thing it makes; the first buyer that is a business, else the market
  const firstMake = arr(node.makes).find((m) => m && m.id);
  const firstBiz = buyers.find((b) => !b.channel && b.id && !b.id.startsWith('sys:') && !b.id.startsWith('ch:')) || null;
  const to = firstBiz ? firstBiz.id : 'ch:market';
  const route = fn(sh.route) ? safe(() => sh.route({ from: nid, to, resId: firstMake ? firstMake.id : null, qty: 1 }, d.ctx), null) : null;
  if (route && route.ships !== false && arr(route.legs).length) {
    out.legs = arr(route.legs).map((l) => ({ kind: str(l.kind), word: LEG_WORDS[l.kind] || cap(str(l.kind)), node: str(l.node), label: labelOf(l.node), note: str(l.note), enforcedToday: l.enforcedToday === true }));
    out.cargoClass = str(route.cargoClass);
    out.example = { cargo: firstMake ? res(firstMake.id) : null, to: labelOf(route.deliverTo || to), redirected: route.redirected === true, finalBuyer: route.finalBuyer ? labelOf(route.finalBuyer) : '' };
    out.whatHappensToday = str(route.whatHappensToday);
    out.enforcedToday = route.enforcedToday === true;
    /* 🔴 THE COUNTER CONTRADICTION. When the example lane ends at a channel —
       which it does for every tile whose only drawn buyer is the Marketplace
       or the Car Marketplace — shipping.js still returns the full four-leg
       lane, because that IS the owner's rule for a booked haul. Round 2
       printed it raw: a "the destination needs a finished Transport Depot"
       leg, followed two lines later by "Settles instantly with no haul." A
       marketplace is not an address and has no depot, so the reader was told
       two opposite things about the same sale.
       The strip is kept (the owner's lane is the point of the screen) and
       framed instead: the counter fact goes ABOVE the legs, and the two legs
       that only happen on a booked freight haul are marked as such. */
    out.counterSale = String(route.deliverTo || to).startsWith('ch:');
    if (out.counterSale) {
      out.counterNote = str(route.marketNote) || 'Today a Marketplace sale hands the goods over the counter: no carrier, no depot, no delay.';
      for (const l of out.legs) {
        if (l.kind === 'haul' || l.kind === 'depot') l.counterOnly = true;
        if (l.kind === 'depot') l.note = 'A counter has no depot — the Marketplace is not an address. This stop only exists if a business buys it and the seller books the delivery as a freight haul.';
      }
    }
  } else if (route && route.reason) {
    out.empty = str(route.reason);
  } else if (isService || node.service) {
    out.empty = 'Ships nothing: ' + str(node.service, 'it sells a service, not goods.');
  }
  // every outgoing lane, with cargo class
  const seen = new Set();
  for (const b of buyers) {
    if (seen.has(b.id)) continue; seen.add(b.id);
    /* 🔴 EMPTY CARGO IS THE SIGNAL, NOT A HOLE. Round 1 substituted the tile's
       FIRST PRODUCT for any empty cargo, which is fine for a system lane
       (whose cargo is genuinely unlisted) and a lie for a counter: the Car
       Marketplace lane on Agricultural Op. then read "To Car Marketplace:
       Food" — a product the counter's own scope excludes. A channel lane
       takes the edge's real cargo, and when the edge has none it prints the
       channel's REASON in place of a product it does not sell. */
    const counter = !!b.channel && !b.cargo.length;
    const cargo = b.cargo.length ? b.cargo : counter ? arr(b.counterCargo) : (firstMake ? [res(firstMake.id)] : []);
    const cls = cargo.length && fn(sh.cargoClass) ? str(safe(() => sh.cargoClass(cargo[0].id, d.catalog), '')) : '';
    out.lanes.push({ dir: 'out', id: b.id, label: b.label, cargo, cargoClass: cls, live: b.live, pdf: b.pdf, channel: !!b.channel,
      reason: counter && !cargo.length ? str(b.counterReason) : '' });
  }
  for (const b of bizRows) {
    const cls = b.cargo.length && fn(sh.cargoClass) ? str(safe(() => sh.cargoClass(b.cargo[0].id, d.catalog), '')) : '';
    out.inbound.push({ dir: 'in', id: b.id, label: b.label, cargo: b.cargo, cargoClass: cls, live: b.live, pdf: b.pdf });
  }
  if (!out.legs.length && !out.lanes.length && !out.inbound.length && !out.empty) out.empty = 'No lane touches this tile on the map yet.';
  return out;
}

function unknownVM(id) {
  const empty = (t) => ({ rows: [], empty: t });
  return {
    id, type: 'unknown', label: id || 'Unknown tile', status: 'planned', tag: 'PLANNED', owned: false, opId: null, kind: '', page: null, pdfCite: '',
    blurb: 'This id is not on the map. The graph has no node for it, so nothing below can be filled in.', glyph: '?', badges: {}, hasEcon: false, unknown: true,
    sections: SECTIONS.map((s) => ({ n: s.n, key: s.key, title: s.title })),
    makes: { rows: [], buyers: [], empty: 'Unknown tile — nothing recorded.' }, works: { rows: [], counts: {}, ambiguities: [], empty: 'Unknown tile — nothing recorded.' },
    start: { cinder: { amount: null, text: 'Unknown.', afford: 'unknown' }, aza: { text: 'Unknown.' }, figures: null, businesses: [], resources: [], planned: [], notes: [], screenMore: [], empty: 'Unknown tile — nothing recorded.' },
    run: { loot: [], lootPlanned: [], other: [], businesses: [], empty: 'Unknown tile — nothing recorded.' },
    ships: { legs: [], lanes: [], inbound: [], empty: 'Unknown tile — nothing recorded.' }, partners: empty('Unknown tile — nothing recorded.'),
    plan: { fitFor: [], notFor: [], steps: [], earn: { known: false, rows: [], caveats: [] }, risks: [], verdict: null, empty: 'Unknown tile — nothing recorded.' },
    buttons: { highlight: false, open: false, copyProposal: false }, admin: false,
  };
}

/* ═══════════════════════════════════════════════════════════════════════════
   DOM half
   ═══════════════════════════════════════════════════════════════════════════ */
/* 🔴 CLASS COLLISION, found by driving the modal inside the REAL
   public/index.html for the first time. The host used to be `.sc-modal` —
   and index.html has owned a `.sc-modal` of its own since long before this
   feature (line ~25645, the serial-certificate dialog): `width:94%;
   max-width:880px; max-height:90vh`. Those three declarations beat our
   `inset:0` on the same specificity by arriving later in the cascade, so the
   host stopped filling the viewport and shrink-wrapped the card into the
   top-left corner — a backdrop over one sixth of the screen, the rest of the
   game still live and clickable behind it. Every harness passed, because the
   harness page has no index.html stylesheet in it.
   The prefix is now `scx-` (nothing in index.html matches `scx-` or `scm-`).
   The PROBE STAYS `[data-sc-modal]`: it is what every suite and every sibling
   piece selects on, and an attribute cannot be styled out from under us. */
const HOST_CLASS = 'scx-modal';
const CSS_ID = 'scx-modal-css';

/* Ruin Ledger tokens with fallbacks: inside index.html the :root tokens win;
   in the harness page (no index.html) the fallbacks are the same values as
   SC.palette, so the two never disagree on a colour. Radius stays at or under
   6px everywhere but the status chip (DESIGN-BAR 3). */
const P = (SC && SC.palette) || {};
const CSS = `
.${HOST_CLASS}{position:fixed;inset:0;z-index:20;display:flex;align-items:flex-start;justify-content:center;padding:0 16px 3vh;overflow:auto;background:rgba(6,5,4,.78);color-scheme:dark;
  --scm-bg:var(--bg-panel,${P.bgPanel || '#17150f'});--scm-card:var(--bg-card,${P.bgCard || '#1c1813'});--scm-deep:var(--bg-deep,${P.bgDeep || '#0c0b0a'});
  --scm-gold:var(--gold,${P.gold || '#d4af37'});--scm-goldb:var(--gold-bright,${P.goldBright || '#f5d76e'});--scm-ink:var(--ink,${P.ink || '#e8e0d0'});--scm-dim:var(--ink-dim,${P.inkDim || '#a89888'});
  --scm-ember:${P.ember || '#e85d3c'};--scm-blood:${P.blood || '#a02828'};--scm-green:${P.emerald || '#3aa86b'};--scm-parch:${P.parchment || '#d9cbaa'};--scm-parchink:${P.parchmentInk || '#241f16'};
  --scm-line:rgba(198,160,74,.34);--scm-soft:rgba(198,160,74,.16);
  font-family:'Crimson Text','EB Garamond',Georgia,serif;font-size:15px;line-height:1.45;color:var(--scm-ink)}
.${HOST_CLASS} *{box-sizing:border-box;min-width:0}
.${HOST_CLASS} .scm-card{position:relative;margin-top:3vh;width:100%;max-width:${MAX_WIDTH}px;background:var(--scm-bg);border:1px solid var(--scm-line);border-radius:4px;box-shadow:inset 0 0 0 1px rgba(0,0,0,.5),0 18px 60px rgba(0,0,0,.7);
  background-image:repeating-linear-gradient(135deg,rgba(255,255,255,.012) 0 2px,transparent 2px 7px)}
.${HOST_CLASS} .scm-card:before,.${HOST_CLASS} .scm-card:after{content:'';position:absolute;width:10px;height:10px;border:2px solid var(--scm-gold);pointer-events:none}
.${HOST_CLASS} .scm-card:before{top:-1px;left:-1px;border-right:0;border-bottom:0}
.${HOST_CLASS} .scm-card:after{bottom:-1px;right:-1px;border-left:0;border-top:0}
.${HOST_CLASS} .scm-head{position:sticky;top:0;z-index:2;display:flex;align-items:flex-start;gap:12px;padding:14px 18px 10px;background:var(--scm-deep);border-bottom:1px solid var(--scm-line)}
.${HOST_CLASS} .scm-glyph{font-size:28px;line-height:1;padding-top:2px;flex:0 0 auto}
.${HOST_CLASS} .scm-title{flex:1 1 auto}
.${HOST_CLASS} h2,.${HOST_CLASS} h3{font-family:'Cinzel',serif;letter-spacing:.06em;text-transform:uppercase;margin:0;font-weight:700}
.${HOST_CLASS} h2{font-size:22px;color:var(--scm-goldb);line-height:1.15}
.${HOST_CLASS} .scm-sub{font-size:13px;color:var(--scm-dim);letter-spacing:.08em;text-transform:uppercase;margin-top:3px}
.${HOST_CLASS} .scm-close{flex:0 0 auto;font-family:'Cinzel',serif;font-size:13px;letter-spacing:.1em;background:transparent;color:var(--scm-goldb);border:1px solid var(--scm-line);border-radius:3px;padding:6px 10px;cursor:pointer}
.${HOST_CLASS} .scm-close:hover,.${HOST_CLASS} .scm-close:focus-visible{border-color:var(--scm-goldb);outline:none}
.${HOST_CLASS} .scm-body{padding:6px 18px 18px}
.${HOST_CLASS} .scm-blurb{font-style:italic;color:var(--scm-parch);margin:10px 0 4px}
.${HOST_CLASS} .scm-badges{display:flex;flex-wrap:wrap;gap:6px;margin:8px 0 2px}
.${HOST_CLASS} .scm-tag{display:inline-block;font-family:'Cinzel',serif;font-size:10px;letter-spacing:.12em;padding:2px 7px;border:1px solid currentColor;border-radius:999px;line-height:1.3;vertical-align:middle;white-space:nowrap}
.${HOST_CLASS} .scm-tag.live{color:var(--scm-green)}
.${HOST_CLASS} .scm-tag.planned{color:var(--scm-ember)}
.${HOST_CLASS} .scm-tag.gold{color:var(--scm-goldb)}
.${HOST_CLASS} .scm-tag.dim{color:var(--scm-dim)}
.${HOST_CLASS} .scm-tag.owned{color:var(--scm-green);background:rgba(58,168,107,.12)}
.${HOST_CLASS} .scm-jump{position:sticky;top:var(--scm-headh,64px);z-index:1;display:flex;flex-wrap:wrap;gap:5px;margin:10px -18px 0;padding:8px 18px;background:var(--scm-deep);border-bottom:1px solid var(--scm-soft)}
.${HOST_CLASS} .scm-jump button{flex:0 0 auto;display:inline-flex;align-items:center;gap:5px;font-family:'Cinzel',serif;font-size:10.5px;letter-spacing:.1em;text-transform:uppercase;background:transparent;color:var(--scm-dim);border:1px solid var(--scm-soft);border-radius:3px;padding:3px 8px;cursor:pointer;white-space:nowrap}
.${HOST_CLASS} .scm-jump button i{font-style:normal;color:var(--scm-gold)}
.${HOST_CLASS} .scm-jump button:hover,.${HOST_CLASS} .scm-jump button:focus-visible{color:var(--scm-goldb);border-color:var(--scm-goldb);outline:none}
.${HOST_CLASS} section{margin-top:16px;scroll-margin-top:var(--scm-stick,130px);border:1px solid var(--scm-soft);border-radius:3px;background:var(--scm-card)}
.${HOST_CLASS} section>h3{display:flex;align-items:center;gap:10px;font-size:13px;color:var(--scm-goldb);padding:8px 12px;border-bottom:1px solid var(--scm-soft);background:rgba(0,0,0,.25)}
.${HOST_CLASS} section>h3 .n{display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;border:1px solid var(--scm-gold);border-radius:3px;font-size:12px;color:var(--scm-gold)}
.${HOST_CLASS} section>h3 .cnt{margin-left:auto;font-family:'Crimson Text',Georgia,serif;font-size:12px;letter-spacing:.04em;text-transform:none;color:var(--scm-dim);font-weight:400}
.${HOST_CLASS} .scm-sec{padding:10px 12px 12px}
.${HOST_CLASS} .scm-empty{color:var(--scm-dim);font-style:italic}
.${HOST_CLASS} .scm-lbl{font-family:'Cinzel',serif;font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:var(--scm-dim);margin:10px 0 6px}
.${HOST_CLASS} .scm-lbl:first-child{margin-top:0}
.${HOST_CLASS} .scm-chips{display:flex;flex-wrap:wrap;gap:6px}
.${HOST_CLASS} .scm-res{display:inline-flex;align-items:center;gap:6px;padding:4px 8px;border:1px solid var(--scm-soft);border-radius:3px;background:rgba(0,0,0,.25);font-size:14px;max-width:100%}
.${HOST_CLASS} .scm-res .ic{font-size:16px;line-height:1}
.${HOST_CLASS} .scm-res .held{font-size:11px;color:var(--scm-dim);letter-spacing:.04em}
.${HOST_CLASS} .scm-res .held.has{color:var(--scm-green)}
.${HOST_CLASS} .scm-res.planned{opacity:.7;border-style:dashed}
/* WRAP, don't clip. At 390 the Research Facility buyer chip on the medical
   card ran its cargo list long enough to push the LIVE/PLANNED tag past the
   card edge, where it was cut to "PLANNEI". The card itself never scrolled
   sideways, so every no-horizontal-scroll check passed while the tag was
   unreadable. A chip is allowed two lines. */
.${HOST_CLASS} .scm-buyer{display:inline-flex;align-items:center;flex-wrap:wrap;gap:4px 6px;padding:4px 8px;border:1px solid var(--scm-soft);border-radius:3px;background:rgba(0,0,0,.25);font-size:14px;max-width:100%}
.${HOST_CLASS} .scm-buyer .ic{font-size:16px;line-height:1}
.${HOST_CLASS} .scm-buyer .held{font-size:11px;color:var(--scm-dim);letter-spacing:.04em}
.${HOST_CLASS} .scm-buyer.planned{opacity:.7;border-style:dashed}
.${HOST_CLASS} .scm-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:8px}
.${HOST_CLASS} .scm-tile{border:1px solid var(--scm-soft);border-radius:3px;padding:8px 10px;background:rgba(0,0,0,.22)}
.${HOST_CLASS} .scm-tile.planned{border-style:dashed;opacity:.82}
.${HOST_CLASS} .scm-tile .t{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.${HOST_CLASS} .scm-tile .t b{font-size:15px}
.${HOST_CLASS} .scm-tile .t .ic{font-size:20px;line-height:1}
.${HOST_CLASS} .scm-tile .m{font-size:13px;color:var(--scm-dim);margin-top:3px}
.${HOST_CLASS} .scm-tile .m b{color:var(--scm-ink);font-weight:600}
.${HOST_CLASS} .scm-ledger{list-style:none;margin:0;padding:0}
.${HOST_CLASS} .scm-ledger li{display:flex;gap:10px;align-items:flex-start;padding:6px 0;border-bottom:1px solid rgba(198,160,74,.10)}
.${HOST_CLASS} .scm-ledger li:last-child{border-bottom:0}
.${HOST_CLASS} .scm-ledger .scm-tag{flex:0 0 auto;margin-top:3px;min-width:74px;text-align:center}
.${HOST_CLASS} .scm-ledger .why{display:block;font-size:12.5px;color:var(--scm-dim);margin-top:2px}
.${HOST_CLASS} .scm-rows{width:100%;border-collapse:collapse}
.${HOST_CLASS} .scm-rows td{padding:5px 0;border-bottom:1px solid rgba(198,160,74,.10);vertical-align:top}
.${HOST_CLASS} .scm-rows td.v{text-align:right;white-space:nowrap;font-family:'Rajdhani','Cinzel',monospace;font-weight:600;font-size:16px;letter-spacing:.03em;padding-left:12px}
.${HOST_CLASS} .v.gold{color:var(--scm-goldb)}.${HOST_CLASS} .v.ember{color:var(--scm-ember)}.${HOST_CLASS} .v.green{color:var(--scm-green)}.${HOST_CLASS} .v.blood{color:#e05555}.${HOST_CLASS} .v.ink{color:var(--scm-ink)}
.${HOST_CLASS} .scm-big{font-family:'Rajdhani','Cinzel',serif;font-size:26px;font-weight:700;color:var(--scm-goldb);letter-spacing:.03em;line-height:1.1}
.${HOST_CLASS} .scm-big small{font-family:'Cinzel',serif;font-size:11px;letter-spacing:.12em;color:var(--scm-dim);display:block;margin-top:2px}
.${HOST_CLASS} .scm-cols{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.${HOST_CLASS} .scm-afford{font-size:13px;margin-top:4px}
.${HOST_CLASS} .scm-afford.ready{color:var(--scm-green)}.${HOST_CLASS} .scm-afford.close{color:var(--scm-goldb)}.${HOST_CLASS} .scm-afford.far{color:var(--scm-ember)}.${HOST_CLASS} .scm-afford.unknown{color:var(--scm-dim)}
.${HOST_CLASS} .scm-route{display:flex;align-items:stretch;gap:0;overflow-x:auto;padding:4px 0}
.${HOST_CLASS} .scm-leg{flex:1 1 0;min-width:120px;border:1px solid var(--scm-line);border-radius:3px;padding:8px 10px;background:rgba(0,0,0,.25);position:relative;margin-right:18px}
.${HOST_CLASS} .scm-leg:last-child{margin-right:0}
.${HOST_CLASS} .scm-leg.counter{border-style:dashed;opacity:.62}
.${HOST_CLASS} .scm-leg:not(:last-child):after{content:'›';position:absolute;right:-15px;top:50%;transform:translateY(-50%);color:var(--scm-gold);font-size:22px;line-height:1}
.${HOST_CLASS} .scm-leg .k{font-family:'Cinzel',serif;font-size:11px;letter-spacing:.12em;color:var(--scm-goldb)}
.${HOST_CLASS} .scm-leg .w{font-size:14px;margin-top:2px}
.${HOST_CLASS} .scm-leg .w small{display:block;color:var(--scm-dim);font-size:12px;margin-top:2px}
.${HOST_CLASS} .scm-partner{display:block;width:100%;text-align:left;font:inherit;color:inherit;background:rgba(0,0,0,.22);border:1px solid var(--scm-soft);border-radius:3px;padding:8px 10px;cursor:pointer}
.${HOST_CLASS} .scm-partner:hover,.${HOST_CLASS} .scm-partner:focus-visible{border-color:var(--scm-goldb);outline:none;background:rgba(212,175,55,.06)}
.${HOST_CLASS} .scm-partner .r{display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;border:1px solid var(--scm-gold);border-radius:3px;font-family:'Cinzel',serif;font-size:12px;color:var(--scm-gold);margin-right:8px}
.${HOST_CLASS} .scm-partner .nm{font-family:'Cinzel',serif;font-size:14px;letter-spacing:.04em;color:var(--scm-goldb)}
.${HOST_CLASS} .scm-partner .role{font-size:12px;color:var(--scm-dim);letter-spacing:.06em;text-transform:uppercase;margin-left:8px}
.${HOST_CLASS} .scm-partner p{margin:4px 0 0;font-size:14px}
.${HOST_CLASS} .scm-partner .go{float:right;color:var(--scm-gold);font-size:18px;line-height:1}
.${HOST_CLASS} .scm-ex{counter-reset:s;display:grid;gap:8px}
.${HOST_CLASS} .scm-step{background:var(--scm-parch);color:var(--scm-parchink);border-radius:3px;padding:8px 10px 8px 42px;position:relative;border:1px solid rgba(0,0,0,.35)}
.${HOST_CLASS} .scm-step:before{content:attr(data-n);position:absolute;left:10px;top:8px;width:24px;height:24px;display:flex;align-items:center;justify-content:center;font-family:'Cinzel',serif;font-weight:700;border:1px solid var(--scm-parchink);border-radius:3px;font-size:13px}
.${HOST_CLASS} .scm-step b{font-family:'Cinzel',serif;font-size:13px;letter-spacing:.04em}
.${HOST_CLASS} .scm-step .scm-tag{color:var(--scm-parchink);opacity:.8;margin-left:6px}
.${HOST_CLASS} .scm-step p{margin:3px 0 0;font-size:14px}
.${HOST_CLASS} .scm-fit{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.${HOST_CLASS} .scm-fit ul{margin:0;padding:0 0 0 18px}
.${HOST_CLASS} .scm-fit li{margin:3px 0}
.${HOST_CLASS} .scm-fit .yes{color:var(--scm-green)}.${HOST_CLASS} .scm-fit .no{color:var(--scm-ember)}
.${HOST_CLASS} .scm-verdict{border:1px solid var(--scm-line);border-radius:3px;padding:8px 10px;margin-top:10px;background:rgba(0,0,0,.25)}
.${HOST_CLASS} .scm-verdict b{font-family:'Cinzel',serif;letter-spacing:.06em}
.${HOST_CLASS} .scm-verdict.yes b{color:var(--scm-green)}.${HOST_CLASS} .scm-verdict.maybe b{color:var(--scm-goldb)}.${HOST_CLASS} .scm-verdict.no b,.${HOST_CLASS} .scm-verdict.not-yet b{color:var(--scm-ember)}
.${HOST_CLASS} .scm-risk{border-left:3px solid var(--scm-ember);padding:4px 10px;margin:6px 0;background:rgba(232,93,60,.06)}
.${HOST_CLASS} .scm-risk b{font-size:14px}
.${HOST_CLASS} .scm-risk p{margin:2px 0 0;font-size:13.5px;color:var(--scm-dim)}
.${HOST_CLASS} .scm-note{font-size:13px;color:var(--scm-dim);margin-top:6px}
.${HOST_CLASS} .scm-more{font:inherit;font-size:13px;background:transparent;border:1px solid var(--scm-soft);border-radius:3px;color:var(--scm-goldb);padding:4px 10px;cursor:pointer;margin-top:8px}
.${HOST_CLASS} .scm-more:hover,.${HOST_CLASS} .scm-more:focus-visible{border-color:var(--scm-goldb);outline:none}
.${HOST_CLASS} [data-more]{display:none}
.${HOST_CLASS} [data-more].open{display:block}
.${HOST_CLASS} .scm-actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:16px;padding-top:12px;border-top:1px solid var(--scm-line)}
.${HOST_CLASS} .scm-btn{font-family:'Cinzel',serif;font-size:12px;letter-spacing:.1em;text-transform:uppercase;padding:9px 14px;border-radius:2px;cursor:pointer;border:1px solid var(--scm-gold);background:transparent;color:var(--scm-goldb)}
.${HOST_CLASS} .scm-btn.primary{background:linear-gradient(180deg,var(--scm-goldb),var(--scm-gold));color:#1a1408;border-color:var(--scm-goldb)}
.${HOST_CLASS} .scm-btn:hover,.${HOST_CLASS} .scm-btn:focus-visible{outline:none;box-shadow:0 0 0 1px var(--scm-goldb)}
.${HOST_CLASS} .scm-foot{margin-top:12px;font-style:italic;color:var(--scm-dim);font-size:13px;display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap}
.${HOST_CLASS} a.scm-link{color:var(--scm-goldb);text-decoration:underline dotted;cursor:pointer}
@media (max-width:600px){
  .${HOST_CLASS}{padding:0}
  .${HOST_CLASS} .scm-card{margin-top:0;border-left:0;border-right:0;border-radius:0;min-height:100%}
  .${HOST_CLASS} .scm-card:before,.${HOST_CLASS} .scm-card:after{display:none}
  .${HOST_CLASS} .scm-head{padding:10px 12px 8px}
  .${HOST_CLASS} h2{font-size:18px}
  .${HOST_CLASS} .scm-body{padding:4px 12px 14px}
  /* the jump bar bleeds to the card edge, so its negative margin must match
     the body padding of THIS breakpoint (12, not 18) or the card is 6px wider
     than the viewport and the whole page scrolls sideways */
  /* WRAP, do not scroll. A horizontal scroller here hid sections 6 and 7 —
     the two a player came for — behind a gesture nothing advertises. Two
     wrapped rows of smaller chips cost ~30px of sticky height and show all
     seven. */
  .${HOST_CLASS} .scm-jump{margin:8px -12px 0;padding:6px 12px;gap:4px}
  .${HOST_CLASS} .scm-jump button{font-size:9.5px;letter-spacing:.06em;padding:2px 6px;gap:4px}
  .${HOST_CLASS} .scm-cols,.${HOST_CLASS} .scm-fit{grid-template-columns:1fr}
  .${HOST_CLASS} .scm-grid{grid-template-columns:1fr}
  /* The route is Pickup › Haul › Depot › Deliver. Four legs never fit across a
     390px phone, and round 1 left them in a horizontal scroller — so a phone
     player saw "Pickup › Haul" and no hint that the lane continued. Stack them
     and turn the chevron a quarter-turn so the sequence still reads. */
  .${HOST_CLASS} .scm-route{flex-direction:column;overflow-x:visible}
  .${HOST_CLASS} .scm-leg{min-width:0;margin-right:0;margin-bottom:18px}
  .${HOST_CLASS} .scm-leg:last-child{margin-bottom:0}
  .${HOST_CLASS} .scm-leg:not(:last-child):after{right:auto;left:50%;top:auto;bottom:-15px;transform:translateX(-50%) rotate(90deg)}
  .${HOST_CLASS} .scm-ledger li{flex-direction:column;gap:2px}
  .${HOST_CLASS} .scm-ledger .scm-tag{min-width:0;align-self:flex-start}
  .${HOST_CLASS} .scm-actions .scm-btn{flex:1 1 100%}
}
@media (prefers-reduced-motion:no-preference){ .${HOST_CLASS} .scm-card{animation:scm-in ${(SC.tween && SC.tween.modalMs) || 180}ms ease-out} @keyframes scm-in{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}} }
`;

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const tag = (live, extra) => `<span class="scm-tag ${live ? 'live' : 'planned'}${extra ? ' ' + extra : ''}">${live ? 'LIVE' : 'PLANNED'}</span>`;
const heldChip = (r) => (r.held === null ? '' : `<span class="held${r.held > 0 ? ' has' : ''}">you hold ${fmtInt(r.held)}</span>`);
/* ⚠ A TOOLTIP IS A NOTE A PLAYER READS, SO IT IS A SENTENCE, NEVER AN ID.
   The fallback here used to be `r.id`, and most callers pass no titleText, so
   974 chips across the 33 cards answered a hover with "zincOre" — and a screen
   reader read that aloud. The row already carries prose (its note, or the rate
   line section 1 paints beside it); the name alone is still a word a player
   uses. The id is the one thing that must never reach the attribute. */
const chipTitle = (r, titleText) => {
  if (str(titleText)) return str(titleText);
  const name = str(r.name) || 'This resource';
  const tail = str(r.note) || str(r.rateText) || str(r.summary);
  if (tail) return /^[a-z]/.test(tail) ? `${name} — ${tail}` : `${name}. ${tail}`;
  /* No row prose (the needs / loot / partner sections pass a bare catalogue
     row), so the sentence is composed from the catalogue's own flags rather
     than from nothing. These are FACTS the snapshot carries, never a guess:
     "Zinc Ore." would clear the no-symbol bar and still teach a hovering
     player nothing. */
  const bits = [];
  if (r.inLedger) bits.push('sits in your stash');
  if (r.inLoot) bits.push('drops as battle loot');
  if (r.inChain) bits.push(`rides the city economy’s own ${str(r.chainCat) ? str(r.chainCat) + ' ' : ''}chain`);
  if (r.inShipyard && !bits.length) bits.push('is a shipyard material');
  /* Only two ways to reach here: an id the catalogue does not know (the gunOil
     phantom) or one it knows with no flag set. Neither says anything about
     whether a business makes it, so neither sentence may. */
  if (!bits.length) return `${name} — ${r.known === false
    ? 'the game’s tables name it, but no resource with that id exists'
    : 'a resource this map tracks'}.`;
  const list = bits.length > 1 ? bits.slice(0, -1).join(', ') + ' and ' + bits[bits.length - 1] : bits[0];
  return `${name} — it ${list}.`;
};
const resChip = (r, extra, titleText) => `<span class="scm-res${r.live === false ? ' planned' : ''}" title="${esc(chipTitle(r, titleText))}"><span class="ic">${esc(r.icon)}</span><span>${esc(r.name)}</span>${heldChip(r)}${extra || ''}</span>`;
const chips = (rows, max) => {
  const list = arr(rows); const m = max || MAX_RES;
  const head = list.slice(0, m).map((r) => resChip(r)).join('');
  const rest = list.slice(m);
  if (!rest.length) return `<div class="scm-chips">${head}</div>`;
  const k = 'm' + Math.random().toString(36).slice(2, 8);
  return `<div class="scm-chips">${head}</div><div data-more="${k}"><div class="scm-chips" style="margin-top:6px">${rest.map((r) => resChip(r)).join('')}</div></div><button type="button" class="scm-more" data-a="more" data-k="${k}">Show all ${list.length}</button>`;
};
/* A card that NAMES A BUSINESS wears that business's glyph, exactly as the
   "who buys it" chips in section 1 do. Round 2 gave the face to section 1
   only, so the same business appeared as "▣ Research Facility" in one section
   and as bare text two sections down — visible side by side on the medical
   card. One face per node, everywhere it is named. */
const nodeIc = (n) => `<span class="ic" aria-hidden="true">${esc((n && n.glyph) || '▣')}</span>`;
const link = (id, label) => `<a class="scm-link" data-a="nav" data-id="${esc(id)}" role="button" tabindex="0">${esc(label)}</a>`;
/* Short words for the jump bar. WHY A JUMP BAR: the Medical card is ~7,900px
   tall at 1366 and that is by design (it is a reference card, and cutting the
   content to make it short would fail the "answer it from the modal alone"
   bar). The cost of a tall card is that section 6 "who should I work with" and
   section 7 "is this for me" — the two a player actually came for — are three
   screens down. Seven chips under the header make them one click. The full
   section title is the button's title/aria text so nothing is lost. */
const JUMP_WORD = Object.freeze({ makes: 'Makes', works: 'Today', start: 'To start', run: 'To run', ships: 'Shipping', partners: 'Partners', plan: 'For me?' });
const secHead = (s, count) => `<h3><span class="n">${s.n}</span>${esc(s.title)}${count ? `<span class="cnt">${esc(count)}</span>` : ''}</h3>`;
const empty = (t) => `<p class="scm-empty">${esc(t)}</p>`;

/* The meta line of a product tile, assembled from whatever survived the VM's
   stutter guard: rate, source, held. Never prints "from" with nothing after
   it, and never prints an empty leading separator. */
function makesMeta(r) {
  const parts = [];
  if (r.rateText) parts.push(`<b>${esc(r.rateText)}</b>`);
  if (!r.live) parts.push(esc('the owner’s map'));
  else if (r.viaText) parts.push(esc('from ' + r.viaText));
  if (r.held !== null && r.held !== undefined) parts.push(esc(`you hold ${fmtInt(r.held)}`));
  return parts.join(' · ');
}

/* The badge of a product tile. A row that carries `badgeWord` is one whose
   LIVE-ness is about something narrower than "this whole row is true today"
   (a drop falls today; whether a business burns it is a second question), so
   it says which half it means and flags the other half when that half is
   only the owner's map. Everything else keeps the plain LIVE/PLANNED tag. */
function makesBadge(r) {
  if (!r.badgeWord) return tag(r.live);
  return `<span class="scm-tag live">${esc(r.badgeWord)}</span>${r.wantLive === false ? '<span class="scm-tag dim">NEED PLANNED</span>' : ''}`;
}

function paintMakes(vm) {
  const m = vm.makes; const s = vm.sections[0];
  const word = m.countWord || 'product';
  let h = secHead(s, m.total ? `${m.total} ${word}${m.total === 1 ? '' : 's'}` : '');
  h += '<div class="scm-sec">';
  /* The coverage sentence goes ABOVE the grid, not under it: on the Battle
     System card the grid is 24 tiles plus a 385-chip drawer, and a claim
     printed after that is a claim nobody reads. */
  if (m.coverLine) h += `<p class="scm-note">${esc(m.coverLine)}</p>`;
  if (m.empty && !m.rows.length) h += empty(m.empty);
  if (m.rows.length) {
    const show = m.rows.slice(0, MAX_RES);
    h += `<div class="scm-grid">${show.map((r) => `<div class="scm-tile${r.live ? '' : ' planned'}"><div class="t"><span class="ic">${esc(r.icon)}</span><b>${esc(r.name)}</b>${makesBadge(r)}</div><div class="m">${makesMeta(r)}</div>${r.note && (r.live === false || r.phantom) ? `<div class="m">${esc(r.note)}</div>` : ''}</div>`).join('')}</div>`;
    /* 🔴 THE DRAWER IS NOT A DIFFERENT CARD. On sys:battle the first 24 rows
       name the business that wants each drop and the other 385 collapse to a
       bare "🃏 Booster Packs · you hold 0" chip — the owner's headline clause
       answered for 6% of the list. The sentence is ALREADY computed for every
       row (`rateText`); resChip simply threw it away and put the raw resource
       id in the tooltip instead, which is also the accessibility complaint
       paintWorks carries. So the drawer chip's title is the row's own
       sentence. Rendering all 409 as full tiles was rejected: it is the wall
       of rows this piece exists to remove. */
    if (m.rows.length > MAX_RES) { const k = 'mk'; h += `<div data-more="${k}"><div class="scm-chips" style="margin-top:8px">${m.rows.slice(MAX_RES).map((r) => resChip(r, '', r.rateText ? `${r.name} — ${r.rateText}` : '')).join('')}</div></div><button type="button" class="scm-more" data-a="more" data-k="${k}">Show all ${m.rows.length}</button>`; }
  }
  if (m.service) h += `<p class="scm-note">Service: ${esc(m.service)}</p>`;
  h += `<div class="scm-lbl">${esc(m.buyersLabel || 'Who buys it')}</div>`;
  if (m.bestBuyers) h += `<p>The owner’s map names the best buyers: <b>${esc(m.bestBuyers)}</b>.</p>`;
  /* A buyer chip names a BUSINESS, not a resource, so it wears the node glyph
     and its own class. Round 1 gave it .scm-res with no .ic, which made an
     automated icon sweep call it a resource with a missing icon. */
  if (m.buyers.length) h += `<div class="scm-chips">${m.buyers.map((b) => `<span class="scm-buyer${b.live ? '' : ' planned'}"><span class="ic" aria-hidden="true">${esc(b.glyph || '▣')}</span>${link(b.id, b.label)}${b.cargo.length ? `<span class="held">${esc(b.cargo.slice(0, 3).map((c) => c.icon + ' ' + c.name).join(', '))}${b.cargo.length > 3 ? ' +' + (b.cargo.length - 3) : ''}</span>` : ''}${tag(b.live)}</span>`).join('')}</div>`;
  else h += empty(vm.type === 'channel' ? 'Buyers come to the counter — players, not a business on the map.' : 'The map draws no buyer for it yet.');
  if (m.offCounterNote) {
    h += `<div class="scm-lbl">Wants it, but is not drawn at this counter</div><p class="scm-note">${esc(m.offCounterNote)}</p>`;
    if (m.offCounterBuyers.length) h += `<div class="scm-chips">${m.offCounterBuyers.map((b) => `<span class="scm-buyer planned"><span class="ic" aria-hidden="true">${esc(b.glyph || '▣')}</span>${link(b.id, b.label)}<span class="held">${esc(b.ids.length + ' listing' + (b.ids.length === 1 ? '' : 's'))}</span><span class="scm-tag dim">NO LANE HERE</span></span>`).join('')}</div>`;
  }
  return h + '</div>';
}

function paintWorks(vm) {
  const w = vm.works; const s = vm.sections[1];
  let h = secHead(s, `${w.counts.live || 0} live · ${w.counts.planned || 0} planned`);
  h += '<div class="scm-sec">';
  if (w.empty) h += empty(w.empty);
  /* ⚠ A title= IS PLAYER-FACING. This row used to carry its cite in the tooltip
     unconditionally while gating only the VISIBLE span on admin mode, so a
     sighted player saw prose and a screen-reader user was read
     "Op Econ('transport').inputs.fuel" — 23 of them over 16 cards. No
     screenshot can show that, which is why it survived every visual review.
     The tooltip now follows exactly the same gate as the span it duplicates. */
  else h += `<ul class="scm-ledger">${w.rows.map((r) => { const showCite = r.cite && (vm.admin || r.kind === 'tile'); return `<li${showCite ? ` title="${esc(r.cite)}"` : ''}>${tag(r.live)}<span>${esc(r.text)}${showCite ? `<span class="why">${esc(r.cite)}</span>` : ''}</span></li>`; }).join('')}</ul>`;
  if (w.counts.needs) h += `<p class="scm-note">Of the ${fmtInt(w.counts.needs)} resource needs recorded for it, ${fmtInt(w.counts.needsLive)} are real today and ${fmtInt(w.counts.needsPlanned)} are the owner’s plan (section 4).</p>`;
  /* 🔴 ADMIN ONLY. These are the TEAM's unresolved readings of the owner's PDF
     ("Direction of 'needs': supplier or customer?", 'Car Dealer shows NO Car
     Factory although p3 says it buys there'), i.e. a design debate, not
     something a player can act on. It shipped on the player-facing card and
     read as the map contradicting itself. Same admin gate the citations use. */
  if (vm.admin && w.ambiguities.length) h += `<div class="scm-lbl">Open readings of the map</div>${w.ambiguities.map((a) => `<p class="scm-note"><b>${esc(a.title)}</b>${a.readings.length ? ' — ' + esc(a.readings.join(' / ')) : ''}</p>`).join('')}`;
  return h + '</div>';
}

function paintStart(vm) {
  const st = vm.start; const s = vm.sections[2];
  let h = secHead(s) + '<div class="scm-sec">';
  const amt = st.cinder.amount;
  h += `<div class="scm-cols"><div><div class="scm-big">${amt !== null ? esc(fmtInt(amt)) + ' <small>Cinder for the licence</small>' : '<span style="font-size:18px">' + (vm.type !== 'business' ? 'No licence' : st.cinder.unavailable ? 'Figure unavailable' : 'Price not set') + '</span><small>' + (vm.type !== 'business' ? 'part of the game' : st.cinder.unavailable ? 'economy table did not answer' : 'not in the game yet') + '</small>'}</div>` +
    `<div class="scm-afford ${esc(st.cinder.afford)}">${st.cinder.held !== null && amt !== null ? esc(`You hold ${fmtInt(st.cinder.held)} Cinder — ${st.cinder.afford === 'ready' ? 'enough' : st.cinder.afford === 'close' ? 'over halfway' : 'well short'}.`) : esc(st.cinder.text)}</div></div>` +
    /* The "AZA" small-caps label only rides under a FIGURE. When the text is
       "No Aza price — this one is bought with Cinder." the label was still
       printed below it, so a unit label sat under a sentence saying there is
       no such price and contradicted the value it was labelling. */
    `<div><div class="scm-big" style="font-size:18px">${esc(st.aza.text)}${st.aza.amount !== null && st.aza.amount !== undefined ? '<small>Aza</small>' : ''}</div>${st.figures ? `<div class="scm-note">Up to <b>${fmtInt(st.figures.workers)}</b> workers · each brings in <b>${fmtInt(st.figures.ratePerWorkerHr)}</b> and is paid <b>${fmtInt(st.figures.salaryPerWorkerHr)}</b> Cinder an hour — ${esc(st.figures.source)}.</div>` : ''}</div></div>`;
  /* CROSS-ELEMENT ECHO. The afford chip above already says "You hold 450,000
     Cinder — enough."; plan.js's licence prose ends with the same clause, and
     the round-4 stutter guard only collapses repetition WITHIN one element, so
     the medical card said it twice two lines apart. Drop the clause from the
     prose when the chip above is the one showing it — the chip is the louder
     of the two and is the one the eye lands on. */
  if (st.cinder.held !== null && amt !== null) {
    const shownAfford = st.cinder.afford === 'ready' ? 'enough' : st.cinder.afford === 'close' ? 'over halfway' : 'well short';
    const echo = new RegExp('(?:^|[.;·—-]\\s*)You hold [\\d,]+(?: Cinder)? — ' + shownAfford + '\\.?', 'gi');
    const prose = tidyProse(str(st.cinder.text).replace(echo, ' '));
    if (prose && prose.length > 2) h += `<p class="scm-note">${esc(prose)}</p>`;
  }
  if (st.door) h += `<p class="scm-note">${esc(st.door)}</p>`;
  if (st.empty) h += empty(st.empty);
  if (st.businesses.length) {
    h += '<div class="scm-lbl">Businesses it leans on</div><div class="scm-grid">' + st.businesses.map((b) => `<div class="scm-tile${b.live ? '' : ' planned'}"><div class="t">${nodeIc(b)}<b>${link(b.id, b.label)}</b>${tag(b.live)}${b.owned ? '<span class="scm-tag owned">YOU OWN IT</span>' : ''}${!b.exists ? '<span class="scm-tag dim">NOT IN GAME YET</span>' : ''}</div><div class="m">${esc(cap(b.role))}${b.cargo.length ? ' of ' + esc(b.cargo.map((c) => c.icon + ' ' + c.name).join(', ')) : ''} · ${esc(b.how || 'own one or find an owner')}</div>${b.why ? `<div class="m">${esc(b.why)}</div>` : ''}</div>`).join('') + '</div>';
  }
  const resTile = (r) => `<div class="scm-tile${r.live ? '' : ' planned'}"><div class="t"><span class="ic">${esc(r.icon)}</span><b>${esc(r.name)}</b>${tag(r.live)}${r.held !== null ? `<span class="scm-tag ${r.held > 0 ? 'live' : 'dim'}">YOU HOLD ${fmtInt(r.held)}</span>` : ''}</div><div class="m">${r.perHrFullCrew !== null ? `<b>${esc(fmtRate(r.perHrFullCrew))} an hour</b> at full crew · ` : r.screen ? `<b>On ${esc(r.screen)}</b> · ` : ''}${esc(r.where)}</div>${r.why ? `<div class="m">${esc(r.why)}</div>` : ''}</div>`;
  if (st.resources.length) h += `<div class="scm-lbl">${st.resources.every((r) => r.when === 'sell') ? 'What to bring back — it always has a buyer' : 'Starter stock — what it uses today'}</div><div class="scm-grid">` + st.resources.map(resTile).join('') + '</div>';
  if (st.screenMore.length) h += `<p class="scm-note">Its screen also takes ${esc(st.screenMore.join(', '))}.</p>`;
  if (st.planned.length) { const k = 'sp'; h += `<button type="button" class="scm-more" data-a="more" data-k="${k}">Planned needs (${st.planned.length}) — if the owner switches loot needs on</button><div data-more="${k}"><div class="scm-grid" style="margin-top:8px">${st.planned.map(resTile).join('')}</div></div>`; }
  if (st.notes.length) h += st.notes.map((n) => `<p class="scm-note">${esc(n.text)}</p>`).join('');
  return h + '</div>';
}

function paintRun(vm) {
  const r = vm.run; const s = vm.sections[3];
  const total = r.loot.length + r.lootPlanned.length + r.other.length;
  let h = secHead(s, total ? `${r.loot.length + r.other.length} live · ${r.lootPlanned.length} planned` : '') + '<div class="scm-sec">';
  if (r.empty) h += empty(r.empty);
  const whereText = (l) => {
    if (l.where.length) return l.where.slice(0, 2).map((w) => w.label + (w.via === 'always' ? ' (every time)' : '')).join(' · ') + (l.where.length > 2 ? ` · +${l.where.length - 2} more` : '');
    if (l.madeBy.length) return 'Not a battle drop — made by ' + l.madeBy.map((b) => b.label).join(', ');
    return 'No drop recorded — buy it on the Marketplace';
  };
  const lootTile = (l) => `<div class="scm-tile${l.live ? '' : ' planned'}"><div class="t"><span class="ic">${esc(l.icon)}</span><b>${esc(l.name)}</b>${tag(l.live)}${l.held !== null ? `<span class="scm-tag ${l.held > 0 ? 'live' : 'dim'}">YOU HOLD ${fmtInt(l.held)}</span>` : ''}</div><div class="m">${l.perHr !== null ? `<b>${esc(fmtRate(l.perHr))} an hour</b> at full crew · ` : ''}<b>Find it:</b> ${esc(whereText(l))}${l.madeBy.length && l.where.length ? ' · or buy from ' + l.madeBy.map((b) => link(b.id, b.label)).join(', ') : ''}</div>${l.why ? `<div class="m">${esc(l.why)}</div>` : ''}</div>`;
  /* 🔴 WHY THIS ONE LIST IS CAPPED AND THE OTHERS ARE NOT. sys:city needs 59
     resources, and round 2 printed all 59 as full cards in one uncollapsed
     block: 13.7k characters, 6.8x the next-heaviest section on any tile, and
     the only section in the card that could not be skimmed. The cap is the
     same MAX_RES the "what it makes" grid already uses, and the remainder
     keeps EVERY row — as the compact chip form, behind one button — because
     "the City Builder eats 59 different things" is the fact the owner asked
     this screen to show; hiding the count would be the worse lie. Tiles under
     the cap (every business) are untouched. */
  const runLive = r.loot.concat(r.other);
  if (runLive.length) {
    const show = runLive.slice(0, MAX_RES), rest = runLive.slice(MAX_RES);
    h += `<div class="scm-lbl">Battle loot and stock it uses today${rest.length ? ` — first ${show.length} of ${runLive.length}` : ''}</div><div class="scm-grid">${show.map(lootTile).join('')}</div>`;
    if (rest.length) { const k = 'rl'; h += `<div data-more="${k}"><div class="scm-chips" style="margin-top:8px">${rest.map((l) => resChip(l, `<span class="held">${esc(whereText(l))}</span>`)).join('')}</div></div><button type="button" class="scm-more" data-a="more" data-k="${k}">Show the other ${rest.length} it uses</button>`; }
  }
  if (r.lootPlanned.length) { const k = 'rp'; h += `<button type="button" class="scm-more" data-a="more" data-k="${k}">Planned loot needs (${r.lootPlanned.length}) — the owner’s map, switched off today</button><div data-more="${k}"><div class="scm-grid" style="margin-top:8px">${r.lootPlanned.map(lootTile).join('')}</div></div>`; }
  h += '<div class="scm-lbl">Other businesses, and what they send</div>';
  if (r.businesses.length) h += `<div class="scm-grid">${r.businesses.map((b) => `<div class="scm-tile${b.live ? '' : ' planned'}"><div class="t">${nodeIc(b)}<b>${link(b.id, b.label)}</b>${tag(b.live)}${b.owned ? '<span class="scm-tag owned">YOU OWN IT</span>' : ''}${b.pdf ? '<span class="scm-tag gold">ON THE MAP</span>' : ''}</div><div class="scm-chips" style="margin-top:6px">${b.cargo.map((c) => resChip(Object.assign({}, c, { live: b.liveIds.includes(c.id) || (b.live && !b.liveIds.length) }))).join('')}</div>${b.why ? `<div class="m">${esc(b.why)}</div>` : ''}</div>`).join('')}</div>`;
  else h += empty(vm.type === 'business' ? 'No other business feeds it: everything it uses is loot or its own.' : 'Nothing is shipped in — see section 5.');
  return h + '</div>';
}

function paintShips(vm) {
  const sh = vm.ships; const s = vm.sections[4];
  let h = secHead(s, sh.enforcedToday ? 'enforced today' : sh.legs.length ? 'planned rule' : '') + '<div class="scm-sec">';
  if (sh.rule) h += `<p>${tag(false)} ${esc(sh.rule)}</p>`;
  if (sh.liveLane) h += `<p>${tag(true)} Enforced today for ${esc(sh.liveLane)}: pick a lot and a player-owned carrier, or the sale is refused.</p>`;
  if (sh.phaseText) h += `<p class="scm-note">${esc(sh.phaseText)}</p>`;
  if (sh.empty) h += empty(sh.empty);
  if (sh.legs.length) {
    h += `<div class="scm-lbl">The route${sh.example && sh.example.cargo ? ` — e.g. ${esc(sh.example.cargo.icon + ' ' + sh.example.cargo.name)} to ${esc(sh.example.to)}` : ''}${sh.cargoClass ? ` · cargo class: ${esc(sh.cargoClass)}` : ''}</div>`;
    if (sh.counterSale) h += `<p class="scm-note">${tag(true)} This example ends at a counter, not at a business: ${esc(sh.counterNote || '')} The two greyed legs below only run when a business buys it and the seller books a freight haul.</p>`;
    h += `<div class="scm-route">${sh.legs.map((l) => `<div class="scm-leg${l.counterOnly ? ' counter' : ''}"><div class="k">${esc(l.word)}${l.counterOnly ? ' <span class="scm-tag dim">HAUL ONLY</span>' : ''}</div><div class="w">${esc(l.label)}<small>${esc(l.note)}</small></div></div>`).join('')}</div>`;
    /* "Settles instantly with no haul." is the same fact the counter note four
       lines above already made in full ("…drops straight into the buyer's
       stash — no truck, no carrier, no delay"), so on a counter sale it is a
       third statement of one thing. Keep it wherever it is the ONLY statement
       — a business-to-business lane has no counter note. */
    if (sh.whatHappensToday && !(sh.counterSale && /no haul|instantl/i.test(sh.whatHappensToday))) h += `<p class="scm-note">${esc(sh.whatHappensToday)}</p>`;
  }
  const laneRow = (l) => `<li>${tag(l.live)}<span>${l.dir === 'in' ? 'From' : 'To'} ${link(l.id, l.label)}${l.cargo.length ? ': ' + esc(l.cargo.slice(0, 4).map((c) => c.icon + ' ' + c.name).join(', ')) + (l.cargo.length > 4 ? ` +${l.cargo.length - 4}` : '') : ''}${l.cargoClass ? ` <span class="scm-tag dim">${esc(l.cargoClass)}</span>` : ''}${String(l.id).startsWith('ch:') ? ' <span class="scm-tag dim">COUNTER</span>' : ''}${l.reason ? `<small class="scm-note" style="display:block;margin-top:2px">${esc(l.reason)}</small>` : ''}</span></li>`;
  if (sh.lanes.length) h += `<div class="scm-lbl">Outbound lanes</div><ul class="scm-ledger">${sh.lanes.map(laneRow).join('')}</ul>`;
  if (sh.inbound.length) h += `<div class="scm-lbl">Inbound lanes</div><ul class="scm-ledger">${sh.inbound.map(laneRow).join('')}</ul>`;
  return h + '</div>';
}

function paintPartners(vm) {
  const p = vm.partners; const s = vm.sections[5];
  let h = secHead(s, p.total ? `top ${p.rows.length} of ${p.total}` : '') + '<div class="scm-sec">';
  if (p.empty) h += empty(p.empty);
  else h += `<div style="display:grid;gap:8px">${p.rows.map((r) => `<button type="button" class="scm-partner" data-a="nav" data-id="${esc(r.id)}"><span class="go">›</span><span class="r">${r.rank}</span><span class="nm">${esc((r.glyph ? r.glyph + ' ' : '') + r.label)}</span><span class="role">${esc(r.roles.join(' + ') || r.role)}</span> ${tag(r.anyLive || r.live)}${r.owned ? '<span class="scm-tag owned">YOU OWN IT</span>' : ''}${r.pdfDrawn ? '<span class="scm-tag gold">ON THE MAP</span>' : ''}${r.ambiguous ? '<span class="scm-tag dim">OPEN READING</span>' : ''}${r.reasons.map((t) => `<p>${esc(t)}</p>`).join('')}<p class="scm-note">${esc(r.statusNote)}${r.caveat ? ' — ' + esc(r.caveat) : ''}</p>${r.cargo.length ? `<div class="scm-chips" style="margin-top:6px">${r.cargo.map((c) => resChip(c)).join('')}${r.cargoMore ? `<span class="scm-tag dim">+${r.cargoMore}</span>` : ''}</div>` : ''}</button>`).join('')}</div>${p.pinnedNote ? `<p class="scm-note">${esc(p.pinnedNote)}</p>` : ''}<p class="scm-note">Click a partner to read its own card.</p>`;
  return h + '</div>';
}

function paintPlan(vm) {
  const p = vm.plan; const s = vm.sections[6];
  let h = secHead(s, p.basis) + '<div class="scm-sec">';
  if (p.empty) h += empty(p.empty);
  /* OFFLINE HONESTY. A live licensed business with no opEcon row means the
     bridge is absent or refused (offline, pre-login, a throwing bridge). The
     prose below still reads — plan.js words the fit and the steps without
     figures — and round 1 shipped it with no warning at all, so the card
     looked authoritative while every price was silently missing. Say it once,
     at the top of the section a player judges the business by. */
  if (vm.type === 'business' && vm.status === 'live' && !vm.hasEcon) {
    h += `<div class="scm-risk" style="border-left-color:var(--scm-goldb);background:rgba(212,175,55,.06)"><b>No prices reached this card</b><p>The game’s economy table did not answer, so every Cinder figure below is left out rather than guessed. The advice still holds; open the map again once you are online to see the numbers.</p></div>`;
  }
  if (p.headline) h += `<p class="scm-blurb" style="margin-top:0">${esc(p.headline)}</p>`;
  if (p.verdict) h += `<div class="scm-verdict ${esc(p.verdict.verdict)}"><b>${esc(p.verdict.label)}</b>${p.verdict.reasons.map((r) => `<p style="margin:3px 0 0">${esc(r)}</p>`).join('')}${p.verdict.firstAction ? `<p class="scm-note">First: ${esc(p.verdict.firstAction)}</p>` : ''}</div>`;
  if (p.fitFor.length || p.notFor.length) h += `<div class="scm-fit" style="margin-top:10px"><div><div class="scm-lbl">For you if you are a…</div><ul>${p.fitFor.map((f) => `<li><b class="yes">${esc(f.label)}</b>${f.planned ? ' <span class="scm-tag planned">PLANNED</span>' : ''} — ${esc(f.why)}</li>`).join('') || `<li class="scm-empty">${esc(vm.type === 'business' ? 'No playstyle is recorded as a clear fit for it yet — the map hangs too little on this tile to say.' : 'Every player uses it, so no one playstyle is singled out as its fit.')}</li>`}</ul></div><div><div class="scm-lbl">Think twice if you are a…</div><ul>${p.notFor.map((f) => `<li><b class="no">${esc(f.label)}</b> — ${esc(f.why)}</li>`).join('') ||
    /* A section with nothing to say states WHY, in the card's own voice.
       Round 2 printed the lowercase fragment "nothing counts against it"
       under a full sentence heading on ch:carmarket — the one place in the
       card that read like a placeholder. */
    `<li class="scm-empty">${esc(vm.type === 'business' ? 'Nothing counts against it: no playstyle is recorded as a poor fit for this business.' : 'Nothing counts against it: it costs nothing to open, takes no licence and locks nobody out, so no playstyle is warned off.')}</li>`}</ul></div></div>`;
  if (p.summary) h += `<table class="scm-rows" style="margin-top:10px"><tr><td>Should I?</td><td>${esc(p.summary.should)}</td></tr><tr><td>Do first</td><td>${esc(p.summary.first)}</td></tr><tr><td>Costs</td><td>${esc(p.summary.costs)}</td></tr><tr><td>Keeps</td><td>${esc(p.summary.keeps)}</td></tr></table>`;
  if (p.steps.length) h += `<div class="scm-lbl">The plan</div><div class="scm-ex">${p.steps.map((st) => `<div class="scm-step" data-n="${esc(st.n)}"><b>${esc(st.title)}</b><span class="scm-tag">${st.live ? 'LIVE' : 'PLANNED'}</span><p>${esc(st.detail)}</p></div>`).join('')}</div>`;
  h += '<div class="scm-lbl">What it earns</div>';
  if (p.earn.known && p.earn.rows.length) h += `<table class="scm-rows">${p.earn.rows.map((r) => `<tr><td>${esc(r.label)}</td><td class="v ${esc(r.tone)}">${esc(r.value)}</td></tr>`).join('')}</table>${p.earn.caveats.length ? `<p class="scm-note">${esc(p.earn.caveats.join(' '))}</p>` : ''}`;
  else h += empty(vm.type === 'business' && vm.status === 'planned' ? 'No figures: the game has no table for this business yet, so nothing here is priced.' : vm.type !== 'business' ? 'Nothing to earn by the hour: this is a part of the game, not an operation you found.' : 'No figures reached the map — the game’s economy table was not available.');
  if (p.risks.length) h += `<div class="scm-lbl">Risks</div>${p.risks.map((r) => `<div class="scm-risk"><b>${esc(r.title)}</b> ${tag(r.live)}<p>${esc(r.detail)}</p></div>`).join('')}`;
  if (p.effortWhy) h += `<p class="scm-note">${esc(p.effortWhy)}</p>`;
  return h + '</div>';
}

function paint(vm) {
  const b = vm.buttons || {};
  const badges = [];
  if (vm.badges && vm.badges.transport) badges.push('<span class="scm-tag gold">🚚 NEEDS TRANSPORT</span>');
  if (vm.badges && vm.badges.market) badges.push('<span class="scm-tag gold">🏪 MARKETPLACE</span>');
  if (vm.badges && vm.badges.carMarket) badges.push('<span class="scm-tag gold">🚗 CAR MARKETPLACE</span>');
  if (vm.badges && vm.badges.card) badges.push('<span class="scm-tag gold">🃏 GOOD FOR BATTLERS</span>');
  return `<div class="scm-card" role="dialog" aria-modal="true" aria-labelledby="scm-title" tabindex="-1">
  <div class="scm-head"><div class="scm-glyph" aria-hidden="true">${esc(vm.glyph)}</div><div class="scm-title"><h2 id="scm-title">${esc(vm.label)}</h2><div class="scm-sub">${esc(vm.kindWord || (vm.type === 'business' ? (vm.kind || 'business') : vm.type))} · ${tag(vm.status === 'live')} ${vm.owned ? '<span class="scm-tag owned">YOU OWN IT</span>' : ''}${vm.pdfCite ? ' · ' + esc(vm.pdfCite) : ''}</div></div><button type="button" class="scm-close" data-a="close" aria-label="Close">✕ CLOSE</button></div>
  <div class="scm-body">
    ${vm.blurb ? `<p class="scm-blurb">${esc(vm.blurb)}</p>` : ''}
    ${badges.length ? `<div class="scm-badges">${badges.join('')}</div>` : ''}
    <nav class="scm-jump" aria-label="Sections of this card">${(vm.sections || []).map((s) => `<button type="button" data-a="jump" data-sec="${esc(s.key)}" title="${esc(s.n + ' · ' + s.title)}" aria-label="${esc(s.n + ' · ' + s.title)}"><i aria-hidden="true">${s.n}</i>${esc(s.jump || JUMP_WORD[s.key] || s.title)}</button>`).join('')}</nav>
    <section data-sec="makes">${paintMakes(vm)}</section>
    <section data-sec="works">${paintWorks(vm)}</section>
    <section data-sec="start">${paintStart(vm)}</section>
    <section data-sec="run">${paintRun(vm)}</section>
    <section data-sec="ships">${paintShips(vm)}</section>
    <section data-sec="partners">${paintPartners(vm)}</section>
    <section data-sec="plan">${paintPlan(vm)}</section>
    <div class="scm-actions">
      ${b.highlight ? '<button type="button" class="scm-btn primary" data-a="highlight">Show this flow on the map</button>' : ''}
      ${b.open ? `<button type="button" class="scm-btn" data-a="open">${esc(b.openLabel || 'Open in Just Business')}</button>` : ''}
      ${b.copyProposal ? '<button type="button" class="scm-btn" data-a="copy" title="Admin: the OFF-by-default Ops-Econ overlay for this tile">Copy proposed overlay</button>' : ''}
      <button type="button" class="scm-btn" data-a="close">Close</button>
    </div>
    <div class="scm-foot"><span>LIVE = true in the shipped game today. PLANNED = the owner’s map; the game does not do it yet.</span><span>Every figure is the game’s own, read live.</span></div>
  </div></div>`;
}

let _host = null;
let _cb = null;
let _vm = null;
let _restore = null;
let _keyHandler = null;
let _resizeHandler = null;

function measureHead() {
  if (!_host || !_host.isConnected) return;
  const head = _host.querySelector('.scm-head');
  if (!head) return;
  const h = Math.round(head.getBoundingClientRect().height);
  if (h > 0) _host.style.setProperty('--scm-headh', h + 'px');
  /* …and then the sticky STACK: a jumped-to heading has to clear the header,
     the jump bar AND the host's own 3vh top padding. A flat 44px guess in CSS
     was 18px short at 1366 and the heading landed under the bar.
     ⚠ It is COMPUTED, not read off the bar: at measure time the bar is still
     in normal flow half-way down the card, so its own rect says 245px. */
  const jump = _host.querySelector('.scm-jump');
  if (jump) {
    const padTop = parseFloat(((_host.ownerDocument.defaultView || window).getComputedStyle(_host) || {}).paddingTop) || 0;
    const stick = Math.round(padTop + h + jump.getBoundingClientRect().height) + 8;
    if (stick > 0) _host.style.setProperty('--scm-stick', stick + 'px');
  }
}

/* 🔴 WHY THE JUMP SCROLL IS TWO PASSES. `scroll-margin-top` is a PREDICTION
   of the sticky stack (header + jump bar), computed once in measureHead. Any
   error in it — a web font that lands after the measurement, a name that
   rewraps the header, a sub-pixel row height — shows up as a sliver of the
   PREVIOUS section bleeding out above the bar, which is what round 2 still
   did at 390px after the padding fix. So: scrollIntoView lands us roughly
   there, and then we MEASURE the bar where it actually is (it is sticky by
   then, so its rect is the truth, not the in-flow guess) and correct the
   difference. Self-correcting beats a better guess. Twice, because moving the
   scroller can change which element is sticky by a pixel; the second pass
   settles it. Clamped scrolling (the last section) simply no-ops. */
function alignUnderBar(sec) {
  if (!_host || !sec) return;
  const bar = _host.querySelector('.scm-jump');
  if (!bar) return;
  for (let i = 0; i < 2; i++) {
    const delta = sec.getBoundingClientRect().top - bar.getBoundingClientRect().bottom;
    if (Math.abs(delta) < 1) break;
    _host.scrollTop += delta;
  }
}

const FOCUSABLE = 'button:not([disabled]),[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

function ensureCss(root) {
  const doc = root.ownerDocument || document;
  if (doc.getElementById(CSS_ID)) return;
  const st = doc.createElement('style'); st.id = CSS_ID; st.textContent = CSS;
  (doc.head || doc.body || root).appendChild(st);
}

function onClick(ev) {
  const t = ev.target.closest('[data-a]');
  if (!t) { if (ev.target === _host) closeModal(); return; }
  const a = t.getAttribute('data-a');
  const cb = _cb || {};
  if (a === 'close') { closeModal(); return; }
  if (a === 'more') {
    const k = t.getAttribute('data-k');
    const box = _host.querySelector(`[data-more="${k}"]`);
    if (box) {
      if (!t.getAttribute('data-orig')) t.setAttribute('data-orig', t.textContent);
      const open = box.classList.toggle('open');
      t.textContent = open ? 'Show fewer' : t.getAttribute('data-orig');
      t.setAttribute('aria-expanded', open ? 'true' : 'false');
    }
    ev.preventDefault(); return;
  }
  if (a === 'jump') {
    /* The HOST is the scroll container (overflow:auto), not the card, so
       scrollIntoView is the right move; scroll-margin-top on <section> keeps
       the heading clear of the sticky header + jump bar. */
    const sec = _host.querySelector(`section[data-sec="${t.getAttribute('data-sec')}"]`);
    if (sec) { safe(() => sec.scrollIntoView({ block: 'start', behavior: 'auto' })); safe(() => alignUnderBar(sec)); }
    ev.preventDefault(); return;
  }
  if (a === 'nav') { const id = t.getAttribute('data-id'); ev.preventDefault(); ev.stopPropagation(); if (fn(cb.onNavigate)) safe(() => cb.onNavigate(id)); return; }
  if (a === 'highlight') { if (fn(cb.onHighlight)) safe(() => cb.onHighlight(_vm ? _vm.id : null)); return; }
  if (a === 'open') { if (fn(cb.onOpen)) safe(() => cb.onOpen(_vm ? (_vm.opId || _vm.id) : null)); return; }
  if (a === 'copy') { if (fn(cb.onCopyProposal)) safe(() => cb.onCopyProposal(_vm ? _vm.id : null)); return; }
}

function onKey(ev) {
  if (!_host) return;
  if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); closeModal(); return; }
  if (ev.key === 'Enter' || ev.key === ' ') {
    const t = ev.target && ev.target.closest && ev.target.closest('a[data-a="nav"]');
    if (t) { ev.preventDefault(); t.click(); return; }
  }
  if (ev.key !== 'Tab') return;
  const list = Array.from(_host.querySelectorAll(FOCUSABLE)).filter((el) => el.offsetParent !== null || el === _host.firstElementChild);
  if (!list.length) { ev.preventDefault(); return; }
  const first = list[0], last = list[list.length - 1];
  const active = _host.ownerDocument.activeElement;
  if (ev.shiftKey && (active === first || !_host.contains(active))) { ev.preventDefault(); last.focus(); }
  else if (!ev.shiftKey && (active === last || !_host.contains(active))) { ev.preventDefault(); first.focus(); }
}

/* openModal(root, vm, cb)
   root  the element to host the modal in (#sc-overlay, or any element)
   vm    from modalVM
   cb    { onNavigate(id), onHighlight(id), onOpen(opId), onCopyProposal(id), onClose() }
   Returns the host element. Calling it while open RE-PAINTS the same host. */
export function openModal(root, vm, cb) {
  const r = root && root.nodeType === 1 ? root : (typeof document !== 'undefined' ? document.body : null);
  if (!r) return null;
  const v = isObj(vm) ? vm : unknownVM('');
  const first = !_host || !_host.isConnected || _host.parentNode !== r;
  if (first) {
    if (_host && _host.isConnected) _host.remove();
    ensureCss(r);
    _host = r.ownerDocument.createElement('div');
    _host.className = HOST_CLASS;
    /* Belt and braces after the `.sc-modal` collision above: the four
       declarations that decide whether this thing covers the screen are set
       INLINE, where no stylesheet in a 215k-line index.html can outrank them.
       Everything else (colour, type, spacing) stays in the class, where the
       page's own :root tokens are still allowed to win. */
    _host.style.setProperty('position', 'fixed');
    _host.style.setProperty('inset', '0');
    _host.style.setProperty('width', 'auto');
    _host.style.setProperty('height', 'auto');
    _host.style.setProperty('max-width', 'none');
    _host.style.setProperty('max-height', 'none');
    /* 🔴 The seventh inline declaration, and the one that was missing for five
       rounds. A hover card must not eat pointer events over the 3D scene, so
       the natural host for an overlay layer is `pointer-events:none` — and
       `pointer-events` INHERITS, so the card, the close button, the jump bar,
       the partner links and the backdrop dismiss were all dead to a real mouse
       inside such a wrapper. Measured in the real index.html: elementFromPoint
       at the close button's own centre returned the page behind it and a real
       click left the modal open. It never went red because the modal harness
       carries `#sc-overlay > * { pointer-events:auto }`, which silently
       repaired it for every suite. The modal is a dialog — it is always the
       thing you are pointing at — so it declares that for itself. */
    _host.style.setProperty('pointer-events', 'auto');
    _host.setAttribute('data-sc-modal', '1');
    _host.addEventListener('click', onClick);
    _restore = r.ownerDocument.activeElement;
    _keyHandler = onKey;
    r.ownerDocument.addEventListener('keydown', _keyHandler, true);
    r.appendChild(_host);
  }
  _cb = isObj(cb) ? cb : {};
  _vm = v;
  _host.setAttribute('data-id', v.id || '');
  _host.innerHTML = paint(v);
  _host.scrollTop = 0;
  /* The header is sticky and its height is NOT a constant — it wraps to two or
     three lines at phone width, and a long business name changes it again. The
     jump bar sticks directly under it, so its offset has to be measured, not
     typed. Without this the bar slid behind the header on a phone and vanished
     as soon as you scrolled. Re-measured on resize (listener dropped on close). */
  measureHead();
  /* …and again once the layout has actually settled. The first call can run
     before Cinzel arrives, and a header measured in the fallback serif is a
     couple of pixels short of the real one — which is exactly the error the
     jump bar's sticky offset is made of. */
  try {
    const w = (r.ownerDocument.defaultView || window);
    if (w && typeof w.requestAnimationFrame === 'function') w.requestAnimationFrame(() => measureHead());
    if (r.ownerDocument.fonts && r.ownerDocument.fonts.ready && typeof r.ownerDocument.fonts.ready.then === 'function') r.ownerDocument.fonts.ready.then(() => measureHead(), () => {});
  } catch (e) {}
  if (first) { _resizeHandler = measureHead; try { (r.ownerDocument.defaultView || window).addEventListener('resize', _resizeHandler); } catch (e) {} }
  const closeBtn = _host.querySelector('.scm-close');
  try { (closeBtn || _host.firstElementChild).focus({ preventScroll: true }); } catch (e) {}
  return _host;
}

export function closeModal() {
  if (!_host) return false;
  const doc = _host.ownerDocument;
  try { doc.removeEventListener('keydown', _keyHandler, true); } catch (e) {}
  try { if (_resizeHandler) (doc.defaultView || window).removeEventListener('resize', _resizeHandler); } catch (e) {}
  _resizeHandler = null;
  const cb = _cb || {};
  try { _host.remove(); } catch (e) {}
  _host = null; _cb = null; _vm = null; _keyHandler = null;
  try { if (_restore && fn(_restore.focus) && _restore.isConnected) _restore.focus({ preventScroll: true }); } catch (e) {}
  _restore = null;
  if (fn(cb.onClose)) safe(() => cb.onClose());
  return true;
}

export const isModalOpen = () => !!(_host && _host.isConnected);
export const currentModalId = () => (_vm ? _vm.id : null);

export default { modalVM, openModal, closeModal, isModalOpen, currentModalId, SECTIONS };
