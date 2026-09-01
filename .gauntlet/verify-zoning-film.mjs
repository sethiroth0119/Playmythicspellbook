/* ══════════════════════════════════════════════════════════════════════════
   ⏸ THE DORMANT FILM, MEASURED RATHER THAN LOOKED AT.

   The claim under test is "zoned-but-dormant land looks different from
   zoned-and-building". A screenshot of a colour is not a measurement, and this
   project has twice had a critic score a regression that turned out to be a
   crowd agent losing a coin flip between two captures. So a CONTROL is measured
   first — two frames with nothing changed between them — and the treatment has
   to clear it.

   🔴 A PER-PIXEL FRAME DIFF DOES NOT WORK ON THIS SCENE, AND THAT IS THE FIRST
      THING THIS FILE LEARNED. Two do-nothing frames 4.2 s apart differ in
      **136,171 of 868,000 pixels** at a 12/765 threshold and still **88,149**
      at 150/765 — 10% of the frame moving by more than a fifth of full range,
      with nothing changed between the two captures. That is not the crowd (30
      agents cannot be 88k px) and it is not sun drift over three minutes: it is
      what a scene whose camera never sits perfectly still looks like under a
      per-pixel comparison, because every high-contrast edge flips. Any signal
      smaller than a tenth of the frame is unmeasurable that way. Recorded here
      so the next builder does not spend the round rediscovering it.

   SO TWO METRICS THAT SURVIVE IT:
     1. THE FILM ITSELF — the overlay mesh's own vertex colours and counts, read
        out of the scene through `MythicZoning._ctx.scene`. That is the artifact
        under test rather than a photograph of it.
     2. THE FRAME'S MEAN COLOUR — jitter moves pixels around and preserves the
        average, so a mean shift is a real change in what is being drawn.

   Usage: node .gauntlet/verify-zoning-film.mjs
   Exits non-zero if the film does not measurably change.
   ══════════════════════════════════════════════════════════════════════════ */
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const ROOT = path.resolve(process.cwd(), 'public');
const THREE_ = path.resolve(process.cwd(), '.gauntlet/package');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.glb': 'model/gltf-binary', '.txt': 'text/plain', '.webp': 'image/webp' };
const PORT = 8900 + (process.pid % 90);

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
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
    '--ignore-gpu-blocklist', '--no-sandbox', '--disable-dev-shm-usage', '--no-proxy-server'],
  env: Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(HTTPS?_PROXY|https?_proxy|ALL_PROXY|all_proxy)$/.test(k))),
});
const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
/* 🕒 THE CLOCK IS PINNED TO MIDDAY, AND IT IS THE DIFFERENCE BETWEEN A
   MEASUREMENT AND A MOOD. `estClock()` reads the real wall clock, so an
   unpinned run photographs whatever hour it happens to be — the first pass of
   this file ran at dusk, with the lamps coming on and the sky mid-transition,
   and every frame differed from the one before it across a tenth of the image
   before anything under test had changed. Same shift capture.mjs has used since
   round 3: the DATE moves, the clock still runs, so anything deriving a dt
   still works. */
await page.addInitScript(({ hour }) => {
  const _D = Date;
  const parts = {};
  for (const p of new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York',
        hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).formatToParts(new _D()))
    parts[p.type] = p.value;
  const curH = (+parts.hour % 24) + (+parts.minute) / 60 + (+parts.second) / 3600;
  const shiftMs = (hour - curH) * 3600 * 1000;
  class ShiftedDate extends _D {
    constructor(...a) { if (a.length === 0) super(_D.now() + shiftMs); else super(...a); }
    static now() { return _D.now() + shiftMs; }
  }
  ShiftedDate.parse = _D.parse; ShiftedDate.UTC = _D.UTC;
  window.Date = ShiftedDate;
}, { hour: 13 });
await page.route('**/*', (r) => {
  const u = r.request().url();
  if (u.includes('127.0.0.1') || u.includes('localhost') || u.includes('jsdelivr')) return r.continue();
  r.abort();
});
await page.route('**/cdn.jsdelivr.net/npm/three@0.171.0/**', (r) => {
  const u = new URL(r.request().url());
  const f = path.join(THREE_, u.pathname.replace('/npm/three@0.171.0/', ''));
  if (!fs.existsSync(f)) return r.fulfill({ status: 404, body: 'nf' });
  r.fulfill({ status: 200, contentType: 'text/javascript', body: fs.readFileSync(f) });
});

/* ⚠ CAPTURE THE PAGE'S OWN VOICE. A harness that cannot see a console.warn is
   a harness that reports "measured nothing" when the truth is "the module did
   not mount" — the two look identical from out here, which is the same
   guarded-import blind spot modcheck.mjs exists to close. */
const pageLogs = [];
page.on('console', (m) => pageLogs.push('[' + m.type() + '] ' + m.text().slice(0, 300)));
page.on('pageerror', (e) => pageLogs.push('[pageerror] ' + String(e.message).slice(0, 300)));

await page.goto(`http://127.0.0.1:${PORT}/node-city/index.html`, { waitUntil: 'load', timeout: 120000 });
await page.waitForTimeout(24000);
await page.evaluate(fs.readFileSync('.gauntlet/scene.js', 'utf8'));
await page.waitForTimeout(5000);

/* Zone the built housing as towers, run the city, put the film up and get the
   panels out of the frame.

   🔴 …AND ZONE A BLOCK OF EMPTY LAND, WHICH IS THE ONLY PLACE THE FILM CAN BE
      SEEN AT ALL. The first pass zoned the DEVELOPED housing band and then
      cropped to it, and the measurement came in under the do-nothing control.
      The photograph says why (.gauntlet/shots/film-dormant.png): a level-5
      tower covers its whole plot, so on built land there is no ground left for
      a ground film to be drawn on. That is not a defect in the film — the
      overlay's own header has always said it sits at y=.05 and is "correctly
      occluded BY the buildings standing in it" — it means the claim
      "zoned-but-dormant land LOOKS different" can only be tested where a
      player would actually be looking at it: land they have just zoned and not
      yet built. */
/* 🔴 AND THE ZONE ID IS `r_low`, NOT `r_low`'s denser cousins, BECAUSE
   /src/progression LOCKS THEM. That module wraps `MythicZoning.setZone` and
   refuses an id the player has not unlocked yet — it landed in this tree while
   this file was being written, and every `setZone(x, z, 'r_high')` in here
   started returning `false` in silence. The harness dutifully reported "no
   zoned tiles to project": a driver that hardcodes a locked id measures
   nothing and says nothing, which is the same silent-gate failure this whole
   round is about, one layer down. `r_low` is unlocked from the first minute. */
const setup = await page.evaluate(async () => {
  const Z = window.MythicZoning, N = window.__nc;
  for (const k in N.game.tiles) {
    const t = N.game.tiles[k];
    if (t && t.type === 'housing') { const c = k.split(','); Z.setZone(+c[0], +c[1], 'r_low'); }
  }
  /* An empty block. ⚠ SCANNED OVER THE WHOLE BOARD AND SORTED BY DISTANCE FROM
     THE CENTRE, not taken from a fixed 8..16 window: scene.js places 211
     buildings and which tiles it leaves bare moves from run to run, so the
     fixed window found twelve tiles on one run and none on the next — the
     harness then exited with "no zoned tiles to project" and measured nothing.
     A test whose subject depends on a random draw is a test that reports
     nothing on the draws that matter. */
  const GRID = 24, C = GRID / 2;
  const cand = [];
  for (let x = 1; x < GRID - 1; x++) {
    for (let z = 1; z < GRID - 1; z++) {
      const k = x + ',' + z;
      if (N.game.tiles[k]) continue;
      cand.push({ x, z, k, d: Math.abs(x - C) + Math.abs(z - C) });
    }
  }
  cand.sort((a, b) => a.d - b.d);
  const empty = [];
  const why = [];
  for (const c of cand) {
    if (empty.length >= 24) break;
    let r;
    try { r = Z.setZone(c.x, c.z, 'r_low'); }
    catch (e) { r = 'THREW: ' + e.message; }
    if (r === true) empty.push(c.k);
    else if (why.length < 5) why.push({ k: c.k, r: String(r), was: Z.zoneAt(c.x, c.z),
                                        hasId: !!Z.ZONE_BY_ID['r_low'] });
  }
  Z.sync();
  const afterPaint = Object.keys(Z.save()).length;
  await N.step(20, 20);
  const afterStep = Object.keys(Z.save()).length;
  Z.panel(false);
  Z.overlay(true);
  await new Promise((r) => setTimeout(r, 4200));
  window.__emptyZoned = empty;
  return { zoned: Z.stats().zoned, dormant: Z.dormantTiles(), on: Z.stats().overlay,
           candidates: cand.length, emptyZoned: empty.length, sample: empty.slice(0, 6),
           afterPaint, afterStep, zoneIds: (Z.ZONES || []).length, why,
           probe: (() => { const c = cand[0]; return c ? { k: c.k, set: Z.setZone(c.x, c.z, 'r_low') } : null; })() };
});
console.error('[setup] ' + JSON.stringify(setup));

/* 🔴 THE CROP IS THE ZONED LAND ITSELF, PROJECTED THROUGH THE REAL CAMERA.
   ────────────────────────────────────────────────────────────────────────────
   The first two passes cropped "the residential band" by eye — 1240x700 of the
   frame — and neither a per-pixel diff nor a mean-colour shift could see the
   film change at all: the treatment came in BELOW the do-nothing control
   (mean-colour 0.33 against a floor of 0.66). That is not the film failing, it
   is the measurement: 54 one-tile films, most of them with a building standing
   on them, are a small part of 868,000 px, and any whole-frame statistic
   averages them away.

   So the crop is derived rather than chosen. The zoned tiles' centres are
   projected through `__nc.camera` — the SAME camera the frame was rendered
   with, so the box cannot drift out of the picture the way a hardcoded
   rectangle does the first time somebody moves the default framing. */
const box = await page.evaluate(() => {
  const Z = window.MythicZoning, N = window.__nc;
  const THREE = Z._ctx.THREE, cam = N.camera;
  const HALF = Z._ctx.HALF != null ? Z._ctx.HALF : (Z._ctx.GRID || 24) / 2;
  const W = window.innerWidth, H = window.innerHeight;
  let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9, n = 0;
  /* ⚠ ONLY THE EMPTY ZONED TILES. Cropping to the built ones measures rooftops.
     See the setup block. */
  const zones = {};
  for (const k of (window.__emptyZoned || [])) zones[k] = true;
  for (const k in zones) {
    const c = k.split(',');
    const v = new THREE.Vector3(+c[0] - HALF + 0.5, 0.05, +c[1] - HALF + 0.5);
    v.project(cam);
    const sx = (v.x * 0.5 + 0.5) * W, sy = (-v.y * 0.5 + 0.5) * H;
    if (!isFinite(sx) || !isFinite(sy)) continue;
    x0 = Math.min(x0, sx); x1 = Math.max(x1, sx);
    y0 = Math.min(y0, sy); y1 = Math.max(y1, sy);
    n++;
  }
  if (!n) return null;
  const pad = 26;                       // a tile is ~50px at the default camera
  x0 = Math.max(0, Math.floor(x0 - pad)); y0 = Math.max(0, Math.floor(y0 - pad));
  x1 = Math.min(W, Math.ceil(x1 + pad)); y1 = Math.min(H, Math.ceil(y1 + pad));
  return { x: x0, y: y0, width: Math.max(8, x1 - x0), height: Math.max(8, y1 - y0), tiles: n };
});
if (!box) {
  console.error('no zoned tiles to project');
  console.error(pageLogs.filter((l) => /Zoning|Demographics|error|Error/.test(l)).slice(-25).join('\n'));
  process.exit(1);
}
const CROP = { x: box.x, y: box.y, width: box.width, height: box.height };
const shot = () => page.screenshot({ clip: CROP });

/* PNG → raw RGBA, without a dependency. Playwright hands back a PNG; every
   frame here is the same size and colour type, so one small decoder is enough
   and it is cheaper than adding a package (CLAUDE.md: no new npm deps). */
function decode(buf) {
  let p = 8, w = 0, h = 0; const idat = [];
  while (p < buf.length) {
    const len = buf.readUInt32BE(p); const type = buf.toString('ascii', p + 4, p + 8);
    const data = buf.subarray(p + 8, p + 8 + len);
    if (type === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); }
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    p += 12 + len;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const bpp = 4, stride = w * bpp, out = Buffer.alloc(h * stride);
  let o = 0;
  for (let y = 0; y < h; y++) {
    const ft = raw[o++];
    const line = raw.subarray(o, o + stride); o += stride;
    const cur = out.subarray(y * stride, (y + 1) * stride);
    const prev = y > 0 ? out.subarray((y - 1) * stride, y * stride) : null;
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? cur[x - bpp] : 0;
      const b = prev ? prev[x] : 0;
      const c = (prev && x >= bpp) ? prev[x - bpp] : 0;
      let v = line[x];
      if (ft === 1) v += a; else if (ft === 2) v += b; else if (ft === 3) v += (a + b) >> 1;
      else if (ft === 4) { const pp = a + b - c, pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c);
        v += (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c); }
      cur[x] = v & 255;
    }
  }
  return { w, h, data: out };
}
/* Mean colour of the crop. Robust to the sub-pixel camera drift above: a shift
   re-arranges pixels, it does not darken them. */
const mean = (A) => {
  let r = 0, g = 0, b = 0; const n = A.data.length / 4;
  for (let i = 0; i < A.data.length; i += 4) { r += A.data[i]; g += A.data[i + 1]; b += A.data[i + 2]; }
  return [r / n, g / n, b / n];
};
const meanDelta = (A, B) => {
  const m = mean(A), n = mean(B);
  return +(Math.abs(m[0] - n[0]) + Math.abs(m[1] - n[1]) + Math.abs(m[2] - n[2])).toFixed(3);
};

/* THE FILM'S OWN GEOMETRY. `MythicZoning._ctx` is the hand-over node-city gave
   the module, and it carries the scene — `scene` is a top-level const in
   node-city's module script and is not on window (the globals trap). */
const readFilm = () => page.evaluate(() => {
  const sc = window.MythicZoning && window.MythicZoning._ctx && window.MythicZoning._ctx.scene;
  let m = null;
  sc.traverse((o) => { if (o.name === 'zoning-overlay') m = o; });
  if (!m) return null;
  const c = m.geometry.getAttribute('color');
  let r = 0, g = 0, b = 0, amber = 0;
  for (let i = 0; i < c.count; i++) {
    const R = c.getX(i), G = c.getY(i), B = c.getZ(i);
    r += R; g += G; b += B;
    // the dormant rim / pause mark, in LINEAR: 1.00, 0.30, 0.03
    if (R > 0.95 && G > 0.20 && G < 0.45 && B < 0.15) amber++;
  }
  return { visible: !!m.visible, verts: c.count,
           mean: [+(r / c.count).toFixed(4), +(g / c.count).toFixed(4), +(b / c.count).toFixed(4)],
           amberVerts: amber };
});

/* 1. CONTROL — nothing changed, same wait. Whatever this reads is the crowd,
      the sky and the clock, and it is the floor the treatment must clear. */
const c0 = decode(await shot());
const filmShut = await readFilm();
await page.waitForTimeout(4200);
const c1 = decode(await shot());
const noise = meanDelta(c0, c1);

/* 2. TREATMENT — the gate opens, the film should come back to normal. The
      verdict is swapped at the seam because a 20-minute run cannot feed a
      district that has no clinic. */
await page.evaluate(() => {
  window.__realGrowth = window.MythicDemographics.growth;
  window.MythicDemographics.growth = () => ({ ok: true, open: true, reason: null, grow: 0.9, needs: [], text: 'open', chip: '' });
});
await page.waitForTimeout(4200);
const openFrame = decode(await shot());
const filmOpen = await readFilm();
const opened = await page.evaluate(() => window.MythicZoning.dormantTiles());
const treat = meanDelta(c1, openFrame);

/* 3. …and back, so a mark that never clears would be caught too. */
await page.evaluate(() => { window.MythicDemographics.growth = window.__realGrowth; });
await page.waitForTimeout(4200);
const backFrame = decode(await shot());
const filmBack = await readFilm();
const back = await page.evaluate(() => window.MythicZoning.dormantTiles());
const treatBack = meanDelta(openFrame, backFrame);

/* Three crops of the same land, for a human: what the film says while the gate
   is shut, what it says when it is open, and the ground with no film at all. */
fs.mkdirSync('.gauntlet/shots', { recursive: true });
await page.screenshot({ path: '.gauntlet/shots/film-dormant.png', clip: CROP });
await page.evaluate(() => { window.MythicDemographics.growth = () => ({ ok: true, open: true, reason: null, grow: 0.9, needs: [], text: 'open', chip: '' }); });
await page.waitForTimeout(4200);
await page.screenshot({ path: '.gauntlet/shots/film-open.png', clip: CROP });
await page.evaluate(() => { window.MythicDemographics.growth = window.__realGrowth; window.MythicZoning.overlay(false); });
await page.waitForTimeout(600);
await page.screenshot({ path: '.gauntlet/shots/film-off.png', clip: CROP });

const res = {
  setup, crop: CROP,
  dormantTiles: { shut: setup.dormant, gateOpened: opened, shutAgain: back },
  /* The artifact. Dormant tiles carry two extra quads (the ⏸ mark) and an amber
     rim, so BOTH the vertex count and the amber count have to move with the
     verdict — a colour change alone could be a hue tweak, and a count change
     alone could be a tile appearing. */
  film: { shut: filmShut, gateOpened: filmOpen, shutAgain: filmBack },
  /* 📉 REPORTED, AND DELIBERATELY NOT PART OF THE VERDICT. `noise` is two
     do-nothing frames; the treatments are the same crop with the film's whole
     appearance changed. They come out the same size, and after three attempts
     to make them separate — coarser thresholds, a pinned clock, a crop derived
     from the camera and finally cropping to the only land the film is visible
     on — the conclusion is that a whole-frame statistic over a scene this busy
     cannot resolve a change confined to a handful of tiles. The numbers stay
     here because a future reader deserves to see WHY the verdict is not built
     on them, rather than rediscovering it. The eye can see the difference
     perfectly well: film-dormant.png vs film-open.png, saved beside this. */
  meanColour: { noiseFloor: noise, shutVsOpen: treat, openVsShutAgain: treatBack,
                note: 'informational — see the comment; the verdict is on the mesh' },
  verdict: (setup.dormant > 0 && opened === 0 && back === setup.dormant &&
            filmShut.amberVerts > 0 && filmOpen.amberVerts === 0 && filmBack.amberVerts === filmShut.amberVerts &&
            filmShut.verts > filmOpen.verts && filmBack.verts === filmShut.verts) ? 'PASS' : 'FAIL',
};
console.log(JSON.stringify(res, null, 2));
await browser.close();
server.close();
process.exit(res.verdict === 'PASS' ? 0 : 1);
