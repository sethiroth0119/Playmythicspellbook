# Open breaks — found by the regression gate, NOT yet fixed

These were surfaced by the function-inventory gate (the agent that enumerated every
battlefield function the game had before this work and tested each one on the new board).
They are real, they are about the code as it stands at commit `ebdfef5`, and they are the
class of bug this whole run exists to prevent: **the rules and the picture disagreeing.**

Verified present by the lead before recording.

---

## 1. Knockback, pull, vortex and ice-slide shove along a SQUARE diagonal

`public/index.html:93241-93242`, `:100949`, `:100979` (and the comment at `:100934`
that already admits it was deferred):

```js
const dx = isPull ? Math.sign(ox - tx) : Math.sign(tx - ox);
const dy = isPull ? Math.sign(oy - ty) : Math.sign(ty - oy);
```

`Math.sign(dx)` / `Math.sign(dy)` picks one of the **eight square directions** and steps
along it. On a six-direction lattice, two of those eight are not directions at all.

Measured by the gate: a shove from `(6,7)` landed the target **two hexes away, straight
through an enemy standing on the true neighbour.** The unit passes through an occupied
tile, which no other movement path in the game permits.

This was deliberately left alone in the hex wave because it lives inside combat
resolution, which that wave was forbidden from editing. That was the right call then and
is the wrong state to ship. The fix is to pick the nearest of the **six** hex directions
to the shove vector — convert the offset delta to cube space, take the dominant axis, and
step with `hexNeighbors`, exactly as every other movement path now does.

**Do not** re-derive an adjacency table at the call site. Use the canonical one.

---

## 2. Replays render a board that never existed

The replay snapshot is an **allow-list** of state keys. `state.structures`, the control
points, the objective scores and the **map seed** are not on it.

Nothing throws. The replay simply generates *different terrain*, puts the ruins somewhere
else, and shows a match that did not happen. Silent, and exactly the failure mode the
seeded generator was built to prevent between two live clients — reintroduced on the
playback path.

Fix: add the new keys to the snapshot, **including `_bbMapSeed`**, so a replay rebuilds
the identical battlefield. Then verify by recording a match, replaying it, and diffing
the generated map — not by reading the allow-list.

---

## 3. Two tiles project off the canvas, and the rules still offer one as a move

Two tiles of the 14×12 board project outside the canvas rect entirely. A real click there
lands on the page background. Yet `getValidMoves` offers one of them as a legal
destination — so the rules will send a unit somewhere the player can neither see nor
click, and then cannot select it to move it back.

This is the same family as the buried-tile bug fixed in wave 4, arriving from the other
direction: that one was hidden *behind geometry*, this one is *outside the frame*.

Fix at the framing level (the board must fit its host rect with every tile inside it) —
**not** by removing tiles from `getValidMoves`, which would make the playable board a
different shape from the drawn board and simply move the lie somewhere else.

The camera work makes this sharper, not softer: a movable camera can push any tile off
screen. So the rule to enforce is that **a tile the rules consider playable must always be
reachable by the player** — either by keeping the board framed, or by the camera
guaranteeing it can be brought into view.

---

## How these must be closed

Each one is closed by **executing** the failing case and watching it pass, not by reading
the patch. A critic that cannot reproduce the original failure first has not verified the
fix.
