/* ══════════════════════════════════════════════════════════════════════════
   WHAT IS LEFT IN THE NEAR BAND — an ablation, not an assertion.

   Round 2 flattened tableField() and the 8x8-block mottle in the bottom-left
   table box only fell from 9.2 to 8.5. Either the flattening did nothing, or
   the number was never mostly tableField. This answers that by ABLATING one
   pass at a time and re-measuring the same box:

     full      — the shipped frame
     noShadow  — boardShadow() stubbed out
     noGrade   — vista.grade() stubbed out (the post pass reads the frame back
                 at quarter scale and runs bloom + a multiply map over it, so
                 it can put large-scale structure on a perfectly flat fill)
     flat      — tableField()'s pool removed as well, i.e. the band is ONE
                 fillRect and nothing else. This is the floor: no table change
                 can measure below it.

   🔴 NOTHING ON DISK IS EDITED. The module is rewritten in the HTTP route, so
   there is never a moment where the repo holds a deliberately-broken file for
   precommit-scan to trip over — which is the exact hazard .gauntlet/
   precommit-scan.mjs exists for.
   ══════════════════════════════════════════════════════════════════════════ */
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../public/', import.meta.url));
const VISTA = path.join(ROOT, 'src/battle/stage/vista.js');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.glb': 'model/gltf-binary', '.txt': 'text/plain', '.webp': 'image/webp',
  '.avif': 'image/avif', '.gif': 'image/gif', '.mp3': 'audio/mpeg', '.woff2': 'font/woff2' };

/* the one box the round-2 gap is argued on, minus the board skirt above it and
   the card rail to its right — see _probe-mottle.mjs for why both are cut. */
const BOX = [0, 764, 200, 130];

const SRC = fs.readFileSync(VISTA, 'utf8');

/* ── ROUND 1's tableField(), restored by string surgery ──────────────────
   The only way to A/B a band against its own previous round with the SAME
   grade, the SAME shadow and the SAME box. It is written as edits to the
   shipped source rather than as a saved copy of the old file on purpose: a
   saved copy rots silently the moment anything else in vista.js moves, and
   this cannot — every anchor below is asserted present. */
const R1_POOL = `
    { const px = api.VIEW.cx, py = (hz + nz) * 0.5;
      const R = Math.max(W, H) * 0.90;
      const pool = gt.createRadialGradient(px, py, 0, px, py, R);
      pool.addColorStop(0, api.rgba(LIT, 1));
      pool.addColorStop(0.32, api.rgba(BASE, 0.95));
      pool.addColorStop(0.71, api.rgba(BASE, 0.50));
      pool.addColorStop(1, api.rgba(BASE, 0));
      gt.save();
      gt.translate(px, py); gt.scale(1, 0.70); gt.translate(-px, -py);
      gt.fillStyle = pool;
      gt.fillRect(-W, y0 - H, W * 3, H * 3);
      gt.restore(); }
    const lift = 0;`;
const R1_BLOBS = `
    { const rn = mulberry32(strHash((api.MAP.id || 'map') + '|table'));
      for (let i = 0; i < 11; i++) {
        const x = rn() * (W + 400) - 200;
        const y = y0 + rn() * hgt;
        const r = 120 + rn() * 300;
        const up = rn() < 0.42;
        softEll(api, gt, x, y, r, r * (0.84 + rn() * 0.18),
          up ? LIT : DEEP, (up ? 0.05 : 0.09) * (0.5 + rn() * 0.5));
      } }`;
const R1 = [
  ['gt.fillStyle = FELT;', 'gt.fillStyle = DEEP;'],
  ['const lift = lumaOf(LIT) - lumaOf(FELT);', R1_POOL],
  ['hgt, 1.5, 0.06);', 'hgt, 1.5, 0.21);'],
  ['hgt, 3.6, 0.045);', 'hgt, 3.6, 0.12);' + R1_BLOBS],
];
const NO_SHADOW = ['try { boardShadow(api, g, hz); } catch (e) { }', '/*ablated*/'];
const NO_GRADE = ['function grade(api) {', 'function grade(api) { if (1) return;'];
const NO_POOL = ['if (aMax > 0.004) {', 'if (0) {'];

/* every edit is a literal the file really contains; a miss is reported, never
   silently ignored, because an ablation that did not ablate reads as a null
   result and would be the wrong conclusion. */
const ARMS = {
  r1_full: R1,
  r2_full: [],
  r1_bandOnly: [...R1, NO_SHADOW, NO_GRADE],
  r2_bandOnly: [NO_SHADOW, NO_GRADE],
  r2_noShadow: [NO_SHADOW],
  r2_noGrade: [NO_GRADE],
  r2_floor: [NO_SHADOW, NO_GRADE, NO_POOL],
};

let ARM = 'full';
const srv = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p.endsWith('/')) p += 'index.html';
  const f = path.join(ROOT, p);
  if (!path.resolve(f).startsWith(path.resolve(ROOT))) { res.writeHead(403); return res.end(); }
  if (path.resolve(f) === path.resolve(VISTA)) {
    let s = SRC;
    for (const [a, b] of ARMS[ARM]) {
      if (!s.includes(a)) { res.writeHead(500); return res.end('ANCHOR MISS: ' + a); }
      s = s.replace(a, b);
    }
    res.writeHead(200, { 'content-type': 'text/javascript', 'cache-control': 'no-store' });
    return res.end(s);
  }
  fs.readFile(f, (e, b) => {
    if (e) { res.writeHead(404); return res.end('404 ' + p); }
    res.writeHead(200, { 'content-type': MIME[path.extname(f).toLowerCase()] || 'application/octet-stream' });
    res.end(b);
  });
});
await new Promise(r => srv.listen(0, '127.0.0.1', r));
const PORT = srv.address().port;

/* the gauntlet fixture's shape, reduced to what this box needs: the board must
   be there (it casts the shadow) but the tiles' own art does not reach here. */
const tiles = [];
for (let z = 0; z < 12; z++) for (let x = 0; x < 14; x++)
  tiles.push({ x, z, surf: 'grass', elev: (x === 7 && z < 4) ? 1.02 : 0 });

const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--disable-lcd-text'] });
const results = {};
for (const arm of Object.keys(ARMS)) {
  ARM = arm;
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  await page.goto('http://127.0.0.1:' + PORT + '/battle-board/index.html?ab=' + arm, { waitUntil: 'load', timeout: 45000 });
  await page.waitForTimeout(7000);
  await page.evaluate(m => window.postMessage({ type: 'board:map', map: m }, location.origin), { cols: 14, rows: 12, tiles });
  await page.waitForTimeout(2500);
  const r = await page.evaluate(B => {
    const cv = document.querySelector('canvas');
    const g = cv.getContext('2d', { willReadFrequently: true });
    const d = g.getImageData(B[0], B[1], B[2], B[3]).data;
    const W = B[2], H = B[3];
    const lum = new Float64Array(W * H);
    for (let i = 0, p = 0; p < W * H; i += 4, p++) lum[p] = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    const blocks = [];
    for (let by = 0; by + 8 <= H; by += 8) for (let bx = 0; bx + 8 <= W; bx += 8) {
      let s = 0; for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) s += lum[(by + y) * W + bx + x];
      blocks.push(s / 64);
    }
    const avg = a => a.reduce((x, y) => x + y, 0) / a.length;
    const m = avg(blocks);
    const sd = Math.sqrt(avg(blocks.map(x => (x - m) ** 2)));
    const s2 = blocks.slice().sort((a, b) => a - b);
    return { L: +m.toFixed(2), blockSd: +sd.toFixed(2), span: +(s2[s2.length - 1] - s2[0]).toFixed(2), canvas: !!cv };
  }, BOX);
  results[arm] = Object.assign(r, errs.length ? { errs: errs.slice(0, 2) } : {});
  await page.close();
}
console.log(JSON.stringify({ box: BOX, results }, null, 1));
await browser.close(); srv.close();
