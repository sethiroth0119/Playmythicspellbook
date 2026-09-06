# Stripe setup

This game has **three** independent Stripe rails, each off until you set its
secret. They share the same `STRIPE_SECRET_KEY` Worker secret:

- **Part A — Aza-coin PURCHASES** (players buy premium currency). Uses Stripe
  **Checkout**. *This is what you turn on to let players buy Aza coin.*
- **Part B — Cashout PAYOUTS** (players cash Cinders out to real money). Uses
  Stripe **Connect**. Stays off until you deliberately enable it.
- **Part C — The BAZAAR** (players sell items to each other for real money and
  we take a fee). Uses Checkout to collect and Part B's Connect rail to pay
  out. Needs `SB_SERVICE` as well, and stays hidden until it has one.

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

# Part C — The Bazaar (player-to-player sales, with our fee)

Players sell in-game cards and held items to each other for **real money**. We
take a platform fee on every sale and pay sellers out to the Stripe account
they already connected in Part B. Ships **off** — the Bazaar tile hides itself
until both the Stripe key and the Supabase service key are set.

## The money shape

```
buyer  → Stripe Checkout → PLATFORM balance      (we are merchant of record)
       → rm_earnings credit for the seller       (sale amount MINUS our fee)
       …hold window (default 7 days)…
seller → POST /api/market/payout → Stripe transfer → their connected account
```

This is **separate charges and transfers**, not a destination charge. The
seller's share deliberately sits with the platform for the hold window, because
that is the only period in which a chargeback can be answered by reversing a
ledger row rather than chasing someone's bank account. `charge.refunded` and
`charge.dispute.created` webhooks automatically write the reversing row.

**We are the merchant of record.** Buyers see our name on their statement and
disputes come to us. That is the cost of the hold window.

## 1. Database

Run `sql/038_real_money_market.sql` in the Supabase SQL editor (idempotent,
ends with a verify block — every line should read `ok`). It creates
`rm_listings`, `rm_orders`, `rm_earnings`, `rm_payouts`, `rm_claims` and
`rm_config`, with RLS and the RPCs.

The three money-writing RPCs (`rm_record_order`, `rm_payout_settle`,
`rm_refund_order`) are **deliberately ungranted** — only the service-role key
reaches them. Do not "fix" that by granting them; it would let any signed-in
player mint themselves earnings for a sale that never happened.

## 2. Stripe dashboard

Add `checkout.session.completed`, `charge.refunded` and
`charge.dispute.created` to your webhook endpoint. Any of
`/api/market/webhook`, `/api/shop/webhook` or `/api/cashout/webhook` will
fulfil a Bazaar sale — whichever is already registered works.

The restricted key needs **Checkout Sessions** (write) and **Transfers**
(write) on top of the Part B permissions.

## 3. Cloudflare secrets / vars

```sh
npx wrangler secret put SB_SERVICE          # REQUIRED — price authority + fulfilment
npx wrangler secret put STRIPE_WEBHOOK_SECRET
# optional tuning (plain vars are fine; defaults shown)
#   MARKET_FEE_BPS    1000   = 10.00%  (basis points, bounded 0-5000)
#   MARKET_HOLD_DAYS  7                (bounded 0-90)
# withdrawals stay OFF until Part B's switch is on:
npx wrangler secret put CASHOUT_PAYOUTS_ENABLED   # value: true
```

`MARKET_FEE_BPS` is the fee the Worker charges; `rm_config.fee_bps` is the
number the UI quotes to a seller *before* they list. **Change both together**
or sellers will be quoted a fee they are not charged. The fee is recomputed
from the amount Stripe actually settled and stored on the order row, so
changing it later never rewrites what a past seller was owed.

## 4. How a seller connects their Stripe account

The Bazaar's **Earnings** tab carries its own *Connect Stripe account* button,
and the **Sell** tab prompts for one before a seller lists. Both call
`POST /api/cashout/connect` — the **same rail as Part B**, writing the same
`cashout_accounts` row. There is no second onboarding flow and there must
never be one: two account maps for one player is how a payout reaches the
wrong Stripe account.

⚠ **Why the button is duplicated in the Bazaar rather than linked to the
Cashout Vault.** The Vault is gated behind a Lv 15 hero or owning a node, and
it bounces anyone who does not qualify. A seller with neither could otherwise
earn real money with no reachable way to connect an account to be paid into.
Selling must never depend on that progression gate — if you move the Vault's
gate, this button stays.

Onboarding is Stripe-hosted: the player completes identity verification and
bank entry on Stripe's own pages and the game stores only the connected-account
id. Stripe returns to `/?cashout=return`; the Bazaar reopens on the Earnings
tab only if *it* started the flow (a `sessionStorage` marker), so a
Vault-initiated onboarding still returns to the Vault.

A player can list and sell **before** connecting — earnings accrue to the
ledger regardless, and the account is only required to withdraw.

## 5. Endpoints

| Route | Purpose |
|---|---|
| `GET  /api/market/config`   | `{enabled,ready,feeBps,holdDays,payoutsEnabled}` — no secrets |
| `POST /api/market/checkout` | Body is a **listing id only**. Price is read from the DB with the service key |
| `GET  /api/market/confirm`  | Buyer's return leg — re-verifies `paid` against Stripe, then credits |
| `POST /api/market/webhook`  | Signature-verified. Fulfils sales; reverses refunds/disputes |
| `GET  /api/market/earnings` | Balance, hold status, and whether Stripe will accept a payout |
| `POST /api/market/payout`   | 501 unless `CASHOUT_PAYOUTS_ENABLED=true`. Amount authorised by the database |

## 6. 🔴 Read this before switching it on

**There is no server-authoritative item inventory in this game.** Cards and
units live in the player's profile blob, and the existing Cinder card market is
settled entirely client-side — nothing ever verified that a seller owned what
they listed. That is survivable at Cinder prices. At dollar prices a modified
client can sell something that does not exist and the chargeback lands on us.

`sql/038` does what can be done without a canonical inventory and does not
pretend to more: one open listing per item id per seller, a per-seller open
listing cap, server-side price bounds, and the hold window as the human
backstop. **The caps are the fraud budget — do not raise them to make the
Bazaar feel busier.** The real fix is to move unit ownership into a server
table and have `rm_list()` delete the row in the same transaction; the header
of `sql/038` says so at the point someone would need to know.

Also yours, not this repo's:

- **Holding other people's money is regulated** in most jurisdictions. The
  escrow window means we are custodying seller funds. Get advice before launch.
- **Tax reporting.** Paying sellers real money creates 1099-K/equivalent
  obligations past thresholds. Stripe Connect can file these — turn it on.
- Fund the platform Stripe balance; understand Connect fees and
  negative-balance liability.
- Watch disputes actively while the hold window is the main defence.
- Keep withdrawals behind manual review at launch.

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
