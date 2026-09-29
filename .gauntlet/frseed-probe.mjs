/* ══════════════════════════════════════════════════════════════════════════
   FR CONTRIBUTE PATH — the warehouse is not on it, and the debit order holds.
   (bug-muesa4ot, bug-mufleldg)

   📌 THIS FILE PINNED THE OPPOSITE RULE UNTIL sql/169, and why it changed is
      the point of it. v121v189 made frDeposit seed the WAREHOUSE ledger before
      contributing, because the deployed _fr_contribute_core checked and debited
      public.user_resources and refused when it was empty. That seed filled the
      1,397 vault entries with no ledger row — and could never touch the 382
      whose row already existed at zero or short, because wh_resync_resources
      fills only MISSING rows, deliberately: "a row that already exists is the
      server's own number and is left exactly alone". A first-seed-only ledger
      cannot track a vault that grows in the city, the camp and in battle, so
      sql/169 took the check and the debit out of the Reserve altogether. The
      seed then became one extra server round trip on the path v121v187 had just
      cut from five to two, and went.

   So what is pinned now is the shape that has to survive:
     · the contribute path makes NO warehouse call;
     · the debit is still SAVED before the RPC — that ordering, not the server
       debit, is what fixed the duplicate donations (v121v184);
     · a contribution still reaches the server.

   Usage: node .gauntlet/frseed-probe.mjs [root] [--index candidate.html]
   ══════════════════════════════════════════════════════════════════════════ */
import { chromium } from 'playwright';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';

const args = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf('--' + n); return i < 0 ? d : args[i + 1]; };
const ROOT = path.resolve((args[0] && !args[0].startsWith('--')) ? args[0] : 'C:/r188/public');
const INDEX = flag('index', null);

const MIME = { '.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.jsx':'text/babel','.css':'text/css','.json':'application/json','.png':'image/png','.jpg':'image/jpeg','.svg':'image/svg+xml','.webp':'image/webp','.txt':'text/plain','.wav':'audio/wav','.mp3':'audio/mpeg','.glb':'model/gltf-binary' };
const PORT = 9530 + Math.floor(Math.random() * 60);
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
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
await page.addInitScript(() => { try { localStorage.setItem('mg_onboarded', '1'); } catch (e) {} });
await page.route('**/*', r => {
  const u = r.request().url();
  return (u.includes('127.0.0.1') || u.includes('fonts.g') || u.includes('cdn.jsdelivr') || u.includes('cdnjs')) ? r.continue() : r.abort();
});
await page.goto('http://127.0.0.1:' + PORT + '/index.html', { waitUntil: 'domcontentloaded', timeout: 180000 });
await page.waitForFunction('typeof frDeposit === "function"', null, { timeout: 180000 });
await page.evaluate(() => { try { const g = document.getElementById('auth-gate'); if (g) g.remove(); } catch (e) {} });
await page.waitForTimeout(1500);

const checks = [];
const ok = (name, pass, note) => { checks.push({ pass }); console.log('  ' + (pass ? 'PASS' : 'FAIL') + '  ' + name + (note ? '   [' + note + ']' : '')); };

console.log('══ FR SEED PROBE ══');
console.log('  index : ' + (INDEX || "(the root's own)") + '\n');

const R = await page.evaluate(async () => {
  const out = { order: [] };
  const RES = 'metal';

  const run = async (opts) => {
    out.order.length = 0;
    /* a signed-in player holding 10 metal */
    window.initCloud = () => true;
    window.Profile = window.Profile || {};
    Profile.cloud = { signedIn: true, userId: 'probe', displayName: 'Probe' };
    window._ensureResources = () => ({ [RES]: 10 });
    window._whSeedLedger = async () => {
      out.order.push('seed');
      if (opts.seedThrows) throw new Error('seed unavailable');
      return true;
    };
    window.spendResources = () => { out.order.push('debit'); return true; };
    window.saveProfile = () => {};
    window.cloudSyncProfile = async () => { out.order.push('save'); return { ok: true }; };
    window._frPendFlush = async () => {};
    window._frPendAdd = () => {}; window._frPendDrop = () => {};
    window._frCall = async () => { out.order.push('rpc'); return { state: 'ok', data: { ok: true, credited: 1, points: 1 } }; };
    window._frAdopt = () => 1; window._frToastResult = () => {};
    window._frFetchSoon = window._frFetchSoon || (() => {});
    window.frFetch = async () => {};
    window.showToast = () => {};
    try { return await frDeposit(RES, 5); } catch (e) { return 'threw: ' + e.message; }
  };

  out.okResult = await run({});
  out.okOrder = out.order.slice();
  out.throwResult = await run({ seedThrows: true });
  out.throwOrder = out.order.slice();
  out.hasWrapper = typeof window._frSeedServerLedger === 'function';
  return out;
});

console.log('  normal run  : ' + JSON.stringify(R.okOrder) + '  → ' + R.okResult);
console.log('  seed throws : ' + JSON.stringify(R.throwOrder) + '  → ' + R.throwResult + '\n');

const idx = (arr, v) => arr.indexOf(v);
ok('1a the contribute path makes NO warehouse call', idx(R.okOrder, 'seed') < 0, JSON.stringify(R.okOrder));
ok('1b …and the seed wrapper is gone from the build', R.hasWrapper === false);
ok('1c a contribution still reaches the server', idx(R.okOrder, 'rpc') >= 0 && R.okResult === true);
ok('2a the debit is still SAVED before the RPC — the ordering that fixed the duplicate donations',
   idx(R.okOrder, 'debit') >= 0 && idx(R.okOrder, 'debit') < idx(R.okOrder, 'save')
   && idx(R.okOrder, 'save') < idx(R.okOrder, 'rpc'), JSON.stringify(R.okOrder));
ok('2b the order is exactly debit → save → rpc, with nothing before it',
   JSON.stringify(R.okOrder) === JSON.stringify(['debit', 'save', 'rpc']), JSON.stringify(R.okOrder));

const passed = checks.filter(c => c.pass).length;
console.log('\n  ' + passed + '/' + checks.length + ' checks passed' + (passed === checks.length ? '   ✅' : '   ❌'));
await browser.close(); srv.close();
process.exit(passed === checks.length ? 0 : 1);
