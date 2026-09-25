/* ══════════════════════════════════════════════════════════════════════════
   📱 PHONE DRIVER — shot.mjs's harness, plus the two things it cannot do:
     · CROPPED shots (the phone is a 337px column on a 1600px page, and the
       full-page shot renders it as an unreadable sliver);
     · a RETURNED eval value (shot.mjs discards it and truncates console lines
       at 400 chars, so a structured proof cannot come back through it).
   Usage: node .gauntlet/drive-phone.mjs out.png [--w 1600] [--h 900]
                                         [--evalfile f.js] [--clip "#sel"]
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
const out   = process.argv[2] || '.gauntlet/shots/phone.png';
const WAIT  = +arg('--wait', 24000);
const W     = +arg('--w', 1600), H = +arg('--h', 900);
const EVALF = arg('--evalfile', '');
const CLIPS = (arg('--clip', '') || '').split(',').filter(Boolean);
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
page.on('console',   m => logs.push(`[${m.type()}] ${m.text()}`.slice(0, 300)));
page.on('pageerror', e => logs.push(`[pageerror] ${e.message}`.slice(0, 300)));

await page.goto(`http://127.0.0.1:${PORT}/node-city/index.html`, { waitUntil: 'load', timeout: 120000 });
await page.waitForTimeout(WAIT);
const built = await page.evaluate(fs.readFileSync(path.resolve(process.cwd(), '.gauntlet/scene.js'), 'utf8'));
logs.push(`[scene] placed=${built && built.placed}`);
await page.waitForTimeout(5000);

let result = null;
if (EVALF) {
  try { result = await page.evaluate(fs.readFileSync(path.resolve(process.cwd(), EVALF), 'utf8')); }
  catch (e) { result = { evalerr: e.message }; }
  await page.waitForTimeout(1200);
}
fs.mkdirSync(path.dirname(out), { recursive: true });
await page.screenshot({ path: out });
for (let i = 0; i < CLIPS.length; i++) {
  const sel = CLIPS[i].trim();
  const box = await page.evaluate((s) => {
    const e = document.querySelector(s); if (!e) return null;
    const r = e.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  }, sel);
  if (!box || box.width < 2) { logs.push(`[clip] ${sel} -> no box`); continue; }
  const pad = 14;
  const f = out.replace(/\.png$/, `-c${i}.png`);
  await page.screenshot({ path: f, clip: {
    x: Math.max(0, box.x - pad), y: Math.max(0, box.y - pad),
    width: Math.min(W, box.width + pad * 2), height: Math.min(H, box.height + pad * 2) } });
  logs.push(`[clip] ${sel} -> ${f}`);
}
console.log('=== RESULT ===');
console.log(typeof result === 'string' ? result : JSON.stringify(result, null, 1));
console.log('=== LOGS ===');
console.log(logs.slice(-24).join('\n'));
await browser.close();
server.close();
