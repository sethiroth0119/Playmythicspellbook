-- ===========================================================================
-- AUDIT - CINDER THAT MAY HAVE COME FROM THE BANK EXPLOIT
--
-- READ-ONLY. Every statement here is a SELECT. Nothing is changed, nobody is
-- adjusted, no balance moves. Deciding what to do is yours; this only tells
-- you where to look.
--
-- WHAT THE EXPLOIT WAS (fixed in v120g5)
--   Bank withdrawals were a read-modify-write of an absolute balance. A
--   concurrent chain could overwrite the decrement, so the bank reverted while
--   addGems() had already credited the wallet. Repeating it minted Cinder.
--
-- WHY THERE IS NO PERFECT QUERY, said plainly before you read the numbers:
--   The mint left NO distinguishing record. A farmed Cinder and an earned
--   Cinder are the same integer in the same column. There is no "exploit" flag
--   to filter on, because the bug was that the write never happened.
--   So these are SIGNALS, not proof. Treat a hit as "worth a look", never as
--   "this player cheated" - a big legitimate spender can look identical.
--
-- Plain ASCII. Supabase SQL editor, project ktsiasyjusesawtrwrjc.
-- ===========================================================================


-- --- 1. THE STRONGEST SIGNAL: wallet far above what the bank ledger explains.
-- boe_ledger records every deposit/withdrawal. A player whose wallet dwarfs
-- their entire banking history is not automatically suspicious - but a player
-- with a LOT of withdrawals and a wallet far exceeding the net is exactly the
-- shape the exploit produced.
select
  p.user_id,
  p.display_name,
  coalesce(p.gems, 0)                                   as wallet_now,
  coalesce(w.cinder, 0)                                 as canonical_now,
  coalesce(l.withdrawals, 0)                            as withdrawal_count,
  coalesce(l.withdrawn, 0)                              as total_withdrawn,
  coalesce(l.deposited, 0)                              as total_deposited,
  -- Net taken out of the bank across all time.
  coalesce(l.withdrawn, 0) - coalesce(l.deposited, 0)   as net_out_of_bank
from public.user_profiles p
left join public.user_progress w on w.user_id = p.user_id
left join (
  select user_id,
         count(*) filter (where kind = 'withdraw')            as withdrawals,
         sum(abs(cinder)) filter (where kind = 'withdraw')    as withdrawn,
         sum(cinder) filter (where kind = 'deposit')          as deposited
    from public.boe_ledger
   group by user_id
) l on l.user_id = p.user_id
where coalesce(l.withdrawals, 0) >= 5          -- repeated withdrawals
order by coalesce(p.gems, 0) desc
limit 50;


-- --- 2. WITHDRAWAL BURSTS. The exploit needed the withdraw button pressed
-- repeatedly in a short window, because it raced the bank-open chains. Normal
-- banking does not look like this.
select
  user_id,
  date_trunc('hour', created_at)      as hour,
  count(*)                            as withdrawals_in_hour,
  sum(abs(cinder))                    as cinder_out
from public.boe_ledger
where kind = 'withdraw'
group by user_id, date_trunc('hour', created_at)
having count(*) >= 10                            -- 10+ withdrawals in one hour
order by count(*) desc
limit 50;


-- --- 3. THE ONE NUMBER THAT IS ACTUALLY HARD EVIDENCE.
-- A bank balance that went NEGATIVE, or a wallet above any plausible ceiling,
-- cannot be explained by normal play. Negative balances are impossible after
-- v120g5 (the overdraft guard is in the same statement as the update), so any
-- that exist are pre-fix damage.
select user_id, balance, aza, updated_at
  from public.bank_of_ethos
 where balance < 0 or aza < 0
 order by balance asc;


-- --- 4. SCALE OF THE PROBLEM. Run this first, honestly - if the totals are
-- small the whole question may not be worth acting on.
select
  count(*)                                          as players,
  count(*) filter (where coalesce(gems,0) > 1000000) as over_1m,
  count(*) filter (where coalesce(gems,0) >  100000) as over_100k,
  sum(coalesce(gems,0))                              as total_cinder_in_wallets,
  round(avg(coalesce(gems,0)))                       as mean_wallet,
  percentile_cont(0.5) within group (order by coalesce(gems,0)) as median_wallet
from public.user_profiles;


-- --- 5. If you decide to act, this is the shape of it. LEFT COMMENTED.
-- Do NOT run without deciding a threshold you can defend, and take the
-- count first so you know exactly how many accounts you are touching.
--
-- select count(*) from public.user_profiles where coalesce(gems,0) > 5000000;
--
-- update public.user_profiles set gems = 5000000 where coalesce(gems,0) > 5000000;
-- update public.user_progress  set cinder = 5000000 where coalesce(cinder,0) > 5000000;
--
-- ! Both tables, or they drift apart and the canonical-wallet reconcile
--   (v120g6) will simply restore the higher of the two - undoing the change
--   and looking like the fix failed.
