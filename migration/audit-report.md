# Phase 0 — Asset Migration Audit (Supabase → Cloudflare R2)

**Date:** 2026-08-18 · **Status:** complete, read-only. No code changed.
**Brief:** `MIGRATION_BRIEF.md`

---

## Headline numbers

| | bytes | files |
|---|---|---|
| `public/assets/` on disk | **6,408,227,775 (5.97 GB)** | 2,258 |
| Actually deployed (after `.assetsignore` + Cloudflare's 25 MiB object cap) | **3,307,188,939 (3.15 GB)** | 2,176 |
| Excluded by the 25 MiB cap | — | 36 |

**PNG dominates: 2,008 files / 2,926 MB deployed.**

### 50 GB STOP CONDITION: **NOT HIT** (5.97 GB — 12% of threshold)

Proceed. Classification is clean apart from one policy question, below.

### Compression is the bigger win, and it does not require R2

| Format | Estimated result | Saving |
|---|---|---|
| AVIF q≈55 on illustrated card art | 1.8–2.3 GB | ~**0.9–1.3 GB** |
| WebP | 1.4–1.7 GB | ~**1.4–1.7 GB** |

This is the "save space" half of the ask and it is independent of the host swap. It can ship
first and on its own.

---

## Phase 1 reality check: ~650 call sites, and **no single choke point**

The brief's Phase 1 assumes refactoring every call site to a shared `assetUrl()`. The size
of that task here:

| Location | Sites |
|---|---|
| `public/index.html` — `<img` | 331 |
| `public/index.html` — `.src =` | 101 |
| `public/index.html` — CSS `url(` | 84 |
| `public/index.html` — Three loaders | 37 |
| `public/index.html` — `new Image(` | 26 |
| Sub-apps (battle-board, node-city, main-menu, pack-opener, dwelling, ascent-map, narrative, deck-vault, sprite-live) | ~74 |
| **Supabase Storage** — `storage.from(` | 17 |
| **Supabase Storage** — `getPublicUrl` | 7 |
| `createSignedUrl` | **0** |

Buckets in use: `game-assets`, `card-art`, `public-catalog`, `models`, `battle-clips`.

**The nearest thing to a seam already exists:** `_artSrc()` at
`public/battle-board/index.html:381` is exactly the `assetUrl()` shape the brief wants — but
it is scoped to the battle board only. `index.html` has no equivalent and reaches
`/api/art/proxy` ad hoc at `:129693` and `:172477`.

`handleArtProxy` (`worker.js:1044`) is a viable seam: GET-only, 12 MiB cap, `image/*` only,
SSRF-guarded, `max-age=300`. **Caveat:** it re-fetches upstream per request with no R2 or
Cache API backing, so routing everything through it as-is would move egress rather than
remove it.

---

## 🔴 Three.js: the self-host is PARTIAL — this corrects a claim made in v120x9

v120x9 changed **two** loaders in `index.html` (`:92831`, `:163980`) to the self-hosted
`/assets/vfx/three.min.js`. It did **not** change the rest. Still fetching Three from a CDN:

| File | Line | Source |
|---|---|---|
| `public/pack-opener/index.html` | 129, 133 | cdnjs r128 + GLTFLoader |
| `public/dwelling/index.html` | 271 | cdnjs r128 |
| `public/ascent-map/index.html` | 178, 179, 181, 184 | cdnjs r128 + jsdelivr `three@0.128` |
| `public/deck-vault/index.html` | 296 | cdnjs r128 |
| `public/bank-ethos-buy/index.html` | 314 | cdnjs r128 |
| `public/main-menu/index.html` | 480–502 | 0.169 / 0.170 / 0.160 |
| `public/node-city/index.html` | 1992–1995 | 0.171 WebGPU |
| `public/sprite-live/demo.html` | 64–66 | WebGPU / TSL |
| `public/index.html` | 163845, 163974 | jsdelivr `three@0.128.0` **addons** |
| `public/index.html` | 228456–7 | jsdelivr `three@0.171.0` |

**What this means for the freeze report.** The combat-impact path — `_vfxEnsureThree` →
`_buildImpactRig` at `:92831` — uses THREE *core only* (renderer, scene, camera, lights,
canvas textures; no GLTFLoader). That path **is** fully self-hosted now, so the specific
"freezes every time the combat animation happens" fix holds. But the broader claim that
there is "no third-party fetch left for Tracking Prevention to block" was **wrong**: every
row above still stalls under Edge's Tracking Prevention. Finishing this is mechanical and
should be done.

### Version sprawl: at least four Three.js versions coexist

r128, 0.128.0, 0.160/0.169/0.170, 0.171 (WebGPU).

Blast radius of standardising, by count of `THREE.` references:

| File | refs |
|---|---|
| node-city | 490 |
| index.html | 305 |
| ascent-map | 185 |
| pack-opener | 51 |
| dwelling | 49 |
| deck-vault | 36 |
| main-menu | 13 |
| battle-board | 3 |

**Do not bump silently** (brief's explicit instruction). r128's KTX2/meshopt support is not
production-viable, so Phase 4 compression of GLB models genuinely wants a newer version —
but that is a ~1,100-reference change across eight surfaces and needs its own plan.

---

## CORS

Only **`cdn.phototourl.com`** lacks an `Access-Control-Allow-Origin` header. It serves card
art and sprite frames, and its URLs live **in the database, not the repo** (the 4 repo
mentions are comments). jsdelivr, unpkg, cdnjs, esm.sh, gstatic and imgur all send `ACAO: *`.

This is the host that broke unit sprites and is currently worked around by
`/api/art/proxy`. **Migrating that art to R2 removes the proxy hop entirely** rather than
making it permanent — see decision D2.

---

## Classification (brief §0.3)

| Class | Contents |
|---|---|
| **Public / static** → R2, served publicly | card frames, UI, board textures, location art, map tiles, comic pages, GLB models, VFX assets |
| **Private / user-generated** → R2 + signed URLs or Worker | uploaded sprite atelier frames, user card art, `battle-clips` |
| **Must stay** (RLS-bound) | nothing identified — no `createSignedUrl` anywhere today |

⚠ **One policy call, not a technical one:** the `card-art` bucket is `public:true`
(`public/index.html:48801`) but holds **user-uploaded** art. `battle-clips` (`:61050`) has
the same shape. Whether these are "public/static" or "private/user-generated" is Seth's
decision and it changes how they are served after the move.

---

## Recommended order

1. **Compression pipeline first.** Biggest space win, no host dependency, no migration risk.
2. **Finish the Three.js self-host** (mechanical, fixes remaining Tracking-Prevention stalls).
3. **Build the `assetUrl()` seam** and route the ~650 sites through it, grouped by system.
4. **R2 bucket + rclone copy + verify**, then flip the base URL. Copy-then-verify; never delete.
5. **Three.js standardisation** — only if Phase 4 GLB compression is actually wanted.

---

## Note on the brief's assumptions

`MIGRATION_BRIEF` assumes Vite (`import.meta.env.VITE_ASSET_BASE_URL`, `src/lib/assets.ts`).
There is no build step and no bundler here. The abstraction layer has to be a plain global
helper loaded before everything else, and the env var becomes a constant set at deploy time
alongside the existing nine version knobs.
