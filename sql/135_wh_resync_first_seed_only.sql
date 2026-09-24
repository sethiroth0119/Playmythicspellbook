-- 135_wh_resync_first_seed_only.sql
-- wh_resync_resources: fill MISSING rows only. Never raise an existing balance.
--
-- ⚠ ALREADY APPLIED to ktsiasyjusesawtrwrjc on 2026-09-24 as migration
--   `wh_resync_resources_first_seed_only`. This file is the repo's record.
--   Idempotent (create or replace).
--
-- THE PROBLEM. This function took a client-supplied quantity and ratcheted the
-- player's vault UP to it:
--     v_new := least(100000, greatest(v_have, v_claim));
-- Only ever raising, never lowering, and it logged itself "resynced from the
-- client profile (SELF-DECLARED)" — the author knew. Two consequences. A client
-- could declare any quantity up to 100k per resource and be granted it. And —
-- the one that actually mattered — it silently undid EVERY server-side debit in
-- the game: donate, resync with the old numbers, get them back. Same for a
-- market purchase, or anything else that should cost something. It made the
-- Foundation Reserve debit in sql/133 cosmetic.
--
-- WHY THIS SHAPE AND NOT SOMETHING HARSHER. wh_seed_resources is ALREADY the
-- proper first-seed path and is well built: gated on wh_flags.seed_enabled and
-- wh_flags.seed_cutoff_at, advisory-locked, and it uses `on conflict do nothing`
-- so it only CREATES rows and never raises one that exists. It answers
-- 'already_seeded' when there is nothing to create.
--
-- So resync was never the migration path. It was a second, unguarded, repeatable
-- copy of that purpose with none of the guards. The live split made that
-- unarguable at the time of the change:
--     13 players holding vault rows
--     13 op='seed'   events  — exactly one each, seeding working correctly
--    360 op='resync' events  — ~28 apiece, across those same 13 players
-- Every one of those 360 was a top-up on top of an already-completed seed.
--
-- This keeps resync's real purpose (import what the server genuinely does not
-- have) and removes only the part that was never its job (top me up to whatever
-- I claim). For the 13 players already seeded it now grants nothing, which is
-- the correct answer for a seeded account.
--
-- COMPATIBILITY. Signature and return shape unchanged (ok / added / total_added
-- / ledger) so the client keeps working. `ledger` is returned on EVERY path,
-- including the closed-window one, because the client renders the vault from it
-- and must not be handed nothing to draw. CREATE OR REPLACE preserves the ACL,
-- so the authenticated grant survives — verified after applying.
--
-- ⚠ WHAT THIS DOES NOT DO. It does not make the economy server-authoritative.
--   Delivery in this game is still largely the client's job — rl_claim marks a
--   market purchase claimed without crediting anything, for instance. This
--   closes the path that could UNDO a server debit; it does not add the debits
--   and credits that are still missing elsewhere. Those need the client.

create or replace function public.wh_resync_resources(p_payload jsonb DEFAULT '{}'::jsonb)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_uid uuid := auth.uid(); v_pay jsonb; k text; v_claim numeric; v_have bigint; v_new bigint;
  v_cap constant bigint := 100000;
  v_added jsonb := '{}'::jsonb; v_total bigint := 0;
  v_flags public.wh_flags;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'reason', 'not_signed_in'); end if;

  -- Same gates as wh_seed_resources. A closed seeding window closes this too;
  -- the two must not disagree, or the tighter one is decorative.
  select * into v_flags from public.wh_flags where id;
  if v_flags.seed_enabled is not true
     or (v_flags.seed_cutoff_at is not null and now() > v_flags.seed_cutoff_at) then
    return jsonb_build_object('ok', true, 'added', '{}'::jsonb, 'total_added', 0,
      'reason', 'seeding_closed',
      'ledger', (select coalesce(jsonb_object_agg(resource_id, qty), '{}'::jsonb)
                   from public.user_resources where user_id = v_uid and qty > 0));
  end if;

  perform pg_advisory_xact_lock(hashtext('wh_seed:' || v_uid::text));
  v_pay := public._wh_sane_payload(p_payload);

  for k in select jsonb_object_keys(public.wh_config() -> 'weights')
           union select jsonb_object_keys(v_pay) loop
    v_claim := coalesce((v_pay ->> k)::numeric, 0);
    if v_claim <= 0 then continue; end if;

    -- 🔴 THE WHOLE CHANGE. A row that already exists is the server's own number
    -- and is left exactly alone — this is what stops a client undoing a debit.
    -- Only a genuinely absent row is filled.
    select qty into v_have from public.user_resources
     where user_id = v_uid and resource_id = k;
    if v_have is not null then continue; end if;

    v_new := least(v_cap, floor(v_claim)::bigint);
    if v_new <= 0 then continue; end if;

    insert into public.user_resources (user_id, resource_id, qty) values (v_uid, k, v_new)
      on conflict (user_id, resource_id) do nothing;
    if found then
      v_added := v_added || jsonb_build_object(k, v_new);
      v_total := v_total + v_new;
    end if;
  end loop;

  if v_total > 0 then
    insert into public.wallet_ledger (user_id, op, resource, delta, balance_after, reason, meta)
      values (v_uid, 'resync', 'user_resources', v_total, null,
              'Warehouse ledger: filled MISSING rows from the client profile (SELF-DECLARED, first-seed only)',
              jsonb_build_object('added', v_added, 'cap_per_resource', v_cap));
  end if;

  return jsonb_build_object('ok', true, 'added', v_added, 'total_added', v_total,
    'ledger', (select coalesce(jsonb_object_agg(resource_id, qty), '{}'::jsonb)
                 from public.user_resources where user_id = v_uid and qty > 0));
end $function$;

-- verify — expect ratchet gone, existing rows skipped, gates honoured, ACL kept
select 'wh_resync_resources' as check,
       pg_get_functiondef(oid) ~ 'greatest\(v_have'                            as still_ratchets_BAD,
       pg_get_functiondef(oid) ilike '%if v_have is not null then continue%'    as skips_existing_rows,
       pg_get_functiondef(oid) ilike '%seeding_closed%'                         as honours_seed_gates,
       has_function_privilege('authenticated', oid, 'EXECUTE')                  as authed_can_still_call
  from pg_proc where oid = 'public.wh_resync_resources(jsonb)'::regprocedure;
