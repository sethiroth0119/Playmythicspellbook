/* Decimate + compress the forklift so it can actually ship to a browser. */
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { simplify, weld, dedup, prune, resample, textureCompress, flatten, join } from '@gltf-transform/functions';
import { MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';
import fs from 'node:fs';

const SRC = 'C:/Users/sethi/Downloads/Meshy_AI_HidnEx_Forklift_0901191453_texture (1).glb';
const OUT = 'public/assets/models/forklift.glb';

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(SRC);
await MeshoptSimplifier.ready;

const tris = () => doc.getRoot().listMeshes()
  .flatMap((m) => m.listPrimitives())
  .reduce((s, p) => s + (p.getIndices() ? p.getIndices().getCount() / 3 : 0), 0);
console.log('before', Math.round(tris()).toLocaleString(), 'triangles');

await doc.transform(
  dedup(),
  flatten(),
  join(),
  weld({ tolerance: 0.0001 }),
  /* 🔴 0.6% OF THREE MILLION IS ~18k, which is a generous budget for a prop the
     player sees from a metre away in a cockpit view. The error bound is what
     stops it collapsing: simplify stops early rather than exceed it. */
  simplify({ simplifier: MeshoptSimplifier, ratio: 0.006, error: 0.002 }),
  prune(),
  resample(),
  textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [1024, 1024], quality: 82 }),
);
console.log('after ', Math.round(tris()).toLocaleString(), 'triangles');

fs.mkdirSync('public/assets/models', { recursive: true });
await io.write(OUT, doc);
console.log(OUT, (fs.statSync(OUT).size / 1048576).toFixed(2) + ' MB');
