import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
const ROOT='/home/user/Playmythicspellbook/public', THREE_='/home/user/Playmythicspellbook/.gauntlet/package';
const MIME={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.json':'application/json','.png':'image/png','.jpg':'image/jpeg','.svg':'image/svg+xml','.glb':'model/gltf-binary','.txt':'text/plain','.webp':'image/webp'};
const PORT=8700+(process.pid%90);
const server=http.createServer((req,res)=>{let p=decodeURIComponent(req.url.split('?')[0]);if(p.endsWith('/'))p+='index.html';const f=path.join(ROOT,p);
 if(!f.startsWith(ROOT)||!fs.existsSync(f)||fs.statSync(f).isDirectory()){res.writeHead(404);return res.end('nf')}
 res.writeHead(200,{'Content-Type':MIME[path.extname(f)]||'application/octet-stream'});fs.createReadStream(f).pipe(res)});
await new Promise(r=>server.listen(PORT,'127.0.0.1',r));
const browser=await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
 args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist','--no-sandbox','--disable-dev-shm-usage','--no-proxy-server'],
 env:Object.fromEntries(Object.entries(process.env).filter(([k])=>!/^(HTTPS?_PROXY|https?_proxy|ALL_PROXY|all_proxy)$/.test(k)))});
const page=await browser.newPage({viewport:{width:1280,height:800},deviceScaleFactor:1});
await page.route('**/*',r=>{const u=r.request().url();(u.startsWith('data:')||u.includes('127.0.0.1')||u.includes('localhost')||u.includes('jsdelivr'))?r.continue():r.abort()});
await page.route('**/cdn.jsdelivr.net/npm/three@0.171.0/**',r=>{const rel=new URL(r.request().url()).pathname.replace('/npm/three@0.171.0/','');const f=path.join(THREE_,rel);
 fs.existsSync(f)?r.fulfill({status:200,contentType:'text/javascript',body:fs.readFileSync(f)}):r.fulfill({status:404,body:'nf'})});
const logs=[];page.on('console',m=>logs.push(`[${m.type()}] ${m.text()}`.slice(0,300)));
page.on('pageerror',e=>logs.push(`[pageerror] ${e.message}`.slice(0,400)));
await page.goto(`http://127.0.0.1:${PORT}/node-city/index.html`,{waitUntil:'load',timeout:120000});
await page.waitForTimeout(24000);

const A = await page.evaluate(async () => {
  const E = window.MythicEconomy;
  const s = E && E.survey ? E.survey() : null;
  const En = E ? E.endowment : null;
  const g = {};
  for (const id of ['timber','crudeOil','naturalGas','cotton','plantFiber','rawWater','mythicEssence','ironOre','wheat'])
    g[id] = En ? En.gradeOf(s.nodeId, id) : '?';
  return { ecoReady: !!(E&&E.ready&&E.ready()), deferred: E&&E.deferred?E.deferred():null,
           nodeId: s ? s.nodeId : null, grades: g,
           gateInScope: (typeof window.ecoGroundRefusal), tiles: Object.keys(window.__nc.game.tiles).length };
});
console.log('LIVE CITY:', JSON.stringify(A));

const B = await page.evaluate(async () => {
  const E = window.MythicEconomy, nc = window.__nc;
  const toasts = []; window.__ncToastSink = (m,c)=>toasts.push((c||'')+' :: '+m);
  // Give the city everything, so nothing but the gate can refuse.
  window.MythicCityBridge.getCinders = async () => 9e9;
  window.MythicCityBridge.spendCinders = async () => true;
  for (const k in nc.game.res) nc.game.res[k] = 9e5;
  nc.game.stock = nc.game.stock || {}; for (const k in nc.game.stock) nc.game.stock[k] = 9e5;
  // Move the economy onto a node whose ground has NO timber, NO gas/oil and NO mythic.
  E.mount({ nodeId: 'crit-node-1', population: 200, established: true });
  const s = E.survey();
  const En = E.endowment;
  const grades = {}; for (const id of ['timber','crudeOil','naturalGas','cotton','plantFiber','mythicEssence','mythicResidue','anomalousEnergy','arcaneCrystal','rawWater'])
    grades[id] = En.gradeOf(s.nodeId, id);
  const out = {};
  const free = [];
  let n = 0;
  for (let x=1;x<40 && free.length<12;x++) for (let z=1;z<40 && free.length<12;z++)
    if (!nc.game.tiles[x+','+z]) free.push([x,z]);
  for (const t of ['lumbercamp','fuelrig','siphon','farm','scrapmine','quarry','waterintake','deepmine','alloyworks','canecroft','riftbore']) {
    const [x,z] = free.shift();
    const before = toasts.length;
    await nc.place(t, x, z);
    out[t] = { placed: !!nc.game.tiles[x+','+z], at: x+','+z, said: toasts.slice(before) };
  }
  return { nodeId: s.nodeId, grades, out };
});
console.log('\nDRIVEN THROUGH THE SHIPPED tryPlace (node crit-node-1):');
console.log('grades:', JSON.stringify(B.grades));
for (const t in B.out) console.log('  ' + t.padEnd(12) + (B.out[t].placed?'PLACED  ':'REFUSED ') + JSON.stringify(B.out[t].said));
console.log('\n--- console tail ---\n' + logs.slice(-10).join('\n'));
await browser.close(); server.close();
