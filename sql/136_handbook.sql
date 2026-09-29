-- 136_handbook.sql — the Player's Handbook as a live, admin-authored document.
--
-- ⚠⚠ ALREADY APPLIED TO ktsiasyjusesawtrwrjc. DO NOT RE-RUN THE FUNCTION HALF.
--     Verified 2026-09-15: handbook_doc exists (0 rows — never published, so
--     readers correctly fall back to the repo handbook.json), is_handbook_admin()
--     exists, 4 policies on handbook_doc, storage bucket 'handbook' exists and is
--     public. The hand-off document HANDOFF-HANDBOOK-2026-09-13.md says "NOT
--     APPLIED" and is STALE — somebody applied it after that was written.
--
-- 🔴 THE LIVE handbook_publish RETURNS  TABLE(ok boolean, status text,
--    new_version integer)  and public/handbook/index.html reads exactly those
--    three fields (line ~796: {ok: !!row.ok, status: row.status,
--    version: row.new_version}). An earlier attempt to re-apply this file with a
--    different OUT shape was refused by Postgres with "cannot change return type
--    of existing function", which is the only reason the page still works. If you
--    ever need to change that function, change the PAGE in the same commit.
--
-- ⚠ RENUMBERED FROM 132. This file was written as 132_handbook.sql on branch
--   claude/hopeful-rubin-6arwkd; 132 is 132_node_inventory.sql in this tree.
--
-- Kept in /sql so the schema lives with every other migration and can be
-- re-applied to a fresh environment. On a fresh environment it is safe as
-- written; here, the objects already exist.
--
-- Owner (2026-09-13): "Make it where only admins can edit the book. Make it
-- where I can add photos and everything."
--
-- The handbook at /handbook/ shipped reading a static handbook.json out of the
-- repo, with edits kept in the editor's own localStorage. That made "only
-- admins can edit" meaningless — a localStorage edit is private to one browser,
-- so there was nothing to protect and nothing to publish. This file gives the
-- book a server-side home:
--
--   handbook_doc          one row holding the whole book as jsonb
--   is_handbook_admin()   the single allowlist both the table and the bucket use
--   storage bucket        'handbook', public to read, admin-only to write
--
-- READS ARE OPEN, INCLUDING TO ANON. A rules book that a signed-out player
-- cannot read is not a rules book. WRITES ARE ADMIN-ONLY, enforced here in RLS
-- — the page's own isAdmin() check only decides whether to draw the edit UI and
-- is not, and must never be treated as, the security boundary.
--
-- Idempotent and re-runnable. Apply by hand in the Supabase SQL editor for
-- project ktsiasyjusesawtrwrjc.

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. The admin allowlist, in ONE place
-- ═══════════════════════════════════════════════════════════════════════════
-- Mirrors ADMIN_EMAILS in public/index.html. Kept as a function rather than
-- inlined into each policy so that adding an admin is one `create or replace`
-- instead of a hunt through four policies that must agree — the storage
-- policies below and the table policies above are the same rule, and a rule
-- written down twice is a rule that eventually disagrees with itself.
--
-- SECURITY DEFINER + a pinned search_path: it reads only the JWT, never a
-- table, so there is no RLS recursion risk here (unlike is_community_member).
create or replace function public.is_handbook_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select lower(coalesce(auth.jwt() ->> 'email', '')) in (
    'richaegisop@gmail.com',
    'play@mythicsoa.com',
    'dev@mythicspellbook.com'
  );
$$;

revoke all on function public.is_handbook_admin() from public;
grant execute on function public.is_handbook_admin() to anon, authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. The document
-- ═══════════════════════════════════════════════════════════════════════════
create table if not exists public.handbook_doc (
  id            text        primary key default 'main',
  doc           jsonb       not null,
  version       integer     not null default 1,
  updated_at    timestamptz not null default now(),
  updated_by    uuid,
  updated_email text
);

comment on table public.handbook_doc is
  'The Player''s Handbook. One row (id=''main''). Read by everyone, written only by is_handbook_admin().';

-- `version` exists for optimistic concurrency, not for history. The client
-- sends the version it loaded; the UPDATE matches on it and touches zero rows
-- if somebody else published in between, so the second admin is told to reload
-- instead of silently overwriting the first. Without this, two admins with the
-- book open means whoever clicks Publish last wins and the other's work is
-- gone with no error anywhere.

alter table public.handbook_doc enable row level security;

-- READ: everyone, signed in or not.
drop policy if exists hb_doc_sel on public.handbook_doc;
create policy hb_doc_sel on public.handbook_doc
  for select to anon, authenticated
  using (true);

-- WRITE: admins only. Three separate policies because Postgres needs one per
-- command; `with check` on insert/update is what actually stops a non-admin
-- from writing a row, and `using` on update/delete is what stops them
-- targeting an existing one. Both halves are required on UPDATE — a policy
-- with only one of them is the classic hole that reviews miss.
drop policy if exists hb_doc_ins on public.handbook_doc;
create policy hb_doc_ins on public.handbook_doc
  for insert to authenticated
  with check (public.is_handbook_admin());

drop policy if exists hb_doc_upd on public.handbook_doc;
create policy hb_doc_upd on public.handbook_doc
  for update to authenticated
  using (public.is_handbook_admin())
  with check (public.is_handbook_admin());

drop policy if exists hb_doc_del on public.handbook_doc;
create policy hb_doc_del on public.handbook_doc
  for delete to authenticated
  using (public.is_handbook_admin());

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. Publishing, as an RPC
-- ═══════════════════════════════════════════════════════════════════════════
-- The client could upsert the table directly, but then it has to get the
-- version check, the stamping and the insert-or-update branch right on every
-- call site. One function does it once and returns the new version.
--
-- NOT security definer: it runs as the caller so the RLS policies above still
-- apply. A non-admin calling this gets zero rows written and the 'denied'
-- answer, not a bypass.
create or replace function public.handbook_publish(p_doc jsonb, p_version integer)
returns table (ok boolean, status text, new_version integer)
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_cur integer;
  v_new integer;
begin
  if not public.is_handbook_admin() then
    return query select false, 'denied'::text, null::integer;
    return;
  end if;

  select version into v_cur from public.handbook_doc where id = 'main';

  if v_cur is null then
    insert into public.handbook_doc (id, doc, version, updated_at, updated_by, updated_email)
    values ('main', p_doc, 1, now(), auth.uid(), auth.jwt() ->> 'email')
    on conflict (id) do nothing;
    -- A racing first publish lands on the conflict and writes nothing; say so
    -- rather than reporting a success the caller's copy does not reflect.
    if not found then
      return query select false, 'conflict'::text, (select version from public.handbook_doc where id = 'main');
      return;
    end if;
    return query select true, 'created'::text, 1;
    return;
  end if;

  -- p_version null means "I did not load a version, overwrite anyway". The
  -- editor only sends that for a first publish over a repo-loaded book.
  if p_version is not null and p_version <> v_cur then
    return query select false, 'conflict'::text, v_cur;
    return;
  end if;

  v_new := v_cur + 1;
  update public.handbook_doc
     set doc = p_doc, version = v_new, updated_at = now(),
         updated_by = auth.uid(), updated_email = auth.jwt() ->> 'email'
   where id = 'main' and version = v_cur;

  if not found then
    return query select false, 'conflict'::text, (select version from public.handbook_doc where id = 'main');
    return;
  end if;

  return query select true, 'updated'::text, v_new;
end $$;

revoke all on function public.handbook_publish(jsonb, integer) from public, anon;
grant execute on function public.handbook_publish(jsonb, integer) to authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 4. The image bucket
-- ═══════════════════════════════════════════════════════════════════════════
-- Public to read so an <img src> needs no token and the CDN can cache it;
-- writable ONLY by is_handbook_admin(). That write policy is the whole reason
-- this is allowed to exist at all: CLAUDE.md rules image upload out of scope
-- because hosting player-generated images carries a CSAM detection and
-- reporting obligation. This bucket cannot receive player uploads — three
-- named accounts can write to it and every other caller is refused by RLS —
-- so it is first-party asset storage, not a UGC surface. Do NOT relax this
-- policy to `authenticated` without redoing that analysis.
insert into storage.buckets (id, name, public)
values ('handbook', 'handbook', true)
on conflict (id) do update set public = true;

drop policy if exists "handbook art read"   on storage.objects;
drop policy if exists "handbook art insert" on storage.objects;
drop policy if exists "handbook art update" on storage.objects;
drop policy if exists "handbook art delete" on storage.objects;

create policy "handbook art read" on storage.objects
  for select to anon, authenticated
  using (bucket_id = 'handbook');

create policy "handbook art insert" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'handbook' and public.is_handbook_admin());

create policy "handbook art update" on storage.objects
  for update to authenticated
  using (bucket_id = 'handbook' and public.is_handbook_admin())
  with check (bucket_id = 'handbook' and public.is_handbook_admin());

create policy "handbook art delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'handbook' and public.is_handbook_admin());

-- ═══════════════════════════════════════════════════════════════════════════
-- verify
-- ═══════════════════════════════════════════════════════════════════════════
select 'admin fn' as check, public.is_handbook_admin() as you_are_admin, auth.jwt() ->> 'email' as as_email;
select 'table'    as check, count(*) as rows, coalesce(max(version), 0) as version from public.handbook_doc;
select 'policies' as check, count(*) as n from pg_policies
 where schemaname = 'public' and tablename = 'handbook_doc';
select 'bucket'   as check, public as is_public from storage.buckets where id = 'handbook';
select 'storage policies' as check, count(*) as n from pg_policies
 where schemaname = 'storage' and tablename = 'objects' and policyname like 'handbook art%';
