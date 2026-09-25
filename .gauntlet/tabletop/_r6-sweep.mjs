/* ROUND 6 PROBE — where does the board's cast shadow actually LAND, and what
   is painted over it?

   The gap this round closes is "the shadow is painted UNDER the skirt", so the
   first thing to establish is not a colour but a GEOMETRY: the swept footprint
   in screen space, which skirt cells' centres fall inside it, and how much of
   it the card rail covers. Everything after this is measured against these
   numbers rather than against the eye.

   Re-derives nothing: it reads lipRect(), lightVector() and project() off the
   live page, exactly as boardShadow() does. */
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const PUB = 'E:/game-deploy/public';
const MIME = { '.html':'text/html', '.js':'text/javascript', '.mjs':'text/javascript',
  '.css':'text/css', '.json':'application/json', '.png':'image/png', '.jpg':'image/jpeg',
  '.svg':'image/svg+xml', '.glb':'model/gltf-binary', '.txt':'text/plain', '.webp':'image/webp',
  '.avif':'image/avif', '.gif':'image/gif', '.mp3':'audio/mpeg', '.woff2':'font/woff2' };
const srv = http.createServer((req,res)=>{
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p.endsWith('/')) p += 'index.html';
  const f = path.join(PUB, p);
  if (!path.resolve(f).startsWith(path.resolve(PUB))) { res.writeHead(403); return res.end(); }
  fs.readFile(f,(e,b)=>{ if(e){res.writeHead(404);return res.end('404');}
    res.writeHead(200,{'content-type':MIME[path.extname(f).toLowerCase()]||'application/octet-stream'}); res.end(b); });
});
await new Promise(r=>srv.listen(0,'127.0.0.1',r));
const PORT = srv.address().port;

const shotSrc = fs.readFileSync('E:/game-deploy/.gauntlet/tabletop/shot.mjs','utf8');
const pure = shotSrc.slice(0, shotSrc.indexOf('const payload =')).replace(/^import.*$/gm,'');
const payload = new Function('process', pure + ';return JSON.stringify({cols:COLS,rows:ROWS,tiles});')(
  { argv:['node','shot','x.png','--scene','mixed'] });

const browser = await chromium.launch({ args:['--use-gl=swiftshader','--enable-unsafe-swiftshader','--disable-lcd-text'] });
const page = await browser.newPage({ viewport:{width:1600,height:900}, deviceScaleFactor:1 });
await page.goto('http://127.0.0.1:'+PORT+'/battle-board/index.html',{waitUntil:'load',timeout:45000});
await page.waitForTimeout(7000);
await page.evaluate(js=>eval(js), `window.postMessage({type:'board:map',map:${payload}},location.origin)`);
await page.waitForTimeout(3000);

const out = {};
for (const time of ['day','dusk']) {
  await page.evaluate(t=>{try{setTimeOfDay(t);}catch(e){}}, time);
  await page.waitForTimeout(2800);
  out[time] = await page.evaluate(()=>{
    const o = {};
    const PLINTH_H = 1.8, STEPS = 9;
    const L = lipRect();
    const wp = L.foot;
    const lv = lightVector(LIGHT);
    const len = clamp(PLINTH_H/(lv.y+0.22), PLINTH_H*0.4, PLINTH_H*3.2);
    const ox = -lv.x*len, oz = -lv.z*len;
    o.light = {x:+lv.x.toFixed(3), y:+lv.y.toFixed(3), z:+lv.z.toFixed(3)};
    o.len = +len.toFixed(3); o.off = {ox:+ox.toFixed(3), oz:+oz.toFixed(3)};
    o.keyI = +LIGHT.keyI.toFixed(3);
    const pr = (wx,wz)=>{ const p = project({x:wx,y:0,z:wz}); return p?[Math.round(p.x),Math.round(p.y)]:null; };
    o.footScreen = wp.map(p=>pr(p.x,p.z));
    /* the march, exactly as boardShadow builds it */
    const polys = [];
    for (let i=1;i<=STEPS;i++){
      const t = 0.12 + (i/STEPS)*0.88;
      polys.push(wp.map(p=>pr(p.x+ox*t, p.z+oz*t)));
    }
    o.marchLast = polys[polys.length-1];
    let x0=1e9,y0=1e9,x1=-1e9,y1=-1e9;
    for (const q of polys) for (const p of q){ if(!p) continue;
      if(p[0]<x0)x0=p[0]; if(p[0]>x1)x1=p[0]; if(p[1]<y0)y0=p[1]; if(p[1]>y1)y1=p[1]; }
    o.sweptBox = [x0,y0,x1-x0,y1-y0];

    /* point-in-quad, the same test the probe will use */
    const inQuad=(q,px,pz)=>{ let s=0;
      for(let k=0;k<4;k++){ const a=q[k], b=q[(k+1)&3];
        const cr=(b.x-a.x)*(pz-a.z)-(b.z-a.z)*(px-a.x);
        if(cr>1e-9)s|=1; else if(cr<-1e-9)s|=2; if(s===3)return false; }
      return true; };
    const cover=(wx,wz)=>{ let n=0;
      for(let i=1;i<=STEPS;i++){ const t=0.12+(i/STEPS)*0.88;
        if(inQuad(wp, wx-ox*t, wz-oz*t)) n++; }
      return n; };

    /* every SKIRT cell the plan would paint, and whether it is in shadow */
    const R = (typeof skirtPlan==='function' && typeof skirtRange==='function') ? skirtPlan(skirtRange()) : null;
    const cells = [];
    if (R){
      for (let z=R.z0; z<=R.z1; z++) for (let x=R.x0; x<=R.x1; x++){
        if (x>=0 && z>=0 && x<MAP.cols && z<MAP.rows) continue;
        const w = gw(x,z);
        const n = cover(w.x, w.z);
        if (!n) continue;
        const p = project(gw(x,z,elevOf(x,z)));
        cells.push({x,z,n, sx:p?Math.round(p.x):null, sy:p?Math.round(p.y):null});
      }
    }
    o.skirtRange = R ? {x0:R.x0,x1:R.x1,z0:R.z0,z1:R.z1,lod:R.lod} : null;
    o.shadedCells = cells.length;
    /* how many of them are OUTSIDE the card rail's rect, i.e. actually visible */
    let rail = null;
    try { const el = document.querySelector('.hand, #hand, .card-rail, .bb-hand');
          if (el){ const r = el.getBoundingClientRect(); rail = [Math.round(r.x),Math.round(r.y),Math.round(r.width),Math.round(r.height)]; } } catch(e){}
    o.rail = rail;
    const vis = cells.filter(c => c.sx!=null && (!rail || c.sx<rail[0] || c.sx>rail[0]+rail[2] || c.sy<rail[1] || c.sy>rail[1]+rail[3]));
    o.visibleShadedCells = vis.length;
    const hist = {}; for (const c of vis) hist[c.n] = (hist[c.n]||0)+1;
    o.visibleHist = hist;
    o.visibleDeep = vis.filter(c=>c.n>=5);
    o.visibleSample = vis.slice(0,6);
    o.deepest = cells.reduce((m,c)=>Math.max(m,c.n),0);
    return o;
  });
}
await browser.close(); srv.close();
console.log(JSON.stringify(out,null,1));
