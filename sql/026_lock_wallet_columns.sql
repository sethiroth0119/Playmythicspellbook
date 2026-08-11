-- ===========================================================================
-- 026 . THE LOCK — make the wallet columns unwritable by the client
-- ===========================================================================
-- This is the file the whole 023 → 025 sequence exists to make safe.
--
-- Until now, `authenticated` has held column UPDATE on user_profiles.gems and
-- .sovereigns, and RLS lets you update your own row. That is one request:
--
--   PATCH /rest/v1/user_profiles?user_id=eq.<self>   {"sovereigns": 999999}
--
-- No race, no exploit chain, no bank involved. Every atomic transfer, every
-- canonical row and every ledger in this repo is decoration while that grant
-- exists.
--
-- ⚠ WHY THIS COULD NOT GO FIRST
--   Revoking before the server owned the credit paths would have meant a real
--   Stripe purchase silently failing to persist. The order was forced:
--     023  canonical Cinder wallet, both rows written together
--     023b wallet_ledger restored (wallet_charge/credit were dead without it)
--     024  canonical Aza wallet; purchases + gifts server-side
--     025  gameplay rewards: server owns the amount, the roll and the rate
--     v120t7 client stops uploading gems/sovereigns at all
--     026  this file
--
-- ⚠ DO NOT APPLY THIS BEFORE v120t7 IS LIVE AT THE EDGE. The deployed client
--   must already have dropped both fields from its cloudSyncProfile payload.
--   An older tab still sending them fails the upsert — and because the upsert
--   is one statement, that takes EVERY other progression field with it.
--   Verify the edge first:
--     curl -s https://playmythicspellbook.com/ | grep -c "BUILD_VERSION = 'v120t7'"
--
-- ⚠ THE ERROR STRING IS NOT WHAT YOU EXPECT — grep for the right one.
--   Postgres reports DML privilege failures at TABLE granularity and does not
--   name the offending column, so the log line reads:
--       permission denied for table user_profiles
--   NOT "permission denied for column gems". An earlier version of this
--   comment claimed the latter, which would have sent the next person
--   grepping for a string that never appears.
--
-- 📋 WHAT ACTUALLY HAPPENED ON APPLY (2026-08-10, recorded because it will
--    happen again for whoever repeats this pattern on another column):
--    49 × "permission denied for table user_profiles" between 19:33:12Z (the
--    exact second this migration applied) and 19:40:20Z, plus 5 for
--    bank_of_ethos. Cause: tabs still running the pre-v120t7 client from the
--    service-worker cache, still sending gems/sovereigns. It self-cleared in
--    ~7 minutes as those tabs reloaded, and no data was lost — localStorage
--    kept the profile and it re-synced on reload. But those players' cloud
--    saves silently failed for that window. If you do this again, either ship
--    the client a good while ahead of the revoke, or force a service-worker
--    cache bust first.
--
-- ⚠ POSTGRES GOTCHA THAT MAKES THIS FILE LOOK ODD
--   `REVOKE UPDATE (gems) ...` does NOT work when a TABLE-level UPDATE grant
--   exists — a table-level privilege covers every column and column-level
--   revokes cannot punch a hole in it. The only way is to drop the table-level
--   grant and re-grant column by column. Hence the DO block.
--
-- ⚠ CONSEQUENCE FOR FUTURE SCHEMA CHANGES
--   Because the grant is now enumerated per column, a NEW column added to
--   user_profiles will have NO client write privilege and any upsert naming it
--   will fail. Re-run this file after any `alter table public.user_profiles
--   add column`. That is the cost of the lock, and it is cheap: the file is
--   idempotent and takes a second.
-- ===========================================================================

do $$
declare
  v_cols text;
begin
  -- Everything except the three the server owns.
  select string_agg(quote_ident(column_name), ', ' order by ordinal_position)
    into v_cols
    from information_schema.columns
   where table_schema = 'public'
     and table_name   = 'user_profiles'
     and column_name not in ('gems', 'sovereigns', 'wallet_seq');

  if v_cols is null then
    raise exception '026: user_profiles has no grantable columns — refusing to lock the table out entirely';
  end if;

  -- Drop the blanket grants, then hand back everything but the wallet.
  execute 'revoke insert, update on public.user_profiles from anon, authenticated';
  execute 'grant insert (' || v_cols || ') on public.user_profiles to authenticated';
  execute 'grant update (' || v_cols || ') on public.user_profiles to authenticated';

  -- anon gets nothing back. RLS already blocked it (auth.uid() is null, so no
  -- row matches), but a grant nobody needs is a grant that only ever becomes a
  -- problem later.
end $$;

-- The SECURITY DEFINER functions are unaffected — they run as the definer and
-- bypass both RLS and these grants. That is precisely why the wallet still
-- moves: wallet_charge, wallet_credit, boe_transfer, _sov_apply, sov_charge,
-- sov_reward, sov_refund, aza_fulfill and aza_gift_claim all keep working.

-- ===========================================================================
-- VERIFY — all three must be false, and the fourth must be true.
-- ===========================================================================
-- select has_column_privilege('authenticated','public.user_profiles','sovereigns','UPDATE') as can_write_aza,
--        has_column_privilege('authenticated','public.user_profiles','gems','UPDATE')       as can_write_cinder,
--        has_column_privilege('authenticated','public.user_profiles','wallet_seq','UPDATE') as can_write_seq,
--        has_column_privilege('authenticated','public.user_profiles','display_name','UPDATE') as can_still_save_profile;
--   -> false, false, false, true

-- And the real test, from a signed-in browser console on the live site —
-- this must come back 403:
--   await (await fetch(SB_URL + '/rest/v1/user_profiles?user_id=eq.' + MY_ID, {
--     method: 'PATCH',
--     headers: { apikey: ANON, authorization: 'Bearer ' + JWT,
--                'content-type': 'application/json' },
--     body: JSON.stringify({ sovereigns: 999999 }) })).status
