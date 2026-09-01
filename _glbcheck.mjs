/* Structural validation for a .glb — the checks a repacker can silently break.
   Every bufferView must fit its buffer, every accessor must fit its bufferView,
   every index must be in range, and every animation channel must address a real
   node and a real sampler. Run: node _glbcheck.mjs <file.glb ...> */
import { readFileSync } from 'fs';

const COMP = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 };
const NUM = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT2: 4, MAT3: 9, MAT4: 16 };

let bad = 0;
for (const f of process.argv.slice(2)) {
  const buf = readFileSync(f);
  const name = f.split('/').pop();
  const errs = [];
  const total = buf.readUInt32LE(8);
  if (buf.readUInt32LE(0) !== 0x46546c67) { console.log('FAIL ' + name + ' bad magic'); bad++; continue; }
  if (total !== buf.length) errs.push('header length ' + total + ' != file ' + buf.length);

  let off = 12, json = null, bin = null;
  while (off < total) {
    const len = buf.readUInt32LE(off), type = buf.readUInt32LE(off + 4);
    if (len % 4) errs.push('chunk at ' + off + ' length ' + len + ' not 4-aligned');
    const body = buf.slice(off + 8, off + 8 + len);
    if (type === 0x4e4f534a) json = JSON.parse(body.toString('utf8'));
    if (type === 0x004e4942) bin = body;
    off += 8 + len;
  }
  if (!json) { console.log('FAIL ' + name + ' no JSON chunk'); bad++; continue; }

  const buffers = json.buffers || [];
  const views = json.bufferViews || [];
  const accs = json.accessors || [];

  if (buffers.length && bin && buffers[0].byteLength !== bin.length) {
    errs.push('buffer0.byteLength ' + buffers[0].byteLength + ' != BIN chunk ' + bin.length);
  }

  views.forEach((v, i) => {
    const b = buffers[v.buffer || 0];
    if (!b) { errs.push('bufferView ' + i + ' -> missing buffer'); return; }
    const end = (v.byteOffset || 0) + v.byteLength;
    if (end > b.byteLength) errs.push('bufferView ' + i + ' ends at ' + end + ' past buffer ' + b.byteLength);
    if ((v.byteOffset || 0) % 4) errs.push('bufferView ' + i + ' offset not 4-aligned');
  });

  accs.forEach((a, i) => {
    if (a.bufferView == null) return;
    const v = views[a.bufferView];
    if (!v) { errs.push('accessor ' + i + ' -> missing bufferView ' + a.bufferView); return; }
    const elem = (COMP[a.componentType] || 0) * (NUM[a.type] || 0);
    if (!elem) { errs.push('accessor ' + i + ' bad type'); return; }
    const stride = v.byteStride || elem;
    const need = (a.byteOffset || 0) + stride * (a.count - 1) + elem;
    if (need > v.byteLength) {
      errs.push('accessor ' + i + ' needs ' + need + ' bytes, bufferView ' + a.bufferView + ' has ' + v.byteLength);
    }
  });

  (json.animations || []).forEach((an, ai) => {
    an.samplers.forEach((s, si) => {
      if (!accs[s.input]) errs.push('anim ' + ai + ' sampler ' + si + ' bad input accessor ' + s.input);
      if (!accs[s.output]) errs.push('anim ' + ai + ' sampler ' + si + ' bad output accessor ' + s.output);
      const i = accs[s.input], o = accs[s.output];
      if (i && o && o.count % i.count) {
        errs.push('anim ' + ai + ' sampler ' + si + ' output ' + o.count + ' not a multiple of input ' + i.count);
      }
    });
    an.channels.forEach((c, ci) => {
      if (!an.samplers[c.sampler]) errs.push('anim ' + ai + ' channel ' + ci + ' bad sampler');
      if (c.target.node == null || !json.nodes[c.target.node]) errs.push('anim ' + ai + ' channel ' + ci + ' bad node');
    });
  });

  (json.skins || []).forEach((sk, i) => {
    if (sk.inverseBindMatrices != null && !accs[sk.inverseBindMatrices]) errs.push('skin ' + i + ' bad IBM accessor');
    sk.joints.forEach((j) => { if (!json.nodes[j]) errs.push('skin ' + i + ' bad joint ' + j); });
  });

  (json.images || []).forEach((im, i) => {
    if (im.bufferView != null && !views[im.bufferView]) errs.push('image ' + i + ' bad bufferView');
    // glTF core allows only jpeg/png; anything else needs an extension declared.
    if (im.mimeType && !/^image\/(jpeg|png)$/.test(im.mimeType)) {
      const ext = (json.extensionsUsed || []);
      errs.push('image ' + i + ' mimeType ' + im.mimeType + ' is outside core glTF' +
        (ext.length ? ' (extensionsUsed: ' + ext.join(',') + ')' : ' and no extension is declared'));
    }
  });

  if (errs.length) { bad++; console.log('FAIL ' + name); for (const e of errs) console.log('   · ' + e); }
  else console.log('ok   ' + name + '  (' + views.length + ' views, ' + accs.length + ' accessors, ' +
    (json.animations || []).length + ' clips)');
}
process.exit(bad ? 1 : 0);
