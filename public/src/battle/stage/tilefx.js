/* ═══════════════════════════════════════════════════════════════════════════
   tilefx.js — TILE STATES AND FIELD SURFACES, painted INSIDE the ground.

   Loaded by the iframe renderer (public/battle-board/index.html) as
   <script type="module" src="../src/battle/stage/tilefx.js">, i.e. served
   same-origin from /src/battle/stage/tilefx.js. It attaches three hooks to
   window.BBX and does nothing else: no imports, no page DOM, no postMessage,
   no mutation of anything the host or the spine owns.

     BBX.tilefx.drawStates(api)      ← called from drawBoard(), UNDER the actors
     BBX.tilefx.drawSurfaces(api)    ← replaces drawSurfaceFx()
     BBX.tilefx.drawStatesOver(api)  ← replaces drawPaintOverSurfaces()

   ── WHAT WAS HERE ORIGINALLY, AND WHY IT IS GONE ──────────────────────────
   The board's own highlight was fill(colour,.3) + stroke(colour,.85) at 2px
   around the FULL perimeter of every lit tile, and each hazard was a painter
   clipped to one square. Three things were wrong with that:
     1. a hard, uniform-width outline is the loudest "this is a drawn grid"
        signal on the board — the exact read the redesign exists to kill;
     2. eight legal move tiles read as eight outlined CELLS, never as one lit
        area, so the eye had to count boxes instead of seeing a shape;
     3. a flat fill clipped to a square TINTS the sand inside a rectangle. Four
        adjacent oil tiles read as four blue-black squares, not as a puddle.

   ── ROUND 2: WHY THE FIRST REWRITE STILL READ AS A STICKER ────────────────
   Round 1 replaced the square with a JITTERED octagon and painted the union of
   a region through ctx.clip(). That fixed contiguous runs — four oil tiles did
   merge into one pool — but it could not fix the case the default board
   actually contains: an ISOLATED single-tile puddle. With n === 1 the union IS
   the tile, so every painter's edge-to-edge wash produced a dark teal octagon
   exactly the size and orientation of the tile, with a rimBand stroked round
   its outline. A decal with chamfered corners is still a decal.

   The root cause is structural: **ctx.clip() has a hard edge, and any wash
   that reaches it inherits it.** No amount of jitter fixes that, because the
   silhouette is still a polygon the size of a tile.

   So the clip is gone. Every surface and every state region is now composited
   through a SOFT ALPHA MASK:

     1. rasterMask() draws the region into an offscreen canvas as the union of
        (tile quad ∪ a smooth organic blob per tile), then BLURS it. The quad
        guarantees interior coverage — without it a 2×2 region gets a pinhole
        where four blobs meet. The blob, whose radius is a 3-harmonic function
        of angle seeded per tile, guarantees the OUTLINE is a curve rather than
        a polygon: no straight segments, no corners, no tile silhouette even
        when the region is one tile.
     2. layer() renders a painter's content into a scratch canvas, applies the
        mask with 'destination-in', and blits the result ONCE with the
        painter's own composite. Blitting once is what makes 'multiply' safe:
        per-tile multiply blobs double-darken every shared edge and redraw the
        grid in hue instead of in strokes, which is the failure the previous
        version's region-wide gradient was working around.
     3. halo() does the same through a DILATED, more heavily blurred mask, so
        damp sand, scorch and spill light follow the pool's own irregular shape
        outwards instead of being a ring stroked round its boundary.
     4. staticLayer() is layer() for anything that is not a function of api.T
        — the material wash, the damp halo, the hue filter under a highlight.
        It masks the content ONCE into its own cached canvas and thereafter
        costs a single blit. This is not a micro-optimisation: masking every
        layer every frame measured 673 ms/frame against a 112 ms board in the
        screenshot harness, i.e. the effect layer cost six times the entire
        rest of the renderer. With the caching, the rect-limited scratch, a
        half-resolution mask and half-resolution animated passes it is ~62 ms
        on the same machine. If you add a painter, get its m/l/s static flags
        right — a wrongly-static layer silently stops animating.

   rimBand() and the old unclipped feather() are both gone. A rim stroke traces
   whatever the region's polygon is, so on a single tile it drew the tile; and
   the source-over feather in the ice painter was, at 1.9 tile radii, a milky
   near-white panel standing above the ground.

   Anything that is genuinely NOT a floor material — flame tongues, gas wisps,
   void motes, rising holy light — is still drawn unclipped on the main canvas
   in post(), because those leave the ground plane. They carry their own
   falloff in every direction (see fire.post) for the same reason: a flame with
   a razor edge is the sticker problem in a different costume.

   ── HARD CONSTRAINTS THIS FILE OBEYS ──────────────────────────────────────
   • canvas-2D only. The board's own TILE SURFACES header records that the
     WebGL surface layer compiled, issued draw calls and produced NO FRAGMENTS
     on real hardware, and behaved differently between machines. Not re-tried.
   • Cost is per LIT or SURFACED region, never a full-board pass. A clean board
     with no paint and no hazards costs three early returns. Masks and static
     layers are cached on (epoch + tile set), LRU-bounded, so a selection that
     is not moving costs exactly two blits a frame.
   • Every painter runs inside its own save()/try/restore(). A leaked
     globalCompositeOperation corrupts everything drawn after it for the rest
     of the frame, and the spine's catch would hide the cause.
   • An unknown fxKey falls through to a neutral wash. It must never throw and
     must never silently render nothing — a hazard the player cannot see is a
     gameplay bug wearing a graphics bug's clothes.
   ═══════════════════════════════════════════════════════════════════════════ */

window.BBX = window.BBX || {};

/* ── state colours ─────────────────────────────────────────────────────────
   Teal for movement range, amber-gold for target/objective, per the reference.

   ⚠ ROUND 2 RECALIBRATION. The previous teal measured (169,178,120) over the
   move region: green highest, BLUE LOWEST. That is mint/yellow-green, it is
   not teal, and worse it collided with `place`, the state that is meant to be
   the green one. Two things caused it:
     • the multiply filter (#9ceeff) barely cut red — 156/255 is a 39% cut on a
       channel the sand is already saturated in, so red survived;
     • the additive pass could not lift blue, because warm sand starts near
       B=123 and the additive alpha was tuned for a much darker ground.
   The fix is to make BOTH halves blue-dominant and to raise the gain:
     `filt` is now a hard cyan (74,200,255) so multiply removes 71% of the red
     and none of the blue, and `core`/`body` are blue-dominant with `k` raising
     the additive gain until B > R survives the vista's warm grade.
   `k` is the per-state gain: attack was measurable (+46R) but a critic could
   not FIND it without a diff, so amber is pushed hard too.
   Do not re-balance these against a single screenshot — the ground swings from
   dark canyon floor to hazed near-white dusk between locations, which is why
   the multiply half exists at all (it bites on bright sand where additive
   cannot, and fades on dark sand where additive takes over). */
const COL = {
  move:   { core: '#7de4ff', body: '#0fa8e0', rim: '#63e2f5', filt: '#4ac8ff', k: 1.55 },
  attack: { core: '#ffe8b0', body: '#ff8c10', rim: '#ffc65c', filt: '#ffd98a', k: 1.60 },
  place:  { core: '#ccffd8', body: '#2fd070', rim: '#8ff0b0', filt: '#adffc4', k: 1.15 },
  swap:   { core: '#e8d4ff', body: '#8a52f0', rim: '#c3a5ff', filt: '#d0b0ff', k: 1.20 },
  sel:    { core: '#fff2cc', body: '#f0bc3c', rim: '#ffe3a2', filt: '#ffe9b0', k: 1.25 },
  hover:  { core: '#fff2e2', body: '#e8c894', rim: '#f5dcae', filt: '#fff2dc', k: 0.85 }
};

/* States sit a hair above the terrain's top face; surfaces sit above states.
   In 2D these lifts do nothing to depth — they exist so the projected quads
   agree with the spine's own _sQuad (tileElev + 0.012) instead of drifting a
   subpixel apart on a raised plateau and leaving a bright seam. */
const LIFT_STATE = 0.006;
const LIFT_SURF  = 0.012;

/* Lattice jitter on the tile QUAD. In round 1 this was the whole boundary and
   the critic asked for it to go to ~0.35; it is deliberately back down now,
   because the quad is no longer the boundary — mkMask()'s blob is, and the
   quad only exists inside the mask to guarantee interior coverage. The jitter
   still earns its place: it keeps the union's straight segments from lining up
   with the terrain's own tile creases where the blur thins out. */
const JIT_SURF  = 0.16;
const JIT_STATE = 0.10;

/* Mask shape parameters, in units of the tile's projected half-width.
   `base`  mean blob radius. 1.0 = the tile's edge midpoint, 1.414 = its corner.
   `amp`   angular irregularity; the blob's radius varies ±amp·1.07 about base.
   `blur`  feather width. This is the ONLY thing that decides how soft the
           material's edge is, and therefore whether it reads as a decal.
   Surfaces spill further and softer than states: a puddle has no edge at all,
   whereas a movement highlight still has to answer "is THIS tile legal?", so
   its mask stays close to the tile it belongs to. */
const MASK_SURF  = { base: 1.44, amp: 0.20, blur: 0.24, halo: 1.28, haloBlur: 0.34 };
const MASK_STATE = { base: 1.20, amp: 0.13, blur: 0.17, halo: 1.26, haloBlur: 0.30 };

/* ── projected-polygon cache ───────────────────────────────────────────────
   The camera is static and the heightfield is baked, so a tile's screen
   polygon only changes on resize or a new map. The epoch includes the summed
   elevation because board:init can swap the heightfield WITHOUT changing
   MAP.id — a stale poly would put every glow one plateau below the terrain. */
let _epoch = '';
const _polys = new Map();

function frameSync(api) {
  let s = 0;
  for (let z = 0; z < api.MAP.rows; z++)
    for (let x = 0; x < api.MAP.cols; x++) s += api.tileElev(x, z);
  const e = api.W + 'x' + api.H + '|' + api.MAP.id + '|' +
            api.MAP.cols + 'x' + api.MAP.rows + '|' + s.toFixed(4);
  if (e !== _epoch) { _epoch = e; _polys.clear(); _masks.clear(); }
}

/* Vertex 0,2,4,6 are the tile corners; 1,3,5,7 are the edge midpoints, so the
   quad is an 8-gon and the lattice midpoints can be displaced independently.

   ⚠ THE WATERTIGHT RULE. Every displacement below is keyed on the LATTICE
   coordinate of the point, never on the tile that happens to be drawing it.
   Tile (x,z)'s bottom edge and tile (x,z+1)'s top edge are the same lattice
   edge and therefore get the same offset, so two adjacent hazard tiles share
   an exact border and the union has no crack in it. Keying on the tile would
   look identical on a single tile and split every pool in half. */
function jitQuad(api, x, z, lift, amp) {
  const key = x + ',' + z + '|' + lift + '|' + amp;
  if (_polys.has(key)) return _polys.get(key);
  const e = api.tileElev(x, z) + lift;
  const j = (i, k, n) => (api.hash(i, k, n) - 0.5) * amp;
  /* corner lattice points are (x,z)..(x+1,z+1); edge midpoints are named by
     the lattice edge they lie on, so both owners resolve the same id */
  const pts = [
    [-0.5 + j(x,     z,     101), -0.5 + j(x,     z,     102)],   /* corner  */
    [ 0.0,                        -0.5 + j(x,     z,     103)],   /* z- edge */
    [ 0.5 + j(x + 1, z,     101), -0.5 + j(x + 1, z,     102)],   /* corner  */
    [ 0.5 + j(x + 1, z,     104),  0.0                       ],   /* x+ edge */
    [ 0.5 + j(x + 1, z + 1, 101),  0.5 + j(x + 1, z + 1, 102)],   /* corner  */
    [ 0.0,                         0.5 + j(x,     z + 1, 103)],   /* z+ edge */
    [-0.5 + j(x,     z + 1, 101),  0.5 + j(x,     z + 1, 102)],   /* corner  */
    [-0.5 + j(x,     z,     104),  0.0                       ]    /* x- edge */
  ];
  const out = [];
  for (let i = 0; i < 8; i++) {
    const w = api.gw(x + pts[i][0], z + pts[i][1], e);
    const p = api.project({ x: w.x, y: w.y, z: w.z });
    if (!p) { _polys.set(key, null); return null; }   /* behind the camera */
    out.push(p);
  }
  _polys.set(key, out);
  return out;
}

/* half-width / half-height of the projected tile, in CSS px, from the four
   corners. The tile is a perspective trapezoid, so "half-width" is the mean of
   the near and far edges — plenty accurate for sizing a gradient and far
   cheaper than a real inverse projection. */
function metrics(q) {
  const cx = (q[0].x + q[2].x + q[4].x + q[6].x) / 4;
  const cy = (q[0].y + q[2].y + q[4].y + q[6].y) / 4;
  const ax = (Math.abs(q[2].x - q[0].x) + Math.abs(q[4].x - q[6].x)) / 4;
  const ay = (Math.abs(q[6].y - q[0].y) + Math.abs(q[4].y - q[2].y)) / 4;
  return { cx, cy, ax: Math.max(3, ax), ay: Math.max(2, ay) };
}

function poly(c, q) {
  c.moveTo(q[0].x, q[0].y);
  for (let i = 1; i < q.length; i++) c.lineTo(q[i].x, q[i].y);
  c.closePath();
}

/* An ellipse-shaped radial gradient without ctx.ellipse + clip gymnastics:
   squash the space, draw a circle gradient, unsquash. */
function radial(c, cx, cy, ax, ay, R, stops, comp) {
  if (!(R > 0)) return;
  c.save();
  if (comp) c.globalCompositeOperation = comp;
  c.translate(cx, cy);
  c.scale(1, Math.max(0.10, ay / ax));
  const g = c.createRadialGradient(0, 0, 0, 0, 0, R);
  for (let i = 0; i < stops.length; i++) g.addColorStop(stops[i][0], stops[i][1]);
  c.fillStyle = g;
  c.fillRect(-R, -R, R * 2, R * 2);
  c.restore();
}

/* ═══════════════════════════════════════════════════════════════════════════
   THE SOFT REGION MASK — the mechanism the whole file now hangs off.
   ═══════════════════════════════════════════════════════════════════════════ */

/* Offscreen surfaces. OffscreenCanvas where the engine has it (no page DOM
   touched at all, which is this module's contract); a detached <canvas> only
   as a fallback — detached, never inserted, so it is still not page DOM. */
function mkCv(w, h) {
  try {
    if (typeof OffscreenCanvas === 'function') return new OffscreenCanvas(w, h);
  } catch (e) {}
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  return cv;
}
function sizeCv(cv, w, h) {
  if (cv.width < w) cv.width = w;
  if (cv.height < h) cv.height = h;
}

/* Two shared scratch surfaces, reused for every region every frame: one for
   the sharp mask silhouette before it is blurred, one for painter content. */
let _shCv = null, _shC = null;   /* sharp silhouette */
let _scCv = null, _scC = null;   /* painter content  */

/* ⚠ CLEAR ONLY THE RECT IN USE. The shared scratch grows to the biggest region
   ever seen; clearing (and 'destination-in'-ing) the WHOLE canvas for a
   one-tile puddle cost ~4× more than the region needed and was most of why the
   first version of this compositor ran at 670 ms/frame in the harness. Stale
   pixels outside the rect are harmless because every blit reads a source rect
   of exactly (0,0,pw,ph). */
function shCtx(pw, ph) {
  if (!_shCv) { _shCv = mkCv(pw, ph); _shC = _shCv.getContext('2d'); }
  sizeCv(_shCv, pw, ph);
  _shC.setTransform(1, 0, 0, 1, 0, 0);
  _shC.globalCompositeOperation = 'source-over';
  _shC.globalAlpha = 1;
  _shC.filter = 'none';
  _shC.clearRect(0, 0, pw, ph);
  return _shC;
}
function scCtx(pw, ph) {
  if (!_scCv) { _scCv = mkCv(pw, ph); _scC = _scCv.getContext('2d'); }
  sizeCv(_scCv, pw, ph);
  _scC.setTransform(1, 0, 0, 1, 0, 0);
  _scC.globalCompositeOperation = 'source-over';
  _scC.globalAlpha = 1;
  _scC.filter = 'none';
  _scC.clearRect(0, 0, pw, ph);
  return _scC;
}

/* THE BLOB. A closed curve whose radius is three angular harmonics seeded per
   tile. This is what stops a one-tile region from being a tile-shaped decal:
   there is not a single straight segment or corner anywhere in it, and two
   neighbouring tiles get different phases so their union is lumpy rather than
   a rounded rectangle. Drawn with quadratic segments through the midpoints of
   26 samples, which is smooth well past the pixel level at this camera. */
function blobPath(c, api, it, base, amp) {
  const m = it.m;
  const sy = Math.max(0.12, m.ay / m.ax);
  const p1 = api.hash(it.x, it.z, 201) * 6.283;
  const p2 = api.hash(it.x, it.z, 202) * 6.283;
  const p3 = api.hash(it.z, it.x, 203) * 6.283;
  const N = 26, px = [], py = [];
  for (let i = 0; i < N; i++) {
    const a = i / N * 6.283185;
    const r = m.ax * base * (1 + amp * (0.55 * Math.sin(3 * a + p1) +
                                        0.32 * Math.sin(5 * a + p2) +
                                        0.20 * Math.sin(8 * a + p3)));
    px.push(m.cx + Math.cos(a) * r);
    py.push(m.cy + Math.sin(a) * r * sy);
  }
  c.beginPath();
  c.moveTo((px[N - 1] + px[0]) / 2, (py[N - 1] + py[0]) / 2);
  for (let i = 0; i < N; i++) {
    const n = (i + 1) % N;
    c.quadraticCurveTo(px[i], py[i], (px[i] + px[n]) / 2, (py[i] + py[n]) / 2);
  }
  c.closePath();
}

/* Rasterise one mask: union of (quad ∪ blob) for every tile, blurred.
   The quad is in there ONLY for coverage — at base 1.20/1.44 the blob dips
   inside the quad's corners often enough that a 2×2 region would otherwise
   show a pinhole where four blobs meet, and a hole in the middle of a pool is
   a far worse artefact than a slightly bumpy outline. */
/* Masks are rendered at HALF the canvas's device resolution. They are a smooth
   blurred alpha field with no detail above a few pixels, so upscaling one on
   the way into 'destination-in' is visually free — and it quarters both the
   rasterisation cost and the memory the cache holds. */
function rasterMask(api, g, base, amp, blurPx, target) {
  const mw = g.mw, mh = g.mh, s = g.mdpr;
  const sh = shCtx(mw, mh);
  sh.setTransform(s, 0, 0, s, -g.x0 * s, -g.y0 * s);
  sh.fillStyle = '#ffffff';
  for (const it of g.list) {
    blobPath(sh, api, it, base, amp);
    sh.fill();
    sh.beginPath(); poly(sh, it.q); sh.fill();
  }
  sizeCv(target.cv, mw, mh);
  const t = target.ctx;
  t.setTransform(1, 0, 0, 1, 0, 0);
  t.globalCompositeOperation = 'source-over';
  t.globalAlpha = 1;
  t.filter = 'none';
  t.clearRect(0, 0, mw, mh);
  /* Blur is applied at BLIT time with an identity transform, so the radius is
     in the mask's own pixels and does not silently change with DPR or a stray
     scale left on the scratch context. */
  t.filter = 'blur(' + Math.max(0.4, blurPx * s).toFixed(2) + 'px)';
  t.drawImage(_shCv, 0, 0, mw, mh, 0, 0, mw, mh);
  t.filter = 'none';
}

/* Masks AND the static layers drawn through them are stable while the region
   and the camera are, so a selection that does not move costs two blits a
   frame. Bounded so a match that cycles through many paint shapes cannot grow
   the cache without limit. */
const _masks = new Map();
const MASK_CACHE_MAX = 12;

function buildMask(api, g, opt, tag) {
  const key = tag + '|' + g.sig;
  let e = _masks.get(key);
  if (e && e.mw === g.mw && e.mh === g.mh && e.x0 === g.x0 && e.y0 === g.y0) {
    /* touch: Map iterates in insertion order, so re-inserting makes eviction
       LRU. Without this the oldest INSERTED entry goes — which on a board with
       more than MASK_CACHE_MAX regions is usually one that is still on screen,
       and it would rebuild a mask every frame forever. */
    _masks.delete(key); _masks.set(key, e);
    g.mask = e.mask; g.halo = e.halo; g.sub = e.sub; return true;
  }
  if (_masks.size >= MASK_CACHE_MAX) {
    const first = _masks.keys().next();
    if (!first.done) _masks.delete(first.value);
  }
  const mask = { cv: mkCv(g.mw, g.mh) }; mask.ctx = mask.cv.getContext('2d');
  const halo = { cv: mkCv(g.mw, g.mh) }; halo.ctx = halo.cv.getContext('2d');
  rasterMask(api, g, opt.base, opt.amp, g.ax * opt.blur, mask);
  rasterMask(api, g, opt.base * opt.halo, opt.amp * 0.85, g.ax * opt.haloBlur, halo);
  e = { mask, halo, sub: new Map(), mw: g.mw, mh: g.mh, x0: g.x0, y0: g.y0 };
  _masks.set(key, e);
  g.mask = mask; g.halo = halo; g.sub = e.sub;
  return true;
}

function blit(api, cv, g, comp, alpha, low) {
  const c = api.ctx;
  c.save();
  c.globalCompositeOperation = comp || 'source-over';
  c.globalAlpha = (alpha == null ? 1 : alpha);
  c.drawImage(cv, 0, 0, low ? g.mw : g.pw, low ? g.mh : g.ph, g.x0, g.y0, g.w, g.h);
  c.restore();
}

/* Render `fn` into the scratch and cut it to the region mask, ready for ONE
   composite. Compositing once is the whole point: it is what lets a 'multiply'
   wash cover a four-tile pool without double-darkening the three shared edges
   into a visible grid.

   `low` renders the content at the MASK's resolution (half the canvas's) and
   upscales on the blit. It is for the per-frame sheen/ripple/flame passes only:
   they are soft, low-contrast and animated, so the resample is invisible, and
   it takes a quarter of the fill. Never use it for the layers that carry hard
   detail — web silk, caltrop spikes, ground fissures — which is why those are
   also the ones marked sStatic and therefore drawn once at full resolution. */
function maskScratch(api, g, fn, useHalo, low) {
  const M = useHalo ? g.halo : g.mask;
  if (!M) return false;
  const w = low ? g.mw : g.pw, h = low ? g.mh : g.ph;
  const s = low ? g.mdpr : g.dpr;
  const sc = scCtx(w, h);
  sc.save();
  sc.beginPath(); sc.rect(0, 0, w, h); sc.clip();
  sc.setTransform(s, 0, 0, s, -g.x0 * s, -g.y0 * s);
  try { fn(sc); } catch (e) {}
  sc.setTransform(1, 0, 0, 1, 0, 0);
  sc.globalAlpha = 1;
  sc.filter = 'none';
  sc.globalCompositeOperation = 'destination-in';
  sc.drawImage(M.cv, 0, 0, g.mw, g.mh, 0, 0, w, h);
  sc.restore();
  return true;
}

function layer(api, g, comp, alpha, fn, useHalo, low) {
  if (maskScratch(api, g, fn, useHalo, low)) blit(api, _scCv, g, comp, alpha, low);
}

/* ⚠ THE CACHED HALF. Most of what this file draws does not move: the material
   wash, the damp halo, the hue filter under a highlight. Only sheen, ripples,
   flame and the highlight's pulse are functions of api.T. Re-masking a static
   layer every frame meant four full-region passes per layer, ~40 layers a
   frame, and a 670 ms frame in the harness. Now a static layer is rendered
   through the mask ONCE into its own canvas and thereafter costs one blit —
   and an animated ALPHA still works, because the blit's globalAlpha is applied
   at composite time. Anything genuinely time-varying still goes through
   layer(). */
function staticLayer(api, g, comp, alpha, key, fn, useHalo) {
  if (!g.sub) { layer(api, g, comp, alpha, fn, useHalo); return; }
  let cv = g.sub.get(key);
  if (!cv) {
    if (!maskScratch(api, g, fn, useHalo)) return;
    cv = mkCv(g.pw, g.ph);
    const cc = cv.getContext('2d');
    cc.drawImage(_scCv, 0, 0, g.pw, g.ph, 0, 0, g.pw, g.ph);
    g.sub.set(key, cv);
  }
  blit(api, cv, g, comp, alpha);
}

/* Flat colour through the DILATED mask, cached. This replaces both the old
   rimBand() (a stroke, which traced whatever polygon the region was — on one
   tile, the tile) and the old unclipped feather() (a radial per border tile,
   which on the ice painter became a milky near-white panel a whole
   tile-and-a-half wide). What survives visually is the part outside the
   material itself: damp sand round a puddle, scorch round a fire, cold round
   ice. The alpha is NOT baked in, so a pulsing heat halo is still one blit. */
function halo(api, g, colour, alpha, comp) {
  staticLayer(api, g, comp || 'multiply', alpha, 'h:' + colour, (c) => {
    c.fillStyle = api.rgba(colour, 1);
    c.fillRect(g.x0, g.y0, g.w, g.h);
  }, true);
}

/* Assemble a region: jittered polygons, per-tile metrics, membership set, the
   padded device-pixel bbox the mask lives in, and a signature for the cache. */
function group(api, tiles, lift, amp, opt) {
  const list = [];
  const set = new Set();
  const sig = [];
  let ax = 0, ay = 0, cx = 0, cy = 0;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const t of tiles) {
    const q = jitQuad(api, t.x, t.z, lift, amp);
    if (!q) continue;
    const m = metrics(q);
    list.push({ x: t.x, z: t.z, q, m });
    set.add(t.x + ',' + t.z);
    sig.push(t.x + ',' + t.z);
    ax += m.ax; ay += m.ay; cx += m.cx; cy += m.cy;
    for (const p of q) {
      if (p.x < x0) x0 = p.x; if (p.x > x1) x1 = p.x;
      if (p.y < y0) y0 = p.y; if (p.y > y1) y1 = p.y;
    }
  }
  const n = list.length;
  if (!n) return null;
  ax /= n; ay /= n; cx /= n; cy /= n;
  /* Pad for the blob's outward reach AND the halo's blur, or the mask gets
     clipped at the canvas edge and the pool ends on a straight line — which
     is the exact artefact this whole mechanism exists to remove. */
  const pad = Math.ceil(ax * (opt.base * opt.halo - 1) + ax * opt.haloBlur * 1.8 + 6);
  x0 = Math.floor(x0 - pad); y0 = Math.floor(y0 - pad);
  x1 = Math.ceil(x1 + pad);  y1 = Math.ceil(y1 + pad);
  const dpr = ctxScale(api);
  const mdpr = Math.max(0.6, dpr * 0.5);
  const g = {
    list, set, n, ax, ay, cx, cy,
    x0, y0, x1, y1, w: x1 - x0, h: y1 - y0, dpr, mdpr,
    pw: Math.max(1, Math.ceil((x1 - x0) * dpr)),
    ph: Math.max(1, Math.ceil((y1 - y0) * dpr)),
    mw: Math.max(1, Math.ceil((x1 - x0) * mdpr)),
    mh: Math.max(1, Math.ceil((y1 - y0) * mdpr)),
    /* ⚠ LIFT IS PART OF THE SIGNATURE. drawStates and drawStatesOver ask for
       the same tiles at two different heights (0.006 vs 0.016), which projects
       to a sub-pixel difference — enough for the floor()/ceil() on the bbox to
       land one pixel apart some of the time. Without the lift in the key the
       two passes fight over one cache entry and rebuild both masks EVERY frame
       on any tile that is both lit and hazardous. */
    sig: _epoch + '#' + lift + '#' + sig.sort().join(' ')
  };
  if (g.w <= 0 || g.h <= 0 || g.pw > 4096 || g.ph > 4096) return null;
  buildMask(api, g, opt, opt === MASK_SURF ? 's' : 'p');
  return g;
}

/* The board's ctx carries the DPR transform (battle-board resize(): W/H are
   CSS px, ctx.setTransform(DPR,0,0,DPR,0,0)). Offscreens must match it or the
   mask lands at half resolution and its own edge turns into the soft artefact.
   getTransform() is the honest source; devicePixelRatio is the fallback and is
   clamped exactly as resize() clamps it. */
function ctxScale(api) {
  try {
    const t = api.ctx.getTransform();
    if (t && isFinite(t.a) && t.a > 0) return Math.min(t.a, 3);
  } catch (e) {}
  return Math.min(window.devicePixelRatio || 1, 2);
}

function fill(c, g) { c.fillRect(g.x0, g.y0, g.w, g.h); }

/* ═══════════════════════════════════════════════════════════════════════════
   A) TILE STATES — one pool of light per region
   ═══════════════════════════════════════════════════════════════════════════ */

/* strength: 1 = the under-ground pass; <1 = the re-assert over a hazard. */
function drawPool(api, tiles, colKey, strength, lift, filtScale) {
  const col = COL[colKey] || COL.move;
  const S = (strength || 1) * col.k;
  const g = group(api, tiles, lift, JIT_STATE, MASK_STATE);
  if (!g) return;

  const glow = 0.200 * S;
  /* ⚠ THE MULTIPLY PASS CARRIES THE HIGHLIGHT, THE ADDITIVE PASS CARRIES THE
     MOOD — and the split is deliberate because the ground under this is not a
     fixed value. The vista's grade and the location's ground art move the
     sand between "dark canyon floor" and "hazed near-white dusk" from match to
     match, and an additive-only highlight measured against one of those is
     invisible on the other. Multiply is the robust half: on bright sand it
     bites (there is plenty of channel to remove), on dark sand it barely
     shows and the 'lighter' pass takes over.

     ⚠ The multiply is CAPPED low on purpose. Round 2's first pass ran it at
     0.58 and the movement pool came out at the same luma as the bare sand —
     a saturated cyan STAIN rather than light rising out of the ground. The
     hue shift was right, the direction was wrong: an emissive highlight has to
     be brighter than what it sits on. So multiply now only does enough to
     stop the sand's red dominating, and the additive pass carries the lift. */
  const filtA = Math.min(0.36, 0.26 * S) * (filtScale == null ? 1 : filtScale);

  /* (1) the hue filter, as ONE region-wide gradient composited once. Per-tile
     'multiply' blobs would double-filter every shared edge and draw the grid
     back in hue instead of in strokes. */
  let rmax = 0;
  for (const it of g.list) {
    rmax = Math.max(rmax, Math.hypot(it.m.cx - g.cx, (it.m.cy - g.cy) * (g.ax / g.ay)) + it.m.ax);
  }
  const R = Math.max(rmax, g.ax * 1.4);
  const tag = colKey + '|' + S.toFixed(3) + '|' + filtA.toFixed(3);
  staticLayer(api, g, 'multiply', 1, 'f' + tag, (c) => {
    radial(c, g.cx, g.cy, g.ax, g.ay, R, [
      [0,    api.rgba(col.filt, filtA)],
      [0.62, api.rgba(col.filt, filtA * 0.88)],
      [1,    api.rgba(col.filt, filtA * 0.66)]
    ]);
  });

  /* (2) the emission: a broad region wash plus per-tile blobs at 1.4× the tile
     so neighbours overlap and SUM. THAT is what makes a contiguous run read as
     one pool — at a shared edge both tiles contribute, so the seam is the
     brightest part of the join instead of a dark gap or a drawn line.

     ⚠ The BREATHING is applied to the blit's alpha, not baked into the
     gradients, so the whole emission is a cached image and one composite. The
     earlier version pulsed each tile at its own hashed phase, which forced a
     full re-mask every frame for a 12% brightness wobble nobody can see. What
     survives per tile is a hashed static brightness offset — the tiles still
     do not read as identical stamps — and the phase is hashed per REGION, so
     the move pool and the attack pool still do not breathe in lockstep.

     It is drawn through the DILATED mask, which is also how the pool's light
     spills past the legal area into the sand — the two separate halo blits
     that used to do that were pure cost for the same picture. */
  const bph = api.hash(g.list[0].x, g.list[0].z, 7) * 6.283;
  const pulse = 1 + Math.sin(api.T * 1.9 + bph) * 0.10;
  staticLayer(api, g, 'lighter', pulse, 'e' + tag, (c) => {
    radial(c, g.cx, g.cy, g.ax, g.ay, R, [
      [0,    api.rgba(col.body, 0.105 * S)],
      [0.55, api.rgba(col.body, 0.068 * S)],
      [1,    api.rgba(col.body, 0)]
    ]);
    for (const it of g.list) {
      const m = it.m;
      const v = 0.90 + api.hash(it.x, it.z, 7) * 0.20;   /* static, per tile */
      /* Wide and soft, NOT tight and hot. A tight blob per tile puts a bright
         bead at every tile centre, and a row of beads is a row of CELLS — the
         same read as the outlines this file deleted, drawn in light instead.
         The region gradient above supplies the centre weighting; these only
         have to make the area continuous. */
      radial(c, m.cx, m.cy, m.ax, m.ay, m.ax * 1.90, [
        [0,    api.rgba(col.core, glow * 1.00 * v)],
        [0.30, api.rgba(col.body, glow * 0.74 * v)],
        [0.62, api.rgba(col.body, glow * 0.34 * v)],
        [1,    api.rgba(col.body, 0)]
      ]);
    }
  }, true);
}

function cells(list) {
  const out = [];
  for (const k of list) {
    const p = String(k).split(','), x = +p[0], z = +p[1];
    if (!isFinite(x) || !isFinite(z)) continue;
    out.push({ x, z });
  }
  return out;
}

/* Collect the four paint sets into draw-ordered regions.
   `only` (a Set of "x,z") restricts to surfaced tiles for the re-assert pass. */
function stateRegions(api, only) {
  const P = api.paint || {};
  const pick = s => {
    if (!s || !s.forEach) return [];
    const out = [];
    s.forEach(k => { if (!only || only.has(k)) out.push(k); });
    return cells(out);
  };
  /* attack last so it wins where a tile is both reachable and a target */
  return [
    ['place',  pick(P.place)],
    ['swap',   pick(P.swap)],
    ['move',   pick(P.move)],
    ['attack', pick(P.attack)]
  ];
}

function drawStates(api) {
  try {
    frameSync(api);
    for (const r of stateRegions(api, null)) {
      if (!r[1].length) continue;
      try { drawPool(api, r[1], r[0], 1, LIFT_STATE); } catch (e) {}
    }
    /* selection: a single warm pool, hotter than a move tile, and no hard 3px
       ring — the old one was the most obviously "drawn" mark on the board
       because it sat on exactly one cell's perimeter. */
    const sel = api.paint && api.paint.sel;
    if (sel && isFinite(sel.x) && isFinite(sel.z)) {
      try { drawPool(api, [{ x: sel.x, z: sel.z }], 'sel', 1.0, LIFT_STATE); } catch (e) {}
    }
    /* hover: barely there. It must not compete with the legal-move pool, or
       the player reads the cursor tile as a fifth game state. */
    const hv = api.hover;
    if (hv && isFinite(hv.x) && isFinite(hv.z)) {
      try { drawPool(api, [{ x: hv.x, z: hv.z }], 'hover', 0.6, LIFT_STATE); } catch (e) {}
    }
  } catch (e) {}
}

/* ═══════════════════════════════════════════════════════════════════════════
   C) THE RE-ASSERT. A hazard composites AFTER drawStates and buries it, which
   made a legal fire/oil tile look unreachable. This pass exists solely to fix
   that and must survive any future reordering of frame(). Same emissive
   treatment at higher strength — never a hard stroke.
   ═══════════════════════════════════════════════════════════════════════════ */
function drawStatesOver(api) {
  try {
    const S = api.surfaces || {};
    const only = new Set();
    for (const k in S) if (S[k]) only.add(k);
    if (!only.size) return;
    frameSync(api);
    for (const r of stateRegions(api, only)) {
      if (!r[1].length) continue;
      /* The hue filter is dialled back to a third on this pass. At full
         strength the teal multiply repaints the flames on a burning tile
         cyan — the tile stays legible, which is the point, but it stops
         looking like fire. The additive half carries the re-assert instead,
         which brightens the hazard without recolouring it. */
      try { drawPool(api, r[1], r[0], 0.85, LIFT_SURF + 0.004, 0.34); } catch (e) {}
    }
  } catch (e) {}
}

/* ═══════════════════════════════════════════════════════════════════════════
   B) FIELD SURFACES

   Each painter is { halo, m, l, s, post }, all optional:

     halo(api, g)      → [[colour, alpha, comp], …]  drawn FIRST through the
                         dilated mask: damp sand, scorch, cold, spill light.
                         Follows the pool's own irregular outline outwards.
     m(api, c, g)      content blitted with 'multiply'   — the material itself
     l(api, c, g)      content blitted with 'lighter'    — sheen, glow, ripples
     s(api, c, g)      content blitted with 'source-over'— solid objects on sand
     post(api, c, g)   unclipped, straight onto the main canvas — anything that
                         leaves the ground plane (flames, wisps, motes)

   m/l/s each get their own single blit, which is what keeps a four-tile pool
   from double-darkening its three shared edges. Inside them, drawing is in CSS
   pixels in the SAME coordinates as the main canvas — g.list[i].m holds the
   per-tile metrics, so a painter reads identically to the old clipped one.
   ═══════════════════════════════════════════════════════════════════════════ */

/* wet sand. Derived from the light's own ambient so it stays right at every
   time of day instead of being a hardcoded brown that only works at noon. */
function dampCol(api) {
  return api.mixHex('#412c15', (api.LIGHT && api.LIGHT.ambient) || '#3a4a6a', 0.22);
}

const PAINTERS = {

  /* ── OIL ── near-black film with a thin-film iridescence that drifts. The
     sand is DARKENED (multiply) rather than covered, so the dune ripples still
     read through the slick — that is the difference between a liquid and a
     black polygon. */
  oil: {
    halo: () => [['#1b1119', 0.34, 'multiply']],
    m(api, c, g) {
      /* centre-weighted, not edge-to-edge: the film is thickest where it
         pooled and thins out on its way to the mask's feather, so the
         material's own shading and the mask's falloff compound. */
      for (const it of g.list) {
        const m = it.m;
        radial(c, m.cx, m.cy, m.ax, m.ay, m.ax * 1.62, [
          [0,    api.rgba('#191019', 0.80)],
          [0.55, api.rgba('#1b1220', 0.62)],
          [1,    api.rgba('#1b1220', 0)]
        ]);
      }
    },
    l(api, c, g) {
      const lv = api.lightVector();
      const sky = (api.LIGHT && api.LIGHT.sky) || ['#7f97b8', '#8fa8c8', '#a8bcd8'];
      const hues = ['#5f3fd0', '#2fa88a', '#c05a2a'];
      for (const it of g.list) {
        const m = it.m, h = n => api.hash(it.x, it.z, n);
        for (let i = 0; i < 3; i++) {          /* thin-film interference lobes */
          const a = h(i) * 6.283 + api.T * (0.10 + i * 0.045);
          radial(c, m.cx + Math.cos(a) * m.ax * 0.34, m.cy + Math.sin(a) * m.ay * 0.34,
                 m.ax, m.ay, m.ax * 1.15, [
            [0, api.rgba(hues[i], 0.19)], [0.6, api.rgba(hues[i], 0.08)], [1, api.rgba(hues[i], 0)]
          ]);
        }
        /* specular: the sky on a flat wet surface, offset toward the light so
           it agrees with the terrain's own key direction */
        radial(c, m.cx - lv.x * m.ax * 0.30, m.cy - m.ay * 0.30, m.ax, m.ay * 0.42, m.ax * 0.9, [
          [0, api.rgba(sky[1], 0.28)], [1, api.rgba(sky[1], 0)]
        ]);
      }
    }
  },

  /* ── GREASE ── the pale cousin: milky, less absorbent, more scatter. */
  grease: {
    lStatic: true,
    halo: () => [['#6e6552', 0.20, 'multiply']],
    m(api, c, g) {
      for (const it of g.list) {
        const m = it.m;
        radial(c, m.cx, m.cy, m.ax, m.ay, m.ax * 1.6, [
          [0, api.rgba('#6e6552', 0.50)], [0.6, api.rgba('#6e6552', 0.34)], [1, api.rgba('#6e6552', 0)]
        ]);
      }
    },
    l(api, c, g) {
      for (const it of g.list) {
        const m = it.m, sy = m.ay / m.ax;
        radial(c, m.cx, m.cy - m.ay * 0.18, m.ax, m.ay, m.ax * 1.25, [
          [0, api.rgba('#e6e0c6', 0.24)], [0.7, api.rgba('#cfc7a6', 0.09)], [1, api.rgba('#cfc7a6', 0)]
        ]);
        for (let i = 0; i < 7; i++) {
          const a = api.hash(it.x, it.z, i) * 6.283;
          const d = api.hash(it.z, it.x, i + 3) * m.ax * 0.72;
          const r = m.ax * (0.05 + api.hash(it.x, it.z, i + 11) * 0.08);
          c.fillStyle = api.rgba('#fff4d0', 0.14);
          c.beginPath();
          c.ellipse(m.cx + Math.cos(a) * d, m.cy + Math.sin(a) * d * sy, r, r * sy, 0, 0, 6.3);
          c.fill();
        }
      }
    }
  },

  /* ── PUDDLE (water) ── darker and COOLER than the sand, with a real
     reflection: the sky gradient is mirrored into the surface, so the pool
     changes with time of day for free. Ripples expand from seeded points per
     tile; the damp halo is the tell that it is soaking into the ground rather
     than sitting on it. */
  puddle: {
    halo: (api) => [[dampCol(api), 0.34, 'multiply'], ['#1c5a72', 0.18, 'multiply']],
    m(api, c, g) {
      for (const it of g.list) {
        const m = it.m;
        /* deepest in the middle, shallow at the rim — a real puddle has a
           depth gradient and that gradient is most of why it reads as liquid
           rather than as a coloured patch. */
        radial(c, m.cx, m.cy, m.ax, m.ay, m.ax * 1.66, [
          [0,    api.rgba('#0d4460', 0.78)],
          [0.46, api.rgba('#12546f', 0.60)],
          [0.78, api.rgba('#1c6076', 0.28)],
          [1,    api.rgba('#1c6076', 0)]
        ]);
      }
    },
    l(api, c, g) {
      /* mirrored sky — brightest at the far (upper) edge, which is where a
         near-grazing reflection actually lands from this camera pitch */
      const sky = (api.LIGHT && api.LIGHT.sky) || ['#5b7fb8', '#7fa0c8', '#a8bcd8'];
      const gr = c.createLinearGradient(0, g.y0, 0, g.y1);
      gr.addColorStop(0, api.rgba(sky[1], 0.40));
      gr.addColorStop(0.6, api.rgba(sky[2] || sky[1], 0.18));
      gr.addColorStop(1, api.rgba(sky[2] || sky[1], 0.05));
      c.fillStyle = gr; fill(c, g);
      for (const it of g.list) {
        const m = it.m, sy = m.ay / m.ax;
        /* A cool lift over the deep part. Without it the multiply pass alone
           leaves warm sand looking simply DARKER — olive, not wet — because
           sand's blue channel is too low for a multiply to make it blue. */
        radial(c, m.cx, m.cy, m.ax, m.ay, m.ax * 1.35, [
          [0, api.rgba('#2fa6d8', 0.20)], [0.6, api.rgba('#2f8ec0', 0.08)], [1, api.rgba('#2f8ec0', 0)]
        ]);
        /* Ripples: several small rings from scattered drop points rather than
           two big concentric ones. The first version used one large ring per
           tile and it read as a sonar sweep painted on the floor — the tell was
           that the ring was centred and as wide as the tile, which nothing in
           moving water ever is. */
        for (let i = 0; i < 5; i++) {
          const ph = (api.T * 0.38 + api.hash(it.x, it.z, i) + i * 0.2) % 1;
          const rr = m.ax * (0.04 + ph * 0.26) * (0.7 + api.hash(it.z, it.x, i + 30) * 0.6);
          c.strokeStyle = api.rgba('#d8eeff', 0.14 * (1 - ph) * (1 - ph));
          c.lineWidth = Math.max(0.7, m.ax * 0.014);
          c.beginPath();
          c.ellipse(m.cx + (api.hash(it.x, it.z, i + 21) - 0.5) * m.ax * 1.0,
                    m.cy + (api.hash(it.z, it.x, i + 22) - 0.5) * m.ay * 1.0,
                    rr, rr * sy, 0, 0, 6.3);
          c.stroke();
        }
        const gx = m.cx + Math.sin(api.T * 0.5 + api.hash(it.x, it.z, 5) * 6.2) * m.ax * 0.35;
        radial(c, gx, m.cy - m.ay * 0.22, m.ax, m.ay * 0.36, m.ax * 0.6, [
          [0, api.rgba('#ffffff', 0.26)], [1, api.rgba('#bcd8ff', 0)]
        ]);
      }
    }
  },

  /* ── FIRE ── the surrounding sand is WARMED and the ground under it is
     scorched; the flames themselves are drawn unclipped in post(), because a
     flame that ends in a straight line at the tile boundary is the sticker
     read again. */
  fire: {
    halo: (api) => {
      const fl = 0.86 + Math.sin(api.T * 6.1) * 0.14;
      return [['#241408', 0.34, 'multiply'], ['#ff7a14', 0.20 * fl, 'lighter']];
    },
    m(api, c, g) {
      for (const it of g.list) {                /* scorched ground under it */
        const m = it.m;
        radial(c, m.cx, m.cy, m.ax, m.ay, m.ax * 1.55, [
          [0, api.rgba('#241408', 0.62)], [0.6, api.rgba('#2a1809', 0.34)], [1, api.rgba('#2a1809', 0)]
        ]);
      }
    },
    l(api, c, g) {
      for (const it of g.list) {
        const m = it.m;
        const fl = 0.85 + 0.15 * Math.sin(api.T * 11 + it.x * 3 + it.z);
        radial(c, m.cx, m.cy, m.ax, m.ay, m.ax * 1.34, [
          [0,    api.rgba('#ffe9a8', 0.82 * fl)],
          [0.35, api.rgba('#ff9a24', 0.56 * fl)],
          [1,    api.rgba('#8c1400', 0)]
        ]);
      }
    },
    post(api, c, g) {
      c.save();
      c.globalCompositeOperation = 'lighter';
      for (const it of g.list) {
        const m = it.m;
        for (let i = 0; i < 8; i++) {
          const h = api.hash(it.x, it.z, i);
          const fx = m.cx + (h - 0.5) * m.ax * 1.30;
          const fy = m.cy + (api.hash(it.z, it.x, i + 4) - 0.5) * m.ay * 0.9;
          const hgt = m.ax * (1.05 + h * 1.05) * (0.78 + 0.34 * Math.sin(api.T * 8.5 + i * 2.1 + h * 6));
          const wob = Math.sin(api.T * 5.3 + i * 1.7) * m.ax * 0.16;
          /* ⚠ NOT a filled triangle. The previous tongue was a quadratic path
             with a base-to-tip linear gradient, which meant its SIDES were
             hard: solid yellow up to the edge, nothing past it. Six of those
             per tile read as clip-art flames. A flame has no edge in any
             direction, so the tongue is now a chain of soft blobs riding the
             spine, each falling to zero laterally as well as vertically. */
          const N = 11;
          for (let s = 0; s < N; s++) {
            const t = s / (N - 1);
            const sx = fx + wob * t * 1.6 * (1 + t);
            const sy = fy + m.ay * 0.10 - hgt * t;
            const rad = m.ax * (0.21 - 0.175 * t * t) * (0.82 + h * 0.45);
            const a = 0.30 * (1 - t * 0.92) * (1 - t * 0.30);
            if (rad <= 0.5 || a <= 0.004) continue;
            const col = t < 0.35 ? '#ff7a10' : (t < 0.7 ? '#ffb63a' : '#ffe6a0');
            radial(c, sx, sy, rad, rad, rad, [
              [0, api.rgba(col, a)], [0.5, api.rgba(col, a * 0.45)], [1, api.rgba(col, 0)]
            ]);
          }
        }
        for (let i = 0; i < 4; i++) {          /* embers riding the column */
          const ph = (api.T * 0.5 + api.hash(it.x, it.z, i + 30)) % 1;
          const ex = m.cx + (api.hash(it.z, it.x, i + 31) - 0.5) * m.ax * 1.1
                          + Math.sin(api.T * 3 + i) * m.ax * 0.1;
          const ey = m.cy - ph * m.ax * 1.9;
          const er = Math.max(0.8, m.ax * 0.030);
          radial(c, ex, ey, er, er, er * 2.2, [
            [0, api.rgba('#ffcf7a', 0.55 * (1 - ph))], [1, api.rgba('#ff9a30', 0)]
          ]);
        }
      }
      c.restore();
    }
  },

  /* ── GAS (toxin + steam) ── a cloud, not a floor. Kept low-contrast and
     translucent so the unit standing in it is never lost. */
  gas: {
    halo: () => [['#7a9a2c', 0.10, 'lighter']],
    l(api, c, g) {
      for (const it of g.list) {
        const m = it.m;
        radial(c, m.cx, m.cy, m.ax, m.ay, m.ax * 1.5, [
          [0, api.rgba('#5a7a20', 0.20)], [1, api.rgba('#5a7a20', 0)]
        ]);
        for (let i = 0; i < 3; i++) {
          const a = api.T * 0.42 * (i % 2 ? 1 : -1) + i * 2.1 + api.hash(it.x, it.z, i) * 6;
          radial(c, m.cx + Math.cos(a) * m.ax * 0.38, m.cy + Math.sin(a) * m.ay * 0.34,
                 m.ax, m.ay, m.ax * 1.0, [
            [0, api.rgba('#a8d03c', 0.30)], [1, api.rgba('#506e14', 0)]
          ]);
        }
      }
    },
    post(api, c, g) {
      c.save(); c.globalCompositeOperation = 'lighter';
      for (const it of g.list) {
        const m = it.m;
        for (let i = 0; i < 3; i++) {
          const ph = (api.T * 0.22 + api.hash(it.x, it.z, i + 12)) % 1;
          const wx = m.cx + (api.hash(it.z, it.x, i + 13) - 0.5) * m.ax
                          + Math.sin(api.T * 0.9 + i * 2) * m.ax * 0.18;
          radial(c, wx, m.cy - ph * m.ax * 1.3, m.ax, m.ax * 0.7, m.ax * (0.35 + ph * 0.5), [
            [0, api.rgba('#b6d84a', 0.13 * (1 - ph))], [1, api.rgba('#7ea82a', 0)]
          ]);
        }
      }
      c.restore();
    }
  },

  /* ── WEB ── silk sits ON the sand, so every strand gets a dark offset twin
     first. Without that shadow the strands look painted into the ground. */
  web: {
    sStatic: true,
    s(api, c, g) {
      const lv = api.lightVector();
      for (const it of g.list) {
        const m = it.m, sy = m.ay / m.ax;
        const strands = (col, alpha, dx, dy, lw) => {
          c.strokeStyle = api.rgba(col, alpha);
          c.lineWidth = Math.max(0.8, m.ax * lw);
          for (let i = 0; i < 7; i++) {
            const a = i / 7 * 6.283 + api.hash(it.x, it.z, 1) * 1.2;
            c.beginPath();
            c.moveTo(m.cx + dx, m.cy + dy);
            c.lineTo(m.cx + dx + Math.cos(a) * m.ax * 1.2, m.cy + dy + Math.sin(a) * m.ay * 1.2);
            c.stroke();
          }
          for (let ring = 1; ring <= 3; ring++) {
            c.beginPath();
            for (let i = 0; i <= 14; i++) {
              const a = i / 14 * 6.283 + api.hash(it.x, it.z, 1) * 1.2;
              const rr = m.ax * (ring / 3.1) * (1 + 0.10 * Math.sin(a * 3.5 + it.x));
              const px = m.cx + dx + Math.cos(a) * rr, py = m.cy + dy + Math.sin(a) * rr * sy;
              i ? c.lineTo(px, py) : c.moveTo(px, py);
            }
            c.stroke();
          }
        };
        strands('#171208', 0.30, -lv.x * m.ax * 0.05, m.ay * 0.06, 0.030);  /* contact shadow */
        strands('#e8ecf5', 0.55, 0, 0, 0.024);                             /* silk */
        for (let i = 0; i < 5; i++) {                                      /* dew */
          const a = api.hash(it.x, it.z, i + 40) * 6.283;
          const d = api.hash(it.z, it.x, i + 41) * m.ax * 0.9;
          c.fillStyle = api.rgba('#ffffff', 0.42);
          c.beginPath();
          c.arc(m.cx + Math.cos(a) * d, m.cy + Math.sin(a) * d * sy, Math.max(0.7, m.ax * 0.022), 0, 6.3);
          c.fill();
        }
      }
    }
  },

  /* ── CALTROPS ── objects, not a material: no wash at all, just iron on sand
     with a lit edge, a dark body and a contact shadow each. */
  caltrops: {
    sStatic: true,
    s(api, c, g) {
      const lv = api.lightVector();
      for (const it of g.list) {
        const m = it.m, sy = m.ay / m.ax;
        for (let i = 0; i < 9; i++) {
          const a = api.hash(it.x, it.z, i) * 6.283;
          const d = Math.sqrt(api.hash(it.z, it.x, i + 5)) * m.ax * 0.82;
          const px = m.cx + Math.cos(a) * d, py = m.cy + Math.sin(a) * d * sy;
          const s = m.ax * (0.10 + api.hash(it.x, it.z, i + 9) * 0.06);
          c.fillStyle = api.rgba('#1d1409', 0.34);
          c.beginPath();
          c.ellipse(px - lv.x * s * 0.7, py + s * 0.42, s * 0.85, s * 0.34, 0, 0, 6.3);
          c.fill();
          c.save(); c.translate(px, py); c.rotate(api.hash(it.z, it.x, i + 17) * 3.14);
          c.fillStyle = api.rgba('#3a3630', 0.95);
          c.beginPath();
          for (let k = 0; k < 4; k++) {
            const aa = k * 1.5708;
            c.lineTo(Math.cos(aa) * s, Math.sin(aa) * s * 0.62);
            c.lineTo(Math.cos(aa + 0.785) * s * 0.24, Math.sin(aa + 0.785) * s * 0.16);
          }
          c.closePath(); c.fill();
          c.strokeStyle = api.rgba('#c9c2b2', 0.5);
          c.lineWidth = Math.max(0.6, s * 0.10);
          c.stroke();
          c.restore();
        }
      }
    }
  },

  /* ── ICE ── a translucent slab.
     ⚠ The round-1 version opened with an unclipped source-over feather at 1.9
     tile radii, which was the only source-over unclipped paint in the file and
     rendered as a large milky near-white PANEL hanging above the ground — the
     single worst artefact the critic found. It is gone. The cold now arrives
     as a faint blue 'multiply' halo (frost cools the sand it creeps over) plus
     a low 'lighter' sheen, both through the dilated mask, so nothing extends
     past the pool's own irregular outline. */
  ice: {
    sStatic: true,
    halo: () => [['#8fb6cc', 0.16, 'multiply'], ['#c8e4f4', 0.11, 'lighter']],
    s(api, c, g) {
      for (const it of g.list) {                /* the slab itself */
        const m = it.m;
        radial(c, m.cx, m.cy, m.ax, m.ay, m.ax * 1.62, [
          [0,    api.rgba('#c2e4f8', 0.60)],
          [0.55, api.rgba('#a6d2ea', 0.44)],
          [1,    api.rgba('#9cc8e2', 0)]
        ]);
        /* ⚠ Fracture lines were 3 steps of 0.40 tile at 40% white, which at
           this camera is a 1.2-tile-long bright white STICK. Six of those per
           tile read as scratches lying on the sand, not as ice. Short, dim,
           and hairline is the whole difference. */
        c.strokeStyle = api.rgba('#e8f6ff', 0.20);
        c.lineWidth = Math.max(0.6, m.ax * 0.016);
        for (let i = 0; i < 4; i++) {
          const a = api.hash(it.x, it.z, i) * 6.283;
          let px = m.cx + (api.hash(it.z, it.x, i + 80) - 0.5) * m.ax * 0.5;
          let py = m.cy + (api.hash(it.x, it.z, i + 81) - 0.5) * m.ay * 0.5;
          c.beginPath(); c.moveTo(px, py);
          for (let s = 1; s <= 3; s++) {
            px += Math.cos(a + (api.hash(it.x, it.z, i * 3 + s) - 0.5)) * m.ax * 0.20;
            py += Math.sin(a + (api.hash(it.z, it.x, i * 3 + s) - 0.5)) * m.ay * 0.20;
            c.lineTo(px, py);
          }
          c.stroke();
        }
      }
    },
    l(api, c, g) {
      for (const it of g.list) {
        const m = it.m;
        const tw = 0.5 + 0.5 * Math.sin(api.T * 2.4 + it.x + it.z * 2);
        /* the sheen: a broad grazing reflection off a flat frozen surface,
           weighted to the far half where this camera pitch would catch it */
        radial(c, m.cx + m.ax * 0.18, m.cy - m.ay * 0.30, m.ax, m.ay * 0.42, m.ax * 1.05, [
          [0, api.rgba('#eaf8ff', 0.34 + 0.12 * tw)],
          [0.6, api.rgba('#cfe8ff', 0.08)],
          [1, api.rgba('#cfe8ff', 0)]
        ]);
        for (let i = 0; i < 6; i++) {           /* frost bloom, not spurs */
          const a = api.hash(it.x, it.z, i + 60) * 6.283;
          const d = m.ax * (0.35 + api.hash(it.z, it.x, i + 61) * 0.55);
          const r = m.ax * (0.10 + api.hash(it.x, it.z, i + 62) * 0.10);
          radial(c, m.cx + Math.cos(a) * d, m.cy + Math.sin(a) * d * (m.ay / m.ax),
                 r, r * (m.ay / m.ax), r * 2.2, [
            [0, api.rgba('#f2fbff', 0.16)], [1, api.rgba('#cfe8ff', 0)]
          ]);
        }
      }
    }
  },

  /* ── BLOOD ── absorbed at the edge, glossy in the middle. */
  blood: {
    lStatic: true,
    halo: () => [['#3a1a12', 0.34, 'multiply']],
    m(api, c, g) {
      for (const it of g.list) {
        const m = it.m, sy = m.ay / m.ax;
        radial(c, m.cx, m.cy, m.ax, m.ay, m.ax * 1.6, [
          [0, api.rgba('#5a1014', 0.72)], [0.55, api.rgba('#5a1014', 0.52)], [1, api.rgba('#5a1014', 0)]
        ]);
        for (let i = 0; i < 4; i++) {           /* darker clots */
          const a = api.hash(it.x, it.z, i) * 6.283, d = api.hash(it.z, it.x, i + 2) * m.ax * 0.6;
          radial(c, m.cx + Math.cos(a) * d, m.cy + Math.sin(a) * d * sy, m.ax, m.ay,
                 m.ax * (0.25 + api.hash(it.x, it.z, i + 6) * 0.3), [
            [0, api.rgba('#2c0508', 0.5)], [1, api.rgba('#2c0508', 0)]
          ]);
        }
      }
    },
    l(api, c, g) {
      for (const it of g.list) {
        const m = it.m;
        radial(c, m.cx - m.ax * 0.16, m.cy - m.ay * 0.22, m.ax, m.ay * 0.44, m.ax * 0.66, [
          [0, api.rgba('#ff9a8a', 0.20)], [1, api.rgba('#c04030', 0)]
        ]);
      }
    }
  },

  /* ── VOID (rift) ── a hole. Deliberately NOT pure black: the BAR forbids it,
     and a true 0,0,0 hole reads as a rendering failure rather than as depth. */
  void: {
    halo: () => [['#1a1030', 0.34, 'multiply']],
    m(api, c, g) {
      for (const it of g.list) {
        const m = it.m;
        radial(c, m.cx, m.cy, m.ax, m.ay, m.ax * 1.55, [
          [0, api.rgba('#120b1e', 0.88)], [0.5, api.rgba('#150e24', 0.66)], [1, api.rgba('#150e24', 0)]
        ]);
      }
    },
    l(api, c, g) {
      for (const it of g.list) {
        const m = it.m, sy = m.ay / m.ax;
        for (let i = 0; i < 3; i++) {
          const a0 = api.T * (0.5 + i * 0.2) + i * 2.1;
          c.strokeStyle = api.rgba(i % 2 ? '#a35cff' : '#4fd0ff', 0.30);
          c.lineWidth = Math.max(1, m.ax * 0.045);
          c.beginPath();
          for (let k = 0; k <= 22; k++) {
            const a = a0 + k * 0.30, rr = m.ax * (0.14 + k * 0.038);
            const px = m.cx + Math.cos(a) * rr, py = m.cy + Math.sin(a) * rr * sy;
            k ? c.lineTo(px, py) : c.moveTo(px, py);
          }
          c.stroke();
        }
      }
    }
  },

  /* ── TOXIC (acid) ── hissing, pale etched sheen, bubbles that pop. */
  toxic: {
    halo: () => [['#4b5a12', 0.26, 'multiply'], ['#9ec81e', 0.07, 'lighter']],
    m(api, c, g) {
      for (const it of g.list) {
        const m = it.m;
        radial(c, m.cx, m.cy, m.ax, m.ay, m.ax * 1.6, [
          [0, api.rgba('#4b5a12', 0.62)], [0.6, api.rgba('#4b5a12', 0.42)], [1, api.rgba('#4b5a12', 0)]
        ]);
      }
    },
    l(api, c, g) {
      for (const it of g.list) {
        const m = it.m, sy = m.ay / m.ax;
        radial(c, m.cx, m.cy, m.ax, m.ay, m.ax * 1.4, [
          [0, api.rgba('#9ec81e', 0.22)], [1, api.rgba('#9ec81e', 0)]
        ]);
        for (let i = 0; i < 6; i++) {
          const cyc = (api.T * 0.8 + api.hash(it.x, it.z, i)) % 1;
          const a = api.hash(it.z, it.x, i) * 6.283, d = api.hash(it.x, it.z, i + 3) * m.ax * 0.75;
          const px = m.cx + Math.cos(a) * d, py = m.cy + Math.sin(a) * d * sy;
          const r = m.ax * (0.05 + 0.10 * cyc);
          c.beginPath(); c.ellipse(px, py, r, r * sy, 0, 0, 6.3);
          c.fillStyle = api.rgba('#c8ec4a', 0.16 * (1 - cyc)); c.fill();
          c.strokeStyle = api.rgba('#e8ff9a', 0.36 * (1 - cyc));
          c.lineWidth = Math.max(0.7, m.ax * 0.022);
          c.stroke();
        }
      }
    }
  },

  /* ── MIRE (poison) ── matte wet mud. Almost no specular: that is what
     separates it from the acid pool at a glance. */
  mire: {
    halo: () => [['#241c10', 0.32, 'multiply']],
    m(api, c, g) {
      for (const it of g.list) {
        const m = it.m, sy = m.ay / m.ax;
        radial(c, m.cx, m.cy, m.ax, m.ay, m.ax * 1.6, [
          [0, api.rgba('#33361a', 0.70)], [0.6, api.rgba('#33361a', 0.48)], [1, api.rgba('#33361a', 0)]
        ]);
        for (let i = 0; i < 5; i++) {           /* mud swirls */
          const a = api.hash(it.x, it.z, i) * 6.283, d = api.hash(it.z, it.x, i + 4) * m.ax * 0.7;
          radial(c, m.cx + Math.cos(a) * d, m.cy + Math.sin(a) * d * sy, m.ax, m.ay, m.ax * 0.5, [
            [0, api.rgba('#1a1c0c', 0.42)], [1, api.rgba('#1a1c0c', 0)]
          ]);
        }
      }
    },
    s(api, c, g) {
      for (const it of g.list) {
        const m = it.m, sy = m.ay / m.ax;
        for (let i = 0; i < 3; i++) {           /* slow domed bubbles */
          const cyc = (api.T * 0.32 + api.hash(it.x, it.z, i + 8)) % 1;
          const a = api.hash(it.z, it.x, i + 9) * 6.283, d = api.hash(it.x, it.z, i + 10) * m.ax * 0.55;
          const r = m.ax * 0.09 * Math.sin(cyc * 3.14);
          if (r <= 0.4) continue;
          c.fillStyle = api.rgba('#6d7a34', 0.5);
          c.beginPath();
          c.ellipse(m.cx + Math.cos(a) * d, m.cy + Math.sin(a) * d * sy, r, r * sy, 0, 0, 6.3);
          c.fill();
        }
      }
    }
  },

  /* ── ELECTRIC ── a wet conductive patch with arcs skittering over it. */
  electric: {
    halo: (api) => [['#1a2440', 0.26, 'multiply'],
                    ['#5a9cff', 0.10 * (0.6 + 0.4 * Math.sin(api.T * 9.3)), 'lighter']],
    m(api, c, g) {
      for (const it of g.list) {
        const m = it.m;
        radial(c, m.cx, m.cy, m.ax, m.ay, m.ax * 1.6, [
          [0, api.rgba('#1a2440', 0.56)], [0.6, api.rgba('#1a2440', 0.38)], [1, api.rgba('#1a2440', 0)]
        ]);
      }
    },
    l(api, c, g) {
      const seed = Math.floor(api.T * 7);
      for (const it of g.list) {
        const m = it.m;
        c.save();
        c.strokeStyle = api.rgba('#bcdcff', 0.90);
        c.lineWidth = Math.max(0.9, m.ax * 0.035);
        c.shadowColor = api.rgba('#78b4ff', 0.9); c.shadowBlur = m.ax * 0.22;
        for (let b = 0; b < 2; b++) {
          const a = api.hash(it.x + seed, it.z, b) * 6.283;
          let px = m.cx - Math.cos(a) * m.ax * 0.9, py = m.cy - Math.sin(a) * m.ay * 0.9;
          c.beginPath(); c.moveTo(px, py);
          for (let s = 0; s < 5; s++) {
            px += Math.cos(a) * m.ax * 0.38 + (api.hash(it.z + seed, it.x, b * 5 + s) - 0.5) * m.ax * 0.5;
            py += Math.sin(a) * m.ay * 0.38 + (api.hash(it.x + seed, it.z, b * 7 + s) - 0.5) * m.ay * 0.5;
            c.lineTo(px, py);
          }
          c.stroke();
        }
        c.restore();
      }
    }
  },

  /* ── HOLY ── consecrated ground: the sand is BRIGHTENED, never covered with
     an opaque plate, and the light rises off it. No outline anywhere. */
  holy: {
    halo: (api) => [['#ffd98a', 0.14 * (0.9 + Math.sin(api.T * 1.3) * 0.1), 'lighter']],
    l(api, c, g) {
      for (const it of g.list) {
        const m = it.m, sy = m.ay / m.ax;
        radial(c, m.cx, m.cy, m.ax, m.ay, m.ax * 1.6, [
          [0, api.rgba('#ffe6b0', 0.26)], [0.55, api.rgba('#ffdc94', 0.13)], [1, api.rgba('#ffd070', 0)]
        ]);
        for (let i = 0; i < 3; i++) {
          const ph = (api.T * 0.28 + api.hash(it.x, it.z, i) + i / 3) % 1;
          const rr = m.ax * (0.15 + ph * 0.95);
          c.strokeStyle = api.rgba('#fff2cc', 0.20 * (1 - ph));
          c.lineWidth = Math.max(0.8, m.ax * 0.03);
          c.beginPath(); c.ellipse(m.cx, m.cy, rr, rr * sy, 0, 0, 6.3); c.stroke();
        }
      }
    },
    post(api, c, g) {
      c.save(); c.globalCompositeOperation = 'lighter';
      for (const it of g.list) {
        const m = it.m;
        for (let i = 0; i < 5; i++) {
          const ph = (api.T * 0.24 + api.hash(it.x, it.z, i + 50)) % 1;
          const px = m.cx + (api.hash(it.z, it.x, i + 51) - 0.5) * m.ax * 1.2;
          const r = Math.max(0.7, m.ax * 0.026);
          radial(c, px, m.cy - ph * m.ax * 1.5, r, r, r * 2.4, [
            [0, api.rgba('#fff0c8', 0.45 * (1 - ph) * ph * 3)], [1, api.rgba('#ffe0a0', 0)]
          ]);
        }
      }
      c.restore();
    }
  },

  /* ── CRACK (cracked earth) ── DRY. The board's original painter lit these
     with orange magma, which made "unstable footing" read as a lava tile — a
     different hazard entirely. Now it is fractured ground: dark fissures with
     a pale lit lip on the light-facing side, and displaced grit around them.
     No wash at all, so the sand's own material still shows: that is the point
     of the hazard. */
  crack: {
    sStatic: true,
    s(api, c, g) {
      const lv = api.lightVector();
      for (const it of g.list) {
        const m = it.m, sy = m.ay / m.ax;
        const branch = (col, alpha, lw, dx, dy) => {
          c.strokeStyle = api.rgba(col, alpha);
          c.lineWidth = Math.max(0.7, m.ax * lw);
          c.lineCap = 'round';
          for (let i = 0; i < 4; i++) {
            const a = api.hash(it.x, it.z, i) * 6.283;
            let px = m.cx + dx, py = m.cy + dy;
            c.beginPath(); c.moveTo(px, py);
            for (let s = 0; s < 4; s++) {
              px += Math.cos(a + (api.hash(it.z, it.x, i * 4 + s) - 0.5) * 1.5) * m.ax * 0.34;
              py += Math.sin(a + (api.hash(it.x, it.z, i * 4 + s) - 0.5) * 1.5) * m.ay * 0.34;
              c.lineTo(px, py);
            }
            c.stroke();
          }
        };
        branch(api.mixHex('#c9b78c', (api.LIGHT && api.LIGHT.key) || '#ffd9a0', 0.35), 0.30, 0.055,
               -lv.x * m.ax * 0.04, -m.ay * 0.04);   /* lit lip */
        branch('#241a10', 0.62, 0.042, 0, 0);        /* the fissure itself */
        for (let i = 0; i < 10; i++) {               /* displaced grit */
          const a = api.hash(it.x, it.z, i + 70) * 6.283;
          const d = api.hash(it.z, it.x, i + 71) * m.ax * 0.85;
          c.fillStyle = api.rgba('#2a2015', 0.30);
          c.beginPath();
          c.arc(m.cx + Math.cos(a) * d, m.cy + Math.sin(a) * d * sy, Math.max(0.6, m.ax * 0.020), 0, 6.3);
          c.fill();
        }
      }
    }
  },

  /* ── FALL-THROUGH ── a hazard key the board has never heard of. A neutral
     wash plus a sheen: unmistakably "something is on this tile", legible on
     sand, and it can never throw. Rendering NOTHING here would hide a real
     game mechanic; that is the failure mode this branch exists to prevent. */
  _neutral: {
    lStatic: true,
    halo: (api) => [[dampCol(api), 0.24, 'multiply']],
    m(api, c, g) {
      for (const it of g.list) {
        const m = it.m;
        radial(c, m.cx, m.cy, m.ax, m.ay, m.ax * 1.6, [
          [0, api.rgba('#3d4152', 0.58)], [0.6, api.rgba('#3d4152', 0.38)], [1, api.rgba('#3d4152', 0)]
        ]);
      }
    },
    l(api, c, g) {
      for (const it of g.list) {
        const m = it.m;
        radial(c, m.cx, m.cy - m.ay * 0.15, m.ax, m.ay, m.ax * 1.15, [
          [0, api.rgba('#c8d2e6', 0.17)], [1, api.rgba('#c8d2e6', 0)]
        ]);
      }
    }
  }
};

function drawSurfaces(api) {
  try {
    const S = api.surfaces || {};
    let any = false;
    for (const k in S) { if (S[k]) { any = true; break; } }
    if (!any) return;                          /* clean board costs one loop */
    frameSync(api);

    /* group by fx key so a run of the same hazard shares one mask and blends */
    const byKey = new Map();
    for (const k in S) {
      const fx = S[k];
      if (!fx) continue;
      const p = k.split(','), x = +p[0], z = +p[1];
      if (!isFinite(x) || !isFinite(z)) continue;
      let a = byKey.get(fx);
      if (!a) { a = []; byKey.set(fx, a); }
      a.push({ x, z });
    }

    const c = api.ctx;
    byKey.forEach((tiles, fx) => {
      const P = PAINTERS[fx] || PAINTERS._neutral;
      let g = null;
      try { g = group(api, tiles, LIFT_SURF, JIT_SURF, MASK_SURF); } catch (e) {}
      if (!g) return;

      /* 1. the outward spill, through the dilated mask */
      if (P.halo) {
        try {
          const hs = P.halo(api, g) || [];
          for (const h of hs) if (h && h[1] > 0.002) halo(api, g, h[0], h[1], h[2]);
        } catch (e) {}
      }
      /* 2. the material, one masked blit per composite mode. Every `m` layer
         in the table is time-invariant, so it is always cached; `s`/`l` opt in
         with sStatic/lStatic. Getting this wrong is only a performance bug —
         a layer wrongly marked static freezes its animation, which is why the
         flags sit next to the painter that owns them. */
      if (P.m) { try { staticLayer(api, g, 'multiply', 1, 'm', cc => P.m(api, cc, g)); } catch (e) {} }
      if (P.s) { try {
        if (P.sStatic) staticLayer(api, g, 'source-over', 1, 's', cc => P.s(api, cc, g));
        else           layer(api, g, 'source-over', 1, cc => P.s(api, cc, g));
      } catch (e) {} }
      if (P.l) { try {
        if (P.lStatic) staticLayer(api, g, 'lighter', 1, 'l', cc => P.l(api, cc, g));
        else           layer(api, g, 'lighter', 1, cc => P.l(api, cc, g), false, true);
      } catch (e) {} }
      /* 3. unclipped overlay — flames, wisps, motes: things that leave the
         ground plane and must not be sliced at any boundary */
      if (P.post) { c.save(); try { P.post(api, c, g); } catch (e) {} c.restore(); }
    });
  } catch (e) {}
}

window.BBX.tilefx = { drawStates, drawSurfaces, drawStatesOver };
