# 💵 Switching on the Bazaar — operator runbook

Six steps to take player-to-player real-money sales from written to live.

Each step is safe on its own. The Bazaar stays **hidden from players** until they are all
done, and **withdrawals stay off** until you deliberately turn them on last.

> Developer-facing notes are in `BAZAAR_HANDOFF.md`. Full setup reference is `STRIPE.md`
> Part C. This file is the "do it" list.

---

## Before you start

⚠ The code is on branch `claude/stripe-player-payouts-fd2csw` and is **not merged into
`main`** (and `main` has moved on since). Merge it before step 4, or deploy from the branch
knowingly.

Steps 1–3 change nothing players can see, so they are safe to do now and finish later.
**The point of no return is step 6.**

---

## 1. Create the tables

**Where:** Supabase → SQL Editor → project `ktsiasyjusesawtrwrjc`

Paste the whole of `sql/038_real_money_market.sql` into a new query and run it. It is
idempotent, so re-running it is always safe.

It creates six tables — listings, orders, an append-only earnings ledger, payouts, claims
and a tuning row — with their row-level security and the functions that move money.

**Verify:** the script ends with a verify block. **Every row must read `ok`.** If
`no client write policy on money tables` or `service-only RPCs not granted to players`
says anything else, stop and re-run — those two are the security boundary.

---

## 2. Widen the Stripe key and add the webhook

**Where:** Stripe Dashboard → Developers

Your existing restricted key needs two more permissions on top of what Parts A and B
already gave it:

- **Checkout Sessions** — write
- **Transfers** — write

Then add a webhook endpoint pointing at the Bazaar, subscribed to three events. The refund
and dispute events are what reverse a seller's credit — without them a chargeback takes
money from you and leaves the seller's balance untouched.

```
# endpoint URL
https://playmythicspellbook.com/api/market/webhook

# events to subscribe
checkout.session.completed
charge.refunded
charge.dispute.created
```

Copy the signing secret it gives you — the `whsec_…` value. You need it in step 3.

**Verify:** Stripe shows the endpoint as enabled with 3 events. Do this in **test mode**
first; you will repeat it in live mode when you are ready.

---

## 3. Set the Worker secrets

**Where:** your terminal, in the repo

`SB_SERVICE` is the one that matters: it is how the Worker reads a listing's real price and
records a sale. Without it the Bazaar reports itself unready and hides. Find it in
**Supabase → Project Settings → API → service_role**.

```sh
npx wrangler secret put SB_SERVICE
npx wrangler secret put STRIPE_WEBHOOK_SECRET
```

The fee and the hold window are optional plain vars. Defaults are 10% and 7 days, so skip
these unless you want different numbers:

```
MARKET_FEE_BPS    1000 = 10.00%   (basis points, 0–5000)
MARKET_HOLD_DAYS  7               (0–90)
```

### 🔴 The fee lives in two places

`MARKET_FEE_BPS` is what the Worker charges. `rm_config.fee_bps` is what the game quotes a
seller *before* they list. **Change both or sellers see a fee they are not charged.** To
retune later, run this alongside the secret:

```sql
update public.rm_config set fee_bps = 1000, hold_days = 7 where id = 1;
```

**Verify:** secrets take effect on the next request — no redeploy needed. You confirm them
at the edge in step 4.

---

## 4. Bump the version and deploy

**Where:** your terminal, in the repo

Three version knobs move together or the update check breaks for everyone. All three
currently sit at `v120w6` — this branch deliberately did not bump them, because bumping on
an undeployed branch just creates drift.

- `public/version.txt`
- `window.BUILD_VERSION` — `public/index.html`, around line 36444
- `CACHE_VERSION` — `public/sw.js`, around line 414

```sh
npm run deploy
```

**Verify:** check the **edge, never the deploy log** — the log can say "no updated asset
files" on a successful deploy. Poll for a couple of minutes; propagation across points of
presence is not instant.

```sh
curl -s https://playmythicspellbook.com/api/market/config

# want: {"enabled":true,"ready":true,"webhook":true,
#        "feeBps":1000,"holdDays":7,"payoutsEnabled":false}
```

`ready:false` means `SB_SERVICE` did not land. `payoutsEnabled:false` is correct at this
stage — that is step 6.

---

## 5. Buy something from yourself, in test mode

**Where:** the live game, two accounts

None of this has ever run against real Stripe. This step is the whole safety net, and it
needs two accounts because a seller is blocked from buying their own listing.

Use Stripe's test card `4242 4242 4242 4242`, any future expiry, any CVC. Then confirm all
five:

- [ ] The seller lists a card — and it **leaves their collection** immediately.
- [ ] The buyer pays and lands back in the game; the purchase shows as waiting to collect.
- [ ] **Collect delivers the item once** and refuses a second attempt.
- [ ] The seller's Earnings shows the sale minus the fee, sitting **on hold**, not available.
- [ ] Refund the payment in the Stripe dashboard → the seller's balance drops by their share.

Also worth forcing: cancel a listing and confirm the card comes back. Cancel restores the
original card; the buy path mints a new one. They are different code paths and only one of
them has ever been reasoned about twice.

**Verify:** the seller is credited **exactly once** even though both the webhook and the
buyer's return fire for the same sale. If you see a double credit, stop — that is the one
bug that costs real money.

---

## 6. Let sellers withdraw

**Where:** your terminal — do this last

Until this is set, `/api/market/payout` returns 501 and balances simply accrue. Sellers can
list, sell and earn the whole time; they just cannot take money out yet. That is a perfectly
good state to launch in.

```sh
npx wrangler secret put CASHOUT_PAYOUTS_ENABLED
# value: true
```

Before you do: fund the platform Stripe balance, and understand that a transfer out is money
you have already collected but may still owe back if a dispute lands.

**Verify:** `/api/market/config` now returns `payoutsEnabled:true`. Run one small real
withdrawal end to end before telling players it works.

---

# How a player connects their Stripe account

Nothing for you to configure — this is what a seller sees once the steps above are done.
Worth walking yourself once so you can answer questions about it.

1. **The Bazaar** tile appears on the main hub, next to Communities.
2. On **Earnings** (or **Sell**, before listing) they get **Connect Stripe account**.
3. They land on **Stripe's own onboarding** and enter identity and bank details there. The
   game never sees them — it stores only a connected-account id.
4. Stripe returns them to the game, back on the Earnings tab. Verification is often still
   pending at that moment, so the page re-checks with Stripe rather than claiming success.
5. Once Stripe enables payouts on their account, **Withdraw** appears for anything past its
   hold window.

A player can list and sell **before** connecting anything — earnings accrue either way. The
account is only needed to withdraw.

This is the same connected account as the Cashout Vault, deliberately. One player, one
Stripe account, one row. The button is duplicated into the Bazaar only because the Vault is
gated behind a Lv 15 hero or owning a node — a seller with neither would otherwise have no
way to get paid.

---

# Things that will cost you money

Each of these looks like a reasonable change and is not. They are written into the code
comments too, but this is the short list.

- ❌ **Do not grant `rm_record_order`, `rm_payout_settle` or `rm_refund_order` to players.**
  The missing grants look like an oversight. They are the thing stopping a signed-in player
  minting themselves earnings for a sale that never happened.
- ❌ **Do not raise the listing caps** to make the Bazaar feel busier. Ten open listings per
  seller and the $2–$500 price band are a fraud budget, not a UX knob — see below.
- ❌ **Do not shorten the hold window to zero.** It is the only period in which a chargeback
  can be answered by reversing a ledger row instead of chasing a bank account.
- ❌ **Do not build a second Stripe onboarding flow.** Two account maps for one player is how
  a payout reaches the wrong Stripe account.

### 🔴 The reason the caps exist

The game has **no server-authoritative item inventory**. Cards live in the player's profile,
and the existing Cinder card market never verified that a seller owned what they listed.
That is survivable at Cinder prices; at dollar prices a modified client can sell something
that does not exist and the chargeback lands on you.

The caps, the price bounds and the hold window are what stand in for ownership. The real fix
is to move card ownership into a server table so a listing can delete the row that proves it
— treat that as the prerequisite for opening this up to volume.

---

# Not code, and not deferrable

Four obligations that come with paying people real money. None of them are things the build
can do for you.

- → **You are holding other people's money.** The hold window means you custody seller funds
  between the sale and the withdrawal, which is regulated in most jurisdictions. Get advice
  before launch.
- → **Tax reporting.** Paying sellers creates 1099-K or equivalent obligations past
  thresholds. Stripe Connect can file these — turn it on rather than discovering it in
  January.
- → **You are the merchant of record.** Buyers see your name on their statement and disputes
  come to you, not the seller. That is the accepted cost of the hold window.
- → **Watch disputes actively** while the hold window is the main defence, and keep
  withdrawals behind manual review at launch.

---

# Where everything lives

| What | Where |
|---|---|
| Migration | `sql/038_real_money_market.sql` |
| Server endpoints | `worker.js` — `handleMarket()`, ~L963 |
| Fee maths | `worker.js` — `_rmFeeCents()`, ~L902 |
| Sale fulfilment | `worker.js` — `_rmFulfillSession()`, ~L941 |
| Bazaar screen | `public/src/market/` |
| Hub tile | `public/index.html`, ~L114716 |
| Console debug | `__bz.debug()` in the browser console |
| Full setup notes | `STRIPE.md` Part C |
| Developer handoff | `BAZAAR_HANDOFF.md` |

---

Branch `claude/stripe-player-payouts-fd2csw` · not merged, not deployed.
