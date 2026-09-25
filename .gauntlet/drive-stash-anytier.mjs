/* ══════════════════════════════════════════════════════════════════════════
   🔒 DRIVE-STASH-ANYTIER — you never pay for the same slots twice

   Secret Stashes were strictly sequential. Reaching the top meant buying all
   five — Ⓐ 3 + 8 + 18 + 34 + 60 = 123 — for a stash priced at Ⓐ 60. Aza is
   bought with real money, so the ladder was charging twice over for the same
   thirty protected slots.

   Any tier is now bought directly, and the charge is the DIFFERENCE against
   what the player already paid.

   ⚠ THE ASSERTION THAT MATTERS IS AN INVARIANT, NOT A PRICE:
       the total Aza spent to reach tier N is exactly price(N),
       by EVERY route through the ladder.
     So the driver walks real purchase paths on the real functions and compares
     wallets — direct, one-step, and the full 1→2→3→4→5 climb. If any route
     costs more than the destination's price, a player is being charged for
     protection they already own.

   ⚠ IT SPENDS THE REAL WALLET through the shipped _stashBuyTier. Nothing here
     is a reimplementation; a fix that lives only in the shop tile would fail.

   Run:  node .gauntlet/drive-stash-anytier.mjs
   ══════════════════════════════════════════════════════════════════════════ */
import { chromium } from 'playwright';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';

const ROOT = path.resolve(process.cwd(), 'public');
const M = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.txt': 'text/plain', '.webp': 'image/webp' };
const P = 9600 + Math.floor(Math.random() * 300);
const srv = http.createServer((q, r) => {
  let p = decodeURIComponent(q.url.split('?')[0]); if (p.endsWith('/')) p += 'index.html';
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end('nf'); }
  r.writeHead(200, { 'Content-Type': M[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(r);
});
await new Promise(r => srv.listen(P, '127.0.0.1', r));

const b = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const pg = await b.newPage({ viewport: { width: 1400, height: 900 } });
const errs = []; pg.on('pageerror', e => errs.push(String(e).slice(0, 180)));
await pg.route('**/*', (r) => {
  const u = r.request().url();
  if (u.includes('127.0.0.1') || u.includes('cdnjs.cloudflare') || u.includes('fonts.g') || u.includes('unpkg')) return r.continue();
  return r.abort();
});
await pg.goto('http://127.0.0.1:' + P + '/', { waitUntil: 'domcontentloaded', timeout: 180000 });
await pg.waitForFunction('typeof _stashBuyTier === "function" && typeof _stashUpgradeCost === "function"',
  null, { timeout: 180000 }).catch(() => {});
await pg.waitForTimeout(2500);

const ready = await pg.evaluate(() => typeof _stashBuyTier === 'function' && typeof _stashUpgradeCost === 'function');
if (!ready) { console.error('FATAL: stash functions not reachable'); await b.close(); srv.close(); process.exit(1); }

const R = await pg.evaluate(() => {
  const BANK = 100000;
  const reset = (tier) => { Profile.stashTier = tier | 0; Profile.sovereigns = BANK; };
  const spent = () => BANK - (Profile.sovereigns | 0);
  const price = (t) => _stashPrice(t);
  const out = { ladder: STASH_TIERS.map(t => ({ tier: t.tier, slots: t.slots, price: price(t.tier) })) };

  /* ── route 1: straight to the top from nothing ── */
  reset(0);
  out.directTop = { r: _stashBuyTier(5), spent: spent(), tier: _stashTier() };

  /* ── route 2: the OLD sequential climb, still legal, must cost the same ── */
  reset(0);
  const steps = [];
  for (const t of [1, 2, 3, 4, 5]) { const r = _stashBuyTier(t); steps.push({ t, ok: r.ok, paid: r.paid }); }
  out.climb = { steps, spent: spent(), tier: _stashTier() };

  /* ── route 3: a jump from the middle ── */
  reset(0);
  _stashBuyTier(2);
  const afterTwo = spent();
  _stashBuyTier(5);
  out.jump = { afterTwo, spent: spent(), tier: _stashTier() };

  /* ── every pair of tiers: total to reach N is always price(N) ── */
  out.pairs = [];
  for (let from = 0; from <= 5; from++) {
    for (let to = from + 1; to <= 5; to++) {
      reset(0);
      if (from > 0) _stashBuyTier(from);
      const r = _stashBuyTier(to);
      out.pairs.push({ from, to, ok: !!r.ok, total: spent(), want: price(to) });
    }
  }

  /* ── refusals ── */
  reset(3);
  out.buySame  = _stashBuyTier(3);
  out.buyLower = _stashBuyTier(1);
  reset(0); Profile.sovereigns = 1;
  out.tooPoor  = _stashBuyTier(5);
  out.walletAfterPoor = Profile.sovereigns | 0;

  /* ── the tile must print what the spend path charges ── */
  reset(0); _stashBuyTier(2);
  out.quoted = { cost: _stashUpgradeCost(5), sticker: price(5), owned: _stashTier() };
  const before = Profile.sovereigns | 0;
  const rr = _stashBuyTier(5);
  out.quotedCharged = before - (Profile.sovereigns | 0);
  out.quotedOk = !!rr.ok;

  reset(0);
  return out;
});

const total = (t) => R.ladder.find(x => x.tier === t).price;

let fails = 0;
const ok = (n, c, d) => { if (!c) fails++; console.log((c ? '  OK   ' : '  FAIL ') + n + (d == null ? '' : '   ' + d)); };
console.log('\n\u{1F512} SECRET STASH · ANY TIER, AND NEVER PAID FOR TWICE\n');
console.log('  ladder: ' + R.ladder.map(t => 'T' + t.tier + '=' + t.slots + 'sl/\u{24B6}' + t.price).join('  '));
const seqTotal = R.ladder.reduce((a, t) => a + t.price, 0);
console.log('  buying all five the old way would have cost \u{24B6} ' + seqTotal
  + ' for a \u{24B6} ' + total(5) + ' stash\n');

console.log('  ── you can buy the top tier outright');
ok('\u{1F3AF} tier 5 from nothing succeeds', R.directTop.r.ok === true, JSON.stringify(R.directTop.r.reason || 'ok'));
ok('\u{1F3AF} …and it grants tier 5', R.directTop.tier === 5, 'tier ' + R.directTop.tier);
ok('…for exactly its own price', R.directTop.spent === total(5), '\u{24B6} ' + R.directTop.spent + ' vs ' + total(5));

console.log('\n  ── and the old sequential climb is not punished');
ok('every step still succeeds', R.climb.steps.every(s => s.ok), JSON.stringify(R.climb.steps.map(s => s.paid)));
ok('\u{1F3AF} the WHOLE climb costs the same as buying tier 5 outright',
  R.climb.spent === total(5), '\u{24B6} ' + R.climb.spent + ' vs ' + total(5) + '  (was ' + seqTotal + ')');
ok('a jump from tier 2 also totals tier 5’s price',
  R.jump.spent === total(5), '\u{24B6} ' + R.jump.afterTwo + ' then total ' + R.jump.spent);

console.log('\n  ── THE INVARIANT, over every route through the ladder');
const badPairs = R.pairs.filter(p => !p.ok || p.total !== p.want);
ok('\u{1F3AF} reaching tier N always costs exactly price(N), by all ' + R.pairs.length + ' routes',
  badPairs.length === 0,
  badPairs.length ? JSON.stringify(badPairs.slice(0, 4)) : 'no route overcharges');

console.log('\n  ── refusals');
ok('\u{1F3AF} buying the tier you already own is refused', R.buySame.ok === false && R.buySame.reason === 'have', R.buySame.reason);
ok('\u{1F3AF} buying a SMALLER one is refused', R.buyLower.ok === false && R.buyLower.reason === 'have', R.buyLower.reason);
ok('an unaffordable buy is refused', R.tooPoor.ok === false && R.tooPoor.reason === 'poor', R.tooPoor.reason);
ok('\u{1F3AF} …and takes NO Aza when it refuses', R.walletAfterPoor === 1, '\u{24B6} ' + R.walletAfterPoor);

console.log('\n  ── the storefront number is the charged number');
ok('a tier-2 owner is quoted the difference for tier 5',
  R.quoted.cost === total(5) - total(2), '\u{24B6} ' + R.quoted.cost + ' (sticker ' + R.quoted.sticker + ')');
ok('\u{1F3AF} …and that is exactly what the wallet loses',
  R.quotedCharged === R.quoted.cost && R.quotedOk, 'charged \u{24B6} ' + R.quotedCharged);
ok('CONTROL · the quote is genuinely lower than the sticker',
  R.quoted.cost < R.quoted.sticker, 'otherwise this test proves nothing');

console.log('\npage errors: ' + errs.length); errs.slice(0, 3).forEach(e => console.log('   ' + e));
console.log(fails ? ('\n' + fails + ' CHECK(S) FAILED') : '\nALL CHECKS PASSED');
await b.close(); srv.close();
process.exit(fails ? 1 : 0);
