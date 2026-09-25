-- ============================================================================
-- 113_market_trigger_noop_repair.sql
-- The resource market duplicated goods. Root cause, the fix, and the repair.
-- Idempotent. Apply BY HAND in the Supabase SQL editor (project ktsiasyjusesawtrwrjc)
-- AFTER v121v38 is deployed; then flip market_flags.clawback_live a day later.
--
-- ── ROOT CAUSE ──────────────────────────────────────────────────────────────
-- sql/067 hung `reslisting_archive()` on resource_listings as a BEFORE UPDATE
-- trigger and the function ends with `return OLD`. For a BEFORE UPDATE trigger
-- the returned row IS the row that gets written, so every UPDATE on the table
-- silently wrote the OLD values back: no status ever changed, lots_left never
-- moved. Consequences, measured on the live ledger (7 days):
--   · rl_expire_mine set status='expired' — reverted — and wrote an 'expire'
--     refund row. On the NEXT sweep the listing was still open and older than
--     72 h, so it wrote another. 1,197 expire rows, one listing refunded 32×,
--     while the listing stayed on the board ("auto delisting and refunding
--     while it is still listed"). Sellers collected the duplicates until their
--     stash hit its cap ("18 payouts waiting — no room").
--   · rl_take_lots set lots_left/status='sold' — reverted — so a sold listing
--     stayed buyable: a 2-lot medicine listing sold 9 lots.
--   · rl_cancel_listing likewise refunded and left the listing up.
--   · the legacy DELETE path was unaffected (BEFORE DELETE may return OLD).
-- card_market_listings' guard and user_profiles' guard return NEW on update
-- and are NOT affected; only this trigger had the bug.
--
-- ── WHAT THIS FILE DOES ─────────────────────────────────────────────────────
--  §1 fixes the trigger: NEW on UPDATE, OLD on DELETE (archive kept).
--  §2 ledger: adds voided_at / void_reason and a 'clawback' kind; the claim
--     RPCs skip voided rows and route clawbacks to the right party.
--  §3 repairs every listing from the ledger: sold-out ones close, refunded
--     ones leave the board. That is what removes the duplicates from the
--     market.
--  §4 voids the duplicate refund rows nobody has collected yet, and trims the
--     one kept row to what was actually still escrowed.
--  §5 writes CLAWBACK rows for what was already collected in excess: the
--     client settles them like any payout, taking back only what the ledger
--     proves was minted, capped at what the player still holds. The
--     warehouse mirror (user_resources) is lowered by the same amounts.
-- ============================================================================

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

-- ── VERIFY ──────────────────────────────────────────────────────────────────
select 'trigger returns NEW' as check_name, case when pg_get_functiondef('public.reslisting_archive'::regproc) ilike '%return NEW%' then 'ok' else 'MISSING' end as result
union all select 'open listings with a refund row', count(*)::text from public.resource_listings l where l.status = 'open' and exists (select 1 from public.resource_trade_ledger e where e.listing_id = l.id and e.kind in ('expire','cancel'))
union all select 'open listings sold out', count(*)::text from public.resource_listings l where l.status = 'open' and coalesce((select sum(lots) from public.resource_trade_ledger e where e.listing_id = l.id and e.kind = 'sale'), 0) >= coalesce(l.lots_total, 1)
union all select 'voided duplicate refunds', count(*)::text from public.resource_trade_ledger where voided_at is not null
union all select 'clawback rows', count(*)::text || ' (' || coalesce(sum(units), 0) || ' units, ' || coalesce(sum(want_units), 0) || ' currency)' from public.resource_trade_ledger where kind = 'clawback'
union all select 'clawbacks live (switch on after v121v38 is everywhere)', clawback_live::text from public.market_flags;
