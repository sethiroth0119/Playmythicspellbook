-- ===========================================================================
-- MYTHIC SPELLBOOK - ALL REMAINING SQL
-- Generated 2026-08-05. Project ktsiasyjusesawtrwrjc. Run TOP TO BOTTOM.
--
-- VERIFIED AGAINST LIVE BEFORE GENERATING:
--   ALREADY APPLIED, so NOT included: 001-005 (communities), economy_reset
--     STEP 2 (economy_reset_row exists), and 004 boe_adjust_balance. Probing
--     each returned 42501 permission-denied, which means the function EXISTS.
--   CONFIRMED MISSING, so included: 008, 009, 010 (tables 404 / RPCs PGRST202).
--   COULD NOT VERIFY from a browser key: 006 and 007 - RLS policies and the
--     realtime publication are not readable with the anon key. Both are
--     idempotent, so running them again if you already did is harmless.
--   Dependencies checked and present: gifts, node_mayors, communities, guild_chat.
--
-- Plain ASCII on purpose - emoji and box-drawing get mangled pasting through a
-- console and the editor then reports invented 42P01 errors on lines that were
-- never SQL.
--
-- Every section is idempotent and ends with a verify query. Read each result
-- before moving on.
--
-- !! 008 MINTS CINDER. Read the abuse model at the top of that section before
--    running it, and note the amounts can be retuned or disabled afterwards
--    with community_reward_config - no deploy needed.
-- ===========================================================================


-- ###########################################################################
-- SECTION 1 - 006 - only a corporation owner may found a community
-- Expect 1 row, requires_corp = true.
-- ###########################################################################

-- ===========================================================================
-- 006 - ONLY A CORPORATION OWNER MAY FOUND A COMMUNITY
--
-- Communities sit ABOVE corporations, so the entry requirement should be a
-- corporation. This makes the hierarchy real instead of decorative: you cannot
-- hold corps together without holding one yourself.
--
-- Requires 001. Idempotent, re-runnable. Plain ASCII.
--
-- NOTE ON SCOPE: this gates FOUNDING, not continued ownership. An owner who
-- later dissolves their corporation keeps the community they already built -
-- retroactively deleting someone's community out from under them would be a
-- far more destructive rule than the one that was asked for.
-- ===========================================================================

-- Replaces the comm_ins policy from 001, which only checked owner_id.
drop policy if exists comm_ins on public.communities;
create policy comm_ins on public.communities for insert to authenticated
  with check (
    owner_id = auth.uid()
    -- The founder of ANY corporation qualifies. Checked HERE rather than in JS
    -- because the client check is only a hint - this policy is the actual gate,
    -- and a tampered client hits it.
    and exists (
      select 1 from public.corporations c
       where c.founder_id = auth.uid()
    )
  );


-- verify: expect 1 row, and the definition should mention corporations
select policyname,
       (pg_get_expr(pol.polwithcheck, pol.polrelid) like '%corporations%') as requires_corp
  from pg_policies p
  join pg_policy pol on pol.polname = p.policyname
  join pg_class cl on cl.oid = pol.polrelid and cl.relname = p.tablename
 where p.schemaname = 'public' and p.tablename = 'communities' and p.policyname = 'comm_ins';


-- ###########################################################################
-- SECTION 2 - 007 - realtime for communities
-- Turns on live wire/announcements/votes. Expect 5 rows.
-- ###########################################################################

-- ===========================================================================
-- 007 - REALTIME FOR COMMUNITIES
--
-- Postgres only streams changes for tables in the supabase_realtime
-- publication. guild_chat was added when the Guild Wire was built; the
-- community tables were not, so announcements, votes and payouts could only be
-- seen by reloading.
--
-- RLS still applies to realtime, so a player only ever receives rows they were
-- already allowed to SELECT. Adding a table here does not widen access.
--
-- Idempotent - each add is guarded, so re-running is safe.
-- Plain ASCII. Supabase SQL editor, project ktsiasyjusesawtrwrjc.
-- ===========================================================================

do $$
declare
  t text;
  tables text[] := array[
    'community_announcements',   -- new announcement -> notify the community
    'community_votes',           -- vote opened / closed -> notify
    'community_rewards',         -- a payout landed for you
    'community_members',         -- joins + approvals show up live
    'guild_chat'                 -- already added when the Wire shipped; harmless
  ];
begin
  for t in select unnest(tables) loop
    -- Skip if the table is already published, else ALTER PUBLICATION errors.
    if not exists (
      select 1 from pg_publication_tables
       where pubname = 'supabase_realtime'
         and schemaname = 'public'
         and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
      raise notice 'added % to supabase_realtime', t;
    else
      raise notice '% already published', t;
    end if;
  end loop;
end $$;


-- Realtime sends only the primary key on UPDATE/DELETE unless the replica
-- identity is FULL. Announcements and votes are read as whole rows by the
-- notifier, so give it the full row.
alter table public.community_announcements replica identity full;
alter table public.community_votes         replica identity full;
alter table public.community_rewards       replica identity full;


-- verify: expect 5 rows
select tablename
  from pg_publication_tables
 where pubname = 'supabase_realtime'
   and schemaname = 'public'
   and tablename in ('community_announcements','community_votes','community_rewards',
                     'community_members','guild_chat')
 order by tablename;


-- ###########################################################################
-- SECTION 3 - 008 - community owner rewards  (MINTS CINDER)
-- Expect config_rows 1, triggers 2, payout_table 1, ip_helper 1.
-- ###########################################################################

-- ===========================================================================
-- 008 - COMMUNITY OWNER REWARDS
--
--   100 Cinder  per member who joins from a NEW IP address
--    10 Cinder  per member who talks on the wire, at most once per 5 hours
--
-- Both are paid to the community OWNER, through the GIFTS INBOX - the same
-- path the referral rewards use. Nothing here writes a balance directly:
-- a pending gifts row appears, the owner presses Claim, and the existing
-- claim path credits them. Direct balance mutation is what the save-sweep
-- clobbers, and it is also how the last two Cinder bugs happened.
--
-- Requires 001 (communities/community_members) and 002 (community_corps).
-- Idempotent, re-runnable. Plain ASCII. Project ktsiasyjusesawtrwrjc.
--
-- ---------------------------------------------------------------------------
-- THE ABUSE MODEL, WRITTEN DOWN, because this MINTS Cinder.
--   * One person, many accounts, one machine -> the IP rule pays once.
--   * One person, many accounts, a VPN        -> still farmable. IP is the
--     guard that was asked for; it raises the cost, it does not eliminate it.
--     If this gets abused, the next lever is requiring the member to reach a
--     hero level before they count, not a tighter IP rule.
--   * An owner talking in their own community  -> pays NOTHING. Without that
--     rule a lone owner mints 10 Cinder every 5 hours forever with no second
--     player involved, which is a faucet wearing an engagement costume.
--   * An owner joining their own community     -> pays NOTHING, same reason.
--   * Someone spamming the wire                -> one payout per person per 5h,
--     so volume earns nothing extra.
-- ===========================================================================


-- --- 1. TUNING. One place, so the economy can be retuned without a code read.
create table if not exists public.community_reward_config (
  id            int primary key default 1 check (id = 1),
  member_cinder numeric not null default 100,
  chat_cinder   numeric not null default 10,
  chat_window   interval not null default interval '5 hours',
  enabled       boolean not null default true
);
insert into public.community_reward_config (id) values (1) on conflict (id) do nothing;
alter table public.community_reward_config enable row level security;
drop policy if exists crc_sel on public.community_reward_config;
create policy crc_sel on public.community_reward_config for select to authenticated using (true);
revoke insert, update, delete on public.community_reward_config from anon, authenticated;


-- --- 2. THE PAYOUT LEDGER. This is the dedup key, not a report.
create table if not exists public.community_owner_payouts (
  id           bigserial primary key,
  community_id uuid not null references public.communities(id) on delete cascade,
  owner_id     uuid not null references auth.users(id) on delete cascade,
  kind         text not null check (kind in ('member_ip','chat_activity')),
  subject_user uuid references auth.users(id) on delete set null,
  ip           text,
  amount       numeric not null default 0,
  created_at   timestamptz not null default now()
);
create index if not exists cop_owner on public.community_owner_payouts (owner_id, created_at desc);
create index if not exists cop_chat  on public.community_owner_payouts (community_id, subject_user, created_at desc)
  where kind = 'chat_activity';

-- One payout per community per IP, ever. This single index IS the 100-Cinder
-- rule; without it every re-join re-pays.
create unique index if not exists cop_member_ip_once
  on public.community_owner_payouts (community_id, ip) where (kind = 'member_ip' and ip is not null);

alter table public.community_owner_payouts enable row level security;
drop policy if exists cop_sel on public.community_owner_payouts;
-- Owners see their own payouts. The IP column is NOT exposed to anyone else.
create policy cop_sel on public.community_owner_payouts for select to authenticated
  using (owner_id = auth.uid());
revoke insert, update, delete on public.community_owner_payouts from anon, authenticated;


-- --- 3. CLIENT IP, server side. Same header order the referral guards use:
--       cf-connecting-ip -> first x-forwarded-for hop -> x-real-ip.
--       Missing headers return null and the caller degrades gracefully rather
--       than paying out blind.
create or replace function public._community_client_ip()
returns text language plpgsql stable security definer set search_path = public as $$
declare h json; v text;
begin
  begin h := current_setting('request.headers', true)::json; exception when others then return null; end;
  if h is null then return null; end if;
  v := h->>'cf-connecting-ip';
  if v is not null and length(v) > 0 then return split_part(v, ',', 1); end if;
  v := h->>'x-forwarded-for';
  if v is not null and length(v) > 0 then return btrim(split_part(v, ',', 1)); end if;
  v := h->>'x-real-ip';
  if v is not null and length(v) > 0 then return v; end if;
  return null;
end $$;


-- --- 4. Remember the JOINER's IP at apply time.
-- ! This column exists because the approval happens LATER and is performed by
--   the LEADER. Reading the IP at approval time would record the leader's
--   address and hand every community a free 100 Cinder per approval.
alter table public.community_members add column if not exists join_ip text;


-- --- 5. The payout itself. Writes the gift AND the ledger row in one
--       transaction, so a paid gift can never exist without its dedup record.
create or replace function public._community_pay_owner(
  p_community_id uuid, p_kind text, p_subject uuid, p_ip text, p_amount numeric, p_msg text)
returns void language plpgsql security definer set search_path = public as $$
declare v_owner uuid;
begin
  if p_amount is null or p_amount <= 0 then return; end if;
  select owner_id into v_owner from communities where id = p_community_id;
  if v_owner is null then return; end if;
  -- Never pay an owner for their own activity. See the abuse model at the top.
  if p_subject is not null and p_subject = v_owner then return; end if;

  -- The unique index does the deduping; a duplicate simply does nothing.
  begin
    insert into community_owner_payouts (community_id, owner_id, kind, subject_user, ip, amount)
    values (p_community_id, v_owner, p_kind, p_subject, p_ip, p_amount);
  exception when unique_violation then return;
  end;

  insert into gifts (to_user, card_id, card_name, qty, message, from_label, status)
  values (v_owner, '__cinder__', 'Cinder', p_amount, p_msg, 'Community', 'pending');
end $$;


-- --- 6. 100 CINDER when a member becomes ACTIVE from an IP not seen before.
create or replace function public._community_member_reward()
returns trigger language plpgsql security definer set search_path = public as $$
declare cfg record; v_ip text;
begin
  if new.status <> 'active' then return new; end if;
  if tg_op = 'UPDATE' and old.status = 'active' then return new; end if;  -- already counted

  select * into cfg from community_reward_config where id = 1;
  if cfg is null or not cfg.enabled then return new; end if;

  v_ip := coalesce(new.join_ip, public._community_client_ip());
  -- No IP means no guard, and an unguarded faucet is worse than a missed
  -- reward. Skip rather than pay blind.
  if v_ip is null then return new; end if;

  perform public._community_pay_owner(
    new.community_id, 'member_ip', new.user_id, v_ip, cfg.member_cinder,
    coalesce(new.user_name, 'A survivor') || ' joined your community.');
  return new;
end $$;

drop trigger if exists community_member_reward on public.community_members;
create trigger community_member_reward
  after insert or update of status on public.community_members
  for each row execute function public._community_member_reward();


-- --- 7. 10 CINDER when a member talks on the wire, once per 5h per person.
-- Fires on guild_chat so it works no matter which surface sent the message
-- (game hub, Just Business, or the website) and regardless of the write path.
create or replace function public._community_chat_reward()
returns trigger language plpgsql security definer set search_path = public as $$
declare cfg record; r record; v_last timestamptz;
begin
  if new.kind is distinct from 'chat' then return new; end if;   -- system lines pay nothing
  if new.user_id is null then return new; end if;

  select * into cfg from community_reward_config where id = 1;
  if cfg is null or not cfg.enabled then return new; end if;

  -- A corporation can be affiliated to one community at a time (002), so this
  -- is at most one row.
  for r in
    select cc.community_id from community_corps cc
     where cc.corp_id = new.corp_id and cc.status = 'active'
  loop
    -- Must actually be a member of that community, not merely in a corp that
    -- is affiliated with it.
    if not exists (select 1 from community_members m
                    where m.community_id = r.community_id
                      and m.user_id = new.user_id and m.status = 'active') then
      continue;
    end if;

    select max(created_at) into v_last from community_owner_payouts
     where community_id = r.community_id and subject_user = new.user_id and kind = 'chat_activity';
    if v_last is not null and now() - v_last < cfg.chat_window then continue; end if;

    perform public._community_pay_owner(
      r.community_id, 'chat_activity', new.user_id, null, cfg.chat_cinder,
      coalesce(new.user_name, 'A member') || ' is active on your wire.');
  end loop;
  return new;
end $$;

drop trigger if exists community_chat_reward on public.guild_chat;
create trigger community_chat_reward
  after insert on public.guild_chat
  for each row execute function public._community_chat_reward();


-- --- 8. Record the joiner's IP when they apply. Replaces the 001 version;
--       everything else about it is unchanged.
create or replace function public.community_apply(p_community_id uuid, p_user_name text default null)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_uid    uuid := auth.uid();
  v_policy text;
  v_status text;
  v_exist  text;
  v_ip     text;
begin
  if v_uid is null then raise exception 'not signed in'; end if;
  select join_policy into v_policy from communities where id = p_community_id;
  if v_policy is null then raise exception 'no such community'; end if;
  if v_policy = 'closed' then raise exception 'this community is invite only'; end if;

  select status into v_exist from community_members
   where community_id = p_community_id and user_id = v_uid;
  if v_exist = 'banned' then raise exception 'you are banned from this community'; end if;
  if v_exist = 'active' then return 'active'; end if;

  v_status := case when v_policy = 'open' then 'active' else 'pending' end;
  v_ip := public._community_client_ip();

  insert into community_members (community_id, user_id, user_name, role, status, join_ip)
  values (p_community_id, v_uid, left(coalesce(p_user_name, 'Survivor'), 40), 'member', v_status, v_ip)
  on conflict (community_id, user_id)
  do update set status = v_status, user_name = excluded.user_name,
                join_ip = coalesce(community_members.join_ip, excluded.join_ip);

  return v_status;
end $$;

revoke all on function public.community_apply(uuid, text) from public, anon;
grant execute on function public.community_apply(uuid, text) to authenticated;
revoke all on function public._community_pay_owner(uuid, text, uuid, text, numeric, text) from public, anon;
revoke all on function public._community_client_ip() from public, anon;


-- --- VERIFY. Expect config 1, triggers 2, payout table 1, ip helper 1.
select
  (select count(*) from public.community_reward_config)                       as config_rows,
  (select count(*) from pg_trigger
    where tgname in ('community_member_reward','community_chat_reward'))      as triggers,
  (select count(*) from pg_tables where schemaname='public'
    and tablename='community_owner_payouts')                                  as payout_table,
  (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='_community_client_ip')            as ip_helper;

-- Retune later without touching code, e.g.:
--   update public.community_reward_config set member_cinder = 50 where id = 1;
--   update public.community_reward_config set enabled = false where id = 1;   -- kill switch


-- ###########################################################################
-- SECTION 4 - 009 - web push subscriptions
-- Expect tbl 1, policies 4, rpcs 2. Also set the two Worker secrets.
-- ###########################################################################

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


-- ###########################################################################
-- SECTION 5 - 010 - node managers spend the OWNER ledger
-- Expect rpcs 3.
-- ###########################################################################

-- ===========================================================================
-- 010 - A NODE MANAGER SPENDS THE OWNER'S LEDGER, NOT THEIR OWN
--
-- A hired mayor running someone else's city currently spends their OWN camp
-- resources and Cinder, and everything the city produces lands in their OWN
-- stores. Both directions are wrong: a manager can pour a personally farmed
-- hoard into a city that is not theirs, and can drain that city's output into
-- their own camp.
--
-- These two RPCs give the mayor read/write access to the OWNER's ledger, and
-- ONLY that owner's, and ONLY while the mayoralty is active.
--
-- Requires node_mayors (supabase-mayors.sql). Idempotent. Plain ASCII.
--
-- ---------------------------------------------------------------------------
-- ! HONEST LIMITATION, because it decides when this is safe to rely on.
--   Camp resources live in user_profiles.forge->'__salvage__', and the OWNER's
--   own client uploads that WHOLE forge blob when it saves. So if the owner is
--   playing at the same moment a mayor spends, the owner's next upload can
--   overwrite the mayor's change - a last-write-wins race identical in shape to
--   the bank bug fixed in v120g5.
--   These functions narrow it as far as is possible without rebuilding the camp
--   ledger as server-authoritative: they use jsonb_set on the ONE key rather
--   than rewriting the blob, so nothing else the owner owns is ever touched.
--   In practice a mayor is hired precisely because the owner is away, so the
--   windows rarely overlap - but it is a race, not a guarantee, and pretending
--   otherwise would be the wrong kind of confidence.
-- ===========================================================================


-- --- 1. AUTHORITY. Only an ACTIVE hired mayor of THIS node, and the answer
--        carries the owner id so no caller ever names the owner themselves.
create or replace function public._node_manager_owner(p_node_id text)
returns uuid language sql stable security definer set search_path = public as $$
  select m.owner_id
    from public.node_mayors m
   where m.node_id = p_node_id
     and m.mayor_id = auth.uid()
     and coalesce(m.active, true)
   limit 1;
$$;


-- --- 2. READ the owner's ledger.
create or replace function public.city_owner_ledger_get(p_node_id text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_owner uuid; v_salvage jsonb; v_cinder numeric;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  v_owner := public._node_manager_owner(p_node_id);
  if v_owner is null then raise exception 'you do not manage this node'; end if;

  select coalesce(forge->'__salvage__', '{}'::jsonb), coalesce(gems, 0)
    into v_salvage, v_cinder
    from public.user_profiles where user_id = v_owner;

  return jsonb_build_object('ok', true, 'owner_id', v_owner,
                            'cinder', coalesce(v_cinder, 0),
                            'salvage', coalesce(v_salvage, '{}'::jsonb));
end $$;


-- --- 3. APPLY a delta, atomically, refusing anything that would go negative.
--        p_salvage_delta is { resourceId: signedNumber }.
create or replace function public.city_owner_ledger_apply(
  p_node_id text, p_cinder_delta numeric default 0, p_salvage_delta jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_owner   uuid;
  v_salvage jsonb;
  v_cinder  numeric;
  k         text;
  v_have    numeric;
  v_next    numeric;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  v_owner := public._node_manager_owner(p_node_id);
  if v_owner is null then raise exception 'you do not manage this node'; end if;

  -- Lock the owner's row for the whole check-and-apply. Without this, two
  -- managers (or a manager and a retrying client) can both read the same
  -- balance and both spend it.
  select coalesce(forge->'__salvage__', '{}'::jsonb), coalesce(gems, 0)
    into v_salvage, v_cinder
    from public.user_profiles where user_id = v_owner for update;

  if v_salvage is null then raise exception 'owner has no profile'; end if;

  -- Cinder first: a refusal here must happen before any resource moves.
  v_cinder := v_cinder + coalesce(p_cinder_delta, 0);
  if v_cinder < 0 then
    return jsonb_build_object('ok', false, 'error', 'insufficient_cinder',
                              'cinder', coalesce((select gems from user_profiles where user_id = v_owner), 0));
  end if;

  for k in select jsonb_object_keys(coalesce(p_salvage_delta, '{}'::jsonb))
  loop
    v_have := coalesce((v_salvage->>k)::numeric, 0);
    v_next := v_have + coalesce((p_salvage_delta->>k)::numeric, 0);
    if v_next < 0 then
      return jsonb_build_object('ok', false, 'error', 'insufficient_resource',
                                'resource', k, 'have', v_have);
    end if;
    v_salvage := jsonb_set(v_salvage, array[k], to_jsonb(v_next), true);
  end loop;

  -- ! jsonb_set on the ONE key. Writing the whole forge blob back would
  --   destroy every other thing the owner changed since we read it.
  update public.user_profiles
     set forge = jsonb_set(coalesce(forge, '{}'::jsonb), '{__salvage__}', v_salvage, true),
         gems  = v_cinder
   where user_id = v_owner;

  -- Keep the canonical wallet in step. Missing this is exactly how the v120g6
  -- drift happened: gems and user_progress.cinder disagreeing forever.
  begin
    update public.user_progress set cinder = greatest(0, v_cinder) where user_id = v_owner;
  exception when undefined_table or undefined_column then null;
  end;

  return jsonb_build_object('ok', true, 'cinder', v_cinder, 'salvage', v_salvage);
end $$;


revoke all on function public._node_manager_owner(text) from public, anon;
revoke all on function public.city_owner_ledger_get(text) from public, anon;
revoke all on function public.city_owner_ledger_apply(text, numeric, jsonb) from public, anon;
grant execute on function public.city_owner_ledger_get(text) to authenticated;
grant execute on function public.city_owner_ledger_apply(text, numeric, jsonb) to authenticated;


-- --- VERIFY. Expect rpcs 3.
select count(*) as rpcs
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and p.proname in ('_node_manager_owner','city_owner_ledger_get','city_owner_ledger_apply');
