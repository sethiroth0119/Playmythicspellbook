-- ════════════════════════════════════════════════════════════════════════════
-- 087 · corp_vault_drop — destroying from the corporation vault, ON THE RECORD.
-- ════════════════════════════════════════════════════════════════════════════
-- WHAT THIS IS FOR
--   The Drop button empties a vault without needing anywhere to put the goods.
--   It is the only way the five corporations sitting over the 10,000-unit cap
--   can get back under it — ANOMALY alone is 1.3 million units over, and until
--   it comes down nobody in it can deposit anything at all.
--
-- 🔴 WHY THIS FILE EXISTS AT ALL, WHEN corp_vault_withdraw ALREADY WORKS.
--    The client can drop today by calling corp_vault_withdraw and simply not
--    crediting the player, and that is exactly what it does until this is
--    applied. The removal is correct and atomic. What is NOT correct is the
--    audit trail: that function writes action = 'withdraw', so in corp_vault_log
--    an officer DESTROYING 100,000 units looks identical to one TAKING them.
--    In a vault owned by many people, "where did it go" is the whole reason the
--    log exists, and the two answers are not interchangeable — one names a
--    member who now holds the goods, the other says nobody does.
--    This function is that function with one word changed, so the log can tell
--    the difference.
--
-- ⚠ IT IS DELIBERATELY NOT MORE PERMISSIVE THAN WITHDRAWING. Same membership
--   check, same locking order, same oldest-first fill. A member who may not take
--   corporation property out must not be able to destroy it instead — that would
--   make the weaker permission the more dangerous one.
--
-- ⚠ THE LOCK COMES BEFORE THE MEASUREMENT, exactly as in 045. Measuring first
--   lets two concurrent calls both pass the "enough available" test and, between
--   them, remove more than the vault holds.
--
-- SAFE TO RE-RUN. Nothing is dropped or migrated; this only creates a function.
-- ════════════════════════════════════════════════════════════════════════════

-- ── 0. THE LOG HAS TO BE ALLOWED TO SAY 'drop' ─────────────────────────────
-- 🔴 WITHOUT THIS THE FUNCTION BELOW CANNOT SUCCEED EVEN ONCE.
--    corp_vault_log.action carries a CHECK listing every legal action, and
--    'drop' was not among them — nothing could drop until now. The INSERT at
--    the end of corp_vault_drop would violate it and raise, and because a
--    plpgsql function is ONE TRANSACTION the removal it had just done would
--    roll back with it. Safe (nothing is lost) but totally broken (the button
--    refuses every time, with an unreadable constraint error).
-- ⚠ WIDENING ONLY — the list is the previous one plus 'drop', so every value
--   already in the table stays legal.
-- (Shipped separately as 087b for anyone who ran 087 before this was folded in.)
alter table public.corp_vault_log
  drop constraint if exists corp_vault_log_action_check;
alter table public.corp_vault_log
  add constraint corp_vault_log_action_check
  check (action = any (array[
    'deposit'::text, 'withdraw'::text, 'drop'::text, 'send'::text, 'claim'::text,
    'cancel'::text, 'trade_offer'::text, 'trade_accept'::text,
    'trade_decline'::text, 'trade_cancel'::text, 'trade_claim'::text
  ]));

-- ── 1. THE FUNCTION ────────────────────────────────────────────────────────
drop function if exists public.corp_vault_drop(uuid, text, text, numeric, text);
drop function if exists public.corp_vault_drop(uuid, text, text, numeric, text, text, text);

create function public.corp_vault_drop(
  p_corp_id    uuid,
  p_kind       text,
  p_item_id    text,
  p_qty        numeric,
  p_actor_name text default null,
  p_name       text default null,
  p_icon       text default null
) returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid   uuid := auth.uid();
  v_want  numeric;
  v_left  numeric;
  v_avail numeric;
  v_name  text;
  v_icon  text;
  r       record;
  v_take  numeric;
begin
  if v_uid is null then raise exception 'not signed in'; end if;
  if p_corp_id is null or coalesce(btrim(p_item_id), '') = '' then
    raise exception 'corporation and item are required';
  end if;
  if p_kind is null or p_kind not in ('card', 'item', 'resource') then
    raise exception 'unknown vault kind: %', coalesce(p_kind, 'null');
  end if;
  v_want := floor(coalesce(p_qty, 0));
  if v_want <= 0 then raise exception 'quantity must be a positive whole number'; end if;
  v_left := v_want;
  if not public.is_corp_member(p_corp_id, v_uid) then
    raise exception 'not a member of that organization';
  end if;

  -- 🔒 LOCK FIRST, MEASURE SECOND.
  perform 1 from corp_vault
   where corp_id = p_corp_id and kind = p_kind and item_id = p_item_id
   for update;

  select coalesce(sum(qty), 0), max(name), max(icon)
    into v_avail, v_name, v_icon
    from corp_vault
   where corp_id = p_corp_id and kind = p_kind and item_id = p_item_id;

  if v_avail < v_want then
    raise exception 'the vault holds only % of %', v_avail, coalesce(v_name, p_item_id);
  end if;

  for r in select id, qty from corp_vault
            where corp_id = p_corp_id and kind = p_kind and item_id = p_item_id and qty > 0
            order by created_at asc, id asc
  loop
    exit when v_left <= 0;
    v_take := least(r.qty, v_left);
    update corp_vault set qty = qty - v_take, updated_at = now() where id = r.id;
    v_left := v_left - v_take;
  end loop;

  delete from corp_vault
   where corp_id = p_corp_id and kind = p_kind and item_id = p_item_id and qty <= 0;

  -- ⭐ THE ONE WORD THIS FILE EXISTS FOR: 'drop', not 'withdraw'.
  insert into corp_vault_log (corp_id, actor_id, actor_name, action, kind, item_id, name, icon, qty)
  values (p_corp_id, v_uid, left(coalesce(p_actor_name, ''), 40), 'drop', p_kind, p_item_id,
          left(coalesce(p_name, v_name, p_item_id), 80),
          left(coalesce(p_icon, v_icon, ''), 12),
          v_want - v_left);

  return v_want - v_left;
end $$;

revoke all on function public.corp_vault_drop(uuid, text, text, numeric, text, text, text) from public, anon;
grant execute on function public.corp_vault_drop(uuid, text, text, numeric, text, text, text) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- VERIFY — run as-is. Expect:
--   drop_fn      = 1   the function is installed
--   anon_holds   = 0   anonymous callers cannot reach it
--   auth_holds   = 1   signed-in players can
--   drop_allowed = true  the log will accept the word 'drop'
-- ════════════════════════════════════════════════════════════════════════════
select
  (select count(*) from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'corp_vault_drop')            as drop_fn,
  (select count(*) from information_schema.routine_privileges
    where routine_schema = 'public' and routine_name = 'corp_vault_drop'
      and grantee in ('anon', 'public'))                                     as anon_holds,
  (select count(*) from information_schema.routine_privileges
    where routine_schema = 'public' and routine_name = 'corp_vault_drop'
      and grantee = 'authenticated')                                         as auth_holds,
  (select pg_get_constraintdef(c.oid) like '%''drop''::text%'
     from pg_constraint c
    where c.conrelid = 'public.corp_vault_log'::regclass
      and c.conname = 'corp_vault_log_action_check')                         as drop_allowed;
