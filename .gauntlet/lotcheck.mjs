/* ══ THE LOT GATE ══════════════════════════════════════════════════════════
   Three invariants about the residential parcel, asserted against the REAL
   scene graph of the standard gauntlet city rather than against the source.
   Every one of them exists because it was broken and nobody could see it:

     1. NOTHING CROSSES THE TILE LINE IN X. Round 10 measured a semi at
        maxAbsX .505 — its eaves overhung the neighbour's plot by half a
        centimetre, which is the geometric form of "the lot has no interior".
        The Z overshoot (~.02, the porch step onto the footway) is expected
        and is reported, not failed.
     2. EVERY GARDEN PLOT HAS A DRIVE. The apron bucket holds ONLY the 1-tile
        substrate slab (12 tris) unless a driveway was laid, which adds its
        four kerb slabs (+48). 60 means "this plot has a drive", 12 means it
        does not. Round 9: 28 of 36. Round 10: 36 of 36 — the 8 that were
        missing were all semis, refused by the .19-clear gate.
     3. THE HOUSING BUDGET. Triangles and meshes over the 54 placed plots.
        Meshes are draw calls; the count is the contract with the frame budget
        and a round that moves it has to say so.

   Usage:  node .gauntlet/lotcheck.mjs
   Takes ~90 s: it boots the page and builds the standard district.
   ══════════════════════════════════════════════════════════════════════════ */
import fs from 'node:fs'; import { execFileSync } from 'node:child_process';

/* ⚠ THE MESHES ARE NOT `inner.children`. The first cut read them there, found
   zero on every plot and cheerfully reported "0 plots over the tile line" —
   a green gate on an empty sample, which is the exact failure mode this
   directory's README spends four paragraphs on. traverse(), always. */
const EVAL = `(() => {
  const nc = window.__nc, THREE = nc.three().THREE;
  const rows = [];
  let hTris = 0, hMesh = 0, hCast = 0;
  for (const [k, t] of Object.entries(nc.game.tiles)) {
    if (t.type !== 'housing' || !t.mesh) continue;
    t.mesh.updateMatrixWorld(true);
    const inv = new THREE.Matrix4().copy(t.mesh.matrixWorld).invert();
    let mx = 0, mz = 0; const tris = [];
    t.mesh.traverse(m => { if (!m.isMesh) return;
      const n = m.geometry.index ? m.geometry.index.count / 3 : m.geometry.attributes.position.count / 3;
      tris.push(n); hTris += n; hMesh++; if (m.castShadow) hCast++;
      m.geometry.computeBoundingBox();
      const b = m.geometry.boundingBox.clone();
      b.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, m.matrixWorld));
      mx = Math.max(mx, Math.abs(b.min.x), Math.abs(b.max.x));
      mz = Math.max(mz, Math.abs(b.min.z), Math.abs(b.max.z)); });
    /* 12 buckets = a GARDEN plot; 11 = a FORECOURT one (no lawn). */
    rows.push({ k, meshes: tris.length, garden: tris.length === 12,
                apronTris: tris[8], drive: tris[8] >= 60,
                maxAbsX: +mx.toFixed(4), maxAbsZ: +mz.toFixed(4) });
  }
  const g = rows.filter(r => r.garden);
  return JSON.stringify({
    plots: rows.length, gardenPlots: g.length,
    gardenWithDrive: g.filter(r => r.drive).length,
    overTileLineX: rows.filter(r => r.maxAbsX > .5005).map(r => r.k + '@' + r.maxAbsX),
    maxZOvershoot: +Math.max(...rows.map(r => r.maxAbsZ)).toFixed(4),
    housingTris: hTris, housingMeshes: hMesh, housingCastMeshes: hCast,
  }, null, 1);
})()`;

const out = '.gauntlet/shots/_lotcheck.png';
execFileSync('node', ['.gauntlet/shot.mjs', out, '--scene', '--wait', '20000', '--eval', EVAL],
             { stdio: ['ignore', 'ignore', 'inherit'] });
const r = JSON.parse(fs.readFileSync(out + '.json', 'utf8'));
console.log(JSON.stringify(r, null, 1));
fs.rmSync(out, { force: true }); fs.rmSync(out + '.json', { force: true });
const bad = [];
if (r.overTileLineX.length) bad.push(`geometry crosses the tile line in X: ${r.overTileLineX.join(', ')}`);
if (r.gardenWithDrive !== r.gardenPlots) bad.push(`${r.gardenPlots - r.gardenWithDrive} garden plot(s) have no drive`);
console.log(bad.length ? '\nFAIL\n  ' + bad.join('\n  ') : '\nLOT OK');
process.exit(bad.length ? 1 : 0);
