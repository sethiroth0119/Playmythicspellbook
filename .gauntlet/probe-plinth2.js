/* Where are the plinth runs, and how long is the longest? Picked out of the
   merged prop buffer by vertex colour, grouped by tile. */
(() => {
  const nc = window.__nc, THREE = nc.three().THREE;
  const HALF = 12;
  const C = new THREE.Color(0x57534c);
  const g = window.MythicParcel.group(); g.updateMatrixWorld(true);
  const pts = [];
  for (const m of g.children) {
    if (!m.isMesh || m.geometry.attributes.uv) continue;
    const p = m.geometry.attributes.position, c = m.geometry.attributes.color, v = new THREE.Vector3();
    for (let i = 0; i + 2 < p.count; i += 3) {
      if (Math.abs(c.getX(i) - C.r) > .002 || Math.abs(c.getY(i) - C.g) > .002
          || Math.abs(c.getZ(i) - C.b) > .002) continue;
      for (let k = 0; k < 3; k++) {
        v.set(p.getX(i + k), p.getY(i + k), p.getZ(i + k)).applyMatrix4(m.matrixWorld);
        pts.push([v.x, v.z]);
      }
    }
  }
  const byTile = {};
  for (const [x, z] of pts) {
    const k = Math.round(x - .5) + ',' + Math.round(z - .5);
    const b = byTile[k] || (byTile[k] = { n: 0, x0: 9, x1: -9, z0: 9, z1: -9 });
    b.n++; b.x0 = Math.min(b.x0, x); b.x1 = Math.max(b.x1, x);
    b.z0 = Math.min(b.z0, z); b.z1 = Math.max(b.z1, z);
  }
  const rows = Object.entries(byTile).map(([k, b]) => {
    const [cx, cz] = k.split(',').map(Number);
    const t = nc.game.tiles[(cx + HALF) + ',' + (cz + HALF)];
    return { at: k, type: t ? t.type : '?', verts: b.n,
             box: [+b.x0.toFixed(2), +b.x1.toFixed(2), +b.z0.toFixed(2), +b.z1.toFixed(2)],
             span: +Math.max(b.x1 - b.x0, b.z1 - b.z0).toFixed(3) };
  }).sort((a, b) => b.span - a.span);
  return JSON.stringify({ total: pts.length / 3, rows: rows.slice(0, 12) }, null, 1);
})()
