# BRIEF — sql/038 — transport schema, RLS, definer helpers and the four RPCs

## GOAL
Write ONE new file, /home/user/Playmythicspellbook/sql/038_transport_companies.sql, that creates the four transport tables with their RLS in the same file, the SECURITY DEFINER ownership helper, a single-row config table for the server-owned ceilings, and the four RPCs transport_quote / transport_dispatch / transport_settle / transport_repair. It must be idempotent and re-runnable, must state its own status honestly at the top (it has NEVER been run — there is no CLI login in this repo and migrations are pasted by hand into the Supabase SQL editor for project ktsiasyjusesawtrwrjc), and must end with a counted verify query containing at least one NEGATIVE assertion. It is the entire security boundary for a feature where one player pays another player real Cinder, so the header must argue the boundary line by line and must publish the limit of what it can actually guarantee.

## FILES YOU OWN (write ONLY these)
- sql/038_transport_companies.sql

## ACCEPTANCE CRITERIA (a critic verifies each against your real output)
1. File exists at sql/038_transport_companies.sql. It is the ONLY file added; there is no RUN_038_*.sql (RUN_* files are hand-paste bundles, not a parallel series) and no 016/038b.
2. Header states STATUS honestly (never run, applied by hand, what applying it does and does not achieve) and contains a 🔒 SECURITY REVIEW block that names, per bullet, the attack each measure closes — not what the measure does.
3. Header contains a section stating the LIMIT of the guarantee: what the server cannot check here (e.g. cargo the client claims to hold lives in Profile.salvage, a client blob; the server can bound and address a settlement but cannot recompute the shipper's inventory) with an explicit 'Do not read this file as claiming otherwise.'
4. Exactly four data tables + one config table, each with `create table if not exists`, each followed by `alter table … enable row level security` IN THIS FILE. grep proves 5 enable-RLS statements.
5. `public.is_transport_owner(p_company_id uuid)` exists as `language sql stable security definer set search_path = public`, takes the company id and answers about auth.uid() only — never takes a user id. Followed by `revoke all on function public.is_transport_owner(uuid) from public, anon;` and `grant execute … to authenticated;`.
6. For each table T, `grep -A8 "create policy .* on public.T"` does NOT mention T inside the policy body. No self-referential policy anywhere.
7. `using (true)` appears at most on transport_companies (the public rate board) and carries a comment saying it is a public directory. It appears on none of rigs / contracts / ledger / config.
8. transport_contracts SELECT policy names BOTH sides: `shipper_id = auth.uid()` OR `public.is_transport_owner(carrier_id)`. A policy expressing only one side fails.
9. NO UPDATE policy exists on transport_rigs or transport_companies, and `revoke update on public.transport_rigs from anon, authenticated;` + the same for transport_companies are present, with a comment explaining that Postgres RLS has no column granularity so a row-level UPDATE policy would also hand over runs_used / day_key / reliability / status.
10. transport_ledger has NO balance/total/earnings column. No INSERT/UPDATE/DELETE policy on it, plus `revoke insert, update, delete on public.transport_ledger from anon, authenticated;` and (if the PK is bigserial) `revoke all on sequence public.transport_ledger_id_seq from anon, authenticated;`. Balance is read as `coalesce(sum(amount),0)` everywhere.
11. transport_ledger.amount carries a sign/kind CHECK constraint added via drop-if-exists + add constraint, with a comment naming the negative-row-poisons-an-append-only-table attack.
12. Every RPC is `security definer` WITH `set search_path = public` (or `public, pg_temp`), and each is followed immediately by `revoke all on function public.NAME(<exact arg types>) from public, anon;` and `grant execute on function public.NAME(<exact arg types>) to authenticated;`. Argument types are spelled out in full.
13. No RPC takes a price, an amount, a user id, a reliability or a runs_used from the caller. transport_dispatch takes ids only and re-reads company / tariff / rig / depot / cap from the rows. transport_settle takes a contract id only.
14. The runs/day increment is a single statement whose WHERE clause is the concurrency guard, e.g. `update … set runs_used = case when day_key = v_today then runs_used + 1 else 1 end, day_key = v_today where id = … and (day_key <> v_today or runs_used < v_cap) returning true into v_ok;` followed by a refusal when v_ok is null. A read-then-write without `for update` fails.
15. day_key is computed from the DATABASE clock inside the function (e.g. `to_char((now() at time zone 'utc')::date,'YYYY-MM-DD')`), never taken as a parameter, with a comment saying why the client's getTodayKey() cannot be the authority.
16. The Meridian ceiling (2.5× median player tariff, 1.6× trip time) is read from the single-row config table inside transport_quote/transport_dispatch, not written as a scattered literal, and the tariff cap is enforced server-side.
17. Every RPC returns `jsonb_build_object('ok', …)` with a distinct `error` code string per refusal, and a not-authenticated branch returning `'not_authenticated'`.
18. Retry safety is explicit: dispatching or settling twice is harmless and says so (a unique index used as the retry guard, or an already-handled branch that returns the existing row rather than erroring), with a comment naming the double-click / dropped-connection case.
19. Ends with a verify query preceded by `-- Expect: …` naming counts the author actually counted, including at least one NEGATIVE assertion such as `(select count(*) from pg_policies where schemaname='public' and tablename='transport_rigs' and cmd='UPDATE') as no_rig_upd` expected 0, and a ledger-has-no-write-policy check.
20. Re-runnable: pasting the whole file twice produces no error. Every create policy has a preceding `drop policy if exists`; every constraint has a preceding `alter table … drop constraint if exists`.
21. No `wallet_credit` call anywhere in the file (grep returns 0). No pg_net / net.http_post / outbound HTTP. No 'discord' or 'webhook' anywhere including comments.

## CONTEXT
You are writing ONE new SQL file: /home/user/Playmythicspellbook/sql/038_transport_companies.sql. You may write no other file. Migrations here are pasted BY HAND into the Supabase SQL editor for project ktsiasyjusesawtrwrjc; there is no CLI login and the Supabase MCP is not reliably authenticated, so do NOT attempt to apply it and do NOT claim it has been applied.

NUMBERING. Highest existing numbered file is sql/037_aza_exchange_fix.sql. There is NO 016_*.sql (016 exists only as RUN_016_corp_hire.sql) and there are 023b/026b letter suffixes, so the rule is highest-number+1, not file count. RUN_*.sql files are hand-paste bundles of the numbered series — do NOT add a RUN_038.

WHAT THE FEATURE IS. A Transportation Company is a player-run business that moves OTHER PLAYERS' freight between map nodes for Cinder. Owner founds a `transport` operation (the charter), plants a Freight Depot city building (origin + reach + concurrent-bay cap), and stocks a fleet of rigs bought on the Prince Portfolios auction floor. Rig rarity sets runs/day (3 Common … 10 Mythic). A shipper picks a carrier from a public rate board, pays, the cargo travels, and on arrival the carrier's ledger is credited. An NPC carrier, Meridian Haulage, is ALWAYS available at 2.5× the median player tariff and 1.6× trip time — it is a price CEILING so a monopolist cannot end another player's game by refusing service; it must never be cheaper or faster than a rational player quote.

SCHEMA the design doc fixes (you may add columns, not remove these):
  transport_companies (id, owner_id, name, home_node_id, depot_level, tariff jsonb, reliability, blacklist uuid[], status, created_at)
  transport_rigs      (id, company_id, owner_id, vehicle_id, rarity, condition, runs_used, day_key, assigned_to, status)
  transport_contracts (id, carrier_id, shipper_id, from_node, to_node, cargo jsonb, price, escort, risk_pct, depart_at, arrive_at, status, settled_at)
  transport_ledger    (id, company_id, contract_id, amount, kind, created_at)  -- append-only
Plus a single-row `transport_config` (id=1) holding the server-owned ceilings: meridian_tariff_mult 2.5, meridian_time_mult 1.6, max_runs_per_rig, max_price_per_contract, max_hops. Read it with `select * into v_cfg from public.transport_config where id = 1;`.

⚠ `assigned_to` is a DEAD HOOK in this release and must be labelled as one. Battle integration (a rig riding along on a raid, out of the fleet for the duration) is build-order step 5 and is NOT being built. Ship the column with a comment saying what will write it, what currently does not, and that a rig is never removed from the player's PP lot — that would silently revoke their battle-loot extraction, which is gated on `p.lot.length > 0`.

RATIFIED, NOT OPEN: Meridian at exactly 2.5 / 1.6; Garage rigs (the $20/$60/$99 real-money SKUs) are a SEPARATE rail and are never registered as fleet rigs — the perk they grant is fleet-wide (+1 fleet slot / +1 run per day) and is computed CLIENT-side from the best owned tier, so nothing here needs to know about them beyond accepting a caller-independent runs cap; and `_convoyCanSend()` (the player's own squad deployment) is never gated by freight. Do not argue any of these in a comment.

RELIABILITY IS DERIVED, NEVER STORED-AND-UPDATED: delivered / (delivered + late + refused + lost), computed from transport_contracts rows. If you keep a `reliability` column at all it must be a cache the server recomputes, and the comment must say the contract rows are the authority. `update transport_companies set reliability = <caller value>` is a fail.

═══ THE HOUSE IDIOMS. Copy these exactly. ═══

Header. Two banner styles are in use; pick one and keep it. Box-drawing `-- ═══…` (sql/001, 003, 015) or ASCII `-- ===…` (sql/022, 036, 037). The header is a NARRATIVE with named sections, not a summary. sql/RUN_016_corp_hire.sql uses THE BUG / THE FIX / 🔒 SECURITY REVIEW. sql/015 opens with its own status in red. Body is divided by numbered rules: `-- ─── 1. TABLES ───────`, `-- ─── 2. SECURITY DEFINER HELPERS (the anti-recursion layer) ───`, `-- ─── 3. RLS ───`, `-- ─── 4. RPCs ───`, `-- ─── 5. VERIFY ───`.

Idempotency, every statement, no exceptions:
  table      create table if not exists public.X (...)
  column     alter table public.X add column if not exists c type;
  index      create index if not exists X_y on public.X (...);
  function   create or replace function public.f(...)
  policy     drop policy if exists p on public.X;  then  create policy p ...
  constraint alter table … drop constraint if exists n;  then  add constraint n check (...)
There are NO `do $$ … $$` DDL blocks in the numbered series and no transaction wrappers — files run top to bottom in the web SQL editor. Enum-ish columns are `check (… in (…))` inline, never a real enum type.

SECURITY DEFINER signature, verbatim shapes in use:
  returns jsonb language plpgsql security definer set search_path = public as $function$
  language sql stable security definer set search_path = public as $$
`set search_path` is MANDATORY. RUN_016 states why: "without `set search_path` a caller could shadow `public` and run their own tables as the owner." Then, immediately after every function:
  revoke all on function public.f(uuid, text) from public, anon;
  grant execute on function public.f(uuid, text) to authenticated;
The full argument type list is part of the identifier — sql/019 line 395 spells out eleven types. Never grant to anon.

auth.uid() is read once into a local and everything is keyed off it (sql/037:41-49):
  declare v_uid uuid := auth.uid();
  begin
    if v_uid is null then return jsonb_build_object('ok', false, 'error', 'not_authenticated'); end if;

NEVER TRUST AN ARGUMENT. RUN_016_corp_hire.sql: "Only the founder of THAT corp may hire. Read it fresh; never trust input." It takes ONLY a request id and reads the corp id, the user id and the role back out of the request row, so it "cannot hire into a corp you do not found, cannot invent a user_id, and cannot promote anyone to founder." sql/017:97-100: "There is NO parameter naming a user." sql/022:32-33: "p_user_id is deliberately NOT a parameter." The counter-example is your bar file's own postmortem: sql/015's r9 settle inserted the client payload verbatim — unbounded, unsigned amount, arbitrary to_id, no cross-check against the event row — and two HTTP calls minted a billion Cinder. §4 of sql/015 fixes it by bounding sign, address, magnitude and arity server-side. transport_dispatch is exactly that shape of function. Take ids; re-read tariff, reach, bays, driver count, fuel, rig cap and price from the rows; bound the result against transport_config.

CONCURRENCY. sql/037:96-103 puts the affordability test INSIDE the WHERE clause: "Balance test lives IN the WHERE clause: this is the concurrency guard as well as the affordability check, so two calls cannot both overdraw." Do the same for runs_used and for free bays. Where you must read-then-write, use `select … for update` (sql/019:255).

DAILY COUNTERS. sql/037:70-88 does not store a counter at all — it sums today's ledger: `select coalesce(sum(aza_spent),0) into v_today from public.aza_exchanges where user_id = v_uid and created_at >= date_trunc('day', now());`. Either shape is acceptable for runs/day; if you keep the counter column, it must be writable only by the RPC (no UPDATE grant) and reset by the case-expression pattern above.

RETRY SAFETY. Two shapes exist. RUN_016: "Already handled? Return the existing membership rather than erroring, so a double-click or a retry after a dropped connection is harmless." sql/015:180-186 uses a unique index as the guard: "🔴 ONE ROW PER (event, kind, building). This is what makes a retry SAFE: a settlement that half-succeeded at the network layer and is sent again cannot double-pay, because the second insert collides." A settle RPC that can pay twice is a fail.

RLS RECURSION. sql/001_community_core.sql:10-14: "⚠ RLS RECURSION. A policy on community_members that queries community_members re-enters RLS and can recurse forever. Every membership/leadership check below therefore goes through a SECURITY DEFINER helper, which bypasses RLS and terminates. Do not inline those EXISTS clauses back into the policies." The helper, verbatim shape:
  create or replace function public.is_community_member(p_community_id uuid)
  returns boolean language sql stable security definer set search_path = public as $$
    select exists (select 1 from public.community_members m where m.community_id = p_community_id and m.user_id = auth.uid() and m.status = 'active');
  $$;
Your bar file, sql/015:195-223, proves it generalises to MUTUAL recursion between two tables and adds the scoping rule: a definer helper "should answer the caller's question and nothing wider" — the r9 helper took an arbitrary uuid and returned the host of ANY event including a private planned one. transport_contracts ↔ transport_rigs ↔ transport_companies has exactly that mutual shape. A cross-table EXISTS that does NOT touch the policy's own table is fine inline — sql/020_corp_policies.sql:105-119 does `exists (select 1 from public.corporations c where c.id = corp_policy_log.corp_id and c.founder_id = auth.uid())` and note the qualified column name.

NO COLUMN GRANULARITY — this is your bar file's sharpest section and it applies directly. sql/015:248-259 verbatim: "EVENTS · update. 🔴 NOBODY. There is deliberately no UPDATE policy any more. ⚠ THE r9 BUG THIS REPLACES. `sev_upd` said, in its own comment, that the host may retune 'pricing, vendor fee, the event's own level — and nothing else, ever'. POSTGRES RLS HAS NO COLUMN GRANULARITY. A row-level UPDATE policy permits every column of that row…" followed by `drop policy if exists sev_upd …; revoke update on public.stadium_events from anon, authenticated;` — "so the denial does not depend on this policy staying deleted." A carrier retuning their own tariff is precisely this temptation: route it through a named setter RPC that clamps against transport_config, and revoke UPDATE. The self-service-update escape hatch, if you truly need one, is sql/001:122-131's `with check` pinning the untouchable column to its own current value.

APPEND-ONLY. CLAUDE.md: "Ledgers are append-only. Balance = sum(amount). Never UPDATE a balance column." sql/003_community_ledger.sql:4-6: "Copies corp_treasury EXACTLY: append-only, balance = sum(amount). There is no balance column, because a balance column is a thing that can drift from its own history." And :65-67: "APPEND-ONLY, enforced rather than asserted. No update or delete policy exists and the grants are revoked, so history cannot be edited by anyone." sql/017:79-84 is the fully-locked variant where only the definer function may write, including `revoke all on sequence public.X_id_seq from anon, authenticated;`. The sign rule, sql/015:158-169: "`amount numeric` unconstrained in SIGN was an attack, not a rounding concern: one settle call with a negative `spillover_payout` addressed to a rival permanently poisons their `sum(amount)` in an append-only table that by design has no UPDATE path to correct it." Also sql/015:169-176 on why FKs are `on delete set null` rather than NOT NULL: "deleting a user does not delete the audit history of what they were paid… History may become unaddressed; a payout may never be created unaddressed."

VERIFY. sql/015:540-543 verbatim: "⚠ COUNT THEM. r9 asserted `policies = 6` when the file created 5, and the mismatch survived into two documents because the query was never run." Count what YOU actually create before writing the expected numbers. Two accepted shapes: sql/001:217-229's single row of labelled counts under `-- Expect: tables 2, policies 8, helpers 2, rpcs 2`, or sql/019:413+'s `union all` of `'ok' / 'NOT …'` strings under `-- VERIFY — every line should read 'ok'.` Include the negative assertions. RUN_016 also ends with a data-state report and a stated pass condition ("`stuck_hired` must be 0 for every row") — a per-company sanity row is welcome as a second block.

NAMING. Parameters `p_<name>`, locals `v_<name>`, plpgsql constants `c_<name> constant <type> := …`. Policy names are a short table abbreviation + `_sel|_ins|_upd|_del`: use `tco_*`, `trg_*`, `tct_*`, `tld_*`, `tcf_*`. Text is length-clamped on the way in: `left(coalesce(p_name,'—'), 40)`. Timestamps `timestamptz not null default now()`. PKs: `uuid primary key default gen_random_uuid()` for entities, `bigserial` for the ledger (which then needs the sequence revoke).

DO NOT: put startup/salary/rate numbers in SQL — CLAUDE.md says all operation pricing goes through `_opEcon()` and OPS_ECON lives in public/index.html:79732; only server-owned CEILINGS belong in transport_config. Do not reference a table name copied from an older migration without checking the newest file that touches it (sql/017 created `aza_cinder_exchanges`; the live function in sql/037:76 reads `aza_exchanges` — they drifted). A `%rowtype` field reference is not null-safe: sql/037 exists entirely because `v_cfg.max_aza_per_tx` named a column that never existed and "Referencing a missing field on a plpgsql record RAISES… it does not return null. So every single call threw before touching a balance."

THE CLIENT HALF, so your error codes are useful: /src/transport/contracts.js (built in parallel) will call these via supabase-js `rpc('transport_dispatch', { p_… })`, check BOTH `r.error` and the returned `ok` flag, and give every documented error code its own message. index.html:79921-79926 records four wasted debugging sessions from a toast that blamed a missing migration for any 'does not exist' error: "'does not exist' does NOT mean the RPC is missing. It also fires when the function EXISTS but a table INSIDE it does not." So: make each refusal a distinct short code string, and include the numbers the client needs to render a sentence (cap, used, remaining, needed) in the jsonb.
