/* read the board's real geometry off the live page, so the shadow quad is
   built from measured numbers rather than from a comment. */
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
for (const time of ['day','dusk','night']) {
  await page.evaluate(t=>{try{setTimeOfDay(t);}catch(e){}}, time);
  await page.waitForTimeout(2600);
  out[time] = await page.evaluate(()=>{
    const o = {};
    const R = (v)=>Math.round(v*1000)/1000;
    try { o.boardExtent = boardExtent(); } catch(e){ o.boardExtent = String(e); }
    try { o.groundExtent = groundExtent(); } catch(e){ o.groundExtent = String(e); }
    try { o.lipRect = typeof lipRect === 'function' ? lipRect() : 'absent'; } catch(e){ o.lipRect = String(e); }
    try { o.latticeCentreX = latticeCentreX(); } catch(e){ o.latticeCentreX = String(e); }
    try { o.hex = { w:hexW(), v:hexV(), size:hexSize() }; } catch(e){}
    try { o.wall = CONFIG.wall; } catch(e){}
    try { o.lipConsts = { LIP_W, LIP_H, LIP_FOOT, LIP_BATTER, LIP_SHADE }; } catch(e){ o.lipConsts=String(e); }
    try { const L = lightVector(LIGHT); o.light = {x:R(L.x),y:R(L.y),z:R(L.z)}; } catch(e){}
    try { o.keyI = LIGHT.keyI; } catch(e){}
    try { o.cam = { yaw:CAMERA.yaw, pan:{x:CAMERA.pan.x,z:CAMERA.pan.z} }; } catch(e){}
    /* screen projection of both quads' corners */
    const pr = (wx,wz)=>{ const p = project({x:wx,y:0,z:wz}); return p?[Math.round(p.x),Math.round(p.y)]:null; };
    try {
      const b = o.boardExtent, tx = o.latticeCentreX||0;
      o.boardCorners = [pr(tx-b.x,-b.z),pr(tx+b.x,-b.z),pr(tx+b.x,b.z),pr(tx-b.x,b.z)];
    } catch(e){}
    try {
      const g = o.groundExtent, w = o.wall;
      const P = (u,v)=>{ const q = gp(u,v,0); return pr(q.x,q.z); };
      o.groundCorners = [P(-g.x-w,-g.far-w),P(g.x+w,-g.far-w),P(g.x+w,g.near+w),P(-g.x-w,g.near+w)];
    } catch(e){}
    try { o.lipFootCorners = o.lipRect.foot.map(p=>pr(p.x,p.z)); } catch(e){}
    return o;
  });
}
await browser.close(); srv.close();
console.log(JSON.stringify(out,null,1));
