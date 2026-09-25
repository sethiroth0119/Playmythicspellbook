-- 162_vault_declared_spend.sql   (applied 2026-09-19)
-- 🧾 A DECLARED SPEND IS NOT A WIPE.
--
-- Player report: "I can donate and the resources reappear, so multiple
-- donations happen, and also I can't empty my vault as a result."
--
-- up_guard (sql/100) keeps OLD forge.__salvage__ whenever a write takes a vault
-- of >= 200 units to <= 10% of itself. That is the right answer for a device
-- that never hydrated, and the WRONG answer for a Foundation Reserve
-- contribution or corp-vault deposit of a whole stack: the reserve row and the
-- Cinder reward land, the vault debit is silently reverted, the next hydration
-- puts the units back, and the player donates them again. It also makes it
-- impossible to empty a vault on purpose.
-- (.gauntlet/donate-dupe-probe.mjs reproduces it end to end.)
--
-- THE CHANGE. The client (patched index.html) counts every deliberate debit
-- and sends it as forge.__vaultSpend__ = { spent, base }. The salvage clause
-- now refuses only an UNEXPLAINED collapse:
--     old >= 200  and  new <= old * 0.10
--     and (old - new - declared_spent) > greatest(50, old * 0.10)
-- An un-hydrated device declares nothing, so it is refused exactly as before.
-- A client can only use the declaration to LOWER its own vault, which RLS
-- already lets it do by writing smaller numbers -- nothing is minted by it.
-- The key is stripped from NEW.forge so it never persists and can never be
-- replayed by a later write that carries the stored blob.
--
-- ⚠ ROLLOUT ORDER: apply THIS FIRST, then ship the client. With declared = 0
--   (every current client) this function behaves exactly like the live one.
--   The patched client against the OLD trigger still dupes (the write lands,
--   the trigger silently keeps the old vault) -- the probe shows that too.
--
-- Everything else is byte-for-byte the live body (pg_get_functiondef,
-- 2026-09-19). RLS on user_profiles is untouched: this is a trigger function,
-- no table or policy is created or altered. Idempotent (create or replace).

create or replace function public.up_guard()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  saved text[] := '{}';
  forced boolean := coalesce(current_setting('app.up_force', true), '') = '1';
  last_arch timestamptz;
  last_refusal timestamptz;
  old_units numeric;
  new_units numeric;
  declared numeric := 0;
begin
  -- 🧾 Read the declaration and strip it BEFORE anything else, including the
  --    forced path, so it is never stored.
  if TG_OP <> 'DELETE' and NEW.forge is not null and jsonb_typeof(NEW.forge) = 'object'
     and NEW.forge ? '__vaultSpend__' then
    begin
      declared := greatest(0, coalesce((NEW.forge -> '__vaultSpend__' ->> 'spent')::numeric, 0));
    exception when others then
      declared := 0;   -- a malformed declaration declares nothing
    end;
    NEW.forge := NEW.forge - '__vaultSpend__';
  end if;

  if forced then
    if TG_OP = 'DELETE' then return OLD; end if;
    return NEW;
  end if;

  select max(archived_at) into last_arch
    from public.user_profiles_history where user_id = OLD.user_id;

  if last_arch is null or last_arch < now() - interval '5 minutes' then
    insert into public.user_profiles_history
      (user_id, display_name, records, competitive, heroes, units, gems, sovereigns,
       deck_history, decks, settings, forge, wallet_seq, row_updated, reason)
    values
      (OLD.user_id, OLD.display_name, OLD.records, OLD.competitive, OLD.heroes, OLD.units,
       OLD.gems, OLD.sovereigns, OLD.deck_history, OLD.decks, OLD.settings, OLD.forge,
       OLD.wallet_seq, OLD.updated_at, TG_OP);
  end if;

  if TG_OP = 'DELETE' then
    return null;
  end if;

  if up_jsonb_count(OLD.heroes) > 0 and up_jsonb_count(NEW.heroes) = 0 then
    NEW.heroes := OLD.heroes; saved := array_append(saved, 'heroes');
  end if;
  if up_jsonb_count(OLD.units) > 0 and up_jsonb_count(NEW.units) = 0 then
    NEW.units := OLD.units; saved := array_append(saved, 'units');
  end if;
  if up_jsonb_count(OLD.decks) > 0 and up_jsonb_count(NEW.decks) = 0 then
    NEW.decks := OLD.decks; saved := array_append(saved, 'decks');
  end if;
  if up_jsonb_count(OLD.deck_history) > 0 and up_jsonb_count(NEW.deck_history) = 0 then
    NEW.deck_history := OLD.deck_history; saved := array_append(saved, 'deck_history');
  end if;
  if up_jsonb_count(OLD.forge) > 0 and up_jsonb_count(NEW.forge) = 0 then
    NEW.forge := OLD.forge; saved := array_append(saved, 'forge');
  end if;
  if up_jsonb_count(OLD.records) > 0 and up_jsonb_count(NEW.records) = 0 then
    NEW.records := OLD.records; saved := array_append(saved, 'records');
  end if;

  old_units := up_salvage_units(OLD.forge);
  new_units := up_salvage_units(NEW.forge);
  if old_units >= 200 and new_units <= old_units * 0.10
     and (old_units - new_units - declared) > greatest(50, old_units * 0.10) then
    NEW.forge := jsonb_set(coalesce(NEW.forge, '{}'::jsonb), '{__salvage__}',
                           coalesce(OLD.forge -> '__salvage__', '{}'::jsonb), true);
    saved := array_append(saved,
      'forge.__salvage__ (' || round(old_units) || '->' || round(new_units)
      || case when declared > 0 then ', declared ' || round(declared) else '' end || ')');
  end if;

  if OLD.gems > 0 and NEW.gems = 0 and coalesce(NEW.wallet_seq,0) <= coalesce(OLD.wallet_seq,0) then
    NEW.gems := OLD.gems; saved := array_append(saved, 'gems');
  end if;
  if OLD.sovereigns > 0 and NEW.sovereigns = 0 and coalesce(NEW.wallet_seq,0) <= coalesce(OLD.wallet_seq,0) then
    NEW.sovereigns := OLD.sovereigns; saved := array_append(saved, 'sovereigns');
  end if;

  if array_length(saved, 1) is not null then
    select max(row_updated) into last_refusal
      from public.user_profiles_history
     where user_id = OLD.user_id and reason like 'REFUSED-WIPE%';

    if last_refusal is null or last_refusal < now() - interval '5 minutes' then
      insert into public.user_profiles_history
        (user_id, heroes, units, decks, deck_history, forge, records, gems, row_updated, reason)
      values
        (OLD.user_id, OLD.heroes, OLD.units, OLD.decks, OLD.deck_history, OLD.forge,
         OLD.records, OLD.gems, now(),
         'REFUSED-WIPE: kept ' || array_to_string(saved, ','));
    else
      insert into public.user_profiles_history
        (user_id, gems, row_updated, reason)
      values
        (OLD.user_id, OLD.gems, now(),
         'REFUSED-WIPE (repeat): kept ' || array_to_string(saved, ','));
    end if;
    raise warning 'up_guard kept % for user %', array_to_string(saved, ','), OLD.user_id;
  end if;

  return NEW;
end;
$function$;

-- The trigger binding itself is unchanged (it already calls public.up_guard()).

-- ═══ VERIFY ════════════════════════════════════════════════════════════════
select position('__vaultSpend__' in pg_get_functiondef(p.oid)) > 0 as honours_declared_spend,
       position('up_salvage_units' in pg_get_functiondef(p.oid)) > 0 as still_guards_vault,
       (select count(*) from pg_trigger t where t.tgfoid = p.oid and not t.tgisinternal) as bound_triggers
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname = 'up_guard';
