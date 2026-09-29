// ============================================================================
// 🪝 stripe-webhook — Ethos Sponsor Network payment confirmation.
// ----------------------------------------------------------------------------
// On `checkout.session.completed`: mark the ad ACTIVE and write the revenue
// split (owner 70% / studio 20% / Foundation 10%) into tw_ad_orders. The Stripe
// destination charge already routed the owner's 70% to their connected account;
// we just record the ledger + flip the ad live with the service-role key.
//
// ⚠ This function is called by STRIPE, not a logged-in user. Set:
//     [functions.stripe-webhook]  verify_jwt = false      (in supabase/config.toml)
//   and register the endpoint in the Stripe Dashboard → Webhooks:
//     https://<project>.functions.supabase.co/stripe-webhook
//   listening for `checkout.session.completed` (+ optionally `charge.refunded`).
//
// Env: STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
// ============================================================================
import Stripe from 'npm:stripe@^18';
import { createClient } from 'npm:@supabase/supabase-js@^2';

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY') ?? '');
const admin = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '');
const WH_SECRET = Deno.env.get('STRIPE_WEBHOOK_SECRET') ?? '';

Deno.serve(async (req) => {
  const sig = req.headers.get('stripe-signature');
  const raw = await req.text();
  let evt: Stripe.Event;
  try {
    // constructEventAsync — required on Deno (sync crypto isn't available).
    evt = await stripe.webhooks.constructEventAsync(raw, sig ?? '', WH_SECRET);
  } catch (e) {
    return new Response(`bad signature: ${(e as Error)?.message}`, { status: 400 });
  }

  try {
    if (evt.type === 'checkout.session.completed') {
      const s = evt.data.object as Stripe.Checkout.Session;
      const m = s.metadata || {};
      const amount = s.amount_total ?? 0;
      const ownerShare = Math.round(amount * 0.70);
      const studioShare = Math.round(amount * 0.20);
      const foundationShare = amount - ownerShare - studioShare; // remainder → 10%

      if (m.ad_id) {
        await admin.from('tw_node_ads').update({ status: 'active', updated_at: new Date().toISOString() }).eq('id', m.ad_id);
      }
      await admin.from('tw_ad_orders').insert({
        ad_id: m.ad_id || null,
        node_id: m.node_id || null,
        owner_corp_id: m.owner_corp_id || null,
        buyer_user_id: m.buyer_user_id || null,
        amount_cents: amount,
        currency: s.currency || 'usd',
        owner_share_cents: ownerShare,
        studio_share_cents: studioShare,
        foundation_share_cents: foundationShare,
        stripe_session_id: s.id,
        stripe_payment_intent: typeof s.payment_intent === 'string' ? s.payment_intent : (s.payment_intent?.id ?? null),
        status: 'paid',
      });
    } else if (evt.type === 'account.updated') {
      // Connect onboarding progress → reflect payout-readiness on the seller row.
      const acct = evt.data.object as Stripe.Account;
      await admin.from('tw_ad_sellers').update({
        payouts_enabled: !!acct.payouts_enabled,
        details_submitted: !!acct.details_submitted,
        updated_at: new Date().toISOString(),
      }).eq('stripe_account_id', acct.id);
    }
  } catch (e) {
    // Never 500 a webhook for a downstream DB hiccup — Stripe would retry-storm.
    console.error('webhook handler error:', (e as Error)?.message);
  }
  return new Response('ok', { status: 200 });
});
