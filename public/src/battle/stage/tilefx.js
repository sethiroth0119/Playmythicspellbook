/* ═══════════════════════════════════════════════════════════════════════════
   tilefx.js — TILE STATES AND FIELD SURFACES, painted INSIDE the ground.

   Loaded by the iframe renderer (public/battle-board/index.html) as
   <script type="module" src="../src/battle/stage/tilefx.js">, i.e. served
   same-origin from /src/battle/stage/tilefx.js. It attaches three hooks to
   window.BBX and does nothing else: no imports, no DOM, no postMessage, no
   mutation of anything the host or the spine owns.

     BBX.tilefx.drawStates(api)      ← called from drawBoard(), UNDER the actors
     BBX.tilefx.drawSurfaces(api)    ← replaces drawSurfaceFx()
     BBX.tilefx.drawStatesOver(api)  ← replaces drawPaintOverSurfaces()

   ── WHAT WAS HERE BEFORE, AND WHY IT IS GONE ──────────────────────────────
   The old highlight was fill(colour,.3) + stroke(colour,.85) at 2px around the
   FULL perimeter of every lit tile, and each hazard was a painter clipped to
   one square. Three things were wrong with that:
     1. a hard, uniform-width outline is the loudest "this is a drawn grid"
        signal on the board — the exact read the redesign exists to kill;
     2. eight legal move tiles read as eight outlined CELLS, never as one lit
        area, so the eye had to count boxes instead of seeing a shape;
     3. a flat fill clipped to a square TINTS the sand inside a rectangle. Four
        adjacent oil tiles read as four blue-black squares, not as a puddle.

   ── THE THREE MECHANISMS THAT REPLACE IT ──────────────────────────────────
   1. JITTERED, WATERTIGHT TILE POLYGONS (jitQuad). Every tile is an 8-gon
      whose corners and edge midpoints are displaced by a hash of the LATTICE
      point they sit on, not of the tile — so the two tiles sharing an edge
      displace it identically and the union stays watertight, while the outer
      boundary of a pool is an irregular organic outline instead of a
      rectangle. This is the single biggest reason a hazard stops reading as a
      sticker. It is deterministic, so it never crawls between frames, and it
      is baked into the same cache as the projection.
   2. REGION PAINTING, NOT TILE PAINTING. Same-state (and same-hazard) tiles
      are grouped; the union of their polygons is the clip, and the interior is
      filled ONCE. A contiguous run therefore has no internal seams at all, and
      only the region's outer boundary is ever hinted.
   3. AN UNCLIPPED FEATHER on the boundary tiles, drawn just outside the clip,
      which carries the value across the cut so the edge fades into the sand
      rather than stopping at a line.

   Anything that is genuinely NOT a floor material — flame tongues, gas wisps,
   void motes, rising holy light — is drawn in a second unclipped pass, because
   a flame with a razor edge at the tile boundary is the sticker problem again
   in a different costume.

   ── HARD CONSTRAINTS THIS FILE OBEYS ──────────────────────────────────────
   • canvas-2D only. The board's own TILE SURFACES header records that the
     WebGL surface layer compiled, issued draw calls and produced NO FRAGMENTS
     on real hardware, and behaved differently between machines. Not re-tried.
   • Cost is per LIT or SURFACED tile, never a full-board pass. A clean board
     with no paint and no hazards costs three early returns.
   • Every painter runs inside its own save()/try/restore(). A leaked
     globalCompositeOperation corrupts everything drawn after it for the rest
     of the frame, and the spine's catch would hide the cause.
   • An unknown fxKey falls through to a neutral wash. It must never throw and
     must never silently render nothing — a hazard the player cannot see is a
     gameplay bug wearing a graphics bug's clothes.
   ═══════════════════════════════════════════════════════════════════════════ */

window.BBX = window.BBX || {};

/* ── state colours ─────────────────────────────────────────────────────────
   Teal for movement range, amber-gold for target, per the reference. These are
   ADDITIVE over warm sand so they read as light and not as paint: teal lifts
   G+B and leaves the sand's red alone, which is what a cool emissive pool on
   ochre ground actually looks like. */
/* `filt` is the MULTIPLY filter, and it is the half of this that makes a cool
   highlight survive on warm ground. Additive teal alone fails there: sand is
   red-dominant and already near saturation under a hazy key, so adding G+B
   moves the pixel barely at all and the legal-move pool disappears — while the
   same numbers blow out to milk on a dark location. Multiplying by a colour
   that CUTS the complementary channel (teal filter = low red) tints the sand
   toward cyan without darkening it much; the additive pass then supplies the
   light. Warm states filter the other way, cutting blue. */
const COL = {
  move:   { core: '#86ecfa', body: '#1fbdd8', rim: '#63e2f5', filt: '#9ceeff' },
  attack: { core: '#fff0c8', body: '#ffa028', rim: '#ffc65c', filt: '#fff0c4' },
  place:  { core: '#e0ffe8', body: '#4fdc86', rim: '#8ff0b0', filt: '#b8ffcf' },
  swap:   { core: '#efe2ff', body: '#9a6ef0', rim: '#c3a5ff', filt: '#dcc6ff' },
  sel:    { core: '#fff6dc', body: '#f2c85e', rim: '#ffe3a2', filt: '#fff3d2' },
  hover:  { core: '#fff2e2', body: '#e8c894', rim: '#f5dcae', filt: '#fff6e8' }
};

/* States sit a hair above the terrain's top face; surfaces sit above states.
   In 2D these lifts do nothing to depth — they exist so the projected quads
   agree with the spine's own _sQuad (tileElev + 0.012) instead of drifting a
   subpixel apart on a raised plateau and leaving a bright seam. */
const LIFT_STATE = 0.006;
const LIFT_SURF  = 0.012;

/* How far a lattice point is displaced, in tiles. Surfaces get more (a spill
   has no straight edges at all); states get less, because the player has to be
   able to tell which tile is legal and a wildly ragged pool blurs that. */
const JIT_SURF  = 0.19;
const JIT_STATE = 0.10;

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
  if (e !== _epoch) { _epoch = e; _polys.clear(); }
}

/* Vertex 0,2,4,6 are the tile corners; 1,3,5,7 are the edge midpoints.
   Edge k occupies vertices [2k, 2k+1, (2k+2)%8] and faces neighbour (dx,dz). */
const EDGES = [[0, -1], [1, 0], [0, 1], [-1, 0]];

/* ⚠ THE WATERTIGHT RULE. Every displacement below is keyed on the LATTICE
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

/* half-width / half-height of the projected tile, in device px, from the four
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

function unionPath(c, list) {
  c.beginPath();
  for (let i = 0; i < list.length; i++) poly(c, list[i].q);
}

/* Region outline: only edges with no same-region neighbour. Interior edges are
   never drawn, which is what stops a run of tiles reading as N cells. */
function boundaryPath(c, list, set) {
  c.beginPath();
  for (let i = 0; i < list.length; i++) {
    const it = list[i];
    for (let k = 0; k < 4; k++) {
      if (set.has((it.x + EDGES[k][0]) + ',' + (it.z + EDGES[k][1]))) continue;
      const a = 2 * k, b = a + 1, d = (a + 2) % 8;
      c.moveTo(it.q[a].x, it.q[a].y);
      c.lineTo(it.q[b].x, it.q[b].y);
      c.lineTo(it.q[d].x, it.q[d].y);
    }
  }
}

/* An ellipse-shaped radial gradient without ctx.ellipse + clip gymnastics:
   squash the space, draw a circle gradient, unsquash. The active clip lives in
   device space and survives the transform, so this composes correctly inside a
   union clip. */
function radial(c, cx, cy, ax, ay, R, stops, comp) {
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

/* Assemble a region: polygons, membership set, which tiles touch the outside,
   mean tile metrics and a padded bounding box for the interior fills. */
function group(api, tiles, lift, amp) {
  const list = [];
  const set = new Set();
  for (const t of tiles) {
    const q = jitQuad(api, t.x, t.z, lift, amp);
    if (!q) continue;
    list.push({ x: t.x, z: t.z, q });
    set.add(t.x + ',' + t.z);
  }
  if (!list.length) return null;
  const border = new Set();
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  let ax = 0, ay = 0, cx = 0, cy = 0;
  for (const it of list) {
    for (let k = 0; k < 4; k++) {
      if (!set.has((it.x + EDGES[k][0]) + ',' + (it.z + EDGES[k][1]))) {
        border.add(it.x + ',' + it.z); break;
      }
    }
    for (const p of it.q) {
      if (p.x < x0) x0 = p.x; if (p.x > x1) x1 = p.x;
      if (p.y < y0) y0 = p.y; if (p.y > y1) y1 = p.y;
    }
    const m = metrics(it.q);
    ax += m.ax; ay += m.ay; cx += m.cx; cy += m.cy;
  }
  const n = list.length;
  return { list, set, border, n,
           ax: ax / n, ay: ay / n, cx: cx / n, cy: cy / n,
           x0: x0 - 6, y0: y0 - 6, x1: x1 + 6, y1: y1 + 6 };
}

/* THE FEATHER. Drawn unclipped on the boundary tiles only, so the value that
   the union clip is about to cut off is continued outward and fades. Without
   it every pool ends on a line; with it the pool dissolves into the sand. */
function feather(api, c, g, colour, alpha, comp, reach) {
  c.save();
  if (comp) c.globalCompositeOperation = comp;
  const R = reach || 1.9;
  for (const it of g.list) {
    if (!g.border.has(it.x + ',' + it.z)) continue;
    const m = metrics(it.q);
    radial(c, m.cx, m.cy, m.ax, m.ay, m.ax * R, [
      [0,    api.rgba(colour, alpha * 0.62)],
      [0.48, api.rgba(colour, alpha * 0.42)],
      [0.74, api.rgba(colour, alpha * 0.16)],
      [1,    api.rgba(colour, 0)]
    ]);
  }
  c.restore();
}

/* a soft band straddling the region's (already irregular) outline. Half lands
   on the pool, half on the bare sand — which is exactly where a real puddle
   darkens the ground it is soaking into. */
function rimBand(api, c, g, colour, alpha, width, comp) {
  c.save();
  if (comp) c.globalCompositeOperation = comp;
  boundaryPath(c, g.list, g.set);
  c.lineJoin = 'round'; c.lineCap = 'round';
  c.lineWidth = Math.max(1, g.ax * width);
  c.strokeStyle = api.rgba(colour, alpha);
  c.stroke();
  c.restore();
}

/* ═══════════════════════════════════════════════════════════════════════════
   A) TILE STATES — one pool of light per region
   ═══════════════════════════════════════════════════════════════════════════ */

/* strength: 1 = the under-ground pass; >1 = the re-assert over a hazard, which
   has to punch through flame and oil sheen to stay legible. */
function drawPool(api, tiles, colKey, strength, lift) {
  const c = api.ctx, col = COL[colKey] || COL.move;
  const S = strength || 1;
  const g = group(api, tiles, lift, JIT_STATE);
  if (!g) return;

  const glow = 0.155 * S;
  /* ⚠ THE MULTIPLY PASS CARRIES THE HIGHLIGHT, THE ADDITIVE PASS CARRIES THE
     MOOD — and the split is deliberate because the ground under this is not a
     fixed value. The vista's grade and the location's ground art move the
     sand between "dark canyon floor" and "hazed near-white dusk" from match to
     match, and an additive-only highlight measured against one of those is
     invisible on the other. Multiply is the robust half: on bright sand it
     bites (there is plenty of channel to remove), on dark sand it barely
     shows and the 'lighter' pass takes over. Tuned against both extremes; do
     not re-balance against a single screenshot. */
  const filtA = 0.42 * Math.min(S, 1.3);
  /* (1) the spill: light does not stop at the edge of the legal area. Both the
     emission and the hue filter reach past the boundary, so the pool dissolves
     into the sand instead of ending on the clip. */
  feather(api, c, g, col.body, glow * 0.40, 'lighter', 1.75);
  feather(api, c, g, col.filt, filtA * 0.45, 'multiply', 1.6);

  c.save();
  unionPath(c, g.list);
  c.clip();

  /* (2) the hue filter, as ONE region-wide gradient. ⚠ It must not be drawn
     per tile: 'multiply' composites multiplicatively, so overlapping per-tile
     blobs double-filter every shared edge and re-draw the grid in hue instead
     of in strokes. One gradient over the whole region has no interior seam at
     all, and being a gradient rather than a flat fill it still has a middle. */
  let rmax = 0;
  for (const it of g.list) {
    const m = metrics(it.q);
    rmax = Math.max(rmax, Math.hypot(m.cx - g.cx, (m.cy - g.cy) * (g.ax / g.ay)) + m.ax);
  }
  const R = Math.max(rmax, g.ax * 1.4);
  radial(c, g.cx, g.cy, g.ax, g.ay, R, [
    [0,    api.rgba(col.filt, filtA)],
    [0.62, api.rgba(col.filt, filtA * 0.86)],
    [1,    api.rgba(col.filt, filtA * 0.62)]
  ], 'multiply');

  c.globalCompositeOperation = 'lighter';

  /* (3) region wash — the broad emission over the whole lit area. */
  radial(c, g.cx, g.cy, g.ax, g.ay, R, [
    [0,    api.rgba(col.body, 0.085 * S)],
    [0.55, api.rgba(col.body, 0.055 * S)],
    [1,    api.rgba(col.body, 0)]
  ]);

  /* (4) per-tile blobs at 1.4× the tile so neighbours overlap and SUM. THIS is
     what makes a contiguous run read as one pool: at a shared edge both tiles
     contribute, so the seam is the brightest part of the join instead of a
     dark gap or a drawn line. Phase is hashed per tile so they breathe out of
     step — in lockstep it reads as a UI blink, not as light. */
  for (const it of g.list) {
    const m = metrics(it.q);
    const ph = api.hash(it.x, it.z, 7) * 6.283;
    const pulse = 1 + Math.sin(api.T * 2.1 + ph) * 0.12;
    radial(c, m.cx, m.cy, m.ax, m.ay, m.ax * 1.40, [
      [0,    api.rgba(col.core, glow * 1.45 * pulse)],
      [0.24, api.rgba(col.body, glow * 0.82 * pulse)],
      [0.55, api.rgba(col.body, glow * 0.32 * pulse)],
      [1,    api.rgba(col.body, 0)]
    ]);
  }

  /* (5) rim — the region's OUTER outline only, two wide soft passes. Half of
     each stroke falls outside the clip and is discarded, so what is left is a
     glow along the inside of the lit area. It is deliberately NOT a
     constant-width line: there is no thin pass, because a thin pass at this
     scale is indistinguishable from the outline this rewrite deleted. */
  const rimPulse = 0.86 + Math.sin(api.T * 1.7) * 0.14;
  boundaryPath(c, g.list, g.set);
  c.lineJoin = 'round'; c.lineCap = 'round';
  const passes = [[g.ax * 0.66, 0.040], [g.ax * 0.24, 0.048]];
  for (const p of passes) {
    c.lineWidth = Math.max(1, p[0]);
    c.strokeStyle = api.rgba(col.rim, p[1] * S * rimPulse);
    c.stroke();
  }
  c.restore();
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
      try { drawPool(api, [{ x: sel.x, z: sel.z }], 'sel', 1.05, LIFT_STATE); } catch (e) {}
    }
    /* hover: barely there. It must not compete with the legal-move pool, or
       the player reads the cursor tile as a fifth game state. */
    const hv = api.hover;
    if (hv && isFinite(hv.x) && isFinite(hv.z)) {
      try { drawPool(api, [{ x: hv.x, z: hv.z }], 'hover', 0.55, LIFT_STATE); } catch (e) {}
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
      try { drawPool(api, r[1], r[0], 0.85, LIFT_SURF + 0.004); } catch (e) {}
    }
  } catch (e) {}
}

/* ═══════════════════════════════════════════════════════════════════════════
   B) FIELD SURFACES

   Each painter is { pre, wash, tile, post }, all optional:
     pre(api, c, g)      unclipped underlay — damp rims, scorch, spill light,
                         and the outward feather that softens the pool's edge
     wash(api, c, g)     ONE group-wide fill inside the union clip. Filling the
                         whole region once (rather than per tile) is why a run
                         of oil has no internal seams: a per-tile 'multiply'
                         would double-darken every shared edge into a grid.
     tile(api, c, t, m)  per-tile detail inside the union clip, drawn oversized
                         so patterns bleed over the shared seams
     post(api, c, g)     unclipped overlay — anything not lying flat on the
                         floor (flames, wisps, motes)
   ═══════════════════════════════════════════════════════════════════════════ */

/* wet sand. Derived from the light's own ambient so it stays right at every
   time of day instead of being a hardcoded brown that only works at noon. */
function dampCol(api) {
  return api.mixHex('#412c15', (api.LIGHT && api.LIGHT.ambient) || '#3a4a6a', 0.22);
}
function fill(c, g) { c.fillRect(g.x0, g.y0, g.x1 - g.x0, g.y1 - g.y0); }

const PAINTERS = {

  /* ── OIL ── near-black film with a thin-film iridescence that drifts. The
     sand is DARKENED (multiply) rather than covered, so the dune ripples still
     read through the slick — that is the difference between a liquid and a
     black polygon. */
  oil: {
    pre(api, c, g) {
      feather(api, c, g, '#191019', 0.62, 'multiply');
      rimBand(api, c, g, '#120c10', 0.30, 0.26, 'multiply');
    },
    wash(api, c, g) {
      c.globalCompositeOperation = 'multiply';
      c.fillStyle = api.rgba('#191019', 0.76); fill(c, g);
    },
    tile(api, c, t, m) {
      const h = n => api.hash(t.x, t.z, n);
      const hues = ['#5f3fd0', '#2fa88a', '#c05a2a'];
      for (let i = 0; i < 3; i++) {          /* thin-film interference lobes */
        const a = h(i) * 6.283 + api.T * (0.10 + i * 0.045);
        radial(c, m.cx + Math.cos(a) * m.ax * 0.34, m.cy + Math.sin(a) * m.ay * 0.34,
               m.ax, m.ay, m.ax * 1.15, [
          [0, api.rgba(hues[i], 0.17)], [0.6, api.rgba(hues[i], 0.07)], [1, api.rgba(hues[i], 0)]
        ], 'lighter');
      }
      /* specular: the sky on a flat wet surface, offset toward the light so it
         agrees with the terrain's own key direction */
      const lv = api.lightVector();
      const sky = (api.LIGHT && api.LIGHT.sky) || ['#7f97b8', '#8fa8c8', '#a8bcd8'];
      radial(c, m.cx - lv.x * m.ax * 0.30, m.cy - m.ay * 0.30, m.ax, m.ay * 0.42, m.ax * 0.9, [
        [0, api.rgba(sky[1], 0.26)], [1, api.rgba(sky[1], 0)]
      ], 'lighter');
    }
  },

  /* ── GREASE ── the pale cousin: milky, less absorbent, more scatter. */
  grease: {
    pre(api, c, g) { feather(api, c, g, '#6e6552', 0.34, 'multiply'); },
    wash(api, c, g) {
      c.globalCompositeOperation = 'multiply';
      c.fillStyle = api.rgba('#6e6552', 0.44); fill(c, g);
    },
    tile(api, c, t, m) {
      radial(c, m.cx, m.cy - m.ay * 0.18, m.ax, m.ay, m.ax * 1.25, [
        [0, api.rgba('#e6e0c6', 0.22)], [0.7, api.rgba('#cfc7a6', 0.08)], [1, api.rgba('#cfc7a6', 0)]
      ], 'lighter');
      c.save(); c.globalCompositeOperation = 'lighter';
      const sy = m.ay / m.ax;
      for (let i = 0; i < 7; i++) {
        const a = api.hash(t.x, t.z, i) * 6.283;
        const d = api.hash(t.z, t.x, i + 3) * m.ax * 0.72;
        const r = m.ax * (0.05 + api.hash(t.x, t.z, i + 11) * 0.08);
        c.fillStyle = api.rgba('#fff4d0', 0.14);
        c.beginPath();
        c.ellipse(m.cx + Math.cos(a) * d, m.cy + Math.sin(a) * d * sy, r, r * sy, 0, 0, 6.3);
        c.fill();
      }
      c.restore();
    }
  },

  /* ── PUDDLE (water) ── darker and COOLER than the sand, with a real
     reflection: the sky gradient is mirrored into the surface, so the pool
     changes with time of day for free. Ripples expand from a seeded point per
     tile; the damp rim is the tell that it is soaking into the ground rather
     than sitting on it. */
  puddle: {
    pre(api, c, g) {
      rimBand(api, c, g, dampCol(api), 0.46, 0.40, 'multiply');
      feather(api, c, g, '#1c5a72', 0.46, 'multiply');
    },
    wash(api, c, g) {
      c.globalCompositeOperation = 'multiply';
      c.fillStyle = api.rgba('#1c5a72', 0.62); fill(c, g);
      /* mirrored sky — brightest at the far (upper) edge, which is where a
         near-grazing reflection actually lands from this camera pitch */
      c.globalCompositeOperation = 'lighter';
      const sky = (api.LIGHT && api.LIGHT.sky) || ['#5b7fb8', '#7fa0c8', '#a8bcd8'];
      const gr = c.createLinearGradient(0, g.y0, 0, g.y1);
      gr.addColorStop(0, api.rgba(sky[1], 0.30));
      gr.addColorStop(0.6, api.rgba(sky[2] || sky[1], 0.12));
      gr.addColorStop(1, api.rgba(sky[2] || sky[1], 0.03));
      c.fillStyle = gr; fill(c, g);
    },
    tile(api, c, t, m) {
      c.save();
      c.globalCompositeOperation = 'lighter';
      const sy = m.ay / m.ax;
      /* Ripples: several small rings from scattered drop points rather than
         two big concentric ones. The first version used one large ring per
         tile and it read as a sonar sweep painted on the floor — the tell was
         that the ring was centred and as wide as the tile, which nothing in
         moving water ever is. */
      for (let i = 0; i < 5; i++) {
        const ph = (api.T * 0.38 + api.hash(t.x, t.z, i) + i * 0.2) % 1;
        const rr = m.ax * (0.06 + ph * 0.46) * (0.7 + api.hash(t.z, t.x, i + 30) * 0.6);
        c.strokeStyle = api.rgba('#d8eeff', 0.15 * (1 - ph) * (1 - ph));
        c.lineWidth = Math.max(0.8, m.ax * 0.020);
        c.beginPath();
        c.ellipse(m.cx + (api.hash(t.x, t.z, i + 21) - 0.5) * m.ax * 1.3,
                  m.cy + (api.hash(t.z, t.x, i + 22) - 0.5) * m.ay * 1.3,
                  rr, rr * sy, 0, 0, 6.3);
        c.stroke();
      }
      const gx = m.cx + Math.sin(api.T * 0.5 + api.hash(t.x, t.z, 5) * 6.2) * m.ax * 0.35;
      radial(c, gx, m.cy - m.ay * 0.22, m.ax, m.ay * 0.36, m.ax * 0.6, [
        [0, api.rgba('#ffffff', 0.26)], [1, api.rgba('#bcd8ff', 0)]
      ]);
      c.restore();
    }
  },

  /* ── FIRE ── the surrounding sand is WARMED and the ground under it is
     scorched; the flames themselves are drawn unclipped, because a flame that
     ends in a straight line at the tile boundary is the sticker read again. */
  fire: {
    pre(api, c, g) {
      const fl = 0.86 + Math.sin(api.T * 6.1) * 0.14;
      for (const it of g.list) {
        const m = metrics(it.q);
        /* scorch first, so the warm light sits on top of blackened ground */
        radial(c, m.cx, m.cy, m.ax, m.ay, m.ax * 1.5, [
          [0, api.rgba('#241408', 0.52)], [0.6, api.rgba('#241408', 0.26)], [1, api.rgba('#241408', 0)]
        ], 'multiply');
        radial(c, m.cx, m.cy, m.ax, m.ay, m.ax * 3.1, [
          [0, api.rgba('#ff8c22', 0.32 * fl)],
          [0.32, api.rgba('#ff6a12', 0.14 * fl)],
          [1, api.rgba('#ff5a08', 0)]
        ], 'lighter');
      }
    },
    tile(api, c, t, m) {
      const fl = 0.85 + 0.15 * Math.sin(api.T * 11 + t.x * 3 + t.z);
      radial(c, m.cx, m.cy, m.ax, m.ay, m.ax * 1.3, [
        [0, api.rgba('#ffe9a8', 0.80 * fl)],
        [0.35, api.rgba('#ff9a24', 0.56 * fl)],
        [1, api.rgba('#8c1400', 0)]
      ], 'lighter');
    },
    post(api, c, g) {
      c.save();
      c.globalCompositeOperation = 'lighter';
      for (const it of g.list) {
        const m = metrics(it.q);
        for (let i = 0; i < 6; i++) {
          const h = api.hash(it.x, it.z, i);
          const fx = m.cx + (h - 0.5) * m.ax * 1.25;
          const fy = m.cy + (api.hash(it.z, it.x, i + 4) - 0.5) * m.ay * 0.9;
          const hgt = m.ax * (0.7 + h * 0.8) * (0.78 + 0.34 * Math.sin(api.T * 8.5 + i * 2.1 + h * 6));
          const wob = Math.sin(api.T * 5.3 + i * 1.7) * m.ax * 0.10;
          const fg = c.createLinearGradient(fx, fy, fx + wob, fy - hgt);
          fg.addColorStop(0, api.rgba('#ff7a10', 0.60));
          fg.addColorStop(0.45, api.rgba('#ffb63a', 0.36));
          fg.addColorStop(1, api.rgba('#ffe6a0', 0));
          c.fillStyle = fg;
          c.beginPath();
          c.moveTo(fx - m.ax * 0.15, fy + m.ay * 0.10);
          c.quadraticCurveTo(fx + wob * 2, fy - hgt * 0.6, fx + wob, fy - hgt);
          c.quadraticCurveTo(fx + wob * 2, fy - hgt * 0.5, fx + m.ax * 0.15, fy + m.ay * 0.10);
          c.closePath(); c.fill();
        }
        for (let i = 0; i < 4; i++) {          /* embers riding the column */
          const ph = (api.T * 0.5 + api.hash(it.x, it.z, i + 30)) % 1;
          const ex = m.cx + (api.hash(it.z, it.x, i + 31) - 0.5) * m.ax * 1.1
                          + Math.sin(api.T * 3 + i) * m.ax * 0.1;
          const ey = m.cy - ph * m.ax * 1.9;
          c.fillStyle = api.rgba('#ffcf7a', 0.5 * (1 - ph));
          c.beginPath(); c.arc(ex, ey, Math.max(0.8, m.ax * 0.030), 0, 6.3); c.fill();
        }
      }
      c.restore();
    }
  },

  /* ── GAS (toxin + steam) ── a cloud, not a floor. Kept low-contrast and
     translucent so the unit standing in it is never lost. */
  gas: {
    pre(api, c, g) { feather(api, c, g, '#7a9a2c', 0.16, 'lighter', 2.1); },
    wash(api, c, g) { c.fillStyle = api.rgba('#5a7a20', 0.15); fill(c, g); },
    tile(api, c, t, m) {
      for (let i = 0; i < 3; i++) {
        const a = api.T * 0.42 * (i % 2 ? 1 : -1) + i * 2.1 + api.hash(t.x, t.z, i) * 6;
        radial(c, m.cx + Math.cos(a) * m.ax * 0.38, m.cy + Math.sin(a) * m.ay * 0.34,
               m.ax, m.ay, m.ax * 1.0, [
          [0, api.rgba('#a8d03c', 0.30)], [1, api.rgba('#506e14', 0)]
        ], 'lighter');
      }
    },
    post(api, c, g) {
      c.save(); c.globalCompositeOperation = 'lighter';
      for (const it of g.list) {
        const m = metrics(it.q);
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
    tile(api, c, t, m) {
      const lv = api.lightVector();
      const sy = m.ay / m.ax;
      const strands = (col, alpha, dx, dy, lw) => {
        c.strokeStyle = api.rgba(col, alpha);
        c.lineWidth = Math.max(0.8, m.ax * lw);
        for (let i = 0; i < 7; i++) {
          const a = i / 7 * 6.283 + api.hash(t.x, t.z, 1) * 1.2;
          c.beginPath();
          c.moveTo(m.cx + dx, m.cy + dy);
          c.lineTo(m.cx + dx + Math.cos(a) * m.ax * 1.2, m.cy + dy + Math.sin(a) * m.ay * 1.2);
          c.stroke();
        }
        for (let ring = 1; ring <= 3; ring++) {
          c.beginPath();
          for (let i = 0; i <= 14; i++) {
            const a = i / 14 * 6.283 + api.hash(t.x, t.z, 1) * 1.2;
            const rr = m.ax * (ring / 3.1) * (1 + 0.10 * Math.sin(a * 3.5 + t.x));
            const px = m.cx + dx + Math.cos(a) * rr, py = m.cy + dy + Math.sin(a) * rr * sy;
            i ? c.lineTo(px, py) : c.moveTo(px, py);
          }
          c.stroke();
        }
      };
      strands('#171208', 0.30, -lv.x * m.ax * 0.05, m.ay * 0.06, 0.030);  /* contact shadow */
      strands('#e8ecf5', 0.55, 0, 0, 0.024);                             /* silk */
      c.save(); c.globalCompositeOperation = 'lighter';
      for (let i = 0; i < 5; i++) {                                      /* dew */
        const a = api.hash(t.x, t.z, i + 40) * 6.283, d = api.hash(t.z, t.x, i + 41) * m.ax * 0.9;
        c.fillStyle = api.rgba('#ffffff', 0.35);
        c.beginPath();
        c.arc(m.cx + Math.cos(a) * d, m.cy + Math.sin(a) * d * sy, Math.max(0.7, m.ax * 0.022), 0, 6.3);
        c.fill();
      }
      c.restore();
    }
  },

  /* ── CALTROPS ── objects, not a material: no wash at all, just iron on sand
     with a lit edge, a dark body and a contact shadow each. */
  caltrops: {
    tile(api, c, t, m) {
      const lv = api.lightVector();
      const sy = m.ay / m.ax;
      for (let i = 0; i < 9; i++) {
        const a = api.hash(t.x, t.z, i) * 6.283;
        const d = Math.sqrt(api.hash(t.z, t.x, i + 5)) * m.ax * 0.82;
        const px = m.cx + Math.cos(a) * d, py = m.cy + Math.sin(a) * d * sy;
        const s = m.ax * (0.10 + api.hash(t.x, t.z, i + 9) * 0.06);
        c.fillStyle = api.rgba('#1d1409', 0.34);
        c.beginPath();
        c.ellipse(px - lv.x * s * 0.7, py + s * 0.42, s * 0.85, s * 0.34, 0, 0, 6.3);
        c.fill();
        c.save(); c.translate(px, py); c.rotate(api.hash(t.z, t.x, i + 17) * 3.14);
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
  },

  /* ── ICE ── a translucent slab. The frost creeps OUT past the pool edge into
     the ground's crease seams, which is the detail that stops it reading as a
     blue tile. */
  ice: {
    pre(api, c, g) {
      feather(api, c, g, '#a9d2ea', 0.34);
      rimBand(api, c, g, '#dceffb', 0.22, 0.34, 'lighter');
      c.save(); c.globalCompositeOperation = 'lighter';
      for (const it of g.list) {
        if (!g.border.has(it.x + ',' + it.z)) continue;
        const m = metrics(it.q), sy = m.ay / m.ax;
        for (let i = 0; i < 7; i++) {                 /* crystal spurs */
          const a = api.hash(it.x, it.z, i + 60) * 6.283;
          const d = m.ax * (0.9 + api.hash(it.z, it.x, i + 61) * 0.4);
          c.strokeStyle = api.rgba('#d8eefb', 0.24);
          c.lineWidth = Math.max(0.7, m.ax * 0.03);
          c.beginPath();
          c.moveTo(m.cx + Math.cos(a) * d * 0.6, m.cy + Math.sin(a) * d * 0.6 * sy);
          c.lineTo(m.cx + Math.cos(a) * d, m.cy + Math.sin(a) * d * sy);
          c.stroke();
        }
      }
      c.restore();
    },
    wash(api, c, g) {
      c.fillStyle = api.rgba('#a9d2ea', 0.44); fill(c, g);
      c.globalCompositeOperation = 'lighter';
      const gr = c.createLinearGradient(0, g.y0, 0, g.y1);
      gr.addColorStop(0, api.rgba('#eaf6ff', 0.20));
      gr.addColorStop(1, api.rgba('#8fc0dd', 0.04));
      c.fillStyle = gr; fill(c, g);
    },
    tile(api, c, t, m) {
      c.strokeStyle = api.rgba('#f2fbff', 0.40);
      c.lineWidth = Math.max(0.8, m.ax * 0.028);
      for (let i = 0; i < 4; i++) {
        const a = api.hash(t.x, t.z, i) * 6.283;
        let px = m.cx, py = m.cy;
        c.beginPath(); c.moveTo(px, py);
        for (let s = 1; s <= 3; s++) {
          px += Math.cos(a + (api.hash(t.x, t.z, i * 3 + s) - 0.5)) * m.ax * 0.40;
          py += Math.sin(a + (api.hash(t.z, t.x, i * 3 + s) - 0.5)) * m.ay * 0.40;
          c.lineTo(px, py);
        }
        c.stroke();
      }
      const tw = 0.5 + 0.5 * Math.sin(api.T * 2.4 + t.x + t.z * 2);
      radial(c, m.cx + m.ax * 0.22, m.cy - m.ay * 0.24, m.ax, m.ay * 0.5, m.ax * 0.55, [
        [0, api.rgba('#ffffff', 0.30 * tw)], [1, api.rgba('#cfe8ff', 0)]
      ], 'lighter');
    }
  },

  /* ── BLOOD ── absorbed at the edge, glossy in the middle. */
  blood: {
    pre(api, c, g) {
      rimBand(api, c, g, '#3a1a12', 0.40, 0.26, 'multiply');
      feather(api, c, g, '#5a1014', 0.50, 'multiply');
    },
    wash(api, c, g) {
      c.globalCompositeOperation = 'multiply';
      c.fillStyle = api.rgba('#5a1014', 0.60); fill(c, g);
    },
    tile(api, c, t, m) {
      const sy = m.ay / m.ax;
      c.save(); c.globalCompositeOperation = 'multiply';
      for (let i = 0; i < 4; i++) {           /* darker clots */
        const a = api.hash(t.x, t.z, i) * 6.283, d = api.hash(t.z, t.x, i + 2) * m.ax * 0.6;
        radial(c, m.cx + Math.cos(a) * d, m.cy + Math.sin(a) * d * sy, m.ax, m.ay,
               m.ax * (0.25 + api.hash(t.x, t.z, i + 6) * 0.3), [
          [0, api.rgba('#2c0508', 0.5)], [1, api.rgba('#2c0508', 0)]
        ]);
      }
      c.restore();
      radial(c, m.cx - m.ax * 0.16, m.cy - m.ay * 0.22, m.ax, m.ay * 0.44, m.ax * 0.66, [
        [0, api.rgba('#ff9a8a', 0.20)], [1, api.rgba('#c04030', 0)]
      ], 'lighter');
    }
  },

  /* ── VOID (rift) ── a hole. Deliberately NOT pure black: the BAR forbids it,
     and a true 0,0,0 hole reads as a rendering failure rather than as depth. */
  void: {
    pre(api, c, g) {
      for (const it of g.list) {
        const m = metrics(it.q);
        radial(c, m.cx, m.cy, m.ax, m.ay, m.ax * 2.2, [
          [0, api.rgba('#1a1030', 0.48)], [1, api.rgba('#1a1030', 0)]
        ], 'multiply');
      }
    },
    wash(api, c, g) {
      c.globalCompositeOperation = 'multiply';
      c.fillStyle = api.rgba('#150e24', 0.74); fill(c, g);
    },
    tile(api, c, t, m) {
      const sy = m.ay / m.ax;
      radial(c, m.cx, m.cy, m.ax, m.ay, m.ax * 1.1, [
        [0, api.rgba('#0b0714', 0.90)], [0.55, api.rgba('#150c28', 0.5)], [1, api.rgba('#150c28', 0)]
      ]);
      c.save(); c.globalCompositeOperation = 'lighter';
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
      c.restore();
    }
  },

  /* ── TOXIC (acid) ── hissing, etched pale rim, bubbles that pop. */
  toxic: {
    pre(api, c, g) {
      feather(api, c, g, '#4b5a12', 0.42, 'multiply');
      rimBand(api, c, g, '#cfe07a', 0.20, 0.22, 'lighter');
    },
    wash(api, c, g) {
      c.globalCompositeOperation = 'multiply';
      c.fillStyle = api.rgba('#4b5a12', 0.52); fill(c, g);
      c.globalCompositeOperation = 'lighter';
      c.fillStyle = api.rgba('#9ec81e', 0.17); fill(c, g);
    },
    tile(api, c, t, m) {
      const sy = m.ay / m.ax;
      for (let i = 0; i < 6; i++) {
        const cyc = (api.T * 0.8 + api.hash(t.x, t.z, i)) % 1;
        const a = api.hash(t.z, t.x, i) * 6.283, d = api.hash(t.x, t.z, i + 3) * m.ax * 0.75;
        const px = m.cx + Math.cos(a) * d, py = m.cy + Math.sin(a) * d * sy;
        const r = m.ax * (0.05 + 0.10 * cyc);
        c.save(); c.globalCompositeOperation = 'lighter';
        c.beginPath(); c.ellipse(px, py, r, r * sy, 0, 0, 6.3);
        c.fillStyle = api.rgba('#c8ec4a', 0.16 * (1 - cyc)); c.fill();
        c.strokeStyle = api.rgba('#e8ff9a', 0.36 * (1 - cyc));
        c.lineWidth = Math.max(0.7, m.ax * 0.022);
        c.stroke();
        c.restore();
      }
    }
  },

  /* ── MIRE (poison) ── matte wet mud. Almost no specular: that is what
     separates it from the acid pool at a glance. */
  mire: {
    pre(api, c, g) {
      rimBand(api, c, g, '#241c10', 0.36, 0.26, 'multiply');
      feather(api, c, g, '#33361a', 0.56, 'multiply');
    },
    wash(api, c, g) {
      c.globalCompositeOperation = 'multiply';
      c.fillStyle = api.rgba('#33361a', 0.58); fill(c, g);
    },
    tile(api, c, t, m) {
      const sy = m.ay / m.ax;
      c.save(); c.globalCompositeOperation = 'multiply';
      for (let i = 0; i < 5; i++) {           /* mud swirls */
        const a = api.hash(t.x, t.z, i) * 6.283, d = api.hash(t.z, t.x, i + 4) * m.ax * 0.7;
        radial(c, m.cx + Math.cos(a) * d, m.cy + Math.sin(a) * d * sy, m.ax, m.ay, m.ax * 0.5, [
          [0, api.rgba('#1a1c0c', 0.42)], [1, api.rgba('#1a1c0c', 0)]
        ]);
      }
      c.restore();
      for (let i = 0; i < 3; i++) {           /* slow domed bubbles */
        const cyc = (api.T * 0.32 + api.hash(t.x, t.z, i + 8)) % 1;
        const a = api.hash(t.z, t.x, i + 9) * 6.283, d = api.hash(t.x, t.z, i + 10) * m.ax * 0.55;
        const r = m.ax * 0.09 * Math.sin(cyc * 3.14);
        if (r <= 0.4) continue;
        c.fillStyle = api.rgba('#6d7a34', 0.5);
        c.beginPath();
        c.ellipse(m.cx + Math.cos(a) * d, m.cy + Math.sin(a) * d * sy, r, r * sy, 0, 0, 6.3);
        c.fill();
      }
    }
  },

  /* ── ELECTRIC ── a wet conductive patch with arcs skittering over it. */
  electric: {
    pre(api, c, g) {
      const fl = 0.6 + 0.4 * Math.sin(api.T * 9.3);
      feather(api, c, g, '#1a2440', 0.36, 'multiply');
      for (const it of g.list) {
        const m = metrics(it.q);
        radial(c, m.cx, m.cy, m.ax, m.ay, m.ax * 2.1, [
          [0, api.rgba('#5a9cff', 0.17 * fl)], [1, api.rgba('#3a6ccc', 0)]
        ], 'lighter');
      }
    },
    wash(api, c, g) {
      c.globalCompositeOperation = 'multiply';
      c.fillStyle = api.rgba('#1a2440', 0.46); fill(c, g);
    },
    tile(api, c, t, m) {
      const seed = Math.floor(api.T * 7);
      c.save(); c.globalCompositeOperation = 'lighter';
      c.strokeStyle = api.rgba('#bcdcff', 0.90);
      c.lineWidth = Math.max(0.9, m.ax * 0.035);
      c.shadowColor = api.rgba('#78b4ff', 0.9); c.shadowBlur = m.ax * 0.22;
      for (let b = 0; b < 2; b++) {
        const a = api.hash(t.x + seed, t.z, b) * 6.283;
        let px = m.cx - Math.cos(a) * m.ax * 0.9, py = m.cy - Math.sin(a) * m.ay * 0.9;
        c.beginPath(); c.moveTo(px, py);
        for (let s = 0; s < 5; s++) {
          px += Math.cos(a) * m.ax * 0.38 + (api.hash(t.z + seed, t.x, b * 5 + s) - 0.5) * m.ax * 0.5;
          py += Math.sin(a) * m.ay * 0.38 + (api.hash(t.x + seed, t.z, b * 7 + s) - 0.5) * m.ay * 0.5;
          c.lineTo(px, py);
        }
        c.stroke();
      }
      c.shadowBlur = 0;
      c.restore();
    }
  },

  /* ── HOLY ── consecrated ground: the sand is BRIGHTENED, never covered with
     an opaque plate, and the light rises off it. No outline anywhere. */
  holy: {
    pre(api, c, g) {
      const br = 0.9 + Math.sin(api.T * 1.3) * 0.1;
      for (const it of g.list) {
        const m = metrics(it.q);
        radial(c, m.cx, m.cy, m.ax, m.ay, m.ax * 2.4, [
          [0, api.rgba('#ffe8b4', 0.24 * br)], [0.5, api.rgba('#ffd98a', 0.10 * br)], [1, api.rgba('#ffd070', 0)]
        ], 'lighter');
      }
    },
    wash(api, c, g) {
      c.globalCompositeOperation = 'lighter';
      c.fillStyle = api.rgba('#ffe6b0', 0.10); fill(c, g);
    },
    tile(api, c, t, m) {
      const sy = m.ay / m.ax;
      c.save(); c.globalCompositeOperation = 'lighter';
      for (let i = 0; i < 3; i++) {
        const ph = (api.T * 0.28 + api.hash(t.x, t.z, i) + i / 3) % 1;
        const rr = m.ax * (0.15 + ph * 0.95);
        c.strokeStyle = api.rgba('#fff2cc', 0.20 * (1 - ph));
        c.lineWidth = Math.max(0.8, m.ax * 0.03);
        c.beginPath(); c.ellipse(m.cx, m.cy, rr, rr * sy, 0, 0, 6.3); c.stroke();
      }
      c.restore();
    },
    post(api, c, g) {
      c.save(); c.globalCompositeOperation = 'lighter';
      for (const it of g.list) {
        const m = metrics(it.q);
        for (let i = 0; i < 5; i++) {
          const ph = (api.T * 0.24 + api.hash(it.x, it.z, i + 50)) % 1;
          const px = m.cx + (api.hash(it.z, it.x, i + 51) - 0.5) * m.ax * 1.2;
          c.fillStyle = api.rgba('#fff0c8', 0.42 * (1 - ph) * ph * 3);
          c.beginPath(); c.arc(px, m.cy - ph * m.ax * 1.5, Math.max(0.7, m.ax * 0.026), 0, 6.3); c.fill();
        }
      }
      c.restore();
    }
  },

  /* ── CRACK (cracked earth) ── DRY. The old painter lit these with orange
     magma, which made "unstable footing" read as a lava tile — a different
     hazard entirely. Now it is fractured ground: dark fissures with a pale lit
     lip on the light-facing side, and displaced grit around them. No wash, so
     the sand's own material still shows: that is the point of the hazard. */
  crack: {
    tile(api, c, t, m) {
      const lv = api.lightVector();
      const sy = m.ay / m.ax;
      const branch = (col, alpha, lw, dx, dy) => {
        c.strokeStyle = api.rgba(col, alpha);
        c.lineWidth = Math.max(0.7, m.ax * lw);
        c.lineCap = 'round';
        for (let i = 0; i < 4; i++) {
          const a = api.hash(t.x, t.z, i) * 6.283;
          let px = m.cx + dx, py = m.cy + dy;
          c.beginPath(); c.moveTo(px, py);
          for (let s = 0; s < 4; s++) {
            px += Math.cos(a + (api.hash(t.z, t.x, i * 4 + s) - 0.5) * 1.5) * m.ax * 0.34;
            py += Math.sin(a + (api.hash(t.x, t.z, i * 4 + s) - 0.5) * 1.5) * m.ay * 0.34;
            c.lineTo(px, py);
          }
          c.stroke();
        }
      };
      branch(api.mixHex('#c9b78c', (api.LIGHT && api.LIGHT.key) || '#ffd9a0', 0.35), 0.30, 0.055,
             -lv.x * m.ax * 0.04, -m.ay * 0.04);   /* lit lip */
      branch('#241a10', 0.62, 0.042, 0, 0);        /* the fissure itself */
      for (let i = 0; i < 10; i++) {               /* displaced grit */
        const a = api.hash(t.x, t.z, i + 70) * 6.283, d = api.hash(t.z, t.x, i + 71) * m.ax * 0.85;
        c.fillStyle = api.rgba('#2a2015', 0.30);
        c.beginPath();
        c.arc(m.cx + Math.cos(a) * d, m.cy + Math.sin(a) * d * sy, Math.max(0.6, m.ax * 0.020), 0, 6.3);
        c.fill();
      }
    }
  },

  /* ── FALL-THROUGH ── a hazard key the board has never heard of. A neutral
     wash plus a sheen: unmistakably "something is on this tile", legible on
     sand, and it can never throw. Rendering NOTHING here would hide a real
     game mechanic; that is the failure mode this branch exists to prevent. */
  _neutral: {
    pre(api, c, g) {
      rimBand(api, c, g, dampCol(api), 0.28, 0.24, 'multiply');
      feather(api, c, g, '#3d4152', 0.38, 'multiply');
    },
    wash(api, c, g) {
      c.globalCompositeOperation = 'multiply';
      c.fillStyle = api.rgba('#3d4152', 0.46); fill(c, g);
    },
    tile(api, c, t, m) {
      radial(c, m.cx, m.cy - m.ay * 0.15, m.ax, m.ay, m.ax * 1.15, [
        [0, api.rgba('#c8d2e6', 0.17)], [1, api.rgba('#c8d2e6', 0)]
      ], 'lighter');
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

    /* group by fx key so a run of the same hazard shares one clip and blends */
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
      const g = group(api, tiles, LIFT_SURF, JIT_SURF);
      if (!g) return;

      /* 1. unclipped underlay: feather, damp rim, scorch, spill light */
      if (P.pre) { c.save(); try { P.pre(api, c, g); } catch (e) {} c.restore(); }

      /* 2. everything that is part of the floor, inside the union clip */
      c.save();
      try {
        unionPath(c, g.list);
        c.clip();
        if (P.wash) { c.save(); try { P.wash(api, c, g); } catch (e) {} c.restore(); }
        if (P.tile) {
          for (const it of g.list) {
            const m = metrics(it.q);
            c.save();
            try { P.tile(api, c, it, m); } catch (e) {}
            c.restore();
          }
        }
      } catch (e) {}
      c.restore();

      /* 3. unclipped overlay — flames, wisps, motes: things that leave the
         ground plane and must not be sliced at the tile edge */
      if (P.post) { c.save(); try { P.post(api, c, g); } catch (e) {} c.restore(); }
    });
  } catch (e) {}
}

window.BBX.tilefx = { drawStates, drawSurfaces, drawStatesOver };
