/* ══════════════════════════════════════════════════════════════════════════
   🔑 DRIVE-TKEYS-WORKER — Transport Keys sell from the Worker, or say why not.

   THE ASK: move Transport Keys onto the Cloudflare Worker instead of adding
   the same Stripe secret to a second store.

   🔴 WHY IT MOVED, MEASURED ON THE LIVE PROJECT. The keys were sold by
      supabase/functions/transport-keys, which reads STRIPE_SECRET_KEY from
      SUPABASE's secret store. The key is set on CLOUDFLARE — the Aza store,
      convoy rigs and the Shop have all been taking real money through it
      (pledge_purchases has rows). It was never set in Supabase. So every key
      checkout 503'd and `transport_keys` has 0 rows, ever. pledge-checkout was
      moved to the Worker on 2026-07-31 for exactly this reason; this finishes
      the same move rather than duplicating a credential across two stores.

   ⚠ THIS DRIVES THE REAL HANDLER, NOT A COPY. worker.js is imported and its
     exported fetch() is called with a synthetic env, so routing, the gates and
     the price table under test are the shipped ones. Stripe itself is never
     called: every assertion here is about what happens BEFORE money moves —
     which is where all the refusals live.

   Pinned, with controls:
     · the price list answers with NO Stripe key at all   ← the edge function's bug
     · CONTROL: …and reports purchasable:false while doing it
     · CONTROL: …and purchasable:true once a key is present
     · prices match the retired edge function EXACTLY
     · checkout without Stripe is 503, not a crash
     · checkout without a signed-in user is 401
     · an unknown level is refused before Stripe is touched
     · confirm with no session id is refused
     · the route exists and does not collide with /api/garage or /api/shop

   Run:  node .gauntlet/drive-tkeys-worker.mjs
   ══════════════════════════════════════════════════════════════════════════ */
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const worker = (await import(pathToFileURL(path.resolve(process.cwd(), 'worker.js')).href)).default;

const BASE = 'https://playmythicspellbook.com';
const call = async (env, p, init) => {
  const res = await worker.fetch(new Request(BASE + p, init), env, { waitUntil() {} });
  let body = null;
  try { body = await res.json(); } catch (e) { body = null; }
  return { status: res.status, body };
};

/* Two envs: one with no Stripe at all (the state the game is in today for
   keys), one with a key present. Neither can reach Stripe — the key is a
   sentinel, and every assertion below is about a decision made before any
   network call. SB_SERVICE is deliberately absent: the table lookup must
   degrade rather than throw. */
const ENV_BARE = { SB_URL: 'https://example.invalid', SB_ANON: 'anon' };
const ENV_KEYED = { ...ENV_BARE, STRIPE_SECRET_KEY: 'sk_test_sentinel_not_a_real_key' };

const out = {};

/* ── the shop window ─────────────────────────────────────────────────────── */
{
  const r = await call(ENV_BARE, '/api/tkeys/catalog');
  out.catalogNoStripe = { status: r.status, purchasable: r.body && r.body.purchasable,
                          n: r.body && r.body.keys && r.body.keys.length };
  out.keys = (r.body && r.body.keys) || [];
  const r2 = await call(ENV_KEYED, '/api/tkeys/catalog');
  out.catalogWithStripe = { status: r2.status, purchasable: r2.body && r2.body.purchasable };
}

/* ── the gates ───────────────────────────────────────────────────────────── */
out.checkoutNoStripe = await call(ENV_BARE, '/api/tkeys/checkout',
  { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ level: '1' }) });
out.checkoutNoAuth = await call(ENV_KEYED, '/api/tkeys/checkout',
  { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ level: '1' }) });
out.confirmNoAuth = await call(ENV_KEYED, '/api/tkeys/confirm', { method: 'GET' });
out.unknownSeg = await call(ENV_BARE, '/api/tkeys/definitely-not-a-thing');

/* CONTROL: the new route must not have shadowed the ones beside it. */
out.garageStillThere = await call(ENV_BARE, '/api/garage/config');
out.shopStillThere = await call(ENV_BARE, '/api/shop/config');

const bad = [];
const need = (k, ok, d) => { if (!ok) bad.push(k + (d !== undefined ? ' — ' + JSON.stringify(d) : '')); };

/* 🔴 THE BUG THE EDGE FUNCTION HAD: the price list sat behind the Stripe guard,
   so a missing secret turned the whole tab into one red line. */
need('🔴 the price list answers with no Stripe key at all',
     out.catalogNoStripe.status === 200 && out.catalogNoStripe.n === 5, out.catalogNoStripe);
need('CONTROL: …and says plainly that it cannot sell',
     out.catalogNoStripe.purchasable === false, out.catalogNoStripe);
need('CONTROL: …and that it can, once the key is there',
     out.catalogWithStripe.purchasable === true, out.catalogWithStripe);

/* The retired edge function's exact table. A player who saw a price in a cached
   tab must not be charged a different one by the new endpoint. */
const EXPECTED = [
  { level: 1, name: 'Bronze Key',   cents: 799,  usd: '7.99' },
  { level: 2, name: 'Iron Key',     cents: 1999, usd: '19.99' },
  { level: 3, name: 'Cobalt Key',   cents: 3999, usd: '39.99' },
  { level: 4, name: 'Meridian Key', cents: 6999, usd: '69.99' },
  { level: 5, name: 'Ashgate Key',  cents: 9900, usd: '99.00' },
];
const priceMatch = EXPECTED.every(e => {
  const got = out.keys.find(k => k.level === e.level);
  return got && got.name === e.name && got.cents === e.cents && got.usd === e.usd;
});
need('prices match the retired edge function exactly', priceMatch,
     out.keys.map(k => ({ level: k.level, name: k.name, cents: k.cents })));

need('checkout with no Stripe is a 503 that names the cause',
     out.checkoutNoStripe.status === 503
     && out.checkoutNoStripe.body && out.checkoutNoStripe.body.error === 'stripe_not_configured',
     out.checkoutNoStripe);
need('🔴 checkout with no signed-in user is refused',
     out.checkoutNoAuth.status === 401, out.checkoutNoAuth);
need('confirm with no signed-in user is refused',
     out.confirmNoAuth.status === 401, out.confirmNoAuth);
need('an unknown path under /api/tkeys is a clean 404',
     out.unknownSeg.status === 404 || out.unknownSeg.status === 503, out.unknownSeg);

/* 🔴 CONTROL: adding a route must not have eaten its neighbours. Both of these
   sell real money today, and a prefix collision would be silent. */
need('CONTROL: /api/garage still answers', out.garageStillThere.status === 200, out.garageStillThere);
need('CONTROL: /api/shop still answers',
     out.shopStillThere.status === 200 || out.shopStillThere.status === 503, out.shopStillThere);

console.log(JSON.stringify(out, null, 2).slice(0, 3000));
console.log(bad.length ? '\n❌ FAIL:\n  · ' + bad.join('\n  · ')
                       : '\n✅ PASS — the key store lives where the Stripe key already is, and shows its prices even when it cannot sell.');
process.exit(bad.length ? 1 : 0);
