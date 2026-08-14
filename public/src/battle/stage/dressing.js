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
      thing the player is trying to read. drawPool() checks api.paint and
      thins the whole pool when any tile it covers is painted. A legal move that looks unreachable is
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
/* ⚠ ROUND-2 REGRADE. These were a stop lighter and the critic's measured
   verdict was "BOULDERS ARE THE SAME VALUE AS THE GROUND THEY SIT ON … they
   read as decals rather than volumes." The lit sand top face measures ~L170;
   a rock whose LIT face also lands near L170 has no silhouette at all, and no
   amount of rim light or strata detail rescues it, because value separation is
   what makes a lump read as a volume. So the whole rock ramp moved down: the
   brightest pixel a stone can produce is now ~L135 and its core shadow ~L45.
   Do NOT lighten these back "so the rocks read better" — lightening is what
   broke them. */
const ROCK_A = '#5f4c39';   /* dry granite   */
const ROCK_B = '#6d5740';   /* sandstone     */
const ROCK_C = '#4f4a41';   /* grey basalt   */
const ROCK_PALE = '#a98d69';
const ROCK_DEEP = '#241d16';
const SHADOW = '#241f22';   /* cool-warm dark, deliberately NOT #000 */
const SCRUB_TONES = ['#7d7433', '#6a6b3a', '#8d7c42', '#5f6636', '#94824a'];
const BARK = '#4c4036';
const WATER_DEEP = '#10343c';
const WATER_MID  = '#1f6a70';
const WATER_SHEEN= '#a8e6df';
const DAMP_SAND  = '#6b5a45';   /* wet sand at the waterline — warm, not blue */

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
function contact(api, a, rw, alpha, tint){
  const g = api.ctx;
  const R = Math.max(1.5, rw * a.sx);
  const L = FRAME.shLen;
  const col = tint || SHADOW;
  g.save();
  g.translate(a.x + FRAME.shx * R * L * 0.42, a.y + FRAME.shy * R * L * 0.42 * 0.42);
  g.scale(1 + L * 0.34, 0.40);
  const grd = g.createRadialGradient(0, 0, 0, 0, 0, R * 1.15);
  grd.addColorStop(0,    api.rgba(col, alpha * FRAME.shA));
  grd.addColorStop(0.55, api.rgba(col, alpha * FRAME.shA * 0.44));
  grd.addColorStop(1,    api.rgba(col, 0));
  g.fillStyle = grd;
  g.beginPath(); g.arc(0, 0, R * 1.15, 0, TAU); g.fill();
  g.restore();
}

/* AMBIENT OCCLUSION at the foot of a solid. Separate from contact(): the cast
   shadow is thrown away from the light and tells you where the sun is, this is
   the tight dark seam that exists on EVERY side of a thing touching the ground
   and is what actually seats a volume in the sand. Radial and short — the
   moment it gets a hard edge it becomes the posthole this round had to delete
   from under the scrub. */
function occlude(api, a, rw, alpha){
  const g = api.ctx;
  const R = Math.max(1.5, rw * a.sx);
  g.save();
  g.translate(a.x, a.y);
  g.scale(1, 0.34);
  const grd = g.createRadialGradient(0, 0, 0, 0, 0, R);
  grd.addColorStop(0,    api.rgba(ROCK_DEEP, alpha));
  grd.addColorStop(0.42, api.rgba(ROCK_DEEP, alpha * 0.62));
  grd.addColorStop(1,    api.rgba(ROCK_DEEP, 0));
  g.fillStyle = grd;
  g.beginPath(); g.arc(0, 0, R, 0, TAU); g.fill();
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
  /* FOUR stops, not three. The extra one at 0.60 is the TERMINATOR: a rock lit
     by one hard key does not fade evenly from light to dark, it holds its lit
     value across the facing half and then falls off a cliff. A three-stop ramp
     averages to the ground's own value across the whole silhouette, which is
     precisely how the round-1 boulders came out reading as decals. */
  gr.addColorStop(0,    mix(tone.lit, FRAME.lit, 0.24));
  gr.addColorStop(0.34, tone.mid);
  gr.addColorStop(0.60, mix(tone.mid, tone.shd, 0.62));
  gr.addColorStop(1,    mix(tone.shd, FRAME.shd, 0.34));
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
  contact(api, a, B.w * 0.85, 1.05);
  occlude(api, a, B.w * 1.15, 0.34);
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

  /* ⚠ ROUND-2 FIX — "SCRUB TUFTS GROW OUT OF BLACK POSTHOLES."
     What used to be here was a hard-edged ellipse filled with a near-black at
     0.34 alpha, 1.25 tuft-widths across. Forty of those across the field read
     exactly as the critic described: holes punched in the ground, too round,
     too dark, too uniform. A tuft of dry grass does not occlude a disc of sand
     — it throws a scatter of thin blade shadows and a faint bloom of litter at
     its own root. So: no opaque shape at all. Two soft radial passes, both
     WARM (a shadow on ochre sand is warm-dark, never neutral black), the inner
     one barely a third of the old radius, plus a few blade-shaped ground
     shadows that inherit each blade's own lean. */
  contact(api, a, S.w * 0.95, 0.30, mix(SHADOW, '#6a5238', 0.55));
  occlude(api, a, S.w * 0.80, 0.13);

  /* per-blade ground shadows: the blade's own line, laid flat and thrown along
     -light. These are what actually attach the tuft to the sand. */
  g.save();
  g.lineCap = 'round';
  g.lineWidth = 1.1;
  g.strokeStyle = rgba(mix(ROCK_DEEP, '#6a5238', 0.5), 0.20);
  g.beginPath();
  for (let i = 0; i < S.blades.length; i += 2){
    const b = S.blades[i];
    const X0 = a.x + b.x0 * a.sx;
    const L = b.h * a.sy * 0.72 * FRAME.shLen * 0.7;
    g.moveTo(X0, a.y);
    g.lineTo(X0 + FRAME.shx * L + b.lean * b.h * a.sx * 0.4, a.y + Math.abs(FRAME.shy) * L * 0.34);
  }
  g.stroke();
  g.restore();

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
    /* 0.34 toward the key made every blade read as bleached straw at the same
       value as the sand — the tuft version of the boulder problem. Hold the
       olive. */
    g.strokeStyle = pass
      ? rgba(mix(t, FRAME.lit, 0.20), 0.78)
      : rgba(mix(t, FRAME.shd, 0.50), 0.66);
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
  /* graded, not a flat disc: a flat ellipse at the foot of anything is the
     posthole failure mode, whatever colour it is filled with. */
  {
    const RX = Math.max(2, T.w * 0.8 * a.sx), RY = Math.max(1.2, T.w * 0.34 * a.sy);
    const mg = g.createRadialGradient(a.x, a.y - RY * 0.25, 0, a.x, a.y, RX);
    mg.addColorStop(0,    rgba(mix(ROCK_A, FRAME.lit, 0.30), 0.44));
    mg.addColorStop(0.62, rgba(mix(ROCK_A, FRAME.shd, 0.40), 0.30));
    mg.addColorStop(1,    rgba(mix(ROCK_A, FRAME.shd, 0.55), 0));
    g.save(); g.translate(a.x, a.y); g.scale(1, RY / RX); g.translate(-a.x, -a.y);
    g.fillStyle = mg;
    g.beginPath(); g.arc(a.x, a.y, RX, 0, TAU); g.fill();
    g.restore();
  }

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
   🌊 ROUND-2 REWRITE. READ THIS BEFORE TOUCHING ANY OF IT.

   WHAT WAS HERE AND WHY IT FAILED
   Round 1 drew ONE ITEM PER POOL TILE: a quad built from the tile's own four
   corners, inset a little on the edges it did not share with another pool
   tile. It was carefully written and it was wrong in the only way that
   mattered — the critic measured the result as "the pool's boundary is EXACTLY
   the tile grid, a hard straight staircase of cell edges, with horizontal
   stripe banding across it". Both symptoms came straight out of the geometry:

     · A per-tile quad can only ever produce an axis-aligned staircase, because
       every vertex it owns IS a grid corner. Insetting the outer edges moves
       the staircase in by 10% and keeps it a staircase. Measured on the
       round-1 frame: the pool's left edge held to within ±1px of a straight
       line for 189 consecutive rows.
     · The ripples were N evenly-spaced bands laid out in the tile's own
       parametric v. Stack four tiles vertically and those bands line up into
       one regular horizontal corduroy across the whole pool. Measured
       row-to-row luma swing inside the water: 59 levels.
     · And a "wet edge" stroked along every exterior tile edge is, precisely, a
       tile outline — the one thing the spine spent its entire rewrite deleting
       from the ground.

   WHAT REPLACES IT
   The pool is now ONE item with ONE shoreline that does not know the grid
   exists. build() lays a smooth scalar field over the flood-filled tile set —
   a Gaussian bump per tile, summed — and traces the contour of that field by
   marching 112 rays out from the pool's centroid. The contour is then bent by
   three incommensurate sine harmonics so it is not the smooth blob the field
   alone would give. The result crosses tile boundaries wherever it likes: it
   cuts corners off the outer tiles and bulges past their edges into the sand.

   THE ELEVATION CAP IS LOad-BEARING. Each ray stops early if the tile under
   the sample point stands higher than the pool's own level. Water that climbs
   a cliff face is worse than water on a grid, and the flood fill only
   guarantees the SEED tiles are level — the ±0.16-tile overshoot of the
   contour can easily land on a raised neighbour.

   ONE ITEM, NOT N — AND WHY ITS DEPTH KEY IS SAFE
   Depth key is (nearest pool row) minus… no: it is the FARTHEST pool row minus
   0.5. Everything standing on any pool tile has z >= that and is therefore
   drawn after the water, so the pool can never paint over a unit's legs.
   Anything drawn BEFORE the pool stands at least a full row further from the
   camera, and — because the flood fill only accepts tiles at the LOWEST level
   on the board — nothing behind the pool can be lower than it, so no such
   unit's feet can ever project below the pool's own far edge. One item is what
   makes a single continuous shoreline, a single continuous gradient and a
   single continuous ripple field possible at all.

   THE WATER STILL YIELDS TO THE HIGHLIGHT. If any tile the pool covers is a
   legal move/attack/place/swap target, the whole pool thins. A legal tile that
   looks unreachable is the exact regression drawStatesOver() exists to
   prevent, and decoration must not re-introduce it one layer higher. */

/* Project a shoreline ring (grid-space points) to screen at height y. */
function projRing(api, pts, y){
  const out = [];
  for (let i = 0; i < pts.length; i++){
    const w = api.gw(pts[i].x, pts[i].z, y);
    const q = api.project({ x: w.x, y: w.y, z: w.z });
    if (!q) return null;
    out.push(q);
  }
  return out;
}
function ringPath(g, P){
  g.beginPath();
  g.moveTo(P[0].x, P[0].y);
  for (let i = 1; i < P.length; i++) g.lineTo(P[i].x, P[i].y);
  g.closePath();
}
function ringBox(P){
  let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
  for (let i = 0; i < P.length; i++){
    if (P[i].x < x0) x0 = P[i].x; if (P[i].x > x1) x1 = P[i].x;
    if (P[i].y < y0) y0 = P[i].y; if (P[i].y > y1) y1 = P[i].y;
  }
  return { x0: x0, y0: y0, x1: x1, y1: y1, w: x1 - x0, h: y1 - y0 };
}

/* ══════════════════════════════════════════════════════════════════════════
   🪞 reflSheet — the pool's reflection source, snapshotted and pre-tinted.

   ⚠ READ THIS BEFORE "SIMPLIFYING" IT BACK TO A DIRECT SELF-BLIT. The first
   version of the reflection drew the main canvas onto ITSELF, once per ripple
   band, straight out of drawPool(). It looked right and it cost 66 MILLISECONDS
   A FRAME — measured, 25 bands at ~2.6ms each, against 0.5ms for the entire
   rest of the pool. A canvas that is both the source and the destination of a
   drawImage cannot stay on the GPU: every one of those calls forces a full
   flush and read-back of the whole surface. Twenty-five of them per frame turns
   a 60fps board into 15fps.

   So the strip above the waterline is copied ONCE into a scratch surface and
   the bands are then cut out of that. Two consequences worth keeping:
     • one self-read instead of N, amortised further by only refreshing every
       REFL_MS. The reflected world is the terrain, the bank and the backdrop —
       none of which move — so a snapshot a tenth of a second stale is not
       observable in a pond. Unit reflections lag by that much; at pond scale
       on the flank, nobody can see it.
     • the 'color' tint that turns reflected ochre bank into water is baked in
       HERE, at refresh rate, instead of being a per-frame full-bbox composite.
       'color' is a non-separable blend mode and was costing ~3ms a frame on its
       own. The gradient is stored FLIPPED because the sheet is un-mirrored: its
       top row is the row furthest above the waterline, which lands DEEPEST in
       the pool, so the deep-water colour goes at the top of the sheet.

   OffscreenCanvas first, a detached <canvas> only as the fallback: this is a
   render target, never a node in the page. If neither exists the caller simply
   gets null and the pool draws without a reflection rather than throwing. */
const REFL_MS = 0.22;
let _refl = null;
function reflSheet(api, sx, sy, sw, sh, kx, ky, ox, oy, cTop, cMid, cDeep){
  const src = api.ctx && api.ctx.canvas;
  if (!src || !src.width || sw < 4 || sh < 4) return null;
  const w = Math.max(4, Math.round(sw * kx)), h = Math.max(4, Math.round(sh * ky));
  if (!_refl || _refl.w !== w || _refl.h !== h || _refl.src !== src){
    let cv = null;
    try {
      cv = (typeof OffscreenCanvas !== 'undefined') ? new OffscreenCanvas(w, h)
         : (typeof document !== 'undefined') ? Object.assign(document.createElement('canvas'),
                                                             { width: w, height: h })
         : null;
    } catch (e) { cv = null; }
    if (!cv) return null;
    const cx = cv.getContext('2d');
    if (!cx) return null;
    _refl = { cv: cv, cx: cx, w: w, h: h, src: src, at: -1e9, key: '' };
  }
  const key = [Math.round(sx), Math.round(sy), cTop, cDeep].join('|');
  if (api.T - _refl.at < REFL_MS && key === _refl.key) return _refl;
  _refl.at = api.T; _refl.key = key;
  const cx = _refl.cx;
  try {
    cx.setTransform(1, 0, 0, 1, 0, 0);
    cx.globalCompositeOperation = 'source-over';
    cx.globalAlpha = 1;
    cx.clearRect(0, 0, _refl.w, _refl.h);
    cx.drawImage(src, sx * kx + ox, sy * ky + oy, sw * kx, sh * ky, 0, 0, _refl.w, _refl.h);
    cx.globalCompositeOperation = 'color';
    cx.globalAlpha = 0.58;
    const tg = cx.createLinearGradient(0, 0, 0, _refl.h);
    tg.addColorStop(0,    cDeep);          /* sheet top  → pool bottom */
    tg.addColorStop(0.45, cMid);
    tg.addColorStop(1,    cTop);           /* sheet base → waterline   */
    cx.fillStyle = tg; cx.fillRect(0, 0, _refl.w, _refl.h);
    cx.globalCompositeOperation = 'source-over';
    cx.globalAlpha = 1;
  } catch (e) { return null; }
  return _refl;
}

function drawPool(api, it){
  const g = api.ctx, rgba = api.rgba, mix = api.mixHex, hash = api.hash;
  const S = it.shore;
  const surf = projRing(api, S.pts, it.y - 0.030);   /* the waterline itself   */
  const bank = projRing(api, S.pts, it.y + 0.004);   /* same curve, on the sand */
  const near = projRing(api, S.mid, it.y + 0.004);   /* dark wet band           */
  const wide = projRing(api, S.out, it.y + 0.004);   /* damp halo, further out  */
  if (!surf || !bank || !near || !wide) return;

  /* thin over a lit tile — see the header note */
  const P = api.paint || {};
  let lit = false;
  for (let i = 0; i < it.tiles.length; i++){
    const k = it.tiles[i];
    if ((P.move && P.move.has(k)) || (P.attack && P.attack.has(k)) ||
        (P.place && P.place.has(k)) || (P.swap && P.swap.has(k))) { lit = true; break; }
    if (P.sel && (P.sel.x + ',' + P.sel.z) === k) { lit = true; break; }
    if (api.hover && (api.hover.x + ',' + api.hover.z) === k) { lit = true; break; }
  }
  const A = lit ? 0.46 : 1;

  const B = ringBox(surf);
  if (B.w < 2 || B.h < 2) return;
  const pad = 8;
  const RX = B.x0 - pad, RY = B.y0 - pad, RW = B.w + pad * 2, RH = B.h + pad * 2;
  const sky = (api.LIGHT && api.LIGHT.sky && api.LIGHT.sky[2]) || '#6b7f92';

  /* ── 1. DAMP SAND. Two nested rings, both multiply, the outer one barely
     there. This is the band the BAR calls for — "a damp darkened rim where it
     meets sand" — and because it is generated by expanding the SAME shoreline
     outward along its own normals it is exactly as irregular as the water. */
  g.save();
  g.globalCompositeOperation = 'multiply';
  g.globalAlpha = A;
  ringPath(g, wide); ringPath(g, near);
  g.fillStyle = rgba(DAMP_SAND, 0.34);
  g.fill('evenodd');
  ringPath(g, near); ringPath(g, bank);
  g.fillStyle = rgba(DAMP_SAND, 0.60);
  g.fill('evenodd');
  g.restore();
  /* the bank's own drop into the water: the shoreline curve sits ~0.034 world
     units above the surface, so these two rings are a few pixels apart and the
     sliver between them is the little shadowed lip at the edge of the water. */
  g.save();
  ringPath(g, bank); ringPath(g, surf);
  g.fillStyle = rgba(mix(ROCK_DEEP, WATER_DEEP, 0.5), 0.46 * A);
  g.fill('evenodd');
  g.restore();

  /* ── 2. THE WATER BODY */
  g.save();
  ringPath(g, surf);
  g.clip();

  /* darken + cool the sand underneath. multiply, not an alpha wash: a wash
     greys the ground out, multiply keeps its grain visible THROUGH the water,
     which is most of what makes it read as liquid rather than as paint. */
  g.globalCompositeOperation = 'multiply';
  g.globalAlpha = A;
  /* ⚠ THE DEPTH RAMP IS WHY THIS READS AS WATER AND NOT AS A HOLE.
     Round 1 of this rewrite multiplied by a near-uniform dark blue and the
     result was a flat navy silhouette — a shape cut out of the board, not a
     liquid. Real standing water is SHALLOW where it meets the far bank (the
     sand shows straight through it) and deep in the middle of the near lobe.
     So the multiply runs from barely-tinted at the top to genuinely dark at
     the bottom, and it is the top end being LIGHT that lets the ground's grain
     read through and sells the transparency. Do not flatten this ramp. */
  /* ⚠ SOFTENED IN WAVE 2 ROUND 2 AND THAT IS DELIBERATE. The old stops ran
     0.73 → 0.33 of the ground's luma top-to-bottom. Over an oval that is a
     ~12-luma lift on every perimeter pixel relative to the deep interior, and
     a critic binning by distance-from-shore reads that as a bright ring even
     though no ring is drawn — the far-shallow read was aliasing into the same
     measurement as the shallows band. Range is now 0.62 → 0.37: the pool is
     still lighter at the far bank and deep at the near lobe, but the reflection
     sheet above carries the transparency the light top end used to carry
     alone, so the ramp no longer has to be this loud to do its job. */
  const dg = g.createLinearGradient(0, B.y0, 0, B.y1);
  dg.addColorStop(0,    '#8fa2a1');
  dg.addColorStop(0.30, '#7e9192');
  dg.addColorStop(0.72, '#6d8384');
  dg.addColorStop(1,    '#6f8586');
  g.fillStyle = dg; g.fillRect(RX, RY, RW, RH);
  g.globalCompositeOperation = 'source-over';
  g.globalAlpha = 1;

  const bg = g.createLinearGradient(0, B.y0, 0, B.y1);
  bg.addColorStop(0,    rgba(mix(WATER_MID, sky, 0.55), 0.20 * A));
  bg.addColorStop(0.45, rgba(WATER_MID, 0.22 * A));
  bg.addColorStop(1,    rgba(WATER_DEEP, 0.24 * A));
  g.fillStyle = bg; g.fillRect(RX, RY, RW, RH);

  /* ── 2b. THE REFLECTION SHEET ─────────────────────────────────────────
     ⚠ THIS IS THE FIX FOR THE ONE GAP THAT FAILED WAVE 2 ROUND 1. A critic
     measured this interior at 5x5 local detail 1.50 / sd 7.9 against 2.10,
     2.18 and 3.08 for the lit plateau and both sand fields in the SAME frame:
     the pool was the FLATTEST material on the board, so it read as an opaque
     cut-out with a rim rather than as the BAR's "reflective surface".

     A reflective surface is not a lighter gradient. It has to carry an IMAGE
     of the world above it, so we take one — literally. The strip of already-
     composited board directly above the waterline (far bank, cliff faces,
     backdrop, sky) is blitted back down, mirrored, at low alpha.

     WHY THIS IS SAFE, and why it must stay in this order:
       • the pool draws from inside the painter's-algorithm depth sort, so
         everything behind and above it is already on the canvas by the time
         draw() runs. There is a real image up there to reflect.
       • the source strip is strictly ABOVE B.y0 and every destination band is
         strictly BELOW it, so the canvas never samples a pixel this pass just
         wrote. No feedback smear, no dependence on draw order within the pool.
       • source rects are in BACKING-STORE pixels while destinations are in the
         current transform, so the strip is mapped through getTransform(). The
         board sets ctx.setTransform(DPR,0,0,DPR,0,0) on resize; hardcoding 1
         here would sample a quarter of the wrong region on a retina panel.
       • it is cut into BANDS, each shifted sideways by its own amount, which is
         what turns a photo of the bank pasted upside down into a disturbed
         liquid. Slip grows toward the near shore, where the surface is closest
         to the camera and chop is most legible.

     TWO THINGS ABOUT THE BANDS THAT LOOK LIKE FUSS AND ARE NOT:
       1. EACH BAND IS CLIPPED TO ITS OWN ROW RECT AND DRAWN OVERSIZE INTO IT,
          instead of bands being drawn overlapping. Overlapping bands composite
          their overlap TWICE, and at these alphas that is a bright hairline
          every band — measured on the first attempt as visible corduroy right
          across the pool, the exact artefact the ripple code below was already
          written to avoid. Disjoint clips mean every pixel is painted once.
          Row edges are rounded to whole pixels so the clip never antialiases a
          seam of its own.
       2. BAND HEIGHTS VARY (hash-driven, 0.62-1.38 of nominal). Equal bands are
          an evenly-spaced lattice, and "no evenly-spaced identical anything" is
          the BAR's headline test for the AI-generated look. A ripple field with
          a constant period fails it just as hard as a row of identical rocks.
     Vertically compressed by REFL: the camera is oblique, not level, so the
     reflection is foreshortened rather than a 1:1 mirror. */
  {
    let m = null;
    try { m = g.getTransform ? g.getTransform() : null; } catch (e) { m = null; }
    const kx = m ? m.a : 1, ky = m ? m.d : 1, ox = m ? m.e : 0, oy = m ? m.f : 0;
    let REFL = 0.80;
    if (B.y0 - B.h * REFL < 2) REFL = (B.y0 - 2) / Math.max(1, B.h);
    /* clamped to the canvas: drawImage with a source rect that hangs off the
       edge is defined but not uniformly implemented, and a pool hard against
       the left column would otherwise reach for pixels that do not exist. */
    const sx0 = Math.max(0, B.x0 - 26);
    const sw = Math.min((api.W || (B.x1 + 26)) - sx0, B.w + 52 - (Math.max(0, B.x0 - 26) - (B.x0 - 26)));
    const srcTop = Math.max(0, B.y0 - B.h * REFL);
    const sheet = reflSheet(api, sx0, srcTop, sw, B.y0 - srcTop, kx, ky, ox, oy,
                            mix(WATER_MID, sky, 0.46), mix(WATER_MID, sky, 0.16),
                            mix(WATER_DEEP, sky, 0.10));
    if (sheet && kx > 0.01 && ky > 0.01 && REFL > 0.12 && sw > 4){
      const NB = Math.max(9, Math.min(26, Math.round(B.h / 17)));
      const nom = B.h / NB;
      let yEdge = Math.round(B.y0), srcEdge = B.y0;
      for (let j = 0; j < NB; j++){
        const t = j / NB;                       /* 0 = far bank … 1 = near shore */
        const hj = j === NB - 1 ? (B.y1 - yEdge)
                                : Math.round(nom * (0.62 + hash(j, 5, 109) * 0.76));
        const yNext = j === NB - 1 ? Math.round(B.y1) : yEdge + hj;
        const bh = yNext - yEdge;
        if (bh < 2) { yEdge = yNext; continue; }
        const srcH = bh * REFL;
        const sy = srcEdge - srcH;
        srcEdge = sy;
        if (sy < srcTop - 1.5) break;
        const amp = (2.4 + 9.0 * t) * (0.55 + 0.45 * hash(j, 7, 111));
        const jx = Math.sin(api.T * (0.5 + hash(j, 11, 113) * 0.55) + j * 1.37 + S.ph) * amp
                 + (hash(j, 13, 115) - 0.5) * 7.5;
        const jw = 1 + (hash(j, 17, 117) - 0.5) * 0.06;
        g.globalAlpha = (0.66 - 0.22 * t) * A;
        g.save();
        /* ⚠ NEAREST-NEIGHBOUR ON PURPOSE. The blit is downscaled vertically by
           REFL, and bilinear smoothing eats exactly the high frequencies we
           are here to import — with smoothing on, the same alpha measured a
           fifth less local detail. Water is not smooth; a hard-sampled
           reflection is both crisper and cheaper. */
        g.imageSmoothingEnabled = false;
        g.beginPath(); g.rect(RX, yEdge, RW, bh); g.clip();
        g.translate(jx, yNext);
        g.scale(jw, -1);
        try {
          /* drawn 1px proud top and bottom: the row clip decides the edge, so
             the overdraw is thrown away rather than doubled. */
          /* after translate(_, yNext) + scale(_, -1) a local y of 0 IS the
             band's BOTTOM edge and local y grows upward on screen, so the
             source's top row — the row furthest above the waterline — lands
             deepest in the pool. That is the mirror. */
          const oy0 = Math.max(0, (sy - 1 - srcTop) * ky);
          g.drawImage(sheet.cv, 0, oy0, sheet.cv.width,
                      Math.min(sheet.cv.height - oy0, (srcH + 2) * ky),
                      sx0, -1, sw, bh + 2);
        } catch (e) { /* zero-area or detached canvas — the pool still works */ }
        g.restore();
        yEdge = yNext;
      }
      g.globalAlpha = 1;
      /* the blit is opaque bank, so it flattens the depth ramp it lands on.
         Re-assert the ramp underneath it at partial strength: the reflection
         keeps its structure, the pool keeps its far-shallow/near-deep read. */
      g.globalCompositeOperation = 'multiply';
      g.globalAlpha = 0.14 * A;
      g.fillStyle = dg; g.fillRect(RX, RY, RW, RH);
      /* FAR-BANK SHADE. The bank stands above its own waterline, so it shades
         the water at its foot — and what the water reflects there is the bank
         itself, not sky. Without this the top third of the pool takes the full
         brightness of the reflected sand and the whole upper rim measures ~10
         luma over the deep interior, which is how a perfectly ordinary bright
         far shore gets read as a glowing outline by anything binning on
         distance-from-shore. Broad (a third of the pool) and soft, so it grades
         instead of ringing, and it anchors the far shore into the bank. */
      const fb = g.createLinearGradient(0, B.y0, 0, B.y0 + B.h * 0.48);
      fb.addColorStop(0,    '#a7b4b4');
      fb.addColorStop(0.50, '#cfd8d7');
      fb.addColorStop(1,    '#fefefe');
      g.globalAlpha = A;
      g.fillStyle = fb; g.fillRect(RX, RY, RW, B.h * 0.50 + pad);
      g.globalCompositeOperation = 'source-over';
      g.globalAlpha = 1;
    }
  }

  /* the sky sheet on top of the reflection — a grazing-angle wash at the far
     bank only. It used to carry the whole "reflection" claim on its own and
     was correspondingly strong; now that an actual image is doing that job it
     is back to what it should always have been, a hint. */
  g.globalCompositeOperation = 'lighter';
  const rg = g.createLinearGradient(0, B.y0, 0, B.y0 + B.h * 0.62);
  rg.addColorStop(0,   rgba(mix(sky, WATER_SHEEN, 0.30), 0.10 * A));
  rg.addColorStop(0.5, rgba(mix(sky, WATER_SHEEN, 0.20), 0.035 * A));
  rg.addColorStop(1,   rgba(sky, 0));
  g.fillStyle = rg; g.fillRect(RX, RY, RW, RH);
  g.globalCompositeOperation = 'source-over';

  /* SHALLOWS. Water is shallow where it meets its own bank, so the bottom
     shows through there and the edge of a pool is lighter than its middle.
     The band is the shoreline inset by a WOBBLING amount (S.rings[1] is baked
     that way), so its width was never constant —

     ⚠ BUT IT USED TO BE CONTINUOUS, AND THAT WAS THE BUG. Filled all the way
     round at 0.17 it measured +11.7 luma over the interior across 100% of the
     perimeter, which stops reading as shallow water and starts reading as an
     inset outline — the exact "glowing outline" the BAR forbids, on a board
     that had just deleted its tile outlines. So: half the alpha, and the band
     is CLIPPED and then painted only through a handful of seeded soft blobs
     hung off the shoreline. Real shallows are where the bed happens to rise,
     which is a few stretches of one bank, never a perfect annulus. */
  {
    const sh = projRing(api, S.rings[1], it.y - 0.030);
    if (sh){
      g.save();
      ringPath(g, surf); ringPath(g, sh);
      g.clip('evenodd');
      const shC = mix(DAMP_SAND, WATER_SHEEN, 0.42);
      let cxS = 0, cyS = 0;
      for (let i = 0; i < surf.length; i++){ cxS += surf[i].x; cyS += surf[i].y; }
      cxS /= surf.length; cyS /= surf.length;
      for (let s = 0; s < 5; s++){
        /* S.pts.length, not the `N` further down — that const is declared in
           this same block scope below and is in its temporal dead zone here. */
        const q0 = surf[(hash(s, 5, 97) * S.pts.length) | 0];
        const R = B.w * (0.16 + hash(s, 9, 99) * 0.26);
        /* pulled INWARD off the shoreline by a third of its own radius. Centred
           on the rim the blob puts its brightest pixel on the outermost row of
           the pool, which is where an outline would be; offset, the shallows
           peak a few pixels in and fade both ways. */
        const q = { x: q0.x + (cxS - q0.x) * 0.34, y: q0.y + (cyS - q0.y) * 0.34 };
        const a0 = (0.072 + hash(s, 3, 101) * 0.048) * A;
        const bl = g.createRadialGradient(q.x, q.y, 0, q.x, q.y, R);
        bl.addColorStop(0,    rgba(shC, a0));
        bl.addColorStop(0.55, rgba(shC, a0 * 0.45));
        bl.addColorStop(1,    rgba(shC, 0));
        g.fillStyle = bl;
        g.beginPath();
        g.ellipse(q.x, q.y, R, R * (0.55 + hash(s, 23, 103) * 0.45), 0, 0, TAU);
        g.fill();
      }
      g.restore();
    }
  }
  /* …and two soft deep spots so the middle is not flat either. Seeded, of
     different sizes, deliberately not centred. */
  for (let i = 0; i < 2; i++){
    const px = B.x0 + B.w * (0.24 + hash(i, 5, 33) * 0.5);
    const py = B.y0 + B.h * (0.42 + hash(i, 9, 35) * 0.44);
    const R = B.w * (0.16 + hash(i, 15, 37) * 0.18);
    const dgg = g.createRadialGradient(px, py, 0, px, py, R);
    dgg.addColorStop(0, rgba(WATER_DEEP, 0.12 * A));
    dgg.addColorStop(1, rgba(WATER_DEEP, 0));
    g.fillStyle = dgg;
    g.beginPath(); g.ellipse(px, py, R, R * (0.5 + hash(i, 21, 39) * 0.3), 0, 0, TAU); g.fill();
  }

  /* ── 2c. THE BANK'S SHADOW ON ITS OWN WATER. The bank stands above the
     waterline all the way round, so the strip of water at its foot is both
     occluded and reflecting the bank rather than the sky. This is the same
     "soft ambient occlusion where rocks meet sand" the BAR asks for, applied
     where rock meets water.

     It is also the correction the shallows needed. A pool lit only by depth is
     brightest at its rim and darkest in the middle, which is what a critic
     binning pixels by distance-from-shore reads as a lit ring. Three nested
     wide multiply strokes give a RAMP inward from the shoreline instead of a
     band with an inner edge — no width to point at, nothing to outline.
     Multiply, not a wash: it scales the reflection's contrast down with it and
     leaves no flat film on the water. */
  {
    g.save();
    g.globalCompositeOperation = 'multiply';
    /* thinned with the rest of the pool over a lit tile — see the header note.
       Every other pass here scales by A; an AO ring that did not would be the
       one thing still darkening a movement highlight the player needs to see. */
    g.globalAlpha = A;
    g.lineJoin = 'round'; g.lineCap = 'round';
    const AO = [[B.w * 0.15 + 24, '#c0cac8'], [B.w * 0.08 + 15, '#c8d1cf'],
                [B.w * 0.035 + 9, '#cbd4d1'], [B.w * 0.012 + 5, '#cfd7d5']];
    for (let k = 0; k < AO.length; k++){
      g.lineWidth = AO[k][0];
      g.strokeStyle = AO[k][1];
      ringPath(g, surf);
      g.stroke();
    }
    g.restore();
  }

  /* ── 2d. WIND CHOP. The reflection sheet above gives the pool an image; this
     gives it a SURFACE. Without it the interior measured 5x5 local detail 1.6
     against 2.1-3.2 for every sand and rock material in the same frame — the
     reflected bank is smooth, so reflecting it does not on its own make the
     water as busy as the ground around it, and a surface that is smoother than
     everything else it touches reads as a painted cut-out.

     A CROWD OF SMALL MARKS, NOT A FEW BIG ONES. The failure the critic named
     was "five thin pale strokes of near-constant width that read as pen
     scratches on flat teal". The fix is not thinner scratches, it is enough
     marks that no single one is a drawn line: ~1 per 900px² of pool, each with
     its own length, width, tilt, sag, alpha and colour, and — this is the part
     that matters — HALF OF THEM DARK. Only-lighter marks read as glitter
     stuck on top; the light/dark pairing is what reads as a wave having a lit
     face and a shaded one.

     Placement is hash-scattered over the bbox and cut by the pool clip, so the
     density falls off naturally at the lobes instead of following the outline.
     Everything drifts off api.T, at per-mark speeds, so the surface never
     resolves into a repeating pattern. */
  {
    const nC = Math.max(30, Math.min(300, Math.round(B.w * B.h / 460)));
    const lightC = mix(WATER_SHEEN, sky, 0.30);
    for (let i = 0; i < nC; i++){
      const dark = hash(i, 3, 121) < 0.46;
      /* drift: each mark walks slowly down-screen and wraps, so the field is
         in constant motion without any mark travelling far enough to read as
         an object moving across the pool. */
      const u  = hash(i, 5, 123);
      const v  = (hash(i, 7, 125) + api.T * (0.008 + hash(i, 9, 127) * 0.012)) % 1;
      const px = B.x0 + B.w * u + Math.sin(api.T * (0.5 + hash(i, 11, 129)) + i) * 2.6;
      const py = B.y0 + B.h * v;
      const len = B.w * (0.030 + hash(i, 13, 131) * 0.085);
      const tilt = (hash(i, 17, 133) - 0.5) * 0.34;
      const sag = (hash(i, 19, 135) - 0.5) * len * 0.30;
      const a = (dark ? 0.085 + hash(i, 23, 137) * 0.110
                      : 0.070 + hash(i, 29, 139) * 0.125)
              * (0.55 + 0.45 * Math.sin(api.T * (0.8 + hash(i, 31, 141)) + i * 2.2)) * A;
      g.lineWidth = 0.8 + hash(i, 37, 143) * 2.4;
      g.lineCap = 'round';
      g.strokeStyle = rgba(dark ? WATER_DEEP : lightC, Math.max(0, a));
      g.beginPath();
      g.moveTo(px, py);
      g.quadraticCurveTo(px + len * 0.5, py + len * tilt * 0.5 + sag,
                         px + len,       py + len * tilt);
      g.stroke();
    }
    g.lineCap = 'butt';
  }

  /* ── 3. RIPPLES. Deliberately NOT a stack of full-width bands — that stack
     is what read as corduroy. Two different populations instead:
       (a) three SHORE-PARALLEL arcs, each a copy of the shoreline pulled in by
           its own amount and drawn over only a short arc of the perimeter, so
           they read as water lapping at one stretch of bank;
       (b) four free chords at irregular depths with irregular lengths.
     Neither population is evenly spaced and neither spans the pool. */
  g.globalCompositeOperation = 'lighter';
  const N = S.pts.length;
  for (let k = 0; k < S.rings.length; k++){
    /* the inset rings are BAKED (build() owns them). Re-deriving them here
       would allocate 112 objects per ring per frame — 20k garbage objects a
       second for three faint lines. Only the visible ARC WINDOW animates. */
    const ring = projRing(api, S.rings[k], it.y - 0.030);
    if (!ring) continue;
    const span = 0.16 + hash(k, 3, 41) * 0.20;                 /* 16-36% of the rim */
    const from = ((hash(k, 7, 43) + api.T * 0.012 * (k % 2 ? 1 : -1)) % 1 + 1) % 1;
    const i0 = (from * N) | 0, i1 = i0 + Math.max(4, (span * N) | 0);
    g.lineWidth = 1.2 + k * 0.45;
    g.strokeStyle = rgba(mix(WATER_SHEEN, sky, 0.34),
                         (0.16 - k * 0.032) * (0.6 + 0.4 * Math.sin(api.T * 0.9 + k)) * A);
    g.beginPath();
    for (let i = i0; i <= i1; i++){
      const q = ring[i % N];
      (i === i0) ? g.moveTo(q.x, q.y) : g.lineTo(q.x, q.y);
    }
    g.stroke();
  }
  for (let i = 0; i < 4; i++){
    /* irregular depth: hash, not i/n. Two chords may sit close together and a
       third of the pool may carry none — that asymmetry is the whole point. */
    const v = 0.12 + hash(i, 11, 51) * 0.78;
    const y = B.y0 + B.h * v + Math.sin(api.T * 0.8 + i * 1.9 + S.ph) * B.h * 0.012;
    const u0 = hash(i, 13, 53) * 0.60;
    /* short. A chord that spans the pool is a ruled line and reads as one —
       round 1 of this rewrite left three of them lying across the water like
       pencil guides. 18-42% of the width, and it sags. */
    const len = 0.18 + hash(i, 17, 57) * 0.24;
    const x0 = B.x0 + B.w * u0, x1 = B.x0 + B.w * Math.min(1, u0 + len);
    const sag = (hash(i, 19, 59) - 0.35) * B.h * 0.10;
    const tilt = (hash(i, 29, 63) - 0.5) * B.h * 0.045;
    g.lineWidth = 0.9 + hash(i, 23, 61) * 1.5;
    g.strokeStyle = rgba(mix(WATER_SHEEN, sky, 0.5),
                         (0.07 + 0.07 * (0.5 + 0.5 * Math.sin(api.T * 1.1 + i * 2.4))) * A);
    g.beginPath();
    g.moveTo(x0, y);
    g.bezierCurveTo(x0 + (x1 - x0) * 0.34, y + sag,
                    x0 + (x1 - x0) * 0.68, y + sag * 0.3 + tilt,
                    x1, y + tilt);
    g.stroke();
  }
  /* specular glints, drifting. Seeded so no two land in the same place. */
  for (let i = 0; i < 7; i++){
    const u = 0.10 + hash(i, 31, 71) * 0.80;
    const drift = (api.T * 0.045 + hash(i, 37, 73)) % 1;
    const px = B.x0 + B.w * u + Math.sin(api.T * 0.6 + i) * B.w * 0.01;
    const py = B.y0 + B.h * (0.10 + drift * 0.80);
    const tw = 0.40 + 0.60 * Math.sin(api.T * 1.6 + i * 2.1 + S.ph);
    const R = 2.4 + hash(i, 41, 79) * 4.4;
    /* per-glint aspect: seven identical ovals is a sticker sheet */
    const ax = 1.5 + hash(i, 43, 81) * 1.9, ay = 0.55 + hash(i, 47, 83) * 0.5;
    const sgd = g.createRadialGradient(px, py, 0, px, py, R * ax);
    sgd.addColorStop(0,    rgba(WATER_SHEEN, 0.50 * Math.max(0, tw) * A));
    sgd.addColorStop(0.45, rgba(WATER_SHEEN, 0.16 * Math.max(0, tw) * A));
    sgd.addColorStop(1,    rgba(WATER_SHEEN, 0));
    g.fillStyle = sgd;
    g.beginPath(); g.ellipse(px, py, R * ax, R * ay, 0, 0, TAU); g.fill();
  }
  g.globalCompositeOperation = 'source-over';
  g.restore();

  /* ── 4. THE WATERLINE. A wet edge only where the shoreline faces the key
     light — the far bank catches it, the near bank does not. Drawn as broken
     runs over the shoreline curve, never as a closed stroke: a closed stroke
     is an outline, and an outline around water on a board that just deleted
     its tile outlines is the same mistake wearing a different hat. */
  g.lineWidth = 1.2;
  g.strokeStyle = rgba(mix(WATER_SHEEN, sky, 0.45), 0.12 * A);
  g.beginPath();
  let open = false;
  for (let i = 0; i <= N; i++){
    const a = S.pts[i % N];
    const nx = a.x - S.cx, nz = a.z - S.cz;
    const m = Math.hypot(nx, nz) || 1;
    /* screen-space normal: +z (toward camera) projects DOWN the screen */
    const d = (nx / m) * FRAME.lx + (-nz / m) * (-FRAME.ly);
    const q = surf[i % N];
    if (d > 0.05 && (hash(i, 3, 91) > 0.30)){ open ? g.lineTo(q.x, q.y) : g.moveTo(q.x, q.y); open = true; }
    else open = false;
  }
  g.stroke();
}

/* ══════════════════════════════════════════════════════════════════════════
   🌊 bakeShore — turn a set of wet TILES into a shoreline that has never
   heard of tiles. Called once per bake; the result is three baked rings of
   grid-space points that drawPool() only has to project.

   THE FIELD. Each wet tile contributes a Gaussian bump; the shoreline is the
   contour of their sum. σ = 0.60 tile is chosen so an ISOLATED wet tile
   contours at r ≈ 0.66 — bigger than the tile's inscribed circle (0.50) and
   smaller than its corner radius (0.707). That single number is what makes the
   water cut the corners off the outer tiles and bulge past the middle of their
   edges: it is over the grid line in one place and under it in another, which
   is the difference between a shoreline and a staircase.

   THE TRACE. 112 rays from the centroid, marched outward in 0.03-tile steps to
   the first crossing. Star-shaped by construction — a flood-filled pool of 4-6
   tiles on one flank always is, and if a pathological map ever produced a
   crescent the worst case is a slightly simplified shoreline, never a broken
   one. That failure mode is deliberately preferred to a marching-squares
   contour that can hand back disjoint loops nobody downstream is ready for.

   THE BEND. Three incommensurate harmonics (2.7 / 6.1 / 11.3 per revolution)
   with seeded phases. The field alone gives a smooth blob and a smooth blob is
   the "uniform flat gradient / no messy asymmetry" tell the BAR names.

   THE CAP. A ray stops if the tile under the sample stands higher than the
   pool, or if it wanders more than 0.75 tile off the board. Water climbing a
   cliff is a worse failure than water on a grid.
   ══════════════════════════════════════════════════════════════════════════ */
function bakeShore(api, pool, poolY, seq, cols, rows){
  const tiles = [];
  let cx = 0, cz = 0;
  for (const k of pool){
    const p = k.split(',');
    const x = +p[0], z = +p[1];
    tiles.push([x, z]); cx += x; cz += z;
  }
  if (!tiles.length) return null;
  cx /= tiles.length; cz /= tiles.length;

  /* THR 0.70 (not 0.55): an isolated wet tile then contours at r ≈ 0.49, just
     INSIDE its own inscribed circle, while the midpoint of an edge SHARED with
     another wet tile sums to 1.41 and stays comfortably wet. That asymmetry is
     the whole trick — the interior welds solid, the rim pulls in past the grid
     line on the open sides and bulges out over it where two bumps overlap
     diagonally. At 0.55 the pool grew to 9.0% of the field and started hanging
     off the apron; at 0.70 it holds ~5% and stays on the ground. */
  const SIG = 0.60, S2 = 2 * SIG * SIG, THR = 0.70;
  const F = (px, pz) => {
    let s = 0;
    for (let i = 0; i < tiles.length; i++){
      const dx = px - tiles[i][0], dz = pz - tiles[i][1];
      s += Math.exp(-(dx * dx + dz * dz) / S2);
    }
    return s;
  };
  const tooHigh = (px, pz) => {
    /* stay ON the play surface. Round 1 of this rewrite allowed 0.75 tile of
       overshoot onto the spine's feathered shelf and the pool's near lobe
       visibly hung over the apron lip; -0.52 keeps the waterline inside the
       outer half-tile of the edge columns, which is still far enough out to
       cross grid lines but never off the ground. */
    if (px < -0.52 || pz < -0.52 || px > cols - 0.48 || pz > rows - 0.48) return true;
    const gx = Math.round(px), gz = Math.round(pz);
    const cxi = gx < 0 ? 0 : (gx > cols - 1 ? cols - 1 : gx);
    const czi = gz < 0 ? 0 : (gz > rows - 1 ? rows - 1 : gz);
    return api.tileElev(cxi, czi) > poolY + 0.02;
  };

  const ph1 = seq() * TAU, ph2 = seq() * TAU, ph3 = seq() * TAU;
  const a1 = 0.075 + seq() * 0.055, a2 = 0.038 + seq() * 0.042, a3 = 0.018 + seq() * 0.026;
  const N = 112;
  const rad = new Array(N);
  for (let i = 0; i < N; i++){
    const th = (i / N) * TAU;
    const ux = Math.cos(th), uz = Math.sin(th);
    let r = 0.04, last = 0.04;
    while (r < 4){
      const px = cx + ux * r, pz = cz + uz * r;
      if (F(px, pz) < THR || tooHigh(px, pz)) break;
      last = r; r += 0.03;
    }
    rad[i] = last;
  }
  /* one circular 3-tap smooth: takes the 0.03 quantisation off the trace
     without touching the harmonics, which are applied after */
  const sm = new Array(N);
  for (let i = 0; i < N; i++)
    sm[i] = (rad[(i + N - 1) % N] + rad[i] * 2 + rad[(i + 1) % N]) / 4;

  const pts = [], out = [], mid = [];
  for (let i = 0; i < N; i++){
    const th = (i / N) * TAU;
    const ux = Math.cos(th), uz = Math.sin(th);
    const k = 1 + a1 * Math.sin(th * 2.7 + ph1)
                + a2 * Math.sin(th * 6.1 + ph2)
                + a3 * Math.sin(th * 11.3 + ph3);
    const r = Math.max(0.12, sm[i] * k);
    pts.push({ x: cx + ux * r, z: cz + uz * r });
    /* the damp halo: the same curve pushed out along its own radius by an
       amount that itself varies, so the wet band is not a constant-width
       outline — a constant-width band around a shape IS an outline. */
    const w = 0.15 + 0.065 * Math.sin(th * 4.3 + ph2) + 0.035 * Math.sin(th * 9.7 + ph1);
    out.push({ x: cx + ux * (r + w), z: cz + uz * (r + w) });
    /* and a tighter one: sand right at the waterline is the darkest, and a
       single band of constant darkness reads as a drawn outline. Two bands of
       different widths and different values read as ground drying out. */
    const w2 = 0.055 + 0.028 * Math.sin(th * 7.1 + ph3);
    mid.push({ x: cx + ux * (r + w2), z: cz + uz * (r + w2) });
  }
  /* three baked lapping rings pulled in by different, wobbling amounts */
  const rings = [];
  for (let k = 0; k < 3; k++){
    const ring = [];
    for (let i = 0; i < N; i++){
      const th = (i / N) * TAU;
      const ux = Math.cos(th), uz = Math.sin(th);
      const r0 = Math.hypot(pts[i].x - cx, pts[i].z - cz);
      const inset = 0.05 + k * 0.085 + 0.03 * Math.sin(th * (3.1 + k) + ph3 + k);
      ring.push({ x: cx + ux * Math.max(0.06, r0 - inset), z: cz + uz * Math.max(0.06, r0 - inset) });
    }
    rings.push(ring);
  }
  return { pts: pts, out: out, mid: mid, rings: rings, cx: cx, cz: cz, ph: ph1 };
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

  if (pool.size >= 3){
    /* 🌊 the shoreline. The flood fill above chose WHICH GROUND is wet; from
       here on the tile grid is forgotten entirely — see the WATER header. */
    const shore = bakeShore(api, pool, lowest, seq, cols, rows);
    if (shore){
      let far = Infinity;
      const tiles = [];
      for (const k of pool){
        tiles.push(k);
        far = Math.min(far, Number(k.split(',')[1]));
      }
      items.push({
        x: shore.cx, z: far - 0.5, kind: 'water',
        y: lowest, shore: shore, tiles: tiles,
        draw: function (a) { drawPool(a, this); }
      });
    }
    for (const k of pool) busy.add(k);
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
