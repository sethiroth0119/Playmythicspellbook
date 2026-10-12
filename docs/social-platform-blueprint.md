# Social Platform Blueprint — Identity, Friends, Wardrobe & Creator Brands

Status: **LAYOUT ONLY — nothing here is built yet.** Written 2026-10-12.
Purpose: a phase-by-phase plan an agent loop can execute one phase at a time, each with
entry conditions, deliverables and a verify gate.

---

## 0. What already exists (audited — do not rebuild)

| Area | What's there | Where | Gap |
|---|---|---|---|
| 2D avatars | `Forge/Catalog.avatars`, `equipOrBuyAvatar` | index.html ~84166 | ⚠ deducts `Profile.gems` directly (bypasses `spendGems`) |
| Other cosmetics | sleeves, dice skins, tombstones, card frames | `user_profiles.forge` JSONB keys `__equipped*__` | no shared "cosmetic" model |
| 3D player character | `mapforge.avatar.js` (`resolveCharacter`, `createAvatar`), pick = `Profile.athenaAvatar` | `src/mapforge/` | whole-body swap only; no clothing slots, no skeleton standard |
| "Character closet" | **not found in the repo** under that or any similar name | — | if it lives on another branch or build, merge it before Phase 3 |
| GLB upload | `mapforge.files.js` → `models` bucket + `world_assets` | `sql/112` | ⚠ RLS lets ANY signed-in user upload (UI is admin-only); no tri/texture limits; embedded textures load unchecked |
| Image moderation | van livery: quarantine → third-party scan → review → approved | `sql/063_van_livery.sql` | **the only approved image pipeline — reuse it** |
| Friends | `friend_requests`, `friendships`, `FriendsCache`, `renderFriends` | index.html ~205542 | tables exist only as a comment, **no migration in `/sql`** |
| Presence | `LobbyPresence` (`lobby:v1`), `chat-presence` → `FriendsCache.online` | index.html ~59167 / 205755 | shows only online or offline, not where the player is |
| Party | — | — | not built |
| Recently played | `get_player_recent_matches`, `matches` | RPCs | battle only; no city or hub encounters |
| Phone | Chat app only (`MythicChatSeam`) | `src/phone/handset.js:40` | no Friends / Profile / Wardrobe / Shops apps |
| Profile | `PlayerProfileView`, `get_player_profile`, `public_profiles` | index.html ~58565 | no bio, showcase, titles or "currently in" |
| Titles / badges | Gym `activeTitle`, `merc_badges`, `ACHIEVEMENTS` | scattered | no unified title system |
| Player storefronts | `card_shops` / `card_shop_listings` / `card_shop_buy`, `shop_objects` (shop_id='global') | supabase/migrations | cards only; the 3D shop is global, not per-player |
| Market | Luni (`MythicLuni`), `luni_reviews`, price history | `sql/115` | no limited editions, serials or creator royalties |
| Reports / moderation | admin ban via worker; community `banned` status | worker.js | **no report-content or report-player flow anywhere** |
| Age verification | ToS text only | index.html ~165425 | not built |

---

## 1. The product loop (what we're building toward)

```
        ┌──────────── CREATE ────────────┐
        │ Player founds a Brand          │
        │ uploads GLB → validated →      │
        │ scanned → approved Wearable    │
        └──────────────┬─────────────────┘
                       ▼
   ┌──────── SELL ─────────┐         ┌────────── SHOW OFF ──────────┐
   │ Brand storefront page │  buy →  │ Outfit renders in hubs, city,│
   │ Clothing store venue  │────────▶│ profile, chat card, phone    │
   │ on a parcel (try-on)  │         │ "Minted #12/50 by <Brand>"   │
   └──────────▲────────────┘         └──────────────┬───────────────┘
              │                                     │ friends see it,
              │ creator earns Cinder (minus fee),   │ click → "Get this look"
              │ royalty on every resale             ▼
        ┌─────┴────────── DEMAND ──────────────────────────┐
        │ Friends / presence / venues / events put people  │
        │ in front of each other → status → more buyers    │
        └──────────────────────────────────────────────────┘
```

The social phases (1–2) create the audience and the wardrobe phases (3–6) give it something
to show off. **Build them in that order.** A clothing market with no audience earns nothing.

---

## 2. Decisions the owner must make BEFORE the loop starts

These choices change the schema, so answer them first:

1. **Textures on uploaded clothing?**
   - **A (recommended):** allowed, but every embedded image is extracted and sent through the
     existing van-livery third-party scan pipeline (`sql/063`) before the item can go live.
   - **B:** no textures at all. Strip images and colour items from `palette/` + material params only.
   - Option A must exist before any upload is public. CLAUDE.md's CSAM rule applies to a texture
     inside a GLB exactly as it does to a JPEG.
2. **Can creator earnings be cashed out?** If yes, creators become payees: KYC, tax forms and
   payout holds (Stripe Connect). Recommended: earnings land as Cinder flagged non-cashable for
   30 days (chargeback/DMCA window), reusing the `cinder_cashable()` idea from `sql/017`.
3. **Who can found a brand?** Recommended: account age ≥ 14 days + a founding fee in Cinder
   (a sink) + a limit of 1 brand per player at launch.
4. **Platform fee and resale royalty %.** These go in a tuning constant (the `_opEcon()` pattern),
   never hardcoded. Suggested starting points: 30% primary fee, 10% royalty to the creator on resale,
   5% resale fee.
5. **Battle surfaces.** CLAUDE.md forbids touching battle, card or economy code during Community
   work. Showing outfits in battle (Phase 6c) needs explicit sign-off.
6. **Age gate.** "Adult Roblox" with paid UGC needs at least an 18+ attestation on signup now and
   real verification before cash-out is enabled.

---

## 3. Phases (each one is a single loop iteration)

Every phase follows the same contract:
- **Migration:** next numbered `sql/1NN_*.sql`, idempotent, RLS in the same file, ends with a verify query.
- **Module:** `public/src/<feature>/`, reads the game only through `window.MythicBridge`. Anything
  new it needs from index.html gets **added to the bridge**.
- **Offline:** every Supabase call is guarded and degrades to empty or mock data.
- **Money:** only through `chargeCinderAtomic` / `spendGems` / `addGems` or a SECURITY DEFINER RPC
  that writes an append-only ledger. Never mutate a balance.
- **Gate (must pass to close the iteration):** `node _synckcheck.mjs`, `node .gauntlet/modcheck.mjs`,
  `node .gauntlet/comment-scan.mjs`, `node .gauntlet/precommit-scan.mjs`, plus the phase's own
  acceptance checks.

---

### PHASE 0 — Foundations (safety rails; nothing user-facing)

| # | Deliverable | Notes |
|---|---|---|
| 0a | `sql/132_friends_codify.sql` | Turn the friends tables in the index.html comment into a real migration. Re-runnable, matches the live schema. |
| 0b | `sql/133_content_reports.sql` | `content_reports(id, reporter, target_kind, target_id, reason, note, status, created_at)` + `report_content()` RPC (rate-limited) + admin review policy. Every later phase hooks into it. |
| 0c | `sql/134_world_assets_lockdown.sql` | Close the RLS gap: user inserts into `world_assets` require `ms_is_admin()` until the Phase 3 pipeline replaces it. |
| 0d | Server-side block list | `user_blocks(blocker, blocked)`. A block hides chat, presence, friend requests and profile. Replaces the local-only block. |
| 0e | 18+ attestation | One checkbox at signup, stored with a timestamp. Required before any marketplace action. |

**Exit:** a report can be filed and reviewed end to end, and a non-admin upload to `world_assets` is refused.

---

### PHASE 1 — Identity: public profile, titles, display names

**Module:** `public/src/social/profile/`

| # | Deliverable |
|---|---|
| 1a | `sql/135_player_profiles_social.sql`: `profile_social(user_id, bio text ≤280, pronouns, showcase jsonb, privacy jsonb, created_at)`. Bio goes through server-side `chat_clean`. |
| 1b | **Showcase slots** (up to 6): best card, deck, owned land or parcel, corp, community, worn outfit (after Phase 4). Each slot references an id that the server checks the player actually owns. |
| 1c | **Titles:** `title_defs(id, label, rule)` + `player_titles(user_id, title_id, earned_at, source)`. Grant only from server events (mayor elected, corp founded, leaderboard rank, brand sales milestone). Existing Gym titles and `merc_badges` are migrated in as sources. The player picks one active title. |
| 1d | **"Currently in…":** derived from presence (Phase 2), never stored. |
| 1e | Stats: join date, friend count, corp, community, mayor-of. Read through the `public_profiles` view. |
| 1f | Privacy: who sees online status and location (everyone / friends / nobody). |

**Exit:** `openPlayerProfile(otherUser)` shows bio, title, showcase and join date, and the privacy settings are enforced by RLS, not the UI.

---

### PHASE 2 — Social graph on the phone: friends, presence, party, recently met

**Module:** `public/src/social/presence/` + phone apps in `src/phone/handset.js`

| # | Deliverable |
|---|---|
| 2a | **Rich presence:** extend the `chat-presence` track payload with `{where: 'node-city'\|'hub:<mapId>'\|'battle'\|'menu', joinable: bool, partyId}`. Not stored in the database; Realtime only. Respects the 1f privacy settings. |
| 2b | **📱 Friends app:** Online / All / Requests / Recently Met / Blocked tabs. Each row shows name, active title, outfit head icon (after Phase 4), where they are, and a **Join** button. |
| 2c | **Join:** routes to the friend's surface. For a hub this is `athena:<mapId>` (the session already supports it); for node-city it opens their city in visitor mode; for battle it spectates. Each target exposes a `join(target)` function on the bridge. |
| 2d | **Party:** `parties(id, leader, created_at)`, `party_members(party_id, user_id)`. Max 6. When the leader moves, members get a "Follow?" toast. Realtime channel `party:<id>` for chat and moves. |
| 2e | **Recently Met:** `encounters(user_id, other_id, context, last_at)` upserted by RPC when two players share a hub session, battle or trade for ≥60s. Keep 50 per user. RLS: you only see your own rows. |
| 2f | **📱 Profile app:** your own profile plus an editor (Phase 1). |
| 2g | Push: "3 friends are in Node City" opt-in digest (the push infra exists, `RUN_009`). Rate-limited to 1 a day by default. |

**Exit:** two test accounts can friend each other, see each other's location, join with one tap, form a party, and appear in each other's Recently Met.

---

### PHASE 3 — Wearable standard + upload pipeline (the risky part, built before any store)

**Module:** `public/src/wardrobe/` (client), worker route `/api/wearables/*` (server validation)

**3a. The Mythic Body standard** (a spec, published as `docs/wearable-spec.md` and as a downloadable base GLB):
- One base skeleton: fixed bone names and hierarchy. The current Athena player GLB is the
  starting point, and its rig becomes the standard.
- **Slots:** `head`, `hair`, `face`, `torso`, `legs`, `feet`, `hands`, `back`, `waist`, `aura`(vfx).
  Each item declares one slot plus the slots it hides (a long coat hides `waist`).
- **Budgets per item:** ≤2 MB, ≤8k triangles, ≤2 materials, textures ≤1024², ≤1 UV set, skinned
  only to standard bones, no cameras, lights, scripts, extensions outside an allow-list, or external URIs.
- **Rigid accessories** (hats, weapons-on-back) attach to named sockets instead of being skinned.

**3b. Pipeline states** (copied from van livery):
```
uploaded → validating → (rejected) | scanning → (rejected) | awaiting_review → approved → (delisted)
```
- **validating:** server-side GLB parse in the worker: magic and version, chunk sizes, triangle
  count, bone-name match, material count, texture dimensions, extension allow-list. Client-side
  checks in `decorate/glb.js` are **instant feedback only**, never enforcement (the same lesson as `chat_send`).
- **scanning:** every embedded image is extracted and sent to the van-livery third-party scanner.
  Geometry-only items skip this step.
- **awaiting_review:** human review queue for the first N items of every new brand. After that,
  brands in good standing auto-approve and are spot-checked.
- Files live in a **private** `wearables-quarantine` bucket until approved, then are copied to
  public `wearables/<brandId>/<itemId>/<version>.glb`. **Never serve a file that hasn't been approved.**

**3c. Tables** (`sql/136_wearables_pipeline.sql`):
- `wearable_assets(id, brand_id, uploader, slot, hides[], status, tri_count, bytes, has_textures, scan_ref, review_note, version, created_at)`
- RLS: the uploader and the brand's members see their own drafts; the public sees `status='approved'` only; status changes only through SECURITY DEFINER RPCs (`wearable_validate_result`, `wearable_scan_result`, `wearable_review`).

**3d. In-editor tooling:** a "Wearable Check" page that loads a GLB onto the base body, shows the
budget meters, and offers an animation preview (idle, walk, run) so creators can see clipping before they submit.

**Exit:** a malformed, oversized, wrong-rig or textured-but-unscanned GLB can never reach the public bucket, and that is proven with test fixtures.

---

### PHASE 4 — Wardrobe: owning and wearing

| # | Deliverable |
|---|---|
| 4a | `sql/137_wardrobe.sql`: `wearable_items` (sellable listing of an approved asset), `wearable_owned(id, item_id, owner, serial, minted_at)`, `avatar_loadouts(user_id, slot→owned_id jsonb, preset_name)`. Up to 5 saved outfits. |
| 4b | **Equip rule:** you can only equip `wearable_owned` rows you own (enforced in the RPC). |
| 4c | **Avatar composer:** `createAvatar` gets an outfit mode. Load the base body, then each slot's GLB bound to the shared skeleton, apply `hides`, and cache by `itemId@version`. LOD: beyond ~20 players in view, fall back to a merged low-poly impostor. |
| 4d | **2D surfaces without image uploads:** profile cards, chat heads and the phone render a portrait **client-side** from the loadout (an offscreen three.js render, cached in IndexedDB). We never accept a "rendered portrait" upload from a client, because that would be an unscanned image upload by another name. |
| 4e | **Migrate the old cosmetics:** existing 2D avatars and the `Profile.athenaAvatar` pick become `wearable_owned` rows or a "classic portrait" option, so no one loses anything. Fix `equipOrBuyAvatar` so it goes through `spendGems` / `chargeCinderAtomic`. |
| 4f | **📱 Wardrobe app:** browse what you own, equip, save outfits, and see "minted #12/50 by <Brand>". |

**Exit:** equipping an outfit on account A is visible to account B in a hub within one presence tick.

---

### PHASE 5 — Brands & creator onboarding (the step-by-step flow you asked for)

**Module:** `public/src/brands/`. **Migration:** `sql/138_brands.sql`

**Tables:** `brands(id, owner, name unique, tag ≤5, description ≤500, status, founded_at)`,
`brand_members(brand_id, user_id, role: owner|designer|manager)`,
`brand_ledger(id, brand_id, kind, amount, ref, at)` (**append-only, balance = sum**), `brand_follows`.
Brand text goes through `chat_clean`. Brand names are checked against a reserved and trademark deny-list.

**Creator flow (one screen per step, in the phone's "Studio" app or the Brand page):**

1. **Found a brand.** Check eligibility (decision 2.3), pay the founding fee via `chargeCinderAtomic`, choose a name and tag, write a description. Text only: no logo upload in v1, logos are built from the palette and glyphs (the livery pattern).
2. **Download the kit:** base body GLB, slot templates, the spec, and a Blender quick-start doc.
3. **Upload a design:** pick a slot, upload the GLB, and see instant client-side budget meters.
4. **Preview on the body:** try it in idle, walk and run; check for clipping against the default outfit.
5. **Submit:** it goes into the Phase 3 pipeline. Status shows on the Studio dashboard with reasons on rejection.
6. **Set it up for sale** (once approved):
   - Price in Cinder (min/max band from tuning, not hardcoded)
   - Edition: **Open** (unlimited) or **Limited N** (fixed at listing, can never be raised)
   - Optional launch time ("drops")
7. **Stock a store:** choose where it sells (Phase 6). It always appears on the brand page, and the creator can also place it in a clothing-store venue.
8. **Get paid:** each sale credits `brand_ledger` (net of the platform fee). The owner withdraws into their Cinder wallet subject to the cashable hold (decision 2.2), and owners split payouts with designers by percentage.
9. **Analytics:** views, try-ons, sales, resale volume, and royalties earned.

**IP / takedown:** `content_reports` gets the reason `ip_infringement`. A DMCA-style notice form
exists for rights holders, takedown delists the item, and three upheld strikes suspend the brand.
**This must ship with Phase 5. A store that sells uploaded clothing without it is liable for
every ripped designer logo.**

**Exit:** a test account goes from "found brand" to "item for sale" using only the UI, and an admin can delist the item and strike the brand.

---

### PHASE 6 — Selling: storefronts, clothing stores, resale

| # | Deliverable |
|---|---|
| 6a | **Brand page:** banner (palette and glyph), description, catalog, followers, "Worn by" (a sample of players' public profiles). |
| 6b | **Primary sale RPC `wearable_buy(item_id)`:** in one transaction, charge the buyer (atomic), assign the next serial for Limited N (fail cleanly at N), insert `wearable_owned`, and write the fee and creator credit to the ledgers. Idempotency key to stop double-buys. |
| 6c | **Clothing store venues:** a parcel owner (or brand) turns a parcel/`decorate` space into a store. Generalise `shop_objects.shop_id` from `'global'` to per-shop; racks and mannequins point at `wearable_items`; walk up → **try on** (local preview only) → buy. The store owner can take a consignment cut set by the brand (ledgered). |
| 6d | **Resale market:** list `wearable_owned` on Luni. Sale moves ownership (an append-only `wearable_transfers` log; the current owner is derived or kept by trigger), pays the seller, and takes the resale fee and creator royalty. Serial and provenance travel with the item. |
| 6e | **"Get this look":** on any profile or player in a hub, tap their outfit to see each piece and where to buy it (brand page or resale). This is the main path from showing off to selling. |
| 6f | *(needs sign-off, decision 2.5)* Outfit shown in battle: portrait on the battle HUD only, read-only from the loadout. |
| 6g | **📱 Shops app:** following feed (new drops from brands you follow), search, and your listings. |

**Exit:** a limited run of 3 sells out with serials 1–3, a 4th buy is refused, and a resale pays the seller, the creator royalty and the fee with ledger sums that reconcile.

---

### PHASE 7 — Hangouts & venues refinement (you said this is already planned; it links in here)

- Venue listing: name, description, hours, visitor counter, "friends here now" (from 2a).
- Emotes, sit points and dance on the Phase 4 avatar (same skeleton, so creator clothing works with all emotes).
- Proximity chat bubbles (the hub already has proximity voice in `mapforge.session.js`).
- Events calendar with RSVP and a push reminder.

---

## 4. Loop operating rules (for the agent running the phases)

1. **One phase per iteration.** Don't start N+1 until N's exit criteria are proven (screenshot or
   harness run + a SQL verify query output in the commit message).
2. **Migrations are applied by hand.** The loop writes the file and stops. The owner runs it in the
   SQL editor for project `ktsiasyjusesawtrwrjc` and replies with the verify output.
3. **Every RLS policy gets a line-by-line review note** in the migration's header comment.
   Membership checks use SECURITY DEFINER helpers (no recursive policies).
4. **No balance columns.** Ledgers only, and every money RPC has a reconcile query in its verify block.
5. **Fixtures:** `tools/wearable-fixtures/` holds GLBs that MUST be rejected (too many tris, wrong
   rig, external URI, oversized texture, bad magic, truncated chunk) and ones that MUST pass. Phase 3+
   iterations re-run them every time.
6. **Out of bounds for this loop:** no Discord integration, no battle/card/economy edits without
   sign-off, no new npm dependencies without asking, and no image upload path that skips the scanner.
7. Deploy bumps the three version knobs together (`version.txt`, `BUILD_VERSION`, `sw.js CACHE_VERSION`).

---

## 5. Migration number plan

| File | Phase |
|---|---|
| `132_friends_codify.sql` | 0a |
| `133_content_reports.sql` | 0b |
| `134_world_assets_lockdown.sql` | 0c |
| `135_player_profiles_social.sql` | 1 (+ blocks, attestation if not split) |
| `136_wearables_pipeline.sql` | 3 |
| `137_wardrobe.sql` | 4 |
| `138_brands.sql` | 5 |
| `139_wearable_market.sql` | 6 |
| `140_parties_encounters.sql` | 2 (can run any time after 132) |

Renumber if other work lands first. The order of phases matters more than the numbers.
