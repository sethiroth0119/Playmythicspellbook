-- ===========================================================================
-- 032 — REMOVE THE CLIENT-WRITTEN DUPLICATE ROWS FROM boe_ledger.
--
-- WHY. Every accepted transfer appends to boe_ledger inside the same
-- transaction as the balance change (sql/022:142 Cinder, sql/022:217 and
-- sql/024:385 Aza, _boe_apply in sql/030 for exchange). When those settlements
-- moved server-side the client's own boeLog() calls were left in place, so each
-- transfer wrote a SECOND row. Players deposited Aza once and saw it leave
-- twice — reported as "my Aza disappeared". The client half is fixed in
-- ff2ea524de; this file removes the rows already written.
--
-- 🔴 THE CHECK THAT MATTERS, AND WHY A BLANKET DELETE WOULD HAVE BEEN A
--    DISASTER. There are 425 client-written rows, but they go back to
--    2026-05-19 — long before server-side logging existed. Only 77 of them have
--    a matching SERVER row. The other 348 are the SOLE RECORD of those
--    transfers. Deleting by note alone would have destroyed three months of
--    real, irreplaceable transaction history to fix a display bug.
--    A row is only a duplicate if its partner exists. That is the whole rule.
--
-- 🔴 SAFE BECAUSE THE LEDGER IS HISTORY, NOT A BALANCE SOURCE. Verified against
--    the live database: _boe_apply, boe_transfer and boe_transfer_aza are the
--    only functions that touch boe_ledger and NONE of them read it — they only
--    insert. Balances are stored columns on bank_of_ethos. Deleting log rows
--    therefore cannot move money. Confirmed after the fact: bank totals
--    unchanged at 1,341,585,516 Cinder / 7,609 Aza.
--
-- ⚠ CLAUDE.md says ledgers are append-only, and that rule is right. This is a
--   deliberate, one-time exception to delete rows that were never supposed to
--   exist — duplicates of an authoritative row, not entries in their own right.
--   Every removed row is copied to boe_ledger_dupe_backup FIRST, so the
--   deletion is reversible. Do not generalise this file into a habit.
--
-- APPLIED 2026-08-12: 77 rows backed up, 77 deleted, 0 duplicate pairs left,
-- 348 sole-record rows preserved, bank balances unchanged.
-- Idempotent: re-running finds nothing to do.
-- ===========================================================================

create table if not exists public.boe_ledger_dupe_backup (
  like public.boe_ledger including defaults,
  backed_up_at timestamptz not null default now(),
  reason text
);
alter table public.boe_ledger_dupe_backup enable row level security;
-- Admin-only. It holds other players' transaction history.
drop policy if exists blb_admin on public.boe_ledger_dupe_backup;
create policy blb_admin on public.boe_ledger_dupe_backup for select using (public.is_admin());

with client_rows as (
  select * from public.boe_ledger
  where note in ('Cinder deposit to bank','Cinder withdrawal','Aza deposit to bank','Aza withdrawal')
     or note = 'Exchanged Aza ' || chr(8594) || ' Cinder'   -- unicode arrow = the client's
),
server_rows as (
  select * from public.boe_ledger
  where note like 'atomic %' or note like 'canonical %' or note = 'Exchanged Aza -> Cinder'
),
dupes as (
  select c.* from client_rows c
  where exists (
    select 1 from server_rows s
    where s.user_id = c.user_id
      and abs(extract(epoch from (s.ts - c.ts))) <= 3
      and abs(coalesce(s.cinder,0)) = abs(coalesce(c.cinder,0))
      and abs(coalesce(s.aza,0))    = abs(coalesce(c.aza,0))
  )
)
insert into public.boe_ledger_dupe_backup (id, user_id, ts, kind, cinder, aza, note, counterparty, reason)
select id, user_id, ts, kind, cinder, aza, note, counterparty,
       'client duplicate of a server-logged transfer (ff2ea524de)'
from dupes
on conflict do nothing;

delete from public.boe_ledger l
using public.boe_ledger_dupe_backup b
where l.id = b.id;

-- ===========================================================================
-- VERIFY
--
-- select count(*) from public.boe_ledger_dupe_backup;      -- rows recoverable
-- Duplicate pairs remaining (must be 0):
--   select count(*) from public.boe_ledger c
--    where (c.note in ('Cinder deposit to bank','Cinder withdrawal',
--                      'Aza deposit to bank','Aza withdrawal')
--           or c.note = 'Exchanged Aza ' || chr(8594) || ' Cinder')
--      and exists (select 1 from public.boe_ledger s
--                  where (s.note like 'atomic %' or s.note like 'canonical %'
--                         or s.note = 'Exchanged Aza -> Cinder')
--                    and s.user_id = c.user_id
--                    and abs(extract(epoch from (s.ts - c.ts))) <= 3
--                    and abs(coalesce(s.cinder,0)) = abs(coalesce(c.cinder,0))
--                    and abs(coalesce(s.aza,0))    = abs(coalesce(c.aza,0)));
--
-- Pre-server-logging history preserved (expect 348, NOT 0):
--   select count(*) from public.boe_ledger
--    where note in ('Cinder deposit to bank','Cinder withdrawal',
--                   'Aza deposit to bank','Aza withdrawal')
--       or note = 'Exchanged Aza ' || chr(8594) || ' Cinder';
--
-- TO ROLL BACK:
--   insert into public.boe_ledger (id,user_id,ts,kind,cinder,aza,note,counterparty)
--   select id,user_id,ts,kind,cinder,aza,note,counterparty
--     from public.boe_ledger_dupe_backup on conflict (id) do nothing;
-- ===========================================================================
