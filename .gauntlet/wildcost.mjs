/* ══ THE WILD-GROUND COST PROBE ════════════════════════════════════════════
   What one layer costs, measured as an A/B INSIDE A SINGLE BOOT rather than
   across two of them.

   🔴 WHY NOT JUST DIFF TWO capture.mjs RUNS. Because the scene is not identical
   between boots: the perimeter treeline and several recipes roll geometry from
   Math.random, and capture.mjs's own header records the whole-scene mesh count
   moving by ±15 run to run for exactly that reason. A cross-boot delta of "+2
   meshes" is therefore inside the noise of the instrument, and a draw-call
   delta measured that way is worthless.

   So this builds the standard district once, renders it twice — with the
   layer's group visible and with it hidden — and reads renderer.info both
   times. Everything else in the scene is byte-identical between the two reads,
   so the delta is the layer and nothing else.

   ⚠ `group.visible = false` removes the layer from BOTH the colour pass and
     the shadow pass, which is what makes the draw-call figure honest: the
     standing bucket casts, so it costs two calls a frame and not one.

   Usage: node .gauntlet/wildcost.mjs
   ══════════════════════════════════════════════════════════════════════════ */
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';

const ROOT = path.resolve(process.cwd(), 'public');
const THREE_ = '/home/user/Playmythicspellbook/.gauntlet/package';
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.glb': 'model/gltf-binary', '.txt': 'text/plain', '.webp': 'image/webp' };
const PORT = 8700 + (process.pid % 90);
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]); if (p.endsWith('/')) p += 'index.html';
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end('nf'); }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
});
await new Promise(r => server.listen(PORT, '127.0.0.1', r));

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist',
         '--no-sandbox', '--disable-dev-shm-usage', '--no-proxy-server'],
  env: Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(HTTPS?_PROXY|https?_proxy|ALL_PROXY|all_proxy)$/.test(k))) });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
await page.route('**/*', r => { const u = r.request().url();
  (u.startsWith('data:') || u.includes('127.0.0.1') || u.includes('localhost') || u.includes('jsdelivr')) ? r.continue() : r.abort(); });
await page.route('**/cdn.jsdelivr.net/npm/three@0.171.0/**', r => {
  const rel = new URL(r.request().url()).pathname.replace('/npm/three@0.171.0/', '');
  const f = path.join(THREE_, rel);
  fs.existsSync(f) ? r.fulfill({ status: 200, contentType: 'text/javascript', body: fs.readFileSync(f) })
                   : r.fulfill({ status: 404, body: 'nf' });
});
// Same clock pin as capture.mjs — the shadow pass is only busy while the sun is up.
await page.addInitScript(({ hour }) => {
  const _D = Date; const now = new _D(); const parts = {};
  for (const p of new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York',
        hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).formatToParts(now)) parts[p.type] = p.value;
  const curH = (+parts.hour % 24) + (+parts.minute) / 60 + (+parts.second) / 3600;
  const shiftMs = (hour - curH) * 3600 * 1000;
  class S extends _D { constructor(...a) { if (!a.length) super(_D.now() + shiftMs); else super(...a); }
    static now() { return _D.now() + shiftMs; } }
  S.parse = _D.parse; S.UTC = _D.UTC; window.Date = S;
}, { hour: 15 });

const logs = []; page.on('console', m => logs.push(('[' + m.type() + '] ' + m.text()).slice(0, 240)));
page.on('pageerror', e => logs.push('[pageerror] ' + String(e.message).slice(0, 240)));
await page.goto('http://127.0.0.1:' + PORT + '/node-city/index.html', { waitUntil: 'load', timeout: 120000 });
await page.waitForTimeout(24000);
await page.evaluate(fs.readFileSync(path.resolve(process.cwd(), '.gauntlet/scene.js'), 'utf8'));
await page.waitForTimeout(4000);

const out = await page.evaluate(() => {
  const nc = window.__nc, { renderer, scene, camera } = nc.three();
  /* Frame it the way capture.mjs frames the aerial, so the numbers describe the
     picture a critic is looking at and not whatever the camera drifted to. */
  const P = []; for (const t of Object.values(nc.game.tiles)) if (t.mesh) P.push([t.mesh.position.x, t.mesh.position.z]);
  const xs = P.map(p => p[0]), zs = P.map(p => p[1]);
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cz = (Math.min(...zs) + Math.max(...zs)) / 2;
  const span = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...zs) - Math.min(...zs));
  camera.position.set(cx + span * .62, span * .55, cz + span * .62);
  camera.lookAt(cx, 0, cz); camera.updateMatrixWorld(); camera.updateProjectionMatrix();
  const g = scene.getObjectByName('wild');
  /* ⚠ COUNT THE MESHES THE GROUP HOLDS, NOT THE VISIBLE ONES IN THE SCENE.
     The first cut counted `o.isMesh && o.visible` over the whole graph, and
     hiding a GROUP does not clear `visible` on its children — so the mesh
     delta came back 0 for a layer that plainly adds two. Draw calls and
     triangles are read from the renderer and are unaffected. */
  const read = (withLayer) => { renderer.info.reset(); renderer.render(scene, camera);
    let m = 0; scene.traverse(o => { if (o.isMesh) m++; });
    if (!withLayer && g) m -= g.children.length;
    return { meshes: m, calls: renderer.info.render.calls, tris: renderer.info.render.triangles }; };
  const on = read(true);
  if (g) g.visible = false;
  const off = read(false);
  if (g) g.visible = true;
  let st = null; try { st = window.MythicWild ? window.MythicWild.stats() : null; } catch (e) {}
  return { on, off, delta: { meshes: on.meshes - off.meshes, calls: on.calls - off.calls, tris: on.tris - off.tris },
           layer: st, mounted: !!window.MythicWild };
});
console.log(JSON.stringify({ ...out, logs: logs.filter(l => /Wild|error|Error/.test(l)).slice(-8) }, null, 2));
await browser.close(); server.close();
