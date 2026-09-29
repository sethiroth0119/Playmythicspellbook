-- 119 · Close the anon EXECUTE on 116/117/118 (v121v57).
--
-- Verified on the live database after 116-118 were applied: every one of the
-- new functions reads `proacl = {postgres=X/postgres, anon=X/postgres,
-- authenticated=X/postgres, service_role=X/postgres}` — i.e. `anon` can call
-- them.
--
-- WHY, and it is the trap already written down in this repo's notes: a new
-- function gets EXECUTE granted to PUBLIC by PostgreSQL *and* to `anon` by
-- Supabase's default privileges, as two separate ACL entries. The
-- `revoke all ... from public` in each of those files removed only the first.
--
-- NOTHING WAS EXPLOITABLE. Every function opens with
-- `if v_uid is null then raise exception 'not signed in'`, get_my_ledger and
-- corp_staff_list filter on `auth.uid()` (null for anon ⇒ zero rows), and all
-- three tables have RLS with policies scoped `to authenticated`, so an anon
-- SELECT returns nothing. The one real leak was `_corp_is_officer(corp, uid)`,
-- which takes the user id as an ARGUMENT rather than reading auth.uid() — an
-- anon caller could probe whether a given player is an officer of a given
-- corporation. This closes all of it: the callable surface should be the
-- surface the game actually uses, not the surface that happens to be safe.

revoke all on function public.get_my_ledger(int)                                     from public, anon;
revoke all on function public._corp_is_officer(uuid, uuid)                           from public, anon;
revoke all on function public.corp_staff_list(uuid)                                  from public, anon;
revoke all on function public.corp_staff_offer(uuid, uuid, uuid, bigint, text)       from public, anon;
revoke all on function public.corp_staff_apply(uuid, uuid, bigint, text)             from public, anon;
revoke all on function public.corp_staff_counter(uuid, bigint)                       from public, anon;
revoke all on function public.corp_staff_accept(uuid)                                from public, anon;
revoke all on function public.corp_staff_payroll(uuid)                               from public, anon;
revoke all on function public.corp_staff_end(uuid)                                   from public, anon;
revoke all on function public.node_sale_list(text, bigint, text, jsonb, text)        from public, anon;
revoke all on function public.node_sale_cancel(text)                                 from public, anon;
revoke all on function public.node_sale_buy(text, text)                              from public, anon;

-- …and put back the one grant the game needs. `_corp_is_officer` is a helper
-- the other functions call internally (they are SECURITY DEFINER and run as
-- their owner), so it stays callable by nobody.
grant execute on function public.get_my_ledger(int)                                  to authenticated;
grant execute on function public.corp_staff_list(uuid)                               to authenticated;
grant execute on function public.corp_staff_offer(uuid, uuid, uuid, bigint, text)    to authenticated;
grant execute on function public.corp_staff_apply(uuid, uuid, bigint, text)          to authenticated;
grant execute on function public.corp_staff_counter(uuid, bigint)                    to authenticated;
grant execute on function public.corp_staff_accept(uuid)                             to authenticated;
grant execute on function public.corp_staff_payroll(uuid)                            to authenticated;
grant execute on function public.corp_staff_end(uuid)                                to authenticated;
grant execute on function public.node_sale_list(text, bigint, text, jsonb, text)     to authenticated;
grant execute on function public.node_sale_cancel(text)                              to authenticated;
grant execute on function public.node_sale_buy(text, text)                           to authenticated;

-- The same default-privilege grant put SELECT on the three tables in anon's
-- hands. RLS already returns it nothing (every policy is `to authenticated`),
-- but a table an anon client cannot open at all is one fewer thing depending
-- on a policy staying correct. `authenticated` keeps SELECT: the client reads
-- node_sales directly to draw the FOR SALE signs.
revoke all on public.corp_staff    from anon;
revoke all on public.node_sales    from anon;
revoke all on public.node_sale_log from anon;
grant select on public.corp_staff    to authenticated;
grant select on public.node_sales    to authenticated;
grant select on public.node_sale_log to authenticated;

-- verify — every row should read anon_x = false, auth_x = true
--   select p.proname, has_function_privilege('anon', p.oid, 'EXECUTE') anon_x,
--          has_function_privilege('authenticated', p.oid, 'EXECUTE') auth_x
--     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname = 'public'
--      and (p.proname like 'corp\_staff\_%' or p.proname like 'node\_sale\_%'
--           or p.proname in ('get_my_ledger', '_corp_is_officer'));
