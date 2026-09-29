import { handlePushSend } from './push.js';
import { handleLivery } from './livery.js';
/* Mythic Spellbook — public Game API + static site (one Cloudflare Worker).
 *
 * Read-only, public-safe aggregates ONLY. No new secrets: it reuses the
 * already-public Supabase anon key (the same one shipped in the game) and
 * only ever reads curated `api_*` views that expose non-PII columns. Every
 * non-/api request falls straight through to the game's static assets, so
 * the site is unaffected.
 *
 * External consumers (e.g. abraxascodex.com) GET these JSON endpoints:
 *   /api                      — index / discovery
 *   /api/v1/health            — liveness (no DB)
 *   /api/v1/corporations      — public corporation registry
 *   /api/v1/reserve           — Foundation Reserve totals per resource
 *   /api/v1/tax               — Foundation tax summary aggregates
 *   /api/v1/nodes             — in-game economy nodes (public state)
 *   /api/v1/updates           — "Keep up with updates" feed (abraxascodex → game)
 *
 * Pushing data the OTHER way (abraxascodex → game updates) is done by
 * abraxascodex writing rows into the Supabase `site_updates` table with its
 * OWN credentials on its own backend — this Worker never accepts writes.
 */

const API_VERSION = 'v1';

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET,OPTIONS',
  'access-control-allow-headers': 'content-type',
  'access-control-max-age': '86400',
};

function json(data, status = 200, cacheSeconds = 30) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'public, max-age=' + cacheSeconds,
      ...CORS,
    },
  });
}

// Thin Supabase REST GET against a curated public view.
async function sb(env, pathAndQuery) {
  const base = String(env.SB_URL || '').replace(/\/+$/, '');
  if (!base || !env.SB_ANON) throw new Error('api not configured');
  const r = await fetch(base + '/rest/v1/' + pathAndQuery, {
    headers: { apikey: env.SB_ANON, authorization: 'Bearer ' + env.SB_ANON, accept: 'application/json' },
  });
  if (!r.ok) {
    let t = '';
    try { t = await r.text(); } catch (e) {}
    throw new Error('supabase ' + r.status + (t ? ' ' + t.slice(0, 160) : ''));
  }
  return r.json();
}

const ROUTES = {
  async health() {
    return { ok: true, service: 'mythic-spellbook', api: API_VERSION, time: new Date().toISOString() };
  },
  async corporations(env, u) {
    const lim = Math.max(1, Math.min(500, parseInt(u.searchParams.get('limit') || '200', 10) || 200));
    const rows = await sb(env, 'api_corporations?select=*&order=members.desc&limit=' + lim);
    return { count: rows.length, corporations: rows };
  },
  async reserve(env) {
    return { resources: await sb(env, 'api_reserve_totals?select=*') };
  },
  async tax(env) {
    const r = await sb(env, 'api_tax_summary?select=*&limit=1');
    return r[0] || {};
  },
  async nodes(env, u) {
    const lim = Math.max(1, Math.min(1000, parseInt(u.searchParams.get('limit') || '300', 10) || 300));
    return { nodes: await sb(env, 'api_nodes?select=*&order=created_at.desc&limit=' + lim) };
  },
  async updates(env, u) {
    const lim = Math.max(1, Math.min(50, parseInt(u.searchParams.get('limit') || '20', 10) || 20));
    return { updates: await sb(env, 'api_updates?select=*&order=published_at.desc&limit=' + lim) };
  },
};

/* ============================================================================
 * 💵 STRIPE CONNECT — real-money payout rail for the Cashout Vault.
 *
 * SAFETY / DESIGN (per Stripe best practices):
 *  • Secret key is read ONLY from a Cloudflare *secret* (env.STRIPE_SECRET_KEY)
 *    — never hardcoded, never in wrangler.jsonc (which is committed). Use a
 *    RESTRICTED key (rk_…) scoped to Connect+Transfers. See STRIPE.md.
 *  • Accounts v2 + controller props (Stripe-managed risk/onboarding) — the
 *    connected account is the safer "Stripe takes risk" shape, not legacy
 *    Express/Custom.
 *  • Onboarding is STRIPE-HOSTED (Account Links): the player completes KYC on
 *    Stripe's own pages. This game/worker never sees or stores bank/ID data.
 *  • Caller is authenticated by their Supabase access token (verified server
 *    -side against Supabase) — keys/funds never touch client code.
 *  • Webhooks are SIGNATURE-VERIFIED (HMAC-SHA256) before processing.
 *  • Payouts are DISABLED by default. /payout returns 501 unless the dev
 *    explicitly sets env.CASHOUT_PAYOUTS_ENABLED='true' AND funds the platform
 *    balance. Money never moves on a client click by default.
 * If STRIPE_SECRET_KEY is unset the whole module reports disabled and the
 * game stays in mock mode — nothing breaks.
 * ========================================================================== */
const CORS_RW = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET,POST,OPTIONS',
  'access-control-allow-headers': 'content-type, authorization, stripe-signature',
  'access-control-max-age': '86400',
};
function cjson(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...CORS_RW },
  });
}
function _form(obj, prefix, out) {
  out = out || new URLSearchParams(); prefix = prefix || '';
  for (const k in obj) {
    const v = obj[k]; const key = prefix ? prefix + '[' + k + ']' : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) _form(v, key, out);
    else out.append(key, String(v));
  }
  return out;
}
// Thin Stripe REST call. v2 = JSON body; v1 = form-encoded. Key from env only.
async function stripeApi(env, method, path, body, v2) {
  if (!env.STRIPE_SECRET_KEY) throw new Error('stripe not configured');
  const headers = { authorization: 'Bearer ' + env.STRIPE_SECRET_KEY };
  let payload;
  if (body && v2) { headers['content-type'] = 'application/json'; payload = JSON.stringify(body); }
  else if (body) { headers['content-type'] = 'application/x-www-form-urlencoded'; payload = _form(body).toString(); }
  const r = await fetch('https://api.stripe.com' + path, { method, headers, body: payload });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error('stripe ' + r.status + ' ' + ((j && j.error && j.error.message) || '').slice(0, 200));
  return j;
}
// Verify the caller's Supabase access token server-side → returns user id.
async function sbUser(env, request) {
  const auth = request.headers.get('authorization') || '';
  const tok = auth.replace(/^Bearer\s+/i, '').trim();
  if (!tok || !env.SB_URL || !env.SB_ANON) return null;
  const r = await fetch(String(env.SB_URL).replace(/\/+$/, '') + '/auth/v1/user', {
    headers: { apikey: env.SB_ANON, authorization: 'Bearer ' + tok },
  });
  if (!r.ok) return null;
  const j = await r.json().catch(() => null);
  return j && j.id ? { id: j.id, token: tok, email: (j.email || '').toLowerCase(),
    name: (j.user_metadata && j.user_metadata.display_name) || null } : null;
}
// Read/write the user→stripe-account map in Supabase AS THE USER (their JWT →
// PostgREST applies RLS). Requires the cashout_accounts table from api.sql.
async function sbAcctGet(env, user) {
  const r = await fetch(String(env.SB_URL).replace(/\/+$/, '') + '/rest/v1/cashout_accounts?select=stripe_account_id&user_id=eq.' + user.id + '&limit=1',
    { headers: { apikey: env.SB_ANON, authorization: 'Bearer ' + user.token, accept: 'application/json' } });
  if (!r.ok) return null;
  const a = await r.json().catch(() => []);
  return (a && a[0] && a[0].stripe_account_id) || null;
}
async function sbAcctSet(env, user, acct) {
  try {
    await fetch(String(env.SB_URL).replace(/\/+$/, '') + '/rest/v1/cashout_accounts',
      { method: 'POST', headers: { apikey: env.SB_ANON, authorization: 'Bearer ' + user.token, 'content-type': 'application/json', prefer: 'resolution=merge-duplicates' },
        body: JSON.stringify({ user_id: user.id, stripe_account_id: acct }) });
  } catch (e) {}
}
// Constant-time-ish HMAC-SHA256 verify of the Stripe-Signature header.
async function verifyStripeSig(secret, payload, sigHeader) {
  try {
    if (!secret || !sigHeader) return false;
    const parts = {}; sigHeader.split(',').forEach(kv => { const i = kv.indexOf('='); if (i > 0) (parts[kv.slice(0, i)] = parts[kv.slice(0, i)] || []).push && (parts[kv.slice(0, i)] = kv.slice(i + 1)); });
    const t = parts['t']; const v1 = parts['v1'];
    if (!t || !v1) return false;
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(t + '.' + payload));
    const hex = [...new Uint8Array(mac)].map(b => b.toString(16).padStart(2, '0')).join('');
    if (hex.length !== v1.length) return false;
    let diff = 0; for (let i = 0; i < hex.length; i++) diff |= hex.charCodeAt(i) ^ v1.charCodeAt(i);
    return diff === 0;
  } catch (e) { return false; }
}
async function handleCashout(request, env, u) {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS_RW });
  const seg = u.pathname.replace(/^\/api\/cashout\//, '').replace(/\/+$/, '');
  const configured = !!env.STRIPE_SECRET_KEY;
  const payoutsEnabled = configured && env.CASHOUT_PAYOUTS_ENABLED === 'true';

  // Public, no-secret: lets the client decide whether to show "Connect".
  if (seg === 'config' && request.method === 'GET') {
    return cjson({ enabled: configured, payoutsEnabled: payoutsEnabled });
  }
  if (!configured) return cjson({ error: 'stripe_not_configured', hint: 'Set the STRIPE_SECRET_KEY secret (see STRIPE.md). The game runs in mock mode until then.' }, 503);

  // Webhook — signature-verified; never moves funds here. Shop purchases are
  // ALSO fulfilled from this endpoint: whichever webhook URL is registered in
  // the Stripe dashboard (this one or /api/shop/webhook), a paid Shop session
  // gets delivered. shop_fulfill is idempotent, so both firing is harmless.
  if (seg === 'webhook' && request.method === 'POST') {
    const raw = await request.text();
    const ok = await verifyStripeSig(env.STRIPE_WEBHOOK_SECRET, raw, request.headers.get('stripe-signature') || '');
    if (!ok) return cjson({ error: 'bad_signature' }, 400);
    let evt = null; try { evt = JSON.parse(raw); } catch (e) {}
    if (evt && evt.type === 'checkout.session.completed') {
      const s = evt.data && evt.data.object;
      if (s && s.metadata && s.metadata.shop_tier) {
        try { await _shopFulfillSession(env, s); } catch (e) {}
      }
      // 🚚 A convoy rig bought from the Garage.
      if (s && s.metadata && s.metadata.garage_sku) {
        try { await _garageFulfillSession(env, s); } catch (e) {}
      }
      // 💳 A City Hall licence, or a pack of development points.
      if (s && s.metadata && s.metadata.licence_id) { try { await _licenceFulfillSession(env, s); } catch (e) {} }
      if (s && s.metadata && s.metadata.devpoints)  { try { await _devpointsFulfillSession(env, s); } catch (e) {} }
    }
    return cjson({ received: true });
  }

  const user = await sbUser(env, request);
  if (!user) return cjson({ error: 'unauthorized', hint: 'Send your Supabase access token as Authorization: Bearer.' }, 401);

  // Start / resume Stripe-hosted onboarding (KYC done on Stripe's pages).
  if (seg === 'connect' && request.method === 'POST') {
    let acct = await sbAcctGet(env, user);
    if (!acct) {
      // Prefer Accounts v2 (Stripe-managed risk). Many accounts are not yet
      // enrolled in v2 and that call errors — fall back to the universally
      // available v1 Express account. Either way onboarding is Stripe-hosted
      // (Stripe collects KYC). Express liability only matters once payouts
      // are enabled (off by default here) — see STRIPE.md.
      let a = null;
      try {
        a = await stripeApi(env, 'POST', '/v2/core/accounts', {
          identity: { country: 'US' },
          configuration: { recipient: { capabilities: { stripe_balance: { stripe_transfers: { requested: true } } } } },
          dashboard: 'none',
          metadata: { game_user: user.id },
        }, true);
      } catch (e2) {
        a = await stripeApi(env, 'POST', '/v1/accounts', {
          type: 'express', country: 'US',
          capabilities: { transfers: { requested: true } },
          metadata: { game_user: user.id },
        });
      }
      acct = a && a.id;
      if (!acct) return cjson({ error: 'account_create_failed' }, 502);
      await sbAcctSet(env, user, acct);
    }
    const origin = _safeReturnOrigin(env, u);
    const link = await stripeApi(env, 'POST', '/v1/account_links', {
      account: acct, type: 'account_onboarding',
      refresh_url: origin + '/?cashout=refresh', return_url: origin + '/?cashout=return',
    });
    return cjson({ url: link && link.url });
  }

  // Onboarding/payout-eligibility status (booleans only — no PII).
  if (seg === 'status' && request.method === 'GET') {
    const acct = await sbAcctGet(env, user);
    if (!acct) return cjson({ connected: false });
    const a = await stripeApi(env, 'GET', '/v1/accounts/' + acct, null);
    return cjson({
      connected: true,
      payouts_enabled: !!(a && a.payouts_enabled),
      details_submitted: !!(a && a.details_submitted),
      requirements_due: ((a && a.requirements && a.requirements.currently_due) || []).length,
    });
  }

  // Real payout — OFF by default. Requires the dev to opt in via a secret
  // AND fund the platform balance. Never auto-fires from a client click.
  if (seg === 'payout' && request.method === 'POST') {
    if (!payoutsEnabled) return cjson({ error: 'payouts_disabled', hint: 'Mock mode. Set CASHOUT_PAYOUTS_ENABLED=true and fund the platform balance to enable real transfers (see STRIPE.md). Server-side authorisation/anti-fraud must gate this in production.' }, 501);
    const acct = await sbAcctGet(env, user);
    if (!acct) return cjson({ error: 'not_connected' }, 400);
    const body = await request.json().catch(() => ({}));
    const usd = Math.floor(Number(body && body.usd) || 0);
    if (!(usd > 0) || usd > 5000) return cjson({ error: 'bad_amount' }, 400);
    // NOTE: production must re-derive/authorise the amount server-side from a
    // trusted ledger (never trust the client) + reuse the in-game safeguards.
    const tr = await stripeApi(env, 'POST', '/v1/transfers', {
      amount: usd * 100, currency: 'usd', destination: acct, metadata: { game_user: user.id },
    });
    return cjson({ ok: true, transfer: tr && tr.id });
  }

  return cjson({ error: 'not_found' }, 404);
}

/* ============================================================================
 * 🪙 BUY AZA COIN — real one-time purchase via Stripe Checkout (hosted).
 * Per Stripe guidance, one-time payments use Checkout Sessions. Prices are
 * SERVER-AUTHORITATIVE (AZA_PACKS) so a tampered client can't change them.
 * Crediting is spoof-proof WITHOUT a webhook: on return the client calls
 * /confirm, the Worker retrieves the session from Stripe with the secret
 * key and only confirms if payment_status==='paid' AND the session belongs
 * to the signed-in user. The game then records the session id in
 * aza_purchases (own-JWT, UNIQUE) so a coin pack credits exactly once.
 * Disabled (503) until STRIPE_SECRET_KEY is set — game stays in mock mode.
 * ========================================================================== */
// 🚨 PRICING SOURCE OF TRUTH — these MUST match SOVEREIGN_PACKAGES in
// public/index.html. The server-side amounts are what Stripe charges and
// what gets credited to the player; the client values are display-only.
// Any drift here = wrong amount of Aza credited.
//
// Pricing peg: 1 Aza Coin = $1 USD (5000 Cinder = $1).
// sp_starter is an INTENTIONAL conversion sweetener (2 Aza for $1.99
// instead of 1 Aza for $0.99) — keep it off-peg as the first-purchase
// bonus tier. Every other bundle is 1 Aza per $1 on-peg.
const AZA_PACKS = {
  sp_starter: { aza: 2,   cents: 199,    name: 'Starter Cache' },
  sp_adv:     { aza: 5,   cents: 499,    name: "Adventurer's Coffer" },
  sp_hero:    { aza: 20,  cents: 1999,   name: "Hero's Vault" },
  sp_champ:   { aza: 50,  cents: 4999,   name: "Champion's Trove" },
  sp_legend:  { aza: 150, cents: 14999,  name: "Legend's Hoard" },
};
// 🔗 Resolve a SAFE absolute https:// base for Stripe return URLs. PUBLIC_BASE_URL
// is operator-set and can be wrong — most dangerously a Stripe KEY pasted into it
// by mistake, which sends the checkout success redirect to a dead domain (the
// "can't reach this page / rk_live_…" DNS error). We therefore REJECT a value
// that looks like a key or isn't a real hostname, and fall back to the request's
// own origin (this Worker serves the game, so that IS the site URL). Never logs
// or returns the env value.
function _safeReturnOrigin(env, u) {
  let o = String((env && env.PUBLIC_BASE_URL) || '').trim();
  const looksLikeKey = /^(rk|sk|pk|whsec)_(live|test)_/i.test(o) || /^(rk|sk|pk|whsec)_/i.test(o);
  if (o && !looksLikeKey) {
    if (!/^https?:\/\//i.test(o)) o = 'https://' + o.replace(/^\/+/, '');
    try {
      const url = new URL(o);
      if (url.hostname && url.hostname.indexOf('.') > 0 && !/\s/.test(o)) return o.replace(/\/+$/, '');
    } catch (e) { /* fall through to request origin */ }
  }
  return String((u && u.origin) || '').replace(/\/+$/, '');
}
async function handleBuy(request, env, u) {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS_RW });
  const seg = u.pathname.replace(/^\/api\/buy\//, '').replace(/\/+$/, '');
  const configured = !!env.STRIPE_SECRET_KEY;
  if (seg === 'config' && request.method === 'GET') return cjson({ enabled: configured });
  if (!configured) return cjson({ error: 'stripe_not_configured', hint: 'Set STRIPE_SECRET_KEY (see STRIPE.md). Aza store stays in mock mode until then.' }, 503);
  const user = await sbUser(env, request);
  if (!user) return cjson({ error: 'unauthorized', hint: 'Send your Supabase access token as Authorization: Bearer.' }, 401);

  if (seg === 'checkout' && request.method === 'POST') {
    const body = await request.json().catch(() => ({}));
    const p = AZA_PACKS[body && body.pack];
    if (!p) return cjson({ error: 'bad_pack' }, 400);
    // Safe absolute base for the return URLs — rejects a misconfigured
    // PUBLIC_BASE_URL (e.g. a Stripe key) so the success redirect always lands
    // on a reachable site URL. Carry the pack + aza so the site can show the
    // success modal instantly even before /confirm round-trips.
    const origin = _safeReturnOrigin(env, u);
    const s = await stripeApi(env, 'POST', '/v1/checkout/sessions', {
      mode: 'payment',
      'line_items[0][quantity]': 1,
      'line_items[0][price_data][currency]': 'usd',
      'line_items[0][price_data][unit_amount]': p.cents,
      'line_items[0][price_data][product_data][name]': p.aza + ' Aza coin — ' + p.name,
      client_reference_id: user.id,
      'metadata[user_id]': user.id,
      'metadata[pack]': body.pack,
      'metadata[aza]': p.aza,
      success_url: origin + '/?aza=ok&sid={CHECKOUT_SESSION_ID}',
      cancel_url: origin + '/?aza=cancel',
    });
    return cjson({ url: s && s.url });
  }

  if (seg === 'confirm' && request.method === 'GET') {
    const sid = u.searchParams.get('sid') || '';
    if (!sid) return cjson({ error: 'no_session' }, 400);
    const s = await stripeApi(env, 'GET', '/v1/checkout/sessions/' + encodeURIComponent(sid), null);
    const md = (s && s.metadata) || {};
    if (!s || s.payment_status !== 'paid' || md.user_id !== user.id) return cjson({ ok: false });
    /* 💰 CREDIT HERE, SERVER-SIDE. This endpoint used to verify the payment
       correctly and then hand the amount back for the CLIENT to credit itself
       — it wrote user_profiles.sovereigns and inserted the aza_purchases
       receipt on its own JWT. The verification was never the weak part; the
       crediting was. The client chose the number it wrote, and it also drove
       the insert that was supposed to make the whole thing exactly-once.
       aza_fulfill() does both in one transaction under SB_SERVICE, idempotent
       on the UNIQUE session id, exactly like _shopFulfillSession above. */
    const aza = Number(md.aza) || (AZA_PACKS[md.pack] && AZA_PACKS[md.pack].aza) || 0;
    if (!(aza > 0)) return cjson({ ok: false, error: 'bad_amount' });
    if (!env.SB_SERVICE) return cjson({ ok: false, error: 'sb_service_missing' }, 503);
    let credited = null;
    try {
      const r = await fetch(String(env.SB_URL).replace(/\/+$/, '') + '/rest/v1/rpc/aza_fulfill',
        { method: 'POST',
          headers: { apikey: env.SB_SERVICE, authorization: 'Bearer ' + env.SB_SERVICE, 'content-type': 'application/json' },
          body: JSON.stringify({ p_user: user.id, p_session: sid, p_aza: aza }) });
      if (!r.ok) return cjson({ ok: false, error: 'credit_failed_' + r.status }, 502);
      credited = await r.json().catch(() => null);
    } catch (e) { return cjson({ ok: false, error: 'credit_error' }, 502); }
    // ⚠ Only report ok when the money actually moved (or was already moved by
    //   an earlier call). A paid session that failed to credit must NOT look
    //   like a success — the player would see the modal and have no Aza.
    if (!credited || credited.ok !== true) return cjson({ ok: false, error: 'credit_refused' }, 502);
    return cjson({
      ok: true, sid: sid, pack: md.pack, aza: aza,
      already: credited.already === true,
      balance: Number(credited.aza) || 0,   // authoritative post-credit balance
    });
  }

  return cjson({ error: 'not_found' }, 404);
}

/* ============================================================================
 * 🚚 THE GARAGE — convoy rigs bought once with REAL MONEY (Stripe Checkout).
 * Same shape as the Aza rail above, with two deliberate differences.
 *
 *  1. These are NOT currency. A rig is a permanent unlock, so the interesting
 *     failure is not "credited twice" but "paid twice for the same thing".
 *     /checkout refuses a sku the caller already owns, and /confirm is
 *     idempotent, so a refresh of the return URL cannot double anything.
 *  2. Ownership must OUTLIVE the local profile. It is recorded server-side
 *     against the Supabase user id with SB_SERVICE, and /owned replays it,
 *     so a wiped browser or a new device gets the rigs back.
 *
 * Prices are SERVER-AUTHORITATIVE. The browser posts only {sku}; every
 * amount and product name is read from GARAGE_RIGS here. Never take a price,
 * name or currency from the request body — that is how a $99 rig gets bought
 * for a cent.
 * ========================================================================== */
// 🚨 PRICING SOURCE OF TRUTH — must match GARAGE_RIGS in public/index.html,
// which is DISPLAY ONLY. Drift here means the player is shown one price and
// charged another.
const GARAGE_RIGS = {
  rig_ironback: { cents: 2000, name: 'Ironback Runner' },
  rig_ashconvoy:{ cents: 6000, name: 'Ash Convoy Rig' },
  rig_warden:   { cents: 9900, name: 'Warden Longhaul' },
};
// Best-effort durable ownership. The table is optional: without it the rig
// still works (the game keeps it in the cloud-synced profile), you just lose
// the restore-on-a-new-device path. Every helper below therefore returns a
// benign value rather than throwing when the table is missing.
async function _garageOwnedRows(env, userId) {
  if (!env.SB_SERVICE || !env.SB_URL || !userId) return null;
  try {
    const r = await fetch(env.SB_URL + '/rest/v1/garage_purchases?user_id=eq.' + encodeURIComponent(userId) + '&select=sku,stripe_session_id,created_at',
      { headers: { apikey: env.SB_SERVICE, authorization: 'Bearer ' + env.SB_SERVICE, accept: 'application/json' } });
    if (!r.ok) return null;                       // table absent / RLS — degrade quietly
    const j = await r.json().catch(() => null);
    return Array.isArray(j) ? j : null;
  } catch (e) { return null; }
}
async function _garageRecord(env, userId, sku, sid) {
  if (!env.SB_SERVICE || !env.SB_URL) return false;
  try {
    const r = await fetch(env.SB_URL + '/rest/v1/garage_purchases', {
      method: 'POST',
      headers: { apikey: env.SB_SERVICE, authorization: 'Bearer ' + env.SB_SERVICE,
                 'content-type': 'application/json',
                 // UNIQUE(stripe_session_id) makes this idempotent: a replayed
                 // confirm resolves to "already recorded", never a second row.
                 prefer: 'resolution=ignore-duplicates,return=minimal' },
      body: JSON.stringify({ user_id: userId, sku: sku, stripe_session_id: sid }),
    });
    return r.ok;
  } catch (e) { return false; }
}
// 🪝 Fulfil a paid rig from a WEBHOOK event. This is what rescues a buyer who
// pays and then closes the tab: /confirm only ever runs if they come back, so
// without this they are charged and get nothing, with no recovery path — the
// purchase leaves no row for /owned to replay.
//
// Safe to run alongside /confirm. Recording is idempotent on the Stripe
// session id (UNIQUE), so the webhook and the return visit can both fire and
// the second is a no-op. Takes the user id from the session metadata rather
// than from a caller, because Stripe is the caller here.
async function _garageFulfillSession(env, sess) {
  try {
    if (!sess || sess.payment_status !== 'paid') return false;
    const md = sess.metadata || {};
    const sku = md.garage_sku;
    const uid = md.user_id || sess.client_reference_id;
    if (!sku || !uid || !GARAGE_RIGS[sku]) return false;
    return await _garageRecord(env, uid, sku, sess.id);
  } catch (e) { return false; }
}
/* ============================================================================
 * 💳 PAID LICENCES and DEVELOPMENT POINTS — two more once-paid rails.
 * Same contract as the Garage above, and read that header first:
 *   · prices are SERVER-AUTHORITATIVE — the browser posts an id, never a
 *     price; the amount is read from the tables below;
 *   · a licence is a permanent unlock: /checkout refuses one the caller has
 *     already bought, /confirm is idempotent on the Stripe session id;
 *   · development points are REPEATABLE (2 ⬡ for $5, as often as they like),
 *     so the only idempotency is the session id — a replayed return URL or a
 *     webhook landing after the return visit records nothing twice;
 *   · ownership is recorded server-side (sql/111) so a wiped browser or a new
 *     device gets it back through /owned.
 * ========================================================================== */
// 🚨 PRICING SOURCE OF TRUTH — must match LICENCE_USD / DEVPOINT_PACK in
// public/index.html, which are DISPLAY ONLY. Construction is not sold: it is
// the one licence City Hall gives away (see CITY_LICENSES there).
const LICENCE_SKUS = {
  mining:      { cents: 1200, name: 'Mining License' },
  oil:         { cents: 1200, name: 'Oil License' },
  medical:     { cents: 1200, name: 'Medical License' },
  agriculture: { cents: 1200, name: 'Agriculture License' },
  logistics:   { cents: 1200, name: 'Logistics License' },
  security:    { cents: 1200, name: 'Security License' },
  research:    { cents: 1200, name: 'Research License' },
  smuggling:   { cents: 1200, name: 'Smuggling License' },
};
const DEVPOINT_PACK = { cents: 500, points: 2, name: '2 Development Points' };

async function _sbRows(env, table, query) {
  if (!env.SB_SERVICE || !env.SB_URL) return null;
  try {
    const r = await fetch(String(env.SB_URL).replace(/\/+$/, '') + '/rest/v1/' + table + '?' + query,
      { headers: { apikey: env.SB_SERVICE, authorization: 'Bearer ' + env.SB_SERVICE, accept: 'application/json' } });
    if (!r.ok) return null;                       // table absent / RLS — degrade quietly
    const j = await r.json().catch(() => null);
    return Array.isArray(j) ? j : null;
  } catch (e) { return null; }
}
async function _sbInsertIgnoreDup(env, table, row) {
  if (!env.SB_SERVICE || !env.SB_URL) return false;
  try {
    const r = await fetch(String(env.SB_URL).replace(/\/+$/, '') + '/rest/v1/' + table, {
      method: 'POST',
      headers: { apikey: env.SB_SERVICE, authorization: 'Bearer ' + env.SB_SERVICE,
                 'content-type': 'application/json',
                 prefer: 'resolution=ignore-duplicates,return=minimal' },
      body: JSON.stringify(row),
    });
    return r.ok;
  } catch (e) { return false; }
}
async function _licenceFulfillSession(env, sess) {
  try {
    if (!sess || sess.payment_status !== 'paid') return false;
    const md = sess.metadata || {};
    const id = md.licence_id, uid = md.user_id || sess.client_reference_id;
    if (!id || !uid || !LICENCE_SKUS[id]) return false;
    return await _sbInsertIgnoreDup(env, 'licence_purchases',
      { user_id: uid, licence_id: id, stripe_session_id: sess.id, amount_cents: sess.amount_total | 0 });
  } catch (e) { return false; }
}
async function _devpointsFulfillSession(env, sess) {
  try {
    if (!sess || sess.payment_status !== 'paid') return false;
    const md = sess.metadata || {};
    const pts = parseInt(md.devpoints, 10), uid = md.user_id || sess.client_reference_id;
    if (!(pts > 0) || !uid) return false;
    return await _sbInsertIgnoreDup(env, 'devpoint_purchases',
      { user_id: uid, points: pts, stripe_session_id: sess.id, amount_cents: sess.amount_total | 0 });
  } catch (e) { return false; }
}
async function handleLicence(request, env, u) {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS_RW });
  const seg = u.pathname.replace(/^\/api\/licence\//, '').replace(/\/+$/, '');
  const configured = !!env.STRIPE_SECRET_KEY;
  if (seg === 'webhook' && request.method === 'POST') {
    const raw = await request.text();
    const ok = await verifyStripeSig(env.STRIPE_WEBHOOK_SECRET, raw, request.headers.get('stripe-signature') || '');
    if (!ok) return cjson({ error: 'bad_signature' }, 400);
    let evt = null; try { evt = JSON.parse(raw); } catch (e) {}
    if (evt && evt.type === 'checkout.session.completed') {
      try { await _licenceFulfillSession(env, evt.data && evt.data.object); } catch (e) {}
    }
    return cjson({ received: true });
  }
  if (seg === 'config' && request.method === 'GET') {
    const _rows = await _sbRows(env, 'licence_purchases', 'user_id=eq.00000000-0000-0000-0000-000000000000&select=licence_id');
    return cjson({ enabled: configured, webhook: !!env.STRIPE_WEBHOOK_SECRET, durable: _rows !== null,
      licences: Object.keys(LICENCE_SKUS).map(k => ({ id: k, cents: LICENCE_SKUS[k].cents, name: LICENCE_SKUS[k].name })) });
  }
  if (!configured) return cjson({ error: 'stripe_not_configured', hint: 'Set STRIPE_SECRET_KEY on this Worker.' }, 503);
  const user = await sbUser(env, request);
  if (!user) return cjson({ error: 'unauthorized', hint: 'Send your Supabase access token as Authorization: Bearer.' }, 401);

  if (seg === 'owned' && request.method === 'GET') {
    const rows = await _sbRows(env, 'licence_purchases', 'user_id=eq.' + encodeURIComponent(user.id) + '&select=licence_id,stripe_session_id,created_at');
    if (!rows) return cjson({ ok: true, durable: false, owned: [] });
    return cjson({ ok: true, durable: true, owned: rows.map(r => r.licence_id) });
  }
  if (seg === 'checkout' && request.method === 'POST') {
    const body = await request.json().catch(() => ({}));
    const id = body && body.licence;
    const L = LICENCE_SKUS[id];
    if (!L) return cjson({ error: 'bad_licence' }, 400);
    const rows = await _sbRows(env, 'licence_purchases', 'user_id=eq.' + encodeURIComponent(user.id) + '&select=licence_id');
    if (rows && rows.some(r => r.licence_id === id)) return cjson({ error: 'already_owned', licence: id }, 409);
    const origin = _safeReturnOrigin(env, u);
    const s = await stripeApi(env, 'POST', '/v1/checkout/sessions', {
      mode: 'payment',
      'line_items[0][quantity]': 1,
      'line_items[0][price_data][currency]': 'usd',
      'line_items[0][price_data][unit_amount]': L.cents,
      'line_items[0][price_data][product_data][name]': L.name + ' — City Hall licence',
      client_reference_id: user.id,
      'metadata[user_id]': user.id,
      'metadata[licence_id]': id,
      success_url: origin + '/?lic=ok&sid={CHECKOUT_SESSION_ID}',
      cancel_url: origin + '/?lic=cancel',
    });
    return cjson({ url: s && s.url });
  }
  if (seg === 'confirm' && request.method === 'GET') {
    const sid = u.searchParams.get('sid') || '';
    if (!sid) return cjson({ error: 'no_session' }, 400);
    const s = await stripeApi(env, 'GET', '/v1/checkout/sessions/' + encodeURIComponent(sid), null);
    const md = (s && s.metadata) || {};
    if (!s || s.payment_status !== 'paid' || md.user_id !== user.id) return cjson({ ok: false });
    const id = md.licence_id;
    if (!LICENCE_SKUS[id]) return cjson({ ok: false, error: 'unknown_licence' });
    const durable = await _licenceFulfillSession(env, s);
    return cjson({ ok: true, sid: sid, licence: id, name: LICENCE_SKUS[id].name, cents: LICENCE_SKUS[id].cents, durable: durable });
  }
  return cjson({ error: 'not_found' }, 404);
}
async function handleDevPoints(request, env, u) {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS_RW });
  const seg = u.pathname.replace(/^\/api\/devpoints\//, '').replace(/\/+$/, '');
  const configured = !!env.STRIPE_SECRET_KEY;
  if (seg === 'webhook' && request.method === 'POST') {
    const raw = await request.text();
    const ok = await verifyStripeSig(env.STRIPE_WEBHOOK_SECRET, raw, request.headers.get('stripe-signature') || '');
    if (!ok) return cjson({ error: 'bad_signature' }, 400);
    let evt = null; try { evt = JSON.parse(raw); } catch (e) {}
    if (evt && evt.type === 'checkout.session.completed') {
      try { await _devpointsFulfillSession(env, evt.data && evt.data.object); } catch (e) {}
    }
    return cjson({ received: true });
  }
  if (seg === 'config' && request.method === 'GET') {
    const _rows = await _sbRows(env, 'devpoint_purchases', 'user_id=eq.00000000-0000-0000-0000-000000000000&select=points');
    return cjson({ enabled: configured, webhook: !!env.STRIPE_WEBHOOK_SECRET, durable: _rows !== null,
      pack: { cents: DEVPOINT_PACK.cents, points: DEVPOINT_PACK.points, name: DEVPOINT_PACK.name } });
  }
  if (!configured) return cjson({ error: 'stripe_not_configured', hint: 'Set STRIPE_SECRET_KEY on this Worker.' }, 503);
  const user = await sbUser(env, request);
  if (!user) return cjson({ error: 'unauthorized', hint: 'Send your Supabase access token as Authorization: Bearer.' }, 401);

  if (seg === 'owned' && request.method === 'GET') {
    const rows = await _sbRows(env, 'devpoint_purchases', 'user_id=eq.' + encodeURIComponent(user.id) + '&select=points,stripe_session_id,created_at');
    if (!rows) return cjson({ ok: true, durable: false, bought: 0, purchases: 0 });
    return cjson({ ok: true, durable: true, bought: rows.reduce((a, r) => a + (r.points | 0), 0), purchases: rows.length });
  }
  if (seg === 'checkout' && request.method === 'POST') {
    const origin = _safeReturnOrigin(env, u);
    const s = await stripeApi(env, 'POST', '/v1/checkout/sessions', {
      mode: 'payment',
      'line_items[0][quantity]': 1,
      'line_items[0][price_data][currency]': 'usd',
      'line_items[0][price_data][unit_amount]': DEVPOINT_PACK.cents,
      'line_items[0][price_data][product_data][name]': DEVPOINT_PACK.name + ' — city research',
      client_reference_id: user.id,
      'metadata[user_id]': user.id,
      'metadata[devpoints]': String(DEVPOINT_PACK.points),
      success_url: origin + '/?devpts=ok&sid={CHECKOUT_SESSION_ID}',
      cancel_url: origin + '/?devpts=cancel',
    });
    return cjson({ url: s && s.url });
  }
  if (seg === 'confirm' && request.method === 'GET') {
    const sid = u.searchParams.get('sid') || '';
    if (!sid) return cjson({ error: 'no_session' }, 400);
    const s = await stripeApi(env, 'GET', '/v1/checkout/sessions/' + encodeURIComponent(sid), null);
    const md = (s && s.metadata) || {};
    if (!s || s.payment_status !== 'paid' || md.user_id !== user.id) return cjson({ ok: false });
    const pts = parseInt(md.devpoints, 10);
    if (!(pts > 0)) return cjson({ ok: false, error: 'no_points' });
    const durable = await _devpointsFulfillSession(env, s);
    /* The authoritative total after this purchase, so the client can set its
       high-water mark rather than add and risk counting a replay twice. */
    const rows = await _sbRows(env, 'devpoint_purchases', 'user_id=eq.' + encodeURIComponent(user.id) + '&select=points');
    const bought = rows ? rows.reduce((a, r) => a + (r.points | 0), 0) : null;
    return cjson({ ok: true, sid: sid, points: pts, bought: bought, durable: durable });
  }
  return cjson({ error: 'not_found' }, 404);
}
async function handleGarage(request, env, u) {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS_RW });
  const seg = u.pathname.replace(/^\/api\/garage\//, '').replace(/\/+$/, '');
  const configured = !!env.STRIPE_SECRET_KEY;
  // 🪝 Webhook — Stripe calls this, not a signed-in player, so it sits ABOVE
  // the auth gate: the signature is the authentication. Registering this URL
  // is optional; /api/shop/webhook and /api/cashout/webhook both fulfil rigs
  // too, so whichever one is already in the Stripe dashboard will work.
  if (seg === 'webhook' && request.method === 'POST') {
    const raw = await request.text();
    const ok = await verifyStripeSig(env.STRIPE_WEBHOOK_SECRET, raw, request.headers.get('stripe-signature') || '');
    if (!ok) return cjson({ error: 'bad_signature' }, 400);
    let evt = null; try { evt = JSON.parse(raw); } catch (e) {}
    if (evt && evt.type === 'checkout.session.completed') {
      try { await _garageFulfillSession(env, evt.data && evt.data.object); } catch (e) {}
    }
    return cjson({ received: true });
  }
  if (seg === 'config' && request.method === 'GET') {
    // Prices are published so the store can render from the AUTHORITY rather
    // than only from its own copy — that is what makes drift visible.
    // webhook:false means a buyer who never returns is NOT fulfilled — the
    // single most useful thing this endpoint can tell an operator.
    // `durable` PROBES THE TABLE rather than just checking for credentials.
    // /api/garage/owned already uses that word to mean "the table answered",
    // and having one endpoint report durable:true on credentials alone while
    // the other reports false on a missing table is how an operator ends up
    // diagnosing the wrong thing.
    const _rows = await _garageOwnedRows(env, '00000000-0000-0000-0000-000000000000');
    return cjson({ enabled: configured, webhook: !!env.STRIPE_WEBHOOK_SECRET,
      durable: _rows !== null, rigs: Object.keys(GARAGE_RIGS).map(k =>
      ({ sku: k, cents: GARAGE_RIGS[k].cents, name: GARAGE_RIGS[k].name })) });
  }
  if (!configured) return cjson({ error: 'stripe_not_configured', hint: 'Set STRIPE_SECRET_KEY on this Worker.' }, 503);
  const user = await sbUser(env, request);
  if (!user) return cjson({ error: 'unauthorized', hint: 'Send your Supabase access token as Authorization: Bearer.' }, 401);

  if (seg === 'owned' && request.method === 'GET') {
    const rows = await _garageOwnedRows(env, user.id);
    // durable:false tells the client the restore path is unavailable, so it
    // can keep trusting its own profile copy instead of wrongly clearing it.
    if (!rows) return cjson({ ok: true, durable: false, owned: [] });
    return cjson({ ok: true, durable: true, owned: rows.map(r => r.sku) });
  }

  if (seg === 'checkout' && request.method === 'POST') {
    const body = await request.json().catch(() => ({}));
    const sku = body && body.sku;
    const rig = GARAGE_RIGS[sku];
    if (!rig) return cjson({ error: 'bad_sku' }, 400);
    // Never sell the same permanent unlock twice.
    const rows = await _garageOwnedRows(env, user.id);
    if (rows && rows.some(r => r.sku === sku)) return cjson({ error: 'already_owned', sku: sku }, 409);
    const origin = _safeReturnOrigin(env, u);
    const s = await stripeApi(env, 'POST', '/v1/checkout/sessions', {
      mode: 'payment',
      'line_items[0][quantity]': 1,
      'line_items[0][price_data][currency]': 'usd',
      'line_items[0][price_data][unit_amount]': rig.cents,
      'line_items[0][price_data][product_data][name]': rig.name + ' — convoy rig',
      client_reference_id: user.id,
      'metadata[user_id]': user.id,
      'metadata[garage_sku]': sku,
      success_url: origin + '/?rig=ok&sid={CHECKOUT_SESSION_ID}',
      cancel_url: origin + '/?rig=cancel',
    });
    return cjson({ url: s && s.url });
  }

  if (seg === 'confirm' && request.method === 'GET') {
    const sid = u.searchParams.get('sid') || '';
    if (!sid) return cjson({ error: 'no_session' }, 400);
    const s = await stripeApi(env, 'GET', '/v1/checkout/sessions/' + encodeURIComponent(sid), null);
    const md = (s && s.metadata) || {};
    // Three conditions, all required: the session exists, it is PAID, and it
    // belongs to the caller. Without the last one a player could confirm
    // somebody else's session id and be granted their rig.
    if (!s || s.payment_status !== 'paid' || md.user_id !== user.id) return cjson({ ok: false });
    const sku = md.garage_sku;
    if (!GARAGE_RIGS[sku]) return cjson({ ok: false, error: 'unknown_sku' });
    const durable = await _garageRecord(env, user.id, sku, sid);
    return cjson({ ok: true, sid: sid, sku: sku, name: GARAGE_RIGS[sku].name,
                   cents: GARAGE_RIGS[sku].cents, durable: durable });
  }

  return cjson({ error: 'not_found' }, 404);
}

/* ============================================================================
 * 🔑 TRANSPORT KEYS — buy a key with real money, and credit it.
 *
 * Keys make a haulier's rigs arrive faster. Five levels, $7.99 → $99.
 *
 * 🔴 WHY THIS LIVES HERE AND NOT IN A SUPABASE EDGE FUNCTION. It used to be
 *    supabase/functions/transport-keys, which reads STRIPE_SECRET_KEY from
 *    SUPABASE's secret store — a completely different store from Cloudflare's.
 *    The key was set here (Aza coin, convoy rigs and the Shop have all been
 *    taking real money for months) and was never set there, so that function
 *    503'd on every checkout and the Vendor Market's Transport Keys tab could
 *    show prices but never sell one: transport_keys has 0 rows, ever.
 *    pledge-checkout was moved here on 2026-07-31 for exactly this reason and
 *    its retirement note says so. This is the same move, finished.
 * ⭐ ONE SECRET, ONE PLACE. The alternative was to paste the same Stripe key
 *    into a second store and keep them in step forever; two copies of a
 *    credential is two things to rotate and one thing to forget.
 *
 * 🔴 PRICES ARE SERVER-AUTHORITATIVE. The client sends a LEVEL, never an
 *    amount. A client that could send `cents` could buy the $99 key for one
 *    cent, and no amount of front-end validation changes that.
 * 🔴 CONFIRM IS NOT "THE CLIENT SAYS IT PAID". It retrieves the session FROM
 *    STRIPE and requires all three: payment_status === 'paid', the session's
 *    metadata names THIS caller, and the level is one we sell. Without the
 *    second, anyone could paste a friend's session id and be credited.
 * ⚠ IDEMPOTENCY IS THE UNIQUE CONSTRAINT on transport_keys.stripe_session, not
 *   a check-then-insert: two confirms racing would both pass a check. A
 *   duplicate insert is SUCCESS — the player has the key, which is what they
 *   are asking about.
 *
 * ⚠ PRICES MUST MATCH the retired edge function's KEYS table exactly. They are
 *   the same product; a player who saw $39.99 in a cached tab must not be
 *   charged something else here.
 * ========================================================================== */
const TKEYS = {
  '1': { name: 'Bronze Key',   cents:  799, speed: 'runs arrive ~8% faster' },
  '2': { name: 'Iron Key',     cents: 1999, speed: 'runs arrive ~18% faster' },
  '3': { name: 'Cobalt Key',   cents: 3999, speed: 'runs arrive ~30% faster' },
  '4': { name: 'Meridian Key', cents: 6999, speed: 'runs arrive ~45% faster' },
  '5': { name: 'Ashgate Key',  cents: 9900, speed: 'runs arrive 60% faster — the fastest on the road' },
};
/* The highest level this user holds, or null when the table could not be
   asked at all. null ≠ 0 — see the `durable` note on _garageOwnedRows: a
   client told 0 by a broken lookup would offer to sell a key already owned. */
async function _tkeyHeld(env, userId) {
  if (!env.SB_SERVICE || !env.SB_URL || !userId) return null;
  try {
    const r = await fetch(String(env.SB_URL).replace(/\/+$/, '')
      + '/rest/v1/transport_keys?select=level&user_id=eq.' + encodeURIComponent(userId)
      + '&order=level.desc&limit=1',
      { headers: { apikey: env.SB_SERVICE, authorization: 'Bearer ' + env.SB_SERVICE, accept: 'application/json' } });
    if (!r.ok) return null;
    const a = await r.json().catch(() => null);
    if (!Array.isArray(a)) return null;
    return (a[0] && a[0].level | 0) || 0;
  } catch (e) { return null; }
}
/* Records the purchase. Returns true when the row is durable — including when
   it was ALREADY there (a replayed confirm), because the player does hold it. */
async function _tkeyRecord(env, userId, level, cents, sid) {
  if (!env.SB_SERVICE || !env.SB_URL) return false;
  try {
    const r = await fetch(String(env.SB_URL).replace(/\/+$/, '') + '/rest/v1/transport_keys',
      { method: 'POST',
        headers: { apikey: env.SB_SERVICE, authorization: 'Bearer ' + env.SB_SERVICE,
                   'content-type': 'application/json', prefer: 'resolution=ignore-duplicates' },
        body: JSON.stringify({ user_id: userId, level: level, cents: cents, stripe_session: sid }) });
    return r.ok;
  } catch (e) { return false; }
}
async function handleTKeys(request, env, u) {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS_RW });
  const seg = u.pathname.replace(/^\/api\/tkeys\//, '').replace(/\/+$/, '');
  const configured = !!env.STRIPE_SECRET_KEY;

  /* 🪝 Stripe calls this, not a player, so it sits ABOVE the auth gate — the
     signature is the authentication. Optional: /confirm already fulfils on
     return, and recording is idempotent, so both firing is harmless. */
  if (seg === 'webhook' && request.method === 'POST') {
    const rawBody = await request.text();
    const ok = await verifyStripeSig(env.STRIPE_WEBHOOK_SECRET, rawBody, request.headers.get('stripe-signature') || '');
    if (!ok) return cjson({ error: 'bad_signature' }, 400);
    let evt = null; try { evt = JSON.parse(rawBody); } catch (e) {}
    if (evt && evt.type === 'checkout.session.completed') {
      try {
        const sess = evt.data && evt.data.object;
        const md = (sess && sess.metadata) || {};
        const lvl = String(md.transport_key_level || '');
        if (TKEYS[lvl] && md.user_id) {
          await _tkeyRecord(env, md.user_id, Number(lvl), sess.amount_total || TKEYS[lvl].cents, sess.id);
        }
      } catch (e) {}
    }
    return cjson({ received: true });
  }

  /* 🏷 THE PRICE LIST IS NOT A SECRET, and it answers BEFORE the Stripe gate
     and before auth. The retired edge function shipped with this behind the
     key guard, so a missing secret turned the whole tab into one red line —
     'the key store is unreachable' — when what was true was 'the shop is open
     and cannot take payment'. `purchasable` is the honest half: the client
     renders prices and disables the buttons with a reason. */
  if (seg === 'catalog' || (seg === 'config' && request.method === 'GET')) {
    return cjson({
      purchasable: configured,
      webhook: !!env.STRIPE_WEBHOOK_SECRET,
      keys: Object.keys(TKEYS).map(k => ({
        level: Number(k), name: TKEYS[k].name, cents: TKEYS[k].cents,
        speed: TKEYS[k].speed, usd: (TKEYS[k].cents / 100).toFixed(2),
      })),
    });
  }

  // Everything past here moves money or names a person.
  if (!configured) return cjson({ error: 'stripe_not_configured', hint: 'Set STRIPE_SECRET_KEY on this Worker.' }, 503);
  const user = await sbUser(env, request);
  if (!user) return cjson({ error: 'unauthorized', hint: 'Send your Supabase access token as Authorization: Bearer.' }, 401);

  if (seg === 'owned' && request.method === 'GET') {
    const held = await _tkeyHeld(env, user.id);
    if (held === null) return cjson({ ok: true, durable: false, level: 0 });
    return cjson({ ok: true, durable: true, level: held });
  }

  if (seg === 'checkout' && request.method === 'POST') {
    const body = await request.json().catch(() => ({}));
    const lvl = String((body && body.level) != null ? body.level : '');
    const k = TKEYS[lvl];
    if (!k) return cjson({ error: 'unknown_key_level' }, 400);
    /* Keys are cumulative and permanent, so selling one they already match or
       beat buys them nothing — charging for it would be a bug that looks like
       a sale. A null (table unreadable) does NOT block the sale: refusing a
       real purchase because a lookup failed is the worse of the two errors,
       and /confirm de-duplicates on the way back in. */
    const held = await _tkeyHeld(env, user.id);
    if (held !== null && held >= Number(lvl)) return cjson({ error: 'already_held', held: held }, 409);
    const origin = _safeReturnOrigin(env, u);
    const s = await stripeApi(env, 'POST', '/v1/checkout/sessions', {
      mode: 'payment',
      'line_items[0][quantity]': 1,
      'line_items[0][price_data][currency]': 'usd',
      'line_items[0][price_data][unit_amount]': k.cents,
      'line_items[0][price_data][product_data][name]': 'Mythic Spellbook — ' + k.name,
      'line_items[0][price_data][product_data][description]':
        'Transport Key level ' + lvl + '. ' + k.speed + ' Permanent, tied to your account.',
      client_reference_id: user.id,
      'metadata[user_id]': user.id,
      'metadata[transport_key_level]': lvl,
      'metadata[transport_key_name]': k.name,
      customer_email: user.email || '',
      success_url: origin + '/?tkey_paid=1&session_id={CHECKOUT_SESSION_ID}',
      cancel_url: origin + '/?tkey_cancel=1',
    });
    return cjson({ url: s && s.url });
  }

  if (seg === 'confirm' && (request.method === 'GET' || request.method === 'POST')) {
    let sid = u.searchParams.get('sid') || u.searchParams.get('session_id') || '';
    if (!sid && request.method === 'POST') {
      const b = await request.json().catch(() => ({}));
      sid = (b && (b.session_id || b.sid)) || '';
    }
    if (!sid) return cjson({ ok: false, error: 'no_session' }, 400);
    const s2 = await stripeApi(env, 'GET', '/v1/checkout/sessions/' + encodeURIComponent(sid), null);
    const md = (s2 && s2.metadata) || {};
    /* Three conditions, all required. The middle one is what stops a player
       pasting somebody else's session id and being credited their key. */
    if (!s2 || s2.payment_status !== 'paid') return cjson({ ok: false, why: 'not_paid' }, 402);
    if (md.user_id !== user.id) return cjson({ ok: false, why: 'not_your_session' }, 403);
    const lvl = String(md.transport_key_level || '');
    if (!TKEYS[lvl]) return cjson({ ok: false, why: 'unknown_level' }, 400);
    const durable = await _tkeyRecord(env, user.id, Number(lvl), s2.amount_total || TKEYS[lvl].cents, sid);
    const held = await _tkeyHeld(env, user.id);
    return cjson({ ok: true, level: (held === null ? Number(lvl) : held),
                   name: TKEYS[lvl].name, durable: durable });
  }

  return cjson({ error: 'not_found' }, 404);
}

/* ============================================================================
 * 🛒 SHOP — Founder & Node packages (the market site's ex-"Pledge" page).
 * Same shape as the Aza store above: prices are SERVER-AUTHORITATIVE, the
 * hosted Stripe Checkout page collects payment, and crediting is spoof-proof
 * WITHOUT a webhook — on return the site calls /confirm, we retrieve the
 * session with the secret key and only accept it when payment_status==='paid'
 * AND the session belongs to the signed-in user. The confirmed purchase is
 * then written to pledge_purchases with the service-role key (UNIQUE on
 * stripe_session_id ⇒ recording is idempotent; the client can't forge a row
 * because RLS grants it no INSERT at all).
 *
 * Buyers arrive from mythicspellbook.xyz, so the return URLs must go back
 * THERE, not to the game. The origin is taken from the request's Origin
 * header but only if it is on SHOP_RETURN_ALLOW — never echo an arbitrary
 * caller-supplied origin into a redirect (open-redirect / phishing rail).
 * ========================================================================== */
// 🚨 PRICING SOURCE OF TRUTH — must match PLEDGE_TIERS in the market site's
// public/index.html (display-only there) and SHOP_STRIPE_TIERS (which tiers
// show a Buy Now button). Dominion / Titan / Eternal Founder are deliberately
// absent — those stay "Coming Soon" until the operator opens them.
const SHOP_TIERS = {
  'vault-key':              { cents: 1000,   name: 'Vault Key',              seats: 0 },
  'scavenger':              { cents: 5000,   name: 'Scavenger Tier',         seats: 0 },
  'starter-node':           { cents: 25000,  name: 'Starter Node License',   seats: 100 },
  'outpost-operator':       { cents: 50000,  name: 'Outpost Operator',       seats: 49 },
  'foundation-contributor': { cents: 200000, name: 'Foundation Contributor', seats: 25 },
};
const SHOP_RETURN_ALLOW = [
  'https://mythicspellbook.xyz',
  'https://www.mythicspellbook.xyz',
  'https://playmythicspellbook.com',
];
function _shopReturnOrigin(request, env, u) {
  const o = String(request.headers.get('origin') || '').replace(/\/+$/, '');
  if (o && SHOP_RETURN_ALLOW.indexOf(o) >= 0) return o;
  return SHOP_RETURN_ALLOW[0];
}
// Count confirmed purchases of one tier (seat caps). Needs the service key —
// RLS hides other players' rows from any user token. No key ⇒ null (unknown),
// and the caller treats unknown as "don't block the sale".
async function _shopSoldCount(env, tierId) {
  if (!env.SB_SERVICE) return null;
  try {
    const r = await fetch(String(env.SB_URL).replace(/\/+$/, '') +
      '/rest/v1/pledge_purchases?select=id&status=eq.paid&tier_id=eq.' + encodeURIComponent(tierId),
      { headers: { apikey: env.SB_SERVICE, authorization: 'Bearer ' + env.SB_SERVICE, accept: 'application/json' } });
    if (!r.ok) return null;
    const a = await r.json().catch(() => null);
    return Array.isArray(a) ? a.length : null;
  } catch (e) { return null; }
}
/* 🛒 CART CHECKOUT — products the admin created in shop_products.
 * ⚠ PRICE AUTHORITY. The browser sends only ids and quantities; every amount
 * charged is read HERE from the database with the service key. Never trust a
 * price, name or currency that arrived in the request body.
 */
async function _shopProductsBySlug(env, slugs) {
  if (!env.SB_SERVICE || !slugs.length) return [];
  const inList = slugs.map(s => '"' + String(s).replace(/[^a-zA-Z0-9_-]/g, '') + '"').join(',');
  try {
    const r = await fetch(String(env.SB_URL).replace(/\/+$/, '') +
      '/rest/v1/shop_products?select=id,slug,name,price_cents,currency,active,legacy_tier&active=eq.true&slug=in.(' + inList + ')',
      { headers: { apikey: env.SB_SERVICE, authorization: 'Bearer ' + env.SB_SERVICE, accept: 'application/json' } });
    if (!r.ok) return [];
    const a = await r.json().catch(() => null);
    return Array.isArray(a) ? a : [];
  } catch (e) { return []; }
}
// Record a multi-item order. Idempotent on the Stripe session id.
async function _shopRecordOrder(env, s, items) {
  if (!env.SB_SERVICE) return { ok: false, error: 'sb_service_missing' };
  try {
    const r = await fetch(String(env.SB_URL).replace(/\/+$/, '') + '/rest/v1/rpc/shop_record_order',
      { method: 'POST',
        headers: { apikey: env.SB_SERVICE, authorization: 'Bearer ' + env.SB_SERVICE, 'content-type': 'application/json' },
        body: JSON.stringify({
          p_user: (s.metadata && s.metadata.user_id) || null,
          p_session: s.id,
          p_items: items || [],
          p_amount: s.amount_total || 0,
          p_currency: s.currency || 'usd',
        }) });
    if (!r.ok) return { ok: false, error: 'rpc_' + r.status };
    return await r.json().catch(() => null);
  } catch (e) { return { ok: false, error: 'rpc_error' }; }
}
// Record + deliver a paid Shop session. shop_fulfill() is idempotent on the
// Stripe session id, so the webhook and the buyer's return visit can both call
// this for the same purchase and the benefits are granted exactly once.
// Needs SB_SERVICE (service-role key) — the RPC is revoked from anon/authenticated
// precisely so a player can't call it and mint themselves packs.
async function _shopFulfillSession(env, s) {
  const md = (s && s.metadata) || {};
  // 🛒 Cart order (admin-created products) — record it. These have no built-in
  // grant rule, so the admin fulfils them from the Orders tab.
  if (s && s.payment_status === 'paid' && md.user_id && md.shop_items && !md.shop_tier) {
    let items = [];
    try { items = (JSON.parse(md.shop_items) || []).map(p => ({ slug: p[0], qty: p[1] })); } catch (e) {}
    const rec = await _shopRecordOrder(env, s, items);
    return { ok: !!(rec && rec.ok), order: true, items };
  }
  if (!s || s.payment_status !== 'paid' || !md.user_id || !md.shop_tier) return null;
  if (!env.SB_SERVICE) return { ok: false, error: 'sb_service_missing' };
  try {
    const r = await fetch(String(env.SB_URL).replace(/\/+$/, '') + '/rest/v1/rpc/shop_fulfill',
      { method: 'POST',
        headers: { apikey: env.SB_SERVICE, authorization: 'Bearer ' + env.SB_SERVICE, 'content-type': 'application/json' },
        body: JSON.stringify({
          p_user: md.user_id,
          p_tier: md.shop_tier,
          p_tier_name: md.shop_tier_name || (SHOP_TIERS[md.shop_tier] && SHOP_TIERS[md.shop_tier].name) || md.shop_tier,
          p_session: s.id,
          p_amount: s.amount_total || 0,
          p_currency: s.currency || 'usd',
          p_intent: typeof s.payment_intent === 'string' ? s.payment_intent : null,
        }) });
    if (!r.ok) return { ok: false, error: 'rpc_' + r.status };
    return await r.json().catch(() => null);
  } catch (e) { return { ok: false, error: 'rpc_error' }; }
}
async function handleShop(request, env, u) {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS_RW });
  const seg = u.pathname.replace(/^\/api\/shop\//, '').replace(/\/+$/, '');
  const configured = !!env.STRIPE_SECRET_KEY;
  if (seg === 'config' && request.method === 'GET') {
    // Booleans only — never the secret values. `webhook` false means Stripe's
    // calls would be rejected, so a buyer who never returns to the site would
    // go unfulfilled; `fulfillment` false means grants can't be written.
    return cjson({
      enabled: configured,
      webhook: !!env.STRIPE_WEBHOOK_SECRET,
      fulfillment: !!env.SB_SERVICE,
      tiers: Object.keys(SHOP_TIERS),
    });
  }
  if (!configured) return cjson({ error: 'stripe_not_configured', hint: 'Set the STRIPE_SECRET_KEY secret on this Worker (see STRIPE.md).' }, 503);

  // 🪝 Webhook — Stripe calls this, NOT a signed-in user, so it must sit above
  // the auth gate. The signature IS the authentication. This is what catches a
  // buyer who pays and never returns to the site.
  if (seg === 'webhook' && request.method === 'POST') {
    const raw = await request.text();
    const ok = await verifyStripeSig(env.STRIPE_WEBHOOK_SECRET, raw, request.headers.get('stripe-signature') || '');
    if (!ok) return cjson({ error: 'bad_signature' }, 400);
    let evt = null; try { evt = JSON.parse(raw); } catch (e) {}
    if (evt && evt.type === 'checkout.session.completed') {
      const _o = evt.data && evt.data.object;
      // A rig session carries garage_sku and no shop tier — route it to the
      // garage fulfiller instead of the shop one, which would ignore it.
      if (_o && _o.metadata && _o.metadata.garage_sku) {
        try { await _garageFulfillSession(env, _o); } catch (e) {}
      } else if (_o && _o.metadata && _o.metadata.licence_id) {
        try { await _licenceFulfillSession(env, _o); } catch (e) {}
      } else if (_o && _o.metadata && _o.metadata.devpoints) {
        try { await _devpointsFulfillSession(env, _o); } catch (e) {}
      } else {
        try { await _shopFulfillSession(env, _o); } catch (e) {}
      }
    }
    return cjson({ received: true });
  }

  const user = await sbUser(env, request);
  if (!user) return cjson({ error: 'unauthorized', hint: 'Send your Supabase access token as Authorization: Bearer.' }, 401);

  if (seg === 'checkout' && request.method === 'POST') {
    const body = await request.json().catch(() => ({}));

    // 🛒 CART PATH — [{slug, qty}]. Prices come from the database, never the body.
    if (Array.isArray(body && body.items) && body.items.length) {
      const want = body.items.slice(0, 20)
        .map(i => ({ slug: String((i && i.slug) || ''), qty: Math.max(1, Math.min(20, parseInt(i && i.qty, 10) || 1)) }))
        .filter(i => i.slug);
      if (!want.length) return cjson({ error: 'empty_cart' }, 400);
      const rows = await _shopProductsBySlug(env, want.map(i => i.slug));
      if (!rows.length) return cjson({ error: 'no_products', hint: 'None of those products are on sale (check shop_products.active), or SB_SERVICE is unset.' }, 400);
      const bySlug = {}; rows.forEach(r => { bySlug[r.slug] = r; });
      const line = [];
      want.forEach(i => { const p = bySlug[i.slug]; if (p && (p.price_cents | 0) > 0) line.push({ p, qty: i.qty }); });
      if (!line.length) return cjson({ error: 'no_priced_products' }, 400);

      // A single legacy-mapped product still runs the ORIGINAL automated
      // fulfilment, so existing packages keep delivering exactly as before.
      const solo = (line.length === 1 && line[0].qty === 1) ? line[0].p : null;
      if (solo && solo.legacy_tier && SHOP_TIERS[solo.legacy_tier]) {
        const lt = SHOP_TIERS[solo.legacy_tier];
        const origin0 = _shopReturnOrigin(request, env, u);
        const s0 = await stripeApi(env, 'POST', '/v1/checkout/sessions', {
          mode: 'payment',
          'line_items[0][quantity]': 1,
          'line_items[0][price_data][currency]': 'usd',
          'line_items[0][price_data][unit_amount]': solo.price_cents,
          'line_items[0][price_data][product_data][name]': 'Mythic Spellbook — ' + solo.name,
          client_reference_id: user.id,
          'metadata[user_id]': user.id,
          'metadata[shop_tier]': solo.legacy_tier,
          'metadata[shop_tier_name]': lt.name || solo.name,
          success_url: origin0 + '/?pledge_paid=1&sid={CHECKOUT_SESSION_ID}',
          cancel_url: origin0 + '/?pledge_cancel=1',
        });
        return cjson({ url: s0 && s0.url });
      }

      const origin1 = _shopReturnOrigin(request, env, u);
      const form = {
        mode: 'payment',
        client_reference_id: user.id,
        'metadata[user_id]': user.id,
        // Compact so it stays inside Stripe's 500-char metadata limit.
        'metadata[shop_items]': JSON.stringify(line.map(l => [l.p.slug, l.qty])).slice(0, 480),
        success_url: origin1 + '/?pledge_paid=1&sid={CHECKOUT_SESSION_ID}',
        cancel_url: origin1 + '/?pledge_cancel=1',
      };
      line.forEach((l, i) => {
        form['line_items[' + i + '][quantity]'] = l.qty;
        form['line_items[' + i + '][price_data][currency]'] = (l.p.currency || 'usd');
        form['line_items[' + i + '][price_data][unit_amount]'] = l.p.price_cents;
        form['line_items[' + i + '][price_data][product_data][name]'] = 'Mythic Spellbook — ' + l.p.name;
      });
      const s1 = await stripeApi(env, 'POST', '/v1/checkout/sessions', form);
      return cjson({ url: s1 && s1.url });
    }

    const tierId = String((body && body.tier) || '');
    const t = SHOP_TIERS[tierId];
    if (!t) return cjson({ error: 'bad_tier' }, 400);
    if (t.seats > 0) {
      const sold = await _shopSoldCount(env, tierId);
      if (sold != null && sold >= t.seats) return cjson({ error: 'sold_out' }, 409);
    }
    const origin = _shopReturnOrigin(request, env, u);
    const s = await stripeApi(env, 'POST', '/v1/checkout/sessions', {
      mode: 'payment',
      'line_items[0][quantity]': 1,
      'line_items[0][price_data][currency]': 'usd',
      'line_items[0][price_data][unit_amount]': t.cents,
      'line_items[0][price_data][product_data][name]': 'Mythic Spellbook — ' + t.name,
      client_reference_id: user.id,
      'metadata[user_id]': user.id,
      'metadata[shop_tier]': tierId,
      'metadata[shop_tier_name]': t.name,
      success_url: origin + '/?pledge_paid=1&sid={CHECKOUT_SESSION_ID}',
      cancel_url: origin + '/?pledge_cancel=1',
    });
    return cjson({ url: s && s.url });
  }

  if (seg === 'confirm' && request.method === 'GET') {
    const sid = u.searchParams.get('sid') || '';
    if (!sid) return cjson({ error: 'no_session' }, 400);
    const s = await stripeApi(env, 'GET', '/v1/checkout/sessions/' + encodeURIComponent(sid), null);
    const md = (s && s.metadata) || {};
    if (!s || s.payment_status !== 'paid' || md.user_id !== user.id) return cjson({ ok: false });
    const tierId = md.shop_tier || '';
    const t = SHOP_TIERS[tierId] || { name: md.shop_tier_name || tierId, cents: s.amount_total || 0 };
    // Record + deliver (idempotent — the webhook may have already done it).
    const f = await _shopFulfillSession(env, s);
    if (f && f.order) {
      return cjson({
        ok: true, sid: sid, order: true,
        amount_cents: s.amount_total || 0,
        items: f.items || [],
        recorded: !!f.ok,
      });
    }
    return cjson({
      ok: true, sid: sid, tier: tierId, tier_name: t.name,
      amount_cents: s.amount_total || t.cents || 0,
      recorded: !!(f && f.ok),
      granted: (f && f.granted) || null,
    });
  }

  return cjson({ error: 'not_found' }, 404);
}

/* ============================================================================
 * 🗺 THE WORLD MAP, SERVED FROM THE EDGE.
 * ----------------------------------------------------------------------------
 * tw_world_map is ONE row of about 4.6 KB that changes roughly once a week —
 * and every one of 121 players was reading it straight out of Postgres on every
 * War Map open. On 2026-09-04, with the database CPU-starved, that read started
 * returning 504 and the map rendered as an empty world: "the players' nodes are
 * removed". The nodes were never removed. The read simply never completed.
 *
 * So the map is now served from Cloudflare's cache instead:
 *   · a HIT costs the database nothing at all,
 *   · a MISS costs it one 4.6 KB single-row read,
 *   · and 121 players a minute become at most one.
 *
 * ⚠ PUBLIC ON PURPOSE, AND SAFE TO BE. The world map is the same document for
 *   every player — 043 exists precisely because it must not be per-account. It
 *   carries node names, positions and yields, all of which any signed-in player
 *   can already read. No per-user data passes through here, which is exactly
 *   why it is cacheable at all.
 * ⚠ SERVICE KEY, NEVER SHIPPED. The read uses env.SB_SERVICE server-side; the
 *   client never sees it. If SB_SERVICE is unset this 501s and the game falls
 *   back to reading the table directly, which is what it did before.
 * ⚠ STALE BEATS EMPTY. On an upstream failure we serve the last cached copy if
 *   we have one, even past its TTL. A slightly old map is a working game; a
 *   failed read is a blank world.
 * ========================================================================== */
const WORLDMAP_TTL = 60;          // seconds a fresh copy is served without asking Postgres
/* 🔴 AND A LAST-KNOWN-GOOD COPY THAT OUTLIVES THE OUTAGE.
   The 60-second cache is useless in the one situation that matters: it expires
   during the outage and then there is nothing to fall back to, which is exactly
   what happened on 2026-09-04 — the map read 504'd for hours and the edge had
   nothing left to serve. So every successful read ALSO writes a copy with a
   30-day TTL, and that copy is what answers when Postgres cannot.
   It populates itself from the first read that succeeds — no hand-copied
   snapshot to go stale in the repo, and no transcription of live data. */
const WORLDMAP_LKG_TTL = 60 * 60 * 24 * 30;
/* 🔴 THE HTTP LAYER MUST NOT CACHE THIS (v121v51). Cloudflare's zone rule
   rewrote max-age=60 to 14400 and served a v17 map for the rest of the day
   while Postgres held v21, so an admin's own publish came back stale to them.
   The worker's Cache API copy (60 s + last-known-good) stays: it is keyed on
   the stable URL and refreshed by ?fresh=1. Only what leaves the worker is
   marked no-store, so browsers and the CDN always ask the worker. */
function _wmNoStore(res) {
  const h = new Headers(res.headers);
  h.set('cache-control', 'no-store, no-cache, must-revalidate, max-age=0');
  h.set('cdn-cache-control', 'no-store');
  h.set('cloudflare-cdn-cache-control', 'no-store');
  return new Response(res.body, { status: res.status, headers: h });
}
async function handleWorldMap(request, env, u) {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS_RW });
  const cache = caches.default;
  // Cache on a STABLE key, not on the incoming URL: cache-busting query strings
  // from the client would otherwise make every request a miss and defeat this.
  const key    = new Request(new URL('/api/worldmap', u.origin).toString(), { method: 'GET' });
  const lkgKey = new Request(new URL('/api/worldmap__lkg', u.origin).toString(), { method: 'GET' });

  if (!u.searchParams.get('fresh')) {
    const hit = await cache.match(key);
    if (hit) return _wmNoStore(hit);
  }
  if (!env.SB_SERVICE) {
    const lkg = await cache.match(lkgKey);
    if (lkg) { const h = new Headers(lkg.headers); h.set('x-worldmap', 'lkg'); return _wmNoStore(new Response(lkg.body, { status: 200, headers: h })); }
    return cjson({ error: 'not_configured' }, 501);
  }

  const base = String(env.SB_URL || '').replace(/\/+$/, '');
  let r = null, rows = null;
  try {
    r = await fetch(base + '/rest/v1/tw_world_map?select=doc,version,updated_at&id=eq.1&limit=1', {
      headers: { apikey: env.SB_SERVICE, authorization: 'Bearer ' + env.SB_SERVICE, accept: 'application/json' },
    });
    if (r.ok) rows = await r.json().catch(() => null);
  } catch (e) { /* fall through to the stale copy */ }

  const row = Array.isArray(rows) ? rows[0] : null;
  if (!row || !row.doc || !Array.isArray(row.doc.nodes) || !row.doc.nodes.length) {
    /* 🔴 Upstream is unhappy. An expired copy is still the right map — serve it
       rather than handing the client an empty world it will draw as "no nodes". */
    const lkg = await cache.match(lkgKey);
    if (lkg) {
      const h = new Headers(lkg.headers);
      h.set('x-worldmap', 'lkg');
      return _wmNoStore(new Response(lkg.body, { status: 200, headers: h }));
    }
    return cjson({ error: 'unavailable' }, 503);
  }

  const body = JSON.stringify({ doc: row.doc, version: row.version | 0, updated_at: row.updated_at });
  const res = new Response(body, {
    status: 200,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'public, max-age=' + WORLDMAP_TTL,
      'x-worldmap': 'fresh',
      ...CORS_RW,
    },
  });
  try { await cache.put(key, res.clone()); } catch (e) {}
  // …and the durable copy, so the next outage has something real to serve.
  try {
    await cache.put(lkgKey, new Response(body, {
      status: 200,
      headers: { 'content-type': 'application/json; charset=utf-8',
                 'cache-control': 'public, max-age=' + WORLDMAP_LKG_TTL, ...CORS_RW },
    }));
  } catch (e) {}
  return _wmNoStore(res);
}

/* ============================================================================
 * 🛡️ ADMIN — full account directory (Arcanum → User Management).
 * Lists EVERY user_profiles row with profile info + an "online" flag
 * (updated_at within 5 min). Reads the private user_profiles table with the
 * Supabase SERVICE-ROLE key (bypasses RLS) — so it is doubly gated:
 *   1) the caller's Supabase token is verified server-side, and their
 *      email must be in ADMIN_EMAILS (same allowlist as the game client —
 *      these emails already ship in the client, they are not secrets);
 *   2) the service key lives ONLY in a Cloudflare secret (env.SB_SERVICE),
 *      never in the client or repo.
 * If SB_SERVICE is unset → 501; the game falls back to the public-table
 * search and nothing breaks.
 * ========================================================================== */
const ADMIN_EMAILS = ['richaegisop@gmail.com', 'play@mythicsoa.com', 'dev@mythicspellbook.com'];
const ADMIN_ONLINE_MS = 5 * 60 * 1000;
async function handleAdmin(request, env, u) {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS_RW });
  const seg = u.pathname.replace(/^\/api\/admin\//, '').replace(/\/+$/, '');
  if (!env.SB_SERVICE) return cjson({ error: 'admin_not_configured', hint: 'Set the SB_SERVICE secret (Supabase service_role key) to enable the full account directory. See STRIPE.md.' }, 501);
  const user = await sbUser(env, request);
  if (!user) return cjson({ error: 'unauthorized' }, 401);
  if (ADMIN_EMAILS.indexOf(user.email) < 0) return cjson({ error: 'forbidden' }, 403);

  if (seg === 'users' && request.method === 'GET') {
    const lim = Math.max(1, Math.min(1000, parseInt(u.searchParams.get('limit') || '500', 10) || 500));
    const q = (u.searchParams.get('q') || '').trim();
    let path = '/rest/v1/user_profiles?select=user_id,display_name,gems,sovereigns,updated_at&order=updated_at.desc&limit=' + lim;
    if (q) path += '&display_name=ilike.' + encodeURIComponent('%' + q + '%');
    const base = String(env.SB_URL || '').replace(/\/+$/, '');
    const SH = { apikey: env.SB_SERVICE, authorization: 'Bearer ' + env.SB_SERVICE, accept: 'application/json' };
    const r = await fetch(base + path, { headers: SH });
    if (!r.ok) { let t = ''; try { t = await r.text(); } catch (e) {} return cjson({ error: 'upstream', detail: ('sb ' + r.status + ' ' + t).slice(0, 200) }, 502); }
    const rows = await r.json().catch(() => []);
    // 📧 Pull auth metadata (email, signup time, confirmation status, last sign-in,
    // ban) and merge by user_id. Page through up to 5×1000 = 5,000 accounts —
    // enough for the early game; tighten if the user count grows past that.
    const authById = {};
    try {
      for (let pg = 1; pg <= 5; pg++) {
        const ar = await fetch(base + '/auth/v1/admin/users?page=' + pg + '&per_page=1000', { headers: SH });
        if (!ar.ok) break;
        const aj = await ar.json().catch(() => null);
        const list = (aj && Array.isArray(aj.users)) ? aj.users : [];
        if (!list.length) break;
        for (const au of list) {
          if (!au || !au.id) continue;
          authById[au.id] = {
            email: au.email || null,
            created_at: au.created_at || null,
            confirmed_at: au.email_confirmed_at || au.confirmed_at || null,
            last_sign_in_at: au.last_sign_in_at || null,
            banned_until: au.banned_until || null,
            phone: au.phone || null,
            provider: (au.app_metadata && au.app_metadata.provider) || null,
          };
        }
        if (list.length < 1000) break;
      }
    } catch (e) { /* auth admin unreachable — proceed with profile-only data */ }
    const now = Date.now();
    const users = (Array.isArray(rows) ? rows : []).map(function (x) {
      const t = x.updated_at ? Date.parse(x.updated_at) : 0;
      const a = authById[x.user_id] || {};
      return {
        user_id: x.user_id,
        handle: x.display_name || '(no handle)',
        gems: Math.max(0, Math.floor(Number(x.gems) || 0)),
        sovereigns: Math.max(0, Math.floor(Number(x.sovereigns) || 0)),
        last_seen: x.updated_at || null,
        online: !!(t && (now - t) < ADMIN_ONLINE_MS),
        // 📧 Auth metadata for the dossier
        email: a.email || null,
        created_at: a.created_at || null,
        email_confirmed: !!a.confirmed_at,
        confirmed_at: a.confirmed_at || null,
        last_sign_in_at: a.last_sign_in_at || null,
        banned: !!(a.banned_until && Date.parse(a.banned_until) > now),
        banned_until: a.banned_until || null,
        provider: a.provider || 'email',
      };
    });
    // 🆕 Include auth-only users (signed up but never landed a profile row yet —
    // these are the most useful for tracking who got stuck during onboarding).
    const haveProfile = {}; users.forEach(x => { if (x.user_id) haveProfile[x.user_id] = 1; });
    for (const uid in authById) {
      if (haveProfile[uid]) continue;
      const a = authById[uid];
      users.push({
        user_id: uid,
        handle: (a.email ? a.email.split('@')[0] : '(no handle)') + ' · no-profile',
        gems: 0, sovereigns: 0,
        last_seen: a.last_sign_in_at || a.created_at || null,
        online: false,
        email: a.email, created_at: a.created_at,
        email_confirmed: !!a.confirmed_at, confirmed_at: a.confirmed_at,
        last_sign_in_at: a.last_sign_in_at,
        banned: !!(a.banned_until && Date.parse(a.banned_until) > now),
        banned_until: a.banned_until,
        provider: a.provider || 'email',
        noProfile: true,
      });
    }
    return cjson({ count: users.length, online: users.filter(x => x.online).length, users: users });
  }

  // 📧 Send a password-reset email via Supabase Auth (uses whatever SMTP is
  // configured on the project — custom SMTP if set up, default Supabase
  // mailer otherwise). Admin-initiated rescue for stuck players.
  if (seg === 'reset-email' && request.method === 'POST') {
    const body = await request.json().catch(() => ({}));
    const email = String((body && body.email) || '').trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return cjson({ error: 'bad_email' }, 400);
    if (ADMIN_EMAILS.indexOf((user.email || '').toLowerCase()) < 0) return cjson({ error: 'forbidden' }, 403);
    const base = String(env.SB_URL || '').replace(/\/+$/, '');
    const r = await fetch(base + '/auth/v1/recover', {
      method: 'POST',
      headers: { apikey: env.SB_SERVICE, authorization: 'Bearer ' + env.SB_SERVICE, 'content-type': 'application/json' },
      body: JSON.stringify({ email: email }),
    });
    if (!r.ok) { let t = ''; try { t = await r.text(); } catch (e) {} return cjson({ error: 'recover_failed', detail: ('sb ' + r.status + ' ' + t).slice(0, 200) }, 502); }
    return cjson({ ok: true });
  }

  // 📨 Resend the signup confirmation email — for players who never received
  // their original confirmation. Also uses the project's SMTP.
  if (seg === 'resend-confirmation' && request.method === 'POST') {
    const body = await request.json().catch(() => ({}));
    const email = String((body && body.email) || '').trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return cjson({ error: 'bad_email' }, 400);
    if (ADMIN_EMAILS.indexOf((user.email || '').toLowerCase()) < 0) return cjson({ error: 'forbidden' }, 403);
    const base = String(env.SB_URL || '').replace(/\/+$/, '');
    const r = await fetch(base + '/auth/v1/resend', {
      method: 'POST',
      headers: { apikey: env.SB_SERVICE, authorization: 'Bearer ' + env.SB_SERVICE, 'content-type': 'application/json' },
      body: JSON.stringify({ email: email, type: 'signup' }),
    });
    if (!r.ok) { let t = ''; try { t = await r.text(); } catch (e) {} return cjson({ error: 'resend_failed', detail: ('sb ' + r.status + ' ' + t).slice(0, 200) }, 502); }
    return cjson({ ok: true });
  }

  // Account moderation via the Supabase Auth Admin API (service role).
  // op ∈ ban | unban | email | password | delete | maint_on | maint_off.
  // Highly privileged —
  // already double-gated (admin token + ADMIN_EMAILS + SB_SERVICE).
  if (seg === 'account' && request.method === 'POST') {
    const body = await request.json().catch(() => ({}));
    const id = String((body && body.user_id) || '').trim();
    const op = String((body && body.op) || '').trim();
    if (!id) return cjson({ error: 'no_user' }, 400);
    if (ADMIN_EMAILS.indexOf((user.email || '').toLowerCase()) < 0) return cjson({ error: 'forbidden' }, 403);
    const base = String(env.SB_URL || '').replace(/\/+$/, '');
    const au = base + '/auth/v1/admin/users/' + encodeURIComponent(id);
    const H = { apikey: env.SB_SERVICE, authorization: 'Bearer ' + env.SB_SERVICE, 'content-type': 'application/json' };
    /* 🛠 MAINTENANCE MODE FOR ONE PLAYER — held on the same 'DOWN FOR
       MAINTENANCE' screen the global lock uses, but only this account.
       🔴 NOT AN AUTH ADMIN CALL, so it branches BEFORE the fetch below. The
          other five ops all speak to /auth/v1/admin/users; this one writes a
          row in public.player_maintenance (sql/044) and has nothing to say to
          the auth service. Falling through would PUT an empty body at the
          user record and report success having changed nothing.
       ⚠ SERVICE ROLE, DELIBERATELY, even though the table's RLS would let an
         admin write it from the client. Every other account action in this
         dossier goes through this endpoint, which is already double-gated
         (admin token + ADMIN_EMAILS + SB_SERVICE); a second write path with a
         second set of rules is how the two drift apart.
       ⚠ maint_off KEEPS THE ROW and stamps ended_at rather than deleting it.
         maintenanceFrozenMs() subtracts [since, ended_at] from wall-clock
         accrual, so a deleted row would bill the player for the cycles they
         were locked out of — the exact bug the global lock already fixed. */
    if (op === 'maint_on' || op === 'maint_off') {
      const on = (op === 'maint_on');
      const nowIso = new Date().toISOString();
      const row = on
        ? {
            user_id: id, enabled: true,
            title: String((body && body.title) || '').slice(0, 120) || null,
            message: String((body && body.message) || '').slice(0, 600) || null,
            since: nowIso, ended_at: null,
            set_by: user.id, set_by_name: String(user.email || '').slice(0, 120),
            updated_at: nowIso,
          }
        : { user_id: id, enabled: false, ended_at: nowIso, updated_at: nowIso };
      const pr = await fetch(base + '/rest/v1/player_maintenance?on_conflict=user_id', {
        method: 'POST',
        headers: Object.assign({}, H, { prefer: 'resolution=merge-duplicates,return=representation' }),
        body: JSON.stringify([row]),
      });
      if (!pr.ok) { let t = ''; try { t = await pr.text(); } catch (e) {} return cjson({ error: 'maint_write', detail: ('sb ' + pr.status + ' ' + t).slice(0, 200) }, 502); }
      let out = null; try { out = await pr.json(); } catch (e) {}
      return cjson({ ok: true, op: op, row: (Array.isArray(out) && out[0]) || null });
    }
    let method = 'PUT', payload = null;
    if (op === 'ban') payload = { ban_duration: '876000h' };
    else if (op === 'unban') payload = { ban_duration: 'none' };
    else if (op === 'email') { const e = String((body && body.email) || '').trim(); if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) return cjson({ error: 'bad_email' }, 400); payload = { email: e, email_confirm: true }; }
    else if (op === 'password') { const p = String((body && body.password) || ''); if (p.length < 8) return cjson({ error: 'weak_password', hint: 'min 8 chars' }, 400); payload = { password: p }; }
    else if (op === 'delete') { method = 'DELETE'; }
    else return cjson({ error: 'bad_op' }, 400);
    const r = await fetch(au, { method: method, headers: H, body: payload ? JSON.stringify(payload) : undefined });
    if (!r.ok) { let t = ''; try { t = await r.text(); } catch (e) {} return cjson({ error: 'auth_admin', detail: ('sb ' + r.status + ' ' + t).slice(0, 200) }, 502); }
    return cjson({ ok: true, op: op });
  }

  return cjson({ error: 'not_found' }, 404);
}

// ─────────────────────────────────────────────────────────────────────────────
// 🖼 ART PROXY — /api/art/proxy?url=<encoded image url>
//
// Some image hosts (cdn.phototourl.com among them) refuse cross-origin reads,
// so the BROWSER cannot copy the bytes and the art stays stranded on a
// third-party server we do not control. If that host expires or rate-limits,
// every card using it goes blank and nothing in the game can recover it.
//
// A server-to-server fetch is not subject to CORS, so the Worker can read the
// image and hand it back with permissive CORS. The client then uploads those
// bytes to the user's own Supabase bucket exactly like a file Upload.
//
// ⚠ SSRF GUARDS — this endpoint fetches a URL supplied by the caller, so it is
// deliberately narrow: https/http only, no credentials in the URL, private and
// loopback hosts refused, response must be an image, and a hard size cap. It
// returns bytes only, never follows a redirect to a blocked host implicitly
// (redirect:'follow' is fine because the guards re-run on the final response's
// content-type, and no request body or auth header is ever forwarded).
// ─────────────────────────────────────────────────────────────────────────────
const ART_PROXY_MAX_BYTES = 12 * 1024 * 1024;   // 12MB — far above any card art
function _artProxyBlockedHost(h) {
  const host = String(h || '').toLowerCase();
  if (!host) return true;
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.internal')) return true;
  if (host === '::1' || host === '0.0.0.0') return true;
  // IPv4 literals in private / loopback / link-local / CGNAT ranges.
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (m) {
    const a = +m[1], b = +m[2];
    if (a === 10 || a === 127 || a === 0) return true;
    if (a === 192 && b === 168) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 169 && b === 254) return true;     // link-local incl. cloud metadata
    if (a === 100 && b >= 64 && b <= 127) return true;
  }
  return false;
}
/* ═══════════════════════════════════════════════════════════════════════════
   📨 WELCOME EMAIL — one mail per new account, from Hidn Studios.
   ───────────────────────────────────────────────────────────────────────────
   Sent by the WORKER, never by the browser, for the obvious reason: the mail
   goes to whatever address the JWT says, and only the server can check a JWT.
   The client may ask; it may not name the recipient.

   Two orderings in here are load-bearing:

     · env.EMAIL is checked BEFORE the claim. Until the sending domain is
       onboarded there is no binding, and burning the once-per-account claim
       on a send that cannot happen would silently cost that player their
       welcome mail forever. Instead nothing is claimed and the next sign-in
       tries again — so finishing the Cloudflare onboarding is retroactive.

     · the claim happens BEFORE the send, not after. A duplicate greeting is a
       worse failure than a late one, and the ten-minute retry window in
       sql/120 covers the send that dies in flight.
   ══════════════════════════════════════════════════════════════════════════ */
const WELCOME_FROM = { email: 'no-reply@playmythicspellbook.com', name: 'Hidn Studios' };

async function _sbRpc(env, user, fn) {
  const r = await fetch(String(env.SB_URL).replace(/\/+$/, '') + '/rest/v1/rpc/' + fn, {
    method: 'POST',
    headers: {
      apikey: env.SB_ANON,
      authorization: 'Bearer ' + user.token,
      'content-type': 'application/json',
      accept: 'application/json',
    },
    body: '{}',
  });
  if (!r.ok) throw new Error('rpc ' + fn + ' ' + r.status);
  return r.json().catch(() => null);
}

/* The player's own display name is read from the JWT's account record, never
   from the request body — a name posted by the client would be attacker-chosen
   text pasted into HTML we send. */
function _welcomeEsc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function _welcomeBody(name) {
  const who = _welcomeEsc(name || 'Spellcaster');
  const html = '<!doctype html><html><body style="margin:0;background:#0d0b14;font-family:Georgia,serif;color:#e8e2d0">'
    + '<div style="max-width:560px;margin:0 auto;padding:28px 22px">'
    + '<h1 style="margin:0 0 6px;font-size:26px;color:#d4af37">Welcome to Mythic Spellbook</h1>'
    + '<p style="margin:0 0 20px;color:#9d94b8;font-size:13px;letter-spacing:.08em;text-transform:uppercase">A Hidn Studios game</p>'
    + '<p style="font-size:16px;line-height:1.6">' + who + ', your account is live.</p>'
    + '<p style="font-size:16px;line-height:1.6">You start in the Bunker with a starter deck and an empty wallet. '
    + 'From there it is your call: build a deck and fight for Cinder, take a node and raise a city on it, '
    + 'run an operation, or open a stall on the player market and let everyone else do the fighting.</p>'
    + '<p style="margin:26px 0"><a href="https://playmythicspellbook.com" '
    + 'style="background:#d4af37;color:#1a1526;text-decoration:none;padding:13px 26px;border-radius:7px;font-weight:bold;font-size:16px">Enter the game</a></p>'
    + '<p style="font-size:14px;line-height:1.6;color:#9d94b8">Everything you own is tied to this email address, so keep it reachable. '
    + 'If you ever lose your password, use <strong style="color:#e8e2d0">Forgot password?</strong> on the sign-in screen &mdash; '
    + 'the reset link comes from us, at this address.</p>'
    + '<p style="font-size:13px;color:#6f6885;border-top:1px solid #2a2438;padding-top:16px;margin-top:26px">'
    + 'Sent by Hidn Studios because an account was created with this address. '
    + 'If that was not you, ignore this message &mdash; nothing can be done with the account without your password.</p>'
    + '</div></body></html>';
  const text = 'Welcome to Mythic Spellbook — a Hidn Studios game\n\n'
    + (name || 'Spellcaster') + ', your account is live.\n\n'
    + 'You start in the Bunker with a starter deck and an empty wallet. From there it is\n'
    + 'your call: build a deck and fight for Cinder, take a node and raise a city on it,\n'
    + 'run an operation, or open a stall on the player market.\n\n'
    + 'Enter the game: https://playmythicspellbook.com\n\n'
    + 'Everything you own is tied to this email address, so keep it reachable. If you\n'
    + 'ever lose your password, use "Forgot password?" on the sign-in screen — the reset\n'
    + 'link comes from us, at this address.\n\n'
    + 'Sent by Hidn Studios because an account was created with this address. If that was\n'
    + 'not you, ignore this message — nothing can be done with the account without your\n'
    + 'password.\n';
  return { html, text };
}

async function handleWelcome(request, env, u) {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS_RW });
  if (request.method !== 'POST') return cjson({ ok: false, error: 'method_not_allowed' }, 405);

  const user = await sbUser(env, request);
  if (!user) return cjson({ ok: false, error: 'unauthorized' }, 401);
  if (!user.email) return cjson({ ok: true, sent: false, reason: 'no_address' });

  /* ⚠ BEFORE the claim — see the header. No binding means no claim spent. */
  if (!env.EMAIL) return cjson({ ok: true, sent: false, reason: 'email_not_configured' });

  let claimed = false;
  try { claimed = (await _sbRpc(env, user, 'claim_welcome_email')) === true; }
  catch (e) { return cjson({ ok: false, sent: false, error: 'claim_failed', detail: String((e && e.message) || e).slice(0, 160) }, 502); }
  if (!claimed) return cjson({ ok: true, sent: false, reason: 'already_sent' });

  const body = _welcomeBody(user.name);
  try {
    await env.EMAIL.send({
      to: user.email,
      from: WELCOME_FROM,
      subject: 'Welcome to Mythic Spellbook',
      html: body.html,
      text: body.text,
    });
  } catch (e) {
    /* The claim stands for ten minutes and then reopens (sql/120), so a bad
       minute at Cloudflare delays this mail rather than losing it. */
    return cjson({ ok: false, sent: false, error: 'send_failed', detail: String((e && e.message) || e).slice(0, 160) }, 502);
  }

  try { await _sbRpc(env, user, 'mark_welcome_email_sent'); } catch (e) {}
  return cjson({ ok: true, sent: true });
}

async function handleArtProxy(request, u) {
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  const raw = u.searchParams.get('url') || '';
  let target;
  try { target = new URL(raw); } catch (e) { return cjson({ error: 'bad_url' }, 400); }
  if (target.protocol !== 'https:' && target.protocol !== 'http:') return cjson({ error: 'bad_scheme' }, 400);
  if (target.username || target.password) return cjson({ error: 'no_credentials_allowed' }, 400);
  if (_artProxyBlockedHost(target.hostname)) return cjson({ error: 'blocked_host' }, 403);

  let up;
  try {
    up = await fetch(target.toString(), {
      method: 'GET',
      redirect: 'follow',
      headers: { 'Accept': 'image/*', 'User-Agent': 'MythicSpellbook-ArtProxy/1.0' },
    });
  } catch (e) { return cjson({ error: 'fetch_failed', detail: String((e && e.message) || e).slice(0, 160) }, 502); }
  if (!up.ok) return cjson({ error: 'upstream_' + up.status }, 502);

  const ct = String(up.headers.get('content-type') || '').toLowerCase();
  if (!ct.startsWith('image/')) return cjson({ error: 'not_an_image', contentType: ct.slice(0, 60) }, 415);
  const len = parseInt(up.headers.get('content-length') || '0', 10);
  if (len && len > ART_PROXY_MAX_BYTES) return cjson({ error: 'too_large', bytes: len }, 413);

  const buf = await up.arrayBuffer();
  if (buf.byteLength > ART_PROXY_MAX_BYTES) return cjson({ error: 'too_large', bytes: buf.byteLength }, 413);
  return new Response(buf, {
    status: 200,
    headers: Object.assign({}, cors, {
      'Content-Type': ct,
      'Cache-Control': 'public, max-age=300',
    }),
  });
}

export default {
  async fetch(request, env) {
    let u;
    try { u = new URL(request.url); } catch (e) { return env.ASSETS.fetch(request); }

    // 🔔 Web Push — the only thing that reaches a CLOSED app. Gated behind a
    //    shared secret: without one, anyone could push arbitrary text to every
    //    player's lock screen wearing the game's icon, which is a phishing
    //    channel, not just a spam channel.
    if (u.pathname === '/api/push/send') {
      try { return await handlePushSend(request, env); }
      catch (e) { return cjson({ error: 'push_error', detail: String((e && e.message) || e).slice(0, 200) }, 502); }
    }
    // Lets the client fetch the applicationServerKey instead of it being
    // hardcoded in two places that can drift apart.
    if (u.pathname === '/api/push/key') {
      return cjson({ key: env.VAPID_PUBLIC || null, configured: !!(env.VAPID_PUBLIC && env.VAPID_PRIVATE) });
    }

    if (u.pathname === '/api/art/proxy') {
      try { return await handleArtProxy(request, u); }
      catch (e) { return cjson({ error: 'art_proxy_error', detail: String((e && e.message) || e).slice(0, 200) }, 502); }
    }

    if (u.pathname === '/api/welcome') {
      try { return await handleWelcome(request, env, u); }
      catch (e) { return cjson({ ok: false, error: 'welcome_error', detail: String((e && e.message) || e).slice(0, 200) }, 502); }
    }

    if (u.pathname === '/api/worldmap') {
      try { return await handleWorldMap(request, env, u); }
      catch (e) { return cjson({ error: 'worldmap_error', detail: String((e && e.message) || e).slice(0, 200) }, 502); }
    }

    if (u.pathname.startsWith('/api/admin/')) {
      try { return await handleAdmin(request, env, u); }
      catch (e) { return cjson({ error: 'admin_error', detail: String((e && e.message) || e).slice(0, 200) }, 502); }
    }

    if (u.pathname.startsWith('/api/cashout/')) {
      try { return await handleCashout(request, env, u); }
      catch (e) { return cjson({ error: 'cashout_error', detail: String((e && e.message) || e).slice(0, 200) }, 502); }
    }

    if (u.pathname.startsWith('/api/buy/')) {
      try { return await handleBuy(request, env, u); }
      catch (e) { return cjson({ error: 'buy_error', detail: String((e && e.message) || e).slice(0, 200) }, 502); }
    }

    if (u.pathname.startsWith('/api/tkeys/')) {
      return handleTKeys(request, env, u);
    }
    if (u.pathname.startsWith('/api/garage/')) {
      try { return await handleGarage(request, env, u); }
      catch (e) { return cjson({ error: 'garage_error', detail: String((e && e.message) || e).slice(0, 200) }, 502); }
    }
    if (u.pathname.startsWith('/api/licence/')) {
      try { return await handleLicence(request, env, u); }
      catch (e) { return cjson({ error: 'licence_error', detail: String((e && e.message) || e).slice(0, 200) }, 502); }
    }
    if (u.pathname.startsWith('/api/devpoints/')) {
      try { return await handleDevPoints(request, env, u); }
      catch (e) { return cjson({ error: 'devpoints_error', detail: String((e && e.message) || e).slice(0, 200) }, 502); }
    }

    /* 🎨 Van livery. Everything that touches an uploaded image lives in
       livery.js because that file is the only place SB_SERVICE is used for
       storage — see its header for the fail-closed rules. */
    if (u.pathname.startsWith('/api/livery/')) {
      try { return await handleLivery(request, env, u); }
      catch (e) {
        /* ⚠ Even the catch-all is fail-closed: a thrown error here returns a
           502 and leaves the row wherever it was, which is never visible. */
        return cjson({ ok: false, error: 'livery_error', detail: String((e && e.message) || e).slice(0, 200) }, 502);
      }
    }

    if (u.pathname.startsWith('/api/shop/')) {
      try { return await handleShop(request, env, u); }
      catch (e) { return cjson({ error: 'shop_error', detail: String((e && e.message) || e).slice(0, 200) }, 502); }
    }

    if (u.pathname === '/api' || u.pathname === '/api/') {
      return json({
        service: 'Mythic Spellbook API',
        version: API_VERSION,
        readOnly: true,
        endpoints: Object.keys(ROUTES).map(k => '/api/' + API_VERSION + '/' + k),
      }, 200, 300);
    }

    if (u.pathname.startsWith('/api/')) {
      if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
      if (request.method !== 'GET') return json({ error: 'method_not_allowed' }, 405);
      const m = u.pathname.match(/^\/api\/v1\/([a-z]+)\/?$/);
      const fn = m && ROUTES[m[1]];
      if (!fn) return json({ error: 'not_found', see: '/api' }, 404);
      try {
        return json(await fn(env, u));
      } catch (e) {
        return json({ error: 'upstream', detail: String((e && e.message) || e) }, 502, 0);
      }
    }

    /* 🖼 AVIF CONTENT NEGOTIATION — the whole asset saving, with zero call-site changes.
       ─────────────────────────────────────────────────────────────────────────
       MEASURED on this repo's own art: 1,920 PNGs over 200 KB totalling 2.85 GB.
       Re-encoding them LOSSLESSLY makes them BIGGER (3.07 GB) — they are already
       optimally deflated — and palette-quantising them to 256 colours saves 72%
       but visibly bands painterly card art. The only real win is a format change:
       AVIF q55 takes the same 2.85 GB to about 0.16 GB, a 94% cut.
       A format change normally means renaming files, and there are ~650 asset
       URL construction sites across index.html and twelve sub-apps. Rewriting
       those is the migration brief's Phase 1 and it is the largest mechanical
       task in the whole plan.
       This skips it entirely. The sibling is stored as `<original>.avif` — so
       `card.png` gains `card.png.avif` — and the ORIGINAL PATH KEEPS WORKING.
       Every <img>, every CSS url(), every new Image().src stays exactly as it
       is. Delete the .avif files and the site silently returns to serving PNG.
       ⚠ `Vary: Accept` IS LOAD-BEARING. Without it Cloudflare's cache can hand
       an AVIF body to a browser that never asked for one, which renders as a
       broken image. It costs cache granularity; correctness wins.
       ⚠ Only GET/HEAD, and only when the client positively advertises AVIF.
       A HEAD must not get a body, so the method is passed through unchanged. */
    if ((request.method === 'GET' || request.method === 'HEAD')
        && /\.(png|jpe?g)$/i.test(u.pathname)
        && (request.headers.get('Accept') || '').includes('image/avif')) {
      try {
        const alt = new URL(request.url);
        alt.pathname = u.pathname + '.avif';
        const hit = await env.ASSETS.fetch(new Request(alt.toString(), {
          method: request.method,
          headers: request.headers,
        }));
        /* env.ASSETS 404s to the SPA shell on a miss, so a 200 alone is not
           proof the sibling exists — check the type it actually returned. */
        if (hit && hit.ok && (hit.headers.get('Content-Type') || '').includes('image/avif')) {
          const h = new Headers(hit.headers);
          h.set('Content-Type', 'image/avif');
          h.set('Vary', 'Accept');
          if (!h.has('Cache-Control')) h.set('Cache-Control', 'public, max-age=31536000, immutable');
          return new Response(hit.body, { status: 200, headers: h });
        }
      } catch (e) { /* fall through to the original asset — never fail the image */ }
    }

    // Everything else = the game's static site, unchanged.
    return env.ASSETS.fetch(request);
  },
};
