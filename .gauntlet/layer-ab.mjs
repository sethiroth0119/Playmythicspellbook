/* ══ THE SINGLE-BOOT LAYER A/B — "how much did my change actually do?" ══════
   ONE boot, ONE scene, ONE camera. A named scene group is switched off and on
   and the frame is compared with itself.

     node .gauntlet/layer-ab.mjs --layer parcel
     node .gauntlet/layer-ab.mjs --layer parcel --framings aerial,frontage --out .gauntlet/shots/ab

   🔴 WHY THIS EXISTS, AND WHY IT IS NOT `capture.mjs --against`.
   The cross-boot per-framing diff was quoted as a measurement for several
   rounds. It cannot be one. Measured on this scene with LITERALLY NOTHING
   CHANGED — same commit, same pinned hour, two boots — the aerial framing came
   back 14.7 pp and 15.9 pp different. A real parcel-scale change is worth about
   2.5 pp. The null control is six times the signal, so any number that gate
   printed was noise wearing a result's clothes. See README, "The per-framing
   diff gate".
   ⚠ AND THE CAUSE IS NOT THE SCENERY. `perimeterScenery` was blamed for this
     in public/src/parcel/FIX-RECORD.md; it is wrong. That function seeds every
     roll off `rdRng` and its merged buckets hash IDENTICALLY across two boots
     (checked, per-group, on the scene graph). Hiding every agent, every parked
     vehicle and the whole standing crowd moves the cross-boot figure from 14.70
     to 14.68 pp. What actually moves is EVERY PIXEL A LITTLE: the sun runs on
     wall time, two boots reach the shutter a few seconds apart, and a mean
     delta of 2.7/255 across the whole frame trips a 6/255 threshold on a
     seventh of the image. A busy scene has no quiet pixels (README §5).

   🔵 HOW THIS ONE IS HONEST. Render and read IN THE SAME TASK —
   `preserveDrawingBuffer` is off, so a read in a later task returns the frame
   before the flip (README §6, and it reports a confident 0.00%). Nothing steps
   the sim between two synchronous renders, so THE DO-NOTHING CONTROL IS
   EXACTLY ZERO, and it is printed beside every figure. A run whose control is
   not 0 is not a measurement and says so.

   🐞 AND THE TRAP THAT COST A ROUND: take all the `renderer.info` reads
   TOGETHER, BEFORE any capture. The first cut interleaved read → shoot → read
   and reported dMeshes -12 — the layer apparently making the scene CHEAPER —
   which was agents being culled differently during a 40-second screenshot. */
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';

const arg = (f, d) => { const i = process.argv.indexOf(f); return i > 0 ? process.argv[i + 1] : d; };
const USAGE = `
  node .gauntlet/layer-ab.mjs --layer <sceneGroupName> [options]

    --layer <name>      name of the THREE.Object3D to toggle (o.name), e.g.
                        parcel, parking, crowd, outskirts, zoning-overlay
    --framings <list>   comma-separated: aerial,street,district,frontage,venue
                        (default aerial,district,frontage)
    --hour <0-23>       pin the in-game clock; default 15
    --clear             WAIT FOR CLEAR WEATHER before shooting. capture.mjs pins
                        the hour but NOT the weather (README), and a run that
                        starts CLEAR and finishes in a STORM cannot have its
                        absolute luminances quoted against another run's. The
                        A/B itself does not need this — both frames come out of
                        one task, so they share whatever the sky is doing — but
                        a lumscan trace read off the saved PNGs does.
    --out <dir>         also write on/off PNG pairs there

  Prints, per framing: pixels changed by the layer, and the do-nothing control
  that must read 0. Plus one renderer.info delta, read before any capture.
`;
const LAYER = arg('--layer', null);
if (!LAYER || process.argv.includes('--help')) { console.log(USAGE); process.exit(LAYER ? 0 : 1); }
const FRAMINGS = arg('--framings', 'aerial,district,frontage').split(',').map(s => s.trim()).filter(Boolean);
const OUT = arg('--out', null);
const PIN_HOUR = +arg('--hour', 15);
const WAIT_CLEAR = process.argv.includes('--clear');

const ROOT = path.resolve(process.cwd(), 'public');
const THREE_ = '/home/user/Playmythicspellbook/.gauntlet/package';
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml',
  '.glb': 'model/gltf-binary', '.txt': 'text/plain', '.webp': 'image/webp' };
const PORT = 8500 + (process.pid % 90);
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
const built = await page.evaluate(fs.readFileSync(path.resolve(process.cwd(), '.gauntlet/scene.js'), 'utf8'));
await page.waitForTimeout(6000);

/* The framings, derived exactly as capture.mjs derives them — imported by
   re-deriving rather than by copying numbers, because a hardcoded camera in a
   second file is a second framing that silently stops agreeing with the first. */
const frame = await page.evaluate(() => {
  const nc = window.__nc, P = [], roads = [];
  for (const t of Object.values(nc.game.tiles)) {
    if (!t.mesh) continue;
    P.push([t.mesh.position.x, t.mesh.position.z]);
    if (t.type === 'road') roads.push({ x: t.mesh.position.x, z: t.mesh.position.z });
  }
  const xs = P.map(p => p[0]), zs = P.map(p => p[1]);
  const box = { x0: Math.min(...xs), x1: Math.max(...xs), z0: Math.min(...zs), z1: Math.max(...zs) };
  const cx = (box.x0 + box.x1) / 2, cz = (box.z0 + box.z1) / 2;
  const isPlot = (t) => t && t.type !== 'road' && t.type !== 'anchor';
  const rows = {};
  for (const r of roads) (rows[r.z.toFixed(2)] ||= []).push(r.x);
  let best = null;
  for (const z in rows) {
    const xsr = rows[z].sort((a, b) => a - b);
    let front = 0;
    for (const t of Object.values(nc.game.tiles)) {
      if (!t.mesh || !isPlot(t)) continue;
      const d = Math.abs(t.mesh.position.z - +z);
      if (d < 1.01 && d > .5) front++;
    }
    const score = front * 2 + xsr.length - Math.abs(+z - cz) * .5;
    if (!best || score > best.score) best = { z: +z, xs: xsr, score };
  }
  let sn = 0, sp = 0;
  if (best) for (const t of Object.values(nc.game.tiles)) {
    if (!t.mesh || !isPlot(t)) continue;
    const d = t.mesh.position.z - best.z;
    if (Math.abs(Math.abs(d) - 1) < .35) { if (d < 0) sn++; else sp++; }
  }
  /* 🏟 THE VENUE FRAMING'S ANCHOR, derived exactly as capture.mjs derives it:
     the arena's placed mesh and its rotation, because that framing is a hero of
     the ENTRANCE and one that photographed the back would be no better than one
     that photographed nothing. rot is quarter-turns about +y and the recipe's
     entrance is on +z. */
  let venue = null;
  for (const t of Object.values(nc.game.tiles)) {
    if (!t.mesh || t.type !== 'arena') continue;
    const a = ((t.rot | 0) & 3) * Math.PI / 2;
    venue = { x: t.mesh.position.x, z: t.mesh.position.z, fx: Math.sin(a), fz: Math.cos(a) };
    break;
  }
  return { box, cx, cz, road: best, side: sp >= sn ? 1 : -1, venue };
});
const box = frame.box, cx = frame.cx, cz = frame.cz;
const span = Math.max(box.x1 - box.x0, box.z1 - box.z0), R = frame.road, SIDE = frame.side;
const CAMS = {
  aerial:   { cam: [cx + span * .62, span * .55, cz + span * .62], tgt: [cx, 0, cz] },
  district: { cam: [cx + span * .26, span * .22, cz + span * .34], tgt: [cx - span * .06, 0, cz - span * .06] },
  street:   R && R.xs.length > 3 ? { cam: [R.xs[1], .30, R.z - .12], tgt: [R.xs[R.xs.length - 2], .26, R.z + .10] }
                                 : { cam: [cx - span * .34, .30, cz], tgt: [cx + span * .3, .26, cz] },
  frontage: R && R.xs.length > 4 ? { cam: [R.xs[Math.min(R.xs.length - 2, 6)] - 2.0, .80, R.z - SIDE * .34],
                                     tgt: [R.xs[Math.min(R.xs.length - 2, 6)] + .10, .02, R.z + SIDE * .50] }
                                 : { cam: [cx - 2.0, .80, cz - .34], tgt: [cx + .10, .02, cz + .50] },
  /* 🏟 ADDED FOR ROUND 20. The round-19 critic's own measurement — "the ground
     band immediately down-sun of the isolated yellow pickup" — is taken in the
     venue framing, and this instrument could not reach it. Same expression as
     capture.mjs's, same fallback to the district camera when no arena stands. */
  venue:    frame.venue ? { cam: [frame.venue.x + frame.venue.fx * 2.35 + frame.venue.fz * 1.45, 1.30,
                                  frame.venue.z + frame.venue.fz * 2.35 - frame.venue.fx * 1.45],
                            tgt: [frame.venue.x, .26, frame.venue.z] }
                        : { cam: [cx + span * .26, span * .22, cz + span * .34], tgt: [cx - span * .06, 0, cz - span * .06] },
};
await page.evaluate(() => { const c = window.__nc.controls; c.maxPolarAngle = Math.PI * .4995; c.minDistance = .05; c.enableDamping = false; });

/* ⛅ THE WEATHER IS NOT PINNABLE FROM OUT HERE — `wx` is a top-level const in
   node-city's module script and is not on window (the globals trap, applied to
   the harness). So this WAITS for the shipped weatherTick to end whatever front
   rolled in, reading the badge the player reads. Measured cost: a storm's own
   duration, up to ~2 min. Without it, absolute luminances from two runs are not
   comparable — r19-venue reads CLEAR and r20-venue read STORM 30 s later in the
   same script, with the plaza going from L~130 to L~75 on the identical row. */
let weather = 'unknown';
if (WAIT_CLEAR) {
  for (let i = 0; i < 90; i++) {
    weather = await page.evaluate(() => (document.getElementById('wxname') || {}).textContent || '?');
    if (/clear/i.test(weather)) break;
    await page.waitForTimeout(4000);
  }
}
weather = await page.evaluate(() => (document.getElementById('wxname') || {}).textContent || '?');

/* 🐞 ALL THREE renderer.info READS TOGETHER, BEFORE ANY CAPTURE. */
const cost = await page.evaluate((name) => {
  const nc = window.__nc, { renderer, scene, camera } = nc.three();
  let g = null; scene.traverse(o => { if (!g && o.name === name) g = o; });
  if (!g) return { error: 'no scene object named "' + name + '"' };
  const read = () => { renderer.render(scene, camera);
    return { meshes: renderer.info.render.calls, tris: renderer.info.render.triangles,
             geoms: renderer.info.memory.geometries, children: g.children.length }; };
  g.visible = true;  const on1 = read();
  g.visible = false; const off = read();
  g.visible = true;  const on2 = read();
  return { on1, off, on2,
           dCalls: on1.calls, drawCalls: on1.meshes - off.meshes,
           dTris: on1.tris - off.tris, groupChildren: on1.children,
           stable: on1.meshes === on2.meshes && on1.tris === on2.tris };
}, LAYER);
if (cost.error) { console.error('\n  ' + cost.error + '\n'); await browser.close(); server.close(); process.exit(1); }

if (OUT) fs.mkdirSync(OUT, { recursive: true });
const out = {};
for (const n of FRAMINGS) {
  const c = CAMS[n]; if (!c) { out[n] = 'ERR: unknown framing'; continue; }
  await page.evaluate(([cam, tgt]) => {
    const nc = window.__nc;
    nc.camera.position.set(cam[0], cam[1], cam[2]); nc.controls.target.set(tgt[0], tgt[1], tgt[2]);
    nc.controls.update();
    nc.camera.position.set(cam[0], cam[1], cam[2]); nc.camera.lookAt(tgt[0], tgt[1], tgt[2]);
    nc.camera.updateMatrixWorld(); nc.camera.updateProjectionMatrix();
    try { nc.cullAgents(90); } catch (e) {}
  }, [c.cam, c.tgt]);
  await page.waitForTimeout(900);            // let anything lazy settle BEFORE the A/B
  out[n] = await page.evaluate((name) => {
    const nc = window.__nc, { renderer, scene, camera } = nc.three();
    let g = null; scene.traverse(o => { if (!g && o.name === name) g = o; });
    const gl = renderer.domElement, CW = gl.width, CH = gl.height;
    const s = document.createElement('canvas'); s.width = CW; s.height = CH;
    const cx2 = s.getContext('2d', { willReadFrequently: true });
    /* ⚠ drawImage IN THE SAME TASK as render(): preserveDrawingBuffer is off,
       so by the next task the buffer is gone and the read returns the previous
       frame — which is how a dead instrument reports a confident 0.00%. */
    const shoot = () => { renderer.render(scene, camera);
      cx2.clearRect(0, 0, CW, CH); cx2.drawImage(gl, 0, 0, CW, CH);
      return cx2.getImageData(0, 0, CW, CH).data; };
    const pct = (A, B) => { let d = 0; const N = A.length / 4;
      for (let i = 0; i < A.length; i += 4)
        if (Math.abs(A[i] - B[i]) > 6 || Math.abs(A[i + 1] - B[i + 1]) > 6 || Math.abs(A[i + 2] - B[i + 2]) > 6) d++;
      return +(100 * d / N).toFixed(3); };
    g.visible = true;  const A = shoot();
    g.visible = false; const B = shoot();
    const Ctl = shoot();                     // control: B vs Ctl MUST be 0
    g.visible = true;
    return { changedPct: pct(A, B), controlPct: pct(B, Ctl), px: A.length / 4 };
  }, LAYER);
  if (OUT) {
    for (const [tag, vis] of [['on', true], ['off', false]]) {
      await page.evaluate(([name, v]) => { const nc = window.__nc, { renderer, scene, camera } = nc.three();
        let g = null; scene.traverse(o => { if (!g && o.name === name) g = o; });
        g.visible = v; renderer.render(scene, camera); }, [LAYER, vis]);
      await page.screenshot({ path: path.join(OUT, `${LAYER}-${n}-${tag}.png`) });
    }
    await page.evaluate((name) => { const { scene } = window.__nc.three();
      scene.traverse(o => { if (o.name === name) o.visible = true; }); }, LAYER);
  }
}
const bad = Object.entries(out).filter(([, v]) => v && typeof v === 'object' && v.controlPct !== 0);
if (bad.length) console.error(
  `\n⚠ THE DO-NOTHING CONTROL IS NOT ZERO for ${bad.map(([k]) => k).join(', ')}.\n` +
  `  Something stepped between two synchronous renders — an interval in a module,\n` +
  `  a lazy load, a panel timer. The changed% beside it is NOT a measurement until\n` +
  `  that is found. See README §6.\n`);
console.log(JSON.stringify({ layer: LAYER, weather, hour: PIN_HOUR, cost, framings: out,
                             built: built && built.gates, logs: logs.slice(-4) }, null, 2));
await browser.close(); server.close();
