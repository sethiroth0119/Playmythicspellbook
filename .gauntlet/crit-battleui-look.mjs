/* CRIT-BATTLEUI-LOOK — a real match, screenshotted at both window sizes, plus
   the battle-log modal that #bsxLog is now the only door to. The DOM half of
   the battle screen composites fine; the stage canvas is a 2D canvas whose
   backing store persists, so frame() is driven directly first.
   node .gauntlet/crit-battleui-look.mjs */
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve('D:/game-deploy', 'public');
const OUT = path.resolve('D:/game-deploy', 'tmp'); fs.mkdirSync(OUT, { recursive: true });
const MIME = { '.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.json':'application/json','.png':'image/png','.jpg':'image/jpeg','.svg':'image/svg+xml','.txt':'text/plain','.webp':'image/webp' };
const PORT = 8800 + (process.pid % 90);
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]); if (p.endsWith('/')) p += 'index.html';
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end('nf'); }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
});
await new Promise(r => server.listen(PORT, '127.0.0.1', r));
const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });

for (const [w, h] of [[1600, 900], [1100, 800]]) {
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  await page.route('**/*', r => { const u = r.request().url();
    return (u.includes('127.0.0.1') || u.includes('localhost')) ? r.continue() : r.abort(); });
  await page.goto('http://127.0.0.1:' + PORT + '/index.html', { waitUntil: 'domcontentloaded', timeout: 180000 });
  await page.waitForFunction('typeof initGame === "function"', null, { timeout: 180000 });
  await page.waitForTimeout(5000);
  await page.evaluate(() => {
    App.battlePrep = App.battlePrep || {};
    const me = findHeroById(STARTER_HEROES[0].id), foe = findHeroById(STARTER_HEROES[1].id);
    App.battlePrep.hero = me; App.battlePrep.multiplayer = false;
    App.state = initGame(me, foe, [], true, null); App.screen = 'battle'; render();
  });
  await page.waitForTimeout(8000);
  /* 🔴 drive the stage's own clock; never wait on rAF */
  const drove = await page.evaluate(() => {
    const win = document.querySelector('iframe.bb-stage').contentWindow;
    if (typeof win.frame !== 'function') return 0;
    let t = 700000, n = 0;
    for (let i = 0; i < 30; i++) { t += 16.7; try { win.frame(t); n++; } catch (e) {} }
    return n;
  });
  console.log(w + 'x' + h + ': frame() calls that landed = ' + drove);
  const f1 = path.join(OUT, 'battleui-' + w + 'x' + h + '.png');
  await page.screenshot({ path: f1, animations: 'disabled', timeout: 120000 });
  console.log('  -> ' + f1);

  await page.click('#bsxLog'); await page.waitForTimeout(1200);
  const f2 = path.join(OUT, 'battlelog-' + w + 'x' + h + '.png');
  await page.screenshot({ path: f2, animations: 'disabled', timeout: 120000 });
  console.log('  -> ' + f2);
  await page.close();
}
await browser.close(); server.close();
