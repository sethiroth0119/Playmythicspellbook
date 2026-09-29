/* ══════════════════════════════════════════════════════════════════════════
   HOLOGRAM DEATH — does a dying unit actually shatter into light?

   The owner reports that a unit's sprite is supposed to play the Hologram
   shatter when it dies. The code is in public/battle-board/index.html
   (_holoPicture / _holoStart / drawHoloDeath, killUnit ~3532) and has been
   since 2026-09-19 — so this asks whether it still RUNS, not whether it exists.

   🔴 WHY THIS DRIVES THE BOARD PAGE AND NOT index.html. A match is drawn by
      the battle-board iframe, not by renderBoard(). v181 shipped a hologram
      death on the DOM board and every probe passed while the owner saw
      nothing, because neither could reach the stage.

   ⚠ THE BROWSER PANE PAINTS AT ~0.56 Hz, so a requestAnimationFrame shim is
     injected BEFORE the page's own scripts or the loop never ticks.

   🔴 SAMPLE ON THE BOARD'S CLOCK, NEVER ON WALL TIME. Under the harness the
      loop runs at roughly 5 fps: 1.9 s of wall time advanced holo.t only to
      0.45 of HOLO_DUR — p≈0.29, where drawHoloDeath is still painting the
      INTACT sprite, because the cyan blocks ramp in from p≈0.4 as `dissolve`
      opens. The first version of this probe sampled by stopwatch, photographed
      the frame before the effect existed, and failed a hologram that works.

   🔴 AND MEASURE A CROP, NOT THE CANVAS. The dome, the projector beams and the
      platform glow are all the same cyan; counting the whole frame buried an
      82-pixel death under 45 pixels of breathing scenery. The crop is the
      dying unit's own footprint, computed from project()/unitScreenH() before
      it dies, and the control is that SAME crop while it is still alive.

   Usage: node .gauntlet/holodeath-probe.mjs [root]
   ══════════════════════════════════════════════════════════════════════════ */
import { chromium } from 'playwright';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';

const ROOT = path.resolve(process.argv[2] || 'public');
const MIME = { '.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.json':'application/json','.png':'image/png','.jpg':'image/jpeg','.webp':'image/webp','.svg':'image/svg+xml','.txt':'text/plain','.wav':'audio/wav','.mp3':'audio/mpeg','.glb':'model/gltf-binary' };
const PORT = 9820 + Math.floor(Math.random() * 90);
const srv = http.createServer((q, r) => {
  let p = decodeURIComponent(q.url.split('?')[0]); if (p.endsWith('/')) p += 'index.html';
  const f = path.join(ROOT, p);
  if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end('nf'); }
  r.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(r);
});
await new Promise(r => srv.listen(PORT, '127.0.0.1', r));

let fails = 0;
const ok = (c, m, x) => { console.log('  ' + (c ? 'PASS' : 'FAIL') + '  ' + m + (x === undefined ? '' : '   [' + x + ']')); if (!c) fails++; };

const browser = await chromium.launch({ args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
await page.addInitScript(() => {
  window.requestAnimationFrame = (cb) => setTimeout(() => cb(performance.now()), 16);
});
await page.goto('http://127.0.0.1:' + PORT + '/battle-board/index.html',
                { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForFunction('window.Board && Board.units && Board.units.length > 0', null, { timeout: 60000 });
await page.waitForTimeout(1500);

const R = await page.evaluate(async () => {
  const out = {};
  const cv = ctx && ctx.canvas;
  if (!cv) return { err: 'no board ctx' };
  out.canvas = cv.width + 'x' + cv.height;

  const victim = Board.units.filter(u => !u.dead)[0];
  if (!victim) return { err: 'no live unit' };
  out.victim = String(victim.id);

  /* the unit's own footprint on screen, exactly as drawUnit computes it */
  const base = gw(victim.x, victim.z, unitGroundY(victim));
  const wy = base.y + victim.y;
  const foot = project({ x: base.x, y: wy, z: base.z });
  const k = unitScreenH(victim.def, base, wy, foot);
  if (!foot || !k) return { err: 'cannot project the victim' };
  const sc = k / 520;
  const box = {
    x: Math.max(0, Math.round(foot.x - 210 * sc)),
    y: Math.max(0, Math.round(foot.y - 546 * sc)),
    w: Math.min(cv.width,  Math.round(420 * sc)),
    h: Math.min(cv.height, Math.round(550 * sc)),
  };
  out.box = box;

  /* hologram cyan is #66eaff (102,234,255) */
  const countHolo = () => {
    const d = ctx.getImageData(box.x, box.y, box.w, box.h).data;
    let n = 0;
    for (let i = 0; i < d.length; i += 4) {
      const r = d[i], g = d[i + 1], b = d[i + 2];
      if (b > 200 && g > 180 && r < 170 && (b - r) > 60 && (g - r) > 40) n++;
    }
    return n;
  };

  /* ── CONTROL: the same crop, same unit, still alive ── */
  const before = [];
  for (let i = 0; i < 5; i++) { await new Promise(r => setTimeout(r, 200)); before.push(countHolo()); }
  out.controlMax = Math.max(...before);
  out.controlSeries = before;

  /* ── the death, sampled on the board's clock ── */
  const HOLO_DUR = 1.55;
  Board.killUnit(victim.id);
  out.started = !!(victim.holo && victim.holo.started);
  const series = [];
  for (const p of [0.30, 0.45, 0.60, 0.75, 0.88]) {
    const deadline = Date.now() + 30000;
    while (Date.now() < deadline && victim.holo && victim.holo.t / HOLO_DUR < p) {
      await new Promise(r => setTimeout(r, 30));
    }
    series.push({ p, n: countHolo() });
  }
  out.series = series;
  out.peak = Math.max(...series.map(s => s.n));
  out.peakAtP = (series.find(s => s.n === out.peak) || {}).p;
  out.dead = !!victim.dead;
  /* how much of the crop is hologram at its peak */
  out.cropPct = +(100 * out.peak / (box.w * box.h)).toFixed(1);
  return out;
});

console.log('══ HOLOGRAM DEATH PROBE ══');
console.log('  root : ' + ROOT + '\n');
if (R.err) { console.log('  ERROR: ' + R.err); await browser.close(); srv.close(); process.exit(1); }

console.log('  canvas ' + R.canvas + '   victim ' + R.victim +
            '   crop ' + R.box.w + 'x' + R.box.h + ' at (' + R.box.x + ',' + R.box.y + ')');
console.log('  control (alive) : ' + JSON.stringify(R.controlSeries) + '   max ' + R.controlMax);
console.log('  death           : ' + R.series.map(s => 'p' + s.p + '=' + s.n).join('  '));
console.log('  peak            : ' + R.peak + ' px at p=' + R.peakAtP + '   (' + R.cropPct + '% of the crop)\n');

ok(R.dead === true, 'killUnit marked the unit dead');
ok(R.started === true, 'the hologram STARTED (no cineHold in the way)');
ok(R.peak > 0, 'the dying sprite paints hologram light', R.peak + ' px');
ok(R.peak > R.controlMax * 4 + 50,
   '…and it is the DEATH, not the scenery',
   'death ' + R.peak + ' vs alive ' + R.controlMax);
ok(R.cropPct >= 2, '…covering a visible share of the sprite', R.cropPct + '%');

console.log(fails ? ('\n❌ ' + fails + ' FAILED\n') : '\n✅ dying units shatter into light\n');
await browser.close(); srv.close();
process.exit(fails ? 1 : 0);
