/* ============================================================================
 * ActivateFX — "when a card activates ANYWHERE, pulse it and say what it does"
 *                                                     round 7 / piece: activate
 * ----------------------------------------------------------------------------
 * Two halves, one call:
 *
 *   1. THE PULSE — the card that activated swells, rims gold and throws a ring,
 *      wherever it physically is: on the board, in your hand, in the graveyard
 *      viewer, face-down on a tile. When the card has no element on screen
 *      (it activated from inside the DECK, or from the VOID) a GHOST card
 *      materialises at that zone's pile and flies toward the board, so the
 *      player is never told "something happened" without being told *where*.
 *
 *   2. THE EXPLAIN — a band carrying the card's real face, its name, WHAT KIND
 *      of activation this is (on play / trap / grave ability / flip / hand
 *      ability / field ability …), the card's REAL effect text, and — derived
 *      by diffing the reducer, not from authored prose — WHO it actually hit.
 *      A hairline leader runs from the band to the pulse, so "which card" and
 *      "what it did" are one object even when the band never moves.
 *
 *   window.ActivateFX.announce(spec)    -> beat id (or null)
 *   window.ActivateFX.skip()            -> end the beat that is playing
 *   window.ActivateFX.resetMatch()      -> forget "seen" cards (new battle)
 *   window.ActivateFX.teardown()
 *   window.ActivateFX.debug()           -> what happened, for probes
 *
 * 🔴 NOTHING HERE IS LOAD-BEARING.
 * The reducer has already run and the state has already landed by the time
 * `announce` is called. This module owns no state, returns nothing the caller
 * uses, resolves no continuation and blocks no input. Skipping is therefore
 * safe by construction, not by care: there is no board state downstream of an
 * animation to leave wrong. `announce` is wrapped so it cannot throw into its
 * caller, and every beat reaches one idempotent `finish()` from five routes
 * (schedule, skip, teardown, error, watchdog).
 *
 * 🔴 NEVER OBSCURE THE BOARD.
 * The band is MEASURED against the live `.board` rect on every beat and placed
 * in the empty environment strip ABOVE the board when one exists, below it if
 * not, and only as a last resort translucently over the board's top edge. It
 * is never given a fixed position it might happen to share with a unit.
 *
 * PERFORMANCE
 * No requestAnimationFrame, no per-frame layout reads, no blend modes. Two
 * rects are read per beat (source element + board) at build time and never
 * again. Only `transform`, `opacity` and one `filter` are animated, all on
 * overlay nodes that live outside `.board`. Fixed node budget (~9 per beat),
 * all removed on finish.
 * ==========================================================================*/
(function (global) {
  'use strict';
  if (!global || typeof global.document === 'undefined') return;

  var doc = global.document;
  var VERSION = 'r7-activate-1.0.0';
  var STYLE_ID = 'afx-style';
  var ROOT_ID = 'afx-root';

  /* ------------------------------------------------------------------ *
   * TIMING — three tiers, because an explain beat you have to sit through
   * on every single activation stops being information and becomes a tax.
   *
   *   FULL  — first time this card + this effect is seen THIS MATCH.
   *   BRIEF — seen before. Face + name + the headline line only.
   *   FLASH — seen 3+ times. Pulse and a name chip. No reading required.
   *
   * The pulse is identical in all three; only the explain shrinks. So the
   * "which card did the thing" signal never degrades, however many times a
   * player fires the same trigger.
   * ------------------------------------------------------------------ */
  var PULSE_MS = 520;
  var TIER = {
    full:  { in: 190, hold: 1320, out: 230 },
    brief: { in: 150, hold:  620, out: 190 },
    flash: { in: 120, hold:  260, out: 150 }
  };
  var GAP_MS = 70;             // between two beats of a chain
  var CHAIN_BUDGET_MS = 5400;  // a chain must never outstay this
  var MAX_QUEUE = 6;           // beyond this the tail coalesces into one beat
  var RM_TOTAL = 340;          // reduced motion: one short, motionless beat
  var WATCHDOG_PAD = 1500;     // hard kill, over and above the schedule

  function tierMs(t) { var d = TIER[t] || TIER.full; return d.in + d.hold + d.out; }

  /* ------------------------------------------------------------------ */
  var mount = null;
  var live = null;             // the beat currently playing
  var queue = [];              // beats waiting
  var seen = Object.create(null);   // "cardId|effect-signature" -> times seen
  var beatSeq = 0;
  var trace = [];              // rolling record, for probes
  var chainStartedAt = 0;

  function now() {
    try { return (global.performance && global.performance.now) ? global.performance.now() : Date.now(); }
    catch (e) { return Date.now(); }
  }

  function reduceMotion() {
    try { return !!(global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches); }
    catch (e) { return false; }
  }

  /* Graphics = Low still gets the full INFORMATION — only the decoration is
     dropped. Legibility is not a quality setting. */
  function lowGfx() {
    try {
      var g = global.__afxGfx || (global.getSettings && global.getSettings());
      var q = g && (g.gfxQuality || g.graphics);
      return String(q || '').toLowerCase() === 'low';
    } catch (e) { return false; }
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  /* ==================================================================== *
   * STYLE
   * ==================================================================== */
  function ensureStyle() {
    if (doc.getElementById(STYLE_ID)) return;
    var css = [
      '#' + ROOT_ID + '{position:fixed;inset:0;z-index:2147483200;pointer-events:none;overflow:hidden;',
      '  font-family:"Cinzel",Georgia,serif;contain:layout style;}',
      '#' + ROOT_ID + ' *{box-sizing:border-box;}',

      /* ---- the pulse: a clone of the real card, swelling in place --- */
      '.afx-pulse{position:fixed;transform-origin:50% 60%;will-change:transform,opacity;',
      '  border-radius:9px;overflow:hidden;opacity:0;pointer-events:none;',
      '  animation:afx-swell ' + PULSE_MS + 'ms cubic-bezier(.2,.9,.25,1) forwards;}',
      '.afx-pulse::after{content:"";position:absolute;inset:0;border-radius:9px;pointer-events:none;',
      '  box-shadow:inset 0 0 0 2px rgba(255,214,120,.95),inset 0 0 22px rgba(255,176,60,.55);',
      '  animation:afx-rim ' + PULSE_MS + 'ms ease-out forwards;}',
      '.afx-pulse > *{max-width:100%;max-height:100%;}',
      '@keyframes afx-swell{',
      '  0%{opacity:0;transform:scale(1);}',
      '  14%{opacity:1;transform:scale(1.015);}',      /* anticipation: a breath in */
      '  38%{opacity:1;transform:scale(1.16);}',       /* the hit */
      '  62%{opacity:1;transform:scale(1.09);}',       /* settle */
      '  100%{opacity:0;transform:scale(1.04);}}',
      '@keyframes afx-rim{0%{opacity:0}18%{opacity:1}70%{opacity:.85}100%{opacity:0}}',

      /* ---- the ring thrown off the source --------------------------- */
      /* A rounded RECTANGLE, sized to the card and expanding a little past it —
         an "activation frame" leaving the card, which is what Master Duel does.
         A circle sized off the longest edge (the first version) swallowed the
         cards either side of the one that actually activated. */
      '.afx-ring{position:fixed;border-radius:11px;pointer-events:none;transform:translate(-50%,-50%) scale(.9);',
      '  border:2px solid rgba(255,206,110,.9);opacity:0;will-change:transform,opacity;',
      '  box-shadow:0 0 18px rgba(255,170,50,.5),inset 0 0 14px rgba(255,190,80,.35);',
      '  animation:afx-ring ' + PULSE_MS + 'ms cubic-bezier(.15,.7,.3,1) forwards;}',
      '@keyframes afx-ring{0%{opacity:0;transform:translate(-50%,-50%) scale(.9)}',
      '  22%{opacity:.95}100%{opacity:0;transform:translate(-50%,-50%) scale(1.28)}}',

      /* ---- the live source element gets a brief in-place kick -------- */
      '.afx-src-lit{animation:afx-srclit 300ms ease-out;}',
      '@keyframes afx-srclit{0%{filter:none}40%{filter:brightness(1.5) drop-shadow(0 0 10px rgba(255,190,80,.9))}100%{filter:none}}',

      /* ---- the ghost: a card that had no element on screen ----------- */
      '.afx-ghost{position:fixed;width:74px;height:104px;border-radius:8px;pointer-events:none;',
      '  background:linear-gradient(165deg,#2a1c3e,#0d0917);background-size:cover;background-position:center;',
      '  border:1.5px solid rgba(255,206,110,.85);opacity:0;transform-origin:50% 50%;',
      '  box-shadow:0 10px 26px rgba(0,0,0,.7),0 0 20px rgba(255,170,50,.35);',
      '  display:flex;align-items:flex-end;justify-content:center;overflow:hidden;',
      '  animation:afx-ghost 760ms cubic-bezier(.2,.85,.3,1) forwards;}',
      '.afx-ghost i{font-style:normal;font-size:9px;letter-spacing:.08em;font-weight:800;color:#ffe6b0;',
      '  background:linear-gradient(transparent,rgba(0,0,0,.9));width:100%;text-align:center;padding:12px 2px 3px;}',
      '@keyframes afx-ghost{0%{opacity:0;transform:translate(0,0) scale(.55) rotate(-7deg)}',
      '  20%{opacity:1;transform:translate(0,-8px) scale(1.06) rotate(-2deg)}',
      '  55%{opacity:1;transform:translate(var(--afx-gx,0px),var(--afx-gy,-34px)) scale(1) rotate(0deg)}',
      '  100%{opacity:0;transform:translate(var(--afx-gx,0px),calc(var(--afx-gy,-34px) - 16px)) scale(.94)}}',

      /* ---- the zone flare: the pile the card came out of ------------- */
      '.afx-zone{position:fixed;border-radius:10px;pointer-events:none;opacity:0;',
      '  box-shadow:0 0 0 2px rgba(255,206,110,.9),0 0 26px rgba(255,170,50,.55);',
      '  animation:afx-zone 700ms ease-out forwards;}',
      '@keyframes afx-zone{0%{opacity:0}18%{opacity:1}100%{opacity:0}}',

      /* ---- the leader: band -> source ------------------------------- */
      '.afx-lead{position:fixed;height:1px;transform-origin:0 50%;pointer-events:none;opacity:0;',
      '  background:linear-gradient(90deg,rgba(255,206,110,.85),rgba(255,206,110,0));',
      '  animation:afx-lead 900ms ease-out forwards;}',
      '.afx-lead::after{content:"";position:absolute;right:-3px;top:-3px;width:6px;height:6px;',
      '  background:#ffce6e;transform:rotate(45deg);box-shadow:0 0 8px rgba(255,190,80,.9);}',
      '@keyframes afx-lead{0%{opacity:0}20%{opacity:.75}70%{opacity:.55}100%{opacity:0}}',

      /* ---- the explain band ----------------------------------------- */
      '.afx-band{position:fixed;display:flex;align-items:stretch;gap:11px;pointer-events:auto;cursor:pointer;',
      '  padding:9px 14px 9px 9px;border-radius:12px;opacity:0;will-change:transform,opacity;',
      '  background:linear-gradient(100deg,rgba(16,10,28,.94) 0%,rgba(24,15,40,.90) 46%,rgba(14,9,24,.80) 100%);',
      '  border:1px solid rgba(255,206,110,.45);',
      '  box-shadow:0 14px 40px rgba(0,0,0,.72),inset 0 1px 0 rgba(255,220,150,.16);',
      '  transform:translateY(10px) scale(.985);}',
      '.afx-band.afx-in{animation:afx-band-in var(--afx-in,190ms) cubic-bezier(.2,.9,.3,1) forwards;}',
      '.afx-band.afx-out{animation:afx-band-out var(--afx-out,230ms) ease-in forwards;}',
      '@keyframes afx-band-in{to{opacity:1;transform:translateY(0) scale(1);}}',
      '@keyframes afx-band-out{from{opacity:1;transform:translateY(0) scale(1)}',
      '  to{opacity:0;transform:translateY(-6px) scale(.99)}}',
      '.afx-band.afx-foe{border-color:rgba(255,120,96,.5);',
      '  box-shadow:0 14px 40px rgba(0,0,0,.72),inset 0 1px 0 rgba(255,160,140,.14);}',

      /* card face */
      '.afx-face{flex:none;border-radius:8px;overflow:hidden;position:relative;',
      '  background:linear-gradient(165deg,#2a1c3e,#0d0917);background-size:cover;background-position:center 22%;',
      '  box-shadow:0 0 0 1px rgba(255,206,110,.55),0 6px 16px rgba(0,0,0,.6);}',
      '.afx-face .afx-glyph{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:30px;}',
      '.afx-band.t-full .afx-face{width:78px;height:108px;}',
      '.afx-band.t-brief .afx-face{width:52px;height:72px;}',
      '.afx-band.t-flash .afx-face{width:34px;height:46px;}',

      /* text column */
      '.afx-txt{min-width:0;display:flex;flex-direction:column;justify-content:center;gap:3px;}',
      '.afx-kind{font-size:9.5px;font-weight:800;letter-spacing:.17em;text-transform:uppercase;',
      '  color:#ffce6e;display:flex;align-items:center;gap:6px;white-space:nowrap;}',
      '.afx-band.afx-foe .afx-kind{color:#ff9a86;}',
      '.afx-kind b{font-weight:800;opacity:.62;letter-spacing:.1em;}',
      '.afx-name{font-size:17px;font-weight:700;line-height:1.1;color:#fff3d8;',
      '  text-shadow:0 1px 8px rgba(0,0,0,.85);overflow:hidden;text-overflow:ellipsis;',
      '  display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;}',
      '.afx-band.t-flash .afx-name{font-size:14px;-webkit-line-clamp:1;}',
      /* FLASH keeps the hit line — it is the only part that differs between
         sightings — so it must not be the smallest thing on the band. */
      '.afx-band.t-flash .afx-hit{font-size:12px;font-weight:600;}',
      '.afx-eff{margin:1px 0 0;padding:0;list-style:none;display:flex;flex-direction:column;gap:2px;}',
      '.afx-eff li{font-family:system-ui,-apple-system,"Segoe UI",sans-serif;font-size:12px;line-height:1.32;',
      '  color:#dcd2ea;position:relative;padding-left:11px;overflow:hidden;text-overflow:ellipsis;',
      '  display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;}',
      '.afx-eff li::before{content:"";position:absolute;left:0;top:7px;width:5px;height:5px;',
      '  background:#ffce6e;transform:rotate(45deg);opacity:.9;}',
      '.afx-band.afx-foe .afx-eff li::before{background:#ff9a86;}',
      '.afx-hit{font-family:system-ui,-apple-system,"Segoe UI",sans-serif;font-size:11px;',
      '  color:#9fe6b4;letter-spacing:.02em;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}',
      '.afx-hit.afx-hurt{color:#ffab9a;}',
      '.afx-more{font-size:10px;color:#8d84a3;letter-spacing:.05em;}',

      /* chain counter — the band is the same object across a chain, so the
         LINK number is what tells you a second thing is resolving. */
      '.afx-link{flex:none;align-self:flex-start;font-size:9px;font-weight:800;letter-spacing:.12em;',
      '  color:#1b1206;background:linear-gradient(180deg,#ffd98a,#c99633);border-radius:5px;',
      '  padding:2px 6px;margin-left:6px;white-space:nowrap;}',

      /* corner ticks — same family as the chain overlay's .cc-corner */
      '.afx-c{position:absolute;width:11px;height:11px;border:1.5px solid rgba(255,206,110,.75);pointer-events:none;}',
      '.afx-c.tl{left:-1px;top:-1px;border-right:0;border-bottom:0;}',
      '.afx-c.tr{right:-1px;top:-1px;border-left:0;border-bottom:0;}',
      '.afx-c.bl{left:-1px;bottom:-1px;border-right:0;border-top:0;}',
      '.afx-c.br{right:-1px;bottom:-1px;border-left:0;border-top:0;}',

      /* ♿ Reduced motion: information, no movement. Everything still SAYS the
         same thing; nothing travels, swells, spins or sweeps. */
      '@media (prefers-reduced-motion: reduce){',
      '  .afx-pulse,.afx-ring,.afx-ghost,.afx-zone,.afx-lead,.afx-src-lit{animation:none!important;}',
      '  .afx-pulse{opacity:0!important;}.afx-ring,.afx-ghost,.afx-lead{display:none!important;}',
      '  .afx-zone{opacity:1!important;}',
      '  .afx-band{transform:none!important;}',
      '  .afx-band.afx-in{animation:afx-fade-in 100ms linear forwards!important;}',
      '  .afx-band.afx-out{animation:afx-fade-out 100ms linear forwards!important;}',
      '  @keyframes afx-fade-in{to{opacity:1}} @keyframes afx-fade-out{to{opacity:0}}',
      '}'
    ].join('');
    var st = doc.createElement('style');
    st.id = STYLE_ID;
    st.textContent = css;
    (doc.head || doc.documentElement).appendChild(st);
  }

  function root() {
    var host = mount || doc.body;
    if (!host) return null;
    var r = doc.getElementById(ROOT_ID);
    if (!r) {
      r = doc.createElement('div');
      r.id = ROOT_ID;
      host.appendChild(r);
    } else if (r.parentNode !== host) {
      host.appendChild(r);
    }
    return r;
  }

  /* ==================================================================== *
   * WHERE IS THE CARD? — zone resolution.
   *
   * Every lookup is DOM-first and read at ANNOUNCE time, while the board /
   * hand that produced the activation is still on screen. The renderer wipes
   * and rebuilds the hand on the very next paint, so a rect read later would
   * point at a card that has already gone.
   * ==================================================================== */
  /* ⚠ These are FALLBACKS. The seam in index.html always supplies `kindLabel`
     from its own `_AFX_KIND` map, so in practice nothing here is read.
     `handfoe` used to sit in this table and was assigned by nothing at all
     (`grep handfoe public/index.html` = 0) — a trap for the next editor, and
     redundant besides: the band already carries a `· ENEMY` side tag, so
     "FROM HAND · ENEMY" says it. Removed, and `hand` aligned to the seam's
     wording so the two maps cannot disagree. */
  var ZONE_LABEL = {
    field:    'ON THE FIELD',
    hand:     'FROM HAND',
    grave:    'FROM THE GRAVEYARD',
    deck:     'FROM THE DECK',
    facedown: 'FLIPPED FACE-UP',
    trap:     'TRAP SPRUNG',
    realm:    'FROM THE REALM DECK',
    void:     'FROM THE VOID',
    anywhere: 'ON ARRIVAL'
  };

  /* THE FALLBACK LOCATION for a card with no element on screen.
     Pile anchors are the ones the battle rail renders (`_slot(...)` in
     index.html: yourDeck / graveyard / foeDeck / foeGrave). Those ids are the
     contract; if the rail is ever renamed we return null and the beat runs as
     band-only rather than pointing somewhere false.

     ⚠ A zone is NEVER allowed to fall back to the acting unit's tile. Spells,
     grave abilities and hand abilities are all anchored on the side's HERO by
     the engine, so "use the caster's tile" would pulse the hero for a card the
     hero had nothing to do with — the exact confusion applyOnPlayEffect's own
     comment warns about ("reported as a hero ability by the hero it borrowed a
     position from"). */
  function zoneAnchorRect(zone, owner) {
    try {
      var foe = owner === 'ai';
      var id = null;
      if (zone === 'deck' || zone === 'realm' || zone === 'anywhere') id = foe ? 'foeDeck' : 'yourDeck';
      else if (zone === 'grave' || zone === 'void') id = foe ? 'foeGrave' : 'graveyard';
      if (id) {
        var r = rectOf(doc.getElementById(id));
        if (r) return { rect: r, from: 'pile:' + id };
      }
      if (zone === 'hand' && !foe) {
        // The hand has no pile to point at, so point at the middle of the row
        // the card was sitting in. The enemy's hand is not rendered at all and
        // deliberately gets nothing — inventing a location would be a lie, and
        // the band already says which side acted.
        var hs = rectOf(doc.querySelector('.hand-strip-cards')) || rectOf(doc.querySelector('.hand-strip'));
        if (hs) return {
          rect: { left: hs.left + hs.width / 2 - 55, top: hs.top + Math.min(30, hs.height * 0.18), width: 110, height: 154 },
          from: 'handstrip'
        };
      }
    } catch (e) {}
    return null;
  }

  /* 🔴 THE UI AUTO-SCALE. index.html puts `zoom` on <html> (clamped ~[0.78, 1])
     to fit the app to small viewports. Under CSS `zoom`:
       • getBoundingClientRect() returns VISUAL pixels (already scaled), but
       • a `top: 439px` you write is interpreted in the element's own ZOOMED
         space, so it lands at 439 × 0.78 = 344.
     Measured live at 1366×768: zoom 0.7837, band written to 439 and painted at
     344 — 95px adrift, i.e. every overlay in this file lands in the wrong place
     on any laptop narrow enough to trigger the scale. It looked perfect at
     1600×900 only because the clamp leaves zoom at 1 there.
     The fix is to work entirely in UNZOOMED css px: divide on the way in
     (here and in vw/vh), write raw on the way out. Same trick .cityloop's UI
     probe uses, so it is the established answer in this repo. */
  function uiZoom() {
    try {
      var z = parseFloat(global.getComputedStyle(doc.documentElement).zoom);
      return (z && isFinite(z) && z > 0) ? z : 1;
    } catch (e) { return 1; }
  }
  function vwPx() { return (global.innerWidth || 1280) / uiZoom(); }
  function vhPx() { return (global.innerHeight || 720) / uiZoom(); }

  function rectOf(el) {
    try {
      if (!el || !el.getBoundingClientRect) return null;
      var r = el.getBoundingClientRect();
      if (!r || !r.width || !r.height) return null;
      var z = uiZoom();
      return { left: r.left / z, top: r.top / z, width: r.width / z, height: r.height / z };
    } catch (e) { return null; }
  }

  function cssEsc(v) {
    try { return (global.CSS && global.CSS.escape) ? global.CSS.escape(v) : String(v); }
    catch (e) { return String(v); }
  }

  /* --- the four ways a card can be visible, one lookup each ------------- */
  var LOOKUP = {
    // A unit standing on the board. `pos` comes from the ACTING unit, which is
    // only the card itself for field / flip / trap / arrival activations.
    tile: function (spec) {
      if (!spec.pos || !isFinite(spec.pos.x) || !isFinite(spec.pos.y)) return null;
      var tile = doc.querySelector('.tile[data-x="' + (spec.pos.x | 0) + '"][data-y="' + (spec.pos.y | 0) + '"]');
      if (!tile) return null;
      var q = tile.querySelector('.unit') || tile.querySelector('.unit-icon') || tile;
      return rectOf(q) ? q : null;
    },
    // A card in the hand strip. It is still mounted: the renderer has not run
    // yet when the reducer's caller announces.
    hand: function (spec) {
      if (!spec.instanceId) return null;
      var q = null;
      try { q = doc.querySelector('.hand-card[data-card="' + cssEsc(spec.instanceId) + '"]'); } catch (e) { return null; }
      return (q && rectOf(q)) ? q : null;
    },
    // A card in the open graveyard viewer.
    graveview: function (spec) {
      if (!spec.graveRef) return null;
      var q = null;
      try { q = doc.querySelector('[data-grave-ref="' + cssEsc(spec.graveRef) + '"]'); } catch (e) { return null; }
      if (q && q.parentNode) q = q.parentNode;
      return (q && rectOf(q)) ? q : null;
    },
    // A persistent spell / enchantment tile in the rail.
    persistent: function (spec) {
      if (!spec.instanceId) return null;
      var q = null;
      try { q = doc.querySelector('[data-persistent="' + cssEsc(spec.instanceId) + '"]'); } catch (e) { return null; }
      return (q && rectOf(q)) ? q : null;
    }
  };

  /* WHICH lookups a zone is allowed to use, in order.
     ⚠ This is zone-FIRST on purpose. The first version tried the tile before
     everything else, and every hand ability, spell and graveyard ability
     pulsed the HERO — because the engine anchors all three on the hero unit
     and hands it to applyOnPlayEffect as the "acting unit". The pulse was
     firing, on the wrong card, which is worse than not firing. */
  var ZONE_LOOKUPS = {
    hand:     ['hand'],
    grave:    ['graveview'],
    void:     ['graveview'],
    deck:     [],
    realm:    [],
    field:    ['tile', 'persistent'],
    facedown: ['tile'],
    trap:     ['tile'],
    anywhere: ['tile']
  };

  /* 🖼 THE PULSE HAS TO LOOK LIKE THE CARD. Snapshot the source's own markup
     now — a beat later the renderer has replaced it. Without this the clone is
     an empty dark rectangle that COVERS the card it is meant to be drawing
     attention to, which the first DOM capture showed plainly.
     The whole ELEMENT, not just its children: half this game's card styling is
     descendant selectors hanging off `.hand-card` / `.unit`, so children lifted
     out of their parent lose it.
     ⚠ Then strip every identifying attribute. A clone that kept `data-card`
     would be found by the NEXT announce's own lookup, and the pulse would start
     chasing its own ghost around the screen. */
  function captureFace(spec, el) {
    try {
      if (spec.faceHtml || !el || !el.outerHTML || el.outerHTML.length > 9000) return;
      var c = el.cloneNode(true);
      ['id', 'data-card', 'data-grave-ref', 'data-persistent', 'data-unit', 'data-x', 'data-y']
        .forEach(function (a) { try { c.removeAttribute(a); } catch (e) {} });
      try {
        var kids = c.querySelectorAll('[id],[data-card],[data-grave-ref],[data-persistent],[data-x]');
        for (var i = 0; i < kids.length; i++) {
          kids[i].removeAttribute('id'); kids[i].removeAttribute('data-card');
          kids[i].removeAttribute('data-grave-ref'); kids[i].removeAttribute('data-persistent');
          kids[i].removeAttribute('data-x'); kids[i].removeAttribute('data-y');
        }
      } catch (e) {}
      c.style.cssText += ';position:static;left:auto;top:auto;right:auto;bottom:auto;' +
                         'margin:0;width:100%;height:100%;transform:none;animation:none;pointer-events:none;';
      spec.faceHtml = c.outerHTML;
    } catch (e) {}
  }

  function findSource(spec) {
    try {
      var order = ZONE_LOOKUPS[spec.zone] || ['tile'];
      for (var i = 0; i < order.length; i++) {
        var el = LOOKUP[order[i]] ? LOOKUP[order[i]](spec) : null;
        if (el) return { el: el, how: order[i] };
      }
    } catch (e) {}
    return null;
  }

  /* ==================================================================== *
   * WHERE DOES THE BAND GO? — measured, never assumed.
   * ==================================================================== */
  /* The band's WIDTH does not depend on its height, so it is decided first and
     applied before the height is measured. Measuring an unconstrained band and
     then clamping it made every height reading too small, which is how the
     first version put a band "over" the board that would have fitted above it. */
  function bandWidth() {
    return Math.min(560, Math.max(300, vwPx() * 0.36));
  }
  function bandSlot(h) {
    var vw = vwPx(), vh = vhPx();
    var board = rectOf(doc.querySelector('.board')) ||
                rectOf(doc.querySelector('.board-area')) || null;
    var pad = 10;
    var w = bandWidth();
    var slot = { left: pad, top: Math.max(pad, vh * 0.5 - h / 2), width: w, where: 'free' };
    if (!board) return slot;

    var left = board.left + 8;
    if (left + w > vw - pad) left = Math.max(pad, vw - pad - w);

    // 1. the empty environment strip ABOVE the board — obscures nothing.
    if (board.top >= h + 14) {
      return { left: left, top: Math.max(pad, board.top - h - 8), width: w, where: 'above' };
    }
    // 2. the strip BELOW the board, if the hand strip has not eaten it.
    var handTop = vh;
    var hs = rectOf(doc.querySelector('.hand-strip-cards')) || rectOf(doc.querySelector('.hand-strip'));
    /* (both already unzoomed by rectOf) */
    if (hs) handTop = hs.top;
    if (handTop - board.top - board.height >= h + 14) {
      return { left: left, top: board.top + board.height + 8, width: w, where: 'below' };
    }
    // 3. Neither gap is tall enough for the whole band, so TUCK it: sit as far
    //    up into the environment strip as the viewport allows and let only the
    //    last ~34px overhang the board's top edge. In iso-mode that edge is the
    //    furthest, smallest row, so this is the cheapest 34px on the board —
    //    and it is a far better trade than dropping the band into the middle of
    //    the play area, which is what "centre it" would do.
    var tuck = Math.max(pad, Math.min(board.top - h + 34, vh - h - pad));
    return { left: left, top: tuck, width: w, where: 'tuck', overlap: Math.max(0, tuck + h - board.top) };
  }

  /* ==================================================================== *
   * A BEAT
   * ==================================================================== */
  function Beat(spec, tier) {
    this.id = ++beatSeq;
    this.spec = spec;
    this.tier = tier;
    this.nodes = [];
    this.timers = [];
    this.done = false;
    this.onEnd = null;
    this.startedAt = 0;
  }

  Beat.prototype.after = function (ms, fn) {
    var self = this;
    var t = global.setTimeout(function () { if (!self.done) { try { fn(); } catch (e) {} } }, ms);
    this.timers.push(t);
    return t;
  };

  Beat.prototype.add = function (el) {
    var r = root();
    if (r && el) { r.appendChild(el); this.nodes.push(el); }
    return el;
  };

  /* ---- half 1: the pulse ------------------------------------------- */
  Beat.prototype.pulse = function () {
    var s = this.spec, rm = reduceMotion();
    var r = s.rect;

    if (r) {
      // Ring first, so it reads as thrown OFF the card rather than landing on it.
      if (!rm && !lowGfx()) {
        /* An OVAL that hugs the card, not a circle sized off its longest edge.
           The first version used max(w,h)*1.6, which on a 108×162 hand card
           drew a 260px circle covering the two cards either side — it pointed
           at three cards at once, which is the opposite of the job. */
        var ring = doc.createElement('div');
        ring.className = 'afx-ring';
        ring.style.left = (r.left + r.width / 2) + 'px';
        ring.style.top = (r.top + r.height / 2) + 'px';
        ring.style.width = (r.width * 1.12) + 'px';
        ring.style.height = (r.height * 1.12) + 'px';
        this.add(ring);
      }
      // The clone. A class on the live element would be wiped by the very next
      // render (the board rebuilds on every state change), so the thing that
      // animates is a copy in a fixed overlay that nothing else owns.
      var el = doc.createElement('div');
      el.className = 'afx-pulse';
      el.style.left = r.left + 'px';
      el.style.top = r.top + 'px';
      el.style.width = r.width + 'px';
      el.style.height = r.height + 'px';
      if (s.faceHtml) el.innerHTML = s.faceHtml;
      else if (s.artUrl) el.style.backgroundImage = 'url("' + String(s.artUrl).replace(/"/g, '%22') + '")';
      else el.style.background = 'linear-gradient(165deg,#2a1c3e,#0d0917)';
      this.add(el);

      // …and a 300ms kick on the LIVE element if it is still there. Costs one
      // class add; if a re-render removes it mid-flight nothing breaks.
      try {
        if (s.srcEl && s.srcEl.classList && s.srcEl.isConnected) {
          var lit = s.srcEl;
          lit.classList.add('afx-src-lit');
          this.after(320, function () { try { lit.classList.remove('afx-src-lit'); } catch (e) {} });
        }
      } catch (e) {}
    }

    // No element on screen: the card came out of a pile. Show the pile, and
    // show a ghost of the card leaving it.
    if (!r && s.anchorRect) {
      var a = s.anchorRect;
      var zf = doc.createElement('div');
      zf.className = 'afx-zone';
      zf.style.left = (a.left - 3) + 'px';
      zf.style.top = (a.top - 3) + 'px';
      zf.style.width = (a.width + 6) + 'px';
      zf.style.height = (a.height + 6) + 'px';
      this.add(zf);

      if (!rm) {
        var g = doc.createElement('div');
        g.className = 'afx-ghost';
        g.style.left = (a.left + a.width / 2 - 37) + 'px';
        g.style.top = (a.top + a.height / 2 - 52) + 'px';
        var board = rectOf(doc.querySelector('.board'));
        var gx = 0, gy = -40;
        if (board) {
          var cx = board.left + board.width / 2, cy = board.top + board.height / 2;
          var dx = cx - (a.left + a.width / 2), dy = cy - (a.top + a.height / 2);
          var len = Math.sqrt(dx * dx + dy * dy) || 1;
          gx = Math.round(dx / len * 46); gy = Math.round(dy / len * 46);
        }
        g.style.setProperty('--afx-gx', gx + 'px');
        g.style.setProperty('--afx-gy', gy + 'px');
        var gArt = s.hidden ? null : (s.artUrl || s.frameUrl);
        if (gArt) g.style.backgroundImage = 'url("' + String(gArt).replace(/"/g, '%22') + '")';
        g.innerHTML = '<i>' + esc(s.hidden ? '???' : (s.name || 'CARD')).toUpperCase().slice(0, 16) + '</i>';
        this.add(g);
      }
    }
  };

  /* ---- half 2: the explain ------------------------------------------ */
  Beat.prototype.explain = function () {
    var s = this.spec, self = this;
    var d = TIER[this.tier] || TIER.full;

    var band = doc.createElement('div');
    band.className = 'afx-band t-' + this.tier + (s.owner === 'ai' ? ' afx-foe' : '');
    band.style.setProperty('--afx-in', d.in + 'ms');
    band.style.setProperty('--afx-out', d.out + 'ms');

    /* Three tiers of face, best available: the card's illustration; failing
       that its FRAME png with the card's icon in the window; failing that the
       icon alone. Never a bare dark rectangle. */
    var faceStyle = '', glyph = '';
    if (s.artUrl && !s.hidden) {
      faceStyle = ' style="background-image:url(&quot;' + esc(s.artUrl) + '&quot;)"';
    } else if (s.frameUrl && !s.hidden) {
      faceStyle = ' style="background-image:url(&quot;' + esc(s.frameUrl) + '&quot;);background-size:100% 100%;background-position:center"';
      glyph = '<span class="afx-glyph">' + esc(s.icon || '⚡') + '</span>';
    } else {
      glyph = '<span class="afx-glyph">' + esc(s.hidden ? '🂠' : (s.icon || '⚡')) + '</span>';
    }

    /* 🔴 ROUND 2 — FLASH USED TO DISCARD THE WRONG HALF.
       It dropped both the effect text AND the hit line and kept only the name,
       which is the one thing the pulse has already told the player and the one
       thing that is IDENTICAL on every sighting. The effect text genuinely is
       redundant by the fourth firing — "deals 7 damage to every enemy within 2
       tiles" does not change. WHO it hit and for how much changes every single
       time. So FLASH now drops the prose and keeps the `➜` line. */
    var lines = (s.effects || []).filter(Boolean);
    var showLines = this.tier === 'full' ? lines.slice(0, 3)
                  : this.tier === 'brief' ? lines.slice(0, 1) : [];
    var moreN = lines.length - showLines.length;

    var effHtml = showLines.length
      ? '<ul class="afx-eff">' + showLines.map(function (t) {
          return '<li>' + esc(String(t).slice(0, 190)) + '</li>';
        }).join('') + (moreN > 0 ? '<li class="afx-more">+' + moreN + ' more</li>' : '') + '</ul>'
      : '';

    var hitHtml = '';
    if (s.hit && s.hit.text) {
      hitHtml = '<div class="afx-hit' + (s.hit.hostile ? ' afx-hurt' : '') + '">'
              + esc(s.hit.text) + '</div>';
    }
    /* A flash beat with a hit line needs a moment longer than a bare name.
       ⚠ `run()` computes the beat's total AFTER explain() returns, and reads
       `holdBonus` — set it here, not by shadowing `d`, or the band would be
       torn down before the extra hold it just scheduled had elapsed. */
    if (this.tier === 'flash' && hitHtml) { this.holdBonus = 220; d = { in: d.in, hold: d.hold + 220, out: d.out }; }

    var linkHtml = (s.chainLen > 1)
      ? '<div class="afx-link">LINK ' + (s.chainIndex + 1) + '/' + s.chainLen + '</div>' : '';

    var side = s.owner === 'ai' ? 'ENEMY' : 'YOU';
    band.innerHTML =
      '<span class="afx-c tl"></span><span class="afx-c tr"></span>' +
      '<span class="afx-c bl"></span><span class="afx-c br"></span>' +
      '<div class="afx-face"' + faceStyle + '>' + glyph + '</div>' +
      '<div class="afx-txt">' +
        '<div class="afx-kind">⚡ ' + esc(s.kindLabel || 'ACTIVATED') +
          ' <b>· ' + side + '</b></div>' +
        '<div class="afx-name">' + esc(s.hidden ? 'Enemy card' : (s.name || 'Card')) + '</div>' +
        effHtml + hitHtml +
      '</div>' + linkHtml;

    // Measure, then place. `visibility:hidden` first so a mis-measured band is
    // never seen in the wrong spot for one frame.
    band.style.visibility = 'hidden';
    band.style.left = '-9999px';
    band.style.top = '0px';
    band.style.maxWidth = Math.round(bandWidth()) + 'px';
    this.add(band);
    // rectOf, not getBoundingClientRect — the band's own measurement lives in
    // the same unzoomed space as the board's.
    var h = 0, w = 0;
    var br = rectOf(band);
    if (br) { h = br.height || 96; w = br.width || 340; } else { h = 96; w = 340; }
    var slot = bandSlot(h);
    band.style.left = Math.round(slot.left) + 'px';
    band.style.top = Math.round(slot.top) + 'px';
    band.style.visibility = '';
    band.classList.add('afx-in');
    this.bandSlotWhere = slot.where;
    this.bandOverlap = slot.overlap || 0;
    this.bandRect = { left: Math.round(slot.left), top: Math.round(slot.top), width: Math.min(w, slot.width), height: h };

    // Clicking the band dismisses it. It is the only pointer-enabled node in
    // the overlay, so this can never swallow a click meant for the board.
    band.addEventListener('click', function (ev) {
      try { ev.stopPropagation(); } catch (e) {}
      self.finish('click');
    });

    // The leader: band -> the thing that activated. Only when we actually know
    // where that was, and only when it is far enough away to be worth drawing.
    var anchor = s.rect || s.anchorRect;
    if (anchor && !reduceMotion() && !lowGfx()) {
      try {
        var bx = Math.round(slot.left) + Math.min(w, slot.width) * 0.5;
        var by = Math.round(slot.top) + h;
        var tx = anchor.left + anchor.width / 2, ty = anchor.top + anchor.height / 2;
        var dx = tx - bx, dy = ty - by;
        var len = Math.sqrt(dx * dx + dy * dy);
        if (len > 90) {
          var lead = doc.createElement('div');
          lead.className = 'afx-lead';
          lead.style.left = bx + 'px';
          lead.style.top = by + 'px';
          lead.style.width = Math.round(len) + 'px';
          lead.style.transform = 'rotate(' + (Math.atan2(dy, dx) * 180 / Math.PI) + 'deg)';
          this.add(lead);
        }
      } catch (e) {}
    }

    this.after(d.in + d.hold, function () {
      try { band.classList.remove('afx-in'); band.classList.add('afx-out'); } catch (e) {}
    });
  };

  Beat.prototype.run = function (onEnd) {
    var self = this;
    this.onEnd = onEnd;
    this.startedAt = now();
    try { ensureStyle(); } catch (e) {}
    /* ⛓ A chain beat has to out-rank the CHAIN overlay (a full-screen tinted
       modal at 2147483290) or the per-link explanation resolves underneath the
       very panel that announced the chain. Still below the ability cinematic
       (…380), which is a deliberate full-takeover moment. */
    try {
      var r0 = root();
      if (r0) r0.style.zIndex = (this.spec.chainLen > 1) ? '2147483300' : '';
    } catch (e) {}
    try { this.pulse(); } catch (e) { try { console.warn('[ActivateFX] pulse', e); } catch (_) {} }
    if (!this.spec.pulseOnly) {
      try { this.explain(); } catch (e) { try { console.warn('[ActivateFX] explain', e); } catch (_) {} }
    }
    var d = TIER[this.tier] || TIER.full;
    var total = this.spec.pulseOnly ? PULSE_MS
              : Math.max(PULSE_MS, d.in + d.hold + (this.holdBonus | 0) + d.out);
    if (reduceMotion()) total = RM_TOTAL;
    this.after(total, function () { self.finish('schedule'); });
    // Watchdog — independent of the schedule above, so a cleared/lost timer
    // can never leave the overlay on screen.
    this.watchdog = global.setTimeout(function () { self.finish('watchdog'); }, total + WATCHDOG_PAD);
    return total;
  };

  Beat.prototype.finish = function (why) {
    if (this.done) return;
    this.done = true;
    try { global.clearTimeout(this.watchdog); } catch (e) {}
    for (var i = 0; i < this.timers.length; i++) { try { global.clearTimeout(this.timers[i]); } catch (e) {} }
    this.timers.length = 0;
    for (var j = 0; j < this.nodes.length; j++) {
      try { if (this.nodes[j] && this.nodes[j].parentNode) this.nodes[j].parentNode.removeChild(this.nodes[j]); } catch (e) {}
    }
    this.nodes.length = 0;
    try {
      trace.push({ id: this.id, name: this.spec.name, zone: this.spec.zone, tier: this.tier,
                   why: why, at: Math.round(this.startedAt), where: this.bandSlotWhere || null,
                   pulsed: !!(this.spec.rect || this.spec.anchorRect),
                   effects: (this.spec.effects || []).length });
      if (trace.length > 40) trace.shift();
    } catch (e) {}
    if (live === this) live = null;      // a finished beat is never "the live one"
    var cb = this.onEnd; this.onEnd = null;
    if (cb) { try { cb(); } catch (e) {} }
  };

  /* ==================================================================== *
   * THE QUEUE — one beat at a time, so a chain reads as a sequence.
   * ==================================================================== */
  function pump() {
    if (live && !live.done) return;
    live = null;
    if (!queue.length) { chainStartedAt = 0; return; }
    if (!chainStartedAt) chainStartedAt = now();

    // Over budget: collapse whatever is left into a single closing beat rather
    // than making the player watch a nine-link chain frame by frame.
    var elapsed = now() - chainStartedAt;
    if (queue.length > MAX_QUEUE || elapsed > CHAIN_BUDGET_MS) {
      var rest = queue.splice(0, queue.length);
      var first = rest[0];
      first.spec.effects = [ rest.length + ' effects resolve in one chain.' ];
      first.spec.name = first.spec.name + (rest.length > 1 ? ' +' + (rest.length - 1) + ' more' : '');
      first.tier = 'flash';
      queue = [first];
    }

    var beat = queue.shift();
    live = beat;
    beat.run(function () {
      live = null;
      if (queue.length) global.setTimeout(pump, GAP_MS);
      else chainStartedAt = 0;
    });
  }

  /* Signature for "have I already shown this?" — the CARD plus WHICH effect,
     so a card with two different abilities explains both the first time each
     is used, and a card fired twice for the same reason gets shorter. */
  function sigOf(spec) {
    return String(spec.cardId || spec.name || '?') + '|' + String(spec.sig || (spec.effects || []).join('~')).slice(0, 120);
  }

  function tierFor(spec) {
    if (spec.forceTier && TIER[spec.forceTier]) return spec.forceTier;
    var k = sigOf(spec);
    var n = seen[k] | 0;
    seen[k] = n + 1;
    if (n === 0) return 'full';
    if (n < 3) return 'brief';
    return 'flash';
  }

  /* ==================================================================== *
   * API
   * ==================================================================== */
  var API = {
    version: VERSION,

    /* The one entry point. Called from inside the reducer's caller, AFTER the
       state has landed. Cannot throw, returns a beat id or null.

       spec: { name, cardId, icon, artUrl, owner, zone, kindLabel,
               effects:[String], hit:{text,hostile}, sig,
               pos:{x,y}, instanceId, graveRef,      <- where to look for it
               chainIndex, chainLen, hidden, pulseOnly, forceTier } */
    announce: function (spec) {
      try {
        if (!spec || !doc.body) return null;
        ensureStyle();
        spec = Object.assign({}, spec);
        spec.owner = spec.owner === 'ai' ? 'ai' : 'player';
        spec.zone = spec.zone || 'field';
        spec.effects = Array.isArray(spec.effects) ? spec.effects.filter(Boolean) : [];
        spec.chainIndex = spec.chainIndex | 0;
        spec.chainLen = spec.chainLen | 0;
        if (!spec.kindLabel) spec.kindLabel = ZONE_LABEL[spec.zone] || 'ACTIVATED';

        /* Read the DOM NOW. The renderer is about to rebuild the hand and the
           board; a rect read one paint later points at nothing. */
        var src = findSource(spec);
        if (src) {
          spec.srcEl = src.el;
          spec.rect = rectOf(src.el);
          spec.foundBy = src.how;
          /* 🖼 THE PULSE HAS TO LOOK LIKE THE CARD. Snapshot the source's own
             markup now — a beat later the renderer has replaced it. Without
             this the clone is an empty dark rectangle that COVERS the card it
             is supposed to be drawing attention to, which the first capture
             showed plainly. Capped: a pathological subtree is not worth
             cloning, and the frame/art fallback below still reads. */
          captureFace(spec, src.el);
        }
        if (!spec.rect) {
          var a = zoneAnchorRect(spec.zone, spec.owner);
          if (a) { spec.anchorRect = a.rect; spec.foundBy = a.from; }
          else spec.foundBy = 'none';
        }
        /* Nothing on screen at all AND no pile to point at: we still run the
           band (the player must learn what resolved) but there is nothing
           honest to pulse, so we do not invent a location. */

        var beat = new Beat(spec, tierFor(spec));
        queue.push(beat);
        // A macrotask, never inline: the caller is mid-assembly and may still
        // be writing App.state. Nothing here depends on that, but starting an
        // animation from inside a reducer's stack is how continuations get
        // stranded, and this module refuses to be in that position at all.
        global.setTimeout(pump, 0);
        return beat.id;
      } catch (e) {
        try { console.warn('[ActivateFX] announce', e); } catch (_) {}
        return null;
      }
    },

    /* End the beat playing right now. The next one starts immediately. */
    skip: function () {
      try { if (live) live.finish('skip'); } catch (e) {}
    },

    /* End everything and drop the queue. Board state is untouched by design —
       nothing downstream of these animations exists. */
    skipAll: function () {
      try {
        var q = queue.splice(0, queue.length);
        for (var i = 0; i < q.length; i++) { try { q[i].finish('skipAll'); } catch (e) {} }
        if (live) live.finish('skipAll');
      } catch (e) {}
    },

    resetMatch: function () {
      seen = Object.create(null);
      try { API.skipAll(); } catch (e) {}
      trace.length = 0;
    },

    teardown: function () {
      try { API.skipAll(); } catch (e) {}
      live = null; queue.length = 0; chainStartedAt = 0;
      try { var r = doc.getElementById(ROOT_ID); if (r && r.parentNode) r.parentNode.removeChild(r); } catch (e) {}
      try { var s = doc.getElementById(STYLE_ID); if (s && s.parentNode) s.parentNode.removeChild(s); } catch (e) {}
    },

    setMount: function (el) { mount = el || null; },

    isPlaying: function () { return !!(live && !live.done); },

    timings: function () {
      return { pulse: PULSE_MS, tiers: TIER, gap: GAP_MS, chainBudget: CHAIN_BUDGET_MS,
               reducedMotionTotal: RM_TOTAL, totals: { full: tierMs('full'), brief: tierMs('brief'), flash: tierMs('flash') } };
    },

    /* Everything a probe needs, and nothing a probe has to guess. */
    debug: function () {
      return {
        version: VERSION,
        playing: (live && !live.done) ? { id: live.id, name: live.spec.name, zone: live.spec.zone, tier: live.tier,
                          where: live.bandSlotWhere || null, overlap: live.bandOverlap || 0,
                          bandRect: live.bandRect || null, foundBy: live.spec.foundBy,
                          rect: live.spec.rect || null, anchorRect: live.spec.anchorRect || null } : null,
        queued: queue.map(function (b) { return { id: b.id, name: b.spec.name, zone: b.spec.zone, tier: b.tier }; }),
        nodes: (function () { var r = doc.getElementById(ROOT_ID); return r ? r.children.length : 0; })(),
        seen: Object.keys(seen).length,
        trace: trace.slice()
      };
    },

    /* --- testing only: build one beat and hold it, so a static capture of
       the DOM shows the band and the pulse in their settled pose. --- */
    _pose: function (spec) {
      try {
        API.skipAll();
        ensureStyle();
        var sp = Object.assign({ forceTier: 'full' }, spec || {});
        var src = findSource(sp);
        if (src) { sp.srcEl = src.el; sp.rect = rectOf(src.el); sp.foundBy = src.how; captureFace(sp, src.el); }
        if (!sp.rect) { var a = zoneAnchorRect(sp.zone, sp.owner); if (a) { sp.anchorRect = a.rect; sp.foundBy = a.from; } else sp.foundBy = 'none'; }
        sp.owner = sp.owner === 'ai' ? 'ai' : 'player';
        sp.effects = Array.isArray(sp.effects) ? sp.effects : [];
        sp.kindLabel = sp.kindLabel || ZONE_LABEL[sp.zone] || 'ACTIVATED';
        var b = new Beat(sp, sp.forceTier);
        live = b;
        b.pulse(); b.explain();
        for (var i = 0; i < b.timers.length; i++) { try { global.clearTimeout(b.timers[i]); } catch (e) {} }
        b.timers.length = 0;
        // Freeze the pulse clone mid-swell so a still frame shows the hit pose.
        try {
          var p = doc.querySelector('#' + ROOT_ID + ' .afx-pulse');
          if (p) { p.style.animation = 'none'; p.style.opacity = '1'; p.style.transform = 'scale(1.16)'; }
          var bd = doc.querySelector('#' + ROOT_ID + ' .afx-band');
          if (bd) { bd.style.animation = 'none'; bd.style.opacity = '1'; bd.style.transform = 'none'; }
          var rg = doc.querySelector('#' + ROOT_ID + ' .afx-ring');
          if (rg) { rg.style.animation = 'none'; rg.style.opacity = '.9'; rg.style.transform = 'translate(-50%,-50%) scale(1.1)'; }
          var gh = doc.querySelector('#' + ROOT_ID + ' .afx-ghost');
          if (gh) { gh.style.animation = 'none'; gh.style.opacity = '1'; }
          var zf = doc.querySelector('#' + ROOT_ID + ' .afx-zone');
          if (zf) { zf.style.animation = 'none'; zf.style.opacity = '1'; }
          var ld = doc.querySelector('#' + ROOT_ID + ' .afx-lead');
          if (ld) { ld.style.animation = 'none'; ld.style.opacity = '.7'; }
        } catch (e) {}
        return { id: b.id, where: b.bandSlotWhere, foundBy: sp.foundBy, rect: sp.rect || null, anchorRect: sp.anchorRect || null };
      } catch (e) { return { error: String(e && e.message || e) }; }
    }
  };

  try { if (global.ActivateFX && global.ActivateFX.teardown) global.ActivateFX.teardown(); } catch (e) {}
  try { console.info('[ActivateFX] loaded — ' + VERSION); } catch (e) {}
  global.ActivateFX = API;
})(typeof window !== 'undefined' ? window : this);
