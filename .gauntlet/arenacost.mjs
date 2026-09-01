/* Per-recipe cost probe. Boots the page (no district), calls buildMesh() for one
   type at each level and reports MESHES, TRIANGLES and DRAW CALLS — the three
   numbers the round brief asks for, measured rather than estimated.
   Draw calls are read from renderer.info after an actual render of a scene
   containing nothing but the recipe, with the shadow pass left on, because a
   merged bucket is drawn TWICE a frame and the header of the _cv family says so.
   Usage: node .gauntlet/arenacost.mjs [type]  (default arena) */
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
const ROOT=path.resolve(process.cwd(),'public'), THREE_='/home/user/Playmythicspellbook/.gauntlet/package';
const MIME={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css',
 '.json':'application/json','.png':'image/png','.jpg':'image/jpeg','.svg':'image/svg+xml',
 '.glb':'model/gltf-binary','.txt':'text/plain','.webp':'image/webp'};
const TYPE=process.argv[2]||'arena';
const PORT=8700+(process.pid%90);
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
const errs=[]; page.on('console',m=>{if(m.type()==='error')errs.push(m.text().slice(0,200))});
await page.goto(`http://127.0.0.1:${PORT}/node-city/index.html`,{waitUntil:'load',timeout:120000});
await page.waitForTimeout(24000);
/* The recipe is only reachable through the shipped placement path — index.html
   is a <script type="module">, so `buildMesh` is NOT on window (the globals trap
   in CLAUDE.md) and `__nc` exposes `repaint`, not the factory. So this builds
   the standard district exactly as capture.mjs does, then measures the tile that
   is actually standing in it. Slower than a synthetic call and honest about
   what a player's city really pays. */
await page.evaluate(fs.readFileSync(path.resolve(process.cwd(),'.gauntlet/scene.js'),'utf8'));
await page.waitForTimeout(3000);
const out=await page.evaluate(([type])=>{
  const nc=window.__nc, {renderer,THREE}=nc.three();
  const rows=[];
  const ent=Object.entries(nc.game.tiles).filter(([k,t])=>t.type===type&&t.mesh);
  for(const [k,t] of ent){
    for(const lvl of [1,2,3]){
      t.lvl=lvl; nc.repaint(k);
      const g=nc.game.tiles[k].mesh;
      let meshes=0,tris=0,verts=0;const geos=new Set();
      g.traverse(o=>{ if(!o.isMesh)return; meshes++;
        const q=o.geometry; geos.add(q.uuid);
        const n=q.index?q.index.count:q.attributes.position.count; tris+=n/3;
        verts+=q.attributes.position.count; });
      /* DRAW CALLS, RENDERED — not counted. A merged bucket is drawn twice a
         frame (colour pass + shadow map), which is the whole reason the _cv
         family caps a recipe at ten buckets, so the number that matters comes
         out of renderer.info after a real render of a scene holding nothing but
         this recipe under a shadow-casting key. */
      const probe=new THREE.Scene();
      /* ⚠ THE CLONE IS MOVED TO THE ORIGIN. A DirectionalLight's default shadow
         camera is an ortho box of +-5 about the light's target, and this tile
         stands at world (6.5, -5.5) — outside it. Left where it was, the shadow
         pass rendered NOTHING and `calls` came back at exactly `meshes`, which
         reads like a result and is an empty frustum. */
      const clone=g.clone(true); clone.position.set(0,0,0); probe.add(clone);
      const cam=new THREE.PerspectiveCamera(45,4/3,.1,50);
      cam.position.set(1.6,1.4,2.2); cam.lookAt(0,.3,0);
      const light=new THREE.DirectionalLight(0xffffff,1); light.castShadow=true;
      light.position.set(2,4,2); probe.add(light); probe.add(new THREE.AmbientLight(0xffffff,.4));
      /* ⚠ autoReset OFF. three calls info.reset() INSIDE render(), AFTER the
         shadow map pass — so the default reading is the colour pass only and
         reports exactly `meshes`, which is not a measurement, it is a
         tautology. With autoReset off and the reset done by hand beforehand,
         `calls` carries BOTH passes, which is the number the ten-bucket ceiling
         was actually chosen against. */
      const shadowWas=renderer.shadowMap.enabled; renderer.shadowMap.enabled=true;
      const autoWas=renderer.info.autoReset; renderer.info.autoReset=false;
      renderer.info.reset(); renderer.render(probe,cam);
      const calls=renderer.info.render.calls, rt=renderer.info.render.triangles;
      renderer.info.autoReset=autoWas; renderer.shadowMap.enabled=shadowWas;
      let casters=0; g.traverse(o=>{ if(o.isMesh&&o.castShadow) casters++; });
      rows.push({tile:k,lvl,meshes,casters,tris,verts,geometries:geos.size,
                 drawCallsBothPasses:calls,renderedTris:rt});
    }
    t.lvl=1; nc.repaint(k);
  }
  return rows;
},[TYPE]);
console.log(JSON.stringify({type:TYPE,rows:out,errs:errs.slice(-5)},null,2));
await browser.close(); server.close();
