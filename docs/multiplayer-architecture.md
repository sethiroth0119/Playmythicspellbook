# Multiplayer Architecture — Current vs Colyseus Migration

> Status: 2026-05-27. The current architecture (Supabase Realtime + client-authoritative state) is **defensible for a turn-based TCG of this scope** if the 7 known smoothness issues are addressed. Four of those are now fixed (delta-resync, DC tiebreaker, exponential retries, turn-sync recovery). The remaining 3 are deferred.
>
> **This doc is a sketch of what migrating to Colyseus would look like IF the current setup keeps showing problems after the in-flight fixes deploy.** Don't act on it without a real "we tried the fixes and it still hurts" signal.

---

## Current architecture (Supabase Realtime)

```
┌──────────────┐                                       ┌──────────────┐
│   Client A   │  ←── broadcast channel ──→            │   Client B   │
│ (browser)    │  ←── presence track  ──→              │ (browser)    │
└──────┬───────┘                                       └──────┬───────┘
       │                                                      │
       │         ┌──────────────────────────────┐            │
       └────────►│  Supabase                    │◄───────────┘
                 │  - Auth (user_profiles)      │
                 │  - matches table             │
                 │  - matchmaking_queue table   │
                 │  - Realtime channels         │
                 │  - Postgres realtime         │
                 │  - Edge Functions:           │
                 │    • mp_init_match           │
                 │    • mp_end_turn             │
                 │    • mp_resolve_match        │
                 └──────────────────────────────┘
```

**Where state lives**:
- **Authoritative match outcome**: `matches.winner_id` column (race-gated by conditional `UPDATE WHERE winner_id IS NULL`)
- **Turn ownership**: `matches.current_player_id` column (server-flipped by `mp_end_turn` Edge Function)
- **Everything else** (board, hand, energy, units, statuses): **client-side**, broadcast peer-to-peer via Realtime channels

**Failure modes & mitigations** (current):

| Failure | Mitigation |
|---|---|
| Realtime broadcast packet dropped | Postgres realtime listener catches winner_id changes; presence resets last-seen on any received message |
| Both clients submit gameover | Edge Function does atomic conditional UPDATE; race-loser reads back the verdict |
| Client disconnects mid-turn | DC watchdog (90s timeout + grace period); auto-declares DC win via Edge Function |
| Client clock drift / stale state | Turn-start sanitization, force-unfreeze hotkey (Ctrl+Shift+U), state-delta vs full-snapshot fallbacks |
| Function unavailable | Exponential-backoff retries (now 4 attempts at 1s/2s/4s) |

**Strengths**:
- Zero ops cost beyond Supabase (auth + realtime + functions are bundled)
- Reuses existing player auth + save sync
- Already deployed; no new infrastructure
- Realtime channels are low-latency (~80-200ms typical)

**Weaknesses**:
- **Trust model**: Each client computes its own state. A modified client could lie about damage dealt, units killed, etc. Server doesn't validate.
- **No replays/spectating** without re-streaming full state for the duration
- **Bandwidth**: Full snapshots are ~30-50KB; deltas are 2-5KB but require both sides to maintain a baseline
- **Edge Functions cold-start**: ~300ms cold; ~50ms warm. Per-turn RPC adds noticeable latency vs in-memory server logic

---

## Colyseus migration (authoritative-server architecture)

### What changes

```
┌──────────────┐                          ┌──────────────┐
│   Client A   │ ←── WebSocket ──→        │   Client B   │
└──────┬───────┘                          └──────┬───────┘
       │              ┌──────────────┐          │
       └─────────────►│   Colyseus   │◄─────────┘
                      │   server     │
                      │ (Node.js)    │
                      │              │
                      │ Match rooms: │
                      │ • Board state│
                      │ • Turn order │
                      │ • Hand zones │
                      │ • Damage calc│
                      │ • Death check│
                      └──────┬───────┘
                             │
                             ▼
                      ┌──────────────┐
                      │   Supabase   │ (UNCHANGED)
                      │ - Auth       │
                      │ - Saves      │
                      │ - Leaderboard│
                      └──────────────┘
```

### What stays where

| Lives in Supabase | Moves to Colyseus |
|---|---|
| User auth (sign-up / sign-in / JWT) | Match room state (board, hand, energy, units) |
| Profile saves (cards, decks, heroes) | Turn order + transitions |
| Leaderboard / RR / season pass | Damage calculation |
| Forge content (cards, moves, traders, guides) | Win condition checks |
| Crash Exchange + economy ledger | Realtime sync between match participants |
| Replays (DB-stored after match ends) | Match-result submission → writes to Supabase |

### What the code change looks like

**Client side** (`public/index.html`):
- Replace `Cloud.client.channel('match:' + matchId, ...)` with `colyseus.joinById(matchId, { authToken })`
- Replace `broadcastMyState()` with `room.send('action', { type, target, move })` — only the INPUT, not the resulting state
- Server pushes authoritative state via `room.onStateChange((state) => ...)` (Colyseus's @colyseus/schema diffing is built-in and faster than our hand-rolled deltas)
- Delete: `_computeStateDelta`, `_applyStateDelta`, `_sendFullSnapshot`, the presence DC watchdog (Colyseus has built-in `onLeave`)
- Keep: `Profile.cloud.userId`, all auth flow, all Forge/Profile sync

**Server side** (NEW — `colyseus-server/`):
- Node.js + TypeScript + Colyseus
- One Room class: `BattleRoom` — owns the match state
- `BattleRoom.onCreate()` initializes from Supabase (heroes, decks)
- `BattleRoom.onMessage('action')` validates + applies the action, mutates state
- `BattleRoom.onMessage('end-turn')` flips current player
- `BattleRoom.checkWinCondition()` runs every action, calls `endMatch(winnerId)` when a hero dies
- `BattleRoom.onLeave()` — true DC, not presence-based; instant detection
- On match end: write `winner_id` to Supabase `matches` table for leaderboard/MMR
- Port the existing damage formulas, status effect ticks, ability resolution — most of `calculateDamage` and `executeMove` translates 1:1 from JS to TS

### Effort estimate

| Phase | Effort | Notes |
|---|---|---|
| Stand up Colyseus on Fly.io/Railway/Render | ~4h | Free tier exists; docker container ~5min deploy |
| Schema definition (Player, Unit, Card, Move types) | 1 day | Mirror existing client schemas |
| Port damage + status pipeline | 2-3 days | Largest piece — existing JS translates closely |
| Port move resolution (vanish, charge, on-play, etc.) | 1-2 days | Per-feature, but each is small |
| Port AI controller | 1 day | (Only needed for PvE — PvP runs without it) |
| Client refactor — replace channel with room API | 1 day | The match-flow code is already isolated |
| Migration cutover (feature flag both paths) | 0.5 day | Toggle to roll back if issues |
| **Total** | **~7-10 working days** | Single developer |

### Costs

| Provider | Free tier | Paid (small scale) |
|---|---|---|
| Fly.io | 3 shared CPUs / 256MB RAM ($0/mo first apps) | ~$5-10/mo for 1GB instance |
| Railway | $5/mo credit | $10-20/mo dedicated |
| Render | 750 hrs/mo free web service | $7/mo Standard |
| Colyseus Cloud | Free up to 100 CCU | $19/mo for 1k CCU |

For ≤100 concurrent matches, free-tier on Fly.io/Render handles it. Beyond that, ~$10-20/mo covers it.

### Benefits over the current setup

- **No client-side cheating**: damage/death/win are calculated server-side. A modified client can't lie.
- **No delta-baseline issues**: Colyseus's schema diffing is automatic and authoritative; new clients always get the full state on join.
- **No DC race**: server detects WebSocket disconnect in <1s, not 90s. Auto-resolves the match.
- **No turn-out-of-sync silent drops**: server is the source of truth for whose turn it is.
- **Native replays/spectating**: a third client can join a Room as a spectator and watch live without re-streaming.
- **Lower per-turn latency**: in-memory action processing is ~5-10ms vs Edge Function 50-300ms.

### Tradeoffs

- **New infrastructure**: another moving piece. If the Colyseus server goes down, MP goes down even if Supabase is up.
- **Auth bridge**: client sends a Supabase JWT to Colyseus on join; server verifies via Supabase's JWKS endpoint (~50 lines of code).
- **Rewrite of move resolution in TS**: not huge (~2-3 days), but a source of new bugs while porting. Run both paths in parallel during cutover.
- **Cost**: small (~$10/mo at low scale), but non-zero.

---

## Recommendation

1. **Ship the 4 high-impact fixes** (already done in commit history) — these address the actual reported symptoms (random gameovers, DC false-positives, sync gaps).
2. **Watch for 2-4 weeks** — does the smoothness reach acceptable for launch? If 95%+ of matches complete without weirdness, **don't migrate**.
3. **Migrate to Colyseus IF**:
   - Players continue reporting "I died with full HP" / "opponent's move didn't sync" after the fixes
   - You hit a scale where 100+ concurrent matches strain Supabase Realtime (unlikely below 5k DAU)
   - You add features that need server-validated state (anti-cheat tournaments, ranked-mode integrity, spectator mode, replay sharing where the replay is authoritative)
   - You want to support mobile clients where reconnects are more common (mobile networks switch IPs more, and Colyseus's reconnect-with-token is more robust)

---

## Status of MP improvement work

| # | Fix | Status | Commit |
|---|---|---|---|
| 1 | Delta-without-baseline triggers resync request | ✅ shipped | (latest) |
| 2 | DC watchdog deterministic tiebreaker (lower userId declares) | ✅ shipped | (latest) |
| 3 | Full delta sequence guards | ⏸ deferred (heavier diff) | — |
| 4 | Broadcast ACK layer | ⏸ deferred (architectural) | — |
| 5 | Resync request race fix | ⏸ deferred (low impact) | — |
| 6 | Exponential backoff on submitMatchResult (4 attempts, 1/2/4s) | ✅ shipped | (latest) |
| 7 | not_your_turn rejection requests full resync | ✅ shipped | (latest) |
| 8 | MP gameOver sanity guard (require dead hero before submit) | ✅ shipped (earlier) | `89ee612398` |
| 9 | Sanity-clear stale UI state on every player-turn start | ✅ shipped (earlier) | `9b0a9222a1` |
| 10 | AI watchdog tightened 15s → 8s | ✅ shipped (earlier) | `9b0a9222a1` |
| 11 | Ctrl+Shift+U force-unfreeze hotkey | ✅ shipped (earlier) | `9b0a9222a1` |
