-- ===========================================================================
-- MYTHIC SPELLBOOK - MIGRATION 006 (run after 001-005, which are already applied)
-- Only a corporation owner may FOUND a community.
-- Plain ASCII. Idempotent. Safe to re-run.
-- ===========================================================================

-- ===========================================================================
-- 006 - ONLY A CORPORATION OWNER MAY FOUND A COMMUNITY
--
-- Communities sit ABOVE corporations, so the entry requirement should be a
-- corporation. This makes the hierarchy real instead of decorative: you cannot
-- hold corps together without holding one yourself.
--
-- Requires 001. Idempotent, re-runnable. Plain ASCII.
--
-- NOTE ON SCOPE: this gates FOUNDING, not continued ownership. An owner who
-- later dissolves their corporation keeps the community they already built -
-- retroactively deleting someone's community out from under them would be a
-- far more destructive rule than the one that was asked for.
-- ===========================================================================

-- Replaces the comm_ins policy from 001, which only checked owner_id.
drop policy if exists comm_ins on public.communities;
create policy comm_ins on public.communities for insert to authenticated
  with check (
    owner_id = auth.uid()
    -- The founder of ANY corporation qualifies. Checked HERE rather than in JS
    -- because the client check is only a hint - this policy is the actual gate,
    -- and a tampered client hits it.
    and exists (
      select 1 from public.corporations c
       where c.founder_id = auth.uid()
    )
  );


-- verify: expect 1 row, and the definition should mention corporations
select policyname,
       (pg_get_expr(pol.polwithcheck, pol.polrelid) like '%corporations%') as requires_corp
  from pg_policies p
  join pg_policy pol on pol.polname = p.policyname
  join pg_class cl on cl.oid = pol.polrelid and cl.relname = p.tablename
 where p.schemaname = 'public' and p.tablename = 'communities' and p.policyname = 'comm_ins';
