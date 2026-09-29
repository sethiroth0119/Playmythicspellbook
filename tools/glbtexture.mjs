/* ══════════════════════════════════════════════════════════════════════════
   🖼 GLB TEXTURE SQUEEZER — resize + WebP every texture in a .glb, in place.

   🔴 THIS IS A SEPARATE PROCESS ON PURPOSE, AND THAT IS THE ENTIRE REASON THE
      FILE EXISTS. Importing `@gltf-transform/functions` anywhere in a process
      breaks sharp's encoder in this environment: the very next encode throws
      "colourspace: parameter space not set", with libvips reporting a `space`
      enum out of range. Two native addons, one leaving global state the other
      reads.

      Measured, on the Guardian of the Rig's 2048² sheet:
        core + extensions + sharp            → encodes, 8.10 MB → 0.27 MB
        …plus `import … from functions`      → throws, every time
        (it is the IMPORT, not calling anything — dropping textureCompress
         from the import list does not help.)

      So the merge pass imports functions and never touches sharp, and this
      pass imports sharp and never touches functions. Do not "simplify" the
      two back into one file; the texture step will silently start failing and
      an 8 MB character will ship.

   Usage: node tools/glbtexture.mjs <file.glb> [maxPx] [quality]
   ══════════════════════════════════════════════════════════════════════════ */

import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import sharp from 'sharp';
import fs from 'node:fs';

const FILE = process.argv[2];
const MAX = parseInt(process.argv[3], 10) || 1024;
const Q = parseInt(process.argv[4], 10) || 82;
if (!FILE) { console.error('usage: node tools/glbtexture.mjs <file.glb> [maxPx] [quality]'); process.exit(1); }

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(FILE);
const before = fs.statSync(FILE).size;
let changed = 0;

for (const tex of doc.getRoot().listTextures()) {
  const img = tex.getImage();
  if (!img) continue;
  const mime = tex.getMimeType() || '';
  if (/webp/i.test(mime)) { console.log('texture: already webp, left alone'); continue; }
  const wasBytes = img.byteLength;
  try {
    const out = await sharp(Buffer.from(img), { failOn: 'none' })
      .resize(MAX, MAX, { fit: 'inside', withoutEnlargement: true })
      .webp({ quality: Q })
      .toBuffer();
    tex.setImage(new Uint8Array(out));
    tex.setMimeType('image/webp');
    const nm = tex.getURI() || tex.getName() || 'texture';
    tex.setURI(String(nm).replace(/\.(png|jpe?g)$/i, '') + '.webp');
    console.log('texture: ' + (wasBytes / 1048576).toFixed(2) + ' MB → ' + (out.length / 1048576).toFixed(2) + ' MB  (webp ' + MAX + 'px q' + Q + ')');
    changed++;
  } catch (e) {
    console.warn('⚠ texture NOT compressed: ' + (e && e.message));
    console.warn('  the model still works; it will just be large.');
  }
}

if (changed) {
  await io.write(FILE, doc);
  const after = fs.statSync(FILE).size;
  console.log('file   : ' + (before / 1048576).toFixed(2) + ' MB → ' + (after / 1048576).toFixed(2) + ' MB');
} else {
  console.log('file   : unchanged');
}
