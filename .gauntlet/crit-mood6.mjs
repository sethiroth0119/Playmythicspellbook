/* CRIT-MOOD6 — does the badge REACT to a placement, in pixels, same session?
   Not "the reason string changed" — the glyph over the house must actually be a
   different picture after a road is laid beside it. Same camera, same layer
   state, agents culled; the only thing that moves between the two shots is the
   city. A do-nothing control shot is taken first so a drifting frame announces
   itself. */
import { chromium } from 'playwright';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
const ROOT = path.resolve(process.cwd(), 'public');
const THREE_DIR = path.resolve(process.cwd(), '.gauntlet/three171');
const MIME = { '.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.json':'application/json','.png':'image/png','.jpg':'image/jpeg','.svg':'image/svg+xml','.glb':'model/gltf-binary','.txt':'text/plain','.webp':'image/webp' };
const PORT = 8520 + (process.pid % 30);
const server = http.createServer((req,res)=>{ let p=decodeURIComponent(req.url.split('?')[0]); if(p.endsWith('/'))p+='index.html';
  const f=path.join(ROOT,p); if(!f.startsWith(ROOT)||!fs.existsSync(f)||fs.statSync(f).isDirectory()){res.writeHead(404);return res.end('nf');}
  res.writeHead(200,{'Content-Type':MIME[path.extname(f)]||'application/octet-stream'}); fs.createReadStream(f).pipe(res); });
await new Promise(r=>server.listen(PORT,'127.0.0.1',r));
const browser = await chromium.launch({ args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist','--no-sandbox','--disable-dev-shm-usage'] });
const page = await browser.newPage({ viewport:{width:1280,height:800} });
await page.route('**/*', route => { const u=route.request().url();
  if(u.includes('cdn.jsdelivr.net')&&u.includes('three@')){ const rel=new URL(u).pathname.replace(/^\/npm\/three@[^/]+\//,''); const f=path.join(THREE_DIR,rel);
    return fs.existsSync(f)?route.fulfill({status:200,contentType:'text/javascript',body:fs.readFileSync(f)}):route.fulfill({status:404,body:'no'}); }
  if(u.includes('127.0.0.1')||u.includes('localhost'))return route.continue(); return route.abort(); });
await page.goto(`http://127.0.0.1:${PORT}/node-city/index.html`,{waitUntil:'domcontentloaded',timeout:120000});
await page.waitForFunction('!!window.__nc',null,{timeout:60000}).catch(()=>{});
await page.waitForTimeout(14000);

const H = { x: 10, z: 10 };
await page.evaluate(async (H) => {
  const nc = window.__nc, B = window.MythicCityBridge;
  B.spendCinders=async()=>true; B.spendRes=async()=>true; B.getCinders=async()=>9e9; B.getRes=async()=>9e9; B.addCinders=async()=>true;
  await nc.place('housing', H.x, H.z);
  for (let i=0;i<3;i++){ try{nc.build.finishAll();}catch(e){} await new Promise(r=>setTimeout(r,150)); }
  const { camera } = nc.three();
  camera.position.set(14,15,14); camera.lookAt(0,0.6,0);
  camera.updateMatrixWorld(true); camera.updateProjectionMatrix();
  try { nc.cullAgents(90); } catch(e){}
  window.MythicPlotIcons.show(); window.MythicPlotIcons.sync();
}, H);
await page.waitForTimeout(1500);

const before = await page.evaluate((H) => {
  const nc = window.__nc, { renderer, scene, camera, THREE } = nc.three();
  try { nc.cullAgents(90); } catch(e){}
  const gl = renderer.domElement, CW=gl.width, CH=gl.height;
  const s=document.createElement('canvas'); s.width=CW; s.height=CH;
  const c2=s.getContext('2d',{willReadFrequently:true});
  const shoot=()=>{ renderer.render(scene,camera); c2.clearRect(0,0,CW,CH); c2.drawImage(gl,0,0,CW,CH); return c2.getImageData(0,0,CW,CH).data; };
  const a = nc.plotIconAnchor(H.x,H.z);
  const v = new THREE.Vector3(a.x,a.y,a.z).project(camera);
  const box = { x0: Math.round((v.x*.5+.5)*CW)-70, y0: Math.round((-v.y*.5+.5)*CH)-50,
                x1: Math.round((v.x*.5+.5)*CW)+70, y1: Math.round((-v.y*.5+.5)*CH)+50 };
  const A = shoot(); const A2 = shoot();      // do-nothing control, same task
  window.__critBox = box; window.__critA = Array.from(A);
  let drift=0; for(let y=box.y0;y<box.y1;y++)for(let x=box.x0;x<box.x1;x++){ const i=(y*CW+x)*4;
    if(Math.abs(A[i]-A2[i])>6||Math.abs(A[i+1]-A2[i+1])>6||Math.abs(A[i+2]-A2[i+2])>6) drift++; }
  return { box, drift, reason: (nc.plotIcons().drawn.find(d=>d.x===H.x&&d.z===H.z)||{}).reason,
           glyph: (nc.plotIcons().drawn.find(d=>d.x===H.x&&d.z===H.z)||{}).glyph, CW, CH };
}, H);
console.log('before: reason=' + before.reason + ' glyph=' + before.glyph + '  do-nothing drift in the crop: ' + before.drift + ' px (must be 0)');

const after = await page.evaluate(async (H) => {
  const nc = window.__nc;
  for (let z = H.z-1; z <= H.z+3; z++) await nc.place('road', H.x+1, z);
  for (let i=0;i<3;i++){ try{nc.build.finishAll();}catch(e){} await new Promise(r=>setTimeout(r,150)); }
  await new Promise(r=>setTimeout(r,900));
  window.MythicPlotIcons.sync();
  const { renderer, scene, camera } = nc.three();
  try { nc.cullAgents(90); } catch(e){}
  const gl = renderer.domElement, CW=gl.width, CH=gl.height;
  const s=document.createElement('canvas'); s.width=CW; s.height=CH;
  const c2=s.getContext('2d',{willReadFrequently:true});
  renderer.render(scene,camera); c2.clearRect(0,0,CW,CH); c2.drawImage(gl,0,0,CW,CH);
  const B = c2.getImageData(0,0,CW,CH).data;
  const A = window.__critA, box = window.__critBox;
  let n=0,tot=0; for(let y=box.y0;y<box.y1;y++)for(let x=box.x0;x<box.x1;x++){ const i=(y*CW+x)*4; tot++;
    if(Math.abs(A[i]-B[i])>6||Math.abs(A[i+1]-B[i+1])>6||Math.abs(A[i+2]-B[i+2])>6) n++; }
  const d = nc.plotIcons().drawn.find(o=>o.x===H.x&&o.z===H.z) || null;
  return { pct:+(100*n/tot).toFixed(2), n, reason: d?d.reason:null, glyph: d?d.glyph:null };
}, H);
console.log('after road: reason=' + after.reason + ' glyph=' + after.glyph + '  the crop over the house changed ' + after.pct + '% (' + after.n + ' px)');
console.log(before.glyph !== after.glyph ? 'GLYPH CHANGED: ' + before.glyph + ' -> ' + after.glyph : 'GLYPH UNCHANGED (' + before.glyph + ')');
await browser.close(); server.close();
