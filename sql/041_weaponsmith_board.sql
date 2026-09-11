-- ===========================================================================
-- 039 — THE WEAPON SMITH ORDER BOARD.
--
-- 038 gave the smith a reputation and a ws_deliver that scores against a
-- contract. It did not say where a contract COMES FROM. This does.
--
-- 🔴 WHY THE BOARD IS GENERATED SERVER-SIDE.
--    ws_shop.contracts is what ws_deliver scores against, and a contract
--    carries BOTH the spec and the payout. A client that could write its own
--    contracts would write itself "minAtk 1, pays 999999" and deliver a
--    starter carbine into it forever. So the board is rolled here, from a
--    server-side template table, and the client only ever picks from it.
--
--    That is also why 038 gave ws_shop no update policy: the contracts column
--    is not client-writable at all, and this function is a SECURITY DEFINER
--    that bypasses RLS to fill it.
--
-- ⚠ CINDER IS STILL PAID CLIENT-SIDE, and that is a deliberate limit rather
--   than an oversight. Cinder lives in Profile.gems with a server mirror
--   (_serverMirrorCharge / addGems), not in a canonical server balance the way
--   Aza does. ws_deliver therefore RETURNS the payout and the client credits
--   it, exactly like every other Cinder award in the app. Tightening that
--   means moving Cinder itself server-side, which is a far larger change than
--   this feature and is explicitly out of scope. What IS protected here is the
--   part that gates content: the contract's terms and the reputation it moves
--   are both decided server-side and cannot be authored by a client.
--
-- Idempotent and re-runnable. Verify queries at the bottom.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. CONTRACT TEMPLATES — what the board can roll.
--
-- A template is a SPEC and a PAYOUT BAND, not a finished contract; ws_roll_board
-- stamps the ids and deadlines. rep_min keeps early smiths off jobs they cannot
-- build, which is what makes reputation feel like a ladder rather than a score.
-- ---------------------------------------------------------------------------
create table if not exists public.ws_contract_templates (
  id          text primary key,
  client_name text not null,
  blurb       text not null default '',
  spec        jsonb not null default '{}'::jsonb,
  cinder_min  int  not null check (cinder_min >= 0),
  cinder_max  int  not null check (cinder_max >= 0),
  hours       int  not null default 24 check (hours between 1 and 336),
  rep_min     int  not null default 0,
  weight      int  not null default 10 check (weight > 0),
  enabled     boolean not null default true
);

insert into public.ws_contract_templates
  (id, client_name, blurb, spec, cinder_min, cinder_max, hours, rep_min, weight) values
  ('c_militia_carbine', 'Ridge Militia',      'Eight of our rifles came back unserviceable. We need a straight shooter, nothing clever.',
   '{"minAtk":4}'::jsonb,                        3000,  4600,  24,  0, 14),
  ('c_scout_light',     'Pale Net Scouts',    'Light. We walk a long way and we would rather not carry your ideas about stopping power.',
   '{"minSpd":2}'::jsonb,                        3200,  4800,  24,  0, 12),
  ('c_warden_reach',    'Warden Post 9',      'Something is watching the treeline from further out than we can answer. Fix that.',
   '{"minRange":2,"minAtk":4}'::jsonb,           5200,  7400,  36, 10, 10),
  ('c_breach_team',     'Salt Saint Breachers','Doors, mostly. We get very close before it matters.',
   '{"minAtk":8,"blueprint":"ws_bp_breacher"}'::jsonb, 8400, 11800, 48, 25, 7),
  ('c_marksman_order',  'The Quiet Contract',  'One rifle. It has to reach, and it has to be right the first time.',
   '{"minRange":3,"minCrit":2}'::jsonb,          12000, 16500, 72, 45, 5),
  ('c_precision_pair',  'Hask & Daughter',     'Precision work. We will know if you rushed the trigger.',
   '{"minCrit":3}'::jsonb,                       6800,  9200,  36, 25, 8)
on conflict (id) do update
  set client_name = excluded.client_name, blurb = excluded.blurb, spec = excluded.spec,
      cinder_min = excluded.cinder_min, cinder_max = excluded.cinder_max,
      hours = excluded.hours, rep_min = excluded.rep_min, weight = excluded.weight;

alter table public.ws_contract_templates enable row level security;
drop policy if exists wsct_sel on public.ws_contract_templates;
create policy wsct_sel on public.ws_contract_templates for select to authenticated using (enabled);
-- No write policy: RLS on with none closes the table to the API entirely.

-- ---------------------------------------------------------------------------
-- 2. REP TIERS — how many contracts a smith may hold at once.
--
-- A plain function rather than a table: it is five numbers that describe a
-- ladder, and a table would invite them being edited apart from the tier names
-- the client renders.
-- ---------------------------------------------------------------------------
create or replace function public.ws_contract_slots(p_rep int)
returns int language sql immutable as $$
  select case
    when p_rep >= 90 then 5      -- Guild Master
    when p_rep >= 70 then 4      -- Master Armorer
    when p_rep >= 45 then 3      -- Registered Armorer
    when p_rep >= 20 then 2      -- Jobbing Smith
    else 1                        -- Unproven
  end;
$$;

-- ---------------------------------------------------------------------------
-- 3. ws_roll_board — refill the board up to the player's slot count.
--
-- ⚠ TOP-UP, NOT REPLACE. Replacing would let a player reroll away a contract
--   they are about to fail, which turns the deadline into a suggestion. Only
--   EXPIRED contracts are cleared, and expiring one costs reputation the same
--   way a failed delivery does — otherwise ignoring a job you cannot do is
--   free and the board has no teeth.
--
-- ⚠ RATE-LIMITED to once a minute. Without it a client could roll in a loop
--   until it got the highest-paying template, which is the same exploit as
--   authoring contracts, just slower.
-- ---------------------------------------------------------------------------
create or replace function public.ws_roll_board()
returns jsonb
language plpgsql security definer set search_path = public as $fn$
declare
  v_uid   uuid := auth.uid();
  v_shop  public.ws_shop%rowtype;
  v_keep  jsonb := '[]'::jsonb;
  v_c     jsonb;
  v_n     int;
  v_slots int;
  v_exp   int := 0;
  v_t     public.ws_contract_templates%rowtype;
  v_pay   int;
  v_seq   int := 0;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'error', 'not_authenticated'); end if;

  insert into public.ws_shop (owner_id) values (v_uid) on conflict (owner_id) do nothing;
  select * into v_shop from public.ws_shop where owner_id = v_uid;

  -- Drop expired contracts, and charge reputation for each one let go.
  for v_c in select value from jsonb_array_elements(v_shop.contracts) loop
    if jsonb_exists(v_c, 'dueAt')
       and to_timestamp(((v_c ->> 'dueAt')::bigint) / 1000.0) < now() then
      v_exp := v_exp + 1;
    else
      v_keep := v_keep || jsonb_build_array(v_c);
    end if;
  end loop;

  v_slots := public.ws_contract_slots(v_shop.rep);
  v_n := v_slots - jsonb_array_length(v_keep);

  /* Rate limit. Only refuses the REFILL — expiry above still settles, so a
     player cannot dodge the penalty by spamming this.

     🔴 AN EMPTY BOARD IS NEVER THROTTLED. ws_shop is created by this function's
     own insert with updated_at defaulting to now(), so without this exemption
     the FIRST roll a new smith ever makes is refused and the board renders
     empty for a minute — the exact opposite of the intended first impression,
     and indistinguishable from "this feature is broken". Caught by driven test,
     not by reading. The throttle exists to stop rerolling for a better
     contract, and a player holding none has nothing to reroll. */
  if v_shop.updated_at > now() - interval '1 minute'
     and v_exp = 0 and v_n > 0
     and jsonb_array_length(v_keep) > 0 then
    return jsonb_build_object('ok', true, 'throttled', true,
                              'contracts', v_keep, 'slots', v_slots);
  end if;

  while v_n > 0 loop
    v_seq := v_seq + 1;
    -- Weighted pick from templates this smith has the reputation for.
    select t.* into v_t
      from public.ws_contract_templates t
     where t.enabled and t.rep_min <= v_shop.rep
     order by random() * (1.0 / t.weight)
     limit 1;
    exit when not found;

    v_pay := v_t.cinder_min + floor(random() * greatest(1, (v_t.cinder_max - v_t.cinder_min + 1)))::int;

    v_keep := v_keep || jsonb_build_array(jsonb_build_object(
      'id',     v_t.id || '_' || extract(epoch from now())::bigint || '_' || v_seq,
      'tplId',  v_t.id,
      'client', v_t.client_name,
      'blurb',  v_t.blurb,
      'spec',   v_t.spec,
      'pays',   jsonb_build_object('cinder', v_pay),
      'dueAt',  (extract(epoch from now() + (v_t.hours || ' hours')::interval) * 1000)::bigint
    ));
    v_n := v_n - 1;
  end loop;

  update public.ws_shop
     set contracts  = v_keep,
         rep        = greatest(0, rep - (v_exp * 2)),
         failed     = failed + v_exp,
         updated_at = now()
   where owner_id = v_uid;

  select * into v_shop from public.ws_shop where owner_id = v_uid;
  return jsonb_build_object('ok', true, 'contracts', v_shop.contracts,
                            'expired', v_exp, 'rep', v_shop.rep, 'slots', v_slots);
end;
$fn$;
revoke all on function public.ws_roll_board() from public, anon;
grant execute on function public.ws_roll_board() to authenticated;

-- ---------------------------------------------------------------------------
-- 4. ws_state gains the slot count and the rep-claimable list.
--
-- The rep path in ws_grant_blueprint already checks rep_required; this is just
-- so the client can OFFER the claim rather than making the player guess.
-- ---------------------------------------------------------------------------
create or replace function public.ws_state()
returns jsonb
language plpgsql security definer set search_path = public as $fn$
declare
  v_uid  uuid := auth.uid();
  v_shop public.ws_shop%rowtype;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'error', 'not_authenticated'); end if;
  insert into public.ws_shop (owner_id) values (v_uid) on conflict (owner_id) do nothing;
  select * into v_shop from public.ws_shop where owner_id = v_uid;

  return jsonb_build_object(
    'ok', true,
    'rep', v_shop.rep, 'repQuality', v_shop.rep_quality,
    'repSpeed', v_shop.rep_speed, 'repSpec', v_shop.rep_spec,
    'delivered', v_shop.delivered, 'failed', v_shop.failed,
    'contracts', v_shop.contracts,
    'slots', public.ws_contract_slots(v_shop.rep),
    'blueprints', (select coalesce(jsonb_agg(blueprint_id), '[]'::jsonb)
                     from public.ws_blueprints_owned where owner_id = v_uid),
    -- Frames the player has EARNED but not yet claimed.
    'claimable', (select coalesce(jsonb_agg(b.id), '[]'::jsonb)
                    from public.ws_blueprints b
                   where b.enabled and b.rep_required > 0 and b.rep_required <= v_shop.rep
                     and not exists (select 1 from public.ws_blueprints_owned o
                                      where o.owner_id = v_uid and o.blueprint_id = b.id)),
    'weapons', (select coalesce(jsonb_agg(jsonb_build_object(
                         'itemId', item_id, 'blueprintId', blueprint_id,
                         'quality', quality, 'stats', stats, 'weapon', weapon,
                         'parts', parts, 'listed', listed)), '[]'::jsonb)
                  from public.crafted_weapons where owner_id = v_uid)
  );
end;
$fn$;
revoke all on function public.ws_state() from public, anon;
grant execute on function public.ws_state() to authenticated;

-- ===========================================================================
-- VERIFY
-- ===========================================================================

-- 4a. Templates, and the reputation each one needs.
-- select id, client_name, rep_min, cinder_min || '-' || cinder_max as pays,
--        hours || 'h' as due, weight, spec
--   from public.ws_contract_templates where enabled order by rep_min, id;

-- 4b. The slot ladder.
-- select r as rep, public.ws_contract_slots(r) as slots
--   from (values (0),(19),(20),(44),(45),(69),(70),(89),(90),(100)) v(r);
--   -> 1,1,2,2,3,3,4,4,5,5

-- 4c. Grants: both functions authed true / anon false.
-- select p.proname,
--        has_function_privilege('authenticated', p.oid, 'EXECUTE') as authed,
--        has_function_privilege('anon',          p.oid, 'EXECUTE') as anon
--   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--  where n.nspname = 'public' and p.proname in ('ws_roll_board','ws_state','ws_contract_slots')
--  order by p.proname;

-- 4d. 🔴 No board may exceed its owner's slot count. Zero rows, always.
-- select s.owner_id, s.rep, jsonb_array_length(s.contracts) as have,
--        public.ws_contract_slots(s.rep) as slots
--   from public.ws_shop s
--  where jsonb_array_length(s.contracts) > public.ws_contract_slots(s.rep);

-- 4e. 🔴 No contract may exist that its holder lacks the reputation for.
--     Zero rows, always.
-- select s.owner_id, s.rep, c ->> 'tplId' as tpl, t.rep_min
--   from public.ws_shop s, jsonb_array_elements(s.contracts) c
--   join public.ws_contract_templates t on t.id = c ->> 'tplId'
--  where t.rep_min > s.rep;
-- ===========================================================================
