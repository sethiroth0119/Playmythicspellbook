/* Multi-shot capture: boots the city, builds the standard district, then
   takes N framed shots. One browser boot for all shots (boot is ~25 s).
   Usage: node .gauntlet/capture.mjs <outDir> [--tag name] */
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';

/* cwd-relative so a builder can run this inside its own git worktree.
   THREE_ stays absolute: the vendored tarball is gitignored and therefore
   absent from every worktree. */
const ROOT=path.resolve(process.cwd(),'public'), THREE_='/home/user/Playmythicspellbook/.gauntlet/package';
const MIME={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css',
 '.json':'application/json','.png':'image/png','.jpg':'image/jpeg','.svg':'image/svg+xml',
 '.glb':'model/gltf-binary','.txt':'text/plain','.webp':'image/webp'};
const arg=(f,d)=>{const i=process.argv.indexOf(f);return i>0?process.argv[i+1]:d};
const outDir=process.argv[2]||'.gauntlet/shots'; const TAG=arg('--tag','shot');
const PORT=8600+(process.pid%90);
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
 fs.existsSync(f)?r.fulfill({status:200,contentType:'text/javascript',body:fs.readFileSync(f)})
                 :r.fulfill({status:404,body:'nf'})});
const logs=[]; page.on('console',m=>logs.push(`[${m.type()}] ${m.text()}`.slice(0,300)));
page.on('pageerror',e=>logs.push(`[pageerror] ${e.message}`.slice(0,300)));

await page.goto(`http://127.0.0.1:${PORT}/node-city/index.html`,{waitUntil:'load',timeout:120000});
await page.waitForTimeout(24000);
const built=await page.evaluate(fs.readFileSync(path.resolve(process.cwd(),'.gauntlet/scene.js'),'utf8'));
await page.waitForTimeout(6000);

/* ── FRAMINGS, DERIVED FROM THE ACTUAL MESHES ──────────────────────────────
   Hardcoded camera coords were pointing at empty ground: placeMeshAt owns the
   tile→world mapping and it is not the identity, so the only honest way to
   frame the district is to read the bounding box of what got placed. Three
   shots that mirror the CS2 reference set: a low aerial over the whole
   district, an eye-level street view, and a mid aerial over one block. */
const box = await page.evaluate(() => {
  const nc = window.__nc; const P = [];
  for (const t of Object.values(nc.game.tiles)) if (t.mesh) P.push([t.mesh.position.x, t.mesh.position.z]);
  if (!P.length) return null;
  const xs = P.map(p=>p[0]), zs = P.map(p=>p[1]);
  return { x0:Math.min(...xs), x1:Math.max(...xs), z0:Math.min(...zs), z1:Math.max(...zs), n:P.length };
});
const cx = box ? (box.x0+box.x1)/2 : 0, cz = box ? (box.z0+box.z1)/2 : 0;
const span = box ? Math.max(box.x1-box.x0, box.z1-box.z0) : 20;
const SHOTS=[
 {n:'aerial',   cam:[cx+span*.62, span*.55, cz+span*.62], tgt:[cx,0,cz]},
 {n:'street',   cam:[cx-span*.20, 1.9, cz-span*.02],      tgt:[cx-span*.02, 1.0, cz-span*.22]},
 {n:'district', cam:[cx+span*.26, span*.22, cz+span*.34], tgt:[cx-span*.06,0,cz-span*.06]},
];
fs.mkdirSync(outDir,{recursive:true});
const made=[];
for(const s of SHOTS){
  await page.evaluate(([c,t])=>{const nc=window.__nc;
    nc.camera.position.set(c[0],c[1],c[2]); nc.controls.target.set(t[0],t[1],t[2]);
    nc.controls.update(); const {renderer,scene,camera}=nc.three(); renderer.render(scene,camera);
  },[s.cam,s.tgt]);
  await page.waitForTimeout(1500);
  const f=path.join(outDir,`${TAG}-${s.n}.png`);
  await page.screenshot({path:f}); made.push(f);
  /* A committable twin. Full PNGs are ~1.5 MB each and the loop makes three a
     round, so the RECORD that goes in git (and into the progress page) is the
     jpeg; the png stays local for pixel-level critique. */
  await page.screenshot({path:path.join(outDir,`${TAG}-${s.n}.jpg`),type:'jpeg',quality:72});
}
const diag=await page.evaluate(()=>{const{renderer,scene}=window.__nc.three();
  let m=0;scene.traverse(o=>{if(o.isMesh)m++});
  return{meshes:m,geoms:renderer.info.memory.geometries,tris:renderer.info.render.triangles}});
console.log(JSON.stringify({built,box,made,diag,logs:logs.slice(-10)},null,2));
await browser.close(); server.close();
