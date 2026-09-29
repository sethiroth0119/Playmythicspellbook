/* ═══════════════════════════════════════════════════════════════════════════
   MYTHIC SPELLBOOK — OVERLAY FX CORE
   Written for this game, for one job: draw an effect OVER the battlefield and
   make a white background structurally impossible.

   The ported WebGL pages this replaces produced white four different ways, and
   every fix was a cap applied after the fact. This engine removes the causes:

     1. NO WEBGL, NO PREMULTIPLIED ALPHA. A 2D canvas exposes colour and alpha
        independently, so nothing can "divide colour up into white" the way a
        premultiplied alpha ceiling did.
     2. NO PURE WHITE EXISTS. Every colour goes through clamp(), which caps how
        light a colour can be while preserving its hue. There is no code path
        that can put #fff on the canvas.
     3. ADDITIVE GLOW IS BOUNDED. 'lighter' compositing is only ever used with
        already-clamped colours and a per-sprite alpha budget, so overlapping
        glows brighten toward a tinted ceiling, not toward white.
     4. ONE ALPHA CEILING AT THE END. destination-in with a flat alpha
        multiplies the frame's alpha only — colour is untouched, which is
        exactly what the old ceiling failed to do.
     5. THE DOCUMENT IS TRANSPARENT FROM THE FIRST BYTE, and declares
        color-scheme:dark so even the browser's pre-paint frame is dark, not
        white.

   Every page built on this exposes step(dt) so the whole timeline can be swept
   and measured headlessly — the thing that finally made the last bug findable.
   ═══════════════════════════════════════════════════════════════════════════ */
(function (root) {
  'use strict';

  var FX = {};

  /* How light any single colour may be. 205 keeps deep, saturated brights
     (a hot ember, a cold star) while making "white" unreachable: the check is
     on the MINIMUM channel, which is what makes a colour read as white. */
  var LIGHT_CAP = 205;
  /* Hard alpha ceiling for a finished frame. The battlefield must stay legible
     through any effect; nothing composites above this. */
  FX.CEIL = 0.55;

  /* ── colour ──────────────────────────────────────────────────────────── */
  function clampRGB(r, g, b) {
    var mn = Math.min(r, g, b);
    if (mn > LIGHT_CAP) {                 // scale toward black, hue preserved
      var k = LIGHT_CAP / mn;
      r *= k; g *= k; b *= k;
    }
    return [Math.max(0, Math.min(255, r | 0)),
            Math.max(0, Math.min(255, g | 0)),
            Math.max(0, Math.min(255, b | 0))];
  }
  /* The ONLY way this engine makes a colour string. Pass '#rrggbb' or [r,g,b]. */
  FX.rgba = function (c, a) {
    var r, g, b;
    if (typeof c === 'string') {
      var h = c.charAt(0) === '#' ? c.slice(1) : c;
      if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
      r = parseInt(h.slice(0, 2), 16); g = parseInt(h.slice(2, 4), 16); b = parseInt(h.slice(4, 6), 16);
    } else { r = c[0]; g = c[1]; b = c[2]; }
    var v = clampRGB(r, g, b);
    return 'rgba(' + v[0] + ',' + v[1] + ',' + v[2] + ',' + Math.max(0, Math.min(1, a)) + ')';
  };
  FX.mix = function (c1, c2, t) {                       // '#aabbcc' lerp
    var p = function (c) { var h = c.replace('#', ''); return [parseInt(h.slice(0,2),16), parseInt(h.slice(2,4),16), parseInt(h.slice(4,6),16)]; };
    var a = p(c1), b = p(c2);
    return [a[0] + (b[0]-a[0])*t, a[1] + (b[1]-a[1])*t, a[2] + (b[2]-a[2])*t];
  };

  /* ── easing ──────────────────────────────────────────────────────────── */
  FX.clamp01  = function (v) { return v < 0 ? 0 : v > 1 ? 1 : v; };
  FX.easeOut  = function (t) { return 1 - Math.pow(1 - t, 3); };
  FX.easeIn   = function (t) { return t * t * t; };
  FX.easeIO   = function (t) { return t < 0.5 ? 4*t*t*t : 1 - Math.pow(-2*t + 2, 3) / 2; };
  FX.pulse    = function (t, hz) { return 0.5 + 0.5 * Math.sin(t * Math.PI * 2 * (hz || 1)); };

  /* ── deterministic noise (no Math.random in draw paths, so a swept frame
        looks the same every time it is measured) ───────────────────────── */
  FX.hash = function (i, s) {
    var h = Math.sin((i + 1) * 127.1 + (s || 0) * 311.7) * 43758.5453;
    return h - Math.floor(h);
  };

  /* ── mount ───────────────────────────────────────────────────────────── */
  FX.mount = function (opts) {
    opts = opts || {};
    var cv = document.getElementById('fx');
    if (!cv) { cv = document.createElement('canvas'); cv.id = 'fx'; document.body.appendChild(cv); }
    var ctx = cv.getContext('2d', { alpha: true });
    FX.canvas = cv; FX.ctx = ctx;

    function resize() {
      var dpr = Math.min(root.devicePixelRatio || 1, 2);
      var w = root.innerWidth, h = root.innerHeight;
      cv.width  = Math.max(2, Math.round(w * dpr));
      cv.height = Math.max(2, Math.round(h * dpr));
      cv.style.width = w + 'px'; cv.style.height = h + 'px';
      FX.W = w; FX.H = h; FX.dpr = dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    resize();
    root.addEventListener('resize', resize);

    var last = 0, manual = 0;
    FX.t = 0;
    function frame(now) {
      if (!manual) root.requestAnimationFrame(frame);
      var dt = manual ? manual : Math.min(0.05, (now - last) / 1000 || 0.016);
      last = now;
      FX.t += dt;
      ctx.setTransform(FX.dpr, 0, 0, FX.dpr, 0, 0);
      ctx.clearRect(0, 0, FX.W, FX.H);
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
      try { opts.draw(dt, FX.t); } catch (e) { try { console.warn('[fx]', e); } catch (_) {} }
      FX.applyCeiling();
    }
    root.requestAnimationFrame(frame);

    /* One deterministic frame. A hidden tab never fires rAF, so this is the
       only way the effect can be sampled and proven — it is what turned the
       last white bug from a guess into a measurement. */
    root.__vfxStep = function (dt) {
      manual = (typeof dt === 'number' && dt > 0) ? dt : 0.033;
      try { frame(performance.now()); } finally { manual = 0; }
    };
    return FX;
  };

  /* The frame's alpha ceiling. destination-in with a flat alpha multiplies
     DESTINATION ALPHA ONLY — colour is untouched. (The old WebGL ceiling
     scaled alpha while leaving premultiplied colour alone, which divided the
     effective colour UP and clipped it to white. This cannot do that.) */
  FX.applyCeiling = function (a) {
    var ctx = FX.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = 'destination-in';
    ctx.globalAlpha = 1;
    ctx.fillStyle = 'rgba(0,0,0,' + (a == null ? FX.CEIL : a) + ')';
    ctx.fillRect(0, 0, FX.canvas.width, FX.canvas.height);
    ctx.globalCompositeOperation = 'source-over';
    ctx.setTransform(FX.dpr, 0, 0, FX.dpr, 0, 0);
  };

  /* ── glow: additive, but bounded ─────────────────────────────────────── */
  FX.glow = function (x, y, r, colour, alpha) {
    var ctx = FX.ctx;
    if (r <= 0 || alpha <= 0) return;
    var g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0,   FX.rgba(colour, Math.min(0.75, alpha)));
    g.addColorStop(0.45, FX.rgba(colour, Math.min(0.35, alpha * 0.5)));
    g.addColorStop(1,   FX.rgba(colour, 0));
    var prev = ctx.globalCompositeOperation;
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(x, y, r, 0, 6.2832); ctx.fill();
    ctx.globalCompositeOperation = prev;
  };

  /* ⚠ SOFT glow — the SAME shape, composited normally instead of additively.
     Additive is right for sparks and embers, where overlap SHOULD build. It is
     wrong for fog banks: a dozen overlapping fog blobs add channel by channel
     and saturate toward white no matter how well each colour is clamped
     (measured: 9,746 near-white pixels once the fog got thick enough). Use this
     for anything volumetric that overlaps itself. */
  FX.glowSoft = function (x, y, r, colour, alpha) {
    var ctx = FX.ctx;
    if (r <= 0 || alpha <= 0) return;
    var g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0,   FX.rgba(colour, Math.min(0.85, alpha)));
    g.addColorStop(0.55, FX.rgba(colour, Math.min(0.45, alpha * 0.55)));
    g.addColorStop(1,   FX.rgba(colour, 0));
    ctx.fillStyle = g;                      /* source-over: blends, never adds */
    ctx.beginPath(); ctx.arc(x, y, r, 0, 6.2832); ctx.fill();
  };

  /* A soft beam/shaft — same bounded additive rules. */
  FX.beam = function (x, y, w, h, colour, alpha, rot) {
    var ctx = FX.ctx;
    ctx.save();
    ctx.translate(x, y); ctx.rotate(rot || 0);
    var g = ctx.createLinearGradient(0, -h / 2, 0, h / 2);
    g.addColorStop(0,   FX.rgba(colour, 0));
    g.addColorStop(0.5, FX.rgba(colour, Math.min(0.5, alpha)));
    g.addColorStop(1,   FX.rgba(colour, 0));
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = g;
    ctx.fillRect(-w / 2, -h / 2, w, h);
    ctx.restore();
  };

  /* ── images (card art / unit bodies) ─────────────────────────────────── */
  var imgCache = {};
  FX.loadImage = function (src) {
    if (!src) return Promise.resolve(null);
    if (imgCache[src]) return imgCache[src];
    imgCache[src] = new Promise(function (res) {
      var i = new Image();
      /* anonymous first so the finished canvas stays READABLE from the parent —
         a tainted canvas is exactly what made the weather layer unmeasurable
         for days. If the host refuses CORS, fall back rather than show nothing. */
      i.crossOrigin = 'anonymous';
      i.onload = function () { res(i); };
      i.onerror = function () {
        var j = new Image();
        j.onload = function () { res(j); };
        j.onerror = function () { res(null); };
        j.src = src;
      };
      i.src = src;
    });
    return imgCache[src];
  };

  /* Draw an image fitted inside a box, preserving aspect (never stretched). */
  FX.fitImage = function (img, cx, cy, boxW, boxH, alpha, rot, scale) {
    if (!img || !img.width) return;
    var ctx = FX.ctx;
    var k = Math.min(boxW / img.width, boxH / img.height) * (scale == null ? 1 : scale);
    var w = img.width * k, h = img.height * k;
    ctx.save();
    ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
    ctx.translate(cx, cy);
    if (rot) ctx.rotate(rot);
    ctx.drawImage(img, -w / 2, -h / 2, w, h);
    ctx.restore();
  };

  /* A card face with the game's gold frame — used by every cinematic so the
     material / tribute / base cards read as CARDS, not floating pictures. */
  FX.drawCard = function (img, cx, cy, h, alpha, rot, tint) {
    var ctx = FX.ctx;
    var w = h * 0.7;
    ctx.save();
    ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
    ctx.translate(cx, cy);
    if (rot) ctx.rotate(rot);
    /* body */
    ctx.fillStyle = FX.rgba('#0d0a16', 0.92);
    FX.roundRect(-w / 2, -h / 2, w, h, h * 0.045); ctx.fill();
    /* art */
    if (img && img.width) {
      ctx.save();
      FX.roundRect(-w / 2 + 2, -h / 2 + 2, w - 4, h - 4, h * 0.04); ctx.clip();
      var k = Math.max((w - 4) / img.width, (h - 4) / img.height);
      ctx.drawImage(img, -img.width * k / 2, -img.height * k / 2, img.width * k, img.height * k);
      ctx.restore();
    }
    /* frame */
    ctx.lineWidth = Math.max(1.5, h * 0.012);
    ctx.strokeStyle = FX.rgba(tint || '#d9b45a', 0.9);
    FX.roundRect(-w / 2, -h / 2, w, h, h * 0.045); ctx.stroke();
    ctx.restore();
  };

  FX.roundRect = function (x, y, w, h, r) {
    var ctx = FX.ctx;
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y,     x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x,     y + h, r);
    ctx.arcTo(x,     y + h, x,     y,     r);
    ctx.arcTo(x,     y,     x + w, y,     r);
    ctx.closePath();
  };

  /* ── nameplate ───────────────────────────────────────────────────────── */
  FX.plate = function (name, eyebrow, cx, cy, alpha, tint) {
    if (alpha <= 0) return;
    var ctx = FX.ctx;
    ctx.save();
    ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    if (eyebrow) {
      ctx.font = '600 ' + Math.round(FX.H * 0.016) + 'px ui-sans-serif,system-ui,sans-serif';
      ctx.fillStyle = FX.rgba(tint || '#e0c98a', 0.85);
      ctx.fillText(eyebrow, cx, cy - FX.H * 0.028);
    }
    ctx.font = '800 ' + Math.round(FX.H * 0.038) + 'px ui-serif,Georgia,serif';
    ctx.shadowColor = 'rgba(0,0,0,0.85)'; ctx.shadowBlur = 12;
    ctx.fillStyle = FX.rgba('#f2e2b4', 0.95);
    ctx.fillText(name || '', cx, cy);
    ctx.shadowBlur = 0;
    /* rule under the name */
    var w = Math.min(FX.W * 0.46, Math.max(160, (name || '').length * FX.H * 0.022));
    var g = ctx.createLinearGradient(cx - w / 2, 0, cx + w / 2, 0);
    g.addColorStop(0, FX.rgba(tint || '#d9b45a', 0));
    g.addColorStop(0.5, FX.rgba(tint || '#d9b45a', 0.75));
    g.addColorStop(1, FX.rgba(tint || '#d9b45a', 0));
    ctx.fillStyle = g;
    ctx.fillRect(cx - w / 2, cy + FX.H * 0.028, w, 1.5);
    ctx.restore();
  };

  /* ── particles ───────────────────────────────────────────────────────── */
  FX.pool = function (n, init) {
    var a = new Array(n);
    for (var i = 0; i < n; i++) { a[i] = { i: i, life: 0 }; if (init) init(a[i], i); }
    return a;
  };

  /* ── cinematic language ──────────────────────────────────────────────────
     The cheap-but-expensive-looking tricks: a camera that shakes and punches,
     letterbox bars, speed lines into the hit, an impact frame, and a chromatic
     split on the hero art. All of them obey the same colour clamp, so none can
     brighten toward white. ─────────────────────────────────────────────────── */

  /* Camera. Call FX.camera(shake, zoom, cx, cy) at the TOP of a draw and
     FX.cameraEnd() at the bottom. Deterministic shake so frames are repeatable. */
  FX.camera = function (shake, zoom, cx, cy) {
    var ctx = FX.ctx;
    ctx.save();
    var x = 0, y = 0;
    if (shake > 0) {
      var s = shake * Math.min(FX.W, FX.H) * 0.02;
      x = (FX.hash(Math.floor(FX.t * 60), 7) - 0.5) * 2 * s;
      y = (FX.hash(Math.floor(FX.t * 60), 8) - 0.5) * 2 * s;
    }
    ctx.translate((cx == null ? FX.W / 2 : cx) + x, (cy == null ? FX.H / 2 : cy) + y);
    if (zoom && zoom !== 1) ctx.scale(zoom, zoom);
    ctx.translate(-(cx == null ? FX.W / 2 : cx), -(cy == null ? FX.H / 2 : cy));
  };
  FX.cameraEnd = function () { FX.ctx.restore(); };

  /* Letterbox bars — DARK, so they frame the shot without touching brightness. */
  FX.letterbox = function (k) {
    if (k <= 0) return;
    var ctx = FX.ctx, h = FX.H * 0.085 * FX.clamp01(k);
    ctx.fillStyle = 'rgba(4,3,8,0.92)';
    ctx.fillRect(0, 0, FX.W, h);
    ctx.fillRect(0, FX.H - h, FX.W, h);
  };

  /* Radial speed lines converging on the impact point. */
  FX.speedLines = function (cx, cy, k, colour, count) {
    if (k <= 0) return;
    var ctx = FX.ctx, n = count || 26, R = Math.max(FX.W, FX.H);
    ctx.save();
    ctx.lineCap = 'round';
    for (var i = 0; i < n; i++) {
      var a = FX.hash(i, 101) * 6.2832;
      var inner = R * (0.16 + FX.hash(i, 102) * 0.16) * (1.15 - k * 0.5);
      var outer = inner + R * (0.10 + FX.hash(i, 103) * 0.22) * k;
      ctx.strokeStyle = FX.rgba(colour, 0.30 * k * (0.4 + FX.hash(i, 104) * 0.6));
      ctx.lineWidth = 1 + FX.hash(i, 105) * 2.6;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * inner, cy + Math.sin(a) * inner);
      ctx.lineTo(cx + Math.cos(a) * outer, cy + Math.sin(a) * outer);
      ctx.stroke();
    }
    ctx.restore();
  };

  /* The impact frame: a hard ring, a soft ring and radial spokes. */
  FX.impact = function (cx, cy, k, colour, scale) {
    if (k <= 0 || k > 1) return;
    var ctx = FX.ctx, e = FX.easeOut(k), U = Math.min(FX.W, FX.H) * (scale || 1);
    ctx.save();
    ctx.translate(cx, cy);
    ctx.lineWidth = Math.max(1.5, U * 0.012 * (1 - e));
    ctx.strokeStyle = FX.rgba(colour, 0.6 * (1 - e));
    ctx.beginPath(); ctx.arc(0, 0, U * (0.06 + e * 0.55), 0, 6.2832); ctx.stroke();
    ctx.lineWidth = Math.max(1, U * 0.03 * (1 - e));
    ctx.strokeStyle = FX.rgba(colour, 0.22 * (1 - e));
    ctx.beginPath(); ctx.arc(0, 0, U * (0.04 + e * 0.38), 0, 6.2832); ctx.stroke();
    for (var i = 0; i < 10; i++) {
      var a = i * 0.6283 + FX.hash(i, 111) * 0.3;
      ctx.strokeStyle = FX.rgba(colour, 0.3 * (1 - e));
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * U * 0.08, Math.sin(a) * U * 0.08);
      ctx.lineTo(Math.cos(a) * U * (0.12 + e * 0.6), Math.sin(a) * U * (0.12 + e * 0.6));
      ctx.stroke();
    }
    ctx.restore();
  };

  /* Ground dust ring — sells weight after a slam. */
  FX.dust = function (cx, cy, k, colour) {
    if (k <= 0) return;
    var ctx = FX.ctx, e = FX.easeOut(k), U = Math.min(FX.W, FX.H);
    ctx.save();
    ctx.translate(cx, cy); ctx.scale(1, 0.3);
    for (var i = 0; i < 18; i++) {
      var a = FX.hash(i, 121) * 6.2832;
      var r = U * (0.10 + e * (0.30 + FX.hash(i, 122) * 0.25));
      FX.glow(Math.cos(a) * r, Math.sin(a) * r, U * 0.05 * (0.5 + FX.hash(i, 123)), colour, 0.16 * (1 - e));
    }
    ctx.restore();
  };

  /* Chromatic split — the hero art drawn three times with tiny tinted offsets.
     Reads as expensive; costs two extra draws. */
  FX.chromaImage = function (img, cx, cy, w, h, alpha, split, scale) {
    if (!img) return;
    var ctx = FX.ctx;
    if (split > 0.2) {
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = alpha * 0.30;
      FX.fitImage(img, cx - split, cy, w, h, alpha * 0.30, 0, scale);
      FX.fitImage(img, cx + split, cy, w, h, alpha * 0.30, 0, scale);
      ctx.restore();
    }
    FX.fitImage(img, cx, cy, w, h, alpha, 0, scale);
  };

  /* ── director: a named phase timeline ────────────────────────────────── */
  FX.director = function (phases) {
    var total = phases.reduce(function (s, p) { return s + p.d; }, 0);
    return {
      total: total,
      /* returns { name, p (0..1 within phase), t (seconds into phase) } */
      at: function (time) {
        var left = Math.max(0, time);
        for (var i = 0; i < phases.length; i++) {
          if (left < phases[i].d || i === phases.length - 1) {
            return { name: phases[i].n, p: FX.clamp01(left / phases[i].d), t: left, index: i };
          }
          left -= phases[i].d;
        }
        return { name: phases[phases.length - 1].n, p: 1, t: 0, index: phases.length - 1 };
      }
    };
  };

  root.FX = FX;
})(window);
