/* ═══════════════════════════════════════════════════════════════════════════
   mapforge.nav.js — NAVIGATION: a grid navmesh baked from the terrain and the
   solid colliders, A* over it, and string-pulled paths for agents to walk.

   WHY a grid and not a polygon navmesh: the world IS a heightfield with
   boxes on it. A cell grid (default 1 m) over the terrain square captures
   walkability exactly the way the player controller sees it — too steep,
   under water, or under a collider taller than a step is blocked — bakes in
   a few milliseconds for a 160×160 map, and A* over 25k cells with a binary
   heap is sub-millisecond per query. Recast-style polygon meshes buy nothing
   here and cost a build step.

   bake() is called when play starts (and on demand); the editor draws the
   result as a green/red overlay. Paths are smoothed by line-of-sight over
   the grid so agents cut corners naturally instead of zig-zagging.
   ═══════════════════════════════════════════════════════════════════════════ */

export const NAV_DEFAULTS = { cell: 1, maxSlope: 0.9, agentRadius: 0.35, step: 0.55 };

export function createNav(world, opts) {
  opts = Object.assign({}, NAV_DEFAULTS, opts || {});
  let n = 0, cell = opts.cell, half = 0, walk = null, baked = false, version = 0;
  const idx = (cx, cz) => cz * n + cx;
  const toCell = (x, z) => [Math.round((x + half) / cell), Math.round((z + half) / cell)];
  const toWorld = (cx, cz) => [cx * cell - half, cz * cell - half];
  const inside = (cx, cz) => cx >= 0 && cz >= 0 && cx < n && cz < n;

  function bake() {
    const t = world.map.terrain, size = t.n * t.cell;
    cell = opts.cell; n = Math.max(2, Math.round(size / cell) + 1); half = size / 2;
    walk = new Uint8Array(n * n);
    const water = world.map.water, pad = opts.agentRadius;
    const cols = Array.from(world.colliders.values());
    for (let cz = 0; cz < n; cz++) for (let cx = 0; cx < n; cx++) {
      const [x, z] = toWorld(cx, cz);
      const h = world.heightAt(x, z);
      let ok = true;
      if (Math.abs(x) > half - 0.2 || Math.abs(z) > half - 0.2) ok = false;
      if (ok && water && water.on && h < water.level - 0.35) ok = false;          // wading is fine, swimming is not a path
      if (ok) { // slope: the steepest of the four neighbours over one cell
        const d = Math.max(Math.abs(world.heightAt(x + cell, z) - h), Math.abs(world.heightAt(x - cell, z) - h), Math.abs(world.heightAt(x, z + cell) - h), Math.abs(world.heightAt(x, z - cell) - h));
        if (d / cell > opts.maxSlope) ok = false;
      }
      if (ok) for (let i = 0; i < cols.length; i++) {
        const c = cols[i];
        if (c.top - h <= opts.step || c.bottom > h + 1.8) continue;               // low = steppable ground, high = overhead
        const hit = c.shape === 'cyl' ? ((x - c.cx) * (x - c.cx) + (z - c.cz) * (z - c.cz) < (c.r + pad) * (c.r + pad)) : (x > c.minX - pad && x < c.maxX + pad && z > c.minZ - pad && z < c.maxZ + pad);
        if (hit) { ok = false; break; }
      }
      walk[idx(cx, cz)] = ok ? 1 : 0;
    }
    baked = true; version++;
    return api;
  }
  const walkableCell = (cx, cz) => inside(cx, cz) && walk[idx(cx, cz)] === 1;
  function walkable(x, z) { if (!baked) bake(); const [cx, cz] = toCell(x, z); return walkableCell(cx, cz); }
  function nearestWalkable(x, z, maxR) {
    if (!baked) bake(); const [cx, cz] = toCell(x, z); if (walkableCell(cx, cz)) return [x, z];
    const R = Math.max(1, Math.round((maxR || 8) / cell));
    for (let r = 1; r <= R; r++) for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) { if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue; if (walkableCell(cx + dx, cz + dz)) return toWorld(cx + dx, cz + dz); }
    return null;
  }
  /* grid line of sight (Bresenham) for string-pulling */
  function los(ax, az, bx, bz) {
    let dx = Math.abs(bx - ax), dz = Math.abs(bz - az), sx = ax < bx ? 1 : -1, sz = az < bz ? 1 : -1, err = dx - dz, x = ax, z = az;
    for (let k = 0; k < 4096; k++) {
      if (!walkableCell(x, z)) return false;
      if (x === bx && z === bz) return true;
      const e2 = 2 * err;
      if (e2 > -dz) { err -= dz; x += sx; if (!walkableCell(x, z)) return false; }
      if (e2 < dx) { err += dx; z += sz; }
    }
    return false;
  }
  /* A* — 8-connected, no corner cutting through blocked orthogonals, binary heap. */
  function findPath(from, to, maxNodes) {
    if (!baked) bake();
    let [sx, sz] = toCell(from[0], from[1]); let [gx, gz] = toCell(to[0], to[1]);
    if (!walkableCell(sx, sz)) { const nw = nearestWalkable(from[0], from[1], 6); if (!nw) return null; [sx, sz] = toCell(nw[0], nw[1]); }
    if (!walkableCell(gx, gz)) { const nw = nearestWalkable(to[0], to[1], 6); if (!nw) return null; [gx, gz] = toCell(nw[0], nw[1]); }
    const N = n * n, g = new Float32Array(N).fill(Infinity), came = new Int32Array(N).fill(-1), closed = new Uint8Array(N);
    const heap = []; const push = (i, f) => { heap.push([f, i]); let k = heap.length - 1; while (k > 0) { const p = (k - 1) >> 1; if (heap[p][0] <= heap[k][0]) break; [heap[p], heap[k]] = [heap[k], heap[p]]; k = p; } };
    const pop = () => { const top = heap[0]; const last = heap.pop(); if (heap.length) { heap[0] = last; let k = 0; for (;;) { let l = 2 * k + 1, r = l + 1, m = k; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === k) break; [heap[m], heap[k]] = [heap[k], heap[m]]; k = m; } } return top; };
    const H = (cx, cz) => { const dx = Math.abs(cx - gx), dz = Math.abs(cz - gz); return Math.max(dx, dz) + 0.4142 * Math.min(dx, dz); };
    const start = idx(sx, sz), goal = idx(gx, gz); g[start] = 0; push(start, H(sx, sz));
    let expanded = 0; const limit = maxNodes || 20000;
    while (heap.length) {
      const [, cur] = pop(); if (closed[cur]) continue; closed[cur] = 1;
      if (cur === goal) break;
      if (++expanded > limit) return null;
      const cx = cur % n, cz = (cur - cx) / n;
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dz) continue; const nx = cx + dx, nz = cz + dz;
        if (!walkableCell(nx, nz)) continue;
        if (dx && dz && (!walkableCell(cx + dx, cz) || !walkableCell(cx, cz + dz))) continue;
        const ni = idx(nx, nz); if (closed[ni]) continue;
        const ng = g[cur] + ((dx && dz) ? 1.4142 : 1);
        if (ng < g[ni]) { g[ni] = ng; came[ni] = cur; push(ni, ng + H(nx, nz)); }
      }
    }
    if (came[goal] < 0 && goal !== start) return null;
    const cells = []; for (let c = goal; c >= 0; c = came[c]) { cells.push(c); if (c === start) break; }
    cells.reverse();
    // string-pull: keep only the corners that need turning
    const pts = [cells[0]]; let anchor = 0;
    for (let i = 2; i < cells.length; i++) { const a = cells[anchor], b = cells[i]; if (!los(a % n, (a - a % n) / n, b % n, (b - b % n) / n)) { pts.push(cells[i - 1]); anchor = i - 1; } }
    if (cells.length > 1) pts.push(cells[cells.length - 1]);
    const out = pts.map(c => { const [x, z] = toWorld(c % n, (c - c % n) / n); return { x, z }; });
    out[0] = { x: from[0], z: from[1] }; out[out.length - 1] = { x: to[0], z: to[1] };
    return out;
  }
  /* editor overlay: one small quad per cell, green walkable / red blocked, hugging the ground */
  function debugMesh(THREE) {
    if (!baked) bake();
    const count = n * n, pos = new Float32Array(count * 18), col = new Float32Array(count * 18);
    const s = cell * 0.42; let k = 0;
    for (let cz = 0; cz < n; cz++) for (let cx = 0; cx < n; cx++) {
      const [x, z] = toWorld(cx, cz); const y = world.heightAt(x, z) + 0.06; const ok = walk[idx(cx, cz)] === 1;
      const r = ok ? 0.25 : 0.9, gg = ok ? 0.85 : 0.2, b = 0.25;
      const quad = [[x - s, z - s], [x + s, z - s], [x + s, z + s], [x - s, z - s], [x + s, z + s], [x - s, z + s]];
      quad.forEach(([qx, qz]) => { pos[k] = qx; pos[k + 1] = y; pos[k + 2] = qz; col[k] = r; col[k + 1] = gg; col[k + 2] = b; k += 3; });
    }
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.45, depthWrite: false })); m.name = 'mf-navmesh'; m.renderOrder = 12; return m;
  }
  const api = { bake, walkable, nearestWalkable, findPath, debugMesh, get baked() { return baked; }, get version() { return version; }, get cells() { return n; }, get cellSize() { return cell; }, invalidate() { baked = false; } };
  return api;
}
