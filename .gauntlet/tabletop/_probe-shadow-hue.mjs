/* ══════════════════════════════════════════════════════════════════════════
   SWEEP THE BOARD SHADOW'S CHROMA SPAN AGAINST A REAL ABLATION CONTROL.

   The round-3 gap on `table-and-shadow` is a HUE gap with a DEPTH floor: in
   box (0,742,120,45) of the `mixed` frame the shadow must reach |R−B| ≤ 10 and
   chroma ≤ 12, while the shadow-on-vs-off luma delta in the same box stays
   ≥ 15. Those two pull against each other through grade(), so the span cannot
   be picked by eye off a hex — vista.js's own FELT note has the argument, and
   it ends "re-measure the box on a real boardshot".

   So this renders the same fixture once per arm:
     off    — boardShadow() ablated. THE CONTROL. Every delta below is against
              this arm and not against a remembered number.
     r2     — the shipped round-2 colour, restored by string surgery, so the
              sweep contains its own "before" instead of quoting the critic.
     s0…s36 — the round-3 colour at a range of SHADOW_SPAN.

   🔴 NOTHING ON DISK IS EDITED — the module is rewritten in the HTTP route,
   the same device _probe-mottle-ab.mjs uses and for the same reason: the repo
   must never hold a deliberately-broken file for precommit-scan to trip over.
   Every substitution is asserted present; an ablation that did not ablate
   reads as a null result, which is the wrong conclusion rather than no
   conclusion (.gauntlet/README.md item 6, TABLETOP-BAR §11).
   ══════════════════════════════════════════════════════════════════════════ */
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ROOT = fileURLToPath(new URL('../../public/', import.meta.url));
const VISTA = path.join(ROOT, 'src/battle/stage/vista.js');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.glb': 'model/gltf-binary', '.txt': 'text/plain', '.webp': 'image/webp',
  '.avif': 'image/avif', '.gif': 'image/gif', '.mp3': 'audio/mpeg', '.woff2': 'font/woff2' };

/* THE box the round-3 gap is argued on, and the table's own value immediately
   below it — the pair is the point: a shadow is only "not coloured" relative
   to the surface it lies on, so the control box is quoted with every arm. */
const BOX = [0, 742, 120, 45];
const REF = [0, 787, 120, 45];

const SRC = fs.readFileSync(VISTA, 'utf8');
const SPAN_LINE = '  const SHADOW_V = 44, SHADOW_SPAN = 66;';
const COL_LINE = '    const COL = shadowHex(api);';
const R2_COL = "    const COL = api.mixHex(api.mixHex(TABLE_DEEP, SHADE_HEX(api.LIGHT), 0.18), '#0b0906', 0.55);";
const NO_SHADOW = ['try { boardShadow(api, g, hz); } catch (e) { }', '/*ablated*/'];
/* ⚠ REPORT THE HEX THE ARM ACTUALLY PRODUCED, not the hex the sweep thinks it
   asked for. Round 3's first sweep showed two arms two luma apart landing on
   the same box mean, which is either the grade compressing the response or the
   substitution not taking — and those two have opposite conclusions. Applied
   to EVERY arm, so it also proves the r2 control is really the r2 colour. */
const ECHO = ['    const STEPS = 9;', '    const STEPS = 9; try { window.__shadowCol = COL; } catch (e) { }'];
/* ⚠ THE SPAN HAS A CEILING AND IT IS SET BY THE VALUE — see shadowHex(). A
   span of S about a midpoint puts blue at mid − S/2, and warmAxis() holds
   Rec.601 luma at V, which puts that midpoint at V − 0.0925·S, so blue reaches
   0 at S ≈ 1.69·V and anything past that clamps: the arm would be measuring a
   span it does
   not have. Arms are written as (V, S) pairs and the sweep asserts the ceiling
   rather than trusting whoever adds a row. */
const A_LINE = '    const A = 0.105 * api.clamp(0.42 + kI * 0.50, 0.34, 1.05);';
const arm = (V, S, A) => {
  if (S > 1.69 * V) throw new Error(`arm V=${V} S=${S} is over the channel ceiling ${(1.69 * V).toFixed(1)}`);
  const o = [ECHO, [SPAN_LINE, `  const SHADOW_V = ${V}, SHADOW_SPAN = ${S};`]];
  if (A) o.push([A_LINE, `    const A = ${A} * api.clamp(0.42 + kI * 0.50, 0.34, 1.05);`]);
  return o;
};

const ARMS = {
  off: [NO_SHADOW],
  r2: [ECHO, [COL_LINE, R2_COL]],
  /* the span sweep at round 2's own value — the row that shows the span alone
     cannot close the gap: a plain darken of FELT lands ON the round-2 number,
     because the teal is not in this fill at all, it is grade()'s. */
  v24s0: arm(24, 0), v24s36: arm(24, 36),
  /* …then the value axis. The cooling left over after the span is grade()'s
     split-tone, and the only thing that term reads is how DARK the pixel is —
     so the hue clause wants a LIGHTER shadow and the depth clause wants a
     darker one, along one axis, and the sweep exists to find the knee rather
     than to confirm a guess. */
  v42s66: arm(42, 66), v44s66: arm(44, 66),
  /* …and the third axis, coverage: a deeper per-step alpha puts more of THIS
     colour and less of the band into the composite, which darkens the box
     without darkening the colour. It buys back the day-vs-dusk length ratio,
     which is counted on a 2-luma threshold and therefore loses its diffuse
     dusk fringe first when the shadow is lightened. */
  v46s74a13: arm(46, 74, 0.13), v48s80a13: arm(48, 80, 0.13), v50s84a15: arm(50, 84, 0.15),
};

let ARM = 'off';
const srv = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p.endsWith('/')) p += 'index.html';
  const f = path.join(ROOT, p);
  if (!path.resolve(f).startsWith(path.resolve(ROOT))) { res.writeHead(403); return res.end(); }
  if (path.resolve(f) === path.resolve(VISTA)) {
    let s = SRC;
    for (const [a, b] of ARMS[ARM]) {
      if (!s.includes(a)) { res.writeHead(500); return res.end('ANCHOR MISS: ' + a); }
      s = s.replace(a, b);
    }
    res.writeHead(200, { 'content-type': 'text/javascript', 'cache-control': 'no-store' });
    return res.end(s);
  }
  fs.readFile(f, (e, b) => {
    if (e) { res.writeHead(404); return res.end('404 ' + p); }
    /* 🔴 AND THE IMPORT URL CARRIES THE ARM. cache-control: no-store on the
       module route was NOT enough on its own — round 3 measured two arms with
       different COL hexes returning a bit-identical box, which is a cache hit
       wearing the mask of a null result (.gauntlet/README.md item 6). The
       module's URL is a constant in the page, so the arm is appended to it
       here and every arm gets its own URL. The route keys on the PATH, so the
       query is inert on the server side. */
    if (path.resolve(f) === path.resolve(path.join(ROOT, 'battle-board/index.html'))) {
      const html = b.toString('utf8');
      const IMP = 'src="../src/battle/stage/vista.js"';
      if (!html.includes(IMP)) { res.writeHead(500); return res.end('ANCHOR MISS: ' + IMP); }
      res.writeHead(200, { 'content-type': 'text/html', 'cache-control': 'no-store' });
      return res.end(html.replace(IMP, 'src="../src/battle/stage/vista.js?arm=' + ARM + '"'));
    }
    res.writeHead(200, { 'content-type': MIME[path.extname(f).toLowerCase()] || 'application/octet-stream' });
    res.end(b);
  });
});
await new Promise(r => srv.listen(0, '127.0.0.1', r));
const PORT = srv.address().port;

/* the gauntlet fixture's OWN payload, evaluated out of shot.mjs rather than
   copied — a second copy of the scene tables is how two rounds end up A/B-ing
   different boards (see _probe-shadow-ab.mjs, same device). */
const shotSrc = fs.readFileSync(fileURLToPath(new URL('./shot.mjs', import.meta.url)), 'utf8');
const pure = shotSrc.slice(0, shotSrc.indexOf('const payload =')).replace(/^import.*$/gm, '');
const MAP = new Function('process', pure + ';return {cols:COLS,rows:ROWS,tiles};')(
  { argv: ['node', 'shot', 'ab.png', '--scene', 'mixed'] });

const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--disable-lcd-text'] });
const OUT = fileURLToPath(new URL('./_hue-', import.meta.url));
const raw = {};
for (const armName of Object.keys(ARMS)) {
  ARM = armName;
  /* a FRESH CONTEXT per arm: the arms share one URL for the module and differ
     only in what the route returns, so one shared HTTP cache is enough to hand
     an arm the previous arm's code and report it as a null result. */
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  await page.goto('http://127.0.0.1:' + PORT + '/battle-board/index.html?hue=' + armName, { waitUntil: 'load', timeout: 45000 });
  await page.waitForTimeout(7000);
  await page.evaluate(m => window.postMessage({ type: 'board:map', map: m }, location.origin), MAP);
  const meas = boxes => page.evaluate(bs => {
    const cv = document.querySelector('canvas');
    if (!cv) return { canvas: false };
    const g = cv.getContext('2d', { willReadFrequently: true });
    const mean = B => {
      const d = g.getImageData(B[0], B[1], B[2], B[3]).data;
      let R = 0, G = 0, Bl = 0, n = 0;
      for (let i = 0; i < d.length; i += 4) { R += d[i]; G += d[i + 1]; Bl += d[i + 2]; n++; }
      R /= n; G /= n; Bl /= n;
      return { R, G, B: Bl, L: 0.299 * R + 0.587 * G + 0.114 * Bl,
        rb: R - Bl, chroma: Math.max(R, G, Bl) - Math.min(R, G, Bl) };
    };
    return { canvas: cv.width + 'x' + cv.height, box: mean(bs[0]), ref: mean(bs[1]), col: window.__shadowCol || null };
  }, boxes);
  const byTime = {};
  for (const time of ['day', 'dusk']) {
    await page.evaluate(t => { try { setTimeOfDay(t); } catch (e) { } }, time);
    /* ⚠ A LONG SETTLE, AND IT IS NOT PADDING. The land bake carries the camera
       STALE by design (bakeKeys' shape has no CAMERA.yaw/pan — see
       boardShadow), so a frame read while the fit or the 2.5 s light lerp is
       still easing measures the shadow against a state the bake has not seen.
       Round 3 watched ONE arm's box move a full luma across identical loads at
       3 s, which at a clause floor of 15 is the difference between a pass and a
       fail; at 8 s the spread over four loads was 0.13. */
    await page.waitForTimeout(8000);
    byTime[time] = await meas([BOX, REF]);
    await page.screenshot({ path: OUT + armName + '-' + time + '.png' });
  }
  raw[armName] = Object.assign(byTime, errs.length ? { errs: errs.slice(0, 2) } : {});
  await page.close(); await ctx.close();
}
await browser.close(); srv.close();

/* ── the DAY-vs-DUSK LENGTH CUE, counted the way _probe-shadow-ab.mjs counts
   it: pixels the shadow darkens by more than 2 luma against the ABLATION arm
   at the same time of day. The clause is a RATIO (dusk moves ≥ 1.6× the
   pixels day does), so both arms of it have to be measured against a control
   rendered in the same light, and this is the cheapest place to get all of
   them — the ab probe renders one code version, this renders every arm. */
const lum = (d, i) => 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
async function movedPx(onF, offF) {
  const A = await sharp(onF).raw().toBuffer({ resolveWithObject: true });
  const B = await sharp(offF).raw().toBuffer({ resolveWithObject: true });
  const { width: W, height: H, channels: C } = A.info;
  let n = 0, sum = 0;
  for (let i = 0; i < W * H; i++) {
    const o = i * C, d = lum(B.data, o) - lum(A.data, o);
    if (d > 2) { n++; sum += d; }
  }
  return { movedPx: n, meanDarkening: +(sum / Math.max(1, n)).toFixed(2) };
}

const f2 = x => +x.toFixed(2);
const offDayL = raw.off && raw.off.day.box ? raw.off.day.box.L : null;
const out = {};
for (const [armName, r] of Object.entries(raw)) {
  if (!r.day || !r.day.box) { out[armName] = r; continue; }
  const b = r.day.box, ref = r.day.ref;
  const mvDay = armName === 'off' ? null : await movedPx(OUT + armName + '-day.png', OUT + 'off-day.png');
  const mvDusk = armName === 'off' ? null : await movedPx(OUT + armName + '-dusk.png', OUT + 'off-dusk.png');
  const delta = offDayL == null ? null : offDayL - b.L;
  const ratio = mvDay ? mvDusk.movedPx / Math.max(1, mvDay.movedPx) : null;
  out[armName] = {
    canvas: r.day.canvas, col: r.day.col,
    box_RmB: f2(b.rb), box_chroma: f2(b.chroma), box_L: f2(b.L),
    box_rgb: [f2(b.R), f2(b.G), f2(b.B)],
    table_RmB: f2(ref.rb), table_chroma: f2(ref.chroma), table_L: f2(ref.L),
    lumaDelta_vs_off: delta == null ? null : f2(delta),
    movedDay: mvDay && mvDay.movedPx, movedDusk: mvDusk && mvDusk.movedPx,
    duskOverDay: ratio == null ? null : f2(ratio),
    pass: armName === 'off' ? null
      : (Math.abs(b.rb) <= 10 && b.chroma <= 12 && delta >= 15 && ratio >= 1.6),
    errs: r.errs,
  };
}
console.log(JSON.stringify({ box: BOX, tableRef: REF, arms: out }, null, 1));
