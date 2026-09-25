-- ════════════════════════════════════════════════════════════════════════════
-- 078 · ONE CORPORATION PER PLAYER
--
-- ── THE REPORT ─────────────────────────────────────────────────────────────
--   "We have two businesses with the same name River Meadows Corp [RIVE] …
--    Allow for players to only create one corporation. This was one of the
--    biggest factors of cities being wiped."
--
-- ── WHY IT WIPED CITIES, WHICH IS THE PART WORTH WRITING DOWN ──────────────
-- The two River Meadows corps were founded by the SAME player 75 seconds
-- apart — a double-submit, not an intent. What made that expensive is the
-- shape of the foreign keys:
--
--   · every corp_* table is ON DELETE CASCADE
--   · economy_nodes.corp_id is ON DELETE **SET NULL**
--
-- So when a duplicate is cleaned up — by a player, by an admin, by anything —
-- its economy nodes are not deleted, they are ORPHANED: still there, still
-- active, owned by nobody, invisible to every query that joins through a corp.
-- The duplicate held six ACTIVE nodes, a bank and a dojo. That is what a
-- "wiped city" looks like from the inside.
--
-- The duplicate is now merged (see corp_merge_backup_20260829 for the 80 rows
-- as they stood). This file stops the next one being created.
--
-- ── THE GUARANTEE, AND THE SENTENCE ────────────────────────────────────────
-- Two layers, because they do different jobs:
--
--   1. A UNIQUE INDEX on founder_id. This is the guarantee. It cannot be raced,
--      cannot be bypassed by a client, and holds against a double-submit that
--      fires two inserts before either has committed — which is exactly how the
--      River Meadows pair happened, and which a "select then insert" check in
--      application code would NOT have caught.
--   2. A BEFORE INSERT trigger that raises a coded, readable refusal. The index
--      alone would surface as a raw 23505 constraint violation, which the
--      client can only show as gibberish. The trigger fires first and names the
--      corporation the player already has.
--
-- ⚠ A PLAYER MAY STILL JOIN AS MANY CORPS AS THEY LIKE. This constrains
--   FOUNDING (corporations.founder_id), not membership (corp_members), because
--   the ask is "switch between their corp and corps they joined" — which
--   requires membership to stay many.
-- ⚠ VERIFIED SAFE TO ADD: at the time of writing, no founder_id appears twice.
--   The DO block below re-checks rather than trusting that, and refuses with a
--   list rather than failing halfway through with a constraint error.
-- ⚠ IDEMPOTENT. Safe to run twice.
-- ════════════════════════════════════════════════════════════════════════════

-- ── 0. REFUSE TO RUN IF THERE IS STILL A DUPLICATE ──────────────────────────
-- Adding the index with duplicates present fails with an error that names one
-- pair and hides the rest. This names all of them, before changing anything.
do $$
declare v_dupes text;
begin
  select string_agg(founder_id::text || ' (' || n || ' corps)', ', ')
    into v_dupes
    from (select founder_id, count(*) n from public.corporations
           where founder_id is not null group by founder_id having count(*) > 1) q;
  if v_dupes is not null then
    raise exception
      'Cannot enforce one-corp-per-player yet — merge these founders first: %', v_dupes
      using hint = 'Move economy_nodes, corp_operations, vault and treasury to the surviving corp BEFORE deleting the duplicate; economy_nodes is ON DELETE SET NULL and will orphan otherwise.';
  end if;
end $$;

-- ── 1. THE GUARANTEE ────────────────────────────────────────────────────────
-- Partial, so historic rows with a null founder (imports, seeds) are untouched.
create unique index if not exists corporations_one_per_founder
  on public.corporations (founder_id)
  where founder_id is not null;

-- ── 2. THE SENTENCE ─────────────────────────────────────────────────────────
-- Bare code as MESSAGE, jsonb in DETAIL, the remedy in HINT — the shape the
-- client's error parser already reads.
create or replace function public.corp_one_per_founder()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare v_id uuid; v_name text; v_tag text;
begin
  if NEW.founder_id is null then return NEW; end if;
  select c.id, c.name, c.tag into v_id, v_name, v_tag
    from public.corporations c
   where c.founder_id = NEW.founder_id
   limit 1;
  if v_id is not null then
    raise exception using
      errcode = 'P0001',
      message = 'ONE_CORP_PER_PLAYER',
      detail  = jsonb_build_object('corp_id', v_id, 'name', v_name, 'tag', v_tag)::text,
      hint    = 'You already run a corporation. Leave or transfer it before founding another.';
  end if;
  return NEW;
end $$;

drop trigger if exists trg_corp_one_per_founder on public.corporations;
create trigger trg_corp_one_per_founder
  before insert on public.corporations
  for each row execute function public.corp_one_per_founder();

-- ── 3. VERIFY ───────────────────────────────────────────────────────────────
select 'no founder owns two corps', count(*)::text, '0 expected'
  from (select founder_id from public.corporations
         where founder_id is not null group by founder_id having count(*) > 1) q
union all
select 'unique index present',
       (to_regclass('public.corporations_one_per_founder') is not null)::text, 'true expected'
union all
select 'refusal trigger present', count(*)::text, '1 expected'
  from pg_trigger where tgname = 'trg_corp_one_per_founder' and not tgisinternal
union all
select 'membership is still many-per-player (joining is unaffected)',
       (not exists (select 1 from pg_constraint c
                     where c.conrelid = 'public.corp_members'::regclass
                       and c.contype = 'u'
                       and pg_get_constraintdef(c.oid) = 'UNIQUE (user_id)'))::text,
       'true expected'
union all
select 'River Meadows corps', count(*)::text, '1 expected'
  from public.corporations where name ilike '%River Meadow%';
