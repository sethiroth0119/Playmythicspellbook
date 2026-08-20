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
    R_FOGJIT = 780,   // fog blob jitter
    R_HACH   = 790,   // ridge hachure jitter
    R_CONE   = 795;   // +0..3, the volcano: radius, crater, barrancos, ash

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
  /* ⚠ Dragon Mountain is DARKER than it looks like it should be on paper.
     The first version gave it a pale sand `lit`, which combined with the rock
     blend and the strata multiplier to produce a bleached badland — the
     destination biome read as the flattest thing on the map. A massif is a
     dark mass with a few brilliant lit faces and a white cap, not an evenly
     bright one; the drama comes from the RANGE between deep and lit, and from
     the drawn ridge lines, not from raising the average. */
  /* ⚠ `rough` came DOWN when the volcano went in. 1.26 was chosen when ridged
     noise was the only thing making this biome a mountain, and it had to carry
     the whole massif alone; at that amplitude the detail octaves swing ±0.8 of
     elevation at a wavelength under two tiles, which is a mountain's worth of
     relief packed into gravel's worth of distance, and it renders as crumpled
     foil. Now that a real landform sits in the middle of the biome, the noise
     goes back to being what noise is good at — broken ground around a peak. */
  mountain:  { deep: '#2e2226', base: '#584740', lit: '#968d82', elev: 0.90, rough: 1.06 },
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

/* ── How much of the document the painted world carries ───────────────────
   The last line of the grade pulls every pixel of the live map a few percent
   toward one warm parchment note. It is there to make six biomes look like one
   painting — but it does a second job that only shows up in a real game frame:
   the SHROUD is parchment, and at the start of a run the shroud is four fifths
   of the screen. Too little of this and the explored patch is a saturated
   island pasted onto a pale field; too much and the world goes to mud and
   there was no point painting it. Tuned by rendering the same early-run frame
   at several values and looking at them side by side. */
var DOC_PULL = 0.26, DOC_WASH = 0.045;

// ── tiny utils ────────────────────────────────────────────────────────────
function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
/* ⚠ sstep MUST handle a > b, and for two rounds it silently did not.
   The old body tested `x <= a` first, so a descending call — `sstep(0.34, 0.04,
   h)`, meaning "1 down low, 0 up high" — degenerated into a HARD step at `a`
   with the sense INVERTED. Two callers were written that way and both got the
   opposite of what they asked for: Dragon Mountain's ember fissures, which are
   documented as living low on the mountain, fired only ABOVE the threshold and
   nowhere else; and the plains' green patches landed on exactly the same
   high-`det` ground as the dry gold patches they were supposed to alternate
   with. Normalising first and clamping after makes both directions work. */
function sstep(a, b, x) {
  if (a === b) return x < a ? 0 : 1;
  x = (x - a) / (b - a);
  x = x < 0 ? 0 : (x > 1 ? 1 : x);
  return x * x * (3 - 2 * x);
}
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

/* Separable running-sum box blur, `passes` of radius `r`. Two passes of a box
   is a decent gaussian and costs four adds per pixel per pass regardless of
   radius — which is the only reason a wide blur over a megapixel is affordable
   inside the bake at all. blurTiles above is a 1-pixel kernel and would need
   thirty passes to reach the same width. */
function boxBlur(a, w, h, r, passes) {
  var tmp = new Float32Array(w * h), p, x, y, i, sum, n = 2 * r + 1, inv = 1 / n;
  for (p = 0; p < passes; p++) {
    for (y = 0; y < h; y++) {
      var row = y * w;
      sum = 0;
      for (i = -r; i <= r; i++) sum += a[row + (i < 0 ? 0 : (i > w - 1 ? w - 1 : i))];
      for (x = 0; x < w; x++) {
        tmp[row + x] = sum * inv;
        var xo = x - r, xn = x + r + 1;
        sum += a[row + (xn > w - 1 ? w - 1 : xn)] - a[row + (xo < 0 ? 0 : xo)];
      }
    }
    for (x = 0; x < w; x++) {
      sum = 0;
      for (i = -r; i <= r; i++) sum += tmp[(i < 0 ? 0 : (i > h - 1 ? h - 1 : i)) * w + x];
      for (y = 0; y < h; y++) {
        a[y * w + x] = sum * inv;
        var yo = y - r, yn = y + r + 1;
        sum += tmp[(yn > h - 1 ? h - 1 : yn) * w + x] - tmp[(yo < 0 ? 0 : yo) * w + x];
      }
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
var INTERGRADE = 3.2;

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
  /* The per-tile biome index. Deliberately kept even though the painter
     classifies continuously and never reads it: it is the honest, generator-
     agreeing answer for a tile, and the moment somebody adds a debug overlay
     or a minimap that must NOT feather, this is the array they want. It costs
     1320 bytes. */
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
  blurTiles(wetBlur, W, H, 2);
  for (i = 0; i < W * H; i++) wet[i] = 0.48 * wet[i] + 0.52 * wetBlur[i];

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
  var WATER_WARP = 0.58;

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

  /* ══ DRAGON MOUNTAIN: A SUMMIT, NOT A SMEAR ═══════════════════════════════
     Every other landform on this map is noise — fBm for swells, ridged noise
     for arêtes — and noise is a wonderful way to make ground and a hopeless
     way to make a LANDMARK. Noise has no centre. Cranked up on a rugged biome
     it produces a broad, blurred, busy massif with a dozen equal high points
     and nothing to point at, which is precisely what Dragon Mountain was: a
     range without a peak. The brief builds a whole strategy on "head north
     toward the volcano", and you cannot head toward a texture.

     So the volcano is placed, not grown. Each mountain core carries an
     explicit stratovolcano: a radial profile, a summit crater, a lip, and
     barrancos down the flanks. It is added to the same height field as
     everything else, so the existing hillshade, cast shadow, rock blend,
     river carve and silhouette all pick it up for free — the mountain casts a
     real shadow, streams radiate off it, and it shows through the shroud.

     PROFILE. `1 - rad^0.72` and not `1 - rad`. A linear cone is a party hat;
     the exponent below 1 makes the flanks CONCAVE — steep near the summit,
     flattening into a broad apron — which is the actual silhouette of a
     stratovolcano and the reason one reads as enormous from a long way off.

     ⚠ THE RENDERER STILL CANNOT MOVE ANYTHING. The cone is centred on the
     core the generator already placed and it changes no tile's biome, no
     tile's passability and no node. It is paint on top of `tileAt`, exactly
     like every tree. A player who walks to the summit finds the same tiles
     the server says are there.

     Everything that depends only on the radius — profile, crater, lip,
     barranco amplitude — is precomputed into a 256-entry LUT and lerped, so
     the per-pixel cost inside the cone is a square root, two lattice samples
     and a handful of multiplies. No trig anywhere: the barrancos are an
     angular noise sampled by the UNIT DIRECTION VECTOR, which is continuous
     all the way round the circle and therefore has no seam at due east the
     way an atan2-based one would.                                            */
  var CONE_LUTN = 256;
  var CONES = [];
  (function () {
    var rank = 0, kk;
    for (kk = 0; kk < CN; kk++) {
      if (cores[kk].biome !== 'mountain') continue;
      var h1 = M.wpHash32(seed, kk + 1, 7, R_CONE);
      var h2 = M.wpHash32(seed, kk + 1, 11, R_CONE + 1);
      /* The first mountain core is THE volcano; any others the pool rolls are
         subordinate peaks at two-thirds the height. A range with one dominant
         summit is a destination. A range with three equal summits is scenery. */
      var lead = rank === 0;
      /* ⚠ TALL AND FAIRLY TIGHT, and both numbers were raised after looking at
         the first render. At six and a half tiles of radius and 1.1 of height
         the cone was real but it was not the tallest thing in its own biome —
         the ridged noise on the surrounding massif reached the same elevation,
         so the eye had nothing to settle on and the volcano read as one lump
         among several. A destination has to WIN. The upper flanks now run at
         roughly four fifths of the sun's own elevation angle, which is where
         the lambertian term goes near-grazing and the shaded flank turns to a
         hard dark mass — the thing that makes a peak look like a peak. */
      var rr = (5.05 + (h1 & 255) / 255 * 1.05) * (lead ? 1 : 0.80);
      var hh = (1.46 + ((h1 >>> 8) & 255) / 255 * 0.22) * (lead ? 1 : 0.62);
      var ecc = (((h1 >>> 16) & 255) / 255 - 0.5) * 0.26;   // never a true circle
      /* ⚠ Big. A crater at a tenth of the cone's radius is geologically
         reasonable and cartographically useless: half a tile across, it
         vanished at map scale and the volcano had no summit marking at all
         until you zoomed in. At this radius the caldera is nearly two tiles
         wide and the orange reads from across the world, which is the entire
         point of putting a destination on a map. */
      var rc = 0.150 + ((h2 >>> 16) & 255) / 255 * 0.040;   // crater radius, in rad
      var cd = lead ? 0.30 : 0.20;                          // crater depth, in profile units
      var P = new Float32Array(CONE_LUTN + 2), C = new Float32Array(CONE_LUTN + 2),
          E = new Float32Array(CONE_LUTN + 2);
      for (var t2 = 0; t2 <= CONE_LUTN + 1; t2++) {
        var rad = t2 / CONE_LUTN;
        var f = (1 - Math.pow(rad < 1 ? rad : 1, 0.72)) * sstep(1.0, 0.76, rad);
        var cm = sstep(rc, rc * 0.42, rad);                 // 1 in the bowl, 0 outside
        f -= cd * cm;
        // the lip: a real crater's rim is the highest ground on the mountain
        f += 0.058 * sstep(rc * 1.60, rc * 1.06, rad) * sstep(rc * 0.60, rc * 0.96, rad);
        P[t2] = f; C[t2] = cm;
        // barrancos live on the flanks: nothing in the bowl, nothing on the apron
        /* Barranco amplitude. Raised hard from the first value: the damped
           flanks are almost perfectly smooth, which is what lets the cone read
           as a cone, but smooth also means airbrushed — there was nothing on
           the surface for the eye to hold. The gullies are the only structure
           allowed up here, so they have to be the structure. */
        E[t2] = 0.175 * sstep(rc * 1.4, 0.36, rad) * sstep(1.0, 0.58, rad);
      }
      var wd = ((h2 & 1023) / 1023) * Math.PI * 2;          // ash drifts downwind
      CONES.push({ x: cores[kk].x + 0.5, y: cores[kk].y + 0.5,
                   ax: 1 + ecc, ay: 1 - ecc, R2: rr * rr, invR: 1 / rr, H: hh,
                   P: P, C: C, E: E, lead: lead,
                   wx: Math.cos(wd), wy: Math.sin(wd) });
      rank++;
    }
  })();
  var CONE_N = CONES.length;
  var CONE_HMAX_PRE = 0;
  for (k = 0; k < CONE_N; k++) if (CONES[k].H > CONE_HMAX_PRE) CONE_HMAX_PRE = CONES[k].H;
  // Angular noise for the barrancos, read by unit direction rather than angle.
  var BRW = 13, BRH = 13, brg = noiseGrid(seed, R_CONE + 2, BRW, BRH);
  var BR2W = 31, BR2H = 31, br2g = noiseGrid(seed, R_CONE + 3, BR2W, BR2H);
  /* Uint8, not Float32. Three more megapixel float arrays is twelve megabytes
     on a phone for three values that feed a snowline, a colour mix and an ash
     wash — 1/180th of an elevation unit is two percent of the narrowest
     feather any of them uses, so the quantisation is invisible. The cone is
     added to ELEV at full precision; only these read-backs are packed. */
  var CONEA = new Uint8Array(BW * BH);   // cone height * 180, for snow and rock
  var CRATA = new Uint8Array(BW * BH);   // crater bowl mask * 255
  var ASHA  = new Uint8Array(BW * BH);   // downwind ash apron * 255

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
              + (sampleGrid(wd.g, wd.w, wd.h, fx * (wd.w - 1) / W, fy * (wd.h - 1) / H) - 0.5) * 0.115
              + (v4 - 0.5) * 0.075 + (v3 - 0.5) * 0.055;
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

      /* ── the volcano ──────────────────────────────────────────────────────
         Evaluated BEFORE the noise terms, because it does not merely add to
         them — it SUPPRESSES them. That is the whole lesson of the first
         attempt at this: a cone added on top of the mountain biome's ridged
         noise at full strength is a cone buried in noise, and it rendered as
         exactly the crumpled smear it had been before, only higher up. The
         noise has an amplitude near ±0.8 at a wavelength under two tiles; the
         cone has an amplitude of 1.1 spread over six. Superposed at equal
         weight the short wavelength wins the hillshade every time, because a
         hillshade responds to GRADIENT and the gradient of the small term is
         an order of magnitude larger.

         A stratovolcano's flanks are smooth, and that smoothness is not an
         absence of detail — it is the feature. It is why a real one reads as a
         single enormous object from fifty miles away, and it is the only way
         this shape survives being lit. So the detail octaves and the global
         landform wander are both damped by how far up the cone a pixel sits:
         full noise out on the apron, a clean lit surface near the summit, and
         the barrancos supplying the only structure up there.

         Evaluated at the WARPED position, which matters more than it looks:
         the same displacement field that stops the biome boundaries being
         Voronoi bisectors also stops this being a drafting-compass circle.
         The base contour of the cone wanders by most of a tile, so it
         interlocks with the country around it instead of sitting on it. */
      var cone = 0, coneN = 0;
      if (CONE_N) {
        var crat = 0, ash = 0;
        var cone = 0, crat = 0, ash = 0;
        for (k = 0; k < CONE_N; k++) {
          var CO = CONES[k];
          var cdx = (wx - CO.x) * CO.ax, cdy = (wy - CO.y) * CO.ay;
          var cd2 = cdx * cdx + cdy * cdy;
          if (cd2 >= CO.R2) continue;
          var cds = Math.sqrt(cd2);
          var crad = cds * CO.invR;
          var clt = crad * CONE_LUTN, cli = clt | 0, clf = clt - cli;
          var pv2 = CO.P[cli] + (CO.P[cli + 1] - CO.P[cli]) * clf;
          var ev2 = CO.E[cli] + (CO.E[cli + 1] - CO.E[cli]) * clf;
          var ndx = 0, ndy = 0;
          if (cds > 1e-4) { var iv = 1 / cds; ndx = cdx * iv; ndy = cdy * iv; }
          if (ev2 > 0) {
            /* Barrancos — the radial gullies that rib every stratovolcano.
               Two angular octaves, sampled by the unit direction so they are
               continuous the whole way round, and the sampling radius grows
               with `crad` so the gullies SPLAY as they descend instead of
               staying parallel stripes. */
            var sr = 0.30 + 0.36 * crad;
            var b1 = sampleGrid(brg, BRW, BRH, (ndx * sr + 0.5) * (BRW - 1), (ndy * sr + 0.5) * (BRH - 1));
            var b2 = sampleGrid(br2g, BR2W, BR2H, (ndx * sr + 0.5) * (BR2W - 1), (ndy * sr + 0.5) * (BR2H - 1));
            var gcut = 1 - Math.abs((b1 * 0.68 + b2 * 0.32) * 2 - 1);   // ridged: gullies, not waves
            pv2 += (gcut * gcut - 0.42) * ev2;
          }
          var hcone = pv2 * CO.H;
          if (hcone > cone) {
            cone = hcone;
            // how far up THIS cone: 0 at the base, 1 at the lip. The term that
            // damps the noise, and the one the snowcap is keyed to.
            coneN = pv2 > 0 ? (pv2 > 1 ? 1 : pv2) : 0;
            crat = CO.C[cli] + (CO.C[cli + 1] - CO.C[cli]) * clf;
            // ash falls downwind of the vent and thins with distance
            var wdot = ndx * CO.wx + ndy * CO.wy;
            // a PLUME, not a hemisphere: cubed, so the fall is a lobe on one
            // flank rather than a grey wash over half the mountain
            if (wdot > 0) ash = wdot * wdot * wdot * sstep(0.98, 0.20, crad) * (CO.lead ? 1 : 0.6);
          }
        }
        CONEA[i] = cone > 0 ? (cone * 180 > 255 ? 255 : (cone * 180) | 0) : 0;
        CRATA[i] = (crat * 255) | 0;
        ASHA[i] = (ash * 255) | 0;
      }
      var dampD = 1 - 0.92 * coneN, dampL = 1 - 0.75 * coneN;
      ELEV[i] = eb + land * dampL + cone
              + rg * (ridgeMix * r + (1 - ridgeMix) * f - 0.46) * 1.30 * dampD
              // scree tooth: the finest octave, put BACK on the cone at low
              // amplitude. Damping the landform octaves to almost nothing is
              // what lets the shape read, but a surface with literally no
              // texture on it reads as vinyl; this is grain, not relief.
              + (v4 - 0.5) * 0.052 * coneN;
      /* ⚠ CLAMPED, and it has to be. This is a Uint8Array and `rg` is a biome
         ruggedness that is allowed to exceed 1.0 — Dragon Mountain's is well
         over it. Storing rg*200 unclamped wraps 264 to 8, which silently
         turns the most rugged ground on the map into the softest and takes
         the rock blend, the relief exaggeration and the snowline with it. */
      RGA[i] = Math.min(255, (rg * 200) | 0);

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
  carveRivers(seed, ELEV, WVAL, CRATA, CONEA, CONE_HMAX_PRE, BW, BH, PX, W, H);

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
  var RELIEF_KNEE = 2.6;   // see the soft-knee note in the shading loop
  /* ⚠ 0.32, not 0.42. The water field is a two-pass blur of the binary tile
     mask, so the value at the centre of a shoreline water tile sits near 0.75
     and the land beside it near 0.18; thresholding at the midpoint of THAT
     range, not of [0,1], is what puts the painted coast at the actual tile
     boundary instead of eating half the lake. Raising the blur without moving
     the threshold is why the first lakes came out both rounded AND shrunken. */
  var WTHR = 0.32;
  var hashf = M.wpHash32;
  var o3 = oct[3], o4g = oct[4];
  /* The snowcap's two thresholds, in ABSOLUTE cone height rather than in
     profile fraction, so a subordinate peak two thirds as tall gets a smaller
     cap or none — which is what makes the lead volcano read as the tallest
     thing on the map rather than as one of three white dots. */
  var CONE_HMAX = CONE_HMAX_PRE;
  /* ⚠ TIGHT. Read as a radius rather than as a height these say "snow from
     two tiles in, solid by the crater rim". The first values here said "snow
     from three tiles in", which on a cone eleven tiles wide is HALF THE
     MOUNTAIN, and the volcano came out wearing a white beanie that swallowed
     the whole lit flank — the cap stopped being a landmark and became the
     landform. A cap has to be a small bright thing on a large dark thing. */
  var CAP_A = 0.50 * CONE_HMAX, CAP_B = 0.72 * CONE_HMAX;

  for (y = 0; y < BH; y++) {
    for (x = 0; x < BW; x++) {
      i = y * BW + x;
      var e = ELEV[i];
      var coneV = CONEA[i] * (1 / 180), cratV = CRATA[i] * (1 / 255), ashV = ASHA[i] * (1 / 255);
      /* ⚠ RE-DERIVED, not carried over. The fields loop has a `coneN` holding
         exactly this fraction, and reaching for it here silently read the last
         value that loop left behind — the bottom-right corner of the map,
         which is zero — so every volcano-conditional in the shading pass was
         dead. `var` is function-scoped and both loops live in bakeTerrain;
         nothing warns you. */
      var coneF = CONE_HMAX > 0 ? coneV / CONE_HMAX : 0;

      // surface normal from two central differences, wide and narrow
      var el = ELEV[x > 0 ? i - 1 : i], er = ELEV[x < BW - 1 ? i + 1 : i];
      var eu = ELEV[y > 0 ? i - BW : i], ed = ELEV[y < BH - 1 ? i + BW : i];
      var eL = ELEV[x > DM ? i - DM : i], eR = ELEV[x < BW - 1 - DM ? i + DM : i];
      var eU = ELEV[y > DM ? i - DM * BW : i], eD = ELEV[y < BH - 1 - DM ? i + DM * BW : i];
      /* Relief is scaled by the local ruggedness. The whole map cannot share
         one vertical exaggeration: the number that makes a steppe read as
         gently rolling makes a mountain read as a bump, and the number that
         makes the mountain dramatic turns the steppe into corrugated iron.
         Rugged ground gets nearly triple the exaggeration of soft ground,
         which is why Dragon Mountain can carry itself on shading and only
         needs a scatter of crags as accents rather than a lawn of them. */
      var rgN = RGA[i] / 200;
      var rmul = 0.80 + 1.85 * rgN;
      /* ⚠ The MICRO term does NOT get the full ruggedness multiplier.
         It used to, and on Dragon Mountain that tripled the fine gradient as
         well as the landform one: the massif came out as salt-and-pepper —
         every few pixels swinging the tonal ramp end to end — and no amount
         of palette work could make a coherent mountain out of it. Ruggedness
         should exaggerate the LANDFORM (that is what makes a mountain a
         mountain) and leave the surface texture roughly alone. */
      var mmul = 0.85 + 0.72 * rgN;
      var gmx = (eR - eL) * RELIEF_MACRO * rmul, gmy = (eD - eU) * RELIEF_MACRO * rmul;
      var gx = gmx + (er - el) * RELIEF_MICRO * mmul;
      var gy = gmy + (ed - eu) * RELIEF_MICRO * mmul;
      /* ── SOFT-KNEE THE GRADIENT ──────────────────────────────────────────
         This is the line that turns Dragon Mountain from a stain into a
         mountain, and it took an embarrassingly long time to find.

         The vertical exaggeration here is about tenfold, which is what open
         country needs before a swell of a few percent grade shows up at all.
         On rugged ground that same multiplier produces gradients around
         THIRTY — an 88° wall at every pixel — and once the gradient is that
         large the lambertian term saturates: every surface is either fully
         lit or fully shadowed, the tonal ramp slams to its endpoints, and a
         massif renders as a checkerboard of bleached slope and ink blot with
         no modelling in between. It also makes every slope test in the file
         meaningless, which is the real reason the snowline never fired on the
         one biome that needed it.

         So the gradient goes through a soft knee: below ~1 it is essentially
         untouched (the steppe keeps its exaggeration), and it asymptotes to
         RELIEF_KNEE however steep the ground gets. The mountain gets a
         continuous range of surface angles back, which is the only way a
         hillshade can model form at all. */
      var gm = Math.sqrt(gx * gx + gy * gy);
      var comp = 1 / (1 + gm * (1 / RELIEF_KNEE));
      gx *= comp; gy *= comp;
      var slope = gm * comp;
      var nl = 1 / Math.sqrt(gx * gx + gy * gy + 1);
      var lam = (-gx * lx - gy * ly + lz) * nl;
      /* ⚠ The MACRO slope is kept separately, and the snow depends on it.
         `slope` above includes the micro term — the rock-and-grass texture —
         and on rugged ground that term alone runs to several units, so a
         "snow slides off anything steep" rule written against it removes snow
         from the entire massif. Which is exactly what happened: Dragon
         Mountain had no cap at all, and the destination biome lost the one
         feature that would have made it read as a peak from across the map.
         Snow slides off a LANDFORM slope, not off gravel. */
      var mgm = Math.sqrt(gmx * gmx + gmy * gmy);
      var mslope = mgm / (1 + mgm * (1 / RELIEF_KNEE));

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
      sh *= (1 - 0.50 * SHADOW[i]);              // the cast shadow
      if (sh > 1.22) sh = 1.22;
      LIGHT[i] = clamp(sh * 200, 0, 255) | 0;

      var bidx = BIO[i], nm = BORDER[bidx], pv = PALV[nm];
      var det = DET[i];
      var wv = WVAL[i];

      var cr, cg, cb;

      if (wv > WTHR) {
        // ── water ──────────────────────────────────────────────────────
        var dep = sstep(WTHR, 0.86, wv);
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
        var fm = (1 - Math.abs(wv - (WTHR + 0.030)) / 0.045);
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
        /* ⚠ The over-bright is SUPPRESSED ON THE VOLCANO. This term exists to
           let a rare sunward face blow out, which is lovely on broken ground
           where only a few facets ever face the light at once. A cone is one
           enormous smooth facet: half of it faces the light at nearly the same
           angle, so the term fired across thousands of contiguous pixels and
           the mountain came out as a bleached quarry — the palest thing on the
           map, when it should be the darkest. */
        var volc = sstep(0.10, 0.42, coneF);
        if (sh > 1) { var ov = (sh - 1) * 0.7 * (1 - volc * 0.88); cr = mix(cr, 255, ov); cg = mix(cg, 255, ov); cb = mix(cb, 255, ov); }

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
        /* ⚠ The cone counts toward the RUGGEDNESS gate as well as the height
           one. Rock is keyed on "high AND rough", and roughness is a per-biome
           constant blurred across tiles — so where the volcano's apron spills
           onto the gentle biome next door the ground came out half a unit high
           and still upholstered in grass. A volcanic flank is scree wherever
           it is steep, whichever cartographer's region it happens to be in. */
        var rock = sstep(0.46, 0.92, e) * sstep(0.26, 0.58, RGA[i] / 200 + coneV * 0.50);
        if (rock > 0.01) {
          /* ⚠ The rock tone is a CONTINUOUS function of the light, not a
             threshold on it. Picking one of two rock colours either side of
             sh=0.62 quantised the whole massif into two flat plateaus of
             value and destroyed exactly the relief this section exists to
             show — a mountain with a hillshade painted flat on top of it. */
          var rt = clamp(sh * 0.92, 0, 1);
          var rr2 = mix(44, 186, rt * rt * 0.55 + rt * 0.45), rg2 = mix(38, 164, rt), rb2 = mix(40, 141, rt);
          /* ── BASALT, NOT LIMESTONE ──────────────────────────────────────
             The generic rock ramp tops out at a pale grey that is right for a
             sunlit crag and wrong for a volcano, and on a cone — where the lit
             flank is a single continuous surface — it produced a mountain of
             chalk. Dragon Mountain is ash and cooled lava: a dark mass with a
             comparatively narrow tonal range. That is not only truer, it is
             what buys the two things that have to carry this landform from
             across the map — a white cap and an orange crater have nothing to
             be brilliant AGAINST unless the rock under them is dark. */
          if (volc > 0.01) {
            var vt = rt * rt * 0.42 + rt * 0.58;
            rr2 = mix(rr2, mix(21, 112, vt), volc);
            rg2 = mix(rg2, mix(18, 103, vt), volc);
            rb2 = mix(rb2, mix(21, 103, vt), volc);
          }
          // the cone leans harder on the rock ramp: the biome's own `lit` tone
          // is a pale grey and at 30% it was enough to keep re-bleaching it
          var rkm = rock * (0.70 + 0.24 * volc);
          cr = mix(cr, rr2, rkm); cg = mix(cg, rg2, rkm); cb = mix(cb, rb2, rkm);

          /* ── ridge crests and gullies ──────────────────────────────────
             The Laplacian is already in hand and on rock it is worth far more
             than it is on grass: a massif is READ by its arêtes. A negative
             curvature is a spine — catch a hard bright line along it, on the
             sunward side only, and it becomes an edge you can trace with a
             finger. A positive curvature is a couloir — sink it to near black
             and the mountain acquires internal drainage. Between them they
             are most of the difference between "brown lump" and "massif". */
          /* ⚠ AND THE CREST HIGHLIGHT IS GATED OFF THE CONE — the third and
             worst of the three passes that all failed the same way. Hachures,
             the over-bright and this one are each keyed to a property that a
             broken massif has only in places and a cone has EVERYWHERE: a
             steep gradient, a face turned to the sun, and — here — negative
             curvature. A cone is convex over its entire surface, so the arête
             catch-light fired across every pixel of it at full strength and
             laid a flat 34% wash of near-white over the whole mountain. That
             single line was most of why the volcano kept coming out as chalk
             no matter how dark the rock ramp under it was made. An arête
             highlight belongs on an arête. */
          var arete = 1 - volc * 0.86;
          var crest = sstep(0.05, 0.30, -curv) * clamp(0.35 + 0.85 * lam, 0, 1) * arete;
          /* ⚠ The gully term is deliberately WEAK now. At its first strength
             it painted the hollows near-black and the massif came out as a
             checkerboard of bleached slope and ink blot rather than as a
             continuous piece of ground. A couloir is a shadow, not a hole. */
          var gully = sstep(0.06, 0.40, curv) * clamp(0.30 + 0.70 * (1 - lam), 0, 1) * arete;
          cr = mix(cr, 246, crest * rock * 0.34); cg = mix(cg, 236, crest * rock * 0.34); cb = mix(cb, 216, crest * rock * 0.34);
          cr = mix(cr, 36, gully * rock * 0.22); cg = mix(cg, 31, gully * rock * 0.22); cb = mix(cb, 34, gully * rock * 0.22);
        }

        // ── per-biome texture ───────────────────────────────────────────
        // The bar: each biome must be identifiable with the colour removed.
        // These are all luminance moves, so they survive a greyscale test.
        var fine = sampleGrid(o4g.g, o4g.w, o4g.h, x * o4g.sx, y * o4g.sy);
        var mid = sampleGrid(o3.g, o3.w, o3.h, x * o3.sx, y * o3.sy);

        if (nm === 'mountain') {
          /* Exposed strata follow the contours of the height field, so they
             wrap around the ridges instead of striping the screen. Quieter
             than the first pass — at the old amplitude they were the loudest
             thing on the massif and the eye read banded sandstone, which is
             the wrong rock and the wrong drama for a volcano. */
          var band = e * 24 + det * 3.1;
          var sfr = band - Math.floor(band);
          /* ⚠ Faded out wherever the ground is actually ROCK. Strata are a
             sedimentary feature and at full strength across a whole massif
             they read as contour lines on a sand dune — which is precisely
             what two rounds of this file produced. They belong on the lower
             shoulders; the exposed rock above gets fracture instead. */
          var stAmt = (1 - rock * 0.72) * (1 - volc * 0.85);
          var strata = 1 + (0.13 * sstep(0.10, 0.50, sfr) - 0.11 * sstep(0.58, 0.96, sfr) - 0.06) * stAmt;
          cr *= strata; cg *= strata * 0.99; cb *= strata * 0.975;
          // fractured rock: a fine dark crack network, only on the bare rock
          if (rock > 0.02) {
            var frac = sstep(0.84, 1.0, 1 - Math.abs(fine + fine - 1)) * rock;
            cr = mix(cr, 40, frac * 0.30); cg = mix(cg, 35, frac * 0.30); cb = mix(cb, 36, frac * 0.30);
            var grit = 0.94 + 0.13 * fine;
            cr *= grit; cg *= grit; cb *= grit;
          }
          /* Ember light. Two terms, because one reads as orange confetti: a
             wide, weak bloom that warms the whole hollow, and a narrow bright
             core inside it that is the fissure itself. Both live LOW on the
             mountain — the heat is in the ground, not on the summit. */
          /* ⚠ Gated by a LOW-FREQUENCY field as well as by the ridged noise.
             Without the gate the ember term fires everywhere the noise
             network runs, which is everywhere, and the massif is wrapped in a
             net of orange filaments — a lava CONTOUR MAP. A volcano has a few
             flows on a few flanks. `det` is a landform-scale octave, so
             thresholding it picks out whole slopes rather than pixels, and
             the fissures then appear only on those. */
          var field = sstep(0.50, 0.74, det);
          var crk = 1 - Math.abs(mid + mid - 1);
          /* ⚠ Retuned, and it had to be, twice over. This term is documented
             as "the heat is in the ground, not on the summit" and it was
             written `sstep(0.34, 0.04, e - 0.46)` — a descending call, which
             the old broken sstep turned into a hard step with the sense
             inverted, so the fissures fired only on HIGH ground. With sstep
             fixed the same call would have fired nowhere at all, because the
             volcano now lifts every part of this biome above the old
             threshold. Absolute elevations, re-picked against the cone. */
          var low = sstep(1.34, 0.68, e) * field;
          var bloom = sstep(0.58, 0.96, crk) * low * (0.4 + 0.6 * fine);
          if (bloom > 0) { cr = mix(cr, 188, bloom * 0.30); cg = mix(cg, 80, bloom * 0.22); cb = mix(cb, 46, bloom * 0.15); }
          var glow = sstep(0.90, 1.0, crk) * low * (0.55 + 0.45 * fine);
          if (glow > 0) { cr = mix(cr, 255, glow * 0.66); cg = mix(cg, 142, glow * 0.48); cb = mix(cb, 48, glow * 0.30); }
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

        /* ── the crater and the ash apron ────────────────────────────────
           Both are painted outside the per-biome branch on purpose: the
           volcano is a landform and it does not stop at the Voronoi boundary
           any more than its foothills do. Ashfall in particular is supposed
           to run out over whatever is downwind of it.

           The bowl is black scoria — the darkest value anywhere on the map,
           which is what makes the lava inside it read as genuinely hot rather
           than as orange paint. The lava itself is a ridged network, not a
           disc: a crusted lake with fissures glowing through it. */
        if (cratV > 0.004) {
          var wall = cratV * 0.80;
          cr = mix(cr, 44, wall); cg = mix(cg, 35, wall); cb = mix(cb, 34, wall);
          var heat = sstep(0.02, 0.42, cratV) * (1 - sstep(0.40, 0.72, cratV));
          if (heat > 0) { cr = mix(cr, 176, heat * 0.26); cg = mix(cg, 78, heat * 0.16); cb = mix(cb, 44, heat * 0.08); }
          var lake = sstep(0.70, 0.99, cratV);
          if (lake > 0) {
            var crust = 1 - Math.abs((fine * 0.55 + mid * 0.45) * 2 - 1);
            var vein = sstep(0.52, 0.97, crust);
            cr = mix(cr, 122, lake * 0.55); cg = mix(cg, 48, lake * 0.55); cb = mix(cb, 34, lake * 0.55);
            cr = mix(cr, 255, lake * vein * 0.92); cg = mix(cg, 132, lake * vein * 0.62); cb = mix(cb, 44, lake * vein * 0.34);
          }
        }
        if (ashV > 0.012) {
          // fresh ash: grey, matte, and it kills the local colour
          var av = ashV * 0.34 * (0.72 + 0.56 * fine);
          var alum = cr * 0.30 + cg * 0.59 + cb * 0.11;
          cr = mix(cr, mix(alum, 74, 0.55), av);
          cg = mix(cg, mix(alum, 70, 0.55), av);
          cb = mix(cb, mix(alum, 70, 0.55), av);
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
        /* ⚠ The snowline is LOWER on rugged ground, and that is not a fudge.
           A snowline is a temperature contour, and the height field's units
           are not metres — a mountain biome's peaks and a steppe's high
           shoulder can sit at the same number while being nothing like the
           same landform. Tying the line to local ruggedness puts real white
           caps on Dragon Mountain (which is the destination biome and has to
           be the most arresting thing on the map) without frosting every
           swell of the Open Steppe. */
        /* ⚠ THE CONE RAISES THE SNOWLINE BY MORE THAN IT RAISES THE GROUND.
           `1.15 * coneV` against a cone that adds exactly `coneV` to `e` means
           the altitude rule NET DECREASES up the volcano — deliberately. Left
           alone it would have done the opposite of what a cap needs: the cone
           lifts its whole six-tile apron above the old line and the entire
           destination biome ices over into a white pancake. So the altitude
           rule is made to ignore the volcano, and the volcano gets its own
           cap keyed to how far up the CONE the pixel is, which is a fraction
           of a mountain rather than an absolute height and is therefore the
           only version of this that puts white on the top quarter. */
        var snowline = (0.97 - 0.19 * clamp(RGA[i] / 200, 0, 1.2)) + 0.20 * det + 0.09 * mid + 1.15 * coneV;
        var capAmt = CONE_HMAX > 0 ? sstep(CAP_A, CAP_B, coneV) : 0;
        // no snow in a crater full of lava, none under fresh ashfall
        capAmt *= (1 - cratV) * (1 - ashV * 0.80);
        var altAmt = sstep(snowline, snowline + 0.26, e);
        /* ⚠ The cap does NOT get the full slope-shedding term. That term is
           tuned for a broken massif, where the point is to leave snow in the
           crevices and strip it off the faces; a cone is one continuous face,
           so at full strength it stripped the cap almost everywhere and the
           summit came out the same value as the flanks. On a smooth flank
           snow LIES. So the cone's cap sheds gently and floors at 45%. */
        var capA2 = capAmt * clamp(1 - mslope * 0.10, 0.45, 1) * clamp(0.55 + 0.72 * fine, 0, 1);
        var snowAmt = altAmt * clamp(1 - mslope * 0.26, 0.0, 1) * clamp(0.35 + 1.0 * fine, 0, 1);
        if (capA2 > snowAmt) snowAmt = capA2;
        if (snowAmt > 0.02) {
          var sn = sh > 0.70 ? SNOWV.lit : SNOWV.deep;
          var sa = snowAmt * (0.82 + 0.13 * volc);
          cr = mix(cr, sn[0], sa); cg = mix(cg, sn[1], sa); cb = mix(cb, sn[2], sa);
        }

        // damp sand where the land meets water
        if (wv > WTHR - 0.12) {
          var damp = sstep(WTHR - 0.12, WTHR, wv);
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
      /* ⚠ The document pull is applied at CONSTANT LUMINANCE, not as a wash.
         Mixing every pixel toward a literal parchment colour does unify the
         palette, and at the strength the early-run frame wants it also lifts
         every dark value on the map by a fifth — which meant Dragon Mountain's
         shaded flank, the single strongest piece of modelling in the picture,
         came back forty levels paler. Pulling toward parchment's HUE at the
         pixel's OWN luminance takes the chroma difference out (which is what
         made the explored patch read as a saturated island against the pale
         shroud) and leaves the drawing intact. The small flat wash after it is
         the ink of the paper itself, and stays small. */
      var lumP = cr * 0.30 + cg * 0.59 + cb * 0.11;
      cr = mix(cr, lumP + 16.8, DOC_PULL);
      cg = mix(cg, lumP - 1.2, DOC_PULL);
      cb = mix(cb, lumP - 39.2, DOC_PULL);
      cr = mix(cr, 214, DOC_WASH); cg = mix(cg, 196, DOC_WASH); cb = mix(cb, 158, DOC_WASH);
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

  /* ── The silhouette, baked here and not later ────────────────────────────
     This is the picture the player sees through the shroud, and the ONLY
     reason it is built at this exact point in the bake is that it must
     contain the landform and nothing else. Every array it reads — height,
     light, cast shadow, water — exists now; every CONTENT layer — roads,
     scatter, deposits, structures, labels — is drawn in the next section.
     Build it one line later and unexplored territory starts quietly telling
     the player where the Dragon Heart is.

     If you ever move this call, move it UP, never down.                     */
  var SIL = bakeSilhouette(seed, ELEV, SHADOW, WVAL, WTHR, BW, BH, PX);
  var tSil = now();

  /* A cheap statistical fingerprint of the height field and the lighting.
     Not decoration: while tuning this file it was repeatedly unclear whether a
     change to the relief had actually altered anything or whether the picture
     merely looked the same, and eyeballing a 1.2-megapixel PNG is a bad way to
     answer that. These four numbers answer it in one line. */
  var dbg = { eMin: 1e9, eMax: -1e9, lMean: 0, lMin: 255, lMax: 0, bio: [0, 0, 0, 0, 0, 0],
              cones: CONE_N, cMax: 0, cArea: 0, cratArea: 0, hmax: round2(CONE_HMAX) };
  for (i = 0; i < N; i += 7) {
    var ev = ELEV[i]; if (ev < dbg.eMin) dbg.eMin = ev; if (ev > dbg.eMax) dbg.eMax = ev;
    var lv = LIGHT[i]; dbg.lMean += lv; if (lv < dbg.lMin) dbg.lMin = lv; if (lv > dbg.lMax) dbg.lMax = lv;
    dbg.bio[BIO[i]]++;
    if (CONEA[i] > dbg.cMax) dbg.cMax = CONEA[i];
    if (CONEA[i] > 18) dbg.cArea++;
    if (CRATA[i] > 128) dbg.cratArea++;
  }
  dbg.lMean = Math.round(dbg.lMean / Math.ceil(N / 7));
  dbg.eMin = round2(dbg.eMin); dbg.eMax = round2(dbg.eMax);

  // ── 7. Everything that is drawn rather than computed ────────────────────
  var ART = {
    ctx: ctx, seed: seed, PX: PX, BW: BW, BH: BH, W: W, H: H,
    ELEV: ELEV, WVAL: WVAL, LIGHT: LIGHT, BIO: BIO, WXA: WXA, WYA: WYA,
    RGA: RGA, WTHR: WTHR, world: world, CONEA: CONEA, CRATA: CRATA,
  };
  drawRoads(ART);
  drawHachures(ART);
  var objs = scatterObjects(ART);
  addNodeDeposits(ART, objs);
  addStructures(ART, objs);
  objs.sort(function (a, c) { return a.y - c.y; });
  for (i = 0; i < objs.length; i++) objs[i].f();
  var tObjects = now();

  /* Labels are NOT baked in. They used to be, and it cost us an information
     leak: the terrain canvas is also the source of the memory layer, so
     "OUROBOROS FACILITY" sat under the shroud in perfectly legible type and
     named a biome the player had not found. They are now a per-frame overlay
     that reads the fog state at its own tile — see drawLabels(). All the bake
     does is decide WHERE a label is allowed to go, which is a question about
     the world and belongs here. */
  var labels = labelSites(ART);
  finishEdges(ART);
  var t1 = now();
  /* ⚠ These three used to be built inside the returned object literal, AFTER
     the timestamp — so `timing.total` was quietly excluding a fifth of the
     bake and every performance comparison made from it was wrong by that much.
     Built here, timed here. */
  var CLOUD = bakeCloud(seed, W, H);
  var t2 = now();
  var MEM = bakeMemory(cv, BW, BH);
  var t3 = now();

  return {
    canvas: cv, ctx: ctx, seed: seed, px: PX, w: BW, h: BH,
    world: world, labels: labels,
    cloud: CLOUD,
    memory: MEM,
    silhouette: SIL,
    debug: dbg,
    timing: {
      total: round2(t3 - t0), fields: round2(tFields - t0),
      shadow: round2(tShadow - tFields), shading: round2(tShade - tShadow),
      silhouette: round2(tSil - tShade),
      objects: round2(tObjects - tSil), finish: round2(t1 - tObjects),
      cloud: round2(t2 - t1), memory: round2(t3 - t2),
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
function carveRivers(seed, ELEV, WVAL, CRATA, CONEA, CONE_HMAX, BW, BH, PX, W, H) {
  var M = mapgen();
  var cand = [], x, y, i;
  var step = Math.max(2, (PX / 2) | 0);
  for (y = PX; y < BH - PX; y += step) for (x = PX; x < BW - PX; x += step) {
    i = y * BW + x;
    if (WVAL[i] > 0.32) continue;
    /* ⚠ NOT IN THE CRATER. Sources are the highest ground on the map and the
       highest ground on the map is now the volcano's lip — from which the
       walker immediately descends into the bowl, hits its local minimum four
       steps later and stops, leaving a short blue worm sitting in the lava.
       Rivers rise on the flanks. */
    if (CRATA[i] > 6) continue;
    // and not on the upper cone either: a source on the lip runs four pixels
    // and stops, and the summit is not where a catchment is
    if (CONE_HMAX > 0 && CONEA[i] / 180 > 0.50 * CONE_HMAX) continue;
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
    /* ⚠ The path is COLLECTED first and stamped afterwards. The `life < 12`
       test below has always been there and has always been dead code: it ran
       after the stamping loop, so every four-pixel stub the walker abandoned
       in a hollow had already been painted into the water field. Buffering the
       course and committing it only if the river got somewhere is the whole
       fix, and it is what removes the short blue worms from the high ground. */
    var course = [];
    for (var s = 0; s < 900; s++) {
      var idx = (cy | 0) * BW + (cx | 0);
      if (cx < 1 || cy < 1 || cx >= BW - 1 || cy >= BH - 1) break;
      if (WVAL[idx] > 0.34) break;                      // reached a lake
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
      course.push(cx, cy, wid);
    }
    if (life < 12) continue;
    for (var cq = 0; cq < course.length; cq += 3) {
      var qcx = course[cq], qcy = course[cq + 1], qw = course[cq + 2];
      var rad = Math.ceil(qw) + 1;
      for (var oy = -rad; oy <= rad; oy++) for (var ox = -rad; ox <= rad; ox++) {
        var px2 = (qcx + ox) | 0, py2 = (qcy + oy) | 0;
        if (px2 < 0 || py2 < 0 || px2 >= BW || py2 >= BH) continue;
        var dd = Math.sqrt(ox * ox + oy * oy);
        var v = 1 - dd / (qw + 1.6);
        if (v <= 0) continue;
        var k2 = py2 * BW + px2;
        var val = 0.36 + v * 0.34;
        if (val > wj[k2]) wj[k2] = val;
      }
    }
  }
  for (i = 0; i < BW * BH; i++) {
    if (wj[i] > WVAL[i]) { WVAL[i] = wj[i]; ELEV[i] -= 0.02 * (wj[i] - 0.36) / 0.34; }
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
    var ph1 = r() * 6.3, ph2 = r() * 6.3, ph3 = r() * 6.3;
    /* ⚠ The longest term is the important one. With only the 5.7-tile wobble
       the track stayed within a tile of a ruled line over its whole length,
       which meant that on open ground you could still find the lattice by
       squinting. A 15-tile drift of nearly three tiles' amplitude means two
       roads that are nominally seven tiles apart are anywhere between four
       and ten apart, and the regularity stops being recoverable by eye. */
    for (t = 0; t <= len; t += PX * 0.34) {
      var wob = Math.sin(t / (PX * 15.3) + ph3) * PX * 2.60
              + Math.sin(t / (PX * 5.7) + ph1) * PX * 0.74 + Math.sin(t / (PX * 2.13) + ph2) * PX * 0.30
              + Math.sin(t / (PX * 0.91) + ph1 * 2.3) * PX * 0.09;
      var ax = L.horiz ? t : (L.at + 0.5) * PX + wob;
      var ay = L.horiz ? (L.at + 0.5) * PX + wob : t;
      pts.push([ax, ay]);
    }
    // Split into runs that stay on dry, walkable-looking ground.
    var run = [];
    for (k = 0; k < pts.length; k++) {
      var px2 = clamp(pts[k][0] | 0, 0, A.BW - 1), py2 = clamp(pts[k][1] | 0, 0, A.BH - 1);
      var idx = py2 * A.BW + px2;
      var dry = A.WVAL[idx] < A.WTHR - 0.015;
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

/* ── Hachures ─────────────────────────────────────────────────────────────
   The oldest trick in relief cartography and still the best one: short strokes
   running straight down the fall line, dense and dark where the ground is
   steep, absent where it is flat. A hillshade tells you which way a slope
   faces; hachures tell you that it is STEEP, and they do it with drawn marks,
   which is exactly the register a painted campaign map lives in.

   This is the pass that turns Dragon Mountain from a shaded brown region into
   a massif. It is deliberately not applied everywhere: gentle ground gets no
   strokes at all (RGA gate), so the Open Steppe stays open and the contrast
   between soft country and hard country is part of what sells the mountain.

   Direction is the true fall line of the height field. Tone follows the same
   sun as everything else in this file — a slope turned away from the light
   gets a dark stroke, one turned toward it a pale one — so the strokes deepen
   the hillshade instead of arguing with it.                                  */
function drawHachures(A) {
  var M = mapgen(), c = A.ctx, PX = A.PX, BW = A.BW, BH = A.BH, E = A.ELEV;
  var hl = Math.sqrt(LX * LX + LY * LY);
  var sunx = -LX / hl, suny = -LY / hl;          // 2D direction toward the sun
  var step = Math.max(3, Math.round(PX * 0.25));
  var d = Math.max(2, Math.round(PX * 0.30));
  var x, y;
  c.save();
  c.lineCap = 'round';
  for (y = d + 1; y < BH - d - 1; y += step) {
    for (x = d + 1; x < BW - d - 1; x += step) {
      var i = y * BW + x;
      var e = E[i];
      if (e < 0.56) continue;                     // low ground is not hachured
      if (A.RGA[i] < 76) continue;                // and neither is soft ground
      if (A.WVAL[i] > A.WTHR) continue;
      /* ⚠ AND NEITHER IS THE VOLCANO'S UPPER CONE, which is the one place on
         the map where this pass actively destroys the thing it exists to show.
         Hachures key on gradient, and a cone has a large, absolutely uniform
         gradient over its entire surface — so every stroke fired at full
         strength, the sunward flank bleached out under pale strokes and the
         shaded flank filled in solid black, and the clean lit surface the cone
         was built for disappeared under a radial scribble. Hachures say "this
         ground is steep and broken". A cone is steep and SMOOTH; its own
         hillshade is the correct and sufficient description of it. */
      var cnh = A.CONEA[i] / 180;
      var hbare = 1 - sstep(0.14, 0.46, cnh);
      if (hbare < 0.04) continue;
      var gx = E[i + d] - E[i - d], gy = E[i + d * BW] - E[i - d * BW];
      var sl = Math.sqrt(gx * gx + gy * gy);
      if (sl < 0.016) continue;
      var h = M.wpHash32(A.seed, x, y, R_HACH);
      var amt = clamp((sl - 0.016) / 0.075, 0, 1) * clamp((e - 0.56) / 0.26, 0, 1) * hbare;
      if (((h >>> 22) & 255) / 255 > amt * 0.94) continue;   // thin them out on gentle slopes
      var ux = -gx / sl, uy = -gy / sl;                       // the fall line
      var lit = (gx * sunx + gy * suny) / sl;                 // +1 faces the sun
      var jx = (((h & 255) / 255) - 0.5) * step * 1.15;
      var jy = ((((h >>> 8) & 255) / 255) - 0.5) * step * 1.15;
      var L = PX * (0.12 + 0.32 * amt) * (0.62 + ((h >>> 16) & 63) / 63 * 0.82);
      c.lineWidth = Math.max(0.7, PX * (0.024 + 0.030 * amt));
      c.strokeStyle = lit < 0
        ? 'rgba(19,13,12,' + (0.12 + 0.36 * amt * -lit).toFixed(3) + ')'
        : 'rgba(240,226,198,' + (0.04 + 0.21 * amt * lit).toFixed(3) + ')';
      c.beginPath();
      c.moveTo(x + jx, y + jy);
      c.lineTo(x + jx + ux * L, y + jy + uy * L);
      c.stroke();
    }
  }
  c.restore();
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
var DENSITY = { plains: 0.26, forest: 0.90, graveyard: 0.42, facility: 0.30, mountain: 0.26, wastes: 0.34 };

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
        if (A.WVAL[i] > A.WTHR - 0.02) continue;                 // not in the water
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

/* Local convexity of the baked height field at a continuous tile position:
   positive on a spine, negative in a hollow. Used to decide where crags stand
   and, below, to keep the biggest trees out of the ridgelines. */
function ridgeAt(A, fx, fy) {
  var d = Math.max(2, (A.PX * 0.42) | 0);
  var bx = clamp((fx * A.PX) | 0, d, A.BW - 1 - d), by = clamp((fy * A.PX) | 0, d, A.BH - 1 - d);
  var i = by * A.BW + bx;
  return A.ELEV[i] - (A.ELEV[i - d] + A.ELEV[i + d] + A.ELEV[i - d * A.BW] + A.ELEV[i + d * A.BW]) * 0.25;
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
    /* Crags go where the ROCK ALREADY RISES, not wherever the scatter felt
       like putting one. Two passes of this file drew a uniform lawn of
       identical brown wedges over the whole massif and it read as a texture
       swatch called "spikes" rather than as a mountain. So placement is gated
       on the local convexity of the height field — positive on a spine,
       negative in a bowl — which makes the crags line up along the arêtes the
       ridged noise already built, leaves the corries open, and gives the
       massif an internal structure the eye can follow. Size scales with both
       altitude and how pronounced the spine is, so the skyline has a few real
       peaks instead of a hundred equal teeth. */
    var t = r(), hi = clamp((e - 0.70) / 0.55, 0, 1);
    var spine = clamp(ridgeAt(A, fx, fy) * 26, -1, 1);
    /* ⚠ NOTHING STANDS ON THE VOLCANO'S UPPER CONE. The crag scatter is gated
       on altitude, and the cone raised the altitude of six tiles' worth of
       ground — so the first render of it grew a forest of rock wedges all over
       the one surface whose whole job is to be a clean lit slope. The cone's
       drama is its FORM; anything scattered on it is a thing standing in front
       of the form. Out on the apron, where the noise is back and the cone term
       has faded, the crags come back. */
    var cn = A.CONEA[A.BW * clamp((fy * A.PX) | 0, 0, A.BH - 1) + clamp((fx * A.PX) | 0, 0, A.BW - 1)] / 180;
    var bare = 1 - sstep(0.16, 0.52, cn);
    /* ⚠ Halved from the first pass. At the old rate a high massif grew a
       crag on nearly every candidate and the close view was a field of
       wedges — the exact "row of tents" failure the drawCrag comment warns
       about, reintroduced through density rather than through shape. The
       relief and the hachures carry the mountain now; these are accents on
       it and have to be rare enough to read as accents. */
    var pCrag = (0.03 + 0.16 * hi) * (0.20 + 1.0 * clamp(spine * 0.5 + 0.5, 0, 1)) * bare;
    if (t < pCrag) {
      /* ⚠ Capped. Unbounded, the top of this range produced crags wider than
         a tile, and a rock outcrop drawn at that size stops reading as rock
         and starts reading as a tent. The massif's scale now comes from the
         height field and the hachures; the crags are accents on it. */
      var s2 = PX * Math.min(0.38, 0.11 + r() * 0.12 + hi * 0.17 + Math.max(0, spine) * 0.14);
      return { y: fy, f: function () { drawCrag(c, px, py, s2, lit, e, r); } };
    }
    // fewer loose boulders than the first pass: at the density it used, the
    // massif came out looking gravelled rather than carved
    if (t < 0.60 * bare) { var s3 = PX * (0.05 + r() * 0.11); return { y: fy, f: function () { drawBoulder(c, px, py, s3, lit, r); } }; }
    if (t < 1 - 0.12 * bare) return null;
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
  var hue = r();          // 0 = cool blue-green, 1 = warm olive
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
    c.fillStyle = shadeRGB(34 + hue * 26, 52 + r() * 20, 34 + (1 - hue) * 20, tint);
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
  var hue2 = r();
  var base = [44 + hue2 * 34, 74 + r() * 20, 44 - hue2 * 12];
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
  contact(c, x, y, s * 1.45, s * 0.42, 0.32);
  /* ⚠ Wide and asymmetric, not tall and symmetric. A steep isoceles wedge
     with a lit left half is, to the eye, a tent — and a slope covered in them
     is a campsite, which is what two passes of this file produced. Real
     outcrops are broader than they are high, lean, and have a rubble skirt on
     the downhill side. The summit is pushed well off centre and the two
     flanks are given independent widths, so the silhouette never resolves
     into a triangle no matter how many of them overlap. */
  /* ⚠ The HEIGHT distribution is squared on purpose. Uniform heights give a
     row of similar peaks however varied the silhouette of each one is; a
     squared draw makes most outcrops low broken ridges and only the occasional
     one a true peak, which is both what a massif looks like and what stops the
     eye reading a repeated motif. */
  var rh = r();
  var w = s * (1.15 + r() * 0.75), h = s * (0.30 + rh * rh * 1.45);
  var lean = (r() - 0.5) * 1.15 * w;
  var sx = x + lean;                        // summit, deliberately off-centre
  var sh2 = h * (0.34 + r() * 0.30);        // shoulder height
  var shx = sx + w * (0.34 + r() * 0.50);   // shoulder x
  var pts = [
    [x - w, y],
    [x - w * (0.62 + r() * 0.3), y - h * (0.34 + r() * 0.26)],
    [sx - w * (0.20 + r() * 0.24), y - h * (0.76 + r() * 0.16)],
    [sx, y - h],
    [shx, y - sh2],
    [shx + w * (0.18 + r() * 0.3), y - sh2 * (0.30 + r() * 0.3)],
    [x + w * (0.94 + r() * 0.4), y]
  ];
  var i;
  c.beginPath(); c.moveTo(pts[0][0], pts[0][1]);
  for (i = 1; i < pts.length; i++) c.lineTo(pts[i][0], pts[i][1]);
  c.closePath();
  // Three rock types, picked per instance. A massif made of one colour is a
  // texture; a massif made of basalt, granite and iron-stained scree is a
  // mountain. The lit-face colours below key off the same pick.
  var rk2 = r();
  var dR = rk2 < 0.36 ? 58 : rk2 < 0.72 ? 76 : 92, dG = rk2 < 0.36 ? 50 : rk2 < 0.72 ? 66 : 62,
      dB = rk2 < 0.36 ? 48 : rk2 < 0.72 ? 58 : 48;
  var lR = rk2 < 0.36 ? 140 : rk2 < 0.72 ? 164 : 178, lG = rk2 < 0.36 ? 130 : rk2 < 0.72 ? 148 : 132,
      lB = rk2 < 0.36 ? 124 : rk2 < 0.72 ? 132 : 104;
  c.fillStyle = shadeRGB(dR, dG, dB, 0.60 + lit * 0.40); c.fill();
  // the lit flank: everything left of the summit line
  c.beginPath();
  c.moveTo(pts[0][0], pts[0][1]);
  c.lineTo(pts[1][0], pts[1][1]); c.lineTo(pts[2][0], pts[2][1]); c.lineTo(pts[3][0], pts[3][1]);
  c.lineTo(sx - w * 0.22, y);
  c.closePath();
  c.fillStyle = shadeRGB(lR, lG, lB, 0.70 + lit * 0.46); c.fill();
  /* A third facet between the lit and shadowed flanks. Two flat fills meeting
     along one line is cut paper however good the silhouette is; three tonal
     steps is the minimum at which a polygon starts reading as a solid. */
  c.beginPath();
  c.moveTo(pts[2][0], pts[2][1]); c.lineTo(pts[3][0], pts[3][1]);
  c.lineTo(sx - w * 0.22, y); c.lineTo(sx - w * (0.44 + r() * 0.2), y);
  c.closePath();
  c.fillStyle = shadeRGB((dR + lR) >> 1, (dG + lG) >> 1, (dB + lB) >> 1, 0.66 + lit * 0.44);
  c.fill();
  // a crease down the face, so the rock has structure
  c.strokeStyle = 'rgba(38,28,22,0.28)'; c.lineWidth = Math.max(0.5, s * 0.06);
  c.beginPath(); c.moveTo(sx, y - h); c.lineTo(sx - w * (0.2 + r() * 0.3), y); c.stroke();
  /* A rubble skirt and a lit summit ridge. Without them the polygon reads as
     cut paper at any zoom the player actually uses: two flat fills meeting
     along a straight line is a shape, not rock. The skirt grounds it and the
     ridge is where the eye goes. */
  c.beginPath();
  c.moveTo(pts[0][0], pts[0][1]);
  c.lineTo(x - w * 0.5, y - h * 0.16); c.lineTo(x + w * 0.5, y - h * 0.13);
  c.lineTo(pts[6][0], pts[6][1]);
  c.closePath();
  c.fillStyle = 'rgba(24,18,15,0.22)'; c.fill();
  c.strokeStyle = 'rgba(238,226,204,' + (0.12 + lit * 0.22).toFixed(3) + ')';
  c.lineWidth = Math.max(0.6, s * 0.075); c.lineJoin = 'round';
  c.beginPath();
  c.moveTo(pts[1][0], pts[1][1]); c.lineTo(pts[2][0], pts[2][1]);
  c.lineTo(pts[3][0], pts[3][1]); c.lineTo(pts[4][0], pts[4][1]);
  c.stroke();
  if (e > 0.98 && r() < 0.26) {
    c.beginPath();
    c.moveTo(pts[2][0], pts[2][1]); c.lineTo(sx, y - h);
    c.lineTo(shx, y - sh2); c.lineTo(shx - w * 0.18, y - sh2 - h * 0.10);
    c.lineTo(sx - w * 0.06, y - h * 0.86);
    c.closePath();
    c.fillStyle = 'rgba(222,230,240,0.62)'; c.fill();
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
    if (A.WVAL[i] > A.WTHR - 0.02) continue;
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
  contact(c, x, y, s * 0.95, s * 0.28, 0.38);
  var w = s * 0.60, h = s * 1.25, t = s * 0.19;
  var i;
  /* The doorway is drawn FIRST and small, then the stone is drawn over it.
     The first version filled the whole span between the piers with a bright
     gradient, which at map zoom is a beige slab with two thin edges — the
     single most important structure on the map read as a rectangle. The
     aperture is now narrower than the piers are thick, so what you see is
     masonry with light coming through it. */
  glow(c, x, y - h * 0.52, s * 1.35, 'rgba(238,190,96,0.34)');
  var g = c.createLinearGradient(x, y - h, x, y);
  g.addColorStop(0, 'rgba(255,236,182,0.95)');
  g.addColorStop(0.55, 'rgba(232,178,86,0.80)');
  g.addColorStop(1, 'rgba(150,92,30,0.55)');
  c.fillStyle = g;
  c.beginPath();
  c.moveTo(x - w * 0.52, y);
  c.lineTo(x - w * 0.52, y - h * 0.68);
  c.quadraticCurveTo(x, y - h * 1.02, x + w * 0.52, y - h * 0.68);
  c.lineTo(x + w * 0.52, y);
  c.closePath(); c.fill();
  // piers, coursed so they read as cut stone
  for (i = 0; i < 2; i++) {
    var px2 = i ? x + w * 0.52 : x - w * 0.52 - t;
    c.fillStyle = shadeRGB(74, 68, 60, 0.55 + lit * 0.35);
    c.fillRect(px2, y - h, t, h);
    c.fillStyle = shadeRGB(150, 140, 122, 0.60 + lit * 0.40);
    c.fillRect(px2, y - h, t * 0.34, h);
    c.strokeStyle = 'rgba(24,20,16,0.34)'; c.lineWidth = Math.max(0.6, s * 0.022);
    for (var b2 = 1; b2 < 5; b2++) {
      c.beginPath(); c.moveTo(px2, y - h * b2 / 5); c.lineTo(px2 + t, y - h * b2 / 5); c.stroke();
    }
  }
  // lintel, oversailing the piers
  c.fillStyle = shadeRGB(86, 78, 68, 0.55 + lit * 0.35);
  c.fillRect(x - w * 0.86 - t, y - h - t * 0.85, (w * 0.86 + t) * 2, t * 0.90);
  c.fillStyle = shadeRGB(166, 154, 134, 0.60 + lit * 0.42);
  c.fillRect(x - w * 0.86 - t, y - h - t * 0.85, (w * 0.86 + t) * 2, t * 0.26);
  // a keystone, because the eye looks for a centre
  c.fillStyle = shadeRGB(120, 110, 96, 0.60 + lit * 0.40);
  c.fillRect(x - t * 0.34, y - h - t * 0.85, t * 0.68, t * 0.90);
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
   Two halves, and the split is the point.

   labelSites() runs at BAKE time and decides WHERE a region name is allowed
   to sit: one per biome core, and only where the core's own neighbourhood
   really is that biome — the Voronoi fuzz can shave a core's region down to
   nothing, and a label floating over somebody else's forest is worse than no
   label. That is a question about the world, so it is answered once.

   drawLabels() runs PER FRAME and decides whether to draw it at all, because
   a region name is information about a region. Baked into the terrain, the
   name of a biome the player has never visited was legible straight through
   the shroud — an actual leak, and it looked like floating type besides. Now
   a label reads the fog at its own tile and at both of its ends: absent over
   unexplored ground, faint over remembered ground, full over live.          */
function labelSites(A) {
  var M = mapgen();
  var cores = A.world.cores || M.biomeCores(A.seed);
  var used = {}, out = [];
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
    /* ⚠ A mountain label is pushed OFF ITS OWN CORE. Every other biome's core
       is an unremarkable piece of its region and the label sits happily on it;
       a mountain core is now the summit of a volcano, so setting type there
       lays "DRAGON MOUNTAIN" straight across the caldera — the one square inch
       of this map the whole brief points at. The offset is south-west, into
       the lit apron, where a name on a campaign map usually goes anyway. */
    var lx2 = co.x + 0.5, ly2 = co.y + 0.5;
    if (co.biome === 'mountain') { lx2 -= 1.1; ly2 += 3.0; }
    out.push({ x: lx2, y: ly2, text: M.BIOMES[co.biome].name.toUpperCase() });
  }
  return out;
}

/* Draw the region names over an already-composited frame. `st` is the fog
   accessor (x,y) -> 0 unseen / 1 remembered / 2 live, or null for "all live".
   Exported so a full-world render can put the names back on the bake.       */
function drawLabels(ctx, baked, cam, st) {
  var labels = baked.labels;
  if (!labels || !labels.length) return;
  var z = cam.z;
  if (z < 11) return;                      // below this the type is illegible anyway
  var fs = z * 0.52;
  var M2 = mapgen(), MW2 = M2.WORLD_W, MH2 = M2.WORLD_H;
  var VW2 = ctx.canvas ? ctx.canvas.width : MW2 * z;
  ctx.save();
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.font = '600 ' + fs.toFixed(1) + 'px Georgia, "Times New Roman", serif';
  ctx.lineJoin = 'round';
  try { ctx.letterSpacing = Math.max(1, z * 0.10).toFixed(1) + 'px'; } catch (e) { /* older engines */ }
  for (var i = 0; i < labels.length; i++) {
    var L = labels[i];
    var half = ctx.measureText(L.text).width * 0.5 / z;    // in tiles
    /* Nudge the name back inside the world. A biome core can sit two tiles
       from the edge and its name is eight tiles long, and the previous
       version simply let it run off the chart — "AGON MOUNTAIN". Clamping in
       WORLD space rather than screen space means the label stays put relative
       to its region when the camera moves, which a screen-space clamp would
       not: the name would slide along the frame edge as you panned. */
    var lxw = clamp(L.x, half + 0.4, Math.max(half + 0.4, MW2 - half - 0.4));
    var px = lxw * z - cam.x, py = clamp(L.y, 0.7, MH2 - 0.7) * z - cam.y;
    if (px < -half * z - z || px > VW2 + half * z + z) continue;
    var a = 1;
    if (st) {
      /* Sample the middle and both ends. A name that runs off into the
         shroud is suppressed entirely rather than cropped mid-word — half a
         word fading into cloud looks like a rendering fault, and the half
         that survives still names ground the player has not walked. */
      var MW = MW2 - 1, ly = clamp(L.y | 0, 0, MH2 - 1);
      var s = Math.min(st(clamp(lxw | 0, 0, MW), ly),
                       st(clamp((lxw - half * 0.8) | 0, 0, MW), ly),
                       st(clamp((lxw + half * 0.8) | 0, 0, MW), ly));
      if (!(s > 0)) continue;              // 0, undefined or NaN → not drawn
      a = s === 1 ? 0.40 : 1;
    }
    ctx.strokeStyle = 'rgba(12,9,6,' + (0.55 * a).toFixed(3) + ')';
    ctx.lineWidth = z * 0.20;
    ctx.strokeText(L.text, px, py);
    ctx.fillStyle = 'rgba(244,236,214,' + (0.80 * a).toFixed(3) + ')';
    ctx.fillText(L.text, px, py);
  }
  ctx.restore();
}

/* ── Edge treatment ───────────────────────────────────────────────────────
   The world has to end somewhere. A hard rectangle reads as a cropped texture;
   a darkened, slightly ragged margin reads as the edge of a chart.           */
function finishEdges(A) { edgeWash(A.ctx, A.BW, A.BH, A.PX * 1.1, 'rgba(14,11,8,0.72)'); }
function edgeWash(c, BW, BH, m, col) {
  var clear = col.replace(/[\d.]+\)$/, '0)');
  var g;
  c.save();
  g = c.createLinearGradient(0, 0, m, 0);
  g.addColorStop(0, col); g.addColorStop(1, clear);
  c.fillStyle = g; c.fillRect(0, 0, m, BH);
  g = c.createLinearGradient(BW, 0, BW - m, 0);
  g.addColorStop(0, col); g.addColorStop(1, clear);
  c.fillStyle = g; c.fillRect(BW - m, 0, m, BH);
  g = c.createLinearGradient(0, 0, 0, m);
  g.addColorStop(0, col); g.addColorStop(1, clear);
  c.fillStyle = g; c.fillRect(0, 0, BW, m);
  g = c.createLinearGradient(0, BH, 0, BH - m);
  g.addColorStop(0, col); g.addColorStop(1, clear);
  c.fillStyle = g; c.fillRect(0, BH - m, BW, m);
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
  /* ⚠ STILL PAINTED. The first grade took 80% of the saturation and laid a
     40% blue-black wash on top, and the result was grey mush: in a real game
     frame the remembered band was barely distinguishable from the shroud and
     everything the bake spends 700ms on — the height field, the curvature,
     the cast shadows — was invisible in the only view a player ever sees.

     Remembered ground is ground you have WALKED. It should look like the map,
     dimmer and colder, the way a room looks by moonlight: half the saturation
     gone, a thin cold wash, and a gentle contrast lift so the relief survives
     the dimming. The distinction from `live` is carried by colour temperature
     and chroma, which the eye reads instantly, rather than by brightness,
     which just destroys the picture. */
  c.globalAlpha = 0.46;
  c.globalCompositeOperation = 'saturation';
  c.fillStyle = 'hsl(0,0%,50%)'; c.fillRect(0, 0, BW, BH);
  c.globalAlpha = 1;
  c.globalCompositeOperation = 'source-over';
  c.fillStyle = 'rgba(22,32,54,0.19)'; c.fillRect(0, 0, BW, BH);
  // a hair of moonlight back into the highlights, so the relief still reads
  c.globalCompositeOperation = 'overlay';
  c.fillStyle = 'rgba(158,168,192,0.14)'; c.fillRect(0, 0, BW, BH);
  c.globalCompositeOperation = 'source-over';
  return cv;
}

/* ── The silhouette: what unexplored territory is allowed to show ─────────
   The whole argument for this layer in one sentence: you should be able to
   see the SHAPE of a mountain range you have never visited, and nothing about
   what is on it.

   So it is built from the landform arrays only — height, light, cast shadow,
   water — and never touches the biome palette, the scatter, the roads, the
   deposits, the structures or the labels. It is a monochrome relief drawing
   in pale ink: the same sun, the same shadows, the same ridges, with all
   identity removed. Painted under the cloud it gives unexplored ground a
   legible landform and a reason to walk into it, which is exactly what a
   flat black rectangle cannot do.

   The one deliberate cheat is the cap: the very tops go bright, because a
   snow line is a landform feature and a white peak under cloud is the single
   most inviting thing a campaign map can put on its horizon.               */
function bakeSilhouette(seed, ELEV, SHADOW, WVAL, WTHR, BW, BH, PX) {
  var cv = mkCanvas(BW, BH), c = cv.getContext('2d');
  var img = c.createImageData(BW, BH), d = img.data;
  /* ⚠ A SMOOTHED COPY OF THE HEIGHT FIELD, and this is the difference between
     a chart and a coffee stain. The terrain's finest landform octaves have
     features around a third of a tile, which on the painted map is texture you
     read as ground. Under cloud, at low contrast, in a frame that is four
     fifths shroud, the same octaves are a field of soft brown blotches — and
     blotches on parchment is exactly the read we were trying to get away from.
     Widening the gradient stencil does not fix it, because the blotch is in
     the VALUES and not only in the derivative.
     So the silhouette lights a genuinely low-passed field: everything below
     about half a tile is gone, and what survives is massif, valley and ridge —
     the only things unexplored ground is supposed to be telling the player. */
  var ES = new Float32Array(ELEV);
  boxBlur(ES, BW, BH, Math.max(2, (PX * 0.16) | 0), 2);
  var hashf = mapgen().wpHash32;
  var llen = Math.sqrt(LX * LX + LY * LY + LZ * LZ);
  var lx = LX / llen, ly = LY / llen, lz = LZ / llen;
  /* ⚠ MACRO GRADIENT ONLY — do not reuse LIGHT here.
     LIGHT is the two-scale hillshade, and its micro term is the rock-and-grass
     texture: exactly the right thing on the painted map and exactly the wrong
     thing under cloud, where at map scale it reads as static. A shroud has to
     show LANDFORM — the massif, the valley, the ridge running north — so this
     lights a deliberately smoothed version of the same height field. */
  var DM = Math.max(3, (PX * 0.40) | 0);
  var x, y, i;
  for (y = 0; y < BH; y++) {
    for (x = 0; x < BW; x++) {
      i = y * BW + x;
      var e = ES[i];
      var eL = ES[x > DM ? i - DM : i], eR = ES[x < BW - 1 - DM ? i + DM : i];
      var eU = ES[y > DM ? i - DM * BW : i], eD = ES[y < BH - 1 - DM ? i + DM * BW : i];
      var gx = (eR - eL) * 17.0, gy = (eD - eU) * 17.0;
      // same soft knee as the terrain pass, for the same reason
      var gm2 = Math.sqrt(gx * gx + gy * gy), c2 = 1 / (1 + gm2 * 0.30);
      gx *= c2; gy *= c2;
      var nl = 1 / Math.sqrt(gx * gx + gy * gy + 1);
      var lam = (-gx * lx - gy * ly + lz) * nl;
      var cv2 = (eL + eR + eU + eD) * 0.25 - e;
      // curvature weighted harder than on the painted map: under cloud the
      // only thing that can make a valley legible is its drainage line
      var sh = clamp(0.30 + 0.86 * lam - cv2 * 8.5, 0, 1.3);
      sh *= (1 - 0.34 * SHADOW[i]);
      var cr, cg, cb;
      if (WVAL[i] > WTHR) {
        // water under cloud: flat, cool, a shade darker with depth. Shape only.
        /* ⚠ MUTED, DELIBERATELY. Water under cloud used to be the most
           saturated thing anywhere in an early-run frame: a scatter of bright
           blue puddles on a parchment field, which pulled the eye away from
           the only two things unexplored ground is supposed to be saying —
           where the high country is, and where the volcano is. A lake on a
           chart is drawn in the chart's own ink. */
        var dep = sstep(WTHR, 0.86, WVAL[i]);
        cr = mix(150, 118, dep); cg = mix(154, 126, dep); cb = mix(152, 132, dep);
      } else {
        /* ⚠ CONTRAST, not brightness. The first grade of this layer put the
           relief in a narrow band up near white, and under the cloud it came
           out as an undifferentiated steam bath: technically a silhouette,
           legible as nothing. What has to survive the veil is the SHAPE, and
           shape survives on tonal range. So the ramp is nearly the full one,
           and high ground is pushed hard toward a dark mass — a range of
           hills under cloud should read as a bruise, not as a lighter fog. */
        /* Warm parchment, and a narrow band. This is a MAP CONVENTION, not a
           photograph: too much tonal range here and the shroud reads as
           satellite marble, which is the failure mode the previous grade hit.
           The landform has to be legible, not dramatic — dramatic is what the
           map itself gets to be once you have walked there. */
        /* Widened once the field under it was low-passed. The narrow band was
           protection against the small-scale blotching; with that gone the
           relief can afford — and needs — a real tonal range, because the
           thing it has to survive is a translucent veil on top of it. */
        var v = clamp(sh, 0, 1);
        cr = mix(58, 222, v); cg = mix(52, 208, v); cb = mix(44, 178, v);
        var mass = sstep(0.40, 1.15, e);
        cr = mix(cr, 70, mass * 0.60); cg = mix(cg, 62, mass * 0.60); cb = mix(cb, 52, mass * 0.60);
        /* ⚠ Re-pitched for the volcano. These thresholds were set when the
           map's ceiling was about 1.4; the cone pushed it past 2.2, and at the
           old numbers the whole upper third of Dragon Mountain saturated to
           white and the destination biome appeared through the shroud as a
           luminous dandelion. A cap under cloud should be a small bright
           SIGNAL on a dark mass — which is also, conveniently, exactly what it
           is on the painted map. */
        var cap = sstep(1.52, 1.98, e);
        cr = mix(cr, 226, cap * 0.60); cg = mix(cg, 228, cap * 0.60); cb = mix(cb, 230, cap * 0.60);
      }
      var gr = ((hashf(seed, x, y, R_GRAIN) >>> 16) & 255) / 255 - 0.5;
      cr += gr * 3.5; cg += gr * 3.5; cb += gr * 3.5;
      var o = i << 2;
      d[o] = cr < 0 ? 0 : (cr > 255 ? 255 : cr);
      d[o + 1] = cg < 0 ? 0 : (cg > 255 ? 255 : cg);
      d[o + 2] = cb < 0 ? 0 : (cb > 255 ? 255 : cb);
      d[o + 3] = 255;
    }
  }
  c.putImageData(img, 0, 0);
  // the same darkened margin the terrain gets, so the world still ends
  edgeWash(c, BW, BH, PX * 1.1, 'rgba(60,56,48,0.55)');
  return cv;
}

/* ── The fog cloud texture ────────────────────────────────────────────────
   Baked once per seed at a tenth of the terrain's resolution, because it is
   about to be blurred and scaled anyway.

   ⚠ THIS LAYER IS TRANSLUCENT AND IT IS PALE, and both of those are hard
   requirements rather than taste. The first version was near-black and fully
   opaque, and in a real early-run frame — where four fifths of the screen is
   unexplored — the map read as a torch in a cave. Nothing of the terrain
   survived, which meant none of the relief work survived either.

   A shroud is WEATHER, not absence. It is a lit cloud deck seen from above:
   pale, cold, rolling, thick in places and thin in others. Where it thins,
   the silhouette layer underneath shows a landform and the player learns
   there is a mountain range over there — which is the entire mechanic of
   wanting to explore. Where it piles up it hides everything.

   So the alpha channel does the work here, not the colour. Two things depend
   on that and will break if this is made opaque again: the silhouette becomes
   pointless, and the fog stops having a third state at all.                 */
function bakeCloud(seed, W, H) {
  var M = mapgen();
  /* Sixteen samples per tile, up from ten. The old resolution was chosen when
     this layer was three octaves of value noise about to be blurred anyway;
     wisps are a HIGH-FREQUENCY structure and at ten per tile the finest octave
     landed on a six-pixel lattice which, blown up to the bake's twenty-eight,
     came out as round lumps. Round lumps at that scale are exactly what read
     as coffee grounds. */
  var Q = 16, CW = W * Q, CH = H * Q;
  var cv = mkCanvas(CW, CH), c = cv.getContext('2d');

  /* ── WIND ───────────────────────────────────────────────────────────────
     One direction for the whole deck, hashed from the seed. Everything below
     is evaluated in a frame rotated onto it and then STRETCHED along it, so
     every feature at every octave is elongated the same way. This is the
     cheapest single thing that turns noise into weather: isotropic noise has
     no story, and a deck that is plainly blowing one way does. */
  var hw = M.wpHash32(seed, 3, 9, R_CLOUD + 8);
  var wang = ((hw & 2047) / 2047) * Math.PI;
  var cw = Math.cos(wang), sw = Math.sin(wang);
  var STRETCH = 2.6;

  /* ── CURL WARP ──────────────────────────────────────────────────────────
     The actual answer to "it looks like a stain". A stain is what value noise
     with an alpha ramp always looks like, however many octaves you stack on
     it, because every octave is isotropic and blobby and stacking blobs gives
     you a bigger blob. Cloud is not blobs; cloud is a FLOW, with filaments
     that stretch, shear, wrap around each other and tear.

     So the density is not sampled at the pixel. It is sampled at the pixel
     displaced by a divergence-free velocity field — the curl of a scalar
     potential, (∂ψ/∂y, −∂ψ/∂x). Divergence-free is the important word: such a
     field cannot pile density up or thin it out, it can only SHEAR it, so
     round features get drawn out into hooks and streamers around the
     potential's extrema instead of merely being pushed around. Two octaves of
     it, the coarse one for the big rotation and the fine one for the shredding
     at the edges.

     ⚠ Built at quarter resolution and bilinearly upsampled, exactly like the
     terrain's warp field and for exactly the same reason: it is smooth by
     construction — its finest feature is twenty pixels across — so sampling it
     per pixel would buy nothing and cost four fifths of this function.       */
  var pAW = 10, pAH = 8,  pA = noiseGrid(seed, R_CLOUD + 3, pAW, pAH);
  var pBW = 25, pBH = 18, pB = noiseGrid(seed, R_CLOUD + 4, pBW, pBH);
  var GW = (CW >> 2) + 2, GH = (CH >> 2) + 2;
  var WXG = new Float32Array(GW * GH), WYG = new Float32Array(GW * GH);
  /* ⚠ CURL_AMP IS A DISPLACEMENT, NOT A GRADIENT, and conflating the two is
     worth a permanent note because the first version did and the failure was
     not obvious from the code. Dividing the central difference by 2h turns it
     into a derivative whose magnitude here runs to fifteen — and it was then
     used directly as an offset in NORMALISED MAP UNITS, i.e. the lookup was
     being thrown fifteen map widths sideways. Every octave sampled effectively
     random positions, and the "cloud" was a moiré of the noise lattice folded
     over on itself: the marbled-endpaper look. The raw difference is left
     un-normalised and multiplied by an explicit amplitude tuned in units of
     the map, where a sane shear is a tile or two. */
  var CURL_AMP = 0.0042;
  var hstep = 0.006;
  function psi(u, v) {
    return sampleGrid(pA, pAW, pAH, u * (pAW - 1), v * (pAH - 1))
         + sampleGrid(pB, pBW, pBH, u * (pBW - 1), v * (pBH - 1)) * 0.45;
  }
  var gx2, gy2, ii;
  for (gy2 = 0; gy2 < GH; gy2++) for (gx2 = 0; gx2 < GW; gx2++) {
    var u0 = (gx2 * 4) / CW, v0 = (gy2 * 4) / CH;
    ii = gy2 * GW + gx2;
    WXG[ii] =  (psi(u0, v0 + hstep) - psi(u0, v0 - hstep)) / (2 * hstep) * CURL_AMP;
    WYG[ii] = -(psi(u0 + hstep, v0) - psi(u0 - hstep, v0)) / (2 * hstep) * CURL_AMP;
  }

  // Density octaves, sampled in the wind-aligned, wind-stretched frame.
  var d1W = 13, d1H = 11, d1 = noiseGrid(seed, R_CLOUD,     d1W, d1H);
  var d2W = 27, d2H = 22, d2 = noiseGrid(seed, R_CLOUD + 1, d2W, d2H);
  var d3W = 55, d3H = 44, d3 = noiseGrid(seed, R_CLOUD + 2, d3W, d3H);
  var d4W = 111, d4H = 88, d4 = noiseGrid(seed, R_CLOUD + 5, d4W, d4H);

  var D = new Float32Array(CW * CH);
  var x, y, i;
  for (y = 0; y < CH; y++) {
    var vN = y / CH;
    var wgy = y * 0.25, wgy0 = wgy | 0, wgyf = wgy - wgy0;
    for (x = 0; x < CW; x++) {
      var uN = x / CW;
      var wgx = x * 0.25, wgx0 = wgx | 0, wgxf = wgx - wgx0;
      var q = wgy0 * GW + wgx0;
      var m0 = WXG[q] + (WXG[q + 1] - WXG[q]) * wgxf;
      var m1 = WXG[q + GW] + (WXG[q + GW + 1] - WXG[q + GW]) * wgxf;
      var wu = uN + (m0 + (m1 - m0) * wgyf);
      m0 = WYG[q] + (WYG[q + 1] - WYG[q]) * wgxf;
      m1 = WYG[q + GW] + (WYG[q + GW + 1] - WYG[q + GW]) * wgxf;
      var wv = vN + (m0 + (m1 - m0) * wgyf);
      // rotate onto the wind, then stretch along it
      var au = (wu * cw + wv * sw) / STRETCH + 0.5;
      var av = (-wu * sw + wv * cw) + 0.5;
      /* ⚠ THE FINE OCTAVES ARE NOT WARPED. The shear displaces a lookup by a
         couple of tiles, which is a gentle fold for an octave whose features
         are ten tiles across and a catastrophe for one whose features are half
         a tile: the fine detail gets folded over itself several times and
         comes back as tight repeating ripples — a watered-silk texture that
         reads as fabric, not sky. Coarse structure gets the flow; surface
         grain is sampled straight. */
      var bu = (uN * cw + vN * sw) / STRETCH + 0.5;
      var bv = (-uN * sw + vN * cw) + 0.5;

      /* ⚠ NO EXTRA FREQUENCY MULTIPLIER. Each grid already carries its own
         octave, and the first version of this multiplied the lookup by 2/4/8
         ON TOP of that — which put the finest octave on a lattice cell 1.7
         pixels wide. That is not detail, it is static, and it is what made the
         first curl-warped cloud read as machined marble rather than as sky.
         The anisotropy comes from the /STRETCH above, which makes the sampled
         span along the wind less than half the span across it. */
      var n1 = sampleGrid(d1, d1W, d1H, au * (d1W - 1), av * (d1H - 1));
      var n2 = sampleGrid(d2, d2W, d2H, au * (d2W - 1), av * (d2H - 1));
      var n3 = sampleGrid(d3, d3W, d3H, bu * (d3W - 1), bv * (d3H - 1));
      var n4 = sampleGrid(d4, d4W, d4H, bu * (d4W - 1), bv * (d4H - 1));
      /* Weighted hard toward the LOWEST octave, which is the one property of
         the old cloud worth keeping: a shroud wants a few big banks with clear
         windows between them, not an even stipple. A uniformly busy veil hides
         the landform everywhere by a little instead of hiding it somewhere by
         a lot, which is the difference between weather and a dirty lens. */
      var dv = n1 * 0.55 + n2 * 0.25 + n3 * 0.13 + n4 * 0.07;
      /* ⚠ NO RIDGED OCTAVE HERE, and that is the second thing this function
         had to unlearn. Ridged noise makes filaments on a MOUNTAIN because a
         mountain's filaments are arêtes and arêtes are exactly the level sets
         of a smooth field. In a cloud the same construction draws its ridges
         along the noise lattice's zero contours, which are CLOSED LOOPS, and
         the shroud comes out looking like marbled endpaper or an oil slick.
         Wispiness here comes from the shear — the curl warp above stretching
         and folding a perfectly smooth field — which is also how it comes
         about in the sky. */
      D[y * CW + x] = dv;
    }
  }

  /* ── LIGHT THE CLOUD ────────────────────────────────────────────────────
     The density field is treated as a height field and hillshaded with the
     same sun as the ground beneath it. This is what makes a deck read as
     something with volume sitting ABOVE the map rather than as a tint applied
     to it: the north-west face of every bank catches the light and the
     south-east side of it falls into its own shade, so the shroud carries the
     one visual property the rest of the picture is built on — a single
     consistent light. It also costs one gradient. */
  var llen = Math.sqrt(LX * LX + LY * LY);
  var lx2 = LX / llen, ly2 = LY / llen;
  var img = c.createImageData(CW, CH), d8 = img.data;
  /* The gradient is measured across two thirds of a tile, not across three
     pixels. A bank is fifty pixels wide; a three-pixel difference measures the
     grain on its surface rather than its FORM, and lighting the grain gives a
     sparkly nothing. Light the form. */
  var SD = Math.max(3, (Q * 0.66) | 0);
  for (y = 0; y < CH; y++) {
    for (x = 0; x < CW; x++) {
      i = y * CW + x;
      var dc = D[i];
      var dl = D[x > SD ? i - SD : i], dr = D[x < CW - 1 - SD ? i + SD : i];
      var du = D[y > SD ? i - SD * CW : i], dd = D[y < CH - 1 - SD ? i + SD * CW : i];
      var gx = (dr - dl), gy = (dd - du);
      var lam = clamp(0.5 + (-gx * lx2 - gy * ly2) * 7.0, 0, 1);
      lam = lam * lam * (3 - 2 * lam);

      /* ⚠ A STEEP RAMP, and this is the difference between weather and a
         stain. Density here is a sum of octaves and therefore nearly gaussian
         about the middle of its range, so a gentle ramp maps almost the whole
         map into the middle of the alpha range — a uniform grubby film,
         everywhere, which is precisely the "coffee-stained" read. Pushing the
         threshold up and the slope steep splits the deck into a minority of
         genuinely thick banks and a majority of genuinely CLEAR sky, and the
         clear sky is what lets the landform underneath be seen sharply enough
         to be worth walking toward. (Clear is safe: what is under the veil is
         the contents-free silhouette, by construction.) */
      var t = clamp((dc - 0.415) * 3.5, 0, 1);
      var t2 = t * t * (3 - 2 * t);
      /* Aged paper, not white steam. The shroud is a MAP convention — the part
         of the chart nobody has drawn on yet — so it lives in the same warm
         earthy band as the rest of the palette, and the self-shading moves it
         along a warm axis rather than toward grey: cream where the sun hits
         the top of a bank, dusty ochre in its shadow. A neutral white veil put
         a hard value and temperature split down the middle of the frame. */
      // a real tonal range across a single bank — a shaded flank that is
      // genuinely darker than the ground showing through the window beside it
      var sr = mix(116, 240, lam), sg = mix(108, 229, lam), sb = mix(96, 202, lam);
      // thicker cloud is also brighter cloud: more of it to scatter light
      var lift = t2 * 0.34;
      var o = i << 2;
      d8[o]     = mix(sr, 246, lift);
      d8[o + 1] = mix(sg, 238, lift);
      d8[o + 2] = mix(sb, 214, lift);
      /* Opacity: thin over most of the map so the landform underneath is
         plainly legible, piling up into banks that bury it completely. The
         quartic keeps the thick banks a minority of the area — a deck with
         holes in it — and the small extra term from the SHADING means the lit
         crest of a bank is slightly more opaque than its shaded flank, which
         is what gives the front of the deck a drawn edge. */
      d8[o + 3] = (mix(12, 214, t2 * t2 * 0.55 + t2 * 0.45) + 12 * lam * t) | 0;
    }
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

/* ── The fog, composited in WORLD space ───────────────────────────────────
   The obvious implementation composites the fog into a viewport-sized scratch
   canvas every frame. It works, and it costs two full-viewport masked draws
   per frame — which is fine while the player sits still and is not fine while
   they pan, because the camera is part of the composite and every pan frame
   invalidates it. Measured at 1440x900 in software that was ~53ms a frame
   during a drag: visibly heavy.

   So the two fog layers are built at BAKE resolution, in world space, exactly
   like the terrain: `a` is the desaturated memory image masked to everything
   not currently visible, `b` is the cloud masked to the unexplored. Neither
   depends on the camera at all, so they are rebuilt only when the fog itself
   changes — once a turn — and every frame in between, including every frame
   of a pan or a zoom, is three sub-rectangle blits of three static images.  */
/* ⚠ THE ORDER OF THESE THREE COMPOSITES IS A SECURITY-ADJACENT DETAIL.

   Layer `a` is the base under everything that is not currently visible. It
   starts as the remembered painting — and then the SILHOUETTE is stamped into
   it over the unexplored region through a HARD mask, before the whole thing is
   cut to the dim mask. That stamp is the reason unexplored ground can be shown
   at all: the veil on top of it (`b`) is translucent by design, so whatever is
   underneath partially shows, and "whatever is underneath" therefore has to be
   the contents-free landform drawing rather than the real map.

   Do it the other way round — translucent veil straight over the remembered
   painting — and every scattered tree, deposit, structure and road in the
   unexplored world becomes faintly visible. It looks almost the same. It is
   not the same.                                                              */
var _fogw = { key: null, seed: -1, a: null, b: null, s: null, w: 0, h: 0, unseen: false, has: false };
function fogWorld(baked, m, key) {
  if (!m.any) return null;
  if (_fogw.has && _fogw.key === key && key != null && _fogw.seed === baked.seed) return _fogw;
  var BW = baked.w, BH = baked.h;
  if (_fogw.w !== BW || _fogw.h !== BH) {
    _fogw.a = mkCanvas(BW, BH); _fogw.b = mkCanvas(BW, BH); _fogw.s = mkCanvas(BW, BH);
    _fogw.w = BW; _fogw.h = BH;
  }
  var a = _fogw.a.getContext('2d'), b = _fogw.b.getContext('2d'), s = _fogw.s.getContext('2d');
  if (m.anyUnseen) {
    // s = the landform drawing, cut to the unexplored region
    s.setTransform(1, 0, 0, 1, 0, 0); s.globalCompositeOperation = 'source-over';
    s.clearRect(0, 0, BW, BH);
    s.drawImage(baked.silhouette, 0, 0);
    s.globalCompositeOperation = 'destination-in';
    s.drawImage(m.hard, 0, 0, BW, BH);
    s.globalCompositeOperation = 'source-over';
  }
  a.setTransform(1, 0, 0, 1, 0, 0); a.globalCompositeOperation = 'source-over';
  a.clearRect(0, 0, BW, BH);
  a.drawImage(baked.memory, 0, 0);
  if (m.anyUnseen) a.drawImage(_fogw.s, 0, 0);        // contents gone under the shroud
  a.globalCompositeOperation = 'destination-in';
  a.drawImage(m.dim, 0, 0, BW, BH);
  a.globalCompositeOperation = 'source-over';
  b.setTransform(1, 0, 0, 1, 0, 0); b.globalCompositeOperation = 'source-over';
  b.clearRect(0, 0, BW, BH);
  if (m.anyUnseen) {
    b.drawImage(baked.cloud, 0, 0, BW, BH);
    b.globalCompositeOperation = 'destination-in';
    b.drawImage(m.unseen, 0, 0, BW, BH);
    b.globalCompositeOperation = 'source-over';
  }
  _fogw.key = key; _fogw.seed = baked.seed; _fogw.unseen = m.anyUnseen; _fogw.has = true;
  return _fogw;
}
var _mask = { dim: null, unseen: null, hard: null, key: null, q: 0, cv: null };

/* ⚠ The four mask canvases are CACHED, not reallocated. Building a fresh
   canvas per frame is what made the measured frame cost climb monotonically
   across a benchmark run — the renderer was outrunning the garbage collector
   with discarded backing stores rather than actually doing more work. */
function maskCanvases(MW, MH) {
  if (!_mask.cv || _mask.cv.w !== MW || _mask.cv.h !== MH) {
    _mask.cv = { w: MW, h: MH, raw: mkCanvas(MW, MH), raw2: mkCanvas(MW, MH),
                 raw3: mkCanvas(MW, MH), dim: mkCanvas(MW, MH),
                 uns: mkCanvas(MW, MH), hard: mkCanvas(MW, MH) };
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
  var raw3 = C.raw3, rc3 = raw3.getContext('2d');
  rc.setTransform(1, 0, 0, 1, 0, 0); rc.clearRect(0, 0, MW, MH);
  rc2.setTransform(1, 0, 0, 1, 0, 0); rc2.clearRect(0, 0, MW, MH);
  rc3.setTransform(1, 0, 0, 1, 0, 0); rc3.clearRect(0, 0, MW, MH);
  rc.fillStyle = '#fff'; rc2.fillStyle = '#fff'; rc3.fillStyle = '#fff';
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
    var cx = (x + 0.5) * Q + jx, cy = (y + 0.5) * Q + jy;
    rc.beginPath(); rc.arc(cx, cy, rr, 0, Math.PI * 2); rc.fill();
    if (s === 0) {
      // the soft veil reaches further than the hard base swap, which is what
      // keeps the swap's own edge buried under thick cloud
      rc2.beginPath(); rc2.arc(cx, cy, rr * 1.22, 0, Math.PI * 2); rc2.fill();
      rc3.beginPath(); rc3.arc(cx, cy, rr * 1.04, 0, Math.PI * 2); rc3.fill();
    }
  }
  var dim = C.dim, dc = dim.getContext('2d');
  var uns = C.uns, uc = uns.getContext('2d');
  var hard = C.hard, hc = hard.getContext('2d');
  dc.setTransform(1, 0, 0, 1, 0, 0); dc.clearRect(0, 0, MW, MH);
  uc.setTransform(1, 0, 0, 1, 0, 0); uc.clearRect(0, 0, MW, MH);
  hc.setTransform(1, 0, 0, 1, 0, 0); hc.clearRect(0, 0, MW, MH);
  try { dc.filter = 'blur(' + (Q * 0.72).toFixed(2) + 'px)'; uc.filter = 'blur(' + (Q * 0.62).toFixed(2) + 'px)'; } catch (e) { /* no filter: hard edges */ }
  dc.drawImage(raw, 0, 0);
  uc.drawImage(raw2, 0, 0);
  /* Firm the veil up. A gaussian leaves the front at 50% for a whole tile,
     and 50% of a translucent veil is not enough cover: the base swap under it
     would show its own edge. Compositing the blurred mask onto itself is a
     one-line gamma — alpha becomes 1-(1-a)^2 — which pins the interior at
     opaque and leaves a tighter, still perfectly soft front. */
  try { uc.filter = 'none'; } catch (e) {}
  uc.drawImage(uns, 0, 0);
  // the hard mask is near-binary on purpose: it decides WHAT is under the
  // veil, never how the veil looks, so it only needs enough blur to antialias
  try { hc.filter = 'blur(' + (Q * 0.14).toFixed(2) + 'px)'; } catch (e) {}
  hc.drawImage(raw3, 0, 0);
  try { hc.filter = 'none'; } catch (e) {}
  hc.drawImage(hard, 0, 0); hc.drawImage(hard, 0, 0);
  _mask.dim = dim; _mask.unseen = uns; _mask.hard = hard; _mask.key = key; _mask.q = Q;
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
  /* ⚠ 'medium', not 'high', and no shadowBlur.
     Two lines that between them cost more than everything else in the frame
     put together. `shadowBlur` on a full-map drawImage asks the rasteriser to
     blur a megapixel every frame for a decoration nobody can see under the
     fog; and the 'high' resampler is several times the cost of 'medium' at a
     scale factor that is usually close to 1:1 anyway. The drop under the map
     is now three offset rectangles drawn once, which looks the same. */
  ctx.imageSmoothingQuality = 'medium';
  ctx.fillStyle = 'rgba(0,0,0,0.30)';
  ctx.fillRect(dx0 + z * 0.10, dy0 + z * 0.14, dw, dh);
  ctx.fillStyle = 'rgba(0,0,0,0.22)';
  ctx.fillRect(dx0 + z * 0.24, dy0 + z * 0.30, dw, dh);
  /* Blit only the part of the baked world the viewport can see. On a phone
     held at max zoom that is a fifth of the image. */
  var vx0 = clamp(Math.floor(cam.x / z) - 1, 0, W), vy0 = clamp(Math.floor(cam.y / z) - 1, 0, H);
  var vx1 = clamp(Math.ceil((cam.x + VW) / z) + 1, 0, W), vy1 = clamp(Math.ceil((cam.y + VH) / z) + 1, 0, H);
  if (vx1 > vx0 && vy1 > vy0) {
    ctx.drawImage(baked.canvas,
      vx0 * PX, vy0 * PX, (vx1 - vx0) * PX, (vy1 - vy0) * PX,
      vx0 * z - cam.x, vy0 * z - cam.y, (vx1 - vx0) * z, (vy1 - vy0) * z);
  }

  // ── movement affordances, under the fog so they cannot leak terrain ─────
  if (opts.reach) drawReach(ctx, opts, cam, W, H);
  if (opts.path && opts.path.length > 1) drawPath(ctx, opts.path, cam);

  // ── fog ─────────────────────────────────────────────────────────────────
  var tFogStart = now();
  var st = null;
  if (opts.fogState || opts.explored || opts.visible) {
    st = fogAccessor(opts);
    var m = fogMasks(baked, opts, W, H);
    var fw = fogWorld(baked, m, opts.fogKey);
    if (fw && vx1 > vx0 && vy1 > vy0) {
      ctx.drawImage(fw.a, vx0 * PX, vy0 * PX, (vx1 - vx0) * PX, (vy1 - vy0) * PX,
                    vx0 * z - cam.x, vy0 * z - cam.y, (vx1 - vx0) * z, (vy1 - vy0) * z);
      if (fw.unseen) {
        ctx.drawImage(fw.b, vx0 * PX, vy0 * PX, (vx1 - vx0) * PX, (vy1 - vy0) * PX,
                      vx0 * z - cam.x, vy0 * z - cam.y, (vx1 - vx0) * z, (vy1 - vy0) * z);
      }
    }
  }
  var tFog = now();

  // ── region names, over the fog and graded by it ─────────────────────────
  drawLabels(ctx, baked, cam, st);

  // ── camp influence blooms, then actors ──────────────────────────────────
  var actors = opts.actors || [];
  var i;
  for (i = 0; i < actors.length; i++) if (actors[i].kind === 'camp') drawInfluence(ctx, actors[i], cam);
  var sorted = actors.slice().sort(function (p, q) { return p.y - q.y; });
  for (i = 0; i < sorted.length; i++) drawActor(ctx, sorted[i], cam, opts);

  /* ── markers for unclaimed nodes / structures the app wants flagged ──────
     Filtered against the fog here as well as (presumably) by the caller.
     These draw ON TOP of the shroud, so an unfiltered marker is a pin stuck
     through the fog pointing at an extraction node the player has not found;
     the renderer is the last place that can catch it and it costs one test. */
  if (opts.markers) for (i = 0; i < opts.markers.length; i++) {
    var mk = opts.markers[i];
    if (st && !(st(mk.x | 0, mk.y | 0) > 0)) continue;
    drawMarker(ctx, mk, cam);
  }

  // ── cursor ──────────────────────────────────────────────────────────────
  if (opts.hover) drawCursor(ctx, opts.hover.x, opts.hover.y, cam, 'rgba(243,231,200,0.55)', 1.4);
  if (opts.sel) drawCursor(ctx, opts.sel.x, opts.sel.y, cam, 'rgba(243,231,200,0.95)', 2.2);

  // ── frame + vignette + grade ────────────────────────────────────────────
  ctx.strokeStyle = 'rgba(212,175,55,0.34)'; ctx.lineWidth = 2;
  ctx.strokeRect(dx0 - 1, dy0 - 1, dw + 2, dh + 2);
  var vg = ctx.createRadialGradient(VW / 2, VH / 2, Math.min(VW, VH) * 0.30,
                                    VW / 2, VH / 2, Math.max(VW, VH) * 0.80);
  vg.addColorStop(0, 'rgba(0,0,0,0)');
  vg.addColorStop(0.66, 'rgba(4,3,8,0.13)');
  vg.addColorStop(1, 'rgba(3,2,6,0.50)');
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
  /* ── the frontier ────────────────────────────────────────────────────────
     ⚠ ARCS, not edges. The first version stroked the four cell edges that had
     no reachable neighbour, and at high zoom that is a literal staircase — a
     picture of the tile lattice drawn on top of a picture that spends a
     megapixel hiding it. The field above is a union of DISCS, so its real
     visual boundary is a scalloped curve, and tracing that curve instead
     costs the same and has no straight segment and no right angle anywhere
     in it. Each frontier tile contributes only the quadrant of its own disc
     that faces the missing neighbour, so nothing is drawn across the
     interior. */
  var TAU = Math.PI * 2, R = z * 0.615;
  ctx.strokeStyle = 'rgba(226,196,116,0.32)';
  ctx.lineWidth = Math.max(1, z * 0.045); ctx.lineCap = 'round';
  ctx.beginPath();
  for (k = 0; k < list.length; k++) {
    x = list[k][0]; y = list[k][1];
    var cx = (x + 0.5) * z - cam.x, cy = (y + 0.5) * z - cam.y;
    var d7 = R * 0.7071;
    if (!set[x + ',' + (y - 1)]) { ctx.moveTo(cx - d7, cy - d7); ctx.arc(cx, cy, R, -TAU * 0.375, -TAU * 0.125, false); }
    if (!set[(x + 1) + ',' + y]) { ctx.moveTo(cx + d7, cy - d7); ctx.arc(cx, cy, R, -TAU * 0.125, TAU * 0.125, false); }
    if (!set[x + ',' + (y + 1)]) { ctx.moveTo(cx + d7, cy + d7); ctx.arc(cx, cy, R, TAU * 0.125, TAU * 0.375, false); }
    if (!set[(x - 1) + ',' + y]) { ctx.moveTo(cx - d7, cy + d7); ctx.arc(cx, cy, R, TAU * 0.375, TAU * 0.625, false); }
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
/* A hero has to be findable in one glance on a busy painted map, at any zoom,
   which is a different problem from looking good. So: a dark plinth shadow to
   separate it from whatever texture is underneath, a glow in the player's
   colour, a cloak silhouette with a bright rim on the sunward side, and a
   banner. The first version's cloak was a bowtie — the quadratic bulged the
   wrong way and at a distance the hero read as a white X. */
function drawHero(ctx, x, y, z, col, a) {
  var s = z * 0.52;
  ctx.fillStyle = 'rgba(8,6,5,0.50)';
  ctx.beginPath(); ctx.ellipse(x + s * 0.24, y + s * 0.04, s * 0.66, s * 0.22, 0, 0, Math.PI * 2); ctx.fill();
  glow(ctx, x, y - s * 0.72, s * 2.0, 'rgba(' + hex(col).join(',') + ',0.30)');
  // cloak: shoulders in, hem out, straight sides
  ctx.beginPath();
  ctx.moveTo(x - s * 0.24, y - s * 1.05);
  ctx.lineTo(x + s * 0.24, y - s * 1.05);
  ctx.lineTo(x + s * 0.46, y);
  ctx.quadraticCurveTo(x, y + s * 0.10, x - s * 0.46, y);
  ctx.closePath();
  ctx.fillStyle = a.dark ? 'rgb(40,35,48)' : 'rgb(52,45,60)'; ctx.fill();
  // sunward rim
  ctx.beginPath();
  ctx.moveTo(x - s * 0.24, y - s * 1.05);
  ctx.lineTo(x - s * 0.06, y - s * 1.05);
  ctx.lineTo(x - s * 0.16, y + s * 0.02);
  ctx.lineTo(x - s * 0.46, y);
  ctx.closePath();
  ctx.fillStyle = 'rgba(206,196,216,0.50)'; ctx.fill();
  // hood
  ctx.beginPath(); ctx.arc(x, y - s * 1.18, s * 0.24, 0, Math.PI * 2);
  ctx.fillStyle = 'rgb(46,40,52)'; ctx.fill();
  ctx.beginPath(); ctx.arc(x - s * 0.05, y - s * 1.22, s * 0.15, 0, Math.PI * 2);
  ctx.fillStyle = 'rgb(196,172,142)'; ctx.fill();
  banner(ctx, x + s * 0.60, y, s * 1.8, col);
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
  drawLabels: drawLabels,
  tileToScreen: tileToScreen,
  screenToTile: screenToTile,
  fitZoom: fitZoom,
};

})(typeof module !== 'undefined' && module.exports ? module.exports : (typeof window !== 'undefined' ? window : this));
