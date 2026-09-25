# Stripe setup

This game has **two** independent Stripe rails, each off until you set its
secret. They share the same `STRIPE_SECRET_KEY` Worker secret:

- **Part A — Aza-coin PURCHASES** (players buy premium currency). Uses Stripe
  **Checkout**. *This is what you turn on to let players buy Aza coin.*
- **Part B — Cashout PAYOUTS** (players cash Cinders out to real money). Uses
  Stripe **Connect**. Stays off until you deliberately enable it.

---

# Part A — Aza-coin Purchases (Stripe Checkout)

The store (Starter Cache … Legend's Hoard) is **fully built** and runs in
**mock mode** until `STRIPE_SECRET_KEY` is set. The Worker then returns a real
Stripe Checkout URL from `POST /api/buy/checkout`; the player pays on Stripe's
hosted page; on return the client calls `GET /api/buy/confirm?sid=…`, which
re-verifies `payment_status==='paid'` against Stripe and credits the Aza
exactly once via the UNIQUE `aza_purchases` row. The card number is entered on
Stripe, never in the game.

**Server-side pricing is the source of truth** — `AZA_PACKS` in `worker.js`
(sp_starter 2/$1.99, sp_adv 5/$4.99, sp_hero 20/$19.99, sp_champ 50/$49.99,
sp_legend 150/$14999¢). Keep it in sync with `SOVEREIGN_PACKAGES` in
`public/index.html`.

### Activate it (≈5 min — you run these, the key never goes to chat/repo)

1. **Database** — run `api.sql` in the Supabase SQL editor (idempotent). It
   creates `aza_purchases` (self-scoped RLS) used for once-only crediting.
2. **Stripe key** — in the Stripe Dashboard create a **Restricted API key**
   (`rk_…`, least privilege) with **WRITE** on:
   - **Checkout Sessions**
   - **PaymentIntents**
   - (Charges: Read is handy for reconciliation.)
   Start in **test mode** to verify, then create the **live-mode** equivalent.
   *(A full secret key `sk_…` also works but is broader — prefer the RAK.)*
3. **Cloudflare secrets** — set them as Worker secrets (never in `wrangler.jsonc`):
   ```sh
   npx wrangler secret put STRIPE_SECRET_KEY    # paste the rk_… (or sk_…) key
   npx wrangler secret put PUBLIC_BASE_URL       # value: https://playmythicspellbook.com
   ```
   Secrets take effect on the next request — re-deploy not required, but
   `npm run deploy` is fine too.
4. **Verify** — `GET https://playmythicspellbook.com/api/buy/config` should now
   return `{"enabled":true}`. Test a purchase with Stripe test card
   `4242 4242 4242 4242`, any future expiry/CVC. The Aza should land in the
   buyer's balance once, even on refresh.

### Optional hardening (recommended before high volume)
- Checkout auto-redirects to the success URL, so the confirm-on-return flow
  credits reliably. For belt-and-suspenders (credit even if the player closes
  the tab mid-redirect), add a `checkout.session.completed` **webhook** that
  credits server-side with the service-role key. Ask and I'll wire it.
- Complete Stripe's go-live checklist and your tax obligations for paid users.

---

# Part B — Cashout payout rail (Stripe Connect)

The game ships in **mock mode**. Real money only moves once *you* (the
operator) configure your own Stripe account below. Until then every Cashout
endpoint reports "not configured" and the in-game ledger stays simulated —
nothing breaks.

**The game/Worker never sees bank or ID data.** Players complete identity
verification (KYC) and bank entry on **Stripe's own hosted onboarding pages**.
We only store a Stripe *connected-account id* (in `cashout_accounts`).

## 1. One-time database

Run the updated `api.sql` in the Supabase SQL editor (idempotent). It adds
`cashout_accounts` (self-scoped RLS) alongside the existing tables.

## 2. Stripe dashboard

1. Create/active a Stripe account; enable **Connect**.
2. Create a **Restricted API key** (`rk_…`) — *not* the secret key. Grant the
   minimum: Connect **Accounts** (write), **Account links** (write),
   **Transfers** (write), **Accounts** (read). Principle of least privilege.
3. Add a webhook endpoint → `https://playmythicspellbook.com/api/cashout/webhook`
   for `account.updated`, `transfer.*`. Copy its signing secret.

## 3. Cloudflare secrets (never commit these)

Set them as **Worker secrets** — *not* in `wrangler.jsonc` (that file is
committed):

```sh
npx wrangler secret put STRIPE_SECRET_KEY        # paste the rk_… restricted key
npx wrangler secret put STRIPE_WEBHOOK_SECRET    # paste the whsec_… signing secret
# optional, only when you are ready for REAL transfers and have funded the
# platform balance + added server-side authorisation/anti-fraud:
npx wrangler secret put CASHOUT_PAYOUTS_ENABLED  # value: true
# optional: override onboarding return/refresh origin
npx wrangler secret put PUBLIC_BASE_URL          # e.g. https://playmythicspellbook.com
```

Rotate keys if anyone with access leaves. Add an IP allowlist to the key in
the Stripe dashboard if your Worker egress IPs are stable.

## 4. Endpoints (all server-side in `worker.js`)

| Route | Purpose |
|---|---|
| `GET  /api/cashout/config`  | `{enabled,payoutsEnabled}` — no secrets, drives the UI |
| `POST /api/cashout/connect` | Creates an Accounts-v2 connected account + returns a **Stripe-hosted onboarding URL** (client redirects) |
| `GET  /api/cashout/status`  | Booleans only: connected / payouts_enabled / requirements_due |
| `POST /api/cashout/webhook` | **Signature-verified** (HMAC-SHA256); ack only, no fund logic |
| `POST /api/cashout/payout`  | **501 disabled** unless `CASHOUT_PAYOUTS_ENABLED=true`. Transfer to the connected account |

Callers authenticate with their Supabase access token
(`Authorization: Bearer …`), verified server-side against Supabase.

## 5. Before going live (your responsibility)

- Fund the platform Stripe balance; understand Connect fees & negative-balance
  liability (this scaffold uses Stripe-managed risk / `dashboard:none`).
- **Re-derive the payout amount server-side from a trusted ledger** — never
  trust the client. Reuse the in-game safeguards (verification, cooldown,
  anti-fraud velocity, Reserve-balance allowance, AI inflation hold) as
  *server* authorisation before any `/payout`.
- Complete Stripe's [Go-live checklist](https://docs.stripe.com/get-started/checklist/go-live.md),
  and your own tax/AML/KYC obligations for paying users.
- Keep payouts behind manual or strongly-authorised review at launch.

This repo intentionally ships payouts **off**. Turning them on is a
deliberate, operator-only action.

---

## Admin User Management — full account directory (optional)

Arcanum → **User Management** works in a limited public-search mode out of
the box. To list **every account** with profile info (Cinders / Aza / last
seen / online), set the Supabase **service-role** key as a Worker secret:

```sh
npx wrangler secret put SB_SERVICE   # paste your Supabase service_role key
```

- Find it in Supabase → Project Settings → API → **service_role** secret.
- It is **only** read server-side by `/api/admin/users`, which first
  verifies the caller's Supabase token and that their email is in the
  Worker's `ADMIN_EMAILS` allowlist. Never goes to the client or repo.
- The service key bypasses RLS — treat it like a root password. Rotate it
  if exposed. Until it's set, the endpoint returns 501 and the screen
  silently falls back to public search (nothing breaks).
- "Online" = the account's profile synced within the last 5 minutes.
