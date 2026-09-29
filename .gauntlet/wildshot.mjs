/* == THE WILD-GROUND PICTURE + TIMING PROBE ================================
   Three things the cost probe cannot answer, in one boot:

   1. WHAT THE LAYER IS WORTH IN THE PICTURE, AGAINST A DO-NOTHING CONTROL.
      The round-10 published figures (aerial 18.1%, district 14.0%) were the
      layer's on/off diff with NO control, and this scene's own frame-to-frame
      drift floor is 2-6pp. So every framing is shot THREE times at identical
      spacing: on, on again (nothing changed = the floor), then off. The net
      contribution is (on vs off) minus (on vs on).

   2. A 4x CROP OF THE DISTRICT FRAMING, on unbuilt land, DERIVED from the
      camera rather than typed - .gauntlet/README.md records a hardcoded crop
      drifting out of the picture the first time somebody moved a framing.

   3. WHAT A REBUILD COSTS, timed on the shipped refresh() path by changing
      the tile map the way laying one road changes it.

   Usage: node .gauntlet/wildshot.mjs <outdir>
   ========================================================================== */
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
import sharp from 'sharp';

const OUT = path.resolve(process.argv[2] || '.gauntlet/shots/wildshot');
fs.mkdirSync(OUT, { recursive: true });
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
const logs = []; page.on('console', m => logs.push(('[' + m.type() + '] ' + m.text()).slice(0, 300)));
page.on('pageerror', e => logs.push('[pageerror] ' + String(e.message).slice(0, 300)));
await page.goto('http://127.0.0.1:' + PORT + '/node-city/index.html', { waitUntil: 'load', timeout: 120000 });
await page.waitForTimeout(24000);
await page.evaluate(fs.readFileSync(path.resolve(process.cwd(), '.gauntlet/scene.js'), 'utf8'));
await page.waitForTimeout(4000);

const frame = await page.evaluate(() => {
  const nc = window.__nc; const P = []; const roads = [];
  for (const t of Object.values(nc.game.tiles)) { if (!t.mesh) continue;
    P.push([t.mesh.position.x, t.mesh.position.z]);
    if (t.type === 'road') roads.push({ x: t.mesh.position.x, z: t.mesh.position.z }); }
  const xs = P.map(p=>p[0]), zs = P.map(p=>p[1]);
  const box={x0:Math.min(...xs),x1:Math.max(...xs),z0:Math.min(...zs),z1:Math.max(...zs)};
  const cx=(box.x0+box.x1)/2, cz=(box.z0+box.z1)/2;
  const rows={}; for (const r of roads) (rows[r.z.toFixed(2)] ||= []).push(r.x);
  let best=null;
  for (const z in rows){ const xsr=rows[z].sort((a,b)=>a-b); let front=0;
    for (const t of Object.values(nc.game.tiles)){ if(!t.mesh||t.type==='road'||t.type==='anchor')continue;
      const d=Math.abs(t.mesh.position.z-+z); if(d<1.01&&d>.5)front++; }
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

const setCam = ([c,t]) => page.evaluate(([c,t])=>{
  const nc=window.__nc, {camera}=nc.three();
  camera.position.set(c[0],c[1],c[2]); nc.controls.target.set(t[0],t[1],t[2]); nc.controls.update();
  camera.position.set(c[0],c[1],c[2]); camera.lookAt(t[0],t[1],t[2]);
  camera.updateMatrixWorld(true); camera.updateProjectionMatrix();
},[c,t]);
const setWild = v => page.evaluate((v)=>{const g=window.__nc.three().scene.getObjectByName('wild'); if(g)g.visible=v;},v);

const report=[];
for(const s of SHOTS){
  await setCam([s.cam,s.tgt]);
  await page.waitForTimeout(1200);
  await setWild(true);  await page.waitForTimeout(900);
  await page.screenshot({path:OUT+'/'+s.n+'-on.png'});
  /* THE CONTROL: identical spacing, identical everything. */
  await page.waitForTimeout(900);
  await page.screenshot({path:OUT+'/'+s.n+'-on2.png'});
  await setWild(false); await page.waitForTimeout(900);
  await page.screenshot({path:OUT+'/'+s.n+'-off.png'});
  await setWild(true);
  report.push({shot:s.n});
}

/* ── the 4x crop, DERIVED: the densest on-screen block of UNBUILT tiles in the
      district framing, projected through the camera that just rendered it. */
await setCam([SHOTS[2].cam,SHOTS[2].tgt]);
await page.waitForTimeout(900);
const crop = await page.evaluate(() => {
  const nc=window.__nc, {camera}=nc.three();
  const occ=new Set(Object.keys(nc.game.tiles));
  const GRID=24, HALF=12, W=1600, H=900;
  const proj=(x,y,z)=>{ const m=camera.matrixWorldInverse.elements, p=camera.projectionMatrix.elements;
    const ex=m[0]*x+m[4]*y+m[8]*z+m[12], ey=m[1]*x+m[5]*y+m[9]*z+m[13], ez=m[2]*x+m[6]*y+m[10]*z+m[14];
    const px=p[0]*ex+p[4]*ey+p[8]*ez+p[12], py=p[1]*ex+p[5]*ey+p[9]*ez+p[13], pw=p[3]*ex+p[7]*ey+p[11]*ez+p[15];
    if(pw<=0)return null; return [(px/pw*.5+.5)*W,(1-(py/pw*.5+.5))*H]; };
  let best=null;
  for(let gx=1;gx<GRID-2;gx++)for(let gz=1;gz<GRID-2;gz++){
    let ok=true, sx=0, sz=0, n=0;
    for(let a=0;a<2;a++)for(let b=0;b<2;b++){
      const k=(gx+a)+','+(gz+b); if(occ.has(k)){ok=false;}
      const q=proj(gx+a-HALF+.5,0,gz+b-HALF+.5); if(!q){ok=false;continue;}
      sx+=q[0]; sz+=q[1]; n++;
    }
    if(!ok||!n)continue;
    const mx=sx/n, my=sz/n;
    if(mx<210||mx>1050||my<220||my>720)continue;   // clear of the UI panel and HUD
    // prefer blocks near the middle of the usable area, i.e. biggest on screen
    const sc=-Math.abs(mx-620)-Math.abs(my-470);
    if(!best||sc>best.sc)best={sc,mx,my,gx,gz};
  }
  return best;
});
if (crop) {
  const w=400,h=225;
  const left=Math.max(0,Math.min(1600-w,Math.round(crop.mx-w/2)));
  const top =Math.max(0,Math.min(900-h,Math.round(crop.my-h/2)));
  crop.box={left,top,w,h};
  for(const v of ['on','off']){
    await setWild(v==='on'); await page.waitForTimeout(900);
    await page.screenshot({path:OUT+'/_full-'+v+'.png'});
    await sharp(OUT+'/_full-'+v+'.png').extract({left,top,width:w,height:h})
      .resize({width:w*4,kernel:'nearest'}).png().toFile(OUT+'/crop4x-'+v+'.png');
  }
  await setWild(true);
}

/* ── rebuild timing on the shipped refresh() path ─────────────────────── */
const timing = await page.evaluate(() => {
  const nc=window.__nc, W=window.MythicWild; if(!W) return null;
  const ms=[]; const K='0,0'; const had=nc.game.tiles[K];
  for(let i=0;i<6;i++){
    if(i%2===0) nc.game.tiles[K]={type:'road'}; else { if(had) nc.game.tiles[K]=had; else delete nc.game.tiles[K]; }
    const t0=performance.now(); W.refresh(); ms.push(+(performance.now()-t0).toFixed(1));
  }
  if(had) nc.game.tiles[K]=had; else delete nc.game.tiles[K];
  W.refresh();
  let v=null; try{ v = W.verify ? W.verify() : 'no verify()'; }catch(e){ v='threw: '+e.message; }
  return { rebuildMs: ms, stats: W.stats(), verify: v };
});

/* ── the cost A/B, same as wildcost.mjs, so one boot answers everything ── */
const cost = await page.evaluate(() => {
  const nc=window.__nc, {renderer,scene,camera}=nc.three();
  const g=scene.getObjectByName('wild');
  const vis=o=>{let p=o;while(p){if(!p.visible)return false;p=p.parent;}return true;};
  const read=()=>{renderer.info.reset(); renderer.render(scene,camera);
    let m=0; scene.traverse(o=>{if(o.isMesh&&vis(o))m++;});
    return {meshes:m,calls:renderer.info.render.calls,tris:renderer.info.render.triangles};};
  const on=read(); if(g)g.visible=false; const off=read(); if(g)g.visible=true;
  return {on,off,delta:{meshes:on.meshes-off.meshes,calls:on.calls-off.calls,tris:on.tris-off.tris}};
});

await browser.close(); server.close();

/* ── and the diff, against the control, in the same run ─────────────────
   ⚠ THE FLOOR IS NOT A CONSTANT. On the street framing it runs above 10% on
     its own — traffic and pedestrians move between two frames 900ms apart and
     they cover most of that picture. A net figure computed under a floor that
     large is not evidence either way, which is the whole reason the floor is
     printed beside it instead of being subtracted quietly. */
const raw = async f => sharp(OUT+'/'+f).raw().toBuffer({resolveWithObject:true});
const cmp = (a,b) => { const W=a.info.width,H=a.info.height,C=a.info.channels; let ch=0,tot=0;
  for(let y=0;y<H;y++)for(let x=0;x<W;x++){ const i=(y*W+x)*C;
    if((x>1265&&y>370&&y<845)||y<115||y>845) continue;   // the UI panel and the HUD bands
    const d=Math.abs(a.data[i]-b.data[i])+Math.abs(a.data[i+1]-b.data[i+1])+Math.abs(a.data[i+2]-b.data[i+2]);
    tot++; if(d>12)ch++; }
  return 100*ch/tot; };
const diff=[];
for(const s of ['aerial','street','district']){
  const on=await raw(s+'-on.png'), on2=await raw(s+'-on2.png'), off=await raw(s+'-off.png');
  const floor=cmp(on,on2), net=cmp(on,off);
  diff.push({shot:s, driftFloor:+floor.toFixed(2), onVsOff:+net.toFixed(2),
             netContribution:+(net-floor).toFixed(2)});
}
console.log(JSON.stringify({ out:OUT, crop, timing, cost, diff,
  logs: logs.filter(l=>/Wild|error|Error|FAIL/.test(l)).slice(-10) }, null, 2));
