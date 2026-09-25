import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
const PUB='E:/game-deploy/public';
const MIME={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.json':'application/json','.png':'image/png','.jpg':'image/jpeg','.svg':'image/svg+xml','.glb':'model/gltf-binary','.txt':'text/plain','.webp':'image/webp','.avif':'image/avif','.gif':'image/gif','.mp3':'audio/mpeg','.woff2':'font/woff2'};
const srv=http.createServer((req,res)=>{let p=decodeURIComponent(req.url.split('?')[0]);if(p.endsWith('/'))p+='index.html';const f=path.join(PUB,p);if(!path.resolve(f).startsWith(path.resolve(PUB))){res.writeHead(403);return res.end();}fs.readFile(f,(e,b)=>{if(e){res.writeHead(404);return res.end('404');}res.writeHead(200,{'content-type':MIME[path.extname(f).toLowerCase()]||'application/octet-stream'});res.end(b);});});
await new Promise(r=>srv.listen(0,'127.0.0.1',r));const PORT=srv.address().port;
const shotSrc=fs.readFileSync('E:/game-deploy/.gauntlet/tabletop/shot.mjs','utf8');
const pure=shotSrc.slice(0,shotSrc.indexOf('const payload =')).replace(/^import.*$/gm,'');
const payload=new Function('process',pure+';return JSON.stringify({cols:COLS,rows:ROWS,tiles});')({argv:['node','s','x.png','--scene','mixed']});
const browser=await chromium.launch({args:['--use-gl=swiftshader','--enable-unsafe-swiftshader','--disable-lcd-text']});
const page=await browser.newPage({viewport:{width:1600,height:900},deviceScaleFactor:1});
page.on('console',m=>{ if(/VPROBE/.test(m.text())) console.log('PAGE:',m.text()); });
await page.goto('http://127.0.0.1:'+PORT+'/battle-board/index.html',{waitUntil:'load',timeout:45000});
await page.waitForTimeout(7000);
await page.evaluate(js=>eval(js),`window.postMessage({type:'board:map',map:${payload}},location.origin)`);
await page.waitForTimeout(3000);
const out = await page.evaluate(()=>{
  const o={};
  o.hasVista = !!(window.BBX&&window.BBX.vista);
  o.hasHook  = !!(window.BBX&&window.BBX.vista&&window.BBX.vista.tableShadow);
  o.keys = window.BBX&&window.BBX.vista?Object.keys(window.BBX.vista):null;
  /* does the terrain ctx support multiply? */
  try{ const c=document.createElement('canvas').getContext('2d'); c.globalCompositeOperation='multiply'; o.mulOnScratch=c.globalCompositeOperation; }catch(e){o.mulOnScratch=String(e);}
  try{ o.mulOnTerr = (function(){ const g=TERR&&TERR.g; if(!g) return 'no TERR.g'; const p=g.globalCompositeOperation; g.globalCompositeOperation='multiply'; const v=g.globalCompositeOperation; g.globalCompositeOperation=p; return v; })(); }catch(e){o.mulOnTerr=String(e);}
  /* call the hook onto a scratch canvas and count non-transparent pixels */
  try{
    const cv=document.createElement('canvas'); cv.width=1600; cv.height=900;
    const g=cv.getContext('2d');
    g.setTransform(1,0,0,1,0,0);
    g.fillStyle='#808080'; g.fillRect(0,0,1600,900);
    window.BBX.vista.tableShadow(buildApi(0), g);
    const d=g.getImageData(0,0,1600,900).data;
    let n=0,minL=255,sum=0;
    for(let i=0;i<d.length;i+=4){ const L=d[i]; if(L<126){n++;sum+=128-L; if(L<minL)minL=L;} }
    o.probe={darkenedPx:n, meanCut:+(sum/Math.max(1,n)).toFixed(2), deepest:minL};
    const at=(x,y)=>d[((y*1600+x)*4)];
    o.samples={ boardCentre:at(850,400), boardLeftIn:at(600,400), leftOfBoard:at(380,300), farLeft:at(480,260), nearBand:at(700,640) };
  }catch(e){ o.probe=String(e)+'\n'+(e&&e.stack||''); }
  return o;
});
/* PERF: the terrain bake with and without the shadow, driven directly (the
   pane's rAF is not to be trusted — CLAUDE.md). 30 bakes per arm, trimmed. */
const perf = await page.evaluate(() => {
  const run = (n) => { const t = []; for (let i = 0; i < n; i++) { const a = performance.now(); paintTerrain(); t.push(performance.now() - a); } t.sort((x, y) => x - y); return { p50: +t[Math.floor(n/2)].toFixed(2), p90: +t[Math.floor(n*0.9)].toFixed(2), min: +t[0].toFixed(2) }; };
  const out = {};
  window.__vistaOff = { boardshadow: 1 }; run(5); out.off = run(30);
  window.__vistaOff = {};                 run(5); out.on  = run(30);
  return out;
});
console.log('PERF ' + JSON.stringify(perf));
console.log(JSON.stringify(out,null,1));
await browser.close(); srv.close();
