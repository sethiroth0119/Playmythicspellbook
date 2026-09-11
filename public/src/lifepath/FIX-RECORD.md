# Where /src/lifepath actually landed — twice, neither under its own name

Two separate bodies of work on this module were both misfiled by the
orchestrating session's checkpointing. Neither commit that describes them
contains them.

| What | Announced in | Actually landed in |
|---|---|---|
| The module itself (`tuning/model/index.js`), both `facts.js` rows, the mount block | `9f00178` "🧬 /src/lifepath — citizens get an age and a career" | **`cd801a7`** "🔒 Districts: close the save door" |
| The twelve critic fixes (`facts.js` +198, `model.js` +306, `tuning.js` +74) | *nothing* — see below | **`fb9d977`** "🌾 The tufts became grass, and the rebuild stopped dropping frames" |

So the reviews you want are:

```
git diff 47e230f cd801a7 -- public/src/lifepath public/src/citizen/facts.js
git diff ec3cb17 fb9d977 -- public/src/lifepath public/src/citizen/facts.js
```

This is the **fifth** instance of one mechanism. See `public/src/wild/FIX-RECORD.md`
for the running tally and the cause; `.gauntlet/precommit-scan.mjs` (the third
gate) closes the dangerous variant — capturing a deliberately-broken line — but
does nothing about attribution, which is what this is.

---

# What the twelve fixes actually were

A critic split the verdict: **Age earned its row; Job level did not.** All twelve
findings reproduced before anything was touched. None was wrong.

## The big one — a sample sitting in a `DERIVED` row

`careerOf` → `ageOf().years` → `workedYears = age − 18` → `tenure = min(workedYears,
siteYears)`. Whenever the building is older than the worker's career, tenure **is**
`age − 18` exactly, so the grade is a pure function of the sampled age. Measured:
**39 of 40 citizens** in a mature city.

`careerOf()` now returns `sampled: true` **exactly when `tenureFrom === 'worklife'`**,
and the row prints `≈ Grade N of C` with a source line leading on SAMPLED. When the
site binds — a real `tile.born` stamp — the row stays `DERIVED` and unmarked.

**Relabel was chosen over UNAVAIL, per citizen rather than blanket**, on three
arguments, the third deciding:
1. The number is not plausible-looking fiction — it is a true *ceiling*, and with
   the source sentence fixed the row names the term doing the capping, so it reads
   "at most", not "is".
2. UNAVAIL would take the *cap* down with the grade, and "of 3" is a live reading
   off the employer with no draw in it. Refusing an earned reading because the
   number beside it is a sample is its own dishonesty.
3. **This module already prints a sample on the Age row and defends it.** If `≈`
   plus SAMPLED suffices there, it suffices for a quantity derived from it — and if
   it does not, the Age row has to go too.

Regime sweep, the test the original driver never ran: 0.5-year buildings → 0/40
sampled; 5-year → 3/40; 60-year → **39/40**; flag mismatches **0** at every point.

## D6 — WAS "cannot be fixed here". FIXED, from the other side.

Demolish-and-rebuild demoted a whole workforce (tenure 23.6 → 0.0, grade 3 → 1).
The diagnosis above was exactly right and named its own cure: `firms.js found()`
wrote **no founding time at all**, so the only stamps in reach were a hire date on
the roster or a stamp on the firm record. The firm stamp was written, in the file
that owns the firm record:

- **`firms.js`** — `found()` writes `foundedDay`, the economic day the business
  opened, taken from a registered clock source (`setClockSource`, the same seam
  shape as `setCapitalSource` / `setEstateSink`, and for the same cycle reason).
  One integer, written once, never re-written, riding `serialize()`/`load()`.
  It moves no money: `totalCinder()` is invariant across it by construction.
- **`model.js`** — the ceiling reads the age of the **business** instead of the age
  of the **building**. The site term is not kept as a third `min()` — after a
  rebuild it is the smallest of the three, so keeping it would re-admit the whole
  defect with the new stamp sitting unused. `siteYears` is still reported, so the
  row can say "the walls are younger than the business in them".
- **`facts.js`** — a third `ceilWords` branch (`'firm'`), which names the founding
  day and, on a rebuild, says why the ceiling did *not* move.

Measured, `.gauntlet/critlife-5-career.mjs`, same citizen, same firm at level 5, the
same demolish-and-rebuild of its tile:

| | tenure | grade |
|---|---|---|
| unstamped firm (a pre-stamp save) | 60.0 → **0.0** | 5 → **1** |
| stamped firm | 59.99 → **59.99** | 5 → **5** |

Whole roster through the same rebuild: **0 of 40 grades changed**, mean grade
4.30 → 4.30. It was 40 of 40 changed, mean 4.30 → 1.00.

**A successor still starts at zero.** The stamp is on the firm RECORD, not the tile,
so `syncBuildings` re-founding a tile produces a new record with today's day —
measured through the shipped seam: predecessor firm 15 `foundedDay 0`, successor
firm 16 `foundedDay 62`. Stamping the tile would have merged exactly the two things
the closure log exists to separate.

**An old save has no stamp, and does not pretend to.** `load()` maps a missing (or
negative, or non-finite) field to `null` — never 0, which would say "as old as the
city", and never today's day, which would demote every business in a mature city
the moment you reloaded. The ceiling then falls back to the building and the row
says so, word for word as it read before. A city heals one business at a time as
tiles turn over.

### What is STILL not fixed, and it is the honest half

**There is no hire date, so tenure is still a ceiling.** Firm age is a real bound
and a much better one than masonry — it stops moving for reasons that have nothing
to do with the person — but "this business has traded 40 years" is not "this person
has worked here 40 years". The honest answer needs a stamp per *(citizen, employer)*
pair, written where the seat is assigned. It was not built, and the cost is:
a `hiredDay` on the roster's employment record, written by whatever assigns the seat
and re-written on every job change; that field in the roster's save slice; and
**nothing in /src/lifepath**, which is read-only over the roster deliberately.
Writing it from here would make a career depend on when a panel was first opened
and reset every career on reload.

### And the SAMPLED mark did not go away

It moved toward more honesty, not less. `sampled` is still exactly
`tenureFrom === 'worklife'`, and in a mature city the business outlives any single
career, so the worklife still binds for **39 of 40**. What changed is the *other*
branch: a rebuild used to throw the whole roster into a site-bound 0.0 years printed
under **DERIVED** — a wrong number wearing the stronger label. Those rows are
worklife-bound and marked SAMPLED now. Measured in `critlife-9`: rebuild regime,
unstamped 0/40 sampled at mean grade 1.00; stamped 39/40 sampled at mean grade 4.30;
**flag mismatches 0** in every regime, stamped and unstamped alike.

## D8 — the drift: disclosed, not re-dealt, not aged out

The module claimed the deal *"corrects for drift as people age out of one band into
the next"*. It cannot: `seed()` returns early once every id has a stamp, nobody
dies, and `citEnsure` trims from the *end*, so the permanent core of the roster is
exactly the part that drifts. Measured: within bound at 2 real hours, outside it at
3, and at 80 hours the roster has **zero** young adults against a city saying 25.8%.

- ✗ **Re-deal** — rejected. It buys the headline back by breaking the module's one
  real promise: a citizen who was 34 last time you looked and is 61 now is not
  drift, it is a different person.
- ✗ **Age out** — the only genuine fix, and it requires *writing* to the roster,
  which would make this a second citizen store. If the roster ever gets mortality it
  belongs in the citizens layer.
- ✓ **Disclose.** `distribution()` returns `withinBound` and a live drift sentence,
  and the Age row prints it: *"About three real hours of play is enough to put the
  largest band outside that one-person bound, and it is outside it now."*

## The rest

- **D2** Two analogies were presented as derivations. `ECON.firm.levels` is a
  *company-size* ladder gating on headcount, revenue and customers — nothing in it
  is about a person — and `graduatePerDay` moves an *in-school household* one
  education rung. Numbers unchanged, claims fixed, and each now carries the argument
  for why it is the least-bad analogy plus a rejected alternative.
- **D3** The value printed the employer's size class where a player reads a title.
  It is now `≈ Grade 3 of 3`, full stop; "🏢 Major Business" moved into the source
  line and is explicitly called a company-size class and not a job title.
- **D4** The source sentence always named the worklife as the cap and was backwards
  on every citizen the original driver tested. It branches on the binding term now.
- **D5** A firm naming a tile with no `born` stamp made the panel report the *city's*
  age as a named building's age. `siteFrom` has a third value, `'gone'`; the value
  stands, the sentence no longer claims a building.
- **D7** `LIFE.round` was a constant nothing read, documenting a guard that did not
  exist — and falsifying the "exactly two numbers are written down" headline. Deleted,
  and the guard now exists: `seed()` floors rather than rounds, so a read age can only
  ever be ≥ the drawn age. 200 citizens, 0 reading below `workAge`.
- **D9** The save control measured the clock, not the deal — all 40 stamps moved by
  exactly the clock delta, which is arithmetic. Kept and labelled as such, with the
  real control beside it: same clock, pyramid moved through the *shipped* pipeline
  from 4 people to 82, **16 of 40 differ**.
- **D10** "Agreement by construction" retracted as one assumption written twice. The
  genuinely independent corroboration is now cited: `graduatePerDay` 83.3 days ÷ a
  3.5-year degree ⇒ **23.81** days/year against 24.04 — two rates, two anchors, 1%
  apart. And what `agePerDay` *is* at its use site is stated: a cause-specific hazard
  on `couple`/`single` only, ≈2–17% of exits depending on zone, with `family` and
  `student` never ageing by that path.
- **D11** "at FIRM LEVEL 1" under "Grade 3 of 3" was a contradiction, and the stated
  reason for not fixing it — "a second opinion about pay" — failed on its own terms,
  since two fields of the same table is the same lookup `firms.js` makes in all three
  of its wage lines. Now: *"paid 47.04 🔥 an economic day: bands.unskilled.wage (42) ×
  the ×1.12 a level-3 employer carries."*
- **D12** `ageOf()` refused nothing: `≈ -6 years · 🧒 Children` returned `ok: true`.
  It now refuses below `workAge` with a reason — and the floor has a model behind it,
  which is why one could be justified at all. **Deliberately no ceiling to match:**
  there is no maximum age in ECON to read one off, so clamping the top would be the
  very thing this file forbids.

## The 1.32% that was not evidence

No comment in the tree cited it — it lived only in a gitignored shot artifact — so
nothing needed correcting. The correction was recorded where the claim is made, in
`distribution()`'s header, with the real evidence (3 pyramids × 10 roster sizes,
30/30 within bound, worst 0.77% against 2.50%) and a block in the driver warning the
next reader off that percentage, printing `cityTotal_people` beside it. Same for
"15 citizens crossed a career rung": the driver now reports
`gradesThatActuallyMoved: 2, tenureRungsCrossed: 15, heldByTheEmployerLevel: 13`.

## The "of 3" — closed

The fixer volunteered this and was right: **"≈ Grade 2 of 3" reads as "this employer
has three grades", and that count is the analogy rather than a reading.** The `≈`
marks the whole string, so a reader takes it as approximating the *grade* — which is
precisely the half that is NOT the analogy. `ECON.firm.levels` gates on headcount,
revenue and customers; nothing in that table is about a person.

The value now reads **`≈ Grade 2 of an assumed 3`**. The left half is a claim about
the person and carries the sample mark; the right half is a claim about the model
and carries its own word, so the two are separable without opening the source line.
The source line names it again in place: *"of 3" is a modelling choice and not a
reading — the level 3 itself IS a reading, and only its reinterpretation as a rung
count is not.*

- ✗ **Move the cap out of the value into the source line** — rejected. The cap is
  the one part of this row with no sample in it (`MythicEconomy.firm(n).level`,
  live), and hiding an earned reading because its reinterpretation is an analogy
  trades one dishonesty for another. It is printed, and it is labelled.
- ✗ **A second `≈` on the count** — rejected. Two hedges in one value read as one
  hedge repeated, and this is not an approximation: an *assumed* quantity is not an
  imprecise one.
