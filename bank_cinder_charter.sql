-- ═══════════════════════════════════════════════════════════════════════════
-- 🏦 CINDER-FOUNDED BANKS — the missing half of the purchase
-- ---------------------------------------------------------------------------
-- Run ONCE in the Supabase SQL editor, AFTER player_banks.sql.
-- Adds one column and one RPC. No tables dropped, no rows touched.
-- Safe to re-run.
--
-- ── THE BUG THIS FIXES ─────────────────────────────────────────────────────
-- Opening a bank has two prices: 1,000,000 Cinder, or a $200 MT stake.
-- Only the MT route ever created the bank: it goes through bank_open_charter().
-- The Cinder route founds the `bank` OPERATION and stops — so a player who paid
-- a million Cinder owned an operation with NO player_banks row behind it:
--   • the bank never appeared in bank_directory()
--   • the Underwriting Desk reported "you do not run a bank"
--   • no teller could be hired, no application could be filed
-- i.e. you bought a bank and there was nowhere to go. This RPC is the missing
-- half, and it is IDEMPOTENT so an existing owner is repaired on next login
-- rather than having to buy again.
-- ═══════════════════════════════════════════════════════════════════════════

-- How the charter was paid for. Cinder-founded banks hold no stake, which is
-- why their capitalisation reads 0 MT — that is correct, not a missing value.
alter table public.player_banks
  add column if not exists founded_with text not null default 'mt'
  check (founded_with in ('mt', 'cinder'));

create or replace function public.bank_open_cinder(p_bank_name text default null, p_tagline text default '')
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid  uuid := auth.uid();
  v_name text;
  v_existing public.player_banks%rowtype;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'error', 'not_signed_in'); end if;

  -- Idempotent: already chartered ⇒ report success and change nothing. This is
  -- what lets an already-paid owner be repaired silently instead of double-charged.
  select * into v_existing from public.player_banks where owner_id = v_uid;
  if found then
    return jsonb_build_object('ok', true, 'existed', true, 'tier', v_existing.charter_tier);
  end if;

  select coalesce(display_name, 'Banker') into v_name
    from public.user_profiles where user_id = v_uid;

  -- ⚠ NO Cinder is debited here. The 1,000,000 was already taken by the
  -- operation-founding path (chargeCinderAtomic → wallet_charge) BEFORE this is
  -- called. Charging again here would bill the player twice for one bank.
  insert into public.player_banks (
    owner_id, owner_name, bank_name, tagline, charter_tier,
    mt_burned, mt_staked, mt_overstake, founded_with
  ) values (
    v_uid, coalesce(v_name, 'Banker'),
    coalesce(nullif(btrim(p_bank_name), ''), coalesce(v_name, 'Lending') || ' House'),
    coalesce(p_tagline, ''), 1,
    0, 0, 0, 'cinder'
  );

  insert into public.bank_ledger (bank_id, kind, amount, actor_id, actor_name, note)
  values (v_uid, 'charter', 0, v_uid, coalesce(v_name, 'Banker'),
          'Charter I opened with Cinder (no MT staked)');

  return jsonb_build_object('ok', true, 'existed', false, 'tier', 1);
end $$;

grant execute on function public.bank_open_cinder(text, text) to authenticated;

-- ═══ VERIFY ════════════════════════════════════════════════════════════════
-- As the signed-in owner:
--   select public.bank_open_cinder('Ashford & Keel');   -- first call: existed=false
--   select public.bank_open_cinder('Ashford & Keel');   -- again:     existed=true
--   select owner_id, bank_name, charter_tier, mt_staked, founded_with
--     from public.player_banks where owner_id = auth.uid();
--   select * from public.bank_directory();              -- your bank should be listed
