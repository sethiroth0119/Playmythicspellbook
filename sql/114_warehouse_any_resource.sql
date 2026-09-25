-- ============================================================================
-- 114_warehouse_any_resource.sql
-- Every resource a player can loot or earn can be sent to a warehouse.
-- Idempotent. Apply BY HAND in the Supabase SQL editor (ktsiasyjusesawtrwrjc).
--
-- Asked for: "allow players to send every resource (any item that can be
-- looted or gotten from a mini game) to a warehouse."
--
-- WHAT GATED IT. The warehouse only knew the eleven ids in wh_config().weights:
--   _wh_known_resource(id)   = "is id a key of weights"  (the CHECK on user_resources)
--   _wh_sane_payload(json)   dropped every other key from a shipment
--   wh_seed_resources / wh_resync_resources  looped over the weights keys only
-- so a stash full of lumber, ore, corn or refinery cuts could never reach the
-- server ledger, let alone a bay.
--
-- WHAT CHANGES. A resource id is any sane identifier (letters, digits, _ -,
-- up to 64 chars). Weights stay exactly as they are; anything not in the
-- weights table ships at default_weight (1 kg). Seeding and resync accept
-- every id the client declares, under the same 100,000-per-resource cap and
-- the same self-declared audit row. Nothing about capacity, crating, ETA,
-- rent or money moves.
-- ============================================================================

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

-- ── VERIFY ──────────────────────────────────────────────────────────────────
select 'lumber is a known resource' as check_name, case when public._wh_known_resource('lumber') then 'ok' else 'MISSING' end as result
union all select 'a junk id is refused', case when not public._wh_known_resource('drop table; --') then 'ok' else 'MISSING' end
union all select 'payload keeps any resource', case when (public._wh_sane_payload('{"lumber": 12, "copperOre": "3", "x y": 1}'::jsonb)) = '{"lumber": 12, "copperOre": 3}'::jsonb then 'ok' else 'MISSING' end
union all select 'weights unchanged', case when (public.wh_config() -> 'weights' ->> 'metal')::numeric = 3.5 then 'ok' else 'MISSING' end;
