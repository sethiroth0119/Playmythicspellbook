-- ════════════════════════════════════════════════════════════════════════════
-- RUN FILE 2026-09-18 — owner-approved refunds and restores
-- Project: ktsiasyjusesawtrwrjc · paste into the Supabase SQL editor.
--
-- PART 1 — REFUNDS. Safe to run NOW. The wallet is server-owned, so a live
--          client cannot undo a credit.
-- PART 2 — RESTORES. Run ONLY AFTER the release carrying commit 1f9779cdde
--          (v121v176 or later) is live. The live v175 client still has the two
--          bugs that erased this data (the camp workforce is not re-read on a
--          reload, and an empty foundry wins the cloud merge), so a restore run
--          against v175 would be wiped again the next time each player reloads.
--
-- Both parts are idempotent: running either twice changes nothing the second
-- time. Each ends with a check query.
-- ════════════════════════════════════════════════════════════════════════════


-- ─── PART 1 · Reconstruction double charges (bug-mtyp80rx) ──────────────────
-- Each hire was billed twice: the server charged the hire, then the client's
-- spend watcher billed the same drop again. Amount per player = the "Spent in
-- Reconstruction" charges within 1.5 s after a "Hired … from …" row.
-- Credited through the canonical wallet helper (user_progress + wallet_ledger).
-- The reason text is the idempotency marker: a player who already has it is
-- skipped.
do $$
declare
  r record;
  v_reason constant text := 'Refund: Reconstruction hire double-charge (bug-mtyp80rx)';
begin
  for r in
    select * from (values
      ('07ac0340-be12-4719-9953-df21c3d56ecd'::uuid, 'MeanCookie', 49639::bigint),
      ('1a618333-072a-429a-b0e8-0ab2af024119'::uuid, 'Yamuns',     20946::bigint),
      ('b82f7acd-ad8f-459b-bae8-1671cfdb31f0'::uuid, 'Sausage',    14902::bigint),
      ('ab9b2ff4-92d9-4d11-a0b4-6e204a903592'::uuid, 'GD2',         8740::bigint),
      ('41c880ac-828b-4ed9-9dbb-cac15984e355'::uuid, 'Mavric',      3561::bigint),
      ('d41b1b6f-ca04-4beb-b224-36f15c5feb64'::uuid, 'Davos',        195::bigint)
    ) as t(uid, name, amount)
  loop
    if exists (select 1 from public.wallet_ledger w where w.user_id = r.uid and w.reason = v_reason) then
      raise notice '% — already refunded, skipped', r.name;
    else
      perform public._ct_cinder_give(r.uid, r.amount, v_reason);
      raise notice '% — refunded %', r.name, r.amount;
    end if;
  end loop;
end $$;

-- Check: expect 6 rows, amounts 49639 / 20946 / 14902 / 8740 / 3561 / 195.
select p.display_name, w.delta as refunded, w.balance_after, w.created_at
  from public.wallet_ledger w join public.user_profiles p using (user_id)
 where w.reason = 'Refund: Reconstruction hire double-charge (bug-mtyp80rx)'
 order by w.delta desc;


-- ─── PART 2 · Restores — RUN AFTER v121v176 IS LIVE ─────────────────────────

-- 2a. Trash Crusher / Foundry (bug-mtzmjvgz). Copies forge.__foundry__ back
--     from the last snapshot before each wipe — only when the player now has
--     FEWER machines than the snapshot (machines are an object keyed by
--     machine id), or, for a stock-only foundry, when the current stock is
--     empty. A player who has rebuilt past the snapshot is never overwritten.
--     GreyDragon lost twice (4 machines on 09-12, then 1 rebuilt machine on
--     09-13) and has 1 machine now; the larger snapshot (hid 21210, 4
--     machines) is restored over it.
update public.user_profiles p
   set forge = jsonb_set(p.forge, '{__foundry__}', h.forge->'__foundry__', true)
  from public.user_profiles_history h,
       (values (23340, 'b82f7acd-ad8f-459b-bae8-1671cfdb31f0'::uuid),   -- Sausage   (8 machines)
               (37980, '4383064f-8fbe-4462-8583-09f18432f8ca'::uuid),   -- LIDS      (15 machines)
               (21210, 'b35a8809-d5cf-4356-8af1-44646550e11b'::uuid),   -- GreyDragon (4 machines)
               (36864, 'b46f7086-94ac-4ecc-b4b0-24d32ec0c7a0'::uuid),   -- Aston Drakonis (1 machine)
               (38681, 'd41b1b6f-ca04-4beb-b224-36f15c5feb64'::uuid)    -- Davos     (stock only)
       ) as s(hid, uid)
 where h.hid = s.hid
   and h.user_id = s.uid
   and p.user_id = s.uid
   and jsonb_typeof(h.forge->'__foundry__') = 'object'
   and (
         (select count(*) from jsonb_object_keys(case when jsonb_typeof(p.forge->'__foundry__'->'machines') = 'object' then p.forge->'__foundry__'->'machines' else '{}'::jsonb end))
       < (select count(*) from jsonb_object_keys(case when jsonb_typeof(h.forge->'__foundry__'->'machines') = 'object' then h.forge->'__foundry__'->'machines' else '{}'::jsonb end))
       or (coalesce(p.forge->'__foundry__'->'inv', '{}'::jsonb) = '{}'::jsonb
           and coalesce(h.forge->'__foundry__'->'inv', '{}'::jsonb) <> '{}'::jsonb
           and (select count(*) from jsonb_object_keys(case when jsonb_typeof(p.forge->'__foundry__'->'machines') = 'object' then p.forge->'__foundry__'->'machines' else '{}'::jsonb end)) = 0)
       )
returning p.display_name,
          (select count(*) from jsonb_object_keys(p.forge->'__foundry__'->'machines')) as machines_restored;

-- 2b. Reconstruction workforce (bug-mtyp80rx). MERGED, not overwritten: each
--     role gets the larger of what the player has now and what the snapshot
--     had, so a worker hired since the wipe is never taken away.
--     Mavric's snapshot (hid 22581, 09-12 16:07, just before the 16:12 wipe)
--     carries his 5 Guards.
update public.user_profiles p
   set forge = jsonb_set(p.forge, '{__campWorkforce__}', merged.wf, true)
  from (
    select s.uid,
           (select jsonb_object_agg(k, greatest(coalesce((cur.wf->>k)::int, 0), coalesce((snap.wf->>k)::int, 0)))
              from (select jsonb_object_keys(coalesce(cur.wf, '{}'::jsonb) || coalesce(snap.wf, '{}'::jsonb)) as k) keys) as wf
      from (values (37374, '1a618333-072a-429a-b0e8-0ab2af024119'::uuid),   -- Yamuns
                   (25906, 'ab9b2ff4-92d9-4d11-a0b4-6e204a903592'::uuid),   -- GD2
                   (39211, 'd41b1b6f-ca04-4beb-b224-36f15c5feb64'::uuid),   -- Davos
                   (22581, '41c880ac-828b-4ed9-9dbb-cac15984e355'::uuid)    -- Mavric (5 Guards)
           ) as s(hid, uid)
      cross join lateral (select case when jsonb_typeof(h.forge->'__campWorkforce__') = 'object' then h.forge->'__campWorkforce__' end as wf
                            from public.user_profiles_history h where h.hid = s.hid and h.user_id = s.uid) snap
      cross join lateral (select case when jsonb_typeof(u.forge->'__campWorkforce__') = 'object' then u.forge->'__campWorkforce__' end as wf
                            from public.user_profiles u where u.user_id = s.uid) cur
     where snap.wf is not null
  ) merged
 where p.user_id = merged.uid
   and merged.wf is not null
   and merged.wf is distinct from p.forge->'__campWorkforce__'
returning p.display_name, p.forge->'__campWorkforce__' as workforce_now;

-- Check: every foundry below has its machines back, and every workforce is at
-- least its snapshot.
select p.display_name,
       (select count(*) from jsonb_object_keys(case when jsonb_typeof(p.forge->'__foundry__'->'machines') = 'object' then p.forge->'__foundry__'->'machines' else '{}'::jsonb end)) as foundry_machines,
       p.forge->'__campWorkforce__' as workforce
  from public.user_profiles p
 where p.user_id in ('b82f7acd-ad8f-459b-bae8-1671cfdb31f0', '4383064f-8fbe-4462-8583-09f18432f8ca',
                     'b35a8809-d5cf-4356-8af1-44646550e11b', 'b46f7086-94ac-4ecc-b4b0-24d32ec0c7a0',
                     'd41b1b6f-ca04-4beb-b224-36f15c5feb64', '1a618333-072a-429a-b0e8-0ab2af024119',
                     'ab9b2ff4-92d9-4d11-a0b4-6e204a903592', '41c880ac-828b-4ed9-9dbb-cac15984e355')
 order by p.display_name;
