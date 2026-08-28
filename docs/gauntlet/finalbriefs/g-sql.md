# FINAL FIX BRIEF — g-sql

## FILES YOU OWN (write ONLY these)
- sql/038_transport_companies.sql

## PINNED FACTS — the same in every brief, do not re-derive
- The server floors are `min_units_per_contract = 1` and `min_price_per_contract = 100`,
  in transport_config. transport_quote refuses with error codes `units_below_min`
  (returning `min_units`) and `under_price_floor` (returning `min_price`).
- Meridian's own floor is 40 x 2.5 = exactly 100, so the price floor refuses nothing
  the NPC carrier could sell. It is a real floor, not a rounding artefact.
- The overlay element id is exactly `mythic-transport-ov`.
- The deploy triple must move TOGETHER to v120w8: public/version.txt,
  `window.BUILD_VERSION` in index.html, and sw.js `CACHE_VERSION`. The transport
  module's script-tag cache-bust (`src/transport/index.js?v=...`) moves with them.

## THE RULE FOR THIS ROUND — IT IS WHY THESE FINDINGS EXIST
Five of the thirteen findings below were INTRODUCED by the last round of fixes, which
over-reached: it added server behaviour with no client mirror, and wrote error messages
promising remedies the build does not implement. So:
  * Prefer the SMALLEST correction that closes the finding.
  * Do NOT add new features, new buttons, or new server levers.
  * Where a COMMENT or an error message promises something the build cannot do, fix the
    COMMENT OR THE MESSAGE — do not build the feature to make the sentence true.
  * Do not add a file:line citation into another file unless you have just verified it
    with sed -n. Wrong citations were finding #6; a citation you cannot verify should be
    written as a named symbol instead ("transport_rigs' status CHECK"), never a number.
This is the FINAL automated round. Anything you leave open gets handed to the human as
open, so close what you can and say plainly what you could not.

======================================================================
## FINDING #7  [security / moderate]
WHERE: sql/038_transport_companies.sql:2085-2088 (transport_dispatch's `rig_out_of_runs` diagnosis)  ↔  sql/038_transport_companies.sql:1367-1370 (trg_sel) and :1230-1245 (the fleet-cap guard's split error)

### PROBLEM
THE THIRD READ CHANNEL ON A RIVAL'S FLEET IS STILL OPEN, and it publishes the exact number the other two were closed to protect. trg_sel's comment states the rule out loud — "A rival's fleet composition is competitive information — how many rigs, what rarity, HOW MANY RUNS EACH HAS LEFT TODAY — and knowing a carrier is out of runs is knowing exactly when to undercut them" (:1367-1370). §2b's guard splits its refusal into an owner branch and a bare-code branch specifically so it does not "hand out, through a refusal, exactly what the SELECT policy four sections down refuses to hand out through a query" (:1230-1235). Last round closed the query channel a third time by making transport_caps' fleet_used owner-only. transport_dispatch's own refusal path was never given that treatment: when the run claim matches nothing it re-reads the rig row (:2074, a SECURITY DEFINER read that bypasses trg_sel) and returns `'cap', least(v_rig.runs_cap, v_cfg.max_runs_per_rig), 'used', v_rig.runs_used, 'day_key', v_today` to the SHIPPER, who is not the owner and has no ownership test anywhere on that path. `rig_on_deployment` (:2079-2081) likewise returns the rival rig's `assigned_to`, and `rig_retired`/`rig_not_in_fleet` are free membership probes on a rig uuid.

DRIVEN, on the live cluster, as two separate `authenticated` roles: user A dispatches once through user V's carrier at 100 Cinder (the minimum legal fare), then reads `rig_id` straight off their own contract row — tct_sel grants the shipper that column, so no uuid guessing is needed:
  id | carrier_id | rig_id | price → cb508113… | d28f34d3… | 50a79958… | 100
A's second dispatch against that rig returns, with A's wallet UNCHANGED at 999900:
  {"ok": false, "cap": 1, "used": 1, "error": "rig_out_of_runs", "day_key": "2026-08-28", "remaining": 0}
So one paid haul buys a permanent, free, precise poll of that rig's daily counter — and the poll answers only when the rig is exhausted, which is the precise fact :1369 says must not be published. It is also the read side of the DoS the price floor was added to make expensive: knowing WHICH of a carrier's rigs is already spent is what makes burning the rest efficient.

### PROPOSED FIX
Give the diagnosis the same owner/stranger split §2b already uses, in transport_dispatch. Keep the codes — a shipper is entitled to know their dispatch was refused and why in kind — and gate only the numbers: wrap the four value-carrying returns in `if public.is_transport_owner(p_carrier_id) then … else return jsonb_build_object('ok', false, 'error', 'rig_out_of_runs'); end if;`, and drop `'assigned_to', v_rig.assigned_to` from the non-owner arm of `rig_on_deployment` the same way. The client already degrades correctly: contracts.js's explain() renders a code with no detail keys through its numberless arm. Cite :1230-1245 in the comment so the next reader sees the two branches were written to the same rule, and add a line to §5b or the header's measurement block recording that dispatch was the third channel — the file currently reads as though caps and the guard were the whole set.

======================================================================
## FINDING #8  [security / moderate]
WHERE: sql/038_transport_companies.sql:583 (`vehicle_id  text`) and :544-560 (the new name/home_node_id CHECK and the claim above it), against trg_ins at :1415 and public/src/transport/contracts.js:1137

### PROBLEM
THE COMPLETENESS CLAIM ADDED BY THIS ROUND IS WRONG BY ONE COLUMN. :544-546 introduces the new constraint with "THE TWO STRINGS ON THE ONLY WORLD-READABLE ROW IN THIS FILE, and they were the only client-supplied strings in the whole migration bounded by nothing but the client", then enumerates every other one and where it is bounded (cargo by pg_column_size, from/to_node by left(…,40), client_ref by left(…,64), the blacklist by array_length). `transport_rigs.vehicle_id` is missing from that enumeration. It is `text` with no CHECK, it sits on a table with a client INSERT grant and a permissive trg_ins, and it is bounded only by contracts.js:1137's `String(vehicleId).slice(0, 64)` — the identical client-side truncation the round just demoted from enforcement to convenience for `name` (contracts.js:963/980, `.slice(0, 40)`).

MEASURED as `authenticated` on the live cluster:
  insert into public.transport_rigs (company_id, owner_id, vehicle_id, rarity, condition, runs_cap)
  values (…, repeat('A',1000000), 'mythic','Pristine',10) → INSERT 0 1, vehicle_id_len = 1000000.
And the row count is no longer bounded either, which is a new consequence of this round's own fix: DELETE is revoked and retirement leaves the row behind, so retire→register loops accumulate rows the fleet cap never sees. Measured: three loops against a depot-level-1 charter left retired_rows 7 · live_rows 1 · total_rows 8 · fleet_cap 4. Rows are free (contracts.js:917 says so), so the product of the two is arbitrary storage written from a devtools console. Blast radius is smaller than the name case — trg_sel keeps the value owner-only, so no other client fetches it — which makes this storage abuse rather than a payload on the rate board, but it is the same hole the file now claims to have closed everywhere.

### PROPOSED FIX
Bound it in the same idempotent shape as the constraint two sections up: `alter table public.transport_rigs drop constraint if exists transport_rigs_vehicle_id_ck;` / `add constraint transport_rigs_vehicle_id_ck check (length(coalesce(vehicle_id, '')) <= 64);` — 64 is what contracts.js:1137 already truncates to, so the slice becomes the convenience it is everywhere else. Correct :545's claim in the same edit (it is the sentence that will stop the next reader looking) and name vehicle_id in the enumeration with where it is now bounded. Separately, note at the departed trg_del block (:1424-1462) that revoking DELETE trades a resettable counter for an unbounded row count — the right trade, but the file currently says only that "what does not happen any more is the row… going away" without saying the rows now accumulate without limit.

======================================================================
## FINDING #9  [security / minor]
WHERE: sql/038_transport_companies.sql:593-603 (`runs_cap` and its DECLARED AUTHORITY comment) against :2065 (`least(r.runs_cap, v_cfg.max_runs_per_rig)`) and :854 (`max_runs_per_rig int not null default 10`)

### PROBLEM
THE CLAMP THAT IS SUPPOSED TO MAKE A FORGED RUNS COUNT FAIL SAFE NEVER BINDS. :597-600 says the server "honours least(runs_cap, transport_config.max_runs_per_rig), so if the two ever disagree the carrier gets FEWER runs than the UI promised. That is the correct direction for this disagreement to fail in". That is true only for a client that under-claims. max_runs_per_rig is 10 and the design ladder's top rung (Mythic) is also 10 — rigs.data.js:489-543, `3/4/5/6/8/10 by rarity × PP_COND_MULT, floor, min 1` — so `least()` clamps nothing for any claim a client can make, and the column CHECK `between 1 and 10` is the only bound on it.

MEASURED as `authenticated`: a single insert with `rarity 'mythic', condition 'Pristine', runs_cap 10` was accepted for a rig with no server-verifiable backing. A console-registered Wrecked Common — honest value floor(3 × 0.30) = 1 run/day — gets ten. The header lists this among the four things the server genuinely owns (":253 rate — runs per rig per day, and free bays, both server-counted") and ⚖ THE LIMIT OF THE GUARANTEE lists what a client may still claim ("a rig it does not own… a better condition than the rig has… a depot level it has not built") without listing the runs cap itself. The server owns runs_USED, which is genuinely un-resettable as of this round; it does not own runs_CAP.

Calibration, so this is not read as bigger than it is: a client can already claim `rarity 'mythic'` and `condition 'Pristine'`, both disclosed, so a server-side derivation from those two columns would hand out 10 anyway. The exploitable delta over the disclosed envelope is zero; what is wrong is a security-relevant comment asserting a safety property the code does not have, on the exact column the header points at when it says the rate is server-owned.

### PROPOSED FIX
Either make the clamp real or stop claiming it. Real: lower `max_runs_per_rig` to the ladder value the server is willing to honour for an UNVERIFIED claim (the design's Common rung, 3, is the honest floor) and let a verified upgrade path raise it later — that turns `least()` back into the bound the comment describes. Cheap and honest: correct :597-600 to say that runs_cap is a claim bounded only by the column CHECK, that max_runs_per_rig is a structural ceiling rather than a clamp because it equals the ladder's maximum, and add "claim a runs cap the rig cannot earn" to the ⚖ THE LIMIT OF THE GUARANTEE list beside "claim a better condition than the rig has" (:432-437), where it belongs. Also worth one line in §5 while touching this: the `residual_grants` column (:2888-2893) tests only `has_table_privilege('authenticated', …)`, and TRUNCATE is the one command that consults no policy — if a later migration ever re-grants ALL to `anon`, the ledger becomes truncatable by every logged-out visitor's key and that column still reads 0. `in ('anon','authenticated')` over the same three privileges closes it.

======================================================================
## FINDING #13  [regression / minor]
WHERE: sql/038_transport_companies.sql:559 (`transport_companies_name_ck`) and :1654 / :1857 (the two new floors) vs the §5 verify select at :2826-2905

### PROBLEM
TWO OF THIS ROUND'S NEW CLAIMS ARE ASSERTED IN THE HEADER AND CHECKED BY NOTHING AT THE BOTTOM. §5 is otherwise exhaustive and this round extended it correctly for the TRUNCATE work — `residual_grants` was added specifically so "the claim is checked rather than asserted". But the same round added a server-side length bound (`transport_companies_name_ck`, :559) and a price/units floor (`min_units_per_contract`, `min_price_per_contract`, enforced at :1654 and :1857) with no verify column for either. The header at :199-202 states the name bound as measured fact ("AFTER: all three are 'permission denied' / check-constraint violations") and :368 lists the floors among what the file enforces. A constraint dropped by a later migration, or a floor column tuned to 0 in the SQL editor — which :1633 explicitly anticipates ("a future operator tuning min_units_per_contract to 0") — leaves every existing column in the Expect row reading exactly as specified. The tariff ceiling got `over_ceiling_sheets` for precisely this reason; its two new siblings did not.

### PROPOSED FIX
Add two columns to the §5 select and to the `-- Expect:` line at :2814-2818. Constraint presence: `(select count(*) from pg_constraint where conname in ('transport_companies_name_ck','transport_companies_tariff_ck','transport_ledger_sign_ck')) as data_constraints` — expect 3. Floors still in force: `(select count(*) from public.transport_config where id = 1 and (min_units_per_contract <= 0 or min_price_per_contract <= 0)) as floors_off` — expect 0. Both are the same shape as the negatives already there, and `floors_off` is the only thing that can see a floor tuned away.
