# DESIGN BAR — the Ruin Ledger look

> **Read this first.** This file is the QUALITY BAR for the theme pass. It exists
> because the reference material is a set of screenshots that live in one
> conversation and **cannot be handed to a subagent**. An agent with fresh
> context cannot see them. So the bar is written down here instead, in enough
> detail to be judged against, and every critic compares a real rendered
> screenshot to THIS FILE.
>
> 🔴 **BE HONEST ABOUT WHAT THAT COSTS.** A written bar is weaker than a
> side-by-side with the image. It can be read too loosely ("it's dark and gold,
> ship it") and it cannot capture proportion, weight or rhythm the way a picture
> does. Where a rule below is a *measurement* it is written as one, so a critic
> can fail a screen on a number rather than on taste. Where it is taste, it says
> so. Do not report a screen as matching the bar when what you mean is that it
> did not obviously clash.

---

## 0. What this pass is, and what it is NOT

Several screens ALREADY hit the bar — Bank of Ethos, Camp, The Market, Tutor
Shop, Black Market, Wager Hall, Cashout Vault, City Hall, Crash/Exchange, the
Foundation Reserve node map, Just Business Vault. The references are those
screens. **This is a CONSISTENCY pass, not a redesign.** The job is to find the
screens that have drifted and bring them up, not to reinvent the ones that work.

**Any change that makes a currently-conforming screen look different has failed,
regardless of how good it looks.** The bar is agreement, not novelty.

---

## 1. Palette — the single biggest live gap

The app's root tokens are **purple-tinted**. The bar is **black / charcoal /
gold / parchment**, with colour used only for meaning.

Current (`public/index.html` `:root`):

```
--bg-deep:      #0b0814     ← violet-black
--bg-mid:       #14101f     ← violet
--bg-panel:     #1a1530     ← strongly violet
--bg-card:      #221a3a     ← strongly violet
--border:       #3a2f5c     ← PURPLE. This is the tell.
--border-bright:#6b5499     ← PURPLE.
```

The bar:

| role | value | note |
|---|---|---|
| page ground | `#0a0a0b` – `#0e0d0c` | near-black, very slightly warm. **No violet.** |
| panel ground | `#141210` – `#17150f` | charcoal, warm |
| raised card | `#1c1813` | |
| frame line | `rgba(198,160,74,.34)` | thin, warm gold |
| frame line, soft | `rgba(198,160,74,.16)` | dividers inside a panel |
| gold | `#c9a227` → `#d4af37` | the structural accent |
| gold bright | `#f0d98a` | headings, live values |
| parchment | `#d9cbaa` on `#241f16` | explainer blocks and tooltips ONLY |
| ink | `#e8dfc9` | body |
| ink dim | `#9d907a` | labels, captions |

Colour carries **meaning only** and is never chrome:

- 🔥 ember `#e0703f` — Cinder, danger, "out of"
- 💀 blood `#c0392b` — raiders, loss, refusal
- ◈ violet `#8b5cf6` — Aza / premium / mythic rarity **only**
- teal `#4fb0a5` — stable, verified, network-good
- green `#6fbf85` — supplied, owned, positive delta

**Measurable test.** Sample the computed background of the outermost page
container and of any panel border. If the blue channel exceeds the red channel
by more than 8/255 anywhere in the CHROME, the screen fails. (Rarity glyphs,
card art and the violet accent are exempt — this tests chrome, not content.)

---

## 2. Typography

- **Display / headings:** `Cinzel`, serif fallback. ALL-CAPS or small-caps,
  letter-spacing `.04em`–`.08em`. Page titles are large (28–44px), gold-bright,
  and often carry a small emblem to the left.
- **Body:** a serif — `Crimson Text` / `Newsreader` / Georgia. Never a UI sans
  for prose.
- **Labels / numerals / chips:** small caps, `.12em` tracking, `ink-dim`.
  Numbers that matter are set larger than their label and in gold-bright.
- **Italic serif** is the voice of the world — quartermaster lines, flavour,
  "Your expedition is still out there."

**Measurable test.** Any element whose class or role is a heading must resolve to
a serif family. A `sans-serif` heading fails.

---

## 3. The frame — the signature of this look

Everything of consequence sits in a **rectangular etched frame**:

- 1px gold-ish border at ~30% alpha, subtle inner shadow, **radius 2–4px only**.
  Large radii read as modern web and are wrong here.
- A faint stone/scratch texture over panel grounds. Never a flat fill.
- Important frames add **corner ornaments** (small angular gold marks at the four
  corners) — see the Camp facility tiles and the Bank vault cards.
- Section headings sit ON the frame edge or in a full-width bar above it, in
  small caps with a hairline rule running to the panel edge.

**Measurable test.** `border-radius` on a panel or card must be ≤ 6px. A pill
(`999px`) is allowed only on a status chip.

**One carve-out: depicted physical objects.** A thing the UI is drawing as a
REAL OBJECT — not a panel that contains content, but a picture of hardware — is
shaped by what it depicts. Today the Emergency Broadcast handset is the only one
in the app: it is an iPhone, so its chassis is 56px and its display 46px, and no
amount of rail-and-notch detailing made a 6px slab read as a phone. The carve-out
is deliberately narrow, and these two tests decide it:

- Does it represent a physical object the player would recognise by silhouette?
- Is the CONTENT inside it still framed to this bar?

The handset passes both: the device is an iPhone, and the feed, tabs and status
row inside it keep their 4px frames and their gold. A modal, a card, a dialog or
a sheet is not a physical object and does not qualify — reach for this only when
you are drawing hardware.

---

## 4. Component vocabulary

Reuse these; do not invent new ones.

- **Tab strip** — parchment-ish raised tabs, active tab lighter with a gold
  underline (Camp, City Hall, The Market).
- **Stat chip** — icon + value in a bordered box, label in small caps beneath or
  beside (the top resource bars everywhere).
- **Explainer block** — numbered 1–4 parchment cards under a "How X works"
  heading, with a `▲ Hide explainer` toggle (Black Market, Tutor Shop, Wager
  Hall, The Market). This is the house pattern for teaching a screen.
- **Ledger row** — full-width, hairline separator, label left / value right,
  monospace-ish numerals (Live Profit Feed, Refinery, Registry).
- **Action button** — gold gradient fill, dark text, small caps, sharp corners
  for a primary; ghost = 1px gold border on transparent.
- **Vitals bar** — segmented (not smooth) horizontal meter, coloured by state
  (Camp Vitals, Resonance stars).
- **Footer strip** — a dark band with an emblem and italic world-voice text.

---

## 5. Density and layout

These screens are **information-dense and proud of it**. Do not add whitespace to
"clean it up" — that is the most likely way to fail this bar.

- Three-column shells are the norm: left rail (context / vitals), centre (the
  work), right rail (situation / roster).
- Grids of 3–6 cards, tight gutters (10–14px).
- A persistent top bar of resource chips, and a bottom bar of actions/status.
- Long lists scroll **inside their own frame**; the page itself does not scroll
  horizontally, ever.

---

## 6. The two city-builder features in this pass

**(a) Camp tab — the owner's registry.** In the city builder's Camp tab, list
every player registered to the city owner's node: their camp/city name and a few
vital stats beneath each. Treat it as a **Ledger row** list inside a framed
panel, one row per player, with a small vitals strip.

**(b) Cities-Skylines-2 style mood emoji.** When a player places a building,
road, pipe or pole, show a happy / neutral / frowning face reflecting how the
city feels about it — separately for **businesses** and for **residents**.
⚠ The city builder ALREADY has this model: `pmFace()` / `pmGlyph()` map a score
to `happy` / `meh` / `frown` and 😀 / 😐 / 😟, and `/src/plotmood` +
`MythicPlotVerdict` already compute a per-tile verdict with a signed causal list.
**Do not build a second mood model.** This is a presentation task: surface the
existing verdict at placement time, in the two audiences the request names.

---

## 7. Performance, dead code, and the rule that outranks them

The pass also wants the site faster and the dead code gone.

🔴 **`public/index.html` is ~14.6 MB and is the live game.** Deleting from it is
the highest-risk action in this repo. A symbol that looks unreferenced may be
reached by a string, a `data-` attribute, an inline handler, or one of the
module bridges. **Nothing is deleted without a driver that exercises the feature
it belongs to, before and after.**

Order of preference:
1. Delete only what is provably unreachable AND covered by a gate.
2. Prefer *not loading* over *deleting* — defer, lazy-import, split.
3. Measure before and after. "Feels faster" is not a result.

---

## 8. The gates — non-negotiable, every round

```bash
node _synckcheck.mjs                          # public/index.html
node _synckcheck.mjs public/node-city/index.html
node .gauntlet/modcheck.mjs                   # every ES module
node .gauntlet/jsxcheck.mjs                   # public/corp/*.jsx
node .gauntlet/precommit-scan.mjs
node tools/economy-tests/run.mjs              # slow — never run it during a deploy
```

⚠ The economy gauntlet reads `public/index.html` as SOURCE TEXT. Running it while
`deploy.mjs` has the file minified reports five rounds failed and three crashed,
and nothing is wrong. Do not overlap them.

⚠ The Browser pane's `requestAnimationFrame` fires at ~0.56 Hz. `render()` is
RAF-batched, so it effectively does nothing inside a synchronous driver and
canvas rects read 0×0. Call renderers directly. See CLAUDE.md.

---

## 9. How a critic must judge

For each screen:

1. Render it for real and screenshot it. Do not judge from source.
2. Score against §1–§5 with the **measurable** tests first — palette channel
   test, radius, heading font family, horizontal overflow.
3. Then the taste call: does it look like it belongs beside the Bank of Ethos
   screen? Name the **single biggest remaining gap**, concretely enough that a
   builder can act on it without seeing the image.
4. Say plainly which of your findings are measured and which are judgement.

**A critic that reports "looks good" without a measurement has not done the
job.** So has one that fails a screen without naming what to change.
