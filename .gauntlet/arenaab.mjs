/* HOW MUCH OF THE `venue` FRAME IS THE ARENA — one boot, one camera, the tile's
   mesh flipped, render and pixel read IN THE SAME TASK (README item 6), with
   the do-nothing control printed beside it. The control must be exactly 0; a
   non-zero control means the sim stepped between the two renders and the
   figure is worthless.
   ⚠ THIS IS NOT A ROUND-OVER-ROUND DELTA. It measures how much of the picture
     the building occupies in THIS build. Cross-boot per-framing percentages are
     retired (README) and nothing here revives them. */
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
const ROOT=path.resolve(process.cwd(),'public'), THREE_='/home/user/Playmythicspellbook/.gauntlet/package';
const MIME={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css',
 '.json':'application/json','.png':'image/png','.jpg':'image/jpeg','.svg':'image/svg+xml',
 '.glb':'model/gltf-binary','.txt':'text/plain','.webp':'image/webp'};
const PORT=8900+(process.pid%90);
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
const page=await browser.newPage({viewport:{width:1600,height:900},deviceScaleFactor:1});
await page.route('**/*',r=>{const u=r.request().url();
 (u.startsWith('data:')||u.includes('127.0.0.1')||u.includes('localhost')||u.includes('jsdelivr'))?r.continue():r.abort()});
await page.route('**/cdn.jsdelivr.net/npm/three@0.171.0/**',r=>{
 const rel=new URL(r.request().url()).pathname.replace('/npm/three@0.171.0/','');
 const f=path.join(THREE_,rel);
 fs.existsSync(f)?r.fulfill({status:200,contentType:'text/javascript',body:fs.readFileSync(f)})
                 :r.fulfill({status:404,body:'nf'})});
await page.goto(`http://127.0.0.1:${PORT}/node-city/index.html`,{waitUntil:'load',timeout:120000});
await page.waitForTimeout(24000);
await page.evaluate(fs.readFileSync(path.resolve(process.cwd(),'.gauntlet/scene.js'),'utf8'));
await page.waitForTimeout(4000);
const out=await page.evaluate(()=>{
  const nc=window.__nc,{renderer,scene,camera,THREE}=nc.three();
  const t=Object.values(nc.game.tiles).find(q=>q.type==='arena'&&q.mesh);
  const a=Math.atan2(0,1);
  const V={x:t.mesh.position.x,z:t.mesh.position.z};
  nc.controls.maxPolarAngle=Math.PI*.4995; nc.controls.minDistance=.05; nc.controls.enableDamping=false;
  const cam=[V.x+1.45,1.30,V.z+2.35], tgt=[V.x,.26,V.z];
  camera.position.set(cam[0],cam[1],cam[2]); nc.controls.target.set(tgt[0],tgt[1],tgt[2]);
  camera.lookAt(tgt[0],tgt[1],tgt[2]);
  camera.updateMatrixWorld(); camera.updateProjectionMatrix();
  try{nc.cullAgents(90);}catch(e){}
  const gl=renderer.domElement,CW=gl.width,CH=gl.height;
  const s=document.createElement('canvas');s.width=CW;s.height=CH;
  const c=s.getContext('2d',{willReadFrequently:true});
  const shoot=()=>{renderer.render(scene,camera);c.clearRect(0,0,CW,CH);c.drawImage(gl,0,0,CW,CH);
    return c.getImageData(0,0,CW,CH).data;};
  const diff=(A,B)=>{let n=0;for(let i=0;i<A.length;i+=4){
    if(Math.abs(A[i]-B[i])+Math.abs(A[i+1]-B[i+1])+Math.abs(A[i+2]-B[i+2])>18)n++;}return n;};
  t.mesh.visible=true;  const A=shoot();
  t.mesh.visible=false; const B=shoot();
  const C=shoot();      // control: B vs C must be exactly 0
  t.mesh.visible=true;
  const px=CW*CH;
  return {pixels:px, arenaPixels:diff(A,B), pct:+(diff(A,B)/px*100).toFixed(3),
          control:diff(B,C), controlPct:+(diff(B,C)/px*100).toFixed(3)};
});
console.log(JSON.stringify(out,null,2));
await browser.close(); server.close();
