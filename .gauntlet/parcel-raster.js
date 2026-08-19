(() => {
  const nc = window.__nc, THREE = nc.three().THREE, half = 12, FN = 16;
  const RD_Y = .016, BODY_Y = RD_Y + .085;
  const SKIP = new Set(['road','anchor','housing','tree','bush','garden','fountain','wall','gate','streetlight','interchange','indexfund','holdco']);
  const rows = [];
  for (const [k, t] of Object.entries(nc.game.tiles)) {
    if (!t.mesh || SKIP.has(t.type)) continue;
    const [gx, gz] = k.split(',').map(Number);
    const cx = gx - half + .5, cz = gz - half + .5;
    const occ = new Uint8Array(FN*FN); const v = new THREE.Vector3();
    t.mesh.updateMatrixWorld(true);
    let verts = 0;
    t.mesh.traverse(m => { if (!m.isMesh || !m.geometry.attributes.position) return;
      const p = m.geometry.attributes.position, M = m.matrixWorld, idx = m.geometry.index;
      const n = idx ? idx.count : p.count;
      verts += p.count;
      const P = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
      for (let i = 0; i < n; i += 3) {
        let hi = -9, x0=9, x1=-9, z0=9, z1=-9;
        for (let c = 0; c < 3; c++) {
          P[c].fromBufferAttribute(p, idx ? idx.getX(i+c) : i+c).applyMatrix4(M);
          if (P[c].y > hi) hi = P[c].y;
          if (P[c].x < x0) x0 = P[c].x; if (P[c].x > x1) x1 = P[c].x;
          if (P[c].z < z0) z0 = P[c].z; if (P[c].z > z1) z1 = P[c].z;
        }
        if (hi < BODY_Y) continue;
        const i0 = Math.max(0, Math.floor((x0 - cx + .5)*FN)), i1 = Math.min(FN-1, Math.floor((x1 - cx + .5)*FN));
        const j0 = Math.max(0, Math.floor((z0 - cz + .5)*FN)), j1 = Math.min(FN-1, Math.floor((z1 - cz + .5)*FN));
        for (let jj = j0; jj <= j1; jj++) for (let ii = i0; ii <= i1; ii++) occ[jj*FN+ii] = 1;
      } });
    const at = (i,j) => (i<0||j<0||i>=FN||j>=FN) ? 0 : occ[j*FN+i];
    const mass = (i,j) => { let n=0; for(let a=-1;a<=1;a++)for(let b=-1;b<=1;b++) if(a||b) n+=at(i+a,j+b); return n>=3; };
    /* OUTSIDE = free cells reachable from the tile edge. Without this the ring
       lands in the gaps BETWEEN a depot's pipes and inside a farm's crop rows. */
    const outside = new Uint8Array(FN*FN); const st = [];
    for (let i=0;i<FN;i++) for (const j of [0, FN-1]) { if(!occ[j*FN+i] && !outside[j*FN+i]){outside[j*FN+i]=1; st.push([i,j]);}
                                                        if(!occ[i*FN+j] && !outside[i*FN+j]){outside[i*FN+j]=1; st.push([j,i]);} }
    while (st.length) { const [i,j] = st.pop();
      for (const [a,b] of [[1,0],[-1,0],[0,1],[0,-1]]) { const ni=i+a, nj=j+b;
        if (ni<0||nj<0||ni>=FN||nj>=FN) continue;
        if (occ[nj*FN+ni] || outside[nj*FN+ni]) continue;
        outside[nj*FN+ni]=1; st.push([ni,nj]); } }
    let ring = 0, occN = 0;
    const map = [];
    for (let j=0;j<FN;j++){ let s='';
      for (let i=0;i<FN;i++){
        const lx=(i+.5)/FN-.5, lz=(j+.5)/FN-.5;
        if (occ[j*FN+i]) { occN++; s+='#'; continue; }
        if (!outside[j*FN+i]) { s+='_'; continue; }
        let ok=false;
        for (const [a,b] of [[1,0],[-1,0],[0,1],[0,-1]]) if (at(i+a,j+b) && mass(i+a,j+b)) ok=true;
        if (ok && Math.abs(lx)<=.43 && Math.abs(lz)<=.43) { ring++; s+='o'; } else s += ok?'.':' ';
      } map.push(s); }
    rows.push({ k, type: t.type, verts, occ: occN, ring, map });
  }
  return JSON.stringify(rows, null, 1);
})()
