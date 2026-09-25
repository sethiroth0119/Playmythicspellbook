/* ══════════════════════════════════════════════════════════════════════════
   GLB → SPRITE. Bake a 3D model to a transparent PNG the 2D board can draw.

   WHY THIS EXISTS, AND WHY IT IS NOT A DOWNGRADE.
   The battle stage is a hand-rolled 2D canvas renderer — `getContext('2d')`,
   a pinhole projector, and a painter's algorithm with no depth buffer. It
   cannot draw a .glb, and giving it a second WebGL context to do so would put
   two renderers with two different opinions about what is in front of what on
   the same screen. The board already has a complete PROP pipeline for exactly
   this job (PYLON_ART: art + widthWorld/heightWorld + frames, placed in world
   space by seedBraziers, depth-sorted with units, re-graded through
   PYLON_TINT). A baked sprite drops straight into it.

   And the camera is FIXED (TABLETOP-BAR §2 asks for exactly that), so a model
   rendered once at the shipped angle is pixel-identical to one rendered every
   frame — at none of the cost.

   🔴 THE SIZE PROBLEM THIS SOLVES. The two platform models are 27.7 MB and
   31.7 MB — 59 MB for two static props at a fixed angle, on a page whose whole
   design is to avoid that. A baked PNG is a few hundred KB.

   Renders with the repo's OWN three.js and GLTFLoader (public/assets/vfx/),
   not a fetched copy, so the bake matches what the rest of the project uses.

   Usage:
     node .gauntlet/tabletop/glb2sprite.mjs <in.glb> <out.png> [--px 1024]
          [--yaw deg] [--pitch deg]
   Prints the model's bounding box, so the caller can set widthWorld /
   heightWorld from a measurement rather than a guess.
   ══════════════════════════════════════════════════════════════════════════ */
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
const args = process.argv.slice(2);
const IN   = args[0];
const OUT  = args[1] || 'sprite.png';
const argOf = (k, d) => { const i = args.indexOf(k); return i > 0 ? args[i + 1] : d; };
const PX    = +argOf('--px', 1024);
/* Defaults match the board's shipped camera: CAM_FIT settles near its pitchLo
   of 34°, and props are placed at the board's corners so they are seen from
   slightly off-axis. Yaw is per-side (the red platform sits left of the board
   and the blue right), so the caller passes it. */
const YAW   = +argOf('--yaw', 0);
const PITCH = +argOf('--pitch', 34);

if (!IN || !fs.existsSync(IN)){
  console.error('input .glb not found: ' + IN);
  process.exit(2);
}

/* Serve the repo AND the model over one loopback origin. GLTFLoader fetches,
   so a file:// page cannot load the model at all. */
const MIME = { '.html':'text/html', '.js':'text/javascript', '.mjs':'text/javascript',
  '.glb':'model/gltf-binary', '.gltf':'model/gltf+json', '.bin':'application/octet-stream',
  '.png':'image/png', '.jpg':'image/jpeg', '.webp':'image/webp', '.ktx2':'image/ktx2' };

const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  /* public/ is the deploy root: the board's own pages fetch /assets/... which
     lives at public/assets/..., so serving from the repo root 404s every
     script the stage needs. The bake page itself lives OUTSIDE public/, under
     .gauntlet/, so it is served from the repo root explicitly. */
  const file = p === '/model.glb' ? path.resolve(IN)
             : p.startsWith('/.gauntlet/') ? path.join(ROOT, p)
             : path.join(ROOT, 'public', p);
  fs.readFile(file, (err, buf) => {
    if (err){ res.writeHead(404); res.end('no'); return; }
    res.writeHead(200, { 'content-type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream' });
    res.end(buf);
  });
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const PORT = server.address().port;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: PX, height: PX }, deviceScaleFactor: 1 });
const logs = [];
page.on('console', m => logs.push(m.text()));
page.on('pageerror', e => logs.push('PAGEERROR ' + e.message));

await page.goto(`http://127.0.0.1:${PORT}/.gauntlet/tabletop/_glbstage.html`, { waitUntil: 'domcontentloaded' });

const info = await page.evaluate(async ({ px, yaw, pitch }) => {
  return await window.__bake({ px, yaw, pitch });
}, { px: PX, yaw: YAW, pitch: PITCH });

if (!info || !info.ok){
  console.error(JSON.stringify({ ok: false, info, logs }, null, 1));
  await browser.close(); server.close(); process.exit(1);
}

const buf = Buffer.from(info.png.split(',')[1], 'base64');
fs.mkdirSync(path.dirname(path.resolve(OUT)), { recursive: true });
fs.writeFileSync(OUT, buf);

console.log(JSON.stringify({
  out: OUT, bytes: buf.length, px: PX, yaw: YAW, pitch: PITCH,
  bbox: info.bbox, meshes: info.meshes, tris: info.tris,
  /* The board sizes a prop in WORLD units. These come straight off the model's
     bounding box so widthWorld / heightWorld are measured, not guessed — the
     aspect below is what the sprite must be drawn at or the platform is
     stretched. */
  aspect: +(info.bbox.w / info.bbox.h).toFixed(4),
  logs: logs.slice(-8),
}, null, 1));

await browser.close();
server.close();
