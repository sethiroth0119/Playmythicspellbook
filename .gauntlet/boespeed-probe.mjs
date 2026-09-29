/* ══════════════════════════════════════════════════════════════════════════
   BOE SPEED PROBE — the Bank of Ethos opens in two round trips, and still
   settles before it shows.

   bug-muh3ubjb: entering the Bank of Ethos is "almost always extremely slow".
   openBankOfEthos chained twelve server steps with .then().

   This replaces all twelve with stubs that resolve after a fixed delay and
   record when they started and finished, so it can check BOTH things that
   matter and not just the fast one:

     · SPEED — elapsed time counts round trips rather than machine speed.
     · CORRECTNESS — every *AutoSettle must still FINISH before the fetches
       that display what it settled START. A "fix" that ran all twelve at once
       would be twelve times faster and would paint the bank with
       pre-settlement state, which reads to the player as missing money. That
       is the regression this probe exists to refuse.

   Usage: node .gauntlet/boespeed-probe.mjs [root] [--index candidate.html] [--lat 200]
   ══════════════════════════════════════════════════════════════════════════ */
import { chromium } from 'playwright';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';

const args = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf('--' + n); return i < 0 ? d : args[i + 1]; };
const ROOT = path.resolve((args[0] && !args[0].startsWith('--')) ? args[0] : 'C:/r186/public');
const INDEX = flag('index', null);
const LAT = +flag('lat', 200);

const MIME = { '.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.jsx':'text/babel','.css':'text/css','.json':'application/json','.png':'image/png','.jpg':'image/jpeg','.svg':'image/svg+xml','.webp':'image/webp','.txt':'text/plain','.wav':'audio/wav','.mp3':'audio/mpeg','.glb':'model/gltf-binary' };
const PORT = 9250 + Math.floor(Math.random() * 90);
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
await page.waitForFunction('typeof openBankOfEthos === "function"', null, { timeout: 180000 });
await page.evaluate(() => { try { const g = document.getElementById('auth-gate'); if (g) g.remove(); } catch (e) {} });
await page.waitForTimeout(2000);

const checks = [];
const ok = (name, pass, note) => { checks.push({ pass }); console.log('  ' + (pass ? 'PASS' : 'FAIL') + '  ' + name + (note ? '   [' + note + ']' : '')); };

console.log('══ BOE SPEED PROBE ══');
console.log('  index : ' + (INDEX || "(the root's own)"));
console.log('  injected latency per server call: ' + LAT + 'ms\n');

const R = await page.evaluate(async (LAT) => {
  const rec = {};
  const t0 = performance.now();
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const NAMES = ['boeSyncDirectory', 'boeAutoSettle', 'boeFetchLedger', 'boeFetchRequests', 'boeFetchLoans',
                 'boeMercAutoSettle', 'boeFetchMercListings', 'boeFetchMercContracts', 'boeFetchMercPosts',
                 'boeMarketAutoSettle', 'boeFetchMarket', 'boeFetchDirectory'];
  const missing = NAMES.filter(n => typeof window[n] !== 'function');
  for (const n of NAMES) {
    window[n] = async function () {
      const e = rec[n] = { start: performance.now() - t0 };
      await sleep(LAT);
      e.end = performance.now() - t0;
      return true;
    };
  }
  /* the two gates the chain hangs off */
  window.boeFetch = async function () { await sleep(LAT); return true; };
  window.boeApplyMaintenance = async function () { await sleep(LAT); return true; };
  window.boeRefreshWallet = async function () { return true; };

  const a = performance.now();
  try { openBankOfEthos(); } catch (e) { return { threw: String(e.message).slice(0, 140) }; }
  /* wait long enough that a fully sequential chain would also have finished */
  await sleep(LAT * 16 + 800);
  const total = Math.max(...Object.values(rec).map(x => x.end || 0));
  try { const w = document.getElementById('be-frame-wrap'); if (w) w.remove(); } catch (e) {}
  return { rec, missing, total: Math.round(total), calls: Object.keys(rec).length };
}, LAT);

if (R.threw) { console.log('  openBankOfEthos threw: ' + R.threw); process.exit(1); }
if (R.missing && R.missing.length) console.log('  note: not present in this build: ' + R.missing.join(', '));

const r = R.rec || {};
const has = (n) => !!r[n];
console.log('  steps that ran: ' + R.calls + ' of 12');
for (const n of Object.keys(r)) console.log('    ' + n.padEnd(24) + Math.round(r[n].start) + ' → ' + Math.round(r[n].end) + 'ms');

ok('1a all twelve steps still run', R.calls === 12, R.calls + ' of 12');

/* ── the four groups, each settle BEFORE its fetches ── */
const before = (settle, fetches, label) => {
  if (!has(settle)) return ok(label, false, settle + ' never ran');
  const bad = fetches.filter(f => has(f) && r[f].start + 1 < r[settle].end);
  ok(label, bad.length === 0, bad.length ? 'started too early: ' + bad.join(', ') : settle + ' ends ' + Math.round(r[settle].end) + 'ms, earliest fetch starts ' + Math.round(Math.min(...fetches.filter(has).map(f => r[f].start))) + 'ms');
};
before('boeAutoSettle', ['boeFetchLedger', 'boeFetchRequests', 'boeFetchLoans'], '2a settling requests happens BEFORE the ledger/requests/loans are read');
before('boeMercAutoSettle', ['boeFetchMercListings', 'boeFetchMercContracts', 'boeFetchMercPosts'], '2b merc settling happens BEFORE the merc reads');
before('boeMarketAutoSettle', ['boeFetchMarket'], '2c market settling happens BEFORE the market is read');
before('boeSyncDirectory', ['boeFetchDirectory'], '2d my handle is published BEFORE the directory is read');

/* ── speed: the whole thing should be ~2 round trips of work, not 12 ── */
ok('3a the bank finishes in about two round trips, not twelve',
   R.total < LAT * 6, R.total + 'ms total (sequential would be ≈ ' + (LAT * 12) + 'ms)');

/* ── the four groups overlap rather than queue ── */
const settles = ['boeAutoSettle', 'boeMercAutoSettle', 'boeMarketAutoSettle', 'boeSyncDirectory'].filter(has);
const spread = settles.length > 1 ? Math.round(Math.max(...settles.map(n => r[n].start)) - Math.min(...settles.map(n => r[n].start))) : 0;
ok('3b the four groups start together instead of queueing', spread < LAT / 2, 'start spread ' + spread + 'ms');

const passed = checks.filter(c => c.pass).length;
console.log('\n  ' + passed + '/' + checks.length + ' checks passed' + (passed === checks.length ? '   ✅' : '   ❌'));
await browser.close(); srv.close();
process.exit(passed === checks.length ? 0 : 1);
