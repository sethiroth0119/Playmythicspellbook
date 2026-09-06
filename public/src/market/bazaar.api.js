/* ═══════════════════════════════════════════════════════════════════════════
   bazaar.api.js — every call this module makes to the outside world.

   TWO BACKENDS, and the split is the security model:

     /api/market/*        the Cloudflare Worker. Everything that touches MONEY.
                          The Worker holds STRIPE_SECRET_KEY, reads the price
                          from the database itself, computes the fee, and
                          authorises payouts. This module never sends a price.

     Supabase RPCs        rm_list / rm_cancel / rm_browse / rm_claim. Every one
                          is SECURITY DEFINER on auth.uid(), so the server
                          decides who the caller is. See sql/038.

   🔴 NOTHING HERE IS AUTHORITATIVE. Every number this file returns is for
      DISPLAY. The fee shown before you list, the balance on the payout screen,
      the price on a listing card — all of them are re-derived server-side
      before a cent moves. If a value here disagrees with the server, the
      server is right and the UI is stale.
   ═══════════════════════════════════════════════════════════════════════════ */
import { bridge } from './bazaar.bridge.js';

async function authHeaders() {
  const tok = await bridge().token();
  if (!tok) return null;
  return { 'content-type': 'application/json', accept: 'application/json',
           authorization: 'Bearer ' + tok };
}

async function api(path, opts) {
  const h = await authHeaders();
  if (!h) return { error: 'signed_out' };
  try {
    const r = await fetch('/api/market/' + path, Object.assign({ headers: h }, opts || {}));
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return Object.assign({ error: j.error || ('http_' + r.status) }, j);
    return j;
  } catch (e) { return { error: 'network' }; }
}

// Config is fetched WITHOUT auth — it is what decides whether the Bazaar tile
// appears at all, and it has to work before the player signs in.
export async function config() {
  try {
    const r = await fetch('/api/market/config', { headers: { accept: 'application/json' } });
    return await r.json();
  } catch (e) { return { enabled: false, ready: false }; }
}

export function earnings()          { return api('earnings'); }

/* ── Stripe Connect ────────────────────────────────────────────────────────
   🔴 THESE TWO HIT /api/cashout/, NOT /api/market/, AND THAT IS DELIBERATE.
   A player has ONE connected Stripe account, mapped in cashout_accounts by
   /api/cashout/connect. The Bazaar reuses that rail rather than growing a
   second onboarding flow — two account maps for one player is how a payout
   ends up in the wrong Stripe account.

   The Bazaar surfaces the button itself because the Cashout Vault (the only
   other place it lives) is gated behind a Lv 15 hero or owning a node. A
   seller who has neither could otherwise earn money with no way to connect
   an account to be paid into. Selling must never depend on that gate. */
async function cashoutApi(path, opts) {
  const h = await authHeaders();
  if (!h) return { error: 'signed_out' };
  try {
    const r = await fetch('/api/cashout/' + path, Object.assign({ headers: h }, opts || {}));
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return Object.assign({ error: j.error || ('http_' + r.status) }, j);
    return j;
  } catch (e) { return { error: 'network' }; }
}
// Returns a Stripe-HOSTED onboarding URL. The player completes identity
// verification and bank entry on Stripe's own pages — the game never sees or
// stores bank or ID details, only the connected-account id.
// Connection STATUS is not fetched separately — /api/market/earnings already
// returns `connected` and `payout_ready` (it asks Stripe directly), so a
// second accessor would just be a second thing to keep in agreement.
export function connect() { return cashoutApi('connect', { method: 'POST', body: '{}' }); }
export function checkout(listingId) {
  return api('checkout', { method: 'POST', body: JSON.stringify({ listing: listingId }) });
}
export function confirm(sid)        { return api('confirm?sid=' + encodeURIComponent(sid)); }
export function payout(cents)       {
  return api('payout', { method: 'POST', body: JSON.stringify({ cents: cents }) });
}

// ── Supabase RPCs ──────────────────────────────────────────────────────────
// A missing table (sql/038 not applied) must read as "the Bazaar isn't set up
// here", never as a crash — same degradation rule the whole app follows.
function sb() {
  try { const c = bridge().cloud; return (c && c.client) || null; } catch (e) { return null; }
}
async function rpc(fn, args) {
  const c = sb();
  if (!c) return { error: 'offline' };
  const r = await c.rpc(fn, args || {});
  if (r && r.error) {
    const m = String(r.error.message || '');
    if (/does not exist|schema cache|PGRST202|42883|42P01/i.test(m)) return { error: 'not_setup' };
    return { error: m.slice(0, 200) };
  }
  return { data: r.data };
}

export function browse(limit)   { return rpc('rm_browse', { p_limit: limit || 60 }); }
export function unclaimed()     { return rpc('rm_unclaimed', {}); }
export function claim(orderId)  { return rpc('rm_claim', { p_order: orderId }); }
export function cancel(id)      { return rpc('rm_cancel', { p_listing: id }); }
export function list(item, priceCents) {
  return rpc('rm_list', {
    p_kind: item.kind === 'item' ? 'item' : 'card',
    p_item_uid: item.uid || null,
    p_title: item.title || 'Untitled',
    p_blurb: item.blurb || '',
    p_card: item.card || null,
    p_unit: item.unit || null,
    // The ONLY number this module sends. It is bounds-checked again inside
    // rm_list() against rm_config, which is what actually enforces the range.
    p_price_cents: priceCents,
  });
}
