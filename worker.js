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
  return j && j.id ? { id: j.id, token: tok } : null;
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

  // Webhook — signature-verified; log/ack only, never moves funds here.
  if (seg === 'webhook' && request.method === 'POST') {
    const raw = await request.text();
    const ok = await verifyStripeSig(env.STRIPE_WEBHOOK_SECRET, raw, request.headers.get('stripe-signature') || '');
    if (!ok) return cjson({ error: 'bad_signature' }, 400);
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
    const origin = (env.PUBLIC_BASE_URL || u.origin).replace(/\/+$/, '');
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
const AZA_PACKS = {
  sp_starter: { aza: 100,  cents: 199,  name: 'Starter Cache' },
  sp_adv:     { aza: 280,  cents: 499,  name: "Adventurer's Coffer" },
  sp_hero:    { aza: 600,  cents: 999,  name: "Hero's Vault" },
  sp_champ:   { aza: 1300, cents: 1999, name: "Champion's Trove" },
  sp_legend:  { aza: 3500, cents: 4999, name: "Legend's Hoard" },
};
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
    const origin = (env.PUBLIC_BASE_URL || u.origin).replace(/\/+$/, '');
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
    return cjson({ ok: true, sid: sid, pack: md.pack, aza: Number(md.aza) || (AZA_PACKS[md.pack] && AZA_PACKS[md.pack].aza) || 0 });
  }

  return cjson({ error: 'not_found' }, 404);
}

export default {
  async fetch(request, env) {
    let u;
    try { u = new URL(request.url); } catch (e) { return env.ASSETS.fetch(request); }

    if (u.pathname.startsWith('/api/cashout/')) {
      try { return await handleCashout(request, env, u); }
      catch (e) { return cjson({ error: 'cashout_error', detail: String((e && e.message) || e).slice(0, 200) }, 502); }
    }

    if (u.pathname.startsWith('/api/buy/')) {
      try { return await handleBuy(request, env, u); }
      catch (e) { return cjson({ error: 'buy_error', detail: String((e && e.message) || e).slice(0, 200) }, 502); }
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

    // Everything else = the game's static site, unchanged.
    return env.ASSETS.fetch(request);
  },
};
