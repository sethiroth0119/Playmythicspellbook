# Where the land-value defect fixes actually landed — and one correction

**If you are reviewing the five land-value defect fixes, do not go looking for
them in a commit that announces them. There isn't one.** They were swept into
`0cb73a2`, whose subject line is *"Mixed checkpoint: three agents mid-write"* and
which describes this work as IN FLIGHT. It was not in flight. It was finished and
driven, and the checkpoint caught it a few minutes after it landed.

That is a bookkeeping failure by the orchestrating session, recorded here for the
same reason `public/src/demographics/FIX-RECORD.md` exists: a reviewer who trusts
commit subjects will either review the wrong diff or skip this one as unfinished.

The review you want:

```
git diff 11b1411 0cb73a2 -- public/src/landvalue public/src/zoning/index.js
```

## 🔴 The correction that matters more than the bookkeeping

The critic's headline finding was that the band ladder advertises **22 tenants no
zone mix can ever produce** — "44% decoration" — and its recommended fix was to
intersect the tenant table with the union of the zone mixes inside `compile()`
and drop what is left over. That recommendation was relayed to the fix agent as
the brief. **Both the number and the fix were wrong, and the agent said so rather
than implementing them.**

The measurement omitted `/src/districts`. `typeFor()` is handed its bag by
`MythicDistricts.mixFor()` *before* `filterMix` runs, and the specialisation
mixes contain `retail`, `gasstation`, `arena`, `stadium`, `holdco`, `railyard`,
`papermill` and `printworks` — every one of which the critic had counted as
undevelopable.

| band | listed | developable by zone mix only (the critic's figure) | developable by zone **or** spec (the truth) |
|---|---|---|---|
| marginal | 9 | 3 | 4 |
| modest | 13 | 9 | 12 |
| established | 13 | 10 | 13 |
| premium | 9 | 7 | 9 |
| prime | 7 | 4 | 7 |

So the decoration is **6 ids, not 22**, and all six are extraction tiles a player
sites by hand on a resource — which `admits()` is also asked about, because it
answers "may this stand here", not only "will this develop here".

And the recommended fix would have been actively destructive. `/src/districts`
culls its own spec mixes against what the bands admit. Narrowing the band table
to the zone mixes first would have culled `arena`, `stadium`, `holdco`, `retail`,
`railyard`, `papermill`, `printworks` and `gasstation` out of the very
specialisations that exist to develop them — **Mythic Arena, Card Works and
Corporate would all have become chips that build nothing**, which is the exact
defect the districts critic had just finished writing up. A circular collapse,
one commit wide.

What shipped instead is a MARK (`†` plus one footnote line) and a `verify()` rule
that fires on the real failure: a band that lists tenants of which *none*
develops.

## The lesson

A critic's measurement is evidence, not a verdict, and a critic with fresh
context is exactly the reviewer most likely to miss a sibling module that did not
exist when the file under review was written. The fix agent's willingness to
reproduce the measurement, find it incomplete, and refuse the brief is the reason
this did not ship. That is the standard to hold — for critics and for the session
relaying them, which in this case relayed a wrong number without re-deriving it.
