# 👕 Player Closet — handoff (2026-09-11)

The character creator players use, the Closet Studio clothing is fitted in, and
the one door every future scene takes to draw the player. Everything below is
verified against the branch, not from memory.

## Where things stand

| | |
|---|---|
| Branch | `claude/character-creator-clothing-y2lat6` (pushed) |
| Closet commits | 3 — `612d7d3`, `c48a022`, `836586e` (2,556 insertions, 23 files) |
| New code | `public/src/closet/` — 11 files, 1,786 lines |
| `public/index.html` | +86 lines (Profile field, bridge, two Forge tiles, one admin button, one script tag) |
| ⚠ Base | the branch sits on `449ac97`, the **v121v116 Athena merge, which is not on main**. `origin/main` is stale at `4dbc4f9`. Merging this branch brings 60 commits, of which 3 are the closet. |
| Merged to main | **no** |
| Deployed | **no** — live is still `v121v116`, and the three deploy knobs are **not** bumped |
| Supabase migration | **not applied** — `sql/132_player_closet.sql` |
| Tests | `pw-test20.mjs` — 16 steps, all passing. `pw-test2` / `3` / `19` re-run green |
| Live preview | https://claude.ai/code/artifact/245d6515-4936-4774-bd55-5328c77b390f (the real modules, a rigged Soldier, a seeded catalogue) |
| Working tree | clean |

Reference documentation: `docs/athena-engine.md` → **Player Closet**. This file
is the connection plan.

## What it is

A player picks a **character** (a body) and dresses it: hats, shirts,
backpacks, sneakers, watches, earrings, chains, gloves, scarves. The outfit is
account-wide and shows on the character every Athena hub draws them as. An
admin makes **brands** and **clothing** in the Closet Studio and fits each
piece to the characters by measurement.

| File | Role |
|---|---|
| `index.js` | entry; registers `window.MythicCloset`; `?closet=1`, `?closetstudio=1` |
| `closet.model.js` | the categories (slot, size rule, anchor, camera focus) and the normalisers; the outfit's packet form |
| `closet.rig.js` | **the tape measure** — bone families, per-part measurement, body-aligned sockets, `placeItem`, the camera focus |
| `closet.dress.js` | `dress(THREE, body, outfit, catalog)` — the runtime every scene shares |
| `closet.api.js` | the catalogue: `sql/132` tables ∪ this device (`mythic_closet_v1`) |
| `closet.bridge.js` | the player's side through `MythicBridge.closet` |
| `closet.stage.js` | the shared 3D stage and the camera swing |
| `closet.creator.js` | the Player Closet (players) |
| `closet.studio.js` | the Closet Studio (admins) |
| `closet.character.js` | `spawn` / `replace` — the player's character for any scene |
| `closet.css` | scoped under `#closet-root` / `#closet-studio` |

## The one idea worth understanding: a fit is a ratio, not a measurement

`measure()` walks every skinned vertex, gives it to the bone that owns most of
it, and grows that bone's box. So "the head" is the real head geometry, "the
wrist" is the hand bone's origin with the hand's thickness, "the foot" is foot
plus toe. Bone names are matched by **family**, so `mixamorig:Head`,
`mixamorigHead`, `J_Bip_C_Head`, `head.L`, `hand_l` and `LeftHand` all resolve;
a model with no skeleton gets its parts by human proportion, so every category
still has somewhere to hang.

A fit record then stores **ratios of that part**, never centimetres: `k` (a
watch is 1.05 wrists wide, a hat 1.08 heads), anchor faces (item bottom on head
top; item front on chest back for a backpack), offsets as fractions of the
part, a rotation in the body's own axes. The item hangs in a **socket** — a
group under the bone whose axes stay aligned with the body at rest — so it
follows animation and means the same thing on every rig.

Measured on the three.js Soldier:

| | |
|---|---|
| Height | 183.2 cm |
| Head width | 19.8 cm |
| Left wrist | 3.9 cm |
| Watch as worn (1.05 × wrist) | 4.1 cm |
| Same record on a body 2× the size | 8.1 cm |

That last row is the whole point, and `pw-test20` asserts it.

## Every touch point in `public/index.html`

Five places, all additive — useful when this merges into a tree someone else
has been writing to:

1. **`Profile.closet`** (line ~48545) — `{ outfit, owned }`, the default.
2. **Cloud flags** — `__closet__` beside `__equippedDiceSkin__` in the forge
   JSONB, and the union merge for `owned` where the avatar/sleeve merges are.
3. **Local whitelist** — `if (p.closet …)` beside `p.fuelCommand`. (Three
   lists, as the comment there warns; a field missing from any one is dropped
   on reload.)
4. **`MythicBridge.closet`** (line ~241199) — `signedIn`, `outfit`,
   `setOutfit`, `owned`, `grant`, `balance`, `charge`. `charge` is the only
   money path and goes through `spendGems()` / `spendSovereigns()`.
5. **UI** — the 👕 Player Closet tile (everyone) and 🧵 Closet Studio tile
   (admin) in the Forge Sanctum list, the admin-panel button, and
   `<script type="module" src="src/closet/index.js?v=pc1">`.

Four Athena files changed too: `mapforge.avatar.js` (dresses the character and
can wear the closet body), `mapforge.engine.js` and `mapforge.editor.js` (Play
and `engine.mount` read the outfit), `mapforge.session.js` (hub packets carry
`w`).

## Ship it, in this order

1. **Apply `sql/132_player_closet.sql`** by hand in the Supabase SQL editor for
   `ktsiasyjusesawtrwrjc`. Idempotent, ends with a verify query, ships its RLS.
   Until it is applied the Studio saves to the author's device and says so, and
   nothing else breaks.
2. **Merge the branch.** Remember it carries the whole v121v116 Athena merge,
   not just the closet — review that separately or cherry-pick
   `612d7d3 c48a022 836586e` onto whatever main should be.
3. **Bump the three deploy knobs together** — `public/version.txt`,
   `window.BUILD_VERSION`, `sw.js` `CACHE_VERSION`. They are still `v121v116`;
   the closet did not bump them because it did not deploy. The module busters
   *are* set: mapforge `mf19`, closet `pc1`.
4. **Deploy, then verify the edge with curl** and poll — never the deploy log.
5. **Add the first content** (below). Until an admin does, the closet opens
   empty and says so.

## First real content, day one

The repo ships **no character and no clothing**: `public/models/manifest.json`
has an empty `models` array. So the first session in the Studio is:

1. Upload a rigged `.glb` in Athena's FILES tab (or drop one in `/models/` and
   list it in the manifest — that is the production path, CDN-cached).
2. Closet Studio → **Characters → ＋ New** → name it, pick the model, set scale
   and facing, name its idle clip, tick "In the closet", Save.
3. **Brands → ＋ New** — Plainstock and Nudle are the Watch Dogs 2 reference;
   name, tagline, an emoji logo, a colour.
4. **Clothing → ＋ New** → pick the model, choose the category, press
   **📏 Auto-fit**, nudge Size / Offset / Rotate, set a price, tick "In the
   shop", Save.
5. Change **Fit on** to a second character and confirm the piece re-fits. That
   is the check that the record is portable, and it is the only check that
   matters before publishing a piece.

A rigged human (Mixamo, VRM, Ready Player Me, Rigify, Unreal) is measured bone
by bone. An unrigged mannequin still works, by proportion, but the Studio marks
those parts "(estimated)".

## Wiring the scenes that do not exist yet

The player hub already draws the character. The **courthouse**, the **3D camp**
and the **roguelite's 3D map** take the same one through
`MythicCloset.character`, so it looks identical everywhere because it is the
same body, outfit, measurement and fit. Never add a second avatar loader.

```js
// any scene that has a three.js scene
const me = await MythicCloset.character.spawn(THREE, { scene, follow: true });
me.update(dt, pos, yaw, 'walk');     // each frame: idle | walk | run | interact
me.dispose();

// the roguelite: the train hands over a stand-in, the character takes its place
const me = await MythicCloset.character.replace(THREE, standInObject3D);
me.sync(dt, 'idle');                  // keep following it while the train rolls
me.dispose();                         // the stand-in shows again

// before drawing anything
const { body, outfit, worn } = await MythicCloset.character.describe();
MythicCloset.character.onChange(o => …);   // they saved a new outfit mid-scene
```

`spawn({ player: map.player, world })` lets a map with its own cast win, the
same rule `engine.mount` follows. **`spawn` resolves to `null`** when neither
the map nor the closet names a body, and `replace` then leaves the stand-in
visible — the scene must still draw something, and it, not the closet, knows
what its placeholder is.

## Verifying

```bash
node _synckcheck.mjs                          # index.html — ALL CLEAN
node tools/athena-harness/check-modules.mjs   # every module under public/src/mapforge
node tools/athena-harness/serve.mjs 8765 &    # then:
node tools/athena-harness/pw-test20.mjs       # the closet: 16 steps
node tools/athena-harness/pw-test2.mjs        # engine + live worlds, still green
node tools/athena-harness/pw-test19.mjs       # FILES / MENU / Scene tabs, still green
```

Two environment notes, both sandbox-only:

- The three gauntlet scripts CLAUDE.md names (`comment-scan`, `modcheck`,
  `precommit-scan`) are **not in this checkout** — `.gauntlet/` holds only
  `_forge-harness.mjs`. The harness's `check-modules.mjs` plus
  `node --input-type=module --check` covered the modules instead. The closet's
  own files are not under `mapforge/`, so `check-modules.mjs` does not see
  them; check them explicitly.
- Playwright resolves a Chromium build the image does not have. Set
  `PW_CHROME=/opt/pw-browsers/chromium-1194/chrome-linux/chrome` (pw-test20
  reads it) or symlink the expected revision.

`pw-test20.mjs` needs `tools/athena-harness/three/models/Soldier.glb`:

```bash
curl -sSL -o tools/athena-harness/three/models/Soldier.glb \
  https://raw.githubusercontent.com/mrdoob/three.js/r128/examples/models/gltf/Soldier.glb
```

## Traps that already cost time — do not re-learn these

- **A plain `Object3D.clone()` of a rigged body does not rebind its skeleton.**
  The clone's bones never move it and a measurement keyed on them finds
  nothing. `cloneModel` inlines the SkeletonUtils algorithm — and binds with
  the copied `bindMatrix`, **not** `matrixWorld`: a glTF skin is bound at
  identity, and binding at the mesh's 0.01-scaled world matrix shrank a 1.8 m
  soldier to 4 mm.
- **r128's `BufferAttribute` has no `getComponent`.** Skin weights come off
  `getX/Y/Z/W`. The symptom was a page full of identical rejections and zero
  measured bones.
- **Measure at rest, before any mixer runs.** `dress()` measures synchronously
  at creation for exactly this reason; a rig measured mid-walk puts the wrist
  in the wrong place.
- **A body facing −z has its left at −x.** Right = forward × up. Getting this
  backwards mirrors every paired item and sends the camera through the
  character to reach the wrist.
- **An XHR to a `data:` URL is refused by some hosts' CSP**, and the failure
  looks exactly like a missing file. `loadModel` decodes base64 itself and
  hands the bytes to `GLTFLoader.parse`. This is what broke the first preview.
- **Try-on is not ownership.** The saved outfit only ever carries pieces the
  player owns or that are free; an unowned try-on is dropped on Save and the
  footer says so.

## Known limits, and what comes next

- **Clothing is rigid.** A piece hangs on one bone — right for a watch, a hat,
  a backpack, shoes; a shirt is a rigid vest on the chest bone. Skinned
  clothing that deforms with the body is the next real feature.
- **Cards show the category icon**, not a thumbnail. Athena's asset browser
  already renders offscreen thumbnails (`mapforge.assets.js`); the closet
  should borrow that renderer rather than grow its own.
- **The Studio fits with sliders**, not a gizmo. Sliders are honest about the
  ratios, but a drag handle on the stage would be faster.
- **Clothing stores** are the stated next feature and need almost nothing new:
  a store is a brand's shopfront in a world. The catalogue can already filter
  by brand and `MythicBridge.closet.charge` is the till. What is missing is
  the world-side door — a zone or an interaction that opens the creator
  scoped to one brand. `MythicCloset.open({ cat })` is the shape to extend.
