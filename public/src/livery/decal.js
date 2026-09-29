/* ══════════════════════════════════════════════════════════════════════════
   🚚 LIVERY → VAN — paint the body, put the marks on the panels

   Takes the group WHTruck.build() returns and makes it wear a livery. THREE is
   PASSED IN, never imported: warehouse/index.html loads r128 from a CDN script
   tag and there is exactly one THREE on that page. An import here would either
   fail or, worse, succeed and give this module a SECOND THREE whose materials
   the page's renderer does not recognise.

   ── HOW THE PANELS ARE FOUND ──────────────────────────────────────────────
   Not by name. truck.js lofts the shell as ONE merged mesh with a paint group
   and an underbody group, so there is no "left wall" object to look up. The
   decals are therefore free-standing planes positioned from truck.js's OWN
   dimension table (D), passed in as `dims`, and floated 12 mm proud of the
   skin. That number is not arbitrary: below ~8 mm the plane and the lofted
   flank z-fight at the far end of the yard, which reads as a flickering logo.

   ⚠ A DECAL IS NOT A DECAL IF IT SHOWS THROUGH THE VAN. The planes are
     single-sided and depth-tested; each flank gets its own, facing out. One
     DoubleSide plane through the middle would be cheaper and would show the
     logo mirrored through the bodywork from the far side.

   ⚠ EVERYTHING HERE IS SAFE-LANE BY DEFAULT. paint/accent/emblem/name need no
     review and are applied unconditionally. The uploaded logo is applied ONLY
     when the caller hands over a logoUrl, and renderPlan() in livery.js is the
     only thing that produces one — it returns null for every state except
     'approved'. This module deliberately does NOT know how to look a status up,
     so it cannot get that decision wrong.
   ══════════════════════════════════════════════════════════════════════════ */

import { renderPlan, PANELS, EMBLEM_IDS } from './livery.js';

/* ── Emblems, drawn to a canvas. No files, no network, recoloured live. ──── */
export function drawEmblem(ctx, id, w, h, color) {
  const S = Math.min(w, h), cx = w / 2, cy = h / 2;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(S / 100, S / 100);
  ctx.strokeStyle = color; ctx.fillStyle = color;
  ctx.lineWidth = 7; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  const path = (pts, close) => {
    ctx.beginPath(); pts.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])));
    if (close) ctx.closePath();
  };
  switch (id) {
    case 'chevron':
      [0, 26].forEach((o) => { path([[-38, 6 + o - 13], [0, -20 + o - 13], [38, 6 + o - 13]]); ctx.stroke(); });
      break;
    case 'cog': {
      ctx.beginPath();
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * Math.PI * 2, r1 = 38, r2 = 27;
        ctx.lineTo(Math.cos(a) * r1, Math.sin(a) * r1);
        const b = ((i + 0.5) / 10) * Math.PI * 2;
        ctx.lineTo(Math.cos(b) * r2, Math.sin(b) * r2);
      }
      ctx.closePath(); ctx.fill();
      ctx.globalCompositeOperation = 'destination-out';
      ctx.beginPath(); ctx.arc(0, 0, 13, 0, Math.PI * 2); ctx.fill();
      ctx.globalCompositeOperation = 'source-over';
      break;
    }
    case 'anvil':
      path([[-34, 6], [-20, -12], [22, -12], [34, 2], [16, 6], [16, 16], [-12, 16], [-12, 6]], true);
      ctx.fill();
      ctx.fillRect(-16, 18, 32, 12);
      break;
    case 'crown':
      path([[-36, 20], [-28, -18], [-12, 4], [0, -24], [12, 4], [28, -18], [36, 20]], true);
      ctx.fill(); ctx.fillRect(-36, 24, 72, 10);
      break;
    case 'flask':
      path([[-9, -34], [9, -34], [9, -10], [30, 26], [-30, 26]], true); ctx.stroke();
      ctx.fillRect(-14, -38, 28, 7);
      break;
    case 'bolt':
      path([[6, -38], [-22, 6], [-2, 6], [-8, 38], [22, -8], [2, -8]], true); ctx.fill();
      break;
    case 'wing':
      for (let i = 0; i < 3; i++) {
        ctx.beginPath();
        ctx.ellipse(-6 + i * 4, -14 + i * 14, 34 - i * 6, 7, -0.18, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    case 'shield':
      path([[0, -36], [32, -22], [28, 12], [0, 36], [-28, 12], [-32, -22]], true); ctx.stroke();
      break;
    case 'star': {
      ctx.beginPath();
      for (let i = 0; i < 10; i++) {
        const a = -Math.PI / 2 + (i / 10) * Math.PI * 2, r = i % 2 ? 16 : 38;
        ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
      }
      ctx.closePath(); ctx.fill();
      break;
    }
    case 'wave':
      for (let k = -1; k <= 1; k++) {
        ctx.beginPath(); ctx.moveTo(-38, k * 17);
        for (let x = -38; x <= 38; x += 2) ctx.lineTo(x, k * 17 + Math.sin(x / 9) * 7);
        ctx.stroke();
      }
      break;
    case 'skull':
      ctx.beginPath(); ctx.arc(0, -6, 26, Math.PI, 0); ctx.fill();
      ctx.fillRect(-26, -6, 52, 16);
      ctx.globalCompositeOperation = 'destination-out';
      [[-11, -4], [11, -4]].forEach((p) => { ctx.beginPath(); ctx.arc(p[0], p[1], 7, 0, Math.PI * 2); ctx.fill(); });
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillRect(-16, 12, 32, 12);
      break;
    case 'compass':
      ctx.beginPath(); ctx.arc(0, 0, 34, 0, Math.PI * 2); ctx.stroke();
      path([[0, -30], [10, 0], [0, 30], [-10, 0]], true); ctx.fill();
      break;
    default: break;
  }
  ctx.restore();
}

/* A panel texture: emblem, and the fleet name under it. One canvas per panel so
   the two flanks and the rear door can differ in aspect without stretching. */
function panelCanvas(doc, plan, panel) {
  const P = PANELS[panel];
  const px = 512, py = Math.round((px * P.h) / P.w);
  const c = doc.createElement('canvas'); c.width = px; c.height = py;
  const ctx = c.getContext('2d');
  if (!ctx) return null;
  ctx.clearRect(0, 0, px, py);

  const hasName = !!plan.fleetName;
  const emH = hasName ? py * 0.64 : py * 0.86;

  if (plan.emblem && EMBLEM_IDS.includes(plan.emblem)) {
    const box = Math.min(px * 0.62, emH);
    ctx.save(); ctx.translate(px / 2 - box / 2, emH / 2 - box / 2);
    drawEmblem(ctx, plan.emblem, box, box, plan.accent);
    ctx.restore();
  }
  if (hasName) {
    /* Painted signwriting, not a UI label — small caps, wide tracking, and a
       hairline under it, which is what a real fleet name on a box van looks
       like. Filled with accent so it always reads against the paint. */
    const fs = Math.round(py * 0.19);
    ctx.fillStyle = plan.accent;
    ctx.font = '600 ' + fs + 'px Georgia, "Times New Roman", serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const name = plan.fleetName.toUpperCase();
    let tracked = '';
    for (const ch of name) tracked += ch + ' ';
    ctx.fillText(tracked.trim(), px / 2, py * 0.82, px * 0.9);
    ctx.fillRect(px * 0.18, py * 0.93, px * 0.64, Math.max(1, py * 0.012));
  }
  return c;
}

function texFromCanvas(THREE, canvas) {
  const t = new THREE.Texture(canvas);
  t.needsUpdate = true;
  if ('colorSpace' in t && THREE.SRGBColorSpace) t.colorSpace = THREE.SRGBColorSpace;
  else if ('encoding' in t && THREE.sRGBEncoding) t.encoding = THREE.sRGBEncoding;
  t.anisotropy = 4;
  return t;
}

const PROUD = 0.012;   // 12 mm off the skin — see the header

export function applyLivery(THREE, truck, livery, opts) {
  if (!THREE || !truck) return null;
  const o = opts || {};
  const dims = o.dims || {};
  const doc = o.document || (typeof document !== 'undefined' ? document : null);
  const plan = renderPlan(livery);

  /* ── 1. PAINT. Recolour the shell's paint material in place. The mesh's
        material may be an array (truck.js lofts with [paintShell, underbody]),
        so both shapes are handled. The underbody is left alone deliberately —
        painting the chassis body-colour is what made an early build look like
        a toy rather than a van. */
  const paint = new THREE.Color(plan.paint);
  truck.traverse((n) => {
    if (!n.isMesh || !n.material) return;
    const list = Array.isArray(n.material) ? n.material : [n.material];
    list.forEach((m) => {
      if (!m || !m.color) return;
      if (m.userData && m.userData.noPaint) return;
      /* Identify the painted skin by its ORIGINAL colour, recorded the first
         time through. Matching on the live colour would repaint the whole van
         — glass, tyres and all — the second time this ran. */
      if (m.userData.__basePaint === undefined) {
        m.userData.__basePaint = m.color.getHex();
      }
      if (m.userData.__basePaint === 0xe8e4da) m.color.copy(paint);
      if (m.userData.__basePaint === 0xb9b5ac) m.color.copy(paint).multiplyScalar(0.8);
    });
  });

  /* ── 2. Clear anything a previous call added. Re-applying a livery must not
        stack decals — the player moves a slider and this runs every frame of
        the drag. */
  const old = [];
  truck.traverse((n) => { if (n.userData && n.userData.__livery) old.push(n); });
  old.forEach((n) => {
    if (n.parent) n.parent.remove(n);
    if (n.geometry) n.geometry.dispose();
    if (n.material) {
      const l = Array.isArray(n.material) ? n.material : [n.material];
      l.forEach((m) => { if (m.map) m.map.dispose(); m.dispose && m.dispose(); });
    }
  });

  if (!doc) return { plan, decals: 0 };

  const halfW  = Number(dims.halfW)  || 1.05;
  const zRear  = Number(dims.zRear)  || -2.92;
  const zBulk  = Number(dims.zBulkhead) || 0.40;
  const floorY = Number(dims.floorY) || 0.60;
  const shldY  = Number(dims.shoulderY) || 2.78;

  const boxMidZ = (zRear + zBulk) / 2;
  const boxMidY = (floorY + shldY) / 2;

  const made = [];
  const addPanel = (panel, tex, place, transform) => {
    const P = PANELS[panel];
    const g = new THREE.PlaneGeometry(P.w * place.s, P.h * place.s);
    const m = new THREE.MeshStandardMaterial({
      map: tex, transparent: true, roughness: 0.55, metalness: 0.05,
      // 🔴 polygonOffset, not just the 12 mm gap. The flank is a lofted curve,
      //    not a plane: near the shoulder it bows toward the decal and the gap
      //    alone stops being enough.
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(g, m);
    mesh.userData.__livery = true;
    transform(mesh, place);
    truck.add(mesh);
    made.push(mesh);
    return mesh;
  };

  /* ── 3. The panels. */
  const sideCanvas = panelCanvas(doc, plan, 'side');
  const rearCanvas = panelCanvas(doc, plan, 'rear');
  const hasSideArt = !!(plan.emblem || plan.fleetName);

  if (sideCanvas && hasSideArt) {
    [1, -1].forEach((sx) => {
      addPanel('side', texFromCanvas(THREE, sideCanvas), plan.place.side, (mesh, pl) => {
        mesh.position.set(sx * (halfW + PROUD), boxMidY + pl.y, boxMidZ + pl.x * sx);
        mesh.rotation.y = sx > 0 ? Math.PI / 2 : -Math.PI / 2;
        mesh.rotation.z = (pl.r * Math.PI) / 180;
      });
    });
  }
  if (rearCanvas && hasSideArt) {
    addPanel('rear', texFromCanvas(THREE, rearCanvas), plan.place.rear, (mesh, pl) => {
      mesh.position.set(pl.x, boxMidY + pl.y, zRear - PROUD);
      mesh.rotation.y = Math.PI;
      mesh.rotation.z = (pl.r * Math.PI) / 180;
    });
  }

  /* ── 4. The uploaded logo, if and only if the caller was handed a URL.
        Loaded crossOrigin so a Supabase public URL can be used as a texture
        without tainting; a load FAILURE leaves the van in its safe livery
        rather than throwing, which is the same fail-closed shape as the rest
        of the system. */
  if (plan.logoUrl) {
    const loader = new THREE.TextureLoader();
    loader.setCrossOrigin && loader.setCrossOrigin('anonymous');
    loader.load(plan.logoUrl, (tex) => {
      if ('colorSpace' in tex && THREE.SRGBColorSpace) tex.colorSpace = THREE.SRGBColorSpace;
      else if ('encoding' in tex && THREE.sRGBEncoding) tex.encoding = THREE.sRGBEncoding;
      [1, -1].forEach((sx) => {
        addPanel('side', tex, plan.place.side, (mesh, pl) => {
          mesh.position.set(sx * (halfW + PROUD * 2), boxMidY + pl.y, boxMidZ + pl.x * sx);
          mesh.rotation.y = sx > 0 ? Math.PI / 2 : -Math.PI / 2;
          mesh.rotation.z = (pl.r * Math.PI) / 180;
        });
      });
      addPanel('rear', tex, plan.place.rear, (mesh, pl) => {
        mesh.position.set(pl.x, boxMidY + pl.y, zRear - PROUD * 2);
        mesh.rotation.y = Math.PI;
        mesh.rotation.z = (pl.r * Math.PI) / 180;
      });
      if (typeof o.onLogo === 'function') o.onLogo(true);
    }, undefined, () => { if (typeof o.onLogo === 'function') o.onLogo(false); });
  }

  return { plan, decals: made.length, meshes: made };
}

export default { applyLivery, drawEmblem };
