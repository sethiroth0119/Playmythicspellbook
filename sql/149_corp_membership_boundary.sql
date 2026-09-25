-- ════════════════════════════════════════════════════════════════════════════
-- 149 · ONLY A FOUNDER'S HIRE MAKES A CORP MEMBER
--       APPLIED 2026-09-17 (owner: join-by-tag becomes a request). Rolled-back
--       probe: stranger self-insert refused, filing already-hired refused,
--       applicant self-hire refused, founder hire + corp_join_accept joined.
-- Project: ktsiasyjusesawtrwrjc
-- ----------------------------------------------------------------------------
-- THE HOLE (live policies read 2026-09-17; proven inside a rolled-back DO
-- block as real user ids: a stranger inserted themselves into another
-- player's corporation and read its treasury; an applicant hired themselves):
--
--   * corp_members.cm_ins   with check (user_id = auth.uid())
--       -> any player may INSERT a membership row into ANY corporation.
--   * corp_members.cm_upd   using/with check (user_id = auth.uid())
--       -> any player may move their own row to another corp_id, or promote
--          their own role to 'founder' / 'CEO'.
--   * corp_requests.creq_ins with check (user_id = auth.uid())
--       -> an applicant may file their application ALREADY status='hired'.
--   * corp_requests.creq_upd with check (true)
--       -> the applicant may set their own request to 'hired', and the founder
--          may rewrite user_id / corp_id on a request (hire somebody who never
--          applied, or pull a request into another corp).
--   index.html _corpEnsureRun then turns any 'hired' request into a membership
--   with a client write, so the self-hire becomes a real member on next boot.
--
--   Membership is not a label. is_corp_member() (sql/045) is the gate on
--   corp_vault cv_sel/cv_ins, corp_treasury ct_sel/ct_ins and the member debit
--   path (sql/146), and the territory / feed / ad checks in sql/143. With the
--   hole open, "only members may read the treasury" means "anyone may".
--   sql/142, 143 and 146 each name this as an unowned follow-up; this file is
--   that follow-up.
--
-- THE RULE: a membership row is written by the SERVER, except for one case —
--   a founder writing their OWN row for a corporation whose founder_id is
--   them (corpCreate and the founder self-heal in corpEnsure do exactly that,
--   and corporations.founder_id is already the authoritative ownership fact;
--   is_corp_member() treats a founder as a member with or without the row).
--   Everybody else joins through:
--     corp_hire(p_request_id)         founder-checked, SECURITY DEFINER (sql/016,
--                                     unchanged here) — writes the row and
--                                     marks the request 'joined';
--     corp_join_accept(p_request_id)  NEW. The HIRED player's side, for a
--                                     request the founder set to 'hired' on a
--                                     database that had no corp_hire. Checks
--                                     user_id = auth.uid() and status = 'hired'.
--
-- WHY TRIGGERS AS WELL AS POLICIES: a WITH CHECK cannot see OLD, so "you may
--   update your row but not its corp_id or role" and "the founder may set the
--   status but not the user_id" can only be said by a BEFORE UPDATE trigger.
--   The triggers are SECURITY INVOKER and act only when current_user is a
--   client role ('authenticated' / 'anon'). Every definer RPC that writes these
--   tables (corp_hire, corp_set_role, corp_set_primary, corp_join_accept) is
--   owned by postgres, so inside them current_user is 'postgres' and the
--   triggers stand aside — corp_set_role keeps working as the founder's way to
--   change a role.
--
-- REJECTED DESIGNS
--   * Re-admitting on a 'joined' request (a "self-heal" for a lost row).
--     Measured live 2026-09-17: 3 'joined' requests whose player is NOT a
--     member any more. That is somebody who left or was removed; re-admitting
--     them on boot would undo the removal. corp_join_accept on a 'joined'
--     request only RETURNS the membership that exists and never inserts.
--   * Trusting a corp_vault row as proof of membership (the client's member
--     self-heal). A vault row only proves membership at the time of the
--     deposit — and while this hole was open, not even that. Under 149 that
--     heal cannot write, and the client no longer pretends it did.
--   * Letting the applicant set 'withdrawn' only. cityHallApply and
--     corpRequest RE-FILE by upsert, which updates an existing row back to
--     'pending'. A re-application still needs the founder, so 'pending' is
--     allowed from the applicant; 'hired' and 'joined' never are.
--
-- Measured before this file (2026-09-17): 53 corp_members rows, every one a
-- founder row (8) or backed by a 'joined'/'hired' request — so nothing that
-- exists today depends on the self-insert path. No data is changed here.
--
-- Idempotent and re-runnable: drop-if-exists / create-or-replace throughout.
-- ════════════════════════════════════════════════════════════════════════════

-- ── corp_members ────────────────────────────────────────────────────────────
alter table public.corp_members enable row level security;

drop policy if exists cm_ins on public.corp_members;
-- The only client insert left: a founder's own row in their own corporation.
create policy cm_ins on public.corp_members for insert to authenticated
  with check (
    user_id = auth.uid()
    and exists (select 1 from public.corporations c
                 where c.id = corp_members.corp_id
                   and c.founder_id = auth.uid())
  );

drop policy if exists cm_upd on public.corp_members;
-- Own row only; which COLUMNS may change is the trigger's job (see header).
create policy cm_upd on public.corp_members for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- cm_sel (public roster) and cm_del (leave / founder removes) are unchanged,
-- restated so this file alone describes the table.
drop policy if exists cm_sel on public.corp_members;
create policy cm_sel on public.corp_members for select to authenticated
  using (true);
drop policy if exists cm_del on public.corp_members;
create policy cm_del on public.corp_members for delete to authenticated
  using (user_id = auth.uid()
         or exists (select 1 from public.corporations c
                     where c.id = corp_members.corp_id
                       and c.founder_id = auth.uid()));

create or replace function public._corp_members_guard()
returns trigger
language plpgsql
security invoker
set search_path = public
as $fn$
begin
  -- Definer RPCs (owner postgres) are the sanctioned writers; stand aside.
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;
  if new.user_id is distinct from old.user_id
     or new.corp_id is distinct from old.corp_id then
    raise exception 'corp_members: a membership cannot be moved to another player or corporation'
      using errcode = '42501';
  end if;
  if new.role is distinct from old.role then
    raise exception 'corp_members: positions are assigned by the founder (corp_set_role)'
      using errcode = '42501';
  end if;
  return new;
end $fn$;

drop trigger if exists corp_members_guard on public.corp_members;
create trigger corp_members_guard
  before update on public.corp_members
  for each row execute function public._corp_members_guard();

-- ── corp_requests ───────────────────────────────────────────────────────────
alter table public.corp_requests enable row level security;

drop policy if exists creq_ins on public.corp_requests;
-- An application is always born 'pending'. Filing one already 'hired' was a
-- one-statement self-hire.
create policy creq_ins on public.corp_requests for insert to authenticated
  with check (user_id = auth.uid() and status = 'pending');

drop policy if exists creq_upd on public.corp_requests;
-- WITH CHECK was `true`: the row could leave the caller's reach entirely.
-- Now the new row must still be the caller's own application or one to the
-- caller's corporation; the trigger decides which columns each side may set.
create policy creq_upd on public.corp_requests for update to authenticated
  using (user_id = auth.uid()
         or exists (select 1 from public.corporations c
                     where c.id = corp_requests.corp_id
                       and c.founder_id = auth.uid()))
  with check (user_id = auth.uid()
              or exists (select 1 from public.corporations c
                          where c.id = corp_requests.corp_id
                            and c.founder_id = auth.uid()));

drop policy if exists creq_sel on public.corp_requests;
create policy creq_sel on public.corp_requests for select to authenticated
  using (user_id = auth.uid()
         or exists (select 1 from public.corporations c
                     where c.id = corp_requests.corp_id
                       and c.founder_id = auth.uid()));
drop policy if exists creq_del on public.corp_requests;
create policy creq_del on public.corp_requests for delete to authenticated
  using (user_id = auth.uid()
         or exists (select 1 from public.corporations c
                     where c.id = corp_requests.corp_id
                       and c.founder_id = auth.uid()));

create or replace function public._corp_requests_guard()
returns trigger
language plpgsql
security invoker
set search_path = public
as $fn$
declare
  v_uid uuid := auth.uid();
  v_founder boolean;
begin
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;
  -- Nobody re-points an application: a founder hiring a player who never
  -- applied, or dragging a request into another corporation.
  if new.user_id is distinct from old.user_id
     or new.corp_id is distinct from old.corp_id then
    raise exception 'corp_requests: an application cannot be moved to another player or corporation'
      using errcode = '42501';
  end if;
  select exists (select 1 from public.corporations c
                  where c.id = old.corp_id and c.founder_id = v_uid)
    into v_founder;
  if v_founder then
    -- The founder decides. 'joined' is written by the RPCs only.
    if new.status is distinct from old.status
       and new.status not in ('pending', 'hired', 'denied') then
      raise exception 'corp_requests: the founder may set pending, hired or denied only'
        using errcode = '42501';
    end if;
    return new;
  end if;
  -- The applicant: may re-file (pending) or withdraw — never hire themselves,
  -- and may change the position asked for only while the application is
  -- pending, so a 'hired' request cannot be re-labelled 'founder' before it
  -- is accepted.
  if new.status is distinct from old.status
     and new.status not in ('pending', 'withdrawn') then
    raise exception 'corp_requests: only the founder can hire'
      using errcode = '42501';
  end if;
  if new.role is distinct from old.role and new.status <> 'pending' then
    raise exception 'corp_requests: the position can only change on a pending application'
      using errcode = '42501';
  end if;
  return new;
end $fn$;

drop trigger if exists corp_requests_guard on public.corp_requests;
create trigger corp_requests_guard
  before update on public.corp_requests
  for each row execute function public._corp_requests_guard();

-- ── corp_join_accept: the hired player's side ───────────────────────────────
create or replace function public.corp_join_accept(p_request_id uuid)
returns table(user_id uuid, user_name text, role text, corp_id uuid)
language plpgsql
security definer
set search_path = public
as $fn$
#variable_conflict use_column
declare
  v_uid uuid := auth.uid();
  r public.corp_requests%rowtype;
begin
  if v_uid is null then
    raise exception 'corp_join_accept: sign in first' using errcode = '42501';
  end if;
  if p_request_id is null then
    raise exception 'corp_join_accept: no application' using errcode = 'P0002';
  end if;
  select * into r from public.corp_requests q where q.id = p_request_id for update;
  if not found then
    raise exception 'corp_join_accept: no such application' using errcode = 'P0002';
  end if;
  if r.user_id <> v_uid then
    raise exception 'corp_join_accept: not your application' using errcode = '42501';
  end if;
  if r.status = 'hired' then
    -- (corp_id, user_id) is the key: a row in ANOTHER corporation is left
    -- exactly where it is — accepting never moves anybody.
    insert into public.corp_members (user_id, corp_id, user_name, role)
    values (r.user_id, r.corp_id, coalesce(nullif(r.user_name, ''), 'Member'), coalesce(r.role, 'member'))
    on conflict (corp_id, user_id) do nothing;
    update public.corp_requests q set status = 'joined' where q.id = r.id;
  elsif r.status <> 'joined' then
    raise exception 'corp_join_accept: this application has not been hired' using errcode = '42501';
  end if;
  -- 'joined' (corp_hire already wrote the row): report, never re-insert —
  -- see REJECTED DESIGNS for why a missing row is not restored here.
  return query
    select m.user_id, m.user_name, m.role, m.corp_id
      from public.corp_members m
     where m.user_id = r.user_id and m.corp_id = r.corp_id;
end $fn$;

revoke all on function public.corp_join_accept(uuid) from public, anon;
grant execute on function public.corp_join_accept(uuid) to authenticated;
revoke all on function public._corp_members_guard() from public, anon, authenticated;
revoke all on function public._corp_requests_guard() from public, anon, authenticated;

-- ── verify (read-only) ──────────────────────────────────────────────────────
select
  (select with_check from pg_policies where schemaname = 'public'
      and tablename = 'corp_members' and policyname = 'cm_ins')                     as cm_ins_check,       -- mentions founder_id
  (select with_check from pg_policies where schemaname = 'public'
      and tablename = 'corp_requests' and policyname = 'creq_ins')                  as creq_ins_check,     -- status = 'pending'
  (select with_check from pg_policies where schemaname = 'public'
      and tablename = 'corp_requests' and policyname = 'creq_upd')                  as creq_upd_check,     -- not 'true'
  (select count(*) from pg_trigger where not tgisinternal
      and tgname in ('corp_members_guard', 'corp_requests_guard'))                  as guard_triggers,     -- 2
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'corp_join_accept' and p.prosecdef) as join_accept_rpc,    -- 1
  (select count(*) from public.corp_members)                                        as corp_members_rows;  -- unchanged (53 on 2026-09-17)
