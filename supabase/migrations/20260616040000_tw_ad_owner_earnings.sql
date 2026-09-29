-- =============================================================================
-- 💰 Ethos Sponsor Network — let a NODE OWNER read their own ad-revenue ledger.
-- The split ledger (tw_ad_orders) was readable only by the BUYER. This adds a
-- second SELECT policy so a connected seller can read the orders routed to THEIR
-- corp (their 70% share), powering the "Your earnings" line in the manage UI.
-- Policies are OR'd, so the existing buyer-read policy still applies.
--
-- Run ONCE in the Supabase SQL editor (or `supabase db push`). Idempotent.
-- Requires the ethos_sponsor_network migration (tw_ad_orders + tw_ad_sellers).
-- =============================================================================

drop policy if exists tw_ad_orders_owner_sel on public.tw_ad_orders;
create policy tw_ad_orders_owner_sel on public.tw_ad_orders
  for select to authenticated using (
    owner_corp_id in (select corp_id from public.tw_ad_sellers where user_id = auth.uid())
  );
