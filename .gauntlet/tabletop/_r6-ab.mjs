/* ROUND 6 A/B — is the board's shadow VISIBLE on the skirt now, and what did
   it cost?

   The control is window.__vistaOff = {boardshadow:1}, which after round 6
   suppresses BOTH the blit and the skirt's self-shading from one flag (see
   shadowSweep). Both arms re-bake in the same page, same seed, same camera,
   so the only difference between the two frames is the shadow.

   🔴 THE FRAME IS READ OFF THE BOARD CANVAS AFTER DRIVING THE RENDERER
   DIRECTLY. CLAUDE.md: rAF in a headless pane fires at ~0.56 Hz, so an A/B
   that flips a flag and screenshots reads the frame from BEFORE the flip.
   TERR.key='' forces the terrain bake, and drawBoard() is called synchronously
   before each read. */
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

/* the boxes measured, in board-canvas CSS px. The two flanks are where the
   `day` sweep puts 46 near-full-cut cells that the card rail does NOT cover
   (measured by _r6-sweep.mjs); the control box is skirt far from the board. */
const BOXES = {
  leftFlank:  [470, 250, 70, 320],
  rightFlank: [1150, 250, 80, 320],
  nearBand:   [1400, 620, 190, 90],
  ctrlFarLeft:[60, 300, 90, 120],
  field:      [700, 300, 200, 200]
};

const out = {};
for (const time of ['day','dusk']) {
  await page.evaluate(t=>{try{setTimeOfDay(t);}catch(e){}}, time);
  await page.waitForTimeout(2800);
  out[time] = await page.evaluate((BOXES)=>{
    const cv = document.querySelector('canvas.bb-stage') || document.querySelector('canvas');
    const g2 = cv.getContext('2d');
    const dpr = cv.width / cv.clientWidth;
    const shot = () => {
      TERR.key = ''; drawBoard();
      const o = {};
      for (const k in BOXES){
        const b = BOXES[k];
        const d = g2.getImageData(Math.round(b[0]*dpr), Math.round(b[1]*dpr),
                                  Math.round(b[2]*dpr), Math.round(b[3]*dpr)).data;
        let r=0,gg=0,bb=0,n=0;
        for (let i=0;i<d.length;i+=4){ r+=d[i]; gg+=d[i+1]; bb+=d[i+2]; n++; }
        o[k] = { r:r/n, g:gg/n, b:bb/n, L:(0.299*r+0.587*gg+0.114*bb)/n, n:n };
      }
      return o;
    };
    window.__vistaOff = { boardshadow:1 }; const off = shot();
    window.__vistaOff = {};                const on  = shot();
    /* A/A: the same arm twice, so the animation floor is a number and not an
       assumption. Anything under this in the A/B is noise. */
    const on2 = shot();
    const res = { boxes:{} };
    for (const k in BOXES){
      res.boxes[k] = {
        offL: +off[k].L.toFixed(2), onL: +on[k].L.toFixed(2),
        delta: +(off[k].L - on[k].L).toFixed(2),
        aaNoise: +Math.abs(on2[k].L - on[k].L).toFixed(2),
        onRminusB: +(on[k].r - on[k].b).toFixed(2),
        chroma: +(Math.max(on[k].r,on[k].g,on[k].b) - Math.min(on[k].r,on[k].g,on[k].b)).toFixed(2)
      };
    }
    /* how many skirt cells the painter actually shaded this bake */
    res.skirtStat = { painted: SKIRT_STAT.painted, budget: SKIRT_STAT.budget };
    res.probe = !!_skirtShade;
    res.mul = _skirtShadeMul;
    return res;
  }, BOXES);

  /* PERF, driven directly. 20 bakes an arm after a 5-bake warm-up. */
  out[time].perf = await page.evaluate(()=>{
    const run = n => { const t=[]; for(let i=0;i<n;i++){ const a=performance.now(); paintTerrain(); t.push(performance.now()-a);} t.sort((x,y)=>x-y); return { p50:+t[n>>1].toFixed(2), p90:+t[Math.floor(n*0.9)].toFixed(2) }; };
    const o = {};
    window.__vistaOff = { boardshadow:1 }; run(5); o.off = run(20);
    window.__vistaOff = {};                run(5); o.on  = run(20);
    return o;
  });
}
await browser.close(); srv.close();
console.log(JSON.stringify(out,null,1));
