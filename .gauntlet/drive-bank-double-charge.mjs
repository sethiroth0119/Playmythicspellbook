/* ══════════════════════════════════════════════════════════════════════════
   🏦 DRIVE-BANK-DOUBLE-CHARGE — "I lost 1.5 million Cinder out of nowhere"

   Every Bank of Ethos deposit charged the player TWICE. boe_transfer debits the
   canonical wallet server-side and returns the post-move balance; the client
   adopted it with a bare `Profile.gems = …`. But _gemsTaxTick is a 600 ms
   watcher whose one rule is "a decrease in Profile.gems is a spend", and it
   cannot tell a SPEND from an ADOPTION — so 0.2-1.6 s later it fired a second
   wallet_charge as 'legacy spend mirror'.

   Measured on the live wallet_ledger before the fix: 17 deposits across 8
   players, each paired with an identical mirror charge. 14,600,509 Cinder
   taken for money already paid.

   ⚠ THE ASSERTION IS ON THE SERVER CALLS, NOT ON THE BALANCE. Local gems end up
     correct either way — the second charge lands on the SERVER, and the player
     only loses it when the wallet next syncs downward. A test that checked
     Profile.gems after a deposit would pass on the broken build. What must be
     true is that exactly ONE wallet_charge leaves the client.

   ⚠ AND THE CONTROL IS A REAL SPEND. Suppressing the watcher for everything
     would be a different bug: the ~150 legacy `Profile.gems = gems - n` sites
     depend on it to make their debits durable. So the run also drops gems the
     way a legacy site does and asserts the mirror DOES fire.

   Run:  node .gauntlet/drive-bank-double-charge.mjs
   ══════════════════════════════════════════════════════════════════════════ */
import { chromium } from 'playwright';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';

const ROOT = path.resolve(process.cwd(), 'public');
const M = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.txt': 'text/plain' };
const P = 9800 + Math.floor(Math.random() * 190);
const srv = http.createServer((q, r) => {
  let p = decodeURIComponent(q.url.split('?')[0]); if (p.endsWith('/')) p += 'index.html';
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end('nf'); }
  r.writeHead(200, { 'Content-Type': M[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(r);
});
await new Promise(r => srv.listen(P, '127.0.0.1', r));

const b = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const pg = await b.newPage({ viewport: { width: 1300, height: 900 } });
const errs = []; pg.on('pageerror', e => errs.push(String(e).slice(0, 180)));
await pg.route('**/*', (r) => {
  const u = r.request().url();
  if (u.includes('127.0.0.1') || u.includes('localhost')) return r.continue();
  return r.abort();
});
await pg.goto('http://127.0.0.1:' + P + '/index.html', { waitUntil: 'domcontentloaded', timeout: 120000 });
await pg.waitForFunction('typeof _boeTransfer === "function" && typeof _gemsTaxExempt === "function"',
  null, { timeout: 150000 });
await pg.waitForTimeout(2500);

const r = await pg.evaluate(async () => {
  const o = {};
  const sleep = (ms) => new Promise(res => setTimeout(res, ms));

  /* Stand in for the whole cloud. Every RPC is recorded; boe_transfer answers
     the way the real one does — it has ALREADY debited the wallet, and returns
     the post-move balance for the client to adopt. */
  const calls = [];
  Profile.cloud = Profile.cloud || {};
  Profile.cloud.signedIn = true;
  window.Wallet = window.Wallet || {}; Wallet.rpcMissing = false;
  window.initCloud = () => true;
  const START = 5000000, DEPOSIT = 1500000;
  let serverGems = START;
  Cloud.client = {
    rpc: async (fn, args) => {
      calls.push({ fn, amount: (args && (args.p_amount != null ? args.p_amount : args.p_qty)) || 0,
                   reason: (args && args.p_reason) || '' });
      if (fn === 'boe_transfer') {
        serverGems -= DEPOSIT;
        return { data: { ok: true, gems: serverGems, balance: DEPOSIT, wallet_seq: 2, progress_seq: 2 } };
      }
      if (fn === 'wallet_charge') { serverGems -= (args.p_amount | 0); return { data: serverGems }; }
      return { data: null };
    },
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }) }),
  };
  window.BankEthos = window.BankEthos || {}; BankEthos.ready = true; BankEthos.balance = 0;

  // ── A. A DEPOSIT ────────────────────────────────────────────────────────
  Profile.gems = START;
  await sleep(900);                       // let the watcher take a baseline
  calls.length = 0;
  const before = Profile.gems | 0;
  await _boeTransfer(DEPOSIT, 'deposit');
  /* Wait well past the 600 ms poll — the second charge in the live ledger
     landed 0.17-1.56 s after the first, so a short wait would miss it. */
  await sleep(2600);

  o.localBefore = before;
  o.localAfter = Profile.gems | 0;
  o.charges = calls.filter(c => c.fn === 'wallet_charge');
  o.mirrorCharges = o.charges.filter(c => /legacy spend mirror/.test(c.reason));
  o.transferCalls = calls.filter(c => c.fn === 'boe_transfer').length;
  o.serverGems = serverGems;

  // ── B. CONTROL — a legacy spend MUST still be mirrored ───────────────────
  calls.length = 0;
  const SPEND = 12345;
  Profile.gems = (Profile.gems | 0) - SPEND;     // exactly what ~150 sites do
  await sleep(2600);
  o.legacyMirrors = calls.filter(c => c.fn === 'wallet_charge' && /legacy spend mirror/.test(c.reason));
  o.legacyMirrorTotal = o.legacyMirrors.reduce((a, c) => a + (c.amount | 0), 0);
  o.spend = SPEND;
  return o;
});

let fails = 0;
const ok = (n, c, d) => { if (!c) fails++; console.log((c ? '  OK   ' : '  FAIL ') + n + (d == null ? '' : '   ' + d)); };
const f = (x) => Number(x).toLocaleString();

console.log('\n\u{1F3E6} BANK OF ETHOS — ONE DEPOSIT, ONE CHARGE\n');
console.log('  ── the deposit');
ok('the transfer RPC ran once', r.transferCalls === 1, r.transferCalls + ' call(s)');
ok('the player’s Cinder fell by the deposit and no more',
  r.localBefore - r.localAfter === 1500000, f(r.localBefore) + ' → ' + f(r.localAfter));
ok('\u{1F3AF} NO "legacy spend mirror" followed it', r.mirrorCharges.length === 0,
  r.mirrorCharges.length + ' mirror charge(s): ' + JSON.stringify(r.mirrorCharges.map(c => c.amount)));
ok('\u{1F3AF} the server was charged exactly ONCE, not twice',
  r.serverGems === 3500000, 'server holds ' + f(r.serverGems) + ' (5,000,000 − 1,500,000; a double charge leaves 2,000,000)');

console.log('\n  ── CONTROL · the watcher must still catch a real legacy spend');
ok('\u{1F3AF} a bare Profile.gems debit IS mirrored to the server',
  r.legacyMirrors.length >= 1, r.legacyMirrors.length + ' mirror(s)');
ok('…for exactly the amount spent', r.legacyMirrorTotal === r.spend,
  f(r.legacyMirrorTotal) + ' vs ' + f(r.spend));

console.log('\npage errors: ' + errs.length); errs.slice(0, 4).forEach(e => console.log('   ' + e));
console.log(fails ? ('\n' + fails + ' CHECK(S) FAILED') : '\nALL CHECKS PASSED');
await b.close(); srv.close();
process.exit(fails ? 1 : 0);
