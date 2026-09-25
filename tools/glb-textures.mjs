/* Resize + re-encode every texture in a .glb, in place. A separate PROCESS
   on purpose — see tools/build-intake-desk.mjs for why.
   ─────────────────────────────────────────────────────────────────────────
   Usage: node tools/glb-textures.mjs <file.glb> [size=1024] [quality=82]
   Exit 0 and prints one JSON line on success:
     {"ok":true,"textures":"webp-1024","encoded":3,"bytes":N}
   Exit 1 (file untouched) on any failure.

   ⚠ EVERY texture or NONE. A material with one texture converted and two not
     is worse than the originals, so the file is only rewritten once all of
     them encoded.
   ⚠ EXT_texture_webp IS DECLARED REQUIRED. A loader without WebP support
     would otherwise render the model untextured and silent; declaring it
     required makes that loader fail loudly instead. Every GLTFLoader this
     game ships (three r128, /src/biolab's vendored copy) supports it.
   ⚠ toColourspace('srgb') is deliberate: it is the exact call measured to
     succeed on the desk's Meshy JPEGs on 2026-09-04, so it stays. */
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTTextureWebP } from '@gltf-transform/extensions';
import sharp from 'sharp';
import fs from 'node:fs';

const [file, sizeArg, qualityArg] = process.argv.slice(2);
if (!file || !fs.existsSync(file)) { console.error('usage: node tools/glb-textures.mjs <file.glb> [size] [quality]'); process.exit(1); }
const SIZE = Math.max(64, parseInt(sizeArg || '1024', 10) || 1024);
const QUALITY = Math.max(1, Math.min(100, parseInt(qualityArg || '82', 10) || 82));

try {
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
  const doc = await io.read(file);
  const list = doc.getRoot().listTextures().filter((t) => t.getImage());
  const done = [];
  for (const tex of list) {
    const out = await sharp(Buffer.from(tex.getImage()))
      .toColourspace('srgb')
      .resize(SIZE, SIZE, { fit: 'inside', withoutEnlargement: true })
      .webp({ quality: QUALITY })
      .toBuffer();
    done.push({ tex, out });
  }
  if (!done.length) { console.log(JSON.stringify({ ok: false, why: 'no textures' })); process.exit(1); }
  doc.createExtension(EXTTextureWebP).setRequired(true);
  for (const { tex, out } of done) tex.setImage(new Uint8Array(out)).setMimeType('image/webp');
  await io.write(file, doc);
  console.log(JSON.stringify({ ok: true, textures: 'webp-' + SIZE, encoded: done.length, bytes: fs.statSync(file).size }));
} catch (e) {
  console.log(JSON.stringify({ ok: false, why: String(e && e.message || e).split('\n')[0] }));
  process.exit(1);
}
