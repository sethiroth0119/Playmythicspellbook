/* ============================================================================
   WARPATH — the painted world. Presentation only.
   ----------------------------------------------------------------------------
   THE WHOLE POINT OF THIS FILE: warpath-mapgen.js decides WHAT is at a tile.
   This file decides what that LOOKS like. It is the only place in the mode
   allowed to be beautiful, and the only place forbidden from being consulted
   about anything.

   THE RULE, because it is the one that must not break:

     Nothing in here may change what exists at a coordinate.

   The world is a deterministic function of the run seed, and the plpgsql
   mirror in the Warpath migration re-derives the identical tile from the
   identical (seed,x,y). That agreement is what stops a crafted client from
   inventing a Dragon Heart node. So this file NEVER decides that a tile is
   water, or forest, or holds a node — it asks warpath-mapgen.js and then
   paints the answer.

   Everything below the tile — where an individual pine stands inside a forest
   tile, where a ridge line runs across a mountain, how a shoreline wobbles —
   is invented here, and every bit of it comes out of the SAME wpHash32 with
   render-only salts (700+). That matters for two reasons:

     • it is stable. Reload the page, or open the run on another continent on
       somebody else's laptop, and the same tree is under the same rock.
     • it is never transmitted and never validated. The server has no opinion
       about tree #4 of tile (17,9) and must never acquire one. If you ever
       find yourself wanting to send a render salt to the server, you have
       made a rules decision in the wrong file — move it to warpath-mapgen.js.

   HOW IT DRAWS, in one paragraph. A campaign map does not read as a world
   because of its colours; it reads as a world because of RELIEF. So the first
   thing built is a height field: per-biome base elevation, spatially blurred
   so it has no tile steps, plus five octaves of value noise, plus a ridged
   term weighted by how rugged the biome is. That field is then lit by a fixed
   sun in the upper-left — a real surface normal dotted against a real light
   vector — and a real cast-shadow ray is marched toward that sun, so Dragon
   Mountain throws a shadow across the ground to its lower-right. Everything
   else (biome texture, shoreline, snowline, ember glow in the crevices) is
   modulated by that same field, which is what makes the picture cohere
   instead of looking like six flat stickers.

   AND THE GRID DIES. Every lookup into the tile data is done through a
   DOMAIN WARP: before asking "which biome is here?", the sample point is
   displaced by a couple of octaves of noise, about half a tile. A straight
   cell boundary becomes a wandering hand-drawn one; a square pond becomes a
   ragged pool. Scattered detail (trees, crags, headstones) is placed in
   continuous space and tests the WARPED biome at its own position, not the
   biome of the tile that spawned it — which is why a forest edge is a
   thinning of trees rather than a line of them.

   COST. bakeTerrain() is heavy and runs ONCE per seed, into an offscreen
   canvas; draw() blits that canvas and composites only the things that
   actually change — fog, camps, heroes, the cursor. Measured numbers are in
   the commit message; the short version is that the bake is a loading-screen
   expense and the frame is a blit plus a handful of small composites.

   Loaded as a plain <script> by public/warpath/index.html (window.WarpathRender)
   and as a CommonJS module by the render harness. Depends on warpath-mapgen.js
   for the world and for wpHash32 — and on nothing else. No framework, no build
   step, no WebGL, no external images, no fonts it cannot fall back from.
   ========================================================================= */
(function (root) {
'use strict';

/* Resolve warpath-mapgen lazily. In the browser it is a sibling <script> and
   load order is index.html's problem; under CommonJS it is a require. Doing it
   on first use rather than at module scope means this file does not care which
   tag came first. */
var _M = null;
function mapgen() {
  if (_M) return _M;
  if (root.WarpathMap) return (_M = root.WarpathMap);
  if (typeof require === 'function') {
    try { return (_M = require('./warpath-mapgen.js').WarpathMap); } catch (e) { /* fall through */ }
  }
  throw new Error('warpath-render: warpath-mapgen.js must be loaded first');
}

/* ── Render salts ─────────────────────────────────────────────────────────
   Deliberately far above every salt in warpath-mapgen.js (1..13, plus 41 and
   108). If these ever collide with a generator salt the render stops being
   independent of the world and starts correlating with it in ways that look
   like a bug — a mountain whose ridges always run the same way as its node
   layout. Keep new render salts in the 700 block.                          */
var R_WARP_A = 701, R_WARP_B = 702, R_WARP_C = 703,
    R_DET    = 710,   // +0..4, the five detail octaves
    R_CLUMP  = 720,   // vegetation density variation
    R_SCAT   = 730,   // object scatter
    R_GRAIN  = 740,   // paper grain
    R_CLOUD  = 750,   // fog cloud texture
    R_RIVER  = 760,   // river sources and meander
    R_ROAD   = 770,   // road wobble
    R_FOGJIT = 780;   // fog blob jitter

/* ── The palette ──────────────────────────────────────────────────────────
   Three tones per biome, not one. `tone` in warpath-mapgen.js is a UI colour —
   it is the right thing for a legend swatch and the wrong thing for terrain,
   because real ground does not get darker by multiplying its own hue. It gets
   COOLER in shadow and WARMER in light. So every biome carries a cool `deep`,
   a neutral `base` and a warm `lit`, and the hillshade picks a point along
   that three-stop ramp. That single change is most of the difference between
   "shaded cells" and "painted ground".

   `rough` is how much the height field is allowed to misbehave here, and
   `elev` is where the biome sits before noise. Both are blurred across tile
   boundaries before use, so a forest next to a mountain gets foothills.

   ⚠ THE PALETTES ARE DELIBERATELY CLOSE TOGETHER. The first pass at this file
   used the generator's UI tones directly — a purple graveyard against a
   yellow-green steppe — and the result was a colour-block map: every biome
   boundary was a hard chromatic seam no amount of feathering could hide, and
   the whole thing read as a chart rather than as ground. Real campaign art
   keeps one earthy range across the entire map and lets TEXTURE carry biome
   identity, which is also exactly what the "identifiable in greyscale" test
   demands. So the six palettes here all live in the same muted band and the
   difference between the Graveyard and the Ashen Wastes is that one is full of
   headstones and the other is full of cracks.                                */
var PAL = {
  plains:    { deep: '#4c5139', base: '#7d8058', lit: '#b0ab7e', elev: 0.17, rough: 0.30 },
  forest:    { deep: '#232c22', base: '#41503a', lit: '#7d8659', elev: 0.30, rough: 0.40 },
  graveyard: { deep: '#2c2c30', base: '#585a58', lit: '#95968f', elev: 0.25, rough: 0.34 },
  facility:  { deep: '#252d33', base: '#4e5a5f', lit: '#8e979a', elev: 0.22, rough: 0.20 },
  mountain:  { deep: '#312320', base: '#6a5044', lit: '#b0937c', elev: 0.82, rough: 1.00 },
  wastes:    { deep: '#4e442f', base: '#8d8062', lit: '#cdbf9d', elev: 0.28, rough: 0.50 },
};
// Precomputed as integer triples. parseInt() on a hex string is not something
// to do a million times inside the shading loop — it was most of the first
// version's bake cost.
var PALV = (function () {
  var o = {}, k;
  for (k in PAL) o[k] = { deep: hex(PAL[k].deep), base: hex(PAL[k].base), lit: hex(PAL[k].lit) };
  return o;
})();
var BORDER = BIOME_ORDER_SAFE();
function BIOME_ORDER_SAFE() { return ['plains', 'forest', 'graveyard', 'facility', 'mountain', 'wastes']; }

// Water. Painted as a body with a bed, not as a blue cell: a pale shallow rim
// over the drowned biome colour, grading to a cold deep, plus foam and sheen.
var WATER = {
  shore: '#6b7f78', mid: '#2e4a55', deep: '#152a36',
  foam:  '#c8d2c8', sheen: '#8fa8ac',
};
var WATERV = { shore: hex('#6b7f78'), mid: hex('#2e4a55'), deep: hex('#152a36'),
               foam: hex('#c8d2c8'), sheen: hex('#8fa8ac') };
var SNOW = { lit: '#e6ebf0', deep: '#9aa5b0' };
var SNOWV = { lit: hex('#e6ebf0'), deep: hex('#9aa5b0') };

// Where the sun is. Upper-left, fairly low, so relief is strong and shadows
// are long. Everything in the file — hillshade, cast shadow, the lit face of
// every tent and crag — uses THESE numbers. A consistent light is most of what
// makes hand-drawn map art look drawn by one hand.
var LX = -0.640, LY = -0.618, LZ = 0.456;          // normalised below
var SUN_TAN = 0.512;   // vertical/horizontal — sets cast-shadow length
var SHADOW_STEPS = 14, SHADOW_STRIDE = 3;

/* ── Geometry of the bake ─────────────────────────────────────────────────
   `px` is bake pixels per world tile. 28 puts a 44x30 world on a 1232x840
   canvas: enough that an individual pine is ~9px across and reads as a pine,
   small enough that the whole bake is one megapixel and fits comfortably in a
   phone's canvas budget. Callers on a big desktop can raise it; `quality`
   exists so the app can drop it on a weak device without knowing the number. */
var QUALITY = { low: 16, med: 22, high: 28, ultra: 36 };

// ── tiny utils ────────────────────────────────────────────────────────────
function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
function sstep(a, b, x) { if (x <= a) return 0; if (x >= b) return 1; x = (x - a) / (b - a); return x * x * (3 - 2 * x); }
function mix(a, b, t) { return a + (b - a) * t; }
function hex(c) { var n = parseInt(c.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
function rgba(c, a) { var p = hex(c); return 'rgba(' + p[0] + ',' + p[1] + ',' + p[2] + ',' + a + ')'; }
function mkCanvas(w, h) {
  if (typeof document !== 'undefined' && document.createElement) {
    var c = document.createElement('canvas'); c.width = w; c.height = h; return c;
  }
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  throw new Error('warpath-render: no canvas implementation available');
}
// A render-only PRNG, seeded from wpHash32. Fine to be a plain LCG: it never
// leaves this file and never has to agree with Postgres about anything.
function rng(h) {
  var s = h >>> 0;
  return function () { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
}

/* ── Noise ────────────────────────────────────────────────────────────────
   Value noise on an integer lattice, smoothstep-interpolated, with the lattice
   values coming from wpHash32 so the whole picture is a pure function of the
   run seed. Octaves are precomputed as small Float32 grids and then sampled
   bilinearly per pixel — building a 200x136 grid once and reading it a million
   times is an order of magnitude cheaper than hashing per pixel, and is
   numerically identical.

   ⚠ wpHash32 is documented as taking non-negative x and y. Grid coordinates
   here are always >= 0 by construction, and the +4096 offsets on the sampling
   side exist so that a domain-warped lookup near the map edge cannot push a
   coordinate negative and quietly start hashing garbage.                     */
function noiseGrid(seed, salt, gw, gh) {
  var g = new Float32Array(gw * gh), x, y, i = 0;
  var M = mapgen();
  for (y = 0; y < gh; y++) for (x = 0; x < gw; x++) g[i++] = M.wpHash32(seed, x + 4096, y + 4096, salt) / 4294967296;
  return g;
}
function sampleGrid(g, gw, gh, u, v) {
  var x0 = u | 0, y0 = v | 0;
  if (x0 < 0) x0 = 0; else if (x0 > gw - 2) x0 = gw - 2;
  if (y0 < 0) y0 = 0; else if (y0 > gh - 2) y0 = gh - 2;
  var fx = u - x0, fy = v - y0;
  fx = fx < 0 ? 0 : (fx > 1 ? 1 : fx);
  fy = fy < 0 ? 0 : (fy > 1 ? 1 : fy);
  fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy);
  var i = y0 * gw + x0;
  var a = g[i], t = a + (g[i + 1] - a) * fx;
  var c = g[i + gw];
  return t + ((c + (g[i + gw + 1] - c) * fx) - t) * fy;
}
// Bilinear read of a per-TILE field at tile-centre convention: the stored
// value for tile (x,y) lives at continuous coordinate (x+0.5, y+0.5).
function sampleTile(a, w, h, fx, fy) {
  var u = fx - 0.5, v = fy - 0.5;
  var x0 = Math.floor(u), y0 = Math.floor(v);
  var tx = u - x0, ty = v - y0;
  if (x0 < 0) { x0 = 0; tx = 0; } else if (x0 > w - 2) { x0 = w - 2; tx = 1; }
  if (y0 < 0) { y0 = 0; ty = 0; } else if (y0 > h - 2) { y0 = h - 2; ty = 1; }
  var i = y0 * w + x0;
  var p = a[i], q = a[i + 1], r = a[i + w], s = a[i + w + 1];
  var m = p + (q - p) * tx;
  return m + ((r + (s - r) * tx) - m) * ty;
}
// Separable [1,2,1]/4 blur, in place, n passes. This is what removes the tile
// staircase from the base elevation and the biome tone before anything is
// sampled from them.
function blurTiles(a, w, h, passes) {
  var tmp = new Float32Array(w * h), p, x, y, i;
  for (p = 0; p < passes; p++) {
    for (y = 0; y < h; y++) for (x = 0; x < w; x++) {
      i = y * w + x;
      tmp[i] = (a[i - (x > 0 ? 1 : 0)] + 2 * a[i] + a[i + (x < w - 1 ? 1 : 0)]) * 0.25;
    }
    for (y = 0; y < h; y++) for (x = 0; x < w; x++) {
      i = y * w + x;
      a[i] = (tmp[i - (y > 0 ? w : 0)] + 2 * tmp[i] + tmp[i + (y < h - 1 ? w : 0)]) * 0.25;
    }
  }
  return a;
}

/* ══════════════════════════════════════════════════════════════════════════
   BAKE
   ══════════════════════════════════════════════════════════════════════ */

/* The five detail octaves, expressed as "lattice cells across the map width".
   6 is continental — whole regions rise and fall. 110 is gravel. The ridged
   weights are deliberately front-loaded onto the middle octaves: ridged noise
   at the finest octave is just noisy, while at 27 cells (~1.6 tiles) it is
   exactly the scale of a mountain arête.                                     */
var OCT_CELLS = [6, 13, 27, 55, 110];
var OCT_FBM   = [0.44, 0.26, 0.16, 0.09, 0.05];
var OCT_RIDGE = [0.36, 0.32, 0.20, 0.09, 0.03];

/* How wide, in tiles, the mottled band between two biomes is. Wide enough
   that no straight bisector survives it; narrow enough that a small region
   still has a recognisable middle. */
var INTERGRADE = 2.6;

function bakeTerrain(seed, opts) {
  opts = opts || {};
  var M = mapgen();
  seed = seed >>> 0;
  var t0 = now();

  var world = opts.world || M.generate(seed);
  var W = M.WORLD_W, H = M.WORLD_H;
  var PX = opts.px || QUALITY[opts.quality || 'high'] || QUALITY.high;
  var BW = W * PX, BH = H * PX;

  var cv = mkCanvas(BW, BH);
  var ctx = cv.getContext('2d');

  // ── 1. Tile-level fields ────────────────────────────────────────────────
  // Everything the renderer knows about the world comes from here and nowhere
  // else. `bi` is the LAND biome even under a lake — a lake bed is made of the
  // ground it drowned, and painting it that way is why the water reads as
  // sitting IN the terrain rather than punched through it.
  var cores = world.cores || M.biomeCores(seed);
  var bi = new Uint8Array(W * H);
  var wet = new Float32Array(W * H);
  var elevT = new Float32Array(W * H);
  var roughT = new Float32Array(W * H);
  var toneR = new Float32Array(W * H), toneG = new Float32Array(W * H), toneB = new Float32Array(W * H);
  var x, y, i, b, p;
  for (y = 0; y < H; y++) for (x = 0; x < W; x++) {
    i = y * W + x;
    var name = M.biomeAt(seed, cores, x, y);
    b = BORDER.indexOf(name); if (b < 0) b = 0;
    bi[i] = b;
    var isW = M.isWater(seed, x, y);
    wet[i] = isW ? 1 : 0;
    var pal = PAL[name];
    elevT[i] = pal.elev - (isW ? 0.30 : 0);
    roughT[i] = isW ? 0.05 : pal.rough;
    p = hex(pal.base);
    toneR[i] = p[0]; toneG[i] = p[1]; toneB[i] = p[2];
  }
  // The water field is deliberately NOT a plain blur. A blur alone erases a
  // lone pond (its centre falls to 0.25 and the threshold eats it), and a lone
  // pond is real data — the generator put it there and the server agrees it is
  // there. So the field keeps 55% of the raw mask and takes 45% from the
  // neighbourhood: an isolated water tile still clears the threshold, an
  // isolated LAND tile inside a lake still survives, and everything in between
  // gets a soft, gradable bank instead of a cell wall.
  var wetBlur = new Float32Array(wet);
  blurTiles(wetBlur, W, H, 1);
  for (i = 0; i < W * H; i++) wet[i] = 0.55 * wet[i] + 0.45 * wetBlur[i];

  blurTiles(elevT, W, H, 3);   // 3 passes ≈ three tiles of foothill
  blurTiles(roughT, W, H, 2);
  blurTiles(toneR, W, H, 1); blurTiles(toneG, W, H, 1); blurTiles(toneB, W, H, 1);

  // ── 2. Noise octaves ────────────────────────────────────────────────────
  var oct = [], k;
  for (k = 0; k < OCT_CELLS.length; k++) {
    var cw = OCT_CELLS[k] + 1, ch = Math.round(OCT_CELLS[k] * H / W) + 1;
    oct.push({ g: noiseGrid(seed, R_DET + k, cw, ch), w: cw, h: ch,
               sx: OCT_CELLS[k] / BW, sy: (ch - 1) / BH });
  }
  // Domain-warp octaves. Two low frequencies for the big wander plus one
  // higher one for fine raggedness. This is the single mechanism that kills
  // the visible tile grid, so it is worth understanding: nothing here changes
  // the biome of a tile, it changes WHERE ON THE MAP we look the biome up.
  //
  // ⚠ The amplitudes are big — the low octave alone displaces the lookup by
  // most of a tile. That is deliberate and it is the difference between a
  // Voronoi diagram and a coastline. The generator's biome regions are a
  // Voronoi over 12 cores, so their boundaries are STRAIGHT LINES, and a
  // straight line half a tile thick still reads as a straight line from across
  // the room. It takes a wander on the order of a tile, at a wavelength of
  // several tiles, before the eye stops seeing the bisector.
  //
  // Water is warped by a fraction of this (WATER_WARP below) for a reason
  // worth stating: which tiles are water is a PASSABILITY fact the server
  // agrees with, and a coastline that wanders a whole tile would put open
  // ground under paint that looks like a lake. Biome is cosmetic; water is not
  // quite.
  // ⚠ WARP_C is not a rounding error, it is the STAIRCASE KILLER. Even with a
  // whole tile of low-frequency wander, the biome lookup is still
  // nearest-neighbour, so the boundary is the warped preimage of a cell edge:
  // a wobbling staircase whose steps are exactly one tile. You can count the
  // tiles off it, which is the stated failure condition. A high-frequency warp
  // at nearly half a tile chews those steps into a ragged interlock at a
  // scale well below one cell, and the staircase stops existing.
  var wa = { g: noiseGrid(seed, R_WARP_A, 8, 7), w: 8, h: 7 };
  var wb = { g: noiseGrid(seed, R_WARP_B, 19, 14), w: 19, h: 14 };
  var wc = { g: noiseGrid(seed, R_WARP_C, 67, 47), w: 67, h: 47 };
  var wd = { g: noiseGrid(seed, R_WARP_C + 1, 157, 108), w: 157, h: 108 };
  var WARP_A = 0.80, WARP_B = 0.34, WARP_C = 0.38, WARP_D = 0.15;   // in tiles
  var WATER_WARP = 0.42;

  // ── 3. Per-pixel fields ─────────────────────────────────────────────────
  var N = BW * BH;
  var ELEV = new Float32Array(N);
  var WVAL = new Float32Array(N);
  var DET  = new Float32Array(N);
  var BIO  = new Uint8Array(N);
  var WXA  = new Float32Array(N);
  var WYA  = new Float32Array(N);
  var TR = new Float32Array(N), TG = new Float32Array(N), TB = new Float32Array(N);
  var RGA = new Uint8Array(N);          // ruggedness, kept for the rock blend

  /* The warp is evaluated at HALF resolution and bilinearly upsampled. Eight
     grid samples per pixel was the single most expensive thing in the bake,
     and the displacement field is smooth by construction — its finest octave
     has a wavelength of eight pixels — so half-rate sampling is visually free
     and roughly quarters the cost. */
  var HW = (BW >> 1) + 2, HH = (BH >> 1) + 2;
  var HDX = new Float32Array(HW * HH), HDY = new Float32Array(HW * HH);
  for (y = 0; y < HH; y++) for (x = 0; x < HW; x++) {
    var hfx = (x * 2 + 0.5) / PX, hfy = (y * 2 + 0.5) / PX;
    var ua = hfx * (wa.w - 1) / W, va = hfy * (wa.h - 1) / H;
    var ub = hfx * (wb.w - 1) / W, vb = hfy * (wb.h - 1) / H;
    var uc = hfx * (wc.w - 1) / W, vc = hfy * (wc.h - 1) / H;
    var ud = hfx * (wd.w - 1) / W, vd = hfy * (wd.h - 1) / H;
    var ii = y * HW + x;
    HDX[ii] = (sampleGrid(wa.g, wa.w, wa.h, ua, va) - 0.5) * WARP_A
            + (sampleGrid(wb.g, wb.w, wb.h, ub, vb) - 0.5) * WARP_B
            + (sampleGrid(wc.g, wc.w, wc.h, uc, vc) - 0.5) * WARP_C
            + (sampleGrid(wd.g, wd.w, wd.h, ud, vd) - 0.5) * WARP_D;
    HDY[ii] = (sampleGrid(wa.g, wa.w, wa.h, va + 2.1, ua + 1.3) - 0.5) * WARP_A
            + (sampleGrid(wb.g, wb.w, wb.h, vb + 3.7, ub + 2.9) - 0.5) * WARP_B
            + (sampleGrid(wc.g, wc.w, wc.h, vc + 5.3, uc + 4.1) - 0.5) * WARP_C
            + (sampleGrid(wd.g, wd.w, wd.h, vd + 7.9, ud + 6.7) - 0.5) * WARP_D;
  }

  /* The cores, unpacked into flat arrays for the per-pixel Voronoi, plus a
     per-core fuzz weight. `CF` is what decorrelates the cores from each other:
     one shared noise field multiplied by a different constant per core means
     the boundary between any two of them wanders, while a single global fuzz
     would just scale everything equally and move nothing. */
  var CN = cores.length;
  var CX = new Float32Array(CN), CY = new Float32Array(CN),
      CB = new Uint8Array(CN), CF = new Float32Array(CN);
  for (k = 0; k < CN; k++) {
    CX[k] = cores[k].x; CY[k] = cores[k].y;
    var cbi = BORDER.indexOf(cores[k].biome); CB[k] = cbi < 0 ? 0 : cbi;
    CF[k] = 0.12 + (M.wpHash32(seed, k + 1, 3, R_WARP_C + 5) % 1000) / 1000 * 0.30;
  }
  var FZW = 97, FZH = 68, fzg = noiseGrid(seed, R_WARP_C + 3, FZW, FZH);

  /* Per-tile shortlist of the cores that could plausibly win anywhere inside
     that tile. Testing all twelve cores at every one of a million pixels was
     the single largest line item in the bake; the warp displaces a lookup by
     at most about 1.5 tiles, so the five nearest cores to the tile are a safe
     superset of the possible winners and the inner loop shrinks by 60%.
     Purely a speed structure — it cannot change the answer. */
  var CAND_N = 5;
  var CAND = new Uint8Array(W * H * CAND_N);
  (function () {
    var order = [], t, tx2, ty2, kk;
    for (ty2 = 0; ty2 < H; ty2++) for (tx2 = 0; tx2 < W; tx2++) {
      order.length = 0;
      for (kk = 0; kk < CN; kk++) {
        var ax = CX[kk] - tx2, ay = CY[kk] - ty2;
        order.push([ax * ax + ay * ay, kk]);
      }
      order.sort(function (a, b) { return a[0] - b[0]; });
      t = (ty2 * W + tx2) * CAND_N;
      for (kk = 0; kk < CAND_N; kk++) CAND[t + kk] = order[kk][1];
    }
  })();

  var invPX = 1 / PX;
  for (y = 0; y < BH; y++) {
    var rowBase = y * BW;
    var fy = (y + 0.5) * invPX;
    var hy = y * 0.5, hy0 = hy | 0, hyf = hy - hy0;
    for (x = 0; x < BW; x++) {
      i = rowBase + x;
      var fx = (x + 0.5) * invPX;
      var hx = x * 0.5, hx0 = hx | 0, hxf = hx - hx0;
      var q = hy0 * HW + hx0;
      var m0 = HDX[q] + (HDX[q + 1] - HDX[q]) * hxf;
      var m1 = HDX[q + HW] + (HDX[q + HW + 1] - HDX[q + HW]) * hxf;
      var dx = m0 + (m1 - m0) * hyf;
      m0 = HDY[q] + (HDY[q + 1] - HDY[q]) * hxf;
      m1 = HDY[q + HW] + (HDY[q + HW + 1] - HDY[q + HW]) * hxf;
      var dy = m0 + (m1 - m0) * hyf;
      var wx = fx + dx, wy = fy + dy;
      WXA[i] = wx; WYA[i] = wy;

      // fBm + ridged, from the precomputed octaves. Every octave value is kept:
      // the landform term needs the first three and the biome intergrade needs
      // the last two, and sampling the same grids twice per pixel was waste.
      var f = 0, r = 0, o, v0 = 0, v1 = 0, v2 = 0, v3 = 0, v4 = 0;
      for (k = 0; k < 5; k++) {
        o = oct[k];
        var v = sampleGrid(o.g, o.w, o.h, x * o.sx, y * o.sy);
        if (k === 0) v0 = v; else if (k === 1) v1 = v; else if (k === 2) v2 = v;
        else if (k === 3) v3 = v; else v4 = v;
        f += v * OCT_FBM[k];
        var rr = 1 - Math.abs(v + v - 1); rr *= rr;
        r += rr * OCT_RIDGE[k];
      }
      DET[i] = f;

      /* ── biome, classified CONTINUOUSLY, then INTERGRADED ─────────────
         Part one — continuous classification. This does not read
         `bi[ty*W+tx]`, and that is deliberate. A nearest-tile lookup, however
         hard you warp the coordinate you look it up with, returns a value that
         is constant across each cell, so the boundary between two biomes is
         always the warped image of a cell edge: a staircase with one-tile
         steps. It wobbles, but you can still count the tiles along it, which
         is the stated failure condition. So the painter re-evaluates the SAME
         Voronoi over the SAME 12 cores the generator uses, at continuous
         position instead of integer tile index. No cell to cross, no
         staircase.

         Part two — and this is the part that actually kills the seam. A
         continuous Voronoi boundary is smooth, but it is still a LINE, and
         between two regions with different colour it reads as one: the cell
         boundaries of a Voronoi over gridded cores are straight, and half a
         tile of wobble on a straight line still looks straight from across
         the room. Widening the warp until the line bends is the wrong lever —
         it just paints the wrong biome a long way from where it is.

         So there is no line. The runner-up core is tracked as well as the
         winner, and within a couple of tiles of the bisector the two biomes
         are INTERLEAVED, dithered against a coherent two-octave noise: at the
         bisector it is an even mix, and it fades to pure over the band. The
         result is a mottled intergrade — a forest that thins into scrub into
         open ground — which is both what painted maps do and what real
         country does. Because the pick drives the scatter as well as the
         paint, the trees thin out with it for free.

         The average position of the transition is still the true bisector, so
         this stays honest about where a biome is; it only stops pretending
         the world has an edge there. */
      var fz = sampleGrid(fzg, FZW, FZH, fx * (FZW - 1) / W, fy * (FZH - 1) / H);
      var px0 = wx - 0.5, py0 = wy - 0.5;
      var ctx0 = fx < 0 ? 0 : (fx > W - 1 ? W - 1 : fx | 0);
      var cty0 = fy < 0 ? 0 : (fy > H - 1 ? H - 1 : fy | 0);
      var cbase = (cty0 * W + ctx0) * CAND_N;
      var bestD = Infinity, bestB = 0, secD = Infinity, secB = 0;
      for (k = 0; k < CAND_N; k++) {
        var kk2 = CAND[cbase + k];
        var ddx = CX[kk2] - px0, ddy = CY[kk2] - py0;
        var dd = (ddx * ddx + ddy * ddy) * (0.80 + CF[kk2] * fz);
        if (dd < bestD) { secD = bestD; secB = bestB; bestD = dd; bestB = CB[kk2]; }
        else if (dd < secD) { secD = dd; secB = CB[kk2]; }
      }
      if (secB !== bestB && secD < 1e8) {
        var gap = Math.sqrt(secD) - Math.sqrt(bestD);        // tiles
        var wgt = 0.5 + 0.5 * sstep(0, INTERGRADE, gap);
        var dith = v4 * 0.52 + v3 * 0.48;
        BIO[i] = dith < wgt ? bestB : secB;
      } else {
        BIO[i] = bestB;
      }

      // Coastline: the bilinear water field is already smooth (no steps), but
      // a threshold on a smooth field gives a soft rounded curve that reads as
      // a puddle of paint. A little high-frequency noise added BEFORE the
      // threshold is what makes it ragged.
      WVAL[i] = sampleTile(wet, W, H, fx + dx * WATER_WARP, fy + dy * WATER_WARP)
              + (sampleGrid(wd.g, wd.w, wd.h, fx * (wd.w - 1) / W, fy * (wd.h - 1) / H) - 0.5) * 0.13;
      var eb = sampleTile(elevT, W, H, wx, wy);
      var rg = sampleTile(roughT, W, H, wx, wy);
      // Three terms, and all three matter:
      //   eb   — where the biome sits. Dragon Mountain is up, lakes are down.
      //   land — a GLOBAL rolling landform that ignores biome entirely. Without
      //          it the Open Steppe is a billiard table, because a low-rough
      //          biome multiplies all its detail away. Real flat country still
      //          has a horizon that goes up and down.
      //   rg*… — the biome's own ruggedness, ridged for arêtes plus fBm for
      //          the shoulders underneath them.
      var land = (v0 - 0.5) * 0.44 + (v1 - 0.5) * 0.26 + (v2 - 0.5) * 0.13;
      /* ⚠ How much of the detail is RIDGED is a function of ruggedness, not a
         constant. Ridged noise makes arêtes, and an arête is the right shape
         for Dragon Mountain and precisely the wrong shape for the Open
         Steppe — applied uniformly it laid a net of filaments over the whole
         map and the world came out looking like crumpled foil. Rugged ground
         gets mostly ridge; gentle ground gets mostly smooth fBm swells. */
      var ridgeMix = 0.15 + 0.58 * rg;
      ELEV[i] = eb + land + rg * (ridgeMix * r + (1 - ridgeMix) * f - 0.46) * 1.30;
      RGA[i] = (rg * 200) | 0;

      TR[i] = sampleTile(toneR, W, H, wx, wy);
      TG[i] = sampleTile(toneG, W, H, wx, wy);
      TB[i] = sampleTile(toneB, W, H, wx, wy);
    }
  }
  var tFields = now();

  // ── 4. Rivers ───────────────────────────────────────────────────────────
  // The generator has no rivers; it has lakes. A campaign map without running
  // water looks like a diagram, so streams are painted here — and they are
  // painted the honest way: a source is dropped on high ground and then walks
  // DOWNHILL through the height field built above, so it necessarily bends
  // around the mountains it flows off and pools into the lakes the generator
  // actually placed. They are deliberately narrow (a fifth of a tile), because
  // they are decoration: no rule in the mode knows they exist and nothing is
  // impassable because of one.
  carveRivers(seed, ELEV, WVAL, BW, BH, PX, W, H);

  // ── 5. Cast shadow ──────────────────────────────────────────────────────
  var llen = Math.sqrt(LX * LX + LY * LY + LZ * LZ);
  var lx = LX / llen, ly = LY / llen, lz = LZ / llen;
  var SHADOW = new Float32Array(N);
  {
    var hl = Math.sqrt(lx * lx + ly * ly);
    var sxs = (lx / hl) * SHADOW_STRIDE, sys = (ly / hl) * SHADOW_STRIDE;
    // Height in elevation units per bake pixel. Tuned so an 0.8-elevation peak
    // throws a shadow a little over a tile and a half.
    var rise = SUN_TAN / (PX * 1.18);
    for (y = 0; y < BH; y++) for (x = 0; x < BW; x++) {
      i = y * BW + x;
      var e0 = ELEV[i], occ = 0;
      for (k = 1; k <= SHADOW_STEPS; k++) {
        var qx = (x + sxs * k) | 0, qy = (y + sys * k) | 0;
        if (qx < 0 || qy < 0 || qx >= BW || qy >= BH) break;
        var d = ELEV[qy * BW + qx] - (e0 + rise * SHADOW_STRIDE * k);
        if (d > occ) occ = d;
      }
      SHADOW[i] = occ > 0 ? (occ > 0.13 ? 1 : occ * 7.7) : 0;
    }
    blurTiles(SHADOW, BW, BH, 1);   // soft-edged shadows, not stencil cuts
  }
  var tShadow = now();

  // ── 6. The shading pass ─────────────────────────────────────────────────
  var img = ctx.createImageData(BW, BH);
  var d8 = img.data;
  var LIGHT = new Uint8Array(N);       // kept for the object pass
  /* ── The hillshade is TWO-SCALE, and it has to be ────────────────────────
     A single central difference over one pixel cannot light both a mountain
     and a meadow. Broad landforms are, by definition, gentle: a hill 0.4 units
     high spread over 200 pixels has a per-pixel gradient of 0.002, which after
     normalisation is a surface indistinguishable from flat. Crank the
     multiplier until that hill shows and the fine octaves become sandpaper.

     So the normal is built from two gradients: a MACRO one measured across
     ±0.4 of a tile, which is what makes open ground undulate and what gives a
     massif its overall lit and shadowed flanks, and a MICRO one measured
     across one pixel, which is the rock and grass texture. They are summed
     before normalising, so a slope carries both. This is the difference
     between the Open Steppe reading as a table and reading as country. */
  var DM = Math.max(2, (PX * 0.40) | 0);
  var RELIEF_MACRO = 11.0, RELIEF_MICRO = 16 / (PX / 28);
  var WTHR = 0.42;
  var hashf = M.wpHash32;
  var o3 = oct[3], o4g = oct[4];

  for (y = 0; y < BH; y++) {
    for (x = 0; x < BW; x++) {
      i = y * BW + x;
      var e = ELEV[i];

      // surface normal from two central differences, wide and narrow
      var el = ELEV[x > 0 ? i - 1 : i], er = ELEV[x < BW - 1 ? i + 1 : i];
      var eu = ELEV[y > 0 ? i - BW : i], ed = ELEV[y < BH - 1 ? i + BW : i];
      var eL = ELEV[x > DM ? i - DM : i], eR = ELEV[x < BW - 1 - DM ? i + DM : i];
      var eU = ELEV[y > DM ? i - DM * BW : i], eD = ELEV[y < BH - 1 - DM ? i + DM * BW : i];
      var gx = (eR - eL) * RELIEF_MACRO + (er - el) * RELIEF_MICRO;
      var gy = (eD - eU) * RELIEF_MACRO + (ed - eu) * RELIEF_MICRO;
      var nl = 1 / Math.sqrt(gx * gx + gy * gy + 1);
      var lam = (-gx * lx - gy * ly + lz) * nl;
      var slope = Math.sqrt(gx * gx + gy * gy);

      /* ── curvature ────────────────────────────────────────────────────
         The Laplacian of the height field: positive in a hollow, negative on
         a spine. Cartographic relief has done this for a century because a
         pure lambertian hillshade cannot show you a valley that runs toward
         the light — it comes out the same tone as the flat beside it.
         Darkening hollows and catching ridge lines is what makes drainage
         legible, and drainage is most of what makes open country look like
         country instead of like a gradient. */
      var curv = ((eL + eR + eU + eD) * 0.25 - e) * (RELIEF_MACRO * 2.1);
      if (curv > 0.5) curv = 0.5; else if (curv < -0.5) curv = -0.5;

      var sh = 0.26 + 0.92 * lam;
      /* ⚠ CONTRAST FOLLOWS SLOPE, and without this the map has diagonal
         banding across every open plain. The tonal ramp from `deep` to `lit`
         spans a luminance ratio of about 2.5, so on gentle ground a swell of
         a few percent grade still swings the colour a long way, and a smooth
         landform noise lit from 45° turns into alternating light and dark
         bands that read as folds in cloth. Flat ground therefore gets its
         contrast compressed toward the mid-tone and only real slopes get the
         full range — which is also just true of how ground looks. */
      var cf = 0.42 + 0.58 * clamp(slope * 1.35, 0, 1);
      sh = 0.5 + (sh - 0.5) * cf - curv * 0.34;
      if (sh < 0) sh = 0;
      sh *= (1 - 0.42 * SHADOW[i]);              // the cast shadow
      if (sh > 1.22) sh = 1.22;
      LIGHT[i] = clamp(sh * 200, 0, 255) | 0;

      var bidx = BIO[i], nm = BORDER[bidx], pv = PALV[nm];
      var det = DET[i];
      var wv = WVAL[i];

      var cr, cg, cb;

      if (wv > WTHR) {
        // ── water ──────────────────────────────────────────────────────
        var dep = sstep(WTHR, 0.88, wv);
        var bedR = TR[i] * 0.62, bedG = TG[i] * 0.66, bedB = TB[i] * 0.60;
        var sc = WATERV.shore, mc = WATERV.mid, dc = WATERV.deep;
        // shallows let the drowned ground show through
        var s0r = mix(bedR, sc[0], 0.58), s0g = mix(bedG, sc[1], 0.58), s0b = mix(bedB, sc[2], 0.58);
        var t1 = sstep(0, 0.45, dep), t2 = sstep(0.35, 1, dep);
        cr = mix(mix(s0r, mc[0], t1), dc[0], t2);
        cg = mix(mix(s0g, mc[1], t1), dc[1], t2);
        cb = mix(mix(s0b, mc[2], t1), dc[2], t2);
        // ripples: anisotropic high-frequency noise, brighter toward the sun
        var rip = sampleGrid(o4g.g, o4g.w, o4g.h, x * o4g.sx * 0.7, y * o4g.sy * 2.3);
        var rip2 = sampleGrid(o3.g, o3.w, o3.h, x * o3.sx * 1.1, y * o3.sy * 2.0);
        var sheen = clamp((rip * 0.6 + rip2 * 0.4 - 0.56) * 2.2, 0, 1) * (0.14 + 0.30 * dep);
        var shc = WATERV.sheen;
        cr = mix(cr, shc[0], sheen); cg = mix(cg, shc[1], sheen); cb = mix(cb, shc[2], sheen);
        // foam at the waterline — a soft band, wobbled by the same noise so it
        // is never a clean offset curve
        var fm = (1 - Math.abs(wv - (WTHR + 0.028)) / 0.042);
        if (fm > 0) {
          fm = clamp(fm, 0, 1) * (0.10 + 0.90 * rip * rip);
          var fc = WATERV.foam;
          cr = mix(cr, fc[0], fm * 0.42); cg = mix(cg, fc[1], fm * 0.42); cb = mix(cb, fc[2], fm * 0.42);
        }
      } else {
        // ── land ───────────────────────────────────────────────────────
        var dp = pv.deep, bs = pv.base, lt = pv.lit;
        // Half the warped-nearest biome tone, half the blurred tone field. The
        // nearest lookup keeps a forest reading as forest right up to its edge;
        // the blurred field stops that edge being a knife.
        var br = mix(bs[0], TR[i], 0.40), bg2 = mix(bs[1], TG[i], 0.40), bb = mix(bs[2], TB[i], 0.40);
        var t = sh > 1 ? 1 : sh;
        if (t < 0.5) { var u2 = t * 2; cr = mix(dp[0], br, u2); cg = mix(dp[1], bg2, u2); cb = mix(dp[2], bb, u2); }
        else { var u3 = (t - 0.5) * 2; cr = mix(br, lt[0], u3); cg = mix(bg2, lt[1], u3); cb = mix(bb, lt[2], u3); }
        if (sh > 1) { var ov = (sh - 1) * 0.7; cr = mix(cr, 255, ov); cg = mix(cg, 255, ov); cb = mix(cb, 255, ov); }

        /* ── HIGH GROUND IS ROCK, WHATEVER BIOME IT IS ───────────────────
           The one change that stops Dragon Mountain looking like a brown
           sticker. Biome colour switches at the Voronoi boundary, which is a
           curve in the wrong place: a mountain does not end where the
           cartographer's region ends, it ends where the ground comes back
           down. So above a threshold the palette is blended toward bare rock
           and scree as a function of ELEVATION, and the mountain's visible
           edge becomes the contour of its own foothills — which also means a
           high shoulder of the steppe next door goes rocky too, exactly as it
           should. */
        var rock = sstep(0.60, 1.00, e) * sstep(0.30, 0.66, RGA[i] / 200);
        if (rock > 0.01) {
          var rk = sh > 0.62 ? 1 : 0;
          var rr2 = rk ? 168 : 82, rg2 = rk ? 146 : 68, rb2 = rk ? 122 : 60;
          cr = mix(cr, rr2, rock * 0.72); cg = mix(cg, rg2, rock * 0.72); cb = mix(cb, rb2, rock * 0.72);
        }

        // ── per-biome texture ───────────────────────────────────────────
        // The bar: each biome must be identifiable with the colour removed.
        // These are all luminance moves, so they survive a greyscale test.
        var fine = sampleGrid(o4g.g, o4g.w, o4g.h, x * o4g.sx, y * o4g.sy);
        var mid = sampleGrid(o3.g, o3.w, o3.h, x * o3.sx, y * o3.sy);

        if (nm === 'mountain') {
          // exposed strata following the contours of the height field, which
          // is why they wrap around the ridges instead of striping the screen
          var band = e * 19 + det * 2.6;
          var sfr = band - Math.floor(band);
          var strata = 0.92 + 0.18 * sstep(0.12, 0.55, sfr) - 0.11 * sstep(0.62, 0.95, sfr);
          cr *= strata; cg *= strata * 0.99; cb *= strata * 0.975;
          // ember light in the crevices: low-lying, steep-sided, thresholded
          var crk = 1 - Math.abs(mid + mid - 1);
          var glow = sstep(0.88, 1.0, crk) * sstep(0.26, 0.02, e - 0.52) * (0.55 + 0.45 * fine);
          if (glow > 0) { cr = mix(cr, 255, glow * 0.42); cg = mix(cg, 116, glow * 0.32); cb = mix(cb, 38, glow * 0.24); }
        } else if (nm === 'wastes') {
          // wind-scoured: anisotropic streaks plus a dry-mud crack network
          var st = sampleGrid(o4g.g, o4g.w, o4g.h, x * o4g.sx * 0.30, y * o4g.sy * 2.8);
          var sm = 0.95 + 0.10 * st;
          var crack = 1 - Math.abs(fine + fine - 1);
          crack = sstep(0.93, 1.0, crack);
          cr *= sm; cg *= sm; cb *= sm;
          cr = mix(cr, 66, crack * 0.26); cg = mix(cg, 56, crack * 0.26); cb = mix(cb, 44, crack * 0.26);
        } else if (nm === 'facility') {
          // hard geometry, rotated ~13° so its seams can never line up with a
          // tile boundary and re-introduce the grid we just spent a page killing
          var ux = WXA[i] * 0.974 - WYA[i] * 0.225, uy = WXA[i] * 0.225 + WYA[i] * 0.974;
          var CL = 0.58;
          var cu = Math.floor(ux / CL), cvv = Math.floor(uy / CL);
          var fu = ux / CL - cu, fv = uy / CL - cvv;
          var seam = Math.min(Math.min(fu, 1 - fu), Math.min(fv, 1 - fv));
          var ph = hashf(seed, (cu + 256) & 1023, (cvv + 256) & 1023, R_DET + 9);
          var pvv = 0.94 + ((ph >>> 8) & 255) / 255 * 0.14;
          cr *= pvv; cg *= pvv; cb *= pvv;
          if (seam < 0.055) { var sd = 1 - seam / 0.055; cr = mix(cr, 22, sd * 0.50); cg = mix(cg, 30, sd * 0.50); cb = mix(cb, 36, sd * 0.50); }
          // conduit runs — cold light, every few cells, and DIM. The first pass
          // lit these like a nightclub and the region read as neon spatter
          // rather than as buried machinery.
          if (((cu * 7 + cvv * 3) & 7) === 0 && Math.abs(fv - 0.5) < 0.05) {
            var gl2 = 1 - Math.abs(fv - 0.5) / 0.05;
            cr = mix(cr, 118, gl2 * 0.24); cg = mix(cg, 196, gl2 * 0.30); cb = mix(cb, 214, gl2 * 0.32);
          }
        } else if (nm === 'graveyard') {
          // cold, drained ground: pull saturation toward the luminance and
          // blotch it with damp patches
          var lum = cr * 0.30 + cg * 0.59 + cb * 0.11;
          var des = 0.40 + 0.22 * mid;
          cr = mix(cr, lum, des); cg = mix(cg, lum, des); cb = mix(cb, lum * 1.05, des);
          var blot = sstep(0.55, 0.95, fine * 0.6 + mid * 0.4);
          cr = mix(cr, 52, blot * 0.26); cg = mix(cg, 50, blot * 0.26); cb = mix(cb, 58, blot * 0.26);
        } else if (nm === 'forest') {
          // the floor. The canopy is objects, not pixels — all this does is
          // put dappled shade under where the trees are about to go
          var dap = 0.86 + 0.22 * (fine * 0.55 + mid * 0.45);
          cr *= dap; cg *= dap * 1.01; cb *= dap * 0.96;
        } else {
          // plains: broad patchwork of grass and dry ground
          var patch = 0.92 + 0.16 * mid;
          cr *= patch; cg *= patch; cb *= patch * 0.97;
          // grazing: broad dry-gold patches against green, at landform scale
          var dry = sstep(0.46, 0.82, det);
          cr = mix(cr, 176, dry * 0.20); cg = mix(cg, 164, dry * 0.20); cb = mix(cb, 112, dry * 0.20);
          var green = sstep(0.62, 0.30, det);
          cr = mix(cr, 84, green * 0.18); cg = mix(cg, 106, green * 0.18); cb = mix(cb, 62, green * 0.18);
        }

        // ── snow ────────────────────────────────────────────────────────
        // Accumulates by altitude, but NOT on the steepest faces — snow slides
        // off a cliff, and leaving it on makes a mountain look like a cake.
        /* ── snow ────────────────────────────────────────────────────────
           Snow is an ACCUMULATION, not a colour applied to high tiles. Three
           things decide whether it is here, and all three have to be in:
             • altitude, with a long feathered lower edge (0.28 wide) and a
               snowline that itself wanders with the terrain noise, so the
               treeline is a ragged contour rather than a level set;
             • slope — it slides off anything steep, so the lit rock faces
               stay rock and the snow gathers in the flats and the crevices,
               which is the thing that makes a peak read as a peak;
             • a mottling noise, because a real snowfield is patchy at its
               margins and continuous only at the top.
           Getting this wrong is what produced the "field of white tents" in
           the first pass: uniform white applied to everything above a hard
           threshold, plus a white cap stamped on every scattered crag. */
        var snowline = 0.86 + 0.22 * det + 0.10 * mid;
        var snowAmt = sstep(snowline, snowline + 0.28, e)
                    * clamp(1 - slope * 0.42, 0.0, 1)
                    * clamp(0.35 + 1.0 * fine, 0, 1);
        if (snowAmt > 0.02) {
          var sn = sh > 0.70 ? SNOWV.lit : SNOWV.deep;
          var sa = snowAmt * 0.88;
          cr = mix(cr, sn[0], sa); cg = mix(cg, sn[1], sa); cb = mix(cb, sn[2], sa);
        }

        // damp sand where the land meets water
        if (wv > WTHR - 0.13) {
          var damp = sstep(WTHR - 0.13, WTHR, wv);
          cr = mix(cr, 150, damp * 0.26); cg = mix(cg, 136, damp * 0.26); cb = mix(cb, 108, damp * 0.26);
        }
      }

      // ── grade + grain ─────────────────────────────────────────────────
      // Warm the lights, cool the darks, then pull everything a few percent
      // toward a single parchment note. Two lines of arithmetic that do an
      // enormous amount of work: they are the difference between a palette and
      // a painting, and they are what makes six biomes look like one map.
      var lum2 = (cr * 0.30 + cg * 0.59 + cb * 0.11) / 255;
      var warm = (lum2 - 0.46);
      cr += warm * 20; cg += warm * 7; cb -= warm * 15;
      cr = mix(cr, 214, 0.045); cg = mix(cg, 196, 0.045); cb = mix(cb, 158, 0.045);
      // paper grain, hashed so it is identical on every machine
      var gr = ((hashf(seed, x, y, R_GRAIN) >>> 12) & 255) / 255 - 0.5;
      cr += gr * 7.0; cg += gr * 7.0; cb += gr * 7.0;

      var o4 = i << 2;
      d8[o4] = cr < 0 ? 0 : (cr > 255 ? 255 : cr);
      d8[o4 + 1] = cg < 0 ? 0 : (cg > 255 ? 255 : cg);
      d8[o4 + 2] = cb < 0 ? 0 : (cb > 255 ? 255 : cb);
      d8[o4 + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  var tShade = now();

  /* A cheap statistical fingerprint of the height field and the lighting.
     Not decoration: while tuning this file it was repeatedly unclear whether a
     change to the relief had actually altered anything or whether the picture
     merely looked the same, and eyeballing a 1.2-megapixel PNG is a bad way to
     answer that. These four numbers answer it in one line. */
  var dbg = { eMin: 1e9, eMax: -1e9, lMean: 0, lMin: 255, lMax: 0, bio: [0, 0, 0, 0, 0, 0] };
  for (i = 0; i < N; i += 7) {
    var ev = ELEV[i]; if (ev < dbg.eMin) dbg.eMin = ev; if (ev > dbg.eMax) dbg.eMax = ev;
    var lv = LIGHT[i]; dbg.lMean += lv; if (lv < dbg.lMin) dbg.lMin = lv; if (lv > dbg.lMax) dbg.lMax = lv;
    dbg.bio[BIO[i]]++;
  }
  dbg.lMean = Math.round(dbg.lMean / Math.ceil(N / 7));
  dbg.eMin = round2(dbg.eMin); dbg.eMax = round2(dbg.eMax);

  // ── 7. Everything that is drawn rather than computed ────────────────────
  var ART = {
    ctx: ctx, seed: seed, PX: PX, BW: BW, BH: BH, W: W, H: H,
    ELEV: ELEV, WVAL: WVAL, LIGHT: LIGHT, BIO: BIO, WXA: WXA, WYA: WYA,
    WTHR: WTHR, world: world,
  };
  drawRoads(ART);
  var objs = scatterObjects(ART);
  addNodeDeposits(ART, objs);
  addStructures(ART, objs);
  objs.sort(function (a, c) { return a.y - c.y; });
  for (i = 0; i < objs.length; i++) objs[i].f();
  var tObjects = now();

  drawRegionLabels(ART);
  finishEdges(ART);
  var t1 = now();

  return {
    canvas: cv, ctx: ctx, seed: seed, px: PX, w: BW, h: BH,
    world: world,
    cloud: bakeCloud(seed, W, H),
    memory: bakeMemory(cv, BW, BH),
    debug: dbg,
    timing: {
      total: round2(t1 - t0), fields: round2(tFields - t0),
      shadow: round2(tShadow - tFields), shading: round2(tShade - tShadow),
      objects: round2(tObjects - tShade), finish: round2(t1 - tObjects),
      pixels: BW * BH,
    },
  };
}

function round2(v) { return Math.round(v * 100) / 100; }
function now() {
  return (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
}

/* ── Rivers ───────────────────────────────────────────────────────────────
   Sources are the highest ground the height field offers, spread out so two
   rivers do not start on the same shoulder. From there it is plain gradient
   descent with a noise meander added perpendicular to travel — the meander is
   what stops them looking like a drainage simulation and starts them looking
   drawn. They terminate in a lake, at the map edge, or in a local minimum
   (which becomes a tarn, which is fine).                                     */
function carveRivers(seed, ELEV, WVAL, BW, BH, PX, W, H) {
  var M = mapgen();
  var cand = [], x, y, i;
  var step = Math.max(2, (PX / 2) | 0);
  for (y = PX; y < BH - PX; y += step) for (x = PX; x < BW - PX; x += step) {
    i = y * BW + x;
    if (WVAL[i] > 0.42) continue;
    if (ELEV[i] > 0.68) cand.push([x, y, ELEV[i]]);
  }
  cand.sort(function (a, b) { return b[2] - a[2]; });
  var picked = [], j;
  for (i = 0; i < cand.length && picked.length < 9; i++) {
    var ok = true;
    for (j = 0; j < picked.length; j++) {
      var ddx = cand[i][0] - picked[j][0], ddy = cand[i][1] - picked[j][1];
      if (ddx * ddx + ddy * ddy < (PX * 5) * (PX * 5)) { ok = false; break; }
    }
    if (ok) picked.push(cand[i]);
  }
  var wj = new Float32Array(BW * BH);   // river field, merged into WVAL after
  for (j = 0; j < picked.length; j++) {
    var cx = picked[j][0], cy = picked[j][1];
    var wid = PX * 0.055, life = 0;
    var r = rng(M.wpHash32(seed, j + 1, 7, R_RIVER));
    var ang = r() * Math.PI * 2;
    for (var s = 0; s < 900; s++) {
      var idx = (cy | 0) * BW + (cx | 0);
      if (cx < 1 || cy < 1 || cx >= BW - 1 || cy >= BH - 1) break;
      if (WVAL[idx] > 0.44) break;                      // reached a lake
      // steepest descent over a small ring
      var bestA = 0, bestE = 1e9, found = false;
      for (var a = 0; a < 12; a++) {
        var th = a * Math.PI / 6;
        var qx = (cx + Math.cos(th) * 3.2) | 0, qy = (cy + Math.sin(th) * 3.2) | 0;
        if (qx < 0 || qy < 0 || qx >= BW || qy >= BH) continue;
        var ee = ELEV[qy * BW + qx];
        if (ee < bestE) { bestE = ee; bestA = th; found = true; }
      }
      if (!found || bestE >= ELEV[idx] + 0.0005) break;  // local minimum
      // meander: blend toward the downhill direction, never snap to it
      var dth = Math.atan2(Math.sin(bestA - ang), Math.cos(bestA - ang));
      ang += dth * 0.34 + (r() - 0.5) * 0.42;
      cx += Math.cos(ang) * 2.0; cy += Math.sin(ang) * 2.0;
      life++;
      wid = Math.min(PX * 0.20, wid + PX * 0.00055);
      // stamp
      var rad = Math.ceil(wid) + 1;
      for (var oy = -rad; oy <= rad; oy++) for (var ox = -rad; ox <= rad; ox++) {
        var px2 = (cx + ox) | 0, py2 = (cy + oy) | 0;
        if (px2 < 0 || py2 < 0 || px2 >= BW || py2 >= BH) continue;
        var dd = Math.sqrt(ox * ox + oy * oy);
        var v = 1 - dd / (wid + 1.6);
        if (v <= 0) continue;
        var k2 = py2 * BW + px2;
        var val = 0.44 + v * 0.30;
        if (val > wj[k2]) wj[k2] = val;
      }
    }
    if (life < 12) continue;
  }
  for (i = 0; i < BW * BH; i++) {
    if (wj[i] > WVAL[i]) { WVAL[i] = wj[i]; ELEV[i] -= 0.02 * (wj[i] - 0.44) / 0.30; }
  }
}

/* ── Roads ────────────────────────────────────────────────────────────────
   The lattice — `y%6===3` and `x%7===4` — is real, load-bearing world data:
   it is the guaranteed-connected land network every structure is snapped onto
   and the ground a hero moves across at cost 1. Drawing it is therefore
   honest, and a campaign map with a road network on it looks far more like a
   place than one without.

   ⚠ It is also, geometrically, a GRID, which is the exact thing this file
   exists to hide. So it is drawn as an old road rather than a ruled line: the
   centreline wanders by up to a third of a tile, the width breathes, it fades
   out over rough ground, and it stops dead at water. At the opacity used it
   reads as a trace of traffic, not as a coordinate system.                  */
function drawRoads(A) {
  var M = mapgen(), c = A.ctx, PX = A.PX;
  c.save();
  c.lineCap = 'round';
  var lines = [], i, k;
  for (i = 3; i < A.H; i += 6) lines.push({ horiz: true, at: i });
  for (i = 4; i < A.W; i += 7) lines.push({ horiz: false, at: i });
  for (i = 0; i < lines.length; i++) {
    var L = lines[i];
    var len = (L.horiz ? A.W : A.H) * PX;
    var pts = [], t;
    var r = rng(M.wpHash32(A.seed, L.at + 1, L.horiz ? 1 : 2, R_ROAD));
    var ph1 = r() * 6.3, ph2 = r() * 6.3;
    for (t = 0; t <= len; t += PX * 0.34) {
      var wob = Math.sin(t / (PX * 4.9) + ph1) * PX * 0.52 + Math.sin(t / (PX * 1.73) + ph2) * PX * 0.20;
      var ax = L.horiz ? t : (L.at + 0.5) * PX + wob;
      var ay = L.horiz ? (L.at + 0.5) * PX + wob : t;
      pts.push([ax, ay]);
    }
    // Split into runs that stay on dry, walkable-looking ground.
    var run = [];
    for (k = 0; k < pts.length; k++) {
      var px2 = clamp(pts[k][0] | 0, 0, A.BW - 1), py2 = clamp(pts[k][1] | 0, 0, A.BH - 1);
      var idx = py2 * A.BW + px2;
      var dry = A.WVAL[idx] < A.WTHR - 0.02;
      if (dry) run.push(pts[k]);
      else { strokeRoad(c, run, PX); run = []; }
    }
    strokeRoad(c, run, PX);
  }
  c.restore();
}
function strokeRoad(c, pts, PX) {
  if (pts.length < 3) return;
  var k;
  c.beginPath();
  c.moveTo(pts[0][0], pts[0][1]);
  for (k = 1; k < pts.length - 1; k++) {
    var mx = (pts[k][0] + pts[k + 1][0]) / 2, my = (pts[k][1] + pts[k + 1][1]) / 2;
    c.quadraticCurveTo(pts[k][0], pts[k][1], mx, my);
  }
  // A dark trench under the track, then the dust on top. Faint on purpose:
  // the lattice IS a 6x7 grid, and the louder this is drawn the more the map
  // hands the player a coordinate system. At this opacity it reads as worn
  // ground you notice after a moment, which is what an old road looks like.
  c.strokeStyle = 'rgba(38,28,18,0.13)'; c.lineWidth = PX * 0.19; c.stroke();
  c.strokeStyle = 'rgba(200,180,140,0.13)'; c.lineWidth = PX * 0.10; c.stroke();
  c.strokeStyle = 'rgba(228,212,176,0.07)'; c.lineWidth = PX * 0.045; c.stroke();
}

/* ── Object scatter ───────────────────────────────────────────────────────
   The part that makes a biome a texture instead of a colour.

   Objects are placed in CONTINUOUS space — a tile proposes candidates at
   hashed sub-tile positions, and each candidate then asks what biome is at ITS
   OWN warped position. A tree spawned by a forest tile whose position happens
   to fall on the warped side of the boundary is simply not drawn. That is why
   a forest edge here is a thinning-out rather than a fence, and why you cannot
   find the tile boundaries by looking at where the trees stop.

   Everything is depth-sorted by y before drawing so canopies overlap the way
   they would if this were a painting, and everything carries a contact shadow
   offset toward the lower-right — the same sun as the hillshade.             */
var SCAT_TRY = 13;
var DENSITY = { plains: 0.26, forest: 0.90, graveyard: 0.40, facility: 0.30, mountain: 0.30, wastes: 0.22 };

function scatterObjects(A) {
  var M = mapgen(), out = [];
  var tx, ty, k;
  var clump = { g: noiseGrid(A.seed, R_CLUMP, 29, 21), w: 29, h: 21 };
  for (ty = -1; ty <= A.H; ty++) {
    for (tx = -1; tx <= A.W; tx++) {
      for (k = 0; k < SCAT_TRY; k++) {
        var h = M.wpHash32(A.seed, tx + 64, ty + 64, R_SCAT + k * 3);
        var fx = tx + (h & 1023) / 1024;
        var fy = ty + ((h >>> 10) & 1023) / 1024;
        if (fx < -0.4 || fy < -0.4 || fx > A.W + 0.4 || fy > A.H + 0.4) continue;
        var bx = clamp((fx * A.PX) | 0, 0, A.BW - 1), by = clamp((fy * A.PX) | 0, 0, A.BH - 1);
        var i = by * A.BW + bx;
        if (A.WVAL[i] > A.WTHR - 0.03) continue;                 // not in the water
        var nm = BORDER[A.BIO[i]];
        var cl = sampleGrid(clump.g, clump.w, clump.h, fx / A.W * (clump.w - 1), fy / A.H * (clump.h - 1));
        var acc = ((h >>> 20) & 1023) / 1024;
        if (acc > DENSITY[nm] * (0.42 + 1.25 * cl)) continue;
        var e = A.ELEV[i], lit = A.LIGHT[i] / 200;
        var r = rng(h ^ 0x5bf03635);
        var o = makeObject(A, nm, fx, fy, e, lit, r);
        if (o) out.push(o);
      }
    }
  }
  return out;
}

function makeObject(A, nm, fx, fy, e, lit, r) {
  var c = A.ctx, PX = A.PX;
  var px = fx * PX, py = fy * PX;
  if (nm === 'forest') {
    var conifer = e > 0.42 || r() < 0.42;
    var s = PX * (0.30 + r() * 0.24) * (conifer ? 1.12 : 1.0);
    return { y: fy, f: function () { conifer ? drawConifer(c, px, py, s, lit, r) : drawBroadleaf(c, px, py, s, lit, r); } };
  }
  if (nm === 'mountain') {
    // Crags follow the height field: big broken teeth on the high ground,
    // rubble on the skirts. Scattering one uniform crag everywhere — which is
    // what the first pass did — turns a massif into a hedgehog.
    var t = r(), hi = clamp((e - 0.72) / 0.50, 0, 1);
    if (t < 0.10 + 0.62 * hi) { var s2 = PX * (0.16 + r() * 0.26 + hi * 0.52); return { y: fy, f: function () { drawCrag(c, px, py, s2, lit, e, r); } }; }
    if (t < 0.88) { var s3 = PX * (0.08 + r() * 0.13); return { y: fy, f: function () { drawBoulder(c, px, py, s3, lit, r); } }; }
    var s4 = PX * (0.18 + r() * 0.14); return { y: fy, f: function () { drawDeadTree(c, px, py, s4, lit, r, '#3a2c22'); } };
  }
  if (nm === 'graveyard') {
    var t2 = r();
    if (t2 < 0.52) { var s5 = PX * (0.16 + r() * 0.12); return { y: fy, f: function () { drawHeadstone(c, px, py, s5, lit, r); } }; }
    if (t2 < 0.76) { var s6 = PX * (0.24 + r() * 0.18); return { y: fy, f: function () { drawDeadTree(c, px, py, s6, lit, r, '#2b2733'); } }; }
    if (t2 < 0.90) { var s7 = PX * (0.13 + r() * 0.10); return { y: fy, f: function () { drawBoulder(c, px, py, s7, lit * 0.8, r); } }; }
    var s8 = PX * (0.10 + r() * 0.06); return { y: fy, f: function () { drawWisp(c, px, py, s8, r); } };
  }
  if (nm === 'facility') {
    var t3 = r();
    if (t3 < 0.44) { var s9 = PX * (0.20 + r() * 0.20); return { y: fy, f: function () { drawPanelBlock(c, px, py, s9, lit, r); } }; }
    if (t3 < 0.66) { var sa = PX * (0.26 + r() * 0.22); return { y: fy, f: function () { drawPylon(c, px, py, sa, lit, r); } }; }
    if (t3 < 0.84) { var sb = PX * (0.14 + r() * 0.10); return { y: fy, f: function () { drawConduit(c, px, py, sb, r); } }; }
    var sc2 = PX * (0.12 + r() * 0.09); return { y: fy, f: function () { drawBoulder(c, px, py, sc2, lit * 0.85, r); } };
  }
  if (nm === 'wastes') {
    var t4 = r();
    if (t4 < 0.44) { var sd = PX * (0.11 + r() * 0.14); return { y: fy, f: function () { drawShard(c, px, py, sd, lit, r); } }; }
    if (t4 < 0.72) { var se = PX * (0.10 + r() * 0.08); return { y: fy, f: function () { drawScrub(c, px, py, se, lit, r, '#6e6144'); } }; }
    if (t4 < 0.88) { var sf = PX * (0.18 + r() * 0.14); return { y: fy, f: function () { drawDeadTree(c, px, py, sf, lit, r, '#4a3f2c'); } }; }
    var sg = PX * (0.11 + r() * 0.07); return { y: fy, f: function () { drawBones(c, px, py, sg, r); } };
  }
  // plains
  var t5 = r();
  if (t5 < 0.62) { var sh2 = PX * (0.09 + r() * 0.09); return { y: fy, f: function () { drawTuft(c, px, py, sh2, lit, r); } }; }
  if (t5 < 0.86) { var si = PX * (0.10 + r() * 0.10); return { y: fy, f: function () { drawScrub(c, px, py, si, lit, r, '#5f7038'); } }; }
  if (t5 < 0.96) { var sj = PX * (0.22 + r() * 0.16); return { y: fy, f: function () { drawBroadleaf(c, px, py, sj, lit, r); } }; }
  var sk = PX * (0.11 + r() * 0.08); return { y: fy, f: function () { drawBoulder(c, px, py, sk, lit, r); } };
}

// ── the object painters ───────────────────────────────────────────────────
// All of them share three habits: a soft contact shadow cast to the lower
// right, a lit face toward the upper left, and a size that varies. Those three
// things are what make a hundred hashed blobs read as a forest.

function contact(c, x, y, w, h, a) {
  c.beginPath();
  c.ellipse(x + w * 0.42, y + h * 0.30, w, h, 0, 0, Math.PI * 2);
  c.fillStyle = 'rgba(14,12,10,' + a + ')';
  c.fill();
}
function drawConifer(c, x, y, s, lit, r) {
  var tint = 0.72 + lit * 0.5;
  contact(c, x, y, s * 0.85, s * 0.34, 0.30);
  c.strokeStyle = 'rgba(40,28,18,0.85)'; c.lineWidth = Math.max(0.7, s * 0.11);
  c.beginPath(); c.moveTo(x, y); c.lineTo(x, y - s * 0.55); c.stroke();
  var tiers = 3 + (r() * 2 | 0);
  for (var i = 0; i < tiers; i++) {
    var f = i / tiers;
    var wd = s * (0.62 - f * 0.40), hh = s * (0.42 - f * 0.10);
    var cy = y - s * (0.35 + f * 0.95);
    c.beginPath();
    c.moveTo(x - wd, cy); c.lineTo(x, cy - hh); c.lineTo(x + wd, cy);
    c.closePath();
    c.fillStyle = shadeRGB(38 + r() * 12, 54 + r() * 20, 36 + r() * 12, tint);
    c.fill();
    // lit rim, upper-left
    c.beginPath(); c.moveTo(x - wd, cy); c.lineTo(x, cy - hh); c.lineTo(x - wd * 0.15, cy);
    c.closePath();
    c.fillStyle = shadeRGB(104, 118, 68, tint * 1.04); c.globalAlpha = 0.52; c.fill(); c.globalAlpha = 1;
  }
}
function drawBroadleaf(c, x, y, s, lit, r) {
  var tint = 0.70 + lit * 0.55;
  contact(c, x, y, s * 0.92, s * 0.36, 0.30);
  c.strokeStyle = 'rgba(46,32,20,0.9)'; c.lineWidth = Math.max(0.8, s * 0.13);
  c.beginPath(); c.moveTo(x, y); c.lineTo(x - s * 0.06, y - s * 0.5); c.stroke();
  var lobes = 3 + (r() * 3 | 0);
  var base = [52 + r() * 20, 74 + r() * 22, 40 + r() * 14];
  for (var i = 0; i < lobes; i++) {
    var a = (i / lobes) * Math.PI * 2 + r();
    var rr = s * (0.30 + r() * 0.18);
    var cx = x + Math.cos(a) * s * 0.24, cy = y - s * 0.78 + Math.sin(a) * s * 0.18;
    c.beginPath(); c.ellipse(cx, cy, rr, rr * 0.86, 0, 0, Math.PI * 2);
    var up = (Math.cos(a) < 0 && Math.sin(a) < 0) ? 1.30 : 0.86;
    c.fillStyle = shadeRGB(base[0], base[1], base[2], tint * up);
    c.fill();
  }
}
function drawDeadTree(c, x, y, s, lit, r, col) {
  contact(c, x, y, s * 0.6, s * 0.22, 0.26);
  c.strokeStyle = col; c.lineCap = 'round';
  c.lineWidth = Math.max(0.7, s * 0.14);
  c.beginPath(); c.moveTo(x, y); c.lineTo(x + (r() - 0.5) * s * 0.2, y - s * 1.05); c.stroke();
  c.lineWidth = Math.max(0.5, s * 0.08);
  for (var i = 0; i < 4; i++) {
    var a = -Math.PI / 2 + (r() - 0.5) * 2.1;
    var yy = y - s * (0.5 + r() * 0.5);
    c.beginPath(); c.moveTo(x, yy);
    c.lineTo(x + Math.cos(a) * s * 0.55, yy + Math.sin(a) * s * 0.55); c.stroke();
  }
}
/* A crag is NOT a triangle. The first pass drew every one as an isoceles
   wedge with a white cap and the massif came out looking like a row of tents.
   This builds a broken silhouette instead: a jagged left flank climbing to an
   off-centre summit, a shorter shoulder, and a right flank that falls away at
   a different angle, all with per-instance jitter — so no two read the same
   even when a hundred of them overlap. Snow is a thin rime on the summit
   ridge only, and only very high up; the snowFIELD is the terrain pass's job,
   which is where snow belongs. */
function drawCrag(c, x, y, s, lit, e, r) {
  contact(c, x, y, s * 1.15, s * 0.40, 0.34);
  var w = s * (0.80 + r() * 0.55), h = s * (1.3 + r() * 1.4);
  var lean = (r() - 0.5) * s * 0.8;
  var sx = x + lean;                        // summit
  var sh2 = h * (0.52 + r() * 0.26);        // shoulder height
  var shx = sx + w * (0.30 + r() * 0.45);   // shoulder x
  var pts = [
    [x - w, y],
    [x - w * (0.55 + r() * 0.3), y - h * (0.28 + r() * 0.22)],
    [sx - w * (0.16 + r() * 0.2), y - h * (0.72 + r() * 0.16)],
    [sx, y - h],
    [shx, y - sh2],
    [x + w * (0.86 + r() * 0.3), y]
  ];
  var i;
  c.beginPath(); c.moveTo(pts[0][0], pts[0][1]);
  for (i = 1; i < pts.length; i++) c.lineTo(pts[i][0], pts[i][1]);
  c.closePath();
  c.fillStyle = shadeRGB(66, 52, 44, 0.60 + lit * 0.40); c.fill();
  // the lit flank: everything left of the summit line
  c.beginPath();
  c.moveTo(pts[0][0], pts[0][1]);
  c.lineTo(pts[1][0], pts[1][1]); c.lineTo(pts[2][0], pts[2][1]); c.lineTo(pts[3][0], pts[3][1]);
  c.lineTo(sx - w * 0.10, y);
  c.closePath();
  c.fillStyle = shadeRGB(152, 128, 104, 0.70 + lit * 0.46); c.fill();
  // a crease down the face, so the rock has structure
  c.strokeStyle = 'rgba(38,28,22,0.28)'; c.lineWidth = Math.max(0.5, s * 0.06);
  c.beginPath(); c.moveTo(sx, y - h); c.lineTo(sx - w * (0.2 + r() * 0.3), y); c.stroke();
  if (e > 1.02 && r() < 0.55) {
    c.beginPath();
    c.moveTo(pts[2][0], pts[2][1]); c.lineTo(sx, y - h);
    c.lineTo(shx, y - sh2); c.lineTo(shx - w * 0.18, y - sh2 - h * 0.10);
    c.lineTo(sx - w * 0.06, y - h * 0.86);
    c.closePath();
    c.fillStyle = 'rgba(226,234,242,0.80)'; c.fill();
  }
}
function drawBoulder(c, x, y, s, lit, r) {
  contact(c, x, y, s * 1.05, s * 0.42, 0.30);
  c.beginPath(); c.ellipse(x, y - s * 0.35, s, s * 0.78, (r() - 0.5) * 0.5, 0, Math.PI * 2);
  c.fillStyle = shadeRGB(96, 88, 76, 0.60 + lit * 0.42); c.fill();
  c.beginPath(); c.ellipse(x - s * 0.24, y - s * 0.55, s * 0.55, s * 0.38, -0.5, 0, Math.PI * 2);
  c.fillStyle = shadeRGB(160, 150, 132, 0.66 + lit * 0.44); c.globalAlpha = 0.7; c.fill(); c.globalAlpha = 1;
}
function drawShard(c, x, y, s, lit, r) {
  contact(c, x, y, s * 0.9, s * 0.3, 0.26);
  var h = s * (1.1 + r() * 1.0), lean = (r() - 0.5) * s;
  c.beginPath();
  c.moveTo(x - s * 0.5, y); c.lineTo(x + lean, y - h); c.lineTo(x + s * 0.42, y); c.closePath();
  c.fillStyle = shadeRGB(112, 100, 80, 0.58 + lit * 0.4); c.fill();
  c.beginPath();
  c.moveTo(x - s * 0.5, y); c.lineTo(x + lean, y - h); c.lineTo(x + lean - s * 0.2, y); c.closePath();
  c.fillStyle = shadeRGB(178, 162, 132, 0.70 + lit * 0.42); c.fill();
}
function drawHeadstone(c, x, y, s, lit, r) {
  contact(c, x, y, s * 1.0, s * 0.36, 0.34);
  var w = s * (0.62 + r() * 0.3), h = s * (1.15 + r() * 0.7);
  var tilt = (r() - 0.5) * 0.30;
  c.save(); c.translate(x, y); c.rotate(tilt);
  c.beginPath();
  c.moveTo(-w, 0); c.lineTo(-w, -h + w); c.quadraticCurveTo(-w, -h, 0, -h);
  c.quadraticCurveTo(w, -h, w, -h + w); c.lineTo(w, 0); c.closePath();
  c.fillStyle = shadeRGB(126, 122, 132, 0.58 + lit * 0.44); c.fill();
  c.beginPath();
  c.moveTo(-w, 0); c.lineTo(-w, -h + w); c.quadraticCurveTo(-w, -h, 0, -h);
  c.lineTo(-w * 0.3, -h + w * 0.2); c.lineTo(-w * 0.3, 0); c.closePath();
  c.fillStyle = shadeRGB(176, 172, 184, 0.62 + lit * 0.46); c.globalAlpha = 0.75; c.fill(); c.globalAlpha = 1;
  c.restore();
}
function drawWisp(c, x, y, s, r) {
  var g = c.createRadialGradient(x, y - s, 0, x, y - s, s * 3.2);
  g.addColorStop(0, 'rgba(178,196,190,0.34)');
  g.addColorStop(0.4, 'rgba(130,156,160,0.10)');
  g.addColorStop(1, 'rgba(120,168,178,0)');
  c.fillStyle = g; c.beginPath(); c.arc(x, y - s, s * 3.2, 0, Math.PI * 2); c.fill();
}
function drawPanelBlock(c, x, y, s, lit, r) {
  contact(c, x, y, s * 1.1, s * 0.38, 0.40);
  var w = s * (0.8 + r() * 0.5), h = s * (0.55 + r() * 0.6);
  var rot = 0.226;
  c.save(); c.translate(x, y - h * 0.4); c.rotate(rot);
  c.fillStyle = shadeRGB(60, 78, 88, 0.55 + lit * 0.4);
  c.fillRect(-w, -h, w * 2, h * 2);
  c.fillStyle = shadeRGB(126, 152, 164, 0.62 + lit * 0.45);
  c.fillRect(-w, -h, w * 2, h * 0.36);
  c.strokeStyle = 'rgba(10,18,24,0.6)'; c.lineWidth = Math.max(0.6, s * 0.07);
  c.strokeRect(-w, -h, w * 2, h * 2);
  c.fillStyle = 'rgba(140,206,222,0.42)';
  c.fillRect(-w * 0.6, h * 0.45, w * 0.9, Math.max(0.7, s * 0.08));
  c.restore();
}
function drawPylon(c, x, y, s, lit, r) {
  contact(c, x, y, s * 0.7, s * 0.26, 0.36);
  var h = s * (1.4 + r() * 0.8);
  c.strokeStyle = shadeRGB(96, 118, 130, 0.55 + lit * 0.4);
  c.lineWidth = Math.max(0.9, s * 0.16); c.lineCap = 'round';
  c.beginPath(); c.moveTo(x, y); c.lineTo(x, y - h); c.stroke();
  c.strokeStyle = shadeRGB(150, 176, 188, 0.6 + lit * 0.4);
  c.lineWidth = Math.max(0.5, s * 0.07);
  c.beginPath(); c.moveTo(x - s * 0.34, y - h * 0.72); c.lineTo(x + s * 0.34, y - h * 0.72); c.stroke();
  var g = c.createRadialGradient(x, y - h, 0, x, y - h, s * 0.9);
  g.addColorStop(0, 'rgba(168,226,238,0.70)');
  g.addColorStop(0.4, 'rgba(96,170,196,0.16)');
  g.addColorStop(1, 'rgba(96,170,196,0)');
  c.fillStyle = g; c.beginPath(); c.arc(x, y - h, s * 0.9, 0, Math.PI * 2); c.fill();
}
function drawConduit(c, x, y, s, r) {
  c.save(); c.translate(x, y); c.rotate(0.226 + (r() < 0.5 ? 0 : Math.PI / 2));
  c.strokeStyle = 'rgba(28,44,52,0.62)'; c.lineWidth = Math.max(1, s * 0.42);
  c.beginPath(); c.moveTo(-s * 2.4, 0); c.lineTo(s * 2.4, 0); c.stroke();
  c.strokeStyle = 'rgba(126,196,214,0.22)'; c.lineWidth = Math.max(0.5, s * 0.13);
  c.beginPath(); c.moveTo(-s * 2.4, 0); c.lineTo(s * 2.4, 0); c.stroke();
  c.restore();
}
function drawScrub(c, x, y, s, lit, r, col) {
  contact(c, x, y, s * 0.8, s * 0.28, 0.24);
  var p = hex(col);
  for (var i = 0; i < 4; i++) {
    var a = r() * Math.PI * 2, rr = s * (0.45 + r() * 0.4);
    c.beginPath();
    c.ellipse(x + Math.cos(a) * s * 0.3, y - s * 0.35 + Math.sin(a) * s * 0.2, rr, rr * 0.8, 0, 0, Math.PI * 2);
    c.fillStyle = shadeRGB(p[0], p[1], p[2], 0.66 + lit * 0.5 + r() * 0.12);
    c.fill();
  }
}
function drawTuft(c, x, y, s, lit, r) {
  c.strokeStyle = shadeRGB(118, 132, 68, 0.62 + lit * 0.5);
  c.lineWidth = Math.max(0.55, s * 0.20); c.lineCap = 'round';
  for (var i = 0; i < 4; i++) {
    var a = -Math.PI / 2 + (r() - 0.5) * 1.5;
    c.beginPath(); c.moveTo(x + (r() - 0.5) * s, y);
    c.lineTo(x + Math.cos(a) * s * 1.5, y + Math.sin(a) * s * 1.7); c.stroke();
  }
}
function drawBones(c, x, y, s, r) {
  c.strokeStyle = 'rgba(226,218,198,0.72)'; c.lineWidth = Math.max(0.6, s * 0.22);
  c.lineCap = 'round';
  for (var i = 0; i < 3; i++) {
    var a = r() * Math.PI;
    c.beginPath();
    c.moveTo(x - Math.cos(a) * s, y - Math.sin(a) * s * 0.4);
    c.lineTo(x + Math.cos(a) * s, y + Math.sin(a) * s * 0.4); c.stroke();
  }
}
function shadeRGB(r, g, b, m) {
  return 'rgb(' + clamp(r * m, 0, 255).toFixed(0) + ',' + clamp(g * m, 0, 255).toFixed(0) + ',' + clamp(b * m, 0, 255).toFixed(0) + ')';
}

/* ── Resource deposits ────────────────────────────────────────────────────
   Baked, not drawn per frame, because a node's PRESENCE is world data and does
   not change: what changes is whether it has been claimed, and that is a small
   marker draw()s on top. A vein of ore should look like it has always been in
   that hillside, which means it has to be lit by the same pass as the hillside.

   ⚠ These are drawn under the fog. They are not a leak — draw() composites the
   fog over the whole baked canvas, so an unexplored deposit is behind cloud in
   exactly the way an unexplored mountain is.                                  */
function addNodeDeposits(A, out) {
  var M = mapgen(), w = A.world;
  for (var y = 0; y < A.H; y++) for (var x = 0; x < A.W; x++) {
    var t = w.at(x, y);
    if (!t || !t.node) continue;
    var h = M.wpHash32(A.seed, x, y, R_SCAT + 41);
    var r = rng(h);
    var fx = x + 0.30 + (h & 255) / 255 * 0.40;
    var fy = y + 0.32 + ((h >>> 8) & 255) / 255 * 0.38;
    var i = clamp((fy * A.PX) | 0, 0, A.BH - 1) * A.BW + clamp((fx * A.PX) | 0, 0, A.BW - 1);
    if (A.WVAL[i] > A.WTHR - 0.03) continue;
    var lit = A.LIGHT[i] / 200;
    (function (kind, px, py, lit, r) {
      out.push({ y: py / A.PX + 0.01, f: function () { drawDeposit(A.ctx, kind, px, py, A.PX * 0.24, lit, r); } });
    })(t.node.kind, fx * A.PX, fy * A.PX, lit, r);
  }
}
function drawDeposit(c, kind, x, y, s, lit, r) {
  var i;
  contact(c, x, y, s * 1.25, s * 0.44, 0.36);
  switch (kind) {
    case 'wood':
      for (i = 0; i < 3; i++) {
        c.beginPath(); c.ellipse(x - s * 0.5 + i * s * 0.5, y - s * 0.25 - (i === 2 ? s * 0.4 : 0), s * 0.34, s * 0.24, 0.15, 0, Math.PI * 2);
        c.fillStyle = shadeRGB(120, 84, 48, 0.6 + lit * 0.5); c.fill();
        c.beginPath(); c.ellipse(x - s * 0.5 + i * s * 0.5 - s * 0.22, y - s * 0.25 - (i === 2 ? s * 0.4 : 0), s * 0.13, s * 0.20, 0, 0, Math.PI * 2);
        c.fillStyle = shadeRGB(196, 158, 106, 0.6 + lit * 0.5); c.fill();
      } break;
    case 'stone':
      for (i = 0; i < 3; i++) drawBoulder(c, x + (i - 1) * s * 0.55, y - (i === 1 ? s * 0.28 : 0), s * 0.44, lit, r);
      break;
    case 'iron':
      c.beginPath(); c.ellipse(x, y - s * 0.4, s * 0.9, s * 0.66, 0.2, 0, Math.PI * 2);
      c.fillStyle = shadeRGB(72, 68, 66, 0.6 + lit * 0.4); c.fill();
      c.strokeStyle = shadeRGB(206, 196, 186, 0.75 + lit * 0.4); c.lineWidth = Math.max(0.8, s * 0.14);
      for (i = 0; i < 3; i++) { c.beginPath(); c.moveTo(x - s * 0.6 + i * s * 0.4, y - s * 0.1); c.lineTo(x - s * 0.25 + i * s * 0.4, y - s * 0.8); c.stroke(); }
      break;
    case 'food':
      for (i = 0; i < 4; i++) {
        var a = r() * 6.28;
        c.beginPath(); c.ellipse(x + Math.cos(a) * s * 0.4, y - s * 0.5 + Math.sin(a) * s * 0.3, s * 0.46, s * 0.4, 0, 0, Math.PI * 2);
        c.fillStyle = shadeRGB(58, 104, 48, 0.6 + lit * 0.5); c.fill();
      }
      for (i = 0; i < 5; i++) {
        c.beginPath(); c.arc(x + (r() - 0.5) * s * 1.2, y - s * 0.5 + (r() - 0.5) * s * 0.8, s * 0.12, 0, Math.PI * 2);
        c.fillStyle = 'rgba(212,58,52,0.92)'; c.fill();
      } break;
    case 'gold':
      c.beginPath(); c.ellipse(x, y - s * 0.2, s * 0.8, s * 0.4, 0, 0, Math.PI * 2);
      c.fillStyle = shadeRGB(120, 100, 68, 0.6 + lit * 0.4); c.fill();
      for (i = 0; i < 5; i++) {
        c.beginPath(); c.arc(x + (r() - 0.5) * s * 1.2, y - s * 0.28 + (r() - 0.5) * s * 0.5, s * 0.14, 0, Math.PI * 2);
        c.fillStyle = 'rgba(240,206,110,0.95)'; c.fill();
      } break;
    case 'essence': crystal(c, x, y, s, '#6a5a86', '#b7a6cf', lit, r, 2); break;
    case 'void_crystal': crystal(c, x, y, s * 1.2, '#4e3a72', '#a98ccc', lit, r, 3); break;
    case 'celestial_ore': crystal(c, x, y, s * 1.15, '#4e7392', '#bdd4e2', lit, r, 3); break;
    case 'kalon_fragment':
      drawBroadleaf(c, x, y, s * 1.6, lit, r);
      for (i = 0; i < 3; i++) {
        c.beginPath(); c.arc(x + (r() - 0.5) * s * 1.1, y - s * 1.2 + (r() - 0.5) * s * 0.8, s * 0.20, 0, Math.PI * 2);
        c.fillStyle = 'rgba(246,226,120,0.98)'; c.fill();
      }
      glow(c, x, y - s * 1.2, s * 2.0, 'rgba(246,226,120,0.20)');
      break;
    case 'ancient_bone':
      c.strokeStyle = 'rgba(230,224,206,0.9)'; c.lineWidth = Math.max(0.9, s * 0.20); c.lineCap = 'round';
      c.beginPath(); c.moveTo(x - s * 0.9, y - s * 0.1); c.lineTo(x + s * 0.9, y - s * 0.25); c.stroke();
      for (i = 0; i < 4; i++) {
        c.beginPath();
        c.moveTo(x - s * 0.6 + i * s * 0.42, y - s * 0.16);
        c.quadraticCurveTo(x - s * 0.5 + i * s * 0.42, y - s * 0.95, x - s * 0.15 + i * s * 0.42, y - s * 0.9);
        c.stroke();
      } break;
    case 'ouroboros_core':
      c.beginPath(); c.arc(x, y - s * 0.5, s * 0.72, 0, Math.PI * 2);
      c.strokeStyle = shadeRGB(160, 178, 186, 0.7 + lit * 0.4); c.lineWidth = Math.max(1, s * 0.24); c.stroke();
      c.beginPath(); c.arc(x, y - s * 0.5, s * 0.32, 0, Math.PI * 2);
      c.fillStyle = 'rgba(120,236,255,0.92)'; c.fill();
      glow(c, x, y - s * 0.5, s * 1.7, 'rgba(110,200,225,0.18)');
      break;
    case 'dragon_heart':
      c.beginPath(); c.ellipse(x, y - s * 0.3, s * 0.95, s * 0.62, 0.15, 0, Math.PI * 2);
      c.fillStyle = shadeRGB(52, 26, 20, 0.7 + lit * 0.3); c.fill();
      c.beginPath(); c.ellipse(x, y - s * 0.42, s * 0.45, s * 0.34, 0.15, 0, Math.PI * 2);
      c.fillStyle = 'rgba(255,104,44,0.95)'; c.fill();
      glow(c, x, y - s * 0.42, s * 2.0, 'rgba(255,110,40,0.24)');
      break;
    default: drawBoulder(c, x, y, s * 0.5, lit, r);
  }
}
function crystal(c, x, y, s, dark, light, lit, r, n) {
  var dp = hex(dark), lp = hex(light);
  for (var i = 0; i < n; i++) {
    var ox = (i - (n - 1) / 2) * s * 0.52, hh = s * (1.1 + r() * 0.9), ww = s * (0.24 + r() * 0.14);
    c.beginPath();
    c.moveTo(x + ox - ww, y); c.lineTo(x + ox, y - hh); c.lineTo(x + ox + ww, y); c.closePath();
    c.fillStyle = shadeRGB(dp[0], dp[1], dp[2], 0.7 + lit * 0.4); c.fill();
    c.beginPath();
    c.moveTo(x + ox - ww, y); c.lineTo(x + ox, y - hh); c.lineTo(x + ox - ww * 0.2, y); c.closePath();
    c.fillStyle = shadeRGB(lp[0], lp[1], lp[2], 0.75 + lit * 0.4); c.fill();
  }
  glow(c, x, y - s * 0.6, s * 1.9, 'rgba(' + lp[0] + ',' + lp[1] + ',' + lp[2] + ',0.15)');
}
function glow(c, x, y, r, col) {
  var g = c.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, col); g.addColorStop(1, col.replace(/,[\d.]+\)$/, ',0)'));
  c.fillStyle = g; c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.fill();
}

/* ── Structures ───────────────────────────────────────────────────────────
   The brief: "a recruitment site is a little painted encampment with tents and
   a banner"; "the rare landmark is unmistakably strange — it should stop the
   eye". None of this is emoji in a coloured square. Every structure is drawn
   with the same light as the terrain, sits ON the ground with a contact
   shadow, and is depth-sorted into the same list as the trees so a pine can
   stand in front of a tent.                                                  */
function addStructures(A, out) {
  var w = A.world, i;
  function push(x, y, fn) {
    var px = (x + 0.5) * A.PX, py = (y + 0.85) * A.PX;
    var idx = clamp(py | 0, 0, A.BH - 1) * A.BW + clamp(px | 0, 0, A.BW - 1);
    var lit = A.LIGHT[idx] / 200;
    out.push({ y: y + 0.9, f: function () { fn(A.ctx, px, py, A.PX, lit); } });
  }
  for (i = 0; i < w.gates.length; i++) {
    (function (g) { push(g.x, g.y, g.main ? drawWarpathGate : drawPortal); })(w.gates[i]);
  }
  for (i = 0; i < w.sites.length; i++) {
    (function (s) { push(s.x, s.y, function (c, x, y, PX, lit) { drawEncampment(c, x, y, PX, lit, s); }); })(w.sites[i]);
  }
  if (w.landmark) {
    (function (l) {
      push(l.x, l.y, function (c, x, y, PX, lit) {
        if (l.id === 'black_pyramid') drawPyramid(c, x, y, PX, lit);
        else if (l.id === 'the_garden') drawGarden(c, x, y, PX, lit);
        else drawChoir(c, x, y, PX, lit);
      });
    })(w.landmark);
  }
}

function drawWarpathGate(c, x, y, PX, lit) {
  var s = PX * 1.25;
  // long cast shadow, lower-right, same sun as everything else
  c.save();
  c.fillStyle = 'rgba(12,10,8,0.34)';
  c.beginPath(); c.moveTo(x - s * 0.5, y); c.lineTo(x + s * 0.5, y);
  c.lineTo(x + s * 1.7, y + s * 0.62); c.lineTo(x + s * 0.6, y + s * 0.62); c.closePath(); c.fill();
  c.restore();
  contact(c, x, y, s * 0.9, s * 0.28, 0.36);
  // the aperture glow behind the arch
  glow(c, x, y - s * 0.62, s * 1.5, 'rgba(240,196,96,0.42)');
  var w = s * 0.62, h = s * 1.15, t = s * 0.20;
  // uprights
  c.fillStyle = shadeRGB(92, 84, 72, 0.55 + lit * 0.35);
  c.fillRect(x - w, y - h, t, h);
  c.fillRect(x + w - t, y - h, t, h);
  c.fillStyle = shadeRGB(178, 166, 146, 0.62 + lit * 0.4);
  c.fillRect(x - w, y - h, t * 0.38, h);
  c.fillRect(x + w - t, y - h, t * 0.34, h);
  // lintel
  c.fillStyle = shadeRGB(104, 94, 80, 0.55 + lit * 0.35);
  c.fillRect(x - w * 1.22, y - h - t * 0.9, w * 2.44, t * 0.95);
  c.fillStyle = shadeRGB(190, 178, 156, 0.6 + lit * 0.4);
  c.fillRect(x - w * 1.22, y - h - t * 0.9, w * 2.44, t * 0.30);
  // the doorway itself
  var g = c.createLinearGradient(x, y - h, x, y);
  g.addColorStop(0, 'rgba(255,226,150,0.85)');
  g.addColorStop(1, 'rgba(196,132,44,0.35)');
  c.fillStyle = g;
  c.fillRect(x - w + t, y - h, (w - t) * 2, h);
}
function drawPortal(c, x, y, PX, lit) {
  var s = PX * 0.95;
  contact(c, x, y, s * 0.95, s * 0.30, 0.34);
  glow(c, x, y - s * 0.5, s * 1.7, 'rgba(140,100,190,0.26)');
  // a ring of leaning stones
  for (var i = 0; i < 7; i++) {
    var a = (i / 7) * Math.PI * 2 + 0.3;
    var ox = Math.cos(a) * s * 0.72, oy = Math.sin(a) * s * 0.30;
    var hh = s * (0.5 + (i % 3) * 0.16);
    c.save(); c.translate(x + ox, y + oy); c.rotate(Math.sin(a) * 0.16);
    c.fillStyle = shadeRGB(78, 72, 84, 0.5 + lit * 0.36 + (oy < 0 ? 0 : 0.1));
    c.fillRect(-s * 0.11, -hh, s * 0.22, hh);
    c.fillStyle = shadeRGB(150, 142, 158, 0.55 + lit * 0.4);
    c.fillRect(-s * 0.11, -hh, s * 0.07, hh);
    c.restore();
  }
  var g = c.createRadialGradient(x, y - s * 0.36, 0, x, y - s * 0.36, s * 0.55);
  g.addColorStop(0, 'rgba(224,208,240,0.88)');
  g.addColorStop(0.45, 'rgba(140,96,186,0.55)');
  g.addColorStop(1, 'rgba(60,32,84,0.0)');
  c.fillStyle = g; c.beginPath(); c.ellipse(x, y - s * 0.36, s * 0.55, s * 0.42, 0, 0, Math.PI * 2); c.fill();
}
function drawEncampment(c, x, y, PX, lit, site) {
  var s = PX * 0.86;
  contact(c, x, y, s * 1.25, s * 0.36, 0.34);
  var accent = site.biome === 'forest' ? '#5f9a3e' : site.biome === 'graveyard' ? '#8f6bc0' : '#4fb9d6';
  // camp fire, lighting the tents from below-right
  glow(c, x + s * 0.05, y - s * 0.1, s * 1.5, 'rgba(255,150,60,0.30)');
  // three tents
  var pos = [[-0.72, 0.06, 0.62], [0.10, -0.10, 0.78], [0.78, 0.10, 0.56]];
  for (var i = 0; i < 3; i++) {
    var tx = x + pos[i][0] * s, ty = y + pos[i][1] * s, ts = s * pos[i][2];
    c.beginPath();
    c.moveTo(tx - ts * 0.62, ty); c.lineTo(tx, ty - ts * 0.95); c.lineTo(tx + ts * 0.62, ty); c.closePath();
    c.fillStyle = shadeRGB(122, 96, 68, 0.55 + lit * 0.4); c.fill();
    c.beginPath();
    c.moveTo(tx - ts * 0.62, ty); c.lineTo(tx, ty - ts * 0.95); c.lineTo(tx - ts * 0.10, ty); c.closePath();
    c.fillStyle = shadeRGB(196, 168, 128, 0.6 + lit * 0.42); c.fill();
    c.strokeStyle = 'rgba(38,26,16,0.6)'; c.lineWidth = Math.max(0.6, s * 0.045);
    c.beginPath(); c.moveTo(tx - ts * 0.62, ty); c.lineTo(tx, ty - ts * 0.95); c.lineTo(tx + ts * 0.62, ty); c.stroke();
  }
  // fire
  c.beginPath(); c.ellipse(x + s * 0.05, y - s * 0.05, s * 0.16, s * 0.10, 0, 0, Math.PI * 2);
  c.fillStyle = 'rgba(255,170,70,0.95)'; c.fill();
  // banner in the biome's colour
  c.strokeStyle = 'rgba(48,34,22,0.9)'; c.lineWidth = Math.max(0.8, s * 0.07);
  c.beginPath(); c.moveTo(x + s * 0.95, y - s * 0.05); c.lineTo(x + s * 0.95, y - s * 1.5); c.stroke();
  c.beginPath();
  c.moveTo(x + s * 0.95, y - s * 1.5); c.lineTo(x + s * 1.62, y - s * 1.36);
  c.lineTo(x + s * 1.44, y - s * 1.12); c.lineTo(x + s * 1.62, y - s * 0.88);
  c.lineTo(x + s * 0.95, y - s * 0.96); c.closePath();
  c.fillStyle = accent; c.fill();
  c.fillStyle = 'rgba(255,255,255,0.20)';
  c.beginPath();
  c.moveTo(x + s * 0.95, y - s * 1.5); c.lineTo(x + s * 1.62, y - s * 1.36);
  c.lineTo(x + s * 1.5, y - s * 1.20); c.lineTo(x + s * 0.95, y - s * 1.28); c.closePath(); c.fill();
}
function drawPyramid(c, x, y, PX, lit) {
  var s = PX * 1.6;
  c.fillStyle = 'rgba(8,6,12,0.42)';
  c.beginPath(); c.moveTo(x - s * 0.9, y); c.lineTo(x + s * 0.9, y);
  c.lineTo(x + s * 2.3, y + s * 0.5); c.lineTo(x + s * 0.4, y + s * 0.5); c.closePath(); c.fill();
  c.beginPath(); c.moveTo(x - s * 0.9, y); c.lineTo(x, y - s * 1.35); c.lineTo(x + s * 0.9, y); c.closePath();
  c.fillStyle = shadeRGB(24, 20, 30, 0.9 + lit * 0.3); c.fill();
  c.beginPath(); c.moveTo(x - s * 0.9, y); c.lineTo(x, y - s * 1.35); c.lineTo(x - s * 0.06, y); c.closePath();
  c.fillStyle = shadeRGB(62, 54, 78, 0.85 + lit * 0.4); c.fill();
  // the only door
  c.fillStyle = 'rgba(6,4,10,0.95)';
  c.beginPath(); c.moveTo(x - s * 0.16, y); c.lineTo(x - s * 0.16, y - s * 0.34);
  c.lineTo(x + s * 0.16, y - s * 0.34); c.lineTo(x + s * 0.16, y); c.closePath(); c.fill();
  glow(c, x, y - s * 0.2, s * 0.8, 'rgba(108,64,150,0.26)');
  glow(c, x, y - s * 1.35, s * 1.1, 'rgba(132,96,178,0.16)');
}
function drawGarden(c, x, y, PX, lit) {
  var s = PX * 1.15, i;
  contact(c, x, y, s * 1.5, s * 0.42, 0.32);
  // a low wall, perfectly circular, which is the wrong shape for anything else
  // on this map — that is the point of it
  c.beginPath(); c.ellipse(x, y - s * 0.12, s * 1.35, s * 0.62, 0, 0, Math.PI * 2);
  c.fillStyle = shadeRGB(126, 142, 96, 0.6 + lit * 0.4); c.fill();
  c.strokeStyle = shadeRGB(196, 188, 158, 0.68 + lit * 0.4); c.lineWidth = Math.max(1, s * 0.10); c.stroke();
  var r = rng(0x9e3779b9);
  drawBroadleaf(c, x, y - s * 0.2, s * 1.25, 1.0, r);
  for (i = 0; i < 5; i++) {
    c.beginPath(); c.arc(x + (r() - 0.5) * s * 1.1, y - s * 1.3 + (r() - 0.5) * s * 0.9, s * 0.13, 0, Math.PI * 2);
    c.fillStyle = 'rgba(248,232,128,0.98)'; c.fill();
  }
  glow(c, x, y - s * 1.2, s * 2.4, 'rgba(248,232,140,0.30)');
}
function drawChoir(c, x, y, PX, lit) {
  var s = PX * 1.1, i;
  contact(c, x, y, s * 1.4, s * 0.42, 0.30);
  c.beginPath(); c.ellipse(x, y - s * 0.05, s * 1.25, s * 0.55, 0, 0, Math.PI * 2);
  c.fillStyle = 'rgba(28,44,52,0.85)'; c.fill();
  c.strokeStyle = 'rgba(150,190,196,0.35)'; c.lineWidth = Math.max(0.8, s * 0.06); c.stroke();
  for (i = 0; i < 9; i++) {
    var a = (i / 9) * Math.PI * 2;
    var cx = x + Math.cos(a) * s * 0.95, cy = y - s * 0.05 + Math.sin(a) * s * 0.42;
    c.fillStyle = shadeRGB(216, 206, 182, 0.6 + lit * 0.4);
    c.fillRect(cx - s * 0.05, cy - s * 0.34, s * 0.10, s * 0.34);
    c.beginPath(); c.arc(cx, cy - s * 0.40, s * 0.07, 0, Math.PI * 2);
    c.fillStyle = 'rgba(255,226,160,0.98)'; c.fill();
    glow(c, cx, cy - s * 0.40, s * 0.5, 'rgba(255,220,150,0.34)');
  }
  glow(c, x, y - s * 0.4, s * 2.2, 'rgba(130,200,210,0.24)');
}

/* ── Region labels ────────────────────────────────────────────────────────
   Serif, wide letter-spacing, a soft dark halo instead of a hard drop shadow.
   One per biome core, and only where the core's own neighbourhood really is
   that biome — the Voronoi fuzz can shave a core's region down to nothing, and
   a label floating over somebody else's forest is worse than no label.       */
function drawRegionLabels(A) {
  var M = mapgen(), c = A.ctx;
  var cores = A.world.cores || M.biomeCores(A.seed);
  var used = {};
  c.save();
  c.textAlign = 'center'; c.textBaseline = 'middle';
  try { c.letterSpacing = Math.max(1, A.PX * 0.10).toFixed(1) + 'px'; } catch (e) { /* older engines */ }
  for (var i = 0; i < cores.length; i++) {
    var co = cores[i];
    // does the core still own its own ground?
    var hits = 0, tries = 0, dx, dy;
    for (dy = -2; dy <= 2; dy++) for (dx = -2; dx <= 2; dx++) {
      var x = co.x + dx, y = co.y + dy;
      if (x < 0 || y < 0 || x >= A.W || y >= A.H) continue;
      tries++;
      var idx = clamp(((y + 0.5) * A.PX) | 0, 0, A.BH - 1) * A.BW + clamp(((x + 0.5) * A.PX) | 0, 0, A.BW - 1);
      if (BORDER[A.BIO[idx]] === co.biome && A.WVAL[idx] < A.WTHR) hits++;
    }
    if (!tries || hits / tries < 0.55) continue;
    if (used[co.biome] && used[co.biome] > 1) continue;
    used[co.biome] = (used[co.biome] || 0) + 1;
    var name = mapgen().BIOMES[co.biome].name.toUpperCase();
    var px = (co.x + 0.5) * A.PX, py = (co.y + 0.5) * A.PX;
    c.font = '600 ' + (A.PX * 0.52).toFixed(0) + 'px Georgia, "Times New Roman", serif';
    c.lineJoin = 'round';
    c.strokeStyle = 'rgba(12,9,6,0.55)'; c.lineWidth = A.PX * 0.20;
    c.strokeText(name, px, py);
    c.fillStyle = 'rgba(244,236,214,0.80)';
    c.fillText(name, px, py);
  }
  c.restore();
}

/* ── Edge treatment ───────────────────────────────────────────────────────
   The world has to end somewhere. A hard rectangle reads as a cropped texture;
   a darkened, slightly ragged margin reads as the edge of a chart.           */
function finishEdges(A) {
  var c = A.ctx, M = mapgen();
  var m = A.PX * 1.1;
  c.save();
  var g = c.createLinearGradient(0, 0, m, 0);
  g.addColorStop(0, 'rgba(14,11,8,0.72)'); g.addColorStop(1, 'rgba(14,11,8,0)');
  c.fillStyle = g; c.fillRect(0, 0, m, A.BH);
  g = c.createLinearGradient(A.BW, 0, A.BW - m, 0);
  g.addColorStop(0, 'rgba(14,11,8,0.72)'); g.addColorStop(1, 'rgba(14,11,8,0)');
  c.fillStyle = g; c.fillRect(A.BW - m, 0, m, A.BH);
  g = c.createLinearGradient(0, 0, 0, m);
  g.addColorStop(0, 'rgba(14,11,8,0.72)'); g.addColorStop(1, 'rgba(14,11,8,0)');
  c.fillStyle = g; c.fillRect(0, 0, A.BW, m);
  g = c.createLinearGradient(0, A.BH, 0, A.BH - m);
  g.addColorStop(0, 'rgba(14,11,8,0.72)'); g.addColorStop(1, 'rgba(14,11,8,0)');
  c.fillStyle = g; c.fillRect(0, A.BH - m, A.BW, m);
  c.restore();
}

/* ── The "remembered" copy of the world ───────────────────────────────────
   Explored-but-not-currently-visible ground is drawn desaturated and cooled.
   Doing that per frame means a full-viewport 'saturation' composite every
   time the camera moves, which measured at ~40ms on its own in software
   compositing — by far the most expensive thing in the frame, and for a layer
   whose CONTENT never changes. So it is baked once, next to the terrain, and
   the frame is reduced to blitting a second static image through a mask.     */
function bakeMemory(src, BW, BH) {
  var cv = mkCanvas(BW, BH), c = cv.getContext('2d');
  c.drawImage(src, 0, 0);
  c.globalCompositeOperation = 'saturation';
  c.fillStyle = 'hsl(0,0%,50%)'; c.fillRect(0, 0, BW, BH);
  c.globalCompositeOperation = 'source-over';
  c.fillStyle = 'rgba(22,26,42,0.62)'; c.fillRect(0, 0, BW, BH);
  return cv;
}

/* ── The fog cloud texture ────────────────────────────────────────────────
   Baked once per seed at a tenth of the terrain's resolution, because it is
   about to be blurred and scaled anyway. Dark ink rather than black: the brief
   is explicit that unexplored world must still show its SHAPE and make the
   player want to walk into it, and a matte black rectangle does neither.     */
function bakeCloud(seed, W, H) {
  var Q = 10, CW = W * Q, CH = H * Q;
  var cv = mkCanvas(CW, CH), c = cv.getContext('2d');
  var g1 = noiseGrid(seed, R_CLOUD, 13, 10), g2 = noiseGrid(seed, R_CLOUD + 1, 31, 22),
      g3 = noiseGrid(seed, R_CLOUD + 2, 71, 50);
  var img = c.createImageData(CW, CH), d = img.data;
  for (var y = 0; y < CH; y++) for (var x = 0; x < CW; x++) {
    var v = sampleGrid(g1, 13, 10, x / CW * 12, y / CH * 9) * 0.55
          + sampleGrid(g2, 31, 22, x / CW * 30, y / CH * 21) * 0.30
          + sampleGrid(g3, 71, 50, x / CW * 70, y / CH * 49) * 0.15;
    var i = (y * CW + x) << 2;
    // a cold slate cloud with a faint warm underlight where it thins
    // ⚠ Watch the channel order here. The first version added a warm term to
    // the red channel and produced a lilac fog bank that looked like a bug.
    // Unexplored world is cold ink with a faint slate lift where it thins.
    var t = clamp((v - 0.34) * 2.4, 0, 1);
    var t2 = t * t;
    d[i]     = mix(11, 46, t2) + 4 * t;
    d[i + 1] = mix(12, 50, t2) + 3 * t;
    d[i + 2] = mix(19, 62, t2);
    d[i + 3] = 255;
  }
  c.putImageData(img, 0, 0);
  return cv;
}

/* ══════════════════════════════════════════════════════════════════════════
   DRAW — per frame

   Blit the baked world, then composite only what actually changes. The three
   fog states are the expensive part and they are still only a handful of
   viewport-sized operations:

     live       — untouched. You are looking at the world.
     remembered — the terrain, desaturated through a 'saturation' blend and
                  cooled. You remember the ground; you do not know who is
                  standing on it.
     unseen     — the cloud texture, opaque, over the same treatment.

   The boundaries between them are NOT tile edges: the masks are drawn as
   hash-jittered blobs into a small canvas and then blurred, so the fog has a
   soft irregular front that suggests something is under it.
   ══════════════════════════════════════════════════════════════════════ */

var _scratch = { a: null, b: null, w: 0, h: 0 };
function scratch(w, h) {
  if (_scratch.w !== w || _scratch.h !== h) {
    _scratch.a = mkCanvas(w, h); _scratch.b = mkCanvas(w, h);
    _scratch.w = w; _scratch.h = h;
  }
  return _scratch;
}
var _mask = { dim: null, unseen: null, key: null, q: 0, cv: null };

/* ⚠ The four mask canvases are CACHED, not reallocated. Building a fresh
   canvas per frame is what made the measured frame cost climb monotonically
   across a benchmark run — the renderer was outrunning the garbage collector
   with discarded backing stores rather than actually doing more work. */
function maskCanvases(MW, MH) {
  if (!_mask.cv || _mask.cv.w !== MW || _mask.cv.h !== MH) {
    _mask.cv = { w: MW, h: MH, raw: mkCanvas(MW, MH), raw2: mkCanvas(MW, MH),
                 dim: mkCanvas(MW, MH), uns: mkCanvas(MW, MH) };
  }
  return _mask.cv;
}

function fogMasks(baked, opts, W, H) {
  var M = mapgen();
  var Q = 7, MW = W * Q, MH = H * Q;
  var key = opts.fogKey;
  if (_mask.dim && key != null && _mask.key === key && _mask.q === Q) return _mask;
  var st = fogAccessor(opts);
  var C = maskCanvases(MW, MH);
  var raw = C.raw, rc = raw.getContext('2d');
  var raw2 = C.raw2, rc2 = raw2.getContext('2d');
  rc.setTransform(1, 0, 0, 1, 0, 0); rc.clearRect(0, 0, MW, MH);
  rc2.setTransform(1, 0, 0, 1, 0, 0); rc2.clearRect(0, 0, MW, MH);
  var x, y, any = false, anyUnseen = false;
  var bx0 = W, by0 = H, bx1 = -1, by1 = -1;
  for (y = 0; y < H; y++) for (x = 0; x < W; x++) {
    var s = st(x, y);
    if (s === 2) continue;
    any = true; if (s === 0) anyUnseen = true;
    if (x < bx0) bx0 = x; if (x > bx1) bx1 = x;
    if (y < by0) by0 = y; if (y > by1) by1 = y;
    // A jittered blob rather than a square. Two of these overlapping look like
    // a cloud bank; a grid of squares looks like a grid of squares.
    var h = M.wpHash32(baked.seed, x, y, R_FOGJIT);
    var jx = ((h & 255) / 255 - 0.5) * Q * 0.42, jy = (((h >>> 8) & 255) / 255 - 0.5) * Q * 0.42;
    var rr = Q * (0.76 + ((h >>> 16) & 255) / 255 * 0.22);
    rc.fillStyle = '#fff';
    rc.beginPath(); rc.arc((x + 0.5) * Q + jx, (y + 0.5) * Q + jy, rr, 0, Math.PI * 2); rc.fill();
    if (s === 0) {
      rc2.fillStyle = '#fff';
      rc2.beginPath(); rc2.arc((x + 0.5) * Q + jx, (y + 0.5) * Q + jy, rr, 0, Math.PI * 2); rc2.fill();
    }
  }
  var dim = C.dim, dc = dim.getContext('2d');
  var uns = C.uns, uc = uns.getContext('2d');
  dc.setTransform(1, 0, 0, 1, 0, 0); dc.clearRect(0, 0, MW, MH);
  uc.setTransform(1, 0, 0, 1, 0, 0); uc.clearRect(0, 0, MW, MH);
  try { dc.filter = 'blur(' + (Q * 0.72).toFixed(2) + 'px)'; uc.filter = 'blur(' + (Q * 0.80).toFixed(2) + 'px)'; } catch (e) { /* no filter: hard edges */ }
  dc.drawImage(raw, 0, 0);
  uc.drawImage(raw2, 0, 0);
  _mask.dim = dim; _mask.unseen = uns; _mask.key = key; _mask.q = Q;
  _mask.any = any; _mask.anyUnseen = anyUnseen;
  // Bounding box of everything not currently visible, in tiles, padded by the
  // blur radius. draw() clips the fog composites to it — in the late game
  // that is a corner of the map rather than the whole viewport.
  _mask.box = any ? { x0: bx0 - 1.5, y0: by0 - 1.5, x1: bx1 + 2.5, y1: by1 + 2.5 } : null;
  return _mask;
}
function fogAccessor(opts) {
  if (opts.fogState) return opts.fogState;
  var ex = opts.explored, vi = opts.visible;
  return function (x, y) {
    var e = ex ? !!ex(x, y) : true;
    if (!e) return 0;
    return (vi ? !!vi(x, y) : true) ? 2 : 1;
  };
}

function draw(ctx, opts) {
  var M = mapgen();
  var baked = opts.baked;
  if (!baked) throw new Error('warpath-render: draw() needs opts.baked from bakeTerrain()');
  var cam = opts.cam || { x: 0, y: 0, z: 24 };
  var VW = opts.view ? opts.view.w : ctx.canvas.width;
  var VH = opts.view ? opts.view.h : ctx.canvas.height;
  var W = M.WORLD_W, H = M.WORLD_H, z = cam.z, PX = baked.px;
  var t0 = now();

  ctx.save();
  ctx.fillStyle = opts.void_ || '#0b0910';
  ctx.fillRect(0, 0, VW, VH);

  // ── terrain blit ────────────────────────────────────────────────────────
  var dx0 = -cam.x, dy0 = -cam.y, dw = W * z, dh = H * z;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  // A soft drop under the map so it reads as a chart lying on a table.
  ctx.shadowColor = 'rgba(0,0,0,0.55)'; ctx.shadowBlur = Math.max(8, z * 0.6); ctx.shadowOffsetY = z * 0.18;
  ctx.drawImage(baked.canvas, dx0, dy0, dw, dh);
  ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;

  // ── movement affordances, under the fog so they cannot leak terrain ─────
  if (opts.reach) drawReach(ctx, opts, cam, W, H);
  if (opts.path && opts.path.length > 1) drawPath(ctx, opts.path, cam);

  // ── fog ─────────────────────────────────────────────────────────────────
  var tFogStart = now();
  if (opts.fogState || opts.explored || opts.visible) {
    var m = fogMasks(baked, opts, W, H);
    if (m.any) {
      // Clip everything below to the screen rect the fog can actually touch.
      var cx0 = clamp(m.box.x0 * z - cam.x, 0, VW), cy0 = clamp(m.box.y0 * z - cam.y, 0, VH);
      var cx1 = clamp(m.box.x1 * z - cam.x, 0, VW), cy1 = clamp(m.box.y1 * z - cam.y, 0, VH);
      var cw = cx1 - cx0, chh = cy1 - cy0;
      if (cw > 0 && chh > 0) {
        var sc = scratch(Math.max(1, Math.ceil(VW)), Math.max(1, Math.ceil(VH)));
        var a = sc.a.getContext('2d'), b = sc.b.getContext('2d');

        // 1. remembered + unseen: the pre-baked desaturated world, masked
        a.setTransform(1, 0, 0, 1, 0, 0);
        a.clearRect(cx0, cy0, cw, chh);
        a.globalCompositeOperation = 'source-over';
        a.save(); a.beginPath(); a.rect(cx0, cy0, cw, chh); a.clip();
        a.drawImage(baked.memory, dx0, dy0, dw, dh);
        a.globalCompositeOperation = 'destination-in';
        a.drawImage(m.dim, dx0, dy0, dw, dh);
        a.restore();
        a.globalCompositeOperation = 'source-over';
        ctx.drawImage(sc.a, cx0, cy0, cw, chh, cx0, cy0, cw, chh);

        // 2. unseen: the cloud bank on top
        if (m.anyUnseen) {
          b.setTransform(1, 0, 0, 1, 0, 0);
          b.clearRect(cx0, cy0, cw, chh);
          b.globalCompositeOperation = 'source-over';
          b.save(); b.beginPath(); b.rect(cx0, cy0, cw, chh); b.clip();
          b.drawImage(baked.cloud, dx0, dy0, dw, dh);
          b.globalCompositeOperation = 'destination-in';
          b.drawImage(m.unseen, dx0, dy0, dw, dh);
          b.restore();
          b.globalCompositeOperation = 'source-over';
          ctx.globalAlpha = 0.965;
          ctx.drawImage(sc.b, cx0, cy0, cw, chh, cx0, cy0, cw, chh);
          ctx.globalAlpha = 1;
        }
      }
    }
  }
  var tFog = now();

  // ── camp influence blooms, then actors ──────────────────────────────────
  var actors = opts.actors || [];
  var i;
  for (i = 0; i < actors.length; i++) if (actors[i].kind === 'camp') drawInfluence(ctx, actors[i], cam);
  var sorted = actors.slice().sort(function (p, q) { return p.y - q.y; });
  for (i = 0; i < sorted.length; i++) drawActor(ctx, sorted[i], cam, opts);

  // ── markers for unclaimed nodes / structures the app wants flagged ──────
  if (opts.markers) for (i = 0; i < opts.markers.length; i++) drawMarker(ctx, opts.markers[i], cam);

  // ── cursor ──────────────────────────────────────────────────────────────
  if (opts.hover) drawCursor(ctx, opts.hover.x, opts.hover.y, cam, 'rgba(243,231,200,0.55)', 1.4);
  if (opts.sel) drawCursor(ctx, opts.sel.x, opts.sel.y, cam, 'rgba(243,231,200,0.95)', 2.2);

  // ── frame + vignette + grade ────────────────────────────────────────────
  ctx.strokeStyle = 'rgba(212,175,55,0.34)'; ctx.lineWidth = 2;
  ctx.strokeRect(dx0 - 1, dy0 - 1, dw + 2, dh + 2);
  var vg = ctx.createRadialGradient(VW / 2, VH / 2, Math.min(VW, VH) * 0.30,
                                    VW / 2, VH / 2, Math.max(VW, VH) * 0.80);
  vg.addColorStop(0, 'rgba(0,0,0,0)');
  vg.addColorStop(0.62, 'rgba(4,3,8,0.22)');
  vg.addColorStop(1, 'rgba(3,2,6,0.68)');
  ctx.fillStyle = vg; ctx.fillRect(0, 0, VW, VH);
  ctx.restore();

  return { total: round2(now() - t0), fog: round2(tFog - tFogStart) };
}

/* ⚠ The movement overlay is NOT a grid of squares.
   It was, and it undid a lot of the work in this file: a hundred rounded
   rectangles laid over the terrain is a picture of the tile lattice, drawn on
   top of a picture that spends a megapixel hiding it. The reachable set still
   has to be legible tile by tile — the player is choosing a destination — so
   the compromise is a soft round pip at each tile centre plus one continuous
   ragged outline around the whole set. You can see exactly where you can go
   and there is not a straight cell edge anywhere in it. */
function drawReach(ctx, opts, cam, W, H) {
  var z = cam.z, k, ex = opts.explored, p, x, y;
  var set = {}, list = [];
  for (k in opts.reach) {
    p = k.split(','); x = +p[0]; y = +p[1];
    if (ex && !ex(x, y)) continue;
    set[x + ',' + y] = 1; list.push([x, y]);
  }
  if (!list.length) return;
  ctx.save();
  // the field
  ctx.fillStyle = 'rgba(214,180,86,0.085)';
  for (k = 0; k < list.length; k++) {
    var sx = (list[k][0] + 0.5) * z - cam.x, sy = (list[k][1] + 0.5) * z - cam.y;
    if (sx < -z || sy < -z || sx > 1e5) continue;
    ctx.beginPath(); ctx.arc(sx, sy, z * 0.62, 0, Math.PI * 2); ctx.fill();
  }
  // the frontier: only edges with no reachable neighbour, drawn as short
  // hand-wobbled strokes rather than a traced cell outline
  ctx.strokeStyle = 'rgba(226,196,116,0.42)';
  ctx.lineWidth = Math.max(1, z * 0.055); ctx.lineCap = 'round';
  ctx.beginPath();
  for (k = 0; k < list.length; k++) {
    x = list[k][0]; y = list[k][1];
    var bx = x * z - cam.x, by = y * z - cam.y;
    var wob = z * 0.10;
    if (!set[x + ',' + (y - 1)]) { ctx.moveTo(bx + z * 0.12, by + wob); ctx.lineTo(bx + z * 0.88, by - wob * 0.6); }
    if (!set[x + ',' + (y + 1)]) { ctx.moveTo(bx + z * 0.12, by + z - wob * 0.6); ctx.lineTo(bx + z * 0.88, by + z + wob); }
    if (!set[(x - 1) + ',' + y]) { ctx.moveTo(bx + wob, by + z * 0.12); ctx.lineTo(bx - wob * 0.6, by + z * 0.88); }
    if (!set[(x + 1) + ',' + y]) { ctx.moveTo(bx + z - wob * 0.6, by + z * 0.12); ctx.lineTo(bx + z + wob, by + z * 0.88); }
  }
  ctx.stroke();
  ctx.restore();
}
function drawPath(ctx, path, cam) {
  var z = cam.z, i;
  ctx.save();
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.beginPath();
  for (i = 0; i < path.length; i++) {
    var sx = (path[i][0] + 0.5) * z - cam.x, sy = (path[i][1] + 0.5) * z - cam.y;
    if (i === 0) ctx.moveTo(sx, sy); else ctx.lineTo(sx, sy);
  }
  ctx.strokeStyle = 'rgba(12,9,6,0.45)'; ctx.lineWidth = z * 0.20; ctx.stroke();
  ctx.strokeStyle = 'rgba(243,231,200,0.80)'; ctx.lineWidth = z * 0.09;
  try { ctx.setLineDash([z * 0.26, z * 0.20]); } catch (e) {}
  ctx.stroke();
  try { ctx.setLineDash([]); } catch (e) {}
  ctx.restore();
}
function roundRect(c, x, y, w, h, r) {
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
}

/* Camp influence: the brief says "a diffuse coloured bloom with a hand-drawn
   edge, not a filled polygon". So: a radial bloom, plus a wobbling boundary
   drawn as a closed curve whose radius is modulated by a couple of sine terms
   — cheap, and reads as ink rather than as geometry. */
function drawInfluence(ctx, a, cam) {
  var z = cam.z, R = (a.radius || 3.2) * z;
  var cx = (a.x + 0.5) * z - cam.x, cy = (a.y + 0.5) * z - cam.y;
  var col = a.color || '#ff7a2f';
  var p = hex(col);
  ctx.save();
  var g = ctx.createRadialGradient(cx, cy, R * 0.15, cx, cy, R);
  g.addColorStop(0, 'rgba(' + p[0] + ',' + p[1] + ',' + p[2] + ',0.20)');
  g.addColorStop(0.7, 'rgba(' + p[0] + ',' + p[1] + ',' + p[2] + ',0.07)');
  g.addColorStop(1, 'rgba(' + p[0] + ',' + p[1] + ',' + p[2] + ',0)');
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath();
  for (var i = 0; i <= 64; i++) {
    var th = i / 64 * Math.PI * 2;
    var rr = R * (0.86 + 0.055 * Math.sin(th * 3 + a.x) + 0.035 * Math.sin(th * 7 + a.y * 2));
    var px = cx + Math.cos(th) * rr, py = cy + Math.sin(th) * rr * 0.94;
    if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.strokeStyle = 'rgba(' + p[0] + ',' + p[1] + ',' + p[2] + ',0.32)';
  ctx.lineWidth = Math.max(1, z * 0.05);
  ctx.stroke();
  ctx.restore();
}

function drawActor(ctx, a, cam, opts) {
  var z = cam.z;
  var x = (a.x + 0.5) * z - cam.x, y = (a.y + 0.9) * z - cam.y;
  if (x < -2 * z || y < -2 * z) return;
  var col = a.color || '#d4af37';
  ctx.save();
  if (a.kind === 'camp') drawCamp(ctx, x, y, z, col, a);
  else drawHero(ctx, x, y, z, col, a);
  if (a.label && z >= 16) {
    ctx.font = '600 ' + (z * 0.30).toFixed(0) + 'px Georgia, "Times New Roman", serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = 'rgba(8,6,4,0.75)'; ctx.lineWidth = z * 0.12;
    ctx.strokeText(a.label, x, y + z * 0.14);
    ctx.fillStyle = 'rgba(245,238,220,0.92)';
    ctx.fillText(a.label, x, y + z * 0.14);
  }
  ctx.restore();
}
function drawCamp(ctx, x, y, z, col, a) {
  var s = z * 0.52;
  ctx.fillStyle = 'rgba(10,8,6,0.42)';
  ctx.beginPath(); ctx.ellipse(x + s * 0.35, y + s * 0.10, s * 1.15, s * 0.34, 0, 0, Math.PI * 2); ctx.fill();
  glow(ctx, x, y - s * 0.2, s * 2.0, 'rgba(255,150,60,0.26)');
  var pos = [[-0.62, 0.04, 0.70], [0.28, -0.06, 0.86]];
  for (var i = 0; i < 2; i++) {
    var tx = x + pos[i][0] * s, ty = y + pos[i][1] * s, ts = s * pos[i][2];
    ctx.beginPath();
    ctx.moveTo(tx - ts * 0.66, ty); ctx.lineTo(tx, ty - ts * 1.0); ctx.lineTo(tx + ts * 0.66, ty); ctx.closePath();
    ctx.fillStyle = 'rgb(118,92,64)'; ctx.fill();
    ctx.beginPath();
    ctx.moveTo(tx - ts * 0.66, ty); ctx.lineTo(tx, ty - ts * 1.0); ctx.lineTo(tx - ts * 0.12, ty); ctx.closePath();
    ctx.fillStyle = 'rgb(196,166,124)'; ctx.fill();
  }
  ctx.beginPath(); ctx.ellipse(x - s * 0.1, y + s * 0.02, s * 0.18, s * 0.11, 0, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255,176,72,0.95)'; ctx.fill();
  banner(ctx, x + s * 0.92, y, s * 1.5, col);
}
function drawHero(ctx, x, y, z, col, a) {
  var s = z * 0.44;
  ctx.fillStyle = 'rgba(10,8,6,0.45)';
  ctx.beginPath(); ctx.ellipse(x + s * 0.30, y + s * 0.06, s * 0.74, s * 0.26, 0, 0, Math.PI * 2); ctx.fill();
  glow(ctx, x, y - s * 0.7, s * 2.2, 'rgba(' + hex(col).join(',') + ',0.24)');
  // cloaked figure: a wedge for the body, a disc for the head, one lit edge
  ctx.beginPath();
  ctx.moveTo(x - s * 0.52, y); ctx.quadraticCurveTo(x, y - s * 0.55, x + s * 0.52, y);
  ctx.lineTo(x + s * 0.30, y - s * 1.12); ctx.lineTo(x - s * 0.30, y - s * 1.12); ctx.closePath();
  ctx.fillStyle = a.dark ? 'rgb(46,40,54)' : 'rgb(58,48,64)'; ctx.fill();
  ctx.beginPath();
  ctx.moveTo(x - s * 0.52, y); ctx.quadraticCurveTo(x - s * 0.3, y - s * 0.5, x - s * 0.30, y - s * 1.12);
  ctx.lineTo(x - s * 0.06, y - s * 1.12); ctx.lineTo(x - s * 0.10, y); ctx.closePath();
  ctx.fillStyle = 'rgba(198,186,206,0.42)'; ctx.fill();
  ctx.beginPath(); ctx.arc(x, y - s * 1.28, s * 0.26, 0, Math.PI * 2);
  ctx.fillStyle = 'rgb(214,190,160)'; ctx.fill();
  banner(ctx, x + s * 0.72, y, s * 1.9, col);
}
function banner(ctx, x, y, h, col) {
  ctx.strokeStyle = 'rgba(42,30,20,0.92)'; ctx.lineWidth = Math.max(1, h * 0.05);
  ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y - h); ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x, y - h); ctx.lineTo(x + h * 0.46, y - h * 0.90);
  ctx.lineTo(x + h * 0.34, y - h * 0.74); ctx.lineTo(x + h * 0.46, y - h * 0.58);
  ctx.lineTo(x, y - h * 0.62); ctx.closePath();
  ctx.fillStyle = col; ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.22)';
  ctx.beginPath();
  ctx.moveTo(x, y - h); ctx.lineTo(x + h * 0.46, y - h * 0.90);
  ctx.lineTo(x + h * 0.40, y - h * 0.82); ctx.lineTo(x, y - h * 0.90); ctx.closePath(); ctx.fill();
}

function drawMarker(ctx, m, cam) {
  var z = cam.z;
  var x = (m.x + 0.5) * z - cam.x, y = (m.y + 0.5) * z - cam.y;
  if (x < -z || y < -z) return;
  var r = z * (m.big ? 0.30 : 0.22);
  ctx.save();
  ctx.beginPath(); ctx.arc(x, y - z * 0.34, r, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(14,10,8,0.68)'; ctx.fill();
  ctx.strokeStyle = m.color || 'rgba(226,196,110,0.92)';
  ctx.lineWidth = Math.max(1, z * 0.045); ctx.stroke();
  if (m.glyph) {
    ctx.font = (r * 1.25).toFixed(0) + 'px Georgia, serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = m.color || 'rgba(240,224,180,0.95)';
    ctx.fillText(m.glyph, x, y - z * 0.32);
  }
  ctx.restore();
}
function drawCursor(ctx, x, y, cam, col, lw) {
  var z = cam.z;
  var sx = x * z - cam.x, sy = y * z - cam.y;
  var k = z * 0.30;
  ctx.save();
  ctx.strokeStyle = col; ctx.lineWidth = lw; ctx.lineCap = 'round';
  var corners = [[0, 0, 1, 1], [1, 0, -1, 1], [0, 1, 1, -1], [1, 1, -1, -1]];
  for (var i = 0; i < 4; i++) {
    var cx = sx + corners[i][0] * z, cy = sy + corners[i][1] * z;
    ctx.beginPath();
    ctx.moveTo(cx + corners[i][2] * k, cy);
    ctx.lineTo(cx, cy);
    ctx.lineTo(cx, cy + corners[i][3] * k);
    ctx.stroke();
  }
  ctx.restore();
}

// ── screen ⇄ tile ─────────────────────────────────────────────────────────
function tileToScreen(cam, x, y) { return { x: x * cam.z - cam.x, y: y * cam.z - cam.y, size: cam.z }; }
function screenToTile(cam, sx, sy) {
  var M = mapgen();
  var x = Math.floor((sx + cam.x) / cam.z), y = Math.floor((sy + cam.y) / cam.z);
  if (x < 0 || y < 0 || x >= M.WORLD_W || y >= M.WORLD_H) return null;
  return { x: x, y: y };
}
function fitZoom(vw, vh) {
  var M = mapgen();
  return Math.max(9, Math.min(64, Math.min(vw / M.WORLD_W, vh / M.WORLD_H)));
}

root.WarpathRender = {
  VERSION: '1.0.0',
  QUALITY: QUALITY, PALETTE: PAL, WATER: WATER,
  bakeTerrain: bakeTerrain,
  bakeCloud: bakeCloud,
  draw: draw,
  tileToScreen: tileToScreen,
  screenToTile: screenToTile,
  fitZoom: fitZoom,
};

})(typeof module !== 'undefined' && module.exports ? module.exports : (typeof window !== 'undefined' ? window : this));
