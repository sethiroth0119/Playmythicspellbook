/* ══════════════════════════════════════════════════════════════════════════
   FR SPEED PROBE — the Foundation Reserve's round trips, timed.

   bug-muh3ubjb: "the Foundation Reserve, especially when making contributions"
   is almost always extremely slow.

   Measured cause: frFetch issued three independent reads ONE AFTER ANOTHER,
   and frDeposit awaited the whole of frFetch after every contribution — on top
   of a whole-profile upload (241 KB average on the live database, 1.8 MB
   largest).

   HOW THIS MEASURES IT HONESTLY. Every Supabase call is replaced with a stub
   that resolves after a FIXED delay, so elapsed time is a direct count of
   sequential round trips rather than a machine-speed benchmark: three
   sequential reads at 200 ms each take ~600 ms, the same three in parallel take
   ~200 ms. The numbers are therefore reproducible and mean something.

   Usage: node .gauntlet/frspeed-probe.mjs [root] [--index candidate.html] [--lat 200]
   ══════════════════════════════════════════════════════════════════════════ */
import { chromium } from 'playwright';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';

const args = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf('--' + n); return i < 0 ? d : args[i + 1]; };
const ROOT = path.resolve((args[0] && !args[0].startsWith('--')) ? args[0] : 'C:/r186/public');
const INDEX = flag('index', null);
const LAT = +flag('lat', 200);

const MIME = { '.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.jsx':'text/babel','.css':'text/css','.json':'application/json','.png':'image/png','.jpg':'image/jpeg','.svg':'image/svg+xml','.webp':'image/webp','.txt':'text/plain','.wav':'audio/wav','.mp3':'audio/mpeg','.glb':'model/gltf-binary' };
const PORT = 9350 + Math.floor(Math.random() * 90);
const srv = http.createServer((q, r) => {
  let p = decodeURIComponent(q.url.split('?')[0]); if (p.endsWith('/')) p += 'index.html';
  let f = path.join(ROOT, p);
  if (INDEX && p === '/index.html') f = path.resolve(INDEX);
  if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end('nf'); }
  r.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(r);
});
await new Promise(r => srv.listen(PORT, '127.0.0.1', r));

const browser = await chromium.launch({ args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.addInitScript(() => { try { localStorage.setItem('mg_onboarded', '1'); } catch (e) {} });
await page.route('**/*', r => {
  const u = r.request().url();
  return (u.includes('127.0.0.1') || u.includes('fonts.g') || u.includes('cdn.jsdelivr') || u.includes('cdnjs')) ? r.continue() : r.abort();
});
await page.goto('http://127.0.0.1:' + PORT + '/index.html', { waitUntil: 'domcontentloaded', timeout: 180000 });
await page.waitForFunction('typeof frFetch === "function" && typeof App === "object"', null, { timeout: 180000 });
await page.evaluate(() => { try { const g = document.getElementById('auth-gate'); if (g) g.remove(); } catch (e) {} });
await page.waitForTimeout(2000);

const checks = [];
const ok = (name, pass, note) => { checks.push({ pass }); console.log('  ' + (pass ? 'PASS' : 'FAIL') + '  ' + name + (note ? '   [' + note + ']' : '')); };

console.log('══ FR SPEED PROBE ══');
console.log('  index : ' + (INDEX || "(the root's own)"));
console.log('  injected latency per server call: ' + LAT + 'ms\n');

const result = await page.evaluate(async (LAT) => {
  const R = { calls: [], notes: [] };
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));

  /* A stub that looks like the PostgREST builder chain and resolves after LAT.
     Every terminal await is recorded with a timestamp, so the harness can see
     whether they overlapped or queued. */
  const t0 = performance.now();
  const mk = (table) => {
    const rec = { table, started: performance.now() - t0 };
    const thenable = {
      select() { return thenable; },
      eq() { return thenable; },
      order() { return thenable; },
      limit() { return thenable; },
      then(res, rej) {
        return sleep(LAT).then(() => {
          rec.ended = performance.now() - t0;
          R.calls.push(rec);
          return { data: [], error: null };
        }).then(res, rej);
      },
      catch(f) { return this.then(undefined, f); },
    };
    return thenable;
  };
  window.Cloud = window.Cloud || {};
  Cloud.ready = true;
  Cloud.client = { from: (t) => mk(t), rpc: async () => { await sleep(LAT); return { data: { ok: true }, error: null }; } };
  window.initCloud = () => true;
  window.Profile = window.Profile || {};
  Profile.cloud = { signedIn: true, userId: 'probe-user', displayName: 'Probe' };
  try { FoundationReserve.loading = false; } catch (e) {}

  /* ── 1. opening the Reserve: how long do its reads take together? ── */
  R.calls.length = 0;
  const a = performance.now();
  await frFetch();
  R.openMs = Math.round(performance.now() - a);
  /* ⚠ COUNT ONLY THE RESERVE'S OWN READS. Unrelated background work (a
     player_maintenance poll, for one) can land inside the same window and was
     making this probe fail its own control for the wrong reason. */
  const mine = R.calls.filter(c => /^reserve/.test(c.table));
  R.openCalls = mine.length;
  /* overlap test: if they ran in parallel the spread of start times is tiny */
  const starts = mine.map(c => c.started);
  R.startSpread = starts.length > 1 ? Math.round(Math.max(...starts) - Math.min(...starts)) : 0;
  R.tables = R.calls.map(c => c.table);

  /* ── 2. does the deposit still await the whole refresh? ── */
  R.depositAwaitsFetch = /_frToastResult\([^)]*\);\s*await frFetch\(\);/.test(String(frDeposit));
  R.depositUsesSoon = /_frFetchSoon\(\)/.test(String(frDeposit));
  R.hasSoon = typeof window._frFetchSoon === 'function';

  /* ── 3. the background refresh coalesces ── */
  if (typeof window._frFetchSoon === 'function') {
    let runs = 0;
    const real = window.frFetch;
    window.frFetch = async function () { runs++; return real.apply(this, arguments); };
    for (let i = 0; i < 5; i++) window._frFetchSoon();
    await sleep(LAT * 2 + 400);
    R.coalescedRuns = runs;
    window.frFetch = real;
  }
  return R;
}, LAT);

console.log('  reserve reads issued: ' + (result.tables || []).join(', '));
ok('1a opening the Reserve still makes all three reads', (result.openCalls || 0) === 3, result.openCalls + ' calls');
ok('1b …and they are issued TOGETHER, not one after another',
   (result.startSpread || 0) < LAT / 2, 'start-time spread ' + result.startSpread + 'ms (sequential would be ~' + LAT + 'ms+)');
ok('1c …so opening it costs one round trip, not three',
   (result.openMs || 0) < LAT * 2, result.openMs + 'ms with ' + LAT + 'ms latency (sequential ≈ ' + (LAT * 3) + 'ms)');
ok('2a a contribution no longer AWAITS the full refresh', result.depositAwaitsFetch === false);
ok('2b …it hands it to the background refresh instead', result.depositUsesSoon === true && result.hasSoon === true);
ok('3a five refreshes in a row collapse into one', result.coalescedRuns === 1, 'frFetch ran ' + result.coalescedRuns + ' time(s) for 5 requests');

const passed = checks.filter(c => c.pass).length;
console.log('\n  ' + passed + '/' + checks.length + ' checks passed' + (passed === checks.length ? '   ✅' : '   ❌'));
await browser.close(); srv.close();
process.exit(passed === checks.length ? 0 : 1);
