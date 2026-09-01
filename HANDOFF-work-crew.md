# HANDOFF — Unit Work Crew (city builder)

**Status:** feature complete, every gate green, **not deployed**.
**Branch:** `claude/unit-traits-abilities-rf3r88` @ `a886df0` · version `v120x9`
**PRs:** #2 (feature, → `city-builder-visual-upgrade-g9deb4`) · #3 (iframe hotfix, standalone)

---

## 🔴 READ THIS FIRST — the four ways to destroy this work

### 1. DO NOT rebase or re-base this branch onto `main`.
`main` (`4dbc4f9`) is **236 commits behind** `city-builder-visual-upgrade-g9deb4`
(`46b075a`), and its `node-city/index.html` is 24,303 lines against that branch's
39,725. This branch is **city-visual + 9 commits** and was deliberately merged that
way, because city-visual is the build actually being played. Rebasing onto main
silently deletes 236 commits of city work.

### 2. When you merge anything into `node-city/index.html`, VERIFY BY DIFF, NOT BY CONFLICT MARKERS.
This already went wrong once, in `62b1202`. Resolving the seven conflict markers
"correctly" silently dropped **two blocks of city-visual that had no marker**,
because they sat where the crew mount landed:

* `let _bldDeferredFinish` + its `bldNormalize(true)` call — city-visual's own
  comment measures the loss at **+7,200 Cinder over a 6 h absence** (completions
  finish at wall-clock before the absence is simulated).
* The entire **economy / budget / demographics mount**, 158 lines, including the
  three-valued `established` verdict that decides whether a city receives a
  **300,000 Cinder founding tranche**.

Both are restored. The check that caught them, and the check to repeat:

```bash
git show origin/city-builder-visual-upgrade-g9deb4:public/node-city/index.html > /tmp/them.html
diff /tmp/them.html public/node-city/index.html | grep '^<' | grep -v '^< *$'
```
Every line it prints must be one you *meant* to change. On this branch that list
is 24 lines and all of them are deliberate (version stamps, mock cards gaining
`level`/`rarity`, the crew term in `tileMult`, `insWorkPane` taking a `lead[]`,
`openCardPicker`'s `showWork` flag).

### 3. `ext.crew` is a SAVE KEY. Renaming it orphans every player's roster.
The crew registers with city-visual's own module save shelf
(`window.MythicCitySave.register('crew', …)`, `/src/naming/save.js`). It does
**not** add a field to `serialize()`. Post + condition ride that key.

### 4. Do not turn the node-city iframe cache-buster back into a literal.
`public/index.html`: `f.src = 'node-city/index.html?v=' + (window.BUILD_VERSION || 'dev')`.
`sw.js` is cache-first for iframe **sub-resources**, so a stale literal serves the
whole old city inside a new shell with every other knob reporting success. It sat
stale twice (`main` is *still* on `?v=120t9` against a `v120w6` build).

---

## What the feature is

Every unit derives three permanent things from one per-account salt
(`Profile.workSalt`, cloud-synced as `forge.__workSalt__`) plus its card id —
nothing is rolled-and-stored, because the city bridge walks the whole collection
on every panel open:

* **Suitabilities** — 1–4 kinds of work, each **level 1–4**. 13 kinds.
* **Passives** — 0–3, **good and bad** (Artisan +35%, Slacker −30%, Glutton eats 60% more).
* **Level + condition** scale the rest.

**Element decides the roll.** All 21 elements are strong at something; each lands
its expected trade 36–61% of the time. Adding an element to the game means adding
it to at least one `elements:` list in `work.js` or it rolls flat, silently.

**The player posts each unit by hand** to a building that needs one of its trades.
`autoFill()` fills only *empty* posts with *idle* units and never moves anyone
placed by hand. A fully-worked building caps at exactly **×2.00** (`BOOST_CAP`,
clamped in the module because the UI prints it as a promise).

**Three groups of workers, three names** (they were all called "crew"):
`👷 Staffing` (hired pool) · `🏗 Build Gangs` (construction) · `👷 Work Crew` (posted units).

---

## Files, and the collision surface

| File | What |
|---|---|
| `public/src/work/work.js` | **new** — rules, roll, arithmetic. Pure: no DOM/IO/globals. Imported by BOTH index.html and node-city. |
| `public/src/work/crew.city.js` | **new** — roster, posts, upkeep, panel + dialog + both pickers. |
| `public/node-city/index.html` | 26 functions touched — see below. |
| `public/index.html` | module mount, `_workSalt()`, `unitWorkProfile()`, `_cityWorkPanelHtml()`, `cityCardCollection()` payload, cloud salt merge, 4 card views, iframe buster. |
| `sql/038_work_crew_verify.sql` | **read-only**. There is no migration. |
| `.github/workflows/deploy.yml` | CI fix — see below. |
| `CLAUDE.md` | deploy-knob list corrected (was 3, is 4). |

**node-city functions modified** (check these first on any merge):
`tileMult` · `socketBoost` · `insFactors` · `insSystems` · `insWorkPane` ·
`insTopline` · `openInspect` · `tipHtml` · `openCardPicker` · `assignedCardIds` ·
`computeLinks` · `economyTick` · `serialize` / `loadState` · `vitalsTick` ·
`MythicCityBridge` (adds `getWorkSalt`) · `BUILDINGS` (nothing added — sockets
were deliberately NOT expanded) · boot (crew mount) · `__nc` diagnostics.

---

## THE DEPLOY PIPELINE WAS BROKEN — this is probably the headline

`deploy.yml` has **765 runs and zero successes**; the most recent failure is
2026-08-13. It is **not** a credentials problem — the token authenticates and the
job reaches wrangler before dying:

```
npx wrangler deploy
wrangler 3.90.0
ERROR  Missing entry-point: ... or the `main` config field.
```

`wrangler.jsonc` *does* declare `"main": "worker.js"`. `cloudflare/wrangler-action`
defaults to **wrangler 3.90.0**, and `wrangler.jsonc` support landed in **3.91.0** —
so CI's wrangler never reads the config at all. The repo has declared
`"wrangler": "^4"` the whole time; only CI was behind. That is why `npm run deploy`
by hand always worked and every `git push` silently did nothing, and why production
has been frozen.

Fixed in `a886df0`: `wranglerVersion: '4'`, plus `preCommands` running
`npm install && node build.mjs minify` — the action's bare `deploy` uploads
`index.html` raw at 11.5 MB against the 9.0 MB every hand-deploy has shipped.

### ⚠ Deploy sequencing — get this wrong and you regress production
`main` is `v120w6` and does **not** contain the city-visual work. Now that CI can
actually deploy, **a push to `main` will deploy `main`** — pushing that older build
over whatever is live. Land city-visual + this feature in `main` *before* main
starts auto-deploying again.

**To ship now:** GitHub → Actions → *Deploy to Cloudflare* → Run workflow →
branch `claude/unit-traits-abilities-rf3r88`. (An agent needs `actions: write` to
dispatch this; the session that wrote this had read-only and got a 403.)

---

## Verify after deploy

```bash
curl -s  https://playmythicspellbook.com/version.txt              # v120x9
curl -sI https://playmythicspellbook.com/src/work/work.js         # 200
curl -sI https://playmythicspellbook.com/src/work/crew.city.js    # 200   ← new dir
```
Then run `sql/038_work_crew_verify.sql` in the Supabase SQL editor (project
`ktsiasyjusesawtrwrjc`). It writes nothing. Its final query prints one verdict row;
`orphan_posts` must be 0 and salts must be distinct and non-empty.

---

## Gates (all currently green)

```bash
node _synckcheck.mjs public/index.html public/node-city/index.html   # ALL CLEAN
node .gauntlet/modcheck.mjs                                          # 175 modules
node .gauntlet/precommit-scan.mjs                                    # silent, exit 0
node build.mjs minify && node build.mjs restore                      # deploy's own step
```
`_synckcheck.mjs` does **not** look under `public/src` — `modcheck.mjs` is the only
gate that parses the two new modules.

---

## Still open

1. **Deploy.** One click, above.
2. **`user_profiles` is world-readable.** Pre-existing, not caused by this work, and
   deliberately left alone. Policy `user_profiles_public_display_name` is
   `FOR SELECT TO public USING (true)` and `anon` holds SELECT on all 15 columns —
   so anyone with the public anon key can read all 120 players' `gems`,
   `sovereigns`, `decks`, `heroes`, `units` and the whole `forge` blob. RLS is
   per-row, not per-column, so there is **no SQL-only fix**: `searchPlayers()` and
   `_lookupUserNames()` read `user_profiles` directly and would break. The fix is
   SQL + a small client change (point both at `msb_search_players()` — which
   already exists — plus a new `msb_lookup_names(uuid[])`, then drop the
   permissive policy).
3. **Balance.** 12 units cover ~12 of 44 posts in a built-out city. Intended
   scarcity; the owner has said leave it. Dial is `CREW_PER_HOUSING` in
   `crew.city.js`.
4. **PR #3 vs #2.** #3 carries only the iframe fix. If it lands first, #2 conflicts
   trivially on that line and the version knobs — take the higher version.

---

## Design decisions already made — do not silently reverse

* **Sockets stayed on four buildings.** An earlier cut gave every `gen`/`svc`
  building a card socket; it was removed. Per-building sockets make the player
  hand-solve a matching problem that grows as the city does, and running both
  systems gave one tile two unrelated ways to receive one card.
* **Assignment is manual, not solved.** The first cut auto-matched the whole crew
  greedily. It worked and was boring — a city with enough units played itself.
* **Rarity buys breadth, not depth.** A legendary caps at ×2.00 like everything
  else; it just rolls its primary at level 2–4 instead of 1–4.
* **`condMul` floors at 0.30, never 0.** A starving city should degrade, not become
  unrecoverable.
* **Crew is excluded from buildings the tick does not multiply** (Warehouse, Kalon
  Stable, Stadium, financial desks) and from the **Resting House**, which has `use`
  and no `gen` — a multiplier there would make it eat more and produce nothing.
* **A statistical bug was fixed in the roll.** The seed stream hashed
  `seed + '#' + i`; FNV-1a folds left-to-right, so consecutive draws differed by a
  constant and secondary suitabilities collapsed (Guarding 3,447 / 20,000 against
  Handiwork 0, expected 975 each). Counter now goes **in front** of the seed, plus
  a murmur3 `fmix32` finaliser. Do not "simplify" `stream()` back.
