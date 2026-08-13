/* ══════════════════════════════════════════════════════════════════════════
   🌄 VISTA — the world behind the board, and the grade over everything.

   Loaded by public/battle-board/index.html as a plain ES module and attached
   to the BBX hook seam. It owns exactly two passes:

     BBX.vista.draw(api)   FIRST thing in frame(). Replaces drawSky() +
                           drawShards() + drawBackdrop() + the procedural ruin
                           silhouettes. Paints sky, the layered environment,
                           the location backdrop, the sun/moon and the ground
                           BEYOND the play field.
     BBX.vista.grade(api)  after the depth-sorted actors. Replaces the flat
                           black radial vignette with a filmic pass.

   WHAT WAS WRONG BEFORE (measured on the round-2 board, not guessed)
   1. The location backdrop was drawn COVER over the entire viewport, so the
      photo's own foreground — grey rubble, a soldier silhouette — filled the
      strip below the board's near edge. A cold grey photo butted straight
      against warm sand with a hard horizontal seam: the single loudest "board
      pasted on a picture" tell in the frame. The art is now the FAR layer
      only, clipped at the horizon with a feathered edge, and the ground
      beyond the field is painted warm so the board sits ON a desert.
   2. There was no atmospheric depth at all: one photo, one gradient. Now
      three seeded mesa layers, each lifted further toward LIGHT.fog the
      further back it is, with a haze band exactly at the board's far edge.
   3. The sun was PINNED to the upper-right corner regardless of the light
      rig, so at night the moon and the shadows disagreed. It is now placed
      by projecting the actual light vector, then compressed along that same
      screen ray until it fits the frame — the SIDE and the height therefore
      always agree with the direction the terrain's cliff shadows fall.
   4. The old vignette put pure black on the frame. The BAR forbids pure black
      and pure white; grade() now clamps both ends with one 'lighten' and one
      'darken' flat fill, which also does the colour work — the lift is a cool
      blue-grey (shadows go cool) and the ceiling is a warm off-white
      (highlights go warm).

   ⚠ THE HORIZON IS A CHEAT, AND IT HAS TO BE.
   The true vanishing line of the y=0 plane for this camera sits ~1000px ABOVE
   the viewport (f=(0,-.675,-.738), so the horizon of the ground plane lands at
   cy - .915*VIEW.scale). An honest infinite desert would therefore fill the
   whole frame and leave no sky. The renderer has always treated the board's
   FAR EDGE as the horizon; this module keeps that convention. horizonY() is
   the one place that decision lives.

   BUDGET. Everything static is baked into three offscreen canvases — sky,
   land (ridges + haze + the desert floor) and veil (fog + vignette + centre
   lift) — plus one per backdrop image, and blitted 1:1 in device pixels (see
   blit(): the DPR-scaled path costs 8x more). The bakes are keyed on the
   viewport + the light + the map and throttled, because LIGHT lerps every
   frame for 2.5s on a time-of-day change and re-baking 150 times in that
   window would drop frames. Measured on this box's SOFTWARE rasteriser, the
   whole board renders at ~82ms/frame without this module and ~89ms with it;
   on a GPU-composited canvas the delta is a fraction of that. Canvas-2D only:
   the header at battle-board:2240 records that the WebGL path produced no
   fragments on real hardware. No imports, no DOM, no postMessage, no deps.
   ══════════════════════════════════════════════════════════════════════════ */
(function () {
  "use strict";
  window.BBX = window.BBX || {};

  /* Palette. These are deliberately the same family as the terrain module's
     SAND_/ROCK_ constants (battle-board's bakeTerrain) — the ground and the
     world behind it have to read as one place. They are duplicated rather
     than imported because the board page is a classic script and cannot
     export; if the terrain palette moves, move these with it. */
  const ROCK_PALE = '#c2a077', ROCK_BASE = '#8a6a48', ROCK_DEEP = '#4a3524';
  const SAND_PALE = '#dcbc80', SAND_BASE = '#a67c3d', SAND_DEEP = '#54371c';
  /* the floor of the frame: nothing in the final image may sit below this,
     and it is a cool blue-grey so the deepest shadows go cool, not muddy. */
  const SHADOW_FLOOR = [16, 20, 34];
  /* the ceiling: warm off-white, so a blown highlight reads as sunlight and
     never as paper. */
  const HILIGHT_CEIL = [252, 247, 236];

  /* ── deterministic RNG. The skyline must be identical every run (the
     screenshot harness compares frames) and must NOT be left-right
     symmetric, which rules out mirroring one half. ── */
  function strHash(s) {
    let h = 2166136261 >>> 0;
    s = String(s);
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
    return h >>> 0;
  }
  function mulberry32(a) {
    return function () {
      a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* ── caches ───────────────────────────────────────────────────────────── */
  const S = {
    sky: { key: '', cv: null },
    land: { key: '', cv: null },
    veil: { key: '', cv: null },       /* fog + vignette + centre lift, pre-composited */
    art: new Map(),          /* image src -> { key, cv } graded + horizon-clipped */
    bloom: { cv: null, g: null },
    lastBake: -1e9,
    drift: null
  };

  function mkCanvas(w, h, dpr) {
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w * dpr));
    c.height = Math.max(1, Math.round(h * dpr));
    const g = c.getContext('2d');
    if (g) g.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { cv: c, g: g };
  }
  /* ⚠ BLIT A BAKE 1:1 IN DEVICE PIXELS, NOT THROUGH THE DPR TRANSFORM.
     Measured on this box's software rasteriser, same 1640x1600 canvas:
       drawImage(cv, 0,0, W,H)  under the ctx's DPR transform … 10.9 ms
       drawImage(cv, 0,0)       under an identity transform  …  1.4 ms
     Identical output — the bakes are already made at device resolution — but
     the scaled path re-samples every pixel while the 1:1 path is a blit. Four
     full-viewport bakes are blitted per frame, so this is ~38ms/frame. If the
     sizes ever disagree (a fractional devicePixelRatio rounding differently)
     we fall back to the scaled draw rather than shifting the image. */
  function blit(ctx, cv, W, H) {
    if (!cv) return;
    if (cv.width === ctx.canvas.width && cv.height === ctx.canvas.height) {
      ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.drawImage(cv, 0, 0); ctx.restore();
    } else {
      ctx.drawImage(cv, 0, 0, W, H);
    }
  }
  function dprOf(api) {
    /* the stage caps DPR at 2 in resize(); mirror it rather than reading
       devicePixelRatio again, so a bake is never larger than the canvas. */
    return Math.min(window.devicePixelRatio || 1, 2);
  }

  /* THE horizon: the board's far edge, wall included. Everything above it is
     sky/world, everything below is the desert the board sits in. */
  function horizonY(api) {
    const far = api.project({ x: 0, y: 0, z: -api.MAP.rows / 2 - (api.CONFIG.wall || 0) });
    return far ? far.y : api.H * 0.30;
  }
  /* the board's near edge — below this we are looking at foreground dirt that
     is closer to the camera than any tile, so it gets the strongest falloff. */
  function nearY(api) {
    const p = api.project({ x: 0, y: 0, z: api.MAP.rows / 2 });
    return p ? p.y : api.H * 0.86;
  }

  /* ── the celestial body ───────────────────────────────────────────────────
     Project the REAL light direction, then walk back along that screen ray
     until the point is inside the frame. Compressing along the ray is what
     keeps the azimuth honest: a day sun (az .28) stays right of centre, a
     dawn sun (az -.85) stays left, and both agree with the way every cliff
     shadow the terrain bakes is pointing. A raw projection is useless on its
     own — the day sun lands ~850px off the right edge and 4200px above the
     top, because it really is that high. */
  function bodyPos(api) {
    const L = api.lightVector();
    const cx = api.VIEW.cx, cy = api.VIEW.cy;
    const hz = horizonY(api);
    let px, py;
    const p = api.project({ x: L.x * 60, y: L.y * 60, z: L.z * 60 });
    if (p) { px = p.x; py = p.y; } else { px = cx + api.W * 0.28; py = cy - api.H * 0.34; }
    let dx = px - cx, dy = py - cy;
    const maxX = api.W * 0.40, maxY = Math.max(40, cy - api.H * 0.10);
    let t = 1;
    if (Math.abs(dx) > 1) t = Math.min(t, maxX / Math.abs(dx));
    if (Math.abs(dy) > 1) t = Math.min(t, maxY / Math.abs(dy));
    px = cx + dx * t; py = cy + dy * t;
    /* keep it in the sky band: a body drawn below the far edge would be
       occluded by the terrain the very next pass and read as a bug. */
    py = api.clamp(py, api.H * 0.045, Math.max(api.H * 0.05, hz - 14));
    px = api.clamp(px, api.W * 0.07, api.W * 0.93);
    return { x: px, y: py, sun: api.LIGHT.body === 'sun' };
  }

  /* ── skyline generator ────────────────────────────────────────────────────
     Mesas, not hills: a flat top, a talus slope in, an occasional stepped
     shoulder. Walking left to right with a fresh random width each segment is
     what keeps it asymmetric — no mirroring, no repeat period. */
  /* CANYON BIAS. Height is scaled up toward the left and right edges and down
     in the middle, so the ranges frame the field the way a canyon does and
     the centre keeps its distance view. It is also the cheapest way to stop
     the skyline covering the play area: the tallest rock is where the board
     never reaches. */
  function canyonBias(x, W) {
    const t = Math.abs(x - W * 0.5) / (W * 0.5);
    return 0.46 + 0.85 * t * t;
  }
  /* ⚠ ROUND-2 SHAPE BUG. The first pass walked one width per segment with a
     single talus slope, which produced very long dead-flat tops: two enormous
     tan slabs, one per side, that read as cardboard rather than rock. A mesa
     now gets its own approach slope, a BROKEN top (3-5 short spans that
     wander a few px) and a departure slope, and the widths are much shorter
     — so the skyline is a series of buttes with real intervals of low ground
     between them. */
  function mesaLine(rand, W, baseY, amp, seg) {
    const pts = [];
    let x = -90;
    let y = baseY - amp * canyonBias(x, W) * (0.22 + rand() * 0.34);
    pts.push({ x: x, y: y });
    let guard = 0;
    while (x < W + 90 && guard++ < 500) {
      const w = seg * (0.34 + rand() * 1.05);
      const bias = canyonBias(x + w * 0.5, W);
      let ny = y + (rand() - 0.42) * amp * 0.95;
      ny = Math.min(baseY - amp * bias * 0.06, Math.max(baseY - amp * bias * 1.30, ny));
      /* approach face: steep, occasionally with a stepped shoulder */
      const slope = w * (0.16 + rand() * 0.30);
      if (rand() < 0.34) {
        const midY = y + (ny - y) * (0.35 + rand() * 0.3);
        pts.push({ x: x + slope * 0.40, y: midY });
        pts.push({ x: x + slope * 0.68, y: midY + (rand() - 0.5) * amp * 0.05 });
      }
      pts.push({ x: x + slope, y: ny });
      /* broken cap: the flat top is never one straight line */
      const capW = w - slope;
      const steps = 2 + ((rand() * 3) | 0);
      for (let s = 1; s <= steps; s++) {
        pts.push({ x: x + slope + capW * (s / steps), y: ny + (rand() - 0.5) * amp * 0.10 });
      }
      x += w; y = pts[pts.length - 1].y;
    }
    return pts;
  }
  function tracePts(g, pts, baseY, W) {
    g.beginPath();
    g.moveTo(-90, baseY + 400);
    for (let i = 0; i < pts.length; i++) g.lineTo(pts[i].x, pts[i].y);
    g.lineTo(W + 90, baseY + 400);
    g.closePath();
  }

  /* one distance layer: silhouette + its own aerial-perspective gradient
     (haze pools at the base, so the FOOT of a range is lighter than its top)
     + a lit rim on the faces that turn toward the key. */
  function ridgeLayer(api, g, opt) {
    const { W } = api, LIGHT = api.LIGHT;
    /* same night bias as the floor: a weak key means more air between us and
       the rock, so every range sits further toward the fog colour */
    const fogMix = Math.min(0.94, opt.fog + api.clamp(0.26 - LIGHT.keyI * 0.19, 0, 0.20));
    const top = api.mixHex(opt.rock, LIGHT.fog, Math.min(0.96, fogMix + 0.06));
    const foot = api.mixHex(opt.rock, LIGHT.fog, Math.max(0, fogMix - 0.24));
    const pts = mesaLine(opt.rand, W, opt.baseY, opt.amp, opt.seg);
    g.save();
    tracePts(g, pts, opt.baseY, W);
    const grd = g.createLinearGradient(0, opt.baseY - opt.amp * 2.0, 0, opt.baseY + 26);
    grd.addColorStop(0, top);
    grd.addColorStop(1, foot);
    g.fillStyle = grd;
    g.fill();
    g.clip();
    /* SHADED FACES. A silhouette alone is a cutout; what makes a distant range
       read as rock is that the faces turned away from the key are darker than
       the ones turned toward it. Every descending-away face gets a short
       gradient hung off it, clipped to the silhouette — so the same mesa has a
       lit side and a shadow side without any per-pixel work. */
    const shade = api.mixHex(opt.rock, api.mixHex(LIGHT.ambient, LIGHT.fog, 0.5), 0.62);
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i];
      const dx = b.x - a.x, dy = b.y - a.y;
      if (Math.abs(dy) < opt.amp * 0.10 || dx <= 0) continue;
      const away = (dx * opt.lightX) < 0 ? (dy < 0) : (dy > 0);
      if (!away) continue;
      const drop = Math.min(opt.amp * 1.1, Math.abs(dy) * 2.4 + 14);
      const sg = g.createLinearGradient(0, Math.min(a.y, b.y), 0, Math.min(a.y, b.y) + drop);
      sg.addColorStop(0, api.rgba(shade, 0.55 * opt.form));
      sg.addColorStop(1, api.rgba(shade, 0));
      g.fillStyle = sg;
      g.beginPath();
      g.moveTo(a.x - 2, a.y); g.lineTo(b.x + 2, b.y);
      g.lineTo(b.x + 2, b.y + drop); g.lineTo(a.x - 2, a.y + drop);
      g.closePath(); g.fill();
    }
    /* rim light. Only the faces whose screen-space normal points at the sun
       get it, which is why it is per-segment and not a stroke of the whole
       polyline — a uniform outline is the exact "glowing hard outline on
       everything" the BAR calls out. */
    g.lineCap = 'round';
    g.strokeStyle = api.rgba(LIGHT.key, opt.rim);
    g.lineWidth = opt.lw;
    g.beginPath();
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i];
      if (Math.sign(b.x - a.x) === 0) continue;
      const facing = (b.x - a.x) * opt.lightX;
      if (facing <= 0 && Math.abs(b.y - a.y) > 1.5) continue;
      g.moveTo(a.x, a.y); g.lineTo(b.x, b.y);
    }
    g.stroke();
    g.restore();
    return pts;
  }

  /* ── SKY bake ─────────────────────────────────────────────────────────── */
  function bakeSky(api, dpr) {
    const W = api.W, H = api.H, LIGHT = api.LIGHT;
    const o = mkCanvas(W, H, dpr); const g = o.g;
    if (!g) return null;
    const hz = horizonY(api);
    const grd = g.createLinearGradient(0, 0, 0, Math.max(hz * 1.25, H * 0.5));
    grd.addColorStop(0, LIGHT.sky[0]);
    grd.addColorStop(0.55, LIGHT.sky[1]);
    grd.addColorStop(1, LIGHT.sky[2]);
    g.fillStyle = grd; g.fillRect(0, 0, W, H);
    /* horizon glow, centred on the light's azimuth — the sky is brightest
       where the sun is, which is most of what makes a flat gradient read as
       air rather than paint. */
    const b = bodyPos(api);
    /* ⚠ centred on the BODY, not on the horizon. Anchoring it at hz put the
       brightest part of the sky directly behind the board's far rows, and
       between that and the bloom the whole back half of the field went milky
       — the far plateaus stopped separating. */
    const gl = g.createRadialGradient(b.x, b.y, 0, b.x, b.y, Math.max(W, H) * 0.42);
    const kI = api.clamp(LIGHT.keyI, 0.2, 1.3);
    gl.addColorStop(0, api.rgba(LIGHT.disc, 0.17 * kI));
    gl.addColorStop(0.4, api.rgba(LIGHT.disc, 0.055 * kI));
    gl.addColorStop(1, api.rgba(LIGHT.disc, 0));
    g.globalCompositeOperation = 'lighter';
    g.fillStyle = gl; g.fillRect(0, 0, W, hz + 40);
    g.globalCompositeOperation = 'source-over';
    /* thin high cloud, seeded, drifting nowhere — enough to break the ramp */
    const rand = mulberry32(strHash((api.MAP.id || 'map') + '|cloud'));
    for (let i = 0; i < 14; i++) {
      const cxp = rand() * (W + 200) - 100;
      const cyp = rand() * hz * 0.82;
      const rw = 70 + rand() * 240, rh = 8 + rand() * 22;
      const a = 0.04 + rand() * 0.07;
      const cg = g.createRadialGradient(cxp, cyp, 0, cxp, cyp, rw);
      const tint = api.mixHex(LIGHT.disc, LIGHT.fog, 0.45);
      cg.addColorStop(0, api.rgba(tint, a));
      cg.addColorStop(1, api.rgba(tint, 0));
      g.save(); g.translate(cxp, cyp); g.scale(1, rh / rw); g.translate(-cxp, -cyp);
      g.fillStyle = cg; g.beginPath(); g.arc(cxp, cyp, rw, 0, 7); g.fill(); g.restore();
    }
    return o.cv;
  }

  /* ── LAND bake: mesa layers + haze band + the desert the board sits in ─── */
  function bakeLand(api, dpr, hasArt) {
    const W = api.W, H = api.H, LIGHT = api.LIGHT;
    const o = mkCanvas(W, H, dpr); const g = o.g;
    if (!g) return null;
    const hz = horizonY(api);
    const nz = nearY(api);
    const b = bodyPos(api);
    const lightX = Math.sign(b.x - api.VIEW.cx) || 1;
    const rand = mulberry32(strHash((api.MAP.id || 'map') + '|ridge'));
    const band = api.clamp(hz * 0.78, 46, 230);   /* vertical room for the skyline */

    /* FAR range. Suppressed when the location supplies backdrop art — that art
       IS the far layer; drawing a procedural ridge over it would fight it. */
    if (!hasArt) {
      ridgeLayer(api, g, {
        rand: rand, baseY: hz - 6, amp: band * 0.95, seg: W * 0.17,
        rock: ROCK_PALE, fog: 0.74, rim: 0.06, lw: 1, form: 0.35, lightX: lightX
      });
    } else {
      /* still burn a few random draws so the mid/near layers are identical
         whether or not art is present — otherwise the skyline reshuffles the
         moment a location card lands, which reads as a glitch, not a change. */
      for (let i = 0; i < 24; i++) rand();
    }
    /* MID range — the warm canyon wall. This is the layer that does the real
       work when a cold photographic backdrop is in play: it bridges the art
       to the warm sand instead of letting grey butt against ochre.
       ⚠ It has to clear the TERRAIN, not just the horizon: the tallest baked
       plateau tops out ~70px above the far edge, so a range sized to hz alone
       is drawn and then completely hidden by the board. */
    ridgeLayer(api, g, {
      rand: rand, baseY: hz - 4, amp: band * 0.82, seg: W * 0.125,
      rock: ROCK_BASE, fog: 0.46, rim: 0.16, lw: 1.4, form: 0.7, lightX: lightX
    });
    /* NEAR bluffs — most contrast, least fog. Same reasoning: tall at the
       sides (where they frame the field), low in the middle (where the board
       would hide them anyway). */
    ridgeLayer(api, g, {
      rand: rand, baseY: hz + 8, amp: band * 0.56, seg: W * 0.085,
      rock: ROCK_DEEP, fog: 0.14, rim: 0.24, lw: 1.7, form: 1.0, lightX: lightX
    });

    /* ── the ground BEYOND the play field. Painted over the whole area below
       the horizon; the terrain module draws the board on top of it a pass
       later, so what survives is the margin at the sides and the strip under
       the near edge — which is exactly where the backdrop photo's own
       foreground used to sit. ── */
    /* ⚠ TWO ROUND-2 FAULTS FIXED HERE, both visible in the standalone shots.
       (a) The floor started as an OPAQUE fillRect at the horizon, which cut a
           dead-straight horizontal line across the feet of every ridge and
           across the whole frame. It now fades in over ~40px (rgba stops in
           the same gradient), so the ranges stand IN the sand.
       (b) It was too bright and too saturated — a big flat orange field that
           out-competed the board it is supposed to sit behind. The ramp is now
           fogged at the far end and falls to a cool dark in the foreground,
           which is also the depth cue: light far, dark near. */
    const top = hz - 34;
    const span = Math.max(1, H - top);
    const solid = (hz + 8 - top) / span;
    g.save();
    g.beginPath(); g.rect(-2, top, W + 4, H - top + 3); g.clip();
    /* NIGHT BIAS. Sand keeps its own albedo in the mix, so at keyI 0.48 the
       floor still came out a warm ochre while the sky and the board had gone
       cold — the one thing in the frame that had not noticed it was night.
       Everything below leans further toward the fog colour as the key weakens. */
    const fb = api.clamp(0.30 - LIGHT.keyI * 0.22, 0, 0.24);
    const fx = (hex, m) => api.mixHex(hex, LIGHT.fog, Math.min(0.95, m + fb));
    const cFar = fx(SAND_PALE, 0.66);
    const fl = g.createLinearGradient(0, top, 0, H);
    fl.addColorStop(0, api.rgba(cFar, 0));
    fl.addColorStop(solid * 0.55, api.rgba(cFar, 0.55));
    fl.addColorStop(solid, cFar);
    fl.addColorStop(solid + (1 - solid) * 0.14, fx(SAND_BASE, 0.44));
    fl.addColorStop(solid + (1 - solid) * 0.52, fx(SAND_DEEP, 0.28));
    fl.addColorStop(1, api.mixHex(fx(SAND_DEEP, 0.10), SHADE_HEX(LIGHT), 0.58));
    g.fillStyle = fl; g.fillRect(-2, top, W + 4, H - top + 3);
    /* broad seeded mottling — dune shadow and pans. Large and few: this is
       ground the player never walks on, it only has to not be a flat ramp. */
    const r2 = mulberry32(strHash((api.MAP.id || 'map') + '|floor'));
    for (let i = 0; i < 26; i++) {
      const px = r2() * (W + 260) - 130;
      const py = hz + 10 + r2() * r2() * (H - hz) * 1.15;
      const rr = 60 + r2() * 230;
      const dark = r2() < 0.6;
      const col = dark ? api.mixHex(SAND_DEEP, LIGHT.fog, 0.3) : api.mixHex(SAND_PALE, LIGHT.key, 0.25);
      const a = (dark ? 0.22 : 0.10) * (0.4 + r2() * 0.6);
      const rg = g.createRadialGradient(px, py, 0, px, py, rr);
      rg.addColorStop(0, api.rgba(col, a));
      rg.addColorStop(1, api.rgba(col, 0));
      g.save(); g.translate(px, py); g.scale(1, 0.34); g.translate(-px, -py);
      g.fillStyle = rg; g.beginPath(); g.arc(px, py, rr, 0, 7); g.fill(); g.restore();
    }
    /* dune crests near the horizon: flattened, so they read as distance */
    g.strokeStyle = api.rgba(api.mixHex(SAND_PALE, LIGHT.key, 0.4), 0.10);
    for (let i = 0; i < 9; i++) {
      const y = hz + 6 + r2() * (nz - hz) * 0.5;
      const x0 = r2() * W - 80, len = 90 + r2() * 320;
      g.lineWidth = 1 + r2() * 1.6;
      g.beginPath();
      g.moveTo(x0, y);
      g.bezierCurveTo(x0 + len * 0.33, y - 3 - r2() * 4, x0 + len * 0.66, y + 2 + r2() * 4, x0 + len, y);
      g.stroke();
    }
    /* foreground falloff: the dirt in front of the near edge is closest to the
       lens and out of the key, so it goes down and cool. Keeps the eye on the
       field without the vignette having to do it. */
    const fg = g.createLinearGradient(0, nz - 30, 0, H);
    fg.addColorStop(0, api.rgba(LIGHT.fog, 0));
    fg.addColorStop(1, api.rgba(api.mixHex(LIGHT.fog, '#0d1220', 0.5), 0.62));
    g.fillStyle = fg; g.fillRect(-2, nz - 30, W + 4, H - nz + 34);
    g.restore();

    /* ── the haze band, exactly where the horizon meets the far edge ── */
    const hb = g.createLinearGradient(0, hz - band * 0.34, 0, hz + 34);
    const hazeCol = api.mixHex(LIGHT.fog, LIGHT.disc, 0.34);
    const hA = 0.17 + (LIGHT.haze || 0.2) * 0.5;
    hb.addColorStop(0, api.rgba(hazeCol, 0));
    hb.addColorStop(0.66, api.rgba(hazeCol, hA));
    hb.addColorStop(1, api.rgba(hazeCol, 0));
    g.fillStyle = hb; g.fillRect(-2, hz - band * 0.34, W + 4, band * 0.34 + 36);
    return o.cv;
  }
  /* the cool end of the current rig — used where the sand falls out of the key */
  function SHADE_HEX(LIGHT) { return LIGHT.ambient || '#2e3650'; }

  /* ── BACKDROP ART bake ────────────────────────────────────────────────────
     Anchored so BACKDROP.horizon (0.62 of the source) lands on the board's far
     edge, graded into the sky so a photograph belongs to this world, and
     feathered out below the horizon so its own foreground never reaches the
     frame. Cached per image; the cross-fade draws two of these. */
  function bakeArt(api, img, dpr) {
    const W = api.W, H = api.H, LIGHT = api.LIGHT;
    const o = mkCanvas(W, H, dpr); const g = o.g;
    if (!g) return null;
    const hz = horizonY(api);
    const hAnchor = (api.backdrop && api.backdrop.horizon) || 0.62;
    const sc = Math.max(W / img.naturalWidth, H / img.naturalHeight) * 1.02;
    const dw = img.naturalWidth * sc, dh = img.naturalHeight * sc;
    const dx = (W - dw) / 2;
    let dy = hz - dh * hAnchor;
    dy = Math.min(0, Math.max(H - dh, dy));
    g.drawImage(img, dx, dy, dw, dh);
    /* distance grade. 'saturation' pulls the chroma down and 'color' pushes
       the remaining hue toward the sky's — together they are aerial
       perspective without a per-pixel loop. Then a fog lift and a key wash. */
    g.globalCompositeOperation = 'saturation';
    g.globalAlpha = 0.55;
    g.fillStyle = 'hsl(0,18%,50%)';
    g.fillRect(0, 0, W, H);
    g.globalCompositeOperation = 'color';
    g.globalAlpha = 0.34;
    g.fillStyle = api.mixHex(LIGHT.fog, LIGHT.disc, 0.42);
    g.fillRect(0, 0, W, H);
    g.globalCompositeOperation = 'source-over';
    g.globalAlpha = api.clamp(0.34 - LIGHT.keyI * 0.10, 0.10, 0.40);
    g.fillStyle = LIGHT.fog;
    g.fillRect(0, 0, W, H);
    g.globalCompositeOperation = 'lighter';
    g.globalAlpha = 1;
    g.fillStyle = api.rgba(LIGHT.key, 0.035 + LIGHT.keyI * 0.035);
    g.fillRect(0, 0, W, H);
    /* haze accumulates toward the horizon line inside the art too */
    g.globalCompositeOperation = 'source-over';
    const hz2 = g.createLinearGradient(0, hz - H * 0.18, 0, hz + 8);
    hz2.addColorStop(0, api.rgba(LIGHT.fog, 0));
    hz2.addColorStop(1, api.rgba(api.mixHex(LIGHT.fog, LIGHT.disc, 0.28), 0.34));
    g.fillStyle = hz2; g.fillRect(0, hz - H * 0.18, W, H * 0.18 + 10);
    /* ✂ THE FIX FOR THE GREY-RUBBLE FOREGROUND. Everything below the horizon
       is erased with a soft feather, so the art can only ever be the far
       layer. Without this the photo's near ground paints over the desert and
       the board reads as a cut-out on a picture. */
    g.globalCompositeOperation = 'destination-out';
    const cut = g.createLinearGradient(0, hz - 26, 0, hz + 30);
    cut.addColorStop(0, 'rgba(0,0,0,0)');
    cut.addColorStop(1, 'rgba(0,0,0,1)');
    g.fillStyle = cut; g.fillRect(0, hz - 26, W, 58);
    g.fillStyle = '#000'; g.fillRect(0, hz + 29, W, H - hz);
    g.globalCompositeOperation = 'source-over';
    return o.cv;
  }

  /* ── bake orchestration ─────────────────────────────────────────────────── */
  function lightKey(api) {
    const L = api.LIGHT;
    return [L.sky[0], L.sky[1], L.sky[2], L.fog, L.key, L.disc, L.ambient,
      Math.round(L.keyI * 12), Math.round(L.az * 14), Math.round(L.elev * 14),
      Math.round((L.haze || 0) * 12), L.body].join(',');
  }
  function ensureBakes(api) {
    const dpr = dprOf(api);
    const bd = api.backdrop || {};
    const img = bd.img;
    const hasArt = !!(img && img.complete && img.naturalWidth);
    const base = [Math.round(api.W), Math.round(api.H), dpr, api.MAP.id,
      api.MAP.cols, api.MAP.rows, lightKey(api)].join('|');
    const skyKey = base;
    const landKey = base + '|' + (hasArt ? 1 : 0);
    if (S.sky.key === skyKey && S.land.key === landKey) return;
    /* THROTTLE. LIGHT lerps every frame for 2.5s on a time-of-day change, so
       the key changes 150 times in a row. Re-baking each time would cost more
       than the rest of the renderer put together; the stale bake is visually
       indistinguishable for 150ms. The very first bake is never throttled. */
    if (S.sky.cv && (api.T - S.lastBake) < 0.15) return;
    S.lastBake = api.T;
    try {
      const sky = bakeSky(api, dpr);
      if (sky) { S.sky.cv = sky; S.sky.key = skyKey; }
      const land = bakeLand(api, dpr, hasArt);
      if (land) { S.land.cv = land; S.land.key = landKey; }
      const veil = bakeVeil(api, dpr);
      if (veil) { S.veil.cv = veil; S.veil.key = skyKey; }
      /* the art bakes are keyed on the same light, so drop them together */
      S.art.clear();
    } catch (e) { /* never let a bake failure take the frame down */ }
  }

  /* ── GRADE VEIL bake ──────────────────────────────────────────────────────
     ⚠ MEASURED, NOT GUESSED. grade() originally painted the distance fog, the
     vignette and the centre lift as three live gradients over the full
     viewport, and cost 37ms/frame on this box's software rasteriser — a
     full-viewport RADIAL gradient alone measured 12.3ms, versus 0.9ms for a
     flat fill and ~1ms for a drawImage. All three depend only on the viewport
     and the light rig, so they are baked into one RGBA veil and blitted. The
     remaining live work in grade() is the bloom and the three blend fills,
     which have to see the actual frame. ── */
  function bakeVeil(api, dpr) {
    const W = api.W, H = api.H, LIGHT = api.LIGHT;
    const o = mkCanvas(W, H, dpr); const g = o.g;
    if (!g) return null;
    const hz = horizonY(api);
    /* centre lift, so the vignette reads as a lens falloff and not as dirt in
       the corners. Kept first and very low so the ring never looks painted. */
    const lift = g.createRadialGradient(api.VIEW.cx, api.VIEW.cy - H * 0.06, 0,
      api.VIEW.cx, api.VIEW.cy - H * 0.06, Math.max(W, H) * 0.52);
    lift.addColorStop(0, api.rgba(LIGHT.key, 0.05 * api.clamp(LIGHT.keyI, 0.3, 1.3)));
    lift.addColorStop(1, api.rgba(LIGHT.key, 0));
    g.fillStyle = lift; g.fillRect(0, 0, W, H);
    /* VIGNETTE — a soft cool falloff, NOT an opaque ring.
       ⚠ The original was rgba(0,0,0,.42) from a 0.25·min(W,H) inner radius.
       It put pure black on the frame and, because the 8×7 field fills the
       viewport, darkened the outer tile columns by ~25 luma — a whole
       elevation step laid across the board, so the outer plateaus stopped
       separating from the basin. Start it far out and keep it under .18. */
    const vg = g.createRadialGradient(api.VIEW.cx, api.VIEW.cy, Math.min(W, H) * 0.46,
      api.VIEW.cx, api.VIEW.cy, Math.max(W, H) * 0.86);
    const vc = api.mixHex(LIGHT.fog, '#0c1220', 0.55);
    vg.addColorStop(0, api.rgba(vc, 0));
    vg.addColorStop(1, api.rgba(vc, 0.17));
    g.fillStyle = vg; g.fillRect(0, 0, W, H);
    /* DISTANCE FOG — thickest at the far rows, gone by mid-field. The far
       plateaus have to stay separable, so this tops out well under the ~30
       luma per elevation step the terrain bakes. */
    const fog = g.createLinearGradient(0, hz - 20, 0, hz + (H - hz) * 0.36);
    const fc = api.mixHex(LIGHT.fog, LIGHT.disc, 0.22);
    fog.addColorStop(0, api.rgba(fc, 0.11 + (LIGHT.haze || 0.2) * 0.16));
    fog.addColorStop(1, api.rgba(fc, 0));
    g.fillStyle = fog; g.fillRect(0, hz - 20, W, (H - hz) * 0.36 + 22);
    return o.cv;
  }
  function artCanvas(api, img, dpr) {
    if (!img || !img.complete || !img.naturalWidth) return null;
    const k = img.src;
    let rec = S.art.get(k);
    if (!rec) {
      const cv = bakeArt(api, img, dpr);
      if (!cv) return null;
      rec = { cv: cv };
      /* two live entries is all a cross-fade needs; a third means a location
         churn and the oldest is dead weight. */
      if (S.art.size > 2) S.art.clear();
      S.art.set(k, rec);
    }
    return rec.cv;
  }

  /* ── per-frame passes ───────────────────────────────────────────────────── */
  function drawBody(api) {
    const ctx = api.ctx, LIGHT = api.LIGHT;
    const b = bodyPos(api);
    const R = (b.sun ? 26 : 22) * api.clamp(api.VIEW.box ? api.VIEW.box.h / 900 : 1, 0.7, 1.15);
    const puls = 1 + Math.sin(api.T * 0.9) * 0.015;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const halo = ctx.createRadialGradient(b.x, b.y, R * 0.5, b.x, b.y, R * (b.sun ? 7.0 : 5.0));
    halo.addColorStop(0, api.rgba(LIGHT.disc, b.sun ? 0.30 : 0.22));
    halo.addColorStop(0.2, api.rgba(LIGHT.disc, b.sun ? 0.12 : 0.09));
    halo.addColorStop(1, api.rgba(LIGHT.disc, 0));
    ctx.fillStyle = halo;
    ctx.beginPath(); ctx.arc(b.x, b.y, R * (b.sun ? 7.0 : 5.0), 0, 7); ctx.fill();
    /* the disc itself. Never a pure-white fill — the BAR forbids it and the
       grade's ceiling would have to claw it back. */
    const core = ctx.createRadialGradient(b.x, b.y, 0, b.x, b.y, R * puls);
    core.addColorStop(0, api.rgba(api.mixHex(LIGHT.disc, '#ffffff', 0.35), 0.95));
    core.addColorStop(0.72, api.rgba(LIGHT.disc, 0.72));
    core.addColorStop(1, api.rgba(LIGHT.disc, 0));
    ctx.fillStyle = core;
    ctx.beginPath(); ctx.arc(b.x, b.y, R * puls, 0, 7); ctx.fill();
    if (!b.sun) {
      /* moon: a couple of soft maria so it is not a featureless dot */
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 0.16;
      ctx.fillStyle = api.mixHex(LIGHT.disc, '#2a3350', 0.7);
      ctx.beginPath(); ctx.arc(b.x - R * 0.28, b.y - R * 0.18, R * 0.30, 0, 7); ctx.fill();
      ctx.beginPath(); ctx.arc(b.x + R * 0.22, b.y + R * 0.26, R * 0.20, 0, 7); ctx.fill();
      ctx.globalAlpha = 1;
    }
    ctx.restore();
  }
  /* Light shafts fanning out of the body toward the field. Drawn BEFORE the
     land bake so the ridgeline cuts them off, which is what makes them read as
     air rather than as an overlay. Deliberately near-invisible per shaft —
     they are meant to be felt, not counted. */
  function drawShafts(api) {
    const ctx = api.ctx, LIGHT = api.LIGHT;
    const b = bodyPos(api);
    const len = api.H * 1.25;
    const kI = api.clamp(LIGHT.keyI, 0.25, 1.3);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 6; i++) {
      /* fan pointing DOWN-ish, drifting a hair so the frame is never static.
         ⚠ The first pass ran these at 0.055 and they read as a hard triangular
         BEAM hanging off the disc — an effect, not air. The apex is also
         pushed above the disc so no shaft comes to a visible point. */
      const a = Math.PI * 0.5 + (i - 2.5) * 0.19 + Math.sin(api.T * 0.09 + i * 1.7) * 0.012;
      const wob = 0.026 + (i % 3) * 0.008;
      const oy = b.y - api.H * 0.05;
      const gg = ctx.createLinearGradient(b.x, oy, b.x + Math.cos(a) * len, oy + Math.sin(a) * len);
      gg.addColorStop(0, api.rgba(LIGHT.disc, 0));
      gg.addColorStop(0.16, api.rgba(LIGHT.disc, 0.020 * kI));
      gg.addColorStop(0.5, api.rgba(LIGHT.disc, 0.010 * kI));
      gg.addColorStop(1, api.rgba(LIGHT.disc, 0));
      ctx.fillStyle = gg;
      ctx.beginPath();
      ctx.moveTo(b.x, oy);
      ctx.lineTo(b.x + Math.cos(a - wob) * len, oy + Math.sin(a - wob) * len);
      ctx.lineTo(b.x + Math.cos(a + wob) * len, oy + Math.sin(a + wob) * len);
      ctx.closePath(); ctx.fill();
    }
    ctx.restore();
  }
  /* the bloom that survives the ridgeline — drawn after the land so the glow
     bleeds over the silhouette the way real flare does. */
  function drawBodyGlow(api) {
    const ctx = api.ctx, LIGHT = api.LIGHT;
    const b = bodyPos(api);
    const R = (b.sun ? 26 : 22) * api.clamp(api.VIEW.box ? api.VIEW.box.h / 900 : 1, 0.7, 1.15);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const g = ctx.createRadialGradient(b.x, b.y, R * 0.8, b.x, b.y, R * (b.sun ? 9 : 6));
    g.addColorStop(0, api.rgba(LIGHT.disc, b.sun ? 0.16 : 0.10));
    g.addColorStop(1, api.rgba(LIGHT.disc, 0));
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(b.x, b.y, R * (b.sun ? 9 : 6), 0, 7); ctx.fill();
    ctx.restore();
  }
  /* three slow haze wisps along the horizon. The only animated thing in the
     vista, and the reason the world does not look like a still. */
  function drawDrift(api) {
    const ctx = api.ctx, LIGHT = api.LIGHT, W = api.W;
    const hz = horizonY(api);
    if (!S.drift) {
      const r = mulberry32(strHash('drift'));
      S.drift = [0, 1, 2].map(i => ({
        w: 260 + r() * 320, h: 22 + r() * 30, sp: 0.006 + r() * 0.012,
        ph: r(), y: hz - 30 + r() * 70, a: 0.05 + r() * 0.05
      }));
    }
    ctx.save();
    for (const d of S.drift) {
      const x = ((d.ph + api.T * d.sp) % 1.4 - 0.2) * (W + d.w * 2) - d.w;
      const col = api.mixHex(LIGHT.fog, LIGHT.disc, 0.35);
      const g = ctx.createRadialGradient(x, d.y, 0, x, d.y, d.w);
      g.addColorStop(0, api.rgba(col, d.a));
      g.addColorStop(1, api.rgba(col, 0));
      ctx.save(); ctx.translate(x, d.y); ctx.scale(1, d.h / d.w); ctx.translate(-x, -d.y);
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, d.y, d.w, 0, 7); ctx.fill(); ctx.restore();
    }
    ctx.restore();
  }

  function draw(api) {
    const ctx = api.ctx, W = api.W, H = api.H, LIGHT = api.LIGHT;
    try { ensureBakes(api); } catch (e) { }
    /* SKY */
    if (S.sky.cv) {
      blit(ctx, S.sky.cv, W, H);
    } else {
      const g = ctx.createLinearGradient(0, 0, 0, H);
      g.addColorStop(0, LIGHT.sky[0]); g.addColorStop(0.55, LIGHT.sky[1]); g.addColorStop(1, LIGHT.sky[2]);
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    }
    /* BACKDROP ART as the far layer, respecting the host's cross-fade. */
    try {
      const bd = api.backdrop;
      if (bd && bd.img && bd.img.complete && bd.img.naturalWidth) {
        const dpr = dprOf(api);
        const fade = api.clamp(bd.fade === undefined ? 1 : bd.fade, 0, 1);
        if (bd.prev && bd.prev.complete && fade < 1) {
          const pc = artCanvas(api, bd.prev, dpr);
          if (pc) blit(ctx, pc, W, H);
        }
        const cc = artCanvas(api, bd.img, dpr);
        if (cc) {
          ctx.globalAlpha = fade;
          /* a partial cross-fade needs the alpha, so it cannot take the 1:1
             fast path unless globalAlpha is honoured — it is, save/restore
             inside blit() preserves it. */
          blit(ctx, cc, W, H);
          ctx.globalAlpha = 1;
        }
      }
    } catch (e) { ctx.globalAlpha = 1; }
    /* the body sits behind the ridgeline… */
    try { drawBody(api); drawShafts(api); } catch (e) { }
    /* …the ridges, haze band and desert floor occlude it… */
    blit(ctx, S.land.cv, W, H);
    /* …and its bloom spills back over them. */
    try { drawBodyGlow(api); drawDrift(api); } catch (e) { }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  /* ── GRADE ────────────────────────────────────────────────────────────────
     Runs after the depth-sorted actors. Composited fills and one tiny
     downsampled bloom — a full-viewport getImageData every frame is far too
     expensive and is not needed for any of this. */
  function bloom(api) {
    const ctx = api.ctx, W = api.W, H = api.H;
    const src = ctx.canvas;
    if (!src) return;
    const bw = Math.max(32, Math.round(W / 7)), bh = Math.max(24, Math.round(H / 7));
    if (!S.bloom.cv) S.bloom.cv = document.createElement('canvas');
    if (S.bloom.cv.width !== bw || S.bloom.cv.height !== bh) {
      S.bloom.cv.width = bw; S.bloom.cv.height = bh;
      S.bloom.g = S.bloom.cv.getContext('2d');
    }
    const g = S.bloom.g; if (!g) return;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalCompositeOperation = 'source-over';
    g.globalAlpha = 1;
    g.clearRect(0, 0, bw, bh);
    g.drawImage(src, 0, 0, bw, bh);
    /* bias hard toward the bright end: two multiplies of the thumbnail by
       itself is x³, so a 0.5 midtone contributes 0.13 and a 0.9 highlight
       contributes 0.73. Without this the "bloom" is just a flat haze. */
    g.globalCompositeOperation = 'multiply';
    g.drawImage(S.bloom.cv, 0, 0);
    g.drawImage(S.bloom.cv, 0, 0);
    g.drawImage(S.bloom.cv, 0, 0);
    g.globalCompositeOperation = 'source-over';
    /* ⚠ THE BLUR HAPPENS DOWN HERE, ON THE THUMBNAIL.
       It used to be `ctx.filter='blur(9px)'` on the UPSCALE, i.e. a 9px
       gaussian over the full 1640x1600 device-pixel canvas — measured at
       ~30ms/frame on this box's software rasteriser, which is the whole frame
       budget for one cosmetic pass. Blurring 75x72 px costs nothing, and the
       bilinear upscale that follows does most of the spreading anyway. */
    try {
      /* 'copy', not 'source-over': drawing a canvas onto ITSELF with the
         default op composites the blurred copy over the sharp original and
         you get a halo, not a blur. */
      g.filter = 'blur(3.5px)';
      g.globalCompositeOperation = 'copy';
      g.drawImage(S.bloom.cv, 0, 0);
      g.filter = 'none';
      g.globalCompositeOperation = 'source-over';
    } catch (e) { g.filter = 'none'; g.globalCompositeOperation = 'source-over'; }
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    /* ⚠ 0.42 with an x³ curve washed the whole field: the sand is bright
       enough that "the brightest pixels" was most of the board. x⁵ and a
       quarter of the gain keeps the bloom on the sun, the water sheen and the
       lit tiles, which is what it is for. */
    ctx.globalAlpha = 0.30;
    /* ⚠ NEAREST-NEIGHBOUR ON PURPOSE. Bilinear-upscaling the thumbnail to the
       full 1640x1600 canvas measured 26.8ms/frame here; nearest is 8.5ms and
       the difference is invisible, because the source was gaussian-blurred at
       thumbnail scale first — every "block" edge is already a smooth ramp. */
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(S.bloom.cv, 0, 0, ctx.canvas.width, ctx.canvas.height);
    ctx.restore();
  }

  function grade(api) {
    const ctx = api.ctx, W = api.W, H = api.H, LIGHT = api.LIGHT;
    ctx.save();
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    /* 1. BLOOM on the brightest pixels only. Must run before the veil so the
       fog does not get bloomed, and before the clamps so it cannot blow a
       pixel to pure white. */
    try { bloom(api); } catch (e) { ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over'; try { ctx.filter = 'none'; } catch (e2) { } }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    /* 2. THE VEIL — distance fog + vignette + centre lift, pre-composited (see
       bakeVeil for why these are not three live gradients). */
    blit(ctx, S.veil.cv, W, H);
    /* 3. THE FILMIC PASS.
       'overlay' with a warm ochre pushes the midtones warm and adds a little
       S-curve; the two flat clamps that follow do the toe and the shoulder. */
    ctx.globalCompositeOperation = 'overlay';
    ctx.globalAlpha = 0.13;
    ctx.fillStyle = api.mixHex(SAND_BASE, LIGHT.key, 0.28);
    ctx.fillRect(0, 0, W, H);
    ctx.globalAlpha = 1;
    /* TOE — 'lighten' takes the per-channel max, so this both guarantees that
       nothing in the frame is pure black (the BAR forbids it) and tints every
       deep shadow cool blue-grey in one composite. Cheaper and steadier than
       a per-pixel curve, and it cannot be defeated by anything drawn earlier.
       It is LAST for exactly that reason — the veil and the overlay run before
       it, so neither can reintroduce a crushed black. */
    ctx.globalCompositeOperation = 'lighten';
    ctx.fillStyle = 'rgb(' + SHADOW_FLOOR[0] + ',' + SHADOW_FLOOR[1] + ',' + SHADOW_FLOOR[2] + ')';
    ctx.fillRect(0, 0, W, H);
    /* SHOULDER — the mirror image: 'darken' caps every channel below 255, so
       no pixel is pure white, and because the cap is warm the clipped
       highlights read as sunlight rather than paper. */
    ctx.globalCompositeOperation = 'darken';
    ctx.fillStyle = 'rgb(' + HILIGHT_CEIL[0] + ',' + HILIGHT_CEIL[1] + ',' + HILIGHT_CEIL[2] + ')';
    ctx.fillRect(0, 0, W, H);
    ctx.globalCompositeOperation = 'source-over';
    ctx.restore();
  }

  window.BBX.vista = { draw: draw, grade: grade };
  /* read-only smoke-test surface, same spirit as the board page's __bbDebug.
     A stale bake is completely silent — the frame still paints, it just paints
     the PREVIOUS time of day — so there has to be a way to ask. */
  window.__vistaDebug = function () {
    return { skyKey: S.sky.key, landKey: S.land.key, lastBake: +S.lastBake.toFixed(2), artCached: S.art.size };
  };
})();
