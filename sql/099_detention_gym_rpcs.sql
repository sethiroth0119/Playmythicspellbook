-- ===========================================================================
-- 099 — DETENTION AND GYM HISTORY: STOP CLIENTS WRITING EACH OTHER'S ROWS.
--
-- WHY THIS EXISTS
-- The account-separation sweep found `detention` and `gym_history` carrying
-- INSERT and UPDATE policies of plain `true` for `authenticated`. Every other
-- table in this schema is scoped; these two were not, and the reason they were
-- not is the interesting part: THE GAME GENUINELY NEEDS ONE PLAYER TO WRITE
-- ANOTHER PLAYER'S ROW.
--
--   · A judge commits somebody else to the Detention Complex.
--   · Whoever notices a sentence has expired flips that row to `released` —
--     there is no server clock, so the first client to look does the janitoring.
--   · An ally posts bail for a friend.
--   · The player who TAKES a gym closes out the previous leader's open reign.
--
-- So `user_id = auth.uid()` is the wrong answer here — it would break arrests,
-- bail and gym takeovers for everybody. The right answer is that each of those
-- writes has a RULE, the rule was only ever enforced in index.html, and a policy
-- of `true` is what "enforced on the client" looks like from the database.
-- 121 accounts share these tables, and the shipped client is the only thing that
-- was stopping one of them from opening their own cell door.
--
-- WHAT WAS ACTUALLY REACHABLE (not theoretical — this is a browser fetch away):
--   · `update detention set status='released' where offender_name='...'`
--     — walk yourself out, or empty the jail.
--   · `update detention set bail_cinder=0, seize_cinder=0`
--     — a sentence that costs nothing.
--   · `update detention set seized_done=true`
--     — the flag that means "the fine was collected". Set it before the
--       offender's own client gets there and the seizure never happens.
--   · `update gym_history set reign_seconds=999999999, peak_streak=999`
--     — any reign, anyone's, on a leaderboard.
--
-- THE SHAPE OF THE FIX
-- Every cross-player write becomes a SECURITY DEFINER function that re-checks
-- the rule the client used to check alone, and the policies drop to `false`.
-- The functions are deliberately NARROW — one action each, no general update —
-- because a general "update this row" RPC is the policy it replaced wearing a
-- function's clothes.
--
-- ⚠ THE NUMBERS STAY IN index.html. Sentence length, bail and seizure are
--   DETENTION_HOURS / DET_BAIL_PER_CLASS / DET_SEIZE_PER_CLASS, and copying them
--   here would create a second source of truth that drifts the first time one is
--   retuned. detention_commit() therefore ACCEPTS them and validates RANGES
--   instead of values: severity 1-5, a sentence under 30 days, money that is
--   non-negative and not absurd. It refuses nonsense without pretending to know
--   the tuning.
-- ⚠ reign_seconds IS COMPUTED SERVER-SIDE, not accepted. It is the one number on
--   a public leaderboard, the client had no reason to be trusted with it, and
--   now(): - claimed_at is right there.
-- ⚠ IDENTITY ON A DETENTION ROW IS A DISPLAY NAME. _detHandle() in index.html is
--   `displayName.trim().toLowerCase()` and the commit path never filled the
--   `user_id` column, so that string is the only handle a legacy row has.
--   _det_is_me() matches it exactly the same way — and REFUSES TO MATCH ON AN
--   EMPTY STRING, without which every player who has not set a display name
--   would match every row that has no offender name.
--   New rows now resolve and store `user_id` as well, so this weakens over time.
--
-- Idempotent and re-runnable. Verify queries at the bottom.
-- ===========================================================================

-- ── HELPERS ────────────────────────────────────────────────────────────────
/* ⚠ STATUS IS CHECKED HERE AND IS NOT CHECKED ON THE CLIENT. index.html tests
   `Court.mine.role === 'judge'` and ignores `status` entirely. Every official on
   the table is 'active' today so the two agree, and this is the safe direction
   for them to disagree in later: a struck-off judge would still see the button
   and would be refused by the server, rather than the reverse. If a status other
   than 'active' is ever introduced, teach the client to grey the button out. */
create or replace function public._det_is_judge() returns boolean
language sql stable security definer set search_path to 'public' as $$
  select exists (
    select 1 from public.court_officials
     where user_id = auth.uid() and role = 'judge'
       and coalesce(status, 'active') = 'active');
$$;

create or replace function public._det_is_me(p_name text) returns boolean
language sql stable security definer set search_path to 'public' as $$
  select btrim(coalesce(p_name, '')) <> ''
     and exists (
    select 1 from public.user_profiles
     where user_id = auth.uid()
       and lower(btrim(coalesce(display_name, ''))) = lower(btrim(p_name)));
$$;

create or replace function public._det_my_name() returns text
language sql stable security definer set search_path to 'public' as $$
  select btrim(coalesce(display_name, '')) from public.user_profiles where user_id = auth.uid();
$$;

-- ── 1. COMMIT — a judge, and only a judge, jails somebody ───────────────────
create or replace function public.detention_commit(
  p_name text, p_crime text, p_severity integer, p_hours integer,
  p_bail numeric, p_seize numeric, p_case_id uuid default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_id uuid; v_target uuid;
begin
  if auth.uid() is null then return jsonb_build_object('ok', false, 'error', 'not_signed_in'); end if;
  if not public._det_is_judge() then return jsonb_build_object('ok', false, 'error', 'judge_only'); end if;
  if btrim(coalesce(p_name, '')) = '' then return jsonb_build_object('ok', false, 'error', 'no_name'); end if;
  -- Ranges, not values: the tuning lives in index.html. See the header.
  if p_severity is null or p_severity < 1 or p_severity > 5
     or p_hours is null or p_hours < 1 or p_hours > 720
     or coalesce(p_bail, 0) < 0 or coalesce(p_bail, 0) > 10000000
     or coalesce(p_seize, 0) < 0 or coalesce(p_seize, 0) > 10000000 then
    return jsonb_build_object('ok', false, 'error', 'bad_args');
  end if;
  if exists (select 1 from public.detention
              where status = 'jailed'
                and lower(btrim(coalesce(offender_name, ''))) = lower(btrim(p_name))) then
    return jsonb_build_object('ok', false, 'error', 'already_held');
  end if;

  select user_id into v_target from public.user_profiles
   where lower(btrim(coalesce(display_name, ''))) = lower(btrim(p_name)) limit 1;

  insert into public.detention
    (offender_name, user_id, crime_type, severity, status, jailed_at, release_at,
     bail_cinder, seize_cinder, seized_done, case_id, committed_by, committed_name)
  values
    (left(btrim(p_name), 40), v_target, nullif(btrim(coalesce(p_crime, '')), ''), p_severity,
     'jailed', now(), now() + make_interval(hours => p_hours),
     coalesce(p_bail, 0), coalesce(p_seize, 0), false, p_case_id,
     auth.uid(), coalesce(public._det_my_name(), 'Judge'))
  returning id into v_id;
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;

-- ── 2. RELEASE — three doors, each with its own key ─────────────────────────
create or replace function public.detention_release(p_id uuid, p_mode text)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare d record; v_by text;
begin
  if auth.uid() is null then return jsonb_build_object('ok', false, 'error', 'not_signed_in'); end if;
  select * into d from public.detention where id = p_id;
  if d is null then return jsonb_build_object('ok', false, 'error', 'no_row'); end if;
  -- coalesce for the same reason as above: a NULL status must not read as jailed.
  if coalesce(d.status, '') <> 'jailed' then return jsonb_build_object('ok', true, 'already', true); end if;

  if p_mode = 'expired' then
    -- Anyone may run the janitor, but ONLY on a sentence that has actually run
    -- out. This is the check the client could not make: it read its own clock.
    if d.release_at is null or d.release_at > now() then
      return jsonb_build_object('ok', false, 'error', 'not_expired');
    end if;
    v_by := 'time served';

  elsif p_mode = 'bail' then
    -- Bail is payable by the offender OR an ally, so any signed-in caller is
    -- legitimate. The Cinder leaves the payer's own balance client-side and the
    -- server cannot see that; what it CAN do is record who actually called, so
    -- a release always names a real account instead of a free-text claim.
    v_by := case when coalesce(public._det_is_me(d.offender_name), false)
                 then 'bail (self)'
                 else 'bail - ' || left(coalesce(public._det_my_name(), 'ally'), 30) end;

  elsif p_mode = 'judge' then
    if not coalesce(public._det_is_judge(), false) then return jsonb_build_object('ok', false, 'error', 'judge_only'); end if;
    v_by := 'judge - ' || left(coalesce(public._det_my_name(), 'Judge'), 30);

  else
    return jsonb_build_object('ok', false, 'error', 'bad_mode');
  end if;

  update public.detention
     set status = 'released', released_by = v_by, updated_at = now()
   where id = p_id and status = 'jailed';
  return jsonb_build_object('ok', true, 'released_by', v_by);
end $$;

-- ── 3. SEIZURE — the offender's own client, once, and nobody else's ─────────
create or replace function public.detention_seize_done(p_id uuid)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare d record;
begin
  if auth.uid() is null then return jsonb_build_object('ok', false, 'error', 'not_signed_in'); end if;
  select * into d from public.detention where id = p_id;
  if d is null then return jsonb_build_object('ok', false, 'error', 'no_row'); end if;
  /* 🔴 THIS FLAG MEANS "THE FINE WAS COLLECTED", so setting it is how you get
     out of paying. It was `true` for every authenticated caller, which made
     dodging a seizure a matter of asking a friend to flip it first. Only the
     offender may set it, only while they are held, and only false -> true. */
  /* 🔴 coalesce(..., false) IS THE WHOLE GUARD, AND IT WAS MISSING.
     `d.user_id = auth.uid()` evaluates to NULL — not false — on a row whose
     user_id was never filled in, and every legacy row is exactly that, because
     the old commit path only ever wrote offender_name. So the test read
     `if not (NULL or false)` => `if not NULL` => `if NULL`, plpgsql did not
     take the branch, and the function fell through and ALLOWED the write.
     Three-valued logic turned a deny into an allow, in the one function whose
     whole job is denying. The smoke round caught it: every other guard came
     back PASS and this one returned {ok:true} to a stranger.
     Same treatment on `status`, for the same reason. */
  if not coalesce(d.user_id = auth.uid(), false)
     and not coalesce(public._det_is_me(d.offender_name), false) then
    return jsonb_build_object('ok', false, 'error', 'not_yours');
  end if;
  if coalesce(d.status, '') <> 'jailed' then return jsonb_build_object('ok', false, 'error', 'not_held'); end if;
  update public.detention set seized_done = true, updated_at = now()
   where id = p_id and coalesce(seized_done, false) = false;
  return jsonb_build_object('ok', true);
end $$;

-- ── 4. GYM — closing the previous leader's reign ────────────────────────────
create or replace function public.gym_history_close_reign(p_core_id text, p_leader uuid)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_rows integer;
begin
  if auth.uid() is null then return jsonb_build_object('ok', false, 'error', 'not_signed_in'); end if;
  /* Three callers are legitimate and no others: the player who has just TAKEN
     the gym (they are the leader row now), the previous leader closing their
     own, and an admin running the season reset over all eight cores. */
  if p_leader is null or coalesce(btrim(p_core_id), '') = '' then
    return jsonb_build_object('ok', false, 'error', 'bad_args');
  end if;
  -- Same coalesce discipline as detention_seize_done, and for the same reason:
  -- a NULL comparison here reads as "not denied" rather than "not allowed".
  if not coalesce(p_leader = auth.uid(), false)
     and not exists (select 1 from public.gyms g where g.core_id = p_core_id and g.leader_id = auth.uid())
     and not coalesce(public.ms_is_admin(), false) then
    return jsonb_build_object('ok', false, 'error', 'not_allowed');
  end if;

  /* reign_seconds and peak_streak are DERIVED, never accepted. They are the
     numbers on a public leaderboard and the client had no business supplying
     them — the open history row already carries claimed_at, and `gyms` already
     carries the streak. */
  update public.gym_history h
     set lost_at = now(),
         reign_seconds = greatest(0, extract(epoch from (now() - h.claimed_at))::bigint),
         peak_streak = coalesce((select greatest(coalesce(g.peak_streak, 0), coalesce(g.defense_streak, 0))
                                   from public.gyms g where g.core_id = p_core_id), h.peak_streak, 0)
   where h.core_id = p_core_id and h.user_id = p_leader and h.lost_at is null;
  get diagnostics v_rows = row_count;
  return jsonb_build_object('ok', true, 'closed', v_rows);
end $$;

-- ── 5. THE POLICIES ────────────────────────────────────────────────────────
-- Direct writes are gone. SELECT is untouched: both tables are public records
-- (a jail roster and a leaderboard) and are meant to be readable.
/* ⚠ ms_is_admin(), NOT `false`. The first pass wrote `false` and would have
   broken the ADMIN CONSOLE, which writes both tables directly — index.html
   :186756 commits a detainee and :186773 bulk-releases by handle. Admins are
   already trusted everywhere else in this schema, the console does not fit the
   player RPCs (it releases by NAME, not by row id), and forcing it through them
   would have meant reshaping a working tool to satisfy a policy. So the policy
   says what is actually true: a player writes through the RPCs, an admin writes
   directly. */
drop policy if exists det_ins on public.detention;
drop policy if exists det_upd on public.detention;
drop policy if exists det_ins_rpc_only on public.detention;
drop policy if exists det_upd_rpc_only on public.detention;
create policy det_ins_rpc_only on public.detention for insert to authenticated with check (public.ms_is_admin());
create policy det_upd_rpc_only on public.detention for update to authenticated using (public.ms_is_admin()) with check (public.ms_is_admin());

drop policy if exists gh_ins on public.gym_history;
drop policy if exists gh_upd on public.gym_history;
drop policy if exists gh_ins_self on public.gym_history;
drop policy if exists gh_upd_rpc_only on public.gym_history;
-- A player may still record their OWN claim directly; that write names nobody else.
create policy gh_ins_self on public.gym_history for insert to authenticated with check (user_id = auth.uid());
create policy gh_upd_rpc_only on public.gym_history for update to authenticated using (public.ms_is_admin()) with check (public.ms_is_admin());

/* 🔴 A NEW FUNCTION IS ANON-CALLABLE IN THIS PROJECT UNLESS YOU SAY OTHERWISE,
   AND `revoke ... from anon, authenticated` IS NOT ENOUGH TO CHANGE THAT.
   ═══════════════════════════════════════════════════════════
   Two separate grants have to be removed and they are easy to mistake for one:

     · PUBLIC holds EXECUTE on every new function by PostgreSQL default. In an
       ACL that is the entry with an empty grantee — `=X/postgres`. Revoking
       from `anon` does not touch it, and every role still inherits it.
     · Supabase's own DEFAULT PRIVILEGES then grant EXECUTE to anon,
       authenticated and service_role explicitly, so `anon=X/postgres` appears
       as well.

   The first pass here revoked from `anon, authenticated` only, and the verify
   query still said anon: true — which is the entire reason the verify query
   exists. Both revokes are needed, then the grant that is actually wanted.
   ⚠ CHECK proacl, NOT just has_function_privilege(), when this surprises you:
     the ACL shows you WHICH of the two grants is still standing. */
revoke execute on function public.detention_commit(text, text, integer, integer, numeric, numeric, uuid) from public, anon;
revoke execute on function public.detention_release(uuid, text) from public, anon;
revoke execute on function public.detention_seize_done(uuid) from public, anon;
revoke execute on function public.gym_history_close_reign(text, uuid) from public, anon;
grant execute on function public.detention_commit(text, text, integer, integer, numeric, numeric, uuid) to authenticated;
grant execute on function public.detention_release(uuid, text) to authenticated;
grant execute on function public.detention_seize_done(uuid) to authenticated;
grant execute on function public.gym_history_close_reign(text, uuid) to authenticated;
-- The helpers are internal; nothing outside these functions should call them.
-- They are SECURITY DEFINER and are called from SECURITY DEFINER functions, so
-- they still run — as the owner, who keeps their rights.
revoke execute on function public._det_is_judge() from public, anon, authenticated;
revoke execute on function public._det_is_me(text) from public, anon, authenticated;
revoke execute on function public._det_my_name() from public, anon, authenticated;

-- ===========================================================================
-- VERIFY
--   -- no write policy on either table is permissive any more:
--   select c.relname, p.polname,
--          pg_get_expr(p.polqual, p.polrelid) as using_expr,
--          pg_get_expr(p.polwithcheck, p.polrelid) as check_expr
--     from pg_policy p join pg_class c on c.oid = p.polrelid
--    where c.relname in ('detention','gym_history') and p.polcmd in ('a','w')
--    order by c.relname, p.polname;
--   -- expect `false` on every write policy except gh_ins_self, which is
--   -- (user_id = auth.uid()).
--
--   -- and the four RPCs are callable while the helpers are not:
--   select p.oid::regprocedure,
--          has_function_privilege('authenticated', p.oid, 'EXECUTE') as authed
--     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname = 'public'
--      and p.proname in ('detention_commit','detention_release','detention_seize_done',
--                        'gym_history_close_reign','_det_is_judge','_det_is_me','_det_my_name')
--    order by p.proname;
-- ===========================================================================
-- VERIFY / SMOKE  — run this whole block; every row must say PASS.
--
-- It impersonates real accounts with set_config('request.jwt.claims'), drives
-- the shipped functions, and asserts BOTH directions: the exploits are refused
-- AND ordinary play still works. Round 07 is the one that matters most — it is
-- the three-valued-logic hole, and it returned {ok:true} to a stranger until
-- the coalesce() went in. Test rows are deleted at the end.
-- ---------------------------------------------------------------------------
-- (kept as a comment so a stray run cannot jail anybody; uncomment to use, and
--  substitute a judge, a victim and a stranger from your own court_officials
--  and user_profiles.)
--
--   create temp table tres(step text, got text, want text, ok boolean);
--   grant insert, select on tres to authenticated;
--   do 1632 declare
--     judge uuid := '<a judge from court_officials>';
--     victim uuid := '<any player>'; stranger uuid := '<any other player>';
--     r jsonb; v_id uuid; v_id2 uuid; n int;
--   begin
--     set local role authenticated;
--     perform set_config('request.jwt.claims', json_build_object('sub', stranger, 'role','authenticated')::text, true);
--     r := public.detention_commit('__smoketest__','testing',2,1,100,50,null);
--     insert into tres values ('01 non-judge cannot commit', r->>'error', 'judge_only', (r->>'error')='judge_only');
--     ... (rounds 02-16: double sentence, severity range, handle->user_id,
--          early release, seize flag on a NULL-user_id row, seize flag on
--          someone else's row, direct table write, stranger closing a reign,
--          null leader, the offender setting their OWN flag, self-bail credit,
--          ally bail, and released_by naming the real payer)
--     reset role;
--     delete from public.detention where offender_name like '__smoketest__%';
--   end 1632;
--   select step, got, want, case when ok then 'PASS' else '*** FAIL ***' end from tres order by step;
--
-- Structural checks that need no impersonation:
--   select c.relname||'.'||p.polname, pg_get_expr(p.polwithcheck, p.polrelid)
--     from pg_policy p join pg_class c on c.oid=p.polrelid
--    where c.relname in ('detention','gym_history') and p.polcmd in ('a','w');
--   -- expect ms_is_admin() on three, (user_id = auth.uid()) on gh_ins_self.
--
--   select p.oid::regprocedure,
--          has_function_privilege('anon', p.oid, 'EXECUTE') as anon,
--          has_function_privilege('authenticated', p.oid, 'EXECUTE') as authed
--     from pg_proc p join pg_namespace n on n.oid=p.pronamespace
--    where n.nspname='public' and (p.proname like 'detention_%'
--      or p.proname='gym_history_close_reign' or p.proname like '_det_%');
--   -- expect anon=false everywhere; authed=true on the four RPCs and false on
--   -- the three _det_ helpers.
-- ===========================================================================
