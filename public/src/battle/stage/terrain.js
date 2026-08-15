/* ══════════════════════════════════════════════════════════════════════════
   stage/terrain.js — GROUND DETAIL LAYER for the battle board.

   WHAT THIS IS
   `public/battle-board/index.html` owns the terrain SPINE: the cosmetic
   heightfield, the projected tile tops, the cliff/side walls, the ambient
   occlusion in the wall creases, the cast shadows and the soft seams. That
   code has to be inline in the board page because the page is a classic
   script that cannot `import`, and because the board must still draw a
   complete field if every module under /src/battle/stage/ fails to load.

   This module is the OPTIONAL top coat: the fine geology that turns a shaded
   quad into a piece of desert floor — bedrock strata poking through the sand,
   pebble fields, wind-scoured erosion channels, a caliche crust along the
   plateau rims and salt/mineral bleaching in the basins.

   WHERE IT RUNS — READ THIS BEFORE ADDING ANYTHING EXPENSIVE
   `detail()` is called from bakeTerrain(), NOT from frame(). The whole ground
   is rendered once into an offscreen canvas and blitted thereafter, so this
   code runs ~once per map / viewport / time-of-day change and costs nothing
   per frame. That is the entire reason it can afford per-tile pebble scatter.
   It is called with the tile ALREADY CLIPPED to its top face and with the
   context saved, so it can draw freely and does not need to restore state
   beyond what it changes itself. It must not touch `api.ctx` (that is the
   live frame context, not the bake target) — draw into `g`.

   DETERMINISM IS A HARD REQUIREMENT
   Everything here is seeded from `api.hash(x, z, n)`. Math.random() would
   make the ground shimmer every time the light re-bakes, and would make the
   screenshot harness non-reproducible.

   NOT ALLOWED HERE: no gameplay reads, no postMessage, no mutation of
   api.MAP / api.paint / api.surfaces, no DOM, no npm deps, no glowing
   outlines, nothing on an even lattice. Decoration only.
   ══════════════════════════════════════════════════════════════════════════ */

window.BBX = window.BBX || {};

/* Colour mixing. api.mixHex returns a HEX string precisely so it composes
   with api.rgba(); never feed an 'rgb(…)' string back into rgba() — it parses
   to NaN, which canvas drops silently on fillStyle and throws on addColorStop
   (that bug painted every pebble on this board solid black for one build). */

/* Bilinear point inside a projected tile quad.
   P: 0 = far-left, 1 = far-right, 2 = near-right, 3 = near-left — the order
   the board's tilePoly() builds. u runs across x, v runs far → near. */
function quadPt(P, u, v){
  const ax = P[0].x + (P[1].x - P[0].x) * u, ay = P[0].y + (P[1].y - P[0].y) * u;
  const bx = P[3].x + (P[2].x - P[3].x) * u, by = P[3].y + (P[2].y - P[3].y) * u;
  return { x: ax + (bx - ax) * v, y: ay + (by - ay) * v };
}

/* An irregular closed blob in screen space. Radii are per-vertex so nothing
   here is ever a circle — circles are the "AI-generated game" tell. */
/* ⚠ WAVE 5 — `n` USED TO BE 9 AND `k` USED TO SWING 0.62..1.24, AND AT THE
   SLAB'S SIZE THAT IS NOT AN IRREGULAR BLOB, IT IS A DRAWN POLYGON. Cropped at
   4x, the level-3 tops were carrying dark triangular silhouettes with hard
   straight sides meeting at a point — the same "mountain glyph" shape repeated
   across the plateau, which is precisely the evenly-repeated-prop tell the BAR
   forbids. Nine straight segments around a 0.5-squashed ellipse gives visible
   facets; the radius swing then turns two adjacent facets into an apex.
   Callers now pass more segments, and the radius swing here is tighter, so the
   outline is a rock rather than a rendered n-gon. */
function blobPath(g, cx, cy, r, squash, n, seed, hash){
  g.beginPath();
  for (let i = 0; i <= n; i++){
    const a = (i / n) * Math.PI * 2;
    const k = 0.82 + hash(seed + i * 7, seed * 3 + i, i) * 0.28;
    const px = cx + Math.cos(a) * r * k;
    const py = cy + Math.sin(a) * r * k * squash;
    i ? g.lineTo(px, py) : g.moveTo(px, py);
  }
  g.closePath();
}

const terrain = {
  /* detail(api, g, tile)
       api  — the shared stage api (hash, rgba, mixHex, clamp, LIGHT, …)
       g    — the BAKE context, already clipped to this tile's top face
       tile — { x, z, poly, mat, level, r, cx, cy }
              poly  4 projected corners of the top face
              mat   { base, lit, shd, pale, deep, rocky, L } from the spine
              r     approx half-width of the tile in screen px
              level 0..3 plateau level (0 = basin floor) */
  detail(api, g, tile){
    const { hash, rgba, clamp } = api;
    const P = tile.poly, M = tile.mat, x = tile.x, z = tile.z;
    const r = tile.r, L = tile.level | 0;
    if (!P || !M || !(r > 0)) return;

    /* Light direction flattened onto the ground, in tile-uv space. u is +x,
       v is +z (toward the camera). The spine derives its cliff shading and
       every contact shadow from this same vector, so highlights and pebble
       shadows agree instead of fighting. */
    const lv = api.lightVector();
    const lu = lv.x, lvv = lv.z;
    const shu = -lu, shv = -lvv;                 /* where small shadows fall */

    /* ── 1. BEDROCK STRATA ──────────────────────────────────────────────
       Only on raised ground, where wind has stripped the sand off. Bands run
       at a per-tile angle so neighbouring plateaus do not comb in the same
       direction — a shared angle across the field is the thing that makes
       procedural terrain read as wallpaper. */
    if (L > 0){
      /* ⚠ WAVE 3 — THESE USED TO RUN THE FULL WIDTH OF THE TILE, u = 0 → 1,
         two or three per tile, every tile. Sixty-odd strokes that each start
         exactly on one tile boundary and stop exactly on the next is a drawn
         grid wearing a geology costume: the eye reads the ENDPOINTS, and the
         endpoints are the seams. Worse, at 8px scale they read as scratches on
         glass, which is half of the "panes of tinted glass" complaint.
         A bed outcrops for part of a face and pinches out. So each band now
         gets its own u-span, its own dip, and a thickness that tapers to
         nothing at both ends — the same construction the cliff-wall beds use,
         for the same reason. */
      const ang = (hash(x, z, 401) - 0.5) * 0.9;
      const bands = 2 + ((hash(x, z, 402) * 3) | 0);
      for (let b = 0; b < bands; b++){
        const v0 = 0.12 + hash(x, z, b * 5 + 410) * 0.76;
        const drift = ang + (hash(x, z, b * 5 + 411) - 0.5) * 0.22;
        const ua = hash(x, z, b * 5 + 413) * 0.55;
        const ub = Math.min(1, ua + 0.18 + hash(x, z, b * 5 + 414) * 0.50);
        const w = 0.9 + hash(x, z, b * 5 + 412) * 2.6;
        const NS = 6, top = [], bot = [];
        for (let k = 0; k <= NS; k++){
          const q = k / NS, u = ua + (ub - ua) * q;
          const taper = Math.sin(q * Math.PI);            /* pinch out both ends */
          const v = clamp(v0 + drift * (u - 0.5) + (hash(x, z, b * 9 + 415 + k) - 0.5) * 0.03, 0, 1);
          const p = quadPt(P, u, v);
          top.push({ x: p.x, y: p.y - w * 0.55 * taper });
          bot.push({ x: p.x, y: p.y + w * 0.45 * taper });
        }
        const band = (pts, col, alp, dy) => {
          g.beginPath(); g.moveTo(pts[0].x, pts[0].y + dy);
          for (let k = 1; k <= NS; k++) g.lineTo(pts[k].x, pts[k].y + dy);
          for (let k = NS; k >= 0; k--) g.lineTo(pts[k].x, pts[k].y + dy + w * 0.5);
          g.closePath();
          g.fillStyle = rgba(col, alp); g.fill();
        };
        /* a lit edge above and a shadowed edge below = a step, not a line */
        band(top, api.mixHex(M.pale, M.lit, 0.4), 0.06 + hash(x, z, b + 420) * 0.06, -w * 0.5);
        band(bot, M.deep, 0.07 + hash(x, z, b + 421) * 0.08, 0);
      }
      /* caliche crust: a pale bleached wash hugging the plateau's near rim,
         where the top face meets its own cliff edge */
      const rimTop = quadPt(P, 0.5, 0.80);
      const cg = g.createRadialGradient(rimTop.x, rimTop.y, r * 0.1, rimTop.x, rimTop.y, r * 1.5);
      cg.addColorStop(0, rgba(M.pale, 0.09));
      cg.addColorStop(1, rgba(M.pale, 0));
      g.fillStyle = cg;
      g.fillRect(P[0].x - r * 2, P[0].y - r, r * 4, Math.abs(P[2].y - P[0].y) + r * 2);
    }

    /* ── 2. WIND SCOUR ──────────────────────────────────────────────────
       Low ground collects drifted sand: shallow ripples aligned to the light
       so their lit crests and dark troughs match the key. Basins (level 0
       tiles that sit below a neighbour) get a faint mineral bleach as well. */
    if (L === 0){
      const ripples = 3 + ((hash(x, z, 430) * 3) | 0);
      for (let i = 0; i < ripples; i++){
        const v0 = 0.10 + hash(x, z, i * 3 + 431) * 0.8;
        const bow = (hash(x, z, i * 3 + 432) - 0.5) * 0.34;
        const a = quadPt(P, 0.0, clamp(v0 + bow * 0.4, 0, 1));
        const c = quadPt(P, 0.5, clamp(v0 - bow, 0, 1));
        const bpt = quadPt(P, 1.0, clamp(v0 + bow * 0.4, 0, 1));
        g.lineWidth = 1.0 + hash(x, z, i + 433) * 1.8;
        g.strokeStyle = rgba(M.pale, 0.05 + hash(x, z, i + 434) * 0.05);
        g.beginPath(); g.moveTo(a.x, a.y - 1); g.quadraticCurveTo(c.x, c.y - 1, bpt.x, bpt.y - 1); g.stroke();
        g.strokeStyle = rgba(M.deep, 0.06 + hash(x, z, i + 435) * 0.05);
        g.beginPath(); g.moveTo(a.x, a.y); g.quadraticCurveTo(c.x, c.y, bpt.x, bpt.y); g.stroke();
      }
    }

    /* ── 3. LAG GRAVEL ──────────────────────────────────────────────────
       ⚠ WAVE 3 REWRITE — THIS WAS THE STRONGEST "AI-GENERATED" TELL LEFT.
       The critic counted "25-30 identical pale ellipses per tile, same size,
       same aspect ratio, varied only by rotation, evenly scattered" and called
       it the most-repeated element in the whole frame. They were describing
       this loop exactly: one ellipse primitive, aspect pinned at 0.66, radius
       from a flat 0.016..0.064 band, position from a flat uniform, and up to
       31 of them on every single tile.
       Three things were wrong and all three are fixed here:
         SIZE — real lag gravel is a POWER LAW. Hundreds of grains for every
           pebble, a handful of pebbles for every cobble. `pow(h, 3.1)` gives
           that; a flat band gives the uniform-sprite read.
         SHAPE — a third of the stones are now angular chips (4-6 sided
           polygons), the ellipses' aspect runs 0.34..0.95, and the squash axis
           is rotated per stone. No two are the same silhouette.
         PLACEMENT — an even scatter is machine-made. Stones collect: wind
           strips the fines out of a patch and leaves a gravel LAG behind, so
           most of them sit in one or two clusters per tile with a few strays,
           and roughly a third of tiles carry almost nothing. */
    const density = hash(x, z, 440);
    const bare = density < 0.34;
    const count = bare ? (1 + ((density * 7) | 0))
                       : (4 + ((density * 11) | 0)) + L * 2;
    /* one or two lag patches per tile; strays are placed anywhere */
    const lagN = 1 + ((hash(x, z, 441) * 2) | 0);
    const lag = [];
    for (let i = 0; i < lagN; i++)
      lag.push({ u: 0.14 + hash(x, z, i * 5 + 442) * 0.72,
                 v: 0.14 + hash(x, z, i * 5 + 443) * 0.72,
                 r: 0.16 + hash(x, z, i * 5 + 444) * 0.26 });
    for (let i = 0; i < count; i++){
      const stray = hash(x, z, i * 7 + 445) > 0.72;
      let u, v;
      if (stray){
        u = 0.05 + hash(x, z, i * 3 + 450) * 0.90;
        v = 0.05 + hash(x, z, i * 3 + 451) * 0.90;
      } else {
        const c0 = lag[(hash(x, z, i * 7 + 446) * lag.length) | 0];
        /* sqrt-biased radius = uniform area inside the patch, not a bullseye */
        const rad = c0.r * Math.sqrt(hash(x, z, i * 3 + 450));
        const th = hash(x, z, i * 3 + 451) * 6.283;
        u = clamp(c0.u + Math.cos(th) * rad, 0.04, 0.96);
        v = clamp(c0.v + Math.sin(th) * rad * 0.72, 0.04, 0.96);
      }
      const p = quadPt(P, u, v);
      const hs = hash(x, z, i * 3 + 452);
      /* POWER LAW. 0.008r is a grain you can barely resolve, 0.075r is a
         cobble, and the exponent puts most of the population at the bottom. */
      const s = r * (0.008 + Math.pow(hs, 3.1) * 0.068) * (1 + L * 0.18);
      const rot = hash(x, z, i + 460) * 3.14;
      const squash = 0.34 + hash(x, z, i + 462) * 0.61;
      const chip = hash(x, z, i + 463) > 0.66;      /* angular, not rounded */
      /* contact shadow first, so the stone sits on top of its own shadow.
         Only the ones big enough to cast one — a grain does not. */
      if (s > r * 0.016){
        g.fillStyle = rgba(M.deep, 0.14 + hs * 0.14);
        g.beginPath();
        g.ellipse(p.x + shu * s * 1.5, p.y + shv * s * 0.9 + s * 0.35,
                  s * 1.15, s * 0.55, rot, 0, 7);
        g.fill();
      }
      g.fillStyle = rgba(api.mixHex(M.base, M.pale, 0.18 + hash(x, z, i + 461) * 0.62),
                         0.42 + hash(x, z, i + 464) * 0.34);
      g.beginPath();
      if (chip){
        const sides = 4 + ((hash(x, z, i + 465) * 3) | 0);
        for (let k = 0; k < sides; k++){
          const th = rot + (k / sides) * 6.283;
          const kr = s * (0.55 + hash(x, z, i * 9 + 466 + k) * 0.85);
          const qx = p.x + Math.cos(th) * kr, qy = p.y + Math.sin(th) * kr * squash;
          k ? g.lineTo(qx, qy) : g.moveTo(qx, qy);
        }
        g.closePath();
      } else {
        g.ellipse(p.x, p.y, s, s * squash, rot, 0, 7);
      }
      g.fill();
      /* a single lit facet on the light-facing side of the bigger stones */
      if (s > r * 0.030){
        g.fillStyle = rgba(M.pale, 0.16 + hs * 0.14);
        g.beginPath();
        g.ellipse(p.x + lu * s * 0.3, p.y + lvv * s * 0.2 - s * 0.18,
                  s * 0.45, s * 0.26, rot, 0, 7);
        g.fill();
      }
    }
    /* ── 3b. GRIT AT A SECOND SCALE ─────────────────────────────────────
       The field's only high-frequency content used to be the spine's one
       stipple size plus Skia's own 1px gradient dither, and a single
       frequency everywhere reads as wallpaper rather than as material. This
       is a much finer, much fainter class than the gravel above — sub-pixel
       flecks that give the sand a second grain size to sit at. */
    const grit = bare ? 10 : 22;
    for (let i = 0; i < grit; i++){
      const p = quadPt(P, 0.03 + hash(x, z, i * 2 + 500) * 0.94,
                          0.03 + hash(x, z, i * 2 + 501) * 0.94);
      const s = r * (0.004 + hash(x, z, i + 502) * 0.011);
      g.fillStyle = rgba(hash(x, z, i + 503) > 0.5 ? M.pale : M.deep,
                         0.05 + hash(x, z, i + 504) * 0.09);
      g.beginPath();
      g.ellipse(p.x, p.y, s, s * (0.4 + hash(x, z, i + 505) * 0.5),
                hash(x, z, i + 506) * 3, 0, 7);
      g.fill();
    }

    /* ── 4. EXPOSED BEDROCK SLAB ────────────────────────────────────────
       A minority of tiles (weighted toward high ground) break open and show a
       flat irregular slab of the rock underneath, with a shadowed lip. This
       is the main thing that stops the field from reading as one material. */
    const slabRoll = hash(x, z, 470);
    if (slabRoll > (L > 0 ? 0.55 : 0.80)){
      const u = 0.22 + hash(x, z, 471) * 0.56;
      const v = 0.22 + hash(x, z, 472) * 0.56;
      const p = quadPt(P, u, v);
      const rr = r * (0.18 + hash(x, z, 473) * 0.26);
      /* seat it: darkened sand banked up against the upwind side */
      blobPath(g, p.x + shu * rr * 0.22, p.y + shv * rr * 0.14 + rr * 0.12, rr * 1.12, 0.5, 15, 900 + x * 13 + z, hash);
      g.fillStyle = rgba(M.deep, 0.13); g.fill();
      blobPath(g, p.x, p.y, rr, 0.52, 15, 900 + x * 13 + z, hash);
      /* ⚠ 0.68 alpha in round 1. A slab is the biggest thing this module puts
         on a tile and it lands near the middle, so at that strength it could
         move a tile's measured centre value by ±20 luma — most of an elevation
         step — and the spine's whole point is that value means HEIGHT. At 0.40
         the slab still reads as a different material catching the key; it just
         no longer argues about which plateau it is on.
         ⚠ WAVE 5 — AND IT MUST BE VALUE-NEUTRAL, NOT MERELY WEAK. 0.40/0.40
         across a pale→deep gradient plus a 0.22 seat under it is a NET DARK
         event: measured on the isolated bake it cost a level-3 top up to 17
         luma of face mean against its unslabbed same-level neighbour, and the
         spine's tone lock cannot see it (the loop takes a median over the face
         and a slab covers well under half of one), so it survived as a
         permanent per-tile offset — the "patchwork of separately-painted
         slabs" the wave-3 critic reported, drawn by the thing literally named
         slab. The two halves are now balanced around the tile's own base and
         the seat is halved, so the slab reads as a different MATERIAL catching
         the key without voting on the tile's value at all. */
      const sg = g.createLinearGradient(p.x + lu * rr, p.y - rr * 0.6, p.x - lu * rr, p.y + rr * 0.6);
      sg.addColorStop(0, rgba(api.mixHex(M.pale, M.lit, 0.5), 0.34));
      sg.addColorStop(0.5, rgba(M.base, 0.30));
      sg.addColorStop(1, rgba(api.mixHex(M.base, M.deep, 0.45), 0.30));
      g.fillStyle = sg; g.fill();
      /* fracture lines across the slab */
      g.strokeStyle = rgba(M.deep, 0.26); g.lineWidth = 0.8;
      for (let i = 0; i < 2; i++){
        const a = hash(x, z, i + 480) * 6.283;
        g.beginPath();
        g.moveTo(p.x - Math.cos(a) * rr * 0.8, p.y - Math.sin(a) * rr * 0.42);
        g.lineTo(p.x + Math.cos(a) * rr * 0.8, p.y + Math.sin(a) * rr * 0.42);
        g.stroke();
      }
    }

    /* ── 5. DAMP / DARK PATCH ───────────────────────────────────────────
       Occasional low-lying stain — the ground is not uniformly dry. Kept off
       raised tiles, where water would not sit. */
    if (L === 0 && hash(x, z, 490) > 0.74){
      const p = quadPt(P, 0.2 + hash(x, z, 491) * 0.6, 0.2 + hash(x, z, 492) * 0.6);
      const rr = r * (0.4 + hash(x, z, 493) * 0.6);
      const dg = g.createRadialGradient(p.x, p.y, 0, p.x, p.y, rr);
      dg.addColorStop(0, rgba(M.deep, 0.18));
      dg.addColorStop(0.7, rgba(M.deep, 0.07));
      dg.addColorStop(1, rgba(M.deep, 0));
      g.fillStyle = dg;
      g.beginPath(); g.ellipse(p.x, p.y, rr, rr * 0.55, hash(x, z, 494) * 3, 0, 7); g.fill();
    }
  }
};

window.BBX.terrain = terrain;
