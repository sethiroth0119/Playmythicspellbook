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
  return j && j.id ? { id: j.id, token: tok, email: (j.email || '').toLowerCase() } : null;
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
    return cjson({ ok: true, sid: sid, pack: md.pack, aza: Number(md.aza) || (AZA_PACKS[md.pack] && AZA_PACKS[md.pack].aza) || 0 });
  }

  return cjson({ error: 'not_found' }, 404);
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
  // op ∈ ban | unban | email | password | delete. Highly privileged —
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

export default {
  async fetch(request, env) {
    let u;
    try { u = new URL(request.url); } catch (e) { return env.ASSETS.fetch(request); }

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
