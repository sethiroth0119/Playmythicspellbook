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

## ⚒ Athena Engine project library

`manifest.json` in this folder lists models the **Athena Engine** map creator offers
under *Library → Models → Project*. Add an entry per file:

```json
{ "models": [
  { "id": "oak_big",   "label": "Big oak",        "url": "/models/oak_big.glb",   "cat": "Nature" },
  { "id": "knight",    "label": "Knight (idle/walk/attack)", "url": "/models/knight.glb", "cat": "Characters", "anims": ["Idle", "Walk", "Attack"] }
] }
```

Files here are **game assets shipped with a deploy**, which is the right home
for anything a mini-game depends on. Dropping a `.glb` straight onto the editor
canvas also works: it is embedded into that map's document (fine for trying
things out; use this folder for production so the map stays small and the
file is cached by the CDN). Animated models keep their clips — pick one in the
inspector.
