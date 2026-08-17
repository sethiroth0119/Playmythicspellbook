/* ══════════════════════════════════════════════════════════════════════════
   GAUNTLET SCREENSHOT HARNESS — the thing that makes critics able to see.

   Boots public/node-city/index.html in real Chromium with SwiftShader WebGL2,
   serves public/ over loopback, and fulfils the jsdelivr three@0.171.0 import
   map from a locally vendored copy (the agent proxy 403s CONNECT to CDNs, so
   the page's own <script type=importmap> can never resolve in this box).

   Usage: node .gauntlet/shot.mjs <out.png> [--wait ms] [--w px] [--h px]
                                  [--eval "js run before the shot"]
   Prints JSON: {out, diag, logs} — diag carries the scene object count so a
   caller can tell "rendered a city" from "rendered a blank canvas".
   ══════════════════════════════════════════════════════════════════════════ */
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

/* cwd-relative so a builder can run this inside its own git worktree. */
const ROOT   = path.resolve(process.cwd(), 'public');
const THREE_ = '/home/user/Playmythicspellbook/.gauntlet/package';
const MIME = { '.html':'text/html', '.js':'text/javascript', '.mjs':'text/javascript',
  '.css':'text/css', '.json':'application/json', '.png':'image/png', '.jpg':'image/jpeg',
  '.svg':'image/svg+xml', '.glb':'model/gltf-binary', '.txt':'text/plain', '.webp':'image/webp' };

const arg = (f, d) => { const i = process.argv.indexOf(f); return i > 0 ? process.argv[i+1] : d; };
const out   = process.argv[2] || '.gauntlet/shots/out.png';
const WAIT  = +arg('--wait', 20000);
const W     = +arg('--w', 1600), H = +arg('--h', 900);
const EVAL  = arg('--eval', '');
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

/* Everything else off-box (Supabase, fonts, analytics) fails fast rather than
   burning the 20s budget on DNS — the page is guarded and degrades. */
await page.route('**/*', route => {
  const u = route.request().url();
  if (u.includes('127.0.0.1') || u.includes('localhost') || u.includes('jsdelivr')) return route.continue();
  route.abort();
});

/* three@0.171.0 from the vendored tarball — the import map's exact URLs. */
await page.route('**/cdn.jsdelivr.net/npm/three@0.171.0/**', route => {
  const u = new URL(route.request().url());
  const rel = u.pathname.replace('/npm/three@0.171.0/', '');
  const f = path.join(THREE_, rel);
  if (!fs.existsSync(f)) return route.fulfill({ status: 404, body: 'nf' });
  route.fulfill({ status: 200, contentType: 'text/javascript', body: fs.readFileSync(f) });
});
const logs = [];
page.on('requestfailed', r => logs.push(`[reqfail] ${r.url().slice(0,140)} :: ${r.failure()?.errorText}`));
page.on('console',   m => logs.push(`[${m.type()}] ${m.text()}`.slice(0, 400)));
page.on('pageerror', e => logs.push(`[pageerror] ${e.message}`.slice(0, 400)));

await page.goto(`http://127.0.0.1:${PORT}/node-city/index.html`, { waitUntil: 'load', timeout: 120000 });
await page.waitForTimeout(WAIT);
if (EVAL) { try { await page.evaluate(EVAL); } catch (e) { logs.push(`[evalerr] ${e.message}`); }
            await page.waitForTimeout(4000); }

const diag = await page.evaluate(() => {
  const c = document.querySelector('canvas');
  const S = window.__scene || window.scene;
  let objs = -1, meshes = -1;
  if (S && S.traverse) { objs = 0; meshes = 0; S.traverse(o => { objs++; if (o.isMesh) meshes++; }); }
  return { canvas: c ? { w: c.width, h: c.height, cls: c.className } : null, objs, meshes,
           exposed: Object.keys(window).filter(k => /^(scene|renderer|camera|CITY|GRID|NC)/.test(k)).slice(0,30) };
});
fs.mkdirSync(path.dirname(out), { recursive: true });
await page.screenshot({ path: out });
console.log(JSON.stringify({ out, diag, logs: logs.slice(-30) }, null, 2));
await browser.close();
server.close();
