-- =============================================================================
-- ✉  Welcome-email pipeline — fires once when a player confirms their email
-- -----------------------------------------------------------------------------
-- ON  auth.users  AFTER UPDATE
-- WHEN OLD.email_confirmed_at IS NULL AND NEW.email_confirmed_at IS NOT NULL
--      → row inserted into _email.welcome_emails_sent (idempotency guard)
--      → net.http_post to the welcome_email Edge Function with the new user's
--        id, email, display_name and a shared HMAC secret
--      → the Edge Function calls Resend's REST API to send a styled HTML email
--
-- Why a private schema?
--   The trigger function is SECURITY DEFINER (it needs to read auth.users
--   and call the pg_net extension). Per Supabase security guidance, security-
--   definer functions must live in an unexposed schema. `_email` is private:
--   no Data API exposure, no anon/authenticated GRANTs.
--
-- Why a config table instead of GUC settings?
--   ALTER DATABASE … SET requires the postgres role and isn't portable across
--   pooler tiers. A regular table with a single config row works from the SQL
--   editor with no special perms and is trivially editable later.
--
-- Idempotency:
--   _email.welcome_emails_sent has user_id as PRIMARY KEY. The trigger uses
--   INSERT … ON CONFLICT DO NOTHING and only fires the HTTP post when a row
--   actually lands, so re-confirms / replays never double-send.
-- =============================================================================

-- 0) Extensions ---------------------------------------------------------------
-- pg_net ships with every Supabase project but isn't always pre-installed.
-- The "net" schema is where its functions live.
create extension if not exists pg_net with schema extensions;

-- 1) Private schema -----------------------------------------------------------
create schema if not exists _email;

-- Lock the schema down. Nothing here is reachable via the Data API; we only
-- ever touch it from the trigger (which runs as the function owner) and from
-- the SQL editor.
revoke all on schema _email from public;
revoke all on schema _email from anon, authenticated;

-- 2) Config table -------------------------------------------------------------
-- Single-row config (PK forces it). Holds:
--   • function_url     – full URL to the welcome_email Edge Function
--   • shared_secret    – HMAC-ish shared secret the Edge Function checks
--                        against X-Welcome-Secret. ROTATE before going live.
create table if not exists _email.config (
  id           int  primary key default 1,
  function_url text not null,
  shared_secret text not null,
  updated_at   timestamptz not null default now(),
  constraint config_single_row check (id = 1)
);

-- Seed defaults the admin can overwrite. Replace the secret IMMEDIATELY.
insert into _email.config (id, function_url, shared_secret)
values (
  1,
  'https://ktsiasyjusesawtrwrjc.supabase.co/functions/v1/welcome_email',
  'CHANGE-ME-rotate-before-going-live-' || gen_random_uuid()::text
) on conflict (id) do nothing;

-- 3) Idempotency ledger -------------------------------------------------------
create table if not exists _email.welcome_emails_sent (
  user_id     uuid primary key,
  email       text not null,
  display_name text,
  sent_at     timestamptz not null default now(),
  response_id text,                  -- Resend message id (set by Edge Fn via service-role write)
  status      text not null default 'queued',
  last_error  text
);
-- RLS on as defense-in-depth, even though the schema isn't exposed.
alter table _email.welcome_emails_sent enable row level security;
-- No policies → only superuser / service_role can read. That's intentional.

-- 4) Trigger function ---------------------------------------------------------
create or replace function _email.handle_new_confirmed_user()
returns trigger
language plpgsql
security definer
-- Restrict the search_path so a bad search-path injection can't redirect
-- table references to a different schema.
set search_path = _email, extensions, pg_temp
as $$
declare
  v_cfg       _email.config%rowtype;
  v_display   text;
  v_inserted  boolean;
  v_request_id bigint;
begin
  -- Only act when the email confirmation flips from NULL → not-null. Any
  -- other UPDATE on auth.users (password change, sign-in stamp, etc.) is
  -- ignored.
  if (tg_op <> 'UPDATE') then return new; end if;
  if (old.email_confirmed_at is not null) then return new; end if;
  if (new.email_confirmed_at is null) then return new; end if;

  -- Idempotency — INSERT … ON CONFLICT DO NOTHING. If the row already
  -- existed (re-confirm, replay), v_inserted is false and we skip.
  v_display := coalesce(
    new.raw_user_meta_data ->> 'display_name',
    split_part(coalesce(new.email, ''), '@', 1)
  );

  insert into _email.welcome_emails_sent (user_id, email, display_name)
  values (new.id, new.email, v_display)
  on conflict (user_id) do nothing;

  get diagnostics v_inserted = row_count;
  if v_inserted = 0 then
    return new;                       -- already sent (or queued) — bail
  end if;

  -- Look up the active config row.
  select * into v_cfg from _email.config where id = 1;
  if not found then
    update _email.welcome_emails_sent
       set status = 'error', last_error = 'no _email.config row'
     where user_id = new.id;
    return new;
  end if;

  -- Fire-and-forget HTTP POST to the Edge Function.
  -- pg_net is async: the request is queued and returns immediately, so the
  -- auth.users UPDATE that triggered us is never blocked on Resend latency.
  select net.http_post(
    url     := v_cfg.function_url,
    headers := jsonb_build_object(
      'Content-Type',      'application/json',
      'X-Welcome-Secret',  v_cfg.shared_secret
    ),
    body    := jsonb_build_object(
      'user_id',      new.id,
      'email',        new.email,
      'display_name', v_display,
      'confirmed_at', new.email_confirmed_at
    ),
    timeout_milliseconds := 5000
  ) into v_request_id;

  -- Stash the pg_net request id so an operator can join it against
  -- net._http_response later to debug failed sends.
  update _email.welcome_emails_sent
     set response_id = v_request_id::text
   where user_id = new.id;

  return new;
exception when others then
  -- Never block account confirmation because of an email failure. Record the
  -- error and let auth.users complete its UPDATE normally.
  update _email.welcome_emails_sent
     set status     = 'error',
         last_error = sqlerrm
   where user_id = new.id;
  return new;
end;
$$;

-- Only the function owner needs to be able to call this. revoke from public.
revoke all on function _email.handle_new_confirmed_user() from public;

-- 5) Trigger ------------------------------------------------------------------
drop trigger if exists on_email_confirmation_send_welcome on auth.users;
create trigger on_email_confirmation_send_welcome
after update of email_confirmed_at on auth.users
for each row
when (old.email_confirmed_at is null and new.email_confirmed_at is not null)
execute function _email.handle_new_confirmed_user();

-- 6) Admin helper view (optional, for the SQL editor) -------------------------
-- Lets admins inspect the queue + recent sends. Returns plaintext fields, so
-- KEEP IT IN _email (private schema) — do not move to public.
create or replace view _email.welcome_emails_recent as
  select user_id, email, display_name, sent_at, status, response_id, last_error
    from _email.welcome_emails_sent
   order by sent_at desc;

-- ────────────────────────────────────────────────────────────────────────────
-- ✅ Migration done. After running this you still need to:
--    1) Deploy the Edge Function:
--         supabase functions deploy welcome_email --no-verify-jwt
--    2) Set the function secrets:
--         supabase secrets set RESEND_API_KEY=re_xxx
--         supabase secrets set WELCOME_EMAIL_SECRET=<same value as _email.config.shared_secret>
--         supabase secrets set WELCOME_EMAIL_FROM="Mythic Spellbook <welcome@yourdomain.com>"
--    3) Rotate the seed secret you copied into _email.config:
--         update _email.config set shared_secret = '<paste new random string>' where id = 1;
--         supabase secrets set WELCOME_EMAIL_SECRET=<paste same value>
--    4) Test:
--         insert into auth.users... no — just confirm a real test account.
--         Inspect:  select * from _email.welcome_emails_recent;
-- ────────────────────────────────────────────────────────────────────────────
