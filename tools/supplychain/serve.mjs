/* ═══════════════════════════════════════════════════════════════════════════
   🌐 serve — the Supply Chain harness's static server.

   WHY NOT `npx http-server`. It is not installed, CLAUDE.md forbids new npm
   dependencies without asking, and an npx download inside a critic run is a
   network fetch nobody approved. node:http is forty lines.

   WHY PORT 0. A dozen builders and critics run at once in this gauntlet. Any
   fixed port (crit-harness.mjs pins 8790, the athena harness 8765) means two of
   them collide and one screenshots the OTHER one's tree state — a failure that
   looks like a flaky render. Port 0 asks the OS for a free port; the caller
   reads it back. `PORT=n` still works for a human who wants a stable URL.

   ROUTES
     /…            → public/…           (the deploy root, exactly as Cloudflare serves it)
     /__sc/…       → tools/supplychain/… (harness pages, fake-bridge.js, the fixture)
     /__sc/selftest.html                 (virtual: three.js r128 + fake bridge, proves the camera works)
   The /__sc mount exists because harness pages must not live under public/ —
   that directory IS the deploy, and a test page there ships to players.

   Caching is off everywhere: a critic that re-shoots after a builder's edit
   must never be shown the previous round.
   ═══════════════════════════════════════════════════════════════════════════ */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REPO = path.resolve(HERE, '..', '..');
export const PUBLIC = path.join(REPO, 'public');

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.txt': 'text/plain; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.avif': 'image/avif',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.glb': 'model/gltf-binary', '.wasm': 'application/wasm',
  '.ttf': 'font/ttf', '.woff': 'font/woff', '.woff2': 'font/woff2', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg',
};

/* The self-test page is generated here, not kept as a file, so this piece owns
   no HTML under tools/ that a later harness-<piece>.html could be confused
   with. It draws with the SAME vendored r128 build the feature uses, so a green
   self-test means "SwiftShader can render our three.js", not "a canvas exists". */
const SELFTEST = `<!doctype html><html><head><meta charset="utf-8"><meta name="color-scheme" content="dark">
<title>supplychain shoot self-test</title>
<style>html,body{margin:0;background:#0c0b0a;color:#e8e0d0;font:16px Georgia,serif}#c{display:block;width:100vw;height:70vh}
pre{margin:0;padding:12px 16px;color:#d9cbaa;white-space:pre-wrap}</style></head><body>
<canvas id="c"></canvas><pre id="out">booting…</pre>
<script src="/__sc/fake-bridge.js"></script>
<script src="/assets/vfx/three.min.js"></script>
<script type="module">
import * as B from '/src/supplychain/sc.bridge.js';
import { SC } from '/src/supplychain/tuning.js';
const out = document.getElementById('out'); const T = window.THREE; const cv = document.getElementById('c');
const info = { three: T && T.REVISION, webgl: false, bridgeReady: B.ready(), ops: 0, pixel: null };
try {
  const r = new T.WebGLRenderer({ canvas: cv, antialias: true });
  r.setSize(cv.clientWidth, cv.clientHeight, false); r.setClearColor(SC.palette.bgDeep);
  const s = new T.Scene(); const cam = new T.PerspectiveCamera(SC.camera.fov, cv.clientWidth / cv.clientHeight, .1, 100);
  cam.position.set(3, 2.4, 4); cam.lookAt(0, 0, 0);
  s.add(new T.HemisphereLight(0xffffff, 0x221a10, 1.1));
  const m = new T.Mesh(new T.BoxGeometry(2, 2, 2), new T.MeshStandardMaterial({ color: SC.palette.gold, roughness: .45, metalness: .3 }));
  s.add(m); r.render(s, cam);
  // Same-task read: preserveDrawingBuffer is off, so the pixel is gone by the next task.
  const gl = r.getContext(); const px = new Uint8Array(4);
  gl.readPixels(gl.drawingBufferWidth >> 1, gl.drawingBufferHeight >> 1, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
  info.webgl = true; info.pixel = Array.from(px);
} catch (e) { info.error = String(e); }
const ids = ['mining', 'transport', 'fashion'];
info.ops = ids.map((id) => id + ':' + (B.opEcon(id) ? 'row' : 'null')).join(' ');
info.label = B.opLabel('genelab'); info.resources = B.resources().length; info.salvageRes = B.salvageRes().length;
info.phase = B.transportPhase(); info.mode = (window.__scFake && window.__scFake.mode) || 'n/a';
window.__selftest = info; out.textContent = JSON.stringify(info, null, 1);
document.body.setAttribute('data-ready', '1');
</script></body></html>`;

function resolve(urlPath) {
  let p;
  try { p = decodeURIComponent(urlPath.split('?')[0].split('#')[0]); } catch (e) { return null; }
  if (p.includes('\0')) return null;
  let root = PUBLIC;
  if (p === '/__sc' || p.startsWith('/__sc/')) { root = HERE; p = p.slice('/__sc'.length) || '/'; }
  if (p.endsWith('/')) p += 'index.html';
  const f = path.normalize(path.join(root, p));
  // Containment check on the NORMALISED path — `/__sc/../../.env` must 404.
  if (f !== root && !f.startsWith(root + path.sep)) return null;
  return f;
}

export function handler(req, res) {
  const head = { 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' };
  const pathOnly = (req.url || '/').split('?')[0];
  if (pathOnly === '/__sc/selftest.html') {
    res.writeHead(200, { ...head, 'Content-Type': MIME['.html'] });
    return res.end(SELFTEST);
  }
  const f = resolve(req.url || '/');
  let st = null;
  try { st = f && fs.statSync(f); } catch (e) {}
  if (!st || st.isDirectory()) { res.writeHead(404, head); return res.end('not found'); }
  res.writeHead(200, { ...head, 'Content-Type': MIME[path.extname(f).toLowerCase()] || 'application/octet-stream', 'Content-Length': st.size });
  if (req.method === 'HEAD') return res.end();
  fs.createReadStream(f).on('error', () => { try { res.destroy(); } catch (e) {} }).pipe(res);
}

/* Resolves once the socket is listening, with the REAL port. 127.0.0.1 only —
   this serves the working tree, it has no business on the LAN. */
export async function startServer({ port = 0 } = {}) {
  const server = http.createServer(handler);
  await new Promise((ok, no) => { server.once('error', no); server.listen(port, '127.0.0.1', ok); });
  const actual = server.address().port;
  return {
    server, port: actual, base: `http://127.0.0.1:${actual}`,
    // closeAllConnections: a keep-alive socket from Chromium otherwise holds
    // close() open for seconds and a finished critic looks hung.
    close: () => new Promise((ok) => { try { server.closeAllConnections && server.closeAllConnections(); } catch (e) {} server.close(() => ok()); }),
  };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const want = Number.parseInt(process.env.PORT || '0', 10) || 0;
  const s = await startServer({ port: want });
  // First line is machine-readable on purpose: `PORT=53124`.
  console.log(`PORT=${s.port}`);
  console.log(`serving ${PUBLIC} at ${s.base}  (harness files at ${s.base}/__sc/, self-test ${s.base}/__sc/selftest.html)`);
}
