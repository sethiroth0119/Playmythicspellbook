# 🌌 EVO UNIT CINEMATIC HANDOFF — 2026-09-13

Branch **`claude/lucid-keller-fbfnsh`**, two commits, pushed, **no PR opened**.
Deploy knobs bumped to **v121v117** but **NOT DEPLOYED** — see §6.

The ask: *"Create me a Evo Unit Cinematic that will show the card frames and
show it going through a evolution like a cosmic big bang and then show the new
form. We will replace the Kalon cinematic we have now with this one."* Then:
*"replace the background … for a opacity background so players can still see the
board have it down to about 30%."*

Preview (playable, scrubbable):
<https://claude.ai/code/artifact/ec26247f-c89c-48d2-918e-754863466bce>

Read §5 (Traps) before you touch the draw loop. Every item there cost real time.

---

## 1. WHAT SHIPPED

| | |
|---|---|
| `public/vfx/evo.html` | **NEW.** 1063 lines. The cinematic. |
| `public/index.html` | 5 constants + comments rewired, `BUILD_VERSION` |
| `public/sw.js` | `CACHE_VERSION` |
| `public/version.txt` | v121v117 |

`public/vfx/kalon.html` is **kept on disk, unreferenced**. Nothing loads it any
more. It is the previous look, one constant away from coming back (§3).

### The six beats — 6.45s + 0.4s tail, inside the host's 7s window

| Beat | Length | What happens |
|---|---|---|
| `frames` | 1.00s | the card frame traces itself on around the base card |
| `charge` | 1.15s | the line work energises; motes streak inward |
| `collapse` | 0.70s | frame + card dragged into one point; accretion disc; the inward snap |
| `bang` | 0.90s | gold nucleus, three shock fronts, 150 stars and 15 nebula clouds born outward |
| `forge` | 0.85s | the new frame draws itself out of the blast |
| `reveal` | 1.85s | the new form rises inside it; the base card burns off above it; plate wipes in |

The strip in the preview artifact is scaled to these real durations.

---

## 2. HOW IT IS WIRED — the kind is still called `kalon`

🔴 **`kind: 'kalon'` drives the whole battle flow and was deliberately NOT
renamed.** Renaming it would touch every call site for zero player-visible gain.
It just mounts a different page now. One call site:

```
public/index.html:173091   playKalonTransformVfx() → _playMechVfx('kalon', …)
```

Five constants moved together. **They must stay in sync or the cinematic
silently does not play** (§5, trap 1):

```
172358  _MECH_VFX_FILE.kalon   = 'vfx/evo'          // extensionless on purpose
172359  _MECH_VFX_API.kalon    = 'EvoVFX'
172362  MECH_VFX_VER           = 'v120u0'           // cache-buster query param
172368  _MECH_VFX_STAMP.kalon  = 'v120u0-evo'       // must EQUAL the page's stamp
172471  out.eyebrow            = 'EVOLUTION'        // was 'ASCENDED FORM'
```

And in the page: `public/vfx/evo.html:14` → `window.VFX_BUILD="v120u0-evo"`.

The page publishes **both** names:

```js
window.EvoVFX = window.KalonVFX = { set, play, seek, duration };
```

`KalonVFX` is the safety net — if anyone re-points the API table at the old
name, the page still answers instead of logging `[vfx] kalon API not present`
and showing nothing.

Payload contract is unchanged from the Kalon page (`_vfxPayloadFor`):
`{ name, eyebrow, unit, card }` — `unit` is the NEW form's art, `card` is the
pre-transform base card. The host's streaming-art retry, the blank-pixel
fallback and the "no Kalon art" toast all still apply untouched.

---

## 3. THE TWO KNOBS — where to turn the dial

Both near the top of the page's own section, with the measurements in the
comment. **This is the entire tuning surface for "can players see the board".**

```
public/vfx/evo.html:590   var BACKDROP = 0.48;   // scales EVERY dark thing
public/vfx/evo.html:594   var BAR_A    = 0.68;   // the letterbox specifically
```

`BACKDROP` multiplies the vignette and both ink pools. `BAR_A` exists separately
because at the kit's own 0.94 the letterbox blacks out the top and bottom 7.5%
of the board outright — on this board that is where units stand.

⚠ **They scale the DARK only.** Card, hero art, nameplate and every light are
untouched. Dimming those is what makes an overlay look washed out rather than
transparent, and it is why the host's wrap opacity is a ceiling and not a
dimmer. Neither knob touches `ATMO`/`HERO`, so turning them can only move the
frame further from the white-wash threshold, never toward it.

### Measured, not guessed

Method: load the page over a flat bright board (`#6a7fb8`), screenshot with the
canvas hidden and again with it visible, compare mean luminance per annulus.
Numbers are the fraction of the board's brightness **removed**:

| | outer field | mid | centre |
|---|---|---|---|
| before the knob | 30% | 25% | brighter (the card and its light) |
| **now** | **21%** | **17%** | brighter |
| old `vfx/kalon.html`, same method | 28–31% | 12–25% | brighter |

To re-measure after a change, that harness is worth rebuilding — it is ~40 lines
of Playwright and it is the only way this question has an answer instead of an
opinion.

### To revert to the old look

`_MECH_VFX_FILE.kalon = 'vfx/kalon'`, `_MECH_VFX_API.kalon = 'KalonVFX'`,
`_MECH_VFX_STAMP.kalon = 'v120t3-kalon'`. Nothing else.

---

## 4. WHAT IS NOT DONE

1. **🔴 NOT DEPLOYED.** The three knobs are bumped and committed; no deploy has
   run and nothing has been edge-verified. Whoever deploys must verify at the
   EDGE with curl and poll — the deploy log is not evidence (CLAUDE.md).
2. **🔴 NEVER SEEN IN THE REAL GAME.** Every frame in this handoff was rendered
   against a synthetic board. Nobody has watched a Kalon transform actually fire
   in a battle with this page mounted. That is the first thing to do.
3. **No PR.** Not asked for.
4. **The owner asked for a real board image behind the preview.** They picked
   "use the real game board behind the preview" and no screenshot arrived — the
   message referenced an image (*"replace the background with this here"*) that
   did not attach. The preview currently uses a stand-in with two ranks of unit
   markers. Ask for a battlefield screenshot and drop it in behind the canvas.
   I could not produce one: the app needs Supabase auth to reach a battle, and
   the repo's `*_smoke.mjs` suites analyse source text in a `vm`, they do not
   render.
5. **Sound.** `playSfx('kalonTransform')` still fires at `index.html:173091`.
   It was written for a cocoon-and-shell-break, not a big bang. Nobody has
   listened to it against the new beats.

---

## 5. TRAPS

1. **The stamp is a hard gate, and a mismatch shows NOTHING.** `_playMechVfx`
   compares `ifr.contentWindow.VFX_BUILD` against `_MECH_VFX_STAMP[kind]`. Not
   equal → it reloads once, then hides the overlay and returns. So if you edit
   `evo.html` and bump its stamp without bumping `_MECH_VFX_STAMP.kalon`, the
   cinematic stops playing and the only trace is one `console.warn`. This is
   deliberate — it is how a cached page from an older deploy was caught still
   playing — but it will catch you first.

2. **Dark drawn over the blast turns it into a grey donut.** The ink pool is
   centred on exactly the pixels the explosion occupies. The first cut left it
   on across `bang` and the biggest moment in the cinematic rendered as a dull
   ring on black. There is now an `inkK` ramp that pulls the pool back across
   the bang and returns it for the forge. Do not "simplify" it away.

3. **Draw order inside the ATMO pass is load-bearing.** The core and shock front
   go ON TOP of the starfield. Drawn first (as they were), every nebula cloud
   was still at radius ~0 and stacked a violet blob straight over the nucleus —
   the hottest frame of the cinematic came out a cold purple ball. The nebula
   also needs its base radius (`0.055 * U`) so the clouds leave from a shell
   instead of the origin.

4. **A payoff that fades the blast to zero is a card on black.** The star/nebula
   fade has a **floor** (`Math.max(0.34, …)`), not a fade-out. Round 1 deleted
   the cosmos it had just created, halfway through the beat that was supposed to
   pay it off.

5. **`_synckcheck.mjs` DOES NOT RUN in a fresh web session** — it imports
   `terser`, which is not installed, and `.gauntlet/` here contains only
   `_forge-harness.mjs` (no `comment-scan.mjs`, no `modcheck.mjs`, no
   `precommit-scan.mjs`, despite CLAUDE.md). What I ran instead: extract every
   `<script>` block that is not `type=importmap` from `index.html` and
   `evo.html` and `new Function()` each one. All pass. **If you have a machine
   with the deps, run the real gates before deploying** — I could not.

6. **Headless Chromium renders these pages fine.** CLAUDE.md's 0.56 Hz rAF
   warning is about the Browser pane, not Playwright. `seek(t)` + a ~140ms wait
   gives a deterministic frame because the rAF loop keeps drawing frozen time,
   and `fx-core.js` also exposes `window.__vfxStep(dt)` for one hand-driven
   frame. Chromium is at `/opt/pw-browsers`, the playwright package at
   `/opt/node22/lib/node_modules/playwright` — do not run `playwright install`.

7. **The page is 2D canvas with zero WebGL contexts, on purpose.** That is what
   makes the anti-white behaviour GPU-independent. Do not introduce Three.js
   here however tempting the "cosmic" brief sounds.

---

## 6. VERIFICATION ACTUALLY PERFORMED

- Every inline script in `index.html` and `evo.html` parses (§5 trap 5).
- `play()` resolves at **6.97s**, inside the host's 7000ms fade, with **no
  console output at all** — no `[fx]`, no `[vfx]`, no page errors.
- Payoff frame: **max alpha 189**, under the 200 white-wash threshold with
  margin, at 100% frame coverage.
- Backdrop dim measured per beat and per annulus (§3).
- Frames inspected at every beat, over a board stand-in carrying ten unit
  markers: the markers stay legible through all six beats.

Not performed: any real gate, any deploy, any play in the actual game.

---

## 7. THE ONE THING WORTH CARRYING FORWARD

The brief said *"so players can still see the board,"* and the instinct is to
reach for opacity. Measuring first said the grade was **already** at ~30% and
the real offender was the letterbox, which is 94% opaque over the two strips of
board where units stand. A knob plus a number beat a guess plus a slider — and
the number is now in the comment next to the constant, so the next person
changing it starts from evidence instead of from scratch.
