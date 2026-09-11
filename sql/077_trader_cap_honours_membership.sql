-- ════════════════════════════════════════════════════════════════════════════
-- 077 · THE TRADER MEMBERSHIP A PLAYER PAID FOR IS THE CAP THEY GET
--
-- ── THE REPORT ─────────────────────────────────────────────────────────────
--   "I paid for a higher trader membership so should have 80 listing slots,
--    but it is still maxxing out at 15."
--
-- And the Marketplace header agreed with them: it read "ACTIVE LISTINGS 15 / 80
-- · PROFESSIONAL TRADER · REMAINING SLOTS 65". The membership was bought, the
-- row was written, trader_slots() returned 80, and the header rendered 80.
-- Posting the sixteenth listing was still refused.
--
-- ── WHAT IT WAS ────────────────────────────────────────────────────────────
-- Two caps, on two different code paths, and only one of them had been taught
-- about memberships.
--
--   · trader_enforce_listing_cap() — the trigger 053 installed on all three
--     listing tables. Reads trader_slots(). CORRECT, and it is what the header
--     is showing.
--   · rl_post_listing() — the RPC the Player Market actually calls to post a
--     resource listing. PREDATES 053 and carried its own flat number:
--
--         select count(*) into n from public.resource_listings
--          where seller_id = me and status = 'open';
--         if n >= 15 then raise exception 'TOO_MANY_LISTINGS'; end if;
--
-- The RPC refuses before the row is ever inserted, so the trigger that knows
-- about the membership never gets to run. A player could buy the 300-slot
-- Market Tycoon tier and still be stopped at fifteen — paying AZA for capacity
-- the posting path had no idea existed.
--
-- 🔴 THE GENERAL LESSON, WORTH MORE THAN THE FIX: a limit enforced in two
--    places is a limit that will disagree with itself the moment one of them
--    is changed. 053 added the membership at the TRIGGER — the layer no client
--    can bypass, which was the right layer — but did not go looking for the
--    older check sitting in front of it. This file removes the second number
--    rather than updating it: rl_post_listing now ASKS the same two functions
--    the trigger asks, so there is one cap with one definition.
--
-- ── WHY THE COUNT IS ACROSS ALL THREE MARKETS ──────────────────────────────
-- The old check counted resource_listings only. trader_active_listings() counts
-- cards + resources + BOE together, and that total is what the header prints
-- and what the trigger enforces. Counting one table here would have made the
-- RPC disagree with the number on the player's screen in the other direction —
-- a header reading 79/80 while the post still succeeded.
--
-- ⚠ IDEMPOTENT. `create or replace` on one function, nothing dropped, no data
--   touched. Safe to run twice.
-- ⚠ REQUIRES 053 (trader_slots, trader_active_listings). Verified below.
-- ════════════════════════════════════════════════════════════════════════════

-- ── 0. THE PREREQUISITE, CHECKED RATHER THAN ASSUMED ────────────────────────
do $$
begin
  if to_regprocedure('public.trader_slots(uuid)') is null
     or to_regprocedure('public.trader_active_listings(uuid)') is null then
    raise exception '077 needs 053_trader_memberships.sql applied first (trader_slots / trader_active_listings are missing).';
  end if;
end $$;

-- ── 1. THE POSTING PATH, TAUGHT ABOUT MEMBERSHIPS ───────────────────────────
-- Everything except the cap block is byte-for-byte what was already deployed.
create or replace function public.rl_post_listing(
  p_resource text,
  p_lot_size integer,
  p_lots integer,
  p_currency text default 'cinders',
  p_price integer default 0,
  p_want_kind text default null,
  p_want_id text default null,
  p_want_name text default null,
  p_want_res text default null,
  p_want_qty integer default null,
  p_seller_name text default null
)
returns public.resource_listings
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  me      uuid := auth.uid();
  n       integer;
  v_used  integer;
  v_slots integer;
  row     public.resource_listings;
begin
  if me is null then raise exception 'NOT_SIGNED_IN'; end if;
  if p_resource is null or length(p_resource) = 0 then raise exception 'BAD_RESOURCE'; end if;
  if p_lot_size is null or p_lot_size < 1 or p_lot_size > 9999 then raise exception 'BAD_LOT_SIZE'; end if;
  if p_lots is null or p_lots < 1 or p_lots > 999 then raise exception 'BAD_LOT_COUNT'; end if;
  if coalesce(p_currency,'cinders') not in ('cinders','aza','barter','trade') then raise exception 'BAD_CURRENCY'; end if;
  if coalesce(p_price,0) < 0 or coalesce(p_price,0) > 9999999 then raise exception 'BAD_PRICE'; end if;
  if p_currency = 'trade' then
    if p_want_res is null or coalesce(p_want_qty,0) < 1 or p_want_qty > 9999 then raise exception 'BAD_SWAP'; end if;
    if p_want_res = p_resource then raise exception 'SWAP_SAME_RESOURCE'; end if;
  end if;
  if p_currency = 'barter' and p_want_id is null then raise exception 'BAD_BARTER'; end if;

  /* 🔴 THE BUG THIS FILE EXISTS FOR. This was:
         select count(*) into n from public.resource_listings
          where seller_id = me and status = 'open';
         if n >= 15 then raise exception 'TOO_MANY_LISTINGS'; end if;
     — a flat fifteen, written before Trader Memberships existed, sitting in
     front of the trigger that does know about them. Now it asks the same two
     functions the trigger asks, so there is ONE cap with ONE definition and
     the number the header prints is the number that is enforced. */
  v_slots := public.trader_slots(me);
  v_used  := public.trader_active_listings(me);
  if v_used >= v_slots then
    /* The bare code stays the MESSAGE so any client already matching on
       'TOO_MANY_LISTINGS' keeps working; the numbers ride in DETAIL and the
       remedy in HINT, which is the shape the newer clients parse. */
    raise exception using
      errcode = 'P0001',
      message = 'TOO_MANY_LISTINGS',
      detail  = jsonb_build_object('used', v_used, 'slots', v_slots)::text,
      hint    = 'Remove or sell a listing, or upgrade your Trader Membership.';
  end if;

  select count(*) into n from public.resource_listings
   where seller_id = me and created_at > now() - interval '3 seconds';
  if n > 0 then raise exception 'TOO_FAST'; end if;

  insert into public.resource_listings
    (seller_id, seller_name, resource, qty, price, status, currency,
     want_kind, want_id, want_name, want_res, want_qty,
     lot_size, lots_total, lots_left)
  values
    (me, left(coalesce(p_seller_name,'Survivor'),40), p_resource,
     p_lot_size * p_lots, coalesce(p_price,0), 'open', coalesce(p_currency,'cinders'),
     p_want_kind, p_want_id, left(coalesce(p_want_name,''),80), p_want_res, p_want_qty,
     p_lot_size, p_lots, p_lots)
  returning * into row;
  return row;
end
$function$;

-- ── 2. VERIFY ───────────────────────────────────────────────────────────────
-- Every row should read the value in the third column.
select 'no flat cap left in rl_post_listing',
       (not (pg_get_functiondef(p.oid) ~ 'n >= 15'))::text,
       'true expected'
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname = 'rl_post_listing'
union all
select 'rl_post_listing asks trader_slots',
       (pg_get_functiondef(p.oid) ~ 'trader_slots')::text,
       'true expected'
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname = 'rl_post_listing'
union all
select 'rl_post_listing counts all three markets',
       (pg_get_functiondef(p.oid) ~ 'trader_active_listings')::text,
       'true expected'
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname = 'rl_post_listing'
union all
select 'the trigger cap is still installed on all three tables',
       count(*)::text, '3 expected'
  from pg_trigger t join pg_class c on c.oid = t.tgrelid
       join pg_proc pr on pr.oid = t.tgfoid
 where not t.tgisinternal and pr.proname = 'trader_enforce_listing_cap'
union all
-- The tiers a player can actually buy, so a wrong number here is visible too.
select 'professional tier still grants', slots::text, '80 expected'
  from public.trader_membership_tiers where id = 'professional'
union all
select 'top tier still grants', slots::text, '300 expected'
  from public.trader_membership_tiers where id = 'tycoon';
