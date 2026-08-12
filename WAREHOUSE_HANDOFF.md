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
50,000 Cinder**. Bigger **weight lifters** let owners or workers carry more.

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

Each anchor below is **unique** in the file (`grep -c` returns 1). Search for the
anchor, then insert exactly where stated.

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

**Anchor A** (end of the Objectives panel inside `renderCamp()`'s `root.innerHTML`):
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
| `aza_to_cinder` | 5000 | The game's peg: 1 Aza = $1 = 5,000 Cinder |
| `start_units` | 2 | A new warehouse starts small |
| `unit_price_aza` / `unit_price_cinder` | 10 / 50,000 | "about $10 of Aza", matched in Cinder |
| `unit_capacity_kg` | 500 | Per bay |
| `crate_kg` | **22** | ⚠ must stay ≤ tier-0 lifter capacity |
| `max_shipment_kg` | **1800** | Sized to a tier-1 renter's real 1,932 kg ceiling. Bigger loads are refused, never truncated — and `wh_send_shipment` also checks the actual destination. |
| `rent_cinder_per_day` | 1200 | Paid to the warehouse owner |
| `rent_max_days` / `rent_grace_days` | 30 / 3 | Grace before goods can be impounded |
| bay expansion ceiling | **4 × `unit_capacity_kg`** (2,000 kg) | `wh_expand_unit` refuses past this with `bay_maxed`; hard-coded in the rpc, not in the config block |
| `free_city_hours` / `max_hours` | 72 / 72 | The ceiling, and the free-city rule |

**Warehouse tiers** — tier → max bays / Aza / Cinder:
1 Lean-To Depot 4 / — · 2 Sheet-Metal 8 / 25 / 125,000 · 3 Concrete Hub 14 / 60 / 300,000 ·
4 Regional Terminal 22 / 140 / 700,000 · 5 Ashfall Logistics 32 / 300 / 1,500,000

**Weight lifters** — tier → carry kg / Aza / Cinder:
0 Bare Hands 25 / free · 1 Back Brace 45 / 2 / 10,000 · 2 Hand Truck 90 / 5 / 25,000 ·
3 Pallet Jack 180 / 12 / 60,000 · 4 Forklift 400 / 30 / 150,000

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
| `wh_buy_unit(currency)` | owner | Adds a NEW empty bay. 10 Aza / 50,000 Cinder. |
| `wh_expand_unit(unit, currency)` | owner or that renter, rental must be CURRENT | **Grows an EXISTING bay** by another 500 kg, same price. This is what the "you need to open storage unit space" modal calls — buying a new bay cannot help a crate addressed to a full one. |
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
it is the one players hit most. Both now cover all 31 server codes, and **neither
falls back to `r.reason`** — an unmapped code is a bug in the table, not
something to show a player. Add a line to *both* whenever you add an RPC.

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
      **10 Aza** or **50,000 Cinder**; unaffordable options are disabled.
- [ ] Buying **grows that bay by 500 kg** and the crate in hand then fits.
- [ ] **Upgrade to tier 3, then WALK TO EVERY NEW BAY** and press E at each one.
      Counting bays in the HUD is not enough — a build where the bays exist but
      cannot be reached satisfies a count and fails the player.
- [ ] A truck **pulls up** when a load lands, and pulls away once it is empty.
- [ ] The 🏗 terminal offers **➕ Open another storage bay** (10 Aza / 50,000
      Cinder) whenever bays < cap — and buying one really adds a numbered bay.
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

**Regression**
- [ ] Camp, Real Estate Office and the card-shop 3D walk all still work.
- [ ] `node _harness.js` → ALL CHECKS PASSED. `node _synckcheck.mjs` → ALL CLEAN.
- [ ] No new console errors versus the pre-change page.

---

## 8 · Known limitations — read before shipping

1. **The salvage ledger is not server-side.** Cinder and Aza are authoritative;
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
   `used_kg`, `capacity_kg` and `rent_until` as `null`, and the warehouse
   owner's `auth` id is never exported. The client renders those bays as
   *private*; if you add UI that reads those fields, handle `null`.
4. **Performance is unmeasured on real hardware.** An independent probe measured
   **36 draw calls and 410 triangles** in the rendered frame with frame rate
   scaling exactly with pixel count at constant calls — i.e. the 2–4 fps seen
   headless is purely SwiftShader fill rate, not scene complexity. It is very
   likely fine on any GPU, but nobody has measured a real one.
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
