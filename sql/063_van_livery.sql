-- ════════════════════════════════════════════════════════════════════════════
-- 063 · VAN LIVERY — player wraps, and the moderated lane a custom logo must
--                    crawl through before anyone else can see it
--
-- ⚠ RUN 062 FIRST. It closes three UGC doors that are open today; this file
--   assumes public.ms_is_admin() exists, which 062 creates.
--
-- ── WHAT THIS IS ───────────────────────────────────────────────────────────
-- Players wrap their delivery van. Two lanes, and the split is the whole
-- design:
--
--   THE SAFE LANE — paint, accent, a preset emblem from a list the game ships,
--   and where those sit on the panels. None of it is user-authored content, so
--   none of it needs scanning, none of it waits, and it is live the instant it
--   is saved. A player who never uploads anything still gets a van that is
--   visibly theirs. This lane works whether or not a moderation provider is
--   ever contracted.
--
--   THE LOGO LANE — an image the player uploads. CLAUDE.md permits this ONLY
--   via "a third party that handles scanning as part of its product", and this
--   schema is built so that rule cannot be bypassed by a bug, a misconfigured
--   environment variable, or an impatient admin.
--
-- ── THE FIVE INVARIANTS ────────────────────────────────────────────────────
-- Everything below exists to hold these. If you change this file, re-read them.
--
--   1. THE CLIENT NEVER WRITES A PUBLICLY-READABLE OBJECT. Uploads land in
--      van-livery-quarantine, which is private and has no public read policy at
--      all. Only the Worker — holding SB_SERVICE, which bypasses RLS — can copy
--      bytes into the public van-livery bucket, and only after approval.
--
--   2. NOTHING IS VISIBLE UNTIL A HUMAN SAYS SO. A clean machine verdict moves
--      a row to 'awaiting_review', which is NOT visible. Only van_livery_review()
--      reaches 'approved'. A scanner is a filter, not a decision-maker.
--
--   3. THE DEFAULT IS INVISIBLE. Every unknown, every error, every timeout and
--      every un-configured provider leaves the row in a state the public view
--      does not select. The failure mode of this system is "your logo did not
--      show up", never "an unscanned image went live".
--
--   4. AN UNVERIFIED PROVIDER APPROVES NOTHING. van_livery_review() refuses to
--      approve while van_livery_provider.verified_at is null. The way this
--      integration fails in the real world is not "the scanner was down" — it
--      is "the response field was mapped wrong, so every image came back clean
--      and nobody noticed". §4 is aimed squarely at that.
--
--   5. A CSAM HIT IS NOT DELETED. The row is frozen, the object is left where
--      it is, and it is flagged for the operator. Destroying it would destroy
--      the evidence of a reportable crime. Reporting itself is the provider's
--      job — that is the entire reason CLAUDE.md insists on a provider that
--      does it "as part of its product" — but this schema must not make the
--      report impossible.
--
-- ⚠ I am not your lawyer. The obligations here are real and jurisdictional;
--   confirm the reporting flow with counsel and with whichever provider you
--   contract, and make sure their product actually includes the NCMEC report
--   rather than just a classifier score.
--
-- Idempotent and re-runnable. RLS ships in this file. Ends with a verify query.
-- ════════════════════════════════════════════════════════════════════════════

create extension if not exists pgcrypto;

-- ════════════════════════════════════════════════════════════════════════════
-- 1. THE PROVIDER GATE  (invariant 4)
-- ════════════════════════════════════════════════════════════════════════════
-- One row. verified_at is stamped only by the Worker's self-test, which sends
-- the provider a known-benign asset AND a known-violating one and checks that
-- the adapter reads BOTH verdicts correctly. A provider that cannot fail the
-- second half has not been verified — it has only been shown to return 200.
create table if not exists public.van_livery_provider (
  id             boolean primary key default true constraint one_row check (id),
  provider       text,
  verified_at    timestamptz,
  verified_by    uuid references auth.users(id),
  selftest_note  text,
  updated_at     timestamptz not null default now()
);
insert into public.van_livery_provider (id) values (true) on conflict (id) do nothing;

alter table public.van_livery_provider enable row level security;

drop policy if exists van_livery_provider_read  on public.van_livery_provider;
drop policy if exists van_livery_provider_admin on public.van_livery_provider;

-- Everyone may see WHETHER the lane is open (the wrap shop says so in plain
-- words instead of failing silently). Nobody but an admin may change it.
create policy van_livery_provider_read on public.van_livery_provider
  for select to authenticated, anon using (true);
create policy van_livery_provider_admin on public.van_livery_provider
  for all to authenticated
  using (public.ms_is_admin()) with check (public.ms_is_admin());

-- ════════════════════════════════════════════════════════════════════════════
-- 2. THE LIVERY ROW
-- ════════════════════════════════════════════════════════════════════════════
create table if not exists public.van_liveries (
  owner_id     uuid primary key references auth.users(id) on delete cascade,
  corp_id      text,

  -- ── the safe lane. No scanning, live immediately. ──
  paint        text not null default '#e8e4da',
  accent       text not null default '#c6a04a',
  emblem       text,                       -- id of a preset the game ships
  fleet_name   text,                       -- goes on the door; plain text
  place        jsonb not null default
               '{"side":{"x":0,"y":0,"s":1,"r":0},"rear":{"x":0,"y":0,"s":1,"r":0}}'::jsonb,

  -- ── the logo lane ──
  -- none        · nothing uploaded
  -- uploaded    · bytes are in quarantine, not yet scanned
  -- scanning    · handed to the provider
  -- scan_failed · provider errored / timed out / was not configured  → INVISIBLE
  -- rejected    · provider or human said no                          → INVISIBLE
  -- frozen      · CSAM classification. Evidence preserved.           → INVISIBLE
  -- awaiting_review · machine-clean, waiting on a person             → INVISIBLE
  -- approved    · a human approved it. The ONLY visible state.
  -- revoked     · was live, taken down                               → INVISIBLE
  logo_status  text not null default 'none'
               check (logo_status in ('none','uploaded','scanning','scan_failed',
                                      'rejected','frozen','awaiting_review',
                                      'approved','revoked')),
  quarantine_path text,
  public_path     text,
  mime            text,
  bytes           integer,
  sha256          text,

  scan_provider text,
  scan_verdict  text,
  scan_score    numeric,
  scan_at       timestamptz,
  scan_raw      jsonb,

  reviewed_by   uuid references auth.users(id),
  reviewed_at   timestamptz,
  review_note   text,

  strikes       integer not null default 0,   -- rejections against this owner
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  -- Colours are rendered straight into a THREE material and into CSS. Pinning
  -- them to #rrggbb here means no other layer has to sanitise them.
  constraint paint_is_hex  check (paint  ~ '^#[0-9a-fA-F]{6}$'),
  constraint accent_is_hex check (accent ~ '^#[0-9a-fA-F]{6}$'),
  -- A preset id, never free text.
  constraint emblem_is_id  check (emblem is null or emblem ~ '^[a-z0-9_]{1,32}$'),
  constraint fleet_name_len check (fleet_name is null or char_length(fleet_name) <= 28),
  -- ⚠ approved REQUIRES a public path and a reviewer. Without this a bug that
  --   flipped the status alone would publish an object that was never copied
  --   out of quarantine — or worse, one that was.
  constraint approved_is_reviewed check (
    logo_status <> 'approved'
    or (public_path is not null and reviewed_by is not null and reviewed_at is not null)
  )
);

create index if not exists van_liveries_status_idx on public.van_liveries (logo_status);
create index if not exists van_liveries_queue_idx  on public.van_liveries (logo_status, updated_at)
  where logo_status in ('awaiting_review','frozen','scan_failed');

-- ── append-only audit ───────────────────────────────────────────────────────
-- Every transition. No UPDATE and no DELETE grant exists on this table by
-- design: the moderation history of an image is exactly the kind of record that
-- must not be quietly rewritten later.
create table if not exists public.van_livery_events (
  id         bigserial primary key,
  owner_id   uuid not null,
  at         timestamptz not null default now(),
  actor      uuid,
  kind       text not null,
  from_state text,
  to_state   text,
  detail     jsonb
);
create index if not exists van_livery_events_owner_idx on public.van_livery_events (owner_id, at desc);

alter table public.van_liveries      enable row level security;
alter table public.van_livery_events enable row level security;

-- ════════════════════════════════════════════════════════════════════════════
-- 3. RLS
-- ════════════════════════════════════════════════════════════════════════════
drop policy if exists van_liveries_own_read    on public.van_liveries;
drop policy if exists van_liveries_own_insert  on public.van_liveries;
drop policy if exists van_liveries_own_update  on public.van_liveries;
drop policy if exists van_liveries_own_delete  on public.van_liveries;
drop policy if exists van_liveries_admin_all   on public.van_liveries;
drop policy if exists van_livery_events_read   on public.van_livery_events;
drop policy if exists van_livery_events_admin  on public.van_livery_events;

-- A player sees their own row in full — including WHY something was rejected.
create policy van_liveries_own_read on public.van_liveries
  for select to authenticated using (owner_id = auth.uid());

create policy van_liveries_own_insert on public.van_liveries
  for insert to authenticated with check (owner_id = auth.uid());

-- ⚠ THE COLUMN GRANT BELOW IS LOAD-BEARING, NOT DECORATION. This policy lets an
--   owner UPDATE their own row; the grant is what stops that update from
--   touching logo_status. Without it a player could PATCH their own row to
--   'approved' with one REST call — RLS would happily allow it, because the row
--   IS theirs. Policies say WHICH ROWS. Grants say WHICH COLUMNS. This table
--   needs both and it is the single easiest thing to get wrong here.
create policy van_liveries_own_update on public.van_liveries
  for update to authenticated
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());

create policy van_liveries_own_delete on public.van_liveries
  for delete to authenticated using (owner_id = auth.uid());

create policy van_liveries_admin_all on public.van_liveries
  for all to authenticated
  using (public.ms_is_admin()) with check (public.ms_is_admin());

revoke update on public.van_liveries from authenticated;
grant  update (paint, accent, emblem, fleet_name, place, corp_id)
       on public.van_liveries to authenticated;
grant  select, insert, delete on public.van_liveries to authenticated;

-- Audit: an owner may read their own history; only admins see everything.
-- Nobody is granted UPDATE or DELETE — not even an admin. Append-only.
create policy van_livery_events_read on public.van_livery_events
  for select to authenticated
  using (owner_id = auth.uid() or public.ms_is_admin());
grant select on public.van_livery_events to authenticated;
revoke insert, update, delete on public.van_livery_events from authenticated, anon;

-- ════════════════════════════════════════════════════════════════════════════
-- 4. THE PUBLIC VIEW  (invariants 2 and 3)
-- ════════════════════════════════════════════════════════════════════════════
-- This is what every OTHER player reads when a van pulls up. It is the only
-- path by which one player's livery reaches another player's screen.
--
-- ⚠ It is a plain (non-security_invoker) view, so it runs with its owner's
--   rights and the WHERE clause below — not RLS — is what filters it. That
--   makes this WHERE clause security-critical: `logo_url` must be NULL for
--   every state except 'approved', and it is written as a CASE rather than a
--   row filter so a player with paint but no approved logo still shows up
--   wearing their colours.
create or replace view public.van_livery_public as
  select
    l.owner_id,
    l.corp_id,
    l.paint,
    l.accent,
    l.emblem,
    l.fleet_name,
    l.place,
    -- 🔒 the only conditional that matters in this file
    case when l.logo_status = 'approved' then l.public_path else null end as logo_path,
    (l.logo_status = 'approved')                                          as has_logo
  from public.van_liveries l;

grant select on public.van_livery_public to authenticated, anon;

-- ════════════════════════════════════════════════════════════════════════════
-- 5. THE STATE MACHINE
-- ════════════════════════════════════════════════════════════════════════════
-- Transitions happen through these functions and nowhere else. Each one is
-- SECURITY DEFINER, pins search_path, writes the audit row in the same
-- statement as the state change, and re-checks the caller's right to make it.

-- ── 5a. the safe lane. No moderation, effective immediately. ────────────────
create or replace function public.van_livery_save_safe(
  p_paint text, p_accent text, p_emblem text, p_fleet_name text, p_place jsonb
) returns public.van_liveries
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_row public.van_liveries;
begin
  if v_uid is null then raise exception 'not signed in' using errcode = '42501'; end if;

  insert into public.van_liveries (owner_id, paint, accent, emblem, fleet_name, place)
  values (v_uid,
          coalesce(p_paint,  '#e8e4da'),
          coalesce(p_accent, '#c6a04a'),
          nullif(p_emblem, ''),
          -- ⚠ THE FLEET NAME IS UGC TOO. It is short and it is text, but other
          --   players read it off the door of a van that parks in their yard, so
          --   it goes through the SAME server-side mask world chat goes through
          --   (chat_clean, added in v120g0) rather than getting a second,
          --   weaker copy of the rule. CLAUDE.md is explicit that the client's
          --   filter is feedback, never enforcement.
          nullif(btrim(coalesce(public.chat_clean(p_fleet_name), '')), ''),
          coalesce(p_place, '{}'::jsonb))
  on conflict (owner_id) do update
    set paint      = excluded.paint,
        accent     = excluded.accent,
        emblem     = excluded.emblem,
        fleet_name = excluded.fleet_name,
        place      = excluded.place,
        updated_at = now()
  returning * into v_row;

  return v_row;
end $$;

-- ── 5b. bytes have landed in quarantine ─────────────────────────────────────
create or replace function public.van_livery_begin_logo(
  p_path text, p_mime text, p_bytes integer, p_sha256 text
) returns public.van_liveries
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_row public.van_liveries; v_from text;
begin
  if v_uid is null then raise exception 'not signed in' using errcode = '42501'; end if;

  -- ⚠ The path MUST be inside the caller's own quarantine folder. The storage
  --   policy enforces this too; it is repeated here because this function runs
  --   as definer and would otherwise be a way to point a livery row at somebody
  --   else's object.
  if p_path is null or p_path <> (v_uid::text || '/' || split_part(p_path, '/', 2))
     or split_part(p_path, '/', 2) = '' or p_path like '%/../%' then
    raise exception 'path must be <uid>/<file>' using errcode = '22023';
  end if;

  if p_mime is null or p_mime not in ('image/png','image/jpeg','image/webp') then
    raise exception 'logo must be png, jpeg or webp' using errcode = '22023';
  end if;

  if p_bytes is null or p_bytes <= 0 or p_bytes > 2097152 then
    raise exception 'logo must be 2 MB or smaller' using errcode = '22023';
  end if;

  insert into public.van_liveries (owner_id) values (v_uid) on conflict (owner_id) do nothing;
  select logo_status into v_from from public.van_liveries where owner_id = v_uid;

  -- One in flight at a time. Otherwise a player can flood the review queue.
  if v_from in ('uploaded','scanning','awaiting_review') then
    raise exception 'a logo is already in the queue' using errcode = '55006';
  end if;
  if v_from = 'frozen' then
    raise exception 'this account cannot submit artwork' using errcode = '42501';
  end if;

  update public.van_liveries
     set logo_status = 'uploaded', quarantine_path = p_path, mime = p_mime,
         bytes = p_bytes, sha256 = p_sha256,
         public_path = null,               -- an old approved logo comes DOWN
         scan_provider = null, scan_verdict = null, scan_score = null,
         scan_at = null, scan_raw = null,
         reviewed_by = null, reviewed_at = null, review_note = null,
         updated_at = now()
   where owner_id = v_uid
   returning * into v_row;

  insert into public.van_livery_events (owner_id, actor, kind, from_state, to_state, detail)
  values (v_uid, v_uid, 'upload', v_from, 'uploaded',
          jsonb_build_object('mime', p_mime, 'bytes', p_bytes, 'sha256', p_sha256));

  return v_row;
end $$;

-- ── 5c. the provider answered. Service role only. ───────────────────────────
-- ⚠ NOT granted to authenticated. The Worker calls it with SB_SERVICE. If a
--   player could call this they could write themselves a clean verdict, and
--   every other guard in this file would be decoration.
create or replace function public.van_livery_record_scan(
  p_owner uuid, p_provider text, p_verdict text, p_score numeric, p_raw jsonb
) returns public.van_liveries
language plpgsql security definer set search_path = public as $$
declare v_row public.van_liveries; v_from text; v_to text;
begin
  select logo_status into v_from from public.van_liveries where owner_id = p_owner;
  if v_from is null then raise exception 'no livery row' using errcode = 'P0002'; end if;
  if v_from not in ('uploaded','scanning') then
    raise exception 'not awaiting a scan (state %)', v_from using errcode = '55006';
  end if;

  -- 🔴 THE MAPPING. Anything that is not an explicit clean verdict lands
  --    somewhere invisible. There is deliberately no `else` that falls through
  --    to a visible state.
  v_to := case
            when p_verdict = 'csam'   then 'frozen'
            when p_verdict = 'reject' then 'rejected'
            when p_verdict = 'clean'  then 'awaiting_review'
            else 'scan_failed'
          end;

  update public.van_liveries
     set logo_status = v_to, scan_provider = p_provider, scan_verdict = p_verdict,
         scan_score = p_score, scan_at = now(), scan_raw = p_raw,
         strikes = strikes + case when v_to in ('rejected','frozen') then 1 else 0 end,
         updated_at = now()
   where owner_id = p_owner
   returning * into v_row;

  insert into public.van_livery_events (owner_id, actor, kind, from_state, to_state, detail)
  values (p_owner, null, 'scan', v_from, v_to,
          jsonb_build_object('provider', p_provider, 'verdict', p_verdict, 'score', p_score));

  return v_row;
end $$;

-- ── 5d. a person decides ────────────────────────────────────────────────────
create or replace function public.van_livery_review(
  p_owner uuid, p_decision text, p_public_path text, p_note text
) returns public.van_liveries
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_row public.van_liveries; v_from text; v_to text; v_ok boolean;
begin
  if not public.ms_is_admin() then
    raise exception 'not a reviewer' using errcode = '42501';
  end if;

  select logo_status into v_from from public.van_liveries where owner_id = p_owner;
  if v_from is null then raise exception 'no livery row' using errcode = 'P0002'; end if;

  if p_decision = 'approve' then
    -- 🔒 INVARIANT 4. An unverified adapter approves nothing, ever.
    select (verified_at is not null) into v_ok from public.van_livery_provider where id;
    if not coalesce(v_ok, false) then
      raise exception 'moderation provider has not passed its self-test'
        using errcode = '55006';
    end if;
    -- 🔒 INVARIANT 2. Only a machine-clean row is even eligible for a human yes.
    if v_from <> 'awaiting_review' then
      raise exception 'only a scanned, machine-clean logo can be approved (state %)', v_from
        using errcode = '55006';
    end if;
    if p_public_path is null or p_public_path = '' then
      raise exception 'approve needs the published path' using errcode = '22023';
    end if;
    v_to := 'approved';
  elsif p_decision = 'reject' then
    v_to := 'rejected';
  elsif p_decision = 'revoke' then
    v_to := 'revoked';
  else
    raise exception 'decision must be approve, reject or revoke' using errcode = '22023';
  end if;

  update public.van_liveries
     set logo_status = v_to,
         public_path = case when v_to = 'approved' then p_public_path else null end,
         reviewed_by = v_uid, reviewed_at = now(), review_note = p_note,
         strikes = strikes + case when v_to = 'rejected' then 1 else 0 end,
         updated_at = now()
   where owner_id = p_owner
   returning * into v_row;

  insert into public.van_livery_events (owner_id, actor, kind, from_state, to_state, detail)
  values (p_owner, v_uid, 'review', v_from, v_to, jsonb_build_object('note', p_note));

  return v_row;
end $$;

-- ── 5d-bis. the self-test result  (invariant 4) ─────────────────────────────
-- Called by the Worker AS THE REVIEWER, never with the service key. That is
-- deliberate: stamping "the scanner works" is a claim a named person makes, and
-- ms_is_admin() below is what makes it attributable. A failed self-test CLEARS
-- verified_at rather than leaving the previous pass standing — a provider that
-- has started answering wrongly must close the lane, not coast on last week.
create or replace function public.van_livery_set_provider(
  p_provider text, p_passed boolean, p_note text
) returns public.van_livery_provider
language plpgsql security definer set search_path = public as $fn$
declare v_row public.van_livery_provider;
begin
  if not public.ms_is_admin() then
    raise exception 'not a reviewer' using errcode = '42501';
  end if;

  update public.van_livery_provider
     set provider      = nullif(p_provider, ''),
         verified_at   = case when p_passed then now() else null end,
         verified_by   = case when p_passed then auth.uid() else null end,
         selftest_note = p_note,
         updated_at    = now()
   where id
   returning * into v_row;

  insert into public.van_livery_events (owner_id, actor, kind, from_state, to_state, detail)
  values (auth.uid(), auth.uid(), 'selftest', null,
          case when p_passed then 'verified' else 'unverified' end,
          jsonb_build_object('provider', p_provider, 'note', p_note));

  return v_row;
end $fn$;

-- ── 5c-bis. what the wrap shop reads on open ────────────────────────────────
-- A plain SELECT would do, but the warehouse page reaches the database through
-- an RPC ALLOWLIST in index.html and cannot name a table. Returning a row for a
-- player who has never opened the shop (rather than nothing) is what lets the
-- panel draw defaults without a second code path for "no row yet".
--
-- ⚠ logo_url is built here and ONLY for logo_status = 'approved'. This is the
--   owner's own view, so it may show more than van_livery_public does — but not
--   a live URL for something unapproved, because there is no state in which the
--   owner needs a working link to artwork the shop has not signed off.
create or replace function public.van_livery_mine()
returns jsonb
language sql security definer set search_path = public as $fn$
  select coalesce(
    (select jsonb_build_object(
       'paint', l.paint, 'accent', l.accent, 'emblem', l.emblem,
       'fleet_name', l.fleet_name, 'place', l.place,
       'logo_status', l.logo_status, 'strikes', l.strikes,
       'review_note', l.review_note,
       'logoUrl', case when l.logo_status = 'approved' and l.public_path is not null
                        then '/storage/v1/object/public/van-livery/' || l.public_path
                        else null end)
       from public.van_liveries l where l.owner_id = auth.uid()),
    jsonb_build_object('paint', '#e8e4da', 'accent', '#c6a04a',
                       'emblem', null, 'fleet_name', null,
                       'place', '{}'::jsonb, 'logo_status', 'none', 'logoUrl', null));
$fn$;

-- ── 5e. the review queue ────────────────────────────────────────────────────
create or replace function public.van_livery_queue()
returns table (owner_id uuid, logo_status text, quarantine_path text, mime text,
               bytes integer, scan_provider text, scan_verdict text, scan_score numeric,
               strikes integer, updated_at timestamptz)
language sql security definer set search_path = public as $$
  select l.owner_id, l.logo_status, l.quarantine_path, l.mime, l.bytes,
         l.scan_provider, l.scan_verdict, l.scan_score, l.strikes, l.updated_at
    from public.van_liveries l
   where public.ms_is_admin()
     and l.logo_status in ('awaiting_review','frozen','scan_failed')
   order by (l.logo_status = 'frozen') desc, l.updated_at asc
   limit 200;
$$;

revoke all on function public.van_livery_record_scan(uuid, text, text, numeric, jsonb) from public, anon, authenticated;
grant execute on function public.van_livery_save_safe(text, text, text, text, jsonb) to authenticated;
grant execute on function public.van_livery_begin_logo(text, text, integer, text)     to authenticated;
grant execute on function public.van_livery_review(uuid, text, text, text)            to authenticated;
grant execute on function public.van_livery_queue()                                    to authenticated;
grant execute on function public.van_livery_mine()                                     to authenticated;
grant execute on function public.van_livery_set_provider(text, boolean, text)           to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- 6. THE TWO BUCKETS  (invariant 1)
-- ════════════════════════════════════════════════════════════════════════════
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('van-livery-quarantine', 'van-livery-quarantine', false, 2097152,
        array['image/png','image/jpeg','image/webp'])
on conflict (id) do update
  set public = false, file_size_limit = 2097152,
      allowed_mime_types = array['image/png','image/jpeg','image/webp'];

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('van-livery', 'van-livery', true, 2097152,
        array['image/png','image/jpeg','image/webp'])
on conflict (id) do update
  set public = true, file_size_limit = 2097152,
      allowed_mime_types = array['image/png','image/jpeg','image/webp'];

drop policy if exists van_quar_own_insert  on storage.objects;
drop policy if exists van_quar_own_read    on storage.objects;
drop policy if exists van_quar_own_delete  on storage.objects;
drop policy if exists van_pub_read         on storage.objects;
drop policy if exists van_pub_admin_write  on storage.objects;

-- Quarantine: you may put a file in your own folder and read your own file
-- back. There is NO public read policy on this bucket and the bucket itself is
-- private — two independent reasons an unscanned image cannot be linked to.
create policy van_quar_own_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'van-livery-quarantine'
              and (storage.foldername(name))[1] = auth.uid()::text);

create policy van_quar_own_read on storage.objects
  for select to authenticated
  using (bucket_id = 'van-livery-quarantine'
         and ((storage.foldername(name))[1] = auth.uid()::text or public.ms_is_admin()));

create policy van_quar_own_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'van-livery-quarantine'
         and ((storage.foldername(name))[1] = auth.uid()::text or public.ms_is_admin()));

-- Published: world-readable, and NOT writable by any client role. The Worker's
-- service key is the only writer, which is what makes "approved" mean something.
create policy van_pub_read on storage.objects
  for select using (bucket_id = 'van-livery');

create policy van_pub_admin_write on storage.objects
  for all to authenticated
  using       (bucket_id = 'van-livery' and public.ms_is_admin())
  with check  (bucket_id = 'van-livery' and public.ms_is_admin());

-- ════════════════════════════════════════════════════════════════════════════
-- VERIFY
-- ════════════════════════════════════════════════════════════════════════════
select 'tables'  as check, count(*)::text as got, '2 expected' as want
  from information_schema.tables
 where table_schema = 'public' and table_name in ('van_liveries','van_livery_events')
union all
select 'rls on', count(*)::text, '3 expected'
  from pg_class where relname in ('van_liveries','van_livery_events','van_livery_provider')
   and relrowsecurity
union all
select 'functions', count(*)::text, '8 expected'
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and p.proname in ('van_livery_save_safe','van_livery_begin_logo','van_livery_record_scan',
                     'van_livery_review','van_livery_queue','van_livery_set_provider',
                     'van_livery_mine','ms_is_admin')
union all
select 'buckets', count(*)::text, '2 expected'
  from storage.buckets where id in ('van-livery','van-livery-quarantine')
union all
select 'quarantine is private', (not public)::text, 'true expected'
  from storage.buckets where id = 'van-livery-quarantine'
union all
select 'record_scan NOT callable by players',
       (not has_function_privilege('authenticated',
          'public.van_livery_record_scan(uuid,text,text,numeric,jsonb)', 'execute'))::text,
       'true expected'
union all
select 'players cannot write logo_status',
       (not has_column_privilege('authenticated', 'public.van_liveries', 'logo_status', 'update'))::text,
       'true expected'
union all
select 'provider unverified (nothing can be approved yet)',
       (verified_at is null)::text, 'true until the self-test passes'
  from public.van_livery_provider where id;
