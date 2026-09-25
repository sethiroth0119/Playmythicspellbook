# 📢 Ethos Sponsor Network — setup

In-world sponsor billboards on District Nodes. Node owners (the corp that owns a
node) or studio admins sell ad space; players see the sponsor when they open a
node's **SPONSOR** tab. Real-money purchases + payouts run through **Stripe
Connect** (server-side Edge Functions). Revenue split: **owner 70% · studio 20%
· Foundation Reserve 10%**.

The **game-side works immediately** (billboard, authoring, admin approve/reject,
view/click tracking, external-leave warning). The Stripe pieces below light up
the paid marketplace + payouts.

---

## 1. Database — run the migration

In the Supabase SQL editor, run:

```
supabase/migrations/20260614010000_ethos_sponsor_network.sql
supabase/migrations/20260614020000_tw_node_owners.sql
```

The first creates `tw_node_ads`, `tw_ad_sellers`, `tw_ad_orders`, the
`tw_ad_track(ad_id, kind)` RPC, and RLS. Until it runs, the SPONSOR tab shows "ad
space available" and saving an ad will toast a cloud error.

The second creates `tw_node_owners` — the **admin → player node-ownership** map.
An admin opens a District Node's **ADMIN tab → NODE OWNERSHIP**, searches a
player by settlement name, and assigns them. That player (plus studio admins) is
then the only one who can publish sponsor ads on the node. Until it runs, only
admins can publish, and assigning an owner will toast a cloud error. Both
migrations are idempotent / safe to re-run.

## 2. Stripe — keys & secrets

```
supabase secrets set STRIPE_SECRET_KEY=sk_test_...        # restricted key recommended
supabase secrets set STRIPE_WEBHOOK_SECRET=whsec_...      # from step 4
supabase secrets set GAME_ORIGIN=https://playmythicspellbook.play-a3d.workers.dev
```
(`SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` are injected automatically.)

Enable **Connect** in the Stripe Dashboard (platform profile + onboarding).

## 3. Deploy the Edge Functions

```
supabase functions deploy ads-checkout
supabase functions deploy ads-connect-onboard
supabase functions deploy stripe-webhook --no-verify-jwt
```

Add to `supabase/config.toml` so Stripe (not a logged-in user) can call the hook:

```
[functions.stripe-webhook]
verify_jwt = false
```

## 4. Register the webhook

Stripe Dashboard → Developers → Webhooks → add endpoint:

```
https://<project-ref>.functions.supabase.co/stripe-webhook
```

Events: `checkout.session.completed`, `account.updated`
(optionally `charge.refunded`). Copy the signing secret into
`STRIPE_WEBHOOK_SECRET` (step 2).

---

## Money flow (destination charge)

- Sponsor clicks **Pay** → `ads-checkout` creates a Checkout Session.
- 70% routes to the node owner's connected account (`transfer_data.destination`).
- 30% stays with the platform as `application_fee_amount`.
- `stripe-webhook` flips the ad to **active** and writes one `tw_ad_orders` row
  splitting the 30% into **studio 20% / Foundation 10%** (your own ledger).
- Node owners get paid out by Stripe to their bank; the studio/foundation share
  is reconciled from `tw_ad_orders`.

If a node has **no** connected owner-seller (or it's a **studio** ad), the
platform takes 100% — no destination split.

## Node-owner payouts

A node owner opens **SPONSOR → 💳 Payout Setup** → `ads-connect-onboard` creates
an **Accounts v2** connected account (controller props, not legacy
express/custom) + a hosted onboarding link. After KYC, `account.updated` sets
`payouts_enabled = true` and their share starts routing automatically.

> ⚠ Verify the v2 `accounts.create` shape in `ads-connect-onboard/index.ts`
> against your Stripe API version before going live — capabilities + controller
> defaults vary by platform. Test in Stripe **test mode** first.

## Moderation & rules

- Player/owner ads are created as **pending** and only go live after an **admin
  approves** them (SPONSOR tab on the node, admin-only buttons) OR after payment
  (the webhook activates a paid ad). Admins publish directly.
- RLS: anyone reads **active** ads; creators read/manage their own; admin
  moderation of every row uses the service-role key (dashboard / a future admin
  Edge Function). New ads can only be inserted as `pending` — clients can't
  self-activate.
- Enforce the content rules from the spec at review time (no scams / gambling /
  adult / phishing / fake-crypto).

## What's built vs next

**Built (this phase):** billboard (image/video), node-owner + admin authoring,
admin approve/reject/pause/delete, view/click tracking (CTR), external-leave
warning, the `tw_node_ads` model, and the Stripe Connect + Checkout server
scaffolds above.

**Next phases:** full node-owner + admin **dashboards** (revenue earned/pending/
paid, top sponsor, per-node/sponsor totals, click-fraud flags); **pricing models
live** (PPC / PPV metering, premium-node price scaling by level/traffic);
**sponsored-quest** ads (ad becomes a gameplay mission with Cinder/resource
rewards); **sponsored building skins** on rebuilt structures; **player watch
rewards** (small Cinder for watching a video / unlocking a sponsor quest).
