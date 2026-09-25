-- ============================================================================
-- 115_luni_market.sql
-- Luni — the player market's storefront. Seller ratings + comments, and a
-- public price-history feed for the item pages. Idempotent.
-- Apply BY HAND in the Supabase SQL editor (project ktsiasyjusesawtrwrjc).
--
-- Asked for: "redesign our Player Market to look and function like eBay —
-- items have their own pages showing who is selling, ratings (players rate
-- players, leave comments), one image, the market price action, auctions
-- that look like eBay's. Call it Luni."
--
-- ── WHAT THIS ADDS ──────────────────────────────────────────────────────────
--  public.luni_reviews   one row per (rater, seller, listing): 1–5 stars and a
--                        comment. A player may only rate a seller they have
--                        actually BOUGHT FROM (a sale row in either market
--                        ledger), and may re-rate the same listing (upsert).
--  luni_rate(...)        the only write path (SECURITY DEFINER, checks the sale)
--  luni_seller_summary   stars average, count, % positive, recent comments
--  luni_price_history    sold prices for a card id or a resource id — public,
--                        read-only, capped — so an item page can chart what
--                        the thing has really been selling for
-- ============================================================================

begin;

create table if not exists public.luni_reviews (
  id          bigserial primary key,
  seller_id   uuid not null references auth.users(id) on delete cascade,
  rater_id    uuid not null references auth.users(id) on delete cascade,
  rater_name  text,
  listing_id  text not null,
  stars       integer not null check (stars between 1 and 5),
  comment     text not null default '' check (char_length(comment) <= 280),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint luni_reviews_once unique (rater_id, seller_id, listing_id),
  constraint luni_reviews_not_self check (seller_id <> rater_id)
);
create index if not exists luni_reviews_seller_idx on public.luni_reviews (seller_id, created_at desc);
alter table public.luni_reviews enable row level security;
drop policy if exists luni_reviews_sel on public.luni_reviews;
create policy luni_reviews_sel on public.luni_reviews for select to authenticated using (true);
revoke insert, update, delete on public.luni_reviews from anon, authenticated;

-- Did `p_rater` ever buy from `p_seller`? Either ledger counts.
create or replace function public._luni_bought_from(p_rater uuid, p_seller uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.resource_trade_ledger e where e.kind = 'sale' and e.buyer_id = p_rater and e.seller_id = p_seller)
      or exists (select 1 from public.card_market_listings c where c.status = 'sold' and c.buyer_id = p_rater and c.seller_id = p_seller);
$$;

create or replace function public.luni_seller_summary(p_seller uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'count',    (select count(*) from public.luni_reviews r where r.seller_id = p_seller),
    'avg',      coalesce((select round(avg(stars)::numeric, 2) from public.luni_reviews r where r.seller_id = p_seller), 0),
    'positive', coalesce((select round(100.0 * count(*) filter (where stars >= 4) / nullif(count(*), 0), 1) from public.luni_reviews r where r.seller_id = p_seller), 0),
    'sold',     (select count(*) from public.resource_trade_ledger e where e.kind = 'sale' and e.seller_id = p_seller)
              + (select count(*) from public.card_market_listings c where c.status = 'sold' and c.seller_id = p_seller),
    'recent',   coalesce((select jsonb_agg(jsonb_build_object('name', r.rater_name, 'stars', r.stars, 'comment', r.comment, 'at', r.updated_at) order by r.updated_at desc)
                          from (select * from public.luni_reviews where seller_id = p_seller order by updated_at desc limit 12) r), '[]'::jsonb)
  );
$$;

create or replace function public.luni_rate(p_seller uuid, p_listing text, p_stars integer, p_comment text default '')
returns jsonb language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); v_name text;
begin
  if me is null then return jsonb_build_object('ok', false, 'reason', 'not_signed_in'); end if;
  if p_seller is null or p_seller = me then return jsonb_build_object('ok', false, 'reason', 'not_self'); end if;
  if p_stars is null or p_stars < 1 or p_stars > 5 then return jsonb_build_object('ok', false, 'reason', 'bad_stars'); end if;
  if not public._luni_bought_from(me, p_seller) then return jsonb_build_object('ok', false, 'reason', 'no_purchase'); end if;
  select display_name into v_name from public.user_profiles where user_id = me;
  insert into public.luni_reviews (seller_id, rater_id, rater_name, listing_id, stars, comment)
  values (p_seller, me, left(coalesce(v_name, 'Survivor'), 40), left(coalesce(p_listing, ''), 64), p_stars,
          left(regexp_replace(coalesce(p_comment, ''), '[\x00-\x1F\x7F]', '', 'g'), 280))
  on conflict (rater_id, seller_id, listing_id) do update
    set stars = excluded.stars, comment = excluded.comment, rater_name = excluded.rater_name, updated_at = now();
  return jsonb_build_object('ok', true, 'summary', public.luni_seller_summary(p_seller));
end $$;

-- Sold prices, per unit, newest first. kind 'card' → card_market_listings
-- (fixed price or the winning bid), kind 'res' → resource_trade_ledger sales
-- (price per lot ÷ lot size). Both ledgers are otherwise owner-only; this
-- is the deliberate public window: price, currency, when — never who.
create or replace function public.luni_price_history(p_kind text, p_ref text, p_days integer default 30)
returns table (price numeric, currency text, qty integer, at timestamptz)
language sql stable security definer set search_path = public as $$
  select * from (
    select case when c.listing_type = 'auction' then coalesce(c.current_bid, 0) else coalesce(c.price, 0) end::numeric as price,
           coalesce(c.currency, 'cinders') as currency, 1 as qty, c.created_at as at
      from public.card_market_listings c
     where p_kind = 'card' and c.status = 'sold' and c.card_id = p_ref
       and c.created_at > now() - make_interval(days => greatest(1, least(365, coalesce(p_days, 30))))
    union all
    select round(coalesce(e.price_per_lot, 0)::numeric / greatest(1, coalesce(e.lot_size, 1)), 2) as price,
           coalesce(e.currency, 'cinders') as currency, coalesce(e.units, 0) as qty, e.created_at as at
      from public.resource_trade_ledger e
     where p_kind = 'res' and e.kind = 'sale' and e.resource = p_ref and coalesce(e.price_total, 0) > 0
       and e.created_at > now() - make_interval(days => greatest(1, least(365, coalesce(p_days, 30))))
  ) t order by at desc limit 200;
$$;

revoke all on function public.luni_rate(uuid, text, integer, text) from public, anon;
revoke all on function public.luni_seller_summary(uuid) from public, anon;
revoke all on function public.luni_price_history(text, text, integer) from public, anon;
revoke all on function public._luni_bought_from(uuid, uuid) from public, anon, authenticated;
grant execute on function public.luni_rate(uuid, text, integer, text) to authenticated;
grant execute on function public.luni_seller_summary(uuid) to authenticated;
grant execute on function public.luni_price_history(text, text, integer) to authenticated;

commit;

-- ── VERIFY ──────────────────────────────────────────────────────────────────
select 'luni_reviews table' as check_name, case when to_regclass('public.luni_reviews') is not null then 'ok' else 'MISSING' end as result
union all select 'rls on', case when (select relrowsecurity from pg_class where oid = 'public.luni_reviews'::regclass) then 'ok' else 'MISSING' end
union all select 'rate rpc', case when to_regprocedure('public.luni_rate(uuid,text,integer,text)') is not null then 'ok' else 'MISSING' end
union all select 'summary rpc', case when to_regprocedure('public.luni_seller_summary(uuid)') is not null then 'ok' else 'MISSING' end
union all select 'price history rpc', case when to_regprocedure('public.luni_price_history(text,text,integer)') is not null then 'ok' else 'MISSING' end;
