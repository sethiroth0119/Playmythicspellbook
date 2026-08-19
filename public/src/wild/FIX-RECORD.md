# Where /src/wild actually landed, and what its own commit message got wrong

**Do not review `05f44a2` expecting to find this module in it.** That commit is
**comment-only on `/src/wild`** — a 20-line edit to the cost header. Its subject
line is `🌾 /src/wild — the ground stops being a table` and its body describes
the whole layer.

The 772-line module and all three of its `index.html` hooks landed in
**`0cb73a2`**, a commit whose subject is *"Mixed checkpoint: three agents
mid-write"*. A further 48-line fix landed in `bc08671`, whose subject is about
land value. The only `index.html` change in `05f44a2` is a **Districts**
self-check — a different agent's work entirely.

So the review you want is:

```
git diff 7b7fd23 05f44a2 -- public/src/wild public/node-city/index.html
```

## This is the third instance of one mechanism, and they are getting worse

| # | Commit | What the checkpointing did |
|---|---|---|
| 1 | `7c3271f` | Swept 167 lines of another agent's finished fix under an unrelated subject. See `public/src/demographics/FIX-RECORD.md`. |
| 2 | `47e230f` | Captured a line an agent had **deliberately broken** to photograph a "before" state, shipping a build where a fix was disabled while appearing present. Both syntax gates passed. See `public/src/districts/FIX-RECORD.md`. |
| 3 | `05f44a2` | Announced a module that had already landed two commits earlier, in a checkpoint that disclaimed it. |

A fourth, smaller: a `git add -A` sweep **deleted two probe scripts a critic was
actively using** (`.gauntlet/_crop.mjs`, `.gauntlet/_lc.mjs`) in `70cf142`. The
critic restored them and said so.

All four come from the same rule: a stop hook requires a clean working tree every
turn, several agents write to that tree continuously, and "commit everything that
is dirty" therefore samples other people's work at an arbitrary instant — and
then describes that sample with a subject line written about something else.

`.gauntlet/precommit-scan.mjs` (added after #2) closes the worst of these: it
refuses to snapshot a line marked as deliberately broken. **It does nothing about
#1, #3 or #4**, which are attribution and collateral, not correctness. Those are
still open, and the mitigation is the one this file is: when a checkpoint has
misfiled something, say where it really is, next to the code, rather than trusting
the history to explain itself.

## The substantive correction the critic made

The commit message repeats the builder's claim that mid-bin terrain mean
`0.546 → 0.528` is a regression "against round 5's defended target of 0.531".
**That comparison is invalid.** `index.html:5189` defends 0.531 as the *authored
ramp mean, measured off the stops* — an albedo constant, not a rendered pixel
statistic. The baseline *rendered* mid-bin was 0.546, already +0.015 away from it.
On the builder's own framing, **0.528 is closer to 0.531 than the baseline was.**

The builder then lifted both scrub palettes ~10% brighter to close a gap that did
not exist, spending exactly the contrast the module exists to create. Recorded
here because it will otherwise be re-derived wrongly: **an authored albedo
constant and a rendered pixel mean are not the same quantity and must never be
compared.**

## And the honest scoreboard

The commit claims the layer answers the round-9 finding for two rubric
dimensions. It answers one.

- **Vegetation 5.0 → 6.0.** Real and verified: genuine thicket/bald structure at
  the aerial camera, `localContrast +35%`, within-bin SD up in all five bins,
  deterministic, 3.2% of triangles and 2 draw calls, survives night, save/load
  and a full map.
- **The plot 5.0 → 5.0, no change.** Dimension 5 is entirely about a *building's
  parcel* — "No building sits on bare ground". This module skips every occupied
  tile **by construction**, and the critic measured 0 of 39,390 standing vertices
  on an occupied tile. It cannot move that dimension and was never going to.
  That job is `/src/parcel`'s.

Also: the per-framing diffs in the commit message (aerial 18.1%, district 14.0%)
are roughly **eight times** the layer's real contribution. Measured against a
do-nothing control at identical spacing, the net is aerial **+2.25pp**, district
**+1.67pp**, street **+0.78pp**, against drift floors of 2.19 / 3.44 / 5.80.
And "+2 meshes" was never a measurement: the probe computes the `off` count by
subtracting `g.children.length`, so it is arithmetic that cannot fail.
