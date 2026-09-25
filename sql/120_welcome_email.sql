-- ════════════════════════════════════════════════════════════════════════════
-- 120 · WELCOME EMAIL (v121v62)
--
-- One welcome mail per account, sent by the Worker through Cloudflare Email
-- Sending, from "Hidn Studios".
--
-- The whole job of this file is TO SEND EXACTLY ONE. Two things make that hard:
--
--   1. Two tabs. The client fires on sign-in, and a player with the game open
--      twice signs in twice. So the claim is an INSERT with a primary key, not
--      a read-then-write — Postgres decides the winner, not the client.
--
--   2. THE ROLL-OUT. Every existing player signs in again eventually, and with
--      an empty table each of them looks brand new. The backfill at the bottom
--      is what stops ~every account on the game receiving a "welcome" mail the
--      day this ships. It is not optional and it must run in this transaction.
--
-- Retry is deliberate but bounded: a row claimed but never marked sent may be
-- re-claimed after 10 minutes, so a Cloudflare outage delays the mail instead
-- of losing it. A row that HAS been sent is never claimable again.
-- ════════════════════════════════════════════════════════════════════════════

begin;

create table if not exists public.welcome_emails (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  email      text,
  claimed_at timestamptz not null default now(),
  sent_at    timestamptz
);

alter table public.welcome_emails enable row level security;

-- A player may see their own record and nothing else. No insert/update/delete
-- policy exists: the only writer is the SECURITY DEFINER pair below.
drop policy if exists welcome_emails_self_read on public.welcome_emails;
create policy welcome_emails_self_read on public.welcome_emails
  for select to authenticated using (user_id = auth.uid());

-- ── claim ───────────────────────────────────────────────────────────────────
-- Returns true to EXACTLY ONE caller. The `on conflict do update ... where`
-- is the retry window: it fires only for a row that was claimed but never
-- sent, and only once ten minutes have passed. A sent row matches neither
-- branch, so `returning` yields nothing and the answer is false.
create or replace function public.claim_welcome_email()
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_won boolean;
begin
  if v_uid is null then return false; end if;

  insert into public.welcome_emails (user_id, email, claimed_at)
  values (v_uid, (select u.email from auth.users u where u.id = v_uid), now())
  on conflict (user_id) do update
     set claimed_at = now()
   where public.welcome_emails.sent_at is null
     and public.welcome_emails.claimed_at < now() - interval '10 minutes'
  returning true into v_won;

  return coalesce(v_won, false);
end
$$;

-- ── mark sent ───────────────────────────────────────────────────────────────
create or replace function public.mark_welcome_email_sent()
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then return; end if;
  update public.welcome_emails
     set sent_at = now()
   where user_id = auth.uid()
     and sent_at is null;
end
$$;

-- ── grants ──────────────────────────────────────────────────────────────────
-- ⚠ TWO grants must come off, not one. Postgres grants EXECUTE to PUBLIC on a
--   new function, and Supabase's default privileges grant it to `anon` as a
--   SEPARATE acl entry — `revoke ... from public` alone leaves anon holding it.
--   (Both functions are already safe against a null auth.uid(); this is depth.)
revoke all on function public.claim_welcome_email()     from public, anon;
revoke all on function public.mark_welcome_email_sent() from public, anon;
grant execute on function public.claim_welcome_email()     to authenticated;
grant execute on function public.mark_welcome_email_sent() to authenticated;

-- ── THE ROLL-OUT GUARD ──────────────────────────────────────────────────────
-- Every account that exists RIGHT NOW is recorded as already welcomed, so the
-- feature only ever greets accounts created after this migration runs.
insert into public.welcome_emails (user_id, email, claimed_at, sent_at)
select u.id, u.email, now(), now()
  from auth.users u
on conflict (user_id) do nothing;

commit;
