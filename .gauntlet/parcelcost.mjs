/* ══ THE PARCEL A/B PROBE ══════════════════════════════════════════════════
   What the parcel layer costs and what it changes, measured as an A/B INSIDE A
   SINGLE BOOT, at all three of capture.mjs's framings.

   🔴 WHY NOT DIFF TWO capture.mjs RUNS. Because the drift floor between two
   boots is 2.19 / 3.44 / 5.80 pp on aerial / district / street — the crowd
   lands somewhere else and several recipes roll from Math.random — and round 9
   published figures roughly eight times its real contribution by not measuring
   against a control. Rendering the same scene twice inside one boot with only
   `group.visible` between the two reads has NO such floor, and this prints the
   floor it does have (a second identical render) beside every number so the
   reader can see it rather than take it on trust.

   ⚠ `group.visible = false` removes the layer from BOTH the colour pass and
     the shadow pass, so the draw-call figure counts the standing bucket's
     shadow draw as well as its colour draw.
   ⚠ MESHES ARE COUNTED BY WALKING ANCESTRY FOR VISIBILITY. wildcost.mjs's own
     header records the two wrong versions of that line; the second could not
     fail because it subtracted `g.children.length`.

   Usage: node .gauntlet/parcelcost.mjs [outdir]
   ══════════════════════════════════════════════════════════════════════════ */
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';

const OUT = process.argv[2] || '.gauntlet/shots/_ab';
fs.mkdirSync(OUT, { recursive: true });
const ROOT = path.resolve(process.cwd(), 'public');
const THREE_ = '/home/user/Playmythicspellbook/.gauntlet/package';
const MIME = { '.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css',
  '.json':'application/json','.png':'image/png','.jpg':'image/jpeg','.svg':'image/svg+xml',
  '.glb':'model/gltf-binary','.txt':'text/plain','.webp':'image/webp' };
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
  args: ['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist',
         '--no-sandbox','--disable-dev-shm-usage','--no-proxy-server'],
  env: Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(HTTPS?_PROXY|https?_proxy|ALL_PROXY|all_proxy)$/.test(k))) });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
/* ⚠ SwiftShader renders the built district at well under a frame a second and
   the street framing is the slowest of the three. Playwright's 30 s default
   screenshot timeout throws there, which is a tool failure that looks like a
   page failure. */
page.setDefaultTimeout(180000);
await page.route('**/*', r => { const u = r.request().url();
  (u.startsWith('data:') || u.includes('127.0.0.1') || u.includes('localhost') || u.includes('jsdelivr')) ? r.continue() : r.abort(); });
await page.route('**/cdn.jsdelivr.net/npm/three@0.171.0/**', r => {
  const rel = new URL(r.request().url()).pathname.replace('/npm/three@0.171.0/','');
  const f = path.join(THREE_, rel);
  fs.existsSync(f) ? r.fulfill({ status: 200, contentType: 'text/javascript', body: fs.readFileSync(f) })
                   : r.fulfill({ status: 404, body: 'nf' });
});
await page.addInitScript(({ hour }) => {           // same clock pin as capture.mjs
  const _D = Date; const parts = {};
  for (const p of new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York',
        hour:'2-digit', minute:'2-digit', second:'2-digit', hour12:false }).formatToParts(new _D())) parts[p.type] = p.value;
  const curH = (+parts.hour % 24) + (+parts.minute)/60 + (+parts.second)/3600;
  const shiftMs = (hour - curH) * 3600 * 1000;
  class S extends _D { constructor(...a){ if(!a.length) super(_D.now()+shiftMs); else super(...a); }
    static now(){ return _D.now()+shiftMs; } }
  S.parse=_D.parse; S.UTC=_D.UTC; window.Date=S;
}, { hour: 15 });
const logs = []; page.on('console', m => logs.push(('['+m.type()+'] '+m.text()).slice(0,200)));
await page.goto('http://127.0.0.1:'+PORT+'/node-city/index.html', { waitUntil:'load', timeout:120000 });
await page.waitForTimeout(24000);
await page.evaluate(fs.readFileSync(path.resolve(process.cwd(), '.gauntlet/scene.js'),'utf8'));
await page.waitForTimeout(4000);

const SHOTS = await page.evaluate(() => {
  const nc = window.__nc, P = [];
  for (const t of Object.values(nc.game.tiles)) if (t.mesh) P.push([t.mesh.position.x, t.mesh.position.z]);
  const xs = P.map(p=>p[0]), zs = P.map(p=>p[1]);
  const cx=(Math.min(...xs)+Math.max(...xs))/2, cz=(Math.min(...zs)+Math.max(...zs))/2;
  const span = Math.max(Math.max(...xs)-Math.min(...xs), Math.max(...zs)-Math.min(...zs));
  const roads = {};
  for (const t of Object.values(nc.game.tiles)) if (t.mesh && t.type==='road')
    (roads[t.mesh.position.z.toFixed(2)] ||= []).push(t.mesh.position.x);
  let best=null;
  for (const z in roads) { const r = roads[z].sort((a,b)=>a-b);
    const sc = r.length - Math.abs(+z-cz)*.5; if(!best||sc>best.sc) best={z:+z,xs:r,sc}; }
  const st = best && best.xs.length>3
    ? { cam:[best.xs[1],.30,best.z-.12], tgt:[best.xs[best.xs.length-2],.26,best.z+.10] }
    : { cam:[cx-span*.34,.30,cz], tgt:[cx+span*.3,.26,cz] };
  const c=nc.controls; c.maxPolarAngle=Math.PI*.4995; c.minDistance=.05; c.enableDamping=false;
  return [ { n:'aerial',   cam:[cx+span*.62, span*.55, cz+span*.62], tgt:[cx,0,cz] },
           { n:'street',   cam:st.cam, tgt:st.tgt },
           { n:'district', cam:[cx+span*.26, span*.22, cz+span*.34], tgt:[cx-span*.06,0,cz-span*.06] } ];
});

const frameAt = async (s) => page.evaluate(([c,t]) => { const nc = window.__nc;
  nc.camera.position.set(c[0],c[1],c[2]); nc.controls.target.set(t[0],t[1],t[2]); nc.controls.update();
  nc.camera.position.set(c[0],c[1],c[2]); nc.camera.lookAt(t[0],t[1],t[2]);
  nc.camera.updateMatrixWorld(); nc.camera.updateProjectionMatrix();
  try { nc.cullAgents(90); } catch(e) {}
  const {renderer,scene,camera}=nc.three(); renderer.render(scene,camera);
}, [s.cam, s.tgt]);

const read = (vis) => page.evaluate((v) => {
  const nc = window.__nc, {renderer,scene,camera}=nc.three();
  const g = scene.getObjectByName('parcel'); if (g) g.visible = v;
  const on = (o) => { let p=o; while(p){ if(!p.visible) return false; p=p.parent; } return true; };
  renderer.info.reset(); renderer.render(scene,camera);
  let m=0; scene.traverse(o=>{ if(o.isMesh && on(o)) m++; });
  return { meshes:m, calls:renderer.info.render.calls, tris:renderer.info.render.triangles };
}, vis);

const rows = [];
for (const s of SHOTS) {
  await frameAt(s); await page.waitForTimeout(900); await frameAt(s);
  /* ⚠ THE THREE COUNT READS HAPPEN BACK TO BACK, BEFORE ANY SCREENSHOT.
     The first cut interleaved them — read, shoot, read, shoot — and a
     screenshot under SwiftShader takes tens of seconds, during which rAF fires
     and animate() steps the crowd and the clock. Measured that way the DISTRICT
     framing reported dMeshes -12 and dCalls -10: the layer apparently made the
     scene CHEAPER, which is arithmetic nonsense and was entirely agents being
     culled differently between the two reads. Nothing moves between these three
     lines except `group.visible`. */
  const on = await read(true), ctrl = await read(true), off = await read(false);
  await read(true);  await page.screenshot({ path: path.join(OUT, s.n+'-on.png'), timeout: 180000 });
  await read(true);  await page.screenshot({ path: path.join(OUT, s.n+'-ctrl.png'), timeout: 180000 });
  await read(false); await page.screenshot({ path: path.join(OUT, s.n+'-off.png'), timeout: 180000 });
  await read(true);
  rows.push({ n:s.n, on, ctrl, off });
}
/* ── THE DIFF, DONE IN NODE WITH sharp, NOT IN THE PAGE ────────────────────
   The first cut decoded the two PNGs through the page that was already open,
   which is capture.mjs's trick — but capture.mjs serves them from the SAME
   loopback origin the page was loaded from. Serving them from a second port
   taints the canvas and getImageData throws, and the honest fix is not a
   `catch { null }` (a silent fallback inside the tool built to stop silent
   fallbacks) but to stop needing a canvas at all. */
await browser.close(); server.close();
const { default: sharp } = await import('sharp');
const raw = async f => (await sharp(f).removeAlpha().raw().toBuffer({ resolveWithObject: true }));
const diff = async (a, b) => {
  const A = await raw(a), B = await raw(b);
  let n = 0; const d = A.data, e = B.data;
  for (let i = 0; i < d.length; i += 3) {
    if (Math.abs(d[i]-e[i]) + Math.abs(d[i+1]-e[i+1]) + Math.abs(d[i+2]-e[i+2]) > 12) n++;
  }
  const tot = A.info.width * A.info.height;
  return { pct: +(100 * n / tot).toFixed(3), px: n, tot };
};
for (const r of rows) {
  const f = n => path.join(OUT, r.n + '-' + n + '.png');
  r.floor = await diff(f('on'), f('ctrl'));      // do-nothing control, identical spacing
  r.layer = await diff(f('on'), f('off'));       // the whole parcel layer
}
console.log(JSON.stringify({ out: OUT, rows: rows.map(r => ({
  framing: r.n,
  trisWith: r.on.tris, trisWithout: r.off.tris, dTris: r.on.tris - r.off.tris,
  callsWith: r.on.calls, callsWithout: r.off.calls, dCalls: r.on.calls - r.off.calls,
  meshesWith: r.on.meshes, meshesWithout: r.off.meshes, dMeshes: r.on.meshes - r.off.meshes,
  pxDoNothingControl: r.floor.pct, pxWholeParcelLayer: r.layer.pct,
})), logs: logs.slice(-6) }, null, 1));
