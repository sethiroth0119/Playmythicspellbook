-- ===========================================================================
-- 009 - WEB PUSH SUBSCRIPTIONS
--
-- One row per browser/device a player has allowed notifications on. This is
-- what makes a notification reach a CLOSED app - the realtime notifier shipped
-- in v120h0 only works while a tab or its service worker is alive.
--
-- Idempotent, re-runnable. Plain ASCII. Project ktsiasyjusesawtrwrjc.
--
-- WHAT IS SECRET HERE, because it is not obvious:
--   `endpoint` is a capability URL. Anyone holding it can push to that device
--   until it is revoked. `p256dh` and `auth` are the encryption keys for the
--   payload. So this table is readable ONLY by its owner, and the sender reads
--   it with the service role from inside the Worker - never from a browser.
-- ===========================================================================

create table if not exists public.push_subscriptions (
  id           bigserial primary key,
  user_id      uuid not null references auth.users(id) on delete cascade,
  endpoint     text not null,
  p256dh       text not null,
  auth         text not null,
  user_agent   text,
  -- Set when a push is rejected 404/410 (the browser dropped the subscription).
  -- Kept rather than deleted so a device that goes quiet can be told apart from
  -- one that never subscribed.
  expired_at   timestamptz,
  last_push_at timestamptz,
  created_at   timestamptz not null default now(),
  unique (endpoint)
);
create index if not exists push_subs_user on public.push_subscriptions (user_id) where expired_at is null;

alter table public.push_subscriptions enable row level security;

-- Owner-only, every verb. Nobody reads anyone else's endpoint from a browser.
drop policy if exists psub_sel on public.push_subscriptions;
create policy psub_sel on public.push_subscriptions for select to authenticated
  using (user_id = auth.uid());

drop policy if exists psub_ins on public.push_subscriptions;
create policy psub_ins on public.push_subscriptions for insert to authenticated
  with check (user_id = auth.uid());

drop policy if exists psub_upd on public.push_subscriptions;
create policy psub_upd on public.push_subscriptions for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists psub_del on public.push_subscriptions;
create policy psub_del on public.push_subscriptions for delete to authenticated
  using (user_id = auth.uid());


-- Re-subscribing on the same device must not pile up rows. The browser can
-- hand back the same endpoint with rotated keys, so this updates in place.
create or replace function public.push_subscribe(
  p_endpoint text, p_p256dh text, p_auth text, p_ua text default null)
returns void language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'not signed in'; end if;
  if p_endpoint is null or length(p_endpoint) < 20 then raise exception 'bad endpoint'; end if;

  insert into push_subscriptions (user_id, endpoint, p256dh, auth, user_agent)
  values (v_uid, p_endpoint, p_p256dh, p_auth, left(coalesce(p_ua, ''), 200))
  on conflict (endpoint) do update
    set user_id = v_uid, p256dh = excluded.p256dh, auth = excluded.auth,
        user_agent = excluded.user_agent, expired_at = null;
end $$;

create or replace function public.push_unsubscribe(p_endpoint text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return; end if;
  delete from push_subscriptions where endpoint = p_endpoint and user_id = auth.uid();
end $$;

revoke all on function public.push_subscribe(text, text, text, text) from public, anon;
revoke all on function public.push_unsubscribe(text) from public, anon;
grant execute on function public.push_subscribe(text, text, text, text) to authenticated;
grant execute on function public.push_unsubscribe(text) to authenticated;


-- --- VERIFY. Expect table 1, policies 4, rpcs 2.
select
  (select count(*) from pg_tables where schemaname='public' and tablename='push_subscriptions') as tbl,
  (select count(*) from pg_policies where schemaname='public' and tablename='push_subscriptions') as policies,
  (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname in ('push_subscribe','push_unsubscribe'))            as rpcs;
