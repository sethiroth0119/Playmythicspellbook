/* 🖼 AVIF SIBLING GENERATOR
   ============================================================================
   Run:  node tools/avif-siblings.mjs [--quality 55] [--concurrency 6] [--dry]

   WHAT THIS IS FOR.
   Measured on this repo's own art: 2,031 images under public/assets totalling
   2.86 GB. Re-encoding them losslessly makes them BIGGER (they are already
   optimally deflated); palette-quantising to 256 colours saves 72% but visibly
   bands painterly card art. The only real win is a format change, and AVIF q55
   takes the same bytes to roughly a twentieth.

   WHY SIBLINGS AND NOT A RENAME.
   A rename means touching ~650 asset-URL construction sites across index.html
   and twelve sub-apps — the migration brief's Phase 1, and the largest
   mechanical task in the whole plan. Instead each `x.png` gains `x.png.avif`
   and the worker serves the sibling ONLY to clients that advertise
   `Accept: image/avif` (see the content-negotiation block at the end of
   worker.js). Every existing <img>, CSS url() and new Image().src keeps
   working untouched.

   ⚠ REVERSIBLE BY DELETION. `del /s *.avif` under public/assets and the site
   silently returns to serving the originals. Nothing else references them.

   ⚠ NEVER SHIPS A BIGGER FILE. Small or already-efficient images sometimes
   encode LARGER as AVIF. Those siblings are discarded, so a negotiated request
   can only ever get fewer bytes than the original, never more.

   ⚠ RESUMABLE. A sibling newer than its source is skipped, so an interrupted
   run continues where it stopped and a re-run after adding art is cheap.
   ============================================================================ */
import sharp from 'sharp';
import { readdirSync, statSync, writeFileSync, existsSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';

const arg = (k, d) => {
  const i = process.argv.indexOf('--' + k);
  return i >= 0 ? (process.argv[i + 1] ?? true) : d;
};
const QUALITY = Number(arg('quality', 55));
const CONC = Number(arg('concurrency', 6));
const DRY = process.argv.includes('--dry');
const ROOT = 'public/assets';

const files = [];
(function walk(d) {
  let e; try { e = readdirSync(d, { withFileTypes: true }); } catch { return; }
  for (const x of e) {
    const p = join(d, x.name);
    if (x.isDirectory()) walk(p);
    else if (/\.(png|jpe?g)$/i.test(x.name)) files.push(p);
  }
})(ROOT);

files.sort((a, b) => statSync(b).size - statSync(a).size);   // biggest first: the win lands early

let done = 0, written = 0, skipped = 0, rejected = 0, failed = 0;
let srcBytes = 0, avifBytes = 0, startedAt = Date.now();

async function one(src) {
  const out = src + '.avif';
  let sst; try { sst = statSync(src); } catch { failed++; return; }
  // resumable: a sibling newer than its source is already current
  if (existsSync(out)) {
    try { if (statSync(out).mtimeMs >= sst.mtimeMs) { skipped++; return; } } catch {}
  }
  if (DRY) { skipped++; return; }
  try {
    const buf = await sharp(src, { failOn: 'none' })
      .avif({ quality: QUALITY, effort: 4 })
      .toBuffer();
    // never ship a sibling that is not actually smaller
    if (buf.length >= sst.size) {
      rejected++;
      try { if (existsSync(out)) unlinkSync(out); } catch {}
      return;
    }
    writeFileSync(out, buf);
    written++; srcBytes += sst.size; avifBytes += buf.length;
  } catch (e) {
    failed++;
  }
}

console.log(`avif-siblings: ${files.length} images under ${ROOT}, q=${QUALITY}, concurrency=${CONC}${DRY ? ' [DRY RUN]' : ''}\n`);

let cursor = 0;
async function worker() {
  while (cursor < files.length) {
    const i = cursor++;
    await one(files[i]);
    done++;
    if (done % 100 === 0 || done === files.length) {
      const pct = (done / files.length * 100).toFixed(1);
      const secs = (Date.now() - startedAt) / 1000;
      const rate = done / Math.max(1, secs);
      const eta = Math.round((files.length - done) / Math.max(0.01, rate));
      const saved = (srcBytes - avifBytes) / 1073741824;
      console.log(`  ${String(done).padStart(5)}/${files.length}  ${pct.padStart(5)}%  written ${written} skipped ${skipped} rejected ${rejected} failed ${failed}  saved ${saved.toFixed(2)} GB  eta ${eta}s`);
    }
  }
}
await Promise.all(Array.from({ length: CONC }, worker));

const pct = srcBytes ? ((1 - avifBytes / srcBytes) * 100).toFixed(1) : '0';
console.log(`\n=== DONE in ${Math.round((Date.now() - startedAt) / 1000)}s ===`);
console.log(`  siblings written : ${written}`);
console.log(`  skipped (current): ${skipped}`);
console.log(`  rejected (bigger): ${rejected}`);
console.log(`  failed           : ${failed}`);
console.log(`  source bytes     : ${(srcBytes / 1073741824).toFixed(2)} GB`);
console.log(`  avif bytes       : ${(avifBytes / 1073741824).toFixed(3)} GB`);
console.log(`  SAVED ON THE WIRE: ${((srcBytes - avifBytes) / 1073741824).toFixed(2)} GB  (-${pct}%)`);
