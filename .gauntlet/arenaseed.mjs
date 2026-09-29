/* DETERMINISM PROBE for makeArena's tile seed.
   Three questions, none of which a screenshot can answer:
     1. does the same tile rebuild to the same vertices?  (repaint x3)
     2. does a DIFFERENT tile build a different arena?     (the seed is read at
        all — a recipe that ignores tx,tz passes question 1 trivially)
     3. does it survive a fresh boot?                      (run twice, compare)
   Prints one FNV checksum per case. Usage: node .gauntlet/arenaseed.mjs */
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
const ROOT=path.resolve(process.cwd(),'public'), THREE_='/home/user/Playmythicspellbook/.gauntlet/package';
const MIME={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css',
 '.json':'application/json','.png':'image/png','.jpg':'image/jpeg','.svg':'image/svg+xml',
 '.glb':'model/gltf-binary','.txt':'text/plain','.webp':'image/webp'};
const PORT=8800+(process.pid%90);
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
const page=await browser.newPage({viewport:{width:800,height:600},deviceScaleFactor:1});
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
await page.waitForTimeout(3000);
const out=await page.evaluate(()=>{
  const nc=window.__nc;
  const H=(g)=>{let x=2166136261;
    g.traverse(o=>{ if(!o.isMesh)return; const q=o.geometry;
      for(const key of ['position','color']){ const at=q.attributes[key]; if(!at)continue;
        const a=at.array; for(let i=0;i<a.length;i++){x^=Math.round(a[i]*4096)|0;x=Math.imul(x,16777619);} } });
    return (x>>>0).toString(16);};
  const [k,t]=Object.entries(nc.game.tiles).find(([k,t])=>t.type==='arena'&&t.mesh);
  const same=[]; for(let i=0;i<3;i++){ nc.repaint(k); same.push(H(nc.game.tiles[k].mesh)); }
  // move the SAME arena to a different plot and rebuild: the seed must bite
  const [x,z]=k.split(',').map(Number);
  const k2=(x+1)+','+(z+1);
  const other=[]; const keep=nc.game.tiles[k2];
  nc.game.tiles[k2]={...t, mesh:null};
  try{ nc.repaint(k2); other.push(H(nc.game.tiles[k2].mesh)); }catch(e){ other.push('ERR '+e); }
  try{ if(nc.game.tiles[k2]&&nc.game.tiles[k2].mesh) nc.game.tiles[k2].mesh.visible=false; }catch(e){}
  if(keep) nc.game.tiles[k2]=keep; else delete nc.game.tiles[k2];
  return { tile:k, repaints:same, otherTile:k2, otherHash:other };
});
console.log(JSON.stringify(out,null,2));
await browser.close(); server.close();
