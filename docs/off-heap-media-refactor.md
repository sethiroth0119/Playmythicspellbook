# Off-Heap Media Refactor — implementation plan (deep media)

Status: **PLANNED / not started.** This is the safe way to finish moving the last
big base64 stores off the JS heap. It is intentionally NOT a quick edit — a wrong
move corrupts the **shared catalog for every player**. Do it as its own pass with
adversarial review.

All line numbers are approximate (the single `public/index.html` shifts as edits
land) — re-grep the named functions before editing.

---

## Background — what's already done (do NOT redo)

`v95y` + `v96b` already moved these OFF the heap using the proven blob-URL
pattern (base64 → `blob:` URL in memory, Blobs in IndexedDB, excluded from cloud):

- `Forge.sprites`, `Forge.cardArt`
- `Forge.weatherAudio`, `Forge.campAudio`, `Forge.locationArt`, `Forge.campArt`,
  `Forge.itemArt`, `Forge.oilTowerArt`, `Forge.opArt`, `Forge.reArt`

The machinery to reuse lives near `loadHeavyForgeFromIdb`:
- `_dataUrlToBlob`, `_mintArtBlobUrl`, `_artBlobByUrl` (registry url→Blob)
- `_deepBlobUrlize(node, depth)` — in-place: data:/Blob → `blob:` URL, depth-capped
- `_deepBlobifyForIdb(node, depth)` — copy: `blob:`/data: → Blob (for IDB persist)
- `_normalizeArtToBlobUrls()` — runs at load + at top of `saveForge`
- `_artValueToDataUrl` / `_resolveArtStoreToDataUrls` — `blob:` → base64 for MP relay + export

> NOTE: `_deepBlob*` depth cap is currently 6. catalog/campaign structures nest
> deeper — **bump the cap to 10** when you start using them on `catalogMedia`.

---

## The two remaining targets + why naive conversion is UNSAFE

### A. `customCards[]` / `customEvents[]` embedded art — **NO-GO in place**

Fields that hold base64 inline on the objects themselves:
- `customCards[].icon`, `customCards[].image` (authored via card editor ~L79026 `card.icon = ...`)
- `customEvents[].image`, `customEvents[].spriteFrames` (array), `customEvents[].boardDataUrl`

These in-memory objects are read by **two upload paths**:
1. **Per-player cloud sync** — `cloudSyncProfile` builds `forgeSmall.customCards`
   / `.customEvents` from in-memory (~L34406/34433), then `_stripDataUrls(rowRaw)`
   (~L34695) strips `data:` >256 chars. `_stripDataUrls` does **not** touch `blob:`.
2. **Shared catalog publish** — `cloudPublishCatalog` puts `customEvents` under
   `__custom_events__` in the `moves` blob (~L36582), runs `stripBig` (strips
   `data:` >6KB) (~L36657). Also does **not** touch `blob:`.

→ If you blob-urlize these in place, **both uploads ship dead `blob:` URLs**:
the per-player cloud row AND the shared catalog row. Players who restore from
cloud / download the catalog render broken art.

### B. `catalogMedia` — **NO-GO in place** (subtler)

`Forge.catalogMedia = { tomb, starterDecks[], pageGuides[], campaigns[], onboarding{} }`
holds base64 incl. **AUDIO** (page-guide voiceover, onboarding narration) — the
single biggest player-side chunk. Built at publish from the per-store IDB keys
(`forge_campaigns`, `forge_pageGuides`, `forge_starterDecks`, `forge_tombstoneArt`,
`Forge.onboarding`) by `cloudPublishCatalog` (~L36530). Distributed to players via
**Storage shards** (`cloudPublishCatalogArt` ~L36817), NOT the DB row. Consumed by
players: shard download → `Forge.catalogMedia = inc` (~L36985) → `_rehydrateCatalogMedia()`
(~L36159) overlays onto `Catalog.*`. `_preferRicher` (~L35892) returns arrays
**by reference**, so `Catalog.*` and `Forge.catalogMedia` **share nested objects**
(one in-place conversion off-heaps both — good).

**The hazard:** `cloudPublishCatalogArt()` reads the **in-memory** `Forge.catalogMedia`
(~L36824) and can be called **standalone** (no preceding rebuild) at ~L74631 and
~L100303. If `Forge.catalogMedia` ever holds `blob:` URLs, a standalone art-publish
uploads dead handles to the shared catalog → breaks art for **every** player.

---

## Safe design — "separate art dict" (mirror the cardArt pattern)

The reason `cardArt` was safe to off-heap: art lives in a **dedicated IDB-only
dict keyed by id**, excluded from every cloud upload, and the renderer looks it
up by id. Do the same for the custom content; for catalogMedia, close the
standalone-publish hole.

### Phase 1 — `customCards` / `customEvents` → dedicated art dicts

1. **New stores (IDB-only, never cloud-synced, never in catalog row):**
   - `Forge.customCardArt`  = `{ [cardId]: url }`
   - `Forge.customEventArt` = `{ [eventId]: { image, boardDataUrl, frames:[...] } }`
   Add to the `loadHeavyForgeFromIdb` key list + `saveForge` idbSet block, persisted
   via `_deepBlobifyForIdb`, off-heaped via `_normalizeArtToBlobUrls` (deep walk).

2. **One-time migration (in `_normalizeArtToBlobUrls` or a boot migrator):**
   For each `customCards[]` / `customEvents[]`: if an inline media field is a
   `data:` URL, MOVE it into the art dict keyed by id, then `delete` the inline
   field. Idempotent (skip if already moved). This both off-heaps the bytes AND
   makes the synced/published objects art-free.

3. **Renderer lookups:** wherever card/event art is resolved, add the art-dict
   lookup. Custom card art likely already falls through `getCardArt`/`cardArt` —
   confirm and add `Forge.customCardArt[id]` / `Forge.customEventArt[id]` as a
   source. Grep render sites: `unitBoardVisual`, `getCardArt`, event-tile render,
   `renderHandCard`.

4. **Authoring (card/event editor save):** write uploaded art to the art dict
   (`Forge.customCardArt[id] = dataUrl`) instead of `card.icon`/`card.image`.
   Then `_normalizeArtToBlobUrls` off-heaps it on the next save.

5. **Belt-and-suspenders:** extend `_stripDataUrls` AND `stripBig` to also drop
   `blob:` URL strings, so even a stray `blob:` can never reach any cloud upload.

6. **Distribution to players:** custom card art already reaches players via the
   `cardArt` Storage pipeline + catalog. Decide whether `customCardArt`/`customEventArt`
   need their own Storage shard category (add to `STORAGE_CATEGORIES` like
   `catalogMedia`) or whether existing `cardArt` coverage suffices. Verify a fresh
   non-admin device still sees custom-card/event art after this change.

### Phase 2 — `catalogMedia` (close the standalone-publish hole, then off-heap)

1. **Make the art-publish always re-read base64.** Factor the IDB-rebuild that
   `cloudPublishCatalog` already does (`_fullest('campaigns'…)`, `_fullStr('tombstoneArt'…)`,
   the `Forge.catalogMedia = {…}` assembly ~L36510-36548) into a helper
   `_rebuildCatalogMediaFromIdb()`. Call it at the TOP of `cloudPublishCatalogArt()`
   so the upload ALWAYS uses fresh base64 from the per-store IDB keys, regardless of
   what `Forge.catalogMedia` holds in memory. This removes the only path by which a
   `blob:` URL could reach the shared catalog.

2. **Only after (1):** off-heap `Forge.catalogMedia` in `_normalizeArtToBlobUrls`
   via `_deepBlobUrlize` (shared refs carry it into `Catalog.*`). Run it at BOTH
   rehydrate points (after the `_rehydrateCatalogMedia()` calls ~L36274 and ~L37014)
   AND at boot load, because the shard download overwrites `Forge.catalogMedia` with
   fresh base64 (~L36985). Persist `forge_catalogMedia` via `_deepBlobifyForIdb`.

3. **Re-verify the standalone callers** (~L74631, ~L100303) now rebuild-then-upload.
   This is the single most important correctness check in the whole refactor.

---

## Test / verification checklist (must all pass before deploy)

- [ ] `node _synckcheck.mjs` → ALL CLEAN.
- [ ] Adversarial review of the diff focused on: any path that puts a `blob:`/Blob
      into a cloud upload (`cloudSyncProfile`, `cloudPublishCatalog`, `cloudPublishCatalogArt`).
- [ ] Admin: edit a custom card's art → publish catalog → on a SEPARATE non-admin
      device the art renders (real bytes, not a dead `blob:`).
- [ ] Admin: standalone "publish art" action (the L74631 / L100303 buttons) → art
      still renders for players (proves the rebuild-before-upload guard works).
- [ ] Non-admin: campaigns / page-guides / guide voiceover audio still render/play
      after the off-heap.
- [ ] Cross-account same browser: sign out of admin → play as guest → sign back into
      admin → publish → art uncorrupted (proves no `blob:` persisted into a path the
      admin publish reads).
- [ ] Heap before/after on a content-heavy install (DevTools memory) shows the
      base64 strings gone from `Forge.catalogMedia` / custom art on non-admin.
- [ ] JSON export still round-trips (re-encodes `blob:` → base64 via the existing
      `_resolveArtStoreToDataUrls` path; extend it to the new dicts).

---

## Expected payoff

- Players on content-heavy installs (lots of admin campaigns/guides/voiceover):
  the biggest remaining player-side heap chunk (`catalogMedia`, esp. audio) leaves
  the heap.
- Admin/dev device: custom-card/event authoring no longer pins base64 on the heap.
- Zero new shared-catalog corruption risk, because art never travels inside a
  synced/published object and the art-publish always re-reads canonical base64.
