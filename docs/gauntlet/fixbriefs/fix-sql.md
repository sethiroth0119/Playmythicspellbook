# FIX BRIEF — fix-sql

Close EVERY finding below. Each was found by an integration agent that read the real
files across seams, and each was verified against running code. The proposed fix is a
strong suggestion, not a mandate — if you find a better one, take it and say why.

## FILES YOU OWN (write ONLY these)
- sql/038_transport_companies.sql


======================================================================
## FINDING #7  [security]
WHERE: sql/038_transport_companies.sql:444 (`units numeric check (units > 0)`), :1259 (quote's only units bound is the MAX), :1391 / :1327 (`v_price := ceil(...)`)

### PROBLEM
There is no lower bound anywhere on `units`, and therefore no minimum contract price. `units` is `numeric`, so `p_units = 0.000001, p_hops = 1` prices at `ceil(1e-8) = 1` — one Cinder — at ANY tariff, including the 500 ceiling. transport_config has a max for every lever and a min for none. This is the root of three attacks that the file's own security header claims are closed:

(a) RELIABILITY GRIEFING, the exact attack §4.2 is written to prevent. That section refuses to write a 'refused' contract row because "a rival could loop this function against any carrier and destroy their public reliability from a script." But a rival does not need refusals — a SUCCESSFUL 1-Cinder dispatch also lands in the reliability denominator (`k.status in ('delivered','late','lost','refused')`, :1848), and it carries a server-rolled 16-24% loss chance at reach-limit hops. So a rival buys 'lost' rows against a competitor at 1 Cinder each. The defended door is bolted; the wall next to it is open.

(b) SELF-DEALING RELIABILITY PUMP AND MEDIAN ENTRY. Nothing in transport_dispatch checks `v_co.owner_id <> v_uid`, so a carrier is a legal shipper to their own charter. The header's defence #2 for the Meridian median says only carriers that have DELIVERED are sampled because "a charter is free; a delivery is not — it costs some shipper a real dispatch fee through that carrier. This is what makes the sock-puppet attack cost money instead of a loop." It costs 1 Cinder, paid by the attacker to their own company. The same 1-Cinder self-haul pumps a charter's public reliability toward 100% and buries real losses.

(c) COMPETITOR DENIAL OF SERVICE. The SHIPPER chooses `p_rig_id` (:1620), so a rival picks which of a carrier's rigs to burn. ~120 Cinder exhausts a 12-rig fleet's daily runs; 6 Cinder fills every bay of a level-3 depot for 25 minutes per hop and loops. Blacklisting is the only counter and it is reactive.

### PROPOSED FIX
Add `min_units_per_contract` and `min_price_per_contract` to transport_config (with matching `add column if not exists` lines), and enforce them in transport_quote — the min-units check beside the max at :1259, and the min-price check at THE SINGLE EXIT (:1414) so both branches pass it, the same structure the max already uses. Separately, make self-dealing visible rather than free: exclude contracts whose `shipper_id` equals the carrier's `owner_id` from the reliability recompute at :1848 and from the `exists (... status = 'delivered')` gate at :1310, so a carrier cannot be their own reference.

======================================================================
## FINDING #8  [security]
WHERE: sql/038_transport_companies.sql:699-716 — `transport_caps(p_company_id uuid)`, `grant execute ... to authenticated`

### PROBLEM
The helper is SECURITY DEFINER, takes an ARBITRARY company id, and is granted to `authenticated` — so PostgREST exposes it as `rpc/transport_caps` and any player can call it against any carrier. It returns `fleet_used` and `fleet_slots_left`, which is exactly the information two other places in this same file deliberately withhold:

- `trg_sel` (:1080) restricts rig reads to the owner because "a rival's fleet composition is competitive information — how many rigs ... knowing a carrier is out of runs is knowing exactly when to undercut them."
- the fleet-cap guard (:947-961) splits its error into an owner branch and a bare-code branch specifically so that "without this the guard would hand out, through a refusal, exactly what the SELECT policy four sections down refuses to hand out through a query."

The guard closes the refusal channel and the policy closes the query channel, and then the helper hands the same number to anyone who asks. Company ids are trivially enumerable because `tco_sel` is `using (true)` (:1006).

This is a leak of a stated-confidential value, not of the config ceilings — the header explicitly says the ceilings "are not secret", so `transport_tariff_ok` being probe-able is fine; `fleet_used` is not in that category.

### PROPOSED FIX
Split the function. Keep the pure ladder (`reach`, `bays`, `fleet_cap` — all derivable from the public `depot_level` anyway) answerable for any company, and gate the two counting keys on ownership: emit `fleet_used`/`fleet_slots_left` only when `public.is_transport_owner(p_company_id)`, omitting them otherwise. Every internal caller that needs the count already has it — transport_fleet_cap_guard runs its own count (:955-957) and transport_dispatch reads only `bays` (:1596) — so no server path regresses, and transport_set_sheet's payload (:2081) is owner-only by construction.

======================================================================
## FINDING #9  [security]
WHERE: sql/038_transport_companies.sql:1085 (`trg_ins` pins `runs_used = 0`), :1097 (`trg_del` allows delete when `status <> 'hauling'`), :1108 (only UPDATE is revoked on transport_rigs)

### PROBLEM
The per-rig daily run cap is carried on the rig row, and the rig row is free to destroy and recreate. DELETE is granted (only UPDATE is revoked at :1108), `trg_del` permits it for any rig that is not currently 'hauling', and `trg_ins` pins the new row's `runs_used` at 0. Registration costs nothing — contracts.js:917 states so explicitly — and the §2b fleet guard counts LIVE ROWS, not registrations, so it never sees the churn.

So a carrier at their cap settles a haul (rig returns to 'idle' at :1826), deletes the rig, re-inserts it, and has a full day's runs again. Two `.from('transport_rigs')` calls from a devtools console. The header lists this among the four things the server genuinely owns — ":253 rate — runs per rig per day, and free bays, both server-counted" — and it is the bound that matters most once the deliberately-absent payout leg lands, because it is the only thing rate-limiting a carrier's income.

Two smaller things compound it in the same area:
- `trg_ins` pins `runs_used`, `repairs_used`, `assigned_to` and `status` but not `day_key` or `repair_day`, so the comment's "every counter is PINNED AT ITS ZERO" is half true. Harmless only because each unpinned key's partner counter is pinned.
- the charge-failure unwind at :1688-1689 sets `status = 'idle'` unconditionally. A rig carrying a second, still-in-flight haul is moved to 'idle' by an unrelated failed dispatch, which then walks it past `trg_del`'s `status <> 'hauling'` guard — the guard whose stated purpose is that "retiring one mid-haul is not [allowed], because the contract would keep an arrival time nobody is driving towards."

### PROPOSED FIX
Stop storing the rate limit on a row the client can delete. Count the day's runs from the contract rows instead — `count(*) from transport_contracts where carrier_id = ... and rig_id = ... and depart_at >= <utc day start>` — which is a table with no client INSERT, UPDATE or DELETE path at all (:1128), and compare it against `least(runs_cap, max_runs_per_rig)` in the dispatch WHERE clause. If the rig row must stay the counter, then revoke DELETE, drop `trg_del`, and move retirement to a status change inside an RPC (`status = 'retired'` is already in the CHECK ladder and already filtered by `transport_caps`, so the slot still frees). Separately: add `day_key` and `repair_day` to `trg_ins`'s pinned set, and scope the unwind to `and status = 'hauling' and not exists (select 1 from transport_contracts where rig_id = v_rig_id and status = 'in_transit')`.

======================================================================
## FINDING #10  [security]
WHERE: sql/038_transport_companies.sql:319-320 (`name text not null`, `home_node_id text`) against `tco_ins` at :1025

### PROBLEM
`tco_ins`'s with-check is described as "doing six separate jobs" and constrains owner_id, status, reliability, blacklist and the tariff — but not `name` or `home_node_id`, and neither column has a length CHECK. transport_companies is the one world-readable table in the file (`tco_sel using (true)`), and the rate board selects both columns.

Every other client-supplied string in this migration is bounded on the server: cargo by `pg_column_size(p_cargo) > 2000` (:1502), from/to_node by `left(..., 40)` at insert (:1710), client_ref by `left(..., 64)` (:1533), the blacklist by `array_length > 200` (:2065). These two are bounded only by contracts.js:794 and :811's `.slice(0, 40)` — a client-side truncation, which is the one kind of bound this file otherwise refuses to rely on. A console skips it and writes a multi-megabyte name onto a row every client fetches for the rate board.

### PROPOSED FIX
Add the constraint in the same idempotent style as `transport_companies_tariff_ck` (:355): `drop constraint if exists transport_companies_name_ck` / `add constraint transport_companies_name_ck check (length(name) between 1 and 40 and length(coalesce(home_node_id, '')) <= 40)`. That also makes the client-side slice a convenience rather than the enforcement, which is the posture the rest of the file takes.

======================================================================
## FINDING #11  [security]
WHERE: sql/038_transport_companies.sql:1047, 1108, 1128, 1146, 1157 — the five revoke lines

### PROBLEM
The revokes enumerate SELECT/INSERT/UPDATE/DELETE and stop there, but Supabase's default privileges grant ALL on tables in `public` to `authenticated`, and ALL includes TRUNCATE. This repo has already measured the residue: sql/028:11 and :174 record the observed grant set on a table after exactly this revoke pattern as "REFERENCES, SELECT, TRIGGER, TRUNCATE".

TRUNCATE ignores RLS entirely — no policy is consulted. So `truncate public.transport_ledger` erases the append-only book the whole feature rests on, and nothing in transport_ledger is referenced by a foreign key, so it needs no CASCADE. `truncate public.transport_config` removes the ceilings row. The header's per-table "WRITE: nobody" claims and the "APPEND-ONLY, ENFORCED RATHER THAN ASSERTED" comment at :1130 are both true of DML and silent about the one command that bypasses the mechanism they rely on.

Calibration: this is not reachable from a devtools console — PostgREST has no TRUNCATE verb, and players hold a JWT rather than database credentials. It is a defence-in-depth gap, and it is the only privilege the file's own "the denial does not depend on a policy staying deleted" argument does not actually cover.

### PROPOSED FIX
Append `truncate` to each of the five revokes — e.g. `revoke update, delete, truncate on public.transport_companies from anon, authenticated;` and the equivalent on rigs, contracts, ledger and config. Then add a column to §5's verify so the claim is checked rather than asserted, matching how that section already treats every other negative: `(select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname='public' and c.relname in ('transport_companies','transport_rigs','transport_contracts','transport_ledger','transport_config') and has_table_privilege('authenticated', c.oid, 'TRUNCATE')) as truncatable` — expect 0.
