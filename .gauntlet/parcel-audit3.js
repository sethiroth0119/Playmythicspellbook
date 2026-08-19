(() => {
  const nc = window.__nc, THREE = nc.three().THREE, half = 12;
  const want = { depot: 1, motorpool: 1, farm: 1, lot: 1 };
  const out = {};
  for (const [k, t] of Object.entries(nc.game.tiles)) {
    if (!t.mesh || !want[t.type] || out[t.type]) continue;
    t.mesh.updateMatrixWorld(true);
    const inv = new THREE.Matrix4().copy(t.mesh.matrixWorld).invert();
    const parts = [];
    t.mesh.traverse(m => { if (!m.isMesh) return;
      m.geometry.computeBoundingBox();
      const b = m.geometry.boundingBox.clone()
        .applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, m.matrixWorld));
      parts.push({ tris: (m.geometry.index?m.geometry.index.count:m.geometry.attributes.position.count)/3,
        x:[+b.min.x.toFixed(3),+b.max.x.toFixed(3)], y:[+b.min.y.toFixed(3),+b.max.y.toFixed(3)],
        z:[+b.min.z.toFixed(3),+b.max.z.toFixed(3)] }); });
    out[t.type] = { k, rot: (t.rot|0)&3, parts };
  }
  // and one of each housing archetype
  const hk = {};
  for (const [k, t] of Object.entries(nc.game.tiles)) {
    if (t.type !== 'housing' || !t.mesh) continue;
    let kind = null; t.mesh.traverse(o => { if (o.userData && o.userData.houseKind) kind = o.userData.houseKind; });
    if (hk[kind]) continue;
    t.mesh.updateMatrixWorld(true);
    const inv = new THREE.Matrix4().copy(t.mesh.matrixWorld).invert();
    const parts = [];
    t.mesh.traverse(m => { if (!m.isMesh) return;
      m.geometry.computeBoundingBox();
      const b = m.geometry.boundingBox.clone()
        .applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, m.matrixWorld));
      parts.push({ tris: (m.geometry.index?m.geometry.index.count:m.geometry.attributes.position.count)/3,
        x:[+b.min.x.toFixed(3),+b.max.x.toFixed(3)], y:[+b.min.y.toFixed(3),+b.max.y.toFixed(3)],
        z:[+b.min.z.toFixed(3),+b.max.z.toFixed(3)] }); });
    hk[kind] = { k, rot: (t.rot|0)&3, parts };
  }
  return JSON.stringify({ out, hk }, null, 1);
})()
