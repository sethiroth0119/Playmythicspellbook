import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
/* cwd-relative so a builder can run this inside its own git worktree.
   THREE_ stays absolute: the vendored tarball is gitignored and therefore
   absent from every worktree. */
const ROOT=path.resolve(process.cwd(),'public'), THREE_='/home/user/Playmythicspellbook/.gauntlet/package';
const MIME={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.png':'image/png','.txt':'text/plain'};
const PORT=8590;
const server=http.createServer((req,res)=>{let p=decodeURIComponent(req.url.split('?')[0]);if(p.endsWith('/'))p+='index.html';
 const f=path.join(ROOT,p); if(!f.startsWith(ROOT)||!fs.existsSync(f)||fs.statSync(f).isDirectory()){res.writeHead(404);return res.end('nf')}
 res.writeHead(200,{'Content-Type':MIME[path.extname(f)]||'application/octet-stream'});fs.createReadStream(f).pipe(res)});
await new Promise(r=>server.listen(PORT,'127.0.0.1',r));
const browser=await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
 args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--no-sandbox','--disable-dev-shm-usage','--no-proxy-server'],
 env:Object.fromEntries(Object.entries(process.env).filter(([k])=>!/^(HTTPS?_PROXY|https?_proxy|ALL_PROXY|all_proxy)$/.test(k)))});
const page=await browser.newPage({viewport:{width:1280,height:720},ignoreHTTPSErrors:true});
await page.route('**/*',r=>{const u=r.request().url();(u.includes('127.0.0.1')||u.includes('jsdelivr'))?r.continue():r.abort()});
await page.route('**/cdn.jsdelivr.net/npm/three@0.171.0/**',r=>{const rel=new URL(r.request().url()).pathname.replace('/npm/three@0.171.0/','');
 const f=path.join(THREE_,rel); fs.existsSync(f)?r.fulfill({status:200,contentType:'text/javascript',body:fs.readFileSync(f)}):r.fulfill({status:404,body:'nf'})});
await page.goto(`http://127.0.0.1:${PORT}/node-city/index.html`,{waitUntil:'load',timeout:120000});
await page.waitForTimeout(22000);
console.log(JSON.stringify(await page.evaluate(async () => {
  const nc=window.__nc, B=window.MythicCityBridge;
  B.spendCinders=async()=>true; B.spendRes=async()=>true; B.getCinders=async()=>9e9; B.getRes=async()=>9e9;
  const R=[];
  const cnt=()=>Object.keys(nc.game.tiles).length;
  const C=12;
  for(const [x,z] of [[C+7,C+7],[C+8,C+7],[C+7,C+8]]) await nc.place('depot',x,z);
  R.push(['after depots', cnt(), nc.pop(), (nc.game.tiles[(C+7)+','+(C+7)]||{}).type]);
  let placedRoads=0;
  for (const r of [C-8,C-4,C,C+4,C+8]) for(let i=C-9;i<=C+9;i++){
    await nc.place('road',i,r); await nc.place('road',r,i); }
  R.push(['after roads', cnt()]);
  await nc.place('housing', C-7, C-7);
  R.push(['housing at '+(C-7)+','+(C-7), !!nc.game.tiles[(C-7)+','+(C-7)], cnt()]);
  await nc.place('housing', 5, 5);
  R.push(['housing 5,5', !!nc.game.tiles['5,5']]);
  return { R, tiles:cnt(), pop:nc.pop(), roadCap:nc.game.tiles?1:1 };
}),null,2));
await browser.close(); server.close();
