/* =====================================================================
 * 🛠 GAME FIXES PACK — paste-in runtime patches
 * =====================================================================
 * Add as the LAST <script> before </body> (after the game's main script):
 *
 *     <script src="game-fixes.js"></script>
 *
 * or paste the whole file inside <script> ... </script> there.
 * A classic script (NOT type="module") — it must share the game's scope.
 *
 * WHAT'S INSIDE (each patch feature-detects and no-ops if the game code
 * it targets isn't present, so this is safe on any build):
 *
 *   FIX 1  console shim — "console.info is not a function" (the sign-in
 *          red banner). Some WebViews/launchers stub console with a
 *          partial object; the game has ~70 console.info calls.
 *   FIX 2  visibility-aware blob revocation — a blob: URL a live <img>
 *          is displaying is NEVER revoked; it's queued and revoked once
 *          it leaves the screen. Kills the root cause of blank sprites
 *          AND blank card art everywhere.
 *   FIX 3  _imgSrc cache eviction routed through FIX 2 (the data:→blob:
 *          cache could blank dozens of on-screen images in one eviction).
 *   FIX 4  LRU eviction guard — never evicts a sprite/card-art record
 *          whose URLs are on screen (card art previously had NO pinning
 *          at all; sprite pinning only covered the battle board).
 *   FIX 5  decode budget — stops stripping src from images the player is
 *          looking at on dense galleries (>160 art images in view).
 *   FIX 6  global image self-heal — anything that still errors recovers:
 *          sprite stacks re-read from disk and repaint, deferred card art
 *          re-grants its decode, dead blobs show a transparent pixel
 *          instead of the broken-image glyph. Capped at 2 retries.
 * ===================================================================== */
(function () {
  'use strict';

  /* ================= FIX 1 — console shim ============================ */
  try {
    var c = window.console = window.console || {};
    var noop = function () {};
    var base = (typeof c.log === 'function') ? c.log : noop;
    var names = ['log', 'info', 'warn', 'error', 'debug', 'trace', 'dir',
      'table', 'group', 'groupEnd', 'groupCollapsed', 'time', 'timeEnd',
      'count', 'assert'];
    for (var i = 0; i < names.length; i++) {
      if (typeof c[names[i]] !== 'function') {
        try { c[names[i]] = base.bind(c); } catch (e) { c[names[i]] = noop; }
      }
    }
  } catch (e) {}

  /* ================= FIX 2 — visibility-aware revocation ============= */
  // Snapshot every blob: src currently in a live <img> — one pass over
  // document.images, so checking a 100-frame record costs one DOM walk.
  function liveBlobSrcs() {
    var s = new Set();
    try {
      var imgs = document.images;
      for (var i = 0; i < imgs.length; i++) {
        var u = imgs[i].getAttribute('src');
        if (u && u.slice(0, 5) === 'blob:') s.add(u);
      }
    } catch (e) {}
    return s;
  }
  function urlInUse(u) {
    try {
      if (typeof u !== 'string' || !u) return false;
      return !!document.querySelector('img[src="' + u + '"]');
    } catch (e) { return true; }  // can't verify → assume in use (never break a live img)
  }
  var pendingRevokes = new Set();
  var sweepTimer = null;
  function sweep() {
    try {
      var live = liveBlobSrcs();
      pendingRevokes.forEach(function (u) {
        if (!live.has(u)) {
          try { URL.revokeObjectURL(u); } catch (e) {}
          pendingRevokes.delete(u);
        }
      });
    } catch (e) {}
    if (pendingRevokes.size === 0 && sweepTimer) { clearInterval(sweepTimer); sweepTimer = null; }
  }
  function safeRevoke(u) {
    try {
      if (typeof u !== 'string' || u.slice(0, 5) !== 'blob:') return;
      if (!urlInUse(u)) { try { URL.revokeObjectURL(u); } catch (e) {} return; }
      pendingRevokes.add(u);                       // still on screen → defer
      if (!sweepTimer) sweepTimer = setInterval(sweep, 4000);
    } catch (e) {}
  }
  function recInUse(rec) {
    try {
      if (!rec || typeof rec !== 'object') return false;
      var live = liveBlobSrcs();
      if (!live.size) return false;
      for (var k in rec) {
        var v = rec[k];
        if (Array.isArray(v)) { for (var i = 0; i < v.length; i++) { if (typeof v[i] === 'string' && live.has(v[i])) return true; } }
        else if (typeof v === 'string' && live.has(v)) return true;
      }
    } catch (e) { return true; }
    return false;
  }
  // Replace the game's revokers (function declarations are writable globals;
  // every internal call site resolves to these at call time).
  if (typeof window._revokeUrl === 'function') {
    window._revokeUrl = safeRevoke;
  }
  if (typeof window._revokeSpriteUrls === 'function') {
    window._revokeSpriteUrls = function (rec) {
      if (!rec || typeof rec !== 'object') return;
      for (var k in rec) {
        var v = rec[k];
        if (Array.isArray(v)) v.forEach(safeRevoke); else safeRevoke(v);
      }
    };
  }
  // Expose for the module files / debugging.
  try {
    window.__mg = window.__mg || {};
    window.__mg.safeRevoke = safeRevoke;
    window.__mg.revokeQueue = function () { return pendingRevokes.size; };
  } catch (e) {}

  /* ================= FIX 3 — _imgSrc cache eviction ================== */
  // Same logic as the original, but eviction defers instead of revoking a
  // URL that dozens of live <img> tags may share. Only installs when the
  // pieces it needs exist (they're global lexical bindings in the game
  // script, visible to this classic script).
  try {
    if (typeof window._imgSrc === 'function'
        && typeof _imgUrlCache !== 'undefined' && _imgUrlCache
        && typeof _imgUrlOrder !== 'undefined'
        && typeof _IMG_URL_CACHE_MAX !== 'undefined') {
      window._imgSrc = function (url) {
        try {
          if (typeof url !== 'string' || url.slice(0, 5) !== 'data:') return url;
          if (_imgUrlCache.has(url)) {
            var i = _imgUrlOrder.indexOf(url);
            if (i !== -1) _imgUrlOrder.splice(i, 1);
            _imgUrlOrder.push(url);
            return _imgUrlCache.get(url);
          }
          var b = (typeof _toBlobUrl === 'function') ? _toBlobUrl(url) : url;
          if (b && b !== url) {
            _imgUrlCache.set(url, b);
            _imgUrlOrder.push(url);
            while (_imgUrlOrder.length > _IMG_URL_CACHE_MAX) {
              var old = _imgUrlOrder.shift();
              safeRevoke(_imgUrlCache.get(old));   // 🛡 deferred if on screen
              _imgUrlCache.delete(old);
            }
          }
          return b;
        } catch (e) { return url; }
      };
    }
  } catch (e) {}

  /* ================= FIX 4 — LRU eviction guard ====================== */
  // Redefine _lazyTouch with the original algorithm + two guards:
  //  • card art in use on screen → keep (it previously had NO protection)
  //  • sprite record in use on screen → keep (covers non-battle screens,
  //    where the board ticker's _sprPinned never runs)
  try {
    if (typeof window._lazyTouch === 'function'
        && typeof _sprLRU !== 'undefined' && typeof _carLRU !== 'undefined'
        && typeof _LAZY_SPR_CAP !== 'undefined' && typeof _LAZY_CAR_CAP !== 'undefined'
        && typeof Forge !== 'undefined') {
      window._lazyTouch = function (kind, id) {
        var lru = kind === 'spr' ? _sprLRU : _carLRU;
        var cap = kind === 'spr' ? _LAZY_SPR_CAP : _LAZY_CAR_CAP;
        var store = kind === 'spr' ? Forge.sprites : Forge.cardArt;
        var idx = kind === 'spr' ? Forge._sprIds : Forge._carIds;
        var i = lru.indexOf(id);
        if (i !== -1) lru.splice(i, 1);
        lru.push(id);
        var guard = lru.length + 4;
        while (lru.length > cap && guard-- > 0) {
          var old = lru.shift();
          if (old === id) { lru.push(old); break; }
          if (idx && !idx.has(old)) { lru.push(old); continue; }         // unsaved upload — keep
          if (kind === 'spr' && typeof _sprPinned !== 'undefined' && _sprPinned.has(old)) { lru.push(old); continue; }
          if (store && store[old]) {
            // 🛡 never evict a record whose blob: URLs a live <img> shows
            var rec = store[old];
            var liveNow = (kind === 'spr') ? recInUse(rec)
              : (typeof rec === 'string' && rec.slice(0, 5) === 'blob:' && urlInUse(rec));
            if (liveNow) { lru.push(old); continue; }
            try { if (kind === 'spr') _revokeSpriteUrls(rec); else _revokeUrl(rec); } catch (e) {}
            try { delete store[old]; } catch (e) {}
          }
        }
      };
    }
  } catch (e) {}

  /* ================= FIX 5 — decode budget =========================== */
  // (a) A private IntersectionObserver marks every deferred-art <img>
  //     actually in view with data-art-vis (the game's own observer is
  //     untouched). (b) _grantDecode is redefined to evict only OFF-screen
  //     residents; if everything resident is visible, briefly exceed the
  //     cap — an over-budget frame beats a blank one.
  try {
    if (typeof IntersectionObserver !== 'undefined' && typeof MutationObserver !== 'undefined') {
      var visIO = new IntersectionObserver(function (entries) {
        for (var i = 0; i < entries.length; i++) {
          var el = entries[i].target;
          try {
            if (entries[i].isIntersecting) el.dataset.artVis = '1';
            else delete el.dataset.artVis;
          } catch (e) {}
        }
      }, { rootMargin: '120px' });
      var visScan = function () {
        try {
          var list = document.querySelectorAll('img.art-deferred:not([data-art-vis-obs])');
          for (var i = 0; i < list.length; i++) {
            list[i].setAttribute('data-art-vis-obs', '1');
            visIO.observe(list[i]);
          }
        } catch (e) {}
      };
      var visScanT = null;
      new MutationObserver(function () {
        if (visScanT) return;
        visScanT = setTimeout(function () { visScanT = null; visScan(); }, 120);
      }).observe(document.documentElement, { childList: true, subtree: true });
      visScan();
    }
    if (typeof window._grantDecode === 'function'
        && typeof _residentArtEls !== 'undefined'
        && typeof _pendingDecode !== 'undefined'
        && typeof _MAX_RESIDENT_ART !== 'undefined'
        && typeof _MAX_CONCURRENT_DECODES !== 'undefined'
        && typeof window._clearArtSrc === 'function'
        && typeof window._drainPending === 'function') {
      window._grantDecode = function (el, url) {
        if (!el || !url) return;
        if (el.getAttribute && el.getAttribute('src')) return;   // already decoding
        if (_residentArtEls.length >= _MAX_RESIDENT_ART) {
          var keep = [];
          var need = _residentArtEls.length - _MAX_RESIDENT_ART + 1;
          for (var i = 0; i < _residentArtEls.length; i++) {
            var r = _residentArtEls[i];
            if (r === el) { keep.push(r); continue; }
            var vis = !!(r && r.dataset && r.dataset.artVis) && r.isConnected;
            if (need > 0 && !vis) { _clearArtSrc(r); need--; }   // 🛡 off-screen only
            else keep.push(r);
          }
          _residentArtEls.length = 0;
          Array.prototype.push.apply(_residentArtEls, keep);
        }
        if (_decodeInFlight >= _MAX_CONCURRENT_DECODES) { _pendingDecode.push({ el: el, url: url }); return; }
        _decodeInFlight++;
        var settled = false;
        var done = function () {
          if (settled) return; settled = true;
          _decodeInFlight = Math.max(0, _decodeInFlight - 1);
          _drainPending();
        };
        try {
          el.src = url;
          _residentArtEls.push(el);
          if (el.decode) el.decode().then(done).catch(done); else done();
          setTimeout(done, 4000);
        } catch (e) { done(); }
      };
    }
  } catch (e) {}

  /* ================= FIX 6 — global image self-heal ================== */
  try {
    if (!window.__mgImgHealOn && typeof document !== 'undefined') {
      window.__mgImgHealOn = true;
      var TRANSPARENT = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
      document.addEventListener('error', function (ev) {
        try {
          var el = ev && ev.target;
          if (!el || String(el.tagName).toUpperCase() !== 'IMG') return;
          if (el.classList && el.classList.contains('bsprite')) return;  // has its own healer
          var tries = parseInt((el.dataset && el.dataset.healTries) || '0', 10) || 0;
          if (tries >= 2) { try { el.src = TRANSPARENT; } catch (e) {} return; }
          try { el.dataset.healTries = String(tries + 1); } catch (e) {}
          // renderIcon sprite frame → refresh the whole record from disk
          var stack = el.closest ? el.closest('.sprite-stack[data-sprite-id]') : null;
          if (stack) {
            var sid = stack.dataset && stack.dataset.spriteId;
            try { el.src = TRANSPARENT; } catch (e) {}
            if (sid) {
              try { if (typeof Forge !== 'undefined' && Forge.sprites) delete Forge.sprites[sid]; } catch (e) {}
              try { if (typeof _sprMissing !== 'undefined') _sprMissing.delete(sid); } catch (e) {}
              try { if (typeof _sprForceTried !== 'undefined') _sprForceTried.delete(sid); } catch (e) {}
              try {
                if (typeof _lazyLoadSprite === 'function') {
                  Promise.resolve(_lazyLoadSprite(sid, true)).then(function () {
                    try { if (typeof _lazyScheduleRender === 'function') _lazyScheduleRender(); } catch (e) {}
                  }).catch(function () {});
                }
              } catch (e) {}
            }
            return;
          }
          // deferred card art → drop the dead src, re-grant once
          if (el.dataset && el.dataset.artSrc) {
            var url = el.dataset.artSrc;
            try { el.removeAttribute('src'); } catch (e) {}
            setTimeout(function () {
              try { if (el.isConnected && typeof _grantDecode === 'function') _grantDecode(el, url); } catch (e) {}
            }, 700);
            return;
          }
          // any other dead blob → transparent pixel, not the broken glyph
          var src = el.getAttribute && el.getAttribute('src');
          if (typeof src === 'string' && src.slice(0, 5) === 'blob:') {
            try { el.src = TRANSPARENT; } catch (e) {}
          }
        } catch (e) {}
      }, true);
    }
  } catch (e) {}

  try { (console.info || console.log).call(console, '🛠 game-fixes pack installed'); } catch (e) {}
})();
