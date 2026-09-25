# 🚚 Storage Warehouse — Handoff

Everything needed to drop the player-owned storage warehouse into the game, by
someone who has never seen this work. Written to be pasted, not interpreted.

**Branch:** `claude/warehouse-storage-minigame-w4dx4l`

**What it is.** Other live players rent a numbered **bay** in your **warehouse**
and ship resources to it out of their **city, house or camp**. Delivery takes
**up to 72 hours based on the node level** of where it was sent from; **free
cities always take 72 hours**. A step van pulls up at your warehouse; you walk
out first-person, press **E** at the open kerb-side door, carry one crate at a
time under a real **weight limit**, and drop it in the renter's bay. A full bay
raises **"You need to open storage unit space"** — buy more for **10 Aza or
5,000,000 Cinder**. Bigger **weight lifters** let owners or workers carry more.

---

## 1 · Files

| File | Status | What it is |
|---|---|---|
| `supabase/migrations/20260812000000_warehouse_storage.sql` | **new** | All server state + RPCs. Idempotent. |
| `public/warehouse/index.html` | **new** | The first-person yard. Standalone-playable. |
| `public/warehouse/truck.js` | **new** | The procedural step van. No assets fetched. |
| `public/index.html` | **edited, 4 targeted insertions** | Module + the three entry points. |

Nothing else is touched. No existing function is rewritten.

---

## 2 · SQL — run in this order

Run in the Supabase SQL editor (or `supabase db push`). Every file is
idempotent and safe to re-run.

1. `bulletproof_saves.sql` — **prerequisite.** Provides `public.user_progress`
   (`cinder`, `sovereigns`) and `public.wallet_ledger`. Every purchase here
   charges that row inside the same transaction as the grant. If this is not
   applied, every warehouse RPC that spends will fail.
2. `supabase/migrations/20260614020000_tw_node_owners.sql` — prerequisite.
   Node ownership. A node with **no row here is a FREE CITY** → always 72 h.
3. `supabase/migrations/20260616030000_tw_node_upgrades.sql` — prerequisite.
   `garrison` / `refinery` / `civic` on `tw_node_recon`, which is what the
   delivery level is derived from.
4. **`supabase/migrations/20260812000000_warehouse_storage.sql`** — this feature.

Optional but recommended, because `wh_player_at_node()` consults them to prove a
sender really is attached to the node they claim to ship from:
`20260614000000_tw_camp_registrations.sql`, `20260617210000_tw_node_residency.sql`,
`city_state.sql`. Each lookup is individually wrapped, so a missing table simply
does not contribute — it never errors.

### Verify it landed
```sql
select public.wh_config() -> 'crate_kg';                -- 22
select public.wh_node_level('some-unclaimed-node');     -- 0  (free city)
select public.wh_eta_hours(0), public.wh_eta_hours(10); -- 72, 6
```

---

## 3 · Client — four insertions in `public/index.html`

⚠ **TWO of the seven anchors below return 0 from a literal search of a branch
that already has the insertion, and for the same reason: the last line of the
anchor is what the insertion displaces.** Counted, on this branch:

| anchor | literal matches | search for instead |
|---|---|---|
| §3.1 `// Run a real economy action posted by the app.` | 1 | — |
| §3.2 `bankRow: { label: 'Bank Row', …` | 1 | — |
| §3.3A Objectives block ending `…</span> / </div> / </div> / </aside>` | **0** | its first two lines, up to the first `</div>` |
| §3.3B `const _crBtn = …'btn-camp-resistance-ring'…` | 1 | — |
| §3.4 city `x.onclick = _closeNodeCity; / document.body.appendChild(x); / }` | **0** | `x.onclick = _closeNodeCity;` alone |
| §3.4 house `${residencyPanel ? …}` | 1 | — |
| §3.4 house `root.querySelectorAll('.re-tab')…` | 1 | — |

This document previously flagged only the city one and said "the other six match
exactly once", which was wrong about §3.3A in exactly the way it was right about
§3.4 — the same displacement, unflagged. Search for the anchor, then insert
exactly where stated.

### 3.1 The module

**Anchor (insert IMMEDIATELY BEFORE this line):**
```js
// Run a real economy action posted by the app.
```
That line sits just after `_dwellingClose()` ends. The warehouse module is the
direct sibling of the Dwelling module and belongs there.

**Paste:** the entire contents of **`WAREHOUSE_PASTE_index-module.js`** (repo
root, below its header comment). That file is this module, extracted verbatim so
nobody has to go fishing inside a 215,000-line file. It is loaded by nothing and
lives outside `./public`, so it never deploys.

> **Do not trust that file until you have run `node _wh_paste_check.mjs`.**
> It byte-compares the file against the module actually live in
> `public/index.html` and names the first line that differs. It exists because
> the file silently went 180 lines stale once — still parsing, still plausible,
> but missing the whole retrieval half, so anyone who pasted it would have
> reinstated a build where resources sent to a warehouse could never be
> withdrawn. **No line count is quoted here on purpose**; a number in prose is
> exactly what went stale. The check is the source of truth.

The block runs from
`// ═══…\n// 🚚 STORAGE WAREHOUSE — player-owned warehouses, rented bays, …`
down to and including its closing `window.__mg.warehouse = { … }` registration —
take both ends from the paste file itself rather than from this document.

For the same reason there is no function inventory here: it drifted too. To see
what the module defines, run:

```
grep -n "^\(function\|const\|async function\) _wh\|^const WH_" WAREHOUSE_PASTE_index-module.js
```

### 3.2 Camp Heights destination

**Anchor:**
```js
  bankRow:          { label: 'Bank Row',               icon: '🏦', go: () => { setTimeout(() => { try { _campOpenBankDirectory(); } catch (e) {} }, 50); } },
```
**Insert directly after it, inside `CAMP_ROUTE_OPTIONS`:**
```js
  // 🚚 Storage Warehouse — walks the player into their own yard, first-person.
  // Same in-world posture as the Real Estate Office: the camp stays behind it.
  warehouse:        { label: 'Storage Warehouse',      icon: '🚚', go: () => { setTimeout(() => { try { _whOpen(); } catch (e) {} }, 50); } },
```

### 3.3 The CAMP screen panel + its binding

**Anchor A** (end of the Objectives panel inside `renderCamp()`'s `root.innerHTML`)
— ⚠ this is one of the two that will not match literally once inserted; search
for its first two lines only:
```html
        <br><span class="ink-dim">Only units you own are listed. You must always keep at least <strong>${CAMP_MIN_COLLECTION}</strong> cards available — you have <strong>${_totalOwnedCards()}</strong> owned · <strong>${Camp.slots.length}</strong> parked.</span>
      </div>
      </div>
        </aside>
```
Insert the `<!-- 🚚 PLAYER STORAGE … -->` `.cbx-panel` block between the second
`</div>` and `</aside>` (copy it verbatim from this branch).

**Anchor B** (handler binding, further down in `renderCamp()`):
```js
  const _crBtn = document.getElementById('btn-camp-resistance-ring');
```
**Insert directly before it:**
```js
  // 🚚 Player Storage panel — the send button's label depends on whether this
  // player already rents a bay, so refresh the cache and repaint in place.
  try {
    _whBindSendButtons(root);
    _whRefreshButtons(root);
    const _whBtn = document.getElementById('camp-wh-open');
    if (_whBtn) _whBtn.onclick = () => { try { _whOpen(); } catch (e) {} };
  } catch (e) {}
```

### 3.4 The CITY overlay pill and the HOUSE panel

**City — anchor** (in `_openNodeCity`):
```js
  x.onclick = _closeNodeCity;
  document.body.appendChild(x);
}
```
Insert the `node-city-storage` pill block before the closing `}`. In
`_closeNodeCity`, after the `node-city-close` removal, add:
```js
  const wx = document.getElementById('node-city-storage');
  if (wx) { try { wx.remove(); } catch (e) {} }
```

**House — anchor** (in `_campOpenRealEstate`'s `officeBody`):
```js
      ${residencyPanel ? `<div style="border-top:1px solid rgba(212,175,55,0.2)">${residencyPanel}</div>` : ''}
```
Insert the `🚚 Player Storage` block for owned properties after it, and add
`try { _whBindSendButtons(root); _whRefreshButtons(root); } catch (e) {}`
immediately before:
```js
  root.querySelectorAll('.re-tab').forEach(b => b.onclick = () => _campOpenRealEstate(b.dataset.tab));
```

---

## 4 · The bridge

`public/warehouse/index.html` runs in an iframe and owns no credentials. One
generic envelope, `postMessage`, same-origin:

| Direction | Message |
|---|---|
| child → parent | `{ type:'wh:ready' }` |
| parent → child | `{ type:'wh:state', state, wallet, me }` |
| child → parent | `{ type:'wh:rpc', reqId, fn, args }` |
| parent → child | `{ type:'wh:rpcResult', reqId, ok, data, error }` |
| child → parent | `{ type:'wh:exit' }` |

`fn` is checked against `WH_RPC_ALLOW` **before** anything happens; an unlisted
name gets `ok:false, error:'blocked'`. Any RPC that returns a `wallet` mirrors
the fresh balances back into `Profile.gems` / `Profile.sovereigns` so the rest of
the game agrees with the server.

**Opened with no parent, the page falls into MOCK mode** and is fully playable —
that is how it is tested. `MOCK.CFG` must mirror `wh_config()` exactly; when it
drifted, the standalone yard became unplayable while production was fine.

---

## 5 · Every tunable, and where it lives

All of it is in **one** place: `public.wh_config()` at the top of the migration.
The client reads it and never keeps its own copy (except `MOCK`, which must be
kept in sync by hand).

| Constant | Value | Note |
|---|---|---|
| `aza_to_cinder` | 5000 | The GAME-WIDE peg (1 Aza = $1 = 5,000 Cinder), mirroring `AZA_TO_CINDER` in index.html. ⚠ **The warehouse's own prices are NOT derived from it.** |
| `start_units` | 2 | A new warehouse starts small |
| `unit_price_aza` / `unit_price_cinder` | 10 / **5,000,000** | $10 of Aza; the Cinder price is a separate grind price, NOT a match |
| `unit_capacity_kg` | 500 | Per bay |
| `crate_kg` | **22** | ⚠ must stay ≤ tier-0 lifter capacity |
| `max_shipment_kg` | **1800** | Sized to a tier-1 renter's real 1,932 kg ceiling. Bigger loads are refused, never truncated — and `wh_send_shipment` also checks the actual destination. |
| `rent_cinder_per_day` | **120,000** | Paid to the warehouse owner |
| `rent_max_days` / `rent_grace_days` | 30 / 3 | Grace before goods can be impounded |
| bay expansion ceiling | **4 × `unit_capacity_kg`** (2,000 kg) | `wh_expand_unit` refuses past this with `bay_maxed`; hard-coded in the rpc, not in the config block |
| `free_city_hours` / `max_hours` | 72 / 72 | The ceiling, and the free-city rule |

### ⚠ Cinder and Aza are NOT pegged in this module

Every Cinder price here is **×100** the value it would have at the game's
5,000 Cinder / Aza peg. Every Aza price is unchanged. That is deliberate: Aza is
the real-money price (10 Aza = $10) and Cinder is the grind alternative. The
warehouse's effective internal rate is therefore **500,000 Cinder per Aza**, and
**no UI string may present the two prices as equivalent** — the iframe's
"the same price at the 5,000 Cinder / Aza peg" line was removed for exactly this
reason. `_wh_price_check.mjs` guards the numbers; nothing guards the prose, so
read it when you change a price.

**Reachability of the Cinder path — corrected.** An independent audit found
three of my inputs wrong and one material comparator missing. Everything below
is re-verified against HEAD with its file and line.

| Reference point | Value | Source |
|---|---|---|
| Largest scripted Cinder reward | **50,000** | `_twChosenAwardTrophy`, `index.html:208132` — I previously said 10,000, which was 5× too low |
| Most expensive existing Cinder sink | **1,500,000** | Founder Reserve PRN, `index.html:59587` — I said 1,400,000 |
| Node daily bank accrual | `players×30 + contrib×50 + trade×4 + civ×3 + rebuilt×6 + commerce×2` | `tw_node_cinder_bank`/`tw_node_residency:138` |
| …small node (≈10 players, 5 contributors) | ≈1,700/day | |
| …large node (100 players, 20 contributors) | ≈5,300/day | the formula is **unbounded in registered players** |
| **Days of a node's whole output for ONE 5,000,000 bay** | **≈940 (large) to ≈2,940 (small)** | present as a range; it is highly sensitive to node population |
| Direct Cinder purchase | **5,000,000 Cinder for $1,150** | `index.html:159028` (+15% bonus) |
| Same bay bought with Aza | **10 Aza = $10** | |
| **Real-money spread between the two payment paths** | **115×** | $1,150 vs $10 |

⚠ I also previously cited a "node production LV1→LV10 = 25 → 1,600" ladder as
income. `getCinderProductionByLevel` does exist (`index.html:211239`) and feeds
`node.cinderProductionRate` for display, but the **actual** Cinder a node banks
is the `v_daily` formula above. Quoting the display ladder as income was wrong.

So: the game sells 5,000,000 Cinder for **$1,150**, and sells the same bay for
**$10** of Aza. That is the honest comparator — 115×, more direct and worse than
the Aza-exchange figure I gave before. Grinding it is roughly 2.5–8 years of a
node's entire output. **Aza is effectively the only path.** That may be exactly
the intent at a $10 price point; it is recorded so it is a decision, not a
surprise.

**⚠ THE SEED IS THE LARGEST FAUCET IN THE FEATURE — and it was missing from
this table entirely.** `wh_seed_resources` is one-time PER ACCOUNT, and accounts
are free. A maximal seed is 11 resources × 100,000 = **1,100,000 units ≈
1,650,000 Cinder** at the game's own rates, obtainable by a brand-new signup
with no warehouse, no bay and no prerequisites. Two brakes now exist and both
should be closed once the real migration lands:

```sql
update public.wh_flags set seed_enabled = false;              -- kill it now
update public.wh_flags set seed_cutoff_at = now();            -- or time-box it
```
`seed_cutoff_at` defaults to **90 days** from install. No client can change
either — `wh_flags` is RLS-readable and RLS-unwritable, verified by a real
`authenticated` role update returning 0 rows.

**Warehouse tiers** — tier → max bays / Aza / Cinder:
1 Lean-To Depot 4 / — · 2 Sheet-Metal 8 / 25 / 12,500,000 · 3 Concrete Hub 14 / 60 / 30,000,000 ·
4 Regional Terminal 22 / 140 / 70,000,000 · 5 Ashfall Logistics 32 / 300 / 150,000,000

**Weight lifters** — tier → carry kg / Aza / Cinder:
0 Bare Hands 25 / free · 1 Back Brace 45 / 2 / 1,000,000 · 2 Hand Truck 90 / 5 / 2,500,000 ·
3 Pallet Jack 180 / 12 / 6,000,000 · 4 Forklift 400 / 30 / 15,000,000

**ETA by node level (hours):**

| level | 0 (free) | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 |
|---|---|---|---|---|---|---|---|---|---|---|---|
| hours | **72** | 68 | 62 | 56 | 50 | 44 | 37 | 30 | 22 | 14 | **6** |

72 h is now the free-city rate *and nothing else* — LV1 is 68 h, so "the higher the node, the faster the run" is true across the whole range.

Delivery level is derived server-side as
`1 + garrison + refinery + civic` (each 0–5 on `tw_node_recon`), clamped 1–10 —
**but only if the node has an owner**. No `tw_node_owners` row → level 0 → 72 h.

**Per-resource weight (kg/unit):** food 1.2 · water 2.0 · ammo 0.8 · medicine 0.4 ·
energyDrink 0.5 · supplies 1.5 · metal 3.5 · fuel 3.0 · corruptedEssence 0.6 ·
memoryShards 0.2 · dna 0.1. Ids match `RESOURCES[]`; unknown ids are stripped.

---

## 6 · RPC reference

| Function | Who | Does |
|---|---|---|
| `wh_config()` | anyone | The price list. |
| `wh_my_warehouse(name, node)` | signed in | Get-or-create + full state. |
| `wh_warehouse_json(id)` | owner/renter | Bays, live shipments, crates, lifter, wallet. |
| `wh_directory()` | signed in | Warehouses with a free bay (counts only). |
| `wh_rent_unit(wh, days, name)` | signed in | Charges renter, credits owner, claims a bay. |
| `wh_my_rentals()` | signed in | Drives the button label. |
| `wh_my_shipments()` | signed in | Everything you have on the road — powers the in-transit view and Recall. |
| `wh_send_shipment(unit, kind, node, label, payload, name)` | renter | Weight + ETA computed server-side; splits into crates. |
| `wh_store_crate(crate, unit)` | owner or renter | The unload gate. |
| `wh_buy_unit(currency)` | owner | Adds a NEW empty bay. 10 Aza / 5,000,000 Cinder. |
| `wh_expand_unit(unit, currency)` | owner or that renter, rental must be CURRENT | **Grows an EXISTING bay** by another 500 kg, charged at the same `unit_price_*` as buying a new one (it reads the config key, so a price change follows automatically). This is what the "you need to open storage unit space" modal calls — buying a new bay cannot help a crate addressed to a full one. |
| `wh_upgrade_tier(currency)` | owner | Raises the bay cap **and builds 2 bays**. |
| `wh_buy_lifter(tier, currency)` | anyone | Carry capacity. |
| `wh_withdraw(unit, res, qty)` | renter | Takes goods back out. |
| `wh_cancel_shipment(id)` | sender | Pulls back un-stored crates. |
| `wh_impound_unit(unit)` | owner | After grace: frees a lapsed bay **without deleting anything**. |
| `wh_reclaim(id)` | former renter | Takes impounded goods back. |

`wh_store_crate` refusal reasons the UI handles: `in_transit`, `too_heavy`,
`no_room` (→ raises the purchase modal), `wrong_unit`, `not_allowed`,
`already_stored`, `rental_expired`. `wh_send_shipment` adds `too_large` and
`no_room_at_destination`.

⚠ **There are TWO reason maps and both must be kept complete.** `_whReason` in
`public/index.html` covers the host-side modals; `reasonText` in
`public/warehouse/index.html` covers everything you do standing in the yard, and
it is the one players hit most. **Neither falls back to `r.reason`** — an
unmapped code is a bug in the table, not something to show a player. Add a line
to *both* whenever you add an RPC.

The server currently returns **34** codes. Do not trust that number either —
count it, and diff it against both maps, before claiming coverage:

```sh
grep -o "'reason', '[a-z_]*'" supabase/migrations/*_warehouse_storage.sql \
  | sed "s/.*'reason', '//;s/'//" | sort -u
```

Each map also carries three client-only codes the server never sends —
`blocked`, `rpc_failed`, `timeout` — so a complete map has 37 keys, not 34.

⚠ This document previously said "all 31 server codes", and that claim decayed
the moment three more shipped. `already_seeded` and `seeding_closed` were
missing from both maps; `insufficient_resources` was missing from the yard's,
where it is **the likeliest refusal in the feature** — it is what the resource
ledger returns when it declines a shipment, and it rendered as "Something went
wrong."

---

## 7 · Manual QA checklist

**Server**
- [ ] All four SQL files applied; `select public.wh_config()` returns JSON.
- [ ] **Concurrency:** open two tabs as the same renter and send two large loads
      into two DIFFERENT bays at the same moment. Exactly one should be accepted
      once the combined weight exceeds the free space. (`wh_send_shipment` takes
      `pg_advisory_xact_lock` on sender+warehouse — the capacity sum spans every
      bay the sender holds, so a per-bay row lock is not enough.)
- [ ] A rental past `rent_until` cannot send, store, **or be expanded**.
- [ ] Signed out, `wh_directory()` is **denied** (only `wh_config()` is public).
- [ ] A node with no `tw_node_owners` row gives `wh_node_level` = 0.

**Sending (from a second account)**
- [ ] Camp screen shows **🚚 Player Storage** with **"Buy storage from player"**.
- [ ] Renting a bay flips every such button to **"Send to your storage"**.
- [ ] The send modal states *up to 72 hours based on the node level* **and**
      *Free cities always take 72 hours*.
- [ ] Send from a free city → the notice says **FREE CITY · 72 hours**.
- [ ] Send from a claimed, upgraded node → fewer hours, and it names the level.
- [ ] Naming a node you have no relationship with still gives 72 h.
- [ ] The sent resources leave your salvage ledger immediately.
- [ ] Repeat from a **house** (Real Estate Office) and a **city** (city overlay pill).

**Getting it back out — the other half of the loop**
- [ ] **📦 My storage** (Camp panel, Real Estate Office, or the city overlay)
      lists every bay you rent, broken out per resource, with the weight.
- [ ] It also lists everything **on the road**, with its ETA, and **↩ Recall**
      returns an un-stored load to your ledger.
- [ ] **↩ Withdraw all** credits the resources back into your salvage ledger and
      empties the bay.
- [ ] **🏗 Visit** opens the warehouse your bay is in — a renter can walk it too,
      not just the owner.
- [ ] In the yard, **E on a bay with empty hands** shows what is stored there.
- [ ] With a full bay, the modal's **↩ Send this load back** returns the
      remaining crates and credits the ledger.

**Unloading (as the warehouse owner)**
- [ ] Camp → **🏗 My warehouse** opens the yard; WASD walks, mouse looks,
      clicking locks the pointer, Esc releases, Shift runs.
- [ ] Before the ETA the van is empty and the HUD counts down.
- [ ] After it, **E** at the open door takes a crate; it is visible in your hands.
- [ ] The HUD shows `carried / limit kg`; a crate over the limit is refused and
      names the lifter.
- [ ] **E** at the wrong bay is refused and names the right one.
- [ ] **E** at the right bay stores it; the bay's fill bar and stacked goods grow.
- [ ] Filling a bay raises **"You need to open storage unit space"** offering
      **10 Aza** or **5,000,000 Cinder**; unaffordable options are disabled. The modal must NOT claim the two prices match.
- [ ] Buying **grows that bay by 500 kg** and the crate in hand then fits.
- [ ] **Upgrade to **tier 5** (32 bays), then WALK TO EVERY NEW BAY** and press E at each one.
      Counting bays in the HUD is not enough — a build where the bays exist but
      cannot be reached satisfies a count and fails the player.
- [ ] A truck **pulls up** when a load lands, and pulls away once it is empty.
- [ ] The 🏗 terminal offers **➕ Open another storage bay** (10 Aza /
      **5,000,000** Cinder) whenever bays < cap — and buying one really adds a
      numbered bay. *(This line read 50,000 — the pre-repricing figure, 100×
      low, and the fifth surviving copy of it in this document. The number of
      record is `unit_price_cinder` in the migration; §5's table and §6's RPC
      table already carried the right one, which is how a stale copy survives:
      nothing compares them. `_wh_price_check.mjs` compares the CODE, not this
      file.)*
- [ ] **Upgrading the building builds 2 bays immediately** and raises the cap;
      the toast names how many were built. It must never move only the number.
- [ ] At the tier cap the ➕ control disappears and the modal offers the upgrade.
- [ ] **Crates are visible on the van** from where you stand at the door — not
      just counted in the HUD.
- [ ] Visiting **someone else's** warehouse (📦 My storage → 🏗 Visit) hides the
      warehouse-upgrade terminal and says "visiting <owner>" in the top bar.
- [ ] A bay you neither own nor rent does **not** claim to be un-rented.
- [ ] `node _wh_paste_check.mjs` → **WAREHOUSE PASTE FILE MATCHES**. Re-run it
      after any edit to the module.
- [ ] The 🏋 terminal sells lifters; buying one raises the limit immediately.

**Automated gates — run these, do not eyeball them**
```
npm i three@0.128.0 playwright --no-save     # once, for the reachability gate
node _wh_check_all.mjs                       # runs everything below; exit 0 = safe
```
| Gate | Guards against |
|---|---|
| `_harness.js` | A parse error or top-level TDZ anywhere in the game. |
| `_synckcheck.mjs` | An inline `<script>` block that will not minify. |
| `_wh_paste_check.mjs` | `WAREHOUSE_PASTE_index-module.js` drifting behind the live module. It has silently drifted **twice**; both times the stale file still parsed and looked fine, and following the handoff would have pasted back a version where resources could never be withdrawn. |
| `_wh_price_check.mjs` | `MOCK.CFG` in the offline yard drifting away from `wh_config()`. Compares **21** key groups. Two of them are new because they were sitting *inside* the anchors of other regexes, matched as `\d+` and thrown away: tier `max_units` (changing tier 5 from 32 to 12 in MOCK used to exit 0) and lifter `carry_kg` (changing Bare Hands from 25 to 10 used to exit 0 — and `carry_kg` is the *other half* of the bug this gate's own header cites). All six defect injections re-verified. |
| `_wh_stencil_check.mjs` | Floor bay-number stencils that are upside down, mirrored, rotated, missing — **or the wrong number**. Sweeps **every bay at both tiers** (4 + 32 = 36 numerals), each isolated causally by repainting the floor with `App.noStencils = <bay>` and diffing. It used to sample bay 2 and bay 31 and nothing else: painting bay 7 as "8" with all 31 other numerals correct scored 13 PASS / 0 FAIL, exit 0. |
| `_wh_reach_check.mjs` | A warehouse bay you cannot walk to. Floods the yard on a 0.2 m grid from the truck door using the page's **own** `blocked()` predicate at 2/4/8/14/22/32 bays. The bay layout is derived from the unit count, so a spacing or row-wrap change can wall one off — and nothing shows it until a player has paid up to 150,000,000 Cinder (or 300 Aza) for Tier 5 and finds Bay 27 behind a collider. **Re-run it if you touch `BW`, `BD`, the row pitch, the shed dimensions or the collider list.** Exits non-zero on any unreachable bay, so it belongs in CI. |

**Regression**
- [ ] Camp, Real Estate Office and the card-shop 3D walk all still work.
- [ ] `node _harness.js` → ALL CHECKS PASSED. `node _synckcheck.mjs` → ALL CLEAN.
- [ ] No new console errors versus the pre-change page.

---

## 8 · Known limitations — read before shipping

1. **The resource ledger is server-side FOR THE WAREHOUSE PATH — and the
   divergence that creates is NOT solved.** `public.user_resources` now holds a
   real balance; `wh_send_shipment` debits it inside its own transaction, and
   withdraw / cancel / reclaim credit it back. `{"dna":1000000}` from an empty
   ledger is refused. But the rest of the game still reads and writes
   `Profile.salvage` in the client profile blob, and those systems do not know
   this table exists. Two concrete failures, both reachable today:
   - **Earn outside, ship inside** — loot 500 metal (blob +500, ledger
     unchanged), try to ship it, get `insufficient_resources` while the
     inventory screen shows 500. Reads to the player as "the game lost my
     metal". The UI says so in as many words rather than saying "not enough".
   - **Spend outside, ship inside** — craft away 500 metal (blob −500, ledger
     unchanged) and you can still ship 500 from the warehouse.
   The ledger is seeded ONCE from the blob by `wh_seed_resources`, which is a
   real trust concession: it believes the client's claim exactly one time,
   capped at 100,000 per resource, writes a row for every known resource so
   there is no "not seeded yet" state left to exploit, and records a
   `wallet_ledger` entry marking the amount SELF-DECLARED. Full migration path
   is written out in §DIVERGENCE at the end of the resource-ledger section of
   the migration. **A cheaper partial — mirroring the blob into the ledger on
   every profile save — was considered and rejected, because the blob is
   client-owned and that would re-open the mint.**

   *(original item, kept because it is what the hole was)* **The salvage ledger is not server-side.** Cinder and Aza are authoritative;
   `Profile.salvage` is not, anywhere in this game. The server validates a
   payload's *shape* and derives its weight and ETA, but **cannot prove the
   sender owned the goods**. Fix by adding a `user_resources` table + debit RPC
   and moving the debit into `wh_send_shipment`'s transaction.
2. **Two inherited holes this module's economy rests on** (both outside these
   files, both should be fixed):
   - `public.tw_node_owners` insert policy is `with check (true)` → anyone can
     insert themselves as a node owner, which makes node level (and a faster
     ETA) forgeable.
   - `bulletproof_saves.sql`'s `up_upd` lets a client UPDATE its own
     `user_progress` row → a player can set their own Cinder balance. Every
     "charged inside the transaction" guarantee here is real, but it is a
     guarantee about a balance the player can also edit.
3. **Bay contents are visible to the warehouse owner by design** — they have to
   see a load to unload it. Everyone else sees `renter_id`, `renter_name`,
   `used_kg`, `capacity_kg` and `rent_until` as `null`. The client renders those
   bays as *private*; if you add UI that reads those fields, handle `null`.

   **The warehouse owner's `auth` id is exported by exactly one function, to
   exactly one caller: `wh_warehouse_json()`, gated behind `v_is_owner`.** That
   sentence used to read "is never exported" and was false when written — the
   same UUID was leaving by two other doors:
   - `wh_directory()` handed every signed-in caller the `owner_id` of every open
     warehouse in the game;
   - `wh_my_rentals()` handed every renter the `owner_id` of the warehouse they
     rent in — verified live, a renter's `my_rentals` row carried the UUID while
     `warehouse_json` returned `null` for the same field.

   Both keys are gone. Nothing consumed either one: renting takes the warehouse
   id, shipping takes the unit id, routing takes `node_id`, and both rows still
   carry `owner_name` for display. **If you add a key to any of these three
   builders, check it against this list** — the rule is enforced per-function,
   so it can be broken one function at a time, and it was, twice.
4. **Performance is unmeasured on real hardware.** An independent probe measured
   frame rate scaling exactly with pixel count at constant draw calls — i.e. the
   2–4 fps seen headless is purely SwiftShader fill rate, not scene complexity.
   It is very likely fine on any GPU, but nobody has measured a real one.
   ⚠ **A DRAW-CALL COUNT WITHOUT A CAMERA IS NOT A MEASUREMENT.** The version of
   this table before this one quoted draw calls and drawn triangles that nobody
   could reproduce — an independent probe at "the same" camera got 40/44 at tier
   1 and 178/188 at tier 5 against the 37/40 and 175/184 printed here. Both were
   honestly taken; neither said *where the camera was*, and every number in
   those two columns depends entirely on that. The mesh, geometry and
   scene-triangle columns, which do not, were exact.

   **Protocol, so the next person gets the same numbers.** Viewport 1000×700,
   the page's own FOV, `camera.position = (0, 1.70, 0.5)`, `Ctl.yaw = 0`,
   `Ctl.pitch = 0` — standing on the dock threshold facing into the shed. Tier 1
   is **2 bays** (`start_units`), tier 5 is 32. Counters read from
   `renderer.info.render` immediately after one `renderer.render(scene, camera)`
   with `renderer.info.reset()` before it. "before" is commit `fe66261`, i.e.
   ahead of the backdrop work (sky dome, apron, perimeter wall, railed fence,
   distant stacks), the truck's geometry cache, and the bay signage rework.

   | | meshes | geometries | scene tris | draw calls | drawn tris |
   |---|---|---|---|---|---|
   | tier 1 before | 249 | 227 | 9,957 | 35 | 1,716 |
   | tier 1 now | 255 | 204 | 11,375 | 38 | 2,486 |
   | tier 5 before | 387 | 365 | 12,309 | 172 | 4,066 |
   | tier 5 now | 393 | 342 | 13,895 | 174 | 5,000 |

   **And the worst case, because a single standing view is the easy one.** Every
   walkable position on a 2 m grid — filtered by the page's own `clampPos()` and
   `blocked()`, not a model of them — at eight yaws, 1,712 views at tier 1 and
   2,240 at tier 5:

   | | positions | views | worst draw calls | worst drawn tris |
   |---|---|---|---|---|
   | tier 1 | 214 | 1,712 | **254** | 11,339 |
   | tier 5 | 280 | 2,240 | **392** | 13,859 |

   Both worst cases are the same shot: standing in the −X corner of the shed
   looking diagonally down the whole building, where nothing culls. That is 6.7×
   the standing-view figure at tier 1 and 2.3× at tier 5, and it is the number a
   frame budget has to be built on.

   Draw calls went **up** by 3 and 2. The backdrop is merged into 3 meshes plus
   a sky dome; the bay signage rework added a mouth header to every bay and an
   aisle blade to every row while *removing* a mesh, because all of a bay's
   boards are now merged into one. The truck's geometry cache (`geoBox`/`geoCyl`
   in truck.js) buys **memory**, not calls — 143 → 116 geometries — because each
   mesh is still its own call. It is also **164 → 166 meshes, not "the same 166
   meshes"**: the cache landed in the same commit as two small additions, and
   the old count was taken from the new build. Said plainly rather than filed
   under "optimised".
5. **The truck now carries three real openings** cut from the lofted shell by the
   same mechanism — the kerb door, both wheel arches, and the cargo roll-up.
   The cargo one exists because the delivered load was otherwise invisible: a
   raycast from 1,888 standable positions saw 0 of 12 crates. It is now 9 of 12
   from 1,502 positions. **If you move `CARGO` in truck.js, move the crate
   stacking in `rebuildTruckCrates()` with it** — they are keyed together
   through `WHTruck.CARGO`.
6. **The wheel arches are real holes cut from the shell** (same mechanism as
   the door), which required dropping the body to `floorY 0.60` so the side wall
   actually overlaps the tyre. If you change `floorY`, re-check the arches, the
   step well and the cargo deck together — they all key off it.

7. **THE BAY LAYOUT IS THE MOST FRAGILE GEOMETRY IN THE MODULE.** Four numbers
   have to agree, and three separate bugs have come from them drifting apart:
   - `BAYS_PER_ROW` and `ROW_PITCH` decide how many rows a bay count needs;
   - `shedZB(n)` derives the shed's back wall from that;
   - `clampPos()` derives where a player may stand from `App.shedZB`;
   - the key light's `shadow.camera.bottom` derives its reach from it too.
   Change any one and re-run `_wh_reach_check.mjs`, which drives the real page
   at every tier a warehouse can sell. It calls the page's own `blocked()` **and**
   its own `clampPos()` — never a copy of either. An earlier version modelled the
   clamp instead of calling it, and cheerfully certified 32/32 bays walkable
   while 20 sat behind a hardcoded `-19.5`: tier 5 cost 1,500,000 Cinder at the
   time and delivered 12 walkable bays out of 32.

8. **The lofted shell carries TWO materials, and the second one matters.**
   `loft()` puts the section's underside run in material group 1
   (`mats.underbody`, dark) and everything else in group 0 (`paintShell`,
   body-white). The wheel arches are cut directly above that underside, so if
   you collapse the groups back to one material the shell's own bottom cap
   becomes a lit body-white shelf visible through all four arches, 65 mm
   outboard of the tyre — it slices each wheel in half at luminance 205-228
   against a 30-72 tyre. That defect survived four rounds of A/B losses and
   was misdiagnosed twice as the cargo deck, which is a different mesh entirely.

9. **`WHTruck.SHADOW_HINT` is a cross-file contract.** `truck.js` exports the
   `bias` / `normalBias` / `mapSize` its flat slab sides were authored against,
   and `public/warehouse/index.html` reads it when configuring the key light.
   Ignore it and the truck stripes itself with shadow acne down every flat panel.
   The shadow **frustum** is a separate hazard with the same shape as the clamp
   bug: `shadow.camera.bottom` must reach `App.shedZB`, or the back of the shed
   silently stops casting and receiving shadows — at tier 5 that was the back
   16.6 m, half the bays.

10. **`WHTruck.CARGO.deckY` is the crate STACKING floor, not the cargo deck.**
    It is deliberately `floorY + 0.46` — the top of the rear wheel house, which
    spans the whole cargo opening in z. Stack from the real deck instead and the
    bottom tier of crates is buried 0.40 m inside a dark box and visibly passes
    through it.

11. **The floor slab repaints on every unit change, and that is load-bearing.**
    `buildShed()`'s early-out compares `units`, not just the row count. It used
    to compare rows alone, and rows only change every 5th unit — so buying units
    2–5 added bays over a slab still painted for one: no numeral in front of
    four of the five bays, no stall edging, and the aisle lane still drawn where
    the row used to stop. The bays are placed by `buildBays()` and the paint
    under them by `buildShed()`; both have to react to the same number.
    The slab's speckle is **seeded**, not `Math.random()`, so two paints of the
    same shed are pixel-identical — `_wh_stencil_check.mjs` relies on that to
    isolate a numeral by repainting with `App.noStencils = <bay number>` and
    diffing. That gate now reads **every** numeral at both tiers, not two of
    them, and catches a wrong DIGIT as well as a wrong angle; the measured
    matrix of injected defects is in the file's header. If you change the floor
    painting, keep it deterministic.

    ⚠ Two of that gate's tests are **skipped per numeral, by measurement, not
    by a list**: five of the 32 numerals (1, 8, 10, 11, 30) have artwork that
    correlates >0.85 with a flip of itself — "8" scores 0.999 against its own
    mirror — so demanding that identity beat every rotation by a margin fails a
    perfectly drawn floor. The gate computes that self-symmetry from the
    reference artwork at runtime and prints which numerals it stood down on.
    They are still covered by the which-numeral test and the on-screen upright
    test.

12. **The floor's concrete speckle is specified by its BLOBS, not its discs.**
    15 discs/m² of radius 1.1–2.8 px covered 15.2% of the slab, and at that
    coverage randomly placed discs merge: connected-component span was p50 4 px
    (11.8 cm), p90 8 px (23.5 cm), p99 14 px (41.2 cm) — nine in ten inside the
    intended 16.5 cm ceiling and the top tenth half again over it, which reads
    as pale blotching at eye height. Same 15/m², radius 0.8–1.9 px: 7.5% cover,
    p50 3 px (8.8 cm), p90 5 px (14.7 cm), p99 7 px (20.6 cm), identical at 2,
    8, 14 and 32 units. **If you retune it, label the components** — the disc
    radius in the source will tell you what you want to hear.

13. **The fog colour and the sky dome are in DIFFERENT COLOUR SPACES, and the
    hex codes matching is what proves they do not.** `<fog_fragment>` runs after
    tone mapping and the sRGB encode, so `scene.fog.color` lands on screen at
    its own sRGB value; the dome is a textured mesh, so its pixels go through
    both. Measured: `0x1a2230` renders at luminance **33** as fog and at **80**
    on the dome. The previous build set both to `0x1a2230` "so they match" and
    got a 47-luminance mismatch, plus `far = 120`, which meant the ground never
    reached even that: scanning down the yard gate the horizon read sky 78.5 →
    ground 99 → 157 across five rows — noon tarmac against a night sky. Fog is
    now `0x42546f`, the sky's *measured* on-screen value, with `far = 72`, and
    the 200 m ground plane's albedo is `0x0b0d12` instead of `0x14161b`, which
    was rendering at 157, brighter than the sky above it. Same scan now: sky 82,
    ground 82, 82, 82, 87, 95; largest adjacent step **5.6** where it was
    **19.7**. **If you change the dome gradient, re-measure the fog colour — you
    cannot read it off the gradient.** (Still open: the concrete apron itself
    renders ~155 under a sky of 82. That is the mood of the yard rather than a
    seam, and it was left alone.)

14. **Every bay carries its number on a face someone can read, and that is not
    the same as “on every aisle-facing face”.** The aisle decal used to be gated
    on `col === BAYS_PER_ROW - 1`, i.e. the fifth column — which does not exist
    below 5 bays. Counted at every unit count: 0 signs at 2 units, 0 at 4, 1 at
    8, 2 at 14, 6 at 32. Tier 1 is where every player starts and it had none.
    An interior bay has no aisle-facing face at all (0.45 m to the next bay's
    wall), so what every bay now gets is a header over its own mouth, onto the
    walkway a player uses to reach it; the row-end bay keeps the +X decal and
    gains a double-sided blade turned to face down the aisle. Measured from the
    dock end of the aisle at tier 5, projected width of the number: the flat
    decal 1.5–17.8 px at 43.6–12.6 m, the blade 20.4–70.6 px from the same
    camera. All of a bay's boards are merged into ONE mesh (`mergeGeos` carries
    UVs now, which it did not), so this costs **fewer** draw calls than the two
    boards it replaced.
