/* ROUND 6 PERF — three arms, so the skirt's self-shading is separable from the
   blit it makes visible. §8.9: the number comes from a driven bake, not from an
   assertion, and CAMERA.moving bypasses the terrain cache so this is also the
   per-frame cost of a pan. */
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
    const run = n => { const t=[]; for(let i=0;i<n;i++){ const a=performance.now(); paintTerrain(); t.push(performance.now()-a);} t.sort((x,y)=>x-y); return { p50:+t[n>>1].toFixed(2), p90:+t[Math.floor(n*0.9)].toFixed(2) }; };
    const arm = (flags) => { window.__vistaOff = flags; run(6); return run(24); };
    const o = {};
    o.noShadow    = arm({ boardshadow:1 });
    o.blitOnly    = arm({ skirtshade:1 });
    o.both        = arm({});
    o.shadedCells = (function(){ let n=0; if(!_skirtShade) return 0;
      const R = skirtPlan(skirtRange());
      for (let z=R.z0; z<=R.z1; z++) for (let x=R.x0; x<=R.x1; x++){
        if (x>=0 && z>=0 && x<MAP.cols && z<MAP.rows) continue;
        const w = gw(x,z); if (_skirtShade.at(w.x, w.z, _skirtShadeMul) >= 0.015) n++;
      } return n; })();
    o.painted = SKIRT_STAT.painted;
    return o;
  });
}
await browser.close(); srv.close();
console.log(JSON.stringify(out,null,1));
