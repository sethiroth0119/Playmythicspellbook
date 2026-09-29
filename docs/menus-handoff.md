# Changing the menus — handoff

Everything you need to edit the main menu and the six sub-hubs yourself, without
re-reading the redesign. Written after the gauntlet run of 2026-08-22.

Two rules that explain most of the layout below:

1. **Design tokens are declared once**, on `:root` in `public/src/hubui/hub-keep.css`,
   all prefixed `--keep-`. No other stylesheet declares a token. Change a colour there
   and it moves everywhere.
2. **Content lives in `public/index.html`; looks live in `public/src/hubui/`.** If you are
   changing *what a menu says or does*, you are in index.html. If you are changing *how it
   looks*, you are almost certainly in a hubui sheet.

---

## The five-second map

| I want to… | Go to |
|---|---|
| Add / rename / reorder a main-menu nav row | `MD_SECTIONS` — index.html:113223 **and** the matching button in `public/main-menu/index.html` (~line 1003) |
| Add / remove / re-word a sub-hub tile | `PORTALS` — index.html:114713 |
| Change a tile's art | `HUB_TILE_ART` — index.html:115282 |
| Change a hub's title or tagline | `HUB_META` — index.html:115185 |
| Change a hub's painted background | `HUB_BG` — index.html:115207 |
| Change which tile gets the violet "promoted" frame | `HUB_PROMOTED` — index.html:115386 |
| Change a colour, corner, shadow or easing | tokens at the top of `hub-keep.css` |
| Change the back button | `.keep-tab` in `hub-keep.css` — one component, 20 usages |
| Change tile shape / art panel / badge pills | `hub-tiles.css` |
| Change page transitions or the tile stagger | `hub-transitions.css` |

---

## The four stylesheets

Linked from index.html:223749-223752. **The order is load-bearing** — later sheets assume
earlier ones. Keep it:

```
hub-keep.css   →  hub-tiles.css  →  hub-chrome.css  →  hub-transitions.css
```

- **`hub-keep.css`** (1179 lines) — the foundation. All 35 `--keep-*` tokens, the bevelled
  stone plaque, the notched-octagon corner shapes, gold "stamped metal" type, the sub-hub
  shell, and the one back-button component.
- **`hub-tiles.css`** (847) — the sub-hub tile: gold frame, art panel, title, subtitle,
  badge pills, promoted-tile violet treatment, and all interaction states.
- **`hub-chrome.css`** (892) — the same back button applied to every *other* screen in the
  game (the ~15 deeper screens that are not hubs), plus Card Shop entry chrome.
- **`hub-transitions.css`** (897) — hub-to-hub crossfade, gold sweep, tile entrance
  stagger, and the `prefers-reduced-motion` path.

**If you add a fifth sheet, link it last and declare no tokens in it.**

---

## Adding a main-menu nav row

This one is a two-file edit and the two halves must agree exactly.

1. **`MD_SECTIONS`** (index.html:113223) — add `{ t, s, ic, go }`.
2. **`public/main-menu/index.html`** (~1003) — add the `<button class="nav-item"
   data-label="…">` row.

> ⚠ **`t` is the routing key.** The iframe menu posts `{type:'mm:nav', label:'Warpath'}`
> and `_mmBindMsg` matches that string against `t` **character-for-character**. Re-wording
> or re-casing either half silently breaks the row — it will render and do nothing.

A row with nowhere to go yet takes `modal: true` and calls a plaque, the way `Warpath`
does — see `_warpathComingSoon()`. Don't let a row dead-end.

---

## Adding a sub-hub tile

`PORTALS` (index.html:114713) is keyed by hub: `main`, `battle`, `exchange`, `codex`,
`field`, and — because they gate tiles behind `isAdmin()` — `forge` and `arcanum` are
IIFEs that *build* their arrays (`forge:` at 114917).

Each tile is `{ id, icon, name, sub, accent, badge, onclick }`. Then:

- Add `id → art path` to **`HUB_TILE_ART`** (115282), or the tile renders with an empty
  art panel. That empty-panel look was a graded failure in round 1 — don't ship it.
- Art lives in `public/assets/hubtiles/*.webp` — 32 small WebP re-encodes of existing
  paintings, each named after its source path. They exist because pointing tile panels at
  multi-megabyte source PNGs left them blank on arrival. **Add new art as a WebP here**,
  not as a raw source PNG.
- **No emoji on a gold plate.** The comp has none anywhere, and a full-colour emoji on a
  gold-on-near-black tile is the loudest thing on the screen.

---

## Changing a hub's background

`HUB_BG` (index.html:115207). **Verify the path with `ls` before you commit — a 404 here
paints the whole sub-hub flat black.**

Historical note so it isn't undone: sub-hub background art used to be hidden outright by
`.spellbook-hub.is-sub … img.hub-bg-img{display:none}`. Deleting that rule was the single
biggest visual win of the whole redesign. If backgrounds ever go flat again, check that
no equivalent rule has come back.

---

## Verifying before you commit

```bash
node _synckcheck.mjs                      # syntax — NOT build.mjs
node tools/shot.mjs <page> out.png        # render any menu to a PNG
```

Pages: `main` `hubmain` `battle` `forge` `exchange` `codex` `field` `arcanum` `cardshop`

- **`main`** renders `public/main-menu/index.html` standalone — the iframe only.
- **`hubmain`** renders index.html *at* the main hub. **Use this one if you touch the
  Herald's Dispatch**, which is mounted at body level and is invisible to `main`. That
  blind spot let a footer regression survive a full round of review.

`shot.mjs` prints `meanLum` / `colors` / `modal` for every render. Healthy hubs sit around
**meanLum 12-20, modal 15-35%**. A meanLum near zero or a modal share near 100% means the
page rendered blank — the failure mode this redesign hit twice.

### Environment traps, each paid for once

- The headless viewport is **1920×993**, padded to 1080. A hard `height:1080px` silently
  loses its bottom 87px. Use `100vh`.
- **fonts.googleapis.com is unreachable** in this container. A bare `<link>` to Cinzel
  renders a system serif and makes your work look wrong for reasons unrelated to your work.
- Chromium paints `text-shadow` **on top of** a `background-clip:text` fill, hollowing
  glyphs into an outline. Gold stamped-metal type takes its shadow from `drop-shadow()`.
- `requestAnimationFrame` never fires in the harness. Anything gated on RAF won't paint;
  `shot.mjs` already shims it.

---

## Deploying

**Four things move together or the update breaks:**

1. `public/version.txt`
2. `window.BUILD_VERSION` in `public/index.html`
3. `CACHE_VERSION` in `public/sw.js`
4. the `?v=` on all four hubui `<link>`s (index.html:223749-223752)

Currently all at **v120w7**.

The failure mode is quiet and worth understanding: the `?v=` query refreshes the
stylesheets, but if `CACHE_VERSION` doesn't change, the service worker keeps serving the
cached `index.html` — so returning players never fetch the HTML carrying those links and
see none of your work. It looks like "the deploy didn't happen".

Verify the **edge** with curl after deploying, never the deploy log, and poll — PoP
propagation takes a couple of minutes.

---

## Known gaps (not done, deliberately left visible)

- **Herald's Dispatch NEW stamp** — still an opaque `#65200e` chip that reads as UI pasted
  on paper and severs the hairline rule at its origin. Failed both critics in the final
  round; the round cap ran out. Fix is to make it an overprint (`mix-blend-mode:multiply`,
  no octagon clip) and move it off the rule's origin.
- **Card Shop** — chrome only. Correct back tab and header plaque; the body is still the
  old purple field.
- **Fallback main menu** — if the iframe fails to boot, `App._mmBroken` falls back to
  `_masterMenuHtml()`, which was never redesigned: gold nav on a cosmic purple field, no
  logo, no frame, no Dispatch.
- **Missing art** — there is no skull artwork anywhere in `public/assets` (the comp's
  main-menu foreground calls for it) and no arena painting, so Colosseum borrows
  `vs-screen-bg.png`.

---

## Running the gauntlet again on new menus

The loop that produced this is saved as `.claude/workflows/ui-gauntlet.js` (also available
as the `ui-gauntlet` skill). Point it at a spec, one or more renderable comps, and the
surfaces in scope.

**The one thing that makes it work:** the comp must be *renderable*. Judging against a
written description passes anything vaguely on-theme. `docs/bar/comp-main.html` and
`docs/bar/comp-hub.html` exist so critics can render both sides and compare pixels. If you
bring new design comps as images, they get transcribed into a spec **and** built as comp
pages before any building starts.

The bar itself is `docs/hub-ui-bar.md`. Round-by-round history, with every critic's gap in
their own words, is `docs/gauntlet-progress.html`.
