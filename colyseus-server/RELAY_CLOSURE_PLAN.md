# Closing the snapshot relay — established facts and the first move

**Status:** plan only. Nothing here is implemented.
**Guard:** `cd colyseus-server && npm run loadtest` — drive **B (relay divergence)
to zero** while **A (schema agreement) stays clean**.

> **2026-08-19 — the gating question below is now ANSWERED, and the answer
> invalidates the first move as it was written.** Read §"The answer" before
> anything else. Option A (host-only snapshot relay) would break every guest's
> turn if implemented today.

---

## What is actually true (verified, not assumed)

1. **The server engine is authoritative-capable, but nothing drives it.**
   `handleAction` → `calculateDamage` → mutates the `@type` schema, delta-synced
   by Colyseus. Load test at 200 clients: **100/100 pairs byte-identical, 0
   disagreements.**
   ⚠ **Corrected:** those units were played by the *load test itself* via
   `room.send('action')`. The shipping client has **zero `action` call sites**
   (see §"The answer"), so **in production `state.units` is empty for every real
   match** and this engine never runs. The green proves the engine is correct
   *when driven*; it does not prove the game drives it.

2. **There is ALSO a client→client snapshot relay**, unvalidated:
   ```ts
   this.broadcast('snapshot', { from: me, kind, payload: body }, { except: client });
   ```
   Load test: **200/200 relayed snapshots contradicted the server's own numbers**
   and nothing rejected them. In production this relay is not *a* channel for
   board state — it is the **only** one.

3. **The code intends HOST authority and does not enforce it.**
   `_onColyseusMatchStart` sets
   `MatchBroadcast.amIHost = String(myId) < String(opponentId)` and comments
   *"Host = the lower userId — the single engine of record for this match."*
   But `amIHost` has only **5 references in 215k lines**, and none of them gate
   `_onColyseusSnapshot` / `_onRemoteStateArrived`. Both clients send snapshots
   and both adopt the other's.

4. **`BattleRoom` documents the staging honestly:**
   > *"the client engine stays the source of board truth in this stage; the
   > SERVER owns only turn order, match end, and disconnect handling."*
   This is a half-finished migration, not a defect.

**So the shape is:** two independent client engines, last-write-wins, with a
declared-but-unenforced host role, and a real server engine sitting **idle**
beside them. Not three opinions about one board — two opinions and one
uninvited spectator.

---

## The answer to the gating question

The previous version of this file said, correctly, that nothing could be changed
until this was settled:

> *If guest snapshots stop relaying, how does a guest's play reach the host?*
> *Answer this by reading `_onRemoteStateArrived` and every `room.send('action'`
> call site before changing the server.*

**Answered by direct enumeration, 2026-08-19:**

```
grep -rn "send('action'|sendColyseusAction" public/
  public/index.html:45323   ← a comment describing the function
  public/index.html:45555   ← the function definition
  public/index.html:45557   ← a console.warn inside it
  public/index.html:45561   ← the room.send INSIDE the function
```

**Four hits, and all four are the function itself. `sendColyseusAction()` has no
callers anywhere in `public/`.** The `action` channel is dead code on the client.

Cross-checks, all consistent:

- The only client→server message types actually sent are `claimResult`, `emote`,
  `endTurn`, `forfeit`, `fx`, `ping`, `resync`, `snapshot` — **no `action`.**
- Server-side, `this.state.units.set(...)` is reachable **only** from
  `handlePlayUnit` ← `handleAction` ← `onMessage('action')`. With no sender,
  the authoritative unit map is never populated in a real match.
- The three real board-mutation sites (`index.html` ~153151, ~153295, ~153431)
  call `sendColyseusSnapshot()` and nothing else.

And the load-bearing false comment, at `index.html:153148`:

> *"🪐 Colyseus path: the server owns the state — don't broadcast locally.
> **Actions were already forwarded to the server before being applied.**"*

That second sentence is **not true** and never was. It is the assumption the
whole "server is authoritative for combat" story rested on — including this
file's own first draft.

### What this means for the first move

The plan's own warning fired, on the bad branch:

> *If a guest's play only reaches the host inside its snapshot, dropping them
> silently breaks the guest's turn — a far worse bug than divergence.*

A guest's play reaches the host **only** inside its snapshot. So **enforcing
host-only snapshot relay today would silently break every guest's every turn.**
Do not implement it. It is not "a handful of lines in one handler"; it is a
handful of lines that ships a broken game.

---

## The revised order of work

The prerequisite that was assumed complete is the actual first job.

1. **Wire `sendColyseusAction()` to its call sites** — `playUnit`, `attack`,
   `move`, at the same three points that today only snapshot. Send the action
   **before** applying locally (which is what the comment already claims).
   The server handler, the schema, and the damage math all already exist and are
   load-test-clean; only the caller is missing.
   *Verify:* after this, a real two-player match must leave `state.units`
   **non-empty** on the server. That is the check that would have caught this.
2. **Reconcile the two engines** — with actions flowing, the server's board and
   the clients' boards can finally be compared on real play. Expect divergence
   here; this is where the real work is, not in step 3.
3. **Only then** enforce host-only snapshot relay (the old "first move"). It
   becomes safe exactly when a guest's play no longer needs its snapshot to
   travel.
4. Move the guest's remaining reads onto the authoritative schema field by field
   (hp → position → alive → statuses), re-running the load test at each step.
5. When B is zero, demote `snapshot` to a diagnostic (log it, stop applying it)
   and delete the stuck-turn watchdog + `resync` recovery path, which exist
   solely to paper over this.

⚠ This does **not** change the A-vs-B decision in the handoff — it changes the
price of A. A is no longer "small"; it is step 3 of the above. B's engine is
still the same engine, still unproven against real play. If PvP ever touches
Aza, steps 1–2 are unavoidable on either path.

---

## Do not skip

- **A green "A. SCHEMA AGREEMENT" does not mean production is synced.** The load
  test plays its own units via `action`; the real client never does. The report
  now says so in-line. Ask *"who sent the action?"* before believing it.
- The load test's first version **passed while comparing nothing** — an empty
  board makes `digest()` return null and both checks trivially succeed. If a run
  ever reports `no-units`, the result is meaningless. Check that field first.
- **Do not trust the intent comments in the MP block.** `index.html:153148`
  asserts actions are forwarded; they are not. `amIHost` calls itself *"the
  single engine of record"* and gates nothing. Both read as descriptions of
  working code and are descriptions of *intended* code. Enumerate call sites.
- `AUTH_DEV_BYPASS=true` is required locally and must never be set on Fly.
  Verified 2026-08-19: production correctly rejects a tokenless join with
  *"No auth token provided."*
- Horizontal scaling is wired but OFF (`REDIS_URL` unset). **Do not
  `fly scale count 2` before setting it** — two processes without a shared room
  registry silently fail to pair players holding the same `matchId`.
