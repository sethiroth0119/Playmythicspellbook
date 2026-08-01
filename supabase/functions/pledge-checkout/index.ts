// ============================================================================
// 🛒 pledge-checkout — Shop founder/node packages: create a Stripe Checkout
// Session for one tier. Prices + seat caps live SERVER-SIDE here; the client
// only sends a tier_id. The pledge-webhook records the paid row.
//
// Env (supabase secrets set): STRIPE_SECRET_KEY  (sk_live_… / restricted key)
//   SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are provided automatically.
// Body: { tier_id }   Auth: buyer's Supabase JWT.  Returns: { url }
// Deployed 2026-07-31 via MCP (verify_jwt = true; OPTIONS is exempt).
// ============================================================================
import Stripe from 'npm:stripe@^18';
import { createClient } from 'npm:@supabase/supabase-js@^2';

const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

// tier_id → price (USD cents), display name, seat cap (null = unlimited).
// The three top founder tiers (dominion-founder / titan-node / eternal) are
// deliberately ABSENT — they stay Coming Soon. Keep in sync with the
// SHOP_STRIPE_TIERS list in market-deploy/public/index.html.
const TIERS: Record<string, { name: string; cents: number; seats: number | null }> = {
  'vault-key':               { name: 'Vault Key',                cents: 1000,   seats: null },
  'scavenger':               { name: 'Scavenger Tier',           cents: 5000,   seats: null },
  'starter-node':            { name: 'Starter Node License',     cents: 25000,  seats: 100 },
  'outpost-operator':        { name: 'Outpost Operator',         cents: 50000,  seats: 49 },
  'foundation-contributor':  { name: 'Foundation Contributor',   cents: 200000, seats: 25 },
};

const admin = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '');

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  try {
    const key = Deno.env.get('STRIPE_SECRET_KEY') ?? '';
    if (!key) return json({ error: 'stripe_not_configured' }, 503);
    const stripe = new Stripe(key);

    const jwt = (req.headers.get('Authorization') ?? '').replace('Bearer ', '');
    const { data: { user } } = await admin.auth.getUser(jwt);
    if (!user) return json({ error: 'unauthorized' }, 401);

    const { tier_id } = await req.json().catch(() => ({}));
    const tier = TIERS[String(tier_id ?? '')];
    if (!tier) return json({ error: 'unknown_tier' }, 400);

    // Seat cap — count confirmed purchases of this tier.
    if (tier.seats != null) {
      const { count } = await admin.from('pledge_purchases')
        .select('id', { count: 'exact', head: true })
        .eq('tier_id', tier_id).eq('status', 'paid');
      if ((count ?? 0) >= tier.seats) return json({ error: 'sold_out' }, 409);
    }

    const origin = req.headers.get('origin') || 'https://mythicspellbook.xyz';
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: [{
        quantity: 1,
        price_data: {
          currency: 'usd',
          unit_amount: tier.cents,
          product_data: {
            name: `Mythic Spellbook — ${tier.name}`,
            description: 'Founder & Node package (Shop). Benefits delivered to your Mythic Spellbook account.',
          },
        },
      }],
      success_url: `${origin}/?pledge_paid=1&tier=${encodeURIComponent(String(tier_id))}`,
      cancel_url: `${origin}/?pledge_cancel=1`,
      customer_email: user.email ?? undefined,
      metadata: {
        pledge_tier: String(tier_id),
        pledge_tier_name: tier.name,
        buyer_user_id: user.id,
      },
    });
    return json({ url: session.url });
  } catch (e) {
    return json({ error: String((e as Error)?.message || e) }, 500);
  }
});
