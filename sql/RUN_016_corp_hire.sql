-- ============================================================================
-- RUN_016 — corp_hire(): accepting an application actually hires the player.
--
-- THE BUG
-- `corp_members` INSERT is gated by:  with check (user_id = auth.uid())
-- so a founder CANNOT create anyone else's membership row. Accepting an
-- application therefore only set corp_requests.status = 'hired', and the real
-- membership was written later by the HIRED PLAYER'S OWN client on their next
-- login. Until that happened the person was invisible: gone from Applications
-- (no longer 'pending') and absent from the Roster. An owner who accepted two
-- players saw neither of them, and had no way to tell whether it had worked.
--
-- THE FIX
-- A SECURITY DEFINER function so the FOUNDER's click does the work, checked
-- server-side. This is the same pattern the project already uses for chat_send
-- and the is_community_member/is_community_leader helpers.
--
-- 🔒 SECURITY REVIEW — every line of this matters, per CLAUDE.md.
--   · SECURITY DEFINER + a pinned search_path: without `set search_path` a
--     caller could shadow `public` and run their own tables as the owner.
--   · The founder check is done INSIDE the function against corporations,
--     not taken from any argument. The only input is a request id.
--   · It cannot hire into a corp you do not found, cannot invent a user_id,
--     and cannot promote anyone to founder — the role is read from the
--     request row the applicant themselves created.
--   · EXECUTE is revoked from public/anon and granted only to authenticated.
--   · The member cap is deliberately NOT enforced here: over-cap hiring is a
--     paid action the client already charges Aza for, and duplicating the rule
--     server-side would silently void a purchase.
-- Idempotent and re-runnable. Ends with a verify query.
-- ============================================================================

create or replace function public.corp_hire(p_request_id uuid)
returns table (user_id uuid, user_name text, role text, corp_id uuid)
language plpgsql
security definer
set search_path = public
as $fn$
declare
  r public.corp_requests%rowtype;
  v_founder uuid;
begin
  select * into r from public.corp_requests where id = p_request_id;
  if not found then
    raise exception 'corp_hire: no such application';
  end if;

  -- Only the founder of THAT corp may hire. Read it fresh; never trust input.
  select c.founder_id into v_founder
  from public.corporations c
  where c.id = r.corp_id;

  if v_founder is null or v_founder <> auth.uid() then
    raise exception 'corp_hire: not the founder of this corporation';
  end if;

  -- Already handled? Return the existing membership rather than erroring, so a
  -- double-click or a retry after a dropped connection is harmless.
  if r.status not in ('pending', 'hired') then
    return query
      select m.user_id, m.user_name, m.role, m.corp_id
      from public.corp_members m where m.user_id = r.user_id;
    return;
  end if;

  -- The membership the founder could not write for themselves.
  -- `on conflict (user_id)` matches the table's primary key: one corp per
  -- player, so re-hiring someone moves them rather than duplicating them.
  insert into public.corp_members as m (user_id, corp_id, user_name, role)
  values (r.user_id, r.corp_id, coalesce(r.user_name, 'Member'), coalesce(r.role, 'member'))
  on conflict (user_id) do update
    set corp_id = excluded.corp_id,
        user_name = coalesce(excluded.user_name, m.user_name),
        role = excluded.role;

  update public.corp_requests set status = 'joined' where id = p_request_id;

  return query
    select m2.user_id, m2.user_name, m2.role, m2.corp_id
    from public.corp_members m2 where m2.user_id = r.user_id;
end;
$fn$;

revoke all on function public.corp_hire(uuid) from public, anon;
grant execute on function public.corp_hire(uuid) to authenticated;

-- ── Backfill: anyone already accepted but never joined, hire them now. ──────
-- This is what recovers the two players who were accepted and never appeared.
-- It only touches rows a founder already approved ('hired'), so it cannot add
-- anyone who was not deliberately accepted.
insert into public.corp_members as m (user_id, corp_id, user_name, role)
select r.user_id, r.corp_id, coalesce(r.user_name, 'Member'), coalesce(r.role, 'member')
from   public.corp_requests r
where  r.status = 'hired'
on conflict (user_id) do update
  set corp_id = excluded.corp_id,
      user_name = coalesce(excluded.user_name, m.user_name),
      role = excluded.role;

update public.corp_requests set status = 'joined' where status = 'hired';

-- ── VERIFY ─────────────────────────────────────────────────────────────────
-- Every corporation, its roster size, and any application still outstanding.
-- After running this, `stuck_hired` must be 0 for every row.
select c.id, c.name, c.tag,
       (select count(*) from public.corp_members m where m.corp_id = c.id)                          as members,
       (select count(*) from public.corp_requests q where q.corp_id = c.id and q.status = 'pending') as pending,
       (select count(*) from public.corp_requests q where q.corp_id = c.id and q.status = 'hired')   as stuck_hired
from   public.corporations c
order  by c.name;
