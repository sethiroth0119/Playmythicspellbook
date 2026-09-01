# 🔴 Commit `47e230f` shipped a deliberate regression. Do not build on it.

`47e230f` ("Checkpoint: districts save-gate fix still mid-write") captured
`public/src/districts/index.js` at line 478 as:

```js
inert: false, /* TEMPORARY REGRESSION — pre-fix behaviour, reverted below */
```

That line was **injected on purpose** by the agent fixing the placebo-chip defect,
so it could photograph the pre-fix behaviour and show the self-check failing. It
was reverted minutes later. The correct line is:

```js
inert: diff ? diff.length === 0 : false,
```

Anyone who checks out `47e230f` gets a build where the Defect-2 fix is **disabled
while appearing to be present** — `o_tech` is offered on `o_low` as a chip that
changes what develops, and it does not. The boot self-check catches it and says
so loudly, which is the only reason this is recoverable rather than silent.

## This is the second time the orchestrating session's checkpointing has damaged
## the record, and the mechanism is the same both times

`public/src/demographics/FIX-RECORD.md` documents the first: a checkpoint with a
narrow, confident subject line swept in 167 lines of another agent's in-progress
fix, so the commit that *announced* the fix carried about 8% of it.

This one is worse in kind. That one misfiled finished work. This one committed
**work that was deliberately broken at the moment it was captured** — a state no
author ever intended to exist in history.

Both come from the same rule: a stop hook requires a clean working tree every
turn, and agents write to a shared tree continuously. "Commit everything that is
dirty" therefore samples other people's work at an arbitrary instant, and an
arbitrary instant inside a debugging session is frequently a state that is
*intentionally wrong*.

Both syntax gates passed on `47e230f`. They always would have: the injected line
is valid JavaScript. **A parse gate cannot see a semantic regression, and no gate
in this repo can see one that was inserted on purpose.**

## What to do instead

A checkpoint over a shared tree is a snapshot of a worksite, not a change. It
must say so in its subject, name every system it touched, and claim nothing about
whether any of it works — which `47e230f` did do, and is why this was caught. The
missing half is that an agent doing A/B work should be able to say "do not
snapshot me right now", and there is no mechanism for that. Until there is,
**treat every mid-flight checkpoint in this history as potentially capturing a
deliberately broken intermediate state, and never branch from one.**

The fix is in the commit that follows `47e230f`.
