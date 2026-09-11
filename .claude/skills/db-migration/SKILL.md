---
name: db-migration
description: Write a new Supabase migration for Mythic Spellbook in sql/NNN_name.sql — tables, RLS policies, RPCs, ledgers — following the repo's idempotent, RLS-in-the-same-file, verify-at-the-end conventions, and lint it. Use whenever a feature needs a new table, column, policy, or SQL function.
---

# Write a migration

Migrations are numbered files in `sql/` applied **by hand** in the Supabase SQL editor
(project `ktsiasyjusesawtrwrjc`). Because a human pastes them, every file must be
re-runnable, self-contained, and end by proving itself.

## Steps
1. **Number it.** `ls sql | tail -3` → next `NNN_snake_name.sql`. Header comment: what
   feature, why, what it replaces, what to expect from the verify query.
2. **Every table:**
   ```sql
   create table if not exists public.x (…);
   alter table public.x enable row level security;
   drop policy if exists x_select on public.x;
   create policy x_select on public.x for select to authenticated using (user_id = auth.uid());
   ```
   Write policies per command (select/insert/update/delete). Every policy has `using`
   and/or `with check`. A table with RLS and **no** policies is service-role-only — write
   the words "service role only" in a comment so `sql-lint` and the next reader know.
3. **RLS recursion:** a SELECT policy on T may not select from T. Go through a
   `security definer` helper with `set search_path = public` (`is_community_member`,
   `is_community_leader` are the pattern).
4. **Ledgers:** append-only tables with `amount`; balance is a view or `sum()`. Never
   `update … set balance`. Lock columns the client must not write (see sql/026).
5. **RPCs:** `create or replace function … security definer set search_path = public`;
   validate `auth.uid()` inside; make repeat calls harmless (idempotency key or
   `on conflict do nothing`). Grant execute to `authenticated` only.
6. **Indexes:** `create index if not exists`.
7. **Verify:** end with a `select` that shows the tables/policies/functions exist
   (`select tablename, policyname from pg_policies where tablename in (…)`).
8. **Lint:** `node tools/gamedev/sql-lint.mjs sql/NNN_name.sql` — zero errors, read the
   warnings.
9. **Client side:** every read/write of the new table degrades when the table is
   missing (`Corp.*` pattern). `audit.mjs` warns about tables no `.sql` creates, so the
   migration file must land in the same commit as the client code.
10. Tell the user the file must be applied in the Supabase editor — nothing here runs it.
