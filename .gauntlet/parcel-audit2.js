(() => {
  const nc = window.__nc, THREE = nc.three().THREE;
  const half = 12;
  /* ── housing archetypes: userData.houseKind is set on the group _hHouseBody
     returns, which _nOnTile and placeMeshAt then wrap. traverse for it. ──── */
  const kinds = {}, rows = [];
  for (const [k, t] of Object.entries(nc.game.tiles)) {
    if (t.type !== 'housing' || !t.mesh) continue;
    let kind = null;
    t.mesh.traverse(o => { if (o.userData && o.userData.houseKind) kind = o.userData.houseKind; });
    const tris = [];
    t.mesh.traverse(m => { if (m.isMesh) tris.push(m.geometry.index ? m.geometry.index.count/3
                                     : m.geometry.attributes.position.count/3); });
    kinds[kind] = (kinds[kind] || 0) + 1;
    rows.push({ k, kind, n: tris.length, apron: tris[8], lawn: tris.length===12?tris[10]:0,
                leaf: tris[tris.length-1] });
  }
  const byKind = {};
  for (const r of rows) {
    const b = byKind[r.kind] = byKind[r.kind] || { n:0, drive:0, lawn:0, leaf:0 };
    b.n++; if (r.apron >= 60) b.drive++; if (r.lawn) b.lawn++; b.leaf += r.leaf;
  }
  for (const k in byKind) byKind[k].leafAvg = Math.round(byKind[k].leaf / byKind[k].n);

  /* ── THE JOIN. For each non-housing building tile: the building's own
     footprint half-extent in tile units, and the nearest parcel prop to that
     wall. If the nearest standing thing is out at the property line, the
     building meets its ground with nothing at the join. ─────────────────── */
  const g = window.MythicParcel ? window.MythicParcel.group() : null;
  const props = [];      // world XZ of every standing-buffer triangle centroid
  if (g) { g.updateMatrixWorld(true);
    for (const m of g.children) {
      if (!m.isMesh || m.geometry.attributes.uv) continue;
      const p = m.geometry.attributes.position, v = new THREE.Vector3();
      for (let i = 0; i < p.count; i += 3) {
        v.set((p.getX(i)+p.getX(i+1)+p.getX(i+2))/3, (p.getY(i)+p.getY(i+1)+p.getY(i+2))/3,
              (p.getZ(i)+p.getZ(i+1)+p.getZ(i+2))/3).applyMatrix4(m.matrixWorld);
        props.push([v.x, v.y, v.z]);
      }
    }
  }
  const joins = [];
  for (const [k, t] of Object.entries(nc.game.tiles)) {
    if (!t.mesh || t.type === 'road' || t.type === 'anchor' || t.type === 'housing') continue;
    const [gx, gz] = k.split(',').map(Number);
    const cx = gx - half + .5, cz = gz - half + .5;
    // building footprint: bbox of every mesh whose geometry stands above .06
    const bb = new THREE.Box3(); let any = false;
    t.mesh.updateMatrixWorld(true);
    t.mesh.traverse(m => { if (!m.isMesh) return;
      m.geometry.computeBoundingBox();
      const b = m.geometry.boundingBox.clone().applyMatrix4(m.matrixWorld);
      if (b.max.y < .06) return;                 // paving / apron: not the body
      bb.union(b); any = true; });
    if (!any) continue;
    // nearest standing prop to the body's wall, measured horizontally
    let best = 9;
    for (const [px, py, pz] of props) {
      if (py < .02) continue;
      const dx = Math.max(bb.min.x - px, 0, px - bb.max.x);
      const dz = Math.max(bb.min.z - pz, 0, pz - bb.max.z);
      const d = Math.hypot(dx, dz);
      if (d < best) best = d;
    }
    joins.push({ k, type: t.type, bodyHalfX: +((bb.max.x - bb.min.x)/2).toFixed(3),
                 bodyHalfZ: +((bb.max.z - bb.min.z)/2).toFixed(3),
                 nearestProp: +best.toFixed(3) });
  }
  return JSON.stringify({ kinds, byKind, joins, propTri: props.length }, null, 1);
})()
