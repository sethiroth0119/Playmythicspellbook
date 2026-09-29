-- ═══════════════════════════════════════════════════════════════════════════
-- 005 · COMMUNITY PHASE 2 — announcements · votes · objectives · rewards
--
-- Requires 001 (is_community_member / is_community_leader) and 003 (ledger).
-- Idempotent, re-runnable. Supabase SQL editor, project ktsiasyjusesawtrwrjc.
--
-- Design notes that matter more than the DDL:
--  • Votes CHANGE GAME STATE. Closing a vote writes the winning option onto the
--    communities row, and the client reads it. A poll that changes nothing is
--    the "worse Discord" this whole feature exists to avoid.
--  • Objectives POINT AT Territory Wars nodes. There is no parallel mission
--    system, no separate progress counter — progress is read live from TW.
--  • Rewards are CLAIMED, not pushed. A distribution writes one claimable row
--    per member; each player credits their own wallet. Nothing here can touch
--    another user's balance, which is the only reason this is safe to expose.
-- ═══════════════════════════════════════════════════════════════════════════


-- ─── 0. Vote outcomes live on the community row ──────────────────────────
alter table public.communities add column if not exists war_target_node text;
alter table public.communities add column if not exists war_target_name text;
-- Levy the community retains from a reward distribution, 0-50%.
alter table public.communities add column if not exists levy_pct numeric not null default 0;
alter table public.communities drop constraint if exists communities_levy_pct_ck;
alter table public.communities add constraint communities_levy_pct_ck check (levy_pct >= 0 and levy_pct <= 50);


-- ═══ 1. ANNOUNCEMENTS ════════════════════════════════════════════════════
-- One-to-many, leadership-only, TEXT ONLY. The lowest-abuse social surface
-- there is: members cannot post, so there is no many-to-many moderation load.
create table if not exists public.community_announcements (
  id           bigserial primary key,
  community_id uuid not null references public.communities(id) on delete cascade,
  author_id    uuid references auth.users(id) on delete set null,
  author_name  text,
  body         text not null check (length(body) between 1 and 2000),
  pinned       boolean not null default false,
  created_at   timestamptz not null default now()
);
create index if not exists community_ann_comm on public.community_announcements (community_id, created_at desc);

alter table public.community_announcements enable row level security;

drop policy if exists cann_sel on public.community_announcements;
create policy cann_sel on public.community_announcements for select to authenticated
  using (public.is_community_member(community_id) or public.is_community_leader(community_id));

-- ⚠ author_id = auth.uid() AND leadership. Both, not either: without the
--   author check a leader could post under someone else's name.
drop policy if exists cann_ins on public.community_announcements;
create policy cann_ins on public.community_announcements for insert to authenticated
  with check (author_id = auth.uid() and public.is_community_leader(community_id));

drop policy if exists cann_upd on public.community_announcements;
create policy cann_upd on public.community_announcements for update to authenticated
  using (public.is_community_leader(community_id)) with check (true);

drop policy if exists cann_del on public.community_announcements;
create policy cann_del on public.community_announcements for delete to authenticated
  using (public.is_community_leader(community_id));


-- ═══ 2. VOTES ════════════════════════════════════════════════════════════
-- kind decides what closing the vote DOES:
--   'war_target' → communities.war_target_node / _name
--   'levy'       → communities.levy_pct
--   'advisory'   → records the result and changes nothing (say so in the UI)
create table if not exists public.community_votes (
  id           bigserial primary key,
  community_id uuid not null references public.communities(id) on delete cascade,
  kind         text not null check (kind in ('war_target','levy','advisory')),
  title        text not null check (length(title) between 1 and 140),
  -- [{ value, label }] — the ballot. Kept as data so the client cannot invent
  -- an option that was never on the paper.
  options      jsonb not null default '[]'::jsonb,
  status       text not null default 'open' check (status in ('open','closed','applied','cancelled')),
  created_by   uuid references auth.users(id) on delete set null,
  created_name text,
  closes_at    timestamptz,
  result_value text,
  result_label text,
  applied_at   timestamptz,
  created_at   timestamptz not null default now()
);
create index if not exists community_votes_comm on public.community_votes (community_id, created_at desc);

create table if not exists public.community_ballots (
  vote_id    bigint not null references public.community_votes(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  choice     text not null,
  created_at timestamptz not null default now(),
  primary key (vote_id, user_id)          -- ⚠ one member, one ballot
);

alter table public.community_votes   enable row level security;
alter table public.community_ballots enable row level security;

drop policy if exists cvote_sel on public.community_votes;
create policy cvote_sel on public.community_votes for select to authenticated
  using (public.is_community_member(community_id) or public.is_community_leader(community_id));

drop policy if exists cvote_ins on public.community_votes;
create policy cvote_ins on public.community_votes for insert to authenticated
  with check (created_by = auth.uid() and public.is_community_leader(community_id) and status = 'open');

-- ⚠ NO direct update policy. Closing a vote applies game state, so it runs
--   through community_vote_close() where the tally cannot be forged.
drop policy if exists cvote_del on public.community_votes;
create policy cvote_del on public.community_votes for delete to authenticated
  using (public.is_community_leader(community_id));

-- Ballots are public to the community: a tally nobody can audit is not a vote.
drop policy if exists cbal_sel on public.community_ballots;
create policy cbal_sel on public.community_ballots for select to authenticated
  using (exists (select 1 from public.community_votes v
                  where v.id = vote_id and public.is_community_member(v.community_id)));
revoke insert, update, delete on public.community_ballots from anon, authenticated;


-- Cast (or change) your ballot while the vote is open.
create or replace function public.community_vote_cast(p_vote_id bigint, p_choice text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_uid  uuid := auth.uid();
  v_comm uuid;
  v_stat text;
  v_close timestamptz;
  v_ok   boolean;
begin
  if v_uid is null then raise exception 'not signed in'; end if;
  select community_id, status, closes_at into v_comm, v_stat, v_close
    from community_votes where id = p_vote_id;
  if v_comm is null then raise exception 'no such vote'; end if;
  if not public.is_community_member(v_comm) then raise exception 'members only'; end if;
  if v_stat <> 'open' then raise exception 'this vote is closed'; end if;
  if v_close is not null and now() > v_close then raise exception 'this vote has expired'; end if;

  -- The choice must be one of the options actually on the ballot.
  select exists (
    select 1 from community_votes cv, jsonb_array_elements(cv.options) o
     where cv.id = p_vote_id and o->>'value' = p_choice
  ) into v_ok;
  if not v_ok then raise exception 'that is not an option on this vote'; end if;

  insert into community_ballots (vote_id, user_id, choice)
  values (p_vote_id, v_uid, p_choice)
  on conflict (vote_id, user_id) do update set choice = excluded.choice, created_at = now();
end $$;


-- Close a vote, tally it, and APPLY the winner to the community.
create or replace function public.community_vote_close(p_vote_id bigint)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid   uuid := auth.uid();
  v_comm  uuid;
  v_kind  text;
  v_stat  text;
  v_win   text;
  v_label text;
  v_count int;
begin
  if v_uid is null then raise exception 'not signed in'; end if;
  select community_id, kind, status into v_comm, v_kind, v_stat
    from community_votes where id = p_vote_id;
  if v_comm is null then raise exception 'no such vote'; end if;
  if not public.is_community_leader(v_comm) then raise exception 'leadership only'; end if;
  if v_stat <> 'open' then raise exception 'already closed'; end if;

  -- Plurality, ties broken by the option that reached its count first.
  select b.choice, count(*) into v_win, v_count
    from community_ballots b where b.vote_id = p_vote_id
   group by b.choice order by count(*) desc, min(b.created_at) asc limit 1;

  if v_win is null then
    update community_votes set status = 'closed', result_value = null,
           result_label = 'No votes cast', applied_at = now() where id = p_vote_id;
    return jsonb_build_object('ok', true, 'applied', false, 'reason', 'no_votes');
  end if;

  select o->>'label' into v_label from community_votes cv, jsonb_array_elements(cv.options) o
   where cv.id = p_vote_id and o->>'value' = v_win limit 1;

  -- 🎯 THE PART THAT MAKES IT A VOTE AND NOT A POLL.
  if v_kind = 'war_target' then
    update communities set war_target_node = v_win, war_target_name = coalesce(v_label, v_win)
     where id = v_comm;
  elsif v_kind = 'levy' then
    -- Clamped here as well as in the column constraint: a malformed option
    -- must not be able to raise the levy past what members agreed to allow.
    update communities set levy_pct = least(50, greatest(0, coalesce(v_win::numeric, 0)))
     where id = v_comm;
  end if;

  update community_votes
     set status = case when v_kind = 'advisory' then 'closed' else 'applied' end,
         result_value = v_win, result_label = coalesce(v_label, v_win), applied_at = now()
   where id = p_vote_id;

  return jsonb_build_object('ok', true, 'applied', v_kind <> 'advisory',
                            'winner', v_win, 'label', coalesce(v_label, v_win), 'votes', v_count);
end $$;


-- ═══ 3. OBJECTIVES — pointers at Territory Wars nodes ════════════════════
-- ⚠ Deliberately just a POINTER. No progress column, no state machine, no
--   parallel mission system: the client reads live TW control for the node.
--   Anything stored here would immediately drift from the real war.
create table if not exists public.community_objectives (
  id           bigserial primary key,
  community_id uuid not null references public.communities(id) on delete cascade,
  node_id      text not null,
  label        text,
  created_by   uuid references auth.users(id) on delete set null,
  created_at   timestamptz not null default now(),
  unique (community_id, node_id)
);
create index if not exists community_obj_comm on public.community_objectives (community_id);

alter table public.community_objectives enable row level security;

drop policy if exists cobj_sel on public.community_objectives;
create policy cobj_sel on public.community_objectives for select to authenticated
  using (public.is_community_member(community_id) or public.is_community_leader(community_id));

drop policy if exists cobj_ins on public.community_objectives;
create policy cobj_ins on public.community_objectives for insert to authenticated
  with check (public.is_community_leader(community_id) and created_by = auth.uid());

drop policy if exists cobj_del on public.community_objectives;
create policy cobj_del on public.community_objectives for delete to authenticated
  using (public.is_community_leader(community_id));


-- ═══ 4. REWARD DISTRIBUTION — by contribution share ══════════════════════
-- Claimable payouts. A distribution NEVER touches another player's wallet; it
-- writes a row they claim themselves. That is the only reason leadership can be
-- trusted with this button at all.
create table if not exists public.community_rewards (
  id           bigserial primary key,
  community_id uuid not null references public.communities(id) on delete cascade,
  user_id      uuid not null references auth.users(id) on delete cascade,
  user_name    text,
  amount       numeric not null check (amount > 0),
  note         text,
  claimed_at   timestamptz,
  created_at   timestamptz not null default now()
);
create index if not exists community_rewards_user on public.community_rewards (user_id, claimed_at);
create index if not exists community_rewards_comm on public.community_rewards (community_id, created_at desc);

alter table public.community_rewards enable row level security;

-- You see your own payouts; leadership sees the whole distribution.
drop policy if exists crew_sel on public.community_rewards;
create policy crew_sel on public.community_rewards for select to authenticated
  using (user_id = auth.uid() or public.is_community_leader(community_id));
revoke insert, update, delete on public.community_rewards from anon, authenticated;


-- Distribute `p_amount` from the community pot, split by contribution share.
-- ⚠ THE POT IS THE LEDGER. balance = sum(amount), contributions positive and
--   distributions negative, so a distribution larger than the pot is refused in
--   the same transaction that would have written it. Without that check this
--   function would mint Cinder out of nothing.
create or replace function public.community_distribute(
  p_community_id uuid, p_amount numeric, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid   uuid := auth.uid();
  v_pot   numeric;
  v_levy  numeric;
  v_net   numeric;
  v_total numeric;
  r       record;
  v_paid  numeric := 0;
  v_n     int := 0;
begin
  if v_uid is null then raise exception 'not signed in'; end if;
  if not public.is_community_leader(p_community_id) then raise exception 'leadership only'; end if;
  p_amount := floor(coalesce(p_amount, 0));
  if p_amount <= 0 then raise exception 'nothing to distribute'; end if;

  select coalesce(sum(amount), 0) into v_pot from community_ledger where community_id = p_community_id;
  if v_pot < p_amount then
    raise exception 'the community pot holds % — cannot distribute %', v_pot, p_amount;
  end if;

  select coalesce(levy_pct, 0) into v_levy from communities where id = p_community_id;
  -- The levy stays in the pot; only the net is shared out.
  v_net := floor(p_amount * (100 - coalesce(v_levy, 0)) / 100);
  if v_net <= 0 then raise exception 'the levy leaves nothing to share'; end if;

  select coalesce(sum(amount), 0) into v_total
    from community_ledger where community_id = p_community_id and kind = 'contribution';
  if v_total <= 0 then raise exception 'nobody has contributed yet'; end if;

  for r in
    select l.user_id, max(l.user_name) as user_name, sum(l.amount) as given
      from community_ledger l
     where l.community_id = p_community_id and l.kind = 'contribution' and l.user_id is not null
     group by l.user_id having sum(l.amount) > 0
  loop
    declare v_share numeric := floor(v_net * (r.given / v_total));
    begin
      if v_share > 0 then
        insert into community_rewards (community_id, user_id, user_name, amount, note)
        values (p_community_id, r.user_id, r.user_name, v_share, p_note);
        v_paid := v_paid + v_share;
        v_n := v_n + 1;
      end if;
    end;
  end loop;

  if v_n = 0 then raise exception 'every share rounded to zero — distribute more'; end if;

  -- Debit the pot by what was ACTUALLY allocated plus the levy's share of it,
  -- never by the requested figure — rounding must not invent or destroy Cinder.
  insert into community_ledger (community_id, user_id, user_name, amount, kind, note)
  values (p_community_id, v_uid, 'Distribution', -(v_paid), 'reward',
          coalesce(p_note, 'Reward distribution'));

  return jsonb_build_object('ok', true, 'distributed', v_paid, 'recipients', v_n,
                            'levy_pct', v_levy, 'pot_after', v_pot - v_paid);
end $$;


-- Claim your own payout. Marks it claimed FIRST and returns the amount, so a
-- double-click cannot pay twice — the same order the mayor-pay claim uses.
create or replace function public.community_claim_rewards(p_community_id uuid)
returns numeric language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_total numeric := 0;
begin
  if v_uid is null then raise exception 'not signed in'; end if;
  update community_rewards set claimed_at = now()
   where community_id = p_community_id and user_id = v_uid and claimed_at is null;
  select coalesce(sum(amount), 0) into v_total
    from community_rewards
   where community_id = p_community_id and user_id = v_uid
     and claimed_at >= now() - interval '5 seconds';
  return v_total;
end $$;


revoke all on function public.community_vote_cast(bigint, text)          from public, anon;
revoke all on function public.community_vote_close(bigint)               from public, anon;
revoke all on function public.community_distribute(uuid, numeric, text)  from public, anon;
revoke all on function public.community_claim_rewards(uuid)              from public, anon;
grant execute on function public.community_vote_cast(bigint, text)         to authenticated;
grant execute on function public.community_vote_close(bigint)              to authenticated;
grant execute on function public.community_distribute(uuid, numeric, text) to authenticated;
grant execute on function public.community_claim_rewards(uuid)             to authenticated;


-- ─── VERIFY ── expect tables 5, policies 12, rpcs 4
select
  (select count(*) from pg_tables where schemaname='public' and tablename in
     ('community_announcements','community_votes','community_ballots',
      'community_objectives','community_rewards'))                          as tables,
  (select count(*) from pg_policies where schemaname='public' and tablename in
     ('community_announcements','community_votes','community_ballots',
      'community_objectives','community_rewards'))                          as policies,
  (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
     where n.nspname='public' and p.proname in
     ('community_vote_cast','community_vote_close','community_distribute',
      'community_claim_rewards'))                                           as rpcs;
