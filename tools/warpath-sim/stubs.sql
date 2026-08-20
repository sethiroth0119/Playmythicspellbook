-- ─────────────────────────────────────────────────────────────────────────────
-- 🧪 Local stand-ins for the pieces of Supabase the WARPATH migration leans on.
--
-- The Milestone 1 test suite documents a `_testctx` table for switching
-- auth.uid(). That is fine for ONE session and catastrophic for four: a shared
-- table means four concurrent connections overwrite each other's identity, and
-- every player silently becomes whoever wrote last. This project has already
-- been burned by exactly that once. So auth.uid() here reads a SESSION-LOCAL
-- GUC instead — request.jwt.claim.sub, the same setting PostgREST populates —
-- and every bot in tools/warpath-sim/sim.mjs holds its own connection.
--
-- set_uid() is kept with the same signature so supabase/tests/*.sql still runs
-- unchanged; it just writes the GUC now.
-- ─────────────────────────────────────────────────────────────────────────────

create schema if not exists auth;

do $$ begin create role authenticated; exception when duplicate_object then null; end $$;
do $$ begin create role anon;          exception when duplicate_object then null; end $$;
do $$ begin create role service_role;  exception when duplicate_object then null; end $$;
grant usage on schema public to authenticated, anon, service_role;

create table if not exists auth.users (
  id         uuid primary key default gen_random_uuid(),
  email      text unique,
  created_at timestamptz not null default now()
);

-- Session-local identity. `false` = session scope, so it survives the
-- transaction and is invisible to every other connection.
create or replace function public.set_uid(p uuid) returns void
language sql security definer as $$
  select set_config('request.jwt.claim.sub', coalesce(p::text, ''), false)::void
$$;

create or replace function auth.uid() returns uuid
language sql stable security definer as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
-- Supabase grants these; the security-definer RPCs would work without them,
-- but the harness asserts its own identity per connection and needs to ask.
grant usage on schema auth to authenticated, anon, service_role;
grant execute on function auth.uid() to authenticated, anon, service_role;

-- ── Bank of Ethos: the two objects warpath_enter() debits and journals to.
--    Real definitions live at api.sql:231 and api.sql:281; these are the
--    columns the Warpath actually touches.
create table if not exists public.bank_of_ethos (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  balance    numeric not null default 0,
  aza        numeric not null default 0,
  resources  jsonb   not null default '{}'::jsonb,
  opened_at  timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists public.boe_ledger (
  id           bigint generated always as identity primary key,
  user_id      uuid not null references auth.users(id) on delete cascade,
  ts           timestamptz not null default now(),
  kind         text not null,
  cinder       numeric not null default 0,
  aza          numeric not null default 0,
  note         text,
  counterparty text
);
