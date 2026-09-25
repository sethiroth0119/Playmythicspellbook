/* CRIT-MOOD5 — the draw ORDER of the badge quads.
   The layer is ONE indexed draw with depthTest:false and depthWrite:false, so
   the quad written LAST in the buffer paints over every quad before it. The
   buffer order is apply()'s sort — WORST SCORE FIRST. Two consequences to
   measure rather than argue:
     1  in an overlapping pair, is the badge that wins the pixels the NEARER
        one (correct) or just the higher-index one (wrong)?
     2  is the worst-scoring plot — the one the cap exists to prioritise — the
        one buried underneath its less-bad neighbours?
*/
import { chromium } from 'playwright';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
const ROOT = path.resolve(process.cwd(), 'public');
const THREE_DIR = path.resolve(process.cwd(), '.gauntlet/three171');
const MIME = { '.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.json':'application/json','.png':'image/png','.jpg':'image/jpeg','.svg':'image/svg+xml','.glb':'model/gltf-binary','.txt':'text/plain','.webp':'image/webp' };
const PORT = 8560 + (process.pid % 30);
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
await page.goto(`http://127.0.0.1:${PORT}/node-city/index.html?cam=rev`,{waitUntil:'domcontentloaded',timeout:120000});
await page.waitForFunction('!!window.__nc',null,{timeout:60000}).catch(()=>{});
await page.waitForTimeout(14000);

const out = await page.evaluate(async () => {
  const nc = window.__nc, B = window.MythicCityBridge;
  B.spendCinders=async()=>true; B.spendRes=async()=>true; B.getCinders=async()=>9e9; B.getRes=async()=>9e9; B.addCinders=async()=>true;
  for (let x=2;x<8;x++) for (let z=2;z<9;z++) { await nc.place('housing',x,z); try{nc.build.finishAll();}catch(e){} }
  for (let i=0;i<4;i++){ try{nc.build.finishAll();}catch(e){} await new Promise(r=>setTimeout(r,120)); }
  await new Promise(r=>setTimeout(r,700));
  const I = window.MythicPlotIcons; I.show(); I.sync();

  const { renderer, scene, camera, THREE } = nc.three();
  const CAM = (new URLSearchParams(location.search).get('cam') === 'rev') ? [-30,22,-30] : [20,22,20];
  camera.position.set(CAM[0],CAM[1],CAM[2]); camera.lookAt(-5,0.6,-5);
  camera.updateMatrixWorld(true); camera.updateProjectionMatrix();
  try { nc.cullAgents(90); } catch(e){}
  let g=null; scene.traverse(o=>{ if(!g&&o.name==='mythic-plotmood-icons') g=o; });
  renderer.render(scene, camera);   // let onBeforeRender write the corners

  const dr = I.drawn();
  const pos = g.geometry.getAttribute('position').array;
  const n = g.geometry.drawRange.count/6;
  const CW = renderer.domElement.width, CH = renderer.domElement.height;
  const items = [];
  for (let i=0;i<n;i++){
    let x0=1e9,y0=1e9,x1=-1e9,y1=-1e9, cx=0, cy=0, cz=0;
    for(let c=0;c<4;c++){ const o=i*12+c*3;
      cx+=pos[o]/4; cy+=pos[o+1]/4; cz+=pos[o+2]/4;
      const v=new THREE.Vector3(pos[o],pos[o+1],pos[o+2]).project(camera);
      const sx=(v.x*.5+.5)*CW, sy=(-v.y*.5+.5)*CH;
      x0=Math.min(x0,sx); x1=Math.max(x1,sx); y0=Math.min(y0,sy); y1=Math.max(y1,sy); }
    const d = camera.position.distanceTo(new THREE.Vector3(cx,cy,cz));
    items.push({ i, x0,y0,x1,y1, dist:d, score: dr[i] ? dr[i].score : null, at: dr[i] ? dr[i].x+','+dr[i].z : '?' });
  }
  /* is the buffer sorted worst-first? */
  const scores = items.map(o=>o.score);
  const ascending = scores.every((s,k)=> k===0 || s >= scores[k-1]);

  /* overlapping pairs: the later index paints over the earlier one. */
  let pairs=0, laterIsFarther=0, laterIsNearer=0;
  for(let a=0;a<items.length;a++)for(let b=a+1;b<items.length;b++){
    const A=items[a],Bq=items[b];
    const ow=Math.min(A.x1,Bq.x1)-Math.max(A.x0,Bq.x0), oh=Math.min(A.y1,Bq.y1)-Math.max(A.y0,Bq.y0);
    if(ow<=0||oh<=0) continue;
    if ((ow*oh) / Math.min((A.x1-A.x0)*(A.y1-A.y0),(Bq.x1-Bq.x0)*(Bq.y1-Bq.y0)) < 0.15) continue;
    pairs++;
    if (Bq.dist > A.dist) laterIsFarther++; else laterIsNearer++;
  }
  /* the single worst plot: how much of it is painted over by later quads? */
  const w = items[0];
  let hit=0, tot=0;
  for(let y=w.y0;y<w.y1;y+=1)for(let x=w.x0;x<w.x1;x+=1){ tot++;
    for(let j=1;j<items.length;j++){ const o=items[j]; if(x>=o.x0&&x<o.x1&&y>=o.y0&&y<o.y1){hit++;break;} } }
  return { badges:n, ascendingWorstFirst: ascending,
           worstPlot: { at: w.at, score: w.score, coveredByLaterPct: +(100*hit/Math.max(1,tot)).toFixed(1) },
           overlapPairs: pairs, laterIsFarther, laterIsNearer,
           scoreHead: scores.slice(0,3), scoreTail: scores.slice(-3) };
});
console.log(JSON.stringify(out, null, 1));
await browser.close(); server.close();
