/* ══════════════════════════════════════════════════════════════════════════
   NULL FIELD PERF — what v185 added to the hottest predicate in the engine.

   v185 put this line inside hasPassive():
       if (typeof _nullFieldOff === 'function' && _nullFieldOff(unit)) return false;
   hasPassive is called for every stat read, every legality test, every AI
   candidate. _nullFieldOff ignores its argument and calls _nullFieldSrc(null),
   memoised on App.state.units BY IDENTITY.

   So the cost is entirely a question of MEMO HIT RATE, and there are two
   regimes worth separating, because they behave differently:
     · no Null Field anywhere (what every ordinary match looks like) — the
       scan runs, finds nothing, and caches null;
     · the memo key CHANGING — the engine is immutable-style and rebuilds
       s.units on every board change, so each change re-scans every unit and
       resolves each one's card definition.

   This measures hasPassive with the memo warm, and with the key invalidated
   between every call (the worst case the engine can actually produce), at
   several board sizes. A per-call cost that grows with the number of units is
   the thing that turns a busy late-game board into a frozen tab.

   Usage: node .gauntlet/nullfield-perf.mjs [root]
   ══════════════════════════════════════════════════════════════════════════ */
import { chromium } from 'playwright';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';

const ROOT = path.resolve(process.argv[2] || 'C:/r185/public');
const MIME = { '.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.jsx':'text/babel','.css':'text/css','.json':'application/json','.png':'image/png','.jpg':'image/jpeg','.svg':'image/svg+xml','.webp':'image/webp','.txt':'text/plain','.wav':'audio/wav','.mp3':'audio/mpeg','.glb':'model/gltf-binary' };
const PORT = 9800 + Math.floor(Math.random() * 90);
const srv = http.createServer((q, r) => {
  let p = decodeURIComponent(q.url.split('?')[0]); if (p.endsWith('/')) p += 'index.html';
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end('nf'); }
  r.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(r);
});
await new Promise(r => srv.listen(PORT, '127.0.0.1', r));

const browser = await chromium.launch({ args: ['--no-sandbox', '--enable-precise-memory-info'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.addInitScript(() => { try { localStorage.setItem('mg_onboarded', '1'); } catch (e) {} });
await page.route('**/*', r => {
  const u = r.request().url();
  return (u.includes('127.0.0.1') || u.includes('fonts.g') || u.includes('cdn.jsdelivr') || u.includes('cdnjs')) ? r.continue() : r.abort();
});
await page.goto('http://127.0.0.1:' + PORT + '/index.html', { waitUntil: 'domcontentloaded', timeout: 180000 });
await page.waitForFunction('typeof initGame === "function"', null, { timeout: 180000 });
await page.evaluate(() => { try { const g = document.getElementById('auth-gate'); if (g) g.remove(); } catch (e) {} });
await page.waitForTimeout(2500);

const out = await page.evaluate(() => {
  const R = { rows: [], notes: [] };
  if (typeof window._nullFieldSrc !== 'function') { R.notes.push('no _nullFieldSrc — pre-v185 build'); }

  App.battlePrep = App.battlePrep || {};
  const me = findHeroById(STARTER_HEROES[0].id), foe = findHeroById(STARTER_HEROES[1].id);
  App.battlePrep.hero = me; App.battlePrep.multiplayer = false;
  App.state = initGame(me, foe, [], true, null);
  const s = App.state;
  const seed = JSON.parse(JSON.stringify(s.units[0]));

  const fill = (n) => {
    const units = s.units.slice(0, 2);
    for (let i = 0; i < n; i++) {
      const u = JSON.parse(JSON.stringify(seed));
      u.id = 'perf-' + i; u.isHero = false; u.owner = (i % 2) ? 'ai' : 'player';
      u.x = i % 6; u.z = 2 + (i % 3);
      units.push(u);
    }
    s.units = units;            // NEW array identity — exactly what the engine does
    return s.units[2] || s.units[0];
  };

  const time = (fn, iters) => {
    fn(); // warm
    const a = performance.now();
    for (let i = 0; i < iters; i++) fn();
    return Math.round(((performance.now() - a) / iters) * 1000000) / 1000; // µs per call
  };

  for (const n of [0, 8, 16, 32, 64]) {
    const u = fill(n);
    const total = s.units.length;

    /* A. memo WARM — the normal case between board changes */
    const warm = time(() => { hasPassive(u, 'flying'); }, 20000);

    /* B. memo key INVALIDATED before each call — what every board change costs.
       Swapping in a fresh array copy is precisely what the engine's immutable
       rebuild does, so this is a real regime, not a synthetic one. */
    let cold = null;
    if (typeof window._nullFieldSrc === 'function') {
      cold = time(() => { s.units = s.units.slice(); hasPassive(u, 'flying'); }, 2000);
    }

    /* C. the same invalidation WITHOUT hasPassive, so the array copy's own
          cost is subtracted rather than blamed on Null Field. */
    const copyOnly = time(() => { s.units = s.units.slice(); }, 2000);

    R.rows.push({ units: total, warmUs: warm, coldUs: cold, copyUs: copyOnly,
                  nullCostUs: (cold != null) ? Math.round((cold - copyOnly) * 1000) / 1000 : null });
  }

  /* Does a Null Field actually on the board change the cost? */
  R.notes.push('units field sizes measured with NO null-field card present (the ordinary match)');
  return R;
});

console.log('══ NULL FIELD PERF  root=' + ROOT + ' ══\n');
console.log('  board units   hasPassive warm      hasPassive after a board change');
console.log('                (µs/call)            (µs/call)    minus array-copy cost');
for (const r of out.rows) {
  console.log('  ' + String(r.units).padStart(8) + '   ' + String(r.warmUs).padStart(10) + ' µs   ' +
    String(r.coldUs ?? '-').padStart(14) + ' µs   ' + String(r.nullCostUs ?? '-').padStart(10) + ' µs');
}
const f = out.rows[0], l = out.rows[out.rows.length - 1];
if (f && l && f.nullCostUs != null && l.nullCostUs != null) {
  console.log('\n  scan cost at ' + f.units + ' units: ' + f.nullCostUs + ' µs   →   at ' + l.units + ' units: ' + l.nullCostUs + ' µs');
  const ratio = f.nullCostUs > 0 ? Math.round((l.nullCostUs / f.nullCostUs) * 100) / 100 : null;
  console.log('  growth with board size: x' + ratio + (ratio && ratio > 3 ? '   ⚠ scales with the board' : '   (flat enough)'));
}
if (f && l) {
  const wr = f.warmUs > 0 ? Math.round((l.warmUs / f.warmUs) * 100) / 100 : null;
  console.log('  warm-path growth: x' + wr + (wr && wr > 2 ? '  ⚠ even the memo HIT scales' : '  (memo hit is O(1), as intended)'));
}
for (const n of out.notes) console.log('  note: ' + n);
await browser.close(); srv.close();
