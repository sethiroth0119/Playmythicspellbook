# 🧊 3D models

## `lab/` — the containment lab's characters

Two GLBs, and the **only** models in this repo that ship in the deploy bundle
(everything else here is gitignored and served from the Supabase `models`
bucket — see `public/.assetsignore`). They are exempt because they are a
fixture every player gets and because they are tiny:

| File | Who | Size | Clips |
|------|-----|------|-------|
| `lab/researcher.glb` | SCP Researcher — you, unsuited | 0.64 MB | walking + running |
| `lab/sentinel.glb`   | Hazard Sentinel — you, once the suit seals | 0.67 MB | walking + running |

**The model IS the suit read-out.** `/src/biolab/scene.js` swaps between them
the moment the fourth seal closes; there is no icon or colour change doing that
job. Walk and run crossfade on real speed, and a sealed suit moves at
`SUIT_SPEED` (0.72), so the suited character settles into the walk cycle — the
suit protects the batch and costs you mobility, and the animation is the
readout for it.

If a character walks backwards, the whole fix is `MythicBioLab._setModelYaw(Math.PI)`
(live) then the `MODEL_YAW` constant in `scene.js`. Same idea as the `ry` field
on the Card Shop stations below.

### Re-exporting these

The uploads were four files (walk + run per character) totalling **30 MB**, 95%
of which was one 2048px PNG each. They were merged per character and the
texture recompressed to 1024px WebP, giving 1.31 MB for both. If you re-export,
do the same or move them to the Storage bucket — a single asset over 25 MiB
aborts the entire Cloudflare deploy, which has frozen production before.

---

# 🏬 Card Shop 3D models

Drop `.glb` files here and they auto-load into the walkable Card Shop. Each one
**falls back to the built-in procedural geometry** if the file is missing or fails
to load — so the shop never breaks while you swap assets in one at a time.

## Expected filenames (served from `/models/...`)

| File | What it is | Station view |
|------|------------|--------------|
| `shop_room.glb`       | the whole room shell (floor/walls/ceiling) | — (hides the procedural shell) |
| `shopkeeper.glb`      | the NPC vendor (faces the player automatically) | — |
| `my_shop.glb`         | your storefront counter | `myshop` |
| `binder_table.glb`    | the binder table | `binder` |
| `pack_shelf.glb`      | the open-packs shelf | `open` |
| `notice_board.glb`    | the player-shops notice board | `browse` |
| `vendor_counter.glb`  | the buy-packs-with-Aza counter | `vendor` |

## Model conventions (.glb)

- **Y-up**, units in **meters**.
- **Origin at the base** (feet/bottom on the floor at y=0).
- **Front faces +Z** (toward the player spawn). Tune per model with the `ry`
  (rotation, radians) field on its station in `CS_STATIONS` / `CS_NPC_MODEL`.
- Scale to taste with the `scale` field.
- Keep them small (Draco-compress if heavy) — they load over the network at runtime.

## Where to tune

In `public/index.html`, search for `CS_STATIONS`, `CS_NPC_MODEL`, `CS_ROOM_MODEL`.
Each station has `x, z` (position), `ry` (facing), `scale`. The label + accent glow
are kept automatically; only the geometry is swapped for your model.

Free model sources: Quaternius, Poly Pizza, Kenney, Sketchfab (download as `.glb`).
