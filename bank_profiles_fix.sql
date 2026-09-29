-- ═══════════════════════════════════════════════════════════════════════════
-- 🏦 THE BANK FIX — public_profiles has never existed
-- ---------------------------------------------------------------------------
-- Run ONCE in the Supabase SQL editor. Creates ONE view. Non-destructive:
-- it adds nothing to any table and changes no data.
--
-- ── WHAT WAS ACTUALLY BROKEN ───────────────────────────────────────────────
-- Four bank functions look up the player's display name like this:
--
--     select coalesce(display_name, 'Banker') into v_name
--       from public.public_profiles where user_id = v_uid;
--
-- but the real table is public.user_profiles. public_profiles was never
-- created — so EVERY one of these threw
-- `relation "public.public_profiles" does not exist` the moment it ran:
--
--     bank_open_cinder    ← the 1,000,000 Cinder purchase route
--     bank_open_charter   ← the Mythic Token staking route
--     bank_decide         ← approving / denying a loan application
--     bank_deposit        ← taking a deposit
--
-- That is why bank_directory() returned [] for everyone: BOTH ways of opening
-- a bank were dead, so a charter row could never be written. And because the
-- client matched the error text /does not exist/ against "the SQL was not
-- run", it reported "⚠ Bank not set up — run bank_cinder_charter.sql" — which
-- was misleading. The file HAD been run; the table it depends on was missing.
--
-- ── WHY A VIEW, NOT FOUR REWRITES ──────────────────────────────────────────
-- Redefining four SECURITY DEFINER functions means re-pasting four full
-- bodies and getting every one byte-perfect. A view repairs all five call
-- sites at once and cannot drift from the originals. It exposes ONLY the two
-- columns the functions read — user_id and display_name — so it is a narrower
-- surface than user_profiles itself, not a wider one.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace view public.public_profiles as
  select user_id, display_name
    from public.user_profiles;

grant select on public.public_profiles to anon, authenticated;

-- ═══ VERIFY ════════════════════════════════════════════════════════════════
--   select * from public.public_profiles limit 3;          -- names come back
--
-- Then, signed in as yourself IN THE GAME, open the Bank Back Office and
-- press "Repair my charter" (or reopen Bank Row — the self-repair runs on
-- load). After that:
--   select owner_id, bank_name, charter_tier, founded_with, is_open
--     from public.player_banks where owner_id = auth.uid();
--   select * from public.bank_directory();                 -- your bank listed
