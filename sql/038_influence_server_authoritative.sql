-- ===========================================================================
-- 038 — INFLUENCE BECOMES SERVER-AUTHORITATIVE.
--
-- WHAT SHIPPED FIRST, AND WHY IT WAS NOT ENOUGH.
-- /src/influence pays a player up to 50,000 Cinder per envoy, and the whole
-- rate limit was `Date.now() - lastAt >= 48h` evaluated IN THE BROWSER against
-- a clock the player owns. Move the system clock forward, bank the cap, take
-- the money. Three things bounded the damage — a 3-envoy burst cap, a `lastAt`
-- that merged to the later stamp across devices, and wallet_credit's
-- 10,000,000/hour ceiling (sql/034) — and not one of them is a fix, because
-- every one of them is either client-side (defeated by the same player who
-- moved the clock) or a blast-radius limiter that still lets the faucet run.
--
-- sql/034's own header names the real fix: "per-faucet RPCs where the SERVER
-- computes the amount from state it owns". This is that file for Influence.
--
-- WHAT THE SERVER NOW OWNS. All of it:
--   • the CLOCK      — now(), not the browser's
--   • the RNG        — random(), unseeded by and invisible to the client
--   • the LEVEL      — from influence_state.xp, which only these functions write
--   • the STANDING   — recomputed here, and ONLY from inputs the player cannot
--                      write. See the block below: two obvious sources are
--                      player-writable and are therefore NOT trusted with money.
--   • every AMOUNT   — Cinder, resource quantities, the rolled rarity
--
-- The client's remaining job is to DISPLAY what came back and to apply the
-- non-monetary half locally, which is exactly the split gift_claim (sql/027)
-- already uses: cards and resources are client-held progression, money is not.
--
-- 🔴 THE ONE NUMBER THE CLIENT STILL SUPPLIES, AND HOW IT IS BOUNDED.
--    A recruit sells "at player-market value", and that valuation (DVS) is a
--    client-side engine — there is no server-side market table to read. So
--    influence_resolve() accepts a suggested price and CLAMPS it to a ceiling
--    derived from the rarity THIS FUNCTION ROLLED AND STORED, never from
--    anything the client says about the card. A client asking 1,000,000 for a
--    common gets 500. Lying is therefore pointless rather than merely audited.
--
-- 🔴 TWO STANDING INPUTS ARE PLAYER-WRITABLE. THIS FILE MUST NOT TRUST THEM.
--    An earlier draft of this header claimed the client "cannot assert any of"
--    the standing inputs. That was WRONG, and a security review of this very
--    file caught it. Both of these are writable straight through PostgREST, no
--    game UI involved:
--
--      reserve_contributions  rc_upd: `for update to authenticated
--                             using (user_id = auth.uid())` — a player can set
--                             their OWN `points` to anything. (index.html does
--                             exactly this write on every deposit.)
--      economy_nodes          en_ins/en_upd: `owner_id = auth.uid()` with no
--                             constraint on `meta` — a player can stamp
--                             meta.tier = 'eternal' on a node they own.
--
--    Left trusted, that was a ~23x Cinder inflation: forge both and a level-1
--    camp reads as standing 0.80 at level 6, moving the per-envoy cap from
--    ~1,000 to ~23,500. So:
--
--      • NODE TIER comes from pledge_purchases ONLY. That table is written by
--        the Stripe edge functions with the service role; a player cannot
--        insert a paid row. The economy_nodes meta.tier read is GONE.
--        ⚠ An admin tier override therefore no longer feeds Influence. If that
--          is wanted back, it needs a table `authenticated` cannot write —
--          not economy_nodes.meta.
--      • REP still counts, because the feature is specified around it, but it
--        can no longer set the LEVEL — level drives the Cinder band directly,
--        and a forgeable input must never do that. Rep now only carries its
--        0.25 weight in `standing`, so forging it to the maximum is worth at
--        most +7.5% Cinder (standing's sweetener is +30% at standing 1.0) and
--        some rarity drift. Bounded and survivable, rather than multiplicative.
--      • THE LEVEL comes from influence_state.xp and nothing else. That column
--        is written only by these functions, so it is the one input with no
--        forgery path at all.
--
--    The durable fix for rep is to stop letting clients write
--    reserve_contributions.points — but that is an existing table with an
--    existing client write path, and changing it belongs in its own migration.
--
-- 🔴 WHAT IS STILL TRUSTED, STATED PLAINLY. The client picks WHICH card sits
--    at the rolled rarity (the custom-card catalogue is client-held; the server
--    has no list to check against) and reports its own free stash space. Both
--    are safe by construction, not by good faith:
--      • the card is progression, not money, and its SALE price is priced off
--        the server's stored rarity, so substituting a mythic buys nothing;
--      • free space only ever makes a delivery SMALLER — the quantity was
--        already fixed by the server, so under-reporting self-harms and
--        over-reporting just hits the client's own stash cap.
--
-- ⚠ FAILS CLOSED for money, OPEN for the rest. Until this file is applied the
--   RPCs are absent, and the client degrades to an offline envoy that can hand
--   out cards and resources but NEVER Cinder — because without these functions
--   nothing can name a Cinder amount that is not the client's own invention.
--   That is the CLAUDE.md "must still work before tables exist" rule kept
--   without handing the wallet back to the browser.
--
-- ⚠ THIS FILE IS CANONICAL FOR THE PAYOUT MATH. /src/influence/model.js mirrors
--   it for the offline path and for display only; when the RPCs answer, the
--   client renders what they returned and recomputes nothing. If you retune a
--   curve, retune it HERE first.
--
-- Idempotent and re-runnable. Verify queries at the bottom.
-- ===========================================================================

-- --------------------------------------------------------------------------
-- 1. STATE. One row per player, written ONLY by the definer functions below.
--
--    ⚠ There is deliberately no INSERT/UPDATE/DELETE policy for authenticated.
--      A player can read their own row and nothing else. That is the entire
--      point of the file: xp, last_at and pending are the inputs to every
--      payout, so a player who can write them can name their own reward.
-- --------------------------------------------------------------------------
create table if not exists public.influence_state (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  xp         bigint      not null default 0 check (xp >= 0),
  hosted     integer     not null default 0 check (hosted >= 0),
  last_at    timestamptz,                    -- null = never hosted; first claim is free
  pending    jsonb,                          -- the dealt-but-unresolved envoy
  updated_at timestamptz not null default now()
);
alter table public.influence_state enable row level security;

drop policy if exists inf_state_sel on public.influence_state;
create policy inf_state_sel on public.influence_state
  for select to authenticated using (user_id = auth.uid());

-- Admins read every row for support ("why did this player get 50k?").
drop policy if exists inf_state_sel_admin on public.influence_state;
create policy inf_state_sel_admin on public.influence_state
  for select to authenticated using (public.is_admin());

-- --------------------------------------------------------------------------
-- 2. LEDGER. Append-only, one row per resolved envoy.
--
--    Every Cinder faucet in this codebase has to be answerable to "where did
--    this come from?" (see the comment on addGems). wallet_ledger already
--    records the credit; this records the ENCOUNTER that justified it — the
--    level and standing in force, what was rolled, and what the player chose.
--    Without it a support question about a big payout has no story, only an
--    amount.
--
--    ⚠ Append-only is enforced by the absence of UPDATE/DELETE policies, the
--      same rule the treasury ledgers follow (CLAUDE.md).
-- --------------------------------------------------------------------------
create table if not exists public.influence_ledger (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  kind       text not null,                  -- cinder | gift | recruit | supply
  choice     text,                           -- take | accept | sell | decline
  rarity     text,
  level      integer not null default 1,
  standing   numeric not null default 0,
  cinder     bigint  not null default 0,     -- what was actually credited
  card_id    text,
  grants     jsonb,
  xp_gained  integer not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists influence_ledger_user_time
  on public.influence_ledger (user_id, created_at desc);
alter table public.influence_ledger enable row level security;

drop policy if exists inf_ledger_sel on public.influence_ledger;
create policy inf_ledger_sel on public.influence_ledger
  for select to authenticated using (user_id = auth.uid() or public.is_admin());
-- No INSERT policy: only the SECURITY DEFINER functions below write here.

-- --------------------------------------------------------------------------
-- 3. THE TUNING TABLE, in SQL because SQL is now canonical.
--    Mirrored by /src/influence/model.js for the offline path only.
-- --------------------------------------------------------------------------
create or replace function public._inf_level_from_xp(p_xp bigint)
returns integer language sql immutable set search_path = public as $$
  select case
    when p_xp >= 3800 then 10 when p_xp >= 2900 then 9 when p_xp >= 2180 then 8
    when p_xp >= 1580 then 7  when p_xp >= 1100 then 6 when p_xp >=  720 then 5
    when p_xp >=  430 then 4  when p_xp >=  220 then 3 when p_xp >=   80 then 2
    else 1 end;
$$;

-- Foundation Reserve rank index (0..5) from lifetime contribution points.
-- Mirrors RESERVE_RANKS in index.html.
create or replace function public._inf_rep_rank(p_points numeric)
returns integer language sql immutable set search_path = public as $$
  select case
    when p_points >= 50000 then 5 when p_points >= 15000 then 4
    when p_points >=  4000 then 3 when p_points >=  1000 then 2
    when p_points >=   250 then 1 else 0 end;
$$;

-- --------------------------------------------------------------------------
-- 4. THE THREE INPUTS, read from tables the player cannot write in their own
--    favour. Returns {level, standing, rep_points, rep_rank, node_rank}.
--
--    ⚠ Every lookup is exception-guarded. A missing pledge_purchases (it is
--      created by the Stripe edge functions, not by this repo's /sql) or an
--      unreachable economy_nodes must degrade a player to the FREE tier, never
--      abort a claim — the alternative is a feature that breaks for everyone
--      the first time an unrelated table is renamed.
-- --------------------------------------------------------------------------
create or replace function public._inf_inputs(p_uid uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $fn$
declare
  v_xp     bigint  := 0;
  v_pts    numeric := 0;
  v_rep    integer := 0;
  v_node   integer := 0;
  v_tier   text;
  v_lv     integer;
  v_stand  numeric;
begin
  select coalesce(xp, 0) into v_xp from public.influence_state where user_id = p_uid;
  v_xp := coalesce(v_xp, 0);

  -- 🏛 Foundation Reserve reputation.
  begin
    select coalesce(sum(points), 0) into v_pts
      from public.reserve_contributions where user_id = p_uid;
  exception when undefined_table or undefined_column then v_pts := 0; end;
  v_pts := coalesce(v_pts, 0);
  v_rep := public._inf_rep_rank(v_pts);

  /* 🔌 Node tier — from pledge_purchases ONLY.
     economy_nodes.meta.tier is deliberately NOT read here. en_ins/en_upd let a
     player write `meta` on any node they own, so trusting it would let anyone
     stamp meta.tier='eternal' on a node and take node_rank 6. pledge_purchases
     is written by the Stripe edge functions under the service role, so a paid
     row cannot be forged from the client. See the header. */
  begin
    begin
      select case p.tier_id
               when 'eternal' then 'eternal' when 'titan' then 'titan'
               when 'dominion' then 'dominion' when 'foundation' then 'foundation'
               when 'outpost' then 'outpost' when 'node-starter' then 'starter'
               else null end
        into v_tier
        from public.pledge_purchases p
       where p.user_id = p_uid
         and lower(coalesce(p.status, '')) in ('paid', 'completed', 'complete', 'succeeded')
       order by case p.tier_id
                  when 'eternal' then 6 when 'titan' then 5 when 'dominion' then 4
                  when 'foundation' then 3 when 'outpost' then 2 when 'node-starter' then 1
                  else 0 end desc
       limit 1;
    exception when undefined_table or undefined_column then v_tier := null; end;
  end;

  v_node := case v_tier
              when 'eternal' then 6 when 'titan' then 5 when 'dominion' then 4
              when 'foundation' then 3 when 'outpost' then 2 when 'starter' then 1
              else 0 end;

  /* 🔴 LEVEL COMES FROM SERVER-GRANTED XP AND NOTHING ELSE.
     This used to be greatest(level_from_xp, rep_floor). Rep is forgeable (see
     the header) and the level sets the Cinder band directly, so a forged rep
     was worth a ~19x jump in the per-envoy cap all by itself. xp is written
     only by influence_resolve, which makes it the one unforgeable input. */
  v_lv := public._inf_level_from_xp(v_xp);

  -- standing = 0.30 node + 0.45 influence + 0.25 rep, each normalised 0..1.
  -- Rep is logarithmic: the gap between 0 and 5,000 matters far more to a
  -- player than the gap between 200,000 and 205,000.
  v_stand := 0.30 * (v_node::numeric / 6.0)
           + 0.45 * ((v_lv - 1)::numeric / 9.0)
           + 0.25 * least(1.0, log(10, 1 + v_pts) / log(10, 50001));
  v_stand := greatest(0.0, least(1.0, v_stand));

  return jsonb_build_object(
    'level', v_lv, 'standing', round(v_stand, 4), 'rep_points', v_pts,
    'rep_rank', v_rep, 'node_rank', v_node, 'node_tier', coalesce(v_tier, 'free'), 'xp', v_xp);
end$fn$;

-- --------------------------------------------------------------------------
-- 5. THE PAYOUT CURVES. Canonical here; model.js mirrors them.
-- --------------------------------------------------------------------------

-- 🔥 Cinder. The 50,000 ceiling is applied AFTER the standing bonus, so no
--    combination of level, node and rep can produce 50,001.
create or replace function public._inf_roll_cinder(p_level integer, p_standing numeric)
returns bigint language plpgsql volatile set search_path = public as $fn$
declare
  t   numeric := (greatest(1, least(10, p_level)) - 1)::numeric / 9.0;
  cap bigint;
  lo  bigint;
  raw bigint;
begin
  cap := greatest(200, round(50000 * (0.02 + 0.98 * power(t, 1.7))))::bigint;
  lo  := greatest(50, round(cap * 0.18))::bigint;
  raw := lo + floor(random() * (cap - lo + 1))::bigint;
  return greatest(1, least(50000, round(raw * (1 + 0.30 * greatest(0, least(1, p_standing))))::bigint));
end$fn$;

-- 🎲 Rarity. Standing stretches the TAIL rather than adding a flat bonus, so a
--    common stays the likeliest outcome at every standing.
create or replace function public._inf_roll_rarity(p_standing numeric)
returns text language plpgsql volatile set search_path = public as $fn$
declare
  s      numeric := greatest(0, least(1, coalesce(p_standing, 0)));
  lift   numeric := 1 + 5.0 * s;
  ids    text[]  := array['common','uncommon','rare','epic','legendary','mythic'];
  base   numeric[] := array[620, 240, 95, 32, 10, 3];
  w      numeric[] := array[0,0,0,0,0,0];
  total  numeric := 0;
  pick   numeric;
  i      integer;
begin
  for i in 1..6 loop
    w[i] := base[i] * power(lift, (i - 1) * 0.5);
    total := total + w[i];
  end loop;
  pick := random() * total;
  for i in 1..6 loop
    pick := pick - w[i];
    if pick <= 0 then return ids[i]; end if;
  end loop;
  return 'common';
end$fn$;

-- 🔴 THE RECRUIT SALE CEILING — the one client-supplied number, bounded.
--    Priced off the rarity THIS SERVER rolled, so a client that substitutes a
--    mythic card into a common encounter sells it for a common's ceiling.
create or replace function public._inf_sale_cap(p_rarity text)
returns bigint language sql immutable set search_path = public as $$
  select case lower(coalesce(p_rarity, 'common'))
    when 'mythic' then 40000 when 'legendary' then 18000 when 'epic' then 8000
    when 'rare' then 3000 when 'uncommon' then 1200 else 500 end::bigint;
$$;
-- The floor, so a card DVS has never valued still sells for something sane.
create or replace function public._inf_sale_floor(p_rarity text)
returns bigint language sql immutable set search_path = public as $$
  select case lower(coalesce(p_rarity, 'common'))
    when 'mythic' then 500 when 'legendary' then 250 when 'epic' then 120
    when 'rare' then 60 when 'uncommon' then 30 else 15 end::bigint;
$$;

-- --------------------------------------------------------------------------
-- 6. PEEK — read-only. Feeds the CAMP STATUS bar without dealing anything.
-- --------------------------------------------------------------------------
create or replace function public.influence_peek()
returns jsonb language plpgsql security definer set search_path = public as $fn$
declare
  v_uid   uuid := auth.uid();
  v_in    jsonb;
  v_last  timestamptz;
  v_pend  jsonb;
  v_host  integer := 0;
  v_ready integer;
  v_next  integer;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'error', 'not_authenticated'); end if;
  select last_at, pending, hosted into v_last, v_pend, v_host
    from public.influence_state where user_id = v_uid;
  v_in := public._inf_inputs(v_uid);

  -- A never-hosted camp gets one immediately: making a first-time player wait
  -- two days to find out what the feature is would be a worse introduction
  -- than any tuning gain is worth.
  if v_last is null then
    v_ready := 1; v_next := 0;
  else
    v_ready := greatest(0, least(3, floor(extract(epoch from (now() - v_last)) / 172800)::integer));
    v_next  := greatest(0, 172800 - (floor(extract(epoch from (now() - v_last)))::bigint % 172800))::integer;
  end if;

  return jsonb_build_object(
    'ok', true, 'ready', v_ready, 'next_seconds', v_next, 'hosted', coalesce(v_host, 0),
    'pending', v_pend, 'level', v_in->'level', 'standing', v_in->'standing',
    'xp', v_in->'xp', 'rep_points', v_in->'rep_points', 'rep_rank', v_in->'rep_rank',
    'node_rank', v_in->'node_rank', 'node_tier', v_in->'node_tier');
end$fn$;

-- --------------------------------------------------------------------------
-- 7. CLAIM — deal one envoy. The server spends the clock and rolls everything.
--
--    ⚠ RETURNS THE EXISTING PENDING ENCOUNTER IF THERE IS ONE, and does not
--      deal a second. That is the anti-reroll: closing the modal and reopening
--      it must resume the same visitor, or a player farms the rarity table by
--      reopening until a mythic appears. Enforcing it HERE (not in the browser)
--      is the whole difference between a rule and a suggestion.
-- --------------------------------------------------------------------------
create or replace function public.influence_claim()
returns jsonb language plpgsql security definer set search_path = public as $fn$
declare
  v_uid    uuid := auth.uid();
  v_in     jsonb;
  v_lv     integer;
  v_st     numeric;
  v_last   timestamptz;
  v_pend   jsonb;
  v_ready  integer;
  v_kind   text;
  v_enc    jsonb;
  v_roll   numeric;
  v_wt     numeric;
  v_kinds  integer;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'error', 'not_authenticated'); end if;

  insert into public.influence_state (user_id) values (v_uid) on conflict (user_id) do nothing;
  -- Row lock: two tabs clicking at once must not both deal an envoy.
  select last_at, pending into v_last, v_pend
    from public.influence_state where user_id = v_uid for update;

  if v_pend is not null then
    return jsonb_build_object('ok', true, 'resumed', true, 'encounter', v_pend);
  end if;

  if v_last is null then
    v_ready := 1;
  else
    v_ready := greatest(0, least(3, floor(extract(epoch from (now() - v_last)) / 172800)::integer));
  end if;
  if v_ready < 1 then
    return jsonb_build_object('ok', false, 'error', 'no_envoy',
      'next_seconds', greatest(0, 172800 - (floor(extract(epoch from (now() - v_last)))::bigint % 172800))::integer);
  end if;

  v_in := public._inf_inputs(v_uid);
  v_lv := (v_in->>'level')::integer;
  v_st := (v_in->>'standing')::numeric;

  -- Encounter mix. Recruits get commoner as standing rises — an unaffiliated
  -- operator walking into a nobody's camp and asking to join is the one
  -- outcome that should feel earned.
  v_wt   := 30 + 28 + (22 + 18 * v_st) + 20;
  v_roll := random() * v_wt;
  if    v_roll < 30 then v_kind := 'cinder';
  elsif v_roll < 58 then v_kind := 'gift';
  elsif v_roll < 58 + (22 + 18 * v_st) then v_kind := 'recruit';
  else  v_kind := 'supply';
  end if;

  if v_kind = 'cinder' then
    v_enc := jsonb_build_object('kind', 'cinder', 'cinder', public._inf_roll_cinder(v_lv, v_st));
  elsif v_kind = 'supply' then
    -- The server names the QUANTITY and how many kinds; the client chooses
    -- which resources (the ledger of resource ids is client-held) and reports
    -- its free space. Neither choice can enlarge the delivery.
    v_kinds := 1 + (case when v_lv >= 4 then 1 else 0 end) + (case when v_lv >= 8 then 1 else 0 end);
    v_enc := jsonb_build_object('kind', 'supply', 'kinds', v_kinds,
      'qty', (select jsonb_agg(q) from (
                select greatest(1, floor(
                  ((18 + 26 * least(10, greatest(1, v_lv))) * (1 + 0.50 * v_st))
                  * (0.55 + 0.45 * random()))::bigint) as q
                from generate_series(1, v_kinds)) s));
  else
    -- gift | recruit — the server rolls the RARITY and the client picks a card
    -- at it. See the header for why that is safe and how the sale is bounded.
    v_enc := jsonb_build_object('kind', v_kind, 'rarity', public._inf_roll_rarity(v_st),
                                'sale_cap', 0);
    if v_kind = 'recruit' then
      v_enc := v_enc || jsonb_build_object(
        'sale_cap',   public._inf_sale_cap(v_enc->>'rarity'),
        'sale_floor', public._inf_sale_floor(v_enc->>'rarity'));
    end if;
  end if;

  v_enc := v_enc || jsonb_build_object('level', v_lv, 'standing', v_st,
                                       'dealt_at', extract(epoch from now())::bigint);

  -- Spend exactly ONE interval, never reset to now(): resetting would destroy
  -- the partial progress toward the next envoy on every single claim. Clamped
  -- so a player who banked to the cap keeps no credit for envoys beyond it.
  update public.influence_state
     set last_at = case when v_last is null then now()
                        else greatest(v_last + interval '48 hours', now() - interval '144 hours') end,
         pending = v_enc,
         updated_at = now()
   where user_id = v_uid;

  return jsonb_build_object('ok', true, 'resumed', false, 'encounter', v_enc,
                            'level', v_lv, 'standing', v_st);
end$fn$;

-- --------------------------------------------------------------------------
-- 8. RESOLVE — pay out the pending envoy and clear it.
--
--    p_choice     take | accept | sell | decline
--    p_card_id    the card the client picked at the server's rolled rarity
--    p_sale_price the client's DVS valuation — CLAMPED, see _inf_sale_cap
--    p_free_space the client's stash headroom, for the supply refusal
--
--    ⚠ CLEARING `pending` IS THE EXACTLY-ONCE GUARD, and it happens in the same
--      UPDATE that reads it. Two tabs resolving the same envoy race on that
--      row and exactly one wins; the loser sees 'nothing_pending' rather than
--      a second payout.
-- --------------------------------------------------------------------------
create or replace function public.influence_resolve(
  p_choice     text,
  p_card_id    text    default null,
  p_sale_price bigint  default 0,
  p_free_space bigint  default null)
returns jsonb language plpgsql security definer set search_path = public as $fn$
declare
  v_uid   uuid := auth.uid();
  v_enc   jsonb;
  v_kind  text;
  v_lv    integer;
  v_st    numeric;
  v_xp    integer := 0;
  v_cash  bigint  := 0;
  v_bal   bigint;
  v_need  bigint  := 0;
  v_ref   boolean := false;
  v_price bigint;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'error', 'not_authenticated'); end if;
  p_choice := lower(coalesce(p_choice, ''));
  if p_choice not in ('take', 'accept', 'sell', 'decline') then
    return jsonb_build_object('ok', false, 'error', 'bad_choice');
  end if;

  /* 🔴 LOCK, READ, THEN CLEAR — and it must be in that order.
     The obvious one-liner is wrong and was written that way first:

         update influence_state set pending = null
          where user_id = v_uid and pending is not null
          returning pending into v_enc;      -- ALWAYS NULL

     RETURNING on an UPDATE yields the NEW row, so `pending` comes back as the
     null we just wrote. `found` is still true (a row was updated), so the
     function would sail past the guard with an empty encounter and pay out
     nothing on every single resolve — the envoy silently consumed, the reward
     silently dropped.

     SELECT … FOR UPDATE is what makes this exactly-once anyway: a second tab
     blocks on the lock, and by the time it reads, pending is null and it gets
     'nothing_pending' instead of a second payout. */
  select pending into v_enc
    from public.influence_state where user_id = v_uid for update;
  if v_enc is null then
    return jsonb_build_object('ok', false, 'error', 'nothing_pending');
  end if;
  update public.influence_state
     set pending = null, updated_at = now()
   where user_id = v_uid;

  v_enc  := coalesce(v_enc, '{}'::jsonb);
  v_kind := coalesce(v_enc->>'kind', '');
  v_lv   := coalesce((v_enc->>'level')::integer, 1);
  v_st   := coalesce((v_enc->>'standing')::numeric, 0);

  if p_choice = 'decline' then
    v_xp := 5;
  elsif v_kind = 'cinder' then
    v_cash := greatest(0, least(50000, coalesce((v_enc->>'cinder')::bigint, 0)));
    if v_cash > 0 then v_bal := public.wallet_credit(v_cash, 'Influence envoy: tribute'); end if;
    v_xp := 22;
  elsif v_kind = 'gift' then
    v_xp := 35;                                  -- the card is applied client-side
  elsif v_kind = 'recruit' and p_choice = 'accept' then
    v_xp := 60;                                  -- likewise
  elsif v_kind = 'recruit' and p_choice = 'sell' then
    -- 🔴 THE CLAMP. Ceiling and floor both come from the rarity stored at claim
    --    time, so the client's number can only move the price WITHIN a band the
    --    server already decided.
    v_price := greatest(public._inf_sale_floor(v_enc->>'rarity'),
                        least(public._inf_sale_cap(v_enc->>'rarity'), greatest(0, coalesce(p_sale_price, 0))));
    v_cash := v_price;
    v_bal  := public.wallet_credit(v_cash, 'Influence envoy: recruit sale');
    v_xp   := 40;
  elsif v_kind = 'supply' then
    -- ⚠ CAST EACH ELEMENT, NOT THE SUM. jsonb_array_elements_text yields TEXT,
    --   and `sum(x)::bigint` asks Postgres for sum(text) — which does not exist,
    --   so it does not mis-total, it THROWS. Every supply envoy would have
    --   errored out at resolve time. Caught by applying this file to a real
    --   Postgres 16 and running a delivery through it.
    select coalesce(sum(x::bigint), 0)::bigint into v_need
      from jsonb_array_elements_text(coalesce(v_enc->'qty', '[]'::jsonb)) t(x);
    -- Space is the client's to report and can only shrink a delivery, never
    -- grow one. A full stash gets NOTHING — addRes() silently swallows the
    -- surplus, so a partial would look like a success while destroying the rest.
    if p_free_space is not null and p_free_space < v_need then
      v_ref := true; v_xp := 8;
    else
      v_xp := 30;
    end if;
  end if;

  update public.influence_state
     set xp = xp + v_xp, hosted = hosted + 1, updated_at = now()
   where user_id = v_uid;

  insert into public.influence_ledger
    (user_id, kind, choice, rarity, level, standing, cinder, card_id, grants, xp_gained)
  values
    (v_uid, v_kind, p_choice, v_enc->>'rarity', v_lv, v_st, v_cash,
     nullif(left(coalesce(p_card_id, ''), 120), ''),
     case when v_kind = 'supply' then jsonb_build_object('qty', v_enc->'qty', 'refused', v_ref) else null end,
     v_xp);

  return jsonb_build_object('ok', true, 'kind', v_kind, 'choice', p_choice,
    'cinder', v_cash, 'balance', v_bal, 'refused', v_ref, 'needed', v_need,
    'xp', v_xp, 'level', public._inf_level_from_xp(
      (select xp from public.influence_state where user_id = v_uid)));
end$fn$;

-- --------------------------------------------------------------------------
-- 9. GRANTS. The internals stay ungranted; only the three entry points are
--    callable, and each derives its user from auth.uid() rather than an
--    argument, so no caller can act as anybody else.
-- --------------------------------------------------------------------------
revoke all on function public._inf_level_from_xp(bigint)             from public, anon, authenticated;
revoke all on function public._inf_rep_rank(numeric)                from public, anon, authenticated;
revoke all on function public._inf_sale_cap(text)                   from public, anon, authenticated;
revoke all on function public._inf_sale_floor(text)                 from public, anon, authenticated;
revoke all on function public._inf_inputs(uuid)                     from public, anon, authenticated;
revoke all on function public._inf_roll_cinder(integer, numeric)    from public, anon, authenticated;
revoke all on function public._inf_roll_rarity(numeric)             from public, anon, authenticated;
revoke all on function public.influence_peek()                      from public, anon;
revoke all on function public.influence_claim()                     from public, anon;
revoke all on function public.influence_resolve(text, text, bigint, bigint) from public, anon;
grant execute on function public.influence_peek()  to authenticated;
grant execute on function public.influence_claim() to authenticated;
grant execute on function public.influence_resolve(text, text, bigint, bigint) to authenticated;
grant select on public.influence_state  to authenticated;
grant select on public.influence_ledger to authenticated;

-- ===========================================================================
-- VERIFY — SELF-CONTAINED. Paste the block below into the SQL editor and run
-- it as-is. There is NOTHING to fill in: it resolves a real user itself.
--
-- 🔴 AN EARLIER VERSION OF THIS BLOCK HAD `'<a user_id>'` PLACEHOLDERS IN IT.
--    Pasted unchanged it fails with `22P02: invalid input syntax for type uuid`
--    from inside influence_peek() — which looks alarming and is only the
--    placeholder reaching auth.uid(). A verify block that cannot be run
--    verbatim is not a verify block, so it now resolves the user itself.
--
-- It ROLLS BACK, so nothing it does survives — including the Cinder it credits.
-- ===========================================================================
--
-- begin;
--
-- -- Become a real player: your own account if present, else any user.
-- -- set_config(..., true) is transaction-local and dies with the rollback.
-- select set_config('request.jwt.claims',
--        jsonb_build_object('sub', (select id from auth.users
--                                    order by (email = 'play@mythicsoa.com') desc, id
--                                    limit 1),
--                           'role','authenticated',
--                           'email','verify@local')::text,
--        true) is not null as claims_set;
-- set local role authenticated;
--
-- select 'a) peek deals nothing — ready stays 1' as check,
--        (public.influence_peek()->>'ready') as first,
--        (public.influence_peek()->>'ready') as again;
-- select 'b) claim deals one' as check, public.influence_claim()->'encounter'->>'kind' as kind;
-- select 'c) claiming again RESUMES, never rerolls' as check,
--        public.influence_claim()->>'resumed' as resumed;
-- select 'd) resolve pays once' as check, public.influence_resolve('take','card_x',0,999999)->>'ok' as ok;
-- select 'e) resolving again is refused' as check, public.influence_resolve('take')->>'error' as err;
-- select 'f) no second envoy for 48h' as check,
--        public.influence_claim()->>'error' as err,
--        round((public.influence_claim()->>'next_seconds')::numeric/3600,1) as hours_left;
--
-- -- g) THE CLAMP. Ask a million for a common recruit; get the common ceiling.
-- set local role postgres;
-- update public.influence_state set pending =
--   jsonb_build_object('kind','recruit','rarity','common','level',10,'standing',1)
--  where user_id = (current_setting('request.jwt.claims')::jsonb->>'sub')::uuid;
-- set local role authenticated;
-- select 'g) asked 1,000,000 for a COMMON recruit' as check,
--        public.influence_resolve('sell','any_card',1000000)->>'cinder' as paid_should_be_500;
--
-- -- h) A full stash refuses and delivers nothing.
-- set local role postgres;
-- update public.influence_state set pending =
--   jsonb_build_object('kind','supply','qty',jsonb_build_array(400,120),'level',10,'standing',1)
--  where user_id = (current_setting('request.jwt.claims')::jsonb->>'sub')::uuid;
-- set local role authenticated;
-- select 'h) full stash (3 free, 520 needed)' as check,
--        public.influence_resolve('take',null,0,3)->>'refused' as refused_should_be_true;
--
-- -- i) The player cannot write their own state. Trapped so the run finishes.
-- do $$
-- begin
--   begin
--     execute 'update public.influence_state set xp = 999999 where user_id = auth.uid()';
--     raise notice 'i) xp forge ............ ALLOWED  <-- BAD, investigate';
--   exception when insufficient_privilege then
--     raise notice 'i) xp forge ............ REFUSED  <-- correct';
--   end;
-- end $$;
--
-- rollback;
--
-- EXPECTED (verified on Postgres 16):
--   a) 1 / 1     b) a kind     c) true     d) true     e) nothing_pending
--   f) no_envoy, 48.0     g) 500     h) true     i) REFUSED
--
-- Watch the faucet in production:
--   select left(user_id::text,8) usr, kind, choice, rarity, level, cinder, created_at
--     from public.influence_ledger order by created_at desc limit 50;
--   select date_trunc('day', created_at) d, sum(cinder) from public.influence_ledger
--    group by 1 order by 1 desc limit 14;
-- ===========================================================================
