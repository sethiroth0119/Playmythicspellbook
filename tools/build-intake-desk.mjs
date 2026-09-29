/* Decimate + compress the hospital's intake desk so it can actually ship.
   ─────────────────────────────────────────────────────────────────────────
   Meshy exported 2,990,122 triangles and 115 MB for a reception counter —
   4.6× Cloudflare's 25 MiB per-asset cap, which aborts the ENTIRE deploy
   (see public/.assetsignore). Same disease as the forklift, same cure:
   simplify to a few tens of thousands of triangles, shrink the three 2048²
   JPEGs, ship under an explicit `!` exception.

   ⚠ SOURCE IS THE MASTER, NOT DOWNLOADS. assets-source/glb-masters/ is the
     byte-verified original and lives outside the deploy root; a re-export
     from Meshy goes there first, then this script runs again.
   ⚠ NO DRACO, NO MESHOPT. /src/biolab's ensureGltfLoader never wires a
     DRACOLoader or a meshopt decoder, so a compressed-geometry file would
     throw on parse. Plain triangles, fewer of them.
   ⚠ TEXTURES GO THROUGH SHARP DIRECTLY, NOT textureCompress(). Measured on
     2026-09-04 with @gltf-transform/functions 4.4 and sharp 0.34.5: every
     textureCompress() call died with "colourspace: parameter space not set"
     (libvips rejecting the VipsInterpretation it is handed), in WebP and in
     JPEG alike — while sharp called on the same bytes resizes and encodes
     perfectly. So each texture is resized and encoded by sharp and put back
     with Texture.setImage(). The forklift script still uses textureCompress;
     it ran under an older sharp and has not been re-run since.
   ⚠ TEXTURES ARE BEST-EFFORT, GEOMETRY IS NOT. The mesh is what makes the
     file 110 MB; the textures are 4.5 MB. If the texture pass fails the
     originals ship, the sidecar says so, and the file is still a quarter of
     the cap. The pack never dies after the minutes-long simplify has run.
   ⚠ THE SIDECAR IS THE CONTRACT. intake-desk.json records the packed model's
     measured bounds and triangle count; floor.js's DESK_MODEL.raw must agree
     with it, and _hospital_smoke.mjs checks that they do — so the collider
     and the mesh cannot drift apart when someone re-exports. */
import { NodeIO, getBounds } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { simplify, weld, dedup, prune, resample, flatten, join } from '@gltf-transform/functions';
import { MeshoptSimplifier } from 'meshoptimizer';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';

const SRC = 'assets-source/glb-masters/hospital/intake-desk.glb';
const OUT = 'public/models/hospital/intake-desk.glb';
const SIDECAR = 'public/models/hospital/intake-desk.json';
const TEX_SIZE = 1024, TEX_QUALITY = 82;

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(SRC);
await MeshoptSimplifier.ready;

const tris = (d) => d.getRoot().listMeshes()
  .flatMap((m) => m.listPrimitives())
  .reduce((s, p) => s + (p.getIndices() ? p.getIndices().getCount() / 3 : 0), 0);
console.log('before', Math.round(tris(doc)).toLocaleString(), 'triangles');

// ── 1 · geometry, once ──────────────────────────────────────────────────────
await doc.transform(
  dedup(),
  flatten(),
  join(),
  weld({ tolerance: 0.0001 }),
  /* 1.2% of three million is ~36k — more than the forklift's 18k because a
     counter is seen from a metre away with straight edges that show every
     collapsed silhouette. The error bound stops it early rather than exceed. */
  simplify({ simplifier: MeshoptSimplifier, ratio: 0.012, error: 0.001 }),
  prune(),
  resample(),
);
const after = Math.round(tris(doc));
console.log('after ', after.toLocaleString(), 'triangles');

// ── 2 · write the geometry ──────────────────────────────────────────────────
fs.mkdirSync('public/models/hospital', { recursive: true });
await io.write(OUT, doc);

// ── 3 · textures, in a SEPARATE PROCESS ─────────────────────────────────────
/* 🔴 NOT IN THIS PROCESS, AND THAT IS THE FINDING. Measured on 2026-09-04:
   sharp encodes these exact texture bytes perfectly in a fresh process
   (toColourspace('srgb') → webp, 47 KB, no error) — and fails every time in
   THIS process after meshoptimizer's WASM has simplified three million
   triangles, with "colourspace: parameter space not set" and libvips
   reporting a VipsInterpretation of 32, which is not a value that exists.
   That is corrupted native state, not a bad file. So the geometry is written
   first and tools/glb-textures.mjs is spawned to do the textures with a
   clean libvips. If it fails the originals ship: still a quarter of the cap. */
let textures = 'original-2048-jpeg';
try {
  const r = spawnSync(process.execPath, ['tools/glb-textures.mjs', OUT, String(TEX_SIZE), String(TEX_QUALITY)], { encoding: 'utf8' });
  const line = String(r.stdout || '').trim().split('\n').pop();
  let res = null; try { res = JSON.parse(line); } catch (e) {}
  if (r.status === 0 && res && res.ok) { textures = res.textures; console.log('textures:', textures, '(' + res.encoded + ' encoded, separate process)'); }
  else console.warn('texture pass failed — ' + ((res && res.why) || String(r.stderr || '').split('\n').filter((l) => !/GLib/.test(l)).slice(-1)[0] || 'exit ' + r.status));
} catch (e) {
  console.warn('texture pass failed — ' + String(e && e.message || e).split('\n')[0]);
}
if (textures === 'original-2048-jpeg') console.warn('textures: shipping the originals (2048² JPEG, ~4.5 MB)');

// ── 4 · measure, record ─────────────────────────────────────────────────────
const bytes = fs.statSync(OUT).size;
const scene = doc.getRoot().getDefaultScene() || doc.getRoot().listScenes()[0];
const b = getBounds(scene);
const dims = { w: +(b.max[0] - b.min[0]).toFixed(3), h: +(b.max[1] - b.min[1]).toFixed(3), d: +(b.max[2] - b.min[2]).toFixed(3) };
fs.writeFileSync(SIDECAR, JSON.stringify({
  file: 'intake-desk.glb', bytes, triangles: after, textures,
  bounds: { min: b.min.map((v) => +v.toFixed(3)), max: b.max.map((v) => +v.toFixed(3)) }, dims,
  source: SRC, packedBy: 'tools/build-intake-desk.mjs',
}, null, 2) + '\n');
console.log(OUT, (bytes / 1048576).toFixed(2) + ' MB', 'dims', JSON.stringify(dims), bytes < 25 * 1048576 ? 'UNDER CAP' : 'OVER CAP — DO NOT DEPLOY');
