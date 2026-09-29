-- ════════════════════════════════════════════════════════════════════════════
-- 070 · PROFILES NEVER WIPE — history, and a refusal to empty an account
--
-- ── WHAT WAS MEASURED (2026-08-28, against the live database) ──────────────
--
--   auth users                                   116
--   ...with a duplicate email                      0    ← sign-in is NOT the bug
--   ...with no user_profiles row                   0
--
--   Accounts whose profile holds NO heroes, NO units and NO decks,
--   broken down by how many live sessions (≈ devices) they have:
--
--       1 session   (single device)      0 of 10 empty     0%
--       2-3 sessions                     9 of 54 empty    17%
--       4+ sessions (several devices)    9 of 44 empty    20%
--
--   Not one single-device account is empty. Roughly one in five multi-device
--   accounts is. Among them: a player who joined in June, synced yesterday,
--   holds 10,587,259 gems — and has zero heroes, zero units, zero decks.
--   Gems survived; everything that makes the account an account did not.
--
-- ── WHAT THIS FILE DOES AND DOES NOT CLAIM ────────────────────────────────
--
--   It does NOT claim to have found the client bug. The client already carries
--   a hydration gate, a stale-cloud guard, a foreign-profile reset, a
--   force-restore-on-SIGNED_IN, and two anti-wipe predicates
--   (_profileLooksEmpty / _cloudRowHasProgress). They are careful and they are
--   mostly right, which is exactly why the remaining hole has survived this
--   long: it is not in the obvious place, and every previous fix was aimed by
--   reasoning rather than by a row that could not have been written.
--
--   So this file stops aiming. A guard in the client protects only players
--   running the newest build; a guard on the table protects everyone, forever,
--   including anyone on a stale cached copy — the same argument that made
--   cml_guard (067) and city_state_guard (064) the fixes that actually held.
--
-- ── DESIGN: REPAIR, DO NOT REFUSE ─────────────────────────────────────────
--
--   The obvious trigger raises an exception on a destructive write. That is
--   WRONG HERE. This row is saved by a debounced background upload during
--   normal play; an exception means the save fails, and the player then loses
--   the session's real progress to protect them from losing their heroes.
--
--   Instead this trigger REPAIRS the write in flight: any field that would go
--   from populated to empty keeps its old value, every other field updates
--   normally, and the event is recorded. The save still succeeds. The account
--   heals itself instead of erroring at the player.
--
--   ⚠ ONE-DIRECTIONAL ON PURPOSE. Populated → empty is blocked; empty →
--     populated, and populated → different, both pass untouched. Normal play
--     never empties a collection: you do not go from six heroes to none by
--     playing. A deliberate wipe still has up_force_reset() below.
--
-- RUN THIS WHOLE FILE. It is idempotent and safe to re-run.
-- ════════════════════════════════════════════════════════════════════════════

begin;

-- ── 1 · THE UNDO LOG ───────────────────────────────────────────────────────
-- Every version of every profile, kept before it is overwritten. This is the
-- piece whose absence made the 18 already-emptied accounts unrecoverable:
-- there was no copy of what they held five minutes earlier.
create table if not exists public.user_profiles_history (
  hid           bigserial primary key,
  user_id       uuid not null,
  display_name  text,
  records       jsonb,
  competitive   jsonb,
  heroes        jsonb,
  units         jsonb,
  gems          integer,
  sovereigns    integer,
  deck_history  jsonb,
  decks         jsonb,
  settings      jsonb,
  forge         jsonb,
  wallet_seq    bigint,
  row_updated   timestamptz,
  reason        text,
  archived_at   timestamptz not null default now()
);

create index if not exists uph_user_time on public.user_profiles_history (user_id, archived_at desc);

alter table public.user_profiles_history enable row level security;
drop policy if exists uph_sel_own on public.user_profiles_history;
create policy uph_sel_own on public.user_profiles_history
  for select to authenticated using (user_id = auth.uid());

-- ── 2 · HOW WE DECIDE A JSONB FIELD "HAS SOMETHING" ────────────────────────
-- Objects and arrays both occur in this schema (heroes/units/decks are stored
-- as OBJECTS keyed by id, forge holds arrays), so count both rather than
-- assuming one. Assuming the shape is precisely the mistake that makes a
-- guard silently never fire.
create or replace function public.up_jsonb_count(v jsonb)
returns integer language sql immutable as $$
  select case jsonb_typeof(v)
           when 'object' then (select count(*)::int from jsonb_object_keys(v))
           when 'array'  then jsonb_array_length(v)
           else 0
         end;
$$;

-- ── 3 · THE GUARD ──────────────────────────────────────────────────────────
create or replace function public.up_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  saved text[] := '{}';
  forced boolean := coalesce(current_setting('app.up_force', true), '') = '1';
  last_arch timestamptz;
begin
  -- 🔓 THE SANCTIONED BYPASS. up_force_reset() sets app.up_force for its own
  -- transaction. Without this the guard would repair a DELIBERATE reset right
  -- back to what it was, leaving no way to clear a test or support account —
  -- a guard with no override is a guard someone eventually disables entirely.
  if forced then
    if TG_OP = 'DELETE' then return OLD; end if;
    return NEW;
  end if;

  /* ⏱ THROTTLED ARCHIVE. This row is written by a 4-second debounced upload
     during ordinary play, so archiving EVERY update would add ~34 KB per save
     per player — city_state_history took 2,167 rows in 48 hours on a much
     smaller row. One copy per user per 5 minutes is enough to undo a wipe
     (the wipe is the thing we need the previous version of), and a repair is
     ALWAYS recorded regardless of the throttle, below. */
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
    -- Nothing legitimately deletes a profile. Turn it into a no-op rather than
    -- an error: the caller believes it succeeded, and the account survives.
    return null;
  end if;

  -- Repair each collection that would collapse from populated to empty.
  -- ⚠ array_append, NOT `saved || 'heroes'`. Postgres reads text[] || <literal>
  --   as an ARRAY LITERAL and throws `malformed array literal: "heroes"`, which
  --   turns every rescue into an exception — the save FAILS instead of being
  --   repaired. Caught by the rollback test the moment this first went live.
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

  -- 💰 THE WALLET IS DIFFERENT — it has a server-side sequence. gems may fall
  -- legitimately (the player spent them), so this only catches the collapse
  -- shape: a positive balance going to exactly zero while wallet_seq did NOT
  -- advance, i.e. no server debit explains it.
  if OLD.gems > 0 and NEW.gems = 0 and coalesce(NEW.wallet_seq,0) <= coalesce(OLD.wallet_seq,0) then
    NEW.gems := OLD.gems; saved := array_append(saved, 'gems');
  end if;
  if OLD.sovereigns > 0 and NEW.sovereigns = 0 and coalesce(NEW.wallet_seq,0) <= coalesce(OLD.wallet_seq,0) then
    NEW.sovereigns := OLD.sovereigns; saved := array_append(saved, 'sovereigns');
  end if;

  if array_length(saved, 1) is not null then
    -- Recorded as its own history row, and NEVER throttled — a rescue is the
    -- one event we must not miss. Run the query at the bottom of this file to
    -- see whether the client bug is still happening and to how many people.
    insert into public.user_profiles_history
      (user_id, heroes, units, decks, deck_history, forge, records, gems, row_updated, reason)
    values
      (OLD.user_id, OLD.heroes, OLD.units, OLD.decks, OLD.deck_history, OLD.forge,
       OLD.records, OLD.gems, now(),
       'REFUSED-WIPE: kept ' || array_to_string(saved, ','));
    raise warning 'up_guard kept % for user %', array_to_string(saved, ','), OLD.user_id;
  end if;

  return NEW;
end;
$$;

drop trigger if exists up_guard_upd on public.user_profiles;
create trigger up_guard_upd before update on public.user_profiles
  for each row execute function public.up_guard();

drop trigger if exists up_guard_del on public.user_profiles;
create trigger up_guard_del before delete on public.user_profiles
  for each row execute function public.up_guard();

-- ── 4 · PUTTING ONE BACK ───────────────────────────────────────────────────
-- Restore a profile to the newest archived version that actually had content.
-- Returns the number of fields restored, 0 if there was nothing better.
create or replace function public.up_restore(p_user uuid)
returns text language plpgsql security definer set search_path = public as $$
declare h public.user_profiles_history%rowtype;
begin
  if not ms_is_admin() then raise exception 'admin only'; end if;
  select * into h from public.user_profiles_history
   where user_id = p_user
     and (up_jsonb_count(heroes) > 0 or up_jsonb_count(units) > 0 or up_jsonb_count(decks) > 0)
   order by archived_at desc limit 1;
  if not found then return 'nothing recoverable for ' || p_user; end if;
  update public.user_profiles set
    heroes = h.heroes, units = h.units, decks = h.decks,
    deck_history = coalesce(h.deck_history, deck_history),
    records = coalesce(h.records, records),
    forge = coalesce(h.forge, forge)
   where user_id = p_user;
  return 'restored from ' || h.archived_at::text;
end;
$$;

-- Deliberate wipe (support request, test account). The guard cannot be turned
-- off, so this is the only sanctioned way to empty a profile.
create or replace function public.up_force_reset(p_user uuid)
returns text language plpgsql security definer set search_path = public as $$
begin
  if not ms_is_admin() then raise exception 'admin only'; end if;
  -- Archive first, by hand: the guard's own archive is skipped on a forced
  -- write, and a deliberate reset is exactly when you most want the copy.
  insert into public.user_profiles_history
    (user_id, display_name, records, competitive, heroes, units, gems, sovereigns,
     deck_history, decks, settings, forge, wallet_seq, row_updated, reason)
  select user_id, display_name, records, competitive, heroes, units, gems, sovereigns,
         deck_history, decks, settings, forge, wallet_seq, updated_at, 'FORCE-RESET'
    from public.user_profiles where user_id = p_user;
  perform set_config('app.up_force', '1', true);   -- true = this transaction only
  update public.user_profiles
     set heroes='{}'::jsonb, units='{}'::jsonb, decks='{}'::jsonb, deck_history='{}'::jsonb
   where user_id = p_user;
  perform set_config('app.up_force', '0', true);
  return 'reset ' || p_user || ' — every prior version is in user_profiles_history';
end;
$$;

commit;

-- ════════════════════════════════════════════════════════════════════════════
-- AFTER RUNNING — is the client bug still firing, and at whom?
--
--   select reason, count(*), max(archived_at)
--     from user_profiles_history
--    where reason like 'REFUSED-WIPE%'
--    group by reason order by 2 desc;
--
-- Every row there is an account that WOULD have been emptied and was not.
-- If that table stays empty for a week, the wipe is not happening any more.
-- If it fills up, it names the exact fields and users to chase — which is the
-- evidence this problem has never had.
-- ════════════════════════════════════════════════════════════════════════════
