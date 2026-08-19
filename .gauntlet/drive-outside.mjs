/* ══════════════════════════════════════════════════════════════════════════
   🛣 OUTSIDE CONNECTIONS DRIVER — shot.mjs, but it can SEE.

   shot.mjs discards the eval's return value and truncates console lines at
   400 chars, so a verifier trying to read an elementsFromPoint stack back out
   of it gets a shrug. This variant is the same boot (loopback server, vendored
   three, --scene district) with three differences:
     • the probe's RETURN VALUE is printed in full, pretty-printed;
     • it takes a CROP as well as the full frame, so the band the chip lives in
       can actually be looked at at 1:1 instead of guessed at from a 1600px
       thumbnail;
     • --w/--h can be swept, because "does the chip collide" is a question
       about layout width and one viewport cannot answer it.

   Usage: node .gauntlet/drive-outside.mjs <out.png> --probe <file.js>
                 [--wait ms] [--w px] [--h px] [--crop x,y,w,h] [--no-scene]
   ══════════════════════════════════════════════════════════════════════════ */
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const ROOT   = path.resolve(process.cwd(), 'public');
const THREE_ = '/home/user/Playmythicspellbook/.gauntlet/package';
const MIME = { '.html':'text/html', '.js':'text/javascript', '.mjs':'text/javascript',
  '.css':'text/css', '.json':'application/json', '.png':'image/png', '.jpg':'image/jpeg',
  '.svg':'image/svg+xml', '.glb':'model/gltf-binary', '.txt':'text/plain', '.webp':'image/webp' };

const arg = (f, d) => { const i = process.argv.indexOf(f); return i > 0 ? process.argv[i+1] : d; };
const out   = process.argv[2] || '.gauntlet/shots/outside.png';
const WAIT  = +arg('--wait', 22000);
const W     = +arg('--w', 1600), H = +arg('--h', 900);
const PROBE = arg('--probe', '');
const CROP  = arg('--crop', '');
const SCENE = !process.argv.includes('--no-scene');
const PORT  = 8700 + (process.pid % 90);

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
const logs = [];
page.on('console',   m => logs.push(`[${m.type()}] ${m.text()}`.slice(0, 600)));
page.on('pageerror', e => logs.push(`[pageerror] ${e.message}`.slice(0, 600)));

await page.goto(`http://127.0.0.1:${PORT}/node-city/index.html`, { waitUntil: 'load', timeout: 120000 });
await page.waitForTimeout(WAIT);
let built = null;
if (SCENE) {
  built = await page.evaluate(fs.readFileSync(path.resolve(process.cwd(), '.gauntlet/scene.js'), 'utf8'));
  await page.waitForTimeout(5000);
}
let probe = null;
if (PROBE) {
  try { probe = await page.evaluate(fs.readFileSync(path.resolve(process.cwd(), PROBE), 'utf8')); }
  catch (e) { probe = { PROBE_THREW: e.message }; }
  await page.waitForTimeout(1500);
}
fs.mkdirSync(path.dirname(out), { recursive: true });
await page.screenshot({ path: out });
if (CROP) {
  const [x, y, w, h] = CROP.split(',').map(Number);
  await page.screenshot({ path: out.replace(/\.png$/, '-crop.png'), clip: { x, y, width: w, height: h } });
}
console.log(JSON.stringify({ out, viewport: { W, H }, built, probe, logs: logs.slice(-25) }, null, 2));
await browser.close();
server.close();
