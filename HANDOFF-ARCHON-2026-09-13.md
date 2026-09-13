# ⚒ ARCHON CINEMATIC HANDOFF — 2026-09-13

**Branch** `claude/sweet-noether-r2tleu` · pushed, working tree clean, 2 commits
ahead of the Athena merge (`449ac97`)
**Version knobs** bumped to `v121v118` · **NOT DEPLOYED** — see §2.1
**Gates** `_synckcheck` ALL CLEAN · `_archonvfx_smoke` PASS · `_archonbackdrop_smoke` PASS

The job: *"Create me an Archon Cinematic that will show the card frames and show
it going through a ritual and then the new Archon falls out of a cosmic Portal…
make this look cool and epic like Yugioh Master Duel"*, then *"replace the
background … so players can still see the board, have it down to about 30%"*.

Preview (playable, scrubbable by beat, with a stand-in battlefield behind it):
<https://claude.ai/code/artifact/a7912202-1fb7-4ba0-b19d-0cfd9fd83c29>

Read §3 (Traps) before you touch the file. Three of them cost real time here.

---

## 1 · What shipped

`public/vfx/archon.html` — the Archon summon cinematic, restaged. Same file,
same URL, same `set / play / seek` contract, same `ArchonVFX` global. The host
needed three changed characters to pick it up.

### 1a. The beats

| beat | dur | what happens |
|---|---|---|
| `frames` | 0.95s | the tribute CARD FRAMES fly in off the side they belong to and fan into a shallow semicircle around the sigil |
| `ritual` | 1.40s | the sigil ignites, a tether binds each card to the centre, the cards burn bottom-up (outer tributes first, centre last), the offering climbs as embers |
| `portal` | 0.95s | a cosmic portal tears open overhead: ink event horizon, three logarithmic arms under differential rotation, accretion rim, bolts crawling it, a shaft down to the floor |
| `fall` | 1.00s | the Archon drops through on `p²`, occluded by the core for the first frames, afterimages trailing, shadow rushing up the floor |
| `land` | 2.00s | impact rings, debris, the dolly-zoom payoff, standing light, god-rays, nameplate |

**6.30s + 0.4s tail**, inside the host's 7000ms overlay window. `D.total` is the
single source of truth — `play()` resolves off it and so does the preview.

### 1b. Why the previous staging went

The old beats (`gather/offer/gate/descend/reveal`) played the tributes as
**bodies standing on shadows**, so the thing being spent never read as a CARD —
which is the only part of the rite the player actually chose. And the "gate" was
an accretion rim plus a shaft with *nothing behind them*, i.e. a glow in the air
rather than a hole. The portal is now built dark-first, which is what lets the
Archon be genuinely occluded by it.

### 1c. The backdrop budget (the second request)

One knob, **`BACKDROP = 0.30`** (`archon.html:598`), caps everything that merely
OBSCURES the battlefield. Under it:

- the full-frame vignette grade — `CK.vignette(…, darkK * VIG_K)` @ `:797`
- the dark pool under the sigil — `CK.ink(…, 0.24 * IK * VIG_K, …)` @ `:798`
- the letterbox bars — `ctx.globalAlpha = BARS_A` @ `:1105`

**NOT under it, deliberately:** the portal's event horizon, the impact shock
rings, the Archon's cast shadow. Those are also black, but they are the EFFECT —
objects in the shot, local to themselves. Dimming them dims the cinematic
instead of revealing the board.

Measured (`node _archonbackdrop_smoke.mjs`), share of board hidden:

| probe | now | before |
|---|---|---|
| vignette edge | 10 – 22% | ~45% |
| ink field | 0 – 20% | ~45% |
| bar strips | 19 – 30.2% | 45 – 70% |

Worst case across the whole runtime is **30.2%**, at 1.6s.

---

## 2 · What is unfinished, in the order I would do it

### 2.1 DEPLOY — nothing is live
The three knobs are bumped together and committed (`public/version.txt`,
`window.BUILD_VERSION` @ `index.html:39410`, `CACHE_VERSION` @ `sw.js:414`, all
`v121v118`) but **no deploy was run from this session.** Until it is, players
still get the old cinematic.

Per CLAUDE.md: verify the EDGE with `curl`, never the deploy log, and **poll** —
propagation across PoPs takes a couple of minutes. The two things to confirm are
`version.txt` reading `v121v118` and `/vfx/archon` serving a page whose
`VFX_BUILD` is `v120t6-archon`.

### 2.2 The Kalon question — OPEN, one line if the answer is yes
The brief said *"we will replace the Kalon cinematic we have now with this one"*,
but everything described — card frames, tributes, a ritual, a new Archon — is the
ARCHON tribute summon, so that is what was replaced. Kalon is a *transform*
(one base card ascending into its higher form) and a tribute-ritual-plus-portal
staging is wrong for it.

If they did mean Kalon should also play this, it is `_MECH_VFX_FILE.kalon` at
`index.html:172352` plus the matching stamp at `:172362`. **Ask before doing it** —
`_vfxPayloadFor('kalon', …)` sends `card`, not `tributes`, so the ring would draw
one empty frame and the rite would have nothing to consume.

### 2.3 A supplied backdrop image
They wrote *"replace the background with this here"* and nothing attached. If an
image or colour turns up, it belongs behind the whole frame, at `BACKDROP`
strength, in the ATMO layer just after `CK.vignette` @ `:797`. Do not raise
`BACKDROP` to make it read — that is the knob the whole §1c measurement is
against.

---

## 3 · Traps

### 3.1 🔴 The CINE KIT is copied VERBATIM into kalon / fusion / archon
`archon.html:41–566` is shared code. `CK.vignette` / `CK.ink` / `CK.bars` /
`CK.card` / `CK.hero` / the stencil helpers all live there.

**The backdrop budget is applied where those helpers are CALLED, never inside
them.** Edit a kit body to "fix" the dimming and you silently fork this page from
the other two, and the next person to copy the kit across quietly undoes it. Both
helpers take a linear strength argument; that is why this was possible at the
call site at all.

### 3.2 🔴 Two scrims COMPOUND — the bars do not get the whole budget
The vignette is strongest exactly where the bars sit. Bars at a full `0.30` over
a `0.23` grade hide **45%** of the board, not 30% — measured; it was the one
place this overran. `BARS_ON_BOARD` (`:612`) solves for what the grade left,
about a tenth, and the gold hairline is redrawn at full strength (`:1109–1119`)
so the frame still reads as letterboxed rather than as a grey band.

Also: the bars are scaled with `globalAlpha`, **not** with `CK.bars`'s `k`
argument. `k` drives their HEIGHT as well as their wipe, so scaling it makes them
thinner — and thin opaque bars hide just as much board.

### 3.3 🔴 Measuring the scrim: the two ways to get a confident wrong number
`_archonbackdrop_smoke.mjs` runs with an **empty payload** and probes **points**,
and both are load-bearing:

- With art in the slots, the placeholder faces contain their own near-black
  shapes. A naive "count the dark pixels" read returned **74%** when the real
  scrim was 22%.
- Even empty, the page still draws black OBJECTS — the empty card body
  (`#0d0a16` @ 0.92), the nameplate slab, the event horizon, the impact rings.
  Those are exempt by design, so the probes sit where only scrim can ever be.
- Pixels **with colour** (max channel > 24) are LIGHT, not scrim, and must be
  skipped. An earlier pass that forgot this at the ink probes reported a 38.8%
  spike during the fall that does not exist — it was the portal shaft lighting
  the probe points.

### 3.4 🔴 rAF is ~0.56 Hz in the agent browser pane
Do not "let it play and screenshot" — you will sample three frames out of six
seconds. `fx-core` exposes `window.__vfxStep(dt)` for exactly this: seek, force
ONE deterministic frame, read the canvas. Both smoke files do it that way.

### 3.5 🔴 A mismatched stamp is treated as a stale edge copy
`window.VFX_BUILD` (`archon.html:12`) must EXACTLY equal
`_MECH_VFX_STAMP.archon` (`index.html:172362`). Presence is not enough — a
cached page from an older deploy carries *a* stamp. On a mismatch the host
reloads once and then **hides the overlay entirely**, which looks like "the
cinematic silently stopped working". Change the page → bump both.

### 3.6 The white-screen guarantee is a measurement, not a vibe
`ATMO = 0.40` / `HERO = 0.74` and the mid-frame `seal()` are the structural fix
for the white screen. The gate is: **no pixel at alpha > 200 AND luminance >
200**, with all four art slots filled. `_archonvfx_smoke.mjs` asserts it. Raising
either constant to make the effects "feel less thin" is the exact knob that
reopens the bug — write brighter INSIDE the layer (that is what `LG = 2.1` is
for) instead.

---

## 4 · This environment, specifically

Three things in this checkout are not what CLAUDE.md describes. None are mine and
none are fixed:

- **`.gauntlet/` is nearly empty** — only `_forge-harness.mjs`. `comment-scan.mjs`
  and `modcheck.mjs` are absent, so those two gates could not be run. I checked
  the equivalents by hand: comment markers balance (103/103) and the page parses.
  No ES modules under `public/src` were touched.
- **`npm ci` fails** on lockfile drift that predates this work — `cannon-es`
  missing, `meshoptimizer` 1.0.1 vs 0.25.0, `playwright` 1.63.0 missing. I
  installed `terser` and `playwright` with `--no-save` rather than touch the
  lockfile. The two smoke files need `playwright` present.
- **Chromium** is at `/opt/pw-browsers/chromium-1194/chrome-linux/chrome`, not
  the path Playwright picks by default. Both smoke files probe for it and honour
  `CHROMIUM_BIN`. Never run `playwright install`.

---

## 5 · Commands

```bash
node _synckcheck.mjs                                   # index.html — NOT build.mjs
PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers \
  node _archonvfx_smoke.mjs [outDir]                   # plays it; gates white-wash
PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers \
  node _archonbackdrop_smoke.mjs [budget]              # how much board survives
```

Both smoke files exit non-zero on failure, so they drop straight into a gate.
