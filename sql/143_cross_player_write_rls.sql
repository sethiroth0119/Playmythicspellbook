-- ============================================================================
-- 143 — NO PLAYER CAN REWRITE ANOTHER PLAYER'S ROWS
-- Project: ktsiasyjusesawtrwrjc
-- Status: DRAFT — NOT APPLIED. Needs the owner's OK. RLS + two guard triggers
-- only: no table, column or row is created, altered or touched.
-- ----------------------------------------------------------------------------
-- MEASURED 2026-09-17 (pg_policies): 27 write policies in `public` had a bare
-- `true` in USING or WITH CHECK. 19 of them are on the tables below (this file
-- closes 18; gyms.gym_upd keeps USING true behind a guard trigger), and with
-- them any signed-in player could, from the browser console:
--   · wipe or rename another player's gym, swap their defence deck, zero their
--     level                                   (gyms.gym_upd  using true)
--   · pause, rewrite or DELETE any sponsor ad (tw_node_ads upd/del using true)
--   · rewrite any court case — verdict, sentence, judge — and forge a
--     Criminal Registry entry against anyone  (ccz_upd, crr_ins  true)
--   · advance the gym season                  (gym_meta.gm_upd true)
--   · rewrite or delete the territory map, the admin decks and the site feed
--   · post world-feed lines as another player (twwf_ins true)
--   · DELETE every shared exchange price      (cx_prices.cxp_write, FOR ALL true —
--     it silently OR-ed away the updated_by stamp its sibling policies demand)
--
-- 🔴 WHY GYMS ARE A TRIGGER AND NOT `using (leader_id = auth.uid())`.
-- The shipped client writes OTHER players' gym rows on purpose, three ways:
--   index.html gymClaim          `.from('gyms').upsert(row,{onConflict:'core_id'})`
--       — the winner takes over the loser's row (leader_id Y → X)
--   index.html gymRecordDefense  `.from('gyms').update({defense_streak …})
--       .eq('leader_id', row.leader_id)` — the LOSING challenger books the
--       defender's win on the defender's row
--   index.html gymContribute     `.from('gyms').update({stamina …})` — a
--       supporter boosts the leader's stamina
-- An owner-only USING turns all three into silent no-ops (the client ignores
-- the update error) and Gym Wars stops working. So the row stays reachable and
-- a BEFORE UPDATE trigger decides WHICH COLUMNS a non-leader may move and how
-- far: a takeover must be to yourself and start at streak 0; anybody else may
-- only add ONE defence and move stamina inside 0..100. Name, hero, deck,
-- cosmetic, level, HQ, season, claimed_at and last_seen belong to the leader.
-- ⚠ Known trust gap, unchanged by this file: nothing server-side knows who won
-- the battle, so a takeover is still client-asserted. Closing that needs a
-- battle-result RPC and a client change (outside this migration's lane).
--
-- 🔴 WHY COURT CASES ARE A TRIGGER TOO. courtTakeRole lets a registered lawyer
-- write prosecutor_name/defender_name onto a case some OTHER judge presides
-- over. So officials keep row access; the trigger limits a lawyer to filling an
-- EMPTY representation slot, a judge to an EMPTY bench (or the case they
-- already preside over), and nobody but an admin may edit the filing itself.
-- ⚠ court_officials.cof_ins lets a player register themselves with any role,
-- so "judge" is self-declared today. Out of this file's scope; noted.
--
-- 🔴 WHY THE AD POLICIES KNOW ABOUT NODE MANAGERS. _esnCanManageNode shows a
-- node's owner Pause and ✕ on EVERY ad on their node, including the three
-- studio-created ads live today (created_by = the studio account). An
-- owner-only predicate would break those buttons, so a node's manager —
-- tw_node_owners.user_id, or a member of the tw_ownership corp — keeps them.
-- A non-admin can no longer publish an ad as 'active' (the client submits
-- 'pending' and only the admin Approve button activates), which closes the
-- self-approval hole the same open policy left.
--
-- WORLD / ADMIN TABLES — client-writer audit (grep of public/, 2026-09-17):
--   tw_defense_data, tw_node_capture_progress, tw_guard_decks,
--   tw_node_shop_upgrades, tw_regions, tw_sectors, tw_territories
--       → NO client writer anywhere in the repo (only the schema files), and all
--         seven tables hold 0 rows live. Admin-only; service_role and the SQL
--         editor bypass RLS as before.
--   site_updates → written only by abraxascodex "with its own credentials"
--         (worker.js header, API.md); 0 rows. Admin-only. ⚠ If that backend
--         uses a normal signed-in account rather than its service key, that
--         account must be an admin (public.is_admin()).
--   gym_meta     → gymAdvanceSeason, already gated client-side on isAdmin().
--   tw_ownership → tw_cloudUpsertOwnership (capture, upserts onto the previous
--         owner's row — so UPDATE stays reachable) and the admin 💥 reset
--         (`.delete().neq('node_id','__noop__')`). The new owner must be a
--         corp the caller belongs to; delete is admin-only.
--         ⚠ owner_corp_id is a tw_corporations id, which by design is the
--         same uuid as corporations.id (tw_my_corp_id() reads corp_members),
--         so is_corp_member() is the right question. But tw_territories and
--         tw_corporations are both EMPTY live, so the node_id / owner_corp_id
--         foreign keys already refuse every client capture today (that is why
--         tw_ownership has 0 rows). Pre-existing, not caused by this file;
--         proven here with seeded fixture rows inside the rolled-back probe.
--   tw_world_feed → tw_cloudPostFeed inserts {actor: me, corp_id: my corp}.
--         All 8,291 live rows satisfy the new check (measured: 0 violators;
--         every one has corp_id null, because the same tw_corporations FK
--         refuses a non-null corp today).
--   cx_prices    → _cxCloudFlush upserts {…, updated_by: me}. The exchange
--         tape is client-ticked by whoever trades, so update stays open to
--         every row; the stamp is now actually enforced. Nothing deletes.
--
-- ⚠ CORP MEMBERSHIP IS NOT YET A TRUST BOUNDARY. corp_members.cm_ins is
-- `with check (user_id = auth.uid())` and cm_upd lets a player move their own
-- row to any corp_id, so a player can make themselves a "member" of any corp.
-- Every is_corp_member() check below (territory owner, world-feed corp, an
-- ad manager through tw_ownership) is therefore only as strong as that table.
-- Today the practical exposure is nil — tw_ownership is empty and FK-blocked
-- (see above) — but closing cm_ins/cm_upd behind corp_hire is the follow-up
-- that makes these checks real. Not done here: it changes the Corp join flow.
--
-- The admin check is the one the app already has: public.is_admin() (JWT
-- email list, same set as index.html ADMIN_EMAILS). The triggers let
-- service_role / postgres / SECURITY DEFINER RPCs through by checking
-- current_user, not auth.uid(): a missing uid must never mean "trusted".
--
-- Idempotent: every policy is dropped by name first, every function is
-- `create or replace`, every trigger is dropped first. Re-runnable.
-- ============================================================================


-- ── helpers ──────────────────────────────────────────────────────────────────
-- A node's manager: the admin-assigned player owner, or a member of the corp
-- that holds it in the territory war. SECURITY DEFINER so the policy on
-- tw_node_ads does not depend on the read policies of the two tables it asks.
create or replace function public.tw_node_ad_manager(p_node_id text)
returns boolean
language sql
stable
security definer
set search_path = public
as $fn$
  select p_node_id is not null
     and auth.uid() is not null
     and (
       exists (select 1 from public.tw_node_owners o
                where o.node_id = p_node_id and o.user_id = auth.uid())
       or exists (select 1 from public.tw_ownership w
                   where w.node_id = p_node_id
                     and public.is_corp_member(w.owner_corp_id, auth.uid()))
     );
$fn$;
revoke all on function public.tw_node_ad_manager(text) from public;
grant execute on function public.tw_node_ad_manager(text) to authenticated;


-- ── gyms ─────────────────────────────────────────────────────────────────────
create or replace function public.gyms_guard_cross_player()
returns trigger
language plpgsql
set search_path = public
as $fn$
declare
  v_uid uuid := auth.uid();
begin
  -- service_role, the SQL editor and SECURITY DEFINER RPCs are trusted already.
  if current_user not in ('authenticated', 'anon') or public.is_admin() then
    return new;
  end if;
  if v_uid is null then
    raise exception 'gyms: sign in to write a gym' using errcode = '42501';
  end if;
  if new.core_id is distinct from old.core_id then
    raise exception 'gyms: a gym core cannot be renamed' using errcode = '42501';
  end if;

  -- 1. Your own reign: gymReinforceStamina, gymUpgradeLevel, gymSetMotto,
  --    gymHeartbeat. Anything goes except handing the gym to someone else.
  if old.leader_id = v_uid then
    if new.leader_id is distinct from v_uid then
      raise exception 'gyms: a leader cannot hand a gym to another player' using errcode = '42501';
    end if;
    return new;
  end if;

  -- 2. A takeover (gymClaim). Only to yourself, and a fresh reign starts at
  --    zero; the level and HQ are bought by a leader, never claimed.
  if new.leader_id = v_uid then
    if coalesce(new.defense_streak, 0) <> 0 or coalesce(new.peak_streak, 0) <> 0 then
      raise exception 'gyms: a new reign starts with no streak' using errcode = '42501';
    end if;
    if new.gym_level is distinct from old.gym_level or new.hq is distinct from old.hq then
      raise exception 'gyms: level and HQ are not part of a claim' using errcode = '42501';
    end if;
    return new;
  end if;

  -- 3. Someone else's reign: only gymRecordDefense and gymContribute get here.
  if old.leader_id is null then
    raise exception 'gyms: nobody leads this gym — claim it instead' using errcode = '42501';
  end if;
  if new.leader_id is distinct from old.leader_id then
    raise exception 'gyms: a gym can only be taken by its challenger' using errcode = '42501';
  end if;
  if (new.leader_name, new.leader_hero_id, new.leader_hero_name, new.leader_deck,
      new.leader_cosmetic, new.gym_level, new.hq, new.season, new.claimed_at, new.last_seen)
     is distinct from
     (old.leader_name, old.leader_hero_id, old.leader_hero_name, old.leader_deck,
      old.leader_cosmetic, old.gym_level, old.hq, old.season, old.claimed_at, old.last_seen) then
    raise exception 'gyms: only the leader edits their gym' using errcode = '42501';
  end if;
  -- ⚠ A challenger with a stale cache sends cached+1, which can be <= the
  -- stored streak after a concurrent defence; that one booking is refused
  -- rather than letting anybody LOWER a streak.
  if coalesce(new.defense_streak, 0) not in (coalesce(old.defense_streak, 0), coalesce(old.defense_streak, 0) + 1) then
    raise exception 'gyms: a defence adds exactly one to the streak' using errcode = '42501';
  end if;
  -- Derived, not accepted (the sql/099 rule): the peak is the stored peak or
  -- the new streak, whichever is higher. A stale cached peak is corrected.
  new.peak_streak := greatest(coalesce(old.peak_streak, 0), coalesce(new.defense_streak, 0));
  -- 100 = GYM_STAMINA_MAX in index.html.
  if new.stamina is null or new.stamina < 0 or new.stamina > 100 then
    raise exception 'gyms: stamina is 0..100' using errcode = '42501';
  end if;
  return new;
end $fn$;

drop trigger if exists gyms_guard_cross_player on public.gyms;
create trigger gyms_guard_cross_player
  before update on public.gyms
  for each row execute function public.gyms_guard_cross_player();

drop policy if exists gym_ins on public.gyms;
create policy gym_ins on public.gyms for insert to authenticated
  with check (leader_id = auth.uid() or public.is_admin());
-- USING stays true on purpose: see the header (claim / defence / supporter).
-- The trigger above is the column-level boundary; the check here is only that
-- a non-admin never leaves a gym leaderless.
drop policy if exists gym_upd on public.gyms;
create policy gym_upd on public.gyms for update to authenticated
  using (true)
  with check (leader_id is not null or public.is_admin());

drop policy if exists gm_upd on public.gym_meta;
create policy gm_upd on public.gym_meta for update to authenticated
  using (public.is_admin()) with check (public.is_admin());


-- ── tw_node_ads ──────────────────────────────────────────────────────────────
drop policy if exists tw_node_ads_ins on public.tw_node_ads;
create policy tw_node_ads_ins on public.tw_node_ads for insert to authenticated
  with check (
    created_by = auth.uid()
    and (public.is_admin()
         or (public.tw_node_ad_manager(node_id) and status in ('pending', 'paused')))
  );
drop policy if exists tw_node_ads_upd on public.tw_node_ads;
create policy tw_node_ads_upd on public.tw_node_ads for update to authenticated
  using (public.is_admin() or created_by = auth.uid() or public.tw_node_ad_manager(node_id))
  with check (
    public.is_admin()
    or ((created_by = auth.uid() or public.tw_node_ad_manager(node_id))
        and status in ('pending', 'paused'))
  );
drop policy if exists tw_node_ads_del on public.tw_node_ads;
create policy tw_node_ads_del on public.tw_node_ads for delete to authenticated
  using (public.is_admin() or created_by = auth.uid() or public.tw_node_ad_manager(node_id));


-- ── court_cases / court_records ─────────────────────────────────────────────
create or replace function public.court_cases_guard_update()
returns trigger
language plpgsql
set search_path = public
as $fn$
declare
  v_uid  uuid := auth.uid();
  v_role text;
begin
  if current_user not in ('authenticated', 'anon') or public.is_admin() then
    return new;
  end if;
  -- The filing is the plaintiff's statement; nobody but an admin edits it.
  if (new.id, new.case_no, new.plaintiff_id, new.plaintiff_name, new.defendant_name,
      new.crime_type, new.severity, new.summary, new.filed_by, new.filed_at)
     is distinct from
     (old.id, old.case_no, old.plaintiff_id, old.plaintiff_name, old.defendant_name,
      old.crime_type, old.severity, old.summary, old.filed_by, old.filed_at) then
    raise exception 'court: the filing itself cannot be edited' using errcode = '42501';
  end if;
  select o.role into v_role from public.court_officials o where o.user_id = v_uid;

  -- courtRule (presiding) and courtTakeRole('judge') / courtRule on an empty bench.
  if old.judge_id = v_uid
     or (old.judge_id is null and v_role = 'judge' and new.judge_id = v_uid) then
    if new.judge_id is distinct from v_uid then
      raise exception 'court: a judge cannot hand the bench to someone else' using errcode = '42501';
    end if;
    return new;
  end if;

  -- courtTakeRole('prosecutor' | 'defender'): fill an EMPTY slot, nothing else.
  if v_role = 'lawyer' then
    if (new.status, new.judge_id, new.judge_name, new.verdict, new.sentence, new.court_date)
       is distinct from
       (old.status, old.judge_id, old.judge_name, old.verdict, old.sentence, old.court_date) then
      raise exception 'court: counsel cannot rule' using errcode = '42501';
    end if;
    if (old.prosecutor_name is not null and new.prosecutor_name is distinct from old.prosecutor_name)
       or (old.defender_name is not null and new.defender_name is distinct from old.defender_name) then
      raise exception 'court: that side is already represented' using errcode = '42501';
    end if;
    return new;
  end if;

  raise exception 'court: you are not an officer of this case' using errcode = '42501';
end $fn$;

drop trigger if exists court_cases_guard_update on public.court_cases;
create trigger court_cases_guard_update
  before update on public.court_cases
  for each row execute function public.court_cases_guard_update();

drop policy if exists ccz_upd on public.court_cases;
create policy ccz_upd on public.court_cases for update to authenticated
  using (
    judge_id = auth.uid()
    or public.is_admin()
    or exists (select 1 from public.court_officials o
                where o.user_id = auth.uid() and o.role in ('judge', 'lawyer'))
  )
  with check (
    judge_id is null
    or judge_id = auth.uid()
    or public.is_admin()
    or exists (select 1 from public.court_officials o
                where o.user_id = auth.uid() and o.role = 'lawyer')
  );

-- courtRule inserts the registry line right after closing the case as guilty.
-- The line must match that case: same presiding judge, same defendant.
drop policy if exists crr_ins on public.court_records;
create policy crr_ins on public.court_records for insert to authenticated
  with check (
    public.is_admin()
    or exists (select 1 from public.court_cases c
                where c.id = court_records.case_id
                  and c.judge_id = auth.uid()
                  and c.verdict = 'guilty'
                  and c.defendant_name = court_records.offender_name)
  );


-- ── cx_prices ────────────────────────────────────────────────────────────────
-- cx_prices_insert / cx_prices_update (updated_by = auth.uid()) already exist
-- and are what the client satisfies; the FOR ALL `true` policy only added
-- DELETE and an OR that cancelled the stamp.
drop policy if exists cxp_write on public.cx_prices;


-- ── tw_ownership ─────────────────────────────────────────────────────────────
drop policy if exists two_write on public.tw_ownership;
drop policy if exists two_ins on public.tw_ownership;
create policy two_ins on public.tw_ownership for insert to authenticated
  with check (public.is_admin() or public.is_corp_member(owner_corp_id, auth.uid()));
-- USING true: a capture overwrites the DEFENDING corp's row. The new owner
-- must be the caller's corp.
drop policy if exists two_upd on public.tw_ownership;
create policy two_upd on public.tw_ownership for update to authenticated
  using (true)
  with check (public.is_admin() or public.is_corp_member(owner_corp_id, auth.uid()));
drop policy if exists two_del on public.tw_ownership;
create policy two_del on public.tw_ownership for delete to authenticated
  using (public.is_admin());


-- ── tw_world_feed ────────────────────────────────────────────────────────────
drop policy if exists twwf_ins on public.tw_world_feed;
create policy twwf_ins on public.tw_world_feed for insert to authenticated
  with check (
    public.is_admin()
    or (actor = auth.uid()
        and (corp_id is null or public.is_corp_member(corp_id, auth.uid())))
  );


-- ── admin-only world tables ─────────────────────────────────────────────────
drop policy if exists twdd_write on public.tw_defense_data;
drop policy if exists twdd_admin_write on public.tw_defense_data;
create policy twdd_admin_write on public.tw_defense_data for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists twncp_write on public.tw_node_capture_progress;
drop policy if exists twncp_admin_write on public.tw_node_capture_progress;
create policy twncp_admin_write on public.tw_node_capture_progress for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists twgd_admin on public.tw_guard_decks;
create policy twgd_admin on public.tw_guard_decks for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists twnsu_admin on public.tw_node_shop_upgrades;
create policy twnsu_admin on public.tw_node_shop_upgrades for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists twr_admin on public.tw_regions;
create policy twr_admin on public.tw_regions for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists tws_admin on public.tw_sectors;
create policy tws_admin on public.tw_sectors for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists twt_admin on public.tw_territories;
create policy twt_admin on public.tw_territories for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists su_ins on public.site_updates;
create policy su_ins on public.site_updates for insert to authenticated
  with check (public.is_admin());
drop policy if exists su_upd on public.site_updates;
create policy su_upd on public.site_updates for update to authenticated
  using (public.is_admin()) with check (public.is_admin());


-- ── verify ───────────────────────────────────────────────────────────────────
-- Every write policy in `public` that still has a bare `true`, with the reason
-- it survives. Before this file: 27 rows. After: 10 rows, every one with a
-- reason. A row whose reason reads 'UNEXPECTED' is a regression.
select p.tablename, p.policyname, p.cmd,
       p.qual as using_expr, p.with_check,
       case p.tablename || '.' || p.policyname
         when 'gyms.gym_upd' then '143: claim/defence/supporter write another player''s row; gyms_guard_cross_player limits the columns'
         when 'tw_ownership.two_upd' then '143: a capture overwrites the defending corp''s row; WITH CHECK pins the new owner to the caller''s corp'
         when 'cx_prices.cx_prices_update' then '143: shared tape ticked by any trader; WITH CHECK enforces updated_by = caller; needs a price-tick RPC to close'
         when 'boe_market_listings.boe_mkt_upd' then 'out of 143''s scope: open auction row; WITH CHECK requires the caller to be seller, buyer or bidder'
         when 'boe_merc_posts.boe_mpost_upd' then 'out of 143''s scope: open post row; WITH CHECK requires poster or acceptor'
         when 'card_market_listings.cml_upd' then 'out of 143''s scope: USING is owner-or-open; WITH CHECK true lets a buyer rewrite an open listing — follow-up'
         when 'realty_listings.rl_upd' then 'out of 143''s scope: USING is party-or-open; WITH CHECK true — follow-up'
         when 'corp_requests.creq_upd' then 'out of 143''s scope: USING is applicant-or-founder; WITH CHECK true — follow-up'
         when 'community_corps.ccorp_upd' then 'out of 143''s scope: USING is leader/founder; WITH CHECK true — follow-up'
         when 'community_announcements.cann_upd' then 'out of 143''s scope: USING is community leader; WITH CHECK true — follow-up'
         else 'UNEXPECTED'
       end as why_it_stays
  from pg_policies p
 where p.schemaname = 'public'
   and p.cmd in ('INSERT', 'UPDATE', 'DELETE', 'ALL')
   and (coalesce(p.qual, '') = 'true' or coalesce(p.with_check, '') = 'true')
   and not ('service_role' = any (p.roles))
 order by (case when p.policyname in ('gym_upd', 'two_upd', 'cx_prices_update') then 0 else 1 end),
          p.tablename, p.policyname;
