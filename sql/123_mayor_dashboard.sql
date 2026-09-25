-- ════════════════════════════════════════════════════════════════════════════
-- 123 · THE MAYOR'S DASHBOARD (v121v68)
--
-- Asked for: a phone dashboard showing every city a player is mayor of, the
-- client's gamer name, what each city is paying them, and a profile per city.
--
-- sql/121 made the revenue split actually pay. It did not make it ANSWERABLE:
-- the payout went out through _ct_cinder_give, which writes one wallet_ledger
-- row whose only clue about WHICH city paid is prose inside `reason`. A
-- dashboard built on parsing that sentence would break the first time anybody
-- reworded it, and it could not be indexed.
--
-- So the payout now also writes a purpose-built row, and the dashboard reads
-- that. The wallet ledger keeps its line — it is the player's receipt roll and
-- should still say what happened in words.
--
-- ⚠ THE EARNINGS TABLE IS A RECORD, NOT A BALANCE. Nothing spends from it and
--   nothing reads it to decide a payout. It exists to answer "how much has this
--   city paid me", and if it were dropped tomorrow the money would be exactly
--   where it is. That is deliberate: a reporting table that money depends on is
--   a second source of truth for the wallet.
--
-- Requires sql/121. Idempotent.
-- ════════════════════════════════════════════════════════════════════════════

begin;

create table if not exists public.mayor_earnings (
  id         bigserial primary key,
  node_id    text        not null,
  mayor_id   uuid        not null references auth.users(id) on delete cascade,
  owner_id   uuid,
  amount     bigint      not null,
  pct        numeric,
  created_at timestamptz not null default now()
);

create index if not exists mayor_earnings_mayor_idx on public.mayor_earnings (mayor_id, created_at desc);
create index if not exists mayor_earnings_node_idx  on public.mayor_earnings (mayor_id, node_id);

alter table public.mayor_earnings enable row level security;

-- A mayor reads their own rows and nobody else's. No write policy exists: the
-- only writer is city_owner_ledger_apply, which is SECURITY DEFINER.
drop policy if exists mayor_earnings_self_read on public.mayor_earnings;
create policy mayor_earnings_self_read on public.mayor_earnings
  for select to authenticated using (mayor_id = auth.uid());

revoke insert, update, delete on public.mayor_earnings from authenticated, anon;

-- ── record the split, alongside the wallet credit ───────────────────────────
-- Identical to sql/121 except for the one insert marked below. Re-stated in
-- full rather than patched, because a money function that exists in two halves
-- across two files is a function nobody can read in one sitting.
create or replace function public.city_owner_ledger_apply(
  p_node_id text, p_cinder_delta numeric default 0, p_salvage_delta jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_owner       uuid;
  v_mayor       uuid := auth.uid();
  v_pct         numeric := 0;
  v_delta       numeric;
  v_cut         numeric := 0;
  v_owner_delta numeric;
  v_salvage     jsonb;
  v_cinder      numeric;
  k             text;
  v_have        numeric;
  v_next        numeric;
begin
  if v_mayor is null then raise exception 'not signed in'; end if;

  select t.owner_id, t.player_pct into v_owner, v_pct
    from public._node_mayor_terms(p_node_id) t;
  if v_owner is null then raise exception 'you do not manage this node'; end if;

  v_delta := coalesce(p_cinder_delta, 0);
  if v_delta > 0 and coalesce(v_pct, 0) > 0 then
    v_cut := floor(v_delta * v_pct / 100.0);
  end if;
  v_owner_delta := v_delta - v_cut;

  select coalesce(forge->'__salvage__', '{}'::jsonb), coalesce(gems, 0)
    into v_salvage, v_cinder
    from public.user_profiles where user_id = v_owner for update;

  if v_salvage is null then raise exception 'owner has no profile'; end if;

  v_cinder := v_cinder + v_owner_delta;
  if v_cinder < 0 then
    return jsonb_build_object('ok', false, 'error', 'insufficient_cinder',
                              'cinder', coalesce((select gems from user_profiles where user_id = v_owner), 0));
  end if;

  for k in select jsonb_object_keys(coalesce(p_salvage_delta, '{}'::jsonb))
  loop
    v_have := coalesce((v_salvage->>k)::numeric, 0);
    v_next := v_have + coalesce((p_salvage_delta->>k)::numeric, 0);
    if v_next < 0 then
      return jsonb_build_object('ok', false, 'error', 'insufficient_resource',
                                'resource', k, 'have', v_have);
    end if;
    v_salvage := jsonb_set(v_salvage, array[k], to_jsonb(v_next), true);
  end loop;

  update public.user_profiles
     set forge = jsonb_set(coalesce(forge, '{}'::jsonb), '{__salvage__}', v_salvage, true),
         gems  = v_cinder
   where user_id = v_owner;

  begin
    update public.user_progress set cinder = greatest(0, v_cinder) where user_id = v_owner;
  exception when undefined_table or undefined_column then null;
  end;

  if v_cut > 0 then
    begin
      perform public._ct_cinder_give(v_mayor, v_cut::bigint,
        'Mayor revenue share (' || round(v_pct)::text || '%) — city on node ' || coalesce(p_node_id, '?'));
    exception when undefined_function then null;
    end;
    -- ⬇ THE ONLY NEW LINE. Guarded, because a reporting row must never be the
    --   reason a payout that already happened rolls back.
    begin
      insert into public.mayor_earnings (node_id, mayor_id, owner_id, amount, pct)
      values (p_node_id, v_mayor, v_owner, v_cut::bigint, v_pct);
    exception when others then null;
    end;
  end if;

  return jsonb_build_object(
    'ok', true,
    'cinder', v_cinder,
    'salvage', v_salvage,
    'mayor_pct', v_pct,
    'mayor_cut', v_cut,
    'owner_delta', v_owner_delta);
end $$;

-- ── the dashboard ───────────────────────────────────────────────────────────
-- One row per city the CALLER is mayor of. The owner's display name is
-- resolved here rather than by the client: public_profiles is already public,
-- but joining it in a definer function means the phone never has to ask a
-- second question or hold a list of user ids it has no other use for.
create or replace function public.mayor_dashboard()
returns table (
  node_id         text,
  owner_id        uuid,
  owner_name      text,
  player_pct      numeric,
  currency        text,
  hours_per_month integer,
  card_policy     text,
  resource_policy text,
  started_at      timestamptz,
  earned_total    bigint,
  earned_30d      bigint,
  payouts         bigint,
  last_paid_at    timestamptz
)
language sql stable security definer set search_path = public, pg_temp as $$
  select
    m.node_id,
    m.owner_id,
    coalesce(nullif(pp.display_name, ''), 'Survivor')                 as owner_name,
    least(100, greatest(0, coalesce(m.player_pct, 0)))::numeric       as player_pct,
    coalesce(m.currency, 'cinder')                                    as currency,
    coalesce(m.hours_per_month, 0)                                    as hours_per_month,
    m.card_policy,
    m.resource_policy,
    m.started_at,
    coalesce(e.total, 0)::bigint                                      as earned_total,
    coalesce(e.d30, 0)::bigint                                        as earned_30d,
    coalesce(e.n, 0)::bigint                                          as payouts,
    e.last_at
  from public.node_mayors m
  left join public.public_profiles pp on pp.user_id = m.owner_id
  left join lateral (
    select sum(x.amount)                                              as total,
           sum(x.amount) filter (where x.created_at > now() - interval '30 days') as d30,
           count(*)                                                   as n,
           max(x.created_at)                                          as last_at
      from public.mayor_earnings x
     where x.mayor_id = m.mayor_id
       and x.node_id  = m.node_id
  ) e on true
  where m.mayor_id = auth.uid()
    and coalesce(m.active, true)
  order by coalesce(e.total, 0) desc, m.started_at asc nulls last;
$$;

-- One city's payout history, for its profile page. Bounded — a dashboard does
-- not need every row ever written, and an unbounded read on a busy city is a
-- slow query nobody asked for.
create or replace function public.mayor_city_payouts(p_node_id text, p_limit int default 30)
returns table (amount bigint, pct numeric, created_at timestamptz)
language sql stable security definer set search_path = public, pg_temp as $$
  select x.amount, x.pct, x.created_at
    from public.mayor_earnings x
   where x.mayor_id = auth.uid()
     and x.node_id = p_node_id
   order by x.created_at desc
   limit greatest(1, least(200, coalesce(p_limit, 30)));
$$;

revoke all on function public.mayor_dashboard()                from public, anon;
revoke all on function public.mayor_city_payouts(text, int)    from public, anon;
grant execute on function public.mayor_dashboard()             to authenticated;
grant execute on function public.mayor_city_payouts(text, int) to authenticated;

commit;

-- ── BACKFILL what sql/121 already paid ──────────────────────────────────────
-- Those payouts exist only as wallet_ledger prose. Parse them ONCE so the
-- dashboard does not open reading zero for a mayor who has been paid for days.
-- Runs after the commit above so a parsing failure cannot take the schema with
-- it, and inserts nothing that is already there.
insert into public.mayor_earnings (node_id, mayor_id, owner_id, amount, pct, created_at)
select
  substring(w.reason from 'city on node (.+)$')                       as node_id,
  w.user_id,
  null::uuid,
  w.delta,
  nullif(substring(w.reason from 'share \((\d+)%\)'), '')::numeric,
  w.created_at
from public.wallet_ledger w
where w.reason like 'Mayor revenue share%city on node %'
  and w.delta > 0
  and not exists (
    select 1 from public.mayor_earnings m
     where m.mayor_id = w.user_id
       and m.created_at = w.created_at
       and m.amount = w.delta
  );

-- --- VERIFY. Expect dash_live = t.
select exists (
  select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'mayor_dashboard'
) as dash_live,
(select count(*) from public.mayor_earnings) as rows_recorded;
