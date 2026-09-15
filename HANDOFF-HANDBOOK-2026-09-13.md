# Handoff — the Core Rulebook, written 2026-09-13, revised 2026-09-14

Everything below is verified against the working tree and the branch, not from memory.
Where something is **not** verified, it says so.

## Where things stand

| | |
|---|---|
| Branch | `claude/hopeful-rubin-6arwkd` |
| HEAD | `2ee4b7f` |
| `main` | **not** merged — branch is 6 commits ahead of the Athena merge it forked from (`449ac97`) |
| Pushed | yes, branch is on GitHub |
| Working tree | clean |
| Version knobs | **not touched.** `version.txt` / `BUILD_VERSION` / `CACHE_VERSION` all still say `v121v116-athena` |
| `sql/132_handbook.sql` | **NOT APPLIED.** Nothing exists server-side yet |
| Deployed | **no** |
| Run inside the real game | **no** — see *What is not verified* |

Six commits, ~2,700 lines. The reading half is finished and self-contained. The
authoring half is written and driven headless against a stubbed client, but **has never
touched a real Supabase**, which is the single most important thing on this page.

## What shipped

| Commit | What |
|---|---|
| `ae21720` | The book itself — 14 chapters at `/handbook/`, plus `tools/handbook-sync.mjs` |
| `2279376` | Save-out goes through the `downloads` capability when one is offered |
| `339daa9` | Admin-only editing, published to Supabase, photo upload; `sw.js` and `CLAUDE.md` |
| `c5db673` | This hand-off |
| `078977c` | Restructured as a core rulebook — parts, numbered rules, new block types |
| `2ee4b7f` | This hand-off, revised for that restructure |

### The premise

The game had a five-step tutorial overlay and a `howto` explainer component, and nothing
that explained the game *whole* — no statement of the win condition, no matchup chart, no
deckbuilding guidance, nothing a new player could read before their first match or a
returning one could look something up in.

### The shape (as of `078977c`)

The owner asked for the shape of a tabletop core rulebook. **Format conventions only —
nothing is taken from any publisher's book, and none of their trade dress is imitated.**
That was a deliberate call and should stay that way: lifting text or layout from a
scanned rulebook would put infringing material in a commercial game's repo.

| | |
|---|---|
| Part One · The Core Rules | 1 Battlefield · 2 Battle Round · 3 Playing Cards · 4 Movement · 5 Making Attacks · 6 Status Effects · 7 The Kalon |
| Part Two · Reference | 8 Elements · 9 Factions · 10 Status Catalogue · 11 Rarity, Items & Packs |
| Part Three · Building a Force | 12 Deck Construction · 13 The Roster |
| Part Four · The Wider World | 14 Outside the Battlefield |
| Appendix | A Quick Reference · B Glossary |

**Rules are numbered and cited.** 37 of them, `1.1` to `13.2`, rendered in a hanging
gutter beside the heading (inline below 720px, so a phone does not squeeze the heading).
Prose cites them — "see 5.2" — and every row of the Quick Reference names the rule behind
it, which makes the summary an index into the book rather than a second source of truth
that drifts from it. **If you renumber a rule, grep the book for the old number.**

A **rules-priority preamble** sits above chapter 1, where a rulebook puts it: the card
beats the core rules, the specific beats the general, cannot beats can, and the game
itself is the referee.

**Defined terms** are `<dfn>` elements, set in small caps, defined at first use and
collected in the Glossary.

Three aside kinds, visually distinct because they carry different weight: `example`
(how a rule plays out), `designer` (why it works that way), and the existing `note`.

This is that document, and it is deliberately **not** part of `index.html`. It is a
standalone page under `public/handbook/`, served at `/handbook/`. It adds no top-level
system to the legacy file, touches no `const` global, and needs nothing from
`window.MythicBridge`.

## The section schema

A chapter is `{id, part, num, title, blurb, art, sections[]}`. A section carries any of:

| Key | Renders as |
|---|---|
| `n` | The rule number in the hanging gutter. Its presence is what makes a section a numbered rule. |
| `h` / `body` | Heading and rich-text body |
| `seq[]` | A numbered procedure (the battle round, the damage sequence) |
| `profile` | A datasheet block — `{name, line:[{k,v}], keywords[]}` |
| `example` / `designer` / `note` | The three aside boxes |
| `table` / `cards` / `img` + `cap` | As before |
| `render` | One of the four GENERATED blocks — see below |

`chapter.part` drives both the page's part dividers and the contents rail; a divider is
emitted when the value *changes*, so the spine is derived from the chapters rather than
kept as a second list that can fall out of step.

Adding a block type means: a `BLOCKS` entry, a `newBlock()` case, a branch in
`sectionHtml()`, a renderer, and a line in `runSearch()`'s haystack. **Miss the last one
and the block's text becomes unfindable**, which for a rule means uncitable.

## Files

```
public/handbook/index.html        the reader + the admin editor (68 KB, one file)
public/handbook/handbook.json     the book's prose — 16 chapters, 50 sections, 5 parts
public/handbook/gamedata.json     GENERATED — elements, factions, statuses, rarities
public/handbook/art.json          GENERATED — the 1,116-image picker index
public/assets/handbook/README.md  where the cover image goes
tools/handbook-sync.mjs           regenerates the two GENERATED files
sql/132_handbook.sql              handbook_doc, is_handbook_admin(), the bucket
```

## 🔴 The one thing that must not be undone

**The element / faction / status / rarity tables are generated from `index.html`'s own
constants. They are not typed into the book.**

`tools/handbook-sync.mjs` locates `ELEMENTS`, `ELEMENT_DATA`, `STRONG_VS`, `RARITIES`,
`FACTIONS` and `STATUS_EFFECTS` in `public/index.html`, evaluates just those declarations
in isolation, and writes `gamedata.json`. The page renders those four blocks from it and
they are **deliberately not editable in the editor** — an edited copy would only diverge
from the game silently.

The book quotes 21 elements, 42 factions and 60 status effects. Hand-copying those
guarantees drift the first time somebody adds an element, and a rules book that is quietly
wrong is worse than no rules book. So:

> **After changing any of those six constants, run `node tools/handbook-sync.mjs`.**

It throws loudly if a constant is renamed rather than emitting a half-empty file — that is
on purpose. It also checks that every image the book references exists on disk and names
the ones that do not.

One derivation in there is worth knowing about. An element's *weak to* list excludes its
**sworn opposites** — pairs where each is super-effective against the other, so both
directions are ×2 and neither resists (Light/Shadow is the one live case). Listing a sworn
opposite under "weak to" would tell the reader to avoid a matchup that is actually even.
The sync computes that the same way the game's own `MATCHUPS` block does.

## Who can edit, and what actually enforces it

`ADMIN_EMAILS` in the page mirrors `ADMIN_EMAILS` in `index.html` and
`is_handbook_admin()` in the migration. All three list the same three accounts.

**The page's check only decides whether the edit UI is drawn. It is not the security
boundary and must never be treated as one.** The boundary is RLS: `handbook_doc` grants
`select` to `anon` and `authenticated`, and `insert` / `update` / `delete` only where
`is_handbook_admin()`. `handbook_publish()` is **`security invoker`** on purpose, so those
policies still apply to it — a non-admin calling the RPC directly gets `denied` and zero
rows written, not a bypass.

Reads are open to anon deliberately. A rules book a signed-out player cannot read is not a
rules book.

The page shares the game's Supabase session: same origin, same default auth storage key,
so someone signed in to the game is already signed in here. **If the game's storage
adapter fell back to `sessionStorage` or memory because localStorage was full, the
handbook will see no session and read as signed out.** That degrades correctly (read-only)
but it is the likeliest cause of "I am signed in but there is no Edit button".

## Where the book comes from at runtime

In priority order:

1. `handbook_doc` in Supabase — the **published** book, what everyone reads.
2. An admin's local draft in `localStorage` — unpublished work in progress.
3. `public/handbook/handbook.json` — the repo fallback, and what a fresh install shows
   before anyone has ever published.

Every step is guarded and timeout-bounded. With no network, no Supabase and no tables it
still renders the shipped book. A **reader never loads a draft** — they could not publish
it, and it would show them an edit nobody approved from a browser they may share.

`version` on the row is optimistic concurrency, not history: publish sends the version it
loaded, the UPDATE matches on it, and a second admin is told to reload rather than
silently erasing the first one's work.

## What is pending — in order

1. **Apply `sql/132_handbook.sql`** by hand in the Supabase SQL editor for
   `ktsiasyjusesawtrwrjc`. Nothing server-side exists until this runs. Idempotent, ends
   with a verify block.
   - Expect `policies` → 4, `storage policies` → 4, `bucket` → true, `table` → 0 rows.
   - `admin fn` reading `false` in the editor is normal — it usually runs as the service
     role, so `auth.jwt()` is empty there. The real test is clicking Publish.
   - If `insert into storage.buckets` errors (needs table-owner rights), create the bucket
     by hand — **Storage → New bucket**, name `handbook`, **Public: ON** — and re-run. The
     rest of the file does not depend on that line.
2. **Publish once** from `/handbook/` signed in as an admin. That creates the row at v1 and
   flips the state pill from *"Repo copy — never published"* to *"Live · v1"*.
3. **Drop the cover image** at `public/assets/handbook/cover.png`. Until then the cover
   falls back to *First Galaxy*, which renders fine but is not the intended art.
4. **Decide whether the game links to it.** There is currently **no link from anywhere in
   the game** — `/handbook/` is only reachable by typing the URL. Adding one means editing
   `index.html` (a tile in the `main` PORTALS array, or a button on The Codex), which was
   deliberately left alone.
5. **Bump the three version knobs before deploying**, per CLAUDE.md.

## Gotchas that cost time, or would have

**Asset paths are stored root-relative and go through `au()`.** The book stores
`assets/artwork/x.png` to match every other path in the repo, but the page is served from
`/handbook/`, so a bare relative path resolves to `/handbook/assets/…` and 404s. Every
site that puts an asset path in the DOM goes through `au()`, which prefixes `/` and leaves
`http(s):`, `data:` and already-absolute paths alone. This was a real bug, caught in the
browser, not in review.

**`sw.js` had to change.** The service worker is cache-first for everything that is not a
navigation or under `/src/`. That pinned `handbook.json` / `gamedata.json` / `art.json` on
a reader's device until `CACHE_VERSION` moved, so a rules correction would have been
invisible to exactly the players it was written for. `/handbook/` now joins `/src/` in the
network-first branch. **The page's own `cache: 'no-cache'` cannot fix this** — the SW
answers before the HTTP cache is consulted.

**The TOC double-escaped entities.** Chapter titles are author-written HTML, so the TOC
strips tags but leaves entities alone; `plain()` is the fully-flattened form used for
search and confirm dialogs. Escaping a second time rendered a literal `&amp;`.

**Image upload exists against a documented out-of-scope rule.** CLAUDE.md says no image
upload because hosting UGC carries a CSAM detection and reporting obligation. That rule is
about *player* content. The `handbook` bucket accepts writes from three named accounts and
refuses everything else in RLS, so it is first-party asset storage and the obligation is
not engaged. **Relaxing that policy to `authenticated` re-engages it in full.** This is
noted at the rule in CLAUDE.md so the next person does not read the feature as a
violation, and it is not a precedent for any other upload path.

**Uploads are downscaled in the browser** to 1600px and re-encoded to WebP before they
leave. A 12 MB camera photo in a rules book is 12 MB every reader pays on every load.
WebP carries alpha, which most of this game's art needs; PNG is the fallback if WebP is
refused.

## The editor, briefly

Admin-only. Five block types from the **+ Add a section** menu — text, image, table, card
grid, callout. Tables grow and shrink by row and column; card grids add and remove cards;
images come from upload (button or drag-and-drop), the game-art library, or a pasted URL.
Chapters and sections reorder and delete. Drafts autosave to `localStorage` and survive a
reload; **⬆ Publish to everyone** writes to Supabase; **⭳ Download .json** produces the
file to commit back to the repo if you want the fallback to match.

Adding a block type means: a `BLOCKS` entry, a `newBlock()` case, a branch in
`sectionHtml()`, and a renderer. The section schema already carries `h`, `body`, `img`,
`cap`, `note`, `table`, `cards` and `render`, so most shapes need no schema change.

## What is not verified

- **None of it has run against a real Supabase.** The migration has not been applied, so
  publish, upload, the version-conflict path and the RLS refusal have only ever been
  exercised against a stubbed client in the test harness. The RLS itself has never been
  executed by Postgres.
- **None of it has run inside the deployed game.** No deploy, no edge check.
- **The session-sharing claim is reasoned, not observed.** Same origin plus the default
  auth storage key should mean the game's session is visible here; that was not tested
  against a real signed-in browser.
- The repo's own gates (`_synckcheck.mjs`, `.gauntlet/*`) **could not run** in the sandbox
  — `terser` is not installed. They only cover `index.html` and `public/src`, neither of
  which this touches, and the page's JS was parse-checked and driven in Chromium instead.
- **The in-game tutorial says the board is 6×8.** `BOARD_W`/`BOARD_H` in `index.html` say
  `14 × 12`. The handbook follows the code. `TUTORIAL_STEPS[1]` looks stale and was left
  alone — not this feature's to change, but worth someone's attention.

## How it was tested

`node tools/handbook-sync.mjs` regenerates and self-checks. The page was driven headless
in Chromium across five scenarios with a stubbed Supabase client:

| Scenario | Result |
|---|---|
| Signed out, no Supabase at all | Book renders, no edit button, nothing contenteditable, editor bar hidden |
| Signed in, not an admin | Same; `setEditing(true)` from the console does nothing |
| Admin, live book at v6 | Full authoring surface; all ten block types; table row/column; sequence steps; profile rows; card add/delete; upload; publish sends the loaded version and clears the draft |
| Admin, write refused | Refusal reported, **draft kept**, state stays *Unpublished draft* |
| Mobile 390px, editing | No horizontal scroll |

Plus the rulebook furniture: 5 parts in both the page and the rail, 37 numbered rules
starting at `1.1`, 27 defined terms, 4 priority rules, a profile KEYWORDS strip, and
auto-numbering that gave `2.5` to a rule added to chapter 2.

No page errors in any scenario. Element and faction rows were checked against the game's
own tables (Fire's five weaknesses; Light/Shadow as sworn opposites rather than a
weakness).

A live preview of the reader's view is published at
`https://claude.ai/code/artifact/e4b38665-0474-4355-a14d-502e11f79b90` — it bundles 36 of
the images and shows the signed-out reader experience, since the artifact sandbox cannot
reach Supabase.
