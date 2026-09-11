-- ════════════════════════════════════════════════════════════════════════════
-- PENDING MIGRATIONS — current as of v120y8 (2026-08-19)
-- ----------------------------------------------------------------------------
-- Apply by hand in the Supabase SQL editor for project ktsiasyjusesawtrwrjc.
-- Every file is idempotent and re-runnable, so re-running one that is already
-- applied is safe. RUN THEM ONE AT A TIME and read each verify block before
-- moving on — if one fails you want to know which.
--
-- 🔴 THE RECORD DISAGREES WITH ITSELF ABOUT 036–038, SO CHECK BEFORE YOU RUN.
--    sql/PENDING_v120w8_ALL.sql lists 036, 037 and 038 as pending.
--    The city-builder handover also records 038 as written-but-NOT-applied.
--    The project memory records 036–038 as all applied.
--    Those cannot all be true. STEP 0 below settles it from the database
--    itself rather than from any document, including this one.
--
-- ORDER, once STEP 0 tells you what is missing:
--   036  season directive expiry     (unrelated to the city; old pending)
--   037  AZA exchange counter fix    (unrelated to the city; old pending)
--   038  city economy trade          city_profiles + city_trade_offers
--   039  city trade agreements       standing 12-hourly deals  ← NEW, definitely pending
--
-- 039 DEPENDS ON 038 (it references city_profiles). If STEP 0 shows 038 missing,
-- run 038 first or 039 will fail on the foreign key.
-- ════════════════════════════════════════════════════════════════════════════


-- ════════════════════════════════════════════════════════════════════════════
-- STEP 0 — WHAT IS ACTUALLY APPLIED? Run this ALONE, first. It changes nothing.
-- ════════════════════════════════════════════════════════════════════════════
select '036 season directive expiry' as migration,
       to_regprocedure('public.season_directive_expire()') is not null as looks_applied
union all
select '037 aza exchange fix',
       exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
               where n.nspname = 'public' and p.proname = 'aza_exchange_counter_fix')
union all
select '038 city economy trade  (city_profiles)',
       to_regclass('public.city_profiles') is not null
union all
select '038 city economy trade  (city_trade_offers)',
       to_regclass('public.city_trade_offers') is not null
union all
select '038 city economy trade  (city_trade_fill RPC)',
       to_regprocedure('public.city_trade_fill(uuid,numeric)') is not null
union all
select '039 city trade agreements',
       to_regclass('public.city_trade_agreements') is not null
union all
select '039 shipments + claims',
       to_regclass('public.city_trade_shipments') is not null
       and to_regclass('public.city_trade_shipment_claims') is not null;

-- ⚠ 036 and 037 are probed by the object each one creates. If your copy of those
--   files creates something differently named, the probe reads FALSE for a
--   migration that is in fact applied — open the file and check what it makes
--   before re-running it. A false "not applied" here is harmless (they are
--   idempotent); a false "applied" is the one that would bite, and cannot happen
--   this way round.


-- ════════════════════════════════════════════════════════════════════════════
-- STEP 1 — 039, the one that is definitely pending.
--          Paste the CONTENTS of sql/039_city_trade_agreements.sql here.
--          It is not inlined in this file on purpose: one source of truth for
--          the schema, and a copy in a bundle is a copy that drifts. That has
--          already happened in this repo with the legacy CHAT_SQL constants.
-- ════════════════════════════════════════════════════════════════════════════
-- \i sql/039_city_trade_agreements.sql   -- (psql only; in the web editor, paste it)


-- ════════════════════════════════════════════════════════════════════════════
-- STEP 2 — CONFIRM. Re-run STEP 0. Every row should read true.
-- ════════════════════════════════════════════════════════════════════════════
