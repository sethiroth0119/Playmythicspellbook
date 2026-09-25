/* ══════════════════════════════════════════════════════════════════════════
   🎥 DRIVE-CAMERA-OFF — is the free camera really gone, by BOTH routes?

   Removed on request. The trap here is that there were TWO input paths and
   disabling either alone leaves the feature half-alive:

     1. the board's OWN keydown/keyup listeners, live whenever the iframe holds
        focus (public/battle-board/index.html, bottom of file);
     2. the HOST forwarding `board:key` edges from _bbCamKeysBind
        (public/index.html), which is the path that works when the iframe does
        NOT hold focus — the normal embedded case.

   So "I pressed W and nothing moved" proves nothing on its own: it may only
   mean the frame that happened to have focus was the disabled one. This drives
   BOTH.

   🔴 AND IT ASSERTS THE CONTROL. The camera OBJECT must still exist and still
   frame the board — the ask was to remove the player's ability to move it, not
   to remove the camera. A test that only checked "nothing moves" would pass
   just as happily on a board that no longer renders at all.

   ⚠ WHICH OF THESE CHECKS IS ACTUALLY FALSIFIABLE — MEASURED, NOT ASSUMED.
     The `return null` was temporarily removed and this driver re-run, to prove
     the checks can fail rather than trusting that they would:
       · §1 camAction — FALSIFIABLE. With the camera restored it went red
         immediately and printed the live mapping
         (KeyW=fwd KeyA=left KeyS=back KeyD=right KeyQ=yawL KeyE=yawR KeyR=reset).
         This is the decisive check: it IS the choke point both routes gate on.
       · §2/§3 the pan/yaw assertions — NOT PROVEN FALSIFIABLE. With the camera
         restored the numbers still read 0,0,0 and CAM_HELD still measured 0, so
         a synthetic KeyboardEvent on this standalone page does not reach the
         board's listener the way a real press does. Those two checks are
         therefore CORROBORATING, not load-bearing, and must not be cited on
         their own as proof the camera is off. Do not "fix" them by loosening
         the assertion — either drive a real key press through the page, or
         delete them and rely on §1.
     Saying this out loud is the point: a green that cannot go red is not
     evidence, and this file would otherwise read as five independent proofs
     when it holds one.

   Run:  node .gauntlet/drive-camera-off.mjs
   ══════════════════════════════════════════════════════════════════════════ */
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(process.cwd(), 'public');
const THREE_DIR = path.resolve(process.cwd(), '.gauntlet/three171');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.glb': 'model/gltf-binary', '.txt': 'text/plain', '.webp': 'image/webp' };
const PORT = 7900 + (process.pid % 70);
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p.endsWith('/')) p += 'index.html';
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end('nf'); }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
});
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));

const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
         '--ignore-gpu-blocklist', '--no-sandbox', '--disable-dev-shm-usage'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errs = [];
page.on('pageerror', (e) => errs.push(String(e).slice(0, 200)));
await page.route('**/*', (route) => {
  const u = route.request().url();
  if (u.includes('cdn.jsdelivr.net') && u.includes('three@')) {
    const rel = new URL(u).pathname.replace(/^\/npm\/three@[^/]+\//, '');
    const f = path.join(THREE_DIR, rel);
    return fs.existsSync(f)
      ? route.fulfill({ status: 200, contentType: 'text/javascript', body: fs.readFileSync(f) })
      : route.fulfill({ status: 404, body: 'no vendored three at ' + rel });
  }
  if (u.includes('127.0.0.1') || u.includes('localhost')) return route.continue();
  return route.abort();
});
await page.goto(`http://127.0.0.1:${PORT}/battle-board/index.html`, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForFunction('typeof CAMERA !== "undefined"', null, { timeout: 60000 }).catch(() => {});
await page.waitForTimeout(4000);

let fails = 0;
const ok = (name, cond, detail) => {
  if (!cond) fails++;
  console.log((cond ? '  OK   ' : '  FAIL ') + name + (detail == null ? '' : '   ' + detail));
};

const CAM_CODES = ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE', 'KeyR'];

const r = await page.evaluate(async (codes) => {
  const out = {};
  const snap = () => ({ px: +CAMERA.pan.x.toFixed(4), pz: +CAMERA.pan.z.toFixed(4), yaw: +CAMERA.yaw.toFixed(4) });

  /* CONTROL FIRST — the camera must still exist and still frame something. */
  out.cameraExists = typeof CAMERA === 'object' && CAMERA !== null;
  out.before = snap();
  out.hasCanvas = !!document.querySelector('canvas');
  out.camUpdateExists = typeof camUpdate === 'function';
  out.camResetExists = typeof camReset === 'function';

  /* 1. camAction — the choke point both routes gate on. */
  out.actions = codes.map((c) => ({ c, a: (typeof camAction === 'function') ? camAction(c, '') : 'NO FN' }));
  out.allNull = out.actions.every((x) => x.a === null);

  /* 2. ROUTE A — the board's OWN listeners, as if the iframe had focus. */
  for (const code of codes) {
    window.dispatchEvent(new KeyboardEvent('keydown', { code, key: code.slice(3).toLowerCase(), bubbles: true }));
  }
  await new Promise((r2) => setTimeout(r2, 60));
  out.heldAfterLocal = Object.keys(CAM_HELD).length;
  for (let i = 0; i < 40; i++) { try { camUpdate(0.05); } catch (e) { out.updErr = String(e).slice(0, 80); } }
  out.afterLocal = snap();
  for (const code of codes) window.dispatchEvent(new KeyboardEvent('keyup', { code, key: '', bubbles: true }));

  /* 3. ROUTE B — the HOST path, called exactly as handleHostMessage would. */
  for (const code of codes) { try { camKey(true, code, '', 'h'); } catch (e) { out.keyErr = String(e).slice(0, 80); } }
  await new Promise((r2) => setTimeout(r2, 60));
  out.heldAfterHost = Object.keys(CAM_HELD).length;
  for (let i = 0; i < 40; i++) { try { camUpdate(0.05); } catch (e) {} }
  out.afterHost = snap();

  /* 4. THE PULSE PATH must SURVIVE — it is how the harness drives capture. */
  out.pulseSurvives = (typeof CAM_PULSE !== 'undefined');
  return out;
}, CAM_CODES);

console.log('\n\u{1F3A5} THE FREE CAMERA — is it off by BOTH routes?\n');
console.log('   camera at rest: ' + JSON.stringify(r.before));
console.log('   after local keys: ' + JSON.stringify(r.afterLocal) + ' · after host keys: ' + JSON.stringify(r.afterHost));

console.log('\n0. THE CONTROL — the camera itself must still be there');
ok('CAMERA still exists', r.cameraExists);
ok('the board still has a canvas (I disabled input, not rendering)', r.hasCanvas);
ok('camUpdate and camReset are still defined and reachable',
   r.camUpdateExists && r.camResetExists);

console.log('\n1. the choke point');
ok('camAction returns null for every camera key',
   r.allNull, r.actions.map((x) => x.c + '=' + x.a).join(' '));

console.log('\n2. ROUTE A — the board\'s own listeners (iframe focused)');
ok('no key is held after pressing all seven', (r.heldAfterLocal | 0) === 0, 'CAM_HELD size ' + r.heldAfterLocal);
ok('the camera did not pan or yaw across 40 update ticks',
   r.afterLocal.px === r.before.px && r.afterLocal.pz === r.before.pz && r.afterLocal.yaw === r.before.yaw,
   JSON.stringify(r.before) + ' -> ' + JSON.stringify(r.afterLocal));

console.log('\n3. ROUTE B — the host-forwarded path (the embedded case)');
ok('camKey(down, ..., \'h\') holds nothing', (r.heldAfterHost | 0) === 0, 'CAM_HELD size ' + r.heldAfterHost);
ok('the camera still did not move',
   r.afterHost.px === r.before.px && r.afterHost.pz === r.before.pz && r.afterHost.yaw === r.before.yaw,
   JSON.stringify(r.before) + ' -> ' + JSON.stringify(r.afterHost));

console.log('\n4. what must NOT have been broken');
ok('the board:camera PULSE path is intact (the harness drives capture with it)',
   r.pulseSurvives === true, String(r.pulseSurvives));

console.log('\npage errors: ' + errs.length);
errs.slice(0, 3).forEach((e) => console.log('   ' + e));
console.log(fails ? '\n' + fails + ' CHECK(S) FAILED' : '\nALL CHECKS PASSED');
await browser.close();
server.close();
process.exit(fails ? 1 : 0);
