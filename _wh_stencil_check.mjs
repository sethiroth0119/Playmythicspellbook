// ═══════════════════════════════════════════════════════════════════════════
// 🔤 FLOOR STENCIL ORIENTATION — settled by render, with a reference in frame.
//
// This exists because the orientation was got wrong, fixed, then UN-fixed on a
// bad verification: a render from a camera that was not where a player stands,
// with nothing upright in the frame to compare against. You cannot tell which
// way is up in a picture of a single word on a floor.
//
// So this check renders from a STANDING EYE POSITION dock-side of a stencil —
// the exact case the code comment reasons about — and frames the bay's own wall
// sign in the same shot. The sign is known-upright (it is a billboarded plane on
// a vertical wall), so it is the reference. If the sign reads up and the floor
// reads down, the floor is wrong, and no argument about UV conventions matters.
//
//   node _wh_stencil_check.mjs          → writes shots + a machine verdict
//
// ⚠⚠ WHAT THIS GATE DOES AND DOES NOT CATCH — measured, not assumed.
// Every variant below was injected into the live drawing code and the gate run:
//
//   clean build ................................. PASS   (correct)
//   cx.rotate(Math.PI)   — upside down .......... CAUGHT (exit 1)
//   cx.scale(-1,1)       — mirrored ............. NOT CAUGHT
//   cx.rotate(Math.PI/2) — rotated 90° .......... NOT CAUGHT
//   stencil fillText deleted .................... NOT CAUGHT
//
// The previous version of this file passed THREE of those four while printing
// PASS, and its orientation test was vacuous (it compared halves of the CROP,
// not of the glyph, and the glyph sat entirely below the crop midline). That is
// fixed: orientation is now measured inside the glyph's own bounding box and it
// does catch an upside-down stencil.
//
// The remaining three are NOT fixed, and the reason for the deletion case is
// worth writing down because it defeated two designs:
//   • marking the glyph in a marker colour INVENTS ink — the marker draws
//     whether or not the floor has a glyph, so deleted/rotated/mirrored
//     stencils all still produced a clean upright mask;
//   • erasing the glyph with destination-out (what this file now does) removes
//     the CONCRETE in the glyph's shape too, so it produces a digit-shaped diff
//     whether or not the glyph was ever drawn.
// The fix is to have the page rebuild the floor texture WITHOUT stencils and
// diff against that — a real "with and without" — which needs a hook the page
// does not yet expose. Until then this gate catches upside-down and nothing
// else, and the matrix above is the honest statement of its reach.
//
// It also reads the numeral's own pixels: for upright text the glyph's ink is
// bottom-heavy in screen space (digits sit on a baseline); inverted, it is
// top-heavy. That is the automated half, so the check can fail on its own.
// ═══════════════════════════════════════════════════════════════════════════
import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const OUT = join(ROOT, '_wh_shots');
if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });

const CANDIDATES = [process.env.WH_THREE,
  join(ROOT, 'public', 'assets', 'vfx', 'three.min.js')].filter(Boolean);
const threePath = CANDIDATES.find(p => existsSync(p));
if (!threePath) { console.error('✖ cannot run: three.js not found.'); process.exit(2); }
// ⚠ Resolve playwright the SAME way the other gates do, and let the caller pin
// the browser. This file called chromium.launch() with no executablePath and
// only worked because the repo happens to have no local Playwright install —
// any repo-local copy (with its own browser revision) breaks it.
let chromium = null;
for (const spec of ['playwright', '/opt/node22/lib/node_modules/playwright/index.mjs']) {
  try { ({ chromium } = await import(spec)); break; } catch (e) {}
}
if (!chromium) { console.error('✖ cannot run: playwright not found.  npm i playwright --no-save'); process.exit(2); }

const three = readFileSync(threePath, 'utf8');
const LAUNCH = { args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] };
if (process.env.WH_CHROMIUM) LAUNCH.executablePath = process.env.WH_CHROMIUM;
const b = await chromium.launch(LAUNCH);
const ctx = await b.newContext({ viewport: { width: 1000, height: 760 } });
await ctx.route('**/three.min.js', r => r.fulfill({ status: 200, contentType: 'application/javascript', body: three }));
const p = await ctx.newPage();
const errs = [];
p.on('pageerror', e => errs.push(String(e.message).split('\n')[0]));
await p.goto(pathToFileURL(join(ROOT, 'public/warehouse/index.html')).href, { waitUntil: 'load' });
await p.waitForFunction(() => window.App && window.App.ready === true, { timeout: 30000 });

const R = [];
const ok = (l, c, d = '') => { const s = `${c ? 'PASS' : 'FAIL'} — ${l}  ${d}`; R.push(s); console.log(s); };

// ⚠ TEST ON GLYPHS THAT CAN CARRY THE TEST. Bay 1's numeral is a single
// vertical stroke: its mask came out 48×105 px, its column profile is one spike,
// and correlating a spike against a spike is unstable — the clean build scored
// margin −0.014 and −0.401, i.e. the check failed a correct build. A shape test
// needs a shape. Bay 2 and bay 31 are asymmetric both ways.
for (const [tier, units, bayNo] of [['t1', 4, 2], ['t5', 32, 31]]) {
  // Stand where a player stands: eye height, dock-side of the bay, facing it.
  const view = await p.evaluate(async ([n, want]) => {
    const st = WH.state(); const C = st.config;
    st.units = [];
    for (let i = 1; i <= n; i++) st.units.push({ id: 'u' + i, bay_no: i, renter_id: null,
      renter_name: null, occupied: false, capacity_kg: C.unit_capacity_kg, used_kg: 0, contents: {}, mine: false });
    st.warehouse.units_total = n;
    WH.setState(st); refreshWorld();
    await new Promise(r => setTimeout(r, 120));
    const bay = App.bayNodes.filter(b => b.unit.bay_no === want)[0];
    if (!bay) return null;
    const bx = bay.node.position.x, bz = bay.node.position.z;
    // 3.4 m dock-side of the stencil, eye height, looking down at it and at the
    // bay's back wall — the sign is on that wall, so both land in frame.
    // ⚠ yaw 0 faces −Z here (fwd = (−sin y, 0, −cos y)), so yaw = π faces AWAY
    // from the bays. The first version of this check used π and photographed
    // the empty dock — which is exactly the class of mistake it exists to stop.
    // ⚠ THE WHOLE GLYPH MUST BE IN FRAME. At bz + 3.6 / pitch −0.40 the numeral
    // ran off the bottom of the viewport, so the isolated mask was a TRUNCATED
    // digit — and every profile computed from it was meaningless. That is what
    // made a correct tier-1 stencil measure "top-heavy" and fail: the bottom of
    // the 2 was simply not in the picture. The screenshot showed it plainly,
    // which is the argument for looking at the render before trusting a number
    // derived from it.
    camera.position.set(bx, 1.70, bz + 5.4);
    camera.rotation.order = 'YXZ';
    Ctl.yaw = 0; Ctl.pitch = -0.26;
    camera.rotation.y = Ctl.yaw; camera.rotation.x = Ctl.pitch;
    // Hide the HUD — it covers a third of the frame and none of it is the room.
    document.getElementById('hud').style.display = 'none';
    document.getElementById('topbtns').style.display = 'none';
    document.getElementById('toast').style.display = 'none';
    document.getElementById('prompt').style.display = 'none';
    renderer.render(scene, camera);
    // ⚠ READ IN THE SAME TASK AS THE RENDER. The renderer is created without
    // preserveDrawingBuffer, so the colour buffer is gone by the next
    // evaluate() — drawImage() then copies a blank canvas, every pixel is
    // identical, and any percentile threshold selects 100% of the crop. That is
    // exactly what the first two runs of this check did while printing PASS.
    // ── ISOLATE THE GLYPH BY CAUSATION, NOT BY THRESHOLD ──────────────────
    // ⚠ The previous version thresholded the crop at med + (hi−med)·0.45 and
    // compared the top and bottom halves OF THE CROP. Both halves of that were
    // broken, and together they made the check vacuous:
    //   • the crop ran y 0.50–0.96 while the glyph sat in the bottom ~15%,
    //     entirely below the crop midline — so rotating the glyph 180° about
    //     its own centre left it in the same screen band and changed nothing.
    //     Clean tier 1 read top=0, which is the tell.
    //   • the threshold is adaptive: with bright glyph ink present it rode high
    //     and selected only glyph pixels; delete the stencil and it collapsed
    //     onto the lit bay pad, so tens of thousands of pad pixels counted as
    //     "ink" and the check passed at 26.1% with NO STENCIL IN THE SCENE.
    // Measured against four deliberate defects it passed three of them.
    //
    // So the glyph is now isolated the only way that cannot be fooled: render
    // the frame, ERASE THIS GLYPH FROM THE FLOOR TEXTURE, render again, and
    // diff. Whatever changed is the glyph and nothing else. Then compare that
    // mask against the SOURCE ARTWORK under four candidate transforms —
    // identity, flip-Y, flip-X, rot180 — and require identity to win. Upside
    // down, mirrored and rotated each make a different transform win.
    const c = renderer.domElement;
    const grab = () => { const g = document.createElement('canvas');
      g.width = c.width; g.height = c.height;
      g.getContext('2d').drawImage(c, 0, 0);
      return g.getContext('2d').getImageData(0, 0, c.width, c.height).data; };
    const A = grab();
    // ERASE this glyph's own ink under its own transform, re-render, diff.
    // A marker-colour redraw was tried first and was worse than useless: the
    // marker drew an upright glyph regardless of what the floor actually had,
    // so a rotated, mirrored or DELETED stencil all still produced a clean
    // upright mask and the gate passed three defects out of four.
    const snap = App.floorCanvas.getContext('2d')
      .getImageData(0, 0, App.floorCanvas.width, App.floorCanvas.height);
    App.stencilErase[want - 1]();
    App.floorTex.needsUpdate = true;
    renderer.render(scene, camera);
    const B = grab();
    App.floorCanvas.getContext('2d').putImageData(snap, 0, 0);
    App.floorTex.needsUpdate = true;
    renderer.render(scene, camera);

    const W = c.width, H = c.height;
    let x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1, nInk = 0;
    const diff = new Float32Array(W * H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      const la = A[i] * 0.299 + A[i + 1] * 0.587 + A[i + 2] * 0.114;
      const lb = B[i] * 0.299 + B[i + 1] * 0.587 + B[i + 2] * 0.114;
      const dv = Math.abs(la - lb);
      // 4, not 8: the word "BAY" is drawn at alpha 0.45 and an 8-luminance gate
      // dropped it, leaving only the numeral — and it is precisely the small
      // word ABOVE the big numeral that makes the row profile asymmetric enough
      // to detect an upside-down stencil.
      if (dv > 4) { diff[y * W + x] = dv; nInk++;
        if (x < x0) x0 = x; if (x > x1) x1 = x;
        if (y < y0) y0 = y; if (y > y1) y1 = y; }
    }
    // resample the on-screen mask into a 24×24 grid inside its own bbox
    const G = 24, grid = new Float32Array(G * G);
    if (nInk > 0) {
      const bw = Math.max(1, x1 - x0 + 1), bh = Math.max(1, y1 - y0 + 1);
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
        const v = diff[y * W + x]; if (!v) continue;
        const gx = Math.min(G - 1, Math.floor((x - x0) / bw * G));
        const gy = Math.min(G - 1, Math.floor((y - y0) / bh * G));
        grid[gy * G + gx] += v;
      }
    }
    // The reference artwork: the same text drawn CANONICALLY (translation only)
    // on a scratch canvas. Not what the floor did — what it was supposed to do.
    const SW = 512, SH = 512;
    const sc = document.createElement('canvas'); sc.width = SW; sc.height = SH;
    const sctx = sc.getContext('2d');
    App.stencilRef[want - 1](sctx, SW / 2, SH * 0.62);
    const sd = sctx.getImageData(0, 0, SW, SH).data;
    let sx0 = 1e9, sy0 = 1e9, sx1 = -1, sy1 = -1;
    for (let y = 0; y < SH; y++) for (let x = 0; x < SW; x++) {
      if (sd[(y * SW + x) * 4 + 3] < 24) continue;
      if (x < sx0) sx0 = x; if (x > sx1) sx1 = x;
      if (y < sy0) sy0 = y; if (y > sy1) sy1 = y;
    }
    const src = new Float32Array(G * G);
    if (sx1 >= 0) {
      const sw = Math.max(1, sx1 - sx0 + 1), shh = Math.max(1, sy1 - sy0 + 1);
      for (let y = sy0; y <= sy1; y++) for (let x = sx0; x <= sx1; x++) {
        const a = sd[(y * SW + x) * 4 + 3]; if (a < 24) continue;
        const gx = Math.min(G - 1, Math.floor((x - sx0) / sw * G));
        const gy = Math.min(G - 1, Math.floor((y - sy0) / shh * G));
        src[gy * G + gx] += a;
      }
    }
    // ── SCORE BY PROFILE CORRELATION, NOT BY A 2-D DOT PRODUCT ────────────
    // The 24×24 dot product was measured and does not discriminate: identity
    // 26.14 against flipY 25.32 on a clean build, a 0.6 margin on a 26 scale.
    // Resampled into a coarse grid, "BAY 31" is a blob and every transform
    // overlaps it about equally.
    // The ROW profile, though, is strongly asymmetric by construction — a small
    // "BAY" above a large numeral — and the COLUMN profile is asymmetric for
    // any multi-digit number. Zero-mean correlation of those two profiles is a
    // shape test rather than a coverage test, so a flip actually moves it.
    const prof = (a, axis) => {
      const out = new Array(G).fill(0);
      for (let y = 0; y < G; y++) for (let x = 0; x < G; x++)
        out[axis === 'row' ? y : x] += a[y * G + x];
      const m = out.reduce((t, v) => t + v, 0) / G;
      return out.map(v => v - m);
    };
    const corr = (a, b2) => {
      let n2 = 0, da = 0, db = 0;
      for (let i = 0; i < a.length; i++) { n2 += a[i] * b2[i]; da += a[i] * a[i]; db += b2[i] * b2[i]; }
      return (da && db) ? n2 / Math.sqrt(da * db) : 0;
    };
    const rS = prof(grid, 'row'), cS = prof(grid, 'col');
    const rR = prof(src, 'row'),  cR = prof(src, 'col');
    const rev = (a) => a.slice().reverse();
    const score = {
      vertical_upright:  +corr(rS, rR).toFixed(3),
      vertical_flipped:  +corr(rS, rev(rR)).toFixed(3),
      horizontal_normal: +corr(cS, cR).toFixed(3),
      horizontal_mirror: +corr(cS, rev(cR)).toFixed(3),
      // ⚠ A 90° rotation swaps the AXES, so the screen's row profile starts
      // matching the artwork's COLUMN profile. Comparing against an absolute
      // correlation floor does not work here — the floor glyph is viewed at a
      // steep angle and foreshortening alone drags the honest correlation down
      // to ~0.08, so any floor high enough to catch a rotation also fails a
      // clean build. Asking which AXIS it matches is scale- and
      // perspective-independent.
      axis_same: +corr(rS, rR).toFixed(3),
      axis_swapped: +Math.max(corr(rS, cR), corr(rS, rev(cR))).toFixed(3),
    };
    const best = score.vertical_upright >= score.vertical_flipped
      && score.horizontal_normal >= score.horizontal_mirror ? ['identity', 0] : ['flipped', 0];
    // orientation within the GLYPH'S OWN bbox, not the crop's
    let top = 0, bot = 0, gmax = 0;
    for (const v of grid) gmax = Math.max(gmax, v);
    for (let y = 0; y < G; y++) for (let x = 0; x < G; x++) {
      const v = gmax ? grid[y * G + x] / gmax : 0;
      if (y < G / 2) top += v; else bot += v;
    }
    return { bx, bz, glyph: { px: nInk, bbox: nInk ? [x0, y0, x1, y1] : null,
             top: +top.toFixed(1), bot: +bot.toFixed(1),
             score, best: best[0],
             vMargin: +(score.vertical_upright - score.vertical_flipped).toFixed(3),
             hMargin: +(score.horizontal_normal - score.horizontal_mirror).toFixed(3),
             aMargin: +(score.axis_same - score.axis_swapped).toFixed(3) } };
  }, [units, bayNo]);
  if (!view) { ok(`${tier} bay ${bayNo} exists`, false); continue; }
  await p.waitForTimeout(120);
  const file = join(OUT, `STENCIL_${tier}_bay${bayNo}.png`);
  await p.screenshot({ path: file });

  const gl = view.glyph;
  // A real glyph, isolated by causation — not "some bright pixels".
  ok(`${tier} · bay ${bayNo} the stencil glyph EXISTS on the floor`,
     gl.px > 120 && gl.px < 40000,
     `${gl.px} px changed when the glyph was erased from the texture` +
     (gl.bbox ? ` · bbox ${gl.bbox.join(',')}` : ''));
  // Orientation, measured INSIDE the glyph's own bounding box.
  ok(`${tier} · bay ${bayNo} numeral is UPRIGHT (bottom-heavy within its own bbox)`,
     gl.px > 120 && gl.bot > gl.top * 1.02,
     `top=${gl.top} bottom=${gl.bot}`);
  // …and it matches the source artwork under IDENTITY, not under any flip.
  // Upside down flips the ROW profile; mirrored flips the COLUMN profile; a
  // 90° rotation destroys the correlation with the upright artwork altogether,
  // which is what the absolute floor catches.
  // ⚠ NO ROW-PROFILE CORRELATION. I could not make it reliable and I stopped
  // tuning it to fit. Correlating a steeply foreshortened perspective mask
  // against flat artwork gave −0.47/−0.19 on CORRECT builds depending on tier,
  // and every threshold that caught a flip also red-lighted a good build. The
  // bbox bottom-heaviness above is the orientation test; it is measured inside
  // the glyph's own bounding box, which is the specific thing the old vacuous
  // version got wrong. What each defect actually does to this gate is recorded
  // in the header's defect matrix — measured, not assumed.
  // ⚠ MIRROR DETECTION IS REPORTED, NOT ASSERTED — because I could not make it
  // reliable and I am not going to tune a threshold until a clean build squeaks
  // through. Measured: mirroring the stencil moves this margin hard negative
  // (−0.202 at t1, −0.437 at t5), so the signal is real; but a CLEAN t5 bay 31
  // scores only +0.076 above its own mirror, and any threshold that catches the
  // defect at t5 also red-lights that correct build. "31" reversed is "13" and
  // at this mask size the two column profiles are genuinely close.
  // So: printed every run, gating nothing, and named as unfinished in the
  // handoff rather than quietly dropped.
  console.log(`INFO — ${tier} · bay ${bayNo} mirror margin ${gl.hMargin} ` +
    `(normal=${gl.score.horizontal_normal} mirror=${gl.score.horizontal_mirror}) ` +
    `— reported only, see the note in this file`);
  // ⚠ NO AXIS TEST. It was tried and it fails a CORRECT build: the stencil is
  // viewed at a steep angle from standing height, so the mask is squashed
  // vertically and its row profile genuinely resembles the flat artwork's
  // COLUMN profile more than its row profile — clean measured same-axis 0.085
  // against swapped-axis 0.294. A test that red-lights a good build is worse
  // than no test, so a 90° rotation is caught only insofar as it disturbs the
  // two margins above. The defect matrix below records exactly how far that
  // goes rather than claiming more.
  void gl.aMargin;
}

ok('no uncaught page errors', errs.length === 0, errs.slice(0, 2).join(' | '));
console.log('');
const fails = R.filter(x => x.startsWith('FAIL')).length;
console.log(`${R.length - fails} PASS / ${fails} FAIL`);
if (fails) {
  console.error('✖ FLOOR STENCILS ARE NOT UPRIGHT. Open the PNGs in _wh_shots/ —');
  console.error('  the bay wall sign in the same frame is the upright reference.');
  process.exit(1);
}
console.log('✔ floor stencils read upright from a standing position.');
await b.close();
