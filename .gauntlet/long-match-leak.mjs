/* ══════════════════════════════════════════════════════════════════════════
   LONG MATCH LEAK — what a match costs after sixty turns, not after one.

   Owner, 2026-09-19: "the game in the browser froze and crashed."

   Everything measured so far came back healthy in the SHORT term: the landing
   screen is flat over 3 minutes, the 2D screens cost +6MB over 66 visits, and
   ten full matches leak no WebGL context at all (the stage iframe is reused).
   What none of those reproduce is the thing players actually do — sit in ONE
   match for a long time.

   That matters here because the engine is immutable-style: every turn rebuilds
   the state, and several structures are appended to with a SPREAD COPY
   (s.log = [...s.log, entry], 56 sites). A spread append is O(n), so a
   structure that grows without a cap costs O(n²) over a match: invisible for
   ten turns, and the tab for sixty. index.html already carries a memory
   watchdog that trims App.state.log to 160 entries, which is strong evidence
   this class of bug has bitten before — but that watchdog only fires above 78%
   of the heap limit, and ONLY on browsers that expose performance.memory
   (Chromium). On Safari and Firefox _memHeapRatio() returns null and the
   watchdog is a no-op for the whole session.

   So: play one match for as many turns as you ask, and report per-turn cost
   and what is growing — by name, so the fix has an address.

   Usage: node .gauntlet/long-match-leak.mjs [root] [--turns 60]
   ══════════════════════════════════════════════════════════════════════════ */
import { chromium } from 'playwright';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';

const args = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf('--' + n); return i < 0 ? d : args[i + 1]; };
const ROOT = path.resolve((args[0] && !args[0].startsWith('--')) ? args[0] : 'C:/r185/public');
const TURNS = +flag('turns', 60);

const MIME = { '.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.jsx':'text/babel','.css':'text/css','.json':'application/json','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.svg':'image/svg+xml','.webp':'image/webp','.gif':'image/gif','.txt':'text/plain','.wav':'audio/wav','.mp3':'audio/mpeg','.glb':'model/gltf-binary','.ttf':'font/ttf','.woff2':'font/woff2' };
const PORT = 9450 + Math.floor(Math.random() * 120);
const srv = http.createServer((q, r) => {
  let p = decodeURIComponent(q.url.split('?')[0]); if (p.endsWith('/')) p += 'index.html';
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end('nf'); }
  r.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(r);
});
await new Promise(r => srv.listen(PORT, '127.0.0.1', r));

const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage', '--enable-precise-memory-info', '--js-flags=--expose-gc'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
let crashed = false; page.on('crash', () => { crashed = true; });
const errs = []; page.on('pageerror', e => errs.push(String(e.message || e).slice(0, 170)));
await page.addInitScript(() => { try { localStorage.setItem('mg_onboarded', '1'); } catch (e) {} });
await page.route('**/*', r => {
  const u = r.request().url();
  return (u.includes('127.0.0.1') || u.includes('fonts.g') || u.includes('cdn.jsdelivr') || u.includes('cdnjs')) ? r.continue() : r.abort();
});

console.log('══ LONG MATCH LEAK ══');
console.log('root  : ' + ROOT);
console.log('turns : ' + TURNS + '\n');

await page.goto('http://127.0.0.1:' + PORT + '/index.html', { waitUntil: 'domcontentloaded', timeout: 180000 });
await page.waitForFunction('typeof initGame === "function"', null, { timeout: 180000 });
await page.evaluate(() => { try { const g = document.getElementById('auth-gate'); if (g) g.remove(); } catch (e) {} });
await page.waitForTimeout(3000);

await page.evaluate(() => {
  App.battlePrep = App.battlePrep || {};
  const me = findHeroById(STARTER_HEROES[0].id), foe = findHeroById(STARTER_HEROES[1].id);
  App.battlePrep.hero = me; App.battlePrep.multiplayer = false;
  App.state = initGame(me, foe, [], true, null);
  App.screen = 'battle'; render();
});
await page.waitForTimeout(4000);

/* A census that names the growing structure instead of only its size. */
const census = () => page.evaluate(() => {
  const s = App.state || {};
  const sz = (o) => { try { return JSON.stringify(o).length; } catch (e) { return -1; } };
  const mem = performance.memory || {};
  const counts = {};
  for (const k of Object.keys(s)) {
    const v = s[k];
    if (Array.isArray(v)) counts[k] = v.length;
  }
  return {
    heapMB: Math.round((mem.usedJSHeapSize || 0) / 1048576),
    turn: s.turnNumber | 0,
    stateBytes: sz(s),
    logLen: (s.log || []).length,
    units: (s.units || []).length,
    arrays: counts,
    domNodes: document.getElementsByTagName('*').length,
    feedRows: document.querySelectorAll('.bef-row,.bevt-chip').length,
    floats: document.querySelectorAll('.juice-float,.dmg-float,.status-pop').length,
    frameNodes: (() => { try { const f = document.querySelector('iframe.bb-stage'); return f && f.contentDocument ? f.contentDocument.getElementsByTagName('*').length : -1; } catch (e) { return -1; } })(),
  };
});

const step = () => page.evaluate(() => {
  /* one full round: end the player's turn, let the AI act, come back. The AI
     is driven by scheduleAIStep/doAIStep, so this kicks it and returns. */
  try {
    App.state = endPlayerTurn(App.state, {});
    if (typeof doAIStep === 'function') { for (let i = 0; i < 6; i++) { try { doAIStep(); } catch (e) {} } }
    render();
    return true;
  } catch (e) { return String(e.message || e).slice(0, 140); }
});

const rows = [];
const t0 = Date.now();
let stalled = null;
for (let i = 1; i <= TURNS; i++) {
  if (crashed) { console.log('\n🔴 RENDERER CRASHED at turn ' + i); break; }
  const a = Date.now();
  let r;
  try {
    r = await Promise.race([step(), new Promise((_, rej) => setTimeout(() => rej(new Error('turn did not return in 20s')), 20000))]);
  } catch (e) { stalled = { turn: i, why: e.message }; console.log('\n🔴 STALLED at turn ' + i + ': ' + e.message); break; }
  const stepMs = Date.now() - a;
  if (r !== true) { console.log('  turn ' + i + ' threw: ' + r); }
  await page.waitForTimeout(120);
  const c = await census();
  c.stepMs = stepMs; c.i = i;
  rows.push(c);
  if (i <= 3 || i % 10 === 0 || i === TURNS) {
    console.log('  turn ' + String(i).padStart(3) +
      '  step ' + String(stepMs).padStart(5) + 'ms' +
      '  heap ' + String(c.heapMB).padStart(4) + 'MB' +
      '  state ' + String(Math.round(c.stateBytes / 1024)).padStart(6) + 'KB' +
      '  log ' + String(c.logLen).padStart(5) +
      '  units ' + String(c.units).padStart(3) +
      '  dom ' + String(c.domNodes).padStart(5) +
      '  stageDom ' + String(c.frameNodes).padStart(5) +
      '  feed ' + c.feedRows);
  }
}

console.log('\n══ WHAT GREW ══');
if (rows.length >= 2) {
  const a = rows[0], b = rows[rows.length - 1], n = rows.length - 1;
  const per = (x, y) => Math.round(((y - x) / n) * 100) / 100;
  const show = (label, x, y, warn, unit) => {
    const p = per(x, y);
    console.log('  ' + (p > warn ? '⚠ ' : '  ') + label.padEnd(22) + String(x).padStart(9) + ' → ' + String(y).padEnd(9) + '  ' + (p >= 0 ? '+' : '') + p + (unit || '') + '/turn');
  };
  show('heap MB', a.heapMB, b.heapMB, 1, 'MB');
  show('state JSON KB', Math.round(a.stateBytes / 1024), Math.round(b.stateBytes / 1024), 5, 'KB');
  show('state.log entries', a.logLen, b.logLen, 3);
  show('units', a.units, b.units, 0.5);
  show('page DOM nodes', a.domNodes, b.domNodes, 5);
  show('stage DOM nodes', a.frameNodes, b.frameNodes, 5);
  show('feed rows', a.feedRows, b.feedRows, 1);
  show('step ms', a.stepMs, b.stepMs, 20, 'ms');

  const ak = new Set([...Object.keys(a.arrays), ...Object.keys(b.arrays)]);
  const grew = [...ak].map(k => ({ k, a: a.arrays[k] || 0, b: b.arrays[k] || 0 }))
    .filter(x => x.b - x.a > n * 0.5).sort((x, y) => (y.b - y.a) - (x.b - x.a));
  if (grew.length) {
    console.log('\n  state arrays that GREW (name → the fix has an address):');
    for (const g of grew) console.log('    ' + g.k.padEnd(22) + g.a + ' → ' + g.b + '   (+' + Math.round(((g.b - g.a) / n) * 100) / 100 + '/turn)');
  }

  /* Is the step time rising with the turn count? That is the O(n²) signature,
     and it is what turns a slow match into a frozen tab. */
  const firstQ = rows.slice(0, Math.max(1, Math.floor(rows.length / 4)));
  const lastQ = rows.slice(-Math.max(1, Math.floor(rows.length / 4)));
  const avg = (xs) => Math.round(xs.reduce((s, r) => s + r.stepMs, 0) / xs.length);
  const f = avg(firstQ), l = avg(lastQ);
  console.log('\n  step time: first quarter ' + f + 'ms → last quarter ' + l + 'ms   (x' + (f ? Math.round((l / f) * 100) / 100 : '-') + ')');
  if (f && l / f >= 1.6) console.log('  ⚠ the turn is getting SLOWER as the match goes on — the O(n²) signature.');
}
if (errs.length) {
  console.log('\n  pageerror (' + errs.length + ', ' + new Set(errs).size + ' distinct):');
  for (const e of [...new Set(errs)].slice(0, 8)) console.log('    ' + e);
}
console.log('\n  verdict: ' + (crashed ? '🔴 CRASHED' : stalled ? '🔴 STALLED at turn ' + stalled.turn : '✅ completed ' + rows.length + ' turns'));
await browser.close(); srv.close();
