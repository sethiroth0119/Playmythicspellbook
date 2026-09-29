/* ovl-probe3 — is page.screenshot() a valid instrument for a driven render?
   Panel is CLOSED throughout, so /src/landvalue's 2.5 s refresh interval can
   never re-show the plane behind the test's back (refresh() is gated on
   Panel.isOpen()); the plane is flipped by hand and the canvas keeps the paint
   the one open/close put there. */
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
const ROOT='/home/user/Playmythicspellbook/public', THREE_='/home/user/Playmythicspellbook/.gauntlet/package';
const OUT='/home/user/Playmythicspellbook/.gauntlet/shots/ovl3';
const MIME={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.json':'application/json','.png':'image/png','.jpg':'image/jpeg','.svg':'image/svg+xml','.glb':'model/gltf-binary','.txt':'text/plain','.webp':'image/webp'};
const PORT=8700+(process.pid%90), W=1600, H=900;
const server=http.createServer((req,res)=>{let p=decodeURIComponent(req.url.split('?')[0]); if(p.endsWith('/'))p+='index.html';
  const f=path.join(ROOT,p); if(!f.startsWith(ROOT)||!fs.existsSync(f)||fs.statSync(f).isDirectory()){res.writeHead(404);return res.end('nf');}
  res.writeHead(200,{'Content-Type':MIME[path.extname(f)]||'application/octet-stream'}); fs.createReadStream(f).pipe(res);});
await new Promise(r=>server.listen(PORT,'127.0.0.1',r));
const browser=await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist','--no-sandbox','--disable-dev-shm-usage','--no-proxy-server'],
  env:Object.fromEntries(Object.entries(process.env).filter(([k])=>!/^(HTTPS?_PROXY|https?_proxy|ALL_PROXY|all_proxy)$/.test(k)))});
const page=await browser.newPage({viewport:{width:W,height:H},deviceScaleFactor:1,ignoreHTTPSErrors:true});
await page.route('**/*',r=>{const u=r.request().url(); if(u.includes('127.0.0.1')||u.includes('localhost')||u.includes('jsdelivr'))return r.continue(); r.abort();});
await page.route('**/cdn.jsdelivr.net/npm/three@0.171.0/**',r=>{const u=new URL(r.request().url());
  const f=path.join(THREE_,u.pathname.replace('/npm/three@0.171.0/','')); if(!fs.existsSync(f))return r.fulfill({status:404,body:'nf'});
  r.fulfill({status:200,contentType:'text/javascript',body:fs.readFileSync(f)});});
await page.addInitScript(({hour})=>{const _D=Date;const parts={};
  for(const p of new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}).formatToParts(new _D()))parts[p.type]=p.value;
  const curH=(+parts.hour%24)+(+parts.minute)/60+(+parts.second)/3600; const shiftMs=(hour-curH)*3600*1000;
  class S extends _D{constructor(...a){if(a.length===0)super(_D.now()+shiftMs);else super(...a);} static now(){return _D.now()+shiftMs;}}
  S.parse=_D.parse;S.UTC=_D.UTC;window.Date=S;},{hour:15});
await page.goto(`http://127.0.0.1:${PORT}/node-city/index.html`,{waitUntil:'load',timeout:120000});
await page.waitForTimeout(20000);
await page.evaluate(fs.readFileSync('/home/user/Playmythicspellbook/.gauntlet/scene.js','utf8'));
await page.waitForTimeout(4000);
fs.mkdirSync(OUT,{recursive:true});

const setup = await page.evaluate(()=>{
  const nc=window.__nc, {renderer,scene,camera,THREE}=nc.three();
  const box={x0:1e9,x1:-1e9,z0:1e9,z1:-1e9};
  for(const t of Object.values(nc.game.tiles)){if(!t.mesh)continue;const p=t.mesh.position;
    box.x0=Math.min(box.x0,p.x);box.x1=Math.max(box.x1,p.x);box.z0=Math.min(box.z0,p.z);box.z1=Math.max(box.z1,p.z);}
  const cx=(box.x0+box.x1)/2, cz=(box.z0+box.z1)/2, span=Math.max(box.x1-box.x0,box.z1-box.z0);
  const c=nc.controls; c.maxPolarAngle=Math.PI*.4995; c.minDistance=.05; c.enableDamping=false;
  camera.position.set(cx+span*.62,span*.55,cz+span*.62); c.target.set(cx,0,cz); camera.lookAt(cx,0,cz);
  camera.updateMatrixWorld(); camera.updateProjectionMatrix();
  try{nc.cullAgents(90);}catch(e){}
  // paint the overlay canvas, then close the panel so nothing re-shows the plane
  nc.landValuePanel(true); nc.landValuePanel(false);
  window.__lvPlane=null;
  scene.traverse(o=>{if(o.isMesh&&o.material&&o.material.map&&o.geometry&&o.geometry.type==='PlaneGeometry'
    &&Math.abs(o.rotation.x+Math.PI/2)<.01&&Math.abs(o.position.y-0.105)<1e-3) window.__lvPlane=o;});
  window.__lv=(on)=>{window.__lvPlane.visible=on;};
  window.__render=()=>{renderer.render(scene,camera);};
  const HALF=12,v=new THREE.Vector3();
  const proj=(tx,tz)=>{v.set(tx-HALF+.5,0.105,tz-HALF+.5).project(camera);
    return{x:Math.round((v.x*.5+.5)*renderer.domElement.width),y:Math.round((-v.y*.5+.5)*renderer.domElement.height)};};
  let x0=1e9,x1=-1e9,y0=1e9,y1=-1e9;
  for(let tz=3;tz<21;tz++)for(let tx=3;tx<21;tx++){const p=proj(tx,tz);
    x0=Math.min(x0,p.x);x1=Math.max(x1,p.x);y0=Math.min(y0,p.y);y1=Math.max(y1,p.y);}
  window.__render();
  return {found:!!window.__lvPlane, rect:{x0:Math.max(0,x0-8),x1:Math.min(1600,x1+8),y0:Math.max(0,y0-8),y1:Math.min(900,y1+8)}};
});
console.log('SETUP '+JSON.stringify(setup));
const R=setup.rect, clip={x:R.x0,y:R.y0,width:R.x1-R.x0,height:R.y1-R.y0};
const set=async on=>page.evaluate(o=>window.__lv(o),on);
const rend=async ()=>page.evaluate(()=>window.__render());
const shot=async n=>page.screenshot({path:path.join(OUT,n+'.png'),clip});

// A) naive: flip, wait, shutter. no render driven.
await set(true);  await page.waitForTimeout(1500); await shot('A-naive-on');
await set(false); await page.waitForTimeout(1500); await shot('A-naive-off');
// B) driven: flip, render, shutter immediately
await set(true);  await rend(); await shot('B-driven-on');
await set(false); await rend(); await shot('B-driven-off');
// C) driven + settle: flip, render, 700ms, render, shutter
await set(true);  await rend(); await page.waitForTimeout(700); await rend(); await shot('C-settle-on');
await set(false); await rend(); await page.waitForTimeout(700); await rend(); await shot('C-settle-off');
// D) the instrument's own sanity check: hide EVERY mesh, render, shutter.
await page.evaluate(()=>{const {scene}=window.__nc.three(); window.__hid=[];
  scene.traverse(o=>{if(o.isMesh&&o.visible){window.__hid.push(o);o.visible=false;}}); window.__render();});
await shot('D-allhidden');
await page.evaluate(()=>{for(const o of window.__hid)o.visible=true; window.__render();});
await shot('D-restored');
console.log('done');
await browser.close(); server.close();
