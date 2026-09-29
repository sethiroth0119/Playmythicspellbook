-- ════════════════════════════════════════════════════════════════════════════
-- 170 — THE WAREHOUSE SETTLES FROM THE PLAYER'S SAVED VAULT
--
-- Reported by LIDS, 2026-09-26: "Send to my storage unit" refuses with
-- "the storage network does not have those goods on your account" while the
-- camp screen shows 944 Aluminum.
--
-- 🔴 WHAT IS ACTUALLY WRONG. wh_send_shipment pays for the load with
--    _wh_debit_resources, which debits public.user_resources — the warehouse's
--    own mirror. That mirror is SEEDED ONCE AND NEVER AGAIN:
--    wh_resync_resources fills only MISSING rows and deliberately leaves any
--    row that already exists alone ("a row that already exists is the server's
--    own number"). Everything a player earns after the seed — loot, crafting,
--    the refinery, camp, expeditions — lands in the client profile blob, which
--    the warehouse has never heard of. This is divergence case (a), written
--    down in 20260812000000_warehouse_storage.sql §DIVERGENCE, now arriving.
--
--    LIDS's mirror says aluminum = 2. His vault says 944. The row EXISTS, so
--    resync can never repair it, and the error's own advice — "withdraw and
--    re-send to resync" — cannot work for him either.
--
-- 📊 MEASURED BEFORE WRITING THIS (2026-09-26), against live:
--      players holding resources      41
--      players affected               41   (100%)
--      players who can ship NOTHING   27   (65.9%)
--    Player storage is not degraded, it is non-functional for two thirds of
--    the game and partly broken for the rest.
--
-- ✅ THE FIX. Before verifying a line, top the mirror up to the player's OWN
--    SAVED VAULT (user_profiles.forge.__salvage__), then debit as before.
--
--    ⚠ THIS IS NOT "TRUST THE CLIENT". The vault is read HERE, server side,
--      out of a row the server stores. Nothing in the payload decides it and
--      no parameter carries it. The client cannot name a number; it can only
--      have saved one earlier, through the same profile upload that governs
--      the rest of the game.
--
--    ⚠ IT ONLY EVER RAISES. If the vault is LOWER than the mirror the mirror
--      is left alone. Lowering would "fix" divergence case (b) — spend
--      outside, ship inside — but a player whose profile upload is merely
--      STALE would have goods destroyed by a repair, and silently destroying
--      goods is worse than the drift. Case (b) stays open, bounded by the same
--      client authority the market, the refinery and crafting already run on.
--
--    ⚠ THE TOP-UP RUNS IN ITS OWN PASS, BEFORE THE ALL-OR-NOTHING VERIFY.
--      Every refusal in wh_send_shipment is a plain `return`, NOT an
--      exception, so it does not roll this transaction back (the caller says
--      so at the debit site). A top-up interleaved with verification would
--      therefore persist on a refused shipment. Doing it first makes that
--      harmless anyway — the pass only makes the mirror agree with the vault,
--      which is true whether the shipment goes or not — but the ordering is
--      deliberate, not incidental.
--
--    ⚠ NOT A BACKFILL. Raising every short row once fixes today and breaks
--      again the moment anybody loots anything. This settles at the moment of
--      the send, for the resources being sent, for ever.
--
-- 🧾 user_resources is a BALANCE table (qty bigint, updated in place), not an
--    append-only ledger — that is how the warehouse shipped and this file does
--    not change it. The append-only rule in CLAUDE.md is about corp_treasury
--    and its kin; do not read this as licence to update a balance elsewhere.
--
-- RLS: unchanged. _wh_debit_resources is SECURITY DEFINER and stays revoked
-- from public/anon/authenticated — it is only ever reached through
-- wh_send_shipment, which does its own auth.uid() check. The grant is
-- re-issued below so a re-run cannot leave it exposed.
--
-- Idempotent and re-runnable. Verify block at the end.
-- ════════════════════════════════════════════════════════════════════════════

create or replace function public._wh_debit_resources(p_uid uuid, p_payload jsonb)
returns boolean language plpgsql security definer set search_path = public as $$
declare
  k text; v numeric; v_have bigint;
  v_salvage jsonb;
  v_vault numeric;
begin
  if p_uid is null or coalesce(p_payload, '{}'::jsonb) = '{}'::jsonb then return false; end if;

  -- 1) lock, in a deterministic order
  for k in select key from jsonb_each_text(p_payload) order by key loop
    perform 1 from public.user_resources
      where user_id = p_uid and resource_id = k for update;
  end loop;

  -- 1b) 🩹 SETTLE THE MIRROR FROM THE PLAYER'S OWN SAVED VAULT.
  --     Read once, server side, from the profile row this server stores.
  --     Only raises; never lowers. See the header for why both halves matter.
  select u.forge -> '__salvage__' into v_salvage
    from public.user_profiles u where u.user_id = p_uid;

  if v_salvage is not null and jsonb_typeof(v_salvage) = 'object' then
    for k in select key from jsonb_each_text(p_payload) order by key loop
      if not public._wh_known_resource(k) then continue; end if;
      -- a vault entry that is not a plain number is not evidence of anything
      if jsonb_typeof(v_salvage -> k) is distinct from 'number' then continue; end if;
      v_vault := floor((v_salvage ->> k)::numeric);
      if v_vault is null or v_vault <= 0 then continue; end if;
      select qty into v_have from public.user_resources
        where user_id = p_uid and resource_id = k;
      if coalesce(v_have, 0) >= v_vault then continue; end if;   -- mirror already agrees or leads
      insert into public.user_resources (user_id, resource_id, qty)
        values (p_uid, k, v_vault::bigint)
        on conflict (user_id, resource_id)
        do update set qty = greatest(public.user_resources.qty, v_vault::bigint),
                      updated_at = now();
    end loop;
  end if;

  -- 2) verify EVERY line, applying nothing
  for k, v in select key, (value)::numeric from jsonb_each_text(p_payload) order by key loop
    if not public._wh_known_resource(k) then return false; end if;
    if v is null or v <= 0 or v <> floor(v) then return false; end if;
    select qty into v_have from public.user_resources
      where user_id = p_uid and resource_id = k;
    if coalesce(v_have, 0) < v then return false; end if;
  end loop;

  -- 3) only now, apply
  for k, v in select key, (value)::numeric from jsonb_each_text(p_payload) order by key loop
    update public.user_resources set qty = qty - v::bigint, updated_at = now()
      where user_id = p_uid and resource_id = k;
  end loop;

  return true;
end; $$;

revoke all on function public._wh_debit_resources(uuid, jsonb) from public, anon, authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- VERIFY
-- ════════════════════════════════════════════════════════════════════════════
with fn as (
  select pg_get_functiondef(p.oid) as src
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = '_wh_debit_resources'
),
acl as (
  select count(*) as public_grants
  from information_schema.role_routine_grants
  where specific_schema = 'public' and routine_name = '_wh_debit_resources'
    and grantee in ('PUBLIC', 'anon', 'authenticated')
)
select
  (select position('__salvage__' in src) > 0 from fn)                       as reads_the_saved_vault,
  (select position('greatest(public.user_resources.qty' in src) > 0 from fn) as only_ever_raises,
  (select position('for update' in src) > 0 from fn)                        as still_locks_rows,
  (select public_grants = 0 from acl)                                       as still_not_granted_to_clients;
-- all four must be true.

-- How many players this unblocks, and how much is still stranded. Run before
-- and after: `still_short` should fall to 0 for anything a player tries to
-- ship, and `players_fully_blocked` is the number that could ship NOTHING.
with vault as (
  select u.user_id, u.display_name, k.key as res,
         case when jsonb_typeof(u.forge->'__salvage__'->k.key) = 'number'
              then (u.forge->'__salvage__'->>k.key)::numeric else 0 end as have
  from public.user_profiles u, lateral jsonb_object_keys(u.forge->'__salvage__') k(key)
  where jsonb_typeof(u.forge->'__salvage__') = 'object'
),
j as (
  select v.display_name, v.have, coalesce(ur.qty, 0) as ledger
  from vault v
  left join public.user_resources ur on ur.user_id = v.user_id and ur.resource_id = v.res
  where v.have > 0
),
per as (
  select display_name, count(*) as held, count(*) filter (where ledger < have) as short
  from j group by 1
)
select count(*) as players_with_resources,
       count(*) filter (where short > 0)     as players_affected,
       count(*) filter (where short = held)  as players_fully_blocked
from per;
