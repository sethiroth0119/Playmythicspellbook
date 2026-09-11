# Decisions Seth has to make before the persistent-world work can ship

Every item below is called out in one of the four briefs as "surface this, do not pick a
default silently". Each has a recommendation so this is a review, not a quiz — override
anything you disagree with and the rest proceeds.

Status: **awaiting Seth.** Phase 0 audits are running; these do not depend on them.

---

## A. Ordering — recommended, and the briefs mostly fix it themselves

1. **Identity first.** `IDENTITY_FIX_BRIEF` says so outright: Colyseus rooms key every
   player off `auth.uid()`, so if identity is unstable the multiplayer layer inherits the
   bug and it stops being a login annoyance and becomes lost trades and dropped battles.
2. **Persistent simulation second**, built as the *segmented* resolver from
   `WORLD_EVENTS_BRIEF` §2 rather than the single-shot accrual in
   `PERSISTENT_SIMULATION_BRIEF` §2. Building the simple one first means rewriting it the
   moment the first storm exists. The world-events brief explicitly replaces that function.
3. **Asset migration third** — it is independent of the other three and is the "save space"
   half of the ask. It can run in parallel with anything.
4. **Colyseus last**, and `BattleRoom` last within it. Moving battle logic client→server is
   its own project; the brief says to scope it separately.

---

## B. Persistent simulation (`PERSISTENT_SIMULATION_BRIEF` §5)

| # | Decision | Recommendation | Why |
|---|---|---|---|
| B1 | **Storage caps** — production stops at cap, overflow discarded not banked | **Confirm as written** | It is the retention mechanic and the reason storage upgrades matter. |
| B2 | **Offline duration cap** — is accrual capped regardless of storage? | **No separate cap; let storage be the cap** | Two overlapping caps is two systems to explain. Storage already bounds it, and it makes storage the upgrade that matters. |
| B3 | **Worker wages when the player goes broke offline** | **Halt at the crossover, piecewise** | Rates are linear, so the crossover is solvable analytically. Never run free, never go negative. I will report the formula before shipping. |
| B4 | **Randomness in production** | **Seeded on `(entity_id, day_bucket)`** | A roll that can be re-rolled by refreshing is an exploit. This is the same rule the Aza and PRN fixes already established in this codebase. |
| B5 | **Rate changes mid-window** | **Segmented resolver — see A2** | The world-events brief already requires it. Picking "apply current rate to the whole window" now means throwing it away later. |

---

## C. World events (`WORLD_EVENTS_BRIEF` §8)

| # | Decision | Recommendation | Why |
|---|---|---|---|
| C1 | **Can a player be raided while offline?** | ✅ **DECIDED by Seth, 2026-08-18** — yes, with reduced losses while offline + a shield after being raided | Full protection kills raiding; none punishes people for having jobs. Parameters in C1a–C1d below. |
| C2 | **Procedural event density per entity per day** | **Start at ~1 in 3 days per entity, tunable in `ECON`** | Balance-critical and cheap to change later, as long as it is a constant and not scattered literals. Follows the existing `_opEcon()` rule. |
| C3 | **Destruction vs disable** | **Disable for N hours, not destroy** | Far more forgiving, much easier to resolve, and it cannot brick a player who was away. Destruction can come later for a specific high-stakes event. |
| C4 | **Long-absence collapse** — 6 months of pending events | **Cap the walk, collapse the remainder, and STILL PAY the production** | Do not punish a returning player for having been away. Report the cap in the "while you were away" screen. |
| C5 | **Retroactive cancellation** of an authored event | **Cancellation affects `pending` rows only** | Simplest, and un-applying a resolved outcome is not safely reversible. |

### C1 parameters — the numbers behind the decision

C1 is settled in principle. These four constants are what a resolver actually needs, and
they all live in `ECON` so they stay tunable (the `_opEcon()` rule — never hardcode economy
numbers). Proposed values, **not yet confirmed**:

| # | Constant | Proposed | Note |
|---|---|---|---|
| C1a | `RAID_OFFLINE_LOSS_MUL` | **0.50** | An offline defender loses half what an online one would. Enough that raiding a sleeping player is still worth the trip, not enough that logging off is punishing. |
| C1b | `RAID_SHIELD_HOURS` | **8** | Shield after *being raided*, so you cannot be farmed repeatedly overnight. 8h covers a night's sleep without covering a whole work day. |
| C1c | `RAID_SHIELD_BREAKS_ON_ATTACK` | **true** | If you raid someone while shielded, your own shield drops. Otherwise the shield is a free offensive window and the meta becomes "get raided on purpose". |
| C1d | `RAID_LOSS_CAP_PCT` | **25%** | Hard ceiling on the share of any single resource one raid can take, online or offline. This is the guard against a returning player finding themselves at zero. |

**"Offline" needs a definition too.** Proposed: the defender's `last_seen_at` is more than
**15 minutes** before the raid's `occurs_at`. Server clock only — never `Date.now()`.

⚠ Note the interaction with C4 (long-absence collapse): a player away six months is offline
for every raid in that window. C1a and C1d together are what stop that being a wipe. If C1d
is raised or removed, C4's "still pay the production" promise stops being enough to make
returning worth it.

---

## D. Migration (`MIGRATION_BRIEF`)

| # | Decision | Recommendation | Why |
|---|---|---|---|
| D1 | **Three.js r128 bump** — the brief calls it a Phase 4 blocker | **Do not bump yet; decide after the audit reports blast radius** | r128's KTX2/meshopt support is not production-viable, so compression wants a newer version — but the brief says ask first, and it was only just self-hosted this week. |
| D2 | **`cdn.phototourl.com`** — third-party host with no CORS headers, currently proxied through our worker | **Fold it into the R2 migration** | It is already causing sprite load failures. Migrating that art to R2 removes the proxy hop entirely rather than making it permanent. |
| D3 | **Deleting Supabase Storage after cutover** | **Manual, by Seth, after a two-week soak** | Brief mandates this. Non-negotiable. |

---

## E. Things I already know that change these briefs

Recorded so no audit has to rediscover them:

1. **This repo is not Vite + TypeScript.** All four briefs assume `import.meta.env`,
   `src/lib/*.ts`, and a bundler. The real shape is one ~13.9 MB `public/index.html` plus
   ES modules under `public/src/`. Every code sample in the briefs needs translating; the
   *architecture* still applies unchanged.
2. **There is no Supabase CLI login in this repo.** Migrations are numbered `.sql` files in
   `/sql`, applied BY HAND in the SQL editor. Every migration must be idempotent,
   re-runnable, and ship its RLS in the same file.
3. **`/api/art/proxy` already exists** in `worker.js` — SSRF-guarded, size-capped, sends
   `Access-Control-Allow-Origin: *`. It is a working seam for asset abstraction.
4. **The economy is already client-authoritative and known to be so.** `CLAUDE.md` records
   that a save-file load clamp was removed after three rounds because the exploit is
   console-reachable anyway, with the note "the real fix is server-side authority". That is
   exactly what `PERSISTENT_SIMULATION_BRIEF` builds. These two documents agree.
5. **`sim.js` asserts a closed Cinder loop every tick** and suspends payout if it breaks.
   Any server-side resolver must preserve that invariant or the guard has to move with it.
6. **The audit blind spot:** `sim.js` samples `before = totalCinder()` INSIDE `runDay`, so
   anything moving money on load, on boot, or between ticks is invisible to it. A green
   economy gate proves nothing about that class. Server-side resolution must not inherit
   the same blind spot.
