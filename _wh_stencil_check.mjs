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
let chromium = null;
for (const spec of ['playwright', '/opt/node22/lib/node_modules/playwright/index.mjs']) {
  try { ({ chromium } = await import(spec)); break; } catch (e) {}
}
if (!chromium) { console.error('✖ cannot run: playwright not found.  npm i playwright --no-save'); process.exit(2); }

const three = readFileSync(threePath, 'utf8');
const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] });
const ctx = await b.newContext({ viewport: { width: 1000, height: 760 } });
await ctx.route('**/three.min.js', r => r.fulfill({ status: 200, contentType: 'application/javascript', body: three }));
const p = await ctx.newPage();
const errs = [];
p.on('pageerror', e => errs.push(String(e.message).split('\n')[0]));
await p.goto(pathToFileURL(join(ROOT, 'public/warehouse/index.html')).href, { waitUntil: 'load' });
await p.waitForFunction(() => window.App && window.App.ready === true, { timeout: 30000 });

const R = [];
const ok = (l, c, d = '') => { const s = `${c ? 'PASS' : 'FAIL'} — ${l}  ${d}`; R.push(s); console.log(s); };

for (const [tier, units, bayNo] of [['t1', 2, 1], ['t5', 32, 31]]) {
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
    camera.position.set(bx, 1.70, bz + 3.6);
    camera.rotation.order = 'YXZ';
    Ctl.yaw = 0; Ctl.pitch = -0.40;
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
    const c = renderer.domElement;
    const g = document.createElement('canvas'); g.width = c.width; g.height = c.height;
    const g2 = g.getContext('2d'); g2.drawImage(c, 0, 0);
    const W = g.width, H = g.height;
    const x0 = Math.round(W * 0.30), x1 = Math.round(W * 0.70);
    const y0 = Math.round(H * 0.50), y1 = Math.round(H * 0.96);
    const w = x1 - x0, h = y1 - y0;
    const d = g2.getImageData(x0, y0, w, h).data;
    const lum = [];
    for (let i = 0; i < d.length; i += 4) lum.push(d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114);
    const sorted = lum.slice().sort((a, b2) => a - b2);
    const med = sorted[Math.floor(sorted.length * 0.5)];
    const hi = sorted[sorted.length - 1];
    const thr = med + (hi - med) * 0.45;
    let top = 0, bot = 0, ink = 0, sumY = 0;
    for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < w; xx++) {
      if (lum[yy * w + xx] < thr) continue;
      ink++; sumY += yy;
      if (yy < h / 2) top++; else bot++;
    }
    return { bx, bz, ink: { n: ink, total: w * h, top, bot, cy: ink ? sumY / ink / h : null,
                            med: Math.round(med), hi: Math.round(hi), thr: Math.round(thr) } };
  }, [units, bayNo]);
  if (!view) { ok(`${tier} bay ${bayNo} exists`, false); continue; }
  await p.waitForTimeout(120);
  const file = join(OUT, `STENCIL_${tier}_bay${bayNo}.png`);
  await p.screenshot({ path: file });

  const ink = view.ink;
  ok(`${tier} · bay ${bayNo} stencil ink found and is a minority of the crop`,
     ink.n > 200 && ink.n < ink.total * 0.35, `${ink.n} px of ${ink.total} (${(100 * ink.n / ink.total).toFixed(1)}%)`);
  // A digit rendered upright, viewed from the dock with the camera pitched down,
  // puts most of its ink BELOW the glyph's vertical centre in screen space.
  ok(`${tier} · bay ${bayNo} numeral is UPRIGHT (ink bottom-heavy)`,
     ink.bot >= ink.top,
     `top=${ink.top} bottom=${ink.bot} centroidY=${ink.cy == null ? '—' : ink.cy.toFixed(3)} → ${file}`);
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
