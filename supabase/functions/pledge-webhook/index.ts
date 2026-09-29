// ============================================================================
// 🪝 pledge-webhook — Stripe calls this (NOT a logged-in user) when a Shop
// checkout completes. Verifies the Stripe signature (that IS the auth —
// verify_jwt is off) and records the paid row in pledge_purchases.
//
// Register in Stripe Dashboard → Webhooks:
//   https://ktsiasyjusesawtrwrjc.supabase.co/functions/v1/pledge-webhook
//   listening for: checkout.session.completed
// Env: STRIPE_SECRET_KEY, PLEDGE_WEBHOOK_SECRET (that endpoint's whsec_…)
// Deployed 2026-07-31 via MCP (verify_jwt = false).
// ============================================================================
import Stripe from 'npm:stripe@^18';
import { createClient } from 'npm:@supabase/supabase-js@^2';

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY') ?? '');
const admin = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '');
const WH_SECRET = Deno.env.get('PLEDGE_WEBHOOK_SECRET') ?? Deno.env.get('STRIPE_WEBHOOK_SECRET') ?? '';

Deno.serve(async (req) => {
  const sig = req.headers.get('stripe-signature');
  const raw = await req.text();
  let evt: Stripe.Event;
  try {
    evt = await stripe.webhooks.constructEventAsync(raw, sig ?? '', WH_SECRET);
  } catch (e) {
    return new Response(`bad signature: ${(e as Error)?.message}`, { status: 400 });
  }
  try {
    if (evt.type === 'checkout.session.completed') {
      const s = evt.data.object as Stripe.Checkout.Session;
      const m = s.metadata || {};
      if (m.pledge_tier && m.buyer_user_id) {
        // upsert on stripe_session_id — webhook retries stay idempotent.
        await admin.from('pledge_purchases').upsert({
          user_id: m.buyer_user_id,
          tier_id: m.pledge_tier,
          tier_name: m.pledge_tier_name || m.pledge_tier,
          amount_cents: s.amount_total ?? 0,
          currency: s.currency || 'usd',
          stripe_session_id: s.id,
          stripe_payment_intent: typeof s.payment_intent === 'string' ? s.payment_intent : (s.payment_intent?.id ?? null),
          status: 'paid',
        }, { onConflict: 'stripe_session_id' });
      }
    }
  } catch (e) {
    // Never 500 a webhook for a downstream DB hiccup — Stripe would retry-storm.
    console.error('pledge-webhook handler error:', (e as Error)?.message);
  }
  return new Response('ok', { status: 200 });
});
