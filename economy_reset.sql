-- ═══════════════════════════════════════════════════════════════════════════
-- 💥 ECONOMY RESET  —  server half of the `scope:'economy'` season directive.
--
-- Zeroes every store of WEALTH for every player, and touches NOTHING that
-- represents time played.
--   WIPED : every currency (user_progress.cinder, user_profiles.gems +
--           sovereigns, the bank_of_ethos row), corp_treasury + corp_operations,
--           and every OWNED key on the profile row — card collection, decks,
--           packs, gear, items, resources, vault, property, cosmetics and shop
--           licences. Players are returned to the starter-deck picker.
--   KEPT  : heroes / units jsonb (levels, xp, kills, wins, losses, bonds,
--           statGains, knownMoves), forge.__account__, skill trees,
--           achievements, campaign + roguelite progress, match log, usage.
--   ADMINS: exempt. Enforced HERE, independently of the client check, so a
--           tampered client cannot wipe an admin and an admin cannot wipe
--           themselves by accident.
--
-- Run the three steps IN ORDER in the Supabase SQL editor.
-- ⚠ Deploy the game build that knows scope 'economy' BEFORE running STEP 3 —
--   a directive is consumed once per account by whatever build is running, and
--   an old build would consume it doing nothing at all (see the v118t6 note in
--   the season-wipe history).
-- ═══════════════════════════════════════════════════════════════════════════


-- ─── STEP 1 ─── Allow the new scope on the directive table.
-- The insert from the admin button is REJECTED until this runs.
alter table public.season_reset
  drop constraint if exists season_reset_scope_check;

alter table public.season_reset
  add constraint season_reset_scope_check
  check (scope in ('full', 'business', 'resources', 'purge', 'economy'));


-- ─── STEP 2 ─── The RPC the client calls after its local clear.
-- SECURITY DEFINER so it can write the caller's own rows; it only ever
-- touches auth.uid()'s rows, so it cannot be used to wipe anyone else.
create or replace function public.economy_reset_row()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid   uuid := auth.uid();
  mail  text;
  out   jsonb := '[]'::jsonb;
begin
  if uid is null then
    return jsonb_build_object('ok', false, 'error', 'not_authenticated');
  end if;

  -- 👑 ADMIN EXEMPTION. Keep this list in step with ADMIN_EMAILS in index.html.
  select lower(coalesce(email, '')) into mail from auth.users where id = uid;
  if mail in ('richaegisop@gmail.com', 'play@mythicsoa.com', 'dev@mythicspellbook.com') then
    return jsonb_build_object('ok', true, 'admin_exempt', true, 'cleared', '[]'::jsonb);
  end if;

  -- 🔥 Cinder — the authoritative balance. walletFetchProgress does
  --    MAX(server, local), which is exactly why the local zero is not enough.
  update public.user_progress set cinder = 0 where user_id = uid and cinder <> 0;
  if found then out := out || '["cinder"]'::jsonb; end if;

  -- 🔥👑 The profile mirrors: gems (Cinder) and sovereigns (Aza).
  update public.user_profiles set gems = 0 where user_id = uid and coalesce(gems, 0) <> 0;
  if found then out := out || '["gems"]'::jsonb; end if;

  update public.user_profiles set sovereigns = 0 where user_id = uid and coalesce(sovereigns, 0) <> 0;
  if found then out := out || '["sovereigns"]'::jsonb; end if;

  -- 🏦 Bank of Ethos. Balances only — the ledger, directory and request history
  --    are records of what happened and are deliberately left intact.
  begin
    update public.bank_of_ethos
       set aza = 0, balance = 0, resources = '{}'::jsonb, updated_at = now()
     where user_id = uid;
    if found then out := out || '["bank_of_ethos"]'::jsonb; end if;
  exception when undefined_table or undefined_column then null;
  end;

  -- 🏭 The money printers. Operations and treasuries mint currency; leaving them
  --    standing refills every wallet within days and makes the reset pointless.
  begin
    delete from public.corp_operations where user_id = uid;
    if found then out := out || '["corp_operations"]'::jsonb; end if;
  exception when undefined_table or undefined_column then null;
  end;

  begin
    delete from public.corp_treasury where user_id = uid;
    if found then out := out || '["corp_treasury"]'::jsonb; end if;
  exception when undefined_table or undefined_column then null;
  end;

  -- 🧹 THE PROFILE ROW. Everything OWNED is dropped; everything EARNED is left
  --    alone. Keys are DROPPED rather than emptied because hydration only merges
  --    a key that is PRESENT — an empty object would still be merged over by a
  --    stale local copy (the trap that made resources "come back" in v118t5).
  --    ⚠ These names are load-bearing and were verified against the payload
  --    builder in index.html (~L44098+). Do not guess new ones.
  begin
    update public.user_profiles
       set forge = (coalesce(forge, '{}'::jsonb)
                    -- 🏭 businesses / money printers
                    - '__blackRiver__' - '__princePortfolios__' - '__fishingCorp__'
                    - '__fuelCommand__' - '__cityCards__' - '__jbLocalOps__'
                    -- 🃏 collection, decks and packs
                    - '__cardCollection__' - '__sideDeck__' - '__archonDeck__'
                    - '__socketedGems__' - '__gemsOwned__' - '__unopenedPacks__'
                    - '__packHistory__' - '__essence__' - '__chests__'
                    - '__chestKeys__' - '__coupons__'
                    -- 🧰 gear, items, resources, bag, vault
                    - '__itemInventory__' - '__equipment__' - '__relicEquipment__'
                    - '__heroLoadouts__' - '__salvage__' - '__fieldBag__'
                    - '__vaultLayout__'
                    -- 🏠 property, cosmetics, shop licences
                    - '__ownedHouses__' - '__homeZones__' - '__furnitureOwned__'
                    - '__cxHoldings__' - '__cosmetics__'
                    - '__ownedTombstones__' - '__equippedTombstone__'
                    - '__ownedAvatars__' - '__equippedAvatar__'
                    - '__ownedSleeves__' - '__equippedSleeve__'
                    - '__unlockedTraders__' - '__traderStock__'
                    - '__dojoUnlocked__' - '__dojoStock__'
                    -- 🎴 back to the starter picker
                    - '__starterPicked__' - '__starterDeckId__')
     where user_id = uid
       and jsonb_typeof(coalesce(forge, '{}'::jsonb)) = 'object';
    if found then out := out || '["forge_owned_keys"]'::jsonb; end if;
  exception when undefined_table or undefined_column then null;
  end;
  -- ⚠ DELIBERATELY NOT TOUCHED — this is the "keep their stats" half:
  --   __account__ (level/xp/totalXp) · heroes / units jsonb (levels, kills,
  --   wins, bonds, statGains, knownMoves) · __heroSkillTrees__ · __heroBonds__ ·
  --   __heroPersonality__ · __achievements__ · __campaignProgress__ ·
  --   __rlcCompleted__ · __matchLog__ · __leaderboard__ · __usage__.
  --   If a future edit adds one of those to the drop list, the reset has stopped
  --   being what was asked for.

  return jsonb_build_object('ok', true, 'admin_exempt', false, 'cleared', out);
end;
$$;

revoke all on function public.economy_reset_row() from public, anon;
grant execute on function public.economy_reset_row() to authenticated;


-- ─── STEP 3 ─── PUBLISH THE DIRECTIVE.  ⚠ THIS IS THE IRREVERSIBLE ONE.
-- You do NOT need to run this by hand — the 💥 Economy Reset button in the camp
-- admin strip inserts exactly this row and applies it to you immediately. Use
-- the SQL only if you would rather fire it from here.
-- Uncomment to publish:
--
-- insert into public.season_reset (label, scope, created_by)
-- values ('Economy reset ' || to_char(now(), 'YYYY-MM-DD'), 'economy', auth.uid());


-- ─── OPTIONAL ─── Baseline BEFORE firing, so you can tell whether it worked.
-- Re-run afterwards: the money columns should fall to ~0 (admins excepted),
-- while the progression counts must stay FLAT. If heroes/units/account move,
-- the branch is wiping progression and must be stopped immediately.
--
-- select
--   count(*) filter (where coalesce(gems,0) > 0)                 as with_cinder,
--   count(*) filter (where coalesce(sovereigns,0) > 0)           as with_aza,
--   count(*) filter (where forge ? '__cardCollection__')         as with_cards,
--   count(*) filter (where forge ? '__account__')                as with_account,
--   count(*) filter (where jsonb_typeof(coalesce(heroes,'{}'::jsonb)) = 'object'
--                      and heroes <> '{}'::jsonb)                as with_heroes
-- from public.user_profiles;
-- select count(*) filter (where cinder > 0) as progress_with_cinder from public.user_progress;
