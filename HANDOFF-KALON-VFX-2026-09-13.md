# 🌌 KALON CINEMATIC HANDOFF — 2026-09-13

Branch **`claude/practical-rubin-su6622`**, two commits, pushed, **NOT deployed
and NOT seen in a real battle**. Head is `0b68aac`.

The ask was: *"a Kalon cinematic that shows the card frames and shows it
transforming into something different, like it is going through a cosmic
portal — make it look cool and epic like Yu-Gi-Oh Master Duel"*, then
*"so players can still see the board, have it down to about 30%"*.

Read §5 before you touch the file. Those traps are why this took the shape it did.

---

## 1. WHAT SHIPPED

`public/vfx/kalon.html` — the whole cinematic below the CINE KIT was rewritten.
The old one was an ascension (motes converge → column lifts the card → dark
cocoon closes and cracks → breaks → the new form rises). It never showed the
card **becoming** anything: the transformation happened inside an opaque shell,
so the one beat the mechanic is named for was the one beat you could not see.

New beat sheet — **6.45s + 0.4s tail**, inside the host's 7s overlay window:

| beat | d | what happens |
|---|---|---|
| `settle` | 0.45 | the base card slams in, bars drop |
| `rift`   | 1.20 | a hairline tear opens behind it and dilates into a mouth — void core, infalling starfield, three counter-rotating accretion bands, lensing arcs outside the rim |
| `pull`   | 1.00 | gravity wins: the frame shrinks, spins and crosses the horizon, and every mote is now on a line **into** the hole rather than orbiting |
| `warp`   | 1.05 | inside the corridor the frame **flips at the camera**, and each edge-on crossing shows a different face — base, new, base, new — locking onto the new form on the last one |
| `burst`  | 0.75 | the mouth collapses and throws it back out: dark shock first, light second, the old frame in fragments |
| `reveal` | 2.00 | the new form, the closing portal behind it, nameplate wipes in |

**The flip is the whole point.** It is an x-squash of the *same* `CK.card`
call — the frame, its rim light and its cast shadow are continuous through the
swap. That is why it reads as a becoming and not as a cross-fade between two
pictures. If you ever "simplify" it into two separate draws, you lose the effect.

### The two new helpers (kalon-only, NOT in the shared kit)

- `CK.portal(cx, cy, R, k, t, a)` — void, starfield + nebula clipped to the
  disc, three accretion bands, event-horizon hairline, lensing arcs. `k` is
  dilation: 0 is a hairline slit, 1 a full mouth (it drives the x-squash).
- `CK.corridor(cx, cy, k, t, a)` — streaks born near the vanishing point and
  accelerating outward. The inside of the portal.

`set / play / seek` is unchanged, so nothing in the host had to move.

## 2. THE 30% BOARD BUDGET

Second commit. The mouth was eating the board: the void was written as
`0.92 * IK`, i.e. past the ATMO layer's own ceiling and clamped to 1 — as opaque
as that pass can draw — so the middle of the field was a 40%-black disc for four
seconds, on top of a 16% grade and two more pools.

There is now **one budget, `DK`, declared next to the palette**, and every dark
that touches the board is a line in it:

```
vignette flat grade  0.16 -> 0.061      (DK.vig scales the whole helper)
vignette edge radial 0.34 -> 0.129      (corner only, never behind the card)
ATMO pool of dark    0.24 -> 0.100
the void itself      0.40 -> 0.140
HERO tighter pool    0.22 -> 0.060
```

They **multiply, they do not add**: behind the mouth that is
`1 - (0.939 x 0.900 x 0.860 x 0.940) = 0.317`.

🔴 **The number in the code IS the number on the screen.** Both passes are
pre-compensated (`IK` in ATMO, the 0.74 ceiling in HERO), which is the only
reason a budget like this can be reasoned about instead of guessed. Write a dark
as 0.10 and it arrives as 0.10.

**To retune:** change `DK` in `public/vfx/kalon.html`. One place. Then re-measure
(§4) — do not eyeball it.

⚠ **What it cost.** This engine lights the subject by *surrounding it with
dark*, not by making it bright (`CK.ink`'s own comment). A third of the dark is
a third of the local contrast. The answer is **NOT** to push the light back up —
that is the exact knob that re-opens the white screen. Spend it on silhouette,
motion and the accretion ring, which are free.

## 3. WHAT ELSE MOVED

| file | why |
|---|---|
| `public/index.html` | `MECH_VFX_VER` and `_MECH_VFX_STAMP` → `v120t5`; `BUILD_VERSION` → `v121v118`. Nothing else. |
| `public/vfx/fusion.html`, `archon.html` | `VFX_BUILD` stamp → `v120t5-…` only. **They share one version constant with kalon**, and a stamp mismatch is the host's stale-edge self-heal (reload once, then refuse to show the page) — so all three bump together or the other two stop playing. |
| `public/sw.js` | `CACHE_VERSION` → `mythic-v121v118-athena` |
| `public/version.txt` | `v121v118` |

## 4. HOW TO VERIFY IT (this environment)

`node_modules` is **not** installed and `.gauntlet/` **does not exist in this
checkout** — so `comment-scan.mjs` / `modcheck.mjs` / `precommit-scan.mjs` could
not be run this session. `_synckcheck.mjs` needs terser:

```bash
npm i terser --no-save && node _synckcheck.mjs     # ALL CLEAN
```

For the page itself, playwright is installed **globally** (`/opt/node22/lib/…`)
with Chromium at `/opt/pw-browsers/chromium-1194/chrome-linux/chrome`. Serve
`public/` and drive the page deterministically — `KalonVFX.seek(t)` +
`window.__vfxStep(0.016)` renders exactly one frame, so the whole timeline can
be swept headlessly:

```bash
cd public && npx http-server -p 8099 -s . &
# then: goto /vfx/kalon.html, KalonVFX.set({card,unit,name}), seek+step, screenshot
```

Two measurements to repeat after ANY change to this file:

1. **White screen.** Sweep 0 → 6.45 and count pixels with `alpha > 200` and
   every channel `> 235`. Must be **0**. It is 0 today.
2. **Board coverage.** Mean canvas **alpha** per frame = the share of each board
   pixel the overlay takes (light included, not just the dim). Today:
   **23–29% on every beat**, peaking **37.9% for ~0.3s** during the burst flash.
   Multiply by 0.9 for the host's wrap opacity → 34% worst case.

Scratch scripts for both are gone with the session; they are ~30 lines each and
the recipe above is the whole of it.

## 5. TRAPS

- 🔴 **`rAF` in the Browser pane fires at ~0.56 Hz.** Never A/B a rendered frame
  by flipping something and screenshotting. Use `seek` + `__vfxStep`.
- 🔴 **All three pages share `MECH_VFX_VER`.** Bumping kalon alone silently
  kills fusion and archon (stamp mismatch → hide the overlay).
- 🔴 **The CINE KIT is copied verbatim into kalon / fusion / archon.** I changed
  **no** kit function — the dim was re-budgeted at the kalon **call sites**, and
  `CK.vignette` was scaled by passing a smaller `k`. Keep it that way or the
  three pages diverge.
- ⚠ **`set()` skips null keys**, and the page ships placeholder art so it can
  initialise. A null slot therefore leaves the PLACEHOLDER on screen. The host
  passes `_VFX_BLANK_PX` instead of null for exactly this reason.
- ⚠ **The host's payload for kalon**: `card` = the pre-transform base card,
  `unit` = the Kalon body (`_vfxUnitImage(…, {noBase:true})`, falling back to
  its card face). The flip depends on those two being *different* images — if a
  Kalon has no art of its own, the transformation flips to the same picture.
  The host already toasts "upload a Kalon Image in the Forge" in that case.
- ⚠ `blob:` URLs cannot cross into the iframe; the host converts to `data:`.
  Don't add a path that passes one through.

## 6. NOT DONE / NEXT

1. **Never run in an actual battle.** Every frame in this handoff is the page
   driven standalone with stand-in SVG art. First job: play a real Kalon
   transform and check the two art slots land (see §5), and that the effect
   still reads when the overlay is clipped to a short, wide `.board-area`
   rather than a 16:9 window.
2. **Not deployed.** `version.txt` / `BUILD_VERSION` / `sw.js CACHE_VERSION` are
   already bumped together to `v121v118`, so it is deploy-ready — but verify the
   EDGE with curl, never the deploy log, and poll: PoP propagation takes a
   couple of minutes.
3. **The gauntlet scans never ran** (§4). Run them wherever `.gauntlet/` lives
   before this is considered gated.
4. **No PR opened.** Nobody asked for one.
5. If 30% is wrong on a real board, it is one constant: `DK` in
   `public/vfx/kalon.html`.

## 7. PREVIEW

A standalone screening page — the deployed cinematic byte-for-byte, plus a
transport, a beat rail whose segment widths are the real beat durations, and two
stand-in card pairs:

**https://claude.ai/code/artifact/0a04e8df-3f84-455e-a480-d0edb9df3650**

It is rebuilt by concatenating `head` + `fx-core.js` + the kalon inline script +
`tail` — so if the cinematic changes, the preview has to be regenerated from the
file, it does not track it.
