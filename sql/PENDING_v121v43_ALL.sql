-- ============================================================================
-- PENDING_v121v43_ALL.sql — everything not yet applied, in order: 112, 113, 114, 115.
-- Paste the whole file into the Supabase SQL editor (ktsiasyjusesawtrwrjc).
-- Idempotent; safe to re-run. The clawback flag (end of 113) stays OFF here —
-- run   update public.market_flags set clawback_live = true;   a day later.
-- ============================================================================

-- ────────── 112_world_assets ──────────
begin;

create table if not exists public.world_assets (
  id          text primary key,
  owner_id    uuid not null references auth.users(id) on delete cascade,
  owner_name  text,
  kind        text not null,                      -- model | anim | audio | vfx
  name        text not null,
  url         text not null,
  path        text not null,                      -- object path inside the models bucket
  bytes       integer not null default 0,
  meta        jsonb not null default '{}'::jsonb, -- clips, duration, preset kind …
  created_at  timestamptz not null default now(),
  constraint world_assets_id_chk   check (id ~ '^[A-Za-z0-9_-]{4,64}$'),
  constraint world_assets_kind_chk check (kind in ('model', 'anim', 'audio', 'vfx')),
  constraint world_assets_name_chk check (char_length(name) between 1 and 120),
  constraint world_assets_url_chk  check (char_length(url) between 8 and 1000)
);

create index if not exists world_assets_owner_idx on public.world_assets (owner_id, created_at desc);
create index if not exists world_assets_kind_idx  on public.world_assets (kind, created_at desc);

alter table public.world_assets enable row level security;

drop policy if exists world_assets_select on public.world_assets;
create policy world_assets_select on public.world_assets for select
  to authenticated using (true);

drop policy if exists world_assets_insert on public.world_assets;
create policy world_assets_insert on public.world_assets for insert
  to authenticated with check (owner_id = auth.uid());

drop policy if exists world_assets_update on public.world_assets;
create policy world_assets_update on public.world_assets for update
  to authenticated
  using (owner_id = auth.uid() or coalesce(auth.jwt() -> 'app_metadata' ->> 'role', auth.jwt() ->> 'role') = 'admin')
  with check (owner_id = auth.uid() or coalesce(auth.jwt() -> 'app_metadata' ->> 'role', auth.jwt() ->> 'role') = 'admin');

drop policy if exists world_assets_delete on public.world_assets;
create policy world_assets_delete on public.world_assets for delete
  to authenticated
  using (owner_id = auth.uid() or coalesce(auth.jwt() -> 'app_metadata' ->> 'role', auth.jwt() ->> 'role') = 'admin');

-- The bucket the bytes go to. Public read, owner-folder write (see the
-- shop_objects migration for the policies); re-asserted here so a fresh
-- project gets it.
insert into storage.buckets (id, name, public)
values ('models', 'models', true)
on conflict (id) do nothing;

commit;

-- ────────── 113_market_trigger_noop_repair ──────────
begin;

-- §1 ─────────────────────────────────────────────────────────────────────────
create or replace function public.reslisting_archive()
returns trigger language plpgsql security definer set search_path = public as $fn$
begin
  insert into public.resource_listings_history (row_id, payload, reason, actor_id)
  values ((to_jsonb(OLD) ->> 'id')::uuid, to_jsonb(OLD), lower(TG_OP), auth.uid());
  -- 🔴 A BEFORE UPDATE trigger writes whatever it returns. Returning OLD here
  --    made every update to this table a no-op (sql/113 header).
  if TG_OP = 'DELETE' then return OLD; end if;
  return NEW;
end $fn$;

-- §2 ─────────────────────────────────────────────────────────────────────────
alter table public.resource_trade_ledger add column if not exists voided_at timestamptz;
alter table public.resource_trade_ledger add column if not exists void_reason text;
alter table public.resource_trade_ledger drop constraint if exists resource_trade_ledger_kind_check;
alter table public.resource_trade_ledger add constraint resource_trade_ledger_kind_check
  check (kind in ('sale', 'cancel', 'expire', 'clawback'));

/* clawback rows: want_id names the party that settles it ('seller' | 'buyer'),
   want_kind names what comes back: 'res' = `units` of `resource` are taken
   (a buyer is also handed `want_units` of `currency` back), 'cash' =
   `want_units` of `currency` is taken (a seller paid for lots that were never
   escrowed). price_total is ALWAYS 0 on a clawback row: a client older than
   v121v38 reads price_total as money to hand out, and 0 makes such a client
   do nothing.
   ⚠ THE GATE. Clawbacks are only served once market_flags.clawback_live is
   true. Switch it on AFTER v121v38 has reached players (a day after deploy is
   plenty — the service worker refreshes on the next load):
     update public.market_flags set clawback_live = true; */
create table if not exists public.market_flags (id boolean primary key default true check (id), clawback_live boolean not null default false);
insert into public.market_flags (id, clawback_live) values (true, false) on conflict (id) do nothing;
revoke all on public.market_flags from anon, authenticated;

create or replace function public.rl_claimable()
returns table (
  ledger_id bigint, party text, kind text, resource text,
  lot_size integer, lots integer, units integer, currency text,
  price_per_lot integer, price_total integer,
  want_kind text, want_id text, want_name text, want_res text, want_units integer,
  counterparty text, created_at timestamptz
)
language sql security definer set search_path = public, pg_temp as $$
  select e.id, 'seller'::text, e.kind, e.resource,
         e.lot_size, e.lots, e.units, e.currency,
         e.price_per_lot, e.price_total,
         e.want_kind, e.want_id, e.want_name, e.want_res, e.want_units,
         e.buyer_name, e.created_at
    from public.resource_trade_ledger e
   where e.seller_id = auth.uid()
     and e.voided_at is null
     and (e.kind <> 'clawback' or (e.want_id = 'seller' and (select clawback_live from public.market_flags)))
     and not exists (select 1 from public.resource_trade_claims c
                      where c.ledger_id = e.id and c.party = 'seller')
  union all
  select e.id, 'buyer'::text, e.kind, e.resource,
         e.lot_size, e.lots, e.units, e.currency,
         e.price_per_lot, e.price_total,
         e.want_kind, e.want_id, e.want_name, e.want_res, e.want_units,
         e.seller_name, e.created_at
    from public.resource_trade_ledger e
   where e.buyer_id = auth.uid()
     and e.voided_at is null
     and (e.kind = 'sale' or (e.kind = 'clawback' and e.want_id = 'buyer' and (select clawback_live from public.market_flags)))
     and not exists (select 1 from public.resource_trade_claims c
                      where c.ledger_id = e.id and c.party = 'buyer')
   order by 17 asc
$$;

create or replace function public.rl_claim(p_ids bigint[])
returns setof bigint
language plpgsql security definer set search_path = public, pg_temp as $$
declare me uuid := auth.uid();
begin
  if me is null then raise exception 'NOT_SIGNED_IN'; end if;
  if p_ids is null or array_length(p_ids,1) is null then return; end if;
  return query
    insert into public.resource_trade_claims (ledger_id, party, claimed_by)
    select e.id,
           case when e.seller_id = me and (e.kind <> 'clawback' or e.want_id = 'seller') then 'seller' else 'buyer' end,
           me
      from public.resource_trade_ledger e
     where e.id = any(p_ids)
       and e.voided_at is null
       and (e.kind <> 'clawback' or (select clawback_live from public.market_flags))
       and ((e.seller_id = me and (e.kind <> 'clawback' or e.want_id = 'seller'))
         or (e.buyer_id = me and (e.kind = 'sale' or (e.kind = 'clawback' and e.want_id = 'buyer'))))
    on conflict (ledger_id, party) do nothing
    returning ledger_id;
end $$;

-- §3 ─────────────────────────────────────────────────────────────────────────
-- Per listing, what the ledger says really happened.
create temp table _fix as
select l.id,
       coalesce(l.lot_size, l.qty)                         as lot_size,
       coalesce(l.lots_total, 1)                           as lots_total,
       coalesce((select sum(s.lots) from public.resource_trade_ledger s where s.listing_id = l.id and s.kind = 'sale'), 0) as lots_sold,
       (select min(r.kind) from public.resource_trade_ledger r where r.listing_id = l.id and r.kind in ('expire','cancel')) as refund_kind,
       l.status
  from public.resource_listings l;

-- legit lots left to refund = what was escrowed minus what was sold
alter table _fix add column legit_lots integer;
update _fix set legit_lots = greatest(0, lots_total - lots_sold);

update public.resource_listings l
   set lots_left = f.legit_lots,
       status    = case
                     when f.legit_lots = 0 and f.lots_sold > 0 then 'sold'
                     when f.refund_kind = 'expire' then 'expired'
                     when f.refund_kind = 'cancel' then 'cancelled'
                     else l.status
                   end
  from _fix f
 where f.id = l.id
   and (f.lots_sold > 0 or f.refund_kind is not null)
   and (coalesce(l.lots_left, 1) is distinct from f.legit_lots
        or l.status is distinct from case when f.legit_lots = 0 and f.lots_sold > 0 then 'sold' when f.refund_kind = 'expire' then 'expired' when f.refund_kind = 'cancel' then 'cancelled' else l.status end);

-- §4 ─────────────────────────────────────────────────────────────────────────
-- Refund rows per listing, oldest first, with whether each was collected.
create temp table _ref as
select e.id, e.listing_id, e.seller_id, e.seller_name, e.resource, e.units, e.created_at,
       exists (select 1 from public.resource_trade_claims c where c.ledger_id = e.id and c.party = 'seller') as claimed,
       row_number() over (partition by e.listing_id order by e.created_at, e.id) as rn
  from public.resource_trade_ledger e
 where e.kind in ('expire','cancel') and e.voided_at is null;

-- What each listing may legitimately refund, in units.
create temp table _legit as
select f.id as listing_id, f.legit_lots * f.lot_size as legit_units,
       coalesce((select sum(r.units) from _ref r where r.listing_id = f.id and r.claimed), 0) as claimed_units,
       exists (select 1 from _ref r where r.listing_id = f.id and r.claimed) as any_claimed
  from _fix f;

-- Uncollected duplicates: void every uncollected row when a refund was already
-- collected or nothing is left to refund; otherwise keep only the FIRST
-- uncollected row and trim it to the legitimate amount.
update public.resource_trade_ledger e
   set voided_at = now(), void_reason = 'sql/113 duplicate refund (trigger no-op)'
  from _ref r join _legit g on g.listing_id = r.listing_id
 where e.id = r.id and not r.claimed
   and (g.any_claimed or g.legit_units <= 0
        or r.rn <> (select min(x.rn) from _ref x where x.listing_id = r.listing_id and not x.claimed));

update public.resource_trade_ledger e
   set units = g.legit_units, lots = greatest(1, g.legit_units / greatest(1, e.lot_size))
  from _ref r join _legit g on g.listing_id = r.listing_id
 where e.id = r.id and not r.claimed and e.voided_at is null and e.units > g.legit_units and g.legit_units > 0;

-- §5 ─────────────────────────────────────────────────────────────────────────
-- 5a: sellers who collected more refund than they had escrowed.
create temp table _over as
select r.seller_id, min(r.seller_name) as seller_name, r.resource,
       sum(case when g.claimed_units > g.legit_units then 1 else 0 end) as n,
       (select x.id from public.resource_listings x where x.seller_id = r.seller_id order by x.created_at limit 1) as any_listing,
       sum(g.claimed_units - g.legit_units)::integer as over_units
  from (select distinct listing_id, seller_id, seller_name, resource from _ref where claimed) r
  join _legit g on g.listing_id = r.listing_id
 where g.claimed_units > g.legit_units
 group by r.seller_id, r.resource;

insert into public.resource_trade_ledger
  (listing_id, kind, seller_id, buyer_id, seller_name, resource, lot_size, lots, units, currency, price_per_lot, price_total, want_kind, want_id, want_name)
select o.any_listing, 'clawback', o.seller_id, null, o.seller_name, o.resource, o.over_units, 1, o.over_units, 'cinders', 0, 0,
       'res', 'seller', 'sql/113 duplicate refunds reversed'
  from _over o
 where o.over_units > 0
   and not exists (select 1 from public.resource_trade_ledger x where x.kind = 'clawback' and x.want_id = 'seller' and x.want_kind = 'res' and x.seller_id = o.seller_id and x.resource = o.resource and x.want_name like 'sql/113%');

update public.user_resources u
   set qty = greatest(0, u.qty - o.over_units), updated_at = now()
  from _over o
 where u.user_id = o.seller_id and u.resource_id = o.resource and o.over_units > 0;

-- 5b: lots sold beyond what the listing held. The buyer hands the extra goods
--     back and gets the Cinder back; the seller returns the Cinder for goods
--     that were never escrowed.
create temp table _oversale as
select s.id, s.listing_id, s.buyer_id, s.seller_id, s.seller_name, s.resource, s.lot_size, s.currency, s.price_per_lot,
       least(s.lots, s.cum - s.lots_total) as extra_lots
  from (select e.*, sum(e.lots) over (partition by e.listing_id order by e.created_at, e.id) as cum, f.lots_total
          from public.resource_trade_ledger e join _fix f on f.id = e.listing_id where e.kind = 'sale') s
 where s.cum > s.lots_total;

insert into public.resource_trade_ledger
  (listing_id, kind, seller_id, buyer_id, seller_name, resource, lot_size, lots, units, currency, price_per_lot, price_total, want_units, want_kind, want_id, want_name)
select o.listing_id, 'clawback', o.seller_id, o.buyer_id, o.seller_name, o.resource, o.lot_size, o.extra_lots, o.lot_size * o.extra_lots, o.currency, o.price_per_lot, 0, o.price_per_lot * o.extra_lots,
       'res', 'buyer', 'sql/113 over-sold lots returned (sale #' || o.id || ')'
  from _oversale o
 where o.extra_lots > 0
   and not exists (select 1 from public.resource_trade_ledger x where x.kind = 'clawback' and x.want_name = 'sql/113 over-sold lots returned (sale #' || o.id || ')');

insert into public.resource_trade_ledger
  (listing_id, kind, seller_id, buyer_id, seller_name, resource, lot_size, lots, units, currency, price_per_lot, price_total, want_units, want_kind, want_id, want_name)
select o.listing_id, 'clawback', o.seller_id, null, o.seller_name, o.resource, o.lot_size, sum(o.extra_lots), o.lot_size * sum(o.extra_lots), o.currency, o.price_per_lot, 0, o.price_per_lot * sum(o.extra_lots),
       'cash', 'seller', 'sql/113 paid for lots never escrowed (listing ' || o.listing_id || ')'
  from _oversale o
 where o.extra_lots > 0
 group by o.listing_id, o.seller_id, o.seller_name, o.resource, o.lot_size, o.currency, o.price_per_lot
having not exists (select 1 from public.resource_trade_ledger x where x.kind = 'clawback' and x.want_name = 'sql/113 paid for lots never escrowed (listing ' || o.listing_id || ')');

update public.user_resources u
   set qty = greatest(0, u.qty - o.units), updated_at = now()
  from (select buyer_id, resource, sum(lot_size * extra_lots) as units from _oversale where extra_lots > 0 group by 1, 2) o
 where u.user_id = o.buyer_id and u.resource_id = o.resource;

commit;

-- ────────── 114_warehouse_any_resource ──────────
begin;

create or replace function public._wh_known_resource(p_id text)
returns boolean language sql immutable as $$
  select p_id is not null and p_id ~ '^[A-Za-z][A-Za-z0-9_-]{0,63}$';
$$;

create or replace function public._wh_sane_payload(p_payload jsonb)
returns jsonb language sql stable as $$
  select coalesce(jsonb_object_agg(key, qty), '{}'::jsonb) from (
    select key, least(1000000, floor((value)::numeric))::bigint as qty
    from jsonb_each_text(coalesce(p_payload, '{}'::jsonb))
    where public._wh_known_resource(key)
      and (value ~ '^[0-9]+(\.[0-9]+)?$')
      and floor((value)::numeric) >= 1
  ) t;
$$;

create or replace function public.wh_seed_resources(p_payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid(); v_pay jsonb; k text; v numeric; v_claim numeric;
  v_cap constant bigint := 100000;
  v_inserted int := 0; v_trunc jsonb := '{}'::jsonb; v_flags public.wh_flags;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'reason', 'not_signed_in'); end if;
  select * into v_flags from public.wh_flags where id;
  if v_flags.seed_enabled is not true then
    return jsonb_build_object('ok', false, 'reason', 'seeding_closed');
  end if;
  if v_flags.seed_cutoff_at is not null and now() > v_flags.seed_cutoff_at then
    return jsonb_build_object('ok', false, 'reason', 'seeding_closed', 'cutoff_at', v_flags.seed_cutoff_at);
  end if;
  perform pg_advisory_xact_lock(hashtext('wh_seed:' || v_uid::text));
  v_pay := public._wh_sane_payload(p_payload);
  -- the weighted eleven always get a row (zeros included, as before) PLUS every
  -- resource the client declared
  for k in select jsonb_object_keys(public.wh_config() -> 'weights')
           union select jsonb_object_keys(v_pay) loop
    v_claim := coalesce((v_pay ->> k)::numeric, 0);
    v := least(v_cap, v_claim);
    if v_claim > v_cap then
      v_trunc := v_trunc || jsonb_build_object(k, jsonb_build_object('claimed', floor(v_claim), 'granted', v_cap, 'lost', floor(v_claim) - v_cap));
    end if;
    insert into public.user_resources (user_id, resource_id, qty)
      values (v_uid, k, floor(v)::bigint)
      on conflict (user_id, resource_id) do nothing;
    if found then v_inserted := v_inserted + 1; end if;
  end loop;
  if v_inserted = 0 then
    return jsonb_build_object('ok', false, 'reason', 'already_seeded',
      'rows', (select count(*) from public.user_resources where user_id = v_uid));
  end if;
  begin
    insert into public.wallet_ledger (user_id, op, resource, delta, balance_after, reason, meta)
      values (v_uid, 'seed', 'user_resources', 0, null,
              'Warehouse ledger seeded from the client profile (SELF-DECLARED)',
              jsonb_build_object('claimed', v_pay, 'cap_per_resource', v_cap, 'truncated', v_trunc, 'rows_created', v_inserted));
  exception when others then null;
  end;
  return jsonb_build_object('ok', true, 'seeded', public.wh_my_resources(), 'cap_per_resource', v_cap, 'truncated', v_trunc);
end; $$;

create or replace function public.wh_resync_resources(p_payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid(); v_pay jsonb; k text; v_claim numeric; v_have bigint; v_new bigint;
  v_cap constant bigint := 100000;
  v_added jsonb := '{}'::jsonb; v_total bigint := 0;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'reason', 'not_signed_in'); end if;
  perform pg_advisory_xact_lock(hashtext('wh_seed:' || v_uid::text));
  v_pay := public._wh_sane_payload(p_payload);
  for k in select jsonb_object_keys(public.wh_config() -> 'weights')
           union select jsonb_object_keys(v_pay) loop
    v_claim := coalesce((v_pay ->> k)::numeric, 0);
    select coalesce(qty, 0)::bigint into v_have from public.user_resources
      where user_id = v_uid and resource_id = k;
    v_have := coalesce(v_have, 0);
    v_new := least(v_cap, greatest(v_have, floor(v_claim)::bigint));
    if v_new > v_have then
      insert into public.user_resources (user_id, resource_id, qty) values (v_uid, k, v_new)
        on conflict (user_id, resource_id) do update set qty = excluded.qty, updated_at = now();
      v_added := v_added || jsonb_build_object(k, v_new - v_have);
      v_total := v_total + (v_new - v_have);
    end if;
  end loop;
  if v_total > 0 then
    insert into public.wallet_ledger (user_id, op, resource, delta, balance_after, reason, meta)
      values (v_uid, 'resync', 'user_resources', v_total, null,
              'Warehouse ledger resynced from the client profile (SELF-DECLARED)',
              jsonb_build_object('added', v_added, 'cap_per_resource', v_cap));
  end if;
  return jsonb_build_object('ok', true, 'added', v_added, 'total_added', v_total,
    'ledger', (select coalesce(jsonb_object_agg(resource_id, qty), '{}'::jsonb)
                 from public.user_resources where user_id = v_uid and qty > 0));
end $$;

commit;

-- ────────── 115_luni_market ──────────
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
