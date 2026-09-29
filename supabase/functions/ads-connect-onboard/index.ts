// ============================================================================
// 💼 ads-connect-onboard — Ethos Sponsor Network: node-owner payout onboarding.
// ----------------------------------------------------------------------------
// Gets-or-creates a Stripe Connect account for the caller's corp and returns a
// hosted onboarding Account Link. After the owner finishes KYC, Stripe fires
// `account.updated` → stripe-webhook flips payouts_enabled on tw_ad_sellers, and
// ads-checkout starts routing the 70% destination split to that account.
//
// Uses Accounts v2 (controller properties) per Stripe's current Connect guidance
// — NOT the legacy express/custom/standard `type` field.
//
// ⚠ Verify the v2 account-create shape against YOUR Stripe API version
//   (https://docs.stripe.com/connect/accounts-v2) — capabilities + controller
//   defaults differ by platform. Test in Stripe test mode before going live.
//
// Env: STRIPE_SECRET_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, GAME_ORIGIN
// Body: { corp_id: string }   Auth: the owner's Supabase JWT
// Returns: { url }  — redirect the browser to onboard.
// ============================================================================
import Stripe from 'npm:stripe@^18';
import { createClient } from 'npm:@supabase/supabase-js@^2';
import { handlePreflight, jsonResponse } from '../_shared/cors.ts';

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY') ?? '');
const admin = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '');

Deno.serve(async (req) => {
  const pre = handlePreflight(req); if (pre) return pre;
  try {
    const jwt = (req.headers.get('Authorization') ?? '').replace('Bearer ', '');
    const { data: { user } } = await admin.auth.getUser(jwt);
    if (!user) return jsonResponse({ error: 'unauthorized' }, 401);

    const { corp_id } = await req.json().catch(() => ({}));
    if (!corp_id) return jsonResponse({ error: 'corp_id required' }, 400);

    const { data: existing } = await admin.from('tw_ad_sellers').select('*').eq('corp_id', corp_id).single();
    let accountId: string | undefined = existing?.stripe_account_id ?? undefined;

    if (!accountId) {
      // Accounts v2 — controller defines liability/fee/dashboard responsibilities.
      // Platform collects fees + owns losses; connected account gets a Stripe
      // Express-style dashboard. Adjust per your risk model + go-live needs.
      const acct = await (stripe as unknown as {
        v2: { core: { accounts: { create: (p: unknown) => Promise<{ id: string }> } } };
      }).v2.core.accounts.create({
        contact_email: user.email ?? undefined,
        dashboard: 'express',
        defaults: { responsibilities: { fees_collector: 'application', losses_collector: 'application' } },
        identity: { country: 'us' },
        include: ['configuration.merchant', 'requirements'],
        configuration: { merchant: { capabilities: { card_payments: { requested: true } } } },
      });
      accountId = acct.id;
      await admin.from('tw_ad_sellers').upsert({
        corp_id, user_id: user.id, stripe_account_id: accountId, updated_at: new Date().toISOString(),
      });
    }

    const origin = req.headers.get('origin') || Deno.env.get('GAME_ORIGIN') || '';
    const link = await stripe.accountLinks.create({
      account: accountId,
      type: 'account_onboarding',
      refresh_url: `${origin}/?esn_payout=refresh`,
      return_url: `${origin}/?esn_payout=done`,
    });
    return jsonResponse({ url: link.url });
  } catch (e) {
    return jsonResponse({ error: String((e as Error)?.message || e) }, 500);
  }
});
