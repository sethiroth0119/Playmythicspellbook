/* DIAGNOSTIC: where are the agents, and do they reach the film?
   Boots the standard district, then for each of the three framings:
     - projects every agent's world position into NDC
     - renders twice (agentGroup visible / hidden) and DIFFS the two PNGs,
       which is the only honest measure of "pixels the crowd occupies". */
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
const ROOT=path.resolve(process.cwd(),'public'), THREE_='/home/user/Playmythicspellbook/.gauntlet/package';
const MIME={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css',
 '.json':'application/json','.png':'image/png','.jpg':'image/jpeg','.svg':'image/svg+xml',
 '.glb':'model/gltf-binary','.txt':'text/plain','.webp':'image/webp'};
const PORT=8700+(process.pid%90);
const server=http.createServer((req,res)=>{let p=decodeURIComponent(req.url.split('?')[0]);
 if(p.endsWith('/'))p+='index.html'; const f=path.join(ROOT,p);
 if(!f.startsWith(ROOT)||!fs.existsSync(f)||fs.statSync(f).isDirectory()){res.writeHead(404);return res.end('nf')}
 res.writeHead(200,{'Content-Type':MIME[path.extname(f)]||'application/octet-stream'});
 fs.createReadStream(f).pipe(res)});
await new Promise(r=>server.listen(PORT,'127.0.0.1',r));
const browser=await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
 args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist',
       '--no-sandbox','--disable-dev-shm-usage','--no-proxy-server'],
 env:Object.fromEntries(Object.entries(process.env).filter(([k])=>!/^(HTTPS?_PROXY|https?_proxy|ALL_PROXY|all_proxy)$/.test(k)))});
const page=await browser.newPage({viewport:{width:1600,height:900},deviceScaleFactor:1,ignoreHTTPSErrors:true});
await page.route('**/*',r=>{const u=r.request().url();
 (u.includes('127.0.0.1')||u.includes('localhost')||u.includes('jsdelivr'))?r.continue():r.abort()});
await page.route('**/cdn.jsdelivr.net/npm/three@0.171.0/**',r=>{
 const rel=new URL(r.request().url()).pathname.replace('/npm/three@0.171.0/','');
 const f=path.join(THREE_,rel);
 fs.existsSync(f)?r.fulfill({status:200,contentType:'text/javascript',body:fs.readFileSync(f)}):r.fulfill({status:404,body:'nf'})});
const PIN_HOUR=15;
await page.addInitScript(({hour})=>{const _D=Date;const now=new _D();const parts={};
 for(const p of new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}).formatToParts(now))parts[p.type]=p.value;
 const curH=(+parts.hour%24)+(+parts.minute)/60+(+parts.second)/3600; const shiftMs=(hour-curH)*3600*1000;
 class S extends _D{constructor(...a){if(a.length===0)super(_D.now()+shiftMs);else super(...a)}static now(){return _D.now()+shiftMs}}
 S.parse=_D.parse;S.UTC=_D.UTC;window.Date=S;},{hour:PIN_HOUR});
const logs=[]; page.on('console',m=>logs.push(`[${m.type()}] ${m.text()}`.slice(0,300)));
page.on('pageerror',e=>logs.push(`[pageerror] ${e.message}`.slice(0,300)));
await page.goto(`http://127.0.0.1:${PORT}/node-city/index.html`,{waitUntil:'load',timeout:120000});
await page.waitForTimeout(24000);
const built=await page.evaluate(fs.readFileSync(path.resolve(process.cwd(),'.gauntlet/scene.js'),'utf8'));
await page.waitForTimeout(4000);

const info = await page.evaluate(async ()=>{
  const nc=window.__nc, {scene,THREE}=nc.three();
  const snap=()=>nc.agents().map(a=>({k:a.kind,st:a.state,vis:a.mesh.visible,i:a.i,pl:a.path.length,
     x:+a.mesh.position.x.toFixed(3),z:+a.mesh.position.z.toFixed(3),dw:+(a.dwell||0).toFixed(2)}));
  const t0=snap();
  // does rAF actually fire in this pane?
  let rafFired=0; const stop=()=>{}; 
  const tick=()=>{rafFired++; if(rafFired<200) requestAnimationFrame(tick);};
  requestAnimationFrame(tick);
  await new Promise(r=>setTimeout(r,2000));
  const t1=snap();
  let moved=0; for(let i=0;i<t0.length;i++) if(t0[i].x!==t1[i].x||t0[i].z!==t1[i].z) moved++;
  const ep={}; for(const k of ['civilian','car','truck','police']){const e=nc.endpoints(k); ep[k]={from:e.from.length,to:e.to.length};}
  const roads=Object.values(nc.game.tiles).filter(t=>t.type==='road').length;
  const uniq=new Set(t1.map(a=>a.x+','+a.z));
  const invis=t1.filter(a=>!a.vis).length;
  // spatial extent
  const xs=t1.map(a=>a.x), zs=t1.map(a=>a.z);
  return {n:t1.length, rafFired, movedIn2s:moved, roads, ep, invisible:invis,
    uniquePos:uniq.size, xr:[Math.min(...xs),Math.max(...xs)], zr:[Math.min(...zs),Math.max(...zs)],
    states:t1.reduce((a,r)=>(a[r.st]=(a[r.st]||0)+1,a),{}),
    rows:t1};
});
console.log('AGENTS', JSON.stringify(info).slice(0,6000));

const frame = await page.evaluate(() => {
  const nc = window.__nc; const P=[]; const roads=[];
  for (const t of Object.values(nc.game.tiles)) { if(!t.mesh) continue;
    P.push([t.mesh.position.x,t.mesh.position.z]);
    if(t.type==='road') roads.push({x:t.mesh.position.x,z:t.mesh.position.z}); }
  const xs=P.map(p=>p[0]),zs=P.map(p=>p[1]);
  const box={x0:Math.min(...xs),x1:Math.max(...xs),z0:Math.min(...zs),z1:Math.max(...zs),n:P.length};
  const cx=(box.x0+box.x1)/2, cz=(box.z0+box.z1)/2;
  const rows={}; for(const r of roads)(rows[r.z.toFixed(2)]||=[]).push(r.x);
  let best=null; for(const z in rows){const xsr=rows[z].sort((a,b)=>a-b);
    const score=xsr.length-Math.abs(+z-cz); if(!best||score>best.score)best={z:+z,xs:xsr,score};}
  return {box,cx,cz,road:best};
});
const box=frame.box, cx=frame.cx, cz=frame.cz;
const span=Math.max(box.x1-box.x0, box.z1-box.z0);
const R=frame.road;
const street = R && R.xs.length>3 ? {cam:[R.xs[1],1.15,R.z],tgt:[R.xs[R.xs.length-2],1.05,R.z]}
                                  : {cam:[cx-span*.34,1.4,cz],tgt:[cx+span*.3,1.2,cz]};
const SHOTS=[
 {n:'aerial',cam:[cx+span*.62,span*.55,cz+span*.62],tgt:[cx,0,cz]},
 {n:'street',cam:street.cam,tgt:street.tgt},
 {n:'district',cam:[cx+span*.26,span*.22,cz+span*.34],tgt:[cx-span*.06,0,cz-span*.06]},
];
console.log('FRAME', JSON.stringify({box,span,road:{z:R&&R.z,n:R&&R.xs.length}}));
const out='/tmp/claude-0/-home-user-Playmythicspellbook/40854a97-ff53-55db-aa08-6d67184d4a8e/scratchpad/diag';
fs.mkdirSync(out,{recursive:true});
for(const s of SHOTS){
  const r=await page.evaluate(([c,t])=>{
    const nc=window.__nc,{renderer,scene,camera,THREE}=nc.three();
    camera.position.set(c[0],c[1],c[2]); nc.controls.target.set(t[0],t[1],t[2]); nc.controls.update();
    camera.updateMatrixWorld(); camera.updateProjectionMatrix();
    const v=new THREE.Vector3(); const bb=new THREE.Box3(); let onScreen=0; const px=[];
    for(const a of nc.agents()){
      a.mesh.getWorldPosition(v); const w=v.clone(); v.project(camera);
      if(v.x>=-1&&v.x<=1&&v.y>=-1&&v.y<=1&&v.z<=1){ onScreen++;
        bb.setFromObject(a.mesh); const sz=bb.getSize(new THREE.Vector3());
        const top=new THREE.Vector3(w.x,w.y+sz.y,w.z).project(camera);
        px.push({k:a.kind,sx:Math.round((v.x*.5+.5)*1600),sy:Math.round((-v.y*.5+.5)*900),
                 hpx:Math.round(Math.abs(top.y-v.y)*.5*900)});
      }
    }
    const dom=renderer.domElement, W=dom.width, H=dom.height;
    const cv=document.createElement('canvas'); cv.width=W; cv.height=H;
    const ctx=cv.getContext('2d',{willReadFrequently:true});
    const shot=()=>{ ctx.clearRect(0,0,W,H); ctx.drawImage(dom,0,0); return ctx.getImageData(0,0,W,H).data; };
    renderer.render(scene,camera); const A=shot();
    const vis=nc.agents().map(a=>a.mesh.visible);
    for(const a of nc.agents()) a.mesh.visible=false;
    renderer.render(scene,camera); const B=shot();
    nc.agents().forEach((a,i)=>a.mesh.visible=vis[i]);
    renderer.render(scene,camera);
    let diff=0; for(let i=0;i<A.length;i+=4){
      if(Math.abs(A[i]-B[i])+Math.abs(A[i+1]-B[i+1])+Math.abs(A[i+2]-B[i+2])>18) diff++; }
    return {onScreen,total:nc.agents().length,W,H,diffPx:diff,
            pct:+(diff/(W*H)*100).toFixed(3), sample:px.slice(0,40)};
  },[s.cam,s.tgt]);
  await page.waitForTimeout(600);
  await page.screenshot({path:path.join(out,s.n+'.png')});
  console.log('SHOT', s.n, JSON.stringify(r));
}
console.log('LOGS', JSON.stringify(logs.slice(-8),null,1));
await browser.close(); server.close();
