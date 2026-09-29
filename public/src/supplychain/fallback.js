/* ════════════════════════════════════════════════════════════════════════════
   SUPPLY CHAIN · fallback.js — the map without WebGL.

   mountFallback(host, graph, cb) draws the SAME graph the 3D scene draws, as
   DOM + SVG, and answers the SAME control surface:
     { select(id), home(), highlightFlow(resId), setFilter(f), project(id),
       renderNow(), dispose() }
   with the same callbacks: cb.onHover(id | null, {x, y}), cb.onPick(id | null).

   WHO SEES THIS. Three audiences, and all three matter:
     1. A player whose device has no WebGL (three.boot.js webglOk() is false).
        They still get the whole map: 4 systems, 2 counters, 27 tiles and every
        lane, not a "your browser is not supported" card.
     2. A screen-reader / keyboard player. The 3D canvas is a picture; this is
        the accessible tree for it. Every node is a real <button>, so Tab walks
        the map, Enter picks, focus hovers. There is no custom focus model to
        get wrong.
     3. The audit. Playwright can count 33 buttons and 114 paths in a few ms;
        it cannot read a framebuffer cheaply. The shell mounts this view when
        the scene returns null, and the audit drives it directly.

   WHY THE LAYOUT IS THE PDF'S, NOT A FORCE GRAPH. The owner drew the map:
   Transport top-centre on p6/p7/p8, the tiles in page clusters, the systems
   in a loop with a Marketplace at every hand-off (p1). A force layout would
   be "correct" and unrecognisable. Tiles are grouped by the PDF page they were
   drawn on (node.group = 'p6'..'p9'), in the order businesses.js keeps.

   WHY EVERY LANE IS DRAWN AS SPOKES THROUGH ONE HUB. graph.lanes are what
   shipping.js routed — pickup -> Transport -> depot -> deliver — so a lane is a
   path [from, transport, to]. Drawing each as two vertical-tangent curves that
   meet at the Transport card makes the owner's rule visible without a legend:
   nothing crosses the map without passing the truck. Shared spokes overlap and
   read darker where more freight moves. Rejected: straight from -> to lines
   with a "via Transport" label — they say the opposite of the rule.

   WHY TWO SVG LAYERS. The full lane set sits UNDER the cards (z 0), so at rest
   the map reads as a ledger with faint routing in the gutters. The lanes that
   matter right now (a selection, a resource flow) are cloned into a layer
   ABOVE the cards (pointer-events:none) so they are never hidden behind an
   opaque tile. One layer above everything would strike through the text of
   every card with 114 lines; one layer beneath would hide the answer to
   "where does cloth go".

   WHY THIS FILE STILL WRITES NO FACT. Labels, badges, makes, needs, lanes, the
   live / planned tag — all read off the graph node. The only text authored
   here is chrome ("Ships via Transport to", the legend chip names), and the
   legend chip names are the PDF legend's own keys. No economy number appears
   anywhere in this view; the modal shows those, live from the bridge.

   WHY THE BREAKPOINTS ARE THE ELEMENT'S WIDTH, NOT THE WINDOW'S. Round 2 wrote
   the two folds as `@media (max-width:…)`, which asks how wide the BROWSER is.
   This view's normal home is an overlay panel inside a wide window, so the
   window is 1600 while the map has 900 — and every media rule stayed asleep:
   measured, system cards 171px at host 1100, 121px at 900 (worse than the
   114px-at-1024 that failed round 1), 56px at 641, and at 520 the map
   overflowed its own `overflow-x:hidden`. So `layout()` — which already runs
   from the ResizeObserver on `root` — toggles `is-mid` / `is-phone` from
   `root.clientWidth`, and the two blocks below are plain class rules. Rejected:
   `container-type:inline-size` + `@container`. It is the tidier answer and it
   works in every browser this game supports, but it makes `.scf` a containment
   context, and the two absolutely-positioned SVG lane layers plus `project()`
   (which hands viewport pixels to the hover card) both depend on this box NOT
   being one. The class toggle costs one property write per resize and changes
   no geometry.

   Note for the seam piece: `SC.fallback` is `{columns, minTileWidth}` — there
   is no `phoneMax` / `midMax` row yet, so the two reads below fall through to
   the literals. `columns` is dead here (every grid is auto-fit). Asked in
   sc/decisions/fallback2d.md; tuning.js is not this piece's file.

   MID WIDTH (phoneMax < root.clientWidth <= midMax, default 1400px). The p1 loop
   is a 7-column row (system, gate, system, gate, system, gate, system); the
   second column holds the Marketplace / Car Marketplace tiles.
   Round 1 shipped only the row and the phone list, and between them the four
   system cards absorbed every pixel the gates did not: 26px wide at 641,
   114px at 1024 (a common laptop, and any overlay host narrower than the
   screen), the blurbs one word per line and the loop alone filling the first
   fold. So at mid width the loop folds 2x2: row one is system → gate → system,
   the second gate spans the full width as a horizontal hand-off, row three is
   the other two systems. A system card never drops below minTileWidth.

   PHONE WIDTH (root.clientWidth <= phoneMax, default 640px). The SVG lanes hide and the
   map becomes a grouped list: the loop row stacks, tiles go one per row. The
   lanes are not lost — every tile already lists "Ships via Transport to …" and
   "Fed by …" in text, which is the same information a screen reader gets.
   ════════════════════════════════════════════════════════════════════════════ */

import { SC } from './tuning.js';

const CARRIER = 'transport';
const HOP = 'ch:market';                   // the counter the p1 loop passes through at every hand-off
const SIDE = 'ch:carmarket';               // the second counter (p6-p9 legend); sits beside Just Business
const PHONE_MAX = (SC.fallback && SC.fallback.phoneMax) || 640;
/* 1400. Round 3 used 1300, derived from a 7-column row whose counter gate was
   pinned at 150px — and that pin was itself the defect (see .scf-loop below).
   With the gate a .82fr column the wide row is 4*1fr + .82fr + two 88px label
   gates + 60 gaps + 32 padding, so a system card is (W - 268) / 4.82 and holds
   the 220px floor from W >= 1329. Round 3's 1300 put the fold one pixel from
   that cliff: at a 1301px host the four system cards measured exactly 221
   against a 220 bar, so one font-metric change tipped the whole layout under
   with nothing to catch it. 1400 buys 20px of headroom (240px at W=1401) —
   cheap, because the 2x2 mid fold is the BETTER layout at those widths anyway;
   it only stops being better once there is room for the honest 7-column row. */
const MID_MAX = (SC.fallback && SC.fallback.midMax) || 1400;
const MIN_TILE = (SC.fallback && SC.fallback.minTileWidth) || 220;
const MAX_LIST = 4;                        // names shown on a card before "+n" — the modal holds the full list

/* View captions for the page clusters. Chrome, not fact: the fact is the page
   number, which comes from the node. */
const GROUP_TITLE = { p6: 'Page 6', p7: 'Page 7', p8: 'Page 8', p9: 'Page 9' };
const LEGEND_CHIPS = [
  { key: 'transport', text: 'Truck', title: 'Transport: Best to make money (needs the Transport company)' },
  { key: 'market', text: 'Market', title: 'Marketplace: Best to make money (sells on the Marketplace)' },
  { key: 'carMarket', text: 'Car market', title: 'Car Marketplace: Best to make money' },
  { key: 'card', text: 'Battlers', title: 'Good For Battlers and camp training' },
];

const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};
const svgEl = (tag) => document.createElementNS('http://www.w3.org/2000/svg', tag);
const safe = (fn, ...a) => { try { return fn && fn(...a); } catch (e) { /* a listener must not kill the map */ return undefined; } };
const arr = (v) => (Array.isArray(v) ? v : []);

/* ------------------------------------------------------------------ CSS -- */

/* ⚠ css() is ONE template literal, so a backtick inside a comment in it ends
   the string there and the rest becomes expressions: a comment reading
   .scf.is-mid in backticks turned into `.is` of undefined and the whole view
   failed to mount with one TypeError. modcheck.mjs passes on it (it parses
   fine) and the only symptom is "not mounted (non-fatal)". Cost two rounds of
   this file. Never put a backtick or a dollar-brace below unless it is code. */
function css() {
  const P = SC.palette || {};
  return `
.scf{--scf-bg:${P.bgDeep || '#0c0b0a'};--scf-panel:${P.bgPanel || '#17150f'};--scf-card:${P.bgCard || '#1c1813'};
 --scf-gold:${P.gold || '#d4af37'};--scf-gold-b:${P.goldBright || '#f5d76e'};--scf-ink:${P.ink || '#e8e0d0'};--scf-dim:${P.inkDim || '#a89888'};
 --scf-ember:${P.ember || '#e85d3c'};--scf-green:${P.emerald || '#3aa86b'};--scf-parch:${P.parchment || '#d9cbaa'};
 --scf-frame:rgba(198,160,74,.34);--scf-frame-soft:rgba(198,160,74,.16);
 position:relative;box-sizing:border-box;width:100%;max-width:100%;overflow-x:hidden;overflow-x:clip;padding:16px;
 background:var(--scf-bg);color:var(--scf-ink);font:16px/1.4 'Crimson Text','EB Garamond',Georgia,serif;color-scheme:dark}
.scf *{box-sizing:border-box;min-width:0}
.scf h2,.scf h3,.scf .scf-name{font-family:Cinzel,'Cinzel Decorative',Georgia,serif;text-transform:uppercase;letter-spacing:.06em;margin:0}
.scf h2{font-size:22px;color:var(--scf-gold-b)}
.scf h3{font-size:12px;letter-spacing:.12em;color:var(--scf-dim);padding:0 0 6px;border-bottom:1px solid var(--scf-frame-soft);margin:0 0 12px}
.scf-head{display:flex;flex-wrap:wrap;gap:10px 18px;align-items:baseline;margin:0 0 14px}
.scf-sub{margin:0;color:var(--scf-dim);font-style:italic;flex:1 1 260px}
.scf-legend{display:flex;flex-wrap:wrap;gap:6px;margin:0;padding:0;list-style:none}
.scf-chip{display:inline-block;font:600 10px/1 Cinzel,Georgia,serif;letter-spacing:.12em;text-transform:uppercase;color:var(--scf-dim);
 border:1px solid var(--scf-frame-soft);border-radius:3px;padding:4px 6px;background:var(--scf-panel)}
.scf-chip.is-on{color:var(--scf-gold-b);border-color:var(--scf-frame)}
.scf-chip.is-live{color:var(--scf-green);border-color:rgba(58,168,107,.45)}
.scf-chip.is-planned{color:var(--scf-parch);border-style:dashed}
.scf-chip.is-ember{color:var(--scf-ember);border-color:rgba(232,93,60,.45)}
/* Jump chips. The map is long by nature — at 390px the first business tile is
   two screens below the fold and the whole thing is ~8.6 screens — and without
   an in-page index that is a very long list, not a map. These are NOT filters
   (setFilter belongs to the shell and hides tiles); they only scroll, so the
   player never loses the rest of the map.

   🔴 THIS BAR ONLY STICKS BECAUSE .scf SAYS overflow-x:clip, NOT hidden.
   Round 3 shipped it as sticky and it was not: per CSS Overflow, a non-visible
   value on ONE axis forces the other axis to compute to auto, so
   overflow-x:hidden silently made .scf itself a scrollport. .scf has no
   height, so that scrollport can never scroll (its scrollTop stayed 0 while the
   real scroller moved) — and a sticky child resolves against its nearest
   scrollport, so the bar simply scrolled away with the content. Measured, on a
   phone that is one usable screen out of nine. clip is the one overflow value
   that does NOT force the other axis, so overflow-y stays visible, .scf
   stops being a scrollport, and the bar sticks to whatever really scrolls —
   the window, or the overlay panel the shell mounts this in. The hidden
   declaration above it is the fallback for a browser too old for clip
   (Safari <16): there the bar un-sticks again, but nothing spills sideways.
   The same bug also declared this box a NESTED scroll container, so any shell
   that gave the host a height got a double scroller. clip removes both. */
.scf-jumps{position:sticky;top:0;z-index:3;display:flex;flex-wrap:wrap;gap:6px;margin:0 0 12px;padding:6px 0;
 background:linear-gradient(180deg,var(--scf-bg) 70%,rgba(0,0,0,0))}
.scf-jump{font:600 10px/1 Cinzel,Georgia,serif;letter-spacing:.12em;text-transform:uppercase;color:var(--scf-dim);cursor:pointer;
 border:1px solid var(--scf-frame-soft);border-radius:3px;padding:5px 8px;background:var(--scf-panel)}
.scf-jump:hover{color:var(--scf-gold-b);border-color:var(--scf-frame)}
.scf-jump:focus{outline:none}.scf-jump:focus-visible{outline:2px solid var(--scf-gold-b);outline-offset:2px}
.scf-map{position:relative;isolation:isolate}
.scf-lanes,.scf-lanes-top{position:absolute;inset:0;width:100%;height:100%;overflow:visible;pointer-events:none}
.scf-lanes{z-index:0}.scf-lanes-top{z-index:2}
.scf-loop,.scf-hub,.scf-pages{position:relative;z-index:1}
/* the counter gate (child 2, the only gate holding tiles) is a FRACTION here
   too, not auto. auto sized it from the tile's old 150px cap at EVERY wide
   host, so at 1301/1440/1600 the Car Marketplace card stayed 150px while the
   system cards beside it were 221/256/296 and its heading broke over two
   lines — verbatim the defect that was fixed at phone and mid width in round 3
   and left standing at the width most desktop players actually see.

   .82fr, not .72 and not the mid fold's .62: measured, a counter card needs
   176px before the name CAR MARKETPLACE — the longest label in the view, and
   the one the round-3 critic caught wrapping — fits on one line beside its
   kind chip (the name box is the tile minus 26px of padding and chip gap).
   .72fr gave 173px at a 1401 host, three pixels short, which is exactly the
   kind of miss that reads as "it works" in a screenshot at 1600. .82fr gives
   192 there and still leaves a system card 235px, above the 220 floor. */
.scf-loop{display:grid;grid-template-columns:minmax(0,1fr) minmax(120px,.82fr) minmax(0,1fr) auto minmax(0,1fr) auto minmax(0,1fr);gap:10px;align-items:stretch}
.scf-gate{display:flex;flex-direction:column;justify-content:center;align-items:center;gap:6px;color:var(--scf-dim);font-size:12px;text-align:center;min-width:64px}
.scf-gate .scf-arrow{font-family:Cinzel,Georgia,serif;letter-spacing:.12em;font-size:10px;text-transform:uppercase}
/* no max-width at ANY width: a cap here is what half-carded the two counters
   the PDF legend leads with. The column sizes the tile now, at all three folds */
.scf-gate .scf-tile{width:100%;min-width:0;max-width:none}
.scf-return{margin:6px 0 0;color:var(--scf-dim);font-size:13px;font-style:italic;border-top:1px dashed var(--scf-frame-soft);padding-top:6px}
.scf-hub{display:flex;justify-content:center;margin:22px 0}
.scf-hub .scf-tile{width:min(100%,420px)}
.scf-pages{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,${MIN_TILE + 40}px),1fr));gap:22px 18px;margin-top:6px}
/* the page frame is a line, not a fill: a filled panel sat over the lane
   layer and hid every spoke below the hub */
/* scroll-margin so a jump lands the heading BELOW the sticky chip row instead
   of behind it — measured, the p8 heading arrived at y=0 under the bar */
.scf-page,.scf-loop,.scf-hub{scroll-margin-top:52px}
.scf-page{padding:12px;background:transparent;border:1px solid var(--scf-frame-soft);border-radius:4px}
/* the page frame stays transparent so the rest-layer spokes read THROUGH the
   cluster — but a 1px gold line crossing a 12px letterspaced heading reads as
   a strikethrough on the words PAGE 6 · 7 BUSINESSES, not as a lane. Painting
   just the heading strip opaque costs four lane pixels and removes the
   misread. Deliberately NOT applied to .scf-lanes-top: a LIT strand should
   still cross everything, because that is the one the player asked to follow. */
.scf-page>h3{background:var(--scf-bg);padding:2px 4px 6px}
.scf-tiles{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,${MIN_TILE}px),1fr));gap:14px}
.scf-tile{position:relative;display:block;width:100%;text-align:left;cursor:pointer;color:var(--scf-ink);font:inherit;
 background:var(--scf-card);border:1px solid var(--scf-frame);border-radius:3px;padding:10px 12px 11px;
 background-image:repeating-linear-gradient(135deg,rgba(255,255,255,.012) 0 2px,transparent 2px 7px);
 box-shadow:inset 0 0 0 1px rgba(0,0,0,.35),inset 0 1px 0 rgba(255,255,255,.03);transition:opacity .15s,border-color .15s}
.scf-tile::before,.scf-tile::after{content:"";position:absolute;width:7px;height:7px;border-color:var(--scf-gold);border-style:solid;opacity:.55}
.scf-tile::before{top:3px;left:3px;border-width:1px 0 0 1px}.scf-tile::after{bottom:3px;right:3px;border-width:0 1px 1px 0}
.scf-tile:hover{border-color:var(--scf-gold)}
.scf-tile:focus{outline:none}.scf-tile:focus-visible{outline:2px solid var(--scf-gold-b);outline-offset:2px}
.scf-tile.is-planned{border-style:dashed}
.scf-tile.is-selected{border-color:var(--scf-gold-b);box-shadow:inset 0 0 0 1px var(--scf-gold-b),0 0 0 1px rgba(245,215,110,.25)}
.scf-tile.is-hub{background:linear-gradient(180deg,#241f16,var(--scf-card));border-color:var(--scf-gold)}
.scf-tile.is-system{background:var(--scf-panel)}
.scf-tile.is-off{opacity:.16;pointer-events:none}
.scf.has-focus .scf-tile:not(.is-lit):not(.is-off){opacity:.32}
.scf-row{display:flex;flex-wrap:wrap;gap:6px 8px;align-items:center}
.scf-name{font-size:14px;color:var(--scf-gold-b);flex:1 1 auto}
.scf-kind{font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:var(--scf-dim);font-family:Cinzel,Georgia,serif}
.scf-badges{margin:6px 0 0}
.scf-line{margin:6px 0 0;font-size:14px;color:var(--scf-ink)}
.scf-line b{font-weight:600;color:var(--scf-dim);font-style:italic}
.scf-note{margin:6px 0 0;font-size:13px;color:var(--scf-parch);font-style:italic}
.scf-line.scf-svc{color:var(--scf-parch);font-style:italic}
.scf-lane{fill:none;stroke:var(--scf-gold);stroke-width:1;opacity:.22;stroke-linecap:round}
.scf-lane.is-live{opacity:.4}
.scf-lane.is-planned{stroke-dasharray:5 4}
.scf-lane.is-enforced{stroke-width:1.6;opacity:.6}
.scf.has-focus .scf-lanes .scf-lane{opacity:.05}
.scf-lanes-top .scf-lane{stroke:var(--scf-gold-b);stroke-width:2;opacity:.95}
.scf-lanes-top .scf-lane.is-planned{stroke:var(--scf-parch)}
.scf-hubdot{fill:var(--scf-gold);opacity:.7}
.scf-live{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
.scf-empty{color:var(--scf-ember);font-style:italic}
@media (prefers-reduced-motion:reduce){.scf-tile{transition:none}}
/* the loop folds 2x2: children 1-3 make row one, the middle gate (child 4)
   becomes a full-width horizontal hand-off, children 5-7 make row three.
   a class rule, NOT a media query — see the header: this view lives in an
   overlay host that is routinely narrower than the window. */
/* the gate column is a FRACTION, not auto, at mid width: with auto it was
   the tile's 140px cap at every host, so at 900 the two counters — the cards
   the PDF legend leads with — wrapped CAR / MARKETPLACE over two lines and
   broke "Counter for 22 businesses" mid-phrase while the system cards had
   354px each. .62fr keeps a system card above minTileWidth at the narrow end
   (measured: 225px at a 641px host) and lets the counters breathe above it.

   KNOWN AND DELIBERATE at the narrow end of this fold: at a 641-780px host the
   counter card is 139-168px and CAR MARKETPLACE wraps to two lines. It cannot
   be widened here — the row is four system cards plus this gate, and any
   fraction large enough to fit the name on one line pushes a system card under
   the 220px floor (.72fr gives 216 at 641). Two even lines on the longest
   label in the view is the better half of that trade; a 216px system card with
   a one-word-per-line blurb is the failure this whole fold exists to prevent.
   It clears itself at 800px and above. */
.scf.is-mid .scf-loop{grid-template-columns:minmax(0,1fr) minmax(120px,.62fr) minmax(0,1fr);gap:14px 10px}
.scf.is-mid .scf-gate:nth-child(4){grid-column:1/-1;flex-direction:row;justify-content:center;gap:12px;padding:2px 0}
.scf.is-mid .scf-gate:nth-child(4) .scf-arrow::before{content:"↓ "}
.scf.is-mid .scf-gate:nth-child(4) .scf-arrow::after{content:" ↓"}
.scf.is-phone{padding:12px}
.scf.is-phone .scf-lanes,.scf.is-phone .scf-lanes-top{display:none}
.scf.is-phone .scf-loop{grid-template-columns:minmax(0,1fr)}
.scf.is-phone .scf-gate{flex-direction:column;align-items:stretch}
.scf.is-phone .scf-gate .scf-arrow{text-align:center}
.scf.is-phone .scf-pages{grid-template-columns:minmax(0,1fr)}
.scf.is-phone .scf-tiles{grid-template-columns:minmax(0,1fr)}`;
}

/* ---------------------------------------------------------------- mount -- */

export function mountFallback(host, graph, cb) {
  if (!host || typeof host.appendChild !== 'function' || !graph || !Array.isArray(graph.nodes)) return null;
  const on = (cb && typeof cb === 'object') ? cb : {};
  const nodes = graph.nodes.slice().sort((a, b) => (a.order || 0) - (b.order || 0));
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const labelOf = (id) => { const n = byId.get(id); return n ? n.label : id; };

  /* Resource names come from the graph (catalogue rows are behind it), never
     retyped here. resourceFlow walks the edges, so cache per id. */
  const nameCache = new Map();
  const nameOf = (id) => {
    if (nameCache.has(id)) return nameCache.get(id);
    let name = id;
    try { const f = typeof graph.resourceFlow === 'function' ? graph.resourceFlow(id) : null; if (f && f.known && f.name) name = f.name; } catch (e) { /* keep the id */ }
    nameCache.set(id, name);
    return name;
  };
  const neighboursOf = (id) => { try { return typeof graph.neighbours === 'function' ? graph.neighbours(id) : null; } catch (e) { return null; } };

  const root = el('div', 'scf');
  root.setAttribute('role', 'region');
  root.setAttribute('aria-label', 'Supply chain map, 2D view');
  const style = el('style'); style.setAttribute('data-scf', '1'); style.textContent = css();
  root.appendChild(style);

  /* header + legend */
  const head = el('header', 'scf-head');
  head.appendChild(el('h2', null, 'Supply & Demand'));
  head.appendChild(el('p', 'scf-sub', 'Every lane between two businesses is drawn through Transport. Dashed = planned on the owner’s map, not in the game yet.'));
  const legend = el('ul', 'scf-legend'); legend.setAttribute('aria-label', 'PDF legend');
  for (const c of LEGEND_CHIPS) { const li = el('li', 'scf-chip', c.text); li.title = c.title; legend.appendChild(li); }
  head.appendChild(legend);
  root.appendChild(head);

  const map = el('div', 'scf-map');
  const lanesUnder = svgEl('svg'); lanesUnder.setAttribute('class', 'scf-lanes'); lanesUnder.setAttribute('aria-hidden', 'true');
  const lanesTop = svgEl('svg'); lanesTop.setAttribute('class', 'scf-lanes-top'); lanesTop.setAttribute('aria-hidden', 'true');
  map.appendChild(lanesUnder);

  const tiles = new Map();                 // node id -> <button>
  const cleanup = [];

  /* ---- one tile ---- */
  function tile(n) {
    const b = el('button', 'scf-tile');
    b.type = 'button';
    b.dataset.node = n.id;
    b.dataset.scNode = n.id;             // alias: the audit and the shell count [data-sc-node]; the scene's hit-test names use data-node
    b.dataset.type = n.type;
    b.dataset.status = n.status;
    if (n.status === 'planned') b.classList.add('is-planned');
    if (n.id === CARRIER) b.classList.add('is-hub');
    if (n.type === 'system') b.classList.add('is-system');

    const row = el('div', 'scf-row');
    row.appendChild(el('span', 'scf-name', n.label));
    const kind = n.type === 'business' ? (n.id === CARRIER ? 'carrier hub' : n.kind) : n.type;
    row.appendChild(el('span', 'scf-kind', kind));
    const st = el('span', 'scf-chip ' + (n.status === 'planned' ? 'is-planned' : 'is-live'), n.status === 'planned' ? 'Planned' : 'Live');
    st.title = n.status === 'planned' ? 'On the owner’s map; the game has no such business yet' : 'In the shipped game today';
    row.appendChild(st);
    b.appendChild(row);
    /* Accessible name = name, kind, live/planned (three words), not the whole
       card: without this a screen reader read 264 characters for Medical
       Corporation on every Tab stop. The detail lines stay reachable as the
       description. */
    b.setAttribute('aria-label', n.label + ', ' + kind + ', ' + (n.status === 'planned' ? 'planned' : 'live'));
    const detail = el('div', 'scf-detail');
    detail.id = 'scf-d-' + String(n.id).replace(/[^a-z0-9]+/gi, '-');
    b.setAttribute('aria-describedby', detail.id);
    b.appendChild(detail);
    const add = (child) => detail.appendChild(child);

    const badges = arr(LEGEND_CHIPS).filter((c) => n.badges && n.badges[c.key] === true);
    if (badges.length) {
      const br = el('div', 'scf-row scf-badges'); br.setAttribute('aria-label', 'PDF icons beside this tile');
      for (const c of badges) { const s = el('span', 'scf-chip is-on', c.text); s.title = c.title; br.appendChild(s); }
      add(br);
    }

    const list = (ids, f) => { const a = ids.map(f); return a.length > MAX_LIST ? a.slice(0, MAX_LIST).join(', ') + ' +' + (a.length - MAX_LIST) : a.join(', '); };
    const line = (k, v, cls) => { const p = el('p', 'scf-line' + (cls ? ' ' + cls : '')); const bb = el('b', null, k + ' '); p.appendChild(bb); p.appendChild(document.createTextNode(v)); return p; };

    if (n.type === 'system') {
      if (n.blurb) add(el('p', 'scf-note', n.blurb));
      const made = arr(n.produces && n.produces.made), drops = arr(n.produces && n.produces.drops);
      if (made.length) add(line('Makes', made.length + ' resources, e.g. ' + list(made.slice(0, MAX_LIST), (m) => nameOf(typeof m === 'string' ? m : m.id))));
      if (drops.length) add(line('Drops', drops.length + ' resources for the businesses'));
      if (n.bestBuyers) add(line('Best buyers', n.bestBuyers));
    } else if (n.type === 'channel') {
      if (n.blurb) add(el('p', 'scf-note', n.blurb));
      const nb = neighboursOf(n.id);
      const sellers = nb ? nb.channels.filter((r) => r.dir === 'in').length : 0;
      if (sellers) add(line('Counter for', sellers + ' businesses'));
    } else {
      const makes = arr(n.makes);
      if (makes.length) add(line('Makes', list(makes, (m) => nameOf(m.id))));
      else if (n.service) add(line('Service', n.service, 'scf-svc'));
      else add(line('Makes', 'nothing yet', 'scf-empty'));
      const nb = neighboursOf(n.id);
      if (n.id === CARRIER) {
        add(line('Carries for', arr(nb && nb.hauls).length + ' tiles — every lane on this map passes here'));
      } else if (nb) {
        const outAll = nb.customers.map((r) => r.node), inn = nb.suppliers.map((r) => r.node);
        /* the carrier is also a customer (Car Dealer sells it trucks, Gas Station
           fuel); "Ships via Transport to Transport" is true and reads as a typo */
        const out = outAll.filter((x) => x !== CARRIER), toCarrier = outAll.length !== out.length;
        /* a tile with no business lane is not broken: a Dojo sells to battlers, a
           Warehouse to the counter. Say where it sells instead of 'none'. */
        const sells = arr(n.sellsTo).filter((x) => x !== CARRIER);
        if (out.length) add(line('Ships via Transport to', list(out, labelOf)));
        else if (!toCarrier && sells.length) add(line('Sells to', list(sells, labelOf)));
        else if (!toCarrier) add(line('Ships via Transport to', 'no lane on the map', 'scf-empty'));
        if (toCarrier) add(line('Sells to', labelOf(CARRIER) + ' itself (the carrier is a customer too)'));
        if (inn.length) add(line('Fed by', list(inn, labelOf)));
        const ln = arr(n.lootNeeds).length;
        if (ln) add(line('Battle loot it needs', ln + ' resources' + (n.needsSummary && n.needsSummary.lootLive != null ? ' (' + n.needsSummary.lootLive + ' live)' : '')));
      }
      if (n.plannedNote) add(el('p', 'scf-note', n.plannedNote));
    }
    tiles.set(n.id, b);
    return b;
  }

  /* ---- the four-system loop with the counters at the hand-offs (PDF p1) ---- */
  const systems = nodes.filter((n) => n.type === 'system');
  const loop = el('section', 'scf-loop'); loop.setAttribute('aria-label', 'The four systems and the Marketplace between them');
  systems.forEach((s, i) => {
    const cell = el('div', 'scf-sys'); cell.appendChild(tile(s)); loop.appendChild(cell);
    if (i < systems.length - 1) {
      const gate = el('div', 'scf-gate');
      gate.appendChild(el('span', 'scf-arrow', '→ via →'));
      if (i === 0) {
        /* The graph holds ONE Marketplace node and one Car Marketplace, drawn
           once each; the later gates say "Marketplace" in text so the loop
           still reads as the PDF's four hand-offs. */
        const m = byId.get(HOP); if (m) gate.appendChild(tile(m));
        const c = byId.get(SIDE); if (c) gate.appendChild(tile(c));
      } else {
        gate.appendChild(el('span', 'scf-arrow', labelOf(HOP)));
      }
      loop.appendChild(gate);
    }
  });
  map.appendChild(loop);
  const loopBack = nodes.length ? el('p', 'scf-return', labelOf('sys:camp') + ' → ' + labelOf('sys:battle') + ': the loop closes here (implied by the PDF text, not drawn as an arrow).') : null;
  if (loopBack) map.appendChild(loopBack);

  /* ---- Transport hub, top-centre as on p6/p7/p8 ---- */
  const hubNode = byId.get(CARRIER);
  const hub = el('section', 'scf-hub'); hub.setAttribute('aria-label', 'Transport, the carrier every lane passes through');
  if (hubNode) hub.appendChild(tile(hubNode));
  map.appendChild(hub);

  /* ---- tiles by PDF page cluster ---- */
  const pages = el('section', 'scf-pages'); pages.setAttribute('aria-label', 'Businesses by PDF page');
  const groups = new Map();
  for (const n of nodes) {
    if (n.type !== 'business' || n.id === CARRIER) continue;
    if (!groups.has(n.group)) groups.set(n.group, []);
    groups.get(n.group).push(n);
  }
  for (const [g, list] of groups) {
    const sec = el('div', 'scf-page'); sec.dataset.group = g;
    const h = el('h3', null, (GROUP_TITLE[g] || g) + ' · ' + list.length + ' businesses');
    sec.appendChild(h);
    const grid = el('div', 'scf-tiles');
    for (const n of list) grid.appendChild(tile(n));
    sec.appendChild(grid);
    pages.appendChild(sec);
  }
  map.appendChild(pages);
  /* any node the layout above did not place (a future type) still gets a tile,
     so "33 buttons" can never silently become 32 */
  const orphans = nodes.filter((n) => !tiles.has(n.id));
  if (orphans.length) {
    const sec = el('div', 'scf-page'); sec.appendChild(el('h3', null, 'Other'));
    const grid = el('div', 'scf-tiles'); for (const n of orphans) grid.appendChild(tile(n)); sec.appendChild(grid); pages.appendChild(sec);
  }
  /* ---- jump chips: an index over the clusters the map is already built from */
  {
    const jumps = el('nav', 'scf-jumps'); jumps.setAttribute('aria-label', 'Jump to a part of the map');
    const chip = (text, target, title) => {
      if (!target) return;
      const b = el('button', 'scf-jump', text); b.type = 'button'; b.title = title || text;
      b.addEventListener('click', () => { try { target.scrollIntoView({ block: 'start' }); } catch (e) { /* jsdom */ } });
      jumps.appendChild(b);
    };
    chip('Systems', loop, 'The four systems and the counters between them');
    chip('Transport', hub, 'The carrier every lane passes through');
    for (const [g] of groups) {
      const sec = pages.querySelector('[data-group="' + g + '"]');
      chip(GROUP_TITLE[g] || g, sec, 'The businesses drawn on ' + (GROUP_TITLE[g] || g) + ' of the map');
    }
    map.insertBefore(jumps, loop);
  }

  map.appendChild(lanesTop);
  root.appendChild(map);
  const live = el('p', 'scf-live'); live.setAttribute('aria-live', 'polite'); root.appendChild(live);
  host.appendChild(root);

  /* ---------------------------------------------------------- lanes (SVG) */

  const laneEls = [];                      // {path, lane, nodes:[...]} in graph order
  const lanes = arr(graph.lanes);
  const hubDot = svgEl('circle'); hubDot.setAttribute('class', 'scf-hubdot'); hubDot.setAttribute('r', '4');
  for (const lane of lanes) {
    const p = svgEl('path');
    p.setAttribute('class', 'scf-lane');
    p.dataset.lane = lane.id; p.dataset.edge = lane.edge; p.dataset.from = lane.from; p.dataset.to = lane.to;
    const edge = typeof graph.edge === 'function' ? graph.edge(lane.edge) : null;
    const planned = [lane.from, lane.to].some((id) => { const n = byId.get(id); return n && n.status === 'planned'; });
    if (edge && edge.live) p.classList.add('is-live');
    if (planned) p.classList.add('is-planned');
    if (lane.enforcedToday) p.classList.add('is-enforced');
    const path = arr(lane.path).length ? lane.path : [lane.from, lane.to];
    p.dataset.nodes = path.join(',');
    lanesUnder.appendChild(p);
    laneEls.push({ path: p, lane, nodes: path });
  }
  lanesUnder.appendChild(hubDot);

  const anchor = (a, b) => {
    /* the pair of points a curve between tile a and tile b leaves from and
       arrives at: top edge of the lower card, bottom edge of the upper one.
       The x is a SLOT, not the card centre: every card spreads its spokes
       across its edge, one slot per partner, ordered by where the partner
       sits (see slots()). Round 1 sent every spoke to the centre of every
       card and the rest layer read as a knot converging on Transport — 114
       strands, none traceable. With slots, the hub's bottom edge is a fan of
       27 landings and a lit strand can be followed by eye. */
    const below = a.cy > b.cy;
    const ax = a.slot.get(b.id) ?? a.cx, bx = b.slot.get(a.id) ?? b.cx;
    return [{ x: ax, y: below ? a.top : a.bottom }, { x: bx, y: below ? b.bottom : b.top }];
  };
  const curve = (p, q) => { const my = (p.y + q.y) / 2; return 'M' + p.x.toFixed(1) + ' ' + p.y.toFixed(1) + ' C' + p.x.toFixed(1) + ' ' + my.toFixed(1) + ',' + q.x.toFixed(1) + ' ' + my.toFixed(1) + ',' + q.x.toFixed(1) + ' ' + q.y.toFixed(1); };

  /* one x per (card, partner): the card's partners sorted left-to-right then
     top-to-bottom, spread evenly across the card's edge inside a 14px inset.
     Pure geometry off the boxes — no node knowledge, so a new tile type fans
     the same way. */
  function slots(box) {
    const partners = new Map();
    const add = (a, b) => { if (!partners.has(a)) partners.set(a, new Set()); partners.get(a).add(b); };
    for (const L of laneEls) for (let i = 0; i + 1 < L.nodes.length; i++) { add(L.nodes[i], L.nodes[i + 1]); add(L.nodes[i + 1], L.nodes[i]); }
    const pad = 14;
    for (const [id, set] of partners) {
      const o = box.get(id); if (!o) continue;
      const list = [...set].filter((p) => box.has(p)).sort((p, q) => (box.get(p).cx - box.get(q).cx) || (box.get(p).cy - box.get(q).cy));
      const w = Math.max(0, o.width - 2 * pad), n = list.length;
      list.forEach((p, k) => o.slot.set(p, n === 1 ? o.cx : o.left + pad + (w * (k + 0.5)) / n));
    }
  }

  function layout() {
    if (!root.isConnected) return;
    /* the two folds, driven by THIS box. clientWidth excludes a scrollbar, so
       a host that gains one folds at the width the player actually sees.
       Written before anything is measured: toggling a class reflows
       synchronously, so every rect read below is already post-fold. The
       ResizeObserver that calls this observes `root`, and the classes change
       no outer size, so this cannot loop. */
    const w = root.clientWidth || 0;
    if (w > 0) {
      root.classList.toggle('is-phone', w <= PHONE_MAX);
      root.classList.toggle('is-mid', w > PHONE_MAX && w <= MID_MAX);
    }
    const m = map.getBoundingClientRect();
    const box = new Map();
    for (const [id, b] of tiles) {
      const r = b.getBoundingClientRect();
      box.set(id, { id, cx: r.left - m.left + r.width / 2, cy: r.top - m.top + r.height / 2, top: r.top - m.top, bottom: r.bottom - m.top, left: r.left - m.left, width: r.width, slot: new Map() });
    }
    slots(box);
    for (const L of laneEls) {
      let d = '';
      for (let i = 0; i + 1 < L.nodes.length; i++) {
        const a = box.get(L.nodes[i]), b = box.get(L.nodes[i + 1]);
        if (!a || !b) continue;
        const [p, q] = anchor(a, b);
        d += (d ? ' ' : '') + curve(p, q);
      }
      L.path.setAttribute('d', d);
    }
    const h = box.get(CARRIER);
    if (h) { hubDot.setAttribute('cx', h.cx.toFixed(1)); hubDot.setAttribute('cy', h.top.toFixed(1)); }
    syncTop();
  }

  /* copy the lit lanes into the layer above the cards */
  function syncTop() {
    while (lanesTop.firstChild) lanesTop.removeChild(lanesTop.firstChild);
    for (const L of laneEls) if (L.path.classList.contains('is-lit')) lanesTop.appendChild(L.path.cloneNode(false));
  }

  /* ------------------------------------------------------------- state -- */

  const state = { selected: null, flow: null, filter: null };

  function setLit(nodeSet, edgeSet, laneTest) {
    const focused = !!(nodeSet || edgeSet);
    root.classList.toggle('has-focus', focused);
    for (const [id, b] of tiles) b.classList.toggle('is-lit', focused && !!nodeSet && nodeSet.has(id));
    for (const L of laneEls) {
      const lit = focused && ((edgeSet && edgeSet.has(L.lane.edge)) || (laneTest && laneTest(L.lane)));
      L.path.classList.toggle('is-lit', !!lit);
    }
    syncTop();
  }

  function applyState() {
    for (const [, b] of tiles) b.classList.remove('is-selected');
    if (state.flow) {
      const ns = new Set(arr(state.flow.nodes)); ns.add(CARRIER);
      setLit(ns, new Set(arr(state.flow.edges)), null);
      live.textContent = (state.flow.name || state.flow.id) + ': ' + (state.flow.summary || 'no route');
    } else if (state.selected && tiles.has(state.selected)) {
      const id = state.selected;
      tiles.get(id).classList.add('is-selected');
      const nb = neighboursOf(id);
      const ns = new Set(nb ? nb.all : []); ns.add(id);
      if (nb && nb.carrier) ns.add(nb.carrier.node);
      setLit(ns, null, (l) => l.from === id || l.to === id || id === CARRIER);
      live.textContent = 'Selected ' + labelOf(id) + (nb ? ': ' + nb.suppliers.length + ' suppliers, ' + nb.customers.length + ' customers, all via Transport' : '');
    } else {
      setLit(null, null, null);
      live.textContent = '';
    }
  }

  const matcher = (f) => {
    if (f == null || f === '' || f === 'all') return null;
    if (typeof f === 'function') return f;
    if (typeof f === 'string') {
      const s = f.trim(), l = s.toLowerCase();
      if (l === 'live' || l === 'planned') return (n) => n.status === l;
      if (/^p[6-9]$/.test(l) || l === 'systems' || l === 'channels') return (n) => n.group === l;
      if (l === 'business' || l === 'system' || l === 'channel') return (n) => n.type === l;
      if (['hub', 'producer', 'service', 'citytransit'].includes(l)) return (n) => String(n.kind).toLowerCase() === l;
      if (byId.has(s) && s.startsWith('sys:')) return (n) => n.system === s || n.id === s;
      return (n) => [n.id, n.label, n.pdfLabel].some((t) => String(t || '').toLowerCase().includes(l));
    }
    if (typeof f === 'object') {
      const ids = Array.isArray(f.ids) ? new Set(f.ids) : null;
      const text = f.text ? String(f.text).toLowerCase() : null;
      return (n) => (!ids || ids.has(n.id)) && (!f.status || n.status === f.status) && (!f.group || n.group === f.group)
        && (!f.type || n.type === f.type) && (!f.kind || n.kind === f.kind) && (!f.system || n.system === f.system || n.id === f.system)
        && (!text || [n.id, n.label, n.pdfLabel].some((t) => String(t || '').toLowerCase().includes(text)));
    }
    return null;
  };

  function applyFilter() {
    const test = matcher(state.filter);
    for (const [id, b] of tiles) {
      const n = byId.get(id);
      /* the hub and the loop always stay: a filter narrows the tiles, it does
         not remove the rule they hang from */
      const keep = !test || n.type !== 'business' || id === CARRIER || !!safe(test, n);
      b.classList.toggle('is-off', !keep);
      b.tabIndex = keep ? 0 : -1;
      if (keep) b.removeAttribute('aria-disabled'); else b.setAttribute('aria-disabled', 'true');
    }
  }

  /* ------------------------------------------------------------ events -- */

  const idOf = (t) => { const b = t && t.closest ? t.closest('.scf-tile') : null; return b && !b.classList.contains('is-off') ? b.dataset.node : null; };
  const centre = (b) => { const r = b.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; };
  let hovering = null;
  const hover = (id, xy) => { if (id === hovering && id !== null) return; hovering = id; safe(on.onHover, id, xy || null); };

  const onOver = (e) => { const id = idOf(e.target); if (id) hover(id, { x: e.clientX, y: e.clientY }); };
  const onMove = (e) => { const id = idOf(e.target); if (id && id === hovering) safe(on.onHover, id, { x: e.clientX, y: e.clientY }); };
  const onOut = (e) => { const id = idOf(e.target); if (id && !idOf(e.relatedTarget)) hover(null); };
  const onFocus = (e) => { const id = idOf(e.target); if (id) hover(id, centre(tiles.get(id))); };
  const onBlur = (e) => { const id = idOf(e.target); if (id && !idOf(e.relatedTarget)) hover(null); };
  const onClick = (e) => {
    const id = idOf(e.target);
    if (id) { safe(on.onPick, id); return; }
    /* a jump chip is navigation, not the ground: scrolling to Page 8 must not
       throw away the selection the player scrolled away from */
    if (e.target && e.target.closest && e.target.closest('.scf-jump')) return;
    /* a click on the map's ground clears, as it does on the 3D ground */
    if (map.contains(e.target)) safe(on.onPick, null);
  };
  const onKey = (e) => {
    if (e.key === 'Escape') { safe(on.onPick, null); return; }
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft' && e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    const id = idOf(e.target); if (!id) return;
    /* DOM order, not graph order: the arrows must walk the same path Tab does,
       or Right from Battle would skip the Marketplace gate that sits beside it */
    const order = Array.from(root.querySelectorAll('.scf-tile')).filter((b) => !b.classList.contains('is-off')).map((b) => b.dataset.node);
    const i = order.indexOf(id); if (i < 0) return;
    const j = (e.key === 'ArrowRight' || e.key === 'ArrowDown') ? (i + 1) % order.length : (i - 1 + order.length) % order.length;
    e.preventDefault();
    tiles.get(order[j]).focus();
  };
  root.addEventListener('pointerover', onOver);
  root.addEventListener('pointermove', onMove);
  root.addEventListener('pointerout', onOut);
  root.addEventListener('focusin', onFocus);
  root.addEventListener('focusout', onBlur);
  root.addEventListener('click', onClick);
  root.addEventListener('keydown', onKey);
  cleanup.push(() => {
    root.removeEventListener('pointerover', onOver); root.removeEventListener('pointermove', onMove); root.removeEventListener('pointerout', onOut);
    root.removeEventListener('focusin', onFocus); root.removeEventListener('focusout', onBlur);
    root.removeEventListener('click', onClick); root.removeEventListener('keydown', onKey);
  });

  /* relayout on resize. setTimeout, not requestAnimationFrame: the desktop
     Browser pane runs RAF at ~0.5 Hz (CLAUDE.md), and a lane that redraws two
     seconds after the window moved looks broken. Fonts arriving late also
     move the cards, so a font-load event triggers one more pass. */
  let timer = 0;
  const later = () => { clearTimeout(timer); timer = setTimeout(layout, 16); };
  window.addEventListener('resize', later);
  cleanup.push(() => window.removeEventListener('resize', later));
  if (typeof ResizeObserver === 'function') {
    const ro = new ResizeObserver(later); ro.observe(root);
    cleanup.push(() => ro.disconnect());
  }
  try { if (document.fonts && document.fonts.ready) document.fonts.ready.then(later); } catch (e) { /* no FontFaceSet */ }

  layout();

  /* -------------------------------------------------------------- api -- */

  let disposed = false;
  const api = {
    select(id) {
      /* a tile the filter hid cannot be selected: it sits at opacity .16 with
         no pointer events, and lighting it would select what the player
         cannot see. null tells the caller to clear its filter first (the
         harness / shell path is search → setFilter → select). */
      if (id && tiles.has(id) && tiles.get(id).classList.contains('is-off')) return null;
      state.selected = id && tiles.has(id) ? id : null;
      state.flow = null;
      applyState();
      if (state.selected) { try { tiles.get(state.selected).scrollIntoView({ block: 'nearest', inline: 'nearest' }); } catch (e) { /* jsdom */ } }
      return state.selected;
    },
    home() {
      state.selected = null; state.flow = null;
      applyState();
      try { root.scrollIntoView({ block: 'start' }); } catch (e) { /* not scrollable */ }
    },
    highlightFlow(resId) {
      if (!resId) { state.flow = null; applyState(); return null; }
      let f = null;
      try { f = typeof graph.resourceFlow === 'function' ? graph.resourceFlow(resId) : null; } catch (e) { f = null; }
      state.flow = f && f.known ? f : { id: resId, known: false, nodes: [], edges: [], summary: 'unknown resource' };
      applyState();
      return state.flow;
    },
    setFilter(f) { state.filter = f == null ? null : f; applyFilter(); },
    /* screen position of a node, for the hover card: centre + box in
       viewport pixels, like the scene's projected point */
    project(id) {
      const b = tiles.get(id); if (!b || !root.isConnected) return null;
      const r = b.getBoundingClientRect();
      const vw = window.innerWidth || 0, vh = window.innerHeight || 0;
      return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height, top: r.top, left: r.left,
        visible: r.bottom > 0 && r.right > 0 && r.top < vh && r.left < vw && !b.classList.contains('is-off') };
    },
    renderNow() { layout(); },
    relayout() { layout(); },
    dispose() {
      if (disposed) return; disposed = true;
      clearTimeout(timer);
      for (const c of cleanup.splice(0)) safe(c);
      if (root.parentNode) root.parentNode.removeChild(root);
      tiles.clear(); laneEls.length = 0;
    },
    get state() { return { selected: state.selected, flow: state.flow ? state.flow.id : null, filter: state.filter }; },
    counts: { nodes: tiles.size, lanes: laneEls.length },
    root,
  };
  return api;
}

export default mountFallback;
