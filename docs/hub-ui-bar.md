# THE BAR — target UI for the main menu and every sub-hub

Two design comps were supplied by the project owner as the quality bar for this work.
**The comps are not in this repo and cannot be viewed by any agent.** This document is a
pixel-level transcription of them, written by the one agent that could see them. Treat it as
the specification of record. Where this document and the current code disagree, **this
document wins** — the current code is a generation behind the comps.

Renderable recreations of both comps live in `docs/bar/` and are the pixel reference for
A/B judging. If a recreation disagrees with this document, the document wins and the
recreation is wrong.

---

## 0. What is being replaced

`public/main-menu/index.html` (the iframe main menu) and the sub-hub screens rendered by
`renderTitle()` in `public/index.html` currently render a **purple/indigo, glassy, Master-Duel
styled** menu. The comps are **not that**. They are gothic, warm, near-black and gold, built
out of stone, parchment and metal. The purple wash is to be removed as a *ground* colour and
kept only as a small accent.

Note: `public/index.html:113067` currently sets
`.spellbook-hub.is-sub .spellbook-hub-bg img.hub-bg-img { display: none }` — it deliberately
hides background art on every sub-hub. The comps show painted art behind the sub-hubs. That
rule must go.

---

## 1. Shared visual language

**Ground.** Near-black, warm, never blue-black: `#0b0906` → `#12100c`. Painted art shows
through at low luminance. No large flat purple field anywhere.

**Gold.** One family, used at three weights:
- structural hairlines / frames: `#8a6f3c` at 45–60% opacity
- body gold (labels, values): `#c9ab72`
- highlight gold (titles, active state, hover): `#e8c877` → `#f2dda2`
Gold type carries a hard dark shadow (`0 2px 0 rgba(0,0,0,.8)`) plus a faint warm inner
emboss. It must read as *stamped metal*, not as coloured text.

**Parchment.** `#d9cba8` ground, `#2b2118` ink. Used only for the dispatch/news card.

**Purple.** `#6b4fa0` → `#9a7ad0`. An accent only: a promoted tile's frame, a "special"
badge outline, an ornament. Never a background.

**Type.** Cinzel / Cinzel Decorative throughout. Small caps, letterspacing `0.06em` on body
labels rising to `0.12em` on titles. Sub-labels are an italic serif in muted gold-grey
(`#9a8d6c`). No sans-serif anywhere in menu chrome.

**Frames.** Every plaque is a bevelled dark stone panel: 1px gold hairline, an inner
`inset 0 1px 0 rgba(246,220,149,.10)` top highlight, an `inset 0 0 0 1px rgba(0,0,0,.7)`
dark liner, and a soft outer drop shadow. Corners are **notched/octagonal** (a `clip-path`
cutting ~10px corners), not rounded rectangles. This is already the right idea in
`.hub-cur-pill` — it is the whole system in the comps.

**Ornaments.** Small gold diamonds/bosses at the centre of long rules; a skull boss at the
top-centre of the bottom banner; corner filigree on the outer screen frame. Sparse and
deliberate — three or four per screen, never a border of them.

---

## 2. Comp A — the main menu

**Outer frame.** The entire 1920×1080 viewport is wrapped in an ornate border ~14px thick:
cracked dark stone with gold filigree at each corner and a small gold diamond boss at the
midpoint of each edge. The frame sits *over* the art, inset ~10px from the viewport edge.

**Background.** Full-bleed painted art: a drowned gothic city under a storm, warm gold
lightning forking through the upper third, a large antlered bone-crowned figure centre-bottom,
skulls in the foreground. Kept exactly as-is — the UI must not brighten, blur or tint it
beyond a soft vignette.

**Left rail** — a vertical stone slab, ~380px wide, full height, right edge carrying a gold
hairline. Contents top to bottom:
1. **Logo block.** Three fanned tarot cards, then MYTHIC / SPELLBOOK in gold letterpress
   serif, then a small gold dagger-and-flourish ornament. Roughly 300px tall, centred in
   the rail. **This is the existing game logo and must be kept.**
2. **Nav list**, eight rows: Card Shop · Battle Hall · Forge Sanctum · Ruin Exchange ·
   The Codex · The Camp · Arcanum · **Warpath**.
   - Row height ~68px. A ~44px square gold line-art icon plate on the left, then the label
     in Cinzel small caps ~20px, letterspacing `0.08em`.
   - Rest colour `#b9a480`. Rows divided by a 1px gold hairline at ~12% opacity.
   - **Active row**: label at `#e8c877`, a warm wash behind the row
     (`linear-gradient(90deg, rgba(180,140,60,.16), transparent)`), and a 3px gold vertical
     marker bar flush to the rail's left edge.
   - **Hover**: label lifts to `#e0c48c`, wash at half the active strength, marker bar at
     40% height. No translation, no scale — the row lights up, it does not move.

> `Warpath` does not exist in the codebase today. It is a new nav entry in the comp. Add the
> row and route it; if there is no destination yet, it opens a "coming soon" plaque in the
> same visual language rather than dead-ending.

**Top bar.** A row of *separate* bevelled plaques across the top of the right-hand area —
not one continuous bar:
- `[portrait glyph] CHARACTERS` plaque, then a small gold bookmark/banner ornament as a divider.
- Player name in gold Cinzel ~28px (`SETHIROTH THA DEV`), rank in muted gold (`ROOKIE IV`),
  then `★ 11`, `[coin] 2,076,571`, `[gem] 2`, and a gear glyph at the far right.
- Thin vertical gold rules separate the value groups.

**Event banner**, top-right under the bar: a dark plaque with a gold border, a warning
triangle, and `CLEAN WATER DISCOVERY · 1H 48M` in gold Cinzel caps.

**Bottom-centre banner**: a wide plaque, gold hairline, a small skull boss at top-centre,
carrying two lines of italic gold serif —
*"Your expedition is still out there. / Return through the Warpath Gate."*

**Herald's Dispatch**, bottom-right: a **parchment** card, ~430×280. Warm cream ground with
a deckled/torn edge and a subtle paper grain. A raven glyph left of the title
`Herald's Dispatch` set in dark ink Cinzel; a hairline rule under it; body copy in dark ink
serif italic. Footer row: `Follow ☐  |  + Add special Links`. A dark purple banner ornament
with a skull hangs off the top-right corner. This card is the only light surface on the
screen and it must read as paper — grain, soft inner shadow at the edges, no gloss.

---

## 3. Comp B — the sub-hub (Battle Hall, and the pattern for all six)

**Background.** Dark cracked-stone painted art, near-black, with a large armoured turtle
creature bottom-right and spears/debris bottom-left. Low contrast so UI reads over it.
Each hub keeps its own painted background — **the `display:none` rule must be removed.**

**Top bar.** Left: two tab plaques, `← MAIN HUB` and `BATTLE HALL`, the current hub's tab
brighter with a lighter fill — a breadcrumb built out of tabs, not a text arrow. Right: the
player group from Comp A (name with a caret, rank, `★ 11`, coin, gem) plus a speaker glyph
and a gear.

**Title block.** `BATTLE HALL` in gold Cinzel caps ~72px, letterspacing `0.12em`, warm glow
plus hard dark shadow. Under it `WHERE CHAMPIONS ARE FORGED` in small letterspaced gold-grey
caps. Under that, a thin gold rule with a diamond ornament at its centre, ~560px wide.

**Tile grid.** Four across, then three centred below. Gap ~22px. Each tile ~300×330:
- Outer 1px gold hairline frame with small notched corners and a soft outer shadow.
- An **art panel** filling the top ~55%, with its own inset gold hairline. Painted scene art,
  darkened so the title below stays dominant. Art fills the panel — it is not an icon
  floating in an empty well.
- Title under the art in gold Cinzel caps ~26px, centred.
- One line of italic serif subtitle in muted gold-grey.
- Optional **badge pills**: outlined rounded-rects. Gold outline for neutral
  (`Online · 4`, `3 Available`, `Rookie IV · 11 RR · 10 AP`), purple outline for special
  (`Completing`, `Resets at Midnight`).
- **Promoted tile** (Season Pass in the comp): violet frame and a violet outer glow instead
  of gold. Exactly one per hub at most.
- **Hover**: the frame brightens to highlight gold, the art panel lifts its exposure a few
  percent, the tile rises ~3px with a deeper shadow. ~160ms, custom easing, never linear.
- **Active/press**: the tile drops back to 0 and the inner shadow deepens — a physical press.
- **Focus-visible**: a 2px highlight-gold ring offset inside the notched corners.

**Bottom**: a small underlined gold-grey `Terms of Service` link, centred.

---

## 4. Rules that apply everywhere

- **Keep every background image. Keep the logo.** Both are in the comps and are not to be
  redrawn.
- **Keep all behaviour.** Every button, handler, badge, live count, gate and route keeps
  working. This is a remodel of surfaces, not a rewrite of logic.
- **One back button.** A single component, identical on every page — the tab-plaque form
  from Comp B. No page invents its own.
- **Transitions.** Hub-to-hub navigation crossfades with a brief warm-gold sweep; tiles
  stagger in over ~240ms. Everything honours `prefers-reduced-motion: reduce` by dropping to
  a plain opacity change.
- **Every state earns its keep**: rest, hover, active, focus-visible, disabled. Disabled is
  desaturated gold at 40% with the frame dropped to hairline-only — never just `opacity:.5`.
- **No sans-serif, no rounded rectangles, no flat purple fields, no glassmorphism blur.**
  Those are the current design and they are what is being replaced.
