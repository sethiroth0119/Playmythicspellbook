-- 131_cx_price_history.sql — the Crash/Exchange on REAL shared history.
--
-- Owner (2026-09-10): "update the stock market to make it look and feel like a
-- real stock market where it shows the 1 hour and all-time highs and real
-- data vs all the players."
-- cx_prices already holds ONE shared price per asset that every player's buys
-- and sells move (v121v47). What nobody held was the HISTORY: each client kept
-- its own 80-point local tape and drew a synthetic curve when that was thin,
-- so two players looking at the same asset saw two different charts and no
-- "all-time high" could exist. This file appends every shared price change to
-- a server-side tape and publishes three read-only windows over it:
--   cx_history(asset, seconds)  — the points for a chart range, downsampled
--   cx_stats(asset)             — 1 h / 24 h high & low, all-time high & low
--   cx_stats_all()              — the same per asset, plus a 16-point spark
-- Clients never write the tape; the trigger does, from cx_prices writes that
-- are already policed. Backfilled with today's prices. Idempotent.

create table if not exists public.cx_price_history (
  id        bigserial primary key,
  asset_id  text             not null,
  px        double precision not null check (px > 0),
  vol       integer          not null default 0,
  at        timestamptz      not null default now()
);
create index if not exists cx_price_history_asset_at on public.cx_price_history (asset_id, at desc);

alter table public.cx_price_history enable row level security;
drop policy if exists cxh_sel on public.cx_price_history;
create policy cxh_sel on public.cx_price_history for select to authenticated using (true);
-- no insert/update/delete policy: only the trigger (definer context) writes

create or replace function public._cx_price_history_append()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.current_px is null or new.current_px <= 0 then return new; end if;
  if tg_op = 'UPDATE' and old.current_px is not distinct from new.current_px then return new; end if;
  insert into public.cx_price_history (asset_id, px, vol) values (new.asset_id, new.current_px, coalesce(new.volume24h, 0));
  return new;
end $$;
drop trigger if exists cx_prices_history on public.cx_prices;
create trigger cx_prices_history after insert or update on public.cx_prices
  for each row execute function public._cx_price_history_append();

-- backfill: one point per asset from today's shared price, once
insert into public.cx_price_history (asset_id, px, vol, at)
select p.asset_id, p.current_px, coalesce(p.volume24h, 0), coalesce(p.updated_at, now())
  from public.cx_prices p
 where p.current_px > 0
   and not exists (select 1 from public.cx_price_history h where h.asset_id = p.asset_id);

-- ── the chart points, downsampled to at most ~400 ─────────────────────────
create or replace function public.cx_history(p_asset text, p_seconds integer default 86400)
returns table (px double precision, at timestamptz)
language sql stable security definer set search_path = public as $$
  with w as (
    select h.px, h.at, row_number() over (order by h.at) as rn, count(*) over () as n
      from public.cx_price_history h
     where h.asset_id = p_asset
       and h.at > now() - make_interval(secs => greatest(60, least(315360000, coalesce(p_seconds, 86400))))
  )
  select w.px, w.at from w
   where w.rn % greatest(1, ceil(w.n / 400.0)::int) = 0 or w.rn = w.n
   order by w.at;
$$;

-- ── one asset's highs and lows ────────────────────────────────────────────
create or replace function public.cx_stats(p_asset text)
returns table (h1 double precision, l1 double precision, h24 double precision, l24 double precision,
               ath double precision, atl double precision, ath_at timestamptz, px24ago double precision,
               points bigint, first_at timestamptz)
language sql stable security definer set search_path = public as $$
  select
    (select max(px) from public.cx_price_history where asset_id = p_asset and at > now() - interval '1 hour'),
    (select min(px) from public.cx_price_history where asset_id = p_asset and at > now() - interval '1 hour'),
    (select max(px) from public.cx_price_history where asset_id = p_asset and at > now() - interval '24 hours'),
    (select min(px) from public.cx_price_history where asset_id = p_asset and at > now() - interval '24 hours'),
    (select max(px) from public.cx_price_history where asset_id = p_asset),
    (select min(px) from public.cx_price_history where asset_id = p_asset),
    (select at from public.cx_price_history where asset_id = p_asset order by px desc, at asc limit 1),
    (select px from public.cx_price_history where asset_id = p_asset and at <= now() - interval '24 hours' order by at desc limit 1),
    (select count(*) from public.cx_price_history where asset_id = p_asset),
    (select min(at) from public.cx_price_history where asset_id = p_asset);
$$;

-- ── every asset at once, for the market table ─────────────────────────────
create or replace function public.cx_stats_all()
returns table (asset_id text, h1 double precision, l1 double precision, h24 double precision, l24 double precision,
               ath double precision, atl double precision, px24ago double precision, spark double precision[])
language sql stable security definer set search_path = public as $$
  with a as (select distinct h.asset_id from public.cx_price_history h)
  select a.asset_id,
    (select max(px) from public.cx_price_history h where h.asset_id = a.asset_id and h.at > now() - interval '1 hour'),
    (select min(px) from public.cx_price_history h where h.asset_id = a.asset_id and h.at > now() - interval '1 hour'),
    (select max(px) from public.cx_price_history h where h.asset_id = a.asset_id and h.at > now() - interval '24 hours'),
    (select min(px) from public.cx_price_history h where h.asset_id = a.asset_id and h.at > now() - interval '24 hours'),
    (select max(px) from public.cx_price_history h where h.asset_id = a.asset_id),
    (select min(px) from public.cx_price_history h where h.asset_id = a.asset_id),
    (select px from public.cx_price_history h where h.asset_id = a.asset_id and h.at <= now() - interval '24 hours' order by h.at desc limit 1),
    (select array_agg(px order by at) from (select px, at from public.cx_price_history h where h.asset_id = a.asset_id and h.at > now() - interval '24 hours' order by at desc limit 16) s)
  from a;
$$;

revoke all on function public.cx_history(text, integer) from public, anon;
revoke all on function public.cx_stats(text) from public, anon;
revoke all on function public.cx_stats_all() from public, anon;
grant execute on function public.cx_history(text, integer) to authenticated;
grant execute on function public.cx_stats(text) to authenticated;
grant execute on function public.cx_stats_all() to authenticated;

-- verify
select 'tape' as check, count(*) as rows, count(distinct asset_id) as assets from public.cx_price_history;
select 'trigger' as check, exists (select 1 from pg_trigger where tgname = 'cx_prices_history') as ok;
