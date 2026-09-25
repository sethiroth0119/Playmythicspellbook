/* ═══════════════════════════════════════════════════════════════════════════
   🃏 DRAW FX — the card leaves the deck, is shown to you, and lands in hand.

   The user: "draw card effects. When cards are added to the hand, reveal it to
   the player."  None of this existed. `cardDraw` was six `playSfx()` calls and
   nothing else — no flight, no reveal, no motion of any kind.

   ── WHY THIS IS DRIVEN BY THE DOM AND NOT BY THE REDUCER ────────────────────
   `drawCards(player, n, playSound)` is a pure function called from ~30 sites,
   most of them deep inside effect resolution and several of them part-way
   through building a state object that has not been committed yet. Hooking it
   would put presentation inside the reducer and — worse — invite a future edit
   that waits on it. This codebase already has a scar from exactly that shape: a
   swallowed animation continuation stranded a turn.

   So instead: this module watches the RENDERED hand and reacts to what actually
   arrived. The state has already landed by the time a single frame here runs.
   Nothing can be gated on an animation, because no game code ever calls into
   this file. It is strictly downstream. Delete the file and the game is
   functionally identical.

   Consequences of that choice, stated honestly:
     • It fires for EVERY card entering the hand — draw, bounce, salvage,
       search. That is precisely the ask ("when cards are added to the hand"),
       and the flight origin is picked from whichever pile actually shrank, so
       a salvage flies out of the graveyard rather than the deck.
     • It cannot know a card before it is in the DOM, so the reveal happens a
       frame after the state change rather than before it. Master Duel does the
       same: the draw resolves, then it is shown to you.

   ── THE HAND CAN NEVER DESYNC ──────────────────────────────────────────────
   Two structural guarantees, not two careful code paths:
     1. Ghosts live in #drawfx-layer, a fixed-position sibling on <body>. The
        battle render rebuilds `.battle-screen` innerHTML wholesale and never
        touches the layer; the layer never touches the hand.
     2. The ONLY mutation applied to a real hand card is the class
        `.drawfx-arrive`, whose CSS is an entrance animation with
        `animation-fill-mode: backwards`. Backwards fill holds the hidden frame
        only while the animation is PENDING. Finish it, cancel it, remove the
        class, or replace the element — every exit lands on "fully visible".
        There is no inline style, no `forwards` fill, and no path in this file
        that can leave a card hidden.
   On top of those: an idempotent teardown, a hard timeout, and sweeps on skip,
   resize, visibilitychange, pagehide and leaving the battle screen.

   ── --hand-clear ───────────────────────────────────────────────────────────
   `src/battle/fit.js` measures `.hand-strip`'s border box to size the board.
   Everything here is transform / opacity / filter, none of which participate in
   layout. The strip's measured height is bit-identical mid-flight.

   ── NO WHITE SCREEN ────────────────────────────────────────────────────────
   The layer has no background and there is no full-viewport scrim of any kind —
   not even a dark one, so the board is never covered. The only backdrop is a
   card-sized radial halo whose stops are near-black and amber. No white stop,
   no additive blending, nothing that can wash the frame out.
   ═══════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  if (window.__drawFxWired) return;             // idempotent — safe to re-append
  window.__drawFxWired = true;

  var CAN_ANIMATE = typeof Element !== 'undefined'
                 && typeof Element.prototype.animate === 'function';

  /* ── Tunables ─────────────────────────────────────────────────────────────
     Three tiers, so "draw 1" gets a real reveal beat and "draw 5" never becomes
     a cutscene. Wall time is capped around 2.1s for any draw size.

       tier   n      flight  hold   settle  stagger  scale   total
       FULL   1–2     340     620    330      700     2.05    1.29s / 1.99s
       QUICK  3–4     300     280    280      360     1.62    0.86s / 1.94s
       DEAL   5+/deal 280      90    200       88     1.30    0.57s + n*88ms

     `hold` is the readable beat. 620ms is about the least a person needs to
     take a card name and cost off the screen; below ~450ms it stops being a
     reveal and becomes a flicker. The opening hand uses DEAL because seven
     consecutive 1.3s reveals is a loading screen, not a flourish.
     `stagger` for FULL (700ms) is deliberately longer than flight+hold*0.55 so
     the second card's reveal starts only as the first is leaving the anchor —
     that is what stops a multi-draw becoming three cards stacked on one spot. */
  /* `lerp` is how far along deck→slot the reveal anchor sits. FULL keeps 0.55
     (a reveal near the middle-right, well clear of the hand) because its stagger
     of 700ms exceeds flight+hold, so two reveals are never on screen together.
     QUICK and DEAL stagger FASTER than a card can arrive and leave, so a
     departing card and an arriving one do share the screen — pushing their
     anchors closer to each card's own hand slot fans them apart instead of
     stacking three reveals on one spot. Measured: at 0.55 adjacent anchors were
     69px apart against a 191px-wide reveal; at 0.82 they clear each other. */
  var TIERS = {
    full:  { flight: 340, flip: 280, hold: 620, settle: 330, stagger: 700, scale: 2.05, cap: 1, lerp: 0.55 },
    quick: { flight: 300, flip: 240, hold: 280, settle: 280, stagger: 360, scale: 1.62, cap: 1, lerp: 0.82 },
    deal:  { flight: 280, flip: 200, hold:  90, settle: 200, stagger:  88, scale: 1.30, cap: 0, lerp: 0.88 }
  };
  /* Caption geometry. CAP_SCALE is the caption's EFFECTIVE size on screen; it is
     divided by the tier scale at build time so the pill renders identically in
     every tier instead of inheriting 2.05x. CAP_OUT is its fade-out, and the
     invariant `stagger >= hold + CAP_OUT` is what makes two captions unable to
     coexist — see the caption block in flyOne(). Raising CAP_OUT past 80 breaks
     QUICK (360 >= 280 + CAP_OUT). */
  var CAP_SCALE = 1.5;
  var CAP_OUT   = 60;

  var MAX_GHOSTS  = 6;      // beyond this, extra cards get the arrive flash only
  var FOE_MAX     = 3;
  var FOE_FLIGHT  = 400;
  var FOE_STAGGER = 120;

  /* ── Live registry — everything a teardown must reach, in one place. ────── */
  var layer   = null;
  var timers  = [];
  var anims   = [];
  var running = false;
  var tearing = false;      // re-entrancy guard for finishAll()
  var hardTo  = 0;
  var lastWhy = '';

  var known   = null;       // Set of instanceIds last seen in the hand
  var pileWas = {};         // last-seen counts: yourDeck / graveyard / foeDeck / foeGrave
  var seqOwner = '';        // 'player' | 'foe' — who armed the running sequence

  /* ⚠ ROUND 2 — the bug that cost the WIN.
     `pending` maps instanceId → the ms offset (from `seqStart`) at which that
     card is due to land in the hand. It exists because `renderBattle()` replaces
     `.hand-strip-cards` WHOLESALE: every hand card becomes a brand-new element
     with no `.drawfx-arrive` class, so the drawn card silently un-hides while its
     2.05x face-up copy is still being held at the reveal anchor. The player sees
     the same card twice.

     That is not a timing artefact. `renderBattle()` has ~230 call sites and the
     FULL reveal window is 1.29s, so it fires on `draw 1` — the most common event
     in the game — and it defeats the entire point of the feature: you cannot
     reveal a card to someone who is already holding it.

     Re-applying the class is the fix, and it CANNOT strand a card:
       • every entry carries an absolute deadline and is dropped once passed, so
         a card that already landed is never re-hidden;
       • the class re-applied is the same self-healing entrance animation, with
         only the REMAINING delay, so it still lands at the right wall-clock ms;
       • `finishAll()` clears the map and the class from everything, so the
         ran-equals-skipped proof is untouched. */
  var pending  = null;      // Map instanceId -> arriveAt (ms from seqStart)
  var seqStart = 0;
  var ARRIVE_MS = 300;      // MUST match draw.css `.hand-card.drawfx-arrive` duration

  function reduced() {
    try { return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches); }
    catch (e) { return false; }
  }

  function ensureLayer() {
    if (layer && layer.isConnected) return layer;
    layer = document.getElementById('drawfx-layer');
    if (!layer) {
      layer = document.createElement('div');
      layer.id = 'drawfx-layer';
      // Belt and braces: draw.css says the same, but if that sheet ever 404s
      // from the service worker this element must STILL be structurally
      // incapable of painting anything over the board.
      layer.style.cssText = 'position:fixed;inset:0;z-index:1200;pointer-events:none;background:none;overflow:hidden';
      layer.setAttribute('aria-hidden', 'true');
      document.body.appendChild(layer);
    }
    return layer;
  }

  function at(ms, fn) { timers.push(setTimeout(fn, ms)); }

  function rectOf(el) {
    if (!el) return null;
    var r = el.getBoundingClientRect();
    if (!r || (!r.width && !r.height)) return null;
    return { cx: r.left + r.width / 2, cy: r.top + r.height / 2, w: r.width, h: r.height };
  }

  // transform-origin is the default 50% 50% and the ghost is a left:0/top:0 box
  // of exactly w x h, so translate() places the top-left and scale() grows about
  // the centre — the centre lands on (cx, cy) at any scale.
  function T(cx, cy, w, h, s) {
    return 'translate(' + (cx - w / 2).toFixed(2) + 'px,' + (cy - h / 2).toFixed(2) + 'px) scale(' + s.toFixed(4) + ')';
  }

  function run(el, frames, opts) {
    if (!CAN_ANIMATE || !el) return null;
    try { var a = el.animate(frames, opts); anims.push(a); return a; } catch (e) { return null; }
  }

  /* ── THE TEARDOWN ─────────────────────────────────────────────────────────
     Idempotent, total, and safe from anywhere at any moment. Step 4 is the one
     that matters: it makes every hand card unconditionally visible again, so an
     interrupted sequence and a completed one leave byte-identical hand DOM. */
  function finishAll(why) {
    if (tearing) return;
    tearing = true;
    try {
      var i;
      for (i = 0; i < timers.length; i++) { try { clearTimeout(timers[i]); } catch (e) {} }
      timers.length = 0;
      if (hardTo) { try { clearTimeout(hardTo); } catch (e) {} hardTo = 0; }

      for (i = 0; i < anims.length; i++) { try { anims[i].cancel(); } catch (e) {} }
      anims.length = 0;

      if (layer) { try { layer.textContent = ''; } catch (e) {} }

      // 4. Un-hide every real card, everywhere, whatever state it was in.
      var arriving = document.querySelectorAll('.drawfx-arrive');
      for (i = 0; i < arriving.length; i++) {
        try {
          arriving[i].classList.remove('drawfx-arrive');
          arriving[i].style.removeProperty('--drawfx-in');
        } catch (e) {}
      }
      var pulled = document.querySelectorAll('.drawfx-pull');
      for (i = 0; i < pulled.length; i++) { try { pulled[i].classList.remove('drawfx-pull'); } catch (e) {} }

      // Nothing is owed a re-hide once the sequence is over. Clearing this
      // BEFORE the listeners come off means a re-render racing the teardown
      // cannot resurrect a hide.
      pending = null;

      document.removeEventListener('pointerdown', onSkip, true);
      document.removeEventListener('keydown', onSkip, true);
    } catch (e) { /* a cleanup that throws is worse than no cleanup */ }
    running = false;
    seqOwner = '';
    lastWhy = why || 'done';
    tearing = false;

    /* 🎞 A draw arrived while this reveal was playing and scan() deliberately
       deferred it rather than let it cut this one short. The stage is clear now,
       so play it — on a fresh task, so the teardown's DOM writes above have
       settled before the new sequence measures any resting rects. */
    if (rescanWanted) {
      rescanWanted = false;
      setTimeout(function () { try { scan(); } catch (e) {} }, 0);
    }
  }

  /* 🔴 SKIP IS NOW DELIBERATE, NOT INCIDENTAL.

     Reported: "the animations get cut off when something else happens in the
     card game — let them play straight through."

     This used to be bound to `pointerdown` AND `keydown` with no filter and no
     arming delay, on `document`, in capture. So the next click ANYWHERE — a card
     in hand, the end-turn button, a panel, empty board — killed the draw reveal
     instantly. In a card game the player is clicking constantly, which made the
     reveal feel like it randomly failed to play rather than like it was skipped.

     A skip the player never asked for is a bug. Escape is the gesture that means
     "I am done watching this", and nothing else in the battle screen uses it
     during an animation. Modified keys are ignored so a browser shortcut on the
     way past cannot cancel a reveal. */
  /* Set when a scan had new cards but a reveal was still playing. finishAll()
     re-runs the scan once it has torn down, so the deferred cards get their own
     full reveal instead of being merged into a dying one. */
  var rescanWanted = false;

  function onSkip(ev) {
    if (!ev) return;
    if (ev.type !== 'keydown') return;
    if (ev.key !== 'Escape') return;
    if (ev.metaKey || ev.ctrlKey || ev.altKey || ev.shiftKey) return;
    finishAll('skip');
  }

  function armHardTimeout(ms) {
    if (hardTo) { try { clearTimeout(hardTo); } catch (e) {} }
    hardTo = setTimeout(function () { finishAll('timeout'); }, ms + 600);
  }

  /* A player draw takes over from a FOE flourish (theirs is small and on the
     other side of the screen), but never from another PLAYER reveal — scan()
     defers instead, so nothing the player is watching is ever truncated. */
  function beginSequence(totalMs, owner) {
    if (running) finishAll('superseded');
    running = true;
    seqOwner = owner || 'player';
    // ⚠ keydown ONLY. pointerdown used to be here and is what cut reveals short.
    document.addEventListener('keydown', onSkip, true);
    armHardTimeout(totalMs);
  }

  // The FOE track lives on the other side of the screen and must not evict a
  // player reveal — it joins the current sequence instead, extending only the
  // safety timeout.
  function joinSequence(totalMs) {
    if (!running) { beginSequence(totalMs, 'foe'); return; }
    armHardTimeout(totalMs + 2400);
  }

  /* Re-hide any card this sequence still owns. Called on EVERY scan, before the
     no-new-cards early-out, because a re-render with no new cards is exactly the
     case that used to break the reveal. */
  function reapplyPending() {
    if (!pending || !pending.size) return;
    var now = Date.now(), elapsed = now - seqStart, dead = [];
    pending.forEach(function (arriveAt, id) {
      /* 🔴 Past its landing: the card has arrived for good. Never re-hide it.
         ⚠ THIS USED TO EXPIRE 340ms LATE. The window was
         `arriveAt + ARRIVE_MS + 40`, which keeps a card "pending" for the whole
         of its entrance animation PLUS a 40ms cushion — but `rem` below clamps
         at 0, so a re-render landing inside that tail re-applied
         `.drawfx-arrive` with `--drawfx-in: 0ms` to a card that had ALREADY
         settled. The card blinked out and replayed its full 300ms entrance.
         A 340ms window in a 1550ms sequence, against ~230 renderBattle() call
         sites, is a bug a player hits regularly.
         The honest boundary is `arriveAt` itself: once the card is due to have
         landed, this sequence has no further claim on it. The entrance animation
         is `fill-mode: backwards` and self-completes, so nothing needs the
         pending entry to survive into it. */
      if (elapsed >= arriveAt) { dead.push(id); return; }
      var el = document.querySelector('.hand-strip-cards .hand-card[data-card="' + cssEsc(id) + '"]');
      if (!el) return;                                       // played / discarded mid-reveal
      if (el.classList.contains('drawfx-arrive')) return;     // element survived the render
      var rem = Math.max(0, arriveAt - elapsed);
      try {
        el.style.setProperty('--drawfx-in', rem + 'ms');
        el.classList.add('drawfx-arrive');
      } catch (e) {}
    });
    for (var i = 0; i < dead.length; i++) pending['delete'](dead[i]);
  }

  /* ═══ ONE FLYING CARD ════════════════════════════════════════════════════
     `rest` is the card's RESTING rect, captured in scan() BEFORE `.drawfx-arrive`
     was applied. It has to be: the class's 0% keyframe is
     `translateY(15px) scale(0.90)`, so measuring the element afterwards yields a
     box 10% small and 15px low, and the ghost would inherit both — a flying card
     visibly smaller than the card it becomes. Do not re-measure it here. */
  function flyOne(cardEl, id, rest, origin, tier, delay, isRm) {
    var target = rest || rectOf(cardEl);
    if (!target || !origin) return;

    var w = target.w, h = target.h;
    var vw = window.innerWidth || document.documentElement.clientWidth || 1280;
    var vh = window.innerHeight || document.documentElement.clientHeight || 800;

    // Reveal size: as big as the tier wants, but never taller than 42% of the
    // viewport nor wider than a third of it. Derived from the LIVE card rect, so
    // it is correct at every one of the strip's five width breakpoints and at
    // any zoom — there is not a hard-coded coordinate anywhere in this file.
    var s = Math.max(1.12, Math.min(tier.scale, (vh * 0.42) / h, (vw * 0.34) / w));
    var halfH = (h * s) / 2, halfW = (w * s) / 2;

    var ax = origin.cx + (target.cx - origin.cx) * (tier.lerp || 0.55);
    ax = Math.max(halfW + 14, Math.min(vw - halfW - 14, ax));
    // Sit just above the hand rather than dead centre: the bar asks that the
    // board is never obscured, and the drawn card belongs beside the hand it is
    // about to join.
    var ay = target.cy - halfH - 26;
    ay = Math.min(ay, vh * 0.58);
    ay = Math.max(ay, halfH + 18);
    ay = Math.min(ay, vh - halfH - (tier.cap ? 62 : 18));

    var g = document.createElement('div');
    g.className = 'drawfx-ghost';
    g.setAttribute('data-drawfx-for', id);
    g.style.width = w + 'px';
    g.style.height = h + 'px';
    g.style.transform = T(origin.cx, origin.cy, w, h, 1);

    var halo  = mk('drawfx-halo');
    var flip  = mk('drawfx-flip');
    var back  = mk('drawfx-face drawfx-back');
    var front = mk('drawfx-face drawfx-front');
    var rim   = mk('drawfx-rim');

    var bimg = document.createElement('img');
    bimg.alt = ''; bimg.draggable = false;
    // A dead sleeve URL must leave the plate showing, not a broken-image box.
    bimg.onerror = function () { try { this.remove(); } catch (e) {} };
    bimg.src = cardBackSrc('player');
    back.appendChild(bimg);

    // The face is a live clone of the real card, so the reveal is pixel-exact
    // with what lands in the hand — art tier, frame, cost orb, level badge.
    var clone = cardEl.cloneNode(true);
    try {
      clone.removeAttribute('data-card');        // must never be seen by the scan
      clone.removeAttribute('disabled');
      clone.classList.remove('selected', 'drawfx-arrive');
      clone.style.removeProperty('--drawfx-in');
      clone.setAttribute('tabindex', '-1');
      clone.setAttribute('aria-hidden', 'true');
    } catch (e) {}
    front.appendChild(clone);

    flip.appendChild(back); flip.appendChild(front); flip.appendChild(rim);
    g.appendChild(halo); g.appendChild(flip);

    var cap = null;
    if (tier.cap) {
      cap = mk('drawfx-cap');
      var b = document.createElement('b'); b.textContent = readName(cardEl);
      var sub = document.createElement('span'); sub.textContent = readSub(cardEl);
      cap.appendChild(b); cap.appendChild(sub);
      g.appendChild(cap);
    }

    ensureLayer().appendChild(g);

    var F = tier.flight, HOLD = tier.hold, SET = tier.settle;
    var tSettle = F + HOLD, tEnd = F + HOLD + SET;

    /* ── Reduced motion: no travel, no scale ramp, no arc. The card resolves
          into view at the anchor, holds, and cross-fades out. The user's ask is
          informational and survives intact; the vestibular motion does not. */
    if (isRm) {
      g.style.transform = T(ax, ay, w, h, s);
      back.style.opacity = '0';
      front.style.opacity = '1';
      var fade = [{ opacity: 0 }, { opacity: 1, offset: 0.18 }, { opacity: 1, offset: 0.82 }, { opacity: 0 }];
      run(g,    fade, { duration: tEnd, delay: delay, easing: 'linear', fill: 'both' });
      run(halo, fade, { duration: tEnd, delay: delay, easing: 'linear', fill: 'both' });
      if (cap) run(cap, fade, { duration: tEnd, delay: delay, easing: 'linear', fill: 'both' });
      at(delay + tEnd + 20, function () { try { g.remove(); } catch (e) {} });
      return;
    }

    /* ── Deck → reveal. An arc, not a line: the mid control is 58% along X but
          only 42% along Y and lifted, so the card sweeps up out of the pile
          before easing into the anchor. Anticipation is the held first 12%
          (while the pile recoils under it); the deceleration into the anchor is
          the settle half of "short anticipation, hard hit, slow settle".
          ⚠ fill:'both' is load-bearing — without it the ghost snaps back to the
            deck the instant the flight ends and the whole hold is invisible. */
    var mx = origin.cx + (ax - origin.cx) * 0.58;
    // (mid control — 58% across, 42% down, lifted: the card sweeps up out of the
    //  pile rather than sliding along the straight line between the two rects)
    var my = origin.cy + (ay - origin.cy) * 0.42 - Math.min(90, vh * 0.10);
    var ms = 1 + (s - 1) * 0.42;

    // ⚠ Per-keyframe easing with a LINEAR overall curve, not one bezier across
    //   the whole flight. A single front-loaded curve made the card reach 78% of
    //   its reveal size in the first quarter of the trip and then crawl — the
    //   probe measured scale 1.60 of 2.05 at t=80 on a 340ms flight, i.e. the
    //   arc control point was already behind it. Three segments give the beat
    //   the bar asks for: a snap off the pile, a level sweep, a decelerating
    //   arrival.
    var flightAnim = run(g, [
      { transform: T(origin.cx, origin.cy, w, h, 1),    opacity: 0, offset: 0,    easing: 'ease-out' },
      { transform: T(origin.cx, origin.cy, w, h, 1.02), opacity: 1, offset: 0.12, easing: 'cubic-bezier(.25,.05,.35,1)' },
      { transform: T(mx, my, w, h, ms),                 opacity: 1, offset: 0.56, easing: 'cubic-bezier(.25,.4,.2,1)' },
      { transform: T(ax, ay, w, h, s),                  opacity: 1, offset: 1 }
    ], { duration: F, delay: delay, easing: 'linear', fill: 'both' });

    // The flip — a 2D scaleX squash and swap. Deliberately NOT rotateY: the
    // board's own source comment records that live CSS 3D projection is what
    // caused the board glitch, and a squash reads the same for none of the risk.
    var flipStart = delay + Math.round(F * 0.42);
    var flipOpts = { duration: tier.flip, delay: flipStart, easing: 'cubic-bezier(.4,0,.25,1)', fill: 'both' };
    run(flip, [
      { transform: 'scaleX(1)' },
      { transform: 'scaleX(0.03)', offset: 0.46 },
      { transform: 'scaleX(1.07)', offset: 0.78 },
      { transform: 'scaleX(1)' }
    ], flipOpts);
    // ⚠ The face swap rides the SAME timeline as the squash rather than a
    //   setTimeout. A throttled or delayed timer would otherwise let the card
    //   finish flipping while still showing its back — the probe caught exactly
    //   that. A hard step at the squash's narrowest frame (0.46) is invisible.
    var swapOpts = { duration: tier.flip, delay: flipStart, easing: 'linear', fill: 'both' };
    run(back,  [{ opacity: 1, offset: 0 }, { opacity: 1, offset: 0.459 },
                { opacity: 0, offset: 0.46 }, { opacity: 0, offset: 1 }], swapOpts);
    run(front, [{ opacity: 0, offset: 0 }, { opacity: 0, offset: 0.459 },
                { opacity: 1, offset: 0.46 }, { opacity: 1, offset: 1 }], swapOpts);

    // Rim flash on the turn — the "hard hit" between anticipation and settle.
    run(rim, [
      { opacity: 0 }, { opacity: 1, offset: 0.16 }, { opacity: 0.55, offset: 0.6 }, { opacity: 0 }
    ], { duration: tier.flip + HOLD, delay: flipStart, easing: 'linear', fill: 'both' });

    // Local halo — card-sized, dark-stopped, gone before the settle ends.
    run(halo, [
      { opacity: 0 },
      { opacity: 0.95, offset: F / tEnd },
      { opacity: 0.95, offset: tSettle / tEnd },
      { opacity: 0 }
    ], { duration: tEnd, delay: delay, easing: 'linear', fill: 'both' });

    if (cap) {
      /* ── ROUND 2: TWO CARD NAMES ON SCREEN AT ONCE WERE UNREADABLE ─────────
         Measured at QUICK scale, pills were 142–268px wide against a 102.6px
         anchor gap (1.4x–2.6x), at the same `cy`, overlapping ~264ms with both
         above 0.5 opacity — literally `Abyssion the FAsh Revenant Prime`. The
         cards cascade fine; only the text collided. Fixed two ways, the first a
         proof rather than a tuning:

         1. The caption is visible ONLY over [F, tSettle + CAP_OUT] — from the
            moment its card reaches the anchor until just after it leaves. Card
            k+1's caption opens at `stagger + F`, so two captions cannot coexist
            as long as  stagger >= hold + CAP_OUT:
              FULL 700 >= 620+60 ✓   QUICK 360 >= 280+60 ✓   DEAL has no caption.
            Asserted in the probe, because the QUICK margin is only 20ms.
         2. The pill is COUNTER-SCALED. Being a child of the ghost it inherited
            the tier scale, so one 165px pill became 339px at FULL — which is
            also why it dwarfed the spacing. `CAP_SCALE / s` renders it at one
            constant size in every tier, which bar item 6 (consistency) wants
            anyway.
            ⚠ This used to claim `transform-origin: 50% 0` in draw.css kept the
              `translate(-50%,·)` centring correct. THAT RULE DOES NOT EXIST —
              draw.css sets `transform-origin: 50% 50%` in both places, and the
              centring measures correct anyway (centring error 0.0px at every
              tier). The centring survives because `translate(-50%,·)` is applied
              in the same transform list, before the scale, so the origin never
              enters it. Corrected rather than deleted, because the original note
              would have had a future editor "fix" draw.css to match a rule that
              was never there.

         ⚠ The hold-at-0 keyframe is load-bearing: without it the name is legible
           while the card is still a face-down back mid-flight. And the overall
           easing MUST stay linear — an option-level ease warps PROGRESS before
           keyframe interpolation, which is how the name bled in early twice. */
      var kS = (CAP_SCALE / s).toFixed(4);
      var capT = function (dy) { return 'translate(-50%,' + dy + 'px) scale(' + kS + ')'; };
      run(cap, [
        { opacity: 0, transform: capT(6), offset: 0 },
        { opacity: 0, transform: capT(6), offset: F / tEnd, easing: 'ease-out' },
        { opacity: 1, transform: capT(0), offset: Math.min(0.99, (F + 90) / tEnd) },
        { opacity: 1, transform: capT(0), offset: Math.min(0.995, tSettle / tEnd) },
        { opacity: 0, transform: capT(4), offset: Math.min(0.999, (tSettle + CAP_OUT) / tEnd) },
        { opacity: 0, transform: capT(4), offset: 1 }
      ], { duration: tEnd, delay: delay, easing: 'linear', fill: 'both' });
    }

    /* ── Reveal → hand. The card is RE-QUERIED here rather than held by
          reference: the strip may have re-rendered (element identity changes on
          every render) or re-ordered while the card was being read. If it has
          left the hand entirely — played, discarded, tributed mid-reveal — the
          ghost fades where it is instead of flying to a rectangle that no longer
          means anything.

          ⚠ Only the horizontal position is taken from the live rect. Under the
            arrive animation's `backwards` fill the element is scaled about its
            centre and pushed down 15px: `left + width/2` survives that exactly
            (centre-origin scaling does not move the centre), `top + height/2`
            does not. The vertical rest comes from the captured rect instead, and
            a viewport resize — the only thing that could move it — already
            force-finishes the whole sequence. */
    at(delay + tSettle, function () {
      var live = document.querySelector('.hand-strip-cards .hand-card[data-card="' + cssEsc(id) + '"]');
      var lr = live ? live.getBoundingClientRect() : null;
      var dest = (lr && (lr.width || lr.height))
        ? { cx: lr.left + lr.width / 2, cy: target.cy, w: w, h: h }
        : null;
      // Hand the transform over cleanly — two fill:both animations on the same
      // property would otherwise both be holding a value.
      if (flightAnim) { try { flightAnim.cancel(); } catch (e) {} }
      if (!dest) {
        g.style.transform = T(ax, ay, w, h, s);
        run(g, [{ opacity: 1 }, { opacity: 0 }], { duration: 180, easing: 'ease-out', fill: 'both' });
        at(200, function () { try { g.remove(); } catch (e) {} });
        return;
      }
      run(g, [
        { transform: T(ax, ay, w, h, s),              opacity: 1, offset: 0 },
        { transform: T(dest.cx, dest.cy, w, h, 1.10), opacity: 1, offset: 0.74 },
        { transform: T(dest.cx, dest.cy, w, h, 1),    opacity: 0, offset: 1 }
      ], { duration: SET, easing: 'cubic-bezier(.42,0,.22,1)', fill: 'both' });
      at(SET + 20, function () { try { g.remove(); } catch (e) {} });
    });
  }

  /* ═══ OPPONENT DRAW ══════════════════════════════════════════════════════
     Reads deliberately differently: a face-down back, smaller, faster, arcing
     to THEIR side of the screen and shrinking away. No flip, no halo, no
     caption, no reveal — you learn that they drew, never what they drew. */
  function flyFoe(n, isRm) {
    var src = document.getElementById('foeDeck');
    var origin = rectOf(src);
    if (!origin) return;
    var dest = foeHandAnchor(src);
    if (!dest) return;
    var vh = window.innerHeight || 800;
    var ow = origin.w, oh = origin.h;

    for (var i = 0; i < n; i++) {
      (function (i) {
        var g = document.createElement('div');
        g.className = 'drawfx-ghost';
        g.setAttribute('data-drawfx-for', 'foe');
        g.style.width = ow + 'px';
        g.style.height = oh + 'px';
        g.style.transform = T(origin.cx, origin.cy, ow, oh, 1);
        var flip = mk('drawfx-flip'), back = mk('drawfx-face drawfx-back');
        var img = document.createElement('img');
        img.alt = ''; img.draggable = false;
        img.onerror = function () { try { this.remove(); } catch (e) {} };
        img.src = cardBackSrc('ai');
        back.appendChild(img); flip.appendChild(back); g.appendChild(flip);
        ensureLayer().appendChild(g);

        var d = i * FOE_STAGGER;
        if (isRm) {
          run(g, [{ opacity: 0 }, { opacity: 0.9, offset: 0.4 }, { opacity: 0 }],
              { duration: FOE_FLIGHT, delay: d, easing: 'linear', fill: 'both' });
        } else {
          var mx = origin.cx + (dest.cx - origin.cx) * 0.5;
          var my = origin.cy + (dest.cy - origin.cy) * 0.34 - Math.min(60, vh * 0.07);
          run(g, [
            { transform: T(origin.cx, origin.cy, ow, oh, 1),   opacity: 0, offset: 0 },
            { transform: T(origin.cx, origin.cy, ow, oh, 1),   opacity: 1, offset: 0.12 },
            { transform: T(mx, my, ow, oh, 0.92),              opacity: 1, offset: 0.55 },
            { transform: T(dest.cx, dest.cy, ow, oh, 0.52),    opacity: 0, offset: 1 }
          ], { duration: FOE_FLIGHT, delay: d, easing: 'cubic-bezier(.3,.7,.3,1)', fill: 'both' });
        }
        at(d + FOE_FLIGHT + 30, function () { try { g.remove(); } catch (e) {} });
      })(i);
    }
  }

  /* Where the opponent's drawn card is going.
     ⚠ Do NOT assume `.hero-bar.ai`. It exists in the big-hero-bar layout and is
       simply ABSENT in the `.bsx` sidebar layout — checked against a live duel,
       where `.hero-bar.ai`, `#oppName`, `.opp` and `.unit.ai` all resolved to
       null. Falling back to `#foeDeck` itself (the old chain's last resort) sent
       the card from the deck to the deck: a flight of zero length that reads as
       a card twitching in place.
     The board's TOP EDGE is the honest destination and is layout-independent —
     the opponent's half of the board is the top half, and their hand is off the
     screen above it, which is where Master Duel puts it too. */
  function foeHandAnchor(src) {
    var el = document.querySelector('.hero-bar.ai') || document.getElementById('oppName');
    var r = rectOf(el);
    if (r) return r;
    var b = rectOf(document.querySelector('.board'));
    if (b) return { cx: b.cx, cy: Math.max(24, b.cy - b.h / 2 - 30), w: b.w, h: b.h };
    var vw = window.innerWidth || 1280;
    var o = rectOf(src);
    return { cx: o ? (o.cx + vw * 0.5) / 2 : vw * 0.5, cy: 40, w: 10, h: 10 };
  }

  /* ── Small DOM readers ────────────────────────────────────────────────── */
  function mk(cls) { var d = document.createElement('div'); d.className = cls; return d; }

  function cardBackSrc(side) {
    try {
      // Read from the live DOM first, so an equipped deck sleeve is honoured
      // automatically and the foe always gets the default back — exactly the
      // rule renderBattlePiles already implements. The literal is last resort.
      var el = document.querySelector((side === 'ai' ? '#foeDeck' : '#yourDeck') + ' img.cbk');
      var src = el && el.getAttribute('src');
      if (src) return src;
    } catch (e) {}
    return 'assets/artwork/cardback.png?v=5';
  }

  function pileCount(id) {
    try {
      var el = document.querySelector('#' + id + ' .count i');
      if (!el) return null;
      var n = parseInt(String(el.textContent).replace(/[^\d-]/g, ''), 10);
      return isFinite(n) ? n : null;
    } catch (e) { return null; }
  }

  function readName(el) {
    try {
      var n = el.querySelector('.hcfa-name-inner') || el.querySelector('.hand-card-name');
      var t = n ? String(n.textContent || '').trim() : '';
      if (!t) { var a = el.querySelector('img[alt]'); t = (a && a.getAttribute('alt')) || ''; }
      if (!t) return 'Card';
      return t.length > 34 ? t.slice(0, 33) + '\u2026' : t;
    } catch (e) { return 'Card'; }
  }
  function readSub(el) {
    try {
      var ty = el.querySelector('.hcfa-type') || el.querySelector('.hand-card-type');
      var cost = el.querySelector('.card-cost-orb');
      var t = ty ? String(ty.textContent || '').replace(/\s+/g, ' ').trim().split('\u00b7')[0].trim() : '';
      var c = cost ? String(cost.textContent || '').trim() : '';
      return (t || 'CARD') + (c ? '  \u00b7  ' + c + ' \u26a1' : '');
    } catch (e) { return 'CARD'; }
  }
  function cssEsc(v) { return String(v).replace(/["\\]/g, '\\$&'); }

  /* ═══ THE SCAN ═══════════════════════════════════════════════════════════
     Runs SYNCHRONOUSLY inside the MutationObserver callback. That callback is a
     microtask, which lands after the render's innerHTML write but BEFORE the
     browser paints — so applying `.drawfx-arrive` here is flash-free. Only the
     rect-reading ghost construction is deferred to rAF, and it reads each rect
     exactly once, never in a loop and never per frame.
     ⚠ We mutate className here; the observer is childList-only, so this cannot
       re-enter itself. */
  function scan() {
    var host = document.querySelector('.hand-strip-cards');
    if (!host) {
      /* Left the battle screen. Tear the flourish down, but ⚠ KEEP `known`.
         Nulling it made a re-mount (navigate away and back, an MP resync) look
         like a hand that appeared out of nowhere, and re-deal the whole thing.
         Keeping the id set means a re-mount is a no-op — the ids match — while a
         genuinely NEW battle still deals, because every instanceId differs and
         the whole-hand-new test below catches it. */
      if (known !== null) { pileWas = {}; finishAll('left'); }
      return;
    }

    // Pile deltas. POSITIVE means the pile SHRANK by that many.
    var pd = {}, ids = ['yourDeck', 'graveyard', 'foeDeck', 'foeGrave'], i;
    for (i = 0; i < ids.length; i++) {
      var id = ids[i], n = pileCount(id);
      pd[id] = (n === null || pileWas[id] == null) ? 0 : (pileWas[id] - n);
      if (n !== null) pileWas[id] = n;
    }

    var els = host.querySelectorAll('.hand-card[data-card]');
    var nowIds = [];
    for (i = 0; i < els.length; i++) nowIds.push(els[i].getAttribute('data-card'));

    var first = (known === null);
    var fresh = [];
    if (first) {
      for (i = 0; i < els.length; i++) fresh.push(els[i]);
    } else {
      for (i = 0; i < els.length; i++) if (!known.has(nowIds[i])) fresh.push(els[i]);
    }
    /* ⚠ BEFORE any early-out. A re-render with NO new cards is precisely the
       case that used to un-hide the card being revealed. */
    reapplyPending();

    /* 🔴 A SECOND DRAW WAITS — IT DOES NOT CUT THE FIRST SHORT.
       Reported: animations get cut off when something else happens.
       beginSequence() used to open with finishAll('superseded'), so a card
       arriving mid-reveal (a draw, then an effect that draws again) killed the
       reveal already on screen.
       ⚠ "known" is deliberately NOT committed on this path. It is what marks a
         card as already-seen, so committing it here would make the deferred
         re-scan find nothing and the second card would never animate at all —
         trading a truncated reveal for a missing one. Leaving it uncommitted
         keeps those cards 'new' until the re-scan can actually play them. */
    if (running && seqOwner === 'player' && fresh.length) { rescanWanted = true; return; }

    known = new Set(nowIds);

    var isRm = reduced();

    /* Opponent. A mill also shrinks their deck, so subtract however much their
       graveyard grew in the same tick (pd.foeGrave is negative when it grows).
       Imprecise if a unit dies on the same render — noted in NOTES; the cost is
       one extra face-down back drifting to their side, never a wrong hand. */
    var foeN = pd.foeDeck - Math.max(0, -pd.foeGrave);
    var pN = fresh.length;

    if (!pN && foeN > 0 && CAN_ANIMATE) {
      var fN = Math.min(FOE_MAX, foeN);
      var fTotal = (fN - 1) * FOE_STAGGER + FOE_FLIGHT;
      joinSequence(fTotal);
      requestAnimationFrame(function () {
        if (!running) return;
        try { flyFoe(fN, isRm); } catch (e) {}
        /* ⚠ The foe branch used to `return` without arming a normal retirement,
           so the ONLY thing that ever cleared `running` for the commonest
           opponent event was the emergency hard timeout — and the global
           capture-phase skip listeners stayed attached for its full ~1.1s. The
           safety net should not be the mechanism. Retire on our own schedule,
           but only if this sequence is still foe-owned (a player draw that
           arrived meanwhile owns it now and must not be cut short). */
        at(fTotal + 200, function () { if (seqOwner === 'foe') finishAll('foe-done'); });
      });
      return;
    }
    if (!pN) return;

    /* A whole hand arriving at once is a DEAL, however we got there: the first
       hand after page load (`first`), or every card in the strip being new (a
       fresh battle after `known` was deliberately kept across the unmount). Seven
       consecutive 1.29s reveals is a loading screen, not a flourish. */
    var wholeHandNew = (pN === nowIds.length && pN >= 3);
    var tier = (first || wholeHandNew) ? TIERS.deal
             : (pN <= 2 ? TIERS.full : pN <= 4 ? TIERS.quick : TIERS.deal);
    var total = tier.flight + tier.hold + tier.settle + (pN - 1) * tier.stagger;
    beginSequence(total, 'player');

    /* 1a) Capture each new card's RESTING rect BEFORE anything is applied to it.
           This forces one style+layout flush — once per draw event, never per
           frame, and the browser was about to lay this render out anyway. It has
           to happen here: the moment `.drawfx-arrive` lands, `backwards` fill
           holds `translateY(15px) scale(0.90)` and every measurement of that
           element is 10% small and 15px low for the next second. */
    var rests = [];
    for (i = 0; i < pN; i++) rests.push(rectOf(fresh[i]));

    /* 1b) Mark the real cards NOW, synchronously, so they never flash before
           their ghost arrives. `backwards` fill plus the per-card delay does the
           hiding; the class itself can only ever animate a card INTO view.
           The same schedule goes into `pending` so reapplyPending() can restore
           it — at the correct REMAINING delay — after any re-render. */
    seqStart = Date.now();
    pending = new Map();
    for (i = 0; i < pN; i++) {
      var inAt = Math.max(0, i * tier.stagger + tier.flight + tier.hold + tier.settle - 150);
      try {
        pending.set(fresh[i].getAttribute('data-card'), inAt);
        fresh[i].style.setProperty('--drawfx-in', inAt + 'ms');
        fresh[i].classList.add('drawfx-arrive');
      } catch (e) {}
    }

    if (!CAN_ANIMATE) {
      // No WAAPI: the arrive animation alone is the effect. Still correct, still
      // self-healing. Retire the sequence once the last card has landed.
      at(total + 200, function () { finishAll('no-waapi'); });
      return;
    }

    /* 2) Ghost construction is deferred one frame so the rect reads happen after
          the browser has laid the new strip out. */
    var pileId = (pd.yourDeck > 0) ? 'yourDeck'
               : (pd.graveyard > 0) ? 'graveyard'    // grave shrank => a salvage
               : 'yourDeck';
    var snapshot = [];
    for (i = 0; i < Math.min(MAX_GHOSTS, pN); i++) {
      if (rests[i]) snapshot.push({ id: fresh[i].getAttribute('data-card'), rest: rests[i], k: i });
    }

    requestAnimationFrame(function () {
      if (!running) return;                          // skipped before we drew a thing
      var originEl = document.getElementById(pileId) || document.getElementById('yourDeck');
      var origin = rectOf(originEl);
      if (!origin) {
        // Sidebar collapsed / not rendered — fly in from the right edge at the
        // hand's own height rather than dropping the effect entirely.
        var vw = window.innerWidth || 1280, vh = window.innerHeight || 800;
        origin = { cx: vw - 52, cy: vh * 0.46, w: 60, h: 84 };
      } else if (!isRm) {
        try {
          originEl.classList.remove('drawfx-pull');
          void originEl.offsetWidth;                 // restart the recoil
          originEl.classList.add('drawfx-pull');
          at(300, function () { try { originEl.classList.remove('drawfx-pull'); } catch (e) {} });
        } catch (e) {}
      }
      for (var k = 0; k < snapshot.length; k++) {
        var el = document.querySelector('.hand-strip-cards .hand-card[data-card="' + cssEsc(snapshot[k].id) + '"]');
        if (!el) continue;
        try { flyOne(el, snapshot[k].id, snapshot[k].rest, origin, tier, snapshot[k].k * tier.stagger, isRm); } catch (e) {}
      }
      if (foeN > 0) { try { flyFoe(Math.min(FOE_MAX, foeN), isRm); } catch (e) {} }
      at(total + 260, function () { finishAll('done'); });
    });
  }

  try {
    var mo = new MutationObserver(function () {
      // Cheapest possible early-out: nothing on screen that we care about.
      if (!document.querySelector('.hand-strip-cards') && known === null) return;
      try { scan(); } catch (e) { try { console.warn('[drawfx]', e); } catch (_e) {} }
    });
    mo.observe(document.body, { childList: true, subtree: true });
  } catch (e) {}

  // A backgrounded tab throttles timers; come back to a clean board rather than
  // to a half-finished flight.
  document.addEventListener('visibilitychange', function () { if (document.hidden) finishAll('hidden'); });
  addEventListener('pagehide', function () { finishAll('pagehide'); });
  // A resize mid-flight invalidates every rect measured for it.
  addEventListener('resize', function () { if (running) finishAll('resize'); }, { passive: true });

  /* ── Probe surface ────────────────────────────────────────────────────────
     The Browser pane never composites, so the only way to verify any of this is
     to assert on the DOM. Exposed deliberately: module-scope consts in
     index.html are lexical bindings, so a probe has nothing else to grab. */
  window.DrawFX = {
    skip:  function () { finishAll('api'); },
    scan:  function () { try { scan(); } catch (e) { return String(e); } return 'ok'; },
    reset: function () { finishAll('reset'); known = null; pileWas = {}; },
    debug: function () {
      var host = document.querySelector('.hand-strip-cards');
      var hand = host ? [].slice.call(host.querySelectorAll('.hand-card[data-card]')) : [];
      var lay = document.getElementById('drawfx-layer');
      return {
        running: running, why: lastWhy,
        ghosts: lay ? lay.querySelectorAll('.drawfx-ghost').length : 0,
        ghostAt: lay ? [].slice.call(lay.querySelectorAll('.drawfx-ghost')).map(function (g) {
          var r = g.getBoundingClientRect();
          return { of: g.getAttribute('data-drawfx-for'),
                   cx: +(r.left + r.width / 2).toFixed(1), cy: +(r.top + r.height / 2).toFixed(1),
                   w: +r.width.toFixed(1), h: +r.height.toFixed(1),
                   op: +getComputedStyle(g).opacity };
        }) : [],
        timers: timers.length, anims: anims.length,
        arriving: document.querySelectorAll('.drawfx-arrive').length,
        known: known ? known.size : null,
        piles: JSON.parse(JSON.stringify(pileWas)),
        layerBg: lay ? getComputedStyle(lay).backgroundColor : null,
        hand: hand.map(function (e) {
          var cs = getComputedStyle(e);
          return { id: e.getAttribute('data-card'), op: cs.opacity, vis: cs.visibility, disp: cs.display };
        })
      };
    },
    _rect: function (sel) { return rectOf(document.querySelector(sel)); },
    _tiers: TIERS
  };
})();
