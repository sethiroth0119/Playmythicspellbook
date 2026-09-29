/* ══ 🛣 STREETS DRIVER ══════════════════════════════════════════════════════
   shot.mjs discards the eval's return value and truncates console at 400 chars,
   and the traffic charts need a MINUTES-long observation to say anything. This
   is shot.mjs's boot + scene with a sampling loop instead of a single eval, and
   it prints whole JSON objects.

   Usage: node .gauntlet/drive-streets.mjs [--run sec] [--every sec]
                                           [--png out.png] [--boot ms]
   Prints one JSON line per sample plus a final summary.
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
const RUN   = +arg('--run', 180) * 1000;
const EVERY = +arg('--every', 30) * 1000;
const BOOT  = +arg('--boot', 20000);
const PNG   = arg('--png', '');
const VP    = arg('--vp', '1600x900').split('x').map(Number);
/* ⏩ CLOCK INJECTION, and nothing else. The sim runs on animate()'s dt, which is
   clamped to 0.25 s a frame, and SwiftShader in this box renders the built
   district at well under 4 fps — so the city's own clock advances at roughly a
   TENTH of wall time here and one 20-minute cycle would take three hours to
   watch. `--ff n` adds n seconds to game.cityAge per animation frame, which is
   the same thing __nc.step() does through vitalsTick and the same trick the
   demographics seam documents ("waiting 20 real minutes for one economic day is
   not a test").
   ⚠ IT INJECTS TIME, NEVER TRAFFIC. Every pass in the rings is a real agent
     crossing a real tile boundary in agentTick. Compressing the clock n-fold
     means the city genuinely carries n times FEWER vehicles per city hour than a
     player's would, so volumes read low — the shape and the plumbing are real,
     the density is not. Do not screenshot a --ff run as a reference for how busy
     a street is. */
const FF    = +arg('--ff', 0);
const PORT  = 8800 + (process.pid % 90);

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
const page = await browser.newPage({ viewport: { width: VP[0] || 1600, height: VP[1] || 900 }, deviceScaleFactor: 1, ignoreHTTPSErrors: true });
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
page.on('console',  m => { const t = `[${m.type()}] ${m.text()}`; if (/street|Street|error|Error/.test(t)) logs.push(t.slice(0, 300)); });
page.on('pageerror', e => logs.push(`[pageerror] ${e.message}`.slice(0, 300)));

await page.goto(`http://127.0.0.1:${PORT}/node-city/index.html`, { waitUntil: 'load', timeout: 120000 });
await page.waitForTimeout(BOOT);
const built = await page.evaluate(fs.readFileSync(path.resolve(process.cwd(), '.gauntlet/scene.js'), 'utf8'));
console.log('SCENE ' + JSON.stringify(built).slice(0, 300));
await page.waitForTimeout(4000);

/* Frame counter + the optional clock injection, both on ONE rAF so the injected
   seconds land at most once per game frame — the meter credits at most
   STREET.MAX_TICK_CREDIT_SEC per frame, and over-running that just throws the
   surplus away. */
await page.evaluate(`(() => {
  window.__ffN = ${FF}; window.__frames = 0; window.__t0 = performance.now();
  (function loop(){ requestAnimationFrame(loop); window.__frames++;
    if (window.__ffN > 0) window.__nc.game.cityAge = (window.__nc.game.cityAge || 0) + window.__ffN; })();
})()`);

/* One sample: everything a traffic question can be asked of, in one object. */
const SAMPLE = `(() => {
  const nc = window.__nc, S = window.MythicStreets;
  if (!S) return { err: 'no MythicStreets' };
  const sts = S.streets();
  const byLen = sts.slice().sort((a,b) => b.len - a.len);
  const top = byLen[0];
  const st = S.statsAt(top.tiles[Math.floor(top.tiles.length/2)]);
  let bestTile = 0, tileLives = [];
  for (const s of sts) for (const k of s.tiles) { const l = S._meter.lifeOf(k); if (l > bestTile) bestTile = l; }
  for (const k of top.tiles) tileLives.push(S._meter.lifeOf(k));
  return {
    fps: +(window.__frames / ((performance.now() - window.__t0) / 1000)).toFixed(2),
    cityAge: Math.round(nc.game.cityAge || 0),
    streets: sts.length,
    st: st.name, len: top.len,
    obsBuckets: st.traffic.observedBuckets,
    obsSec: Math.round(st.traffic.obsSec),
    vehTotal: st.traffic.vehTotal, pedTotal: st.traffic.pedTotal,
    cap: +st.traffic.capacity.toFixed(2),
    peakFlow: +st.peakFlow.toFixed(1), peakVol: +st.peakVolume.toFixed(2),
    cond: st.condition, wearAvg: +st.wearAvg.toFixed(2),
    lifePasses: st.lifePasses, maxTileLife: bestTile,
    tileLives: tileLives.slice(0, 12),
    seen: st.traffic.seen.map(v => v ? 1 : 0).join(''),
    vol: st.traffic.volume.map(v => +v.toFixed(1)),
  };
})()`;

const t0 = Date.now();
let last = null;
while (Date.now() - t0 < RUN) {
  await page.waitForTimeout(Math.min(EVERY, Math.max(1000, RUN - (Date.now() - t0))));
  last = await page.evaluate(SAMPLE);
  console.log('SAMPLE +' + Math.round((Date.now() - t0) / 1000) + 's ' + JSON.stringify(last));
}
console.log('LOGS ' + JSON.stringify(logs.slice(-12), null, 1));
if (PNG) {
  const openIt = await page.evaluate(`(() => {
    const nc = window.__nc, S = window.MythicStreets;
    const sts = S.streets().slice().sort((a,b) => b.len - a.len);
    const k = sts[0].tiles[Math.floor(sts[0].tiles.length/2)];
    /* The SHIPPED road path: openInspect(k) is what a click lands on, and its
       road branch is the one that hands over to MythicStreets.renderInspect. */
    try { nc.inspect(k); } catch (e) { S.renderInspect(k); }
    const el = document.getElementById('inspect');
    const cap = document.querySelector('#inspect .st-cap');
    return { k, panel: !!document.getElementById('st-name'),
             open: el ? el.className : null,
             cap: cap ? cap.textContent.slice(0, 160) : null,
             charts: document.querySelectorAll('#inspect .st-chart').length,
             paths: document.querySelectorAll('#inspect .st-chart path').length,
             top: (document.getElementById('instop') || {}).textContent };
  })()`);
  console.log('PANEL ' + JSON.stringify(openIt));
  await page.waitForTimeout(1200);
  fs.mkdirSync(path.dirname(PNG), { recursive: true });
  await page.screenshot({ path: PNG });
  console.log('PNG ' + PNG);
}
await browser.close();
server.close();
