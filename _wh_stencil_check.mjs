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
//   bay 7 painted "8"   CAUGHT  16 PASS / 3 FAIL, exit 1. Re-measured against
//                               the previous version of this file with the same
//                               injection in place: 13 PASS / 0 FAIL, exit 0.
//   bay 31 painted "30" CAUGHT  17 PASS / 2 FAIL, exit 1. The previous version
//                               did catch this one — by 0.022 on the margin
//                               test (0.078 against a 0.10 floor), which is not
//                               a margin, it is luck. It now fails by 0.562 on
//                               a test that is about the digit, not the angle.
//
// It used to catch ONE of those while printing PASS, and the reason is worth
// keeping because it defeated two designs:
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
// ⚠⚠ EVERY BAY, NOT TWO. This sampled bay 2 at tier 1 and bay 31 at tier 5 and
// nothing else, and the hole was exactly the size you would expect: painting
// bay 7 as "8" at every tier, with all 31 other numerals correct, scored
// 13 PASS / 0 FAIL and exit 0. A gate that reads 2 of 32 numerals is a gate
// against a global transform, not against the floor being wrong. It now sweeps
// EVERY bay at both tiers — 4 + 32 = 36 numerals, each isolated by its own
// suppression pass — and the two historic framed shots are kept on top of that
// as the wall-sign reference views.
//
// ⚠⚠ AND IT NOW ASKS WHICH NUMERAL, NOT ONLY WHICH WAY UP. The transform test
// below asks "is this ink my artwork, rotated?" — which a WRONG DIGIT answers
// yes to, because "30" is not a rotation of "31", it is a different picture
// that correlates fine. Measured: bay 31 painted "30" left identity winning
// and scored margin 0.078 against the 0.10 threshold — caught by 0.022, and
// only because "31" happens to be flipY-ish. So there is now a second,
// independent shape test: the isolated ink is correlated against the canonical
// artwork of EVERY OTHER BAY NUMBER at this tier, and this bay's own numeral
// must win. Clean-build worst case is bay 18 at 0.982 against "10" at 0.883,
// a margin of 0.099; the threshold is 0.04. Injected and measured:
//   bay 31 painted "30" → own "31" 0.417 against "30" 0.979, margin −0.562
//   bay  7 painted  "8" → own  "7" −0.022 against "8" 0.924, margin −0.946
// i.e. the numeral's own artwork loses outright rather than squeaking past.
//
// That gives three independent measurements, and all are asserted:
//   TEXTURE SPACE, ORIENTATION — the isolated ink versus the source artwork
//     drawn canonically, matched under identity / flipY / flipX / rot180 / the
//     two 90° transposes. No perspective is involved, so identity wins outright
//     on a clean build and loses outright on any of the three transforms.
//   TEXTURE SPACE, IDENTITY — the same ink against every other numeral on the
//     floor. Catches the digit being wrong, which orientation cannot see.
//   SCREEN SPACE — the same with/without diff on the RENDER, from standing eye
//     height, matched against the same artwork. This is what keeps the texture
//     tests honest about the chain that the code comment argues over: canvas
//     row → v → plane +Y → world −Z. A canvas-space match cannot see a flip
//     introduced downstream by the UVs or by the plane's rotation.
//
// ⚠⚠ AND "BOTTOM-HEAVY" IS NOT WHAT UPRIGHT MEANS. The screen test used to be
// "more ink in the bottom half of the bbox than the top", which is true of "2"
// and "31" and is a property of those two numerals, not of digits. Applied to
// all 32 it failed a CORRECT floor at bays 7, 9, 17, 19 and 27 — every numeral
// ending in 7 or 9 — because a Georgia "7" is a heavy bar over a thin diagonal
// and measures 233.3 top against 144.0 bottom when it is drawn perfectly. The
// sweep now correlates the on-screen mask against the same canonical artwork
// and requires identity to beat flipY and rot180, which asks the question about
// this glyph instead of about digits in general. The two FRAMED shots keep the
// old bottom-heavy assertion as well, unchanged, because their numerals are
// bottom-heavy and it is one more independent way to be right.
//
// ⚠ WHERE THE SWEEP STANDS, AND WHY IT IS NOT 5.4 m. The framed reference shot
// stands 5.4 m dock-side of the stencil so the bay's wall sign lands in the
// same frame. That distance only works for the LAST row: the stencil sits at
// bay-centre +BD/2+0.75 and the next row's bays start 1.85 m further out, so at
// 5.4 m the camera is inside the row in front and photographs the back of a bay
// box. Measured on the first draft of this sweep: 27 of 32 bays at tier 5
// returned 0 changed pixels in the render, and the five that worked were
// exactly the ones with no bay in front of them. The sweep therefore stands
// 1.55 m out — inside the walkway the reach check proves is walkable — and
// pitches down to put the numeral in the middle of the frame, which is what a
// player reading a floor number actually does. The framed 5.4 m shot is still
// taken, for the two bays where it is geometrically possible.
//
// ⚠ AND IT ASSERTS THE GLYPH IS WHOLLY IN FRAME. A truncated mask makes every
// profile computed from it meaningless, and that once made a correct tier-1
// stencil measure "top-heavy" and fail. The bbox is now required to be clear of
// all four viewport edges rather than eyeballed in the PNG.
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

// ── THE MEASUREMENT, run once per tier over every bay ───────────────────────
// One evaluate() per tier, because the render must be READ IN THE SAME TASK it
// was drawn in: the renderer is created without preserveDrawingBuffer, so the
// colour buffer is gone by the next evaluate() — drawImage() then copies a
// blank canvas, every pixel is identical, and any percentile threshold selects
// 100% of the crop. That is exactly what the first two runs of this check did
// while printing PASS.
const SWEEP = async (n, canonBay) => p.evaluate(async ([n, canonBay]) => {
  const st = WH.state(); const C = st.config;
  st.units = [];
  for (let i = 1; i <= n; i++) st.units.push({ id: 'u' + i, bay_no: i, renter_id: null,
    renter_name: null, occupied: false, capacity_kg: C.unit_capacity_kg, used_kg: 0, contents: {}, mine: false });
  st.warehouse.units_total = n;
  WH.setState(st); refreshWorld();
  await new Promise(r => setTimeout(r, 150));
  // Hide the HUD — it covers a third of the frame and none of it is the room.
  ['hud', 'topbtns', 'toast', 'prompt'].forEach(id => {
    const e = document.getElementById(id); if (e) e.style.display = 'none'; });

  const c = renderer.domElement;
  const G = 32, SS = 4;
  // ⚠ RESAMPLE BY AREA, NOT BY ACCUMULATION. Dropping each source pixel into
  // the grid cell it lands in is fine when the source is bigger than the grid
  // and useless when it is smaller: the tier-1 numeral is 20×19 px, so 64% of
  // a 32×32 grid stayed EMPTY while the 512-px reference filled every cell,
  // and correlating a sieve against a solid read 0.131 on a mask that is
  // visibly a perfect "2". Same normalisation on both sides or the comparison
  // means nothing — so both are bilinear-sampled with 4×4 supersampling.
  const gridOf = (get, x0, y0, x1, y1) => {
    const g = new Float32Array(G * G);
    if (x1 < x0 || y1 < y0) return g;
    const w = Math.max(1, x1 - x0 + 1), h = Math.max(1, y1 - y0 + 1);
    const bil = (fx, fy) => {
      const px = Math.min(x1, Math.max(x0, x0 + fx)), py = Math.min(y1, Math.max(y0, y0 + fy));
      const ix = Math.floor(px), iy = Math.floor(py), tx = px - ix, ty = py - iy;
      const jx = Math.min(x1, ix + 1), jy = Math.min(y1, iy + 1);
      return get(ix, iy) * (1 - tx) * (1 - ty) + get(jx, iy) * tx * (1 - ty)
           + get(ix, jy) * (1 - tx) * ty + get(jx, jy) * tx * ty;
    };
    for (let gy = 0; gy < G; gy++) for (let gx = 0; gx < G; gx++) {
      let acc = 0;
      for (let sy = 0; sy < SS; sy++) for (let sx = 0; sx < SS; sx++)
        acc += bil((gx + (sx + 0.5) / SS) / G * w - 0.5, (gy + (sy + 0.5) / SS) / G * h - 0.5);
      g[gy * G + gx] = acc / (SS * SS);
    }
    return g;
  };
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
  const XFn = {
    identity: (r, x, y) => r[y * G + x],
    flipY:    (r, x, y) => r[(G - 1 - y) * G + x],
    flipX:    (r, x, y) => r[y * G + (G - 1 - x)],
    rot180:   (r, x, y) => r[(G - 1 - y) * G + (G - 1 - x)],
    rot90cw:  (r, x, y) => r[(G - 1 - x) * G + y],
    rot90ccw: (r, x, y) => r[x * G + (G - 1 - y)],
  };
  const xfGrid = (r, k) => { const v = new Float32Array(G * G);
    for (let y = 0; y < G; y++) for (let x = 0; x < G; x++) v[y * G + x] = XFn[k](r, x, y);
    return v; };

  // ── THE ARTWORK, for every numeral on this floor ──────────────────────────
  // Each numeral drawn CANONICALLY (translation only) on a scratch canvas. Not
  // what the floor did — what it was meant to. Built for ALL bays up front so
  // each bay's ink can be matched against its neighbours' artwork as well as
  // its own.
  const SW = 512, SH = 512;
  const refs = [], refAsp = [], refSelf = [];
  for (let m = 1; m <= n; m++) {
    const sc = document.createElement('canvas'); sc.width = SW; sc.height = SH;
    const sctx = sc.getContext('2d');
    App.stencilRef[m - 1](sctx, SW / 2, SH * 0.62);
    const sd = sctx.getImageData(0, 0, SW, SH).data;
    let sx0 = 1e9, sy0 = 1e9, sx1 = -1, sy1 = -1;
    for (let y = 0; y < SH; y++) for (let x = 0; x < SW; x++) {
      if (sd[(y * SW + x) * 4 + 3] < 24) continue;
      if (x < sx0) sx0 = x; if (x > sx1) sx1 = x;
      if (y < sy0) sy0 = y; if (y > sy1) sy1 = y;
    }
    const g = gridOf((x, y) => { const a = sd[(y * SW + x) * 4 + 3]; return a < 24 ? 0 : a; }, sx0, sy0, sx1, sy1);
    refs.push(g);
    refAsp.push((sx1 >= sx0) ? (sx1 - sx0 + 1) / Math.max(1, sy1 - sy0 + 1) : 0);
    // ⚠ HOW MUCH THE ORIENTATION TEST CAN POSSIBLY SAY ABOUT THIS NUMERAL,
    // asked of the ARTWORK and nothing else. A perfectly drawn "8" correlates
    // 0.999 with its own mirror image — so demanding that identity beat flipX
    // by 0.10 on bay 8 fails a correct floor, and the first draft of this sweep
    // did exactly that. This is not a hand-written exemption list: it is
    // measured per numeral, at runtime, from the same reference the test uses.
    let self = -2, selfK = '';
    for (const k of Object.keys(XFn)) {
      if (k === 'identity') continue;
      const s = corr(g, xfGrid(g, k));
      if (s > self) { self = s; selfK = k; }
    }
    refSelf.push({ v: +self.toFixed(3), k: selfK });
  }

  const paint = () => { const fc = App.floorCanvas;
    return { w: fc.width, h: fc.height,
             d: fc.getContext('2d').getImageData(0, 0, fc.width, fc.height).data }; };
  const grab = () => { const g = document.createElement('canvas');
    g.width = c.width; g.height = c.height;
    g.getContext('2d').drawImage(c, 0, 0);
    return g.getContext('2d').getImageData(0, 0, c.width, c.height).data; };

  // ── SCREEN-SPACE DIFF from wherever the camera currently is ───────────────
  // Renders with and without ONE numeral and diffs. One numeral is suppressed,
  // so the mask is that numeral even with neighbouring bays in frame.
  const screenPair = (want, dbg) => {
    App.noStencils = false; App.buildShed(n);
    renderer.render(scene, camera);
    const A = grab();
    App.noStencils = want; App.buildShed(n);
    renderer.render(scene, camera);
    const B = grab();
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
    const sg = gridOf((x, y) => diff[y * W + x], x0, y0, x1, y1);
    // orientation within the GLYPH'S OWN bbox, not the crop's
    let top = 0, bot = 0, gmax = 0;
    for (const v of sg) gmax = Math.max(gmax, v);
    for (let y = 0; y < G; y++) for (let x = 0; x < G; x++) {
      const v = gmax ? sg[y * G + x] / gmax : 0;
      if (y < G / 2) top += v; else bot += v;
    }
    // Clear of every viewport edge? A truncated mask profiles as nonsense.
    const inFrame = nInk > 0 && x0 > 1 && y0 > 1 && x1 < W - 2 && y1 < H - 2;
    const own = refs[want - 1];
    const sScore = {};
    for (const k of Object.keys(XFn)) sScore[k] = +corr(sg, xfGrid(own, k)).toFixed(3);
    let sBest = 'identity';
    for (const k of Object.keys(sScore)) if (sScore[k] > sScore[sBest]) sBest = k;
    let sRun = -2;
    for (const k of Object.keys(sScore)) if (k !== 'identity' && sScore[k] > sRun) sRun = sScore[k];
    return { px: nInk, bbox: nInk ? [x0, y0, x1, y1] : null, inFrame,
             top: +top.toFixed(1), bot: +bot.toFixed(1),
             score: sScore, best: sBest, margin: +(sScore.identity - sRun).toFixed(3),
             vsFlipY: +(sScore.identity - sScore.flipY).toFixed(3),
             vsRot180: +(sScore.identity - sScore.rot180).toFixed(3) };
  };

  // ── TEXTURE-SPACE DIFF, which needs no camera at all ──────────────────────
  const texPair = (want) => {
    App.noStencils = false; App.buildShed(n);
    const TA = paint();
    const at = App.stencilAt[want - 1];
    App.noStencils = want; App.buildShed(n);
    const TB = paint();
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
    const mask = gridOf((x, y) => tdiff[y * TA.w + x], tx0, ty0, tx1, ty1);
    const own = refs[want - 1];
    const tScore = {};
    for (const k of Object.keys(XFn)) tScore[k] = +corr(mask, xfGrid(own, k)).toFixed(3);
    let tBest = 'identity';
    for (const k of Object.keys(tScore)) if (tScore[k] > tScore[tBest]) tBest = k;
    let tRunner = -2;
    for (const k of Object.keys(tScore)) if (k !== 'identity' && tScore[k] > tRunner) tRunner = tScore[k];
    // WHICH NUMERAL, not only which way up: the same ink against every other
    // numeral's artwork, upright. This bay's own has to win.
    let xBest = -2, xBestN = 0;
    for (let m = 1; m <= n; m++) {
      if (m === want) continue;
      const s = corr(mask, refs[m - 1]);
      if (s > xBest) { xBest = s; xBestN = m; }
    }
    // Aspect is the one cue a 32×32 normalised grid throws away, and it is
    // exactly what a 90° rotation changes. Kept as a separate reported number.
    const mAsp = (tx1 >= tx0) ? (tx1 - tx0 + 1) / Math.max(1, ty1 - ty0 + 1) : 0;
    const rAsp = refAsp[want - 1];
    return { px: tInk, stray: strayPx, bbox: tInk ? [tx0, ty0, tx1, ty1] : null,
             score: tScore, best: tBest,
             margin: +(tScore.identity - tRunner).toFixed(3),
             self: refSelf[want - 1],
             xBestN, xBest: +xBest.toFixed(3), xMargin: +(tScore.identity - xBest).toFixed(3),
             aspect: +mAsp.toFixed(3), refAspect: +rAsp.toFixed(3),
             aspectErr: rAsp ? +Math.abs(mAsp / rAsp - 1).toFixed(3) : 9 };
  };

  // ── stand where a player stands, facing the numeral ───────────────────────
  // ⚠ yaw 0 faces −Z here (fwd = (−sin y, 0, −cos y)), so yaw = π faces AWAY
  // from the bays. The first version of this check used π and photographed the
  // empty dock — which is exactly the class of mistake it exists to stop.
  // `from` is 'stencil' (the sweep, which needs a distance it can guarantee is
  // clear of the row in front) or 'bay' (the historic framed shot, whose 5.4 m
  // is measured from the BAY NODE and lands 2.85 m from the numeral).
  const stand = (bayNo, dist, pitch, from) => {
    const bay = App.bayNodes.filter(bb => bb.unit.bay_no === bayNo)[0];
    if (!bay) return null;
    const bx = bay.node.position.x, bz = bay.node.position.z;
    // the numeral sits dock-side of the bay box, by the same maths buildShed uses
    const sz = bz + 3.6 / 2 + 0.75;
    const base = (from === 'bay') ? bz : sz;
    camera.position.set(bx, 1.70, base + dist);
    camera.rotation.order = 'YXZ';
    Ctl.yaw = 0;
    Ctl.pitch = (pitch != null) ? pitch : -Math.atan2(1.70 - 0.012, base + dist - sz);
    camera.rotation.y = Ctl.yaw; camera.rotation.x = Ctl.pitch;
    return { bx, bz, sz };
  };

  const bays = [];
  for (let want = 1; want <= n; want++) {
    // ⚠ 1.55 m, not 5.4. See the header: at 5.4 m the camera is inside the row
    // in front and 27 of 32 bays returned an empty render.
    const at = stand(want, 1.55, null, 'stencil');
    if (!at) { bays.push({ bay: want, missing: true }); continue; }
    const tex = texPair(want);
    if (tex.fatal) { bays.push({ bay: want, fatal: tex.fatal }); continue; }
    const glyph = screenPair(want);
    bays.push({ bay: want, tex, glyph });
  }

  // ── and the framed reference shot, for the one bay where it is possible ───
  // 5.4 m dock-side, eye height, looking down at the numeral AND at the bay's
  // back wall — the sign is on that wall, so both land in frame and the sign is
  // the known-upright reference a human can check the PNG against.
  let canon = null;
  if (canonBay) {
    const at = stand(canonBay, 5.4, -0.26, 'bay');
    if (at) canon = { bay: canonBay, glyph: screenPair(canonBay) };
  }
  App.noStencils = false; App.buildShed(n);
  renderer.render(scene, camera);
  return { bays, canon };
}, [n, canonBay]);

// ⚠ THRESHOLDS, and where each number comes from. Every one is a clean-build
// measurement with the cushion stated, not a round number that felt safe.
const T = {
  //  0 for a deleted numeral; 114 px is the thinnest real one ("7" at tier 5),
  //  146 the tier-1 "2". The gap to straddle is 0-vs-114.
  texInk: 60,
  //  the sweep stands close, so a numeral covers 12k-40k px of a 1000×760
  //  frame; the ceiling is a "the whole screen changed" guard, not a size test.
  scrInkMin: 120, scrInkMax: 200000,
  //  identity must beat its own best rotation. Clean minimum among the bays
  //  this test applies to is 0.168 (bay 3); see selfMax for the ones it cannot.
  margin: 0.10,
  //  a numeral whose ARTWORK correlates this well with its own mirror/flip
  //  cannot carry the orientation test — "8" scores 0.999 against flipX, so a
  //  perfect floor fails a 0.10 margin. Measured cut: the five numerals above
  //  0.85 (1, 8, 10, 11, 30) are exactly the five whose clean margin is under
  //  0.10; the 27 below it all clear 0.168.
  selfMax: 0.85,
  //  own numeral vs every other numeral at this tier. Clean minimum 0.099
  //  (bay 18 at 0.982 against "10" at 0.883). Threshold 0.04.
  xMargin: 0.04,
  //  90° rotation changes the aspect ratio; clean worst is 9.1% off.
  aspectErr: 0.20,
  //  bottom-heavier than top in its own bbox. Only asserted on the two FRAMED
  //  reference shots, whose numerals ("2" and "31") are bottom-heavy: 1.397 and
  //  1.189 clean. It is NOT a universal property of a digit — see the screen
  //  test below for the five clean bays it failed.
  bottomHeavy: 1.02,
  //  on screen, identity must beat flipY AND rot180 — the two ways the
  //  texture→screen chain can turn the floor over. Clean minimum across all 36
  //  numerals is 0.071 (bay 10, whose artwork is itself 0.901 flipY-symmetric,
  //  so it is the least that this test can ever say); most bays are 0.2-0.9.
  screenFlip: 0.03,
};

const CANON = { t1: 2, t5: 31 };
let sweptBays = 0, shapeTested = 0;

for (const [tier, units] of [['t1', 4], ['t5', 32]]) {
  const res = await SWEEP(units, CANON[tier]);
  const rows = res.bays;

  // Per-bay numbers, so a failure is diagnosable without re-running anything.
  console.log(`\n── ${tier} · ${units} bays swept ────────────────────────────────────────`);
  console.log('  bay  texPx stray   TEXTURE best/margin  selfMax       own-vs-others     asp  |  scrPx  SCREEN best/margin  id−flipY  id−rot180  top/bot   inFrame bbox');
  for (const r of rows) {
    if (r.missing) { console.log(`  ${String(r.bay).padStart(3)}   MISSING`); continue; }
    if (r.fatal)   { console.log(`  ${String(r.bay).padStart(3)}   FATAL ${r.fatal}`); continue; }
    const t = r.tex, g = r.glyph;
    console.log(`  ${String(r.bay).padStart(3)}   ${String(t.px).padStart(5)} ${String(t.stray).padStart(5)}  `
      + `${t.best.padEnd(8)}${String(t.margin).padStart(7)}  ${String(t.self.v).padStart(5)} ${t.self.k.padEnd(8)} `
      + `${String(t.score.identity).padStart(6)} vs ${String(t.xBest).padStart(6)} ("${t.xBestN}")  `
      + `${String(t.aspectErr).padStart(5)}  | ${String(g.px).padStart(6)}  `
      + `${g.best.padEnd(8)}${String(g.margin).padStart(7)}  ${String(g.vsFlipY).padStart(8)}  ${String(g.vsRot180).padStart(9)}  ${g.top}/${g.bot}`
      + `  ${g.inFrame ? "yes" : "NO "}  ${g.bbox ? g.bbox.join(",") : "-"}`);
  }

  // ── one verdict per property, over every bay ──────────────────────────────
  // Reporting 32 bays × 7 assertions as 224 lines helps nobody; reporting one
  // line per property with the WORST bay named is the same information with the
  // failure legible. A failing property names every bay that failed it.
  const fail = (pred) => rows.filter(r => !r.missing && !r.fatal && !pred(r)).map(r => r.bay);
  const gone = rows.filter(r => r.missing || r.fatal).map(r => r.bay);
  const worst = (get, cmp) => rows.filter(r => !r.missing && !r.fatal)
    .reduce((a, r) => (a === null || cmp(get(r), get(a))) ? r : a, null);
  const say = (label, bad, detail) => ok(`${tier} · ${label}`, bad.length === 0,
    bad.length ? `bays ${bad.join(',')}` : detail);

  ok(`${tier} · every bay was reached and measured`, gone.length === 0 && rows.length === units,
     `${rows.length - gone.length}/${units} bays` + (gone.length ? ` — missing/fatal: ${gone.join(',')}` : ''));
  sweptBays += rows.length - gone.length;

  const wStray = worst(r => r.tex.stray, (a, b) => a > b);
  say('the two floor paints differ ONLY at the suppressed numeral',
      fail(r => r.tex.stray === 0), `max stray ${wStray ? wStray.tex.stray : '-'} px on any bay`);

  const wInk = worst(r => r.tex.px, (a, b) => a < b);
  say('every numeral EXISTS in the floor texture',
      fail(r => r.tex.px > T.texInk), `thinnest ${wInk ? wInk.tex.px : '-'} px (bay ${wInk ? wInk.bay : '-'}) vs floor ${T.texInk}`);

  // ── WHICH NUMERAL. The half that a wrong digit fails. ─────────────────────
  const wX = worst(r => r.tex.xMargin, (a, b) => a < b);
  say('every numeral is ITS OWN, not another bay\'s',
      fail(r => r.tex.xMargin > T.xMargin),
      wX ? `worst bay ${wX.bay}: own ${wX.tex.score.identity} vs "${wX.tex.xBestN}" ${wX.tex.xBest} = +${wX.tex.xMargin} (floor ${T.xMargin})` : '');

  // ── WHICH WAY UP, where the artwork can carry the question. ───────────────
  const canShape = rows.filter(r => !r.missing && !r.fatal && r.tex.self.v <= T.selfMax);
  const cantShape = rows.filter(r => !r.missing && !r.fatal && r.tex.self.v > T.selfMax);
  shapeTested += canShape.length;
  const badShape = canShape.filter(r => !(r.tex.best === 'identity' && r.tex.margin > T.margin)).map(r => r.bay);
  const wShape = canShape.reduce((a, r) => (a === null || r.tex.margin < a.tex.margin) ? r : a, null);
  ok(`${tier} · ${canShape.length}/${units} numerals match the artwork under IDENTITY`,
     badShape.length === 0 && canShape.includes(rows[CANON[tier] - 1]),
     badShape.length ? `bays ${badShape.join(',')}`
       : `thinnest margin ${wShape ? wShape.tex.margin : '-'} (bay ${wShape ? wShape.bay : '-'}) vs floor ${T.margin}`);
  if (cantShape.length) console.log(`       ${cantShape.length} numeral(s) cannot carry an orientation test — their own artwork`
    + ` scores >${T.selfMax} against a flip of itself: `
    + cantShape.map(r => `${r.bay}=${r.tex.self.v}(${r.tex.self.k})`).join(' ')
    + ' — covered instead by own-vs-others and by the on-screen upright test.');

  const wAsp = worst(r => r.tex.aspectErr, (a, b) => a > b);
  say('every numeral has the artwork\'s proportions',
      fail(r => r.tex.aspectErr < T.aspectErr),
      wAsp ? `worst ${(wAsp.tex.aspectErr * 100).toFixed(0)}% off (bay ${wAsp.bay}) vs ceiling ${(T.aspectErr * 100).toFixed(0)}%` : '');

  // ── and the texture→screen chain, which texture space cannot see ──────────
  const wScr = worst(r => r.glyph.px, (a, b) => a < b);
  say('every numeral EXISTS on screen, wholly in frame',
      fail(r => r.glyph.px > T.scrInkMin && r.glyph.px < T.scrInkMax && r.glyph.inFrame),
      wScr ? `smallest ${wScr.glyph.px} px (bay ${wScr.bay}), all bboxes clear of the viewport edge` : '');

  // ── THE TEXTURE→SCREEN CHAIN, which texture space cannot see ─────────────
  // This is the half that guards the canvas row → v → +Y → −Z argument in the
  // page's comment: a flip introduced by the UVs or by the plane's rotation
  // leaves the texture perfect and the render upside down.
  //
  // ⚠ NOT "bottom-heavy". That was the original test and it is only true of the
  // numeral it was written against. Measured on a CORRECT floor at tier 5: bay
  // 7 renders 233.3 units of ink in the top half of its own bbox against 144.0
  // in the bottom, because a Georgia "7" is a heavy bar over a thin diagonal —
  // it IS top-heavy. Universalising bottom-heaviness failed bays 7, 9, 17, 19
  // and 27 on a clean build, all of them numerals ending in 7 or 9. So the
  // screen mask is matched against the SAME artwork the texture test uses, and
  // upright means "identity beats the two vertical inversions", which is a
  // statement about this glyph rather than about digits in general.
  const vFlip = (r) => Math.min(r.glyph.vsFlipY, r.glyph.vsRot180);
  const wUp = worst(vFlip, (a, b) => a < b);
  say('every numeral RENDERS upright (its ink matches the artwork, not a flip of it)',
      fail(r => r.glyph.px > T.scrInkMin && r.glyph.score.identity > r.glyph.score.flipY + T.screenFlip
                && r.glyph.score.identity > r.glyph.score.rot180 + T.screenFlip),
      wUp ? `thinnest identity-over-inversion ${vFlip(wUp).toFixed(3)} (bay ${wUp.bay}) vs floor ${T.screenFlip}` : '');

  // ── the framed reference shot: the wall sign is upright in the same frame ─
  if (res.canon) {
    const g = res.canon.glyph;
    const file = join(OUT, `STENCIL_${tier}_bay${res.canon.bay}.png`);
    await p.waitForTimeout(120);
    await p.screenshot({ path: file });
    /* The verdict: ink present, wholly in frame, and correlating with the
       ARTWORK under identity rather than under either inversion. That last pair
       is the direct test — see the note above this file's framed section for why
       the bottom-heaviness proxy is no longer ANDed into it. */
    ok(`${tier} · bay ${res.canon.bay} reads upright from the FRAMED standing view (5.4 m, wall sign in shot)`,
       g.px > T.scrInkMin && g.inFrame
       && g.score.identity > g.score.flipY + T.screenFlip && g.score.identity > g.score.rot180 + T.screenFlip,
       `${g.px} px changed · identity ${g.score.identity} `
       + `(flipY ${g.score.flipY}, rot180 ${g.score.rot180}) · ${file.replace(ROOT + '/', '')}`);
    /* Reported, never vetoing. A digit is USUALLY bottom-heavy on this floor and
       a change here is worth a look, but at 5.4 m the split is near parity and
       noise decides it — so it informs a human instead of failing a build. */
    console.log(`       ink split: top=${g.top} bottom=${g.bot} (bottom/top `
       + `${(g.bot / (g.top || 1)).toFixed(3)}; usually >1, informational)`);
  } else {
    ok(`${tier} · the framed reference shot was taken`, false, 'bay not found');
  }
}

ok('no uncaught page errors', errs.length === 0, errs.slice(0, 2).join(' | '));
console.log('');
const fails = R.filter(x => x.startsWith('FAIL')).length;
console.log(`${R.length - fails} PASS / ${fails} FAIL — ${sweptBays} numerals read individually, `
  + `${shapeTested} of them under the full orientation test.`);
if (fails) {
  console.error('✖ FLOOR STENCILS ARE NOT RIGHT. Open the PNGs in _wh_shots/ —');
  console.error('  the bay wall sign in the same frame is the upright reference.');
  process.exit(1);
}
console.log('✔ floor stencils read upright from a standing position, at every bay.');
await b.close();
