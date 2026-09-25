-- ===========================================================================
-- MIGRATION 008 - community owner rewards. Run after 001-007.
-- Plain ASCII. Idempotent. MINTS Cinder - read the abuse model at the top.
-- ===========================================================================

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
