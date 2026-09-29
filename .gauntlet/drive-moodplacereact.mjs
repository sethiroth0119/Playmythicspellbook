/* ══════════════════════════════════════════════════════════════════════════
   🙂 DRIVE-MOODPLACEREACT — the ONE thing the shipped mood feature did not do.

   THE MEASURED GAP. /src/plotmood/overlay.js creates its badge mesh with
   `mesh.visible = false`, and node-city's placement hook is gated on
   `MythicPlotIcons.visible()`. So with the layer off — which is how every
   player starts — placing a building produced NO FACE AT ALL. This drives the
   real seam (`__nc.place`, i.e. tryPlace) WITH THE LAYER OFF and asserts:

     1  the layer really is off, and the badge mesh really is invisible;
     2  a placement still produces a reaction, on screen, in the same session;
     3  it reports RESIDENTS and BUSINESSES separately;
     4  the counts it printed equal a census this file computes ITSELF out of
        MythicPlotMood.all() — i.e. the reaction is a regrouping of the shipped
        per-tile verdict and not a second mood model;
     5  a six-tile road drag produces ONE reaction, not six;
     6  the chrome passes the theme bar's measurable tests (blue channel not
        over red by >8/255, border-radius ≤ 6px, heading resolves to a serif).

   RED MUTATION at the end: stub MythicPlotMood.all() to return [] and confirm
   the reaction reports nothing rather than inventing a face.
   ══════════════════════════════════════════════════════════════════════════ */
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const REPO = 'D:/game-deploy';
const ROOT = path.resolve(REPO, 'public');
const THREE_DIR = path.resolve(REPO, '.gauntlet/three171');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.glb': 'model/gltf-binary', '.txt': 'text/plain', '.webp': 'image/webp' };
const PORT = 8790 + (process.pid % 70);

const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p.startsWith('/__three/')) {
    const f = path.join(THREE_DIR, p.slice('/__three/'.length));
    if (fs.existsSync(f)) { res.writeHead(200, { 'Content-Type': 'text/javascript' }); return fs.createReadStream(f).pipe(res); }
    res.writeHead(404); return res.end('nf');
  }
  if (p.endsWith('/')) p += 'index.html';
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end('nf'); }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
});
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));

const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
         '--ignore-gpu-blocklist', '--no-sandbox', '--disable-dev-shm-usage'],
});
const page = await browser.newPage({ viewport: { width: 1400, height: 860 } });
await page.route('**/*', (route) => {
  const u = route.request().url();
  if (u.includes('cdn.jsdelivr.net') && u.includes('three@')) {
    const rel = new URL(u).pathname.replace(/^\/npm\/three@[^/]+\//, '');
    const f = path.join(THREE_DIR, rel);
    return fs.existsSync(f)
      ? route.fulfill({ status: 200, contentType: 'text/javascript', body: fs.readFileSync(f) })
      : route.fulfill({ status: 404, body: 'no vendored three' });
  }
  if (u.includes('127.0.0.1') || u.includes('localhost')) return route.continue();
  if (u.includes('fonts.googleapis') || u.includes('fonts.gstatic')) return route.abort();
  return route.abort();
});
const logs = [];
page.on('console', (m) => logs.push(m.type() + ': ' + m.text().slice(0, 160)));
page.on('pageerror', (e) => logs.push('pageerror: ' + String(e).slice(0, 160)));

await page.goto(`http://127.0.0.1:${PORT}/node-city/index.html`, { waitUntil: 'domcontentloaded', timeout: 90000 });
await page.waitForFunction('!!window.__nc', null, { timeout: 90000 }).catch(() => {});
await page.waitForTimeout(9000);
await page.evaluate(() => {
  window.__ncModals = 0;
  setInterval(() => { const b = document.querySelector('#ncconfirm [data-ncc="1"]'); if (b) { window.__ncModals++; b.click(); } }, 8);
});

let fails = 0;
const ok = (n, c, d) => { if (!c) fails++; console.log((c ? '  PASS ' : '  FAIL ') + n + (d == null ? '' : '   ' + d)); };

/* ── 1. a board with both audiences on it ─────────────────────────────────── */
const built = await page.evaluate(async () => {
  const nc = window.__nc, B = window.MythicCityBridge;
  if (B) { B.spendCinders = async () => true; B.spendRes = async () => true; B.getCinders = async () => 9e9; B.getRes = async () => 9e9; B.addCinders = async () => true; }
  const _c = window.confirm; window.confirm = () => true;
  const put = async (t, x, z) => { await nc.place(t, x, z); try { nc.build.finishAll('drive'); } catch (e) {} };
  for (let x = 4; x <= 18; x++) await put('road', x, 12);
  await put('housing', 6, 11);
  await put('housing', 8, 11);
  await put('housing', 10, 11);
  window.confirm = _c;
  nc.game.army.workers = 8;
  await nc.step(0.5, 1);
  return { tiles: Object.keys(nc.game.tiles).length,
           judged: window.MythicPlotMood ? window.MythicPlotMood.report().judged : null };
});
console.log('board: ' + built.tiles + ' tiles, ' + built.judged + ' judged plots');

/* ── 2. THE LAYER IS OFF, AND A PLACEMENT STILL REACTS ────────────────────── */
console.log('\n1–3. layer OFF, place a shop, does anything happen?');
const shot = await page.evaluate(async () => {
  const nc = window.__nc, I = window.MythicPlotIcons;
  I.hide();
  const layerOff = !I.visible();
  const meshOff = !!(I.mesh() && I.mesh().visible === false);
  const before = I.reactStats();
  const _c = window.confirm; window.confirm = () => true;
  // a business the player would actually drop next to those houses
  let type = null;
  for (const ty of ['grocery', 'market', 'restaurant', 'shop', 'foodtruck', 'club'])
    if (nc.BUILDINGS[ty]) { type = ty; break; }
  if (!type) for (const ty in nc.BUILDINGS) { const d = nc.BUILDINGS[ty]; if (d && (d.gen || d.prod || d.svc)) { type = ty; break; } }
  await nc.place(type, 7, 13);
  try { nc.build.finishAll('drive'); } catch (e) {}
  window.confirm = _c;
  await new Promise((r) => setTimeout(r, 500));
  const el = document.getElementById('pmreact');
  const cs = el ? getComputedStyle(el) : null;
  return {
    type, layerOff, meshOff,
    stats: I.reactStats(), was: before,
    r: I.reaction(),
    dom: el ? { shown: cs.display !== 'none' && +cs.opacity > 0.5, text: el.innerText,
                bg: cs.backgroundColor, radius: cs.borderTopLeftRadius,
                hdFont: (() => { const h = el.querySelector('.pmr-hd'); return h ? getComputedStyle(h).fontFamily : null; })(),
                rows: el.querySelectorAll('.pmr-row').length } : null,
  };
});
console.log('   placed: ' + shot.type + ' · reaction object: ' + JSON.stringify(shot.r && { home: shot.r.home, biz: shot.r.biz, placed: shot.r.placed }));
console.log('   chip text: ' + JSON.stringify(shot.dom && shot.dom.text));
ok('layer is OFF and the mesh is invisible', shot.layerOff && shot.meshOff);
ok('a reaction was produced anyway', !!shot.r && shot.stats.pulses > shot.was.pulses, 'pulses ' + shot.was.pulses + ' → ' + shot.stats.pulses);
ok('the chip is on screen', !!(shot.dom && shot.dom.shown), shot.dom && ('display/opacity ok, rows=' + shot.dom.rows));
ok('BOTH audiences are reported', !!(shot.dom && /RESIDENT/i.test(shot.dom.text) && /BUSINESS/i.test(shot.dom.text)));
ok('each audience carries a face', !!(shot.r && shot.r.home.glyph && shot.r.biz.glyph),
   shot.r && (shot.r.home.glyph + ' / ' + shot.r.biz.glyph));

/* ── 4. THE COUNTS ARE THE SHIPPED VERDICT, REGROUPED ─────────────────────── */
console.log('\n4. is it a regrouping of MythicPlotMood, or a second model?');
const mine = await page.evaluate(() => {
  const rows = window.MythicPlotMood.all();
  const z = () => ({ n: 0, ok: 0, meh: 0, bad: 0 });
  const c = { home: z(), biz: z() };
  for (const v of rows) { const g = v.kind === 'home' ? c.home : c.biz; g.n++; g[v.face === 'ok' ? 'ok' : v.face === 'meh' ? 'meh' : 'bad']++; }
  return { c, r: window.MythicPlotIcons.reaction() };
});
const same = (a, b) => a && b && a.n === b.n && a.ok === b.ok && a.meh === b.meh && a.bad === b.bad;
console.log('   independent census: ' + JSON.stringify(mine.c));
ok('residents count matches an independent census', same(mine.c.home, mine.r.after.home));
ok('businesses count matches an independent census', same(mine.c.biz, mine.r.after.biz));

/* ── 5. ONE GESTURE, ONE REACTION ─────────────────────────────────────────── */
console.log('\n5. a six-tile road drag');
const drag = await page.evaluate(async () => {
  const nc = window.__nc, I = window.MythicPlotIcons;
  const before = I.reactStats();
  const _c = window.confirm; window.confirm = () => true;
  for (let z = 6; z <= 11; z++) { await nc.place('road', 14, z); try { nc.build.finishAll('drive'); } catch (e) {} }
  window.confirm = _c;
  await new Promise((r) => setTimeout(r, 1200));
  return { before, after: I.reactStats(), r: I.reaction() };
});
console.log('   armed ' + drag.before.armed + '→' + drag.after.armed + ' · pulses ' + drag.before.pulses + '→' + drag.after.pulses + ' · coalesced ' + drag.before.coalesced + '→' + drag.after.coalesced);
ok('every tile armed the reaction', drag.after.armed - drag.before.armed === 6);
ok('but only ONE reaction was reported', drag.after.pulses - drag.before.pulses === 1);

/* ── 6. THE THEME BAR'S MEASURABLE TESTS ──────────────────────────────────── */
console.log('\n6. chrome, measured');
const px = (s) => parseFloat(String(s)) || 0;
const rgb = (s) => (String(s).match(/[\d.]+/g) || []).map(Number);
const c = rgb(shot.dom.bg);
ok('chrome is not violet (blue ≤ red + 8)', c[2] <= c[0] + 8, shot.dom.bg);
ok('border-radius ≤ 6px', px(shot.dom.radius) <= 6, shot.dom.radius);
ok('the heading resolves to a serif', /cinzel|serif/i.test(shot.dom.hdFont || ''), shot.dom.hdFont);
const wide = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
ok('no horizontal overflow', wide);

await page.screenshot({ path: path.resolve(REPO, '.gauntlet/_placereact.png') });

/* ── 7. GEOMETRY: THE CHIP MUST NOT SHARE A COLUMN WITH THE TOAST STACK ─────
   The shipped driver checked that the chip EXISTS and never checked where. It
   sat at left:50%/bottom:150px, i.e. in #toasts' own column (bottom-centred,
   z-index 9850 — above the chip, correctly, because a toast must never be
   hidden). MEASURED at 1400×860 before this fix: 2 toasts covered 430×26px of
   the chip and 4 toasts covered 262×62px (48.8%), eating the BUSINESSES row and
   the .pmr-foot reason line — so the "two audiences, separately" the bar's §6b
   asks for degraded to one under a routine toast burst. This asserts the
   intersection rect is literally 0×0, with FOUR toasts up, at three viewports
   and in both the plain and dossier states — and against #buildbar too, which
   is the other tenant of the bottom gutter.

   🔴 AND AGAINST #npw-intro, WHICH IS WHY THIS SECTION EXISTED AND STILL MISSED.
   The sideways move was validated against #leftcol — and #leftcol is
   `display:none` (node-city's permanent STASH), so its rect is 0×0 at every
   viewport and it can never intersect anything. The corner's REAL first-run
   tenant is the power welcome card, and MEASURED at 1400×860 on a first entry
   the chip covered 340×144 of it — 100%, body text and BOTH buttons, for the
   full 3.6s hold. So the card is now PUT UP for every geometry pass (through
   MythicPower.lines.intro, the shipped seam, not a hand-built div) and asserted
   against, and the #leftcol band is gone: a worst-case box for an element that
   is never displayed proved nothing and read like coverage.
   ⚠ 820×720 IS IN THE LIST NOW. Below ~996px the chip's `min-width:236px` beats
   its `max-width:calc(50vw − 262px)`, so the arithmetic that kept it out of the
   toast column stops holding: measured ∩ .toast = 43×46 at 820, clipping the
   RESIDENTS delta and covering the BUSINESSES one. 820 is node-city's own
   narrowest breakpoint (@media max-width:820px), so it is a shipped width. */
console.log('\n7. geometry — #pmreact vs #toasts / #buildbar / #npw-intro, measured');
const geom = async (w, h, insOpen) => {
  await page.setViewportSize({ width: w, height: h });
  await page.waitForTimeout(180);
  return page.evaluate(async (ins) => {
    document.body.classList.toggle('ins-open', !!ins);
    const nc = window.__nc, I = window.MythicPlotIcons;
    /* The first-run power card, through its own test seam so this measures the
       SHIPPED card (its real size, position and z-index) and not a stand-in.
       reset() first: maybeShow() is once-per-session and localStorage-gated, so
       without it only the first of the six passes would have a card up and the
       other five would report a hollow 0×0 pass. */
    try { const P = window.MythicPower && window.MythicPower.lines && window.MythicPower.lines.intro;
          if (P) { P.reset(); P.show(); } } catch (e) {}
    I.reactHide();   // clear the previous pass BEFORE, so the chip is still up
                     // for the screenshot the caller takes after this returns
    const _c = window.confirm; window.confirm = () => true;
    /* A fresh tile each pass, on the z=13 row so it is road-adjacent to the
       z=12 strip built in step 1 — a refused placement fires NO reaction, and
       this would then silently measure a hidden chip. reactStats() below is
       what turns that into a failure instead. */
    window.__geomN = (window.__geomN || 0) + 1;
    const pulse0 = I.reactStats().pulses;
    /* ONE FRESH TILE PER PASS, and the list must be at least as long as the
       pass count (3 viewports × 2 modes = 6). It was four long when there were
       four passes; adding 820×720 made passes 5 and 6 re-place on an occupied
       tile, tryPlace refused, and the "reacted" assertion failed with the
       geometry silently measuring a hidden chip. x=7 is the shop from step 2. */
    await nc.place('housing', [5, 9, 11, 13, 15, 17][(window.__geomN - 1) % 6], 13);
    try { nc.build.finishAll('drive'); } catch (e) {}
    window.confirm = _c;
    /* Four toasts is the routine case — a placement commonly fires a cost, a
       refusal and an achievement in the same beat. They are injected straight
       into #toasts rather than through toast(): that function is module-scoped
       (not on __nc) and caps the rail at TOAST_MAX, and this wants the WORST
       geometry the stack can present, not the typical one. */
    const box = document.getElementById('toasts');
    if (box) { box.innerHTML = ''; for (let i = 0; i < 4; i++) {
      const t = document.createElement('div'); t.className = 'toast';
      t.textContent = 'Placement toast line ' + (i + 1) + ' — a routine message';
      box.appendChild(t); } }
    /* POLL, do not sleep a fixed amount. The pulse waits REACT.coalesceMs (150)
       for the gesture to end but defers up to maxWaitMs (900) while ticks keep
       re-arming it, and only then runs a 280ms opacity transition. A flat 900ms
       wait read the chip mid-fade at 1024×640 and called a visible chip hidden.
       Cap well under holdMs (3600) so this can never observe the fade-OUT. */
    const el0 = () => document.getElementById('pmreact');
    for (let i = 0; i < 120 && !(el0() && +getComputedStyle(el0()).opacity > 0.99
                                 && getComputedStyle(el0()).display !== 'none'); i++)
      await new Promise((r) => setTimeout(r, 20));
    const R = (s) => { const e = document.querySelector(s); if (!e) return null;
      const b = e.getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height, r: b.right, bt: b.bottom }; };
    const inter = (a, b) => (!a || !b || !a.w || !b.w) ? { w: 0, h: 0 }
      : { w: Math.max(0, Math.min(a.r, b.r) - Math.max(a.x, b.x)),
          h: Math.max(0, Math.min(a.bt, b.bt) - Math.max(a.y, b.y)) };
    const chip = R('#pmreact'), toasts = R('#toasts'), bar = R('#buildbar'), npw = R('#npw-intro');
    /* #leftcol used to be measured here as a hand-built "worst case" box. It is
       gone on purpose: #leftcol is `display:none` in node-city (the permanent
       STASH), so the band could never occur, and reporting an intersection
       against a synthetic rect for an element that is never on screen is how
       the corner's real tenant went unmeasured for a whole round. If #leftcol
       is ever displayed again its LIVE rect will be non-zero and belongs in the
       R_TENANTS list in overlay.js, not in a constant here. */
    const hint = R('#ctrlhint');
    const shown = (() => { const e = document.getElementById('pmreact'); const cs = e && getComputedStyle(e);
      return !!cs && cs.display !== 'none' && +cs.opacity > 0.5; })();
    const out = { shown, chip, toasts, bar, hint, npw, pulsed: I.reactStats().pulses > pulse0,
                  nToast: document.querySelectorAll('#toasts .toast').length,
                  vsToast: inter(chip, toasts), vsBar: inter(chip, bar),
                  vsNpw: inter(chip, npw), vsHint: inter(chip, hint),
                  overflow: document.documentElement.scrollWidth <= window.innerWidth + 1 };
    return out;
  }, insOpen);
};
for (const [w, h] of [[1400, 860], [1024, 640], [820, 720]]) {
  for (const ins of [false, true]) {
    const g = await geom(w, h, ins);
    const tag = w + '×' + h + (ins ? ' ins-open' : ' plain');
    await page.screenshot({ path: path.resolve(REPO, '.gauntlet/_placereact-' + w + (ins ? '-ins' : '') + '.png') });
    console.log('   ' + tag + ' · chip ' + JSON.stringify(g.chip) + ' · toasts(' + g.nToast + ') ' + JSON.stringify(g.toasts));
    console.log('        buildbar ' + JSON.stringify(g.bar) + ' · ctrlhint ' + JSON.stringify(g.hint));
    console.log('        npw-intro ' + JSON.stringify(g.npw)
                + ' · ∩ #ctrlhint ' + g.vsHint.w.toFixed(0) + '×' + g.vsHint.h.toFixed(0));
    ok(tag + ': the placement actually reacted', g.pulsed);
    ok(tag + ': chip is on screen', g.shown);
    ok(tag + ': #pmreact ∩ #toasts is 0×0', g.vsToast.w === 0 || g.vsToast.h === 0,
       g.vsToast.w.toFixed(1) + '×' + g.vsToast.h.toFixed(1));
    ok(tag + ': #pmreact ∩ #buildbar is 0×0', g.vsBar.w === 0 || g.vsBar.h === 0,
       g.vsBar.w.toFixed(1) + '×' + g.vsBar.h.toFixed(1));
    /* The first-run card must BE there, or "0×0" is the trivial pass that hid
       this bug in the first place. */
    ok(tag + ': the first-run power card is up to be measured against', !!g.npw && g.npw.w > 0 && g.npw.h > 0);
    ok(tag + ': #pmreact ∩ #npw-intro is 0×0', g.vsNpw.w === 0 || g.vsNpw.h === 0,
       g.vsNpw.w.toFixed(1) + '×' + g.vsNpw.h.toFixed(1));
    ok(tag + ': chip is inside the viewport', !!g.chip && g.chip.x >= 0 && g.chip.r <= w + 1 && g.chip.y >= 0 && g.chip.bt <= h + 1);
    ok(tag + ': no horizontal overflow', g.overflow);
  }
}
await page.setViewportSize({ width: 1400, height: 860 });
await page.evaluate(() => { document.body.classList.remove('ins-open');
                            const b = document.getElementById('toasts'); if (b) b.innerHTML = '';
                            /* put the corner back before the RED pass, or the
                               chip is measured stacked and the mutation reads
                               like a position bug rather than a missing model */
                            try { window.MythicPower.lines.intro.dismiss(); } catch (e) {} });

/* ── RED MUTATION ─────────────────────────────────────────────────────────── */
console.log('\nRED: starve the reaction of the verdict module');
const red = await page.evaluate(async () => {
  const nc = window.__nc, I = window.MythicPlotIcons, PM = window.MythicPlotMood;
  I.reactHide();
  const real = PM.all;
  PM.all = () => [];
  const before = I.reactStats();
  const _c = window.confirm; window.confirm = () => true;
  await nc.place('housing', 12, 11);
  try { nc.build.finishAll('drive'); } catch (e) {}
  window.confirm = _c;
  await new Promise((r) => setTimeout(r, 500));
  const el = document.getElementById('pmreact');
  const shown = el ? (getComputedStyle(el).display !== 'none' && +getComputedStyle(el).opacity > 0.5) : false;
  const after = I.reactStats();
  PM.all = real;
  return { shown, skipped: after.skipped - before.skipped, pulses: after.pulses - before.pulses };
});
ok('with no judged plots the chip stays silent', !red.shown && red.skipped === 1 && red.pulses === 0, JSON.stringify(red));

console.log('\nlogs (last 8): ' + logs.slice(-8).join(' | '));
console.log(fails ? '\nRED: ' + fails + ' failures' : '\nGREEN');
await browser.close(); server.close();
