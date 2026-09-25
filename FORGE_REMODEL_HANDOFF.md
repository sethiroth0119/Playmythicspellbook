# Forge Remodel — Handoff

**Status: PAUSED mid-run, but the work done so far IS NOW LIVE at `v121v77`.**
All work is uncommitted in the working tree of `D:\game-deploy`.
`npm run check:full` is GREEN (73 suites + the economy gauntlet) and v121v77 is
verified at the edge.

**What shipped in v121v77** — the four rounds that had completed when the run was
paused, plus two unrelated bug fixes the owner asked for afterwards:
- the three live save-path defects (§4 below),
- the editor width unlock and the per-effect field gating (§4 below),
- the City Builder Cinder-rate chip that flicked between two numbers
  (`_cinderrate_smoke.mjs`),
- the Containment Lab cure system — unreachable strains, the useless
  suggestion button and the missing bench readouts (`_cures_smoke.mjs`).

The four un-started pieces in §5 are still un-started.

Live progress page (regenerated, not hand-written): `node .gauntlet/progress/render.mjs`
→ `.gauntlet/progress/progress.html`, published at
https://claude.ai/code/artifact/7383c553-e294-4ae5-b251-8690ee7bf844

---

## 1. What the owner asked for

Verbatim:

> Do a loop to remodel the Forge card system to make it much more neat, fit the screen,
> and everything is compact and easy to find where everything is in drop box. Moves are
> set by element, and either they are an ability, physical, or magic. Status effects,
> information on them, On play abilities custom where everything and every type is clean
> where it is easier and smoother for me to create cards.
>
> Realm Deck have their own 21 cards which means every deck created have their own.
> Players must actually own the Realm Cards to add them to their deck just like how they
> add to their main deck, also make the deck count to go up to 80 cards, 40 cards is the
> minimum.

Plus three new effect types, verbatim:

> Cast: Draw x cards and discard x cards from your hand
> Draw x cards and discard x cards from out of those cards
> If this card is sent from your vanish to your deck summon a x from your graveyard or
> any other card type effect

**Process the owner asked for:** a lead agent divides the goal into the smallest
independently-judgeable pieces; each piece gets a builder AND a separate critic with
fresh context; the critic inspects the real output, compares against the bar, sends the
biggest gap back; loop until it wins. Subagents + ultracode. A live progress page.
Do not prescribe architecture or a fixed number of rounds.

---

## 2. FOUR DECISIONS THE OWNER MADE — these are settled, do not re-ask

1. **Move control model.** Element → Kind (Attack / Ability / Summon / Movement) →
   Damage type (Physical / Magic, shown only when it applies). Three linked dropdowns.
   The owner clarified this is about **where you add moves to units in the Forge**
   (the learnset UI), not only the standalone move editor.
   *Why not a literal 3-way Ability/Physical/Magic control:* the data is two orthogonal
   axes (`kind` at ~152455, `type` at ~152478); a 3-way control cannot express
   "ability + magic" and would destroy the real `kind:'summon'` and `kind:'movement'` moves.

2. **AI deck size:** the AI matches the player's deck size at 40–80.
   *Why it matters:* deck-out loses the game and extra copies come from paid packs, so
   an AI fixed at 40 against a player at 80 means a paying player cannot lose the
   fatigue race. That is a monetisation-adjacent balance inversion on a live paid game.

3. **Realm Deck is SEPARATE** from the 40–80 main-deck count, and holds **only Archon
   and Fusion units**.

4. **Ownership + exclusivity:** you must own a Realm card to add it (same gate as the
   main deck), and **Archon/Fusion summons cannot go in the main deck at all — Realm
   Deck only.** This dissolves the "shared copy budget" question.
   ⚠ **NEW WORK THIS IMPLIES, not in the original plan:** existing decks may already
   contain Archon/Fusion cards in the main deck. That needs a migration that MOVES them,
   not one that silently makes saved decks illegal.

**Owner's chosen run order (asked and answered):** ship the authoring ergonomics first
as one version, then do the live-data block (deck size + Realm) as a separate second run.

---

## 3. The three instruments — BUILT, HARDENED, AND LOAD-BEARING. Use them.

These were built and adversarially attacked over four rounds. They are the reason the
rest of the work is safe. **Do not reinvent them; do not weaken them.**

### `_forgeids_smoke.mjs` — the save-path contract net (registered in `_checkall.mjs`)
Boots the REAL `index.html` in headless chromium and:
- **Half A:** derives every id the save path reads — **436 ids across 17 read forms**,
  including 14+ wrapper helpers (`_wc`, `_pc`, `_pv`, `_ck`, `numOrNull`,
  `_readCardFilterFrom`, `_readSearchPickRule`, …) — and checks each is rendered, **per
  card type**, using an *instrumented copy* of the real `captureEditorIntoCard`.
- **Half B — THE ONE THAT MATTERS:** loads 153 real cards, saves each with **zero user
  input**, and asserts the card is byte-for-byte unchanged.

**Why Half B is the gate for every layout change:** `captureEditorIntoCard` reads the DOM
with `num(id, min, max, fallback)` and ~134 of those pass a *literal* fallback. Remove a
field from the DOM and the number is **silently rewritten to a constant**, and
`saveCardFromInputs` cloud-pushes the card definition to every owner. No error, no toast,
and the rest of `npm run check` sees nothing.

```
node _forgeids_smoke.mjs             # the gate
node _forgeids_smoke.mjs --list      # the named mutants
node _forgeids_smoke.mjs --selftest  # proves all 10 mutants still drive it red
node _forgeids_smoke.mjs --mutate=drop-grave-chance   # exits 1 with a named FAIL
```
It maintains `KNOWN_HOLES` / `KNOWN_TYPE_HOLES` / `BLIND_SPOTS` as **exact sets** — so
fixing a hole REQUIRES deleting its baseline line in the same change, or the suite
correctly goes red telling you so.

### `.gauntlet/_forge-harness.mjs` — the driver (registered in `_checkall.mjs`)
- `openCardEditor(page, cardId)` — reaches the real editor and **hard-asserts exactly one
  `.card-editor`**. `renderForge` is admin-gated and bounces *silently* to the title
  screen, which then opens an opaque full-viewport narrative overlay; a naive driver
  screenshots that and reports success. Pass `'NEW'` for a blank draft; an unknown id
  throws (it falls back to the card LIST, which would be measured as if it were the editor).
- `bootPage({viewport})` returns `{page, browser, close, ...}` — **not** the page directly.
- `forceOpen(selector, scope, opts)` / `releaseForced()` — `releaseForced` runs IN the page.
- `assertPainted` / `paintProbe` — elementFromPoint occlusion + a screenshot byte floor.
  Catches `body{opacity:0}` and overlays, which a visibility-only check does not.
- `abRun(driver)` — A/B against HEAD in a **git worktree**.

⚠ **NEVER `git stash` in this repo.** Other agents write here and `deploy.mjs` minifies
`index.html` in place. `grep -c stash` on the harness must stay 0.

**Known residual limits** (critics got past these, judged acceptable): deliberately
adversarial CSS — a `pointer-events:none` overlay, or a stylesheet making all editor ink
transparent — still passes the paint gate. **Mitigation: every layout critic must LOOK AT
A REAL SCREENSHOT, not only read numbers.** Keep that clause in every critic brief.

### `.gauntlet/forge-export.mjs` — backup/restore/diff for the live-data migrations
Exports `Forge.customCards`, `Forge.customMoves`, `Profile.decks`, `Profile.deckByHero`,
`Profile.archonDeck`. Refuses loudly on unreadable source (the refusal lives at the
resolve point, so every entry point inherits it, `memoryStore` included).
**Every live-data piece must run the export BEFORE its first write and attach the
before/after diff to its evidence.** A migration piece without that diff is not complete.

Also present: `_forgesave_proof.mjs` — three named before/after checks for the save-path
bugfix; `FORGE_PROOF_INDEX=<a pre-change index.html>` re-runs them against the old build.

---

## 4. What has LANDED (verified, in the working tree)

### Round 4 — three live save-path bugs FIXED (these were corrupting real cards)
| Defect | Before | After |
|---|---|---|
| Two-element spell | saved as `["fire"]` — second element dropped | both survive save→reopen→save |
| `vanishUnit` `minCost` | forced to **0** every save | stays as authored |
| Void-ability card filter | reset to any/any/any on reopen | survives |
| Hand-authored `onResurrect` | replaced by a copy of on-play | survives |

Unrenderable-but-written field paths: **74 → 0**.
The `onResurrect` fix: the Auto-copy checkbox rendered *checked* for any card that merely
HAD a resurrect block; un-checking it alone would have permanently "diverged" the card on
one on-play edit and silently stopped the mirror — so intent is now a flag and the copy
runs as the **last** statement of capture (it previously ran ~380 lines *before* on-play
was read, and was copying the previous save).

### Round 5 — editor width + per-effect field gating
A/B'd in two git worktrees, fixed explicit open-set, at 1600×1000:

| | HEAD | now |
|---|---|---|
| `.card-editor.fx-two` width | 900px | **1549px** |
| `.fx-props` scrollHeight | 22,109px | **14,876px (−32.7%)** |
| grid columns | 2, min 181px | 3–4, min 268px |
| labels wrapping past 2 lines | 44 | **0** |
| controls under 28px tall | 38 | **0** |

**Anti-cheat held:** panel text content byte-identical before/after (same hash, 290 fields,
same font histogram at all four widths) — the 32.7% is layout, not hiding or shrinking.
Move editor (`~152445`) and event editor (`~153673`) deliberately still 900px.

The cause was one declaration: `.card-editor{max-width:900px}` still applied to
`.card-editor.fx-two`, because the two-column rule set only `display` and
`grid-template-columns`.

`grid-auto-flow: dense` was **rejected on purpose** (worth another 375px) because it
reorders fields on screen while tab order stays in DOM order. Reasoning is in the code.

**Gating:** across all 118 `ONPLAY_TYPES`, the on-play block shows only fields that effect
actually reads, checked against a whitelist computed independently from the save gating.
Hidden fields **remain in the DOM**; the change handler re-runs the empty-section sweep
and the nav-chip hider.

**Phone regression fixed by hand after the round:** the new `.fx-two .fx-sub > .editor-grid`
rule is 3 classes and sits OUTSIDE the editor's own `@media (max-width:600px)` single-column
rule, so it outranked it and a 340px track overflowed narrow viewports. Now
`minmax(min(340px,100%), 1fr)` (and the same for the 260px rule). Do not drop the `min()`.

---

## 5. What is NOT done

**Batch 1 was stopped before producing any change** — verified: `ONPLAY_TYPE_GROUPS` still
10 groups, `fx-obtain` still present, `statusList` still 14 ids. Clean stop, nothing
half-applied. These four pieces are un-started:

1. `effect-type-picker` — group the 6 orphans, add a type-to-filter and inline explanation
   at all 11 call sites incl. the spell/trap selects.
2. `editor-nav-index` — name the nine runtime drawers, per-section filled-count badges,
   delete the dead `fx-obtain` section (ordinals are hardcoded 1–5; chip keys are
   string-concatenated onto `'fx-'` and a stale key breaks silently).
3. `status-picker-info` — all EIGHT status pickers; spells/traps can currently reach only
   **14 of the 60** `STATUS_EFFECTS`.
4. `spell-trap-body` — group + gate; the persistent-enchantment sub-block currently renders
   for every spell whether or not `persistent` is set.

Then, still in Run A (ergonomics): `move-picker-facets` (retarget at the **learnset** UI
per the owner), `move-editor-type-guard`, `move-editor-density`, `custommoves-repair`
(**must come AFTER the type-guard** or already-corrupted moves get re-corrupted on the next
save), the four effect pieces, then `ship-gate` + `authoring-task-gate`.

Run B (live data): `deck-size-range`, `realm-per-deck`, `realm-add-parity`, plus the new
Archon/Fusion main-deck migration implied by decision 4.

---

## 6. ⚠ TRAPS — each of these was found the expensive way

1. **`num()`'s literal fallbacks.** See §3. This is the single most dangerous line in the
   job. Any gating must hide fields **in the DOM**, never conditionally render them.
2. **Effect group labels are PERSISTED DATA.** `card.counterScope` stores the *group label
   strings*, matched by literal string in `_counterScopeOk` (~160284) and **failing
   closed**. Renaming or splitting a group silently empties every authored Counter card's
   scope and those counters then refuse everything with no error. Freeze the 10 label
   strings; group the orphans by ADDING. If a label must change, ship a migration and
   prove the before/after permission matrix (every card × every effect id) is identical.
3. **The nine ability drawers are built by a RUNTIME DOM SPLIT** (in `bindCardEditor`) that
   buckets **top-level children** of `#fx-ingrave .editor-grid` by probing `[id^="ed-ig-"]`
   etc. **One extra wrapper div collapses all nine into a single drawer** — the exact bug
   that code exists to fix.
4. **Effect (c) has no event to fire on.** There is exactly ONE void→deck movement in the
   engine, inside `shuffleToDeck`, and its zone default was moved off `void` after an
   earlier hand-wipe bug. **The void→deck EFFECT must ship with the trigger** or the
   feature can never fire. They go together or neither goes.
5. **`DECK_SIZE = 40` (now line 60159) is an EXACT-EQUALITY invariant in ~40 places** —
   legality, AI padding, saved-deck repair, anti-tamper, VS preview. 40→80 is a range
   refactor on real saved decks, not a constant bump. It and its UI must ship as ONE unit:
   ship the UI without the legality change and `buildStarterDeck`'s `=== DECK_SIZE` falls
   through and the player silently fights with a generated deck.
6. **The Realm roster is read DIRECTLY from `Profile.archonDeck` at battle time**
   (`_realmDeckAllows`, ~114908, and `getBattleArchonCards`). Move the storage per-deck
   without the battle reads and every player's Archon summons and Polycreation stop
   working in battle, silently. One unit.
7. **`_duel_smoke.mjs` text-slices the `ONPLAY_TYPES` and `STATUS_EFFECTS` literals** and
   asserts exact `needs.join()` strings. Reformatting those literals makes it THROW, which
   `_checkall` reports as CRASH, not a readable failure.
8. **The naive `fnText` lifter drops a leading `async`** and dies at parse time with zero
   FAIL lines. Copy the async-aware variant at `_vaultcap_smoke.mjs:26-32`.
9. **Heredocs break on apostrophe/backtick-heavy JS.** Use the Write tool for patch scripts.
10. **`deploy.mjs` minifies `index.html` in place**, then restores from `.index.dev.html`.
    Editing during that window causes false smoke failures and can revert edits.
11. **Version knobs move ONCE, at ship** — `window.BUILD_VERSION`, `sw.js CACHE_VERSION`,
    node-city `NC_BUILD`, `effects.js?v=`, `handset.js?v=`. `_handset_smoke.mjs` asserts
    handset `?v=` EQUALS BUILD_VERSION.
    ⚠ **AND `public/version.txt` MUST BE BUMPED WITH THEM, BEFORE THE GATE.** An earlier
    version of this note said "do not hand-edit version.txt, deploy.mjs rewrites it".
    That is true of the deploy and WRONG for the pre-deploy gate, and it cost a full
    gate run to find out. The app's own update-check (index.html ~39396) fetches
    `version.txt`; when it does not match `BUILD_VERSION` it concludes a newer build is
    live and calls `location.reload()` 500 ms after load. Every headless suite that
    drives the real page — `forgeids`, `forgesave`, `forgeab` — then dies with
    **"Execution context was destroyed, most likely because of a navigation"**, which
    reads as a broken test rather than a version mismatch. Bump it with the others;
    `deploy.mjs` then finds it already correct and says so.

---

## 7. ⚠ LINE NUMBERS IN THE PLAN ARE STALE

`.gauntlet/progress/pieces.json` (the lead's 23-piece decomposition, with each piece's
goal / bar / judge_method / anchors) was written **before** rounds 4 and 5 edited
`index.html`. Anchors have shifted by roughly +250 to +750 lines. Re-locate by symbol,
not by number. Current positions:

| symbol | line |
|---|---|
| `const STATUS_EFFECTS = {` | 40007 |
| `const DECK_SIZE = 40;` | 60159 |
| `const ONPLAY_TYPES = [` | 101671 |
| `const ONPLAY_TYPE_GROUPS = [` | 101986 |
| `function _onplayTypeOptgroups` | 102051 |
| `function _realmDeckAllows` | 114908 |
| `function renderCardEditor` | 146457 |
| `const statusList = ['',…]` | 147197 |
| `id="fx-obtain"` | 149664 |
| `function bindCardEditor` | 149771 |
| `function captureEditorIntoCard` | 151463 |
| `function saveCardFromInputs` | 153004 |
| `function _counterScopeOk` | 160284 |
| `const ARCHON_DECK_MAX = 21` | 246030 |
| `.card-editor.fx-two` CSS | 19584 |
| `.fx-two .editor-grid` CSS | 19653 |

---

## 8. How to resume

The decomposition, with every piece's bar and judge method:
`.gauntlet/progress/pieces.json` (23 pieces) — and `batch1.json` for the four un-started ones.

Workflow scripts from this run are on disk and re-runnable with
`Workflow({scriptPath, resumeFromRunId})`:
```
…/workflows/scripts/forge-remodel-recon-wf_dc4848b4-8d5.js
…/workflows/scripts/forge-gauntlet-infra-wf_5a6a56ff-f22.js
…/workflows/scripts/forge-gauntlet-infra-harden-wf_05a7c262-488.js
…/workflows/scripts/forge-infra-repair-wf_fb458f18-be6.js
…/workflows/scripts/forge-save-path-bugfix-wf_daec5b20-187.js
…/workflows/scripts/forge-layout-chain-wf_0914ae34-bbf.js
…/workflows/scripts/forge-authoring-batch1-wf_7cec2233-3be.js   ← the stopped one
```
(under `C:\Users\sethi\.claude\projects\D--game-deploy\<session>\workflows\scripts\`.
 Resume ids are session-local; in a NEW chat, re-launch rather than resume.)

**The gauntlet shape that worked** (copy `forge-authoring-batch1`): builders serialised
one-at-a-time on `index.html` (one 15 MB file, no formatter, no lock — concurrent edits
are unreviewable); only the CRITICS fan out, two per piece with fresh context and
different lenses (`measure` = re-measure everything independently; `damage` = live-data
and collateral); up to 3 rounds; the batch STOPS if a piece fails so nothing is built on
a broken layout. Every critic brief must carry the mandatory-screenshot clause.

**Before shipping Run A:** `npm run check:full` (adds the economy gauntlet), then bump the
five version knobs together, `npm run deploy`, then curl the edge to confirm.

---

## 9. Unrelated items still outstanding from before this run

- SQL the owner still needs to run: `update public.market_flags set clawback_live = true;`
- Supabase → Authentication → Emails → SMTP (host `smtp.mx.cloudflare.net`, port 465,
  username literally `api_token`, password = the Cloudflare token, sender
  `no-reply@playmythicspellbook.com`, **Sender name: Hidn Studios**), and URL Configuration
  redirect URLs `https://playmythicspellbook.com/?recover=1` and `/*`.
- Node Campaigns (v121v76, shipped): build the "Standing With El Paso" roguelite campaign
  in the Guide (name must match or pin it), confirm El Paso's node id is `N-42`, decide the
  airdrop rate.
