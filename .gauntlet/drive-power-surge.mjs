/* ══════════════════════════════════════════════════════════════════════════
   ⚡ DRIVE-POWER-SURGE — is the yellow surge actually MOVING?

   "when they are connected the right way have a yellow surge just like the
    pipes surge blue"

   Every other claim in this round is provable from the model. This one is not:
   a dash pattern with an animated offset either moves on screen or it does not,
   and the only honest evidence is TWO FRAMES THAT DIFFER.

   🔴 SO IT IS AN A/B WITH A CONTROL, and the control is the whole test. Two
      captures of the same overlay canvas a moment apart:
        · surge ON  → the two frames must DIFFER (the dashes moved)
        · surge OFF → the two frames must be IDENTICAL (nothing else on this
          canvas animates, so a difference there would mean the "movement" I am
          measuring is something else entirely — a repaint, a terrain field, a
          cursor)
      Without the second half, "the pixels changed" proves nothing about the
      feature. CLAUDE.md's own A/B note is about exactly this failure.

   ⚠ IT READS THE 2D CANVAS, NOT THE WEBGL FRAME. overlay.js paints into a plain
     <canvas> that becomes a CanvasTexture, so `toDataURL()` is the honest read
     and none of the preserveDrawingBuffer/readPixels hazards apply.

   Run:  node .gauntlet/drive-power-surge.mjs
   ══════════════════════════════════════════════════════════════════════════ */
import { chromium } from 'playwright';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';

const ROOT = path.resolve(process.cwd(), 'public');
const M = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.txt': 'text/plain', '.glb': 'model/gltf-binary' };
const P = 8600 + (process.pid % 40);
const srv = http.createServer((q, r) => {
  let p = decodeURIComponent(q.url.split('?')[0]); if (p.endsWith('/')) p += 'index.html';
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end('nf'); }
  r.writeHead(200, { 'Content-Type': M[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(r);
});
await new Promise(r => srv.listen(P, '127.0.0.1', r));

const b = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const pg = await b.newPage({ viewport: { width: 1200, height: 860 } });
const errs = []; pg.on('pageerror', e => errs.push(String(e).slice(0, 180)));
await pg.route('**/*', (r) => {
  const u = r.request().url();
  if (u.includes('127.0.0.1') || u.includes('localhost') || u.includes('cdn.jsdelivr.net')) return r.continue();
  return r.abort();
});
await pg.goto('http://127.0.0.1:' + P + '/node-city/index.html', { waitUntil: 'load', timeout: 120000 });
await pg.waitForFunction('!!(window.__nc && window.__nc.game && window.MythicPower)', null, { timeout: 180000 }).catch(() => {});
await pg.waitForTimeout(9000);

/* Paint the overlay directly through the module's own sync(), with a state that
   HAS flow. Driving the real UI to a solved, flowing grid would need a funded
   city and a hand-drawn line; what is under test is the painter, and this is
   the painter's own entry point with the host's own shapes. */
const shot = async () => pg.evaluate(async () => {
  const O = window.__pwOverlay;
  const seg = [];
  for (let x = 0; x < 8; x++) seg.push({ x, z: 3, hv: false, choke: false, flow: 2 });
  const state = { topo: { seg, unserved: [], transformers: [], chokes: [] },
                  byPlant: [], load: 4, capacity: 10, store: { cap: 0 } };
  O.sync(state, { lv: true }, { loads: [], terrainSig: 'x' });
  await new Promise(r => setTimeout(r, 30));
  return O.__canvasData();
});

const out = await pg.evaluate(() => ({ exposed: !!window.__pwOverlay }));
if (!out.exposed) {
  console.log('❌ FAIL: the overlay is not exposed as window.__pwOverlay — nothing to photograph.');
  await b.close(); srv.close(); process.exit(1);
}

// ── surge ON: two frames a moment apart must differ ────────────────────────
await pg.evaluate(() => { window.__pwTuning.overlay.surge.on = true; });
const a1 = await shot();
await pg.waitForTimeout(450);
const a2 = await shot();

// ── CONTROL — surge OFF: the same two captures must be identical ───────────
await pg.evaluate(() => { window.__pwTuning.overlay.surge.on = false; });
const b1 = await shot();
await pg.waitForTimeout(450);
const b2 = await shot();

const moved = a1 !== a2;
const still = b1 === b2;
const drawn = a1 && a1.length > 512;

console.log(JSON.stringify({ frameBytes: a1 ? a1.length : 0, surgeOnFramesDiffer: moved, surgeOffFramesIdentical: still }, null, 2));
const bad = [];
if (!drawn) bad.push('the overlay painted nothing at all');
if (!moved) bad.push('SURGE ON: the two frames are identical — nothing is moving');
if (!still) bad.push('CONTROL: SURGE OFF and the frames still differ — the movement measured above is not the surge');
if (errs.length) console.log('page errors:', errs.slice(0, 3));
console.log(bad.length ? '\n❌ FAIL: ' + bad.join(' | ')
                       : '\n✅ PASS — the surge moves with it on, and the picture is dead still with it off.');
await b.close(); srv.close();
process.exit(bad.length ? 1 : 0);
