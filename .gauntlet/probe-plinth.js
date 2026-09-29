/* Is the plinth ON the wall, or floating off it?
   The whole risk of seating a base course off a 16-cell raster is that the
   free/occupied boundary is a CELL EDGE and can be up to 62mm outside the real
   wall. This measures the answer instead of asserting it: every plinth triangle
   is picked out of the merged prop buffer BY ITS VERTEX COLOUR, and its
   horizontal distance to the nearest piece of BUILDING is reported. */
(() => {
  const nc = window.__nc, THREE = nc.three().THREE;
  const HALF = 12, RD_Y = .016, BODY = RD_Y + .085;
  const C = new THREE.Color(0x57534c);          // C_PLINTH, sRGB -> linear
  const g = window.MythicParcel.group(); g.updateMatrixWorld(true);
  const boxes = [];
  for (const m of g.children) {
    if (!m.isMesh || m.geometry.attributes.uv) continue;
    const p = m.geometry.attributes.position, c = m.geometry.attributes.color, v = new THREE.Vector3();
    for (let i = 0; i + 2 < p.count; i += 3) {
      if (Math.abs(c.getX(i) - C.r) > .002 || Math.abs(c.getY(i) - C.g) > .002
          || Math.abs(c.getZ(i) - C.b) > .002) continue;
      v.set((p.getX(i) + p.getX(i + 1) + p.getX(i + 2)) / 3,
            (p.getY(i) + p.getY(i + 1) + p.getY(i + 2)) / 3,
            (p.getZ(i) + p.getZ(i + 1) + p.getZ(i + 2)) / 3).applyMatrix4(m.matrixWorld);
      boxes.push([v.x, v.z]);
    }
  }
  /* Body bboxes, per tile, from the tile's own mesh. */
  const bodies = [];
  for (const [k, t] of Object.entries(nc.game.tiles)) {
    if (!t.mesh || t.type === 'road' || t.type === 'anchor' || t.type === 'housing') continue;
    t.mesh.updateMatrixWorld(true);
    const P = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
    t.mesh.traverse(m => {
      if (!m.isMesh || !m.geometry.attributes.position) return;
      const pos = m.geometry.attributes.position, idx = m.geometry.index, M = m.matrixWorld;
      const n = idx ? idx.count : pos.count;
      for (let i = 0; i + 2 < n; i += 3) {
        let hi = -9, x0 = 9, x1 = -9, z0 = 9, z1 = -9;
        for (let cc = 0; cc < 3; cc++) {
          const v = P[cc];
          v.fromBufferAttribute(pos, idx ? idx.getX(i + cc) : i + cc).applyMatrix4(M);
          if (v.y > hi) hi = v.y;
          if (v.x < x0) x0 = v.x; if (v.x > x1) x1 = v.x;
          if (v.z < z0) z0 = v.z; if (v.z > z1) z1 = v.z;
        }
        if (hi < BODY) continue;
        bodies.push([x0, x1, z0, z1]);
      }
    });
  }
  const d = [];
  for (const [x, z] of boxes) {
    let best = 9;
    for (const [x0, x1, z0, z1] of bodies) {
      const dx = Math.max(x0 - x, 0, x - x1), dz = Math.max(z0 - z, 0, z - z1);
      const h = Math.hypot(dx, dz);
      if (h < best) best = h;
      if (best === 0) break;
    }
    d.push(best);
  }
  d.sort((a, b) => a - b);
  const q = f => +(d[Math.min(d.length - 1, Math.floor(f * d.length))] || 0).toFixed(4);
  return JSON.stringify({
    plinthTris: d.length, bodyTris: bodies.length,
    distToNearestBuilding: { min: q(0), p50: q(.5), p90: q(.9), p99: q(.99), max: +(d[d.length-1]||0).toFixed(4) },
    insideOrTouching: d.filter(v => v <= .0005).length,
    over25mm: d.filter(v => v > .025).length,
  }, null, 1);
})()
