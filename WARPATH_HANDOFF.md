# WARPATH — ship handoff

Everything is on `claude/warpath-multiplayer-mode-dj9x5x`. This is the order to ship it in,
what to check after each step, and how to switch it off without a deploy.

**Ship the migration before the code.** Nothing breaks if you do it the other way — the boot
drain is gated on having entered a Warpath, so a player who has never played it issues no RPCs
— but every diagnostic below assumes the database is already there.

---

## 1. The database

One migration. It creates 21 `warpath_*` tables (13 run-state, 8 static content), ~20 RPCs, RLS,
and a plpgsql mirror of the world generator.

```
supabase/migrations/20260811000000_warpath_milestone_1.sql
```

Apply it the way you applied the `tw_*` migrations — `supabase db push`, or paste it into the
SQL editor. It is idempotent (`if not exists`, `drop policy if exists`, `create or replace`),
so re-running it is safe.

**It expects two tables that already exist in production**: `public.bank_of_ethos` and
`public.boe_ledger` (`api.sql:231` and `:281`). AZA entry debits the real bank and writes a
`warpath_entry` line to the real ledger — Warpath does not have its own wallet.

### Check it landed

```sql
select count(*) from information_schema.tables
 where table_schema='public' and table_name like 'warpath_%';        -- expect 21

select public.wp_hash32(1337, 14, 7);                                -- any bigint = mirror is live

select proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and proname like 'warpath_%' order by 1;   -- ~20 RPCs
```

### The full test suite (optional, on a scratch database only)

**Do not run this against production** — it deletes from every `warpath_*` table at the top.
On a scratch copy it plays a real two-hero run and then attacks it: 123 assertions, exit 0.
It needs a switchable `auth.uid()`; the exact stub is documented in the file's own header.

```
psql -f supabase/tests/warpath_milestone_1_test.sql
```

---

## 2. The code

```bash
git checkout claude/warpath-multiplayer-mode-dj9x5x
npm run deploy          # node deploy.mjs  → Cloudflare Workers
```

`wrangler.jsonc` already serves `./public` through the `ASSETS` binding, so `/warpath/` needs
**no worker change and no new route**. `public/sw.js` steps aside for iframe navigations
(`:481`), so the sub-app is never served stale.

What ships:

| path | what |
|---|---|
| `public/warpath/` | the mode — screen, net layer, map generator, renderer, data tables |
| `public/index.html` | the gate + battle bridge — **1183 insertions, 0 deletions** |
| `public/main-menu/index.html` | +11 lines, the cinematic menu entry |

Bump `public/version.txt` as usual so clients pick up the new bundle.

### Check it shipped

1. Load the game, open the menu — **WARPATH** should be there.
2. Enter it. You need a ticket or AZA; `warpath_claim_free_ticket()` grants one per week.
3. You should get a camp, a fogged map, and a turn counter.
4. DevTools console should be clean. A red *"The Warpath is not installed on this server yet"*
   means step 1 did not land.

---

## 3. The kill switch

No deploy needed, per browser:

```js
localStorage.setItem('hg_warpath', '0');   // off
localStorage.removeItem('hg_warpath');     // on (default)
```

With it off the menu entry is hidden, no listeners are attached, no RPCs are issued, and the
gate cannot be opened. Verified byte-identical console output against a pre-Warpath baseline
with the flag both on and off.

**To disable it for everyone**, flip the default at `public/index.html:215499` and redeploy:

```js
try { return localStorage.getItem('hg_warpath') !== '0'; } catch (e) { return true; }
//                                                                          ^^^^ → false
```

Rolling back the code does **not** need the migration reverted — the tables are inert if
nothing calls them.

---

## 4. Things to watch in the first week

**Turn length.** `warpath_runs.turn_seconds` defaults to 90 and is a *column*, so it retunes
with an `update`, no migration. A player who stalls is auto-ended; three in a row marks them
`away` and drops them from the barrier so everyone else keeps playing.

**Battle length.** A battle pins two heroes until someone reports. It dies of *silence*, not
duration — `warpath_battle_alive()` is a heartbeat from the client actually in the match —
with a hard ceiling and a 120s grace for a battle nobody ever attended. If real matches turn
out longer than the harness measured (p50 25 half-turns, p90 45), this is the first knob.

**Entry cost.** 1 ticket or 3 AZA, in `warpath_enter`.

**Watch `warpath_events`** for `battle_disputed` — that is both players claiming the same
battle. Rare is fine; common means someone is gaming the report.

---

## 5. Known limits — these are honest, not hedging

- **Nothing has ever run against real Supabase.** Every SQL result came from local PostgreSQL 16
  with a stubbed `auth.uid()`. RLS under real `authenticated` grants and PostgREST's actual
  behaviour are *inferred*. **This is the first thing to verify on the real deploy** — it is the
  exact class of gap that hid a total showstopper for nine review rounds.
- **Battle results are client-reported.** An unreported battle expires with no winner, no loot
  and no injury; concessions are believed immediately; a bare win claim waits for the other
  side. But two colluding clients cannot be caught from here. That is what the Colyseus work in
  `docs/mp-server-authority-shared-engine.md` fixes.
- **No latency, reconnect or packet-loss testing.** Every connection in every harness was a
  unix socket.
- **PvP is opt-in in practice.** With four bots over 60 turns, players who were not actively
  hunting never met — spawns land 29–35 tiles apart under 2-tile vision. The Watchtower, the
  extraction broadcast and camp discovery exist to make hunting a *choice*. Whether that reads
  right at human pace is unmeasured.
- **`rlc_run_deck` has the same defect the Warpath one had** — `public/index.html:178541` pushes
  temporary run state into the persisted, cloud-uploaded profile. It is mitigated (excluded from
  deck listings, and swept at `:178079` on run end) so exposure is a reload window, and it is **pre-existing and
  untouched by this branch**. Worth a separate fix.

---

## 6. What is deliberately not in this milestone

No Warpath-*exclusive* cards — minting them means editing the catalog inside the 216k-line
production file, which this branch would not risk. Every grant already carries an
`acquisition: 'warpath'` tag, so a real set drops in later without a schema change.

Also out: guilds, diplomacy, world bosses, forward outposts, Elite/Mythic warpath tiers, and
splitting `warpath_state()` for servers larger than 4 players.

---

## 7. The tools, if you want to re-check any of this

```
tools/warpath-sim/pg.sh up && pg.sh test     # scratch cluster + 123 assertions
node tools/warpath-sim/sim.mjs --runs 8      # four bots, real RPCs, real Postgres
node tools/warpath-sim/probes.mjs            # 20 four-player probes
node public/warpath/_layoutcheck.js          # map band, tap targets, encounter fit, battle loop
node public/warpath/_contractcheck.js        # every client RPC call site resolves
node public/warpath/_selftest.js             # world generation invariants
```

`_contractcheck.js` is the one worth wiring into CI. It compares every client call site against
the live function catalog, and it is what would have caught the bug that made the entire mode
unplayable — the client calling RPCs whose signatures it did not match.

`docs/warpath-milestone-1.md` is the full build log: every critic round, what it found, what was
fixed, and the experiments that failed and were reverted.
