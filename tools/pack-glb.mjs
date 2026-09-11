/* Pack ANY Meshy export for the game — decimate, shrink textures, measure.
   ─────────────────────────────────────────────────────────────────────────
   Usage:
     node tools/pack-glb.mjs --src <master.glb> --out <public/.../x.glb>
          [--ratio 0.012] [--error 0.001] [--tex 1024] [--quality 82] [--bed]

   Writes <out> and <out minus .glb>.json — the SIDECAR: measured bounds,
   dims, triangle count, texture recipe, and with --bed the two numbers a bed
   needs that nobody should guess: how high its mattress surface sits and
   which end the headboard is. The game's data pins itself to the sidecar and
   the smokes check that they agree, so a re-export cannot silently leave a
   collider, a lie height or a pillow end sized for the old mesh.

   ⚠ NO DRACO, NO MESHOPT COMPRESSION — /src/biolab's loader wires neither.
   ⚠ TEXTURES RUN IN A SEPARATE PROCESS (tools/glb-textures.mjs). sharp
     encodes these bytes perfectly in a fresh process and fails every time in
     the process that just ran MeshoptSimplifier over millions of triangles
     ("colourspace: parameter space not set", VipsInterpretation 32 — not a
     real value). Corrupted native state, not a bad file. Geometry is written
     first; if the texture child fails the originals ship. */
import { NodeIO, getBounds } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { simplify, weld, dedup, prune, resample, flatten, join } from '@gltf-transform/functions';
import { MeshoptSimplifier } from 'meshoptimizer';
// compactPrimitive drops the vertices a sloppy pass orphans; guarded because
// it is a newer export and its absence only costs file size, not correctness.
const compactPrimitive = (await import('@gltf-transform/functions')).compactPrimitive;
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';

const args = {};
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (a.startsWith('--')) { const k = a.slice(2); const v = process.argv[i + 1]; if (v && !v.startsWith('--')) { args[k] = v; i++; } else args[k] = true; }
}
const SRC = args.src, OUT = args.out;
if (!SRC || !OUT || !fs.existsSync(SRC)) { console.error('usage: node tools/pack-glb.mjs --src master.glb --out public/models/x.glb [--ratio 0.012] [--error 0.001] [--tex 1024] [--quality 82] [--bed]'); process.exit(1); }
const RATIO = +(args.ratio || 0.012), ERROR = +(args.error || 0.001), TEX = String(args.tex || 1024), QUALITY = String(args.quality || 82);
const SIDECAR = OUT.replace(/\.glb$/i, '') + '.json';

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(SRC);
await MeshoptSimplifier.ready;
const tris = (d) => d.getRoot().listMeshes().flatMap((m) => m.listPrimitives()).reduce((s, p) => s + (p.getIndices() ? p.getIndices().getCount() / 3 : 0), 0);
console.log('before', Math.round(tris(doc)).toLocaleString(), 'triangles');

await doc.transform(dedup(), flatten(), join(), weld({ tolerance: 0.0001 }),
  simplify({ simplifier: MeshoptSimplifier, ratio: RATIO, error: ERROR }), prune(), resample());
const after = Math.round(tris(doc));
console.log('after ', after.toLocaleString(), 'triangles');

/* 🪤 THE TOPOLOGY FLOOR. meshopt's simplifier preserves topology, and a mesh
   that is mostly holes and borders — a grated deck, a railing — has almost
   no edge it is allowed to collapse. Measured on the loading dock: ~101k
   triangles whether the error bound was 0.005, 0.01 or 0.02; loosening it
   did nothing. The only way down is the SLOPPY simplifier, which clusters
   vertices and does not care about topology — coarser, but the baked
   texture carries the grating and an isometric camera never gets close.
   Used only when the topology-preserving pass could not get under
   --max-tris, and the sidecar records that it was. */
const MAX_TRIS = +(args['max-tris'] || 80000), SLOPPY_TARGET = +(args['sloppy-target'] || 40000);
let simplifyMode = 'topology', triangles = after;
if (after > MAX_TRIS) {
  for (const mesh of doc.getRoot().listMeshes()) for (const prim of mesh.listPrimitives()) {
    const idxAcc = prim.getIndices(), posAcc = prim.getAttribute('POSITION');
    if (!idxAcc || !posAcc) continue;
    const indices = new Uint32Array(idxAcc.getArray());
    const positions = new Float32Array(posAcc.getArray());
    const share = (idxAcc.getCount() / 3) / after;             // this primitive's share of the triangles
    const target = Math.max(1, Math.floor(SLOPPY_TARGET * share)) * 3;
    const [out] = MeshoptSimplifier.simplifySloppy(indices, positions, 3, null, target, 0.05);   // (indices, positions, stride, vertex_lock, target, error) in meshoptimizer 0.2x
    idxAcc.setArray(out);
    if (typeof compactPrimitive === 'function') compactPrimitive(prim);
  }
  await doc.transform(prune());
  triangles = Math.round(tris(doc));
  simplifyMode = 'sloppy';
  console.log('sloppy', triangles.toLocaleString(), 'triangles — the topology-preserving pass could not get under', MAX_TRIS.toLocaleString());
}

fs.mkdirSync(OUT.replace(/[\/][^\/]*$/, ''), { recursive: true });
await io.write(OUT, doc);

let textures = 'original-2048-jpeg';
try {
  const r = spawnSync(process.execPath, ['tools/glb-textures.mjs', OUT, TEX, QUALITY], { encoding: 'utf8' });
  let res = null; try { res = JSON.parse(String(r.stdout || '').trim().split('\n').pop()); } catch (e) {}
  if (r.status === 0 && res && res.ok) { textures = res.textures; console.log('textures:', textures, '(' + res.encoded + ' encoded, separate process)'); }
  else console.warn('texture pass failed — ' + ((res && res.why) || 'exit ' + r.status) + '; shipping the originals');
} catch (e) { console.warn('texture pass failed — ' + String(e && e.message || e).split('\n')[0]); }

const scene = doc.getRoot().getDefaultScene() || doc.getRoot().listScenes()[0];
const b = getBounds(scene);
const dims = { w: +(b.max[0] - b.min[0]).toFixed(3), h: +(b.max[1] - b.min[1]).toFixed(3), d: +(b.max[2] - b.min[2]).toFixed(3) };
const side = { file: OUT.replace(/^.*[\/]/, ''), bytes: fs.statSync(OUT).size, triangles, simplify: simplifyMode, textures,
  bounds: { min: b.min.map((v) => +v.toFixed(3)), max: b.max.map((v) => +v.toFixed(3)) }, dims, source: SRC, packedBy: 'tools/pack-glb.mjs' };

if (args.bed) {
  /* 🛏 MEASURED, NOT GUESSED. The mattress surface is the highest thing in
     the middle of the footprint (rails are at the sides, boards at the ends,
     so a 30% central window sees only mattress, blanket and pillow). The
     headboard is where the tallest vertices cluster along the long axis.
     Both in model units above the base; the game scales them with the mesh. */
  const prim = doc.getRoot().listMeshes()[0].listPrimitives()[0];
  const pos = prim.getAttribute('POSITION');
  const long = dims.d >= dims.w ? 2 : 0, wide = long === 2 ? 0 : 2;
  const halfL = (long === 2 ? dims.d : dims.w) / 2, halfW = (wide === 2 ? dims.d : dims.w) / 2;
  const cx = (b.min[0] + b.max[0]) / 2, cz = (b.min[2] + b.max[2]) / 2;
  let mattress = -Infinity, topSum = 0, topN = 0;
  const v = [0, 0, 0], topCut = b.max[1] - 0.2 * dims.h;
  for (let i = 0; i < pos.getCount(); i++) {
    pos.getElement(i, v);
    const dl = (long === 2 ? v[2] - cz : v[0] - cx), dw = (wide === 2 ? v[2] - cz : v[0] - cx);
    if (Math.abs(dl) < 0.3 * halfL && Math.abs(dw) < 0.3 * halfW && v[1] > mattress) mattress = v[1];
    if (v[1] > topCut) { topSum += dl; topN++; }
  }
  const headEnd = topN ? ((topSum / topN) >= 0 ? '+' : '-') + (long === 2 ? 'z' : 'x') : 'unknown';
  side.bed = { longAxis: long === 2 ? 'z' : 'x', mattressTop: +(mattress - b.min[1]).toFixed(3), headEnd, topSamples: topN };
  console.log('bed: long axis', side.bed.longAxis, '· mattress top', side.bed.mattressTop, 'above the base · head at', headEnd, '(' + topN + ' tall vertices)');
}
fs.writeFileSync(SIDECAR, JSON.stringify(side, null, 2) + '\n');
console.log(OUT, (side.bytes / 1048576).toFixed(2) + ' MB', 'dims', JSON.stringify(dims), side.bytes < 25 * 1048576 ? 'UNDER CAP' : 'OVER CAP — DO NOT DEPLOY');
