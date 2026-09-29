/* ovl-probe — settle whether the landvalue / water ground overlays are visible
   over a populated frame. Boots the real page, builds the standard district,
   frames an aerial, and does an in-page A/B where the RENDERER IS DRIVEN
   between the two reads. Pixels are lifted with drawImage() in the SAME task as
   render(), so no preserveDrawingBuffer is needed and no rAF can interleave. */
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const ROOT   = path.resolve('/home/user/Playmythicspellbook', 'public');
const THREE_ = '/home/user/Playmythicspellbook/.gauntlet/package';
const OUTDIR = process.argv[2] || '/home/user/Playmythicspellbook/.gauntlet/shots/ovl';
const MIME = { '.html':'text/html', '.js':'text/javascript', '.mjs':'text/javascript',
  '.css':'text/css', '.json':'application/json', '.png':'image/png', '.jpg':'image/jpeg',
  '.svg':'image/svg+xml', '.glb':'model/gltf-binary', '.txt':'text/plain', '.webp':'image/webp' };
const PORT = 8700 + (process.pid % 90);
const W = 1600, H = 900;

const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p.endsWith('/')) p += 'index.html';
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end('nf'); }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
});
await new Promise(r => server.listen(PORT, '127.0.0.1', r));

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
         '--ignore-gpu-blocklist', '--no-sandbox', '--disable-dev-shm-usage', '--no-proxy-server'],
  env: Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(HTTPS?_PROXY|https?_proxy|ALL_PROXY|all_proxy)$/.test(k))),
});
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1, ignoreHTTPSErrors: true });
await page.route('**/*', route => {
  const u = route.request().url();
  if (u.includes('127.0.0.1') || u.includes('localhost') || u.includes('jsdelivr')) return route.continue();
  route.abort();
});
await page.route('**/cdn.jsdelivr.net/npm/three@0.171.0/**', route => {
  const u = new URL(route.request().url());
  const f = path.join(THREE_, u.pathname.replace('/npm/three@0.171.0/', ''));
  if (!fs.existsSync(f)) return route.fulfill({ status: 404, body: 'nf' });
  route.fulfill({ status: 200, contentType: 'text/javascript', body: fs.readFileSync(f) });
});
/* pin 15:00 — same shift shot.mjs/capture.mjs use */
await page.addInitScript(({ hour }) => {
  const _D = Date; const parts = {};
  for (const p of new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York',
        hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).formatToParts(new _D()))
    parts[p.type] = p.value;
  const curH = (+parts.hour % 24) + (+parts.minute) / 60 + (+parts.second) / 3600;
  const shiftMs = (hour - curH) * 3600 * 1000;
  class ShiftedDate extends _D {
    constructor(...a) { if (a.length === 0) super(_D.now() + shiftMs); else super(...a); }
    static now() { return _D.now() + shiftMs; }
  }
  ShiftedDate.parse = _D.parse; ShiftedDate.UTC = _D.UTC;
  window.Date = ShiftedDate;
}, { hour: 15 });

const logs = [];
page.on('console',   m => logs.push(`[${m.type()}] ${m.text()}`.slice(0, 300)));
page.on('pageerror', e => logs.push(`[pageerror] ${e.message}`.slice(0, 300)));

await page.goto(`http://127.0.0.1:${PORT}/node-city/index.html`, { waitUntil: 'load', timeout: 120000 });
await page.waitForTimeout(20000);
const built = await page.evaluate(fs.readFileSync('/home/user/Playmythicspellbook/.gauntlet/scene.js', 'utf8'));
await page.waitForTimeout(4000);
console.log('SCENE ' + JSON.stringify(built).slice(0, 300));

fs.mkdirSync(OUTDIR, { recursive: true });

/* ── the probe ─────────────────────────────────────────────────────────── */
const DRIVER = fs.readFileSync('/home/user/Playmythicspellbook/.gauntlet/ovl-driver.js', 'utf8');
const res = await page.evaluate(DRIVER);
fs.writeFileSync(path.join(OUTDIR, 'probe.json'), JSON.stringify(res, null, 2));
for (const [k, v] of Object.entries(res.images || {})) {
  fs.writeFileSync(path.join(OUTDIR, k + '.png'), Buffer.from(v.split(',')[1], 'base64'));
}
const slim = JSON.parse(JSON.stringify(res)); delete slim.images;
console.log(JSON.stringify(slim, null, 2));
console.log('LOGS ' + JSON.stringify(logs.slice(-12), null, 1));
await browser.close();
server.close();
