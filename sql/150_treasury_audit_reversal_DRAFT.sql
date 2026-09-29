-- ════════════════════════════════════════════════════════════════════════════
-- 150 · CORP TREASURY AUDIT: REVERSE THE UNBACKED DEPOSITS
--
--   ██ DRAFT — NOT APPLIED. Owner decision required before running. ██
--
-- WHY. sql/146's header describes the hole: until 146, ct_ins let any member
-- INSERT a corp_treasury row with any amount, and the wallet debit
-- (spendGems) was a separate client step the server never tied to it.
-- "42 past deposit rows totalling 78.8M" is simply EVERY kind='deposit' row
-- (42 rows, 78,769,515) — 146 names no finer criterion. The audit
-- (2026-09-17, read-only) matched each row to a wallet_ledger debit
-- (resource 'cinder', op 'charge') by the same user, for the GROSS amount
-- (the "N sent" figure for a Bank of Ethos transfer), within ±5 min, each
-- debit used at most once:
--   33 BACKED        63,540,649   debit found, balance_after contiguous
--    4 UNBACKED      10,628,866   the four rows below
--    5 UNDETERMINABLE 4,600,000   08-08 .. 08-11 12:28, before wallet_ledger
--                                 recorded client spends ('legacy spend
--                                 mirror' starts 08-11 20:12). NOT reversed
--                                 here: absence of a row proves nothing then.
--
-- ROWS THIS FILE REVERSES (corp_treasury.id):
--   135efa81-a6be-4b3e-947a-5e2cd0b8fa9a  CLAR  10,000,000  08-23 11:15:19
--       Only 10M debit that day (ad0f1fb7…, 11:13:46) already backs the
--       10M deposit 52f6efbe… 93 s earlier; wallet then held 2,525,276.
--   4e070741-ac1f-446e-99c3-d2dca6868bd3  TALO     215,433  09-05 00:18:51
--       Duplicate of 6c36519d… (same note, 26 s earlier); one debit
--       (2f4a7b9f…) exists for the pair.
--   e2a7bde8-f1a7-4043-a022-4cd89c0617bc  TALO     198,000  09-05 00:19:21
--       "200,000 sent": no 200,000 debit by that user at any nearby time.
--
-- OPTIONAL (commented out below — owner call):
--   6c36519d-bb6e-4dba-a0f4-d31bd1eedbc1  TALO     215,433  09-05 00:18:25
--       Its debit 2f4a7b9f… (-217,610, balance → 0) was re-credited 67 s
--       later by wallet_reconcile_self ('reconcile_canonical_wallet'
--       +217,610), so the wallet's NET movement for it is zero. That credit
--       is a separate wallet-side question (sql/046), which is why this row
--       is not in the default set. ⚠ Including it takes TALO to −25,994.
--
-- IMPACT (balances at audit time, sum(amount)):
--   CLAR  17,842,578 → 7,842,578
--   TALO     602,872 → 189,439   (→ −25,994 with the optional row)
--   Balance is unclamped by design (sql/146 REJECTED list); a negative
--   treasury is the honest figure, not something to clamp.
--
-- SHAPE. Append-only: one NEGATIVE row per reversed deposit, kind
-- 'audit_reversal', user_id = the original depositor (so the reversal shows
-- against the same member), note carrying a unique marker
-- 'audit_reversal:sql150:<deposit id>'. Never UPDATE or DELETE the original.
-- Re-runnable: a marker already present inserts nothing; the unique partial
-- index makes a double reversal impossible even under a concurrent re-run.
-- Run in the SQL editor as postgres. If sql/146 is applied by then, its
-- _ct_client_write_guard admits this (current_user = postgres), and
-- ct_ins is irrelevant (RLS does not apply to the table owner session).
-- ⚠ Check the client renders an unknown kind sanely in the treasury log
--   (corpTreasuryFetch) before running; it sums amount regardless of kind.
-- ════════════════════════════════════════════════════════════════════════════

begin;

create unique index if not exists corp_treasury_audit_reversal_once
  on public.corp_treasury (note) where kind = 'audit_reversal';

with targets(deposit_id) as (
  values
    ('135efa81-a6be-4b3e-947a-5e2cd0b8fa9a'::uuid),
    ('4e070741-ac1f-446e-99c3-d2dca6868bd3'::uuid),
    ('e2a7bde8-f1a7-4043-a022-4cd89c0617bc'::uuid)
    -- , ('6c36519d-bb6e-4dba-a0f4-d31bd1eedbc1'::uuid)   -- OPTIONAL, see header
)
insert into public.corp_treasury (corp_id, user_id, amount, kind, note)
select d.corp_id, d.user_id, -d.amount, 'audit_reversal',
       'audit_reversal:sql150:' || d.id::text
         || ' — unbacked deposit of ' || d.amount::bigint
         || ' on ' || to_char(d.created_at at time zone 'UTC', 'YYYY-MM-DD HH24:MI:SS') || ' UTC'
  from targets t
  join public.corp_treasury d on d.id = t.deposit_id
 where d.kind = 'deposit'
   and d.amount > 0
   and not exists (
         select 1 from public.corp_treasury r
          where r.kind = 'audit_reversal'
            and r.note like 'audit_reversal:sql150:' || d.id::text || '%')
on conflict do nothing;

commit;

-- --- VERIFY. Expect one row per target with reversed_t = t and
-- --- net_zero_t = t; corp balances as in the header.
select d.id                          as deposit_id,
       c.tag,
       d.amount                      as deposit,
       r.amount                      as reversal,
       (r.id is not null)            as reversed_t,
       (d.amount + coalesce(r.amount, 0) = 0) as net_zero_t,
       (select count(*) from public.corp_treasury x
         where x.kind = 'audit_reversal'
           and x.note like 'audit_reversal:sql150:' || d.id::text || '%') as reversals_expect_1,
       (select sum(amount) from public.corp_treasury b where b.corp_id = d.corp_id) as corp_balance_now
  from public.corp_treasury d
  join public.corporations c on c.id = d.corp_id
  left join public.corp_treasury r
         on r.kind = 'audit_reversal'
        and r.note like 'audit_reversal:sql150:' || d.id::text || '%'
 where d.id in ('135efa81-a6be-4b3e-947a-5e2cd0b8fa9a',
                '4e070741-ac1f-446e-99c3-d2dca6868bd3',
                'e2a7bde8-f1a7-4043-a022-4cd89c0617bc',
                '6c36519d-bb6e-4dba-a0f4-d31bd1eedbc1')
 order by d.created_at;
