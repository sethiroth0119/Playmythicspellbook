/* ⛏ THE EXTRACTION ROUND — MESH COST, MEASURED.
   Boots the real page, builds the standard district (so the recipes are
   measured in a city, not in a vacuum), then for each of the five new types
   writes a tile on free ground, repaints it through the shipped __nc.repaint,
   and reports MESHES · TRIANGLES · VERTICES · DRAW CALLS at levels 1/2/3.

   Two things it also proves, both of which have burned this project:
     · THE LEVEL LADDER IS REAL. The old arena recipe was silently
       level-invariant — a level-3 building was a byte-identical mesh. Every
       recipe here is hashed over its full concatenated vertex buffer at each
       level, and the three hashes must differ.
     · THE SEED IS THE TILE. The same type is drawn on two different tiles and
       the hashes must DIFFER (a property of the plot), and the same tile is
       repainted twice and the hashes must MATCH (not a property of the moment).
   Draw calls come out of renderer.info after a REAL render with the shadow
   pass on and autoReset off — see arenacost.mjs for why both matter.
   Usage: node .gauntlet/seams-cost.mjs */
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
const ROOT=path.resolve(process.cwd(),'public'), THREE_='/home/user/Playmythicspellbook/.gauntlet/package';
const MIME={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css',
 '.json':'application/json','.png':'image/png','.jpg':'image/jpeg','.svg':'image/svg+xml',
 '.glb':'model/gltf-binary','.txt':'text/plain','.webp':'image/webp'};
const PORT=8900+(process.pid%90);
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
await page.evaluate(fs.readFileSync(path.resolve(process.cwd(),'.gauntlet/scene.js'),'utf8'));
await page.waitForTimeout(2500);

const out=await page.evaluate(()=>{
  const nc=window.__nc, {renderer,THREE}=nc.three();
  const TYPES=['waterintake','deepmine','alloyworks','canecroft','riftbore'];
  const REF=['scrapmine','purifier','office'];      // shipped neighbours, for scale
  const h32=(s)=>{let h=0x811c9dc5;for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,0x01000193)>>>0;}return h.toString(16).padStart(8,'0');};
  const fingerprint=(g)=>{const parts=[];g.traverse(o=>{if(!o.isMesh)return;
    const a=o.geometry.attributes.position.array;let s=0,x=0;
    for(let i=0;i<a.length;i++){s+=a[i];x=(x*31+Math.round(a[i]*1e5))|0;}
    parts.push(a.length+':'+s.toFixed(4)+':'+(x>>>0));});
    return h32(parts.sort().join('|'));};
  const measure=(k)=>{
    const g=nc.game.tiles[k].mesh;
    let meshes=0,tris=0,verts=0,casters=0;const geos=new Set();
    g.traverse(o=>{if(!o.isMesh)return;meshes++;if(o.castShadow)casters++;
      const q=o.geometry;geos.add(q.uuid);
      tris+=(q.index?q.index.count:q.attributes.position.count)/3;
      verts+=q.attributes.position.count;});
    const probe=new THREE.Scene();
    const clone=g.clone(true);clone.position.set(0,0,0);probe.add(clone);
    const cam=new THREE.PerspectiveCamera(45,4/3,.1,50);
    cam.position.set(1.6,1.4,2.2);cam.lookAt(0,.3,0);
    const light=new THREE.DirectionalLight(0xffffff,1);light.castShadow=true;
    light.position.set(2,4,2);probe.add(light);probe.add(new THREE.AmbientLight(0xffffff,.4));
    const sw=renderer.shadowMap.enabled;renderer.shadowMap.enabled=true;
    const aw=renderer.info.autoReset;renderer.info.autoReset=false;
    renderer.info.reset();renderer.render(probe,cam);
    const calls=renderer.info.render.calls;
    renderer.info.autoReset=aw;renderer.shadowMap.enabled=sw;
    const bb=new THREE.Box3().setFromObject(g);
    return {meshes,casters,tris,verts,geometries:geos.size,drawCallsBothPasses:calls,
            hash:fingerprint(g),
            bbox:{x:+(bb.max.x-bb.min.x).toFixed(3),y:+(bb.max.y-bb.min.y).toFixed(3),z:+(bb.max.z-bb.min.z).toFixed(3)}};
  };
  const rows=[],notes=[];
  /* Free ground, well clear of the standard district (grid is 0..23; the
     district lives around C=12). Written straight onto game.tiles and repainted
     through the shipped seam — tryPlace's GROUND GATE is not the subject here
     and is proved separately by drive-seams.mjs. */
  const SLOTS=[[1,1],[2,1],[3,1],[4,1],[5,1],[1,3],[2,3]];
  const place=(type,i)=>{const [x,z]=SLOTS[i];const k=x+','+z;
    nc.game.tiles[k]={type,lvl:1,damaged:false};nc.repaint(k);return k;};
  for (const type of TYPES.concat(REF)) {
    const k=place(type,0);
    const per={type,levels:{}};
    for (const lvl of [1,2,3]) { nc.game.tiles[k].lvl=lvl; nc.repaint(k); per.levels[lvl]=measure(k); }
    // level-invariance
    const hs=[1,2,3].map(l=>per.levels[l].hash);
    per.levelVaries = new Set(hs).size===3;
    per.hashes=hs;
    // seeded on the TILE: a second tile must differ, a repaint must not
    const k2=place(type,1); nc.game.tiles[k2].lvl=1; nc.repaint(k2);
    const h2=measure(k2).hash;
    nc.game.tiles[k].lvl=1; nc.repaint(k);
    const h1a=measure(k).hash; nc.repaint(k); const h1b=measure(k).hash;
    per.tileSeeded = (h1a!==h2);
    per.repaintStable = (h1a===h1b);
    rows.push(per);
    delete nc.game.tiles[k]; delete nc.game.tiles[k2];
  }
  return {rows,tileHash:null};
});
const R=out.rows;
const fmt=(n)=>String(n).padStart(6);
console.log('\ntype          lvl  meshes  tris   verts  geos  drawCalls(2 passes)  bbox x/y/z');
for (const r of R) for (const l of [1,2,3]) {
  const m=r.levels[l];
  console.log((l===1?r.type.padEnd(13):'             ')+' '+l+fmt(m.meshes)+fmt(m.tris)+fmt(m.verts)+fmt(m.geometries)+fmt(m.drawCallsBothPasses)+'      '+m.bbox.x+' / '+m.bbox.y+' / '+m.bbox.z);
}
console.log('\nlevel ladder / seeding:');
for (const r of R) console.log('  '+r.type.padEnd(13)+
  ' levelVaries='+String(r.levelVaries).padEnd(6)+
  ' tileSeeded='+String(r.tileSeeded).padEnd(6)+
  ' repaintStable='+String(r.repaintStable).padEnd(6)+
  ' hashes '+r.hashes.join(' '));
console.log('\nconsole errors: '+JSON.stringify(errs.slice(-6)));
await browser.close(); server.close();
