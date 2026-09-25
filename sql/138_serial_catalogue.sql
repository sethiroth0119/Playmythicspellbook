-- ============================================================================
-- 138 — THE CATALOGUE REGISTER (every card gets a serial number)
-- Project: ktsiasyjusesawtrwrjc   Status: APPLIED (verified live 2026-09-16 — do not re-run; see 139)
-- ⚠ REQUIRES 137 FIRST. It adds a column to serialized_runs and reuses its
--   tables, functions and RLS wholesale.
-- ----------------------------------------------------------------------------
-- Owner: "Give each card serial numbers" — applied to the WHOLE game, not only
--  to pressed runs — and "I want to increase the number to 500000 from the
--  100000 but still want that button for that 10k only."
--
-- 🔴 TWO KINDS OF RUN, AND CONFLATING THEM WOULD END THE GAME'S CARD SUPPLY.
--    A PRESS run (137) is a hard-limited edition whose card is removed from
--    every other source. A CATALOGUE run is a REGISTER: 500,000 deep, and it
--    changes nothing about how a card is obtained. The client-side gate was a
--    single predicate before this migration was written, and it refuses any card
--    it considers serialized — so giving every card a run without splitting that
--    predicate first would have made every grant in the game refuse: no pack, no
--    drop, no reward. The split shipped alongside this file; _serial_smoke §7 is
--    the check that holds it.
--
-- 🔴 A CARD HOLDS EXACTLY ONE RUN. serialized_runs.card_id stays UNIQUE, which
--    is what makes "#7 of that card" unambiguous. The consequence is stated
--    rather than hidden: a card that is already in circulation has a catalogue
--    run and therefore CANNOT be pressed into a limited edition later. That is
--    not a limitation of the schema so much as of the promise — "only 10,000 of
--    this will ever exist" cannot be made about a card whose existing copies
--    nobody counted. Press a card before it is distributed; the Forge pill says
--    this on the card itself rather than failing on click.
--
-- ⚠ ORDERING: OLDEST ACCOUNTS FIRST. The owner's choice, and the only ordering
--   backed by real data — acquisition dates were never recorded, so "who got
--   this copy first" is genuinely unknown and any claim to reconstruct it would
--   be invented. auth.users.created_at is a fact we actually hold, so the
--   earliest accounts receive the lowest numbers. All 128 profiles join to it.
--
-- ⚠ A CATALOGUE NUMBER IS WEAKER THAN A PRESS NUMBER AND THE UI MUST NOT IMPLY
--   OTHERWISE. A press serial is issued against a hard cap and cannot be
--   conjured. A catalogue serial is issued against user_profiles.forge ->
--   '__cardCollection__', which is a client-authored blob. Numbering a claimed
--   copy does not audit it. This register records what the collection says; it
--   is not a second opinion on whether that is true.
--
-- Measured before writing (production, 2026-09-15): 128 profiles, 635 distinct
-- cards held, 8,624 (player, card) holdings, 51,948 total copies, largest single
-- stack 234. The backfill is therefore ~52k inserts — small, and it runs once.
--
-- Re-runnable. Idempotent: re-running issues numbers only for copies that do not
-- have one yet.
-- ============================================================================

alter table public.serialized_runs
  add column if not exists kind text not null default 'press';

do $do$
begin
  if not exists (select 1 from pg_constraint where conname = 'serialized_runs_kind_chk') then
    alter table public.serialized_runs
      add constraint serialized_runs_kind_chk check (kind in ('press', 'catalogue'));
  end if;
end $do$;

create index if not exists serialized_runs_kind_idx on public.serialized_runs(kind);

-- 137's serial_runs_open() predates `kind`; widen it so the market can tell a
-- press run (buyable) from a catalogue register (not for sale).
-- 🔴 DROP FIRST, AND IT IS NOT OPTIONAL. 137 already defines this function
--    returning EIGHT columns; this version returns NINE (it adds `kind`).
--    `create or replace function` cannot change a return type — Postgres
--    refuses with 42P13 "cannot change return type of existing function /
--    Row type defined by OUT parameters is different". So on a database where
--    137 has been applied — which is every database this file is FOR, since it
--    requires 137 — the bare create fails and takes the whole migration with
--    it. Observed in the Supabase SQL editor on first application.
--    `if exists` keeps the file re-runnable on a fresh database where 137's
--    copy is not there yet, which is the property the header claims.
--    ⚠ No CASCADE: nothing should depend on this function, and if something
--    does, failing loudly here is better than silently dropping it too.
drop function if exists public.serial_runs_open();
create or replace function public.serial_runs_open()
returns table(id uuid, card_id text, card_name text, rarity text, card_json jsonb,
              total integer, price integer, claimed integer, kind text)
language sql stable security definer set search_path = public as $fn$
  select r.id, r.card_id, r.card_name, r.rarity, r.card_json, r.total, r.price,
         (select count(*)::int from public.serial_copies c where c.run_id = r.id),
         r.kind
    from public.serialized_runs r
   order by r.created_at desc;
$fn$;

-- ── issue numbers for one user's unnumbered copies ──────────────────────────
-- ⚠ THIS IS THE ONLY MECHANISM, FOR BOTH THE BACKFILL AND EVERY FUTURE GRANT.
--   index.html increments Profile.cardCollection at 39 sites; none of them can
--   block on a network round-trip (a loot drop resolving mid-battle certainly
--   cannot), and a site that grants the card but drops the number leaves a copy
--   unnumbered forever. So no grant site changes at all: the server reads the
--   user's own uploaded collection and issues whatever the register is missing.
-- ⚠ p_user is NOT a parameter a client can choose — serial_reconcile() below
--   passes auth.uid() and nothing else is granted to authenticated.
create or replace function public.serial_issue_for_user(p_user uuid)
returns integer
language plpgsql security definer set search_path = public as $fn$
declare
  v_issued integer := 0;
  v_name   text;
  rec      record;
  v_run    uuid;
  v_total  integer;
  v_have   integer;
  v_next   integer;
  i        integer;
begin
  if p_user is null then return 0; end if;
  select coalesce(nullif(raw_user_meta_data ->> 'display_name', ''), email)
    into v_name from auth.users where id = p_user;

  for rec in
    select k.key as card_id, greatest(0, least(100000, (k.value)::int)) as qty
      from public.user_profiles p,
           lateral jsonb_each_text(coalesce(p.forge -> '__cardCollection__', '{}'::jsonb)) as k
     where p.user_id = p_user
       and k.value ~ '^[0-9]+$'
       and (k.value)::int > 0
  loop
    -- The run this card belongs to. A card that has never been seen before gets
    -- a catalogue register; a card that was PRESSED keeps its press run and is
    -- never given a second one, because card_id is unique and the press run is
    -- the stricter promise.
    select id, total into v_run, v_total
      from public.serialized_runs where card_id = rec.card_id;

    if v_run is null then
      insert into public.serialized_runs (card_id, card_name, rarity, card_json, total, admin_reserved, price, kind)
      values (rec.card_id, rec.card_id, 'common', '{}'::jsonb, 500000, 0, 0, 'catalogue')
      on conflict (card_id) do nothing;
      select id, total into v_run, v_total
        from public.serialized_runs where card_id = rec.card_id;
    end if;
    if v_run is null then continue; end if;

    -- Lock the run, then top this user up to the count their collection claims.
    perform 1 from public.serialized_runs where id = v_run for update;
    select count(*)::int into v_have
      from public.serial_copies where run_id = v_run and owner_id = p_user;

    while v_have < rec.qty loop
      select coalesce(max(serial), 0) + 1 into v_next
        from public.serial_copies where run_id = v_run;
      exit when v_next > v_total;            -- the register is full; issue no more
      insert into public.serial_copies (run_id, serial, owner_id, owner_name)
      values (v_run, v_next, p_user, v_name);
      v_have := v_have + 1;
      v_issued := v_issued + 1;
    end loop;
  end loop;

  return v_issued;
end $fn$;

-- What the client calls. It can only ever number ITS OWN holdings.
create or replace function public.serial_reconcile()
returns table(ok boolean, issued integer)
language plpgsql security definer set search_path = public as $fn$
declare n integer;
begin
  if auth.uid() is null then return query select false, 0; return; end if;
  n := public.serial_issue_for_user(auth.uid());
  return query select true, n;
end $fn$;

-- ── the one-time backfill, oldest accounts first ────────────────────────────
-- ⚠ THE ORDER OF THE LOOP IS THE ENTIRE POINT. Numbers are handed out in
--   account-creation order, so the earliest players hold #1, #2, #3 of the cards
--   they own. Run it once; re-running is harmless (every copy already numbered
--   is skipped) but will NOT re-order anything already issued — so if the
--   ordering is ever to change, it has to change before the first run.
create or replace function public.serial_backfill_catalogue()
returns table(ok boolean, status text, users_done integer, serials_issued integer)
language plpgsql security definer set search_path = public as $fn$
declare u record; v_users integer := 0; v_total integer := 0;
begin
  if not public.serial_is_admin() then
    return query select false, 'admins only', 0, 0; return;
  end if;
  for u in
    select p.user_id
      from public.user_profiles p
      join auth.users a on a.id = p.user_id
     order by a.created_at asc, p.user_id asc
  loop
    v_total := v_total + public.serial_issue_for_user(u.user_id);
    v_users := v_users + 1;
  end loop;
  return query select true, 'backfilled', v_users, v_total;
end $fn$;

revoke all on function public.serial_issue_for_user(uuid) from public, authenticated;
grant execute on function public.serial_reconcile()          to authenticated;
grant execute on function public.serial_backfill_catalogue() to authenticated;

-- ── verify ──────────────────────────────────────────────────────────────────
-- Run the backfill and read the result:
--     select * from public.serial_backfill_catalogue();
-- Then confirm the oldest account holds low numbers:
--     select a.created_at, c.serial, r.card_name
--       from public.serial_copies c
--       join public.serialized_runs r on r.id = c.run_id
--       join auth.users a on a.id = c.owner_id
--      order by a.created_at asc, c.serial asc limit 20;
select 'runs' as t, count(*)::text as n from public.serialized_runs
union all select 'runs(catalogue)', count(*)::text from public.serialized_runs where kind = 'catalogue'
union all select 'runs(press)',     count(*)::text from public.serialized_runs where kind = 'press'
union all select 'copies',          count(*)::text from public.serial_copies;
