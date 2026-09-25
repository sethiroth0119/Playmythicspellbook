-- ═══════════════════════════════════════════════════════════════════════════
-- 049 · PAID VAULT CAPACITY GETS A RECEIPT, AND A FLOOR
--
-- Asked for: "Players base vaults are going up and down in numbers, set the
-- correct base vault space for players, keep the correct numbers for those who
-- purchased vault space."
--
-- 🔴 THE FLUCTUATION ITSELF IS A CLIENT BUG AND IS FIXED IN index.html, NOT
--    HERE. getResourceCap() = vault + warehouse staff + _cityProdStorage(), and
--    that last term reads Profile.cityProduction — which was named in the cloud
--    upload and the cloud hydration and in NEITHER local whitelist. Every local
--    load therefore started with the city's Warehouses missing and the ceiling
--    low, then jumped when the cloud answered. That is the up and down.
--
-- 🔴 WHAT THIS FILE IS FOR IS WORSE AND QUIETER. A vault crate is bought with
--    Ⓐ Aza on the CLIENT — `v.rows += c.rows` and save. There is no server
--    record that the purchase ever happened. The mutated number IS the receipt.
--    Four separate reset paths in index.html wiped that object; three of them
--    did not keep the size (now fixed), and because getVaultLayout() treats an
--    empty object as valid and fills in the DEFAULT row count, the loss rendered
--    as an ordinary 8-row vault. Indistinguishable, from the player's side, from
--    never having bought anything — and unrecoverable, because nothing anywhere
--    knew what they had paid for.
--
-- ⭐ SO THE SIZE GETS A ROW OF ITS OWN, AND IT ONLY EVER GOES UP.
--    vault_paid is a floor, not a mirror: the vault may be larger than the
--    record (a purchase not yet synced) but never smaller. If a reset, a bad
--    merge or a stale device drops the rows again, the floor is what puts them
--    back — and it is the answer to "what did this player actually pay for".
--
-- ⚠ THE SEED IS TODAY'S LIVE VALUES, AND THEY WERE CHECKED BEFORE TRUSTING
--   THEM. Five accounts sit above the 8-row base, and every one is internally
--   consistent with real purchases: stashExtra is exactly 1,000 per Relic Vault
--   Door (its 2,250 stash less the 1,250 its 5 rows are worth), and each row
--   count is a reachable sum of 1 / 3 / 5 containers:
--     Grimalkin Lord   72 rows, 12,000 extra   (12 relic doors + 4 rows)
--     Sethiroth Tha Dev 38 rows,  6,000 extra   (6 relic doors exactly)
--     GreyDragon       16 rows,  1,000 extra   (1 relic door + 1 cargo)
--     Aston Drakonis   12 rows,      0 extra   (1 cargo + 1 crate)
--     AetosDios         9 rows,      0 extra   (1 crate)
--   Numbers that survive that check are worth freezing; numbers that did not
--   would have needed the owner, not a guess.
--
-- ⚠ GRIMALKIN LORD IS ABOVE THE CURRENT CEILING AND IS LEFT THERE. The client
--   cap is VAULT_MAX_ROWS = 62 (62 × 10 × 25 = RES_STASH_MAX 15,500) and they
--   hold 72. That is paid capacity the stash clamp already refuses to honour —
--   index.html's own note says "rows 63-72 were Aza spent on" space that cannot
--   be used. Recording 72 keeps the receipt honest; whether to refund the
--   difference or raise the ceiling is the owner's call, not a migration's.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.vault_paid (
  user_id     uuid primary key references auth.users(id) on delete cascade,
  rows        integer not null default 8,
  cols        integer not null default 10,
  stash_extra integer not null default 0,
  source      text,
  recorded_at timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

alter table public.vault_paid enable row level security;

-- the player may READ their own receipt; nobody may write one from the client
drop policy if exists vp_sel on public.vault_paid;
create policy vp_sel on public.vault_paid
  for select to authenticated using (user_id = auth.uid() or is_admin());

-- ── seed from the live profiles, once ─────────────────────────────────────
insert into public.vault_paid (user_id, rows, cols, stash_extra, source)
select p.user_id,
       greatest(8,  coalesce((p.forge->'__vaultLayout__'->>'rows')::int, 8)),
       greatest(10, coalesce((p.forge->'__vaultLayout__'->>'cols')::int, 10)),
       greatest(0,  coalesce((p.forge->'__vaultLayout__'->>'stashExtra')::int, 0)),
       'seed:2026-09-02 from user_profiles.forge.__vaultLayout__'
  from public.user_profiles p
 where coalesce((p.forge->'__vaultLayout__'->>'rows')::int, 8) > 8
    or coalesce((p.forge->'__vaultLayout__'->>'stashExtra')::int, 0) > 0
on conflict (user_id) do nothing;

-- ── the floor, and the way it keeps itself current ────────────────────────
-- 🔴 NO ARGUMENTS, ON PURPOSE. The obvious shape is
--    vault_paid_set(rows, stash) called by the shop — and that is a setter a
--    player can call with any number they like, the same class of hole sql/034
--    records for wallet_credit. This takes nothing: it reads the caller's OWN
--    profile, which the server already stores, and raises the record to match.
--    A player cannot tell it a number; they can only ask it to look.
-- ⚠ MONOTONIC. It raises and never lowers, so a stale device or a half-applied
--   reset cannot talk the floor down — which is the entire job.
create or replace function public.vault_paid_sync()
returns json language plpgsql security definer set search_path to 'public' as $fn$
declare
  v_uid uuid := auth.uid();
  v_rows int; v_cols int; v_extra int;
  v_orows int; v_ocols int; v_oextra int;
begin
  if v_uid is null then return json_build_object('ok', false, 'why', 'not signed in'); end if;

  select greatest(8,  coalesce((forge->'__vaultLayout__'->>'rows')::int, 8)),
         greatest(10, coalesce((forge->'__vaultLayout__'->>'cols')::int, 10)),
         greatest(0,  coalesce((forge->'__vaultLayout__'->>'stashExtra')::int, 0))
    into v_rows, v_cols, v_extra
    from public.user_profiles where user_id = v_uid;
  if v_rows is null then return json_build_object('ok', false, 'why', 'no profile'); end if;

  insert into public.vault_paid (user_id, rows, cols, stash_extra, source)
  values (v_uid, v_rows, v_cols, v_extra, 'sync')
  on conflict (user_id) do update
     set rows        = greatest(public.vault_paid.rows, excluded.rows),
         cols        = greatest(public.vault_paid.cols, excluded.cols),
         stash_extra = greatest(public.vault_paid.stash_extra, excluded.stash_extra),
         updated_at  = now();

  select rows, cols, stash_extra into v_orows, v_ocols, v_oextra
    from public.vault_paid where user_id = v_uid;

  return json_build_object('ok', true, 'rows', v_orows, 'cols', v_ocols, 'stashExtra', v_oextra);
end; $fn$;

revoke all on function public.vault_paid_sync() from public, anon;
grant execute on function public.vault_paid_sync() to authenticated;

-- ROLLBACK:
--   drop function if exists public.vault_paid_sync();
--   drop table if exists public.vault_paid;   -- ⚠ this is the only record of
--   -- what anybody paid for; export it before dropping.
