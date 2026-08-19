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
/* ⚠ ARGV GUARD. An agent ran `capture.mjs --help`, the script took "--help" as
   the output directory and cheerfully wrote six files into ./--help/. Neither a
   usage message nor any validation existed. Both do now — a flag can never be
   mistaken for a path. */
const USAGE = `
  node .gauntlet/capture.mjs <outDir> [options]

    <outDir>            where the five framings are written (required)
    --tag <name>        filename prefix; default "shot"
    --hour <0-23>       pin the in-game clock; default 15 (do not un-pin: the
                        game reads the real wall clock, so an unpinned capture
                        is shot at whatever hour it happens to run)
    --against <dir>     diff each framing against the same framing in <dir> and
                        warn when one barely moved

  Writes <tag>-aerial, <tag>-street, <tag>-district, <tag>-frontage and
  <tag>-venue as .png and .jpg, and prints
  JSON with the scene bounding box, mesh/triangle counts and console output.
`;
if (process.argv.includes('--help') || process.argv.includes('-h') || !process.argv[2]) {
  console.log(USAGE); process.exit(process.argv[2] ? 0 : 1);
}
if (process.argv[2].startsWith('-')) {
  console.error(`\n  The first argument is the output directory, not a flag (got "${process.argv[2]}").\n${USAGE}`);
  process.exit(1);
}
const outDir=process.argv[2]; const TAG=arg('--tag','shot');
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
 /* ⚠ data: MUST be allowed. The per-framing diff hands the page two PNGs as
    data URIs, and without this the catch-all aborted them — the diff returned
    null and the gate silently did nothing, which is the same class of failure
    the gate exists to catch. */
 (u.startsWith('data:')||u.includes('127.0.0.1')||u.includes('localhost')||u.includes('jsdelivr'))?r.continue():r.abort()});
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
  /* 🧱 WHICH SIDE OF THAT ROAD IS THE FRONTAGE — needed by the fourth framing
     below, and derived here because this is where the tiles are already in
     hand. A plot one tile off the carriageway fronts it; count both sides and
     take the busier one. Ties break to +z, which is arbitrary and deterministic
     (a tie means both sides are equally built, so either is an honest choice —
     what must never happen is that it varies between two boots). */
  let sideNeg = 0, sidePos = 0;
  if (best) for (const t of Object.values(nc.game.tiles)) {
    if (!t.mesh || !isPlot(t)) continue;
    const d = t.mesh.position.z - best.z;
    if (Math.abs(Math.abs(d) - 1) < .35) { if (d < 0) sideNeg++; else sidePos++; }
  }
  /* 🏟 WHERE THE CIVIC LANDMARK IS — needed by the fifth framing below, and
     read here for the same reason everything else in this block is: the tiles
     are already in hand and placeMeshAt owns the tile->world mapping. The
     ROTATION comes with it, because the arena has a front and a framing that
     photographed its back would be no better than one that photographed
     nothing. rot is quarter-turns about +y and the recipe's entrance is on
     +z, so the outward normal of the entrance is (sin, cos) of rot*90deg. */
  let venue = null;
  for (const t of Object.values(nc.game.tiles)) {
    if (!t.mesh || t.type !== 'arena') continue;
    const a = ((t.rot | 0) & 3) * Math.PI / 2;
    venue = { x: t.mesh.position.x, z: t.mesh.position.z, fx: Math.sin(a), fz: Math.cos(a) };
    break;
  }
  return { box, cx, cz, road: best, side: sidePos >= sideNeg ? 1 : -1,
           sideCount: { pos: sidePos, neg: sideNeg }, venue };
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
/* ── 🧱 THE FOURTH FRAMING: `frontage` ─────────────────────────────────────
   ADDED ROUND 12, AND THE THREE ABOVE ARE UNTOUCHED ON PURPOSE — rounds 0-9
   are all captured with them and moving one would break every historical
   comparison this project has.

   WHY IT EXISTS. The round-9 parcel critic, on the aerial: "I can see no
   difference at all. The rear walls are occluded by the roofs that stand in
   front of them at this angle, and the foundation planting is below the eaves.
   The framing this dimension has historically been judged from does not contain
   the change." That is true of all three: the aerial and the district shot look
   DOWN, where a roof covers its own plot; the street shot sits at 0.30 in the
   carriageway looking ALONG it, where the frontage is edge-on and every ground
   feature is one pixel of grazing incidence.

   WHAT IT IS. A raking three-quarter view DOWN a frontage: the eye just under
   the eaves, in the road corridor two units back along the built row, looking
   DOWN at a point on the ground at the foot of the building line. That geometry
   is what puts a lawn, a drive, a kerb, a verge, a foundation bed and the line
   where a wall meets its ground into the same frame, receding — none of which
   any of the three existing framings contains.

   ⚠ 0.80, NOT 0.30 AND NOT 2.0. SH = 0.34, so a two-storey house with its roof
     is ~0.9. An eye at 0.30 (the street shot's) is level with the ground floor
     and the near plot hides everything past it; an eye above 0.9 is a low
     aerial and the roof planes come back. 0.80 is just under the eaves — high
     enough to see over a garden wall, a hedge and a parked car onto the ground
     behind them, low enough that no roof is looked down on.
   ⚠ ~19° OF DEPRESSION, AND THE CAMERA STAYS INSIDE THE ROAD CORRIDOR. The
     depression is the whole framing: it is what gives the strip of ground in
     front of a building actual AREA in the image, where at the street shot's
     ~1° it is a line one pixel high. It cannot be bought by standing further
     back — plots are 1 unit and the carriageway is 0.40 wide, so |z - R.z|
     above ~0.45 puts the lens INSIDE the building on the opposite side, which
     is exactly what the first cut did: half the frame was the interior face of
     a wall. It is bought by standing CLOSE and looking down.
   ⚠ TARGETED AT y = 0.02, i.e. AT THE GROUND, not at the building. The whole
     point of this framing is the join, so the join is what the lens is on.
   ⚠ DERIVED, NEVER HARDCODED — same rule as the other three. It hangs off the
     road row the street shot already chose and off `frame.side`, the side of it
     with more plots on it, so it cannot drift onto open grass the first time
     the district changes shape. */
const SIDE = (frame && frame.side) || 1;
const fx = R && R.xs.length > 4 ? R.xs[Math.min(R.xs.length - 2, 6)] : cx;
const frontage = R && R.xs.length > 4
  ? { cam: [fx - 2.0, .80, R.z - SIDE * .34],
      tgt: [fx + .10, .02, R.z + SIDE * .50] }
  : { cam: [cx - 2.0, .80, cz - .34], tgt: [cx + .10, .02, cz + .50] };
/* -- 🏟 THE FIFTH FRAMING: `venue` ----------------------------------------
   ADDED ROUND 15, AND aerial / street / district ARE UNTOUCHED — rounds 0-14
   are captured with them and moving one breaks every historical comparison in
   this project. `frontage` (round 12) is the precedent for adding rather than
   editing, and this is the second time the answer has been "the frame does not
   contain the thing being judged".

   WHY IT EXISTS. The round-14 critic, on the district's most expensive unlock:
   "The Duel Arena is in no photograph. It projects through the aerial camera to
   (1299, 435); the Zone Demand panel's opaque left edge is at x = 1266-1267. It
   is 33 px behind the UI, and off the right edge of the district framing."
   That is arithmetic, not taste: the arena sits at tile (C+6, C-6) = world
   (6.5, -5.5), which is the far +x, far -z corner of a bounding box the aerial
   frames from the +x, +z corner, so it lands hard against the right edge —
   under the one panel the capture does not hide. Three development points, the
   priciest node in `gates`, for a building no critic has ever seen.

   WHY NOT MOVE THE TILE INSTEAD. That was the other option in the brief and it
   was rejected: `layout.tileHash` is b1f8cdea and it is the guarantee that an
   A/B between two rounds compares RENDERS AND NOT LAYOUTS. Moving the arena
   changes every key in that hash, so r14 vs r15 would silently become two
   different cities — the exact failure the hash was added to make impossible.
   A framing costs one screenshot and invalidates nothing.

   WHAT IT IS. A three-quarter hero of the arena from in front of its entrance:
   the eye at 1.30 with ~21 degrees of depression, ~2.8 units out, so the frame
   carries the podium, the full elevation, the roofline AND the plaza it stands
   on — a building whose whole argument is its silhouette cannot be judged from
   above it. The camera is swung to the entrance side off the tile's own
   rotation, and the housing block at (C+1..C+3, C-7..C-5) sits behind it, which
   is deliberate: the brief for the arena is that it must not look like it came
   from a different game than the street it stands on, and the only way to score
   that is to put both in one frame.
   ⚠ DERIVED, NEVER HARDCODED — same rule as the other four. No arena in the
     scene (a future district, or a refused placement) falls back to the
     district framing rather than pointing the lens at empty ground. */
const V = frame && frame.venue;
const venue = V
  ? { cam: [V.x + V.fx * 2.35 + V.fz * 1.45, 1.30, V.z + V.fz * 2.35 - V.fx * 1.45],
      tgt: [V.x, .26, V.z] }
  : { cam: [cx + span * .26, span * .22, cz + span * .34], tgt: [cx - span * .06, 0, cz - span * .06] };
const SHOTS = [
 { n: 'aerial',   cam: [cx + span * .62, span * .55, cz + span * .62], tgt: [cx, 0, cz] },
 { n: 'street',   cam: street.cam, tgt: street.tgt },
 { n: 'district', cam: [cx + span * .26, span * .22, cz + span * .34], tgt: [cx - span * .06, 0, cz - span * .06] },
 { n: 'frontage', cam: frontage.cam, tgt: frontage.tgt },
 { n: 'venue',    cam: venue.cam, tgt: venue.tgt },
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
const made=[]; const onFilm={};
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
    /* 🏷 THE ROAD-PAINT RE-FACE THAT USED TO LIVE HERE IS GONE WITH THE PAINT.
       /src/streets no longer lays street names on the carriageway (round 11),
       so there is nothing left to turn towards the camera and `orientLabels`
       no longer exists on the module. The comment survives because the shape of
       the bug it fixed — state last computed against the BOOT camera riding into
       a hand-framed screenshot — is exactly the cull problem directly above,
       and the next thing that caches anything per-camera will hit it too. */
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
  onFilm[s.n]=await onFilmAt();
  const f=path.join(outDir,`${TAG}-${s.n}.png`);
  await page.screenshot({path:f}); made.push(f);
  /* A committable twin. Full PNGs are ~1.5 MB each and the loop makes three a
     round, so the RECORD that goes in git (and into the progress page) is the
     jpeg; the png stays local for pixel-level critique. */
  await page.screenshot({path:path.join(outDir,`${TAG}-${s.n}.jpg`),type:'jpeg',quality:72});
}
/* 📷 WHAT ACTUALLY REACHED THE FILM. `built.crowd` is a CENSUS and rounds 1 and
   2 both proved a census says nothing about a photograph — 29 agents, 0 pixels.
   This projects every agent, every parked vehicle and every standing citizen
   into a framing and counts the ones inside the frustum that are also visible,
   which is the number a critic is being asked to count.
   ⚠ PER FRAMING, NOT ONCE AT THE END. It used to run after the loop, with the
     camera wherever the last shot had left it, and printed ONE number labelled
     as if it described the round. Three rounds of "the citizens are missing"
     were argued over that number while the two framings it did not describe
     went unmeasured. */
async function onFilmAt() { return page.evaluate(()=>{const nc=window.__nc,{camera,THREE}=nc.three();
  camera.updateMatrixWorld();camera.updateProjectionMatrix();
  const v=new THREE.Vector3();
  const seen=o=>{o.getWorldPosition(v);v.project(camera);
    return v.x>=-1&&v.x<=1&&v.y>=-1&&v.y<=1&&v.z<=1};
  const A=nc.agents().filter(a=>a.mesh.visible&&seen(a.mesh));
  let P=[];try{P=(window.MythicParking?window.MythicParking.group().children:[])
    .filter(o=>o.isGroup&&seen(o))}catch(e){}
  /* 🚶 THE STANDING CROWD IS NOT AN AGENT and it is not one object per person
     either — /src/crowd bakes the whole crowd into merged buckets, so a
     traverse would count buckets, not people. Its spots() list is the census,
     projected the same way everything else here is. */
  let S=0,ST=-1;try{const v2=new THREE.Vector3();
    const sp=(window.MythicCrowd?window.MythicCrowd.spots():[]);
    ST=sp.length;
    for(const q of sp){v2.set(q.x,0.17,q.z).project(camera);
      if(v2.x>=-1&&v2.x<=1&&v2.y>=-1&&v2.y<=1&&v2.z<=1)S++}}catch(e){}
  /* 🏟 IS THE CIVIC LANDMARK ACTUALLY IN THIS PICTURE, AND IS THE UI ON TOP OF
     IT. Round 14: "The Duel Arena is in no photograph. It projects through the
     aerial camera to (1299, 435); the Zone Demand panel's opaque left edge is
     at x = 1266-1267. It is 33 px behind the UI." That finding took a critic
     projecting a camera by hand, and it stood for a whole round because nothing
     reported it. It is four lines. `pxUnderPanel` is the part `inFrame` cannot
     tell you: a building can be dead centre of the frustum and still be behind
     an opaque panel, which is exactly what happened. Panel geometry is read
     from the live DOM, never hardcoded — it moves when the layout does. */
  let venue=null;
  try{
    const t=Object.values(nc.game.tiles).find(q=>q.type==='arena'&&q.mesh);
    if(t){const v3=new THREE.Vector3();t.mesh.getWorldPosition(v3);v3.y+=0.5;v3.project(camera);
      const W=innerWidth,H=innerHeight;
      const px=Math.round((v3.x*.5+.5)*W), py=Math.round((-v3.y*.5+.5)*H);
      const inF=v3.x>=-1&&v3.x<=1&&v3.y>=-1&&v3.y<=1&&v3.z<=1;
      /* ⚠ "IS THERE A DIV OVER IT" IS NOT THE TEST, and two cuts of this got
         it wrong before it agreed with the round-14 critic's own reading. The
         first walked every div and answered `scene` for all five framings —
         the canvas's host element covers the whole viewport and is a div. The
         second demanded an opaque backgroundColor and answered NO for the
         aerial, where the Zone Demand panel demonstrably covers the arena,
         because that panel paints with a background-image. The honest test is
         the browser's own hit list at the pixel: elementsFromPoint, minus the
         canvas and anything containing it. */
      let under=false,panel=null;
      for(const el of document.elementsFromPoint(px,py)){
        if(el.tagName==='CANVAS'||el.querySelector&&el.querySelector('canvas'))continue;
        if(el===document.body||el===document.documentElement)continue;
        const st=getComputedStyle(el);
        if(st.pointerEvents==='none'&&parseFloat(st.opacity||'1')<.5)continue;
        const r=el.getBoundingClientRect(); if(r.width<80||r.height<40)continue;
        under=true; panel=el.id||(typeof el.className==='string'?el.className:'')||el.tagName; break;
      }
      venue={px,py,inFrame:inF,pxUnderPanel:under,panel};}
  }catch(e){venue={err:String(e)}}
  return{agentsInFrame:A.length,byKind:A.reduce((a,g)=>(a[g.kind]=(a[g.kind]||0)+1,a),{}),
         parkedInFrame:P.length, standingInFrame:S, standingTotal:ST,
         peopleInFrame:A.filter(a=>a.kind==='civilian').length+S,
         vehiclesInFrame:A.filter(a=>a.kind!=='civilian').length+P.length, arena:venue}})}
/* ── 🔬 THE CROSS-BOOT TRIPWIRE ────────────────────────────────────────────
   🔴 THIS IS NOT A MEASUREMENT AND ITS PERCENTAGES MUST NOT BE QUOTED AS ONE.
   Read that first, because they were, for several rounds.

   MEASURED, WITH LITERALLY NOTHING CHANGED — the same commit, the same pinned
   hour, two boots of this same script — the aerial framing came back 14.70 pp
   and 15.90 pp different from itself. A real parcel-scale change is worth about
   2.45 pp on that framing. THE NULL CONTROL IS SIX TIMES THE SIGNAL. Every
   absolute per-framing figure this gate has ever printed was inside its own
   noise, and `NULL_CONTROL_PP` below is printed beside the numbers so that can
   never quietly stop being true.

   ⚠ AND `perimeterScenery` IS NOT THE CAUSE. public/src/parcel/FIX-RECORD.md
     blames it ("rolls from Math.random and fills the aerial's background"); it
     is wrong. That function seeds every roll off `rdRng`, the file's own tile
     hash, and its two merged buckets hash IDENTICALLY across two boots — checked
     per scene-graph group, not inferred. Hiding every agent, every parked
     vehicle and the entire standing crowd moves the cross-boot figure from
     14.70 pp to 14.68 pp: the moving things are not the cause either.
     What actually happens is that EVERY PIXEL MOVES A LITTLE. estClock() runs
     on wall time, two boots reach the shutter a few seconds apart, and the
     resulting mean delta of ~2.7/255 across the whole frame trips a 6/255
     threshold on a seventh of the image. A scene this busy has no quiet pixels
     (README, item 5). Even within ONE boot, two shots 5 s apart differ by
     6.14 pp.

   🔵 THE INSTRUMENT FOR "HOW MUCH DID MY CHANGE DO" IS `layer-ab.mjs`:
      one boot, one camera, `renderer.render()` and the pixel read in the SAME
      TASK, and a do-nothing control that comes back at exactly 0. Use that for
      a number. Use this for a RATIO.

   WHAT IS STILL WORTH HAVING. The comparison this gate was built for is
   relative, and relative survives a common-mode noise floor: round 5's ground
   work moved the aerial 48.9 % and the street frame 4 % — a 12x spread that no
   plausible drift explains, and nobody noticed for two rounds. So what is
   reported is the RATIO between framings and the warning when one of them is
   far behind the others; the raw percentages are kept only because the ratio is
   made of them.

   Pure JPEG byte-sampling would be meaningless (recompression), so this decodes
   both PNGs through the page that is already open — no new dependency. */
/* Measured on this scene, aerial framing, two boots, nothing changed. Re-measure
   it with `noise-floor.mjs` if the scene or the pinned hour ever changes;
   a floor nobody re-measures is a floor nobody believes. */
const NULL_CONTROL_PP = { aerial: '14.7 - 15.9', sameBoot5s: '6.1', note: 'nothing changed at all' };
async function diffAgainst(prevDir, tag, names) {
  if (!prevDir || !fs.existsSync(prevDir)) return null;
  const out = {};
  for (const n of names) {
    const a = path.join(outDir, `${tag}-${n}.png`);
    const bCand = fs.readdirSync(prevDir).filter(f => f.endsWith(`-${n}.png`));
    if (!fs.existsSync(a) || !bCand.length) { out[n] = null; continue; }
    const b = path.join(prevDir, bCand[0]);
    /* Served over the local HTTP the page already trusts, NOT as data: URIs.
       The first cut passed two ~1.1 MB data URIs into page.evaluate, the load
       failed, and a bare `catch { out[n] = null }` reported that as "no diff" —
       a silent fallback in the very tool built to stop silent fallbacks. The
       catch now records the reason. */
    const ta = path.join(ROOT, '__diff_a.png'), tb = path.join(ROOT, '__diff_b.png');
    try {
      fs.copyFileSync(a, ta); fs.copyFileSync(b, tb);
      out[n] = await page.evaluate(async ([ua, ub]) => {
        const load = src => new Promise(res => { const i = new Image(); i.onload = () => res(i); i.onerror = () => res(null); i.src = src; });
        const [ia, ib] = await Promise.all([load(ua), load(ub)]);
        if (!ia || !ib) return 'ERR: image load failed';
        if (ia.width !== ib.width || ia.height !== ib.height) return 'ERR: size mismatch';
        const cv = document.createElement('canvas'); cv.width = ia.width; cv.height = ia.height;
        const cx = cv.getContext('2d', { willReadFrequently: true });
        cx.drawImage(ia, 0, 0); const A = cx.getImageData(0, 0, cv.width, cv.height).data;
        cx.clearRect(0, 0, cv.width, cv.height);
        cx.drawImage(ib, 0, 0); const B = cx.getImageData(0, 0, cv.width, cv.height).data;
        let d = 0; const N = A.length / 4;
        /* 6/255 per channel: below that is dither, not work. */
        for (let i = 0; i < A.length; i += 4)
          if (Math.abs(A[i]-B[i]) > 6 || Math.abs(A[i+1]-B[i+1]) > 6 || Math.abs(A[i+2]-B[i+2]) > 6) d++;
        return +(100 * d / N).toFixed(1);
      }, [`http://127.0.0.1:${PORT}/__diff_a.png`, `http://127.0.0.1:${PORT}/__diff_b.png`]);
    } catch (e) { out[n] = 'ERR: ' + String(e.message || e).slice(0, 120); }
    finally { try { fs.unlinkSync(ta); fs.unlinkSync(tb); } catch (e) {} }
  }
  return out;
}
const AGAINST = process.argv.includes('--against') ? process.argv[process.argv.indexOf('--against')+1] : null;
const changed = await diffAgainst(AGAINST, TAG, SHOTS.map(s => s.n));
let tripwire = null;
if (changed) {
  /* RELATIVE, NEVER ABSOLUTE — see the header. On the round-5 build against r4
     this reported aerial 48.9 / district 35.0 / street 4.0, and 4% is not
     "nothing changed", it is "this framing did not get the round". A framing
     that moved less than a quarter as much as the round's best framing is the
     signal, and it is a signal precisely because the drift floor is COMMON to
     all four framings: it cannot manufacture a 12x spread between them. */
  const nums = Object.entries(changed).filter(([, v]) => typeof v === 'number');
  const errs = Object.entries(changed).filter(([, v]) => typeof v === 'string');
  const max = nums.length ? Math.max(...nums.map(([, v]) => v)) : 0;
  const weak = nums.filter(([, v]) => max > 5 && v < max * 0.25);
  tripwire = {
    WARNING: 'RELATIVE ONLY. These percentages are NOT a measurement of this round — ' +
             'two boots with nothing changed read ' + NULL_CONTROL_PP.aerial + ' pp on the aerial. ' +
             'For "how much did my change do", use layer-ab.mjs.',
    nullControl: NULL_CONTROL_PP,
    perFraming: changed,
    ratioToBest: Object.fromEntries(nums.map(([k, v]) => [k, max ? +(v / max).toFixed(2) : null])),
    weakFramings: weak.map(([k]) => k),
  };
  if (errs.length) console.error(`\n⚠ DIFF FAILED for ${errs.map(([k, v]) => k + ': ' + v).join('; ')}\n`);
  if (weak.length) console.error(
    `\n⚠ THIS ROUND DID NOT REACH ${weak.length === 1 ? 'A FRAMING' : 'SOME FRAMINGS'}, vs ${AGAINST}:\n` +
    nums.map(([k, v]) => `    ${k.padEnd(9)} ${String(v).padStart(5)}% changed${v < max * 0.25 ? '   <-- barely moved' : ''}`).join('\n') +
    `\n  ⚠ RATIO, NOT AMOUNT: two boots with nothing changed read ${NULL_CONTROL_PP.aerial} pp here.\n` +
    `  Say so in the round's report. A critic scoring that framing will find it,\n` +
    `  and a round that only shows up in one camera is not the round it claims.\n`);
}

const diag=await page.evaluate(()=>{const{renderer,scene}=window.__nc.three();
  let m=0;scene.traverse(o=>{if(o.isMesh)m++});
  return{meshes:m,geoms:renderer.info.memory.geometries,tris:renderer.info.render.triangles}});
/* ⚠ `changedVsPrev` IS GONE, DELIBERATELY, AND THE KEY IS NOT COMING BACK.
   It was a bare per-framing percentage that read exactly like a result, and it
   was quoted as one in round reports more than once. What replaces it carries
   its own null control in the same object, so the number and the reason it
   cannot be trusted alone can never be separated by a copy-paste. */
console.log(JSON.stringify({built,box,made,diag,crossBootTripwire:tripwire,onFilm,logs:logs.slice(-10)},null,2));
await browser.close(); server.close();
