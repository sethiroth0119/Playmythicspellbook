# 💵 The Bazaar — handoff (2026-09-06)

Real-money player-to-player sales, with a platform fee and Stripe payouts to sellers.

**Branch:** `claude/stripe-player-payouts-fd2csw` (2 commits, pushed, no PR opened)
**Base:** `main` @ the commit before `9d97495`
**State:** code complete and syntax-clean · **migration NOT applied** · **NOT deployed** · **never exercised against real Stripe**

```
9d97495  Add the Bazaar: real-money player sales with a platform fee and payouts
8b81ce4  Let sellers connect a Stripe account from inside the Bazaar
```

---

## THE PINNED DESIGN DECISIONS

> Asked and answered by the operator on 2026-09-06. Do not re-derive these.

**1. Escrow-then-payout, NOT a destination charge.**
```
buyer  → Stripe Checkout → PLATFORM balance      (we are merchant of record)
       → rm_earnings credit for the seller       (sale amount MINUS our fee)
       …hold window (default 7 days)…
seller → POST /api/market/payout → Stripe transfer → their connected account
```
The seller's share deliberately sits with the platform for the hold window. That window is
the entire point: a chargeback inside it is answered by reversing a ledger row, instead of
chasing money out of someone's bank account. `charge.refunded` and `charge.dispute.created`
write the reversing row automatically.

⚠ The cost of this shape is that **we are merchant of record** — buyers see our name on
their statement and disputes come to us. That was accepted knowingly. A destination charge
(instant split, `application_fee_amount`) was the rejected alternative; it has no hold
window, so a refund after the seller is paid leaves us negative.

**2. What is sold: existing in-game digital items** — Forge custom cards and held items.
Not a separate goods/services bazaar.

**3. ONE connected Stripe account per player.** The Bazaar reuses Part B's
`cashout_accounts` row via `POST /api/cashout/connect`. **Never build a second onboarding
flow** — two account maps for one player is how a payout reaches the wrong Stripe account.

---

## 🔴 THE OPEN RISK — read before switching this on

**There is no server-authoritative item inventory in this game.** Cards and units live in the
player's profile blob. The existing Cinder card market (`card_market_listings`) is settled
*entirely client-side*: the seller uploads their own `card_json`/`unit_json` snapshot and the
buyer's client adds it locally. **Nothing has ever verified that a seller owned what they
listed.**

That is survivable at Cinder prices. At dollar prices a modified client can sell something
that does not exist and the chargeback lands on us.

`sql/038` does what can be done without a canonical inventory and does not pretend to more:

| Defence | Where |
|---|---|
| One open listing per item id per seller | partial unique index `rm_listings_one_open_per_item` |
| Per-seller open listing cap (default 10) | `rm_config.max_open`, enforced in `rm_list()` |
| Server-side price bounds ($2–$500) | `rm_config.min_cents`/`max_cents`, enforced in `rm_list()` |
| The hold window | `rm_config.hold_days`, the human backstop |

⚠ **The caps ARE the fraud budget.** Do not raise them to make the Bazaar feel busier.

**The real fix**, when someone does it: move unit ownership into a server table and have
`rm_list()` DELETE the row inside the same transaction that creates the listing. The header
of `sql/038` says so at the point a reader would need to know. Treat that as the prerequisite
for raising limits or opening this to volume.

While it is off, the risk is zero — nothing is deployed and nothing is applied.

---

## ACTIVATION CHECKLIST (in this order)

Each step is independently safe; the feature stays hidden until all of them are done.

1. **Migration.** Run `sql/038_real_money_market.sql` in the Supabase SQL editor for project
   `ktsiasyjusesawtrwrjc`. Idempotent, re-runnable. It ends with a verify block — **every
   line must read `ok`.** If `no client write policy on money tables` or
   `service-only RPCs not granted to players` comes back anything else, stop.
2. **Worker secrets.**
   ```sh
   npx wrangler secret put SB_SERVICE            # REQUIRED — price authority + fulfilment
   npx wrangler secret put STRIPE_WEBHOOK_SECRET
   # optional vars, defaults shown:
   #   MARKET_FEE_BPS    1000  = 10.00%  (basis points, bounded 0–5000)
   #   MARKET_HOLD_DAYS  7               (bounded 0–90)
   ```
   `STRIPE_SECRET_KEY` is already set if Part A/B are live. The restricted key needs
   **Checkout Sessions** (write) and **Transfers** (write) on top of Part B's permissions.
3. **Stripe webhook.** Add `checkout.session.completed`, `charge.refunded` and
   `charge.dispute.created`. Any of `/api/market/webhook`, `/api/shop/webhook` or
   `/api/cashout/webhook` fulfils a Bazaar sale — whichever URL is already registered works.
4. **Deploy.** ⚠ **The version knobs were NOT bumped on this branch** — currently all three
   sit at `v120w6`. Bump `public/version.txt`, `window.BUILD_VERSION` (index.html ~L36444)
   and `CACHE_VERSION` in `public/sw.js` (~L414) **together**, or the update check breaks.
   Verify the EDGE with curl, never the deploy log, and poll — PoP propagation takes a couple
   of minutes.
5. **Test-mode pass** (see "Never verified" below) — do this before step 6.
6. **Withdrawals.** `npx wrangler secret put CASHOUT_PAYOUTS_ENABLED` → `true`. Until then
   `/api/market/payout` returns 501 and balances simply accrue. **Keep this last.**

⚠ `MARKET_FEE_BPS` (what the Worker charges) and `rm_config.fee_bps` (what the UI quotes a
seller *before* they list) are two copies of one number. **Change both together** or sellers
see a fee they are not charged. The fee is recomputed from the amount Stripe actually settled
and stored on the order row, so changing it later never rewrites what a past seller was owed.

---

## VERIFIED ANCHORS

| What | Where |
|---|---|
| Migration | `sql/038_real_money_market.sql` (623 lines, 6 tables, 10 RPCs) |
| Worker module | `worker.js` L840–1160 — `handleMarket()` @ L963 |
| Fee maths | `_rmFeeCents()` @ worker.js L902 · `MARKET_FEE_BPS_DEFAULT` @ L887 |
| Fulfilment | `_rmFulfillSession()` @ L941 · event router `_rmHandleEvent()` @ L1143 |
| Router entry | `worker.js` — `/api/market/` block, just above `/api/shop/` |
| Webhook fan-in | `_rmHandleEvent` called from cashout (L219) and shop (L733) webhooks too |
| Front-end module | `public/src/market/` — `index.js` publishes `window.MythicBazaar` |
| Script tag | `public/index.html` L223139 (`?v=v121bz1`) |
| Hub tile | `public/index.html` L114716 (`btn-bazaar`, null ⇒ hidden) |
| Bridge accessors | `public/index.html` L206964–207040 (`token`, `bazaar*`) |
| Console shorthand | `__bz.debug()` (like `__mc`) |

**Tables:** `rm_listings` · `rm_orders` · `rm_earnings` (append-only ledger) · `rm_payouts` ·
`rm_claims` · `rm_config`.

**Player RPCs** (granted to `authenticated`): `rm_list` `rm_cancel` `rm_browse` `rm_balance`
`rm_payout_open` `rm_claim` `rm_unclaimed`.

🔴 **Service-key-only RPCs, deliberately UNGRANTED:** `rm_record_order` `rm_payout_settle`
`rm_refund_order`. Granting these to `authenticated` would let any signed-in player mint
themselves earnings for a sale that never happened. **Do not "fix" the missing grants.**

---

## SECURITY INVARIANTS (do not regress these)

- **Price authority is the Worker.** The browser sends a listing id and nothing else that
  touches money. The price is read from `rm_listings` with the service key; the fee is
  computed server-side from the amount Stripe actually settled, not from checkout metadata.
- **Payout amounts are authorised by the database.** `rm_payout_open()` takes an advisory
  lock, re-reads the available balance, and writes the payout row **and** its negative ledger
  row in one transaction — so the balance drops before the Worker ever talks to Stripe, and a
  concurrent second withdrawal sees the reduced balance and is refused. The debit is
  deliberately *not* written after the transfer succeeds; that shape loses the race.
- **`rm_earnings` is append-only.** Balance = `sum(amount_cents)`. A failed payout is returned
  with a compensating positive row, never by deleting the debit. A refund is a negative row.
- **No client write policy** on `rm_orders` / `rm_earnings` / `rm_payouts` / `rm_listings`.
  Absent policy = denied. `rm_listings` deliberately does NOT copy `card_market_listings`'
  `using (status='open') with check (true)` UPDATE policy — that policy lets any authenticated
  user rewrite any open listing including its price and seller_id (see below).
- **Fulfilment is idempotent twice over:** early return on the session id, plus a caught
  `unique_violation` for the case where the webhook and the buyer's return are both inside
  `rm_record_order()` before either has inserted.
- **Transfers carry an `Idempotency-Key`** keyed on the payout id, so a retry after a lost
  response replays the original transfer instead of sending money twice.
- **The Bazaar bridge has no Cinder or Aza accessor** and must never get one. A real-money
  screen must not also be a door into the soft economy.

---

## WHY THE CONNECT BUTTON IS DUPLICATED IN THE BAZAAR

The Cashout Vault is gated behind a **Lv 15 hero or owning a node**
(`CASHOUT_UNLOCK_HERO_LEVEL`, index.html L65288) and bounces anyone else (L164527). It was the
only place to connect a Stripe account — so a seller with neither could earn real money on the
Bazaar with **no reachable way to connect an account to be paid into**.

The Earnings tab now carries its own Connect button and the Sell tab prompts before listing.
Both call the **same** `POST /api/cashout/connect`. **If you ever move the Vault's gate, this
button stays independent of it.**

Stripe returns to the shared `/?cashout=return`; the Bazaar reopens itself only when *it*
started the flow (a `sessionStorage` marker `bz_connecting`), so a Vault-initiated onboarding
still returns to the Vault. The return leg re-reads `payouts_enabled` from Stripe rather than
assuming success — verification is usually still pending at that moment.

Listing and selling do **not** require a connected account. Earnings accrue either way; the
account is only needed to withdraw.

---

## 🔴 NEVER VERIFIED — the highest-value next step

Nothing here has touched real Stripe or a real Supabase. This environment has no Stripe
credentials and the migration is unapplied, so **everything below is unproven**:

- End-to-end purchase in **test mode** (`4242 4242 4242 4242`, any future expiry/CVC).
  Confirm the seller is credited **exactly once** with the webhook *and* the buyer's return
  both firing.
- The buyer's **collect** step (`rm_claim`) actually delivering the item, and refusing a
  second claim.
- **Cancel** returning the original card id to the seller (it calls `bazaarRestore`, not
  `bazaarGrant` — grant mints a *new* id, which is right for a buyer and wrong for a cancel).
- A **refund** in the Stripe dashboard producing the negative `rm_earnings` row.
- A **payout** in test mode, including the failure path returning the money.
- The migration's verify block on the real database.

What *was* checked: `node --check worker.js`, `node _synckcheck.mjs` (ALL CLEAN), every ES
module parses, every bridged symbol resolves to exactly one definition in index.html, SQL
structure balanced (20 `$$`, one begin/commit, 10 functions).

Two bugs were caught in self-review and fixed: a fulfilment race where the webhook and the
buyer's return could both insert the same order, and a dispute handler matching on a charge id
that would have silently reversed nothing.

---

## OPERATOR OBLIGATIONS (not code, and not deferrable)

- **Holding other people's money is regulated** in most jurisdictions. The escrow window means
  we custody seller funds. Get advice before launch.
- **Tax reporting.** Paying sellers real money creates 1099-K/equivalent obligations past
  thresholds. Stripe Connect can file these — turn it on.
- Fund the platform Stripe balance; understand Connect fees and negative-balance liability.
- Watch disputes actively while the hold window is the main defence.
- Keep withdrawals behind manual review at launch.

---

## ADJACENT BUG FOUND, NOT FIXED (out of scope, worth a session)

`card_market_listings` (the **Cinder** card market, `card_market_listings.sql`) still carries:

```sql
create policy cml_upd on public.card_market_listings for update to authenticated
  using (status = 'open' or seller_id = auth.uid()) with check (true);
```

`using (status='open')` + `with check (true)` lets **any authenticated user rewrite any open
listing** — its price, its card, even its `seller_id`. This is the identical hole that
`sql/019` fixed for `resource_listings`; the card market never got the same treatment. It is
pre-existing and unrelated to the Bazaar (which is why I left it alone), but it is a live
write hole on the Cinder economy. `sql/019` §4 is the template for the fix.

---

## OUT OF SCOPE / DO NOT DO

- **Do not grant** `rm_record_order` / `rm_payout_settle` / `rm_refund_order` to
  `authenticated`.
- **Do not build a second Stripe onboarding flow.** One `cashout_accounts` row per player.
- **Do not raise the listing caps** without server-authoritative inventory first.
- **Do not add a Cinder or Aza accessor** to the Bazaar bridge.
- Standing CLAUDE.md rules still apply: no image/video upload, no Discord integration.
