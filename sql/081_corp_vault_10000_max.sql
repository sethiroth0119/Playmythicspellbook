-- 081 · The Corporation Vault holds 10,000 units, whatever its tier.
--
-- Set by the owner: "the Corporation Vault holds 10,000 units max."
--
-- WAS: tier 1 = 500,000 · tier 2 = 800,000 · tier 3 = 1,500,000.
--
-- ⚠ THIS DOES NOT DELETE ANYTHING, AND FIVE CORPS ARE ALREADY PAST THE LINE:
--   ANOMALY 1,302,882 · River Meadows 366,417 · Clarey Nexus 106,518 ·
--   Talon Forge 100,937 · Omnione 45,527. corp_vault_space() reports
--   available = greatest(0, cap - used), so those vaults simply read as full
--   and refuse NEW deposits until they are drawn back under 10,000. Nothing
--   already banked is touched. Confiscating members' deposits to enforce a new
--   number would be a far worse outcome than a full vault.
--
-- ⚠ THE TIER LADDER NOW BUYS NOTHING. Every tier returns the same figure, so a
--   corp that paid to upgrade gets no more room than one that did not. Written
--   as least(<tier>, cap) rather than a flat 10000 so the tier table stays
--   visible and raising the cap restores the ladder in one line.
create or replace function public.corp_vault_capacity(p_tier integer)
 returns bigint
 language sql
 immutable
as $function$
  select least(
    case coalesce(p_tier,1)
      when 1 then  500000::bigint
      when 2 then  800000::bigint
      when 3 then 1500000::bigint
      else 500000::bigint end,
    10000::bigint)
$function$;
