-- ════════════════════════════════════════════════════════════════════════════
-- 044 — tw_node_owners: close the wide-open write policies
-- ════════════════════════════════════════════════════════════════════════════
-- Idempotent and re-runnable. Ends with a verify query.
--
-- 🔴 WHAT WAS WRONG. Every policy on this table was `true`:
--      INSERT with check (true)   → claim any node, for anyone
--      UPDATE using (true)        → take over any node already owned
--      DELETE using (true)        → delete anyone's ownership row
--    Any signed-in player could rewrite all 38 live rows. Node ownership drives
--    Cinder banking, city control, territory war and the warehouse delivery
--    ETA, so this was not a cosmetic table.
--
--    The warehouse handoff flagged only the INSERT. UPDATE and DELETE were open
--    too — which is the more serious pair, because they let a player take a node
--    someone else already owns rather than only grab an unclaimed one.
--
-- ⚠ WHY NOT SIMPLY user_id = auth.uid(). Two legitimate writers exist and they
--   need different rules:
--     · _twPlayerClaimNode()      a player claims an UNCLAIMED node for THEMSELF
--     · tw_cloudSetNodeOwner()    an ADMIN assigns a node to SOMEBODY ELSE
--   A self-only rule would break every admin assignment; an admin-only rule
--   would break self-claim. Both are expressed below.
--
-- 🔑 THE STEAL IS BLOCKED BY THE **UPDATE `using`** CLAUSE, NOT BY INSERT.
--    The client upserts. An upsert onto a node someone else owns becomes an
--    UPDATE, and `using` is evaluated against the row ALREADY THERE — whose
--    user_id is not mine — so it is denied. The client's own "already claimed by
--    another player" check is a courtesy message; this is the enforcement.
--    Deleting-then-claiming is blocked the same way by the DELETE `using`.
--
-- ⚠ SELECT STAYS PUBLIC ON PURPOSE. The map shows every node's owner name to
--   everyone; that is the feature, not a leak. Only writes are restricted.
--
-- is_admin() reads the email out of the JWT, server-side, against the same three
-- addresses index.html uses. A client cannot forge it.
-- ════════════════════════════════════════════════════════════════════════════

alter table public.tw_node_owners enable row level security;

-- Anyone signed in may READ. Unchanged.
drop policy if exists tw_node_owners_sel on public.tw_node_owners;
create policy tw_node_owners_sel on public.tw_node_owners
  for select to authenticated
  using (true);

-- Claim a node for YOURSELF, or (admin) assign it to anyone.
drop policy if exists tw_node_owners_ins on public.tw_node_owners;
create policy tw_node_owners_ins on public.tw_node_owners
  for insert to authenticated
  with check (public.is_admin() or user_id = auth.uid());

-- Change a row that is ALREADY YOURS, or (admin) any row. The `using` clause is
-- what stops a takeover: it tests the row as it stands before the write.
drop policy if exists tw_node_owners_upd on public.tw_node_owners;
create policy tw_node_owners_upd on public.tw_node_owners
  for update to authenticated
  using (public.is_admin() or user_id = auth.uid())
  with check (public.is_admin() or user_id = auth.uid());

-- Release YOUR OWN node, or (admin) remove any owner.
drop policy if exists tw_node_owners_del on public.tw_node_owners;
create policy tw_node_owners_del on public.tw_node_owners
  for delete to authenticated
  using (public.is_admin() or user_id = auth.uid());

-- ── VERIFY ──────────────────────────────────────────────────────────────────
-- Counts the policies AND asserts none of the write ones is still `true`, which
-- is the actual defect. A count alone would pass against the broken version.
select
  (select count(*) from pg_policies
     where schemaname='public' and tablename='tw_node_owners')                       as policies_expect_4,
  (select count(*) from pg_policies
     where schemaname='public' and tablename='tw_node_owners'
       and cmd in ('INSERT','UPDATE','DELETE')
       and (coalesce(qual,'') = 'true' or coalesce(with_check,'') = 'true'))         as wide_open_writes_expect_0,
  (select count(*) from pg_policies
     where schemaname='public' and tablename='tw_node_owners'
       and cmd='SELECT' and qual='true')                                             as public_read_expect_1,
  (select count(*) from pg_tables
     where schemaname='public' and tablename='tw_node_owners' and rowsecurity)       as rls_on_expect_1,
  (select count(*) from public.tw_node_owners)                                       as rows_preserved;
