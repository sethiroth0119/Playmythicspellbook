/* ══════════════════════════════════════════════════════════════════════════
   🔍 DRIVE-BATTLE-CAM — the battlefield zooms and rotates, and nothing else does.

   THE ASK: "add a zoom in feature where players can zoom in and out the
   battlefield due to not being able to see when the units are bunched up and
   also add a rotate with e for e rotate right and q rotate left on the board.
   Zoom in is scroll in and scroll out with the mouse or r for zoom in and f
   zoom out. Still make the game look the same, don't move any of the UI or
   anything else. Also remove the background image of the battlefield."

   🔴 THE HARD PART IS THE SECOND SENTENCE, NOT THE FIRST. Zooming a board is a
      scale(); doing it without disturbing anything is the requirement. So the
      controls to check are as much about what must NOT move — the card hand,
      the rails, the HUD — and about the board looking IDENTICAL until somebody
      asks for a change. Both are measured here as rects, not read off the CSS.

   Pinned, with controls:
     · the board renders identically until the camera is touched
     · R zooms in, F zooms out, and both stop at their limits
     · E rotates right, Q rotates left, and the rotation wraps
     · the mouse wheel zooms over the board
     · 🔴 CONTROL: …and a wheel over the CARD HAND still scrolls the hand
     · 🔴 CONTROL: the hand, the rails and the HUD do not move when the board does
     · 🔴 CONTROL: R/F/Q/E are not stolen while typing in a text field
     · the background photo is gone

   Run:  node .gauntlet/drive-battle-cam.mjs
   ══════════════════════════════════════════════════════════════════════════ */
import { chromium } from 'playwright';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';

const ROOT = path.resolve(process.cwd(), 'public');
const M = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.glb': 'model/gltf-binary', '.mp3': 'audio/mpeg' };
const P = 9860 + (process.pid % 30);
const srv = http.createServer((q, r) => {
  let p = decodeURIComponent(q.url.split('?')[0]); if (p.endsWith('/')) p += 'index.html';
  const fp = path.join(ROOT, p);
  if (!fp.startsWith(ROOT) || !fs.existsSync(fp) || fs.statSync(fp).isDirectory()) { r.writeHead(404); return r.end('nf'); }
  r.writeHead(200, { 'Content-Type': M[path.extname(fp)] || 'application/octet-stream' });
  fs.createReadStream(fp).pipe(r);
});
await new Promise(r => srv.listen(P, '127.0.0.1', r));

const b = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const errs = [];
const pg = await b.newPage({ viewport: { width: 1400, height: 900 } });
pg.on('pageerror', e => errs.push(String(e).slice(0, 220)));
await pg.route('**/*', (r) => {
  const u = r.request().url();
  if (u.includes('127.0.0.1') || u.includes('cdn.jsdelivr.net') || u.includes('unpkg.com')) return r.continue();
  return r.abort();
});
await pg.goto('http://127.0.0.1:' + P + '/index.html', { waitUntil: 'domcontentloaded', timeout: 120000 });
await pg.waitForFunction('typeof window.MythicBattleCam === "object"', null, { timeout: 180000 }).catch(() => {});
await pg.waitForTimeout(5000);

const out = {};

/* ── the source, read off disk: the photo is gone ────────────────────────── */
{
  const src = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  out.source = {
    /* 🖼 THE BACKDROP PHOTO, removed by request. Both the battle-screen
       background stack and the 3D map's default asked for it. */
    photoInBackground: /url\('assets\/background\/Backgrounds\/Combatbackground\.png'\)/.test(src),
    photoAsDefaultBackdrop: /backdrop: 'assets\/background\/Backgrounds\/Combatbackground\.png'/.test(src),
    /* …and the camera is on the board's own transform. The ISO board gets the
       full 3D treatment (rotateZ inside its existing perspective stack)… */
    varsInTransform: /rotateZ\(var\(--bf-rot, 0deg\)\)/.test(src) && /var\(--bf-zoom, 1\)/.test(src),
    /* 🔴 …and the FLAT board gets a purely 2D one, which is not a style
       preference. That board is flat because ANY perspective/rotateX turns it
       into a projected layer the browser must re-sample whenever a descendant
       animates, and the sub-pixel differences in that re-sampling ARE the
       board-shifting bug the comment above it was written after chasing. If
       this assertion ever fails because somebody 'unified' the two rules, the
       bug is back and it will look like a rendering glitch, not like a camera
       change. */
    flatIs2D: /transform: translateZ\(0\) rotate\(var\(--bf-rot, 0deg\)\) scale\(var\(--bf-zoom, 1\)\);/.test(src),
    flatHasNoPerspective: !/transform: translateZ\(0\)[^;]*perspective/.test(src),
  };
}

/* ── the camera exists and starts at identity ────────────────────────────── */
out.api = await pg.evaluate(() => {
  const C = window.MythicBattleCam;
  if (!C) return { present: false };
  return { present: true, start: C.state() };
});

/* ── build a board to point it at, and measure everything around it ──────── */
out.rects = await pg.evaluate(async () => {
  /* A minimal board + the neighbours that must not move. The real battle screen
     needs a match in progress; this measures the same CSS on the same classes,
     which is what the ask is about — the transform must not reach outside. */
  const wrap = document.createElement('div');
  wrap.className = 'battle-screen';
  /* ⚠ iso-mode, because that is the board the player is actually looking at —
     the screenshot that prompted this is a tilted hex field. The flat board is
     covered by the source assertions above, since its whole requirement is
     about which CSS functions appear, not about what the rect does. */
  wrap.innerHTML = '<div class="board-area"><div class="board iso-mode" id="camtest-board"></div></div>'
    + '<div class="hand" id="camtest-hand" style="height:60px"></div>';
  wrap.style.cssText = 'position:fixed;left:0;top:0;width:900px;height:700px;z-index:1;';
  document.body.appendChild(wrap);
  await new Promise((r) => setTimeout(r, 120));
  const board = document.getElementById('camtest-board');
  const hand = document.getElementById('camtest-hand');
  const rect = (el) => { const r = el.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }; };
  const tf = () => getComputedStyle(board).transform;

  const before = { board: rect(board), hand: rect(hand), tf: tf() };
  const C = window.MythicBattleCam;
  C.reset();
  await new Promise((r) => setTimeout(r, 60));
  const atIdentity = { tf: tf(), board: rect(board) };

  C.zoom(0.6);
  await new Promise((r) => setTimeout(r, 60));
  const zoomed = { tf: tf(), board: rect(board), hand: rect(hand), state: C.state() };

  C.rotate(45);
  await new Promise((r) => setTimeout(r, 60));
  const rotated = { tf: tf(), hand: rect(hand), state: C.state() };

  C.reset();
  await new Promise((r) => setTimeout(r, 60));
  const back = { tf: tf(), board: rect(board), state: C.state() };

  wrap.remove();
  return { before, atIdentity, zoomed, rotated, back };
});

/* ── the keys ────────────────────────────────────────────────────────────── */
out.keys = await pg.evaluate(async () => {
  const wrap = document.createElement('div');
  wrap.className = 'battle-screen';
  wrap.innerHTML = '<div class="board-area"><div class="board iso-mode" id="camtest-board2"></div></div>';
  wrap.style.cssText = 'position:fixed;left:0;top:0;width:900px;height:700px;z-index:1;';
  document.body.appendChild(wrap);
  await new Promise((r) => setTimeout(r, 100));
  const C = window.MythicBattleCam;
  C.reset();
  const fire = (key, target) => {
    const ev = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
    (target || document.body).dispatchEvent(ev);
    return ev.defaultPrevented;
  };
  const o = {};
  o.rPrevented = fire('r'); o.afterR = C.state().zoom;
  fire('r'); fire('r');
  o.afterRRR = C.state().zoom;
  fire('f');
  o.afterF = C.state().zoom;
  C.reset();
  fire('e'); o.afterE = C.state().rot;
  fire('q'); fire('q'); o.afterQQ = C.state().rot;
  /* limits */
  C.reset();
  for (let i = 0; i < 60; i++) fire('r');
  o.maxZoom = C.state().zoom;
  for (let i = 0; i < 200; i++) fire('f');
  o.minZoom = C.state().zoom;
  /* rotation wraps rather than running away */
  C.reset();
  for (let i = 0; i < 40; i++) fire('e');
  o.wrapped = C.state().rot;
  /* 🔴 CONTROL: a text field owns its own keys. */
  C.reset();
  const inp = document.createElement('input');
  document.body.appendChild(inp);
  const prevented = fire('r', inp);
  o.typingIgnored = C.state().zoom === 1 && prevented === false;
  inp.remove();
  /* 🔴 CONTROL: modifiers are somebody else's shortcut. */
  C.reset();
  const ev = new KeyboardEvent('keydown', { key: 'r', ctrlKey: true, bubbles: true, cancelable: true });
  document.body.dispatchEvent(ev);
  o.ctrlIgnored = C.state().zoom === 1;
  C.reset();
  wrap.remove();
  /* 🔴 CONTROL: with no board on screen the keys do nothing at all. */
  await new Promise((r) => setTimeout(r, 80));
  fire('r');
  o.noBoardIgnored = C.state().zoom === 1;
  return o;
});

/* ── the wheel ───────────────────────────────────────────────────────────── */
out.wheel = await pg.evaluate(async () => {
  const wrap = document.createElement('div');
  wrap.className = 'battle-screen';
  wrap.innerHTML = '<div class="board-area" id="camtest-area"><div class="board iso-mode" id="camtest-board3"></div></div>'
    + '<div class="hand" id="camtest-hand3" style="height:60px"></div>';
  wrap.style.cssText = 'position:fixed;left:0;top:0;width:900px;height:700px;z-index:1;';
  document.body.appendChild(wrap);
  await new Promise((r) => setTimeout(r, 100));
  const C = window.MythicBattleCam;
  C.reset();
  const spin = (el, dy) => {
    const ev = new WheelEvent('wheel', { deltaY: dy, bubbles: true, cancelable: true });
    el.dispatchEvent(ev);
    return ev.defaultPrevented;
  };
  const o = {};
  const area = document.getElementById('camtest-area');
  o.overBoardPrevented = spin(area, -300);
  o.afterScrollIn = C.state().zoom;
  spin(area, 600);
  o.afterScrollOut = C.state().zoom;
  /* 🔴 CONTROL: a wheel over the CARD HAND is somebody scrolling their hand and
     must not zoom the board or have its default eaten. */
  C.reset();
  const hand = document.getElementById('camtest-hand3');
  o.overHandPrevented = spin(hand, -300);
  o.handDidNotZoom = C.state().zoom === 1;
  C.reset();
  wrap.remove();
  return o;
});

/* ══ 🔴 THE 3D TERRAIN AND THE HTML TILES MUST STAY MARRIED ════════════════
   With the admin's 3D board on, the ground is a WebGL canvas and the tiles and
   units are HTML on a CSS-transformed layer ABOVE it. Zooming only the CSS
   layer slides every unit off the hex it is standing on, and the further you
   zoom the wronger it gets — worse than having no zoom at all. That is the bug
   the first version of this feature would have shipped, because its driver
   built a synthetic board and never had a 3D map underneath it.
   The fix is that the 3D zoom is FOV, not distance: narrowing the field of
   view is an image-space scale about the centre, which is exactly what CSS
   scale() is. This measures that equivalence rather than trusting it. */
/* three.js is loaded lazily by the 3D board, so a page that has never shown a
   battle does not have it. Loaded here the same way the board loads it — the
   alternative was a stage that SKIPPED, and a skipped stage is an untested
   claim wearing a green tick. */
await pg.evaluate(() => new Promise((res) => {
  if (window.THREE) return res(true);
  const el = document.createElement('script');
  el.src = '/assets/vfx/three.min.js';
  el.onload = () => res(true); el.onerror = () => res(false);
  document.head.appendChild(el);
}));
await pg.waitForTimeout(600);

out.lockstep = await pg.evaluate(() => {
  const o = {};
  if (typeof _b3dApplyCam !== 'function' || typeof _B3D === 'undefined') return { skipped: 'no 3D board in this build' };
  /* Stand up a camera the same way the board does, without needing a match. */
  const THREE = window.THREE;
  if (!THREE) return { skipped: 'three.js not loaded' };
  const cam = new THREE.PerspectiveCamera(50, 1.6, 0.1, 200);
  const savedCam = _B3D.camera, savedRows = _B3D.rows, savedOn = _B3D.on;
  _B3D.camera = cam; _B3D.rows = 10; _B3D.on = true;

  /* A point on the ground plane, off-centre so a wrong zoom shows up. */
  const probe = new THREE.Vector3(2.5, 0, 1.5);
  const project = () => {
    const v = probe.clone().project(cam);
    return { x: Math.round(v.x * 10000) / 10000, y: Math.round(v.y * 10000) / 10000 };
  };
  _b3dSetView(1, 0);
  _b3dSetView(1, 0);            // settle any lazy load inside _b3dCam()
  const at1 = project();
  const pos1 = { x:+cam.position.x.toFixed(3), y:+cam.position.y.toFixed(3), z:+cam.position.z.toFixed(3), fov:+cam.fov.toFixed(3), aspect:+cam.aspect.toFixed(3) };
  _b3dSetView(2, 0);
  const at2 = project();
  const pos2 = { x:+cam.position.x.toFixed(3), y:+cam.position.y.toFixed(3), z:+cam.position.z.toFixed(3), fov:+cam.fov.toFixed(3), aspect:+cam.aspect.toFixed(3) };
  o.pos1 = pos1; o.pos2 = pos2;
  _b3dSetView(1, 0);
  const back = project();

  /* 🔴 A TRUE IMAGE-SPACE 2x ZOOM DOUBLES EVERY NDC OFFSET FROM THE CENTRE.
     If the 3D side dollied instead, this ratio would be wrong — and wrong by
     a different amount for near and far hexes, which is precisely the drift
     that would peel the tiles off the ground. */
  o.ndc1 = at1; o.ndc2 = at2;
  o.ratioX = at1.x !== 0 ? Math.round((at2.x / at1.x) * 1000) / 1000 : null;
  o.ratioY = at1.y !== 0 ? Math.round((at2.y / at1.y) * 1000) / 1000 : null;
  o.matchesCssScale = Math.abs((o.ratioX || 0) - 2) < 0.02 && Math.abs((o.ratioY || 0) - 2) < 0.02;
  o.resetExact = Math.abs(back.x - at1.x) < 1e-6 && Math.abs(back.y - at1.y) < 1e-6;

  /* 🔄 rotation orbits rather than rolling: the camera moves off the Z axis */
  _b3dSetView(1, 90);
  o.orbitX = Math.round(cam.position.x * 1000) / 1000;
  o.orbitZ = Math.round(cam.position.z * 1000) / 1000;
  o.orbited = Math.abs(o.orbitX) > 1 && Math.abs(o.orbitZ) < 0.01;
  _b3dSetView(1, 0);

  /* 🔴 CONTROL: none of this touched the ADMIN's saved camera. */
  o.savedCamUntouched = !(typeof Forge !== 'undefined' && Forge.battleMap3d && Forge.battleMap3d.cam);
  _B3D.camera = savedCam; _B3D.rows = savedRows; _B3D.on = savedOn;
  _B3D.viewZoom = 1; _B3D.viewYaw = 0;
  return o;
});

await pg.close();

const bad = [];
const need = (k, ok, d) => { if (!ok) bad.push(k + (d !== undefined ? ' — ' + JSON.stringify(d) : '')); };
const SRC = out.source || {}, API = out.api || {}, R = out.rects || {}, K = out.keys || {}, WH = out.wheel || {};

need('THE ASK: the battlefield background photo is gone',
     SRC.photoInBackground === false, SRC);
need('…and no 3D map defaults to it either', SRC.photoAsDefaultBackdrop === false, SRC);
need('the camera is two variables on the iso board\'s own transform', SRC.varsInTransform === true, SRC);
need('🔴 …and the FLAT board stays 2D — no perspective, no projected layer',
     SRC.flatIs2D === true && SRC.flatHasNoPerspective === true, SRC);

need('SETUP: the camera is reachable', API.present === true, API);
need('…and starts at identity', API.start && API.start.zoom === 1 && API.start.rot === 0, API.start);

/* 🔴 the look-the-same requirement, as a measurement */
need('🔴 THE ASK: an untouched board renders EXACTLY as it did',
     (R.before || {}).tf === (R.atIdentity || {}).tf, { before: (R.before || {}).tf, identity: (R.atIdentity || {}).tf });
need('zooming changes the board transform', (R.zoomed || {}).tf !== (R.atIdentity || {}).tf, R.zoomed);
need('rotating changes it again', (R.rotated || {}).tf !== (R.zoomed || {}).tf, R.rotated);
need('🔴 CONTROL: the card hand does not move when the board zooms',
     JSON.stringify((R.before || {}).hand) === JSON.stringify((R.zoomed || {}).hand),
     { before: (R.before || {}).hand, after: (R.zoomed || {}).hand });
need('🔴 CONTROL: …nor when it rotates',
     JSON.stringify((R.before || {}).hand) === JSON.stringify((R.rotated || {}).hand),
     { before: (R.before || {}).hand, after: (R.rotated || {}).hand });
need('…and reset puts it back exactly', (R.back || {}).tf === (R.atIdentity || {}).tf, R.back);

need('THE ASK: R zooms in', (K.afterR || 0) > 1, K);
need('…and takes the key', K.rPrevented === true, K);
need('THE ASK: F zooms out', (K.afterF || 9) < (K.afterRRR || 0), K);
need('THE ASK: E rotates right', (K.afterE || 0) > 0, K);
need('THE ASK: Q rotates left', (K.afterQQ || 9) < (K.afterE || 0), K);
need('zoom stops at a sensible ceiling', (K.maxZoom || 99) <= 2.6001 && (K.maxZoom || 0) > 1.5, K.maxZoom);
need('…and a sensible floor', (K.minZoom || 0) >= 0.5999 && (K.minZoom || 9) < 1, K.minZoom);
need('rotation wraps instead of running away', Math.abs(K.wrapped || 999) <= 180, K.wrapped);
need('🔴 CONTROL: typing in a field does not zoom the board', K.typingIgnored === true, K);
need('🔴 CONTROL: Ctrl+R is still the browser\'s', K.ctrlIgnored === true, K);
need('🔴 CONTROL: with no board on screen the keys do nothing', K.noBoardIgnored === true, K);

need('THE ASK: the wheel zooms over the board', (WH.afterScrollIn || 0) > 1, WH);
need('…both ways', (WH.afterScrollOut || 9) < (WH.afterScrollIn || 0), WH);
need('…and stops the page scrolling underneath it', WH.overBoardPrevented === true, WH);
need('🔴 CONTROL: a wheel over the CARD HAND does not zoom the board', WH.handDidNotZoom === true, WH);
need('🔴 CONTROL: …and the hand keeps its own scroll', WH.overHandPrevented === false, WH);

const LS = out.lockstep || {};
if (LS.skipped) console.log('  · 3D lockstep stage skipped: ' + LS.skipped);
else {
  need('🔴 THE 3D ZOOM IS AN IMAGE-SPACE SCALE, so the HTML tiles stay on their hexes',
       LS.matchesCssScale === true, { ratioX: LS.ratioX, ratioY: LS.ratioY, want: 2 });
  need('…and returning to 1 restores the projection exactly', LS.resetExact === true, LS);
  need('🔄 rotation ORBITS the board rather than rolling the camera', LS.orbited === true, LS);
  need('🔴 CONTROL: the player\'s view never writes the admin\'s saved camera',
       LS.savedCamUntouched === true, LS.savedCamUntouched);
}

need('no page errors', errs.length === 0, errs.slice(0, 3));

console.log(JSON.stringify(out, null, 1));
console.log(bad.length ? '\n❌ FAIL:\n  · ' + bad.join('\n  · ')
                       : '\n✅ PASS — the board zooms and rotates, everything around it stays exactly where it was, and the backdrop photo is gone.');
await b.close(); srv.close();
process.exit(bad.length ? 1 : 0);
