/* ═══════════════════════════════════════════════════════════════════════════
   🏗 SUPPLY CHAIN · scene.nodes.js — the mesh registry.

   Every landmark, gate and business tile on the 3D map is a small procedural
   low-poly building built here from boxes, cylinders, cones and canvas-painted
   plates. There are NO asset files: the project ships no images for this
   feature and never depends on a download (the Car Factory rule generalised —
   "the procedural mesh is always the fallback", here it is the only mesh).

   WHY A REGISTRY. scene.js never names a business id (CONTRACT, scene3d row):
   it derives layout, lanes and highlights from the graph and asks THIS file
   for "the building for node X". Lookup is by node.id, then node.kind
   ('hub' / 'producer' / 'service' / 'cityTransit' / 'system' / 'channel'),
   then node.type, then a default crate — so a tile the owner adds tomorrow
   still renders (as a labelled crate) before anyone models it. registerNodeMesh
   lets a later piece or the harness swap one in without touching scene.js.

   WHY THE PDF ICONS LIVE ON THE NAME PLATE. The owner's map says what a tile
   needs with four small icons beside it (truck / marketplace / tow truck /
   battler card). Drawing them as separate sprites costs a draw call each,
   times 27 tiles. Painting them INTO the plate's canvas costs nothing and keeps
   the icon glued to the name at every zoom. A '?' badge (badgeDoubt, PDF
   ambiguity) is drawn as the icon with a question mark, never resolved here.

   WHY bakeGroup(). A tile is 5-9 primitives; 33 tiles unbaked is ~250 draw
   calls before a single lane is drawn, and the bar is under 400 at overview
   on software WebGL. bakeGroup merges every mesh that shares a material into
   one BufferGeometry (matrices applied), so a tile is 2-4 calls. Materials are
   CLONED per node on the way, which is what lets scene.js dim or ghost one
   node without touching its neighbours.

   Colours here are the Ruin Ledger palette from tuning.js (warm black / gold /
   parchment; blue never chrome) plus the honest colours of the things
   depicted — a red GAS sign is red, a yellow crusher is yellow. DESIGN-BAR
   tests chrome, not content.
   ═══════════════════════════════════════════════════════════════════════════ */

import { SC } from './tuning.js';

const P = SC.palette;
const hex = (css) => parseInt(String(css).replace('#', ''), 16);

/* ── materials ──────────────────────────────────────────────────────────── */
/* One palette of material RECIPES; each node gets its own clones via bakeGroup,
   so per-node opacity (ghosting, dimming) never leaks to a neighbour. sRGB
   colours are converted because the renderer outputs sRGB (carfactory M()). */
export function makeMaterials(T) {
  const M = (c, o) => new T.MeshStandardMaterial(Object.assign({ color: new T.Color(c).convertSRGBToLinear(), roughness: 0.7, metalness: 0.08 }, o || {}));
  const E = (c, k, o) => M(c, Object.assign({ emissive: new T.Color(c).convertSRGBToLinear(), emissiveIntensity: k == null ? 0.6 : k, roughness: 0.4 }, o || {}));
  return {
    plinth: M(P.bgCard, { roughness: 0.85, metalness: 0.05 }),
    plinthHub: M('#2a2418', { roughness: 0.7, metalness: 0.15 }),
    stone: M('#6f6659', { roughness: 0.9 }),
    stoneDark: M('#3e3830', { roughness: 0.95 }),
    wall: M('#8a7d6a', { roughness: 0.85 }),
    wallLight: M('#b8ab94', { roughness: 0.8 }),
    roof: M('#4a2f22', { roughness: 0.8 }),
    roofSlate: M('#2b2a2e', { roughness: 0.7 }),
    wood: M('#7a5230', { roughness: 0.85 }),
    steel: M('#8d96a3', { metalness: 0.75, roughness: 0.35 }),
    steelDark: M('#3a3f48', { metalness: 0.65, roughness: 0.45 }),
    gold: M(P.gold, { metalness: 0.7, roughness: 0.3 }),
    goldBright: E(P.goldBright, 0.35, { metalness: 0.5 }),
    ember: E(P.ember, 0.9),
    blood: M('#a02828', { roughness: 0.6 }),
    red: M('#c8392b', { roughness: 0.55 }),
    yellow: M('#e9b62c', { roughness: 0.55 }),
    orange: M('#e8763c', { roughness: 0.55 }),
    green: M('#3aa86b', { roughness: 0.7 }),
    grass: M('#4d6b3a', { roughness: 0.95 }),
    soil: M('#5a4230', { roughness: 0.95 }),
    teal: M('#4fb0a5', { roughness: 0.6 }),
    water: M('#2b4a5c', { roughness: 0.25, metalness: 0.3 }),
    glass: M('#7fa3b8', { roughness: 0.1, metalness: 0.5, transparent: true, opacity: 0.75 }),
    white: M('#e8e0d0', { roughness: 0.6 }),
    ink: M('#1a1712', { roughness: 0.8 }),
    tyre: M('#17161a', { roughness: 0.9 }),
    canvas: M('#7d7a52', { roughness: 0.95 }),
    parchment: M(P.parchment, { roughness: 0.9 }),
    violet: E(P.violet, 0.7),
    azure: E('#4a8fd4', 0.6),
    lamp: E('#fff1cf', 1.4),
  };
}

/* ── primitive helpers (every builder uses only these) ──────────────────── */
export const tools = {
  box(T, g, w, h, d, m, x, y, z, ry) { const o = new T.Mesh(new T.BoxGeometry(w, h, d), m); o.position.set(x, y, z); if (ry) o.rotation.y = ry; o.castShadow = true; o.receiveShadow = true; g.add(o); return o; },
  cyl(T, g, r, h, m, x, y, z, axis, seg, rTop) { const o = new T.Mesh(new T.CylinderGeometry(rTop == null ? r : rTop, r, h, seg || 12), m); o.position.set(x, y, z); if (axis === 'z') o.rotation.x = Math.PI / 2; if (axis === 'x') o.rotation.z = Math.PI / 2; o.castShadow = true; g.add(o); return o; },
  cone(T, g, r, h, m, x, y, z, seg) { const o = new T.Mesh(new T.ConeGeometry(r, h, seg || 8), m); o.position.set(x, y, z); o.castShadow = true; g.add(o); return o; },
  sphere(T, g, r, m, x, y, z, seg) { const o = new T.Mesh(new T.SphereGeometry(r, seg || 10, seg || 8), m); o.position.set(x, y, z); o.castShadow = true; g.add(o); return o; },
  torus(T, g, r, t, m, x, y, z, rx, ry) { const o = new T.Mesh(new T.TorusGeometry(r, t, 6, 24), m); o.position.set(x, y, z); if (rx) o.rotation.x = rx; if (ry) o.rotation.y = ry; g.add(o); return o; },
  rock(T, g, r, m, x, y, z) { const o = new T.Mesh(new T.DodecahedronGeometry(r, 0), m); o.position.set(x, y, z); o.rotation.set(x * 1.3, y * 0.7, z * 0.9); o.castShadow = true; g.add(o); return o; },
  /* a 4-wheel vehicle body; trucks, buses and cars are all this with different proportions */
  vehicle(T, g, MAT, body, cab, x, y, z, ry, mats) {
    const v = new T.Group(); v.position.set(x, y, z); v.rotation.y = ry || 0; g.add(v);
    const bm = (mats && mats.body) || MAT.orange, cm = (mats && mats.cab) || bm;
    tools.box(T, v, body[0], body[1], body[2], bm, 0, body[1] / 2 + 0.22, 0);
    if (cab) tools.box(T, v, cab[0], cab[1], cab[2], cm, body[0] / 2 + cab[0] / 2, cab[1] / 2 + 0.22, 0);
    const len = body[0] + (cab ? cab[0] : 0);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) tools.cyl(T, v, 0.17, 0.14, MAT.tyre, sx * (len * 0.34) + (cab ? cab[0] / 2 : 0), 0.17, sz * (body[2] / 2 + 0.02), 'z', 10);
    return v;
  },
};

/* ── canvas text plates ─────────────────────────────────────────────────── */
export const FONT_HEAD = '"Cinzel", "Cinzel Decorative", Georgia, "Times New Roman", serif';
export const FONT_BODY = '"Crimson Text", "EB Garamond", Georgia, serif';

function canvasTex(T, w, h, draw) {
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
  draw(cv.getContext('2d'), w, h);
  const tx = new T.CanvasTexture(cv); tx.encoding = T.sRGBEncoding; tx.anisotropy = 4; tx.minFilter = T.LinearFilter;
  return tx;
}

/* The four PDF legend icons, as small canvas glyphs. Kept deliberately
   iconic (the owner's are clip-art): an orange semi = Transport, a shop in a
   cycle = Marketplace, a yellow tow truck = Car Marketplace, a gold-framed
   dark card = good for battlers / camp training. `doubt` draws a '?' over it
   — the PDF's own ambiguity, carried, not resolved. */
export function drawBadge(x, key, cx, cy, s, doubt) {
  x.save(); x.translate(cx, cy);
  const u = s / 24;
  if (key === 'transport') {
    x.fillStyle = '#e8763c'; x.fillRect(-11 * u, -6 * u, 15 * u, 10 * u);
    x.fillStyle = '#f4ede0'; x.fillRect(-10 * u, -5 * u, 13 * u, 8 * u);
    x.fillStyle = '#e8763c'; x.fillRect(4 * u, -3 * u, 7 * u, 7 * u);
    x.fillStyle = '#1a1712'; for (const wx of [-7, 0, 7]) { x.beginPath(); x.arc(wx * u, 5 * u, 2.2 * u, 0, 7); x.fill(); }
  } else if (key === 'market') {
    x.strokeStyle = '#e8e0d0'; x.lineWidth = 1.6 * u; x.beginPath(); x.arc(0, 0, 10 * u, 0.3, 2.8); x.stroke(); x.beginPath(); x.arc(0, 0, 10 * u, 3.4, 5.9); x.stroke();
    x.fillStyle = '#e8e0d0'; for (const a of [0.3, 3.4]) { x.beginPath(); x.arc(Math.cos(a) * 10 * u, Math.sin(a) * 10 * u, 2 * u, 0, 7); x.fill(); }
    x.fillStyle = '#d4af37'; x.fillRect(-5 * u, -3 * u, 10 * u, 8 * u); x.fillStyle = '#1a1712'; x.fillRect(-2 * u, 0, 4 * u, 5 * u);
    x.fillStyle = '#e8e0d0'; x.beginPath(); x.moveTo(-6.5 * u, -3 * u); x.lineTo(6.5 * u, -3 * u); x.lineTo(5 * u, -6.5 * u); x.lineTo(-5 * u, -6.5 * u); x.fill();
  } else if (key === 'carMarket') {
    x.fillStyle = '#e9b62c'; x.fillRect(-11 * u, -1 * u, 14 * u, 6 * u); x.fillRect(3 * u, -4 * u, 6 * u, 9 * u);
    x.strokeStyle = '#e9b62c'; x.lineWidth = 1.8 * u; x.beginPath(); x.moveTo(-9 * u, -1 * u); x.lineTo(-4 * u, -9 * u); x.lineTo(2 * u, -8 * u); x.stroke();
    x.fillStyle = '#e8763c'; x.fillRect(-8 * u, -7 * u, 8 * u, 4 * u);
    x.fillStyle = '#1a1712'; for (const wx of [-7, 6]) { x.beginPath(); x.arc(wx * u, 6 * u, 2.2 * u, 0, 7); x.fill(); }
  } else if (key === 'card') {
    x.fillStyle = '#d4af37'; x.fillRect(-7 * u, -10 * u, 14 * u, 20 * u);
    x.fillStyle = '#1a1712'; x.fillRect(-5.6 * u, -8.6 * u, 11.2 * u, 17.2 * u);
    x.fillStyle = '#e85d3c'; x.beginPath(); x.arc(-2.5 * u, -3 * u, 1.8 * u, 0, 7); x.fill();
    x.fillStyle = '#4a8fd4'; x.beginPath(); x.arc(2.8 * u, 1 * u, 1.8 * u, 0, 7); x.fill();
    x.fillStyle = '#8b5cf6'; x.beginPath(); x.arc(-1.5 * u, 5 * u, 1.6 * u, 0, 7); x.fill();
  }
  if (doubt) {
    x.fillStyle = 'rgba(12,11,10,.72)'; x.beginPath(); x.arc(6 * u, -6 * u, 6 * u, 0, 7); x.fill();
    x.fillStyle = '#f5d76e'; x.font = '700 ' + (11 * u) + 'px ' + FONT_BODY; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText('?', 6 * u, -5.5 * u);
  }
  x.restore();
}

/* Wrap a name onto at most two lines at a word boundary — "CONSTRUCTION
   COMPANY" as two short lines fits between neighbours at overview zoom where
   one long line would collide with the next tile's plate. */
function wrapName(x, text, maxW) {
  const words = String(text).split(/\s+/).filter(Boolean);
  if (words.length < 2 || x.measureText(text).width <= maxW) return [text];
  let best = null;
  for (let i = 1; i < words.length; i++) {
    const a = words.slice(0, i).join(' '), b = words.slice(i).join(' ');
    const w = Math.max(x.measureText(a).width, x.measureText(b).width);
    if (!best || w < best.w) best = { w, lines: [a, b] };
  }
  return best.lines;
}

/* "NEEDS ▸ MINING · OIL · GAS" on one line, dropping to "+2 more" rather than
   overflowing — a plate that grows to fit its dependency list is a plate that
   collides with its neighbour, and the modal is where the full list belongs.
   Names are shortened to their first significant word ("TRASH CRUSHER" →
   "TRASH") because the line has about 110 css px to say three things in. */
function fitNeeds(x, names, maxW) {
  const short = names.map((n) => String(n).toUpperCase().split(/\s+/).filter((w) => !/^(COMPANY|CORPORATION|CORP\.?|OP\.?|OPERATION|FACILITY|BRAND|NETWORK|SHOP|STATION|SMITH|LAB|ROAD)$/.test(w))[0] || String(n).toUpperCase().split(/\s+/)[0]);
  const uniq = short.filter((s, i) => short.indexOf(s) === i);
  for (let k = uniq.length; k > 0; k--) {
    const extra = uniq.length - k;
    const s = 'NEEDS ▸ ' + uniq.slice(0, k).join(' · ') + (extra ? '  +' + extra : '');
    if (x.measureText(s).width <= maxW) return s;
  }
  return 'NEEDS ▸ ' + uniq.length;
}

/* The name plate: parchment-on-warm-black, 1px gold frame, Cinzel caps, the
   PDF badges in a row underneath, a PLANNED tag when the tile does not exist
   in the game yet (SC.status, contract rule 3: readable without colour).
   Returns {texture, w, h, aspect} — scene.js turns it into a sprite. */
export function paintPlate(T, node, opts) {
  const o = opts || {};
  const scale = 2;                                            // canvas px per plate px: crisp at 2x, cheap to upload
  const badges = [];
  const b = node.badges || {};
  for (const k of ['transport', 'market', 'carMarket', 'card']) if (b[k]) badges.push({ key: k, doubt: b[k] === '?' || (node.badgeDoubt || []).indexOf(k) >= 0 });
  const isSys = node.type === 'system', isCh = node.type === 'channel', isHub = node.kind === 'hub';
  const planned = node.status === 'planned';
  const tag = planned ? SC.status.planned.tag : null;
  /* 🔴 THE HUB PLATE IS NOT A DISTRICT HEADING. Round 3's hub plate was the
     same dark box with gold caps and corner pips as BATTLE SYSTEM / JUST
     BUSINESS / CITY BUILDER / CAMP, hanging 250 px away at the top of the
     frame, so the uncaptioned overview read Transport as a FIFTH DISTRICT.
     Here it is inverted — gold field, dark ink, a truck badge beside the name
     and a one-line rule under it — and scene.js hangs it on the LOWEST rung,
     on the hub itself. Nothing else in the map is a filled gold plate. */
  const rule = isHub ? String(o.rule || '') : '';
  /* The PDF writes "what this business needs" as little business icons beside
     the tile (p6: a rock+pick beside Trash Crusher = needs Mining). Round 3
     carried only the four LEGEND badges, so the flat PDF page still explained
     "what X needs" better than the 3D map — the one thing the blind A/B is
     about. The supplier names ride the plate as a short NEEDS line; names, not
     miniature icons, because at overview a 9 px icon is a smudge and a word is
     a word. scene.js derives the list from the graph's pdf supply edges, so
     this file still names no business. */
  const needs = (o.needs || []).filter(Boolean);
  /* 126 css px for a tile plate: two staggered rows of plates over a 5.9-unit
     tile pitch at overview zoom (about 62 px) leaves ~124 px per plate before
     same-row neighbours touch. Wider plates read better alone and collide. */
  const W = (isSys ? 168 : isHub ? 200 : (isCh ? 150 : 118)) * scale, nameSize = (isSys ? 13 : isHub ? 17 : 11) * scale, pad = 6 * scale;
  const probe = document.createElement('canvas').getContext('2d');
  probe.font = '700 ' + nameSize + 'px ' + FONT_HEAD;
  // the heading's tracking is real width: wrap against the tracked measurement
  // or a two-word district name silently runs off both ends of its banner
  if (isSys) { try { probe.letterSpacing = (4 * scale) + 'px'; } catch (e) {} }
  const lines = wrapName(probe, String(node.label || node.id).toUpperCase(), W - pad * 2 - (isHub ? 26 * scale : 0));
  if (isSys) { try { probe.letterSpacing = '0px'; } catch (e) {} }
  const needSize = 7.5 * scale;
  probe.font = '600 ' + needSize + 'px ' + FONT_BODY;
  const needLine = needs.length ? fitNeeds(probe, needs, W - pad * 2) : '';
  const badgeRow = badges.length ? 20 * scale : 0, tagRow = tag ? 12 * scale : 0;
  const needRow = needLine ? needSize * 1.5 : 0, ruleRow = rule ? 10 * scale * 1.5 : 0;
  const H = pad * 2 + lines.length * (nameSize * 1.18) + badgeRow + tagRow + needRow + ruleRow;
  const tex = canvasTex(T, W, Math.ceil(H), (x, w, h) => {
    x.clearRect(0, 0, w, h);
    /* 🔴 A DISTRICT HEADING IS NOT A PLATE. BATTLE SYSTEM / JUST BUSINESS /
       CITY BUILDER / CAMP used to be drawn in exactly the same gold-bordered
       black box as the 27 businesses, at nearly the same size, so an
       uncaptioned overview read JUST BUSINESS as a 28th company standing in
       the middle of the cluster. A heading names a REGION, so it is drawn as
       a region name is drawn: no box at all — wide letter-spaced gold caps on
       a soft scrim between two hairlines. Nothing else in the map looks like
       it, and nothing else in the map is a filled gold plate (the hub). */
    if (isSys) {
      const g = x.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, 'rgba(12,11,10,0)'); g.addColorStop(0.5, 'rgba(12,11,10,.82)'); g.addColorStop(1, 'rgba(12,11,10,0)');
      x.fillStyle = g; x.fillRect(0, 0, w, h);
      x.strokeStyle = 'rgba(212,175,55,.6)'; x.lineWidth = 1 * scale;
      x.beginPath(); x.moveTo(pad, 1.5 * scale); x.lineTo(w - pad, 1.5 * scale);
      x.moveTo(pad, h - 1.5 * scale); x.lineTo(w - pad, h - 1.5 * scale); x.stroke();
    } else {
    x.fillStyle = isHub ? (planned ? 'rgba(120,98,40,.9)' : 'rgba(212,175,55,.95)') : (planned ? 'rgba(20,18,14,.78)' : 'rgba(23,21,15,.94)');
    x.fillRect(0, 0, w, h);
    if (isHub) { x.fillStyle = 'rgba(28,24,16,.92)'; x.fillRect(0, h - 3 * scale, w, 3 * scale); }
    x.strokeStyle = isHub ? '#1c1813' : (planned ? 'rgba(212,175,55,.5)' : 'rgba(212,175,55,.75)');
    x.lineWidth = (isHub ? 2 : 1) * scale; if (planned) x.setLineDash([6 * scale, 4 * scale]);
    x.strokeRect(x.lineWidth / 2, x.lineWidth / 2, w - x.lineWidth, h - x.lineWidth); x.setLineDash([]);
    }
    x.fillStyle = isHub ? '#1c1813' : (planned ? P.inkDim : (isSys ? P.gold : (isCh ? P.emerald : P.ink)));
    x.font = '700 ' + nameSize + 'px ' + FONT_HEAD; x.textAlign = 'center'; x.textBaseline = 'middle';
    // wide tracking is half of what makes a heading read as a region name and
    // not as another company; ignored by engines that do not support it
    if (isSys) { try { x.letterSpacing = (4 * scale) + 'px'; } catch (e) {} }
    // the hub carries its own truck badge, left of the name: a plate nobody can mistake for a heading
    const nx = isHub ? w / 2 + 13 * scale : w / 2;
    let y = pad + nameSize * 0.62;
    for (const ln of lines) { x.fillText(ln, nx, y); y += nameSize * 1.18; }
    if (isSys) { try { x.letterSpacing = '0px'; } catch (e) {} }
    if (isHub) drawBadge(x, 'transport', pad + 13 * scale, pad + lines.length * (nameSize * 1.18) / 2, 24 * scale, false);
    if (rule) {
      /* Fit, never clip. The first cut typed 10px and the hub's one-line rule
         ran off both ends of the plate ("ERY SHIPMENT PASSES THROUGH HE") —
         the single most prominent label in the map, truncated. */
      let rs = 10 * scale;
      x.font = '600 ' + rs + 'px ' + FONT_BODY;
      while (rs > 5 * scale && x.measureText(rule).width > w - pad * 2) { rs -= 0.5 * scale; x.font = '600 ' + rs + 'px ' + FONT_BODY; }
      x.fillStyle = 'rgba(28,24,16,.86)'; x.fillText(rule, w / 2, y + ruleRow / 2 - needSize * 0.2); y += ruleRow;
    }
    if (badges.length) {
      const s = 16 * scale, gap = 6 * scale, total = badges.length * s + (badges.length - 1) * gap;
      let bx = w / 2 - total / 2 + s / 2; const by = y - nameSize * 0.62 + badgeRow / 2 + 1 * scale;
      for (const bd of badges) { drawBadge(x, bd.key, bx, by, s, bd.doubt); bx += s + gap; }
      y += badgeRow;
    }
    if (needLine) {
      x.fillStyle = 'rgba(212,175,55,.82)'; x.font = '600 ' + needSize + 'px ' + FONT_BODY;
      x.fillText(needLine, w / 2, y + needRow / 2 - needSize * 0.15); y += needRow;
    }
    if (tag) { x.fillStyle = P.ember; x.font = '700 ' + (8.5 * scale) + 'px ' + FONT_HEAD; x.fillText(tag, w / 2, y - nameSize * 0.62 + tagRow / 2); }
    if (o.after) o.after(x, w, h);
  });
  return { texture: tex, w: W / scale, h: Math.ceil(H) / scale, aspect: W / H };
}

/* A flat text plane (district names engraved on the ground, road labels). */
export function textPlane(T, text, opts) {
  const o = opts || {};
  const W = 1024, Hc = o.tall ? 256 : 160;
  const tex = canvasTex(T, W, Hc, (x, w, h) => {
    x.clearRect(0, 0, w, h);
    x.fillStyle = o.color || P.gold; x.font = (o.weight || 700) + ' ' + (o.px || 110) + 'px ' + (o.font || FONT_HEAD);
    x.textAlign = 'center'; x.textBaseline = 'middle';
    const lines = String(text).split('\n');
    lines.forEach((ln, i) => x.fillText(ln, w / 2, h / 2 + (i - (lines.length - 1) / 2) * (o.px || 110) * 1.1));
  });
  const m = new T.Mesh(new T.PlaneGeometry(o.w || 20, (o.w || 20) * Hc / W), new T.MeshBasicMaterial({ map: tex, transparent: true, opacity: o.opacity == null ? 0.5 : o.opacity, depthWrite: false }));
  m.renderOrder = 2;
  return m;
}

/* A small FIXED-PIXEL sign (a Sprite, sizeAttenuation off) for the things that
   are not nodes but still have to be readable at overview: the gate names.
   🔴 These used to be textPlane decals lying on the tarmac between two
   districts, and at the overview pitch a ground plane is a few pixels tall,
   the district slabs stand proud of it at both ends and the arch covers the
   middle — photographed as "KET PLACE RESOUR". The owner's p1 writes "Market
   Place Resources" at every hand-off, so it is one of the few labels the map
   cannot afford to lose. Returns {texture,w,h} in userData.px like a plate, so
   scene.js's one fit hook scales it with everything else. */
export function signSprite(T, text, opts) {
  const o = opts || {}, scale = 2, size = (o.px || 9) * scale, pad = 5 * scale;
  const probe = document.createElement('canvas').getContext('2d');
  probe.font = '700 ' + size + 'px ' + FONT_HEAD;
  const s = String(text).toUpperCase();
  const W = Math.ceil(probe.measureText(s).width + pad * 2 + size * 1.4), H = Math.ceil(size + pad * 2);
  const tex = canvasTex(T, W, H, (x, w, h) => {
    x.clearRect(0, 0, w, h);
    x.fillStyle = 'rgba(12,11,10,.8)'; x.fillRect(0, 0, w, h);
    x.strokeStyle = 'rgba(212,175,55,.45)'; x.lineWidth = scale;
    x.beginPath(); x.moveTo(0, h - scale / 2); x.lineTo(w, h - scale / 2); x.stroke();
    x.fillStyle = o.color || P.parchment; x.font = '700 ' + size + 'px ' + FONT_HEAD;
    x.textAlign = 'center'; x.textBaseline = 'middle';
    try { x.letterSpacing = (1.2 * scale) + 'px'; } catch (e) {}
    x.fillText(s, w / 2, h / 2 + scale * 0.5);
  });
  const sp = new T.Sprite(new T.SpriteMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false, sizeAttenuation: false, opacity: o.opacity == null ? 0.95 : o.opacity }));
  /* It hangs DOWNWARD from its anchor, so it lives in the empty band of road
     under the arch instead of in the band the district banners occupy — two
     of the three signs landed on a banner when they grew upward. */
  sp.center.set(0.5, 1); sp.renderOrder = o.renderOrder == null ? 18 : o.renderOrder;
  sp.userData.px = { w: W / scale, h: H / scale };
  return sp;
}

/* ── the bake ───────────────────────────────────────────────────────────── */
/* Merge every mesh under `group` that shares a material into one mesh, with
   the group's local transforms applied. Materials are cloned per bake so the
   caller owns them. Sprites, lines and anything flagged `keep` are left as
   they are. Returns the same group, now with far fewer children. */
export function bakeGroup(T, group) {
  group.updateMatrixWorld(true);
  const inv = new T.Matrix4().copy(group.matrixWorld).invert();
  const buckets = new Map(), keep = [];
  group.traverse((n) => {
    if (n === group) return;
    if (n.isSprite || n.isLine || n.isLineSegments || n.isPoints || n.userData.keep) { keep.push(n); return; }
    if (!n.isMesh) return;
    const key = n.material.uuid;
    if (!buckets.has(key)) buckets.set(key, { mat: n.material, parts: [] });
    const g = n.geometry.index ? n.geometry.toNonIndexed() : n.geometry.clone();
    g.applyMatrix4(new T.Matrix4().multiplyMatrices(inv, n.matrixWorld));
    buckets.get(key).parts.push(g);
    n.geometry.dispose();
  });
  /* rebuild: the kept children come back at their world pose (relative to the
     group), every baked mesh is replaced by one mesh per material */
  const kept = keep.map((n) => ({ n, local: new T.Matrix4().multiplyMatrices(inv, n.matrixWorld.clone()) }));
  for (const { n } of kept) if (n.parent) n.parent.remove(n);
  while (group.children.length) group.remove(group.children[0]);
  for (const { n, local } of kept) { local.decompose(n.position, n.quaternion, n.scale); group.add(n); }
  for (const { mat, parts } of buckets.values()) {
    const merged = mergeGeometries(T, parts);
    const mesh = new T.Mesh(merged, mat.clone());
    mesh.castShadow = true; mesh.receiveShadow = true;
    group.add(mesh);
    for (const p of parts) p.dispose();
  }
  return group;
}

function mergeGeometries(T, list) {
  const attrs = ['position', 'normal', 'uv'];
  const out = new T.BufferGeometry();
  for (const name of attrs) {
    const has = list.filter((g) => g.getAttribute(name));
    if (has.length !== list.length) continue;
    const size = has[0].getAttribute(name).itemSize;
    let n = 0; for (const g of has) n += g.getAttribute(name).count;
    const arr = new Float32Array(n * size); let off = 0;
    for (const g of has) { const a = g.getAttribute(name); arr.set(a.array.subarray(0, a.count * size), off); off += a.count * size; }
    out.setAttribute(name, new T.BufferAttribute(arr, size));
  }
  out.computeBoundingSphere();
  return out;
}

/* ── the registry ───────────────────────────────────────────────────────── */
export const NODE_MESH = {};
/* fn(T, ctx) -> THREE.Group. ctx = { node, MAT, t: tools, size:{w,d,h}, planned } */
export function registerNodeMesh(kind, fn) { NODE_MESH[kind] = fn; }
export function nodeMeshFor(node) {
  return NODE_MESH[node.id] || NODE_MESH[node.kind] || NODE_MESH[node.type] || NODE_MESH.default;
}

/* Build one node: plinth (systems and channels have none — they are
   landmarks), the registered building on top, then bake. `planned` tiles are
   ghosted: every material goes translucent and a dashed gold outline is drawn
   on the ground so the difference reads without colour. */
export function buildNode(T, node, MAT, size) {
  const g = new T.Group();
  const planned = node.status === 'planned';
  const isTile = node.type === 'business';
  const sz = size || SC.layout.tile;
  if (isTile) {
    const hub = node.kind === 'hub';
    const pl = tools.box(T, g, sz.w, sz.h, sz.d, hub ? MAT.plinthHub : MAT.plinth, 0, sz.h / 2, 0);
    pl.userData.plinth = true;
  }
  const inner = new T.Group(); inner.position.y = isTile ? sz.h : 0; g.add(inner);
  const fn = nodeMeshFor(node);
  try { fn(T, { node, MAT, t: tools, size: sz, planned, group: inner }); } catch (e) { try { console.warn('[supplychain] node mesh failed for ' + node.id, e); } catch (_) {} NODE_MESH.default(T, { node, MAT, t: tools, size: sz, planned, group: inner }); }
  bakeGroup(T, g);
  if (planned) {
    g.traverse((n) => { if (n.isMesh && n.material) { n.material.transparent = true; n.material.opacity = SC.status.planned.opacity * 0.8; n.material.depthWrite = false; } });
    const outline = new T.LineSegments(new T.EdgesGeometry(new T.BoxGeometry(sz.w * 1.02, 0.02, sz.d * 1.02)), new T.LineDashedMaterial({ color: hex(P.gold), dashSize: SC.status.planned.dash[0], gapSize: SC.status.planned.dash[1], transparent: true, opacity: 0.9 }));
    outline.computeLineDistances(); outline.position.y = 0.05; outline.userData.keep = true; g.add(outline);
  }
  g.userData.nodeId = node.id;
  return g;
}

/* ═══ BUILDERS ═══════════════════════════════════════════════════════════ */
/* Sizes: a tile is SC.layout.tile (4.2 x 4.2); buildings stay inside ~3.6 and
   under ~3.5 tall so name plates float clear. Each builder is a silhouette
   first: the thing a player recognises from across the map. */

const small = (T, c, w, h, d, m, x, z, ry) => c.t.box(T, c.group, w, h, d, m, x, h / 2, z, ry);

registerNodeMesh('default', (T, c) => {   // a labelled crate: a tile nobody has modelled yet still renders
  small(T, c, 1.8, 1.4, 1.8, c.MAT.wood, 0, 0);
  c.t.box(T, c.group, 2.0, 0.08, 0.2, c.MAT.steelDark, 0, 0.7, 0); c.t.box(T, c.group, 0.2, 0.08, 2.0, c.MAT.steelDark, 0, 0.7, 0);
});

/* ── Transport: the raised hub, and the ONE shape the whole map is about.

   🔴 ROUND 3 FAILED HERE, so read why this is built the way it is. The hub was
   a depot the same SIZE as a business tile with a gold-emissive beacon on a
   mast and an additive light column over it. At overview zoom that is not a
   building at all: it is a ~35 px blown-out white smear, unreadable, and the
   critic could not tell from an uncaptioned frame that Transport is the
   centre — which is the owner's whole rule ("every business has to use the
   transport company to ship").

   The answer is SILHOUETTE, not brightness. Nothing here glows. Instead the
   hub gets a shape no tile has: a long GANTRY spanning the full deck on four
   legs, over a two-lane through-road with the freight driving under it, and a
   pair of funnel walls that visibly collect the lanes off the avenue. A
   gantry reads at 20 px because it is a horizontal beam held in the air with
   daylight under it — the same reason a real container crane is recognisable
   from a plane. Rejected: making it taller (it just joins the plate wall),
   making it brighter (that is what failed), and a colour nobody else uses
   (colour is the third cue in this feature, never the first). */
registerNodeMesh('hub', (T, c) => {
  const M = c.MAT, g = c.group;
  // apron: the deck the lanes ride over, with lane markings down the middle
  c.t.box(T, g, 6.4, 0.16, 3.0, M.steelDark, 0, 0.08, 0);
  for (const z of [-1.05, 1.05]) c.t.box(T, g, 6.0, 0.03, 0.12, M.yellow, 0, 0.18, z);
  // the through-road: north-south, the axis every haul lane pinches into
  c.t.box(T, g, 1.5, 0.04, 3.2, M.ink, 0, 0.19, 0);
  // FUNNEL WALLS — two converging kerbs on each side of the deck. The lanes
  // are drawn between them, so the collector is geometry the eye can see and
  // not a claim in a comment.
  for (const sz of [-1, 1]) for (const sx of [-1, 1]) {
    const w = c.t.box(T, g, 2.0, 0.34, 0.16, M.gold, sx * 1.55, 0.3, sz * 1.5);
    w.rotation.y = sx * sz * 0.62;
  }
  // the two dock sheds, low and wide, flanking the road
  for (const sx of [-1, 1]) {
    small(T, c, 2.0, 1.25, 2.2, M.wall, sx * 2.1, -0.1);
    c.t.box(T, g, 2.2, 0.14, 2.4, M.roofSlate, sx * 2.1, 1.31, -0.1);
    for (const dz of [-0.6, 0.6]) c.t.box(T, g, 0.06, 0.9, 0.8, M.ink, sx * 1.12, 0.6, dz);   // roller doors facing the road
  }
  // THE GANTRY: four legs, one long beam, a trolley. The silhouette.
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) c.t.box(T, g, 0.2, 3.4, 0.2, M.yellow, sx * 3.0, 1.7, sz * 1.25);
  for (const sz of [-1, 1]) c.t.box(T, g, 6.4, 0.26, 0.26, M.yellow, 0, 3.5, sz * 1.25);
  // The crown is TWO cross-beams with daylight between them, not a roof slab.
  // A solid top turned the gantry into a shed and hid the deck, the trucks and
  // the lanes pinching under it — the whole point of the shape (photographed).
  for (const sx of [-1, 0.35]) c.t.box(T, g, 0.26, 0.26, 2.7, M.yellow, sx * 2.0, 3.62, 0);
  c.t.box(T, g, 1.0, 0.5, 1.0, M.steelDark, -1.1, 3.35, 0);                                   // trolley
  c.t.box(T, g, 0.05, 1.1, 0.05, M.ink, -1.1, 2.6, 0);
  c.t.box(T, g, 0.9, 0.35, 0.9, M.orange, -1.1, 1.9, 0);                                      // a container on the hook
  // freight standing on the deck: two semis nose to tail under the gantry
  c.t.vehicle(T, g, M, [2.2, 1.0, 0.9], [0.7, 0.85, 0.8], -1.0, 0.16, 1.0, 0, { body: M.white, cab: M.orange });
  c.t.vehicle(T, g, M, [2.0, 0.95, 0.85], [0.65, 0.8, 0.78], 0.9, 0.16, -1.0, Math.PI, { body: M.white, cab: M.orange });
});

/* ── Mining: a rock pile with a pick planted in it and a timbered adit. */
registerNodeMesh('mining', (T, c) => {
  const M = c.MAT, g = c.group;
  c.t.rock(T, g, 0.9, M.stone, -0.5, 0.6, 0.3); c.t.rock(T, g, 0.6, M.stoneDark, 0.6, 0.45, -0.4); c.t.rock(T, g, 0.45, M.stone, 0.4, 0.35, 0.8);
  c.t.box(T, g, 0.12, 2.2, 0.12, M.wood, -0.1, 1.5, 0.2).rotation.z = -0.5;                        // pick handle
  c.t.box(T, g, 1.3, 0.16, 0.2, M.steel, 0.45, 2.42, 0.2).rotation.z = 0.15;                       // pick head
  small(T, c, 1.4, 1.2, 0.6, M.stoneDark, 1.0, -1.3); c.t.box(T, g, 0.9, 0.9, 0.2, M.ink, 1.0, 0.45, -1.0);
  c.t.box(T, g, 1.5, 0.15, 0.2, M.wood, 1.0, 1.15, -1.0); for (const s of [-1, 1]) c.t.box(T, g, 0.15, 1.1, 0.2, M.wood, 1.0 + s * 0.55, 0.55, -1.0);
  c.t.cone(T, g, 0.7, 0.9, M.gold, -1.3, 0.45, -1.1, 6);                                          // the ore heap: what it sells
});

/* ── Oil: a pumpjack (post, walking beam, horse head, counterweight) and a tank. */
registerNodeMesh('oil', (T, c) => {
  const M = c.MAT, g = c.group;
  c.t.box(T, g, 0.25, 2.4, 0.25, M.red, 0, 1.2, 0); c.t.box(T, g, 0.25, 2.4, 0.25, M.red, 0, 1.2, 0).rotation.z = 0.35;
  c.t.box(T, g, 2.6, 0.2, 0.25, M.steel, 0.1, 2.45, 0).rotation.z = 0.12;                                           // walking beam
  c.t.box(T, g, 0.5, 0.7, 0.4, M.steelDark, 1.3, 2.35, 0);                                                          // horse head
  c.t.cyl(T, g, 0.4, 0.2, M.steelDark, -1.1, 1.0, 0, 'z', 14);                                                      // counterweight
  c.t.box(T, g, 0.08, 1.2, 0.08, M.steel, 1.3, 1.4, 0);
  c.t.cyl(T, g, 0.7, 1.1, M.steelDark, -1.3, 0.55, -1.1, 'y', 16);                                                  // the tank
  c.t.cyl(T, g, 0.12, 0.7, M.ink, 1.3, 0.35, 0, 'y', 8);                                                            // wellhead
  c.t.box(T, g, 2.8, 0.08, 1.6, M.stoneDark, 0.2, 0.04, 0);
});

/* ── Gas Station: canopy on two pillars, a kiosk, two pumps, the red GAS sign. */
registerNodeMesh('gas', (T, c) => {
  const M = c.MAT, g = c.group;
  small(T, c, 1.6, 1.3, 1.4, M.wallLight, -1.0, -1.0); c.t.box(T, g, 1.7, 0.1, 1.5, M.roofSlate, -1.0, 1.35, -1.0);
  c.t.box(T, g, 1.0, 0.7, 0.05, M.glass, -1.0, 0.7, -0.28);
  for (const x of [0.3, 1.5]) c.t.box(T, g, 0.14, 2.0, 0.14, M.steel, x, 1.0, 0.4);
  c.t.box(T, g, 2.6, 0.18, 2.4, M.white, 0.9, 2.05, 0.4); c.t.box(T, g, 2.65, 0.1, 2.45, M.red, 0.9, 2.19, 0.4);
  for (const x of [0.5, 1.3]) { c.t.box(T, g, 0.4, 0.9, 0.3, M.red, x, 0.45, 0.6); c.t.box(T, g, 0.3, 0.3, 0.05, M.ink, x, 0.6, 0.76); }
  c.t.box(T, g, 1.5, 0.55, 0.12, M.red, 0.9, 2.55, 0.4); c.t.box(T, g, 1.35, 0.4, 0.14, M.white, 0.9, 2.55, 0.4);  // GAS sign board
  c.t.cyl(T, g, 0.3, 0.6, M.azure, -0.2, 0.3, 1.4, 'y', 10);                                                       // fuel drum
});

/* ── Car Dealer: a glass showroom with a car on the plinth and a pennant pole. */
registerNodeMesh('cars', (T, c) => {
  const M = c.MAT, g = c.group;
  small(T, c, 2.6, 1.5, 1.4, M.glass, -0.4, -1.0); c.t.box(T, g, 2.8, 0.12, 1.6, M.roofSlate, -0.4, 1.56, -1.0);
  c.t.box(T, g, 2.8, 0.25, 0.1, M.gold, -0.4, 1.35, -0.25);
  c.t.cyl(T, g, 0.9, 0.12, M.gold, 0.6, 0.06, 0.9, 'y', 20);
  c.t.vehicle(T, g, M, [1.3, 0.45, 0.7], null, 0.6, 0.06, 0.9, -0.5, { body: M.orange });
  c.t.box(T, g, 0.8, 0.35, 0.6, M.orange, 0.55, 0.85, 0.85, -0.5);                                                 // cabin
  c.t.box(T, g, 0.08, 2.8, 0.08, M.steel, -1.8, 1.4, 1.2); c.t.box(T, g, 0.5, 0.3, 0.02, M.red, -1.55, 2.6, 1.2);
});

/* ── Construction: a crane (mast, jib, counter-jib, hook) over a half-built wall. */
registerNodeMesh('construction', (T, c) => {
  const M = c.MAT, g = c.group;
  c.t.box(T, g, 0.32, 3.4, 0.32, M.yellow, -1.0, 1.7, -0.6); c.t.box(T, g, 3.2, 0.22, 0.3, M.yellow, 0.4, 3.35, -0.6);
  c.t.box(T, g, 0.9, 0.22, 0.3, M.yellow, -1.9, 3.35, -0.6); c.t.box(T, g, 0.5, 0.4, 0.5, M.steelDark, -1.9, 3.05, -0.6);
  c.t.box(T, g, 0.03, 1.6, 0.03, M.ink, 1.5, 2.45, -0.6); c.t.box(T, g, 0.3, 0.2, 0.3, M.steel, 1.5, 1.6, -0.6);
  small(T, c, 2.0, 1.0, 0.35, M.red, 0.6, 0.4); small(T, c, 1.3, 1.5, 0.35, M.red, 0.25, 0.4);
  c.t.box(T, g, 1.1, 0.8, 0.9, M.orange, 1.2, 0.4, 1.2); c.t.cyl(T, g, 0.45, 0.6, M.orange, 1.2, 0.95, 1.2, 'z', 10);  // mixer
  c.t.cone(T, g, 0.6, 0.6, M.parchment, -1.2, 0.3, 1.2, 8);                                                       // sand heap
});

/* ── Trash Crusher: a yellow crusher with a hopper mouth and a conveyor. */
registerNodeMesh('trashcrusher', (T, c) => {
  const M = c.MAT, g = c.group;
  small(T, c, 2.0, 1.6, 1.6, M.yellow, -0.4, 0); c.t.box(T, g, 2.2, 0.3, 1.8, M.steelDark, -0.4, 0.15, 0);
  c.t.cyl(T, g, 0.9, 0.9, M.yellow, -0.4, 2.05, 0, 'y', 8, 1.2);                                                  // hopper (wider at top)
  c.t.box(T, g, 2.0, 0.14, 0.7, M.steelDark, 1.3, 1.0, 0.2).rotation.z = 0.35;                                      // conveyor
  c.t.box(T, g, 0.1, 0.9, 0.1, M.steel, 2.0, 0.45, 0.2);
  for (let i = 0; i < 3; i++) c.t.rock(T, g, 0.25, M.stoneDark, 0.6 + i * 0.5, 0.9 + i * 0.18, 0.2);
  c.t.cyl(T, g, 0.2, 0.7, M.steelDark, 1.0, 0.35, -1.4, 'y', 8);                                                     // pressed bale
  c.t.box(T, g, 0.9, 0.5, 0.9, M.steel, -1.6, 0.25, 1.3);
});

/* ── Weapon Smith: forge with chimney, an anvil, a sword driven into the stone. */
registerNodeMesh('weaponsmith', (T, c) => {
  const M = c.MAT, g = c.group;
  small(T, c, 2.2, 1.3, 1.6, M.stoneDark, -0.6, -0.5); c.t.box(T, g, 2.4, 0.9, 1.8, M.roof, -0.6, 1.7, -0.5);
  c.t.box(T, g, 0.4, 1.4, 0.4, M.stone, 0.2, 2.2, -0.9); c.t.box(T, g, 0.7, 0.5, 0.06, M.ember, -0.6, 0.45, 0.31);  // the glowing forge mouth
  c.t.box(T, g, 0.7, 0.3, 0.3, M.steelDark, 1.0, 0.55, 0.8); c.t.box(T, g, 0.4, 0.4, 0.4, M.wood, 1.0, 0.2, 0.8);    // anvil
  c.t.box(T, g, 0.14, 2.2, 0.05, M.steel, -1.5, 1.6, 1.0); c.t.box(T, g, 0.6, 0.1, 0.1, M.gold, -1.5, 0.75, 1.0); c.t.box(T, g, 0.12, 0.5, 0.12, M.wood, -1.5, 0.45, 1.0);   // the sword
  c.t.box(T, g, 0.14, 1.0, 0.05, M.violet, -1.5, 2.2, 1.0);
});

/* ── Restaurant: a diner with an awning and the burger-and-cup sign. */
registerNodeMesh('restaurant', (T, c) => {
  const M = c.MAT, g = c.group;
  small(T, c, 2.6, 1.3, 1.6, M.wallLight, 0, -0.4); c.t.box(T, g, 2.8, 0.12, 1.8, M.red, 0, 1.36, -0.4);
  c.t.box(T, g, 2.6, 0.06, 0.7, M.red, 0, 0.95, 0.7).rotation.x = 0.3;                                              // awning
  c.t.box(T, g, 1.6, 0.6, 0.05, M.glass, 0, 0.6, 0.41);
  c.t.cyl(T, g, 0.55, 0.22, M.yellow, -0.8, 2.0, -0.4, 'y', 14); c.t.cyl(T, g, 0.58, 0.16, M.roof, -0.8, 2.2, -0.4, 'y', 14); c.t.cyl(T, g, 0.6, 0.1, M.green, -0.8, 2.33, -0.4, 'y', 14); c.t.sphere(T, g, 0.55, M.yellow, -0.8, 2.45, -0.4);   // the burger
  c.t.cyl(T, g, 0.28, 0.9, M.red, 0.9, 1.9, -0.4, 'y', 10, 0.32); c.t.box(T, g, 0.05, 0.6, 0.05, M.white, 0.95, 2.5, -0.4);   // the cup
});

/* ── Agricultural Op.: ploughed rows with crops and a small barn. */
registerNodeMesh('agri', (T, c) => {
  const M = c.MAT, g = c.group;
  c.t.box(T, g, 3.4, 0.1, 2.4, M.soil, 0, 0.05, 0.4);
  for (let r = -1; r <= 1; r++) { c.t.box(T, g, 3.2, 0.08, 0.3, M.grass, 0, 0.12, 0.4 + r * 0.7); for (let i = -3; i <= 3; i++) c.t.cone(T, g, 0.12, 0.5, M.green, i * 0.45, 0.4, 0.4 + r * 0.7, 5); }
  small(T, c, 1.2, 0.9, 1.0, M.blood, -1.0, -1.4); c.t.box(T, g, 1.3, 0.5, 1.1, M.roof, -1.0, 1.15, -1.4);
  c.t.cyl(T, g, 0.35, 1.3, M.parchment, 1.2, 0.65, -1.4, 'y', 10); c.t.cone(T, g, 0.4, 0.4, M.roof, 1.2, 1.5, -1.4, 10);   // silo
});

/* ── Home Feed: a farmhouse, a fenced yard with animals and a hay bale. */
registerNodeMesh('feed', (T, c) => {
  const M = c.MAT, g = c.group;
  small(T, c, 1.6, 1.1, 1.3, M.wallLight, -0.9, -0.9); c.t.box(T, g, 1.8, 0.6, 1.5, M.roof, -0.9, 1.4, -0.9);
  c.t.box(T, g, 3.4, 0.06, 2.0, M.grass, 0.2, 0.03, 0.6);
  for (const s of [-1, 1]) { c.t.box(T, g, 3.0, 0.06, 0.06, M.wood, 0.4, 0.45, 0.6 + s * 0.95); for (let i = -3; i <= 3; i++) c.t.box(T, g, 0.08, 0.6, 0.08, M.wood, 0.4 + i * 0.5, 0.3, 0.6 + s * 0.95); }
  for (const [x, z, m] of [[0.6, 0.4, M.white], [1.4, 0.9, M.parchment], [0.2, 1.1, M.white]]) { c.t.box(T, g, 0.5, 0.3, 0.3, m, x, 0.4, z); c.t.box(T, g, 0.2, 0.2, 0.2, m, x + 0.3, 0.55, z); }   // goats
  c.t.cyl(T, g, 0.35, 0.6, M.yellow, 1.5, 0.35, -1.0, 'x', 10);                                                    // hay bale
});

/* ── Dojo: a two-tier pagoda with the TRAINING board out front. */
registerNodeMesh('dojo', (T, c) => {
  const M = c.MAT, g = c.group;
  small(T, c, 2.2, 1.0, 1.8, M.roof, 0, -0.5); c.t.box(T, g, 2.8, 0.18, 2.4, M.roofSlate, 0, 1.1, -0.5);
  small(T, c, 1.5, 0.8, 1.2, M.roof, 0, -0.5).position.y = 1.6; c.t.box(T, g, 2.0, 0.16, 1.7, M.roofSlate, 0, 2.1, -0.5);
  c.t.cone(T, g, 0.9, 0.7, M.roofSlate, 0, 2.55, -0.5, 4);
  c.t.box(T, g, 1.5, 0.9, 0.08, M.ink, 0.2, 0.95, 1.2); c.t.box(T, g, 1.6, 1.0, 0.05, M.orange, 0.2, 0.95, 1.16);  // the board (frame)
  for (const s of [-1, 1]) c.t.box(T, g, 0.08, 1.3, 0.08, M.wood, 0.2 + s * 0.7, 0.65, 1.25);
  c.t.box(T, g, 0.9, 0.06, 0.06, M.white, 0.2, 1.0, 1.25);                                                          // the chalk word
});

/* ── Card Shop: a shopfront with a striped awning and a giant card in the window. */
registerNodeMesh('cardshop', (T, c) => {
  const M = c.MAT, g = c.group;
  small(T, c, 2.6, 1.6, 1.6, M.wallLight, 0, -0.4); c.t.box(T, g, 2.8, 0.14, 1.8, M.roofSlate, 0, 1.67, -0.4);
  c.t.box(T, g, 2.4, 0.06, 0.8, M.teal, 0, 1.05, 0.75).rotation.x = 0.25;
  for (let i = -2; i <= 2; i += 2) c.t.box(T, g, 0.3, 0.07, 0.8, M.white, i * 0.5, 1.06, 0.75).rotation.x = 0.25;   // stripes
  c.t.box(T, g, 1.8, 0.7, 0.05, M.glass, 0, 0.5, 0.41);
  c.t.box(T, g, 0.7, 1.0, 0.08, M.gold, 0.9, 1.2, 1.3, -0.3); c.t.box(T, g, 0.55, 0.85, 0.06, M.ink, 0.9, 1.2, 1.35, -0.3);
  c.t.sphere(T, g, 0.1, M.ember, 0.8, 1.35, 1.42, 6); c.t.sphere(T, g, 0.1, M.azure, 1.0, 1.05, 1.42, 6);            // the card's orbs
});

/* ── Fishing Company: a dock over water, a boat with a mast, a rod. */
registerNodeMesh('fishing', (T, c) => {
  const M = c.MAT, g = c.group;
  c.t.box(T, g, 3.6, 0.06, 2.2, M.water, 0, 0.03, 0.5);
  c.t.box(T, g, 1.6, 0.12, 0.7, M.wood, -1.0, 0.3, -0.9); for (const x of [-1.6, -0.4]) c.t.cyl(T, g, 0.08, 0.4, M.wood, x, 0.15, -0.9, 'y', 6);
  c.t.box(T, g, 1.8, 0.45, 0.8, M.roof, 0.6, 0.3, 0.4); c.t.box(T, g, 1.2, 0.35, 0.6, M.white, 0.5, 0.65, 0.4);      // hull + wheelhouse
  c.t.box(T, g, 0.06, 1.6, 0.06, M.wood, 0.9, 1.3, 0.4); c.t.box(T, g, 0.6, 0.9, 0.03, M.parchment, 1.2, 1.5, 0.4);
  c.t.box(T, g, 0.04, 1.8, 0.04, M.wood, -1.5, 1.1, -0.9).rotation.z = -0.7;                                        // the rod
  c.t.box(T, g, 0.3, 0.12, 0.08, M.teal, -0.6, 1.2, -0.7);                                                          // the fish on the line
});

/* ── Fish Cannery: a factory with a chimney, a conveyor and a stack of cans. */
registerNodeMesh('cannery', (T, c) => {
  const M = c.MAT, g = c.group;
  small(T, c, 2.4, 1.4, 1.6, M.teal, -0.4, -0.5); c.t.box(T, g, 2.6, 0.12, 1.8, M.roofSlate, -0.4, 1.46, -0.5);
  c.t.cyl(T, g, 0.18, 1.2, M.steelDark, 0.4, 1.9, -0.9, 'y', 8);
  c.t.box(T, g, 2.2, 0.1, 0.5, M.steelDark, 0.4, 0.5, 0.8); for (let i = 0; i < 4; i++) c.t.cyl(T, g, 0.12, 0.2, M.steel, -0.5 + i * 0.6, 0.65, 0.8, 'y', 8);
  for (let i = 0; i < 3; i++) c.t.cyl(T, g, 0.2, 0.25, M.steel, -1.5, 0.13 + i * 0.27, 1.2, 'y', 10);
  c.t.box(T, g, 0.5, 0.2, 0.14, M.azure, 1.3, 0.7, 0.8);                                                            // the fish going in
});

/* ── Bank: columns, a pediment, a gold coin over the door. */
registerNodeMesh('bank', (T, c) => {
  const M = c.MAT, g = c.group;
  c.t.box(T, g, 3.0, 0.3, 2.2, M.stone, 0, 0.15, 0);
  small(T, c, 2.4, 1.7, 1.6, M.wallLight, 0, -0.3).position.y = 1.15;
  for (let i = -1.5; i <= 1.5; i++) c.t.cyl(T, g, 0.13, 1.6, M.white, i * 0.7, 1.1, 0.75, 'y', 8);
  c.t.box(T, g, 3.0, 0.2, 2.2, M.stone, 0, 2.05, 0); c.t.cone(T, g, 1.65, 0.8, M.teal, 0, 2.55, 0, 4);
  c.t.box(T, g, 0.6, 0.9, 0.06, M.roof, 0, 0.75, 0.52); c.t.cyl(T, g, 0.32, 0.08, M.goldBright, 0, 1.7, 0.56, 'z', 16);
});

/* ── Genetics Lab: a lab block with a glass roof and a double helix. */
registerNodeMesh('genelab', (T, c) => {
  const M = c.MAT, g = c.group;
  small(T, c, 2.6, 1.3, 1.6, M.wallLight, -0.3, -0.5); c.t.box(T, g, 2.2, 0.5, 1.2, M.glass, -0.3, 1.55, -0.5);
  const helix = (m, phase) => { const pts = []; for (let i = 0; i <= 24; i++) { const t = i / 24, a = t * Math.PI * 4 + phase; pts.push(new T.Vector3(1.2 + Math.cos(a) * 0.3, 0.3 + t * 2.6, 0.7 + Math.sin(a) * 0.3)); } const tube = new T.Mesh(new T.TubeGeometry(new T.CatmullRomCurve3(pts), 32, 0.06, 5, false), m); tube.castShadow = true; g.add(tube); };
  helix(M.teal, 0); helix(M.violet, Math.PI);
  for (let i = 0; i < 6; i++) { const t = i / 6, a = t * Math.PI * 4; c.t.box(T, g, 0.6, 0.05, 0.05, M.white, 1.2, 0.3 + t * 2.6 + 0.2, 0.7, -a); }
  c.t.cyl(T, g, 0.25, 0.7, M.glass, -1.2, 0.35, 0.6, 'y', 10); c.t.cyl(T, g, 0.2, 0.3, M.green, -1.2, 0.15, 0.6, 'y', 10);   // the flask
});

/* ── Medical Corporation: hospital block, red cross, a clipboard on the wall. */
registerNodeMesh('medical', (T, c) => {
  const M = c.MAT, g = c.group;
  small(T, c, 2.8, 2.0, 1.7, M.white, -0.2, -0.4); c.t.box(T, g, 3.0, 0.14, 1.9, M.roofSlate, -0.2, 2.07, -0.4);
  c.t.box(T, g, 0.9, 0.3, 0.08, M.red, -0.2, 1.5, 0.48); c.t.box(T, g, 0.3, 0.9, 0.08, M.red, -0.2, 1.5, 0.48);      // the cross
  for (const x of [-1.2, 0.8]) for (const y of [0.5, 1.2]) c.t.box(T, g, 0.4, 0.35, 0.05, M.glass, x, y, 0.47);
  c.t.box(T, g, 0.8, 1.1, 0.1, M.wood, 1.5, 0.6, 0.8, -0.35); c.t.box(T, g, 0.65, 0.9, 0.06, M.parchment, 1.5, 0.55, 0.86, -0.35);   // the clipboard
  c.t.box(T, g, 0.3, 0.15, 0.1, M.steelDark, 1.5, 1.1, 0.86, -0.35);
});

/* ── Fashion Brand (PLANNED): a boutique with a hoodie on the sign. */
registerNodeMesh('fashion', (T, c) => {
  const M = c.MAT, g = c.group;
  small(T, c, 2.4, 1.4, 1.5, M.parchment, 0, -0.4); c.t.box(T, g, 2.6, 0.12, 1.7, M.roof, 0, 1.46, -0.4);
  c.t.box(T, g, 1.4, 0.7, 0.05, M.glass, 0, 0.55, 0.36);
  c.t.box(T, g, 0.9, 1.0, 0.35, M.teal, 0.1, 2.4, -0.4); c.t.box(T, g, 0.32, 0.5, 0.36, M.teal, 0.1, 2.75, -0.5);   // the hoodie: torso + hood
  for (const s of [-1, 1]) c.t.box(T, g, 0.3, 0.8, 0.3, M.teal, 0.1 + s * 0.6, 2.3, -0.4);
  c.t.cyl(T, g, 0.3, 0.5, M.wood, -1.2, 0.25, 0.9, 'y', 10); c.t.cyl(T, g, 0.28, 0.3, M.white, -1.2, 0.65, 0.9, 'y', 10);   // a bolt of cloth
});

/* ── Research Facility: a domed observatory with an atom on the roof. */
registerNodeMesh('research', (T, c) => {
  const M = c.MAT, g = c.group;
  small(T, c, 2.4, 1.2, 1.8, M.wallLight, 0, -0.3); c.t.sphere(T, g, 0.9, M.steel, -0.5, 1.6, -0.3, 12);
  c.t.box(T, g, 0.9, 1.2, 0.05, M.glass, 0.3, 0.6, 0.61);
  c.t.sphere(T, g, 0.16, M.ember, 1.1, 2.2, 0.4, 8);
  c.t.torus(T, g, 0.55, 0.035, M.azure, 1.1, 2.2, 0.4, 0, 0); c.t.torus(T, g, 0.55, 0.035, M.azure, 1.1, 2.2, 0.4, Math.PI / 3, Math.PI / 3); c.t.torus(T, g, 0.55, 0.035, M.azure, 1.1, 2.2, 0.4, -Math.PI / 3, -Math.PI / 3);
  c.t.box(T, g, 0.1, 1.5, 0.1, M.steel, 1.1, 0.75, 0.4);
});

/* ── Car Factory: sawtooth roof, a lift with a car body on it, a robot arm. */
registerNodeMesh('carfactory', (T, c) => {
  const M = c.MAT, g = c.group;
  small(T, c, 3.2, 1.3, 1.8, M.wall, -0.2, -0.4);
  for (let i = -1; i <= 1; i++) { c.t.box(T, g, 1.0, 0.5, 1.8, M.roofSlate, -0.2 + i * 1.05, 1.5, -0.4).rotation.z = 0.5; }
  c.t.box(T, g, 0.14, 1.4, 0.14, M.orange, -1.3, 0.7, 1.1); c.t.box(T, g, 0.14, 1.4, 0.14, M.orange, 0.3, 0.7, 1.1); c.t.box(T, g, 1.8, 0.12, 0.7, M.orange, -0.5, 1.4, 1.1);   // the lift
  c.t.box(T, g, 1.3, 0.35, 0.6, M.steel, -0.5, 1.65, 1.1); c.t.box(T, g, 0.7, 0.3, 0.55, M.steel, -0.5, 1.95, 1.1);                                                     // the shell on it
  c.t.cyl(T, g, 0.25, 0.3, M.steelDark, 1.3, 0.15, 1.0, 'y', 10); c.t.box(T, g, 0.16, 1.1, 0.16, M.yellow, 1.3, 0.7, 1.0).rotation.z = -0.4; c.t.box(T, g, 0.14, 0.8, 0.14, M.yellow, 0.9, 1.4, 1.0).rotation.z = 0.9;
});

/* ── Smuggling Network: container stacks, a crate, a red '!' post. */
registerNodeMesh('smuggling', (T, c) => {
  const M = c.MAT, g = c.group;
  const cols = [M.red, M.azure, M.green, M.orange, M.steelDark];
  let k = 0; for (let x = -1; x <= 1; x++) for (let y = 0; y < (x === 0 ? 3 : 2); y++) small(T, c, 1.0, 0.55, 2.0, cols[k++ % 5], x * 1.05 - 0.3, -0.4).position.y = 0.275 + y * 0.58;
  c.t.box(T, g, 0.6, 0.6, 0.6, M.wood, 1.4, 0.3, 1.1); c.t.box(T, g, 0.5, 0.5, 0.5, M.wood, 1.35, 0.85, 1.05, 0.4);
  c.t.box(T, g, 0.1, 1.8, 0.1, M.steelDark, -1.6, 0.9, 1.2); c.t.box(T, g, 0.22, 0.6, 0.1, M.red, -1.6, 2.0, 1.2); c.t.box(T, g, 0.22, 0.2, 0.1, M.red, -1.6, 1.55, 1.2);   // '!'
});

/* ── Salvage Operation: a scrap heap under a grab crane, a green-tarp tent. */
registerNodeMesh('salvage', (T, c) => {
  const M = c.MAT, g = c.group;
  for (let i = 0; i < 7; i++) c.t.box(T, g, 0.5 + (i % 3) * 0.25, 0.3, 0.4 + (i % 2) * 0.3, i % 2 ? M.steelDark : M.steel, -0.8 + (i % 4) * 0.5, 0.2 + Math.floor(i / 3) * 0.32, -0.6 + (i % 3) * 0.4, i * 0.7);
  c.t.box(T, g, 0.2, 2.6, 0.2, M.yellow, 1.3, 1.3, -1.0); c.t.box(T, g, 2.4, 0.18, 0.2, M.yellow, 0.2, 2.6, -1.0);
  c.t.box(T, g, 0.03, 1.2, 0.03, M.ink, -0.8, 1.9, -1.0); c.t.cone(T, g, 0.32, 0.4, M.steelDark, -0.8, 1.2, -1.0, 6);   // the grab
  c.t.box(T, g, 1.3, 0.8, 1.0, M.green, -1.0, 0.4, 1.2); c.t.cone(T, g, 0.95, 0.6, M.green, -1.0, 1.1, 1.2, 4);       // the tent
  c.t.box(T, g, 0.5, 0.06, 0.5, M.red, 0.9, 0.05, 1.2); c.t.box(T, g, 0.06, 0.06, 0.5, M.white, 0.9, 0.09, 1.2);      // a med kit: the surgeons on the PDF
});

/* ── Warehouse: a long shed with a roll door, pallets, a delivery van. */
registerNodeMesh('warehouse', (T, c) => {
  const M = c.MAT, g = c.group;
  small(T, c, 3.2, 1.6, 1.8, M.wallLight, -0.2, -0.5); c.t.box(T, g, 3.4, 0.5, 2.0, M.roofSlate, -0.2, 1.8, -0.5).rotation.z = 0;
  c.t.cone(T, g, 1.4, 0.5, M.roofSlate, -0.2, 1.85, -0.5, 4).scale.set(1.25, 1, 0.75);
  c.t.box(T, g, 1.1, 1.1, 0.06, M.steelDark, -0.6, 0.55, 0.42); for (let i = 0; i < 4; i++) c.t.box(T, g, 1.1, 0.03, 0.02, M.steel, -0.6, 0.2 + i * 0.28, 0.46);
  for (let i = 0; i < 3; i++) c.t.box(T, g, 0.45, 0.45, 0.45, M.wood, 1.0 + (i % 2) * 0.5, 0.22 + Math.floor(i / 2) * 0.47, 1.0);
  c.t.vehicle(T, g, M, [1.2, 0.7, 0.7], [0.45, 0.6, 0.65], -1.0, 0, 1.3, Math.PI, { body: M.orange, cab: M.white });
});

/* ── City transit (p9): these work only for the city. */
registerNodeMesh('bus', (T, c) => {
  const M = c.MAT, g = c.group;
  const v = c.t.vehicle(T, g, M, [3.0, 1.1, 1.0], null, 0, 0, 0.3, 0, { body: M.yellow });
  for (let i = -2; i <= 2; i++) c.t.box(T, g, 0.4, 0.4, 1.04, M.glass, i * 0.55, 1.0, 0.3);
  c.t.box(T, g, 0.08, 1.8, 0.08, M.steel, -1.6, 0.9, -1.2); c.t.box(T, g, 0.7, 0.4, 0.05, M.azure, -1.4, 1.7, -1.2);   // the stop
  c.t.box(T, g, 1.4, 0.05, 0.6, M.stone, -1.2, 0.03, -1.2);
  void v;
});
registerNodeMesh('rail', (T, c) => {
  const M = c.MAT, g = c.group;
  for (let i = -6; i <= 6; i++) c.t.box(T, g, 0.25, 0.06, 1.1, M.wood, i * 0.28, 0.03, 0.3);
  for (const s of [-1, 1]) c.t.box(T, g, 3.8, 0.06, 0.06, M.steel, 0, 0.08, 0.3 + s * 0.4);
  c.t.box(T, g, 1.6, 0.8, 0.8, M.blood, -0.5, 0.55, 0.3); c.t.cyl(T, g, 0.3, 1.2, M.steelDark, 0.6, 0.6, 0.3, 'x', 10); c.t.box(T, g, 0.7, 0.9, 0.85, M.blood, -0.9, 0.7, 0.3);
  c.t.cyl(T, g, 0.1, 0.5, M.ink, 1.0, 1.15, 0.3, 'y', 8);
  for (const x of [-1.3, 1.3]) c.t.box(T, g, 0.1, 1.6, 0.1, M.steel, x, 0.8, -1.2); c.t.box(T, g, 3.0, 0.1, 1.0, M.roof, 0, 1.65, -1.2);   // platform canopy
});
registerNodeMesh('airport', (T, c) => {
  const M = c.MAT, g = c.group;
  c.t.box(T, g, 3.6, 0.05, 1.0, M.stoneDark, 0, 0.03, 0.9); for (let i = -3; i <= 3; i++) c.t.box(T, g, 0.3, 0.06, 0.08, M.white, i * 0.5, 0.06, 0.9);
  c.t.box(T, g, 0.4, 1.6, 0.4, M.wallLight, -1.2, 0.8, -0.9); c.t.box(T, g, 0.9, 0.5, 0.9, M.glass, -1.2, 1.85, -0.9); c.t.box(T, g, 1.0, 0.1, 1.0, M.roofSlate, -1.2, 2.15, -0.9);   // tower
  c.t.cyl(T, g, 0.22, 1.8, M.white, 0.6, 0.55, 0.0, 'x', 10); c.t.box(T, g, 0.5, 0.05, 2.0, M.white, 0.6, 0.55, 0.0); c.t.box(T, g, 0.3, 0.6, 0.05, M.white, -0.2, 0.85, 0.0);   // plane
});

/* ═══ SYSTEM LANDMARKS ═══════════════════════════════════════════════════ */
/* The four systems are DISTRICTS in scene.js (a ground slab with the name
   engraved). What is built here is the set piece in each district that
   matches the owner's p1 art: a battle card monolith with four orbs, the
   ruined Just Business hospital with a helipad, a city skyline, a camp. */
registerNodeMesh('sys:battle', (T, c) => {
  const M = c.MAT, g = c.group;
  c.t.box(T, g, 3.6, 0.5, 3.6, M.stoneDark, 0, 0.25, 0);
  c.t.box(T, g, 2.2, 3.4, 0.4, M.gold, 0, 2.2, 0); c.t.box(T, g, 1.9, 3.1, 0.2, M.ink, 0, 2.2, 0.15);              // the card
  c.t.sphere(T, g, 0.28, M.ember, -0.55, 3.1, 0.35, 10); c.t.sphere(T, g, 0.28, M.azure, 0.55, 3.1, 0.35, 10);
  c.t.sphere(T, g, 0.26, M.violet, 0.5, 1.4, 0.35, 10); c.t.sphere(T, g, 0.26, M.green, -0.5, 1.4, 0.35, 10);
  c.t.cone(T, g, 0.35, 1.2, M.ink, 0, 2.3, 0.4, 6);                                                                // the mage
  for (const [x, z] of [[-1.5, -1.5], [1.5, -1.5], [-1.5, 1.5], [1.5, 1.5]]) { c.t.box(T, g, 0.5, 1.4 + Math.abs(x + z) * 0.3, 0.5, M.stone, x, 0.9, z); }   // ruined battlements
});
registerNodeMesh('sys:business', (T, c) => {
  const M = c.MAT, g = c.group;
  c.t.box(T, g, 3.4, 0.3, 2.6, M.stoneDark, 0, 0.15, 0);
  small(T, c, 2.6, 2.4, 1.8, M.wall, -0.3, 0).position.y = 1.5; c.t.box(T, g, 1.4, 1.0, 1.4, M.wall, 0.9, 3.2, -0.2);
  c.t.cyl(T, g, 0.7, 0.08, M.roofSlate, 0.9, 3.75, -0.2, 'y', 16); c.t.box(T, g, 0.6, 0.06, 0.12, M.white, 0.9, 3.8, -0.2); c.t.box(T, g, 0.12, 0.06, 0.5, M.white, 0.9, 3.8, -0.2);   // helipad H
  c.t.box(T, g, 0.7, 0.25, 0.08, M.red, -0.3, 2.3, 0.92); c.t.box(T, g, 0.25, 0.7, 0.08, M.red, -0.3, 2.3, 0.92);
  c.t.box(T, g, 0.05, 1.4, 0.05, M.steel, -1.4, 3.4, 0.6); c.t.box(T, g, 0.5, 0.3, 0.02, M.ink, -1.15, 3.95, 0.6);   // the flag
  for (const x of [-1.2, 0.4]) c.t.box(T, g, 0.5, 0.35, 0.05, M.ink, x, 1.2, 0.92);
});
registerNodeMesh('sys:city', (T, c) => {
  const M = c.MAT, g = c.group;
  c.t.box(T, g, 3.6, 0.3, 2.8, M.stoneDark, 0, 0.15, 0);
  const towers = [[-1.3, 0.2, 0.9, 2.6, M.wallLight], [-0.3, -0.3, 0.8, 4.2, M.azure], [0.7, 0.3, 0.9, 3.2, M.teal], [1.5, -0.4, 0.6, 2.2, M.wall], [0.2, 0.9, 0.7, 1.6, M.orange]];
  for (const [x, z, w, h, m] of towers) { c.t.box(T, g, w, h, w, m, x, 0.3 + h / 2, z); c.t.box(T, g, w * 0.7, 0.2, w * 0.7, M.roofSlate, x, 0.3 + h + 0.1, z); }
  c.t.cone(T, g, 0.25, 1.2, M.steel, -0.3, 0.3 + 4.2 + 0.6, -0.3, 4);                                                  // the spire
});
registerNodeMesh('sys:camp', (T, c) => {
  const M = c.MAT, g = c.group;
  c.t.box(T, g, 3.6, 0.2, 3.0, M.soil, 0, 0.1, 0);
  const tent = (x, z, s, ry) => { const t = c.t.cone(T, g, 1.2 * s, 1.5 * s, M.canvas, x, 0.2 + 0.75 * s, z, 3); t.rotation.y = ry || 0; t.scale.z = 1.4; c.t.box(T, g, 0.06, 1.7 * s, 0.06, M.wood, x, 0.2 + 0.85 * s, z); };
  tent(-0.6, -0.3, 1.2, 0.5); tent(1.3, 0.8, 0.8, -0.4);
  for (let i = 0; i < 5; i++) c.t.rock(T, g, 0.14, M.stoneDark, -1.2 + Math.cos(i * 1.26) * 0.45, 0.28, 1.1 + Math.sin(i * 1.26) * 0.45);
  c.t.cone(T, g, 0.25, 0.7, M.ember, -1.2, 0.55, 1.1, 6); c.t.box(T, g, 0.5, 0.08, 0.08, M.wood, -1.2, 0.26, 1.1, 0.6);   // the campfire
  c.t.box(T, g, 0.06, 1.8, 0.06, M.wood, 1.4, 1.1, -1.0); c.t.box(T, g, 0.55, 0.35, 0.02, M.blood, 1.7, 1.8, -1.0);      // the banner
});

/* ═══ CHANNELS ═══════════════════════════════════════════════════════════ */
/* The Marketplace is a GATE between districts (scene.js places one at every
   system hand-off and points them all at ch:market); the Car Marketplace is a
   tow-truck lot beside the district that trades cars. The Cinder flame on the
   gate is the PDF's: every hand-off is paid in Cinder. */
registerNodeMesh('ch:market', (T, c) => {
  const M = c.MAT, g = c.group;
  for (const s of [-1, 1]) { c.t.box(T, g, 0.7, 4.2, 0.7, M.stone, 0, 2.1, s * 2.2); c.t.box(T, g, 0.9, 0.3, 0.9, M.gold, 0, 4.3, s * 2.2); }
  c.t.box(T, g, 0.6, 0.5, 5.3, M.stone, 0, 4.6, 0); c.t.box(T, g, 0.7, 0.12, 5.5, M.gold, 0, 4.9, 0);
  c.t.box(T, g, 0.2, 1.4, 1.4, M.ink, 0, 3.6, 0); c.t.box(T, g, 0.24, 0.9, 0.9, M.parchment, 0, 3.6, 0);              // the icon plate
  c.t.cone(T, g, 0.32, 0.9, M.ember, 0, 5.5, 0, 6); c.t.cone(T, g, 0.18, 0.55, M.goldBright, 0, 5.75, 0, 6);         // the Cinder flame
  c.t.box(T, g, 3.0, 0.05, 5.0, M.stoneDark, 0, 0.03, 0);
});
registerNodeMesh('ch:carmarket', (T, c) => {
  const M = c.MAT, g = c.group;
  c.t.box(T, g, 4.0, 0.12, 3.0, M.stoneDark, 0, 0.06, 0);
  const v = c.t.vehicle(T, g, M, [2.0, 0.8, 0.9], [0.7, 0.9, 0.85], -0.4, 0.12, -0.6, 0, { body: M.yellow, cab: M.yellow });
  c.t.box(T, g, 0.12, 1.4, 0.12, M.yellow, -1.2, 1.4, -0.6).rotation.z = -0.6; c.t.box(T, g, 0.03, 0.8, 0.03, M.ink, -1.9, 1.5, -0.6);   // the boom
  c.t.vehicle(T, g, M, [1.1, 0.4, 0.6], null, -0.4, 0.95, -0.6, 0, { body: M.orange });
  c.t.vehicle(T, g, M, [1.3, 0.45, 0.7], null, 0.6, 0.12, 1.0, 0.2, { body: M.red });
  c.t.box(T, g, 0.08, 2.2, 0.08, M.steel, 1.7, 1.1, -1.0); c.t.box(T, g, 0.6, 0.35, 0.03, M.gold, 1.4, 2.0, -1.0);
  void v;
});
