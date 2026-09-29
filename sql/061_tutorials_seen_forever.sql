-- ════════════════════════════════════════════════════════════════════════════
-- 061 — TUTORIALS: seen once is seen FOREVER, and a wipe cannot undo it
-- ════════════════════════════════════════════════════════════════════════════
-- Run by hand in the Supabase SQL editor for project ktsiasyjusesawtrwrjc.
-- Idempotent and re-runnable. Ends with a verify block.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- WHAT THIS MAKES TRUE THAT WAS NOT
--   The seen flags live at Profile.tutorialsSeen — inside the profile blob. The
--   blob is cloud-synced and the loader even UNIONS the cloud copy with the
--   local one, so ordinary play was already safe. What was not safe was
--   everything that REPLACES the profile:
--     · a city / account wipe writes a fresh profile and the flags go with it;
--     · a fresh device that loads before the cloud profile arrives sees {};
--     · any restore that picks a profile blob by weight (the same
--       _preferRicherObj pattern that lost the auction vehicles) can pick a
--       blob whose tutorialsSeen is older.
--   In every one of those the player is shown, again, a lesson they have
--   already sat through. This table is outside the profile entirely, so
--   nothing that rewrites a profile can touch it.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- 🔴 THERE IS NO DELETE PATH. NOT A POLICY, NOT AN RPC, NOWHERE.
--   That is the feature, not an omission. "Seen" is a fact about a human being
--   that became true at a point in time and cannot become false — and the
--   moment a clear-flags route exists, some reset flow will call it, which is
--   exactly the bug being fixed. Deliberate re-watching does not need one:
--   _abxReplayLesson() calls AbraxasTutorial.open(), not openOnce(), so the
--   Tutorial button and the Replay control already bypass the flag entirely
--   without changing it. The admin "reset seen flags" control in Forge stays a
--   LOCAL-ONLY convenience for authoring and is documented as such.
--
-- ⚠ ROWS, NOT A JSON MAP. One row per (player, lesson) makes the fact
--   append-only by construction: two devices marking two different lessons can
--   never clobber each other, which a single jsonb column cannot promise
--   without a read-modify-write race. It also makes "how many players finished
--   the mining lesson" a query instead of a JSON scan.
--
-- ⚠ THE LESSON ID IS NOT VALIDATED AGAINST A CATALOGUE. Lessons are authored in
--   Forge and published through the profile catalogue; a foreign key would make
--   this table refuse to record a lesson that had just been renamed, and the
--   failure mode of a stale row is nothing at all. Length-capped instead.
-- ════════════════════════════════════════════════════════════════════════════

create table if not exists public.player_tutorials_seen (
  user_id       uuid        not null references auth.users(id) on delete cascade,
  lesson_id     text        not null check (length(lesson_id) between 1 and 128),
  first_seen_at timestamptz not null default now(),
  primary key (user_id, lesson_id)
);

create index if not exists ptseen_user on public.player_tutorials_seen (user_id);

-- ── RLS ─────────────────────────────────────────────────────────────────────
-- SELECT and INSERT for the owner. No UPDATE (first_seen_at is a fact, not a
-- field) and no DELETE (see the header). Insert is allowed directly as well as
-- through the RPC because there is nothing a client could lie about: the only
-- thing it can assert is "I saw a lesson", and the with-check pins the row to
-- the caller.
alter table public.player_tutorials_seen enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname='public'
                   and tablename='player_tutorials_seen' and policyname='ptseen_sel_own') then
    create policy ptseen_sel_own on public.player_tutorials_seen
      for select to authenticated using (auth.uid() = user_id);
  end if;
  if not exists (select 1 from pg_policies where schemaname='public'
                   and tablename='player_tutorials_seen' and policyname='ptseen_ins_own') then
    create policy ptseen_ins_own on public.player_tutorials_seen
      for insert to authenticated with check (auth.uid() = user_id);
  end if;
end $$;

-- ── Mark one ────────────────────────────────────────────────────────────────
-- ON CONFLICT DO NOTHING, so the FIRST time stays the first time however many
-- times a client re-reports it.
create or replace function public.tut_mark_seen(p_lesson text)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null or p_lesson is null or length(trim(p_lesson)) = 0 then return false; end if;
  insert into public.player_tutorials_seen (user_id, lesson_id)
  values (v_uid, left(trim(p_lesson), 128))
  on conflict (user_id, lesson_id) do nothing;
  return true;
end $$;

-- ── Mark many ───────────────────────────────────────────────────────────────
-- The migration path: a player whose flags are still only in Profile pushes the
-- whole map once, and from then on the table is the truth. Also what an offline
-- session flushes when it reconnects.
create or replace function public.tut_mark_seen_many(p_lessons text[])
returns int language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_n int;
begin
  if v_uid is null or p_lessons is null then return 0; end if;
  with ins as (
    insert into public.player_tutorials_seen (user_id, lesson_id)
    select v_uid, left(trim(l), 128)
      from unnest(p_lessons) as l
     where l is not null and length(trim(l)) between 1 and 128
    on conflict (user_id, lesson_id) do nothing
    returning 1)
  select count(*) into v_n from ins;
  return v_n;
end $$;

-- ── Read them all ───────────────────────────────────────────────────────────
create or replace function public.tut_seen()
returns text[] language sql security definer set search_path = public as $$
  select coalesce(array_agg(lesson_id order by first_seen_at), '{}'::text[])
    from public.player_tutorials_seen where user_id = auth.uid();
$$;

grant execute on function public.tut_mark_seen(text)        to authenticated;
grant execute on function public.tut_mark_seen_many(text[]) to authenticated;
grant execute on function public.tut_seen()                 to authenticated;

-- ── VERIFY ──────────────────────────────────────────────────────────────────
select 'table' as check,
       (select count(*) from information_schema.tables
         where table_schema='public' and table_name='player_tutorials_seen') as found, 1 as expected;

select 'rls enabled' as check, relrowsecurity
  from pg_class where relname = 'player_tutorials_seen';

select 'policies' as check, policyname, cmd
  from pg_policies where schemaname='public' and tablename='player_tutorials_seen'
 order by policyname;

-- 🔴 THIS MUST RETURN ZERO ROWS. A DELETE or UPDATE policy here would give some
--    future reset flow a way to un-see a lesson, which is the bug this file is
--    closing. If it ever returns a row, that is the regression.
select 'NO delete/update policy may exist' as check, policyname, cmd
  from pg_policies where schemaname='public' and tablename='player_tutorials_seen'
   and cmd in ('DELETE','UPDATE','ALL');

select 'functions' as check, proname
  from pg_proc where pronamespace = 'public'::regnamespace
   and proname in ('tut_mark_seen','tut_mark_seen_many','tut_seen') order by proname;
