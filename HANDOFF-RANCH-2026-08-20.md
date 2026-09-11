# Handoff — the Ranch (Monster Rancher camp layer), written 2026-08-20

Everything below is verified against the working tree and the branch, not from memory.
Where something is **not** verified, it says so.

## Where things stand

| | |
|---|---|
| Branch | `claude/monster-rancher-camp-feature-s28rxi` |
| HEAD | `540aa1b835` |
| `main` | **not** merged — branch is 5 commits ahead |
| Pushed | yes, branch is on GitHub |
| Working tree | clean |
| Version knobs (in repo) | `v120x1`, all three moved together |
| Deployed | **no.** Nothing has been deployed. |
| Live edge version | **unknown** — could not be reached from the sandbox this was built in (see *What is not verified*) |

Five commits, ~1,900 lines. Nothing is half-finished: every item is written, driven
headless, rendered in Chromium, committed and pushed. But **none of it has run inside the
real game**, which is the single most important thing on this page.

## What shipped

| Commit | What |
|---|---|
| `d19401d` | The Table + praise/scold — the reply half of banter |
| `79f6ec8` | Bunkhouse Light/Hard drill — training costs fatigue and morale |
| `9f3d547` | Favourite items + unprompted gifts |
| `0c31719` | Breeding inherits the relationship, not just the stats |
| `540aa1b` | The quartermaster speaks on camp arrival |

The premise for all five: this game already had an unusually deep relationship layer —
`BOND_TIERS`, `UNIT_TEMPERS`, `valueProfile`, `UNIT_MEMORY_KINDS`, rapport, requests,
banter, grievance, `refuseDeploy`. What it lacked was a place to *see* a unit whole, and
a verb for the player to *answer* with. That is what this adds. Very little of it is new
data; most of it is a use for data that was already being stored and never surfaced.

### 1. Praise / Silence / Scold

The banter dialog used to end in one button — *"…I hear you"*. The companion spoke and
nothing came back. Now three, and they mean **one thing on one axis**:

```
praise  = I endorse what you believe   bond ↑   conviction ↑
silence = I am not discussing it       bond ↓
scold   = you are wrong to believe it  bond ↓↓  conviction ↓
```

Only the wording changes with the verdict (*"Concede the point" / "Overrule them"* when
the unit is aggrieved), because "praise" is the wrong English word for agreeing with
someone who just complained at you.

**Conviction** is new per-unit state: ±12 per value pole, stored on `Profile.units[id]
.conviction`. It scales how sharply that pole reacts to future battles, **0.50×–1.50×**,
and is **exactly 1.00 when nothing has been said** — a roster that never touches the
feature scores precisely as it always did.

The real decision: overruling is the only tool that both clears a `refuseDeploy` **and**
softens the pole behind it, but it is paid for in loyalty — and loyalty is the XP
multiplier (up to 2.0× at Sworn) and the gate on how much of itself a companion shows
you. Conceding eases the grievance now and hardens the value for good. Neither is the
"good" button.

### 2. Bunkhouse drills

Every bed is Light or Hard. Light is exactly what the House always did.

| | rate | fatigue/hr | morale/hr |
|---|---|---|---|
| 🌿 Light | ×1.00 | 0 | 0 |
| 🏋️ Hard | ×1.80 | +2.2 | −1.1 |

One 6h collect cycle on Hard: **+50 Resonance for 13 fatigue and 7 morale**. The full 36h
accrual cap: **+302 for 79 fatigue**, which on its own takes a unit most of the way up the
0–100 field. Above **70** fatigue a unit refuses to *start* a hard drill; at **100** an
in-progress one drops to the light rate and flags `spent`. Recovery is the existing
Med-bay Medicine sink (`campTreatUnit`) — no second recovery economy.

Only the *rate* moves. doc §9 forbids raising the 510 ceiling and reserves CAPACITY and
RATE as what a building may change; hard drill changes how long a card takes to reach the
ceiling everyone shares, not the ceiling.

### 3. Favourite items and unprompted gifts

Items only ever flowed on demand (`_lqGenerate` opens a request → `_LQ.equip` pays it
off). The player could never simply give. Now every unit has a favourite **hashed from
its card id**, the same rule `getUnitTemper` follows — so every player's Ashen Pikeman
wants the same thing and a favourite is a knowable fact about the card, not a per-copy
puzzle. Forge authors can override with `card.favourite` / `card.favorite`.

Favourite pays **+34, +5 per bond tier**; anything else **+8 flat**. Capped at roughly
what fulfilling a *request* is worth — an unprompted gift that out-earned the thing they
actually asked for would kill the request system. **20h per-unit cooldown**: without one,
twenty spare Power Bands buys a companion from Wary to Sworn in a sitting.

Discovery gates at **Steady**. Below it a lucky guess pays in full, but neither the reply
line nor the toast admits it was the favourite — pay it, don't say it, or the gate is
decorative.

### 4. Breeding inherits the relationship

`breedParents()` already crossed stats, elements, the full movepool, passives and values —
then threw the relationship away. Two Sworn veterans produced a stranger at Neutral with
a temperament hashed off its brand-new random id.

An heir now carries **temperament** (from whichever parent trusted you more), **bond**
(Steady if one parent was Devoted+, Trusted if both), and **one memory** rewritten as a
story it was told — *"Carries a story: its blood refused to fall at one hit point.
(Ashen Pikeman)"*.

What it still has to earn is the design. Bond caps at **Trusted** however devoted the
parents were, so Devoted and Sworn stay things you reach with a *specific* companion.
Exactly one memory crosses — inherit a whole history and a day-old card displays "Fifty
battles together," claiming battles it wasn't at.

### 5. The quartermaster

One line on camp arrival, about one companion. Priority is **actionable over
atmospheric**: refusing to deploy → a request you can fill today → queued banter →
corruption → trauma → fatigue → morale → a favourite sitting in the stores → a warm line
when the roster is fine.

Three rules keep it a voice rather than a notification system: one companion at a time;
it repeats neither the companion nor the subject it raised last; 30-minute floor between
remarks. And the list does not end at bad news — a camp where the quartermaster only ever
brings problems teaches the player to dread the line.

## Architecture

New code is **`public/src/ranch/*.js`**, ES modules, per CLAUDE.md. Registered on
`window.MythicRanch`, inert until something opens it.

| File | Lines | DOM? | Globals? |
|---|---|---|---|
| `judgement.js` | 259 | no | no — pure |
| `gifts.js` | 146 | no | no — pure |
| `lineage.js` | 147 | no | no — pure |
| `steward.js` | 132 | no | no — pure |
| `table.js` | 612 | yes | bridge only |
| `index.js` | 128 | no | bridge only |

The four pure files are functions of their arguments — no `Profile`, no `document`, no
imports. That is what made every one of them drivable headless in Node, which is how the
bugs below were found.

### The bridge

`window.MythicRanchBridge`, built by hand in `index.html` next to `MythicHouseBridge`.
The globals trap is real and cost this project time twice already: `Profile`, `App`,
`adjustBond`, `getBondTier`, `resolveDeckCard` are top-level `const` / `function`
declarations — **global lexical bindings, not properties of `window`**. A module cannot
see one of them.

**🔴 The one rule to preserve: the bridge exposes `adjustBond` and NOT a writable
`bond`.** That asymmetry is the whole safety story. `adjustBond()` is the single choke
point where temperament scales the change and `bondCeilingFor()` caps it (sale count,
first-owner Sworn). A module that could assign `prof.bond = n` walks through both — a
scolded Vain unit would take a flat hit instead of its 1.50×, and a resold card could be
pushed back above a ceiling the marketplace lowered on purpose.

### Where it plugs into `index.html`

Line numbers shift; these are greppable anchors.

| grep for | what it is |
|---|---|
| `window.MythicRanchBridge` | the bridge (next to `MythicHouseBridge`) |
| `src/ranch/index.js?v=` | the module script tag — **bump `?v=` on every change**, the SW caches `/src/*` |
| `_LQ.judge` | the three banter buttons + the delegate |
| `CONVICTION (/src/ranch)` | the one hook into battle scoring, inside `_lqValuesEval` |
| `data-table=` | the Table's entry points on a camp slot |
| `THE LEGACY` | the heir seed inside `hatchCore` |
| `THE QUARTERMASTER (/src/ranch` | the camp-arrival call in `renderCamp` |
| `stewardLast` | bridge accessors **and** the loader whitelist entry |
| `unitFatigue` / `applyStrain` | drill strain, on `MythicHouseBridge` |

Drill logic itself is in the **shared** `src/resonance/house.core.js` (so the city Resting
House can adopt it later); `house.camp.js` only renders it and lands the strain.

### Persistence

Everything rides `Profile.units[id]`, which the loader restores wholesale — no whitelist
needed for `conviction`, `judged`, `lastGiftAt`, inherited `temper` / `memories`.

**One exception: `Profile.stewardLast` is a new top-level field and IS whitelisted** in
the loader (grep `stewardLast`). This matters — `saveProfile()` stringifies the whole
Profile but the loader is a field whitelist, so an un-whitelisted field saves and is
silently dropped on reload. This project has shipped that exact bug four times
(`sideDeck`, `archonDeck`, `salvage`, `bunkhouse`). **If you add another top-level field,
whitelist it in the same change.**

No SQL. No migrations. No new tables, no RLS to review, no npm dependencies.

## What is NOT verified — read this before deploying

1. **It has never run in the real game.** Every module was driven headless against a
   *stubbed* bridge and rendered in Chromium from a preview page. The wiring into
   `renderCamp`, the banter dialog, `hatchCore` and `_lqValuesEval` is verified by
   `node _synckcheck.mjs` (clean) and by reading the seams — not by playing it.
2. **The live edge version is unknown.** `curl` to `playmythicspellbook.com` and the
   `pages.dev` host both returned `http=000` from this sandbox — outbound is restricted
   here. Check what is actually live before you deploy over it.
3. **Card art rendered as emoji** in every screenshot because the sprite resolver was
   stubbed. `_staticSpriteThumb` is wired through the bridge but has not been seen
   returning real art.
4. **The Table has not been opened over the bunker iframe.** It mounts at
   `z-index 2147483400`, above `#base-builder-frame`'s `2147483300`, the same trick the
   Bunkhouse overlay uses — but that stacking has only been reasoned about, not observed.
5. **Nothing has been balance-tested against a real save.** The drill numbers, gift
   values and conviction multipliers are all defensible on paper and were sanity-checked
   arithmetically; they have not met a live economy.

## Deploying

```bash
node deploy.mjs
```

Three knobs must move **together** or the in-app update check breaks — they are already
at `v120x1` in the repo: `public/version.txt`, `window.BUILD_VERSION` in
`public/index.html`, `CACHE_VERSION` in `public/sw.js`.

Syntax-check with `node _synckcheck.mjs` — **not** `build.mjs`. (It needs `npm install`
first; `terser` was missing from a fresh clone.)

Verify at the **edge** with curl, never the deploy log, and poll — propagation takes a
couple of minutes.

⚠ Also bump `?v=` on `src/ranch/index.js` (and `house.camp.js`) whenever those change.
The service worker caches `/src/*` like any other static asset.

## Three bugs found during the work — worth knowing about

**Scolding never broke the spiral.** The first version of the judgement deltas *added*
grievance on a scold, on the theory that resentment should worsen before it improves.
Driven against a Zealous refuser that meant five presses, −155 loyalty, and
`refuseDeploy` still true the whole time — the button the design calls "how you break the
spiral" only bled. A cost with no mechanism attached is a dead button, not a hard choice.
Overrule now discharges grievance (−10). **Found by the headless harness, not by reading.**

**Both toasts reported the wrong number.** `judge()` and `gift()` printed the bond they
*asked* for, but `adjustBond` applies temperament and clamps to `bondCeilingFor()`
afterward — a Vain unit scolded for a nominal −15 lost 31, and a unit at its ceiling
gained 0 while the toast claimed +49. Both now measure `prof.bond` across the call and
report what landed, and say *"they are at their loyalty ceiling"* rather than printing
"+0 loyalty", which reads as broken.

**Every meter rendered as an empty groove.** The bars are `<span>`s and `height` does not
apply to an inline box. The track survived because a flex parent blockifies its children;
the *fill* is one level deeper and does not. **Found by screenshotting** — every logic
test was green.

The pattern worth carrying forward: the pure-module split is what made the first two
findable at all, and the third was only ever going to be caught by looking at it.

## Next

Two things from the original ranked list that were scoped out, both cheap now:

- **A career rank ladder.** The service record is on the Table but unranked. Monster
  Rancher gives every monster an E→S rank and a W/L line, which is what turns a unit into
  a *someone*. All the data (`fielded`, `kills`, `together`) is already stored and shown.
- **Retirement.** A voluntary, honoured end-of-career that converts a unit into a legacy.
  This is the piece that makes the lineage work land emotionally, and commit `0c31719`
  did most of the groundwork.

Deliberately **not** recommended: true lifespan / death by old age. It is Monster
Rancher's emotional core and it is wrong here — units are tradeable assets
(`saleCount`, `everSold`, `bondCeilingFor` exist because cards move through a
marketplace), and a card that expires on a timer is a depreciating asset in a system with
real payment rails. Permadeath from Deep runs already provides loss the player *chose*.
