/* ============================================================================
 * FEBattle — Fire Emblem style combat cut-away.        round 1 / piece: combat
 * ----------------------------------------------------------------------------
 * Replaces the old screen-quake (`mdQuake` / `body.bfx-quake` / `.mdquake-flash`)
 * with a real cut-away: play pauses, the camera pushes in on the two combatants,
 * the strike plays with anticipation and follow-through, damage lands on a held
 * hit frame, then the camera pulls back out.
 *
 *   window.FEBattle.play({ attacker, defender, damage, killed, crit })  -> Promise
 *   window.FEBattle.teardown()
 *
 * 🔴 THE BOARD CONSTRAINT (.battleloop/_BAR.md)
 * `.board` is deliberately FLAT and nothing here touches it. Not one selector in
 * this file mentions `.board`, `.tile` or `.unit`; there is no `perspective`, no
 * `rotateX` and no `transform-style` anywhere. The camera is a `scale()` plus a
 * `transform-origin` on ONE absolutely-positioned overlay layer (`.febx-cam`)
 * composited ABOVE the board. The board is read exactly twice per sequence —
 * one `getBoundingClientRect()` per combatant, at build time, to learn where on
 * screen the fight is happening so the camera can push in *from* there. (A third
 * rect is read for the overlay host, which is not the board.) After that the
 * board is never read, written or animated again.
 *
 * PERFORMANCE
 * Only `transform` and `opacity` are animated, and only on overlay nodes. No
 * requestAnimationFrame loop, no per-frame layout reads, no width/height/top/left
 * animation, no blend modes. The one exception is a 90ms `filter` transition on
 * the defender's portrait — the white hit flash — which is a single overlay
 * node. The scrim's `backdrop-filter` is a static value (never animated) and is
 * dropped entirely on low-core devices. Node count is a fixed ~30 regardless of
 * board size, and every one of them is removed when the sequence ends.
 *
 * NEVER HANGS — five independent routes reach one idempotent `finish()`; see
 * `run()`. The returned promise never rejects.
 * ==========================================================================*/
(function (global) {
  'use strict';
  if (!global || typeof global.document === 'undefined') return;

  var doc = global.document;
  var VERSION = 'r1-combat-1.0.0';
  var STYLE_ID = 'febx-style';
  var ROOT_ID = 'febx-root';

  /* ------------------------------------------------------------------ *
   * TIMING. Every value is a duration in ms; the marks are derived, so
   * the schedule can never drift out of step with the CSS.
   *
   *   normal hit .......... 1140ms
   *   crit ................ 1330ms   (+90 wind hold, +70 impact hold, +30 out)
   *   kill ................ 1380ms   (+200 settle, +40 out)
   *   crit + kill ......... 1570ms   (still under the ~1.6s ceiling)
   *   reduced motion ......  360ms
   * ------------------------------------------------------------------ */
  /* 🐢 PACE — "too fast, give people a chance to see what happened."
     Applied as ONE multiplier over every beat so the RATIO between them is
     preserved exactly. The weight of the hit comes from STRIKE being the
     shortest beat and HOLD roughly doubling it; scaling each number by hand
     would drift that balance and the punch would go soft. */
  var PACE = 1.9;
  var DUR = {
    IN: Math.round(180 * PACE),      // camera push-in
    WIND: Math.round(160 * PACE),    // anticipation — the attacker draws back
    STRIKE: Math.round(90 * PACE),   // the lunge; still the shortest beat
    HOLD: Math.round(180 * PACE),    // ⭐ the HIT FRAME HOLD — the weight lives here
    SETTLE: Math.round(330 * PACE),  // follow-through, hp drain, the number reads
    OUT: Math.round(200 * PACE)      // camera pull-out
  };
  var CRIT_WIND = Math.round(90 * PACE), CRIT_HOLD = Math.round(70 * PACE), CRIT_OUT = Math.round(30 * PACE);
  var KILL_SETTLE = Math.round(200 * PACE), KILL_OUT = Math.round(40 * PACE);
  var RM_TOTAL = 360;          // reduced-motion total
  var SKIP_ARM = 150;          // ignore input this long — the click that ordered
                               // the attack must not skip the animation it began
  var SKIP_FADE = 110;         // how fast a skipped sequence leaves the screen

  function marks(crit, killed) {
    var m = {};
    m.wind = DUR.IN;
    m.strike = m.wind + DUR.WIND + (crit ? CRIT_WIND : 0);
    m.hit = m.strike + DUR.STRIKE;
    m.settle = m.hit + DUR.HOLD + (crit ? CRIT_HOLD : 0);
    m.out = m.settle + DUR.SETTLE + (killed ? KILL_SETTLE : 0);
    m.end = m.out + DUR.OUT + (crit ? CRIT_OUT : 0) + (killed ? KILL_OUT : 0);
    return m;
  }

  /* ================================================================== *
   * STYLE — injected once, idempotently.
   * ================================================================== */
  var CSS = [
    /* ---- root / stage -------------------------------------------- */
    '#' + ROOT_ID + '{position:fixed;inset:0;z-index:4200;overflow:hidden;',
    '  pointer-events:auto;cursor:pointer;contain:layout paint;',
    '  font-family:"Cinzel",Georgia,serif;-webkit-font-smoothing:antialiased;}',
    '#' + ROOT_ID + '.febx-inline{position:absolute;}',
    '#' + ROOT_ID + ' *{box-sizing:border-box;}',

    /* ---- scrim: how "everything else recedes" without moving it ---- */
    /* The gradient alone must be dark enough to bury the board, because the
       blur is a progressive enhancement that low-power devices never get. */
    '.febx-scrim{position:absolute;inset:0;opacity:0;transition:opacity 140ms linear;',
    /* ⚠ Dark BASE, not just a backdrop-filter. The filter is dropped on <=4-core
       devices and the frame then washed out in real play — reported from the
       game. The gradient below must carry the contrast on its own. */
    '.febx-scrim{background:radial-gradient(ellipse 70% 58% at 50% 50%,rgba(6,5,10,.86),rgba(2,2,5,.95) 55%,rgba(0,0,0,.985));}',
    '  background:radial-gradient(ellipse 68% 56% at 50% 50%,rgba(8,4,2,.82),rgba(3,1,0,.93) 58%,rgba(0,0,0,.98));}',
    '.febx-blur .febx-scrim{-webkit-backdrop-filter:blur(8px) saturate(.45) brightness(.4);',
    '  backdrop-filter:blur(8px) saturate(.45) brightness(.4);',
    '  background:radial-gradient(ellipse 68% 56% at 50% 50%,rgba(8,4,2,.56),rgba(3,1,0,.84) 58%,rgba(0,0,0,.95));}',
    /* ⚠ A crit is the most violent thing on screen, so its surround is the
       DARKEST — the white-hot numeral needs black to punch against, not amber.
       Ordering matters here: these must follow .febx-blur to win the cascade. */
    '.febx-crit .febx-scrim{background:radial-gradient(ellipse 68% 56% at 50% 50%,rgba(12,2,2,.90),rgba(2,0,0,.96) 54%,rgba(0,0,0,.99));}',
    '.febx-kill .febx-scrim{background:radial-gradient(ellipse 68% 56% at 50% 50%,rgba(74,8,2,.80),rgba(9,1,0,.94) 56%,rgba(0,0,0,.99));}',

    /* ---- letterbox bars ------------------------------------------- */
    '.febx-bar{position:absolute;left:0;right:0;height:9%;',
    '  transform:translate3d(0,-100%,0);transition:transform 190ms cubic-bezier(.16,.84,.3,1);}',
    '.febx-bar.t{top:0;background:linear-gradient(#000,rgba(0,0,0,.86));box-shadow:0 2px 0 rgba(255,190,90,.16);}',
    '.febx-bar.b{bottom:0;background:linear-gradient(rgba(0,0,0,.86),#000);',
    '  transform:translate3d(0,100%,0);box-shadow:0 -2px 0 rgba(255,190,90,.16);}',

    /* ---- 🎥 THE CAMERA. One layer, one transform, origin = the fight. */
    '.febx-cam{position:absolute;inset:0;opacity:0;transform:scale(.26);',
    '  transition:transform 180ms cubic-bezier(.14,.86,.3,1),opacity 150ms linear;',
    '  will-change:transform,opacity;}',
    /* the hit punch/shake is a SEPARATE nested layer so it can never fight
       the push-in transition running on the camera above it */
    '.febx-shake{position:absolute;inset:0;transform:translateZ(0);will-change:transform;}',

    /* ---- arena dressing: static paint only, nothing here animates -- */
    '.febx-ground{position:absolute;left:-10%;right:-10%;top:62%;bottom:2%;',
    '  background:radial-gradient(ellipse 52% 90% at 50% 0%,rgba(255,146,56,.13),transparent 68%),',
    '  linear-gradient(rgba(30,18,10,.62),rgba(6,4,2,0));}',
    '.febx-horizon{position:absolute;left:16%;right:16%;top:62%;height:2px;opacity:.55;',
    '  background:linear-gradient(90deg,transparent,rgba(255,196,110,.5),transparent);}',
    '.febx-lines{position:absolute;inset:-20% -60%;opacity:0;transform:translate3d(0,0,0);',
    '  transition:opacity 120ms linear,transform 130ms linear;',
    '  background:repeating-linear-gradient(90deg,rgba(255,236,205,.20) 0 3px,transparent 3px 26px);',
    '  -webkit-mask-image:radial-gradient(ellipse 46% 40% at 50% 50%,#000,transparent 72%);',
    '  mask-image:radial-gradient(ellipse 46% 40% at 50% 50%,#000,transparent 72%);}',

    /* ---- combatants ------------------------------------------------ */
    /* ── COLLISION GEOMETRY ──────────────────────────────────────────────
       One focal point, the way the reference does it: the swirl and the red
       1200 are the same event in the same place. Everything below is derived
       from that, so do not move one number without the others.
         figure half-width .......... 9% of W  (--figs is .18W, capped by H)
         attacker rest centre ....... 20%      spans 11%..29%
         defender centre ............ 62%      spans 53%..71%
         attacker travels ........... .24W  -> centre 44%, leading edge 53%
         => CONTACT at 53%, i.e. all but dead centre of the frame.
         The burst sits on 53% and the numeral on 50%, so the impact and the
         number are one event in one place, the way the reference does it.
       The previous pass resolved the strike at 78% with the numeral at 50%:
       two competing focal points and a dead lower-left quadrant, because the
       attacker had left the left half of the frame entirely. */
    '.febx-side{position:absolute;top:50%;width:var(--figs);height:var(--figs);',
    '  margin-top:calc(var(--figs) / -2);margin-left:calc(var(--figs) / -2);}',
    '.febx-side.a{left:26%;}',
    '.febx-side.d{left:68%;}',
    '.febx-shadow{position:absolute;left:4%;right:4%;bottom:-7%;height:17%;border-radius:50%;',
    '  background:radial-gradient(ellipse at 50% 50%,rgba(0,0,0,.75),transparent 68%);}',
    '.febx-fig{position:absolute;inset:0;transform:translate3d(0,0,0);will-change:transform;',
    '  transition:transform 180ms cubic-bezier(.2,.7,.3,1);}',
    '.febx-art{position:absolute;inset:-14%;display:flex;align-items:center;justify-content:center;',
    '  transition:opacity 240ms linear,transform 260ms ease-in,filter 90ms linear;}',
    /* ⚠ WAS max-width/max-height with width:auto — which renders the image at its
       NATURAL size and only ever SHRINKS it. It never upscales. Board sprite
       frames in this library are tiny (measured canvases like 75x96, 43x66),
       so a 75px sprite drew at 75px inside a 734px figure box, and every
       --figs increase was enlarging an empty box. Filling the box with
       object-fit:contain keeps the aspect and actually uses the space.
       Small sources will soften when upscaled; unreadably small is worse. */
    '.febx-art img{width:100%;height:100%;object-fit:contain;object-position:center bottom;',
    '  filter:drop-shadow(0 10px 18px rgba(0,0,0,.7));}',
    /* 🎞 stacked reel — .febx-art is display:flex, so frames must be taken out of
       flow or they lay out side by side at 1/N width each. */
    '.febx-art.reel img{position:absolute;top:0;left:0;right:0;bottom:0;opacity:0;}',
    '.febx-art.reel img.on{opacity:1;}',
    /* glyph fallback (no sprite uploaded): a struck medallion, not a bare letter */
    '.febx-art .febx-glyph{display:flex;align-items:center;justify-content:center;transform:scale(1.34);',
    '  width:76%;height:76%;border-radius:50%;',
    '  font-size:calc(var(--figs) * .38);line-height:1;font-weight:900;',
    '  color:#f3e3c2;text-shadow:0 3px 0 rgba(0,0,0,.75),0 0 22px rgba(255,180,80,.55);',
    '  background:radial-gradient(circle at 50% 34%,rgba(72,54,30,.95),rgba(18,12,6,.98) 70%);',
    '  border:2px solid rgba(240,196,110,.5);',
    '  box-shadow:inset 0 0 26px rgba(255,170,70,.28),0 12px 26px rgba(0,0,0,.75);}',
    /* only a real sprite gets mirrored to face the other side — mirroring a
       glyph or a letter just produces a backwards character */
    '.febx-side.d .febx-art.img{transform:scaleX(-1);}',
    '.febx-fig.flash .febx-art{filter:brightness(4) saturate(0) contrast(1.4);}',
    /* a kill: silhouette, then dissolve away — clearly not a survivable hit */
    '.febx-side.dead .febx-art{opacity:0;transform:scale(.84) rotate(-9deg) translateY(10%);',
    '  filter:brightness(.05) drop-shadow(0 0 26px rgba(255,44,12,.95));}',
    '.febx-side.d.dead .febx-art.img{transform:scaleX(-1) scale(.84) rotate(9deg) translateY(10%);}',
    '.febx-side.dead .febx-shadow{opacity:0;transition:opacity 240ms linear;}',

    /* the charge glow that gathers behind the attacker during the wind-up */
    '.febx-charge{position:absolute;inset:-30%;opacity:0;transform:scale(.6);pointer-events:none;',
    '  transition:opacity 130ms linear,transform 150ms cubic-bezier(.2,.8,.3,1);',
    '  background:radial-gradient(circle at 50% 52%,rgba(255,210,130,.55),rgba(255,120,30,.22) 42%,transparent 68%);}',

    /* ---- name / stat plates. Chrome stays out of the middle. ------- */
    '.febx-plate{position:absolute;top:calc(50% + var(--figs) * .58);width:32%;',
    '  padding:.30em .7em;border-radius:6px;opacity:0;transform:translate3d(0,8px,0);',
    '  transition:opacity 150ms linear,transform 190ms cubic-bezier(.16,.84,.3,1);',
    '  background:linear-gradient(180deg,rgba(24,17,8,.84),rgba(0,0,0,.84));',
    '  border:1px solid rgba(240,196,110,.34);box-shadow:0 6px 20px rgba(0,0,0,.6);',
    '  font-size:calc(var(--num) * .155);color:#f6e8cd;text-shadow:0 2px 4px #000;',
    '  display:flex;justify-content:space-between;align-items:baseline;gap:.8em;}',
    '.febx-plate.a{left:3%;}',
    '.febx-plate.d{right:3%;}',
    '.febx-plate .n{font-weight:800;letter-spacing:.02em;overflow:hidden;',
    '  white-space:nowrap;text-overflow:ellipsis;}',
    '.febx-plate .v{font-weight:900;color:#ffd479;font-variant-numeric:tabular-nums;}',
    '.febx-plate.d .v{color:#8fe6ff;}',
    '.febx-hp{position:absolute;left:.4em;right:.4em;bottom:-7px;height:4px;border-radius:3px;',
    '  background:rgba(0,0,0,.72);overflow:hidden;box-shadow:0 0 0 1px rgba(0,0,0,.6);}',
    '.febx-hp i{display:block;height:100%;width:100%;transform-origin:0 50%;transform:scaleX(1);',
    '  transition:transform 300ms cubic-bezier(.2,.7,.3,1);',
    '  background:linear-gradient(90deg,#57e08a,#b7f36a);}',
    '.febx-hp i.low{background:linear-gradient(90deg,#ff5a34,#ffb03a);}',

    /* ---- impact ---------------------------------------------------- */
    '.febx-flash{position:absolute;inset:0;opacity:0;background:#fff6e8;}',
    '.febx-flash.on{animation:febxFlash 150ms linear forwards;}',
    '@keyframes febxFlash{0%{opacity:0}8%{opacity:.9}100%{opacity:0}}',

    /* the burst is centred on the CONTACT point, not on the defender */
    '.febx-burst{position:absolute;top:56%;left:53%;',
    '  width:calc(var(--figs) * 2.1);height:calc(var(--figs) * 2.1);',
    '  margin:calc(var(--figs) * -1.05) 0 0 calc(var(--figs) * -1.05);opacity:0;transform:scale(.25);',
    '  background:radial-gradient(circle at 50% 50%,rgba(255,255,238,.95),rgba(255,178,60,.55) 26%,',
    '    rgba(255,60,20,.28) 46%,transparent 66%);}',
    /* a crit's burst is a hot white core inside a DARK red halo, not a soft
       amber bloom — it has to leave room for the numeral to be the brightest
       thing in the frame */
    '.febx-crit .febx-burst{background:radial-gradient(circle at 50% 50%,rgba(255,255,255,1),',
    '  rgba(255,96,32,.62) 17%,rgba(146,10,0,.55) 37%,rgba(34,0,0,.4) 54%,transparent 70%);}',
    '.febx-burst.on{animation:febxBurst 420ms cubic-bezier(.14,.86,.3,1) forwards;}',
    '@keyframes febxBurst{0%{opacity:1;transform:scale(.22)}42%{opacity:.95;transform:scale(1.05)}',
    '  100%{opacity:0;transform:scale(1.55)}}',

    /* the streak runs from where the attacker started to where it connects:
       spans 17%..59%, so its bright end terminates on the contact point */
    '.febx-slash{position:absolute;top:50%;left:32%;width:42%;height:calc(var(--figs) * .9);',
    '  margin:calc(var(--figs) * -.45) 0 0 -21%;opacity:0;',
    '  transform:scaleX(.05) skewX(-16deg);transform-origin:6% 50%;',
    '  background:linear-gradient(90deg,transparent,rgba(255,246,224,.05) 18%,rgba(255,244,214,.92) 52%,',
    '    rgba(255,150,50,.35) 74%,transparent);',
    '  -webkit-mask-image:linear-gradient(180deg,transparent,#000 28%,#000 72%,transparent);',
    '  mask-image:linear-gradient(180deg,transparent,#000 28%,#000 72%,transparent);}',
    '.febx-slash.on{animation:febxSlash 220ms cubic-bezier(.2,0,.1,1) forwards;}',
    '@keyframes febxSlash{0%{opacity:0;transform:scaleX(.05) skewX(-16deg)}22%{opacity:1}',
    '  60%{opacity:1;transform:scaleX(1) skewX(-16deg)}',
    '  100%{opacity:0;transform:scaleX(1.12) skewX(-16deg)}}',

    /* ---- 💥 the damage numeral — the reference's heavy red 1200 -----
       Two nested layers on purpose: the WRAP owns the slow upward drift
       (an inline transform + transition) and the NUM owns the punch-in
       keyframe. If both lived on one node the `forwards` fill of the
       keyframe would win the cascade and the drift would never happen. */
    /* 54% / 38%: inside the collision's overlap region and just above it, so
       the numeral and the burst are one focal point (see COLLISION GEOMETRY) */
    '.febx-numwrap{position:absolute;top:33%;left:50%;transform:translate3d(-50%,-50%,0);',
    '  transition:transform 320ms cubic-bezier(.2,.7,.3,1);will-change:transform;}',
    '.febx-num{opacity:0;transform:scale(2.7);white-space:nowrap;',
    '  font-family:"Cinzel","Arial Black",Impact,system-ui,sans-serif;font-weight:900;',
    '  font-size:var(--num);line-height:.86;letter-spacing:-.03em;font-variant-numeric:tabular-nums;',
    '  color:#ff2a18;-webkit-text-stroke:3px #2b0500;',
    '  text-shadow:3px 0 0 #2b0500,-3px 0 0 #2b0500,0 3px 0 #2b0500,0 -3px 0 #2b0500,',
    '    2px 2px 0 #2b0500,-2px 2px 0 #2b0500,2px -2px 0 #2b0500,-2px -2px 0 #2b0500,',
    '    0 8px 0 rgba(0,0,0,.5),0 0 38px rgba(255,70,24,.8),0 0 96px rgba(255,24,0,.55);}',
    '.febx-num.on{animation:febxNum 300ms cubic-bezier(.1,1.5,.4,1) forwards;}',
    '@keyframes febxNum{0%{opacity:0;transform:scale(2.9)}30%{opacity:1;transform:scale(.88)}',
    '  55%{transform:scale(1.10)}100%{opacity:1;transform:scale(1)}}',
    /* ⚠ CRIT > HIT, unmistakably. The first pass made a crit read GENTLER than a
       jab — cream-gold on a bright amber bloom is LOWER contrast than red on
       black. Fixed on every axis at once: a pure white core (maximum contrast
       against the darkened surround), a stroke nearly twice as thick and almost
       black, a hard red fringe splitting off the edge, a bigger numeral, and a
       DARK bloom behind it (.febx-numshade) instead of a bright one. */
    '.febx-crit .febx-num{color:#fff;-webkit-text-stroke:5px #180000;',
    '  font-size:calc(var(--num) * 1.22);letter-spacing:-.045em;',
    '  text-shadow:4px 0 0 #180000,-4px 0 0 #180000,0 4px 0 #180000,0 -4px 0 #180000,',
    '    3px 3px 0 #180000,-3px 3px 0 #180000,3px -3px 0 #180000,-3px -3px 0 #180000,',
    '    7px 0 0 rgba(255,26,0,.95),-7px 0 0 rgba(255,26,0,.65),',
    '    0 11px 0 rgba(0,0,0,.8),0 0 24px rgba(255,40,0,.95),0 0 78px rgba(170,0,0,.8);}',
    /* the dark bloom that makes the white core bite; crit only */
    '.febx-numshade{position:absolute;left:50%;top:50%;opacity:0;',
    '  width:calc(var(--num) * 4.4);height:calc(var(--num) * 2.3);',
    '  margin:calc(var(--num) * -1.15) 0 0 calc(var(--num) * -2.2);',
    '  background:radial-gradient(ellipse at 50% 50%,rgba(0,0,0,.94),rgba(46,0,0,.62) 44%,transparent 72%);}',
    '.febx-crit .febx-numshade{opacity:1;}',
    '.febx-num{position:relative;z-index:1;}',
    '.febx-num.miss{color:#cfe4ef;font-size:calc(var(--num) * .5);-webkit-text-stroke:2px #0b1c24;',
    '  text-shadow:0 6px 0 rgba(0,0,0,.5),0 0 30px rgba(120,190,220,.6);}',

    /* kicker: CRITICAL / DESTROYED */
    '.febx-kick{position:absolute;left:50%;top:calc(33% - var(--num) * .78);opacity:0;',
    '  transform:translate3d(-50%,6px,0) scale(.86);white-space:nowrap;',
    '  transition:opacity 130ms linear,transform 210ms cubic-bezier(.1,1.4,.4,1);',
    '  font-size:calc(var(--num) * .23);font-weight:900;letter-spacing:.34em;text-indent:.34em;',
    '  color:#ffd97a;text-shadow:0 2px 0 #3a0d00,0 0 26px rgba(255,170,40,.9);}',
    /* no -webkit-text-stroke here: at this size a centred 2px stroke eats most
       of the glyph and the word goes grey. Offset shadows only. */
    '.febx-crit .febx-kick{color:#fff;',
    '  text-shadow:2px 0 0 #180000,-2px 0 0 #180000,0 2px 0 #180000,0 -2px 0 #180000,',
    '    2px 2px 0 #180000,-2px 2px 0 #180000,0 4px 0 rgba(0,0,0,.8),',
    '    0 0 20px rgba(255,60,10,.95),0 0 52px rgba(190,0,0,.8);}',
    '.febx-kill .febx-kick{color:#ffe9e2;text-shadow:0 2px 0 #3a0000,0 0 30px rgba(255,50,20,.95);}',

    /* the hit punch, on the shake layer only */
    '@keyframes febxPunch{0%{transform:translate3d(0,0,0) scale(1)}',
    '  18%{transform:translate3d(-1.5%,.9%,0) scale(1.055)}',
    '  38%{transform:translate3d(1.2%,-.7%,0) scale(1.015)}',
    '  58%{transform:translate3d(-.7%,.4%,0) scale(1.03)}',
    '  78%{transform:translate3d(.35%,-.2%,0) scale(1.008)}',
    '  100%{transform:translate3d(0,0,0) scale(1)}}',

    /* ---- ♿ reduced motion: no movement at all, just the read ------- */
    '.febx-rm .febx-cam{transform:none!important;transition:opacity 90ms linear!important;}',
    '.febx-rm .febx-bar,.febx-rm .febx-lines,.febx-rm .febx-slash,.febx-rm .febx-burst,',
    '.febx-rm .febx-charge,.febx-rm .febx-flash,.febx-rm .febx-ground,.febx-rm .febx-horizon,',
    '.febx-rm .febx-side{display:none!important;}',
    '.febx-rm .febx-numwrap,.febx-rm .febx-num,.febx-rm .febx-kick,.febx-rm .febx-plate{',
    '  transition:opacity 90ms linear!important;animation:none!important;}',
    /* with the combatants hidden there is no collision to sit on, so the
       numeral goes back to dead centre */
    '.febx-rm .febx-numwrap{left:50%!important;transform:translate3d(-50%,-50%,0)!important;}',
    '.febx-rm .febx-kick{left:50%!important;}',
    '.febx-rm .febx-num{transform:none!important;}',
    '.febx-rm .febx-kick{transform:translate3d(-50%,0,0)!important;}',
    '.febx-rm .febx-plate{transform:none!important;}',
    '.febx-rm .febx-scrim{-webkit-backdrop-filter:none!important;backdrop-filter:none!important;}',
    /* belt and braces: even if the caller forgets to pass reducedMotion */
    '@media (prefers-reduced-motion:reduce){#' + ROOT_ID + ' *{animation:none!important;}}'
  ].join('\n');

  function ensureStyle() {
    try {
      if (doc.getElementById(STYLE_ID)) return;
      var s = doc.createElement('style');
      s.id = STYLE_ID;
      s.setAttribute('data-febx', VERSION);
      s.textContent = CSS;
      (doc.head || doc.documentElement).appendChild(s);
    } catch (e) {}
  }

  /* ================================================================== *
   * helpers
   * ================================================================== */
  function reduceMotion() {
    try {
      return !!(global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches);
    } catch (e) { return false; }
  }
  function lowPower() {
    try {
      var n = global.navigator || {};
      if (typeof n.hardwareConcurrency === 'number' && n.hardwareConcurrency > 0 && n.hardwareConcurrency <= 4) return true;
      if (typeof n.deviceMemory === 'number' && n.deviceMemory <= 4) return true;
    } catch (e) {}
    return false;
  }
  function supportsBackdrop() {
    try {
      return !!(global.CSS && global.CSS.supports &&
        (global.CSS.supports('backdrop-filter', 'blur(2px)') ||
         global.CSS.supports('-webkit-backdrop-filter', 'blur(2px)')));
    } catch (e) { return false; }
  }
  function rectOf(el) {
    try {
      if (!el || !el.getBoundingClientRect) return null;
      var r = el.getBoundingClientRect();
      if (!r || (!r.width && !r.height)) return null;
      return r;
    } catch (e) { return null; }
  }
  function firstChar(s) {
    try { return Array.from(String(s == null ? '' : s).trim())[0] || ''; } catch (e) { return ''; }
  }
  function num(v) { var n = Number(v); return isFinite(n) ? n : 0; }

  /* Build a portrait from a live `.unit` element WITHOUT keeping a reference to
     it — the board re-renders on virtually every state change, so everything is
     copied by value. Preference: <img> src -> <canvas> pixels -> glyph/text ->
     the first letter of the name. Never throws, always returns a node. */
  /* 🎞 An ANIMATED reel beats a frozen portrait. reel = { frames:[url], fps }.
     Frames are stacked and cross-toggled by opacity — same technique the board
     ticker uses — driven by one setTimeout chain that stopReel() cancels, so a
     torn-down cut-away cannot leave a timer running. Falls back to the static
     portrait path whenever no reel is supplied or it has fewer than 2 frames. */
  function portrait(el, name, reel) {
    var wrap = doc.createElement('div');
    wrap.className = 'febx-art';
    var made = false;
    if (reel && reel.frames && reel.frames.length > 1) {
      try {
        for (var fi = 0; fi < reel.frames.length; fi++) {
          var fim = doc.createElement('img');
          fim.decoding = 'async'; fim.alt = '';
          fim.className = 'febx-rf' + (fi === 0 ? ' on' : '');
          fim.src = reel.frames[fi];
          wrap.appendChild(fim);
        }
        wrap.classList.add('img', 'reel');
        wrap._reelFps = reel.fps || 12;
        made = true;
      } catch (e) { made = false; }
    }
    if (made) return wrap;
    try {
      var icon = (el && el.querySelector) ? (el.querySelector('.unit-icon') || el) : null;
      if (icon) {
        var img = icon.querySelector && icon.querySelector('img');
        var src = img && (img.currentSrc || img.getAttribute('src') || img.src);
        if (src) {
          var n1 = doc.createElement('img');
          n1.decoding = 'async'; n1.alt = ''; n1.src = src;
          wrap.appendChild(n1); wrap.classList.add('img'); made = true;
        }
        if (!made) {
          var cv = icon.querySelector && icon.querySelector('canvas');
          if (cv && cv.width && cv.height) {
            try {
              var n2 = doc.createElement('img');
              n2.alt = ''; n2.src = cv.toDataURL('image/png');
              wrap.appendChild(n2); wrap.classList.add('img'); made = true;
            } catch (e) { /* tainted canvas — fall through to text */ }
          }
        }
        if (!made) {
          var g = firstChar(icon.textContent);
          if (g) {
            var s1 = doc.createElement('span');
            s1.className = 'febx-glyph'; s1.textContent = g;
            wrap.appendChild(s1); made = true;
          }
        }
      }
    } catch (e) {}
    if (!made) {
      var s2 = doc.createElement('span');
      s2.className = 'febx-glyph';
      s2.textContent = firstChar(name) || '⚔';
      wrap.appendChild(s2);
    }
    return wrap;
  }

  /* ================================================================== *
   * module state
   * ================================================================== */
  var mount = null;            // overlay host; defaults to document.body
  var live = null;             // the sequence currently running, or null
  /* 🎞 THE QUEUE — see play(). A second attack waits for the first to finish
     rather than cutting it short. QUEUE_MAX bounds a pathological burst: past
     it, an extra call is DECLINED (resolves immediately, starts nothing) rather
     than allowed to truncate anything. Declining to start is not cutting short. */
  var pending = [];
  var QUEUE_MAX = 3;
  /* Resolve every parked caller without playing them — for teardown only. A
     queued promise that never settles strands the turn that awaited it. */
  function drainAbort(why) {
    var q = pending.splice(0, pending.length);
    for (var i = 0; i < q.length; i++) {
      try { q[i].resolve({ ok: false, skipped: true, reason: why || 'aborted' }); } catch (e) {}
    }
  }
  /* Start the next parked stage, if any. Called from finish(), so it runs on
     EVERY exit route — complete, skip, timeout, error, hidden. */
  function drainNext() {
    if (live || !pending.length) return;
    var nxt = pending.shift();
    try { API._start(nxt.opts, nxt.resolve); }
    catch (e) { try { nxt.resolve({ ok: false, reason: 'error' }); } catch (e2) {} }
  }

  function mountEl() {
    if (mount && mount.appendChild && mount.isConnected !== false) return mount;
    return doc.body || doc.documentElement;
  }

  /* ------------------------------------------------------------------ *
   * A sequence owns its nodes, its timers and its promise.
   * ------------------------------------------------------------------ */
  function Sequence(opts, resolve) {
    this.opts = opts || {};
    this.resolve = resolve;
    this.timers = [];
    this.settled = false;
    this.skipped = false;
    this.staticFx = false;     // testing: write poses inline instead of firing keyframes
    this.root = null;
    this.el = null;
    this.rm = false;
    this.startedAt = now();
    this.onInput = null;
    this.onVis = null;
  }

  function now() {
    try { return (global.performance && performance.now) ? performance.now() : Date.now(); }
    catch (e) { return Date.now(); }
  }

  /* Schedule against ABSOLUTE offsets from t0. Every beat is scheduled
     independently, so one throwing beat can never stop the beats after it. */
  Sequence.prototype.at = function (ms, fn) {
    var self = this;
    var id = global.setTimeout(function () {
      if (self.settled) return;
      try { fn(); } catch (e) { /* a broken beat must never stall the turn */ }
    }, Math.max(0, ms | 0));
    this.timers.push(id);
    return id;
  };

  Sequence.prototype.clearTimers = function () {
    for (var i = 0; i < this.timers.length; i++) {
      try { global.clearTimeout(this.timers[i]); } catch (e) {}
    }
    this.timers.length = 0;
  };

  /* 🛡 THE ONE EXIT. Idempotent, never throws, always resolves. */
  Sequence.prototype.finish = function (why) {
    if (this.settled) return;
    this.settled = true;
    this.clearTimers();
    /* 🎞 Stop the frame reels. They run on their own setTimeout chain, not on
       this.timers, so clearTimers() above does not reach them. */
    try {
      if (this._reels) { for (var ri = 0; ri < this._reels.length; ri++) this._reels[ri](); }
      this._reels = null;
    } catch (e) {}
    try {
      if (this.onInput) {
        global.removeEventListener('pointerdown', this.onInput, true);
        global.removeEventListener('keydown', this.onInput, true);
        global.removeEventListener('touchstart', this.onInput, true);
      }
    } catch (e) {}
    try { if (this.onVis) doc.removeEventListener('visibilitychange', this.onVis, true); } catch (e) {}
    try { if (this.root && this.root.parentNode) this.root.parentNode.removeChild(this.root); } catch (e) {}
    this.root = null;
    this.el = null;
    if (live === this) live = null;
    /* ⚠ Here, not in one caller: finish() is the single exit for all five
       routes (complete / skip / timeout / error / hidden), so draining here is
       the only placement that cannot miss one and leave the queue parked. */
    try { if (!live) global.setTimeout(drainNext, 0); } catch (e) { drainNext(); }
    var out = {
      ok: true,
      skipped: !!this.skipped,
      reason: why || 'complete',
      ms: Math.round(now() - this.startedAt)
    };
    try { this.resolve(out); } catch (e) {}
  };

  Sequence.prototype.skip = function (why) {
    if (this.settled || this.skipped) return;
    this.skipped = true;
    var self = this;
    /* ⚠ clearTimers() drops the ORIGINAL watchdog along with the rest of the
       schedule, so the skip path must re-arm one immediately. This runs on the
       live turn loop now: if the fade timer below were ever lost, the only
       remaining backstop would be a visibilitychange that may never fire, and
       the player's turn would be stranded. Re-armed first, before any DOM work
       that could throw. */
    this.clearTimers();
    this.timers.push(global.setTimeout(function () {
      self.finish('watchdog-skip');
    }, SKIP_FADE + 900));
    try {
      var e = this.el;
      if (e && e.root) {
        e.cam.style.transition = 'opacity ' + SKIP_FADE + 'ms linear';
        e.cam.style.opacity = '0';
        e.scrim.style.transition = 'opacity ' + SKIP_FADE + 'ms linear';
        e.scrim.style.opacity = '0';
        e.root.style.pointerEvents = 'none';
      }
    } catch (e2) {}
    this.timers.push(global.setTimeout(function () { self.finish(why || 'skipped'); }, SKIP_FADE));
  };

  /* ================================================================== *
   * BUILD — every node made once, up front.
   * ================================================================== */
  Sequence.prototype.build = function () {
    var o = this.opts;
    var host = mountEl();
    var root = doc.createElement('div');
    root.id = ROOT_ID;
    root.setAttribute('aria-hidden', 'true');

    var rm = this.rm = (o.reducedMotion != null ? !!o.reducedMotion : reduceMotion());
    var blur = (o.blur != null ? !!o.blur : (!lowPower() && supportsBackdrop()));
    if (blur && !rm) root.classList.add('febx-blur');
    if (rm) root.classList.add('febx-rm');
    if (o.crit) root.classList.add('febx-crit');
    if (o.killed) root.classList.add('febx-kill');

    /* embedded mounting (probe harness): absolute inside the host, not fixed */
    if (host !== doc.body && host !== doc.documentElement) {
      root.classList.add('febx-inline');
      try {
        if (global.getComputedStyle(host).position === 'static') host.style.position = 'relative';
      } catch (e) {}
    }

    /* ---- the ONLY layout read of the live board, here and nowhere else --- */
    var ar = rectOf(o.attacker && o.attacker.el);
    var dr = rectOf(o.defender && o.defender.el);
    var hostR = rectOf(host) ||
      { left: 0, top: 0, width: global.innerWidth || 1280, height: global.innerHeight || 720 };
    var W = hostR.width || 1280, H = hostR.height || 720;

    /* Camera origin: the midpoint between the two combatants on the real board,
       in host-local px. Scaling the cam layer about that point means the
       cut-away literally grows out of the tiles the fight happened on — and
       collapses back into them on the way out. If an element is missing we fall
       back to the centre of the host and the sequence plays identically. */
    var cx, cy;
    if (ar && dr) {
      cx = ((ar.left + ar.width / 2) + (dr.left + dr.width / 2)) / 2 - hostR.left;
      cy = ((ar.top + ar.height / 2) + (dr.top + dr.height / 2)) / 2 - hostR.top;
    } else if (ar || dr) {
      var one = ar || dr;
      cx = one.left + one.width / 2 - hostR.left;
      cy = one.top + one.height / 2 - hostR.top;
    } else {
      cx = W / 2; cy = H / 2;
    }
    cx = Math.max(W * 0.08, Math.min(W * 0.92, cx));
    cy = Math.max(H * 0.10, Math.min(H * 0.90, cy));
    this.origin = { x: Math.round(cx), y: Math.round(cy) };

    /* container-relative sizing, so the module is identical full-screen or
       embedded in a probe container — no vw/vh anywhere */
    /* the numeral shares a focal point with the collision, so it must not be so
       large that it erases the two combatants it is describing */
    var figs = Math.round(Math.max(280, Math.min(W * 0.42, H * 0.74)));
    var numPx = Math.round(Math.max(52, Math.min(W * 0.115, H * 0.24)));
    root.style.setProperty('--figs', figs + 'px');
    root.style.setProperty('--num', numPx + 'px');
    /* Every offset below is a fraction of the frame width, tied to the
       COLLISION GEOMETRY block in the stylesheet. Attacker rest centre 26%,
       defender 68%: a .24W lunge lands the attacker's centre on 50% and its
       leading edge on 59%, which is the contact point the burst sits over. */
    this.W = W;
    this.off = {
      windBack: Math.round(W * 0.035),   // anticipation draw-back
      windDown: Math.round(W * 0.006),
      brace: Math.round(W * 0.008),      // defender settles into the hit
      lunge: Math.round(W * 0.24),       // the strike
      plant: Math.round(W * 0.255),      // 1.5% overshoot on the hit frame
      knockX: Math.round(W * 0.055),     // defender thrown back and up
      knockY: Math.round(W * 0.014),
      lines: Math.round(W * 0.05),       // speed-line drift
      drift: Math.round(W * 0.018)       // the numeral's slow rise on settle
    };
    this.lunge = this.off.lunge;         // kept for _pose() reporting

    root.innerHTML =
      '<div class="febx-scrim"></div>' +
      '<div class="febx-bar t"></div><div class="febx-bar b"></div>' +
      '<div class="febx-cam">' +
        '<div class="febx-shake">' +
          '<div class="febx-ground"></div><div class="febx-horizon"></div>' +
          '<div class="febx-lines"></div>' +
          '<div class="febx-side a"><div class="febx-charge"></div><div class="febx-shadow"></div>' +
            '<div class="febx-fig"></div></div>' +
          '<div class="febx-side d"><div class="febx-shadow"></div><div class="febx-fig"></div></div>' +
          '<div class="febx-slash"></div>' +
          '<div class="febx-burst"></div>' +
          '<div class="febx-plate a"><span class="n"></span><span class="v"></span></div>' +
          '<div class="febx-plate d"><span class="n"></span><span class="v"></span>' +
            '<div class="febx-hp"><i></i></div></div>' +
          '<div class="febx-kick"></div>' +
          '<div class="febx-numwrap"><div class="febx-numshade"></div>' +
            '<div class="febx-num"></div></div>' +
        '</div>' +
      '</div>' +
      '<div class="febx-flash"></div>';

    var q = function (sel) { return root.querySelector(sel); };
    this.el = {
      root: root,
      scrim: q('.febx-scrim'),
      barT: q('.febx-bar.t'),
      barB: q('.febx-bar.b'),
      cam: q('.febx-cam'),
      shake: q('.febx-shake'),
      lines: q('.febx-lines'),
      sideA: q('.febx-side.a'),
      sideD: q('.febx-side.d'),
      figA: q('.febx-side.a .febx-fig'),
      figD: q('.febx-side.d .febx-fig'),
      charge: q('.febx-charge'),
      slash: q('.febx-slash'),
      burst: q('.febx-burst'),
      plateA: q('.febx-plate.a'),
      plateD: q('.febx-plate.d'),
      hp: q('.febx-hp i'),
      kick: q('.febx-kick'),
      numWrap: q('.febx-numwrap'),
      numEl: q('.febx-num'),
      flash: q('.febx-flash')
    };

    /* 🎥 the camera's pivot = where the fight is on the board */
    this.el.cam.style.transformOrigin = this.origin.x + 'px ' + this.origin.y + 'px';

    /* portraits (copied by value — see portrait()) */
    var A = o.attacker || {}, D = o.defender || {};
    var artA = portrait(A.el, A.name, A.reel);
    var artD = portrait(D.el, D.name, D.reel);
    this.el.figA.appendChild(artA);
    this.el.figD.appendChild(artD);
    /* 🎞 Drive any stacked reel. Kept on the instance so finish() can stop it —
       an orphaned frame timer would tick forever after the cut-away is gone. */
    this._reels = [];
    var self0 = this;
    [artA, artD].forEach(function (w) {
      if (!w || !w.classList.contains('reel')) return;
      var imgs = w.querySelectorAll('img'); if (imgs.length < 2) return;
      var ms = Math.max(40, Math.round(1000 / (w._reelFps || 12)));
      var i = 0, stopped = false, tid = 0;
      var tick = function () {
        if (stopped) return;
        imgs[i].classList.remove('on');
        i = (i + 1) % imgs.length;
        imgs[i].classList.add('on');
        tid = setTimeout(tick, ms);
      };
      tid = setTimeout(tick, ms);
      self0._reels.push(function () { stopped = true; try { clearTimeout(tid); } catch (e) {} });
    });

    /* plates */
    this.el.plateA.querySelector('.n').textContent = A.name || 'Attacker';
    this.el.plateA.querySelector('.v').textContent = (A.atk != null && A.atk !== '') ? ('ATK ' + A.atk) : '';
    this.el.plateD.querySelector('.n').textContent = D.name || 'Defender';
    var hpBefore = num(D.hp);
    this.el.plateD.querySelector('.v').textContent = hpBefore ? ('HP ' + hpBefore) : '';
    if (!hpBefore) { try { this.el.hp.parentNode.style.display = 'none'; } catch (e) {} }

    /* damage copy. `defender.hp` is read as the hp BEFORE this damage, which is
       what lets the bar drain; if it is absent the bar is simply hidden. */
    var dmg = num(o.damage);
    this.dmg = dmg;
    this.el.numEl.textContent = dmg > 0 ? String(Math.round(dmg)) : 'NO DAMAGE';
    if (dmg <= 0) this.el.numEl.classList.add('miss');
    this.el.kick.textContent = o.killed ? 'DESTROYED' : (o.crit ? 'CRITICAL' : '');

    var after = o.killed ? 0 : Math.max(0, hpBefore - dmg);
    this.hpFrac = hpBefore > 0 ? Math.max(0, Math.min(1, after / hpBefore)) : 1;

    host.appendChild(root);
    this.root = root;
    return root;
  };

  /* ================================================================== *
   * POSES — each phase writes INLINE transform/opacity values and lets the
   * element's own CSS transition carry it there. Nothing in the choreography
   * waits on a transition or animation EVENT, so a dropped frame, a
   * throttled tab or a browser that never fires `transitionend` cannot stall
   * the sequence. (It also means a DOM clone captures the pose, which is how
   * the key-frame screenshots were taken — see `_pose`.)
   * ================================================================== */
  Sequence.prototype.pose = function (phase) {
    var e = this.el;
    if (!e || !e.root) return;
    e.root.setAttribute('data-phase', phase);
    var rm = this.rm;
    var f = this.off;                              // frame-width-derived offsets
    var st = this.staticFx;

    if (phase === 'in') {                          /* 🎥 CAMERA PUSHES IN */
      e.scrim.style.opacity = '1';
      e.barT.style.transform = 'translate3d(0,0,0)';
      e.barB.style.transform = 'translate3d(0,0,0)';
      e.cam.style.transitionDuration = DUR.IN + 'ms, ' + Math.round(DUR.IN * 0.82) + 'ms';
      e.cam.style.transform = rm ? 'none' : 'scale(1)';
      e.cam.style.opacity = '1';
      e.plateA.style.opacity = '1'; e.plateA.style.transform = 'translate3d(0,0,0)';
      e.plateD.style.opacity = '1'; e.plateD.style.transform = 'translate3d(0,0,0)';
      return;
    }

    if (phase === 'wind') {                        /* ANTICIPATION */
      e.figA.style.transitionDuration = Math.round(DUR.WIND * 0.72) + 'ms';
      e.figA.style.transitionTimingFunction = 'cubic-bezier(.2,.9,.35,1)';
      e.figA.style.transform = 'translate3d(' + (-f.windBack) + 'px,' +
        f.windDown + 'px,0) scale(.965) rotate(-3deg)';
      e.figD.style.transitionDuration = Math.round(DUR.WIND * 0.9) + 'ms';
      e.figD.style.transform = 'translate3d(' + f.brace + 'px,0,0) scale(.975)';
      e.charge.style.opacity = '1';
      e.charge.style.transform = 'scale(1)';
      e.lines.style.opacity = '.34';
      return;
    }

    if (phase === 'strike') {                      /* THE LUNGE */
      e.figA.style.transitionDuration = DUR.STRIKE + 'ms';
      e.figA.style.transitionTimingFunction = 'cubic-bezier(.3,0,.12,1)';
      e.figA.style.transform = 'translate3d(' + f.lunge + 'px,0,0) scale(1.05) rotate(2deg)';
      e.charge.style.opacity = '0';
      e.charge.style.transform = 'scale(1.5)';
      e.lines.style.opacity = '.85';
      e.lines.style.transform = 'translate3d(' + f.lines + 'px,0,0)';
      if (st) { e.slash.style.opacity = '1'; e.slash.style.transform = 'scaleX(1) skewX(-16deg)'; }
      else { e.slash.classList.add('on'); }
      return;
    }

    if (phase === 'hit') {                         /* ⭐ THE HIT FRAME */
      if (st) {
        /* the live flash peaks at .9 for ~12ms; a static capture at that value
           just floods the frame, so the frozen pose shows a trailing value */
        e.flash.style.opacity = '.14';
        e.burst.style.opacity = '.95'; e.burst.style.transform = 'scale(1.05)';
        e.numEl.style.opacity = '1';  e.numEl.style.transform = 'scale(1.1)';
      } else {
        e.flash.classList.add('on');
        e.burst.classList.add('on');
        e.numEl.classList.add('on');
      }
      if (this.opts.killed || this.opts.crit) {
        e.kick.style.opacity = '1';
        e.kick.style.transform = 'translate3d(-50%,0,0) scale(1)';
      }
      /* the attacker plants past the defender; the defender is thrown back */
      e.figA.style.transitionDuration = '60ms';
      e.figA.style.transform = 'translate3d(' + f.plant + 'px,0,0) scale(1.02) rotate(4deg)';
      e.figD.style.transitionDuration = '90ms';
      e.figD.style.transitionTimingFunction = 'cubic-bezier(.1,.9,.3,1)';
      e.figD.style.transform = 'translate3d(' + f.knockX + 'px,' +
        (-f.knockY) + 'px,0) scale(1.02) rotate(7deg)';
      e.figD.classList.add('flash');
      /* the punch lives on the SHAKE layer, never on the camera or the board */
      if (!rm && !st) {
        e.shake.style.animation = 'none';
        try { void e.shake.offsetWidth; } catch (e2) {}
        e.shake.style.animation = 'febxPunch ' + (this.opts.crit ? 300 : 230) +
          'ms cubic-bezier(.2,.7,.3,1) forwards';
      }
      /* hp drains as a transform on a 4px overlay bar — never a width */
      e.hp.style.transform = 'scaleX(' + this.hpFrac + ')';
      if (this.hpFrac <= 0.34) e.hp.classList.add('low');
      return;
    }

    if (phase === 'settle') {                      /* FOLLOW-THROUGH */
      e.figD.classList.remove('flash');
      e.figA.style.transitionDuration = Math.round(DUR.SETTLE * 0.62) + 'ms';
      e.figA.style.transitionTimingFunction = 'cubic-bezier(.2,.75,.3,1)';
      e.figA.style.transform = 'translate3d(0,0,0) scale(1)';
      e.figD.style.transitionDuration = Math.round(DUR.SETTLE * 0.7) + 'ms';
      e.figD.style.transform = 'translate3d(0,0,0) scale(1)';
      e.lines.style.opacity = '0';
      if (st) { e.slash.style.opacity = '0'; e.burst.style.opacity = '0'; e.flash.style.opacity = '0'; }
      /* the numeral drifts up on the WRAP, leaving the punch keyframe alone */
      e.numWrap.style.transform = 'translate3d(-50%,calc(-50% - ' + f.drift + 'px),0)';
      if (this.opts.killed) e.sideD.classList.add('dead');
      return;
    }

    if (phase === 'out') {                         /* 🎥 CAMERA PULLS BACK */
      e.cam.style.transitionDuration = DUR.OUT + 'ms, ' + Math.round(DUR.OUT * 0.9) + 'ms';
      e.cam.style.transitionTimingFunction = 'cubic-bezier(.55,0,.85,.4), linear';
      e.cam.style.transform = rm ? 'none' : 'scale(.26)';
      e.cam.style.opacity = '0';
      e.scrim.style.opacity = '0';
      e.barT.style.transform = 'translate3d(0,-100%,0)';
      e.barB.style.transform = 'translate3d(0,100%,0)';
      e.root.style.pointerEvents = 'none';
      return;
    }
  };

  /* ================================================================== *
   * RUN
   * ================================================================== */
  Sequence.prototype.run = function () {
    var self = this;
    var o = this.opts;
    var m = marks(!!o.crit, !!o.killed);
    this.marks = m;
    var total = this.rm ? RM_TOTAL : m.end;

    /* 🛡 #1 WATCHDOG — an absolute backstop, armed before anything that could
       throw. Even if every pose and every other timer fails, this resolves.
       `skip()` re-arms its own copy, because it clears this one. */
    this.timers.push(global.setTimeout(function () { self.finish('watchdog'); }, total + 1200));

    /* 🛡 #2 HIDDEN TAB — background tabs clamp timers to >=1s per tick, which
       would stretch a 1.1s cut-away across many seconds of real time. Bail. */
    this.onVis = function () { if (doc.hidden) self.finish('hidden'); };
    try { doc.addEventListener('visibilitychange', this.onVis, true); } catch (e) {}
    if (doc.hidden) { try{console.info('[FE] BAILED: document.hidden at start');}catch(e){} this.finish('hidden'); return; }

    /* 🛡 #3 SKIPPABLE — armed late so the click that ordered the attack cannot
       skip the animation it just started. */
    /* 🔴 SKIP IS DELIBERATE, NOT INCIDENTAL.
       Reported: animations get cut off when something else happens in the game.
       This used to end the cut-away on ANY pointerdown or ANY keydown once
       armed — and a card game is a stream of clicks, so a player queueing their
       next action killed the animation they were trying to watch. It read as
       the effect randomly failing to play, not as a skip they asked for.
       Escape is the one gesture that unambiguously means "stop showing me
       this"; nothing else on the battle screen uses it mid-animation. */
    var armed = false;
    this.onInput = function (ev) {
      if (!armed || self.settled) return;
      if (!ev || ev.type !== 'keydown' || ev.key !== 'Escape') return;
      if (ev.metaKey || ev.ctrlKey || ev.altKey || ev.shiftKey) return;
      self.skip('input');
    };
    this.at(SKIP_ARM, function () {
      armed = true;
      try {
        global.addEventListener('pointerdown', self.onInput, true);
        global.addEventListener('keydown', self.onInput, true);
        global.addEventListener('touchstart', self.onInput, true);
      } catch (e) {}
    });

    /* ♿ reduced motion: a fast, non-moving read of the same information */
    if (this.rm) {
      this.el.scrim.style.opacity = '1';
      this.el.cam.style.opacity = '1';
      this.el.numEl.style.opacity = '1';
      this.el.plateA.style.opacity = '1';
      this.el.plateD.style.opacity = '1';
      this.el.hp.style.transform = 'scaleX(' + this.hpFrac + ')';
      if (o.killed || o.crit) this.el.kick.style.opacity = '1';
      this.at(RM_TOTAL - 90, function () {
        self.el.scrim.style.opacity = '0';
        self.el.cam.style.opacity = '0';
      });
      this.at(RM_TOTAL, function () { self.finish('complete'); });
      return;
    }

    /* one forced reflow so the pre-push pose is the transition's start value */
    try { void this.el.cam.offsetWidth; } catch (e) {}

    this.at(0,        function () { self.pose('in'); });
    this.at(m.wind,   function () { self.pose('wind'); });
    this.at(m.strike, function () { self.pose('strike'); });
    this.at(m.hit,    function () { self.pose('hit'); });
    this.at(m.settle, function () { self.pose('settle'); });
    this.at(m.out,    function () { self.pose('out'); });
    this.at(m.end,    function () { self.finish('complete'); });
  };

  /* ================================================================== *
   * PUBLIC API
   * ================================================================== */
  var API = {
    VERSION: VERSION,

    /* opts: { attacker, defender, damage, killed, crit, blur, reducedMotion }
       attacker/defender: { name, atk, hp, el }   — `el` may be null.
       Resolves { ok, skipped, reason, ms }. Never rejects, never hangs. */
    play: function (opts) {
      return new Promise(function (resolve) {
        /* 🔴 A SECOND ATTACK NO LONGER KILLS THE FIRST — IT WAITS.

           Reported: "the animations get cut off when something else happens in
           the card game — let them play straight through."

           This used to open with `if (live) live.finish('superseded')`, under a
           comment reading "never two stages at once". The invariant was right;
           the way it was kept was wrong. Two attacks landing close together —
           an AI double-move, a counter-attack, a chain — meant the second call
           ENDED the first cut-away part-way through. The player saw an animation
           start and vanish, which reads as a broken effect rather than as a
           deliberate cut.

           Now the invariant is kept by QUEUEING: still exactly one stage on
           screen at a time, but the running one plays to its natural end and the
           next starts after it. Nothing is ever truncated.

           ⚠ Callers await this promise to sequence the turn, so a queued play
             resolves LATER than it used to. That is the intended behaviour —
             "play straight through" means the turn waits for the animation, and
             every caller already has a hard-timeout fallback for a promise that
             never settles.
           ⚠ Bounded so a pathological burst cannot stall a turn: past
             QUEUE_MAX the extra call resolves immediately as `queue-full`
             WITHOUT starting or stopping anything. Declining to start an
             animation is not the same as cutting one short. */
        if (live) {
          if (pending.length >= QUEUE_MAX) { resolve({ ok: false, skipped: true, reason: 'queue-full' }); return; }
          pending.push({ opts: opts, resolve: resolve });
          return;
        }
        API._start(opts, resolve);
      });
    },

    /* Internal — build and run one stage. Split out of play() so the queue
       drain has a single entry point and cannot diverge from the direct path. */
    _start: function (opts, resolve) {
      (function () {
        var seq = null;
        try {
          ensureStyle();
          if (!doc.body && !doc.documentElement) { resolve({ ok: false, reason: 'no-dom' }); return; }

          /* never a node leaked by a previous page state */
          try {
            var stale = doc.getElementById(ROOT_ID);
            if (stale && stale.parentNode) stale.parentNode.removeChild(stale);
          } catch (e) {}

          seq = new Sequence(opts, resolve);
          live = seq;
          seq.build();
          seq.run();
        } catch (err) {
          /* 🛡 #4 anything at all went wrong -> resolve; do not stall a turn */
          try {
            if (seq) seq.finish('error');
            else resolve({ ok: false, reason: 'error', error: String(err) });
          } catch (e2) {
            try { resolve({ ok: false, reason: 'error' }); } catch (e3) {}
          }
        }
      })();
    },

    /* 🛡 #5 Force-end whatever is playing and remove everything this module
       owns. Safe to call at any time, from anywhere, repeatedly. */
    teardown: function () {
      try { if (live) live.finish('teardown'); } catch (e) {}
      live = null;
      /* ⚠ Resolve every parked caller. A queued play() whose promise never
         settles would strand the turn that awaited it — the exact failure this
         module's #4 guard exists to prevent. */
      try { drainAbort('teardown'); } catch (e) {}
      try {
        var r = doc.getElementById(ROOT_ID);
        if (r && r.parentNode) r.parentNode.removeChild(r);
      } catch (e) {}
      try {
        var s = doc.getElementById(STYLE_ID);
        if (s && s.parentNode) s.parentNode.removeChild(s);
      } catch (e) {}
    },

    skip: function () { try { if (live) live.skip('api'); } catch (e) {} },
    isPlaying: function () { return !!live; },

    /* Overlay host. Defaults to document.body; the probe harness points this
       at its own container so the overlay lands inside the captured region. */
    setMount: function (el) { mount = el || null; },

    timings: function (crit, killed) {
      var m = marks(!!crit, !!killed);
      return { durations: DUR, marks: m, total: m.end, reducedMotionTotal: RM_TOTAL };
    },

    /* --- testing only -------------------------------------------------
       Build the stage and jump straight to one phase's pose without running
       the schedule, writing the decorative beats as inline styles too, so a
       static screenshot of a DOM clone shows that frame. */
    _pose: function (phase, opts) {
      try {
        ensureStyle();
        if (live) { try { live.finish('pose'); } catch (e) {} live = null; }
        var seq = new Sequence(opts || {}, function () {});
        live = seq;
        seq.build();
        seq.staticFx = true;
        /* 'pre' = built but not yet posed: the camera still collapsed onto the
           tiles the fight is happening on, which is what it pushes in FROM. */
        if (phase === 'pre') {
          seq.el.scrim.style.opacity = '1';
          seq.el.cam.style.opacity = '1';
          return { phase: phase, origin: seq.origin, lunge: seq.lunge };
        }
        var order = ['in', 'wind', 'strike', 'hit', 'settle', 'out'];
        for (var i = 0; i < order.length; i++) {
          seq.pose(order[i]);
          if (order[i] === phase) break;
        }
        return { phase: phase, origin: seq.origin, lunge: seq.lunge };
      } catch (e) { return { error: String(e) }; }
    }
  };

  try { if (global.FEBattle && global.FEBattle.teardown) global.FEBattle.teardown(); } catch (e) {}
  try { console.info("[FE] combat.js loaded — window.FEBattle is now available"); } catch (e) {}
  global.FEBattle = API;
})(typeof window !== 'undefined' ? window : this);
