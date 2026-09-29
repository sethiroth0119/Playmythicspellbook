/* ══ 🌊 THE OCEAN PROBE — the picture, the cost and the consistency ═════════
   ONE boot, and everything that can be asked of a rendered frame is asked
   inside ONE synchronous page.evaluate().

   🔴 WHY IT IS ONE SYNCHRONOUS BLOCK, AND WHY THAT IS THE WHOLE HARNESS.
      .gauntlet/README.md item 6 and CLAUDE.md both record the same measured
      failure: `preserveDrawingBuffer` is off, so the framebuffer is gone by the
      next task, and an A/B that flips `.visible` and then reads pixels gets the
      frame from BEFORE the flip and reports a confident, wrong ZERO. That cost
      two overlays a "cannot be photographed" verdict.
      So: render → drawImage → render → drawImage, all in one task, with
      renderer.render() called by us between every pair of reads. It also buys
      something the screenshot-with-waits harnesses cannot have — a CONTROL OF
      EXACTLY ZERO. /src/wild's shot probe reports a 2–6pp frame-to-frame drift
      floor because it screenshots with waits and the clock, the weather and the
      crowd all advance in between. Nothing advances inside a synchronous block:
      the on-vs-on control below is 0 pixels, not 0-ish.

   ⚠ THE CAMERA IS NOT MOVED. Every other probe in this directory frames its
     subject; this one deliberately does not, because the claim being tested is
     "the player sees the sea when they open their city", and the only camera
     that can test that is the one boot leaves them at: (14, 15, 14) looking at
     the origin. The quality tier is asserted rather than set, for the same
     reason — `medium` is what a non-WebGPU client picks for itself.

   Usage: node .gauntlet/oceanshot.mjs [outDir]
   ══════════════════════════════════════════════════════════════════════════ */
import { chromium } from 'playwright';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';

const OUT = path.resolve(process.argv[2] || '.gauntlet/shots/ocean');
fs.mkdirSync(OUT, { recursive: true });
const ROOT = path.resolve(process.cwd(), 'public');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.glb': 'model/gltf-binary', '.txt': 'text/plain', '.webp': 'image/webp' };
const PORT = 8800 + (process.pid % 90);
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]); if (p.endsWith('/')) p += 'index.html';
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end('nf'); }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
});
await new Promise(r => server.listen(PORT, '127.0.0.1', r));

const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
         '--ignore-gpu-blocklist', '--no-sandbox', '--disable-dev-shm-usage'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });

/* 🕒 PIN THE CLOCK. estClock() reads the REAL wall clock, so an unpinned probe
   is shot at whatever hour it happened to run — the failure capture.mjs's own
   header records costing a whole round's lighting work. Same shift trick. */
await page.addInitScript(({ hour }) => {
  const _D = Date; const now = new _D(); const parts = {};
  for (const p of new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York',
        hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).formatToParts(now)) parts[p.type] = p.value;
  const curH = (+parts.hour % 24) + (+parts.minute) / 60 + (+parts.second) / 3600;
  const shiftMs = (hour - curH) * 3600 * 1000;
  class S extends _D { constructor(...a) { if (!a.length) super(_D.now() + shiftMs); else super(...a); }
    static now() { return _D.now() + shiftMs; } }
  S.parse = _D.parse; S.UTC = _D.UTC; window.Date = S;
}, { hour: 15 });

const logs = [];
page.on('console', m => logs.push('[' + m.type() + '] ' + m.text().slice(0, 400)));
page.on('pageerror', e => logs.push('[pageerror] ' + String(e.message).slice(0, 400)));
await page.goto('http://127.0.0.1:' + PORT + '/node-city/index.html', { waitUntil: 'load', timeout: 180000 });
await page.waitForFunction(() => !!(window.__nc && window.__nc.three), null, { timeout: 180000 });
// the module section of boot() is async; give every dynamic import time to land
await page.waitForTimeout(20000);

/* ══ THE ONE SYNCHRONOUS BLOCK ═══════════════════════════════════════════ */
const R = await page.evaluate(() => {
  const nc = window.__nc, { renderer, scene, camera } = nc.three();
  const O = window.MythicOcean;
  const out = { mounted: !!O, stats: O ? O.stats() : null, verify: O ? O.verify() : null };

  /* ── THE TIER, AND WHY IT IS PINNED FOR THE MEASUREMENT ────────────────
     🐞 THE THIRD RUN OF THIS PROBE SILENTLY CHANGED TIERS UNDER ITSELF. Two
        runs reported fog [25, 34] — `medium`, the tier the bar is written
        about and the one every non-WebGPU client boots at — and the third
        reported [13, 22], which is `low`. node-city's quality governor steps
        down on a 90-frame median over 22 ms, and SwiftShader renders this city
        at nothing like 45 fps, so the tier the harness measures is a property
        of how busy the machine was. That is a moving instrument, and the sea's
        mean colour duly moved 43 → 22 away from the fog with it.
     So both are measured, by name, and the fog stops are written directly.
     ⚠ WRITING near/far IS THE MINIMAL INTERVENTION AND NOT A CHEAT. It is the
       only thing `qualityApply` does that this measurement depends on, the
       values are the shipped table's own (medium [25,34], low [13,22]), and
       nothing else about the frame is touched. `low` is the HARSHER of the two
       — its far stop is 12 units nearer, so the sea is more hazed, not less. */
  out.fogAsFound = scene.fog ? { near: scene.fog.near, far: scene.fog.far,
                                 tier: scene.fog.far === 34 ? 'medium' : scene.fog.far === 22 ? 'low'
                                     : scene.fog.far === 70 ? 'high' : 'potato/unknown' } : null;
  out.fog = out.fogAsFound;
  out.cam = { x: camera.position.x, y: camera.position.y, z: camera.position.z, fov: camera.fov };

  const g = scene.getObjectByName('ocean');
  if (!g) { out.error = 'no ocean group in the scene'; return out; }

  // ── the cost, A/B, with a render between every pair of reads
  out.cost = O.cost(renderer, scene, camera);
  /* 🔴 …AND WHAT THAT A/B CANNOT MEASURE, SAID OUT LOUD.
     `renderer.info.memory.geometries` and `.textures` are ALLOCATION counters:
     they move when a resource is uploaded or disposed, and hiding a mesh does
     neither. So `dGeos: 0` above is not "this layer costs no geometry" — it is
     the instrument declining to answer, which is precisely the trap /src/wild's
     cost header names ("arithmetic that cannot fail … it could only ever
     restate that this group has two children"). The honest figure is what the
     module actually OWNS, counted off the live scene graph. */
  const owned = { meshes: 0, geometries: new Set(), materials: new Set(), textures: new Set() };
  g.traverse(o => {
    if (!o.isMesh) return;
    owned.meshes++;
    owned.geometries.add(o.geometry.uuid);
    for (const m of (Array.isArray(o.material) ? o.material : [o.material])) {
      if (!m) continue;
      owned.materials.add(m.uuid);
      for (const k of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap'])
        if (m[k]) owned.textures.add(m[k].uuid);
    }
  });
  out.owns = { meshes: owned.meshes, geometries: owned.geometries.size,
               materials: owned.materials.size, ownTextures: owned.textures.size };

  // ── the picture
  const W = renderer.domElement.width, H = renderer.domElement.height;
  out.buffer = { w: W, h: H };
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const c2 = cv.getContext('2d', { willReadFrequently: true });
  const grab = () => {
    renderer.render(scene, camera);          // ← the render the README is about
    c2.clearRect(0, 0, W, H);
    c2.drawImage(renderer.domElement, 0, 0); // ← …in the SAME task
    return c2.getImageData(0, 0, W, H).data;
  };
  /* Named crops, in buffer pixels. Fractions of the buffer so a devicePixelRatio
     change cannot silently move them off the picture — .gauntlet/README.md
     records a hardcoded crop drifting out of frame the first time somebody
     moved a framing. */
  const CROPS = {
    'full frame':            [0.00, 0.00, 1.00, 1.00],
    'bottom-right quadrant': [0.50, 0.50, 1.00, 1.00],
    'seaward crop':          [0.70, 0.60, 1.00, 1.00],
  };
  const THRESH = 8;   // per-channel, out of 255: above the encoder's own noise
  const diff = (P, Q, box) => {
    const [fx0, fy0, fx1, fy1] = box;
    const x0 = (fx0 * W) | 0, x1 = (fx1 * W) | 0, y0 = (fy0 * H) | 0, y1 = (fy1 * H) | 0;
    let n = 0, tot = 0;
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
      const o = (y * W + x) * 4; tot++;
      if (Math.abs(P[o] - Q[o]) > THRESH || Math.abs(P[o + 1] - Q[o + 1]) > THRESH ||
          Math.abs(P[o + 2] - Q[o + 2]) > THRESH) n++;
    }
    return { changed: n, of: tot, pct: +(100 * n / tot).toFixed(2) };
  };
  /* ── IS IT FOG? The mean colour of the pixels the sea actually CHANGED,
     against scene.fog.color. A layer that is 100% haze is invisible AND passes
     a diff, because the ground underneath it was a different grey — that is
     exactly how /src/outside's highway "shipped" at z = −19.6, silently. */
  const s2b = (l) => Math.round(255 * (l <= 0.0031308 ? l * 12.92 : 1.055 * Math.pow(l, 1 / 2.4) - 0.055));
  const fogTest = (P, Q) => {
    const x0 = (0.50 * W) | 0, x1 = W, y0 = (0.50 * H) | 0, y1 = H;
    let r = 0, gg = 0, b = 0, n = 0;
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
      const o = (y * W + x) * 4;
      if (Math.abs(P[o] - Q[o]) > THRESH || Math.abs(P[o + 1] - Q[o + 1]) > THRESH ||
          Math.abs(P[o + 2] - Q[o + 2]) > THRESH) { r += P[o]; gg += P[o + 1]; b += P[o + 2]; n++; }
    }
    const fc = scene.fog.color;
    const fog = [s2b(fc.r), s2b(fc.g), s2b(fc.b)];
    const mean = n ? [Math.round(r / n), Math.round(gg / n), Math.round(b / n)] : null;
    return { seaPixels: n, meanSeaRGB: mean, fogRGB: fog, fogNear: scene.fog.near, fogFar: scene.fog.far,
             distanceFromFog: mean ? Math.round(Math.hypot(mean[0] - fog[0], mean[1] - fog[1], mean[2] - fog[2])) : null };
  };

  /* ── THE A/B, RUN ONCE PER TIER. Every read happens inside this one
     synchronous block, so no rAF can fire between an on-read and an off-read
     and the on-vs-on control is 0 pixels, not 0-ish. */
  const was = g.visible;
  const dump = (arr) => { const d = c2.createImageData(W, H); d.data.set(arr); c2.putImageData(d, 0, 0); return cv.toDataURL('image/png'); };
  out.picture = {}; out.fogTest = {};
  for (const [tier, near, far] of [['medium', 25, 34], ['low', 13, 22]]) {
    scene.fog.near = near; scene.fog.far = far;
    g.visible = true;  const A  = grab();     // on
    g.visible = true;  const A2 = grab();     // on again — the CONTROL
    g.visible = false; const B  = grab();     // off
    g.visible = true;
    out.picture[tier] = {};
    for (const k in CROPS) out.picture[tier][k] = { seaVsNoSea: diff(A, B, CROPS[k]), control: diff(A, A2, CROPS[k]) };
    out.fogTest[tier] = fogTest(A, B);
    /* The frames as PNGs for the `medium` pass, so the number can be LOOKED AT.
       The mask is the diff itself — white where the sea changed the frame — and
       it is the only picture that can show a share statistic being computed off
       the wrong pixels. */
    if (tier === 'medium') {
      const maskArr = new Uint8ClampedArray(W * H * 4);
      for (let i = 0; i < W * H; i++) {
        const o = i * 4;
        const hit = Math.abs(A[o] - B[o]) > THRESH || Math.abs(A[o + 1] - B[o + 1]) > THRESH || Math.abs(A[o + 2] - B[o + 2]) > THRESH;
        maskArr[o] = maskArr[o + 1] = maskArr[o + 2] = hit ? 255 : 0;
        maskArr[o + 3] = 255;
      }
      out.png = { on: dump(A), off: dump(B), mask: dump(maskArr) };
    }
  }
  g.visible = was;

  // How far the nearest and furthest sea vertex are from the lens — the numbers
  // the fog stops above actually act on.
  {
    const pos = g.children[0].geometry.attributes.position.array;
    let nearest = 1e9, farthest = -1;
    for (let i = 0; i < pos.length; i += 3) {
      const d = Math.hypot(pos[i] - camera.position.x, pos[i + 1] - camera.position.y, pos[i + 2] - camera.position.z);
      if (d < nearest) nearest = d;
      if (d > farthest) farthest = d;
    }
    out.seaDistance = { nearestVertex: +nearest.toFixed(1), furthestVertex: +farthest.toFixed(1) };
  }

  /* ── THE SIMULATION AND THE PICTURE AGREE. sourceAt on the coast must not
     say 'none', and the dam must still be refused there. */
  const Wm = window.MythicWater;
  if (Wm) {
    const G = 24, zt = 12;
    out.consistency = {
      summary: Wm.endowment().summary,
      seaBody: !!Wm.endowment().sea,
      inlandColumns: Wm.endowment().sea && Wm.endowment().sea.inland,
      east: Wm.sourceAt(G - 1, zt),
      west: Wm.sourceAt(0, zt),
      factorEast: Wm.factorAt(G - 1, zt),
      factorWest: Wm.factorAt(0, zt),
    };
    const P = window.MythicPower;
    if (P && typeof P.siteRefusal === 'function') {
      out.consistency.damOnCoast = P.siteRefusal('hydroplant', G - 1, zt) ||
                                   P.siteRefusal('hydro', G - 1, zt) || null;
    }
  }

  // ── the outskirts: how many meshes, and does anything stand in the water
  const outs = scene.children.filter(o => o.name === 'outskirts');
  out.outskirts = { meshes: outs.length };
  if (O && outs.length) {
    let inSea = 0, checked = 0;
    for (const o of outs) {
      const p = o.geometry.attributes.position.array;
      for (let i = 0; i < p.length; i += 3 * 37) {      // sampled: 33k triangles
        checked++;
        if (O.isSea(p[i], p[i + 2], 0)) inSea++;
      }
    }
    out.outskirts.sampledVerts = checked;
    out.outskirts.vertsInSea = inSea;
    /* ⚠ `vertsInSea: 0` ONLY MEANS SOMETHING IF THERE WAS SOMETHING TO REMOVE.
       A zero that a do-nothing implementation would also produce is not a
       measurement — /src/wild's cost header records exactly that mistake
       ("arithmetic that cannot fail"). So the cells the exclusion HAD to reject
       are counted too, off perimeterScenery's own lattice (CELL 5, ring 15…30):
       if this is 0, the test above proved nothing. */
    let wouldBe = 0;
    for (let ix = -6; ix <= 6; ix++) for (let iz = -6; iz <= 6; iz++) {
      const bx = ix * 5, bz = iz * 5;
      if (Math.max(Math.abs(bx), Math.abs(bz)) < 15) continue;
      if (O.isSea(bx, bz, 2.2)) wouldBe++;
    }
    out.outskirts.cellsTheSeaRejected = wouldBe;
    out.outskirts.triangles = outs.reduce((n, o) => n + (o.geometry.index ? o.geometry.index.count : 0) / 3, 0);
  }
  return out;
});

await page.screenshot({ path: OUT + '/ocean-default-camera.png' });
await page.evaluate(() => { const g = window.__nc.three().scene.getObjectByName('ocean'); if (g) g.visible = false; });
await page.waitForTimeout(600);
await page.screenshot({ path: OUT + '/ocean-off-control.png' });
await page.evaluate(() => { const g = window.__nc.three().scene.getObjectByName('ocean'); if (g) g.visible = true; });

/* The three canvas dumps out of the JSON and onto disk — they are megabytes of
   base64 and the report is meant to be readable. */
if (R.png) {
  for (const k of ['on', 'off', 'mask'])
    fs.writeFileSync(OUT + '/canvas-' + k + '.png', Buffer.from(R.png[k].split(',')[1], 'base64'));
  delete R.png;
}
console.log(JSON.stringify(R, null, 2));
console.log('\n── console lines mentioning Ocean / Water / Wild ──');
for (const l of logs) if (/ocean|water|wild|outskirt|not mounted|FAIL/i.test(l)) console.log(l);
fs.writeFileSync(OUT + '/report.json', JSON.stringify({ report: R, logs }, null, 2));
console.log('\nwritten to ' + OUT);

await browser.close(); server.close();
