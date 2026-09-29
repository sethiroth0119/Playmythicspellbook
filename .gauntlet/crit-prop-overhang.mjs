/* ══════════════════════════════════════════════════════════════════════════
   CRIT-PROP-OVERHANG — does a prop at PROP_SCALE 0.55 still hang over its hex?
   PHOTOGRAPHED, not derived. The PROP_SCALE comment measures `wr` (the facade
   half-width) and concludes "all inside their tile", but every painter also
   draws loose debris and a rubble skirt OUTSIDE ±W (grep: -W*1.24 hospital
   canopy, W*1.30 school mound, W*1.16 car wheel, ±W*1.12 rubble skirt), so the
   only honest answer is the one taken off the canvas.

   🔴 THE RENDER TRAP is respected: nothing waits on rAF. `frame(t)` is a
      function declaration and is called DIRECTLY with a rising t, and the
      getImageData that follows is in the SAME task. The stage is a 2D canvas
      (ctx.setTransform / clearRect), not WebGL, so there is no
      preserveDrawingBuffer to lose — but the A/B still renders between reads.
   🔴 A CONTROL IS TAKEN. Frame-to-frame noise (brazier flicker, loot pip
      pulse, T-phase drift) is measured empty-vs-empty at the same crop, and
      the struct's own signal must clear it. Without that floor a diff of two
      animated frames "finds" the prop everywhere.
   🔴 Nothing is monkeypatched and nothing is moved. Structures arrive the way
      the game sends them — a `board:structs` postMessage, the same payload
      _bbStagePushStructs builds.

   Run: node .gauntlet/crit-prop-overhang.mjs
   ══════════════════════════════════════════════════════════════════════════ */
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve('D:/game-deploy', 'public');
const MIME = { '.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.json':'application/json','.png':'image/png','.jpg':'image/jpeg','.svg':'image/svg+xml','.txt':'text/plain','.webp':'image/webp' };
const PORT = 8600 + (process.pid % 90);
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p.endsWith('/')) p += 'index.html';
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end('nf'); }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
});
await new Promise(r => server.listen(PORT, '127.0.0.1', r));

let pass = 0, fail = 0;
const ok = (n, c, d) => { c ? pass++ : fail++; console.log((c ? '  PASS  ' : '  FAIL  ') + n + (d == null ? '' : '   ' + JSON.stringify(d))); };

const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
page.on('pageerror', e => console.log('   pageerror: ' + String(e).slice(0, 160)));
await page.route('**/*', r => { const u = r.request().url();
  return (u.includes('127.0.0.1') || u.includes('localhost')) ? r.continue() : r.abort(); });
await page.goto('http://127.0.0.1:' + PORT + '/index.html', { waitUntil: 'domcontentloaded', timeout: 180000 });
await page.waitForFunction('typeof initGame === "function"', null, { timeout: 180000 });
await page.waitForTimeout(5000);
await page.evaluate(() => {
  App.battlePrep = App.battlePrep || {};
  const me = findHeroById(STARTER_HEROES[0].id), foe = findHeroById(STARTER_HEROES[1].id);
  App.battlePrep.hero = me; App.battlePrep.multiplayer = false;
  App.state = initGame(me, foe, [], true, null); App.screen = 'battle'; render();
});
await page.waitForTimeout(7000);

const pre = await page.evaluate(() => {
  const f = document.querySelector('iframe.bb-stage'); const w = f && f.contentWindow;
  return { stage: !!w, frameFn: typeof (w && w.frame), canvas: !!(w && w.document.getElementById('stage')),
           realStructs: (App.state.structures || []).map(s => ({ x: s.x, z: s.y, kind: s.kind })) };
});
console.log('-- pre --', JSON.stringify(pre));
ok('PRE  the stage exposes frame() as a function declaration', pre.frameFn === 'function', pre.frameFn);
ok('PRE  the real match seeded ruins', pre.realStructs.length > 0, pre.realStructs.length);

const KINDS = ['school', 'hospital', 'car', 'house', 'church'];
const results = [];

for (const kind of KINDS) {
  const r = await page.evaluate(async (kind) => {
    const host = document.querySelector('iframe.bb-stage');
    const w = host.contentWindow;
    const cv = w.document.getElementById('stage');
    const c2 = cv.getContext('2d', { willReadFrequently: true });
    const dpr = cv.width / parseFloat(cv.style.width || w.innerWidth);
    const post = (type, body) => { w.postMessage(Object.assign({ type: 'board:' + type }, body), '*');
                                   return new Promise(r => setTimeout(r, 120)); };

    /* a mid-board tile, well clear of both edges */
    const map = w.Board.map;
    const X = Math.floor(map.cols / 2), Z = Math.floor(map.rows / 2);
    const wp = w.gw(X, Z, w.tileElev(X, Z));
    const foot = w.project({ x: wp.x, y: wp.y, z: wp.z });
    const hexHalfPx = w.ringPx(foot, w.tileR());          /* the hex's own half-width */

    /* crop: 3 hexes either side of the foot, 4 hex-heights up from it */
    const padX = Math.ceil(hexHalfPx * 3.2), padUp = Math.ceil(hexHalfPx * 5), padDn = Math.ceil(hexHalfPx * 1.2);
    const cx0 = Math.max(0, Math.round((foot.x - padX) * dpr));
    const cy0 = Math.max(0, Math.round((foot.y - padUp) * dpr));
    const cw = Math.min(cv.width - cx0, Math.round(padX * 2 * dpr));
    const ch = Math.min(cv.height - cy0, Math.round((padUp + padDn) * dpr));

    let t = 900000;
    const shoot = () => { t += 16.7; w.frame(t); return c2.getImageData(cx0, cy0, cw, ch).data; };

    /* ── CONTROL: empty tile, two consecutive frames → the noise floor ── */
    await post('structs', { list: [] });
    shoot();                                   // settle
    const A0 = shoot();
    const A1 = shoot();

    /* ── SIGNAL: the same tile with one prop on it ── */
    await post('structs', { list: [{ x: X, z: Z, kind: kind, lootable: false, looted: false, risk: null }] });
    shoot();                                   // settle the new list
    const B = shoot();

    const colMax = (P, Q) => {
      const out = new Float64Array(cw);
      for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
        const i = (y * cw + x) * 4;
        const d = Math.max(Math.abs(P[i] - Q[i]), Math.abs(P[i+1] - Q[i+1]), Math.abs(P[i+2] - Q[i+2]));
        if (d > out[x]) out[x] = d;
      }
      return out;
    };
    const noise = colMax(A0, A1);
    let noiseMax = 0; for (const v of noise) if (v > noiseMax) noiseMax = v;
    const THRESH = Math.max(24, noiseMax + 12);

    /* ⚠ SPLIT THE GROUND SHADOW OFF THE BODY. drawStruct's first act is
       shadowEllipse(wp, def.sh, .82) — a CAST SHADOW, stretched away from the
       light and spilling onto the neighbours by design. A column diff that does
       not exclude it reports every prop, including the 0.58-inradius house, as
       ~1.6 inradii wide, which is the shadow's number and not the prop's.
       The ellipse is squashed to 0.40 and its world radius is at most 0.62, so
       it lives within a dozen px of the foot; everything strictly above
       foot.y - 12 px is the building. Both bands are reported. */
    const GROUND_Y = (foot.y - 12) * dpr - cy0;
    const band = (yFrom, yTo) => {
      let lo = -1, hi = -1, cols = 0;
      for (let x = 0; x < cw; x++) {
        let hit = false;
        for (let y = Math.max(0, yFrom | 0); y < Math.min(ch, yTo | 0) && !hit; y++) {
          const i = (y * cw + x) * 4;
          const d = Math.max(Math.abs(A1[i] - B[i]), Math.abs(A1[i+1] - B[i+1]), Math.abs(A1[i+2] - B[i+2]));
          if (d >= THRESH) hit = true;
        }
        if (hit) { if (lo < 0) lo = x; hi = x; cols++; }
      }
      if (lo < 0) return null;
      const L = cx0 / dpr + lo / dpr, R = cx0 / dpr + (hi + 1) / dpr;
      return { leftPx: +L.toFixed(1), rightPx: +R.toFixed(1), cols,
               l: +((foot.x - L) / hexHalfPx).toFixed(3), r: +((R - foot.x) / hexHalfPx).toFixed(3) };
    };
    const body = band(0, GROUND_Y);
    const all  = band(0, ch);
    if (!body && !all) return { kind, drew: false, noiseMax, THRESH };
    const worst = body ? Math.max(body.l, body.r) : 0;
    return {
      kind, drew: true, X, Z,
      hexHalfPx: +hexHalfPx.toFixed(2), footX: +foot.x.toFixed(1), footY: +foot.y.toFixed(1),
      body, withShadow: all,
      halfLeftInradii: body ? body.l : null, halfRightInradii: body ? body.r : null,
      overhangPx: +Math.max(0, (worst - 1) * hexHalfPx).toFixed(1),
      noiseMax, THRESH
    };
  }, kind);
  results.push(r);
  console.log('-- ' + kind + ' --', JSON.stringify(r));
}

console.log('\n╔══ PROP FOOTPRINT, PHOTOGRAPHED ═══════════════════════════════════');
console.log('║ kind      hexHalf  BODY L/R (inradii)  +SHADOW L/R (inradii)  body overhang');
for (const r of results) {
  if (!r.drew) { console.log('║ ' + r.kind.padEnd(10) + ' (nothing drew — noiseMax ' + r.noiseMax + ')'); continue; }
  const b = r.body ? (r.body.l + ' / ' + r.body.r) : '(none)';
  const a = r.withShadow ? (r.withShadow.l + ' / ' + r.withShadow.r) : '(none)';
  console.log('║ ' + r.kind.padEnd(10) + String(r.hexHalfPx).padEnd(9) + b.padEnd(20) + a.padEnd(23) +
    (r.overhangPx > 0 ? r.overhangPx + ' px OVER' : 'inside'));
}
console.log('╚═══════════════════════════════════════════════════════════════════');
for (const r of results) {
  if (!r.drew) { ok('2  ' + r.kind + ' drew at all', false, r); continue; }
  ok('2  ' + r.kind + ' stays inside its own hex (both flanks <= 1.0 inradii)',
     r.halfLeftInradii <= 1.0 && r.halfRightInradii <= 1.0,
     { L: r.halfLeftInradii, R: r.halfRightInradii, overhangPx: r.overhangPx });
}

await browser.close(); server.close();
console.log('\n══ ' + pass + ' pass / ' + fail + ' fail ══');
