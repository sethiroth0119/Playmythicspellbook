/* ============================================================================
   r1_frames.js — companion to r1_frames.css (ROUND 1: frame sizing/anchoring)

   WHY THERE IS ANY JS AT ALL
   Every CSS image-sizing mode (contain / cover / fill / none / scale-down)
   derives its scale from THAT image's own intrinsic size. 30% of the published
   sprite animations have frames whose canvases differ (measured: 67 of 225
   idle sets, aspect-ratio spread up to 108%), so "one constant scale for the
   whole animation" is not expressible in CSS — CSS cannot know the other
   frames exist. This file supplies the only two numbers CSS is missing:

       --sf-w = naturalWidth  / M * 100      (percent of the art window)
       --sf-h = naturalHeight / M * 100
       M      = the largest canvas edge seen in this animation

   Everything else — position, anchoring, the cascade fight — lives in the CSS.

   with M measured PER AXIS (Mw = widest canvas in the reel, Mh = tallest), so
   the constant scale the CSS ends up applying is

       min(boxW / Mw, boxH / Mh)

   — the largest scale at which every frame of the reel still fits. That is
   exactly the scale the reel's BIGGEST pose already had before this change, so
   a fixed sprite is never smaller than it used to be, only steady. (A single
   shared reference edge, max(Mw,Mh), was the first cut: it is also stable but
   it treats the art window as square and rendered the worst reels ~25% smaller
   than any frame had ever been — a visible shrink, i.e. a new complaint.)

   COST
   * no getBoundingClientRect, no layout reads, no rAF, no polling timer;
   * naturalWidth/naturalHeight are plain property reads on an <img>;
   * two custom-property writes per frame, SKIPPED when the value is unchanged —
     so the 158 uniform sets write twice per element, ever, and only the sets
     that actually change canvas write while they play;
   * driven by a single capturing `load` listener (fires once per src swap /
     per frame image) plus a debounced MutationObserver as a safety net.

   SCOPE
   Board sprites only (`.board .unit-icon .sprite-stack`). It does not touch
   the idle-animation layer: no @keyframes, no frame timing, no
   DEFAULT_SPRITE_FRAME_MS, no change to will-change / contain / isolation.
   ========================================================================= */
(function () {
  'use strict';
  if (typeof window === 'undefined' || window.__sfFramesR1) return;
  window.__sfFramesR1 = true;

  // --- per-animation reference canvas --------------------------------------
  // key: "<spriteId>|<anim>"  ->  [Mw, Mh] (widest / tallest canvas seen, px)
  //
  // Keyed per ANIMATION, not per character: each clip is authored as its own
  // reel and its own canvas envelope is its honest reference. (Keying per
  // character would mean the first attack a unit ever throws permanently
  // shrinks its idle, because attack frames are usually the widest.)
  var LS_KEY = 'hg_sf_ref_v2';
  var TTL_MS = 14 * 24 * 3600 * 1000;   // art can be re-uploaded; don't pin a
  var MAX_KEYS = 800;                   // stale reference edge forever
  var ref = Object.create(null);
  var persist = true;

  try {
    var raw = localStorage.getItem(LS_KEY);
    if (raw) {
      var blob = JSON.parse(raw);
      if (blob && blob.v === 2 && blob.t && (Date.now() - blob.t) < TTL_MS && blob.m) ref = blob.m;
    }
  } catch (e) { /* private mode / corrupt value — start clean */ }

  var saveT = 0;
  function scheduleSave() {
    if (!persist || saveT) return;
    saveT = setTimeout(function () {
      saveT = 0;
      try {
        var keys = Object.keys(ref);
        if (keys.length > MAX_KEYS) {            // bounded: never a storage leak
          var trimmed = Object.create(null);
          for (var i = keys.length - MAX_KEYS; i < keys.length; i++) trimmed[keys[i]] = ref[keys[i]];
          ref = trimmed;
        }
        localStorage.setItem(LS_KEY, JSON.stringify({ v: 2, t: Date.now(), m: ref }));
      } catch (e) { persist = false; }           // quota/denied → run in-memory
    }, 4000);
  }

  // --- helpers --------------------------------------------------------------
  function stackOf(img) {
    var p = img.parentNode;
    return (p && p.classList && p.classList.contains('sprite-stack')) ? p : null;
  }
  function isBoardStack(st) {
    try { return !!(st.closest('.unit-icon') && st.closest('.board')); } catch (e) { return false; }
  }
  function animOf(img, st) {
    return img.getAttribute('data-bsanim') || st.getAttribute('data-sprite-anim') || 'idle';
  }
  function sidOf(img, st) {
    return img.getAttribute('data-bsid') || st.getAttribute('data-sprite-id') || '';
  }
  // The bounded single-<img> path paints a POSTER first — getThumb()'s ~160px
  // still, or the 1x1 transparent pixel — before the ticker takes over. Those
  // are not frames of the animation; learning M from a thumbnail would shrink
  // the whole character permanently. getSpriteFrames() is a top-level function
  // declaration in index.html, so it IS reachable on window (unlike the
  // top-level `const` globals), and the bounded ticker assigns raw frame URLs.
  function isAnimationFrame(img, sid, anim) {
    try {
      if (typeof window.getSpriteFrames !== 'function') return true;
      var fr = window.getSpriteFrames(sid, anim) || window.getSpriteFrames(sid, 'idle');
      if (!fr || !fr.length) return true;        // can't tell → trust the image
      var src = img.currentSrc || img.src || '';
      return fr.indexOf(src) >= 0;
    } catch (e) { return true; }
  }

  // --- the whole fix --------------------------------------------------------
  function applyStack(st) {
    var kids = st.children, n = kids.length;
    if (!n) return;
    var single = (n === 1);
    var key = '', sid = '', anim = '', mw = 0, mh = 0, i, im, w, h;

    for (i = 0; i < n; i++) {
      im = kids[i];
      if (!im || im.tagName !== 'IMG') continue;
      if (!key) {
        sid = sidOf(im, st);
        if (!sid) return;                        // static thumbnail span — leave it alone
        anim = animOf(im, st);
        key = sid + '|' + anim;
      }
      w = im.naturalWidth; h = im.naturalHeight;
      if (!(w > 4 && h > 4)) continue;           // unloaded / broken / 1x1 pixel
      // In a multi-frame stack every child IS a frame, so the poster-frame
      // guard is only needed (and only correct) for the single-img path: that
      // stack's src is a raw frame URL, while stack frames go through
      // _imgSrc() and can be blob: URLs that never match the stored list.
      if (single && !isAnimationFrame(im, sid, anim)) continue;
      if (w > mw) mw = w;
      if (h > mh) mh = h;
    }
    if (!key) return;

    // Mw/Mh only ever grow. The multi-frame stack has every frame in the DOM,
    // so it is exact as soon as they decode; the bounded single-<img> path
    // learns its reel over one loop (~1.5-4s the first time a unit is ever
    // seen) and the persisted value makes it exact from frame 1 afterwards.
    // It cannot overflow the art window while learning: the frame being
    // written is always part of the max above, so its own box is <= 100%.
    var cur = ref[key];
    if (!cur || cur.length !== 2) cur = [0, 0];
    if (mw > cur[0] || mh > cur[1]) {
      cur = [Math.max(mw, cur[0]), Math.max(mh, cur[1])];
      ref[key] = cur; scheduleSave();
    }
    if (!(cur[0] > 0 && cur[1] > 0)) return;

    for (i = 0; i < n; i++) {
      im = kids[i];
      if (!im || im.tagName !== 'IMG') continue;
      w = im.naturalWidth; h = im.naturalHeight;
      if (!(w > 4 && h > 4)) continue;
      if (single && !isAnimationFrame(im, sid, anim)) continue;
      // The element box carries this frame's canvas as a fraction of the reel's
      // reference canvas, per axis. `object-fit: contain` then resolves to
      // min(boxW/Mw, boxH/Mh) — the same number for every frame, whatever
      // shape the art window is.
      // 4 decimal places, not 2: at 2dp the rounding of the percentage was
      // still worth ~0.26% of scale wobble on a 25-frame reel, which is the
      // only wobble that survived the fix. At 4dp it is ~0.003% — under a
      // hundredth of a device pixel.
      var pw = Math.round(w / cur[0] * 1000000) / 10000;
      var ph = Math.round(h / cur[1] * 1000000) / 10000;
      if (im.__sfw === pw && im.__sfh === ph) continue;   // no-op for uniform sets
      im.__sfw = pw; im.__sfh = ph;
      im.style.setProperty('--sf-w', pw);
      im.style.setProperty('--sf-h', ph);
    }
    if (st.getAttribute('data-sf-fit') !== '1') st.setAttribute('data-sf-fit', '1');
  }

  // --- wiring ---------------------------------------------------------------
  // `load` does not bubble, but it does capture. One listener covers every
  // frame image of every stack, including cached ones (load still fires) and
  // every src swap the bounded board ticker makes.
  document.addEventListener('load', function (e) {
    var t = e.target;
    if (!t || t.tagName !== 'IMG') return;
    var st = stackOf(t);
    if (st && isBoardStack(st)) applyStack(st);
  }, true);

  var pending = 0;
  function sweep() {
    pending = 0;
    var l;
    try { l = document.querySelectorAll('.board .unit-icon .sprite-stack'); } catch (e) { return; }
    for (var i = 0; i < l.length; i++) applyStack(l[i]);
  }
  function schedule() { if (!pending) pending = setTimeout(sweep, 32); }

  // Safety net for images that were already complete before this ran (a board
  // re-render reusing cached frames). childList only — the ticker's src swaps
  // and .is-on toggles are ATTRIBUTE mutations and never wake this up.
  try {
    new MutationObserver(function (muts) {
      for (var i = 0; i < muts.length; i++) {
        var a = muts[i].addedNodes;
        for (var j = 0; j < a.length; j++) {
          var nd = a[j];
          if (!nd || nd.nodeType !== 1) continue;
          if ((nd.className && String(nd.className).indexOf('sprite-stack') >= 0) ||
              (nd.querySelector && nd.querySelector('.sprite-stack'))) { schedule(); return; }
        }
      }
    }).observe(document.documentElement, { childList: true, subtree: true });
  } catch (e) {}

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', sweep);
  else sweep();
})();
