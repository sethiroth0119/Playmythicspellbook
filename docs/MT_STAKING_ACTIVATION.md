# MT Staking — activation sequence (for the owner wallet)

**I cannot run these.** They are on-chain transactions that move real assets, so
they have to be signed from your wallet. Everything below is prepared for you to
review and execute; the read-only checks I *did* run are recorded as evidence.

---

## Verified live state (read-only `cast call`, Base mainnet)

Contract `0x89c537E8e91f48342cf2673335f60bc35c979685`

| call | result | meaning |
|---|---|---|
| `owner()` | `0xd55D1c1777f7F51CbDdD341CF6Af779006755ac8` | sign from **this** wallet |
| `stakingToken()` | `0x2915FdB0f04c4452c60a1B7f5174004513196c76` | the real MT |
| `rewardPool()` | **0** | nothing is credited yet |
| `untrackedBalance()` | **750000000000000000000000** (750,000 MT) | the transfer landed but was never booked |
| `tierCount()` | **0** | no tiers exist |

So the contract is funded, uncredited, and unconfigured. **Every stake reverts
today** — both because `rewardPool` is 0 and because there are no tiers.

> Do **not** set `CBK_STAKING_ADDRESS` on the site until `rewardPool()` is
> non-zero and `tierCount()` is 4, or players get a Stake screen that always
> fails.

---

## 🔴 One correction before you start

An older note ends with *"then `approve(staking, 750000e18)`, then
`fundRewards(750000e18)`"*. **Do not do that.** That was the plan from before the
tokens were already sitting in the contract.

`sweepUntracked()` credits the 750,000 that is **already there**. Running
`approve` + `fundRewards` afterwards would pull a **second** 750,000 MT out of
the treasury wallet. Use one path or the other — and since the tokens have
already arrived, the path is `sweepUntracked()`.

---

## The sequence — 5 transactions, in this order

Set up a shell first (Foundry is not on PATH):

```bash
export PATH="H:/aiTcgbattler/tools/foundry:$PATH"
S=0x89c537E8e91f48342cf2673335f60bc35c979685
R=https://mainnet.base.org
```

### 1. Credit the 750,000 that is already in the contract

```bash
cast send $S "sweepUntracked()" --rpc-url $R --interactive
```

Then confirm before going further:

```bash
cast call $S "rewardPool()(uint256)" --rpc-url $R          # expect 750000...000
cast call $S "untrackedBalance()(uint256)" --rpc-url $R    # expect 0
```

### 2–5. Add the four tiers

Values are from the mainnet rehearsal that passed on an anvil fork of Base with
exact arithmetic — do not retype them from memory.

```bash
# 30 days, 8%
cast send $S "addTier(uint256,uint256,uint256)" 2592000 800 0 --rpc-url $R --interactive

# 90 days, 16%
cast send $S "addTier(uint256,uint256,uint256)" 7776000 1600 0 --rpc-url $R --interactive

# 180 days, 28.5%, cap 300,000 MT
cast send $S "addTier(uint256,uint256,uint256)" 15552000 2850 300000000000000000000000 --rpc-url $R --interactive

# 365 days, 47.5%, cap 262,500 MT
cast send $S "addTier(uint256,uint256,uint256)" 31536000 4750 262500000000000000000000 --rpc-url $R --interactive
```

`--interactive` prompts for the key rather than putting it in a shell command,
where it would land in your history.

⚠ Confirm the `addTier` argument order against the deployed ABI before sending
the first one. The rehearsal used `(lockDuration, aprBps, rewardCap)`; if the
verified source on Blockscout orders them differently, the numbers above are
still right but their positions are not.

---

## Post-checks

```bash
cast call $S "tierCount()(uint256)" --rpc-url $R      # expect 4
cast call $S "rewardPool()(uint256)" --rpc-url $R     # expect 750000000000000000000000
```

Only once both read correctly, wire the site: the swap-in points are the
`cinder_lock_mt` / `cinder_release_mt` call sites in market-deploy's backing
modal, and `scripts/staking.ts` already has the thirdweb v5 bindings.

---

## Two facts worth keeping in view

- **MT has no market price.** No liquidity pool exists (DexScreener `pairs: null`,
  GeckoTerminal `price_usd: null`), so any USD figure shown next to a stake would
  be invented.
- **MT can never have a transfer tax added.** It is not upgradeable (EIP-1967
  slot zero) and has no fee functions. Changing that would need a new token and a
  holder migration.

## Re-funding

The 750,000 is the **year-one tranche**. Budget is 15% of supply over two years,
so a second 750,000 tranche is due at **month 12** — that one *does* use
`approve` + `fundRewards`, because those tokens will not already be in the
contract.
