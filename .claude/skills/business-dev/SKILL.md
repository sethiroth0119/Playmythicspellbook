---
name: business-dev
description: Work on the business and economy systems — Corp operations and _opEcon pricing, Just Business (public/corp), Bank of Ethos and wallets, player bank charters, Foundation Reserve tax, resources and trading lots, card/black markets, Prince Portfolios dealership, Garage and Aza store (Stripe via worker.js), Territory Wars economy. Use for new businesses, pricing changes, ledgers, payouts, and economy bugs.
---

# Business & economy work

The economy has one non-negotiable shape: **balances are derived, never stored.** Ledgers
are append-only (`corp_treasury`, wallet ledgers, `reserve_tax_log`); balance =
`sum(amount)`. Client-side Cinder is `Profile.gems` and only `spendGems()/addGems()` may
move it (they tax, log and toast). Real money is decided by `worker.js`, not the client.

## Orient
```
node tools/gamedev/econ.mjs ops            # every Corp operation priced live (_opEcon + overrides)
node tools/gamedev/econ.mjs tax 1000,1e6   # Foundation Reserve quote
node tools/gamedev/econ.mjs resources      # resource ids, caps, Cinder values
node tools/gamedev/econ.mjs parity         # client GARAGE_RIGS / SOVEREIGN_PACKAGES vs worker.js
node tools/gamedev/catalog.mjs ops|laws|licenses|packs|houses|zones|twnodes|aicorps
node tools/gamedev/map.mjs where _boeTransfer      # or Corp, BankEthos, Wallet, RealtyMarket, Market…
node tools/gamedev/audit.mjs --rule cinder         # direct Profile.gems writes (75 legacy sites — do not add one)
```

## Where each business lives (names to grep; lines move)
- **Corp operations** — `OPS_ECON` (base numbers), `_opEcon(t)` (merged with admin
  overrides), `_opComputed(o)` (terroir), `Operations`, `_jbLocalOpsList` (personally
  funded ops on the profile), `CORP_LAWS`, `CITY_LICENSES`, `NODE_REQUIRED_LICENSE`.
  New op = new `OPS_ECON` row + `OP_LABELS` entry + unlock rule; **never a literal price
  at the call site**.
- **Just Business** — `public/corp/*.jsx` (React + Babel iframe; `_jsxcheck.js` validates),
  bridge `public/corp/_jbridge.js` (`JB_action`, `jbdata` event), host `_jbEcon`,
  `_jbSendData`, `_jbHandleAction`. Standalone mock when no parent.
- **Bank of Ethos** — `BankEthos`, `_boeAdjust`, `_boeTransfer(Aza)`, `_boeSettleRpc`,
  `BOE_FEE`, `AZA_TO_CINDER`. Server RPCs `boe_*_settle`, `boe_loan_disburse`.
  Missing tables → `_boeMissingTbl` honest empty state.
- **Wallets** — `Wallet`, `walletReconcile`, `_walletOutbox` (offline queue), RPCs
  `wallet_credit/charge`; wallet columns are LOCKED (sql/026) — only the RPCs write.
- **Player banks / charters** — `BankDir`, `BankStaff`, `BKC_TIERS`, `bkc*`, `udw*`,
  RPC `bank_open_charter`, `bank_directory`.
- **Foundation Reserve** — `frApplyTax(gross, opts)` → `frTaxQuote` + `frLogTax`;
  `frLogCivic` for fines/bail/licenses. Exposed to the city iframe as `window.FoundationReserve`.
- **Resources & trading** — `RESOURCES`, `getRes/addRes/spendResources/_refundRes`,
  `public/src/trading/` (`MythicTradeBridge`, every mutator returns a boolean — check it),
  RPCs `rl_*` (sql/019).
- **Markets** — `Market`, `CardMarket`, `BmMarket`, `ResMarket`, `CardShop`, `Dojo`,
  `cardShopMarketPrice`.
- **Prince Portfolios** (cars) — `PP_*`, `PPA_*`; fully local; unlocked by the `cars` op.
- **Garage / Aza store / cashout** — client `GARAGE_RIGS`, `SOVEREIGN_PACKAGES`,
  `CASHOUT_TIERS` are DISPLAY copies; `worker.js` (`/api/garage`, `/api/buy`,
  `/api/cashout`) is authority. Change both, then `econ.mjs parity`. Stripe unset → mock.
- **Territory Wars** — `TW_*`, `tw_*`, `tw_regionControlPct(regionId, corpId)`.

## Rules of the road
1. New Supabase table or RPC → `/db-migration` (RLS in the same file, `sql-lint.mjs`).
2. Every remote call degrades offline: mock or empty, never a throw the UI cannot survive.
3. A payout is an INSERT into a ledger, not an UPDATE of a total.
4. Anything a player can spam (claim, collect, settle) needs an idempotency key or a
   server-side RPC that is itself idempotent (see `wallet_credit` sql/035).
5. User-facing failure → `showToast()`; confirmation → `await gcConfirm()`.
6. Gate: `node tools/gamedev/check.mjs` (runs `econ.mjs --check`, `audit.mjs`, `sql-lint.mjs`).
