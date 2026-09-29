/* ══ THE ROUND-18 PROBE — fog separability and small-object shadows ═════════
   ONE boot, ONE scene, and every figure taken with render() and the pixel read
   IN THE SAME TASK (README §6), so the do-nothing control is exactly 0 and a
   pixel count is a verdict again.

   Why it is not four lumscans of a capture. The round-13 critic's fog pair
   ("far grass" against "far asphalt") cannot be reproduced from a PNG by
   projecting two world points: the district's far corner projects to (800,200)
   in the aerial framing, which is BEHIND the mid-rise cluster, so a naive
   projection reads a roof and calls it grass. Sampling here instead:
     · the class of every sample is read out of game.tiles, not guessed;
     · every sample is RAYCAST from the camera first and dropped unless the
       first thing the camera sees at that pixel is the ground itself;
     · the pair is reduced by MEDIAN over dozens of tiles per depth band, so a
       lamp, a tree or a parked car cannot carry the reading.

   Three measurements:
     fog     road-tile ground against empty-tile ground, per depth band, under
             the shipped fog and under a candidate — same boot, same frame.
     shadow  sun.castShadow off/on at the point where a named caster's shadow
             MUST land (computed from the light direction, not hunted for), for
             a lamp mast, a tree and a building. That is the critic's 1.47x /
             1.91x expressed as a ratio the instrument controls both ends of.
     texels  the shadow-map arithmetic for the tier that is actually live.

   node .gauntlet/r18-probe.mjs [--fog 24,34] [--framing aerial] [--hour 15]  */
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';

const arg = (f, d) => { const i = process.argv.indexOf(f); return i > 0 ? process.argv[i + 1] : d; };
const FOGB = arg('--fog', '24,34').split(',').map(Number);
const FRAMING = arg('--framing', 'aerial');
const PIN_HOUR = +arg('--hour', 15);

const ROOT = path.resolve(process.cwd(), 'public');
const THREE_ = '/home/user/Playmythicspellbook/.gauntlet/package';
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml',
  '.glb': 'model/gltf-binary', '.txt': 'text/plain', '.webp': 'image/webp' };
const PORT = 8600 + (process.pid % 90);
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]); if (p.endsWith('/')) p += 'index.html';
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end('nf'); }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
});
await new Promise(r => server.listen(PORT, '127.0.0.1', r));
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist',
         '--no-sandbox', '--disable-dev-shm-usage', '--no-proxy-server'],
  env: Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(HTTPS?_PROXY|https?_proxy|ALL_PROXY|all_proxy)$/.test(k))) });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1, ignoreHTTPSErrors: true });
await page.route('**/*', r => { const u = r.request().url();
  (u.startsWith('data:') || u.includes('127.0.0.1') || u.includes('localhost') || u.includes('jsdelivr')) ? r.continue() : r.abort(); });
await page.route('**/cdn.jsdelivr.net/npm/three@0.171.0/**', r => {
  const rel = new URL(r.request().url()).pathname.replace('/npm/three@0.171.0/', '');
  const f = path.join(THREE_, rel);
  fs.existsSync(f) ? r.fulfill({ status: 200, contentType: 'text/javascript', body: fs.readFileSync(f) })
                   : r.fulfill({ status: 404, body: 'nf' });
});
await page.addInitScript(({ hour }) => {
  const _D = Date; const now = new _D(); const parts = {};
  for (const p of new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).formatToParts(now)) parts[p.type] = p.value;
  const curH = (+parts.hour % 24) + (+parts.minute) / 60 + (+parts.second) / 3600;
  const shiftMs = (hour - curH) * 3600 * 1000;
  class S extends _D { constructor(...a) { if (a.length === 0) super(_D.now() + shiftMs); else super(...a); } static now() { return _D.now() + shiftMs; } }
  S.parse = _D.parse; S.UTC = _D.UTC; window.Date = S;
}, { hour: PIN_HOUR });
const logs = []; page.on('console', m => logs.push(`[${m.type()}] ${m.text()}`.slice(0, 240)));
page.on('pageerror', e => logs.push(`[pageerror] ${e.message}`.slice(0, 240)));

await page.goto(`http://127.0.0.1:${PORT}/node-city/index.html`, { waitUntil: 'load', timeout: 120000 });
await page.waitForTimeout(24000);
await page.evaluate(fs.readFileSync(path.resolve(process.cwd(), '.gauntlet/scene.js'), 'utf8'));
await page.waitForTimeout(6000);

/* The framing, re-derived exactly as capture.mjs derives it. */
const frame = await page.evaluate(() => {
  const nc = window.__nc, P = [];
  for (const t of Object.values(nc.game.tiles)) if (t.mesh) P.push([t.mesh.position.x, t.mesh.position.z]);
  const xs = P.map(p => p[0]), zs = P.map(p => p[1]);
  const box = { x0: Math.min(...xs), x1: Math.max(...xs), z0: Math.min(...zs), z1: Math.max(...zs) };
  return { box, cx: (box.x0 + box.x1) / 2, cz: (box.z0 + box.z1) / 2 };
});
const { box, cx, cz } = frame, span = Math.max(box.x1 - box.x0, box.z1 - box.z0);
const CAMS = {
  aerial:   { cam: [cx + span * .62, span * .55, cz + span * .62], tgt: [cx, 0, cz] },
  district: { cam: [cx + span * .26, span * .22, cz + span * .34], tgt: [cx - span * .06, 0, cz - span * .06] },
};
const C = CAMS[FRAMING];
await page.evaluate(([cam, tgt]) => {
  const nc = window.__nc;
  nc.controls.maxPolarAngle = Math.PI * .4995; nc.controls.minDistance = .05; nc.controls.enableDamping = false;
  nc.camera.position.set(...cam); nc.controls.target.set(...tgt); nc.controls.update();
  nc.camera.position.set(...cam); nc.camera.lookAt(...tgt);
  nc.camera.updateMatrixWorld(); nc.camera.updateProjectionMatrix();
}, [C.cam, C.tgt]);
await page.waitForTimeout(1200);

const result = await page.evaluate(({ fogB }) => {
  const nc = window.__nc, { renderer, scene, camera, THREE } = nc.three();
  const gl = renderer.domElement, CW = gl.width, CH = gl.height;
  const cv = document.createElement('canvas'); cv.width = CW; cv.height = CH;
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  const shoot = () => { renderer.render(scene, camera);
    ctx.clearRect(0, 0, CW, CH); ctx.drawImage(gl, 0, 0, CW, CH);
    return ctx.getImageData(0, 0, CW, CH).data; };
  const W = CW, H = CH;
  const at = (D, x, y) => { const i = (y * W + x) * 4; return [D[i], D[i+1], D[i+2]]; };
  const patch = (D, x, y, r) => { const R=[],G=[],B=[];
    for (let dy=-r; dy<=r; dy++) for (let dx=-r; dx<=r; dx++) {
      const X=x+dx, Y=y+dy; if (X<0||Y<0||X>=W||Y>=H) continue;
      const p = at(D, X, Y); R.push(p[0]); G.push(p[1]); B.push(p[2]); }
    const m = a => a.sort((p,q)=>p-q)[a.length>>1];
    return [m(R), m(G), m(B)]; };
  const lum = (c) => .299*c[0] + .587*c[1] + .114*c[2];
  const hue = (c) => { const r=c[0]/255,g=c[1]/255,b=c[2]/255,mx=Math.max(r,g,b),mn=Math.min(r,g,b),d=mx-mn;
    if (!d) return 0; let h; if (mx===r) h=((g-b)/d)%6; else if (mx===g) h=(b-r)/d+2; else h=(r-g)/d+4;
    return (h*60+360)%360; };
  const dHue = (a,b) => { const d = Math.abs(hue(a)-hue(b)); return Math.min(d, 360-d); };
  const med3 = (arr) => { const m = i => arr.map(a=>a[i]).sort((p,q)=>p-q)[arr.length>>1]; return [m(0),m(1),m(2)]; };
  const V = new THREE.Vector3();
  const proj = (p) => { V.set(p[0], p[1], p[2]).project(camera);
    return { x: Math.round((V.x*.5+.5)*W), y: Math.round((.5-V.y*.5)*H) }; };

  /* ── the sample set. Class comes from game.tiles; the tile→world offset is
     read off a placed tile rather than assumed, because placeMeshAt owns that
     mapping and it is not the identity. */
  const tiles = Object.values(nc.game.tiles).filter(t => t.mesh);
  const anyKey = Object.entries(nc.game.tiles).find(([, t]) => t.mesh);
  const [k0x, k0z] = anyKey[0].split(',').map(Number);
  const offX = anyKey[1].mesh.position.x - k0x, offZ = anyKey[1].mesh.position.z - k0z;
  const occupied = new Set(Object.keys(nc.game.tiles));
  const keys = Object.keys(nc.game.tiles).map(k => k.split(',').map(Number));
  const kx0 = Math.min(...keys.map(k=>k[0])), kx1 = Math.max(...keys.map(k=>k[0]));
  const kz0 = Math.min(...keys.map(k=>k[1])), kz1 = Math.max(...keys.map(k=>k[1]));
  const roadPts = tiles.filter(t => t.type === 'road').map(t => [t.mesh.position.x, 0.017, t.mesh.position.z]);
  const grassPts = [];
  for (let x = kx0; x <= kx1; x++) for (let z = kz0; z <= kz1; z++)
    if (!occupied.has(x + ',' + z)) grassPts.push([x + offX, 0.001, z + offZ]);

  /* ── visibility. A sample is kept only if the first thing the camera hits at
     that pixel IS that point (within 0.25). This is what stops a roof being
     read as the grass 20 units behind it. */
  const rc = new THREE.Raycaster();
  const visible = (p) => {
    const o = camera.position, dir = V.set(p[0]-o.x, p[1]-o.y, p[2]-o.z);
    const dist = dir.length(); dir.normalize();
    rc.set(o, dir); rc.far = dist + 1;
    const hits = rc.intersectObjects(scene.children, true).filter(h => h.object.visible && h.object.isMesh);
    return hits.length ? (hits[0].distance > dist - 0.25) : false;
  };
  const keep = (pts) => pts.map(p => ({ p, q: proj(p), d: camera.position.distanceTo(new THREE.Vector3(...p)) }))
    .filter(s => s.q.x > 4 && s.q.y > 4 && s.q.x < W-4 && s.q.y < H-4)
    .filter(s => visible(s.p));
  const roadS = keep(roadPts), grassS = keep(grassPts);

  const BANDS = [[10,16],[16,20],[20,23],[23,26],[26,32]];
  const fogRead = (D) => BANDS.map(([a,b]) => {
    const R = roadS.filter(s => s.d>=a && s.d<b).map(s => patch(D, s.q.x, s.q.y, 2));
    const G = grassS.filter(s => s.d>=a && s.d<b).map(s => patch(D, s.q.x, s.q.y, 2));
    if (!R.length || !G.length) return { band:[a,b], n:0 };
    const r = med3(R), g = med3(G);
    return { band:[a,b], nRoad:R.length, nGrass:G.length, road:r, grass:g,
             dL:+(Math.abs(lum(r)-lum(g))).toFixed(1), dHue:+dHue(r,g).toFixed(0) };
  });

  const fogA = [scene.fog.near, scene.fog.far];
  const A = shoot();                         // shipped fog
  const readA = fogRead(A);
  const Ctl = shoot();                       // control, nothing changed
  const pct = (X, Y) => { let d = 0; const N = X.length/4;
    for (let i = 0; i < X.length; i += 4)
      if (Math.abs(X[i]-Y[i])>6 || Math.abs(X[i+1]-Y[i+1])>6 || Math.abs(X[i+2]-Y[i+2])>6) d++;
    return +(100*d/N).toFixed(3); };
  const controlPct = pct(A, Ctl);
  scene.fog.near = fogB[0]; scene.fog.far = fogB[1];
  for (const t of Object.values(nc.game.tiles)) if (t.mesh) t.mesh.visible = true;
  const B = shoot();
  const readB = fogRead(B);
  const changedPct = pct(A, B);
  scene.fog.near = fogA[0]; scene.fog.far = fogA[1];

  /* ── SHADOWS ────────────────────────────────────────────────────────────
     🔴 THE FIRST CUT OF THIS BLOCK WAS A DEAD INSTRUMENT AND REPORTED A
     CONFIDENT 1.000 FOR 74 LAMPS. It read `mesh.userData.lampLocal`, which is
     the LANTERN — the arm carries it 0.15 in over the carriageway, and the
     recipe publishes it there on purpose so the light pool lands on the road.
     The MAST stands at tile-local (0.36, 0.36). So the probe was projecting a
     point 0.30 above thin air onto the ground and finding, correctly, that
     nothing shadows it. It survived its own control, because a control that
     also sits in the open agrees that nothing is there.

     The fix is to stop predicting one point. Scan a LINE from the caster's
     foot along the light direction and keep the DARKEST ratio on it, so the
     measurement finds the shadow wherever the sun put it, over a kerb, a verge
     or a carriageway 3cm lower. The control is the same scan rotated 90 deg
     about the caster, where its shadow cannot be. */
  let sun = null;
  scene.traverse(o => { if (o.isDirectionalLight && o.castShadow && o.intensity > 0.5 && !sun) sun = o; });
  const L = new THREE.Vector3().subVectors(sun.position, sun.target.position).normalize();
  const casters = [];
  for (const t of tiles) {
    const rot = t.mesh.rotation.y || 0, cs = Math.cos(rot), sn = Math.sin(rot);
    const loc = (lx, lz) => [t.mesh.position.x + lx*cs + lz*sn, t.mesh.position.z - lx*sn + lz*cs];
    if (t.type === 'road' && t.mesh.userData && t.mesh.userData.lampLocal) {
      const m = loc(0.36, 0.36);          // the MAST, not the lantern
      casters.push({ kind: 'lamp mast', x: m[0], z: m[1], y: 0.046, reach: 0.62 });
    }
    if (t.type === 'tree')    casters.push({ kind:'tree',     x:t.mesh.position.x, z:t.mesh.position.z, y:0.02, reach: 1.30 });
    if (t.type === 'housing') casters.push({ kind:'building', x:t.mesh.position.x, z:t.mesh.position.z, y:0.02, reach: 2.20 });
  }
  const scanLine = (D0, D1, c, ux, uz) => {   // darkest L_off/L_on found along the ray
    let worst = 1, at = null;
    for (let t = 0.06; t <= c.reach; t += 0.03) {
      const p = [c.x + ux*t, c.y + 0.005, c.z + uz*t], q = proj(p);
      if (q.x<3 || q.y<3 || q.x>=W-3 || q.y>=H-3) continue;
      const on = lum(patch(D0, q.x, q.y, 1)), off = lum(patch(D1, q.x, q.y, 1));
      if (on < 4) continue;
      const r = off/on; if (r > worst) { worst = r; at = +t.toFixed(2); }
    }
    return { worst, at };
  };
  const shadowRead = (SON, SOFF) => {
    const ux = -L.x/Math.hypot(L.x,L.z), uz = -L.z/Math.hypot(L.x,L.z);   // away from the light
    const by = {};
    for (const c of casters) {
      const hit = scanLine(SON, SOFF, c, ux, uz);
      const ctl = scanLine(SON, SOFF, c, -uz, ux);                        // across it
      (by[c.kind] ||= []).push([hit.worst, ctl.worst, hit.at]);
    }
    const out = {};
    for (const k in by) {
      const rs = by[k].map(a=>a[0]).sort((a,b)=>a-b), cs = by[k].map(a=>a[1]).sort((a,b)=>a-b);
      const q = (a,f) => a[Math.min(a.length-1, Math.floor(a.length*f))];
      out[k] = { n: rs.length,
                 darkening_med: +q(rs,.5).toFixed(3), darkening_p90: +q(rs,.9).toFixed(3),
                 control_med: +q(cs,.5).toFixed(3),  control_p90: +q(cs,.9).toFixed(3),
                 fracOver1_15: +(rs.filter(v=>v>1.15).length/rs.length).toFixed(2),
                 ctlFracOver1_15: +(cs.filter(v=>v>1.15).length/cs.length).toFixed(2) };
    }
    return out;
  };
  sun.castShadow = true;  const SON = shoot();
  sun.castShadow = false; const SOFF = shoot();
  sun.castShadow = true;
  const shadow = shadowRead(SON, SOFF);

  /* ── THE SWEEP. Every shadow setting this app could plausibly afford, tried
     in ONE boot against the SAME 74 lamp masts, so "a lamp cannot be shadowed"
     is answered with a table instead of an opinion. Each variant disposes the
     map (a resize does not take otherwise — qualityApply does the same) and
     rebuilds the frustum projection. */
  const sweep = [];
  const measure = () => {
    const on = shoot(); sun.castShadow = false; const off = shoot(); sun.castShadow = true;
    return shadowRead(on, off);
  };
  const setShadow = (map, spn, nb, soft) => {
    sun.shadow.mapSize.set(map, map);
    sun.shadow.camera.left = -spn; sun.shadow.camera.right = spn;
    sun.shadow.camera.top = spn;   sun.shadow.camera.bottom = -spn;
    sun.shadow.camera.updateProjectionMatrix();
    sun.shadow.normalBias = nb;
    renderer.shadowMap.type = soft ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
    if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; }
    renderer.shadowMap.needsUpdate = true;
  };
  const S0 = { map: sun.shadow.mapSize.x, spn: sun.shadow.camera.right,
               nb: sun.shadow.normalBias, soft: renderer.shadowMap.type === THREE.PCFSoftShadowMap };
  for (const v of [
      { name: 'shipped medium 1536/span14/nb.022/PCFSoft', map:1536, spn:14, nb:0.022, soft:true },
      { name: 'normalBias 0.022 -> 0.010',                 map:1536, spn:14, nb:0.010, soft:true },
      { name: 'PCFSoft -> PCF (hard)',                     map:1536, spn:14, nb:0.022, soft:false },
      { name: 'map 1536 -> 2048',                          map:2048, spn:14, nb:0.022, soft:true },
      { name: 'map 2048 + span 14 -> 10',                  map:2048, spn:10, nb:0.022, soft:true },
      { name: 'map 2048 + span 6 (a 2nd cascade\'s span)', map:2048, spn:6,  nb:0.022, soft:true },
      { name: 'map 4096 + span 6, nb .008 (unaffordable)', map:4096, spn:6,  nb:0.008, soft:true },
  ]) {
    setShadow(v.map, v.spn, v.nb, v.soft);
    const t0 = performance.now(); renderer.render(scene, camera); const ms = performance.now() - t0;
    sweep.push({ ...v, texelsPerUnit: +(v.map/(2*v.spn)).toFixed(1),
                 mastTexels: +(0.031/((2*v.spn)/v.map)).toFixed(2),
                 frameMs: +ms.toFixed(0), darkening: measure() });
  }
  setShadow(S0.map, S0.spn, S0.nb, S0.soft);

  const size = sun.shadow.mapSize.x, spanS = sun.shadow.camera.right;
  const texels = { mapSize: size, shadowSpan: spanS, texelsPerUnit: +(size/(2*spanS)).toFixed(1),
    texelWorld: +((2*spanS)/size).toFixed(5),
    lampMastDia: 0.031, lampMastTexels: +(0.031/((2*spanS)/size)).toFixed(2),
    bollardTexels: +(0.040/((2*spanS)/size)).toFixed(2),
    signPostTexels: +(0.020/((2*spanS)/size)).toFixed(2),
    normalBias: sun.shadow.normalBias, normalBiasTexels: +(sun.shadow.normalBias/((2*spanS)/size)).toFixed(2),
    filter: renderer.shadowMap.type };

  return { camDist: +camera.position.distanceTo(new THREE.Vector3(cx=0,0,0)).toFixed(2),
           fogA, fogB, controlPct, changedPct,
           samples: { road: roadS.length, grass: grassS.length, roadTotal: roadPts.length, grassTotal: grassPts.length },
           depthRange: [ +Math.min(...[...roadS,...grassS].map(s=>s.d)).toFixed(2),
                         +Math.max(...[...roadS,...grassS].map(s=>s.d)).toFixed(2) ],
           readA, readB, shadow, texels, sweep,
           sunElevDeg: +(Math.asin(L.y)*180/Math.PI).toFixed(1) };
}, { fogB: FOGB });

console.log(JSON.stringify({ framing: FRAMING, ...result, logs: logs.slice(-3) }, null, 1));
await browser.close(); server.close();
