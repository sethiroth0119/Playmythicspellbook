/* ═══════════════════════════════════════════════════════════════════════════
   🖼 SUPPLY CHAIN · render.js — THE SCREEN. The overlay, its chrome, and the
   wiring between the four views that already exist.

   This file owns no truth and derives no fact. Everything it shows comes from
   the bundle data.js assembles (graph, catalogue, recipes, coverage, shipping,
   loot) or from the bridge at the moment it is asked. If a sentence on screen
   is wrong, it is wrong in a data file, not here — that split is the whole
   reason the map could be built by a dozen pieces at once.

   WHAT THE SHELL IS RESPONSIBLE FOR
     · one #sc-overlay, one <style>, one 3D view (or the 2D fallback), one hover
       card, one modal — created on open(), ALL of them gone after close()
     · the header: title, the four PDF legend icons with the owner's legend text
       VERBATIM, and the LIVE / PLANNED key (contract rule 3 — the difference has
       to be on screen, not only in a tooltip)
     · two tabs (the systems overview, and a browsable index of every tile)
     · one search box over BOTH the tiles and all 420-odd resource ids, which
       lights the resource's route on the map and says where it is found, who
       makes it and who uses it
     · five filter chips, which are the four legend icons plus "planned only"
     · routing: hover -> hover.js, click -> modal.js, modal buttons -> the map
       or the bridge

   🔴 WHY project() AND NOT THE POINTER for the hover card's anchor. The scene
   reports pointer coordinates RELATIVE TO ITS CANVAS, and the canvas starts
   below the header — so anchoring on the raw pointer put the card a header's
   height too high, which looks like a rendering bug and is actually a
   coordinate-space bug. project(id) returns the plate's rectangle in the same
   canvas space, so the shell converts ONCE, here, with the stage's own client
   rect. The 2D fallback's project() is already in viewport space (it reads
   getBoundingClientRect), so the conversion is skipped for it; `viewKind` is
   the only thing that decides which, and nothing else in this file cares which
   view is mounted.

   🔴 WHY EVERY NUMBER ON THIS SCREEN COMES FROM THE BRIDGE. Contract rule 2.
   The shell passes bridge accessors THROUGH to modal.js (opEcon, held, ownsOp,
   gems…) and never reads a figure itself. With no bridge at all the map still
   opens on snapshot data and the modal prints "not set" instead of 0 — a zero
   would be a lie about a real price.
   ═══════════════════════════════════════════════════════════════════════════ */

import { SC } from './tuning.js';
import { css, STYLE_ID } from './sc.css.js';
import * as bridge from './sc.bridge.js';
import { assemble, getData } from './data.js';
import * as shippingMod from './shipping.js';
import { mountScene } from './scene.js';
import { mountFallback } from './fallback.js';
/* 🔴 THE SHELL ASKS THE SAME QUESTION scene.js ASKS, FROM THE SAME PLACE.
   mountScene() resolves null for two completely different reasons — this
   machine cannot do WebGL at all, or three.js never arrived (blocked CDN,
   offline, a slow first paint). The footer used to print "2D view (no WebGL)"
   for both, which is a lie on every desktop that has WebGL and lost the race,
   and it left the player no reason to expect the 3D map could ever appear.
   webglOk() is the only honest way to tell the two apart, and it is cheap
   (a cached probe context inside three.boot.js). */
import { webglOk } from '../weaponsmith/three.boot.js';
import { mountHover, hoverVM } from './hover.js';
import { modalVM, openModal, closeModal, isModalOpen } from './modal.js';

/* ── tiny total helpers ─────────────────────────────────────────────────── */
const safe = (f, d) => { try { const r = f(); return r === undefined ? d : r; } catch (e) { return d; } };
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const arr = (v) => (Array.isArray(v) ? v : []);

/* ── the four legend icons, drawn ───────────────────────────────────────── */
/* WHY INLINE SVG AND NOT AN IMAGE CROP OF THE PDF. The legend has to be legible
   at 20px on a phone and in the filter chips at 15px, and it has to re-colour
   with the palette. A crop of a 1900px page does neither. The shapes follow the
   owner's own art, described in businesses.js LEGEND.art: a box-trailer semi, a
   shop inside a cycle of arrows, a tow truck carrying a car, a framed card. */
const ICONS = {
  transport: '<svg viewBox="0 0 24 16" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="1.4"><rect x="1" y="3" width="12" height="8" rx="1"/><path d="M13 5h4l3 3v3h-7z"/></g><g fill="currentColor"><circle cx="6" cy="13" r="1.8"/><circle cx="17" cy="13" r="1.8"/></g></svg>',
  market: '<svg viewBox="0 0 24 16" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="1.4"><path d="M6 6h12l-1 7H7z"/><path d="M9 6a3 3 0 0 1 6 0"/><path d="M3 9a9 9 0 0 1 3-6M21 7a9 9 0 0 1-3 6"/></g><g fill="currentColor"><circle cx="3" cy="9.5" r="1.4"/><circle cx="21" cy="6.5" r="1.4"/></g></svg>',
  carMarket: '<svg viewBox="0 0 24 16" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="1.4"><path d="M1 11V6h5l2-3h4l2 3"/><path d="M9 11h13V8h-4l-2-2"/><path d="M14 6l6-3"/></g><g fill="currentColor"><circle cx="5" cy="12.5" r="1.7"/><circle cx="18" cy="12.5" r="1.7"/></g></svg>',
  card: '<svg viewBox="0 0 24 16" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="1.4"><rect x="7" y="1" width="10" height="14" rx="1.2"/><rect x="9" y="3.4" width="6" height="6" rx="3"/><path d="M9 12h6"/></g></svg>',
};
const icon = (k) => ICONS[k] || '';

/* ── the numbered explainer ─────────────────────────────────────────────── */
/* Five sentences, in the order a first-time player needs them: what the tiles
   are, what the lanes are, what the middle is, what the colours mean, and what
   to do next. Nothing here is an economy fact, so it is allowed to be prose.

   🔴 SENTENCE 2 USED TO SAY "follow it in the direction of the trucks" FULL
   STOP, AND AT THE HOME CAMERA THAT WAS AN INSTRUCTION A PLAYER COULD NOT
   CARRY OUT. With every lane drawn, the 83 loot streams bundled on the ridge
   behind the districts read as one undifferentiated fan across the top third
   of the frame; a first-time player got the cast right and the relationships
   not at all. The map now draws the Transport spine at rest and lights a
   tile's own lanes when it is picked (see QUIET below), so the sentence has
   to say that — an explainer that describes a different picture than the one
   on screen is worse than none. */
const HOWTO = [
  'Every box is a business, a system or a marketplace. The four big banners are the game’s systems — Battle, Just Business, City Builder, Camp.',
  'At rest the map draws the <b>shipping spine</b> — the white lanes running through the middle — and the few ember streams carrying battle drops out of the districts. Pick a box (or search a resource) and that one’s own lanes light up, so you read one story at a time instead of all 247 at once.',
  'The hub in the middle is <b>Transport</b>. On the owner’s map every shipment between two businesses passes through it. Follow a lane in the direction of the trucks.',
  'Solid and tagged <b>LIVE</b> = the game does this today. Dashed and tagged <b>PLANNED</b> = it is on the owner’s map and is not in the game yet.',
  'Hover a box for the short version, click it for what it makes, what it needs to start, who to work with, and whether it suits how you play.',
];

/* ── the shell's own chrome knobs ───────────────────────────────────────── */
/* NOT economy numbers — widths, a timeout and a list of edge kinds; contract
   rule 1 is untouched. They live here rather than in tuning.js only because
   tuning.js belongs to the seam piece and this round may not edit it; the
   integration piece should lift this block into SC.shell verbatim. */
const UI = {
  phoneW: 560,            // at or under this the 3D tiles are ~53px wide: the rail is the readable view
                          // (the same number as the sheet's second breakpoint — keep them together)
  /* 🔴 THESE TWO NUMBERS REPLACE A SINGLE DEADLINE THAT DECIDED THE WHOLE
     FEATURE. Round 3 raced mountScene against 2200 ms and, on a miss, drew the
     2D list and DISPOSED the scene when it arrived. Measured on the real
     11.6 MB index.html: 4 of 8 cold opens missed, so half the players never
     saw the product at all — and the footer then told them their machine had
     no WebGL. The deadline is now a SOFT one: at `scene2dAfterMs` the 2D map
     is drawn so the screen is never empty, the scene keeps baking, and
     adoptLateScene() swaps it in when it lands. `sceneGiveUpMs` is the only
     hard stop, and it exists for the blocked-CDN case where nothing will ever
     resolve — three.boot's own loader gives up near 6 s, so this is generous
     on purpose. Neither is an economy number; both are chrome. */
  scene2dAfterMs: 2200,
  sceneGiveUpMs: 20000,
};

/* 🔇 THE QUIET LANES. The one thing the shell does to the 3D map's own data.

   WHY. 247 lanes at the home camera is not a map, it is a texture: measured,
   the 83 loot streams alone cover the top third of the frame and nothing in
   them can be traced to a tile. The 114 haul lanes through Transport ARE the
   owner's subject ("every shipment passes through here") and they are legible;
   the loot fan drowns them. So the loot streams start silent and appear the
   moment their tile is picked or their resource is searched — no fact is
   removed, the order it arrives in is changed.

   HOW, AND WHY THIS IS A WORKAROUND. scene.js already has exactly this
   behaviour, for the `service` kind: "hidden at overview, appears when its
   node is in play". It has no API to ask for it, and scene.js is not this
   piece's file, so the shell hands the SCENE ONLY a copy of the graph whose
   loot edges wear that kind. data.graph itself is untouched — hover, modal,
   the rail, search and the 2D fallback all read the real kinds, and the copy
   never leaves mountView(). If scene.js ever grows a real setLaneMode(), this
   whole block should be deleted in favour of it. */
const QUIET = {
  as: 'service',
  /* An edge with `via` is a Transport haul — the spine, and the owner's whole
     point, so it is NEVER quieted (that is all 89 supply and 25 of the channel
     lanes). `system` is the four district ribbons. What is left is the 83 loot
     streams and the 25 direct market lanes: the fan. */
  test: (e, keep) => !e.via && (e.kind === 'loot' ? !keep.has(e.id) : e.kind === 'channel'),
};

/* 🔥 …EXCEPT THE FEW LOOT LANES THAT KEEP THEIR EMBERS. Round 2 quieted all 83
   and the critic measured the consequence: stats().embers went to 0, because
   scene.js builds its ember Points from `lanes.filter(kind === 'loot')` — a
   set this shell had just emptied. The map stopped moving on exactly the story
   the owner cares most about ("every business needs what drops in battle"), and
   a still map reads as a screenshot.

   So a SMALL, DERIVED set of loot lanes stays loud. The rule has three clauses
   and no hand-picked ids:
     1. a loot edge that lands on a SYSTEM rather than on one business is a
        trunk stream — the picture of "drops flow out of the fight" itself;
     2. any tile that would otherwise have NO lane drawn at rest keeps its
        fattest drop lane. Measured on the shipped graph that is exactly `bank`
        and `airport`, the two the critic photographed as unconnected boxes:
        their only other links are `service`, which scene.js hides at overview
        by design;
     3. the two heaviest drop lanes out of each source system, so the ridge
        behind the districts carries visible embers instead of one lonely spark.
   Eleven lanes on the shipped graph, against round 1's 83: a stream, not a fan. */
function loudLoot(g) {
  const keep = new Set();
  const edges = arr(g.edges);
  const loot = edges.filter((e) => e.kind === 'loot' && !e.via);
  if (!loot.length) return keep;
  const byId = new Map(arr(g.nodes).map((n) => [n.id, n]));
  const cargo = (e) => arr(e.cargo).length;
  const rank = (a, b) => cargo(b) - cargo(a) || String(a.id).localeCompare(String(b.id));   // stable, so the set is the same every open
  for (const e of loot) if ((byId.get(e.to) || {}).type !== 'business') keep.add(e.id);
  /* what scene.js actually paints at rest: not quieted, and not `service` */
  const drawn = new Map();
  for (const e of edges) {
    if (e.kind === 'service') continue;
    if (!e.via && (e.kind === 'loot' || e.kind === 'channel')) continue;
    for (const id of [e.from, e.to]) drawn.set(id, (drawn.get(id) || 0) + 1);
  }
  for (const n of arr(g.nodes)) {
    if (drawn.get(n.id)) continue;
    const mine = loot.filter((e) => e.to === n.id || e.from === n.id).sort(rank);
    if (mine[0]) keep.add(mine[0].id);
  }
  const bySrc = new Map();
  for (const e of loot) { if (!bySrc.has(e.from)) bySrc.set(e.from, []); bySrc.get(e.from).push(e); }
  for (const list of bySrc.values()) for (const e of list.sort(rank).slice(0, 2)) keep.add(e.id);
  return keep;
}

/* 🛣 ONE ROUTE, NOT EVERY LANE THE CARGO EVER RIDES.

   The Found panel prints ONE sentence — "Fishing Company → Transport →
   Restaurant, Fish Cannery" — and round 2 lit something else: measured, the
   scene fell back to `edges.filter(cargo.includes(resId))`, which for `metal`
   is 17 lanes converging on the hub, so the answer on screen was a yellow knot
   around Transport and the three named steps could not be traced.

   It fell back because the copy below LOST resourceFlow: graph.js defines
   resourceFlow / neighbours / node / edge as NON-enumerable own properties, and
   `Object.assign` copies only enumerable ones — so the round-2 copy silently
   had none of them, and the scene's neighbour rings were dead for the same
   reason. Copying the descriptors fixes both.

   With the real flow reachable, the scene is handed exactly the routes
   resourceFlow already named (`flow.routes[].edges`, the same array flowHTML
   words), plus each route's lane path so the leg through Transport is lit as
   one continuous line. Everything else that carries the resource stays at the
   scene's own unlit tier. When a resource has no route of its own (a pure loot
   drop), the narrowing returns null and the scene's own behaviour stands. */
function routeFlow(real, resId) {
  const f = safe(() => real.resourceFlow(resId), null);
  if (!f || f.known === false) return null;
  const routes = arr(f.routes);
  if (!routes.length) return null;
  const laneBy = new Map(arr(f.lanes).map((l) => [l.edge, l]));
  const es = new Set(), ns = new Set();
  for (const r of routes) {
    ns.add(r.from);
    for (const id of arr(r.to)) ns.add(id);
    for (const id of arr(r.edges)) {
      es.add(id);
      const l = laneBy.get(id);
      if (l) for (const p of arr(l.path)) ns.add(p);
    }
  }
  if (!es.size) return null;
  return { id: resId, known: true, edges: Array.from(es), nodes: Array.from(ns) };
}

function quietGraph(graph) {
  const g = graph || {};
  const edges = arr(g.edges);
  if (!edges.length) return g;
  const keep = loudLoot(g);
  let hit = 0;
  const out = edges.map((e) => {
    if (!QUIET.test(e, keep)) return e;
    hit++;
    /* a shallow clone: the scene reads kind/from/to/cargo/pdf/live/via and
       never writes, so sharing the cargo array with the real edge is safe */
    return Object.assign(Object.create(Object.getPrototypeOf(e) || Object.prototype), e, { kind: QUIET.as, scQuiet: e.kind });
  });
  /* descriptors, NOT Object.assign — see routeFlow's note.
     🔴 AND THE OVERRIDES GO IN THE SPEC, NOT ONTO THE FINISHED OBJECT.
     graph.js freezes the shape it hands out: `edges` is non-configurable, so
     defineProperty(copy,'edges') AFTER the descriptors are installed throws
     "Cannot redefine property: edges" — inside quietGraph, inside the
     safe() around mountScene, which turned the throw into `null` and dropped
     a WebGL-capable desktop onto the 2D fallback with no error anywhere.
     Measured, and it is exactly the failure CLAUDE.md warns about: the screen
     still worked, it was simply the wrong screen. Overriding the DESCRIPTOR
     before the fresh object is built cannot collide with anything. */
  const spec = Object.assign({}, safe(() => Object.getOwnPropertyDescriptors(g), null) || {});
  if (hit) spec.edges = { value: out, enumerable: true, configurable: true, writable: true };
  if (typeof g.resourceFlow === 'function') {
    spec.resourceFlow = {
      value: (id) => routeFlow(g, id) || safe(() => g.resourceFlow(id), null),
      enumerable: false, configurable: true, writable: true,
    };
  }
  const copy = Object.create(Object.getPrototypeOf(g) || Object.prototype);
  Object.defineProperties(copy, spec);
  return copy;
}

/* ── filter chips = the four legend icons, plus the honesty one ─────────── */
const FILTERS = [
  { key: 'transport', label: 'Needs Transport', ico: 'transport', test: (n) => !!(n.badges && n.badges.transport) },
  { key: 'market', label: 'Sells on Marketplace', ico: 'market', test: (n) => !!(n.badges && n.badges.market) },
  { key: 'carMarket', label: 'Car Marketplace', ico: 'carMarket', test: (n) => !!(n.badges && n.badges.carMarket) },
  { key: 'card', label: 'Good for battlers', ico: 'card', test: (n) => !!(n.badges && n.badges.card) },
  { key: 'planned', label: 'Planned only', ico: null, test: (n) => n.status === 'planned' },
];

/* The explainer's two states, written in ONE place so the panel, its title bar
   and the header button can never disagree about which one it is in. */
function setFold(panel, open) {
  if (!panel) return;
  panel.setAttribute('data-open', open ? '1' : '0');
  const fold = panel.querySelector('.sc-fold');
  if (fold) { fold.setAttribute('aria-expanded', open ? 'true' : 'false'); fold.textContent = open ? '▲ Hide' : '▼ Show'; }
}

/* Shown at the top of the rail on a phone only — see the setTab('businesses')
   call in boot(). It is the one line that tells a phone player the 3D map
   exists and where it went. */
const PHONE_HINT = `<p class="sc-hint">Small screen: the 3D map’s labels are a few pixels tall here, so this list is the readable view. The map is still one tap away under <b>Systems overview</b>.</p>`;

/* ═════════════════════════════════════════════════════════ the singleton ══ */
/* ONE shell at a time, on purpose: the overlay is a full-screen takeover and
   two of them would fight over Esc, the body scroll lock and the WebGL
   context. open() while open re-focuses the one that exists. */
let S = null;
let _opening = null;

export function isOpen() { return !!(S && S.root && S.root.isConnected); }
export function current() { return S; }

/* ── data ───────────────────────────────────────────────────────────────── */
/* The bundle, built with whatever the game will tell us. With no bridge this is
   the pure snapshot — the map still draws; only the figures are unknown. */
function buildData() {
  const base = safe(() => getData(), null);
  if (!bridge.ready()) {
    bridge.warnMissing('shell.open');
    return base || safe(() => assemble({}), { graph: { nodes: [], edges: [], lanes: [] }, catalog: { all: () => [] } });
  }
  const liveCatalog = safe(() => bridge.resources(), null);
  const ctx = safe(() => (typeof shippingMod.sessionCtx === 'function' ? shippingMod.sessionCtx(bridge) : undefined), undefined);
  /* The live ops table, so recipes.js can re-check itself against the running
     game (an admin override is merged by _opEcon before we ever see it). Built
     from the snapshot's own node list, which is the only place the op ids are
     already known — the shell must not keep a second list of them. */
  const opsEcon = {};
  for (const n of arr(base && base.graph && base.graph.nodes)) {
    if (!n.opId) continue;
    const row = safe(() => bridge.opEcon(n.opId), null);
    if (row) opsEcon[n.opId] = row;
  }
  const out = safe(() => assemble({ liveCatalog, ctx, opsEcon: Object.keys(opsEcon).length ? opsEcon : undefined }), null);
  return out || base;
}

/* ── chrome ─────────────────────────────────────────────────────────────── */
function chromeHTML(data) {
  const B = data.businesses || {};
  const legend = arr(B.LEGEND);
  const rule = (B.PDF && B.PDF.iconRule) || '';
  return `
<header class="sc-head">
  <div class="sc-head-top">
    <div class="sc-title">
      <h1>Supply &amp; Demand</h1>
      <p>Every business, every system, and what moves between them. Follow one resource from the battlefield to the shop counter.</p>
    </div>
    <div class="sc-head-right">
      <div class="sc-key">
        <b class="k-live">LIVE</b><span>in the game today</span>
        <b class="k-planned">PLANNED</b><span>on the owner’s map</span>
      </div>
      <button type="button" class="sc-btn" data-a="howto" title="How to read this map"><span class="sc-long">How to read this map</span><span class="sc-short" aria-hidden="true">?</span></button>
      <button type="button" class="sc-btn sc-x" data-a="close" aria-label="Close the supply chain map" title="Close (Esc)">×</button>
    </div>
  </div>
  <!-- 🔴 THE WRAPPER EXISTS FOR THE PHONE. Under 820px both of these strips
       become one sideways-scrolling row, and measured on a 390px phone only 3
       of the 5 legend items and 2 of the 5 chips were inside the viewport —
       with nothing on screen saying so. A player who never learns the "Good
       For Battlers" icon has not been shown the owner's legend, which is a bar
       clause that passed on desktop and failed on a phone. The wrapper carries
       a fade and a › that appear only while there is more to the right (JS
       writes data-more; CSS cannot ask "is this element scrolled to its end"). -->
  <div class="sc-strip"><ul class="sc-legend" aria-label="Map legend, from the owner’s plan">
    ${legend.map((l) => `<li><span class="sc-ic">${icon(l.key)}</span>${esc(l.text)}</li>`).join('')}
    ${rule ? `<li class="sc-lg-rule">“${esc(rule)}”</li>` : ''}
  </ul></div>
  <div class="sc-controls">
    <div class="sc-tabs" role="tablist" aria-label="View">
      <button type="button" role="tab" data-tab="overview" aria-selected="true">Systems overview</button>
      <button type="button" role="tab" data-tab="businesses" aria-selected="false">Businesses</button>
    </div>
    <div class="sc-search">
      <span class="sc-mag" aria-hidden="true">⌕</span>
      <input type="search" autocomplete="off" spellcheck="false"
             placeholder="Search a business or any resource — try “cloth”"
             aria-label="Search a business or a resource">
      <button type="button" class="sc-clear" data-a="clear" aria-label="Clear the search">×</button>
    </div>
    <div class="sc-strip sc-strip-chips"><div class="sc-chips" role="group" aria-label="Filters">
      ${FILTERS.map((f) => `<button type="button" class="sc-chip" data-f="${f.key}" aria-pressed="false">${f.ico ? icon(f.ico) : ''}${esc(f.label)} <span class="sc-n" data-n="${f.key}"></span></button>`).join('')}
    </div></div>
  </div>
</header>
<div class="sc-body" data-view="overview">
  <!-- 🔴 DOCKED, NOT FLOATING — AND THAT IS THE SEARCH FRAME'S WHOLE FIX.
       Round 2 parked this card on top of the map at left:12px, and the frame
       the bar's headline clause is about was the one it broke: projecting each
       lit route's own nodes against the painted panels measured "cloth" hiding
       Battle System + Weapon Smith, "metal" hiding four of seventeen, and
       "freshFish" printing "Fishing Company → Transport → Restaurant" with its
       own left edge sitting on Fishing Company. Insetting the camera fit would
       have been a number to keep in sync with a CSS width. Taking the panel
       out of the stage is not: the stage is narrower while the answer is up,
       scene.js's ResizeObserver refits the home camera into what is left, and
       the occlusion cannot come back because there is nothing to occlude. -->
  <section class="sc-find" aria-label="Search result">
    <h2>Found<button type="button" class="sc-fold" data-a="closefind" aria-label="Close">×</button></h2>
    <div class="sc-find-body"></div>
  </section>
  <div class="sc-stage">
    <!-- 🔴 THE 3D MAP GETS ITS OWN HOST INSTEAD OF SHARING THE STAGE.
         Round 3 handed mountScene the stage itself, so the canvas and the 2D
         fallback's .scf tree were siblings in one box: the moment a late scene
         appended its canvas, it painted over the 2D map the player was reading
         and there was no single thing to hide or show. One absolutely-
         positioned host, sized by the stage, is the thing adoptLateScene()
         toggles — and it is the FIRST child so the boot curtain and the
         floating panels (both positioned) still paint above it. The inline
         style is deliberate: this element is owned by render.js and sc.css.js
         belongs to another piece; only position lives here, nothing visual. -->
    <div class="sc-scenehost" style="position:absolute;inset:0"></div>
    <!-- 🔴 THE WAY BACK, ON SCREEN. A click on a tile flies the camera into a
         close-up and (measured) leaves 4 of 33 tiles in frame. Closing the
         card now returns to the whole map by itself, but that is not the only
         way into a close-up — "show on map" from a partner row leaves one with
         no card on top of it — so the recovery has to be VISIBLE and not a
         thing the player has to know. It is shown only while the camera is off
         the overview, because a permanent "Whole map" button on the whole map
         is noise that teaches nothing. -->
    <div class="sc-stagectl" style="position:absolute;top:10px;right:10px;z-index:5;display:flex;gap:6px">
      <button type="button" class="sc-btn sc-back" data-a="home" hidden
              title="Back to the whole map (Esc)">⤢ Whole map</button>
      <button type="button" class="sc-btn sc-retry3d" data-a="retry3d" hidden
              title="Draw the 3D map again">Try the 3D map</button>
    </div>
    <!-- 🔴 STARTS HIDDEN. ensureView() is the only thing that shows it, because
         ensureView() is now the only thing that mounts a view — and on a phone
         that does not happen at boot. Left visible, the curtain's "Drawing the
         map…" sat behind the Businesses list (the rail is translucent) and read
         as ghost text through the copy: photographed on a 390px phone. -->
    <div class="sc-boot is-gone"><p>Drawing the map…</p><small>Reading the businesses, the recipes and every lane between them.</small></div>
    <!-- 🔴 STARTS CLOSED, ON EVERY SCREEN. Open, this panel is 286px of opaque
         card in the bottom-left of the map, and projecting all 33 tiles against
         it measured two of them covered on the very first frame a player ever
         sees (Fishing Company 33%, Research Facility 44%) — and a different two
         behind the Businesses rail. The first paint belongs to the map; the
         panel is one click away in two places (its own title bar and the
         header's "How to read this map") and it stays open once opened. -->
    <section class="sc-float sc-map-legend" data-open="0" aria-label="How to read this map">
      <h2><button type="button" class="sc-fold-t" data-a="fold">How to read this map</button><button type="button" class="sc-fold" data-a="fold" aria-expanded="false">▼ Show</button></h2>
      <ol>${HOWTO.map((h) => `<li>${h}</li>`).join('')}</ol>
    </section>
  </div>
  <aside class="sc-rail" aria-label="Every tile on the map"></aside>
</div>
<footer class="sc-foot"><span class="sc-counts"></span><span class="sc-sp"></span><span class="sc-state"></span></footer>`;
}

/* The browsable index (the second tab). Grouped the way the owner grouped the
   pages: the four systems and the two marketplaces first, then each system's
   businesses. A row carries its legend badges so the rail answers "who needs
   Transport" without touching the map. */
function railHTML(data) {
  const nodes = arr(data.graph && data.graph.nodes);
  const sys = nodes.filter((n) => n.type === 'system');
  const ch = nodes.filter((n) => n.type === 'channel');
  const biz = nodes.filter((n) => n.type === 'business');
  const badges = (n) => `<span class="sc-row-b">${['transport', 'market', 'carMarket', 'card'].filter((k) => n.badges && n.badges[k]).map((k) => icon(k)).join('')}</span>`;
  /* 🔴 `data-row`, NOT `data-node`. fallback.js marks every tile of its DOM map
     with data-node, and the shell's delegated click handler sits on the whole
     overlay — so a rail-shaped selector caught the 2D map's own tiles as well,
     and one click on a tile ran the pick twice and flipped the view to the
     Businesses tab behind the player's back. The rail's rows carry an
     attribute no view uses. */
  const row = (n, note) => `<button type="button" class="sc-row" data-row="${esc(n.id)}">
    <span class="sc-row-h"><b>${esc(n.label)}</b>${n.status === 'planned' ? '<span class="sc-tag t-planned">PLANNED</span>' : ''}${badges(n)}</span>
    ${note ? `<small>${esc(note)}</small>` : ''}</button>`;
  const groups = [];
  groups.push(`<h3>Systems &amp; marketplaces</h3>` + sys.map((n) => row(n, n.blurb ? String(n.blurb).split('. ')[0] + '.' : null)).join('') + ch.map((n) => row(n, n.blurb)).join(''));
  for (const s of sys) {
    const mine = biz.filter((n) => n.system === s.id);
    if (!mine.length) continue;
    groups.push(`<h3>${esc(s.label)} — ${mine.length} businesses</h3>` + mine.map((n) => row(n, n.caption || n.plannedNote)).join(''));
  }
  const orphan = biz.filter((n) => !sys.some((s) => s.id === n.system));
  if (orphan.length) groups.push('<h3>Elsewhere</h3>' + orphan.map((n) => row(n, n.caption)).join(''));
  return `<h2>${biz.length} businesses · ${sys.length} systems · ${ch.length} marketplaces</h2>` + groups.join('');
}

/* ── search ─────────────────────────────────────────────────────────────── */
function buildIndex(data) {
  const out = [];
  for (const n of arr(data.graph && data.graph.nodes)) {
    out.push({ kind: n.type, id: n.id, name: n.label, alt: [n.pdfLabel || '', n.id], status: n.status, ic: null });
  }
  const rows = safe(() => (data.catalog && typeof data.catalog.all === 'function' ? data.catalog.all() : []), []);
  for (const r of arr(rows)) out.push({ kind: 'res', id: r.id, name: r.name || r.id, alt: [r.id], status: null, ic: r.icon || null });
  return out;
}
function searchIndex(idx, q) {
  const s = String(q || '').trim().toLowerCase();
  if (s.length < SC.search.minChars) return [];
  const hits = [];
  for (const e of idx) {
    const name = String(e.name).toLowerCase();
    const alts = e.alt.map((a) => String(a || '').toLowerCase());
    let score = -1;
    if (name === s || alts.indexOf(s) >= 0) score = 0;
    else if (name.indexOf(s) === 0 || alts.some((a) => a.indexOf(s) === 0)) score = 1;
    else if (name.indexOf(s) > 0) score = 2;
    else if (alts.some((a) => a.indexOf(s) > 0)) score = 3;
    if (score < 0) continue;
    /* a tile outranks a resource at the same score: the map is made of tiles,
       and "transport" must find the hub before it finds a cargo class */
    hits.push({ e, score: score * 2 + (e.kind === 'res' ? 1 : 0) });
  }
  hits.sort((a, b) => a.score - b.score || a.e.name.length - b.e.name.length || String(a.e.name).localeCompare(String(b.e.name)));
  return hits.slice(0, SC.search.maxResults).map((h) => h.e);
}
const TAGCLS = { res: 't-res', business: 't-biz', system: 't-sys', channel: 't-ch' };
const TAGTXT = { res: 'RESOURCE', business: 'BUSINESS', system: 'SYSTEM', channel: 'MARKET' };

function resultsHTML(list, q) {
  if (!list.length) return `<p class="sc-empty">Nothing on the map matches “${esc(q)}”. Try a business name, or a resource such as cloth, iron or fuel.</p>`;
  return list.map((e) => `<button type="button" class="sc-res" data-pick="${esc(e.kind)}" data-id="${esc(e.id)}">
    <span class="sc-res-ic">${e.ic ? esc(e.ic) : ''}</span>
    <span class="sc-res-n"><b>${esc(e.name)}</b><i>${esc(e.id)}</i></span>
    <span class="sc-tag ${TAGCLS[e.kind] || 't-res'}">${TAGTXT[e.kind] || 'ITEM'}</span></button>`).join('');
}

/* One resource, answered the way the owner asked: found in / made by / used by,
   plus whether it rides with Transport and whether that is enforced today. Every
   line is read off graph.resourceFlow — this function words it, it does not
   decide it. */
function flowHTML(flow, labelOf) {
  if (!flow || flow.known === false) {
    return `<div class="sc-flow"><h3>${esc((flow && flow.id) || 'Unknown')}</h3>
      <p class="sc-sum">${esc(flow && flow.phantom
        ? 'The game’s code mentions this id but no catalogue defines it, so nothing can ever hold one. It is never cargo.'
        : 'This id is not a resource on the map.')}</p></div>`;
  }
  const chip = (id) => `<button type="button" class="sc-node-chip" data-pick="node" data-id="${esc(id)}">${esc(labelOf(id))}</button>`;
  const src = flow.sources || {};
  const foundIn = [];
  for (const l of arr(src.loot)) foundIn.push(`<span class="sc-node-chip" data-static="1">${esc(l.label)}</span>`);
  for (const m of arr(src.madeInAll)) foundIn.push(`<span class="sc-node-chip${m.live ? '' : ' is-planned'}" data-static="1">${esc(labelOf(m.node))}${m.by ? ' (' + esc(m.by) + ')' : ''}</span>`);
  for (const t of arr(src.traders)) foundIn.push(`<span class="sc-node-chip" data-static="1">${esc(t.label || t.id || 'trader')}</span>`);
  const makers = arr(src.makers).map((m) => chip(m.biz));
  const users = arr(flow.consumers).map((c) => chip(c.by));
  const row = (k, items, none) => `<dt>${k}</dt><dd>${items.length ? items.join('') : `<span class="sc-none">${esc(none)}</span>`}</dd>`;
  let ship = '';
  if (flow.carrier) {
    ship = flow.carrier.enforcedToday
      ? 'Rides with Transport — the game enforces that today.'
      : 'On the owner’s map it rides with Transport. The game does not force that yet' + (flow.carrier.today ? ': ' + String(flow.carrier.today) : '.');
  } else if (flow.marketBlocked) ship = String(flow.marketBlocked);
  return `<div class="sc-flow">
    <h3>${flow.icon ? esc(flow.icon) + ' ' : ''}${esc(flow.name || flow.id)}</h3>
    <p class="sc-sum">${esc(flow.summary || '')}</p>
    <dl>
      ${row('Found in', foundIn, 'nothing drops or grows it')}
      ${row('Made by', makers, 'no business makes it')}
      ${row('Used by', users, 'nothing uses it yet')}
    </dl>
    ${ship ? `<p class="sc-sum" style="margin-top:9px">${esc(ship)}</p>` : ''}
  </div>`;
}

/* ═══════════════════════════════════════════════════════════════ open() ══ */
export function open(opts) {
  if (_opening) return _opening;
  /* Already open: do not build a second one — take the request as a
     re-target, which is what a second click on the tile (or a second deep
     link) actually means. */
  if (isOpen()) {
    const o = opts || {};
    /* same order as applyOpts() in boot(), for the same reason: a search run
       after a select throws the select away */
    if (o.search && S.setSearch) safe(() => S.setSearch(String(o.search)));
    if (o.select && S.selectNode) safe(() => S.selectNode(String(o.select), true));
    safe(() => S.root.focus({ preventScroll: true }));
    return Promise.resolve(API);
  }
  _opening = boot(opts || {}).then((r) => { _opening = null; return r; }, (e) => {
    _opening = null;
    try { console.error('[supplychain] the map could not open', e); } catch (_) {}
    safe(() => bridge.toast('The supply chain map could not open.'));
    hardClose();
    return null;
  });
  return _opening;
}

async function boot(opts) {
  const doc = document;
  const data = buildData();

  /* one style element, reused by a later open (five opens must not leave five
     stylesheets in the head) */
  let style = doc.getElementById(STYLE_ID);
  let ownsStyle = false;
  if (!style) { style = doc.createElement('style'); style.id = STYLE_ID; style.textContent = css(); doc.head.appendChild(style); ownsStyle = true; }

  const root = doc.createElement('div');
  root.id = SC.overlay.id;
  /* The four declarations that decide whether this covers the screen are set
     INLINE as well as in the sheet: nothing in a 215k-line index.html can
     outrank an inline style, and an overlay that is merely *mostly* on top is
     worse than one that is obviously broken. */
  root.style.setProperty('position', 'fixed');
  root.style.setProperty('inset', '0');
  root.style.setProperty('z-index', String(SC.overlay.zIndex));
  root.style.setProperty('color-scheme', 'dark');
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'true');
  root.setAttribute('aria-label', 'Supply and demand map');
  root.tabIndex = -1;
  root.innerHTML = chromeHTML(data);
  doc.body.appendChild(root);

  const q = (sel) => root.querySelector(sel);
  const stage = q('.sc-stage');
  const sceneHost = q('.sc-scenehost');
  const backBtn = q('.sc-back');
  const retryBtn = q('.sc-retry3d');
  const rail = q('.sc-rail');
  const body = q('.sc-body');
  const findPanel = q('.sc-find');
  const findBody = q('.sc-find-body');
  const input = q('.sc-search input');
  const byId = new Map(arr(data.graph && data.graph.nodes).map((n) => [n.id, n]));

  S = {
    root, style, ownsStyle, data, stage, sceneHost, backBtn, retryBtn, rail, body, findPanel, findBody, input,
    view: null, viewKind: null, hover: null,
    /* why the 2D map is on screen: 'nogl' | 'nothree' | 'slow' | 'forced' |
       null. The footer is only allowed to say "no WebGL" for 'nogl'. */
    view2dReason: null,
    scenePending: null,   // a scene still baking behind a drawn 2D map
    focused: false,       // the camera is on a tile rather than the overview
    idx: buildIndex(data),
    filters: new Set(), tab: 'overview', selected: null, flow: null,
    timers: [], off: [], restoreFocus: safe(() => doc.activeElement, null),
    prevOverflow: doc.body.style.overflow,
    hoverVMs: new Map(), t0: Date.now(),
  };
  doc.body.style.overflow = 'hidden';

  /* 🔴 EVERY let/const THIS CLOSURE USES IS DECLARED HERE, ABOVE THE `return`.
     The helpers below the return are function DECLARATIONS, which hoist; a
     `let` down there would never execute its initialiser and would sit in the
     temporal dead zone for the life of the shell, so the first hover threw
     ReferenceError and the map looked inert. Functions below, bindings above. */
  let hoverTimer = 0, searchTimer = 0, viewPending = null, keepCloseUp = 0, retryN = 0;
  const MODAL_CB = {
    /* a partner click RE-TARGETS the one modal and flies the camera — the
       player's place on the map must follow what they are reading */
    onNavigate: (id) => { if (!id || !S) return; S.selected = id; flyTo(id); markRail(); openNodeModal(id); },
    /* "show me this on the map": the card gets out of the way and the camera
       goes TO the tile, so onClose's return-to-overview must be suppressed for
       this one close — closeModal() fires onClose synchronously, before the
       flyTo below, and without the guard the two moves fight each other. */
    onHighlight: (id) => { keepCloseUp++; safe(() => closeModal()); keepCloseUp = 0; if (id && S) { S.selected = id; flyTo(id); markRail(); } },
    onOpen: (opId) => {
      const ok = safe(() => bridge.openBusiness(opId), false);
      /* the legacy screen opens UNDER a full-screen overlay, so getting there
         means leaving here; if the bridge refused, stay and say so */
      if (ok) hardClose();
      else safe(() => bridge.toast('That business screen is not available right now.'));
    },
    onCopyProposal: (id) => copyProposal(id),
    /* 🔴 CLOSING THE CARD GIVES THE MAP BACK. This was an explicit no-op —
       "the map stays; the selection stays with it" — and it was measured as
       the single worst moment in the feature: one click on a tile flies
       scene.js's focus() into a close-up, and after the card is dismissed the
       player is left with 4 of 33 tiles on an empty floor with no district
       labels and nothing on screen offering a way out. (The Systems overview
       tab does restore it, but it is already painted as the active tab, so
       nothing suggests it is a control.) Reading one business is a detour, not
       a destination: the card is the close-up's reason to exist, and when it
       goes the overview comes back. The selection is not "lost" — the rail
       still scrolls to the tile the player just read, and one click re-opens
       it. keepCloseUp is the one exception, for the card that closes itself in
       order to SHOW the player a tile. */
    onClose: () => { if (keepCloseUp) return; returnToWholeMap(); },
  };

  const phone = (window.innerWidth || 0) <= UI.phoneW;
  rail.innerHTML = (phone ? PHONE_HINT : '') + railHTML(data);
  paintCounts();
  paintFooter('Loading…');

  /* ── the view: 3D, else the 2D fallback ───────────────────────────────── */
  const cb = { onHover, onPick };
  /* 🔴 A PHONE DOES NOT PAY FOR A MAP IT DOES NOT OPEN ON. The phone build
     already opens on the Businesses list (see setTab below) — and then spent
     its whole boot baking 33 plates and 247 lanes into a canvas nothing was
     looking at. Measured: 2044 ms on a 390px phone against this screen's 2 s
     bar, the one viewport that missed, while desktop came in at 1.7 s. The
     scene is mounted the first time the player actually asks for the map,
     which is setTab('overview') and nothing else. Desktop is unchanged: it
     opens on the map, so it waits for the map. */
  if (!phone) { const v = await ensureView(); if (v === null && (!S || !S.root.isConnected)) return null; }

  S.hover = safe(() => mountHover(root), null);

  wire();
  /* the two entry points open() needs when the shell is ALREADY up — see the
     re-target branch in open() */
  S.selectNode = selectNode;
  S.setSearch = (v) => { input.value = v; runSearch(true); };
  S.setTab = setTab;
  /* 🔴 A PHONE OPENS ON THE LIST, NOT ON THE MAP. At 390px the tiles project
     to 53 x 31 CSS px and every label and NEEDS line is 3-4px — the 3D map is
     decorative at that width, and the round-1 build left a phone player on it
     with nothing on screen saying the readable view was one tab away. The map
     is still there, one tap on "Systems overview", and the rail says so. */
  if (phone) setTab('businesses');
  paintFooter();
  applyOpts(opts);
  safe(() => root.focus({ preventScroll: true }));
  return API;

  /* ══ everything below closes over this one shell ═════════════════════ */

  /* 🔴 SEARCH FIRST, THEN SELECT — THE ORDER IS THE WHOLE FIX. Passed
     together (open({select,search}), and therefore
     ?supplychain=1&tile=X&find=Y, the deep link the integration piece wires
     and the obvious tutorial hook) the round-1 build ran select and then
     search; runSearch's exact-hit branch calls pickResource, which deselects
     and pulls the camera home so the whole lit route is in frame. So `select`
     was silently dropped: no modal, state reported selected:null, and no
     console error said why. Lighting the resource first and THEN selecting
     the tile gives the player both, which is what asking for both means. */
  function applyOpts(o) {
    o = o || {};
    if (o.search) { input.value = String(o.search); runSearch(true); }
    if (o.select) selectNode(String(o.select), true);
  }

  /* 🔴 THE 3D MAP GETS A SOFT DEADLINE, NOT A VERDICT. mountScene() awaits
     three.js, and with the CDN blocked (an offline player, a locked-down
     network) its own loader gives up after about six seconds — measured 6.1 s
     to a drawn 2D map, three times this screen's bar, all of it spent on a
     boot line. The 2D fallback needs no network at all, so at
     UI.scene2dAfterMs it is drawn so the screen is never empty.
     ⚠ WHAT THIS USED TO DO, AND WHY IT DOES NOT: round 3 treated the same
     deadline as a decision — it DISPOSED a scene that arrived late, on the
     theory that swapping under a reader is worse than not having it. Measured,
     4 of 8 cold opens of the real page missed the deadline, so half of all
     players were permanently handed the stand-in for a feature that is a 3D
     map, and the footer then blamed their hardware. The scene now keeps baking
     and adoptLateScene() swaps it in; UI.sceneGiveUpMs is the only hard stop,
     and `reason` (never the deadline) is what the footer is allowed to say. */
  async function mountView() {
    if (opts.force2d === true) return mount2D('forced');
    /* Asked once, here, and remembered: the answer decides what the footer is
       allowed to claim and whether "Try the 3D map" is offered at all. */
    const gl = safe(() => webglOk(), true) !== false;
    let settled = false;
    const scene = Promise.resolve(safe(() => mountScene(sceneHost, quietGraph(data.graph), cb), null))
      .catch(() => null)
      .then((v) => { settled = true; return v; });
    const raced = await Promise.race([
      scene,
      /* `opts.scene2dAfterMs` is a TEST SEAM, in the same spirit as the
         existing `opts.force2d`: the meanwhile-2D-then-swap path only happens
         on a machine slow enough to miss the deadline, and untested recovery
         code is how the last one rotted. Pass 0 and every open takes it. */
      new Promise((res) => { const t = setTimeout(() => res(null), Number.isFinite(opts.scene2dAfterMs) ? opts.scene2dAfterMs : UI.scene2dAfterMs); S.timers.push(t); }),
    ]);
    if (raced) return { view: raced, kind: 'scene', reason: null };
    /* Settled with nothing = mountScene said no, and webglOk() says which no.
       Not settled = it is still working; draw the 2D map MEANWHILE and hand
       the scene to adoptLateScene() when it arrives. Disposing it here (what
       round 3 did) is what made half of all cold opens permanently 2D. */
    if (settled) return mount2D(gl ? 'nothree' : 'nogl');
    S.scenePending = scene;
    scene.then((late) => {
      if (!S || S.scenePending !== scene) { if (late) safe(() => late.dispose()); return; }
      S.scenePending = null;
      if (late) adoptLateScene(late); else { S.view2dReason = gl ? 'nothree' : 'nogl'; paintFooter(); updateStageCtl(); }
    }, () => {});
    /* the hard stop: a blocked CDN can leave that promise pending forever, and
       a pending promise holding a "the 3D map is coming" footer is a lie too */
    S.timers.push(setTimeout(() => {
      if (!S || S.scenePending !== scene || S.viewKind !== '2d') return;
      S.scenePending = null; S.view2dReason = gl ? 'nothree' : 'nogl'; paintFooter(); updateStageCtl();
    }, UI.sceneGiveUpMs));
    return mount2D('slow');
  }

  /* The ONE place the 2D map is created. `reason` is why, and it is the only
     input to the footer's wording — see paintFooter(). */
  function mount2D(reason) {
    stage.classList.add('is-2d');
    /* the scene may still be baking into its own host behind this; keep it out
       of the way without taking its size away (display:none would make
       scene.js fit itself to the 280px floor and it would swap in mis-framed) */
    hideSceneHost(true);
    const v = safe(() => mountFallback(stage, data.graph, cb), null);
    return { view: v, kind: v ? '2d' : null, reason: v ? reason : null };
  }
  function hideSceneHost(hidden) {
    if (!sceneHost) return;
    sceneHost.style.visibility = hidden ? 'hidden' : '';
    sceneHost.style.pointerEvents = hidden ? 'none' : '';
  }

  /* 🔴 A LATE SCENE IS STILL THE PRODUCT. The 2D list is a stand-in for the
     thing this feature is — a 3D map of the economy — so when the real one
     finishes it takes over, and everything the player did in the meantime
     (a search, a filter, a selected tile) is carried across rather than
     dropped. The swap is deliberately NOT offered as a choice: measured, the
     2D map arrives in ~200 ms and the scene 1–4 s later, and a dialog asking
     "the 3D map is ready, switch?" in that window is a second decision about
     something the player already asked for by opening the feature. */
  function adoptLateScene(v) {
    if (!S || !S.root.isConnected) { safe(() => v.dispose()); return; }
    const twoD = S.view;
    S.view = v; S.viewKind = 'scene'; S.view2dReason = null;
    stage.classList.remove('is-2d');
    hideSceneHost(false);
    safe(() => twoD && twoD.dispose());
    if (S.flow) safe(() => v.highlightFlow(S.flow));
    applyFilters();
    if (S.selected) flyTo(S.selected); else flyHome();
    paintFooter();
    updateStageCtl();
  }

  /* The visible way out of a 2D map that should have been 3D. Only ever shown
     when webglOk() is true, because on a machine without WebGL it would be a
     button that cannot work. */
  async function retry3d() {
    if (!S || S.viewKind !== '2d' || S.scenePending) return;
    paintFooter('Drawing the 3D map…');
    /* 🔴 A RETRY THAT CANNOT ACTUALLY RETRY IS A DEAD BUTTON. three.boot.js
       MEMOISES its load (`_booting`), so once the library has failed, every
       later boot() returns the same cached null and mountScene would refuse
       again without a single request leaving the browser — the player would
       press a button and watch nothing happen, forever. three.boot has no
       reset, and it is not this piece's file. Importing it under a fresh
       specifier gives a fresh module instance whose `_booting` is null, so the
       script tag is injected again (local copy first, CDN second — the same
       two URLs, none of them retyped here). It is safe for the rest of the app
       because boot() short-circuits on `window.THREE`: the moment this copy
       succeeds, scene.js's own canonical import sees the global and returns
       it. Skipped entirely when THREE is already loaded, which is the
       WebGLRenderer-construction failure case. */
    if (!safe(() => !!window.THREE, false)) {
      await import('../weaponsmith/three.boot.js?retry=' + (++retryN)).then((m) => m.boot()).catch(() => null);
      if (!S) return;
    }
    const scene = Promise.resolve(safe(() => mountScene(sceneHost, quietGraph(data.graph), cb), null)).catch(() => null);
    S.scenePending = scene;
    const v = await scene;
    if (!S || S.scenePending !== scene) { if (v) safe(() => v.dispose()); return; }
    S.scenePending = null;
    if (v) adoptLateScene(v);
    else { S.view2dReason = safe(() => webglOk(), true) !== false ? 'nothree' : 'nogl'; paintFooter(); updateStageCtl(); }
  }

  /* 🔴 THE TWO STAGE CONTROLS ARE DERIVED, NEVER TOGGLED BY HAND. Every path
     that can move the camera or change the view calls this; nothing else may
     touch `hidden` on either button, or the pair goes out of step with the
     thing they describe (which is how a "Whole map" button ends up sitting on
     the whole map). */
  function updateStageCtl() {
    if (!S) return;
    S.focused = !!(S.selected && S.viewKind === 'scene');
    if (S.backBtn) S.backBtn.hidden = !S.focused;
    /* ONLY for 'nothree'. Not for 'nogl' (a button that cannot work), and not
       for 'slow' either — while the scene is still baking the footer already
       says so and this button would be a second, dead way to ask for the thing
       that is already on its way. */
    if (S.retryBtn) S.retryBtn.hidden = !(S.viewKind === '2d' && S.view2dReason === 'nothree');
    placeStageCtl();
  }

  /* 🔴 THE 2D STAGE SCROLLS, AND AN ABSOLUTE CONTROL SCROLLS AWAY WITH IT.
     sc.css.js already learned this for `.sc-float` ("the search answer would
     leave the screen while the player read it") and pins it with
     position:fixed. The same applies to "Try the 3D map": a player who has
     scrolled the 2D list down to find out where they are is exactly the player
     who wants it, and it would be somewhere above their scrollbar. Fixed is
     against the viewport, so the offsets come from the stage's own rect rather
     than from a number that would have to be kept in sync with the header's
     height. In the 3D view the stage never scrolls and absolute is correct. */
  function placeStageCtl() {
    const wrap = root.querySelector('.sc-stagectl');
    if (!wrap) return;
    if (S.viewKind === '2d') {
      const r = safe(() => stage.getBoundingClientRect(), null);
      if (!r) return;
      wrap.style.position = 'fixed';
      wrap.style.top = Math.round(r.top + 10) + 'px';
      wrap.style.right = Math.round(Math.max(0, (window.innerWidth || r.right) - r.right) + 10) + 'px';
    } else {
      wrap.style.position = 'absolute';
      wrap.style.top = '10px';
      wrap.style.right = '10px';
    }
  }

  /* The recovery itself, in one place so the button, Escape and the modal's
     close all do exactly the same thing. */
  function returnToWholeMap() {
    if (!S) return false;
    const was = S.selected;
    S.selected = null;
    markRail();
    flyHome();
    /* the tile the player just read keeps its place in the list, so "where was
       I" is answered by the rail even though the map is back to the overview */
    if (was && S.tab === 'businesses') {
      const row = rail.querySelector(`.sc-row[data-row="${was}"]`);
      if (row) safe(() => row.scrollIntoView({ block: 'nearest' }));
    }
    updateStageCtl();
    return !!was;
  }

  /* 🔴 WAKE THE CAMERA BEFORE YOU MOVE IT, OR THE TURNTABLE EATS THE MOVE.

     scene.js runs a gentle idle spin after CAM.idleAfterMs with nothing
     selected — and that branch does `Object.assign(tw.to, cur)` on EVERY
     frame, which does not merely spin the camera: it overwrites whatever
     target a tween was flying to. Nothing in the scene refreshes `lastInput`
     except pointerdown / drag / pointerup / wheel, and a player who types in
     the search box touches none of them. So nine seconds after the last click
     on the canvas, home() and select() became no-ops that reported success:
     the critic photographed a "cloth" search framed on whatever close-up the
     previous click had left behind, slowly rotating — the shot that reads as a
     knocked-over table. Nothing threw; state() said the flow was lit, and it
     was, somewhere off frame.

     A wheel event with deltaY 0 is the one input scene.js accepts that changes
     nothing: Math.sign(0) is 0, so the distance it computes is the distance it
     already had. It refreshes lastInput, the idle branch stands down for
     another nine seconds, and the move issued immediately after survives.
     Delete this the day scene.js exposes the camera's idle state. */
  function wakeCam() {
    if (!S || S.viewKind !== 'scene') return;
    const cv = stage.querySelector('canvas');
    if (!cv) return;
    safe(() => cv.dispatchEvent(new WheelEvent('wheel', { deltaY: 0, deltaX: 0, bubbles: false, cancelable: true })));
  }
  function flyTo(id) { wakeCam(); safe(() => S.view && S.view.select(id)); }
  function flyHome() { wakeCam(); safe(() => S.view && S.view.home()); }

  /* The ONE place a view is ever assigned. Idempotent and re-entrant: a second
     tap on "Systems overview" while the first is still baking joins the first
     promise instead of starting a second WebGL context. Returns the view, or
     null when the shell was closed under it. */
  async function ensureView() {
    if (!S) return null;
    if (S.view) return S.view;
    if (viewPending) return viewPending;
    const curtain = root.querySelector('.sc-boot');
    if (curtain) curtain.classList.remove('is-gone');
    viewPending = (async () => {
      const r = (await mountView()) || { view: null, kind: null, reason: null };
      const v = r.view;
      if (!S || !S.root.isConnected) { if (v) safe(() => v.dispose()); return null; }
      S.viewKind = v ? r.kind : null;
      S.view2dReason = v && r.kind === '2d' ? r.reason : null;
      S.view = v;
      if (curtain) curtain.classList.add('is-gone');
      paintFooter();
      /* a resource searched from the list, before the map existed */
      if (S.flow) safe(() => v && v.highlightFlow(S.flow));
      applyFilters();
      updateStageCtl();
      return v;
    })();
    try { return await viewPending; } finally { viewPending = null; }
  }

  function nodeById(id) { return byId.get(id) || null; }
  function labelOf(id) { const n = byId.get(id); return n ? n.label : id; }

  /* ── hover ───────────────────────────────────────────────────────────── */
  function onHover(id, xy) {
    clearTimeout(hoverTimer);
    if (!id || isModalOpen()) { hoverTimer = setTimeout(() => S && S.hover && safe(() => S.hover.hide()), SC.hover.hideDelayMs); return; }
    hoverTimer = setTimeout(() => showHover(id, xy), SC.hover.showDelayMs);
  }
  function showHover(id, xy) {
    if (!S || !S.hover || isModalOpen()) return;
    let vm = S.hoverVMs.get(id);
    if (!vm) { vm = safe(() => hoverVM(id, data), null); if (vm) S.hoverVMs.set(id, vm); }
    if (!vm) return;
    safe(() => S.hover.show(vm, anchorFor(id, xy)));
  }
  /* 🔴 THE ONE COORDINATE CONVERSION. See the file header: the scene projects
     into CANVAS space, the fallback into viewport space, and the hover card
     places itself in viewport space. */
  function anchorFor(id, xy) {
    const p = safe(() => (S.view && S.view.project ? S.view.project(id) : null), null);
    if (p && p.visible) {
      const o = S.viewKind === 'scene' ? stage.getBoundingClientRect() : { left: 0, top: 0 };
      const r = { left: o.left + p.left, top: o.top + p.top, right: o.left + p.right, bottom: o.top + p.bottom };
      return { x: o.left + p.x, y: o.top + p.y, rect: r };
    }
    if (xy && Number.isFinite(xy.clientX)) return { x: xy.clientX, y: xy.clientY };
    if (xy && Number.isFinite(xy.x)) {
      const o = S.viewKind === 'scene' ? stage.getBoundingClientRect() : { left: 0, top: 0 };
      return { x: o.left + xy.x, y: o.top + xy.y };
    }
    return { x: 0, y: 0 };
  }

  /* ── pick / modal ────────────────────────────────────────────────────── */
  function onPick(id) {
    if (!id) { S.selected = null; markRail(); updateStageCtl(); return; }
    selectNode(id, false);
  }
  function selectNode(id, fly) {
    S.selected = id;
    if (fly) flyTo(id);
    markRail();
    /* the close-up exists from this moment, not from the moment the card is
       dismissed — a player who drags the card aside must already see the way
       back, and the modal never covers the stage's top-right corner */
    updateStageCtl();
    openNodeModal(id);
  }
  function modalOpts() {
    return {
      opEcon: bridge.opEcon, opLabel: bridge.opLabel, held: bridge.held, owns: bridge.ownsOp,
      gems: bridge.ready() ? safe(() => bridge.gems(), null) : null,
      transportPhase: bridge.transportPhase,
      admin: safe(() => bridge.isAdmin(), false), signedIn: safe(() => bridge.signedIn(), false),
      proposal: true,
    };
  }
  function openNodeModal(id) {
    safe(() => S.hover.hide());
    const vm = safe(() => modalVM(id, data, modalOpts()), null);
    if (!vm) return;
    safe(() => openModal(root, vm, MODAL_CB));
  }
  /* Admin-only convenience: the OFF-by-default Ops-Econ overlay for one tile,
     on the clipboard, in the exact shape the existing admin override merges.
     Nothing is applied here — this feature never writes to the economy. */
  async function copyProposal(id) {
    const node = nodeById(id);
    if (!node) return;
    try {
      const prop = await import('./proposal.js');
      const overlay = prop.buildOpsEconOverlay(data, SC, bridge.opEcon) || {};
      const key = node.opId || node.id;
      const row = overlay[key];
      if (!row) { bridge.toast('No proposed overlay for this one.'); return; }
      const text = JSON.stringify({ [key]: row }, null, 2);
      await navigator.clipboard.writeText(text);
      bridge.toast('Proposed overlay for ' + node.label + ' copied. It is OFF until an admin publishes it.');
    } catch (e) { safe(() => bridge.toast('Could not copy the proposed overlay.')); }
  }

  /* ── search ──────────────────────────────────────────────────────────── */
  function runSearch(now) {
    clearTimeout(searchTimer);
    const go = () => {
      const val = input.value;
      S.input.parentNode.classList.toggle('has-q', !!val);
      const hits = searchIndex(S.idx, val);
      if (String(val).trim().length < SC.search.minChars) { showFind(false); return; }
      findBody.innerHTML = resultsHTML(hits, val);
      showFind(true);
      /* ONE exact hit is what the owner's own example is ("cloth"), so light it
         immediately instead of making the player click their own answer. */
      if (hits.length && hits[0].kind === 'res' && String(hits[0].name).toLowerCase() === String(val).trim().toLowerCase()) pickResource(hits[0].id, false);
    };
    if (now) go(); else searchTimer = setTimeout(go, SC.search.debounceMs);
  }
  function showFind(on) {
    findPanel.classList.toggle('is-on', !!on);
    /* the two floating panels share the left gutter; the explainer is for a
       player who has not asked anything yet, so the answer wins the space */
    stage.classList.toggle('is-finding', !!on);
    if (!on) { S.flow = null; safe(() => S.view && S.view.highlightFlow(null)); }
  }
  function pickResource(resId, replacePanel) {
    S.flow = resId;
    /* 🔴 FRAME THE WHOLE ROUTE. highlightFlow lights nodes across the map, and
       if the camera was still parked on whatever tile the player clicked last,
       half the lit route was off screen — the "cloth" answer drew Fashion Brand
       and Medical Corporation somewhere behind the viewer. home() deselects and
       pulls back to the overview, which is the only framing guaranteed to hold
       every node a flow can touch. */
    S.selected = null;
    flyHome();
    markRail();
    updateStageCtl();
    const lit = safe(() => (S.view ? S.view.highlightFlow(resId) : null), null);
    const flow = safe(() => data.graph.resourceFlow(resId), null);
    findBody.innerHTML = flowHTML(flow, labelOf)
      + (lit ? '' : '<p class="sc-empty">No lane on the map carries this one yet — the panel above says where it does come from.</p>')
      + '<div style="padding:8px 10px"><button type="button" class="sc-btn" data-a="back">‹ Back to results</button></div>';
    showFind(true);
    findPanel.querySelector('.sc-find-body').scrollTop = 0;
    if (replacePanel === false) { /* kept for the caller's intent; the panel is the same either way */ }
  }

  /* ── filters / tabs / rail ───────────────────────────────────────────── */
  function applyFilters() {
    const active = FILTERS.filter((f) => S.filters.has(f.key));
    const pred = active.length ? (n) => active.every((f) => f.test(n)) : null;
    safe(() => S.view && S.view.setFilter(pred));
    for (const b of root.querySelectorAll('.sc-chip')) b.setAttribute('aria-pressed', S.filters.has(b.dataset.f) ? 'true' : 'false');
    for (const r of rail.querySelectorAll('.sc-row')) {
      const n = byId.get(r.dataset.row);
      const off = !!(pred && n && n.type === 'business' && !pred(n));
      r.classList.toggle('is-off', off);
    }
    paintFooter();
  }
  function paintCounts() {
    const biz = arr(data.graph.nodes).filter((n) => n.type === 'business');
    for (const f of FILTERS) {
      const el = root.querySelector(`[data-n="${f.key}"]`);
      if (el) el.textContent = String(biz.filter(f.test).length);
    }
  }
  function markRail() {
    for (const r of rail.querySelectorAll('.sc-row')) r.setAttribute('aria-current', r.dataset.row === S.selected ? 'true' : 'false');
    /* node ids are plain (letters, digits, one colon), so a quoted attribute
       selector needs no escaping */
    const cur = S.selected && rail.querySelector(`.sc-row[data-row="${S.selected}"]`);
    if (cur && S.tab === 'businesses') safe(() => cur.scrollIntoView({ block: 'nearest' }));
  }
  function setTab(tab) {
    S.tab = tab;
    body.setAttribute('data-view', tab);
    for (const b of root.querySelectorAll('.sc-tabs button')) b.setAttribute('aria-selected', b.dataset.tab === tab ? 'true' : 'false');
    if (tab === 'overview') { S.selected = null; markRail(); updateStageCtl(); ensureView().then(() => { flyHome(); updateStageCtl(); }); }
    else { markRail(); updateStageCtl(); }
  }

  function markStrips() {
    if (!S) return;
    for (const strip of root.querySelectorAll('.sc-strip')) {
      const sc = strip.firstElementChild;
      if (!sc) continue;
      const more = (sc.scrollWidth - sc.clientWidth - sc.scrollLeft) > 6;
      strip.setAttribute('data-more', more ? '1' : '0');
    }
  }

  /* 🔴 THE FOOTER MAY ONLY SAY "NO WEBGL" WHEN THERE IS NO WEBGL. It said it
     for every 2D map, including the ones drawn on a perfectly capable desktop
     that simply lost a 2200 ms race — measured on 4 of 8 cold opens of the
     real page. That sentence is the reason a player would never press
     anything: it names a hardware limit they cannot do anything about. Each
     reason now gets its own words, and two of the four also put a button on
     the stage (see updateStageCtl). */
  function viewNote() {
    if (!S || S.viewKind !== '2d') return '';
    switch (S.view2dReason) {
      case 'nogl': return ' · 2D view (this device has no WebGL)';
      case 'nothree': return ' · 2D view — the 3D map could not load';
      case 'slow': return ' · 2D view while the 3D map finishes drawing…';
      case 'forced': return ' · 2D view';
      default: return ' · 2D view';
    }
  }

  /* ── footer ──────────────────────────────────────────────────────────── */
  function paintFooter(note) {
    /* 🔴 THE REASON, MACHINE-READABLE, FROM THE SAME PLACE THE SENTENCE IS.
       "Did the chrome blame WebGL for a fallback WebGL could have served" is
       the whole bar of this round, and until now the only way to ask it was to
       regex the footer's prose — which passes the day someone rewords the
       sentence and keeps the wrong branch. These two attributes are written in
       the one function that also writes the words, so they cannot disagree
       with what the player is reading, and they are what a gate should assert
       on. They are also why the footer is repainted (rather than left) on
       every view change. */
    safe(() => { root.dataset.view = S.viewKind || ''; root.dataset.view2d = S.view2dReason || ''; });
    const g = data.graph || {};
    const res = safe(() => data.catalog.all().length, 0);
    const counts = root.querySelector('.sc-counts');
    const state = root.querySelector('.sc-state');
    if (counts) counts.textContent = `${arr(g.nodes).length} tiles · ${arr(g.edges).length} links · ${res} resources${S.filters.size ? ' · filtered' : ''}`;
    if (state) {
      if (note) { state.textContent = note; state.className = 'sc-state'; return; }
      if (!bridge.ready()) { state.textContent = 'No game bridge — structure only, every figure reads “unknown”.'; state.className = 'sc-state sc-warn'; }
      else { state.textContent = `Figures read live from the game${viewNote()}`; state.className = 'sc-state'; }
    }
  }

  /* ── events ──────────────────────────────────────────────────────────── */
  function on(el, ev, fn, opt) { el.addEventListener(ev, fn, opt); S.off.push(() => el.removeEventListener(ev, fn, opt)); }
  function wire() {
    on(root, 'click', (e) => {
      /* 🔴 THE MODAL LIVES INSIDE THIS ROOT AND SPEAKS THE SAME data-a DIALECT.
         Its own Close button carries data-a="close", so without this line one
         click on it closed the whole map instead of the card. modal.js routes
         its own clicks; the shell must not touch anything inside its host. */
      if (e.target.closest && e.target.closest('[data-sc-modal]')) return;
      const t = e.target.closest('[data-a],[data-tab],[data-f],[data-pick],[data-row]');
      if (!t || t.hasAttribute('data-static')) return;
      const a = t.getAttribute('data-a');
      if (a === 'close') { hardClose(); return; }
      if (a === 'home') { returnToWholeMap(); return; }
      if (a === 'retry3d') { retry3d(); return; }
      if (a === 'clear') { input.value = ''; input.focus(); runSearch(true); return; }
      if (a === 'closefind') { showFind(false); return; }
      if (a === 'back') { runSearch(true); return; }
      if (a === 'fold') {
        /* 🔴 ALWAYS WRITE THE STATE ONTO THE .sc-fold BUTTON, NEVER ONTO `t`.
           The panel's TITLE is a second data-a="fold" target (a closed panel is
           a title bar, and a title bar that is not clickable reads as dead
           chrome) — and `t.textContent = '▲ Hide'` on that one renamed the
           panel to "▲ Hide". */
        const panel = t.closest('.sc-map-legend');
        setFold(panel, panel.getAttribute('data-open') !== '1');
        return;
      }
      if (a === 'howto') {
        const panel = root.querySelector('.sc-map-legend');
        setFold(panel, true);
        safe(() => panel.scrollIntoView({ block: 'nearest' }));
        return;
      }
      if (t.hasAttribute('data-tab')) { setTab(t.getAttribute('data-tab')); return; }
      if (t.hasAttribute('data-f')) {
        const k = t.getAttribute('data-f');
        if (S.filters.has(k)) S.filters.delete(k); else S.filters.add(k);
        applyFilters(); return;
      }
      if (t.hasAttribute('data-pick')) {
        const kind = t.getAttribute('data-pick'), id = t.getAttribute('data-id');
        if (kind === 'res') pickResource(id, true);
        else selectNode(id, true);
        return;
      }
      if (t.hasAttribute('data-row')) { selectNode(t.getAttribute('data-row'), true); return; }
    });
    /* the two sideways strips say, on screen, when there is more to the right */
    for (const strip of root.querySelectorAll('.sc-strip')) {
      const sc = strip.firstElementChild;
      if (sc) on(sc, 'scroll', markStrips, { passive: true });
    }
    on(window, 'resize', markStrips, { passive: true });
    on(window, 'resize', placeStageCtl, { passive: true });
    markStrips();
    /* once more after the web fonts land — an unloaded Cinzel measures narrower
       than the one that paints, and the first mark can say "nothing to see" */
    S.timers.push(setTimeout(markStrips, 400));
    on(input, 'input', () => runSearch(false));
    on(input, 'keydown', (e) => {
      if (e.key === 'Enter') { const first = findBody.querySelector('.sc-res'); if (first) first.click(); e.preventDefault(); }
      if (e.key === 'Escape') { e.stopPropagation(); if (input.value) { input.value = ''; runSearch(true); } else showFind(false); }
    });
    /* Esc closes the map — but modal.js traps Esc first (capture + stopPropagation),
       so a modal always closes before the overlay does. */
    /* 🔴 ESCAPE UNWINDS ONE STEP AT A TIME. A player in a close-up pressed Esc
       expecting the close-up to end and lost the whole feature instead — the
       same destructive-by-default shape as the old onClose. The ladder is:
       modal (trapped by modal.js first) → close-up → the overlay. A second Esc
       from the overview still closes, so nothing became harder to leave. */
    on(document, 'keydown', (e) => {
      if (e.key !== 'Escape' || isModalOpen()) return;
      e.preventDefault();
      if (S && S.focused && returnToWholeMap()) return;
      hardClose();
    });
    /* the two debounce timers are the only state close() cannot see from
       outside this closure, so hand it a way to cancel them */
    S.off.push(() => { clearTimeout(hoverTimer); clearTimeout(searchTimer); });
  }
}

/* ── close ──────────────────────────────────────────────────────────────── */
/* Nothing may survive this: no element, no listener, no timer, no GL context.
   open/close five times is a bar the feature is measured against, and every
   line below exists because one of them leaked in some other overlay in this
   app at some point. */
export function close() { return hardClose(); }

function hardClose() {
  if (!S) return false;
  const s = S; S = null;
  safe(() => closeModal());
  for (const f of s.off.splice(0)) safe(f);
  for (const t of s.timers.splice(0)) clearTimeout(t);
  safe(() => s.hover && s.hover.dispose());
  safe(() => s.view && s.view.dispose());
  safe(() => s.root.remove());
  if (s.ownsStyle) safe(() => s.style.remove());
  safe(() => { document.body.style.overflow = s.prevOverflow || ''; });
  safe(() => { if (s.restoreFocus && s.restoreFocus.isConnected && s.restoreFocus.focus) s.restoreFocus.focus({ preventScroll: true }); });
  s.hoverVMs.clear();
  return true;
}

/* The stable object the globals hand out: the same reference for the life of
   the module, so a caller that kept it across a close/open still works. */
const API = {
  open, close, isOpen,
  get data() { return S ? S.data : null; },
  get graph() { return S ? S.data.graph : null; },
  get view() { return S ? S.view : null; },
  /* 🔴 THIS state() IS THE SOURCE OF THE FOUR RECOVERY FIELDS, NOT THE DOOR.
     `view2dReason` / `focused` / `scenePending` / `webgl` live here because
     webglOk() and S are module-private. For two rounds nothing imported this
     object, so the probe every test actually reaches —
     `window.__mg.supplyChain.state()` in index.js — answered `undefined` for
     all four and would have scored an HONEST "the 3D map could not start"
     footer as a missing one. index.js now imports this API and copies the four
     through, so the documented door and the honest door are the same door.
     Two other honest reads remain, and both are still used by the suites:
     `#sc-overlay[data-view2d]` (set in paintFooter below, from the same value
     the footer's wording is derived from, so a wrong attribute is a wrong
     footer) and a dynamic `import('/src/supplychain/render.js')` from the page,
     which resolves to this very module instance. */
  state: () => (S ? {
    tab: S.tab, view: S.viewKind, view2dReason: S.view2dReason, scenePending: !!S.scenePending,
    webgl: safe(() => webglOk(), null), focused: !!S.focused,
    selected: S.selected, flow: S.flow, filters: Array.from(S.filters),
    bridge: bridge.ready(), nodes: arr(S.data.graph.nodes).length,
  } : null),
};

export default API;
export { API };
