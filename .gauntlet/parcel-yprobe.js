(() => {
  const g = window.MythicParcel.group(); g.updateMatrixWorld(true);
  const THREE = window.__nc.three().THREE; const out = [];
  for (const m of g.children) {
    const p = m.geometry.attributes.position, v = new THREE.Vector3();
    let lo = 9, hi = -9; const hist = {};
    for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i).applyMatrix4(m.matrixWorld);
      if (v.y < lo) lo = v.y; if (v.y > hi) hi = v.y;
      const b = (v.y * 20 | 0) / 20; hist[b] = (hist[b] || 0) + 1; }
    out.push({ uv: !!m.geometry.attributes.uv, verts: p.count, yMin: +lo.toFixed(4), yMax: +hi.toFixed(4),
               hist: Object.entries(hist).sort((a,b)=>a[0]-b[0]).slice(0,14) });
  }
  return JSON.stringify(out, null, 1);
})()
