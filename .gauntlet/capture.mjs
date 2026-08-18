/* Multi-shot capture: boots the city, builds the standard district, then
   takes N framed shots. One browser boot for all shots (boot is ~25 s).
   Usage: node .gauntlet/capture.mjs <outDir> [--tag name] */
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';

/* cwd-relative so a builder can run this inside its own git worktree.
   THREE_ stays absolute: the vendored tarball is gitignored and therefore
   absent from every worktree. */
const ROOT=path.resolve(process.cwd(),'public'), THREE_='/home/user/Playmythicspellbook/.gauntlet/package';
const MIME={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css',
 '.json':'application/json','.png':'image/png','.jpg':'image/jpeg','.svg':'image/svg+xml',
 '.glb':'model/gltf-binary','.txt':'text/plain','.webp':'image/webp'};
const arg=(f,d)=>{const i=process.argv.indexOf(f);return i>0?process.argv[i+1]:d};
const outDir=process.argv[2]||'.gauntlet/shots'; const TAG=arg('--tag','shot');
const PORT=8600+(process.pid%90);
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
const page=await browser.newPage({viewport:{width:1600,height:900},deviceScaleFactor:1,ignoreHTTPSErrors:true});
await page.route('**/*',r=>{const u=r.request().url();
 (u.includes('127.0.0.1')||u.includes('localhost')||u.includes('jsdelivr'))?r.continue():r.abort()});
await page.route('**/cdn.jsdelivr.net/npm/three@0.171.0/**',r=>{
 const rel=new URL(r.request().url()).pathname.replace('/npm/three@0.171.0/','');
 const f=path.join(THREE_,rel);
 fs.existsSync(f)?r.fulfill({status:200,contentType:'text/javascript',body:fs.readFileSync(f)})
                 :r.fulfill({status:404,body:'nf'})});
/* ── 🕒 PIN THE CLOCK ──────────────────────────────────────────────────────
   estClock() (index.html:4096) reads the REAL wall clock — "the sun rises when
   YOUR sun rises", no compression. So every round was photographed at whatever
   time of day the harness happened to run: r0 and r1 landed mid-afternoon, r2
   landed at 20:17. The round-2 lighting work was MEASURED at 15:00 and
   PHOTOGRAPHED at night, and manageAgents() culls the crowd at nightfall — which
   is why a round that moved the sunlit:shaded ratio to 2.67x scored 4/10 for
   lighting and 0/10 for vehicles.
   A blind A/B between rounds is worthless if the two frames are different times
   of day, so the hour is now a harness constant. Date is SHIFTED, not frozen:
   time still advances, so anything deriving a dt still works. */
const PIN_HOUR = +(process.argv.includes('--hour') ? process.argv[process.argv.indexOf('--hour')+1] : 15);
await page.addInitScript(({ hour }) => {
  const _D = Date;
  const now = new _D();
  /* Where the page's own clock reads now, in America/New_York. */
  const parts = {};
  for (const p of new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York',
        hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).formatToParts(now))
    parts[p.type] = p.value;
  const curH = (+parts.hour % 24) + (+parts.minute) / 60 + (+parts.second) / 3600;
  const shiftMs = (hour - curH) * 3600 * 1000;
  class ShiftedDate extends _D {
    constructor(...a) { if (a.length === 0) super(_D.now() + shiftMs); else super(...a); }
    static now() { return _D.now() + shiftMs; }
  }
  ShiftedDate.parse = _D.parse; ShiftedDate.UTC = _D.UTC;
  window.Date = ShiftedDate;
}, { hour: PIN_HOUR });

const logs=[]; page.on('console',m=>logs.push(`[${m.type()}] ${m.text()}`.slice(0,300)));
page.on('pageerror',e=>logs.push(`[pageerror] ${e.message}`.slice(0,300)));

await page.goto(`http://127.0.0.1:${PORT}/node-city/index.html`,{waitUntil:'load',timeout:120000});
await page.waitForTimeout(24000);
const built=await page.evaluate(fs.readFileSync(path.resolve(process.cwd(),'.gauntlet/scene.js'),'utf8'));
await page.waitForTimeout(6000);

/* ── FRAMINGS, DERIVED FROM THE ACTUAL MESHES ──────────────────────────────
   Hardcoded camera coords were pointing at empty ground: placeMeshAt owns the
   tile→world mapping and it is not the identity, so the only honest way to
   frame the district is to read the bounding box of what got placed. Three
   shots that mirror the CS2 reference set: a low aerial over the whole
   district, an eye-level street view, and a mid aerial over one block. */
/* ── FRAMINGS, DERIVED FROM THE ACTUAL MESHES ──────────────────────────────
   placeMeshAt owns the tile→world mapping and it is not the identity, so the
   only honest way to frame is to read where things actually ended up.
   ⚠ THE STREET SHOT IS PLACED ON A ROAD, not guessed from the bounding box.
   Two earlier attempts put the eye above the mid-rise blocks and looked down
   at rooftops — and the round-1 critic scored vehicles 1/10 and citizens 2/10
   against a frame that could not contain either. Sit on the carriageway and
   look ALONG it, which is what the CS2 street reference is. */
const frame = await page.evaluate(() => {
  const nc = window.__nc; const P = [];
  const roads = [];
  for (const t of Object.values(nc.game.tiles)) {
    if (!t.mesh) continue;
    P.push([t.mesh.position.x, t.mesh.position.z]);
    if (t.type === 'road') roads.push({ x: t.mesh.position.x, z: t.mesh.position.z });
  }
  if (!P.length) return null;
  const xs = P.map(p => p[0]), zs = P.map(p => p[1]);
  const box = { x0: Math.min(...xs), x1: Math.max(...xs), z0: Math.min(...zs), z1: Math.max(...zs), n: P.length };
  const cx = (box.x0 + box.x1) / 2, cz = (box.z0 + box.z1) / 2;
  /* ── WHICH east-west run to sit on ────────────────────────────────────────
     Was "the longest, nearest the centre", which on this district picks the
     row through the middle of the empty half of the map: 19 road tiles with
     three buildings on them. A street reference frame is a street WITH A
     FRONTAGE — the bar's night frame is a crossing between two built-up
     blocks — and the kerbside parking only exists where there IS a frontage,
     so the row with the most built neighbours is both the more honest street
     and the one that can contain what this round added. Length still counts;
     distance from centre is now the tie-break it always should have been. */
  const isPlot = (t) => t && t.type !== 'road' && t.type !== 'anchor';
  const rows = {};
  for (const r of roads) (rows[r.z.toFixed(2)] ||= []).push(r.x);
  let best = null;
  for (const z in rows) {
    const xsr = rows[z].sort((a, b) => a - b);
    let front = 0;
    for (const t of Object.values(nc.game.tiles)) {
      if (!t.mesh || !isPlot(t)) continue;
      if (Math.abs(t.mesh.position.z - +z) < 1.01 && Math.abs(t.mesh.position.z - +z) > .5) front++;
    }
    const score = front * 2 + xsr.length - Math.abs(+z - cz) * .5;
    if (!best || score > best.score) best = { z: +z, xs: xsr, score, front };
  }
  return { box, cx, cz, road: best };
});
const box = frame && frame.box;
const cx = frame ? frame.cx : 0, cz = frame ? frame.cz : 0;
const span = box ? Math.max(box.x1 - box.x0, box.z1 - box.z0) : 20;
/* ── 👁 EYE HEIGHT ─────────────────────────────────────────────────────────
   The line that used to sit here read "eye height ~1.2 world units above the
   carriageway; a house is ~2.5 tall here". THE SECOND HALF WAS WRONG BY A
   FACTOR OF THREE and it invalidated the first: the storey height in this city
   is SH = 0.34 (makeHousing / the mid-rise recipe both), so a two-storey house
   with its roof is about 0.9 and a five-storey block about 1.9. An eye at 1.15
   is therefore a FOURTH-FLOOR window, not a pavement — which is why the
   "street" frame has been a low aerial down a boulevard for three rounds, and
   why nothing the size of a car (0.19 tall) or a citizen (0.35) could ever
   read in it. A person's eye is ~0.30. That is the number.
   The lateral offsets put the camera in the near lane looking slightly across
   the carriageway, so the far kerb — which is the side /src/parking cuts its
   bays into — is in shot rather than under the lens. */
const R = frame && frame.road;
const street = R && R.xs.length > 3
  ? { cam: [R.xs[1], .30, R.z - .12], tgt: [R.xs[R.xs.length - 2], .26, R.z + .10] }
  : { cam: [cx - span * .34, .30, cz], tgt: [cx + span * .3, .26, cz] };
const SHOTS = [
 { n: 'aerial',   cam: [cx + span * .62, span * .55, cz + span * .62], tgt: [cx, 0, cz] },
 { n: 'street',   cam: street.cam, tgt: street.tgt },
 { n: 'district', cam: [cx + span * .26, span * .22, cz + span * .34], tgt: [cx - span * .06, 0, cz - span * .06] },
];
fs.mkdirSync(outDir,{recursive:true});
/* 🎥 RELAX THE PLAYER-CAMERA CLAMPS FOR THE DURATION OF THE CAPTURE.
   OrbitControls is set up for a player: minDistance 6, maxPolarAngle Math.PI*.46
   = 82.8° (index.html:3957). Every controls.update() re-derives the camera from
   those clamps, so an eye-level street request is rewritten to a rooftop one —
   and it is not enough to set the camera AFTER update(), because animate() runs
   update() again during the settle before the shutter and takes it straight
   back. Setting the limits once, here, is the only place the fight ends.
   This moves the CAMERA and nothing else: no light, no material, no clock. */
await page.evaluate(()=>{const c=window.__nc.controls;
  c.maxPolarAngle=Math.PI*.4995; c.minDistance=.05; c.enableDamping=false;});
const made=[];
for(const s of SHOTS){
  await page.evaluate(([c,t])=>{const nc=window.__nc;
    nc.camera.position.set(c[0],c[1],c[2]); nc.controls.target.set(t[0],t[1],t[2]);
    nc.controls.update();
    /* 🎥 …AND THEN OVERRIDE WHAT controls.update() JUST DID TO US.
       OrbitControls is configured for a PLAYER's camera: minDistance 6 and
       maxPolarAngle Math.PI*.46 (82.8°), i.e. "you may never get closer than 6
       units and you may never drop to the horizon" (index.html:3957). update()
       re-derives the camera position from those clamps, so an eye-level street
       request — target 16 units away, 4cm of rise — is silently rewritten to
       phi = 82.8°, which puts the camera at y ≈ 2.3: above every roof on the
       street. THAT is why the "street" frame has been a low aerial down a
       boulevard for three rounds, and no fiddling with the requested height
       could ever have fixed it — 0.30 and 1.15 both come out at 2.3.
       The target is still written first, because bubbleTick and the tile
       picker read controls.target; only the camera transform is taken back. */
    nc.camera.position.set(c[0],c[1],c[2]);
    nc.camera.lookAt(t[0],t[1],t[2]);
    nc.camera.updateMatrixWorld(); nc.camera.updateProjectionMatrix();
    /* 🔭 RE-CULL AGAINST THE CAMERA WE ARE ABOUT TO SHOOT FROM.
       cullAgents() hides agents past QUALITY.cull and it only ever runs from
       animate(). rAF is dead here, so the last cull was performed with the BOOT
       camera — and under SwiftShader the quality governor has already fallen to
       the 'potato' tier, whose 15-unit radius is smaller than the 18-unit
       district. Result, measured on the round-2 build: 29 agents alive, 29 of
       them visible=false, and a with-crowd/without-crowd pixel diff of exactly
       ZERO on the aerial frame. That is the whole of "spawning them is not the
       same problem as photographing them".
       The radius override says "photograph what a player on a real GPU sees" —
       tier 'high' is cull 40 — and it is deliberately the ONLY quality knob the
       harness touches: raising QUALITY.i outright would also change shadow map
       resolution and fog, and a round-over-round A/B is worthless if the two
       frames were lit differently. Same rule as the pinned clock. */
    try { nc.cullAgents(90); } catch (e) {}
    const {renderer,scene,camera}=nc.three(); renderer.render(scene,camera);
  },[s.cam,s.tgt]);
  await page.waitForTimeout(1500);
  /* Re-assert and re-render IMMEDIATELY before the shutter. The settle above is
     for anything that loads lazily, and rAF — which fires about once a second
     in this box — runs animate() during it. */
  await page.evaluate(([c,t])=>{const nc=window.__nc;
    nc.camera.position.set(c[0],c[1],c[2]); nc.controls.target.set(t[0],t[1],t[2]);
    nc.camera.lookAt(t[0],t[1],t[2]);
    nc.camera.updateMatrixWorld(); nc.camera.updateProjectionMatrix();
    try { nc.cullAgents(90); } catch (e) {}
    const {renderer,scene,camera}=nc.three(); renderer.render(scene,camera);
  },[s.cam,s.tgt]);
  const f=path.join(outDir,`${TAG}-${s.n}.png`);
  await page.screenshot({path:f}); made.push(f);
  /* A committable twin. Full PNGs are ~1.5 MB each and the loop makes three a
     round, so the RECORD that goes in git (and into the progress page) is the
     jpeg; the png stays local for pixel-level critique. */
  await page.screenshot({path:path.join(outDir,`${TAG}-${s.n}.jpg`),type:'jpeg',quality:72});
}
/* 📷 WHAT ACTUALLY REACHED THE FILM. `built.crowd` is a CENSUS and rounds 1 and
   2 both proved a census says nothing about a photograph — 29 agents, 0 pixels.
   This projects every agent and every parked vehicle into the LAST framing and
   counts the ones inside the frustum that are also visible, which is the number
   a critic is being asked to count. */
const onFilm=await page.evaluate(()=>{const nc=window.__nc,{camera,THREE}=nc.three();
  camera.updateMatrixWorld();camera.updateProjectionMatrix();
  const v=new THREE.Vector3();
  const seen=o=>{o.getWorldPosition(v);v.project(camera);
    return v.x>=-1&&v.x<=1&&v.y>=-1&&v.y<=1&&v.z<=1};
  const A=nc.agents().filter(a=>a.mesh.visible&&seen(a.mesh));
  let P=[];try{P=(window.MythicParking?window.MythicParking.group().children:[])
    .filter(o=>o.isGroup&&seen(o))}catch(e){}
  return{agentsInFrame:A.length,byKind:A.reduce((a,g)=>(a[g.kind]=(a[g.kind]||0)+1,a),{}),
         parkedInFrame:P.length,
         vehiclesInFrame:A.filter(a=>a.kind!=='civilian').length+P.length}});
const diag=await page.evaluate(()=>{const{renderer,scene}=window.__nc.three();
  let m=0;scene.traverse(o=>{if(o.isMesh)m++});
  return{meshes:m,geoms:renderer.info.memory.geometries,tris:renderer.info.render.triangles}});
console.log(JSON.stringify({built,box,made,diag,onFilm,logs:logs.slice(-10)},null,2));
await browser.close(); server.close();
