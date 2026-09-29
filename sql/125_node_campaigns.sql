-- ===========================================================================
-- 038 — NODE CAMPAIGNS. Relief drives players can "Do" on a City Node.
--
-- The node drawer's "⚔ Attack PRN" button became "🎯 Do Campaign". A campaign
-- is an admin-authored drive attached to ONE node ("Standing With El Paso":
-- give the node food, water, crude oil and Cinder — 500,000,000 of each).
-- Giving puts the player on the campaign leaderboard and earns Mythic Token
-- airdrops. The other half of a campaign is a roguelite MISSION (built in the
-- Guide / roguelite map by the admin) that the client routes to by name.
--
-- Three tables + two RPCs, all idempotent, all with RLS in this file:
--
--   node_campaigns          — the definitions. Admin-writable, everyone reads.
--   node_campaign_contribs  — APPEND-ONLY ledger of every gift. Progress and
--                             the leaderboard are sum(amount). Never updated.
--   node_campaign_airdrops  — APPEND-ONLY Ⓜ entitlements the give RPC mints.
--                             `status` is the ONE mutable column, admin-only,
--                             flipped to 'sent' once thirdweb delivers to the
--                             player's linked wallet (Bank of Ethos → 🦊).
--
--   node_campaign_give(...)  — the ONLY write path. Debits Cinder server-side
--                             on the canonical wallet (same UPDATE shape as
--                             wallet_charge in 023 — see the `g` alias note
--                             there), records the gift, mints the airdrop.
--   node_campaign_board(...) — aggregated progress + top 25 + my totals, so
--                             the client never sums a ledger of millions.
--
-- ⚠ Food / water / crude oil live CLIENT-SIDE (Profile.salvage). The server
--   cannot verify those, so the RPC only records them; the client spends first
--   and refunds if the record fails. Cinder IS server-authoritative and is
--   debited here, atomically with the ledger row — a gift can never debit
--   without recording or record without debiting.
--
-- 🔒 No client role can INSERT into either ledger. RLS is enabled with no
--   insert policy, which under RLS means "nobody" — the SECURITY DEFINER RPC
--   bypasses RLS and is the only writer.
--
-- Idempotent and re-runnable. Verify queries at the bottom.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 0. is_admin() — bootstrap ONLY if 021 was never applied here.
-- ---------------------------------------------------------------------------
do $bootstrap$
begin
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'is_admin'
  ) then
    execute $fn$
      create function public.is_admin() returns boolean
        language sql stable as $body$
        select lower(coalesce((auth.jwt() ->> 'email'), '')) in
          ('richaegisop@gmail.com', 'play@mythicsoa.com', 'dev@mythicspellbook.com')
      $body$;
    $fn$;
  end if;
end
$bootstrap$;

-- ---------------------------------------------------------------------------
-- 1. DEFINITIONS
-- ---------------------------------------------------------------------------
create table if not exists public.node_campaigns (
  id                      text primary key,
  node_id                 text not null,
  kind                    text not null default 'relief',
  name                    text not null,
  icon                    text not null default '🤝',
  tagline                 text,
  description             text,
  -- {"food":500000000,"water":500000000,"crudeOil":500000000,"cinder":500000000}
  goals                   jsonb not null default '{}'::jsonb,
  -- The roguelite campaign this drive's MISSION button opens. Matched by name
  -- (case-insensitive) against the published roguelite campaign list, or by
  -- mission_id when the admin pins one.
  mission_name            text,
  mission_id              text,
  -- Ⓜ minted per 1,000,000 units given (any resource, Cinder included).
  airdrop_mt_per_million  numeric not null default 1,
  active                  boolean not null default true,
  created_by              uuid,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);
create index if not exists node_campaigns_node_idx on public.node_campaigns (node_id) where active;

alter table public.node_campaigns enable row level security;
drop policy if exists nc_sel on public.node_campaigns;
create policy nc_sel on public.node_campaigns
  for select to authenticated using (true);
drop policy if exists nc_ins on public.node_campaigns;
create policy nc_ins on public.node_campaigns
  for insert to authenticated with check (public.is_admin());
drop policy if exists nc_upd on public.node_campaigns;
create policy nc_upd on public.node_campaigns
  for update to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists nc_del on public.node_campaigns;
create policy nc_del on public.node_campaigns
  for delete to authenticated using (public.is_admin());

-- ---------------------------------------------------------------------------
-- 2. GIFT LEDGER — append-only. Balance = sum(amount).
-- ---------------------------------------------------------------------------
create table if not exists public.node_campaign_contribs (
  id           bigserial primary key,
  campaign_id  text not null references public.node_campaigns(id) on delete cascade,
  node_id      text not null,
  user_id      uuid not null,
  user_name    text,
  resource     text not null,
  amount       bigint not null check (amount > 0),
  created_at   timestamptz not null default now()
);
create index if not exists ncc_campaign_user_idx on public.node_campaign_contribs (campaign_id, user_id);
create index if not exists ncc_campaign_res_idx  on public.node_campaign_contribs (campaign_id, resource);

alter table public.node_campaign_contribs enable row level security;
-- Everyone signed in may READ (it is a public leaderboard). Nobody may write:
-- there is deliberately no insert / update / delete policy.
drop policy if exists ncc_sel on public.node_campaign_contribs;
create policy ncc_sel on public.node_campaign_contribs
  for select to authenticated using (true);
drop policy if exists ncc_ins on public.node_campaign_contribs;
drop policy if exists ncc_upd on public.node_campaign_contribs;
drop policy if exists ncc_del on public.node_campaign_contribs;

-- ---------------------------------------------------------------------------
-- 3. AIRDROP ENTITLEMENTS — minted by the RPC, delivered by hand via thirdweb.
-- ---------------------------------------------------------------------------
create table if not exists public.node_campaign_airdrops (
  id            bigserial primary key,
  campaign_id   text not null references public.node_campaigns(id) on delete cascade,
  user_id       uuid not null,
  mt_amount     numeric not null check (mt_amount > 0),
  reason        text,
  status        text not null default 'pending' check (status in ('pending', 'sent', 'void')),
  tx_hash       text,
  fulfilled_at  timestamptz,
  created_at    timestamptz not null default now()
);
create index if not exists nca_user_idx   on public.node_campaign_airdrops (user_id, campaign_id);
create index if not exists nca_status_idx on public.node_campaign_airdrops (status) where status = 'pending';

alter table public.node_campaign_airdrops enable row level security;
-- A player sees ONLY their own entitlements; an admin sees the whole queue.
drop policy if exists nca_sel on public.node_campaign_airdrops;
create policy nca_sel on public.node_campaign_airdrops
  for select to authenticated using (user_id = auth.uid() or public.is_admin());
-- Admin flips status / tx_hash after sending. Nobody inserts or deletes.
drop policy if exists nca_upd on public.node_campaign_airdrops;
create policy nca_upd on public.node_campaign_airdrops
  for update to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists nca_ins on public.node_campaign_airdrops;
drop policy if exists nca_del on public.node_campaign_airdrops;

-- ---------------------------------------------------------------------------
-- 4. GIVE — the only write path.
-- ---------------------------------------------------------------------------
create or replace function public.node_campaign_give(
  p_campaign_id text, p_resource text, p_amount bigint)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid     uuid := auth.uid();
  v_camp    public.node_campaigns%rowtype;
  v_name    text;
  v_bal     bigint;
  v_seq     bigint;
  v_before  bigint;
  v_after   bigint;
  v_mt      numeric;
  v_rate    numeric;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', 'not_authenticated');
  end if;
  if p_amount is null or p_amount <= 0 or p_amount > 1000000000000 then
    return jsonb_build_object('ok', false, 'error', 'bad_amount');
  end if;

  select * into v_camp from public.node_campaigns where id = p_campaign_id;
  if not found or not v_camp.active then
    return jsonb_build_object('ok', false, 'error', 'no_campaign');
  end if;
  -- Only a resource the campaign actually asks for.
  if p_resource is null or not (v_camp.goals ? p_resource) then
    return jsonb_build_object('ok', false, 'error', 'bad_resource');
  end if;

  -- 🔥 Cinder is debited HERE, on the canonical wallet, in the same
  --    transaction as the ledger row. Same UPDATE shape as wallet_charge (023):
  --    the `g` alias is load-bearing there and kept here for the same reason.
  --    No Foundation Tax — a relief gift is not a purchase.
  if p_resource = 'cinder' then
    insert into public.user_progress (user_id) values (v_uid) on conflict (user_id) do nothing;
    update public.user_progress g
       set cinder     = g.cinder - p_amount,
           wallet_seq = g.wallet_seq + 1,
           updated_at = now()
     where g.user_id = v_uid and g.cinder >= p_amount
     returning g.cinder, g.wallet_seq into v_bal, v_seq;
    if v_bal is null then
      select g.cinder into v_bal from public.user_progress g where g.user_id = v_uid;
      return jsonb_build_object('ok', false, 'error', 'insufficient', 'balance', coalesce(v_bal, 0));
    end if;
    -- Keep the profile mirror in step on the way DOWN (021 ~870 explains why).
    update public.user_profiles set gems = v_bal where user_id = v_uid and coalesce(gems, 0) > v_bal;
    begin
      insert into public.wallet_ledger (user_id, op, resource, delta, balance_after, reason)
        values (v_uid, 'charge', 'cinder', -p_amount, v_bal, 'Node campaign gift: ' || v_camp.name);
    exception when undefined_table or undefined_column then null;
    end;
  end if;

  -- Identity is derived, never accepted (012).
  select nullif(btrim(coalesce(display_name, '')), '') into v_name
    from public.user_profiles where user_id = v_uid;
  v_name := left(coalesce(v_name, 'Survivor'), 40);

  select coalesce(sum(amount), 0) into v_before
    from public.node_campaign_contribs
   where campaign_id = v_camp.id and user_id = v_uid;

  insert into public.node_campaign_contribs (campaign_id, node_id, user_id, user_name, resource, amount)
    values (v_camp.id, v_camp.node_id, v_uid, v_name, p_resource, p_amount);

  -- Ⓜ Airdrop: whole millions crossed by THIS gift, at the campaign's rate.
  v_after := v_before + p_amount;
  v_rate  := coalesce(v_camp.airdrop_mt_per_million, 0);
  v_mt    := floor(v_after / 1000000.0) * v_rate - floor(v_before / 1000000.0) * v_rate;
  if v_mt > 0 then
    insert into public.node_campaign_airdrops (campaign_id, user_id, mt_amount, reason)
      values (v_camp.id, v_uid, v_mt, 'Crossed ' || floor(v_after / 1000000.0)::text || 'M given to ' || v_camp.name);
  end if;

  return jsonb_build_object('ok', true,
                            'my_total', v_after,
                            'mt_awarded', coalesce(v_mt, 0),
                            'new_balance', v_bal,
                            'wallet_seq', v_seq);
end $$;
revoke all on function public.node_campaign_give(text, text, bigint) from public, anon;
grant execute on function public.node_campaign_give(text, text, bigint) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. BOARD — aggregated read.
-- ---------------------------------------------------------------------------
create or replace function public.node_campaign_board(p_campaign_id text)
returns jsonb
language plpgsql security definer stable set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_totals jsonb;
  v_top    jsonb;
  v_mine   jsonb;
  v_my_mt  numeric;
  v_n      int;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', 'not_authenticated');
  end if;
  select coalesce(jsonb_object_agg(resource, total), '{}'::jsonb) into v_totals
    from (select resource, sum(amount) as total
            from public.node_campaign_contribs where campaign_id = p_campaign_id
           group by resource) t;
  select coalesce(jsonb_agg(row_to_json(l)), '[]'::jsonb) into v_top
    from (select user_id, max(user_name) as user_name, sum(amount) as total,
                 max(created_at) as last_at
            from public.node_campaign_contribs where campaign_id = p_campaign_id
           group by user_id order by sum(amount) desc, max(created_at) asc limit 25) l;
  select coalesce(jsonb_object_agg(resource, total), '{}'::jsonb) into v_mine
    from (select resource, sum(amount) as total
            from public.node_campaign_contribs
           where campaign_id = p_campaign_id and user_id = v_uid
           group by resource) m;
  select coalesce(sum(mt_amount), 0) into v_my_mt
    from public.node_campaign_airdrops where campaign_id = p_campaign_id and user_id = v_uid and status <> 'void';
  select count(distinct user_id) into v_n
    from public.node_campaign_contribs where campaign_id = p_campaign_id;
  return jsonb_build_object('ok', true, 'totals', v_totals, 'top', v_top,
                            'mine', v_mine, 'my_mt', v_my_mt, 'contributors', v_n);
end $$;
revoke all on function public.node_campaign_board(text) from public, anon;
grant execute on function public.node_campaign_board(text) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. SEED — Standing With El Paso. node_id is the drawer's node id (the crumb
--    reads "N-42 · S-ASH"); the client ALSO matches the seed by node name, so
--    if the id differs on this project, fix it from the drawer's admin form.
-- ---------------------------------------------------------------------------
insert into public.node_campaigns
  (id, node_id, kind, name, icon, tagline, description, goals, mission_name, airdrop_mt_per_million, active)
values
  ('elpaso_relief', 'N-42', 'relief', 'Standing With El Paso', '🤝',
   'Help make El Paso a better place.',
   'El Paso is collapsing. Give the node food, water, crude oil and Cinder — 500,000,000 of each — to bring it back. Every gift lands on the leaderboard and earns Mythic Token airdrops.',
   '{"food":500000000,"water":500000000,"crudeOil":500000000,"cinder":500000000}'::jsonb,
   'Standing With El Paso', 1, true)
on conflict (id) do nothing;

-- ===========================================================================
-- VERIFY
-- ===========================================================================
select tablename, policyname, cmd
  from pg_policies
 where schemaname = 'public' and tablename like 'node_campaign%'
 order by tablename, cmd, policyname;
-- expect: node_campaign_airdrops (SELECT, UPDATE); node_campaign_contribs (SELECT);
--         node_campaigns (SELECT, INSERT, UPDATE, DELETE)
-- select id, node_id, name, goals from public.node_campaigns;   -- one seed row
