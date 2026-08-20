# HEXSPEC — the one hex scheme, binding on both layers

Two independent lattices exist (game logic in `public/index.html`, canvas stage in
`public/battle-board/index.html`). They are converted by different builders. If they
disagree by so much as a row-offset parity, the board will *look* fine and *lie*: the
highlighted tile and the tile the click resolves to will drift apart as you move away
from the origin. This file is the shared contract. Neither builder may deviate from it;
if a builder believes it is wrong, they must say so and stop, not silently pick another.

## 1. Orientation — POINTY-TOP

Hexagons have a vertex at the top and flat edges left and right. Vertices at angles
`60°·i − 30°` (i.e. `i*PI/3 - PI/6`) from centre.

Rationale: rows read horizontally, which keeps the existing `board[y][x]` row-major
array, the existing row-based deployment zones, and the "front row / back row"
vocabulary the game already uses in card text.

## 2. Coordinates — ODD-R OFFSET, stored exactly as today

Game storage does not change shape: `x` is the column, `y` is the row,
`state.board[y][x]`, `unit.pos = {x, y}`. Board-side, game `y` is called `z`.

**Odd rows (y odd) are shifted +0.5 column to the right.** No other row is shifted.

## 3. World position — the single formula both layers use

```
SIZE  = hex circumradius in world units (centre → vertex)
HEXW  = SIZE * sqrt(3)      // full width of a pointy-top hex, = centre-to-centre in a row
HEXV  = SIZE * 1.5          // vertical centre-to-centre between adjacent rows

worldX(x, y) = (x + (y & 1) * 0.5 - (cols - 1) / 2) * HEXW
worldZ(x, y) = (y - (rows - 1) / 2) * HEXV
```

`(y & 1)` — bitwise on a non-negative integer row index. Negative `y` never reaches
this function; guard upstream, do not use `%` (in JS `-1 % 2` is `-1`, which would
shift the wrong way).

## 4. Inverse — world → tile, by cube rounding. NOT by rounding x and y separately.

Rounding offset coordinates independently is wrong near hex edges and is the classic
source of "the click landed one tile off, but only sometimes". Do it properly:

```
q = (sqrt(3)/3 * wx - wz/3) / SIZE
r = (2/3 * wz) / SIZE
// cube round: x=q, z=r, y=-x-z; round all three, fix up the one with
// the largest rounding delta so x+y+z === 0
// then axial -> odd-r offset:  col = cx + (cz - (cz & 1)) / 2 ;  row = cz
```

Apply the same board-centre offset used in §3 before converting, and re-derive the
bounds test for staggered rows afterwards.

**`worldX/worldZ` and the inverse must be edited in the same commit, and the commit
must include a round-trip assertion** over every tile on the board: for all `(x,y)`
in bounds, `inverse(worldX(x,y), worldZ(x,y)) === (x,y)`. There is nothing else tying
them together.

## 5. Neighbours — odd-r offset

```
even row (y even):  (x-1,y) (x+1,y) (x-1,y-1) (x,y-1) (x-1,y+1) (x,y+1)
odd  row (y odd):   (x-1,y) (x+1,y) (x,  y-1) (x+1,y-1) (x,  y+1) (x+1,y+1)
```

Six neighbours, never eight. There are no diagonals on a hex grid.

## 6. Distance — cube distance, via offset→cube

```
offsetToCube(x, y):  cx = x - (y - (y & 1)) / 2 ;  cz = y ;  cy = -cx - cz
hexDistance(a, b) = (|ax-bx| + |ay-by| + |az-bz|) / 2
```

This replaces the Chebyshev body of `distance()`. Because wave 1 routed every call
site through `distance()`, this is a change at one definition — that is the entire
point of wave 1, and it is why no builder may reintroduce an inline metric anywhere.

**Consequence to state plainly rather than hide:** a range-N reach covers
`3N² + 3N + 1` tiles on hex versus `(2N+1)²` on Chebyshev — a range-2 unit reaches 19
tiles instead of 25, and diagonal reach shortens. Movement and attack *shapes* change.
That is inherent to the user's request for a hex board and is not a regression. What
would be a regression is the UI and the rules disagreeing about the new shape.

## 7. Board size — one source of truth

`BOARD_W` and `BOARD_H` stay the only place the dimensions are written on the game
side, and the canvas `MAP.cols/rows` must be *fed from them*, never re-typed. The CSS
grid at `index.html:11219/:11278` and the `aspect-ratio` lock are a second, unlinked
source of truth today and must stop being one.

Target size for this wave: **BOARD_W = 14, BOARD_H = 12**.

This is roughly 3× the current 56 tiles. Two things must be checked before it is
called done, and reported honestly if they fail:
 - **Reachability.** With existing unit move ranges and the hex metric, opposing
   forces must still be able to engage within a sane number of turns. If they cannot,
   say so and propose the smallest fix (scale deployment zones toward the middle, or
   scale move allowances) — do not silently shrink the map back.
 - **Cost.** `tileAt` is an O(n) linear scan called per tile per frame. At 168 tiles
   it must be an indexed lookup, not a scan.

## 8. What does NOT change

- `state.board[y][x]` array shape, `unit.pos`, and every existing card/unit/effect id.
- The `board:*` postMessage protocol's message names and payload field names.
- `onTileClick(x, y)` / `onUnitClick(id)` signatures.
- Combat resolution, card effects, economy. Untouched, entirely.
