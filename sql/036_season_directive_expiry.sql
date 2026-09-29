-- ===========================================================================
-- 036 — STOP STALE RESET DIRECTIVES WIPING PLAYERS WHO CHANGE DEVICES.
--
-- THE BUG. season_apply suppresses a directive only for a user who ALREADY
-- TOOK IT. That is the wrong question. Anyone who missed it at the time — new
-- account, new device, cleared storage, a phone that had not been opened in a
-- week — is still "unapplied", so they take a reset published on 07-28 today,
-- in August, with a real collection behind them.
--
-- Observed in production: five accounts in four days each applied ALL FIVE
-- historical directives within a single minute (the fingerprint of a device
-- with no local record), every one of them ending on zero Cinder:
--
--   08-12 17:10  53af15c6   5 directives   0 cards    0 cinder
--   08-12 10:24  53eb89a1   5 directives  19 cards    0 cinder
--   08-12 08:12  37592af1   5 directives   0 cards    0 cinder
--   08-12 00:08  e40ef8ca   5 directives  50 cards    0 cinder
--   08-11 23:52  2feefce7   5 directives 420 cards    0 cinder
--
-- v120w0 retired the build-stamped one-shot, which was the other half of the
-- same fault. This is the half that survived, and it is the bigger one because
-- it reaches every player, not only those on a second device.
--
-- 🔴 WHY THE GATE LIVES ON THE SERVER, NOT IN THE CLIENT.
--    _applySeasonReset returns without touching anything unless this RPC
--    answers {ok:true, already:false}:
--        if (!_sj || _sj.ok !== true) return;
--        _seasonMarkApplied(sr.id);
--        if (_sj.already) return;
--    So refusing here protects players on OLD CACHED BUILDS too — which a
--    client-side fix cannot do, and which matters because the players being
--    hurt are by definition the ones whose install is out of date.
--
-- TWO GATES, because they fail differently:
--   • EXPIRY (72h) — a directive is an event, not a standing order. It should
--     reach everyone who plays within a few days and then stop existing. 72h
--     covers a long weekend away; past that, wiping someone does more harm
--     than leaving them un-reset.
--   • ACCOUNT AGE — an account created AFTER a directive was published was
--     never part of the economy it was correcting. It must never be wiped by
--     it, at any age, expiry window or not.
--
-- ⚠ Returns already:true rather than ok:false ON PURPOSE. The client treats
--   already:true as "someone else took care of this", marks it locally and
--   stops asking. ok:false would leave the directive permanently unapplied and
--   the client would re-fire this RPC on every 120s poll, for all nine stale
--   rows, for every player, forever.
--
-- ⚠ NOTHING IS DELETED. The nine directives and all 494 application rows stay
--   exactly as they are — this only changes who a directive may still act on.
--   skipped_reason keeps the audit honest: a row written by this gate did NOT
--   wipe anybody, and can be told apart from one that did.
--
-- Idempotent and re-runnable. Verify queries at the bottom.
-- ===========================================================================

-- Additive and nullable: every existing row keeps meaning "this user was
-- actually wiped by this directive", which is what they do mean.
alter table public.season_reset_applied
  add column if not exists skipped_reason text;

comment on column public.season_reset_applied.skipped_reason is
  'NULL = the directive really was applied to this user. Non-NULL = season_apply '
  'recorded it to stop re-evaluation but deliberately did NOT wipe anything '
  '(expired directive, or an account created after the directive was published).';

create or replace function public.season_apply(p_reset_id uuid)
returns jsonb
language plpgsql security definer set search_path = public as $function$
declare
  v_scope text; v_new integer;
  v_created timestamptz;
  v_acct    timestamptz;
  v_skip    text := null;
  -- A directive is an event with a short reach, not a standing order.
  c_ttl constant interval := interval '72 hours';
begin
  if auth.uid() is null then return jsonb_build_object('ok', false, 'error', 'not_signed_in'); end if;

  select scope, created_at into v_scope, v_created from season_reset where id = p_reset_id;
  if v_scope is null then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;

  -- ── THE GATE ──────────────────────────────────────────────────────────────
  -- Checked BEFORE the insert below, so a user who legitimately took this
  -- directive at the time still short-circuits on the conflict as they always
  -- have, and their row is never rewritten with a skip reason.
  if v_created is not null and v_created < now() - c_ttl then
    v_skip := 'expired';
  else
    -- An account that did not exist when the directive was published was never
    -- part of the economy it corrects. Never wipe it, at any age.
    begin
      select created_at into v_acct from auth.users where id = auth.uid();
      if v_acct is not null and v_created is not null and v_acct > v_created then
        v_skip := 'account_newer';
      end if;
    exception when others then null;   -- auth schema unreadable → fall through
    end;
  end if;

  if v_skip is not null then
    -- Record it so the client stops asking, but wipe NOTHING.
    insert into season_reset_applied (user_id, reset_id, skipped_reason)
    values (auth.uid(), p_reset_id, v_skip)
    on conflict (user_id, reset_id) do nothing;
    return jsonb_build_object('ok', true, 'already', true, 'scope', v_scope, 'skipped', v_skip);
  end if;
  -- ──────────────────────────────────────────────────────────────────────────

  insert into season_reset_applied (user_id, reset_id) values (auth.uid(), p_reset_id)
    on conflict (user_id, reset_id) do nothing;
  get diagnostics v_new = row_count;
  if v_new = 0 then return jsonb_build_object('ok', true, 'already', true, 'scope', v_scope); end if;

  if v_scope = 'full' then
    update user_progress set cinder = 0, updated_at = now() where user_id = auth.uid();
    update user_profiles set
      gems = 0,
      heroes = coalesce((select jsonb_object_agg(k, case when jsonb_typeof(v) = 'object'
                 then (v - 'statGains' - 'evs' - 'knownMoves' - 'pendingLearn' - 'subclass') || '{"level":1,"xp":0}'::jsonb
                 else v end)
               from jsonb_each(coalesce(heroes, '{}'::jsonb)) t(k, v)), '{}'::jsonb),
      units = coalesce((select jsonb_object_agg(k, case when jsonb_typeof(v) = 'object'
                 then (v - 'statGains' - 'evs' - 'knownMoves' - 'pendingLearn' - 'subclass') || '{"level":1,"xp":0}'::jsonb
                 else v end)
               from jsonb_each(coalesce(units, '{}'::jsonb)) t(k, v)), '{}'::jsonb),
      forge = (case when coalesce(forge, '{}'::jsonb) ? '__account__'
                 then jsonb_set(coalesce(forge, '{}'::jsonb), '{__account__}',
                      coalesce(forge->'__account__', '{}'::jsonb) || '{"level":1,"xp":0,"totalXp":0}'::jsonb)
                 else coalesce(forge, '{}'::jsonb) end)
              || jsonb_build_object('__aiHeroes__', '{}'::jsonb, '__aiUnits__', '{}'::jsonb),
      updated_at = now()
    where user_id = auth.uid();
  elsif v_scope = 'business' then
    update user_profiles set
      forge = coalesce(forge, '{}'::jsonb) || '{"__jbLocalOps__":[],"__blackRiver__":{},"__princePortfolios__":{},"__fishingCorp__":{},"__fuelCommand__":{},"__cityCards__":{}}'::jsonb,
      updated_at = now()
    where user_id = auth.uid();
  elsif v_scope = 'resources' then
    -- Salvage ledger, carried field bag, base-vault layout, and ALL gear:
    -- the item inventory, what is equipped on each unit, relic equipment and
    -- every hero loadout.
    update user_profiles set
      forge = coalesce(forge, '{}'::jsonb) || '{
        "__salvage__":{}, "__fieldBag__":{}, "__vaultLayout__":{},
        "__itemInventory__":{}, "__equipment__":{}, "__relicEquipment__":{},
        "__heroLoadouts__":{}
      }'::jsonb,
      updated_at = now()
    where user_id = auth.uid();
  elsif v_scope = 'purge' then
    -- 🧹 ECONOMY PURGE (post-exploit). Wealth and inventory go; PROGRESSION STAYS.
    -- Aza (sovereigns) is untouched - it is bought with real money.
    perform public._season_purge_apply(auth.uid());
  end if;

  return jsonb_build_object('ok', true, 'already', false, 'scope', v_scope);
end $function$;

revoke all on function public.season_apply(uuid) from public, anon;
grant execute on function public.season_apply(uuid) to authenticated;

-- ===========================================================================
-- VERIFY
--
-- 1) Every existing directive should now be out of reach (all are 10-16 days old):
--      select scope, to_char(created_at,'MM-DD') as published,
--             round(extract(epoch from (now()-created_at))/3600) as age_hours,
--             (created_at < now() - interval '72 hours') as expired
--        from public.season_reset order by created_at;
--
-- 2) Nothing was destroyed — counts must be unchanged (9 and 494):
--      select (select count(*) from public.season_reset) as directives,
--             (select count(*) from public.season_reset_applied) as applications,
--             (select count(*) from public.season_reset_applied
--               where skipped_reason is not null) as skips_so_far;
--
-- 3) Watch the gate work. Rows appearing here wiped NOBODY:
--      select skipped_reason, count(*), max(applied_at)
--        from public.season_reset_applied
--       where skipped_reason is not null group by 1;
--
-- 4) And the real thing to watch — this should stay empty from now on:
--      select to_char(a.applied_at,'MM-DD HH24:MI') as applied,
--             left(a.user_id::text,8) as usr, sr.scope, a.skipped_reason
--        from public.season_reset_applied a
--        join public.season_reset sr on sr.id = a.reset_id
--       where a.applied_at > now() - interval '2 days'
--         and a.skipped_reason is null
--       order by 1 desc;
--
-- 🎯 PUBLISHING A NEW RESET STILL WORKS. A directive created now is inside the
--    72h window, so it applies to every account that predates it, exactly as
--    before. The gate only refuses history.
-- ===========================================================================
