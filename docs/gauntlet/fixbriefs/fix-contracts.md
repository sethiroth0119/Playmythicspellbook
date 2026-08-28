# FIX BRIEF — fix-contracts

Close EVERY finding below. Each was found by an integration agent that read the real
files across seams, and each was verified against running code. The proposed fix is a
strong suggestion, not a mandate — if you find a better one, take it and say why.

## FILES YOU OWN (write ONLY these)
- public/src/transport/contracts.js


======================================================================
## FINDING #4  [contracts]
WHERE: public/src/transport/contracts.js:876  ↔  sql/038_transport_companies.sql:2082-2087

### PROBLEM
setTariff() READS TWO KEYS THE RPC DOES NOT RETURN AT TOP LEVEL. contracts.js:876 builds its answer as `{ … status: d.status, depotLevel: d.depot_level, bays: d.bays, fleetCap: d.fleet_cap, row: d }`. transport_set_sheet's success envelope (sql/038:2082-2087) is `jsonb_build_object('ok', true, 'company_id', …, 'tariff', v_clean, 'status', v_status, 'depot_level', v_lvl, 'caps', public.transport_caps(p_company_id), 'charter_slots_left', …, 'blacklist_count', …)`. `bays` and `fleet_cap` live INSIDE `caps` (transport_caps builds `reach/bays/fleet_cap/fleet_used/fleet_slots_left`, sql/038:700-713), not on the envelope. So `r.bays` and `r.fleetCap` are always `undefined`. index.js:948 only prints `r.tariff` today, so nothing is visibly wrong — which is precisely why it will be trusted: the next caller reading `r.fleetCap` gets undefined from a call site that looks like it was designed to supply it, and `charter_slots_left` (the number sql/038:770-785 says is exactly what a 'Found a charter' button needs to grey itself out) is dropped on the floor.

### PROPOSED FIX
Read them where the server puts them: `const caps = (d.caps && typeof d.caps === 'object') ? d.caps : {};` then `bays: caps.bays, fleetCap: caps.fleet_cap, reach: caps.reach, fleetSlotsLeft: caps.fleet_slots_left, charterSlotsLeft: d.charter_slots_left`. Note in the comment that transport_caps() returns NULL for a company that does not exist (sql/038:697), so a caller must compare the extracted value rather than trust it.

======================================================================
## FINDING #5  [contracts]
WHERE: public/src/transport/contracts.js:931 and :810 (via fail(), contracts.js:191)  ↔  sql/038_transport_companies.sql:884, :949, :957

### PROBLEM
THE TWO IN-STATEMENT CAP GUARDS RAISE CODES NO CLIENT PATH TRANSLATES. registerRig() and createCompany() are direct PostgREST inserts, not RPCs, so their errors go through fail() (contracts.js:191) and never through explain()/CODES (contracts.js:216-345). fail() produces `{ok:false, error: e.message}` with no `why`, and index.js's reasonOf() falls back to `String(r.error)`. The BEFORE INSERT triggers raise `charter_cap` (sql/038:884), `fleet_cap` (sql/038:949 and :957) and `transport_config_missing` (sql/038:871, :915) as the exception MESSAGE, with the human numbers in `detail` and the remedy in `hint` — both of which fail() discards (it reads e.message first). Result: a player who registers one rig past the depot's parking sees the toast `🚛 fleet_cap`, and a player founding a fourth charter sees `🚛 charter_cap`. depot.js:906 states the intended contract in as many words — "Registering a rig past the exchange's cap is refused as 'fleet_cap'" — as something the player is supposed to be able to act on. Neither string appears anywhere in /src/transport.

### PROPOSED FIX
Add the three codes to CODES in contracts.js (they are refusals with numbers, exactly like the RPC ones): `fleet_cap: (d) => ({ why: 'Your yard has no parking left' + (d.cap ? ' — ' + d.cap + ' slots, all taken' : '') + '.', fix: 'Retire a rig, or raise the Freight Depot level for more slots.' })`, plus `charter_cap` and `transport_config_missing`. Then route the two direct-insert failures through them: in registerRig() and createCompany(), when `r.error` arrives, take the code from `r.error.message` and merge `explain(code, parseDetail(r.error.details))` onto the fail() envelope, falling back to the verbatim branch for anything unrecognised. Export explain() or a thin `failCoded(e)` wrapper so there is still exactly one table. Note in the comment at contracts.js:198 that the table now covers BOTH the RPC jsonb refusals and the trigger exceptions on the two insert paths.
