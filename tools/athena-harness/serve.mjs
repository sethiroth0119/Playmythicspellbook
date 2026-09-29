/* Static server for the Athena harness on a volume that cannot hold symlinks
   or junctions (setup.sh's `ln -s` and mklink both fail on exFAT). Maps the
   same paths www/ would have held:
     /src/*       → public/src
     /three/*     → tools/athena-harness/three
     /models/*    → tools/athena-harness/three/models
     /artifact/*  → tools/athena-harness/artifact
     /harness*.html, /shots → tools/athena-harness
   node tools/athena-harness/serve.mjs [port]   (default 8765, 127.0.0.1) */
import http from 'http';
import { createReadStream, existsSync, statSync } from 'fs';
import path from 'path';
const H = path.resolve(new URL('.', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const ROOT = path.resolve(H, '..', '..');
const MAP = [['/src/', path.join(ROOT, 'public', 'src')], ['/models/trucks/', path.join(ROOT, 'public', 'models', 'trucks')], ['/prints/', path.join(ROOT, 'Content', 'BrucePrints')], ['/bruce-prints/', path.join(ROOT, 'public', 'bruce-prints')], ['/cursors/', path.join(ROOT, 'public', 'assets', 'cursors')], ['/vendor/', path.join(ROOT, 'public', 'vendor')], ['/three/', path.join(H, 'three')], ['/models/', path.join(H, 'three', 'models')], ['/artifact/', path.join(H, 'artifact')], ['/', H]];
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.glb': 'model/gltf-binary', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.mp3': 'audio/mpeg', '.wav': 'audio/wav' };
const port = +(process.argv[2] || 8765);
http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p.endsWith('/')) p += 'harness.html';
  const m = MAP.find(([pre]) => p.startsWith(pre));
  const f = path.join(m[1], p.slice(m[0].length));
  if (!f.startsWith(m[1]) || !existsSync(f) || statSync(f).isDirectory()) { res.writeHead(404); return res.end('not found ' + p); }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(f).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' });
  createReadStream(f).pipe(res);
}).listen(port, '127.0.0.1', () => console.log('athena harness on http://127.0.0.1:' + port + '  (src → public/src)'));
