# 🚛 Transportation Company — handover

**Branch:** `claude/transportation-company-feature-jtympq`
**Status:** unreviewed generated code that has never run in a browser and whose
migration has never been applied to the real project. **Do not deploy.**

---

## What was built

Design doc build-order steps 1–4, from `docs/transport-company-design.md`.

| File | Lines | What |
|---|---:|---|
| `sql/038_transport_companies.sql` | ~1,600 | 5 tables, RLS, 4 helpers, 6 RPCs, 12 SECURITY DEFINER |
| `public/src/transport/rigs.data.js` | 525 | Haul-rig catalog, rarity → runs/cargo maths |
| `public/src/transport/routes.js` | ~1,270 | Hops, reach, quote, Meridian ceiling |
| `public/src/transport/contracts.js` | ~1,450 | Every Supabase call, guarded, spend/refund |
| `public/src/transport/depot.js` | 457 | City-building reader |
| `public/src/transport/depot.render.js` | ~1,100 | Depot / Fleet / Exchange UI |
| `public/src/transport/index.js` | ~1,300 | Module entry + bridge consumer |
| `public/src/transport/transport.bridge.js` | 259 | The seam |
| `public/src/city/production.data.js` | +132 | Freight Depot catalog entry |
| `public/index.html` | +801/−12 | Charter op, bridge, PP haul listings, deploy knobs |

**Not built, deliberately:** battle integration (step 5), escorts / region tolls /
convoy raiding (step 6), making `_jbConvoys()` stateful, and gate phases 2–3.
Gating stays at phase 1 (hiring a carrier is a bonus, never a requirement).

---

## How it was produced

Three gauntlet rounds. Each piece was written by a builder with no prior context,
then judged by a separate critic that opened the real file and compared it **blind**
against a frozen copy of an existing repo file. 18 rounds to get 8/8 pieces past
their bar. Three cross-seam integration passes then found 14, then 13, then 12
problems that per-piece critics structurally could not see.

**The honest read on the loop:** it converged on severity, not on count. Round 1
found "a contract costs 1 Cinder, which destroys the reliability system". Round 3
found "a comment cites a line number that has drifted". But rounds 2 and 3 each
*introduced* about five new problems while fixing others, which is why it was
stopped rather than run a fourth time.

---

## Verified

Everything below was measured, not asserted.

- `node _synckcheck.mjs` — **ALL CLEAN**
- All seven `/src/transport` modules import under node
- `sql/038` applied **four times** to a real PostgreSQL 16 cluster: idempotent, and
  §5's verify returns its documented row every time
- Deploy triple agrees at **v120w8** (`version.txt`, `BUILD_VERSION`, `sw.js
  CACHE_VERSION`) plus the module cache-bust
- `_convoyCanSend` and `GARAGE_RIG_FX`: **zero touched lines** across the whole
  `index.html` diff — both ratified invariants hold
- Driven against a live DB: `units 0.000001` → `units_below_min`; `delete from
  transport_rigs` and `truncate transport_ledger` → permission denied; a stranger
  reads 0 rows from rigs/contracts/ledger and gets no `fleet_used`

---

## Fixed by hand after the loop stopped

| Was | Now |
|---|---|
| **Confirm dialog said 2,000 🔥, wallet was debited 20,000.** The client priced from carriers it can see; the server prices from the median of carriers that have *delivered*, which no client can compute. | `serverQuote()` calls `transport_quote` before the confirm, so the dialog and the charge are one expression. Offline, it falls back and *says* it is an estimate. The success toast now prints what was actually charged. |
| **The 15s repaint wiped whatever you were typing.** `paint()` does `ov.innerHTML = html`. | Timed repaint skips while an input is focused. |
| **Upgrading the Freight Depot bought nothing.** `setTariff` pinned `p_depot_level: null`, so reach/bays/fleet-cap never moved off the row's creation value. | The level is read from `depotReady()` and published with the sheet. |
| **The ledger's owner-only RLS was bypassed by `transport_settle`'s own return value** — the shipper got the carrier's whole balance on every haul. | Key is **absent** for a non-owner. Verified on a real DB: owner sees `carrier_balance: 5000`, shipper's envelope has no such key, and both settles still succeed. |

⚠ One of those nearly shipped a worse bug than it fixed: the obvious spelling of the
last one, `case when … then 'carrier_balance' end, v_bal`, raises
`ERROR: argument 3: key must not be null` on PostgreSQL 16 and would have broken
**every** settle, for the owner too. It is `|| '{}'::jsonb` for that reason, and the
comment in the file says so.

---

## Open — for a human

Nothing here is blocking. Six items, all found by the final sweep.

1. **`rig_out_of_runs` still leaks the *fact*** (security, minor) — round 3 gated the
   numbers behind `is_transport_owner` but a stranger can still tell that a rival's
   rig is out of runs, and the probe is free. The file's header claims this channel
   closed; either narrow the probe or correct the claim.
2. **`repairable` guard is missing a state test** (moderate) — `depot.render.js`
   claims it mirrors `transport_repair`'s refusals "one for one, three of them".
   The RPC refuses nine. A rig at the top of the condition ladder can still be
   offered a repair that cannot succeed.
3. **`index.js` quotes a sentence `sql/038` retracted** (moderate) — it cites the
   `least(runs_cap, max_runs_per_rig)` clamp as a live safety property. That clamp
   never binds, and the SQL file corrected its own comment; index.js still carries
   the old claim in the present tense.
4. **~58 cross-module line citations have drifted** (moderate) — `index.js`'s ten
   `sql/038` hints are wrong by 330–400 lines. `routes.js` has a header devoted to
   the rule that a line is a hint and the symbol is the anchor; the numbers should
   be swept or dropped in favour of the symbols most of them already name.
5. **The over-cap banner names two remedies this build cannot perform** (moderate) —
   "Upgrade the Freight Depot, or retire a rig." There is no retire button, and
   `transport_retire_rig` has five references in `/src`, all of them comments.
6. **`transport_config` has no admin UI.** The floors and ceilings are only settable
   by hand in SQL.

Full detail with file:line and evidence: `docs/gauntlet/open-items.json`.

---

## Before this can ship

1. **Read the code.** ~7,900 lines nobody has reviewed. The RLS predicates especially
   — greps prove a `using` clause is *present*, never that it is *right*.
2. **Apply `sql/038` by hand** in the Supabase editor for `ktsiasyjusesawtrwrjc`.
   Until then the modules run against tables that do not exist, which is why every
   call is guarded.
3. **Run it in a real browser.** The Browser pane in the build environment does not
   composite — RAF never fires — so every renderer was driven directly and none of
   this has been *seen*.
4. **Decide on the open items above.**

Only after 1–3 does the deploy triple at v120w8 mean anything.
