-- 082 · A full-vault refusal must actually SAY it failed.
--
-- 🔴 THE BUG, and it destroyed players' resources.
--    The vault_full branch of corp_vault_deposit_v2 ended:
--        return jsonb_build_object('ok', false, 'reason', 'vault_full', …) || v_space;
--    jsonb's || lets the RIGHT operand win on duplicate keys, and v_space
--    carries 'ok': true. So the refusal came back as:
--        { "ok": true, "reason": "vault_full", "available": 0, … }
--
--    index.html checks `rp.data.ok === false` to run its refund path. It never
--    matched, so a refused deposit fell through to the SUCCESS branch: the
--    resources had already been deducted from the player's profile before the
--    call, the server wrote nothing, and nothing put them back. They vanished.
--
--    Latent since the function shipped, because the caps were 500,000–1,500,000
--    and virtually nobody ever filled a vault. sql/081 lowered the cap to
--    10,000 and put five corporations over the line at once, which would have
--    turned a dormant bug into resource loss on the very next deposit.
--
-- THE FIX is the operand order: merge the space report FIRST, then stamp the
-- verdict on top, so 'ok' and 'reason' are the function's own and cannot be
-- overwritten by the report attached to them. Applied to the success path too,
-- for the same reason.
--
-- Verified in a rolled-back transaction against live rows:
--   over cap  → { ok: false, reason: vault_full, used: 45527, capacity: 10000 }
--   with room → { ok: true,  deposited: 5, available: 9995 }

create or replace function public.corp_vault_deposit_v2(
  p_corp_id uuid, p_kind text, p_item_id text, p_name text, p_icon text,
  p_qty numeric, p_actor_name text default null::text)
 returns jsonb language plpgsql security definer set search_path to 'public'
as \$
declare
  v_uid uuid := auth.uid(); v_qty bigint; v_new numeric;
  v_perm jsonb; v_space jsonb; v_avail bigint;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'reason', 'not_signed_in'); end if;
  if p_corp_id is null or coalesce(btrim(p_item_id), '') = '' then
    return jsonb_build_object('ok', false, 'reason', 'bad_request');
  end if;
  if p_kind is null or p_kind not in ('card', 'item', 'resource') then
    return jsonb_build_object('ok', false, 'reason', 'not_storable', 'kind', p_kind);
  end if;
  v_qty := floor(coalesce(p_qty, 0));
  if v_qty <= 0 then return jsonb_build_object('ok', false, 'reason', 'bad_qty'); end if;

  v_perm := public.corp_vault_perms_for(p_corp_id, v_uid);
  if not coalesce((v_perm->>'ok')::boolean, false) then
    return jsonb_build_object('ok', false, 'reason', 'no_membership');
  end if;
  if p_kind = 'resource' and not coalesce((v_perm->>'deposit_res')::boolean, false) then
    return jsonb_build_object('ok', false, 'reason', 'no_permission', 'need', 'deposit_res');
  end if;
  if p_kind in ('item','card') and not coalesce((v_perm->>'deposit_items')::boolean, false) then
    return jsonb_build_object('ok', false, 'reason', 'no_permission', 'need', 'deposit_items');
  end if;

  v_space := public.corp_vault_space(p_corp_id);
  v_avail := coalesce((v_space->>'available')::bigint, 0);
  if v_qty > v_avail then
    -- ⚠ SPACE REPORT FIRST, VERDICT SECOND. Reversing these is the bug above.
    return v_space || jsonb_build_object(
      'ok', false, 'reason', 'vault_full',
      'available', v_avail, 'requested', v_qty);
  end if;

  insert into corp_vault (corp_id, depositor_id, depositor_name, kind, item_id, name, icon, qty)
  values (p_corp_id, v_uid, left(coalesce(p_actor_name, ''), 40), p_kind, p_item_id,
          left(coalesce(p_name, p_item_id), 80), left(coalesce(p_icon, ''), 12), v_qty)
  on conflict (corp_id, depositor_id, kind, item_id)
    do update set qty = corp_vault.qty + excluded.qty,
                  name = coalesce(nullif(excluded.name, ''), corp_vault.name),
                  icon = coalesce(nullif(excluded.icon, ''), corp_vault.icon),
                  depositor_name = coalesce(nullif(excluded.depositor_name, ''), corp_vault.depositor_name),
                  updated_at = now()
  returning qty into v_new;

  insert into corp_vault_log (corp_id, actor_id, actor_name, action, kind, item_id, name, icon, qty)
  values (p_corp_id, v_uid, left(coalesce(p_actor_name, ''), 40), 'deposit', p_kind, p_item_id,
          left(coalesce(p_name, p_item_id), 80), left(coalesce(p_icon, ''), 12), v_qty);

  -- Same ordering rule on the success path, for the same reason.
  return public.corp_vault_space(p_corp_id)
         || jsonb_build_object('ok', true, 'qty', v_new, 'deposited', v_qty);
end \$;
