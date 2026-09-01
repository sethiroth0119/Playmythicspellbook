/* ══════════════════════════════════════════════════════════════════════════
   GLB REPACKER — one character file, two clips, a sane texture.
   ──────────────────────────────────────────────────────────────────────────
   The four uploads were 30 MB together and 95% of every byte was a single
   oversized PNG. Each walk/run pair is otherwise the SAME mesh and the SAME
   24-joint skeleton, differing only in its animation clip — so shipping both
   per character would download the same character twice to get a second clip.

   This merges the run clip into the walk file and recompresses the texture,
   producing one GLB per character. Run:
     node _glbpack.mjs <walk.glb> <run.glb> <out.glb> [maxTexture]
   then ALWAYS validate the result:
     node _glbcheck.mjs <out.glb>

   🔴 THE TEXTURE IS JPEG, NOT WEBP, AND THAT IS NOT A PREFERENCE. Core glTF
   permits exactly two image mime types: image/jpeg and image/png. WebP is
   legal only behind EXT_texture_webp, which must be declared in
   extensionsUsed AND carried per-texture — and when it is only "used" rather
   than "required", the texture's plain `source` still has to point at a core
   fallback, so a spec-clean WebP file ships BOTH encodings and is bigger than
   the JPEG it was trying to beat. The first cut of this script wrote a bare
   image/webp mimeType with no extension at all: three.js would very likely
   have rendered it (it blobs by mime type and browsers decode WebP), which is
   the worst kind of wrong — working in the one place it was tested and
   invalid everywhere else. _glbcheck.mjs now fails the build on it.

   ⚠ It repacks the binary chunk rather than appending to it. Copying each
     bufferView verbatim to a fresh 4-byte-aligned offset preserves byteStride
     and accessor.byteOffset semantics, and drops whatever the old buffer was
     padding.
   ══════════════════════════════════════════════════════════════════════════ */
import { readFileSync, writeFileSync } from 'fs';
import sharp from 'sharp';

const [walkPath, runPath, outPath, maxTexArg] = process.argv.slice(2);
const MAX_TEX = parseInt(maxTexArg, 10) || 1024;

function readGlb(p) {
  const buf = readFileSync(p);
  if (buf.readUInt32LE(0) !== 0x46546c67) throw new Error('not a glb: ' + p);
  const total = buf.readUInt32LE(8);
  let off = 12, json = null, bin = null;
  while (off < total) {
    const len = buf.readUInt32LE(off), type = buf.readUInt32LE(off + 4);
    const body = buf.slice(off + 8, off + 8 + len);
    if (type === 0x4e4f534a) json = JSON.parse(body.toString('utf8'));
    if (type === 0x004e4942) bin = body;
    off += 8 + len;
  }
  return { json, bin };
}

const walk = readGlb(walkPath);
const run = readGlb(runPath);

// The merge is only sound if both files describe the same skeleton in the same
// order — animation channels address nodes by INDEX.
const wNames = walk.json.nodes.map((n) => n.name || '');
const rNames = run.json.nodes.map((n) => n.name || '');
if (wNames.length !== rNames.length || wNames.some((n, i) => n !== rNames[i])) {
  throw new Error('node lists differ — channel targets would be remapped blindly');
}

const out = JSON.parse(JSON.stringify(walk.json));

// ── pull the run clip in ─────────────────────────────────────────────────
const runClip = run.json.animations[0];
const viewMap = new Map();
const accMap = new Map();
const extraViews = [];

function importView(idx) {
  if (viewMap.has(idx)) return viewMap.get(idx);
  const v = run.json.bufferViews[idx];
  const ni = out.bufferViews.length + extraViews.length;
  extraViews.push({ view: Object.assign({}, v) });
  viewMap.set(idx, ni);
  return ni;
}
function importAccessor(idx) {
  if (accMap.has(idx)) return accMap.get(idx);
  const a = Object.assign({}, run.json.accessors[idx]);
  if (a.bufferView != null) a.bufferView = importView(a.bufferView);
  const ni = out.accessors.length;
  out.accessors.push(a);
  accMap.set(idx, ni);
  return ni;
}

const newClip = {
  name: runClip.name || 'running',
  samplers: runClip.samplers.map((s) => ({
    input: importAccessor(s.input),
    output: importAccessor(s.output),
    interpolation: s.interpolation || 'LINEAR',
  })),
  channels: runClip.channels.map((c) => ({
    sampler: c.sampler,
    target: { node: c.target.node, path: c.target.path },
  })),
};
out.bufferViews = out.bufferViews.concat(extraViews.map((e) => e.view));
out.animations = [Object.assign({}, walk.json.animations[0]), newClip];

// ── recompress the texture ───────────────────────────────────────────────
const img = out.images[0];
const texView = out.bufferViews[img.bufferView];
const texBytes = walk.bin.slice(texView.byteOffset || 0, (texView.byteOffset || 0) + texView.byteLength);
const meta = await sharp(texBytes).metadata();

/* Alpha decides the format, because JPEG has none — but the question is
   whether the alpha is USED, not whether the channel exists. These exports
   carry a full alpha channel that is 255 everywhere against an OPAQUE
   material: entirely dead weight, and honouring it forced PNG and roughly
   tripled both files for nothing.
   So: PNG only if the channel actually varies AND the material is not OPAQUE.
   Both halves matter — a varying channel on an OPAQUE material is still never
   sampled, and an all-255 channel on a BLEND material still cuts out nothing.
   ⚠ It is never silently flattened when it IS meaningful: a cut-out texture
     composited onto black grows a black halo at every edge. */
const stats = await sharp(texBytes).stats().catch(() => null);
const alphaVaries = !!(stats && stats.channels[3] && stats.channels[3].min < 255);
const mat0 = (out.materials || [])[0] || {};
const blends = (mat0.alphaMode || 'OPAQUE') !== 'OPAQUE';
const hasAlpha = !!meta.hasAlpha && alphaVaries && blends;
if (meta.hasAlpha && !hasAlpha) {
  console.log('  alpha channel present but unused (min ' +
    (stats && stats.channels[3] ? stats.channels[3].min : '?') + ', alphaMode ' +
    (mat0.alphaMode || 'OPAQUE') + ') — dropping it');
}
const pipeline = sharp(texBytes).resize({
  width: Math.min(meta.width, MAX_TEX),
  height: Math.min(meta.height, MAX_TEX),
  fit: 'inside',
});
const newTex = hasAlpha
  ? await pipeline.png({ compressionLevel: 9, palette: true }).toBuffer()
  : await pipeline.jpeg({ quality: 88, mozjpeg: true }).toBuffer();
img.mimeType = hasAlpha ? 'image/png' : 'image/jpeg';
console.log('  texture ' + meta.width + 'x' + meta.height + ' ' + meta.format +
  (hasAlpha ? ' +alpha' : '') + ' ' + (texBytes.length / 1048576).toFixed(2) + ' MB  ->  ' +
  img.mimeType.replace('image/', '') + ' ' + Math.min(meta.width, MAX_TEX) + 'px ' +
  (newTex.length / 1024).toFixed(0) + ' KB');

// ── repack the binary ────────────────────────────────────────────────────
const chunks = [];
let cursor = 0;
out.bufferViews.forEach((v, i) => {
  const fromRun = i >= walk.json.bufferViews.length;
  let bytes;
  if (i === img.bufferView) bytes = newTex;
  else if (fromRun) bytes = run.bin.slice(v.byteOffset || 0, (v.byteOffset || 0) + v.byteLength);
  else bytes = walk.bin.slice(v.byteOffset || 0, (v.byteOffset || 0) + v.byteLength);
  const pad = (4 - (cursor % 4)) % 4;
  if (pad) { chunks.push(Buffer.alloc(pad)); cursor += pad; }
  v.byteOffset = cursor;
  v.byteLength = bytes.length;
  v.buffer = 0;
  chunks.push(bytes);
  cursor += bytes.length;
});
let bin = Buffer.concat(chunks);
if (bin.length % 4) bin = Buffer.concat([bin, Buffer.alloc(4 - (bin.length % 4))]);
out.buffers = [{ byteLength: bin.length }];

let jsonStr = JSON.stringify(out);
while (jsonStr.length % 4) jsonStr += ' ';
const jsonBuf = Buffer.from(jsonStr, 'utf8');

const header = Buffer.alloc(12);
header.writeUInt32LE(0x46546c67, 0);
header.writeUInt32LE(2, 4);
header.writeUInt32LE(12 + 8 + jsonBuf.length + 8 + bin.length, 8);
const jHead = Buffer.alloc(8);
jHead.writeUInt32LE(jsonBuf.length, 0); jHead.writeUInt32LE(0x4e4f534a, 4);
const bHead = Buffer.alloc(8);
bHead.writeUInt32LE(bin.length, 0); bHead.writeUInt32LE(0x004e4942, 4);

writeFileSync(outPath, Buffer.concat([header, jHead, jsonBuf, bHead, bin]));
const sz = 12 + 8 + jsonBuf.length + 8 + bin.length;
console.log('  ' + outPath + '  ' + (sz / 1048576).toFixed(2) + ' MB, clips: ' +
  out.animations.map((a) => a.name).join(' + '));
