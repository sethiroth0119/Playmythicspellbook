-- ===========================================================================
-- 101 — CLOSE THE THREE READ LEAKS, AND GIVE THE TRADE PUSH A DOOR IT CAN USE.
--
-- The last two items from the account-separation sweep (sql/097-100).
--
-- ── 1. FOUR FUNCTIONS THAT READ ANY ACCOUNT'S FIGURES ──────────────────────
-- cashable_cinder(p_user), cinder_from_aza(p_user), transport_key_speed(p_user)
-- and transport_key_level(p_user) are SECURITY DEFINER, take a user id, have no
-- authorisation check, and are EXECUTE-granted to `authenticated`. They are
-- READ-ONLY, so nobody could overwrite anything with them — but any signed-in
-- player could enumerate every other account's cashable Cinder and Aza position
-- by passing somebody else's uuid, and those uuids are not secret: they travel
-- in corp rosters, the player market and the haulage board.
--
-- transport_key_level was NOT on the original list and belongs on it — it was
-- found while reading the other three, because transport_key_speed is a thin
-- CASE over it, so scoping only the wrapper would have left the same read open
-- one call deeper.
--
-- These are self-service figures. The fix is to make the parameter mean what
-- every caller already uses it for.
--
-- ⚠ coalesce(p_user, auth.uid()) — NOT `p_user = auth.uid()`. Two of these are
--   declared `p_user uuid DEFAULT NULL` and are called with NO ARGUMENT, meaning
--   "me". A bare equality test would read NULL as "somebody else" and refuse
--   every no-arg call — breaking the normal path while fixing the abnormal one.
--   transport_key_level already had this exact shape; it is copied, not invented.
-- ⚠ RETURN NULL / 0, DO NOT RAISE. These are read helpers that UI code calls
--   without try/catch, so raising would turn a refused peek into a broken panel.
--   A caller asking about themselves never sees it.
-- ⚠ SIGNATURES ARE UNCHANGED. Rewriting them to take no argument would be
--   cleaner and would break every call site at once, the admin console's
--   included. The guard goes inside; a legitimate call is untouched.
--
-- NOT CHANGED: cashout_snapshot() takes no arguments and already scopes itself
-- to auth.uid(). It appeared in a first pass as a caller of cashable_cinder —
-- a false positive on `cinder_from_aza bigint`, one of its RETURN COLUMN NAMES,
-- not a call. Checked before touching it.
--
-- ── 2. THE TRADE-AGREEMENT PUSH HAS NEVER FIRED ────────────────────────────
-- index.html's _ctNotifyPartner() calls
--     rpc('_push_notify', { p_user: to, ... })
-- and the function takes `p_user_ids uuid[]`. PostgREST cannot resolve that
-- overload, so the call has 404'd since it was written: a partner has never once
-- been told their trade agreement fell short. Found while auditing 097 — and
-- revoking _push_notify from `authenticated` there did NOT break it, because it
-- was already broken.
--
-- Re-granting _push_notify is not the fix. It takes an ARRAY of arbitrary user
-- ids plus arbitrary title and body, with no authorisation at all — that is the
-- "push anything to anyone under the game's name" hole 097 closed, and a trade
-- notification is not worth reopening it.
--
-- ct_notify_partner(p_agreement, p_message) is the narrow door instead. It works
-- the recipient out FROM THE AGREEMENT, refuses anyone who is not a party to it
-- (reusing is_city_trade_party, which already exists and is already the rule),
-- and fixes the title itself so the body is the only thing a caller controls.
-- It cannot address a stranger, because it never takes an address.
--
-- Idempotent and re-runnable. Verify block at the bottom.
-- ===========================================================================

-- ── 1. SCOPE THE READS ─────────────────────────────────────────────────────
create or replace function public.cashable_cinder(p_user uuid default null)
returns bigint language sql stable security definer set search_path to 'public' as $$
  select case
    when coalesce(p_user, auth.uid()) is distinct from auth.uid()
     and not coalesce(public.ms_is_admin(), false) then null::bigint
    else greatest(
      0,
      coalesce((select gems from public.user_profiles where user_id = coalesce(p_user, auth.uid())), 0)::bigint
      - coalesce((select sum(cinder_minted) from public.aza_exchanges where user_id = coalesce(p_user, auth.uid())), 0)::bigint
    )
  end;
$$;

create or replace function public.cinder_from_aza(p_user uuid default null)
returns bigint language sql stable security definer set search_path to 'public' as $$
  select case
    when coalesce(p_user, auth.uid()) is distinct from auth.uid()
     and not coalesce(public.ms_is_admin(), false) then null::bigint
    else coalesce((select sum(cinder_minted) from public.aza_exchanges
                    where user_id = coalesce(p_user, auth.uid())), 0)::bigint
  end;
$$;

create or replace function public.transport_key_level(p_user uuid default null)
returns integer language sql stable security definer set search_path to 'public' as $$
  select case
    when coalesce(p_user, auth.uid()) is distinct from auth.uid()
     and not coalesce(public.ms_is_admin(), false) then 0
    else coalesce((select max(level) from public.transport_keys
                    where user_id = coalesce(p_user, auth.uid())), 0)
  end;
$$;

-- Unchanged in shape: a CASE over transport_key_level, which now carries the
-- guard. Restated so the pair cannot drift and so `1.00` (no key) is what an
-- impersonating caller gets — the same answer as an account with no keys, which
-- reveals nothing.
create or replace function public.transport_key_speed(p_user uuid default null)
returns numeric language sql stable security definer set search_path to 'public' as $$
  select case public.transport_key_level(p_user)
           when 5 then 0.40 when 4 then 0.55 when 3 then 0.70
           when 2 then 0.82 when 1 then 0.92 else 1.00 end;
$$;

-- ── 2. THE TRADE NOTIFICATION ──────────────────────────────────────────────
create or replace function public.ct_notify_partner(p_agreement uuid, p_message text)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare a record; v_to uuid;
begin
  if auth.uid() is null then return jsonb_build_object('ok', false, 'error', 'not_signed_in'); end if;
  select * into a from public.city_trade_agreements where id = p_agreement;
  if a is null then return jsonb_build_object('ok', false, 'error', 'no_agreement'); end if;
  /* The caller must be ON the agreement. coalesce(..., false) because a NULL
     from a comparison reads as "not denied" rather than "not allowed" — the
     three-valued-logic trap that shipped a hole in sql/099's seize guard. */
  if not coalesce(public.is_city_trade_party(p_agreement, auth.uid()), false) then
    return jsonb_build_object('ok', false, 'error', 'not_a_party');
  end if;
  /* THE RECIPIENT IS DERIVED, NEVER SUPPLIED: the other side of this agreement
     and nobody else. That is the whole reason this is safe to hand to a player
     when _push_notify is not. */
  v_to := case when a.proposer_id = auth.uid() then a.partner_id else a.proposer_id end;
  if v_to is null or v_to = auth.uid() then
    return jsonb_build_object('ok', false, 'error', 'no_partner');
  end if;
  perform public._push_notify(array[v_to],
                              '🤝 Trade agreement',
                              left(coalesce(p_message, ''), 300),
                              'city_trade', 'trade', '/');
  return jsonb_build_object('ok', true);
end $$;

/* Both grants, per the note in 099: PUBLIC holds EXECUTE by PostgreSQL default
   and Supabase's default privileges add `anon` explicitly. Revoking one leaves
   the other standing. */
revoke execute on function public.ct_notify_partner(uuid, text) from public, anon;
grant  execute on function public.ct_notify_partner(uuid, text) to authenticated;

-- ===========================================================================
-- VERIFY
--   -- own figure works, another account's comes back null:
--   create temp table r(step text, got text, want text);
--   grant insert, select on r to authenticated;
--   do $$ declare a uuid := '<user A>'; b uuid := '<user B>';
--   begin
--     set local role authenticated;
--     perform set_config('request.jwt.claims',
--       json_build_object('sub', a, 'role','authenticated')::text, true);
--     insert into r values ('own cashable is a number',
--       (public.cashable_cinder(a) is not null)::text, 'true');
--     insert into r values ('no-arg call still works',
--       (public.cashable_cinder() is not null)::text, 'true');
--     insert into r values ('another account is null',
--       (public.cashable_cinder(b) is null)::text, 'true');
--     insert into r values ('another key level is 0',
--       public.transport_key_level(b)::text, '0');
--     reset role;
--   end $$;
--   select step, got, want, case when got=want then 'PASS' else '*** FAIL ***' end from r;
--
--   -- grants: _push_notify stays shut (097), the new door is open to players:
--   select p.oid::regprocedure,
--          has_function_privilege('anon', p.oid, 'EXECUTE') as anon,
--          has_function_privilege('authenticated', p.oid, 'EXECUTE') as authed
--     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname='public' and p.proname in ('ct_notify_partner','_push_notify');
--   -- expect _push_notify false/false and ct_notify_partner false/true.
-- ===========================================================================
