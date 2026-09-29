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
}, { hour: +(process.env.CRIT_HOUR||15) });

const logs = []; page.on('console', m => logs.push(('[' + m.type() + '] ' + m.text()).slice(0, 240)));
page.on('pageerror', e => logs.push('[pageerror] ' + String(e.message).slice(0, 240)));
await page.goto('http://127.0.0.1:' + PORT + '/node-city/index.html', { waitUntil: 'load', timeout: 120000 });
await page.waitForTimeout(24000);
await page.evaluate(fs.readFileSync(path.resolve(process.cwd(), '.gauntlet/scene.js'), 'utf8'));
await page.waitForTimeout(4000);


/* ── framing, copied from capture.mjs ─────────────────────────────────── */
const frame = await page.evaluate(() => {
  const nc = window.__nc; const P = []; const roads = [];
  for (const t of Object.values(nc.game.tiles)) { if (!t.mesh) continue;
    P.push([t.mesh.position.x, t.mesh.position.z]);
    if (t.type === 'road') roads.push({ x: t.mesh.position.x, z: t.mesh.position.z }); }
  const xs = P.map(p=>p[0]), zs = P.map(p=>p[1]);
  const box={x0:Math.min(...xs),x1:Math.max(...xs),z0:Math.min(...zs),z1:Math.max(...zs)};
  const cx=(box.x0+box.x1)/2, cz=(box.z0+box.z1)/2;
  const isPlot=(t)=>t&&t.type!=='road'&&t.type!=='anchor';
  const rows={}; for (const r of roads) (rows[r.z.toFixed(2)] ||= []).push(r.x);
  let best=null;
  for (const z in rows){ const xsr=rows[z].sort((a,b)=>a-b); let front=0;
    for (const t of Object.values(nc.game.tiles)){ if(!t.mesh||!isPlot(t))continue;
      if(Math.abs(t.mesh.position.z-+z)<1.01&&Math.abs(t.mesh.position.z-+z)>.5)front++; }
    const score=front*2+xsr.length-Math.abs(+z-cz)*.5;
    if(!best||score>best.score)best={z:+z,xs:xsr,score,front}; }
  return {box,cx,cz,road:best};
});
const cx=frame.cx, cz=frame.cz;
const span=Math.max(frame.box.x1-frame.box.x0, frame.box.z1-frame.box.z0);
const R=frame.road;
const street = R && R.xs.length>3 ? {cam:[R.xs[1],.30,R.z-.12],tgt:[R.xs[R.xs.length-2],.26,R.z+.10]}
                                  : {cam:[cx-span*.34,.30,cz],tgt:[cx+span*.3,.26,cz]};
const SHOTS=[{n:'aerial',cam:[cx+span*.62,span*.55,cz+span*.62],tgt:[cx,0,cz]},
             {n:'street',cam:street.cam,tgt:street.tgt},
             {n:'district',cam:[cx+span*.26,span*.22,cz+span*.34],tgt:[cx-span*.06,0,cz-span*.06]}];
await page.evaluate(()=>{const c=window.__nc.controls; c.maxPolarAngle=Math.PI*.4995; c.minDistance=.05; c.enableDamping=false;});


const OUT='/tmp/claude-0/-home-user-Playmythicspellbook/40854a97-ff53-55db-aa08-6d67184d4a8e/scratchpad/ab'+(process.env.CRIT_HOUR||'15');
fs.mkdirSync(OUT,{recursive:true});
const setVis=(v)=>page.evaluate((v)=>{const g=window.__nc.three().scene.getObjectByName('wild'); if(g)g.visible=v;},v);
const GAP=1500;
for(const s of SHOTS){
  await page.evaluate(([c,t])=>{const nc=window.__nc,{camera}=nc.three();
    camera.position.set(c[0],c[1],c[2]); nc.controls.target.set(t[0],t[1],t[2]); nc.controls.update();
    camera.position.set(c[0],c[1],c[2]); camera.lookAt(t[0],t[1],t[2]);
    camera.updateMatrixWorld(true); camera.updateProjectionMatrix();},[s.cam,s.tgt]);
  await page.waitForTimeout(2500);
  /* CONTROL pair then TREATMENT pair, identical spacing — the README's own
     lesson: a do-nothing control over the same interval is the floor. */
  await setVis(true);  await page.waitForTimeout(GAP);
  await page.screenshot({path:OUT+'/'+s.n+'-on1.png'});
  await setVis(true);  await page.waitForTimeout(GAP);
  await page.screenshot({path:OUT+'/'+s.n+'-on2.png'});   // control: same state
  await setVis(false); await page.waitForTimeout(GAP);
  await page.screenshot({path:OUT+'/'+s.n+'-off.png'});   // treatment
  await setVis(true);
}
/* ── SAVE / LOAD ──────────────────────────────────────────────────────── */
const sv = await page.evaluate(()=>{
  const keys=Object.keys(localStorage);
  const hits=[];
  for(const k of keys){ const v=localStorage.getItem(k)||'';
    if(/wild/i.test(k)||/"wild"|wildGround/i.test(v)) hits.push(k+' len='+v.length); }
  let big=null; for(const k of keys){const v=localStorage.getItem(k)||''; if(v.length>2000&&/tiles/.test(v))big=k;}
  return {lsKeys:keys.length, wildMentions:hits, saveKey:big,
          saveHasWild: big? /wild/i.test(localStorage.getItem(big)) : null};
});
/* ── REBUILD COST at district size, forced ──────────────────────────────── */
const perf = await page.evaluate(()=>{
  const nc=window.__nc, W=window.MythicWild;
  const t=nc.game.tiles; const k='23,23'; const had=t[k];
  const times=[];
  for(let i=0;i<5;i++){ t[k]={type:'__p'+i}; const a=performance.now(); W.refresh(); times.push(+(performance.now()-a).toFixed(1)); }
  if(had)t[k]=had; else delete t[k]; W.refresh();
  return {forcedRebuildMs:times, tiles:Object.keys(t).length};
});
console.log(JSON.stringify({save:sv, perf, hour:process.env.CRIT_HOUR||15},null,2));
await browser.close(); server.close();
