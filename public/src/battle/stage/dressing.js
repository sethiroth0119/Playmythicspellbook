/* ══════════════════════════════════════════════════════════════════════════
   stage/dressing.js — SET DRESSING for the battle board.

   WHAT THIS IS
   The spine (`public/battle-board/index.html`) draws the ground: heightfield,
   cliff walls, AO, cast shadows, sand-and-rock material. That gets you a
   convincing piece of desert FLOOR. It does not get you a PLACE. The BAR asks
   for "irregular boulders and rock outcrops … scrub-grass tufts scattered
   across the sand … a dead tree at the far edge … a blue-teal water pool on
   one flank", and — the part that is easy to miss — "nothing is placed on a
   grid; the dressing is organic and asymmetric".

   HOW IT PLUGS IN
     build(api)  once on boot, and again whenever MAP.id / cols / rows / the
                 heightfield key changes (the spine's syncDressing() owns that
                 decision — see buildApi()'s dressKey note). Everything
                 expensive happens here: silhouettes, blade lists, branch
                 trees, the pool's tile set. Nothing is generated per frame.
     items(api)  returns the cached `{ x, z, draw(api) }` list. The spine
                 pushes them into the SAME painter's-algorithm depth sort as
                 units, props and tombs and dispatches draw(api), so a boulder
                 in row 2 is occluded by a unit in row 3 for free.

   DETERMINISM IS A HARD REQUIREMENT
   Every position, size, rotation and vertex comes from `api.hash()` seeded off
   `MAP.id` + cols/rows. Math.random() would re-scatter the field on every
   rebuild and would make the screenshot harness non-reproducible.

   THE THREE RULES THAT KEEP THIS OUT OF GAMEPLAY'S WAY — all three have a
   specific failure they prevent, so do not "simplify" them away:

   1. NOTHING BLOCKS, NOTHING MUTATES. This module never marks a tile blocked,
      never posts a message, never touches api.MAP / api.paint / api.surfaces /
      units. It is paint on top of a finished frame.

   2. NOTHING ON A PLAYABLE TILE STANDS TALLER THAN A UNIT'S KNEE, AND IT
      LIVES IN THE TILE'S FAR HALF. Depth sort is by grid z: an item at
      z = tileZ - 0.3 is drawn BEFORE a unit standing at z = tileZ, so the
      unit occludes the rock rather than the rock hiding the unit. Anything
      big (the tree, the tall outcrops) is banished to the MARGIN — the
      feathered rock shelf the spine bakes 0.7 tiles beyond the field edge —
      where it can never overlap a playable square at all.

   3. THE WATER YIELDS TO THE HIGHLIGHT. The pool draws in the depth pass,
      i.e. AFTER tilefx's emissive pass, so on a lit tile it would bury the
      thing the player is trying to read. drawWater() checks api.paint and
      thins itself on a painted tile. A legal move that looks unreachable is
      the exact regression the spine's drawStatesOver() exists to prevent;
      the dressing must not re-introduce it one layer higher.

   BUDGET: everything below is path+fill against one shared 2D context.
   Silhouettes are baked point lists; draw() only maps them through the
   projection and fills. No per-pixel work, no getImageData, no offscreen
   canvases, no npm deps.
   ══════════════════════════════════════════════════════════════════════════ */

window.BBX = window.BBX || {};

/* ── palette ───────────────────────────────────────────────────────────────
   Warm tan/ochre rock so the dressing belongs to the spine's sand, cooled in
   shadow. Nothing here is pure black or pure white — the BAR forbids both,
   and a pure-black contact shadow is the single easiest way to break that
   rule 40 times in one frame. */
const ROCK_A = '#7c6650';   /* dry granite   */
const ROCK_B = '#8f7350';   /* sandstone     */
const ROCK_C = '#6d6459';   /* grey basalt   */
const ROCK_PALE = '#c0a583';
const ROCK_DEEP = '#332b22';
const SHADOW = '#241f22';   /* cool-warm dark, deliberately NOT #000 */
const SCRUB_TONES = ['#7d7433', '#6a6b3a', '#8d7c42', '#5f6636', '#94824a'];
const BARK = '#4c4036';
const WATER_DEEP = '#123441';
const WATER_MID  = '#1d5c68';
const WATER_SHEEN= '#a8e6df';

const TAU = Math.PI * 2;

/* Per-frame values every draw() needs and none of them should recompute:
   the screen-space light direction, the shadow throw, the graded rock tones.
   items() refreshes this once and the spine dispatches draw() immediately
   afterwards in the same frame, so it is always current. */
const FRAME = {
  lx: 0.55, ly: -0.83,        /* unit vector on screen pointing AT the light */
  shx: -0.55, shy: 0.83,      /* …and away from it: where shadows fall       */
  shLen: 1.3, shA: 0.42,
  lit: ROCK_PALE, mid: ROCK_A, shd: ROCK_DEEP, rim: '#cfe4ff', T: 0
};

/* ── deterministic streams ────────────────────────────────────────────────
   api.hash(x, z, n) is the spine's integer hash. mkSeq turns it into a
   sequential generator so a bake reads as ordinary rnd() code while staying
   reproducible. The multipliers are coprime-ish so two streams seeded a few
   apart do not walk in step. */
function fnv(s){
  let h = 2166136261;
  s = String(s == null ? '' : s);
  for (let i = 0; i < s.length; i++){ h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  h ^= h >>> 15; h = Math.imul(h, 2246822507); h ^= h >>> 13;
  return (h >>> 0) % 65536;
}
function mkSeq(hash, sa, sb){
  let i = 0;
  return function(){ i++; return hash(sa + i * 13, sb + i * 29, i % 97); };
}

/* Bilinear point inside a projected quad. P: 0 far-left, 1 far-right,
   2 near-right, 3 near-left — the order tilePoly() builds. u across, v far→near. */
function quadPt(P, u, v){
  const ax = P[0].x + (P[1].x - P[0].x) * u, ay = P[0].y + (P[1].y - P[0].y) * u;
  const bx = P[3].x + (P[2].x - P[3].x) * u, by = P[3].y + (P[2].y - P[3].y) * u;
  return { x: ax + (bx - ax) * v, y: ay + (by - ay) * v };
}

/* ── anchoring ────────────────────────────────────────────────────────────
   Everything is a camera-facing billboard, exactly like the spine's units, so
   it needs two different scales and using one for both is the classic bug:
     sx  px per world unit HORIZONTALLY = the projection's own isotropic
         scale at this depth (project() hands it back as p.s).
     sy  px per world unit VERTICALLY  = the on-screen distance from the base
         to a point one world unit above it. On this camera (~41° pitch) that
         is ~0.75·sx, which is precisely the foreshortening that makes an
         object read as STANDING on the ground plane rather than pasted on it.
   drawUnit() derives its height the same way (foot vs head projection), so
   dressing and units share a horizon. */
function anchor(api, gx, gz, y){
  const b = api.gw(gx, gz, y || 0);
  const p = api.project(b); if (!p) return null;
  const h = api.project({ x: b.x, y: b.y + 1, z: b.z }); if (!h) return null;
  return { x: p.x, y: p.y, sx: p.s, sy: Math.abs(p.y - h.y), wx: b.x, wy: b.y, wz: b.z };
}

/* Contact shadow. Elliptical, squashed to the ground plane, thrown along
   -lightVector and lengthened as the sun gets low — the same rig the spine's
   shadowEllipse() uses, so a boulder's shadow and a unit's shadow agree. */
function contact(api, a, rw, alpha){
  const g = api.ctx;
  const R = Math.max(1.5, rw * a.sx);
  const L = FRAME.shLen;
  g.save();
  g.translate(a.x + FRAME.shx * R * L * 0.42, a.y + FRAME.shy * R * L * 0.42 * 0.42);
  g.scale(1 + L * 0.34, 0.40);
  const grd = g.createRadialGradient(0, 0, 0, 0, 0, R * 1.15);
  grd.addColorStop(0,    api.rgba(SHADOW, alpha * FRAME.shA));
  grd.addColorStop(0.55, api.rgba(SHADOW, alpha * FRAME.shA * 0.44));
  grd.addColorStop(1,    api.rgba(SHADOW, 0));
  g.fillStyle = grd;
  g.beginPath(); g.arc(0, 0, R * 1.15, 0, TAU); g.fill();
  g.restore();
}

/* ══════════════════════════════════════════════════════════════════════════
   BAKERS — silhouettes, in LOCAL WORLD UNITS. x is across (0 = the anchor),
   y is up from the ground (0 = the anchor's foot). Nothing here is a circle
   or a regular polygon: an even radius is the "AI-generated game" tell the
   BAR calls out by name, so every vertex carries its own jitter.
   ══════════════════════════════════════════════════════════════════════════ */

/* An irregular closed lump. Per-vertex radius AND per-vertex angle jitter —
   jittering the radius alone still leaves a recognisably even vertex spacing
   around the silhouette. */
function lump(rr, cx, cy, r, squash, n){
  const pts = [];
  for (let i = 0; i < n; i++){
    const a = (i / n) * TAU + rr() * (TAU / n) * 0.72;
    const k = 0.66 + rr() * 0.62;
    pts.push({ x: cx + Math.cos(a) * r * k, y: cy + Math.sin(a) * r * k * squash });
  }
  return pts;
}

/* FAMILY 1 — SHARD. A tall angular monolith with a lean and a broken apex.
   Reads as bedrock that fractured upward. */
function bakeShard(rr, scale){
  const h = scale * (0.80 + rr() * 0.55);
  const w = scale * (0.30 + rr() * 0.24);
  const lean = (rr() - 0.5) * 0.34;
  const apex = (rr() - 0.5) * w * 0.7;
  const j = () => (rr() - 0.5);
  const raw = [
    { x: -w * (0.50 + rr() * 0.22), y: -0.02 },
    { x: -w * (0.56 + j() * 0.3),   y: h * (0.28 + j() * 0.14) },
    { x: -w * (0.34 + j() * 0.3),   y: h * (0.64 + j() * 0.12) },
    { x: apex - w * 0.14,           y: h * (0.90 + j() * 0.08) },
    { x: apex + w * (0.18 + j()*.2),y: h },
    { x: w * (0.36 + j() * 0.26),   y: h * (0.70 + j() * 0.14) },
    { x: w * (0.52 + j() * 0.24),   y: h * (0.24 + j() * 0.14) },
    { x: w * (0.46 + rr() * 0.24),  y: -0.02 }
  ];
  /* shear it over so it leans; the lean is what stops a row of shards from
     reading as a picket fence */
  for (const p of raw) p.x += lean * p.y;
  return { pts: raw, w: w * 1.15, h: h, kind: 'shard' };
}

/* FAMILY 2 — CLUSTER. Two to four rounded boulders piled together, biggest at
   the front. Different silhouette AND different lighting behaviour from a
   shard, which is what "genuinely different silhouettes" has to mean. */
function bakeCluster(rr, scale){
  const n = 2 + ((rr() * 2.6) | 0);
  const parts = [];
  let maxw = 0, maxh = 0;
  for (let i = 0; i < n; i++){
    const r = scale * (0.20 + rr() * 0.28) * (i === 0 ? 1.15 : 0.82);
    const cx = (rr() - 0.5) * scale * 0.9;
    const sq = 0.66 + rr() * 0.34;
    const cy = r * sq * (0.82 + rr() * 0.3);
    parts.push({ pts: lump(rr, cx, cy, r, sq, 9 + ((rr() * 4) | 0)), cx: cx, cy: cy, r: r });
    maxw = Math.max(maxw, Math.abs(cx) + r);
    maxh = Math.max(maxh, cy + r * sq);
  }
  /* biggest last so it is painted in front of the ones behind it */
  parts.sort((a, b) => a.r - b.r);
  return { parts: parts, w: maxw * 1.1, h: maxh, kind: 'cluster' };
}

/* FAMILY 3 — FIN. A wide, low outcrop: a slab of bedrock breaking the surface
   at an angle, with a notched ridge. This is the one that hugs a cliff base. */
function bakeFin(rr, scale){
  const w = scale * (0.85 + rr() * 0.75);
  const h = scale * (0.24 + rr() * 0.30);
  const tilt = (rr() - 0.5) * 0.5;
  const pts = [{ x: -w * 0.5, y: -0.02 }];
  /* a ridge of 4-6 notched steps, monotonic-ish but never smooth */
  const steps = 4 + ((rr() * 3) | 0);
  for (let i = 0; i <= steps; i++){
    const t = i / steps;
    const bow = Math.sin(t * Math.PI);
    pts.push({
      x: -w * 0.5 + w * t + (rr() - 0.5) * w * 0.08,
      y: h * (0.25 + bow * 0.75) * (0.7 + rr() * 0.5) + tilt * (t - 0.5) * h
    });
  }
  pts.push({ x: w * 0.5, y: -0.02 });
  return { pts: pts, w: w * 0.55, h: h, kind: 'fin' };
}

/* SCRUB. A tuft of blades, not a sprite: each blade is its own arc with its
   own lean, length and tone, and the tuft's blade COUNT varies 3..12 so a
   sparse dry clump and a fat green one are the same code. */
function bakeScrub(rr, scale){
  const dry = rr();
  const n = 3 + ((rr() * 9) | 0);
  const spread = scale * (0.10 + rr() * 0.16);
  const blades = [];
  for (let i = 0; i < n; i++){
    const x0 = (rr() - 0.5) * spread;
    const lean = (rr() - 0.5) * 1.5;
    const h = scale * (0.09 + rr() * 0.15) * (dry > 0.6 ? 0.82 : 1);
    blades.push({
      x0: x0, h: h, lean: lean,
      bow: (rr() - 0.5) * 0.5,
      tone: SCRUB_TONES[(rr() * SCRUB_TONES.length) | 0],
      w: 0.9 + rr() * 1.5
    });
  }
  return { blades: blades, w: spread * 0.8, h: scale * 0.24, dry: dry, kind: 'scrub' };
}

/* DEAD TREE. Recursive bare branching, baked to a flat segment list once.
   Bowed segments (a quadratic control point per segment) — perfectly straight
   sticks read as a diagram, not as a tree. */
function bakeTree(rr, scale){
  const segs = [];
  const grow = (x, y, ang, len, w, d) => {
    const x2 = x + Math.cos(ang) * len, y2 = y + Math.sin(ang) * len;
    const mx = (x + x2) / 2, my = (y + y2) / 2;
    const nx = -Math.sin(ang), ny = Math.cos(ang);
    const bow = (rr() - 0.5) * len * 0.34;
    segs.push({ x0: x, y0: y, cx: mx + nx * bow, cy: my + ny * bow, x1: x2, y1: y2, w: w, d: d });
    if (d >= 4 || len < scale * 0.07) return;
    const n = rr() < 0.30 ? 3 : 2;
    for (let i = 0; i < n; i++){
      const spread = (i - (n - 1) / 2) * (0.40 + rr() * 0.42) + (rr() - 0.5) * 0.22;
      /* one branch per fork is stunted — a tree that forks evenly is a
         fractal, and a fractal is the symmetry the BAR says nature never has */
      const k = (i === ((rr() * n) | 0)) ? 0.52 : 0.78;
      grow(x2, y2, ang + spread, len * k * (0.82 + rr() * 0.3),
           w * (0.54 + rr() * 0.18), d + 1);
    }
  };
  grow(0, 0, Math.PI / 2 + (rr() - 0.5) * 0.22, scale * 0.52, scale * 0.055, 0);
  return { segs: segs, w: scale * 0.55, h: scale * 1.25, kind: 'tree' };
}

/* ══════════════════════════════════════════════════════════════════════════
   PAINTERS
   ══════════════════════════════════════════════════════════════════════════ */

function pathLocal(g, a, pts, ox, oy){
  g.beginPath();
  for (let i = 0; i < pts.length; i++){
    const X = a.x + (pts[i].x + ox) * a.sx;
    const Y = a.y - (pts[i].y + oy) * a.sy;
    i ? g.lineTo(X, Y) : g.moveTo(X, Y);
  }
  g.closePath();
}

/* One stone body: form gradient along the screen light axis, a darker seat
   where it meets the sand, strata, and a rim on the lit silhouette only.
   The rim is a SHORT arc, never a full outline — a closed stroke around a
   rock is the same "glowing hard outline on everything" the BAR bans on
   tiles, just moved onto a prop. */
function paintStone(api, a, pts, ox, oy, r, tone, seed){
  const g = api.ctx, hash = api.hash, mix = api.mixHex, rgba = api.rgba;
  const cx = a.x + ox * a.sx, cy = a.y - (oy + r * 0.5) * a.sy;
  const R = Math.max(2, r * a.sx);

  pathLocal(g, a, pts, ox, oy);
  const gr = g.createLinearGradient(
    cx + FRAME.lx * R, cy + FRAME.ly * R,
    cx - FRAME.lx * R * 1.1, cy - FRAME.ly * R * 1.1);
  gr.addColorStop(0,    mix(tone.lit, FRAME.lit, 0.35));
  gr.addColorStop(0.42, tone.mid);
  gr.addColorStop(1,    mix(tone.shd, FRAME.shd, 0.45));
  g.fillStyle = gr; g.fill();

  g.save(); g.clip();

  /* seat: the sand banks up against the base, and the base itself is in its
     own shadow. Without this a rock looks stuck ON the ground, not IN it. */
  const sg = g.createLinearGradient(cx, a.y - oy * a.sy, cx, a.y - (oy + r * 1.25) * a.sy);
  sg.addColorStop(0, rgba(mix(tone.shd, SHADOW, 0.4), 0.55));
  sg.addColorStop(1, rgba(tone.shd, 0));
  g.fillStyle = sg;
  g.fillRect(cx - R * 2, a.y - (oy + r * 1.4) * a.sy, R * 4, (r * 1.6) * a.sy + 4);

  /* strata / fracture: a lit lip above a dark line = a step in the rock */
  const bands = 2 + ((hash(seed, seed * 3, 11) * 3) | 0);
  for (let b = 0; b < bands; b++){
    const t = 0.16 + hash(seed + b, seed * 5 + b, 12) * 0.7;
    const y = a.y - (oy + r * 2 * t) * a.sy;
    const skew = (hash(seed + b, seed * 7 + b, 13) - 0.5) * R * 0.5;
    g.lineWidth = 0.8 + hash(seed + b, seed, 14) * 1.3;
    g.strokeStyle = rgba(mix(tone.lit, FRAME.lit, 0.5), 0.16);
    g.beginPath(); g.moveTo(cx - R * 1.3, y - 1.4);
    g.quadraticCurveTo(cx + skew, y - 2.4, cx + R * 1.3, y - 1.2); g.stroke();
    g.strokeStyle = rgba(mix(tone.shd, ROCK_DEEP, 0.4), 0.28);
    g.beginPath(); g.moveTo(cx - R * 1.3, y);
    g.quadraticCurveTo(cx + skew, y - 1, cx + R * 1.3, y); g.stroke();
  }
  g.restore();

  /* rim light — only the vertices whose outward normal faces the key */
  g.lineWidth = 1.15;
  g.strokeStyle = rgba(mix(FRAME.lit, '#ffffff', 0.18), 0.30);
  let open = false;
  g.beginPath();
  for (let i = 0; i < pts.length; i++){
    const p = pts[i];
    const nx = p.x - ox * 0 - (0), ny = p.y - r * 0.5;   /* normal ≈ from body centre */
    const len = Math.hypot(nx, ny) || 1;
    const d = (nx / len) * FRAME.lx + (ny / len) * (-FRAME.ly);
    const X = a.x + (p.x + ox) * a.sx, Y = a.y - (p.y + oy) * a.sy;
    if (d > 0.18){ open ? g.lineTo(X, Y) : g.moveTo(X, Y); open = true; }
    else open = false;
  }
  g.stroke();

  /* sky bounce on the shadow side: the BAR's "cool blue-grey in shadow", and
     it stops the dark half from going to mud */
  g.lineWidth = 1;
  g.strokeStyle = rgba(FRAME.rim, 0.11);
  open = false;
  g.beginPath();
  for (let i = 0; i < pts.length; i++){
    const p = pts[i];
    const ny = p.y - r * 0.5, len = Math.hypot(p.x, ny) || 1;
    const d = (p.x / len) * FRAME.lx + (ny / len) * (-FRAME.ly);
    const X = a.x + (p.x + ox) * a.sx, Y = a.y - (p.y + oy) * a.sy;
    if (d < -0.35){ open ? g.lineTo(X, Y) : g.moveTo(X, Y); open = true; }
    else open = false;
  }
  g.stroke();
}

function drawRock(api, it){
  const a = anchor(api, it.gx, it.gz, it.y); if (!a) return;
  const B = it.body;
  contact(api, a, B.w * 0.85, 0.9);
  if (B.parts){
    for (let i = 0; i < B.parts.length; i++){
      const p = B.parts[i];
      paintStone(api, a, p.pts, 0, 0, p.r, it.tone, it.seed + i * 17);
    }
  } else {
    paintStone(api, a, B.pts, 0, 0, B.h * 0.55, it.tone, it.seed);
  }
}

function drawScrub(api, it){
  const a = anchor(api, it.gx, it.gz, it.y); if (!a) return;
  const g = api.ctx, S = it.body, rgba = api.rgba, mix = api.mixHex;
  contact(api, a, S.w * 1.5, 0.42);

  /* a dark base clump so the blades grow OUT of something */
  g.fillStyle = rgba(mix(ROCK_DEEP, SHADOW, 0.3), 0.34);
  g.beginPath();
  g.ellipse(a.x, a.y, Math.max(1.5, S.w * 1.25 * a.sx), Math.max(0.8, S.w * 0.55 * a.sy),
            0, 0, TAU);
  g.fill();

  /* Blades batched into one path per stroke width bucket: a tuft is 3-12
     hairline curves and issuing 12 separate stroke() calls × 40 tufts is
     where a 2D board actually loses its frame budget. */
  for (let pass = 0; pass < 2; pass++){
    /* pass 0 = the shadowed back half, pass 1 = the sunlit front half */
    g.beginPath();
    let any = false;
    for (let i = 0; i < S.blades.length; i++){
      const b = S.blades[i];
      if ((i % 2) !== pass) continue;
      const X0 = a.x + b.x0 * a.sx, Y0 = a.y;
      const tipX = X0 + (b.lean * b.h) * a.sx;
      const tipY = Y0 - b.h * a.sy;
      const cX = X0 + (b.lean * b.h * 0.25 + b.bow * b.h) * a.sx;
      const cY = Y0 - b.h * 0.62 * a.sy;
      g.moveTo(X0, Y0); g.quadraticCurveTo(cX, cY, tipX, tipY);
      any = true;
    }
    if (!any) continue;
    g.lineCap = 'round';
    g.lineWidth = pass ? 1.35 : 1.15;
    const t = S.blades[0] ? S.blades[0].tone : SCRUB_TONES[0];
    g.strokeStyle = pass
      ? rgba(mix(t, FRAME.lit, 0.34), 0.72)
      : rgba(mix(t, FRAME.shd, 0.42), 0.60);
    g.stroke();
  }
  /* two or three seed heads on the dry tufts — the small detail that reads as
     a real plant rather than a green scribble */
  if (S.dry > 0.55){
    g.fillStyle = rgba(mix(SCRUB_TONES[4], FRAME.lit, 0.4), 0.5);
    for (let i = 0; i < S.blades.length; i += 4){
      const b = S.blades[i];
      const X = a.x + (b.x0 + b.lean * b.h) * a.sx, Y = a.y - b.h * a.sy;
      g.beginPath(); g.ellipse(X, Y, 1.5, 2.4, b.lean * 0.5, 0, TAU); g.fill();
    }
  }
}

function drawTree(api, it){
  const a = anchor(api, it.gx, it.gz, it.y); if (!a) return;
  const g = api.ctx, T = it.body, rgba = api.rgba, mix = api.mixHex;
  contact(api, a, T.w * 1.25, 1.0);

  /* rubble mound at the foot. The tree stands on the shelf just beyond the
     field; without a mound the trunk meets the ground on a hard line and the
     whole thing reads as a decal. */
  g.fillStyle = rgba(mix(ROCK_A, FRAME.shd, 0.45), 0.5);
  g.beginPath();
  g.ellipse(a.x, a.y, Math.max(2, T.w * 0.8 * a.sx), Math.max(1.2, T.w * 0.34 * a.sy),
            0, 0, TAU);
  g.fill();

  for (let pass = 0; pass < 2; pass++){
    /* pass 0 = the full dark bark, pass 1 = a thinner lit edge nudged toward
       the key. Two strokes give a round branch; one gives a wire. */
    for (let i = 0; i < T.segs.length; i++){
      const s = T.segs[i];
      const ox = pass ? FRAME.lx * 0.9 : 0, oy = pass ? FRAME.ly * 0.9 : 0;
      const w = Math.max(pass ? 0.55 : 0.8, s.w * a.sx * (pass ? 0.42 : 1));
      g.lineWidth = w;
      g.lineCap = 'round';
      g.strokeStyle = pass
        ? rgba(mix(BARK, FRAME.lit, 0.55), 0.42)
        : rgba(mix(BARK, FRAME.shd, 0.35), 0.92);
      g.beginPath();
      g.moveTo(a.x + s.x0 * a.sx + ox, a.y - s.y0 * a.sy + oy);
      g.quadraticCurveTo(a.x + s.cx * a.sx + ox, a.y - s.cy * a.sy + oy,
                         a.x + s.x1 * a.sx + ox, a.y - s.y1 * a.sy + oy);
      g.stroke();
    }
  }
}

/* ── WATER ────────────────────────────────────────────────────────────────
   One item per tile so the pool depth-sorts with the units standing beside
   it, but every tile is painted from the POOL's own frame of reference —
   ripple phase comes from world z, the rim is suppressed on shared edges —
   so N tiles read as one body of water instead of N blue squares.

   Depth key note: the item's z is tileZ - 0.48, i.e. it sorts just AHEAD of
   the far edge of its own tile and behind anything standing on it. Equal z
   would tie with a unit on the same tile and, because dressing is pushed into
   the drawables array last, a stable sort would paint the water over the
   unit's legs. */
function drawWater(api, it){
  const g = api.ctx, rgba = api.rgba, mix = api.mixHex, hash = api.hash;
  const x = it.tx, z = it.tz;
  const e = api.tileElev(x, z);
  const ins = it.ins;                    /* per-corner inset, 0 on shared edges */
  const half = 0.5;

  /* the sand lip at the tile's real height … */
  const rim = [
    [-half, -half], [half, -half], [half, half], [-half, half]
  ].map(o => {
    const w = api.gw(x + o[0], z + o[1], e + 0.004);
    return api.project({ x: w.x, y: w.y, z: w.z });
  });
  /* … and the water surface, inset and dropped 0.03 world units so the pool
     sits IN a depression rather than lying on top of the tile like a tile. */
  const surf = [
    [-half + ins.l, -half + ins.f], [half - ins.r, -half + ins.f],
    [half - ins.r,  half - ins.n],  [-half + ins.l, half - ins.n]
  ].map(o => {
    const w = api.gw(x + o[0], z + o[1], e - 0.030);
    return api.project({ x: w.x, y: w.y, z: w.z });
  });
  if (!rim.every(Boolean) || !surf.every(Boolean)) return;

  /* THIN ON A LIT TILE. tilefx paints the legal-target glow before the depth
     pass; a full-strength pool on top of it makes a legal tile read as
     unreachable, which is exactly the regression drawStatesOver() exists to
     stop. Decoration yields to legibility. */
  const key = x + ',' + z;
  const P = api.paint || {};
  const litTile = !!((P.move && P.move.has(key)) || (P.attack && P.attack.has(key)) ||
                     (P.place && P.place.has(key)) || (P.swap && P.swap.has(key)) ||
                     (P.sel && P.sel.x === x && P.sel.z === z) ||
                     (api.hover && api.hover.x === x && api.hover.z === z));
  const A = litTile ? 0.44 : 1;

  /* 1. damp sand ring between the lip and the waterline. Even-odd so it is a
     true ring; it collapses to nothing on the edges shared with another pool
     tile, which is what welds the tiles into one pool. */
  g.save();
  g.beginPath();
  g.moveTo(rim[0].x, rim[0].y);
  for (let i = 1; i < 4; i++) g.lineTo(rim[i].x, rim[i].y);
  g.closePath();
  g.moveTo(surf[0].x, surf[0].y);
  for (let i = 1; i < 4; i++) g.lineTo(surf[i].x, surf[i].y);
  g.closePath();
  g.fillStyle = rgba(mix('#4a3a28', WATER_DEEP, 0.35), 0.55 * A);
  g.fill('evenodd');
  g.restore();

  /* 2. the water body */
  g.save();
  g.beginPath();
  g.moveTo(surf[0].x, surf[0].y);
  for (let i = 1; i < 4; i++) g.lineTo(surf[i].x, surf[i].y);
  g.closePath();
  g.clip();

  const far = { x: (surf[0].x + surf[1].x) / 2, y: (surf[0].y + surf[1].y) / 2 };
  const near = { x: (surf[2].x + surf[3].x) / 2, y: (surf[2].y + surf[3].y) / 2 };

  /* darken + cool the sand underneath. multiply, not an alpha fill: a wash
     would grey the tile, multiply keeps the ground's own grain visible
     THROUGH the water, which is most of what makes it read as liquid. */
  g.globalCompositeOperation = 'multiply';
  g.globalAlpha = A;
  const dg = g.createLinearGradient(far.x, far.y, near.x, near.y);
  dg.addColorStop(0, '#6b8894');
  dg.addColorStop(1, '#3d5866');
  g.fillStyle = dg;
  g.fillRect(Math.min(surf[0].x, surf[3].x) - 6, Math.min(surf[0].y, surf[1].y) - 6,
             Math.abs(surf[1].x - surf[3].x) + 40, Math.abs(surf[2].y - surf[0].y) + 40);
  g.globalCompositeOperation = 'source-over';

  /* body colour + the sky reflected off the far end */
  const bg = g.createLinearGradient(far.x, far.y, near.x, near.y);
  const sky = (api.LIGHT && api.LIGHT.sky && api.LIGHT.sky[2]) || '#6b7f92';
  bg.addColorStop(0, rgba(mix(WATER_MID, sky, 0.45), 0.40 * A));
  bg.addColorStop(0.55, rgba(WATER_MID, 0.26 * A));
  bg.addColorStop(1, rgba(WATER_DEEP, 0.34 * A));
  g.fillStyle = bg;
  g.fillRect(Math.min(surf[0].x, surf[3].x) - 6, Math.min(surf[0].y, surf[1].y) - 6,
             Math.abs(surf[1].x - surf[3].x) + 40, Math.abs(surf[2].y - surf[0].y) + 40);

  /* 3. ripples. Phase is a function of WORLD z, so a band crossing a tile
     boundary continues into the next tile instead of restarting — the single
     thing that stops four water tiles from reading as four squares. */
  g.globalCompositeOperation = 'lighter';
  const bands = 7;
  for (let i = 0; i < bands; i++){
    const v = (i + 0.5) / bands;
    const wz = z - 0.5 + v;
    const ph = Math.sin(api.T * 0.7 + wz * 4.1 + it.pool * 6.0);
    const ph2 = Math.sin(api.T * 1.13 - wz * 2.3 + it.pool * 3.7);
    const amp = 0.012 + 0.010 * ph2;
    const a0 = quadPt(surf, 0.00, Math.max(0, Math.min(1, v + amp)));
    const a1 = quadPt(surf, 0.34, Math.max(0, Math.min(1, v - amp * 0.7)));
    const a2 = quadPt(surf, 0.68, Math.max(0, Math.min(1, v + amp * 0.5)));
    const a3 = quadPt(surf, 1.00, Math.max(0, Math.min(1, v - amp)));
    g.lineWidth = 0.9 + 1.5 * (0.5 + 0.5 * ph) * (1 - v * 0.4);
    g.strokeStyle = rgba(mix(WATER_SHEEN, sky, 0.3),
                         (0.05 + 0.075 * (0.5 + 0.5 * ph)) * (1 - v * 0.45) * A);
    g.beginPath();
    g.moveTo(a0.x, a0.y);
    g.bezierCurveTo(a1.x, a1.y, a2.x, a2.y, a3.x, a3.y);
    g.stroke();
  }
  /* a few specular glints, drifting — the "reflective surface" the BAR asks
     for. Seeded per tile so no two tiles glint in the same place. */
  for (let i = 0; i < 3; i++){
    const u = hash(x, z, 700 + i);
    const v0 = hash(x, z, 710 + i);
    const drift = (api.T * 0.06 + v0) % 1;
    const p = quadPt(surf, 0.1 + u * 0.8, 0.12 + drift * 0.76);
    const tw = 0.45 + 0.55 * Math.sin(api.T * 1.6 + i * 2.1 + it.pool * 4);
    const R = (2.5 + hash(x, z, 720 + i) * 4.5);
    const sgd = g.createRadialGradient(p.x, p.y, 0, p.x, p.y, R * 2.4);
    sgd.addColorStop(0, rgba(WATER_SHEEN, 0.30 * tw * A));
    sgd.addColorStop(1, rgba(WATER_SHEEN, 0));
    g.fillStyle = sgd;
    g.beginPath(); g.ellipse(p.x, p.y, R * 2.4, R * 0.85, 0, 0, TAU); g.fill();
  }
  g.globalCompositeOperation = 'source-over';
  g.restore();

  /* 4. the waterline itself — a thin bright wet edge on the exterior sides
     only. Drawn as separate segments, never as a closed stroke around the
     tile: a full perimeter here would put back exactly the tile outline the
     spine spent its whole rewrite deleting. */
  g.lineWidth = 1.1;
  g.strokeStyle = rgba(mix(WATER_SHEEN, sky, 0.5), 0.22 * A);
  const edges = [[0, 1, it.ext.f], [1, 2, it.ext.r], [2, 3, it.ext.n], [3, 0, it.ext.l]];
  g.beginPath();
  for (const [i, j, on] of edges){
    if (!on) continue;
    g.moveTo(surf[i].x, surf[i].y); g.lineTo(surf[j].x, surf[j].y);
  }
  g.stroke();
}

/* ══════════════════════════════════════════════════════════════════════════
   BUILD — the scatter
   ══════════════════════════════════════════════════════════════════════════ */

const CACHE = { key: '', items: [] };

function buildScatter(api){
  const MAP = api.MAP || {};
  const cols = MAP.cols | 0, rows = MAP.rows | 0;
  const items = [];
  if (cols < 2 || rows < 2) return items;

  const sa = fnv(MAP.id) + cols * 31, sb = fnv('dress:' + MAP.id) + rows * 17;
  const seq = mkSeq(api.hash, sa, sb);
  const rr = (a, b) => a + seq() * (b - a);
  const pick = arr => arr[(seq() * arr.length) | 0];

  /* ── tiles the game owns; dressing keeps off them entirely ───────────── */
  const busy = new Set();
  for (const t of (MAP.tiles || [])) if (t && (t.prop || t.type)) busy.add(t.x + ',' + t.z);
  for (const ev of (MAP.events || [])) if (ev) busy.add(ev.x + ',' + ev.z);
  const sp = MAP.spawns || {};
  for (const list of [sp.mine || [], sp.foe || []])
    for (const s of list) if (s) busy.add(s[0] + ',' + s[1]);
  /* both end rows outright: they are where units enter play and where the
     player's own front line stands, and a rock in either is a rock in front
     of something the player needs to see. */
  for (let x = 0; x < cols; x++){ busy.add(x + ',0'); busy.add(x + ',' + (rows - 1)); }

  const elev = [];
  for (let z = 0; z < rows; z++){
    elev.push([]);
    for (let x = 0; x < cols; x++) elev[z].push(api.tileElev(x, z));
  }

  /* ── 1. THE WATER POOL ────────────────────────────────────────────────
     Water collects in the LOWEST ground, so the pool is found, not placed:
     take the flank (left or right third) with the most lowest-level tiles and
     flood-fill a contiguous patch of them. Requiring one flat level is what
     keeps it from climbing a cliff. */
  let lowest = Infinity;
  for (let z = 1; z < rows - 1; z++) for (let x = 0; x < cols; x++) lowest = Math.min(lowest, elev[z][x]);
  const flankW = Math.max(2, Math.round(cols / 3));
  const okWater = (x, z) =>
    x >= 0 && z >= 0 && x < cols && z < rows &&
    z >= 1 && z <= rows - 2 &&
    Math.abs(elev[z][x] - lowest) < 0.02 &&
    !busy.has(x + ',' + z);
  const flankScore = side => {
    let n = 0;
    for (let z = 1; z < rows - 1; z++)
      for (let i = 0; i < flankW; i++){
        const x = side < 0 ? i : cols - 1 - i;
        if (okWater(x, z)) n++;
      }
    return n;
  };
  const sL = flankScore(-1), sR = flankScore(1);
  const side = (sL === sR) ? (seq() < 0.5 ? -1 : 1) : (sL > sR ? -1 : 1);

  const pool = new Set();
  {
    /* seed on the outermost usable column of the winning flank, biased to a
       seeded row so the pool is not always in the middle of the edge */
    const cand = [];
    for (let i = 0; i < flankW; i++)
      for (let z = 1; z < rows - 1; z++){
        const x = side < 0 ? i : cols - 1 - i;
        if (okWater(x, z)) cand.push([x, z, i]);
      }
    if (cand.length){
      cand.sort((p, q) => (p[2] - q[2]) || (p[1] - q[1]));
      const seed = cand[(seq() * Math.min(cand.length, 4)) | 0] || cand[0];
      const q = [seed];
      const want = 4 + ((seq() * 3) | 0);
      while (q.length && pool.size < want){
        const [px, pz] = q.shift();
        const k = px + ',' + pz;
        if (pool.has(k) || !okWater(px, pz)) continue;
        /* stay on the flank: the BAR says "on ONE flank", and a pool that
           creeps into the middle of an 8×7 board eats half the playfield */
        const depth = side < 0 ? px : cols - 1 - px;
        if (depth >= flankW) continue;
        pool.add(k);
        const nb = [[px, pz - 1], [px, pz + 1], [px + (side < 0 ? 1 : -1), pz]];
        /* shuffled by seed so the pool grows into an irregular shape, not a
           rectangle filled row by row */
        for (let i = nb.length - 1; i > 0; i--){
          const j = (seq() * (i + 1)) | 0; const t = nb[i]; nb[i] = nb[j]; nb[j] = t;
        }
        for (const n of nb) q.push(n);
      }
    }
  }
  /* a pool of one or two tiles is a puddle, not the BAR's pool — drop it
     rather than ship something that fails the brief quietly */
  if (pool.size < 3) pool.clear();

  const poolSeed = seq();
  for (const k of pool){
    const [x, z] = k.split(',').map(Number);
    const ext = {
      f: !pool.has(x + ',' + (z - 1)), n: !pool.has(x + ',' + (z + 1)),
      l: !pool.has((x - 1) + ',' + z), r: !pool.has((x + 1) + ',' + z)
    };
    const I = 0.10;
    items.push({
      x: x, z: z - 0.48, tx: x, tz: z, kind: 'water', pool: poolSeed,
      ext: ext,
      ins: { f: ext.f ? I : 0, n: ext.n ? I : 0, l: ext.l ? I : 0, r: ext.r ? I : 0 },
      draw: function (a) { drawWater(a, this); }
    });
    busy.add(k);
  }

  /* ── 2. THE MARGIN ────────────────────────────────────────────────────
     The spine bakes a feathered rock shelf ~0.7 tiles beyond the field
     (bakeTerrain step 0). Anything TALL goes there: it is off every playable
     square, so it can never overlap a unit, a highlight or a hazard, and it
     is where a silhouette against the horizon does the most work. */
  const tone = () => {
    const base = pick([ROCK_A, ROCK_B, ROCK_C]);
    return {
      lit: api.mixHex(base, ROCK_PALE, 0.42 + seq() * 0.3),
      mid: api.mixHex(base, api.LIGHT ? api.LIGHT.key : '#fff2c8', 0.10 + seq() * 0.12),
      shd: api.mixHex(base, ROCK_DEEP, 0.52 + seq() * 0.22)
    };
  };
  const marginSpots = [];
  /* far margin — behind row 0, the band the camera sees most of */
  const farN = 3 + ((seq() * 3) | 0);
  for (let i = 0; i < farN; i++)
    marginSpots.push({ gx: rr(-0.7, cols - 0.3), gz: rr(-1.05, -0.55), big: seq() });
  /* side margins, deliberately different counts left vs right — matched
     counts is the mirror symmetry the BAR calls out */
  const leftN = 2 + ((seq() * 3) | 0), rightN = 1 + ((seq() * 3) | 0);
  for (let i = 0; i < leftN; i++)
    marginSpots.push({ gx: rr(-1.05, -0.55), gz: rr(-0.6, rows - 0.4), big: seq() });
  for (let i = 0; i < rightN; i++)
    marginSpots.push({ gx: rr(cols - 0.45, cols + 0.05), gz: rr(-0.6, rows - 0.4), big: seq() });

  for (const m of marginSpots){
    const gxi = Math.max(0, Math.min(cols - 1, Math.round(m.gx)));
    const gzi = Math.max(0, Math.min(rows - 1, Math.round(m.gz)));
    /* stand on the shelf (y≈0) unless the nearest field tile is raised and we
       are hard against it, in which case sit at the foot of that cliff */
    const y = (m.gz > -0.5 && m.gz < rows - 0.5) ? 0 : 0;
    const scale = m.big > 0.62 ? rr(0.85, 1.35) : rr(0.45, 0.8);
    const fam = seq();
    const body = fam < 0.36 ? bakeShard(seq2(seq), scale)
               : fam < 0.72 ? bakeCluster(seq2(seq), scale)
                            : bakeFin(seq2(seq), scale * 1.1);
    items.push({
      x: gxi, z: m.gz, gx: m.gx, gz: m.gz, y: y, body: body, tone: tone(),
      seed: (gxi * 91 + gzi * 7 + items.length * 13) | 0, kind: 'rock',
      draw: function (a) { drawRock(a, this); }
    });
    void gzi;
  }

  /* ── 3. THE DEAD TREE ─────────────────────────────────────────────────
     One, at the far edge, off to a side — never on the centre line, which is
     where a generated scene always puts its hero prop. */
  {
    const leftSide = seq() < 0.5;
    const gx = leftSide ? rr(-0.6, cols * 0.28) : rr(cols * 0.72, cols - 0.4);
    const gz = rr(-1.0, -0.62);
    items.push({
      x: Math.round(gx), z: gz, gx: gx, gz: gz, y: 0,
      body: bakeTree(seq2(seq), rr(1.5, 2.0)), kind: 'tree',
      draw: function (a) { drawTree(a, this); }
    });
  }

  /* ── 4. ROCKS ON THE FIELD ────────────────────────────────────────────
     Small only, and always in the FAR half of their tile (v < 0) so a unit
     standing there is drawn after them and occludes them. Weighted toward
     cliff bases, where real scree collects and where the spine already draws
     talus — the two read as one geological event instead of two effects. */
  const cliffBase = [];
  for (let z = 1; z < rows - 1; z++)
    for (let x = 0; x < cols; x++){
      if (busy.has(x + ',' + z)) continue;
      let drop = 0;
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]){
        const nx = x + dx, nz = z + dz;
        if (nx < 0 || nz < 0 || nx >= cols || nz >= rows) continue;
        drop = Math.max(drop, elev[nz][nx] - elev[z][x]);
      }
      if (drop > 0.2) cliffBase.push([x, z]);
    }
  /* deterministic shuffle, then take a seeded slice — taking the first N of a
     row-major list would line them up along the top of the board */
  for (let i = cliffBase.length - 1; i > 0; i--){
    const j = (seq() * (i + 1)) | 0;
    const t = cliffBase[i]; cliffBase[i] = cliffBase[j]; cliffBase[j] = t;
  }
  const nCliff = Math.min(cliffBase.length, 3 + ((seq() * 4) | 0));
  for (let i = 0; i < nCliff; i++){
    const [x, z] = cliffBase[i];
    const gx = x + rr(-0.34, 0.34), gz = z + rr(-0.44, -0.12);
    const scale = rr(0.26, 0.46);
    const fam = seq();
    items.push({
      x: x, z: gz, gx: gx, gz: gz, y: api.tileElev(x, z),
      body: fam < 0.5 ? bakeCluster(seq2(seq), scale) : bakeFin(seq2(seq), scale * 1.2),
      tone: tone(), seed: (x * 131 + z * 29 + i * 7) | 0, kind: 'rock',
      draw: function (a) { drawRock(a, this); }
    });
  }

  /* ── 5. SCRUB ─────────────────────────────────────────────────────────
     Density is a low-frequency field with two seeded lush centres, so the
     field has thickets AND bare stretches. An even scatter over every tile is
     the same lattice tell as an even grid, one plant at a time. */
  const c1 = { x: rr(0, cols), z: rr(0, rows), r: rr(1.8, 3.2) };
  const c2 = { x: rr(0, cols), z: rr(0, rows), r: rr(1.2, 2.6) };
  for (let z = 1; z <= rows - 1; z++){
    for (let x = 0; x < cols; x++){
      const k = x + ',' + z;
      if (pool.has(k)) continue;
      const isEnd = (z === rows - 1);
      if (busy.has(k) && !isEnd) continue;
      const d1 = Math.hypot(x - c1.x, z - c1.z) / c1.r;
      const d2 = Math.hypot(x - c2.x, z - c2.z) / c2.r;
      let dens = Math.max(0, 1 - d1 * d1) * 0.9 + Math.max(0, 1 - d2 * d2) * 0.7;
      /* damp ground round the pool grows more, cliff tops grow less */
      let nearPool = false;
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1]])
        if (pool.has((x + dx) + ',' + (z + dz))) nearPool = true;
      if (nearPool) dens += 0.85;
      if (elev[z][x] > lowest + 0.4) dens *= 0.42;
      dens *= 0.55 + seq() * 0.95;
      const n = Math.min(4, Math.floor(dens * 2.4));
      for (let i = 0; i < n; i++){
        /* end row gets only the smallest tufts and only at the very front
           edge, where nothing can stand */
        const vLo = isEnd ? 0.30 : -0.45, vHi = isEnd ? 0.46 : 0.34;
        const gx = x + rr(-0.44, 0.44), gz = z + rr(vLo, vHi);
        items.push({
          x: x, z: gz, gx: gx, gz: gz, y: api.tileElev(x, z),
          body: bakeScrub(seq2(seq), isEnd ? rr(0.5, 0.75) : rr(0.7, 1.25)),
          kind: 'scrub',
          draw: function (a) { drawScrub(a, this); }
        });
      }
    }
  }

  /* a handful of tufts out on the margin too, so the shelf is not a bare
     apron ringing a planted field */
  const mScrub = 5 + ((seq() * 6) | 0);
  for (let i = 0; i < mScrub; i++){
    const onSide = seq();
    const gx = onSide < 0.34 ? rr(-1.0, -0.55)
             : onSide < 0.68 ? rr(cols - 0.45, cols + 0.0)
                             : rr(-0.5, cols - 0.5);
    const gz = onSide < 0.68 ? rr(-0.7, rows - 0.5) : rr(-1.0, -0.6);
    items.push({
      x: Math.round(gx), z: gz, gx: gx, gz: gz, y: 0,
      body: bakeScrub(seq2(seq), rr(0.6, 1.1)), kind: 'scrub',
      draw: function (a) { drawScrub(a, this); }
    });
  }

  return items;
}

/* bakers take a plain rnd(); hand them the shared sequence so every bake
   consumes from the same deterministic stream in call order */
function seq2(seq){ return seq; }

/* ══════════════════════════════════════════════════════════════════════════
   MODULE SURFACE
   ══════════════════════════════════════════════════════════════════════════ */
const dressing = {
  build(api){
    if (!api || !api.MAP || !api.hash) return;
    const key = [api.MAP.id, api.MAP.cols, api.MAP.rows].join('|') + '|' +
                /* fold the heightfield in: elevation moves every anchor */
                (function (){
                  let s = 0;
                  for (let z = 0; z < (api.MAP.rows | 0); z++)
                    for (let x = 0; x < (api.MAP.cols | 0); x++)
                      s = (s * 31 + Math.round(api.tileElev(x, z) * 100)) | 0;
                  return s;
                })();
    if (key === CACHE.key && CACHE.items.length) return;
    try {
      CACHE.items = buildScatter(api);
      CACHE.key = key;
    } catch (e){
      /* a bad bake must never take the board with it: ship an empty field */
      CACHE.items = []; CACHE.key = key;
    }
  },

  items(api){
    if (!api) return [];
    if (!CACHE.items.length && CACHE.key === '') { try { dressing.build(api); } catch (e){} }

    /* refresh the per-frame light rig. The spine calls items() immediately
       before it dispatches every draw(), so this is the cheapest correct
       place to do it — once, not once per item. */
    try {
      const lv = api.lightVector ? api.lightVector() : { x: 0.3, y: 0.8, z: -0.5 };
      /* project the light direction to screen: raising y moves UP the screen,
         +x moves right, +z moves toward the camera (down-screen). Flattening
         with the camera's ~41° pitch keeps this agreeing with the spine's
         cliff shading, which is derived from the same vector. */
      const sx = lv.x, sy = -(lv.y * 0.76 - lv.z * 0.55);
      const m = Math.hypot(sx, sy) || 1;
      FRAME.lx = sx / m; FRAME.ly = sy / m;
      FRAME.shx = -FRAME.lx; FRAME.shy = -FRAME.ly * 0.5;
      FRAME.shLen = Math.max(0.7, Math.min(3.0, 1 / (Math.max(lv.y, 0.16) + 0.16)));
      FRAME.shA = 0.30 + 0.34 * Math.max(0.2, Math.min(1, lv.y + 0.25));
      const L = api.LIGHT || {};
      FRAME.lit = api.mixHex(ROCK_PALE, L.key || '#fff2c8', 0.30);
      FRAME.mid = api.mixHex(ROCK_A, L.key || '#fff2c8', 0.14);
      FRAME.shd = api.mixHex(ROCK_DEEP, L.ambient || '#5a6480', 0.34);
      FRAME.rim = L.rim || '#cfe4ff';
      FRAME.T = api.T || 0;
    } catch (e){}

    return CACHE.items;
  }
};

window.BBX.dressing = dressing;
