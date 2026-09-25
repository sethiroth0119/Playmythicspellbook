-- ════════════════════════════════════════════════════════════════════════════
-- 087b · let corp_vault_log record a 'drop'.  ← RUN THIS, 087 DOES NOT WORK ALONE
-- ════════════════════════════════════════════════════════════════════════════
-- 🔴 WHAT IS BROKEN WITHOUT IT.
--    corp_vault_log.action carries a CHECK constraint listing every action the
--    log is allowed to hold:
--        deposit, withdraw, send, claim, cancel,
--        trade_offer, trade_accept, trade_decline, trade_cancel, trade_claim
--    'drop' is not among them, because until now nothing could drop. So the
--    INSERT at the end of corp_vault_drop violates the constraint and raises.
--
--    ⚠ AND THE RAISE UNDOES THE REMOVAL. A plpgsql function is one transaction:
--      the rows it just decremented roll back with it. The failure is therefore
--      SAFE — nothing is destroyed, nothing is lost — but the Drop button would
--      refuse every single time with an unreadable constraint error, which is
--      the feature not working at all.
--
--    This was caught by reading the constraint before shipping, not by a player
--    losing anything.
--
-- ⚠ WIDENING ONLY. The list below is the existing one plus 'drop'. Every value
--   already in the table stays legal — verified before writing this: the table
--   currently holds cancel, claim, deposit, send, trade_offer and withdraw, all
--   of which are kept.
--
-- SAFE TO RE-RUN. Dropping and recreating a CHECK touches no rows' contents; the
-- re-add validates existing rows, which the count below confirms will pass.
-- ════════════════════════════════════════════════════════════════════════════

alter table public.corp_vault_log
  drop constraint if exists corp_vault_log_action_check;

alter table public.corp_vault_log
  add constraint corp_vault_log_action_check
  check (action = any (array[
    'deposit'::text, 'withdraw'::text, 'drop'::text, 'send'::text, 'claim'::text,
    'cancel'::text, 'trade_offer'::text, 'trade_accept'::text,
    'trade_decline'::text, 'trade_cancel'::text, 'trade_claim'::text
  ]));

-- ════════════════════════════════════════════════════════════════════════════
-- VERIFY — run as-is. Expect:
--   drop_allowed   = true    the log will now accept a drop
--   rows_rejected  = 0       nothing already logged became illegal
-- ════════════════════════════════════════════════════════════════════════════
select
  (select pg_get_constraintdef(c.oid) like '%''drop''::text%'
     from pg_constraint c
    where c.conrelid = 'public.corp_vault_log'::regclass
      and c.conname = 'corp_vault_log_action_check')          as drop_allowed,
  (select count(*) from corp_vault_log
    where action not in ('deposit','withdraw','drop','send','claim','cancel',
                         'trade_offer','trade_accept','trade_decline',
                         'trade_cancel','trade_claim'))       as rows_rejected;
