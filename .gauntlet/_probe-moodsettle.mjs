/* ══════════════════════════════════════════════════════════════════════════
   🔬 _probe-moodsettle — WHY THE PLACEMENT CHIP HAD TO STOP BEING A SNAPSHOT.

   Places one grocery next to three houses with the glyph layer OFF, then reads
   MythicPlotMood.all() at seven points over 4.5 s and prints the resident /
   business census at each, plus the per-plot reason at the end.

   WHAT IT MEASURED (the numbers quoted in /src/plotmood/overlay.js's
   refreshReaction header): the board does not settle in one step, it
   OSCILLATES for about a second while node-city's power pre-pass catches up —
   bad/bad at the pulse, meh/meh from +228 ms to +706 ms, bad/bad from +1203 ms
   on, every plot reading reason:'power'. A chip that photographs the table once
   at +150 ms and holds it for 3.6 s is therefore showing the player a face the
   board contradicts for most of the chip's life.
   ══════════════════════════════════════════════════════════════════════════ */
/* ══════════════════════════════════════════════════════════════════════════
   🙂 DRIVE-MOODPLACEREACT — the ONE thing the shipped mood feature did not do.

   THE MEASURED GAP. /src/plotmood/overlay.js creates its badge mesh with
   `mesh.visible = false`, and node-city's placement hook is gated on
   `MythicPlotIcons.visible()`. So with the layer off — which is how every
   player starts — placing a building produced NO FACE AT ALL. This drives the
   real seam (`__nc.place`, i.e. tryPlace) WITH THE LAYER OFF and asserts:

     1  the layer really is off, and the badge mesh really is invisible;
     2  a placement still produces a reaction, on screen, in the same session;
     3  it reports RESIDENTS and BUSINESSES separately;
     4  the counts it printed equal a census this file computes ITSELF out of
        MythicPlotMood.all() — i.e. the reaction is a regrouping of the shipped
        per-tile verdict and not a second mood model;
     5  a six-tile road drag produces ONE reaction, not six;
     6  the chrome passes the theme bar's measurable tests (blue channel not
        over red by >8/255, border-radius ≤ 6px, heading resolves to a serif).

   RED MUTATION at the end: stub MythicPlotMood.all() to return [] and confirm
   the reaction reports nothing rather than inventing a face.
   ══════════════════════════════════════════════════════════════════════════ */
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const REPO = 'D:/game-deploy';
const ROOT = path.resolve(REPO, 'public');
const THREE_DIR = path.resolve(REPO, '.gauntlet/three171');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.glb': 'model/gltf-binary', '.txt': 'text/plain', '.webp': 'image/webp' };
const PORT = 8790 + (process.pid % 70);

const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p.startsWith('/__three/')) {
    const f = path.join(THREE_DIR, p.slice('/__three/'.length));
    if (fs.existsSync(f)) { res.writeHead(200, { 'Content-Type': 'text/javascript' }); return fs.createReadStream(f).pipe(res); }
    res.writeHead(404); return res.end('nf');
  }
  if (p.endsWith('/')) p += 'index.html';
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end('nf'); }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
});
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));

const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
         '--ignore-gpu-blocklist', '--no-sandbox', '--disable-dev-shm-usage'],
});
const page = await browser.newPage({ viewport: { width: 1400, height: 860 } });
await page.route('**/*', (route) => {
  const u = route.request().url();
  if (u.includes('cdn.jsdelivr.net') && u.includes('three@')) {
    const rel = new URL(u).pathname.replace(/^\/npm\/three@[^/]+\//, '');
    const f = path.join(THREE_DIR, rel);
    return fs.existsSync(f)
      ? route.fulfill({ status: 200, contentType: 'text/javascript', body: fs.readFileSync(f) })
      : route.fulfill({ status: 404, body: 'no vendored three' });
  }
  if (u.includes('127.0.0.1') || u.includes('localhost')) return route.continue();
  return route.abort();
});
await page.goto(`http://127.0.0.1:${PORT}/node-city/index.html`, { waitUntil: 'domcontentloaded', timeout: 90000 });
await page.waitForFunction('!!window.__nc', null, { timeout: 90000 }).catch(() => {});
await page.waitForTimeout(9000);
await page.evaluate(() => { setInterval(() => { const b = document.querySelector('#ncconfirm [data-ncc="1"]'); if (b) b.click(); }, 8); });
await page.evaluate(async () => {
  const nc = window.__nc, B = window.MythicCityBridge;
  if (B) { B.spendCinders = async () => true; B.spendRes = async () => true; B.getCinders = async () => 9e9; B.getRes = async () => 9e9; B.addCinders = async () => true; }
  const _c = window.confirm; window.confirm = () => true;
  const put = async (t, x, z) => { await nc.place(t, x, z); try { nc.build.finishAll('drive'); } catch (e) {} };
  for (let x = 4; x <= 18; x++) await put('road', x, 12);
  await put('housing', 6, 11); await put('housing', 8, 11); await put('housing', 10, 11);
  window.confirm = _c; nc.game.army.workers = 8; await nc.step(0.5, 1);
});
const out = await page.evaluate(async () => {
  const nc = window.__nc, I = window.MythicPlotIcons;
  I.hide();
  const cen = () => { const z=()=>({n:0,ok:0,meh:0,bad:0}); const c={home:z(),biz:z()};
    for (const v of window.MythicPlotMood.all()) { const g = v.kind==='home'?c.home:c.biz; g.n++; g[v.face==='ok'?'ok':v.face==='meh'?'meh':'bad']++; } return c; };
  const _c = window.confirm; window.confirm = () => true;
  await nc.place('grocery', 7, 13);
  try { nc.build.finishAll('drive'); } catch (e) {}
  window.confirm = _c;
  const t0 = Date.now(); const trail = [];
  for (const ms of [200, 400, 700, 1200, 2000, 3000, 4500]) {
    await new Promise(r => setTimeout(r, ms - (Date.now() - t0)));
    trail.push({ at: Date.now() - t0, cen: cen() });
  }
  const r = I.reaction();
  const reasons = {};
  for (const v of window.MythicPlotMood.all()) reasons[v.k] = v.kind + '/' + v.face + '/' + v.reason;
  return { pulseAfter: r && r.after, trail, reasons };
});
console.log('pulse reported: ' + JSON.stringify(out.pulseAfter));
for (const t of out.trail) console.log('  +' + t.at + 'ms  ' + JSON.stringify(t.cen));
console.log('reasons: ' + JSON.stringify(out.reasons));
await browser.close(); server.close(); process.exit(0);
