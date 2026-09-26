# 📖 How Nodes Pay — Handoff

Everything needed to put the player guide into the live game, written so
someone who has never seen this work can follow it.

**Branch:** `claude/pensive-rubin-r8b9rz` · **PR:** sethiroth0119/Playmythicspellbook#7
**Build:** `v121v118` · **Migration:** `sql/132_grid_guide.sql`

**What it is.** A full-screen guide that explains to players how to own a node,
hire a Grid Manager (the game's Mayor Hall "mayor"), how a city's Cinder payout
is split, what Mythic Token is for, and every way the game lets you earn.
Everyone can read it. **Only admins can edit it**, in place, including photos.

---

## 1 · Files

| File | Status | What it is |
|---|---|---|
| `public/src/gridguide/index.js` | **new** | Entry point. Registers `window.MythicGridGuide` (`open()`, `close()`). Renders the guide and the admin editor. |
| `public/src/gridguide/gridguide.content.js` | **new** | The built-in guide text (`DEFAULT_DOC`). What players see before the first admin save. |
| `public/src/gridguide/gridguide.api.js` | **new** | Every cloud call: load latest, save, photo upload. All guarded. |
| `public/src/gridguide/gridguide.style.js` | **new** | The stylesheet, scoped under `.gg-`, injected on first open. |
| `sql/132_grid_guide.sql` | **new** | The `grid_guide_versions` table + RLS. Idempotent, ends with a verify query. |
| `public/index.html` | **edited, 3 insertions** | Hub tile, City Nodes button, module tag, plus the version bump. |
| `public/sw.js`, `public/version.txt` | **edited** | Version bump to `v121v118`. |

No existing function was rewritten. No economy, battle or card code was touched.

### The three insertions in `public/index.html`

Find them with `grep -n "How Nodes Pay\|src/gridguide" public/index.html`.

1. **Ruin Exchange tile** (next to Just Business), id `btn-grid-guide`.
2. **City Nodes header button**, in the breadcrumb after My City / Client Cities.
3. **Module tag:** `<script type="module" src="src/gridguide/index.js?v=v121v118gg3">`, after the campaigns module.

If the module fails to load, both buttons show a toast ("The guide is still
loading") instead of breaking. Nothing else in the game depends on it.

---

## 2 · Going live, in order

1. **Merge PR #7** into your deploy branch.
2. **Run the migration.** Open the Supabase SQL editor for project
   `ktsiasyjusesawtrwrjc`, paste all of `sql/132_grid_guide.sql`, run it.
   The last query should print `rls_on = true` and exactly two policies:
   `grid_guide_admin_insert:INSERT, grid_guide_read:SELECT`.
   Safe to run again at any time.
3. **Deploy:** `npm run deploy` (or `npm run deploy:test` first to try it on
   the test worker). The three version knobs are already bumped together:
   `public/version.txt`, `window.BUILD_VERSION`, `sw.js` `CACHE_VERSION`.
4. **Check the edge, not the deploy log.** Poll until it answers `v121v118`
   (propagation can take a couple of minutes):
   ```sh
   curl -s https://playmythicspellbook.com/version.txt
   curl -s https://playmythicspellbook.com/src/gridguide/index.js | head -3
   ```

---

## 3 · Verify in the game

**As a player** (any non-admin account, or signed out):
- Ruin Exchange shows the **📖 How Nodes Pay** tile. Clicking it opens the guide.
- City Nodes shows **📖 How Nodes Pay** in the top bar. Same guide.
- The top of the guide shows only **✕ Close**. No edit controls anywhere.
- The split calculator responds to the payout box and the slider.
- Esc or clicking outside the guide closes it.

**As an admin** (`play@mythicsoa.com`, `richaegisop@gmail.com`, `dev@mythicspellbook.com`):
- The guide shows **✎ Edit guide**, **Discard** and **Save & publish**.
- Edit a line, click **Save & publish**. The toast says the guide saved.
- Open the guide from a second, non-admin account: it shows your change.
- **+ Add photo** under any section: upload a PNG or JPG, save, and check it
  shows for the player account.

If a save says *"The guide table is not set up yet"*, step 2 was skipped.

---

## 4 · How admin editing works

- **✎ Edit guide** turns every heading, paragraph, bullet and answer into
  editable text.
- Under every section: **+ Add text**, **+ Add photo**. Blocks move up/down,
  switch between half and full width, and can be removed.
- Lists grow and shrink: cards, bullets, steps, map districts and routes,
  questions, fine-print lines. Click a route's **play/own** tag to switch it.
- Sections move up/down, delete (click twice), and **+ Add a new section**
  sits at the bottom.
- The top photo slot sits under the headline.
- **Save & publish** makes it live for every player at once. **Discard** throws
  away unsaved edits. Closing with unsaved edits asks first.

---

## 5 · Security: what actually stops a non-admin

The client hides the Edit button with `isAdmin()`, but **that is cosmetic**. The
real boundary is on the server:

- `grid_guide_versions` insert policy: `ms_is_admin() and created_by = auth.uid()`.
  `ms_is_admin()` checks the JWT email against the same three addresses as
  `ADMIN_EMAILS` in index.html. **Adding an admin means adding the address in
  both places.**
- Photos go to the existing `card-art` bucket under `grid-guide/`. Its write
  policies (sql/062) are already admin-only, images only, 25 MB.
- Reads are public, including signed-out players.
- Every string from the saved guide is drawn with `textContent`, never
  `innerHTML`, and photo URLs must be `https://`. A compromised admin account
  cannot plant script in the page every player opens.

---

## 6 · Undo and history

Every save is a **new row**; nothing is ever updated or deleted. The newest row
is the live guide. To roll back to an earlier version:

```sql
-- see the history
select id, created_at, created_by from public.grid_guide_versions order by id desc;

-- republish version 12 as the newest (run in the Supabase SQL editor)
insert into public.grid_guide_versions (doc, created_by)
select doc, created_by from public.grid_guide_versions where id = 12;
```

The SQL editor runs as the database owner, so RLS doesn't apply there and
`auth.uid()` is null. That's why the example copies `created_by` from the old
row instead of relying on the column default.

The built-in guide in `gridguide.content.js` only shows while the table has no
rows (or can't be reached). Once an admin has saved, roll back with the insert
above rather than deleting rows.

---

## 7 · Things to keep true

- **The guide describes real systems.** If any of these change, edit the guide
  (from the admin editor, or `gridguide.content.js` for the built-in copy):
  - Mayor Hall revenue split: floored cut, owner gets the remainder (sql/121).
  - Capital city Cinder × nodes owned.
  - Node sales held in escrow by Hidn Studios (sql/118).
  - Vault rate 5,000 Cinder = $1.00; Aza and Aza-converted Cinder can't cash out (sql/017).
  - Mythic Token: airdrops, node power (+100 owner / +25 anyone, Planetary Rush every 500),
    2,000 MT bank charter stake, MT loans capped at 60% LTV and 14 days.
- **Bank staking is switched off today** (`MT_STAKING_READY_DEFAULT = false`).
  The guide says so. When you switch staking on, edit that bullet in the
  "Open a bank" card.
- **Never word it as an investment.** No "safe", "guaranteed", "passive income"
  or "make your money back". Cinder cashes out for real money, so selling a
  return on a node someone else runs is how a game gets treated as a security.
  The fine print section says this plainly; keep it.
- **Cashout:** the guide says earned Cinder can be cashed out through the
  Vault. Payouts ship switched off (`CASHOUT_PAYOUTS_ENABLED`, see STRIPE.md).
  Confirm they're live before promoting the guide, or soften that line.

---

## 8 · Known limits

- Only one guide. Adding another would mean a `guide_id` column.
- Removing a photo from the guide leaves the file in the `card-art` bucket.
  Harmless, but a cleanup script would need to compare stored URLs.
- Two admins editing at the same time: the later save wins. Earlier saves
  stay in the history (section 6).
- No live refresh: players see a new save the next time they open the guide.

---

## 9 · Next: Mythic Token tools in Just Business (not built)

Decided so far:
- Players **stake** Mythic Token for a tool (locked, not spent). Unstaking
  removes the tool and returns the MT.
- Every tool **also has a Cinder price** while MT staking is switched off.
- **All businesses** get tools.
- **Still open:** what a tool does (output boost, new product, lower costs,
  more worker slots).

Before it ships: the MT balance mirror (`mythic_balances`) still has ~750k MT
uncredited against the chain. That is why bank staking is off, and tool
staking needs the same reconciliation first. Prices go in `OPS_ECON` via
`_opEcon()`, and every operation list in `public/corp/screens.jsx`
(`OPERATIONS`) has to be kept in step with it.

---

## 10 · Related, outside the repo

- **Live preview** (mocked hub + City Nodes, real guide code, Player/Admin
  switch): https://claude.ai/artifact/9MhrE5buWuaRiQg1ESQZjp
- **Grid Owner Playbook** for marketers (pitches, scripts, say/don't-say,
  launch checklist): https://claude.ai/artifact/XU1tG1d3S9KJQpYdgFgcK3
