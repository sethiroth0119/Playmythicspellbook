# 🍔 MYTHIC KITCHEN — HANDOFF

Branch `claude/fast-food-simulator-game-am5zpl`. Nine rounds of build-and-critique;
two slices (the premise, and convoys) beat the commercial reference, three finished
close with named work left. Everything below is verified, not assumed — where a number
appears, it was measured.

---

## PART 1 — PUT IT IN THE GAME

### 1. Apply the migration

`sql/038_kitchen_convoys.sql`, by hand in the Supabase SQL editor for `ktsiasyjusesawtrwrjc`.

Verified on a clean PostgreSQL 16 with a Supabase shim: applies at exit 0, **40/40 checks
pass**, and three consecutive runs give identical output (it is idempotent, as CLAUDE.md
requires). The last statement is a verify block that prints its own pass table — 41 rows,
40 reading `ok` plus one informational row showing the seeded tiers. **Any row reading
`FAIL` means stop.**

⚠ It reads `auth.users.created_at` (real Supabase has it) and searches
`public.user_profiles` (your project already has it, via `supabase-msb-public-profiles.sql`).

⚠ If you ever applied an earlier copy of this file, **re-run it**. Round 1's version shipped
a claim RPC that could pay twice and a path where the device clock decided when a truck
landed. Re-running fixes both.

Until it is applied, convoys degrade to local practice runs behind an honest banner. That is
designed behaviour, not breakage — you can ship the client first.

### 2. Bump the three deploy knobs together

CLAUDE.md: bump all three or the update check breaks.

| knob | where |
|---|---|
| `public/version.txt` | whole file |
| `window.BUILD_VERSION` | `public/index.html` ~line 36444 |
| `CACHE_VERSION` | `public/sw.js` ~line 414 |

### 3. Verify the edge, not the deploy log

CLAUDE.md again: check with `curl` against the live edge and poll — propagation across PoPs
takes a couple of minutes.

### What is already wired

`index.html` carries exactly what CLAUDE.md allows, and its diff has stayed at **158 lines
across an 11.6 MB file** for the whole run:

- `window.MythicKitchenBridge` — next to the other three bridges (~207310–207500)
- one tile — resolves to `null` when the module did not load, so a broken module is a
  missing tile rather than a dead button
- one `<script type="module">` tag

---

## PART 2 — THE RESTAURANT OPERATION IN JUST BUSINESS

This is smaller than it looks. **The Just Business catalog is built from
`Object.keys(OPS_ECON)`**, so a new operation is two edits, plus two optional ones that make
it feel native.

### Edit 1 — the economy row (required)

`public/index.html`, in `OPS_ECON` (~line 79732), next to `genelab`:

```js
  /* 🍔 RESTAURANT — the licence to run a Mythic Kitchen, and the industry that
     feeds it. Two jobs on purpose, exactly like genelab: owning it unlocks the
     kitchen, and staffing it is what turns the city's food into Cinder.
     `yields: {}` because a restaurant earns Cinder over the counter, not
     resources — the same reason bank and dojo carry it, and it must never be
     swept up by the production-pressure hook (cxProduce).
     `inputs: { food: 1.0 }` is the whole point: this is the only operation whose
     feedstock is the thing the player's agri ops and city produce. Short of
     food, it visibly runs at 40% rather than silently stalling (see the supply
     throttle above _opSettle) — which is the same lesson the kitchen itself
     teaches on its Supplies sheet.
     Sized between agri (300k, its supplier) and construction (350k): a storefront,
     not heavy industry. */
  restaurant:   { startup: 320000, ratePerWorkerHr: 780,  salaryPerWorkerHr: 190, maxWorkers: 10, yields: {}, inputs: { food: 1.0 } },
```

Precedent for `inputs` with no `yields`: `smuggling` already ships that shape.

### Edit 2 — the label (required, not cosmetic)

`OP_LABELS` (~line 79979). The catalog falls back to the raw key, so without this the shop
lists it as "restaurant" in lower case:

```js
  restaurant: 'Restaurant',
```

### Edit 3 — unlock the kitchen from owning one (recommended)

`_opAfterFound()` already does exactly this for two other ops — founding Fishing unlocks
Woods Fishing, founding Cars unlocks Prince Portfolios. Add the third:

```js
  // 🍔 Restaurant → Mythic Kitchen.
  if (opId === 'restaurant') {
    try {
      Profile.kitchenUnlocked = true;
      try { saveProfile && saveProfile(); } catch (_) {}
      showToast('🍔 MYTHIC KITCHEN unlocked! Open it from the Ruin Exchange.', 7200);
    } catch (_) {}
  }
```

Then gate the tile on it, following `_geneLabOwnsLicense()` (~line 80293) verbatim — it is
the recognisable house way to ask "does this player hold that licence", it accepts an
admin/manual grant, and it reads the **cloud-backed** `Operations.list` so the licence
follows the account rather than the device:

```js
function _kitchenOwnsLicense() {
  try {
    if (typeof isAdmin === 'function' && isAdmin()) return true;
    if (Profile && Profile.kitchenUnlocked) return true;
    if (typeof Operations !== 'undefined' && Operations.list && Operations.list.some(x => x && x.op_type === 'restaurant')) return true;
  } catch (e) {}
  return false;
}
```

⚠ **Decide deliberately whether to gate it.** Round 7's premise critic — the one reading the
original request, which won twice — spent four rounds proving the feature is only good when a
new player can reach it immediately. Gating the kitchen behind a 320,000-Cinder licence
re-creates, in the shop, exactly the wall that took three rounds to tear out of the level
ladder. **The safer shape: leave the kitchen open to everyone, and make the Restaurant
operation the thing that makes it pay** — better rates, more stations, higher convoy tiers.
The licence then buys scale, not entry.

### Edit 4 — give it a walk-in interior (optional)

`cardshop`, `dojo` and `bank` have interiors you can walk into in the city. The kitchen is
already a full-screen interior, which makes the restaurant the natural fourth. In
`window.cityOpsState()` (~line 207913 and ~207922), both ternaries:

```js
interior: (t === 'cardshop' || t === 'dojo' || t === 'bank' || t === 'restaurant') ? t : null
```

…and route that interior to `window.MythicKitchen.open()`.

### What you do NOT need to touch

No SQL. `op_type` has no CHECK constraint or enum, so the new type needs no migration. The
admin Operations Economy editor picks the row up automatically and can retune every field
live — `_opEcon()` merges overrides per-operation, so a partial edit leaves the rest on the
default.

---

## PART 3 — WHAT IS KNOWN-OPEN

Honest state, from the round 8 critics. None of it blocks shipping; all of it is named.

**Drive-thru (close).** Every customer leaves happy regardless of what you did to them —
`settle()` sets `car.mood` without reference to the promise verdict, so the mechanic is
invisible on the last line the player reads.

**The screen (close).** The first frame a new player sees contains no food: five empty pans,
"Service is closed", four red zero-chips. REF-A opens on a row of finished pizzas; REF-B
hands you a griddle full of patties.

**Game truth (close).** Popularity still does not separate a good player from a great one
across ten days — open for four rounds. The data builder's own note says a data table may not
be able to fix it.

---

## PART 4 — THE MAINTENANCE TOOL

```
node public/src/kitchen/kitchen.selftest.js     # 0 FAIL · 68 WARN
__mk.selftest()                                 # same, in the browser console
```

It exists because the same defect shipped in **every single round** — a value computed and
never consumed. Telling builders to check their call sites failed five rounds running, so
round 6 stopped asking and built a checker. It immediately caught two previously
*reported-closed* fixes that nothing called.

Two arms:

- **static** — dead exports, ECON keys read but never declared (that class silently evaluates
  to `undefined`), cross-file property mismatches, contract drift, comments that lie
- **execution** — instruments all 168 `catch` blocks in a temp copy, plays a 280-second shift
  through the player's own doors, lands a convoy, and asserts **values**: the till against the
  chip in Cinder, that a kept promise never costs and a broken one never pays, that the stash
  actually rises by what the arrival quoted

Run it after any edit to `/src/kitchen`. If you add the Restaurant op, run it then too — it
will not check `index.html`, but it will tell you if the kitchen's own wiring moved.

⚠ It keeps a **score baseline** (`BASELINE` in the file). If you change kitchen code and the
SCORE check fails, that is working as intended: read the diff line by line, then
`--baseline` and paste the literal. Do not bless a number you have not read — the comment
above it records exactly which counts were accepted last time and why.

---

## THE FILE MAP

| file | owns |
|---|---|
| `kitchen.data.js` | every number and id. The `_opEcon()` rule generalised — a number written anywhere else is a bug |
| `kitchen.state.js` | the sim: shift clock, tickets, stations, the burn ladder, quality, popularity, pantry |
| `kitchen.render.js` | every pixel |
| `kitchen.css` | all styling, namespaced `.mk-*`, mobile-first |
| `drivethru.js` | NPCs, the lane, patience, tips, 275 authored dialogue lines |
| `convoy.js` | composing, transit, arrival, claim |
| `kitchen.api.js` | every Supabase call, guarded — a 404 is an empty list |
| `kitchen.bridge.js` | the seam, with a `NULL_BRIDGE` so it plays offline |
| `kitchen.selftest.js` | the checker above |
| `index.js` | entry point, the one rAF loop, never throws at import |
| `CONTRACT.md` | the signatures. Kept honest by the self-test's drift check |
