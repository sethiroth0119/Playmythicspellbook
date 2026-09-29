/* ══════════════════════════════════════════════════════════════════════════
   CRIT-P5 — an INDEPENDENT audit of the "actionable frown" card.

   WHY THIS EXISTS AND IS NOT drive-moodwhy.mjs RE-RUN.
   drive-moodwhy compares the DOM against __nc.plotMood(x,z). Both of those
   are literally plotMoodAt(x,z) — the card calls it, the seam calls it. So a
   mismatch count of 0 proves the PRINTER (escaping, rounding, one formatter)
   and CANNOT prove the SCORER. If pmEnrich read the wrong cov key, or printed
   a distance to a tile that supplies nothing, the mismatch count would still
   be 0 and the panel would still be wrong.

   So this file re-derives every printed number FROM THE SOURCE STRING THE CARD
   ITSELF NAMES, in JS written here and not borrowed from the page, and
   compares. That is the "no figure disagrees with its own source" claim.

   Plus, independently:
     - a NaN / undefined / [object Object] / Infinity sweep over the rendered
       card text (not the object);
     - fix-sentence actionability: a frown whose sentence names no number and
       no building is a platitude, which is the failure mode this piece exists
       to prevent;
     - a placement A/B driven here: strand a building, read the verdict, pave a
       road, read it again — no reload;
     - frame cost: scene object count before/after the mood layer, against the
       576-tile control.
   ══════════════════════════════════════════════════════════════════════════ */
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(process.cwd(), 'public');
const THREE_DIR = path.resolve(process.cwd(), '.gauntlet/three171');
const SHOT = path.resolve(process.cwd(), '.gauntlet/shots/critp5');
fs.mkdirSync(SHOT, { recursive: true });

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.glb': 'model/gltf-binary', '.txt': 'text/plain', '.webp': 'image/webp' };

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
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const PORT = server.address().port;

const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
         '--ignore-gpu-blocklist', '--no-sandbox', '--disable-dev-shm-usage'],
});

let fails = 0;
const ok = (name, cond, detail) => {
  if (!cond) fails++;
  console.log((cond ? '  PASS ' : '  FAIL ') + name + (detail == null ? '' : '   ' + detail));
};

const page = await browser.newPage({ viewport: { width: 1400, height: 860 } });
const logs = [];
page.on('console', (m) => logs.push(m.type() + ': ' + m.text().slice(0, 200)));
page.on('pageerror', (e) => logs.push('pageerror: ' + String(e).slice(0, 200)));
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

try {
await page.goto('http://127.0.0.1:' + PORT + '/node-city/index.html', { waitUntil: 'domcontentloaded', timeout: 90000 });
await page.waitForFunction('!!window.__nc', null, { timeout: 90000 }).catch(() => {});
await page.waitForTimeout(9000);

console.log('\n0. boot');
const b0 = await page.evaluate(() => ({
  nc: !!window.__nc,
  pm: !!(window.MythicPlotMood && window.MythicPlotMood.ready()),
  api: !!(window.__nc && typeof window.__nc.plotMood === 'function'),
  pw: !!(window.__nc && typeof window.__nc.pwFactorOf === 'function'),
  eco: !!(window.MythicEconomy && window.MythicEconomy.ready && window.MythicEconomy.ready()),
  water: !!(window.MythicWater && window.MythicWater.ready && window.MythicWater.ready()),
}));
console.log('   ' + JSON.stringify(b0));
ok('seam + module up', b0.nc && b0.pm && b0.api);

/* ── 1. SEED. Independent of the builder's plan: I want at least one tile in
   each of road / dark / need:* / power / understaffed, plus one wreck. ── */
console.log('\n1. seed');
const seeded = await page.evaluate(async () => {
  const nc = window.__nc, B = nc.BUILDINGS, g = nc.game;
  for (const r in g.res) g.res[r] = 99999;
  try { g.wallet.cinder = 9e6; } catch (e) {}
  const raced = (p) => Promise.race([Promise.resolve(p), new Promise((r) => setTimeout(() => r(false), 1500))]);
  const pick = (fn) => Object.keys(B).find((t) => {
    const d = B[t]; return d && !d.decor && !d.opType && !d.edgeOnly && fn(d, t);
  });
  const home = pick((d) => (d.popCap | 0) > 0);
  const shop = pick((d) => d.gen && d.gen.cinder);
  const works = pick((d) => d.gen && !d.gen.cinder && !d.svc && !d.gen.power);
  const plan = [];
  for (let i = 0; i < 5; i++) plan.push({ type: 'road', x: 3 + i, z: 3 });
  for (let i = 0; i < 3; i++) plan.push({ type: home, x: 3 + i, z: 2 });
  plan.push({ type: shop, x: 6, z: 2 }); plan.push({ type: works, x: 3, z: 4 });
  // deliberately stranded — no road within 10 tiles
  plan.push({ type: home, x: 18, z: 18 }); plan.push({ type: shop, x: 20, z: 20 });
  const put = [];
  for (const p of plan) {
    if (!p.type) continue;
    const k = p.x + ',' + p.z; if (g.tiles[k]) continue;
    try { await raced(nc.place(p.type, p.x, p.z)); } catch (e) {}
    if (!g.tiles[k]) g.tiles[k] = { type: p.type, lvl: 1 };
    put.push(k);
  }
  const built = Object.keys(g.tiles).filter((k) => { const d = B[g.tiles[k].type]; return d && (d.popCap || d.gen || d.svc); });
  if (built[0]) g.tiles[built[0]].damaged = true;
  try { nc.coverage(); } catch (e) {}
  try { window.MythicPlotMood.invalidate('crit'); } catch (e) {}
  return { placed: put.length, wrecked: built[0] || null, tiles: Object.keys(g.tiles).length,
           types: { home, shop, works } };
});
console.log('   ' + JSON.stringify(seeded));
await page.waitForTimeout(2500);

/* ── 2. SOURCE-TRUTH. Re-derive every printed number here, from the source
   the card names, and compare to the printed string. ─────────────────── */
console.log('\n2. every printed number vs ITS OWN NAMED SOURCE (re-derived here)');
const audit = await page.evaluate(() => {
  const nc = window.__nc, g = nc.game, B = nc.BUILDINGS;
  const PM = window.MythicPlotMood;
  const out = { judged: 0, checked: 0, bad: [], unchecked: {}, reasons: {}, faces: {},
                platitudes: [], dirty: [], cardText: 0 };
  // --- independent re-implementations. Deliberately NOT the page's helpers. ---
  const pct = (v) => Math.round((Number(v) || 0) * 100) + '%';
  const tiles = (d) => (d | 0) + ((d | 0) === 1 ? ' tile' : ' tiles');
  const isRoad = (t) => { const d = B[t.type]; return !!(d && (d.road || t.type === 'road' || (d.tags && d.tags.road))) || /road|street|avenue|lane|path/i.test(String(t.type)); };
  const manhattanTo = (x, z, pred) => {
    let best = null;
    for (const k in g.tiles) {
      const t = g.tiles[k]; if (!t) continue;
      if (t.damaged) continue;
      if (t.bld && t.bld.k === 0) continue;   // a site supplies nothing
      const c = k.indexOf(','); const d = Math.abs((+k.slice(0, c)) - x) + Math.abs((+k.slice(c + 1)) - z);
      if (d === 0) continue;
      if (!pred(t, k)) continue;
      if (!best || d < best) best = d;
    }
    return best;
  };
  // staffingRatio, re-derived from the raw fields
  const myStaff = () => {
    let n = 0;
    for (const k in g.tiles) { const t = g.tiles[k]; const d = B[t.type];
      if (d && d.crew && !t.damaged && !(t.bld && t.bld.k === 0)) n += d.crew; }
    return n ? Math.min(1, g.army.workers / n) : 1;
  };

  const all = PM.all(); out.judged = all.length;
  for (const m of all) {
    const k = m.k, c = k.indexOf(',');
    const x = +k.slice(0, c), z = +k.slice(c + 1);
    const v = nc.plotMood(x, z); if (!v) continue;
    out.reasons[v.reason] = (out.reasons[v.reason] || 0) + 1;
    out.faces[v.face] = (out.faces[v.face] || 0) + 1;

    // ---- the rendered card, as text ----
    nc.inspect(k);
    const card = document.getElementById('pmcard');
    const txt = card ? (card.textContent || '') : '';
    if (txt) out.cardText++;
    if (/\bNaN\b|\bundefined\b|\[object Object\]|\bInfinity\b|\bnull\b/.test(txt))
      out.dirty.push({ k, snip: (txt.match(/.{0,40}(NaN|undefined|\[object Object\]|Infinity|null).{0,40}/) || [''])[0] });

    // ---- source truth ----
    const id = String(v.reason);
    let expect = null, how = null;
    if (id.indexOf('need:') === 0) {
      const n = id.slice(5);
      const cov = (g.cov && g.cov.pct) || {};
      expect = pct(Number.isFinite(+cov[n]) ? +cov[n] : 1); how = 'game.cov.pct.' + n + '=' + cov[n];
    } else if (id === 'power') {
      let f = null;
      try { const r = window.MythicPower.factorAt(x, z); f = (r && isFinite(r.factor)) ? r.factor : null; } catch (e) {}
      if (f === null) f = g.power.factor;
      expect = pct(f); how = 'MythicPower.factorAt=' + f;
    } else if (id === 'brownout') {
      const tf = nc.pwFactorOf(x, z);
      const f = Number.isFinite(tf) ? tf : g.power.factor;
      expect = pct(f); how = 'pwFactorOf=' + tf + ' cityFactor=' + g.power.factor;
    } else if (id === 'road') {
      const d = manhattanTo(x, z, (t) => isRoad(t));
      expect = d == null ? 'no roads' : tiles(d); how = 'manhattan-to-nearest-road=' + d;
    } else if (id === 'dark') {
      const d = manhattanTo(x, z, (t) => { const def = B[t.type]; return !!(def && def.lightRadius); });
      expect = d == null ? 'no lamps' : tiles(d); how = 'manhattan-to-nearest-lamp=' + d;
    } else if (id === 'water') {
      let d = null;
      try {
        const W = window.MythicWater;
        if (W && W.ready() && W.pipes && typeof W.pipes.keys === 'function') {
          for (const pk of W.pipes.keys()) {
            const cc = String(pk).indexOf(','); if (cc < 0) continue;
            const dd = Math.abs((+String(pk).slice(0, cc)) - x) + Math.abs((+String(pk).slice(cc + 1)) - z);
            if (d == null || dd < d) d = dd;
          }
        }
      } catch (e) {}
      expect = d == null ? 'no mains' : tiles(d); how = 'MythicWater.pipes nearest=' + d;
    } else if (id === 'understaffed') {
      expect = pct(myStaff()); how = 're-derived staffingRatio=' + myStaff();
    } else if (id === 'underfed') {
      const t = g.tiles[k]; const fed = t.svcFed == null ? 1 : t.svcFed;
      expect = pct(fed); how = 't.svcFed=' + t.svcFed;
    } else if (id === 'damaged') {
      expect = '0%'; how = 't.damaged=' + !!g.tiles[k].damaged;
    } else if (id === 'upgrading') {
      expect = '—'; how = 't.bld';
    } else if (id === 'ok') {
      expect = '100%'; how = 'no term below band';
    } else {
      out.unchecked[id] = (out.unchecked[id] || 0) + 1;
    }
    if (expect != null) {
      out.checked++;
      if (String(v.valueTxt) !== String(expect))
        out.bad.push({ k, reason: id, printed: String(v.valueTxt), expected: String(expect), how });
    }

    // ---- actionability: a frown must name a number OR a building ----
    if (v.face === 'frown') {
      const fx = String(v.fix || '');
      const hasNum = /\d/.test(fx);
      const namesThing = /build|pave|run |lay |repair|produce|import|demolish|raise|add /i.test(fx);
      if (!fx.trim() || (!hasNum && !namesThing))
        out.platitudes.push({ k, reason: id, fix: fx.slice(0, 70) });
    }
  }
  return out;
});
console.log('   judged ' + audit.judged + ' · cards rendered ' + audit.cardText + ' · numbers re-derived ' + audit.checked);
console.log('   reasons: ' + JSON.stringify(audit.reasons));
console.log('   faces:   ' + JSON.stringify(audit.faces));
if (Object.keys(audit.unchecked).length) console.log('   reasons I could NOT independently re-derive: ' + JSON.stringify(audit.unchecked));
ok('EVERY PRINTED NUMBER MATCHES ITS OWN NAMED SOURCE (re-derived independently)',
  audit.bad.length === 0, 'disagreements=' + audit.bad.length);
if (audit.bad.length) console.log('   ' + JSON.stringify(audit.bad.slice(0, 8), null, 1));
ok('no NaN / undefined / [object Object] in any rendered card',
  audit.dirty.length === 0, 'count=' + audit.dirty.length + (audit.dirty.length ? ' ' + JSON.stringify(audit.dirty.slice(0, 3)) : ''));
ok('every frown names a number or an action (no platitudes)',
  audit.platitudes.length === 0, 'count=' + audit.platitudes.length + (audit.platitudes.length ? ' ' + JSON.stringify(audit.platitudes.slice(0, 4)) : ''));

/* ── 3. THE PLACEMENT A/B, driven here, no reload ──────────────────────── */
console.log('\n3. place what the card said and watch the verdict move (same session)');
const ab = await page.evaluate(async () => {
  const nc = window.__nc, g = nc.game;
  const raced = (p) => Promise.race([Promise.resolve(p), new Promise((r) => setTimeout(() => r(false), 1500))]);
  // find a tile whose verdict is 'road'
  const all = window.MythicPlotMood.all();
  let target = null;
  for (const m of all) {
    const c = m.k.indexOf(',');
    const v = nc.plotMood(+m.k.slice(0, c), +m.k.slice(c + 1));
    if (v && v.reason === 'road') { target = { k: m.k, x: +m.k.slice(0, c), z: +m.k.slice(c + 1), before: v }; break; }
  }
  if (!target) return { skipped: 'no tile reported reason=road' };
  // read the printed card BEFORE
  nc.inspect(target.k);
  const beforeTxt = (document.getElementById('pmcard') || {}).textContent || '';
  // do exactly what it told the player: pave onto one of the four sides
  const sides = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  let paved = null;
  for (const [dx, dz] of sides) {
    const nx = target.x + dx, nz = target.z + dz, nk = nx + ',' + nz;
    if (g.tiles[nk]) continue;
    try { await raced(nc.place('road', nx, nz)); } catch (e) {}
    if (!g.tiles[nk]) g.tiles[nk] = { type: 'road', lvl: 1 };
    paved = nk; break;
  }
  try { nc.coverage(); } catch (e) {}
  try { window.MythicPlotMood.invalidate('crit-ab'); } catch (e) {}
  await new Promise((r) => setTimeout(r, 600));
  const after = nc.plotMood(target.x, target.z);
  nc.inspect(target.k);
  const afterTxt = (document.getElementById('pmcard') || {}).textContent || '';
  return { k: target.k, paved,
           beforeReason: target.before.reason, afterReason: after ? after.reason : null,
           beforeFace: target.before.face, afterFace: after ? after.face : null,
           beforeVal: target.before.valueTxt, afterVal: after ? after.valueTxt : null,
           domChanged: beforeTxt !== afterTxt,
           beforeSnip: beforeTxt.slice(0, 110), afterSnip: afterTxt.slice(0, 110) };
});
console.log('   ' + JSON.stringify(ab, null, 1));
ok('the verdict changed after doing what the card instructed — no reload',
  !ab.skipped && ab.beforeReason === 'road' && ab.afterReason !== 'road',
  ab.skipped || (ab.beforeReason + ' -> ' + ab.afterReason));
ok('and the rendered card text changed with it (CONTROL: same tile, same session)',
  !ab.skipped && ab.domChanged === true, 'domChanged=' + ab.domChanged);

/* ── 4. FRAME COST ─────────────────────────────────────────────────────── */
console.log('\n4. frame cost of the mood layer — one mesh, or 576?');
const cost = await page.evaluate(() => {
  const nc = window.__nc;
  const count = () => { let n = 0; try { nc.scene().traverse(() => n++); } catch (e) {} return n; };
  const off0 = (() => { try { nc.plotMoodLayer(false); } catch (e) {} return count(); })();
  const on1 = (() => { try { nc.plotMoodLayer(true); } catch (e) {} return count(); })();
  let meshInfo = null;
  try { const m = nc.plotMoodMesh(); meshInfo = m ? { isMesh: !!m.isMesh, type: m.type, isInstanced: !!m.isInstancedMesh, count: m.count | 0 } : null; } catch (e) {}
  const off2 = (() => { try { nc.plotMoodLayer(false); } catch (e) {} return count(); })();
  return { off0, on1, off2, delta: on1 - off0, meshInfo, gridTiles: 24 * 24 };
});
console.log('   ' + JSON.stringify(cost));
ok('the mood layer adds a handful of objects, not one per tile (control: 576 tiles)',
  cost.delta >= 0 && cost.delta < 20, 'delta=' + cost.delta + ' vs grid=' + cost.gridTiles);

/* ── 5. REACHABLE BY A PLAYER: a real click on a real tile ─────────────── */
console.log('\n5. reachable — open the dossier the way a player does');
await page.evaluate(() => { try { window.__nc.plotMoodLayer(true); } catch (e) {} });
const reach = await page.evaluate(() => {
  const nc = window.__nc;
  const all = window.MythicPlotMood.all();
  let frowned = null;
  for (const m of all) {
    const c = m.k.indexOf(',');
    const v = nc.plotMood(+m.k.slice(0, c), +m.k.slice(c + 1));
    if (v && v.face === 'frown') { frowned = m.k; break; }
  }
  if (!frowned) return { frowned: null };
  nc.inspect(frowned);
  const panel = document.getElementById('inspect') || document.getElementById('insbody');
  const card = document.getElementById('pmcard');
  const vis = panel ? getComputedStyle(panel).display !== 'none' && !panel.hidden : false;
  const r = card ? card.getBoundingClientRect() : null;
  return { frowned, panelVisible: vis, cardOnScreen: !!(r && r.width > 40 && r.height > 20),
           rect: r ? { w: Math.round(r.width), h: Math.round(r.height), t: Math.round(r.top) } : null,
           head: card ? (card.textContent || '').replace(/\s+/g, ' ').slice(0, 180) : '' };
});
console.log('   ' + JSON.stringify(reach, null, 1));
ok('a frowning tile opens a visible card with real size on screen',
  !!(reach.frowned && reach.cardOnScreen), JSON.stringify(reach.rect));
await page.screenshot({ path: path.join(SHOT, 'frowning-inspector.png') });
console.log('   screenshot: .gauntlet/shots/critp5/frowning-inspector.png');

console.log('\n--- console tail ---');
console.log('   ' + logs.filter(l => /error|pageerror|warn/i.test(l)).slice(-8).join('\n   '));
console.log('\n' + (fails ? fails + ' CHECK(S) FAILED' : 'ALL CRIT CHECKS PASSED'));
} catch (e) {
  console.log('DRIVER THREW: ' + (e && e.stack || e));
  fails++;
} finally {
  await browser.close(); server.close();
}
process.exit(fails ? 1 : 0);
