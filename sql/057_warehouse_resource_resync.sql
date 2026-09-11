-- ════════════════════════════════════════════════════════════════════════════
-- 057 — WAREHOUSE: keep the resource ledger level with the player
-- ════════════════════════════════════════════════════════════════════════════
-- Run by hand in the Supabase SQL editor for project ktsiasyjusesawtrwrjc.
-- Idempotent (CREATE OR REPLACE). APPLIED 2026-08-25.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- 🔴 THE BUG: "THE STORAGE NETWORK DOES NOT HAVE THOSE GOODS ON YOUR ACCOUNT"
--   Reported with a screenshot: the send modal offers Ammo 127, Metal 561,
--   Medicine 575 — the player's real inventory — the player picks 490 kg of it,
--   and the send is refused as `insufficient_resources`.
--
--   wh_seed_resources is a ONE-TIME opening balance. It loops every one of the
--   11 weighted resources and inserts with `on conflict do nothing`, INCLUDING
--   the zeros, so after the very first call the ledger is never empty again.
--   The client's `_whSeedLedger()` then read "ledger has rows" as "ledger is in
--   sync", latched `_whSeeded = true` and never wrote to it again.
--
--   So there was NO PATH AT ALL for a resource earned after that first moment to
--   reach the warehouse. The send modal reads Profile.salvage and shows the
--   truth; wh_send_shipment checks user_resources and sees a snapshot from
--   whenever the player first opened the warehouse. Every ore mined since was
--   invisible. The error text even says so — "resources earned outside the
--   warehouse are not on its ledger yet" — which is a description of the bug
--   presented to the player as if it were a rule.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- ⚠ WHY A TOP-UP IS SAFE, checked rather than assumed. The two ledgers already
--   move together on every send: wh_send_shipment deducts user_resources
--   server-side, and the client deducts Profile.salvage the moment the send is
--   accepted ("ESCROW: the goods leave the local salvage ledger"). They can
--   therefore only drift in ONE direction — the client runs ahead by exactly
--   what the city produced. Topping up to the larger of the two closes that gap
--   and can never resurrect goods that have already shipped.
--
-- ⚠ IT NEVER REDUCES. If the ledger holds MORE than the client claims, the
--   ledger wins. A client that has not caught up with a withdrawal must not be
--   able to delete goods by claiming it has fewer.
--
-- ⚠ NO NEW TRUST IS GRANTED, and the 100,000 cap is unchanged. The opening
--   balance was ALREADY self-declared from this same client profile; this
--   repeats a declaration the system already accepts rather than introducing
--   one. Resources are client-authoritative everywhere else in the game
--   (Profile.salvage — there is no server-side resource store; user_resources
--   is the warehouse's own mirror), so this was never an anti-cheat boundary.
--   It is an accounting mirror, and a mirror that cannot be updated is simply
--   wrong. Every resync is written to wallet_ledger exactly as the seed is, so
--   the declaration remains auditable.
-- ════════════════════════════════════════════════════════════════════════════

create or replace function public.wh_resync_resources(p_payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare
  v_uid uuid := auth.uid(); v_pay jsonb; k text; v_claim numeric; v_have bigint; v_new bigint;
  v_cap constant bigint := 100000;
  v_added jsonb := '{}'::jsonb; v_total bigint := 0;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'reason', 'not_signed_in'); end if;
  -- The same per-uid advisory lock wh_seed_resources takes, so a seed and a
  -- resync racing each other cannot interleave into a double credit.
  perform pg_advisory_xact_lock(hashtext('wh_seed:' || v_uid::text));
  v_pay := public._wh_sane_payload(p_payload);
  for k in select jsonb_object_keys(public.wh_config() -> 'weights') loop
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
end $function$;

grant execute on function public.wh_resync_resources(jsonb) to authenticated;

-- ── VERIFY ──────────────────────────────────────────────────────────────────
select p.proname,
       (pg_get_functiondef(p.oid) like '%greatest(v_have%') as tops_up_never_reduces,
       (pg_get_functiondef(p.oid) like '%pg_advisory_xact_lock%') as shares_the_seed_lock,
       (pg_get_functiondef(p.oid) like '%wallet_ledger%') as audited
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and p.proname='wh_resync_resources';

-- ── APPLIED 2026-08-25 ──────────────────────────────────────────────────────
--   wh_resync_resources created; whitelisted in WH_RPC_ALLOW.
--   Client `_whSeedLedger()` no longer returns early on `_whSeeded`: it seeds
--   once as before, then TOPS UP on every send-modal open.
