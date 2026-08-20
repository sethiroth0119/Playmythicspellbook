/* Where does _wh_stencil_check.mjs's on-screen half actually go wrong?

   Established already: the in-page read is ALIVE. With the harness's own camera
   maths, control (A vs A) = 0 and signal (A vs B) = 15,365 px. So "the
   framebuffer trap" is NOT the explanation — that was my mistake, and this file
   exists because the only way to tell a dead instrument from a real finding is
   to print the control beside the signal.

   Remaining candidates, measured here per bay:
     · the SWEEP (1.55 m, auto pitch) — px, bbox and inFrame. inFrame requires
       the glyph's bbox to clear all four viewport edges, and the assertion ANDs
       it with the pixel count, so a numeral running off the bottom of the frame
       scores px IN range and still fails.
     · the FRAMED shot (5.4 m from the bay node, pitch -0.26) — the one that
       reported a genuine 0.
   Run: node _wh_probe_capture.mjs */
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const threePath = join(ROOT, 'public', 'assets', 'vfx', 'three.min.js');
if (!existsSync(threePath)) { console.error('three.min.js missing'); process.exit(2); }

let chromium = null;
for (const spec of ['playwright', '/opt/node22/lib/node_modules/playwright/index.mjs']) {
  try { ({ chromium } = await import(spec)); break; } catch (e) {}
}
if (!chromium) { console.error('playwright not found'); process.exit(2); }

const three = readFileSync(threePath, 'utf8');
const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] });
const ctx = await b.newContext({ viewport: { width: 1000, height: 760 } });
await ctx.route('**/three.min.js', (r) => r.fulfill({ status: 200, contentType: 'application/javascript', body: three }));
const p = await ctx.newPage();
p.on('pageerror', (e) => console.log('  pageerror: ' + String(e.message).split('\n')[0]));
await p.goto(pathToFileURL(join(ROOT, 'public/warehouse/index.html')).href, { waitUntil: 'load' });
await p.waitForFunction(() => window.App && window.App.ready === true, { timeout: 30000 });

const r = await p.evaluate(async () => {
  const st = WH.state(); const C = st.config;
  st.units = [];
  for (let i = 1; i <= 32; i++) st.units.push({ id: 'u' + i, bay_no: i, renter_id: null,
    renter_name: null, occupied: false, capacity_kg: C.unit_capacity_kg, used_kg: 0, contents: {}, mine: false });
  st.warehouse.units_total = 32;
  WH.setState(st); refreshWorld();
  await new Promise((r2) => setTimeout(r2, 200));
  ['hud', 'topbtns', 'toast', 'prompt'].forEach((id) => {
    const e = document.getElementById(id); if (e) e.style.display = 'none'; });

  const c = renderer.domElement, W = c.width, H = c.height;
  const grab = () => {
    const g = document.createElement('canvas');
    g.width = W; g.height = H;
    g.getContext('2d').drawImage(c, 0, 0);
    return g.getContext('2d').getImageData(0, 0, W, H).data;
  };
  const lum = (d, i) => d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114;

  // The harness's own stand(), verbatim.
  const stand = (bayNo, dist, pitch, from) => {
    const bay = App.bayNodes.filter((bb) => bb.unit.bay_no === bayNo)[0];
    if (!bay) return null;
    const bx = bay.node.position.x, bz = bay.node.position.z;
    const sz = bz + 3.6 / 2 + 0.75;
    const base = (from === 'bay') ? bz : sz;
    camera.position.set(bx, 1.70, base + dist);
    camera.rotation.order = 'YXZ';
    Ctl.yaw = 0;
    Ctl.pitch = (pitch != null) ? pitch : -Math.atan2(1.70 - 0.012, base + dist - sz);
    camera.rotation.y = Ctl.yaw; camera.rotation.x = Ctl.pitch;
    return true;
  };

  // The harness's own screenPair(), reduced to what the assertion reads, plus a
  // do-nothing control so a zero can be told apart from a dead read.
  const pair = (want) => {
    App.noStencils = false; App.buildShed(32); renderer.render(scene, camera);
    const A = grab();
    const ctl = (renderer.render(scene, camera), grab());
    App.noStencils = want; App.buildShed(32); renderer.render(scene, camera);
    const B = grab();
    let x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1, nInk = 0, nCtl = 0;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      if (Math.abs(lum(A, i) - lum(ctl, i)) > 4) nCtl++;
      if (Math.abs(lum(A, i) - lum(B, i)) > 4) {
        nInk++;
        if (x < x0) x0 = x; if (x > x1) x1 = x;
        if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
    }
    const inFrame = nInk > 0 && x0 > 1 && y0 > 1 && x1 < W - 2 && y1 < H - 2;
    return { px: nInk, control: nCtl, inFrame,
             edge: nInk ? { left: x0, top: y0, right: W - 1 - x1, bottom: H - 1 - y1 } : null };
  };

  const out = { viewport: { W, H }, sweep: [], framed: null };
  for (const bay of [1, 16, 31, 32]) {
    if (!stand(bay, 1.55, null, 'stencil')) { out.sweep.push({ bay, missing: true }); continue; }
    out.sweep.push(Object.assign({ bay }, pair(bay)));
  }
  if (stand(31, 5.4, -0.26, 'bay')) out.framed = Object.assign({ bay: 31 }, pair(31));
  return out;
});

console.log('\n── stencil on-screen probe ──   viewport ' + r.viewport.W + 'x' + r.viewport.H);
const row = (t, g) => {
  if (!g || g.missing) { console.log('  ' + t + ' MISSING'); return; }
  console.log('  ' + t
    + ' px=' + String(g.px).padStart(6)
    + '  control=' + g.control
    + '  inFrame=' + (g.inFrame ? 'yes' : 'NO ')
    + (g.edge ? '  edges L' + g.edge.left + ' T' + g.edge.top + ' R' + g.edge.right + ' B' + g.edge.bottom : ''));
};
for (const g of r.sweep) row('sweep  1.55m bay ' + String(g.bay).padStart(2) + ':', g);
row('framed 5.40m bay 31:', r.framed);
await b.close();
