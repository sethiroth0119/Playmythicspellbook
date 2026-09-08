# Node Campaigns — Handoff (2026-09-08)

Branch: `claude/campaign-system-nodes-pc5rgt` · commit `bf1de69` · build `v120w7`

## What shipped

The City Node drawer's **"⚔ Attack PRN"** button is now **"🎯 Do Campaign"**. It
opens a picker of the campaigns attached to that node. Two kinds exist:

| Kind | What it does |
|---|---|
| **relief** | Players GIVE the node resources toward per-resource goals. Gifts land on an append-only ledger, drive a leaderboard, and mint Ⓜ Mythic Token airdrop entitlements. Each relief drive also names a roguelite **mission** the player can run instead. |
| **assault** | The old attack flow, untouched, offered to any corp that does not hold the node. A node with only the raid skips the picker and behaves exactly as before. |

Seeded drive: **Standing With El Paso** (`elpaso_relief`) on node `N-42`, also
matched by node name `/el paso/i`. Goals: 500,000,000 each of Food, Water,
Crude Oil, Cinder. Mission: roguelite campaign named "Standing With El Paso".

## Files

| Path | Role |
|---|---|
| `public/src/campaigns/index.js` | Entry. Registers `window.MythicNodeCampaigns` = `{ open, close, renderTab, listForNode, refresh }`. Modal (pick → detail → give), tab renderer, admin editor, give flow, mission routing, one delegated click listener. |
| `public/src/campaigns/campaigns.data.js` | Resource meta, `SEED_CAMPAIGNS`, `ASSAULT_CAMPAIGN`, row↔UI mappers, `fmtBig`. |
| `public/src/campaigns/campaigns.api.js` | Every Supabase call. All degrade: `{ ok, missing, offline, error }`. |
| `public/src/campaigns/campaigns.bridge.js` | Reads `window.MythicBridge` + `.nodeCampaigns`. Null bridge if absent. |
| `sql/038_node_campaigns.sql` | Tables, RLS, RPCs, seed. **Not yet applied.** |
| `public/index.html` | Bridge block `nodeCampaigns` (~line 206935), button labels (2 places), `tw-act-attack` handler, Campaigns tab slot (`_ncTabHtml`), module `<script>` tag. |
| `public/sw.js`, `public/version.txt` | Version knobs bumped with `BUILD_VERSION` to `v120w7`. |

## Server side (sql/038)

- `node_campaigns` — definitions. SELECT authenticated; INSERT/UPDATE/DELETE `is_admin()`.
- `node_campaign_contribs` — append-only gift ledger. SELECT authenticated. **No write policy**; only the RPC writes.
- `node_campaign_airdrops` — Ⓜ entitlements. SELECT own rows or admin; UPDATE admin only (to mark `sent`).
- `node_campaign_give(p_campaign_id, p_resource, p_amount)` — the only write path. Validates campaign/resource, debits **Cinder on `user_progress.cinder`** in the same transaction (same UPDATE shape as `wallet_charge` in 023, **no Foundation Tax**), mirrors `user_profiles.gems` downward, inserts the ledger row, mints an airdrop row for each whole million crossed at `airdrop_mt_per_million`.
- `node_campaign_board(p_campaign_id)` — totals per resource, top 25, my totals, my Ⓜ, contributor count.

Food / water / crude oil live client-side in `Profile.salvage`. The client
spends them first (`spendResources`) and refunds (`_refundRes`, uncapped) if the
RPC fails. Cinder is never spent locally; the client adopts the returned
balance via `_gemsTaxExempt` and syncs `walletSeqProgress`.

Nothing is taken while signed out or before 038 is applied — the Give button is
disabled with a note.

## Bridge contract (`window.MythicBridge.nodeCampaigns`)

`node(id)`, `selectedNode()`, `onNodeScreen()`, `canAttack(id)`, `attack(id)`,
`getRes(id)`, `spendRes(id,n)`, `refundRes(id,n)`, `adoptCinder(bal,seq)`,
`missions()` → `[{id,name,isPublished,hasMap}]`, `missionRun()`, `missionStart(id)`,
`missionResume()`, `goMissions()`. Plus top-level `signedIn`, `userId`, `gems`,
`toast`, `confirm`, `render`, `isAdmin`, `cloud`.

If you need anything else from the legacy app, **add it here** — never reach
for a bare global (the globals trap, CLAUDE.md).

## Mission routing

`resolveMission(c)`: pinned `mission_id` → exact name match → substring match
against `getAllCampaigns()`. Then: no match → toast + `rlcList`; no map →
`rlcList`; same run in progress → `rlcMap`; other run in progress → toast +
`rlcList`; else `rlcStartRun(id)` (goes through the normal deck-pick screen).

## TODO for the owner

1. **Run `sql/038_node_campaigns.sql`** in the Supabase SQL editor
   (project `ktsiasyjusesawtrwrjc`). Verify query expects 7 policy rows.
2. **Build the "Standing With El Paso" roguelite campaign** in the Guide.
   Name must match, or pin it via the admin editor's "Pin a mission" select.
3. **Confirm El Paso's node id.** Seed row uses `N-42`. If the live map differs,
   open the drawer → Campaigns → ✎ Standing With El Paso → Save (fixes `node_id`).
4. **Decide the airdrop rate.** Default 1 Ⓜ per 1,000,000 units (2,000 Ⓜ for a
   fully funded drive). Change `airdrop_mt_per_million` in the editor.
5. **Fulfil airdrops** via thirdweb to the linked wallet, then:
   ```sql
   select a.*, p.wallet_address from node_campaign_airdrops a
     left join user_profiles p on p.user_id = a.user_id
    where a.status = 'pending' order by a.created_at;
   update node_campaign_airdrops set status='sent', tx_hash='0x…', fulfilled_at=now() where id = …;
   ```
6. **Deploy**: bump nothing further unless you change `/src/campaigns/*` — then
   bump the `?v=` on its `<script>` tag AND the three version knobs together.

## Verified

- `node _synckcheck.mjs` → ALL CLEAN (needs `npm install` for terser).
- Headless smoke test (fake bridge, signed out): picker, detail, give form,
  MAX chip, Give disabled offline, mission → `missionStart('rlc_1')`, raid →
  `attack('N-42')`, single-raid node bypasses picker, admin form renders.
- Not tested: live RPC path against Supabase (038 not applied yet), and the
  real drawer inside index.html in a browser. Check the tab renders on El Paso
  and the modal opens from the gold button after deploying.

## Known gaps / ideas

- Admin editor supports only the four fixed resources as goals. The server
  accepts any key in `goals`; add ids to `RESOURCE_ORDER` to expose more.
- No campaign end date / reward-on-completion. Add `ends_at` + a completion
  payout RPC if wanted; the ledger already has everything needed.
- Leaderboard is per campaign, not global. A cross-campaign board is one
  `group by user_id` away.
- The airdrop queue is manual. An edge function polling `status='pending'`
  and calling thirdweb would automate it — out of scope here.
