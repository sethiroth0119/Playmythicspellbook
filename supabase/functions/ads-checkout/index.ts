// ============================================================================
// 💳 ads-checkout — Ethos Sponsor Network: buy a node sponsor ad slot.
// ----------------------------------------------------------------------------
// Creates a Stripe Checkout Session (destination charge) for one ad. 70% of the
// price routes to the node owner's connected account (transfer_data.destination);
// the 30% platform application fee is split 20% studio / 10% Foundation Reserve
// by the stripe-webhook into tw_ad_orders. If the node has no connected owner,
// the platform takes 100% (studio ad).
//
// Env (supabase secrets set):
//   STRIPE_SECRET_KEY            — sk_live_… / sk_test_…  (RESTRICTED key recommended)
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY  — provided automatically
//   GAME_ORIGIN                 — fallback success/cancel origin (e.g. https://playmythicspellbook.play-a3d.workers.dev)
//
// Body: { ad_id: string }   Auth: the buyer's Supabase JWT (Authorization header)
// Returns: { url }  — redirect the browser here.
// ============================================================================
import Stripe from 'npm:stripe@^18';
import { createClient } from 'npm:@supabase/supabase-js@^2';
import { handlePreflight, jsonResponse } from '../_shared/cors.ts';

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY') ?? '');
const admin = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '');
const PLATFORM_FEE = 0.30; // studio 20% + foundation 10%

Deno.serve(async (req) => {
  const pre = handlePreflight(req); if (pre) return pre;
  try {
    const jwt = (req.headers.get('Authorization') ?? '').replace('Bearer ', '');
    const { data: { user } } = await admin.auth.getUser(jwt);
    if (!user) return jsonResponse({ error: 'unauthorized' }, 401);

    const { ad_id } = await req.json().catch(() => ({}));
    if (!ad_id) return jsonResponse({ error: 'ad_id required' }, 400);

    const { data: ad } = await admin.from('tw_node_ads').select('*').eq('id', ad_id).single();
    if (!ad) return jsonResponse({ error: 'ad not found' }, 404);
    if ((ad.price_cents | 0) <= 0) return jsonResponse({ error: 'ad has no price' }, 400);

    // The node owner's connected account receives the 70% destination split.
    let destination: string | null = null;
    if (ad.owner_corp_id) {
      const { data: seller } = await admin.from('tw_ad_sellers')
        .select('stripe_account_id, payouts_enabled').eq('corp_id', ad.owner_corp_id).single();
      if (seller?.stripe_account_id && seller.payouts_enabled) destination = seller.stripe_account_id;
    }

    const origin = req.headers.get('origin') || Deno.env.get('GAME_ORIGIN') || '';
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: [{
        quantity: 1,
        price_data: {
          currency: ad.currency || 'usd',
          unit_amount: ad.price_cents,
          product_data: {
            name: `Sponsor ad — ${ad.sponsor_name}`,
            description: `District Node ${ad.node_id} · ${ad.price_model || 'flat'} placement`,
          },
        },
      }],
      // Destination charge: platform is merchant of record, takes the app fee,
      // forwards the rest to the node owner's connected account.
      payment_intent_data: destination
        ? { application_fee_amount: Math.round(ad.price_cents * PLATFORM_FEE), transfer_data: { destination } }
        : undefined,
      success_url: `${origin}/?esn_paid=1`,
      cancel_url: `${origin}/?esn_cancel=1`,
      metadata: {
        ad_id: String(ad.id),
        node_id: String(ad.node_id),
        owner_corp_id: ad.owner_corp_id ? String(ad.owner_corp_id) : '',
        buyer_user_id: user.id,
      },
    });
    return jsonResponse({ url: session.url });
  } catch (e) {
    return jsonResponse({ error: String((e as Error)?.message || e) }, 500);
  }
});
