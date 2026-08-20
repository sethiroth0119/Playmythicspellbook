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
// ⚠⚠ WHAT THIS GATE CATCHES — measured, not assumed. Every variant below was
// injected into the live drawing code in public/warehouse/index.html and the
// gate re-run, and BOTH tiers had to fail before a row is called CAUGHT:
//
//   clean build ....... PASS  identity 0.953 (t1) / 0.984 (t5), exit 0
//   cx.rotate(Math.PI)  CAUGHT  rot180 wins, 0.959 / 0.958
//   cx.scale(-1,1)      CAUGHT  flipX  wins, 0.959 / 0.961
//   cx.rotate(Math.PI/2) CAUGHT rot90cw wins, 0.960 / 0.957, and the aspect
//                               test trips too (131% / 52% off)
//   fillText deleted    CAUGHT  0 px of ink in the texture AND 0 px in the
//                               render — the case every earlier design passed
//
// It used to catch ONE of those four while printing PASS, and the reason is
// worth keeping because it defeated two designs:
//   • marking the glyph in a marker colour INVENTS ink — the marker draws
//     whether or not the floor has a glyph, so deleted/rotated/mirrored
//     stencils all still produced a clean upright mask;
//   • erasing the glyph with destination-out removes the CONCRETE in the
//     glyph's shape too, so it produced a digit-shaped diff whether or not the
//     glyph was ever drawn — a deleted stencil looked identical to a good one.
// Both are threshold-free but neither is causal. The page now exposes the hook
// that makes a causal test possible: App.noStencils = <bay number> repaints the
// floor with THAT ONE NUMERAL SUPPRESSED and nothing else changed (the speckle
// is seeded, so the two paints are otherwise pixel-identical — this file
// asserts that). Diff the two and what is left IS the glyph, at full texture
// resolution, and it is empty when the glyph does not exist.
//
// That gives two independent measurements, and both are asserted:
//   TEXTURE SPACE — the isolated ink versus the source artwork drawn
//     canonically, matched under identity / flipY / flipX / rot180 / the two
//     90° transposes. No perspective is involved, so identity wins outright on
//     a clean build and loses outright on any of the three transforms.
//   SCREEN SPACE — the same with/without diff on the RENDER, from standing eye
//     height. This is what keeps the texture test honest about the chain that
//     the code comment argues over: canvas row → v → plane +Y → world −Z. A
//     canvas-space match cannot see a flip introduced downstream by the UVs or
//     by the plane's rotation; the on-screen bottom-heaviness test can.
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
    // ── ISOLATE THE GLYPH BY CAUSATION ────────────────────────────────────
    // Paint the floor twice — once normally, once with THIS numeral suppressed
    // — and diff. Nothing else on the slab differs between the two paints (the
    // speckle is seeded; this function asserts it below), so the difference is
    // the numeral and only the numeral, and it is EMPTY if the numeral was
    // never drawn. That last property is the one every earlier design lacked.
    const c = renderer.domElement;
    // ⚠ READ IN THE SAME TASK AS THE RENDER. The renderer is created without
    // preserveDrawingBuffer, so the colour buffer is gone by the next
    // evaluate() — drawImage() then copies a blank canvas, every pixel is
    // identical, and any percentile threshold selects 100% of the crop. That is
    // exactly what the first two runs of this check did while printing PASS.
    const grab = () => { const g = document.createElement('canvas');
      g.width = c.width; g.height = c.height;
      g.getContext('2d').drawImage(c, 0, 0);
      return g.getContext('2d').getImageData(0, 0, c.width, c.height).data; };
    const paint = () => { const fc = App.floorCanvas;
      return { w: fc.width, h: fc.height,
               d: fc.getContext('2d').getImageData(0, 0, fc.width, fc.height).data }; };

    renderer.render(scene, camera);
    const A = grab(), TA = paint();
    const at = App.stencilAt[want - 1];
    App.noStencils = want; App.buildShed(n);
    renderer.render(scene, camera);
    const B = grab(), TB = paint();
    App.noStencils = false; App.buildShed(n);
    renderer.render(scene, camera);

    // ── TEXTURE SPACE ─────────────────────────────────────────────────────
    if (TA.w !== TB.w || TA.h !== TB.h) return { fatal: 'floor canvas changed size between paints' };
    const half = Math.round(0.95 * at.em);           // one em box around the glyph
    const cx0 = Math.max(0, Math.round(at.x) - half), cx1 = Math.min(TA.w - 1, Math.round(at.x) + half);
    const cy0 = Math.max(0, Math.round(at.y) - half), cy1 = Math.min(TA.h - 1, Math.round(at.y) + half);
    let tx0 = 1e9, ty0 = 1e9, tx1 = -1, ty1 = -1, tInk = 0, strayPx = 0;
    const tdiff = new Float32Array(TA.w * TA.h);
    for (let y = 0; y < TA.h; y++) for (let x = 0; x < TA.w; x++) {
      const i = (y * TA.w + x) * 4;
      const dv = Math.abs(TA.d[i] - TB.d[i]) + Math.abs(TA.d[i + 1] - TB.d[i + 1]) + Math.abs(TA.d[i + 2] - TB.d[i + 2]);
      if (dv <= 6) continue;
      // Anything outside the one glyph's own box is a paint that did not
      // reproduce — a re-rolled speckle, a stray suppression. The whole method
      // rests on the two paints being identical apart from this numeral, so it
      // is asserted rather than assumed.
      if (x < cx0 || x > cx1 || y < cy0 || y > cy1) { strayPx++; continue; }
      tdiff[y * TA.w + x] = dv; tInk++;
      if (x < tx0) tx0 = x; if (x > tx1) tx1 = x;
      if (y < ty0) ty0 = y; if (y > ty1) ty1 = y;
    }
    // ⚠ RESAMPLE BY AREA, NOT BY ACCUMULATION. Dropping each source pixel into
    // the grid cell it lands in is fine when the source is bigger than the grid
    // and useless when it is smaller: the tier-1 numeral is 20×19 px, so 64% of
    // a 32×32 grid stayed EMPTY while the 512-px reference filled every cell,
    // and correlating a sieve against a solid read 0.131 on a mask that is
    // visibly a perfect "2". Same normalisation on both sides or the comparison
    // means nothing — so both are bilinear-sampled with 4×4 supersampling,
    // which up-samples the small mask and down-samples the big reference into
    // the same representation.
    const G = 32, SS = 4;
    const grid = (get, x0, y0, x1, y1) => {
      const g = new Float32Array(G * G);
      if (x1 < x0 || y1 < y0) return g;
      const w = Math.max(1, x1 - x0 + 1), h = Math.max(1, y1 - y0 + 1);
      const bil = (fx, fy) => {
        const px = Math.min(x1, Math.max(x0, x0 + fx)), py = Math.min(y1, Math.max(y0, y0 + fy));
        const ix = Math.floor(px), iy = Math.floor(py), tx2 = px - ix, ty2 = py - iy;
        const jx = Math.min(x1, ix + 1), jy = Math.min(y1, iy + 1);
        return get(ix, iy) * (1 - tx2) * (1 - ty2) + get(jx, iy) * tx2 * (1 - ty2)
             + get(ix, jy) * (1 - tx2) * ty2 + get(jx, jy) * tx2 * ty2;
      };
      for (let gy = 0; gy < G; gy++) for (let gx = 0; gx < G; gx++) {
        let acc = 0;
        for (let sy2 = 0; sy2 < SS; sy2++) for (let sx2 = 0; sx2 < SS; sx2++)
          acc += bil((gx + (sx2 + 0.5) / SS) / G * w - 0.5, (gy + (sy2 + 0.5) / SS) / G * h - 0.5);
        g[gy * G + gx] = acc / (SS * SS);
      }
      return g;
    };
    const mask = grid((x, y) => tdiff[y * TA.w + x], tx0, ty0, tx1, ty1);

    // The reference artwork: the same numeral drawn CANONICALLY (translation
    // only) on a scratch canvas. Not what the floor did — what it was meant to.
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
    const ref = grid((x, y) => { const a = sd[(y * SW + x) * 4 + 3]; return a < 24 ? 0 : a; }, sx0, sy0, sx1, sy1);

    const corr = (a, b2) => {
      let ma = 0, mb = 0;
      for (let i = 0; i < a.length; i++) { ma += a[i]; mb += b2[i]; }
      ma /= a.length; mb /= b2.length;
      let n2 = 0, da = 0, db = 0;
      for (let i = 0; i < a.length; i++) {
        const u = a[i] - ma, v = b2[i] - mb;
        n2 += u * v; da += u * u; db += v * v;
      }
      return (da && db) ? n2 / Math.sqrt(da * db) : 0;
    };
    // The five ways the drawing can be wrong, as re-indexings of the artwork.
    const XF = {
      identity: (x, y) => ref[y * G + x],
      flipY:    (x, y) => ref[(G - 1 - y) * G + x],
      flipX:    (x, y) => ref[y * G + (G - 1 - x)],
      rot180:   (x, y) => ref[(G - 1 - y) * G + (G - 1 - x)],
      rot90cw:  (x, y) => ref[(G - 1 - x) * G + y],
      rot90ccw: (x, y) => ref[x * G + (G - 1 - y)],
    };
    const tScore = {};
    for (const k of Object.keys(XF)) {
      const v = new Float32Array(G * G);
      for (let y = 0; y < G; y++) for (let x = 0; x < G; x++) v[y * G + x] = XF[k](x, y);
      tScore[k] = +corr(mask, v).toFixed(3);
    }
    let tBest = 'identity';
    for (const k of Object.keys(tScore)) if (tScore[k] > tScore[tBest]) tBest = k;
    let tRunner = -2;
    for (const k of Object.keys(tScore)) if (k !== 'identity' && tScore[k] > tRunner) tRunner = tScore[k];
    // Aspect is the one cue a 32×32 normalised grid throws away, and it is
    // exactly what a 90° rotation changes. Kept as a separate reported number.
    const mAsp = (tx1 >= tx0) ? (tx1 - tx0 + 1) / Math.max(1, ty1 - ty0 + 1) : 0;
    const rAsp = (sx1 >= sx0) ? (sx1 - sx0 + 1) / Math.max(1, sy1 - sy0 + 1) : 0;

    // ── SCREEN SPACE ──────────────────────────────────────────────────────
    // Same with/without diff, on the render. One numeral is suppressed, so the
    // mask is that numeral even with neighbouring bays in frame.
    const W = c.width, H = c.height;
    let x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1, nInk = 0;
    const diff = new Float32Array(W * H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      const la = A[i] * 0.299 + A[i + 1] * 0.587 + A[i + 2] * 0.114;
      const lb = B[i] * 0.299 + B[i + 1] * 0.587 + B[i + 2] * 0.114;
      const dv = Math.abs(la - lb);
      if (dv > 4) { diff[y * W + x] = dv; nInk++;
        if (x < x0) x0 = x; if (x > x1) x1 = x;
        if (y < y0) y0 = y; if (y > y1) y1 = y; }
    }
    const sgrid = grid((x, y) => diff[y * W + x], x0, y0, x1, y1);
    // orientation within the GLYPH'S OWN bbox, not the crop's
    let top = 0, bot = 0, gmax = 0;
    for (const v of sgrid) gmax = Math.max(gmax, v);
    for (let y = 0; y < G; y++) for (let x = 0; x < G; x++) {
      const v = gmax ? sgrid[y * G + x] / gmax : 0;
      if (y < G / 2) top += v; else bot += v;
    }
    return { bx, bz,
      tex: { px: tInk, stray: strayPx, bbox: tInk ? [tx0, ty0, tx1, ty1] : null,
             score: tScore, best: tBest,
             margin: +(tScore.identity - tRunner).toFixed(3),
             aspect: +mAsp.toFixed(3), refAspect: +rAsp.toFixed(3),
             aspectErr: rAsp ? +Math.abs(mAsp / rAsp - 1).toFixed(3) : 9 },
      glyph: { px: nInk, bbox: nInk ? [x0, y0, x1, y1] : null,
               top: +top.toFixed(1), bot: +bot.toFixed(1) } };
  }, [units, bayNo]);
  if (!view) { ok(`${tier} bay ${bayNo} exists`, false); continue; }
  if (view.fatal) { ok(`${tier} bay ${bayNo} isolation is sound`, false, view.fatal); continue; }
  await p.waitForTimeout(120);
  const file = join(OUT, `STENCIL_${tier}_bay${bayNo}.png`);
  await p.screenshot({ path: file });

  const tx = view.tex, gl = view.glyph;
  // ── the method's own precondition ──────────────────────────────────────
  ok(`${tier} · bay ${bayNo} the two floor paints differ ONLY at this numeral`,
     tx.stray === 0, `${tx.stray} px changed elsewhere on the slab`);
  // ── existence, by causation. A deleted stencil lands here. ─────────────
  // ⚠ 60, not 400. Measured: the tier-1 "2" is 146 px of ink at 34 px/m and
  // the tier-5 "31" is 262. A deleted numeral is exactly 0 — and the stray
  // assertion above proves nothing else on the slab moves — so the gap the
  // threshold has to straddle is 0-vs-146, not 146-vs-400.
  ok(`${tier} · bay ${bayNo} the numeral EXISTS in the floor texture`,
     tx.px > 60, `${tx.px} px of ink appear when the numeral is un-suppressed`);
  ok(`${tier} · bay ${bayNo} the numeral EXISTS on screen`,
     gl.px > 120 && gl.px < 40000,
     `${gl.px} px changed in the render` + (gl.bbox ? ` · bbox ${gl.bbox.join(',')}` : ''));
  // ── shape, in texture space where there is no perspective to argue with ─
  // Upside down makes rot180 win, mirrored makes flipX win, 90° makes a
  // transpose win. Identity has to win outright, and by a margin — a tie means
  // the glyph is too symmetric for the test to have said anything.
  // ⚠ 0.10, and the headroom is thin ON PURPOSE at the top end, not the bottom.
  // Clean margins measured 0.664 (t1 "2") and 0.193 (t5 "31" — "31" mirrored
  // still reads a lot like "31", and flipY scores 0.791 against identity's
  // 0.984). A threshold that a correct build clears by 0.04 is uncomfortable,
  // so the margin is NOT what catches the defects: each of them makes a
  // different transform WIN, which is the `best === 'identity'` half. The
  // margin is only here to red-light a glyph so symmetric that the winner is
  // arbitrary, and it is set low enough not to fail a good build.
  ok(`${tier} · bay ${bayNo} the ink matches the artwork under IDENTITY`,
     tx.best === 'identity' && tx.margin > 0.10,
     `best=${tx.best} margin=${tx.margin} · ` +
     Object.entries(tx.score).map(([k, v]) => `${k}=${v}`).join(' '));
  // ── aspect, which the normalised grid cannot see ───────────────────────
  ok(`${tier} · bay ${bayNo} the ink has the artwork's proportions`,
     tx.aspectErr < 0.20, `w/h ${tx.aspect} vs artwork ${tx.refAspect} (${(tx.aspectErr * 100).toFixed(0)}% off)`);
  // ── and the texture→screen chain, which texture space cannot see ───────
  // This is the half that guards the canvas row → v → +Y → −Z argument in the
  // page's comment: a flip introduced by the UVs or by the plane's rotation
  // leaves the texture perfect and the render upside down.
  ok(`${tier} · bay ${bayNo} numeral RENDERS upright (bottom-heavy in its own bbox)`,
     gl.px > 120 && gl.bot > gl.top * 1.02, `top=${gl.top} bottom=${gl.bot}`);
}

ok('no uncaught page errors', errs.length === 0, errs.slice(0, 2).join(' | '));
console.log('');
const fails = R.filter(x => x.startsWith('FAIL')).length;
console.log(`${R.length - fails} PASS / ${fails} FAIL`);
if (fails) {
  console.error('✖ FLOOR STENCILS ARE NOT RIGHT. Open the PNGs in _wh_shots/ —');
  console.error('  the bay wall sign in the same frame is the upright reference.');
  process.exit(1);
}
console.log('✔ floor stencils read upright from a standing position.');
await b.close();
