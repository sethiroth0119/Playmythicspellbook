/* ══════════════════════════════════════════════════════════════════════════
   CRIT-P5-ROUND2 — an INDEPENDENT critic pass over "the frown has to be
   actionable, and the panel has to agree with itself".

   The builder's own driver compares the DOM against __nc.plotMood(). Those are
   the SAME function (plotMoodAt), so that check is a printer check and cannot
   catch a figure that is wrong in both. This driver asks the questions that
   check is structurally blind to:

     A  THE ROOF-GLYPH CLAUSE. The card says "and the 😟 glyph over the roof is
        reading X" only when pmLayerOn() is true, and pmLayerOn() reads
        MythicPlotMood.layerVisible(). /src/plotmood/index.js says in its own
        header (line ~95) that overlay.js TAKES the painter and the THREE.Points
        cloud is NEVER created in a normal boot — so layerVisible() is false
        whatever the player can see. Turn the REAL badge layer on
        (MythicPlotIcons), prove badges are drawn with a framebuffer A/B done
        the legal way, then ask whether the clause appears.

     B  THE NUMBERS AGAINST THEIR TRUE SOURCES, recomputed HERE and not read
        back off the same helper the card used.

     C  THE FIX SENTENCE AGREES WITH ITS OWN HEADLINE NUMBER.

     D  REACTIVITY: place the thing the card asked for, re-open, watch it move.

   Run: node .gauntlet/crit-p5-round2.mjs
   ══════════════════════════════════════════════════════════════════════════ */
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(process.cwd(), 'public');
const THREE_DIR = path.resolve(process.cwd(), '.gauntlet/three171');
const SHOTS = path.resolve(process.cwd(), '.gauntlet/shots/critp5r2');
fs.mkdirSync(SHOTS, { recursive: true });

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.glb': 'model/gltf-binary', '.txt': 'text/plain', '.webp': 'image/webp' };

const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p.endsWith('/')) p += 'index.html';
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end('nf'); }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const PORT = server.address().port;

const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
         '--ignore-gpu-blocklist', '--no-sandbox', '--disable-dev-shm-usage'],
});
let fails = 0;
const ok = (name, cond, detail) => { if (!cond) fails++;
  console.log((cond ? '  PASS ' : '  FAIL ') + name + (detail == null ? '' : '   ' + detail)); };

try {
const page = await browser.newPage({ viewport: { width: 1400, height: 860 } });
await page.route('**/*', (route) => {
  const u = route.request().url();
  if (u.includes('cdn.jsdelivr.net') && u.includes('three@')) {
    const rel = new URL(u).pathname.replace(/^\/npm\/three@[^/]+\//, '');
    const f = path.join(THREE_DIR, rel);
    return fs.existsSync(f)
      ? route.fulfill({ status: 200, contentType: 'text/javascript', body: fs.readFileSync(f) })
      : route.fulfill({ status: 404, body: 'no vendored three at ' + rel });
  }
  if (u.includes('127.0.0.1') || u.includes('localhost')) return route.continue();
  return route.abort();
});
const logs = [];
page.on('console', (m) => logs.push(m.type() + ': ' + m.text().slice(0, 200)));
page.on('pageerror', (e) => logs.push('pageerror: ' + String(e).slice(0, 200)));

await page.goto('http://127.0.0.1:' + PORT + '/node-city/index.html', { waitUntil: 'domcontentloaded', timeout: 90000 });
await page.waitForFunction('!!window.__nc', null, { timeout: 90000 }).catch(() => {});
await page.waitForTimeout(9000);

console.log('\n0. boot');
const b0 = await page.evaluate(() => ({
  nc: !!window.__nc,
  pm: !!(window.MythicPlotMood && window.MythicPlotMood.ready && window.MythicPlotMood.ready()),
  icons: !!window.MythicPlotIcons,
  tiles: window.__nc ? Object.keys(window.__nc.game.tiles).length : 0,
}));
console.log('   ' + JSON.stringify(b0));
ok('plotmood mounted and the glyph module is present', b0.pm && b0.icons);

/* ── seed a city with real problems ───────────────────────────────────── */
console.log('\n1. seed');
const seeded = await page.evaluate(async () => {
  const nc = window.__nc, B = nc.BUILDINGS, g = nc.game;
  for (const r in g.res) g.res[r] = 99999;
  try { g.wallet.cinder = 9e6; } catch (e) {}
  const raced = (p) => Promise.race([Promise.resolve(p), new Promise((r) => setTimeout(() => r(false), 1500))]);
  const pick = (fn) => Object.keys(B).find((t) => { const d = B[t];
    return d && !d.decor && !d.opType && !d.edgeOnly && (d.maxLvl == null || d.maxLvl > 0) && fn(d, t); });
  const home = pick((d) => (d.popCap | 0) > 0);
  const works = pick((d) => d.gen && !d.gen.cinder && !d.svc && !d.gen.power);
  const shop = pick((d) => d.gen && d.gen.cinder);
  const clinic = pick((d) => d.svc && d.svc.need === 'health');
  const lamp = pick((d) => d.lightRadius);
  const plan = [];
  const put = (t, x, z) => { if (t) plan.push({ type: t, x, z }); };
  for (let i = 0; i < 6; i++) put('road', 4 + i, 5);
  for (let i = 0; i < 4; i++) put(home, 4 + i, 4);
  put(works, 4, 6); put(shop, 8, 6); put(clinic, 4, 8); put(lamp, 8, 8);
  put(home, 16, 16); put(shop, 18, 18);
  for (const p of plan) {
    const k = p.x + ',' + p.z; if (g.tiles[k]) continue;
    try { await raced(nc.place(p.type, p.x, p.z)); } catch (e) {}
    if (!g.tiles[k]) g.tiles[k] = { type: p.type, lvl: 1 };
  }
  try { nc.coverage(); } catch (e) {}
  try { window.MythicPlotMood.invalidate('crit'); } catch (e) {}
  return { tiles: Object.keys(g.tiles).length, types: { home, works, shop, clinic, lamp } };
});
console.log('   ' + JSON.stringify(seeded));
await page.waitForTimeout(2500);

/* ── A. THE ROOF-GLYPH CLAUSE ─────────────────────────────────────────── */
console.log('\nA. the roof-glyph clause: is the layer the card asks about the layer the player sees?');
const layerOn = await page.evaluate(() => {
  const on = window.__nc.plotIconLayer(true);
  const rep = window.__nc.plotIcons();
  return { on, drawn: rep ? rep.drawn : null, source: rep ? rep.source : null,
           iconsVisible: (() => { try { return !!(window.MythicPlotIcons.mesh && window.MythicPlotIcons.mesh().visible); } catch (e) { return null; } })(),
           moodLayerVisible: window.MythicPlotMood.layerVisible(),
           moodMesh: !!window.MythicPlotMood.mesh() };
});
console.log('   ' + JSON.stringify(layerOn));

/* the legal A/B: render() between the two reads, drawImage in the SAME task */
const ab = await page.evaluate(async () => {
  const { renderer, scene, camera } = window.__nc.three();
  const cv = renderer.domElement;
  const W = 420, H = 300;
  const off = document.createElement('canvas'); off.width = W; off.height = H;
  const cx = off.getContext('2d', { willReadFrequently: true });
  const grab = () => { cx.clearRect(0, 0, W, H); cx.drawImage(cv, 0, 0, cv.width, cv.height, 0, 0, W, H);
    return cx.getImageData(0, 0, W, H).data; };
  const shot = (vis) => {           // ONE task: set, render, drawImage, read
    window.__nc.plotIconLayer(vis);
    window.__nc.plotIconRepaintForce ? window.__nc.plotIconRepaintForce() : null;
    renderer.render(scene, camera);
    return grab();
  };
  const onPx = shot(true);
  const offPx = shot(false);
  const onPx2 = shot(true);
  let diffOnOff = 0, diffOnOn = 0;
  for (let i = 0; i < onPx.length; i += 4) {
    if (Math.abs(onPx[i] - offPx[i]) + Math.abs(onPx[i + 1] - offPx[i + 1]) + Math.abs(onPx[i + 2] - offPx[i + 2]) > 24) diffOnOff++;
    if (Math.abs(onPx[i] - onPx2[i]) + Math.abs(onPx[i + 1] - onPx2[i + 1]) + Math.abs(onPx[i + 2] - onPx2[i + 2]) > 24) diffOnOn++;
  }
  window.__nc.plotIconLayer(true);
  return { pixels: (onPx.length / 4), diffOnOff, diffOnOn };
});
console.log('   framebuffer A/B (badges on vs off): changed=' + ab.diffOnOff +
            '  CONTROL (on vs on) = ' + ab.diffOnOn + '  of ' + ab.pixels + ' sampled px');
ok('the badge layer really is on screen (A/B moved, control is ~0)',
   ab.diffOnOff > 50 && ab.diffOnOn < ab.diffOnOff / 10, 'on/off=' + ab.diffOnOff + ' control=' + ab.diffOnOn);

const clause = await page.evaluate(() => {
  const nc = window.__nc, PM = window.MythicPlotMood;
  const out = { hardTiles: 0, wouldClaim: 0, claimed: 0, sample: null,
                moodLayerVisible: PM.layerVisible(), iconsDrawn: (nc.plotIcons() || {}).drawn };
  for (const m of PM.all()) {
    const v = nc.plotMoodKey(m.k);
    if (!v) continue;
    if (v.fromPill && v.base && v.base.reason !== 'ok') {
      out.wouldClaim++;
      nc.inspect(m.k);
      const card = document.getElementById('pmcard');
      const txt = card ? card.textContent : '';
      if (txt.indexOf('glyph over the roof') >= 0) out.claimed++;
      else if (!out.sample) out.sample = { k: m.k, reason: v.reason, base: v.base.reason,
        tail: txt.slice(txt.indexOf('Read live from')).slice(0, 150) };
    }
  }
  return out;
});
console.log('   ' + JSON.stringify(clause));
ok('with the badges VISIBLE, a card whose glyph disagrees with its headline says so',
   clause.wouldClaim === 0 || clause.claimed > 0,
   'cards that should claim=' + clause.wouldClaim + ' actually claimed=' + clause.claimed +
   ' · MythicPlotMood.layerVisible()=' + clause.moodLayerVisible + ' while badges drawn=' + clause.iconsDrawn);

/* ── B. THE NUMBERS AGAINST THEIR TRUE SOURCES ────────────────────────── */
console.log('\nB. every printed number recomputed from its source, here, not via the card helper');
const srcCheck = await page.evaluate(() => {
  const nc = window.__nc, PM = window.MythicPlotMood, g = nc.game, B = nc.BUILDINGS;
  const cov = nc.coverage() || {};
  const pct = (cov.pct) || (g.cov && g.cov.pct) || {};
  const isRoad = (t) => { try { return !!(window.MythicRoads && window.MythicRoads.isRoadType ? window.MythicRoads.isRoadType(t.type) : /^road/.test(String(t.type))); } catch (e) { return /^road/.test(String(t.type)); } };
  const site = (t) => !!(t && t.bld);
  const man = (k, x, z) => { const c = k.indexOf(','); return Math.abs((+k.slice(0, c)) - x) + Math.abs((+k.slice(c + 1)) - z); };
  const nearestRoad = (x, z) => { let best = null; for (const k in g.tiles) { const t = g.tiles[k];
      if (!t || t.damaged || site(t) || !isRoad(t)) continue; const d = man(k, x, z); if (d === 0) continue;
      if (best == null || d < best) best = d; } return best; };
  const nearestLamp = (x, z) => { let best = null; for (const k in g.tiles) { const t = g.tiles[k];
      if (!t || t.damaged || site(t)) continue; const d = B[t.type]; if (!d || !d.lightRadius) continue;
      const dd = man(k, x, z); if (dd === 0) continue; if (best == null || dd < best) best = dd; } return best; };
  const out = { checked: 0, bad: [], byReason: {} };
  for (const m of PM.all()) {
    const v = nc.plotMoodKey(m.k);
    if (!v) continue;
    const c = m.k.indexOf(','), x = +m.k.slice(0, c), z = +m.k.slice(c + 1);
    out.byReason[v.reason] = (out.byReason[v.reason] || 0) + 1;
    const printed = String(v.valueTxt);
    let expect = null;
    if (v.reason === 'road') { const d = nearestRoad(x, z); expect = d == null ? 'no roads' : (d + (d === 1 ? ' tile' : ' tiles')); }
    else if (v.reason === 'dark') { const d = nearestLamp(x, z); expect = d == null ? 'no lamps' : (d + (d === 1 ? ' tile' : ' tiles')); }
    else if (v.reason.indexOf('need:') === 0) { const n = v.reason.slice(5);
      expect = Math.round((+pct[n] || 0) * 100) + '%'; }
    else if (v.reason === 'power' || v.reason === 'brownout') {
      let f = null; try { const r = window.MythicPower.factorAt(x, z); f = (r && isFinite(r.factor)) ? r.factor : null; } catch (e) {}
      if (f == null) f = g.power.factor;
      expect = Math.round(f * 100) + '%'; }
    else if (v.reason === 'understaffed') { expect = null; }   // needs crewNeeded(), host-private
    if (expect != null) { out.checked++;
      if (printed !== expect) out.bad.push({ k: m.k, reason: v.reason, printed, expect }); }
  }
  return out;
});
console.log('   reasons on the board: ' + JSON.stringify(srcCheck.byReason));
console.log('   independently recomputed ' + srcCheck.checked + ' figures');
if (srcCheck.bad.length) console.log('   ' + JSON.stringify(srcCheck.bad.slice(0, 8)));
ok('every printed figure matches an INDEPENDENT recompute of its source',
   srcCheck.bad.length === 0, 'mismatches=' + srcCheck.bad.length + ' of ' + srcCheck.checked);

/* ── C. THE FIX SENTENCE AGREES WITH ITS OWN HEADLINE ─────────────────── */
console.log('\nC. the fix sentence quotes the same number as the headline');
const fixCheck = await page.evaluate(() => {
  const nc = window.__nc, PM = window.MythicPlotMood;
  const out = { checked: 0, bad: [], empty: [], nan: [] };
  for (const m of PM.all()) {
    const v = nc.plotMoodKey(m.k); if (!v) continue;
    const fix = String(v.fix || ''), txt = String(v.valueTxt || '');
    out.checked++;
    if (v.face === 'frown' && !fix.trim()) out.empty.push(m.k);
    if (/NaN|undefined|Infinity|null/.test(fix + ' ' + txt + ' ' + String(v.label))) out.nan.push({ k: m.k, fix: fix.slice(0, 60), txt });
    // distance reasons: the sentence names a distance; it must be the headline's
    if ((v.reason === 'road' || v.reason === 'dark' || v.reason === 'water') && /\d+ tiles?/.test(txt)) {
      const m2 = fix.match(/(\d+) tiles?/);
      if (!m2 || (m2[1] + ' tile' + (m2[1] === '1' ? '' : 's')) !== txt)
        out.bad.push({ k: m.k, reason: v.reason, headline: txt, inFix: m2 ? m2[0] : null, fix: fix.slice(0, 90) });
    }
    // percentage reasons: if the sentence quotes a %, one of them must be the headline
    if (/^\d+%$/.test(txt)) {
      const all = (fix.match(/\d+%/g) || []);
      if (all.length && all.indexOf(txt) < 0)
        out.bad.push({ k: m.k, reason: v.reason, headline: txt, inFix: all.join(','), fix: fix.slice(0, 90) });
    }
  }
  return out;
});
console.log('   checked ' + fixCheck.checked + ' cards');
if (fixCheck.bad.length) console.log('   ' + JSON.stringify(fixCheck.bad.slice(0, 6)));
ok('no frown with an empty fix', fixCheck.empty.length === 0, 'count=' + fixCheck.empty.length);
ok('no NaN / undefined / null reached a card', fixCheck.nan.length === 0, JSON.stringify(fixCheck.nan.slice(0, 3)));
ok('the fix sentence never quotes a different number than its own headline',
   fixCheck.bad.length === 0, 'count=' + fixCheck.bad.length);

/* ── D. REACTIVITY, driven by the card's own instruction ──────────────── */
console.log('\nD. do what the card says and watch the verdict move');
const react = await page.evaluate(async () => {
  const nc = window.__nc, PM = window.MythicPlotMood, g = nc.game, B = nc.BUILDINGS;
  const lamp = Object.keys(B).find((t) => B[t] && B[t].lightRadius && !B[t].decor);
  let target = null;
  for (const m of PM.all()) { const v = nc.plotMoodKey(m.k); if (v && v.reason === 'dark') { target = { k: m.k, v }; break; } }
  if (!target) return { ok: false, why: 'no dark tile to act on' };
  const c = target.k.indexOf(','), x = +target.k.slice(0, c), z = +target.k.slice(c + 1);
  const before = { reason: target.v.reason, num: target.v.valueTxt, face: target.v.face };
  // place a lamp two tiles away — exactly what the card asked for
  let spot = null;
  for (const d of [[1, 1], [2, 0], [0, 2], [-1, 1], [1, -1], [-2, 0], [0, -2]]) {
    const kk = (x + d[0]) + ',' + (z + d[1]);
    if (!g.tiles[kk] && x + d[0] >= 0 && z + d[1] >= 0) { spot = { k: kk, x: x + d[0], z: z + d[1] }; break; }
  }
  if (!spot) return { ok: false, why: 'nowhere to put a lamp' };
  const raced = (p) => Promise.race([Promise.resolve(p), new Promise((r) => setTimeout(() => r(false), 1500))]);
  try { await raced(nc.place(lamp, spot.x, spot.z)); } catch (e) {}
  if (!g.tiles[spot.k]) g.tiles[spot.k] = { type: lamp, lvl: 1 };
  // NO explicit invalidate: the placement seam is supposed to do it
  const after0 = nc.plotMoodKey(target.k);
  return { ok: true, k: target.k, placed: lamp + ' at ' + spot.k, before,
           after: after0 ? { reason: after0.reason, num: after0.valueTxt, face: after0.face } : null,
           moved: !!(after0 && (after0.reason !== before.reason || after0.valueTxt !== before.num)),
           report: PM.report ? { lastWhy: PM.report().lastWhy, gen: PM.report().gen } : null };
});
console.log('   ' + JSON.stringify(react));
ok('the verdict moved after a placement, with no manual invalidate',
   react.ok && react.moved, react.why || '');

/* ── E. the card, photographed ────────────────────────────────────────── */
const shotInfo = await page.evaluate(() => {
  const nc = window.__nc, PM = window.MythicPlotMood;
  for (const m of PM.all()) { const v = nc.plotMoodKey(m.k);
    if (v && v.face === 'frown') { nc.inspect(m.k); return { k: m.k, reason: v.reason, txt: v.valueTxt, fix: String(v.fix).slice(0, 120), limitedBy: v.limitedBy }; } }
  return null;
});
await page.waitForTimeout(600);
const el = await page.$('#pmcard');
if (el) await el.screenshot({ path: path.join(SHOTS, 'moodcard.png') });
await page.screenshot({ path: path.join(SHOTS, 'inspector-full.png') });
console.log('\nE. shot of ' + JSON.stringify(shotInfo));

/* ── F. frame cost ────────────────────────────────────────────────────── */
const cost = await page.evaluate(() => {
  const { renderer, scene, camera } = window.__nc.three();
  let n = 0; scene.traverse(() => n++);
  window.__nc.plotIconLayer(false); renderer.render(scene, camera);
  const offCalls = renderer.info.render.calls, offTris = renderer.info.render.triangles;
  window.__nc.plotIconLayer(true); renderer.render(scene, camera);
  const onCalls = renderer.info.render.calls, onTris = renderer.info.render.triangles;
  return { sceneObjects: n, offCalls, onCalls, offTris, onTris, cost: window.__nc.plotIconCost() };
});
console.log('\nF. frame cost: ' + JSON.stringify(cost));
ok('the badge layer costs ONE extra draw call', (cost.onCalls - cost.offCalls) <= 1,
   'delta=' + (cost.onCalls - cost.offCalls));

console.log('\n' + (fails ? fails + ' CHECK(S) FAILED' : 'ALL CHECKS PASSED'));
console.log('\nconsole tail:\n  ' + logs.slice(-8).join('\n  '));
} finally {
  await browser.close();
  server.close();
}
