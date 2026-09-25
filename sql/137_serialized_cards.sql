-- ============================================================================
-- 137 — SERIALIZED CARDS (the press run)
-- Project: ktsiasyjusesawtrwrjc   Status: APPLIED (verified live 2026-09-16 — do not re-run; see 139)
-- ----------------------------------------------------------------------------
-- Owner: "Make a button where we can make cards Serialized ... make it where I
--  can make it 1 out of 10000 copies in the forge where it will only be 10k of
--  that card ever put into the game. I click it in the forge the admins get 3
--  and the rest go to the market until they are gone."  +  "Give each card
--  serial numbers and allow for players to look up cards with the serial number
--  in the player market."
--
-- 🔴 WHY THIS IS SERVER-SIDE AND NOT A CLIENT FEATURE.
--    "Only 10,000 of that card will ever exist" is a promise about every device
--    at once. The client cannot keep it: Profile.cardCollection is a count map
--    in a JSONB blob that syncs last-write-wins, so two tabs claiming the last
--    copy both succeed locally and both believe they hold #10000. A scarcity
--    guarantee that a second browser tab can break is not a guarantee — it is a
--    label. The serial is therefore ISSUED BY POSTGRES, once, under a row lock,
--    and the client is told what it got. Same reason chat_send() and
--    wallet_charge() moved server-side: the number has to be true for everyone.
--
-- 🔴 UNIQUE(card_id) IS THE "ONLY EVER" CLAUSE. It is not a nicety. Without it
--    an admin who clicks the button twice mints a second run of the same card
--    and there are suddenly two #1s in the world. The uniqueness of the RUN is
--    what makes a serial mean anything; PRIMARY KEY (run_id, serial) then does
--    the same job one level down.
--
-- ⚠ ESCROW, NOT COPY-ON-SALE. The card market grants a purchase by MINTING the
--   buyer a fresh card id (see _cmGrantPurchase) — which for a serialized card
--   would duplicate the serial and destroy the only thing being sold. So a
--   serialized copy in transit is held BY THE TABLE: listing it sets owner_id to
--   NULL and stamps escrow_by, buying it takes it out of escrow into the buyer's
--   name, cancelling returns it. Exactly one buyer can win that race because the
--   take is a conditional UPDATE, not a read-then-write.
--
-- ⚠ THE ADMIN CHECK IS AN EMAIL SET, mirroring ADMIN_EMAILS in index.html.
--   Duplicated deliberately: a client-side list is a suggestion, and the mint is
--   the one operation where "who may press this" has to hold against someone
--   calling the RPC straight from a console. If that list changes in index.html
--   it must change here too, and _serial_smoke.mjs asserts the two agree.
--
-- Re-runnable. Ships its own RLS.
-- ============================================================================

create table if not exists public.serialized_runs (
  id              uuid primary key default gen_random_uuid(),
  card_id         text not null unique,
  card_name       text not null default '',
  rarity          text not null default 'common',
  card_json       jsonb not null default '{}'::jsonb,
  total           integer not null check (total > 0 and total <= 1000000),
  admin_reserved  integer not null default 3 check (admin_reserved >= 0),
  price           integer not null default 0 check (price >= 0),
  minted_by       uuid references auth.users(id) on delete set null,
  minted_by_name  text,
  created_at      timestamptz not null default now()
);

create table if not exists public.serial_copies (
  run_id       uuid not null references public.serialized_runs(id) on delete cascade,
  serial       integer not null check (serial >= 1),
  owner_id     uuid references auth.users(id) on delete set null,
  owner_name   text,
  escrow_by    uuid references auth.users(id) on delete set null,
  claimed_at   timestamptz not null default now(),
  primary key (run_id, serial)
);
create index if not exists serial_copies_owner_idx on public.serial_copies(owner_id);
create index if not exists serial_copies_run_idx   on public.serial_copies(run_id, serial);

alter table public.serialized_runs enable row level security;
alter table public.serial_copies  enable row level security;

-- The press run and the register of who holds which number are PUBLIC on
-- purpose: "look up a card by its serial number" is the owner's own request, and
-- a registry nobody can read cannot answer it. Nothing here is private data — a
-- display name and a number — and every WRITE goes through an RPC below.
drop policy if exists sr_sel on public.serialized_runs;
create policy sr_sel on public.serialized_runs for select to authenticated using (true);
drop policy if exists sc_sel on public.serial_copies;
create policy sc_sel on public.serial_copies for select to authenticated using (true);
-- No insert/update/delete policies at all: these tables are written ONLY through
-- the SECURITY DEFINER functions below. A missing policy denies, which is the
-- right default here — an UPDATE policy on serial_copies would let a player put
-- their own name against somebody else's number.

-- ── who may mint ────────────────────────────────────────────────────────────
create or replace function public.serial_is_admin()
returns boolean language sql stable as $fn$
  select coalesce(lower(nullif(auth.jwt() ->> 'email', '')) in (
    'richaegisop@gmail.com',
    'play@mythicsoa.com',
    'dev@mythicspellbook.com'
  ), false);
$fn$;

-- ── mint the run ────────────────────────────────────────────────────────────
-- Creates the run and hands the minter serials 1..admin_reserved in the SAME
-- transaction, so the "admins get 3" half can never be left undone by a client
-- that navigated away between two calls.
create or replace function public.serial_mint_run(
  p_card_id text, p_card_name text, p_rarity text, p_card_json jsonb,
  p_total integer, p_price integer, p_reserved integer default 3,
  p_minter_name text default null
) returns table(ok boolean, status text, run_id uuid, reserved integer[])
language plpgsql security definer set search_path = public as $fn$
declare v_run uuid; v_res integer[] := '{}'; i integer;
begin
  if auth.uid() is null then return query select false, 'not signed in', null::uuid, v_res; return; end if;
  if not public.serial_is_admin() then return query select false, 'admins only', null::uuid, v_res; return; end if;
  if p_card_id is null or length(trim(p_card_id)) = 0 then
    return query select false, 'no card id', null::uuid, v_res; return; end if;
  if coalesce(p_total, 0) <= 0 then
    return query select false, 'run size must be positive', null::uuid, v_res; return; end if;
  if coalesce(p_reserved, 0) > p_total then
    return query select false, 'reserve exceeds the run', null::uuid, v_res; return; end if;

  if exists (select 1 from public.serialized_runs where card_id = p_card_id) then
    -- Not an error the caller should retry past. The whole point of the feature
    -- is that this can only happen once per card.
    return query select false, 'already serialized',
                 (select id from public.serialized_runs where card_id = p_card_id), v_res;
    return;
  end if;

  insert into public.serialized_runs (card_id, card_name, rarity, card_json, total, admin_reserved, price, minted_by, minted_by_name)
  values (p_card_id, coalesce(p_card_name, p_card_id), coalesce(p_rarity, 'common'), coalesce(p_card_json, '{}'::jsonb),
          p_total, coalesce(p_reserved, 3), greatest(0, coalesce(p_price, 0)), auth.uid(), p_minter_name)
  returning id into v_run;

  for i in 1 .. coalesce(p_reserved, 3) loop
    insert into public.serial_copies (run_id, serial, owner_id, owner_name)
    values (v_run, i, auth.uid(), p_minter_name);
    v_res := v_res || i;
  end loop;

  return query select true, 'minted', v_run, v_res;
end $fn$;

-- ── claim the next copy off the press ───────────────────────────────────────
-- ⚠ THE ROW LOCK IS THE WHOLE FUNCTION. Two players buying the last copy at the
--   same instant both read "1 left" without it, and both get it. The lock on the
--   run row serialises them so the second one is told the truth.
create or replace function public.serial_claim(p_run_id uuid)
returns table(ok boolean, status text, serial integer, remaining integer)
language plpgsql security definer set search_path = public as $fn$
declare v_total integer; v_next integer; v_taken integer;
begin
  if auth.uid() is null then return query select false, 'not signed in', 0, 0; return; end if;
  select total into v_total from public.serialized_runs where id = p_run_id for update;
  if v_total is null then return query select false, 'no such run', 0, 0; return; end if;
  select count(*)::int into v_taken from public.serial_copies where run_id = p_run_id;
  if v_taken >= v_total then return query select false, 'sold out', 0, 0; return; end if;
  select coalesce(max(serial), 0) + 1 into v_next from public.serial_copies where run_id = p_run_id;
  insert into public.serial_copies (run_id, serial, owner_id, owner_name)
  values (p_run_id, v_next, auth.uid(),
          (select coalesce(nullif(raw_user_meta_data ->> 'display_name', ''), email) from auth.users where id = auth.uid()));
  return query select true, 'claimed', v_next, (v_total - v_taken - 1);
end $fn$;

-- ── escrow: listing, buying and cancelling a serialized copy ────────────────
create or replace function public.serial_escrow(p_run_id uuid, p_serial integer)
returns table(ok boolean, status text)
language plpgsql security definer set search_path = public as $fn$
declare n integer;
begin
  if auth.uid() is null then return query select false, 'not signed in'; return; end if;
  update public.serial_copies set owner_id = null, escrow_by = auth.uid()
   where run_id = p_run_id and serial = p_serial and owner_id = auth.uid();
  get diagnostics n = row_count;
  return query select n > 0, case when n > 0 then 'escrowed' else 'not yours' end;
end $fn$;

create or replace function public.serial_unescrow(p_run_id uuid, p_serial integer)
returns table(ok boolean, status text)
language plpgsql security definer set search_path = public as $fn$
declare n integer;
begin
  if auth.uid() is null then return query select false, 'not signed in'; return; end if;
  update public.serial_copies
     set owner_id = auth.uid(), escrow_by = null,
         owner_name = (select coalesce(nullif(raw_user_meta_data ->> 'display_name', ''), email) from auth.users where id = auth.uid())
   where run_id = p_run_id and serial = p_serial and owner_id is null and escrow_by = auth.uid();
  get diagnostics n = row_count;
  return query select n > 0, case when n > 0 then 'returned' else 'not in your escrow' end;
end $fn$;

-- ⚠ THE CONDITIONAL UPDATE IS THE RACE FIX. `owner_id is null and escrow_by is
--   not null` can only be true once; the second buyer updates zero rows and is
--   told so, rather than both being handed the same number.
create or replace function public.serial_take(p_run_id uuid, p_serial integer)
returns table(ok boolean, status text)
language plpgsql security definer set search_path = public as $fn$
declare n integer;
begin
  if auth.uid() is null then return query select false, 'not signed in'; return; end if;
  update public.serial_copies
     set owner_id = auth.uid(), escrow_by = null, claimed_at = now(),
         owner_name = (select coalesce(nullif(raw_user_meta_data ->> 'display_name', ''), email) from auth.users where id = auth.uid())
   where run_id = p_run_id and serial = p_serial and owner_id is null and escrow_by is not null;
  get diagnostics n = row_count;
  return query select n > 0, case when n > 0 then 'taken' else 'no longer available' end;
end $fn$;

-- ── reads ───────────────────────────────────────────────────────────────────
create or replace function public.serial_runs_open()
returns table(id uuid, card_id text, card_name text, rarity text, card_json jsonb,
              total integer, price integer, claimed integer)
language sql stable security definer set search_path = public as $fn$
  select r.id, r.card_id, r.card_name, r.rarity, r.card_json, r.total, r.price,
         (select count(*)::int from public.serial_copies c where c.run_id = r.id)
    from public.serialized_runs r
   order by r.created_at desc;
$fn$;

create or replace function public.serial_mine()
returns table(card_id text, card_name text, serial integer, total integer, run_id uuid)
language sql stable security definer set search_path = public as $fn$
  select r.card_id, r.card_name, c.serial, r.total, r.id
    from public.serial_copies c join public.serialized_runs r on r.id = c.run_id
   where c.owner_id = auth.uid()
   order by r.card_name, c.serial;
$fn$;

-- The lookup the owner asked for: a serial number, and who holds it.
create or replace function public.serial_lookup(p_serial integer, p_card_id text default null)
returns table(card_id text, card_name text, rarity text, serial integer, total integer,
              owner_name text, in_escrow boolean, run_id uuid)
language sql stable security definer set search_path = public as $fn$
  select r.card_id, r.card_name, r.rarity, c.serial, r.total,
         case when c.owner_id is null then null else c.owner_name end,
         (c.owner_id is null and c.escrow_by is not null), r.id
    from public.serial_copies c join public.serialized_runs r on r.id = c.run_id
   where c.serial = p_serial
     and (p_card_id is null or r.card_id = p_card_id)
   order by r.card_name
   limit 50;
$fn$;

grant execute on function public.serial_is_admin()   to authenticated;
grant execute on function public.serial_mint_run(text, text, text, jsonb, integer, integer, integer, text) to authenticated;
grant execute on function public.serial_claim(uuid)  to authenticated;
grant execute on function public.serial_escrow(uuid, integer)   to authenticated;
grant execute on function public.serial_unescrow(uuid, integer) to authenticated;
grant execute on function public.serial_take(uuid, integer)     to authenticated;
grant execute on function public.serial_runs_open() to authenticated;
grant execute on function public.serial_mine()      to authenticated;
grant execute on function public.serial_lookup(integer, text) to authenticated;

-- ── verify ──────────────────────────────────────────────────────────────────
select 'serialized_runs' as t, count(*)::text as n from public.serialized_runs
union all select 'serial_copies', count(*)::text from public.serial_copies
union all select 'policies', count(*)::text from pg_policies
       where schemaname = 'public' and tablename in ('serialized_runs', 'serial_copies')
union all select 'functions', count(*)::text from pg_proc
       where proname like 'serial\_%' and pronamespace = 'public'::regnamespace;
