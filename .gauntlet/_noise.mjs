/* TEMP EXPERIMENT (problem 2): boot, build the standard scene, shoot the AERIAL
   framing twice over — once as the capture does, once with every moving thing
   hidden — then diff each against a previous run's pair.
   Usage: node .gauntlet/_noise.mjs <outDir> [--against <dir>] */
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
const ROOT=path.resolve(process.cwd(),'public'), THREE_='/home/user/Playmythicspellbook/.gauntlet/package';
const MIME={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.json':'application/json','.png':'image/png','.jpg':'image/jpeg','.svg':'image/svg+xml','.glb':'model/gltf-binary','.txt':'text/plain','.webp':'image/webp'};
const outDir=process.argv[2]; const PORT=8600+(process.pid%90);
const AGAINST=process.argv.includes('--against')?process.argv[process.argv.indexOf('--against')+1]:null;
const server=http.createServer((req,res)=>{let p=decodeURIComponent(req.url.split('?')[0]);
 if(p.endsWith('/'))p+='index.html'; const f=path.join(ROOT,p);
 if(!f.startsWith(ROOT)||!fs.existsSync(f)||fs.statSync(f).isDirectory()){res.writeHead(404);return res.end('nf')}
 res.writeHead(200,{'Content-Type':MIME[path.extname(f)]||'application/octet-stream'});
 fs.createReadStream(f).pipe(res)});
await new Promise(r=>server.listen(PORT,'127.0.0.1',r));
const browser=await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
 args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist','--no-sandbox','--disable-dev-shm-usage','--no-proxy-server'],
 env:Object.fromEntries(Object.entries(process.env).filter(([k])=>!/^(HTTPS?_PROXY|https?_proxy|ALL_PROXY|all_proxy)$/.test(k)))});
const page=await browser.newPage({viewport:{width:1600,height:900},deviceScaleFactor:1,ignoreHTTPSErrors:true});
page.on('dialog',d=>d.accept().catch(()=>{}));
await page.route('**/*',r=>{const u=r.request().url();
 (u.startsWith('data:')||u.includes('127.0.0.1')||u.includes('localhost')||u.includes('jsdelivr'))?r.continue():r.abort()});
await page.route('**/cdn.jsdelivr.net/npm/three@0.171.0/**',r=>{
 const rel=new URL(r.request().url()).pathname.replace('/npm/three@0.171.0/','');
 const f=path.join(THREE_,rel);
 fs.existsSync(f)?r.fulfill({status:200,contentType:'text/javascript',body:fs.readFileSync(f)}):r.fulfill({status:404,body:'nf'})});
await page.addInitScript(({hour})=>{const _D=Date;const now=new _D();const parts={};
  for(const p of new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}).formatToParts(now))parts[p.type]=p.value;
  const curH=(+parts.hour%24)+(+parts.minute)/60+(+parts.second)/3600;const shiftMs=(hour-curH)*3600*1000;
  class S extends _D{constructor(...a){if(a.length===0)super(_D.now()+shiftMs);else super(...a)}static now(){return _D.now()+shiftMs}}
  S.parse=_D.parse;S.UTC=_D.UTC;window.Date=S;},{hour:15});
await page.goto(`http://127.0.0.1:${PORT}/node-city/index.html`,{waitUntil:'load',timeout:120000});
await page.waitForTimeout(24000);
await page.evaluate(fs.readFileSync(path.resolve(process.cwd(),'.gauntlet/scene.js'),'utf8'));
await page.waitForTimeout(6000);
const frame=await page.evaluate(()=>{const nc=window.__nc;const P=[];
  for(const t of Object.values(nc.game.tiles)){if(!t.mesh)continue;P.push([t.mesh.position.x,t.mesh.position.z]);}
  const xs=P.map(p=>p[0]),zs=P.map(p=>p[1]);
  const box={x0:Math.min(...xs),x1:Math.max(...xs),z0:Math.min(...zs),z1:Math.max(...zs)};
  return{box,cx:(box.x0+box.x1)/2,cz:(box.z0+box.z1)/2}});
const span=Math.max(frame.box.x1-frame.box.x0,frame.box.z1-frame.box.z0);
const CAM=[frame.cx+span*.62,span*.55,frame.cz+span*.62], TGT=[frame.cx,0,frame.cz];
await page.evaluate(()=>{const c=window.__nc.controls;c.maxPolarAngle=Math.PI*.4995;c.minDistance=.05;c.enableDamping=false;});
fs.mkdirSync(outDir,{recursive:true});
async function shoot(name,pre){
  if(pre) await page.evaluate(pre);
  for(let i=0;i<2;i++){
    await page.evaluate(([c,t])=>{const nc=window.__nc;
      nc.camera.position.set(c[0],c[1],c[2]);nc.controls.target.set(t[0],t[1],t[2]);nc.controls.update();
      nc.camera.position.set(c[0],c[1],c[2]);nc.camera.lookAt(t[0],t[1],t[2]);
      nc.camera.updateMatrixWorld();nc.camera.updateProjectionMatrix();
      try{nc.cullAgents(90)}catch(e){}
      const{renderer,scene,camera}=nc.three();renderer.render(scene,camera);},[CAM,TGT]);
    if(!i) await page.waitForTimeout(1200);
  }
  await page.screenshot({path:path.join(outDir,name+'.png')});
}
await shoot('all',null);
/* CONTROLS, inside ONE boot: the same camera, the same scene, shot again
   immediately and again after a wait. Anything these two report is a floor the
   cross-boot number can never go below. */
await shoot('ctl_now',null);
await page.waitForTimeout(5000);
await shoot('ctl_5s',null);
/* hide everything that is not the built city: agents, parked fleet, crowd */
await shoot('static',()=>{const nc=window.__nc;
  for(const a of nc.agents()) a.mesh.visible=false;
  try{window.MythicParking.group().visible=false}catch(e){}
  try{window.MythicCrowd.group?window.MythicCrowd.group().visible=false:0}catch(e){}
  const {scene}=nc.three();
  scene.traverse(o=>{if(o.name==='crowd'||o.name==='parking')o.visible=false;});
});
const meta=await page.evaluate(()=>{const nc=window.__nc;const{scene}=nc.three();
  let sun=null;scene.traverse(o=>{if(o.isDirectionalLight&&!sun)sun={x:+o.position.x.toFixed(4),y:+o.position.y.toFixed(4),z:+o.position.z.toFixed(4),i:+o.intensity.toFixed(5)}});
  return{cityAge:nc.game.cityAge,sun,fog:scene.fog?scene.fog.color.getHexString():null,
         bg:scene.background&&scene.background.getHexString?scene.background.getHexString():null}});
let diffs=null;
if(AGAINST&&fs.existsSync(AGAINST)){
  diffs={};
  for(const n of ['all','static','ctl_now','ctl_5s']){
    const a=path.join(outDir,n+'.png'), b=path.join(AGAINST,n+'.png');
    if(!fs.existsSync(b)){diffs[n]='missing';continue}
    const ta=path.join(ROOT,'__na.png'),tb=path.join(ROOT,'__nb.png');
    fs.copyFileSync(a,ta);fs.copyFileSync(b,tb);
    diffs[n]=await page.evaluate(async([ua,ub])=>{
      const load=src=>new Promise(r=>{const i=new Image();i.onload=()=>r(i);i.onerror=()=>r(null);i.src=src});
      const[ia,ib]=await Promise.all([load(ua),load(ub)]);
      if(!ia||!ib)return'ERR load';
      const cv=document.createElement('canvas');cv.width=ia.width;cv.height=ia.height;
      const cx=cv.getContext('2d',{willReadFrequently:true});
      cx.drawImage(ia,0,0);const A=cx.getImageData(0,0,cv.width,cv.height).data;
      cx.clearRect(0,0,cv.width,cv.height);cx.drawImage(ib,0,0);const B=cx.getImageData(0,0,cv.width,cv.height).data;
      let d6=0,d20=0,d60=0,sum=0;const N=A.length/4;
      for(let i=0;i<A.length;i+=4){const m=Math.max(Math.abs(A[i]-B[i]),Math.abs(A[i+1]-B[i+1]),Math.abs(A[i+2]-B[i+2]));
        sum+=m; if(m>6)d6++; if(m>20)d20++; if(m>60)d60++;}
      return{pct6:+(100*d6/N).toFixed(2),pct20:+(100*d20/N).toFixed(2),pct60:+(100*d60/N).toFixed(2),meanDelta:+(sum/N).toFixed(3)};
    },[`http://127.0.0.1:${PORT}/__na.png`,`http://127.0.0.1:${PORT}/__nb.png`]);
    try{fs.unlinkSync(ta);fs.unlinkSync(tb)}catch(e){}
  }
}
/* the same-boot control, diffed HERE rather than against a previous run */
async function dpair(a,b){
  const ta=path.join(ROOT,'__na.png'),tb=path.join(ROOT,'__nb.png');
  fs.copyFileSync(a,ta);fs.copyFileSync(b,tb);
  const r=await page.evaluate(async([ua,ub])=>{
    const load=src=>new Promise(r=>{const i=new Image();i.onload=()=>r(i);i.onerror=()=>r(null);i.src=src});
    const[ia,ib]=await Promise.all([load(ua),load(ub)]);
    if(!ia||!ib)return'ERR load';
    const cv=document.createElement('canvas');cv.width=ia.width;cv.height=ia.height;
    const cx=cv.getContext('2d',{willReadFrequently:true});
    cx.drawImage(ia,0,0);const A=cx.getImageData(0,0,cv.width,cv.height).data;
    cx.clearRect(0,0,cv.width,cv.height);cx.drawImage(ib,0,0);const B=cx.getImageData(0,0,cv.width,cv.height).data;
    let d6=0,d20=0,d60=0,sum=0;const N=A.length/4;
    for(let i=0;i<A.length;i+=4){const m=Math.max(Math.abs(A[i]-B[i]),Math.abs(A[i+1]-B[i+1]),Math.abs(A[i+2]-B[i+2]));
      sum+=m;if(m>6)d6++;if(m>20)d20++;if(m>60)d60++;}
    return{pct6:+(100*d6/N).toFixed(2),pct20:+(100*d20/N).toFixed(2),pct60:+(100*d60/N).toFixed(2),meanDelta:+(sum/N).toFixed(3)};
  },[`http://127.0.0.1:${PORT}/__na.png`,`http://127.0.0.1:${PORT}/__nb.png`]);
  try{fs.unlinkSync(ta);fs.unlinkSync(tb)}catch(e){}
  return r;
}
const control={
  same_boot_immediate: await dpair(path.join(outDir,'all.png'),path.join(outDir,'ctl_now.png')),
  same_boot_5s:        await dpair(path.join(outDir,'all.png'),path.join(outDir,'ctl_5s.png')),
};
console.log(JSON.stringify({outDir,meta,control,diffs},null,1));
await browser.close();server.close();
