-- =============================================================================
-- 🗺 WARPATH Milestone 1 — end-to-end RPC test.
--
-- Plays an actual two-hero run against the real functions: enter, move,
-- harvest, pitch camp, build, secure, recruit, draft an encounter, collide,
-- resolve the battle THROUGH THE BRIDGE, extract, and drain the grant. Then it
-- attacks the same functions the way a modified client would.
--
-- Run against a scratch database that already has the migration applied:
--     psql -f supabase/tests/warpath_milestone_1_test.sql
--
-- It needs auth.uid() to be switchable. Locally that means a stub:
--     create table public._testctx (k text primary key, v uuid);
--     create function auth.uid() returns uuid language sql stable security definer as
--       $$ select v from public._testctx where k = 'uid' $$;
--     create function public.set_uid(p uuid) returns void language sql security definer as
--       $$ insert into public._testctx values ('uid', p)
--          on conflict (k) do update set v = excluded.v $$;
-- On Supabase itself, run the blocks as each user instead.
--
-- Every check RAISEs on failure, so a clean run means every line passed.
-- =============================================================================

\set ON_ERROR_STOP on

do $$
declare
  ua uuid; ub uuid;
  ra jsonb; rb jsonb; r jsonb; st jsonb;
  v_runid uuid; v_seed bigint; ea uuid; eb uuid;
  n int; t jsonb; v_node jsonb; v_x int; v_y int; ok boolean;
  v_cap int; v_keys text[]; v_battle uuid; v_site jsonb; v_gate jsonb;
  pass int := 0;
  procedure_note text;
begin
  -- ── fixtures ────────────────────────────────────────────────────────────
  delete from public.warpath_grants; delete from public.warpath_events;
  delete from public.warpath_battles; delete from public.warpath_node_claims;
  delete from public.warpath_encounters; delete from public.warpath_recruit_claims;
  delete from public.warpath_cards; delete from public.warpath_inventory;
  delete from public.warpath_camps; delete from public.warpath_expeditions;
  delete from public.warpath_runs; delete from public.warpath_tickets;

  insert into auth.users (email) values ('a@warpath.test') returning id into ua;
  insert into auth.users (email) values ('b@warpath.test') returning id into ub;
  insert into public.bank_of_ethos (user_id, aza) values (ua, 10) on conflict (user_id) do update set aza = 10;
  insert into public.bank_of_ethos (user_id, aza) values (ub, 1)  on conflict (user_id) do update set aza = 1;

  -- ── 1. ENTRY ────────────────────────────────────────────────────────────
  perform public.set_uid(ua);
  r := public.warpath_enter('hero_ashen', 'Ashen', 'ticket');
  if (r->>'ok')::boolean then raise exception 'FAIL: entered with no ticket'; end if;
  if r->>'reason' <> 'no_ticket' then raise exception 'FAIL: wrong reason %', r->>'reason'; end if;
  pass := pass + 1; raise notice 'ok  entry refused without a ticket';

  r := public.warpath_claim_free_ticket();
  if not (r->>'ok')::boolean then raise exception 'FAIL: free ticket refused: %', r; end if;
  if (r->>'tickets')::int <> 1 then raise exception 'FAIL: expected 1 ticket, got %', r->>'tickets'; end if;
  r := public.warpath_claim_free_ticket();
  if (r->>'ok')::boolean then raise exception 'FAIL: free ticket granted twice in a week'; end if;
  pass := pass + 1; raise notice 'ok  free ticket grants once per week';

  ra := public.warpath_enter('hero_ashen', 'Ashen', 'ticket');
  if not (ra->>'ok')::boolean then raise exception 'FAIL: entry: %', ra; end if;
  v_runid := (ra->>'run_id')::uuid; ea := (ra->>'expedition_id')::uuid;
  select warpath_runs.seed into v_seed from public.warpath_runs where id = v_runid;
  if (select tickets from public.warpath_tickets where user_id = ua) <> 0 then
    raise exception 'FAIL: ticket was not debited'; end if;
  pass := pass + 1; raise notice 'ok  entered run % slot % at %,%', v_runid, ra->>'slot', ra->>'x', ra->>'y';

  r := public.warpath_enter('hero_ashen', 'Ashen', 'ticket');
  if (r->>'ok')::boolean then raise exception 'FAIL: entered two warpaths at once'; end if;
  pass := pass + 1; raise notice 'ok  cannot be in two Warpaths at once';

  -- B pays in AZA, and it comes out of the SERVER-side bank balance.
  perform public.set_uid(ub);
  r := public.warpath_enter('hero_vex', 'Vex', 'aza');
  if (r->>'ok')::boolean then raise exception 'FAIL: AZA entry with 1 AZA (cost 3) succeeded'; end if;
  update public.bank_of_ethos set aza = 10 where user_id = ub;
  rb := public.warpath_enter('hero_vex', 'Vex', 'aza');
  if not (rb->>'ok')::boolean then raise exception 'FAIL: AZA entry: %', rb; end if;
  eb := (rb->>'expedition_id')::uuid;
  if (select aza from public.bank_of_ethos where user_id = ub) <> 7 then
    raise exception 'FAIL: AZA not debited by 3'; end if;
  if not exists (select 1 from public.boe_ledger where user_id = ub and kind = 'warpath_entry') then
    raise exception 'FAIL: AZA entry was not journalled to boe_ledger'; end if;
  if (rb->>'run_id')::uuid <> v_runid then raise exception 'FAIL: B did not join A''s open run'; end if;
  pass := pass + 1; raise notice 'ok  AZA entry debits bank_of_ethos and journals to boe_ledger';

  -- Entry method must have no effect on anything downstream.
  if (select count(distinct entry_paid) from public.warpath_expeditions where run_id = v_runid) <> 2 then
    raise exception 'FAIL: expected two different entry methods in this run'; end if;
  pass := pass + 1; raise notice 'ok  two heroes in one run, one by ticket one by AZA';

  -- ── 2. STARTER STATE ────────────────────────────────────────────────────
  perform public.set_uid(ua);
  select count(*) into n from public.warpath_cards where expedition_id = ea;
  if n <> 24 then raise exception 'FAIL: starter pool is % cards, expected 24', n; end if;
  select count(*) into n from public.warpath_inventory where expedition_id = ea;
  if n <> 6 then raise exception 'FAIL: expected 6 expedition resources, got %', n; end if;
  pass := pass + 1; raise notice 'ok  starter pool 24 cards + six expedition resources';

  -- The starting kit. A playtest without it spawned away from forest, found no
  -- wood in 14 turns and could raise neither tent, so it had no vault and no
  -- recruiting for the whole run. The kit must buy exactly ONE tier-1 tent.
  if (select secured from public.warpath_inventory where expedition_id = ea and kind = 'wood') <> 25 then
    raise exception 'FAIL: the starting stipend did not land'; end if;
  if (select secured from public.warpath_inventory where expedition_id = ea and kind = 'wood') >=
     ((select (cost->>'wood')::int from public.warpath_building_costs where building = 'supply' and level = 1)
    + (select (cost->>'wood')::int from public.warpath_building_costs where building = 'recruitment' and level = 1)) then
    raise exception 'FAIL: the stipend buys BOTH tier-1 tents — that is not a choice'; end if;
  pass := pass + 1; raise notice 'ok  the starting kit buys one tier-1 tent, not two';

  st := public.warpath_state();
  if not (st->>'in_run')::boolean then raise exception 'FAIL: state says not in a run'; end if;
  if (st->'me'->>'expedition_id')::uuid <> ea then raise exception 'FAIL: state returned the wrong expedition'; end if;
  pass := pass + 1; raise notice 'ok  warpath_state returns the run';

  -- ── 3. FOG OF WAR IS ENFORCED SERVER-SIDE ───────────────────────────────
  -- B is far away, so B's coordinates must not be in A's payload at all.
  if (st->'others'->0->>'visible')::boolean then
    raise notice 'note: heroes spawned within vision of each other; skipping the fog assertion';
  else
    if st->'others'->0->>'x' is not null then
      raise exception 'FAIL: an unseen hero''s position was sent to the client anyway';
    end if;
    pass := pass + 1; raise notice 'ok  an unseen hero has no coordinates in the payload';
  end if;

  -- ── 4. MOVEMENT IS SERVER-VALIDATED ─────────────────────────────────────
  select warpath_expeditions.x, warpath_expeditions.y into v_x, v_y
    from public.warpath_expeditions where id = ea;
  r := public.warpath_move(ea, v_x, least(public.wp_h() - 1, v_y + 12));
  if (r->>'ok')::boolean then raise exception 'FAIL: moved 12 tiles on a 6-point budget'; end if;
  if r->>'reason' <> 'out_of_range' then raise exception 'FAIL: wrong refusal: %', r->>'reason'; end if;
  pass := pass + 1; raise notice 'ok  a move beyond the movement budget is refused';

  r := public.warpath_move(ea, -1, 0);
  if (r->>'ok')::boolean then raise exception 'FAIL: moved out of bounds'; end if;
  pass := pass + 1; raise notice 'ok  out-of-bounds move refused';

  -- find a water tile and try to walk onto it
  select gx, gy into v_x, v_y from generate_series(0, public.wp_w()-1) gx,
                                generate_series(0, public.wp_h()-1) gy
    where public.wp_is_water(v_seed, gx, gy) limit 1;
  if v_x is not null then
    r := public.warpath_move(ea, v_x, v_y);
    if (r->>'ok')::boolean then raise exception 'FAIL: walked onto water'; end if;
    pass := pass + 1; raise notice 'ok  water is impassable';
  end if;

  -- a legal one-tile step really moves and really spends the budget
  select warpath_expeditions.x, warpath_expeditions.y into v_x, v_y
    from public.warpath_expeditions where id = ea;
  -- pick a genuinely passable neighbour rather than assuming x+1 is land
  select gx, gy into v_x, v_y from generate_series(greatest(0, v_x-1), least(public.wp_w()-1, v_x+1)) gx,
                                   generate_series(greatest(0, v_y-1), least(public.wp_h()-1, v_y+1)) gy
   where not public.wp_is_water(v_seed, gx, gy)
     and not (gx = (select warpath_expeditions.x from public.warpath_expeditions where id = ea)
          and gy = (select warpath_expeditions.y from public.warpath_expeditions where id = ea))
   limit 1;
  r := public.warpath_move(ea, v_x, v_y);
  if not (r->>'ok')::boolean then raise exception 'FAIL: legal move refused: %', r; end if;
  if (r->>'moves_left')::int >= 6 then raise exception 'FAIL: movement budget was not spent'; end if;
  pass := pass + 1; raise notice 'ok  a legal move costs movement (% left)', r->>'moves_left';

  -- ── 5. HARVEST IS DERIVED, NOT DECLARED ─────────────────────────────────
  -- Walk A onto a real v_node.
  select gx, gy into v_x, v_y from generate_series(0, public.wp_w()-1) gx,
                                generate_series(0, public.wp_h()-1) gy
    where public.wp_node_at(v_seed, gx, gy) is not null limit 1;
  update public.warpath_expeditions set x = v_x, y = v_y, moves_left = 6 where id = ea;
  v_node := public.wp_node_at(v_seed, v_x, v_y);
  r := public.warpath_harvest(ea);
  if not (r->>'ok')::boolean then raise exception 'FAIL: harvest refused on a v_node tile: %', r; end if;
  if r->>'kind' <> v_node->>'kind' then raise exception 'FAIL: harvest kind % <> derived %', r->>'kind', v_node->>'kind'; end if;
  if (r->>'amount')::int <> (v_node->>'amount')::int then
    raise exception 'FAIL: harvest amount % <> derived %', r->>'amount', v_node->>'amount'; end if;
  pass := pass + 1; raise notice 'ok  harvest credits exactly what the seed says is there (% x %)', r->>'amount', r->>'kind';

  r := public.warpath_harvest(ea);
  if (r->>'ok')::boolean then raise exception 'FAIL: harvested the same v_node twice'; end if;
  if r->>'reason' <> 'already_harvested' then raise exception 'FAIL: wrong reason %', r->>'reason'; end if;
  pass := pass + 1; raise notice 'ok  a node can only be taken once per run';

  -- an empty tile yields nothing
  select gx, gy into v_x, v_y from generate_series(0, public.wp_w()-1) gx,
                                generate_series(0, public.wp_h()-1) gy
    where public.wp_node_at(v_seed, gx, gy) is null and not public.wp_is_water(v_seed, gx, gy) limit 1;
  update public.warpath_expeditions set x = v_x, y = v_y, moves_left = 6 where id = ea;
  r := public.warpath_harvest(ea);
  if (r->>'ok')::boolean then raise exception 'FAIL: harvested an empty tile'; end if;
  pass := pass + 1; raise notice 'ok  an empty tile cannot be harvested';

  -- ── 6. CAMP, BUILD, SECURE ──────────────────────────────────────────────
  update public.warpath_expeditions set moves_left = 6 where id = ea;
  r := public.warpath_camp_place(ea);
  if not (r->>'ok')::boolean then raise exception 'FAIL: camp: %', r; end if;
  pass := pass + 1; raise notice 'ok  camp pitched';

  -- Building spends SECURED stock, so it must fail before we deposit.
  -- Zero the starting stipend first: it arrives SECURED (see the note in
  -- warpath_enter), so without this the camp could already afford a Supply
  -- Tent and the assertion below would be testing nothing.
  update public.warpath_inventory set secured = 0 where expedition_id = ea;
  update public.warpath_inventory i set carried = 200
    from public.warpath_resources r where r.kind = i.kind and r.tier = 'expedition'
      and i.expedition_id = ea;
  r := public.warpath_camp_build(ea, 'supply');
  if (r->>'ok')::boolean then raise exception 'FAIL: built from carried stock without depositing'; end if;
  if r->>'reason' <> 'insufficient' then raise exception 'FAIL: wrong reason %', r->>'reason'; end if;
  pass := pass + 1; raise notice 'ok  building requires SECURED stock, not carried';

  r := public.warpath_secure(ea);
  if not (r->>'ok')::boolean then raise exception 'FAIL: secure: %', r; end if;
  r := public.warpath_camp_build(ea, 'supply');
  if not (r->>'ok')::boolean then raise exception 'FAIL: build after securing: %', r; end if;
  if public.wp_vault_slots(ea) <> 5 then raise exception 'FAIL: Supply Tent I should give 5 vault slots'; end if;
  pass := pass + 1; raise notice 'ok  Supply Tent I built — vault is 5 slots';

  -- ── 7. THE VAULT HAS A CEILING ──────────────────────────────────────────
  -- 9 carried Void Crystals, 5 slots: five secure, four stay at risk.
  -- ⚠ Clear every OTHER extraction material first. The harvest step above picks
  -- whatever node the seed happens to put under the hero, so on some seeds it
  -- banks a Dragon Heart that then competes for the same five slots and the
  -- assertion below sees 4 instead of 5. The rule was right; the test was
  -- seed-dependent, and passed by luck until a reseed exposed it.
  update public.warpath_inventory i set carried = 0, secured = 0
    from public.warpath_resources r
   where r.kind = i.kind and r.tier = 'extraction' and i.expedition_id = ea;
  insert into public.warpath_inventory (expedition_id, kind, carried)
    values (ea, 'void_crystal', 9)
    on conflict (expedition_id, kind) do update set carried = 9, secured = 0;
  r := public.warpath_secure(ea);
  select secured into n from public.warpath_inventory where expedition_id = ea and kind = 'void_crystal';
  if n <> 5 then raise exception 'FAIL: vault secured % materials, v_cap is 5', n; end if;
  select carried into n from public.warpath_inventory where expedition_id = ea and kind = 'void_crystal';
  if n <> 4 then raise exception 'FAIL: % materials still carried, expected 4', n; end if;
  pass := pass + 1; raise notice 'ok  vault caps secured materials at its slot count (5 in, 4 left carried)';

  -- ── 8. RECRUITMENT ──────────────────────────────────────────────────────
  select s into v_site from jsonb_array_elements(public.wp_structures(v_seed)) s where s->>'k' = 'site' limit 1;
  update public.warpath_expeditions set x = (v_site->>'x')::int, y = (v_site->>'y')::int, moves_left = 6 where id = ea;
  update public.warpath_inventory i set carried = 500
    from public.warpath_resources r where r.kind = i.kind and r.tier = 'expedition'
      and i.expedition_id = ea;

  -- No tent at all: the brief says Tent I is what unlocks Rank 1-2, so a camp
  -- without one cannot hire anybody. This is the gate that makes the camp the
  -- deckbuilding decision rather than scenery.
  r := public.warpath_recruit(ea, v_site->>'id', 0);
  if (r->>'ok')::boolean then raise exception 'FAIL: recruited with no Recruitment Tent at all'; end if;
  if r->>'reason' <> 'tent_too_small' then raise exception 'FAIL: wrong reason %', r->>'reason'; end if;
  pass := pass + 1; raise notice 'ok  no Recruitment Tent means no recruiting';

  -- Build Tent I back at camp, then return to the site.
  update public.warpath_expeditions e set x = c.x, y = c.y
    from public.warpath_camps c where c.expedition_id = e.id and e.id = ea;
  update public.warpath_inventory i set secured = 500
    from public.warpath_resources r where r.kind = i.kind and r.tier = 'expedition'
      and i.expedition_id = ea;
  r := public.warpath_camp_build(ea, 'recruitment');
  if not (r->>'ok')::boolean then raise exception 'FAIL: could not build the Recruitment Tent: %', r; end if;
  update public.warpath_expeditions set x = (v_site->>'x')::int, y = (v_site->>'y')::int where id = ea;

  r := public.warpath_recruit(ea, v_site->>'id', 2);   -- the rank-4 offer
  if (r->>'ok')::boolean then raise exception 'FAIL: Tent I recruited a rank-4 unit'; end if;
  if r->>'reason' <> 'tent_too_small' then raise exception 'FAIL: wrong reason %', r->>'reason'; end if;
  pass := pass + 1; raise notice 'ok  Recruitment Tent level gates what you may recruit';

  r := public.warpath_recruit(ea, v_site->>'id', 0);   -- the rank-1 offer
  if not (r->>'ok')::boolean then raise exception 'FAIL: rank-1 recruit refused: %', r; end if;
  pass := pass + 1; raise notice 'ok  recruited % at %', r->>'label', v_site->>'id';

  r := public.warpath_recruit(ea, v_site->>'id', 1);
  if (r->>'ok')::boolean then raise exception 'FAIL: recruited twice at one v_site — that is not pick-1-of-3'; end if;
  pass := pass + 1; raise notice 'ok  one recruit per site (pick 1 of 3)';

  -- and you must actually be standing there
  update public.warpath_expeditions set x = 0, y = 3 where id = ea;
  r := public.warpath_recruit(ea, 'barrow_gate', 0);
  if (r->>'ok')::boolean then raise exception 'FAIL: recruited from across the map'; end if;
  pass := pass + 1; raise notice 'ok  recruiting requires standing on the site';

  -- ── 9. THE DRAFT CANNOT BE RE-ROLLED ────────────────────────────────────
  -- Find a tile whose encounter roll fires, put A on it, and open it twice.
  select gx, gy into v_x, v_y from generate_series(0, public.wp_w()-1) gx,
                                generate_series(0, public.wp_h()-1) gy
    where not public.wp_is_water(v_seed, gx, gy)
      and public.wp_roll(v_seed, gx, gy, 20, 100) <
          (select chance from public.warpath_discovery_meta m where m.biome = public.wp_biome_at(v_seed, gx, gy))
    limit 1;
  if v_x is not null then
    update public.warpath_expeditions set x = v_x, y = v_y where id = ea;
    r := public.warpath_encounter_open(ea);
    if not (r->>'ok')::boolean then raise exception 'FAIL: encounter did not fire where the roll says it should: %', r; end if;
    t := r->'encounter'->'offers';
    if jsonb_array_length(t) < 2 then raise exception 'FAIL: encounter offered % cards', jsonb_array_length(t); end if;
    r := public.warpath_encounter_open(ea);
    if r->'encounter'->'offers' <> t then raise exception 'FAIL: re-opening the encounter re-rolled the offers'; end if;
    pass := pass + 1; raise notice 'ok  a discovery offers % cards and cannot be re-rolled', jsonb_array_length(t);

    select count(*) into n from public.warpath_cards where expedition_id = ea;
    r := public.warpath_encounter_pick((r->'encounter'->>'id')::uuid, 0);
    if not (r->>'ok')::boolean then raise exception 'FAIL: pick: %', r; end if;
    if (select count(*) from public.warpath_cards where expedition_id = ea) <> n + 1 then
      raise exception 'FAIL: the picked card did not enter the pool'; end if;
    if exists (select 1 from public.warpath_cards
                where expedition_id = ea and source = 'discovery' and secured) then
      raise exception 'FAIL: a discovered card arrived pre-secured — it should need a trip home'; end if;
    if not exists (select 1 from public.warpath_cards
                    where expedition_id = ea and source = 'recruit' and secured) then
      raise exception 'FAIL: a recruited card should be secured on the spot'; end if;
    pass := pass + 1; raise notice 'ok  picking adds one CARRIED card to the pool';
  end if;

  -- ── 10. THE BATTLE BRIDGE ───────────────────────────────────────────────
  -- Put the two heroes next to each other and collide them.
  update public.warpath_expeditions set x = 11, y = 3, moves_left = 6, status = 'active' where id = ea;
  update public.warpath_expeditions set x = 12, y = 3, moves_left = 6, status = 'active' where id = eb;

  perform public.set_uid(ub);
  r := public.warpath_battle_open(eb, ea);
  if not (r->>'ok')::boolean then raise exception 'FAIL: adjacent challenge refused: %', r; end if;
  v_battle := (r->>'battle_id')::uuid;
  pass := pass + 1; raise notice 'ok  battle % opened — and the Warpath resolved nothing', v_battle;

  -- while a v_battle is pending, the map is frozen for both
  r := public.warpath_move(eb, 13, 3);
  if (r->>'ok')::boolean then raise exception 'FAIL: moved away from a pending v_battle'; end if;
  pass := pass + 1; raise notice 'ok  a pending battle pins the hero to the map';

  -- an outsider cannot report a result
  perform public.set_uid(ua);
  update public.warpath_inventory set carried = 40 where expedition_id = ea and kind = 'wood';
  -- snapshot the vault so we can prove the battle did not touch it
  select secured into n from public.warpath_inventory where expedition_id = ea and kind = 'void_crystal';
  -- ⚠ A BARE WIN CLAIM IS NOT ENOUGH ANY MORE. B (the attacker) naming itself
  -- is exactly what an exploiter would send, so it is recorded and waits.
  perform public.set_uid(ub);
  r := public.warpath_battle_report(v_battle, eb);
  if not (r->>'ok')::boolean then raise exception 'FAIL: report: %', r; end if;
  if not (r->>'pending_confirmation')::boolean then
    raise exception 'FAIL: a bare self-declared WIN resolved on one report: %', r; end if;
  if (select status from public.warpath_battles where id = v_battle) <> 'open' then
    raise exception 'FAIL: the battle resolved on an uncorroborated win claim'; end if;
  pass := pass + 1; raise notice 'ok  a self-declared win waits for the opponent';

  -- A concedes. Nobody lies to lose, so that settles it immediately.
  perform public.set_uid(ua);
  r := public.warpath_battle_report(v_battle, eb);
  if not (r->>'we_won_race')::boolean then raise exception 'FAIL: agreement did not resolve: %', r; end if;
  if (r->>'winner')::uuid <> eb then raise exception 'FAIL: wrong winner recorded'; end if;
  pass := pass + 1; raise notice 'ok  both sides agreeing resolves it — spoils %', r->>'spoils';

  -- and a further report is a harmless read-back, exactly like mp_resolve_match
  perform public.set_uid(ub);
  r := public.warpath_battle_report(v_battle, ea);
  if (r->>'we_won_race')::boolean then raise exception 'FAIL: a later report overwrote the winner'; end if;
  if (r->>'winner')::uuid <> eb then raise exception 'FAIL: the winner changed on re-report'; end if;
  pass := pass + 1; raise notice 'ok  a double report reads back the authoritative winner';

  -- the loser kept everything that was in the vault
  if (select secured from public.warpath_inventory where expedition_id = ea and kind = 'void_crystal') <> n then
    raise exception 'FAIL: losing a battle took secured vault materials (% -> %)', n,
      (select secured from public.warpath_inventory where expedition_id = ea and kind = 'void_crystal'); end if;
  if (select carried from public.warpath_inventory where expedition_id = ea and kind = 'wood') >= 40 then
    raise exception 'FAIL: the loser kept all of their CARRIED loot'; end if;
  select injured_turns into n from public.warpath_expeditions where id = ea;
  if n <> 2 then raise exception 'FAIL: the loser was not injured'; end if;
  pass := pass + 1; raise notice 'ok  losing costs carried loot and health — the vault is untouched';

  -- ── 11. EXTRACTION ──────────────────────────────────────────────────────
  perform public.set_uid(ua);
  update public.warpath_expeditions set status = 'active', injured_turns = 0, moves_left = 6 where id = ea;
  r := public.warpath_extract_begin(ea);
  if (r->>'ok')::boolean then raise exception 'FAIL: started extraction away from a v_gate'; end if;
  pass := pass + 1; raise notice 'ok  extraction requires standing on a gate';

  select s into v_gate from jsonb_array_elements(public.wp_structures(v_seed)) s where s->>'k' = 'gate' limit 1;
  update public.warpath_expeditions set x = (v_gate->>'x')::int, y = (v_gate->>'y')::int where id = ea;
  r := public.warpath_extract_begin(ea);
  if not (r->>'ok')::boolean then raise exception 'FAIL: extraction at a v_gate refused: %', r; end if;
  pass := pass + 1; raise notice 'ok  extraction started at % (% turns)', v_gate->>'name', r->>'turns';

  if not exists (select 1 from public.warpath_events where v_runid = v_runid and kind = 'extraction_started') then
    raise exception 'FAIL: the run was not told a hero is leaving'; end if;
  pass := pass + 1; raise notice 'ok  the whole run is notified that a hero is extracting';

  r := public.warpath_extract_finish(ea, null);
  if (r->>'ok')::boolean then raise exception 'FAIL: extracted before the countdown finished'; end if;
  pass := pass + 1; raise notice 'ok  cannot extract before the countdown ends';

  -- run the clock out
  for n in 1..3 loop
    perform public.set_uid(ua); perform public.warpath_end_turn(ea);
    perform public.set_uid(ub); perform public.warpath_end_turn(eb);
  end loop;
  perform public.set_uid(ua);
  if (select status from public.warpath_expeditions where id = ea) <> 'ready' then
    raise exception 'FAIL: extraction countdown did not complete (status %)',
      (select status from public.warpath_expeditions where id = ea); end if;
  pass := pass + 1; raise notice 'ok  the countdown ran down over real turns';

  -- ── 12. THE EXTRACTION CAP IS THE WHOLE ECONOMY ─────────────────────────
  v_cap := 6 + 3 * public.wp_level(ea, 'supply');
  -- ask to keep EVERY card, including unsecured ones
  r := public.warpath_extract_finish(ea, (select array_agg(id) from public.warpath_cards where expedition_id = ea));
  if not (r->>'ok')::boolean then raise exception 'FAIL: extract: %', r; end if;
  v_keys := (select array_agg(k) from jsonb_array_elements_text(r->'card_keys') k);
  if coalesce(array_length(v_keys, 1), 0) > v_cap then
    raise exception 'FAIL: extracted % cards, v_cap is %', array_length(v_keys, 1), v_cap; end if;
  pass := pass + 1; raise notice 'ok  asked for everything, got % cards (cap %)', array_length(v_keys, 1), v_cap;

  -- every extracted key must be a card this expedition actually held & secured
  if exists (select 1 from unnest(v_keys) k
              where not exists (select 1 from public.warpath_cards c
                                 where c.expedition_id = ea and c.card_key = k and c.secured)) then
    raise exception 'FAIL: extracted a card the expedition never secured';
  end if;
  pass := pass + 1; raise notice 'ok  every extracted card was a secured card of this expedition';

  -- ...and NONE of them may be a starter card. The 24 loaner cards arrive
  -- secured on turn 1; if they were eligible they would fill the whole cap
  -- with cards the player already owned and the mode would reward nothing.
  if exists (select 1 from unnest(v_keys) k
              where k in (select card_key from public.warpath_starter_pool)
                and not exists (select 1 from public.warpath_cards c
                                 where c.expedition_id = ea and c.card_key = k
                                   and c.source <> 'starter')) then
    raise exception 'FAIL: a starter card was extracted into the permanent collection';
  end if;
  pass := pass + 1; raise notice 'ok  no starter card came home — only what was found out here';

  -- unsecured materials did NOT come home
  if (r->'materials'->>'void_crystal')::int <> 5 then
    raise exception 'FAIL: expected the 5 vaulted crystals, got %', r->'materials'->>'void_crystal'; end if;
  pass := pass + 1; raise notice 'ok  only vaulted materials extracted (5 of the 9 crystals)';

  -- ── 13. THE ONLY BRIDGE TO PERMANENT DATA ───────────────────────────────
  if (select count(*) from public.warpath_grants) <> 1 then
    raise exception 'FAIL: expected exactly one grant row'; end if;
  r := public.warpath_grants_claim();
  if jsonb_array_length(r->'grants') <> 1 then raise exception 'FAIL: grant not returned'; end if;
  pass := pass + 1; raise notice 'ok  the grant drained once';

  r := public.warpath_grants_claim();
  if jsonb_array_length(r->'grants') <> 0 then
    raise exception 'FAIL: the same grant was handed out twice'; end if;
  pass := pass + 1; raise notice 'ok  a grant cannot be claimed twice';

  -- B cannot see or claim A's grant
  perform public.set_uid(ub);
  r := public.warpath_grants_claim();
  if jsonb_array_length(r->'grants') <> 0 then raise exception 'FAIL: B drained A''s grant'; end if;
  pass := pass + 1; raise notice 'ok  a grant belongs to exactly one account';

  -- ── 14. CROSS-ACCOUNT WRITES ────────────────────────────────────────────
  perform public.set_uid(ub);
  r := public.warpath_move(ea, 5, 3);
  if (r->>'ok')::boolean then raise exception 'FAIL: B moved A''s hero'; end if;
  r := public.warpath_harvest(ea);
  if (r->>'ok')::boolean then raise exception 'FAIL: B harvested with A''s hero'; end if;
  r := public.warpath_extract_finish(ea, null);
  if (r->>'ok')::boolean then raise exception 'FAIL: B extracted A''s expedition'; end if;
  r := public.warpath_camp_build(ea, 'watchtower');
  if (r->>'ok')::boolean then raise exception 'FAIL: B built on A''s camp'; end if;
  pass := pass + 1; raise notice 'ok  every RPC refuses to act on another account''s expedition';

  -- extracting frees the account to enter again
  perform public.set_uid(ua);
  perform public.warpath_claim_free_ticket();
  update public.warpath_tickets set tickets = 1, updated_at = now() - interval '9 days' where user_id = ua;
  r := public.warpath_enter('hero_ashen', 'Ashen', 'ticket');
  if not (r->>'ok')::boolean then raise exception 'FAIL: cannot start a new run after extracting: %', r; end if;
  pass := pass + 1; raise notice 'ok  an extracted hero can set out again';

  raise notice '';
  raise notice '════════ % CHECKS PASSED ════════', pass;
end $$;


-- =============================================================================
-- RLS — the claim is "the client cannot write run state directly". The block
-- above runs as the table OWNER, which bypasses RLS entirely, so it proves
-- nothing about that. This one drops to a plain `authenticated` role, where
-- the policies are actually enforced.
-- =============================================================================
do $$
declare
  ua uuid; uc uuid; ea uuid; run_ uuid; failed boolean; pass int := 0;
begin
  select user_id into ua from public.warpath_grants limit 1;
  if ua is null then select id into ua from auth.users limit 1; end if;
  select id, run_id into ea, run_ from public.warpath_expeditions
    where user_id = ua order by entered_at desc limit 1;
  insert into auth.users (email) values ('c@warpath.test') returning id into uc;

  perform public.set_uid(ua);
  set local role authenticated;

  -- SELECT of my own expedition works
  if not exists (select 1 from public.warpath_expeditions where id = ea) then
    raise exception 'FAIL: a player cannot read their own expedition'; end if;
  pass := pass + 1; raise notice 'ok  RLS lets a player read their own expedition';

  -- but every write is refused
  failed := false;
  begin insert into public.warpath_cards (expedition_id, card_key, source)
          values (ea, 'unit:broodTyrant', 'boss');
  exception when others then failed := true; end;
  if not failed then raise exception 'FAIL: a client inserted a card straight into its pool'; end if;
  pass := pass + 1; raise notice 'ok  a client cannot insert into warpath_cards';

  failed := false;
  begin update public.warpath_inventory set secured = 9999 where expedition_id = ea;
  exception when others then failed := true; end;
  if not failed and (select coalesce(max(secured),0) from public.warpath_inventory
                      where expedition_id = ea) = 9999 then
    raise exception 'FAIL: a client rewrote its own inventory'; end if;
  pass := pass + 1; raise notice 'ok  a client cannot rewrite warpath_inventory';

  failed := false;
  begin insert into public.warpath_grants (user_id, run_id, card_keys)
          values (ua, run_, ARRAY['unit:broodTyrant','unit:paladin']);
  exception when others then failed := true; end;
  if not failed then
    raise exception 'FAIL: a client wrote its own grant — the permanent collection is reachable'; end if;
  pass := pass + 1; raise notice 'ok  a client cannot forge a warpath_grants row (the permanent bridge)';

  failed := false;
  begin update public.warpath_expeditions set x = 0, y = 3, moves_left = 99 where id = ea;
  exception when others then failed := true; end;
  if not failed and (select moves_left from public.warpath_expeditions where id = ea) = 99 then
    raise exception 'FAIL: a client teleported its own hero'; end if;
  pass := pass + 1; raise notice 'ok  a client cannot move its hero by writing the table';

  -- a stranger sees nothing of this run
  perform public.set_uid(uc);
  if exists (select 1 from public.warpath_expeditions where run_id = run_) then
    raise exception 'FAIL: a non-participant can read the run''s expeditions'; end if;
  if exists (select 1 from public.warpath_grants) then
    raise exception 'FAIL: a stranger can read someone else''s grants'; end if;
  pass := pass + 1; raise notice 'ok  a non-participant reads nothing of the run';

  reset role;
  raise notice '';
  raise notice '════════ RLS: % CHECKS PASSED ════════', pass;
end $$;

-- =============================================================================
-- REGRESSIONS from the P2 critic. Each of these was a live defect.
-- =============================================================================
do $$
declare
  ua uuid; ub uuid; ea uuid; eb uuid; r jsonb; v_seed bigint; v_run uuid;
  v_site jsonb; n int; pass int := 0; failed boolean;
begin
  delete from public.warpath_grants; delete from public.warpath_events;
  delete from public.warpath_battles; delete from public.warpath_node_claims;
  delete from public.warpath_encounters; delete from public.warpath_recruit_claims;
  delete from public.warpath_cards; delete from public.warpath_inventory;
  delete from public.warpath_camps; delete from public.warpath_expeditions;
  delete from public.warpath_runs; delete from public.warpath_tickets;

  insert into auth.users (email) values ('reg-a@warpath.test') returning id into ua;
  insert into auth.users (email) values ('reg-b@warpath.test') returning id into ub;
  insert into public.warpath_tickets (user_id, tickets) values (ua, 5), (ub, 5);

  -- ── 1. wp_level must be 0, not NULL, for a hero with NO camp ────────────
  -- The original returned NULL, which (a) let a CAMPLESS hero pass the
  -- Recruitment Tent gate that a camped hero failed, and (b) made
  -- `6 + 3 * NULL` = NULL so `limit cap` became LIMIT ALL — no extraction cap
  -- at all. The earlier suite could not catch this: it pitched a camp first.
  perform public.set_uid(ua);
  r := public.warpath_enter('hero_a', 'A', 'ticket');
  ea := (r->>'expedition_id')::uuid; v_run := (r->>'run_id')::uuid;
  select seed into v_seed from public.warpath_runs where id = v_run;

  if public.wp_level(ea, 'recruitment') is null then
    raise exception 'FAIL: wp_level returns NULL for a campless hero'; end if;
  if public.wp_level(ea, 'recruitment') <> 0 then
    raise exception 'FAIL: wp_level should be 0 with no camp'; end if;
  if public.wp_vault_slots(ea) <> 0 then
    raise exception 'FAIL: a campless hero has vault slots'; end if;
  if (6 + 3 * public.wp_level(ea, 'supply')) is null then
    raise exception 'FAIL: the extraction cap is NULL for a campless hero — LIMIT ALL'; end if;
  pass := pass + 1; raise notice 'ok  wp_level is 0 (not NULL) with no camp — cap and tent gate both hold';

  -- and the tent gate actually refuses a campless hero the rank-4 offer
  select s into v_site from jsonb_array_elements(public.wp_structures(v_seed)) s
    where s->>'k' = 'site' limit 1;
  update public.warpath_expeditions set x = (v_site->>'x')::int, y = (v_site->>'y')::int where id = ea;
  update public.warpath_inventory i set carried = 500
    from public.warpath_resources rr where rr.kind = i.kind and rr.tier = 'expedition'
     and i.expedition_id = ea;
  r := public.warpath_recruit(ea, v_site->>'id', 2);
  if (r->>'ok')::boolean then
    raise exception 'FAIL: a CAMPLESS hero recruited the rank-4 unit'; end if;
  pass := pass + 1; raise notice 'ok  a campless hero cannot out-recruit a camped one';

  -- ── 2. the campless extraction cap is a real number ────────────────────
  -- Give the hero more secured cards than the base cap and confirm it bites.
  insert into public.warpath_cards (expedition_id, card_key, source, secured, acquired_turn)
    select ea, 'unit:goblin', 'discovery', true, 1 from generate_series(1, 30);
  update public.warpath_expeditions set status = 'ready' where id = ea;
  r := public.warpath_extract_finish(ea, null);
  if not (r->>'ok')::boolean then raise exception 'FAIL: extract: %', r; end if;
  n := coalesce(array_length((select array_agg(k) from jsonb_array_elements_text(r->'card_keys') k), 1), 0);
  if n <> 6 then
    raise exception 'FAIL: campless extraction returned % cards, cap is 6', n; end if;
  pass := pass + 1; raise notice 'ok  a campless hero extracts exactly 6 cards, not all 30';

  -- ── 3. wp_reveal / wp_log are not callable by a client ─────────────────
  -- Both are security definer, mutating, and take an arbitrary expedition id.
  -- The grant loop used to match only warpath_% and left these EXECUTE TO PUBLIC.
  if has_function_privilege('authenticated', 'public.wp_reveal(uuid,integer,integer,integer)', 'execute') then
    raise exception 'FAIL: authenticated can execute wp_reveal — it can clear another player''s fog';
  end if;
  if has_function_privilege('authenticated', 'public.wp_log(uuid,uuid,text,jsonb)', 'execute') then
    raise exception 'FAIL: authenticated can execute wp_log — it can forge run-feed entries';
  end if;
  if has_function_privilege('public', 'public.wp_reveal(uuid,integer,integer,integer)', 'execute') then
    raise exception 'FAIL: PUBLIC can execute wp_reveal';
  end if;
  -- but the two the RLS policies depend on must stay callable
  if not has_function_privilege('authenticated', 'public.wp_in_run(uuid)', 'execute') then
    raise exception 'FAIL: wp_in_run is not executable — every RLS policy breaks';
  end if;
  if not has_function_privilege('authenticated', 'public.wp_is_mine(uuid)', 'execute') then
    raise exception 'FAIL: wp_is_mine is not executable — every RLS policy breaks';
  end if;
  pass := pass + 1; raise notice 'ok  wp_reveal / wp_log are private; the two policy helpers stay callable';

  -- ── 4. PvP costs movement and cannot repeat in one turn ────────────────
  perform public.set_uid(ub);
  r := public.warpath_enter('hero_b', 'B', 'ticket');
  eb := (r->>'expedition_id')::uuid;
  update public.warpath_expeditions set x = 11, y = 3, moves_left = 6, status = 'active' where id = ea;
  update public.warpath_expeditions set x = 12, y = 3, moves_left = 6, status = 'active' where id = eb;

  perform public.set_uid(ub);
  r := public.warpath_battle_open(eb, ea);
  if not (r->>'ok')::boolean then raise exception 'FAIL: adjacent challenge refused: %', r; end if;
  select moves_left into n from public.warpath_expeditions where id = eb;
  if n <> 4 then raise exception 'FAIL: attacking cost % movement, expected 2', 6 - n; end if;
  pass := pass + 1; raise notice 'ok  challenging a Hero costs 2 movement';

  -- resolve it properly: B claims, A concedes. A bare win claim now leaves the
  -- battle OPEN awaiting the opponent, so without the concession the next
  -- assertion would trip on battle_already_open instead of the rule it tests.
  perform public.warpath_battle_report((r->>'battle_id')::uuid, eb);
  perform public.set_uid(ua);
  perform public.warpath_battle_report((r->>'battle_id')::uuid, eb);
  perform public.set_uid(ub);
  if (select status from public.warpath_battles where id = (r->>'battle_id')::uuid) <> 'resolved' then
    raise exception 'FAIL: agreement did not resolve the battle'; end if;

  r := public.warpath_battle_open(eb, ea);
  if (r->>'ok')::boolean then
    raise exception 'FAIL: the same pairing fought twice in one turn — free re-attack'; end if;
  if r->>'reason' <> 'already_fought_this_turn' then
    raise exception 'FAIL: wrong refusal: %', r->>'reason'; end if;
  pass := pass + 1; raise notice 'ok  the same two Heroes cannot fight twice in one turn';

  -- and with no movement left you cannot attack at all
  update public.warpath_expeditions set moves_left = 1 where id = eb;
  update public.warpath_battles set opened_turn = -1 where run_id = (select run_id from public.warpath_expeditions where id = eb);
  r := public.warpath_battle_open(eb, ea);
  if (r->>'ok')::boolean then raise exception 'FAIL: attacked with 1 movement left'; end if;
  pass := pass + 1; raise notice 'ok  attacking requires the movement to do it';

  -- ── 5. seeds are non-negative ──────────────────────────────────────────
  failed := false;
  begin insert into public.warpath_runs (seed) values (-1);
  exception when check_violation then failed := true; end;
  if not failed then raise exception 'FAIL: a negative seed was accepted — JS and plpgsql drift there'; end if;
  pass := pass + 1; raise notice 'ok  a negative seed is rejected by a CHECK, not by a comment';

  raise notice '';
  raise notice '════════ REGRESSIONS: % CHECKS PASSED ════════', pass;
end $$;

-- ── 6. fog: another player's row must not be readable from the table ──────
do $$
declare ua uuid; ub uuid; ra uuid; n int; pass int := 0;
begin
  select user_id into ua from public.warpath_expeditions order by entered_at limit 1;
  select run_id  into ra from public.warpath_expeditions where user_id = ua limit 1;
  select user_id into ub from public.warpath_expeditions where run_id = ra and user_id <> ua limit 1;
  if ub is null then raise notice 'skip: only one player in the run'; return; end if;

  perform public.set_uid(ua);
  set local role authenticated;
  -- warpath_state() filters other heroes against MY fog. The TABLE must not
  -- hand out what the function refuses — a critic read x/y/hp straight off it.
  select count(*) into n from public.warpath_expeditions where user_id = ub;
  if n <> 0 then
    raise exception 'FAIL: another player''s expedition row is readable — fog is decorative';
  end if;
  select count(*) into n from public.warpath_camps
   where expedition_id in (select id from public.warpath_expeditions where user_id = ub);
  if n <> 0 then raise exception 'FAIL: another player''s camp row is readable'; end if;
  select count(*) into n from public.warpath_expeditions where user_id = ua;
  if n = 0 then raise exception 'FAIL: a player cannot read their OWN expedition'; end if;
  reset role;
  pass := 1;
  raise notice 'ok  a rival''s position is not readable from the table, only through warpath_state()';
  raise notice '';
  raise notice '════════ FOG: % CHECK PASSED ════════', pass;
end $$;

-- =============================================================================
-- P3 round-2 critic: the mock let a client reset its own extraction countdown
-- forever. The critic could not check whether the SERVER had the same hole.
-- It does not — but "does not" needs to be an assertion, not a reading.
-- =============================================================================
do $$
declare ua uuid; ea uuid; r jsonb; v_seed bigint; v_gate jsonb; n int; pass int := 0;
begin
  delete from public.warpath_grants; delete from public.warpath_events;
  delete from public.warpath_battles; delete from public.warpath_node_claims;
  delete from public.warpath_encounters; delete from public.warpath_recruit_claims;
  delete from public.warpath_cards; delete from public.warpath_inventory;
  delete from public.warpath_camps; delete from public.warpath_expeditions;
  delete from public.warpath_runs; delete from public.warpath_tickets;

  insert into auth.users (email) values ('ex@warpath.test') returning id into ua;
  insert into public.warpath_tickets (user_id, tickets) values (ua, 3);
  perform public.set_uid(ua);
  r := public.warpath_enter('hero_e', 'E', 'ticket');
  ea := (r->>'expedition_id')::uuid;
  select seed into v_seed from public.warpath_runs where id = (r->>'run_id')::uuid;

  select s into v_gate from jsonb_array_elements(public.wp_structures(v_seed)) s
    where s->>'k' = 'gate' limit 1;
  update public.warpath_expeditions set x = (v_gate->>'x')::int, y = (v_gate->>'y')::int where id = ea;

  r := public.warpath_extract_begin(ea);
  if not (r->>'ok')::boolean then raise exception 'FAIL: extraction refused at a gate: %', r; end if;
  select extract_left into n from public.warpath_expeditions where id = ea;
  if n <> 2 then raise exception 'FAIL: countdown started at %, expected 2', n; end if;

  -- burn one turn, then try to restart the countdown
  perform public.warpath_end_turn(ea);
  select extract_left into n from public.warpath_expeditions where id = ea;
  if n <> 1 then raise exception 'FAIL: countdown did not tick (at %)', n; end if;

  r := public.warpath_extract_begin(ea);
  if (r->>'ok')::boolean then
    raise exception 'FAIL: a hero already extracting restarted its own countdown';
  end if;
  if r->>'reason' <> 'not_active' then raise exception 'FAIL: wrong refusal: %', r->>'reason'; end if;
  select extract_left into n from public.warpath_expeditions where id = ea;
  if n <> 1 then raise exception 'FAIL: the refused call still moved the countdown (now %)', n; end if;
  pass := pass + 1;
  raise notice 'ok  an extracting hero cannot restart its own countdown (server side)';

  -- and a hero who has already left cannot begin again either
  perform public.warpath_end_turn(ea);
  r := public.warpath_extract_finish(ea, null);
  if not (r->>'ok')::boolean then raise exception 'FAIL: extract_finish: %', r; end if;
  r := public.warpath_extract_begin(ea);
  if (r->>'ok')::boolean then raise exception 'FAIL: an extracted hero began extracting again'; end if;
  pass := pass + 1;
  raise notice 'ok  an extracted hero cannot begin extracting again';

  -- the refusal now names which wallet was short
  raise notice '';
  raise notice '════════ EXTRACTION GUARDS: % CHECKS PASSED ════════', pass;
end $$;

do $$
declare ua uuid; ea uuid; r jsonb; v_seed bigint; v_site jsonb; pass int := 0;
begin
  select user_id into ua from public.warpath_expeditions order by entered_at desc limit 1;
  perform public.set_uid(ua);
  update public.warpath_tickets set tickets = 3 where user_id = ua;
  r := public.warpath_enter('hero_w2', 'W2', 'ticket');
  if not (r->>'ok')::boolean then raise notice 'skip: %', r->>'reason'; return; end if;
  ea := (r->>'expedition_id')::uuid;
  select seed into v_seed from public.warpath_runs where id = (r->>'run_id')::uuid;

  -- BUILD is refused against the SECURED wallet
  update public.warpath_inventory set secured = 0, carried = 500 where expedition_id = ea;
  perform public.warpath_camp_place(ea);
  r := public.warpath_camp_build(ea, 'supply');
  if (r->>'ok')::boolean then raise exception 'FAIL: built from carried stock'; end if;
  if r->>'wallet' <> 'secured' then
    raise exception 'FAIL: build refusal did not name the secured wallet (got %)', r->>'wallet'; end if;
  pass := pass + 1; raise notice 'ok  a build refusal names the SECURED wallet';

  -- RECRUIT is refused against the CARRIED wallet
  select s into v_site from jsonb_array_elements(public.wp_structures(v_seed)) s
    where s->>'k' = 'site' limit 1;
  update public.warpath_expeditions set x = (v_site->>'x')::int, y = (v_site->>'y')::int where id = ea;
  update public.warpath_inventory set secured = 500, carried = 0 where expedition_id = ea;
  update public.warpath_camps set buildings = '{"campfire":1,"recruitment":1}'::jsonb
    where expedition_id = ea;
  r := public.warpath_recruit(ea, v_site->>'id', 0);
  if (r->>'ok')::boolean then raise exception 'FAIL: recruited from the vault'; end if;
  if r->>'reason' <> 'insufficient' then raise exception 'FAIL: wrong reason %', r->>'reason'; end if;
  if r->>'wallet' <> 'carried' then
    raise exception 'FAIL: recruit refusal did not name the carried wallet (got %)', r->>'wallet'; end if;
  pass := pass + 1; raise notice 'ok  a recruit refusal names the CARRIED wallet';

  raise notice '';
  raise notice '════════ WALLETS: % CHECKS PASSED ════════', pass;
end $$;

-- =============================================================================
-- Four-player harness findings B3, B4, B7, B8. Each was live behaviour.
-- =============================================================================
do $$
declare
  ua uuid; ub uuid; ea uuid; eb uuid; r jsonb; v_run uuid; v_seed bigint;
  v_gate jsonb; n int; pass int := 0;
begin
  delete from public.warpath_grants; delete from public.warpath_events;
  delete from public.warpath_battles; delete from public.warpath_node_claims;
  delete from public.warpath_encounters; delete from public.warpath_recruit_claims;
  delete from public.warpath_cards; delete from public.warpath_inventory;
  delete from public.warpath_camps; delete from public.warpath_expeditions;
  delete from public.warpath_runs; delete from public.warpath_tickets;

  insert into auth.users (email) values ('b3a@w.test') returning id into ua;
  insert into auth.users (email) values ('b3b@w.test') returning id into ub;
  insert into public.warpath_tickets (user_id, tickets) values (ua, 5), (ub, 5);

  perform public.set_uid(ua);
  r := public.warpath_enter('h', 'Ash', 'ticket');
  ea := (r->>'expedition_id')::uuid; v_run := (r->>'run_id')::uuid;
  select seed into v_seed from public.warpath_runs where id = v_run;
  perform public.set_uid(ub);
  r := public.warpath_enter('h', 'Vex', 'ticket');
  eb := (r->>'expedition_id')::uuid;

  -- ── B7: ending your turn must actually END it ──────────────────────────
  perform public.set_uid(ua);
  update public.warpath_expeditions set x = 11, y = 3, moves_left = 6 where id = ea;
  perform public.warpath_end_turn(ea);
  if not (select turn_ended from public.warpath_expeditions where id = ea) then
    raise exception 'FAIL: end_turn did not set turn_ended'; end if;
  r := public.warpath_move(ea, 11, 4);
  if (r->>'ok')::boolean then
    raise exception 'FAIL: moved after ending the turn — the barrier is decorative'; end if;
  if r->>'reason' <> 'turn_already_ended' then raise exception 'FAIL: wrong reason %', r->>'reason'; end if;
  r := public.warpath_harvest(ea);
  if (r->>'ok')::boolean then raise exception 'FAIL: harvested after ending the turn'; end if;
  r := public.warpath_camp_place(ea);
  if (r->>'ok')::boolean then raise exception 'FAIL: pitched camp after ending the turn'; end if;
  pass := pass + 1; raise notice 'ok  ending a turn stops movement, harvesting and camping';

  -- let the turn roll over
  perform public.set_uid(ub); perform public.warpath_end_turn(eb);

  -- ── B3: a defeat must interrupt an extraction ──────────────────────────
  perform public.set_uid(ua);
  select s into v_gate from jsonb_array_elements(public.wp_structures(v_seed)) s
    where s->>'k' = 'gate' limit 1;
  update public.warpath_expeditions set x = (v_gate->>'x')::int, y = (v_gate->>'y')::int,
         status = 'active', moves_left = 6, turn_ended = false where id = ea;
  perform public.warpath_camp_place(ea);
  r := public.warpath_extract_begin(ea);
  if not (r->>'ok')::boolean then raise exception 'FAIL: extract_begin: %', r; end if;
  if (select status from public.warpath_expeditions where id = ea) <> 'extracting' then
    raise exception 'FAIL: not extracting'; end if;

  update public.warpath_expeditions set x = (v_gate->>'x')::int + 1, y = (v_gate->>'y')::int,
         moves_left = 6, turn_ended = false, protected_until = 0 where id = eb;
  perform public.set_uid(ub);
  r := public.warpath_battle_open(eb, ea);
  if not (r->>'ok')::boolean then raise exception 'FAIL: could not challenge an extracting hero: %', r; end if;
  perform public.warpath_battle_report((r->>'battle_id')::uuid, eb);
  perform public.set_uid(ua);
  perform public.warpath_battle_report((r->>'battle_id')::uuid, eb);   -- concede

  if (select status from public.warpath_expeditions where id = ea) <> 'active' then
    raise exception 'FAIL: a hero beaten mid-extraction is still extracting (status %)',
      (select status from public.warpath_expeditions where id = ea); end if;
  if (select extract_left from public.warpath_expeditions where id = ea) <> 0 then
    raise exception 'FAIL: the countdown survived the defeat'; end if;
  if not exists (select 1 from public.warpath_events where run_id = v_run and kind = 'extraction_broken') then
    raise exception 'FAIL: nobody was told the extraction was broken'; end if;
  pass := pass + 1; raise notice 'ok  losing mid-extraction cancels the countdown';

  -- ── B4: a beaten hero cannot be pinned on its own campfire ─────────────
  n := (select protected_until from public.warpath_expeditions where id = ea);
  if n <= (select turn from public.warpath_runs where id = v_run) then
    raise exception 'FAIL: no regrouping grace after a defeat (protected_until %)', n; end if;
  perform public.set_uid(ub);
  update public.warpath_battles set opened_turn = -1 where run_id = v_run;   -- clear the per-turn cap
  update public.warpath_expeditions set moves_left = 6 where id = eb;
  r := public.warpath_battle_open(eb, ea);
  if (r->>'ok')::boolean then
    raise exception 'FAIL: a just-beaten hero was re-challenged immediately — that is a hostage, not a raid'; end if;
  if r->>'reason' <> 'target_regrouping' then raise exception 'FAIL: wrong reason %', r->>'reason'; end if;
  pass := pass + 1; raise notice 'ok  a beaten hero gets a grace period before it can be hit again';

  -- ── B8: the completion screen must not lie ─────────────────────────────
  perform public.set_uid(ua);
  update public.warpath_expeditions set status = 'ready', extract_left = 0 where id = ea;
  -- nothing secured beyond the loaner deck: the honest answer is 0, not null
  delete from public.warpath_cards where expedition_id = ea and source <> 'starter';
  r := public.warpath_extract_finish(ea, null);
  if not (r->>'ok')::boolean then raise exception 'FAIL: extract_finish: %', r; end if;
  if (r->'summary'->>'cards_secured') is null then
    raise exception 'FAIL: cards_secured is null — array_length on an empty array'; end if;
  if (r->'summary'->>'cards_secured')::int <> 0 then
    raise exception 'FAIL: cards_secured should be 0, got %', r->'summary'->>'cards_secured'; end if;
  if (r->'summary' ? 'resources_extracted') then
    raise exception 'FAIL: still reporting resources_extracted — expedition resources never come home'; end if;
  if (r->'summary'->>'resources_gathered')::int <> 0 then
    raise exception 'FAIL: resources_gathered counted the starting stipend (got %)',
      r->'summary'->>'resources_gathered'; end if;
  pass := pass + 1; raise notice 'ok  the completion screen reports 0 as 0, and gathered rather than extracted';

  raise notice '';
  raise notice '════════ HARNESS FINDINGS: % CHECKS PASSED ════════', pass;
end $$;

-- =============================================================================
-- PvP VISIBILITY — the Watchtower, the extraction reciprocal, the Scout Report.
-- Deterministic, because four-run sim samples are far too noisy to tell whether
-- a feature fires at all.
-- =============================================================================
do $$
declare
  ua uuid; ub uuid; ea uuid; eb uuid; r jsonb; v_run uuid; v_seed bigint;
  v_gate jsonb; st jsonb; n int; pass int := 0;
begin
  delete from public.warpath_grants; delete from public.warpath_events;
  delete from public.warpath_battles; delete from public.warpath_node_claims;
  delete from public.warpath_encounters; delete from public.warpath_recruit_claims;
  delete from public.warpath_cards; delete from public.warpath_inventory;
  delete from public.warpath_camps; delete from public.warpath_expeditions;
  delete from public.warpath_runs; delete from public.warpath_tickets;

  insert into auth.users (email) values ('w1@w.test') returning id into ua;
  insert into auth.users (email) values ('w2@w.test') returning id into ub;
  insert into public.warpath_tickets (user_id, tickets) values (ua, 5), (ub, 5);
  perform public.set_uid(ua);
  r := public.warpath_enter('h', 'Watcher', 'ticket');
  ea := (r->>'expedition_id')::uuid; v_run := (r->>'run_id')::uuid;
  select seed into v_seed from public.warpath_runs where id = v_run;
  perform public.set_uid(ub);
  r := public.warpath_enter('h', 'Neighbour', 'ticket');
  eb := (r->>'expedition_id')::uuid;

  -- two camps 10 tiles apart: inside a Tower I's 12, outside the old 8
  perform public.set_uid(ua);
  update public.warpath_expeditions set x = 18, y = 15, moves_left = 6 where id = ea;
  perform public.warpath_camp_place(ea);
  perform public.set_uid(ub);
  update public.warpath_expeditions set x = 28, y = 15, moves_left = 6 where id = eb;
  perform public.warpath_camp_place(eb);

  -- ── the tower must not report before it is built ───────────────────────
  perform public.set_uid(ua); perform public.warpath_end_turn(ea);
  perform public.set_uid(ub); perform public.warpath_end_turn(eb);
  if exists (select 1 from public.warpath_events where run_id = v_run and kind = 'watchtower_report') then
    raise exception 'FAIL: a camp with no Watchtower reported anyway'; end if;
  perform public.set_uid(ua);
  st := public.warpath_state();
  if (st->'others'->0->'camp') is not null and (st->'others'->0->>'camp') <> 'null' then
    raise exception 'FAIL: an unexplored rival camp is visible without a tower'; end if;
  pass := pass + 1; raise notice 'ok  no Watchtower, no report — the rival camp stays unknown';

  -- ── build it, and it must fire ─────────────────────────────────────────
  update public.warpath_camps set buildings = '{"campfire":1,"watchtower":1}'::jsonb
   where expedition_id = ea;
  perform public.set_uid(ua); perform public.warpath_end_turn(ea);
  perform public.set_uid(ub); perform public.warpath_end_turn(eb);

  select count(*) into n from public.warpath_events
   where run_id = v_run and kind = 'watchtower_report' and expedition_id = ea;
  if n < 1 then
    raise exception 'FAIL: a Watchtower I did not report a camp 10 tiles away — the building the game charges 40 wood for still does nothing'; end if;
  pass := pass + 1; raise notice 'ok  a Watchtower reports a rival camp 10 tiles out';

  -- and the camp is now actually on the owner's map, via ordinary fog
  perform public.set_uid(ua);
  st := public.warpath_state();
  if (st->'others'->0->'camp'->>'x')::int <> 28 then
    raise exception 'FAIL: the reported camp did not become visible in warpath_state'; end if;
  pass := pass + 1; raise notice 'ok  the reported camp appears on the map through normal fog';

  -- ...and it must NOT report the same camp again every turn
  perform public.set_uid(ua); perform public.warpath_end_turn(ea);
  perform public.set_uid(ub); perform public.warpath_end_turn(eb);
  select count(*) into n from public.warpath_events
   where run_id = v_run and kind = 'watchtower_report' and expedition_id = ea;
  if n > 1 then raise exception 'FAIL: the tower re-reports known camps every turn (% events)', n; end if;
  pass := pass + 1; raise notice 'ok  the tower reports only NEW intel, it does not spam the feed';

  -- ── the tower never reports a live hero position ───────────────────────
  update public.warpath_expeditions set x = 20, y = 15 where id = eb;   -- 2 tiles from A's camp
  perform public.set_uid(ua);
  st := public.warpath_state();
  if (st->'others'->0->>'x') is not null and not (st->'others'->0->>'visible')::boolean then
    raise exception 'FAIL: a hero position leaked through the tower channel'; end if;
  pass := pass + 1; raise notice 'ok  the tower reports camps only — live positions stay behind fog';

  -- ── the extraction reciprocal ──────────────────────────────────────────
  -- ⚠ Use a PORTAL, not the main gate. warpath_enter reveals the Warpath Gate
  -- to every entrant on purpose (you walked in through it), so the main gate is
  -- universally known and always has watchers. The interesting case — and the
  -- whole reason the count exists — is the quiet portal nobody has found.
  select s into v_gate from jsonb_array_elements(public.wp_structures(v_seed)) s
    where s->>'k' = 'gate' and (s->>'main')::boolean is not true limit 1;
  perform public.set_uid(ua);
  update public.warpath_expeditions set x = (v_gate->>'x')::int, y = (v_gate->>'y')::int,
         status = 'active', turn_ended = false, moves_left = 6 where id = ea;
  r := public.warpath_extract_begin(ea);
  if not (r->>'ok')::boolean then raise exception 'FAIL: extract_begin: %', r; end if;
  if (r->'watchers') is null then
    raise exception 'FAIL: extraction does not report how many rivals can act on the warning'; end if;
  if (r->>'watchers')::int <> 0 then
    raise exception 'FAIL: expected 0 watchers at an unfound portal, got %', r->>'watchers'; end if;
  pass := pass + 1; raise notice 'ok  extracting at an undiscovered portal reports 0 rivals watching';

  -- now let B explore that portal, and the count must rise
  perform public.wp_reveal(eb, (v_gate->>'x')::int, (v_gate->>'y')::int, 1);
  update public.warpath_expeditions set status = 'active', extract_left = 0 where id = ea;
  r := public.warpath_extract_begin(ea);
  if (r->>'watchers')::int <> 1 then
    raise exception 'FAIL: a rival who has explored the portal was not counted (got %)', r->>'watchers'; end if;
  pass := pass + 1; raise notice 'ok  a rival who knows the portal is counted — the risk is priced';

  -- and the main gate, which everyone entered through, is correctly loud
  select s into v_gate from jsonb_array_elements(public.wp_structures(v_seed)) s
    where s->>'k' = 'gate' and (s->>'main')::boolean is true limit 1;
  update public.warpath_expeditions set x = (v_gate->>'x')::int, y = (v_gate->>'y')::int,
         status = 'active', extract_left = 0 where id = ea;
  r := public.warpath_extract_begin(ea);
  if (r->>'watchers')::int < 1 then
    raise exception 'FAIL: the Warpath Gate is known to every entrant and should never read 0'; end if;
  pass := pass + 1; raise notice 'ok  the main gate always reads as watched — that is what it is for';

  -- and the public broadcast still carries no coordinates (B6)
  if exists (select 1 from public.warpath_events
              where run_id = v_run and kind = 'extraction_started' and payload ? 'x') then
    raise exception 'FAIL: the extraction broadcast is publishing coordinates again'; end if;
  pass := pass + 1; raise notice 'ok  the broadcast still names the gate, not the tile';

  -- ── the Scout Report ───────────────────────────────────────────────────
  perform public.set_uid(ua);
  update public.warpath_expeditions e set x = c.x, y = c.y, status = 'active',
         moves_left = 6, turn_ended = false, extract_left = 0, scouted_turn = 0
    from public.warpath_camps c where c.expedition_id = e.id and e.id = ea;
  r := public.warpath_scout_report(ea);
  if not (r->>'ok')::boolean then raise exception 'FAIL: scout report: %', r; end if;
  if jsonb_array_length(r->'reports') < 1 then
    raise exception 'FAIL: the scout found nothing though the tower already located a camp'; end if;
  if (r->'reports'->0 ? 'x') or (r->'reports'->0 ? 'y') then
    raise exception 'FAIL: the scout report leaks coordinates — it must give a direction and a band'; end if;
  if (r->>'moves_left')::int <> 5 then
    raise exception 'FAIL: the scout report did not cost 1 movement (left %)', r->>'moves_left'; end if;
  pass := pass + 1; raise notice 'ok  the scout reports direction + band for %, costs 1 movement',
    r->'reports'->0->>'hero';

  r := public.warpath_scout_report(ea);
  if (r->>'ok')::boolean then raise exception 'FAIL: the scout reported twice in one turn'; end if;
  pass := pass + 1; raise notice 'ok  one scout report per turn';

  -- a camp you have never seen is not reported
  perform public.set_uid(ub);
  update public.warpath_expeditions e set x = c.x, y = c.y, moves_left = 6, turn_ended = false,
         scouted_turn = 0 from public.warpath_camps c
   where c.expedition_id = e.id and e.id = eb;
  r := public.warpath_scout_report(eb);
  if jsonb_array_length(r->'reports') <> 0 then
    raise exception 'FAIL: the scout reported a camp its owner has never discovered'; end if;
  pass := pass + 1; raise notice 'ok  the scout only re-surfaces what you already found';

  raise notice '';
  raise notice '════════ PvP VISIBILITY: % CHECKS PASSED ════════', pass;
end $$;

-- =============================================================================
-- B5 safety half: an unreported battle must not pin two players forever, and a
-- disagreement must leave a trace. The AUTHORITY half is not solved here — see
-- docs/mp-server-authority-shared-engine.md.
-- =============================================================================
do $$
declare
  ua uuid; ub uuid; ea uuid; eb uuid; r jsonb; v_run uuid; v_b uuid; n int; pass int := 0;
begin
  delete from public.warpath_grants; delete from public.warpath_events;
  delete from public.warpath_battles; delete from public.warpath_node_claims;
  delete from public.warpath_encounters; delete from public.warpath_recruit_claims;
  delete from public.warpath_cards; delete from public.warpath_inventory;
  delete from public.warpath_camps; delete from public.warpath_expeditions;
  delete from public.warpath_runs; delete from public.warpath_tickets;

  insert into auth.users (email) values ('d1@w.test') returning id into ua;
  insert into auth.users (email) values ('d2@w.test') returning id into ub;
  insert into public.warpath_tickets (user_id, tickets) values (ua, 5), (ub, 5);
  perform public.set_uid(ua);
  r := public.warpath_enter('h', 'Aggro', 'ticket');
  ea := (r->>'expedition_id')::uuid; v_run := (r->>'run_id')::uuid;
  perform public.set_uid(ub);
  r := public.warpath_enter('h', 'Victim', 'ticket');
  eb := (r->>'expedition_id')::uuid;

  update public.warpath_expeditions set x = 18, y = 15, moves_left = 6, turn_ended = false,
         protected_until = 0 where id = ea;
  update public.warpath_expeditions set x = 19, y = 15, moves_left = 6, turn_ended = false,
         protected_until = 0 where id = eb;

  -- the attacker opens a fight and then vanishes
  perform public.set_uid(ua);
  r := public.warpath_battle_open(ea, eb);
  if not (r->>'ok')::boolean then raise exception 'FAIL: battle_open: %', r; end if;
  v_b := (r->>'battle_id')::uuid;

  -- the DEFENDER, who did not choose this, is frozen
  perform public.set_uid(ub);
  r := public.warpath_move(eb, 20, 15);
  if (r->>'ok')::boolean then raise exception 'FAIL: expected the defender to be pinned'; end if;
  if r->>'reason' <> 'battle_pending' then raise exception 'FAIL: wrong reason %', r->>'reason'; end if;
  pass := pass + 1; raise notice 'ok  an open battle pins the defender (the problem)';

  -- nobody reports. Two turns later it must expire and release them both.
  for n in 1..3 loop
    perform public.set_uid(ua); perform public.warpath_end_turn(ea);
    perform public.set_uid(ub); perform public.warpath_end_turn(eb);
  end loop;
  if (select status from public.warpath_battles where id = v_b) <> 'abandoned' then
    raise exception 'FAIL: an unreported battle is still open — two players are pinned for the whole run (status %)',
      (select status from public.warpath_battles where id = v_b); end if;
  if (select winner_id from public.warpath_battles where id = v_b) is not null then
    raise exception 'FAIL: an unwitnessed battle awarded a winner'; end if;
  pass := pass + 1; raise notice 'ok  a battle nobody reports expires instead of pinning both heroes';

  perform public.set_uid(ub);
  update public.warpath_expeditions set moves_left = 6, turn_ended = false, status = 'active' where id = eb;
  r := public.warpath_move(eb, 20, 15);
  if not (r->>'ok')::boolean then
    raise exception 'FAIL: the defender is still frozen after the battle expired: %', r; end if;
  pass := pass + 1; raise notice 'ok  and both heroes can move again';

  if not exists (select 1 from public.warpath_events where run_id = v_run and kind = 'battle_abandoned') then
    raise exception 'FAIL: the expiry was silent'; end if;
  pass := pass + 1; raise notice 'ok  the expiry is recorded in the run feed';

  -- ── a disagreement leaves a trace ──────────────────────────────────────
  update public.warpath_expeditions set x = 18, y = 15, moves_left = 6, turn_ended = false,
         protected_until = 0, status = 'active' where id = ea;
  update public.warpath_expeditions set x = 19, y = 15, moves_left = 6, turn_ended = false,
         protected_until = 0, status = 'active' where id = eb;
  perform public.set_uid(ua);
  r := public.warpath_battle_open(ea, eb);
  v_b := (r->>'battle_id')::uuid;
  perform public.warpath_battle_report(v_b, ea);        -- attacker claims itself
  perform public.set_uid(ub);
  perform public.warpath_battle_report(v_b, eb);        -- defender claims itself
  if (select status from public.warpath_battles where id = v_b) <> 'open' then
    raise exception 'FAIL: two contradictory self-claims resolved anyway'; end if;
  pass := pass + 1; raise notice 'ok  two players both claiming victory resolves neither';

  perform public.set_uid(ua); perform public.warpath_end_turn(ea);
  perform public.set_uid(ub); perform public.warpath_end_turn(eb);
  if not exists (select 1 from public.warpath_events where run_id = v_run and kind = 'battle_disputed') then
    raise exception 'FAIL: the disagreement was not logged — nothing to audit later'; end if;
  if (select status from public.warpath_battles where id = v_b) <> 'resolved' then
    raise exception 'FAIL: the disputed battle never settled'; end if;
  pass := pass + 1; raise notice 'ok  a disputed verdict is logged, then settled so nobody stays pinned';

  raise notice '';
  raise notice '════════ BATTLE SAFETY: % CHECKS PASSED ════════', pass;
end $$;
