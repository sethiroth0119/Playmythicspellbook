# Where the demographics fix actually landed

**If you are reviewing the all-retired / student-turnover fix, do not diff
`503d2f6^..503d2f6`. You would be reading about 8% of it.**

The work is split across two commits, and one of them has a misleading message.
That is a bookkeeping failure by the orchestrating session, not by the agent
that wrote the fix — recorded here because a reviewer who trusts the commit
messages will review the wrong diff and sign off on a change they never saw.

| Commit | Message | What it really carries |
|---|---|---|
| `02ccda2` | Demographics: the three numbers that had escaped ECON | **The true pre-fix baseline.** Diff against this. |
| `7c3271f` | Checkpoint: dossier, naming, geology and the power panel in progress | `ECON.demographics.turnover`, `ECON.demographics.lifecycle`, `arrival.workerlessDrawPerWorkerHH`, `income.studentSupportShare`, the whole `ui.*` block — **167 lines of `tuning.js`** — plus `zones.js turnoverOf()` (+17). Mentions demographics nowhere. |
| `503d2f6` | Demographics: the all-retired attractor, student turnover, and the five ECON escapees | `pipeline.js` (+94) and 19 further lines of `tuning.js`. Accurate, but partial. |

So: **`git diff 02ccda2 503d2f6 -- public/src/demographics public/src/economy/tuning.js`**
is the review you want.

## Why it happened

A stop hook required a clean working tree on every turn. Four agents were
writing to the tree concurrently, so each "commit everything that is dirty"
checkpoint swept in whatever the other agents had half-written at that instant —
including, here, the bulk of a fix whose author committed the rest of it
minutes later under an accurate message.

The checkpoints were gated on both syntax checks (`_synckcheck.mjs` and
`.gauntlet/modcheck.mjs`) so none of them committed a broken file. Nothing was
lost and nothing is wrong in the code. What was lost is the *legibility* of the
history: a commit message that names three unrelated systems is where you would
never look for a demographics change.

## The lesson, for the next parallel run

A checkpoint commit that sweeps a shared tree must either name every system it
touched, or say plainly that it is a mixed checkpoint and that its contents
belong to whatever agents were mid-write. Writing a narrow, confident subject
line over a wide, accidental diff is worse than writing no message at all,
because it actively misdirects.

An earlier round made the same class of error in the other direction: an
electricity commit swept in another agent's water pre-pass and — correctly —
disclosed it in the message rather than letting the history read as a claim of
authorship. That is the standard to hold.
