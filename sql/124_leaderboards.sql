-- ════════════════════════════════════════════════════════════════════════════
-- 124 · LEADERBOARDS (v121v71)
--
-- Asked for: a phone board for the cities making the most Cinder, producing the
-- most of each resource and holding the most population; and a battle board for
-- the most wins, the most ranked PvP wins, and whose unit has the most kills.
--
-- ── EVERY NUMBER HERE IS DERIVED, NOT SUBMITTED ─────────────────────────────
-- The obvious build is a `leaderboard_scores` table the client writes its own
-- totals into. That is a board a modified client can type its way to the top
-- of, and once one player does it the board is worth nothing to everybody else.
--
-- None of it is necessary: the game already syncs all of this server-side.
--   · city_state.state    — the city save: tiles (with per-tile lifetime earn),
--                           stock (the refined goods), npcPop
--   · user_profiles       — records{wins,battles}, heroes{id:{kills}}, units
--   · matches             — the ranked ladder's own rows, winner_id and all
-- So these read what is already there. There is no write path in this file at
-- all, and adding one later would be the thing that breaks it.
--
-- ⚠ HONEST LIMIT, because it decides how much to trust a row. city_state and
--   user_profiles are written BY the player's own client — they are the game's
--   save, and a determined cheat can edit a save. `matches` cannot be edited
--   that way, which is why RANKED WINS is counted from it rather than from the
--   competitive blob. Where a board is only as good as the save, this file says
--   so and the phone repeats it.
--
-- Read-only. Idempotent. No table is created and nothing is granted INSERT.
-- ════════════════════════════════════════════════════════════════════════════

begin;

-- A jsonb value that ought to be a number, read defensively: the city save is
-- floats written by a browser, and one bad key must not take a board down.
create or replace function public._lb_num(p jsonb)
returns numeric language sql immutable as $$
  select case
    when p is null then 0
    when jsonb_typeof(p) = 'number' then (p #>> '{}')::numeric
    when jsonb_typeof(p) = 'string' and (p #>> '{}') ~ '^-?[0-9]+(\.[0-9]+)?$' then (p #>> '{}')::numeric
    else 0
  end;
$$;

-- ── CITY BOARDS ─────────────────────────────────────────────────────────────
-- p_board: 'cinder' | 'population' | any refined-goods key held in state.stock
--          (rations, ingots, components, reagents, goods, remedies, planks …)
create or replace function public.lb_cities(p_board text default 'cinder', p_limit int default 25)
-- ⚠ NO CITY NAME IS RETURNED, and that is measured, not lazy. city_profiles
--   looks like the place to join for one — but it is keyed on a DIFFERENT id
--   space (uuids and 'local-city') from city_state's TW node ids ('N-04'), and
--   on the live database exactly ZERO of its 57 rows join. A join that always
--   misses would have printed "Unnamed city" down the whole board. The phone
--   already holds the map doc and names nodes from it (MythicMayorDash.nodeName
--   does the same), so the id goes back and the client names it.
returns table (
  rank        int,
  node_id     text,
  owner_id    uuid,
  owner_name  text,
  value       numeric,
  updated_at  timestamptz
)
language sql stable security definer set search_path = public, pg_temp as $$
  with scored as (
    select
      s.node_id,
      s.user_id as owner_id,
      s.updated_at,
      case
        when p_board = 'cinder' then (
          -- lifetime Cinder the city has made, summed off its own tiles
          select coalesce(sum(public._lb_num(t.value -> 'earn')), 0)
            from jsonb_each(case when jsonb_typeof(s.state -> 'tiles') = 'object'
                                 then s.state -> 'tiles' else '{}'::jsonb end) t
        )
        when p_board = 'population' then public._lb_num(s.state -> 'npcPop')
        else public._lb_num(s.state -> 'stock' -> p_board)
      end as value
    from public.city_state s
    where s.state is not null
  )
  select
    row_number() over (order by sc.value desc, sc.updated_at asc)::int as rank,
    sc.node_id,
    sc.owner_id,
    coalesce(nullif(pp.display_name, ''), 'Survivor')  as owner_name,
    round(sc.value)::numeric                            as value,
    sc.updated_at
  from scored sc
  left join public.public_profiles pp on pp.user_id = sc.owner_id
  where sc.value > 0
  order by sc.value desc, sc.updated_at asc
  limit greatest(1, least(100, coalesce(p_limit, 25)));
$$;

-- Which resource boards are worth showing at all — the keys some city actually
-- holds. Saves the phone hard-coding a list that drifts from the city builder.
create or replace function public.lb_city_resources()
returns table (resource text, cities bigint, total numeric)
language sql stable security definer set search_path = public, pg_temp as $$
  select k.key                                   as resource,
         count(*) filter (where public._lb_num(k.value) > 0) as cities,
         round(sum(public._lb_num(k.value)))::numeric        as total
    from public.city_state s
    cross join lateral jsonb_each(
      case when jsonb_typeof(s.state -> 'stock') = 'object' then s.state -> 'stock' else '{}'::jsonb end) k
   where s.state is not null
   group by k.key
  having count(*) filter (where public._lb_num(k.value) > 0) > 0
   order by 3 desc;
$$;

-- ── PLAYER BOARDS ───────────────────────────────────────────────────────────
-- p_board: 'wins'   — total battles won (user_profiles.records.wins)
--          'ranked' — ranked PvP wins, counted from `matches` itself
--          'kills'  — the single unit with the most kills, and which unit
--          'rr'     — ranked rating, for the ladder position
create or replace function public.lb_players(p_board text default 'wins', p_limit int default 25)
returns table (
  rank      int,
  user_id   uuid,
  name      text,
  value     numeric,
  detail    text
)
language sql stable security definer set search_path = public, pg_temp as $$
  with scored as (
    -- ⚔ RANKED WINS COME FROM THE LADDER'S OWN ROWS, not from a blob the
    --   client writes. This is the one board that cannot be edited by a save.
    select m.winner_id as uid,
           count(*)::numeric as value,
           'ranked matches won'::text as detail
      from public.matches m
     where p_board = 'ranked' and m.winner_id is not null
     group by m.winner_id

    union all

    select u.user_id,
           public._lb_num(u.records -> 'wins'),
           (public._lb_num(u.records -> 'battles'))::bigint::text || ' battles'
      from public.user_profiles u
     where p_board = 'wins' and u.records is not null

    union all

    select u.user_id,
           public._lb_num(u.competitive -> 'rr'),
           coalesce(nullif(u.competitive ->> 'rankTierId', ''), 'unranked')
      from public.user_profiles u
     where p_board = 'rr' and u.competitive is not null

    union all

    -- 🗡 THE BEST SINGLE UNIT, not the sum: "who unit has the most kills".
    --    Heroes and units are two maps of the same shape, so both are read.
    --    `detail` comes back as the raw unit id (measured: 'cc_1778462316417',
    --    a custom card) because the card NAMES live in the Forge catalogue on
    --    the client. The phone resolves it and falls back to the id.
    select u.user_id, k.kills, k.who
      from public.user_profiles u
      cross join lateral (
        select public._lb_num(e.value -> 'kills') as kills, e.key as who
          from jsonb_each(
            case when jsonb_typeof(u.heroes) = 'object' then u.heroes else '{}'::jsonb end
            || case when jsonb_typeof(u.units) = 'object' then u.units else '{}'::jsonb end) e
         order by public._lb_num(e.value -> 'kills') desc
         limit 1
      ) k
     where p_board = 'kills'
  )
  select row_number() over (order by sc.value desc, sc.uid asc)::int as rank,
         sc.uid,
         coalesce(nullif(pp.display_name, ''), 'Survivor') as name,
         round(sc.value)::numeric,
         sc.detail
    from scored sc
    left join public.public_profiles pp on pp.user_id = sc.uid
   where sc.value > 0
   order by sc.value desc, sc.uid asc
   limit greatest(1, least(100, coalesce(p_limit, 25)));
$$;

revoke all on function public._lb_num(jsonb)              from public, anon;
revoke all on function public.lb_cities(text, int)        from public, anon;
revoke all on function public.lb_city_resources()         from public, anon;
revoke all on function public.lb_players(text, int)       from public, anon;
grant execute on function public.lb_cities(text, int)     to authenticated;
grant execute on function public.lb_city_resources()      to authenticated;
grant execute on function public.lb_players(text, int)    to authenticated;

commit;

-- --- VERIFY. Expect three functions, and a peek at the top of two boards.
select count(*) as fns from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname in ('lb_cities', 'lb_city_resources', 'lb_players');
select * from public.lb_cities('cinder', 5);
select * from public.lb_players('wins', 5);
select * from public.lb_city_resources();
