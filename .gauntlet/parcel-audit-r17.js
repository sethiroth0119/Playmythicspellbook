/* ROUND 17 — THE FRESH PARCEL AUDIT.
   Per non-housing building TYPE that actually places on the standard district:
     · how many placed
     · OWN GROUND, MEASURED (not read off a list): the fraction of the tile
       covered by the recipe's own upward-facing geometry at paving height
     · what /src/parcel actually emitted on that tile, split by element:
       flat surface quads at PAD, lot-line quads at LINE, standing prop tris
     · the foundation edge's boxes, isolated from the boundary/props by height
   Everything is read out of the live scene graph. Nothing is inferred from
   the module's own bookkeeping, because the module's bookkeeping is what the
   audit is checking. */
(() => {
  const nc = window.__nc, THREE = nc.three().THREE;
  const HALF = 12;
  const RD_Y = 0.016;
  const PAD = RD_Y + .0015, LINE = RD_Y + .010, PROP = RD_Y + .0025;

  /* ── 1. per-tile own-ground coverage, rasterised off the tile's OWN mesh ──
     32x32 cells; a cell is covered when an upward-facing triangle whose
     vertices all sit within 20mm of the paving datum passes over it. Using the
     triangle's XZ bounding box over-reports slightly, which is the safe
     direction for a question phrased as "does this recipe already pave it". */
  const N = 32;
  function ownGround(mesh, cx, cz) {
    const occ = new Uint8Array(N * N);
    mesh.updateMatrixWorld(true);
    const P = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
    mesh.traverse(m => {
      if (!m.isMesh || !m.geometry || !m.geometry.attributes.position) return;
      const pos = m.geometry.attributes.position, idx = m.geometry.index, M = m.matrixWorld;
      const n = idx ? idx.count : pos.count;
      for (let i = 0; i + 2 < n; i += 3) {
        let ok = true, x0 = 9, x1 = -9, z0 = 9, z1 = -9;
        for (let c = 0; c < 3; c++) {
          const v = P[c];
          v.fromBufferAttribute(pos, idx ? idx.getX(i + c) : i + c).applyMatrix4(M);
          if (Math.abs(v.y - RD_Y) > .020) ok = false;
          if (v.x < x0) x0 = v.x; if (v.x > x1) x1 = v.x;
          if (v.z < z0) z0 = v.z; if (v.z > z1) z1 = v.z;
        }
        if (!ok) continue;
        const i0 = Math.max(0, Math.floor((x0 - cx + .5) * N)), i1 = Math.min(N - 1, Math.floor((x1 - cx + .5) * N));
        const j0 = Math.max(0, Math.floor((z0 - cz + .5) * N)), j1 = Math.min(N - 1, Math.floor((z1 - cz + .5) * N));
        for (let j = j0; j <= j1; j++) for (let ii = i0; ii <= i1; ii++) occ[j * N + ii] = 1;
      }
    });
    let n = 0; for (let i = 0; i < occ.length; i++) n += occ[i];
    return n / (N * N);
  }

  /* ── 2. what /src/parcel put on each tile ──────────────────────────────── */
  const grp = window.MythicParcel ? window.MythicParcel.group() : null;
  const flat = [], prop = [];      // [x, y, z] centroids, world
  if (grp) {
    grp.updateMatrixWorld(true);
    for (const m of grp.children) {
      if (!m.isMesh) continue;
      const isFlat = !!m.geometry.attributes.uv;   // the surface buffer carries uv; the prop buffer does not
      const p = m.geometry.attributes.position, v = new THREE.Vector3();
      for (let i = 0; i + 2 < p.count; i += 3) {
        v.set((p.getX(i) + p.getX(i + 1) + p.getX(i + 2)) / 3,
              (p.getY(i) + p.getY(i + 1) + p.getY(i + 2)) / 3,
              (p.getZ(i) + p.getZ(i + 1) + p.getZ(i + 2)) / 3).applyMatrix4(m.matrixWorld);
        (isFlat ? flat : prop).push([v.x, v.y, v.z]);
      }
    }
  }
  const bin = (arr, cx, cz, test) => {
    let n = 0;
    for (const p of arr) if (Math.abs(p[0] - cx) < .52 && Math.abs(p[2] - cz) < .52 && test(p)) n++;
    return n;
  };

  const byType = {};
  for (const [k, t] of Object.entries(nc.game.tiles)) {
    if (!t || !t.mesh) continue;
    if (t.type === 'housing' || t.type === 'road' || t.type === 'anchor') continue;
    const [gx, gz] = k.split(',').map(Number);
    const cx = gx - HALF + .5, cz = gz - HALF + .5;
    const r = byType[t.type] || (byType[t.type] = { n: 0, own: 0, surf: 0, line: 0, propTris: 0, foundTris: 0, tris: 0, meshes: 0 });
    r.n++;
    r.own += ownGround(t.mesh, cx, cz);
    let tri = 0, msh = 0;
    t.mesh.traverse(m => { if (!m.isMesh) return; msh++;
      tri += m.geometry.index ? m.geometry.index.count / 3 : m.geometry.attributes.position.count / 3; });
    r.tris += tri; r.meshes += msh;
    r.surf += bin(flat, cx, cz, p => Math.abs(p[1] - PAD) < .002);
    r.line += bin(flat, cx, cz, p => Math.abs(p[1] - LINE) < .002);
    /* The foundation edge is the only standing element seated with its
       underside 8mm BELOW the prop datum, so its boxes are the prop-buffer
       triangles whose centroid sits between PROP-.010 and PROP+.040. Boundary
       walls/palisades and every §5 prop stand taller than that. */
    r.propTris += bin(prop, cx, cz, () => true);
    r.foundTris += bin(prop, cx, cz, p => p[1] > PROP - .012 && p[1] < PROP + .040);
  }
  const rows = Object.entries(byType).map(([ty, r]) => ({
    type: ty, n: r.n,
    ownGroundPct: +(100 * r.own / r.n).toFixed(1),
    parcelSurfTrisPerTile: +(r.surf / r.n).toFixed(1),
    lotLineTrisPerTile: +(r.line / r.n).toFixed(1),
    standingTrisPerTile: +(r.propTris / r.n).toFixed(1),
    lowStandingTrisPerTile: +(r.foundTris / r.n).toFixed(1),
    bldTrisPerTile: Math.round(r.tris / r.n), bldMeshes: Math.round(r.meshes / r.n),
  })).sort((a, b) => b.n - a.n);

  let pv = null; try { pv = window.MythicParcel.verify(); } catch (e) { pv = { err: String(e) }; }
  return JSON.stringify({ rows, parcelVerify: pv,
    totals: { flatTris: flat.length, propTris: prop.length } }, null, 1);
})()
