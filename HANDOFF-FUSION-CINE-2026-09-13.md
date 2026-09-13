# 🌌⚡ FUSION CINEMATIC HANDOFF — 2026-09-13

Live at **v121v118** on branch `claude/wonderful-gauss-3fmz6c` (2 commits:
`081b893` the rebuild, `5040e12` the 30% backdrop). **No PR opened** — the user
has not asked for one.

The Polycreation fusion summon was rebuilt from scratch so it shows **the card
frames being fused**. The old one never did. Read §4 (Traps) before you touch
any of it; two of the four will cost you an afternoon.

**There is one open item and it is not code: the backdrop artwork is missing.**
See §5.

---

## 0. WHAT WAS ASKED, AND WHAT SHIPPED

> *"Create me a fusion Cinematic that will show the card frames and them fusing
> together. We will replace the fusion cinematic we have now with this one make
> this look cool and epic like Yugioh master dual"*

> *"replace the purple background with this here for a opacity background so
> players can still see the board have it down to about 30%"*

Both are done. The sequence runs 6.2s and looks like this:

| Act | Starts | What happens |
|---|---|---|
| Fan | 0.00s | Material cards fly in from off-screen with their real card art, land on an arc over a hex summoning lattice, each glowing in its element colour |
| Charge | 0.85s | They hold long enough to read every name plate, breathe, then fire energy tethers into the vortex |
| Spiral | 2.60s | The vortex takes them one at a time — each frame tumbles inward, yawing and shrinking, until swallowed |
| Detonation | 3.53s | Core collapses to a point and blows out: white flash, three staggered shockwaves, camera shake, pillar of light |
| Reveal | 3.78s | The fused Kalon flips face-up out of the flash and slams forward against god-rays, name bursting underneath on a gold rule |

Playable preview (art and card illustrations are stand-ins, everything else is
the shipped code): <https://claude.ai/code/artifact/7d60fece-d420-484d-b626-ab46ec2eb9d0>

---

## 1. WHERE IT LIVES

Everything is in `public/index.html`. Nothing new was added under
`public/src/` — this replaces an existing battle system in place rather than
adding a top-level one, so CLAUDE.md's "new features go in `public/src/`" rule
does not apply here.

### CSS — one block, `fcx-` prefixed

| What | ~Line |
|---|---|
| Block header comment (read it first) | 10427 |
| `.fcx-root` — the overlay | 10449 |
| `.fcx-bg` — the 30% backdrop plate | 10472 |
| `@keyframes fcx-card-life` — the whole card choreography | 10572 |
| `prefers-reduced-motion` block | ~10853 |

It sits **between** `@keyframes poly-name-burst` and the Archon block at 10859.

### JS — six functions, contiguous

| Function | ~Line | Job |
|---|---|---|
| `FCX_TOTAL_MS` (const, 6200) | 163855 | The one timing number the CSS is authored against |
| `_fcxMaterials(fm, s)` | 163862 | `fm.materialUnitIds` → drawable `{name, cardId, icon, element}` |
| `_fcxAura(element)` | 163888 | Element → glow colour, via `ELEMENT_DATA` |
| `_fcxFrameHtml(mat)` | 163899 | One gold card frame: art, name plate, foil sheen |
| `_fusionCineMount(fm, kalon, spellCard)` | 163914 | Builds the overlay, appends to `document.body`, returns ms to wait |
| `_fusionCineUnmount()` | 164041 | Fades it out and drops it |
| `renderPolycreationCinematic()` | 164053 | **Stub returning `''`** — kept only so the `renderBattle` call site at 159817 is unchanged |

Driven from the `poly-confirm` click handler at **~163346**.

---

## 2. 🔴 THE ONE ARCHITECTURAL DECISION

**The overlay is mounted on `document.body`. It is NOT returned as HTML from
`renderBattle`. Do not move it back.**

The old cinematic lived inside `renderBattle`'s HTML string and was advanced by
a phase counter that called `renderBattle()` four times. Every one of those
calls rebuilt the overlay's DOM, which **restarts every CSS animation inside
it**. Nothing could move continuously across a phase boundary. That is the
entire reason the previous version could only ever be a loop of pulsing rings,
and why it never showed the materials at all — the cards existed only as a name
in the modal you had just dismissed.

`_fusionCineMount()` appends once to `document.body`, where nothing in the
render tree can reach it, so a single timeline plays start to finish.

`App.ui.polyCine` is still set for the whole run — `_anyCinematicActive()`
(line 176939) reads it to hold the AI back until the animation finishes, and
`.fcx-root` was added to that function's DOM selector list too.

---

## 3. WHAT WAS DELIBERATELY LEFT ALONE

**The Archon summon ritual.** It still uses the separate `.poly-cine-*` overlay
(CSS at 10859, render function around 163566). It shares none of the `fcx-`
code. If you are changing `poly-cine-*` rules you are working on Archon, not
fusion — check which one you actually mean.

**`renderPolycreationCinematic()`'s call site.** Left in place at 159817 so the
`renderBattle` diff stays at zero. The function is a stub.

---

## 4. ⚠ TRAPS

Four things that were found the hard way. Each one shipped as a bug first.

### 4.1 Opacity on the root fades the cards too

The 30% belongs on `.fcx-bg`, the backdrop plate. Putting it on `.fcx-root`
fades the material frames and the revealed Kalon along with the backdrop —
which are the entire point of the cinematic. `.fcx-root` is
`background: transparent` on purpose.

### 4.2 `scale()` does not scale a `translate3d` offset

`--cs` (viewport) and `--cc` (material count) are multiplied into `--sc`, and
**every** `--tx`/`--ty` in `fcx-card-life` is multiplied by `--sc` as well. The
first version only scaled the sprite, so on a phone the cards shrank and still
fanned out past both screen edges. If you add a keyframe that positions a card,
it needs the same treatment.

### 4.3 Fan geometry comes from the card WIDTH, not from eyeballing

A card is 132px wide. The horizontal reach of the arc is roughly
`sin(spread/2) × radius`, and the numbers in `_fusionCineMount` keep ~150px
between neighbours. **A 2-material fusion needs the WIDEST radius** (260 vs 170)
because it has the narrowest fan angle — that is not a typo, it is the special
case. Verified at 2, 3 and 5 materials.

### 4.4 Layer order decides whether you can see the card

The light pillar was originally mounted after `.fcx-stage` and painted straight
over the revealed card, washing its face out to grey. It now sits before the
stage. The god-rays carry a radial `mask-image` for the same reason — solid
bars ran under the card and made it look like it was sitting on a pinwheel.
**If the reveal ever looks washed out, check the DOM order in
`root.innerHTML` before you touch any colour.**

---

## 5. 🚧 OPEN — THE BACKDROP ARTWORK

The user supplied a piece of art (a cosmic rift over floating islands, cool
blue on the left, molten red on the right) to be the backdrop at 30%. **It was
attached in chat as an image, not committed, so it is not in the repo.** It
could not be written to disk from that session.

**To finish this:** drop the file at

```
public/assets/background/Backgrounds/fusion-cine-bg.png
```

and it picks up with **no code change**. A different name or format is one line
— `--fcx-bg-src` on `.fcx-root` (line 10466).

Until then the shipped fallback carries the layer: the gradient is painted
*under* the image inside the same 30% plate, so a missing or still-loading file
leaves a void rather than nothing, and can never dim the board more than the
real art would. It looks fine. It is just not the art that was asked for.

---

## 6. HOW IT WAS VERIFIED

- `node _synckcheck.mjs` — clean. **Needs `npm install --no-save terser`
  first** in a fresh container; it is not in `package.json`.
- `.gauntlet/comment-scan.mjs` and `.gauntlet/modcheck.mjs` **do not exist in
  this checkout** — `.gauntlet/` contains only `_forge-harness.mjs`. CLAUDE.md
  says to run both. The markup was checked by hand instead (comment markers
  balanced in the inserted block). If you restore those scripts, run them.
- Playwright, against a local harness that loads the real extracted CSS and JS:
  2, 3 and 5 materials at 1280×800 and 390×844, plus the 30% backdrop over a
  deliberately bright test board.
- Version knobs bumped together on both commits: `public/version.txt`,
  `window.BUILD_VERSION`, `sw.js CACHE_VERSION` → **v121v118**.

**Not verified:** nothing has been deployed or edge-checked. The change is on
the branch only.

### Reproducing the harness

There is no committed harness — it was built in the session scratchpad and is
gone. To rebuild one: serve a page that defines `escapeHtml`, `ELEMENT_DATA`,
`App.state.units`, and `_polyArtSrc`, then paste in the `fcx-` CSS block and the
six functions and call `_fusionCineMount(...)` directly.

🔴 Per CLAUDE.md, the Browser pane's `requestAnimationFrame` fires at about
**0.56 Hz**. That did not bite here because the whole cinematic is CSS
animations, which the compositor runs regardless — but if you add anything
rAF-driven to this sequence, it will.

---

## 7. IDEAS NOT TAKEN

Deliberately left undone, listed so they are not re-derived as new:

- **Audio.** The existing `_muffleBattleAudioForUlt()` ducking is kept, but no
  new cue was added. A whoosh on the fan, a riser through the charge and an
  impact on the detonation would land; there was no brief for it.
- **Per-element vortex tint.** The core is fixed violet/gold. Tinting it toward
  the dominant material element is cheap and was skipped for consistency.
- **A skip control.** The sequence is 6.2s every time and cannot be skipped.
  Worth adding if players complain — the resolve is a single `setTimeout` at
  ~163374, so an early-out is straightforward.
