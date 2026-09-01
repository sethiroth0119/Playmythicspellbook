import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
const ROOT='/home/user/Playmythicspellbook/public', THREE_='/home/user/Playmythicspellbook/.gauntlet/package';
const OUT='/home/user/Playmythicspellbook/.gauntlet/shots/ovl2';
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
const logs=[]; page.on('console',m=>logs.push(`[${m.type()}] ${m.text()}`.slice(0,200)));
page.on('pageerror',e=>logs.push(`[pageerror] ${e.message}`.slice(0,200)));
await page.goto(`http://127.0.0.1:${PORT}/node-city/index.html`,{waitUntil:'load',timeout:120000});
await page.waitForTimeout(20000);
await page.evaluate(fs.readFileSync('/home/user/Playmythicspellbook/.gauntlet/scene.js','utf8'));
await page.waitForTimeout(4000);
fs.mkdirSync(OUT,{recursive:true});
const res=await page.evaluate(fs.readFileSync('/home/user/Playmythicspellbook/.gauntlet/ovl-driver2.js','utf8'));
for(const [k,v] of Object.entries(res.images||{})) fs.writeFileSync(path.join(OUT,k+'.png'),Buffer.from(v.split(',')[1],'base64'));
delete res.images;

/* ── the NAIVE instrument, the one the next agent will reach for: flip the
   plane, wait, page.screenshot(). No render() driven by the driver. ───────── */
const rect = res.rects.district;
const clip = {x:rect.x0,y:rect.y0,width:rect.x1-rect.x0,height:rect.y1-rect.y0};
async function setLV(on){ await page.evaluate((on)=>{const {scene}=window.__nc.three();
  scene.traverse(o=>{ if(o.isMesh&&o.material&&o.material.map&&o.geometry&&o.geometry.type==='PlaneGeometry'
    && Math.abs(o.rotation.x+Math.PI/2)<.01 && Math.abs(o.position.y-0.105)<1e-3) o.visible=on; }); }, on); }
await setLV(true);  await page.waitForTimeout(1500); await page.screenshot({path:path.join(OUT,'naive-on.png'),clip});
await setLV(false); await page.waitForTimeout(1500); await page.screenshot({path:path.join(OUT,'naive-off.png'),clip});
/* same again but with a render() driven between flip and shutter */
await setLV(true);
await page.evaluate(()=>{const{renderer,scene,camera}=window.__nc.three();renderer.render(scene,camera);});
await page.screenshot({path:path.join(OUT,'driven-on.png'),clip});
await setLV(false);
await page.evaluate(()=>{const{renderer,scene,camera}=window.__nc.three();renderer.render(scene,camera);});
await page.screenshot({path:path.join(OUT,'driven-off.png'),clip});

/* how often does rAF fire */
res.raf = await page.evaluate(()=>new Promise(r=>{let n=0;const t=performance.now();
  const f=()=>{n++;if(performance.now()-t<3000)requestAnimationFrame(f);else r({fires:n,ms:Math.round(performance.now()-t)});};
  requestAnimationFrame(f);}));
fs.writeFileSync(path.join(OUT,'probe2.json'),JSON.stringify(res,null,2));
console.log(JSON.stringify(res,null,2));
console.log('LOGS '+JSON.stringify(logs.slice(-6)));
await browser.close(); server.close();
