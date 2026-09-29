-- =====================================================================
-- MIGRATION 013 - fire web push automatically.
-- !! RUN AFTER the two Worker secrets exist, and set send_secret below.
-- Plain ASCII. Idempotent.
-- =====================================================================

-- ===========================================================================
-- 013 - FIRE WEB PUSH AUTOMATICALLY
--
-- sql/009 stores subscriptions and the Worker can send. Nothing CALLED it, so
-- push was a manual endpoint. This makes announcements, open votes and payouts
-- reach a closed app on their own.
--
-- ! RUN THIS AFTER the two Worker secrets exist:
--     npx wrangler secret put VAPID_PRIVATE      (from game-deploy/)
--     npx wrangler secret put PUSH_SEND_SECRET
--   Until then /api/push/send answers 503 and these triggers will simply do
--   nothing - they are deliberately failure-tolerant, so a missing secret costs
--   you notifications, never a lost announcement or a rolled-back vote.
--
-- ! NOT VERIFIED END TO END. I could not confirm a real notification landing
--   because the secrets were not set when this was written. The Worker's two
--   crypto halves ARE proven (encrypt/decrypt round trip and a VAPID signature
--   check), and the payload shape below matches what the service worker reads.
--   What remains unproven is only this hop: Postgres -> Worker.
--
-- Requires: pg_net, sql/005 (community tables), sql/009 (subscriptions).
-- Idempotent. Plain ASCII.
-- ===========================================================================


-- --- 0. pg_net. Supabase ships it; this enables it if it is not on yet.
create extension if not exists pg_net with schema extensions;


-- --- 1. WHERE THE SEND SECRET LIVES ---------------------------------------
-- ! Postgres needs the shared secret to authenticate to the Worker, so it has
--   to be stored somewhere. This table is readable by NOBODY through the API:
--   RLS is on and there is not a single policy, so PostgREST returns nothing to
--   anon or authenticated. Only SECURITY DEFINER functions and the service role
--   can see it.
create table if not exists public.push_config (
  id          int primary key default 1 check (id = 1),
  send_secret text,
  endpoint    text not null default 'https://playmythicspellbook.play-a3d.workers.dev/api/push/send',
  enabled     boolean not null default true
);
insert into public.push_config (id) values (1) on conflict (id) do nothing;
alter table public.push_config enable row level security;
revoke all on public.push_config from anon, authenticated;

-- SET THE SECRET (same string you gave `wrangler secret put PUSH_SEND_SECRET`):
--   update public.push_config set send_secret = 'paste-the-same-string' where id = 1;
-- Kill switch, if push ever misbehaves:
--   update public.push_config set enabled = false where id = 1;


-- --- 2. THE SENDER ---------------------------------------------------------
-- Fire-and-forget by design: net.http_post queues the request and returns
-- immediately, so a slow or down Worker can never delay - or roll back - the
-- insert that triggered it.
create or replace function public._push_notify(
  p_user_ids uuid[], p_title text, p_body text,
  p_source text default null, p_tag text default null, p_url text default '/')
returns void language plpgsql security definer set search_path = public as $$
declare cfg record;
begin
  if p_user_ids is null or array_length(p_user_ids, 1) is null then return; end if;

  select * into cfg from push_config where id = 1;
  if cfg is null or not cfg.enabled or coalesce(cfg.send_secret, '') = '' then return; end if;

  -- Nobody subscribed on any device means nothing to send. Cheap guard that
  -- avoids a network call per announcement in a community of browser-only
  -- players.
  if not exists (select 1 from push_subscriptions
                  where user_id = any(p_user_ids) and expired_at is null) then
    return;
  end if;

  perform net.http_post(
    url     := cfg.endpoint,
    headers := jsonb_build_object('content-type', 'application/json',
                                  'x-push-secret', cfg.send_secret),
    body    := jsonb_build_object(
                 'user_ids', to_jsonb(p_user_ids),
                 'title',    p_title,
                 'body',     coalesce(p_body, ''),
                 'source',   coalesce(p_source, ''),
                 'tag',      coalesce(p_tag, 'mythic'),
                 'url',      coalesce(p_url, '/'))
  );
exception when others then
  -- ! Never let a notification failure break the thing being announced.
  return;
end $$;


-- --- 3. ANNOUNCEMENTS ------------------------------------------------------
create or replace function public._push_on_announcement()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_ids uuid[]; v_name text;
begin
  select name into v_name from communities where id = new.community_id;
  -- Everyone active EXCEPT the author. Being pinged for your own post is the
  -- fastest way to get notifications switched off.
  select array_agg(user_id) into v_ids from community_members
   where community_id = new.community_id and status = 'active'
     and user_id is distinct from new.author_id;
  perform public._push_notify(v_ids, 'New announcement', new.body, v_name,
                              'ann-' || new.community_id::text, '/');
  return new;
end $$;
drop trigger if exists push_on_announcement on public.community_announcements;
create trigger push_on_announcement after insert on public.community_announcements
  for each row execute function public._push_on_announcement();


-- --- 4. VOTES --------------------------------------------------------------
create or replace function public._push_on_vote()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_ids uuid[]; v_name text;
begin
  if new.status is distinct from 'open' then return new; end if;
  select name into v_name from communities where id = new.community_id;
  select array_agg(user_id) into v_ids from community_members
   where community_id = new.community_id and status = 'active'
     and user_id is distinct from new.created_by;
  perform public._push_notify(v_ids, 'A vote is open', new.title, v_name,
                              'vote-' || new.community_id::text, '/');
  return new;
end $$;
drop trigger if exists push_on_vote on public.community_votes;
create trigger push_on_vote after insert on public.community_votes
  for each row execute function public._push_on_vote();


-- --- 5. PAYOUTS ------------------------------------------------------------
create or replace function public._push_on_reward()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_name text;
begin
  select name into v_name from communities where id = new.community_id;
  perform public._push_notify(array[new.user_id], 'You have a payout',
    'Cinder ' || trunc(new.amount)::text || ' waiting to claim.', v_name,
    'rew-' || new.community_id::text, '/');
  return new;
end $$;
drop trigger if exists push_on_reward on public.community_rewards;
create trigger push_on_reward after insert on public.community_rewards
  for each row execute function public._push_on_reward();


revoke all on function public._push_notify(uuid[], text, text, text, text, text) from public, anon;


-- --- 6. VERIFY -------------------------------------------------------------
-- Expect pg_net 1, triggers 3, config_rows 1, secret_set true.
select
  (select count(*) from pg_extension where extname = 'pg_net')                  as pg_net,
  (select count(*) from pg_trigger
    where tgname in ('push_on_announcement','push_on_vote','push_on_reward'))   as triggers,
  (select count(*) from public.push_config)                                     as config_rows,
  (select coalesce(send_secret, '') <> '' from public.push_config where id = 1) as secret_set;

-- After setting the secret, prove the hop with a real row - post an
-- announcement in a community where a second account has notifications on.
-- To see what pg_net actually did:
--   select id, status_code, error_msg, created
--     from net._http_response order by created desc limit 5;
