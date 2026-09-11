// ============================================================================
// 🔑 transport-keys — buy a Transport Key with real money, and credit it.
//
// Keys make a haulier's rigs arrive faster. Five levels, $7.99 → $99.
//
// 🔴 PRICES LIVE HERE, SERVER-SIDE. The client sends a LEVEL, never an amount.
//    A client that could send `cents` could buy a $99 key for one cent, and no
//    amount of front-end validation changes that — the only safe place for a
//    price is somewhere the buyer cannot reach.
//
// THREE ACTIONS, ONE FUNCTION:
//   { action: 'catalog' }                → { keys, purchasable }  public
//   { action: 'checkout', level }        → { url }   Stripe Checkout session
//   { action: 'confirm', session_id }    → { ok, level }  verify + credit
//
// ⚠ WHY A CONFIRM ENDPOINT AND NOT A WEBHOOK BRANCH. stripe-webhook already
//   exists and is entirely about tw_ad_orders; editing it to also understand
//   keys means one function whose failure takes down two unrelated payment
//   flows. Confirm-on-return is the pattern this game already uses for Aza coin
//   and for garage rigs (azaConfirmReturn / garageConfirmReturn), so this
//   matches the app rather than introducing a second style.
//
// 🔴 CONFIRM IS NOT "THE CLIENT SAYS IT PAID". It retrieves the session FROM
//    STRIPE and refuses unless:
//      · payment_status === 'paid'                (Stripe's word, not ours)
//      · metadata.buyer_user_id === the caller's own id  (no crediting someone
//        else's purchase to yourself, and no replaying a friend's session)
//      · the level in metadata is one we sell
//    Idempotency is the UNIQUE constraint on transport_keys.stripe_session:
//    a replayed confirm hits the constraint and reports the key already held
//    rather than crediting twice.
//
// Env: STRIPE_SECRET_KEY. SUPABASE_URL / SERVICE_ROLE_KEY are automatic.
// ⚠ THAT SECRET IS A SUPABASE ONE AND IT IS NOT THE CLOUDFLARE ONE. worker.js
//   reads env.STRIPE_SECRET_KEY too, from Cloudflare's own secret store, which
//   is why /api/garage/* can sell a convoy rig while this function cannot sell
//   a key. Set it under Edge Functions → Secrets. Until it is set, `catalog`
//   still answers and reports purchasable:false, so the shop shows prices and
//   says why it cannot sell rather than showing nothing at all.
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

/* level → price and what the player is actually buying. `speed` is display
   copy; the authoritative multiplier is transport_key_speed() in SQL, so the
   quote and the arrival cannot disagree with the shop. */
const KEYS: Record<string, { name: string; cents: number; speed: string }> = {
  '1': { name: 'Bronze Key',   cents:  799, speed: 'runs arrive ~8% faster' },
  '2': { name: 'Iron Key',     cents: 1999, speed: 'runs arrive ~18% faster' },
  '3': { name: 'Cobalt Key',   cents: 3999, speed: 'runs arrive ~30% faster' },
  '4': { name: 'Meridian Key', cents: 6999, speed: 'runs arrive ~45% faster' },
  '5': { name: 'Ashgate Key',  cents: 9900, speed: 'runs arrive 60% faster — the fastest on the road' },
};

const admin = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '');

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  try {
    const key = Deno.env.get('STRIPE_SECRET_KEY') ?? '';

    const body = await req.json().catch(() => ({}));
    const action = String(body.action ?? 'checkout');

    /* ── the shop can ask what is for sale, so the client never hardcodes a
       price. ANSWERED FIRST, BEFORE THE STRIPE KEY AND BEFORE AUTH, and that
       ordering is the bug this block used to be on the wrong side of.
       🔴 MEASURED, NOT SUPPOSED: `POST | 503` on this function in the edge
          logs, which is reachable from exactly one line — the missing-key
          guard that used to stand above here. STRIPE_SECRET_KEY is set as a
          CLOUDFLARE secret (worker.js reads env.STRIPE_SECRET_KEY and
          /api/garage/* works); it was never set in SUPABASE's edge-function
          env, which is a different secret store. So this function 503'd on
          every call, and because the price list was behind that guard the
          Vendor Market's whole Transport Keys tab rendered one red line:
          "The key store is unreachable right now."
          A PRICE LIST IS NOT A SECRET. It needs no Stripe client, no user and
          no session — it is the shop window, and a shop with no prices in the
          window is indistinguishable from a shop that has closed down.
       ⚠ `purchasable` IS THE HONEST HALF. The catalog answering while checkout
          cannot run is exactly the state this project's UI rules are about: a
          stopped thing must SAY it is stopped rather than look like a working
          one. The client renders the prices and disables the buttons with a
          reason, instead of hiding the store and guessing why.
       Auth is not required here either: a signed-out visitor may read prices,
       the same way they can read the Aza coin tiers. Nothing user-specific is
       returned — `tkeyLevel()` asks the database separately for what they own. */
    if (action === 'catalog') {
      return json({
        purchasable: !!key,
        keys: Object.entries(KEYS).map(([lvl, k]) => ({
          level: Number(lvl), name: k.name, cents: k.cents, speed: k.speed,
          usd: (k.cents / 100).toFixed(2),
        })),
      });
    }

    // Everything past this point moves money, so it needs both.
    if (!key) return json({ error: 'stripe_not_configured' }, 503);
    const stripe = new Stripe(key);

    const jwt = (req.headers.get('Authorization') ?? '').replace('Bearer ', '');
    const { data: { user } } = await admin.auth.getUser(jwt);
    if (!user) return json({ error: 'unauthorized' }, 401);

    // ── CHECKOUT ────────────────────────────────────────────────────────────
    if (action === 'checkout') {
      const lvl = String(body.level ?? '');
      const k = KEYS[lvl];
      if (!k) return json({ error: 'unknown_key_level' }, 400);

      /* Already hold this level or better? Say so instead of taking the money.
         Keys are cumulative and permanent, so a second purchase of the same
         level buys the player nothing — charging for it would be a bug that
         looks like a sale. */
      const { data: held } = await admin
        .from('transport_keys').select('level').eq('user_id', user.id)
        .order('level', { ascending: false }).limit(1);
      const have = (held && held[0] && held[0].level) || 0;
      if (have >= Number(lvl)) {
        return json({ error: 'already_held', held: have }, 409);
      }

      const origin = req.headers.get('origin') || 'https://playmythicspellbook.com';
      const session = await stripe.checkout.sessions.create({
        mode: 'payment',
        line_items: [{
          quantity: 1,
          price_data: {
            currency: 'usd',
            unit_amount: k.cents,
            product_data: {
              name: `Mythic Spellbook — ${k.name}`,
              description: `Transport Key level ${lvl}. ${k.speed} Permanent, tied to your account.`,
            },
          },
        }],
        success_url: `${origin}/?tkey_paid=1&session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${origin}/?tkey_cancel=1`,
        customer_email: user.email ?? undefined,
        metadata: {
          transport_key_level: String(lvl),
          transport_key_name: k.name,
          buyer_user_id: user.id,
        },
      });
      return json({ url: session.url });
    }

    // ── CONFIRM ─────────────────────────────────────────────────────────────
    if (action === 'confirm') {
      const sid = String(body.session_id ?? '');
      if (!sid) return json({ error: 'no_session' }, 400);

      const sess = await stripe.checkout.sessions.retrieve(sid);
      if (!sess || sess.payment_status !== 'paid') {
        return json({ ok: false, why: 'not_paid' }, 402);
      }
      const m = (sess.metadata || {}) as Record<string, string>;
      /* 🔴 The session must be THIS user's. Without this check anyone could
         paste any session id and be credited a key somebody else paid for. */
      if (m.buyer_user_id !== user.id) return json({ ok: false, why: 'not_your_session' }, 403);

      const lvl = Number(m.transport_key_level || 0);
      if (!KEYS[String(lvl)]) return json({ ok: false, why: 'unknown_level' }, 400);

      const { error } = await admin.from('transport_keys').insert({
        user_id: user.id,
        level: lvl,
        cents: sess.amount_total ?? KEYS[String(lvl)].cents,
        stripe_session: sid,
      });
      /* 23505 = the unique constraint on stripe_session. A replayed confirm is
         SUCCESS, not an error: the player has the key, which is what they are
         asking about. Anything else is a real failure and must surface. */
      if (error && !String(error.message || '').includes('duplicate')) {
        return json({ ok: false, why: error.message }, 500);
      }
      const { data: now } = await admin
        .from('transport_keys').select('level').eq('user_id', user.id)
        .order('level', { ascending: false }).limit(1);
      return json({ ok: true, level: (now && now[0] && now[0].level) || lvl, name: KEYS[String(lvl)].name });
    }

    return json({ error: 'unknown_action' }, 400);
  } catch (e) {
    return json({ error: String((e as Error)?.message || e) }, 500);
  }
});
