/* ═══════════════════════════════════════════════════════════════════════════
   🩹 --hand-clear NOW MEASURES ITSELF

   Reported: the board's bottom rows are clipped by the hand strip on a laptop.

   The cause is drift between two numbers that are supposed to agree but are
   maintained by hand in different places:

     .battle-screen { --hand-clear: 138px }   ← what the board budgets away
     @media (max-height: 900px) { --hand-clear: 116px }
     @media (max-height: 820px) { --hand-clear:  98px }

     .hand-strip-cards .hand-card { width: 140px | 118px | 100px }  ← what the
     strip actually IS. The cards have no fixed height; their height falls out
     of width x card aspect, plus the strip's own padding.

   So the reservation is keyed on VIEWPORT HEIGHT while the thing being
   reserved for is keyed on CARD WIDTH. Any change to card sizing, aspect,
   padding or font silently desyncs them, and the board loses rows with no
   error anywhere. The source comment even says the strip "adds no height to
   the strip (which is budgeted against the board above it)" — the intent was
   right; the coupling was never enforced.

   This measures the strip and writes --hand-clear from it, so the two can
   never disagree again regardless of who edits what.

   ⚠ Sets the variable on .battle-screen, the same element the CSS declares it
     on, so every existing consumer (the board height calc at ~6947, the narrow
     rail) picks it up untouched. Nothing else needs to know this exists.
   ═══════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  if (window.__handClearWired) return;      // idempotent — safe to re-append
  window.__handClearWired = true;

  var MIN = 72;      // never reserve less than this; a tiny strip is still a strip
  var MAX = 260;     // guard against a pathological measurement eating the board
  var raf = 0;

  function apply() {
    raf = 0;
    try {
      var screen = document.querySelector('.battle-screen');
      var strip = document.querySelector('.hand-strip');
      if (!screen) return;
      if (!strip) {
        // No hand on screen (spectator, some modals) — release the reservation
        // rather than leaving a stale one that shrinks the board for nothing.
        screen.style.removeProperty('--hand-clear');
        return;
      }
      var h = Math.ceil(strip.getBoundingClientRect().height);
      if (!h) return;                       // hidden / mid-layout — leave the CSS value
      // A few px of breathing room so the last row is not flush against the cards.
      var want = Math.min(MAX, Math.max(MIN, h + 6));
      var cur = parseInt(screen.style.getPropertyValue('--hand-clear'), 10) || 0;
      // Only write on a real change — writing every frame would invalidate
      // layout continuously and defeat the point.
      if (Math.abs(cur - want) >= 2) screen.style.setProperty('--hand-clear', want + 'px');
    } catch (e) { /* never let a fit helper break the battle */ }
  }

  function schedule() {
    // ⚠ rAF-coalesced, NOT called directly from the observer. A ResizeObserver
    //   that writes a value which affects layout can re-trigger itself; batching
    //   to the next frame plus the >=2px threshold above stops the loop.
    if (raf) return;
    raf = (window.requestAnimationFrame || function (cb) { return setTimeout(cb, 16); })(apply);
  }

  try {
    if (typeof ResizeObserver === 'function') {
      var ro = new ResizeObserver(schedule);
      // Observe the strip when it appears, and re-observe if the battle
      // re-renders it. A MutationObserver on body is cheap here because it is
      // filtered to childList and does no work unless the strip identity changed.
      var seen = null;
      var mo = new MutationObserver(function () {
        var s = document.querySelector('.hand-strip');
        if (s === seen) return;
        seen = s;
        try { ro.disconnect(); } catch (e) {}
        if (s) { try { ro.observe(s); } catch (e) {} }
        schedule();
      });
      mo.observe(document.body, { childList: true, subtree: true });
      var first = document.querySelector('.hand-strip');
      if (first) { seen = first; ro.observe(first); }
    }
  } catch (e) {}

  addEventListener('resize', schedule, { passive: true });
  addEventListener('orientationchange', schedule, { passive: true });
  schedule();
  // The strip's cards load art; re-measure once things have settled.
  setTimeout(schedule, 400);
  setTimeout(schedule, 1500);
})();
