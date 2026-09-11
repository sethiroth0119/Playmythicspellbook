-- ════════════════════════════════════════════════════════════════════════════
-- 049 — CORP LOGISTICS VISIBILITY: a guild can see its own members' freight
-- ----------------------------------------------------------------------------
-- "With Logistics give real time data for players who are in the guild and
--  their Logistics when it comes to business deals and if they have shipment
--  going to other cities or going to a warehouse."
--
-- The data already exists. Nothing here creates a table, a column or a number.
-- This file does exactly two things:
--
--   1. Adds a SECOND, permissive SELECT policy to city_trade_agreements and
--      city_trade_shipments so a corp member can read a corp-mate's standing
--      city deals and the cycles that have fired on them.
--   2. Adds wh_corp_shipments(), a read-only sibling of wh_my_shipments() that
--      returns the whole corp's in-flight warehouse loads instead of only the
--      caller's.
--
-- 🔴 THIS DELIBERATELY WIDENS PRIVACY, AND THAT IS THE WHOLE POINT.
--    sql/039 says, in as many words: "A standing deal is commercially private;
--    the marketplace in 038 is the public surface." That judgement was correct
--    for a deal between two strangers and is wrong inside a guild — a guild
--    that cannot see what its own members have on the road cannot plan around
--    it, which is the feature being asked for. The widening is bounded and is
--    the smallest one that delivers it:
--      · corp-mates only, never "any authenticated user";
--      · SELECT only — no insert, update or delete path is added anywhere;
--      · the ORIGINAL owner-scoped policies are left in place untouched, so
--        removing this file's policies restores the old behaviour exactly.
--    Permissive policies OR together, so `cta_sel` (parties) and `cta_sel_corp`
--    (corp-mates) coexist; a player with no corporation sees precisely what
--    they saw before this file was applied.
--
-- 🔴 RLS RECURSION. A policy on city_trade_shipments that SELECTs
--    city_trade_agreements would run the agreements policies inside the
--    shipments policy — nested RLS, not literal recursion, but fragile and
--    order-dependent. Both checks below go through SECURITY DEFINER helpers,
--    which bypass RLS and therefore terminate. Same rule the community tables
--    follow (is_community_member / is_community_leader).
--
-- 🔴 SECURITY DEFINER MEANS THE FUNCTION BODY *IS* THE SECURITY BOUNDARY.
--    wh_corp_shipments() runs as its owner, so RLS on wh_shipments does not
--    protect it. The `exists (... me.user_id = auth.uid())` line inside it is
--    the only thing stopping any signed-in player from reading any corp's
--    freight by guessing a corp id. Read that line before anything else here.
--
-- ⚠ DEPENDENCY-TOLERANT BY DESIGN. 038/039 (city trade) and the warehouse
--   migration (supabase/migrations/20260812000000_warehouse_storage.sql) may
--   not be applied on a given database, and this file must not fail because of
--   that — half a logistics panel is better than a SQL editor error and no
--   panel at all. Every block below is wrapped in a `to_regclass(...) is not
--   null` guard and issued as dynamic SQL, because a plain `create policy` on a
--   missing table is a parse-time failure that no guard can catch.
--
-- Idempotent and re-runnable. Ends with a verify query.
-- Apply BY HAND in the Supabase SQL editor for project ktsiasyjusesawtrwrjc.
-- ════════════════════════════════════════════════════════════════════════════

-- ════════════════════════════════════════════════════════════════════════════
-- 1. WHO IS IN MY CORPORATION — SECURITY DEFINER, so policies cannot recurse.
-- ════════════════════════════════════════════════════════════════════════════
-- corp_members.user_id is the PRIMARY KEY (sql/002), so a player is in at most
-- one corporation and this join can never fan out.
create or replace function public.is_corp_comrade(p_a uuid, p_b uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_a is not null and p_b is not null and exists (
    select 1
    from public.corp_members ma
    join public.corp_members mb on mb.corp_id = ma.corp_id
    where ma.user_id = p_a
      and mb.user_id = p_b
  );
$$;
revoke all on function public.is_corp_comrade(uuid, uuid) from public;
grant execute on function public.is_corp_comrade(uuid, uuid) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- 2. IS THIS AGREEMENT VISIBLE TO MY GUILD — also SECURITY DEFINER.
--    Created only when 039 is present: the body names city_trade_agreements and
--    would fail to compile without it.
-- ════════════════════════════════════════════════════════════════════════════
do $do$
begin
  if to_regclass('public.city_trade_agreements') is null then
    raise notice '049: city_trade_agreements missing (sql/039 not applied) — skipping city-trade visibility.';
  else
    execute $fn$
      create or replace function public.is_corp_trade_visible(p_agreement uuid, p_user uuid)
      returns boolean
      language sql
      stable
      security definer
      set search_path = public
      as $body$
        select exists (
          select 1 from public.city_trade_agreements a
          where a.id = p_agreement
            and (public.is_corp_comrade(p_user, a.proposer_id)
              or public.is_corp_comrade(p_user, a.partner_id))
        );
      $body$;
    $fn$;
    execute 'revoke all on function public.is_corp_trade_visible(uuid, uuid) from public';
    execute 'grant execute on function public.is_corp_trade_visible(uuid, uuid) to authenticated';

    -- ── agreements: corp-mates may READ. Nothing else changes. ──────────────
    execute 'drop policy if exists cta_sel_corp on public.city_trade_agreements';
    execute $pol$
      create policy cta_sel_corp on public.city_trade_agreements
        for select to authenticated
        using (
          public.is_corp_comrade(auth.uid(), proposer_id)
          or public.is_corp_comrade(auth.uid(), partner_id)
        )
    $pol$;

    -- ── shipments: the cycles that actually fired on a visible agreement ────
    -- Guarded by the SECURITY DEFINER helper rather than an inline sub-select,
    -- so this policy does not run the agreements policies inside itself.
    if to_regclass('public.city_trade_shipments') is not null then
      execute 'drop policy if exists cts_sel_corp on public.city_trade_shipments';
      execute $pol2$
        create policy cts_sel_corp on public.city_trade_shipments
          for select to authenticated
          using (public.is_corp_trade_visible(agreement_id, auth.uid()))
      $pol2$;
    end if;
  end if;
end
$do$;

-- ════════════════════════════════════════════════════════════════════════════
-- 3. WAREHOUSE FREIGHT FOR A WHOLE CORP
--    A read-only sibling of wh_my_shipments(). Same field names, same status
--    normalisation, same ordering — the client renders both through one code
--    path and any drift here shows up as a blank column, not a wrong number.
--    Created only when the warehouse migration is present.
-- ════════════════════════════════════════════════════════════════════════════
do $do$
begin
  if to_regclass('public.wh_shipments') is null then
    raise notice '049: wh_shipments missing (warehouse migration not applied) — skipping wh_corp_shipments.';
  else
    execute $fn$
      create or replace function public.wh_corp_shipments(p_corp_id uuid)
      returns jsonb
      language sql
      stable
      security definer
      set search_path = public
      as $body$
        select coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', s.id, 'warehouse_id', s.warehouse_id, 'owner_name', w.owner_name,
            'sender_id', s.sender_id, 'sender_name', s.sender_name,
            'unit_id', s.unit_id, 'bay_no', u.bay_no,
            'origin_kind', s.origin_kind, 'origin_label', s.origin_label,
            'node_level', s.node_level, 'free_city', s.free_city,
            'eta_hours', s.eta_hours, 'eta_at', s.eta_at, 'sent_at', s.sent_at,
            'weight_kg', s.weight_kg, 'payload', s.payload,
            -- Same normalisation wh_my_shipments() applies: a load whose eta has
            -- passed reads 'arrived' even though no writer has touched the row.
            'status', case when s.status = 'transit' and s.eta_at <= now() then 'arrived' else s.status end,
            'crates_total', s.crates_total, 'crates_stored', s.crates_stored
          ) order by s.eta_at)
          from public.wh_shipments s
          join public.wh_warehouses w on w.id = s.warehouse_id
          left join public.wh_units u on u.id = s.unit_id
          join public.corp_members sm on sm.user_id = s.sender_id
          where sm.corp_id = p_corp_id
            and s.status in ('transit', 'arrived')
            -- 🔒 THE SECURITY BOUNDARY. security definer bypasses RLS on
            --    wh_shipments, so without this line any signed-in player could
            --    read any corporation's freight by passing its id.
            and exists (
              select 1 from public.corp_members me
              where me.corp_id = p_corp_id and me.user_id = auth.uid()
            )
        ), '[]'::jsonb);
      $body$;
    $fn$;
    execute 'revoke all on function public.wh_corp_shipments(uuid) from public';
    execute 'grant execute on function public.wh_corp_shipments(uuid) to authenticated';
  end if;
end
$do$;

-- ════════════════════════════════════════════════════════════════════════════
-- 4. THE PROBE
--    The client must be able to tell "this guild has nothing on the road" from
--    "this file is not applied yet", because those two states look identical
--    from a query that returns zero rows and the panel must not claim the first
--    when the truth is the second. A missing function is an unambiguous signal;
--    an empty result set is not.
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.corp_logistics_scope()
returns text
language sql
stable
as $$ select 'corp'::text $$;
revoke all on function public.corp_logistics_scope() from public;
grant execute on function public.corp_logistics_scope() to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- VERIFY
--   corp_comrade_fn      1
--   scope_fn             1
--   trade_visible_fn     1 if sql/039 is applied, else 0
--   corp_trade_policies  2 if sql/039 is applied, else 0  (cta_sel_corp, cts_sel_corp)
--   wh_corp_fn           1 if the warehouse migration is applied, else 0
--   original_policies    2 — cta_sel and cts_sel MUST still be there. If this
--                        reads 0 something dropped the owner-scoped policies and
--                        the corp policy is now the only thing guarding the
--                        table, which is a narrower grant than it looks.
-- ════════════════════════════════════════════════════════════════════════════
select
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'is_corp_comrade')                       as corp_comrade_fn_expect_1,
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'corp_logistics_scope')                  as scope_fn_expect_1,
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'is_corp_trade_visible')                 as trade_visible_fn,
  (select count(*) from pg_policies where schemaname = 'public'
     and policyname in ('cta_sel_corp','cts_sel_corp'))                                  as corp_trade_policies,
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'wh_corp_shipments')                     as wh_corp_fn,
  (select count(*) from pg_policies where schemaname = 'public'
     and policyname in ('cta_sel','cts_sel'))                                            as original_policies;
