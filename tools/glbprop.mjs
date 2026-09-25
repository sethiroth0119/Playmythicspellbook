/* ══════════════════════════════════════════════════════════════════════════
   🚚 GLB PROP PACKER — a raw generator export → something a game can ship.

   The character packer next door (glbpack-character.mjs) merges CLIPS onto a
   rigged mesh. This one is for STATIC props, where the problem is different
   and much blunter: Meshy hands back a photogrammetry-grade shell. Measured on
   the three trucks this was written for:

       Freight truck A   2,961,744 triangles   6.3 MB of JPEG
       Freight truck B   3,047,208 triangles   6.0 MB of JPEG
       Fuel Titan        2,958,914 triangles   8.0 MB of JPEG

   Three million triangles for a vehicle that is forty pixels tall on the
   Prince Portfolios lot card. Shipping these as-is would put ~40 MB and nine
   million triangles into a page that already carries a 15 MB index.html, and
   the phone players would simply never load the yard.

   So: weld, simplify to a triangle budget, drop what the simplifier orphaned,
   and hand the file to the texture pass.

   🔴 THE TEXTURE STEP IS A SEPARATE PROCESS AND THAT IS NOT NEGOTIABLE. See
      the header of tools/glbtexture.mjs: importing @gltf-transform/functions
      anywhere in a process breaks sharp's encoder ("colourspace: parameter
      space not set"). This file imports functions, so it must never touch
      sharp; it spawns glbtexture.mjs at the end instead.

   ⚠ SIMPLIFY NEEDS WELD FIRST. A generator export has split vertices at every
     UV seam, so the simplifier sees a mesh made of disconnected islands and
     refuses to collapse across them — you ask for 99% off and get 4%. weld()
     stitches them by position first. This is the single difference between
     this working and this appearing to do nothing.

   Usage:
     node tools/glbprop.mjs <in.glb> <out.glb> [targetTris] [maxPx] [quality] [sloppy]

   Example:
     node tools/glbprop.mjs raw/truck.glb public/models/trucks/tanker.glb 9000
   ══════════════════════════════════════════════════════════════════════════ */

import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { weld, simplify, prune, dedup, resample, quantize } from '@gltf-transform/functions';
import { MeshoptSimplifier } from 'meshoptimizer';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const IN = process.argv[2];
const OUT = process.argv[3];
const TARGET = Math.max(200, parseInt(process.argv[4], 10) || 9000);
const MAXPX = Math.max(64, parseInt(process.argv[5], 10) || 1024);
const QUALITY = Math.max(1, Math.min(100, parseInt(process.argv[6], 10) || 82));
/* Opt-in shape-destroying pass — see the block that uses it. */
const SLOPPY = String(process.argv[7] || '').toLowerCase() === 'sloppy';

if (!IN || !OUT) {
  console.error('usage: node tools/glbprop.mjs <in.glb> <out.glb> [targetTris] [maxPx] [quality] [sloppy]');
  process.exit(1);
}

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(IN);

function countTris(d) {
  let t = 0;
  for (const m of d.getRoot().listMeshes()) {
    for (const p of m.listPrimitives()) {
      const i = p.getIndices();
      t += i ? i.getCount() / 3 : (p.getAttribute('POSITION')?.getCount() || 0) / 3;
    }
  }
  return Math.round(t);
}

const before = countTris(doc);
const inBytes = fs.statSync(IN).size;
console.log('in     : ' + path.basename(IN));
console.log('tris   : ' + before.toLocaleString());

/* The ratio the simplifier is asked for. It is a TARGET, not a guarantee:
   MeshoptSimplifier stops early rather than exceed `error`, so a shell with
   hard creases lands above the budget. That is the correct failure — a truck
   with its cab collapsed is worse than a truck with too many triangles — and
   the achieved count is printed so it can be seen rather than assumed. */
await MeshoptSimplifier.ready;

/* 🔴 DROP TANGENTS BEFORE WELDING, and this is the difference between the
   simplifier working and the simplifier stalling. Two vertices only weld when
   EVERY attribute matches, so a per-vertex TANGENT — which a generator writes
   discontinuously across each UV island — keeps the mesh split into islands
   the simplifier cannot collapse across.
   Measured on the Fuel Titan: with tangents kept it bottomed out at 53,002
   triangles from 79,281 vertices (a ratio of 1.5 where a welded mesh is ~0.5)
   and would go no lower however wide the error was opened.
   Nothing is lost visually: three.js computes tangents from screen-space
   derivatives when the attribute is absent, which is what it does for every
   normal-mapped mesh in this game already. */
for (const mesh of doc.getRoot().listMeshes()) {
  for (const prim of mesh.listPrimitives()) {
    for (const sem of prim.listSemantics()) {
      if (sem === 'TANGENT' || sem === 'COLOR_0' || /^TEXCOORD_[1-9]/.test(sem)) {
        prim.setAttribute(sem, null);
      }
    }
  }
}

await doc.transform(
  resample(),
  /* ⚠ TOLERANCE, NOT 0. Welding at exactly 0 keeps every UV-seam duplicate
     apart and the simplify pass then has nothing to collapse across. */
  weld({ tolerance: 0.0001 }),
);
console.log('weld   : ' + doc.getRoot().listMeshes()[0].listPrimitives()[0].getAttribute('POSITION').getCount().toLocaleString() + ' verts');

/* 🔴 ONE PASS DOES NOT REACH THE BUDGET, and the reason is worth knowing
   before you retune it. MeshoptSimplifier stops as soon as the next collapse
   would exceed `error` — it honours the error bound over the ratio — so a
   generator shell full of hard creases lands far short. Asked for 9,000 from
   2,958,914 at error 0.02, it returned 91,326 and called it done.
   So: iterate, widening the error each round, and stop the moment a round
   stops making progress. That converges on the budget without ever asking for
   a single catastrophic collapse, and it terminates on its own for a mesh
   that genuinely cannot go lower. */
let after = countTris(doc);
for (let pass = 0; pass < 6 && after > TARGET; pass++) {
  const err = 0.02 * Math.pow(3, pass);      // 0.02, 0.06, 0.18, 0.54, 1.62, 4.86
  const prev = after;
  await doc.transform(
    simplify({ simplifier: MeshoptSimplifier, ratio: Math.min(1, TARGET / Math.max(1, after)), error: err, lockBorder: false }),
  );
  after = countTris(doc);
  console.log('  pass ' + (pass + 1) + ' (error ' + err.toFixed(2) + '): ' +
    prev.toLocaleString() + ' → ' + after.toLocaleString());
  if (after >= prev * 0.98) break;           // no meaningful progress; stop asking
}

/* 🔴 THE SLOPPY FALLBACK — what actually gets a generator shell to a budget.
   MeshoptSimplifier.simplify() PRESERVES TOPOLOGY: it will not weld separate
   connected components together, and a Meshy export is full of them (interior
   shells, floating trim, parts that never touch). Measured on the Fuel Titan
   it stalled dead at 53,002 triangles no matter how wide the error was opened
   — four passes from 0.02 to 0.54 moved it 91,326 → 53,002 and then stopped.
   Dropping tangents first did not change that number by one triangle, which
   is what proved topology and not attribute splitting was the wall.

   simplifySloppy() ignores topology entirely. It is the wrong tool for a
   hero asset and exactly the right one for a vehicle seen at forty pixels on
   a lot card, so it runs ONLY when the careful path has already given up.
   ⚠ compactMesh() afterwards is not optional: sloppy leaves the vertex buffer
     at full size with most of it unreferenced, so without the remap the
     triangle count drops and the FILE DOES NOT. */
/* 🔴 OFF BY DEFAULT, AND IT SHIPPED WRONG ONCE BEFORE IT WAS. simplifySloppy()
   hits any triangle budget you name because it ignores topology — and on a
   vehicle it ignores the silhouette with it. The Fuel Titan came out of it at
   8,768 triangles, correct bounding box, correct proportions, textures intact,
   and shaped like a TABLE: a flat slab on four posts where a tank and a cab
   used to be. Every number a script can check was fine, which is exactly why
   it reached the yard.
   So it is opt-in now. A prop keeps its shape at whatever count the
   topology-preserving pass reaches, and a bigger file is the correct price —
   the model is the thing the player is looking at. Pass `sloppy` as the last
   argument only for something distant enough that its outline does not matter. */
if (SLOPPY && after > TARGET * 1.5) {
  try {
    const prim = doc.getRoot().listMeshes()[0].listPrimitives()[0];
    const posAcc = prim.getAttribute('POSITION');
    const idxAcc = prim.getIndices();
    const positions = posAcc.getArray();
    const indices = new Uint32Array(idxAcc.getArray());
    const vertCount = posAcc.getCount();
    const targetIdx = Math.max(3, Math.floor(TARGET * 3));

    /* ⚠ ARG ORDER: (indices, positions, POSITION STRIDE IN FLOATS, vertexLock,
       targetIndexCount, targetError). Passing the vertex count where the
       stride belongs fails an internal assert with no useful message. */
    const dst = MeshoptSimplifier.simplifySloppy(indices, positions, 3, null, targetIdx, 0.05);
    const newIdx = Array.isArray(dst) ? dst[0] : dst;
    if (newIdx && newIdx.length && newIdx.length < indices.length) {
      idxAcc.setArray(new Uint32Array(newIdx));
      // Remap: drop the vertices the sloppy pass stopped referencing.
      const remap = MeshoptSimplifier.compactMesh(idxAcc.getArray());
      const uniq = Array.isArray(remap) ? remap[0] : remap;
      const newCount = Array.isArray(remap) ? remap[1] : null;
      if (uniq && newCount) {
        for (const sem of prim.listSemantics()) {
          const acc = prim.getAttribute(sem);
          const el = acc.getElementSize();
          const src = acc.getArray();
          const out = new src.constructor(newCount * el);
          for (let i = 0; i < vertCount; i++) {
            const to = uniq[i];
            if (to === 0xffffffff || to >= newCount) continue;
            for (let k = 0; k < el; k++) out[to * el + k] = src[i * el + k];
          }
          acc.setArray(out);
        }
        const ix = idxAcc.getArray();
        for (let i = 0; i < ix.length; i++) ix[i] = uniq[ix[i]];
        idxAcc.setArray(ix);
      }
      const sloppyTris = countTris(doc);
      console.log('  sloppy (topology ignored): ' + after.toLocaleString() + ' → ' + sloppyTris.toLocaleString());
      after = sloppyTris;
    }
  } catch (e) {
    console.warn('⚠ sloppy pass skipped: ' + (e && e.message));
  }
}

await doc.transform(
  dedup(),
  prune({ keepLeaves: false }),
  /* Vertex data is the file now that the sheets are WebP: position, normal and
     UV as float32 is ~32 bytes a vertex. Quantizing costs precision nobody can
     see at the size these render and roughly halves what is left. */
  quantize({ quantizePosition: 14, quantizeNormal: 10, quantizeTexcoord: 12 }),
);

after = countTris(doc);
console.log('simplify: ' + before.toLocaleString() + ' → ' + after.toLocaleString() +
  ' tris  (' + (100 - Math.round((after / Math.max(1, before)) * 100)) + '% off, asked for ' +
  TARGET.toLocaleString() + ')');

fs.mkdirSync(path.dirname(OUT), { recursive: true });
await io.write(OUT, doc);

/* 🖼 Textures, in their own process. See the note at the top. */
try {
  execFileSync(process.execPath, ['tools/glbtexture.mjs', OUT, String(MAXPX), String(QUALITY)],
    { stdio: 'inherit' });
} catch (e) {
  console.warn('⚠ texture pass failed — the model is written but still carries its original sheets');
}

const outBytes = fs.statSync(OUT).size;
console.log('file   : ' + (inBytes / 1048576).toFixed(2) + ' MB → ' + (outBytes / 1048576).toFixed(2) +
  ' MB  (' + (100 - Math.round((outBytes / inBytes) * 100)) + '% smaller)');
console.log('wrote  : ' + OUT);
