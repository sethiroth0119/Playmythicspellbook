-- ============================================================================
-- BULLETPROOF SAVES — server-authoritative wallet + inventory.
--
-- Replaces the debounced "upload the whole profile blob" model that loses data
-- on a refresh-after-spend. Now every Cinder change and every inventory grant
-- is an ATOMIC database transaction confirmed by the server BEFORE the client
-- claims it succeeded. The DB row IS the source of truth — a refresh always
-- restores from it.
--
-- Run this once in the Supabase SQL editor.
-- ============================================================================

-- Canonical per-player progress row. Update only through the RPCs below so
-- every change is transactional + auditable. NOT NULL + check constraints
-- guarantee the row stays sane even under concurrent writes.
create table if not exists public.user_progress (
  user_id         uuid primary key references auth.users(id) on delete cascade,
  cinder          bigint not null default 0 check (cinder >= 0),
  sovereigns      bigint not null default 0 check (sovereigns >= 0),
  item_inventory  jsonb  not null default '{}'::jsonb,
  equipment       jsonb  not null default '{}'::jsonb,
  relic_equipment jsonb  not null default '{}'::jsonb,
  ft_tax_total    bigint not null default 0,
  updated_at      timestamptz not null default now()
);

alter table public.user_progress enable row level security;
drop policy if exists up_sel on public.user_progress;
create policy up_sel on public.user_progress for select to authenticated using (user_id = auth.uid());
drop policy if exists up_ins on public.user_progress;
create policy up_ins on public.user_progress for insert to authenticated with check (user_id = auth.uid());
drop policy if exists up_upd on public.user_progress;
create policy up_upd on public.user_progress for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ----------------------------------------------------------------------------
-- 📜 wallet_ledger — server-side audit trail of EVERY currency + inventory op.
--   Every charge / credit / grant / consume gets one row here BEFORE the user
--   sees confirmation. If a save ever goes sideways, you can replay the
--   ledger to reconstruct exactly what the canonical balance should be.
--   This is the "your work never disappears" guarantee in its strongest form.
-- ----------------------------------------------------------------------------
create table if not exists public.wallet_ledger (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  op            text not null,       -- 'charge' | 'credit' | 'inv_grant' | 'inv_consume' | 'tax'
  resource      text not null,       -- 'cinder' | 'sovereigns' | item_id
  delta         bigint not null,     -- positive for credit/grant, negative for charge/consume
  balance_after bigint,              -- canonical balance after the op (cinder/sovereigns); null for inventory
  reason        text,
  meta          jsonb,
  created_at    timestamptz not null default now()
);
create index if not exists wallet_ledger_user_time on public.wallet_ledger (user_id, created_at desc);
alter table public.wallet_ledger enable row level security;
drop policy if exists wl_sel on public.wallet_ledger;
create policy wl_sel on public.wallet_ledger for select to authenticated using (user_id = auth.uid());
-- Inserts come ONLY from SECURITY DEFINER RPCs below; no direct client writes.
drop policy if exists wl_ins on public.wallet_ledger;
create policy wl_ins on public.wallet_ledger for insert to authenticated with check (false);

-- ----------------------------------------------------------------------------
-- 👤 get_player_profile(p_user_id)
--   Returns the PUBLIC view of any signed-in player's profile. SECURITY
--   DEFINER so it can read across user_profiles regardless of RLS, but ONLY
--   exposes the public-facing fields (display_name, public stats, favorite
--   hero, recent matches). Private state (decks, equipment, gems balance,
--   email, items) is NEVER returned.
--
--   The avatar/banner are JSON paths inside `competitive` so admins don't
--   need a separate cosmetics table — players pick a frame/banner in their
--   own profile screen and it persists alongside their RR/AP.
-- ----------------------------------------------------------------------------
create or replace function public.get_player_profile(p_user_id uuid)
returns table(
  user_id        uuid,
  display_name   text,
  rr             int,
  ap             int,
  tier_name      text,
  win_streak     int,
  wins           int,
  losses         int,
  battles        int,
  faction_id     text,
  avatar         text,            -- emoji or frame id chosen by player
  banner         text,            -- banner color / image key
  account_level  int,
  created_at     timestamptz
)
language sql security definer set search_path = public stable as $$
  select
    user_id,
    coalesce(display_name, 'Anonymous')                       as display_name,
    coalesce((competitive->>'rr')::int, 0)                    as rr,
    coalesce((competitive->>'ap')::int, 0)                    as ap,
    coalesce(competitive->>'tierName', '')                    as tier_name,
    coalesce((competitive->>'winStreak')::int, 0)             as win_streak,
    coalesce((records->>'wins')::int, 0)                      as wins,
    coalesce((records->>'losses')::int, 0)                    as losses,
    coalesce((records->>'battles')::int, 0)                   as battles,
    (competitive->>'factionId')                               as faction_id,
    coalesce(competitive->>'avatar', '🦸')                     as avatar,
    coalesce(competitive->>'banner', 'default')               as banner,
    coalesce((competitive->>'accountLevel')::int, 1)          as account_level,
    coalesce((updated_at)::timestamptz, now())                as created_at
  from public.user_profiles
  where user_id = p_user_id
  limit 1
$$;
grant execute on function public.get_player_profile(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- get_player_recent_matches(p_user_id, p_limit)
--   Returns the player's last N completed matches (player1+player2 mix).
--   Used by the public-profile page to show "recent matches" feed. Hero IDs
--   only, not decks (decks are private deck-tech).
-- ----------------------------------------------------------------------------
create or replace function public.get_player_recent_matches(p_user_id uuid, p_limit int default 10)
returns table(
  id            uuid,
  is_player1    boolean,
  hero_self     text,
  hero_opp      text,
  won           boolean,
  rr_delta      int,
  turns         int,
  created_at    timestamptz
)
language sql security definer set search_path = public stable as $$
  select
    m.id,
    (m.player1_id = p_user_id) as is_player1,
    case when m.player1_id = p_user_id then m.hero1_id else m.hero2_id end as hero_self,
    case when m.player1_id = p_user_id then m.hero2_id else m.hero1_id end as hero_opp,
    (m.winner_id = p_user_id) as won,
    case when m.player1_id = p_user_id then m.rr1_delta else m.rr2_delta end as rr_delta,
    m.turns,
    m.created_at
  from public.matches m
  where (m.player1_id = p_user_id or m.player2_id = p_user_id)
    and m.status = 'complete'
  order by m.created_at desc
  limit greatest(1, least(coalesce(p_limit, 10), 50))
$$;
grant execute on function public.get_player_recent_matches(uuid, int) to authenticated;

-- ----------------------------------------------------------------------------
-- get_h2h_matches(p_other, p_limit)
--   Head-to-head: only matches between the caller (auth.uid()) and the other
--   player. Used by the public-profile "Vs me only" toggle so two players can
--   see their personal rivalry log without seeing each other's full history.
-- ----------------------------------------------------------------------------
create or replace function public.get_h2h_matches(p_other uuid, p_limit int default 20)
returns table(
  id            uuid,
  i_was_player1 boolean,
  hero_me       text,
  hero_opp      text,
  won           boolean,
  rr_delta      int,
  turns         int,
  created_at    timestamptz
)
language sql security definer set search_path = public stable as $$
  with me as (select auth.uid() as uid)
  select
    m.id,
    (m.player1_id = (select uid from me)) as i_was_player1,
    case when m.player1_id = (select uid from me) then m.hero1_id else m.hero2_id end as hero_me,
    case when m.player1_id = (select uid from me) then m.hero2_id else m.hero1_id end as hero_opp,
    (m.winner_id = (select uid from me)) as won,
    case when m.player1_id = (select uid from me) then m.rr1_delta else m.rr2_delta end as rr_delta,
    m.turns,
    m.created_at
  from public.matches m, me
  where m.status = 'complete'
    and ((m.player1_id = me.uid and m.player2_id = p_other)
      or (m.player2_id = me.uid and m.player1_id = p_other))
  order by m.created_at desc
  limit greatest(1, least(coalesce(p_limit, 20), 50))
$$;
grant execute on function public.get_h2h_matches(uuid, int) to authenticated;

-- ----------------------------------------------------------------------------
-- 👀 get_active_matches(p_limit)
--   Returns matches currently in progress (status='pending', winner_id null,
--   recently created). Used by the leaderboard's "Live Now" section to let
--   spectators jump into ongoing games.
-- ----------------------------------------------------------------------------
create or replace function public.get_active_matches(p_limit int default 20)
returns table(
  id          uuid,
  player1_id  uuid,
  player2_id  uuid,
  hero1_id    text,
  hero2_id    text,
  created_at  timestamptz
)
language sql security definer set search_path = public stable as $$
  select id, player1_id, player2_id, hero1_id, hero2_id, created_at
  from public.matches
  where status = 'pending'
    and winner_id is null
    and created_at > now() - interval '30 minutes'
  order by created_at desc
  limit greatest(1, least(coalesce(p_limit, 20), 50))
$$;
grant execute on function public.get_active_matches(int) to authenticated;

-- ----------------------------------------------------------------------------
-- get_my_ledger(p_limit)
--   Returns this player's recent ledger rows, newest first. Used by the
--   Profile → Transactions screen to show a complete audit trail.
-- ----------------------------------------------------------------------------
create or replace function public.get_my_ledger(p_limit int default 100)
returns table(
  id            uuid,
  op            text,
  resource      text,
  delta         bigint,
  balance_after bigint,
  reason        text,
  meta          jsonb,
  created_at    timestamptz
)
language sql security definer set search_path = public stable as $$
  select id, op, resource, delta, balance_after, reason, meta, created_at
  from public.wallet_ledger
  where user_id = auth.uid()
  order by created_at desc
  limit greatest(1, least(coalesce(p_limit, 100), 500))
$$;
grant execute on function public.get_my_ledger(int) to authenticated;

-- ----------------------------------------------------------------------------
-- wallet_charge(amount, reason)
--   Atomically deducts Cinder, logs 2% Foundation Tax, refuses if insufficient.
--   Returns the new balance + the tax that was logged + ok/reason.
--   This is THE bulletproof spend path: either the row is updated and the
--   client gets the new balance back, or nothing changed.
-- ----------------------------------------------------------------------------
create or replace function public.wallet_charge(p_amount bigint, p_reason text default 'Cinder spending')
returns table(new_balance bigint, tax_amount bigint, ok boolean, reason text)
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_bal bigint;
  v_tax bigint;
begin
  if v_uid is null then return query select 0::bigint, 0::bigint, false, 'not_signed_in'::text; return; end if;
  if p_amount is null or p_amount <= 0 then return query select 0::bigint, 0::bigint, false, 'bad_amount'::text; return; end if;
  -- Make sure the row exists (idempotent).
  insert into public.user_progress (user_id) values (v_uid) on conflict do nothing;
  -- Atomic deduct — only succeeds when balance is sufficient.
  update public.user_progress
    set cinder = cinder - p_amount, updated_at = now()
    where user_id = v_uid and cinder >= p_amount
    returning cinder into v_bal;
  if v_bal is null then
    select cinder into v_bal from public.user_progress where user_id = v_uid;
    return query select coalesce(v_bal, 0::bigint), 0::bigint, false, 'insufficient'::text;
    return;
  end if;
  -- 📜 Ledger entry — every successful spend writes one row. Negative delta;
  -- balance_after is the post-charge canonical Cinder.
  insert into public.wallet_ledger (user_id, op, resource, delta, balance_after, reason)
    values (v_uid, 'charge', 'cinder', -p_amount, v_bal, p_reason);
  -- 2% Foundation Tax (rounded down). Logged to reserve_tax_log for the
  -- cross-player aggregate AND tallied locally on the row for fast read.
  v_tax := floor(p_amount * 0.02);
  if v_tax > 0 then
    update public.user_progress set ft_tax_total = ft_tax_total + v_tax where user_id = v_uid;
    insert into public.wallet_ledger (user_id, op, resource, delta, balance_after, reason, meta)
      values (v_uid, 'tax', 'cinder', 0, v_bal, 'Foundation Tax (2%)', jsonb_build_object('tax_amount', v_tax, 'parent_reason', p_reason));
    begin
      insert into public.reserve_tax_log (seller_id, resource, quantity, sale_value, tax_rate, tax_amount, market_type)
        values (v_uid, p_reason, 0, p_amount, 0.02, v_tax, 'spend');
    exception when undefined_table then
      -- reserve_tax_log not installed yet — swallow; the per-row total still
      -- accrued so the player's own tax figure is correct.
      null;
    end;
  end if;
  return query select v_bal, coalesce(v_tax, 0::bigint), true, ''::text;
end$$;
grant execute on function public.wallet_charge(bigint, text) to authenticated;

-- ----------------------------------------------------------------------------
-- wallet_credit(amount, reason)
--   Adds Cinder (rewards, refunds, admin grants). Returns the new balance.
-- ----------------------------------------------------------------------------
create or replace function public.wallet_credit(p_amount bigint, p_reason text default 'reward')
returns bigint language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_bal bigint;
begin
  if v_uid is null or p_amount is null or p_amount <= 0 then return 0; end if;
  insert into public.user_progress (user_id) values (v_uid) on conflict do nothing;
  update public.user_progress
    set cinder = cinder + p_amount, updated_at = now()
    where user_id = v_uid returning cinder into v_bal;
  -- 📜 Ledger — positive delta credit. Same row as every spend so the audit
  -- trail tells the complete story of where Cinder came from + went.
  insert into public.wallet_ledger (user_id, op, resource, delta, balance_after, reason)
    values (v_uid, 'credit', 'cinder', p_amount, coalesce(v_bal, 0::bigint), p_reason);
  return coalesce(v_bal, 0::bigint);
end$$;
grant execute on function public.wallet_credit(bigint, text) to authenticated;

-- ----------------------------------------------------------------------------
-- inv_grant(item_id, qty)
--   Atomically increments item_inventory[item_id]. Returns the new count.
-- ----------------------------------------------------------------------------
create or replace function public.inv_grant(p_item_id text, p_qty int default 1)
returns int language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_cur int;
begin
  if v_uid is null or p_item_id is null or p_qty is null or p_qty <= 0 then return 0; end if;
  insert into public.user_progress (user_id) values (v_uid) on conflict do nothing;
  update public.user_progress
    set item_inventory = jsonb_set(
      item_inventory,
      array[p_item_id],
      to_jsonb(coalesce((item_inventory ->> p_item_id)::int, 0) + p_qty)
    ),
    updated_at = now()
    where user_id = v_uid;
  select (item_inventory ->> p_item_id)::int into v_cur
    from public.user_progress where user_id = v_uid;
  -- 📜 Ledger — item granted. balance_after is the post-grant count for THIS
  -- item; null for cinder/sovereigns balance (we'd need a separate join).
  insert into public.wallet_ledger (user_id, op, resource, delta, balance_after, reason)
    values (v_uid, 'inv_grant', p_item_id, p_qty, coalesce(v_cur, 0)::bigint, 'item grant');
  return coalesce(v_cur, 0);
end$$;
grant execute on function public.inv_grant(text, int) to authenticated;

-- ----------------------------------------------------------------------------
-- inv_consume(item_id, qty)
--   Atomically decrements item_inventory[item_id], refuses if insufficient.
-- ----------------------------------------------------------------------------
create or replace function public.inv_consume(p_item_id text, p_qty int default 1)
returns table(ok boolean, new_qty int) language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_have int; v_new int;
begin
  if v_uid is null or p_item_id is null or p_qty is null or p_qty <= 0 then return query select false, 0; return; end if;
  select coalesce((item_inventory ->> p_item_id)::int, 0) into v_have
    from public.user_progress where user_id = v_uid;
  if v_have < p_qty then return query select false, coalesce(v_have, 0); return; end if;
  v_new := v_have - p_qty;
  update public.user_progress
    set item_inventory = case when v_new <= 0
        then item_inventory - p_item_id
        else jsonb_set(item_inventory, array[p_item_id], to_jsonb(v_new))
        end,
        updated_at = now()
    where user_id = v_uid;
  -- 📜 Ledger — item consumed. Negative delta; balance_after is the remaining
  -- count after this consume.
  insert into public.wallet_ledger (user_id, op, resource, delta, balance_after, reason)
    values (v_uid, 'inv_consume', p_item_id, -p_qty, v_new::bigint, 'item consumed');
  return query select true, v_new;
end$$;
grant execute on function public.inv_consume(text, int) to authenticated;

-- ----------------------------------------------------------------------------
-- Seeds a fresh user_progress row from a starting balance (used the first
-- time a player signs in on this build). Returns the resulting row.
-- ----------------------------------------------------------------------------
create or replace function public.progress_ensure(p_seed_cinder bigint default 0, p_seed_inventory jsonb default '{}'::jsonb)
returns public.user_progress language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_row public.user_progress;
begin
  if v_uid is null then return null; end if;
  insert into public.user_progress (user_id, cinder, item_inventory)
    values (v_uid, greatest(0, coalesce(p_seed_cinder, 0)), coalesce(p_seed_inventory, '{}'::jsonb))
    on conflict (user_id) do nothing;
  select * into v_row from public.user_progress where user_id = v_uid;
  return v_row;
end$$;
grant execute on function public.progress_ensure(bigint, jsonb) to authenticated;

-- ----------------------------------------------------------------------------
-- 🏆 get_leaderboard(limit)
--   Public leaderboard RPC. SECURITY DEFINER so it bypasses the per-row RLS
--   on user_profiles and can read the competitive jsonb across every player.
--   ONLY exposes the leaderboard-relevant fields — no email, no decks, no
--   private state. The display_name is the only PII surfaced and players opt
--   into that by choosing their own.
-- ----------------------------------------------------------------------------
create or replace function public.get_leaderboard(p_limit int default 100)
returns table(
  user_id      uuid,
  display_name text,
  rr           int,
  ap           int,
  win_streak   int,
  faction_id   text,
  wins         int,
  losses       int
)
language sql security definer set search_path = public stable as $$
  select
    user_id,
    coalesce(display_name, 'Anonymous') as display_name,
    coalesce((competitive->>'rr')::int, 0)        as rr,
    coalesce((competitive->>'ap')::int, 0)        as ap,
    coalesce((competitive->>'winStreak')::int, 0) as win_streak,
    (competitive->>'factionId')                   as faction_id,
    coalesce((records->>'wins')::int, 0)          as wins,
    coalesce((records->>'losses')::int, 0)        as losses
  from public.user_profiles
  where (competitive->>'rr') is not null
  order by (competitive->>'rr')::int desc nulls last,
           (competitive->>'ap')::int desc nulls last
  limit greatest(1, least(coalesce(p_limit, 100), 200))
$$;
grant execute on function public.get_leaderboard(int) to authenticated;
