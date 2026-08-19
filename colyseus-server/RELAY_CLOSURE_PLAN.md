# Closing the snapshot relay — established facts and the first move

**Status:** plan only. Nothing here is implemented.
**Guard:** `cd colyseus-server && npm run loadtest` — drive **B (relay divergence)
to zero** while **A (schema agreement) stays clean**.

---

## What is actually true (verified, not assumed)

1. **The server IS authoritative for combat.** `handleAction` → `calculateDamage`
   → mutates the `@type` schema, delta-synced by Colyseus. Load test at 200
   clients: **100/100 pairs byte-identical, 0 disagreements.** This half works.

2. **There is ALSO a client→client snapshot relay**, unvalidated:
   ```ts
   this.broadcast('snapshot', { from: me, kind, payload: body }, { except: client });
   ```
   Load test: **200/200 relayed snapshots contradicted the server's own numbers**
   and nothing rejected them.

3. **The code intends HOST authority and does not enforce it.**
   `_onColyseusMatchStart` sets
   `MatchBroadcast.amIHost = String(myId) < String(opponentId)` and comments
   *"Host = the lower userId — the single engine of record for this match."*
   But `amIHost` has only **5 references in 215k lines**, and none of them gate
   `_onColyseusSnapshot` / `_onRemoteStateArrived`. Both clients send snapshots
   and both adopt the other's — confirmed by the load test relaying from A *and*
   B in every pair.

4. **`BattleRoom` documents the staging honestly:**
   > *"the client engine stays the source of board truth in this stage; the
   > SERVER owns only turn order, match end, and disconnect handling."*
   This is a half-finished migration, not a defect.

**So the shape is:** two independent client engines, last-write-wins, with a
declared-but-unenforced host role, plus a real server engine running alongside.
That is three opinions about one board.

---

## The first move, and why it is this one

**Enforce the host role that already exists** — server-side, in the `snapshot`
handler: relay only the HOST's snapshots (host = lexicographically lower of the
two `userId`s, the same rule the client already computes).

That converts two engines racing into one engine + one follower, which is what
the code says it wants, and it is a handful of lines in one handler.

### ⚠ The thing to resolve BEFORE writing it

If guest snapshots stop relaying, **how does a guest's play reach the host?**

- If guest plays already travel as `action` messages (server-handled), dropping
  guest snapshots is safe and is purely a removal of a second channel.
- If a guest's play only reaches the host *inside its snapshot*, dropping them
  silently breaks the guest's turn — a far worse bug than divergence.

**Answer this by reading `_onRemoteStateArrived` and every `room.send('action'`
call site before changing the server.** Do not infer it from the handler names;
this diagnosis has already moved three times on assumptions that looked safe.

### Then, in order

1. Enforce host-only snapshot relay. Re-run the load test — **B should drop
   toward zero, A must stay 100/100.**
2. Move the guest's remaining reads onto the authoritative schema field by field
   (hp → position → alive → statuses), re-running the load test at each step.
3. Only when B is zero, demote `snapshot` to a diagnostic (log it, stop applying
   it) and delete the stuck-turn watchdog + `resync` recovery path, which exist
   solely to paper over this.

---

## Do not skip

- The load test's first version **passed while comparing nothing** — an empty
  board makes `digest()` return null and both checks trivially succeed. If a run
  ever reports `no-units`, the result is meaningless. Check that field first.
- `AUTH_DEV_BYPASS=true` is required locally and must never be set on Fly.
  Verified 2026-08-19: production correctly rejects a tokenless join with
  *"No auth token provided."*
- Horizontal scaling is wired but OFF (`REDIS_URL` unset). **Do not
  `fly scale count 2` before setting it** — two processes without a shared room
  registry silently fail to pair players holding the same `matchId`.
