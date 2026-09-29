/* ══════════════════════════════════════════════════════════════════════════
   🚂 BAKE-TRAIN — the Ironhold's .glb → a transparent PNG for the 2D map.

   🔴 WHY A PNG AND NOT THE MESH. Two reasons, either one decisive:

     1. The supplied model is 37.8 MB. Cloudflare hard-caps a single asset at
        25 MiB and ONE oversized file aborts the ENTIRE `wrangler deploy` —
        public/.assetsignore carries that warning in its own header, because it
        is why production once sat frozen on a stale build. Shipping this .glb
        would have broken every deploy after it.

     2. Ethos Heights is a 2D canvas. A mesh buys nothing there: the train is
        drawn once per frame at one fixed angle, so a sprite baked AT that
        angle is identical on screen and costs no loader, no WebGL context and
        no 37 MB download.

   ⚠ THE ANGLE IS NOT A GUESS. /src/missions/city.js sets TW = 18, TH = 9 — a
     true 2:1 isometric — so the camera sits at azimuth 45° and elevation
     atan(0.5) = 26.565°, which is the projection every building on that map is
     drawn with. Bake it at any other angle and the train sits in the scene at
     an angle nothing else shares.

   Run:  node tools/bake-train.mjs <input.glb> [outPng] [px]
   ══════════════════════════════════════════════════════════════════════════ */
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const SRC = process.argv[2];
const OUT = process.argv[3] || 'public/assets/artwork/train-ironhold.png';
const PX  = parseInt(process.argv[4] || '768', 10);
/* 🔴 WHICH ISOMETRIC AXIS THE TRAIN LIES ALONG. A 2:1 iso grid has two, 90°
   apart, and both are equally 'correct' — one reads as running left-to-right
   across the screen, the other as running down it. Vertical was asked for, so
   the default is the second: 45° + 90°. Pass a degree value to change it. */
const AZ  = parseFloat(process.argv[5] || '135');
if (!SRC || !fs.existsSync(SRC)) { console.error('need an existing .glb path'); process.exit(1); }

const THREE_JS = 'public/assets/vfx/three.min.js';
const LOADER   = 'public/assets/vfx/loaders/GLTFLoader.js';
for (const f of [THREE_JS, LOADER]) {
  if (!fs.existsSync(f)) { console.error('missing ' + f); process.exit(1); }
}

const PAGE = `<!doctype html><html><head><meta charset="utf-8"><style>
html,body{margin:0;background:transparent}canvas{display:block}
</style></head><body>
<script src="/three.min.js"></script>
<script src="/GLTFLoader.js"></script>
<script>
window.__bake = async function (px, azDeg) {
  const scene = new THREE.Scene();
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setSize(px, px, false);
  renderer.setClearColor(0x000000, 0);
  if (renderer.outputEncoding !== undefined && THREE.sRGBEncoding) renderer.outputEncoding = THREE.sRGBEncoding;
  document.body.appendChild(renderer.domElement);

  const gltf = await new Promise((res, rej) => new THREE.GLTFLoader().load('/model.glb', res, undefined, rej));
  const root = gltf.scene || gltf.scenes[0];
  scene.add(root);

  /* light it so a dark map still reads the silhouette */
  scene.add(new THREE.AmbientLight(0xffffff, 1.05));
  const key = new THREE.DirectionalLight(0xfff0d0, 1.5); key.position.set(4, 6, 3); scene.add(key);
  const rim = new THREE.DirectionalLight(0x88bbff, 0.7);  rim.position.set(-5, 3, -4); scene.add(rim);

  /* frame it */
  const box = new THREE.Box3().setFromObject(root);
  const size = box.getSize(new THREE.Vector3());
  const mid  = box.getCenter(new THREE.Vector3());
  root.position.sub(mid);                       // centre on the origin

  /* 🔴 THE MAP'S OWN PROJECTION. city.js: TW=18, TH=9 → 2:1 isometric.
     azimuth 45°, elevation atan(0.5). Orthographic, because the map is. */
  const el = Math.atan(0.5), az = (azDeg * Math.PI) / 180;
  const r = Math.max(size.x, size.y, size.z) * 3;
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, r * 4);
  cam.position.set(r * Math.cos(el) * Math.cos(az), r * Math.sin(el), r * Math.cos(el) * Math.sin(az));
  cam.up.set(0, 1, 0);
  cam.lookAt(0, 0, 0);

  /* fit the ortho frustum to the model's projected extent, with a hair of margin */
  const corners = [];
  for (const sx of [-.5, .5]) for (const sy of [-.5, .5]) for (const sz of [-.5, .5])
    corners.push(new THREE.Vector3(size.x * sx, size.y * sy, size.z * sz));
  cam.updateMatrixWorld();
  const inv = new THREE.Matrix4().copy(cam.matrixWorldInverse);
  let minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9;
  corners.forEach(c => { const v = c.clone().applyMatrix4(inv);
    minX = Math.min(minX, v.x); maxX = Math.max(maxX, v.x);
    minY = Math.min(minY, v.y); maxY = Math.max(maxY, v.y); });
  const halfW = (maxX - minX) / 2 * 1.06, halfH = (maxY - minY) / 2 * 1.06;
  const half = Math.max(halfW, halfH);
  cam.left = -half; cam.right = half; cam.top = half; cam.bottom = -half;
  cam.updateProjectionMatrix();

  renderer.render(scene, cam);

  /* 🔴 TRIM TO THE MODEL'S ACTUAL PIXELS. A square render of a long diagonal
     locomotive is mostly transparent padding, and the map then has to guess
     where the train's WHEELS are inside that padding — which is exactly how
     the first bake ended up floating above the city. Cropping to the alpha
     bounding box makes the sprite's bottom edge the train's bottom edge, so
     'sit it on the ground' becomes arithmetic instead of a fudge factor. */
  const src = renderer.domElement;
  const c2 = document.createElement('canvas'); c2.width = src.width; c2.height = src.height;
  const x2 = c2.getContext('2d'); x2.drawImage(src, 0, 0);
  const d = x2.getImageData(0, 0, c2.width, c2.height).data;
  /* ⚠ tX/tY, not minX/minY — those names are already taken by the frustum fit
     above, and reusing them here was a redeclaration that killed the bake. */
  let tX0 = c2.width, tY0 = c2.height, tX1 = -1, tY1 = -1;
  for (let y = 0; y < c2.height; y++) for (let x = 0; x < c2.width; x++) {
    if (d[(y * c2.width + x) * 4 + 3] > 8) {
      if (x < tX0) tX0 = x; if (x > tX1) tX1 = x;
      if (y < tY0) tY0 = y; if (y > tY1) tY1 = y;
    }
  }
  if (tX1 < 0) return { png: src.toDataURL('image/png'), dims: {}, trimmed: false };
  const w = tX1 - tX0 + 1, h = tY1 - tY0 + 1;
  const c3 = document.createElement('canvas'); c3.width = w; c3.height = h;
  c3.getContext('2d').drawImage(c2, tX0, tY0, w, h, 0, 0, w, h);
  return { png: c3.toDataURL('image/png'), trimmed: true, out: { w, h },
           dims: { x: +size.x.toFixed(2), y: +size.y.toFixed(2), z: +size.z.toFixed(2) } };
};
</script></body></html>`;

const files = {
  '/index.html': { body: PAGE, type: 'text/html' },
  '/three.min.js': { file: THREE_JS, type: 'text/javascript' },
  '/GLTFLoader.js': { file: LOADER, type: 'text/javascript' },
  '/model.glb': { file: SRC, type: 'model/gltf-binary' },
};
const srv = http.createServer((q, r) => {
  const e = files[q.url.split('?')[0]];
  if (!e) { r.writeHead(404); return r.end('nf'); }
  r.writeHead(200, { 'Content-Type': e.type });
  if (e.body) return r.end(e.body);
  fs.createReadStream(e.file).pipe(r);
});
await new Promise(r => srv.listen(9822, '127.0.0.1', r));

const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] });
const pg = await b.newPage({ viewport: { width: PX + 40, height: PX + 40 } });
const errs = [];
pg.on('pageerror', e => errs.push(String(e).slice(0, 200)));
await pg.goto('http://127.0.0.1:9822/index.html', { waitUntil: 'load' });
await pg.waitForTimeout(600);

let res = null;
try { res = await pg.evaluate(([px, az]) => window.__bake(px, az), [PX, AZ]); }
catch (e) { console.error('bake failed: ' + String(e).slice(0, 400)); }

if (res && res.png) {
  const buf = Buffer.from(res.png.split(',')[1], 'base64');
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, buf);
  console.log('azimuth       ' + AZ + '°');
  console.log('model extent  ' + JSON.stringify(res.dims));
  console.log('sprite        ' + JSON.stringify(res.out || {}) + (res.trimmed ? '  (trimmed to alpha)' : ''));
  console.log('written       ' + OUT + '  (' + (buf.length / 1024).toFixed(0) + ' KB)');
} else {
  console.error('no image produced' + (errs.length ? ' — ' + errs[0] : ''));
  process.exitCode = 1;
}
await b.close(); srv.close();
