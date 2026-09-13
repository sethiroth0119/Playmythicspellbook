-- ============================================================================
-- 100_card_formats_banlist.sql
-- ⚖️ CARD FORMATS + BANLIST. One row per format; the banlist is a JSONB map of
-- card key → allowed copies. Admin writes, everybody reads.
-- Idempotent. Re-runnable. Ships its RLS. Ends with a verify query.
--
-- Apply BY HAND in the Supabase SQL editor for project ktsiasyjusesawtrwrjc.
-- Until applied the game still works: the client's select fails softly and
-- /src/formats reports "no active format", which means legacy behaviour —
-- each card's own `restriction` field decides its copy limit, exactly as
-- before this migration existed. Nothing breaks; nothing is enforced.
--
-- ── WHAT THIS ADDS ──────────────────────────────────────────────────────────
--  card_formats
--    name       text     display name ("Standard", "Legacy", "Season 4")
--    slug       text     url-safe id, UNIQUE
--    active     boolean  THE live format. At most one, enforced by a partial
--                        unique index — see the note below, it matters.
--    best_of    int      match length this format is played at
--    side_max   int      side deck ceiling
--    limits     jsonb    { "<kind>:<id>": 0|1|2 }  — copies allowed across
--                        main + side. ABSENT = unlimited, so only genuine
--                        restrictions are stored and the object stays small.
--    notes      text     admin-facing rationale, shown on the players' banlist
--
-- 🔴 AT MOST ONE ACTIVE FORMAT.
--    Enforced by `card_formats_active_uidx`, a UNIQUE index over a constant
--    on the rows where active is true. Two active formats would mean two
--    answers to "is this deck legal" and the deck builder and the battle
--    would each pick a different one. A CHECK constraint cannot express this
--    (it sees one row); a trigger could, but a unique index is declarative
--    and cannot be raced. `activate_card_format()` below deactivates the
--    others and sets the new one IN ONE STATEMENT for the same reason — two
--    statements leave a window in which zero (or two) formats are active.
--
-- 🔴 RLS — READ EVERY LINE.
--    select : anyone authenticated. Players MUST be able to read the banlist
--             or their client cannot tell them their deck is illegal.
--    write  : public.is_admin() only, on insert AND update AND delete. The
--             banlist is a balance lever; a player who can write it can
--             unban their own deck. There is no owner_id here on purpose —
--             this is global game config, not user data, so there is no
--             `auth.uid() = ...` clause to write and its absence is correct
--             rather than the omission it would be on any user table.
-- ============================================================================

begin;

create table if not exists public.card_formats (
  id          uuid primary key default gen_random_uuid(),
  name        text        not null,
  slug        text        not null,
  active      boolean     not null default false,
  best_of     int         not null default 3,
  side_max    int         not null default 15,
  limits      jsonb       not null default '{}'::jsonb,
  notes       text        not null default '',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  updated_by  uuid        references auth.users(id) on delete set null
);

-- Shape guards. `limits` must be an OBJECT: a jsonb array or scalar would
-- parse on the client into "restricts nothing", silently disabling the
-- banlist rather than failing loudly, which is the worst of both.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'card_formats_slug_chk') then
    alter table public.card_formats add constraint card_formats_slug_chk
      check (slug ~ '^[a-z0-9][a-z0-9-]{0,47}$');
  end if;
  if not exists (select 1 from pg_constraint where conname = 'card_formats_limits_chk') then
    alter table public.card_formats add constraint card_formats_limits_chk
      check (jsonb_typeof(limits) = 'object');
  end if;
  if not exists (select 1 from pg_constraint where conname = 'card_formats_bestof_chk') then
    alter table public.card_formats add constraint card_formats_bestof_chk
      check (best_of between 1 and 9 and best_of % 2 = 1);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'card_formats_sidemax_chk') then
    alter table public.card_formats add constraint card_formats_sidemax_chk
      check (side_max between 0 and 30);
  end if;
end $$;

create unique index if not exists card_formats_slug_uidx   on public.card_formats (slug);
-- 🔴 THE ONE-ACTIVE-FORMAT GUARANTEE. See the header note.
create unique index if not exists card_formats_active_uidx on public.card_formats ((true)) where active;

create or replace function public.card_formats_touch() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end $$;
drop trigger if exists card_formats_touch on public.card_formats;
create trigger card_formats_touch before insert or update on public.card_formats
  for each row execute function public.card_formats_touch();

-- ── RLS ─────────────────────────────────────────────────────────────────────
alter table public.card_formats enable row level security;

drop policy if exists card_formats_sel on public.card_formats;
create policy card_formats_sel on public.card_formats
  for select to authenticated
  using (true);                              -- global game config: everyone reads

drop policy if exists card_formats_ins on public.card_formats;
create policy card_formats_ins on public.card_formats
  for insert to authenticated
  with check (public.is_admin());

drop policy if exists card_formats_upd on public.card_formats;
create policy card_formats_upd on public.card_formats
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());            -- both halves: `using` alone lets an
                                             -- admin-visible row be rewritten into
                                             -- one they could not have inserted

drop policy if exists card_formats_del on public.card_formats;
create policy card_formats_del on public.card_formats
  for delete to authenticated
  using (public.is_admin());

-- ── Activation, atomically ──────────────────────────────────────────────────
-- SECURITY DEFINER so the single UPDATE runs as one statement against the
-- partial unique index without the client having to order two writes. It
-- re-checks is_admin() itself: a SECURITY DEFINER function bypasses RLS, so
-- dropping that check would hand every authenticated player the banlist.
create or replace function public.activate_card_format(p_slug text)
returns public.card_formats
language plpgsql security definer set search_path = public as $$
declare r public.card_formats;
begin
  if not public.is_admin() then
    raise exception 'admin only';
  end if;
  -- One statement. Rows that are not the target go false, the target goes
  -- true; the index never sees two true rows because it is evaluated once at
  -- statement end.
  update public.card_formats
     set active = (slug = p_slug)
   where active or slug = p_slug;
  select * into r from public.card_formats where slug = p_slug;
  if not found then
    raise exception 'no such format: %', p_slug;
  end if;
  return r;
end $$;

revoke all on function public.activate_card_format(text) from public, anon;
grant execute on function public.activate_card_format(text) to authenticated;

commit;

-- ── VERIFY ──────────────────────────────────────────────────────────────────
-- Expect: the table exists, RLS is on, four policies, two indexes.
select
  (select count(*) from pg_policies
     where schemaname = 'public' and tablename = 'card_formats')          as policies_expect_4,
  (select relrowsecurity from pg_class where relname = 'card_formats')    as rls_expect_true,
  (select count(*) from pg_indexes
     where schemaname = 'public' and tablename = 'card_formats'
       and indexname in ('card_formats_slug_uidx','card_formats_active_uidx')) as uidx_expect_2,
  (select count(*) from public.card_formats)                              as formats_now,
  (select count(*) from public.card_formats where active)                 as active_expect_0_or_1;

-- Negative check — run as a NON-admin to prove the write side is closed.
-- Expect: ERROR  new row violates row-level security policy
--   set local role authenticated;
--   set local request.jwt.claims = '{"sub":"<any user_id>","role":"authenticated","email":"nobody@example.com"}';
--   insert into public.card_formats (name, slug) values ('Hax','hax');
