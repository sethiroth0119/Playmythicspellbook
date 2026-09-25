-- ════════════════════════════════════════════════════════════════════════════
-- 147 · A NODE MANAGER CONTRACT NEEDS BOTH SIGNATURES (draft, NOT applied)
-- Project: ktsiasyjusesawtrwrjc
-- ----------------------------------------------------------------------------
-- THE HOLE (proven on live 2026-09-17 inside a rolled-back DO block: an
-- unrelated player was seated as Node Manager of N-28 at 100%, accept returned
-- ok:true; afterwards N-28 had no manager and mayor_offers still had 27 rows).
--
--   * policy mayor_offers_create let a CANDIDATE insert an offer naming ANY
--     node owner, with any player_pct and turn = null;
--   * policy mayor_offers_party_update let either party UPDATE every column —
--     player_pct, turn, last_actor, status, even owner_id;
--   * mayor_accept_offer only checked "caller is a party", "turn is null or
--     mine" and "owner_id still owns the node".
--   So a player wrote their own 100% contract and signed it alone. node_mayors
--   then hands them 100% of the owner's positive city deltas through
--   city_owner_ledger_apply (sql/121), and lets the manager's city actions
--   debit the owner's Cinder.
--
-- THE RULE: terms are signed by the party who did NOT write them last.
--   last_actor is set by the SERVER only (this trigger), never by the client;
--   mayor_accept_offer refuses the party who last set the terms. So every
--   contract carries both consents: the writer's (by writing) and the
--   other party's (by accepting).
--
-- WHY A TRIGGER AND NOT "REVOKE INSERT/UPDATE, RPCs ONLY": the negotiation UI
--   is the external Mayor Hall app (market-deploy, not in this repo; index.html
--   has no offer/counter call site) and it writes mayor_offers directly.
--   Revoking INSERT would break hiring the day this is applied, before that app
--   ships. So, for a direct client write:
--     - INSERT still works, but created_by, status, last_actor and turn are
--       overwritten by the server (writer = auth.uid(), the other party signs),
--       the owner must really own the node, and nobody can hire themselves;
--     - UPDATE may only decline an open offer (or touch note / node_name);
--       terms, turn, last_actor, parties and node are frozen and a write to
--       any of them is REFUSED; accepted / ended / countered are RPC-only;
--     - player_pct is 0..100, hours_per_month >= 0.
--   Counters go through mayor_offer_counter(); create / decline have RPCs too
--   (mayor_offer_create / mayor_offer_decline) for the app to move onto.
--
-- HOW THE TRIGGER TELLS A CLIENT FROM AN RPC: it is SECURITY INVOKER, so
--   current_user is 'authenticated'/'anon' for a PostgREST write and the
--   function owner (postgres) inside a SECURITY DEFINER RPC. The freeze rules
--   apply to the client roles only; accept/end/auto-decline keep working.
--   (A SECURITY DEFINER trigger would read current_user = postgres for every
--   write and silently exempt the client — do not "fix" it that way. The one
--   lookup it needs, node ownership, goes through a definer helper instead.)
--
-- Also: anon loses INSERT/UPDATE/DELETE on mayor_offers and
--   mayor_offer_events, and EXECUTE on mayor_accept_offer / mayor_end_contract
--   (anon has no auth.uid(), so these were dead grants, but they are grants).
--   node_mayors already has only a read policy — writes are RPC-only — and its
--   21 active rows are not touched by this file.
--
-- No new table, so no new RLS beyond the policies restated here. Re-runnable.
-- ════════════════════════════════════════════════════════════════════════════

-- ── helper: does uid own node? (definer: tw_node_owners RLS must not decide) ──
create or replace function public._mayor_node_owned(p_node_id text, p_uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $fn$
  select exists (select 1 from public.tw_node_owners w
                  where w.node_id = p_node_id and w.user_id = p_uid);
$fn$;
-- authenticated keeps EXECUTE: the guard trigger below is SECURITY INVOKER and
-- runs as the client's role. It answers only "does X own node Y", which
-- tw_node_owners already shows everyone.
revoke all on function public._mayor_node_owned(text, uuid) from public, anon;
grant execute on function public._mayor_node_owned(text, uuid) to authenticated;

-- ── the stamping / freezing trigger ─────────────────────────────────────────
create or replace function public.mayor_offers_guard()
returns trigger
language plpgsql
security invoker
set search_path = public
as $fn$
declare
  v_uid    uuid := auth.uid();
  v_client boolean := current_user in ('authenticated', 'anon');
begin
  if tg_op = 'INSERT' then
    if v_client then
      if v_uid is null then raise exception 'mayor_offers: sign in first' using errcode = '42501'; end if;
      new.created_by := v_uid;
      new.status := 'pending';
      if new.owner_id = new.candidate_id then
        raise exception 'mayor_offers: a node owner cannot manage their own node' using errcode = '42501';
      end if;
      if not public._mayor_node_owned(new.node_id, new.owner_id) then
        raise exception 'mayor_offers: owner_id does not own %', new.node_id using errcode = '42501';
      end if;
    end if;
    if new.player_pct is null or new.player_pct < 0 or new.player_pct > 100 then
      raise exception 'mayor_offers: player_pct must be 0..100' using errcode = '22023';
    end if;
    if new.hours_per_month is null or new.hours_per_month < 0 then
      raise exception 'mayor_offers: hours_per_month must be >= 0' using errcode = '22023';
    end if;
    -- The writer of the terms is whoever is signed in. The other party signs.
    new.last_actor := coalesce(v_uid, new.created_by);
    new.turn := case when new.last_actor = new.owner_id then new.candidate_id else new.owner_id end;
    new.created_at := now();
    new.updated_at := now();
    return new;
  end if;

  -- UPDATE
  if not v_client then
    -- An RPC (definer) wrote this row and did its own party/turn checks.
    new.updated_at := now();
    return new;
  end if;

  if v_uid is null then raise exception 'mayor_offers: sign in first' using errcode = '42501'; end if;
  if new.id <> old.id or new.node_id <> old.node_id or new.owner_id <> old.owner_id
     or new.candidate_id <> old.candidate_id or new.created_by <> old.created_by
     or new.created_at <> old.created_at then
    raise exception 'mayor_offers: the parties and node of an offer cannot change' using errcode = '42501';
  end if;
  -- TERMS ARE FROZEN AGAINST DIRECT CLIENT WRITES. A counter goes through
  -- mayor_offer_counter(), which checks it is the caller's turn and stamps
  -- last_actor itself. (Live on 2026-09-17 no offer had ever been countered —
  -- statuses were only accepted/declined/ended — so this breaks no flow in use.)
  if new.player_pct      is distinct from old.player_pct
     or new.currency        is distinct from old.currency
     or new.hours_per_month is distinct from old.hours_per_month
     or new.card_policy     is distinct from old.card_policy
     or new.resource_policy is distinct from old.resource_policy then
    raise exception 'mayor_offers: change terms through mayor_offer_counter' using errcode = '42501';
  end if;
  -- Who signs next is server-owned. Writing it was the second half of the hole.
  -- (A decline may send turn = null with it; that value is overwritten below.)
  if new.status is not distinct from old.status
     and (new.turn is distinct from old.turn or new.last_actor is distinct from old.last_actor) then
    raise exception 'mayor_offers: turn and last_actor are set by the server' using errcode = '42501';
  end if;
  if new.status is distinct from old.status then
    if old.status not in ('pending', 'countered') then
      raise exception 'mayor_offers: a closed offer stays closed' using errcode = '42501';
    end if;
    -- The only status a client may write is a refusal. accepted/ended/
    -- countered all belong to the RPCs.
    if new.status <> 'declined' then
      raise exception 'mayor_offers: status % is set by the server', new.status using errcode = '42501';
    end if;
    new.last_actor := v_uid;
    new.turn := null;
  end if;
  new.updated_at := now();
  return new;
end $fn$;

drop trigger if exists mayor_offers_guard on public.mayor_offers;
create trigger mayor_offers_guard
  before insert or update on public.mayor_offers
  for each row execute function public.mayor_offers_guard();

-- ── policies (restated; the trigger does the column-level work) ─────────────
alter table public.mayor_offers enable row level security;
drop policy if exists mayor_offers_create on public.mayor_offers;
create policy mayor_offers_create on public.mayor_offers
  for insert to authenticated
  with check (created_by = auth.uid() and (owner_id = auth.uid() or candidate_id = auth.uid()));
drop policy if exists mayor_offers_party_read on public.mayor_offers;
create policy mayor_offers_party_read on public.mayor_offers
  for select to authenticated
  using (owner_id = auth.uid() or candidate_id = auth.uid());
drop policy if exists mayor_offers_party_update on public.mayor_offers;
create policy mayor_offers_party_update on public.mayor_offers
  for update to authenticated
  using (owner_id = auth.uid() or candidate_id = auth.uid())
  with check (owner_id = auth.uid() or candidate_id = auth.uid());

revoke insert, update, delete on public.mayor_offers       from anon;
revoke insert, update, delete on public.mayor_offer_events from anon;

-- ── accept: the party who last set the terms cannot sign them ───────────────
create or replace function public.mayor_accept_offer(p_offer_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare o public.mayor_offers%rowtype;
begin
  select * into o from public.mayor_offers where id = p_offer_id for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  if auth.uid() is null or auth.uid() not in (o.owner_id, o.candidate_id) then
    return jsonb_build_object('ok', false, 'error', 'not_a_party');
  end if;
  if o.status not in ('pending', 'countered') then
    return jsonb_build_object('ok', false, 'error', 'closed');
  end if;
  -- 147: last_actor is server-stamped; a null one (pre-147 row) falls back to
  -- created_by, which the insert policy always pinned to the writer.
  if auth.uid() = coalesce(o.last_actor, o.created_by) then
    return jsonb_build_object('ok', false, 'error', 'other_party_must_accept');
  end if;
  if o.turn is not null and o.turn <> auth.uid() then
    return jsonb_build_object('ok', false, 'error', 'not_your_turn');
  end if;
  if o.owner_id = o.candidate_id then
    return jsonb_build_object('ok', false, 'error', 'self_hire');
  end if;
  if o.player_pct < 0 or o.player_pct > 100 then
    return jsonb_build_object('ok', false, 'error', 'bad_terms');
  end if;
  if not public._mayor_node_owned(o.node_id, o.owner_id) then
    return jsonb_build_object('ok', false, 'error', 'not_the_node_owner');
  end if;

  update public.mayor_offers
     set status = 'accepted', turn = null, last_actor = auth.uid(), updated_at = now()
   where id = o.id;

  insert into public.node_mayors (node_id, mayor_id, owner_id, offer_id, player_pct, currency,
                                  hours_per_month, card_policy, resource_policy, active, started_at, ended_at)
  values (o.node_id, o.candidate_id, o.owner_id, o.id, o.player_pct, o.currency,
          o.hours_per_month, o.card_policy, o.resource_policy, true, now(), null)
  on conflict (node_id) do update
    set mayor_id = excluded.mayor_id, owner_id = excluded.owner_id, offer_id = excluded.offer_id,
        player_pct = excluded.player_pct, currency = excluded.currency,
        hours_per_month = excluded.hours_per_month, card_policy = excluded.card_policy,
        resource_policy = excluded.resource_policy, active = true, started_at = now(), ended_at = null;

  update public.mayor_offers
     set status = 'declined', turn = null, updated_at = now()
   where node_id = o.node_id and id <> o.id and status in ('pending', 'countered');

  insert into public.mayor_offer_events (offer_id, actor_id, action, player_pct, currency,
                                         hours_per_month, card_policy, resource_policy)
  values (o.id, auth.uid(), 'accepted', o.player_pct, o.currency, o.hours_per_month, o.card_policy, o.resource_policy);

  return jsonb_build_object('ok', true, 'node_id', o.node_id, 'mayor_id', o.candidate_id);
end $fn$;

-- ── create / counter / decline RPCs (the path new clients use) ──────────────
create or replace function public.mayor_offer_create(
  p_node_id text, p_owner_id uuid, p_candidate_id uuid,
  p_player_pct numeric default 30, p_currency text default 'CINDER',
  p_hours_per_month integer default 20, p_card_policy text default 'owner',
  p_resource_policy text default 'owner', p_note text default null, p_node_name text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare v_uid uuid := auth.uid(); v_id uuid;
begin
  if v_uid is null or v_uid not in (p_owner_id, p_candidate_id) then
    return jsonb_build_object('ok', false, 'error', 'not_a_party');
  end if;
  if p_owner_id = p_candidate_id then return jsonb_build_object('ok', false, 'error', 'self_hire'); end if;
  if p_player_pct is null or p_player_pct < 0 or p_player_pct > 100 then
    return jsonb_build_object('ok', false, 'error', 'bad_terms');
  end if;
  if not public._mayor_node_owned(p_node_id, p_owner_id) then
    return jsonb_build_object('ok', false, 'error', 'not_the_node_owner');
  end if;
  insert into public.mayor_offers (node_id, node_name, owner_id, candidate_id, created_by, status,
                                   player_pct, currency, hours_per_month, card_policy, resource_policy, note)
  values (p_node_id, p_node_name, p_owner_id, p_candidate_id, v_uid, 'pending',
          p_player_pct, coalesce(p_currency, 'CINDER'), coalesce(p_hours_per_month, 20),
          coalesce(p_card_policy, 'owner'), coalesce(p_resource_policy, 'owner'), p_note)
  returning id into v_id;
  insert into public.mayor_offer_events (offer_id, actor_id, action, player_pct, currency,
                                         hours_per_month, card_policy, resource_policy, note)
  values (v_id, v_uid, 'offered', p_player_pct, coalesce(p_currency, 'CINDER'), coalesce(p_hours_per_month, 20),
          coalesce(p_card_policy, 'owner'), coalesce(p_resource_policy, 'owner'), p_note);
  return jsonb_build_object('ok', true, 'offer_id', v_id);
end $fn$;

create or replace function public.mayor_offer_counter(
  p_offer_id uuid, p_player_pct numeric, p_currency text default null,
  p_hours_per_month integer default null, p_card_policy text default null,
  p_resource_policy text default null, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare v_uid uuid := auth.uid(); o public.mayor_offers%rowtype;
begin
  select * into o from public.mayor_offers where id = p_offer_id for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  if v_uid is null or v_uid not in (o.owner_id, o.candidate_id) then
    return jsonb_build_object('ok', false, 'error', 'not_a_party');
  end if;
  if o.status not in ('pending', 'countered') then return jsonb_build_object('ok', false, 'error', 'closed'); end if;
  if v_uid = coalesce(o.last_actor, o.created_by) then
    return jsonb_build_object('ok', false, 'error', 'not_your_turn');
  end if;
  if p_player_pct is null or p_player_pct < 0 or p_player_pct > 100 then
    return jsonb_build_object('ok', false, 'error', 'bad_terms');
  end if;
  update public.mayor_offers
     set status = 'countered',
         player_pct = p_player_pct,
         currency = coalesce(p_currency, o.currency),
         hours_per_month = coalesce(p_hours_per_month, o.hours_per_month),
         card_policy = coalesce(p_card_policy, o.card_policy),
         resource_policy = coalesce(p_resource_policy, o.resource_policy),
         note = coalesce(p_note, o.note),
         last_actor = v_uid,
         turn = case when v_uid = o.owner_id then o.candidate_id else o.owner_id end
   where id = o.id;
  insert into public.mayor_offer_events (offer_id, actor_id, action, player_pct, currency,
                                         hours_per_month, card_policy, resource_policy, note)
  select id, v_uid, 'countered', player_pct, currency, hours_per_month, card_policy, resource_policy, note
    from public.mayor_offers where id = o.id;
  return jsonb_build_object('ok', true, 'offer_id', o.id);
end $fn$;

create or replace function public.mayor_offer_decline(p_offer_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare v_uid uuid := auth.uid(); o public.mayor_offers%rowtype;
begin
  select * into o from public.mayor_offers where id = p_offer_id for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  if v_uid is null or v_uid not in (o.owner_id, o.candidate_id) then
    return jsonb_build_object('ok', false, 'error', 'not_a_party');
  end if;
  if o.status not in ('pending', 'countered') then return jsonb_build_object('ok', false, 'error', 'closed'); end if;
  update public.mayor_offers
     -- 'declined' for both parties: the Mayor Hall app only knows the four
     -- statuses live rows use (pending/countered/accepted/declined + ended).
     set status = 'declined',
         turn = null, last_actor = v_uid
   where id = o.id;
  insert into public.mayor_offer_events (offer_id, actor_id, action)
  values (o.id, v_uid, 'declined');
  return jsonb_build_object('ok', true);
end $fn$;

revoke all on function public.mayor_accept_offer(uuid) from public, anon;
revoke all on function public.mayor_end_contract(text) from public, anon;
revoke all on function public.mayor_offer_create(text, uuid, uuid, numeric, text, integer, text, text, text, text) from public, anon;
revoke all on function public.mayor_offer_counter(uuid, numeric, text, integer, text, text, text) from public, anon;
revoke all on function public.mayor_offer_decline(uuid) from public, anon;
grant execute on function public.mayor_accept_offer(uuid) to authenticated;
grant execute on function public.mayor_end_contract(text) to authenticated;
grant execute on function public.mayor_offer_create(text, uuid, uuid, numeric, text, integer, text, text, text, text) to authenticated;
grant execute on function public.mayor_offer_counter(uuid, numeric, text, integer, text, text, text) to authenticated;
grant execute on function public.mayor_offer_decline(uuid) to authenticated;

-- ── verify (read-only) ──────────────────────────────────────────────────────
select
  (select count(*) from pg_trigger where tgrelid = 'public.mayor_offers'::regclass
      and tgname = 'mayor_offers_guard' and not tgisinternal)                         as guard_trigger,     -- 1
  (select position('other_party_must_accept' in pg_get_functiondef('public.mayor_accept_offer(uuid)'::regprocedure)) > 0)
                                                                                      as accept_checks_last_actor, -- true
  (select count(*) from information_schema.role_table_grants
     where table_schema = 'public' and table_name in ('mayor_offers', 'mayor_offer_events')
       and grantee = 'anon' and privilege_type in ('INSERT', 'UPDATE', 'DELETE'))    as anon_write_grants, -- 0
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname in ('mayor_offer_create', 'mayor_offer_counter', 'mayor_offer_decline')
       and p.prosecdef)                                                               as offer_rpcs,        -- 3
  (select count(*) from public.node_mayors where active)                              as active_node_managers; -- unchanged (21 on 2026-09-17)
