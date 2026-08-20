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

const NODE = process.argv[2] || 'crit-node-1';
const R = await page.evaluate(async (NODE) => {
  const nc = window.__nc, E = window.MythicEconomy, B = window.MythicCityBridge;
  const toasts = []; window.__ncToastSink = (m,c)=>toasts.push((c||'')+' :: '+m);
  const _c = window.confirm; window.confirm = () => true;
  B.spendCinders = async()=>true; B.spendRes = async()=>true;
  B.getCinders = async()=>9e9; B.getRes = async()=>9e9; B.addCinders = async()=>true;
  const Pg = window.MythicProgress;
  const granted = [];
  for (const id of ['civ_basic','ind_extract','ind_heavy','civ_services']) { try { granted.push(id+':'+Pg._grant(id)); } catch(e){ granted.push(id+':ERR'); } }
  // Free construction co. so the municipal ceiling cannot answer for us
  try { await window.__nc.ops.acquireFree ? window.__nc.ops.acquireFree('construction') : null; } catch(e){}
  E.mount({ nodeId: NODE, population: 400, established: true });
  const s = E.survey(), En = E.endowment;
  const grades = {}; for (const id of ['timber','crudeOil','naturalGas','cotton','plantFiber',
      'mythicEssence','mythicResidue','anomalousEnergy','arcaneCrystal','rawWater','ironOre','coal','copperOre','aluminumOre','zincOre','nickelOre'])
    grades[id] = En.gradeOf(s.nodeId, id);
  const free = [];
  for (let x=1;x<44 && free.length<30;x++) for (let z=1;z<44 && free.length<30;z++) if (!nc.game.tiles[x+','+z]) free.push([x,z]);
  const out = {};
  for (const t of ['lumbercamp','fuelrig','siphon','farm','scrapmine','quarry','fibercroft','hydrofarm',
                   'waterintake','deepmine','alloyworks','canecroft','riftbore','purifier','sawmill']) {
    const [x,z] = free.shift(); const before = toasts.length;
    try { await nc.place(t, x, z); } catch(e) { toasts.push('THREW :: '+e.message); }
    try { nc.build.finishAll(); } catch(e){}
    out[t] = { placed: !!nc.game.tiles[x+','+z], said: toasts.slice(before) };
  }
  window.confirm = _c;
  return { nodeId: s.nodeId, grades, out };
}, NODE);
console.log('NODE ' + R.nodeId);
console.log('grades: ' + JSON.stringify(R.grades));
for (const t in R.out) console.log('  ' + t.padEnd(12) + (R.out[t].placed?'PLACED   ':'REFUSED  ') + (R.out[t].said.join(' | ')||''));
console.log('\n--- console tail ---\n'+logs.slice(-6).join('\n'));
await browser.close(); server.close();
