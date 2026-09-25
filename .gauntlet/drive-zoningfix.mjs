/* ══════════════════════════════════════════════════════════════════════════
   ZONING FIX DRIVER — the two defects, driven against the real page.
   shot.mjs discards the eval's return value and clips console lines at 400
   chars, so this is a variant that PRINTS what the eval returns.

   Usage: node .gauntlet/drive-zoningfix.mjs [out.png]
   ══════════════════════════════════════════════════════════════════════════ */
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(process.cwd(), 'public');
const THREE_ = '/home/user/Playmythicspellbook/.gauntlet/package';
const MIME = { '.html':'text/html', '.js':'text/javascript', '.mjs':'text/javascript',
  '.css':'text/css', '.json':'application/json', '.png':'image/png', '.jpg':'image/jpeg',
  '.svg':'image/svg+xml', '.glb':'model/gltf-binary', '.txt':'text/plain', '.webp':'image/webp' };
const out = process.argv[2] || '.gauntlet/shots/fix-zoning.png';
const PORT = 8790 + (process.pid % 60);

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
const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
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
page.on('console', m => logs.push(`[${m.type()}] ${m.text()}`.slice(0, 300)));
page.on('pageerror', e => logs.push(`[pageerror] ${e.message}`.slice(0, 300)));
await page.goto(`http://127.0.0.1:${PORT}/node-city/index.html`, { waitUntil: 'load', timeout: 120000 });
await page.waitForTimeout(24000);
const built = await page.evaluate(fs.readFileSync('.gauntlet/scene.js', 'utf8'));
console.log('[scene]', JSON.stringify(built).slice(0, 300));
await page.waitForTimeout(4000);

const script = fs.readFileSync(process.argv[3] || '.gauntlet/zoningfix-eval.js', 'utf8');
let r;
try { r = await page.evaluate(script); } catch (e) { r = { EVALERR: e.message }; }
console.log('══ RESULT ══');
console.log(JSON.stringify(r, null, 1));
fs.mkdirSync(path.dirname(out), { recursive: true });
await page.screenshot({ path: out });
console.log('══ LOGS ══');
console.log(logs.slice(-25).join('\n'));
await browser.close();
server.close();
