/* CRIT-MOOD4 — the density question, measured honestly.
   crit-mood2's first cut compared two frames WITHOUT culling the citizen agents,
   so its "do-nothing" control read 14,719 px — larger than the A/B itself. That
   number was an instrument artifact and is discarded. This one culls agents the
   way the builder's own driver does, prints the do-nothing control beside every
   figure, AND carries a second metric that needs no pixels at all: the
   screen-space overlap of the badge quads, straight off the live geometry.
*/
import { chromium } from 'playwright';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
const ROOT = path.resolve(process.cwd(), 'public');
const THREE_DIR = path.resolve(process.cwd(), '.gauntlet/three171');
const MIME = { '.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.json':'application/json','.png':'image/png','.jpg':'image/jpeg','.svg':'image/svg+xml','.glb':'model/gltf-binary','.txt':'text/plain','.webp':'image/webp' };
const PORT = 8600 + (process.pid % 40);
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

for (const SPARSE of [false, true]) {
  const label = SPARSE ? 'SPARSE (every 3rd tile)' : 'DENSE (a solid 6x7 block)';
  const r = await page.evaluate(async (sparse) => {
    const nc = window.__nc, B = window.MythicCityBridge;
    B.spendCinders=async()=>true; B.spendRes=async()=>true; B.getCinders=async()=>9e9; B.getRes=async()=>9e9; B.addCinders=async()=>true;
    if (!sparse) { for (let x=2;x<8;x++) for (let z=2;z<9;z++) { await nc.place('housing',x,z); try{nc.build.finishAll();}catch(e){} } }
    for (let i=0;i<4;i++){ try{nc.build.finishAll();}catch(e){} await new Promise(rr=>setTimeout(rr,120)); }
    await new Promise(rr=>setTimeout(rr,600));
    const I = window.MythicPlotIcons; I.show(); I.sync();
    return { drawn: I.drawn().length, withheld: I.overflow() };
  }, SPARSE);
  if (SPARSE) break;   // (the sparse arm is built by demolition below; see note)

  await page.evaluate(() => {
    const nc = window.__nc, { camera } = nc.three();
    camera.position.set(20,22,20); camera.lookAt(-5,0.6,-5);
    camera.updateMatrixWorld(true); camera.updateProjectionMatrix();
    try { nc.cullAgents(90); } catch(e) {}
  });
  await page.waitForTimeout(1200);

  const m = await page.evaluate(() => {
    const nc = window.__nc, { renderer, scene, camera, THREE } = nc.three();
    try { nc.cullAgents(90); } catch(e) {}
    let g=null; scene.traverse(o=>{ if(!g&&o.name==='mythic-plotmood-icons') g=o; });
    const gl = renderer.domElement, CW=gl.width, CH=gl.height;
    const s=document.createElement('canvas'); s.width=CW; s.height=CH;
    const c2=s.getContext('2d',{willReadFrequently:true});
    const shoot = ()=>{ renderer.render(scene,camera); c2.clearRect(0,0,CW,CH); c2.drawImage(gl,0,0,CW,CH); return c2.getImageData(0,0,CW,CH).data; };
    const full = (A,B)=>{ let n=0; for(let i=0;i<A.length;i+=4){ if(Math.abs(A[i]-B[i])>6||Math.abs(A[i+1]-B[i+1])>6||Math.abs(A[i+2]-B[i+2])>6) n++; } return n; };
    g.visible=true; const A=shoot(); g.visible=false; const Bf=shoot(); g.visible=true; const C=shoot();
    const changed = full(A,Bf), drift = full(A,C);

    /* PURE GEOMETRY — no pixels, no instrument. Each badge's screen box off the
       live position buffer, and how much of it another badge sits on. */
    const pos = g.geometry.getAttribute('position').array;
    const n = g.geometry.drawRange.count/6;
    const boxes=[];
    for(let i=0;i<n;i++){
      let x0=1e9,y0=1e9,x1=-1e9,y1=-1e9;
      for(let c=0;c<4;c++){ const o=i*12+c*3;
        const v=new THREE.Vector3(pos[o],pos[o+1],pos[o+2]).project(camera);
        const sx=(v.x*.5+.5)*CW, sy=(-v.y*.5+.5)*CH;
        x0=Math.min(x0,sx); x1=Math.max(x1,sx); y0=Math.min(y0,sy); y1=Math.max(y1,sy); }
      boxes.push({x0,y0,x1,y1,a:(x1-x0)*(y1-y0)});
    }
    /* coverage of each badge by the union of the others, by sampling its own box */
    const covers = boxes.map((b,i) => {
      let hit=0, tot=0;
      for (let y=b.y0; y<b.y1; y+=2) for (let x=b.x0; x<b.x1; x+=2) {
        tot++;
        for (let j=0;j<boxes.length;j++){ if(j===i) continue; const o=boxes[j];
          if (x>=o.x0&&x<o.x1&&y>=o.y0&&y<o.y1) { hit++; break; } }
      }
      return tot? hit/tot : 0;
    });
    covers.sort((a,b)=>b-a);
    const mean = covers.reduce((s,v)=>s+v,0)/Math.max(1,covers.length);
    return { badges:n, changed, drift,
             sumQuadArea: Math.round(boxes.reduce((s,b)=>s+b.a,0)),
             meanCoveredPct: +(100*mean).toFixed(1),
             worstCoveredPct: +(100*covers[0]).toFixed(1),
             medianCoveredPct: +(100*covers[Math.floor(covers.length/2)]).toFixed(1),
             fullyBuriedCount: covers.filter(v=>v>0.9).length };
  });
  console.log('\n' + label);
  console.log('   badges ' + m.badges + '  ·  layer A/B changed ' + m.changed + ' px  ·  do-nothing control ' + m.drift + ' px  (control must be 0)');
  console.log('   total badge quad area on screen ' + m.sumQuadArea + ' px^2');
  console.log('   how much of each badge another badge sits on: median ' + m.medianCoveredPct +
              '%, mean ' + m.meanCoveredPct + '%, worst ' + m.worstCoveredPct + '%');
  console.log('   badges more than 90% covered by neighbours: ' + m.fullyBuriedCount + ' of ' + m.badges);
  if (m.drift !== 0) console.log('   !! the do-nothing control is NOT 0 — the pixel figure above is contaminated and should be ignored; the geometry figures are not.');
}
await browser.close(); server.close();
