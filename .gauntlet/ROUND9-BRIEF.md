# Round 9 — what the baseline capture actually shows

Captured at HEAD (`.gauntlet/shots/` in the scratchpad, hour pinned 15:00) before
any round-9 work, so every claim below is measured against a frame that exists.

## 1. Citizens are ~2× oversize, and the ratio is the proof

Measured off the live scene graph, not off the source:

| object | measured extent (world units) | real-world | implied m/unit |
|---|---|---|---|
| car, length | 0.445 | 4.5 m | 10.1 |
| car, height | 0.154 | 1.5 m | 9.7 |
| car, width | 0.206 | 1.8 m | 8.7 |
| civilian, height (median adult) | 0.333 | 1.75 m | **5.3** |

The cars agree with each other to within 15% across three independent
dimensions. The people do not agree with the cars at all.

**The statement that needs no scale constant to argue about: a citizen standing
next to a car is 2.16× the height of the car's roof.** A real person is 1.17×.
So the figures are 1.85× oversize, at the top of the range the round-8 critic
estimated by eye ("1.5–2×").

The fix is therefore derived and not chosen: hold the human/car ratio at its
real value. `0.154 × 1.17 = 0.180` finished height, against a median 0.333
today, which is `CIV_SCALE 1.3 → 0.70`.

⚠ IT MUST CHANGE IN TWO PLACES AT ONCE. `agentMesh()` (index.html) scales
walking civilians by 1.3 and `/src/crowd` `CIV_SCALE` scales standing ones by
1.3, and the crowd module's header is explicit that they must stay identical or
the city reads at two scales. Changing one is a bug, not a half-fix.

## 2. The empty land is now the biggest single "board game" tell

The aerial shows the buildings and the road network reading well — varied
rooflines, balconies, real kerbs, lane markings, lamps — surrounded by an
unbroken flat green plane with no variation of any kind. Between two roads there
is nothing: no grass tone change, no dirt, no scrub, no rock. Rubric dimensions
5 (The plot) and 10 (Vegetation) have both sat at 5.0, and this is why.

This is the cheapest large win left: the ground is already one material, so
variation costs a texture and a scatter, not new art.

## 3. Vehicles remain the lowest-scoring dimension (4.5)

The street frame shows the parked fleet reading as dark near-identical blocks.
Their PROPORTIONS are right (see the table above) — the problem is variety and
surface, not size.

## What this brief does NOT claim

The demand strip's labels are PRESENT in this capture (top bar: R/C/O/I, and the
full Zone Demand panel with live causes on the right). Whatever the round-8
critic saw as a 6→4 UI regression, it is not a missing label here, and the
round-9 UI piece should establish what it actually was before changing anything.
