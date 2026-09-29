/* ══════════════════════════════════════════════════════════════════════════
   WINDOWS DRIVER — the same job .gauntlet/shot.mjs does, on this box.

   shot.mjs hard-codes three Linux paths (/opt/node22's playwright, the
   /opt/pw-browsers chromium, and a /home/user vendored three), so on Windows it
   cannot start at all. This is the same harness with those three resolved from
   the local install instead, and with the screenshot dropped — what is being
   verified here is a SIMULATION, and the page's own diagnostics seam (__nc)
   answers it far better than a picture would.

   Usage: node .gauntlet/win-drive.mjs --eval "<js>" [--wait ms]
   Prints JSON: { ok, result, logs }.

   ⚠ THE IMPORT MAP POINTS AT jsdelivr AND THIS BOX CANNOT REACH IT. Every
     request to a non-loopback host is answered from the local three package if
     one matches, and 502'd otherwise, so a failure to boot is reported as a
     failure to boot rather than as a hang.
   ══════════════════════════════════════════════════════════════════════════ */
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', 'public');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.glb': 'model/gltf-binary', '.txt': 'text/plain', '.webp': 'image/webp' };

const arg = (f, d) => { const i = process.argv.indexOf(f); return i > 0 ? process.argv[i + 1] : d; };
const WAIT = +arg('--wait', 22000);
const EVAL = arg('--eval', '');
const EVALFILE = arg('--eval-file', '');
const CODE = EVALFILE ? fs.readFileSync(EVALFILE, 'utf8') : EVAL;
const PORT = 8800 + (process.pid % 90);

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
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
         '--ignore-gpu-blocklist', '--no-sandbox', '--disable-dev-shm-usage', '--no-proxy-server'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

/* 💰 SEED THE MOCK LEDGER BEFORE THE PAGE READS IT. The bridge's standalone
   ledger starts at 400 🔥, which is less than one Water Station, and topping it
   up through `MythicCityBridge.addCinders` costs an awaited round trip per call
   inside the eval. Written straight into localStorage under the bridge's own key
   (`mockLedger()`), from an init script, so the page boots already solvent and
   the eval spends its budget on the thing being tested. */
if (process.argv.includes('--rich')) {
  await page.addInitScript(() => {
    try {
      localStorage.setItem('mythic_city_mockledger_v1', JSON.stringify({
        cinders: 900000,
        res: { food: 4000, water: 4000, metal: 4000, fuel: 2000, supplies: 2000, medicine: 500,
               ammo: 500, corruptedEssence: 0, memoryShards: 0, wood: 2000, stone: 2000, cloth: 1000 },
      }));
    } catch (e) {}
  });
}
/* 🧊 FREEZE THE RENDER LOOP FOR THE LENGTH OF THE EVAL.
   🐞 MEASURED: under SwiftShader this page's own animate() loop crashes the
      renderer process after roughly a minute of wall clock, and a long driver
      then reports "Target crashed" with no result — which reads exactly like the
      feature under test throwing. Stubbing rAF stops the loop re-scheduling
      itself, and what is being driven here is economyTick, which animate() only
      calls on a timer anyway. CLAUDE.md already records that rAF is effectively
      dead in the capture pane; this makes it deliberately dead instead of
      erratically alive. */
if (!process.argv.includes('--animate')) {
  await page.addInitScript(() => {
    window.__ncFreeze = () => { window.requestAnimationFrame = () => 0; };
  });
}
const logs = [];
page.on('console', (m) => { if (logs.length < 400) logs.push(m.type()[0] + ': ' + m.text().slice(0, 300)); });
page.on('pageerror', (e) => logs.push('E: ' + String(e).slice(0, 300)));

/* The import map's five three URLs, served from whatever three this repo has.
   ⚠ THE VENDORED COPY IS 0.128 AND THE PAGE ASKS FOR 0.171 — the WebGPU build
     does not exist here at all, so `three` and `three/webgpu` are answered with
     the classic module build. That is enough to boot the scene graph, which is
     all this harness needs; it is NOT enough to photograph one, which is why
     this file does not pretend to. */
const THREE_DIRS = [path.resolve(HERE, 'package'), path.resolve(HERE, '..', 'node_modules', 'three')];
function localThree(url) {
  const want = /three\.tsl/.test(url) ? null
    : /examples\/jsm\/(.*)$/.exec(url) ? ['examples/jsm/' + /examples\/jsm\/(.*)$/.exec(url)[1]]
    : ['build/three.module.js', 'three.module.js'];
  if (!want) return null;
  for (const d of THREE_DIRS) for (const w of want) {
    const f = path.join(d, w);
    if (fs.existsSync(f)) return fs.readFileSync(f, 'utf8');
  }
  return null;
}
await page.route('**/*', async (route) => {
  const url = route.request().url();
  if (url.startsWith('http://127.0.0.1:' + PORT)) return route.continue();
  const body = localThree(url);
  if (body != null) return route.fulfill({ status: 200, contentType: 'text/javascript', body });
  return route.fulfill({ status: 502, contentType: 'text/plain', body: '// offline: ' + url });
});

let result = null, ok = false, why = '';
try {
  await page.goto('http://127.0.0.1:' + PORT + '/node-city/index.html', { waitUntil: 'domcontentloaded', timeout: 40000 });
  await page.waitForFunction(() => !!(window.__nc && window.__nc.game), null, { timeout: WAIT })
    .catch(() => { why = '__nc never appeared'; });
  if (!why && CODE) {
    result = await page.evaluate(`(async () => { ${CODE} })()`);
    ok = true;
  } else if (!why) { ok = true; }
} catch (e) { why = String(e).slice(0, 400); }

console.log(JSON.stringify({ ok, why, result, logs: logs.slice(-60) }, null, 2));
await browser.close();
server.close();
process.exit(ok ? 0 : 1);
