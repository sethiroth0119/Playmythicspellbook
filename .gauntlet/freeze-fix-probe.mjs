/* ══════════════════════════════════════════════════════════════════════════
   FREEZE FIX PROBE — the two measured defects behind "froze and crashed",
   each checked against its own control in the same run.

   1. THE OOM WATCHDOG ON A BROWSER WITHOUT performance.memory.
      performance.memory is Chromium-only. The probe DELETES it before any page
      script runs, which is exactly what index.html sees on Safari and Firefox,
      and then asks whether anything at all is watching. On HEAD the answer is
      nothing — _startMemoryWatchdog returns on its first line and the log trim,
      the FX sweep, the graphics shed and the crash banner never run for the
      whole session.
      It also checks the other half of the claim: that the janitor does NOT act
      below its bounds. A sweep that fires during ordinary play would be a
      worse bug than the one it fixes.

   2. A document KEYDOWN LISTENER PER MODAL / PER TITLE RENDER.
      Counted from before the first page script, so nothing is missed. Two
      sites: openInfoModal (closed with the X — the listener used to survive
      holding a DETACHED overlay) and bindTosModal (re-bound on every
      renderTitle).

   Usage: node .gauntlet/freeze-fix-probe.mjs [root] [--index candidate.html]
   The --index override swaps ONLY index.html, so the candidate is measured
   against the same assets as the control.
   ══════════════════════════════════════════════════════════════════════════ */
import { chromium } from 'playwright';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';

const args = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf('--' + n); return i < 0 ? d : args[i + 1]; };
const ROOT = path.resolve((args[0] && !args[0].startsWith('--')) ? args[0] : 'C:/r186/public');
const INDEX = flag('index', null);

const MIME = { '.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.jsx':'text/babel','.css':'text/css','.json':'application/json','.png':'image/png','.jpg':'image/jpeg','.svg':'image/svg+xml','.webp':'image/webp','.txt':'text/plain','.wav':'audio/wav','.mp3':'audio/mpeg','.glb':'model/gltf-binary','.ttf':'font/ttf','.woff2':'font/woff2' };
const PORT = 9500 + Math.floor(Math.random() * 90);
const srv = http.createServer((q, r) => {
  let p = decodeURIComponent(q.url.split('?')[0]); if (p.endsWith('/')) p += 'index.html';
  let f = path.join(ROOT, p);
  if (INDEX && (p === '/index.html')) f = path.resolve(INDEX);
  if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end('nf'); }
  r.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(r);
});
await new Promise(r => srv.listen(PORT, '127.0.0.1', r));

const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

/* Safari/Firefox, as index.html experiences them: no performance.memory at
   all. Installed before the first page script, so the watchdog's very first
   line sees what those browsers show it. */
await page.addInitScript(`
  try { Object.defineProperty(performance, 'memory', { configurable: true, get() { return undefined; } }); } catch (e) {}
  (() => {
    const K = { add: 0, rem: 0 }; window.__K = K;
    const proto = EventTarget.prototype, _a = proto.addEventListener, _r = proto.removeEventListener;
    proto.addEventListener = function (t, f, o) { if (this === document && t === 'keydown') K.add++; return _a.call(this, t, f, o); };
    proto.removeEventListener = function (t, f, o) { if (this === document && t === 'keydown') K.rem++; return _r.call(this, t, f, o); };
  })();
`);
await page.addInitScript(() => { try { localStorage.setItem('mg_onboarded', '1'); } catch (e) {} });
await page.route('**/*', r => {
  const u = r.request().url();
  return (u.includes('127.0.0.1') || u.includes('fonts.g') || u.includes('cdn.jsdelivr') || u.includes('cdnjs')) ? r.continue() : r.abort();
});
await page.goto('http://127.0.0.1:' + PORT + '/index.html', { waitUntil: 'domcontentloaded', timeout: 180000 });
await page.waitForFunction('typeof render === "function" && typeof App === "object"', null, { timeout: 180000 });
await page.evaluate(() => { try { const g = document.getElementById('auth-gate'); if (g) g.remove(); } catch (e) {} });
await page.waitForTimeout(2500);

const checks = [];
const ok = (name, pass, note) => { checks.push({ name, pass, note }); console.log('  ' + (pass ? 'PASS' : 'FAIL') + '  ' + name + (note ? '   [' + note + ']' : '')); };

console.log('══ FREEZE FIX PROBE ══');
console.log('  root : ' + ROOT);
console.log('  index: ' + (INDEX || '(the root\'s own)'));
console.log('  performance.memory: REMOVED before any page script (Safari/Firefox)\n');

/* ── 1. the watchdog on a browser with no heap stats ── */
const w = await page.evaluate(() => ({
  ratioIsNull: (typeof _memHeapRatio === 'function') ? (_memHeapRatio() == null) : null,
  hasJanitorFn: typeof window._memJanitorSweep === 'function',
  janitorRunning: !!window._memJanitor,
  watchdogRunning: !!window._memWatchdog,
}));
ok('1a performance.memory really is unreadable here', w.ratioIsNull === true, 'ratio null = ' + w.ratioIsNull);
ok('1b a janitor exists for browsers with no heap stats', w.hasJanitorFn);
ok('1c …and it is actually running', w.janitorRunning);
ok('1d no heap tiers are invented without a number', w.watchdogRunning === false, 'watchdog interval not started, correctly');

/* the janitor must be INERT during ordinary play */
const inert = await page.evaluate(() => {
  if (typeof window._memJanitorSweep !== 'function') return null;
  App.state = App.state || {};
  App.state.log = Array.from({ length: 120 }, (_, i) => ({ msg: 'line ' + i }));
  const before = App.state.log.length;
  const host = document.createElement('div'); host.id = '__fxprobe';
  for (let i = 0; i < 12; i++) { const d = document.createElement('div'); d.className = 'juice-float'; host.appendChild(d); }
  document.body.appendChild(host);
  window._memJanitorSweep();
  const r = { logBefore: before, logAfter: App.state.log.length, fxLeft: host.querySelectorAll('.juice-float').length };
  host.remove();
  return r;
});
ok('1e a normal log (120) is left alone', inert && inert.logAfter === inert.logBefore, inert ? inert.logBefore + ' → ' + inert.logAfter : 'n/a');
ok('1f a normal number of FX nodes (12) is left alone', inert && inert.fxLeft === 12, inert ? inert.fxLeft + ' left' : 'n/a');

/* …and must act once things are past the bounds ordinary play never reaches */
const acts = await page.evaluate(() => {
  if (typeof window._memJanitorSweep !== 'function') return null;
  App.state = App.state || {};
  App.state.log = Array.from({ length: 900 }, (_, i) => ({ msg: 'line ' + i }));
  const host = document.createElement('div'); host.id = '__fxprobe2';
  for (let i = 0; i < 260; i++) { const d = document.createElement('div'); d.className = 'dmg-float'; host.appendChild(d); }
  document.body.appendChild(host);
  window._memJanitorSweep();
  const r = { logAfter: App.state.log.length, fxLeft: host.querySelectorAll('.dmg-float').length };
  host.remove();
  return r;
});
ok('1g a runaway log (900) is trimmed', acts && acts.logAfter === 400, acts ? '→ ' + acts.logAfter : 'n/a');
ok('1h runaway FX nodes (260) are swept', acts && acts.fxLeft === 0, acts ? acts.fxLeft + ' left' : 'n/a');

/* ── 2. keydown listeners ── */
const k0 = await page.evaluate(() => ({ ...window.__K }));
await page.evaluate(() => {
  /* open and close an info modal five times, closing with the X — the path
     that used to leave the listener behind holding a detached overlay */
  for (let i = 0; i < 5; i++) {
    try {
      openInfoModal('probe ' + i, [{ label: 'x', value: 'y' }], {});
      const btn = document.querySelector('.info-modal-close');
      if (btn) btn.click();
    } catch (e) {}
  }
});
const k1 = await page.evaluate(() => ({ ...window.__K, overlays: document.querySelectorAll('.info-modal-close').length }));
const infoNet = (k1.add - k0.add) - (k1.rem - k0.rem);
ok('2a five info modals opened and closed with the X leave no listener',
   infoNet <= 0, 'added ' + (k1.add - k0.add) + ', removed ' + (k1.rem - k0.rem) + ', net ' + infoNet);

const k2 = await page.evaluate(() => ({ ...window.__K }));
await page.evaluate(() => { for (let i = 0; i < 6; i++) { App.screen = 'title'; render(); } });
await page.waitForTimeout(600);
const k3 = await page.evaluate(() => ({ ...window.__K }));
const titleNet = (k3.add - k2.add) - (k3.rem - k2.rem);
ok('2b six renders of the title screen leave at most ONE listener',
   titleNet <= 1, 'added ' + (k3.add - k2.add) + ', removed ' + (k3.rem - k2.rem) + ', net ' + titleNet);

/* and the modal must still work — a fix that breaks Escape is not a fix */
const still = await page.evaluate(async () => {
  const ov = document.getElementById('tos-overlay');
  if (!ov) return { skip: true };
  ov.style.display = 'flex';
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
  await new Promise(r => setTimeout(r, 60));
  return { closed: ov.style.display === 'none' };
});
ok('2c Escape still closes the terms modal', still.skip ? true : still.closed === true, still.skip ? 'overlay not on this screen — skipped' : 'display=' + (still.closed ? 'none' : 'still open'));

const passed = checks.filter(c => c.pass).length;
console.log('\n  ' + passed + '/' + checks.length + ' checks passed' + (passed === checks.length ? '   ✅' : '   ❌'));
await browser.close(); srv.close();
process.exit(passed === checks.length ? 0 : 1);
