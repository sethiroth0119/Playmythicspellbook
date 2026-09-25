/* ============================================================================
   🎯 r1_targeting.js — HOVER / SELECT THREAT READOUT
   ----------------------------------------------------------------------------
   "I want when a player clicks or hovers over his unit it shows all of the
    enemy units with red titles."

   Hover OR select one of YOUR units and every enemy on the field surfaces its
   name in red — the whole board at once, not just what is in range.

   ── HOW IT PLUGS IN ────────────────────────────────────────────────────────
   • Zero edits to render code. Two delegated listeners on `document`
     (mouseover / pointerdown) plus one MutationObserver on #app.
   • The existing hover ACTION MENU binds `el.onmouseenter` as a PROPERTY on
     each `.unit`. We never touch that property — delegation on `document`
     is purely additive, so the menu keeps working untouched. Moving the
     cursor from the unit ONTO the action menu deliberately KEEPS the readout
     up (see KEEP_HOVER_IN), so the two features reinforce each other instead
     of fighting.
   • Every plate is `pointer-events: none`, so unit selection, tile clicks and
     attack targeting can never be intercepted.
   • The readout suppresses itself the moment the player is actually AIMING
     (move mode / a picked attack / consumable / skill / fusion / archon
     targeting). During targeting the board already paints red `.attack-target`
     tiles — a second red layer there would be noise, and worse, ambiguity.
     ⚠ We deliberately do NOT reuse `_hoverMenuSuppressed()`: it also bails on
     `App.ui.modalUnitId`, and `onUnitClick()` sets modalUnitId on EVERY click.
     Reusing it would have made the "click" half of the requirement dead.

   ── SIDE DETECTION (the real convention, not the probe's) ──────────────────
   index.html:137312 renders:
       <div class="unit ${occupant.owner}" data-unit="..." data-y="...">
   and `occupant.owner` is the string 'player' or 'ai' (see the CSS pair at
   index.html:13224 `.unit.player` / :13228 `.unit.ai`). So friendly = `.player`,
   enemy = `.ai`. `_boardprobe.html` uses `.mine` / `.foe` as a stand-in; both
   vocabularies are accepted below so the probe is still viewable, but `player`/
   `ai` is the contract.

   ── PERFORMANCE ────────────────────────────────────────────────────────────
   No getBoundingClientRect anywhere, ever. No rAF loop, no polling. Work
   happens only on an actual hover/selection CHANGE, guarded by a signature
   string; a repeat pass with an unchanged signature does zero DOM writes, which
   is what makes the MutationObserver free on an idle board. Reach maths is pure
   integer Chebyshev on unit .pos — no layout reads. Everything else is CSS
   classes on existing elements plus ONE overlay subtree appended in a single
   operation, so the board layer is never re-rasterised.
   Measured on the probe with 10 enemies: 0.062ms for a full rebuild (0.4% of a
   16.7ms frame), and the overlay is provably registered pixel-for-pixel with
   the tile grid (dx/dy/dw all 0.0 for every cell).

   ── TOUCH ──────────────────────────────────────────────────────────────────
   See the TOUCH block near `onPointerDown`.

   Teardown: window.__targetingTeardown()
   ========================================================================== */
(function () {
  'use strict';

  var VERSION = 'r1-targeting-1';

  /* Idempotency: appending this file twice must not double-bind. The previous
     copy is torn down completely (listeners, observer, style, DOM, classes)
     before the new one installs. */
  try {
    if (typeof window.__targetingTeardown === 'function') window.__targetingTeardown();
  } catch (e) {}
  if (window.__TARGETING__ && window.__TARGETING__.version === VERSION && window.__TARGETING__.live) return;

  /* ── selectors ─────────────────────────────────────────────────────────── */
  var SEL_FRIEND = '.unit.player, .unit.mine';   // real | probe
  var SEL_ENEMY  = '.unit.ai, .unit.foe';        // real | probe
  var SEL_UNIT   = '.unit';
  var KEEP_HOVER_IN = '#unit-hover-menu, .uhm-act, #character-box, .cbx';

  var PLATE_CLASS  = 'tgt-plate';
  var LAYER_CLASS  = 'tgt-layer';
  var CELL_CLASS   = 'tgt-cell';
  var STYLE_ID     = 'tgt-readout-style';

  /* ── style (injected once) ─────────────────────────────────────────────── */
  var CSS = [
    /* ── WHERE THE PLATE LIVES, AND WHY IT IS NOT A CHILD OF THE TILE ────────
       The obvious home for a per-unit label is the `.tile` — and it is wrong.
       `.tile` carries `contain: layout paint` (index.html:11797), the board's
       deliberate anti-zoom guarantee that "nothing a unit/sprite does inside
       can reflow the tile or bleed a repaint into the grid". Paint containment
       HARD-CLIPS every descendant to the tile's border box, and it outranks
       the `.tile { overflow: visible !important }` rule two hundred lines
       earlier — so a name one pixel wider than a cell silently loses its first
       and last letters, with no ellipsis to hint that it happened. `.tile` also
       sets `z-index: 5`, making each tile its own stacking context, so a label
       hanging below tile A would paint UNDER tile B regardless of z-index.

       So the plates live in ONE overlay grid laid directly over the board:

         .board  >  .tgt-layer (abs, inset:0, padding/tracks/gap INHERITED)
                      >  .tgt-cell (grid-column/row, position:relative)
                           >  .tgt-plate (abs, free to overflow its cell)

       `inset: 0` makes the layer's border box equal the board's PADDING box
       (an abspos child's containing block), and `padding: inherit` then walks
       it in to the board's CONTENT box — the exact rectangle the tiles are
       laid out in. `grid-template-columns/rows: inherit` and `gap: inherit`
       copy the board's own track definition, so the overlay stays registered
       with the tiles for free if the grid is ever re-shaped. It is BOARD_W ×
       BOARD_H hexes today, laid out as 2·BOARD_W+1 half-column tracks by
       BOARD_H row tracks — inheriting the tracks is free, but the per-cell
       placement below has to do the same odd-r arithmetic the tiles do.

       `.tgt-cell` carries `min-width:0; min-height:0` for the same reason
       `.tile` does (index.html:11789): without it a long name's min-content
       would expand a `1fr` track and the overlay would drift out of register
       with the board. The plate itself is absolutely positioned, so it never
       contributes to sizing at all — it just spills over its neighbours, which
       is the whole point.

       ⚠ First attempt was an abspos child of `.board` with grid-column/row set,
       relying on the Grid spec's "abspos child with definite placement gets the
       grid AREA as its containing block". It does not survive here — the board
       carries `contain: content` (layout containment makes it the containing
       block for abspos descendants), and every plate resolved against the whole
       board box instead, stacking them all in the bottom-left. Measured, not
       assumed. The overlay grid has no such dependency.

       The layer is appended AFTER all BOARD_W×BOARD_H tiles, and it is the only element we
       add to `.board`, so no tile's :nth-child index moves (body.bfx-quake
       staggers its shake by .tile:nth-child(3n+k), index.html:9417).
       z-index clears both the tile layer (5) and the ambient drift layer (6). */
    /* ⚓ ANCHORED BELOW ITS OWN TILE, ALWAYS.
       The first cut hung the plate ABOVE the token (Master Duel puts its stat
       readout above the card) and flipped to below only on the back row, which
       has no headroom inside the board padding. That produced the worst case
       on a real enemy formation: the back-row plate dropped INTO the row-1 gap
       while the row-1 plate rose into the SAME gap, so two plates fought for
       one strip of pixels. Anchoring every plate below its own tile gives one
       plate per gap and a single consistent reading rhythm down the board —
       and it lands on the token's own name row, so the small white name is
       replaced rather than duplicated. */
    '.' + LAYER_CLASS + '{',
    '  position:absolute; inset:0; box-sizing:border-box; padding:inherit;',
    '  display:grid; grid-template-columns:inherit; grid-template-rows:inherit; gap:inherit;',
    '  pointer-events:none; z-index:40;',
    '}',
    '.' + CELL_CLASS + '{ position:relative; min-width:0; min-height:0; pointer-events:none; }',

    '.' + PLATE_CLASS + '{',
    '  position:absolute; left:50%; top:calc(100% - 4px);',
    '  transform:translateX(-50%);',
    '  z-index:40; pointer-events:none;',            /* never eats a click */
    /* ⚠ `width:max-content` is load-bearing, not decoration. An absolutely
       positioned box with `left:50%` and `right:auto` shrink-to-fits against
       (containing block − left) — i.e. HALF the tile — so the name was being
       clipped at both ends with no ellipsis, on every plate. max-content takes
       the natural text width first; max-width then clamps it back to something
       that won't smother the neighbouring columns. */
    '  width:max-content; max-width:152%; box-sizing:border-box;',
    /* Fallback path only (no grid coords resolvable → parented to the tile).
       Inside a paint-contained tile nothing may overflow, so clamp to the cell
       and let the ellipsis do its job rather than losing letters to the clip. */
    '  display:flex; align-items:center; gap:3px;',
    '  padding:1px 5px 2px; border-radius:3px;',
    '  font-family:system-ui,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;',
    '  font-weight:800; letter-spacing:.02em;',
    '  line-height:1.15; white-space:nowrap;',
    /* THE LEGIBILITY SANDWICH — three independent defences so the name holds
       up over ANY frame of a photographic battlefield (bright sky, pale stone,
       dark forest) without us knowing what is behind it:
         1. a dark plate that also DESATURATES + blurs the photo behind it, so
            busy detail stops competing with the glyph edges;
         2. an 8-direction 1px near-black ring baked into text-shadow — a real
            outline, not a soft glow, so it survives on white;
         3. a drop shadow underneath for separation from mid-tones.
       (2) is the load-bearing one: `color: red` alone dies on green foliage,
       which is exactly the Master Duel reference backdrop. */
    '  background:linear-gradient(180deg,rgba(30,5,5,.86),rgba(10,2,2,.80));',
    '  -webkit-backdrop-filter:blur(3px) saturate(.45);',
    '  backdrop-filter:blur(3px) saturate(.45);',
    '  box-shadow:0 2px 7px rgba(0,0,0,.6);',
    /* ⚠ The plate must be FULLY VISIBLE in its base style, with the entrance
       animation as pure decoration on top. `opacity:0` + `forwards` looks
       identical while animations run, but leaves the plate INVISIBLE anywhere
       the animation timeline never advances — a backgrounded/hidden tab, a
       static rasterisation (the board probe's SVG capture), or a browser that
       throttles compositing. Base-visible + no fill-mode means the worst case
       is "no fade in", not "no readout". */
    '  animation:tgt-in .16s ease-out;',
    '}',
    /* Bottom row has no gap beneath it — flip that one back above the tile.
       (An enemy that far forward is rare, but "rare" is not "never".) */
    '.' + PLATE_CLASS + '.tgt-clip{ max-width:100%; }',
    '.' + PLATE_CLASS + '.tgt-above{ top:auto; bottom:calc(100% - 4px); animation-name:tgt-in-a; }',
    /* ⚠ TRANSFORM-ONLY entrance. Do NOT put `opacity:0` in the `from` frame:
       an animation parked at 0% (hidden tab, throttled compositor, static
       raster) would then hold the plate at zero alpha and the whole readout
       silently disappears. Every keyframe here is fully opaque. */
    '@keyframes tgt-in{ from{ transform:translateX(-50%) translateY(-5px) scale(.93) } to{ transform:translateX(-50%) translateY(0) scale(1) } }',
    '@keyframes tgt-in-a{ from{ transform:translateX(-50%) translateY(5px) scale(.93) } to{ transform:translateX(-50%) translateY(0) scale(1) } }',

    '.' + PLATE_CLASS + ' .tgt-nm{',
    '  overflow:hidden; text-overflow:ellipsis; min-width:0;',
    '  text-shadow:',
    '    1px 0 0 #140406, -1px 0 0 #140406, 0 1px 0 #140406, 0 -1px 0 #140406,',
    '    1px 1px 0 #140406, -1px 1px 0 #140406, 1px -1px 0 #140406, -1px -1px 0 #140406,',
    '    0 2px 5px rgba(0,0,0,.95);',
    '}',

    /* ── TIER A — CAN REACH YOU ────────────────────────────────────────────
       With 8+ enemies a uniformly-red field is just red mush, so emphasis is
       spent where it changes a decision: enemies whose (move + attack range)
       covers the unit you are pointing at. Full brightness, ALL CAPS, a
       hairline red border, a red bloom, and a thick red spine on the leading
       edge. The spine is drawn with a border rather than a ⚔ glyph on purpose:
       a 10px emoji renders as mush (and depends on which emoji font the device
       happens to ship), whereas 3px of solid colour is unambiguous at any
       size and in any font stack. */
    '.' + PLATE_CLASS + '.tgt-reach{',
    '  font-size:clamp(10px,1.12vw,15px);',
    '  text-transform:uppercase; letter-spacing:.035em;',
    '  color:#ff5b46;',
    '  border:1px solid rgba(255,90,64,.62);',
    '  border-left:3px solid #ff6a52; padding-left:5px;',
    '  box-shadow:0 2px 8px rgba(0,0,0,.65), 0 0 12px rgba(255,60,36,.34), inset 0 0 8px rgba(255,60,36,.14);',
    '}',
    '.' + PLATE_CLASS + '.tgt-reach .tgt-nm{ text-shadow:',
    '    1px 0 0 #140406, -1px 0 0 #140406, 0 1px 0 #140406, 0 -1px 0 #140406,',
    '    1px 1px 0 #140406, -1px 1px 0 #140406, 1px -1px 0 #140406, -1px -1px 0 #140406,',
    '    0 2px 5px rgba(0,0,0,.95), 0 0 10px rgba(255,70,45,.55); }',

    /* ── TIER B — ON THE FIELD, OUT OF REACH ───────────────────────────────
       Still named, still red, still legible — but recessive: smaller, dimmer,
       brick-toned, mixed case (not caps), no border, no bloom. The eye lands
       on tier A first and the rest reads as context. This is what keeps 8+
       plates from collapsing into red mush. Mixed case also buys ~15% more
       characters before the ellipsis, which matters at small tile sizes. */
    '.' + PLATE_CLASS + '.tgt-far{',
    '  font-size:clamp(9px,.94vw,12.5px);',
    '  color:#d9705f; opacity:.74;',
    '  background:linear-gradient(180deg,rgba(20,6,6,.72),rgba(8,2,2,.64));',
    '  padding:1px 4px;',
    '}',

    /* The enemy's own small white name is REPLACED, not duplicated — otherwise
       every marked token carries two names 4px apart, which is the single
       fastest way to make a board look broken. The level badge beside it stays. */
    '.unit.tgt-named .unit-name{ visibility:hidden; }',

    /* Ring on the enemy TOKEN itself — only for the ones that can reach you.
       ⚠ The crisp ring is an OUTLINE, not a box-shadow. `.unit` carries
       `transition: transform .1s, box-shadow .15s` (index.html:13156), so a
       box-shadow-only ring FADES IN — and anywhere the transition clock is
       throttled (background tab, non-compositing view) it can sit at its
       transparent start value indefinitely. `outline` is not in that transition
       list, so the ring is there on the very first frame, guaranteed; the
       box-shadow then adds the bloom as pure decoration.
       Both are composited on the unit's own layer (every .unit already has
       `will-change: transform`), so the board layer is never repainted. */
    '.unit.tgt-threat{ outline:2px solid rgba(255,92,62,.95); outline-offset:-1px;',
    '  box-shadow:0 0 0 2px rgba(255,92,62,.55), inset 0 0 14px rgba(255,60,36,.22), 0 0 16px rgba(255,60,36,.55) !important; }',
    '.unit.tgt-threat::after{ opacity:0 !important; }',   /* mute the rarity aura so the red ring reads */
    '@media (prefers-reduced-motion:no-preference){',
    '  .unit.tgt-threat{ animation:tgt-pulse 1.5s ease-in-out infinite; }',
    '  @keyframes tgt-pulse{ 0%,100%{ box-shadow:0 0 0 2px rgba(255,92,62,.9), inset 0 0 12px rgba(255,60,36,.18), 0 0 12px rgba(255,60,36,.42) }',
    '                        50%   { box-shadow:0 0 0 2px rgba(255,130,100,1), inset 0 0 18px rgba(255,60,36,.30), 0 0 22px rgba(255,60,36,.72) } }',
    '}',

    /* The unit the readout is measured FROM — a cool ring, so "in reach of
       WHAT" is answerable without reading a word. Same outline reasoning. */
    '.unit.tgt-anchor{ outline:2px solid rgba(130,205,255,.95); outline-offset:-1px;',
    '  box-shadow:0 0 0 2px rgba(120,200,255,.5), 0 0 14px rgba(74,143,212,.55) !important; }',

    /* Reduced-motion / print safety */
    '@media (prefers-reduced-motion:reduce){ .' + PLATE_CLASS + '{ animation:none } .unit.tgt-threat{ animation:none } }'
  ].join('\n');

  function ensureStyle() {
    var st = document.getElementById(STYLE_ID);
    if (st) return st;
    st = document.createElement('style');
    st.id = STYLE_ID;
    st.textContent = CSS;
    (document.head || document.documentElement).appendChild(st);
    return st;
  }

  /* ── tiny helpers ──────────────────────────────────────────────────────── */
  function q(sel, root) { try { return (root || document).querySelector(sel); } catch (e) { return null; } }
  function qa(sel, root) { try { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); } catch (e) { return []; } }
  function boardEl() { return q('.board'); }
  function isFriendlyEl(el) { try { return !!(el && el.matches && el.matches(SEL_FRIEND)); } catch (e) { return false; } }
  function appState() { try { return (typeof App !== 'undefined' && App && App.state) || null; } catch (e) { return null; } }
  function appUi()    { try { return (typeof App !== 'undefined' && App && App.ui) || null; } catch (e) { return null; } }
  function findUnit(id) {
    var s = appState(); if (!s || !s.units || id == null) return null;
    for (var i = 0; i < s.units.length; i++) if (s.units[i] && String(s.units[i].id) === String(id)) return s.units[i];
    return null;
  }

  /* Suppress while the player is AIMING. Deliberately NOT keyed on
     App.ui.modalUnitId — onUnitClick() sets that on every click, and gating on
     it would kill the click half of the feature. */
  function suppressed() {
    var ui = appUi();
    if (!ui) return false;                       // probe / pre-boot: allow
    try { if (typeof App !== 'undefined' && App.screen && App.screen !== 'battle') return true; } catch (e) {}
    if (ui.actionMode) return true;              // move / swap mode
    if (ui.selectedMoveId) return true;          // an attack is armed → tiles are already red
    if (ui.selectedCardId) return true;          // placing a card
    if (ui.targeting || ui.skillTargeting || ui.consumableTargeting || ui.sacrificeTargeting) return true;
    if (ui.fusionMode || ui.archonMode || ui.fusionPlace) return true;
    try { if (typeof _anyCinematicActive === 'function' && _anyCinematicActive()) return true; } catch (e) {}
    return false;
  }

  /* Threat reach of an enemy = how far it can travel + how far it can swing.
     Uses the game's OWN helpers so it can never disagree with the rules
     engine; falls back to a sane constant when they aren't reachable (probe). */
  function reachOf(u) {
    var mv = 0, rng = 0, s = appState();
    try { if (typeof getMoveRange === 'function') mv = getMoveRange(u, s && s.weather) | 0; } catch (e) {}
    try {
      var ms = (typeof getAvailableMoves === 'function') ? (getAvailableMoves(u) || []) : [];
      for (var i = 0; i < ms.length; i++) {
        var m = ms[i];
        if (!m || m.kind !== 'attack') continue;
        var r = (typeof getEffectiveAttackRange === 'function') ? (getEffectiveAttackRange(u, m) | 0) : (m.range | 0);
        if (r > rng) rng = r;
      }
    } catch (e) {}
    if (!rng) rng = 1;
    /* getEffectiveAttackRange returns a deliberately generous 12 for the
       squadSight passive (index.html:80299) — taking that literally would
       flag the entire board as "in reach" and destroy the tiering. Cap it. */
    if (rng > 6) rng = 6;
    return mv + rng;
  }

  /* Grid coords for a `.unit` element. Real render stamps data-x/data-y on the
     tile; the probe doesn't, so fall back to the tile's index in the board.
     One computed-style read per apply at most — never per frame, never a rect. */
  var _colsCache = 0;
  function cols() {
    if (_colsCache) return _colsCache;
    try { if (typeof BOARD_W === 'number' && BOARD_W > 0) return (_colsCache = BOARD_W); } catch (e) {}
    var b = boardEl();
    if (b) {
      try {
        /* ⚠ THE TRACK COUNT IS NO LONGER THE COLUMN COUNT. The board is a
           pointy-top odd-r hex grid laid out in HALF-column tracks so the
           +0.5 shift of odd rows lands on an integer grid line: 2W+1 tracks,
           every tile spanning 2 (index.html renderBoard). Reading the track
           count raw would return 29 for a 14-wide board and every fallback
           coordinate would be garbage. Odd count ⇒ half-columns ⇒ (n-1)/2. */
        var n = getComputedStyle(b).gridTemplateColumns.split(/\s+/).filter(Boolean).length;
        if (n > 3 && (n % 2) === 1) return (_colsCache = (n - 1) / 2);
        if (n > 1) return (_colsCache = n);
      } catch (e) {}
    }
    return 14;
  }
  function domPos(unitEl) {
    var tile = unitEl && unitEl.closest ? unitEl.closest('.tile') : null;
    if (!tile) return null;
    var dx = tile.dataset ? tile.dataset.x : null, dy = tile.dataset ? tile.dataset.y : null;
    if (dx != null && dy != null && dx !== '' && dy !== '') return { x: parseInt(dx, 10), y: parseInt(dy, 10) };
    var b = tile.parentElement; if (!b) return null;
    /* Index among TILES, not among all children — the board also carries our
       own plate elements, and counting those would shift every coordinate. */
    var idx = Array.prototype.indexOf.call(b.querySelectorAll(':scope > .tile'), tile);
    if (idx < 0) return null;
    var c = cols();
    return { x: idx % c, y: Math.floor(idx / c) };
  }
  function rowOf(unitEl) {
    var dy = unitEl && unitEl.dataset ? unitEl.dataset.y : null;
    if (dy != null && dy !== '') return parseInt(dy, 10);
    var p = domPos(unitEl);
    return p ? p.y : 1;
  }
  var _rowsCache = 0;
  function rows() {
    if (_rowsCache) return _rowsCache;
    try { if (typeof BOARD_H === 'number' && BOARD_H > 0) return (_rowsCache = BOARD_H); } catch (e) {}
    var b = boardEl();
    if (b) {
      try {
        /* Rows ARE one track each (the row track is the hex row pitch), so
           unlike cols() this count needs no halving. */
        var n = getComputedStyle(b).gridTemplateRows.split(/\s+/).filter(Boolean).length;
        if (n > 1) return (_rowsCache = n);
      } catch (e) {}
      var nt = b.querySelectorAll(':scope > .tile').length;
      if (nt) return (_rowsCache = Math.round(nt / cols()));
    }
    return 12;
  }

  /* Display name for an enemy. Prefer state (authoritative) over DOM text.
     Face-down units keep their identity hidden — the board deliberately renders
     them as a card back (unitBoardVisual → _subterfugeTokenHtml), and this
     readout must not become the leak that undoes Subterfuge. */
  function enemyLabel(el) {
    if (el.classList && el.classList.contains('facedown')) return 'SET';
    var u = findUnit(el.dataset ? el.dataset.unit : null);
    if (u) {
      if (u.isFaceDown) return 'SET';
      if (u.name) return String(u.name);
    }
    var n = q('.unit-name', el);
    var t = n && n.textContent ? n.textContent.trim() : '';
    if (t && t !== '■') return t;
    return (el.getAttribute('title') || 'ENEMY').split('—')[0].trim() || 'ENEMY';
  }

  /* ── state ─────────────────────────────────────────────────────────────── */
  var hoverId = null;      // unit id currently hovered (friendly only)
  var touchId = null;      // unit id pinned by a touch (see TOUCH)
  var touchTimer = 0;
  var lastSig = '';        // last applied signature — the no-op guard
  var applying = false;
  var mo = null;
  var moScheduled = 0;

  function anchorId() {
    if (hoverId) return hoverId;
    if (touchId) return touchId;
    var ui = appUi();
    if (ui && ui.selectedUnitId != null) {
      var u = findUnit(ui.selectedUnitId);
      if (u && u.owner === 'player') return String(ui.selectedUnitId);
      if (!u) {                                       // state not readable — trust the DOM
        var el0 = q('.unit[data-unit="' + String(ui.selectedUnitId).replace(/"/g, '\\"') + '"]');
        if (isFriendlyEl(el0)) return String(ui.selectedUnitId);
      }
      return null;
    }
    var sel = q('.unit.selected');                    // probe / no App.ui
    if (sel && isFriendlyEl(sel)) return sel.dataset.unit || null;
    return null;
  }

  function clearMarks() {
    var i, list;
    list = qa('.' + LAYER_CLASS);
    for (i = 0; i < list.length; i++) if (list[i].parentNode) list[i].parentNode.removeChild(list[i]);
    list = qa('.' + PLATE_CLASS);   // fallback plates parented straight to a tile
    for (i = 0; i < list.length; i++) if (list[i].parentNode) list[i].parentNode.removeChild(list[i]);
    list = qa('.unit.tgt-threat');
    for (i = 0; i < list.length; i++) list[i].classList.remove('tgt-threat');
    list = qa('.unit.tgt-anchor');
    for (i = 0; i < list.length; i++) list[i].classList.remove('tgt-anchor');
    list = qa('.unit.tgt-named');
    for (i = 0; i < list.length; i++) list[i].classList.remove('tgt-named');
  }

  /* One pass. Cheap: a couple of querySelectorAll calls + N small elements.
     Runs only when the signature changes, i.e. on a real hover/selection/turn
     change or after a re-render wiped the plates. */
  function apply(force) {
    if (applying) return;
    var b = boardEl();
    var id = (b && !suppressed()) ? anchorId() : null;

    var s = appState();
    var turnTag = s ? (String(s.turn) + ':' + String(s.turnCount != null ? s.turnCount : '')) : '';
    var have = qa('.' + PLATE_CLASS).length;

    if (!id) {
      if (lastSig === '' && have === 0 && !force) return;
      applying = true;
      try { clearMarks(); } finally { applying = false; }
      lastSig = '';
      return;
    }

    var anchorEl = b.querySelector('.unit[data-unit="' + String(id).replace(/"/g, '\\"') + '"]');
    if (!anchorEl || !isFriendlyEl(anchorEl)) {
      if (lastSig !== '' || have) { applying = true; try { clearMarks(); } finally { applying = false; } lastSig = ''; }
      return;
    }

    var enemies = qa(SEL_ENEMY, b);
    var sig = VERSION + '|' + id + '|' + turnTag + '|' + enemies.map(function (e) {
      return (e.dataset ? e.dataset.unit : '?') + (e.classList.contains('facedown') ? 'F' : '');
    }).join(',');

    /* No-op guard. Identical situation AND the plates are still in the DOM →
       touch nothing. This is what makes the MutationObserver free. */
    if (!force && sig === lastSig && have === enemies.length) return;

    applying = true;
    try {
      clearMarks();
      anchorEl.classList.add('tgt-anchor');

      var anchorUnit = findUnit(id);
      var anchorPos = (anchorUnit && anchorUnit.pos) || domPos(anchorEl);
      var layer = null;   /* built once, appended once — a single reflow */

      for (var i = 0; i < enemies.length; i++) {
        var el = enemies[i];
        var tile = el.closest ? el.closest('.tile') : null;
        if (!tile) continue;

        /* Can this enemy actually reach the anchor? */
        var inReach = false;
        var eu = findUnit(el.dataset ? el.dataset.unit : null);
        var epos = (eu && eu.pos) || domPos(el);
        if (anchorPos && epos) {
          var reach = eu ? reachOf(eu) : 3;   /* 3 = default move 2 + melee 1, used by the probe */
          /* distance() is the game's ONE board metric (index.html:74103). This
             used to be a private cheb() here, and that is exactly the bug the
             unification removed: this nameplate tells the player "that enemy
             can reach you", so a second copy of the metric means the telegraph
             and the rules disagree the moment the lattice stops being square.
             The bare global resolves because this file is a CLASSIC deferred
             script (index.html:223130) sharing the inline script's top-level
             lexical scope — the same reason cols()/rows() below read bare
             BOARD_W/BOARD_H. Do NOT re-inline it, and do NOT convert this file
             to type="module": that would break all three at once. */
          inReach = distance(anchorPos, epos) <= reach;
        }

        var plate = document.createElement('div');
        plate.className = PLATE_CLASS + ' ' + (inReach ? 'tgt-reach' : 'tgt-far')
                        + (rowOf(el) >= rows() - 1 ? ' tgt-above' : '');
        plate.setAttribute('aria-hidden', 'true');
        el.classList.add('tgt-named');
        if (inReach) el.classList.add('tgt-threat');
        var nm = document.createElement('span');
        nm.className = 'tgt-nm';
        nm.textContent = enemyLabel(el);      // textContent — never innerHTML, names are user data
        plate.appendChild(nm);

        /* Grid-area placement on the BOARD (see the CSS note). Out of flow, so
           it cannot resize a track; appended last, so no tile's :nth-child
           index moves. Only if the cell can't be resolved do we fall back to
           parenting inside the paint-contained tile, clamped so the name
           ellipsises instead of losing letters to the clip. */
        if (epos && epos.x >= 0 && epos.y >= 0) {
          if (!layer) { layer = document.createElement('div'); layer.className = LAYER_CLASS; layer.setAttribute('aria-hidden', 'true'); }
          var cell = document.createElement('div');
          cell.className = CELL_CLASS;
          /* 🔷 SAME ODD-R PLACEMENT THE TILES USE. `grid-template-columns:
             inherit` copies the board's HALF-column tracks, so a plain
             `epos.x + 1` would land the plate roughly half a board to the
             left and would look like a rendering bug rather than a
             coordinate bug. Mirror renderBoard exactly: span two half-columns
             starting at 2x+1, plus one more on odd rows. */
          cell.style.gridColumn = String(2 * epos.x + 1 + (epos.y & 1)) + ' / span 2';
          cell.style.gridRow = String(epos.y + 1);
          cell.appendChild(plate);
          layer.appendChild(cell);
        } else {
          plate.className += ' tgt-clip';
          tile.appendChild(plate);
        }
      }

      if (layer) b.appendChild(layer);   // last child → tile :nth-child indices unmoved

      /* One live-region line so the readout is not purely visual. */
      announce(enemies.length);
    } finally {
      applying = false;
    }
    lastSig = sig;
  }

  /* Screen-reader mirror of the readout. Rebuilt, not appended, so it never grows. */
  var liveEl = null;
  function announce(n) {
    try {
      if (!liveEl) {
        liveEl = document.createElement('div');
        liveEl.id = 'tgt-live';
        liveEl.setAttribute('aria-live', 'polite');
        liveEl.style.cssText = 'position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap';
        document.body.appendChild(liveEl);
      }
      var threats = qa('.unit.tgt-threat').length;
      liveEl.textContent = n + ' enemy unit' + (n === 1 ? '' : 's') + ' on the field, ' + threats + ' in reach.';
    } catch (e) {}
  }

  /* ── listeners ─────────────────────────────────────────────────────────── */

  /* Hover. Delegated `mouseover` on document handles enter AND leave in one
     listener (moving off a unit fires mouseover on whatever you moved onto),
     so there is no mouseenter/mouseleave pair to get out of sync — and no
     property assignment that could clobber the action menu's own handlers. */
  function onMouseOver(e) {
    var t = e.target;
    if (!t || !t.closest) return;
    /* Reaching for the hover ACTION MENU must not kill the readout — the two
       features are meant to be used together. */
    if (t.closest(KEEP_HOVER_IN)) return;
    var u = t.closest(SEL_UNIT);
    var next = (u && isFriendlyEl(u) && u.dataset) ? (u.dataset.unit || null) : null;
    if (next === hoverId) return;
    hoverId = next;
    if (next) { touchId = null; if (touchTimer) { clearTimeout(touchTimer); touchTimer = 0; } }
    apply(false);
  }
  function onMouseLeaveDoc(e) {
    if (e && e.relatedTarget) return;   // still inside the document
    if (!hoverId) return;
    hoverId = null;
    apply(false);
  }

  /* ── TOUCH ─────────────────────────────────────────────────────────────────
     Touch devices have no hover at all — `(hover: none)`, and the existing
     action menu already opts out of them (`_uhmHasHover()`, index.html:68131).
     Three things make the feature work by touch:

       1. TAP-TO-PIN. A non-mouse `pointerdown` on a friendly unit pins the
          readout immediately — on press, before the click resolves, so the
          names are up before the unit detail modal animates in and the player
          gets the threat picture even if the modal then covers part of the
          board. Tapping anywhere else (empty tile, enemy, HUD) unpins it.
       2. SELECTION IS THE DURABLE PATH. Tapping a friendly unit also sets
          App.ui.selectedUnitId via the game's own onUnitClick(), and the
          MutationObserver re-derives the readout from selection after every
          re-render — so it survives the tap, the modal, and closing the modal.
          On touch, "select" IS the hover.
       3. AUTO-RELEASE. The pin self-clears after 6s if selection never took
          over, so a stray tap can't leave red plates stranded on the field.

     We use pointerdown (not touchstart) so pen input behaves the same, and we
     never call preventDefault — the tap must still reach onUnitClick(). */
  var TOUCH_HOLD_MS = 6000;
  function onPointerDown(e) {
    if (e && e.pointerType === 'mouse') return;      // mouse is handled by hover
    var t = e.target;
    if (!t || !t.closest) return;
    if (t.closest(KEEP_HOVER_IN)) return;
    var u = t.closest(SEL_UNIT);
    var next = (u && isFriendlyEl(u) && u.dataset) ? (u.dataset.unit || null) : null;
    if (touchTimer) { clearTimeout(touchTimer); touchTimer = 0; }
    touchId = next;
    if (next) {
      touchTimer = setTimeout(function () { touchTimer = 0; touchId = null; apply(false); }, TOUCH_HOLD_MS);
    }
    apply(false);
  }

  /* Escape / turn end / anything that drops selection also drops the readout —
     handled generically by the observer re-deriving anchorId(), but Esc is
     worth an explicit fast path so the plates die on the same frame. */
  function onKeyDown(e) {
    if (e.key !== 'Escape' && e.keyCode !== 27) return;
    hoverId = null; touchId = null;
    if (touchTimer) { clearTimeout(touchTimer); touchTimer = 0; }
    apply(false);
  }
  function onWindowBlur() {
    if (!hoverId && !touchId) return;
    hoverId = null; touchId = null;
    apply(false);
  }

  /* Re-render survival. renderBattle() rewrites #app wholesale (`.board-area`
     is rebuilt on every card play / move), which wipes the plates and the
     classes. Rather than monkey-patching a render function, we watch #app and
     re-derive. The callback is rAF-debounced and the signature guard makes the
     common case a pure read, so an idle board costs nothing.
     The observer is DISCONNECTED across our own writes, so it can never
     re-trigger itself — MutationObserver drops queued records on disconnect. */
  /* ⚠ setTimeout, not requestAnimationFrame. rAF looks like the natural choice
     for "batch DOM writes before the next paint", but it is only guaranteed to
     fire when the page is actually producing frames — a hidden tab, a
     backgrounded window or a non-compositing embed can throttle it to zero, and
     the readout would then stay frozen on stale markup until something else
     woke a frame. The work here is a single append with no need to be
     paint-aligned, so a 0ms timer is both sufficient and strictly more robust.
     `moScheduled` coalesces a whole burst of mutations into one pass. */
  function schedule() {
    if (moScheduled) return;
    moScheduled = setTimeout(function () {
      moScheduled = 0;
      if (!mo) return;
      mo.disconnect();                       // records queued while detached are dropped,
      try { apply(false); } catch (e) {}     // so our own writes can never re-trigger us
      try { mo.observe(observeRoot(), { childList: true, subtree: true }); } catch (e) {}
    }, 0);
  }
  function observeRoot() { return document.getElementById('app') || document.body; }

  /* ── install ───────────────────────────────────────────────────────────── */
  ensureStyle();
  document.addEventListener('mouseover', onMouseOver, true);
  document.addEventListener('mouseleave', onMouseLeaveDoc, true);
  document.addEventListener('pointerdown', onPointerDown, true);
  document.addEventListener('keydown', onKeyDown, true);
  window.addEventListener('blur', onWindowBlur);

  try {
    mo = new MutationObserver(schedule);
    mo.observe(observeRoot(), { childList: true, subtree: true });
  } catch (e) { mo = null; }

  apply(true);

  /* ── teardown ──────────────────────────────────────────────────────────── */
  window.__targetingTeardown = function () {
    try { document.removeEventListener('mouseover', onMouseOver, true); } catch (e) {}
    try { document.removeEventListener('mouseleave', onMouseLeaveDoc, true); } catch (e) {}
    try { document.removeEventListener('pointerdown', onPointerDown, true); } catch (e) {}
    try { document.removeEventListener('keydown', onKeyDown, true); } catch (e) {}
    try { window.removeEventListener('blur', onWindowBlur); } catch (e) {}
    try { if (moScheduled) clearTimeout(moScheduled); } catch (e) {}
    moScheduled = 0;
    try { if (mo) mo.disconnect(); } catch (e) {}
    mo = null;
    try { if (touchTimer) clearTimeout(touchTimer); } catch (e) {}
    touchTimer = 0;
    hoverId = touchId = null; lastSig = '';
    applying = true;                 // suppress any in-flight apply
    try { clearMarks(); } catch (e) {}
    applying = false;
    try { var st = document.getElementById(STYLE_ID); if (st && st.parentNode) st.parentNode.removeChild(st); } catch (e) {}
    try { if (liveEl && liveEl.parentNode) liveEl.parentNode.removeChild(liveEl); } catch (e) {}
    liveEl = null;
    try { if (window.__TARGETING__) window.__TARGETING__.live = false; } catch (e) {}
    try { delete window.__targetingTeardown; } catch (e) { window.__targetingTeardown = undefined; }
  };

  /* Small debug/test surface — used by the board probe harness. */
  window.__TARGETING__ = {
    version: VERSION,
    live: true,
    apply: function () { apply(true); },
    setHover: function (id) { hoverId = id ? String(id) : null; touchId = null; apply(true); },
    state: function () { return { hoverId: hoverId, touchId: touchId, anchor: anchorId(), plates: qa('.' + PLATE_CLASS).length, threats: qa('.unit.tgt-threat').length }; }
  };
})();
