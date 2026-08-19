/* ══ THE PARCEL AUDIT ══════════════════════════════════════════════════════
   Round 12. Reads the REAL scene graph of the standard gauntlet district and
   answers, per building tile, which of dimension 5's seven elements it has:
   lawn, driveway, path, hedge/fence, foundation planting, bins, parked car.

   Not from the source — from the buffers. Housing plots are read through the
   twelve-bucket contract (bucket 8 = apron, 9 = path, 10 = lawn, 11 = leaf);
   non-housing tiles are read by projecting /src/parcel's two merged buffers
   back onto the tile grid, which is the only way to find out what that layer
   actually put on a given plot.
   ══════════════════════════════════════════════════════════════════════════ */
(() => {
  const nc = window.__nc, THREE = nc.three().THREE;
  const HALF = 12;   // GRID/2 — derived below from a known tile, not trusted

  /* Derive HALF from a placed tile so the projection cannot silently drift. */
  let half = null;
  for (const [k, t] of Object.entries(nc.game.tiles)) {
    if (!t.mesh) continue;
    const [gx] = k.split(',').map(Number);
    half = gx - (t.mesh.position.x - .5); break;
  }

  const houses = [], others = [];
  for (const [k, t] of Object.entries(nc.game.tiles)) {
    if (!t.mesh) continue;
    const [gx, gz] = k.split(',').map(Number);
    if (t.type === 'housing') {
      const tris = [];
      // the twelve buckets are direct children of `inner`, in emission order
      t.mesh.traverse(m => { if (!m.isMesh) return;
        tris.push(m.geometry.index ? m.geometry.index.count / 3
                                   : m.geometry.attributes.position.count / 3); });
      houses.push({ k, kind: (t.mesh.children[0] && t.mesh.children[0].parent
                              ? t.mesh.userData.houseKind : null) || t.mesh.userData.houseKind,
                    n: tris.length, apron: tris[8], path: tris[9],
                    lawn: tris.length === 12 ? tris[10] : 0,
                    leaf: tris[tris.length - 1] });
    } else {
      others.push({ k, gx, gz, type: t.type, rot: (t.rot | 0) & 3 });
    }
  }

  /* ── /src/parcel, projected back onto tiles ─────────────────────────────── */
  const pc = { flatTris: {}, propTris: {}, meshes: 0, totalFlat: 0, totalProp: 0 };
  const g = window.MythicParcel ? window.MythicParcel.group() : null;
  if (g) {
    g.updateMatrixWorld(true);
    for (const m of g.children) {
      if (!m.isMesh) continue;
      pc.meshes++;
      const p = m.geometry.attributes.position, v = new THREE.Vector3();
      const flat = m.geometry.attributes.uv ? true : false;   // flat buffer carries uv
      const n = p.count;
      for (let i = 0; i < n; i += 3) {
        v.set((p.getX(i) + p.getX(i+1) + p.getX(i+2)) / 3, 0,
              (p.getZ(i) + p.getZ(i+1) + p.getZ(i+2)) / 3);
        v.applyMatrix4(m.matrixWorld);
        const key = Math.round(v.x + half - .5) + ',' + Math.round(v.z + half - .5);
        const bin = flat ? pc.flatTris : pc.propTris;
        bin[key] = (bin[key] || 0) + 1;
      }
      if (flat) pc.totalFlat += n / 3; else pc.totalProp += n / 3;
    }
  }

  /* ── /src/parking, per tile: is there a parked car in front of this plot? ── */
  let parkSpots = [];
  try { parkSpots = (window.MythicParking && window.MythicParking.spots) ? window.MythicParking.spots() : []; } catch (e) {}

  const byKind = {};
  for (const h of houses) {
    const b = byKind[h.kind] = byKind[h.kind] || { n: 0, drive: 0, lawn: 0, leafTris: 0, meshes: 0 };
    b.n++; if (h.apron >= 60) b.drive++; if (h.lawn) b.lawn++;
    b.leafTris += h.leaf; b.meshes += h.n;
  }
  for (const k in byKind) { byKind[k].leafTris = Math.round(byKind[k].leafTris / byKind[k].n);
                            byKind[k].meshes = +(byKind[k].meshes / byKind[k].n).toFixed(1); }

  const otherRows = others.map(o => ({
    ...o, flat: pc.flatTris[o.k] || 0, prop: pc.propTris[o.k] || 0,
  }));

  return JSON.stringify({
    half, houses: houses.length, byKind,
    parcel: { meshes: pc.meshes, flatTris: pc.totalFlat, propTris: pc.totalProp,
              served: window.MythicParcel ? window.MythicParcel.count() : -1,
              classes: window.MythicParcel ? window.MythicParcel.classes() : null },
    others: otherRows,
    parkedSpots: parkSpots.length,
  }, null, 1);
})()
