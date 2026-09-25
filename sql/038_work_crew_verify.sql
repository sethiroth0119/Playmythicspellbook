-- ###########################################################################
-- MYTHIC SPELLBOOK — 038 · WORK CREW                            (for v120x4)
--
-- 🔴 THIS FILE CHANGES NOTHING. There is no migration for the work crew, and
--    that is the finding, not an omission. Every query below is read-only —
--    no DDL, no DML, no policy, no grant. It is safe to run at any time, on
--    production, as many times as you like.
--
-- WHY THERE IS NO MIGRATION. The feature persists exactly two things, and both
-- ride jsonb columns that already exist (verified live on ktsiasyjusesawtrwrjc):
--
--   Profile.workSalt  →  user_profiles.forge -> '__workSalt__'   (jsonb) ✔
--   game.crew         →  city_state.state    -> 'crew'           (jsonb) ✔
--
-- No new table, no new column, no RLS change. The crew inherits city_state's
-- existing owner-and-mayor policies and the salt inherits user_profiles'.
--
-- SO WHAT IS THIS FOR. CLAUDE.md's own warning: a field that is not carried by
-- the cloud whitelist "resets every session", silently. §3 and §4 below are how
-- you prove, after the deploy, that both fields are actually landing — rather
-- than discovering in a week that every player's crew empties on reload.
--
-- RUN IT: after deploying v120x4, once a few players have opened Node City.
--   Before the deploy, §3 and §4 correctly return zero. That is not a failure.
-- ###########################################################################


-- ── §1 · THE COLUMNS THE FEATURE RIDES ─────────────────────────────────────
-- Both must come back jsonb. If either is missing, the feature has no home and
-- something far more serious than this deploy has gone wrong.
select table_name, column_name, data_type
from information_schema.columns
where table_schema = 'public'
  and (   (table_name = 'user_profiles' and column_name = 'forge')
       or (table_name = 'city_state'    and column_name = 'state'))
order by table_name;


-- ── §2 · THE RLS THE CREW INHERITS ─────────────────────────────────────────
-- Read, do not assume. city_state should restrict to the owner (and the seated
-- mayor, which is deliberate — a mayor governs the city, crew included).
select tablename, policyname, cmd, roles::text, qual
from pg_policies
where schemaname = 'public' and tablename in ('city_state', 'user_profiles')
order by tablename, cmd, policyname;


-- ── §3 · IS THE SALT LANDING? ──────────────────────────────────────────────
-- `with_salt` should climb toward `profiles_total` as players sign in.
-- 🔴 `distinct_salts` MUST EQUAL `with_salt`. The whole design rests on each
--    account rolling its own — a collision means two players see identical work
--    suitabilities on the same cards, and would mean makeSalt() is not random.
-- 🔴 `empty_salts` MUST BE 0. An empty string is a salt that was written before
--    the module loaded; every card would derive from ''.
select
  count(*)                                                            as profiles_total,
  count(*) filter (where forge ? '__workSalt__')                      as with_salt,
  count(distinct forge->>'__workSalt__')
    filter (where forge ? '__workSalt__')                             as distinct_salts,
  count(*) filter (where coalesce(forge->>'__workSalt__', '') = ''
                     and forge ? '__workSalt__')                      as empty_salts
from public.user_profiles;


-- ── §4 · IS THE CREW LANDING, AND IS IT COHERENT? ──────────────────────────
-- One row per city that has a crew.
-- 🔴 `orphan_posts` MUST BE 0. A post is a reference to a tile key inside the
--    same blob; an orphan means a worker is posted to a building that does not
--    exist. The client's validate() clears these on every structural change, so
--    a non-zero here means validate() is not running — the one persistence bug
--    that would actually cost players output silently.
select cs.user_id,
       count(*)                                                        as crew_rows,
       count(*) filter (where m->>'p' is not null)                     as posted,
       count(*) filter (where m->>'p' is null)                         as idle,
       count(*) filter (where m->>'p' is not null
                          and not (cs.state->'tiles' ? (m->>'p')))     as orphan_posts,
       round(avg((m->>'k')::numeric), 1)                               as avg_condition
from public.city_state cs
cross join lateral jsonb_array_elements(cs.state->'crew') m
where jsonb_typeof(cs.state->'crew') = 'array'
group by cs.user_id
order by orphan_posts desc, crew_rows desc;


-- ── §5 · BLOB HEADROOM ─────────────────────────────────────────────────────
-- The crew adds roughly 30 bytes per member — about half a kilobyte at the
-- 20-member cap. Measured before this deploy: avg 17.4 KB, max 54.4 KB across
-- 28 cities. There is no cap problem here; this exists so the next person to
-- add a field to the city blob can see the trend rather than guess at it.
select count(*)                                        as cities,
       round(avg(pg_column_size(state))/1024.0, 1)     as avg_kb,
       round(max(pg_column_size(state))/1024.0, 1)     as max_kb
from public.city_state;


-- ── §6 · VERIFY ────────────────────────────────────────────────────────────
-- One row, one verdict. Read it as: after the deploy and a few sessions,
-- salt_ok and crew_ok should both be true. Before the deploy, both read
-- 'not yet' — which is correct, not a failure.
with p as (
  select count(*) filter (where forge ? '__workSalt__')                as with_salt,
         count(distinct forge->>'__workSalt__')
           filter (where forge ? '__workSalt__')                       as distinct_salts,
         count(*) filter (where coalesce(forge->>'__workSalt__','') = ''
                            and forge ? '__workSalt__')                as empty_salts
  from public.user_profiles
), c as (
  select count(*) filter (where jsonb_typeof(state->'crew') = 'array') as with_crew
  from public.city_state
), o as (
  select count(*) as orphans
  from public.city_state cs
  cross join lateral jsonb_array_elements(cs.state->'crew') m
  where jsonb_typeof(cs.state->'crew') = 'array'
    and m->>'p' is not null
    and not (cs.state->'tiles' ? (m->>'p'))
)
select
  case when p.with_salt = 0 then 'not yet — nobody has opened the city since the deploy'
       when p.empty_salts > 0 then '❌ ' || p.empty_salts || ' EMPTY salts — module loaded late'
       when p.distinct_salts <> p.with_salt then '❌ salt collision — makeSalt is not random'
       else '✅ ' || p.with_salt || ' salts, all distinct, none empty' end as salt_ok,
  case when c.with_crew = 0 then 'not yet — no city has saved a crew'
       when o.orphans > 0 then '❌ ' || o.orphans || ' orphan posts — validate() is not running'
       else '✅ ' || c.with_crew || ' cities carry a crew, no orphan posts' end as crew_ok
from p, c, o;
