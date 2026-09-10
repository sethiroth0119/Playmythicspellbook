// tools/media-put.mjs — upload one or more large files to the R2 bucket that
// worker.js serves at /media/<key>.
//
//   node tools/media-put.mjs "public/assets/3d models/Battletable.glb" [more files…]
//
// WHY THIS EXISTS. Cloudflare Workers Assets caps every file at 25 MiB and one
// oversized file aborts the ENTIRE deploy (public/.assetsignore lists the ones
// that already did). Those files still need to reach players, so they go to R2
// instead and the game references them as /media/<key> — same origin, so no
// CORS, and the service worker's cache-first rule can be extended to it.
//
// KEY SHAPE. The key is the path under public/assets/ with spaces → '-' and
// folded to what a URL tolerates:  "3d models/Vendor market cash register.glb"
// → "3d-models/Vendor-market-cash-register.glb". Keys are never overwritten
// in place: the Worker serves /media/* as immutable for a year, so a changed
// file gets a new name (bump a version suffix), not a re-upload of the old key.
//
// Needs `wrangler login` (or CLOUDFLARE_API_TOKEN) — same auth as deploy.
import { execFileSync } from 'node:child_process';
import { statSync } from 'node:fs';
import path from 'node:path';

const BUCKET = process.env.MEDIA_BUCKET || 'mythic-media';
const files = process.argv.slice(2);
if (!files.length) {
  console.error('usage: node tools/media-put.mjs <file> [file…]');
  process.exit(2);
}

export function mediaKey(file) {
  const abs = path.resolve(file);
  const assetsRoot = path.resolve('public/assets');
  const rel = abs.startsWith(assetsRoot + path.sep) ? path.relative(assetsRoot, abs) : path.basename(abs);
  return rel.split(path.sep).map(seg => seg.trim().replace(/\s+/g, '-')).join('/');
}

let failed = 0;
for (const f of files) {
  let size;
  try { size = statSync(f).size; } catch (e) { console.error(`✗ ${f}: not found`); failed++; continue; }
  const key = mediaKey(f);
  const mb = (size / 1048576).toFixed(1);
  process.stdout.write(`↑ ${f}  (${mb} MiB)  →  /media/${key} … `);
  try {
    // --remote: put into the real bucket, not wrangler's local dev simulation.
    execFileSync('npx', ['wrangler', 'r2', 'object', 'put', `${BUCKET}/${key}`, '--file', f, '--remote'],
      { stdio: ['ignore', 'ignore', 'inherit'], shell: process.platform === 'win32' });
    console.log('ok');
  } catch (e) {
    console.log('FAILED');
    failed++;
  }
}
if (failed) {
  console.error(`\n${failed} upload(s) failed. Is the bucket "${BUCKET}" created and wrangler logged in?`);
  process.exit(1);
}
console.log(`\n✅ done. Reference files in-game as /media/<key> (see keys above).`);
